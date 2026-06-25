// netlify/functions/lib/store.js
// Netlify Blobs wrapper. Projects are keyed by id and carry an authoritative
// members[] list (roles: owner | author | editor). Access is governed by
// membership, not by the storage key, so a project + its contents are reachable
// by every collaborator. A per-user membership index keeps "your library" fast.

import { getStore } from "@netlify/blobs";
import { countWords } from "./clean.js";

const users = () => getStore("users");
const projects = () => getStore("projects");
const sources = () => getStore("sources");
const drafts = () => getStore("drafts");
const jobs = () => getStore("jobs");
const usage = () => getStore("usage");
const memberships = () => getStore("memberships");
const locks = () => getStore("locks");

const b64 = (s) => Buffer.from(String(s)).toString("base64url");

// ---- background jobs ----
export const putJob = (uid, jobId, data) => jobs().setJSON(`${uid}__${jobId}`, data);
export const getJob = (uid, jobId) => jobs().get(`${uid}__${jobId}`, { type: "json" });

// ---- AI usage (per user) ----
export async function addUsage(uid, rec) {
  let cur = null;
  try { cur = await usage().get(uid, { type: "json" }); } catch { cur = null; }
  cur = cur || { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, byModel: {}, byAction: {}, firstAt: new Date().toISOString() };
  const inn = rec.input || 0, out = rec.output || 0, cr = rec.cacheRead || 0, cw = rec.cacheWrite || 0;
  cur.calls += 1; cur.input += inn; cur.output += out; cur.cacheRead += cr; cur.cacheWrite += cw;
  const role = rec.model || "main";
  const bm = cur.byModel[role] || { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  bm.calls += 1; bm.input += inn; bm.output += out; bm.cacheRead += cr; bm.cacheWrite += cw;
  cur.byModel[role] = bm;
  const a = rec.action || "other";
  cur.byAction[a] = (cur.byAction[a] || 0) + 1;
  cur.updatedAt = new Date().toISOString();
  await usage().setJSON(uid, cur);
}

// ---- admin: enumerate ----
export async function listUsers() {
  const { blobs } = await users().list();
  const items = await Promise.all(blobs.map((b) => users().get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
export async function listAllProjects() {
  const { blobs } = await projects().list();
  const items = await Promise.all(blobs.filter((b) => b.key.startsWith("proj:")).map((b) => projects().get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
export async function getUsageMap() {
  const { blobs } = await usage().list();
  const out = {};
  await Promise.all(blobs.map(async (b) => { const v = await usage().get(b.key, { type: "json" }); if (v) out[b.key] = v; }));
  return out;
}

// ---- users ----
export const getUserByEmail = (email) => users().get(b64(email.toLowerCase()), { type: "json" });
export async function putUser(user) {
  await users().setJSON(b64(user.email.toLowerCase()), user);
  return user;
}

// ---- membership index (uid -> [projectId]) ----
async function getMemberIndex(uid) {
  try { return (await memberships().get(uid, { type: "json" })) || []; } catch { return []; }
}
async function addMemberIndex(uid, projectId) {
  const ix = await getMemberIndex(uid);
  if (!ix.includes(projectId)) { ix.push(projectId); await memberships().setJSON(uid, ix); }
}
async function removeMemberIndex(uid, projectId) {
  const ix = (await getMemberIndex(uid)).filter((p) => p !== projectId);
  await memberships().setJSON(uid, ix);
}

// ---- projects (by id; access via members[]) ----
const pKey = (id) => `proj:${id}`;
export const getProjectById = (id) => projects().get(pKey(id), { type: "json" });
export async function putProjectRaw(p) {
  p.updatedAt = new Date().toISOString();
  await projects().setJSON(pKey(p.id), p);
  return p;
}
export function memberRole(project, uid) {
  const m = (project?.members || []).find((x) => x.uid === uid);
  return m ? m.role : null;
}
export async function listProjectsForUser(uid) {
  const ids = await getMemberIndex(uid);
  const items = await Promise.all(ids.map((id) => getProjectById(id).catch(() => null)));
  return items.filter(Boolean)
    .map((p) => ({ ...p, myRole: memberRole(p, uid) }))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
export async function createProjectFor(owner, base) {
  const id = crypto.randomUUID();
  const p = {
    id,
    ownerId: owner.uid,
    members: [{ uid: owner.uid, email: owner.email, name: owner.name || "", role: "owner", voiceSample: base.voiceSample || "" }],
    title: base.title || "Untitled book",
    intake: base.intake || {},
    brief: base.brief || "",
    outline: (base.outline || []).map((c) => ({ ...c, authorId: owner.uid })),
    questions: base.questions || [],
    counts: { sources: 0, drafts: 0, words: 0 },
    createdAt: new Date().toISOString(),
  };
  await putProjectRaw(p);
  await addMemberIndex(owner.uid, id);
  return p;
}
export async function deleteProjectById(id) {
  const p = await getProjectById(id);
  if (p) for (const m of p.members || []) await removeMemberIndex(m.uid, id);
  await projects().delete(pKey(id));
  for (const s of await listSources(id)) await sources().delete(`${id}__${s.id}`);
  for (const d of await listDrafts(id)) await drafts().delete(`${id}__${d.id}`);
}

// ---- members ----
export async function addMember(project, user, role, voiceSample = "") {
  project.members = project.members || [];
  if (!project.members.find((m) => m.uid === user.uid)) {
    project.members.push({ uid: user.uid, email: user.email, name: user.name || "", role, voiceSample });
    await addMemberIndex(user.uid, project.id);
  }
  return putProjectRaw(project);
}
export async function removeMemberFrom(project, uid) {
  project.members = (project.members || []).filter((m) => m.uid !== uid);
  project.outline = (project.outline || []).map((c) => (c.authorId === uid ? { ...c, authorId: project.ownerId } : c));
  await removeMemberIndex(uid, project.id);
  return putProjectRaw(project);
}

// ---- sources (by projectId) ----
export async function listSources(projectId) {
  const { blobs } = await sources().list({ prefix: `${projectId}__` });
  const items = await Promise.all(blobs.map((b) => sources().get(b.key, { type: "json" })));
  return items.filter(Boolean).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}
export async function putSource(s) { await sources().setJSON(`${s.projectId}__${s.id}`, s); return s; }
export const deleteSource = (projectId, id) => sources().delete(`${projectId}__${id}`);

// ---- drafts ----
export async function listDrafts(projectId) {
  const { blobs } = await drafts().list({ prefix: `${projectId}__` });
  const items = await Promise.all(blobs.map((b) => drafts().get(b.key, { type: "json" })));
  return items.filter(Boolean);
}
export async function putDraft(d) { d.updatedAt = new Date().toISOString(); await drafts().setJSON(`${d.projectId}__${d.id}`, d); return d; }

export async function refreshCounts(projectId) {
  const [project, srcs, drs] = await Promise.all([getProjectById(projectId), listSources(projectId), listDrafts(projectId)]);
  if (!project) return null;
  const words = drs.reduce((n, d) => n + countWords(d.text), 0);
  project.counts = { sources: srcs.length, drafts: drs.length, words };
  return putProjectRaw(project);
}

// ---- soft per-chapter locks ----
const LOCK_TTL = 90 * 1000; // stale after 90s without a heartbeat
const lockKey = (projectId, chapter) => `${projectId}__${b64(chapter)}`;
export async function getLock(projectId, chapter) {
  let l = null;
  try { l = await locks().get(lockKey(projectId, chapter), { type: "json" }); } catch { l = null; }
  if (l && Date.now() - l.at > LOCK_TTL) return null;
  return l;
}
export async function setLock(projectId, chapter, uid, name) {
  const l = { uid, name: name || "", at: Date.now() };
  await locks().setJSON(lockKey(projectId, chapter), l);
  return l;
}
export async function delLock(projectId, chapter, uid) {
  const l = await getLock(projectId, chapter);
  if (!l || l.uid === uid) await locks().delete(lockKey(projectId, chapter));
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extraHeaders } });
}
