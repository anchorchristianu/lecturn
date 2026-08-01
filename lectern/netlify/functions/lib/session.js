// netlify/functions/lib/session.js
// Self-contained auth primitives: scrypt password hashing, HMAC-signed stateless
// session tokens, and cookie helpers. No external dependencies.

import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const COOKIE = "lectern_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// ---- passwords ----
export function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${dk}`;
}
export function verifyPassword(pw, stored) {
  const [salt, dk] = (stored || "").split(":");
  if (!salt || !dk) return false;
  const calc = scryptSync(pw, salt, 64);
  const a = Buffer.from(dk, "hex");
  return a.length === calc.length && timingSafeEqual(a, calc);
}

// ---- tokens ----
function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set on the server.");
  return s;
}
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, "base64url").toString());
    if (obj.exp && obj.exp < Date.now()) return null;
    return obj;
  } catch {
    return null;
  }
}

// ---- cookies / request ----
function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const isSecure = (req) => {
  try { return new URL(req.url).protocol === "https:"; } catch { return false; }
};
export function sessionCookie(req, token) {
  const sec = isSecure(req) ? "; Secure" : "";
  return `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE}${sec}`;
}
export function clearCookie(req) {
  const sec = isSecure(req) ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${sec}`;
}

// Returns { uid, email, name } or null
export function getUser(req) {
  const cookies = parseCookies(req.headers.get("cookie"));
  return verifyToken(cookies[COOKIE]);
}

export function makeSession(user) {
  return signToken({
    uid: user.id,
    email: user.email,
    name: user.name || "",
    exp: Date.now() + MAX_AGE * 1000,
  });
}
