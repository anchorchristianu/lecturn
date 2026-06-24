// src/metrics.js — deterministic counts for the UI. No model calls.
export const countWords = (text) =>
  (text || "").replace(/\[GAP:[^\]]*\]/g, "").trim().split(/\s+/).filter(Boolean).length;
export const countGaps = (text) => (text?.match(/\[GAP:/g) || []).length;
export const readingTime = (words) => Math.max(1, Math.round(words / 200));
export const fmt = (n) => (n || 0).toLocaleString();
