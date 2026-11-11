// The rules, ported exactly from the mock-up (reference/The-Historians-Deckbuilder-Mockup.html).
//
// Differences from the mock-up are structural only:
//  - No globals. Every function takes the state S and the rules R (see rules.mjs) explicitly.
//  - S is plain JSON. Cards are numeric uids; S.cards[uid] = { kind, ref } replaces the REG global; the random
//    generator's state is the integer S.rng; a pending Research choice stores the seat, not a player object.
//  - Players are passed as seat numbers, not objects.
//  - The log holds structured events ({ r, type, ...fields }); describe.mjs renders them to the mock-up's English.
//
// Like the mock-up, every do* function validates first and changes S only if valid, returning null on success
// or an error string. doDraft, doResearch and finishResearch return an object on success. These functions
// trust that it is the caller's turn and that ids are not repeated; the protocol layer checks that.
import { random, shuffle } from "./rng.mjs";

const hasOwn = Object.hasOwn;

// ---------- card helpers ----------
export const kindOf = (S, uid) => S.cards[uid].kind;
export const refOf = (S, uid) => S.cards[uid].ref;
export const def = (S, R, uid) => R.actions[S.cards[uid].ref];
export const src = (S, R, uid) => R.cards[S.cards[uid].ref];
export const isSource = (S, uid) => S.cards[uid].kind === "source";
export const isTrash = (S, uid) => S.cards[uid].kind === "trash";
// A False Lead: a source marked falseLead, under rules that have False Leads (config.falseLead).
export const isFalseLead = (S, R, uid) => !!R.config.falseLead && S.cards[uid].kind === "source" && !!R.cards[S.cards[uid].ref].falseLead;
// Purchasing power: an action card's or a source's `power` (1 if a source has none); trash and False Leads have none.
export function powerOf(S, R, uid) {
  const c = S.cards[uid];
  if (c.kind === "action") return R.actions[c.ref].power ?? 0;
  if (c.kind !== "source" || isFalseLead(S, R, uid)) return 0;
  return R.cards[c.ref].power ?? 1;
}
export function tagsOf(S, R, uid) {
  const d = src(S, R, uid);
  return d.sub ? [d.arg, d.sub] : [d.arg];
}
export function nameOf(S, R, uid) {
  const c = S.cards[uid];
  if (c.kind === "source") return "“" + R.cards[c.ref].title + "”";
  if (c.kind === "trash") return R.trash[c.ref].name + " (trash)";
  return R.actions[c.ref].name;
}

function mk(S, kind, ref) {
  const uid = ++S.uidc;
  S.cards[uid] = { kind, ref };
  return uid;
}
function take(arr, uid) {
  const i = arr.indexOf(uid);
  return i < 0 ? null : arr.splice(i, 1)[0];
}
function log(S, ev) {
  S.log.push({ r: S.round, ...ev });
}

// ---------- player helpers ----------
export const trashCount = (S, seat) => {
  const p = S.players[seat];
  return [...p.deck, ...p.hand, ...p.discard, ...p.play].filter((u) => isTrash(S, u)).length;
};
// Passive bonus total for one source type: cards of that type in hand plus on the bookshelf. False Leads give
// no passive bonus; they have their own bookshelf effects (shelfEffect).
export function bonus(S, R, seat, type) {
  const p = S.players[seat];
  const counts = (u) => src(S, R, u).type === type && !isFalseLead(S, R, u);
  return R.bonuses[type].amt * (p.hand.filter((u) => isSource(S, u) && counts(u)).length + p.shelf.filter((e) => counts(e.uid)).length);
}
// Total of one bookshelf effect (falseLeads.json: hand, take, power, paper, article, book, cite, buys, keep)
// from the False Leads on a player's bookshelf.
export function shelfEffect(S, R, seat, key) {
  let t = 0;
  for (const e of S.players[seat].shelf) if (isFalseLead(S, R, e.uid)) t += R.falseLeads[src(S, R, e.uid).type]?.[key] || 0;
  return t;
}
export const keepLimit = (S, R, seat) => (R.config.keepCards ? R.config.keepCards + bonus(S, R, seat, "Diary") + shelfEffect(S, R, seat, "keep") : 0);
export const handLimit = (S, R, seat) => R.config.handSize + shelfEffect(S, R, seat, "hand");
export const books = (p) => p.cv.filter((x) => x.type === "book").length;
export const allSources = (S, p) => [...p.deck, ...p.hand, ...p.discard].filter((u) => isSource(S, u));
export function findShelf(S, uid) {
  for (const q of S.players) for (const e of q.shelf) if (e.uid === uid) return { e, owner: q.i };
  return null;
}
function actCheck(S, R, p, aUid, kind) {
  return p.hand.includes(aUid) && kindOf(S, aUid) === "action" && def(S, R, aUid).kind === kind;
}
function playCard(p, aUid) {
  take(p.hand, aUid);
  p.play.push(aUid);
}

