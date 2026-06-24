import StageRail from "./StageRail.jsx";
import { fmt } from "../metrics.js";

export default function Library({ projects, onOpen, onNew }) {
  return (
    <div>
      <div className="library-head">
        <div>
          <h1>Your books</h1>
          <p>Talk on your walk. The book takes shape here.</p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={onNew}>Start a new book</button>
      </div>

      {projects.length === 0 ? (
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
        <div className="booklist">
          {projects.map((p) => (
            <button key={p.id} className="card bookcard" onClick={() => onOpen(p.id)}>
              <h3>{p.title}</h3>
              <p className="brief">{p.brief || "No brief yet."}</p>
              <StageRail project={p} sources={[]} drafts={[]} />
              <div className="meta">
                <span><b>{(p.outline || []).length}</b> chapters</span>
                <span><b>{p.counts?.sources || 0}</b> filed</span>
                <span><b>{fmt(p.counts?.words || 0)}</b> words drafted</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
