// The rules, written from the game's own data so they always match its numbers and cards.
import { Modal } from "./Cards.jsx";

export default function RulesModal({ R, onClose }) {
  const c = R.config;
  const basic = (kind) => Object.values(R.actions).find((a) => a.kind === kind && a.value === 0);
  const research = basic("research");
  const sizes = Object.keys(c.bookCardPts).map(Number).filter((k) => k >= c.bookMin);
  const nums = R.cards.map((d) => d.num);
  return (
    <Modal onClose={onClose}>
      <h3>How to play</h3>
      <ul className="rules">
        <li><b>Setup:</b> each player chooses a card archive and takes its top {c.startCards} cards into a starting deck of {c.startingActions.length} action cards. Each archive also hides {c.trashPerStack} trash cards.</li>
        <li><b>Your turn:</b> draw up to {c.handSize}. Play any number of action cards, then end the turn: you may keep {c.keepCards} card (more with Diaries), everything else goes to your discard pile, and you draw back up to {c.handSize}. When your deck runs out, your discard pile is shuffled to make a new one.</li>
        <li><b>Research:</b> {research?.text} Upgrades draw more. A Map in your hand or on your bookshelf lets you look at one more card and put one back.</li>
        <li><b>Attend Conference:</b> present one source from your hand as a conference paper (+{c.paperPts}). The card goes to your discard pile.</li>
        <li><b>Publish an Article:</b> two sources from the same era (+{c.articlePts}). One goes face up on your bookshelf; the other goes to your discard pile.</li>
        <li><b>Publish a Book:</b> {c.bookMin} or more cards that share a thesis letter, big or small. A book scores {sizes.map((k) => `${c.bookCardPts[k]} for ${k} cards`).join(", ")}, plus {c.bookBonus}. At least {c.bookMinFromHand} must come from your hand; the rest may come from your bookshelf or a rival's. Citing a rival's card pays them +{c.citePts}. You may use each bookshelf card in only one of your books. One card from your hand goes on your bookshelf; the others go {R.bookCardsTo === "archive" ? "back under their card archives" : "to your discard pile"}.</li>
        <li><b>Book sets:</b> every source has a number, {Math.min(...nums)} to {Math.max(...nums)}, in chronological order. <b>Sequence</b> (+{c.runPts}): {c.runMin} or more consecutive numbers. <b>Range of Sources</b> (+{c.typesPts}): {c.typesMin} or more different source types. Bookshelf cards in the book count.</li>
        <li><b>Network:</b> discard n cards and take the next card from an upgrade pile priced n or less. The deeper a pile has been bought, the stronger its next card. It replaces a card of your choice in your discard pile: a replaced action or trash card leaves the game, a replaced source goes back to its card archive.</li>
        <li><b>Passive bonuses:</b> every source carries a bonus set by its type. It counts while the card is in your hand, and for good once it is on your bookshelf.<br />
          {Object.entries(R.bonuses).map(([t, b]) => <span key={t} className="note">{t}: {b.name}. {b.text}<br /></span>)}</li>
        <li><b>Organize:</b> remove trash cards from your hand or discard pile. Each trash card still in your deck at the end costs {c.trashPenalty} prestige.</li>
        <li><b>End:</b> the game lasts {c.rounds.short}, {c.rounds.medium} or {c.rounds.long} rounds (short, medium, long). Highest prestige wins.</li>
      </ul>
      <div className="btns"><button onClick={onClose}>Close</button></div>
    </Modal>
  );
}
