// The rules that deliberately differ from the mock-up. Step 3: no-cost Research that draws a fixed number of
// cards, and upgrade piles whose later copies are stronger at the same price. Step 9: purchasing power and
// buying instead of the Network card, Organize returning cards, and False Leads.
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
// Ordinary sources and False Leads, as uids.
const sources = (S, pred = () => true) => S.cards.map((c, u) => u).filter((u) => u && S.cards[u].kind === "source" && !R.cards[S.cards[u].ref].falseLead && pred(R.cards[S.cards[u].ref]));
const falseLeads = (S, pred = () => true) => S.cards.map((c, u) => u).filter((u) => u && S.cards[u].kind === "source" && R.cards[S.cards[u].ref].falseLead && pred(R.cards[S.cards[u].ref]));

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
  const map = sourceUid(S, (d) => d.type === "Map" && !d.falseLead);
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

// Seat 0's hand becomes `n` basic Research cards (power 1 each), to pay with.
const basics = (S, n) => Array.from({ length: n }, () => addCard(S, "action", "research"));

test("an upgrade pile sells its tiers top down at one price, then runs out", () => {
  const S = setup();
  const pile = R.pileById.get("research");
  assert.deepEqual(pile.tiers, ["travel", "assistant"]);
  const buy = (n) => {
    const disc = basics(S, n);
    hand(S, disc);
    S.bought = 0;
    return { res: E.doBuy(S, R, 0, disc, "research"), p: S.players[0] };
  };
  assert.equal(E.nextTier(S, R, "research"), "travel");
  assert.equal(buy(pile.value - 1).res, `Those cards are worth ${pile.value - 1}; that upgrade costs ${pile.value}.`);
  let { res, p } = buy(pile.value);
  assert.equal(res, null);
  assert.equal(S.cards[p.discard.at(-1)].ref, "travel", "first copy is the weaker tier");
  assert.equal(S.market.research, 1);
  ({ res, p } = buy(pile.value));
  assert.equal(res, null, "the second copy costs the same");
  assert.equal(S.cards[p.discard.at(-1)].ref, "assistant", "second copy is the stronger tier");
  assert.equal(E.describe(S.log.at(-1), S, R), `Bot 1 discards ${pile.value} (worth ${pile.value}) and buys Research Assistant.`);
  assert.equal(buy(pile.value).res, "That upgrade is gone.");
  assert.equal(E.nextTier(S, R, "research"), null);
});

test("buying: discards go to the discard pile with the new card, which replaces nothing; once per turn", () => {
  const S = setup();
  const pl = R.pileById.get("press");
  const disc = basics(S, pl.value);
  const keep = sources(S)[0];
  const p = hand(S, [...disc, keep]);
  const before = p.discard.length;
  assert.equal(E.doBuy(S, R, 0, disc, "press"), null);
  assert.equal(p.discard.length, before + disc.length + 1, "nothing is replaced");
  assert.deepEqual(p.hand, [keep]);
  hand(S, basics(S, 5));
  assert.equal(E.doBuy(S, R, 0, p.hand.slice(), "sabbatical"), "You have already bought this turn.");
  E.endTurn(S, R, []);
  assert.equal(S.bought, 0, "the count resets at the end of the turn");
});

test("purchasing power: basic cards 1, sources their CSV value, tier one 2, tier two 3, False Leads 0", () => {
  const S = setup();
  for (const id of R.base) assert.equal(E.powerOf(S, R, addCard(S, "action", id)), 1, id);
  for (const pl of R.piles) {
    assert.equal(E.powerOf(S, R, addCard(S, "action", pl.tiers[0])), 2, pl.tiers[0]);
    assert.equal(E.powerOf(S, R, addCard(S, "action", pl.tiers[1])), 3, pl.tiers[1]);
  }
  for (const u of sources(S)) assert.equal(E.powerOf(S, R, u), R.cards[S.cards[u].ref].power);
  for (const u of falseLeads(S)) assert.equal(E.powerOf(S, R, u), 0);
  assert.ok(sources(S).every((u) => [1, 2].includes(E.powerOf(S, R, u))));
});

