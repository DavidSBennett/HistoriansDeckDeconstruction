// What one seat may see of a game: the only thing the server ever sends a client.
//
//   view(S, R, seat)   seat = the viewer's seat, or null for a spectator
//
// A player sees: their own hand and discard pile; everyone's bookshelf, CV, prestige, citations, field and
// played cards; every pile's size; each archive's size (never its order or contents); the conference space;
// their own pending Research cards; and the log with other players' private details removed.
// Never sent: other players' hands and discard piles, the order or contents of any deck (including your own)
// or archive, the seed or the random generator's state.
//
// The view keeps the state's shape where it can (players[].hand, players[].shelf, a cards lookup), so the
// client can run engine helpers such as bookCheck() and bonus() on it for its own seat.

// Event fields only the acting player may see. Everything else in an event is public.
export const PRIVATE_FIELDS = {
  draft: ["cards"], // the cards drawn from the archive
  organize: ["cards"], // which cards were thrown out or returned (where they went stays public)
  research: ["got", "back"], // which cards were taken and put back
  article: ["other"], // the source that went to the discard pile
  book: ["hand"], // hand cards other than the showcase, now in the author's discard pile (the showcase stays public)
  network: ["out", "disc"], // the replaced card and the discards (kind and archive stay public)
  buy: ["disc"], // the discards (their number and total power stay public)
};

export function redactEvent(e, seat) {
  const hide = PRIVATE_FIELDS[e.type];
  if (!hide || e.seat === seat) return { ...e };
  const out = { ...e };
  for (const f of hide) delete out[f];
  return out;
}

// Card ids an event (as the viewer receives it) refers to.
function eventCards(e) {
  const out = [];
  for (const k of ["source", "show", "other", "out"]) if (Number.isInteger(e[k])) out.push(e[k]);
  for (const k of ["cards", "got", "back", "hand", "shelf", "disc"]) if (Array.isArray(e[k])) out.push(...e[k]);
  return out;
}

export function view(S, R, seat) {
  const me = Number.isInteger(seat) && seat >= 0 && seat < S.players.length ? seat : null;
  const visible = new Set();
  const see = (uids) => { for (const u of uids) visible.add(u); };

  const players = S.players.map((p) => {
    const mine = p.i === me;
    see(p.play);
    see(p.shelf.map((e) => e.uid));
    if (mine) { see(p.hand); see(p.discard); }
    return {
      i: p.i, name: p.name, bot: p.bot, field: p.field,
      prestige: p.prestige, cites: p.cites, trash: p.trash,
      cv: p.cv.map((x) => ({ ...x })),
      shelf: p.shelf.map((e) => ({ uid: e.uid, usedBy: e.usedBy.slice() })),
      play: p.play.slice(),
      hand: mine ? p.hand.slice() : null,
      discard: mine ? p.discard.slice() : null,
      counts: { deck: p.deck.length, hand: p.hand.length, discard: p.discard.length },
    };
  });

  let pending = null;
  if (S.pending) {
    if (S.pending.seat === me) {
      pending = { seat: me, seen: S.pending.seen.slice(), reject: S.pending.seen.length - S.pending.keepN, keepN: S.pending.keepN, L: S.pending.L, toHand: S.pending.toHand };
      see(pending.seen);
    } else pending = { seat: S.pending.seat };
  }

  const log = S.log.map((e) => redactEvent(e, me));
  for (const e of log) see(eventCards(e));

  const cards = {};
  for (const u of [...visible].sort((a, b) => a - b)) cards[u] = { kind: S.cards[u].kind, ref: S.cards[u].ref };

  const stacks = {};
  for (const L of Object.keys(S.stacks)) stacks[L] = S.stacks[L].length;

  return {
    v: S.v, deckId: S.deckId, you: me,
    length: S.length, round: S.round, rounds: R.config.rounds[S.length],
    phase: S.phase, draftAt: S.draftAt, turn: S.turn, over: S.over,
    stacks, market: { ...S.market },
    ...(S.returned ? { returned: JSON.parse(JSON.stringify(S.returned)), bought: S.bought } : {}),
    players, pending, cards, log,
  };
}
