/**
 * Settings — in-app sound-settings panel (Build-Spec §2, §5, §11).
 *
 * Replaces the EDITMODE/host-rewrite mechanism from the reference build.
 * Reads from loadSoundParams() on mount; writes saveSoundParams() +
 * engine.setParams() on every control change. Preview buttons call
 * engine.preview() so the user can audition changes live.
 *
 * The panel is appended to <body> programmatically and toggled with the
 * .open class. All 11 tunable params from Build-Spec §5 are exposed.
 */

import type { AudioEngine, SoundParams } from '../audio/AudioEngine.js';
import { loadSoundParams, saveSoundParams } from '../persistence/Store.js';

const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M8 5v14l11-7z"/></svg>`;

// ── Settings class ────────────────────────────────────────────────────────────

export class Settings {
  private engine: AudioEngine;
  private params: SoundParams;
  private panel!: HTMLElement;

  constructor(engine: AudioEngine) {
    this.engine = engine;
    this.params = loadSoundParams();
  }

  // ── Mount ─────────────────────────────────────────────────────────────────────

  mount(): void {
    this.panel = this._buildPanel();
    document.body.appendChild(this.panel);

    // Trigger button wired by main.ts via open().
  }

  open(): void  { this.panel.classList.add('open');    }
  close(): void { this.panel.classList.remove('open'); }
  toggle(): void {
    if (this.panel.classList.contains('open')) this.close();
    else this.open();
  }

  // ── Panel construction ────────────────────────────────────────────────────────

  private _buildPanel(): HTMLElement {
    const panel = document.createElement('aside');
    panel.className = 'sp-panel';
    panel.setAttribute('aria-label', 'Sound settings');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');

    // Header
    const head = document.createElement('div');
    head.className = 'sp-head';

    const titles = document.createElement('div');
    const title  = document.createElement('div');
    title.className   = 'sp-title';
    title.textContent = 'Sound';
    const sub = document.createElement('div');
    sub.className   = 'sp-sub';
    sub.textContent = 'Settings';
    titles.append(title, sub);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sp-close';
    closeBtn.setAttribute('aria-label', 'Close sound settings');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this.close());

    head.append(titles, closeBtn);
    panel.appendChild(head);

    // Body
    const body = document.createElement('div');
    body.className = 'sp-body';

    // Volume (master) — no preview button, no group name
    const volGroup = document.createElement('div');
    volGroup.className = 'sp-group';
    volGroup.appendChild(
      this._slider('volume', 'Overall volume', 0, 100, 1, (v) => `${v}%`),
    );
    body.appendChild(volGroup);

    // Chime group
    body.appendChild(this._group('Chime', 'chime', 'chime'));

    // Bell group
    body.appendChild(this._group('Standing bells', 'bell', 'bell'));

    panel.appendChild(body);

    // Close on Escape
    panel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') this.close();
    });

    return panel;
  }

  private _group(
    name: string,
    kind: 'chime' | 'bell',
    prefix: 'chime' | 'bell',
  ): HTMLElement {
    const g = document.createElement('div');
    g.className = 'sp-group';

    const head = document.createElement('div');
    head.className = 'sp-group-head';

    const nm = document.createElement('span');
    nm.className   = 'sp-group-name';
    nm.textContent = name;

    const tryBtn = document.createElement('button');
    tryBtn.type      = 'button';
    tryBtn.className = 'sp-try';
    tryBtn.innerHTML = `${PLAY_SVG}<span>Hear it</span>`;
    tryBtn.addEventListener('click', () => this.engine.preview(kind));

    head.append(nm, tryBtn);
    g.appendChild(head);

    g.appendChild(this._slider(`${prefix}Pitch`, 'Pitch', -7, 7, 1,
      (v) => `${v > 0 ? '+' : ''}${v} st`));
    g.appendChild(this._slider(`${prefix}Warmth`,  'Warmth',  0, 100, 1, (v) => `${v}%`));
    g.appendChild(this._slider(`${prefix}Sustain`, 'Sustain', 0, 100, 1, (v) => `${v}%`));

    if (kind === 'chime') {
      g.appendChild(this._slider('chimeShimmer', 'Shimmer', 0, 100, 1, (v) => `${v}%`));
      g.appendChild(this._slider('chimeNotes',   'Notes',   1, 9,   1, (v) => String(v)));
      g.appendChild(this._slider('chimeSpread',  'Spread',  0, 100, 1, (v) => `${v}%`));
    } else {
      g.appendChild(this._slider('bellShimmer', 'Warble', 0, 100, 1, (v) => `${v}%`));
      g.appendChild(
        this._segmented('bellRings', 'Rings', [
          [1, 'One'],
          [2, 'Two'],
          [3, 'Three'],
        ]),
      );
    }

    return g;
  }

  // ── Control builders ──────────────────────────────────────────────────────────

  private _slider(
    key: keyof SoundParams,
    label: string,
    min: number,
    max: number,
    step: number,
    fmt: (v: number) => string,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sp-row';

    const top = document.createElement('div');
    top.className = 'sp-row-top';

    const lab = document.createElement('span');
    lab.className   = 'sp-label';
    lab.textContent = label;

    const val = document.createElement('span');
    val.className = 'sp-val';

    const input = document.createElement('input');
    input.type      = 'range';
    input.className = 'sp-slider';
    input.min       = String(min);
    input.max       = String(max);
    input.step      = String(step);
    input.value     = String(this.params[key]);
    input.setAttribute('aria-label', label);

    const show = () => { val.textContent = fmt(Number(input.value)); };
    show();

    input.addEventListener('input', () => {
      const num = Number(input.value);
      (this.params as unknown as Record<string, unknown>)[key] = num;
      this.engine.setParams(this.params);
      saveSoundParams(this.params);
      show();
    });

    top.append(lab, val);
    row.append(top, input);
    return row;
  }

  private _segmented(
    key: keyof SoundParams,
    label: string,
    opts: [number, string][],
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'sp-row';

    const top = document.createElement('div');
    top.className = 'sp-row-top';
    const lab = document.createElement('span');
    lab.className   = 'sp-label';
    lab.textContent = label;
    top.appendChild(lab);

    const seg = document.createElement('div');
    seg.className = 'sp-seg';

    opts.forEach(([v, text]) => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.textContent = text;
      btn.setAttribute('aria-pressed', String(this.params[key] === v));
      btn.addEventListener('click', () => {
        (this.params as unknown as Record<string, unknown>)[key] = v;
        this.engine.setParams(this.params);
        saveSoundParams(this.params);
        [...seg.children].forEach((c, i) =>
          c.setAttribute('aria-pressed', String(opts[i]![0] === v)),
        );
      });
      seg.appendChild(btn);
    });

    row.append(top, seg);
    return row;
  }
}
