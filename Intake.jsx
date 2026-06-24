import { useState } from "react";

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

export default function Intake({ onCreate, onCancel }) {
  const [f, setF] = useState({
    title: "",
    focus: "",
    audience: "",
    purpose: "",
    materials: [],
    length: LENGTHS[1],
    voiceSample: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (m) =>
    setF({ ...f, materials: f.materials.includes(m) ? f.materials.filter((x) => x !== m) : [...f.materials, m] });

  async function submit() {
    if (!f.focus.trim()) { setErr("Tell me what the book is about — even a sentence is enough."); return; }
    setErr("");
    setBusy(true);
    try {
      await onCreate(f);
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="crumbs"><button className="btn-ghost" onClick={onCancel}>← Your books</button></div>
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
