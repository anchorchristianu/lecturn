import { useState } from "react";
import { auth } from "../api.js";

export default function Auth({ onAuthed }) {
  const [mode, setMode] = useState("login"); // login | signup | recover
  const [f, setF] = useState({ email: "", password: "", name: "", code: "" });
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState(""); // neutral confirmation after a reset request
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Switch modes without carrying over an error or stale confirmation.
  function go(next) { setErr(""); setNotice(""); setMode(next); }

  async function submit() {
    setErr(""); setBusy(true);
    try {
      if (mode === "recover") {
        const r = await auth("requestReset", { email: f.email });
        setNotice(r.message || "Thanks. If an account uses that email, your administrator can set a new password for it.");
        setBusy(false);
        return;
      }
      const { user } = await auth(mode, f);
      onAuthed(user);
    } catch (e) {
      setErr(String(e.message || e));
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";
  const isRecover = mode === "recover";

  return (
    <div className="gate">
      <div className="card stack" style={{ maxWidth: 420 }}>
        <div className="center">
          <span className="mark" style={{ fontFamily: "var(--display)", fontSize: "1.8rem", color: "var(--pine)" }}>Lectern</span>
          <p className="muted" style={{ margin: "0.3rem 0 0" }}>your voice, bound into books</p>
        </div>

        {err && <div className="banner error">{err}</div>}

        {isRecover ? (
          notice ? (
            // After a request: calm confirmation and one clear way back.
            <>
              <div className="banner ok">{notice}</div>
              <button className="btn btn-primary btn-lg" onClick={() => go("login")}>Back to sign in</button>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0, fontSize: "0.95rem", lineHeight: 1.5 }}>
                Your sign-in name is the <b>email address</b> you signed up with. Enter it below and
                we'll let your administrator set a new password and get it to you.
              </p>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Email</label>
                <input className="input" type="email" value={f.email} onChange={set("email")} autoComplete="email"
                  onKeyDown={(e) => e.key === "Enter" && submit()} />
              </div>
              <button className="btn btn-primary btn-lg" onClick={submit} disabled={busy}>
                {busy ? <span className="working"><span className="spinner" /> Please wait…</span> : "Request a password reset"}
              </button>
              <p className="center muted" style={{ margin: 0, fontSize: "0.92rem" }}>
                Remembered it?{" "}
                <button className="btn-ghost" style={{ minHeight: "auto", padding: 0 }} onClick={() => go("login")}>Back to sign in</button>
              </p>
            </>
          )
        ) : (
          <>
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

            {!isSignup && (
              <p className="center" style={{ margin: 0 }}>
                <button className="btn-ghost" style={{ minHeight: "auto", padding: 0, fontSize: "0.92rem" }} onClick={() => go("recover")}>
                  Forgot your password?
                </button>
              </p>
            )}

            <p className="center muted" style={{ margin: 0, fontSize: "0.92rem" }}>
              {isSignup ? "Already have an account?" : "New here?"}{" "}
              <button className="btn-ghost" style={{ minHeight: "auto", padding: 0 }} onClick={() => go(isSignup ? "login" : "signup")}>
                {isSignup ? "Sign in" : "Create one"}
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