// ---------- setup ----------
// seats: [{ name, bot }]. length: a key of config.rounds. seed: an integer (the server supplies it).
export function newGame(R, seats, length, seed) {
  if (!hasOwn(R.config.rounds, length)) throw new Error("Unknown game length: " + length);
  if (!Number.isInteger(seed)) throw new Error("newGame needs an integer seed");
  const S = {
    v: 1,
    deckId: R.deck.id ?? null,
    seed,
    rng: seed | 0,
    uidc: 0,
    cards: [null],
    players: [],
    stacks: {},
    market: {},
    turn: 0,
    round: 1,
    length,
    phase: "draft",
    draftAt: 0,
    pending: null,
    over: false,
    trashSeq: 0,
    ti: {},
    log: [],
  };
  for (const L of R.letters) {
    const idx = R.cards.map((d, i) => (d.arg === L ? i : -1)).filter((i) => i >= 0);
    S.stacks[L] = shuffle(S, idx).map((i) => mk(S, "source", i));
    for (let k = 0; k < R.config.trashPerStack; k++) S.stacks[L].push(mk(S, "trash", S.trashSeq++ % R.trash.length));
    shuffle(S, S.stacks[L]);
    S.ti[L] = { a: 0, b: 0 };
  }
  for (const pl of R.piles) S.market[pl.pile] = pl.tiers.length;
  if (R.config.buying) {
    S.returned = {}; // upgrades handed back by Organize, per pile; the last one is the next sold
    S.bought = 0; // purchases made this turn
  }
  seats.forEach((s, i) => {
    S.players.push({
      i, name: s.name, bot: !!s.bot,
      deck: R.base.map((b) => mk(S, "action", b)),
      hand: [], discard: [], play: [], shelf: [], cv: [],
      prestige: 0, cites: 0, field: null, trash: null,
    });
  });
  log(S, { type: "start", rounds: R.config.rounds[length] });
  return S;
}

export function doDraft(S, R, L) {
  const p = S.players[S.draftAt];
  if (S.phase !== "draft" || !p) return "Not drafting.";
  if (!hasOwn(S.stacks, L) || S.stacks[L].length < R.config.startCards) return "Not enough cards left in that " + R.archiveWord + ".";
  const got = S.stacks[L].splice(0, R.config.startCards);
  p.deck.push(...got);
  shuffle(S, p.deck);
  p.field = L;
  S.draftAt++;
  log(S, { type: "draft", seat: p.i, L, n: got.length, cards: got.slice() });
  if (S.draftAt >= S.players.length) {
    S.phase = "play";
    for (const q of S.players) draw(S, q.i, R.config.handSize);
  }
  return { got };
}

// Draws from the end of the deck array; reshuffles the discard pile into a new deck when the deck runs out.
export function draw(S, seat, n) {
  const p = S.players[seat];
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      if (!p.discard.length) break;
      p.deck = shuffle(S, p.discard);
      p.discard = [];
    }
    p.hand.push(p.deck.pop());
    k++;
  }
  return k;
}

