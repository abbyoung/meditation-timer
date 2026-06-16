/**
 * Module: src/timer/Timer.ts
 * Tests: tick logic, drift-free elapsed computation, segment boundary precomputation,
 * pause/resume startAt shifting, 700 ms frozen handoff, all TimerCallbacks,
 * and multi-segment sequencing.
 *
 * Timing strategy:
 * - vi.useFakeTimers() mocks both setTimeout (handoff) AND requestAnimationFrame.
 * - IMPORTANT: vi.setSystemTime() changes Date.now() but does NOT fire pending timers
 *   in the gap. vi.advanceTimersByTime(N) fires all timers scheduled within N ms
 *   from the current fake clock position AND advances Date.now() by N.
 * - We use ONLY vi.advanceTimersByTime() (not vi.setSystemTime()) to control time.
 *   This means "elapsed = 30s" requires vi.advanceTimersByTime(30016) (30s + one frame).
 * - The fake rAF fires at 16ms intervals from when it was scheduled.
 * - timer.start() calls _loop() synchronously, which fires one immediate tick
 *   AND schedules the next rAF. The next rAF fires when the fake clock advances
 *   past the 16ms mark.
 *
 * Key do-not-regress behaviors tested here:
 * - elapsed = (Date.now() - startAt) / 1000 (never accumulated deltas)
 * - ~700 ms frozen handoff between segments
 * - pause shifts startAt forward rather than resetting
 * - onSegmentStart, onTick, onSegmentEnd, onComplete fire with correct args
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Timer } from '../Timer.js';
import type { TimerCallbacks } from '../Timer.js';
import type { Session, SoundKind } from '../../types.js';

// ── Pre-install rAF shim so vi.useFakeTimers() can replace it ─────────────────
// In Node/non-DOM environments, requestAnimationFrame is not present.
// vi.useFakeTimers() only stubs rAF if it already exists on global.
// We install a minimal shim here at module load time so that the fake
// timer system picks it up and manages it via vi.advanceTimersByTime().
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  let _rafId = 0;
  const _rafQueue = new Map<number, FrameRequestCallback>();
  (globalThis as unknown as Record<string, unknown>).requestAnimationFrame =
    function requestAnimationFrame(cb: FrameRequestCallback): number {
      const id = ++_rafId;
      _rafQueue.set(id, cb);
      setTimeout(() => {
        const fn = _rafQueue.get(id);
        if (fn) { _rafQueue.delete(id); fn(Date.now()); }
      }, 16);
      return id;
    };
  (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame =
    function cancelAnimationFrame(id: number): void {
      _rafQueue.delete(id);
    };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCallbacks(): { cb: TimerCallbacks; calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {
    onSegmentStart: [],
    onTick: [],
    onSegmentEnd: [],
    onComplete: [],
  };
  const cb: TimerCallbacks = {
    onSegmentStart: (...args) => { calls.onSegmentStart.push(args); },
    onTick: (...args) => { calls.onTick.push(args); },
    onSegmentEnd: (...args) => { calls.onSegmentEnd.push(args); },
    onComplete: (...args) => { calls.onComplete.push(args); },
  };
  return { cb, calls };
}

function makeSession(segments: Array<{ min: number; sec: number }>): Session {
  return {
    name: 'Test Session',
    segments: segments.map(({ min, sec }) => ({
      min,
      sec,
      start: 'chime' as SoundKind,
      end: 'bell' as SoundKind,
    })),
  };
}

const playFn = vi.fn<(kind: SoundKind) => void>();

/**
 * Advance the fake clock by N frames (16ms each) to get N ticks.
 */
function advanceFrames(n: number): void {
  vi.advanceTimersByTime(n * 16);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  playFn.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Construction ──────────────────────────────────────────────────────────────

describe('Timer construction', () => {
  it('starts inactive and unpaused', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    expect(timer.isActive).toBe(false);
    expect(timer.isPaused).toBe(false);
  });
});

