import { useEffect } from "react";

// Card faces, ported from the mock-up's srcHTML / actHTML / trashHTML. `G` is the view (its cards lookup
// says what each card id is), `R` the game's rules.

export const color = (R, L) => R.theses[L]?.color || "#555";

/** The picture's URL for a card, or null. Pictures are served from /decks/<deck id>/images/. */
export const imageUrl = (R, d) => (d.image && R.deck?.id ? `/decks/${R.deck.id}/images/${d.image}` : null);

/** The image space on a card face: the picture, or a placeholder in the thesis colour. */
function Picture({ R, d }) {
  const url = imageUrl(R, d);
  if (url) return <img className="pic" src={url} alt="" loading="lazy" draggable="false" />;
  return <div className="pic none" style={{ background: color(R, d.arg) }} aria-hidden="true"><span className="mono">{d.type}</span></div>;
}

/** Is this source a False Lead under these rules? */
export const isFL = (R, d) => !!R.config.falseLead && !!d.falseLead;
/** The purchasing-power coin, when the rules have buying. */
export function Power({ R, n }) {
  if (!R.config.buying) return null;
  return <span className="pw" title="Purchasing power">{n}</span>;
}

export function Tags({ R, d }) {
  return (
    <>
      <span className="tg" style={{ background: color(R, d.arg) }}>{d.arg}</span>
      {d.sub && <span className="tg s" style={{ color: color(R, d.sub), borderColor: color(R, d.sub) }}>{d.sub}</span>}
    </>
  );
}

function clickProps(onClick, cls) {
  return onClick
    ? { className: cls + " click", role: "button", tabIndex: 0, onClick, onKeyDown: (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick()) }
    : { className: cls };
}

export function SourceCard({ R, d, cls = "", onClick, mini, foot, onRead }) {
  const fl = isFL(R, d);
  const b = fl ? null : R.bonuses[d.type];
  const e = fl ? R.falseLeads[d.type] : null;
  return (
    <div {...clickProps(onClick, "card " + cls + (mini ? " mini" : "") + (fl ? " fl" : ""))}>
      <div className="hd mono"><span>{fl ? "False Lead · " : ""}{d.type}</span><span>{d.date}</span></div>
      <Picture R={R} d={d} />
      <div className="bd">
        <div className="ti">{d.title}</div>
        {!mini && <div className="au">{d.author}</div>}
        <div className="era mono">{d.era}{d.stance ? " · " + d.stance : ""}</div>
        {b && <div className="bonus"><b>{b.name}.</b> {b.text}</div>}
        {fl && <div className="bonus flb"><b>On your bookshelf{e ? ": " + e.name : ""}.</b> {e ? e.text : "No effect."}</div>}
        <div className="tags">
          <span className="num" title="Chronological number">{d.num}</span>
          <Tags R={R} d={d} />
          <Power R={R} n={fl ? 0 : d.power ?? 1} />
          {onRead && <button className="read" onClick={(e) => { e.stopPropagation(); onRead(d); }}>Read</button>}
        </div>
        {foot}
      </div>
    </div>
  );
}

export function ActionCard({ R, id, cls = "", onClick }) {
  const d = R.actions[id];
  return (
    <div {...clickProps(onClick, "card act " + cls)}>
      <div className="hd mono"><span>Action</span><span>{d.value ? "Upgrade " + d.value : "Basic"}</span></div>
      <div className="bd"><div className="nm">{d.name}</div><div className="tx">{d.text}</div>
        {R.config.buying && <div className="tags" style={{ marginTop: "auto" }}><Power R={R} n={d.power ?? 0} /></div>}</div>
    </div>
  );
}

export function TrashCard({ R, ref_, cls = "", onClick }) {
  const d = R.trash[ref_];
  return (
    <div {...clickProps(onClick, "card trash " + cls)}>
      <div className="hd mono"><span>Trash</span><span>{R.config.trashPenalty ? "−" + R.config.trashPenalty + " at the end" : ""}</span></div>
      <div className="bd"><div className="nm">{d.name}</div><div className="tx">{d.text}</div></div>
    </div>
  );
}

/** Any card by id. */
export function Card({ G, R, uid, ...rest }) {
  const c = G.cards[uid];
  if (!c) return null;
  if (c.kind === "source") return <SourceCard R={R} d={R.cards[c.ref]} {...rest} />;
  if (c.kind === "trash") return <TrashCard R={R} ref_={c.ref} {...rest} />;
  return <ActionCard R={R} id={c.ref} {...rest} />;
}

export function Modal({ children, onClose }) {
  useEffect(() => {
    if (!onClose) return;
    const key = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="ov" onClick={onClose ? (e) => e.target === e.currentTarget && onClose() : undefined}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export function ReadCard({ R, d, onClose }) {
  const fl = isFL(R, d);
  const b = fl ? null : R.bonuses[d.type];
  const e = fl ? R.falseLeads[d.type] : null;
  const url = imageUrl(R, d);
  return (
    <Modal onClose={onClose}>
      {url && (
        <figure className="fullpic">
          <img src={url} alt={d.title} />
          {d.imageCredit && <figcaption>Image: {d.imageCredit}</figcaption>}
        </figure>
      )}
      <div className="mono" style={{ color: "var(--mute)" }}>{d.type} · {d.date}</div>
      <h3>{d.title}</h3>
      <div className="au" style={{ fontStyle: "italic" }}>{d.author}</div>
      {d.quote && <div className="q">{d.quote}</div>}
      <p>{d.content}</p>
      {b && <div className="bonus"><b>Passive bonus: {b.name}.</b> {b.text} Counts in your hand and on your bookshelf.</div>}
      {fl && (
        <div className="bonus flb">
          <b>False Lead.</b> Not evidence: it can only be published with other False Leads (an article of two from any eras, +{R.config.falseLead.articlePts};
          a book from any theses, +{R.config.falseLead.bookCardPts} per card), and it has no purchasing power.
          {e && <> <b>On your bookshelf: {e.name}.</b> {e.text}</>}
        </div>
      )}
      <div className="sig">{d.significance}</div>
      <div className="tags" style={{ marginTop: 12 }}>
        <span className="num">{d.num}</span><Tags R={R} d={d} /><Power R={R} n={fl ? 0 : d.power ?? 1} />
        <span className="mono">&nbsp;{d.era}{d.stance ? " · " + d.stance : ""}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        Thesis {d.arg}: {R.theses[d.arg].q}
        {d.sub && <><br /><span className="note">Also speaks to {d.sub}: {R.theses[d.sub].q}</span></>}
      </div>
      <div className="cit">{d.citation}</div>
      <div className="btns"><button onClick={onClose}>Close</button></div>
    </Modal>
  );
}
