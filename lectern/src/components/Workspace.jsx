import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import StageRail from "./StageRail.jsx";
import Collaborators from "./Collaborators.jsx";
import DraftView from "./DraftView.jsx";
import CoachPane from "./CoachPane.jsx";
import ResearchPanel from "./ResearchPanel.jsx";
import SubheadPanel from "./SubheadPanel.jsx";
import DevReview from "./DevReview.jsx";
import EditPass from "./EditPass.jsx";
import Footnotes from "./Footnotes.jsx";
import Flags from "./Flags.jsx";
import StyleSheet from "./StyleSheet.jsx";
import LaunchKit from "./LaunchKit.jsx";
import Spin from "./Spin.jsx";
import { post, ai } from "../api.js";
import { extractTextFromFile } from "../extract.js";
import { countWords, countGaps, readingTime, fmt } from "../metrics.js";
import { newFootnoteId, numberMap, insertAfterAnchor, insertAt, removeMarker, reconcile } from "../footnotes.js";
import { compileDocx, compileMarkdown, safeName } from "../compile.js";

const SOURCE_TYPES = ["walk recording", "sermon transcript", "talk / lecture", "interview", "notes / article", "outline / framework"];
const WS_TABS = ["sources", "shape", "write", "review", "style", "export", "launch", "team"];

// Pull the in-progress "draft" string out of partial (incomplete) JSON so the
// chapter can be shown as it streams. Robust to mid-stream truncation.
function extractDraftText(partial) {
  if (!partial) return "";
  const key = partial.indexOf('"draft"');
  if (key === -1) return "";
  const colon = partial.indexOf(":", key);
  const open = partial.indexOf('"', colon + 1);
  if (open === -1) return "";
  let out = "";
  for (let i = open + 1; i < partial.length; i++) {
    const ch = partial[i];
    if (ch === "\\") {
      const n = partial[i + 1];
      out += n === "n" ? "\n" : n === "t" ? "\t" : n === '"' ? '"' : n === "\\" ? "\\" : n || "";
      i++;
    } else if (ch === '"') break; // closing quote — string complete
    else out += ch;
  }
  return out;
}

// Send only the source fields the prompts use. Dropping `raw` (the uncleaned
// transcript, redundant with `text`) roughly halves the enqueue payload.
const trimForPrompt = (srcs) =>
  (srcs || []).map((s) => ({ title: s.title, type: s.type, text: s.text, summary: s.summary, stories: s.stories, chapters: s.chapters }));

