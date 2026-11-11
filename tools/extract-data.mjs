// One-off migration of the mock-up's constants into data/*.json.
//   node tools/extract-data.mjs          write the files
//   node tools/extract-data.mjs --check  report whether data/ still matches the mock-up (exit 1 if not)
// Once you start rebalancing in data/, --check will (correctly) report differences: the parity tests
// run the engine with the mock-up's own constants, not with data/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadMockup } from "./lib/load-mockup.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DECK_ID = "ai-history";

export function buildDataFiles(mock = loadMockup()) {
  const { DATA, CONFIG, ACTIONS, BASE, TRASH, BONUS } = mock.consts;
  const plain = (x) => JSON.parse(JSON.stringify(x)); // drop vm-realm prototypes

  // Thesis colours live in the mock-up's CSS as --A, --B, ...; move them into the deck.
  const colors = {};
  for (const m of mock.html.matchAll(/--([A-Z]):(#[0-9a-fA-F]{3,8})/g)) colors[m[1]] = m[2];
  const theses = {};
  for (const [L, t] of Object.entries(plain(DATA.theses))) {
    if (!colors[L]) throw new Error("No CSS colour found for thesis " + L);
    theses[L] = { ...t, color: colors[L] };
  }

  return {
    "data/config.json": {
      ...plain(CONFIG),
      startingActions: plain(BASE), // was the BASE array
      seats: { min: 2, max: 4 }, // was hard-coded in the mock-up's setup screen
    },
    "data/actions.json": plain(ACTIONS),
    "data/bonuses.json": plain(BONUS),
    "data/trash.json": plain(TRASH),
    [`data/decks/${DECK_ID}/deck.json`]: {
      id: DECK_ID,
      name: "AI History",
      theses,
      cards: plain(DATA.cards),
    },
  };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + "\n";

function main() {
  const check = process.argv.includes("--check");
  const files = buildDataFiles();
  let drift = 0;
  for (const [rel, obj] of Object.entries(files)) {
    const file = path.join(ROOT, rel);
    const text = serialize(obj);
    if (check) {
      const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
      const same = cur === text;
      if (!same) drift++;
      console.log((same ? "same     " : "DIFFERENT") + "  " + rel);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      console.log("wrote " + rel);
    }
  }
  if (check && drift) {
    console.log(drift + " file(s) differ from the mock-up.");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
