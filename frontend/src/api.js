// Talks to the PHP backend (same origin). Sign-in rides on the shared th_session cookie, which the browser
// sends by itself; every request is JSON, which the backend requires for cookie-authenticated POSTs.

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call(method, file, { query, body } = {}) {
  const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null)).toString() : "";
  const res = await fetch(`/${file}${qs}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new ApiError(`The server sent an unreadable reply (${res.status}).`, res.status, null);
  }
  if (!res.ok || data.error) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data);
  return data;
}

export const api = {
  me: () => call("GET", "users_me.php"),
  login: (username, password) => call("POST", "users_login.php", { body: { username, password } }),
  logout: () => call("POST", "users_logout.php", { body: {} }),
  myGames: () => call("GET", "dk_myGames.php"),
  createGame: (length) => call("POST", "dk_createGame.php", { body: { length } }),
  joinGame: (join_code) => call("POST", "dk_joinGame.php", { body: { join_code } }),
  addBot: (game_id) => call("POST", "dk_addBot.php", { body: { game_id } }),
  removeSeat: (game_id, seat) => call("POST", "dk_removeSeat.php", { body: { game_id, seat } }),
  setLength: (game_id, length) => call("POST", "dk_setLength.php", { body: { game_id, length } }),
  startGame: (game_id) => call("POST", "dk_startGame.php", { body: { game_id } }),
  getState: (game_id, since, log_from) => call("GET", "dk_getState.php", { query: { game_id, since, log_from } }),
  action: (game_id, version, action, log_from) => call("POST", "dk_action.php", { body: { game_id, version, action, log_from } }),
  rules: (game_id) => call("GET", "dk_rules.php", { query: { game_id } }),
};
