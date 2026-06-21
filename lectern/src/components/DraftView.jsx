import { Fragment } from "react";

// Split a line into text + highlighted [GAP: ...] spans.
function inline(text, keyBase) {
  const parts = text.split(/(\[GAP:[^\]]*\])/g);
  return parts.map((p, i) =>
    p.startsWith("[GAP:") ? (
      <span className="gap" key={`${keyBase}-${i}`}>{p}</span>
    ) : (
      <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>
    )
  );
}

export default function DraftView({ text }) {
  if (!text) return null;
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="draft-read">
      {blocks.map((block, i) => {
        const b = block.trim();
        if (b.startsWith("### ")) return <h3 key={i}>{inline(b.slice(4), i)}</h3>;
        if (b.startsWith("## ")) return <h2 key={i}>{inline(b.slice(3), i)}</h2>;
        if (b.startsWith("# ")) return <h1 key={i}>{inline(b.slice(2), i)}</h1>;
        return <p key={i}>{inline(b, i)}</p>;
      })}
    </div>
  );
}
