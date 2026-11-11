import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, earliestDate, buildDeck } from "../tools/import-deck-csv.mjs";
import { loadData, validateData } from "../tools/validate-data.mjs";

test("CSV parsing handles quotes, doubled quotes, commas and newlines inside fields", () => {
  const rows = parseCsv('a,b,c\r\n1,"x, y","say ""hi""\nthere"\n\n2,,z\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", 'say "hi"\nthere'], ["2", "", "z"]]);
});

test("the earliest date in free-text dates", () => {
  const cases = {
    "1922": [1922, 0, 0],
    "c. November 19, 1946": [1946, 11, 19],
    "Kept 1928-1972; entry quoted June 13, 1959": [1928, 0, 0],
    "June 1948 - January 1949": [1948, 6, 0],
    "June-August 1956": [1956, 6, 0],
    "c. 1970-71": [1970, 0, 0],
    "Read November 12, 1936": [1936, 11, 12],
    "by 1992": [1992, 0, 0],
  };
  for (const [s, want] of Object.entries(cases)) assert.deepEqual(earliestDate(s), want, s);
  assert.equal(earliestDate("undated"), null);
});

const HEADER = "sequence_number,date,source_type,title,content,significance,author,location,argument,sub_argument,bonus,citation,image_url,contributor,card_identifier,description,article_titles,book_titles,context_tags";
const row = (n, date, type, title, arg, sub, era) => `${n},"${date}",${type},${title},content,sig,author,"""a quote""",${arg},${sub},1,cite,,,archive,credit,,,"${era}|Builder"`;

test("a CSV becomes a deck: theses from conclusion rows, chronological numbers, quote from the location column", () => {
  const csv = [
    HEADER,
    row(1, "1950", "Letter", "Later", "A", "", "Era One"),
    row(2, "March 3, 1949", "Map", "Earlier", "A", "B", "Era One"),
    row(1, "1960", "Diary", "Latest", "B", "", "Era Two"),
    ',,,"Thesis A: First question?",x,,,,A,,,,,,conclusion,,One | Two,Book One | Book Two,',
    ',,,"Thesis B: Second question?",x,,,,B,,,,,,conclusion,,Three,Book Three,',
  ].join("\n");
  const { deck } = buildDeck(csv, { id: "t", name: "T", colors: { A: "#111111" } });
  assert.deepEqual(Object.keys(deck.theses), ["A", "B"]);
  assert.equal(deck.theses.A.q, "First question?");
  assert.deepEqual(deck.theses.A.articles, ["One", "Two"]);
  assert.equal(deck.theses.A.color, "#111111");
  assert.deepEqual(deck.cards.map((c) => [c.title, c.num]), [["Later", 2], ["Earlier", 1], ["Latest", 3]]);
  assert.equal(deck.cards[1].quote, '"a quote"');
  assert.deepEqual([deck.cards[1].era, deck.cards[1].stance, deck.cards[1].sub], ["Era One", "Builder", "B"]);
});

test("the AI History deck in data/ is the Historians-Deck-Builder CSV edition", () => {
  const { deck } = loadData("ai-history");
  assert.match(deck.theses.A.q, /thinking machine conceived in theory/);
  assert.ok(deck.cards.some((c) => c.title === "Richardson's Forecast-Factory Map" && c.num === 1));
  assert.deepEqual(validateData(loadData("ai-history")).errors, []);
});
