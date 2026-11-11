// Runs the mock-up and the JS engine side by side on the same seed and the same decisions, and compares
// them after every step: the whole state (in the engine's shape), each action's return value, and every log
// line (engine events rendered by describe() against the mock-up's text).
//
// Two kinds of game:
//  - bot games: both sides run their own bots, so the engine's bots are checked too;
//  - fuzz games: some seats make random choices (mostly plausible, some invalid) that reach paths the bots
//    never take: Research put-back choices, unusual books, Network replacing an older discard, errors.
// With roundTrip on, the engine's state is serialised to JSON and parsed back before every step.
import { loadMockup } from "./load-mockup.mjs";
import * as E from "../../engine/js/index.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));

export function mockupRules(mock) {
  const { DATA, CONFIG, ACTIONS, BASE, TRASH, BONUS } = mock.consts;
  return E.makeRules(
    plain({
      config: { ...CONFIG, startingActions: BASE },
      actions: ACTIONS,
      bonuses: BONUS,
      trash: TRASH,
      deck: { id: "mockup", theses: DATA.theses, cards: DATA.cards },
    })
  );
}

// ---------- normalising both sides to one shape ----------
const uids = (arr) => arr.map((c) => c.uid);

export function normMock(mock) {
  const MS = mock.api.S, REG = mock.consts.REG;
  const cards = [null];
  for (let u = 1; u <= MS.uidc; u++) cards.push({ kind: REG[u].kind, ref: REG[u].ref });
  const stacks = {};
  for (const L of Object.keys(MS.stacks)) stacks[L] = uids(MS.stacks[L]);
  return plain({
    uidc: MS.uidc,
    cards,
    players: MS.players.map((p) => ({
      i: p.i, name: p.name, bot: !!p.bot,
      deck: uids(p.deck), hand: uids(p.hand), discard: uids(p.discard), play: uids(p.play),
      shelf: p.shelf.map((e) => ({ uid: e.card.uid, usedBy: e.usedBy.slice() })),
      cv: p.cv, prestige: p.prestige, cites: p.cites, field: p.field ?? null, trash: p.trash ?? null,
    })),
    stacks,
    market: MS.market,
    turn: MS.turn, round: MS.round, length: MS.length, phase: MS.phase, draftAt: MS.draftAt,
    pending: MS.pending
      ? { seat: MS.pending.p.i, seen: uids(MS.pending.seen), keepN: MS.pending.keepN, toHand: MS.pending.toHand, L: MS.pending.L, n: MS.pending.n }
      : null,
    over: MS.over, ti: MS.ti, trashSeq: MS.trashSeq,
  });
}

export function normEngine(S) {
  const { v, deckId, seed, rng, log, ...rest } = S;
  return plain(rest);
}

export function normMockReturn(r) {
  if (r === undefined || r === null || typeof r === "string") return r ?? null;
  if (r.pending) return { pending: true, seen: uids(r.seen), reject: r.reject, keepN: r.keepN };
  if (r.got) return { got: uids(r.got) };
  return plain(r);
}
export function normEngineReturn(r) {
  if (r === undefined || r === null || typeof r === "string") return r ?? null;
  return plain(r);
}

// First path at which two JSON values differ, or null.
export function firstDiff(a, b, path = "$") {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return { path, mock: a, engine: b };
  if (Array.isArray(a) !== Array.isArray(b)) return { path, mock: a, engine: b };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const d = firstDiff(a[k], b[k], path + (Array.isArray(a) ? "[" + k + "]" : "." + k));
    if (d) return d;
  }
  return null;
}

class Mismatch extends Error {}

// ---------- a side-by-side game ----------
export class SideBySide {
  constructor(mock, R, { seats, length, seed, roundTrip = true, checkEvery = true }) {
    this.mock = mock; this.R = R; this.roundTrip = roundTrip; this.checkEvery = checkEvery;
    this.seed = seed; this.steps = 0; this.logChecked = 0; this.trace = [];
    mock.api.newGame(seats.map((s) => ({ ...s })), length, seed);
    this.S = E.newGame(R, seats, length, seed);
    this.check("newGame");
  }
  get MS() { return this.mock.api.S; }
  get ctx() { return this.mock.ctx; }

