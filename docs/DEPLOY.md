# Going live on projecta.thehistorians.org

Once set up, every push to `main` tests, builds and deploys by itself (`.github/workflows/deploy.yml`). Steps 1
to 4 are done once; step 5 is the check after the first deploy.

## 1. The server

Follow [database/INSTALL.md](../database/INSTALL.md):
- check the PHP version (8.1 or later, with `pdo_mysql`);
- create the game database and run `database/01_dk_games.sql`;
- give a database user access to Board's database;
- write `config.secret.php`.

Put `config.secret.php` in the subdomain's document root (the folder the deploy uploads to; see step 3).

In `config.secret.php`, also set `DK_OPCACHE_TOKEN` to a long random string (at least 16 characters). You'll
use the same value in step 2.

## 2. GitHub secrets

In this repository on GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret | Value |
|---|---|
| `SSH_HOST` | the same as Board's: your GreenGeeks SSH host |
| `SSH_USERNAME` | the same as Board's |
| `SSH_PORT` | the same as Board's |
| `SSH_PRIVATE_KEY` | the same private key Board's deploy uses (or a new key whose public half is added in cPanel → SSH Access) |
| `OPCACHE_TOKEN` | the `DK_OPCACHE_TOKEN` value from step 1 |

Secrets are per repository, so Board's can't be reused automatically; copy the same values in.

Until `SSH_HOST` is set, the deploy job skips itself with a notice instead of failing.

## 3. Where the files go

The deploy uploads to `public_html/projecta.thehistorians.org/` in the SSH account's home, the same pattern
as Board's. If cPanel put the subdomain's document root somewhere else (check **cPanel → Domains**), set a
repository **variable** (Settings → Secrets and variables → Actions → Variables) named `DEPLOY_DIR` to that
path, relative to the home folder.

What gets uploaded is exactly what `node tools/publish.mjs` builds into `publish/`:
- `index.html` and `assets/`: the built app;
- the PHP endpoints and their libraries;
- `.htaccess`: Authorization passthrough, private files blocked, app routes sent to `index.html`, caching;
- `_opcache_reset.php`, `dk_health.php` and `build_info.php`: the build number and commit;
- `engine/` and `data/`, each with a deny-all `.htaccess`.

Uploads never delete files on the server, and never send `config.secret.php`.

## 4. The first deploy

GitHub → **Actions → deploy → Run workflow** (or push to `main`). The run:

1. runs every test, including the PHP checks on PHP 8.1 and 8.3;
2. builds the app and assembles `publish/`;
3. uploads it with rsync over SSH;
4. clears PHP's compiled-code cache and prints the result (expect `"reset":true`);
5. calls `dk_health.php` and fails, with the report in the log, if the server isn't ready.

## 5. Check it

1. Open `https://projecta.thehistorians.org/dk_health.php`. Every check should say `"ok": true`, and `commit`
   should be the commit you deployed. Each failed check says what to fix.
2. Open `https://projecta.thehistorians.org/` and sign in with a Board account.
3. Two-browser smoke test (or one normal window and one private window), signed in as two different Board
   accounts:
   - A creates a game; B joins with the code. A adds a bot and starts.
   - Both draft, then play a few turns: Research, Network, an article. Check that each screen updates within
     about two seconds of the other player's move.
   - Check that neither browser shows the other's hand.
   - Reload mid-game: the game picks up where it was.
4. Check that `https://projecta.thehistorians.org/config.secret.php` and
   `https://projecta.thehistorians.org/lib.php` both answer **403 Forbidden**.

## If something goes wrong

- **The site shows old behaviour after a deploy:** open
  `https://projecta.thehistorians.org/_opcache_reset.php?token=<your token>` once.
- **"Not signed in" right after signing in:** the browser didn't keep the cookie. Check that
  `DK_COOKIE_SECURE` is `true` only on https and that `DK_COOKIE_DOMAIN` is `.thehistorians.org`.
- **"Requests from that site are not accepted":** the page and the PHP must be on the same host, or on an https
  `*.thehistorians.org` host.
- **Any other error:** `dk_health.php` says which part is missing. Errors never show database passwords or
  server paths.