// ---------- actions ----------
export function doDraw(S, R, seat, aUid) {
  const p = S.players[seat];
  if (!actCheck(S, R, p, aUid, "draw")) return "Not a draw card.";
  playCard(p, aUid);
  const k = draw(S, seat, def(S, R, aUid).draw);
  log(S, { type: "playDraw", seat, action: refOf(S, aUid), k });
  return null;
}

export function doOrganize(S, R, seat, aUid, uids) {
  const p = S.players[seat];
  if (!actCheck(S, R, p, aUid, "organize")) return "Not an organize card.";
  if (def(S, R, aUid).returns) return organizeReturn(S, R, seat, aUid, uids);
  if (!uids.length) return "Choose at least one trash card.";
  const found = (u) => p.hand.includes(u) || p.discard.includes(u);
  if (uids.some((u) => !found(u) || !isTrash(S, u))) return "Only trash cards in your hand or discard pile.";
  playCard(p, aUid);
  for (const u of uids) take(p.hand, u) ?? take(p.discard, u);
  log(S, { type: "organize", seat, n: uids.length, cards: uids.slice() });
  return null;
}

// Organize under the current rules: any cards from hand or discard pile go back where they came from. A source
// goes to the bottom of its card archive, an upgrade back on top of its pile in the conference space; basic
// cards and trash leave the game.
function organizeReturn(S, R, seat, aUid, uids) {
  const p = S.players[seat];
  if (!uids.length) return "Choose at least one card to return.";
  if (uids.includes(aUid)) return "Organize cannot return itself.";
  if (uids.some((u) => !p.hand.includes(u) && !p.discard.includes(u))) return "Only cards in your hand or discard pile.";
  playCard(p, aUid);
  const archives = {}, piles = [];
  let removed = 0;
  for (const u of uids) {
    take(p.hand, u) ?? take(p.discard, u);
    const c = S.cards[u];
    if (c.kind === "source") {
      const L = R.cards[c.ref].arg;
      S.stacks[L].push(u);
      archives[L] = (archives[L] || 0) + 1;
    } else if (c.kind === "action" && R.pileOfTier.has(c.ref) && S.returned) {
      const pile = R.pileOfTier.get(c.ref);
      if (!S.returned[pile]) S.returned[pile] = [];
      S.returned[pile].push(c.ref);
      piles.push(pile);
    } else removed++;
  }
  log(S, { type: "organize", seat, n: uids.length, archives, piles, removed, cards: uids.slice() });
  return null;
}

// Two kinds of Research card, set by the data:
//  - with `take` (the current rules): no cost; take `take` cards from the archive. `disc` must be empty.
//  - without it (the mock-up's rules): discard n cards from hand and take n (+ `bonus`).
// Either way, look effects (Map bonus, `look`) show extra cards and that many go back under the archive.
// chooser(S, R, seat, seenUids, k) -> uids to put back (bots). Without one, a put-back choice is parked in
// S.pending and finished later by finishResearch.
export function doResearch(S, R, seat, aUid, disc, L, chooser) {
  const p = S.players[seat];
  if (!actCheck(S, R, p, aUid, "research")) return "Not a research card.";
  const d = def(S, R, aUid);
  const fixed = Number.isInteger(d.take);
  disc = disc || [];
  if (fixed) {
    if (disc.length) return "This Research card needs no discards.";
  } else {
    if (!disc.length) return "Discard at least one card.";
    if (disc.includes(aUid) || disc.some((u) => !p.hand.includes(u))) return "Bad discard.";
  }
  if (!hasOwn(S.stacks, L) || !S.stacks[L].length) return "That " + R.archiveWord + " is empty.";
  const look = bonus(S, R, seat, "Map") + (d.look || 0);
  playCard(p, aUid);
  for (const u of disc) p.discard.push(take(p.hand, u));
  const want = (fixed ? d.take : disc.length + (d.bonus || 0)) + shelfEffect(S, R, seat, "take");
  const seen = S.stacks[L].splice(0, Math.min(want + look, S.stacks[L].length));
  const pend = { seat, seen, keepN: Math.min(want, seen.length), toHand: !!d.toHand, L, n: disc.length };
  if (seen.length <= pend.keepN) return finishResearch(S, R, pend, []);
  if (chooser) return finishResearch(S, R, pend, chooser(S, R, seat, seen, seen.length - pend.keepN));
  S.pending = pend;
  return { pending: true, seen: seen.slice(), reject: seen.length - pend.keepN, keepN: pend.keepN };
}