  fail(what, detail) {
    throw new Mismatch(`seed ${this.seed}, step ${this.steps} (${what}): ${JSON.stringify(detail)}\nlast steps: ${this.trace.slice(-5).join(" | ")}`);
  }
  check(what, force = false) {
    if (!this.checkEvery && !force) return;
    const d = firstDiff(normMock(this.mock), normEngine(this.S));
    if (d) this.fail(what + ": state differs", d);
    const ml = this.MS.log, el = this.S.log;
    if (ml.length !== el.length) this.fail(what + ": log length differs", { mock: ml.length, engine: el.length });
    for (let i = this.logChecked; i < ml.length; i++) {
      const t = E.describe(el[i], this.S, this.R);
      if (ml[i].t !== t || ml[i].r !== el[i].r) this.fail(what + ": log line " + i + " differs", { mock: ml[i], engine: { r: el[i].r, t } });
    }
    this.logChecked = ml.length;
  }
  // Runs one step on both sides. mockFn/engineFn return each side's result.
  step(what, mockFn, engineFn) {
    this.steps++;
    this.trace.push(what);
    if (this.roundTrip) this.S = JSON.parse(JSON.stringify(this.S));
    const mr = normMockReturn(mockFn(this.ctx, this.MS));
    const er = normEngineReturn(engineFn(this.S, this.R));
    const d = firstDiff(mr, er);
    if (d) this.fail(what + ": return value differs", d);
    this.check(what);
    return er;
  }
  finish() {
    this.check("end", true);
    const d = firstDiff(
      plain(this.mock.api.ranking().map((p) => [p.i, p.prestige])),
      E.ranking(this.S).map((p) => [p.i, p.prestige])
    );
    if (d) this.fail("ranking differs", d);
    return this.S;
  }
}

// ---------- bot games ----------
export function botGame(mock, R, seats, length, seed, opts = {}) {
  const g = new SideBySide(mock, R, { seats: botSeats(seats), length, seed, ...opts });
  while (g.S.phase === "draft") g.step("botDraft", (c) => c.botDraft(), (S, R) => E.botDraft(S, R));
  while (!g.S.over) {
    botTurn(g);
  }
  return g.finish();
}
function botTurn(g) {
  let n = 0;
  while (g.step("botStep", (c) => c.botStep(), (S, R) => E.botStep(S, R))) if (++n > 500) g.fail("bot loop", n);
  // botKeep is compared as a value, then both sides end the turn with the same keep list.
  const keep = g.step("botKeep", (c) => c.botKeep(), (S, R) => E.botKeep(S, R));
  g.step("endTurn", (c) => c.endTurn(keep), (S, R) => E.endTurn(S, R, keep));
}
const botSeats = (n) => Array.from({ length: n }, (_, i) => ({ name: "Bot " + (i + 1), bot: true }));

