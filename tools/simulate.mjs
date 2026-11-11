// Plays bot-only games with the ported engine and the rules in data/: the tool for balancing.
//   node tools/simulate.mjs [--games 1000] [--length medium] [--seats 2,3,4] [--first-seed 1] [--deck ai-history]
// Seeds run first-seed .. first-seed+games-1, so a change to data/ can be compared like for like.
import { makeRules, newGame, playBotGame, ranking } from "../engine/js/index.mjs";
import { loadData, validateData } from "./validate-data.mjs";
import { makeStats, addGame, report } from "./lib/stats.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const games = +arg("games", 1000);
const length = arg("length", "medium");
const seatCounts = arg("seats", "2,3,4").split(",").map(Number);
const firstSeed = +arg("first-seed", 1);
const deckId = arg("deck", "ai-history");

const data = loadData(deckId);
const { errors } = validateData(data);
if (errors.length) {
  console.error("data/ has errors; run npm run data:validate\n  " + errors.join("\n  "));
  process.exit(1);
}
const R = makeRules(data);

const t0 = Date.now();
for (const seats of seatCounts) {
  const st = makeStats(seats);
  for (let g = 0; g < games; g++) {
    const S = newGame(R, Array.from({ length: seats }, (_, i) => ({ name: "Bot " + (i + 1), bot: true })), length, firstSeed + g);
    playBotGame(S, R);
    addGame(st, ranking(S));
  }
  console.log(report(st, `${seats} players, ${length}, ${games} games (engine, deck ${deckId})`));
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
