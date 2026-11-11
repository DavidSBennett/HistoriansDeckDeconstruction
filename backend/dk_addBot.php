<?php
// POST { game_id } -> { ok, game }. Host only, in the lobby: fills the next seat with a bot.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('POST');
$u = dk_require_user();
$DB->begin();
[$g, $seats, $mine] = dk_participant($u, dk_int_param('game_id'), true);
if ($g['host_user_id'] !== $u['user_id']) {
    dk_abort('Only the host can add bots.', 403);
}
if ($g['status'] !== 'lobby') {
    dk_abort('The game has already started.', 409);
}
[, $max] = dk_seat_limits($g);
if (count($seats) >= $max) {
    dk_abort('The table is full.', 409);
}
$taken = array_column($seats, 'name');
$name = 'Bot ' . (count($seats) + 1);
foreach (DK_BOT_NAMES as $n) {
    if (!in_array($n, $taken, true)) {
        $name = $n;
        break;
    }
}
$DB->run('INSERT INTO dk_seats (game_id, seat, user_id, is_bot, name, joined_at) VALUES (?, ?, NULL, 1, ?, ' . $DB->now() . ')', [$g['game_id'], count($seats), $name]);
dk_touch($g);
$DB->commit();
dk_json(['ok' => true, 'game' => dk_game_info(dk_game($g['game_id']), dk_seats($g['game_id']), $mine)]);
