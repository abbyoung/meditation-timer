/**
 * AudioEngine — DOM-free, self-contained audio synthesis.
 *
 * Signal graph (Build-Spec §4):
 *   per-strike oscillators/filters → masterBus (Gain) → DynamicsCompressor → destination
 *
 * One lazily-created AudioContext, created/resumed only after a user gesture.
 * All numeric constants are the tuned targets from Build-Spec §4.1/§4.2 — do
 * not alter them without explicit instruction.
 */

import type { SoundKind } from '../types.js';

// ── Tunable params (Build-Spec §5) ────────────────────────────────────────────
// Single source of truth; the engine only reads this object.
// The Settings UI writes to it via setParams(); defaults match spec §5.
export interface SoundParams {
  volume: number;       // 0–100 master
  chimePitch: number;   // −7..7 semitones
  chimeWarmth: number;  // 0–100
  chimeSustain: number; // 0–100
  chimeShimmer: number; // 0–100
  chimeNotes: number;   // 1–9
  chimeSpread: number;  // 0–100
  bellPitch: number;    // −7..7 semitones
  bellWarmth: number;   // 0–100
  bellSustain: number;  // 0–100
  bellShimmer: number;  // 0–100 (bell warble depth)
  bellRings: 1 | 2 | 3;
}

export const DEFAULT_SOUND_PARAMS: SoundParams = {
  volume: 80,
  chimePitch: 0,
  chimeWarmth: 45,
  chimeSustain: 41,
  chimeShimmer: 60,
  chimeNotes: 9,
  chimeSpread: 37,
  bellPitch: 0,
  bellWarmth: 39,
  bellSustain: 44,
  bellShimmer: 55,
  bellRings: 3,
};

// ── Internal partial descriptors ───────────────────────────────────────────────

interface PartialDef {
  f: number; // frequency ratio
  a: number; // amplitude
  d: number; // decay scale
}

// Harmonic partials for the chime/bowl voice (consonant — do NOT change to inharmonic).
// Ratios [1, 2, 3, 4]: fundamental + octave + fifth-above-octave + double-octave.
const VOICE_PARTIALS: readonly PartialDef[] = [
  { f: 1.00, a: 1.00, d: 1.00 },
  { f: 2.00, a: 0.42, d: 0.84 },
  { f: 3.00, a: 0.16, d: 0.56 },
  { f: 4.00, a: 0.07, d: 0.40 },
];

// Pentatonic scale degrees (semitones over ~2 octaves).
// Any combination is consonant, so the shuffled subset always sounds right.
const CHIME_SCALE: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

// Inharmonic stretched partials for the rin/standing-bell voice.
// The ~2.74× second mode is the "singing voice" of struck metal.
const RIN_PARTIALS: readonly PartialDef[] = [
  { f: 1.000, a: 1.00, d: 1.00 },
  { f: 2.740, a: 0.60, d: 0.62 },
  { f: 5.380, a: 0.30, d: 0.38 },
  { f: 8.900, a: 0.13, d: 0.24 },
  { f: 13.20, a: 0.05, d: 0.15 },
];

// Ring sequences: 1 = root, 2 = root+octave, 3 = root→octave→fifth (order matters).
const RIN_SEQUENCES: Record<number, number[]> = {
  1: [0],
  2: [0, 12],
  3: [0, 12, 7],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

// ── Voice builders ─────────────────────────────────────────────────────────────

interface StrikeVoiceParams {
  gain: number;
  decay: number;
  warmth: number;  // 0–1
  shimmer: number; // cents
  attack: number;
}

/** One struck chime tube — harmonic sines under a closing lowpass. */
function strikeVoice(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  t0: number,
  p: StrikeVoiceParams,
): void {
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = p.gain;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const cutOpen  = 2400 + (1 - p.warmth) * 4600 + freq * 1.1;
  const cutClose = Math.max(380, 900 + (1 - p.warmth) * 1000 + freq * 0.5);
  lp.frequency.setValueAtTime(cutOpen, t0);
  lp.frequency.exponentialRampToValueAtTime(cutClose, t0 + p.decay * 0.85);
  lp.Q.value = 0.0001;
  voiceGain.connect(lp).connect(dest);

  VOICE_PARTIALS.forEach((pt, i) => {
    const amp = pt.a * Math.pow(1 - p.warmth * 0.5, i);
    if (amp < 0.004) return;
    const dec = Math.max(0.3, p.decay * pt.d);

    // Shimmer: narrow cents-level detune on the lowest two partials only → slow beat.
    const beat = i <= 1 && p.shimmer > 0.2;
    const sides: number[] = beat ? [-1, 1] : [0];
    sides.forEach((side) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * pt.f;
      osc.detune.value = side * p.shimmer;
      const g = ctx.createGain();
      const a = beat ? amp * 0.55 : amp;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(a, t0 + p.attack);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0006, a * 0.0008), t0 + dec);
      g.gain.linearRampToValueAtTime(0, t0 + dec + 0.5);
      osc.connect(g).connect(voiceGain);
      osc.start(t0);
      osc.stop(t0 + dec + 0.6);
    });
  });
}

