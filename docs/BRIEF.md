# Original brief (2026-11-11)

The brief this project started from, kept verbatim as the spec for the exact port in build step 2. Where the
mock-up's code differs from it, the code wins; see the corrections in [ARCHITECTURE.md](ARCHITECTURE.md).
Rules changes decided after this brief (Research, tiered upgrade piles) are listed there too.

---

I have a working single-file mock-up of a deck-building card game about doing history, `The-Historians-Deckbuilder-Mockup.html`. I want to turn it into a real framework with online multiplayer. This brief explains exactly how the mock-up's code works, what must be preserved, and what has to change. Read this brief and the HTML file, then tell me in a few lines what you understand and propose an architecture. Do not write code until I approve the plan.

## 1. What the file is

One HTML file, about 520 lines, no dependencies, no build step. It has three parts:

1. CSS in a `<style>` block.
2. A static page shell: header, archive panel, conference panel, rivals panel, player panel, hand, log, a fixed bottom dock for prompts, and an empty `#ovroot` for modals.
3. One `<script>` in two halves:
   - **Game logic** (from `const DATA` to `function ranking`). It never touches the DOM.
   - **UI** (inside `if(typeof document!=="undefined"){...}`). It renders with `innerHTML` and handles everything through one delegated `click` listener keyed on `data-*` attributes.

The last line exports the logic through `module.exports` when run under Node, so the logic half can be extracted and run headless. That is how I simulated about 100,000 bot games to balance it.

## 2. The game as the code plays it

2–4 players. Each has a personal deck. The shared table holds four argument stacks (A, B, C, D) and a conference space of upgrade cards. Highest prestige after a fixed number of rounds wins.

**Setup**
- Each stack is the 10 source cards whose `arg` is that letter, plus 3 trash cards, shuffled.
- Each player starts with six action cards: Attend Conference, Publish an Article, Publish a Book, Research, Network, Organize.
- Draft, in seat order: each player picks one stack with at least 5 cards and takes its top 5, unseen, into their deck. When all have drafted, decks are shuffled and everyone draws 5.

**A turn**
- Play any number of action cards from hand, each once. A played card sits in `play` until the turn ends.
- End turn: keep up to 1 card (plus 1 per Diary bonus), discard the rest of the hand and all played cards, draw back up to 5.
- When a deck is empty, the discard pile is shuffled to form a new deck.
- After the last seat's turn the round number rises. The game ends after round 6, 10 or 14 (short, medium, long). Each trash card still in a player's deck, hand or discard then costs 1 prestige.

