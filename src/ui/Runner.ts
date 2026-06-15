/**
 * Runner — session-in-progress screen (Build-Spec §3, §6, §7, Design-Doc §2.2, §7, §8).
 *
 * Subscribes to Timer events, drives the Runner DOM, manages Screen Wake Lock
 * and ambient dimming. Calls onEnd() when the user returns home (End or Complete).
 */

import type { Session } from '../types.js';
import type { AudioEngine } from '../audio/AudioEngine.js';
import { Timer } from '../timer/Timer.js';
import { fmtClock } from './format.js';

// ── DOM helper ────────────────────────────────────────────────────────────────

function qs<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Runner: element not found: ${sel}`);
  return el;
}

// ── Runner class ──────────────────────────────────────────────────────────────

export class Runner {
  private engine:  AudioEngine;
  private timer:   Timer;
  private onEnd:   () => void;

  private active = false;

  // Wake lock (Build-Spec §7)
  private wakeLock: WakeLockSentinel | null = null;

  // Dim / brighten timers
  private dimTimer:  ReturnType<typeof setTimeout> | null = null;
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  // Bound handlers so we can removeEventListener them cleanly
  private _boundVisibility: () => void;
  private _boundInteraction: () => void;

  // DOM refs (populated in mount())
  private el!: {
    body:        HTMLElement;
    runner:      HTMLElement;
    runName:     HTMLElement;
    runSegLabel: HTMLElement;
    runTime:     HTMLElement;
    runTotal:    HTMLElement;
    runDots:     HTMLElement;
    pauseBtn:    HTMLButtonElement;
    endBtn:      HTMLButtonElement;
    endBtn2:     HTMLButtonElement;
  };

  constructor(engine: AudioEngine, onEnd: () => void) {
    this.engine = engine;
    this.onEnd  = onEnd;

    this.timer = new Timer({
      onSegmentStart: (index, segCount, _segDur) => {
        this._onSegmentStart(index, segCount);
      },
      onTick: (segRemain, totalRemain) => {
        this._onTick(segRemain, totalRemain);
      },
      onSegmentEnd: (_index) => {
        // Show 0:00 at segment boundary; display stays frozen during the handoff.
        this.el.runTime.textContent = '0:00';
      },
      onComplete: () => {
        this._onComplete();
      },
    });

    this._boundVisibility  = () => this._onVisibility();
    this._boundInteraction = () => { if (this.active) this._wakeScreen(); };
  }

  // ── Mount ─────────────────────────────────────────────────────────────────────

  /** Call once after DOMContentLoaded to wire up DOM refs and static events. */
  mount(): void {
    this.el = {
      body:        document.body,
      runner:      qs('#runner'),
      runName:     qs('#runName'),
      runSegLabel: qs('#runSegLabel'),
      runTime:     qs('#runTime'),
      runTotal:    qs('#runTotal'),
      runDots:     qs('#runDots'),
      pauseBtn:    qs<HTMLButtonElement>('#pauseBtn'),
      endBtn:      qs<HTMLButtonElement>('#endBtn'),
      endBtn2:     qs<HTMLButtonElement>('#endBtn2'),
    };

    this.el.pauseBtn.addEventListener('click', () => this._togglePause());
    this.el.endBtn.addEventListener('click',   () => this._end());
    this.el.endBtn2.addEventListener('click',  () => this._end());

    // Any interaction while running brightens the screen.
    for (const evt of ['pointerdown', 'pointermove', 'keydown'] as const) {
      this.el.runner.addEventListener(evt, this._boundInteraction);
    }
  }

  // ── Public: start a session ───────────────────────────────────────────────────

  start(session: Session): void {
    this.active = true;

    // Switch to running view.
    const { body } = this.el;
    body.classList.add('running');
    body.classList.remove('complete', 'dimmed', 'awake');

    this.el.runName.textContent = session.name || 'Session';
    this._buildDots(session.segments.length);

    void this._requestWake();
    this._wakeScreen();
    this._scheduleDim();

    document.addEventListener('visibilitychange', this._boundVisibility);

    this.timer.start(session, (kind) => this.engine.play(kind));
  }

  // ── Timer callbacks ───────────────────────────────────────────────────────────

  private _onSegmentStart(index: number, segCount: number): void {
    this.el.runSegLabel.textContent = `Segment ${index + 1} of ${segCount}`;
    this._updateDots(index);
  }

  private _onTick(segRemain: number, totalRemain: number): void {
    this.el.runTime.textContent  = fmtClock(segRemain);
    this.el.runTotal.textContent = `${fmtClock(totalRemain)} remaining`;
  }

  private _onComplete(): void {
    this.active = false;
    const { body } = this.el;
    body.classList.add('complete');
    body.classList.remove('dimmed');
    this._wakeScreen();
    this._clearDimTimer();
    this._releaseWake();
    document.removeEventListener('visibilitychange', this._boundVisibility);
  }

  // ── End / return home ─────────────────────────────────────────────────────────

  private _end(): void {
    this.timer.end();
    this.active = false;
    const { body } = this.el;
    body.classList.remove('running', 'complete', 'dimmed', 'awake');
    this._clearDimTimer();
    this._clearWakeTimer();
    this._releaseWake();
    document.removeEventListener('visibilitychange', this._boundVisibility);
    this.onEnd();
  }

  // ── Pause / Resume ────────────────────────────────────────────────────────────

  private _togglePause(): void {
    if (!this.active) return;
    if (this.timer.isPaused) {
      this.timer.resume();
      this.el.pauseBtn.textContent = 'Pause';
    } else {
      this.timer.pause();
      this.el.pauseBtn.textContent = 'Resume';
    }
    this._wakeScreen();
  }

  // ── Progress dots ─────────────────────────────────────────────────────────────

  private _buildDots(count: number): void {
    this.el.runDots.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'dot';
      this.el.runDots.appendChild(d);
    }
  }

  private _updateDots(activeIndex: number): void {
    [...this.el.runDots.children].forEach((d, i) => {
      d.classList.toggle('done',   i < activeIndex);
      d.classList.toggle('active', i === activeIndex);
    });
  }

  // ── Screen Wake Lock (Build-Spec §7) ─────────────────────────────────────────

  private async _requestWake(): Promise<void> {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // User agent may deny; non-fatal.
    }
  }

  private _releaseWake(): void {
    try {
      if (this.wakeLock) { void this.wakeLock.release(); this.wakeLock = null; }
    } catch { /* non-fatal */ }
  }

  private _onVisibility(): void {
    // OS auto-releases the lock when tab is hidden; re-acquire on return.
    if (document.visibilityState === 'visible' && this.active) {
      void this._requestWake();
    }
  }

  // ── Ambient dimming (Build-Spec §7) ──────────────────────────────────────────

  /** Dim the screen ~6 s after last interaction. */
  private _scheduleDim(): void {
    this._clearDimTimer();
    this.dimTimer = setTimeout(() => {
      if (this.active) this.el.body.classList.add('dimmed');
    }, 6_000);
  }

  /** Brighten immediately, hold awake ~4 s, then re-arm dim. */
  private _wakeScreen(): void {
    const { body } = this.el;
    body.classList.add('awake');
    body.classList.remove('dimmed');
    this._clearWakeTimer();
    this.wakeTimer = setTimeout(() => body.classList.remove('awake'), 4_000);
    if (this.active) this._scheduleDim();
  }

  private _clearDimTimer(): void {
    if (this.dimTimer != null) { clearTimeout(this.dimTimer); this.dimTimer = null; }
  }

  private _clearWakeTimer(): void {
    if (this.wakeTimer != null) { clearTimeout(this.wakeTimer); this.wakeTimer = null; }
  }
}
