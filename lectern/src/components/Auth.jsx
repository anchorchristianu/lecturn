import { useState } from "react";
import { auth } from "../api.js";

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [f, setF] = useState({ email: "", password: "", name: "", code: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setErr(""); setBusy(true);
    try {
      const { user } = await auth(mode, f);
      onAuthed(user);
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";
  return (
    <div className="gate">
      <div className="card stack" style={{ maxWidth: 420 }}>
        <div className="center">
          <span className="mark" style={{ fontFamily: "var(--display)", fontSize: "1.8rem", color: "var(--pine)" }}>Lectern</span>
          <p className="muted" style={{ margin: "0.3rem 0 0" }}>your voice, bound into books</p>
        </div>

        {err && <div className="banner error">{err}</div>}

        {isSignup && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Your name</label>
            <input className="input" value={f.name} onChange={set("name")} placeholder="What should we call you?" />
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Email</label>
          <input className="input" type="email" value={f.email} onChange={set("email")} autoComplete="email" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Password</label>
          <input className="input" type="password" value={f.password} onChange={set("password")}
            autoComplete={isSignup ? "new-password" : "current-password"}
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          {isSignup && <span className="hint" style={{ marginTop: "0.4rem" }}>At least 8 characters.</span>}
        </div>
        {isSignup && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Invite code <span className="hint" style={{ display: "inline" }}>(if you were given one)</span></label>
            <input className="input" value={f.code} onChange={set("code")} />
          </div>
        )}

        <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy}>
          {busy ? <span className="working"><span className="spinner" /> Please wait…</span> : isSignup ? "Create account" : "Sign in"}
        </button>

        <p className="center muted" style={{ margin: 0, fontSize: "0.92rem" }}>
          {isSignup ? "Already have an account?" : "New here?"}{" "}
          <button className="btn-ghost" style={{ minHeight: "auto", padding: 0 }} onClick={() => { setErr(""); setMode(isSignup ? "login" : "signup"); }}>
            {isSignup ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
