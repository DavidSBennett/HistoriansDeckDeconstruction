<?php
// Test helper: creates a SQLite database with the test schema and some accounts.
//   php setup_sqlite.php <database file> <users json file>
// users json: [{ "username", "password", "is_admin"?, "is_disabled"? }]
declare(strict_types=1);

[$_, $dbFile, $usersFile] = $argv;
@unlink($dbFile);
$db = new PDO('sqlite:' . $dbFile, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec(file_get_contents(__DIR__ . '/schema.sqlite.sql'));
$st = $db->prepare('INSERT INTO users (username, username_lower, password_hash, email, is_admin, is_disabled) VALUES (?, ?, ?, ?, ?, ?)');
foreach (json_decode(file_get_contents($usersFile), true, 512, JSON_THROW_ON_ERROR) as $u) {
    $st->execute([
        $u['username'], strtolower($u['username']), password_hash($u['password'], PASSWORD_DEFAULT),
        strtolower($u['username']) . '@example.test', (int) ($u['is_admin'] ?? 0), (int) ($u['is_disabled'] ?? 0),
    ]);
}
echo "ok\n";
