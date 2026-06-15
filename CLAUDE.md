# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: production build-out in progress

The **production app** is being built at the repo root as a **Vite 6 + vanilla TypeScript** project (no UI framework), following the module boundaries in Design-Doc §13 / Build-Spec §11. The architecture decision and rationale are recorded in `docs/ADR/0001-frontend-architecture.md`.

The original vanilla prototype now lives in **`reference/`** (`app.js`, `tweaks.js`, `sw.js`, `index.html`, `styles.css`, `manifest.json`). **It is the behavioral reference — port behavior, not necessarily code** — and is no longer served or built. Above all it pins the audio engine and the do-not-regress behaviors. Do not extend the `reference/` files; build the production equivalents under `src/`.

Production module boundaries (prefer these over a single IIFE): `AudioEngine`, `Timer`, `Persistence`, `Theming`, `UI`.

### Build status by phase
- **Phase 1 — Scaffold (done).** Vite 6 + TS, `vite-plugin-pwa` (auto-versioned SW + font precache), self-hosted Spectral/DM Sans via `@fontsource`, `src/types.ts` (Build-Spec §1 schemas), ported `src/styles.css` + OKLCH palettes, `index.html` app shell. `npm run build` + dev server verified. Requires **Node ≥20** (pinned in `.node-version` / `engines`).
- **Phase 2 — AudioEngine (done).** `src/audio/AudioEngine.ts` — DOM-free class; full chime (`strikeVoice`) + bell (`strikeRin`) voices ported verbatim; all 11 tunable params via `SoundParams`/`setParams()`; `play(kind)` + `preview(kind)` API; `resume()` for lazy AudioContext creation after user gesture. All numeric constants preserved exactly from Build-Spec §4.
- **Phase 3 — Persistence (done).** `src/persistence/Store.ts` — thin localStorage adapter; `loadLast`/`saveLast` (working session), `loadSaved`/`upsertSaved`/`deleteSaved` (bookmarks, case-insensitive upsert, newest-first), `loadSoundParams`/`saveSoundParams` (replaces EDITMODE mechanism); all reads/writes try/catch wrapped.
- **Phase 4 — Theming + Builder UI (done).** `src/theme/Theming.ts` (palette swap, greeting split, clock, 30 s interval + focus). `src/ui/format.ts` (fmtClock, fmtTotal, escapeHtml shared by Builder + Runner). `src/ui/Builder.ts` — full Builder class: session name, view/edit segment rendering, numField (blur-reformat-in-place A11Y-3, type=text+inputmode=numeric for sec A11Y-4), soundPicker chips (aria-pressed + engine.preview()), total display, bookmark upsert, two-tap clear (3.5 s auto-cancel, outside-click cancel A11Y-5), Begin disabled at 0, bookmarked list (load/delete), tab-walk A11Y-1, toast. `main.ts` wires engine + builder + theme; Begin callback stubbed for Phase 5 Runner.
- **Phase 5 — Timer + Runner (done).** `src/timer/Timer.ts` — pure, DOM-free wall-clock loop; drift-free (`elapsed = (Date.now()-startAt)/1000`, never accumulates deltas); precomputes `bounds[]` for total-remaining; 700 ms frozen handoff between segments; pause shifts `startAt` forward; `TimerCallbacks` interface (onSegmentStart, onTick, onSegmentEnd, onComplete). `src/ui/Runner.ts` — Runner UI class; subscribes to Timer; Screen Wake Lock (re-acquired on visibilitychange); ambient dim at 6 s + brighten at 4 s; progress dots; Pause/Resume; End/"Return home"; wires into Builder via `onEnd` → `builder.onReturnHome()`. `main.ts` updated: both modules mounted, Begin callback fully wired.
- **Phase 6 — Settings panel (done).** `src/ui/Settings.ts` — in-app sound settings panel replacing the EDITMODE/host-rewrite mechanism; sliders for all 11 params (Pitch, Warmth, Sustain, Shimmer/Warble, Notes, Spread, Volume) with live display values; segmented control for bellRings (1/2/3); "Hear it" preview buttons per group; reads `loadSoundParams()` on mount, calls `engine.setParams()` + `saveSoundParams()` on every change; Escape to close. Trigger button added to welcome header (`#settingsBtn`). Panel CSS added to `styles.css`. Wired in `main.ts`: `engine.resume()` called on open so AudioContext is ready for previews.
- **Phase 7 — PWA hardening (done).** Audit confirmed: skipWaiting ✓, clientsClaim ✓, cleanupOutdatedCaches ✓, 84 precache entries (fonts, app shell, icons, webmanifest), all icons present. Two fixes applied: (1) added `navigateFallback: 'index.html'` + `navigateFallbackDenylist` so offline navigations serve the app shell (`createHandlerBoundToURL` confirmed in built SW); (2) moved `registerSW` inside `boot()` so `onRegistered`/`onRegisterError` callbacks always fire after `builder.mount()` — SW footnote status guaranteed to have a live DOM ref. `globPatterns` extended to include `.webmanifest`. Preview server confirmed all shell assets serve 200.
- Phase 8 (acceptance pass) — pending.

