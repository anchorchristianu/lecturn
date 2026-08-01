// netlify/functions/lib/clean.js
// Deterministic, zero-token text processing. This is the work that does NOT
// need a language model: stripping caption artifacts, collapsing whitespace,
// light typographic tidying, hashing, and counting.

import { createHash } from "node:crypto";

// Conservative filler tokens safe to drop on their own (not inside words).
const FILLER = /\b(?:um+|uh+|erm+|uhh+|mm+hmm)\b[,]?/gi;

// Caption / transcript junk.
const ARTIFACTS = [
  /\[\s*(?:music|applause|laughter|inaudible|crosstalk|silence|noise)\s*\]/gi,
  /\[\s*_+\s*\]/g, // [ __ ] censored markers
  /^\s*>>+\s*/gm, // ">>" speaker markers at line start
  /^\s*\d+\s*$/gm, // bare SRT index lines
  /\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?/g, // VTT/SRT ranges
  /^\s*\(?\d{1,2}:\d{2}(?::\d{2})?\)?\s*/gm, // leading timestamps like 0:12 / (1:23:45)
];

export function cleanTranscript(text) {
  if (!text) return "";
  let t = text.replace(/\r\n?/g, "\n");
  for (const re of ARTIFACTS) t = t.replace(re, "");
  t = t.replace(FILLER, "");
  t = t.replace(/\b(\w+)\s+\1\b/gi, "$1"); // immediate repeated word: "the the"
  t = t.replace(/[ \t]+/g, " "); // collapse spaces/tabs
  t = t.replace(/ ?([,.;:!?]) ?/g, "$1 "); // tidy space around punctuation
  t = t.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n"); // trim line ends, cap blank lines
  return t.trim();
}

// Light typographic pass for finished prose — the "free polish".
export function tidyDraft(text) {
  if (!text) return "";
  let t = text.replace(/\r\n?/g, "\n");
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  t = t.replace(/[ \t]{2,}/g, " ");
  t = t.replace(/--/g, "—").replace(/\.\.\./g, "…");
  return t.trim();
}

export const hashText = (text) => createHash("sha1").update(text || "").digest("hex");

// ---- metrics (also mirrored on the client in src/metrics.js) ----
export const countWords = (text) =>
  (text || "").replace(/\[GAP:[^\]]*\]/g, "").trim().split(/\s+/).filter(Boolean).length;
export const countGaps = (text) => (text?.match(/\[GAP:/g) || []).length;
