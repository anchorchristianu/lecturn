import { useState, useEffect, useRef } from "react";
import { ai, post } from "../api.js";

// Pull a ⟦DRAFT⟧…⟦/DRAFT⟧ passage out of an assistant message, if present.
function splitDraft(text) {
  const m = text.match(/⟦DRAFT⟧([\s\S]*?)⟦\/DRAFT⟧/);
  if (!m) return { prose: text, passage: null };
  return { prose: text.replace(m[0], "").trim(), passage: m[1].trim() };
}

// A single coaching conversation for the selected chapter. It talks to the same
// AI pipeline as everything else (`ai("discuss", …)` → background worker →
// per-user key + usage), persists the thread per chapter, and never inserts
// anything into the draft on its own — the author clicks to accept a passage.
export default function CoachPane({
  projectId, chapter, authorName, brief, voiceSample, draft, notes, working, onInsert, seed,
}) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [activeGap, setActiveGap] = useState(null);
  const [insertAnchor, setInsertAnchor] = useState(null);
  const [added, setAdded] = useState(() => new Set());
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const lastSeed = useRef(null);

  // Load the saved thread whenever the chapter changes.
  useEffect(() => {
    let alive = true;
    setErr(""); setStreaming(""); setActiveGap(null); setInsertAnchor(null); setMessages([]); setAdded(new Set());
    (async () => {
      try {
        const r = await post({ op: "getThread", projectId, chapter });
        if (alive) setMessages(Array.isArray(r.messages) ? r.messages : []);
      } catch { if (alive) setMessages([]); }
    })();
    return () => { alive = false; };
  }, [projectId, chapter]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, busy]);

  // React to a gap or an editor's note being sent over (parent bumps seed.nonce).
  useEffect(() => {
    if (seed && seed.nonce && seed.nonce !== lastSeed.current && !busy) {
      lastSeed.current = seed.nonce;
      const topic = seed.text || String(seed.marker || "").replace(/^\[GAP:\s*/, "").replace(/\]$/, "").trim();
      setActiveGap(seed.marker || null);
      setInsertAnchor(seed.anchor || null);
      send(`Let's work on this editor's note:\n\n"${topic}"\n\nHelp me figure out what to do about it — ask me what you need to know.`);
    }
  }, [seed, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next) {
    try { await post({ op: "saveThread", projectId, chapter, messages: next }); } catch { /* non-fatal */ }
  }

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setErr(""); setInput(""); grow();
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setBusy(true); setStreaming("");
    try {
      const r = await ai(
        "discuss",
        { chapter, authorName, brief, voiceSample, draft, notes, messages: next.slice(-24) },
        (partial) => setStreaming(typeof partial === "string" ? partial : "")
      );
      const reply = (r && typeof r.text === "string" && r.text.trim())
        || "Sorry — I didn't catch that. Could you say it another way?";
      const withReply = [...next, { role: "assistant", content: reply }];
      setMessages(withReply);
      persist(withReply);
    } catch {
      setErr("The coach couldn't be reached just now. Give it another try in a moment.");
      persist(next); // keep the author's turn so they can retry
    } finally {
      setBusy(false); setStreaming("");
    }
  }

  function grow() {
    const el = taRef.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 130) + "px"; }
  }

  async function insert(passage) {
    if (!onInsert || working) return;
    await onInsert(passage, activeGap, insertAnchor);
    setActiveGap(null);
    setInsertAnchor(null);
    setAdded((s) => { const n = new Set(s); n.add(passage); return n; });
  }

  // A passage counts as added once it's in the draft (survives reloads) or was
  // just inserted this session.
  const normText = (s) => String(s || "").replace(/\s+/g, " ").trim();
  function isAdded(passage) {
    if (added.has(passage)) return true;
    return !!draft && normText(draft).includes(normText(passage));
  }

  const empty = messages.length === 0 && !busy && !streaming;

  return (
    <div className="coach-pane">
      <div className="coach-head">
        <div className="coach-title">Writing coach</div>
        <div className="coach-grounded">
          Works from <b>this chapter</b>, <b>{authorName || "your"} voice</b>, and the editor's notes.
          It draws material out of you — it won't invent facts, stats, or stories.
        </div>
      </div>

      <div className="coach-msgs" ref={scrollRef}>
        {empty && (
          <div className="coach-msg a">
            {`Hi${authorName ? " " + authorName : ""} — I can help you fill in this chapter using your own experience, in your own voice. Click an editor's note on the left to work on it together, or tell me what's on your mind. If you'd rather not stare at a blank page, just say so and I'll suggest a few directions.`}
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === "user") return <div className="coach-msg u" key={i}>{m.content}</div>;
          const { prose, passage } = splitDraft(m.content);
          return (
            <div key={i}>
              {prose && <div className="coach-msg a">{prose}</div>}
              {passage && (
                <div className="coach-msg a">
                  <div className={"coach-draftblock" + (isAdded(passage) ? " added" : "")}>
                    <div className="dh">Draft passage · in {authorName || "your"} voice</div>
                    <div className="dt">{passage}</div>
                    {isAdded(passage)
                      ? <div className="coach-added">✓ Added to the draft</div>
                      : <button className="btn btn-primary" style={{ marginTop: "0.55rem", padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                          onClick={() => insert(passage)} disabled={working}>
                          {activeGap ? "Use this in the draft" : "Add this to the draft"}
                        </button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {busy && (
          streaming
            ? <div className="coach-msg a">{splitDraft(streaming).prose}<span style={{ opacity: 0.5 }}>▍</span></div>
            : <div className="coach-typing"><span className="d" /><span className="d" /><span className="d" /> coaching…</div>
        )}
      </div>

      {err && <div className="coach-err">{err}</div>}

      <div className="coach-composer">
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          placeholder="Tell the coach what you're thinking…"
          onChange={(e) => { setInput(e.target.value); grow(); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={busy}
        />
        <button className="btn btn-primary" onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
      </div>
    </div>
  );
}
