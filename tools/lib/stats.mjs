// Shared reporting for the simulators: average prestige by finishing place and win rate by starting field.
export function makeStats(seats) {
  return { games: 0, byRank: new Array(seats).fill(0), fieldGames: {}, fieldWins: {} };
}

// ranked: players best first, each with { prestige, field }.
export function addGame(st, ranked) {
  st.games++;
  ranked.forEach((p, i) => (st.byRank[i] += p.prestige));
  for (const p of ranked) st.fieldGames[p.field] = (st.fieldGames[p.field] || 0) + 1;
  st.fieldWins[ranked[0].field] = (st.fieldWins[ranked[0].field] || 0) + 1;
}

export function report(st, heading) {
  const winRate = Object.keys(st.fieldGames).sort()
    .map((L) => `${L} ${((100 * (st.fieldWins[L] || 0)) / st.fieldGames[L]).toFixed(0)}% of ${st.fieldGames[L]}`)
    .join(", ");
  return [
    heading,
    "  average prestige by finishing place: " + st.byRank.map((s) => (s / st.games).toFixed(1)).join(" / "),
    "  win rate by starting field: " + winRate,
  ].join("\n");
}
