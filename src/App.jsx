import { useEffect, useState } from "react";
import Library from "./components/Library.jsx";
import Intake from "./components/Intake.jsx";
import Workspace from "./components/Workspace.jsx";
import Auth from "./components/Auth.jsx";
import { listProjects, getProject, post, ai, auth } from "./api.js";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [view, setView] = useState("library");
  const [projects, setProjects] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Check existing session on load.
  useEffect(() => {
    auth("me").then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);

  useEffect(() => { if (user) loadLibrary(); }, [user]);

  async function loadLibrary() {
    setLoading(true); setErr("");
    try { setProjects(await listProjects()); }
    catch (e) {
      if (e.status === 401) setUser(null);
      else setErr(String(e.message || e));
    } finally { setLoading(false); }
  }

  async function openProject(id) {
    setLoading(true); setErr("");
    try { setCurrent(await getProject(id)); setView("workspace"); }
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

  function backToLibrary() { setCurrent(null); setView("library"); loadLibrary(); }

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
          <span className="muted" style={{ fontSize: "0.9rem" }}>{user.name || user.email}</span>
          <button className="btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="container">
        {err && <div className="banner error">{err}</div>}
        {loading && view === "library" ? (
          <div className="working"><span className="spinner" /> Loading…</div>
        ) : view === "library" ? (
          <Library projects={projects} onOpen={openProject} onNew={() => setView("intake")} />
        ) : view === "intake" ? (
          <Intake onCreate={createProject} onCancel={() => setView("library")} />
        ) : current ? (
          <Workspace
            project={current.project}
            sources={current.sources}
            drafts={current.drafts}
            onReload={reloadCurrent}
            onBack={backToLibrary}
            onDeleted={backToLibrary}
          />
        ) : null}
      </main>
    </div>
  );
}
