// Builds the read-only rules object R that every engine function takes alongside the state S.
// R holds data only (config, actions, bonuses, trash, deck, market) plus a few derived lists. It never changes
// during a game, and nothing in it is stored in S except the deck id.
//
// The market (conference space) is a list of upgrade piles: { pile, value, tiers }. A pile sells its tiers
// top down, so the first copy bought is tiers[0], the next tiers[1], and so on; every copy costs `value`.
// Without a market file (the mock-up's rules), each upgrade action becomes a pile of `upgradeCopies`
// identical copies, which reproduces the mock-up exactly.
//
// Since step 9 (the current rules): every card has a purchasing power (`power` on actions and sources; a False
// Lead has none), buying is an ability every player has (config.buying) instead of the Network card, and False
// Leads (cards with `falseLead`) have their own publication rules (config.falseLead) and bookshelf effects
// (falseLeads.json, by source type). Without these the engine plays the mock-up's rules.
export function makeRules({ config, actions, bonuses, trash, deck, market = null, falseLeads = null }) {
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
    pileOfTier: new Map(piles.flatMap((p) => p.tiers.map((t) => [t, p.pile]))), // which pile sells an upgrade
    falseLeads: falseLeads || {}, // bookshelf effects of False Leads, by source type
    base: config.startingActions,
    archiveWord: config.terms?.archive ?? "card archive", // what the log calls a stack
    // Where a book's hand cards (other than the showcase) go: the author's discard pile, or (the mock-up's
    // rule) the bottom of their archives.
    bookCardsTo: config.bookCardsTo ?? "discard",
  };
}
