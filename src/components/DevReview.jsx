// src/components/DevReview.jsx — renders a developmental editorial letter.
const STATUS = { strong: "ready", works: "ready", thin: "thin", problem: "empty" };

export default function DevReview({ review }) {
  if (!review) return null;
  return (
    <div className="stack">
      {review.overview && (
        <div className="card">
          <h3>The editorial letter</h3>
          <p style={{ marginTop: "0.4rem" }}>{review.overview}</p>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: "0.7rem" }}>
            {review.generatedAt ? `Reviewed ${new Date(review.generatedAt).toLocaleDateString()} · ` : ""}
            A coach's first read — strong for catching structural issues, but not a substitute for a human developmental editor on a high-stakes book.
          </p>
        </div>
      )}

      {review.priorities?.length > 0 && (
        <div className="card">
          <h3>Start here — the few things that matter most</h3>
          <ol className="note-list" style={{ listStyle: "decimal" }}>
            {review.priorities.map((p, i) => (
              <li key={i} style={{ marginBottom: "0.5rem" }}><b>{p.title}.</b> {p.detail}</li>
            ))}
          </ol>
        </div>
      )}

      {review.structure?.length > 0 && (
        <div className="card">
          <h3>Structure & argument</h3>
          {review.structure.map((s, i) => (
            <div key={i} style={{ marginTop: i ? "1.1rem" : "0.6rem" }}>
              <p style={{ margin: 0, fontWeight: 600 }}>{s.issue}</p>
              {s.why && <p className="muted" style={{ margin: "0.25rem 0" }}>{s.why}</p>}
              {s.suggestion && (
                <p style={{ margin: "0.25rem 0" }}>
                  <span style={{ color: "var(--pine)", fontWeight: 600 }}>Consider:</span> {s.suggestion}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {review.gaps?.length > 0 && (
        <div className="card">
          <h3>Promised but not yet delivered</h3>
          <ul className="note-list">{review.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
      )}

      {(review.audience || review.framework) && (
        <div className="card">
          {review.audience && (
            <>
              <h3>Audience fit</h3>
              <p style={{ marginTop: "0.3rem" }}>{review.audience}</p>
            </>
          )}
          {review.framework && (
            <>
              <h3 style={{ marginTop: review.audience ? "1.1rem" : 0 }}>Your framework</h3>
              <p style={{ marginTop: "0.3rem" }}>{review.framework}</p>
            </>
          )}
        </div>
      )}

      {review.strengths?.length > 0 && (
        <div className="card">
          <h3>What's working</h3>
          <ul className="note-list">{review.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}

      {review.chapters?.length > 0 && (
        <div className="card">
          <h3>Chapter by chapter</h3>
          {review.chapters.map((c, i) => (
            <div key={i} className="outline-item" style={{ marginTop: "0.9rem" }}>
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: "1.05rem" }}>{c.chapter}</h3>
                {c.assessment && <p className="purpose" style={{ marginTop: "0.15rem" }}>{c.assessment}</p>}
              </div>
              {c.status && <span className={`status ${STATUS[c.status] || "empty"}`}>{c.status}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
