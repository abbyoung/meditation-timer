/**
 * Builder — session-building screen (Build-Spec §3, §9, §10).
 *
 * Owns all Builder DOM interaction: session name, segments view/edit,
 * total time, bookmark toggle, two-tap clear, Begin button, bookmarked list,
 * a11y tab-walk, and toast notifications.
 *
 * Does NOT touch Runner elements — those are owned by Runner (Phase 5).
 * Calls onBegin(session) when Begin is tapped; Runner wires up from there.
 */

import type { Session, Segment, SoundKind } from '../types.js';
import { SOUND_KINDS, SOUND_LABEL, segSeconds, totalSeconds } from '../types.js';
import type { AudioEngine } from '../audio/AudioEngine.js';
import {
  loadLast, saveLast,
  loadSaved, upsertSaved, deleteSaved,
} from '../persistence/Store.js';
import { fmtClock, fmtTotal, escapeHtml } from './format.js';

// ── SVG icons (inline) ────────────────────────────────────────────────────────

const BELL_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`;
const NO_SVG   = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>`;
const COPY_SVG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

// ── DOM helpers ───────────────────────────────────────────────────────────────

function qs<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Builder: element not found: ${sel}`);
  return el;
}

// ── Builder class ─────────────────────────────────────────────────────────────

export class Builder {
  private session: Session;
  private mode: 'view' | 'edit' = 'view';
  private engine: AudioEngine;
  private onBegin: (session: Session) => void;

  // DOM refs (populated in mount())
  private el!: {
    nameInput:  HTMLInputElement;
    total:      HTMLElement;
    card:       HTMLElement;
    modeToggle: HTMLButtonElement;
    segments:   HTMLElement;
    addSeg:     HTMLButtonElement;
    clearBtn:   HTMLButtonElement;
    clearLabel: HTMLElement;
    saveBtn:    HTMLButtonElement;
    saveLabel:  HTMLElement;
    beginBtn:   HTMLButtonElement;
    savedList:  HTMLElement;
    toast:      HTMLElement;
    swState:    HTMLElement;
  };

  // Clear two-tap state
  private clearArmed  = false;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  // Toast timer
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(engine: AudioEngine, onBegin: (session: Session) => void) {
    this.engine  = engine;
    this.onBegin = onBegin;
    this.session = loadLast();
  }

  // ── Mount ────────────────────────────────────────────────────────────────────

  mount(): void {
    this.el = {
      nameInput:  qs<HTMLInputElement>('#sessionName'),
      total:      qs('#totalTime'),
      card:       qs('#card'),
      modeToggle: qs<HTMLButtonElement>('#modeToggle'),
      segments:   qs('#segments'),
      addSeg:     qs<HTMLButtonElement>('#addSegment'),
      clearBtn:   qs<HTMLButtonElement>('#clearBtn'),
      clearLabel: qs('#clearBtn .clear-label'),
      saveBtn:    qs<HTMLButtonElement>('#saveBtn'),
      saveLabel:  qs('#saveBtn .save-label'),
      beginBtn:   qs<HTMLButtonElement>('#beginBtn'),
      savedList:  qs('#savedList'),
      toast:      qs('#toast'),
      swState:    qs('#swState'),
    };

    this._bindEvents();
    this._render();
    this._renderSaved();
  }

  /** Show the builder after returning from the runner. */
  show(): void {
    // Reload in case runner mutated nothing; just re-render.
    this._render();
    this._renderSaved();
  }

  /** Update the footnote (called by main.ts after SW registration). */
  setSWStatus(html: string): void {
    if (this.el?.swState) this.el.swState.innerHTML = html;
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  private _bindEvents(): void {
    const { el } = this;

    // Session name — persist on every keystroke, refresh bookmark indicator.
    el.nameInput.addEventListener('input', () => {
      this.session.name = el.nameInput.value;
      saveLast(this.session);
      this._updateSaveState();
    });

    // Edit / Done toggle.
    el.modeToggle.addEventListener('click', () => {
      this.mode = this.mode === 'edit' ? 'view' : 'edit';
      this._render();
    });

    // Add segment.
    el.addSeg.addEventListener('click', () => {
      const last = this.session.segments.at(-1);
      const endDefault: SoundKind =
        last && last.end !== 'none' ? last.end : 'chime';
      this.session.segments.push({ min: 5, sec: 0, start: 'none', end: endDefault });
      saveLast(this.session);
      this._render();
    });

    // Clear — two-tap confirm (Build-Spec §9 A11Y-5, §3, §13).
    el.clearBtn.addEventListener('click', () => {
      if (!this.clearArmed) {
        this.clearArmed = true;
        el.clearBtn.classList.add('confirm');
        el.clearLabel.textContent = 'Clear all?';
        this.clearTimer = setTimeout(() => this._disarmClear(), 3500);
        return;
      }
      this._disarmClear();
      // Render BEFORE persist so the old name isn't recaptured by saveLast.
      this.session = { name: '', segments: [{ min: 5, sec: 0, start: 'none', end: 'bell' }] };
      this.mode = 'edit';
      this._render();
      saveLast(this.session);
      this._updateSaveState();
      el.nameInput.focus();
      this._toast('Timer cleared');
    });

    // Any click outside clearBtn cancels a pending confirm.
    document.addEventListener('click', (ev) => {
      if (this.clearArmed && !el.clearBtn.contains(ev.target as Node)) {
        this._disarmClear();
      }
    });

    // Bookmark toggle — upsert into saved list.
    el.saveBtn.addEventListener('click', () => {
      this.session.name = el.nameInput.value;
      saveLast(this.session);
      upsertSaved(this.session);
      this._renderSaved();
      this._updateSaveState();
      const name = this.session.name.trim() || 'Untitled';
      this._toast(`Saved “${name}”`);
    });

    // Begin session.
    el.beginBtn.addEventListener('click', () => {
      this.session.name = el.nameInput.value;
      saveLast(this.session);
      if (totalSeconds(this.session) <= 0) return;
      this.engine.resume(); // ensure AudioContext is created inside user gesture
      this.onBegin(this.session);
    });

    // A11Y-1: Tab reaches every control regardless of macOS "Tab between text fields only".
    // We walk the DOM tab order ourselves and release at the boundaries so browser
    // chrome stays reachable. (Build-Spec §9, Design-Doc §10.1)
    document.addEventListener('keydown', (ev: KeyboardEvent) => {
      if (ev.key !== 'Tab' || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      const stops = this._tabStops();
      if (!stops.length) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      if (i === -1) return; // focus is outside our set — let browser handle
      const atBoundary = ev.shiftKey ? i === 0 : i === stops.length - 1;
      if (atBoundary) return; // release to browser chrome
      ev.preventDefault();
      stops[i + (ev.shiftKey ? -1 : 1)]!.focus();
    });
  }

  // ── Render — full ────────────────────────────────────────────────────────────

  private _render(): void {
    const { el, session, mode } = this;

    el.nameInput.value = session.name ?? '';
    el.card.classList.toggle('editing', mode === 'edit');
    el.modeToggle.textContent = mode === 'edit' ? 'Done' : 'Edit';

    // Total time (read-only display — never an input).
    this._refreshTotals();

    // Segments list.
    el.segments.innerHTML = '';
    session.segments.forEach((seg, i) => {
      el.segments.appendChild(
        mode === 'edit'
          ? this._renderSegmentEdit(seg, i)
          : this._renderSegmentView(seg, i),
      );
    });

    this._updateSaveState();
  }

  // ── Render — incremental ─────────────────────────────────────────────────────

  /** Update total display and Begin disabled state without re-rendering segments.
   *  Called from numField onChange so focus isn't disturbed (A11Y-3). */
  private _refreshTotals(): void {
    const tot = totalSeconds(this.session);
    const f   = fmtTotal(tot);
    this.el.total.innerHTML = `${f.val}<span class="unit">${f.unit}</span>`;
    this.el.beginBtn.disabled       = tot <= 0;
    this.el.beginBtn.style.opacity  = tot <= 0 ? '0.4' : '1';
  }

  // ── Segment — view mode ──────────────────────────────────────────────────────

  private _renderSegmentView(seg: Segment, idx: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'segment view';

    const top = document.createElement('div');
    top.className = 'seg-top';

    const badge = document.createElement('div');
    badge.className = 'seg-index';
    badge.textContent = String(idx + 1);

    const time = document.createElement('div');
    time.className = 'seg-time-text';
    time.textContent = fmtClock(segSeconds(seg));

    const cues = document.createElement('div');
    cues.className = 'seg-cues';
    cues.appendChild(this._cueView('Start', seg.start));
    cues.appendChild(this._cueView('End',   seg.end));

    top.append(badge, time, cues);
    wrap.appendChild(top);
    return wrap;
  }

  private _cueView(label: string, kind: SoundKind): HTMLElement {
    const c   = document.createElement('div');
    c.className = 'cue';
    const l   = document.createElement('span');
    l.className = 'cue-lab';
    l.textContent = label;
    const ico = document.createElement('span');
    ico.className = `cue-icon ${kind === 'none' ? 'off' : 'on'}`;
    ico.innerHTML = kind === 'none' ? NO_SVG : BELL_SVG;
    ico.title = kind === 'none' ? 'No sound' : `${SOUND_LABEL[kind]} sound`;
    c.append(l, ico);
    return c;
  }

  // ── Segment — edit mode ──────────────────────────────────────────────────────

  private _renderSegmentEdit(seg: Segment, idx: number): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'segment';

    // Top row: index badge + time inputs.
    const top = document.createElement('div');
    top.className = 'seg-top';

    const badge = document.createElement('div');
    badge.className = 'seg-index';
    badge.textContent = String(idx + 1);
    top.appendChild(badge);

    const timeWrap = document.createElement('div');
    timeWrap.className = 'time-input';

    timeWrap.appendChild(
      this._numField('min', seg.min, 'Min', (v) => {
        seg.min = v;
        this._refreshTotals();
        saveLast(this.session);
      }),
    );
    const colon = document.createElement('span');
    colon.className = 'colon';
    colon.textContent = ':';
    timeWrap.appendChild(colon);
    timeWrap.appendChild(
      this._numField('sec', seg.sec, 'Sec', (v) => {
        seg.sec = Math.min(59, v);
        this._refreshTotals();
        saveLast(this.session);
      }, 59, true /* pad */),
    );
    top.appendChild(timeWrap);
    wrap.appendChild(top);

    // Sound row.
    const sounds = document.createElement('div');
    sounds.className = 'sound-row';
    sounds.appendChild(
      this._soundPicker('Start', seg.start, (v) => { seg.start = v; saveLast(this.session); }),
    );
    sounds.appendChild(
      this._soundPicker('End', seg.end, (v) => { seg.end = v; saveLast(this.session); }),
    );
    wrap.appendChild(sounds);

    // Corner actions: duplicate (always) + remove (only when >1 segment).
    const actions = document.createElement('div');
    actions.className = 'seg-actions';

    const dup = document.createElement('button');
    dup.className = 'seg-action seg-dup';
    dup.type = 'button';
    dup.setAttribute('aria-label', 'Duplicate segment');
    dup.innerHTML = COPY_SVG;
    dup.addEventListener('click', () => {
      // Segment is all primitives, so a flat spread is a safe full copy.
      this.session.segments.splice(idx + 1, 0, { ...seg });
      saveLast(this.session);
      this._render();
    });
    actions.appendChild(dup);

    if (this.session.segments.length > 1) {
      const rm = document.createElement('button');
      rm.className = 'seg-action seg-remove';
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove segment');
      rm.textContent = '×';
      rm.addEventListener('click', () => {
        this.session.segments.splice(idx, 1);
        saveLast(this.session);
        this._render();
      });
      actions.appendChild(rm);
    }

    wrap.appendChild(actions);

    return wrap;
  }

  /**
   * A single time field (Min or Sec).
   *
   * A11Y-3: reformats value in place on blur — NOT via a full _render().
   *   A full re-render destroys this DOM node mid-Tab and drops focus before
   *   it reaches the next input.
   * A11Y-4: Sec is type=text + inputmode=numeric + maxlength=2 so it can
   *   zero-pad to "00". <input type=number> strips leading zeros.
   */
  private _numField(
    _kind: string,
    value: number,
    label: string,
    onChange: (v: number) => void,
    max?: number,
    pad = false,
  ): HTMLElement {
    const f = document.createElement('div');
    f.className = 'field';

    const input = document.createElement('input');
    if (pad) {
      input.type = 'text';
      input.inputMode = 'numeric';
      input.setAttribute('maxlength', '2');
      input.value = String(value).padStart(2, '0');
    } else {
      input.type = 'number';
      input.min  = '0';
      if (max != null) input.max = String(max);
      input.value = String(value);
    }
    input.setAttribute('aria-label', label);

    input.addEventListener('input', () => {
      const raw = pad ? input.value.replace(/[^0-9]/g, '') : input.value;
      let v = parseInt(raw, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (max != null && v > max) v = max;
      onChange(v);
    });

    // Reformat in place on blur — keeps zero-padding and clamps value.
    input.addEventListener('blur', () => {
      let v = parseInt(input.value.replace(/[^0-9]/g, ''), 10);
      if (isNaN(v) || v < 0) v = 0;
      if (max != null && v > max) v = max;
      input.value = pad ? String(v).padStart(2, '0') : String(v);
    });

    const lab = document.createElement('div');
    lab.className = 'lab';
    lab.textContent = label;

    f.append(input, lab);
    return f;
  }

  private _soundPicker(
    label: string,
    current: SoundKind,
    onChange: (v: SoundKind) => void,
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'sound-pick';

    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);

    const group = document.createElement('div');
    group.className = 'chip-group';

    SOUND_KINDS.forEach((s) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.textContent = SOUND_LABEL[s];
      chip.setAttribute('aria-pressed', String(s === current));

      chip.addEventListener('click', () => {
        onChange(s);
        [...group.children].forEach((c, i) =>
          c.setAttribute('aria-pressed', String(SOUND_KINDS[i] === s)),
        );
        if (s !== 'none') this.engine.preview(s);
      });

      group.appendChild(chip);
    });

    wrap.appendChild(group);
    return wrap;
  }

  // ── Bookmarked sessions list ──────────────────────────────────────────────────

  private _renderSaved(): void {
    const { el } = this;
    const list = loadSaved();
    el.savedList.innerHTML = '';

    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'saved-empty';
      empty.textContent = 'Nothing bookmarked yet — build a session and tap Bookmark.';
      el.savedList.appendChild(empty);
      return;
    }

    list.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'saved-item';
      item.setAttribute('role', 'button');
      item.tabIndex = 0;

      const f = fmtTotal(totalSeconds(s));
      item.innerHTML =
        `<span>${escapeHtml(s.name)}</span>` +
        `<span class="dur">${f.val} ${f.unit}</span>`;

      const del = document.createElement('button');
      del.className = 'del';
      del.type = 'button';
      del.textContent = '×';
      del.setAttribute('aria-label', 'Delete saved session');
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        deleteSaved(i);
        this._renderSaved();
      });

      const loadIt = () => {
        this.session = JSON.parse(JSON.stringify(s)) as Session;
        this.mode = 'view';
        saveLast(this.session);
        this._render();
        this._renderSaved();
        this._toast(`Loaded “${s.name}”`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };

      item.addEventListener('click', loadIt);
      item.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') loadIt(); });
      item.appendChild(del);
      el.savedList.appendChild(item);
    });
  }

  // ── Bookmark state indicator ──────────────────────────────────────────────────

  private _updateSaveState(): void {
    const name   = (this.el.nameInput.value ?? '').trim().toLowerCase();
    const saved  = !!name && loadSaved().some((s) => (s.name ?? '').toLowerCase() === name);
    this.el.saveBtn.classList.toggle('is-bookmarked', saved);
    this.el.saveLabel.textContent = saved ? 'Bookmarked' : 'Bookmark';
  }

  // ── Clear helpers ─────────────────────────────────────────────────────────────

  private _disarmClear(): void {
    this.clearArmed = false;
    if (this.clearTimer != null) clearTimeout(this.clearTimer);
    this.el.clearBtn.classList.remove('confirm');
    this.el.clearLabel.textContent = 'Clear';
  }

  // ── Toast ─────────────────────────────────────────────────────────────────────

  private _toast(msg: string): void {
    const { toast } = this.el;
    toast.textContent = msg;
    toast.classList.add('show');
    if (this.toastTimer != null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ── A11Y tab-walk ─────────────────────────────────────────────────────────────

  /**
   * Collect all visible, enabled focusable elements in DOM order.
   * Used by the Tab keydown handler to guarantee every control is reachable
   * on macOS/Safari where "Tab moves only between text fields" is the default.
   */
  private _tabStops(): HTMLElement[] {
    const sel =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), ' +
      '[tabindex]:not([tabindex="-1"])';
    return [...document.querySelectorAll<HTMLElement>(sel)].filter((node) => {
      if (node.tabIndex < 0) return false;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      // offsetParent is null for display:none ancestors (hidden screens)
      return node.offsetParent !== null || cs.position === 'fixed';
    });
  }

  // ── Expose session for Runner ─────────────────────────────────────────────────

  /** Returns the current session (Runner reads this on complete/return). */
  getSession(): Session {
    return this.session;
  }

  /** Called by Runner when it returns home, so the Builder can reload from storage. */
  onReturnHome(): void {
    this.session = loadLast();
    this._render();
    this._renderSaved();
  }
}
