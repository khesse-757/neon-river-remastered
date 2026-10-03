import * as THREE from 'three';
import { FULLSCREEN_VERT, RIPPLE_FRAG } from './shaders';

const MAX_IMPULSES = 8;

/**
 * GPU ripple height-field over the painting grid. Fish, the net, and splashes inject impulses;
 * the water shaders read it for refraction and crest highlights.
 */
export class RippleField {
  readonly byteEncoded: boolean;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material: THREE.ShaderMaterial;
  private readonly impulses: THREE.Vector4[] = [];
  private readonly queue: THREE.Vector4[] = [];
  private accumulator = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
    waterMask: THREE.Texture,
    quad: THREE.BufferGeometry,
    forceByte = false,
  ) {
    const floatOk = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    this.byteEncoded = forceByte || !floatOk;
    const make = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(width, height, {
        type: this.byteEncoded ? THREE.UnsignedByteType : THREE.HalfFloatType,
        magFilter: THREE.NearestFilter,
        minFilter: THREE.NearestFilter,
        depthBuffer: false,
        colorSpace: THREE.NoColorSpace,
      });
    this.targets = [make(), make()];
    for (let i = 0; i < MAX_IMPULSES; i++) this.impulses.push(new THREE.Vector4());
    this.material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: RIPPLE_FRAG,
      defines: RippleField.defines(this.byteEncoded),
      uniforms: {
        uPrev: { value: null },
        uMask: { value: waterMask },
        uSize: { value: new THREE.Vector2(width, height) },
        uImpulses: { value: this.impulses },
      },
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(quad, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.clear(renderer);
  }

  /** GLSL snippets that decode/encode heights for the active storage format. */
  static defines(byteEncoded: boolean): Record<string, string> {
    return byteEncoded ? { RIPPLE_DECODE: '* 2.0 - 1.0', RIPPLE_ENCODE: '* 0.5 + 0.5' } : { RIPPLE_DECODE: '', RIPPLE_ENCODE: '' };
  }

  get texture(): THREE.Texture {
    return this.targets[0].texture;
  }

  /** Smooth sampling for per-pixel water shading. */
  setLinear(): void {
    for (const target of this.targets) {
      target.texture.magFilter = THREE.LinearFilter;
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.needsUpdate = true;
    }
  }

  /** Queue an impulse at a painting-grid position. */
  inject(x: number, y: number, radius: number, strength: number): void {
    if (this.queue.length < 32) this.queue.push(new THREE.Vector4(x, y, radius, strength));
  }

  clear(renderer: THREE.WebGLRenderer): void {
    const rest = this.byteEncoded ? 0.5 : 0;
    const previous = renderer.getClearColor(new THREE.Color());
    renderer.setClearColor(new THREE.Color(rest, rest, 0), 1);
    for (const target of this.targets) {
      renderer.setRenderTarget(target);
      renderer.clear(true, false, false);
    }
    renderer.setClearColor(previous, 1);
    this.queue.length = 0;
  }

  /** Advance at a fixed 60 Hz regardless of frame rate. */
  update(renderer: THREE.WebGLRenderer, dt: number): void {
    this.accumulator = Math.min(this.accumulator + dt, 3 / 60);
    while (this.accumulator >= 1 / 60) {
      this.accumulator -= 1 / 60;
      for (let i = 0; i < MAX_IMPULSES; i++) {
        const next = this.queue.shift();
        if (next) this.impulses[i]?.copy(next);
        else this.impulses[i]?.set(0, 0, 1, 0);
      }
      this.material.uniforms.uPrev!.value = this.targets[0].texture;
      renderer.setRenderTarget(this.targets[1]);
      renderer.render(this.scene, this.camera);
      this.targets = [this.targets[1], this.targets[0]];
    }
  }

  dispose(): void {
    for (const target of this.targets) target.dispose();
    this.material.dispose();
  }
}
