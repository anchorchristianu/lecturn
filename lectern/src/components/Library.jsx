import { useState } from "react";
import StageRail from "./StageRail.jsx";
import { fmt } from "../metrics.js";

export default function Library({ projects, user, onOpen, onNew, onArchive, onDelete }) {
  const [showArchived, setShowArchived] = useState(false);
  const roleLabel = (r) => (r === "author" ? "Co-author" : r === "editor" ? "Editor" : null);
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);

  function confirmDelete(p) {
    if (window.confirm(`Delete "${p.title}" and everything in it? This can't be undone.`)) onDelete?.(p.id);
  }

  function Card({ p, isArchived }) {
    const owner = p.myRole === "owner";
    return (
      <div
        className={`card bookcard${isArchived ? " archived" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(p.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p.id); } }}
      >
        <h3>
          {p.title}
          {roleLabel(p.myRole) && <span className="status" style={{ marginLeft: "0.5rem", fontSize: "0.7rem", verticalAlign: "middle" }}>{roleLabel(p.myRole)}</span>}
        </h3>
        <p className="brief">{p.brief || "No brief yet."}</p>
        <StageRail project={p} sources={[]} drafts={[]} />
        <div className="meta">
          <span><b>{(p.outline || []).length}</b> chapters</span>
          <span><b>{p.counts?.sources || 0}</b> filed</span>
          <span><b>{fmt(p.counts?.words || 0)}</b> words drafted</span>
        </div>
        {owner && (
          <div className="bookcard-actions" onClick={(e) => e.stopPropagation()}>
            {isArchived
              ? <button className="btn btn-ghost" onClick={() => onArchive?.(p.id, false)}>Unarchive</button>
              : <button className="btn btn-ghost" onClick={() => onArchive?.(p.id, true)}>Archive</button>}
            <button className="btn btn-ghost" style={{ color: "var(--danger)" }} onClick={() => confirmDelete(p)}>Delete</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="library-head">
        <div>
          <h1>Your books</h1>
          <p>Talk on your walk. The book takes shape here.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={onNew}>Start a new book</button>
      </div>

      {active.length === 0 && archived.length === 0 ? (
        <div className="empty card">
          <div className="quill">✒︎</div>
          <h2>Nothing on the lectern yet</h2>
          <p>
            Every book here begins as a recording — a story told on a walk, or a
            sermon you already preached. Start one, and bring the talking.
          </p>
          <button className="btn btn-primary btn-lg" onClick={onNew}>Start your first book</button>
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            <div className="card center muted">Your active shelf is empty — everything is archived. Start a new book, or show your archived ones below.</div>
          ) : (
            <div className="booklist">
              {active.map((p) => <Card key={p.id} p={p} />)}
            </div>
          )}

          {archived.length > 0 && (
            <div style={{ marginTop: "2rem" }}>
              <button className="btn-ghost" style={{ padding: 0, fontWeight: 600 }} onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? "▾" : "▸"} Archived ({archived.length})
              </button>
              {showArchived && (
                <div className="booklist" style={{ marginTop: "1rem" }}>
                  {archived.map((p) => <Card key={p.id} p={p} isArchived />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
