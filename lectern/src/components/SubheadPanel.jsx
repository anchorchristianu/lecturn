// Review and insert AI-suggested subheadings. Each drops in just before the
// section it names; nothing is applied until the author clicks.
export default function SubheadPanel({ subheads, working, onInsert, onInsertAll, onClose }) {
  return (
    <div className="scrim" onClick={() => !working && onClose()}>
      <div className="modal stack" style={{ maxWidth: 580 }} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Suggested subheadings</h2>
          <span className="spacer" />
          <button className="btn-ghost" onClick={onClose} disabled={working}>Close</button>
        </div>
        <span className="hint">
          These break the chapter into readable sections. Each is inserted just before the section it names — you can edit, move, or delete any of them afterward in <b>Edit directly</b>.
        </span>

        {subheads.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No subheadings suggested — the chapter may already be well-sectioned, or short enough not to need them.</p>
        ) : (
          <>
            <div className="stack" style={{ gap: "0.5rem" }}>
              {subheads.map((s, i) => (
                <div key={i} className="subhead-row">
                  <div style={{ flex: 1 }}>
                    <div className="subhead-h">## {s.heading}</div>
                    {s.anchor && <div className="subhead-anchor">before: "{s.anchor.slice(0, 64)}{s.anchor.length > 64 ? "…" : ""}"</div>}
                  </div>
                  <button className="btn btn-secondary" style={{ whiteSpace: "nowrap" }} onClick={() => onInsert(s)} disabled={working}>Insert</button>
                </div>
              ))}
            </div>
            <div className="row">
              <button className="btn btn-primary" onClick={onInsertAll} disabled={working}>Insert all {subheads.length}</button>
              <span className="spacer" />
              <button className="btn btn-ghost" onClick={onClose} disabled={working}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
