# Stillpoint — Meditation Timer
## Engineering Design Document

**Status:** Working reference implementation (vanilla HTML/CSS/JS). This document captures everything decided and discovered while building it, written so the app can be rebuilt on any framework or architecture.

**Audience:** Engineers (re)building the product.

---

## 1. Product overview

Stillpoint is a calm, single-user meditation timer that runs entirely client-side. A user builds a session out of one or more timed **segments**, each with an optional **start** and **end** sound cue, then runs it. During a run the screen stays awake and gently dims, and synthesized chimes/bells mark segment transitions.

Design pillars:

- **Quiet and ambient.** Dark, moody, portrait-first. Drifting gradient background, time-of-day theming, serif display type.
- **No accounts, no network.** All state is local. Works offline (installable PWA).
- **Synthesized audio.** No audio files — chimes and bells are generated with the Web Audio API so they are tiny, tweakable, and never clip.
- **Forgiving.** Wall-clock timing (no drift), safe destructive actions (two-tap clear), persistence of in-progress work.

---

## 2. Screens & information architecture

There are two top-level views, toggled by a `running` class on `<body>`:

### 2.1 Builder / Home (default)
- **Greeting header** — time-of-day greeting ("Good morning/afternoon/evening") + live clock and date.
- **Session card:**
  - Editable **session name** field.
  - **Bookmark** toggle (saves/flags the session under Bookmarked — see §5).
  - **Total time** read-only summary.
  - **Segments header** with **Clear** (two-tap reset) and **Edit/Done** toggle.
  - **Segments list** — rendered read-only in view mode, as editors in edit mode.
  - **+ Add segment** (edit mode only).
  - **Begin session** primary button (disabled when total time is 0).
- **Bookmarked** section — list of saved sessions (tap to load, × to delete).
- **Footnote** — PWA/offline status line.

### 2.2 Running view
- Session name, segment label: the segment's **name** when set (with **Segment N of M** as a secondary line), else **Segment N of M** alone.
- Large **countdown** for the current segment + **total remaining**.
- **Progress dots** (one per segment: done / active / upcoming).
- **Pause/Resume** and **End** controls.
- **Complete** state with a checkmark and "Return home".

---

## 3. Data model

```
Session = {
  name: string,
  segments: Segment[]
}

Segment = {
  min: number,          // whole minutes  (>= 0)
  sec: number,          // seconds 0–59
  start: SoundKind,     // cue played when the segment begins
  end:   SoundKind      // cue played when the segment ends
}

SoundKind = 'none' | 'chime' | 'bell'
```

- Internal display labels: `none → "None"`, `chime → "Chime"`, `bell → "Bells"`.
- Segment duration in seconds = `min * 60 + sec`. Total = sum across segments.
- **Default preset** ("Daily Practice"): segment 1 = 2:00, start `chime`, end `none`; segment 2 = 23:00, start `none`, end `bell`. Used only when no saved working session exists.

UI mode is a separate piece of state: `mode ∈ { 'view', 'edit' }`.

---

## 4. Persistence

Two `localStorage` keys (namespaced `stillpoint.`):

| Key | Contents | When written |
|---|---|---|
| `stillpoint.last` | The current working `Session` | On every edit (name, segment time, sound, add/remove), and on load |
| `stillpoint.saved` | `Session[]` of bookmarked sessions | On bookmark and on delete |

Behavior:
- On boot, load `stillpoint.last` if present, else clone the preset.
- Bookmarking writes the current session into `stillpoint.saved`, **upserting by case-insensitive name** (re-bookmarking the same name overwrites).
- All reads/writes are wrapped in try/catch (private-mode / quota failures are non-fatal).

> **Sound settings persistence is environment-specific in the reference build** — see §6.4. In a production rebuild, store the tweak object in `localStorage` (e.g. `stillpoint.sound`) alongside the others.

---

## 5. Bookmark vs. Edit (two distinct "save" concepts)

These were deliberately separated because users conflated them:

- **Edit → Done** commits *structural changes* to the working session (it just toggles edit mode; changes persist live to `stillpoint.last`).
- **Bookmark / Bookmarked** flags a session to reappear in the **Bookmarked** list on a future visit. It is styled as a quiet, icon-forward toggle (ghost when off, soft accent fill when on) so it never reads as a generic "save" competing with Edit.

