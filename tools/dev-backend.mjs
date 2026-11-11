// Runs the PHP backend locally for development: PHP's built-in server on the real backend/ folder, with a
// SQLite database in build/dev/ and demo accounts. The Vite dev server (frontend/) proxies *.php here.
//   node tools/dev-backend.mjs [--port 8080] [--reset]
// Demo accounts: alice / alice-dev, bob / bob-dev, carol / carol-dev.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const port = argv.includes("--port") ? argv[argv.indexOf("--port") + 1] : "8080";
const dir = path.join(ROOT, "build", "dev");
const db = path.join(dir, "dev.sqlite");
fs.mkdirSync(dir, { recursive: true });

const mods = execFileSync("php", ["-m"], { encoding: "utf8" }).toLowerCase().split(/\r?\n/);
const phpArgs = mods.includes("pdo_sqlite") ? [] : ["-d", "extension=pdo_sqlite"];

if (argv.includes("--reset") || !fs.existsSync(db)) {
  const users = ["alice", "bob", "carol"].map((u) => ({ username: u, password: u + "-dev" }));
  fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify(users));
  execFileSync("php", [...phpArgs, path.join(ROOT, "backend/tests/setup_sqlite.php"), db, path.join(dir, "users.json")]);
  console.log("Created " + path.relative(ROOT, db) + " with alice, bob and carol (password: <name>-dev).");
}
const cfg = path.join(dir, "config.php");
fs.writeFileSync(cfg, `<?php
define('DK_DB_DSN', ${JSON.stringify("sqlite:" + db)});
define('DK_COOKIE_DOMAIN', '');
define('DK_COOKIE_SECURE', false);
define('DK_ALLOWED_ORIGIN_SUFFIX', '');
define('DK_ACCOUNTS_SITE', 'https://board.thehistorians.org');
`);

console.log(`PHP backend on http://127.0.0.1:${port}`);
const php = spawn("php", [...phpArgs, "-S", `127.0.0.1:${port}`, "-t", path.join(ROOT, "backend")], {
  env: { ...process.env, DK_CONFIG: cfg },
  stdio: "inherit",
});
php.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => php.kill());
