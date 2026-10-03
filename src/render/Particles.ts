import * as THREE from 'three';
import { PARTICLE_FRAG, PARTICLE_VERT } from './shaders';

const MAX = 320;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  life: number;
  /** Seconds between blinks; 0 = always lit. */
  blink: number;
  age: number;
  color: THREE.Vector3;
  size: number;
}

/** Grid-snapped one-texel particles: droplets, sparks, fireflies. Positions are painting-grid. */
export class Particles {
  readonly mesh: THREE.Mesh;
  private readonly live: Particle[] = [];
  private readonly points = new Float32Array(MAX * 3);
  private readonly colors = new Float32Array(MAX * 3);
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly pointAttr: THREE.InstancedBufferAttribute;
  private readonly colorAttr: THREE.InstancedBufferAttribute;

  constructor(quad: THREE.BufferGeometry, target: { value: THREE.Vector2 }) {
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.pointAttr = new THREE.InstancedBufferAttribute(this.points, 3);
    this.colorAttr = new THREE.InstancedBufferAttribute(this.colors, 3);
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
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  emit(p: {
    x: number;
    y: number;
    vx?: number;
    vy?: number;
    gravity?: number;
    life: number;
    blink?: number;
    color: THREE.Vector3;
    size?: number;
  }): void {
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
      if (p.blink > 0 && Math.floor(p.age / p.blink) % 3 === 2) continue;
      this.points.set([originX + p.x, originY + p.y, p.size], n * 3);
      this.colors.set([p.color.x, p.color.y, p.color.z], n * 3);
      n++;
    }
    this.geometry.instanceCount = n;
    this.pointAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }
}