// ── start() and onSegmentStart ────────────────────────────────────────────────

describe('start()', () => {
  it('sets isActive and fires onSegmentStart immediately for the first segment', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 1, sec: 0 }]);

    timer.start(session, playFn);

    expect(timer.isActive).toBe(true);
    expect(timer.isPaused).toBe(false);
    expect(calls.onSegmentStart.length).toBe(1);
    const [idx, count, dur] = calls.onSegmentStart[0]!;
    expect(idx).toBe(0);
    expect(count).toBe(1);
    expect(dur).toBe(60); // 1 min = 60 s
  });

  it('fires one immediate tick during start() before any time advances', () => {
    // _loop() is called synchronously in start(), which fires _tick() immediately.
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);
    expect(calls.onTick.length).toBe(1);
  });

  it('plays the start cue when the first segment begins', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 1, sec: 0 }]);

    timer.start(session, playFn);

    expect(playFn).toHaveBeenCalledWith('chime');
  });

  it('does not play start cue for a segment with start="none"', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    const session: Session = {
      name: 'Silent',
      segments: [{ min: 1, sec: 0, start: 'none', end: 'none' }],
    };

    timer.start(session, playFn);

    expect(playFn).not.toHaveBeenCalled();
  });

  it('cancels and restarts cleanly when called while already active', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 5, sec: 0 }]), playFn);
    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);

    expect(calls.onSegmentStart.length).toBe(2);
    expect(timer.isActive).toBe(true);
  });
});

// ── bounds[] precomputation and onTick totalRemain ───────────────────────────

describe('bounds[] precomputation and totalRemain', () => {
  it('reports correct segRemain and totalRemain for a single segment at t≈0', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 1, sec: 0 }]); // 60s total

    timer.start(session, playFn);
    // The synchronous tick fires at Date.now()≈0 → segRemain≈60, totalRemain≈60
    expect(calls.onTick.length).toBe(1);
    const [segRemain, totalRemain] = calls.onTick[0]!;
    expect(Number(segRemain)).toBeCloseTo(60, 0);
    expect(Number(totalRemain)).toBeCloseTo(60, 0);
  });

  it('computes correct totalRemain for a two-segment session at t≈0', () => {
    // seg0 = 60s, seg1 = 120s → total = 180s
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 1, sec: 0 }, { min: 2, sec: 0 }]);

    timer.start(session, playFn);
    const [segRemain, totalRemain] = calls.onTick[0]!;
    expect(Number(segRemain)).toBeCloseTo(60, 0);
    expect(Number(totalRemain)).toBeCloseTo(180, 0);
  });

  it('totalRemain correctly reflects elapsed time in current segment', () => {
    // 2 segments: 60s + 120s = 180s.
    // After 10s into seg0: segRemain≈50, totalRemain≈170
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 1, sec: 0 }, { min: 2, sec: 0 }]);

    timer.start(session, playFn); // startAt = Date.now() = 0

    // Advance 10s + one frame to get a tick at t=10016ms
    advanceFrames(627); // ~10016ms / 16ms ≈ 626 frames; use 627 to be safe

    const lastTick = calls.onTick.at(-1)!;
    const [segRemain, totalRemain] = lastTick;
    expect(Number(segRemain)).toBeCloseTo(50, 0);
    expect(Number(totalRemain)).toBeCloseTo(170, 0);
  });
});

// ── onTick — drift-free computation ──────────────────────────────────────────