test("a Society card in hand and a Letter add purchasing power; a False Lead adds none", () => {
  const S = setup();
  const soc = addCard(S, "action", "society");
  const fl = falseLeads(S)[0];
  const letter = sources(S, (d) => d.type === "Letter")[0];
  const b = basics(S, 1);
  hand(S, [soc, fl, ...b]);
  assert.equal(E.buyPower(S, R, 0, [fl]), R.actions.society.bonus);
  assert.equal(E.buyPower(S, R, 0, [fl, ...b]), R.actions.society.bonus + 1);
  hand(S, [letter, ...b]);
  assert.equal(E.buyPower(S, R, 0, b), 1 + R.bonuses.Letter.amt);
});

test("the Network card is gone from the starting deck and refused under these rules", () => {
  assert.ok(!R.base.includes("network"));
  const S = setup();
  for (const p of S.players) assert.ok([...p.deck, ...p.hand].every((u) => S.cards[u].kind !== "action" || R.actions[S.cards[u].ref].kind !== "network"));
  const soc = addCard(S, "action", "society");
  const b = basics(S, 3);
  hand(S, [soc, ...b]);
  assert.equal(E.doNetwork(S, R, 0, soc, b, "keynote", b[0]), "There is no Network action in these rules: buy instead.");
});

test("Organize returns sources to their archive, upgrades to the conference space, and removes basic cards", () => {
  const S = setup();
  const org = addCard(S, "action", "organize");
  const src = sources(S, (d) => d.arg === "B")[0];
  const fl = falseLeads(S, (d) => d.arg === "D")[0];
  const up = addCard(S, "action", "keynote");
  const basic = addCard(S, "action", "conference");
  const p = hand(S, [org, src, up]);
  p.discard.push(fl, basic);
  S.market.keynote = 1; // the first Keynote was sold; this one goes back on top
  assert.equal(E.doOrganize(S, R, 0, org, [org]), "Organize cannot return itself.");
  assert.equal(E.doOrganize(S, R, 0, org, [S.players[1].hand[0]]), "Only cards in your hand or discard pile.");
  assert.equal(E.doOrganize(S, R, 0, org, [src, fl, up, basic]), null);
  assert.equal(S.stacks.B.at(-1), src, "a source goes under its archive");
  assert.equal(S.stacks.D.at(-1), fl, "so does a False Lead");
  assert.deepEqual(S.returned.keynote, ["keynote"]);
  assert.equal(E.pileLeft(S, "keynote"), 2);
  assert.equal(E.nextTier(S, R, "keynote"), "keynote", "the returned card is sold next");
  assert.ok(![...p.deck, ...p.hand, ...p.discard].includes(basic), "a basic card leaves the game");
  assert.deepEqual(p.play, [org]);
  assert.equal(E.describe(S.log.at(-1), S, R), "Bot 1 organizes and returns 4 cards: 1 to card archive B, 1 to card archive D, an upgrade to the conference space, 1 out of the game.");
  const v = E.view(S, R, 1);
  assert.equal(v.log.at(-1).cards, undefined, "rivals do not see which cards");
  hand(S, basics(S, R.pileById.get("keynote").value));
  S.bought = 0;
  assert.equal(E.doBuy(S, R, 0, S.players[0].hand.slice(), "keynote"), null);
  assert.equal(S.cards[S.players[0].discard.at(-1)].ref, "keynote");
  assert.deepEqual(S.returned.keynote, []);
  assert.equal(S.market.keynote, 1, "the untouched pile is unchanged");
});

test("False Leads are not evidence: no conference papers, no pairing or books with ordinary sources", () => {
  const S = setup();
  const [f1, f2] = falseLeads(S);
  const ord = sources(S, (d) => d.era === R.cards[S.cards[f1].ref].era)[0];
  const conf = addCard(S, "action", "conference"), ar = addCard(S, "action", "article"), bk = addCard(S, "action", "book");
  hand(S, [conf, ar, bk, f1, f2, ord]);
  assert.equal(E.doConference(S, R, 0, conf, f1), "A False Lead cannot be presented as evidence.");
  assert.equal(E.doArticle(S, R, 0, ar, f1, ord, f1), "A False Lead can only be published with another False Lead.");
  const L = R.cards[S.cards[f1].ref].arg;
  const three = sources(S, (d) => d.arg === L).slice(0, 3);
  hand(S, [bk, f1, ...three]);
  assert.equal(E.bookCheck(S, R, 0, R.actions.book, [f1, ...three], []).msg, "False Leads can only be published with other False Leads.");
  assert.equal(E.bonus(S, R, 0, R.cards[S.cards[f1].ref].type), 0, "no passive bonus from a False Lead in hand");
});

