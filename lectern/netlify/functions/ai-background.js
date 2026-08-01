// netlify/functions/ai-background.js
// The "-background" suffix makes this a Netlify Background Function: it returns
// 202 immediately and may run up to 15 minutes — long enough for any AI step.
//
// IMPORTANT: background functions are invoked ASYNCHRONOUSLY, which caps the
// request payload at 256KB. So the client does NOT send the (large) job input
// here — it stores the input via the 6MB sync endpoint and triggers this worker
// with only { jobId }. We read the input from the jobs store, run the model, and
// write the result back for the client to poll (job.js).

import { ACTIONS } from "./lib/prompts.js";
import { getUser } from "./lib/session.js";
import {
  getJob, putJob, addUsage, getUserByEmail,
  getProjectById, memberRole, getLock, getDraftByChapter, persistDraft,
} from "./lib/store.js";
import { resolveUserKey } from "./lib/keys.js";

// Drafting actions produce a chapter we must persist server-side (see below).
const DRAFTING = new Set(["draft", "refine", "polish"]);

// Persist a finished drafting result to the drafts store, using the SAME helper
// the sync save uses. This is what makes a completed chapter durable regardless
// of whether the client is still polling: even if the browser timed out or
// closed, the chapter is saved and shows up on the next load. Returns the saved
// draft, or null if nothing was persisted (bad input / no access / locked by
// someone else / worker couldn't match the chapter).
async function persistDrafting(uid, action, payload, result) {
  try {
    if (!DRAFTING.has(action)) return null;
    const draftText = result && typeof result.draft === "string" ? result.draft.trim() : "";
    if (!draftText) return null;
    const save = (payload && payload.save) || {};
    const { projectId, chapter } = save;
    if (!projectId || !chapter) return null;

    // Access control: only persist for a real member of this project.
    const project = await getProjectById(projectId);
    if (!project || !memberRole(project, uid)) return null;

    // Respect a soft edit lock held by someone else (mirrors the sync save).
    const held = await getLock(projectId, chapter);
    if (held && held.uid !== uid) return null;

    const existing = await getDraftByChapter(projectId, chapter);

    if (action === "draft") {
      // A fresh draft replaces the chapter text and notes; footnotes/flags reset
      // (same semantics as the old client save, which did not carry them over).
      return await persistDraft({
        projectId, chapter,
        text: result.draft, notes: result.notes || [],
        version: existing?.version || 0,
      });
    }
    // refine / polish preserve the existing draft's footnotes/flags/id and only
    // swap the text (+ notes for refine, +polished for polish).
    const base = existing || { projectId, chapter };
    return await persistDraft({
      ...base,
      text: result.draft || existing?.text || "",
      notes: action === "refine" ? (result.notes || []) : base.notes,
      polished: action === "polish" ? true : base.polished,
    });
  } catch {
    return null; // non-fatal: the client fallback save still runs
  }
}

const MODELS = {
  main: process.env.MODEL_MAIN || "claude-sonnet-4-6",
  sort: process.env.MODEL_SORT || "claude-haiku-4-5",
};

// Turn an Anthropic error type into something a non-technical author can act on.
function friendlyApiError(type, status, raw) {
  if (type === "rate_limit_error" || status === 429)
    return "The AI service is rate-limiting this account's API key. Wait a minute and try again — if it keeps happening, this key may be on a low usage tier.";
  if (type === "overloaded_error" || status === 529)
    return "The AI service is temporarily overloaded. Please try again in a moment.";
  if (/credit|billing|quota/i.test(raw || ""))
    return "This Anthropic API key can't be charged right now (out of credit or billing issue). Check the key's account.";
  if (type === "authentication_error" || status === 401)
    return "The Anthropic API key was rejected. Check the key set for this account.";
  return `The AI service returned an error${status ? ` (${status})` : ""}. Please try again.`;
}

async function oneCall({ system, messages, model, maxTokens, tools }, apiKey, onPartial) {
  const systemBlocks = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODELS[model] || MODELS.main, max_tokens: maxTokens, system: systemBlocks, messages, stream: true, ...(tools ? { tools } : {}) }),
  });
  if (!res.ok) {
    const raw = await res.text();
    let type; try { type = JSON.parse(raw)?.error?.type; } catch {}
    const e = new Error(friendlyApiError(type, res.status, raw));
    e.transient = res.status === 529 || res.status === 500 || res.status === 503;
    throw e;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = {};
  let lastEmit = 0;
  let stopReason = null;
  let sawStop = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // keep the trailing partial line
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const data = s.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let evt;
      try { evt = JSON.parse(data); } catch { continue; }
      if (evt.type === "error") {
        // A mid-stream error (overloaded, rate limit, etc). Previously this was
        // ignored, so the draft just stopped and never saved. Surface it.
        const type = evt.error?.type;
        const e = new Error(friendlyApiError(type, null, evt.error?.message));
        e.transient = type === "overloaded_error" || type === "api_error";
        throw e;
      } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        text += evt.delta.text;
        const now = Date.now();
        if (onPartial && now - lastEmit > 900) { lastEmit = now; await onPartial(text); }
      } else if (evt.type === "message_start" && evt.message?.usage) {
        usage = { ...usage, ...evt.message.usage };
      } else if (evt.type === "message_delta") {
        if (evt.usage) usage = { ...usage, ...evt.usage };
        if (evt.delta?.stop_reason) { stopReason = evt.delta.stop_reason; sawStop = true; }
      } else if (evt.type === "message_stop") {
        sawStop = true;
      }
    }
  }

  // The model hit the output length limit before finishing. For our JSON actions
  // this means truncated, unparseable output — which is exactly the "streams,
  // stops, never saves" symptom. Fail loudly instead of silently.
  if (stopReason === "max_tokens") {
    throw new Error("The draft reached the length limit before it finished, so it couldn't be saved. Try drafting this chapter in smaller sections, or trim the source material feeding it.");
  }
  // The stream ended without a proper completion signal — the connection dropped
  // mid-response. Retry rather than save a half-finished, unparseable draft.
  if (!sawStop) {
    const e = new Error("The connection to the AI closed before the response finished. Please try again.");
    e.transient = true;
    throw e;
  }

  return { text: text.trim(), usage };
}

