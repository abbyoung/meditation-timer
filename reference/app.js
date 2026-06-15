/* ============================================================
   Stillpoint — app logic (vanilla)
   ============================================================ */
(function () {
  'use strict';

  // ---- constants -------------------------------------------------
  const LAST_KEY = 'stillpoint.last';
  const SAVED_KEY = 'stillpoint.saved';
  const SOUNDS = ['none', 'chime', 'bell'];
  const SOUND_LABEL = { none: 'None', chime: 'Chime', bell: 'Bells' };

  const PRESET = {
    name: 'Daily Practice',
    segments: [
      { min: 2, sec: 0, start: 'chime', end: 'none' },
      { min: 23, sec: 0, start: 'none', end: 'bell' }
    ]
  };

  // ---- state -----------------------------------------------------
  let session = loadLast() || clone(PRESET);
  let mode = 'view'; // 'view' (clean saved state) | 'edit'

  // ---- small inline icons ----------------------------------------
  const BELL_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  const NO_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>';

  // ---- dom refs --------------------------------------------------
  const $ = (s) => document.querySelector(s);
  const el = {
    body: document.body,
    greeting: $('#greeting'),
    clock: $('#clock'),
    nameInput: $('#sessionName'),
    total: $('#totalTime'),
    card: $('#card'),
    modeToggle: $('#modeToggle'),
    segments: $('#segments'),
    addSeg: $('#addSegment'),
    clearBtn: $('#clearBtn'),
    clearLabel: document.querySelector('#clearBtn .clear-label'),
    saveBtn: $('#saveBtn'),
    saveLabel: document.querySelector('#saveBtn .save-label'),
    beginBtn: $('#beginBtn'),
    savedList: $('#savedList'),
    toast: $('#toast'),
    swState: $('#swState'),
    // runner
    runner: $('#runner'),
    runName: $('#runName'),
    runSegLabel: $('#runSegLabel'),
    runTime: $('#runTime'),
    runTotal: $('#runTotal'),
    runDots: $('#runDots'),
    pauseBtn: $('#pauseBtn'),
    endBtn: $('#endBtn'),
    dimmer: $('#dimmer')
  };

  // ============================================================
  //  TIME OF DAY  (greeting + palette)
  // ============================================================
  function applyTimeOfDay() {
    const now = new Date();
    const h = now.getHours();
    let greet, palette;
    if (h >= 5 && h < 12) { greet = 'Good morning'; palette = 'morning'; }
    else if (h >= 12 && h < 17) { greet = 'Good afternoon'; palette = 'afternoon'; }
    else if (h >= 17 && h < 21) { greet = 'Good evening'; palette = 'evening'; }
    else { greet = 'Good evening'; palette = 'night'; }

    // split greeting so the time-of-day word can be italic/accented
    const parts = greet.split(' ');
    el.greeting.innerHTML = parts[0] + ' <em>' + parts[1] + '</em>';

    ['morning', 'afternoon', 'evening', 'night'].forEach((p) =>
      el.body.classList.toggle('palette-' + p, p === palette));

    el.clock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      + '  ·  ' + now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ============================================================
  //  AUDIO  (synthesized bell / chime) — warm & polyphonic
  // ============================================================
  // Live, user-tweakable voice parameters (see index.html EDITMODE block
  // and tweaks.js). app.js only ever READS this object; the panel mutates
  // it in place, so every new strike picks up the latest values.
  const TWEAKS = window.STILLPOINT_TWEAKS || (window.STILLPOINT_TWEAKS = {});

  let audioCtx = null;
  let masterBus = null;   // global volume
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audioCtx = new AC();
        masterBus = audioCtx.createGain();
        // soft compressor smooths peaks when several partials/voices stack
        const comp = audioCtx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 22;
        comp.ratio.value = 3;
        comp.attack.value = 0.006;
        comp.release.value = 0.3;
        masterBus.connect(comp).connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (masterBus) {
      const v = (Number(TWEAKS.volume) || 0) / 100;
      masterBus.gain.value = v * v * 0.5;   // perceptual taper
    }
    return audioCtx;
  }

  // Inharmonic partial set — the ratios that give metal its "voice".
  // Each partial decays faster the higher it sits, so the tone naturally
  // mellows into a pure hum as it rings out.
  // HARMONIC partials (octave, fifth-above-octave, double-octave). Keeping
  // the ratios consonant — not the clashing inharmonic ratios of a struck
  // bell — is what makes a singing/crystal bowl sound serene instead of eerie.
  const VOICE_PARTIALS = [
    { f: 1.00, a: 1.00, d: 1.00 },
    { f: 2.00, a: 0.42, d: 0.84 },
    { f: 3.00, a: 0.16, d: 0.56 },
    { f: 4.00, a: 0.07, d: 0.40 }
  ];

  // Voicings are all consonant — fundamental, perfect fifth, octave. No third,
  // so it never sounds "major-key musical"; just open, bright, meditative.
  const CHORDS = {
    mono:  [{ m: 1,   g: 1.00, dt: 0    }],
    fifth: [{ m: 1,   g: 1.00, dt: 0    }, { m: 1.5, g: 0.40, dt: 0.04 }],
    triad: [{ m: 1,   g: 1.00, dt: 0    }, { m: 1.5, g: 0.38, dt: 0.05 }, { m: 2.0, g: 0.28, dt: 0.09 }]
  };

  // One struck pitch: stacked HARMONIC sine partials under a low-pass that
  // gently closes as the note rings. The only detuning is a narrow, slow
  // beat on the fundamental ("shimmer") — the gentle wah of a real bowl,
  // not the wideband chorus that made it sound like a horror soundtrack.
  function strikeVoice(ctx, dest, freq, t0, p) {
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = p.gain;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    // bright but not sharp: a generous open cutoff, low Q, easing down slowly
    const cutOpen  = 2400 + (1 - p.warmth) * 4600 + freq * 1.1;
    const cutClose = Math.max(380, 900 + (1 - p.warmth) * 1000 + freq * 0.5);
    lp.frequency.setValueAtTime(cutOpen, t0);
    lp.frequency.exponentialRampToValueAtTime(cutClose, t0 + p.decay * 0.85);
    lp.Q.value = 0.0001;
    voiceGain.connect(lp).connect(dest);

    VOICE_PARTIALS.forEach((pt, i) => {
      // warmth rolls off the upper partials for a rounder, softer tone
      const amp = pt.a * Math.pow(1 - p.warmth * 0.5, i);
      if (amp < 0.004) return;
      const dec = Math.max(0.3, p.decay * pt.d);

      // gentle beating only on the lowest two partials, very narrow (cents)
      const beat = (i <= 1 && p.shimmer > 0.2);
      const sides = beat ? [-1, 1] : [0];
      sides.forEach((side) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * pt.f;
        osc.detune.value = side * p.shimmer;   // cents, ~0–12 → slow 0–4Hz wah
        const g = ctx.createGain();
        const a = beat ? amp * 0.55 : amp;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, t0 + p.attack);
        // long natural tail, then a gentle glide to true zero — no click
        g.gain.exponentialRampToValueAtTime(Math.max(0.0006, a * 0.0008), t0 + dec);
        g.gain.linearRampToValueAtTime(0, t0 + dec + 0.5);
        osc.connect(g).connect(voiceGain);
        osc.start(t0);
        osc.stop(t0 + dec + 0.6);
      });
    });
  }

  // Pentatonic scale degrees (semitones) — a wind chime's tubes are tuned to
  // a pentatonic so any combination sounds consonant. Spread across ~2 octaves.
  const CHIME_SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

  function rand(a, b) { return a + Math.random() * (b - a); }

  // A wind chime: several tubes catching a breeze. We strike a handful of
  // pentatonic notes in a loose, randomized order with uneven timing and
  // velocity, so it reads as a real chime stirring rather than a single tone.
  function playChime(ctx, t0) {
    const semis   = Number(TWEAKS.chimePitch)    || 0;
    const warmth  = (Number(TWEAKS.chimeWarmth)  || 0) / 100;
    const sustain = (Number(TWEAKS.chimeSustain) || 0) / 100;
    const shimmer = (Number(TWEAKS.chimeShimmer) || 0) / 100 * 12;
    const notes   = Math.max(1, Math.round(Number(TWEAKS.chimeNotes) || 5));
    const spread  = (Number(TWEAKS.chimeSpread) || 0) / 100;   // timing looseness

    const root = 587 * Math.pow(2, semis / 12);
    const decay = 2.2 + sustain * 5.5;

    // pick a shuffled, mostly-ascending set of distinct tubes
    const pool = CHIME_SCALE.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, Math.min(notes, pool.length))
      .sort((a, b) => a - b);
    // a chime rarely sweeps in strict order — nudge the sequence a little
    if (picked.length > 2 && Math.random() < 0.6) {
      const i = 1 + Math.floor(Math.random() * (picked.length - 1));
      const j = 1 + Math.floor(Math.random() * (picked.length - 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }

    let t = t0;
    picked.forEach((semi, i) => {
      const freq = root * Math.pow(2, semi / 12);
      // higher tubes are smaller → quieter and shorter; add gentle randomness
      const hiRoll = 1 - (semi / 24) * 0.45;
      const vel = rand(0.6, 1) * hiRoll;
      strikeVoice(ctx, masterBus, freq, t, {
        gain: 0.34 * vel,
        decay: decay * (0.7 + hiRoll * 0.5),
        warmth: warmth,
        shimmer: shimmer,
        attack: 0.004 + warmth * 0.01
      });
      // uneven gaps — a breeze, not a metronome
      const gap = rand(0.07, 0.16) * (0.4 + spread * 1.8);
      t += gap;
    });
  }

  // ============================================================
  //  JAPANESE STANDING BELL  (rin / orin)
  // ============================================================
  // A rin's voice is INHARMONIC but ordered — nothing like the consonant
  // bowl above. What makes it unmistakable:
  //  • a long, pure fundamental that sings for many seconds;
  //  • a strong *stretched* second mode (~2.7×, not a clean octave) that
  //    gives the metal its singing "voice";
  //  • bright upper modes that flash at the strike and die away fast;
  //  • a metallic "ting" transient on contact, then it settles to a hum;
  //  • two nearly-identical modes per partial that drift in and out of
  //    phase — that slow shimmering *warble* is the soul of a standing bell.
  // These ratios are measured-bell-like (stretched, inharmonic), which is
  // exactly why a rin reads as serene rather than clangy.
  const RIN_PARTIALS = [
    { f: 1.000, a: 1.00, d: 1.00 },
    { f: 2.740, a: 0.60, d: 0.62 },
    { f: 5.380, a: 0.30, d: 0.38 },
    { f: 8.900, a: 0.13, d: 0.24 },
    { f: 13.20, a: 0.05, d: 0.15 }
  ];

  // One struck rin. beat = Hz of warble; paired modes split a little wider
  // the higher they sit, just like a real bell.
  function strikeRin(ctx, dest, freq, t0, p) {
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = p.gain;

    // bright at the strike, then closes down into a warm singing hum
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const open  = 6400 + (1 - p.warmth) * 6000;
    const close = Math.max(700, 1500 + (1 - p.warmth) * 1500 + freq * 0.6);
    lp.frequency.setValueAtTime(open, t0);
    lp.frequency.exponentialRampToValueAtTime(close, t0 + 0.55);
    lp.Q.value = 0.0001;
    voiceGain.connect(lp).connect(dest);

    // soft mallet contact — a tiny filtered-noise tick sells the strike
    const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = nb;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass';
    nf.frequency.value = 2400 + (1 - p.warmth) * 1600; nf.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.05 * (1 - p.warmth * 0.5), t0);
    ng.gain.exponentialRampToValueAtTime(0.0003, t0 + 0.05);
    ns.connect(nf).connect(ng).connect(voiceGain);
    ns.start(t0); ns.stop(t0 + 0.06);

    // sustained inharmonic partials, each a slow-beating pair
    RIN_PARTIALS.forEach((pt, i) => {
      const amp = pt.a * Math.pow(1 - p.warmth * 0.42, i);
      if (amp < 0.003) return;
      const dec = Math.max(0.3, p.decay * pt.d);
      const split = p.beat * (1 + i * 0.6);   // Hz between the paired modes
      [0, split].forEach((off, k) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq * pt.f + off;
        const g = ctx.createGain();
        const a = amp * (k === 0 ? 1 : 0.82);
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(a, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0005, a * 0.0007), t0 + dec);
        g.gain.linearRampToValueAtTime(0, t0 + dec + 0.5);
        osc.connect(g).connect(voiceGain);
        osc.start(t0);
        osc.stop(t0 + dec + 0.6);
      });
    });

    // bright metallic strike transient — high inharmonic "ting", fades fast
    [6.7, 9.4, 12.3].forEach((r, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * r * (1 + (Math.random() - 0.5) * 0.012);
      const g = ctx.createGain();
      const a = 0.085 * (1 - p.warmth * 0.6) / (i + 1);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(a, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.22 + i * 0.05);
      osc.connect(g).connect(voiceGain);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  }

  // A few rings of standing bells in different tones, struck in a gentle
  // sequence so each blooms and rings out before the next sounds.
  const RIN_SEQUENCES = { 1: [0], 2: [0, 12], 3: [0, 12, 7] };

  function playBells(ctx, t0) {
    const semis   = Number(TWEAKS.bellPitch)    || 0;
    const warmth  = (Number(TWEAKS.bellWarmth)  || 0) / 100;
    const sustain = (Number(TWEAKS.bellSustain) || 0) / 100;
    const warble  = (Number(TWEAKS.bellShimmer) || 0) / 100;
    const rings   = Math.max(1, Math.min(3, Math.round(Number(TWEAKS.bellRings) || 3)));

    // temple bells sit low and resonant — root near C4
    const root  = 261.6 * Math.pow(2, semis / 12);
    const decay = 5 + sustain * 11;            // long, singing ring
    const beat  = 0.5 + warble * 3.2;          // Hz of warble

    const seq = RIN_SEQUENCES[rings] || [0];
    let t = t0;
    seq.forEach((semi) => {
      const freq = root * Math.pow(2, semi / 12);
      const hiRoll = 1 - (semi / 12) * 0.10;   // higher bells a touch softer/shorter
      strikeRin(ctx, masterBus, freq, t, {
        gain: 0.5 * hiRoll,
        decay: decay * (0.82 + (1 - semi / 12) * 0.28),
        warmth: warmth,
        beat: beat
      });
      // each bell rings well before the next is struck
      t += (1.5 + sustain * 1.5) * rand(0.92, 1.1);
    });
  }

  function playSound(kind) {
    if (!kind || kind === 'none') return;
    const ctx = ensureAudio();
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.02;

    if (kind === 'chime') { playChime(ctx, t0); return; }
    if (kind === 'bell')  { playBells(ctx, t0); return; }
  }

  // let the Tweaks panel audition sounds with the current settings
  window.STILLPOINT_PREVIEW = playSound;

  // ============================================================
  //  SESSION HELPERS
  // ============================================================
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function segSeconds(s) { return (Number(s.min) || 0) * 60 + (Number(s.sec) || 0); }
  function totalSeconds(sess) { return sess.segments.reduce((t, s) => t + segSeconds(s), 0); }

  function fmtClock(secs) {
    secs = Math.max(0, Math.round(secs));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
  function fmtTotal(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m === 0) return { val: s, unit: s === 1 ? 'sec' : 'secs' };
    if (s === 0) return { val: m, unit: m === 1 ? 'min' : 'min' };
    return { val: m + ':' + String(s).padStart(2, '0'), unit: 'min' };
  }

  // ============================================================
  //  RENDER — builder
  // ============================================================
  function render() {
    el.nameInput.value = session.name || '';
    el.card.classList.toggle('editing', mode === 'edit');
    el.modeToggle.textContent = mode === 'edit' ? 'Done' : 'Edit';

    // total
    const tot = totalSeconds(session);
    const f = fmtTotal(tot);
    el.total.innerHTML = f.val + '<span class="unit">' + f.unit + '</span>';

    // segments
    el.segments.innerHTML = '';
    session.segments.forEach((seg, i) => {
      el.segments.appendChild(mode === 'edit' ? renderSegmentEdit(seg, i) : renderSegmentView(seg, i));
    });

    updateSaveState();
    el.beginBtn.disabled = tot <= 0;
    el.beginBtn.style.opacity = tot <= 0 ? 0.4 : 1;
  }

  // ---- view (read-only) segment ----------------------------------
  function renderSegmentView(seg, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'segment view';

    const top = document.createElement('div');
    top.className = 'seg-top';

    const badge = document.createElement('div');
    badge.className = 'seg-index';
    badge.textContent = idx + 1;

    const time = document.createElement('div');
    time.className = 'seg-time-text';
    time.textContent = fmtClock(segSeconds(seg));

    const cues = document.createElement('div');
    cues.className = 'seg-cues';
    cues.appendChild(cueView('Start', seg.start));
    cues.appendChild(cueView('End', seg.end));

    top.appendChild(badge);
    top.appendChild(time);
    top.appendChild(cues);
    wrap.appendChild(top);
    return wrap;
  }

  function cueView(label, kind) {
    const c = document.createElement('div');
    c.className = 'cue';
    const l = document.createElement('span');
    l.className = 'cue-lab';
    l.textContent = label;
    const ico = document.createElement('span');
    ico.className = 'cue-icon ' + (kind === 'none' ? 'off' : 'on');
    ico.innerHTML = kind === 'none' ? NO_SVG : BELL_SVG;
    ico.title = kind === 'none' ? 'No sound' : (SOUND_LABEL[kind] + ' sound');
    c.appendChild(l);
    c.appendChild(ico);
    return c;
  }

  function renderSegmentEdit(seg, idx) {
    const wrap = document.createElement('div');
    wrap.className = 'segment';

    // top row: index + time inputs
    const top = document.createElement('div');
    top.className = 'seg-top';

    const badge = document.createElement('div');
    badge.className = 'seg-index';
    badge.textContent = idx + 1;
    top.appendChild(badge);

    const timeWrap = document.createElement('div');
    timeWrap.className = 'time-input';
    timeWrap.appendChild(numField('min', seg.min, 'Min', (v) => { seg.min = v; refreshTotals(); }));
    const colon = document.createElement('span');
    colon.className = 'colon';
    colon.textContent = ':';
    timeWrap.appendChild(colon);
    timeWrap.appendChild(numField('sec', seg.sec, 'Sec', (v) => { seg.sec = Math.min(59, v); refreshTotals(); }, 59, true));
    top.appendChild(timeWrap);
    wrap.appendChild(top);

    // sound row
    const sounds = document.createElement('div');
    sounds.className = 'sound-row';
    sounds.appendChild(soundPicker('Start', seg.start, (v) => { seg.start = v; persistLast(); }));
    sounds.appendChild(soundPicker('End', seg.end, (v) => { seg.end = v; persistLast(); }));
    wrap.appendChild(sounds);

    // remove
    if (session.segments.length > 1) {
      const rm = document.createElement('button');
      rm.className = 'seg-remove';
      rm.setAttribute('aria-label', 'Remove segment');
      rm.textContent = '\u00d7';
      rm.addEventListener('click', () => {
        session.segments.splice(idx, 1);
        persistLast();
        render();
      });
      wrap.appendChild(rm);
    }
    return wrap;
  }

  function numField(kind, value, label, onChange, max, pad) {
    const f = document.createElement('div');
    f.className = 'field';
    const input = document.createElement('input');
    if (pad) {
      // text + numeric mode so we can show a zero-padded 2-digit value (e.g. 00)
      input.type = 'text';
      input.inputMode = 'numeric';
      input.setAttribute('maxlength', '2');
      input.value = String(value).padStart(2, '0');
    } else {
      input.type = 'number';
      input.min = '0';
      if (max != null) input.max = String(max);
      input.value = value;
    }
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      let raw = pad ? input.value.replace(/[^0-9]/g, '') : input.value;
      let v = parseInt(raw, 10);
      if (isNaN(v) || v < 0) v = 0;
      if (max != null && v > max) v = max;
      onChange(v);
    });
    // Reformat in place on blur — NOT a full render(), which would destroy
    // this node mid-Tab and drop focus before it reaches the next field.
    input.addEventListener('blur', () => {
      let v = parseInt(input.value.replace(/[^0-9]/g, ''), 10);
      if (isNaN(v) || v < 0) v = 0;
      if (max != null && v > max) v = max;
      input.value = pad ? String(v).padStart(2, '0') : String(v);
    });
    const lab = document.createElement('div');
    lab.className = 'lab';
    lab.textContent = label;
    f.appendChild(input);
    f.appendChild(lab);
    return f;
  }

  function soundPicker(label, current, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'sound-pick';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);
    const group = document.createElement('div');
    group.className = 'chip-group';
    SOUNDS.forEach((s) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = SOUND_LABEL[s];
      chip.setAttribute('aria-pressed', String(s === current));
      chip.addEventListener('click', () => {
        onChange(s);
        [...group.children].forEach((c, i) =>
          c.setAttribute('aria-pressed', String(SOUNDS[i] === s)));
        if (s !== 'none') playSound(s); // preview
      });
      group.appendChild(chip);
    });
    wrap.appendChild(group);
    return wrap;
  }

  function refreshTotals() {
    const tot = totalSeconds(session);
    const f = fmtTotal(tot);
    el.total.innerHTML = f.val + '<span class="unit">' + f.unit + '</span>';
    el.beginBtn.disabled = tot <= 0;
    el.beginBtn.style.opacity = tot <= 0 ? 0.4 : 1;
    persistLast();
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function persistLast() {
    session.name = el.nameInput.value;
    try { localStorage.setItem(LAST_KEY, JSON.stringify(session)); } catch (e) {}
  }
  function loadLast() {
    try {
      const raw = localStorage.getItem(LAST_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function writeSaved(list) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)); } catch (e) {}
  }

  function saveSession() {
    persistLast();
    const name = (el.nameInput.value || 'Untitled').trim();
    session.name = name;
    const list = loadSaved();
    const existing = list.findIndex((s) => s.name.toLowerCase() === name.toLowerCase());
    const entry = clone(session);
    if (existing >= 0) list[existing] = entry; else list.unshift(entry);
    writeSaved(list);
    renderSaved();
    updateSaveState();
    toast('Saved \u201c' + name + '\u201d');
  }

  function updateSaveState() {
    const name = (el.nameInput.value || '').trim().toLowerCase();
    const saved = !!name && loadSaved().some((s) => (s.name || '').toLowerCase() === name);
    el.saveBtn.classList.toggle('is-bookmarked', saved);
    if (el.saveLabel) el.saveLabel.textContent = saved ? 'Bookmarked' : 'Bookmark';
  }

  function renderSaved() {
    const list = loadSaved();
    el.savedList.innerHTML = '';
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'saved-empty';
      e.textContent = 'Nothing bookmarked yet — build a session and tap Bookmark.';
      el.savedList.appendChild(e);
      return;
    }
    list.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'saved-item';
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      const f = fmtTotal(totalSeconds(s));
      item.innerHTML = '<span>' + escapeHtml(s.name) + '</span><span class="dur">' +
        f.val + ' ' + f.unit + '</span>';
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '\u00d7';
      del.setAttribute('aria-label', 'Delete saved session');
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const arr = loadSaved();
        arr.splice(i, 1);
        writeSaved(arr);
        renderSaved();
      });
      const loadIt = () => {
        session = clone(s);
        mode = 'view';
        persistLast();
        render();
        toast('Loaded \u201c' + s.name + '\u201d');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
      item.addEventListener('click', loadIt);
      item.addEventListener('keydown', (e2) => { if (e2.key === 'Enter') loadIt(); });
      item.appendChild(del);
      el.savedList.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  // ============================================================
  //  RUNNING ENGINE
  // ============================================================
  const run = {
    active: false,
    paused: false,
    segIndex: 0,
    startAt: 0,        // ms timestamp when current segment started
    pausedAccum: 0,    // not used (we reset startAt on resume)
    segDur: 0,         // seconds of current segment
    raf: null,
    bounds: [],        // cumulative seconds
    total: 0,
    wakeLock: null,
    dimTimer: null
  };

  async function beginSession() {
    persistLast();
    ensureAudio();
    const tot = totalSeconds(session);
    if (tot <= 0) return;

    run.active = true;
    run.paused = false;
    run.segIndex = 0;
    run.total = tot;
    run.bounds = [];
    let acc = 0;
    session.segments.forEach((s) => { acc += segSeconds(s); run.bounds.push(acc); });

    el.body.classList.add('running');
    el.body.classList.remove('complete', 'dimmed');
    el.runName.textContent = session.name || 'Session';
    buildDots();
    requestWake();
    wakeScreen();         // start bright, then dim
    scheduleDim();

    startSegment(0, true);
    document.addEventListener('visibilitychange', onVisibility);
  }

  function startSegment(i, isFirst) {
    run.segIndex = i;
    const seg = session.segments[i];
    run.segDur = segSeconds(seg);
    run.startAt = Date.now();

    // sounds: start sound of this segment (and on first, that's the opener)
    if (seg.start !== 'none') playSound(seg.start);

    el.runSegLabel.textContent = 'Segment ' + (i + 1) + ' of ' + session.segments.length;
    updateDots();
    tick();
    if (!run.raf) loop();
  }

  function loop() {
    run.raf = requestAnimationFrame(loop);
    if (!run.paused) tick();
  }

  function tick() {
    const elapsed = (Date.now() - run.startAt) / 1000;
    const remain = run.segDur - elapsed;
    el.runTime.textContent = fmtClock(remain);

    // total remaining across whole session
    const doneBefore = run.segIndex > 0 ? run.bounds[run.segIndex - 1] : 0;
    const totalElapsed = doneBefore + Math.min(elapsed, run.segDur);
    el.runTotal.textContent = fmtClock(run.total - totalElapsed) + ' remaining';

    if (remain <= 0) advanceSegment();
  }

  function advanceSegment() {
    const seg = session.segments[run.segIndex];
    if (seg.end !== 'none') playSound(seg.end);

    if (run.segIndex < session.segments.length - 1) {
      // brief gap so an end+next-start chime don't fully overlap
      const next = run.segIndex + 1;
      run.paused = true; // freeze ticking during the tiny handoff
      el.runTime.textContent = fmtClock(0);
      setTimeout(() => {
        if (!run.active) return;
        run.paused = false;
        startSegment(next);
      }, 700);
    } else {
      finishSession();
    }
  }

  function finishSession() {
    cancelAnimationFrame(run.raf);
    run.raf = null;
    run.active = false;
    el.body.classList.add('complete');
    el.body.classList.remove('dimmed');
    wakeScreen();
    clearTimeout(run.dimTimer);
    releaseWake();
  }

  function endSession() {
    cancelAnimationFrame(run.raf);
    run.raf = null;
    run.active = false;
    run.paused = false;
    el.body.classList.remove('running', 'complete', 'dimmed', 'awake');
    clearTimeout(run.dimTimer);
    releaseWake();
    document.removeEventListener('visibilitychange', onVisibility);
  }

  function togglePause() {
    if (!run.active) return;
    if (run.paused) {
      // resume: shift startAt forward by paused duration
      run.startAt = Date.now() - run.pauseElapsed * 1000;
      run.paused = false;
      el.pauseBtn.textContent = 'Pause';
    } else {
      run.pauseElapsed = (Date.now() - run.startAt) / 1000;
      run.paused = true;
      el.pauseBtn.textContent = 'Resume';
    }
    wakeScreen();
  }

  // segment progress dots
  function buildDots() {
    el.runDots.innerHTML = '';
    session.segments.forEach(() => {
      const d = document.createElement('div');
      d.className = 'dot';
      el.runDots.appendChild(d);
    });
  }
  function updateDots() {
    [...el.runDots.children].forEach((d, i) => {
      d.classList.toggle('done', i < run.segIndex);
      d.classList.toggle('active', i === run.segIndex);
    });
  }

  // ---- screen dimming (focus-friendly) ---------------------------
  function scheduleDim() {
    clearTimeout(run.dimTimer);
    run.dimTimer = setTimeout(() => {
      if (run.active) el.body.classList.add('dimmed');
    }, 6000);
  }
  function wakeScreen() {
    el.body.classList.add('awake');
    el.body.classList.remove('dimmed');
    clearTimeout(run.wakeTimer);
    run.wakeTimer = setTimeout(() => el.body.classList.remove('awake'), 4000);
    if (run.active) scheduleDim();
  }

  // ---- wake lock (keep screen on) --------------------------------
  async function requestWake() {
    try {
      if ('wakeLock' in navigator) {
        run.wakeLock = await navigator.wakeLock.request('screen');
        run.wakeLock.addEventListener('release', () => {});
      }
    } catch (e) { /* user agent may reject; non-fatal */ }
  }
  function releaseWake() {
    try { if (run.wakeLock) { run.wakeLock.release(); run.wakeLock = null; } } catch (e) {}
  }
  function onVisibility() {
    if (document.visibilityState === 'visible' && run.active) requestWake();
  }

  // ============================================================
  //  EVENTS
  // ============================================================
  el.nameInput.addEventListener('input', () => { persistLast(); updateSaveState(); });

  el.modeToggle.addEventListener('click', () => {
    mode = mode === 'edit' ? 'view' : 'edit';
    render();
  });

  el.addSeg.addEventListener('click', () => {
    const last = session.segments[session.segments.length - 1] || { end: 'none' };
    session.segments.push({ min: 5, sec: 0, start: 'none', end: last.end !== 'none' ? last.end : 'chime' });
    persistLast();
    render();
  });

  // Clear the whole timer — two-tap confirm so it's safe but unobtrusive.
  let clearArmed = false;
  let clearTimer = null;
  function disarmClear() {
    clearArmed = false;
    clearTimeout(clearTimer);
    el.clearBtn.classList.remove('confirm');
    if (el.clearLabel) el.clearLabel.textContent = 'Clear';
  }
  el.clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      el.clearBtn.classList.add('confirm');
      if (el.clearLabel) el.clearLabel.textContent = 'Clear all?';
      clearTimer = setTimeout(disarmClear, 3500);
      return;
    }
    disarmClear();
    // reset to a single blank segment and drop into edit mode to rebuild
    session = { name: '', segments: [{ min: 5, sec: 0, start: 'none', end: 'bell' }] };
    mode = 'edit';
    render();           // clears the name field first
    persistLast();      // ...so this doesn't recapture the old name
    updateSaveState();
    el.nameInput.focus();
    toast('Timer cleared');
  });
  // any tap elsewhere cancels a pending confirm
  document.addEventListener('click', (ev) => {
    if (clearArmed && !el.clearBtn.contains(ev.target)) disarmClear();
  });

  el.saveBtn.addEventListener('click', saveSession);
  el.beginBtn.addEventListener('click', beginSession);
  el.pauseBtn.addEventListener('click', togglePause);
  el.endBtn.addEventListener('click', endSession);

  // ------------------------------------------------------------
  // Make Tab reach EVERY interactive control, not just text fields.
  // macOS (and Safari by default) only tab between text inputs & lists,
  // so in read mode Tab jumps from the title straight to the address bar,
  // skipping Bookmark / Clear / Edit / Begin. We walk the natural DOM tab
  // order ourselves and only release at the ends, so the user can still
  // tab out to the browser chrome.
  // ------------------------------------------------------------
  function tabStops() {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...document.querySelectorAll(sel)].filter((node) => {
      if (node.tabIndex < 0) return false;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      // offsetParent is null for display:none ancestors (hidden screens, closed panels)
      return node.offsetParent !== null || cs.position === 'fixed';
    });
  }
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Tab' || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const stops = tabStops();
    if (!stops.length) return;
    const i = stops.indexOf(document.activeElement);
    if (i === -1) return;                                  // focus outside our set
    const atBoundary = ev.shiftKey ? i === 0 : i === stops.length - 1;
    if (atBoundary) return;                                // let focus exit to chrome
    ev.preventDefault();
    stops[i + (ev.shiftKey ? -1 : 1)].focus();
  });

  // any interaction in the runner briefly brightens the screen
  ['pointerdown', 'pointermove', 'keydown'].forEach((evt) => {
    el.runner.addEventListener(evt, () => { if (run.active) wakeScreen(); });
  });

  // refresh greeting/palette every minute & on focus
  applyTimeOfDay();
  setInterval(applyTimeOfDay, 30000);
  window.addEventListener('focus', applyTimeOfDay);

  // ============================================================
  //  PWA — service worker
  // ============================================================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(() => {
        if (el.swState) el.swState.innerHTML = 'works offline \u00b7 <span class="ok">ready</span>';
      }).catch(() => {
        if (el.swState) el.swState.textContent = 'install to use offline';
      });
    });
  }

  // ---- boot ------------------------------------------------------
  render();
  renderSaved();
})();
