// src/components/StyleSheet.jsx — the project's consistency record.
// Edits are local until "Save style sheet"; Build runs an AI scan via the parent.
import { useState, useEffect } from "react";
import Spin from "./Spin.jsx";

const CATS = ["term", "spelling", "capitalization", "hyphenation", "name", "numbers", "framework"];
const sid = () => "se_" + Math.random().toString(36).slice(2, 9);
const inp = { padding: "0.4rem 0.6rem", border: "1px solid var(--line-strong)", borderRadius: 8, font: "inherit", background: "var(--surface)" };

function EntryRow({ entry, working, onChange, onRemove }) {
  return (
    <div className="row" style={{ gap: "0.5rem", alignItems: "flex-start", marginBottom: "0.5rem", flexWrap: "wrap" }}>
      <input value={entry.term} onChange={(e) => onChange({ ...entry, term: e.target.value })} placeholder="Term" disabled={working} style={{ ...inp, flex: "1 1 140px", minWidth: 120 }} />
      <input value={entry.ruling} onChange={(e) => onChange({ ...entry, ruling: e.target.value })} placeholder="Ruling — e.g. one word, lowercase" disabled={working} style={{ ...inp, flex: "3 1 240px", minWidth: 180 }} />
      <select value={entry.category || "term"} onChange={(e) => onChange({ ...entry, category: e.target.value })} disabled={working} style={{ ...inp, flex: "0 0 auto" }}>
        {CATS.map((c) => <option key={c}>{c}</option>)}
      </select>
      <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.82rem" }} onClick={() => onRemove(entry.id)} disabled={working}>Remove</button>
    </div>
  );
}

export default function StyleSheet({ sheet, working, building, onBuild, onSave, hasDrafts }) {
  const [entries, setEntries] = useState(sheet?.entries || []);
  const [notes, setNotes] = useState(sheet?.notes || "");
  const [dirty, setDirty] = useState(false);

  // Re-sync local state whenever the persisted sheet changes (build / save reload).
  useEffect(() => {
    setEntries(sheet?.entries || []);
    setNotes(sheet?.notes || "");
    setDirty(false);
  }, [sheet?.updatedAt]);

  const inconsistencies = sheet?.inconsistencies || [];
  const change = (next) => { setEntries(next); setDirty(true); };
  const addEntry = () => change([...entries, { id: sid(), term: "", ruling: "", category: "term" }]);
  const adopt = (inc) => change([...entries, { id: sid(), term: inc.term || "", ruling: inc.suggestion || "", category: "term" }]);
  const save = () => onSave({ ...(sheet || {}), entries, notes });

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <div>
            <h3 style={{ margin: "0 0 0.2rem" }}>Style sheet</h3>
            <span className="hint">The book's consistency record — preferred spellings, capitalization, names, and framework terms. The copy-edit pass enforces these.</span>
          </div>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onBuild} disabled={working || !hasDrafts || dirty}>
            {building ? <Spin>Reading…</Spin> : entries.length ? "Update from manuscript" : "Build from manuscript"}
          </button>
        </div>
        {!hasDrafts && <span className="muted" style={{ fontSize: "0.85rem" }}>Draft a chapter or two first — the style sheet is built by scanning the manuscript.</span>}
        {dirty && <span className="muted" style={{ fontSize: "0.85rem" }}>You have unsaved changes — save them before rebuilding.</span>}
        {sheet?.summary && <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>{sheet.summary}</p>}
      </div>

      {inconsistencies.length > 0 && (
        <div className="card stack" style={{ borderColor: "var(--brass)" }}>
          <h3 style={{ margin: 0 }}>Inconsistencies found ({inconsistencies.length})</h3>
          <span className="hint">The same term used more than one way. Adopt a ruling to add it below, then save — copy-editing will standardize it.</span>
          {inconsistencies.map((inc, i) => (
            <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : "none", paddingTop: i ? "0.7rem" : 0 }}>
              <div style={{ fontWeight: 600 }}>{inc.term}</div>
              {inc.variants?.length > 0 && (
                <div className="muted" style={{ fontSize: "0.88rem", margin: "0.15rem 0" }}>
                  seen as: {inc.variants.map((v, j) => <span key={j}><span style={{ color: "var(--ink)" }}>{v}</span>{j < inc.variants.length - 1 ? " · " : ""}</span>)}
                </div>
              )}
              {inc.suggestion && <div style={{ fontSize: "0.92rem" }}><span style={{ color: "var(--pine)", fontWeight: 600 }}>Standardize:</span> {inc.suggestion}</div>}
              <button className="btn btn-secondary" style={{ padding: "0.25rem 0.7rem", fontSize: "0.82rem", marginTop: "0.4rem" }} onClick={() => adopt(inc)} disabled={working}>Adopt as a rule</button>
            </div>
          ))}
        </div>
      )}

      <div className="card stack">
        <div className="row">
          <h3 style={{ margin: 0 }}>Rules ({entries.length})</h3>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={addEntry} disabled={working}>+ Add rule</button>
        </div>
        {entries.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No rules yet. Build from the manuscript, or add your own.</p>
        ) : (
          <div>
            {entries.map((e) => (
              <EntryRow key={e.id} entry={e} working={working}
                onChange={(next) => change(entries.map((x) => (x.id === next.id ? next : x)))}
                onRemove={(id) => change(entries.filter((x) => x.id !== id))} />
            ))}
          </div>
        )}
      </div>

      <div className="card stack">
        <div>
          <h3 style={{ margin: "0 0 0.2rem" }}>General conventions</h3>
          <span className="hint">Free notes the editor should follow — e.g. "Chicago style, serial comma, spell out numbers under 100, italicize book titles."</span>
        </div>
        <textarea className="textarea" value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} style={{ minHeight: 90 }} disabled={working} />
      </div>

      <div className="row">
        <button className="btn btn-primary" onClick={save} disabled={working || !dirty}>
          {working && building === false && dirty ? <Spin>Saving…</Spin> : "Save style sheet"}
        </button>
        {dirty && <span className="muted" style={{ fontSize: "0.85rem" }}>Unsaved changes</span>}
      </div>
    </div>
  );
}
