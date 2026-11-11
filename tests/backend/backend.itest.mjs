// End-to-end test of the PHP backend: a throwaway SQLite database with Board-style accounts, PHP's built-in
// web server on the real backend/ folder, and HTTP requests made the way the browser client will make them.
//   npm run test:backend      (needs php 8.1+ with pdo_sqlite, which is loaded per command if it is not on)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dk-backend-"));
const dbFile = path.join(tmp, "test.sqlite");
const PW = { alice: "alice-pass-1", bob: "bob-pass-22", carol: "carol-pass-3", locky: "locky-pass-4", gone: "gone-pass-55" };
let server, base, phpArgs = [];

function phpHas(mod) {
  return execFileSync("php", ["-m"], { encoding: "utf8" }).toLowerCase().split(/\r?\n/).includes(mod);
}
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

before(async () => {
  if (!phpHas("pdo_sqlite")) phpArgs = ["-d", "extension=pdo_sqlite"];
  const users = Object.entries(PW).map(([username, password]) => ({ username, password, is_disabled: username === "gone" ? 1 : 0 }));
  fs.writeFileSync(path.join(tmp, "users.json"), JSON.stringify(users));
  execFileSync("php", [...phpArgs, path.join(ROOT, "backend/tests/setup_sqlite.php"), dbFile, path.join(tmp, "users.json")]);
  const cfg = path.join(tmp, "config.php");
  fs.writeFileSync(cfg, `<?php
define('DK_DB_DSN', ${JSON.stringify("sqlite:" + dbFile)});
define('DK_COOKIE_DOMAIN', '');
define('DK_COOKIE_SECURE', false);
define('DK_ALLOWED_ORIGIN_SUFFIX', '.thehistorians.org');
define('DK_ACCOUNTS_SITE', 'https://board.thehistorians.org');
`);
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn("php", [...phpArgs, "-d", "display_errors=1", "-d", "error_reporting=-1", "-S", `127.0.0.1:${port}`, "-t", path.join(ROOT, "backend")], {
    env: { ...process.env, DK_CONFIG: cfg }, stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + "/users_me.php"); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("PHP server did not start");
});
after(() => { server?.kill(); fs.rmSync(tmp, { recursive: true, force: true }); });

// A browser-like client: keeps its own cookies; sends JSON with this site's Origin unless told otherwise.
function client() {
  const jar = {};
  return {
    jar,
    async req(method, file, body, { origin = base, type = "application/json", bearer, query = "" } = {}) {
      const headers = {};
      if (Object.keys(jar).length) headers.Cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
      if (bearer) headers.Authorization = "Bearer " + bearer;
      if (body !== undefined) { headers["Content-Type"] = type; if (origin) headers.Origin = origin; }
      const res = await fetch(`${base}/${file}${query}`, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
      for (const c of res.headers.getSetCookie()) {
        const [pair, ...attrs] = c.split(";");
        const [k, v] = pair.split("=");
        const gone = v === "" || v === "deleted" || attrs.some((a) => /max-age=0/i.test(a.trim()));
        if (gone) delete jar[k.trim()]; else jar[k.trim()] = v;
      }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { throw new Error(`${file}: not JSON (status ${res.status}): ${text.slice(0, 300)}`); }
      return { status: res.status, json, text };
    },
    get(file, query = "", opts = {}) { return this.req("GET", file, undefined, { ...opts, query }); },
    post(file, body = {}, opts = {}) { return this.req("POST", file, body, opts); },
  };
}
async function signIn(name) {
  const c = client();
  const r = await c.post("users_login.php", { username: name, password: PW[name] });
  assert.equal(r.status, 200, r.text);
  c.token = r.json.session_token;
  return c;
}

let alice, bob, gameId;

test("signing in against Board-style accounts, by cookie or by Bearer token", async () => {
  const anon = client();
  const me = await anon.get("users_me.php");
  assert.equal(me.status, 401);
  assert.equal(me.json.accountsSite, "https://board.thehistorians.org");
  assert.equal((await anon.post("users_login.php", { username: "alice", password: "wrong" })).status, 401);
  assert.equal((await anon.post("users_login.php", { username: "nobody", password: "x" })).status, 401);
  assert.equal((await anon.post("users_login.php", { username: "gone", password: PW.gone })).status, 403, "disabled account");

  alice = await signIn("alice");
  assert.match(alice.token, /^[0-9a-f]{64}$/);
  assert.ok(alice.jar.th_session, "the shared cookie is set");
  const viaCookie = await alice.get("users_me.php");
  assert.equal(viaCookie.json.user.username, "alice");
  const viaBearer = await client().get("users_me.php", "", { bearer: alice.token });
  assert.equal(viaBearer.json.user.username, "alice");
  assert.equal((await signIn("ALICE".toLowerCase())).jar.th_session.length, 64);
});

test("ten wrong passwords lock the account for a while, as on Board", async () => {
  const c = client();
  for (let i = 0; i < 10; i++) assert.equal((await c.post("users_login.php", { username: "locky", password: "nope" })).status, 401);
  const r = await c.post("users_login.php", { username: "locky", password: PW.locky });
  assert.equal(r.status, 429, "even the right password is refused during the lockout");
});

test("cookie-authenticated POSTs must come from our own pages, as JSON", async () => {
  const evil = await alice.post("dk_createGame.php", { length: "short" }, { origin: "https://evil.example.com" });
  assert.equal(evil.status, 403);
  const plainHttp = await alice.post("dk_createGame.php", { length: "short" }, { origin: "http://board.thehistorians.org" });
  assert.equal(plainHttp.status, 403, "another thehistorians.org site must use https");
  const form = await alice.post("dk_createGame.php", "length=short", { type: "application/x-www-form-urlencoded" });
  assert.equal(form.status, 415);
  // A Bearer token is not sent automatically by browsers, so it needs no such check.
  const bearer = await client().post("dk_createGame.php", { length: "short" }, { bearer: alice.token, origin: "https://elsewhere.example" });
  assert.equal(bearer.status, 200);
});

test("lobby: create, join by code, leave, bots, host-only controls", async () => {
  bob = await signIn("bob");
  const carol = await signIn("carol");
  const created = await alice.post("dk_createGame.php", { length: "medium" }, { origin: "https://board.thehistorians.org" });
  assert.equal(created.status, 200, created.text);
  const g = created.json.game;
  gameId = g.game_id;
  assert.match(g.join_code, /^[A-HJ-KM-NP-Z2-9]{6}$/);
  assert.equal(g.is_host, true);

  const typed = g.join_code.slice(0, 3).toLowerCase() + "-" + g.join_code.slice(3);
  const j = await bob.post("dk_joinGame.php", { join_code: typed });
  assert.equal(j.json.game.you, 1);
  assert.equal((await bob.post("dk_joinGame.php", { join_code: g.join_code })).json.game.you, 1, "joining twice keeps the seat");
  assert.equal((await carol.post("dk_joinGame.php", { join_code: g.join_code })).json.game.you, 2);
  assert.equal((await bob.post("dk_joinGame.php", { join_code: "ZZZZZZ" })).status, 404);

  assert.equal((await bob.post("dk_addBot.php", { game_id: gameId })).status, 403);
  assert.equal((await bob.post("dk_removeSeat.php", { game_id: gameId, seat: 2 })).status, 403, "only the host removes others");
  const left = await carol.post("dk_removeSeat.php", { game_id: gameId, seat: 2 });
  assert.deepEqual(left.json.game.seats.map((s) => s.name), ["alice", "bob"]);
  const bot = await alice.post("dk_addBot.php", { game_id: gameId });
  assert.deepEqual(bot.json.game.seats.map((s) => [s.name, s.is_bot]), [["alice", false], ["bob", false], ["Prof. Vance", true]]);
  assert.equal((await carol.get("dk_getState.php", `?game_id=${gameId}`)).status, 403, "carol left, so she cannot watch");

  assert.equal((await alice.post("dk_setLength.php", { game_id: gameId, length: "epic" })).status, 400);
  assert.equal((await alice.post("dk_setLength.php", { game_id: gameId, length: "short" })).json.game.length, "short");
  assert.equal((await bob.post("dk_startGame.php", { game_id: gameId })).status, 403);
  const started = await alice.post("dk_startGame.php", { game_id: gameId });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.game.status, "playing");
  assert.equal(started.json.view.phase, "draft");
  assert.equal((await carol.post("dk_joinGame.php", { join_code: g.join_code })).status, 409, "no joining after the start");
});

test("polling: unchanged versions return nothing; rules come from the game's snapshot", async () => {
  const s = await alice.get("dk_getState.php", `?game_id=${gameId}`);
  const again = await alice.get("dk_getState.php", `?game_id=${gameId}&since=${s.json.game.version}`);
  assert.deepEqual(again.json, { ok: true, changed: false, version: s.json.game.version });
  const rules = await bob.get("dk_rules.php", `?game_id=${gameId}`);
  assert.equal(rules.json.rules.deck.cards.length, 40);
  assert.ok(rules.json.rules.market.length > 0);
});

test("a whole game over HTTP: turns, a Research choice, stale and out-of-turn moves refused, nothing hidden leaks", async () => {
  const players = [alice, bob];
  const rules = (await alice.get("dk_rules.php", `?game_id=${gameId}`)).json.rules;
  const kindOf = (v, u) => v.cards[u] && v.cards[u].kind === "action" ? rules.actions[v.cards[u].ref].kind : null;
  let checkedStale = false, checkedTurn = false, researched = false, moves = 0, logLen = {};

  for (let guard = 0; guard < 500; guard++) {
    const states = await Promise.all(players.map((c) => c.get("dk_getState.php", `?game_id=${gameId}`)));
    for (const [i, s] of states.entries()) {
      assert.equal(s.status, 200, s.text);
      assert.doesNotMatch(s.text, /"(seed|rng)"/);
      const v = s.json.view;
      v.players.forEach((p) => { if (p.i !== v.you) { assert.equal(p.hand, null); assert.equal(p.discard, null); } });
      logLen[i] = v.log.length;
    }
    const g = states[0].json.game;
    if (g.status === "finished") break;
    const actor = g.to_act; // the bot never waits, so this is a human seat
    const me = players[actor], other = players[1 - actor];
    const v = states[actor].json.view;

    if (!checkedTurn && v.phase === "play") {
      const r = await other.post("dk_action.php", { game_id: gameId, version: g.version, action: { type: "endTurn" } });
      assert.equal(r.status, 400);
      assert.equal(r.json.error, "It is not your turn.");
      checkedTurn = true;
    }
    if (!checkedStale && v.phase === "play") {
      const r = await me.post("dk_action.php", { game_id: gameId, version: g.version - 1, action: { type: "endTurn" } });
      assert.equal(r.status, 409);
      assert.equal(r.json.version, g.version);
      checkedStale = true;
    }

    let action;
    if (v.phase === "draft") {
      const stack = Object.keys(v.stacks).find((L) => v.stacks[L] >= rules.config.startCards);
      action = { type: "draft", stack };
    } else if (v.pending && v.pending.seat === v.you) {
      action = { type: "researchChoose", putBack: v.pending.seen.slice(0, v.pending.reject) };
    } else {
      const hand = v.players[v.you].hand;
      const research = hand.find((u) => kindOf(v, u) === "research");
      const stack = Object.keys(v.stacks).find((L) => v.stacks[L] > 0);
      action = research && stack && (!researched || moves % 3 === 0) ? { type: "research", card: research, stack } : { type: "endTurn", keep: [] };
    }
    const r = await me.post("dk_action.php", { game_id: gameId, version: g.version, action, log_from: logLen[actor] });
    assert.equal(r.status, 200, `${JSON.stringify(action)} -> ${r.text}`);
    assert.equal(r.json.version, g.version + 1);
    assert.equal(r.json.view.logFrom, logLen[actor], "only new log entries come back");
    if (action.type === "research") researched = true;
    moves++;
  }
  const end = await alice.get("dk_getState.php", `?game_id=${gameId}`);
  assert.equal(end.json.game.status, "finished");
  assert.equal(end.json.view.over, true);
  assert.ok(researched && checkedStale && checkedTurn);
  const late = await alice.post("dk_action.php", { game_id: gameId, version: end.json.game.version, action: { type: "endTurn" } });
  assert.equal(late.status, 409);
  const mine = await bob.get("dk_myGames.php");
  assert.ok(mine.json.games.some((x) => x.game_id === gameId && x.status === "finished"));
});

test("bad requests get clear errors, never a PHP warning or an empty body", async () => {
  const cases = [
    await alice.post("dk_action.php", { game_id: gameId }),
    await alice.post("dk_action.php", "{not json"),
    await alice.post("dk_action.php", [1, 2]),
    await alice.post("dk_action.php", { game_id: "x", version: 1 }),
    await alice.get("dk_getState.php", "?game_id=999999"),
    await alice.get("dk_action.php"),
  ];
  assert.deepEqual(cases.map((c) => c.status), [400, 400, 400, 400, 404, 405]);
  for (const c of cases) assert.equal(typeof c.json.error, "string");
});

test("signing out ends the session and clears the cookie", async () => {
  assert.equal((await bob.post("users_logout.php")).status, 200);
  assert.equal(bob.jar.th_session, undefined);
  assert.equal((await bob.get("users_me.php")).status, 401);
  assert.equal((await client().get("users_me.php", "", { bearer: bob.token })).status, 401, "the token is gone everywhere");
});