describe('onTick — drift-free elapsed', () => {
  it('computes segRemain as (segDur - (now - startAt)/1000), not accumulated deltas', () => {
    // BUG GUARD: drift-free = wall-clock elapsed, NOT accumulated frame deltas.
    // We advance 30s worth of frames (30000/16 ≈ 1875 frames).
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 1, sec: 0 }]); // segDur = 60s

    timer.start(session, playFn); // startAt = 0

    // Advance 30s + 1 frame
    advanceFrames(1876); // 1876 * 16ms = 30016ms

    const lastTick = calls.onTick.at(-1)!;
    const [segRemain] = lastTick;
    // elapsed ≈ 30s → segRemain ≈ 30
    expect(Number(segRemain)).toBeCloseTo(30, 0);
  });

  it('fires onTick on every advanced frame', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);
    const ticksBefore = calls.onTick.length; // 1 immediate tick

    advanceFrames(3);

    expect(calls.onTick.length).toBe(ticksBefore + 3);
  });

  it('clamps segRemain and totalRemain to >= 0', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 5 }]);

    timer.start(session, playFn);

    // Advance 4.5s — still within segment, segRemain ≈ 0.5
    advanceFrames(282); // 282 * 16 = 4512ms

    const lastTick = calls.onTick.at(-1)!;
    expect(Number(lastTick[0])).toBeGreaterThanOrEqual(0);
    expect(Number(lastTick[1])).toBeGreaterThanOrEqual(0);
  });
});

// ── onSegmentEnd and _advance ─────────────────────────────────────────────────

describe('onSegmentEnd', () => {
  it('fires onSegmentEnd with the correct segment index when time elapses', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }]); // 5s

    timer.start(session, playFn);

    // Advance past 5s (5000ms / 16ms = 313 frames, advance 320 to be safe)
    advanceFrames(320);

    expect(calls.onSegmentEnd.length).toBe(1);
    expect(calls.onSegmentEnd[0]![0]).toBe(0); // segment index 0
  });

  it('plays end cue when segment ends', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    const session: Session = {
      name: 'Test',
      segments: [{ min: 0, sec: 5, start: 'none', end: 'bell' }],
    };

    timer.start(session, playFn);
    advanceFrames(320); // past 5s

    expect(playFn).toHaveBeenCalledWith('bell');
  });

  it('does not play end cue when end is "none"', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    const session: Session = {
      name: 'Test',
      segments: [{ min: 0, sec: 5, start: 'none', end: 'none' }],
    };

    timer.start(session, playFn);
    advanceFrames(320);

    expect(playFn).not.toHaveBeenCalled();
  });

  it('fires onSegmentEnd only once even if many frames fire after segment end', () => {
    // After _advance() fires, inHandoff=true → subsequent frames skip _tick()
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 5 }]);

    timer.start(session, playFn);
    advanceFrames(500); // well past end of first segment, before handoff expires

    // During inHandoff, no more _tick() calls → onSegmentEnd fires exactly once
    expect(calls.onSegmentEnd.length).toBe(1);
  });
});

// ── onComplete (single segment) ───────────────────────────────────────────────

describe('onComplete', () => {
  it('fires onComplete after the last segment ends (single segment)', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }]);

    timer.start(session, playFn);
    advanceFrames(320); // past 5s

    expect(calls.onComplete.length).toBe(1);
  });

  it('sets isActive to false after completion', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }]);

    timer.start(session, playFn);
    advanceFrames(320);

    expect(timer.isActive).toBe(false);
  });

  it('does not fire onComplete for a mid-session segment end', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 5 }]);

    timer.start(session, playFn);
    advanceFrames(320); // end of first segment, enters handoff

    expect(calls.onSegmentEnd.length).toBe(1);
    expect(calls.onComplete.length).toBe(0); // in handoff, not done yet
  });
});

// ── 700 ms frozen handoff ─────────────────────────────────────────────────────