export function finishResearch(S, R, pend, rej) {
  const p = S.players[pend.seat];
  const k = pend.seen.length - pend.keepN;
  if (rej.length !== k || new Set(rej).size !== k || rej.some((u) => !pend.seen.includes(u))) return "Put back exactly " + k + ".";
  const got = pend.seen.filter((u) => !rej.includes(u));
  const back = pend.seen.filter((u) => rej.includes(u));
  S.stacks[pend.L].push(...back);
  (pend.toHand ? p.hand : p.discard).push(...got);
  S.pending = null;
  log(S, {
    type: "research", seat: pend.seat, n: pend.n, L: pend.L, seen: pend.seen.length,
    took: got.length, putBack: back.length, toHand: pend.toHand,
    got: got.slice(), back: back.slice(), // private to the researcher
  });
  return { got };
}

export function doConference(S, R, seat, aUid, sUid) {
  const p = S.players[seat];
  if (!actCheck(S, R, p, aUid, "conference")) return "Not a conference card.";
  if (!p.hand.includes(sUid) || !isSource(S, sUid)) return "Choose one source.";
  if (isFalseLead(S, R, sUid)) return "A False Lead cannot be presented as evidence.";
  const d = src(S, R, sUid);
  const pts = (def(S, R, aUid).pts || R.config.paperPts) + bonus(S, R, seat, "Speech") + shelfEffect(S, R, seat, "paper");
  playCard(p, aUid);
  p.discard.push(take(p.hand, sUid));
  p.prestige += pts;
  p.cv.push({ type: "paper", title: d.title, letter: d.arg, pts });
  log(S, { type: "conference", seat, source: sUid, pts });
  return null;
}

export const sameEra = (S, R, a, b) => src(S, R, a).era === src(S, R, b).era;
// Two sources can make an article if they share an era, or if both are False Leads (from any era). A False Lead
// never pairs with an ordinary source.
export function articlePair(S, R, a, b) {
  const fa = isFalseLead(S, R, a), fb = isFalseLead(S, R, b);
  return fa || fb ? fa && fb : sameEra(S, R, a, b);
}

export function doArticle(S, R, seat, aUid, s1, s2, show) {
  const p = S.players[seat];
  if (!actCheck(S, R, p, aUid, "article")) return "Not an article card.";
  if (!p.hand.includes(s1) || !p.hand.includes(s2) || s1 === s2 || !isSource(S, s1) || !isSource(S, s2)) return "Choose two sources.";
  if (!articlePair(S, R, s1, s2))
    return isFalseLead(S, R, s1) || isFalseLead(S, R, s2) ? "A False Lead can only be published with another False Lead." : "The two sources must share an era.";
  if (show !== s1 && show !== s2) return "Choose which card to showcase.";
  const fl = isFalseLead(S, R, s1) ? R.config.falseLead.articlePts : 0;
  const pts = R.config.articlePts + (def(S, R, aUid).pts || 0) + bonus(S, R, seat, "Report") + shelfEffect(S, R, seat, "article") + fl;
  playCard(p, aUid);
  take(p.hand, s1);
  take(p.hand, s2);
  const sc = show === s1 ? s1 : s2;
  const other = show === s1 ? s2 : s1;
  const L = src(S, R, sc).arg;
  p.shelf.push({ uid: sc, usedBy: [] });
  p.discard.push(other);
  p.prestige += pts;
  const tl = R.theses[L].articles;
  const title = tl[S.ti[L].a++ % tl.length];
  p.cv.push({ type: "article", title, letter: L, pts });
  log(S, { type: "article", seat, title, pts, show: sc, other, ...(fl ? { falseLead: true } : {}) });
  return null;
}

