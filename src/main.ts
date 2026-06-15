// Self-hosted fonts — Vite fingerprints + precaches the woff2 files (Spec §8/§10).
import '@fontsource/spectral/200.css';
import '@fontsource/spectral/300.css';
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/500.css';
import '@fontsource/spectral/300-italic.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';

import './styles.css';

import { registerSW } from 'virtual:pwa-register';
import { AudioEngine }      from './audio/AudioEngine.js';
import { loadSoundParams }  from './persistence/Store.js';
import { startTheme }       from './theme/Theming.js';
import { Builder }          from './ui/Builder.js';
import { Runner }           from './ui/Runner.js';
import { Settings }         from './ui/Settings.js';

// ── Audio engine ─────────────────────────────────────────────────────────────
const engine   = new AudioEngine();
engine.setParams(loadSoundParams());

// ── Settings panel ────────────────────────────────────────────────────────────
const settings = new Settings(engine);

// ── Runner ───────────────────────────────────────────────────────────────────
// Constructed before Builder so it can be passed as the onBegin target.
const runner = new Runner(engine, () => {
  // Called when End or "Return home" is tapped; reload from storage.
  builder.onReturnHome();
});

// ── Builder ───────────────────────────────────────────────────────────────────
const builder = new Builder(engine, (session) => {
  runner.start(session);
});

// ── Theme ─────────────────────────────────────────────────────────────────────
startTheme();

// ── Boot ─────────────────────────────────────────────────────────────────────
function boot(): void {
  settings.mount();
  runner.mount();
  builder.mount();

  // Wire the settings trigger button.
  const settingsBtn = document.getElementById('settingsBtn');
  settingsBtn?.addEventListener('click', () => {
    engine.resume(); // ensure AudioContext is ready for Hear-it previews
    settings.toggle();
  });

  // Register the SW after mount() so builder.setSWStatus() has a live DOM ref.
  // onRegistered fires asynchronously (SW activation can take seconds on first
  // install), but by then we are definitely mounted.
  registerSW({
    immediate: true,
    onRegistered() {
      builder.setSWStatus('works offline · <span class="ok">ready</span>');
    },
    onRegisterError() {
      builder.setSWStatus('install to use offline');
    },
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
