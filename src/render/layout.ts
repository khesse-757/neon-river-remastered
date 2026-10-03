/**
 * One pixel grid: the painting keeps its grid size and is upscaled by a whole number. The low-res
 * target is sized to the viewport so the leftover space becomes gutters, not black bars.
 */
export interface Layout {
  /** Device pixels per target texel (integer). */
  readonly scale: number;
  readonly canvasW: number;
  readonly canvasH: number;
  readonly targetW: number;
  readonly targetH: number;
  /** Top-left of the painting inside the target, in texels (y down). */
  readonly originX: number;
  readonly originY: number;
  readonly gridW: number;
  readonly gridH: number;
}

export function computeLayout(deviceW: number, deviceH: number, gridW: number, gridH: number): Layout {
  let scale = Math.max(1, Math.floor(Math.min(deviceW / gridW, deviceH / gridH)));
  // One step larger is worth a small crop of sky and cobbles when at least 90% of the height
  // still shows. The width is never cropped: the river uses all of it.
  if ((scale + 1) * gridW <= deviceW && deviceH / (scale + 1) >= gridH * 0.9) scale += 1;
  const targetW = Math.ceil(deviceW / scale);
  const targetH = Math.ceil(deviceH / scale);
  const extraY = targetH - gridH;
  return {
    scale,
    canvasW: deviceW,
    canvasH: deviceH,
    targetW,
    targetH,
    originX: Math.floor((targetW - gridW) / 2),
    // Leave most of the spare height below the painting, where thumbs and the HUD live.
    // When cropping, trim a third from the sky and the rest from the cobbles.
    originY: extraY > 0 ? Math.floor(extraY * 0.3) : Math.ceil(extraY / 3),
    gridW,
    gridH,
  };
}
