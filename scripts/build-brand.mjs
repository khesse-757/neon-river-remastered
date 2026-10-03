#!/usr/bin/env node
// Builds the icons and share images from the pixel painting and the game's fonts.
//   node scripts/build-brand.mjs
// Writes public/icons/*, public/og.png (1200x630) and docs/media/social-preview.png (1280x640).
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Inlined as data URIs: a page made with setContent may not load file:// resources.
const file = (p, type = 'font/ttf') => `data:${type};base64,${readFileSync(p).toString('base64')}`;
const BG = file('public/assets/scene/216x387/bg.png', 'image/png');
const FONTS = `
  @font-face { font-family: 'Silkscreen'; src: url('${file('public/fonts/Silkscreen-Regular.ttf')}'); }
  @font-face { font-family: 'DotGothic16'; src: url('${file('public/fonts/DotGothic16-Latin.ttf')}'); }
  * { margin: 0; box-sizing: border-box; }
  body { background: #030911; overflow: hidden; }
  .art { position: absolute; background: url('${BG}') no-repeat; image-rendering: pixelated; }
`;

// A square crop of the painting: the skyline, the moon and the river's S-bend. `inset` shrinks the
// crop inside the icon so a maskable icon keeps the bend within the safe zone.
const icon = (size, { x = 30, y = 0, crop = 156, inset = 0 } = {}) => {
  const k = (size * (1 - inset * 2)) / crop;
  const span = size / k;
  const ox = x - (span - crop) / 2;
  const oy = Math.max(0, y - (span - crop) / 2);
  return {
    width: size,
    height: size,
    html: `<style>${FONTS}</style><div class="art" style="inset:0;background-size:${216 * k}px ${387 * k}px;background-position:${-ox * k}px ${-oy * k}px"></div>`,
  };
};

// A landscape band of the painting at 6x with the logo on a dark strip, like the title screen.
const card = (width, height) => {
  const k = 6;
  return {
    width,
    height,
    html: `<style>${FONTS}
      .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(3,9,17,0) 35%, rgba(3,9,17,0.88) 72%); }
      .logo { position: absolute; left: 0; right: 0; bottom: 132px; text-align: center; font: 144px 'DotGothic16'; letter-spacing: 12px;
        color: #7df2e4; text-shadow: 6px 6px 0 #030911, 0 0 36px rgba(60, 220, 210, 0.55); }
      .tag { position: absolute; left: 0; right: 0; bottom: 60px; text-align: center; font: 36px 'Silkscreen'; letter-spacing: 6px; color: #f4d27a;
        text-shadow: 3px 3px 0 #030911; }
    </style>
    <div class="art" style="inset:0;background-size:${216 * k}px ${387 * k}px;background-position:${(width - 216 * k) / 2}px 0"></div>
    <div class="shade"></div>
    <div class="logo">NEON RIVER</div>
    <div class="tag">CATCH 200 LB - DODGE THE EELS</div>`,
  };
};

const OUTPUTS = {
  'public/icons/icon-192.png': icon(192),
  'public/icons/icon-512.png': icon(512),
  'public/icons/icon-maskable-192.png': icon(192, { inset: 0.1 }),
  'public/icons/icon-maskable-512.png': icon(512, { inset: 0.1 }),
  'public/icons/apple-touch-icon.png': icon(180),
  'public/icons/favicon-32.png': icon(32, { x: 60, y: 40, crop: 96 }),
  'public/icons/favicon-48.png': icon(48, { x: 60, y: 40, crop: 96 }),
  'public/og.png': card(1200, 630),
  'docs/media/social-preview.png': card(1280, 640),
};

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ channel: 'chromium' });
for (const [path, { width, height, html }] of Object.entries(OUTPUTS)) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path });
  await page.close();
  console.log(path);
}
await browser.close();
