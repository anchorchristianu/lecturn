import { useState } from "react";
import { ai } from "../api.js";

// Web research for credible, citable sources. The author triggers the search
// explicitly (it costs per search on their key), reviews what comes back, and
// chooses which sources to pull into the citation engine. Nothing is added or
// searched automatically.
export default function ResearchPanel({ query, brief, chapterTitle, onAddSource, onClose, working }) {
  const [q, setQ] = useState(query || "");
  const [running, setRunning] = useState(false);
  const [sources, setSources] = useState(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [added, setAdded] = useState({});   // index -> true once added

  async function runSearch() {
    if (!q.trim() || running) return;
    setRunning(true); setErr(""); setSources(null); setNote(""); setAdded({});
    try {
      const r = await ai("research", { topic: q, brief, chapterTitle });
      setSources(Array.isArray(r.sources) ? r.sources : []);
      setNote(r.note || "");
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setRunning(false);
    }
  }

  async function add(src, i) {
    await onAddSource(src);
    setAdded((a) => ({ ...a, [i]: true }));
  }

  return (
    <div className="scrim" onClick={() => !running && !working && onClose()}>
      <div className="modal stack research-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Research the web for sources</h2>
          <span className="spacer" />
          <button className="btn-ghost" onClick={onClose} disabled={running}>Close</button>
        </div>
        <span className="hint">
          Claude searches the open web for credible sources to support this point, then you choose which to add as citations. It reads real search results — but always verify a source before you rely on it.
        </span>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>What do you need to support?</label>
          <textarea className="textarea" value={q} onChange={(e) => setQ(e.target.value)} style={{ minHeight: 70 }} disabled={running} />
        </div>

        <div className="row">
          <button className="btn btn-primary" onClick={runSearch} disabled={running || !q.trim()}>
            {running ? <span className="working"><span className="spinner" /> Searching the web…</span> : sources ? "Search again" : "Search the web"}
          </button>
          <span className="hint" style={{ display: "inline" }}>Runs live web searches (billed to your API key).</span>
        </div>

        {err && <p className="summary" style={{ color: "var(--danger)" }}>{err}</p>}

        {sources && (
          <div className="stack" style={{ gap: "0.75rem" }}>
            {note && <p className="hint" style={{ margin: 0 }}>{note}</p>}
            {sources.length === 0 && <p className="muted" style={{ margin: 0 }}>No solid sources came back. Try rephrasing the point, or narrowing it.</p>}
            {sources.map((s, i) => (
              <div key={i} className="research-source">
                <div className="rs-head">
                  <div style={{ flex: 1 }}>
                    <div className="rs-title">{s.title || "Untitled source"}</div>
                    <div className="rs-meta">{[s.author, s.publisher, s.date].filter(Boolean).join(" · ")}</div>
                  </div>
                  {added[i]
                    ? <span className="status ready">added ✓</span>
                    : <button className="btn btn-secondary" onClick={() => add(s, i)} disabled={working}>Add as citation</button>}
                </div>
                {s.supports && <p className="rs-line"><b>Supports:</b> {s.supports}</p>}
                {s.credibility && <p className="rs-line"><b>Why trust it:</b> {s.credibility}</p>}
                {s.citation && <p className="rs-cite">{s.citation}</p>}
                {s.url && <a className="rs-url" href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
