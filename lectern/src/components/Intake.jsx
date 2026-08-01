import { useState } from "react";
import { extractChaptersFromFile } from "../extract.js";

const MATERIALS = [
  "Walk recordings",
  "Sermon transcripts",
  "Talks & lectures",
  "Interviews",
  "Existing notes & articles",
];

const LENGTHS = [
  "Booklet (~15–25k words)",
  "Standard (~40–60k words)",
  "Full-length (~70k+ words)",
];

export default function Intake({ onCreate, onImport, onCancel }) {
  const [mode, setMode] = useState(null); // null | "new" | "import"

  // --- shared ---
  const [busy, setBusy] = useState(false);

  // --- new book (scope) ---
  const [f, setF] = useState({
    title: "", focus: "", audience: "", purpose: "",
    materials: [], length: LENGTHS[1], voiceSample: "",
  });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (m) =>
    setF({ ...f, materials: f.materials.includes(m) ? f.materials.filter((x) => x !== m) : [...f.materials, m] });

  async function submit() {
    if (!f.focus.trim()) { setErr("Tell me what the book is about — even a sentence is enough."); return; }
    setErr(""); setBusy(true);
    try { await onCreate(f); }
    catch (e) { setErr(String(e.message || e)); setBusy(false); }
  }

  // --- import manuscript ---
  const [parsed, setParsed] = useState(null); // { title, chapters, voiceSample }
  const [impTitle, setImpTitle] = useState("");
  const [impBrief, setImpBrief] = useState("");
  const [reading, setReading] = useState("");
  const [impErr, setImpErr] = useState("");

  async function handleManuscript(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImpErr(""); setReading(file.name); setParsed(null);
    try {
      const res = await extractChaptersFromFile(file);
      setParsed(res);
      setImpTitle(res.title || file.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setImpErr(String(err.message || err));
    } finally {
      setReading("");
    }
  }

  async function doImport() {
    if (!parsed) return;
    setImpErr(""); setBusy(true);
    try { await onImport({ title: impTitle, brief: impBrief, chapters: parsed.chapters, voiceSample: parsed.voiceSample }); }
    catch (err) { setImpErr(String(err.message || err)); setBusy(false); }
  }

  // ---------------- chooser ----------------
  if (!mode) {
    return (
      <div>
        <div className="crumbs"><button className="btn-ghost" onClick={onCancel}>← Your books</button></div>
        <h1>Start a new book</h1>
        <p className="ws-brief" style={{ marginBottom: "1.75rem" }}>Two ways in — pick the one that fits what you've got.</p>
        <div className="start-choice">
          <button className="card choice-card" onClick={() => setMode("new")}>
            <h2>Start from scratch</h2>
            <p>You'll bring recordings, talks, or notes. The coach scopes the book, shapes an outline, and drafts each chapter in your voice.</p>
            <span className="choice-go">Scope a new book →</span>
          </button>
          <button className="card choice-card" onClick={() => setMode("import")}>
            <h2>I already have a manuscript</h2>
            <p>Upload a book you've written. Lectern reads it, finds your chapters, and brings them in as-is — ready for review, editing, and the coach. Nothing is rewritten.</p>
            <span className="choice-go">Upload &amp; continue →</span>
          </button>
        </div>
      </div>
    );
  }

  // ---------------- import ----------------
  if (mode === "import") {
    const chapCount = parsed?.chapters.length || 0;
    return (
      <div>
        <div className="crumbs"><button className="btn-ghost" onClick={() => setMode(null)} disabled={busy}>← Back</button></div>
        <h1>Bring in a manuscript</h1>
        <p className="ws-brief" style={{ marginBottom: "1.75rem" }}>
          Upload a book you've already written. Lectern reads it and pulls your chapters in as-is — nothing is rewritten. From there you go straight to review, editing, and the coach.
        </p>

        {impErr && <div className="banner error">{impErr}</div>}

        <div className="card stack">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Your manuscript <span className="hint" style={{ display: "inline" }}>(Word .docx, Markdown .md, or .txt — PDF works, but chapter detection is rougher)</span></label>
            <label className="btn btn-secondary" style={{ display: "inline-flex", cursor: reading ? "default" : "pointer" }}>
              {reading ? <span className="working"><span className="spinner" /> Reading {reading}…</span> : parsed ? "Choose a different file" : "Choose your manuscript"}
              <input type="file" accept=".docx,.md,.txt,.pdf" onChange={handleManuscript} disabled={!!reading || busy} style={{ display: "none" }} />
            </label>
          </div>

          {parsed && (
            <>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Book title</label>
                <input className="input" value={impTitle} onChange={(e) => setImpTitle(e.target.value)} placeholder="Name your book" disabled={busy} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>What's it about? <span className="hint" style={{ display: "inline" }}>(optional — helps the coach and review)</span></label>
                <textarea className="textarea" value={impBrief} onChange={(e) => setImpBrief(e.target.value)} style={{ minHeight: 80 }} disabled={busy} />
              </div>
              <div>
                <label style={{ fontWeight: 600 }}>Found {chapCount} chapter{chapCount === 1 ? "" : "s"}</label>
                <span className="hint">Check the breaks look right. You can rename, reorder, split, or merge chapters later on the Shape tab.</span>
                <div className="import-chapters">
                  {parsed.chapters.map((c, i) => (
                    <div key={i} className="import-chapter">
                      <span className="num">{String(i + 1).padStart(2, "0")}</span>
                      <span className="ic-title">{c.title || <em className="muted">Untitled</em>}</span>
                      <span className="ic-words">{c.text.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="row" style={{ marginTop: "1.5rem" }}>
          <button className="btn btn-primary btn-lg" onClick={doImport} disabled={busy || !parsed}>
            {busy ? <span className="working"><span className="spinner" /> Bringing it in…</span> : parsed ? `Bring in ${chapCount} chapter${chapCount === 1 ? "" : "s"} →` : "Upload a file to continue"}
          </button>
          <button className="btn btn-ghost" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
        </div>
      </div>
    );
  }

  // ---------------- new book (scope) ----------------
  return (
    <div>
      <div className="crumbs"><button className="btn-ghost" onClick={() => setMode(null)} disabled={busy}>← Back</button></div>
      <h1>Scope a new book</h1>
      <p className="ws-brief" style={{ marginBottom: "1.75rem" }}>
        A few questions so the coach knows what you're making and who it's for.
        Nothing here is final — it's a starting shape you'll react to.
      </p>

      {err && <div className="banner error">{err}</div>}

      <div className="card stack">
        <div className="field">
          <label>Working title <span className="hint" style={{ display: "inline" }}>(optional)</span></label>
          <input className="input" value={f.title} onChange={set("title")} placeholder="You can name it later" />
        </div>

        <div className="field">
          <label>What's this book about?</label>
          <span className="hint">A sentence or a paragraph, in your own words.</span>
          <textarea className="textarea" value={f.focus} onChange={set("focus")} />
        </div>

        <div className="field">
          <label>Who is it for?</label>
          <span className="hint">Picture one real reader.</span>
          <input className="input" value={f.audience} onChange={set("audience")} placeholder="e.g. young pastors just starting out" />
        </div>

        <div className="field">
          <label>What should a reader walk away with?</label>
          <span className="hint">The change you hope it makes in them.</span>
          <textarea className="textarea" value={f.purpose} onChange={set("purpose")} style={{ minHeight: 90 }} />
        </div>

        <div className="field">
          <label>What kind of material will you bring?</label>
          <span className="hint">Pick any that apply.</span>
          <div className="choices">
            {MATERIALS.map((m) => (
              <button key={m} type="button" className={`chip ${f.materials.includes(m) ? "on" : ""}`} onClick={() => toggle(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>About how long?</label>
          <select value={f.length} onChange={set("length")}>
            {LENGTHS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Your voice, on the page</label>
          <span className="hint">
            Paste a few paragraphs you've already written or said well — an old
            article, a sermon excerpt, a favorite passage. Drafts will be written
            to sound like <em>you</em>, not like an article.
          </span>
          <textarea className="textarea" value={f.voiceSample} onChange={set("voiceSample")} style={{ minHeight: 160 }} />
        </div>
      </div>

      <div className="row" style={{ marginTop: "1.5rem" }}>
        <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy}>
          {busy ? <span className="working"><span className="spinner" /> Scoping your book…</span> : "Scope the book"}
        </button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
