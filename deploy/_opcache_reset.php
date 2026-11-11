<?php
/**
 * _opcache_reset.php — clears PHP's compiled-code cache after a deploy, so new PHP files take effect at once
 * (GreenGeeks can keep running the old compiled code otherwise). The deploy workflow calls it; you can also
 * open it in a browser:  https://projecta.thehistorians.org/_opcache_reset.php?token=<DK_OPCACHE_TOKEN>
 *
 * The token is DK_OPCACHE_TOKEN in config.secret.php on the server and the OPCACHE_TOKEN secret in GitHub.
 * Unlike Board's, it is never written into the repository.
 */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$cfg = __DIR__ . '/config.secret.php';
if (is_file($cfg)) {
    require_once $cfg;
}
$expected = defined('DK_OPCACHE_TOKEN') ? (string) DK_OPCACHE_TOKEN : '';
$given = isset($_GET['token']) ? (string) $_GET['token'] : '';
if ($expected === '' || strlen($expected) < 16 || !hash_equals($expected, $given)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => $expected === '' ? 'DK_OPCACHE_TOKEN is not set in config.secret.php' : 'forbidden']);
    exit;
}

$available = function_exists('opcache_reset');
$status = function_exists('opcache_get_status') ? @opcache_get_status(false) : null;
$reset = $available ? @opcache_reset() : false;
if (is_file(__DIR__ . '/build_info.php')) {
    require_once __DIR__ . '/build_info.php';
}
echo json_encode([
    'ok' => true,
    'opcache_available' => $available,
    'opcache_enabled' => is_array($status) ? ($status['opcache_enabled'] ?? null) : null,
    'reset' => $reset,
    'build' => defined('DK_BUILD_NUMBER') ? DK_BUILD_NUMBER : null,
    'commit' => defined('DK_BUILD_COMMIT') ? DK_BUILD_COMMIT : null,
], JSON_UNESCAPED_SLASHES);
