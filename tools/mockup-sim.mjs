// Plays bot-only games with the mock-up's own logic (not the ported engine), for reference numbers.
//   node tools/mockup-sim.mjs [--games 1000] [--length medium] [--seats 2,3,4] [--first-seed 1]
// Seeds run first-seed .. first-seed+games-1, so results are repeatable. Compare with tools/simulate.mjs.
import { loadMockup } from "./lib/load-mockup.mjs";
import { makeStats, addGame, report } from "./lib/stats.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const games = +arg("games", 1000);
const length = arg("length", "medium");
const seatCounts = arg("seats", "2,3,4").split(",").map(Number);
const firstSeed = +arg("first-seed", 1);

const { api: M } = loadMockup();

for (const seats of seatCounts) {
  const st = makeStats(seats);
  for (let g = 0; g < games; g++) {
    M.newGame(Array.from({ length: seats }, (_, i) => ({ name: "Bot " + (i + 1), bot: true })), length, firstSeed + g);
    const S = M.S;
    while (S.phase === "draft") M.botDraft();
    while (!S.over) {
      let steps = 0;
      while (M.botStep()) if (++steps > 500) throw new Error("bot loop did not stop, seed " + (firstSeed + g));
      M.endTurn(M.botKeep());
    }
    addGame(st, M.ranking());
  }
  console.log(report(st, `${seats} players, ${length}, ${games} games (mock-up logic)`));
}
