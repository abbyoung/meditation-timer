# Stillpoint Meditation Timer — Build Spec (agent-ingestible)

> Machine-oriented spec for an implementing agent (e.g. Claude Code). Terse, normative, framework-agnostic. MUST/SHOULD/MAY per RFC 2119. Where exact numbers appear, treat them as the tuned target values — do not "improve" them without explicit instruction. A working vanilla reference exists (`index.html`, `styles.css`, `app.js`, `tweaks.js`, `sw.js`, `manifest.json`); port behavior, not necessarily code.

## 0. Scope
Client-only, offline-capable, single-user meditation timer. Two screens: Builder and Runner. Synthesized audio (Web Audio API; no sample files). No backend, no auth, no network calls at runtime except first-load font fetch.

## 1. Data schemas
```ts
type SoundKind = 'none' | 'chime' | 'bell';        // labels: None | Chime | Bells
interface Segment { min: number; sec: number; start: SoundKind; end: SoundKind; name?: string; } // min>=0, sec 0..59; name optional (decorative, ≤30 chars)
interface Session { name: string; segments: Segment[]; }
type Mode = 'view' | 'edit';
```
- `segSeconds(s) = s.min*60 + s.sec`. `totalSeconds(sess) = Σ segSeconds`.
- DEFAULT_PRESET = `{ name:'Daily Practice', segments:[ {min:2,sec:0,start:'chime',end:'none'}, {min:23,sec:0,start:'none',end:'bell'} ] }`.

## 2. Persistence (localStorage; wrap all access in try/catch)
- `stillpoint.last` → current working `Session`. Write on EVERY mutation (name input, time change, sound change, add/remove segment, load, clear).
- `stillpoint.saved` → `Session[]` (bookmarks). Upsert by case-insensitive `name`; newest first (`unshift`). Delete by index.
- `stillpoint.sound` (REQUIRED in rebuild) → the tweak/params object (§5). The reference build instead stores these in an `EDITMODE` JSON block in `index.html` rewritten by the authoring host — DO NOT replicate that; use localStorage + a settings UI.
- Boot: load `stillpoint.last` else clone DEFAULT_PRESET.

## 3. Screens & required controls
### Builder
- Session name text input. MUST set `autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false"` and neutralize `:-webkit-autofill` (text-fill-color = ink, box-shadow inset transparent) so no autofill dropdown/pale-bg appears.
- Bookmark toggle: states "Bookmark" (ghost) / "Bookmarked" (soft accent fill). Distinct from Edit. Upserts into `stillpoint.saved`.
- Total time: READ-ONLY display. MUST NOT look like an input (label "TOTAL TIME", `cursor:default`, `user-select:none`).
- Segments header: Clear (two-tap) + Edit/Done toggle.
- Segments list: view-mode (read-only: index, `m:ss`, start/end cue icons) vs edit-mode (min input, sec input, start/end chip pickers, remove × when >1 segment).
- "+ Add segment" (edit mode). New segment default `{min:5,sec:0,start:'none',end:<prev.end or 'chime'>}`.
- Begin button: disabled (and dimmed) when total <= 0.
- Bookmarked list: tap row = load session (→ view mode, scroll top, toast); × = delete. Empty copy: "Nothing bookmarked yet — build a session and tap Bookmark." Rows keyboard-activable (role=button, tabindex 0, Enter).

### Runner (toggled by `running` class on body)
- Session name; "Segment N of M"; large current-segment countdown (`m:ss`); "X:XX remaining" total; progress dots (done/active/upcoming); Pause/Resume; End.
- Complete state: checkmark + "Return home".

## 4. Audio engine — MUST match these parameters
Graph: `oscillators/filters → masterBus(Gain) → DynamicsCompressor → destination`.
- Single lazily-created `AudioContext`; create/resume only after a user gesture; resume if `suspended` before each play. Expose `preview(kind)` for the settings UI.
- Master gain (perceptual): `(volume/100)^2 * 0.5`.
- Compressor: threshold −14, knee 22, ratio 3, attack 0.006, release 0.3.
- `play('none')` = silent. `play('chime')` = §4.1. `play('bell')` = §4.2.

