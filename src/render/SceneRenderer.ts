import * as THREE from 'three';
import { FISH_COLORS, FISH_SPRITES, LANTERN } from '../data/sprites';
import type { FishKind } from '../sim/config';
import type { River } from '../sim/river';
import { hexToRgb, paletteColor, type AtlasRect, type SceneAssets } from './assets';
import { computeLayout, type Layout } from './layout';
import { Particles } from './Particles';
import { rasterizeText } from './PixelText';
import { RippleField } from './RippleField';
import * as GLSL from './shaders';

const MAX_FISH = 64;
const MAX_LIGHTS = 8;
/** The sprites are authored for this grid width; other grids pick the closest authored size. */
const AUTHORED_GRID_W = 216;

export interface FishView {
  readonly kind: FishKind;
  /** Painting-grid position of the fish. */
  readonly x: number;
  readonly y: number;
  /** Projected size relative to a fish at the net rail (0..1+). */
  readonly rel: number;
  /** Screen heading as dx/dy, for leaning the sprite. */
  readonly slope: number;
  readonly phase: number;
  /** 1 while swimming, falling to 0 as it is scooped. */
  readonly scoop: number;
  readonly flash: number;
  readonly worldX: number;
  readonly worldZ: number;
  readonly heading: number;
}

export interface LightView {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly intensity: number;
  readonly color: THREE.Vector3;
}

export interface FrameView {
  readonly time: number;
  readonly dt: number;
  readonly fish: readonly FishView[];
  readonly netX: number;
  readonly netY: number;
  readonly netRadius: number;
  readonly netKick: number;
  readonly netVisible: boolean;
  readonly lights: readonly LightView[];
  readonly lantern: number;
  readonly breath: number;
  readonly lean: number;
  readonly jolt: number;
  readonly darken: number;
  readonly neon: number;
  readonly glitch: number;
}

export type FishStyle = 'flat' | 'voxel';

interface UiItem {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  text: string;
}