**The six basic actions**
- **Research:** discard n cards from hand, take n cards from the top of one stack into your discard pile. "Look" effects let you see extra cards and put that many back under the stack.
- **Attend Conference:** choose one source in hand; score 2; the card goes to your discard pile.
- **Publish an Article:** choose two sources in hand with the same `era`; score 4. One goes face up on your bookshelf, the other goes to your discard pile.
- **Publish a Book:** choose 4 or more cards that all share one thesis letter (a card's letters are `arg` and, if present, `sub`). At least 2 must come from hand; the rest may be bookshelf cards, yours or a rival's. Score by size (8/13/19/26/34 for 4/5/6/7/8 cards) plus 4, plus set bonuses. One hand card goes on your bookshelf; the other hand cards go to the bottom of their own stacks. Each player may use a given bookshelf card in only one of their books. Using a rival's card is a citation and pays the rival 2.
- **Network:** discard n cards, take an upgrade whose value is n or less. It replaces one card of your choice in your discard pile (the cards just discarded count). A replaced action or trash card leaves the game; a replaced source goes to the bottom of its stack.
- **Organize:** remove any number of trash cards from your hand or discard pile, out of the game.

**Book sets** (flat bonuses, both can apply)
- Sequence, +12: three or more cards with consecutive `num` values. Every source has a `num` from 1 to 40 in chronological order.
- Range of Sources, +12: five or more different `type` values.

**Passive bonuses.** Every source has a bonus set by its `type`. It counts while the card is in its owner's hand (including for the action that spends it) and permanently while on their bookshelf. Bonuses stack.

| Type | Effect |
|---|---|
| Map | Research: look at 1 more card, put 1 back |
| Letter | Network: discards count as 2 more |
| Speech | Conference papers: +1 |
| Report | Articles: +1 |
| Photograph | Books: +2 |
| Newspaper | +2 when a rival cites you |
| Diary | Keep 1 more card at end of turn |

**Upgrades** (2 copies each in the conference space; value in brackets)
Sabbatical (1) draw 2 · Keynote Address (2) paper worth 6 · Travel Grant (2) research looks at 2 more · Society Membership (2) network discards count +1 · Literary Agent (3) article +5 · Research Assistant (3) research looks at 1 more and kept cards go to hand · Fellowship (3) draw 3 · University Press (4) book needs only 3 cards and scores +4.

## 3. Constants: where every number lives

- `CONFIG`: hand size, scores, book size table, round counts, set thresholds, starting cards, trash count and penalty, keep limit, upgrade copies.
- `ACTIONS`: every action card by id. Fields: `name`, `kind` (`conference | article | book | research | network | organize | draw`), `value` (0 for basics, 1–4 for upgrades), `text`, and optional modifiers `pts`, `bonus`, `look`, `toHand`, `draw`, `min`.
- `BASE`: the six starting action ids. `UPGRADES`: every action with `value > 0`.
- `BONUS`: the passive bonus per source type, with `amt`.
- `TRASH`: six flavour names for trash cards.
- `DATA`: embedded JSON. `DATA.theses[letter]` has `q` (the question), `articles` and `books` (title lists used to name publications). `DATA.cards[i]` has `seq, date, type, title, content, significance, author, arg, sub, citation, note, era, stance, quote, num`.

Keep these as data, not code. I will keep rebalancing them.

## 4. State

One global, `S`, built by `newGame(seats, length, seed)`:

```
S = {
  uidc,            // card instance counter
  rand,            // seeded PRNG (mulberry32) as a closure
  players: [ { i, name, bot, deck[], hand[], discard[], play[], shelf[], cv[], prestige, cites, field } ],
  stacks: { A: [], B: [], C: [], D: [] },   // index 0 is the top; push() adds to the bottom
  market: { upgradeId: copiesLeft },
  turn,            // seat index of the current player
  round, length,   // length is "short" | "medium" | "long"
  phase,           // "draft" then "play"
  draftAt,         // seat currently drafting
  pending,         // an unfinished Research choice, or null
  over, log: [ { r, t } ],
  ti               // per-letter counters for picking publication titles
}
```

- A card instance is `{ uid, kind, ref }`. `kind` is `source` (ref is an index into `DATA.cards`), `action` (ref is an `ACTIONS` id) or `trash` (ref is an index into `TRASH`). `REG[uid]` is a global lookup of every instance.
- A bookshelf entry is `{ card, usedBy: [seatIndex, ...] }`.
- A CV entry is `{ type: "paper" | "article" | "book", title, letter, pts, n? }`.
- `endTriggered` is a dead field left from an earlier rule. Remove it.

## 5. Logic functions

Convention: every `do*` function validates first and mutates only if valid. It returns `null` on success or a string error. `doDraft` and `doResearch` return an object on success.

- `doDraft(L)`: current drafter takes the top `startCards` of stack `L`. After the last seat, sets `phase = "play"` and deals hands.
- `draw(p, n)`: draws, reshuffling the discard pile when the deck is empty.
- `B(p, type)`: passive bonus total, counting the player's hand and bookshelf. Every action reads it before moving any cards.
- `doDraw(p, actionUid)`.
- `doOrganize(p, actionUid, trashUids)`.
- `doResearch(p, actionUid, discardUids, L, chooser?)`: takes `want + look` cards off the stack. If nothing needs putting back it finishes. Otherwise it calls `chooser` (bots) or parks the choice in `S.pending` and returns `{ pending: true, seen, reject, keepN }`.
- `finishResearch(pending, rejectUids)`: rejected cards go to the bottom of the stack, kept cards to the discard pile or hand.
- `doConference(p, actionUid, sourceUid)`.
- `doArticle(p, actionUid, sourceUid1, sourceUid2, showcaseUid)`.
- `bookCheck(p, actionDef, handCards, shelfUids)`: pure validation and scoring; returns `{ ok, letter, pts, sets, ents, n, msg }`. The UI calls it live while the player selects.
- `bookSets(cards)`: returns the sets a group of cards scores.
- `doBook(p, actionUid, handUids, shelfUids, showcaseUid)`.
- `doNetwork(p, actionUid, discardUids, upgradeId, replaceUid)`.
- `endTurn(keepUids)`: handles keeping, discarding, drawing, turn and round advance, the end of the game and trash penalties.
- `ranking()`: players sorted by prestige, then books.
- Bots: `botDraft`, `botStep` (plays one action, returns false when it has nothing to do), `botKeep`, `botReject`, `botBook`. They are a simple greedy policy, used for solo play and for simulation.

## 6. UI, and why it cannot be reused as is

- `UI = { mode, a, sel, shelf, step, up }` holds the in-progress selection for one action. `VIEW` is the seat whose hand is shown.
- `render()` redraws everything. `renderDock()` writes the prompt and buttons for the current mode.
- Modals cover the draft, the Research put-back choice, the Organize picker, the Network replace picker, card detail, rules, setup and results.
- Multiple humans are handled by hot-seat: a "pass the screen" modal between turns.

## 7. What is not multiplayer-safe

1. **One mutable global `S` in the browser.** Every client would hold the full truth, including rivals' hands and the order of every stack and deck.
2. **Hidden information is not separated.** A player may see their own hand and discard pile, deck counts, all bookshelves, all CVs, stack counts, the conference space and the log. They may not see rival hands, any deck order, stack order, or the cards a rival is looking at during Research.
3. **State is not serialisable.** `S.rand` is a closure, `S.pending` holds object references, and `REG` is a separate global.
4. **Randomness is client-side.** Shuffles must happen on the server.
5. **Validation trusts the caller.** The `do*` functions check card ownership but not whose turn it is, the phase, or whether a Research choice is pending.
6. **Log lines are English strings built in the logic.** Some would leak hidden information if sent to everyone.
7. **Two-step actions.** Research with a look effect needs a second message from the player; the draft is a per-seat step before play.

## 8. What I want built

1. **A rules engine with no DOM and no globals:** `(state, action) -> { state, events }` or an error, deterministic given a seed stored in the state, and fully serialisable. Port the existing rules exactly; do not redesign them.
2. **An action protocol.** One message type per step: `draft`, `playDraw`, `organize`, `research`, `researchChoose`, `conference`, `article`, `book`, `network`, `endTurn`. Payloads match the `do*` arguments above.
3. **An authoritative server** that owns the state, checks turn and phase, applies actions and stores the game.
4. **A per-player view function** that redacts hidden information as listed in section 7, including the event log.
5. **Lobby basics:** create a game, join by code, choose length, fill seats with bots, start.
6. **A client** that renders a player view and sends actions. The mock-up's layout and interaction flow are the reference.
7. **The bots,** ported to run on the server.

## 9. Acceptance tests

- With the same seed and the same bot policy, the ported engine must produce the same final scores as the mock-up's logic. Extract the mock-up's script, run it under Node, and compare game by game.
- Reference numbers from 1,000 bot-only medium games: two players finish about 68 to 51; three players about 90 to 57; four players about 114 to 62.
- A view sent to one player must never contain another player's hand, any deck order, or any stack order. Test this directly.

## 10. Constraints to confirm with me before choosing a stack

- My other games run on GreenGeeks shared hosting with a PHP/MySQL backend and a React/Vite frontend, where clients poll for state. There is no long-running Node process or WebSocket server there. Tell me whether you recommend staying on that stack or moving, and what each choice costs.
- If the engine has to exist in both PHP and JavaScript, explain how you would keep the two in step.
- I run database migrations by hand, and I cannot run PHP locally.

## 11. Open design items: leave the rules alone, but do not hard-code around them

- Travel Grant, Research Assistant and Society Membership test as not worth buying. They may be cut or changed.
- Sequence uses one global chronological number. It may change to counting within the book's thesis.
- Field B wins slightly less often than the others (about 46% against 49–52%).
- Four-player long games strain a 40-card deck. Larger decks are likely, so nothing should assume 40 cards, 10 per stack, or exactly four theses.
- The deck will be swapped. Card content must load from data with the same fields as `DATA.cards`.

First step: read the HTML file, confirm or correct anything in this brief that does not match the code, and propose the architecture and a build order.
