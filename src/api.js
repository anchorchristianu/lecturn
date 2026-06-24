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

// ---- ai ----
// AI work runs in a background function (up to 15 min) that writes its result to
// storage; we poll for it. This avoids the 10s synchronous-function timeout that
// otherwise kills slower steps like outlining and drafting with a 502.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const ai = async (action, payload) => {
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

  // 3) Poll for the result.
  const started = Date.now();
  const MAX_MS = 4 * 60 * 1000; // give up after 4 minutes
  let delay = 800;
  while (true) {
    await sleep(delay);
    let job;
    try {
      const r = await fetch(`/.netlify/functions/job?id=${jobId}`, opts("GET")).then(handle);
      job = r.job;
    } catch (e) {
      if (e.status === 401) throw e; // signed out — stop polling
      job = { status: "pending" };
    }
    if (job?.status === "done") return job.result;
    if (job?.status === "error") throw new Error(job.error || "The AI step failed. Please try again.");
    if (Date.now() - started > MAX_MS) throw new Error("This is taking unusually long — please try again in a moment.");
    delay = Math.min(delay + 250, 2000);
  }
};
