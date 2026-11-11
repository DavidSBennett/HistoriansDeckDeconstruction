<?php
/**
 * games.php — loading, locking and saving games, seats and lobby information.
 *
 * Every change to a game follows the same pattern, inside one transaction:
 *   $DB->begin(); $g = dk_game($id, true);  ... check, change ...  dk_save_state(...) or UPDATE;  $DB->commit();
 * The row lock (FOR UPDATE on MySQL, the whole-file write lock on SQLite) makes moves on one game strictly
 * one at a time, and every change bumps state_version, which is what clients poll for.
 */
declare(strict_types=1);

use function HistDeck\{makeRules, loadData, toAct};

const DK_JOIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // Board's invite alphabet: no I, L, O, 0, 1
const DK_BOT_NAMES = ['Prof. Vance', 'Prof. Ito', 'Dr. Marsh', 'Dr. Okafor', 'Prof. Adeyemi', 'Dr. Lindqvist'];
const DK_LENGTHS = ['short', 'medium', 'long'];

/** The game row, optionally locked for this transaction; 404 if there is none. */
function dk_game(int $gameId, bool $lock = false): array
{
    global $DB;
    $g = $DB->one('SELECT * FROM dk_games WHERE game_id = ?' . ($lock ? $DB->forUpdate() : ''), [$gameId]);
    if (!$g) {
        if ($lock) {
            $DB->rollback();
        }
        dk_error('No such game.', 404);
    }
    $g['game_id'] = (int) $g['game_id'];
    $g['host_user_id'] = (int) $g['host_user_id'];
    $g['state_version'] = (int) $g['state_version'];
    return $g;
}

function dk_seats(int $gameId): array
{
    global $DB;
    return array_map(static fn($s) => [
        'seat' => (int) $s['seat'],
        'user_id' => $s['user_id'] === null ? null : (int) $s['user_id'],
        'is_bot' => (bool) $s['is_bot'],
        'name' => (string) $s['name'],
    ], $DB->all('SELECT seat, user_id, is_bot, name FROM dk_seats WHERE game_id = ? ORDER BY seat', [$gameId]));
}

function dk_seat_of(array $seats, int $userId): ?int
{
    foreach ($seats as $s) {
        if ($s['user_id'] === $userId) {
            return $s['seat'];
        }
    }
    return null;
}

/** Rolls back and fails with a status: for use inside a transaction. */
function dk_abort(string $message, int $status = 400, array $extra = []): void
{
    global $DB;
    $DB->rollback();
    dk_error($message, $status, $extra);
}

function dk_new_join_code(): string
{
    global $DB;
    for ($attempt = 0; $attempt < 50; $attempt++) {
        $code = '';
        for ($i = 0; $i < 6; $i++) {
            $code .= DK_JOIN_ALPHABET[random_int(0, strlen(DK_JOIN_ALPHABET) - 1)];
        }
        if (!$DB->one('SELECT 1 FROM dk_games WHERE join_code = ?', [$code])) {
            return $code;
        }
    }
    throw new RuntimeException('Could not find a free join code.');
}

/** Normalises what a player typed: "abc-def" and "ABC DEF" both become "ABCDEF". */
function dk_normalize_code($raw): string
{
    return is_string($raw) ? strtoupper(preg_replace('/[\s-]+/', '', $raw)) : '';
}

/** The data files the game will use (a snapshot is stored with the game when it starts). */
function dk_current_data(string $deckId): array
{
    static $cache = [];
    return $cache[$deckId] ??= loadData(DK_DATA_DIR, $deckId);
}

/** The rules a game runs under: its own snapshot once started, the current data before. */
function dk_rules_data(array $g): array
{
    return $g['rules'] ? json_decode($g['rules'], true, 512, JSON_THROW_ON_ERROR) : dk_current_data($g['deck_id']);
}

function dk_rules(array $g): array
{
    static $cache = [];
    return $cache[$g['game_id']] ??= makeRules(dk_rules_data($g));
}

function dk_seat_limits(array $g): array
{
    $s = dk_rules_data($g)['config']['seats'] ?? ['min' => 2, 'max' => 4];
    return [(int) $s['min'], (int) $s['max']];
}

/** Saves a new engine state, bumps the version and records whose move it is. Call inside the transaction. */
function dk_save_state(array $g, array $S): int
{
    global $DB;
    $next = toAct($S);
    $status = $S['over'] ? 'finished' : 'playing';
    $DB->run(
        'UPDATE dk_games SET state = ?, status = ?, state_version = state_version + 1, to_act_seat = ?, updated_at = ' . $DB->now()
            . ($S['over'] ? ', finished_at = ' . $DB->now() : '') . ' WHERE game_id = ?',
        [dk_encode($S), $status, $next ? $next['seat'] : null, $g['game_id']]
    );
    return $g['state_version'] + 1;
}

/** Bumps the version after a lobby change. Call inside the transaction. */
function dk_touch(array $g): int
{
    global $DB;
    $DB->run('UPDATE dk_games SET state_version = state_version + 1, updated_at = ' . $DB->now() . ' WHERE game_id = ?', [$g['game_id']]);
    return $g['state_version'] + 1;
}

/** Lobby and seat information every participant sees. */
function dk_game_info(array $g, array $seats, ?int $mySeat): array
{
    [$min, $max] = dk_seat_limits($g);
    $hostSeat = dk_seat_of($seats, $g['host_user_id']);
    return [
        'game_id' => $g['game_id'],
        'join_code' => $g['join_code'],
        'status' => $g['status'],
        'length' => $g['length'],
        'deck_id' => $g['deck_id'],
        'version' => $g['state_version'],
        'you' => $mySeat,
        'host_seat' => $hostSeat,
        'is_host' => $mySeat !== null && $mySeat === $hostSeat,
        'seats' => array_map(static fn($s) => ['seat' => $s['seat'], 'name' => $s['name'], 'is_bot' => $s['is_bot']], $seats),
        'min_seats' => $min,
        'max_seats' => $max,
        'to_act' => $g['to_act_seat'] === null ? null : (int) $g['to_act_seat'],
    ];
}

/** A participant's game: [game row, seats, my seat]. 403 for anyone not seated (unless allowed). */
function dk_participant(array $user, int $gameId, bool $lock = false): array
{
    $g = dk_game($gameId, $lock);
    $seats = dk_seats($gameId);
    $mine = dk_seat_of($seats, $user['user_id']);
    if ($mine === null) {
        if ($lock) {
            global $DB;
            $DB->rollback();
        }
        dk_error('You are not in this game.', 403);
    }
    return [$g, $seats, $mine];
}

/** The view for one seat, with the log optionally trimmed to entries from index $logFrom on. */
function dk_view_for(array $g, array $S, int $seat, int $logFrom = 0): array
{
    $v = HistDeck\view($S, dk_rules($g), $seat);
    $v['logFrom'] = min($logFrom, count($v['log']));
    $v['log'] = array_slice($v['log'], $v['logFrom']);
    return $v;
}
