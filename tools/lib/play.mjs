// Plays whole games the way the server will: newGame, advanceBots, then apply() for every human message,
// followed by advanceBots. Human seats make random choices (tools/lib/fuzz.mjs); some messages are corrupted
// on purpose. Used by the protocol and hidden-information tests.
import * as E from "../../engine/js/index.mjs";
import { fuzzRandom, fuzzAction, toMessage, hostileMessage } from "./fuzz.mjs";

// opts: { humans: number of human seats (from seat 0), hostile: chance a message is corrupted,
//         onState(S): called after every change, onHostile(info, result) }
export function playProtocolGame(R, nSeats, length, seed, opts = {}) {
  const { humans = nSeats, hostile = 0, onState = () => {}, onHostile = () => {} } = opts;
  const rnd = fuzzRandom(seed * 7919 + nSeats);
  const seats = Array.from({ length: nSeats }, (_, i) => ({ name: ["Prof. Ito", "Dr. Marsh", "Prof. Vance", "Dr. Okafor"][i % 4], bot: i >= humans }));
  let S = E.advanceBots(E.newGame(R, seats, length, seed), R).state;
  onState(S);
  const counts = { ok: 0, rejected: 0, hostile: 0 };
  let acts = 0, lastTurn = -1;
  while (!S.over) {
    const next = E.toAct(S);
    if (next.seat !== lastTurn) { acts = 0; lastTurn = next.seat; }
    let msg = toMessage(fuzzAction(S, R, rnd));
    if (next.kind === "turn" && ++acts > 15) msg = { type: "endTurn", keep: [] };
    let seat = next.seat;
    if (hostile && rnd() < hostile) {
      const h = hostileMessage(S, rnd, seat, msg);
      const before = JSON.stringify(S);
      const res = E.apply(S, R, h.seat, h.msg);
      if (JSON.stringify(S) !== before) throw new Error("apply() changed its input state");
      counts.hostile++;
      onHostile(h, res, S);
      if (res.error) continue;
      S = res.state; // a corrupted message can still be a legal move
    } else {
      const res = E.apply(S, R, seat, msg);
      if (res.error) { counts.rejected++; continue; }
      counts.ok++;
      S = res.state;
    }
    onState(S);
    S = E.advanceBots(S, R).state;
    onState(S);
  }
  return { S, counts };
}
