<?php
// POST { length? } -> { ok, game }. Creates a lobby with the caller in seat 0 as host.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('POST');
$u = dk_require_user();
$length = dk_body()->length ?? 'medium';
if (!in_array($length, DK_LENGTHS, true)) {
    dk_error('Choose short, medium or long.');
}
$DB->begin();
$DB->run(
    'INSERT INTO dk_games (join_code, host_user_id, status, length, deck_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ' . $DB->now() . ', ' . $DB->now() . ')',
    [dk_new_join_code(), $u['user_id'], 'lobby', $length, 'ai-history']
);
$id = $DB->lastId();
$DB->run('INSERT INTO dk_seats (game_id, seat, user_id, is_bot, name, joined_at) VALUES (?, 0, ?, 0, ?, ' . $DB->now() . ')', [$id, $u['user_id'], $u['username']]);
$DB->commit();
dk_json(['ok' => true, 'game' => dk_game_info(dk_game($id), dk_seats($id), 0)]);
