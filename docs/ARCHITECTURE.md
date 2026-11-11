# Architecture and decisions

Status: build steps 1–3 done (2026-11-11); step 3 is waiting for review. The original spec is [BRIEF.md](BRIEF.md); this file records what
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
4. Protocol wrapper (turn, phase, pending choice, repeated ids), structured events, `view(state, seat)`, and hidden-information tests.
5. PHP engine plus conformance: the JS engine records test games, the PHP engine replays them and must match exactly; GitHub Actions runs both before any deploy. **Review stop.**
6. Shared login, DB migrations, PHP backend (lobby, polling, actions, server-side bots).
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

### New reference numbers (2026-11-11, `npm run sim`, seeds 1–1,000)

| Game | Average prestige by place | Mock-up rules |
|---|---|---|
| 2 players, medium | 77.4 / 59.2 | 68.5 / 50.1 |
| 3 players, medium | 103.8 / 85.5 / 67.4 | 90.5 / 72.9 / 55.7 |
| 4 players, medium | 133.1 / 111.4 / 95.3 / 76.3 | 115.3 / 96.2 / 80.3 / 62.9 |
| 4 players, long | 234.8 / 201.1 / 175.9 / 147.7 | |

- **Field balance evened out.** Two-player win rates by starting field are now A 51%, B 48%, C 50%, D 50%
  (B was 43%).
- **Archives run dry in big games.** At the end of medium games, archives average 7.6 cards (2 players),
  4.8 (3) and 2.0 (4). In long four-player games, 80% of archives are empty.
- **Second tiers sell.** In four-player medium games, every pile except Society sells its second copy in
  20–90% of games.
- **Society Membership is never bought, under either set of rules.** That's a bot quirk, not a balance
  result. The bot replaces its basic card of the same kind with the upgrade. For a Network upgrade, that's the
  Network card being played, which isn't in the hand or discard pile, so the bot never finds a card to
  replace. The brief's "Society Membership tests as not worth buying" has the same cause. A fix would change
  the bots, so it waits for your call.

## Login (step 6)

- projecta's PHP uses two DB connections: its own database for game tables (`dk_*`), and Board's database for
  `users` and `user_sessions`, using the same token format and 30-day expiry as Board. Credentials for both
  live in `config.secret.php` (git-ignored, excluded from rsync); cPanel must grant the projecta DB user access to Board's database.
- Single sign-on: on login, a session cookie is set with `Domain=.thehistorians.org; Secure; HttpOnly; SameSite=Lax`.
  Each game's backend accepts that cookie or the existing `Authorization: Bearer` header. Because cookies are
  sent automatically, every state-changing endpoint checks `Origin` against `*.thehistorians.org` and requires a JSON body.
- What other games need (separate work, each in its own repo):
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

## Repository layout

```
reference/   the mock-up, unchanged; the parity tests load its script
data/        config.json, actions.json, bonuses.json, trash.json, decks/<id>/deck.json
tools/       extract-data, validate-data, simulate, mockup-sim, parity (later: record test games)
tests/       node:test suites
engine/js/   reference engine: rng, rules, engine, bots, describe (step 4 adds protocol and view())
engine/php/  step 5: authoritative port
backend/     step 6: PHP endpoints, flat like Board's backend/
database/    step 6: NN_description.sql migrations, run by hand
frontend/    step 7: React 18 + Vite + Tailwind, plain JS
```

## Data files

- `config.json` is the mock-up's `CONFIG`, plus `startingActions` (was `BASE`) and `seats` {min, max} (was hard-coded in the setup screen).
- `actions.json`, `bonuses.json` and `trash.json` started as `ACTIONS`, `BONUS` and `TRASH`. Since step 3, `actions.json` also has the second-tier upgrades and the `take` numbers, and `config.json` has `terms.archive` (the word the log uses for a stack) instead of `upgradeCopies`.
- `market.json` lists the upgrade piles: id, price, and tiers from the top down. Its order is the conference space's order.
- `decks/<id>/deck.json` holds `{ id, name, theses, cards }`. `theses[L]` is `{ q, articles, books, color }`; `cards` keep the mock-up's fields. A game stores its deck id, so swapping decks never breaks a game in progress.
- `npm run data:validate` checks every deck; `npm run data:check` reports whether `data/` still matches the mock-up. It will stop matching once you rebalance; the parity tests use the mock-up's own constants, not `data/`.

## Open items

- Are cards discarded to pay for an action (and the card Network replaces) public? Suggested: private, and the log shows only counts.
- What happens when a human seat stops playing (for example, the host can hand it to a bot)?
