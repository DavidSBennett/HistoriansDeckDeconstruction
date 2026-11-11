// Builds data/decks/<id>/deck.json from a Historians deck CSV (the Historians-Deck-Builder format).
//   node tools/import-deck-csv.mjs <deck.csv> <deck id> [--name "AI History"] [--images <folder>] [--dry-run]
//
// Source rows (card_identifier "archive") become cards; conclusion rows (card_identifier "conclusion") become
// the theses. Column mapping:
//   sequence_number -> seq      source_type -> type     location -> quote (the CSV keeps the quote there)
//   argument -> arg             sub_argument -> sub     bonus -> power (purchasing power; False Leads get 0)
//   context_tags "Era|Stance|False Lead" -> era, stance, falseLead (the era comes first; the others in any order)
//   image_url -> imageUrl       description -> imageCredit (extra fields; the engine ignores them)
// --images: a folder of card pictures named <thesis letter><sequence number>, e.g. a1.jpg, c10.png (any case;
// .jpg is preferred when there are several). Each is resized to at most 640 px and saved as
// data/decks/<id>/images/<A1>.jpg, and the card's `image` field names it. Cards without a picture get
// image "" and the client draws a placeholder. Needs PHP with the GD extension (loaded per command).
//   conclusion title "Thesis X: question" -> theses[X].q; article_titles / book_titles split on " | "
// `num`, the chronological number the Sequence set uses, is computed: cards are ordered by the earliest date
// their date text mentions (a year alone counts as the start of that year), ties in CSV order. The order is
// printed so it can be checked. Passive bonuses come from the source type, not the CSV.
// Thesis colours are kept from the deck being replaced, or taken from the default palette.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateData, loadData } from "./validate-data.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FALSE_LEAD = "false lead";
const PALETTE = { A: "#7b2d2d", B: "#2d587b", C: "#2f7a52", D: "#7d5a2c", E: "#5b3f7a", F: "#2f6f73" };

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes. Returns rows of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = MONTHS.join("|");

/** [year, month, day] for the earliest date a free-text date mentions (month and day 0 when absent). */
export function earliestDate(text) {
  const found = [];
  const s = String(text);
  // "June-August 1956": the first month of a month range belongs to the year that follows.
  for (const m of s.matchAll(new RegExp(`\\b(${MONTH_RE})\\s*[-–]\\s*(?:${MONTH_RE})\\s+(\\d{4})`, "gi")))
    found.push([+m[2], MONTHS.indexOf(m[1].toLowerCase()) + 1, 0]);
  for (const m of s.matchAll(new RegExp(`\\b(?:(${MONTH_RE})\\s+(?:(\\d{1,2}),?\\s+)?)?(\\d{4})\\b`, "gi")))
    found.push([+m[3], m[1] ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0, m[2] ? +m[2] : 0]);
  if (!found.length) return null;
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return found[0];
}

export function buildDeck(csvText, { id, name, colors = {} }) {
  const [header, ...rows] = parseCsv(csvText);
  const col = (r, n) => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`The CSV has no "${n}" column.`);
    return (r[i] ?? "").trim();
  };
  const theses = {};
  for (const r of rows.filter((r) => col(r, "card_identifier") === "conclusion")) {
    const L = col(r, "argument");
    const m = col(r, "title").match(/^Thesis\s+([A-Z])\s*:\s*(.+)$/);
    if (!m || m[1] !== L) throw new Error(`Conclusion row "${col(r, "title")}" should read "Thesis ${L}: <question>".`);
    const list = (s) => s.split("|").map((x) => x.trim()).filter(Boolean);
    theses[L] = { q: m[2], articles: list(col(r, "article_titles")), books: list(col(r, "book_titles")), color: colors[L] || PALETTE[L] || "#555555" };
  }
  const sorted = Object.keys(theses).sort();
  const ordered = Object.fromEntries(sorted.map((L) => [L, theses[L]]));

  const sources = rows.filter((r) => col(r, "card_identifier") === "archive");
  const cards = sources.map((r, row) => {
    const [era, ...tags] = col(r, "context_tags").split("|").map((s) => s.trim()).filter(Boolean);
    const falseLead = tags.some((t) => t.toLowerCase() === FALSE_LEAD);
    const stance = tags.filter((t) => t.toLowerCase() !== FALSE_LEAD).join(", ");
    const bonusText = col(r, "bonus");
    const power = falseLead ? 0 : bonusText === "" ? 1 : Number(bonusText);
    if (!Number.isInteger(power) || power < 0) throw new Error(`Card "${col(r, "title")}": bonus "${bonusText}" is not a whole number.`);
    return {
      seq: col(r, "sequence_number"),
      date: col(r, "date"),
      type: col(r, "source_type"),
      title: col(r, "title"),
      content: col(r, "content"),
      significance: col(r, "significance"),
      author: col(r, "author"),
      arg: col(r, "argument"),
      sub: col(r, "sub_argument"),
      citation: col(r, "citation"),
      note: "",
      era,
      stance,
      quote: col(r, "location"),
      num: 0,
      power,
      falseLead,
      image: "",
      imageUrl: col(r, "image_url"),
      imageCredit: col(r, "description"),
      _row: row,
    };
  });
  const undated = cards.filter((c) => !earliestDate(c.date));
  if (undated.length) throw new Error("No year found in the date of: " + undated.map((c) => c.title).join("; "));
  const chron = cards.slice().sort((a, b) => {
    const x = earliestDate(a.date), y = earliestDate(b.date);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a._row - b._row;
  });
  chron.forEach((c, i) => (c.num = i + 1));
  for (const c of cards) delete c._row;
  return { deck: { id, name, theses: ordered, cards }, chron };
}

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp"];

