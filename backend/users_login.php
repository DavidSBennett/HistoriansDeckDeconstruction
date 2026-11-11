<?php
// POST { username, password } -> { ok, session_token, user, accountsSite }. Sets the shared th_session cookie.
// Accounts are Board's; registering and resetting passwords happen on Board (accountsSite).
declare(strict_types=1);
require_once __DIR__ . '/lib.php';

dk_require_method('POST');
dk_require_same_site(); // there is no session yet, but the login form must still be one of ours
$b = dk_body();
$username = is_string($b->username ?? null) ? trim($b->username) : '';
$password = is_string($b->password ?? null) ? $b->password : '';
if ($username === '' || $password === '') {
    dk_error('Enter your username and password.');
}
$r = dk_login($username, $password);
dk_json(['ok' => true, 'session_token' => $r['token'], 'user' => $r['user'], 'accountsSite' => DK_ACCOUNTS_SITE]);