### 4.1 Chime = wind chime (`strikeVoice` per note; HARMONIC)
- Pentatonic degrees (semitones): `[0,2,4,7,9,12,14,16,19,21,24]`. Root = `587 * 2^(chimePitch/12)` Hz.
- Each play: Fisher–Yates shuffle scale → take `chimeNotes` → sort ascending → with prob 0.6 swap two interior notes (non-mechanical). NON-DETERMINISTIC by design; keep variation.
- Per note velocity `rand(0.6,1)*hiRoll`, `hiRoll = 1 - (semi/24)*0.45` (higher tubes quieter/shorter). Inter-note gap `rand(0.07,0.16) * (0.4 + chimeSpread*1.8)` s.
- `strikeVoice`: partials ratio/amp/decay = `[1:1.00:1.00, 2:0.42:0.84, 3:0.16:0.56, 4:0.07:0.40]`. Sine. Amp per partial `*= (1 - warmth*0.5)^i`. Lowpass: open `2400 + (1-warmth)*4600 + freq*1.1`, exp-ramp to `max(380, 900 + (1-warmth)*1000 + freq*0.5)` over `decay*0.85`, Q≈0. `shimmer` (cents) applies a ±detune pair on the lowest 2 partials only → slow beat. Envelope: linear attack → exponential decay → linear glide to 0 (no click). `decay = 2.2 + chimeSustain*5.5` (scaled per-note by hiRoll).
- CONSONANT harmonic ratios are mandatory. DO NOT use inharmonic ratios or wideband detune for the chime (sounds like horror-movie strings).

### 4.2 Bell = Japanese standing bell / rin (`strikeRin`; INHARMONIC)
- Root = `261.6 * 2^(bellPitch/12)` Hz (~C4). `decay = 5 + bellSustain*11` s. `beat = 0.5 + bellShimmer*3.2` Hz.
- Ring sequence by `bellRings`: 1→`[0]`, 2→`[0,12]`, 3→`[0,12,7]` (root, octave, fifth). Sequence spacing `(1.5 + bellSustain*1.5) * rand(0.92,1.1)` s; higher rings slightly softer/shorter.
- `strikeRin` components, ALL required:
  - Inharmonic partials ratio/amp/decay = `[1.000:1.00:1.00, 2.740:0.60:0.62, 5.380:0.30:0.38, 8.900:0.13:0.24, 13.20:0.05:0.15]`. Amp `*= (1 - warmth*0.42)^i`.
  - Each partial = a PAIR of sines split by `beat*(1 + i*0.6)` Hz (the warble). Second mode at 0.82 amp.
  - Mallet tick: ~50 ms white-noise buffer through a bandpass at `2400 + (1-warmth)*1600` Hz, fast exp decay.
  - "Ting" transient: sines at `[6.7,9.4,12.3]×` freq (slight random detune), short exp decay.
  - Lowpass: open `6400 + (1-warmth)*6000`, exp-ramp to `max(700, 1500 + (1-warmth)*1500 + freq*0.6)` over 0.55 s.

## 5. Tunable params object (single source of truth, engine READS only)
| key | range | applies |
|---|---|---|
| volume | 0–100 | master |
| chimePitch / bellPitch | −7..7 (st) | transpose |
| chimeWarmth / bellWarmth | 0–100 | upper-partial rolloff |
| chimeSustain / bellSustain | 0–100 | ring length |
| chimeShimmer | 0–100 | chime beat depth |
| bellShimmer | 0–100 | bell warble depth |
| chimeNotes | 1–9 | tubes struck |
| chimeSpread | 0–100 | timing looseness |
| bellRings | 1/2/3 | bell count (root/+oct/+fifth) |

Reference defaults: `volume 80, chimePitch 0, chimeWarmth 45, chimeSustain 41, chimeShimmer 60, chimeNotes 9, chimeSpread 37, bellPitch 0, bellWarmth 39, bellSustain 44, bellShimmer 55, bellRings 3`.

## 6. Run loop (wall-clock; MUST be drift-free)
- Per segment: `startAt = Date.now()`; each frame `elapsed=(now-startAt)/1000`, `remain=segDur-elapsed`. NEVER accumulate frame deltas.
- Precompute cumulative `bounds[]` for total-remaining.
- On segment begin: play its `start` cue. On elapse: play its `end` cue, then a ~700 ms frozen handoff gap before next segment's start (so end+next-start don't overlap). Last segment → Complete.
- Pause: store `pauseElapsed`; Resume: `startAt = now - pauseElapsed*1000`.
- End: cancel loop, clear classes/timers, release wake lock, remove visibility listener.

