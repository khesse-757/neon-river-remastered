/**
 * Pinhole camera matched to the painting. Pure maths: the water is the plane y = 0, the camera
 * sits `height` above the origin looking along +z, pitched down so the horizon lands on
 * `horizonY`. Screen coordinates are source-painting pixels (768x1376).
 */
export interface CameraSpec {
  /** Focal length in painting pixels. */
  readonly focal: number;
  readonly horizonY: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly height: number;
}

export interface Projected {
  x: number;
  y: number;
  /** Painting pixels per world unit at that depth. */
  scale: number;
}

export interface PaintingCamera {
  readonly spec: CameraSpec;
  readonly pitch: number;
  project(worldX: number, worldZ: number): Projected;
  unproject(screenX: number, screenY: number): { x: number; z: number };
}

export function createCamera(spec: CameraSpec): PaintingCamera {
  const pitch = Math.atan2(spec.centerY - spec.horizonY, spec.focal);
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const h = spec.height;
  return {
    spec,
    pitch,
    project(worldX, worldZ) {
      const yc = -h * cos + worldZ * sin;
      const zc = h * sin + worldZ * cos;
      const scale = spec.focal / zc;
      return { x: spec.centerX + worldX * scale, y: spec.centerY - yc * scale, scale };
    },
    unproject(screenX, screenY) {
      const t = (spec.centerY - screenY) / spec.focal;
      const z = (h * (cos + t * sin)) / (sin - t * cos);
      const zc = h * sin + z * cos;
      return { x: ((screenX - spec.centerX) * zc) / spec.focal, z };
    },
  };
}
