import { useEffect, useState, useRef } from "react";
import Library from "./components/Library.jsx";
import Intake from "./components/Intake.jsx";
import Workspace from "./components/Workspace.jsx";
import Auth from "./components/Auth.jsx";
import AdminDashboard from "./components/AdminDashboard.jsx";
import Settings from "./components/Settings.jsx";
import { listProjects, getProject, post, ai, auth } from "./api.js";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [view, setView] = useState("library");
  const [projects, setProjects] = useState([]);
  const [current, setCurrent] = useState(null);
  const [wsTab, setWsTab] = useState("sources"); // active workspace tab, mirrored to URL
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Captured once at first render, before any effect can rewrite the hash —
  // this is the screen the user refreshed on.
  const initialHashRef = useRef(typeof window !== "undefined" ? window.location.hash : "");
  const restoredRef = useRef(false);

  // Check existing session on load.
  useEffect(() => {
    auth("me").then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);

  // Once signed in: load the library and restore whatever screen the URL points
  // at (so a browser refresh stays put instead of bouncing home).
  useEffect(() => {
    if (!user) return;
    loadLibrary();
    if (restoredRef.current) return;
    restoredRef.current = true;
    const [seg, id, tab] = (initialHashRef.current || "").replace(/^#\/?/, "").split("/");
    if (seg === "admin" && user.isAdmin) setView("admin");
    else if (seg === "settings") setView("settings");
    else if (seg === "new") setView("intake");
    else if (seg === "book" && id) openProject(id, tab);
  }, [user]);

  // Mirror the current screen into the URL hash so refresh / bookmarking works.
  useEffect(() => {
    if (!user) return;
    let hash = "#/";
    if (view === "admin") hash = "#/admin";
    else if (view === "settings") hash = "#/settings";
    else if (view === "intake") hash = "#/new";
    else if (view === "workspace" && current?.project?.id) hash = `#/book/${current.project.id}/${wsTab || "sources"}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  }, [view, current, wsTab, user]);

  async function loadLibrary() {
    setLoading(true); setErr("");
    try { setProjects(await listProjects()); }
    catch (e) {
      if (e.status === 401) setUser(null);
      else setErr(String(e.message || e));
    } finally { setLoading(false); }
  }

  async function openProject(id, tab) {
    setLoading(true); setErr("");
    try {
      const c = await getProject(id);
      setWsTab(tab || "sources");
      setCurrent(c);
      setView("workspace");
    }
    catch (e) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  }

  async function reloadCurrent() {
    if (current?.project?.id) setCurrent(await getProject(current.project.id));
  }

  async function createProject(intake) {
    const r = await ai("intake_summary", { intake });
    const { project } = await post({
      op: "createProject",
      project: {
        title: intake.title || r.titles?.[0] || "Untitled book",
        intake,
        brief: r.brief || "",
        voiceSample: intake.voiceSample || "",
        outline: r.outline || [],
        questions: r.questions || [],
      },
    });
    await loadLibrary();
    await openProject(project.id);
  }

  function backToLibrary() { setCurrent(null); setView("library"); loadLibrary(); refreshMe(); }

  // Re-check coverage / key status (e.g. after an admin toggles coverage) so the
  // "add a key" banner reflects reality without a full page reload. Only updates
  // state when something relevant changed, to avoid needless reloads.
  async function refreshMe() {
    try {
      const { user: u } = await auth("me");
      if (u) setUser((prev) => (prev && u.covered === prev.covered && u.hasKey === prev.hasKey && u.isAdmin === prev.isAdmin ? prev : u));
    } catch { /* ignore */ }
  }

  async function logout() {
    await auth("logout").catch(() => {});
    setUser(null); setProjects([]); setCurrent(null); setView("library");
  }

  if (user === undefined) {
    return <div className="gate"><div className="working"><span className="spinner" /> Loading…</div></div>;
  }
  if (!user) return <Auth onAuthed={setUser} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand" role="button" onClick={backToLibrary} style={{ cursor: "pointer" }}>
          <span className="mark">Lectern</span>
          <span className="tag">your voice, bound into books</span>
        </div>
        <div className="row" style={{ gap: "0.75rem" }}>
          {user.isAdmin && (
            <button className="btn-ghost" onClick={() => setView(view === "admin" ? "library" : "admin")}>
              {view === "admin" ? "← Back" : "Admin"}
            </button>
          )}
          <a className="btn-ghost" href="/help.html" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>Help</a>
          <button className="btn-ghost" onClick={() => setView(view === "settings" ? "library" : "settings")}>
            {view === "settings" ? "← Back" : "Settings"}
          </button>
          <span className="muted" style={{ fontSize: "0.9rem" }}>{user.name || user.email}</span>
          <button className="btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="container">
        {err && <div className="banner error">{err}</div>}
        {user && !user.covered && !user.hasKey && view !== "settings" && (
          <div className="banner" style={{ background: "var(--brass-soft, #f3e9d2)", border: "1px solid var(--brass)" }}>
            AI writing features need an Anthropic API key.{" "}
            <button className="btn-ghost" style={{ padding: 0, textDecoration: "underline", fontWeight: 600 }} onClick={() => setView("settings")}>
              Add yours in Settings →
            </button>
          </div>
        )}
        {view === "admin" ? (
          <AdminDashboard onBack={() => { setView("library"); refreshMe(); }} onUserChanged={refreshMe} />
        ) : view === "settings" ? (
          <Settings user={user} onUpdated={setUser} onBack={() => setView("library")} />
        ) : loading && view === "library" ? (
          <div className="working"><span className="spinner" /> Loading…</div>
        ) : view === "library" ? (
          <Library projects={projects} user={user} onOpen={openProject} onNew={() => setView("intake")} />
        ) : view === "intake" ? (
          <Intake onCreate={createProject} onCancel={() => setView("library")} />
        ) : current ? (
          <Workspace
            key={current.project.id}
            project={current.project}
            sources={current.sources}
            drafts={current.drafts}
            user={user}
            initialTab={wsTab}
            onTabChange={setWsTab}
            onReload={reloadCurrent}
            onBack={backToLibrary}
            onDeleted={backToLibrary}
          />
        ) : null}
      </main>
    </div>
  );
}
