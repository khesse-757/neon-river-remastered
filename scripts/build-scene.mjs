#!/usr/bin/env node
// Builds the pixel-grid scene assets from the v1 painting. Regenerable; outputs are committed.
//   node scripts/build-scene.mjs
// Writes public/assets/scene/<W>x<H>/{bg,masks-a,masks-b,fisherman}.png + meta.json,
// src/data/palette.json, and debug overlays in artifacts/scene-debug/ (inspect these).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const SRC_W = 768;
const SRC_H = 1376;
const GRIDS = [
  [192, 344],
  [216, 387],
  [256, 459],
  [384, 688],
];
const PALETTE_GRID = [216, 387];
const KMEANS_COLORS = 32;
const FISHERMAN_COLORS = 6;

// Reserved slots: accents the painting's clusters would average away, plus sprite and light colors.
const RESERVED = [
  '#ff9933',
  '#cc6600',
  '#ffcc66',
  '#ffeecc', // koi
  '#00ffff',
  '#8ff8ff',
  '#ffffff', // eel glow, sparks
  '#ffb347',
  '#ffd98a', // lantern amber
  '#0a0a1a', // deepest outline
];

// v1 drew the fisherman at natural size, bottom-centre anchored at (0.8 W, 0.995 H).
const FISHERMAN_SRC = { x: 276, y: 1000 };

const read = (p) => PNG.sync.read(readFileSync(p));
const masks = JSON.parse(readFileSync('scripts/masks.json', 'utf8'));
const bg = read('public/assets/original/background.png');
const fisherman = read('public/assets/original/fisherman.png');

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const srcPx = (x, y) => {
  const i = (y * SRC_W + x) * 4;
  return [bg.data[i], bg.data[i + 1], bg.data[i + 2]];
};
const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- palette: saturation-weighted k-means over the box-downsampled painting -------------
function boxDownsample(w, h) {
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * SRC_H) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * SRC_H) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * SRC_W) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * SRC_W) / w));
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const p = srcPx(xx, yy);
          r += p[0];
          g += p[1];
          b += p[2];
          n++;
        }
      out.set([r / n, g / n, b / n], (y * w + x) * 3);
    }
  }
  return out;
}

