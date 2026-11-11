<?php
/**
 * auth.php — sign-in against Board's accounts (users, user_sessions in $ACC), with one shared cookie.
 *
 * A session is a row in Board's user_sessions table: a 64-hex token, 30 days, exactly as Board issues them,
 * so a token from either site is valid on both. The token travels either as Board's
 * "Authorization: Bearer <token>" header or as the th_session cookie, set for the whole .thehistorians.org
 * domain so that one sign-in covers every game that reads it.
 *
 * Because a browser attaches cookies by itself, a POST authenticated by the cookie must prove it came from
 * one of our pages: it must be JSON (an HTML form cannot send that cross-site without a CORS preflight) and
 * its Origin, when present, must be this host or an https host ending in DK_ALLOWED_ORIGIN_SUFFIX.
 */
declare(strict_types=1);

const DK_COOKIE = 'th_session';
const DK_SESSION_DAYS = 30;           // as Board's USERS_SESSION_TTL_DAYS
const DK_THROTTLE_MAX_FAILURES = 10;  // as Board's USERS_THROTTLE_MAX_FAILURES
const DK_THROTTLE_MINUTES = 15;       // as Board's USERS_THROTTLE_LOCKOUT_MINUTES

/** ['token' => hex, 'via' => 'bearer'|'cookie'] or null. */
function dk_request_token(): ?array
{
    $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (preg_match('/^Bearer\s+([A-Fa-f0-9]{64})$/', (string) $hdr, $m)) {
        return ['token' => strtolower($m[1]), 'via' => 'bearer'];
    }
    $c = $_COOKIE[DK_COOKIE] ?? '';
    if (is_string($c) && preg_match('/^[A-Fa-f0-9]{64}$/', $c)) {
        return ['token' => strtolower($c), 'via' => 'cookie'];
    }
    return null;
}

/** The signed-in user (['user_id', 'username', 'is_admin', 'session_id', 'via']) or null. */
function dk_current_user(): ?array
{
    global $ACC;
    static $cached = false;
    if ($cached !== false) {
        return $cached;
    }
    $t = dk_request_token();
    if (!$t) {
        return $cached = null;
    }
    $row = $ACC->one(
        'SELECT s.session_id, s.user_id, u.username, u.is_admin
           FROM user_sessions s JOIN users u ON u.user_id = s.user_id
          WHERE s.token = ? AND s.expires_at > ' . $ACC->now() . ' AND u.is_disabled = 0',
        [$t['token']]
    );
    if (!$row) {
        return $cached = null;
    }
    $ACC->run('UPDATE user_sessions SET last_used_at = ' . $ACC->now() . ' WHERE session_id = ?', [(int) $row['session_id']]);
    return $cached = [
        'user_id' => (int) $row['user_id'],
        'username' => (string) $row['username'],
        'is_admin' => (bool) $row['is_admin'],
        'session_id' => (int) $row['session_id'],
        'via' => $t['via'],
    ];
}

/** The signed-in user, or a 401. Cookie-authenticated POSTs must also pass the same-site check. */
function dk_require_user(): array
{
    $u = dk_current_user();
    if (!$u) {
        dk_error('Not signed in.', 401, ['accountsSite' => DK_ACCOUNTS_SITE]);
    }
    if ($u['via'] === 'cookie' && ($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        dk_require_same_site();
    }
    return $u;
}

function dk_require_same_site(): void
{
    $type = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''));
    if (!str_starts_with($type, 'application/json')) {
        dk_error('Requests must be sent as JSON.', 415);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    if ($origin === null || $origin === '') {
        return;
    }
    $host = parse_url($origin, PHP_URL_HOST);
    $scheme = parse_url($origin, PHP_URL_SCHEME);
    $ownHost = strtolower(explode(':', (string) ($_SERVER['HTTP_HOST'] ?? ''))[0]);
    $ok = is_string($host) && (
        strtolower($host) === $ownHost
        || ($scheme === 'https' && DK_ALLOWED_ORIGIN_SUFFIX !== '' && str_ends_with(strtolower($host), strtolower(DK_ALLOWED_ORIGIN_SUFFIX)))
    );
    if (!$ok) {
        dk_error('Requests from that site are not accepted.', 403);
    }
}

function dk_set_session_cookie(string $token, int $days): void
{
    setcookie(DK_COOKIE, $token, [
        'expires' => $days > 0 ? time() + $days * 86400 : time() - 3600,
        'path' => '/',
        'domain' => DK_COOKIE_DOMAIN,
        'secure' => DK_COOKIE_SECURE,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** Checks a username and password against Board's users table, with Board's lockout rules. */
function dk_login(string $username, string $password): array
{
    global $ACC;
    $row = $ACC->one(
        'SELECT user_id, username, password_hash, is_disabled, is_admin, failed_logins,
                (login_blocked_until IS NOT NULL AND login_blocked_until > ' . $ACC->now() . ') AS blocked
           FROM users WHERE username_lower = ?',
        [strtolower($username)]
    );
    if (!$row) {
        // Spend about as long as a real check, so timing does not reveal which usernames exist.
        password_verify($password, '$2y$10$ABCDEFGHIJKLMNOPQRSTUuJ8a/x.l8aHk2BCRrtsg7nIa0WnVqu7m');
        dk_error('Invalid username or password.', 401);
    }
    $id = (int) $row['user_id'];
    if ((int) $row['is_disabled'] === 1) {
        dk_error('This account is disabled.', 403);
    }
    if ((int) $row['blocked'] === 1) {
        dk_error('Too many failed attempts. Try again in a few minutes.', 429);
    }
    if (!password_verify($password, (string) $row['password_hash'])) {
        $failed = (int) $row['failed_logins'] + 1;
        if ($failed >= DK_THROTTLE_MAX_FAILURES) {
            $ACC->run('UPDATE users SET failed_logins = ?, login_blocked_until = ' . $ACC->plus(DK_THROTTLE_MINUTES, 'MINUTE') . ' WHERE user_id = ?', [$failed, $id]);
        } else {
            $ACC->run('UPDATE users SET failed_logins = ? WHERE user_id = ?', [$failed, $id]);
        }
        dk_error('Invalid username or password.', 401);
    }
    $ACC->run('UPDATE users SET failed_logins = 0, login_blocked_until = NULL, last_login_at = ' . $ACC->now() . ' WHERE user_id = ?', [$id]);
    $token = bin2hex(random_bytes(32));
    $ACC->run(
        'INSERT INTO user_sessions (user_id, token, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ' . $ACC->plus(DK_SESSION_DAYS, 'DAY') . ')',
        [$id, $token, substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255), substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45)]
    );
    dk_set_session_cookie($token, DK_SESSION_DAYS);
    return ['token' => $token, 'user' => ['user_id' => $id, 'username' => (string) $row['username'], 'is_admin' => (bool) $row['is_admin']]];
}

function dk_logout(array $user): void
{
    global $ACC;
    $ACC->run('DELETE FROM user_sessions WHERE session_id = ?', [$user['session_id']]);
    dk_set_session_cookie('', 0);
}

function dk_public_user(array $u): array
{
    return ['user_id' => $u['user_id'], 'username' => $u['username'], 'is_admin' => $u['is_admin']];
}