describe('700 ms frozen handoff between segments', () => {
  it('delays onSegmentStart of second segment by ~700 ms after first segment ends', () => {
    // BUG GUARD: end cue and next start cue must not overlap.
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 5 }]);

    timer.start(session, playFn);
    advanceFrames(320); // end of first segment, enters handoff

    // onSegmentEnd fired, but seg1 onSegmentStart should NOT have happened yet
    expect(calls.onSegmentEnd.length).toBe(1);
    expect(calls.onSegmentStart.filter(([idx]) => idx === 1).length).toBe(0);

    // Advance through the 700ms setTimeout handoff
    vi.advanceTimersByTime(700);

    expect(calls.onSegmentStart.filter(([idx]) => idx === 1).length).toBe(1);
  });

  it('fires second segment onSegmentStart with index=1, correct count, and correct duration', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 10 }]);

    timer.start(session, playFn);
    advanceFrames(320);
    vi.advanceTimersByTime(700);

    const seg1Start = calls.onSegmentStart.find(([idx]) => idx === 1);
    expect(seg1Start).toBeDefined();
    const [idx, count, dur] = seg1Start!;
    expect(idx).toBe(1);
    expect(count).toBe(2);
    expect(dur).toBe(10);
  });

  it('inHandoff suppresses ticks — onTick does not fire during the 700ms gap', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 5 }]);

    timer.start(session, playFn);
    advanceFrames(320); // ends segment → inHandoff = true
    const tickCountAfterEnd = calls.onTick.length;

    // Fire more frames during handoff — no ticks should fire (inHandoff guards them)
    advanceFrames(5);

    expect(calls.onTick.length).toBe(tickCountAfterEnd);
  });

  it('fires onComplete after last segment ends in a two-segment session', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 5 }]);

    timer.start(session, playFn);

    // End first segment (320 frames × 16ms = 5120ms, past 5s)
    advanceFrames(320);
    // Complete 700ms handoff → _startSegment(1) fires, startAt resets
    vi.advanceTimersByTime(700);
    // End second segment: advance another 5000ms / 16 = 313+ frames
    advanceFrames(320);

    expect(calls.onComplete.length).toBe(1);
    expect(timer.isActive).toBe(false);
  });
});

// ── pause() / resume() ────────────────────────────────────────────────────────

describe('pause()', () => {
  it('sets isPaused to true', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);
    advanceFrames(10); // advance some frames
    timer.pause();

    expect(timer.isPaused).toBe(true);
  });

  it('is a no-op when called while not active', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    expect(() => timer.pause()).not.toThrow();
    expect(timer.isPaused).toBe(false);
  });

  it('is a no-op when called during handoff (inHandoff)', () => {
    // BUG GUARD: pause() checks inHandoff and returns early.
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([{ min: 0, sec: 5 }, { min: 0, sec: 5 }]);

    timer.start(session, playFn);
    advanceFrames(320); // end first segment → inHandoff = true

    timer.pause(); // should be rejected
    expect(timer.isPaused).toBe(false);
  });

  it('suppresses onTick while paused', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);
    advanceFrames(1); // one frame before pause
    timer.pause();
    const tickCountAtPause = calls.onTick.length;

    advanceFrames(10); // advance while paused — no ticks should fire

    expect(calls.onTick.length).toBe(tickCountAtPause);
  });
});

describe('resume()', () => {
  it('clears isPaused', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);
    advanceFrames(10);
    timer.pause();
    timer.resume();

    expect(timer.isPaused).toBe(false);
  });

  it('shifts startAt forward so elapsed is preserved after resume (do-not-regress)', () => {
    // BUG GUARD:
    //   on pause: pauseElapsed = (now - startAt) / 1000
    //   on resume: startAt = now - pauseElapsed * 1000
    // After resume, the next tick reads the SAME elapsed as at pause time.
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn); // startAt=0, segDur=60

    // Advance exactly 10s worth of frames (10000ms / 16ms = 625 frames)
    advanceFrames(625); // clock now ≈ 10000ms, elapsed ≈ 10s, segRemain ≈ 50

    // Pause at ~10s elapsed
    timer.pause(); // pauseElapsed ≈ 10s

    // Advance 30s while paused (no ticks fire)
    advanceFrames(1875); // clock advances but paused, so no _tick()
    // clock now at ≈ 10000 + 30000 = 40000ms

    // Resume: startAt = Date.now() - pauseElapsed * 1000 ≈ 40000 - 10000 = 30000
    timer.resume();
    advanceFrames(1); // fire one tick: elapsed = (40016 - 30000)/1000 ≈ 10.016

    const lastTick = calls.onTick.at(-1)!;
    const [segRemain] = lastTick;
    // segDur=60, elapsed≈10 → segRemain≈50
    expect(Number(segRemain)).toBeCloseTo(50, 0);
  });

  it('is a no-op when called while not paused', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);

    expect(() => timer.resume()).not.toThrow();
    expect(timer.isPaused).toBe(false);
  });

  it('is a no-op when called while not active', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    expect(() => timer.resume()).not.toThrow();
  });
});

