// netlify/functions/lib/store.js
// Netlify Blobs wrapper. All book data is namespaced by user id so users only
// ever see their own projects.

import { getStore } from "@netlify/blobs";
import { countWords } from "./clean.js";

const users = () => getStore("users");
const projects = () => getStore("projects");
const sources = () => getStore("sources");
const drafts = () => getStore("drafts");
const jobs = () => getStore("jobs");

const b64 = (s) => Buffer.from(s).toString("base64url");

// ---- background jobs ----
export const putJob = (uid, jobId, data) => jobs().setJSON(`${uid}__${jobId}`, data);
export const getJob = (uid, jobId) => jobs().get(`${uid}__${jobId}`, { type: "json" });

// ---- users ----
export const getUserByEmail = (email) => users().get(b64(email.toLowerCase()), { type: "json" });
export async function putUser(user) {
  await users().setJSON(b64(user.email.toLowerCase()), user);
  return user;
}

// ---- projects (namespaced) ----
const pKey = (uid, id) => `${uid}__${id}`;

export async function listProjects(uid) {
  const { blobs } = await projects().list({ prefix: `${uid}__` });
  const items = await Promise.all(blobs.map((b) => projects().get(b.key, { type: "json" })));
  return items.filter(Boolean).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
export const getProject = (uid, id) => projects().get(pKey(uid, id), { type: "json" });
export async function putProject(uid, p) {
  p.userId = uid;
  p.updatedAt = new Date().toISOString();
  await projects().setJSON(pKey(uid, p.id), p);
  return p;
}
export async function deleteProject(uid, id) {
  await projects().delete(pKey(uid, id));
  for (const s of await listSources(uid, id)) await sources().delete(`${uid}__${id}__${s.id}`);
  for (const d of await listDrafts(uid, id)) await drafts().delete(`${uid}__${id}__${d.id}`);
}

// ---- sources ----
export async function listSources(uid, projectId) {
  const { blobs } = await sources().list({ prefix: `${uid}__${projectId}__` });
  const items = await Promise.all(blobs.map((b) => sources().get(b.key, { type: "json" })));
  return items.filter(Boolean).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}
export async function putSource(uid, s) {
  await sources().setJSON(`${uid}__${s.projectId}__${s.id}`, s);
  return s;
}
export const deleteSource = (uid, projectId, id) => sources().delete(`${uid}__${projectId}__${id}`);

// ---- drafts ----
export async function listDrafts(uid, projectId) {
  const { blobs } = await drafts().list({ prefix: `${uid}__${projectId}__` });
  const items = await Promise.all(blobs.map((b) => drafts().get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
export async function putDraft(uid, d) {
  d.updatedAt = new Date().toISOString();
  await drafts().setJSON(`${uid}__${d.projectId}__${d.id}`, d);
  return d;
}

// Recompute denormalized counts so the library list is informative with no
// extra reads or model calls on the client.
export async function refreshCounts(uid, projectId) {
  const [project, srcs, drs] = await Promise.all([
    getProject(uid, projectId),
    listSources(uid, projectId),
    listDrafts(uid, projectId),
  ]);
  if (!project) return null;
  const words = drs.reduce((n, d) => n + countWords(d.text), 0);
  project.counts = { sources: srcs.length, drafts: drs.length, words };
  return putProject(uid, project);
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}
