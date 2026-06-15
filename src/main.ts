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

// ── Audio engine ─────────────────────────────────────────────────────────────
const engine = new AudioEngine();
engine.setParams(loadSoundParams());

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
  runner.mount();
  builder.mount();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// ── PWA service worker ────────────────────────────────────────────────────────
registerSW({
  immediate: true,
  onRegistered() {
    builder.setSWStatus('works offline · <span class="ok">ready</span>');
  },
  onRegisterError() {
    builder.setSWStatus('install to use offline');
  },
});