function kmeans(points, weights, k, rand) {
  const n = points.length / 3;
  const d2 = (i, c) => (points[i * 3] - c[0]) ** 2 + (points[i * 3 + 1] - c[1]) ** 2 + (points[i * 3 + 2] - c[2]) ** 2;
  const centers = [];
  const first = Math.floor(rand() * n);
  centers.push([points[first * 3], points[first * 3 + 1], points[first * 3 + 2]]);
  const best = new Float64Array(n).fill(Infinity);
  while (centers.length < k) {
    let total = 0;
    const c = centers[centers.length - 1];
    for (let i = 0; i < n; i++) {
      best[i] = Math.min(best[i], d2(i, c));
      total += best[i] * weights[i];
    }
    let pick = rand() * total;
    let idx = 0;
    for (; idx < n - 1; idx++) {
      pick -= best[idx] * weights[idx];
      if (pick <= 0) break;
    }
    centers.push([points[idx * 3], points[idx * 3 + 1], points[idx * 3 + 2]]);
  }
  for (let iter = 0; iter < 24; iter++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0,
        bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = d2(i, centers[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      const w = weights[i];
      sum[bi][0] += points[i * 3] * w;
      sum[bi][1] += points[i * 3 + 1] * w;
      sum[bi][2] += points[i * 3 + 2] * w;
      sum[bi][3] += w;
    }
    for (let c = 0; c < k; c++) if (sum[c][3] > 0) centers[c] = [sum[c][0] / sum[c][3], sum[c][1] / sum[c][3], sum[c][2] / sum[c][3]];
  }
  return centers;
}

const palPoints = boxDownsample(...PALETTE_GRID);
const palWeights = new Float32Array(palPoints.length / 3);
for (let i = 0; i < palWeights.length; i++) {
  const s = sat(palPoints[i * 3], palPoints[i * 3 + 1], palPoints[i * 3 + 2]);
  palWeights[i] = 1 + (s / 255) ** 2 * 14; // keep the neon accents
}
const clustered = kmeans(palPoints, palWeights, KMEANS_COLORS, mulberry32(757));
// The fisherman is a separate image, so his straw hat and robe get their own few slots.
const manPoints = [];
for (let i = 0; i < fisherman.data.length; i += 4)
  if (fisherman.data[i + 3] > 200 && (i / 4) % 3 === 0) manPoints.push(fisherman.data[i], fisherman.data[i + 1], fisherman.data[i + 2]);
const manColors = kmeans(Float32Array.from(manPoints), new Float32Array(manPoints.length / 3).fill(1), FISHERMAN_COLORS, mulberry32(11));
const luma = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const palette = [
  ...clustered.map((c) => c.map(Math.round)).sort((a, b) => luma(a) - luma(b)),
  ...manColors.map((c) => c.map(Math.round)).sort((a, b) => luma(a) - luma(b)),
  ...RESERVED.map(hexToRgb),
];
const nearest = (r, g, b) => {
  let bi = 0,
    bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
};

// ---- source-resolution masks ---------------------------------------------------------------
const inPoly = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const mask = () => new Uint8Array(SRC_W * SRC_H);
const M = { water: mask(), reeds: mask(), canopy: mask(), sky: mask(), neon: mask(), bridge: mask() };
for (let y = 0; y < SRC_H; y++) {
  for (let x = 0; x < SRC_W; x++) {
    const i = y * SRC_W + x;
    const [r, g, b] = srcPx(x, y);
    const px = x + 0.5,
      py = y + 0.5;
    const blueish = b > g + 4 && b > r + 10;
    const inWaterPoly = inPoly(masks.water, px, py);
    const inReedBox = masks.reedBoxes.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
    // Reeds: stalks, leaves and cattail heads (warm or green) standing in or beside the water.
    const reedish = (g > b + 6 || r > b + 12) && !blueish;
    if (inReedBox && reedish) M.reeds[i] = 1;
    if (inWaterPoly && !(inReedBox && reedish)) M.water[i] = 1;
    if (masks.canopyEllipses.some(([cx, cy, rx, ry]) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 < 1) && g > r && g > b - 4)
      M.canopy[i] = 1;
    if (inPoly(masks.sky, px, py) && luma([r, g, b]) < 120 && sat(r, g, b) < 90) M.sky[i] = 1;
    const [cx0, cy0, cx1, cy1] = masks.city;
    if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1 && Math.max(r, g, b) > 150 && sat(r, g, b) > 70 && !(g > r && g > b)) M.neon[i] = 1;
    if (inPoly(masks.bridge, px, py)) M.bridge[i] = 1;
  }
}

// ---- per-grid outputs ------------------------------------------------------------------------
const writePng = (path, w, h, fill) => {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) png.data.set(fill(x, y), (y * w + x) * 4);
  writeFileSync(path, PNG.sync.write(png));
};

// Mode of palette indices over a cell, centre-weighted so each painted "pixel" keeps a crisp color.
function cellIndex(w, h, x, y, sample) {
  const x0 = (x * SRC_W) / w,
    x1 = ((x + 1) * SRC_W) / w;
  const y0 = (y * SRC_H) / h,
    y1 = ((y + 1) * SRC_H) / h;
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2;
  const votes = new Map();
  let solid = 0,
    total = 0;
  for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
    for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
      const p = sample(xx, yy);
      total++;
      if (!p) continue;
      solid++;
      const wgt = 1 / (1 + Math.abs(xx + 0.5 - cx) + Math.abs(yy + 0.5 - cy));
      const idx = nearest(p[0], p[1], p[2]);
      votes.set(idx, (votes.get(idx) ?? 0) + wgt);
    }
  if (solid * 2 < total) return -1;
  let bi = 0,
    bv = -1;
  for (const [idx, v] of votes)
    if (v > bv) {
      bv = v;
      bi = idx;
    }
  return bi;
}
const coverage = (m, w, h, x, y) => {
  const x0 = Math.floor((x * SRC_W) / w),
    x1 = Math.max(x0 + 1, Math.floor(((x + 1) * SRC_W) / w));
  const y0 = Math.floor((y * SRC_H) / h),
    y1 = Math.max(y0 + 1, Math.floor(((y + 1) * SRC_H) / h));
  let s = 0,
    n = 0;
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) {
      s += m[yy * SRC_W + xx];
      n++;
    }
  return s / n;
};

mkdirSync('artifacts/scene-debug', { recursive: true });
mkdirSync('src/data', { recursive: true });
writeFileSync('src/data/palette.json', JSON.stringify(palette.map(rgbToHex)) + '\n');

