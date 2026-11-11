// Loads the mock-up's <script> under Node, without its UI half (which only runs when `document` exists).
// Returns the mock-up's own module.exports, its constants, and the vm context, whose globals include
// every top-level function the mock-up declares (doDraft, doResearch, ...). Used by the data extractor,
// the mock-up simulator and, later, the parity tests.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const MOCKUP_PATH = fileURLToPath(
  new URL("../../reference/The-Historians-Deckbuilder-Mockup.html", import.meta.url)
);

export function readMockup(file = MOCKUP_PATH) {
  const html = fs.readFileSync(file, "utf8");
  const start = html.indexOf("<script>");
  const end = html.lastIndexOf("</script>");
  if (start < 0 || end < start) throw new Error("No <script> block found in " + file);
  return { html, script: html.slice(start + "<script>".length, end) };
}

export function loadMockup(file = MOCKUP_PATH) {
  const { html, script } = readMockup(file);
  // const/let declarations are not visible on the context, so the appended line hands them out.
  const src =
    script +
    "\n;globalThis.__mockup={DATA,CONFIG,ACTIONS,BASE,TRASH,BONUS,LETTERS,UPGRADES};";
  const ctx = { module: { exports: {} }, Date, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: path.basename(file) });
  return { html, api: ctx.module.exports, consts: ctx.__mockup, ctx };
}