test("a False Lead article pairs any two False Leads across eras for +3", () => {
  const S = setup();
  const fls = falseLeads(S);
  const f1 = fls[0], f2 = fls.find((u) => R.cards[S.cards[u].ref].era !== R.cards[S.cards[f1].ref].era);
  const ar = addCard(S, "action", "article");
  const p = hand(S, [ar, f1, f2]);
  assert.equal(E.doArticle(S, R, 0, ar, f1, f2, f1), null);
  assert.equal(p.prestige, R.config.articlePts + R.config.falseLead.articlePts);
  assert.deepEqual(p.shelf.map((e) => e.uid), [f1]);
  assert.match(E.describe(S.log.at(-1), S, R), /publishes a False Lead article/);
});

test("a False Lead book mixes theses and scores +2 per card", () => {
  const S = setup();
  const four = R.letters.map((L) => falseLeads(S, (d) => d.arg === L)[0]);
  const bk = addCard(S, "action", "book");
  const p = hand(S, [bk, ...four]);
  const r = E.bookCheck(S, R, 0, R.actions.book, four, []);
  assert.ok(r.ok, r.msg);
  const plain = E.bookCardPts(R, 4) + R.config.bookBonus + r.sets.reduce((t, x) => t + x.pts, 0);
  assert.equal(r.pts, plain + 4 * R.config.falseLead.bookCardPts);
  assert.match(r.msg, /^4 False Leads: /);
  assert.equal(E.doBook(S, R, 0, bk, four, [], four[1]), null);
  assert.equal(p.prestige, r.pts);
  assert.match(E.describe(S.log.at(-1), S, R), /4 False Leads \(\+\d+\)/);
});

test("False Leads on the bookshelf have their own effects", () => {
  const S = setup();
  const shelve = (type) => {
    const u = falseLeads(S, (d) => d.type === type)[0];
    removeEverywhere(S, u);
    S.players[0].shelf.push({ uid: u, usedBy: [] });
  };
  hand(S, []);
  shelve("Diary");
  assert.equal(E.handLimit(S, R, 0), R.config.handSize + R.falseLeads.Diary.hand);
  E.endTurn(S, R, []);
  assert.equal(S.players[0].hand.length, R.config.handSize + R.falseLeads.Diary.hand, "draws one more at the end of the turn");
  shelve("Newspaper");
  assert.equal(E.buysLeft(S, R, 0), R.config.buying.perTurn + R.falseLeads.Newspaper.buys);
  shelve("Letter");
  assert.equal(E.buyPower(S, R, 0, []), R.falseLeads.Letter.power);
  shelve("Map");
  const r = addCard(S, "action", "research");
  S.players[0].discard.push(...S.players[0].hand);
  S.players[0].hand = [r]; // no ordinary Map in hand, so nothing to look at
  assert.equal(E.doResearch(S, R, 0, r, [], "A").got.length, R.actions.research.take + R.falseLeads.Map.take);
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
  const disc = basics(S, 5);
  hand(S, disc);
  for (const id of ["travel", "keynote2", "toString", "nope"]) assert.equal(E.doBuy(S, R, 0, disc, id), "That upgrade is gone.", id);
});

test("a book's hand cards go to the author's discard pile; only the showcase leaves the deck", () => {
  const S = setup();
  // Four sources sharing thesis A, from the deck data.
  const four = sources(S, (d) => d.arg === "A").slice(0, 4);
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
  for (const u of sources(S)) (byEra[R.cards[S.cards[u].ref].era] ??= []).push(u);
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
