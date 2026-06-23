// netlify/functions/job.js — returns the status/result of a background AI job.
import { getUser } from "./lib/session.js";
import { json } from "./lib/store.js";
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const u = getUser(req);
  if (!u) return json({ error: "Not signed in" }, 401);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  let job = null;
  try {
    job = await getStore("jobs").get(`${u.uid}__${id}`, { type: "json" });
  } catch {
    job = null;
  }
  // No record yet just means the background function hasn't written one — keep polling.
  return json({ job: job || { status: "pending" } });
};
