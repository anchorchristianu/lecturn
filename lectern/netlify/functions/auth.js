// netlify/functions/auth.js — accounts (Netlify Functions v2)
import { getUserByEmail, putUser, json } from "./lib/store.js";
import { hashPassword, verifyPassword, makeSession, sessionCookie, clearCookie, getUser } from "./lib/session.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMINS = (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = (email) => ADMINS.includes((email || "").toLowerCase());
const pub = (u) => ({ id: u.uid || u.id, email: u.email, name: u.name, isAdmin: isAdmin(u.email) });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!process.env.SESSION_SECRET)
    return json({ error: "SESSION_SECRET is not set on the server." }, 500);

  try {
    const { op, email, password, name, code } = await req.json();

    if (op === "me") {
      const u = getUser(req);
      return u ? json({ user: pub(u) }) : json({ error: "Not signed in" }, 401);
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
