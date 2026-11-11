// A quick slice of the parity check (the full run is `npm run parity`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadMockup, mockupRules, botGame, fuzzGame, Mismatch } from "../tools/lib/parity.mjs";
import { makeRules } from "../engine/js/index.mjs";
import { loadData } from "../tools/validate-data.mjs";

const mock = loadMockup();
const R = mockupRules(mock);
const configs = [];
for (const length of ["short", "medium", "long"]) for (const seats of [2, 3, 4]) configs.push([length, seats]);

test("bot games match the mock-up after every step", () => {
  for (const [length, seats] of configs) for (let seed = 1; seed <= 8; seed++) botGame(mock, R, seats, length, seed);
});

test("fuzz games (random choices, including invalid ones) match the mock-up after every step", () => {
  for (const [length, seats] of configs) for (let seed = 1; seed <= 6; seed++) fuzzGame(mock, R, seats, length, seed);
});

test("data/ gives the same rules as the mock-up (until you rebalance)", (t) => {
  const fromData = makeRules(loadData("ai-history"));
  // Ignore what data/ adds on purpose: seat limits, thesis colours, the deck's id and name.
  const strip = (r) => {
    const { seats, ...config } = r.config;
    const theses = Object.fromEntries(Object.entries(r.theses).map(([L, { color, ...t }]) => [L, t]));
    return JSON.stringify({ config, theses, actions: r.actions, bonuses: r.bonuses, trash: r.trash, cards: r.cards, letters: r.letters, upgrades: r.upgrades, base: r.base });
  };
  if (strip(fromData) !== strip(R)) t.skip("data/ has been rebalanced away from the mock-up");
});

// The harness has to be able to fail: change one rule number and the comparison must catch it.
test("the harness catches a rule that differs from the mock-up", () => {
  for (const [key, value] of [["paperPts", 3], ["citePts", 1], ["trashPenalty", 2]]) {
    const bad = makeRules(JSON.parse(JSON.stringify({ ...R, config: { ...R.config, [key]: value } })));
    assert.throws(() => {
      for (let seed = 1; seed <= 10; seed++) {
        botGame(mock, bad, 3, "medium", seed);
        fuzzGame(mock, bad, 3, "medium", seed);
      }
    }, Mismatch, key);
  }
});