// Sets a group of source cards (card data objects) scores in a book.
export function bookSets(R, defs) {
  const out = [];
  const nums = [...new Set(defs.map((d) => d.num))].sort((a, b) => a - b);
  let best = [], run = [];
  for (const n of nums) {
    if (run.length && n === run[run.length - 1] + 1) run.push(n);
    else run = [n];
    if (run.length > best.length) best = run.slice();
  }
  if (best.length >= R.config.runMin)
    out.push({ name: "Sequence", pts: R.config.runPts, why: "Nos. " + best[0] + "–" + best[best.length - 1] });
  const types = new Set(defs.map((d) => d.type));
  if (types.size >= R.config.typesMin) out.push({ name: "Range of Sources", pts: R.config.typesPts, why: types.size + " source types" });
  return out;
}

// Book value by number of cards; past the end of the table each card adds one more than the last step did.
export function bookCardPts(R, n) {
  const t = R.config.bookCardPts;
  const mx = Math.max(...Object.keys(t).map(Number));
  return n <= mx ? t[n] || 0 : t[mx] + (n - mx) * (t[mx] - t[mx - 1] + 1);
}

// Pure check and scoring of a book; the client calls it live while the player selects.
// handUids must already be known to be in the player's hand.
export function bookCheck(S, R, seat, actionDef, handUids, shelfUids) {
  const min = actionDef.min || R.config.bookMin;
  const ents = [];
  for (const u of shelfUids) {
    const f = findShelf(S, u);
    if (!f) return { ok: false, msg: "Bad shelf card." };
    if (f.e.usedBy.includes(seat)) return { ok: false, msg: "You have already used “" + src(S, R, u).title + "” in a book." };
    ents.push(f);
  }
  const all = [...handUids, ...ents.map((f) => f.e.uid)];
  const n = all.length;
  if (handUids.some((u) => !isSource(S, u))) return { ok: false, msg: "Sources only." };
  if (n < min) return { ok: false, msg: n + " of " + min + " cards chosen." };
  if (handUids.length < Math.min(R.config.bookMinFromHand, min))
    return { ok: false, msg: "At least " + R.config.bookMinFromHand + " cards must come from your hand." };
  // Either every card is a False Lead (any theses), or none is and they share a thesis letter.
  const fls = all.filter((u) => isFalseLead(S, R, u)).length;
  if (fls && fls < n) return { ok: false, msg: "False Leads can only be published with other False Leads." };
  const ok = fls ? R.letters.slice() : R.letters.filter((L) => all.every((u) => tagsOf(S, R, u).includes(L)));
  if (!ok.length) return { ok: false, msg: "The cards do not share a thesis letter." };
  const argCount = (L) => all.filter((u) => src(S, R, u).arg === L).length;
  ok.sort((x, y) => argCount(y) - argCount(x));
  const sets = bookSets(R, all.map((u) => src(S, R, u)));
  const flPts = fls ? fls * R.config.falseLead.bookCardPts : 0;
  const base = bookCardPts(R, n) + R.config.bookBonus + (actionDef.pts || 0) + bonus(S, R, seat, "Photograph") + shelfEffect(S, R, seat, "book") + flPts;
  const pts = base + sets.reduce((t, x) => t + x.pts, 0);
  const sx = sets.length ? " Sets: " + sets.map((x) => x.name + " (" + x.why + ") +" + x.pts).join(", ") + "." : " No sets yet.";
  return {
    ok: true, letter: ok[0], pts, sets, ents, n, falseLead: fls > 0,
    msg: n + (fls ? " False Leads" : " cards on thesis " + ok[0]) + ": " + base + " base" + (sets.length ? " + " + (pts - base) + " in sets" : "") + " = " + pts + " prestige." + sx,
  };
}