// ---------- fuzz games ----------
function fuzzRandom(seed) {
  let a = (seed ^ 0x5bd1e995) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Picks a random action for the current seat from the engine's state (identical to the mock-up's while
// parity holds). Lists never repeat an id: repeated ids are the protocol layer's job to reject.
export function fuzzAction(S, R, rnd) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const sample = (arr, n) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, Math.max(0, n));
  };
  const subset = (arr, p) => arr.filter(() => rnd() < p);
  const addUnique = (arr, u) => (u === undefined || arr.includes(u) ? arr : [...arr, u]);
  const kindOf = (u) => S.cards[u].kind;

  if (S.phase === "draft") return { fn: "draft", args: [rnd() < 0.1 ? "Z" : pick(R.letters)] };
  if (S.pending) {
    const k = S.pending.seen.length - S.pending.keepN;
    const n = rnd() < 0.15 ? k + (rnd() < 0.5 ? -1 : 1) : k;
    return { fn: "researchChoose", args: [sample(S.pending.seen, n)] };
  }
  const p = S.players[S.turn];
  const actions = p.hand.filter((u) => kindOf(u) === "action");
  if (!actions.length || rnd() < 0.12) {
    const lim = E.keepLimit(S, R, S.turn);
    return { fn: "endTurn", args: [sample(p.hand, Math.floor(rnd() * (lim + 2)))] };
  }
  let a = pick(actions);
  let kind = R.actions[S.cards[a].ref].kind;
  if (rnd() < 0.05) { a = pick(p.hand); kind = pick(["conference", "article", "book", "research", "network", "organize", "draw"]); }
  const others = p.hand.filter((u) => u !== a);
  const sources = others.filter((u) => kindOf(u) === "source");
  const era = (u) => R.cards[S.cards[u].ref].era;
  const tags = (u) => { const d = R.cards[S.cards[u].ref]; return d.sub ? [d.arg, d.sub] : [d.arg]; };
  switch (kind) {
    case "draw":
      return { fn: "draw", args: [a] };
    case "organize": {
      let t = subset([...p.hand, ...p.discard].filter((u) => kindOf(u) === "trash"), 0.7);
      if (rnd() < 0.1) t = addUnique(t, pick(others));
      return { fn: "organize", args: [a, t] };
    }
    case "research": {
      let disc = sample(others, 1 + Math.floor(rnd() * others.length));
      if (rnd() < 0.05) disc = addUnique(disc, a);
      return { fn: "research", args: [a, disc, rnd() < 0.05 ? "Z" : pick(R.letters)] };
    }
    case "conference":
      return { fn: "conference", args: [a, rnd() < 0.85 ? pick(sources) : pick(others)] };
    case "article": {
      const pairs = [];
      for (let i = 0; i < sources.length; i++) for (let j = i + 1; j < sources.length; j++) if (era(sources[i]) === era(sources[j])) pairs.push([sources[i], sources[j]]);
      const [s1, s2] = pairs.length && rnd() < 0.8 ? pick(pairs) : sample(others, 2);
      const show = rnd() < 0.9 ? (rnd() < 0.5 ? s1 : s2) : pick(others);
      return { fn: "article", args: [a, s1, s2, show] };
    }
    case "book": {
      const L = pick(R.letters);
      let h = subset(sources.filter((u) => tags(u).includes(L)), 0.85);
      let sh = subset(S.players.flatMap((q) => q.shelf.map((e) => e.uid)).filter((u) => tags(u).includes(L)), 0.7);
      if (rnd() < 0.08) h = addUnique(h, pick(others));
      if (rnd() < 0.05) sh = addUnique(sh, pick(others));
      const r = rnd();
      const show = r < 0.85 ? pick(h) : r < 0.93 ? undefined : pick(others);
      return { fn: "book", args: [a, h, sh, show] };
    }
    case "network": {
      const disc = sample(others, Math.floor(rnd() * (others.length + 1)));
      const up = rnd() < 0.9 ? pick(R.upgrades) : pick(Object.keys(R.actions));
      const repl = rnd() < 0.9 ? pick([...disc, ...p.discard]) : pick(others);
      return { fn: "network", args: [a, disc, up, repl] };
    }
  }
  throw new Error("unreachable");
}

