// netlify/functions/lib/keys.js
// Decides which Anthropic API key a user's AI calls should use, and validates
// keys against Anthropic. Keys are secrets: they are never returned to the
// browser or logged anywhere.
//
// Resolution order:
//   1. the user's OWN key, if they've added one (they pay)
//   2. the server key, if the user is "covered" (you pay)
//   3. none  -> the caller must add a key in Settings
export function resolveUserKey(user) {
  const own = (user?.apiKey || "").trim();
  if (own) return { key: own, source: "user" };
  if (user?.covered && process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "server" };
  return { key: null, source: "none" };
}

// Cheap, no-cost validation: GET /v1/models authenticates the key without
// spending tokens. 200 = good, 401/403 = bad key.
export async function validateKey(key) {
  const k = (key || "").trim();
  if (k.length < 20 || !k.startsWith("sk-")) return { ok: false, error: "That doesn't look like an Anthropic API key (they start with “sk-”)." };
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": k, "anthropic-version": "2023-06-01" },
    });
    if (res.status === 200) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: "Anthropic rejected that key — double-check you copied all of it." };
    return { ok: false, error: `Couldn't verify the key right now (HTTP ${res.status}). Try again in a moment.` };
  } catch {
    return { ok: false, error: "Couldn't reach Anthropic to verify the key. Try again in a moment." };
  }
}
