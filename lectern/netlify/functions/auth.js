// netlify/functions/auth.js — accounts (Netlify Functions v2)
import { getUserByEmail, putUser, json } from "./lib/store.js";
import { hashPassword, verifyPassword, makeSession, sessionCookie, clearCookie, getUser } from "./lib/session.js";
import { validateKey } from "./lib/keys.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = (email) => ADMINS.includes((email || "").toLowerCase());
const pub = (u) => ({
  id: u.uid || u.id,
  email: u.email,
  name: u.name,
  isAdmin: isAdmin(u.email),
  covered: !!u.covered,
  hasKey: !!(u.apiKey && u.apiKey.length),
});

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!process.env.SESSION_SECRET)
    return json({ error: "SESSION_SECRET is not set on the server." }, 500);

  try {
    const { op, email, password, name, code, apiKey } = await req.json();

    if (op === "me") {
      const t = getUser(req);
      if (!t) return json({ error: "Not signed in" }, 401);
      const rec = await getUserByEmail(t.email);
      return json({ user: pub(rec || t) });
    }

    if (op === "setKey") {
      const t = getUser(req);
      if (!t) return json({ error: "Not signed in" }, 401);
      const check = await validateKey(apiKey);
      if (!check.ok) return json({ error: check.error }, 400);
      const rec = await getUserByEmail(t.email);
      if (!rec) return json({ error: "Account not found." }, 404);
      rec.apiKey = (apiKey || "").trim();
      await putUser(rec);
      return json({ user: pub(rec) });
    }

    if (op === "removeKey") {
      const t = getUser(req);
      if (!t) return json({ error: "Not signed in" }, 401);
      const rec = await getUserByEmail(t.email);
      if (!rec) return json({ error: "Account not found." }, 404);
      rec.apiKey = "";
      await putUser(rec);
      return json({ user: pub(rec) });
    }

    if (op === "logout") {
      return json({ ok: true }, 200, { "set-cookie": clearCookie(req) });
    }

    if (op === "signup") {
      if (process.env.SIGNUP_CODE && code !== process.env.SIGNUP_CODE)
        return json({ error: "That invite code isn't right." }, 403);
      if (!EMAIL_RE.test(email || "")) return json({ error: "Enter a valid email." }, 400);
      if ((password || "").length < 8) return json({ error: "Use at least 8 characters." }, 400);
      if (await getUserByEmail(email)) return json({ error: "An account with that email already exists." }, 409);

      const user = {
        id: crypto.randomUUID(),
        email: email.toLowerCase(),
        name: (name || "").trim(),
        password: hashPassword(password),
        // New accounts ride the server key by default (today everyone signs up
        // via invite code). Set COVER_NEW_USERS=false when opening public signup
        // so new users must bring their own key.
        covered: process.env.COVER_NEW_USERS !== "false",
        apiKey: "",
        createdAt: new Date().toISOString(),
      };
      await putUser(user);
      const token = makeSession(user);
      return json({ user: pub(user) }, 200, { "set-cookie": sessionCookie(req, token) });
    }

    if (op === "login") {
      const user = await getUserByEmail(email || "");
      if (!user || !verifyPassword(password || "", user.password))
        return json({ error: "Email or password is incorrect." }, 401);
      const token = makeSession(user);
      return json({ user: pub(user) }, 200, { "set-cookie": sessionCookie(req, token) });
    }

    return json({ error: `Unknown op: ${op}` }, 400);
  } catch (err) {
    return json({ error: String(err?.message || err) }, 500);
  }
};