// ── end() ─────────────────────────────────────────────────────────────────────

describe('end()', () => {
  it('sets isActive to false', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);

    timer.end();
    expect(timer.isActive).toBe(false);
  });

  it('is safe to call multiple times (no throw)', () => {
    const { cb } = makeCallbacks();
    const timer = new Timer(cb);
    expect(() => { timer.end(); timer.end(); }).not.toThrow();
  });

  it('does not fire onComplete when end() is called manually', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);
    timer.end();

    expect(calls.onComplete.length).toBe(0);
  });

  it('stops ticks after end()', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);

    timer.start(makeSession([{ min: 1, sec: 0 }]), playFn);
    advanceFrames(2);
    timer.end();
    const countAtEnd = calls.onTick.length;

    advanceFrames(10); // would fire more ticks if loop still running
    expect(calls.onTick.length).toBe(countAtEnd);
  });
});

// ── Three-segment session (full integration) ──────────────────────────────────

describe('three-segment session — full sequencing', () => {
  it('fires all callbacks in correct order across 3 segments', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    const session = makeSession([
      { min: 0, sec: 5 },
      { min: 0, sec: 5 },
      { min: 0, sec: 5 },
    ]);

    timer.start(session, playFn); // onSegmentStart(0)

    // Segment 0 → end
    advanceFrames(320); // onSegmentEnd(0), enters handoff
    vi.advanceTimersByTime(700); // handoff → onSegmentStart(1)

    // Segment 1 → end (startAt was reset by _startSegment(1))
    advanceFrames(320); // onSegmentEnd(1), enters handoff
    vi.advanceTimersByTime(700); // handoff → onSegmentStart(2)

    // Segment 2 → end + complete
    advanceFrames(320); // onSegmentEnd(2) → onComplete()

    expect(calls.onSegmentStart.length).toBe(3);
    expect(calls.onSegmentEnd.length).toBe(3);
    expect(calls.onComplete.length).toBe(1);

    for (let i = 0; i < 3; i++) {
      expect(calls.onSegmentStart[i]![0]).toBe(i);
      expect(calls.onSegmentEnd[i]![0]).toBe(i);
    }

    expect(timer.isActive).toBe(false);
  });
});

// ── Segment duration computation ──────────────────────────────────────────────

describe('segment duration passed to onSegmentStart', () => {
  it('passes correct segDur for min-only segment', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    timer.start({
      name: 'T',
      segments: [{ min: 3, sec: 0, start: 'none', end: 'none' }],
    }, playFn);
    expect(calls.onSegmentStart[0]![2]).toBe(180); // 3 * 60
  });

  it('passes correct segDur for sec-only segment', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    timer.start({
      name: 'T',
      segments: [{ min: 0, sec: 45, start: 'none', end: 'none' }],
    }, playFn);
    expect(calls.onSegmentStart[0]![2]).toBe(45);
  });

  it('passes correct segDur for mixed min+sec segment', () => {
    const { cb, calls } = makeCallbacks();
    const timer = new Timer(cb);
    timer.start({
      name: 'T',
      segments: [{ min: 2, sec: 30, start: 'none', end: 'none' }],
    }, playFn);
    expect(calls.onSegmentStart[0]![2]).toBe(150); // 2*60 + 30
  });
});
