// Scrambles everything a seat may not know (see tests/view.test.mjs).
import { PRIVATE_FIELDS } from "../../engine/js/index.mjs";

function shuffled(rnd, a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function split(pool, sizes) {
  const out = [];
  let k = 0;
  for (const n of sizes) { out.push(pool.slice(k, k + n)); k += n; }
  return out;
}

// Everything `seat` may not know, scrambled. Sizes stay the same: sizes are public.
export function perturb(S, seat, rnd) {
  const T = JSON.parse(JSON.stringify(S));
  T.seed = Math.floor(rnd() * 1e9);
  T.rng = Math.floor(rnd() * 2 ** 31);
  for (const q of T.players) {
    if (q.i === seat) { q.deck = shuffled(rnd, q.deck); continue; }
    [q.hand, q.deck, q.discard] = split(shuffled(rnd, [...q.hand, ...q.deck, ...q.discard]), [q.hand.length, q.deck.length, q.discard.length]);
  }
  // Archive contents and order, together with a rival's pending Research cards (they came off an archive).
  const Ls = Object.keys(T.stacks);
  const rivalPending = T.pending && T.pending.seat !== seat;
  const sizes = [...Ls.map((L) => T.stacks[L].length), rivalPending ? T.pending.seen.length : 0];
  const parts = split(shuffled(rnd, [...Ls.flatMap((L) => T.stacks[L]), ...(rivalPending ? T.pending.seen : [])]), sizes);
  Ls.forEach((L, i) => (T.stacks[L] = parts[i]));
  if (rivalPending) { T.pending.seen = parts.at(-1); T.pending.keepN = Math.floor(rnd() * 9); T.pending.L = "Q"; T.pending.toHand = rnd() < 0.5; }
  // Other players' private event details: replaced with nonsense.
  const junk = () => Array.from({ length: Math.floor(rnd() * 6) }, () => 1 + Math.floor(rnd() * T.uidc));
  for (const e of T.log) {
    if (e.seat === seat || !PRIVATE_FIELDS[e.type]) continue;
    for (const f of PRIVATE_FIELDS[e.type]) e[f] = Array.isArray(e[f]) ? junk() : 1 + Math.floor(rnd() * T.uidc);
  }
  // Hidden bookkeeping.
  T.ti = Object.fromEntries(Object.keys(T.ti).map((L) => [L, { a: 99, b: 7 }]));
  T.trashSeq = 12345;
  return T;
}