function unitQuad(min: number, max: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([min, min, 0, max, min, 0, min, max, 0, max, max, 0]), 3));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  return g;
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly ripples: RippleField;
  readonly particles: Particles;
  layout: Layout;
  fishStyle: FishStyle = 'flat';
  /** Painting-grid position of the lantern flame. */
  readonly lanternPos: { x: number; y: number };
  /** Painting-grid position of the fisherman's hands. */
  readonly grip: { x: number; y: number };

  private readonly camera = new THREE.Camera();
  private readonly under = new THREE.Scene();
  private readonly over = new THREE.Scene();
  private readonly voxelScene = new THREE.Scene();
  private readonly voxelCamera: THREE.PerspectiveCamera;
  private readonly compositeScene = new THREE.Scene();
  private readonly blitScene = new THREE.Scene();
  private sceneTarget: THREE.WebGLRenderTarget;
  private compositeTarget: THREE.WebGLRenderTarget;

  private readonly quad01 = unitQuad(0, 1);
  private readonly quadFull = unitQuad(-1, 1);
  private readonly shared: Record<string, THREE.IUniform>;
  private readonly lights: THREE.Vector4[] = [];
  private readonly lightColors: THREE.Vector3[] = [];
  private readonly fishGeometry = new THREE.InstancedBufferGeometry();
  private readonly fishAttrs: Record<'iPos' | 'iRect' | 'iAnim' | 'iLook', THREE.InstancedBufferAttribute>;
  private readonly fishMesh: THREE.Mesh;
  private readonly netMaterial: THREE.ShaderMaterial;
  private readonly netMesh: THREE.Mesh;
  private readonly fishermanMaterial: THREE.ShaderMaterial;
  private readonly lanternMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private readonly blitMaterial: THREE.ShaderMaterial;
  private readonly voxels: THREE.InstancedMesh;
  private readonly voxelMaterial: THREE.ShaderMaterial;
  private readonly voxelSize: number;
  private readonly ui = new Map<string, UiItem>();
  private readonly white: THREE.DataTexture;
  private readonly deep = paletteColor('#042c58');

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly assets: SceneAssets,
    river: River,
    options: { forceByteRipples?: boolean } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(1);

    const { gridW, gridH } = assets;
    this.layout = computeLayout(gridW, gridH, gridW, gridH);
    this.sceneTarget = this.makeTarget(true);
    this.compositeTarget = this.makeTarget(false);
    this.ripples = new RippleField(this.renderer, gridW, gridH, assets.maskA, this.quadFull, options.forceByteRipples);

    const sx = gridW / 768;
    this.lanternPos = { x: Math.round(470 * sx), y: Math.round(1052 * sx) };
    this.grip = { x: 553 * sx, y: 1266 * sx };

    for (let i = 0; i < MAX_LIGHTS; i++) {
      this.lights.push(new THREE.Vector4(0, 0, 1, 0));
      this.lightColors.push(new THREE.Vector3());
    }
    this.shared = {
      uTarget: { value: new THREE.Vector2(gridW, gridH) },
      uOrigin: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2(gridW, gridH) },
      uTime: { value: 0 },
      uBg: { value: assets.bg },
      uMaskA: { value: assets.maskA },
      uMaskB: { value: assets.maskB },
      uRipple: { value: this.ripples.texture },
      uLights: { value: this.lights },
      uLightColors: { value: this.lightColors },
      uLantern: { value: new THREE.Vector4(0, 0, 1, 0) },
      uWind: { value: 0.9 },
      uNeon: { value: 1 },
      uDarken: { value: 0 },
    };
    const rippleDefines = RippleField.defines(this.ripples.byteEncoded);
    const layer = (fragmentShader: string, extra: Record<string, THREE.IUniform>, defines?: Record<string, string>): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: GLSL.FULLSCREEN_VERT,
        fragmentShader,
        uniforms: { ...this.shared, ...extra },
        defines,
        depthTest: false,
        depthWrite: false,
      });
    const add = (scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, order: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      scene.add(mesh);
      return mesh;
    };

    // Under the surface: the painting and its water, then the fish.
    add(this.under, this.quadFull, layer(GLSL.BACKGROUND_FRAG, { uReflect: { value: 1 } }, rippleDefines), 0);

    this.fishGeometry.index = this.quad01.index;
    this.fishGeometry.setAttribute('position', this.quad01.getAttribute('position'));
    const attr = (size: number): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FISH * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.fishAttrs = { iPos: attr(2), iRect: attr(4), iAnim: attr(4), iLook: attr(4) };
    for (const [name, a] of Object.entries(this.fishAttrs)) this.fishGeometry.setAttribute(name, a);
    this.fishGeometry.instanceCount = 0;
    this.fishMesh = add(
      this.under,
      this.fishGeometry,
      new THREE.ShaderMaterial({
        vertexShader: GLSL.SPRITE_VERT,
        fragmentShader: GLSL.SPRITE_FRAG,
        uniforms: {
          uTarget: this.shared.uTarget!,
          uAtlas: { value: assets.atlas },
          uDeep: { value: this.deep },
          uDarken: this.shared.uDarken!,
        },
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
      1,
    );

    // Over the fish: surface highlights and occluders, the net, the fisherman, particles, UI.
    add(this.over, this.quadFull, layer(GLSL.OVERLAY_FRAG, { uGlint: { value: 0 } }, rippleDefines), 0);
    this.netMaterial = new THREE.ShaderMaterial({
      vertexShader: GLSL.FULLSCREEN_VERT,
      fragmentShader: GLSL.NET_FRAG,
      uniforms: {
        uTarget: this.shared.uTarget!,
        uGrip: { value: new THREE.Vector2() },
        uHoop: { value: new THREE.Vector2() },
        uRadii: { value: new THREE.Vector2(10, 4) },
        uKick: { value: 0 },
        uDarken: this.shared.uDarken!,
      },
      depthTest: false,
      depthWrite: false,
    });
    this.netMesh = add(this.over, this.quadFull, this.netMaterial, 1);

    this.fishermanMaterial = new THREE.ShaderMaterial({
      vertexShader: GLSL.QUAD_VERT,
      fragmentShader: GLSL.FISHERMAN_FRAG,
      uniforms: {
        uTarget: this.shared.uTarget!,
        uRect: { value: new THREE.Vector4() },
        uMap: { value: assets.fisherman },
        uBreath: { value: 0 },
        uLean: { value: 0 },
        uJolt: { value: 0 },
        uRim: { value: 0.2 },
        uDarken: this.shared.uDarken!,
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    add(this.over, this.quad01, this.fishermanMaterial, 2);

    this.lanternMaterial = this.quadMaterial(assets.lantern);
    add(this.over, this.quad01, this.lanternMaterial, 3);

    this.particles = new Particles(this.quad01, this.shared.uTarget as { value: THREE.Vector2 });
    this.particles.mesh.renderOrder = 4;
    this.over.add(this.particles.mesh);

    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    this.white.needsUpdate = true;

    // Voxel fish (look-dev A/B) share the painting's camera.
    const cam = river.camera.spec;
    this.voxelCamera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(688 / cam.focal)), 768 / 1376, 0.05, 60);
    this.voxelCamera.position.set(0, cam.height, 0);
    this.voxelCamera.rotation.set(-river.camera.pitch, 0, 0);
    this.voxelCamera.updateMatrixWorld();
    this.voxelSize = 768 / gridW / river.screenAt(1, 0.5).scale;
    this.voxelMaterial = new THREE.ShaderMaterial({
      vertexShader: GLSL.VOXEL_VERT,
      fragmentShader: GLSL.VOXEL_FRAG,
      uniforms: { uDeep: { value: this.deep }, uTint: { value: 0.18 }, uDarken: this.shared.uDarken! },
    });
    this.voxels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.voxelMaterial, 6000);
    this.voxels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.voxels.setColorAt(0, new THREE.Color(1, 1, 1));
    this.voxels.count = 0;
    this.voxels.frustumCulled = false;
    this.voxelScene.add(this.voxels);

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: GLSL.FULLSCREEN_VERT,
      fragmentShader: GLSL.COMPOSITE_FRAG,
      uniforms: {
        uScene: { value: this.sceneTarget.texture },
        uLut: { value: assets.lut },
        uPalette: { value: assets.paletteTexture },
        uTarget: this.shared.uTarget!,
        uOrigin: this.shared.uOrigin!,
        uGrid: this.shared.uGrid!,
        uDither: { value: 0.9 },
        uGlitch: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    add(this.compositeScene, this.quadFull, this.compositeMaterial, 0);
    this.blitMaterial = new THREE.ShaderMaterial({
      vertexShader: GLSL.FULLSCREEN_VERT,
      fragmentShader: GLSL.BLIT_FRAG,
      uniforms: {
        uFrame: { value: this.compositeTarget.texture },
        uTarget: this.shared.uTarget!,
        uCanvas: { value: new THREE.Vector2() },
        uScale: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    add(this.blitScene, this.quadFull, this.blitMaterial, 0);

    this.resize();
  }

  /** Match the canvas to its CSS box at device resolution; returns true when the layout changed. */
  resize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.layout.canvasW && h === this.layout.canvasH && this.canvas.width === w) return false;
    this.layout = computeLayout(w, h, this.assets.gridW, this.assets.gridH);
    const { targetW, targetH, originX, originY, scale } = this.layout;
    this.renderer.setSize(w, h, false);
    this.sceneTarget.setSize(targetW, targetH);
    this.compositeTarget.setSize(targetW, targetH);
    (this.shared.uTarget!.value as THREE.Vector2).set(targetW, targetH);
    (this.shared.uOrigin!.value as THREE.Vector2).set(originX, originY);
    (this.blitMaterial.uniforms.uCanvas!.value as THREE.Vector2).set(w, h);
    this.blitMaterial.uniforms.uScale!.value = scale;
    const f = this.assets.fishermanRect;
    (this.fishermanMaterial.uniforms.uRect!.value as THREE.Vector4).set(originX + f.x, originY + f.y, f.width, f.height);
    (this.lanternMaterial.uniforms.uRect!.value as THREE.Vector4).set(
      originX + this.lanternPos.x - Math.floor(LANTERN.width / 2),
      originY + this.lanternPos.y - LANTERN.height + 3,
      LANTERN.width,
      LANTERN.height,
    );
    return true;
  }

  /** Text or a flat panel placed in target texels. Pass an empty string to remove it. */
  label(id: string, text: string, x: number, y: number, color: string, align: 'left' | 'center' | 'right' = 'left', shadow = true): number {
    // A one-texel drop shadow keeps text legible over the painting.
    if (shadow) this.label(`${id}~shadow`, text, x + 1, y + 1, '#030911', align, false);
    let item = this.ui.get(id);
    if (!text) {
      if (item) item.mesh.visible = false;
      return 0;
    }
    const key = `${text}|${color}`;
    if (!item) {
      const material = this.quadMaterial(this.white, false, true);
      const mesh = new THREE.Mesh(this.quad01, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = shadow ? 21 : 20;
      this.over.add(mesh);
      item = { mesh, material, text: '' };
      this.ui.set(id, item);
    }
    if (item.text !== key) {
      const old = item.material.uniforms.uMap!.value as THREE.Texture;
      if (old !== this.white) old.dispose();
      const bitmap = rasterizeText(text, hexToRgb(color));
      item.material.uniforms.uMap!.value = bitmap.texture;
      (item.material.uniforms.uRect!.value as THREE.Vector4).set(0, 0, bitmap.width, bitmap.height);
      item.text = key;
    }
    const rect = item.material.uniforms.uRect!.value as THREE.Vector4;
    rect.x = Math.round(align === 'center' ? x - rect.z / 2 : align === 'right' ? x - rect.z : x);
    rect.y = Math.round(y);
    item.mesh.visible = true;
    return rect.z;
  }

  /** Flat palette-colored rectangle in target texels (HUD tablet, banner board). */
  panel(id: string, x: number, y: number, w: number, h: number, color: string | null, order = 10): void {
    let item = this.ui.get(id);
    if (!color) {
      if (item) item.mesh.visible = false;
      return;
    }
    if (!item) {
      const material = this.quadMaterial(this.white, true, true);
      const mesh = new THREE.Mesh(this.quad01, material);
      mesh.frustumCulled = false;
      this.over.add(mesh);
      item = { mesh, material, text: '' };
      this.ui.set(id, item);
    }
    const rect = item.material.uniforms.uRect!.value as THREE.Vector4;
    rect.set(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    item.material.uniforms.uTint!.value = paletteColor(color);
    item.material.uniforms.uTintMix!.value = 1;
    item.mesh.renderOrder = order;
    item.mesh.visible = true;
  }

  render(view: FrameView): void {
    const { renderer, layout } = this;
    const { originX, originY, targetH } = layout;
    renderer.info.reset();
    this.shared.uTime!.value = view.time;
    this.shared.uNeon!.value = view.neon;
    this.shared.uDarken!.value = view.darken;
    this.compositeMaterial.uniforms.uGlitch!.value = view.glitch;
    // A dimmed scene is posterised flat; dithering a uniform darken reads as screen-door noise.
    this.compositeMaterial.uniforms.uDither!.value = view.darken > 0 ? 0 : 0.9;

    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = view.lights[i];
      if (l) {
        this.lights[i]?.set(originX + l.x, originY + l.y, l.radius, l.intensity);
        this.lightColors[i]?.copy(l.color);
      } else this.lights[i]?.set(0, 0, 1, 0);
    }
    const gridScale = this.assets.gridW / AUTHORED_GRID_W;
    (this.shared.uLantern!.value as THREE.Vector4).set(
      originX + this.lanternPos.x,
      originY + this.lanternPos.y - 4,
      46 * gridScale,
      view.lantern,
    );

    this.netMesh.visible = view.netVisible;
    const net = this.netMaterial.uniforms;
    (net.uHoop!.value as THREE.Vector2).set(originX + Math.round(view.netX) + 0.5, originY + Math.round(view.netY) + 0.5);
    (net.uGrip!.value as THREE.Vector2).set(originX + this.grip.x, originY + this.grip.y);
    (net.uRadii!.value as THREE.Vector2).set(view.netRadius, Math.max(3, Math.round(view.netRadius * 0.42)));
    net.uKick!.value = view.netKick;

    const man = this.fishermanMaterial.uniforms;
    man.uBreath!.value = view.breath;
    man.uLean!.value = view.lean;
    man.uJolt!.value = view.jolt;
    man.uRim!.value = Math.min(0.7, view.lantern * 0.6);

    if (this.fishStyle === 'flat') this.updateSprites(view.fish);
    else this.updateVoxels(view.fish);
    this.fishMesh.visible = this.fishStyle === 'flat';
    this.particles.update(view.dt, originX, originY);
    this.ripples.update(renderer, view.dt);
    this.shared.uRipple!.value = this.ripples.texture;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.clear();
    renderer.render(this.under, this.camera);
    if (this.fishStyle === 'voxel') {
      const y = targetH - originY - this.assets.gridH;
      this.sceneTarget.viewport.set(originX, y, this.assets.gridW, this.assets.gridH);
      this.sceneTarget.scissor.set(originX, y, this.assets.gridW, this.assets.gridH);
      this.sceneTarget.scissorTest = true;
      renderer.setRenderTarget(this.sceneTarget);
      renderer.render(this.voxelScene, this.voxelCamera);
      this.sceneTarget.viewport.set(0, 0, layout.targetW, targetH);
      this.sceneTarget.scissorTest = false;
      renderer.setRenderTarget(this.sceneTarget);
    }
    renderer.render(this.over, this.camera);

    renderer.setRenderTarget(this.compositeTarget);
    renderer.render(this.compositeScene, this.camera);
    renderer.setRenderTarget(null);
    renderer.render(this.blitScene, this.camera);
  }

  /** Reads the palette-locked low-res frame (RGBA, bottom row first) for tests. */
  readFrame(): { width: number; height: number; data: Uint8Array } {
    const { targetW, targetH } = this.layout;
    const data = new Uint8Array(targetW * targetH * 4);
    this.renderer.readRenderTargetPixels(this.compositeTarget, 0, 0, targetW, targetH, data);
    return { width: targetW, height: targetH, data };
  }

  dispose(): void {
    this.ripples.dispose();
    this.sceneTarget.dispose();
    this.compositeTarget.dispose();
    this.renderer.dispose();
  }

  private makeTarget(depth: boolean): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(this.layout.targetW, this.layout.targetH, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: depth,
      colorSpace: THREE.NoColorSpace,
    });
  }

  private quadMaterial(map: THREE.Texture, flat = false, ui = false): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: GLSL.QUAD_VERT,
      fragmentShader: GLSL.QUAD_FRAG,
      defines: flat ? { FLAT: '' } : {},
      uniforms: {
        uTarget: this.shared.uTarget!,
        uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uMap: { value: map },
        uTint: { value: new THREE.Vector3() },
        uTintMix: { value: 0 },
        // UI stays at full brightness when the scene dims behind a menu.
        uDarken: ui ? { value: 0 } : this.shared.uDarken!,
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** Authored size whose height best matches the projected size. */
  private sizeIndex(kind: FishKind, rel: number): number {
    const rects = this.assets.fishRects[kind];
    const near = rects[rects.length - 1] as AtlasRect;
    const wanted = (near.height * rel * this.assets.gridW) / AUTHORED_GRID_W;
    let best = 0;
    let bestD = Infinity;
    rects.forEach((r, i) => {
      const d = Math.abs(r.height - wanted);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private updateSprites(fish: readonly FishView[]): void {
    const { iPos, iRect, iAnim, iLook } = this.fishAttrs;
    const { originX, originY } = this.layout;
    let n = 0;
    for (const f of fish) {
      if (n >= MAX_FISH) break;
      const rect = this.assets.fishRects[f.kind][this.sizeIndex(f.kind, f.rel * (0.35 + 0.65 * f.scoop))] as AtlasRect;
      iPos.setXY(n, Math.floor(originX + f.x - rect.width / 2), Math.floor(originY + f.y - rect.height * 0.6));
      iRect.setXYZW(n, rect.x, rect.y, rect.width, rect.height);
      const eel = f.kind === 'eel';
      const amp = (rect.height >= 12 ? 1.3 : rect.height >= 8 ? 1 : 0.6) * (eel ? 1.3 : 1) * (f.scoop < 1 ? 1.8 : 1);
      // Quantised phase: the swim cycle steps through eight poses instead of sliding.
      const phase = (Math.floor((f.phase / (Math.PI * 2)) * 8) / 8) * Math.PI * 2;
      iAnim.setXYZW(n, phase, amp, Math.max(-0.7, Math.min(0.7, f.slope)), eel ? 1 : 0);
      const tint = (eel ? 0.1 : f.kind === 'koi' ? 0.14 : 0.1) * f.scoop;
      iLook.setXYZW(n, tint, f.flash, f.scoop < 0.35 ? 0.5 : 1, 0);
      n++;
    }
    this.fishGeometry.instanceCount = n;
    for (const a of Object.values(this.fishAttrs)) a.needsUpdate = true;
  }

  private updateVoxels(fish: readonly FishView[]): void {
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const base = new THREE.Matrix4();
    const local = new THREE.Vector3();
    const v = this.voxelSize;
    let n = 0;
    for (const f of fish) {
      const grid = FISH_SPRITES[f.kind][3];
      if (!grid) continue;
      const colors = FISH_COLORS[f.kind];
      const shrink = 0.35 + 0.65 * f.scoop;
      // World x maps to three x, world z (away from the camera) to three -z.
      base.makeRotationY(f.heading).setPosition(f.worldX, -v * 0.6, -f.worldZ);
      const eel = f.kind === 'eel';
      for (let row = 0; row < grid.height; row++) {
        const tail = eel ? 1 : 1 - row / (grid.height - 1);
        const sway = Math.sin(f.phase + row * 0.8) * tail * (eel ? 1.4 : 1.1);
        for (let col = 0; col < grid.width; col++) {
          const index = grid.cells[row * grid.width + col] ?? 0;
          if (index === 0 || n >= 6000) continue;
          local.set((col - grid.width / 2 + sway) * v * shrink, 0, (row - grid.height * 0.6) * v * shrink).applyMatrix4(base);
          matrix
            .makeRotationY(f.heading)
            .scale(new THREE.Vector3(v * shrink, v * 1.6 * shrink, v * shrink))
            .setPosition(local);
          this.voxels.setMatrixAt(n, matrix);
          const [r, g, b] = hexToRgb(colors[index] ?? '#ff00ff');
          color.setRGB(r / 255, g / 255, b / 255, THREE.LinearSRGBColorSpace);
          if (f.flash > 0) color.lerp(new THREE.Color(1, 1, 1), f.flash);
          this.voxels.setColorAt(n, color);
          n++;
        }
      }
    }
    this.voxels.count = n;
    this.voxels.instanceMatrix.needsUpdate = true;
    if (this.voxels.instanceColor) this.voxels.instanceColor.needsUpdate = true;
  }
}
