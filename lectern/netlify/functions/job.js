// netlify/functions/job.js — returns the status/result of a background AI job.
// Only the status/result/error are returned (never the stored input payload),
// so polling stays light.
import { getUser } from "./lib/session.js";
import { json, getJob } from "./lib/store.js";

export default async (req) => {
  const u = getUser(req);
  if (!u) return json({ error: "Not signed in" }, 401);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  let job = null;
  try {
    job = await getJob(u.uid, id);
  } catch {
    job = null;
  }
  if (!job) return json({ job: { status: "pending" } });
  return json({ job: { status: job.status, result: job.result, error: job.error, partial: job.partial } });
};
