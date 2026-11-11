// Turns a log event into the English line the mock-up wrote. Needs S only for player names and for the
// cards table (to name cards the event refers to by uid).
import { nameOf, src } from "./engine.mjs";

const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");

export function describe(e, S, R) {
  const nm = (seat) => S.players[seat].name;
  switch (e.type) {
    case "start":
      return "The game begins. It lasts " + e.rounds + " rounds.";
    case "draft":
      return nm(e.seat) + " begins in field " + e.L + " and takes " + e.n + " cards from that " + R.archiveWord + ".";
    case "playDraw":
      return nm(e.seat) + " plays " + R.actions[e.action].name + " and draws " + e.k + ".";
    case "organize":
      return nm(e.seat) + " organizes and throws out " + plural(e.n, "trash card") + ".";
    case "research":
      return (
        nm(e.seat) + " researches: " + (e.n ? "discards " + e.n + ", " : "") +
        (e.back.length ? "looks at " + e.seen + " and " : "") +
        "takes " + e.got.length + " from " + R.archiveWord + " " + e.L + (e.toHand ? " into hand" : "") + "."
      );
    case "conference":
      return nm(e.seat) + " presents a conference paper on “" + src(S, R, e.source).title + "” (+" + e.pts + ").";
    case "article":
      return nm(e.seat) + " publishes the article “" + e.title + "” (+" + e.pts + "), showcasing “" + src(S, R, e.show).title + "”.";
    case "book":
      return (
        nm(e.seat) + " publishes the BOOK “" + e.title + "”: " + e.n + " cards on thesis " + e.L + " (+" + e.pts + ")" +
        (e.sets.length ? ", with " + e.sets.join(" and ") : "") +
        (e.show ? ", showcasing " + nameOf(S, R, e.show) : "") +
        (e.cited.length ? ", citing " + [...new Set(e.cited.map(nm))].join(" and ") + " (+" + R.config.citePts + " per card cited)" : "") +
        "."
      );
    case "network": {
      const out = S.cards[e.out];
      return (
        nm(e.seat) + " networks: discards " + e.n + " and takes " + R.actions[e.up].name + ", replacing " + nameOf(S, R, e.out) +
        (out.kind === "source" ? " (back to " + R.archiveWord + " " + R.cards[out.ref].arg + ")" : "") + "."
      );
    }
    case "endTurn":
      return nm(e.seat) + " ends the turn" + (e.kept ? ", keeping " + plural(e.kept, "card") + " in hand" : "") + ".";
    case "trashPenalty":
      return nm(e.seat) + " loses " + e.pts + " prestige for " + plural(e.t, "trash card") + " left in the deck.";
    case "over":
      return "The game is over.";
    default:
      return "(" + e.type + ")";
  }
}
