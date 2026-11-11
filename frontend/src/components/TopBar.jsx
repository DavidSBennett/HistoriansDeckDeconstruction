import { Link } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function TopBar({ children }) {
  const { user, logout } = useAuth();
  return (
    <header>
      <Link to="/" style={{ color: "inherit", textDecoration: "none" }}>
        <h1>The Historians</h1>
        <div className="mono" style={{ color: "var(--mute)" }}>Deck-builder</div>
      </Link>
      <div className="sp" />
      {children}
      {user && <span className="note">{user.username}</span>}
      {user && <button className="ghost" onClick={logout}>Sign out</button>}
    </header>
  );
}
