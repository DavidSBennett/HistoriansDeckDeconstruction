// Your games, and creating or joining one.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import TopBar from "../components/TopBar.jsx";

const STATUS = { lobby: "In the lobby", playing: "Playing", finished: "Finished" };

export default function Home() {
  const nav = useNavigate();
  const [games, setGames] = useState(null);
  const [length, setLength] = useState("medium");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => api.myGames().then((r) => live && setGames(r.games)).catch((e) => live && setError(e.message));
    load();
    const t = setInterval(load, 10000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      nav(`/game/${r.game.game_id}`);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar />
      <div className="page">
        <div className="panel">
          <h2>New game</h2>
          <div className="row" style={{ alignItems: "center" }}>
            <select value={length} onChange={(e) => setLength(e.target.value)}>
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
            <button disabled={busy} onClick={() => run(() => api.createGame(length))}>Create a game</button>
          </div>
          <p className="note">You get a code to share; seats you do not fill can go to bots.</p>
        </div>
        <div className="panel">
          <h2>Join a game</h2>
          <form className="row" style={{ alignItems: "center" }} onSubmit={(e) => { e.preventDefault(); run(() => api.joinGame(code)); }}>
            <input placeholder="Code, e.g. ABC-DEF" value={code} onChange={(e) => setCode(e.target.value)} />
            <button disabled={busy || code.trim().length < 6}>Join</button>
          </form>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="panel">
          <h2>Your games</h2>
          {!games ? <p className="note">Loading…</p> : !games.length ? <p className="note">No games yet.</p> : (
            <table className="games">
              <tbody>
                {games.map((g) => (
                  <tr key={g.game_id}>
                    <td><Link to={`/game/${g.game_id}`}>{g.seats.map((s) => s.name).join(", ")}</Link></td>
                    <td>{g.length}</td>
                    <td>{STATUS[g.status] || g.status}{g.your_move && <span className="turn"> · your move</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
