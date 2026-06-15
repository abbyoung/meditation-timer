import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Stillpoint is a client-only, offline-capable PWA. No backend, no runtime
// network calls except the first-load font fetch (which we self-host + precache).
// vite-plugin-pwa generates the service worker and auto-versions the precache,
// removing the manual `stillpoint-vN` cache-bump chore from the reference build.
export default defineConfig({
  // Emit relative asset URLs so the app works when served from any sub-path.
  base: './',

  build: {
    target: 'es2022',
    // Keep the audio/timer modules debuggable in the shipped build.
    sourcemap: true,
  },

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Precache the app shell + hashed font assets for true offline (Spec §10/§11).
      workbox: {
        // Precache every asset the app shell needs, including the webmanifest.
        globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg,ico,webmanifest}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // Serve index.html for any navigation request while offline (Spec §10).
        // Stillpoint is a single-page app with no routing, so every navigation
        // that isn't in the precache should fall back to the app shell.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/icons\//, /\.(?:png|ico|svg|woff2?)$/],
      },
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Stillpoint — Meditation Timer',
        short_name: 'Stillpoint',
        description: 'A quiet, ambient meditation timer with custom segments and chimes.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0c0f1a',
        theme_color: '#0c0f1a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        // Keep the SW off in dev so HMR isn't shadowed by a precache.
        enabled: false,
      },
    }),
  ],
});
