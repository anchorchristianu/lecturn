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

async function callClaude({ system, messages, model, maxTokens }, apiKey, onPartial) {
  const systemBlocks = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODELS[model] || MODELS.main, max_tokens: maxTokens, system: systemBlocks, messages, stream: true }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = {};
  let lastEmit = 0;

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
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        text += evt.delta.text;
        const now = Date.now();
        if (onPartial && now - lastEmit > 900) { lastEmit = now; await onPartial(text); }
      } else if (evt.type === "message_start" && evt.message?.usage) {
        usage = { ...usage, ...evt.message.usage };
      } else if (evt.type === "message_delta" && evt.usage) {
        usage = { ...usage, ...evt.usage };
      }
    }
  }
  return { text: text.trim(), usage };
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
