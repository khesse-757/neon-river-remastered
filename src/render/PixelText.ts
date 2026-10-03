import * as THREE from 'three';

export const PIXEL_FONT = 'Silkscreen';
/** 16 px bitmap-style face with one-texel strokes, for the logo and screen titles. */
export const TITLE_FONT = 'DotGothic16';

let scratch: HTMLCanvasElement | null = null;

export interface TextBitmap {
  readonly texture: THREE.DataTexture;
  readonly width: number;
  readonly height: number;
}

/**
 * Rasterises a string in a pixel font at its native size (8 px body, 16 px titles) and thresholds it, so every
 * glyph pixel is exactly one target texel.
 */
export function rasterizeText(text: string, color: readonly [number, number, number], title = false): TextBitmap {
  scratch ??= document.createElement('canvas');
  const height = title ? 18 : 8;
  const font = title ? `16px ${TITLE_FONT}` : `8px ${PIXEL_FONT}`;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D context unavailable for text.');
  ctx.font = font;
  const width = Math.max(1, Math.ceil(ctx.measureText(text).width));
  scratch.width = width;
  scratch.height = height;
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.clearRect(0, 0, width, height);
  ctx.fillText(text, 0, title ? 14 : 6);
  const src = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if ((src[i * 4 + 3] ?? 0) > 110) data.set([color[0], color[1], color[2], 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return { texture, width, height };
}
