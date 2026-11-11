<?php
// POST { game_id, length } -> { ok, game }. Host only, in the lobby.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('POST');
$u = dk_require_user();
$length = dk_body()->length ?? null;
if (!in_array($length, DK_LENGTHS, true)) {
    dk_error('Choose short, medium or long.');
}
$DB->begin();
[$g, $seats, $mine] = dk_participant($u, dk_int_param('game_id'), true);
if ($g['host_user_id'] !== $u['user_id']) {
    dk_abort('Only the host can change the length.', 403);
}
if ($g['status'] !== 'lobby') {
    dk_abort('The game has already started.', 409);
}
$DB->run('UPDATE dk_games SET length = ? WHERE game_id = ?', [$length, $g['game_id']]);
dk_touch($g);
$DB->commit();
dk_json(['ok' => true, 'game' => dk_game_info(dk_game($g['game_id']), $seats, $mine)]);