## 7. Wake lock & dimming
- On begin: `navigator.wakeLock.request('screen')` (guard `'wakeLock' in navigator`, try/catch). Re-acquire on `visibilitychange`→visible (OS auto-releases when hidden). Release on End/Complete.
- Dim: add `.dimmed` ~6 s after last interaction while active; pointer/key interaction → `.awake` ~4 s then re-arm dim.
- KNOWN LIMITATION (document in UI/help, do not try to defeat): screen-only; released when tab hidden/minimized; system sleep & backgrounded tabs suspend JS+audio so missed cues won't fire; countdown self-corrects on return via wall-clock.

## 8. Theming
- OKLCH CSS custom properties; `palette-{morning|afternoon|evening|night}` on body set by hour: morning 5–12, afternoon 12–17, evening 17–21, else night. Re-eval every 30 s and on window focus. Greeting splits last word into an `<em>` accent. Clock shows time + long date.
- Ambient: two drifting radial-gradient layers + SVG grain; ALL animation gated behind `@media (prefers-reduced-motion: reduce)`.
- New colors via `color-mix`/OKLCH off `--accent` etc. — never hard-code a hue that won't track palette changes.
- Fonts: Spectral (serif display) + DM Sans (UI). SHOULD self-host/precache for offline.

## 9. Accessibility / input — acceptance-critical
- A11Y-1: Every interactive control reachable by Tab regardless of OS "Tab moves between text fields only" setting. Read-mode order MUST be: name → Bookmark → Clear → Edit → Begin. Implement via DOM-order walk on Tab/Shift+Tab keydown, releasing at first/last so chrome stays reachable. (Workaround for macOS/Safari; keep correct semantics + focus rings regardless.)
- A11Y-2: `:focus-visible` outline (accent) on all controls.
- A11Y-3: Editor Min→Sec Tab works — number fields reformat value in place on blur, NOT via full re-render (re-render drops focus mid-Tab).
- A11Y-4: Seconds field zero-pads to 2 digits; implement as `type=text inputmode=numeric maxlength=2` (number inputs strip leading zeros).
- A11Y-5: Clear is a two-tap confirm ("Clear all?", danger tint, auto-cancel 3.5 s or on outside click); confirm resets to one blank `{min:5,sec:0,start:'none',end:'bell'}` segment, empties name (render BEFORE persist so old name isn't recaptured), enters edit mode, focuses name.

## 10. PWA / offline
- `manifest.json`: standalone, portrait, theme/bg `#0c0f1a`, icons 192/512/maskable.
- Service worker: precache app shell, cache-first + runtime GET caching, `skipWaiting`+`clients.claim`, purge stale caches on activate. BUMP cache name per release. SHOULD precache fonts.

## 11. Recommended module boundaries (rebuild)
1. `AudioEngine` — pure, DOM-free; owns AudioContext/bus/compressor + voice builders; `play(kind)`, `setParams`, `resume`. Port §4 verbatim.
2. `Timer` — wall-clock; emits `segmentStart|segmentEnd|tick|complete`; framework-neutral store.
3. `Persistence` — localStorage/IndexedDB adapter for the 3 concerns (§2).
4. `Theming` — OKLCH palettes + time-of-day mapping.
5. `UI` — Builder, Runner, Sound Settings (replaces host tweak panel).

## 12. Acceptance checklist
- [ ] Build/edit segments; total updates live; Begin disabled at 0.
- [ ] Bookmark upsert-by-name; load/delete; distinct from Edit.
- [ ] `stillpoint.last` survives reload; preset only when empty.
- [ ] Chime: pentatonic, varies each play, no inharmonic harshness.
- [ ] Bell: rin timbre, warble, mallet tick, 3-ring = root/oct/fifth.
- [ ] All 11 params audibly change the sound; settings persist.
- [ ] Run: accurate countdown, correct start/end cues, 700 ms handoff, pause/resume seamless, complete + return.
- [ ] Wake lock requested & re-acquired on visibility; dim/brighten works.
- [ ] A11Y-1..5 all pass; reduced-motion disables drift.
- [ ] Installable PWA; loads offline after first visit.

## 13. Do-not-regress (previously fixed)
- Chime MUST NOT use inharmonic ratios / wideband detune (eerie).
- Bell sequence order is root → octave → fifth (not root→fifth→octave).
- Total-time display is not an input.
- Name field: no autocomplete dropdown, no pale autofill repaint.
- Min→Sec Tab must work; Sec shows `00`.
- Tab must reach Bookmark/Clear/Edit/Begin in read mode (not jump to address bar).
- Focus rings visible for keyboard nav.
- Clear requires two taps.
