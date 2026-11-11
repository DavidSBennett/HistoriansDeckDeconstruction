<?php
// POST { join_code } -> { ok, game }. Takes the next seat in a lobby; joining twice is harmless.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('POST');
$u = dk_require_user();
$code = dk_normalize_code(dk_body()->join_code ?? null);
$row = $code === '' ? null : $DB->one('SELECT game_id FROM dk_games WHERE join_code = ?', [$code]);
if (!$row) {
    dk_error('No game has that code.', 404);
}
$DB->begin();
$g = dk_game((int) $row['game_id'], true);
$seats = dk_seats($g['game_id']);
$mine = dk_seat_of($seats, $u['user_id']);
if ($mine === null) {
    if ($g['status'] !== 'lobby') {
        dk_abort('That game has already started.', 409);
    }
    [, $max] = dk_seat_limits($g);
    if (count($seats) >= $max) {
        dk_abort('That game is full.', 409);
    }
    $mine = count($seats);
    $DB->run('INSERT INTO dk_seats (game_id, seat, user_id, is_bot, name, joined_at) VALUES (?, ?, ?, 0, ?, ' . $DB->now() . ')', [$g['game_id'], $mine, $u['user_id'], $u['username']]);
    dk_touch($g);
}
$DB->commit();
dk_json(['ok' => true, 'game' => dk_game_info(dk_game($g['game_id']), dk_seats($g['game_id']), $mine)]);
