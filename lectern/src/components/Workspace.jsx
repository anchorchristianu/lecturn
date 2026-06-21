import { useState } from "react";
import StageRail from "./StageRail.jsx";
import DraftView from "./DraftView.jsx";
import { post, ai } from "../api.js";
import { countGaps, readingTime, fmt } from "../metrics.js";

const SOURCE_TYPES = ["walk recording", "sermon transcript", "talk / lecture", "interview", "notes / article"];

export default function Workspace({ project, sources, drafts, onReload, onBack, onDeleted }) {
  const [tab, setTab] = useState("sources");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");           // a label for whatever's running
  const [adding, setAdding] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState(project.outline?.[0]?.chapter || "");
  const [interviewQs, setInterviewQs] = useState({});  // chapter -> questions[]
  const [feedback, setFeedback] = useState("");

  const run = async (label, fn) => {
    setErr(""); setBusy(label);
    try { await fn(); } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(""); }
  };

  const ctx = { brief: project.brief, voiceSample: project.voiceSample };

  // ---- sources ----
  async function addSource(s) {
    await run("Saving", async () => {
      await post({ op: "addSource", source: { ...s, projectId: project.id } });
      setAdding(false);
      await onReload();
    });
  }
  async function fileSource(src) {
    await run("Filing", async () => {
      const r = await ai("sort", { ...ctx, outline: project.outline, source: src });
      await post({
        op: "updateSource",
        source: { ...src, summary: r.summary || "", themes: r.themes || [], chapters: r.chapters || [], stories: r.stories || [], suggestedChapter: r.suggestedChapter || "" },
      });
      await onReload();
    });
  }
  async function removeSource(src) {
    await run("Removing", async () => {
      await post({ op: "deleteSource", projectId: project.id, id: src.id });
      await onReload();
    });
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
    await run(`Thinking of questions`, async () => {
      const forChapter = sources.filter((s) => (s.chapters || []).includes(chapter.chapter));
      const r = await ai("interview", { ...ctx, chapter, sources: forChapter.length ? forChapter : sources });
      setInterviewQs({ ...interviewQs, [chapter.chapter]: r.questions || [] });
    });
  }

  // ---- write ----
  const chapterObj = project.outline?.find((c) => c.chapter === selectedChapter) || project.outline?.[0];
  const draftFor = (title) => drafts.find((d) => d.chapter === title);
  const currentDraft = chapterObj ? draftFor(chapterObj.chapter) : null;

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
        <div className="row">
          <h1>{project.title}</h1>
          <span className="spacer" />
        </div>
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
      {busy && <div className="working" style={{ marginBottom: "1rem" }}><span className="spinner" /> {busy}…</div>}

      {/* ---------------- MATERIAL ---------------- */}
      {tab === "sources" && (
        <div className="stack">
          <div className="row">
            <button className="btn btn-primary" onClick={() => setAdding(true)}>Add a recording or transcript</button>
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
                {s.summary ? <p className="summary">{s.summary}</p> : <p className="summary">Not filed yet — file it so the coach knows what's in it.</p>}
                {(s.themes?.length > 0) && (
                  <div className="tagrow">
                    {s.themes.map((t, i) => <span key={i} className="tag">{t}</span>)}
                  </div>
                )}
                {s.suggestedChapter && <p className="summary"><em>Suggests a new chapter: “{s.suggestedChapter}”</em></p>}
              </div>
              <div className="stack" style={{ minWidth: 110, textAlign: "right" }}>
                {!s.summary && <button className="btn btn-secondary" onClick={() => fileSource(s)} disabled={!!busy}>File this</button>}
                {s.summary && <button className="btn btn-ghost" onClick={() => fileSource(s)} disabled={!!busy}>Re-file</button>}
                <button className="btn btn-ghost" onClick={() => removeSource(s)} disabled={!!busy}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------------- SHAPE ---------------- */}
      {tab === "shape" && (
        <div className="stack">
          <div className="row">
            <button className="btn btn-primary" onClick={shape} disabled={!!busy}>
              {project.outline?.some((c) => c.status) ? "Refresh the outline" : "Suggest an outline"}
            </button>
            <span className="muted">Builds the chapter shape from what you've filed.</span>
          </div>

          {project.questions?.length > 0 && (
            <div className="card">
              <h3>Questions to sharpen the book</h3>
              <ul className="questions">{project.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
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
                    <ul className="questions">{interviewQs[c.chapter].map((q, j) => <li key={j}>{q}</li>)}</ul>
                  )}
                </div>
                {c.status && <span className={`status ${c.status}`}>{c.status}</span>}
              </div>
              <div className="row" style={{ marginTop: "0.8rem" }}>
                <button className="btn btn-ghost" onClick={() => interview(c)} disabled={!!busy}>Interview me on this →</button>
                <button className="btn btn-ghost" onClick={() => { setSelectedChapter(c.chapter); setTab("write"); }}>Write this →</button>
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
            <button className="btn btn-danger" onClick={deleteBook} disabled={!!busy}>Delete this book</button>
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
                <select value={selectedChapter} onChange={(e) => setSelectedChapter(e.target.value)}>
                  {project.outline.map((c) => <option key={c.chapter}>{c.chapter}</option>)}
                </select>
              </div>

              {!currentDraft ? (
                <div className="card center">
                  <p className="muted">No draft yet for this chapter.</p>
                  <button className="btn btn-primary btn-lg" onClick={draftChapter} disabled={!!busy}>Draft this chapter in your voice</button>
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
                      <span className="hint">Talk back to it: “cut the second story,” “add what the river taught me,” “warmer opening.”</span>
                      <textarea className="textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} style={{ minHeight: 90 }} />
                    </div>
                    <div className="row">
                      <button className="btn btn-primary" onClick={reviseChapter} disabled={!!busy || !feedback.trim()}>Revise</button>
                      <button className="btn btn-secondary" onClick={polishChapter} disabled={!!busy}>Polish (light pass)</button>
                      <button className="btn btn-ghost" onClick={draftChapter} disabled={!!busy}>Re-draft from scratch</button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {adding && <AddSource onSave={addSource} onClose={() => setAdding(false)} busy={!!busy} />}
    </div>
  );
}

function AddSource({ onSave, onClose, busy }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState(SOURCE_TYPES[0]);
  const [text, setText] = useState("");
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>Add material</h2>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Give it a name</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Morning walk — the Quito years" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>What kind?</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Paste the transcript</label>
          <span className="hint">From iPhone Voice Memos, YouTube captions, or any text.</span>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 200 }} />
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => onSave({ title, type, text })}>Add to book</button>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
