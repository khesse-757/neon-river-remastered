import * as THREE from 'three';
import paletteHex from '../data/palette.json';
import { FISH_COLORS, FISH_SPRITES, LANTERN, LANTERN_COLORS, type SpriteGrid } from '../data/sprites';
import type { FishKind } from '../sim/config';

export type Rgb = readonly [number, number, number];

export const hexToRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
export const PALETTE: readonly Rgb[] = (paletteHex as string[]).map(hexToRgb);

/** Nearest palette color, as 0..1 floats, for effects authored in code. */
export function paletteColor(hex: string): THREE.Vector3 {
  const [r, g, b] = hexToRgb(hex);
  let best: Rgb = PALETTE[0] ?? [0, 0, 0];
  let bestD = Infinity;
  for (const p of PALETTE) {
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return new THREE.Vector3(best[0] / 255, best[1] / 255, best[2] / 255);
}

export interface AtlasRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SceneAssets {
  readonly gridW: number;
  readonly gridH: number;
  readonly bg: THREE.Texture;
  readonly maskA: THREE.Texture;
  readonly maskB: THREE.Texture;
  /** 1 where a grid texel is water. */
  readonly water: Uint8Array;
  readonly fisherman: THREE.Texture;
  readonly fishermanRect: AtlasRect;
  readonly atlas: THREE.DataTexture;
  readonly fishRects: Readonly<Record<FishKind, readonly AtlasRect[]>>;
  readonly lantern: THREE.DataTexture;
  readonly paletteTexture: THREE.DataTexture;
  readonly lut: THREE.Data3DTexture;
}

function pixelTexture<T extends THREE.Texture>(texture: T): T {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function gridToRgba(grid: SpriteGrid, colors: readonly string[], glowOutline?: string): Uint8Array {
  const data = new Uint8Array(grid.width * grid.height * 4);
  for (let i = 0; i < grid.cells.length; i++) {
    const index = grid.cells[i] ?? 0;
    if (index === 0) continue;
    const [r, g, b] = hexToRgb(colors[index] ?? '#ff00ff');
    // Alpha 128 marks the outline, which fish under the surface trade for a soft shadow.
    // The eel's outline instead glows: it is drawn in electric teal at full strength.
    if (index === 1 && glowOutline) data.set([...hexToRgb(glowOutline), 255], i * 4);
    else data.set([r, g, b, index === 1 ? 128 : 255], i * 4);
  }
  return data;
}

function buildFishAtlas(): { atlas: THREE.DataTexture; rects: Record<FishKind, AtlasRect[]> } {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const rects: Record<FishKind, AtlasRect[]> = { bluegill: [], koi: [], eel: [] };
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const kind of Object.keys(FISH_SPRITES) as FishKind[]) {
    for (const grid of FISH_SPRITES[kind]) {
      if (x + grid.width > size) {
        x = 0;
        y += rowH + 1;
        rowH = 0;
      }
      const rgba = gridToRgba(grid, FISH_COLORS[kind], kind === 'eel' ? '#29bcc2' : undefined);
      for (let row = 0; row < grid.height; row++)
        data.set(rgba.subarray(row * grid.width * 4, (row + 1) * grid.width * 4), ((y + row) * size + x) * 4);
      rects[kind].push({ x, y, width: grid.width, height: grid.height });
      x += grid.width + 1;
      rowH = Math.max(rowH, grid.height);
    }
  }
  return { atlas: pixelTexture(new THREE.DataTexture(data, size, size, THREE.RGBAFormat)), rects };
}

function buildLut(): { lut: THREE.Data3DTexture; paletteTexture: THREE.DataTexture } {
  const N = 64;
  const data = new Uint8Array(N * N * N * 4);
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++) {
        const cr = (r * 255) / (N - 1);
        const cg = (g * 255) / (N - 1);
        const cb = (b * 255) / (N - 1);
        let i1 = 0;
        let i2 = 0;
        let d1 = Infinity;
        let d2 = Infinity;
        for (let i = 0; i < PALETTE.length; i++) {
          const p = PALETTE[i] as Rgb;
          const d = (p[0] - cr) ** 2 + (p[1] - cg) ** 2 + (p[2] - cb) ** 2;
          if (d < d1) {
            d2 = d1;
            i2 = i1;
            d1 = d;
            i1 = i;
          } else if (d < d2) {
            d2 = d;
            i2 = i;
          }
        }
        data.set([i1, i2, 0, 255], (b * N * N + g * N + r) * 4);
      }
  const lut = new THREE.Data3DTexture(data, N, N, N);
  lut.format = THREE.RGBAFormat;
  lut.magFilter = THREE.NearestFilter;
  lut.minFilter = THREE.NearestFilter;
  lut.unpackAlignment = 1;
  lut.needsUpdate = true;

  const pal = new Uint8Array(PALETTE.length * 4);
  PALETTE.forEach((p, i) => pal.set([p[0], p[1], p[2], 255], i * 4));
  return { lut, paletteTexture: pixelTexture(new THREE.DataTexture(pal, PALETTE.length, 1, THREE.RGBAFormat)) };
}

export async function loadSceneAssets(gridW: number, gridH: number): Promise<SceneAssets> {
  const base = `${import.meta.env.BASE_URL}assets/scene/${gridW}x${gridH}/`;
  const [bg, maskA, maskB, fisherman, meta] = await Promise.all([
    loadImage(`${base}bg.png`),
    loadImage(`${base}masks-a.png`),
    loadImage(`${base}masks-b.png`),
    loadImage(`${base}fisherman.png`),
    fetch(`${base}meta.json`).then((r) => r.json() as Promise<{ fisherman: AtlasRect }>),
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

  const { atlas, rects } = buildFishAtlas();
  const { lut, paletteTexture } = buildLut();
  return {
    gridW,
    gridH,
    bg: pixelTexture(new THREE.Texture(bg)),
    maskA: pixelTexture(new THREE.Texture(maskA)),
    maskB: pixelTexture(new THREE.Texture(maskB)),
    water,
    fisherman: pixelTexture(new THREE.Texture(fisherman)),
    fishermanRect: meta.fisherman,
    atlas,
    fishRects: rects,
    lantern: pixelTexture(new THREE.DataTexture(gridToRgba(LANTERN, LANTERN_COLORS), LANTERN.width, LANTERN.height, THREE.RGBAFormat)),
    paletteTexture,
    lut,
  };
}
