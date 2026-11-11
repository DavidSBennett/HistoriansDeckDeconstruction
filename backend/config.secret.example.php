<?php
/**
 * config.secret.example.php — TEMPLATE ONLY.
 *
 * On the server, copy this file to config.secret.php in the same folder and fill in the real values.
 * config.secret.php is git-ignored and excluded from every deploy, so credentials stay on the host.
 * See database/INSTALL.md.
 */

// ----- This game's database (dk_games, dk_seats) -----
define('DK_DB_DSN', 'mysql:host=localhost;dbname=CPANELUSER_projecta;charset=utf8mb4');
define('DK_DB_USER', 'CPANELUSER_projecta');
define('DK_DB_PASS', 'change-me');

// ----- Accounts: Board's database (users, user_sessions) -----
// Same accounts as board.thehistorians.org. In cPanel > MySQL Databases, add a user to Board's database with
// SELECT, INSERT, UPDATE and DELETE (it reads users, updates the login-throttle columns, and creates and
// deletes rows in user_sessions). It can be Board's own user or projecta's. Leave these three out to keep
// the accounts tables in projecta's own database instead.
define('DK_ACCOUNTS_DSN', 'mysql:host=localhost;dbname=CPANELUSER_board;charset=utf8mb4');
define('DK_ACCOUNTS_USER', 'CPANELUSER_projecta');
define('DK_ACCOUNTS_PASS', 'change-me');

// ----- Shared sign-in cookie -----
// One sign-in for every *.thehistorians.org game that reads this cookie.
define('DK_COOKIE_DOMAIN', '.thehistorians.org');
define('DK_COOKIE_SECURE', true);
// Pages allowed to send cookie-authenticated POSTs: this host, plus any https host ending in this suffix.
define('DK_ALLOWED_ORIGIN_SUFFIX', '.thehistorians.org');

// ----- Where players register and reset passwords (Board owns accounts) -----
define('DK_ACCOUNTS_SITE', 'https://board.thehistorians.org');
