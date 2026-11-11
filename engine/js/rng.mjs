// mulberry32, as in the mock-up, but with its state stored in the game state (S.rng, a signed 32-bit int)
// instead of a closure, so the state can be serialised and resumed anywhere, including in PHP.
export function random(S) {
  let a = S.rng | 0;
  a = (a + 0x6d2b79f5) | 0;
  S.rng = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Fisher-Yates from the end, consuming one random number per position, exactly as the mock-up does.
export function shuffle(S, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random(S) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
