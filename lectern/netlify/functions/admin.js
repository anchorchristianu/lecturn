// netlify/functions/admin.js — admin-only platform stats.
// Gated by the ADMIN_EMAILS env var (comma-separated). Returns overall and
// per-user stats: projects, % complete, words, and AI usage / estimated cost.
import { getUser } from "./lib/session.js";
import { json, listUsers, listAllProjects, getUsageMap, getUserByEmail, putUser } from "./lib/store.js";
import { validateKey } from "./lib/keys.js";

const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// Estimated $ per MILLION tokens, by model role. These are estimates for a
// rough cost picture — adjust to match current Anthropic pricing.
const RATES = {
  main: { in: 3, out: 15, cr: 0.30, cw: 3.75 }, // Sonnet-class
  sort: { in: 0.80, out: 4, cr: 0.08, cw: 1.0 }, // Haiku-class
};

function costOf(byModel) {
  let c = 0;
  for (const role of Object.keys(byModel || {})) {
    const r = RATES[role] || RATES.main;
    const x = byModel[role];
    c += ((x.input || 0) * r.in + (x.output || 0) * r.out + (x.cacheRead || 0) * r.cr + (x.cacheWrite || 0) * r.cw) / 1e6;
  }
  return c;
}

function projectStat(p) {
  const chapters = (p.outline || []).length;
  const drafted = Math.min(p.counts?.drafts || 0, chapters || (p.counts?.drafts || 0));
  const pct = chapters ? Math.round((100 * drafted) / chapters) : 0;
  return { id: p.id, title: p.title || "Untitled", chapters, drafted, pct, words: p.counts?.words || 0, updatedAt: p.updatedAt };
}

export default async (req) => {
  const u = getUser(req);
  if (!u) return json({ error: "Not signed in" }, 401);
  if (ADMINS.length === 0) return json({ error: "No admins are configured. Set ADMIN_EMAILS on the server." }, 403);
  if (!ADMINS.includes((u.email || "").toLowerCase())) return json({ error: "Forbidden" }, 403);

  // ---- admin mutations: manage a user's coverage and API key ----
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const target = await getUserByEmail(body.email || "");
    if (!target) return json({ error: "No account uses that email." }, 404);
    if (body.op === "setUserCovered") {
      target.covered = !!body.covered;
      await putUser(target);
      return json({ ok: true });
    }
    if (body.op === "setUserKey") {
      const check = await validateKey(body.apiKey);
      if (!check.ok) return json({ error: check.error }, 400);
      target.apiKey = (body.apiKey || "").trim();
      await putUser(target);
      return json({ ok: true });
    }
    if (body.op === "clearUserKey") {
      target.apiKey = "";
      await putUser(target);
      return json({ ok: true });
    }
    return json({ error: "Unknown op" }, 400);
  }

  const [users, allProjects, usageMap] = await Promise.all([listUsers(), listAllProjects(), getUsageMap()]);

  const byUser = {};
  for (const p of allProjects) (byUser[p.ownerId] = byUser[p.ownerId] || []).push(p);

  const rows = users.map((usr) => {
    const ps = (byUser[usr.id] || []).map(projectStat).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const usage = usageMap[usr.id] || {};
    const words = ps.reduce((s, x) => s + x.words, 0);
    const avgPct = ps.length ? Math.round(ps.reduce((s, x) => s + x.pct, 0) / ps.length) : 0;
    return {
      email: usr.email,
      name: usr.name || "",
      createdAt: usr.createdAt || null,
      covered: !!usr.covered,
      hasKey: !!(usr.apiKey && usr.apiKey.length),
      projects: ps.length,
      avgPct,
      words,
      aiCalls: usage.calls || 0,
      inputTokens: usage.input || 0,
      outputTokens: usage.output || 0,
      cacheReadTokens: usage.cacheRead || 0,
      estCost: +costOf(usage.byModel).toFixed(2),
      projectList: ps,
    };
  }).sort((a, b) => b.projects - a.projects || b.estCost - a.estCost);

  const allStats = allProjects.map(projectStat);
  const overall = {
    users: users.length,
    projects: allProjects.length,
    inProgress: allStats.filter((p) => p.pct > 0 && p.pct < 100).length,
    completeish: allStats.filter((p) => p.pct >= 100).length,
    avgPct: allStats.length ? Math.round(allStats.reduce((s, x) => s + x.pct, 0) / allStats.length) : 0,
    words: rows.reduce((s, r) => s + r.words, 0),
    aiCalls: rows.reduce((s, r) => s + r.aiCalls, 0),
    inputTokens: rows.reduce((s, r) => s + r.inputTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.outputTokens, 0),
    estCost: +rows.reduce((s, r) => s + r.estCost, 0).toFixed(2),
  };

  return json({ overall, users: rows, rates: RATES });
};
