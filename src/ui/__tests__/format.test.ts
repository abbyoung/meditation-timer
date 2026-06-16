/**
 * Module: src/ui/format.ts
 * Tests: fmtClock, fmtTotal, escapeHtml display formatters.
 * No DOM or Web API dependencies — plain Node environment.
 */

import { describe, it, expect } from 'vitest';
import { fmtClock, fmtTotal, escapeHtml } from '../format.js';

// ── fmtClock ──────────────────────────────────────────────────────────────────

describe('fmtClock', () => {
  it('formats zero as 0:00', () => {
    expect(fmtClock(0)).toBe('0:00');
  });

  it('zero-pads seconds to two digits', () => {
    expect(fmtClock(5)).toBe('0:05');
    expect(fmtClock(9)).toBe('0:09');
  });

  it('formats exactly one minute', () => {
    expect(fmtClock(60)).toBe('1:00');
  });

  it('formats minutes and seconds', () => {
    expect(fmtClock(185)).toBe('3:05');   // 3 min 5 sec
    expect(fmtClock(1500)).toBe('25:00'); // 25 min exactly
  });

  it('rounds fractional seconds', () => {
    expect(fmtClock(59.4)).toBe('0:59');
    expect(fmtClock(59.6)).toBe('1:00');
  });

  it('clamps negative values to 0:00', () => {
    expect(fmtClock(-1)).toBe('0:00');
    expect(fmtClock(-100)).toBe('0:00');
  });

  it('handles large values (hours expressed as minutes)', () => {
    expect(fmtClock(3600)).toBe('60:00');
  });
});

// ── fmtTotal ──────────────────────────────────────────────────────────────────

describe('fmtTotal', () => {
  describe('seconds only (< 1 minute)', () => {
    it('returns numeric val and plural unit for 0 secs', () => {
      const result = fmtTotal(0);
      expect(result.val).toBe(0);
      expect(result.unit).toBe('secs');
    });

    it('returns singular "sec" for exactly 1 second', () => {
      const result = fmtTotal(1);
      expect(result.val).toBe(1);
      expect(result.unit).toBe('sec');
    });

    it('returns plural "secs" for 2–59 seconds', () => {
      expect(fmtTotal(30).unit).toBe('secs');
      expect(fmtTotal(59).unit).toBe('secs');
    });
  });

  describe('whole minutes (no remainder seconds)', () => {
    it('returns numeric val and "min" unit for exact minutes', () => {
      const result = fmtTotal(60);
      expect(result.val).toBe(1);
      expect(result.unit).toBe('min');

      const result25 = fmtTotal(1500);
      expect(result25.val).toBe(25);
      expect(result25.unit).toBe('min');
    });
  });

  describe('minutes and seconds', () => {
    it('returns "m:ss" string val and "min" unit when both minutes and seconds present', () => {
      const result = fmtTotal(185); // 3 min 5 sec
      expect(result.val).toBe('3:05');
      expect(result.unit).toBe('min');
    });

    it('zero-pads seconds in mixed format', () => {
      const result = fmtTotal(601); // 10 min 1 sec
      expect(result.val).toBe('10:01');
      expect(result.unit).toBe('min');
    });
  });
});

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('passes through plain text unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    // Both < and > are in the replacement map, so the closing > is also escaped.
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('3 > 2')).toBe('3 &gt; 2');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes multiple special chars in one string', () => {
    expect(escapeHtml('<a href="x">foo & bar</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;foo &amp; bar&lt;/a&gt;',
    );
  });

  it('coerces non-strings via String()', () => {
    // escapeHtml calls String(s) internally
    expect(escapeHtml(42 as unknown as string)).toBe('42');
    expect(escapeHtml(null as unknown as string)).toBe('null');
  });

  it('does NOT escape single quotes (not in the replacement map)', () => {
    // Build-Spec does not require single-quote escaping — verify the current behavior
    // so any future change is intentional.
    expect(escapeHtml("it's")).toBe("it's");
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
