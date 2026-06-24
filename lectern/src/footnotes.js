// src/footnotes.js
// Footnote markers live inline in the draft as stable tokens: [^fn_xxxxxxx].
// The source text for each marker is stored separately on draft.footnotes.
// Display numbers are computed positionally at render time, so adding, removing,
// or reordering markers re-numbers everything automatically.

const TOKEN = /\[\^(fn_[a-z0-9]+)\]/g;

export const newFootnoteId = () => "fn_" + Math.random().toString(36).slice(2, 9);

// Ids in order of first appearance in the text.
export function orderedIds(text) {
  const ids = [];
  const seen = new Set();
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text || ""))) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

// { id: displayNumber } based on order of appearance.
export function numberMap(text) {
  const map = {};
  orderedIds(text).forEach((id, i) => { map[id] = i + 1; });
  return map;
}

// Insert a marker immediately after the first occurrence of `anchor`.
// Returns the new text, or null if the anchor can't be found.
export function insertAfterAnchor(text, anchor, id) {
  if (!anchor) return null;
  const idx = (text || "").indexOf(anchor);
  if (idx === -1) return null;
  const at = idx + anchor.length;
  return text.slice(0, at) + `[^${id}]` + text.slice(at);
}

// Insert a marker at a character position (used for "insert at cursor").
export function insertAt(text, pos, id) {
  const t = text || "";
  const p = Math.max(0, Math.min(pos ?? t.length, t.length));
  return t.slice(0, p) + `[^${id}]` + t.slice(p);
}

export function removeMarker(text, id) {
  return (text || "").replace(`[^${id}]`, "");
}

// Ensure every marker token in the text has a footnote record, preserving
// existing records (including "orphans" whose marker was deleted).
export function reconcile(text, existing) {
  const map = new Map((existing || []).map((f) => [f.id, f]));
  for (const id of orderedIds(text)) {
    if (!map.has(id)) map.set(id, { id, source: "", claim: "" });
  }
  return [...map.values()];
}
