// netlify/functions/data.js — storage CRUD with membership-based access control.
import {
  listProjectsForUser, getProjectById, putProjectRaw, createProjectFor, deleteProjectById,
  memberRole, addMember, removeMemberFrom,
  listSources, putSource, deleteSource,
  listDrafts, putDraft, refreshCounts,
  getUserByEmail, getLock, setLock, delLock, putJob, json,
} from "./lib/store.js";
import { getUser } from "./lib/session.js";
import { cleanTranscript, tidyDraft, hashText, countWords } from "./lib/clean.js";

// Content fields a member (owner/author/editor) may change via updateProject.
// members, ownerId, counts and per-chapter authorId are NOT writable here — they
// have their own owner/author-gated ops so content edits can't escalate access.
const CONTENT_FIELDS = ["title", "brief", "intake", "outline", "questions", "review", "styleSheet", "launchKit"];

export default async (req) => {
  const u = getUser(req);
  if (!u) return json({ error: "Not signed in" }, 401);
  const uid = u.uid;

  // Load a project and the caller's role, or return an error Response.
  async function resolve(projectId) {
    if (!projectId) return { error: json({ error: "Missing project id" }, 400) };
    const project = await getProjectById(projectId);
    if (!project) return { error: json({ error: "Not found" }, 404) };
    const role = memberRole(project, uid);
    if (!role) return { error: json({ error: "No access to this project" }, 403) };
    return { project, role };
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const type = url.searchParams.get("type");
      const id = url.searchParams.get("id");

      if (type === "projects") return json({ projects: await listProjectsForUser(uid) });
      if (type === "project") {
        const r = await resolve(id);
        if (r.error) return r.error;
        const [sources, drafts] = await Promise.all([listSources(id), listDrafts(id)]);
        return json({ project: { ...r.project, myRole: r.role }, sources, drafts });
      }
      return json({ error: "Unknown query type" }, 400);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { op } = body;

      switch (op) {
        // ---- project lifecycle ----
        case "createProject": {
          const p = await createProjectFor(u, body.project || {});
          return json({ project: { ...p, myRole: "owner" } });
        }
        case "updateProject": {
          const incoming = body.project || {};
          const r = await resolve(incoming.id);
          if (r.error) return r.error;
          const server = r.project;
          // Preserve author assignments (keyed by chapter name) across content edits.
          const prevAuthor = Object.fromEntries((server.outline || []).map((c) => [c.chapter, c.authorId]));
          for (const k of CONTENT_FIELDS) if (k in incoming) server[k] = incoming[k];
          server.outline = (server.outline || []).map((c) => ({ ...c, authorId: prevAuthor[c.chapter] || server.ownerId }));
          return json({ project: { ...(await putProjectRaw(server)), myRole: r.role } });
        }
        case "deleteProject": {
          const r = await resolve(body.id);
          if (r.error) return r.error;
          if (r.role !== "owner") return json({ error: "Only the owner can delete this book" }, 403);
          await deleteProjectById(body.id);
          return json({ ok: true });
        }

        // ---- collaborators (owner-gated, except self-service voice) ----
        case "inviteMember": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          if (r.role !== "owner") return json({ error: "Only the owner can add collaborators" }, 403);
          const role = body.role === "author" ? "author" : "editor";
          const invitee = await getUserByEmail(String(body.email || "").trim());
          if (!invitee) return json({ error: "No Lectern account uses that email yet. Ask them to sign up first, then invite them." }, 404);
          const user = { uid: invitee.id, email: invitee.email, name: invitee.name || "" };
          const updated = await addMember(r.project, user, role, "");
          return json({ project: { ...updated, myRole: r.role } });
        }
        case "removeMember": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          if (r.role !== "owner") return json({ error: "Only the owner can remove collaborators" }, 403);
          if (body.uid === r.project.ownerId) return json({ error: "The owner can't be removed" }, 400);
          const updated = await removeMemberFrom(r.project, body.uid);
          return json({ project: { ...updated, myRole: r.role } });
        }
        case "updateRole": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          if (r.role !== "owner") return json({ error: "Only the owner can change roles" }, 403);
          if (body.uid === r.project.ownerId) return json({ error: "The owner's role can't be changed" }, 400);
          const role = body.role === "author" ? "author" : "editor";
          r.project.members = (r.project.members || []).map((m) => (m.uid === body.uid ? { ...m, role } : m));
          if (role === "editor") // an editor carries no voice; reassign any chapters they held
            r.project.outline = (r.project.outline || []).map((c) => (c.authorId === body.uid ? { ...c, authorId: r.project.ownerId } : c));
          return json({ project: { ...(await putProjectRaw(r.project)), myRole: r.role } });
        }
        case "setVoice": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          const target = body.uid || uid;
          if (r.role !== "owner" && target !== uid) return json({ error: "You can only edit your own voice" }, 403);
          r.project.members = (r.project.members || []).map((m) => (m.uid === target ? { ...m, voiceSample: body.voiceSample || "" } : m));
          return json({ project: { ...(await putProjectRaw(r.project)), myRole: r.role } });
        }
        case "assignChapter": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          if (r.role !== "owner" && r.role !== "author") return json({ error: "Only an owner or co-author can assign chapters" }, 403);
          const target = (r.project.members || []).find((m) => m.uid === body.authorId);
          if (!target || (target.role !== "owner" && target.role !== "author"))
            return json({ error: "Chapters can only be voiced by the owner or a co-author" }, 400);
          r.project.outline = (r.project.outline || []).map((c) => (c.chapter === body.chapter ? { ...c, authorId: body.authorId } : c));
          return json({ project: { ...(await putProjectRaw(r.project)), myRole: r.role } });
        }

        // ---- soft per-chapter locks ----
        case "lockChapter": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          const held = await getLock(body.projectId, body.chapter);
          if (held && held.uid !== uid) return json({ ok: false, lock: held });
          const lock = await setLock(body.projectId, body.chapter, uid, u.name || u.email);
          return json({ ok: true, lock });
        }
        case "unlockChapter": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          await delLock(body.projectId, body.chapter, uid);
          return json({ ok: true });
        }

        case "enqueueJob": {
          await putJob(uid, body.jobId, { status: "queued", action: body.action, payload: body.payload || {}, at: Date.now() });
          return json({ ok: true });
        }

        // ---- content (any member) ----
        case "addSource": {
          const projectId = body.source.projectId;
          const r = await resolve(projectId);
          if (r.error) return r.error;
          const raw = body.source.text || "";
          const cleaned = cleanTranscript(raw);
          const hash = hashText(cleaned);
          const existing = (await listSources(projectId)).find((s) => s.hash === hash);
          if (existing) return json({ source: existing, duplicate: true });
          const s = {
            id: crypto.randomUUID(), projectId,
            title: body.source.title || "Untitled recording",
            type: body.source.type || "walk recording",
            raw, text: cleaned, hash, words: countWords(cleaned),
            summary: body.source.summary || "", themes: body.source.themes || [],
            chapters: body.source.chapters || [], stories: body.source.stories || [],
            suggestedChapter: "", createdAt: new Date().toISOString(),
          };
          await putSource(s);
          await refreshCounts(projectId);
          return json({ source: s });
        }
        case "updateSource": {
          const r = await resolve(body.source.projectId);
          if (r.error) return r.error;
          await putSource(body.source);
          return json({ source: body.source });
        }
        case "deleteSource": {
          const r = await resolve(body.projectId);
          if (r.error) return r.error;
          await deleteSource(body.projectId, body.id);
          await refreshCounts(body.projectId);
          return json({ ok: true });
        }

        case "saveDraft": {
          const projectId = body.draft.projectId;
          const r = await resolve(projectId);
          if (r.error) return r.error;
          const held = await getLock(projectId, body.draft.chapter);
          if (held && held.uid !== uid) return json({ error: `${held.name || "Someone"} is editing this chapter`, lock: held }, 409);
          const text = tidyDraft(body.draft.text || "");
          const d = {
            id: body.draft.id || crypto.randomUUID(),
            projectId, chapter: body.draft.chapter, text,
            words: countWords(text.replace(/\[\^fn_[a-z0-9]+\]/g, "")),
            notes: body.draft.notes || [], footnotes: body.draft.footnotes || [],
            flags: body.draft.flags || [], factcheckSummary: body.draft.factcheckSummary || "",
            polished: body.draft.polished || false, version: (body.draft.version || 0) + 1,
            authorId: body.draft.authorId || undefined,
          };
          await putDraft(d);
          await refreshCounts(projectId);
          return json({ draft: d });
        }
        default:
          return json({ error: `Unknown op: ${op}` }, 400);
      }
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
};
