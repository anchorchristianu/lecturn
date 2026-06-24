// src/compile.js
// Stitches a project's chapters into a single manuscript: a Word .docx with
// real, native footnotes (numbered across the whole book), or a Markdown file
// with standard footnote definitions. The docx library is imported lazily so it
// only loads when the author actually compiles.
import { orderedIds } from "./footnotes.js";

const GAP = /\[GAP:[^\]]*\]/g;
const TOKEN = /(\[GAP:[^\]]*\]|\[\^fn_[a-z0-9]+\])/g;
const EMPH = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g;

export function safeName(title) {
  return (title || "manuscript").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "manuscript";
}

function chaptersOf(project, drafts) {
  const byChapter = Object.fromEntries((drafts || []).map((d) => [d.chapter, d]));
  return (project.outline || []).map((c) => {
    const d = byChapter[c.chapter];
    return { title: c.chapter, text: d?.text || "", footnotes: d?.footnotes || [], drafted: !!(d && d.text) };
  });
}

// Global footnote numbering across the whole book, in order of appearance.
function numberFootnotes(chapters) {
  let n = 0;
  const idToNum = {};
  const sources = {}; // num -> source string
  for (const ch of chapters) {
    const byId = Object.fromEntries((ch.footnotes || []).map((f) => [f.id, f]));
    for (const id of orderedIds(ch.text)) {
      n += 1;
      idToNum[id] = n;
      sources[n] = (byId[id] && byId[id].source) || "[source needed — verify and add]";
    }
  }
  return { idToNum, sources, count: n };
}

// ---------------- Word (.docx) ----------------
export async function compileDocx({ project, drafts, options = {} }) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, FootnoteReferenceRun, PageBreak, AlignmentType } = await import("docx");
  const includeGaps = options.includeGaps !== false;
  const pageBreaks = options.pageBreaks !== false;

  const chapters = chaptersOf(project, drafts);
  const { idToNum, sources, count } = numberFootnotes(chapters);

  function emphasisRuns(text) {
    const out = [];
    let last = 0, m;
    EMPH.lastIndex = 0;
    while ((m = EMPH.exec(text))) {
      if (m.index > last) out.push(new TextRun(text.slice(last, m.index)));
      const t = m[0];
      if (t.startsWith("**")) out.push(new TextRun({ text: t.slice(2, -2), bold: true }));
      else out.push(new TextRun({ text: t.slice(1, -1), italics: true }));
      last = m.index + t.length;
    }
    if (last < text.length) out.push(new TextRun(text.slice(last)));
    return out;
  }

  function inlineRuns(text) {
    const runs = [];
    for (const p of text.split(TOKEN)) {
      if (!p) continue;
      if (p.startsWith("[GAP:")) { runs.push(new TextRun({ text: p, italics: true, color: "8a6d1f" })); continue; }
      const fm = p.match(/^\[\^(fn_[a-z0-9]+)\]$/);
      if (fm) { if (idToNum[fm[1]]) runs.push(new FootnoteReferenceRun(idToNum[fm[1]])); continue; }
      for (const r of emphasisRuns(p)) runs.push(r);
    }
    return runs.length ? runs : [new TextRun("")];
  }

  function blockParagraphs(text) {
    const paras = [];
    for (const block of text.split(/\n{2,}/)) {
      const b = block.trim();
      if (!b) continue;
      if (b.startsWith("### ")) paras.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: inlineRuns(b.slice(4)) }));
      else if (b.startsWith("## ")) paras.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: inlineRuns(b.slice(3)) }));
      else if (b.startsWith("# ")) paras.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: inlineRuns(b.slice(2)) }));
      else paras.push(new Paragraph({ children: inlineRuns(b) }));
    }
    return paras;
  }

  const body = [];
  body.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, text: project.title || "Untitled" }));
  body.push(new Paragraph({ children: [new PageBreak()] }));

  chapters.forEach((ch, i) => {
    if (i > 0 && pageBreaks) body.push(new Paragraph({ children: [new PageBreak()] }));
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: ch.title }));
    if (!ch.drafted) {
      body.push(new Paragraph({ children: [new TextRun({ text: "(not yet drafted)", italics: true, color: "999999" })] }));
      return;
    }
    let text = ch.text;
    if (!includeGaps) text = text.replace(GAP, "");
    for (const p of blockParagraphs(text)) body.push(p);
  });

  // docx footnotes map: { num: { children: [Paragraph(source)] } }
  const footnotes = {};
  for (let i = 1; i <= count; i++) {
    footnotes[i] = { children: [new Paragraph({ children: emphasisRuns(sources[i]) })] };
  }

  const doc = new Document({ footnotes, sections: [{ children: body }] });
  return Packer.toBlob(doc);
}

// ---------------- Markdown (.md) ----------------
export function compileMarkdown({ project, drafts, options = {} }) {
  const includeGaps = options.includeGaps !== false;
  const chapters = chaptersOf(project, drafts);
  const { idToNum, sources, count } = numberFootnotes(chapters);

  const lines = [`# ${project.title || "Untitled"}`, ""];
  for (const ch of chapters) {
    lines.push(`## ${ch.title}`, "");
    if (!ch.drafted) { lines.push("*(not yet drafted)*", ""); continue; }
    let text = ch.text;
    if (!includeGaps) text = text.replace(GAP, "");
    // rewrite [^fn_x] tokens to numbered markdown footnote refs [^N]
    text = text.replace(/\[\^(fn_[a-z0-9]+)\]/g, (m, id) => (idToNum[id] ? `[^${idToNum[id]}]` : ""));
    lines.push(text.trim(), "");
  }
  if (count > 0) {
    lines.push("## Notes", "");
    for (let i = 1; i <= count; i++) lines.push(`[^${i}]: ${sources[i]}`);
    lines.push("");
  }
  return lines.join("\n");
}
