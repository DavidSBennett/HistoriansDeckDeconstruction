// Card faces, ported from the mock-up's srcHTML / actHTML / trashHTML. `G` is the view (its cards lookup
// says what each card id is), `R` the game's rules.

export const color = (R, L) => R.theses[L]?.color || "#555";

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
  const b = R.bonuses[d.type];
  return (
    <div {...clickProps(onClick, "card " + cls + (mini ? " mini" : ""))}>
      <div className="hd mono"><span>{d.type}</span><span>{d.date}</span></div>
      <div className="bd">
        <div className="ti">{d.title}</div>
        {!mini && <div className="au">{d.author}</div>}
        <div className="era mono">{d.era}{d.stance ? " · " + d.stance : ""}</div>
        {b && <div className="bonus"><b>{b.name}.</b> {b.text}</div>}
        <div className="tags">
          <span className="num" title="Chronological number">{d.num}</span>
          <Tags R={R} d={d} />
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
      <div className="bd"><div className="nm">{d.name}</div><div className="tx">{d.text}</div></div>
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
  return (
    <div className="ov" onClick={onClose ? (e) => e.target === e.currentTarget && onClose() : undefined}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

export function ReadCard({ R, d, onClose }) {
  const b = R.bonuses[d.type];
  return (
    <Modal onClose={onClose}>
      <div className="mono" style={{ color: "var(--mute)" }}>{d.type} · {d.date}</div>
      <h3>{d.title}</h3>
      <div className="au" style={{ fontStyle: "italic" }}>{d.author}</div>
      {d.quote && <div className="q">{d.quote}</div>}
      <p>{d.content}</p>
      {b && <div className="bonus"><b>Passive bonus: {b.name}.</b> {b.text} Counts in your hand and on your bookshelf.</div>}
      <div className="sig">{d.significance}</div>
      <div className="tags" style={{ marginTop: 12 }}>
        <span className="num">{d.num}</span><Tags R={R} d={d} />
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
