// Stillpoint entry point.
//
// Self-hosted fonts (Spec §8 "SHOULD self-host/precache for offline"). Importing
// the @fontsource CSS lets Vite fingerprint the woff2 files so vite-plugin-pwa
// precaches them — no cross-origin Google Fonts fetch at runtime.
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

// Auto-update the service worker; the new SW claims clients on next load.
registerSW({ immediate: true });

// Phase 1 scaffold marker. Subsequent phases mount the Builder/Runner UI,
// AudioEngine, Timer, Persistence and Theming modules here.
const boot = () => {
  document.documentElement.dataset.stillpoint = 'booted';
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
