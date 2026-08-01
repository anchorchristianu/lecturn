// src/components/Collaborators.jsx — the Team panel.
// Owner manages who's on the book and their roles. Co-authors carry their own
// voice; editors/ghostwriters carry none (they keep each chapter's assigned voice).
import { useState } from "react";
import Spin from "./Spin.jsx";

const ROLE_LABEL = { owner: "Owner", author: "Co-author", editor: "Editor / ghostwriter" };
const inp = { padding: "0.5rem 0.7rem", border: "1px solid var(--line-strong)", borderRadius: 8, font: "inherit", background: "var(--surface)" };

function VoiceEditor({ member, canEdit, working, onSave }) {
  const [val, setVal] = useState(member.voiceSample || "");
  const dirty = val !== (member.voiceSample || "");
  return (
    <div className="stack" style={{ gap: "0.4rem", marginTop: "0.5rem" }}>
      <label className="muted" style={{ fontSize: "0.85rem" }}>Voice sample</label>
      <textarea
        className="textarea"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        disabled={!canEdit || working}
        placeholder="Paste a paragraph or two this author actually wrote or spoke — enough to capture how they sound. Their chapters are drafted and edited in this voice."
        style={{ minHeight: 90 }}
      />
      {canEdit && (
        <div className="row">
          <button className="btn btn-primary" style={{ padding: "0.3rem 0.8rem", fontSize: "0.85rem" }} onClick={() => onSave(member.uid, val)} disabled={working || !dirty}>
            {working ? <Spin>Saving…</Spin> : "Save voice"}
          </button>
          {dirty && <span className="muted" style={{ fontSize: "0.8rem" }}>Unsaved</span>}
          {!member.voiceSample && <span className="muted" style={{ fontSize: "0.8rem" }}>No voice captured yet — chapters fall back to the owner's voice.</span>}
        </div>
      )}
    </div>
  );
}

export default function Collaborators({ members, me, isOwner, ownerId, working, onInvite, onRemove, onChangeRole, onSaveVoice }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("author");
  const owner = members.find((m) => m.role === "owner");
  const others = members.filter((m) => m.role !== "owner");
  const ordered = [owner, ...others].filter(Boolean);

  return (
    <div className="stack">
      <div className="card stack">
        <h3 style={{ margin: "0 0 0.2rem" }}>Team</h3>
        <span className="hint">
          Co-authors write in their own voice and can be assigned chapters. Editors and ghostwriters can edit anything,
          but every chapter stays in its assigned author's voice — so the book reads as one person even when others do the work.
        </span>
      </div>

      {isOwner && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Invite a collaborator</h3>
          <span className="hint">They'll need a Lectern account first — invite the email they signed up with.</span>
          <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their@email.com" type="email" style={{ ...inp, flex: "2 1 220px" }} disabled={working} />
            <select value={role} onChange={(e) => setRole(e.target.value)} disabled={working} style={inp}>
              <option value="author">Co-author (own voice)</option>
              <option value="editor">Editor / ghostwriter</option>
            </select>
            <button className="btn btn-primary" onClick={() => { if (email.trim()) { onInvite(email.trim(), role); setEmail(""); } }} disabled={working || !email.trim()}>
              {working ? <Spin>Working…</Spin> : "Invite"}
            </button>
          </div>
        </div>
      )}

      {ordered.map((m) => {
        const canEditVoice = (isOwner || m.uid === me) && m.role !== "editor";
        return (
          <div key={m.uid} className="card stack">
            <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <b>{m.name || m.email}</b>{m.uid === me && <span className="muted"> (you)</span>}
                <div className="muted" style={{ fontSize: "0.85rem" }}>{m.email}</div>
              </div>
              <span className="spacer" />
              {isOwner && m.role !== "owner" ? (
                <select value={m.role} onChange={(e) => onChangeRole(m.uid, e.target.value)} disabled={working} style={{ ...inp, padding: "0.3rem 0.5rem" }}>
                  <option value="author">Co-author</option>
                  <option value="editor">Editor / ghostwriter</option>
                </select>
              ) : (
                <span className="status">{ROLE_LABEL[m.role]}</span>
              )}
              {isOwner && m.role !== "owner" && (
                <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.82rem" }} onClick={() => { if (confirm(`Remove ${m.name || m.email} from this book?`)) onRemove(m.uid); }} disabled={working}>Remove</button>
              )}
            </div>
            {m.role !== "editor" ? (
              <VoiceEditor member={m} canEdit={canEditVoice} working={working} onSave={onSaveVoice} />
            ) : (
              <span className="muted" style={{ fontSize: "0.85rem" }}>Keeps each chapter in its assigned author's voice — no separate voice needed.</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