export function doBook(S, R, seat, aUid, handUids, shelfUids, showUid) {
  const p = S.players[seat];
  if (!actCheck(S, R, p, aUid, "book")) return "Not a book card.";
  if (showUid && !handUids.includes(showUid)) return "The showcased card must be one of the cards from your hand.";
  if (handUids.some((u) => !p.hand.includes(u))) return "Bad hand card.";
  const r = bookCheck(S, R, seat, def(S, R, aUid), handUids, shelfUids);
  if (!r.ok) return r.msg;
  playCard(p, aUid);
  for (const u of handUids) {
    take(p.hand, u);
    if (u === showUid) p.shelf.push({ uid: u, usedBy: [seat] });
    else if (R.bookCardsTo === "archive") S.stacks[src(S, R, u).arg].push(u); // the mock-up's rule
    else p.discard.push(u); // they stay in the author's deck
  }
  const cited = [];
  for (const f of r.ents) {
    f.e.usedBy.push(seat);
    if (f.owner !== seat) {
      const o = S.players[f.owner];
      o.prestige += R.config.citePts + bonus(S, R, f.owner, "Newspaper") + shelfEffect(S, R, f.owner, "cite");
      o.cites++;
      cited.push(f.owner);
    }
  }
  p.prestige += r.pts;
  const tl = R.theses[r.letter].books;
  const title = tl[S.ti[r.letter].b++ % tl.length];
  p.cv.push({ type: "book", title, letter: r.letter, pts: r.pts, n: r.n });
  log(S, {
    type: "book", seat, title, n: r.n, L: r.letter, pts: r.pts, sets: r.sets.map((x) => x.name),
    show: showUid || null, cited, hand: handUids.slice(), shelf: shelfUids.slice(), ...(r.falseLead ? { falseLead: true } : {}),
  });
  return null;
}

// The tier the next buyer of a pile gets (deeper copies are stronger), or null if the pile is empty.
// Upgrades returned by Organize (S.returned) sit on top of the pile and are sold first, the last returned first.
export function nextTier(S, R, pileId) {
  const pl = R.pileById.get(pileId);
  if (!pl) return null;
  const back = S.returned?.[pileId];
  if (back?.length) return back[back.length - 1];
  const left = S.market[pileId];
  return left ? pl.tiers[pl.tiers.length - left] : null;
}
export const pileLeft = (S, pileId) => (S.market[pileId] || 0) + (S.returned?.[pileId]?.length || 0);

// Purchasing power of a set of discards for one player: the cards' power, plus network cards held (each adds
// its bonus while in hand), Letters' passive bonus and False Lead bookshelf effects.
export function buyPower(S, R, seat, disc) {
  const p = S.players[seat];
  let t = 0;
  for (const u of disc) t += powerOf(S, R, u);
  for (const u of p.hand) if (kindOf(S, u) === "action" && def(S, R, u).kind === "network") t += def(S, R, u).bonus || 0;
  return t + bonus(S, R, seat, "Letter") + shelfEffect(S, R, seat, "power");
}
export const buysLeft = (S, R, seat) => (R.config.buying ? R.config.buying.perTurn + shelfEffect(S, R, seat, "buys") - (S.bought || 0) : 0);