The Bookmarked section heading and empty-state copy share this vocabulary ("Bookmark", "Bookmarked", "Nothing bookmarked yet…").

---

## 6. Audio engine (the heart of the app)

All sound is synthesized with the **Web Audio API**. No samples. This is the most carefully tuned part of the app — the parameters below are the result of significant iteration and should be preserved faithfully on a rebuild.

### 6.1 Signal graph
```
[per-strike oscillators + filters] → masterBus (Gain)
                                       → DynamicsCompressor → destination
```
- One lazily-created `AudioContext` (created/resumed on first user gesture — required by browser autoplay policy). `ensureAudio()` resumes if suspended and applies volume.
- **Master volume** uses a perceptual taper: `gain = (volume/100)² × 0.5`.
- **Compressor** (`threshold −14, knee 22, ratio 3, attack 0.006, release 0.3`) smooths peaks when many partials/voices stack, preventing clipping.

### 6.2 The three cues
`playSound(kind)`: `'none'` → silent; `'chime'` → wind chime; `'bell'` → Japanese standing bells. `window.STILLPOINT_PREVIEW = playSound` lets the tweak panel audition.

### 6.3 Voice timbres

**Chime — a wind chime catching a breeze.**
- Tubes tuned to a **pentatonic** scale (`[0,2,4,7,9,12,14,16,19,21,24]` semitones over ~2 octaves) so *any* combination is consonant.
- Each strike: shuffle the scale (Fisher–Yates), take `Notes` of them, sort mostly ascending, then with ~60% probability swap two middle notes so it doesn't sound like a mechanical scale run.
- **Uneven timing & velocity:** gaps `rand(0.07,0.16) × (0.4 + Spread×1.8)`; higher/smaller tubes are quieter and shorter (a "hiRoll" factor). This is what makes it feel like wind, not a sequencer. *(It is intentionally non-deterministic — different every play. Keep this.)*
- Tone is built by `strikeVoice()` with **harmonic** partials `[1, 2, 3, 4]` (amps `[1, .42, .16, .07]`). Consonant ratios = serene singing-bowl quality (an earlier **inharmonic + wideband-detune** version sounded like a horror soundtrack — do not reintroduce).
- A low-pass filter opens bright at the strike and **eases closed** as the note rings (real bowls dull as they fade). `Warmth` rolls off the upper partials. `Shimmer` adds a narrow (cents-level) detune on only the lowest two partials → a slow, gentle beat ("wah"), *not* a wide chorus.
- Envelope: fast attack → long exponential decay → **linear glide to true zero** so the tail fades with no click.

