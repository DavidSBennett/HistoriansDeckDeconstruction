// Builds the read-only rules object R that every engine function takes alongside the state S.
// R holds data only (config, actions, bonuses, trash, deck) plus a few derived lists. It never changes during
// a game, and nothing in it is stored in S except the deck id.
export function makeRules({ config, actions, bonuses, trash, deck }) {
  return {
    config,
    actions,
    bonuses,
    trash,
    deck,
    theses: deck.theses,
    cards: deck.cards,
    letters: Object.keys(deck.theses), // thesis letters, in data order (was the hard-coded LETTERS)
    upgrades: Object.keys(actions).filter((k) => actions[k].value > 0), // market order = file order
    base: config.startingActions,
  };
}
