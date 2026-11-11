// The action protocol: the only way the server changes a game.
//
//   apply(S, R, seat, action)  -> { state, events } | { error }
//   advanceBots(S, R)          -> { state, events }   (plays bot seats until a human must act or the game ends)
//
// Neither changes S; both return a new state. `seat` is the seat the server has authenticated; `action` is the
// client's message, untrusted. apply() checks the message's shape, that the game is not over, the phase, that
// it is this seat's turn, that a pending Research choice is finished first, and that no list repeats an id;
// then the engine checks the rules. Events are the new log entries (full, unredacted: see view.mjs).
//
// Messages (card ids are the integers the view shows):
//   { type: "draft",          stack }
//   { type: "playDraw",       card }
//   { type: "organize",       card, cards: [ids] }                 (trash cards, or under the current rules any cards)
//   { type: "research",       card, stack, discard?: [ids] }      (discard only for mock-up-style Research)
//   { type: "researchChoose", putBack: [ids] }
//   { type: "conference",     card, source }
//   { type: "article",        card, sources: [id, id], showcase }
//   { type: "book",           card, hand: [ids], shelf?: [ids], showcase? }
//   { type: "network",        card, discard: [ids], pile, replace }  (the mock-up's rules)
//   { type: "buy",            discard: [ids], pile }               (the current rules: no card needed)
//   { type: "endTurn",        keep?: [ids] }
import * as E from "./engine.mjs";
import { botDraft, botStep, botKeep } from "./bots.mjs";

const MAX_LIST = 100;
const isId = (x) => Number.isInteger(x) && x > 0;
const isName = (x) => typeof x === "string" && x.length > 0 && x.length <= 40;

// Field checkers return an error string or null.
const id = (name) => (a) => (isId(a[name]) ? null : `"${name}" must be a card id.`);
const optId = (name) => (a) => (a[name] === undefined || a[name] === null || isId(a[name]) ? null : `"${name}" must be a card id.`);
const name = (field) => (a) => (isName(a[field]) ? null : `"${field}" must be a name.`);
const ids = (field, { optional = false, len } = {}) => (a) => {
  const v = a[field];
  if (v === undefined && optional) return null;
  if (!Array.isArray(v) || v.length > MAX_LIST || !v.every(isId)) return `"${field}" must be a list of card ids.`;
  if (new Set(v).size !== v.length) return `"${field}" lists the same card twice.`;
  if (len !== undefined && v.length !== len) return `"${field}" must list ${len} cards.`;
  return null;
};

const MESSAGES = {
  draft: { fields: [name("stack")], run: (S, R, seat, a) => E.doDraft(S, R, a.stack) },
  playDraw: { fields: [id("card")], run: (S, R, seat, a) => E.doDraw(S, R, seat, a.card) },
  organize: { fields: [id("card"), ids("cards")], run: (S, R, seat, a) => E.doOrganize(S, R, seat, a.card, a.cards) },
  research: {
    fields: [id("card"), name("stack"), ids("discard", { optional: true })],
    run: (S, R, seat, a) => E.doResearch(S, R, seat, a.card, a.discard ?? [], a.stack),
  },
  researchChoose: { fields: [ids("putBack")], run: (S, R, seat, a) => E.finishResearch(S, R, S.pending, a.putBack) },
  conference: { fields: [id("card"), id("source")], run: (S, R, seat, a) => E.doConference(S, R, seat, a.card, a.source) },
  article: {
    fields: [id("card"), ids("sources", { len: 2 }), id("showcase")],
    run: (S, R, seat, a) => E.doArticle(S, R, seat, a.card, a.sources[0], a.sources[1], a.showcase),
  },
  book: {
    fields: [id("card"), ids("hand"), ids("shelf", { optional: true }), optId("showcase")],
    run: (S, R, seat, a) => E.doBook(S, R, seat, a.card, a.hand, a.shelf ?? [], a.showcase ?? null),
  },
  network: {
    fields: [id("card"), ids("discard"), name("pile"), id("replace")],
    run: (S, R, seat, a) => E.doNetwork(S, R, seat, a.card, a.discard, a.pile, a.replace),
  },
  buy: { fields: [ids("discard"), name("pile")], run: (S, R, seat, a) => E.doBuy(S, R, seat, a.discard, a.pile) },
  endTurn: { fields: [ids("keep", { optional: true })], run: (S, R, seat, a) => E.endTurn(S, R, a.keep ?? []) },
};
export const MESSAGE_TYPES = Object.keys(MESSAGES);

// Checks everything except the rules themselves. Returns an error string or null.
export function checkAction(S, seat, action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return "Bad message.";
  const m = Object.hasOwn(MESSAGES, action.type) ? MESSAGES[action.type] : null;
  if (!m) return "Unknown action.";
  if (!Number.isInteger(seat) || seat < 0 || seat >= S.players.length) return "You are not playing in this game.";
  if (S.over) return "The game is over.";
  if (action.type === "draft") {
    if (S.phase !== "draft") return "The draft is over.";
    if (seat !== S.draftAt) return "It is not your turn to choose a field.";
  } else {
    if (S.phase !== "play") return "The draft is not finished.";
    if (S.pending) {
      if (seat !== S.pending.seat) return "It is not your turn.";
      if (action.type !== "researchChoose") return "Finish choosing which Research cards to put back first.";
    } else {
      if (seat !== S.turn) return "It is not your turn.";
      if (action.type === "researchChoose") return "There is no Research choice to make.";
    }
  }
  for (const f of m.fields) {
    const e = f(action);
    if (e) return e;
  }
  return null;
}

const clone = (S) => JSON.parse(JSON.stringify(S));

export function apply(S, R, seat, action) {
  const bad = checkAction(S, seat, action);
  if (bad) return { error: bad };
  const T = clone(S);
  const before = T.log.length;
  const r = MESSAGES[action.type].run(T, R, seat, action);
  if (typeof r === "string") return { error: r };
  return { state: T, events: T.log.slice(before) };
}

// Who must act next: { seat, kind: "draft" | "research" | "turn" }, or null when the game is over.
export function toAct(S) {
  if (S.over) return null;
  if (S.phase === "draft") return { seat: S.draftAt, kind: "draft" };
  if (S.pending) return { seat: S.pending.seat, kind: "research" };
  return { seat: S.turn, kind: "turn" };
}

// Plays every bot whose turn it is, until a human must act or the game ends. Call it after newGame and after
// every successful apply().
export function advanceBots(S, R, { maxTurns = 10000 } = {}) {
  const T = clone(S);
  const before = T.log.length;
  for (let turns = 0; turns < maxTurns; turns++) {
    const next = toAct(T);
    if (!next || !T.players[next.seat].bot || next.kind === "research") break;
    if (next.kind === "draft") {
      if (typeof botDraft(T, R) === "string") throw new Error("A bot could not draft.");
      continue;
    }
    let steps = 0;
    while (botStep(T, R)) if (++steps > 500) throw new Error("A bot turn did not end.");
    E.endTurn(T, R, botKeep(T, R));
  }
  return { state: T, events: T.log.slice(before) };
}
