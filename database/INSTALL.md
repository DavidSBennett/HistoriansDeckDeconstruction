# Installing the backend on projecta.thehistorians.org

Everything here is done once, by hand, in cPanel. The deploy workflow (build step 8) copies the code. It never
touches the database or `config.secret.php`.

## 1. Check the PHP version

cPanel → **Select PHP Version** (or **MultiPHP Manager**) for projecta.thehistorians.org. It must be
**8.1 or later**, with the `pdo_mysql` extension on (it normally is).

## 2. The game database

1. cPanel → **MySQL Databases** → create a database for this game, for example `CPANELUSER_projecta`.
2. Create a database user, or reuse one, and **Add User To Database** with **ALL PRIVILEGES** on that database.
3. phpMyAdmin → select that database → **SQL** → paste and run `database/01_dk_games.sql`.

Later migrations will be numbered `02_…`, `03_…`. Run each once, in order.

## 3. Access to Board's accounts

Sign-in uses Board's accounts: the `users` and `user_sessions` tables in board.thehistorians.org's database.
No migration is needed there; this game uses Board's tables as they are.

cPanel → **MySQL Databases** → **Add User To Database**: add the user projecta will connect with to **Board's**
database, with only these privileges: **SELECT, INSERT, UPDATE, DELETE**. It reads accounts, updates the
login-throttle columns on `users`, and creates and deletes rows in `user_sessions`.

## 4. config.secret.php

Copy `config.secret.example.php` to `config.secret.php` in the same folder as the backend's PHP files on the
server, and fill in:

- `DK_DB_DSN`, `DK_DB_USER`, `DK_DB_PASS`: the game database from step 2.
- `DK_ACCOUNTS_DSN`, `DK_ACCOUNTS_USER`, `DK_ACCOUNTS_PASS`: Board's database and the user from step 3.
- Leave `DK_COOKIE_DOMAIN` as `.thehistorians.org`, `DK_COOKIE_SECURE` as `true`, and
  `DK_ACCOUNTS_SITE` as `https://board.thehistorians.org`.

The file is git-ignored and excluded from deploys. It is also blocked from being fetched over the web by
`backend/.htaccess`.

## 5. Check it

Open `https://projecta.thehistorians.org/users_me.php`. It should answer
`{"error":"Not signed in.","accountsSite":"https://board.thehistorians.org"}`. Any other error message says
what's wrong, for example a missing config file or a database the user can't reach.

## Single sign-on: what Board needs

The game sets a `th_session` cookie for all of `.thehistorians.org` when someone signs in here, and accepts it
alongside Board's `Authorization: Bearer` header. Until Board does the same, players sign in once on each site
with the same username and password. For one sign-in to cover both, Board needs these changes in its own repo:

- `users_login.php` sets the same cookie: name `th_session`, domain `.thehistorians.org`, path `/`, Secure,
  HttpOnly, SameSite=Lax, 30 days.
- `users_logout.php` clears it.
- `users_optional_session()` accepts the cookie when there is no Bearer header. For cookie-authenticated
  POSTs it also checks that the request is JSON and comes from a `*.thehistorians.org` https page.
