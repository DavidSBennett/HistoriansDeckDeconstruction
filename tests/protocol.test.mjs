import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../engine/js/index.mjs";
import { loadData } from "../tools/validate-data.mjs";
import { playProtocolGame } from "../tools/lib/play.mjs";
import { fuzzRandom, fuzzAction } from "../tools/lib/fuzz.mjs";

const R = E.makeRules(loadData("ai-history"));
const json = (x) => JSON.stringify(x);

// A game with seat 0 human and the rest bots, advanced to seat 0's first turn.
function humanFirst(seed = 3, n = 3) {
  const seats = Array.from({ length: n }, (_, i) => ({ name: "P" + i, bot: i > 0 }));
  let S = E.newGame(R, seats, "medium", seed);
  S = E.apply(S, R, 0, { type: "draft", stack: "A" }).state;
  return E.advanceBots(S, R).state;
}
// Seat 0's action card of this kind, moved into its hand from wherever it is in seat 0's piles.
function actionCard(S, kind) {
  const p = S.players[0];
  const is = (u) => S.cards[u].kind === "action" && R.actions[S.cards[u].ref].kind === kind;
  let u = p.hand.find(is);
  if (u) return u;
  for (const k of ["deck", "discard"]) {
    u = p[k].find(is);
    if (u) { p[k].splice(p[k].indexOf(u), 1); p.hand.push(u); return u; }
  }
  throw new Error("seat 0 has no " + kind + " card");
}

test("apply never changes the state it is given", () => {
  const S = humanFirst();
  const before = json(S);
  const r = E.apply(S, R, 0, { type: "endTurn" });
  assert.ok(r.state);
  assert.equal(json(S), before);
  assert.notEqual(json(r.state), before);
});

test("advanceBots plays the bots' drafts and turns and stops at a human", () => {
  const S = humanFirst();
  assert.equal(S.phase, "play");
  assert.deepEqual(E.toAct(S), { seat: 0, kind: "turn" });
  const after = E.advanceBots(E.apply(S, R, 0, { type: "endTurn" }).state, R);
  assert.deepEqual(E.toAct(after.state), { seat: 0, kind: "turn" }, "both bots played and it is seat 0 again");
  assert.ok(after.events.some((e) => e.type === "endTurn" && e.seat === 1));
  assert.ok(after.events.some((e) => e.type === "endTurn" && e.seat === 2));
});

test("turn, phase and game-over checks", () => {
  const S = humanFirst();
  assert.equal(E.apply(S, R, 1, { type: "endTurn" }).error, "It is not your turn.");
  assert.equal(E.apply(S, R, 7, { type: "endTurn" }).error, "You are not playing in this game.");
  assert.equal(E.apply(S, R, 0, { type: "draft", stack: "B" }).error, "The draft is over.");
  assert.equal(E.apply(S, R, 0, { type: "researchChoose", putBack: [] }).error, "There is no Research choice to make.");
  const fresh = E.newGame(R, [{ name: "a" }, { name: "b" }], "short", 1);
  assert.equal(E.apply(fresh, R, 0, { type: "endTurn" }).error, "The draft is not finished.");
  assert.equal(E.apply(fresh, R, 1, { type: "draft", stack: "A" }).error, "It is not your turn to choose a field.");
  const over = { ...S, over: true };
  assert.equal(E.apply(over, R, 0, { type: "endTurn" }).error, "The game is over.");
});

test("a pending Research choice must be finished before anything else, including ending the turn", () => {
  let S = humanFirst(5);
  const p = S.players[0];
  // Give seat 0 a Map so Research has a card to put back.
  const map = S.cards.findIndex((c, u) => u && c.kind === "source" && R.cards[c.ref].type === "Map");
  for (const L of Object.keys(S.stacks)) S.stacks[L] = S.stacks[L].filter((u) => u !== map);
  for (const q of S.players) for (const k of ["deck", "hand", "discard"]) q[k] = q[k].filter((u) => u !== map);
  p.hand.push(map);
  const r = actionCard(S, "research");
  S = E.apply(S, R, 0, { type: "research", card: r, stack: "B" }).state;
  assert.ok(S.pending);
  assert.equal(E.apply(S, R, 0, { type: "endTurn" }).error, "Finish choosing which Research cards to put back first.");
  assert.equal(E.apply(S, R, 1, { type: "researchChoose", putBack: [S.pending.seen[0]] }).error, "It is not your turn.");
  assert.equal(E.apply(S, R, 0, { type: "researchChoose", putBack: [S.pending.seen[0], S.pending.seen[0]] }).error, '"putBack" lists the same card twice.');
  const done = E.apply(S, R, 0, { type: "researchChoose", putBack: [S.pending.seen[0]] });
  assert.equal(done.state.pending, null);
  assert.equal(done.events[0].type, "research");
});

test("repeated ids are refused for every list field (the mock-up would have counted them twice)", () => {
  const S = humanFirst(8);
  const hand = S.players[0].hand;
  const cases = [
    { type: "organize", card: actionCard(S, "organize"), cards: [hand[0], hand[0]] },
    { type: "research", card: actionCard(S, "research"), stack: "A", discard: [hand[0], hand[0]] },
    { type: "book", card: actionCard(S, "book"), hand: [hand[0], hand[0], hand[1], hand[1]] },
    { type: "book", card: actionCard(S, "book"), hand: [hand[0], hand[1]], shelf: [5, 5] },
    { type: "buy", discard: [hand[0], hand[0], hand[0]], pile: "press" },
    { type: "article", card: actionCard(S, "article"), sources: [hand[0], hand[0]], showcase: hand[0] },
    { type: "endTurn", keep: [hand[0], hand[0]] },
  ];
  for (const m of cases) assert.match(E.apply(S, R, 0, m).error, /lists the same card twice/, m.type);
});

