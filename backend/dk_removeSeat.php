<?php
// POST { game_id, seat } -> { ok, game } or { ok, cancelled: true }.
// In the lobby: the host removes a bot or a player; a player may remove only their own seat (leaving). If
// the host leaves, the game is cancelled. Seats are renumbered to stay 0..n-1, which the engine uses.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('POST');
$u = dk_require_user();
$seat = dk_int_param('seat');
$DB->begin();
[$g, $seats, $mine] = dk_participant($u, dk_int_param('game_id'), true);
if ($g['status'] !== 'lobby') {
    dk_abort('The game has already started.', 409);
}
$isHost = $g['host_user_id'] === $u['user_id'];
if (!$isHost && $seat !== $mine) {
    dk_abort('Only the host can remove other seats.', 403);
}
if ($seat >= count($seats)) {
    dk_abort('No such seat.', 404);
}
if ($isHost && $seat === $mine) {
    $DB->run('UPDATE dk_games SET status = ?, state_version = state_version + 1, updated_at = ' . $DB->now() . ' WHERE game_id = ?', ['cancelled', $g['game_id']]);
    $DB->commit();
    dk_json(['ok' => true, 'cancelled' => true]);
}
$DB->run('DELETE FROM dk_seats WHERE game_id = ? AND seat = ?', [$g['game_id'], $seat]);
for ($s = $seat + 1; $s < count($seats); $s++) {
    $DB->run('UPDATE dk_seats SET seat = ? WHERE game_id = ? AND seat = ?', [$s - 1, $g['game_id'], $s]);
}
dk_touch($g);
$DB->commit();
$after = dk_seats($g['game_id']);
dk_json(['ok' => true, 'game' => dk_game_info(dk_game($g['game_id']), $after, dk_seat_of($after, $u['user_id']))]);
