// The rules that deliberately differ from the mock-up (build step 3): no-cost Research that draws a fixed
// number of cards, and upgrade piles whose later copies are stronger at the same price.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../engine/js/index.mjs";
import { loadData } from "../tools/validate-data.mjs";

const R = E.makeRules(loadData("ai-history"));
const bots = (n) => Array.from({ length: n }, (_, i) => ({ name: "Bot " + (i + 1), bot: true }));
const json = (x) => JSON.stringify(x);

function setup(seed = 1, seats = 2) {
  const S = E.newGame(R, bots(seats), "medium", seed);
  while (S.phase === "draft") E.botDraft(S, R);
  return S;
}
function addCard(S, kind, ref) {
  S.cards.push({ kind, ref });
  S.uidc = S.cards.length - 1;
  return S.uidc;
}
function removeEverywhere(S, uid) {
  const out = (a) => { const i = a.indexOf(uid); if (i >= 0) a.splice(i, 1); };
  for (const p of S.players) {
    for (const k of ["deck", "hand", "discard", "play"]) out(p[k]);
    p.shelf = p.shelf.filter((e) => e.uid !== uid);
  }
  for (const L of Object.keys(S.stacks)) out(S.stacks[L]);
}
// Seat 0's hand becomes exactly these cards (moved from wherever they were); its shelf is cleared.
function hand(S, uids) {
  const p = S.players[0];
  p.discard.push(...p.hand);
  p.hand = [];
  p.shelf = [];
  for (const u of uids) { removeEverywhere(S, u); p.hand.push(u); }
  return p;
}
const sourceUid = (S, pred) => S.cards.findIndex((c, u) => u && c.kind === "source" && pred(R.cards[c.ref]));

test("basic Research draws 2 from the clicked archive into the discard pile, at no cost", () => {
  const S = setup();
  const r = addCard(S, "action", "research");
  const keep = addCard(S, "trash", 0);
  const p = hand(S, [r, keep]);
  const top = S.stacks.A.slice(0, 2), before = S.stacks.A.length, discardBefore = p.discard.length;
  const res = E.doResearch(S, R, 0, r, [], "A");
  assert.deepEqual(res, { got: top });
  assert.equal(S.stacks.A.length, before - 2);
  assert.deepEqual(p.discard.slice(-2), top);
  assert.equal(p.discard.length, discardBefore + 2);
  assert.deepEqual(p.hand, [keep], "no card is discarded to pay");
  assert.deepEqual(p.play, [r]);
  assert.equal(E.describe(S.log.at(-1), S, R), "Bot 1 researches: takes 2 from card archive A.");
});

test("no-cost Research refuses discards and leaves the state untouched", () => {
  const S = setup();
  const r = addCard(S, "action", "research");
  const x = addCard(S, "trash", 0);
  hand(S, [r, x]);
  const before = json(S);
  assert.equal(E.doResearch(S, R, 0, r, [x], "A"), "This Research card needs no discards.");
  assert.equal(json(S), before);
});

test("Travel Grant draws 4 and Research Assistant draws 5", () => {
  for (const [id, n] of [["travel", 4], ["assistant", 5]]) {
    const S = setup();
    const r = addCard(S, "action", id);
    hand(S, [r]);
    assert.equal(E.doResearch(S, R, 0, r, [], "B").got.length, n);
  }
});

test("a Map still lets you look at one more card and put one back", () => {
  const S = setup();
  const r = addCard(S, "action", "research");
  const map = sourceUid(S, (d) => d.type === "Map");
  hand(S, [r, map]);
  const top3 = S.stacks.C.slice(0, 3);
  const res = E.doResearch(S, R, 0, r, [], "C");
  assert.deepEqual(res, { pending: true, seen: top3, reject: 1, keepN: 2 });
  assert.equal(E.finishResearch(S, R, S.pending, [top3[0], top3[1]]), "Put back exactly 1.");
  assert.deepEqual(E.finishResearch(S, R, S.pending, [top3[1]]), { got: [top3[0], top3[2]] });
  assert.equal(S.stacks.C.at(-1), top3[1], "the rejected card goes under the archive");
  assert.equal(E.describe(S.log.at(-1), S, R), "Bot 1 researches: looks at 3 and takes 2 from card archive C.");
});

test("Research takes what is left when an archive has fewer cards than it draws", () => {
  const S = setup();
  const r = addCard(S, "action", "assistant");
  hand(S, [r]);
  S.stacks.D = S.stacks.D.slice(0, 2);
  assert.equal(E.doResearch(S, R, 0, r, [], "D").got.length, 2);
  assert.equal(S.stacks.D.length, 0);
  const r2 = addCard(S, "action", "research");
  hand(S, [r2]);
  assert.equal(E.doResearch(S, R, 0, r2, [], "D"), "That card archive is empty.");
});