const MOCK_CALL = {
  draft: (c, MS, [L]) => c.doDraft(L),
  researchChoose: (c, MS, [rej]) => c.finishResearch(MS.pending, rej),
  endTurn: (c, MS, [keep]) => c.endTurn(keep),
  draw: (c, MS, [a]) => c.doDraw(MS.players[MS.turn], a),
  organize: (c, MS, [a, t]) => c.doOrganize(MS.players[MS.turn], a, t),
  research: (c, MS, [a, d, L]) => c.doResearch(MS.players[MS.turn], a, d, L),
  conference: (c, MS, [a, s]) => c.doConference(MS.players[MS.turn], a, s),
  article: (c, MS, [a, s1, s2, sh]) => c.doArticle(MS.players[MS.turn], a, s1, s2, sh),
  book: (c, MS, [a, h, sh, show]) => c.doBook(MS.players[MS.turn], a, h, sh, show),
  network: (c, MS, [a, d, up, r]) => c.doNetwork(MS.players[MS.turn], a, d, up, r),
};
const ENGINE_CALL = {
  draft: (S, R, [L]) => E.doDraft(S, R, L),
  researchChoose: (S, R, [rej]) => E.finishResearch(S, R, S.pending, rej),
  endTurn: (S, R, [keep]) => E.endTurn(S, R, keep),
  draw: (S, R, [a]) => E.doDraw(S, R, S.turn, a),
  organize: (S, R, [a, t]) => E.doOrganize(S, R, S.turn, a, t),
  research: (S, R, [a, d, L]) => E.doResearch(S, R, S.turn, a, d, L),
  conference: (S, R, [a, s]) => E.doConference(S, R, S.turn, a, s),
  article: (S, R, [a, s1, s2, sh]) => E.doArticle(S, R, S.turn, a, s1, s2, sh),
  book: (S, R, [a, h, sh, show]) => E.doBook(S, R, S.turn, a, h, sh, show),
  network: (S, R, [a, d, up, r]) => E.doNetwork(S, R, S.turn, a, d, up, r),
};

// Each seat is randomly a bot or a random player; at least one seat is random.
export function fuzzGame(mock, R, nSeats, length, seed, opts = {}) {
  const rnd = fuzzRandom(seed);
  const seats = Array.from({ length: nSeats }, (_, i) => ({ name: ["Prof. Ito", "Dr. Marsh", "Prof. Vance", "Dr. Okafor"][i % 4] + (i >= 4 ? " " + i : ""), bot: i > 0 && rnd() < 0.5 }));
  const g = new SideBySide(mock, R, { seats, length, seed, ...opts });
  const counts = {};
  while (g.S.phase === "draft") {
    const seat = g.S.draftAt;
    if (seats[seat].bot) g.step("botDraft", (c) => c.botDraft(), (S, R) => E.botDraft(S, R));
    else {
      const { fn, args } = fuzzAction(g.S, R, rnd);
      g.step(fn, (c, MS) => MOCK_CALL[fn](c, MS, args), (S, R) => ENGINE_CALL[fn](S, R, args));
    }
  }
  while (!g.S.over) {
    if (seats[g.S.turn].bot) {
      botTurn(g);
      continue;
    }
    let acts = 0;
    for (;;) {
      let { fn, args } = fuzzAction(g.S, R, rnd);
      if (fn !== "researchChoose" && ++acts > 15) ({ fn, args } = { fn: "endTurn", args: [[]] });
      const r = g.step(fn, (c, MS) => MOCK_CALL[fn](c, MS, args), (S, R) => ENGINE_CALL[fn](S, R, args));
      const key = fn + (r === null || typeof r === "object" ? ":ok" : ":err");
      counts[key] = (counts[key] || 0) + 1;
      if (fn === "endTurn") break;
    }
  }
  g.finish();
  // Rare paths reached, for the coverage report.
  const S = g.S, has = (k) => (counts[k] = (counts[k] || 0) + 1);
  for (const e of S.log) {
    if (e.type === "book" && e.cited.length) has("~book citing a rival");
    if (e.type === "book" && e.shelf.length && !e.cited.length) has("~book using own shelf");
    if (e.type === "book" && !e.show) has("~book with no showcase");
    if (e.type === "book" && e.sets.length === 2) has("~book scoring both sets");
    if (e.type === "research" && e.back.length) has("~research putting cards back");
    if (e.type === "research" && e.toHand) has("~research into hand");
    if (e.type === "network" && !e.disc.includes(e.out)) has("~network replacing an older discard");
    if (e.type === "network" && S.cards[e.out].kind === "source") has("~network returning a source");
    if (e.type === "trashPenalty") has("~trash penalty");
    if (e.type === "playDraw") has("~draw card played");
  }
  return counts;
}

export { loadMockup, Mismatch };
