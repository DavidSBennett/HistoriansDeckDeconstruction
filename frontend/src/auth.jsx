// Who is signed in. Checks users_me.php on load; the cookie does the rest.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { api } from "./api.js";

const AuthContext = createContext(null);
const BOARD = "https://board.thehistorians.org";

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, accountsSite: BOARD });

  const refresh = useCallback(async () => {
    try {
      const r = await api.me();
      setState({ loading: false, user: r.user, accountsSite: r.accountsSite || BOARD });
    } catch (e) {
      setState({ loading: false, user: null, accountsSite: e.body?.accountsSite || BOARD });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const login = async (username, password) => {
    const r = await api.login(username, password);
    setState({ loading: false, user: r.user, accountsSite: r.accountsSite || BOARD });
  };
  const logout = async () => {
    try { await api.logout(); } finally { setState((s) => ({ ...s, user: null })); }
  };
  return <AuthContext.Provider value={{ ...state, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function RequireAuth({ children }) {
  const { loading, user } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page note">Loading…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}
