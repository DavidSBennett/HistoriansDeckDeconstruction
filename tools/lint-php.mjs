// Runs `php -l` on every PHP file in the repo (outside node_modules and build). Needs php on the PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const skip = new Set(["node_modules", "build", "dist", ".git", "vendor"]);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".php")) files.push(p);
  }
})(ROOT);

let bad = 0;
for (const f of files) {
  try {
    execFileSync("php", ["-l", f], { stdio: "pipe" });
  } catch (e) {
    bad++;
    process.stdout.write(String(e.stdout || e.message));
  }
}
console.log(`${files.length} PHP files checked, ${bad} with syntax errors.`);
process.exit(bad ? 1 : 0);
