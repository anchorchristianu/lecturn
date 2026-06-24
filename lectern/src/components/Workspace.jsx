import { useState, useRef } from "react";
import StageRail from "./StageRail.jsx";
import DraftView from "./DraftView.jsx";
import DevReview from "./DevReview.jsx";
import EditPass from "./EditPass.jsx";
import Footnotes from "./Footnotes.jsx";
import Flags from "./Flags.jsx";
import Spin from "./Spin.jsx";
import { post, ai } from "../api.js";
import { extractTextFromFile } from "../extract.js";
import { countWords, countGaps, readingTime, fmt } from "../metrics.js";
import { newFootnoteId, numberMap, insertAfterAnchor, insertAt, removeMarker, reconcile } from "../footnotes.js";

const SOURCE_TYPES = ["walk recording", "sermon transcript", "talk / lecture", "interview", "notes / article", "outline / framework"];

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
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [activePass, setActivePass] = useState(null);
  const editorRef = useRef(null);

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
      const isStructural = (t) => /outline|framework|notes/i.test(t || "");
      const summarized = sources.map((s) => ({
        title: s.title,
        type: s.type,
        summary: s.summary,
        stories: s.stories,
        // Send the actual outline text for framework sources (truncated) so the
        // shape step can follow the author's own structure even before filing.
        text: isStructural(s.type) ? (s.text || "").slice(0, 4000) : undefined,
      }));
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

  // ---- direct editing (type your own changes) ----
  function startEdit() { setEditText(currentDraft?.text || ""); setEditing(true); }
  function startBlank() { setEditText(""); setEditing(true); }
  function cancelEdit() { setEditing(false); setEditText(""); }
  async function saveEdit() {
    await run("Saving your edits", async () => {
      const base = currentDraft || { projectId: project.id, chapter: chapterObj.chapter, notes: [], version: 0 };
      const footnotes = reconcile(editText, base.footnotes);
      await post({ op: "saveDraft", draft: { ...base, text: editText, footnotes } });
      await onReload();
      setEditing(false);
      setEditText("");
    });
  }

  // Insert a footnote marker at the cursor while editing; the source is added
  // afterward in Notes & sources.
  function insertFootnoteAtCursor() {
    const pos = editorRef.current ? editorRef.current.selectionStart : editText.length;
    const id = newFootnoteId();
    setEditText((t) => insertAt(t, pos, id));
  }

  // ---- footnotes / sources ----
  async function saveDraftObj(draft) {
    await post({ op: "saveDraft", draft });
    await onReload();
  }
  async function formatChicago(raw) {
    try {
      const r = await ai("format_citation", { raw });
      return (r && r.citation) || raw;
    } catch {
      return raw;
    }
  }
  async function addFootnoteFromFlag(flag, source) {
    await run("Adding the source", async () => {
      const id = newFootnoteId();
      const anchor = flag.anchor || flag.text;
      const placed = insertAfterAnchor(currentDraft.text, anchor, id);
      const footnotes = [...(currentDraft.footnotes || []), { id, source, claim: flag.text }];
      // mark the originating flag (if persisted) as sourced
      const flags = (currentDraft.flags || []).map((f) => (f.id === flag.id ? { ...f, status: "sourced", footnoteId: id } : f));
      const patch = { ...currentDraft, footnotes, flags };
      if (placed) {
        await saveDraftObj({ ...patch, text: placed });
      } else {
        await saveDraftObj(patch);
        setErr("Source saved, but I couldn't place the marker automatically (the wording had changed). It's listed under Notes as unplaced.");
      }
    });
  }

  // ---- persistent fact-check flags ----
  const newFlagId = () => "fl_" + Math.random().toString(36).slice(2, 9);
  function mergeFlags(existing, fresh) {
    const resolved = (existing || []).filter((f) => f.status === "sourced" || f.status === "dismissed");
    const resolvedText = new Set(resolved.map((f) => (f.text || "").trim()));
    const open = (fresh || [])
      .filter((f) => !resolvedText.has((f.text || "").trim()))
      .map((f) => ({ id: newFlagId(), status: "open", text: f.text, anchor: f.anchor || f.text, concern: f.concern, category: f.category }));
    return [...resolved, ...open];
  }
  async function runFactcheck() {
    await run("Fact-checking", async () => {
      const r = await ai("edit_pass", {
        ...ctx,
        level: "factcheck",
        chapter: chapterObj,
        currentDraft: currentDraft.text,
        styleGuide: project.styleGuide || "Chicago Manual of Style",
      });
      const flags = mergeFlags(currentDraft.flags, r.flags || []);
      await saveDraftObj({ ...currentDraft, flags, factcheckSummary: r.summary || "" });
    });
  }
  async function dismissFlag(flagId) {
    await run("Updating", async () => {
      const flags = (currentDraft.flags || []).map((f) => (f.id === flagId ? { ...f, status: "dismissed" } : f));
      await saveDraftObj({ ...currentDraft, flags });
    });
  }
  async function restoreFlag(flagId) {
    await run("Updating", async () => {
      const flags = (currentDraft.flags || []).map((f) => (f.id === flagId ? { ...f, status: "open" } : f));
      await saveDraftObj({ ...currentDraft, flags });
    });
  }
  async function updateFootnote(id, source) {
    await run("Saving the source", async () => {
      const footnotes = (currentDraft.footnotes || []).map((f) => (f.id === id ? { ...f, source } : f));
      await saveDraftObj({ ...currentDraft, footnotes });
    });
  }
  async function removeFootnote(id) {
    await run("Removing the note", async () => {
      const text = removeMarker(currentDraft.text, id);
      const footnotes = (currentDraft.footnotes || []).filter((f) => f.id !== id);
      await saveDraftObj({ ...currentDraft, text, footnotes });
    });
  }

  // ---- leveled editing passes (line / copy / proof) ----
  const PASS_LABEL = { line: "Line editing", copy: "Copy editing", proof: "Proofreading", factcheck: "Fact-checking" };
  async function runPass(level) {
    setActivePass(null);
    await run(PASS_LABEL[level], async () => {
      const r = await ai("edit_pass", {
        ...ctx,
        level,
        chapter: chapterObj,
        currentDraft: currentDraft.text,
        styleGuide: project.styleGuide || "Chicago Manual of Style",
      });
      setActivePass({ level, runId: Date.now(), summary: r.summary, suggestions: r.suggestions || [], flags: r.flags || [] });
    });
  }
  async function applyPass(accepted) {
    await run("Applying changes", async () => {
      let text = currentDraft.text;
      let applied = 0;
      let missed = 0;
      for (const s of accepted) {
        if (s.original && text.includes(s.original)) {
          text = text.replace(s.original, () => s.replacement); // function form: no $-pattern surprises
          applied++;
        } else {
          missed++;
        }
      }
      if (applied > 0) {
        await post({ op: "saveDraft", draft: { ...currentDraft, text } });
        await onReload();
      }
      setActivePass(null);
      if (missed > 0) {
        setErr(`Applied ${applied} change${applied === 1 ? "" : "s"}. ${missed} couldn't be matched (the text had changed) and ${missed === 1 ? "was" : "were"} skipped.`);
      }
    });
  }

  async function runReview() {
    await run("Reading the whole manuscript", async () => {
      const chapters = (project.outline || []).map((c) => ({
        chapter: c.chapter,
        purpose: c.purpose,
        text: drafts.find((d) => d.chapter === c.chapter)?.text || "",
      }));
      const r = await ai("developmental_review", { ...ctx, outline: project.outline, chapters });
      await post({ op: "updateProject", project: { ...project, review: { ...r, generatedAt: new Date().toISOString() } } });
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
        <button className={`tab ${tab === "review" ? "on" : ""}`} onClick={() => setTab("review")}>Review</button>
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
                <span className="kind" style={/outline|framework|notes/i.test(s.type) ? { color: "var(--pine)" } : undefined}>
                  {/outline|framework|notes/i.test(s.type) ? "▣ framework · " : ""}{s.type}
                </span>
                <h3>{s.title}</h3>
                <p className="muted" style={{ fontSize: "0.82rem", margin: "0.1rem 0 0" }}>
                  {fmt(s.words || 0)} words · ~{readingTime(s.words || 0)} min
                </p>
                {busy.id === s.id ? (
                  <p className="summary"><Spin>{busy.label}…</Spin></p>
                ) : s.summary ? (
                  <p className="summary">{s.summary}</p>
                ) : /outline|framework|notes/i.test(s.type) ? (
                  <p className="summary">Used as structural scaffolding — guides chapter order and the framework, not drafted as prose.</p>
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
                <select value={selectedChapter} onChange={(e) => { setActivePass(null); setSelectedChapter(e.target.value); }} disabled={working || editing}>
                  {project.outline.map((c) => <option key={c.chapter}>{c.chapter}</option>)}
                </select>
              </div>

              {editing ? (
                <div className="card stack">
                  <div className="row">
                    <label style={{ fontWeight: 600, margin: 0 }}>Editing: {chapterObj.chapter}</label>
                    <span className="spacer" />
                    <span className="muted" style={{ fontSize: "0.85rem" }}>{fmt(countWords(editText))} words</span>
                  </div>
                  <textarea
                    ref={editorRef}
                    className="textarea"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    style={{ minHeight: 440, fontFamily: "var(--display)", fontSize: "1.12rem", lineHeight: 1.7 }}
                    disabled={working}
                    autoFocus
                  />
                  <span className="hint">
                    Type your changes directly. Paragraphs are separated by a blank line; <code>## </code> starts a heading.
                    Replace a <span className="gap">[GAP: …]</span> by writing the missing piece and deleting the marker.
                  </span>
                  <div className="row">
                    <button className="btn btn-primary" onClick={saveEdit} disabled={working}>
                      {working ? <Spin>Saving…</Spin> : "Save edits"}
                    </button>
                    <button className="btn btn-secondary" onClick={insertFootnoteAtCursor} disabled={working}>Insert footnote at cursor</button>
                    <button className="btn btn-ghost" onClick={cancelEdit} disabled={working}>Cancel</button>
                  </div>
                </div>
              ) : !currentDraft ? (
                <div className="card center stack">
                  <p className="muted" style={{ margin: 0 }}>No draft yet for this chapter.</p>
                  <div className="row" style={{ justifyContent: "center" }}>
                    <button className="btn btn-primary btn-lg" onClick={draftChapter} disabled={working}>
                      {working ? <Spin>{busy.label}…</Spin> : "Draft this chapter in your voice"}
                    </button>
                    <button className="btn btn-secondary btn-lg" onClick={startBlank} disabled={working}>Write it myself</button>
                  </div>
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
                    <div className="row" style={{ marginBottom: "0.7rem" }}>
                      <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                        {fmt(currentDraft.words || 0)} words · ~{readingTime(currentDraft.words || 0)} min ·{" "}
                        {countGaps(currentDraft.text) > 0
                          ? <span style={{ color: "var(--brass)" }}>{countGaps(currentDraft.text)} gap(s) to fill</span>
                          : "no open gaps"}
                        {currentDraft.polished && " · polished"}
                      </p>
                      <span className="spacer" />
                      <button className="btn btn-secondary" onClick={startEdit} disabled={working}>✎ Edit directly</button>
                    </div>
                    <DraftView text={currentDraft.text} footnotes={currentDraft.footnotes} />
                  </div>

                  <Footnotes
                    footnotes={currentDraft.footnotes || []}
                    nums={numberMap(currentDraft.text)}
                    working={working}
                    onUpdate={updateFootnote}
                    onRemove={removeFootnote}
                    onFormat={formatChicago}
                  />

                  {(currentDraft.flags || []).length > 0 && (
                    <Flags
                      flags={currentDraft.flags}
                      summary={currentDraft.factcheckSummary}
                      working={working}
                      checking={working && busy.label === "Fact-checking"}
                      onAddSource={addFootnoteFromFlag}
                      onDismiss={dismissFlag}
                      onRestore={restoreFlag}
                      onFormat={formatChicago}
                      onRecheck={runFactcheck}
                    />
                  )}

                  <div className="card stack">
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Or tell the coach what to change</label>
                      <span className="hint">Talk back to it: "cut the second story," "add what the river taught me," "warmer opening."</span>
                      <textarea className="textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} style={{ minHeight: 90 }} disabled={working} />
                    </div>
                    <div className="row">
                      <button className="btn btn-primary" onClick={reviseChapter} disabled={working || !feedback.trim()}>
                        {working && busy.label === "Revising" ? <Spin>Revising…</Spin> : "Revise"}
                      </button>
                      <button className="btn btn-ghost" onClick={draftChapter} disabled={working}>Re-draft from scratch</button>
                    </div>
                  </div>

                  {activePass ? (
                    <EditPass pass={activePass} working={working} onApply={applyPass} onClose={() => setActivePass(null)} onAddSource={addFootnoteFromFlag} onFormat={formatChicago} />
                  ) : (
                    <div className="card stack">
                      <div>
                        <h3 style={{ margin: "0 0 0.2rem" }}>Editing passes</h3>
                        <span className="hint">
                          Professional editing, one level at a time, applied top to bottom. Each pass proposes changes you accept or reject — nothing happens to your words unless you say so.
                        </span>
                      </div>
                      <div className="row">
                        <button className="btn btn-secondary" onClick={() => runPass("line")} disabled={working}>
                          {working && busy.label === "Line editing" ? <Spin>Line editing…</Spin> : "Line edit"}
                        </button>
                        <button className="btn btn-secondary" onClick={() => runPass("copy")} disabled={working}>
                          {working && busy.label === "Copy editing" ? <Spin>Copy editing…</Spin> : "Copy edit"}
                        </button>
                        <button className="btn btn-secondary" onClick={() => runPass("proof")} disabled={working}>
                          {working && busy.label === "Proofreading" ? <Spin>Proofreading…</Spin> : "Proofread"}
                        </button>
                        <button className="btn btn-secondary" onClick={runFactcheck} disabled={working} style={{ borderColor: "var(--brass)", color: "var(--brass)" }}>
                          {working && busy.label === "Fact-checking" ? <Spin>Fact-checking…</Spin> : "Fact-check"}
                        </button>
                      </div>
                      <span className="muted" style={{ fontSize: "0.8rem" }}>
                        Line = style &amp; voice · Copy = grammar &amp; consistency · Proof = final typos · Fact-check = flags quotes, names, numbers &amp; scripture refs to verify. Settle the structure first (see <b>Review</b>) before polishing sentences.
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------------- REVIEW ---------------- */}
      {tab === "review" && (
        <div className="stack">
          <div className="row">
            <button className="btn btn-primary" onClick={runReview} disabled={working}>
              {working && busy.label.startsWith("Reading")
                ? <Spin>Reading the manuscript…</Spin>
                : project.review ? "Refresh the review" : "Run a developmental review"}
            </button>
            <span className="muted">A big-picture editorial letter — structure, argument, gaps. Reads best once a few chapters are drafted.</span>
          </div>

          {drafts.length === 0 && !project.review && (
            <div className="card muted">
              No chapters are drafted yet. You can still run a review of the plan and outline, but it gets far more useful once a few chapters exist in <b>Write</b>.
            </div>
          )}

          {project.review ? (
            <DevReview review={project.review} />
          ) : (
            <div className="card center muted">No review yet. Draft a chapter or two, then run a developmental review to see how the book is holding together as a whole.</div>
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
  const [extracting, setExtracting] = useState("");   // filename being read
  const [fileErr, setFileErr] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";            // allow re-picking the same file
    if (!file) return;
    setFileErr(""); setExtracting(file.name);
    try {
      const extracted = await extractTextFromFile(file);
      setText((prev) => (prev.trim() ? prev + "\n\n" + extracted : extracted));
      if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
      // Outlines/notes usually carry structure — default the type accordingly.
      if (/outline|notes|framework|lecture|sermon/i.test(file.name)) setType("outline / framework");
    } catch (err) {
      setFileErr(String(err.message || err));
    } finally {
      setExtracting("");
    }
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="scrim" onClick={() => !working && !extracting && onClose()}>
      <div className="modal stack" onClick={(e) => e.stopPropagation()}>
        <h2>Add material</h2>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Upload a file <span className="hint" style={{ display: "inline" }}>(PDF, Word .docx, .txt, .md)</span></label>
          <span className="hint">Series outlines, lecture notes, sermon manuscripts — great for giving the book its structure.</span>
          <label className="btn btn-secondary" style={{ display: "inline-flex", cursor: extracting ? "default" : "pointer" }}>
            {extracting ? <Spin>Reading {extracting}…</Spin> : "Choose a file"}
            <input type="file" accept=".pdf,.docx,.txt,.md" onChange={handleFile} disabled={!!extracting || working} style={{ display: "none" }} />
          </label>
          {fileErr && <p className="summary" style={{ color: "var(--danger)" }}>{fileErr}</p>}
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Give it a name</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. GROW series — session outlines" disabled={working} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>What kind?</label>
          <select value={type} onChange={(e) => setType(e.target.value)} disabled={working}>
            {SOURCE_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Text {wordCount > 0 && <span className="hint" style={{ display: "inline" }}>· {wordCount.toLocaleString()} words</span>}</label>
          <span className="hint">Paste here, or upload a file above to fill this in. You can edit or trim it before adding.</span>
          <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 200 }} disabled={working || !!extracting} />
        </div>

        <div className="row">
          <button className="btn btn-primary" disabled={working || !!extracting || !text.trim()} onClick={() => onSave({ title, type, text })}>
            {working ? <Spin>{busyLabel}…</Spin> : "Add to book"}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={working || !!extracting}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
