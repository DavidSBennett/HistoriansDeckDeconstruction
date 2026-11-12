// Hidden information. The main test is a perturbation test: take a real game state, scramble everything a
// seat is not allowed to know (rivals' hands, decks and discard piles, every deck's order, the contents and
// order of every archive, a rival's pending Research cards, other players' private log details, the seed and
// the random generator), and check that the view sent to that seat is byte-for-byte unchanged. If view()
// leaked any of it, some scramble would change the output.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as E from "../engine/js/index.mjs";
import { loadData } from "../tools/validate-data.mjs";
import { playProtocolGame } from "../tools/lib/play.mjs";
import { fuzzRandom } from "../tools/lib/fuzz.mjs";
import { perturb } from "../tools/lib/perturb.mjs";

const R = E.makeRules(loadData("ai-history"));
const json = (x) => JSON.stringify(x);

// Game states to test: every state of several protocol games, with humans and bots mixed.
function* states() {
  for (const n of [2, 3, 4])
    for (let seed = 1; seed <= 4; seed++) {
      const all = [];
      playProtocolGame(R, n, "short", seed, { humans: 1 + (seed % n), onState: (S) => all.push(S) });
      yield* all.filter((_, i) => i % 3 === 0 || i === all.length - 1); // always the finished game
    }
}

test("a view does not change when anything hidden from that seat changes", () => {
  const rnd = fuzzRandom(99);
  let checked = 0;
  for (const S of states())
    for (const seat of [...S.players.map((p) => p.i), null]) {
      const v = json(E.view(S, R, seat));
      for (let k = 0; k < 2; k++) assert.equal(json(E.view(perturb(S, seat, rnd), R, seat)), v, `seat ${seat}, round ${S.round}`);
      checked++;
    }
  assert.ok(checked > 500);
});

test("the perturbation test catches each kind of leak", () => {
  const leaks = {
    "a rival's hand": (S, seat) => S.players.filter((p) => p.i !== seat).map((p) => p.hand),
    "a rival's discard pile": (S, seat) => S.players.filter((p) => p.i !== seat).map((p) => p.discard),
    "your own deck order": (S, seat) => S.players[seat]?.deck,
    "archive order": (S) => S.stacks,
    "the seed": (S) => S.seed,
    "the random state": (S) => S.rng,
    "an unredacted log": (S) => S.log,
  };
  const rnd = fuzzRandom(5);
  const sample = [...states()].filter((S) => S.phase === "play" && S.round > 1);
  for (const [what, leak] of Object.entries(leaks)) {
    const leaky = (S, seat) => ({ ...E.view(S, R, seat), leak: leak(S, seat) });
    const caught = sample.some((S) => json(leaky(perturb(S, 0, rnd), 0)) !== json(leaky(S, 0)));
    assert.ok(caught, "did not catch " + what);
  }
});

test("the perturbation test is not vacuous: changing your own hand does change your view", () => {
  for (const S of states()) {
    const p = S.players[0];
    if (!p.hand.length || !p.deck.length) continue;
    const T = JSON.parse(JSON.stringify(S));
    const q = T.players[0];
    [q.hand[0], q.deck[0]] = [q.deck[0], q.hand[0]];
    if (S.cards[p.hand[0]].ref === S.cards[p.deck[0]].ref && S.cards[p.hand[0]].kind === S.cards[p.deck[0]].kind) continue;
    assert.notEqual(json(E.view(T, R, 0)), json(E.view(S, R, 0)));
    return;
  }
  assert.fail("no suitable state found");
});

test("a view has no seed, no random state, no rival hands or discards, and archives only as counts", () => {
  for (const S of states())
    for (const seat of [0, null]) {
      const v = E.view(S, R, seat);
      const text = json(v);
      assert.doesNotMatch(text, /"(seed|rng|ti|trashSeq|uidc)":/);
      for (const p of v.players) {
        assert.ok(!("deck" in p), "no deck list, only counts.deck");
        if (p.i !== seat) { assert.equal(p.hand, null); assert.equal(p.discard, null); }
        assert.equal(p.counts.hand, S.players[p.i].hand.length);
      }
      for (const L of Object.keys(v.stacks)) assert.equal(typeof v.stacks[L], "number");
      if (S.pending && S.pending.seat !== seat) assert.deepEqual(v.pending, { seat: S.pending.seat });
    }
});

test("your own private log details stay in your view; other players' are removed", () => {
  let mine = 0, theirs = 0;
  for (const S of states()) {
    if (!S.over) continue;
    const v = E.view(S, R, 0);
    for (const e of v.log) {
      const hide = E.PRIVATE_FIELDS[e.type];
      if (!hide) continue;
      for (const f of hide) {
        if (e.seat === 0) { assert.ok(f in e, `${e.type}.${f} missing from own event`); mine++; }
        else { assert.ok(!(f in e), `${e.type}.${f} leaked`); theirs++; }
      }
    }
  }
  assert.ok(mine > 20 && theirs > 20);
});

test("every log line in every view renders without gaps", () => {
  for (const S of states())
    for (const seat of [0, 1, null]) {
      const v = E.view(S, R, seat);
      for (const e of v.log) assert.doesNotMatch(E.describe(e, v, R), /undefined|NaN|\(\w+\)$/, json(e));
    }
});

test("a rival's purchase shows what was bought and for how much, not which cards paid", () => {
  for (const S of states()) {
    const e = S.log.find((x) => x.type === "buy" && x.seat !== 0);
    if (!e) continue;
    const v = E.view(S, R, 0);
    const seen = v.log[S.log.indexOf(e)];
    assert.equal(seen.disc, undefined);
    assert.equal(E.describe(seen, v, R), E.describe(e, S, R), "the line itself names no cards");
    return;
  }
  assert.fail("no rival purchase found");
});

test("your view has what the client needs to preview your own book and bonuses", () => {
  let checked = 0;
  for (const S of states()) {
    if (S.phase !== "play") continue;
    const seat = S.turn;
    const v = E.view(S, R, seat);
    const hand = S.players[seat].hand.filter((u) => S.cards[u].kind === "source");
    const shelf = S.players.flatMap((p) => p.shelf.map((e) => e.uid));
    for (const type of Object.keys(R.bonuses)) assert.equal(E.bonus(v, R, seat, type), E.bonus(S, R, seat, type));
    const strip = (r) => json({ ...r, ents: undefined });
    assert.equal(strip(E.bookCheck(v, R, seat, R.actions.book, hand, shelf)), strip(E.bookCheck(S, R, seat, R.actions.book, hand, shelf)));
    assert.equal(E.keepLimit(v, R, seat), E.keepLimit(S, R, seat));
    checked++;
  }
  assert.ok(checked > 100);
});
