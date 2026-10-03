import * as THREE from 'three';
import type { FishKind } from '../../sim/config';
import { color } from '../assets';

/**
 * Procedural, toon-lit fish built in code. Each species is one merged geometry (body rings +
 * fins) drawn as an InstancedMesh; the swim is a spine wave in the vertex shader.
 * Model space: +z is the head, -z the tail, +y up, lengths in world units.
 */
export const MAX_FISH = 48;

interface Species {
  readonly length: number;
  readonly rings: number;
  readonly sides: number;
  /** Half-width and half-height of the body at t (0 head .. 1 tail). */
  readonly profile: (t: number) => [number, number];
  /** Surface color at t and around the body (angle 0 = top). */
  readonly paint: (t: number, angle: number) => THREE.Color;
  /** 0..1 self-light at that point (eel stripes). */
  readonly emit: (t: number, angle: number) => number;
  /** `normal` overrides the face normal (an upright fin is lit as if it leaned, so neither side goes black). */
  readonly fins: (
    add: (points: [number, number, number][], t: number[], c: THREE.Color, e?: number, normal?: [number, number, number]) => void,
  ) => void;
  /**
   * Spine wave: number of waves along the body, amplitude as a fraction of length, how much the head moves.
   * Kept small: the head holds its lane, so a chain of fish reads as a curve; only the tail works.
   */
  readonly wave: { k: number; amp: number; head: number };
  readonly glow: THREE.Color;
}

const hash = (a: number, b: number): number => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const BLUEGILL: Species = {
  length: 0.085,
  rings: 14,
  sides: 10,
  profile: (t) => {
    const body = Math.sin(Math.PI * Math.min(1, t * 1.08) ** 0.7) ** 0.85;
    const w = 0.02 * body * (1 - 0.55 * t) + 0.0012;
    return [w, w * 0.8];
  },
  paint: (t, angle) => {
    const top = Math.cos(angle);
    // Blue-green back, paler flanks, a dark ear spot behind the head.
    const c = color('#4f9aa6').lerp(color('#b5ddd6'), THREE.MathUtils.smoothstep(-top, -0.3, 0.6));
    if (t > 0.18 && t < 0.3 && Math.abs(Math.abs(angle) - 1.15) < 0.38) c.copy(color('#0d1c2c'));
    if (t < 0.07) c.lerp(color('#2f6f80'), 0.5);
    return c;
  },
  emit: () => 0,
  fins: (add) => {
    const fin = color('#7cc4c4');
    add(
      [
        [0, 0, -0.04],
        [-0.02, 0.002, -0.058],
        [0, 0.001, -0.05],
      ],
      [0.95, 1, 1],
      fin,
    );
    add(
      [
        [0, 0, -0.04],
        [0.02, 0.002, -0.058],
        [0, 0.001, -0.05],
      ],
      [0.95, 1, 1],
      fin,
    );
    add(
      [
        [-0.017, 0, 0.014],
        [-0.034, -0.002, 0.0],
        [-0.017, 0, -0.002],
      ],
      [0.3, 0.42, 0.4],
      fin,
    );
    add(
      [
        [0.017, 0, 0.014],
        [0.034, -0.002, 0.0],
        [0.017, 0, -0.002],
      ],
      [0.3, 0.42, 0.4],
      fin,
    );
    // The dorsal fin stands upright, so it is two faces a hair apart, each lit from above on its own side.
    const dorsal = color('#377a88');
    add(
      [
        [-0.0004, 0.016, 0.012],
        [-0.0004, 0.026, -0.012],
        [-0.0004, 0.011, -0.03],
      ],
      [0.3, 0.55, 0.8],
      dorsal,
      0,
      [-0.45, 0.89, 0],
    );
    add(
      [
        [0.0004, 0.016, 0.012],
        [0.0004, 0.011, -0.03],
        [0.0004, 0.026, -0.012],
      ],
      [0.3, 0.8, 0.55],
      dorsal,
      0,
      [0.45, 0.89, 0],
    );
  },
  wave: { k: 5.5, amp: 0.055, head: 0.04 },
  glow: color('#000000'),
};

