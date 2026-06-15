/* ============================================================
   Stillpoint — Tweaks panel (sound design)
   Vanilla, matches the app. Reads/writes window.STILLPOINT_TWEAKS,
   which app.js consults live on every strike.
   ============================================================ */
(function () {
  'use strict';

  const T = window.STILLPOINT_TWEAKS || (window.STILLPOINT_TWEAKS = {});
  const preview = (k) => window.STILLPOINT_PREVIEW && window.STILLPOINT_PREVIEW(k);

  // ---- persistence -------------------------------------------------
  function setKey(key, val) {
    T[key] = val;
    try {
      window.parent.postMessage(
        { type: '__edit_mode_set_keys', edits: { [key]: val } }, '*'
      );
    } catch (e) {}
  }

  // ---- styles ------------------------------------------------------
  const css = `
    #tweaks {
      position: fixed; top: 14px; right: 14px; z-index: 9999;
      width: 312px; max-width: calc(100vw - 28px);
      max-height: calc(100vh - 28px); overflow-y: auto;
      display: none; flex-direction: column;
      font-family: var(--sans);
      color: var(--ink);
      background: oklch(0.16 0.03 268 / 0.86);
      backdrop-filter: blur(22px) saturate(1.1);
      -webkit-backdrop-filter: blur(22px) saturate(1.1);
      border: 1px solid var(--card-edge);
      border-radius: 18px;
      box-shadow: 0 24px 60px -20px oklch(0.05 0.03 270 / 0.7),
                  inset 0 1px 0 oklch(0.95 0.02 250 / 0.06);
      animation: tw-in .28s cubic-bezier(.2,.8,.2,1);
    }
    #tweaks.open { display: flex; }
    @keyframes tw-in { from { opacity: 0; transform: translateY(-8px) scale(.98); } }
    #tweaks::-webkit-scrollbar { width: 8px; }
    #tweaks::-webkit-scrollbar-thumb { background: var(--line); border-radius: 8px; }

    .tw-head {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 10px; padding: 17px 18px 13px;
      position: sticky; top: 0; z-index: 2;
      background: linear-gradient(oklch(0.16 0.03 268 / 0.96), oklch(0.16 0.03 268 / 0.7));
      border-bottom: 1px solid var(--line);
    }
    .tw-title { font-family: var(--serif); font-weight: 300; font-size: 20px; letter-spacing: .2px; }
    .tw-sub { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); }
    .tw-x {
      appearance: none; border: none; cursor: pointer;
      width: 26px; height: 26px; border-radius: 50%;
      background: var(--field); color: var(--ink-soft);
      font-size: 15px; line-height: 1; display: grid; place-items: center;
      transition: background .15s, color .15s;
    }
    .tw-x:hover { background: var(--accent-soft); color: var(--ink); }

    .tw-body { padding: 6px 18px 18px; display: flex; flex-direction: column; gap: 4px; }

    .tw-group { padding: 14px 0 4px; border-bottom: 1px solid var(--line); }
    .tw-group:last-child { border-bottom: none; }
    .tw-group-head {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 12px;
    }
    .tw-group-name { font-family: var(--serif); font-size: 15.5px; font-weight: 400; letter-spacing: .2px; }
    .tw-try {
      appearance: none; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px 5px 10px; border-radius: 999px;
      font-family: var(--sans); font-size: 12px; letter-spacing: .02em;
      color: var(--ink); background: var(--accent-soft); white-space: nowrap;
      border: 1px solid oklch(0.80 0.10 265 / 0.32);
      transition: transform .12s, background .15s, box-shadow .15s;
    }
    .tw-try:hover { background: oklch(0.80 0.10 265 / 0.26); box-shadow: 0 0 18px -6px var(--accent); }
    .tw-try:active { transform: scale(.95); }
    .tw-try svg { width: 13px; height: 13px; }

    .tw-row { margin: 0 0 13px; }
    .tw-row-top { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 7px; }
    .tw-label { font-size: 12.5px; color: var(--ink-soft); letter-spacing: .01em; }
    .tw-val { font-size: 12px; color: var(--ink-faint); font-variant-numeric: tabular-nums; }

    .tw-slider {
      appearance: none; -webkit-appearance: none; width: 100%; height: 4px;
      background: var(--field); border-radius: 4px; outline: none; cursor: pointer;
    }
    .tw-slider::-webkit-slider-thumb {
      -webkit-appearance: none; width: 16px; height: 16px; border-radius: 50%;
      background: var(--ink); border: 3px solid oklch(0.78 0.10 265);
      box-shadow: 0 1px 6px oklch(0.05 0.03 270 / 0.5); transition: transform .12s;
    }
    .tw-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
    .tw-slider::-moz-range-thumb {
      width: 16px; height: 16px; border-radius: 50%; background: var(--ink);
      border: 3px solid oklch(0.78 0.10 265);
    }

    .tw-seg { display: flex; gap: 4px; background: var(--field); border-radius: 999px; padding: 3px; }
    .tw-seg button {
      flex: 1; appearance: none; border: none; cursor: pointer;
      padding: 7px 4px; border-radius: 999px; background: transparent;
      color: var(--ink-soft); font-family: var(--sans); font-size: 12px; letter-spacing: .01em;
      transition: background .15s, color .15s;
    }
    .tw-seg button:hover { color: var(--ink); }
    .tw-seg button[aria-pressed="true"] {
      background: oklch(0.78 0.10 265 / 0.30); color: var(--ink);
      box-shadow: inset 0 0 0 1px oklch(0.80 0.10 265 / 0.4);
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---- builders ----------------------------------------------------
  function slider(key, label, min, max, step, fmt) {
    const row = document.createElement('div');
    row.className = 'tw-row';
    const top = document.createElement('div');
    top.className = 'tw-row-top';
    const lab = document.createElement('span'); lab.className = 'tw-label'; lab.textContent = label;
    const val = document.createElement('span'); val.className = 'tw-val';
    const input = document.createElement('input');
    input.type = 'range'; input.className = 'tw-slider';
    input.min = min; input.max = max; input.step = step; input.value = T[key];
    const show = () => { val.textContent = fmt(Number(input.value)); };
    show();
    input.addEventListener('input', () => { setKey(key, Number(input.value)); show(); });
    top.append(lab, val); row.append(top, input);
    return row;
  }

  function segmented(key, label, opts) {
    const row = document.createElement('div');
    row.className = 'tw-row';
    const top = document.createElement('div');
    top.className = 'tw-row-top';
    const lab = document.createElement('span'); lab.className = 'tw-label'; lab.textContent = label;
    top.appendChild(lab);
    const seg = document.createElement('div'); seg.className = 'tw-seg';
    opts.forEach(([v, text]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text;
      b.setAttribute('aria-pressed', String(T[key] === v));
      b.addEventListener('click', () => {
        setKey(key, v);
        [...seg.children].forEach((c, i) => c.setAttribute('aria-pressed', String(opts[i][0] === v)));
      });
      seg.appendChild(b);
    });
    row.append(top, seg);
    return row;
  }

  const PLAY_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

  function group(name, kind, prefix) {
    const g = document.createElement('div');
    g.className = 'tw-group';
    const head = document.createElement('div');
    head.className = 'tw-group-head';
    const nm = document.createElement('span'); nm.className = 'tw-group-name'; nm.textContent = name;
    const tryBtn = document.createElement('button');
    tryBtn.type = 'button'; tryBtn.className = 'tw-try';
    tryBtn.innerHTML = PLAY_SVG + '<span>Hear it</span>';
    tryBtn.addEventListener('click', () => preview(kind));
    head.append(nm, tryBtn);
    g.appendChild(head);
    g.appendChild(slider(prefix + 'Pitch', 'Pitch', -7, 7, 1,
      (v) => (v > 0 ? '+' : '') + v + ' st'));
    g.appendChild(slider(prefix + 'Warmth', 'Warmth', 0, 100, 1, (v) => v + '%'));
    g.appendChild(slider(prefix + 'Sustain', 'Sustain', 0, 100, 1, (v) => v + '%'));
    if (kind === 'chime') {
      // a wind chime is a sequence of tubes, not a single struck tone
      g.appendChild(slider('chimeShimmer', 'Shimmer', 0, 100, 1, (v) => v + '%'));
      g.appendChild(slider('chimeNotes', 'Notes', 1, 9, 1, (v) => String(v)));
      g.appendChild(slider('chimeSpread', 'Spread', 0, 100, 1, (v) => v + '%'));
    } else {
      // a rin's slow beating is its signature — "warble", plus how many rings
      g.appendChild(slider('bellShimmer', 'Warble', 0, 100, 1, (v) => v + '%'));
      g.appendChild(segmented('bellRings', 'Rings',
        [[1, 'One'], [2, 'Two'], [3, 'Three']]));
    }
    return g;
  }

  // ---- assemble ----------------------------------------------------
  const panel = document.createElement('aside');
  panel.id = 'tweaks';
  panel.setAttribute('aria-label', 'Tweaks');

  const head = document.createElement('div');
  head.className = 'tw-head';
  const titles = document.createElement('div');
  titles.innerHTML = '<div class="tw-title">Tweaks</div><div class="tw-sub">Sound</div>';
  const x = document.createElement('button');
  x.className = 'tw-x'; x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '\u2715';
  x.addEventListener('click', () => {
    panel.classList.remove('open');
    try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (e) {}
  });
  head.append(titles, x);

  const body = document.createElement('div');
  body.className = 'tw-body';

  const master = document.createElement('div');
  master.className = 'tw-group';
  master.appendChild(slider('volume', 'Overall volume', 0, 100, 1, (v) => v + '%'));
  body.appendChild(master);

  body.appendChild(group('Chime', 'chime', 'chime'));
  body.appendChild(group('Standing bells', 'bell', 'bell'));

  panel.append(head, body);
  document.body.appendChild(panel);

  // ---- host protocol ----------------------------------------------
  window.addEventListener('message', (e) => {
    const t = e.data && e.data.type;
    if (t === '__activate_edit_mode') panel.classList.add('open');
    else if (t === '__deactivate_edit_mode') panel.classList.remove('open');
  });
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
})();
