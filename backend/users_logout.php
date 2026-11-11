<?php
// POST -> { ok }. Ends this session (on every site that shares it) and clears the cookie.
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('POST');
$u = dk_require_user();
dk_logout($u);
dk_json(['ok' => true]);
