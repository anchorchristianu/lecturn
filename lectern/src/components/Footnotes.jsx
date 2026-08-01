// src/components/Footnotes.jsx — manage a chapter's footnote sources.
import { useState } from "react";
import Spin from "./Spin.jsx";

function NoteRow({ note, label, working, onUpdate, onRemove, onFormat }) {
  const [val, setVal] = useState(note.source || "");
  const [busy, setBusy] = useState(false);
  const dirty = val !== (note.source || "");

  async function format() {
    if (!val.trim()) return;
    setBusy(true);
    try {
      const formatted = await onFormat(val);
      if (formatted) setVal(formatted);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "0.7rem 0.85rem" }}>
      <div className="row" style={{ marginBottom: "0.4rem" }}>
        <span className="status">{label}</span>
        {note.claim && <span className="muted" style={{ fontSize: "0.8rem" }}>on: "{note.claim.slice(0, 60)}{note.claim.length > 60 ? "…" : ""}"</span>}
        <span className="spacer" />
        <button className="btn btn-ghost" style={{ padding: "0.2rem 0.6rem", fontSize: "0.82rem" }} onClick={() => onRemove(note.id)} disabled={working}>Remove</button>
      </div>
      <textarea
        className="textarea"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="Paste or type the source — book, author, page, URL…"
        style={{ minHeight: 64 }}
        disabled={working || busy}
      />
      <div className="row" style={{ marginTop: "0.45rem" }}>
        <button className="btn btn-secondary" style={{ padding: "0.25rem 0.8rem", fontSize: "0.85rem" }} onClick={format} disabled={working || busy || !val.trim()}>
          {busy ? <Spin>Formatting…</Spin> : "Format in Chicago"}
        </button>
        <button className="btn btn-primary" style={{ padding: "0.25rem 0.8rem", fontSize: "0.85rem" }} onClick={() => onUpdate(note.id, val)} disabled={working || busy || !dirty}>
          Save source
        </button>
      </div>
    </div>
  );
}

export default function Footnotes({ footnotes, nums, working, onUpdate, onRemove, onFormat }) {
  if (!footnotes || footnotes.length === 0) return null;
  return (
    <div className="card stack">
      <div>
        <h3 style={{ margin: "0 0 0.2rem" }}>Notes &amp; sources ({footnotes.length})</h3>
        <span className="hint">Each note follows a marker in the text. Add the source, optionally clean it into Chicago style, and it appears in the chapter's Notes.</span>
      </div>
      {footnotes.map((f) => (
        <NoteRow
          key={f.id}
          note={f}
          label={nums[f.id] ? `Note ${nums[f.id]}` : "Unplaced"}
          working={working}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onFormat={onFormat}
        />
      ))}
    </div>
  );
}
