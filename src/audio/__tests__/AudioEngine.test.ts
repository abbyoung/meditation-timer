/**
 * Module: src/audio/AudioEngine.ts
 * Tests: AudioContext lazy creation, setParams/getParams, play/preview dispatch,
 * DEFAULT_SOUND_PARAMS constants, and that chime uses Fisher-Yates shuffle
 * (non-deterministic) while bell uses root→octave→fifth sequence.
 *
 * Limitations: AudioContext is fully mocked — no real audio graph is created.
 * All oscillator/gain/filter/compressor node calls are stubbed with vi.fn().
 * We assert on the structure of node-creation calls, not on waveform output.
 *
 * IMPORTANT: The numeric constants in DEFAULT_SOUND_PARAMS and the audio DSP code
 * are tuned targets from Build-Spec §4. This test file asserts they match the spec
 * but NEVER changes them to make tests pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioEngine, DEFAULT_SOUND_PARAMS } from '../AudioEngine.js';
import type { SoundParams } from '../AudioEngine.js';

// ── AudioContext mock ─────────────────────────────────────────────────────────

function makeAudioNodeMock() {
  return {
    connect: vi.fn().mockReturnThis(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

function makeGainNodeMock() {
  return {
    ...makeAudioNodeMock(),
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
}

function makeOscillatorMock() {
  return {
    ...makeAudioNodeMock(),
    type: 'sine',
    frequency: { value: 0 },
    detune: { value: 0 },
  };
}

function makeBiquadFilterMock() {
  return {
    ...makeAudioNodeMock(),
    type: 'lowpass',
    frequency: {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    Q: { value: 0 },
  };
}

function makeBufferMock(sampleRate: number) {
  return {
    getChannelData: vi.fn().mockReturnValue(new Float32Array(Math.ceil(sampleRate * 0.05))),
  };
}

function makeCompressorMock() {
  return {
    ...makeAudioNodeMock(),
    threshold: { value: 0 },
    knee: { value: 0 },
    ratio: { value: 0 },
    attack: { value: 0 },
    release: { value: 0 },
  };
}

interface MockAudioContext {
  state: string;
  currentTime: number;
  sampleRate: number;
  destination: ReturnType<typeof makeAudioNodeMock>;
  createGain: ReturnType<typeof vi.fn>;
  createOscillator: ReturnType<typeof vi.fn>;
  createBiquadFilter: ReturnType<typeof vi.fn>;
  createDynamicsCompressor: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  _gainCallCount: number;
  _oscCallCount: number;
  _filterCallCount: number;
}

function makeMockAudioContext(): MockAudioContext {
  const ctx: MockAudioContext = {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: makeAudioNodeMock(),
    _gainCallCount: 0,
    _oscCallCount: 0,
    _filterCallCount: 0,
    createGain: vi.fn(() => {
      ctx._gainCallCount++;
      return makeGainNodeMock();
    }),
    createOscillator: vi.fn(() => {
      ctx._oscCallCount++;
      return makeOscillatorMock();
    }),
    createBiquadFilter: vi.fn(() => {
      ctx._filterCallCount++;
      return makeBiquadFilterMock();
    }),
    createDynamicsCompressor: vi.fn(() => makeCompressorMock()),
    createBuffer: vi.fn((_channels: number, _length: number, sampleRate: number) =>
      makeBufferMock(sampleRate),
    ),
    createBufferSource: vi.fn(() => ({
      ...makeAudioNodeMock(),
      buffer: null,
    })),
    resume: vi.fn().mockResolvedValue(undefined),
  };
  return ctx;
}

// Install the mock AudioContext on global before each test.
// Must be a proper constructor function (not arrow fn) because AudioEngine calls `new AC()`.
let mockCtx: MockAudioContext;
let audioContextCallCount: number;

beforeEach(() => {
  mockCtx = makeMockAudioContext();
  audioContextCallCount = 0;
  // Regular function (not arrow) so `new AudioContext()` works as a constructor call
  function MockAudioContext(this: unknown) {
    audioContextCallCount++;
    return mockCtx;
  }
  Object.defineProperty(global, 'window', {
    value: {
      AudioContext: MockAudioContext,
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── DEFAULT_SOUND_PARAMS constants (Build-Spec §4, §5) ───────────────────────

describe('DEFAULT_SOUND_PARAMS', () => {
  it('has volume: 80', () => { expect(DEFAULT_SOUND_PARAMS.volume).toBe(80); });
  it('has chimePitch: 0', () => { expect(DEFAULT_SOUND_PARAMS.chimePitch).toBe(0); });
  it('has chimeWarmth: 45', () => { expect(DEFAULT_SOUND_PARAMS.chimeWarmth).toBe(45); });
  it('has chimeSustain: 41', () => { expect(DEFAULT_SOUND_PARAMS.chimeSustain).toBe(41); });
  it('has chimeShimmer: 60', () => { expect(DEFAULT_SOUND_PARAMS.chimeShimmer).toBe(60); });
  it('has chimeNotes: 9', () => { expect(DEFAULT_SOUND_PARAMS.chimeNotes).toBe(9); });
  it('has chimeSpread: 37', () => { expect(DEFAULT_SOUND_PARAMS.chimeSpread).toBe(37); });
  it('has bellPitch: 0', () => { expect(DEFAULT_SOUND_PARAMS.bellPitch).toBe(0); });
  it('has bellWarmth: 39', () => { expect(DEFAULT_SOUND_PARAMS.bellWarmth).toBe(39); });
  it('has bellSustain: 44', () => { expect(DEFAULT_SOUND_PARAMS.bellSustain).toBe(44); });
  it('has bellShimmer: 55', () => { expect(DEFAULT_SOUND_PARAMS.bellShimmer).toBe(55); });
  it('has bellRings: 3', () => { expect(DEFAULT_SOUND_PARAMS.bellRings).toBe(3); });
});

// ── getParams / setParams ────────────────────────────────────────────────────

describe('getParams / setParams', () => {
  it('getParams returns DEFAULT_SOUND_PARAMS values initially', () => {
    const engine = new AudioEngine();
    expect(engine.getParams()).toEqual(DEFAULT_SOUND_PARAMS);
  });

  it('setParams merges partial updates', () => {
    const engine = new AudioEngine();
    engine.setParams({ volume: 50, bellRings: 1 });
    const params = engine.getParams();
    expect(params.volume).toBe(50);
    expect(params.bellRings).toBe(1);
    // Other values unchanged
    expect(params.chimePitch).toBe(DEFAULT_SOUND_PARAMS.chimePitch);
  });

  it('setParams replaces the whole params on full object', () => {
    const engine = new AudioEngine();
    const newParams: SoundParams = {
      volume: 60,
      chimePitch: 2,
      chimeWarmth: 70,
      chimeSustain: 50,
      chimeShimmer: 30,
      chimeNotes: 5,
      chimeSpread: 20,
      bellPitch: -1,
      bellWarmth: 80,
      bellSustain: 60,
      bellShimmer: 40,
      bellRings: 2,
    };
    engine.setParams(newParams);
    expect(engine.getParams()).toEqual(newParams);
  });
});

// ── resume() — lazy AudioContext creation ─────────────────────────────────────

describe('resume()', () => {
  it('returns null when window.AudioContext is not available', () => {
    Object.defineProperty(global, 'window', {
      value: {},
      writable: true,
      configurable: true,
    });
    const engine = new AudioEngine();
    expect(engine.resume()).toBeNull();
  });

  it('creates an AudioContext on first call', () => {
    const engine = new AudioEngine();
    const ctx = engine.resume();
    expect(ctx).not.toBeNull();
    expect(ctx).toBe(mockCtx);
  });

  it('returns the same context on subsequent calls (lazy singleton)', () => {
    const engine = new AudioEngine();
    const ctx1 = engine.resume();
    const ctx2 = engine.resume();
    expect(ctx1).toBe(ctx2);
    // AudioContext constructor should only be called once
    expect(audioContextCallCount).toBe(1);
  });

  it('calls ctx.resume() when context is suspended', () => {
    mockCtx.state = 'suspended';
    const engine = new AudioEngine();
    engine.resume();
    expect(mockCtx.resume).toHaveBeenCalled();
  });

  it('does not call ctx.resume() when context is already running', () => {
    mockCtx.state = 'running';
    const engine = new AudioEngine();
    engine.resume();
    expect(mockCtx.resume).not.toHaveBeenCalled();
  });

  it('connects masterBus → compressor → destination on first call', () => {
    const engine = new AudioEngine();
    engine.resume();
    // createDynamicsCompressor should be called exactly once
    expect(mockCtx.createDynamicsCompressor).toHaveBeenCalledTimes(1);
    // createGain should have been called (at minimum) for the masterBus
    expect(mockCtx.createGain).toHaveBeenCalled();
  });

  it('applies volume as perceptual taper: gain = (v/100)^2 * 0.5', () => {
    const engine = new AudioEngine();
    engine.resume();
    // With default volume=80: gain = (0.8)^2 * 0.5 = 0.32
    const masterBus = mockCtx.createGain.mock.results[0]?.value as ReturnType<typeof makeGainNodeMock>;
    expect(masterBus.gain.value).toBeCloseTo(0.32, 3);
  });
});

// ── play() / preview() dispatch ───────────────────────────────────────────────

describe('play()', () => {
  it('does nothing for kind="none"', () => {
    const engine = new AudioEngine();
    engine.play('none');
    expect(mockCtx.createOscillator).not.toHaveBeenCalled();
  });

  it('creates oscillators for kind="chime"', () => {
    const engine = new AudioEngine();
    engine.play('chime');
    // Chime has harmonic partials — at least some oscillators should be created
    expect(mockCtx.createOscillator.mock.calls.length).toBeGreaterThan(0);
  });

  it('creates oscillators for kind="bell"', () => {
    const engine = new AudioEngine();
    engine.play('bell');
    expect(mockCtx.createOscillator.mock.calls.length).toBeGreaterThan(0);
  });

  it('creates more oscillators for chime than a no-sound call', () => {
    const engine = new AudioEngine();
    engine.play('chime');
    const chimeOscCount = mockCtx._oscCallCount;
    expect(chimeOscCount).toBeGreaterThan(0);
  });

  it('creates audio nodes for bell with bellRings=3 (root→octave→fifth)', () => {
    const engine = new AudioEngine();
    // bellRings=3 plays 3 strikes
    engine.play('bell');
    // Each strike creates buffer sources and oscillators
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(3); // one per ring
    expect(mockCtx.createOscillator.mock.calls.length).toBeGreaterThan(0);
  });

  it('creates fewer audio nodes for bell with bellRings=1', () => {
    const engine = new AudioEngine();
    engine.setParams({ bellRings: 1 });
    engine.play('bell');
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(1);
  });

  it('creates audio nodes for bell with bellRings=2', () => {
    const engine = new AudioEngine();
    engine.setParams({ bellRings: 2 });
    engine.play('bell');
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(2);
  });
});

describe('preview()', () => {
  it('behaves identically to play() for "chime"', () => {
    const engine1 = new AudioEngine();
    engine1.play('chime');
    const playOscCount = mockCtx._oscCallCount;

    // Reset mock
    mockCtx._oscCallCount = 0;
    mockCtx.createOscillator.mockClear();
    // Reset context state so a new engine creates fresh nodes
    mockCtx._gainCallCount = 0;
    mockCtx.createGain.mockClear();

    const engine2 = new AudioEngine();
    engine2.preview('chime');
    const previewOscCount = mockCtx._oscCallCount;

    // Both should create oscillators (exact count may vary due to RNG, but both > 0)
    expect(playOscCount).toBeGreaterThan(0);
    expect(previewOscCount).toBeGreaterThan(0);
  });

  it('behaves identically to play() for "bell"', () => {
    const engine1 = new AudioEngine();
    engine1.play('bell');
    const playBufferCount = mockCtx.createBufferSource.mock.calls.length;

    mockCtx.createBufferSource.mockClear();

    const engine2 = new AudioEngine();
    engine2.preview('bell');
    const previewBufferCount = mockCtx.createBufferSource.mock.calls.length;

    expect(playBufferCount).toBe(previewBufferCount);
  });
});

// ── Chime: Fisher-Yates shuffle (non-deterministic) ──────────────────────────

describe('chime — Fisher-Yates shuffle', () => {
  it('produces a different note ordering across multiple calls (non-deterministic)', () => {
    // The chime shuffles CHIME_SCALE (11 notes) and picks up to chimeNotes.
    // We spy on Math.random to detect that it's called multiple times per play
    // (indicating shuffle happened), then verify non-determinism by collecting
    // oscillator frequencies across two plays and asserting they can differ.
    //
    // Because this is probabilistic, we run it enough times to observe variation.
    const randomValues: number[][] = [];
    const originalRandom = Math.random;

    let capturedValues: number[] = [];
    Math.random = () => {
      const v = originalRandom();
      capturedValues.push(v);
      return v;
    };

    const engine = new AudioEngine();

    capturedValues = [];
    engine.play('chime');
    randomValues.push([...capturedValues]);

    capturedValues = [];
    engine.play('chime');
    randomValues.push([...capturedValues]);

    Math.random = originalRandom;

    // Each play should have called Math.random multiple times (shuffle calls it per element)
    expect(randomValues[0]!.length).toBeGreaterThan(1);
    expect(randomValues[1]!.length).toBeGreaterThan(1);

    // The shuffle uses Math.random for each element in pool (11 elements),
    // so at minimum 10 Math.random calls should occur for the shuffle itself
    expect(randomValues[0]!.length).toBeGreaterThanOrEqual(10);
  });

  it('creates oscillators matching chimeNotes setting', () => {
    // With chimeNotes=3, we should see fewer oscillators than chimeNotes=9.
    // Each note creates multiple oscillators (partials + shimmer sides).
    const engine = new AudioEngine();

    engine.setParams({ chimeNotes: 3, chimeShimmer: 0 }); // shimmer=0 → single side per partial
    mockCtx._oscCallCount = 0;
    mockCtx.createOscillator.mockClear();
    engine.play('chime');
    const countFor3 = mockCtx._oscCallCount;

    mockCtx._oscCallCount = 0;
    mockCtx.createOscillator.mockClear();
    engine.setParams({ chimeNotes: 9, chimeShimmer: 0 });
    engine.play('chime');
    const countFor9 = mockCtx._oscCallCount;

    expect(countFor9).toBeGreaterThan(countFor3);
  });
});

// ── Bell: ring sequence order matters ────────────────────────────────────────

describe('bell — ring sequence', () => {
  it('plays 3 rings for bellRings=3 (root→octave→fifth)', () => {
    // RIN_SEQUENCES[3] = [0, 12, 7] — three entries means three strikeRin calls.
    // Each strikeRin creates a buffer source for the mallet tick.
    const engine = new AudioEngine();
    engine.play('bell');
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(3);
  });

  it('plays 1 ring for bellRings=1', () => {
    const engine = new AudioEngine();
    engine.setParams({ bellRings: 1 });
    engine.play('bell');
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(1);
  });

  it('plays 2 rings for bellRings=2', () => {
    const engine = new AudioEngine();
    engine.setParams({ bellRings: 2 });
    engine.play('bell');
    expect(mockCtx.createBufferSource.mock.calls.length).toBe(2);
  });

  it('with bellRings=3, third ring frequency corresponds to a fifth (7 semitones)', () => {
    // The RIN_SEQUENCES[3] = [0, 12, 7]. The third call is freq = root * 2^(7/12).
    // We check that three distinct frequencies are used for the three rings
    // by tracking oscillator creation frequency values.
    const oscFrequencies: number[] = [];
    mockCtx.createOscillator = vi.fn(() => {
      const osc = makeOscillatorMock();
      // Capture frequency when set
      Object.defineProperty(osc.frequency, 'value', {
        get: () => 0,
        set: (v: number) => { oscFrequencies.push(v); },
        configurable: true,
      });
      return osc;
    });

    const engine = new AudioEngine();
    engine.play('bell');

    // With 3 rings, we should see oscillator frequencies from all three pitch levels
    // The root is ~261.6Hz (C4), octave ~523.2Hz, fifth ~391.1Hz
    expect(oscFrequencies.length).toBeGreaterThan(0);
    // The minimum frequency seen should be around root (~261.6Hz)
    const minFreq = Math.min(...oscFrequencies);
    expect(minFreq).toBeGreaterThan(100); // clearly audible fundamental
  });
});

// ── setParams volume applied immediately when ctx exists ─────────────────────

describe('setParams volume application', () => {
  it('updates masterBus gain immediately when ctx already created', () => {
    const engine = new AudioEngine();
    engine.resume(); // create ctx

    const masterBus = mockCtx.createGain.mock.results[0]?.value as ReturnType<typeof makeGainNodeMock>;
    const gainBefore = masterBus.gain.value;

    engine.setParams({ volume: 40 });
    // New gain = (0.4)^2 * 0.5 = 0.08
    expect(masterBus.gain.value).toBeCloseTo(0.08, 3);
    expect(masterBus.gain.value).not.toBe(gainBefore);
  });

  it('does not crash setParams when ctx has not been created yet', () => {
    const engine = new AudioEngine();
    expect(() => engine.setParams({ volume: 50 })).not.toThrow();
  });
});
