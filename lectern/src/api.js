// src/api.js — talks to the Netlify functions. Auth rides on an httpOnly cookie,
// so requests just need credentials: "include"; no tokens are handled in JS.

async function handle(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const opts = (method, body) => ({
  method,
  credentials: "include",
  headers: { "content-type": "application/json" },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

// ---- auth ----
export const auth = (op, payload = {}) =>
  fetch("/api/auth", opts("POST", { op, ...payload })).then(handle);

// ---- storage ----
export const listProjects = () =>
  fetch("/api/data?type=projects", opts("GET")).then(handle).then((d) => d.projects);

export const getProject = (id) =>
  fetch(`/api/data?type=project&id=${id}`, opts("GET")).then(handle);

export const post = (body) => fetch("/api/data", opts("POST", body)).then(handle);

// ---- admin (gated server-side by ADMIN_EMAILS) ----
export const admin = () => fetch("/api/admin", opts("GET")).then(handle);
export const adminPost = (body) => fetch("/api/admin", opts("POST", body)).then(handle);

// ---- API key (self-service) ----
export const setMyKey = (apiKey) => auth("setKey", { apiKey });
export const removeMyKey = () => auth("removeKey");

// ---- ai ----
// AI work runs in a background function (up to 15 min) that writes its result to
// storage; we poll for it. This avoids the 10s synchronous-function timeout that
// otherwise kills slower steps like outlining and drafting with a 502.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ai = async (action, payload, onProgress) => {
  const jobId =
    (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  // 1) Store the (possibly large) input via the sync endpoint. Background
  //    functions are invoked asynchronously, which caps the request body at
  //    256KB, so we must NOT send the payload to the worker directly.
  await post({ op: "enqueueJob", jobId, action, payload });

  // 2) Trigger the background worker with only the id (tiny, well under the cap).
  const res = await fetch("/.netlify/functions/ai-background", opts("POST", { jobId }));
  if (res.status !== 202 && !res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Couldn't start the AI step (${res.status}).`);
  }

  // 3) Poll for the result, surfacing partial text as it streams in.
  const started = Date.now();
  // The background worker may run up to ~15 min; a full chapter draft (6000
  // output tokens) can take a few minutes under load. Keep the client's ceiling
  // safely BELOW the worker's so we don't abandon a job the server will finish
  // (abandoning it was what erased/reset chapters). Polling is cheap.
  const MAX_MS = 12 * 60 * 1000;
  const pollOnce = () =>
    fetch(`/.netlify/functions/job?id=${jobId}`, opts("GET")).then(handle).then((r) => r.job);
  let delay = 600;
  while (true) {
    await sleep(delay);
    let job;
    try {
      job = await pollOnce();
    } catch (e) {
      if (e.status === 401) throw e; // signed out — stop polling
      job = { status: "pending" };
    }
    if (job?.status === "done") return job.result;
    if (job?.status === "error") throw new Error(job.error || "The AI step failed. Please try again.");
    if (job?.partial && onProgress) { try { onProgress(job.partial); } catch {} }
    if (Date.now() - started > MAX_MS) {
      // One last look before giving up — the worker may have finished right at
      // the deadline. Drafting results are also saved server-side, so even if
      // this throws, the chapter is recoverable by reloading.
      try {
        const last = await pollOnce();
        if (last?.status === "done") return last.result;
      } catch {}
      throw new Error("This step is taking longer than usual. Your work may already be saved — reopen the chapter in a moment to check.");
    }
    delay = Math.min(delay + 150, 1000);
  }
};
