<?php
// GET ?game_id=N&since=V&log_from=K -> the poll.
//   { ok, changed: false, version }          when nothing has changed since version V
//   { ok, changed: true, game, view }        otherwise. view is this player's view (null before the start),
//                                            with the log from entry K on (view.logFrom says where it starts)
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('GET');
$u = dk_require_user();
$gameId = dk_int_param('game_id', true);
$g = dk_game($gameId);
$seats = dk_seats($gameId);
$mine = dk_seat_of($seats, $u['user_id']);
if ($mine === null) {
    dk_error('You are not in this game.', 403);
}
$since = isset($_GET['since']) ? dk_int_param('since', true) : -1;
if ($since === $g['state_version']) {
    dk_json(['ok' => true, 'changed' => false, 'version' => $g['state_version']]);
}
$logFrom = isset($_GET['log_from']) ? dk_int_param('log_from', true) : 0;
$view = $g['state'] ? dk_view_for($g, json_decode($g['state'], true, 512, JSON_THROW_ON_ERROR), $mine, $logFrom) : null;
dk_json(['ok' => true, 'changed' => true, 'game' => dk_game_info($g, $seats, $mine), 'view' => $view]);