**Bell — Japanese standing bell (rin / orin).**
- **Inharmonic, stretched** partials `[1, 2.74, 5.38, 8.9, 13.2]` — the ~2.74× second mode is the singing "voice" of struck metal. (Distinct from the chime's harmonic set; this is what makes it read as a temple bell rather than a bowl.)
- Per partial, **two near-identical modes** split by a few Hz drift in and out of phase → the signature shimmering **warble**.
- A soft **mallet-contact tick** (a 50 ms band-passed noise burst) sells the strike, plus a bright high **"ting" transient** (`[6.7, 9.4, 12.3]×`) that flashes and dies fast.
- Low and resonant: root near **C4 (261.6 Hz)**, long ring (`decay = 5 + Sustain×11` s).
- **Rings in a sequence of tones:** 1 ring = root; 2 = root + octave; 3 = **root → octave → fifth**. Each ring blooms and rings out before the next (spacing ~`1.5 + Sustain×1.5` s with slight jitter).

### 6.4 Tunable sound parameters

A single object, `window.STILLPOINT_TWEAKS`, holds live values. `app.js` only **reads** it; a separate panel (`tweaks.js`) mutates it in place so every new strike picks up the latest values.

| Key | Range | Meaning |
|---|---|---|
| `volume` | 0–100 | Master volume (perceptual taper) |
| `chimePitch` / `bellPitch` | −7…+7 st | Transpose |
| `chimeWarmth` / `bellWarmth` | 0–100 | Rolls off upper partials / softens strike |
| `chimeSustain` / `bellSustain` | 0–100 | Ring length |
| `chimeShimmer` | 0–100 | Beat depth on chime |
| `bellShimmer` | 0–100 | **Warble** depth on bell |
| `chimeNotes` | 1–9 | How many tubes are struck |
| `chimeSpread` | 0–100 | Timing looseness between tubes |
| `bellRings` | 1 / 2 / 3 | Number of bells (root / +octave / +fifth) |

> In the reference build these values live in an `EDITMODE` JSON block in `index.html` that the authoring host rewrites on disk. **For a production rebuild, replace that mechanism with normal persistence** (localStorage / settings store) and a real in-app settings screen. The audio engine itself does not care where the values come from.

---

## 7. Running engine

State lives in a `run` object; the view is driven by `requestAnimationFrame`.

- **Wall-clock timing (drift-free).** Each segment records `startAt = Date.now()`. Every frame, `elapsed = (now − startAt)/1000`; remaining = `segDur − elapsed`. We never accumulate frame deltas, so the timer stays accurate even if frames drop or the tab is throttled.
- **Segment boundaries** are precomputed as cumulative seconds (`bounds[]`) for the "total remaining" readout.
- **Cue scheduling:** a segment's `start` sound plays when it begins; its `end` sound plays when it elapses. Between segments there is a **~700 ms handoff gap** (ticking frozen) so an end cue and the next start cue don't fully overlap.
- **Pause/Resume:** on pause, store `pauseElapsed`; on resume, set `startAt = now − pauseElapsed×1000` so the countdown continues seamlessly.
- **Complete** state shows a checkmark; **End** tears everything down and returns home.
- **Progress dots** reflect done/active/upcoming segments.

---

## 8. Screen wake & dimming

- **Screen Wake Lock API** (`navigator.wakeLock.request('screen')`) is requested when a run begins and **re-acquired on `visibilitychange → visible`** (the lock is auto-released by the OS whenever the tab is hidden).
- **Ambient dimming:** ~6 s after the last interaction the running view dims (`.dimmed`); any pointer/key interaction brightens it (`.awake`) for ~4 s, then it dims again. Keeps the room dark while meditating but responsive to a glance.

**Limitations (important for "will it keep my computer awake?"):**
- Wake Lock keeps the **display** on; it does **not** override full **system sleep**, and it is **released when the window is hidden/minimized or the tab is backgrounded**.
- If the whole machine sleeps, or (on iOS Safari especially) the tab is backgrounded, **JS timers and the AudioContext are suspended** — cues that should have fired while suspended will **not** sound. The countdown self-corrects visually on return (wall-clock), but missed chimes are lost.
- Practical guidance to surface to users: run in a Chromium browser or Safari 16.4+, keep the Stillpoint window foregrounded, and (for guaranteed audio) nudge OS sleep settings up for long sessions.

---

## 9. Theming & motion

- **Time-of-day palettes:** `applyTimeOfDay()` maps the current hour to a greeting and a `palette-{morning|afternoon|evening|night}` class on `<body>`; each palette redefines a set of **OKLCH** CSS custom properties (`--bg-deep`, `--glow-a/b`, `--accent`, inks, etc.). Re-evaluated every 30 s and on window focus. Background transitions over ~1.6 s.
- **Ambient background:** two slow-drifting radial-gradient layers + a faint SVG grain to avoid banding. All motion is disabled under `prefers-reduced-motion: reduce`.
- **Type:** Spectral (serif display/headings, incl. an italic accent word in the greeting) + DM Sans (UI). Loaded from Google Fonts — see §11.
- **Color:** define new colors in OKLCH harmonized with the existing tokens; avoid hard-coding hues (one autofill/focus fix originally hard-coded a hue and had to be switched to `color-mix(... var(--accent) ...)` so it tracks the active palette).

---

## 10. Accessibility & input (hard-won details)

These came from real bugs; preserve the behavior even if the implementation changes.

1. **Keyboard Tab order reaches every control.** macOS (and Safari by default) only move Tab focus between *text fields and lists*, skipping buttons/links — so in read mode Tab jumped from the title straight to the browser address bar. Fix: a document-level `keydown` handler walks the natural DOM order of focusable elements and moves focus on Tab/Shift+Tab, **releasing at the boundaries** so the user can still tab out to browser chrome. Expected read-mode order: **name → Bookmark → Clear → Edit → Begin**.
   - *Rebuild note:* this is a workaround for an OS/browser setting. Prefer correct semantics + visible focus rings first; only add a manual roving-tabindex/handler if you must guarantee the order regardless of the user's keyboard-navigation setting. Be mindful it can interfere with assistive tech / nested widgets.
2. **Visible focus rings** (`:focus-visible`, accent outline) on all interactive controls — without them, keyboard focus was invisible and felt broken.
3. **Min → Sec tab flow in the editor.** Number fields reformat their value **in place on blur**, *not* via a full re-render — a full render destroyed the field mid-Tab and dropped focus before it reached the next input.
4. **Seconds are zero-padded** (`00`). Implemented as a `type=text` + `inputmode=numeric` field (number inputs strip leading zeros).
5. **Session-name field disables autocomplete** (`autocomplete=off`, etc.) and neutralizes `:-webkit-autofill` styling, which otherwise popped a history dropdown and repainted the field with a pale background.
6. **Two-tap Clear** confirm (label → "Clear all?", reddish tint, auto-cancels in 3.5 s or on any outside tap) to make a destructive reset safe but unobtrusive.

---

## 11. PWA / offline

- `manifest.json` (standalone, portrait, dark theme color `#0c0f1a`, 192/512/maskable icons).
- `sw.js` caches the app shell (`stillpoint-vN` cache: html, css, js, manifest, icons), cache-first with runtime caching of GET requests; `skipWaiting` + `clients.claim`; old caches purged on activate. **Bump the cache name on each release.**
- **Caveat:** fonts load cross-origin from Google Fonts and are *not* in the service-worker precache, so the very first offline load may fall back to system fonts. For robust offline, self-host the fonts (or precache them) in a rebuild.

---

## 12. Known limitations & risks (summary)

- **Background/sleep audio:** timers and audio suspend when the tab is hidden or the machine sleeps; missed cues don't fire (see §8). This is a platform constraint, not a bug.
- **iOS Safari** aggressively suspends background tabs and requires a gesture to start audio.
- **Sound-settings persistence** currently depends on the authoring host's `EDITMODE` block — must be replaced (§6.4).
- **No sync / no backup:** clearing site data loses all sessions.
- **Tab-order override** is a deliberate workaround and a possible AT edge-case (§10.1).
- **`fmtTotal` plural:** returns `"min"` for both singular and plural minutes — cosmetic.
- **Voice count:** extreme settings (max notes + long sustain, repeatedly) stack many oscillators; the compressor prevents clipping but very low-end devices could strain. Consider a voice cap on rebuild.

---

## 13. Recommended rebuild architecture (framework-agnostic)

Keep these as **separate, decoupled modules** regardless of framework:

1. **`AudioEngine`** — pure module, no DOM/UI. Inputs: a sound kind + a params object. Owns the `AudioContext`, master bus, compressor, and the `strikeVoice` / `strikeRin` / `playChime` / `playBells` builders. Expose `play(kind)`, `setParams(p)`, `resume()`. (The reference code is already almost DOM-free here — port it directly.)
2. **`Timer` / run loop** — wall-clock based; expose start/pause/resume/end and emit events (`segmentStart`, `segmentEnd`, `tick`, `complete`) the UI subscribes to. Don't bind it to `requestAnimationFrame` internals of one framework; a store/observable works in React/Svelte/Vue.
3. **`Persistence` adapter** — thin wrapper over `localStorage` (or IndexedDB) with the three concerns: working session, bookmarked sessions, sound settings.
4. **`Theming`** — keep the OKLCH CSS-variable palettes and the time-of-day mapping; it's framework-independent.
5. **UI** — Builder and Runner screens + a Sound Settings panel (replacing the host `EDITMODE` tweak panel).

Cross-cutting requirements to carry over: visible focus rings, drift-free timing, the 700 ms inter-segment handoff, wake-lock re-acquire on visibility, reduced-motion support, and the exact audio parameters in §6.

---

## 14. File manifest (reference implementation)

| File | Role |
|---|---|
| `index.html` | Markup, font links, PWA meta, `STILLPOINT_TWEAKS` defaults, script includes |
| `styles.css` | OKLCH tokens, time-of-day palettes, ambient bg, all component styles |
| `app.js` | State, render, persistence, audio engine, run loop, wake/dim, a11y, SW registration |
| `tweaks.js` | Sound-settings panel (host-driven; replace in production) |
| `manifest.json` | PWA manifest |
| `sw.js` | Offline app-shell service worker |
| `icons/` | App icons (192 / 512 / maskable) |
