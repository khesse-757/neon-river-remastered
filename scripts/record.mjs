#!/usr/bin/env node
// Records short active-play videos and measures frame rate through the test hooks.
//   node scripts/record.mjs --url http://127.0.0.1:4188 --out docs/media/gate-1.5 [--seconds 9] [--query "actors=3x"] [--name play]
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []),
);
const url = args.url ?? 'http://127.0.0.1:5188';
const out = args.out ?? 'artifacts/videos';
const seconds = Number(args.seconds ?? 9);
mkdirSync(out, { recursive: true });

const VIEWS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: 'chromium' });
for (const [mode, options] of Object.entries(VIEWS)) {
  if (args.only && args.only !== mode) continue;
  const size = mode === 'desktop' && args.small ? { width: 960, height: 600 } : options.viewport;
  const context = await browser.newContext({ ...options, recordVideo: { dir: out, size } });
  const page = await context.newPage();
  await page.goto(`${url}/?seed=${args.seed ?? 42}&${args.query ?? ''}`);
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.mode === 'title', null, { timeout: 20000 });
  const clip = args.clip ?? 'play';
  let stats;
  if (clip === 'full') {
    // A whole night through the real start button, played by the planning bot, to the win and its results card.
    await page.locator('#btn-start').click();
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setAutoplay(true));
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.mode === 'over', null, { timeout: 240000 });
    await page.waitForTimeout(2500);
    stats = await page.evaluate(() => {
      const d = window.__THREE_GAME_DIAGNOSTICS__;
      return { status: d.status, caught: d.caught, escaped: d.escaped, seconds: +d.elapsed.toFixed(1) };
    });
  } else if (clip === 'eel') {
    // Play for a while, then an eel swims into the net: the shock, the basket frying, the loss screen.
    await page.locator('#btn-start').click();
    await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setAutoplay(true));
    await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.basket ?? 0) >= 14, null, { timeout: 60000 });
    await page.evaluate(() => {
      window.__THREE_GAME_TEST_HOOKS__.setAutoplay(false);
      window.__THREE_GAME_TEST_HOOKS__.spawnAtNet('eel');
    });
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.mode === 'over', null, { timeout: 20000 });
    await page.waitForTimeout(2000);
    stats = await page.evaluate(() => ({
      lossCause: window.__THREE_GAME_DIAGNOSTICS__.lossCause,
      caught: window.__THREE_GAME_DIAGNOSTICS__.caught,
    }));
  } else {
    stats = await page.evaluate(async (seconds) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      await hooks.seed(42);
      await hooks.setState('phase.neon-rapids');
      hooks.setAutoplay(true);
      const times = [];
      let calls = 0;
      let tris = 0;
      await new Promise((resolve) => {
        const start = performance.now();
        let last = start;
        const tick = (now) => {
          times.push(now - last);
          last = now;
          const d = window.__THREE_GAME_DIAGNOSTICS__;
          calls = Math.max(calls, d.renderer.calls);
          tris = Math.max(tris, d.renderer.triangles);
          if (now - start < seconds * 1000) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      times.shift();
      times.sort((a, b) => a - b);
      const d = window.__THREE_GAME_DIAGNOSTICS__;
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      return {
        fps: +(1000 / avg).toFixed(1),
        p95ms: +times[Math.floor(times.length * 0.95)].toFixed(1),
        maxCalls: calls,
        maxTriangles: tris,
        textures: d.renderer.textures,
        geometries: d.renderer.geometries,
        canvas: `${d.canvas.width}x${d.canvas.height}`,
        pixelsPerTexel: d.layout.pixelsPerTexel,
        quality: d.quality,
        caught: d.caught,
      };
    }, seconds);
  }
  const video = page.video();
  await context.close();
  const file = `${out}/${args.name ?? 'active-play'}-${mode}.webm`;
  renameSync(await video.path(), file);
  // Re-encode to H.264 .mp4 so the clip opens in QuickTime; keep the .webm only if ffmpeg is missing.
  let saved = file;
  try {
    const mp4 = file.replace(/\.webm$/, '.mp4');
    const even = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      file,
      '-vf',
      even,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      '-movflags',
      '+faststart',
      '-an',
      mp4,
    ]);
    rmSync(file);
    saved = mp4;
  } catch (error) {
    console.warn(`ffmpeg re-encode failed, kept ${file}: ${String(error).split('\n')[0]}`);
  }
  console.log(`${saved} ${JSON.stringify(stats)}`);
}
await browser.close();
