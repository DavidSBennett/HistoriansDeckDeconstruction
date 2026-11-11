// One game, kept up to date by polling dk_getState.php.
//  - Polls every 1.5 s while playing, 3 s in the lobby, 20 s once finished; pauses while a move is being sent.
//  - Sends ?since=<version> so an unchanged game costs one tiny reply, and ?log_from=<n> so only new log
//    entries come back; the full log is kept here.
//  - Loads the game's rules (dk_rules.php) and builds the engine's rules object for previews and log text.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { makeRules } from "@engine/index.mjs";
import { api } from "./api.js";

const DELAY = { lobby: 3000, playing: 1500, finished: 20000, cancelled: 60000 };

export function useGame(gameId) {
  const [st, setSt] = useState({ game: null, view: null, error: "", rulesData: null });
  const ref = useRef({ version: -1, logLen: 0, busy: false, status: null, rulesFor: null });
  const R = useMemo(() => (st.rulesData ? makeRules(st.rulesData) : null), [st.rulesData]);

  const absorbView = useCallback((view) => {
    if (!view) return;
    setSt((s) => {
      const prev = s.view?.log || [];
      const log = prev.slice(0, view.logFrom).concat(view.log);
      ref.current.logLen = log.length;
      return { ...s, view: { ...view, log } };
    });
  }, []);

  const loadRules = useCallback(async (status) => {
    ref.current.rulesFor = status;
    const r = await api.rules(gameId);
    setSt((s) => ({ ...s, rulesData: r.rules }));
  }, [gameId]);

  const poll = useCallback(async (force = false) => {
    const c = ref.current;
    const r = await api.getState(gameId, force || c.version < 0 ? undefined : c.version, c.logLen);
    if (!r.changed) return;
    c.version = r.game.version;
    // The rules snapshot is taken at the start, so fetch them again when the game leaves the lobby.
    const phase = r.game.status === "lobby" ? "lobby" : "started";
    if (c.rulesFor !== phase) loadRules(phase).catch(() => {});
    c.status = r.game.status;
    setSt((s) => ({ ...s, game: r.game, error: "" }));
    absorbView(r.view);
  }, [gameId, absorbView, loadRules]);

  useEffect(() => {
    let stop = false, timer;
    ref.current = { version: -1, logLen: 0, busy: false, status: null, rulesFor: null };
    setSt({ game: null, view: null, error: "", rulesData: null });
    const tick = async () => {
      if (!ref.current.busy) {
        try { await poll(); } catch (e) { if (!stop) setSt((s) => ({ ...s, error: e.message, fatal: e.status === 403 || e.status === 404 })); }
      }
      if (!stop) timer = setTimeout(tick, DELAY[ref.current.status] || 2000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [gameId, poll]);

  // Sends one game action. Resolves with the events this player may see; throws an ApiError on refusal.
  const act = useCallback(async (action) => {
    const c = ref.current;
    c.busy = true;
    try {
      const r = await api.action(gameId, c.version, action, c.logLen);
      absorbView(r.view);
      await poll(true); // refresh lobby info (whose move it is, finished) as well
      return r.events;
    } catch (e) {
      if (e.status === 409) await poll(true).catch(() => {});
      throw e;
    } finally {
      c.busy = false;
    }
  }, [gameId, absorbView, poll]);

  // Lobby calls (add bot, start, ...): run, then refresh.
  const lobby = useCallback(async (fn) => {
    ref.current.busy = true;
    try {
      const r = await fn();
      await poll(true);
      return r;
    } finally {
      ref.current.busy = false;
    }
  }, [poll]);

  return { ...st, R, act, lobby, refresh: () => poll(true) };
}
