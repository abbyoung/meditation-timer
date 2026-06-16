/**
 * Module: src/persistence/Store.ts
 * Tests: localStorage adapter — round-trip reads/writes, case-insensitive upsert,
 * newest-first ordering, deletion, sound params, and quota/private-mode robustness.
 *
 * Limitations: localStorage is shimmed with an in-memory map. The shim is installed
 * globally before each test and torn down after, so tests are fully isolated.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadLast,
  saveLast,
  loadSaved,
  upsertSaved,
  deleteSaved,
  loadSoundParams,
  saveSoundParams,
} from '../Store.js';
import { DEFAULT_PRESET } from '../../types.js';
import { DEFAULT_SOUND_PARAMS } from '../../audio/AudioEngine.js';
import type { Session } from '../../types.js';
import type { SoundParams } from '../../audio/AudioEngine.js';

// ── localStorage shim ─────────────────────────────────────────────────────────

function makeLocalStorageShim(): Storage {
  const store: Map<string, string> = new Map();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

let shim: Storage;

beforeEach(() => {
  shim = makeLocalStorageShim();
  Object.defineProperty(global, 'localStorage', {
    value: shim,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeSession(name: string): Session {
  return {
    name,
    segments: [{ min: 5, sec: 0, start: 'chime', end: 'none' }],
  };
}

// ── loadLast / saveLast ───────────────────────────────────────────────────────

describe('loadLast', () => {
  it('returns a clone of DEFAULT_PRESET when nothing is stored', () => {
    const result = loadLast();
    expect(result).toEqual(DEFAULT_PRESET);
    // Must be a deep clone, not the same reference
    expect(result).not.toBe(DEFAULT_PRESET);
  });

  it('returns the previously saved session after saveLast', () => {
    const session = makeSession('Morning Sit');
    saveLast(session);
    const result = loadLast();
    expect(result).toEqual(session);
  });

  it('round-trips a session with all segment fields intact', () => {
    const session: Session = {
      name: 'Evening Practice',
      segments: [
        { min: 2, sec: 30, start: 'chime', end: 'none' },
        { min: 20, sec: 0, start: 'none', end: 'bell' },
      ],
    };
    saveLast(session);
    expect(loadLast()).toEqual(session);
  });
});

describe('saveLast', () => {
  it('overwrites a previous save', () => {
    saveLast(makeSession('First'));
    const updated = makeSession('Updated');
    saveLast(updated);
    expect(loadLast().name).toBe('Updated');
  });
});

// ── loadSaved / upsertSaved / deleteSaved ────────────────────────────────────

describe('loadSaved', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(loadSaved()).toEqual([]);
  });
});

describe('upsertSaved', () => {
  it('prepends new sessions (newest first)', () => {
    upsertSaved(makeSession('Alpha'));
    upsertSaved(makeSession('Beta'));
    const saved = loadSaved();
    expect(saved[0]!.name).toBe('Beta');
    expect(saved[1]!.name).toBe('Alpha');
  });

  it('replaces an existing session with matching name (case-sensitive exact match)', () => {
    const original = makeSession('Daily Practice');
    upsertSaved(original);

    const updated: Session = {
      name: 'Daily Practice',
      segments: [{ min: 30, sec: 0, start: 'bell', end: 'bell' }],
    };
    upsertSaved(updated);

    const saved = loadSaved();
    expect(saved.length).toBe(1);
    expect(saved[0]!.segments[0]!.min).toBe(30);
  });

  it('is case-insensitive when matching existing entries', () => {
    upsertSaved(makeSession('Daily Practice'));
    // Upsert with different casing — should update in place, not add a new entry
    upsertSaved(makeSession('daily practice'));
    expect(loadSaved().length).toBe(1);
  });

  it('preserves position of updated entry (does not move to front)', () => {
    upsertSaved(makeSession('Alpha'));
    upsertSaved(makeSession('Beta'));
    // Update "Alpha" which is now at index 1 — it should stay at index 1
    const updatedAlpha: Session = {
      name: 'Alpha',
      segments: [{ min: 99, sec: 0, start: 'none', end: 'none' }],
    };
    upsertSaved(updatedAlpha);
    const saved = loadSaved();
    expect(saved[0]!.name).toBe('Beta');
    expect(saved[1]!.name).toBe('Alpha');
    expect(saved[1]!.segments[0]!.min).toBe(99);
  });

  it('stores a deep clone — mutations to the original do not affect stored data', () => {
    const session = makeSession('Test');
    upsertSaved(session);
    session.name = 'Mutated';
    expect(loadSaved()[0]!.name).toBe('Test');
  });

  it('matches with trimmed whitespace in name', () => {
    upsertSaved(makeSession('  Trimmed  '));
    upsertSaved(makeSession('  trimmed  '));
    expect(loadSaved().length).toBe(1);
  });
});

describe('deleteSaved', () => {
  it('removes the entry at the given index', () => {
    upsertSaved(makeSession('Alpha'));
    upsertSaved(makeSession('Beta'));
    // saved = [Beta(0), Alpha(1)]
    deleteSaved(0);
    const saved = loadSaved();
    expect(saved.length).toBe(1);
    expect(saved[0]!.name).toBe('Alpha');
  });

  it('is a no-op for out-of-range index (negative)', () => {
    upsertSaved(makeSession('Alpha'));
    deleteSaved(-1);
    expect(loadSaved().length).toBe(1);
  });

  it('is a no-op for out-of-range index (too large)', () => {
    upsertSaved(makeSession('Alpha'));
    deleteSaved(99);
    expect(loadSaved().length).toBe(1);
  });

  it('is a no-op on an empty list', () => {
    expect(() => deleteSaved(0)).not.toThrow();
    expect(loadSaved().length).toBe(0);
  });

  it('correctly removes from the middle of the list', () => {
    upsertSaved(makeSession('A'));
    upsertSaved(makeSession('B'));
    upsertSaved(makeSession('C'));
    // saved = [C(0), B(1), A(2)]
    deleteSaved(1);
    const saved = loadSaved();
    expect(saved.map((s) => s.name)).toEqual(['C', 'A']);
  });
});

// ── loadSoundParams / saveSoundParams ─────────────────────────────────────────

describe('loadSoundParams', () => {
  it('returns DEFAULT_SOUND_PARAMS when nothing is stored', () => {
    expect(loadSoundParams()).toEqual(DEFAULT_SOUND_PARAMS);
  });

  it('returns stored params after saveSoundParams', () => {
    const params: SoundParams = { ...DEFAULT_SOUND_PARAMS, volume: 50, bellRings: 1 };
    saveSoundParams(params);
    expect(loadSoundParams()).toEqual(params);
  });

  it('fills in missing keys from defaults when stored object is partial', () => {
    // Simulate a partial stored object (e.g. from an older app version)
    shim.setItem('stillpoint.sound', JSON.stringify({ volume: 30 }));
    const result = loadSoundParams();
    expect(result.volume).toBe(30);
    // All other fields come from defaults
    expect(result.chimePitch).toBe(DEFAULT_SOUND_PARAMS.chimePitch);
    expect(result.bellRings).toBe(DEFAULT_SOUND_PARAMS.bellRings);
  });
});

describe('saveSoundParams', () => {
  it('round-trips all 12 params', () => {
    const params: SoundParams = {
      volume: 60,
      chimePitch: 3,
      chimeWarmth: 70,
      chimeSustain: 50,
      chimeShimmer: 30,
      chimeNotes: 5,
      chimeSpread: 20,
      bellPitch: -2,
      bellWarmth: 80,
      bellSustain: 60,
      bellShimmer: 40,
      bellRings: 2,
    };
    saveSoundParams(params);
    expect(loadSoundParams()).toEqual(params);
  });
});

// ── Quota / private-mode robustness ───────────────────────────────────────────

describe('localStorage error robustness', () => {
  it('loadLast does not throw when localStorage.getItem throws', () => {
    vi.spyOn(shim, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => loadLast()).not.toThrow();
    // Falls back to DEFAULT_PRESET
    expect(loadLast()).toEqual(DEFAULT_PRESET);
  });

  it('saveLast does not throw when localStorage.setItem throws (quota exceeded)', () => {
    vi.spyOn(shim, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveLast(makeSession('Test'))).not.toThrow();
  });

  it('loadSaved returns empty array when localStorage.getItem throws', () => {
    vi.spyOn(shim, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadSaved()).toEqual([]);
  });

  it('upsertSaved does not throw when setItem throws', () => {
    vi.spyOn(shim, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => upsertSaved(makeSession('Test'))).not.toThrow();
  });

  it('loadSoundParams returns defaults when getItem throws', () => {
    vi.spyOn(shim, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadSoundParams()).toEqual(DEFAULT_SOUND_PARAMS);
  });

  it('saveSoundParams does not throw when setItem throws', () => {
    vi.spyOn(shim, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => saveSoundParams({ ...DEFAULT_SOUND_PARAMS })).not.toThrow();
  });

  it('loadLast returns DEFAULT_PRESET when stored JSON is malformed', () => {
    shim.setItem('stillpoint.last', '{not valid json}');
    expect(() => loadLast()).not.toThrow();
    expect(loadLast()).toEqual(DEFAULT_PRESET);
  });

  it('loadSaved returns empty array when stored JSON is malformed', () => {
    shim.setItem('stillpoint.saved', 'not-json');
    expect(() => loadSaved()).not.toThrow();
    expect(loadSaved()).toEqual([]);
  });
});