test("malformed messages are refused with a reason, never thrown", () => {
  const S = humanFirst();
  const bad = [
    null, 7, "endTurn", [], {}, { type: "explode" }, { type: "__proto__" }, { type: "constructor" },
    { type: "playDraw" }, { type: "playDraw", card: "12" }, { type: "playDraw", card: 1.5 }, { type: "playDraw", card: -1 },
    { type: "conference", card: 1 }, { type: "article", card: 1, sources: [1], showcase: 1 },
    { type: "network", card: 1, discard: [1], pile: "", replace: 1 }, { type: "network", card: 1, discard: [1], pile: "x".repeat(41), replace: 1 },
    { type: "buy", discard: [1], pile: "" }, { type: "buy", discard: 1, pile: "press" }, { type: "buy", pile: "press" },
    { type: "endTurn", keep: "all" }, { type: "endTurn", keep: Array.from({ length: 101 }, (_, i) => i + 1) },
    { type: "research", card: 1, stack: {} }, { type: "book", card: 1, hand: [1, 2], showcase: "x" },
  ];
  for (const m of bad) {
    const r = E.apply(S, R, 0, m);
    assert.equal(typeof r.error, "string", JSON.stringify(m));
    assert.equal(r.state, undefined);
  }
});

test("cards that don't exist or belong to someone else are refused", () => {
  const S = humanFirst();
  const rival = S.players[1].hand[0];
  const conf = actionCard(S, "conference");
  for (const card of [99999, rival]) assert.equal(E.apply(S, R, 0, { type: "conference", card: conf, source: card }).error, "Choose one source.");
  assert.equal(E.apply(S, R, 0, { type: "playDraw", card: rival }).error, "Not a draw card.");
});

test("hostile games: corrupted messages never crash, never change the input, and the impossible ones always fail", () => {
  const seen = {};
  for (const n of [2, 3, 4])
    for (let seed = 1; seed <= 12; seed++)
      playProtocolGame(R, n, "short", seed, {
        humans: 1 + (seed % n), hostile: 0.3,
        onHostile: (h, res) => {
          seen[h.kind] = (seen[h.kind] || 0) + 1;
          if (h.mustFail) assert.ok(res.error, `${h.kind} was accepted: ${JSON.stringify(h.msg)}`);
        },
      });
  for (const k of ["repeated id", "wrong seat", "bad value", "another card", "oversized list", "garbage"]) assert.ok(seen[k] > 20, k);
});

test("a game played through the protocol matches the same choices made directly on the engine", () => {
  for (const n of [2, 4])
    for (let seed = 1; seed <= 6; seed++) {
      const rndA = fuzzRandom(seed), rndB = fuzzRandom(seed);
      const seats = Array.from({ length: n }, (_, i) => ({ name: "P" + i, bot: false }));
      let A = E.newGame(R, seats, "short", seed);
      const B = E.newGame(R, seats, "short", seed);
      const call = {
        draft: (a) => E.doDraft(B, R, a[0]), researchChoose: (a) => E.finishResearch(B, R, B.pending, a[0]),
        endTurn: (a) => E.endTurn(B, R, a[0]), draw: (a) => E.doDraw(B, R, B.turn, a[0]),
        organize: (a) => E.doOrganize(B, R, B.turn, ...a), research: (a) => E.doResearch(B, R, B.turn, ...a),
        conference: (a) => E.doConference(B, R, B.turn, ...a), article: (a) => E.doArticle(B, R, B.turn, ...a),
        book: (a) => E.doBook(B, R, B.turn, ...a), network: (a) => E.doNetwork(B, R, B.turn, ...a),
        buy: (a) => E.doBuy(B, R, B.turn, ...a),
      };
      const msgOf = { draft: (a) => ({ type: "draft", stack: a[0] }), researchChoose: (a) => ({ type: "researchChoose", putBack: a[0] }),
        endTurn: (a) => ({ type: "endTurn", keep: a[0] }), draw: (a) => ({ type: "playDraw", card: a[0] }),
        organize: (a) => ({ type: "organize", card: a[0], cards: a[1] }), research: (a) => ({ type: "research", card: a[0], discard: a[1], stack: a[2] }),
        conference: (a) => ({ type: "conference", card: a[0], source: a[1] }), article: (a) => ({ type: "article", card: a[0], sources: [a[1], a[2]], showcase: a[3] }),
        book: (a) => ({ type: "book", card: a[0], hand: a[1], shelf: a[2], showcase: a[3] }), network: (a) => ({ type: "network", card: a[0], discard: a[1], pile: a[2], replace: a[3] }),
        buy: (a) => ({ type: "buy", discard: a[0], pile: a[1] }) };
      let acts = 0;
      while (!B.over) {
        let a = fuzzAction(B, R, rndA);
        fuzzAction(A, R, rndB); // keep the two generators in step
        if (a.fn !== "researchChoose" && a.fn !== "draft" && ++acts > 15) a = { fn: "endTurn", args: [[]] };
        if (a.fn === "endTurn") acts = 0;
        call[a.fn](a.args);
        const r = E.apply(A, R, E.toAct(A).seat, msgOf[a.fn](a.args));
        if (r.state) A = r.state;
        assert.equal(json(A), json(B), `seed ${seed}, ${a.fn}`);
      }
    }
});