/** For each card, the picture in `dir` named <letter><seq> (preferring .jpg), or null. */
export function findImages(cards, files) {
  const byKey = {};
  for (const f of files) {
    const m = f.match(/^([a-z])(\d+)\.([a-z]+)$/i);
    if (!m || !IMAGE_EXT.includes(m[3].toLowerCase())) continue;
    const key = m[1].toUpperCase() + Number(m[2]);
    const rank = IMAGE_EXT.indexOf(m[3].toLowerCase());
    if (!byKey[key] || rank < byKey[key].rank) byKey[key] = { file: f, rank };
  }
  return cards.map((c) => byKey[c.arg + Number(c.seq)]?.file ?? null);
}

function attachImages(deck, dir, outDir) {
  const files = fs.readdirSync(dir);
  const found = findImages(deck.cards, files);
  const manifest = { max: 640, quality: 82, files: [] };
  deck.cards.forEach((c, i) => {
    if (!found[i]) return;
    c.image = `${c.arg}${Number(c.seq)}.jpg`;
    manifest.files.push({ in: path.join(dir, found[i]), out: path.join(outDir, c.image) });
  });
  const tmp = path.join(ROOT, "build", "image-manifest.json");
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(manifest));
  fs.rmSync(outDir, { recursive: true, force: true });
  const mods = execFileSync("php", ["-m"], { encoding: "utf8" }).toLowerCase().split(/\r?\n/);
  const php = mods.includes("gd") ? [] : ["-d", "extension=gd"];
  const lines = execFileSync("php", [...php, path.join(ROOT, "tools", "resize-images.php"), tmp], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const failed = lines.filter((l) => l.error);
  for (const f of failed) {
    const c = deck.cards.find((x) => path.join(outDir, x.image) === manifest.files.find((m) => m.in === f.in)?.out);
    if (c) c.image = "";
    console.log(`  image error: ${path.basename(f.in)}: ${f.error}`);
  }
  const ok = lines.filter((l) => !l.error);
  const kb = ok.reduce((t, l) => t + l.bytes, 0) / 1024;
  const missing = deck.cards.filter((c) => !c.image).map((c) => `${c.arg}${c.seq} ${c.title}`);
  const unused = files.filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f) && !found.includes(f));
  console.log(`Images: ${ok.length} of ${deck.cards.length} cards, ${kb.toFixed(0)} KB in all.`);
  if (missing.length) console.log("  no picture for: " + missing.join("; "));
  if (unused.length) console.log(`  ${unused.length} other files in the folder were not used (they are not named <letter><number>).`);
}

function main() {
  const args = process.argv.slice(2);
  const valued = new Set(["--name", "--images"]);
  const [csvFile, id] = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
  if (!csvFile || !id || !/^[a-z0-9-]+$/.test(id)) {
    console.error('Usage: node tools/import-deck-csv.mjs <deck.csv> <deck id> [--name "Deck name"] [--dry-run]');
    process.exit(2);
  }
  const name = args.includes("--name") ? args[args.indexOf("--name") + 1] : id;
  const out = path.join(ROOT, "data", "decks", id, "deck.json");
  const old = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null;
  const colors = old ? Object.fromEntries(Object.entries(old.theses).map(([L, t]) => [L, t.color])) : {};
  const { deck, chron } = buildDeck(fs.readFileSync(csvFile, "utf8"), { id, name, colors });

  const data = { ...loadData("ai-history"), deck };
  const { errors, warnings } = validateData(data);
  console.log(`${deck.cards.length} cards, theses ${Object.keys(deck.theses).join(", ")}; ${errors.length} error(s), ${warnings.length} warning(s)`);
  for (const e of errors) console.log("  error: " + e);
  for (const w of warnings) console.log("  warning: " + w);
  console.log("Chronological numbers (used by the Sequence set):");
  for (const c of chron) console.log(`  ${String(c.num).padStart(2)}  ${c.arg}  ${c.date.padEnd(44)} ${c.title}`);
  const types = {};
  for (const c of deck.cards) types[c.type] = (types[c.type] || 0) + 1;
  console.log("Source types: " + Object.entries(types).map(([t, n]) => `${t} ${n}`).join(", "));
  if (errors.length) process.exit(1);
  if (args.includes("--dry-run")) return;
  if (args.includes("--images")) attachImages(deck, args[args.indexOf("--images") + 1], path.join(path.dirname(out), "images"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(deck, null, 2) + "\n");
  console.log("wrote " + path.relative(ROOT, out));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
