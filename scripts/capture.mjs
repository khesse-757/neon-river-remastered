#!/usr/bin/env node
// Look-dev captures at exact viewports through the real test hooks.
//   node scripts/capture.mjs --out docs/media/gate-1 --name grid-216 --state active-play [--query "grid=216x387&fish=voxel"] [--seed 42]
// Writes <name>-desktop.png (1440x900) and <name>-mobile.png (390x844 @3x, saved at CSS size).
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []),
);
const url = args.url ?? 'http://127.0.0.1:5188';
const out = args.out ?? 'artifacts/captures';
const state = args.state ?? 'active-play';
const seed = Number(args.seed ?? 42);
const only = args.only;
mkdirSync(out, { recursive: true });

const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: 'chromium' });
for (const [mode, options] of Object.entries(VIEWS)) {
  if (only && only !== mode) continue;
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${url}/?${args.query ?? ''}`);
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.mode === 'title', null, { timeout: 20000 });
  const info = await page.evaluate(
    async ({ state, seed }) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      await hooks.seed(seed);
      await hooks.hideDebugUi(true);
      await hooks.setState(state);
      await hooks.setPausedForScreenshot(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const d = window.__THREE_GAME_DIAGNOSTICS__;
      return {
        palette: hooks.paletteReport(),
        layout: d.layout,
        calls: d.renderer.calls,
        phase: d.phase,
        caught: d.caught,
        fish: d.fish,
        ripple: d.rippleEncoding,
      };
    },
    { state, seed },
  );
  const file = `${out}/${args.name ?? state.replace(/[:.]/g, '-')}-${mode}.png`;
  const scale = mode === 'mobile' && args.device ? 'device' : 'css';
  await page.screenshot({ path: file, scale });
  console.log(`${file} ${JSON.stringify(info)}${errors.length ? ' ERRORS: ' + errors.join(' | ') : ''}`);
  // --frames N: let the built-in tracker play on and grab a strip of live frames (motion check).
  for (let i = 1; i <= Number(args.frames ?? 0); i++) {
    await page.evaluate(() => {
      window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(false);
      window.__THREE_GAME_TEST_HOOKS__.setAutoplay(true);
    });
    await page.waitForTimeout(Number(args.interval ?? 700));
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setPausedForScreenshot(true));
    await page.screenshot({ path: file.replace('.png', `-f${i}.png`), scale });
  }
  await context.close();
}
await browser.close();
