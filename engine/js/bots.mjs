// The mock-up's greedy bots, ported exactly. They act for the player whose turn it is (S.turn), or for the
// current drafter. Note that botDraft and the Research archive choice break ties with random() inside a
// sort comparator, so their use of random numbers depends on the sort algorithm; the PHP port must copy V8's.
import {
  random, def, src, tagsOf, isSource, isTrash, kindOf, refOf, bonus, keepLimit, allSources, bookCheck, sameEra,
  doDraft, doOrganize, doDraw, doBook, doArticle, doNetwork, doConference, doResearch, endTurn,
} from "./engine.mjs";

export function botDraft(S, R) {
  const Ls = R.letters.slice().sort((x, y) => S.stacks[y].length - S.stacks[x].length || random(S) - 0.5);
  return doDraft(S, R, Ls[0]);
}

// Which `k` of the seen cards to put back: the ones least connected to what the bot already holds.
export function botReject(S, R, seat, seen, k) {
  const p = S.players[seat];
  const own = allSources(S, p);
  const val = (u) =>
    !isSource(S, u)
      ? -1
      : own.filter((x) => src(S, R, x).arg === src(S, R, u).arg).length +
        p.shelf.filter((e) => tagsOf(S, R, e.uid).includes(src(S, R, u).arg)).length +
        (tagsOf(S, R, u).includes(p.field) ? 1 : 0);
  return seen.slice().sort((x, y) => val(x) - val(y)).slice(0, k);
}

export function botBook(S, R, seat, aUid) {
  const p = S.players[seat];
  const d = def(S, R, aUid);
  const min = d.min || R.config.bookMin;
  let best = null;
  for (const L of R.letters) {
    const hs = p.hand.filter((u) => isSource(S, u) && tagsOf(S, R, u).includes(L));
    if (hs.length < Math.min(R.config.bookMinFromHand, min)) continue;
    const own = [], riv = [];
    for (const q of S.players)
      for (const e of q.shelf)
        if (tagsOf(S, R, e.uid).includes(L) && !e.usedBy.includes(seat)) (q.i === seat ? own : riv).push(e.uid);
    for (let k = 0; k <= riv.length; k++) {
      const sh = own.concat(riv.slice(0, k));
      if (hs.length + sh.length < min) continue;
      const r = bookCheck(S, R, seat, d, hs, sh);
      if (!r.ok) continue;
      const val = r.pts - k * R.config.citePts;
      if (!best || val > best.val) best = { val, n: r.n, h: hs.slice(), sh, show: hs[0] };
    }
  }
  return best;
}

