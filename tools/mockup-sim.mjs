// Plays bot-only games with the mock-up's own logic (not the ported engine), for reference numbers.
//   node tools/mockup-sim.mjs [--games 1000] [--length medium] [--seats 2,3,4] [--first-seed 1]
// Seeds run first-seed .. first-seed+games-1, so results are repeatable.
import { loadMockup } from "./lib/load-mockup.mjs";

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const games = +arg("games", 1000);
const length = arg("length", "medium");
const seatCounts = arg("seats", "2,3,4").split(",").map(Number);
const firstSeed = +arg("first-seed", 1);

const { api: M } = loadMockup();

export function playMockupGame(M, seats, length, seed) {
  M.newGame(Array.from({ length: seats }, (_, i) => ({ name: "Bot " + (i + 1), bot: true })), length, seed);
  const S = M.S;
  while (S.phase === "draft") M.botDraft();
  while (!S.over) {
    let steps = 0;
    while (M.botStep()) if (++steps > 500) throw new Error("bot loop did not stop, seed " + seed);
    M.endTurn(M.botKeep());
  }
  return S;
}

for (const seats of seatCounts) {
  const byRank = new Array(seats).fill(0);
  const fieldGames = {}, fieldWins = {};
  for (let g = 0; g < games; g++) {
    const S = playMockupGame(M, seats, length, firstSeed + g);
    const r = M.ranking();
    r.forEach((p, i) => (byRank[i] += p.prestige));
    for (const p of S.players) fieldGames[p.field] = (fieldGames[p.field] || 0) + 1;
    fieldWins[r[0].field] = (fieldWins[r[0].field] || 0) + 1;
  }
  const winRate = Object.keys(fieldGames).sort()
    .map((L) => `${L} ${((100 * (fieldWins[L] || 0)) / fieldGames[L]).toFixed(0)}% of ${fieldGames[L]}`)
    .join(", ");
  console.log(`${seats} players, ${length}, ${games} games`);
  console.log("  average prestige by finishing place: " + byRank.map((s) => (s / games).toFixed(1)).join(" / "));
  console.log("  win rate by starting field: " + winRate);
}
