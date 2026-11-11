import { useParams, Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { api } from "../api.js";
import { useGame } from "../useGame.js";
import TopBar from "../components/TopBar.jsx";
import Table from "../components/Table.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";

export default function GamePage() {
  const id = Number(useParams().id);
  const g = useGame(id);
  if (g.fatal) return <><TopBar /><div className="page"><p className="error">{g.error}</p><Link to="/">Back to your games</Link></div></>;
  if (!g.game) return <><TopBar /><div className="page">{g.error ? <p className="error">{g.error}</p> : <p className="note">Loading…</p>}</div></>;
  if (g.game.status === "cancelled") return <><TopBar /><div className="page"><p>The host cancelled this game.</p><Link to="/">Back to your games</Link></div></>;
  if (g.game.status === "lobby") return <Lobby g={g} />;
  if (!g.view || !g.R) return <><TopBar /><div className="page note">Loading the table…</div></>;
  return <ErrorBoundary><Table game={g.game} view={g.view} R={g.R} act={g.act} /></ErrorBoundary>;
}

function Lobby({ g }) {
  const { game } = g;
  const nav = useNavigate();
  const [error, setError] = useState("");
  const run = async (fn) => {
    setError("");
    try { return await g.lobby(fn); } catch (e) { setError(e.message); }
  };
  const code = game.join_code.slice(0, 3) + "-" + game.join_code.slice(3);
  const full = game.seats.length >= game.max_seats;
  return (
    <>
      <TopBar />
      <div className="page">
        <div className="panel">
          <h2>Waiting to start</h2>
          <p>Share this code: <span className="code">{code}</span></p>
          <table>
            <tbody>
              {game.seats.map((s) => (
                <tr key={s.seat}>
                  <td>Seat {s.seat + 1}</td>
                  <td>{s.name}{s.seat === game.you ? " (you)" : ""}{s.seat === game.host_seat ? " · host" : ""}</td>
                  <td>{s.is_bot ? "Bot" : "Player"}</td>
                  <td style={{ textAlign: "right" }}>
                    {game.is_host && s.seat !== game.you && <button className="ghost" onClick={() => run(() => api.removeSeat(game.game_id, s.seat))}>Remove</button>}
                    {!game.is_host && s.seat === game.you && <button className="ghost" onClick={async () => { if (await run(() => api.removeSeat(game.game_id, s.seat))) nav("/"); }}>Leave</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {game.is_host ? (
            <div className="row" style={{ alignItems: "center", marginTop: 14 }}>
              <button className="ghost" disabled={full} onClick={() => run(() => api.addBot(game.game_id))}>Add a bot</button>
              <label>Length{" "}
                <select value={game.length} onChange={(e) => run(() => api.setLength(game.game_id, e.target.value))}>
                  <option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option>
                </select>
              </label>
              <span className="sp" style={{ flex: 1 }} />
              <button className="ghost" onClick={async () => { if (confirm("Cancel this game for everyone?")) { await run(() => api.removeSeat(game.game_id, game.you)); nav("/"); } }}>Cancel game</button>
              <button disabled={game.seats.length < game.min_seats} onClick={() => run(() => api.startGame(game.game_id))}>Start</button>
            </div>
          ) : (
            <p className="note">Length: {game.length}. Waiting for the host to start.</p>
          )}
          <p className="note">{game.min_seats}–{game.max_seats} players, bots included.</p>
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </>
  );
}
