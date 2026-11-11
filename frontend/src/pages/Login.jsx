import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { user, login, accountsSite } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={loc.state?.from || "/"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(form.username.trim(), form.password);
      nav(loc.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <header><div><h1>The Historians</h1><div className="mono" style={{ color: "var(--mute)" }}>Deck-builder</div></div></header>
      <div className="page">
        <div className="panel">
          <h2>Sign in</h2>
          <p>Use your Historians account, the same one you use on the board game.</p>
          <form className="form" onSubmit={submit}>
            <label>Username<input autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
            <label>Password<input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            {error && <div className="error">{error}</div>}
            <div><button disabled={busy || !form.username || !form.password}>{busy ? "Signing in…" : "Sign in"}</button></div>
          </form>
          <p className="note" style={{ marginTop: 14 }}>
            No account, or forgotten your password? Accounts are managed on <a href={accountsSite}>{accountsSite.replace(/^https?:\/\//, "")}</a>.
          </p>
        </div>
      </div>
    </>
  );
}
