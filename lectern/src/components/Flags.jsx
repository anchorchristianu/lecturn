// src/components/Flags.jsx — persistent "claims to verify" list for a chapter.
// Flags live on the draft with a status (open / sourced / dismissed) so they
// survive navigation and don't need re-running.
import { useState } from "react";
import Spin from "./Spin.jsx";

const SM = { padding: "0.22rem 0.7rem", fontSize: "0.83rem" };

function FlagRow({ flag, working, onAddSource, onDismiss, onFormat }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  async function format() {
    if (!val.trim()) return;
    setBusy(true);
    try { const f = await onFormat(val); if (f) setVal(f); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try { await onAddSource(flag, val); } finally { setBusy(false); }
  }

  return (
    <li style={{ marginBottom: "0.75rem" }}>
      {flag.category && <span className="status" style={{ marginRight: "0.45rem" }}>{flag.category}</span>}
      <span style={{ color: "var(--brass)", fontWeight: 600 }}>{flag.text}</span>
      {flag.concern ? <span className="muted"> — {flag.concern}</span> : null}
      <div className="row" style={{ marginTop: "0.35rem" }}>
        <button className="btn btn-secondary" style={SM} onClick={() => setOpen((o) => !o)} disabled={working}>
          {open ? "Cancel" : "Add source"}
        </button>
        <button className="btn btn-ghost" style={SM} onClick={() => onDismiss(flag.id)} disabled={working}>Dismiss</button>
      </div>
      {open && (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <textarea
            className="textarea"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="Paste or type the source — book, author, page, URL…"
            style={{ minHeight: 60 }}
            disabled={busy}
          />
          <div className="row">
            <button className="btn btn-secondary" style={SM} onClick={format} disabled={busy || !val.trim()}>
              {busy ? <Spin>Working…</Spin> : "Format in Chicago"}
            </button>
            <button className="btn btn-primary" style={SM} onClick={save} disabled={busy || !val.trim()}>
              Save as footnote
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function Flags({ flags, summary, working, checking, onAddSource, onDismiss, onRestore, onFormat, onRecheck }) {
  const [showResolved, setShowResolved] = useState(false);
  const list = flags || [];
  const open = list.filter((f) => f.status === "open");
  const resolved = list.filter((f) => f.status !== "open");

  return (
    <div className="card stack" style={{ borderColor: "var(--brass)" }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>Claims to verify ({open.length})</h3>
        <span className="spacer" />
        <button className="btn btn-ghost" style={SM} onClick={onRecheck} disabled={working}>
          {checking ? <Spin>Checking…</Spin> : "Re-check"}
        </button>
      </div>
      {summary && <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>{summary}</p>}

      {open.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          {list.length === 0
            ? "No claims flagged yet."
            : "All flagged claims are resolved. Always double-check quotes, names, and numbers against your sources yourself."}
        </p>
      ) : (
        <ul className="note-list" style={{ marginTop: 0 }}>
          {open.map((f) => (
            <FlagRow key={f.id} flag={f} working={working} onAddSource={onAddSource} onDismiss={onDismiss} onFormat={onFormat} />
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: "0.6rem" }}>
          <button className="btn btn-ghost" style={SM} onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? "Hide" : "Show"} {resolved.length} resolved
          </button>
          {showResolved && (
            <ul className="note-list" style={{ marginTop: "0.5rem" }}>
              {resolved.map((f) => (
                <li key={f.id} style={{ marginBottom: "0.35rem" }}>
                  <span className="muted" style={{ textDecoration: "line-through" }}>{f.text}</span>{" "}
                  <span className="status">{f.status === "sourced" ? "cited" : "dismissed"}</span>{" "}
                  <button className="btn btn-ghost" style={{ padding: "0.1rem 0.5rem", fontSize: "0.78rem" }} onClick={() => onRestore(f.id)} disabled={working}>reopen</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
