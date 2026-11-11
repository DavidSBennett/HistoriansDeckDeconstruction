// Builds the read-only rules object R that every engine function takes alongside the state S.
// R holds data only (config, actions, bonuses, trash, deck, market) plus a few derived lists. It never changes
// during a game, and nothing in it is stored in S except the deck id.
//
// The market (conference space) is a list of upgrade piles: { pile, value, tiers }. A pile sells its tiers
// top down, so the first copy bought is tiers[0], the next tiers[1], and so on; every copy costs `value`.
// Without a market file (the mock-up's rules), each upgrade action becomes a pile of `upgradeCopies`
// identical copies, which reproduces the mock-up exactly.
export function makeRules({ config, actions, bonuses, trash, deck, market = null }) {
  const piles = market
    ? market.map((p) => ({ pile: p.pile, value: p.value, tiers: p.tiers.slice() }))
    : Object.keys(actions)
        .filter((k) => actions[k].value > 0)
        .map((k) => ({ pile: k, value: actions[k].value, tiers: Array(config.upgradeCopies).fill(k) }));
  return {
    config,
    actions,
    bonuses,
    trash,
    deck,
    theses: deck.theses,
    cards: deck.cards,
    letters: Object.keys(deck.theses), // thesis letters, in data order (was the hard-coded LETTERS)
    piles, // market order = data order
    pileById: new Map(piles.map((p) => [p.pile, p])),
    base: config.startingActions,
    archiveWord: config.terms?.archive ?? "card archive", // what the log calls a stack
  };
}
