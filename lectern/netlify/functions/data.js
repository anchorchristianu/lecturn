// netlify/functions/data.js — storage CRUD, per-user (Netlify Functions v2)
import {
  listProjects, getProject, putProject, deleteProject,
  listSources, putSource, deleteSource,
  listDrafts, putDraft, refreshCounts, putJob, json,
} from "./lib/store.js";
import { getUser } from "./lib/session.js";
import { cleanTranscript, tidyDraft, hashText, countWords } from "./lib/clean.js";

export default async (req) => {
  const u = getUser(req);
  if (!u) return json({ error: "Not signed in" }, 401);
  const uid = u.uid;

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const type = url.searchParams.get("type");
      const id = url.searchParams.get("id");

      if (type === "projects") return json({ projects: await listProjects(uid) });
      if (type === "project") {
        const project = await getProject(uid, id);
        if (!project) return json({ error: "Not found" }, 404);
        const [sources, drafts] = await Promise.all([listSources(uid, id), listDrafts(uid, id)]);
        return json({ project, sources, drafts });
      }
      return json({ error: "Unknown query type" }, 400);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const { op } = body;

      switch (op) {
        case "createProject": {
          const p = {
            id: crypto.randomUUID(),
            title: body.project.title || "Untitled book",
            intake: body.project.intake || {},
            brief: body.project.brief || "",
            voiceSample: body.project.voiceSample || "",
            outline: body.project.outline || [],
            questions: body.project.questions || [],
            counts: { sources: 0, drafts: 0, words: 0 },
            createdAt: new Date().toISOString(),
          };
          return json({ project: await putProject(uid, p) });
        }
        case "updateProject":
          return json({ project: await putProject(uid, body.project) });
        case "deleteProject":
          await deleteProject(uid, body.id);
          return json({ ok: true });

        case "enqueueJob": {
          // Store a (possibly large) AI job input here, on the 6MB sync path.
          // The background worker is then triggered with only the job id.
          await putJob(uid, body.jobId, {
            status: "queued",
            action: body.action,
            payload: body.payload || {},
            at: Date.now(),
          });
          return json({ ok: true });
        }

        case "addSource": {
          const projectId = body.source.projectId;
          const raw = body.source.text || "";
          const cleaned = cleanTranscript(raw); // deterministic, no model call
          const hash = hashText(cleaned);

          // Skip duplicates: identical cleaned text already filed → return it.
          const existing = (await listSources(uid, projectId)).find((s) => s.hash === hash);
          if (existing) return json({ source: existing, duplicate: true });

          const s = {
            id: crypto.randomUUID(),
            projectId,
            title: body.source.title || "Untitled recording",
            type: body.source.type || "walk recording",
            raw,
            text: cleaned,
            hash,
            words: countWords(cleaned),
            summary: body.source.summary || "",
            themes: body.source.themes || [],
            chapters: body.source.chapters || [],
            stories: body.source.stories || [],
            suggestedChapter: "",
            createdAt: new Date().toISOString(),
          };
          await putSource(uid, s);
          await refreshCounts(uid, projectId);
          return json({ source: s });
        }
        case "updateSource":
          await putSource(uid, body.source);
          return json({ source: body.source });
        case "deleteSource":
          await deleteSource(uid, body.projectId, body.id);
          await refreshCounts(uid, body.projectId);
          return json({ ok: true });

        case "saveDraft": {
          const text = tidyDraft(body.draft.text || ""); // deterministic polish
          const d = {
            id: body.draft.id || crypto.randomUUID(),
            projectId: body.draft.projectId,
            chapter: body.draft.chapter,
            text,
            words: countWords(text),
            notes: body.draft.notes || [],
            polished: body.draft.polished || false,
            version: (body.draft.version || 0) + 1,
          };
          await putDraft(uid, d);
          await refreshCounts(uid, d.projectId);
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
