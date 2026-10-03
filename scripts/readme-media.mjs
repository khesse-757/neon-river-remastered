#!/usr/bin/env node
// README media from the production build (run `npm run build && npm run preview` first; needs ffmpeg and gifsicle).
//   node scripts/readme-media.mjs [--only shots|hero] [--url http://127.0.0.1:4188]
// Writes docs/media/readme/: hero.gif (a bot-played stretch of a Normal night around the second
// speed-up), the phone screenshots, and v1-vs-v2.png.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []),
);
const url = args.url ?? 'http://127.0.0.1:4188';
const out = 'docs/media/readme';
mkdirSync(out, { recursive: true });
const ffmpeg = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a]);
// Quantize to a 256-color palette: about a third of the size, and the picture is pixel art.
const compress = (file) => {
  const tmp = file.replace(/\.png$/, '.tmp.png');
  ffmpeg('-i', file, '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=single[p];[b][p]paletteuse=dither=none', tmp);
  ffmpeg('-i', tmp, '-compression_level', '100', '-pred', 'mixed', file);
  rmSync(tmp);
};
const title = (page) => page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.mode === 'title', null, { timeout: 20000 });

const browser = await chromium.launch({ channel: 'chromium' });

if (args.only !== 'hero') {
  // Phone screenshots at 390x844, through the test hooks.
  const SHOTS = {
    'mobile-play': 'phase.neon-rapids',
    win: 'win',
    'field-guide': 'gallery',
    'eel-shock': 'eel-basket',
    modes: 'title',
    'settings-visuals': 'visuals',
  };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  for (const [name, state] of Object.entries(SHOTS)) {
    const page = await context.newPage();
    await page.goto(`${url}/?seed=42`);
    await title(page);
    await page.evaluate(async (state) => {
      const hooks = window.__THREE_GAME_TEST_HOOKS__;
      await hooks.seed(42);
      await hooks.setState(state);
      if (state === 'gallery') hooks.gallery()?.select('koi');
      else await hooks.setPausedForScreenshot(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, state);
    if (state === 'gallery') await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${name}.png`, scale: 'css' });
    await page.close();
    compress(`${out}/${name}.png`);
    console.log(`${out}/${name}.png`);
  }
  await context.close();
  // v1's title screen beside v2's, at the same height.
  ffmpeg(
    '-i',
    'docs/media/v1/v1-title-screenshot.png',
    '-i',
    `${out}/modes.png`,
    '-filter_complex',
    '[0:v]scale=-2:844:flags=lanczos,pad=iw+24:ih:0:0:0x030911[a];[1:v]format=rgb24[b];[a][b]hstack',
    `${out}/v1-vs-v2.png`,
  );
  compress(`${out}/v1-vs-v2.png`);
  console.log(`${out}/v1-vs-v2.png`);
}

if (args.only !== 'shots') {
  // Lossless frames at a tenth of game speed, one per 80 ms of game time (12.5 fps, a whole number of
  // GIF centiseconds): a video codec's noise makes every pixel change every frame and triples the GIF.
  const frames = args.frames ?? mkdtempSync(join(tmpdir(), 'neon-hero-'));
  mkdirSync(frames, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${url}/?seed=42&mode=normal`);
  await title(page);
  await page.locator('#btn-start').click();
  await page.evaluate(() => {
    // Camera drift off: a still painting reads better in a loop, and unchanged pixels cost nothing in a GIF.
    window.__THREE_GAME_TEST_HOOKS__.setVisuals({ drift: false });
    window.__THREE_GAME_TEST_HOOKS__.setAutoplay(true);
    window.__THREE_GAME_TEST_HOOKS__.setTimeScale(4);
  });
  // Seed 42: the second speed-up comes at about 57 s, an S-run follows, and an eel slips past near 66 s.
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__.elapsed >= 56.6, null, { timeout: 120000, polling: 16 });
  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__.setTimeScale(0.1));
  const start = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__.elapsed);
  // The painting at 2 px per texel sits in the middle of a 1440x900 window.
  const clip = { x: 504, y: 36, width: 432, height: 774 };
  const SECONDS = 10;
  const FPS = 12.5;
  for (let i = 0; i < (SECONDS + 1) * FPS; i++) {
    await page.waitForFunction((t) => window.__THREE_GAME_DIAGNOSTICS__.elapsed >= t, start + i / FPS, { polling: 'raf', timeout: 30000 });
    await page.screenshot({ path: join(frames, `f${String(i).padStart(3, '0')}.png`), clip });
  }
  await context.close();
  // Seamless loop: the last second crossfades into the first.
  const loop = join(frames, 'loop.mkv');
  ffmpeg(
    '-framerate',
    String(FPS),
    '-i',
    join(frames, 'f%03d.png'),
    '-filter_complex',
    `[0:v]split=3[m][t][h];[m]trim=1:${SECONDS},setpts=PTS-STARTPTS[main];[t]trim=${SECONDS}:${SECONDS + 1},setpts=PTS-STARTPTS[tail];` +
      '[h]trim=0:1,setpts=PTS-STARTPTS[head];[tail][head]xfade=transition=fade:duration=1:offset=0[x];[main][x]concat=n=2:v=1',
    '-c:v',
    'ffv1',
    loop,
  );
  // The palette: 60 colors for the whole picture, plus colors reserved for the small bright things a
  // frequency count drops (lantern, neon reflections, skyline, basket). Without them the lantern
  // turns pale yellow and the pink reflections vanish. No dither: the painting is flat color.
  const PARTS = [
    ['', 60],
    ['crop=110:100:60:590,', 12],
    ['crop=110:140:190:190,', 10],
    ['crop=432:80:0:0,', 14],
    ['crop=100:90:170:640,', 8],
  ];
  const colors = new Map();
  for (const [crop, count] of PARTS) {
    const part = join(frames, 'part.png');
    ffmpeg('-i', loop, '-vf', `${crop}palettegen=max_colors=${count}:reserve_transparent=0:stats_mode=full`, part);
    const { data } = PNG.sync.read(readFileSync(part));
    for (let i = 0; i < count; i++) colors.set(`${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]}`, data.subarray(i * 4, i * 4 + 3));
  }
  const palette = new PNG({ width: 16, height: 16 });
  const list = [...colors.values()];
  for (let i = 0; i < 256; i++) palette.data.set([...(list[i] ?? list[0]), 255], i * 4);
  writeFileSync(join(frames, 'palette.png'), PNG.sync.write(palette));
  const raw = join(frames, 'hero.gif');
  ffmpeg(
    '-i',
    loop,
    '-i',
    join(frames, 'palette.png'),
    '-lavfi',
    '[0:v][1:v]paletteuse=dither=none:diff_mode=rectangle',
    '-loop',
    '0',
    raw,
  );
  execFileSync('gifsicle', ['-O3', '--lossy=30', raw, '-o', `${out}/hero.gif`]);
  if (!args.frames) rmSync(frames, { recursive: true });
  console.log(`${out}/hero.gif`);
}
await browser.close();
