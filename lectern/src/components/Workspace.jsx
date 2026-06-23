import { useState } from "react";
import StageRail from "./StageRail.jsx";
import DraftView from "./DraftView.jsx";
import { post, ai } from "../api.js";
import { countGaps, readingTime, fmt } from "../metrics.js";

const SOURCE_TYPES = ["walk recording", "sermon transcript", "talk / lecture", "interview", "notes / article"];

// Small inline spinner + label, reused on buttons and cards.
const Spin = ({ children }) => (
  <span className="working"><span className="spinner" /> {children}</span>
);

export default function Workspace({ project, sources, drafts, onReload, onBack, onDeleted }) {
  const [tab, setTab] = useState("sources");
  const [err, setErr] = useState("");
  // busy tracks BOTH a label (for the global indicator) and an id (which item
  // is being worked on), so each card/button can show its own spinner.
  const [busy, setBusy] = useState({ label: "", id: "" });
  const working = !!busy.label;
  const [adding, setAdding] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState(project.outline?.[0]?.chapter || "");
  const [interviewQs, setInterviewQs] = useState({});
  const [feedback, setFeedback] = useState("");

  const run = async (label, fn, id = "") => {
    setErr(""); setBusy({ label, id });
    try { await fn(); } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy({ label: "", id: "" }); }
  };

  const ctx = { brief: project.brief, voiceSample: project.voiceSample };

  // ---- sources ----
  async function addSource(s) {
    await run("Adding your material", async () => {
      await post({ op: "addSource", source: { ...s, projectId: project.id } });
      await onReload();          // refresh BEFORE closing so the new card is visible
      setAdding(false);
    });
  }
  async function fileSource(src) {
    await run("Reading and filing this", async () => {
      const r = await ai("sort", { ...ctx, outline: project.outline, source: src });
      await post({
        op: "updateSource",
        source: { ...src, summary: r.summary || "", themes: r.themes || [], chapters: r.chapters || [], stories: r.stories || [], suggestedChapter: r.suggestedChapter || "" },
      });
      await onReload();
    }, src.id);
  }
  async function removeSource(src) {
    await run("Removing", async () => {
      await post({ op: "deleteSource", projectId: project.id, id: src.id });
      await onReload();
    }, src.id);
  }

  // Answer a question -> save it as material, pre-filed to its chapter (no AI call).
  async function answerQuestion(question, chapter, answer, done) {
    await post({
      op: "addSource",
      source: {
        projectId: project.id,
        title: `Answer — ${chapter || "to sharpen the book"}`,
        type: "answer",
        text: answer,
        summary: `Answer to: ${question}`,
        chapters: chapter ? [chapter] : [],
      },
    });
    await onReload();
    done && done();
  }

  // ---- shape ----
  async function shape() {
    await run("Shaping the outline", async () => {
      const summarized = sources.map((s) => ({ title: s.title, type: s.type, summary: s.summary, stories: s.stories }));
      const r = await ai("shape", { ...ctx, outline: project.outline, sources: summarized });
      await post({ op: "updateProject", project: { ...project, outline: r.outline || project.outline, gaps: r.gaps || [] } });
      await onReload();
    });
  }
  async function interview(chapter) {
    await run("Thinking of questions", async () => {
      const forChapter = sources.filter((s) => (s.chapters || []).includes(chapter.chapter));
      const r = await ai("interview", { ...ctx, chapter, sources: forChapter.length ? forChapter : sources });
      setInterviewQs({ ...interviewQs, [chapter.chapter]: r.questions || [] });
    }, chapter.chapter);
  }

  // ---- write ----
  const chapterObj = project.outline?.find((c) => c.chapter === selectedChapter) || project.outline?.[0];
  const currentDraft = chapterObj ? drafts.find((d) => d.chapter === chapterObj.chapter) : null;

  function sourcesForChapter(chapter) {
    const matched = sources.filter((s) => (s.chapters || []).includes(chapter.chapter));
    return matched.length ? matched : sources;
  }
  async function draftChapter() {
    await run("Drafting the chapter", async () => {
      const r = await ai("draft", { ...ctx, chapter: chapterObj, sources: sourcesForChapter(chapterObj) });
      await post({ op: "saveDraft", draft: { projectId: project.id, chapter: chapterObj.chapter, text: r.draft || "", notes: r.notes || [], version: currentDraft?.version || 0 } });
      await onReload();
    });
  }
  async function reviseChapter() {
    if (!feedback.trim()) return;
    await run("Revising", async () => {
      const r = await ai("refine", { ...ctx, chapter: chapterObj, currentDraft: currentDraft.text, feedback, sources: sourcesForChapter(chapterObj) });
      await post({ op: "saveDraft", draft: { ...currentDraft, text: r.draft || currentDraft.text, notes: r.notes || [] } });
      setFeedback("");
      await onReload();
    });
  }
  async function polishChapter() {
    await run("Polishing", async () => {
      const r = await ai("polish", { ...ctx, chapter: chapterObj, currentDraft: currentDraft.text });
      await post({ op: "saveDraft", draft: { ...currentDraft, text: r.draft || currentDraft.text, polished: true } });
      await onReload();
    });
  }

  async function deleteBook() {
    if (!confirm(`Delete "${project.title}" and everything in it? This can't be undone.`)) return;
    await run("Deleting", async () => {
      await post({ op: "deleteProject", id: project.id });
      onDeleted();
    });
  }

  return (
    <div>
      <div className="crumbs"><button className="btn-ghost" onClick={onBack}>← Your books</button></div>

      <div className="ws-head">
        <div className="row"><h1>{project.title}</h1><span className="spacer" /></div>
        <p className="ws-brief">{project.brief}</p>
        <p className="muted" style={{ fontSize: "0.9rem", marginTop: "0.4rem" }}>
          {fmt(project.counts?.words || 0)} words drafted · {sources.length} pieces of material · {project.outline?.length || 0} chapters
        </p>
      </div>

      <div style={{ margin: "1.5rem 0" }}>
        <StageRail project={project} sources={sources} drafts={drafts} />
      </div>

      <div className="tabs" role="tablist">
        <button className={`tab ${tab === "sources" ? "on" : ""}`} onClick={() => setTab("sources")}>Material ({sources.length})</button>
        <button className={`tab ${tab === "shape" ? "on" : ""}`} onClick={() => setTab("shape")}>Shape</button>
        <button className={`tab ${tab === "write" ? "on" : ""}`} onClick={() => setTab("write")}>Write</button>
      </div>

      {err && <div className="banner error">{err}</div>}
      {working && <div className="working" style={{ marginBottom: "1rem" }}><span className="spinner" /> {busy.label}…</div>}

      {/* ---------------- MATERIAL ---------------- */}
      {tab === "sources" && (
        <div className="stack">
          <div className="row">
            <button className="btn btn-primary" onClick={() => setAdding(true)} disabled={working}>Add a recording or transcript</button>
            <span className="muted">Paste from Voice Memos, YouTube captions, or anywhere.</span>
          </div>

          {sources.length === 0 && (
            <div className="card center muted">No material yet. Add your first transcript to begin.</div>
          )}

          {sources.map((s) => (
            <div key={s.id} className="card source-item">
              <div className="body">
                <span className="kind">{s.type}</span>
                <h3>{s.title}</h3>
                <p className="muted" style={{ fontSize: "0.82rem", margin: "0.1rem 0 0" }}>
                  {fmt(s.words || 0)} words · ~{readingTime(s.words || 0)} min
                </p>
                {busy.id === s.id ? (
                  <p className="summary"><Spin>{busy.label}…</Spin></p>
                ) : s.summary ? (
                  <p className="summary">{s.summary}</p>
                ) : (
                  <p className="summary">Not filed yet — file it so the coach knows what's in it.</p>
                )}
                {s.themes?.length > 0 && (
                  <div className="tagrow">{s.themes.map((t, i) => <span key={i} className="tag">{t}</span>)}</div>
                )}
                {s.suggestedChapter && <p className="summary"><em>Suggests a new chapter: "{s.suggestedChapter}"</em></p>}
              </div>
              <div className="stack" style={{ minWidth: 110, textAlign: "right" }}>
                <button className="btn btn-secondary" onClick={() => fileSource(s)} disabled={working}>
                  {s.summary ? "Re-file" : "File this"}
                </button>
                <button className="btn btn-ghost" onClick={() => removeSource(s)} disabled={working}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- SHAPE ---------------- */}
      {tab === "shape" && (
        <div className="stack">
          <div className="row">
            <button className="btn btn-primary" onClick={shape} disabled={working}>
              {working && busy.label.startsWith("Shaping")
                ? <Spin>Shaping…</Spin>
                : project.outline?.some((c) => c.status) ? "Refresh the outline" : "Suggest an outline"}
            </button>
            <span className="muted">Builds the chapter shape from what you've filed.</span>
          </div>

          {project.questions?.length > 0 && (
            <div className="card">
              <h3>Questions to sharpen the book</h3>
              <p className="muted" style={{ marginTop: 0 }}>Answer any of these here, or out loud on your next walk. Your answer becomes material for the book.</p>
              <ul className="questions">
                {project.questions.map((q, i) => (
                  <QuestionItem key={i} question={q} chapter={null} onAnswer={answerQuestion} working={working} />
                ))}
              </ul>
            </div>
          )}

          {(project.outline || []).map((c, i) => (
            <div key={i} className="card">
              <div className="outline-item">
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <div style={{ flex: 1 }}>
                  <h3>{c.chapter}</h3>
                  {c.purpose && <p className="purpose">{c.purpose}</p>}
                  {c.coveredBy?.length > 0 && <p className="purpose">Drawn from: {c.coveredBy.join(", ")}</p>}
                  {interviewQs[c.chapter] && (
                    <ul className="questions">
                      {interviewQs[c.chapter].map((q, j) => (
                        <QuestionItem key={j} question={q} chapter={c.chapter} onAnswer={answerQuestion} working={working} />
                      ))}
                    </ul>
                  )}
                </div>
                {c.status && <span className={`status ${c.status}`}>{c.status}</span>}
              </div>
              <div className="row" style={{ marginTop: "0.8rem" }}>
                <button className="btn btn-ghost" onClick={() => interview(c)} disabled={working}>
                  {busy.id === c.chapter ? <Spin>Thinking…</Spin> : "Interview me on this →"}
                </button>
                <button className="btn btn-ghost" onClick={() => { setSelectedChapter(c.chapter); setTab("write"); }} disabled={working}>Write this →</button>
              </div>
            </div>
          ))}

          {project.gaps?.length > 0 && (
            <div className="card">
              <h3>Still missing</h3>
              <p className="muted" style={{ marginTop: 0 }}>Things the book promises but the material doesn't cover yet — good fodder for your next walk.</p>
              <ul className="note-list">{project.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </div>
          )}

          <div className="row" style={{ marginTop: "2rem" }}>
            <span className="spacer" />
            <button className="btn btn-danger" onClick={deleteBook} disabled={working}>Delete this book</button>
          </div>
        </div>
      )}

      {/* ---------------- WRITE ---------------- */}
      {tab === "write" && (
        <div className="stack">
          {(!project.outline || project.outline.length === 0) ? (
            <div className="card center muted">No chapters yet. Visit <b>Shape</b> first to build an outline.</div>
          ) : (
            <>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Which chapter?</label>
                <select value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)} disabled={working}>
                  {project.outline.map((c) => <option key={c.chapter}>{c.chapter}</option>)}
                </select>
              </div>

              {!currentDraft ? (
                <div className="card center">
                  <p className="muted">No draft yet for this chapter.</p>
                  <button className="btn btn-primary btn-lg" onClick={draftChapter} disabled={working}>
                    {working ? <Spin>{busy.label}…</Spin> : "Draft this chapter in your voice"}
                  </button>
                </div>
              ) : (
                <>
                  {currentDraft.notes?.length > 0 && (
                    <div className="card">
                      <h3>Editor's notes</h3>
                      <ul className="note-list">{currentDraft.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                    </div>
                  )}

                  <div className="card">
                    <p className="muted" style={{ fontSize: "0.85rem", marginTop: 0 }}>
                      {fmt(currentDraft.words || 0)} words · ~{readingTime(currentDraft.words || 0)} min ·{" "}
                      {countGaps(currentDraft.text) > 0
                        ? <span style={{ color: "var(--brass)" }}>{countGaps(currentDraft.text)} gap(s) to fill</span>
                        : "no open gaps"}
                      {currentDraft.polished && " · polished"}
                    </p>
                    <DraftView text={currentDraft.text} />
                  </div>

                  <div className="card stack">
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Tell the coach what to change</label>
                      <span className="hint">Talk back to it: "cut the second story," "add what the river taught me," "warmer opening."</span>
                      <textarea className="textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} style={{ minHeight: 90 }} disabled={working} />
                    </div>
                    <div className="row">
                      <button className="btn btn-primary" onClick={reviseChapter} disabled={working || !feedback.trim()}>
                        {working && busy.label === "Revising" ? <Spin>Revising…</Spin> : "Revise"}
                      </button>
                      <button className="btn btn-secondary" onClick={polishChapter} disabled={working}>
                        {working && busy.label === "Polishing" ? <Spin>Polishing…</Spin> : "Polish (light pass)"}
                      </button>
                      <button className="btn btn-ghost" onClick={draftChapter} disabled={working}>Re-draft from scratch</button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {adding && <AddSource onSave={addSource} onClose={() => setAdding(false)} working={working} busyLabel={busy.label} />}
    </div>
  );
}

// A question with an inline answer box. Saving turns the answer into material.
function QuestionItem({ question, chapter, onAnswer, working }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onAnswer(question, chapter, text, () => { setText(""); setOpen(false); setSaved(true); });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li>
      <div>{question}</div>
      {saved && !open ? (
        <p className="muted" style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
          ✓ Saved to your material. <button className="btn-ghost" style={{ minHeight: "auto", padding: 0 }} onClick={() => { setSaved(false); setOpen(true); }}>Add more</button>
        </p>
      ) : !open ? (
        <button className="btn-ghost" style={{ minHeight: 38, padding: "0 0.2rem" }} onClick={() => setOpen(true)} disabled={working}>Answer this →</button>
      ) : (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer, or paste a dictation from Voice Memos…" style={{ minHeight: 90 }} disabled={saving} />
          <div className="row">
            <button className="btn btn-primary" onClick={save} disabled={saving || !text.trim()}>
              {saving ? <Spin>Saving…</Spin> : "Save answer"}
            </button>
            <button className="btn btn-ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

function AddSource({ onSave, onClose, working, busyLabel }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState(SOURCE_TYPES[0]);
  const [text, setText] = useState("");
  return (
    <div className="scrim" onClick={() => !working && onClose()}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>Add material</h2>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Give it a name</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning walk — the Quito years" disabled={working} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>What kind?</label>
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={working}>
            {SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Paste the transcript</label>
          <span className="hint">From iPhone Voice Memos, YouTube captions, or any text.</span>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 200 }} disabled={working} />
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={working || !text.trim()} onClick={() => onSave({ title, type, text })}>
            {working ? <Spin>{busyLabel}…</Spin> : "Add to book"}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={working}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
