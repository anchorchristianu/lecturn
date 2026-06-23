// netlify/functions/ai-background.js
// The "-background" suffix makes this a Netlify Background Function: it returns
// 202 immediately and may run up to 15 minutes — long enough for any AI step.
// It writes the result to the "jobs" store; the client polls job.js for it.

import { ACTIONS } from "./lib/prompts.js";
import { getUser } from "./lib/session.js";
import { getStore } from "@netlify/blobs";

const MODELS = {
  main: process.env.MODEL_MAIN || "claude-sonnet-4-6",
  sort: process.env.MODEL_SORT || "claude-haiku-4-5",
};

async function callClaude({ system, messages, model, maxTokens }) {
  // Cache the per-project system context so repeated steps on a book are cheap.
  const systemBlocks = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODELS[model] || MODELS.main, max_tokens: maxTokens, system: systemBlocks, messages }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
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
  const store = getStore("jobs");
  const key = `${u ? u.uid : "anon"}__${jobId}`;

  try {
    if (!jobId) return new Response(null, { status: 400 });
    if (!u) throw new Error("Not signed in");
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server.");

    await store.setJSON(key, { status: "running", at: Date.now() });

    const build = ACTIONS[body.action];
    if (!build) throw new Error(`Unknown action: ${body.action}`);

    const spec = build(body);
    const text = await callClaude(spec);
    const result = spec.json ? parseJson(text) : { text };

    await store.setJSON(key, { status: "done", result });
  } catch (err) {
    try { await store.setJSON(key, { status: "error", error: String(err?.message || err) }); } catch {}
  }

  // The client ignores this; it polls job.js for the stored result.
  return new Response(null, { status: 202 });
};