const KOI: Species = {
  length: 0.125,
  rings: 18,
  sides: 10,
  profile: (t) => {
    const body = Math.sin(Math.PI * Math.min(1, t * 1.05) ** 0.6) ** 0.8;
    const w = 0.0165 * body * (1 - 0.5 * t) + 0.0012;
    return [w, w * 0.85];
  },
  paint: (t, angle) => {
    // White body with gold and orange patches: the classic kohaku read from above.
    const patch = hash(Math.floor(t * 5.5), Math.floor((angle + Math.PI) * 1.2));
    const c = patch > 0.42 ? color('#f08a24') : color('#f3ead8');
    if (patch > 0.8) c.copy(color('#ffc24a'));
    if (t < 0.1) c.copy(color('#f59a2e'));
    return c.lerp(color('#fff3da'), Math.max(0, -Math.cos(angle)) * 0.25);
  },
  emit: (t, angle) => (hash(Math.floor(t * 9), Math.floor(angle * 2)) > 0.9 ? 0.6 : 0),
  fins: (add) => {
    const fin = color('#ffd98a');
    // Long, flowing tail lobes and wide pectorals.
    add(
      [
        [0, 0, -0.06],
        [-0.03, 0.003, -0.098],
        [-0.004, 0.001, -0.082],
      ],
      [0.95, 1, 1],
      fin,
    );
    add(
      [
        [0, 0, -0.06],
        [0.03, 0.003, -0.098],
        [0.004, 0.001, -0.082],
      ],
      [0.95, 1, 1],
      fin,
    );
    add(
      [
        [0, 0, -0.06],
        [-0.004, 0.001, -0.082],
        [0.004, 0.001, -0.082],
      ],
      [0.95, 1, 1],
      color('#f6b257'),
    );
    add(
      [
        [-0.014, 0, 0.03],
        [-0.04, -0.002, 0.012],
        [-0.015, 0, 0.008],
      ],
      [0.25, 0.4, 0.38],
      fin,
    );
    add(
      [
        [0.014, 0, 0.03],
        [0.04, -0.002, 0.012],
        [0.015, 0, 0.008],
      ],
      [0.25, 0.4, 0.38],
      fin,
    );
    add(
      [
        [-0.011, 0, -0.022],
        [-0.024, -0.002, -0.036],
        [-0.009, 0, -0.036],
      ],
      [0.68, 0.8, 0.78],
      fin,
    );
    add(
      [
        [0.011, 0, -0.022],
        [0.024, -0.002, -0.036],
        [0.009, 0, -0.036],
      ],
      [0.68, 0.8, 0.78],
      fin,
    );
    add(
      [
        [0, 0.014, 0.02],
        [0, 0.021, -0.01],
        [0, 0.01, -0.03],
      ],
      [0.3, 0.55, 0.75],
      color('#e77c1c'),
    );
  },
  wave: { k: 6.5, amp: 0.065, head: 0.04 },
  glow: color('#ffb347').multiplyScalar(1.5),
};

const EEL: Species = {
  length: 0.21,
  rings: 30,
  sides: 8,
  profile: (t) => {
    const taper = t < 0.08 ? 0.6 + (t / 0.08) * 0.4 : 1 - Math.max(0, t - 0.6) * 1.9;
    const w = 0.0085 * Math.max(0.1, taper);
    return [w, w * 0.9];
  },
  paint: (t) => {
    const band = (t * 11) % 1;
    return band < 0.22 ? color('#39e6ee') : color('#141a3c').lerp(color('#232a5c'), Math.sin(t * 40) * 0.5 + 0.5);
  },
  emit: (t, angle) => ((t * 11) % 1 < 0.22 ? 1 : Math.abs(Math.abs(angle) - Math.PI / 2) < 0.25 ? 0.5 : 0),
  fins: (add) => {
    add(
      [
        [0, 0.008, 0.06],
        [0, 0.014, -0.02],
        [0, 0.007, -0.09],
      ],
      [0.2, 0.6, 0.95],
      color('#1d7f9c'),
      0.4,
    );
  },
  wave: { k: 8.5, amp: 0.045, head: 0.15 },
  glow: color('#39e6ee').multiplyScalar(0.87),
};

/** Highlight tint and sparkle strength per species: silver-blue, gold, and a faint cold sheen. */
const SHEEN: Record<FishKind, THREE.Vector4> = {
  bluegill: new THREE.Vector4(0.42, 0.62, 0.7, 0.55),
  koi: new THREE.Vector4(0.95, 0.62, 0.2, 0.9),
  eel: new THREE.Vector4(0.1, 0.3, 0.36, 0.3),
};

const SPECIES: Record<FishKind, Species> = { bluegill: BLUEGILL, koi: KOI, eel: EEL };

