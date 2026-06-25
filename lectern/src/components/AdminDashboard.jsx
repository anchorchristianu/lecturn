// src/components/AdminDashboard.jsx
import { useEffect, useState } from "react";
import { admin } from "../api.js";

const fmt = (n) => (n || 0).toLocaleString();
function tok(n) {
  n = n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
const money = (n) => "$" + (n || 0).toFixed(2);

function Stat({ label, value, sub }) {
  return (
    <div className="card" style={{ flex: "1 1 150px", minWidth: 150 }}>
      <div style={{ fontFamily: "var(--display)", fontSize: "1.8rem", fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
      <div className="muted" style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>{label}</div>
      {sub && <div className="muted" style={{ fontSize: "0.78rem", marginTop: "0.15rem" }}>{sub}</div>}
    </div>
  );
}

function UserRow({ u }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr style={{ borderTop: "1px solid var(--line)" }}>
        <td style={{ padding: "0.6rem 0.5rem" }}>
          <div style={{ fontWeight: 600 }}>{u.name || u.email}</div>
          {u.name && <div className="muted" style={{ fontSize: "0.8rem" }}>{u.email}</div>}
        </td>
        <td style={{ textAlign: "center" }}>{u.projects}</td>
        <td style={{ textAlign: "center" }}>{u.avgPct}%</td>
        <td style={{ textAlign: "right" }}>{fmt(u.words)}</td>
        <td style={{ textAlign: "right" }}>{fmt(u.aiCalls)}</td>
        <td style={{ textAlign: "right" }}>{tok(u.inputTokens)} / {tok(u.outputTokens)}</td>
        <td style={{ textAlign: "right" }}>{money(u.estCost)}</td>
        <td style={{ textAlign: "center" }}>
          {u.projects > 0 && (
            <button className="btn btn-ghost" style={{ padding: "0.1rem 0.5rem", fontSize: "0.8rem" }} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "Books"}
            </button>
          )}
        </td>
      </tr>
      {open && u.projectList.map((p) => (
        <tr key={p.id} style={{ background: "var(--surface-2)" }}>
          <td style={{ padding: "0.35rem 0.5rem 0.35rem 1.4rem" }} colSpan={2}>
            <span style={{ fontStyle: "italic" }}>{p.title}</span>
          </td>
          <td style={{ textAlign: "center" }}>{p.pct}%</td>
          <td style={{ textAlign: "right" }}>{fmt(p.words)}</td>
          <td colSpan={2} className="muted" style={{ fontSize: "0.8rem", textAlign: "right" }}>
            {p.drafted}/{p.chapters} chapters drafted
          </td>
          <td colSpan={2}></td>
        </tr>
      ))}
    </>
  );
}

export default function AdminDashboard({ onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setErr("");
    try { setData(await admin()); }
    catch (e) { setErr(e.status === 403 ? "You don't have admin access." : String(e.message || e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div className="working"><span className="spinner" /> Loading dashboard…</div>;
  if (err) return <div className="banner error">{err}</div>;
  if (!data) return null;

  const o = data.overall;
  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ fontFamily: "var(--display)", margin: 0 }}>Admin dashboard</h2>
        <span className="spacer" />
        <button className="btn btn-ghost" onClick={load}>Refresh</button>
      </div>

      <div className="row" style={{ flexWrap: "wrap", gap: "0.7rem" }}>
        <Stat label="Users" value={fmt(o.users)} />
        <Stat label="Book projects" value={fmt(o.projects)} sub={`${o.inProgress} in progress · ${o.completeish} fully drafted`} />
        <Stat label="Avg. complete" value={o.avgPct + "%"} sub="chapters drafted / planned" />
        <Stat label="Words written" value={fmt(o.words)} />
        <Stat label="AI calls" value={fmt(o.aiCalls)} sub={`${tok(o.inputTokens)} in · ${tok(o.outputTokens)} out`} />
        <Stat label="Est. AI cost" value={money(o.estCost)} sub="estimate — see note" />
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <h3 style={{ marginTop: 0 }}>By user</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.92rem" }}>
          <thead>
            <tr className="muted" style={{ textAlign: "left", fontSize: "0.8rem" }}>
              <th style={{ padding: "0.3rem 0.5rem" }}>User</th>
              <th style={{ textAlign: "center" }}>Books</th>
              <th style={{ textAlign: "center" }}>Avg %</th>
              <th style={{ textAlign: "right" }}>Words</th>
              <th style={{ textAlign: "right" }}>AI calls</th>
              <th style={{ textAlign: "right" }}>Tokens (in/out)</th>
              <th style={{ textAlign: "right" }}>Est. cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => <UserRow key={u.email} u={u} />)}
            {data.users.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ padding: "0.8rem 0.5rem" }}>No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card muted" style={{ fontSize: "0.85rem" }}>
        <b>About these numbers.</b> “% complete” is chapters drafted divided by chapters planned in the outline.
        AI usage is tracked per call from the moment usage tracking was deployed, so it won't include earlier activity.
        Estimated cost applies assumed per-token rates (Sonnet ~$3/$15 per million in/out; Haiku ~$0.80/$4) and is a rough
        figure for relative comparison — your Anthropic console remains the source of truth for billing. This is separate
        from Netlify build credits.
      </div>
    </div>
  );
}
