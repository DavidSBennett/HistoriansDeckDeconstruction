<?php
// GET -> { ok, user, accountsSite } for the signed-in player, or 401 { error, accountsSite }.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('GET');
$u = dk_require_user();
dk_json(['ok' => true, 'user' => dk_public_user($u), 'accountsSite' => DK_ACCOUNTS_SITE]);
