// Canonical JSON for comparing a JS value with a PHP one: object keys sorted, and an empty object written
// the same as an empty list ("[]"), because PHP cannot tell them apart once decoded. Matches
// engine/php/canon.php character for character.
import { createHash } from "node:crypto";

export function canon(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map((v) => (v === undefined ? "null" : canon(v))).join(",") + "]";
  const keys = Object.keys(x).filter((k) => x[k] !== undefined).sort();
  if (!keys.length) return "[]";
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
}

export const canonHash = (x) => createHash("sha256").update(canon(x), "utf8").digest("hex");