interface StrikeRinParams {
  gain: number;
  decay: number;
  warmth: number; // 0–1
  beat: number;   // Hz of warble
}

/** One struck rin (Japanese standing bell) — inharmonic stretched partials + mallet tick. */
function strikeRin(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  t0: number,
  p: StrikeRinParams,
): void {
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = p.gain;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  const open  = 6400 + (1 - p.warmth) * 6000;
  const close = Math.max(700, 1500 + (1 - p.warmth) * 1500 + freq * 0.6);
  lp.frequency.setValueAtTime(open, t0);
  lp.frequency.exponentialRampToValueAtTime(close, t0 + 0.55);
  lp.Q.value = 0.0001;
  voiceGain.connect(lp).connect(dest);

  // Mallet contact tick — ~50ms band-passed noise burst.
  const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource();
  ns.buffer = nb;
  const nf = ctx.createBiquadFilter();
  nf.type = 'bandpass';
  nf.frequency.value = 2400 + (1 - p.warmth) * 1600;
  nf.Q.value = 0.7;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.05 * (1 - p.warmth * 0.5), t0);
  ng.gain.exponentialRampToValueAtTime(0.0003, t0 + 0.05);
  ns.connect(nf).connect(ng).connect(voiceGain);
  ns.start(t0);
  ns.stop(t0 + 0.06);

  // Sustained inharmonic partials — each a slow-beating pair of sines.
  RIN_PARTIALS.forEach((pt, i) => {
    const amp = pt.a * Math.pow(1 - p.warmth * 0.42, i);
    if (amp < 0.003) return;
    const dec = Math.max(0.3, p.decay * pt.d);
    const split = p.beat * (1 + i * 0.6);
    ([0, split] as const).forEach((off, k) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * pt.f + off;
      const g = ctx.createGain();
      const a = amp * (k === 0 ? 1 : 0.82);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(a, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0005, a * 0.0007), t0 + dec);
      g.gain.linearRampToValueAtTime(0, t0 + dec + 0.5);
      osc.connect(g).connect(voiceGain);
      osc.start(t0);
      osc.stop(t0 + dec + 0.6);
    });
  });

  // "Ting" transient — bright inharmonic high partials, flash and die.
  ([6.7, 9.4, 12.3] as const).forEach((r, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * r * (1 + (Math.random() - 0.5) * 0.012);
    const g = ctx.createGain();
    const a = 0.085 * (1 - p.warmth * 0.6) / (i + 1);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(a, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.22 + i * 0.05);
    osc.connect(g).connect(voiceGain);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  });
}