// Plays one action for the current player. Returns false when the bot has nothing more to do.
export function botStep(S, R) {
  const seat = S.turn;
  const p = S.players[seat];
  const H = (k) => p.hand.find((u) => kindOf(S, u) === "action" && def(S, R, u).kind === k);
  const srcs = () => p.hand.filter((u) => isSource(S, u));
  let a;
  if ((a = H("organize"))) {
    const t = [...p.hand, ...p.discard].filter((u) => isTrash(S, u));
    if (t.length && doOrganize(S, R, seat, a, t) === null) return true;
  }
  if ((a = H("draw"))) {
    doDraw(S, R, seat, a);
    return true;
  }
  if ((a = H("book"))) {
    const b = botBook(S, R, seat, a);
    if (b && doBook(S, R, seat, a, b.h, b.sh, b.show) === null) return true;
  }
  if ((a = H("article"))) {
    const s = srcs();
    for (let i = 0; i < s.length; i++)
      for (let j = i + 1; j < s.length; j++)
        if (sameEra(S, R, s[i], s[j])) {
          const show = src(S, R, s[i]).sub ? s[i] : s[j];
          if (doArticle(S, R, seat, a, s[i], s[j], show) === null) return true;
        }
  }
  const owned = allSources(S, p).length;
  if ((a = H("network")) && owned >= 4) {
    const others = p.hand.filter((u) => u !== a);
    const bon = (def(S, R, a).bonus || 0) + bonus(S, R, seat, "Letter");
    const have = (k) => [...p.deck, ...p.hand, ...p.discard, ...p.play].some((u) => kindOf(S, u) === "action" && refOf(S, u) === k);
    const opts = R.upgrades
      .filter((u) => S.market[u] && !have(u) && R.actions[u].value <= others.length + bon)
      .sort((x, y) => R.actions[y].value - R.actions[x].value);
    for (const u of opts) {
      const k = R.actions[u].kind;
      const need = Math.max(1, R.actions[u].value - bon);
      // Replace the basic card of the same kind. (This compares a card's action id with a kind name, which
      // works because each basic action's id equals its kind; kept exactly as in the mock-up.)
      let tgt = [...others, ...p.discard].find((c) => kindOf(S, c) === "action" && refOf(S, c) === k);
      if (!tgt && k === "draw")
        tgt = [...others, ...p.discard].find((c) => isTrash(S, c)) || others.find((c) => isSource(S, c)) || p.discard.find((c) => isSource(S, c));
      if (!tgt) continue;
      const pool = others
        .filter((c) => c !== tgt)
        .sort((x, y) => (isSource(S, x) ? 1 : 0) - (isSource(S, y) ? 1 : 0) || (isTrash(S, y) ? 1 : 0) - (isTrash(S, x) ? 1 : 0));
      const disc = others.includes(tgt) ? [tgt] : [];
      while (disc.length < need && pool.length) disc.push(pool.shift());
      if (disc.length < need) continue;
      if (doNetwork(S, R, seat, a, disc, u, tgt) === null) return true;
    }
  }
  if ((a = H("conference"))) {
    const s = srcs();
    if (s.length) {
      const cnt = (c) => allSources(S, p).filter((x) => src(S, R, x).era === src(S, R, c).era).length;
      s.sort((x, y) => cnt(x) - cnt(y));
      if (doConference(S, R, seat, a, s[0]) === null) return true;
    }
  }
  if ((a = H("research")) && owned < 10) {
    const others = p.hand.filter((u) => u !== a);
    if (others.length) {
      const cnt = {};
      for (const L of R.letters) cnt[L] = 0;
      for (const c of allSources(S, p)) cnt[src(S, R, c).arg] += 2;
      for (const e of p.shelf) cnt[src(S, R, e.uid).arg] += 3;
      const Ls = R.letters
        .filter((L) => S.stacks[L].length)
        .sort((x, y) => cnt[y] - cnt[x] || S.stacks[y].length - S.stacks[x].length || random(S) - 0.5);
      if (Ls.length && typeof doResearch(S, R, seat, a, others, Ls[0], botReject) === "object") return true;
    }
  }
  return false;
}

// Which cards the current player keeps at the end of the turn.
export function botKeep(S, R) {
  const seat = S.turn;
  const p = S.players[seat];
  const lim = keepLimit(S, R, seat);
  const own = allSources(S, p);
  const out = [];
  const cnt = (c) =>
    own.filter((x) => src(S, R, x).arg === src(S, R, c).arg).length +
    p.shelf.filter((e) => tagsOf(S, R, e.uid).includes(src(S, R, c).arg)).length;
  const bk = p.hand.find((u) => kindOf(S, u) === "action" && def(S, R, u).kind === "book");
  if (bk && own.length + p.shelf.length >= 4) out.push(bk);
  for (const c of p.hand.filter((u) => isSource(S, u)).sort((x, y) => cnt(y) - cnt(x))) out.push(c);
  const ar = p.hand.find((u) => kindOf(S, u) === "action" && def(S, R, u).kind === "article");
  if (ar) out.push(ar);
  return out.slice(0, lim);
}

// Plays a whole game with bots in every seat. Used by simulations and tests.
export function playBotGame(S, R, maxStepsPerTurn = 500) {
  while (S.phase === "draft") if (typeof botDraft(S, R) === "string") throw new Error("Bot cannot draft");
  while (!S.over) {
    let n = 0;
    while (botStep(S, R)) if (++n > maxStepsPerTurn) throw new Error("Bot turn did not end (seed " + S.seed + ")");
    endTurn(S, R, botKeep(S, R));
  }
  return S;
}
