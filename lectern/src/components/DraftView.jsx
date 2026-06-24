import { Fragment } from "react";
import { numberMap, orderedIds } from "../footnotes.js";

// Split a line into text, [GAP: ...] spans, and [^fn_...] footnote markers.
function inline(text, keyBase, nums) {
  const parts = text.split(/(\[GAP:[^\]]*\]|\[\^fn_[a-z0-9]+\])/g);
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    if (p.startsWith("[GAP:")) return <span className="gap" key={key}>{p}</span>;
    const fm = p.match(/^\[\^(fn_[a-z0-9]+)\]$/);
    if (fm) {
      const n = nums[fm[1]];
      return n ? <sup className="fn-ref" key={key}>{n}</sup> : null;
    }
    return <Fragment key={key}>{p}</Fragment>;
  });
}

export default function DraftView({ text, footnotes }) {
  if (!text) return null;
  const nums = numberMap(text);
  const blocks = text.split(/\n{2,}/);

  // Notes in display order: placed markers first (by number), then any unplaced.
  const byId = Object.fromEntries((footnotes || []).map((f) => [f.id, f]));
  const placed = orderedIds(text).map((id) => ({ n: nums[id], ...(byId[id] || { id }) }));
  const orphans = (footnotes || []).filter((f) => !(f.id in nums));

  return (
    <div className="draft-read">
      {blocks.map((block, i) => {
        const b = block.trim();
        if (b.startsWith("### ")) return <h3 key={i}>{inline(b.slice(4), i, nums)}</h3>;
        if (b.startsWith("## ")) return <h2 key={i}>{inline(b.slice(3), i, nums)}</h2>;
        if (b.startsWith("# ")) return <h1 key={i}>{inline(b.slice(2), i, nums)}</h1>;
        return <p key={i}>{inline(b, i, nums)}</p>;
      })}

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
