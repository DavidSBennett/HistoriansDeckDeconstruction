# Architecture and decisions

Status: build steps 1–6 done (2026-11-11); next is step 7, the React client. The original spec is [BRIEF.md](BRIEF.md); this file records what
was decided since and where the mock-up's code differs from the brief.

## Decisions

| Date | Decision |
|---|---|
| 2026-11-11 | Stay on GreenGeeks: PHP/MySQL backend, React/Vite client, clients poll. |
| 2026-11-11 | Two engines: JavaScript is the reference (simulation, client previews, test-game generator); PHP is authoritative on the server. Both read the same `data/` JSON. |
| 2026-11-11 | Hosted at **projecta.thehistorians.org** (subdomain already exists). |
| 2026-11-11 | Accounts come from **Board's database** (board.thehistorians.org `users` / `user_sessions`), so existing Board accounts work. |
| 2026-11-11 | **Sign in once everywhere:** a shared session cookie on `.thehistorians.org` (see Login below). |
| 2026-11-11 | **Research is redesigned** (draw X from a card archive, no discard cost) and upgrade piles grow stronger the deeper you buy, at a fixed price (see Rules changes). The exact port comes first, so parity with the mock-up is proven before any rule changes. |

## Build order

1. ✔ Repo setup; mock-up constants extracted to `data/`; data validator; mock-up simulator.
2. ✔ JS engine: exact port with serialisable state, checked against the mock-up step by step (see "The JS engine" below). **Review stop.**
3. ✔ Rules changes in the JS engine (Research, tiered upgrade piles), with new reference numbers. **Review stop.**
4. ✔ Protocol wrapper (turn, phase, pending choice, repeated ids), structured events, `view(state, seat)`, and hidden-information tests (see "Protocol and views" below).
5. ✔ PHP engine plus conformance: the JS engine records test games, the PHP engine replays them and must match exactly; GitHub Actions runs both (see "The PHP engine" below). **Review stop.**
6. ✔ Shared login, DB migrations, PHP backend (lobby, polling, actions, server-side bots), tested end to end over HTTP (see "Backend and login" below).
7. React client, using the mock-up's layout and click flow.
8. Deploy workflow to projecta.thehistorians.org; first migration run by hand; two-browser smoke test.

## Rules changes (step 3)

**Name change.** The argument stacks are now called **card archives** in all player-facing text. Code and
data keep the name `stacks`.

**Research (decided 2026-11-11).**
- Card text: "Draw X cards from a card archive." Play it, click a card archive, and take its top X cards
  into your **discard pile**, as before.
- **No discard cost.** That's the point of the new card. `research` takes only `{ actionUid, stack }`.
- The basic Research card draws **2**.
- Research upgrades are one pile in the conference space. The first copy draws **4** and the second draws **5**.
  These replace the text of Travel Grant and Research Assistant, and their old effects (look 2; look 1 and
  kept cards to hand) are gone.
- Look effects remain only through passive bonuses. A Map in hand or on your shelf still lets you see 1 more
  card per Map and put that many back under the archive, so `researchChoose` stays in the protocol.

**Upgrade piles grow in power (decided 2026-11-11).** Each upgrade pile is an ordered stack of tiers: the
deeper the pile has been bought, the stronger the copy, so a late buyer gets a more powerful card. **Only the
effect grows; a pile's price stays the same.** The number of tiers is the number of copies (it replaces
`upgradeCopies`).

**How it is stored.** Each tier is its own entry in `actions.json`, with its own name, text and effect
numbers. `data/market.json` lists the piles in display order, each with one price and its tiers from the top
down. The protocol buys by pile id (`network` takes `pile`), and `nextTier(S, R, pile)` says which card the
next buyer gets.

```json
{ "pile": "research", "value": 3, "tiers": ["travel", "assistant"] }
```

A Research card with `take` draws that many at no cost. A Research card without `take` works as in the
mock-up (discard n, take n). With no `market.json`, every upgrade becomes a pile of `upgradeCopies`
identical copies. These two fallbacks are what the mock-up's rules look like, which is why the 11,700-game
parity check still runs against the mock-up after the rule changes.

