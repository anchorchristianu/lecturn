// src/stages.js
export const STAGES = ["Captured", "Sorted", "Shaped", "Drafted", "Polished"];

// Returns { reached: boolean[], current: index }
export function deriveStages(project, sources = [], drafts = []) {
  const reached = [
    sources.length > 0,
    sources.some((s) => s.summary),
    (project?.outline || []).length > 0,
    drafts.length > 0,
    drafts.some((d) => d.polished),
  ];
  let current = reached.lastIndexOf(true) + 1;
  if (current > STAGES.length - 1) current = STAGES.length - 1;
  return { reached, current };
}
