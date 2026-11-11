<?php
/**
 * lib.php — shared plumbing for every endpoint. Not an endpoint: each *.php action file starts with
 *   require_once __DIR__ . '/lib.php';
 *
 * It loads config.secret.php (or the file named by the DK_CONFIG environment variable, used by the tests),
 * the game engine and the data files, opens the two database connections ($DB for games, $ACC for Board's
 * accounts, which may be the same database), and provides JSON responses, sign-in (auth.php) and game
 * helpers (games.php).
 */
declare(strict_types=1);

// Nothing may answer with an empty body: uncaught errors become JSON with a message (no file paths).
set_exception_handler(static function (Throwable $e) {
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode(['error' => 'Server error: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});
register_shutdown_function(static function () {
    $err = error_get_last();
    if (!$err || !in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true) || headers_sent()) {
        return;
    }
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Fatal error: ' . $err['message']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
});

$dkConfig = getenv('DK_CONFIG') ?: __DIR__ . '/config.secret.php';
if (!is_file($dkConfig)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Server not configured: config.secret.php is missing. See database/INSTALL.md.']);
    exit;
}
require_once $dkConfig;

// The engine and data sit next to the backend when deployed, one level up in the repository.
function dk_locate(string $deployed, string $repo): string
{
    return file_exists(__DIR__ . "/$deployed") ? __DIR__ . "/$deployed" : __DIR__ . "/$repo";
}
require_once dk_locate('engine/engine_all.php', '../engine/php/engine_all.php');
define('DK_DATA_DIR', dk_locate('data', '../data'));

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/games.php';

// A failed connection says which database, never the driver's message (it can name the user and host).
function dk_connect(string $which, string $dsn, ?string $user, ?string $pass): DkDb
{
    try {
        return new DkDb($dsn, $user, $pass);
    } catch (PDOException $e) {
        http_response_code(503);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => "The $which database is not reachable right now. If this persists, see dk_health.php."]);
        exit;
    }
}
$DB = dk_connect('game', DK_DB_DSN, defined('DK_DB_USER') ? DK_DB_USER : null, defined('DK_DB_PASS') ? DK_DB_PASS : null);
$ACC = defined('DK_ACCOUNTS_DSN')
    ? dk_connect('accounts', DK_ACCOUNTS_DSN, defined('DK_ACCOUNTS_USER') ? DK_ACCOUNTS_USER : null, defined('DK_ACCOUNTS_PASS') ? DK_ACCOUNTS_PASS : null)
    : $DB;

const DK_JSON = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES;

// ---------------------------------------------------------------------------------------------------------
// Responses and requests
// ---------------------------------------------------------------------------------------------------------

function dk_json($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, DK_JSON | JSON_THROW_ON_ERROR);
    exit;
}

function dk_error(string $message, int $status = 400, array $extra = []): void
{
    dk_json(['error' => $message] + $extra, $status);
}

function dk_require_method(string $method): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        dk_error("This endpoint needs $method.", 405);
    }
}

/**
 * The JSON request body, decoded with objects kept as stdClass (so a game action keeps the difference
 * between {} and [] that the engine's checks rely on). Always a stdClass; anything else is a 400.
 */
function dk_body(): stdClass
{
    static $body = null;
    if ($body !== null) {
        return $body;
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return $body = new stdClass();
    }
    try {
        $data = json_decode($raw, false, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        dk_error('The request is not valid JSON.');
    }
    if (!($data instanceof stdClass)) {
        dk_error('The request must be a JSON object.');
    }
    return $body = $data;
}

/** A positive integer field from the body or the query string, or a 400. */
function dk_int_param(string $name, bool $fromQuery = false): int
{
    $v = $fromQuery ? ($_GET[$name] ?? null) : (dk_body()->$name ?? null);
    if (is_string($v) && ctype_digit($v)) {
        $v = (int) $v;
    }
    if (!is_int($v) || $v < 0) {
        dk_error("\"$name\" must be a whole number.");
    }
    return $v;
}

function dk_encode($x): string
{
    return json_encode($x, DK_JSON | JSON_THROW_ON_ERROR);
}
