import * as THREE from 'three';
import { PARTICLE_FRAG, PARTICLE_VERT } from './shaders';

const MAX = 400;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  blink: number;
  age: number;
  color: THREE.Color;
  size: number;
  /** HDR multiplier; above ~1 the particle blooms. */
  glow: number;
}

export interface ParticleSpec {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  gravity?: number;
  life: number;
  blink?: number;
  color: THREE.Color;
  size?: number;
  glow?: number;
}

/** Pooled soft particles (droplets, sparks, drips, fireflies). Positions are painting texels. */
export class Particles {
  readonly mesh: THREE.Mesh;
  private readonly live: Particle[] = [];
  private readonly points = new Float32Array(MAX * 3);
  private readonly colors = new Float32Array(MAX * 4);
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly pointAttr: THREE.InstancedBufferAttribute;
  private readonly colorAttr: THREE.InstancedBufferAttribute;

  constructor(quad: THREE.BufferGeometry, target: { value: THREE.Vector2 }) {
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.pointAttr = new THREE.InstancedBufferAttribute(this.points, 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.colors, 4);
    this.pointAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPoint', this.pointAttr);
    this.geometry.setAttribute('iColor', this.colorAttr);
    this.geometry.instanceCount = 0;
    const material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uTarget: target },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  emit(p: ParticleSpec): void {
    if (this.live.length >= MAX) return;
    this.live.push({
      x: p.x,
      y: p.y,
      vx: p.vx ?? 0,
      vy: p.vy ?? 0,
      gravity: p.gravity ?? 0,
      life: p.life,
      blink: p.blink ?? 0,
      age: 0,
      color: p.color,
      size: p.size ?? 1,
      glow: p.glow ?? 1,
    });
  }

  clear(): void {
    this.live.length = 0;
  }

  update(dt: number, originX: number, originY: number): void {
    let n = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i] as Particle;
      p.age += dt;
      if (p.age >= p.life) {
        this.live.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      // Fireflies breathe; everything else fades out over its last third.
      const alpha = p.blink > 0 ? 0.25 + 0.75 * Math.max(0, Math.sin((p.age / p.blink) * Math.PI * 2)) ** 2 : Math.min(1, (1 - t) * 3);
      this.points.set([originX + p.x, originY + p.y, p.size], n * 3);
      this.colors.set([p.color.r * p.glow, p.color.g * p.glow, p.color.b * p.glow, alpha * Math.min(1, t * 8 + 0.3)], n * 4);
      n++;
    }
    this.geometry.instanceCount = n;
    this.pointAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}
