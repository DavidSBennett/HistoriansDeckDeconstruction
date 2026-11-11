<?php
// GET -> { ok, games: [...] }: the caller's games, most recently active first, with whose move it is.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('GET');
$u = dk_require_user();
$rows = $DB->all(
    "SELECT g.* FROM dk_games g JOIN dk_seats s ON s.game_id = g.game_id
      WHERE s.user_id = ? AND g.status <> 'cancelled' ORDER BY g.updated_at DESC, g.game_id DESC LIMIT 30",
    [$u['user_id']]
);
$out = [];
foreach ($rows as $g) {
    $g['game_id'] = (int) $g['game_id'];
    $g['host_user_id'] = (int) $g['host_user_id'];
    $g['state_version'] = (int) $g['state_version'];
    $seats = dk_seats($g['game_id']);
    $info = dk_game_info($g, $seats, dk_seat_of($seats, $u['user_id']));
    $info['your_move'] = $g['status'] === 'playing' && $info['to_act'] === $info['you'];
    $info['updated_at'] = $g['updated_at'];
    $out[] = $info;
}
dk_json(['ok' => true, 'games' => $out]);
