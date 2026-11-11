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
| `npm test` | Runs the test suites in `tests/`. |
| `npm run data:validate` | Checks `data/` for mistakes after a rebalance or deck swap. |
| `npm run sim:mockup` | Plays 1,000 bot games per seat count with the mock-up's own logic. Options: `-- --games 500 --length long --seats 2,4`. |
| `npm run data:check` | Reports whether `data/` still matches the mock-up's constants. |
| `npm run data:extract` | Regenerates `data/` from the mock-up. **This overwrites any rebalancing.** |

## Where the numbers live

Every rule number and every piece of card text is in `data/`. Change them there; the engine code never
hard-codes them. A new deck goes in `data/decks/<id>/deck.json` with the same card fields.
