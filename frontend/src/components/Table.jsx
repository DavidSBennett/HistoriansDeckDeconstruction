// The game table: a port of the mock-up's render(), renderDock() and modals, driven by the player's view
// from the server. Every click flow ends in one protocol message sent with act(); the server answers with
// the new view. The engine's own helpers (bookCheck, bonus, keepLimit, nextTier) run on the view for live
// previews, and describe() writes the log.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { bookCheck, bonus, keepLimit, nextTier, describe } from "@engine/index.mjs";
import { Card, SourceCard, ActionCard, Modal, ReadCard, color } from "./Cards.jsx";
import TopBar from "./TopBar.jsx";
import RulesModal from "./RulesModal.jsx";

const EMPTY = { mode: null, a: null, sel: [], shelf: [], step: 0, up: null };
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");

export default function Table({ game, view: G, R, act }) {
  const me = G.you;
  const p = G.players[me];
  const [ui, setUi] = useState(EMPTY);
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [rej, setRej] = useState([]);
  const [shownResults, setShownResults] = useState(false);

  const kindOf = (u) => G.cards[u]?.kind;
  const def = (u) => R.actions[G.cards[u].ref];
  const srcOf = (u) => R.cards[G.cards[u].ref];
  const acting = G.over ? null : G.phase === "draft" ? G.draftAt : G.pending ? G.pending.seat : G.turn;
  const myTurn = !G.over && G.phase === "play" && G.turn === me && !G.pending && !busy;
  const myPending = G.pending && G.pending.seat === me ? G.pending : null;
  const myDraft = !G.over && G.phase === "draft" && G.draftAt === me;
  const aDef = ui.a ? def(ui.a) : null;
  const fixedResearch = ui.mode === "research" && Number.isInteger(aDef?.take);
  const read = (d) => setModal({ kind: "read", d });

  useEffect(() => { if (!myTurn && ui.mode && !busy) setUi(EMPTY); }, [myTurn]); // eslint-disable-line
  useEffect(() => { if (G.over && !shownResults) { setModal({ kind: "results" }); setShownResults(true); } }, [G.over]); // eslint-disable-line
  useEffect(() => { setRej([]); }, [myPending?.seen?.join(",")]);

  const reset = () => { setUi(EMPTY); setStatus(""); setErr(""); };
  async function send(action, after) {
    setBusy(true);
    setErr("");
    try {
      const events = await act(action);
      setUi(EMPTY);
      setStatus("");
      if (modal?.kind !== "read") setModal(null);
      after?.(events);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  const showFound = (events, toHand) => {
    const e = events.find((x) => x.type === "research" && x.seat === me);
    if (e) setModal({ kind: "cards", title: "You found", uids: e.got, note: toHand ? "Added to your hand." : "Added to your discard pile. You will draw them after your next shuffle." });
  };

  // ---------- clicks ----------
  function handClickable(u) {
    if (!myTurn) return false;
    if (!ui.mode) return kindOf(u) === "action";
    if (ui.mode === "keep") return true;
    if (ui.mode === "organize" || ui.step === 1 || u === ui.a || fixedResearch) return false;
    return ui.mode === "research" || ui.mode === "network" ? true : kindOf(u) === "source";
  }
  function clickHand(u) {
    if (!handClickable(u)) return;
    if (ui.mode === "keep") {
      const lim = keepLimit(G, R, me);
      setUi((s) => {
        const sel = s.sel.filter((x) => x !== u);
        if (sel.length === s.sel.length) { while (sel.length >= lim) sel.shift(); sel.push(u); }
        return { ...s, sel };
      });
      return;
    }
    if (!ui.mode) {
      const d = def(u);
      if (d.kind === "draw") return send({ type: "playDraw", card: u });
      if (d.kind === "organize") {
        const t = [...p.hand, ...p.discard].filter((x) => kindOf(x) === "trash");
        if (!t.length) return setStatus("You have no trash cards in your hand or discard pile.");
        setUi({ ...EMPTY, mode: "organize", a: u, sel: t });
        return setModal({ kind: "organize" });
      }
      setUi({ ...EMPTY, mode: d.kind, a: u });
      setStatus("");
      return;
    }
    setUi((s) => {
      let sel = s.sel.slice();
      const i = sel.indexOf(u);
      if (i >= 0) sel.splice(i, 1);
      else {
        if (s.mode === "conference") sel = [];
        if (s.mode === "article" && sel.length >= 2) sel.shift();
        sel.push(u);
      }
      return { ...s, sel };
    });
  }
  const stackClickable = (L) => ui.mode === "research" && myTurn && G.stacks[L] > 0 && (fixedResearch || ui.sel.length > 0);
  function clickStack(L) {
    if (!stackClickable(L)) return;
    const toHand = !!aDef.toHand;
    send({ type: "research", card: ui.a, stack: L, ...(fixedResearch ? {} : { discard: ui.sel }) }, (ev) => showFound(ev, toHand));
  }
  const netValue = ui.mode === "network" ? ui.sel.length + (aDef?.bonus || 0) + bonus(G, R, me, "Letter") : -1;
  const pileClickable = (pl) => myTurn && ui.mode === "network" && G.market[pl.pile] > 0 && netValue >= pl.value;
  function clickPile(pl) {
    if (!pileClickable(pl)) return;
    setUi((s) => ({ ...s, up: pl.pile }));
    setModal({ kind: "replace" });
  }
  const shelfClickable = (e) => myTurn && ui.mode === "book" && ui.step === 0 && !e.usedBy.includes(me);
  function clickShelf(e) {
    if (!shelfClickable(e)) return;
    setUi((s) => ({ ...s, shelf: s.shelf.includes(e.uid) ? s.shelf.filter((x) => x !== e.uid) : [...s.shelf, e.uid] }));
  }
  const bookSel = ui.mode === "book" ? bookCheck(G, R, me, aDef, ui.sel, ui.shelf) : null;
  const sameEra = ui.mode === "article" && ui.sel.length === 2 && ui.sel.every((u) => kindOf(u) === "source") && srcOf(ui.sel[0]).era === srcOf(ui.sel[1]).era;
  function endTurn() {
    if (!myTurn) return;
    reset();
    if (p.hand.length && keepLimit(G, R, me)) setUi({ ...EMPTY, mode: "keep" });
    else send({ type: "endTurn", keep: [] });
  }

  // ---------- pieces ----------
  const cvLine = (q) => {
    const n = (t) => q.cv.filter((x) => x.type === t).length;
    return `${plural(n("book"), "book")} · ${plural(n("article"), "article")} · ${plural(n("paper"), "conference paper")} · cited ${plural(q.cites, "time")}`;
  };
  const bonusSum = (q, shelfOnly) => {
    const out = [];
    for (const t of Object.keys(R.bonuses)) {
      const sh = q.shelf.filter((e) => srcOf(e.uid).type === t).length;
      const h = shelfOnly || !q.hand ? 0 : q.hand.filter((u) => kindOf(u) === "source" && srcOf(u).type === t).length;
      if (sh + h) out.push(<span key={t}>{out.length ? " · " : ""}<b>{R.bonuses[t].name}</b> ×{sh + h}{h && !shelfOnly ? <span className="note"> ({sh} shelf, {h} hand)</span> : null}</span>);
    }
    return <div className="bsum">{shelfOnly ? "Bookshelf bonuses: " : "Active bonuses: "}{out.length ? out : <span className="note">none</span>}</div>;
  };
  const shelf = (q) => !q.shelf.length ? <div className="note">Bookshelf empty.</div> : (
    <div className="row">
      {q.shelf.map((e) => {
        const used = e.usedBy.includes(me), on = ui.shelf.includes(e.uid), can = shelfClickable(e);
        return (
          <SourceCard key={e.uid} R={R} d={srcOf(e.uid)} mini onRead={read}
            cls={(on ? "sel " : "") + (can ? "target " : "") + (ui.mode === "book" && used ? "dim" : "")}
            onClick={can ? () => clickShelf(e) : undefined}
            foot={used ? <div className="used">Already in one of your books</div> : null} />
        );
      })}
    </div>
  );

  // ---------- dock ----------
  let msg = null, st = "", btns = [];
  const B = (label, onClick, disabled, ghost) => <button key={label} className={ghost ? "ghost" : ""} disabled={disabled || busy} onClick={onClick}>{label}</button>;
  if (G.over) { msg = "The game is over."; btns.push(B("Results", () => setModal({ kind: "results" }))); }
  else if (myDraft) msg = <><b>Choose your field.</b> Pick a card archive to start from.</>;
  else if (myPending) msg = <><b>Research.</b> Choose which cards to put back.</>;
  else if (acting !== me) msg = <>{G.players[acting].name} is {G.phase === "draft" ? "choosing a field" : "taking a turn"}…</>;
  else if (!ui.mode) { msg = <><b>Your turn.</b> Click an action card in your hand to play it. You may play any number of them.</>; btns.push(B("End turn", endTurn)); }
  else if (ui.mode === "keep") {
    const lim = keepLimit(G, R, me), k = ui.sel.length;
    msg = <><b>End of turn.</b> You may keep up to {plural(lim, "card")} in hand for next turn. Click to choose.</>;
    st = `${k} of ${lim} chosen.`;
    btns.push(B(k ? `End turn, keeping ${k}` : "End turn, keeping nothing", () => send({ type: "endTurn", keep: ui.sel })), B("Back", reset, false, true));
  } else if (ui.mode !== "organize") {
    const n = ui.sel.length;
    if (ui.mode === "research") {
      const look = bonus(G, R, me, "Map") + (aDef.look || 0);
      const take = fixedResearch ? aDef.take : n + (aDef.bonus || 0);
      msg = fixedResearch
        ? <><b>{aDef.name}.</b> Click a card archive.</>
        : <><b>{aDef.name}.</b> Select cards in your hand to discard, then click a card archive.</>;
      st = fixedResearch || n ? `You will ${look ? `look at ${take + look} and keep ${take}` : `take ${take}`} from the archive you click.` : "Nothing selected yet.";
    }
    if (ui.mode === "network") { msg = <><b>{aDef.name}.</b> Select cards to discard, then click an upgrade you can afford.</>; st = `Discards count as ${netValue}.`; }
    if (ui.mode === "conference") { msg = <><b>{aDef.name}.</b> Select one source in your hand.</>; btns.push(B("Publish paper", () => send({ type: "conference", card: ui.a, source: ui.sel[0] }), n !== 1)); }
    if (ui.mode === "article") {
      if (ui.step === 1) {
        msg = <><b>Which card goes on your bookshelf?</b> The other goes to your discard pile.</>;
        for (const u of ui.sel) btns.push(B(srcOf(u).title, () => send({ type: "article", card: ui.a, sources: ui.sel, showcase: u })));
      } else {
        msg = <><b>{aDef.name}.</b> Select two sources from the same era.</>;
        st = n === 2 && !sameEra ? "Those two are from different eras." : `${n} of 2 selected.`;
        btns.push(B("Continue", () => setUi((s) => ({ ...s, step: 1 })), !sameEra));
      }
    }
    if (ui.mode === "book") {
      if (ui.step === 1) {
        msg = <><b>Which card from your hand goes on your bookshelf?</b> The others go to your discard pile.</>;
        st = bookSel.msg;
        for (const u of ui.sel) btns.push(B(`No. ${srcOf(u).num} ${srcOf(u).title}`, () => send({ type: "book", card: ui.a, hand: ui.sel, shelf: ui.shelf, showcase: u })));
      } else {
        msg = <><b>{aDef.name}.</b> Select {aDef.min || R.config.bookMin}+ cards that share a thesis letter (big or small): at least {R.config.bookMinFromHand} from hand, the rest from any bookshelf.</>;
        st = bookSel.msg;
        btns.push(B("Continue", () => setUi((s) => ({ ...s, step: 1 })), !bookSel.ok));
      }
    }
    btns.push(B("Cancel", reset, false, true));
  }

  // ---------- modals ----------
  let overlay = null;
  if (modal?.kind === "read") overlay = <ReadCard R={R} d={modal.d} onClose={() => setModal(null)} />;
  else if (modal?.kind === "rules") overlay = <RulesModal R={R} onClose={() => setModal(null)} />;
  else if (myDraft) {
    overlay = (
      <Modal>
        <h3>{p.name}: choose your field</h3>
        <p>Take the top {R.config.startCards} cards of one card archive into your starting deck. You will not see them until you choose, and some may be trash.</p>
        <div className="row">
          {R.letters.map((L) => {
            const n = G.stacks[L], ok = n >= R.config.startCards;
            return (
              <button key={L} className={"stack pick" + (ok ? "" : " off")} style={{ background: color(R, L) }} disabled={!ok || busy}
                onClick={() => send({ type: "draft", stack: L }, (ev) => {
                  const e = ev.find((x) => x.type === "draft" && x.seat === me);
                  if (e) setModal({ kind: "cards", title: `${p.name}: your starting sources`, uids: e.cards, note: "These are shuffled into your deck with your action cards." });
                })}>
                <div className="L">{L}</div><div className="q">{R.theses[L].q}</div><div className="mono">{n} cards</div>
              </button>
            );
          })}
        </div>
        {err && <p className="error">{err}</p>}
      </Modal>
    );
  } else if (myPending) {
    const k = myPending.reject;
    overlay = (
      <Modal>
        <h3>You found {myPending.seen.length} cards: keep {myPending.keepN}</h3>
        <p className="note">Click {plural(k, "card")} to put back under card archive {myPending.L}. The rest go to your {myPending.toHand ? "hand" : "discard pile"}.</p>
        <div className="row">
          {myPending.seen.map((u) => (
            <Card key={u} G={G} R={R} uid={u} cls={rej.includes(u) ? "dim" : ""} onRead={read}
              onClick={() => setRej((s) => (s.includes(u) ? s.filter((x) => x !== u) : [...s.slice(s.length >= k ? 1 : 0), u]))} />
          ))}
        </div>
        {err && <p className="error">{err}</p>}
        <div className="btns">
          <button disabled={rej.length !== k || busy} onClick={() => send({ type: "researchChoose", putBack: rej }, (ev) => showFound(ev, myPending.toHand))}>Put back {rej.length} of {k}</button>
        </div>
      </Modal>
    );
  } else if (modal?.kind === "cards") {
    overlay = (
      <Modal onClose={() => setModal(null)}>
        <h3>{modal.title}</h3>
        {modal.note && <p className="note">{modal.note}</p>}
        <div className="row">{modal.uids.length ? modal.uids.map((u) => <Card key={u} G={G} R={R} uid={u} onRead={read} />) : <div className="note">Nothing here.</div>}</div>
        <div className="btns"><button onClick={() => setModal(null)}>Close</button></div>
      </Modal>
    );
  } else if (modal?.kind === "organize") {
    const t = [...p.hand, ...p.discard].filter((x) => kindOf(x) === "trash");
    overlay = (
      <Modal>
        <h3>Organize: throw out trash</h3>
        <p className="note">From your hand and discard pile. Click a card to keep it instead.</p>
        <div className="row">
          {t.map((u) => <Card key={u} G={G} R={R} uid={u} cls={ui.sel.includes(u) ? "sel" : ""}
            onClick={() => setUi((s) => ({ ...s, sel: s.sel.includes(u) ? s.sel.filter((x) => x !== u) : [...s.sel, u] }))} />)}
        </div>
        {err && <p className="error">{err}</p>}
        <div className="btns">
          <button className="ghost" onClick={() => { reset(); setModal(null); }}>Cancel</button>
          <button disabled={!ui.sel.length || busy} onClick={() => send({ type: "organize", card: ui.a, trash: ui.sel })}>Throw out {ui.sel.length}</button>
        </div>
      </Modal>
    );
  } else if (modal?.kind === "replace") {
    const tier = nextTier(G, R, ui.up);
    overlay = (
      <Modal onClose={() => setModal(null)}>
        <h3>Replace which card with {R.actions[tier].name}?</h3>
        <p className="note">Choose a card from your discard pile, including the ones you are discarding now. A replaced action or trash card leaves the game; a replaced source goes back to its card archive.</p>
        <div className="row">
          {[...ui.sel, ...p.discard].map((u) => <Card key={u} G={G} R={R} uid={u} cls="target"
            onClick={() => send({ type: "network", card: ui.a, discard: ui.sel, pile: ui.up, replace: u })} />)}
        </div>
        {err && <p className="error">{err}</p>}
        <div className="btns"><button className="ghost" onClick={() => setModal(null)}>Cancel</button></div>
      </Modal>
    );
  } else if (modal?.kind === "results") {
    const books = (q) => q.cv.filter((x) => x.type === "book").length;
    const ranked = G.players.slice().sort((a, b) => b.prestige - a.prestige || books(b) - books(a));
    overlay = (
      <Modal onClose={() => setModal(null)}>
        <h3>{ranked[0].name} wins</h3>
        <table>
          <thead><tr><th>Historian</th><th>Prestige</th><th>Books</th><th>Articles</th><th>Papers</th><th>Cited</th><th>Trash</th></tr></thead>
          <tbody>
            {ranked.map((q) => (
              <tr key={q.i}><td>{q.name}</td><td><b>{q.prestige}</b></td><td>{books(q)}</td><td>{q.cv.filter((x) => x.type === "article").length}</td>
                <td>{q.cv.filter((x) => x.type === "paper").length}</td><td>{q.cites}</td><td>{q.trash ?? 0}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="note">{G.round} rounds played.</p>
        <div className="btns"><button className="ghost" onClick={() => setModal(null)}>Look at the table</button><Link to="/"><button>Back to your games</button></Link></div>
      </Modal>
    );
  }

  // ---------- page ----------
  const rivals = G.players.filter((q) => q.i !== me);
  return (
    <>
      <TopBar>
        <div className="score">
          <span className="chip">Round {G.round} of {G.rounds}</span>
          {G.players.map((q) => <span key={q.i} className={"chip" + (q.i === acting ? " cur" : "")}>{q.name}: <b>{q.prestige}</b></span>)}
        </div>
        <button className="ghost" onClick={() => setModal({ kind: "rules" })}>Rules</button>
      </TopBar>
      <main className="table">
        <div>
          <div className="panel">
            <h2>The card archives</h2>
            <div className="row">
              {R.letters.map((L) => {
                const n = G.stacks[L], t = stackClickable(L);
                return (
                  <div key={L} className={"stack" + (n ? "" : " empty") + (t ? " target" : "")} style={{ background: color(R, L) }}
                    onClick={t ? () => clickStack(L) : undefined} role={t ? "button" : undefined}>
                    <div className="L">{L}</div><div className="q">{R.theses[L].q}</div><div className="mono">{plural(n, "card")} left</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <h2>Conference space: upgrade cards</h2>
            <div className="row">
              {R.piles.map((pl) => {
                const left = G.market[pl.pile] || 0, tier = nextTier(G, R, pl.pile), t = pileClickable(pl);
                const shown = R.actions[tier || pl.tiers[pl.tiers.length - 1]];
                const after = left > 1 ? R.actions[pl.tiers[pl.tiers.length - left + 1]] : null;
                return (
                  <div key={pl.pile} className={"up" + (left ? "" : " gone") + (t ? " target" : "")} onClick={t ? () => clickPile(pl) : undefined} role={t ? "button" : undefined}>
                    <div><span className="val">{pl.value}</span> <span className="nm">{shown.name}</span></div>
                    <div className="tx">{shown.text}</div>
                    {after && after.name !== shown.name && <div className="next">Then: {after.name}. {after.text}</div>}
                    <div className="mono" style={{ color: "var(--mute)", marginTop: "auto" }}>{left} left</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <h2>Rivals</h2>
            {rivals.map((q) => (
              <div className="pl" key={q.i}>
                <div><span className="nm">{q.name}</span>{q.bot ? " (bot)" : ""} · {q.prestige} prestige <span className="note">· deck {q.counts.deck}, hand {q.counts.hand}, discard {q.counts.discard}</span></div>
                <div className="cv">{cvLine(q)}</div>
                {bonusSum(q, true)}
                {shelf(q)}
                {q.play.length > 0 && <div className="note" style={{ marginTop: 6 }}>Played this turn: {q.play.map((u) => def(u).name).join(", ")}</div>}
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>{p.name}: bookshelf and CV</h2>
            <div className="cv">{p.prestige} prestige · {cvLine(p)}</div>
            {bonusSum(p, false)}
            {shelf(p)}
            {p.cv.length > 0 && <div className="note" style={{ marginTop: 8 }}>{p.cv.map((x) => `${x.type === "book" ? "Book" : x.type === "article" ? "Article" : "Paper"}: ${x.title} (+${x.pts})`).join(" · ")}</div>}
          </div>
          <div className="panel">
            <h2>Your hand</h2>
            <div className="row">
              {p.hand.map((u) => {
                const on = ui.sel.includes(u), isA = u === ui.a, click = handClickable(u);
                const cls = (on || isA ? "sel " : "") + (click && ui.mode === "keep" ? "target " : "") + (myTurn && ui.mode && !click && !isA && !on ? "dim" : "");
                return <Card key={u} G={G} R={R} uid={u} cls={cls} onRead={read} onClick={click ? () => clickHand(u) : undefined} />;
              })}
              {p.play.map((u) => <ActionCard key={u} R={R} id={G.cards[u].ref} cls="played" />)}
              {!p.hand.length && !p.play.length && <div className="note">No cards in hand.</div>}
            </div>
            <div className="note" style={{ marginTop: 10 }}>
              Deck: {p.counts.deck} · <button className="linkish" onClick={() => setModal({ kind: "cards", title: "Your discard pile", uids: p.discard, note: "These return to your deck at the next shuffle." })}>Discard pile: {p.discard.length}</button> · Played cards (faded) go to your discard pile at the end of the turn.
            </div>
          </div>
        </div>
        <div>
          <div className="panel">
            <h2>Log</h2>
            <div className="log">
              {G.log.slice().reverse().map((e, i) => <div key={G.log.length - i}><span className="t">R{e.r}</span> {describe(e, G, R)}</div>)}
            </div>
          </div>
        </div>
      </main>
      <div id="dock">
        <div className="msg">
          <div>{msg}</div>
          {st && <div className="st">{st}</div>}
          {status && <div className="st">{status}</div>}
          {err && !overlay && <div className="err">{err}</div>}
        </div>
        <div className="row">{btns}</div>
      </div>
      {overlay}
    </>
  );
}
