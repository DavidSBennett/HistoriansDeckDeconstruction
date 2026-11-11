// Full parity run: the JS engine against the mock-up, step by step.
//   node tools/parity.mjs [--games 1000] [--fuzz 300] [--lengths short,medium,long] [--seats 2,3,4]
//                         [--first-seed 1] [--final-only]
// --games: bot games per seat count and length; --fuzz: fuzz games per seat count and length.
// --final-only compares only the final state of bot games (much faster); fuzz games are always checked per step.
import { loadMockup, mockupRules, botGame, fuzzGame } from "./lib/parity.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const games = +arg("games", 1000);
const fuzz = +arg("fuzz", 300);
const lengths = arg("lengths", "short,medium,long").split(",");
const seatCounts = arg("seats", "2,3,4").split(",").map(Number);
const firstSeed = +arg("first-seed", 1);
const finalOnly = process.argv.includes("--final-only");

const mock = loadMockup();
const R = mockupRules(mock);
const t0 = Date.now();
let total = 0;
const counts = {};
for (const length of lengths)
  for (const seats of seatCounts) {
    for (let g = 0; g < games; g++) botGame(mock, R, seats, length, firstSeed + g, { checkEvery: !finalOnly });
    for (let g = 0; g < fuzz; g++) {
      const c = fuzzGame(mock, R, seats, length, firstSeed + g);
      for (const k in c) counts[k] = (counts[k] || 0) + c[k];
    }
    total += games + fuzz;
    console.log(`${length}, ${seats} players: ${games} bot games and ${fuzz} fuzz games match`);
  }
console.log(`All ${total} games match the mock-up (${((Date.now() - t0) / 1000).toFixed(1)} s).`);
console.log("Fuzz actions tried (ok / rejected):");
const fns = [...new Set(Object.keys(counts).filter((k) => !k.startsWith("~")).map((k) => k.split(":")[0]))].sort();
for (const f of fns) console.log(`  ${f.padEnd(15)} ${String(counts[f + ":ok"] || 0).padStart(7)} / ${counts[f + ":err"] || 0}`);
console.log("Rare paths reached in fuzz games (times):");
for (const k of Object.keys(counts).filter((k) => k.startsWith("~")).sort()) console.log(`  ${k.slice(1).padEnd(38)} ${counts[k]}`);