function buildGeometry(spec: Species): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const body: number[] = [];
  const emit: number[] = [];
  const index: number[] = [];
  const { rings, sides, length } = spec;

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const [w, h] = spec.profile(t);
    const z = (0.5 - t) * length;
    for (let s = 0; s < sides; s++) {
      const angle = (s / sides) * Math.PI * 2 - Math.PI;
      // angle 0 is the top of the back.
      const x = Math.sin(angle) * w;
      const y = Math.cos(angle) * h;
      pos.push(x, y, z);
      const n = new THREE.Vector3(Math.sin(angle) * h, Math.cos(angle) * w, 0).normalize();
      nor.push(n.x, n.y, n.z);
      const c = spec.paint(t, angle);
      col.push(c.r, c.g, c.b);
      body.push(t);
      emit.push(spec.emit(t, angle));
    }
  }
  for (let r = 0; r < rings; r++)
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s;
      const b = r * sides + ((s + 1) % sides);
      const c = a + sides;
      const d = b + sides;
      index.push(a, b, c, b, d, c);
    }
  // Eyes: two dark studs with a light fleck, so the head reads.
  const [hw, hh] = spec.profile(0.1);
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    const ex = side * hw * 0.82;
    const ey = hh * 0.55;
    const ez = (0.5 - 0.1) * length;
    const e = hw * 0.34;
    pos.push(ex, ey + e, ez, ex + side * e * 0.5, ey, ez + e, ex + side * e * 0.5, ey, ez - e, ex, ey - e * 0.4, ez);
    for (let i = 0; i < 4; i++) {
      nor.push(side * 0.7, 0.7, 0);
      const c = i === 0 ? color('#f4f8ff') : color('#070a14');
      col.push(c.r, c.g, c.b);
      body.push(0.1);
      emit.push(0);
    }
    index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  spec.fins((points, t, c, e = 0, normal) => {
    const base = pos.length / 3;
    const n = new THREE.Vector3()
      .subVectors(
        new THREE.Vector3(...(points[1] as [number, number, number])),
        new THREE.Vector3(...(points[0] as [number, number, number])),
      )
      .cross(
        new THREE.Vector3().subVectors(
          new THREE.Vector3(...(points[2] as [number, number, number])),
          new THREE.Vector3(...(points[0] as [number, number, number])),
        ),
      )
      .normalize();
    if (n.y < 0) n.negate();
    if (normal) n.set(...normal).normalize();
    points.forEach((p, i) => {
      pos.push(...p);
      nor.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
      body.push(t[i] ?? 1);
      emit.push(e);
    });
    index.push(base, base + 1, base + 2);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('aBody', new THREE.Float32BufferAttribute(body, 1));
  geometry.setAttribute('aEmit', new THREE.Float32BufferAttribute(emit, 1));
  geometry.setIndex(index);
  return geometry;
}

export interface FishInstance {
  readonly kind: FishKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly heading: number;
  readonly pitch: number;
  readonly scale: number;
  readonly phase: number;
  /** 0 = at the surface, 1 = fully lost in the depth color. */
  readonly fog: number;
  /** Self-light multiplier (eel pulse, koi gleam). */
  readonly glow: number;
  readonly flash: number;
  /** Extra swim energy (flopping in the net). */
  readonly flop: number;
}

export class FishSchool {
  readonly group = new THREE.Group();
  readonly triangles: Record<FishKind, number>;
  private readonly meshes: Record<FishKind, THREE.InstancedMesh>;
  private readonly params: Record<FishKind, THREE.InstancedBufferAttribute>;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly scaleV = new THREE.Vector3();
  private readonly posV = new THREE.Vector3();

  /** Moon direction in view space (the camera never turns), and a clock for scale sparkle. */
  readonly moonView = { value: new THREE.Vector3(0, 1, 0) };
  readonly time = { value: 0 };

  constructor(ramp: THREE.Texture, fogColor: THREE.Color, layer: number) {
    const meshes = {} as Record<FishKind, THREE.InstancedMesh>;
    const params = {} as Record<FishKind, THREE.InstancedBufferAttribute>;
    const triangles = {} as Record<FishKind, number>;
    for (const kind of Object.keys(SPECIES) as FishKind[]) {
      const spec = SPECIES[kind];
      const geometry = buildGeometry(spec);
      triangles[kind] = (geometry.index?.count ?? 0) / 3;
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FISH * 4), 4);
      const attr2 = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FISH * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      attr2.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('iSwim', attr);
      geometry.setAttribute('iLook', attr2);
      const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp, side: THREE.DoubleSide });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uFog = { value: fogColor };
        shader.uniforms.uGlow = { value: spec.glow };
        shader.uniforms.uMoonView = this.moonView;
        shader.uniforms.uTime = this.time;
        shader.uniforms.uSheen = { value: SHEEN[kind] };
        shader.uniforms.uWave = { value: new THREE.Vector3(spec.wave.k, spec.wave.amp * spec.length, spec.wave.head) };
        shader.vertexShader =
          'attribute float aBody;\nattribute float aEmit;\nattribute vec4 iSwim;\nattribute vec4 iLook;\nuniform vec3 uWave;\nvarying vec4 vLook;\nvarying float vEmit;\nvarying vec2 vScale;\n' +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             // Spine wave travelling head to tail; the tail swings widest.
             float swing = mix(uWave.z, 1.0, aBody * aBody);
             transformed.x += sin(iSwim.x - aBody * uWave.x) * uWave.y * swing * iSwim.y;
             vLook = iLook;
             vEmit = aEmit;
             vScale = vec2(aBody * 46.0, atan(position.x, position.y) * 5.0);`,
          );
        shader.fragmentShader =
          'uniform vec3 uFog;\nuniform vec3 uGlow;\nuniform vec3 uMoonView;\nuniform float uTime;\nuniform vec4 uSheen;\nvarying vec4 vLook;\nvarying float vEmit;\nvarying vec2 vScale;\n' +
          shader.fragmentShader
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
               vec3 nrm = normalize(normal);
               vec3 eye = normalize(vViewPosition);
               float rim = pow(1.0 - clamp(dot(nrm, eye), 0.0, 1.0), 3.0);
               // Moonlit rim: keeps the silhouette readable against dark water.
               totalEmissiveRadiance += vec3(0.3, 0.5, 0.62) * step(0.5, rim) * 0.34;
               // Luster: a stepped moon highlight along the wet back, and scales that catch the light.
               float sp = pow(clamp(dot(nrm, normalize(uMoonView + eye)), 0.0, 1.0), 26.0);
               float gloss = sp > 0.55 ? 1.0 : (sp > 0.22 ? 0.4 : 0.0);
               float fleck = fract(sin(dot(floor(vScale), vec2(12.9898, 78.233)) + floor(uTime * 5.0) * 0.37) * 43758.5453);
               float sparkle = step(0.965, fleck) * smoothstep(0.1, 0.6, sp + 0.25);
               totalEmissiveRadiance += uSheen.rgb * (gloss * 0.5 + sparkle * uSheen.a);
               totalEmissiveRadiance += uGlow * vEmit * vLook.y;`,
            )
            .replace(
              '#include <opaque_fragment>',
              `#include <opaque_fragment>
               // Continuous depth fog: deeper fish sink into the river's color; no surface pop.
               // Brightness discipline: a fish's own surface stays under the water's brightest glints;
               // only self-light (eel stripes, koi gleam) may go above.
               gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(0.58) + uGlow * vEmit * vLook.y);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, uFog, vLook.x);
               gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.25), vLook.z);`,
            );
      };
      material.customProgramCacheKey = () => `fish-${kind}`;
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_FISH);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.layers.set(layer);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      meshes[kind] = mesh;
      params[kind] = attr;
      (mesh.userData as { look: THREE.InstancedBufferAttribute }).look = attr2;
    }
    this.meshes = meshes;
    this.params = params;
    this.triangles = triangles;
  }

  update(fish: readonly FishInstance[]): void {
    const counts: Record<FishKind, number> = { bluegill: 0, koi: 0, eel: 0 };
    for (const f of fish) {
      const n = counts[f.kind];
      if (n >= MAX_FISH) continue;
      const mesh = this.meshes[f.kind];
      this.euler.set(f.pitch, f.heading, 0, 'YXZ');
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.posV.set(f.x, f.y, f.z), this.quat, this.scaleV.setScalar(f.scale));
      mesh.setMatrixAt(n, this.matrix);
      this.params[f.kind].setXYZW(n, f.phase, 1 + f.flop, 0, 0);
      (mesh.userData as { look: THREE.InstancedBufferAttribute }).look.setXYZW(n, f.fog, f.glow, f.flash, 0);
      counts[f.kind] = n + 1;
    }
    for (const kind of Object.keys(counts) as FishKind[]) {
      const mesh = this.meshes[kind];
      mesh.count = counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      this.params[kind].needsUpdate = true;
      (mesh.userData as { look: THREE.InstancedBufferAttribute }).look.needsUpdate = true;
    }
  }
}

export const FISH_LENGTH: Record<FishKind, number> = { bluegill: BLUEGILL.length, koi: KOI.length, eel: EEL.length };
