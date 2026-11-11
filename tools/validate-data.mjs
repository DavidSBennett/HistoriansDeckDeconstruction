// Checks data/ for mistakes a rebalance or a deck swap could introduce.
//   node tools/validate-data.mjs [deckId]     (default: every deck under data/decks/)
// Errors would break the engine; warnings are legal but probably unintended.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const ACTION_KINDS = ["conference", "article", "book", "research", "network", "organize", "draw"];
export const CARD_FIELDS = [
  "seq", "date", "type", "title", "content", "significance", "author",
  "arg", "sub", "citation", "note", "era", "stance", "quote", "num",
];
// Every numeric key the rules read from config.json.
const CONFIG_NUMBERS = [
  "handSize", "paperPts", "articlePts", "bookBonus", "citePts", "bookMin", "bookMinFromHand",
  "runMin", "runPts", "typesMin", "typesPts", "startCards", "trashPerStack",
  "trashPenalty", "keepCards",
];
const ACTION_MODIFIERS = { pts: "number", bonus: "number", look: "number", draw: "number", min: "number", take: "number", toHand: "boolean", returns: "boolean" };
// Bookshelf effects a False Lead can have (falseLeads.json); each adds its amount per False Lead on the shelf.
export const FALSE_LEAD_EFFECTS = ["hand", "take", "power", "paper", "article", "book", "cite", "buys", "keep"];

const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function listDecks(root = ROOT) {
  const dir = path.join(root, "data", "decks");
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "deck.json")));
}

export function loadData(deckId, root = ROOT) {
  const d = (f) => readJSON(path.join(root, "data", f));
  const marketFile = path.join(root, "data", "market.json");
  const flFile = path.join(root, "data", "falseLeads.json");
  return {
    config: d("config.json"),
    actions: d("actions.json"),
    bonuses: d("bonuses.json"),
    trash: d("trash.json"),
    market: fs.existsSync(marketFile) ? readJSON(marketFile) : null,
    falseLeads: fs.existsSync(flFile) ? readJSON(flFile) : null,
    deck: d(path.join("decks", deckId, "deck.json")),
  };
}

const isInt = (n) => Number.isInteger(n);
const isStr = (s) => typeof s === "string";

