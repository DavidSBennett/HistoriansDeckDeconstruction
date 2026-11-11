// Records games played by the JS engine, op by op, for the PHP engine to replay (engine/php/tests/conformance.php).
//   node tools/record-conformance.mjs [--out build/conformance/games.json] [--quick]
//   node tools/record-conformance.mjs --dump <game name> <op index>   writes the JS state after that op
//
// Each game is a list of ops, recorded the way the server will run them: newGame, advanceBots, then apply()
// for every human message (random choices from tools/lib/fuzz.mjs, 20% of them corrupted on purpose)
// followed by advanceBots. After every op the recording holds a hash of the canonical state and of the new
// events; after every change, a hash of the view for every seat and for a spectator. Bot-only games advance
// one turn at a time. Games run under the current data/ rules and under the mock-up's rules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as E from "../engine/js/index.mjs";
import { loadData } from "./validate-data.mjs";
import { loadMockup, mockupData } from "./lib/parity.mjs";
import { fuzzRandom, fuzzAction, toMessage, hostileMessage } from "./lib/fuzz.mjs";
import { canonHash } from "./lib/canon.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : dflt; };
const quick = argv.includes("--quick");

const RULES = { data: loadData("ai-history"), mockup: mockupData(loadMockup()) };
const R = { data: E.makeRules(RULES.data), mockup: E.makeRules(RULES.mockup) };

// The list of games: [name, rules, seats, length, seed, humans, hostile]
export function plan(quickPlan = false) {
  const out = [];
  const lengths = quickPlan ? ["short"] : ["short", "medium", "long"];
  for (const rules of ["data", "mockup"])
    for (const n of [2, 3, 4])
      for (const length of lengths) {
        const k = rules === "data" ? (quickPlan ? 2 : 3) : 1;
        for (let g = 0; g < k; g++) {
          const seed = 1000 * n + 100 * lengths.indexOf(length) + g + (rules === "mockup" ? 50 : 1);
          out.push({ name: `${rules}-${n}p-${length}-${g}`, rules, n, length, seed, humans: 1 + (g % n), hostile: 0.2 });
        }
        out.push({ name: `${rules}-${n}p-${length}-bots`, rules, n, length, seed: 7 * n + lengths.indexOf(length), humans: 0, hostile: 0 });
      }
  return out;
}

// Plays one planned game. onOp(index, op, S) sees every op and the state after it.
export function record(g, onOp = () => {}) {
  const Rg = R[g.rules];
  const rnd = fuzzRandom(g.seed * 31 + g.n);
  const seats = Array.from({ length: g.n }, (_, i) => ({ name: ["Prof. Ito", "Dr. Marsh", "Prof. Vance", "Dr. Okafor"][i], bot: i >= g.humans }));
  const ops = [];
  let S;
  const push = (op) => { ops.push(op); onOp(ops.length - 1, op, S); };
  const views = () => { for (const seat of [...S.players.map((p) => p.i), null]) push({ op: "view", seat, hash: canonHash(E.view(S, Rg, seat)) }); };

  S = E.newGame(Rg, seats, g.length, g.seed);
  push({ op: "newGame", hash: canonHash(S) });

  if (!g.humans) {
    let k = 0;
    while (!S.over) {
      const r = E.advanceBots(S, Rg, { maxTurns: 1 });
      S = r.state;
      push({ op: "advanceBots", maxTurns: 1, hash: canonHash(S), events: canonHash(r.events) });
      if (++k % 4 === 0) views();
    }
    views();
    return { ops, S };
  }

  const advance = () => {
    const r = E.advanceBots(S, Rg);
    S = r.state;
    push({ op: "advanceBots", hash: canonHash(S), events: canonHash(r.events) });
    views();
  };
  advance();
  let acts = 0, last = -1;
  while (!S.over) {
    const next = E.toAct(S);
    if (next.seat !== last) { acts = 0; last = next.seat; }
    let seat = next.seat;
    let msg = toMessage(fuzzAction(S, Rg, rnd));
    if (next.kind === "turn" && ++acts > 15) msg = { type: "endTurn", keep: [] };
    if (rnd() < g.hostile) ({ seat, msg } = hostileMessage(S, rnd, seat, msg));
    const json = JSON.stringify(msg) ?? "null";
    const r = E.apply(S, Rg, seat, JSON.parse(json)); // exactly what PHP will decode
    if (r.error) { push({ op: "apply", seat, msg: json, error: r.error }); continue; }
    S = r.state;
    push({ op: "apply", seat, msg: json, hash: canonHash(S), events: canonHash(r.events) });
    views();
    advance();
  }
  return { ops, S };
}

function main() {
  const dump = argv.indexOf("--dump");
  if (dump >= 0) {
    const [name, idx] = [argv[dump + 1], +argv[dump + 2]];
    const g = plan(false).concat(plan(true)).find((x) => x.name === name);
    if (!g) throw new Error("No game named " + name);
    let state = null;
    record(g, (i, op, S) => { if (i === idx) state = S; });
    const file = path.join(ROOT, "build", "conformance", "js-state.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 1));
    console.log("wrote " + path.relative(ROOT, file));
    return;
  }
  const out = path.resolve(ROOT, opt("out", "build/conformance/games.json"));
  const t0 = Date.now();
  const games = plan(quick).map((g) => {
    const { ops, S } = record(g);
    return { ...g, seats: S.players.map((p) => ({ name: p.name, bot: p.bot })), ops, final: S };
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ format: 1, rules: RULES, games }));
  const ops = games.reduce((t, g) => t + g.ops.length, 0);
  const applies = games.reduce((t, g) => t + g.ops.filter((o) => o.op === "apply").length, 0);
  const rejected = games.reduce((t, g) => t + g.ops.filter((o) => o.error).length, 0);
  console.log(`Recorded ${games.length} games, ${ops} ops (${applies} messages, ${rejected} rejected) in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, out)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
