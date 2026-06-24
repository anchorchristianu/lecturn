// netlify/functions/claude.js — AI actions only (Netlify Functions v2)
import { ACTIONS } from "./lib/prompts.js";
import { json } from "./lib/store.js";
import { getUser } from "./lib/session.js";

const MODELS = {
  main: process.env.MODEL_MAIN || "claude-sonnet-4-6",
  sort: process.env.MODEL_SORT || "claude-haiku-4-5",
};

async function callClaude({ system, messages, model, maxTokens }) {
  // The per-project system context (rules + brief + voice sample) repeats across
  // many calls, so mark it cacheable. Repeated calls on the same book reuse it
  // instead of re-paying for those input tokens.
  const systemBlocks = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELS[model] || MODELS.main,
      max_tokens: maxTokens,
      system: systemBlocks,
      messages,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API ${res.status}: ${detail}`);
  }
  const data = await res.json();
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
    }
    return { raw: text };
  }
}

export default async (req) => {
  if (!getUser(req)) return json({ error: "Not signed in" }, 401);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!process.env.ANTHROPIC_API_KEY)
    return json({ error: "ANTHROPIC_API_KEY is not set on the server." }, 500);

  try {
    const payload = await req.json();
    const build = ACTIONS[payload.action];
    if (!build) return json({ error: `Unknown action: ${payload.action}` }, 400);

    const spec = build(payload);
    const text = await callClaude(spec);
    const result = spec.json ? parseJson(text) : { text };
    return json({ result });
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
};