Placeholder tiers, there only so there's something to rebalance (the first tier is the mock-up's card;
second-tier names are placeholders too):

| Pile (price) | First copy | Second copy |
|---|---|---|
| Sabbatical (1) | Sabbatical: draw 2 | Extended Sabbatical: draw 3 |
| Keynote Address (2) | Keynote Address: paper worth 6 | Plenary Address: paper worth 8 |
| Research (**3, placeholder**) | Travel Grant: draw 4 | Research Assistant: draw 5 |
| Society Membership (2) | Society Membership: discards +1 | Society Council Seat: discards +2 |
| Literary Agent (3) | Literary Agent: article +5 | Senior Literary Agent: article +7 |
| Fellowship (3) | Fellowship: draw 3 | Senior Fellowship: draw 4 |
| University Press (4) | University Press: 3-card book, +4 | Flagship University Press: 3-card book, +7 |

**Still open:** Travel Grant cost 2 and Research Assistant cost 3, but one pile has one price. It is set to
3 for now: a free draw of 4 is strong.

**Bots.** No-cost Research needs no discards, so the bot just picks an archive, with the same preference as
before (the thesis it holds most of). A bot buys at most one card from each pile.

**Book cards stay in the author's deck (decided 2026-11-11).** When you publish a book, the showcased card
goes on your bookshelf as before, and the other hand cards go to **your own discard pile**. They are no
longer put back under the archives. Articles already worked this way: the second source goes to your discard
pile. Setting: `config.bookCardsTo` is `"discard"` (`"archive"` is the mock-up's rule, used by the parity check).

### New reference numbers (2026-11-11, `npm run sim`, seeds 1–1,000)

With no-cost Research, tiered piles and book cards kept:

| Game | Average prestige by place | Before keeping book cards | Mock-up rules |
|---|---|---|---|
| 2 players, medium | 90.5 / 68.5 | 77.4 / 59.2 | 68.5 / 50.1 |
| 3 players, medium | 124.5 / 101.6 / 80.5 | 103.8 / 85.5 / 67.4 | 90.5 / 72.9 / 55.7 |
| 4 players, medium | 162.1 / 137.6 / 117.8 / 94.0 | 133.1 / 111.4 / 95.3 / 76.3 | 115.3 / 96.2 / 80.3 / 62.9 |
| 4 players, long | 267.8 / 232.6 / 204.3 / 171.2 | 234.8 / 201.1 / 175.9 / 147.7 | |

- **Field balance stays even.** Two-player win rates by starting field: A 54%, B 46%, C 48%, D 50%.
- **Archives now run dry.** Books used to return cards to the archives; now only Network replacements and
  Research put-backs do. At the end of medium games, archives average 6.6 cards (2 players), 3.1 (3) and
  0.2 (4). They are empty in 28%, 48% and 84% of cases. In long four-player games, every archive is empty by
  the end, so late Research does nothing. A bigger deck, which the brief already expects, is the obvious lever.
- **Second tiers sell.** In four-player medium games, every pile except Society sells its second copy in
  20–90% of games.
- **Society Membership is never bought, under either set of rules.** That's a bot quirk, not a balance
  result. The bot replaces its basic card of the same kind with the upgrade. For a Network upgrade, that's the
  Network card being played, which isn't in the hand or discard pile, so the bot never finds a card to
  replace. The brief's "Society Membership tests as not worth buying" has the same cause. A fix would change
  the bots, so it waits for your call.

## Backend and login (step 6)

`backend/` holds flat PHP endpoints, like Board's backend, all returning JSON. Setup on GreenGeeks is in
[database/INSTALL.md](../database/INSTALL.md).

**Database access uses PDO, not mysqli.** On the server it talks to MySQL. In tests and CI it talks to SQLite,
because there is no MySQL locally. `backend/db.php` covers the few places where the two differ: the current
time, time arithmetic, row locks and starting a write transaction. This is the one deliberate departure from
Board's and VotingGame's `mysqli`; it lets the whole backend run end to end before anything is deployed.

**Tables** (`database/01_dk_games.sql`, in projecta's own database):
- `dk_games`: join code, host, status (`lobby`, `playing`, `finished`, `cancelled`), length, deck,
  `state_version`, and whose move it is.
  - `state` holds the engine state as one JSON document, so rule changes never need a migration.
  - `rules` holds a snapshot of `data/` taken at the start, so a rebalance deployed mid-game can't change a
    game in progress. `dk_rules.php` serves that snapshot, so the client shows the game's own card text and
    numbers.
- `dk_seats`: seat number (equal to the engine's seat), the Board user id or a bot, and a name.

**Endpoints:**

| Endpoint | Who | What |
|---|---|---|
| `users_login.php` POST | anyone | `{username, password}` checked against Board's `users` with Board's lockout (10 failures, 15 minutes); creates a Board session and sets the shared cookie |
| `users_me.php` GET | signed in | the current user, or 401 with `accountsSite` (Board, where people register and reset passwords) |
| `users_logout.php` POST | signed in | deletes the session (on every site sharing it) and clears the cookie |
| `dk_createGame.php` POST | signed in | `{length}`: a lobby with you as host in seat 0 |
| `dk_joinGame.php` POST | signed in | `{join_code}`: the next seat. Codes are 6 characters from Board's alphabet, and dashes, spaces and lowercase are accepted |
| `dk_addBot.php`, `dk_setLength.php` POST | host, lobby | add a bot; change the length |
| `dk_removeSeat.php` POST | lobby | the host removes any seat, and a player can leave. Seats renumber to stay 0..n-1. If the host leaves, the game is cancelled |
| `dk_startGame.php` POST | host | takes the rules snapshot, deals with a fresh random seed, and plays bot drafts |
| `dk_getState.php` GET | seated | the poll: `?game_id&since=version&log_from=k`. Returns `{changed:false}` when nothing changed, otherwise lobby info and your view, with only new log entries |
| `dk_action.php` POST | seated | `{game_id, version, action, log_from}`: one protocol message, then bots play. A stale `version` gets 409, so a double click can't send a move twice |
| `dk_myGames.php` GET | signed in | your games, with whose move it is |
| `dk_rules.php` GET | seated | the game's rules snapshot |

Every change runs in a transaction that locks the game row and bumps `state_version`, the number clients poll
for.

**Sign-in.**
- Sessions are rows in **Board's** `user_sessions` table: 64-hex tokens, 30 days, issued exactly as Board
  issues them, so a token from either site works on both.
- The token arrives either as Board's `Authorization: Bearer` header or as the `th_session` cookie, set for
  all of `.thehistorians.org` (Secure, HttpOnly, SameSite=Lax).
- Browsers attach cookies automatically, so a cookie-authenticated POST must be JSON and come from this host
  or an https `*.thehistorians.org` page. Otherwise it gets 403 or 415.

**Tests** (`npm run test:backend`, also in CI). `tests/backend/backend.itest.mjs` builds a throwaway SQLite
database with Board-style accounts and starts PHP's built-in server on the real `backend/` folder. It then
drives everything over HTTP:
- sign-in by cookie and by Bearer token; wrong passwords, a disabled account, and the lockout;
- the same-site checks;
- the whole lobby;
- polling;
- a complete game between two people and a bot, with Research, an out-of-turn move, a stale version, and
  a check that no rival hand, seed or random-generator state ever appears in a response;
- malformed requests, and sign-out.

PHP warnings are turned on, so any notice would break the JSON and fail the test.

**Single sign-on with the other games** (separate work, each in its own repo; the Board steps are also listed
in [database/INSTALL.md](../database/INSTALL.md)):
  - **Historians_Board_Version:** set and clear the shared cookie on login and logout, and accept it on requests.
  - **Historians_Variant** and **thehistorians.org** have their own `users` tables. Moving them onto Board's accounts means merging users; emails that exist in both need a rule.
  - **VotingGame-2024** is on davidsbennett.com and has no login, so a `.thehistorians.org` cookie can't reach it.

## Corrections to the brief (what the mock-up's code actually does)

1. `CONFIG.bookCardPts` also has 3 cards = 5 points (for University Press). Books longer than the table extrapolate: last + (n − last size) × (last step + 1), which is 34 + 9 per card past 8.
2. A book's showcased card goes on the shelf already marked as used by its author, so the author can never use it in a later book; rivals can still cite it. An article's showcased card starts unused. `doBook` also accepts no showcase at all, and then every hand card returns to its stack.
3. Passive bonuses read the hand at the moment they apply. The Newspaper bonus counts the cited player's current hand, so a citation payment tells everyone how many Newspapers they hold.
4. State the brief leaves out: `trashSeq` (trash names cycle across all stacks), `p.field`, and `p.trash` (set at the end). Decks draw from the end of the array (`pop`); stacks are taken from index 0. Setup shuffles each stack's sources, adds trash, then shuffles again.
5. Holes a client could exploit (the UI never produces them; the server must reject them):
   - Repeated card ids count twice: Research takes extra cards and pushes `null` into the discard pile, Network buys a pricier upgrade, a book double-counts a shelf card and pays the citation twice, and a repeated hand card in a book crashes.
   - Ending the turn while a Research choice is pending loses the cards being looked at.
6. `LETTERS` is hard-coded as A–D, colours are CSS variables `--A`…`--D`, and the rules text says "1 to 40". All of these now come from the deck (thesis keys, `color`, card `num`).
7. `botDraft` and the bots' Research stack choice call `S.rand()` inside a sort comparator, so how many random numbers they use depends on V8's sort. The JS port matches automatically; the PHP port needs a V8-compatible small-array sort for those two calls.
8. The Network log names the replaced card even when it came from a discard pile rivals can't see.
9. PHP 8.3 CLI is installed on the development machine, so the PHP engine's tests run locally as well as in CI.

Reference numbers (`npm run sim:mockup`, seeds 1–1,000, medium): 2 players 68.5 / 50.1; 3 players
90.5 / 72.9 / 55.7; 4 players 115.3 / 96.2 / 80.3 / 62.9. Two-player win rate by starting field: A 49%, B 43%, C 55%, D 51%.

## The JS engine (step 2)

`engine/js/` is the mock-up's logic ported function by function, with only structural changes:

- **No globals.** Every function takes the state `S` and a read-only rules object `R` (built by `makeRules`
  from the `data/` files). Players are passed as seat numbers.
- **`S` is plain JSON.** Cards are numeric ids, and `S.cards[uid] = { kind, ref }` replaces `REG`. The random
  generator's state is the integer `S.rng`, so a game can be saved after any step and resumed, in JS or PHP.
  A pending Research choice stores the seat instead of a player object. `endTriggered` is gone.
- **The log holds structured events** (`{ r, type, seat, ... }`), not English. `describe(event, S, R)` renders
  the mock-up's exact sentence. Events carry the card ids involved, ready for step 4's per-player redaction.
- The `do*` functions keep the mock-up's contract (validate, then change; `null`, an error string, or an object)
  and its exact error messages. Like the mock-up, they trust the caller about turn, phase and repeated ids;
  step 4's protocol layer adds those checks.

**How parity is checked** (`tools/lib/parity.mjs`): the mock-up's script runs in a Node sandbox next to the
engine, with the same seed. After **every** step, three things are compared: the whole state (the mock-up's
converted into the engine's shape), the action's return value, and each new log line, which must match the
mock-up's text exactly. The engine's state also goes through JSON and back before every step.

- **Bot games:** both sides run their own bots, so the bots are checked too.
- **Fuzz games:** some seats make random choices, mostly plausible and some invalid. These reach what bots
  never do: Research put-back choices, books with no showcase or with your own shelf cards, Network replacing
  an older discard, every error message.
- A test changes one rule number and confirms the harness catches the difference, so a pass means something.

Full run (`npm run parity`): 1,000 bot games and 300 fuzz games for each of 2, 3 and 4 players and each
length, 11,700 games in all.

`npm run sim` gives the same numbers as `npm run sim:mockup` and runs about 3,000 games per second.

## Protocol and views (step 4)

The server changes a game only through `engine/js/protocol.mjs`; the PHP backend will call its port.

- `apply(S, R, seat, message)` returns `{ state, events }` or `{ error }`, and never changes `S`. Before the
  rules run, it checks:
  - the message's shape: integer card ids; lists of at most 100 with no repeated id; names for archives and piles;
  - that the game isn't over and the phase is right;
  - that it is this seat's turn (or this seat's draft);
  - that a pending Research choice comes first. Nothing else is allowed until it's resolved, not even ending
    the turn, which in the mock-up would lose the cards being looked at.
- `advanceBots(S, R)` plays bot seats until a human must act. The server calls it after `newGame` and after
  every successful `apply`. `toAct(S)` says who must act next.
- Messages: `draft {stack}`, `playDraw {card}`, `organize {card, trash}`, `research {card, stack, discard?}`,
  `researchChoose {putBack}`, `conference {card, source}`, `article {card, sources:[a,b], showcase}`,
  `book {card, hand, shelf?, showcase?}`, `network {card, discard, pile, replace}`, `endTurn {keep?}`.

`engine/js/view.mjs` builds what one seat sees: `view(S, R, seat)`, or `seat = null` for a spectator. It's the
only thing the server sends a client.

- **Visible to everyone:**
  - every player's name, field, prestige, CV, citations, bookshelf, played cards and pile sizes;
  - each archive's size;
  - the conference space;
  - the log, with private details removed.
- **Visible only to you:** your own hand and discard pile, your pending Research cards, and your own private
  log details.
- **Never sent:** other players' hands and discard piles; the order or contents of any deck, your own
  included; archive order or contents; the seed; the random generator's state.
- **Private log details** (`PRIVATE_FIELDS`), visible only to the acting player:
  - the cards drawn in the draft;
  - the trash thrown out;
  - the cards taken and put back in Research;
  - an article's second source;
  - a book's hand cards other than the showcase, which go to the author's discard pile (the showcased card stays public);
  - Network's discards and the replaced card. The replaced card's kind and, for a source, its archive stay
    public, since the archive count shows it anyway. This applies the answer I suggested to the open
    question below.
- A view keeps the state's shape for your own seat, so the client can run `bookCheck`, `bonus` and
  `keepLimit` on it for live previews. A test checks they give the same answers as on the full state.

**Tests.**
- **Hidden information** (`tests/view.test.mjs`). For hundreds of real game states and every seat, everything
  that seat may not know is scrambled (`tools/lib/perturb.mjs`), and the view must not change by a single
  byte. A second test feeds the check seven deliberately leaky views (rival hand, rival discard, own deck
  order, archive order, seed, random state, unredacted log) and confirms it catches each one.
- **Protocol** (`tests/protocol.test.mjs`).
  - Games played through `apply` with 30% of messages corrupted on purpose: repeated ids, the wrong seat,
    wrong types, someone else's cards, oversized lists, garbage. Nothing crashes, the input state is never
    changed, and every message that can't be legal is refused.
  - A game played through the protocol matches the same choices made directly on the engine.

## The PHP engine (step 5)

`engine/php/` is a function-for-function port of `engine/js/`: the same rules, error messages, events and
views. The backend will load it with `require "engine/php/engine_all.php"` and call `HistDeck\newGame`,
`apply`, `advanceBots` and `view`. It needs **PHP 8.1 or later**; check GreenGeeks' version in cPanel.

What had to be imitated exactly:
- **The random generator.** JavaScript runs mulberry32 in 32-bit integers, and PHP's integers are 64-bit, so
  `rng.php` masks every step by hand (`i32`, `urs`, `imul`). Checked against JS: 12,000 draws from six seeds,
  including negative seeds and seeds past 2³¹, all bit-identical.
- **V8's sort.** The bots break ties with a random number inside a sort comparator, so how many random numbers
  a sort draws depends on the sort algorithm. `v8sort()` reproduces V8's TimSort for small arrays (one run,
  then binary insertion), calling the comparator in the same order. Every sort in the PHP engine goes through it.
- **JSON shapes.** Messages are decoded as objects (`json_decode($json)`), so a JSON object and a JSON list
  stay as distinct as they are in JS. Lists in the state stay lists (`array_values` after filtering).

**Conformance** (`npm run conformance`):
- `tools/record-conformance.mjs` records 54 games with the JS engine, op by op, the way the server will run
  them: `newGame`, `advanceBots`, then `apply` for every human message followed by `advanceBots`.
  - Human seats make random choices; 20% of their messages are corrupted on purpose.
  - Bot-only games advance one turn at a time.
  - Games run under the current `data/` rules and under the mock-up's rules.
- After every op the recording keeps a hash of the canonical state and of the new events. After every change
  it keeps a hash of the view for every seat and for a spectator.
- `engine/php/tests/conformance.php` replays everything and stops at the first difference. It writes the PHP
  state to `build/conformance/` and prints the command that dumps the matching JS state.
- Current result: all 54 games and 14,504 ops match, including 9,856 views and 1,778 refused messages
  (identical error text), in about 6 seconds.
- To prove it can fail, it was run against three deliberately broken copies of the PHP engine: a plain sort
  in place of `v8sort`, a view that leaked an article's second source, and citations without the Newspaper
  bonus. It caught all three.
- Recordings are generated, not committed (`build/` is git-ignored).

**CI** (`.github/workflows/test.yml`) runs the JS tests, data validation and a slice of the mock-up parity
check. It also runs `php -l` and the conformance replay on PHP 8.1 and 8.3. It hasn't run on GitHub yet,
because nothing has been pushed.

**Rule changes from now on:** change `engine/js`, run `npm test`, then port the change to `engine/php` until
`npm run conformance` passes.

## Repository layout

```
reference/   the mock-up, unchanged; the parity tests load its script
data/        config.json, actions.json, bonuses.json, trash.json, market.json, decks/<id>/deck.json
tools/       extract-data, validate-data, simulate, mockup-sim, parity, record-conformance, lint-php;
             lib/ has fuzz, play, perturb and canon helpers
tests/       node:test suites
engine/js/   reference engine: rng, rules, engine, bots, describe, protocol, view
engine/php/  authoritative port: rng, rules, engine, bots, protocol, view, canon; tests/conformance.php
backend/     PHP endpoints (users_*, dk_*), lib/db/auth/games helpers, tests/ (SQLite schema and setup)
database/    NN_description.sql migrations, run by hand; INSTALL.md for cPanel setup
tests/backend/  end-to-end HTTP test of the backend (npm run test:backend)
frontend/    step 7: React 18 + Vite + Tailwind, plain JS
```

## Data files

- `config.json` is the mock-up's `CONFIG`, plus `startingActions` (was `BASE`) and `seats` {min, max} (was hard-coded in the setup screen).
- `actions.json`, `bonuses.json` and `trash.json` started as `ACTIONS`, `BONUS` and `TRASH`. Since step 3, `actions.json` also has the second-tier upgrades and the `take` numbers, and `config.json` has `terms.archive` (the word the log uses for a stack) instead of `upgradeCopies`.
- `market.json` lists the upgrade piles: id, price, and tiers from the top down. Its order is the conference space's order.
- `decks/<id>/deck.json` holds `{ id, name, theses, cards }`. `theses[L]` is `{ q, articles, books, color }`; `cards` keep the mock-up's fields. A game stores its deck id, so swapping decks never breaks a game in progress.
- `npm run data:validate` checks every deck; `npm run data:check` reports whether `data/` still matches the mock-up. It will stop matching once you rebalance; the parity tests use the mock-up's own constants, not `data/`.

## Open items

- Are cards discarded to pay for an action (and the card Network replaces) public? Built as suggested: private, and the log shows only counts (see `PRIVATE_FIELDS` in `engine/js/view.mjs`; making one public means deleting it from that list, then porting the change to PHP).
- An article's second source and a book's non-showcased hand cards go to the author's discard pile, which rivals can't see, so the log names them only to the author. Publications might reasonably show all their sources; it's a one-line change.
- What happens when a human seat stops playing (for example, the host can hand it to a bot)?
