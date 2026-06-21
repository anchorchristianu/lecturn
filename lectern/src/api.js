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
export const ai = (action, payload) =>
  fetch("/api/claude", opts("POST", { action, ...payload })).then(handle).then((d) => d.result);
