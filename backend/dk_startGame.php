<?php
// POST { game_id } -> { ok, game, view }. Host only. Snapshots the rules, deals with a fresh random seed,
// and lets any bots draft until a human has to choose.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

use function HistDeck\{makeRules, newGame, advanceBots};

dk_require_method('POST');
$u = dk_require_user();
$DB->begin();
[$g, $seats, $mine] = dk_participant($u, dk_int_param('game_id'), true);
if ($g['host_user_id'] !== $u['user_id']) {
    dk_abort('Only the host can start the game.', 403);
}
if ($g['status'] !== 'lobby') {
    dk_abort('The game has already started.', 409);
}
[$min, $max] = dk_seat_limits($g);
if (count($seats) < $min || count($seats) > $max) {
    dk_abort("A game needs $min to $max players, bots included.", 409);
}
$data = dk_current_data($g['deck_id']);
$R = makeRules($data);
$players = array_map(static fn($s) => ['name' => $s['name'], 'bot' => $s['is_bot']], $seats);
$S = newGame($R, $players, $g['length'], random_int(1, 2147483647));
$S = advanceBots($S, $R)['state'];
$g['rules'] = dk_encode($data);
$DB->run('UPDATE dk_games SET rules = ?, started_at = ' . $DB->now() . ' WHERE game_id = ?', [$g['rules'], $g['game_id']]);
dk_save_state($g, $S);
$DB->commit();
$g = dk_game($g['game_id']);
dk_json(['ok' => true, 'game' => dk_game_info($g, $seats, $mine), 'view' => dk_view_for($g, $S, $mine)]);
