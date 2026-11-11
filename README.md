# The Historians: deck-builder

An online multiplayer deck-building game about doing history, built from the single-file mock-up in
[reference/](reference/The-Historians-Deckbuilder-Mockup.html). It will run at **projecta.thehistorians.org**
on GreenGeeks: a PHP/MySQL backend that owns the game, and a React/Vite client that polls it.

- Spec: [docs/BRIEF.md](docs/BRIEF.md)
- Decisions, build order and corrections to the brief: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Commands

Needs Node 22 or later. There are no dependencies to install yet.

| Command | What it does |
|---|---|
| `npm test` | Runs the test suites in `tests/`, including a quick slice of the parity check. |
| `npm run sim` | **For balancing.** Plays 1,000 bot games per seat count with the engine and the rules in `data/`. Options: `-- --games 5000 --length long --seats 2,4 --first-seed 1`. |
| `npm run data:validate` | Checks `data/` for mistakes after a rebalance or deck swap. |
| `npm run parity` | The full check of the engine against the mock-up: 11,700 games compared after every step (about 7 minutes). Options: `-- --games 100 --fuzz 50`. |
| `npm run sim:mockup` | The same simulation as `sim`, but with the mock-up's own logic, for reference numbers. |
| `npm run data:check` | Reports whether `data/` still matches the mock-up's constants. |
| `npm run data:extract` | Regenerates `data/` from the mock-up. **This overwrites any rebalancing.** |

## Where the numbers live

Every rule number and every piece of card text is in `data/`. Change them there; the engine code never
hard-codes them. A new deck goes in `data/decks/<id>/deck.json` with the same card fields.
