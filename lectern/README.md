# Lectern

**Turn the spoken word into books.** Lectern takes the raw material a speaker
already produces — stories told on a walk, sermons already preached, talks and
lectures — and walks it through a calm, staged pipeline to a chapter draft. The
AI acts as an **editorial coach: it shapes and smooths the author's own words and
never invents content.** Where material is thin, it leaves a visible `[GAP: …]`
and asks a question instead of papering over the hole.

Built for an author who'd rather talk than type — and for a not-very-technical
user, so every screen has one obvious thing to do.

---

## The workflow

```
  Captured  ──▶  Sorted  ──▶  Shaped  ──▶  Drafted  ──▶  Polished
  (talk &        (AI files     (AI builds   (AI writes    (light
   paste in)      each piece    the chapter   chapters in   line
                  into themes)  outline +     your voice    edit)
                                names gaps)    from your
                                               material)
```

1. **Scope a book** — a short intake (focus, audience, purpose, material types,
   length, and a *voice sample*). The coach returns a one-paragraph brief, title
   ideas, and a provisional outline to react to. The brief + voice sample become
   the context injected into every later step.
2. **Add material** — paste a transcript (iOS Voice Memos auto-transcribes walks;
   YouTube captions cover sermons). **File it** and the AI summarizes it, tags
   themes, lists the stories in it, and suggests where it belongs.
3. **Shape** — build/refresh a chapter outline from everything filed, with a
   per-chapter status (ready / thin / empty) and a list of what's still missing.
   "Interview me" turns a chapter's gaps into questions to answer on the next walk.
4. **Write** — draft a chapter in the author's voice from its material only, then
   revise by talking back to it ("cut the second story," "warmer opening") or run
   a light polish pass.

---

## Architecture

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React + Vite (static) | No UI library; hand-rolled design system in `src/styles.css`. |
| Accounts | Built-in, in-stack | Email + scrypt-hashed passwords in Blobs; stateless HMAC-signed httpOnly session cookies. No third-party auth. |
| API | Netlify Functions (v2) | `auth.js`, `data.js`, `claude.js`. All require a valid session. |
| Storage | Netlify Blobs | Stores: `users`, `projects`, `sources`, `drafts` — all book data namespaced by user id. |
| Model | Claude API | `claude-sonnet-4-6` for shaping/drafting; `claude-haiku-4-5` for the sort pass. Prompt caching on each project's system context. |

**The prompt layer is `netlify/functions/lib/prompts.js`** — the "coach, never
author" rules live there and propagate into every action.

## Accounts & privacy

Each user signs up with email + password. Passwords are hashed with scrypt; the
session is a signed, httpOnly cookie (no token handled in JavaScript). Every
project, source, and draft key is prefixed with the user's id, so users only ever
see their own books. Set `SIGNUP_CODE` to make registration invite-only.

> This is real, self-contained auth suited to a private tool and a handful of
> invited authors. For a public, at-scale product, swap in a managed provider
> (Clerk, Auth0, WorkOS) — the seam is small: replace `auth.js` + `lib/session.js`
> and keep the per-user key prefix in `lib/store.js`.

## Where the model is used (and where it isn't)

The model is reserved for genuinely generative work. Everything repetitive or
deterministic runs in plain code, for free, in `lib/clean.js` + `src/metrics.js`:

| Step | How it runs |
|---|---|
| Clean transcripts (strip captions/timestamps/filler, collapse whitespace) | **Code** — before anything reaches the model |
| Tidy a draft (whitespace, `--`→—, `...`→…) | **Code** |
| Word counts, reading time, gap counts, progress stage | **Code** |
| Match sources → chapters for drafting | **Code** (uses the stored classification) |
| De-dupe identical pasted text | **Code** (content hash) |
| Scope a brief from intake | Model (once per book) |
| Understand / file a transcript | Model — Haiku (cheap) |
| Shape the outline · interview · draft · revise | Model — Sonnet |

Two more savings are built in: **prompt caching** marks each project's system
context (rules + brief + voice sample) as cacheable, so repeated drafting and
revising on the same book stops re-paying for it; and title suggestions are only
requested when the author didn't type a title.

## Architecture (files)

```
src/
  App.jsx                 session check + routing + topbar
  api.js                  fetch helpers (cookie auth)
  stages.js               derive position on the voice→page rail
  metrics.js              code-only word/gap/reading-time counts
  components/
    Auth.jsx              login / signup
    Library.jsx           dashboard of books
    Intake.jsx            the scoping questionnaire
    Workspace.jsx         Material / Shape / Write tabs (all AI actions)
    StageRail.jsx         the signature progress rail
    DraftView.jsx         markdown reader that highlights [GAP: …]
netlify/functions/
    auth.js               signup / login / logout / me  → /api/auth
    claude.js             AI actions  → /api/claude
    data.js               CRUD        → /api/data
    lib/prompts.js        the editorial brain  ◀ tune this
    lib/store.js          Blobs wrapper, per-user namespacing
    lib/session.js        password hashing + signed session cookies
    lib/clean.js          deterministic text cleaning + metrics (no model)
```

---

## Deploy (GitHub → Netlify)

1. **Push to GitHub.** Create a repo and push this folder.
2. **Create the Netlify site.** In Netlify → *Add new site → Import from Git* →
   pick the repo. Build settings auto-detect from `netlify.toml`
   (build `npm run build`, publish `dist`).
3. **Set environment variables** (Site configuration → Environment variables):
   - `ANTHROPIC_API_KEY` — **required**
   - `SESSION_SECRET` — **required**; a long random string (`openssl rand -hex 32`)
   - `SIGNUP_CODE` — optional; require this code to create an account
   - `MODEL_MAIN`, `MODEL_SORT` — optional overrides
4. **Deploy.** Netlify Blobs is enabled automatically; no extra setup.

### Run locally

```bash
npm install
npm install -g netlify-cli      # provides functions + Blobs locally
printf "ANTHROPIC_API_KEY=sk-ant-...\nSESSION_SECRET=$(openssl rand -hex 32)\n" > .env
netlify dev                     # serves the app + functions together
```

> Use `netlify dev` (not plain `vite`) for local work, so the `/api/*` functions
> and Blobs storage are available.

---

## Cost

Sorting runs on Haiku (cheap, high volume). Shaping, interviewing, drafting, and
polishing run on Sonnet. Transcript cleaning, tidying, counts, and source↔chapter
matching are plain code and cost nothing. With prompt caching on each book's
context, a typical book is dollars, not hundreds. Set
[usage limits in the Anthropic console](https://console.anthropic.com), and use
`SIGNUP_CODE` so only invited authors can create accounts.

---

## Extension seams (v2)

- **Audio upload.** The Claude API doesn't transcribe audio, so v1 is text-in.
  Add a `transcribe.js` function (OpenAI Whisper or Deepgram) that returns text,
  then run it through `cleanTranscript` before `addSource`.
- **Export.** Add a "Compile" action that stitches drafts into one document
  (Markdown → `.docx`/EPUB) — pure code, no model call.
- **Managed auth at scale.** Replace `auth.js` + `lib/session.js` with Clerk/Auth0
  if you open public signups; keep the per-user key prefix in `lib/store.js`.
- **Version history.** Drafts carry a `version`; keep prior versions as separate
  blobs to allow rollback.

---

*Lectern is a working name — rename freely.*