async function callClaude(spec, apiKey, onPartial) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await oneCall(spec, apiKey, onPartial);
    } catch (e) {
      lastErr = e;
      if (!e.transient || attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); // brief backoff, then retry
    }
  }
  throw lastErr;
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a !== -1 && b !== -1) { try { return JSON.parse(cleaned.slice(a, b + 1)); } catch {} }
    return { raw: text };
  }
}

// When a drafting response is valid-looking JSON we use it directly. But models
// often break JSON when the "draft" value is long markdown (raw newlines/quotes),
// which parses to nothing and used to save an empty draft. This lenient pass
// pulls the draft (and notes) out of the text even when the JSON is malformed.
function salvageDraft(text) {
  let t = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const m = t.match(/"draft"\s*:\s*"/);
  if (!m) return null;
  const start = m.index + m[0].length;
  // The draft string ends where the "notes" key begins, else at the last quote.
  let end = t.search(/"\s*,\s*"notes"\s*:/);
  if (end === -1 || end <= start) {
    const lastQuote = t.lastIndexOf('"');
    end = lastQuote > start ? lastQuote : t.length;
  }
  let draft = t.slice(start, end)
    .replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, "\t")
    .replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    .trim();
  if (!draft) return null;
  let notes = [];
  const nm = t.match(/"notes"\s*:\s*\[([\s\S]*?)\]/);
  if (nm) {
    notes = (nm[1].match(/"((?:[^"\\]|\\.)*)"/g) || [])
      .map((s) => s.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, " ").trim())
      .filter(Boolean);
  }
  return { draft, notes };
}

export default async (req) => {
  let body = {};
  try { body = await req.json(); } catch {}
  const u = getUser(req);
  const jobId = body.jobId;

  try {
    if (!jobId) return new Response(null, { status: 400 });
    if (!u) return new Response(null, { status: 401 });

    const job = await getJob(u.uid, jobId);
    if (!job) return new Response(null, { status: 202 });      // nothing queued
    if (job.status === "done") return new Response(null, { status: 202 }); // retry guard

    const userRec = await getUserByEmail(u.email);
    const { key: apiKey } = resolveUserKey(userRec);
    if (!apiKey) {
      await putJob(u.uid, jobId, { status: "error", error: "No Anthropic API key is set for your account. Add one in Settings to use AI features." });
      return new Response(null, { status: 202 });
    }

    await putJob(u.uid, jobId, { ...job, status: "running" });

    const build = ACTIONS[job.action];
    if (!build) throw new Error(`Unknown action: ${job.action}`);

    const spec = build(job.payload || {});
    const out = await callClaude(spec, apiKey, async (partial) => {
      // Publish in-progress text so the client can show the draft as it's written.
      try { await putJob(u.uid, jobId, { status: "running", partial }); } catch {}
    });
    const text = out.text;
    const result = spec.json ? parseJson(text) : { text };

    // For drafting actions the result must contain a usable draft. If strict
    // parsing produced nothing usable (malformed JSON around long markdown),
    // salvage it; if we still can't get a draft, fail loudly instead of quietly
    // saving an empty chapter.
    if (DRAFTING.has(job.action)) {
      if (typeof result.draft !== "string" || !result.draft.trim()) {
        const s = salvageDraft(text);
        if (s) { result.draft = s.draft; if (!Array.isArray(result.notes) || !result.notes.length) result.notes = s.notes; delete result.raw; }
      }
      if (typeof result.draft !== "string" || !result.draft.trim()) {
        throw new Error("The draft came back in a form the app couldn't read, so nothing was saved. Please try again — if it keeps happening, the chapter may be too long to draft in one pass.");
      }
    }

    // Durably save drafting results here so a slow or closed client can't lose a
    // finished chapter. If this succeeds, `result.saved` tells the client the
    // draft is already stored and it should skip its own save.
    const saved = await persistDrafting(u.uid, job.action, job.payload || {}, result);
    if (saved) result.saved = saved;

    try {
      const u2 = out.usage || {};
      await addUsage(u.uid, {
        model: spec.model,
        action: job.action,
        input: u2.input_tokens,
        output: u2.output_tokens,
        cacheRead: u2.cache_read_input_tokens,
        cacheWrite: u2.cache_creation_input_tokens,
      });
    } catch {}

    await putJob(u.uid, jobId, { status: "done", result });
  } catch (err) {
    try {
      if (u && jobId) await putJob(u.uid, jobId, { status: "error", error: String(err?.message || err) });
    } catch {}
  }

  return new Response(null, { status: 202 });
};
