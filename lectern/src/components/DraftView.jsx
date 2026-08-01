import { Fragment, useState } from "react";
import { numberMap, orderedIds } from "../footnotes.js";

// Split a line into text, [GAP: ...] spans, and [^fn_...] footnote markers.
function inline(text, keyBase, nums, onGapClick) {
  const parts = text.split(/(\[GAP:[^\]]*\]|\[\^fn_[a-z0-9]+\])/g);
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    if (p.startsWith("[GAP:")) return (
      <span
        className={onGapClick ? "gap gap-clickable" : "gap"}
        key={key}
        onClick={onGapClick ? () => onGapClick(p) : undefined}
        title={onGapClick ? "Talk this through with the coach" : undefined}
        role={onGapClick ? "button" : undefined}
        tabIndex={onGapClick ? 0 : undefined}
        onKeyDown={onGapClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGapClick(p); } } : undefined}
      >{p}</span>
    );
    const fm = p.match(/^\[\^(fn_[a-z0-9]+)\]$/);
    if (fm) {
      const n = nums[fm[1]];
      return n ? <sup className="fn-ref" key={key}>{n}</sup> : null;
    }
    return <Fragment key={key}>{p}</Fragment>;
  });
}

// Normalize text for locating an anchor quote inside a paragraph, tolerant of
// smart quotes, dashes, punctuation, and markdown emphasis.
function norm(s) {
  return String(s || "")
    .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/[*_`#>()"'.,;:!?\u2014\u2013-]/g, " ")
    .replace(/\s+/g, " ").trim();
}

export default function DraftView({ text, footnotes, notes, onGapClick, onDiscussNote, onResearchNote, onResolveNote }) {
  const [showResolved, setShowResolved] = useState(false);
  if (!text) return null;
  const nums = numberMap(text);
  const blocks = text.split(/\n{2,}/);

  // Normalize notes; separate resolved (like a resolved Google Docs comment).
  const allNotes = (notes || [])
    .map((n) => (typeof n === "string" ? { anchor: "", note: n, resolved: false } : { anchor: n.anchor || "", note: n.note || n.text || "", resolved: !!n.resolved }))
    .filter((n) => n.note);
  const activeNotes = allNotes.filter((n) => !n.resolved);
  const resolvedNotes = allNotes.filter((n) => n.resolved);

  // Assign each active note to the first block that contains its anchor quote.
  const blockNorms = blocks.map((b) => norm(b));
  const assigned = {};
  const general = [];
  for (const n of activeNotes) {
    const a = norm(n.anchor);
    let bi = -1;
    if (a) {
      bi = blockNorms.findIndex((nb) => nb.includes(a));
      if (bi === -1) {
        const short = a.split(" ").slice(0, 6).join(" ");
        if (short.length > 12) bi = blockNorms.findIndex((nb) => nb.includes(short));
      }
    }
    if (bi === -1) general.push(n);
    else (assigned[bi] = assigned[bi] || []).push(n);
  }

  const byId = Object.fromEntries((footnotes || []).map((f) => [f.id, f]));
  const placed = orderedIds(text).map((id) => ({ n: nums[id], ...(byId[id] || { id }) }));
  const orphans = (footnotes || []).filter((f) => !(f.id in nums));

  function Callout({ n }) {
    return (
      <div className="inline-note">
        <p className="inline-note-text">{n.note}</p>
        <div className="note-actions">
          {onDiscussNote && <button className="note-discuss" onClick={() => onDiscussNote(n.note)}>Discuss with the coach →</button>}
          {onResearchNote && <button className="note-discuss" onClick={() => onResearchNote(n.note)}>Find sources →</button>}
          {onResolveNote && <button className="note-discuss note-resolve" onClick={() => onResolveNote(n, true)}>✓ Resolve</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="draft-read">
      {general.length > 0 && (
        <div className="inline-note-group">
          <div className="inline-note-label">On the chapter as a whole</div>
          {general.map((n, k) => <Callout key={k} n={n} />)}
        </div>
      )}

      {blocks.map((block, i) => {
        const b = block.trim();
        const el = b.startsWith("### ") ? <h3>{inline(b.slice(4), i, nums, onGapClick)}</h3>
          : b.startsWith("## ") ? <h2>{inline(b.slice(3), i, nums, onGapClick)}</h2>
          : b.startsWith("# ") ? <h1>{inline(b.slice(2), i, nums, onGapClick)}</h1>
          : <p>{inline(b, i, nums, onGapClick)}</p>;
        return (
          <Fragment key={i}>
            {el}
            {(assigned[i] || []).map((n, k) => <Callout key={`n-${i}-${k}`} n={n} />)}
          </Fragment>
        );
      })}

      {resolvedNotes.length > 0 && (
        <div className="resolved-notes">
          <button className="btn-ghost" style={{ padding: 0, fontWeight: 600 }} onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? "▾" : "▸"} Resolved notes ({resolvedNotes.length})
          </button>
          {showResolved && resolvedNotes.map((n, k) => (
            <div className="inline-note resolved" key={k}>
              <p className="inline-note-text">{n.note}</p>
              {onResolveNote && (
                <div className="note-actions">
                  <button className="note-discuss" onClick={() => onResolveNote(n, false)}>Reopen</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(placed.length > 0 || orphans.length > 0) && (
        <div className="notes">
          <h3>Notes</h3>
          {placed.map((f) => (
            <div className="note-row" key={f.id}>
              <sup className="fn-ref">{f.n}</sup>
              <span>{f.source ? f.source : <em className="muted">source not added yet</em>}</span>
            </div>
          ))}
          {orphans.map((f) => (
            <div className="note-row" key={f.id}>
              <span className="muted" style={{ fontStyle: "italic" }}>unplaced —</span>
              <span>{f.source ? f.source : <em className="muted">source not added yet</em>}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