// Buying, an ability every player has under the current rules: discard cards from hand whose purchasing power
// adds up to at least a pile's price, and put the pile's next upgrade on your discard pile.
export function doBuy(S, R, seat, disc, pileId) {
  const p = S.players[seat];
  if (!R.config.buying) return "There is no buying in these rules.";
  if (buysLeft(S, R, seat) < 1) return "You have already bought this turn.";
  const pl = R.pileById.get(pileId);
  if (!pl || !pileLeft(S, pileId)) return "That upgrade is gone.";
  if (!disc.length) return "Discard at least one card.";
  if (disc.some((u) => !p.hand.includes(u))) return "Bad discard.";
  const power = buyPower(S, R, seat, disc);
  if (power < pl.value) return "Those cards are worth " + power + "; that upgrade costs " + pl.value + ".";
  const tier = nextTier(S, R, pileId);
  if (S.returned[pileId]?.length) S.returned[pileId].pop();
  else S.market[pileId]--;
  for (const u of disc) p.discard.push(take(p.hand, u));
  p.discard.push(mk(S, "action", tier));
  S.bought++;
  log(S, { type: "buy", seat, n: disc.length, power, pile: pileId, up: tier, disc: disc.slice() });
  return null;
}

export function doNetwork(S, R, seat, aUid, disc, pileId, replUid) {
  const p = S.players[seat];
  if (!actCheck(S, R, p, aUid, "network")) return "Not a network card.";
  if (R.config.buying) return "There is no Network action in these rules: buy instead.";
  const pl = R.pileById.get(pileId);
  if (!pl || !S.market[pileId]) return "That upgrade is gone.";
  if (!disc.length) return "Discard at least one card.";
  if (disc.includes(aUid) || disc.some((u) => !p.hand.includes(u))) return "Bad discard.";
  if (disc.length + (def(S, R, aUid).bonus || 0) + bonus(S, R, seat, "Letter") < pl.value) return "You need to discard more cards for that upgrade.";
  if (!disc.includes(replUid) && !p.discard.includes(replUid)) return "Choose a card in your discard pile to replace.";
  const tier = nextTier(S, R, pileId);
  playCard(p, aUid);
  for (const u of disc) p.discard.push(take(p.hand, u));
  const out = take(p.discard, replUid);
  if (isSource(S, out)) S.stacks[src(S, R, out).arg].push(out);
  p.discard.push(mk(S, "action", tier));
  S.market[pileId]--;
  log(S, {
    type: "network", seat, n: disc.length, pile: pileId, up: tier,
    outKind: kindOf(S, out), outArchive: isSource(S, out) ? src(S, R, out).arg : null,
    out, disc: disc.slice(), // private to the buyer
  });
  return null;
}

// Ends the current player's turn, keeping up to keepLimit cards (extra ids are ignored, as in the mock-up).
export function endTurn(S, R, keepUids) {
  const seat = S.turn;
  const p = S.players[seat];
  const lim = keepLimit(S, R, seat);
  const keep = [];
  for (const u of [].concat(keepUids || []).slice(0, lim)) {
    const c = take(p.hand, u);
    if (c !== null) keep.push(c);
  }
  p.discard.push(...p.hand, ...p.play);
  const kn = keep.length;
  p.hand = keep;
  p.play = [];
  draw(S, seat, Math.max(0, handLimit(S, R, seat) - kn));
  if (R.config.buying) S.bought = 0;
  log(S, { type: "endTurn", seat, kept: kn });
  S.turn = (S.turn + 1) % S.players.length;
  if (S.turn === 0) {
    if (S.round >= R.config.rounds[S.length]) {
      S.over = true;
      for (const q of S.players) {
        const t = trashCount(S, q.i);
        q.trash = t;
        if (t && R.config.trashPenalty) {
          q.prestige -= t * R.config.trashPenalty;
          log(S, { type: "trashPenalty", seat: q.i, t, pts: t * R.config.trashPenalty });
        }
      }
      log(S, { type: "over" });
      return null;
    }
    S.round++;
  }
  return null;
}

// Players by prestige, then by number of books (stable, so seat order breaks remaining ties).
export function ranking(S) {
  return S.players.slice().sort((a, b) => b.prestige - a.prestige || books(b) - books(a));
}

export { random, shuffle };
