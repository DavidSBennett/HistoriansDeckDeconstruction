// Turns a log event into an English line. With full events (the engine's own log) the text is exactly the
// mock-up's; with events redacted by view() it names only what that player may know.
// `G` is the game state or a view: it needs players[].name and a cards lookup (array or object) for any card
// id the event still carries.
import { nameOf, src } from "./engine.mjs";

const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
const OUT_KIND = { source: "a source", action: "an action card", trash: "a trash card" };

export function describe(e, G, R) {
  const nm = (seat) => G.players[seat].name;
  const W = R.archiveWord;
  switch (e.type) {
    case "start":
      return "The game begins. It lasts " + e.rounds + " rounds.";
    case "draft":
      return nm(e.seat) + " begins in field " + e.L + " and takes " + e.n + " cards from that " + W + ".";
    case "playDraw":
      return nm(e.seat) + " plays " + R.actions[e.action].name + " and draws " + e.k + ".";
    case "organize":
      return nm(e.seat) + " organizes and throws out " + plural(e.n, "trash card") + ".";
    case "research":
      return (
        nm(e.seat) + " researches: " + (e.n ? "discards " + e.n + ", " : "") +
        (e.putBack ? "looks at " + e.seen + " and " : "") +
        "takes " + e.took + " from " + W + " " + e.L + (e.toHand ? " into hand" : "") + "."
      );
    case "conference":
      return nm(e.seat) + " presents a conference paper on “" + src(G, R, e.source).title + "” (+" + e.pts + ").";
    case "article":
      return nm(e.seat) + " publishes the article “" + e.title + "” (+" + e.pts + "), showcasing “" + src(G, R, e.show).title + "”.";
    case "book":
      return (
        nm(e.seat) + " publishes the BOOK “" + e.title + "”: " + e.n + " cards on thesis " + e.L + " (+" + e.pts + ")" +
        (e.sets.length ? ", with " + e.sets.join(" and ") : "") +
        (e.show ? ", showcasing " + nameOf(G, R, e.show) : "") +
        (e.cited.length ? ", citing " + [...new Set(e.cited.map(nm))].join(" and ") + " (+" + R.config.citePts + " per card cited)" : "") +
        "."
      );
    case "network":
      return (
        nm(e.seat) + " networks: discards " + e.n + " and takes " + R.actions[e.up].name + ", replacing " +
        (e.out !== undefined ? nameOf(G, R, e.out) : OUT_KIND[e.outKind]) +
        (e.outArchive ? " (back to " + W + " " + e.outArchive + ")" : "") + "."
      );
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