// ── AudioEngine class ──────────────────────────────────────────────────────────

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private params: SoundParams = { ...DEFAULT_SOUND_PARAMS };

  // ── Context lifecycle ────────────────────────────────────────────────────────

  /**
   * Lazily create the AudioContext and connect the signal graph.
   * Must be called inside a user-gesture handler (click, keydown, etc.).
   * Safe to call multiple times — returns the existing context if already created.
   */
  resume(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;

      this.ctx = new AC();
      this.masterBus = this.ctx.createGain();

      // Compressor smooths peaks when many partials/voices stack (Build-Spec §4).
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value      = 22;
      comp.ratio.value     = 3;
      comp.attack.value    = 0.006;
      comp.release.value   = 0.3;
      this.masterBus.connect(comp).connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    this._applyVolume();
    return this.ctx;
  }

  private _applyVolume(): void {
    if (!this.masterBus) return;
    const v = (Number(this.params.volume) || 0) / 100;
    this.masterBus.gain.value = v * v * 0.5; // perceptual taper (Build-Spec §4)
  }

  // ── Params ───────────────────────────────────────────────────────────────────

  /** Replace the params object; volume is applied immediately if ctx exists. */
  setParams(p: Partial<SoundParams>): void {
    this.params = { ...this.params, ...p };
    if (this.masterBus) this._applyVolume();
  }

  getParams(): Readonly<SoundParams> {
    return this.params;
  }

  // ── Public play API ──────────────────────────────────────────────────────────

  /** Play a sound cue. Call from a user-gesture handler so the context auto-resumes. */
  play(kind: SoundKind): void {
    if (!kind || kind === 'none') return;
    const ctx = this.resume();
    if (!ctx || !this.masterBus) return;
    const t0 = ctx.currentTime + 0.02;
    if (kind === 'chime') this._playChime(ctx, t0);
    if (kind === 'bell')  this._playBells(ctx, t0);
  }

  /**
   * Audition a sound using the current params. Identical to play() but named
   * separately so the Settings UI has a clear hook for preview buttons.
   */
  preview(kind: SoundKind): void {
    this.play(kind);
  }

  // ── Internal voices ──────────────────────────────────────────────────────────

  private _playChime(ctx: AudioContext, t0: number): void {
    const p = this.params;
    const semis   = Number(p.chimePitch)   || 0;
    const warmth  = (Number(p.chimeWarmth)  || 0) / 100;
    const sustain = (Number(p.chimeSustain) || 0) / 100;
    const shimmer = (Number(p.chimeShimmer) || 0) / 100 * 12; // 0–100 → 0–12 cents
    const notes   = Math.max(1, Math.round(Number(p.chimeNotes) || 5));
    const spread  = (Number(p.chimeSpread) || 0) / 100;

    const root  = 587 * Math.pow(2, semis / 12);
    const decay = 2.2 + sustain * 5.5;

    // Fisher–Yates shuffle → take `notes` → sort mostly ascending (Build-Spec §4.1).
    const pool = CHIME_SCALE.slice() as number[];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const picked = pool.slice(0, Math.min(notes, pool.length)).sort((a, b) => a - b);

    // With 60% probability swap two interior notes — non-mechanical variation.
    if (picked.length > 2 && Math.random() < 0.6) {
      const i = 1 + Math.floor(Math.random() * (picked.length - 1));
      const j = 1 + Math.floor(Math.random() * (picked.length - 1));
      [picked[i], picked[j]] = [picked[j]!, picked[i]!];
    }

    let t = t0;
    picked.forEach((semi) => {
      const freq    = root * Math.pow(2, semi / 12);
      const hiRoll  = 1 - (semi / 24) * 0.45; // higher tubes quieter/shorter
      const vel     = rand(0.6, 1) * hiRoll;
      strikeVoice(ctx, this.masterBus!, freq, t, {
        gain:    0.34 * vel,
        decay:   decay * (0.7 + hiRoll * 0.5),
        warmth:  warmth,
        shimmer: shimmer,
        attack:  0.004 + warmth * 0.01,
      });
      t += rand(0.07, 0.16) * (0.4 + spread * 1.8);
    });
  }

  private _playBells(ctx: AudioContext, t0: number): void {
    const p = this.params;
    const semis   = Number(p.bellPitch)    || 0;
    const warmth  = (Number(p.bellWarmth)  || 0) / 100;
    const sustain = (Number(p.bellSustain) || 0) / 100;
    const warble  = (Number(p.bellShimmer) || 0) / 100;
    const rings   = Math.max(1, Math.min(3, Math.round(Number(p.bellRings) || 3)));

    const root  = 261.6 * Math.pow(2, semis / 12); // ~C4
    const decay = 5 + sustain * 11;
    const beat  = 0.5 + warble * 3.2; // Hz of warble

    const seq = RIN_SEQUENCES[rings] ?? [0];
    let t = t0;
    seq.forEach((semi) => {
      const freq    = root * Math.pow(2, semi / 12);
      const hiRoll  = 1 - (semi / 12) * 0.10;
      strikeRin(ctx, this.masterBus!, freq, t, {
        gain:   0.5 * hiRoll,
        decay:  decay * (0.82 + (1 - semi / 12) * 0.28),
        warmth: warmth,
        beat:   beat,
      });
      t += (1.5 + sustain * 1.5) * rand(0.92, 1.1);
    });
  }
}
