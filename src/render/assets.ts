import * as THREE from 'three';
import paletteHex from '../data/palette.json';
import type { River } from '../sim/river';

export type Rgb = readonly [number, number, number];

export const hexToRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
export const PALETTE: readonly Rgb[] = (paletteHex as string[]).map(hexToRgb);

/** A palette-family color in linear working space, for materials and lights. */
export const color = (hex: string): THREE.Color => new THREE.Color(hex);

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SceneAssets {
  readonly gridW: number;
  readonly gridH: number;
  /** The painting, sRGB, nearest. Row 0 is the top. */
  readonly bg: THREE.Texture;
  readonly maskA: THREE.Texture; // r water, g reeds, b canopy
  readonly maskB: THREE.Texture; // r far layer (sky + skyline), g neon, b bridge
  /** r: distance to the bank (0 at the edge, 1 deep), g/b: flow direction on screen. Linear filtered. */
  readonly field: THREE.DataTexture;
  /** Tiling smooth noise (two channels) for flow normals. */
  readonly noise: THREE.DataTexture;
  readonly fisherman: THREE.Texture;
  readonly fishermanRect: Rect;
  /** 32^3 grade LUT: each cell holds its nearest palette color (sRGB). */
  readonly lut: THREE.Data3DTexture;
  /** Four-step toon ramp. */
  readonly ramp: THREE.DataTexture;
}

function pixelTexture<T extends THREE.Texture>(texture: T, srgb: boolean): T {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function buildLut(): THREE.Data3DTexture {
  const N = 32;
  const data = new Uint8Array(N * N * N * 4);
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++) {
        const c = [(r * 255) / (N - 1), (g * 255) / (N - 1), (b * 255) / (N - 1)];
        let best: Rgb = PALETTE[0] as Rgb;
        let bestD = Infinity;
        for (const p of PALETTE) {
          const d = (p[0] - (c[0] ?? 0)) ** 2 + (p[1] - (c[1] ?? 0)) ** 2 + (p[2] - (c[2] ?? 0)) ** 2;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        data.set([best[0], best[1], best[2], 255], (b * N * N + g * N + r) * 4);
      }
  const lut = new THREE.Data3DTexture(data, N, N, N);
  lut.format = THREE.RGBAFormat;
  lut.magFilter = THREE.LinearFilter;
  lut.minFilter = THREE.LinearFilter;
  lut.unpackAlignment = 1;
  lut.needsUpdate = true;
  return lut;
}

function buildNoise(): THREE.DataTexture {
  const size = 128;
  const cells = 16;
  // Deterministic lattice noise that tiles; two decorrelated channels.
  const lattice = (seed: number): Float32Array => {
    const values = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < values.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      values[i] = s / 4294967296;
    }
    return values;
  };
  const sample = (values: Float32Array, x: number, y: number): number => {
    const fx = (x / size) * cells;
    const fy = (y / size) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const at = (ix: number, iy: number): number => values[(iy % cells) * cells + (ix % cells)] ?? 0;
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const a = lattice(757);
  const b = lattice(4242);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data.set([sample(a, x, y) * 255, sample(b, x, y) * 255, 0, 255], (y * size + x) * 4);
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Bank distance and on-screen flow direction for every water texel of the painting. */
function buildField(water: Uint8Array, gridW: number, gridH: number, river: River): THREE.DataTexture {
  const MAX = 14;
  const dist = new Float32Array(gridW * gridH).fill(MAX);
  // Two-pass chamfer distance to the nearest non-water texel.
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= gridW || y >= gridH ? 0 : (dist[y * gridW + x] ?? 0));
  for (let i = 0; i < dist.length; i++) if (!water[i]) dist[i] = 0;
  for (let y = 0; y < gridH; y++)
    for (let x = 0; x < gridW; x++) {
      const i = y * gridW + x;
      dist[i] = Math.min(dist[i] ?? 0, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4);
    }
  for (let y = gridH - 1; y >= 0; y--)
    for (let x = gridW - 1; x >= 0; x--) {
      const i = y * gridW + x;
      dist[i] = Math.min(dist[i] ?? 0, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
    }

  const k = gridW / 768;
  const samples: { x: number; y: number; tx: number; ty: number }[] = [];
  for (let i = 0; i <= 300; i++) {
    const s = (i / 300) * river.maxS;
    const p = river.screenAt(s, 0.5);
    const t = river.screenTangent(s, 0.5);
    samples.push({ x: p.x * k, y: p.y * k, tx: t.x, ty: t.y });
  }
  const data = new Uint8Array(gridW * gridH * 4);
  for (let y = 0; y < gridH; y++)
    for (let x = 0; x < gridW; x++) {
      const i = y * gridW + x;
      let tx = 0;
      let ty = 1;
      if (water[i]) {
        let best = Infinity;
        for (const p of samples) {
          const d = (p.x - x) ** 2 + (p.y - y) ** 2;
          if (d < best) {
            best = d;
            tx = p.tx;
            ty = p.ty;
          }
        }
      }
      data.set([Math.min(255, ((dist[i] ?? 0) / MAX) * 255), tx * 127 + 128, ty * 127 + 128, 255], i * 4);
    }
  const texture = new THREE.DataTexture(data, gridW, gridH, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function buildRamp(): THREE.DataTexture {
  const data = new Uint8Array([70, 70, 70, 255, 130, 130, 130, 255, 200, 200, 200, 255, 255, 255, 255, 255]);
  const ramp = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  ramp.magFilter = THREE.NearestFilter;
  ramp.minFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

export async function loadSceneAssets(gridW: number, gridH: number, river: River): Promise<SceneAssets> {
  const base = `${import.meta.env.BASE_URL}assets/scene/${gridW}x${gridH}/`;
  const [bg, maskA, maskB, fisherman, meta] = await Promise.all([
    loadImage(`${base}bg.png`),
    loadImage(`${base}masks-a.png`),
    loadImage(`${base}masks-b.png`),
    loadImage(`${base}fisherman.png`),
    fetch(`${base}meta.json`).then((r) => r.json() as Promise<{ fisherman: Rect }>),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = gridW;
  canvas.height = gridH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not read the water mask.');
  ctx.drawImage(maskA, 0, 0);
  const pixels = ctx.getImageData(0, 0, gridW, gridH).data;
  const water = new Uint8Array(gridW * gridH);
  for (let i = 0; i < water.length; i++) water[i] = (pixels[i * 4] ?? 0) > 127 ? 1 : 0;

  return {
    gridW,
    gridH,
    bg: pixelTexture(new THREE.Texture(bg), true),
    maskA: pixelTexture(new THREE.Texture(maskA), false),
    maskB: pixelTexture(new THREE.Texture(maskB), false),
    field: buildField(water, gridW, gridH, river),
    noise: buildNoise(),
    fisherman: pixelTexture(new THREE.Texture(fisherman), true),
    fishermanRect: meta.fisherman,
    lut: buildLut(),
    ramp: buildRamp(),
  };
}

/** Small pixel-art texture drawn with canvas calls, nearest filtered, for 3D props. */
export function pixelArt(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  repeat = false,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable.');
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}