test("an upgrade pile sells its tiers top down at one price, then runs out", () => {
  const S = setup();
  const pile = R.pileById.get("research");
  assert.deepEqual(pile.tiers, ["travel", "assistant"]);
  const buy = (nDiscards) => {
    const net = addCard(S, "action", "network");
    const disc = Array.from({ length: nDiscards }, () => addCard(S, "trash", 1));
    hand(S, [net, ...disc]);
    return { res: E.doNetwork(S, R, 0, net, disc, "research", disc[0]), p: S.players[0] };
  };
  assert.equal(E.nextTier(S, R, "research"), "travel");
  assert.equal(buy(pile.value - 1).res, "You need to discard more cards for that upgrade.");
  let { res, p } = buy(pile.value);
  assert.equal(res, null);
  assert.equal(S.cards[p.discard.at(-1)].ref, "travel", "first copy is the weaker tier");
  assert.equal(S.market.research, 1);
  ({ res, p } = buy(pile.value));
  assert.equal(res, null, "the second copy costs the same");
  assert.equal(S.cards[p.discard.at(-1)].ref, "assistant", "second copy is the stronger tier");
  assert.match(E.describe(S.log.at(-1), S, R), /takes Research Assistant, replacing Illegible Microfilm \(trash\)/);
  assert.equal(buy(pile.value).res, "That upgrade is gone.");
  assert.equal(E.nextTier(S, R, "research"), null);
});

test("every pile's second copy is the stronger card at the same price", () => {
  for (const pl of R.piles) {
    const [a, b] = pl.tiers.map((t) => R.actions[t]);
    assert.equal(a.kind, b.kind, pl.pile);
    assert.equal(a.value, pl.value);
    assert.equal(b.value, pl.value);
    const power = (d) => (d.take || 0) + (d.draw || 0) + (d.pts || 0) + (d.bonus || 0);
    assert.ok(power(b) > power(a), pl.pile + " second tier should be stronger");
  }
});

test("buying a pile by an upgrade's id or an unknown id is refused", () => {
  const S = setup();
  const net = addCard(S, "action", "network");
  const disc = [addCard(S, "trash", 0), addCard(S, "trash", 0), addCard(S, "trash", 0), addCard(S, "trash", 0)];
  hand(S, [net, ...disc]);
  for (const id of ["travel", "keynote2", "toString", "nope"]) assert.equal(E.doNetwork(S, R, 0, net, disc, id, disc[0]), "That upgrade is gone.", id);
});

test("a book's hand cards go to the author's discard pile; only the showcase leaves the deck", () => {
  const S = setup();
  // Four sources sharing thesis A, from the deck data.
  const four = S.cards.map((c, u) => u).filter((u) => u && S.cards[u].kind === "source" && R.cards[S.cards[u].ref].arg === "A").slice(0, 4);
  const bk = addCard(S, "action", "book");
  const p = hand(S, [bk, ...four]);
  const archives = Object.fromEntries(Object.entries(S.stacks).map(([L, a]) => [L, a.length]));
  const discardBefore = p.discard.length;
  assert.equal(E.doBook(S, R, 0, bk, four, [], four[0]), null);
  assert.deepEqual(p.shelf.map((e) => e.uid), [four[0]], "the showcase goes on the bookshelf");
  assert.deepEqual(p.discard.slice(-3), four.slice(1), "the other three go to the discard pile");
  assert.equal(p.discard.length, discardBefore + 3);
  assert.deepEqual(Object.fromEntries(Object.entries(S.stacks).map(([L, a]) => [L, a.length])), archives, "no archive changes");
});

test("an article's second source goes to the author's discard pile", () => {
  const S = setup();
  const byEra = {};
  for (let u = 1; u < S.cards.length; u++) if (S.cards[u].kind === "source") (byEra[R.cards[S.cards[u].ref].era] ??= []).push(u);
  const [s1, s2] = Object.values(byEra).find((a) => a.length >= 2);
  const ar = addCard(S, "action", "article");
  const p = hand(S, [ar, s1, s2]);
  assert.equal(E.doArticle(S, R, 0, ar, s1, s2, s1), null);
  assert.equal(p.discard.at(-1), s2);
});

test("the log calls the stacks card archives", () => {
  const S = setup();
  const draft = S.log.find((e) => e.type === "draft");
  assert.match(E.describe(draft, S, R), /takes 5 cards from that card archive\.$/);
});

test("bot games under the new rules finish cleanly for every length and seat count", () => {
  for (const length of ["short", "medium", "long"])
    for (const seats of [2, 3, 4])
      for (let seed = 1; seed <= 25; seed++) {
        const S = E.playBotGame(E.newGame(R, bots(seats), length, seed), R);
        assert.equal(S.over, true);
        for (const e of S.log) assert.doesNotMatch(E.describe(e, S, R), /undefined|NaN/);
        // Every card is still somewhere exactly once (or has left the game through Organize/Network).
        const seen = new Set();
        const where = [...Object.values(S.stacks).flat(), ...S.players.flatMap((p) => [...p.deck, ...p.hand, ...p.discard, ...p.play, ...p.shelf.map((e) => e.uid)])];
        for (const u of where) { assert.ok(!seen.has(u), "card " + u + " is in two places"); seen.add(u); }
      }
});
