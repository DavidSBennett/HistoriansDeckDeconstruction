<?php
/**
 * GET -> is this install ready? Checks the PHP version and extensions, config.secret.php, both database
 * connections and the tables each needs, and reports the deployed build. Used after every deploy and when
 * setting up the server. Says what is wrong in plain words but never shows credentials or server paths.
 * Status 200 when everything is ready, 503 otherwise.
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$checks = [];
$ok = true;
$add = static function (string $name, bool $pass, string $detail) use (&$checks, &$ok): void {
    $checks[$name] = ['ok' => $pass, 'detail' => $detail];
    $ok = $ok && $pass;
};

$add('php', version_compare(PHP_VERSION, '8.1.0', '>='), 'PHP ' . PHP_VERSION . ' (8.1 or later needed)');
$add('pdo_mysql', extension_loaded('pdo_mysql') || extension_loaded('pdo_sqlite'),
    extension_loaded('pdo_mysql') ? 'loaded' : (extension_loaded('pdo_sqlite') ? 'off, but pdo_sqlite is loaded (fine for local testing only)' : 'the pdo_mysql extension is off: turn it on in cPanel > Select PHP Version'));

$cfg = getenv('DK_CONFIG') ?: __DIR__ . '/config.secret.php';
$configured = is_file($cfg);
$add('config', $configured, $configured ? 'config.secret.php found' : 'config.secret.php is missing (see database/INSTALL.md)');

$engine = file_exists(__DIR__ . '/engine/engine_all.php') || file_exists(__DIR__ . '/../engine/php/engine_all.php');
$data = file_exists(__DIR__ . '/data/config.json') || file_exists(__DIR__ . '/../data/config.json');
$add('engine', $engine && $data, $engine && $data ? 'engine and data files present' : 'engine/ or data/ is missing from the upload');

$probe = static function (string $label, string $dsn, ?string $user, ?string $pass, array $tables) use ($add): void {
    try {
        $pdo = new PDO($dsn, $user, $pass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_TIMEOUT => 5]);
    } catch (Throwable $e) {
        $add($label . '_db', false, 'cannot connect: check the DSN, user and password for this database, and that the user is added to it in cPanel');
        return;
    }
    $add($label . '_db', true, 'connected');
    $missing = [];
    foreach ($tables as $t) {
        try {
            $pdo->query("SELECT 1 FROM $t LIMIT 1");
        } catch (Throwable $e) {
            $missing[] = $t;
        }
    }
    $add($label . '_tables', !$missing, $missing ? 'missing or not readable: ' . implode(', ', $missing) : implode(', ', $tables) . ' readable');
};

if ($configured) {
    require_once $cfg;
    if (defined('DK_DB_DSN')) {
        $probe('game', DK_DB_DSN, defined('DK_DB_USER') ? DK_DB_USER : null, defined('DK_DB_PASS') ? DK_DB_PASS : null, ['dk_games', 'dk_seats']);
    } else {
        $add('game_db', false, 'DK_DB_DSN is not set in config.secret.php');
    }
    if (defined('DK_ACCOUNTS_DSN')) {
        $probe('accounts', DK_ACCOUNTS_DSN, defined('DK_ACCOUNTS_USER') ? DK_ACCOUNTS_USER : null, defined('DK_ACCOUNTS_PASS') ? DK_ACCOUNTS_PASS : null, ['users', 'user_sessions']);
    } elseif (defined('DK_DB_DSN')) {
        $probe('accounts', DK_DB_DSN, defined('DK_DB_USER') ? DK_DB_USER : null, defined('DK_DB_PASS') ? DK_DB_PASS : null, ['users', 'user_sessions']);
    }
    foreach (['DK_COOKIE_DOMAIN', 'DK_COOKIE_SECURE', 'DK_ALLOWED_ORIGIN_SUFFIX', 'DK_ACCOUNTS_SITE'] as $c) {
        if (!defined($c)) {
            $add('config', false, "$c is not set in config.secret.php");
        }
    }
}

if (is_file(__DIR__ . '/build_info.php')) {
    require_once __DIR__ . '/build_info.php';
}
http_response_code($ok ? 200 : 503);
echo json_encode([
    'ok' => $ok,
    'build' => defined('DK_BUILD_NUMBER') ? DK_BUILD_NUMBER : null,
    'commit' => defined('DK_BUILD_COMMIT') ? DK_BUILD_COMMIT : null,
    'built_at' => defined('DK_BUILD_TIME') ? DK_BUILD_TIME : null,
    'checks' => $checks,
], JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