### Working practice — keep this file current (every agent must follow this)

As the production app takes shape, CLAUDE.md must always reflect the *current* state of the code. Concretely:

1. **Migrate code and its docs in the same change.** When you port or replace a piece (e.g. the audio engine becomes a real `AudioEngine` module), edit the corresponding CLAUDE.md section in that same change. Never leave this file describing code that no longer exists.
2. **Preserve the locked parts verbatim.** The **do-not-regress list** and the **exact audio constants/parameters** (Build-Spec §4, §13) carry across the rewrite unchanged. Re-verify them after a migration; do not silently re-tune them.
3. **Retire prototype-specific guidance as it stops applying.** Anything describing the single-IIFE `app.js`, the `STILLPOINT_TWEAKS` global, or the EDITMODE/host mechanism should be removed or rewritten once the production equivalent lands — don't let stale instructions accumulate.
4. **Keep it thin; rationale lives in `docs/`.** This file is a fast orientation layer (how to run, what's locked, what's deliberately being replaced). Put detailed *why* in `docs/` and link to it rather than duplicating it here. The docs remain the source of truth.

## What it does

Stillpoint is a client-only, offline-capable meditation timer. The user builds a session out of timed *segments* (each with optional start/end sound cues), then runs it. All audio is synthesized live with the Web Audio API (no sample files); all state is `localStorage`.

## Running / developing

Production app (repo root, Vite + TS). Requires Node ≥20 (`.node-version` pins 22.18.0; `nodenv` is available):

```sh
npm install
npm run dev        # Vite dev server (HMR; SW disabled in dev)
npm run build      # tsc --noEmit, then vite build → dist/
npm run preview    # serve the production dist/ build
npm run typecheck  # tsc --noEmit only
```

The service worker is **generated by `vite-plugin-pwa` and auto-versioned** per build — there is no longer a manual `stillpoint-vN` cache constant to bump. To verify changes, run `npm run dev` and exercise the flow; for SW/offline behavior use `npm run build && npm run preview`.

> The legacy prototype in `reference/` has no build step; if you need to run it for comparison, serve that folder over HTTP (`cd reference && python3 -m http.server 8000`).

**Known dependency note:** `npm audit` reports a high-severity **esbuild** advisory pulled in transitively via Vite. It affects the **dev server only** (not the shipped static build); the sole remediation is a breaking jump to Vite 8, deliberately deferred to keep the toolchain on established Vite 6.

## Authoritative documentation

Two hand-written docs in `docs/` are the source of truth and far more detailed than this file — read them before non-trivial work:

- `docs/Stillpoint-Design-Doc.md` — narrative engineering design, the *why* behind every decision.
- `docs/Stillpoint-Build-Spec.agent.md` — terse normative spec (RFC-2119 MUST/SHOULD), with the exact audio parameters and an acceptance checklist. Treat the numeric audio constants as **tuned targets — do not "improve" them without explicit instruction.**

## Architecture (the parts that span files)

Four scripts, loaded in order from `index.html`: an inline `STILLPOINT_TWEAKS` defaults block, then `app.js`, then `tweaks.js`. `sw.js` is registered separately.

