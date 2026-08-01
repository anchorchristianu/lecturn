// src/extract.js — pull plain text out of an uploaded file, in the browser.
// The heavy parsers (pdf.js, mammoth) are dynamically imported so they only
// download when someone actually picks a file.

export async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();

  if (name.endsWith(".pdf")) return extractPdf(buf);
  if (name.endsWith(".docx")) return extractDocx(buf);
  if (name.endsWith(".txt") || name.endsWith(".md")) return new TextDecoder().decode(buf).trim();
  if (name.endsWith(".doc"))
    throw new Error("Old .doc files can't be read in the browser. Open it and save as .docx or PDF, then upload again.");
  throw new Error("Unsupported file. Please upload a PDF, .docx, .txt, or .md file.");
}

async function extractPdf(buf) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it) => (it && "str" in it ? it.str : "")).join(" "));
  }
  const text = pages.join("\n\n").trim();
  if (!text) throw new Error("No text found — this PDF may be scanned images rather than text. Try a text-based PDF.");
  return text;
}

async function extractDocx(buf) {
  // Import mammoth's self-contained *browser* build explicitly. The default
  // "mammoth" entry pulls in the Node unzip, which rejects an ArrayBuffer with
  // "Could not find file in options" in the browser — the docx upload failure.
  const mammoth = (await import("mammoth/mammoth.browser.js")).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return (value || "").trim();
}

// ---- Manuscript import: pull an already-written work into chapters ----

function decodeEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// Convert mammoth's clean HTML into markdown we can split on headings.
export function htmlToMarkdown(html) {
  let s = String(html || "");
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, _t, x) => `**${x}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, _t, x) => `*${x}*`);
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, x) => `\n\n# ${x}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, x) => `\n\n## ${x}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, x) => `\n\n### ${x}\n\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, x) => `\n- ${x}`);
  s = s.replace(/<\/(?:ul|ol)>/gi, "\n\n");
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, x) => `\n\n${x}\n\n`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Split markdown (or plain text) into chapters. Prefers markdown headings; falls
// back to "Chapter N" / "Part N" lines; otherwise treats the whole thing as one.
export function splitIntoChapters(md) {
  const text = String(md || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");

  const h1 = [], h2 = [];
  lines.forEach((l, i) => {
    if (/^#\s+\S/.test(l)) h1.push(i);
    else if (/^##\s+\S/.test(l)) h2.push(i);
  });

  let boundaries = [];
  if (h1.length >= 2) boundaries = h1;
  else if (h2.length >= 2) boundaries = h2;               // e.g. one # book title + ## chapters
  else {
    const chap = [];
    lines.forEach((l, i) => {
      const t = l.trim();
      if (t.length < 80 && /^(chapter|part|section)\b[\s:.\-—]*\S/i.test(t)) chap.push(i);
    });
    if (chap.length >= 2) boundaries = chap;
  }

  const titleOf = (line, n) => line.replace(/^#{1,6}\s+/, "").trim() || `Chapter ${n}`;

  if (!boundaries.length) {
    const firstH = lines.findIndex((l) => /^#+\s+\S/.test(l));
    const title = firstH >= 0 ? titleOf(lines[firstH], 1) : "";
    const body = (firstH >= 0 ? lines.slice(firstH + 1) : lines).join("\n").trim();
    return [{ title: title || "Chapter 1", text: body || text }];
  }

  const chapters = [];
  // Content before the first boundary (front matter / opening) — keep it, don't lose it.
  const pre = lines.slice(0, boundaries[0]).join("\n").replace(/^#+\s+.*$/gm, "").trim();
  if (pre.split(/\s+/).filter(Boolean).length >= 20) chapters.push({ title: "Opening", text: pre });

  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b];
    const end = b + 1 < boundaries.length ? boundaries[b + 1] : lines.length;
    const title = titleOf(lines[start], chapters.length + 1);
    const body = lines.slice(start + 1, end).join("\n").trim();
    chapters.push({ title, text: body });
  }
  return chapters.filter((c) => (c.text && c.text.trim()) || c.title);
}

// Read an uploaded manuscript into { title, chapters, voiceSample }.
export async function extractChaptersFromFile(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const baseTitle = file.name.replace(/\.[^.]+$/, "");

  let md;
  if (name.endsWith(".docx")) {
    const mammoth = (await import("mammoth/mammoth.browser.js")).default;
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
    md = htmlToMarkdown(html);
  } else if (name.endsWith(".md") || name.endsWith(".txt")) {
    md = new TextDecoder().decode(buf).trim();
  } else if (name.endsWith(".pdf")) {
    md = await extractPdf(buf); // best-effort; PDFs rarely carry heading structure
  } else if (name.endsWith(".doc")) {
    throw new Error("Old .doc files can't be read in the browser. Open it and save as .docx or PDF, then try again.");
  } else {
    throw new Error("Unsupported file. Please upload a .docx, .md, .txt, or PDF.");
  }

  const chapters = splitIntoChapters(md);
  if (!chapters.length) throw new Error("Couldn't find any readable text in that file.");
  const h1 = (md.match(/^#\s+(.+)$/m) || [])[1];
  const title = (h1 || baseTitle || "").trim();
  const voiceSample = md.replace(/^#+\s+.*$/gm, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 600).join(" ");
  return { title, chapters, voiceSample };
}
