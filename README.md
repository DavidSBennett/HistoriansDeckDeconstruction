# The Historians: deck-builder

An online multiplayer deck-building game about doing history, built from the single-file mock-up in
[reference/](reference/The-Historians-Deckbuilder-Mockup.html). It will run at **projecta.thehistorians.org**
on GreenGeeks: a PHP/MySQL backend that owns the game, and a React/Vite client that polls it.

- Spec: [docs/BRIEF.md](docs/BRIEF.md)
- Decisions, build order and corrections to the brief: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Commands

Needs Node 22 or later, and PHP 8.1 or later for the PHP checks. There are no dependencies to install yet.

| Command | What it does |
|---|---|
| `npm test` | Runs the test suites in `tests/`, including a quick slice of the parity check. |
| `npm run sim` | **For balancing.** Plays 1,000 bot games per seat count with the engine and the rules in `data/`. Options: `-- --games 5000 --length long --seats 2,4 --first-seed 1`. |
| `npm run data:validate` | Checks `data/` for mistakes after a rebalance or deck swap. |
| `npm run parity` | The full check of the engine against the mock-up: 11,700 games compared after every step (about 7 minutes). Options: `-- --games 100 --fuzz 50`. |
| `npm run sim:mockup` | The same simulation as `sim`, but with the mock-up's own logic, for reference numbers. |
| `npm run conformance` | Records 54 games with the JS engine and replays them with the PHP engine, which must match after every step. Needs `php` (8.1+) on the PATH. |
| `npm run lint:php` | Syntax-checks every PHP file. |
| `npm run test:backend` | Runs the PHP backend on PHP's built-in server with a throwaway SQLite database and tests it over HTTP. |

Going live on GreenGeeks: [docs/DEPLOY.md](docs/DEPLOY.md) (server setup in
[database/INSTALL.md](database/INSTALL.md)). After that, every push to `main` tests, builds and deploys to
projecta.thehistorians.org; `node tools/publish.mjs` builds the same upload folder locally.

## Playing it locally

Needs PHP 8.1+ on the PATH (the SQLite driver is loaded per command if it isn't switched on).

```bash
npm install --prefix frontend
```

```bash
node tools/dev-backend.mjs
```

```bash
npm run dev --prefix frontend
```

Then open http://localhost:5173 and sign in as `alice`, `bob` or `carol` (password: the name followed by
`-dev`). The local database lives in `build/dev/`; add `--reset` to the backend command to start it afresh.

GitHub Actions runs the tests, a slice of the parity check, and the PHP checks on PHP 8.1 and 8.3 on every push.
| `npm run data:check` | Reports whether `data/` still matches the mock-up's constants. |
| `npm run data:extract` | Regenerates `data/` from the mock-up. **This overwrites any rebalancing.** |

## Where the numbers live

Every rule number and every piece of card text is in `data/`. Change them there; the engine code never
hard-codes them. A new deck goes in `data/decks/<id>/deck.json` with the same card fields.

- `config.json`: hand size, scores, book table, rounds, set thresholds, draft and trash numbers.
- `actions.json`: every action card, including both tiers of each upgrade. Research cards use `take`.
- `market.json`: the conference space's upgrade piles, each with one price and its tiers from the top down.
- `bonuses.json`, `trash.json`: passive bonuses by source type, and the trash cards.

After editing, run `npm run data:validate`, then `npm run sim` to see the effect.

The AI History deck is built from the Historians-Deck-Builder spreadsheet. After changing the CSV, rebuild it:

```bash
npm run deck:import -- "../Historians-Deck-Builder/AI History/deck/ai-history-deck.csv" ai-history --name "AI History" --images "../Historians-Deck-Builder/AI History/photo-gallery"
```

It prints the chronological numbering and checks the deck before writing it. `--images` takes each card's
picture from the gallery by name (`a1.jpg` is card A1, `c10.jpg` is C10), shrinks it for the web, and saves it
in `data/decks/ai-history/images/`. Cards without a picture show a placeholder. Compare decks with
`npm run sim -- --deck ai-history-mockup`.