- **`app.js`** is the whole app in one IIFE: state, builder/runner rendering, persistence, the audio engine, the run loop, wake-lock/dimming, and a11y. It only ever **reads** `window.STILLPOINT_TWEAKS`.
- **`tweaks.js`** is the sound-design panel. It **mutates `STILLPOINT_TWEAKS` in place**, so every subsequent strike picks up new values with no re-wiring. It also exposes preview via `window.STILLPOINT_PREVIEW` (set by app.js).

### The EDITMODE / host quirk (important)

Sound settings are *not* persisted normally in this reference build. The defaults live in an inline `/*EDITMODE-BEGIN*/{...}/*EDITMODE-END*/` JSON block in `index.html`, and `tweaks.js` saves changes by `postMessage`-ing `__edit_mode_set_keys` to `window.parent` — i.e. an external authoring **host rewrites the JSON on disk**. The `__edit_mode_*` / `__activate_edit_mode` message protocol exists only for that host. This is intentional but **non-portable**: any production rebuild MUST replace it with normal `localStorage` (`stillpoint.sound`) plus an in-app settings screen (see Build-Spec §2, §5; Design-Doc §6.4). Don't replicate the EDITMODE mechanism in new code.

### Audio engine — the heart of the app

Graph: per-strike `oscillators/filters → masterBus (Gain) → DynamicsCompressor → destination`. One lazily-created `AudioContext` (`ensureAudio()`), created/resumed only after a user gesture. Two distinct, carefully-tuned timbres:

- **Chime** (`playChime` → `strikeVoice`): a wind chime. **Harmonic** partials, pentatonic scale, intentionally **non-deterministic** (Fisher–Yates shuffle each play — keep the variation). An earlier inharmonic/wideband-detune version "sounded like a horror soundtrack" — do not reintroduce inharmonic ratios or wide detune for the chime.
- **Bell** (`playBells` → `strikeRin`): a Japanese standing bell. **Inharmonic stretched** partials, paired detuned modes (the warble), a mallet-tick noise burst, and a "ting" transient. 3-ring sequence is **root → octave → fifth** (order matters).

### Run loop — drift-free wall-clock

`tick()` (driven by `requestAnimationFrame`) computes `elapsed = (Date.now() - startAt)/1000` every frame — it **never accumulates frame deltas**, so the countdown self-corrects after throttling/sleep. There is a deliberate **~700 ms frozen handoff** between segments so an end cue and the next start cue don't overlap. Pause/resume works by shifting `startAt` (`startAt = now - pauseElapsed*1000`).

### Known platform limitation (don't try to defeat it)

Wake Lock keeps the **display** on but is released when the tab is hidden/minimized, and OS sleep / backgrounded tabs suspend JS + the AudioContext — so cues that should have fired while suspended are simply lost. The countdown self-corrects visually on return; missed chimes do not replay. This is documented as a constraint, not a bug.

## Behaviors that have regressed before — preserve them

From Build-Spec §13 / Design-Doc §10 (these came from real bugs):

- **Tab order** must reach every control in read mode (**name → Bookmark → Clear → Edit → Begin**) and release at the boundaries so browser chrome stays reachable — a document-level `keydown` handler implements this to work around the macOS/Safari "Tab between text fields only" setting.
- In the editor, number fields **reformat on blur, not via full `render()`** (a re-render drops focus mid-Tab). Seconds field is `type=text inputmode=numeric` so it can zero-pad to `00`.
- **Clear is a two-tap confirm** ("Clear all?", auto-cancels in 3.5 s or on outside click).
- Session-name input disables autocomplete and neutralizes `:-webkit-autofill` styling.
- Total-time display is **read-only** and must not look like an input.
- **Bookmark ≠ Edit**: Bookmark upserts into `stillpoint.saved` (case-insensitive name); Edit just toggles edit mode (changes persist live to `stillpoint.last`).
- All `localStorage` access is wrapped in try/catch (private-mode/quota failures are non-fatal).
- All ambient motion is gated behind `prefers-reduced-motion: reduce`.

## Theming

Colors are OKLCH CSS custom properties redefined per `palette-{morning|afternoon|evening|night}` class on `<body>`, set by hour in `applyTimeOfDay()` (re-evaluated every 30 s and on focus). Define new colors via `color-mix`/OKLCH off existing tokens (e.g. `--accent`) so they track palette changes — never hard-code a hue.
