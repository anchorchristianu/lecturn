// src/components/Settings.jsx — manage your own Anthropic API key.
import { useState } from "react";
import Spin from "./Spin.jsx";
import { setMyKey, removeMyKey } from "../api.js";

export default function Settings({ user, onUpdated, onBack }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  async function save() {
    setErr(""); setMsg(""); setBusy("save");
    try {
      const { user: u } = await setMyKey(key.trim());
      onUpdated(u); setKey(""); setMsg("Key saved and verified with Anthropic.");
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(""); }
  }
  async function remove() {
    setErr(""); setMsg(""); setBusy("remove");
    try {
      const { user: u } = await removeMyKey();
      onUpdated(u); setMsg("Your key was removed.");
    } catch (e) { setErr(String(e.message || e)); }
    finally { setBusy(""); }
  }

  return (
    <div className="stack" style={{ maxWidth: 680 }}>
      <div className="row">
        <h1 style={{ margin: 0 }}>Settings</h1>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
      </div>

      <div className="card stack">
        <h3 style={{ margin: 0 }}>AI usage &amp; your API key</h3>
        <p className="muted" style={{ margin: 0 }}>
          Lectern's writing features run on Anthropic's Claude. You can let Lectern cover your usage, or add your
          own Anthropic API key so your AI activity bills to your own account.
        </p>

        {/* current status */}
        {user.hasKey ? (
          <div className="banner" style={{ background: "var(--brass-soft, #f3e9d2)", border: "1px solid var(--brass)" }}>
            You're using <b>your own Anthropic API key</b>. Your AI activity bills to your account.
          </div>
        ) : user.covered ? (
          <div className="banner" style={{ background: "#e8efe9", border: "1px solid var(--pine)" }}>
            Your AI usage is <b>currently covered by Lectern</b> — you don't need to add anything. You can still add your
            own key below if you'd prefer to use your own account.
          </div>
        ) : (
          <div className="banner error">
            <b>No API key on file.</b> Add your Anthropic API key below to turn on the writing features.
          </div>
        )}

        <div className="field" style={{ marginBottom: 0 }}>
          <label>{user.hasKey ? "Replace your key" : "Your Anthropic API key"}</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-..."
            autoComplete="off"
            spellCheck={false}
            style={{ fontFamily: "var(--mono, monospace)" }}
            disabled={!!busy}
          />
          <span className="hint">Pasted in, verified with Anthropic, and stored securely. It's never shown again or sent back to your browser.</span>
        </div>

        <div className="row">
          <button className="btn btn-primary" onClick={save} disabled={!!busy || !key.trim()}>
            {busy === "save" ? <Spin>Verifying…</Spin> : user.hasKey ? "Replace key" : "Save key"}
          </button>
          {user.hasKey && (
            <button className="btn btn-ghost" onClick={remove} disabled={!!busy}>
              {busy === "remove" ? <Spin>Removing…</Spin> : "Remove my key"}
            </button>
          )}
        </div>

        {err && <div className="banner error" style={{ marginBottom: 0 }}>{err}</div>}
        {msg && <p className="muted" style={{ margin: 0, color: "var(--pine)" }}>{msg}</p>}
      </div>

      <div className="card stack" style={{ gap: "0.4rem" }}>
        <h3 style={{ margin: 0 }}>How to get a key (and stay safe)</h3>
        <ol className="note-list" style={{ margin: 0, paddingLeft: "1.2rem" }}>
          <li>Sign in at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> and add a payment method.</li>
          <li>Go to <b>API Keys</b>, create a key, and copy it (you'll only see it once).</li>
          <li><b>Set a spend limit</b> on the key in the Anthropic console — this caps what can ever be charged, so you stay in control.</li>
          <li>Paste it above and save.</li>
        </ol>
      </div>
    </div>
  );
}
