// src/components/EditPass.jsx
// Reviews a leveled editing pass (line / copy / proof) as discrete, approvable
// suggestions. The author accepts or rejects each one; only accepted changes are
// applied to the draft. Flags (things to verify) are shown but never auto-applied.
import { useState } from "react";
import Spin from "./Spin.jsx";

const LABELS = {
  line: { title: "Line edit", note: "Style, rhythm, and word choice — in your voice. Suggestions only; nothing changes until you apply it." },
  copy: { title: "Copy edit", note: "Grammar, punctuation, spelling, and consistency. Mechanical fixes only." },
  proof: { title: "Proofread", note: "Final surface pass — typos, spacing, and punctuation only." },
  factcheck: { title: "Fact-check", note: "Every checkable claim — quotes, names, numbers, dates, scripture references — gathered for you to verify. Nothing is changed; these are yours to confirm against the source." },
};

export default function EditPass({ pass, working, onApply, onClose }) {
  const meta = LABELS[pass.level] || LABELS.line;
  const suggestions = pass.suggestions || [];
  const flags = pass.flags || [];
  const isFactcheck = pass.level === "factcheck";
  const [decisions, setDecisions] = useState(() => suggestions.map(() => "pending"));

  const set = (i, v) => setDecisions((d) => d.map((x, j) => (j === i ? (x === v ? "pending" : v) : x)));
  const all = (v) => setDecisions(suggestions.map(() => v));
  const acceptedCount = decisions.filter((d) => d === "accept").length;

  const apply = () => onApply(suggestions.filter((_, i) => decisions[i] === "accept"));

  // Fact-check is a verification checklist, not editable changes.
  if (isFactcheck) {
    return (
      <div className="card stack" style={{ borderColor: "var(--brass)" }}>
        <div className="row">
          <h3 style={{ margin: 0 }}>{meta.title}</h3>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose} disabled={working}>Close</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>{meta.note}</p>
        {pass.summary && <p style={{ margin: 0 }}>{pass.summary}</p>}
        {flags.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nothing jumped out — but always double-check quotes, names, and numbers against your sources yourself.</p>
        ) : (
          <ul className="note-list" style={{ marginTop: 0 }}>
            {flags.map((f, i) => (
              <li key={i} style={{ marginBottom: "0.6rem" }}>
                {f.category && <span className="status" style={{ marginRight: "0.45rem" }}>{f.category}</span>}
                <span style={{ color: "var(--brass)", fontWeight: 600 }}>{f.text}</span>
                {f.concern ? <span className="muted"> — {f.concern}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="card stack" style={{ borderColor: "var(--pine)" }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{meta.title}</h3>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onClose} disabled={working}>Close</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: "0.85rem" }}>{meta.note}</p>
      {pass.summary && <p style={{ margin: 0 }}>{pass.summary}</p>}

      {suggestions.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No changes suggested at this level — this chapter reads clean here.</p>
      ) : (
        <>
          <div className="row">
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"} · {acceptedCount} accepted
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={() => all("accept")} disabled={working}>Accept all</button>
            <button className="btn btn-ghost" onClick={() => all("reject")} disabled={working}>Reject all</button>
          </div>

          <div className="stack" style={{ gap: "0.7rem" }}>
            {suggestions.map((s, i) => {
              const d = decisions[i];
              return (
                <div
                  key={i}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    padding: "0.7rem 0.85rem",
                    opacity: d === "reject" ? 0.5 : 1,
                    background: d === "accept" ? "rgba(47,90,69,0.05)" : "transparent",
                  }}
                >
                  {s.category && (
                    <span className="status" style={{ marginBottom: "0.4rem", display: "inline-block" }}>{s.category}</span>
                  )}
                  <div style={{ fontSize: "0.97rem", lineHeight: 1.5 }}>
                    <div style={{ textDecoration: "line-through", color: "var(--muted)" }}>{s.original}</div>
                    <div style={{ color: "var(--pine)", fontWeight: 600 }}>{s.replacement}</div>
                  </div>
                  {s.why && <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.83rem" }}>{s.why}</p>}
                  <div className="row" style={{ marginTop: "0.5rem", gap: "0.4rem" }}>
                    <button
                      className={d === "accept" ? "btn btn-primary" : "btn btn-secondary"}
                      style={{ padding: "0.25rem 0.8rem", fontSize: "0.85rem" }}
                      onClick={() => set(i, "accept")}
                      disabled={working}
                    >
                      {d === "accept" ? "✓ Accepted" : "Accept"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "0.25rem 0.8rem", fontSize: "0.85rem" }}
                      onClick={() => set(i, "reject")}
                      disabled={working}
                    >
                      {d === "reject" ? "✕ Rejected" : "Reject"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="row">
            <button className="btn btn-primary" onClick={apply} disabled={working || acceptedCount === 0}>
              {working ? <Spin>Applying…</Spin> : `Apply ${acceptedCount} change${acceptedCount === 1 ? "" : "s"}`}
            </button>
            <span className="muted" style={{ fontSize: "0.82rem" }}>Rejected and undecided suggestions are discarded.</span>
          </div>
        </>
      )}

      {flags.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: "0.8rem" }}>
          <h3 style={{ margin: "0 0 0.5rem" }}>To verify — not changed</h3>
          <ul className="note-list">
            {flags.map((f, i) => (
              <li key={i}>
                <span style={{ color: "var(--brass)", fontWeight: 600 }}>{f.text}</span>
                {f.concern ? ` — ${f.concern}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