export default function Workspace({ project, sources, drafts, user, initialTab, onTabChange, onReload, onSaved, onBack, onDeleted }) {
  const [tab, setTab] = useState(WS_TABS.includes(initialTab) ? initialTab : "sources");
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
  const [exporting, setExporting] = useState("");
  const [expOpts, setExpOpts] = useState({ gaps: true, breaks: true });
  const [preview, setPreview] = useState(""); // live text while a chapter streams
  const [coachSeed, setCoachSeed] = useState(null); // {marker, nonce} when a gap is clicked to discuss
  const [research, setResearch] = useState(null); // { query } when the research panel is open
  const [subheads, setSubheads] = useState(null); // suggested subheadings when the panel is open
  const [reshapeNote, setReshapeNote] = useState(""); // author's direction for reshaping the outline
  const [proposal, setProposal] = useState(null);     // { outline, gaps } awaiting accept/reject
  const [editOutline, setEditOutline] = useState(false); // hand-edit mode for the outline

  // ---- collaboration: members, roles, and per-chapter voice ----
  const members = project.members || [];
  const me = user?.id;
  const myRole = members.find((m) => m.uid === me)?.role || project.myRole || "owner";
  const isOwner = myRole === "owner";
  const ownerId = project.ownerId;
  const ownerVoice = members.find((m) => m.role === "owner")?.voiceSample || project.voiceSample || "";
  // The voice belongs to the chapter's assigned author — so an editor/ghostwriter
  // operating on someone else's chapter preserves that author's singular voice.
  const voiceFor = (ch) => {
    const aid = ch?.authorId || ownerId;
    return members.find((m) => m.uid === aid)?.voiceSample || ownerVoice;
  };
  const authorName = (uid) => {
    const m = members.find((x) => x.uid === uid);
    return m ? (m.name || m.email) : "—";
  };
  // Book-level work (shape, review, style, launch) uses the owner's voice;
  // chapter-level work uses the assigned author's voice.
  const ctx = { brief: project.brief, voiceSample: ownerVoice };
  const chapterCtx = (ch) => ({ brief: project.brief, voiceSample: voiceFor(ch) });

  // soft per-chapter lock
  const [heldBy, setHeldBy] = useState(null); // {uid,name} when someone else holds the chapter
  const hbRef = useRef(null);
  const lockedChapterRef = useRef(null);

  const run = async (label, fn, id = "") => {
    setErr(""); setBusy({ label, id });
    try { await fn(); } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy({ label: "", id: "" }); }
  };

  // Report the active tab up so the URL can reflect it (refresh stays on the tab).
  useEffect(() => { onTabChange?.(tab); }, [tab]);

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
  // Non-destructive: the AI's outline is held as a *proposal* the author reviews
  // and applies or discards — nothing overwrites the current outline until then.
  function summarizeSources() {
    const isStructural = (t) => /outline|framework|notes/i.test(t || "");
    return sources.map((s) => ({
      title: s.title, type: s.type, summary: s.summary, stories: s.stories,
      text: isStructural(s.type) ? (s.text || "").slice(0, 4000) : undefined,
    }));
  }
  async function proposeShape(instruction) {
    await run("Shaping the outline", async () => {
      const r = await ai("shape", { ...ctx, outline: project.outline, sources: summarizeSources(), instruction: instruction || undefined });
      setProposal({ outline: r.outline || [], gaps: r.gaps || [] });
    });
  }
  async function applyProposal() {
    if (!proposal) return;
    await run("Updating the outline", async () => {
      await post({ op: "updateProject", project: { ...project, outline: proposal.outline, gaps: proposal.gaps } });
      setProposal(null); setReshapeNote("");
      await onReload();
    });
  }

  // ---- direct outline editing ----
  async function saveOutline(newOutline, label = "Saving the outline") {
    await run(label, async () => {
      await post({ op: "updateProject", project: { ...project, outline: newOutline } });
      await onReload();
    });
  }
  function moveChapter(i, dir) {
    const o = [...(project.outline || [])]; const j = i + dir;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    saveOutline(o, "Reordering");
  }
  async function renameChapter(i, raw) {
    const newTitle = (raw || "").trim();
    const old = project.outline[i].chapter;
    if (!newTitle || newTitle === old) return;
    if (project.outline.some((c, k) => k !== i && c.chapter === newTitle)) {
      setErr("Another chapter already has that title — pick a different one.");
      return;
    }
    await run("Renaming the chapter", async () => {
      const o = project.outline.map((c, k) => (k === i ? { ...c, chapter: newTitle } : c));
      await post({ op: "updateProject", project: { ...project, outline: o } });
      const d = drafts.find((x) => x.chapter === old); // carry the draft to the new title
      if (d) await post({ op: "saveDraft", draft: { ...d, chapter: newTitle } });
      if (selectedChapter === old) setSelectedChapter(newTitle);
      await onReload();
    });
  }
  function savePurpose(i, purpose) {
    if ((project.outline[i].purpose || "") === (purpose || "")) return;
    const o = project.outline.map((c, k) => (k === i ? { ...c, purpose } : c));
    saveOutline(o, "Saving");
  }
  function addChapter() {
    const existing = new Set((project.outline || []).map((c) => c.chapter));
    let title = `New chapter ${(project.outline?.length || 0) + 1}`;
    while (existing.has(title)) title += " ·";
    saveOutline([...(project.outline || []), { chapter: title, purpose: "", status: "empty" }], "Adding a chapter");
  }
  async function removeChapter(i) {
    const c = project.outline[i];
    const hasDraft = drafts.some((d) => d.chapter === c.chapter);
    const msg = hasDraft
      ? `Remove "${c.chapter}" from the outline? Its draft won't be deleted, but it will no longer be linked to a chapter.`
      : `Remove "${c.chapter}" from the outline?`;
    if (!window.confirm(msg)) return;
    saveOutline(project.outline.filter((_, k) => k !== i), "Removing the chapter");
  }
  async function interview(chapter) {
    await run("Thinking of questions", async () => {
      const forChapter = sources.filter((s) => (s.chapters || []).includes(chapter.chapter));
      const r = await ai("interview", { ...chapterCtx(chapter), chapter, sources: trimForPrompt(forChapter.length ? forChapter : sources) });
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
    setPreview("");
    await run("Drafting the chapter", async () => {
      let savedDraft = null;
      try {
        const r = await ai("draft", { ...chapterCtx(chapterObj), chapter: chapterObj, sources: trimForPrompt(sourcesForChapter(chapterObj)), save: { projectId: project.id, chapter: chapterObj.chapter } }, (p) => setPreview(extractDraftText(p)));
        // The worker persists the draft server-side and returns it; only save
        // from here if it didn't.
        savedDraft = r.saved || null;
        if (!savedDraft) {
          const resp = await post({ op: "saveDraft", draft: { projectId: project.id, chapter: chapterObj.chapter, text: r.draft || "", notes: r.notes || [], version: currentDraft?.version || 0 } });
          savedDraft = resp?.draft || null;
        }
      } finally {
        setPreview("");
        // Show the saved draft immediately from the returned object (no re-fetch,
        // which can lag). Only fall back to a reload if we never got one — e.g.
        // the AI step errored but the worker may still have saved.
        if (savedDraft) onSaved?.(savedDraft);
        else await onReload();
      }
    });
  }
  async function reviseChapter() {
    if (!feedback.trim()) return;
    setPreview("");
    await run("Revising", async () => {
      let savedDraft = null;
      try {
        const r = await ai("refine", { ...chapterCtx(chapterObj), chapter: chapterObj, currentDraft: currentDraft.text, feedback, sources: trimForPrompt(sourcesForChapter(chapterObj)), save: { projectId: project.id, chapter: chapterObj.chapter } }, (p) => setPreview(extractDraftText(p)));
        savedDraft = r.saved || null;
        if (!savedDraft) {
          const resp = await post({ op: "saveDraft", draft: { ...currentDraft, text: r.draft || currentDraft.text, notes: r.notes || [] } });
          savedDraft = resp?.draft || null;
        }
        setFeedback("");
      } finally {
        setPreview("");
        if (savedDraft) onSaved?.(savedDraft);
        else await onReload();
      }
    });
  }
  async function polishChapter() {
    setPreview("");
    await run("Polishing", async () => {
      let savedDraft = null;
      try {
        const r = await ai("polish", { ...chapterCtx(chapterObj), chapter: chapterObj, currentDraft: currentDraft.text, save: { projectId: project.id, chapter: chapterObj.chapter } }, (p) => setPreview(extractDraftText(p)));
        savedDraft = r.saved || null;
        if (!savedDraft) {
          const resp = await post({ op: "saveDraft", draft: { ...currentDraft, text: r.draft || currentDraft.text, polished: true } });
          savedDraft = resp?.draft || null;
        }
      } finally {
        setPreview("");
        if (savedDraft) onSaved?.(savedDraft);
        else await onReload();
      }
    });
  }

  // Generate editor's notes on the chapter's CURRENT text (imported or written
  // by hand) — the same kind of notes the coach leaves when it drafts. Saves
  // them onto the draft so they show in the Editor's notes card.
  async function reviewChapter() {
    if (!currentDraft) return;
    await run("Reviewing", async () => {
      const r = await ai("review_notes", { ...chapterCtx(chapterObj), chapter: chapterObj, currentDraft: currentDraft.text });
      const resp = await post({ op: "saveDraft", draft: { ...currentDraft, notes: r.notes || [] } });
      if (resp?.draft) onSaved?.(resp.draft);
      else await onReload();
    });
  }

  // Resolve / reopen an editor's note, like closing a Google Docs comment.
  // Optimistic so it disappears immediately; the save persists in the background.
  function noteKey(n) {
    const note = typeof n === "string" ? n : (n.note || n.text || "");
    const anchor = typeof n === "string" ? "" : (n.anchor || "");
    return note + "\u0001" + anchor;
  }
  async function resolveNote(target, resolved) {
    if (!currentDraft) return;
    const tk = noteKey(target);
    const notes = (currentDraft.notes || []).map((n) => {
      if (noteKey(n) !== tk) return n;
      const base = typeof n === "string" ? { anchor: "", note: n } : { ...n };
      return { ...base, resolved };
    });
    const next = { ...currentDraft, notes };
    onSaved?.(next);
    try {
      const resp = await post({ op: "saveDraft", draft: next });
      if (resp?.draft) onSaved?.(resp.draft);
    } catch (e) { setErr(String(e.message || e)); await onReload(); }
  }

  // Suggest subheadings for the current chapter, then let the author place them.
  async function suggestSubheads() {
    if (!currentDraft) return;
    await run("Suggesting subheadings", async () => {
      const r = await ai("suggest_subheads", { ...chapterCtx(chapterObj), chapter: chapterObj, currentDraft: currentDraft.text });
      setSubheads((r.subheads || []).filter((s) => s && s.heading));
    });
  }
  const subheadBlock = (s) => "## " + String(s.heading || "").replace(/^#+\s*/, "").trim();
  async function insertSubhead(s) {
    if (!currentDraft || !s) return;
    const text = insertBlockAtAnchor(currentDraft.text, s.anchor, subheadBlock(s), true);
    await saveDraftObj({ ...currentDraft, text });
    setSubheads((list) => (list || []).filter((x) => x !== s));
  }
  async function insertAllSubheads() {
    if (!currentDraft || !subheads?.length) return;
    let text = currentDraft.text;
    for (const s of subheads) text = insertBlockAtAnchor(text, s.anchor, subheadBlock(s), true);
    await saveDraftObj({ ...currentDraft, text });
    setSubheads(null);
  }

  // ---- soft per-chapter lock helpers ----
  const lockChapter = (chapter) => post({ op: "lockChapter", projectId: project.id, chapter });
  const unlockChapter = (chapter) => post({ op: "unlockChapter", projectId: project.id, chapter }).catch(() => {});
  function startHeartbeat(chapter) {
    stopHeartbeat();
    hbRef.current = setInterval(() => { lockChapter(chapter).catch(() => {}); }, 45000);
  }
  function stopHeartbeat() { if (hbRef.current) { clearInterval(hbRef.current); hbRef.current = null; } }
  function releaseLock() {
    stopHeartbeat();
    if (lockedChapterRef.current) { unlockChapter(lockedChapterRef.current); lockedChapterRef.current = null; }
  }
  // Release the lock if the user navigates away mid-edit (ref avoids stale closure).
  useEffect(() => () => releaseLock(), []);

  async function beginEdit(initial) {
    if (!chapterObj) return;
    setErr("");
    try {
      const r = await lockChapter(chapterObj.chapter);
      if (!r.ok) { setHeldBy(r.lock || { name: "Someone" }); return; }
    } catch (e) { setErr(String(e.message || e)); return; }
    setHeldBy(null);
    lockedChapterRef.current = chapterObj.chapter;
    setEditText(initial);
    setEditing(true);
    startHeartbeat(chapterObj.chapter);
  }
  // ---- direct editing (type your own changes) ----
  function startEdit() { beginEdit(currentDraft?.text || ""); }
  function startBlank() { beginEdit(""); }
  function cancelEdit() { releaseLock(); setEditing(false); setEditText(""); setHeldBy(null); }
  async function saveEdit() {
    await run("Saving your edits", async () => {
      const base = currentDraft || { projectId: project.id, chapter: chapterObj.chapter, notes: [], version: 0 };
      const footnotes = reconcile(editText, base.footnotes);
      await post({ op: "saveDraft", draft: { ...base, text: editText, footnotes } });
      await onReload();
      releaseLock();
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
  // Drop an EXISTING (unplaced) footnote's marker at the cursor while editing.
  function placeFootnoteAtCursor(id) {
    const pos = editorRef.current ? editorRef.current.selectionStart : editText.length;
    setEditText((t) => insertAt(t, pos, id));
  }
  // Ask the coach where a citation belongs, then place its marker there.
  async function suggestPlacement(footnote) {
    if (!currentDraft) return;
    await run("Finding the spot", async () => {
      const r = await ai("place_citation", { draft: currentDraft.text, claim: footnote.claim, source: footnote.source });
      const anchor = (r.anchor || "").trim();
      const placed = anchor ? insertAfterAnchor(currentDraft.text, anchor, footnote.id) : null;
      if (placed) {
        const resp = await post({ op: "saveDraft", draft: { ...currentDraft, text: placed } });
        if (resp?.draft) onSaved?.(resp.draft); else await onReload();
      } else {
        setErr("I couldn't confidently find a spot for that citation. Open \u201cEdit directly,\u201d put your cursor where it belongs, and use \u201cInsert at cursor.\u201d");
      }
    });
  }

  // ---- footnotes / sources ----
  async function saveDraftObj(draft) {
    const resp = await post({ op: "saveDraft", draft });
    if (resp?.draft) onSaved?.(resp.draft);
    else await onReload();
  }

  // Locate a paragraph by a verbatim anchor quote and insert a block before or
  // after it. Punctuation/quote/markdown tolerant; appends on a miss.
  function normAnchor(s) {
    return String(s || "")
      .replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'")
      .toLowerCase()
      .replace(/[*_`#>()"'.,;:!?\u2014\u2013-]/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  function insertBlockAtAnchor(text, anchor, block, before) {
    const a = normAnchor(anchor);
    const blocks = String(text || "").split(/\n{2,}/);
    let bi = a ? blocks.findIndex((b) => normAnchor(b).includes(a)) : -1;
    if (bi === -1 && a) {
      const short = a.split(" ").slice(0, 6).join(" ");
      if (short.length > 12) bi = blocks.findIndex((b) => normAnchor(b).includes(short));
    }
    if (bi === -1) return String(text || "").trimEnd() + "\n\n" + block; // fallback: append
    const at = before ? bi : bi + 1;
    return [...blocks.slice(0, at), block, ...blocks.slice(at)].join("\n\n");
  }
  // Insert a passage the author accepted from the coach. If it came from a
  // specific [GAP: …] marker, replace that marker in place; otherwise append.
  // Nothing is written unless the author clicked to accept it.
  async function insertCoachPassage(passage, gapMarker, anchor) {
    if (!currentDraft || !passage) return;
    let text = currentDraft.text || "";
    if (gapMarker && text.includes(gapMarker)) {
      text = text.replace(gapMarker, passage);          // fill a [GAP: …]
    } else if (anchor && anchor.trim()) {
      text = insertBlockAtAnchor(text, anchor, passage, false); // after the note's passage
    } else {
      text = text.trimEnd() + "\n\n" + passage;         // no target: append
    }
    await saveDraftObj({ ...currentDraft, text });
  }
  async function formatChicago(raw) {
    try {
      const r = await ai("format_citation", { raw });
      return (r && r.citation) || raw;
    } catch {
      return raw;
    }
  }
  // Pull a source found via web research into the citation engine. It's added as
  // an unplaced footnote (it shows under Footnotes to position in the text) — we
  // don't guess where in the draft it belongs.
  async function addResearchedSource(source) {
    if (!currentDraft || !source) return;
    await run("Adding the source", async () => {
      const id = newFootnoteId();
      let citation = (source.citation || "").trim();
      if (!citation) {
        const raw = [source.author, source.title, source.publisher, source.date, source.url].filter(Boolean).join(". ");
        citation = await formatChicago(raw);
      }
      const footnotes = [...(currentDraft.footnotes || []), { id, source: citation, claim: source.supports || source.title || "" }];
      const resp = await post({ op: "saveDraft", draft: { ...currentDraft, footnotes } });
      if (resp?.draft) onSaved?.(resp.draft);
      else await onReload();
    });
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

  // ---- compile / export ----
  function downloadBlob(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  async function exportDocx() {
    setErr("");
    setExporting("docx");
    try {
      const blob = await compileDocx({ project, drafts, options: { includeGaps: expOpts.gaps, pageBreaks: expOpts.breaks } });
      downloadBlob(`${safeName(project.title)}.docx`, blob);
    } catch (e) {
      setErr("Couldn't build the Word document: " + (e?.message || e));
    } finally {
      setExporting("");
    }
  }
  function exportMarkdown() {
    setErr("");
    try {
      const md = compileMarkdown({ project, drafts, options: { includeGaps: expOpts.gaps } });
      downloadBlob(`${safeName(project.title)}.md`, md, "text/markdown");
    } catch (e) {
      setErr("Couldn't build the Markdown file: " + (e?.message || e));
    }
  }

  // ---- style sheet ----
  const seId = () => "se_" + Math.random().toString(36).slice(2, 9);
  async function buildStyleSheet() {
    await run("Building the style sheet", async () => {
      const chapters = (project.outline || []).map((c) => ({
        chapter: c.chapter,
        text: drafts.find((d) => d.chapter === c.chapter)?.text || "",
      }));
      const r = await ai("style_sheet", { ...ctx, chapters, guide: project.styleGuide || "Chicago Manual of Style" });
      const existing = project.styleSheet?.entries || [];
      const have = new Set(existing.map((e) => (e.term || "").trim().toLowerCase()));
      const fresh = (r.entries || [])
        .filter((e) => e.term && !have.has(e.term.trim().toLowerCase()))
        .map((e) => ({ id: seId(), term: e.term || "", ruling: e.ruling || "", category: e.category || "term" }));
      const styleSheet = {
        ...(project.styleSheet || {}),
        summary: r.summary || "",
        entries: [...existing, ...fresh],
        inconsistencies: r.inconsistencies || [],
        updatedAt: new Date().toISOString(),
      };
      await post({ op: "updateProject", project: { ...project, styleSheet } });
      await onReload();
    });
  }
  async function saveStyleSheet(next) {
    await run("Saving the style sheet", async () => {
      await post({ op: "updateProject", project: { ...project, styleSheet: { ...next, updatedAt: new Date().toISOString() } } });
      await onReload();
    });
  }

  // ---- launch kit ----
  async function generateLaunchKit() {
    await run("Writing the launch kit", async () => {
      const r = await ai("launch_kit", { ...ctx, title: project.title, outline: project.outline });
      await post({ op: "updateProject", project: { ...project, launchKit: { ...r, generatedAt: new Date().toISOString() } } });
      await onReload();
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
        ...chapterCtx(chapterObj),
        level,
        chapter: chapterObj,
        currentDraft: currentDraft.text,
        styleGuide: project.styleGuide || "Chicago Manual of Style",
        styleSheet: project.styleSheet?.entries || [],
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
  async function archiveBook() {
    await run("Archiving", async () => {
      await post({ op: "archiveProject", id: project.id, archived: true });
      onDeleted(); // return to the library, where it now lives under Archived
    });
  }

  // ---- collaborators ----
  async function inviteMember(email, role) {
    await run("Sending the invite", async () => {
      await post({ op: "inviteMember", projectId: project.id, email, role });
      await onReload();
    });
  }
  async function removeMember(uid) {
    await run("Removing collaborator", async () => {
      await post({ op: "removeMember", projectId: project.id, uid });
      await onReload();
    });
  }
  async function changeRole(uid, role) {
    await run("Updating role", async () => {
      await post({ op: "updateRole", projectId: project.id, uid, role });
      await onReload();
    });
  }
  async function saveVoice(uid, voiceSample) {
    await run("Saving voice", async () => {
      await post({ op: "setVoice", projectId: project.id, uid, voiceSample });
      await onReload();
    });
  }
  async function assignChapter(chapter, authorId) {
    await run("Assigning the chapter", async () => {
      await post({ op: "assignChapter", projectId: project.id, chapter, authorId });
      await onReload();
    });
  }

  return (
    <div className="workspace-wide">
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
        <button className={`tab ${tab === "style" ? "on" : ""}`} onClick={() => setTab("style")}>Style</button>
        <button className={`tab ${tab === "export" ? "on" : ""}`} onClick={() => setTab("export")}>Export</button>
        <button className={`tab ${tab === "launch" ? "on" : ""}`} onClick={() => setTab("launch")}>Launch</button>
        <button className={`tab ${tab === "team" ? "on" : ""}`} onClick={() => setTab("team")}>Team{members.length > 1 ? ` (${members.length})` : ""}</button>
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
          {!proposal && (
            <div className="card stack">
              <div>
                <label style={{ fontWeight: 600, margin: 0 }}>Shape the book</label>
                <span className="hint">
                  Tell the coach how the structure should change — "merge the two leadership chapters," "add a chapter on funding," "make it more pastoral, less academic" — or leave it blank to let it suggest from your material. You'll see the proposed outline and can apply or discard it. Nothing changes until you apply.
                </span>
              </div>
              <textarea
                className="textarea"
                value={reshapeNote}
                onChange={(e) => setReshapeNote(e.target.value)}
                placeholder="Optional: how should the outline change?"
                style={{ minHeight: 80 }}
                disabled={working}
              />
              <div className="row">
                <button className="btn btn-primary" onClick={() => proposeShape(reshapeNote)} disabled={working}>
                  {working && busy.label.startsWith("Shaping")
                    ? <Spin>Shaping…</Spin>
                    : project.outline?.length ? "Propose a reshaped outline" : "Suggest an outline"}
                </button>
                {project.outline?.length > 0 && (
                  <button className="btn btn-secondary" onClick={() => setEditOutline((v) => !v)} disabled={working}>
                    {editOutline ? "Done editing" : "✎ Edit outline by hand"}
                  </button>
                )}
                <span className="muted">Builds the chapter shape from what you've filed.</span>
              </div>
            </div>
          )}

          {proposal && (
            <div className="card stack" style={{ borderColor: "var(--pine-soft)" }}>
              <div className="row">
                <h3 style={{ margin: 0 }}>Proposed outline</h3>
                <span className="spacer" />
                <span className="muted" style={{ fontSize: "0.85rem" }}>{proposal.outline.length} chapters · nothing saved yet</span>
              </div>
              {(() => {
                const newTitles = new Set(proposal.outline.map((c) => c.chapter));
                const dropped = (project.outline || [])
                  .filter((c) => !newTitles.has(c.chapter) && drafts.some((d) => d.chapter === c.chapter))
                  .map((c) => c.chapter);
                return dropped.length ? (
                  <div className="banner" style={{ background: "var(--brass-soft, #f3e9d2)", border: "1px solid var(--brass)" }}>
                    Heads up: {dropped.length === 1 ? "this chapter has a draft" : "these chapters have drafts"} and {dropped.length === 1 ? "isn't" : "aren't"} in the new outline. The draft{dropped.length > 1 ? "s" : ""} won't be deleted, but {dropped.length > 1 ? "they" : "it"} will no longer be linked to a chapter: <b>{dropped.join(", ")}</b>.
                  </div>
                ) : null;
              })()}
              {proposal.outline.map((c, i) => (
                <div key={i} className="outline-item" style={{ paddingBottom: "0.6rem", borderBottom: "1px solid var(--line)" }}>
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0 }}>{c.chapter}</h3>
                    {c.purpose && <p className="purpose">{c.purpose}</p>}
                  </div>
                  {c.status && <span className={`status ${c.status}`}>{c.status}</span>}
                </div>
              ))}
              {proposal.gaps?.length > 0 && (
                <div>
                  <b style={{ fontSize: "0.9rem" }}>Still missing:</b>
                  <ul className="note-list">{proposal.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                </div>
              )}
              <div className="row">
                <button className="btn btn-primary" onClick={applyProposal} disabled={working}>
                  {working && busy.label.startsWith("Updating") ? <Spin>Applying…</Spin> : "Apply this outline"}
                </button>
                <button className="btn btn-ghost" onClick={() => proposeShape(reshapeNote)} disabled={working}>Try again</button>
                <button className="btn btn-ghost" onClick={() => setProposal(null)} disabled={working}>Discard</button>
              </div>
            </div>
          )}

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

          {(project.outline || []).map((c, i) => {
            const d = drafts.find((x) => x.chapter === c.chapter);
            return editOutline ? (
              <div key={i} className="card">
                <div className="outline-item">
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  <div style={{ flex: 1 }}>
                    <input
                      className="input"
                      defaultValue={c.chapter}
                      onBlur={(e) => renameChapter(i, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      disabled={working}
                      style={{ fontFamily: "var(--display)", fontSize: "1.1rem", marginBottom: "0.45rem" }}
                    />
                    <textarea
                      className="textarea"
                      defaultValue={c.purpose || ""}
                      onBlur={(e) => savePurpose(i, e.target.value)}
                      placeholder="What does this chapter do for the reader?"
                      disabled={working}
                      style={{ minHeight: 54, fontSize: "0.95rem" }}
                    />
                  </div>
                  <div className="stack" style={{ minWidth: 44, gap: "0.3rem", textAlign: "center" }}>
                    <button className="btn btn-ghost" onClick={() => moveChapter(i, -1)} disabled={working || i === 0} title="Move up">↑</button>
                    <button className="btn btn-ghost" onClick={() => moveChapter(i, 1)} disabled={working || i === project.outline.length - 1} title="Move down">↓</button>
                    <button className="btn btn-ghost" onClick={() => removeChapter(i)} disabled={working} title="Remove chapter" style={{ color: "var(--danger)" }}>✕</button>
                  </div>
                </div>
              </div>
            ) : (
              <div key={i} className="card">
                <div className="outline-item">
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  <div style={{ flex: 1 }}>
                    <h3>{c.chapter}</h3>
                    {c.purpose && <p className="purpose">{c.purpose}</p>}
                    {c.coveredBy?.length > 0 && <p className="purpose">Drawn from: {c.coveredBy.join(", ")}</p>}
                    {d && (
                      <p className="purpose" style={{ color: "var(--pine)", fontWeight: 500 }}>
                        {fmt(d.words || 0)} words · ~{readingTime(d.words || 0)} min
                        {countGaps(d.text) > 0 ? ` · ${countGaps(d.text)} gap(s) left` : " · no open gaps"}
                        {d.polished ? " · polished" : ""}
                      </p>
                    )}
                    {interviewQs[c.chapter] && (
                      <ul className="questions">
                        {interviewQs[c.chapter].map((q, j) => (
                          <QuestionItem key={j} question={q} chapter={c.chapter} onAnswer={answerQuestion} working={working} />
                        ))}
                      </ul>
                    )}
                  </div>
                  {d
                    ? <span className="status ready" title="This chapter has a draft you can keep working on">drafted</span>
                    : (c.status && <span className={`status ${c.status}`}>{c.status}</span>)}
                </div>
                <div className="row" style={{ marginTop: "0.8rem" }}>
                  <button className="btn btn-ghost" onClick={() => interview(c)} disabled={working}>
                    {busy.id === c.chapter ? <Spin>Thinking…</Spin> : "Interview me on this →"}
                  </button>
                  {d
                    ? <button className="btn btn-primary" onClick={() => { setSelectedChapter(c.chapter); setTab("write"); }} disabled={working}>Open the draft →</button>
                    : <button className="btn btn-secondary" onClick={() => { setSelectedChapter(c.chapter); setTab("write"); }} disabled={working}>Write this →</button>}
                </div>
              </div>
            );
          })}

          {editOutline && (
            <button className="btn btn-secondary" onClick={addChapter} disabled={working}>+ Add a chapter</button>
          )}

          {project.gaps?.length > 0 && (
            <div className="card">
              <h3>Still missing</h3>
              <p className="muted" style={{ marginTop: 0 }}>Things the book promises but the material doesn't cover yet — good fodder for your next walk.</p>
              <ul className="note-list">{project.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </div>
          )}

          <div className="row" style={{ marginTop: "2rem" }}>
            <span className="spacer" />
            {isOwner && <button className="btn btn-secondary" onClick={archiveBook} disabled={working}>Archive this book</button>}
            {isOwner && <button className="btn btn-danger" onClick={deleteBook} disabled={working}>Delete this book</button>}
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
                  {project.outline.map((c, i) => <option key={c.chapter} value={c.chapter}>{i + 1}. {c.chapter}{drafts.some((d) => d.chapter === c.chapter) ? " ✓" : ""}</option>)}
                </select>
              </div>

              {chapterObj && (
                <div className="row" style={{ gap: "0.6rem", alignItems: "center", fontSize: "0.9rem" }}>
                  <span className="muted">Voice:</span>
                  {(isOwner || myRole === "author") ? (
                    <select
                      value={chapterObj.authorId || ownerId}
                      onChange={(e) => assignChapter(chapterObj.chapter, e.target.value)}
                      disabled={working || editing}
                      style={{ padding: "0.25rem 0.5rem", borderRadius: 8, border: "1px solid var(--line-strong)", background: "var(--surface)", font: "inherit" }}
                    >
                      {members.filter((m) => m.role === "owner" || m.role === "author").map((m) => (
                        <option key={m.uid} value={m.uid}>{m.name || m.email}{m.uid === ownerId ? " (owner)" : ""}</option>
                      ))}
                    </select>
                  ) : (
                    <b>{authorName(chapterObj.authorId || ownerId)}</b>
                  )}
                  <span className="muted" style={{ fontSize: "0.82rem" }}>— this chapter is drafted and edited in this author's voice.</span>
                </div>
              )}

              {heldBy && !editing && (
                <div className="banner" style={{ background: "var(--brass-soft, #f3e9d2)", border: "1px solid var(--brass)" }}>
                  <b>{heldBy.name || "Someone"}</b> is editing this chapter right now. You can read it, but hold off on editing until they're done (the lock clears automatically if they step away).
                </div>
              )}

              {preview && working && (
                <div className="card stack">
                  <div className="row">
                    <label style={{ fontWeight: 600, margin: 0 }}><Spin>{busy.label}…</Spin></label>
                    <span className="spacer" />
                    <span className="muted" style={{ fontSize: "0.85rem" }}>{fmt(countWords(preview))} words so far</span>
                  </div>
                  <div style={{ minHeight: 200, maxHeight: 460, overflowY: "auto", fontFamily: "var(--display)", fontSize: "1.08rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {preview}<span style={{ opacity: 0.5 }}>▍</span>
                  </div>
                  <span className="hint">Writing in {authorName(chapterObj?.authorId || ownerId)}'s voice — this updates live and saves when it's finished.</span>
                </div>
              )}

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
                  {(currentDraft?.footnotes || []).filter((f) => !editText.includes(`[^${f.id}]`)).length > 0 && (
                    <div className="unplaced-strip">
                      <span className="hint" style={{ display: "block", marginBottom: "0.4rem" }}>Unplaced sources — put your cursor where each belongs, then insert its marker:</span>
                      {(currentDraft.footnotes || []).filter((f) => !editText.includes(`[^${f.id}]`)).map((f) => (
                        <div className="unplaced-row" key={f.id}>
                          <span className="unplaced-src">{f.source ? (f.source.length > 80 ? f.source.slice(0, 80) + "…" : f.source) : <em className="muted">source not added yet</em>}</span>
                          <button className="btn btn-secondary" style={{ padding: "0.2rem 0.65rem", fontSize: "0.82rem", whiteSpace: "nowrap" }} onClick={() => placeFootnoteAtCursor(f.id)} disabled={working}>Insert at cursor</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="row">
                    <button className="btn btn-primary" onClick={saveEdit} disabled={working}>
                      {working ? <Spin>Saving…</Spin> : "Save edits"}
                    </button>
                    <button className="btn btn-secondary" onClick={insertFootnoteAtCursor} disabled={working}>Insert footnote at cursor</button>
                    <button className="btn btn-ghost" onClick={cancelEdit} disabled={working}>Cancel</button>
                  </div>
                </div>
              ) : !currentDraft ? (
                <div className="card stack">
                  <div>
                    <h3 style={{ margin: 0 }}>Start "{chapterObj.chapter}"</h3>
                    <span className="hint">Two ways to begin — you can always switch later, and the coach is here either way.</span>
                  </div>
                  <div className="write-start">
                    <div className="start-option">
                      <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={draftChapter} disabled={working}>
                        {working ? <Spin>{busy.label}…</Spin> : `Draft it in ${authorName(chapterObj.authorId || ownerId)}'s voice`}
                      </button>
                      <span className="hint">The coach drafts from your filed material and leaves a visible [GAP] note wherever it needs more from you.</span>
                    </div>
                    <div className="start-option">
                      <button className="btn btn-secondary btn-lg" style={{ width: "100%" }} onClick={startBlank} disabled={working}>Write it from scratch</button>
                      <span className="hint">Start with a blank page and type it yourself. You can bring in the coach whenever you want a hand.</span>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="write-split">
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
                        <button className="btn btn-secondary" onClick={reviewChapter} disabled={working}>
                          {working && busy.label === "Reviewing" ? <Spin>Reviewing…</Spin> : (currentDraft.notes?.length ? "Refresh notes" : "Get editor's notes")}
                        </button>
                        <button className="btn btn-secondary" onClick={suggestSubheads} disabled={working}>
                          {working && busy.label === "Suggesting subheadings" ? <Spin>Thinking…</Spin> : "Suggest subheadings"}
                        </button>
                        <button className="btn btn-secondary" onClick={startEdit} disabled={working}>✎ Edit directly</button>
                      </div>
                      <DraftView
                        text={currentDraft.text}
                        footnotes={currentDraft.footnotes}
                        notes={currentDraft.notes}
                        onGapClick={(marker) => setCoachSeed({ text: marker.replace(/^\[GAP:\s*/, "").replace(/\]$/, "").trim(), marker, nonce: Date.now() })}
                        onDiscussNote={(note) => setCoachSeed({ text: note.note, anchor: note.anchor || "", nonce: Date.now() })}
                        onResearchNote={(t) => setResearch({ query: t })}
                        onResolveNote={resolveNote}
                      />
                    </div>
                    <CoachPane
                      projectId={project.id}
                      chapter={chapterObj.chapter}
                      authorName={authorName(chapterObj.authorId || ownerId)}
                      brief={project.brief}
                      voiceSample={voiceFor(chapterObj)}
                      draft={currentDraft.text}
                      notes={(currentDraft.notes || []).map((n) => (typeof n === "string" ? n : n.note || n.text || "")).filter(Boolean)}
                      working={working}
                      onInsert={insertCoachPassage}
                      seed={coachSeed}
                    />
                  </div>

                  <Footnotes
                    footnotes={currentDraft.footnotes || []}
                    nums={numberMap(currentDraft.text)}
                    working={working}
                    onUpdate={updateFootnote}
                    onRemove={removeFootnote}
                    onFormat={formatChicago}
                    onSuggestPlace={suggestPlacement}
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
                      <button className="btn btn-ghost" onClick={draftChapter} disabled={working}>Re-draft this chapter</button>
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

      {tab === "style" && (
        <StyleSheet
          sheet={project.styleSheet}
          working={working}
          building={working && busy.label === "Building the style sheet"}
          hasDrafts={drafts.length > 0}
          onBuild={buildStyleSheet}
          onSave={saveStyleSheet}
        />
      )}

      {tab === "team" && (
        <Collaborators
          members={members}
          me={me}
          isOwner={isOwner}
          ownerId={ownerId}
          working={working}
          onInvite={inviteMember}
          onRemove={removeMember}
          onChangeRole={changeRole}
          onSaveVoice={saveVoice}
        />
      )}

      {tab === "launch" && (
        <LaunchKit
          kit={project.launchKit}
          working={working}
          generating={working && busy.label === "Writing the launch kit"}
          hasDrafts={drafts.length > 0}
          onGenerate={generateLaunchKit}
        />
      )}

      {tab === "export" && (() => {
        const outline = project.outline || [];
        const byChapter = Object.fromEntries(drafts.map((d) => [d.chapter, d]));
        const draftedCount = outline.filter((c) => byChapter[c.chapter]?.text).length;
        const totalWords = drafts.reduce((s, d) => s + (d.words || 0), 0);
        const noteCount = drafts.reduce((s, d) => s + (d.footnotes || []).length, 0);
        const openFlags = drafts.reduce((s, d) => s + (d.flags || []).filter((f) => f.status === "open").length, 0);
        return (
          <div className="stack">
            <div className="card stack">
              <div>
                <h3 style={{ margin: "0 0 0.2rem" }}>Compile the manuscript</h3>
                <span className="hint">Stitches every chapter, in order, into one document — with your footnotes rendered as real, numbered notes.</span>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {outline.length} chapters · {draftedCount} drafted · {fmt(totalWords)} words · {noteCount} footnote{noteCount === 1 ? "" : "s"}
                {openFlags > 0 && <span style={{ color: "var(--brass)" }}> · {openFlags} claim{openFlags === 1 ? "" : "s"} still unverified</span>}
              </p>

              <div className="stack" style={{ gap: "0.4rem" }}>
                <label className="row" style={{ gap: "0.5rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={expOpts.gaps} onChange={(e) => setExpOpts((o) => ({ ...o, gaps: e.target.checked }))} />
                  <span>Include unfilled <span className="gap">[GAP: …]</span> notes (so you can see what's still missing)</span>
                </label>
                <label className="row" style={{ gap: "0.5rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={expOpts.breaks} onChange={(e) => setExpOpts((o) => ({ ...o, breaks: e.target.checked }))} />
                  <span>Start each chapter on a new page</span>
                </label>
              </div>

              <div className="row">
                <button className="btn btn-primary" onClick={exportDocx} disabled={!!exporting || draftedCount === 0}>
                  {exporting === "docx" ? <Spin>Building…</Spin> : "Compile to Word (.docx)"}
                </button>
                <button className="btn btn-secondary" onClick={exportMarkdown} disabled={draftedCount === 0}>Download Markdown (.md)</button>
              </div>
              {draftedCount === 0 && <span className="muted" style={{ fontSize: "0.85rem" }}>Draft at least one chapter first.</span>}
            </div>

            <div className="card muted" style={{ fontSize: "0.88rem" }}>
              The Word file uses native footnotes numbered across the whole book, so Word can renumber or convert them to endnotes in one click. Chapters without a draft appear as a heading marked “not yet drafted,” and any source you haven't filled in shows as “[source needed].” This is a clean handoff for design and layout — Lectern's job ends at a structurally sound, sourced manuscript.
            </div>
          </div>
        );
      })()}

      {adding && <AddSource onSave={addSource} onClose={() => setAdding(false)} working={working} busyLabel={busy.label} />}
      {subheads && (
        <SubheadPanel
          subheads={subheads}
          working={working}
          onInsert={insertSubhead}
          onInsertAll={insertAllSubheads}
          onClose={() => setSubheads(null)}
        />
      )}
      {research && (
        <ResearchPanel
          query={research.query}
          brief={project.brief}
          chapterTitle={chapterObj?.chapter}
          working={working}
          onAddSource={addResearchedSource}
          onClose={() => setResearch(null)}
        />
      )}
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

  return createPortal(
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
    </div>,
    document.body
  );
}
