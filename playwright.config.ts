import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the Firebase emulators, never the real project:
//   npm run test:e2e   ->  firebase emulators:exec --only auth,firestore,storage "playwright test"
// `emulators:exec` starts auth/firestore/storage locally and sets the emulator host env vars before
// Playwright starts; globalSetup then seeds test listings, and the webServer below serves the app
// with VITE_USE_EMULATORS=true so src/firebase.ts connects to the emulators.
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: 'http://localhost:5201',
    trace: 'on-first-retry',
  },
  // Cold starts are slow: the first specs wait on Vite transforming modules plus the first
  // Firestore emulator round-trips, so assertions poll longer than Playwright's 5s default.
  expect: {
    timeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // A dedicated port with reuseExistingServer off: the suite always boots its own server with
    // VITE_USE_EMULATORS=true, so it can never attach to a stray dev server on 5173 — which would
    // serve the wrong app, or this app pointed at the real Firebase project.
    command: 'npm run dev -- --port 5201 --strictPort',
    url: 'http://localhost:5201',
    reuseExistingServer: false,
    env: {
      VITE_USE_EMULATORS: 'true',
    },
  },
});
