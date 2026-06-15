# ADR 0001 — Frontend architecture & framework choice

- **Status:** Accepted
- **Date:** 2026-06-15
- **Deciders:** Abby Young
- **Context source:** `docs/Stillpoint-Build-Spec.agent.md`, `docs/Stillpoint-Design-Doc.md`, and the working vanilla reference (`index.html`, `styles.css`, `app.js`, `tweaks.js`, `sw.js`, `manifest.json`).

## Context

Stillpoint is a calm, single-user meditation timer. The relevant properties of the
system that constrain this decision:

- **100% client-side.** No backend, no auth, no runtime network calls except a
  one-time font fetch on first load. There is nothing to server-render.
- **The hard part is already pure, DOM-free JS.** The audio engine
  (`strikeVoice` / `strikeRin` / `playChime` / `playBells`, §4) and the wall-clock
  run loop (§6) are imperative Web Audio API + `requestAnimationFrame` code. The
  spec mandates porting it **verbatim**. This is the bulk of the product value and
  benefits in no way from a reactive / virtual-DOM framework.
- **Tiny UI surface.** Two screens (Builder, Runner) plus a Sound Settings panel.
  `localStorage` persistence for three concerns. Time-of-day theming via OKLCH CSS
  custom properties.
- **The spec is already modular and framework-neutral** (§11): `AudioEngine`,
  `Timer`, `Persistence`, `Theming`, `UI`.

### Definition of "best" (decision criteria)

Stated, in priority order:

1. **Established** — mature, widely adopted, long support horizon.
2. **Easy to upgrade** — minimal breaking-change / major-version churn over time.
3. **Easy to maintain** — clear seams, type safety, code that reads like the reference.
4. **Fewest dependencies** — both in development and in deploy/hosting.

These criteria point away from a heavy SPA framework: for this app a framework adds
runtime weight, an upgrade treadmill, and dependencies in exchange for abstractions
the app does not need.

## Decision

Build with **Vanilla TypeScript + Vite**, no UI framework, plus
**`vite-plugin-pwa`** for the service worker and font precaching. Organize the code
as the spec's five decoupled modules.

```
src/
  audio/AudioEngine.ts     # §4 ported verbatim; DOM-free; play/setParams/resume/preview
  timer/Timer.ts           # §6 wall-clock loop; emits segmentStart|segmentEnd|tick|complete
  persistence/Store.ts     # §2 localStorage adapter (last / saved / sound), try/catch wrapped
  theme/Theming.ts         # §8 OKLCH palettes + time-of-day mapping
  ui/Builder.ts            # builder screen + a11y tab-walk
  ui/Runner.ts             # runner screen + wake lock / dimming
  ui/Settings.ts           # replaces the host EDITMODE tweak panel
  types.ts                 # Session/Segment/SoundKind/Mode from §1
  main.ts
index.html, styles.css, manifest.webmanifest
```

**Component rationale:**

- **Vite** — de-facto-standard, well-established build tool. Near-zero config for
  vanilla TS, instant HMR in dev, outputs plain static assets. No framework runtime
  is shipped to the browser.
- **TypeScript** — the spec hands us the interfaces directly (§1). Zero runtime
  cost; significant maintenance win on the audio-params object and data schemas.
  Catches several classes of the §13 "do-not-regress" bugs at compile time.
- **`vite-plugin-pwa`** (Workbox) — generates the service worker + precache
  manifest and **auto-bumps the cache hash every release**, removing the §10/§11
  "remember to bump `stillpoint-vN`" manual chore. Cleanly precaches self-hosted
  fonts (§8 SHOULD) for true offline.

## How the decision meets the criteria

| Criterion | How Vanilla TS + Vite satisfies it |
|---|---|
| Established | Vite + TS + Workbox are industry-standard with large ecosystems and long support horizons. |
| Easy to upgrade | All deps are dev-only. No framework major-version rewrites (e.g. no React 18→19-style churn). The shipped app is web-platform APIs that don't break. |
| Easy to maintain | Typed schemas + the spec's clean module seams. Audio/timer code reads like the reference, with no framework idioms layered over imperative scheduling. |
| Fewest deps (dev + deploy) | Dev: essentially Vite + the PWA plugin. Deploy: a folder of static files on any CDN/static host — zero runtime dependencies, zero server. |

## Alternatives considered

### Runner-up 1 — Svelte 5 + Vite (static output)
A compiled component framework for the Builder's stateful editing (segment list,
mode toggles, chip pickers). Svelte compiles away to a tiny runtime with a small
bundle; excellent DX; well-established. Its stores map naturally onto the Timer's
event model.
**Why not chosen:** one more dependency and a compile-time abstraction, while the
audio engine stays vanilla regardless — so the framework only benefits ~30% of the
code, and adds slightly more upgrade surface than no framework.

### Runner-up 2 — Lit + Vite (web components)
Standards-based custom elements, ~5KB runtime, maximally future-proof (building on
the platform, which fits "established" in the durable sense). Good component
encapsulation.
**Why not chosen:** more boilerplate than Svelte, and web-component ergonomics
around forms and focus management add friction — which matters here given the fiddly
a11y / tab-order / autofill requirements in §9.

### Rejected — React / Next.js, Angular
Heaviest dependency footprint, the largest upgrade churn, and SSR / routing /
data-fetching machinery that a single-page, offline, client-only timer will never
use. Directly contradicts criteria 2 and 4.

### Rejected variant — No build step (native ESM, like the reference)
Maximally minimal dependencies, but loses TypeScript type-checking and the automatic
service-worker / font precaching — the exact maintenance wins we are optimizing for.
Vite + TS is the sweet spot: minimal deps *and* maximal safety.

## Consequences

**Positive**
- Deploy is a static folder; hosting is trivial and dependency-free.
- The shipped runtime is web-platform APIs, insulating the app from framework churn.
- TypeScript + module seams make the §13 do-not-regress list easier to defend.
- `vite-plugin-pwa` removes manual SW cache-versioning as a recurring footgun.

**Negative / trade-offs**
- No framework means UI rendering and DOM updates for the Builder are hand-written;
  we must implement the view/edit re-render logic carefully (notably §9 A11Y-3:
  number fields reformat in place on blur, *not* via full re-render).
- A small bespoke event/store layer is needed to connect `Timer` events to the UI
  (intentionally framework-neutral per spec §11).

## Implementation plan (phased)

1. **Scaffold** — Vite vanilla-TS; `types.ts` from §1; port `styles.css` + OKLCH
   tokens; self-host Spectral + DM Sans.
2. **AudioEngine** — port §4 verbatim into a DOM-free class; verify all 11 params
   audibly change the sound (§12).
3. **Persistence** — `Store.ts` for the three keys (§2), all access try/catch.
4. **Builder UI** — name field (autofill-neutralized), segments view/edit, total,
   bookmark-vs-edit, two-tap clear, Begin disable; a11y §9 (tab-walk, focus rings,
   min→sec tab, `00` padding).
5. **Timer + Runner** — wall-clock loop, cues, 700 ms handoff, pause/resume,
   complete; wake lock + dim/brighten.
6. **Settings panel** — replaces the EDITMODE block; reads/writes `stillpoint.sound`.
7. **PWA** — `vite-plugin-pwa`, manifest, precache shell + fonts; verify offline +
   installable.
8. **Acceptance pass** — walk the §12 acceptance checklist and §13 do-not-regress list.
