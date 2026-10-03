import { defineConfig, devices } from '@playwright/test';

// PW_SOFTWARE_GL=1 runs the bundled headless shell (SwiftShader), like the CI runners do.
const SOFTWARE_GL = Boolean(process.env.PW_SOFTWARE_GL);

export default defineConfig({
  testDir: './tests/e2e',
  // One worker: parallel headless WebGL contexts contend for the GPU, and the
  // frame-time collapse makes game time drift from wall time, flaking timed
  // gameplay phases and screenshot baselines.
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5188',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5188',
    // Reuse a dev server that is already running for the canvas inspector;
    // CI always starts a fresh one.
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  reporter: process.env.CI ? 'list' : undefined,
  projects: [
    {
      // The required CI check: one short desktop test, cheapest picture, game time fast-forwarded.
      name: 'ci',
      testMatch: /ci\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: SOFTWARE_GL ? undefined : 'chromium',
        // Small on purpose: CI rasterizes in software, and every frame costs by the pixel.
        viewport: { width: 420, height: 440 },
      },
    },
    {
      name: 'desktop-chrome',
      testIgnore: /ci\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // devices['Desktop Chrome'] sets no channel, so Playwright launches the
        // bundled headless shell, which has no GPU backend and falls back to
        // SwiftShader (CPU) — roughly 4x slower raster and meaningless FPS.
        // The full Chromium build renders headless on the real GPU.
        channel: SOFTWARE_GL ? undefined : 'chromium',
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // iPhone viewport, DPR and touch on the same GPU-backed Chromium as the
      // inspector. devices['iPhone 13'] alone selects WebKit, which needs its
      // own browser download and renders headless without the GPU. Confirm
      // Safari-specific behavior on a real device.
      name: 'mobile-chrome',
      testIgnore: /ci\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        channel: SOFTWARE_GL ? undefined : 'chromium',
      },
    },
  ],
});
