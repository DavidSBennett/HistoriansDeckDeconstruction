<?php
// POST { game_id, version, action, log_from? } -> { ok, version, events, view }.
// `action` is one protocol message (see engine/js/protocol.mjs). `version` must be the version the player
// last saw, so a double click or a stale screen cannot send a move twice. After the move, bots play until a
// human has to act; `events` is everything that happened, as this player may see it.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

use function HistDeck\{apply, advanceBots, redactEvent};

dk_require_method('POST');
$u = dk_require_user();
$b = dk_body();
$version = dk_int_param('version');
$logFrom = isset($b->log_from) ? dk_int_param('log_from') : 0;
$action = $b->action ?? null;
$DB->begin();
[$g, $seats, $mine] = dk_participant($u, dk_int_param('game_id'), true);
if ($g['status'] !== 'playing') {
    dk_abort($g['status'] === 'finished' ? 'The game is over.' : 'The game has not started.', 409);
}
if ($version !== $g['state_version']) {
    dk_abort('The game has moved on since your last update.', 409, ['version' => $g['state_version']]);
}
$R = dk_rules($g);
$S = json_decode($g['state'], true, 512, JSON_THROW_ON_ERROR);
$r = apply($S, $R, $mine, $action);
if (isset($r['error'])) {
    dk_abort($r['error'], 400);
}
$adv = advanceBots($r['state'], $R);
$S = $adv['state'];
$newVersion = dk_save_state($g, $S);
$DB->commit();
$events = array_map(static fn($e) => redactEvent($e, $mine), array_merge($r['events'], $adv['events']));
dk_json(['ok' => true, 'version' => $newVersion, 'events' => $events, 'view' => dk_view_for($g, $S, $mine, $logFrom)]);
