# Stillpoint

A quiet, offline-capable meditation timer. Build a session from timed segments, each with an optional synthesized chime or bell cue at the start and end. All audio is generated live with the Web Audio API — no sample files, no network calls after the first load.

## Running locally

**Requirements:** Node ≥ 20. The repo pins 22.18.0 via `.node-version`; if you use [nodenv](https://github.com/nodenv/nodenv) it will pick this up automatically.

```sh
git clone <this-repo>
cd stillpoint
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The dev server has hot module replacement; the service worker is disabled in dev mode so HMR isn't shadowed by a stale precache.

### Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Type-check, then emit `dist/` |
| `npm run preview` | Serve the production `dist/` build locally |
| `npm run typecheck` | Type-check only (no emit) |

Use `npm run build && npm run preview` to test the service worker and offline behaviour — the SW is only active in the production build.

---

## Deploying to GitHub Pages

### Option A — GitHub Actions (recommended)

This repo includes a workflow that builds on every push to `main` and publishes `dist/` to GitHub Pages automatically.

1. Push the repo to GitHub.
2. Go to **Settings → Pages** and set the source to **GitHub Actions**.
3. That's it — the workflow at `.github/workflows/deploy.yml` handles the rest.

Every push to `main` will trigger a build and deploy. The live URL will be `https://<your-username>.github.io/<repo-name>/`.

### Option B — Manual deploy

If you prefer to deploy from your machine without CI:

```sh
npm run build
npx gh-pages -d dist
```

Install `gh-pages` first if needed (`npm install --save-dev gh-pages`). This pushes `dist/` to the `gh-pages` branch, which GitHub Pages will serve.

### Sub-path note

The Vite config uses `base: './'` so asset URLs are relative — the app works whether served from the root of a domain or a sub-path like `/stillpoint/`. No changes needed for a standard GitHub Pages deployment.

---

## Tech

- **Vite 6 + vanilla TypeScript** — no UI framework, static files only
- **Web Audio API** — synthesized chimes (harmonic partials) and bells (inharmonic stretched partials); no audio files
- **vite-plugin-pwa** — auto-versioned service worker, 84 precached assets (fonts, app shell, icons)
- **@fontsource** — self-hosted Spectral + DM Sans, precached for true offline
- **localStorage** — three namespaced keys (`stillpoint.last`, `stillpoint.saved`, `stillpoint.sound`)
