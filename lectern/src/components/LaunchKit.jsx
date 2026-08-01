// src/components/LaunchKit.jsx — marketing copy & metadata from the finished book.
import { useState } from "react";
import Spin from "./Spin.jsx";

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch { /* clipboard blocked; ignore */ }
  }
  return (
    <button className="btn btn-ghost" style={{ padding: "0.15rem 0.6rem", fontSize: "0.8rem" }} onClick={copy}>
      {done ? "Copied ✓" : "Copy"}
    </button>
  );
}

function Section({ title, copyText, children }) {
  return (
    <div className="card stack" style={{ gap: "0.5rem" }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span className="spacer" />
        {copyText ? <CopyBtn text={copyText} /> : null}
      </div>
      {children}
    </div>
  );
}

export default function LaunchKit({ kit, working, generating, onGenerate, hasDrafts }) {
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row">
          <div>
            <h3 style={{ margin: "0 0 0.2rem" }}>Launch kit</h3>
            <span className="hint">Marketing copy and store metadata drawn from your book — a strong first draft to refine, not final copy.</span>
          </div>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onGenerate} disabled={working || !hasDrafts}>
            {generating ? <Spin>Writing…</Spin> : kit ? "Regenerate" : "Generate launch kit"}
          </button>
        </div>
        {!hasDrafts && <span className="muted" style={{ fontSize: "0.85rem" }}>Draft some of the book first — the kit is written from your outline and content.</span>}
        {kit?.generatedAt && <span className="muted" style={{ fontSize: "0.8rem" }}>Generated {new Date(kit.generatedAt).toLocaleDateString()}</span>}
      </div>

      {kit && (
        <>
          {kit.tagline && (
            <Section title="Hook" copyText={kit.tagline}>
              <p style={{ margin: 0, fontFamily: "var(--display)", fontSize: "1.15rem" }}>{kit.tagline}</p>
            </Section>
          )}

          {kit.description && (
            <Section title="Book description" copyText={kit.description}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{kit.description}</p>
            </Section>
          )}

          {kit.backCover && (
            <Section title="Back-cover copy" copyText={kit.backCover}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{kit.backCover}</p>
            </Section>
          )}

          {kit.keywords?.length > 0 && (
            <Section title="Keywords" copyText={kit.keywords.join(", ")}>
              <div className="row" style={{ flexWrap: "wrap", gap: "0.4rem" }}>
                {kit.keywords.map((k, i) => <span key={i} className="status">{k}</span>)}
              </div>
            </Section>
          )}

          {kit.categories?.length > 0 && (
            <Section title="Categories" copyText={kit.categories.join("\n")}>
              <ul className="note-list" style={{ margin: 0 }}>{kit.categories.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </Section>
          )}

          {kit.bio && (
            <Section title="Author bio" copyText={kit.bio}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{kit.bio}</p>
              <span className="muted" style={{ fontSize: "0.82rem" }}>Fill in any [bracketed] placeholders with real details — nothing here is invented.</span>
            </Section>
          )}

          {kit.endorsementEmail && (
            <Section title="Endorsement request email" copyText={kit.endorsementEmail}>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{kit.endorsementEmail}</p>
            </Section>
          )}

          <div className="card muted" style={{ fontSize: "0.85rem" }}>
            This is AI-drafted marketing copy — accurate to your book but worth a personal pass before it goes public. The bio and endorsement email use placeholders rather than invented facts; nothing here fabricates credentials, quotes, or praise.
          </div>
        </>
      )}
    </div>
  );
}
