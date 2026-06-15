/**
 * Timer — drift-free wall-clock run loop (Build-Spec §6, Design-Doc §7).
 *
 * Pure module: no DOM access, no audio. The Runner subscribes via callbacks
 * and drives the AudioEngine. This keeps the timing logic testable and
 * framework-neutral (Build-Spec §11).
 *
 * Drift-free: each segment records `startAt = Date.now()`; every frame
 * computes `elapsed = (now - startAt) / 1000`. Frame deltas are NEVER
 * accumulated — the countdown self-corrects after throttling or tab sleep.
 */

import type { Session, SoundKind } from '../types.js';
import { segSeconds } from '../types.js';

// ── Callbacks ─────────────────────────────────────────────────────────────────

export interface TimerCallbacks {
  /** Fired when a segment begins (after the 700 ms handoff gap on transitions). */
  onSegmentStart: (index: number, segCount: number, segDur: number) => void;
  /**
   * Fired every animation frame while the current segment is running.
   * segRemain and totalRemain are clamped to >= 0.
   */
  onTick: (segRemain: number, totalRemain: number) => void;
  /**
   * Fired immediately when a segment's time elapses (before the 700 ms handoff).
   * The Runner should show 0:00 here and play the end cue.
   */
  onSegmentEnd: (index: number) => void;
  /** Fired once, after the last segment's end cue. */
  onComplete: () => void;
}

// ── Timer class ───────────────────────────────────────────────────────────────

export class Timer {
  private callbacks: TimerCallbacks;

  // Mutable run state
  private session:       Session | null = null;
  private playFn:        ((kind: SoundKind) => void) | null = null;
  private active        = false;
  private paused        = false;
  private inHandoff     = false;  // frozen 700 ms gap between segments

  private segIndex      = 0;
  private segDur        = 0;      // seconds of current segment
  private startAt       = 0;      // Date.now() when current segment started
  private pauseElapsed  = 0;      // seconds elapsed when paused
  private bounds:         number[] = [];  // cumulative seconds per segment
  private total         = 0;      // total session seconds

  private raf:           number | null = null;
  private handoffTimer:  ReturnType<typeof setTimeout> | null = null;

  constructor(callbacks: TimerCallbacks) {
    this.callbacks = callbacks;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Begin a new session. `play` is called each time a cue should sound;
   * the Runner passes `engine.play` here.
   */
  start(session: Session, play: (kind: SoundKind) => void): void {
    this._cancel();
    this.session  = session;
    this.playFn   = play;
    this.active   = true;
    this.paused   = false;
    this.segIndex = 0;

    // Precompute cumulative bounds for the total-remaining readout (Build-Spec §6).
    this.bounds = [];
    let acc = 0;
    for (const seg of session.segments) {
      acc += segSeconds(seg);
      this.bounds.push(acc);
    }
    this.total = acc;

    this._startSegment(0);
    this._loop();
  }

  /** Pause — stores elapsed so resume can shift startAt forward. */
  pause(): void {
    if (!this.active || this.paused || this.inHandoff) return;
    this.pauseElapsed = (Date.now() - this.startAt) / 1000;
    this.paused = true;
  }

  /** Resume — shifts startAt so the wall-clock countdown continues seamlessly. */
  resume(): void {
    if (!this.active || !this.paused) return;
    this.startAt = Date.now() - this.pauseElapsed * 1000;
    this.paused  = false;
  }

  /** End — cancel loop, reset all state. Safe to call multiple times. */
  end(): void {
    this._cancel();
  }

  get isActive(): boolean { return this.active; }
  get isPaused(): boolean { return this.paused; }

  // ── Internal ──────────────────────────────────────────────────────────────────

  private _startSegment(i: number): void {
    if (!this.session) return;
    this.segIndex = i;
    const seg     = this.session.segments[i]!;
    this.segDur   = segSeconds(seg);
    this.startAt  = Date.now();
    this.inHandoff = false;

    if (seg.start !== 'none') this.playFn!(seg.start);
    this.callbacks.onSegmentStart(i, this.session.segments.length, this.segDur);
  }

  // Arrow function so `this` is bound when passed to rAF.
  private _loop = (): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this._loop);
    if (!this.paused && !this.inHandoff) this._tick();
  };

  private _tick(): void {
    const elapsed    = (Date.now() - this.startAt) / 1000;
    const segRemain  = this.segDur - elapsed;

    // Total remaining: segments already done + remaining in current segment.
    const doneBefore   = this.segIndex > 0 ? this.bounds[this.segIndex - 1]! : 0;
    const totalElapsed = doneBefore + Math.min(elapsed, this.segDur);
    const totalRemain  = this.total - totalElapsed;

    this.callbacks.onTick(Math.max(0, segRemain), Math.max(0, totalRemain));

    if (segRemain <= 0) this._advance();
  }

  private _advance(): void {
    if (!this.session) return;
    const seg = this.session.segments[this.segIndex]!;

    if (seg.end !== 'none') this.playFn!(seg.end);
    this.callbacks.onSegmentEnd(this.segIndex);

    if (this.segIndex < this.session.segments.length - 1) {
      // ~700 ms frozen handoff so end cue + next start cue don't fully overlap
      // (Build-Spec §6, Design-Doc §7). Display stays at 0:00 during this gap.
      this.inHandoff = true;
      const next = this.segIndex + 1;
      this.handoffTimer = setTimeout(() => {
        if (!this.active) return;
        this._startSegment(next);
      }, 700);
    } else {
      this._complete();
    }
  }

  private _complete(): void {
    this._cancel();
    this.callbacks.onComplete();
  }

  private _cancel(): void {
    if (this.raf       != null) { cancelAnimationFrame(this.raf); this.raf = null; }
    if (this.handoffTimer != null) { clearTimeout(this.handoffTimer); this.handoffTimer = null; }
    this.active    = false;
    this.paused    = false;
    this.inHandoff = false;
  }
}
