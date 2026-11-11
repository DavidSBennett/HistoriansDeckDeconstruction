# Notes for Claude

- Read `docs/ARCHITECTURE.md` first: decisions, build order, current step, and open questions.
- `docs/BRIEF.md` is the original spec. Where it differs from `reference/The-Historians-Deckbuilder-Mockup.html`, the mock-up's code wins for the exact port (step 2); later rules changes are listed in ARCHITECTURE.md.
- Never edit `reference/`. Parity tests load its script through `tools/lib/load-mockup.mjs`.
- All rule numbers and card text live in `data/` JSON. Don't hard-code numbers, the thesis letters, the deck size or the number of theses in engine code.
- The JS engine (`engine/js/`) is the reference; the PHP engine (`engine/php/`) must match it exactly, as proven by recorded test games. Change the JS first, then port the change.
- Hosting: GreenGeeks shared hosting, PHP 8.3 with mysqli, no Node on the server. The user runs migrations by hand (numbered `database/NN_description.sql`). PHP 8.3 CLI is installed locally for tests.
- Conventions follow `../Historians_Board_Version` (login, deploy workflow, frontend stack) and `../VotingGame-2024` (game state as one JSON column, join codes, a version number on each update).
- Tests: `npm test` (node:test, files named `tests/**/*.test.mjs`). After any change to `engine/js/` that should not change the rules, run `npm run parity` (about 7 minutes) as well.
- From step 3 on the rules deliberately leave the mock-up's. Keep the parity check working against the mock-up's own constants (tools/lib/parity.mjs `mockupRules`) for whatever has not changed, or tag the last commit that matches it exactly.