export function validateData({ config, actions, bonuses, trash, deck, market = null, falseLeads = null }) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

  // config
  for (const k of CONFIG_NUMBERS) if (!isInt(config[k]) || config[k] < 0) err(`config.${k} must be a whole number >= 0`);
  if (!market && (!isInt(config.upgradeCopies) || config.upgradeCopies < 1)) err("config.upgradeCopies is needed when there is no market.json");
  if (config.terms !== undefined && !isStr(config.terms?.archive)) err("config.terms.archive must be a string");
  if (config.bookCardsTo !== undefined && !["discard", "archive"].includes(config.bookCardsTo)) err('config.bookCardsTo must be "discard" or "archive"');
  if (config.buying !== undefined && (!isInt(config.buying?.perTurn) || config.buying.perTurn < 1)) err("config.buying.perTurn must be a whole number >= 1");
  if (config.falseLead !== undefined)
    for (const k of ["articlePts", "bookCardPts"]) if (!isInt(config.falseLead?.[k]) || config.falseLead[k] < 0) err(`config.falseLead.${k} must be a whole number >= 0`);
  if (config.buying && Object.values(actions || {}).some((a) => a.kind === "network" && !a.bonus)) warn("with config.buying, a network card only adds its bonus to purchases");
  if (!config.rounds || typeof config.rounds !== "object") err("config.rounds is missing");
  else for (const [k, v] of Object.entries(config.rounds)) if (!isInt(v) || v < 1) err(`config.rounds.${k} must be a whole number >= 1`);
  const bcp = config.bookCardPts || {};
  const sizes = Object.keys(bcp).map(Number).sort((a, b) => a - b);
  if (sizes.length < 2) err("config.bookCardPts needs at least two sizes (bigger books extrapolate from the last two)");
  for (const k of Object.keys(bcp)) if (!isInt(Number(k)) || !isInt(bcp[k])) err(`config.bookCardPts.${k} must map a whole number of cards to whole points`);
  for (let i = 1; i < sizes.length; i++) if (sizes[i] !== sizes[i - 1] + 1) err(`config.bookCardPts skips from ${sizes[i - 1]} to ${sizes[i]} cards`);
  const minBook = Math.min(config.bookMin, ...Object.values(actions || {}).filter((a) => a.kind === "book" && a.min).map((a) => a.min));
  if (sizes.length && minBook < sizes[0]) err(`config.bookCardPts has no entry for ${minBook}-card books`);
  if (config.bookMinFromHand > config.bookMin) warn("config.bookMinFromHand is larger than config.bookMin");
  if (config.buying && !market) err("config.buying needs market.json");
  if (!config.seats || !isInt(config.seats.min) || !isInt(config.seats.max) || config.seats.min < 1 || config.seats.max < config.seats.min)
    err("config.seats needs whole numbers min >= 1 and max >= min");
  if (!Array.isArray(config.startingActions) || !config.startingActions.length) err("config.startingActions must list action ids");
  else for (const id of config.startingActions) {
    if (!actions[id]) err(`config.startingActions names unknown action "${id}"`);
    else if (actions[id].value !== 0) warn(`starting action "${id}" has value ${actions[id].value}, so it is also sold in the conference space`);
  }

  // actions
  for (const [id, a] of Object.entries(actions || {})) {
    if (!isStr(a.name) || !a.name) err(`actions.${id}.name is missing`);
    if (!isStr(a.text)) err(`actions.${id}.text is missing`);
    if (!ACTION_KINDS.includes(a.kind)) err(`actions.${id}.kind "${a.kind}" is not one of ${ACTION_KINDS.join(", ")}`);
    if (!isInt(a.value) || a.value < 0) err(`actions.${id}.value must be a whole number >= 0`);
    if (config.buying && (!isInt(a.power) || a.power < 0)) err(`actions.${id}.power (purchasing power) must be a whole number >= 0`);
    for (const [m, t] of Object.entries(ACTION_MODIFIERS)) if (m in a && typeof a[m] !== t) err(`actions.${id}.${m} must be a ${t}`);
    if (a.kind === "draw" && !(a.draw > 0)) err(`actions.${id} is a draw card with no "draw" amount`);
    if ("take" in a && (a.kind !== "research" || !isInt(a.take) || a.take < 1)) err(`actions.${id}.take must be a whole number >= 1 on a research card`);
  }

  // market: upgrade piles, sold top tier first, one price per pile
  if (market) {
    if (!Array.isArray(market)) err("market.json must be a list of piles");
    else {
      const ids = new Set(), sold = new Set();
      market.forEach((pl, i) => {
        const at = `market pile ${i} ("${pl.pile}")`;
        if (!isStr(pl.pile) || !pl.pile) err(`market pile ${i} has no id`);
        else if (ids.has(pl.pile)) err(`${at} appears twice`);
        ids.add(pl.pile);
        if (!isInt(pl.value) || pl.value < 1) err(`${at}: value must be a whole number >= 1`);
        if (!Array.isArray(pl.tiers) || !pl.tiers.length) return err(`${at} has no tiers`);
        for (const t of pl.tiers) {
          sold.add(t);
          if (!actions[t]) err(`${at} sells unknown action "${t}"`);
          else if (actions[t].value !== pl.value) err(`${at}: action "${t}" shows value ${actions[t].value} but the pile costs ${pl.value}`);
        }
      });
      for (const [id, a] of Object.entries(actions)) if (a.value > 0 && !sold.has(id)) warn(`upgrade "${id}" is in actions.json but not sold in market.json`);
    }
  }
  for (const k of ACTION_KINDS) if (!Object.values(actions).some((a) => a.kind === k)) warn(`no action of kind "${k}"`);

  // bonuses and trash
  for (const [t, b] of Object.entries(bonuses || {})) {
    if (!isStr(b.name) || !isStr(b.text)) err(`bonuses.${t} needs a name and text`);
    if (!isInt(b.amt)) err(`bonuses.${t}.amt must be a whole number`);
  }
  for (const [t, e] of Object.entries(falseLeads || {})) {
    if (!bonuses[t]) err(`falseLeads.${t}: "${t}" is not a source type in bonuses.json`);
    if (!isStr(e.name) || !isStr(e.text)) err(`falseLeads.${t} needs a name and text`);
    for (const k of Object.keys(e)) if (k !== "name" && k !== "text" && (!FALSE_LEAD_EFFECTS.includes(k) || !isInt(e[k]))) err(`falseLeads.${t}.${k} is not an effect (${FALSE_LEAD_EFFECTS.join(", ")}) with a whole number`);
  }
  if (!Array.isArray(trash) || !trash.length) err("trash.json must list at least one trash card");
  else trash.forEach((t, i) => { if (!isStr(t.name) || !isStr(t.text)) err(`trash[${i}] needs a name and text`); });

  // deck
  const letters = Object.keys(deck.theses || {});
  if (!isStr(deck.id) || !deck.id) err("deck.id is missing");
  if (!letters.length) err("deck.theses is empty");
  for (const [L, t] of Object.entries(deck.theses || {})) {
    if (!isStr(t.q) || !t.q) err(`thesis ${L} has no question (q)`);
    if (!Array.isArray(t.articles) || !t.articles.length) err(`thesis ${L} has no article titles`);
    if (!Array.isArray(t.books) || !t.books.length) err(`thesis ${L} has no book titles`);
    if (!isStr(t.color)) warn(`thesis ${L} has no color`);
  }
  const cards = Array.isArray(deck.cards) ? deck.cards : (err("deck.cards must be an array"), []);
  const nums = new Map();
  cards.forEach((c, i) => {
    const at = `card ${i} ("${c.title}")`;
    for (const f of CARD_FIELDS) if (!(f in c)) err(`${at} has no "${f}" field`);
    for (const f of CARD_FIELDS) if (f !== "num" && f in c && !isStr(c[f])) err(`${at}: "${f}" must be a string`);
    if (!letters.includes(c.arg)) err(`${at}: arg "${c.arg}" is not a thesis`);
    if (c.sub && !letters.includes(c.sub)) err(`${at}: sub "${c.sub}" is not a thesis`);
    if (c.sub && c.sub === c.arg) warn(`${at}: sub repeats arg`);
    if (!bonuses[c.type]) err(`${at}: type "${c.type}" has no entry in bonuses.json`);
    if (!isInt(c.num)) err(`${at}: num must be a whole number`);
    else nums.set(c.num, [...(nums.get(c.num) || []), i]);
    if (!c.era) err(`${at}: era is empty`);
    if ("power" in c && (!isInt(c.power) || c.power < 0)) err(`${at}: power must be a whole number >= 0`);
    if ("falseLead" in c && typeof c.falseLead !== "boolean") err(`${at}: falseLead must be true or false`);
    if (c.falseLead && !config.falseLead) warn(`${at} is a False Lead, but config.falseLead is missing, so it plays as a normal source`);
  });
  for (const [n, idx] of nums) if (idx.length > 1) warn(`num ${n} is shared by cards ${idx.join(", ")}`);
  for (const L of letters) {
    const n = cards.filter((c) => c.arg === L).length + config.trashPerStack;
    if (n < config.startCards) err(`stack ${L} holds ${n} cards, fewer than config.startCards (${config.startCards}), so nobody can draft it`);
  }
  // The draft needs one stack per seat with startCards left; stacks can be drafted twice if big enough.
  const draftSlots = letters.reduce((t, L) => t + Math.floor((cards.filter((c) => c.arg === L).length + config.trashPerStack) / config.startCards), 0);
  if (config.seats && draftSlots < config.seats.max) err(`only ${draftSlots} drafts fit in the stacks, but config.seats.max is ${config.seats.max}`);
  for (const t of Object.keys(bonuses)) if (!cards.some((c) => c.type === t)) warn(`no card in the deck has type "${t}"`);

  return { errors, warnings };
}

function main() {
  const ids = process.argv[2] ? [process.argv[2]] : listDecks();
  let bad = 0;
  for (const id of ids) {
    const { errors, warnings } = validateData(loadData(id));
    console.log(`deck ${id}: ${errors.length} error(s), ${warnings.length} warning(s)`);
    for (const e of errors) console.log("  error: " + e);
    for (const w of warnings) console.log("  warning: " + w);
    if (errors.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
