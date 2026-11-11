<?php
// GET ?game_id=N -> { ok, rules }: the data this game runs under (its snapshot once started), so the client
// always shows the right card text and numbers, even after a rebalance. The same for the whole game.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('GET');
$u = dk_require_user();
[$g] = dk_participant($u, dk_int_param('game_id', true));
dk_json(['ok' => true, 'rules' => dk_rules_data($g)]);
