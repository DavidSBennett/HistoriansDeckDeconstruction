import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../engine/js/index.mjs";
import { loadData } from "../tools/validate-data.mjs";

const R = E.makeRules(loadData("ai-history"));
const bots = (n) => Array.from({ length: n }, (_, i) => ({ name: "Bot " + (i + 1), bot: true }));
const json = (x) => JSON.stringify(x);

test("same seed, same game; different seed, different game", () => {
  const a = E.playBotGame(E.newGame(R, bots(3), "medium", 42), R);
  const b = E.playBotGame(E.newGame(R, bots(3), "medium", 42), R);
  const c = E.playBotGame(E.newGame(R, bots(3), "medium", 43), R);
  assert.equal(json(a), json(b));
  assert.notEqual(json(a), json(c));
});

test("state is plain JSON: a game resumed from its JSON after every step ends the same", () => {
  const ref = E.playBotGame(E.newGame(R, bots(4), "short", 7), R);
  let S = E.newGame(R, bots(4), "short", 7);
  const rt = () => (S = JSON.parse(JSON.stringify(S)));
  while (S.phase === "draft") { rt(); E.botDraft(S, R); }
  while (!S.over) {
    rt();
    while (E.botStep(S, R)) rt();
    E.endTurn(S, R, E.botKeep(S, R));
  }
  assert.equal(json(S), json(ref));
});

test("no shared globals: two games played in alternation match the same games played alone", () => {
  const alone = [E.playBotGame(E.newGame(R, bots(2), "short", 1), R), E.playBotGame(E.newGame(R, bots(3), "short", 2), R)];
  const games = [E.newGame(R, bots(2), "short", 1), E.newGame(R, bots(3), "short", 2)];
  for (const S of games) while (S.phase === "draft") E.botDraft(S, R);
  while (games.some((S) => !S.over))
    for (const S of games) if (!S.over) { while (E.botStep(S, R)); E.endTurn(S, R, E.botKeep(S, R)); }
  assert.equal(json(games), json(alone));
});

test("newGame rejects an unknown length or a missing seed", () => {
  assert.throws(() => E.newGame(R, bots(2), "epic", 1), /Unknown game length/);
  assert.throws(() => E.newGame(R, bots(2), "short"), /integer seed/);
});

test("a game ends after the configured rounds with trash penalties applied", () => {
  const S = E.playBotGame(E.newGame(R, bots(2), "short", 5), R);
  assert.equal(S.over, true);
  assert.equal(S.round, R.config.rounds.short);
  for (const p of S.players) assert.equal(p.trash, E.trashCount(S, p.i));
  assert.equal(S.log.at(-1).type, "over");
});

test("every log event renders to text", () => {
  const S = E.playBotGame(E.newGame(R, bots(4), "long", 11), R);
  for (const e of S.log) assert.doesNotMatch(E.describe(e, S, R), /^\(|undefined|NaN/);
});

test("bookCardPts extrapolates past the table: 34 + 9 per card past 8", () => {
  assert.deepEqual([3, 4, 5, 6, 7, 8, 9, 10].map((n) => E.bookCardPts(R, n)), [5, 8, 13, 19, 26, 34, 43, 52]);
});

test("the engine handles a fifth thesis with no code changes", () => {
  const data = loadData("ai-history");
  data.deck = structuredClone(data.deck);
  data.deck.theses.E = { q: "A fifth question?", articles: ["Art"], books: ["Book"], color: "#444444" };
  for (let i = 0; i < 10; i++) data.deck.cards.push({ ...data.deck.cards[i], arg: "E", sub: i % 2 ? "A" : "", num: 41 + i });
  const R5 = E.makeRules(data);
  const S = E.playBotGame(E.newGame(R5, bots(4), "medium", 3), R5);
  assert.deepEqual(Object.keys(S.stacks), ["A", "B", "C", "D", "E"]);
  assert.equal(S.over, true);
});
