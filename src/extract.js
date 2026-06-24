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
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return (value || "").trim();
}
