// Assembles publish/: exactly the folder that is uploaded to projecta.thehistorians.org's document root.
//   node tools/publish.mjs [--skip-build] [--build-number N] [--commit SHA]
//
//   publish/
//     index.html, assets/        the built React app (frontend/dist)
//     *.php                      backend endpoints and their libraries (backend/*.php)
//     .htaccess                  deploy/htaccess: Authorization passthrough, private files, SPA routes, caching
//     _opcache_reset.php         deploy/_opcache_reset.php (token in config.secret.php)
//     build_info.php             written here: build number and commit
//     engine/                    engine/php without tests, plus a deny-all .htaccess
//     data/                      data/ (rules and decks, without images), plus a deny-all .htaccess
//     decks/<id>/images/         card pictures from data/decks/<id>/images (public)
//
// Never included: config.secret.php (lives only on the server), backend/tests, node_modules.
import fs from "node:fs";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes("--" + n) ? argv[argv.indexOf("--" + n) + 1] : d);
const OUT = path.join(ROOT, "publish");
const DENY = "# Only PHP's own includes read these files.\nRequire all denied\n";

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(e.name, from)) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b, skip);
    else fs.copyFileSync(a, b);
  }
}

if (!argv.includes("--skip-build")) {
  execSync("npm run build --prefix frontend", { cwd: ROOT, stdio: "inherit" });
}
const dist = path.join(ROOT, "frontend", "dist");
if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("frontend/dist is missing: build the frontend first.");

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(dist, OUT);

for (const f of fs.readdirSync(path.join(ROOT, "backend"))) {
  if (f.endsWith(".php") && !f.startsWith("config.secret")) fs.copyFileSync(path.join(ROOT, "backend", f), path.join(OUT, f));
}
fs.copyFileSync(path.join(ROOT, "deploy", "htaccess"), path.join(OUT, ".htaccess"));
fs.copyFileSync(path.join(ROOT, "deploy", "_opcache_reset.php"), path.join(OUT, "_opcache_reset.php"));

copyDir(path.join(ROOT, "engine", "php"), path.join(OUT, "engine"), (name) => name === "tests");
fs.writeFileSync(path.join(OUT, "engine", ".htaccess"), DENY);
copyDir(path.join(ROOT, "data"), path.join(OUT, "data"), (name) => name === "images");
fs.writeFileSync(path.join(OUT, "data", ".htaccess"), DENY);
// Card pictures are public: data/decks/<id>/images -> decks/<id>/images (the client asks for /decks/...).
for (const id of fs.readdirSync(path.join(ROOT, "data", "decks"))) {
  const imgs = path.join(ROOT, "data", "decks", id, "images");
  if (fs.existsSync(imgs)) copyDir(imgs, path.join(OUT, "decks", id, "images"));
}

let commit = opt("commit", "");
if (!commit) {
  try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(); } catch { commit = "unknown"; }
}
const build = opt("build-number", "local");
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "");
fs.writeFileSync(path.join(OUT, "build_info.php"), `<?php
// Written by tools/publish.mjs at deploy time; never committed.
define('DK_BUILD_NUMBER', '${safe(build)}');
define('DK_BUILD_COMMIT', '${safe(commit).slice(0, 12)}');
define('DK_BUILD_TIME', '${new Date().toISOString().slice(0, 19)}Z');
`);

let files = 0, bytes = 0;
(function count(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) count(p); else { files++; bytes += fs.statSync(p).size; }
  }
})(OUT);
console.log(`publish/ ready: ${files} files, ${(bytes / 1024).toFixed(0)} KB, build ${build}, commit ${commit}`);
