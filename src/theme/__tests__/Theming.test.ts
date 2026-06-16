/**
 * Module: src/theme/Theming.ts
 * Tests: applyTimeOfDay palette selection by hour, greeting split, clock output.
 *
 * Limitations: applyTimeOfDay reads document.getElementById and document.body,
 * so this test file uses the jsdom environment (configured via @vitest-environment
 * docblock). Date is mocked to control the hour deterministically.
 *
 * The timeSlot function is not exported directly — we test it via applyTimeOfDay's
 * observable effects (body class and greeting element content).
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTimeOfDay } from '../Theming.js';

// ── DOM setup ─────────────────────────────────────────────────────────────────

function setupDOM(): void {
  document.body.innerHTML = `
    <span id="greeting"></span>
    <span id="clock"></span>
  `;
  // Reset body classes
  document.body.className = '';
}

beforeEach(() => {
  setupDOM();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Helper to mock Date to a specific hour ────────────────────────────────────

function mockHour(hour: number): void {
  const fakeDate = new Date(2026, 5, 15, hour, 0, 0); // June 15 2026 at given hour
  vi.setSystemTime(fakeDate);
}

// ── Palette selection by hour ─────────────────────────────────────────────────

describe('applyTimeOfDay — palette class assignment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('applies palette-morning at hour 5 (boundary)', () => {
    mockHour(5);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-morning')).toBe(true);
  });

  it('applies palette-morning at hour 11', () => {
    mockHour(11);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-morning')).toBe(true);
  });

  it('applies palette-afternoon at hour 12 (boundary)', () => {
    mockHour(12);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-afternoon')).toBe(true);
  });

  it('applies palette-afternoon at hour 16', () => {
    mockHour(16);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-afternoon')).toBe(true);
  });

  it('applies palette-evening at hour 17 (boundary)', () => {
    mockHour(17);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-evening')).toBe(true);
  });

  it('applies palette-evening at hour 20', () => {
    mockHour(20);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-evening')).toBe(true);
  });

  it('applies palette-night at hour 21 (boundary)', () => {
    mockHour(21);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-night')).toBe(true);
  });

  it('applies palette-night at hour 0 (midnight)', () => {
    mockHour(0);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-night')).toBe(true);
  });

  it('applies palette-night at hour 4 (pre-morning)', () => {
    mockHour(4);
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-night')).toBe(true);
  });

  it('only one palette class is active at a time', () => {
    const palettes = ['morning', 'afternoon', 'evening', 'night'];

    mockHour(10);
    applyTimeOfDay();

    const activePalettes = palettes.filter((p) =>
      document.body.classList.contains(`palette-${p}`),
    );
    expect(activePalettes.length).toBe(1);
  });

  it('switches palette when hour changes', () => {
    mockHour(11); // morning
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-morning')).toBe(true);

    mockHour(12); // afternoon
    applyTimeOfDay();
    expect(document.body.classList.contains('palette-afternoon')).toBe(true);
    expect(document.body.classList.contains('palette-morning')).toBe(false);
  });
});

// ── Greeting split — last word becomes <em> ───────────────────────────────────

describe('applyTimeOfDay — greeting split', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('wraps last word of "Good morning" in <em>', () => {
    mockHour(8);
    applyTimeOfDay();
    const el = document.getElementById('greeting')!;
    expect(el.innerHTML).toBe('Good <em>morning</em>');
  });

  it('wraps last word of "Good afternoon" in <em>', () => {
    mockHour(14);
    applyTimeOfDay();
    const el = document.getElementById('greeting')!;
    expect(el.innerHTML).toBe('Good <em>afternoon</em>');
  });

  it('wraps last word of "Good evening" in <em> (evening slot)', () => {
    mockHour(18);
    applyTimeOfDay();
    const el = document.getElementById('greeting')!;
    expect(el.innerHTML).toBe('Good <em>evening</em>');
  });

  it('wraps last word of "Good evening" in <em> (night slot)', () => {
    // Note: the night slot also returns greeting "Good evening" — per the source code.
    // This is the current production behavior. If design changes to "Good night",
    // this test documents the intended change.
    mockHour(23);
    applyTimeOfDay();
    const el = document.getElementById('greeting')!;
    expect(el.innerHTML).toBe('Good <em>evening</em>');
  });

  it('does not throw when greeting element is absent', () => {
    document.getElementById('greeting')!.remove();
    mockHour(8);
    expect(() => applyTimeOfDay()).not.toThrow();
  });
});

// ── Live clock output ─────────────────────────────────────────────────────────

describe('applyTimeOfDay — clock output', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sets clock element text content to non-empty string', () => {
    mockHour(9);
    applyTimeOfDay();
    const el = document.getElementById('clock')!;
    expect(el.textContent).not.toBe('');
    expect(el.textContent!.length).toBeGreaterThan(0);
  });

  it('clock contains the separator "  ·  "', () => {
    mockHour(9);
    applyTimeOfDay();
    const text = document.getElementById('clock')!.textContent!;
    expect(text).toContain('·');
  });

  it('does not throw when clock element is absent', () => {
    document.getElementById('clock')!.remove();
    mockHour(8);
    expect(() => applyTimeOfDay()).not.toThrow();
  });
});

// ── Boundary hours — complete coverage of all 4 palette transitions ───────────

describe('palette boundary coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const cases: Array<[number, string]> = [
    [0, 'night'],
    [4, 'night'],
    [5, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [16, 'afternoon'],
    [17, 'evening'],
    [20, 'evening'],
    [21, 'night'],
    [23, 'night'],
  ];

  for (const [hour, expectedPalette] of cases) {
    it(`hour ${hour} → palette-${expectedPalette}`, () => {
      mockHour(hour);
      applyTimeOfDay();
      expect(document.body.classList.contains(`palette-${expectedPalette}`)).toBe(true);
    });
  }
});
