import { defineConfig } from 'vitest/config';

// Vitest config for Stillpoint — extends Vite's base setup.
// Uses node environment for DOM-free modules (Timer, Store, AudioEngine, format).
// Uses jsdom for theme tests that touch document.body.
export default defineConfig({
  test: {
    // Global mocks for Web APIs not available in Node
    environment: 'node',
    globals: true,
    // Each test file gets its own isolated environment
    isolate: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/ui/Builder.ts', 'src/ui/Runner.ts'],
    },
  },
});