for (const [w, h] of GRIDS) {
  const dir = `public/assets/scene/${w}x${h}`;
  mkdirSync(dir, { recursive: true });
  const idx = new Int16Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) idx[y * w + x] = cellIndex(w, h, x, y, srcPx);
  writePng(`${dir}/bg.png`, w, h, (x, y) => [...palette[idx[y * w + x]], 255]);

  const cov = {};
  for (const k of Object.keys(M)) {
    cov[k] = new Uint8Array(w * h);
    // Thin features (reeds, neon) survive at a lower coverage threshold.
    const thr = k === 'reeds' || k === 'neon' ? 0.3 : 0.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cov[k][y * w + x] = coverage(M[k], w, h, x, y) >= thr ? 255 : 0;
  }
  for (let i = 0; i < w * h; i++) if (cov.reeds[i]) cov.water[i] = 0;
  writePng(`${dir}/masks-a.png`, w, h, (x, y) => [cov.water[y * w + x], cov.reeds[y * w + x], cov.canopy[y * w + x], 255]);
  writePng(`${dir}/masks-b.png`, w, h, (x, y) => [cov.sky[y * w + x], cov.neon[y * w + x], cov.bridge[y * w + x], 255]);

  // Fisherman on the same grid: cells are aligned to the painting's, then cropped to his bounds.
  const fSample = (xx, yy) => {
    const fx = xx - FISHERMAN_SRC.x,
      fy = yy - FISHERMAN_SRC.y;
    if (fx < 0 || fy < 0 || fx >= fisherman.width || fy >= fisherman.height) return null;
    const i = (fy * fisherman.width + fx) * 4;
    return fisherman.data[i + 3] > 128 ? [fisherman.data[i], fisherman.data[i + 1], fisherman.data[i + 2]] : null;
  };
  // He overhangs the painting's bottom edge slightly, so sample past it.
  const fh = h + 4;
  const fIdx = new Int16Array(w * fh).fill(-1);
  let bx0 = w,
    by0 = fh,
    bx1 = 0,
    by1 = 0;
  for (let y = 0; y < fh; y++)
    for (let x = 0; x < w; x++) {
      const v = cellIndex(w, h, x, y, fSample);
      fIdx[y * w + x] = v;
      if (v >= 0) {
        bx0 = Math.min(bx0, x);
        by0 = Math.min(by0, y);
        bx1 = Math.max(bx1, x);
        by1 = Math.max(by1, y);
      }
    }
  by1 = Math.min(by1, h - 1);
  const fw = bx1 - bx0 + 1,
    fhh = by1 - by0 + 1;
  writePng(`${dir}/fisherman.png`, fw, fhh, (x, y) => {
    const v = fIdx[(y + by0) * w + x + bx0];
    return v < 0 ? [0, 0, 0, 0] : [...palette[v], 255];
  });
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ width: w, height: h, fisherman: { x: bx0, y: by0, width: fw, height: fhh } }) + '\n');

  // Debug overlays: every mask tinted over the re-quantized painting at 3x.
  const tints = {
    water: [255, 0, 255],
    reeds: [255, 255, 0],
    canopy: [255, 128, 0],
    sky: [0, 255, 255],
    neon: [255, 255, 255],
    bridge: [255, 0, 0],
  };
  const S = 3;
  writePng(`artifacts/scene-debug/${w}x${h}-masks.png`, w * S, h * S, (X, Y) => {
    const x = Math.floor(X / S),
      y = Math.floor(Y / S);
    let c = palette[idx[y * w + x]];
    for (const k of Object.keys(tints)) if (cov[k][y * w + x]) c = c.map((v, j) => v * 0.45 + tints[k][j] * 0.55);
    const f = y < fh ? fIdx[y * w + x] : -1;
    if (f >= 0) c = palette[f];
    return [...c, 255];
  });
  writePng(`artifacts/scene-debug/${w}x${h}-bg.png`, w * S, h * S, (X, Y) => [
    ...palette[idx[Math.floor(Y / S) * w + Math.floor(X / S)]],
    255,
  ]);
  console.log(`${w}x${h}: bg, masks, fisherman ${fw}x${fhh} @ ${bx0},${by0}`);
}
writePng('artifacts/scene-debug/palette.png', palette.length * 16, 16, (x) => [...palette[Math.floor(x / 16)], 255]);
console.log(`palette: ${palette.length} colors -> src/data/palette.json`);
