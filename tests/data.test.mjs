import { test } from "node:test";
import assert from "node:assert/strict";
import { listDecks, loadData, validateData } from "../tools/validate-data.mjs";

const clone = (x) => structuredClone(x);
const base = () => loadData("ai-history");

test("every deck in data/decks validates with no errors", () => {
  const decks = listDecks();
  assert.ok(decks.length >= 1);
  for (const id of decks) assert.deepEqual(validateData(loadData(id)).errors, [], "deck " + id);
});

test("the AI History deck has four theses of equal size, numbered 1 to n", () => {
  const { deck } = base();
  const n = deck.cards.length;
  assert.deepEqual(Object.keys(deck.theses), ["A", "B", "C", "D"]);
  assert.equal(n, 60);
  for (const L of "ABCD") assert.equal(deck.cards.filter((c) => c.arg === L).length, n / 4);
  assert.deepEqual([...new Set(deck.cards.map((c) => c.num))].sort((a, b) => a - b), Array.from({ length: n }, (_, i) => i + 1));
});

test("validator catches a card with an unknown thesis or type", () => {
  const d = base();
  d.deck = clone(d.deck);
  d.deck.cards[0].arg = "Z";
  d.deck.cards[1].type = "Telegram";
  const { errors } = validateData(d);
  assert.ok(errors.some((e) => e.includes('arg "Z"')));
  assert.ok(errors.some((e) => e.includes('type "Telegram"')));
});

test("validator catches a missing card field and a non-integer num", () => {
  const d = base();
  d.deck = clone(d.deck);
  delete d.deck.cards[2].era;
  d.deck.cards[3].num = "7";
  const { errors } = validateData(d);
  assert.ok(errors.some((e) => e.includes('no "era" field')));
  assert.ok(errors.some((e) => e.includes("num must be a whole number")));
});

test("validator catches a book size with no score", () => {
  const d = base();
  d.config = clone(d.config);
  delete d.config.bookCardPts["3"]; // University Press allows 3-card books
  assert.ok(validateData(d).errors.some((e) => e.includes("no entry for 3-card books")));
});

test("validator catches a stack too small to draft and too few drafts for the seats", () => {
  const d = base();
  d.deck = clone(d.deck);
  d.config = clone(d.config);
  d.deck.cards = d.deck.cards.filter((c) => c.arg !== "D" || c.num === 16); // D: 1 source + 3 trash
  d.config.seats.max = 12;
  const { errors } = validateData(d);
  assert.ok(errors.some((e) => e.startsWith("stack D holds")));
  assert.ok(errors.some((e) => e.includes("drafts fit in the stacks")));
});

test("validator accepts a fifth thesis and a bigger deck", () => {
  const d = base();
  d.deck = clone(d.deck);
  d.deck.theses.E = { q: "A new question?", articles: ["X"], books: ["Y"], color: "#555555" };
  for (let i = 0; i < 12; i++) d.deck.cards.push({ ...d.deck.cards[i], arg: "E", sub: "", num: 41 + i });
  assert.deepEqual(validateData(d).errors, []);
});

test("starting actions are basics and the market has the seven piles", () => {
  const { config, actions, market } = base();
  for (const id of config.startingActions) assert.equal(actions[id].value, 0);
  assert.deepEqual(market.map((p) => p.pile), ["sabbatical", "keynote", "research", "society", "agent", "fellowship", "press"]);
});

test("validator catches market mistakes", () => {
  const d = base();
  d.market = clone(d.market);
  d.market[0].tiers.push("nope");
  d.market[1].value = 9;
  d.market.push({ ...d.market[2] });
  const { errors } = validateData(d);
  assert.ok(errors.some((e) => e.includes('unknown action "nope"')));
  assert.ok(errors.some((e) => e.includes("but the pile costs 9")));
  assert.ok(errors.some((e) => e.includes("appears twice")));
});

test("validator needs upgradeCopies only when there is no market", () => {
  const d = base();
  d.market = null;
  assert.ok(validateData(d).errors.some((e) => e.includes("upgradeCopies")));
});
