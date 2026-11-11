// Random actions for testing: mostly plausible, some invalid. Used by the parity check (against the mock-up)
// and by the protocol and hidden-information tests. Picks come from a separate random generator, never the
// game's, so the game's random numbers are untouched.
import { keepLimit } from "../../engine/js/index.mjs";

export function fuzzRandom(seed) {
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
    const lim = keepLimit(S, R, S.turn);
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
      const fixed = kindOf(a) === "action" && Number.isInteger(R.actions[S.cards[a].ref].take);
      let disc = fixed && rnd() < 0.9 ? [] : sample(others, 1 + Math.floor(rnd() * others.length));
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
      const up = rnd() < 0.9 ? pick(R.piles.map((pl) => pl.pile)) : pick(Object.keys(R.actions));
      const repl = rnd() < 0.9 ? pick([...disc, ...p.discard]) : pick(others);
      return { fn: "network", args: [a, disc, up, repl] };
    }
  }
  throw new Error("unreachable");
}


// The same action as a protocol message.
export function toMessage({ fn, args }) {
  switch (fn) {
    case "draft": return { type: "draft", stack: args[0] };
    case "researchChoose": return { type: "researchChoose", putBack: args[0] };
    case "endTurn": return { type: "endTurn", keep: args[0] };
    case "draw": return { type: "playDraw", card: args[0] };
    case "organize": return { type: "organize", card: args[0], trash: args[1] };
    case "research": return { type: "research", card: args[0], discard: args[1], stack: args[2] };
    case "conference": return { type: "conference", card: args[0], source: args[1] };
    case "article": return { type: "article", card: args[0], sources: [args[1], args[2]], showcase: args[3] };
    case "book": return { type: "book", card: args[0], hand: args[1], shelf: args[2], showcase: args[3] };
    case "network": return { type: "network", card: args[0], discard: args[1], pile: args[2], replace: args[3] };
  }
  throw new Error("unknown fn " + fn);
}

// A message a careless or hostile client might send: repeated ids, wrong types, someone else's cards, the
// wrong seat's turn. `msg` is a plausible message to corrupt. Returns { seat, msg, mustFail }: mustFail is
// true when no version of the message could be legal (repeated id, wrong seat, oversized list, garbage).
export function hostileMessage(S, rnd, seat, msg) {
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const m = JSON.parse(JSON.stringify(msg));
  const lists = Object.keys(m).filter((k) => Array.isArray(m[k]) && m[k].length);
  const allIds = S.cards.map((_, u) => u).filter(Boolean);
  const r = rnd();
  if (r < 0.25 && lists.length) { const k = pick(lists); m[k] = [...m[k], m[k][0]]; return { seat, msg: m, mustFail: true, kind: "repeated id" }; }
  if (r < 0.4) {
    const others = S.players.map((p) => p.i).filter((i) => i !== seat);
    return { seat: others.length ? pick(others) : seat + 1, msg: m, mustFail: true, kind: "wrong seat" };
  }
  if (r < 0.5) return { seat, msg: { ...m, type: pick(["draft", "researchChoose", "endTurn", "explode", "__proto__", undefined]) }, mustFail: false, kind: "other type" };
  if (r < 0.6) {
    const k = pick(Object.keys(m).filter((x) => x !== "type"));
    if (k) m[k] = pick(["1", 1.5, -3, {}, [[1]], true, "A".repeat(500)]);
    return { seat, msg: m, mustFail: !!k, kind: "bad value" };
  }
  if (r < 0.75) {
    const k = pick(Object.keys(m).filter((x) => typeof m[x] === "number"));
    if (k) m[k] = pick(allIds);
    return { seat, msg: m, mustFail: false, kind: "another card" };
  }
  if (r < 0.85 && lists.length) { const k = pick(lists); m[k] = Array.from({ length: 150 }, (_, i) => i + 1); return { seat, msg: m, mustFail: true, kind: "oversized list" }; }
  return { seat, msg: pick([null, 7, "endTurn", [], { type: "endTurn", keep: "all" }]), mustFail: true, kind: "garbage" };
}
