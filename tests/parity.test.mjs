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

test("data/ keeps the mock-up's deck (as ai-history-mockup) and bonuses", () => {
  const fromData = makeRules(loadData("ai-history-mockup"));
  const plainTheses = (r) => Object.fromEntries(Object.entries(r.theses).map(([L, { color, ...t }]) => [L, t]));
  assert.deepEqual(fromData.cards, R.cards);
  assert.deepEqual(plainTheses(fromData), plainTheses(R));
  assert.deepEqual(fromData.bonuses, R.bonuses);
  assert.deepEqual(fromData.trash, R.trash);
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
