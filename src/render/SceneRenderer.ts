import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { River } from '../sim/river';
import { color, hexToRgb, type SceneAssets } from './assets';
import { computeLayout, type Layout } from './layout';
import { FishSchool, type FishInstance } from './models/fish';
import { BasketProp, LanternProp, NetProp } from './models/props';
import { Particles } from './Particles';
import { rasterizeText } from './PixelText';
import { RippleField } from './RippleField';
import * as GLSL from './shaders';

const WATER_LIGHTS = 6;
const EEL_LIGHTS = 3;
/** Render layers of the actor scene. */
const LAYER_RIVER = 1;
const LAYER_NET = 2;
const LAYER_BRIDGE = 3;

export interface WaterLight {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly intensity: number;
  readonly color: THREE.Color;
}

export interface FrameView {
  readonly time: number;
  readonly dt: number;
  /** Fish under the water (world space: x right, y up, z away from the camera). */
  readonly fish: readonly FishInstance[];
  /** Fish above the surface: in the net, or flying to the basket. */
  readonly airFish: readonly FishInstance[];
  readonly net: { x: number; z: number; velocity: number; lift: number; bulge: number; charge: number; visible: boolean };
  readonly basketFill: number;
  /** 0..1: the catch chars after an eel. */
  readonly basketFry: number;
  /** 0..1: the catch glows gold on a win. */
  readonly basketGlow: number;
  readonly waterLights: readonly WaterLight[];
  /** Brightest eels near the net, for real point lights on the props. */
  readonly eelLights: readonly { x: number; z: number; intensity: number }[];
  readonly lantern: number;
  readonly breath: number;
  readonly lean: number;
  readonly jolt: number;
  readonly darken: number;
  readonly neon: number;
  readonly flash: number;
  readonly glitch: number;
  /** 0..1 gold wash (win). */
  readonly warm: number;
  /** Far-layer parallax in texels. */
  readonly drift: number;
}

/** How the 3D layer is rendered: at device pixels, or at three pixels per painting texel. */
export type ActorResolution = 'auto' | 'device' | '3x';

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

/** Renders the whole scene into the composer's buffer in a fixed order. */
class ScenePass extends Pass {
  constructor(private readonly draw: (renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) => void) {
    super();
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.draw(renderer, read);
  }
}

export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly ripples: RippleField;
  readonly particles: Particles;
  readonly net: NetProp;
  readonly lantern: LanternProp;
  readonly basket: BasketProp;
  layout: Layout;
  /** Pixels per painting texel in the internal render (equals layout.scale at device resolution). */
  pixelsPerTexel = 1;
  /** 0 = full, 1 = 3D layer at 2 px per texel, 2 = 1 px per texel and no bloom. Raised when frames run slow. */
  quality = 0;
  /** World position of the fisherman's hands. */
  readonly grip = new THREE.Vector3();
  readonly triangles: { fish: Record<string, number> };

  private readonly identity = new THREE.Camera();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world = new THREE.Scene();
  private readonly surface = new THREE.Scene();
  private readonly actors = new THREE.Scene();
  private readonly flat = new THREE.Scene();
  private readonly fx = new THREE.Scene();
  private readonly uiScene = new THREE.Scene();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly final: ShaderPass;
  private readonly quad01 = unitQuad(0, 1);
  private readonly quadFull = unitQuad(-1, 1);
  private readonly shared: Record<string, THREE.IUniform>;
  private readonly uiTarget = { value: new THREE.Vector2(1, 1) };
  private readonly waterLights: THREE.Vector4[] = [];
  private readonly waterLightColors: THREE.Vector3[] = [];
  private readonly fish: FishSchool;
  private readonly airFish: FishSchool;
  private readonly fishermanMaterial: THREE.ShaderMaterial;
  private readonly lanternLight: THREE.PointLight;
  private readonly eelLights: THREE.PointLight[] = [];
  private readonly moon: THREE.DirectionalLight;
  private readonly winLight: THREE.PointLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly neonFill: THREE.DirectionalLight;
  private readonly fogBase = color('#063152');
  private readonly fogNow = color('#063152');
  private readonly night = color('#030911');
  private readonly ui = new Map<string, UiItem>();
  private readonly white: THREE.DataTexture;
  private readonly temp = new THREE.Vector3();
  private readonly hoop = new THREE.Vector3();
  private netVisible = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly assets: SceneAssets,
    readonly river: River,
    private readonly options: { forceByteRipples?: boolean; actors?: ActorResolution; netRadius: number } = { netRadius: 0.08 },
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(1);
    // Software rasterizers (CI, blocklisted GPUs) start at the lowest quality instead of crawling down to it.
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(gpu)) this.quality = 2;

    const { gridW, gridH } = assets;
    this.layout = computeLayout(gridW, gridH, gridW, gridH);
    this.ripples = new RippleField(this.renderer, gridW, gridH, assets.maskA, this.quadFull, options.forceByteRipples);
    this.ripples.setLinear();

    const cam = river.camera.spec;
    this.camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(2 * Math.atan(688 / cam.focal)), 768 / 1376, 0.05, 60);
    this.camera.position.set(0, cam.height, 0);
    this.camera.rotation.set(-river.camera.pitch, 0, 0);
    this.camera.layers.enableAll();
    this.camera.updateMatrixWorld(true);

    for (let i = 0; i < WATER_LIGHTS; i++) {
      this.waterLights.push(new THREE.Vector4(0, 0, 1, 0));
      this.waterLightColors.push(new THREE.Vector3());
    }
    this.shared = {
      uCanvas: { value: new THREE.Vector2(gridW, gridH) },
      uScale: { value: 1 },
      uOrigin: { value: new THREE.Vector2() },
      uGrid: { value: new THREE.Vector2(gridW, gridH) },
      uTime: { value: 0 },
      uBg: { value: assets.bg },
      uMaskA: { value: assets.maskA },
      uMaskB: { value: assets.maskB },
      uField: { value: assets.field },
      uNoise: { value: assets.noise },
      uRipple: { value: this.ripples.texture },
      uCam: { value: new THREE.Vector4(cam.focal, cam.centerX, cam.centerY, cam.height) },
      uPitch: { value: new THREE.Vector2(Math.sin(river.camera.pitch), Math.cos(river.camera.pitch)) },
      uSrcPerTexel: { value: 768 / gridW },
      uLantern: { value: new THREE.Vector4(0, 0, 1, 0) },
      uWind: { value: 0.9 },
      uNeon: { value: 1 },
      uDarken: { value: 0 },
      uDrift: { value: 0 },
      uFlash: { value: 0 },
      uTarget: { value: new THREE.Vector2(gridW, gridH) },
    };
    const rippleDefines = RippleField.defines(this.ripples.byteEncoded);
    const layer = (fragmentShader: string, extra: Record<string, THREE.IUniform> = {}, blend = false): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        vertexShader: GLSL.FULLSCREEN_VERT,
        fragmentShader,
        uniforms: { ...this.shared, ...extra },
        defines: rippleDefines,
        depthTest: false,
        depthWrite: false,
        transparent: blend,
        blending: blend ? THREE.CustomBlending : THREE.NormalBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
    const add = (scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, order: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      scene.add(mesh);
      return mesh;
    };

    add(this.world, this.quadFull, layer(GLSL.WORLD_FRAG), 0);
    const moonDir = new THREE.Vector3(-0.35, 0.75, 0.55).normalize();
    add(
      this.surface,
      this.quadFull,
      layer(
        GLSL.SURFACE_FRAG,
        {
          uMoonDir: { value: moonDir },
          uLights: { value: this.waterLights },
          uLightColors: { value: this.waterLightColors },
          uReflect: { value: 1 },
        },
        true,
      ),
      0,
    );
    add(this.surface, this.quadFull, layer(GLSL.OCCLUDER_FRAG), 1);

    // Real lights for the 3D actors. Actor space flips z (three looks down -z).
    this.hemi = new THREE.HemisphereLight(color('#40649a'), color('#0b1622'), 1.5);
    const hemi = this.hemi;
    this.moon = new THREE.DirectionalLight(color('#b7d2ff'), 2.4);
    this.moon.position.set(moonDir.x, moonDir.y, -moonDir.z).multiplyScalar(10);
    this.neonFill = new THREE.DirectionalLight(color('#a06bff'), 0.9);
    const neon = this.neonFill;
    neon.position.set(0.5, 0.35, -1).multiplyScalar(10);
    this.lanternLight = new THREE.PointLight(color('#ffb060'), 0.05, 1.1, 2);
    const lights: THREE.Light[] = [hemi, this.moon, neon, this.lanternLight];
    for (let i = 0; i < EEL_LIGHTS; i++) {
      const light = new THREE.PointLight(color('#39e6ee'), 0, 0.55, 2);
      this.eelLights.push(light);
      lights.push(light);
    }
    for (const light of lights) {
      light.layers.enableAll();
      this.actors.add(light);
    }

    const fog = this.fogNow;
    this.fish = new FishSchool(assets.ramp, fog, LAYER_RIVER);
    this.airFish = new FishSchool(assets.ramp, fog, LAYER_BRIDGE);
    this.actors.add(this.fish.group, this.airFish.group);
    this.triangles = { fish: this.fish.triangles };

    this.net = new NetProp(assets.ramp, options.netRadius, LAYER_NET);
    this.actors.add(this.net.root);

    // Things on the bridge are placed by unprojecting painting pixels onto planes at bridge height.
    const place = (px: number, py: number, height: number): THREE.Vector3 => {
      const p = river.camera.unprojectAtHeight(px, py, height);
      return new THREE.Vector3(p.x, p.y, -p.z);
    };
    this.grip.copy(place(553, 1266, 0.2));
    this.lantern = new LanternProp(assets.ramp, 0.04, LAYER_BRIDGE);
    // On the deck in front of the parapet, clear of the rail where fish are caught.
    this.lantern.root.position.copy(place(268, 1196, 0.1));
    this.basket = new BasketProp(assets.ramp, 0.052, LAYER_BRIDGE);
    this.basket.root.position.copy(place(382, 1262, 0.1));
    this.actors.add(this.lantern.root, this.basket.root);
    // Gold light from the full basket on a win.
    this.winLight = new THREE.PointLight(color('#ffcf5a'), 0, 0.8, 2);
    this.winLight.position.copy(this.basket.root.position).add(new THREE.Vector3(0, 0.08, 0));
    this.winLight.layers.enableAll();
    this.actors.add(this.winLight);
    // The moon's direction as the fixed camera sees it, for the fish's stepped highlights.
    const moonView = new THREE.Vector3(moonDir.x, moonDir.y, -moonDir.z).transformDirection(this.camera.matrixWorldInverse);
    this.fish.moonView.value.copy(moonView);
    this.airFish.moonView.value.copy(moonView);

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
        uLightDir: { value: new THREE.Vector3(-0.7, -0.45, 0.55) },
        uLight: { value: 0.5 },
        uFlash: this.shared.uFlash!,
        uDarken: this.shared.uDarken!,
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    add(this.flat, this.quad01, this.fishermanMaterial, 0);

    this.particles = new Particles(this.quad01, this.shared.uTarget as { value: THREE.Vector2 });
    this.fx.add(this.particles.mesh);

    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    this.white.needsUpdate = true;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new ScenePass((renderer, target) => this.drawScene(renderer, target)));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(gridW, gridH), 0.55, 0.45, 0.9);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(
      new THREE.ShaderMaterial({
        vertexShader: GLSL.FINAL_VERT,
        fragmentShader: GLSL.FINAL_FRAG,
        uniforms: {
          tDiffuse: { value: null },
          uLut: { value: assets.lut },
          uGrade: { value: 0.18 },
          uVignette: { value: 0.35 },
          uGlitch: { value: 0 },
          uWarm: { value: 0 },
          uSource: { value: new THREE.Vector2(1, 1) },
        },
      }),
    );
    this.composer.addPass(this.final);

    this.resize(true);
  }

  /** Match the canvas to its CSS box at device resolution; returns true when the layout changed. */
  resize(force = false): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (!force && w === this.layout.canvasW && h === this.layout.canvasH && this.canvas.width === w) return false;
    this.layout = computeLayout(w, h, this.assets.gridW, this.assets.gridH);
    const { originX, originY, scale } = this.layout;
    // v2 caps the 3D layer near DPR 2: a DPR-3 phone renders it at 3 px per painting texel and the
    // final pass upscales with a sharp-bilinear filter, so painting pixels stay even.
    const capped = Math.max(2, Math.min(scale, Math.floor((scale * 2) / dpr)));
    const wanted = this.options.actors === 'device' ? scale : this.options.actors === '3x' ? Math.min(3, scale) : Math.min(scale, capped);
    const k = this.quality === 0 ? wanted : Math.min(wanted, this.quality === 1 ? 2 : 1);
    this.pixelsPerTexel = k;
    this.bloom.enabled = this.quality < 2;
    const iw = Math.max(1, Math.round((w * k) / scale));
    const ih = Math.max(1, Math.round((h * k) / scale));
    this.renderer.setSize(w, h, false);
    this.composer.setSize(iw, ih);
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      target.texture.magFilter = THREE.LinearFilter;
      target.texture.minFilter = THREE.LinearFilter;
    }
    (this.final.uniforms.uSource!.value as THREE.Vector2).set(iw, ih);
    (this.shared.uCanvas!.value as THREE.Vector2).set(iw, ih);
    this.shared.uScale!.value = k;
    (this.shared.uOrigin!.value as THREE.Vector2).set(originX, originY);
    (this.shared.uTarget!.value as THREE.Vector2).set(iw / k, ih / k);
    this.uiTarget.value.set(w / scale, h / scale);
    // The 3D camera sees exactly the painting's rectangle; the view offset extends it to the gutters.
    this.camera.setViewOffset(this.assets.gridW * k, this.assets.gridH * k, -originX * k, -originY * k, iw, ih);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    const f = this.assets.fishermanRect;
    (this.fishermanMaterial.uniforms.uRect!.value as THREE.Vector4).set(originX + f.x, originY + f.y, f.width, f.height);
    return true;
  }

  /** Step the render quality down one level (slow GPU). Returns false when already at the floor. */
  lowerQuality(): boolean {
    if (this.quality >= 2) return false;
    this.quality += 1;
    this.resize(true);
    return true;
  }

  /** Painting-texel position of a point in actor space (three coordinates). */
  toTexel(p: THREE.Vector3): { x: number; y: number } {
    this.temp.copy(p).project(this.camera);
    const target = this.shared.uTarget!.value as THREE.Vector2;
    return { x: ((this.temp.x + 1) / 2) * target.x - this.layout.originX, y: ((1 - this.temp.y) / 2) * target.y - this.layout.originY };
  }

  /** Text placed in target texels. Returns its width; an empty string hides it. */
  label(
    id: string,
    text: string,
    x: number,
    y: number,
    hex: string,
    align: 'left' | 'center' | 'right' = 'left',
    shadow = true,
    title = false,
  ): number {
    // A one-texel drop shadow keeps text legible over the painting.
    if (shadow) this.label(`${id}~shadow`, text, x + 1, y + 1, '#030911', align, false, title);
    let item = this.ui.get(id);
    if (!text) {
      if (item) item.mesh.visible = false;
      return 0;
    }
    const key = `${text}|${hex}`;
    if (!item) {
      const material = this.quadMaterial(this.white, false);
      const mesh = new THREE.Mesh(this.quad01, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = shadow ? 21 : 20;
      this.uiScene.add(mesh);
      item = { mesh, material, text: '' };
      this.ui.set(id, item);
    }
    if (item.text !== key) {
      const old = item.material.uniforms.uMap!.value as THREE.Texture;
      if (old !== this.white) old.dispose();
      const bitmap = rasterizeText(text, hexToRgb(hex), title);
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

  /** A small pixel icon from rows of '#' and '.', placed in target texels. */
  icon(id: string, rows: readonly string[] | null, x: number, y: number, hex = '#ffffff', order = 21): void {
    let item = this.ui.get(id);
    if (!rows) {
      if (item) item.mesh.visible = false;
      return;
    }
    const key = `${rows.join('/')}|${hex}`;
    if (!item) {
      const material = this.quadMaterial(this.white, false);
      const mesh = new THREE.Mesh(this.quad01, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.uiScene.add(mesh);
      item = { mesh, material, text: '' };
      this.ui.set(id, item);
    }
    if (item.text !== key) {
      const w = rows[0]?.length ?? 1;
      const data = new Uint8Array(w * rows.length * 4);
      const [r, g, b] = hexToRgb(hex);
      rows.forEach((row, yy) => {
        for (let xx = 0; xx < w; xx++) if (row[xx] === '#') data.set([r, g, b, 255], (yy * w + xx) * 4);
      });
      const old = item.material.uniforms.uMap!.value as THREE.Texture;
      if (old !== this.white) old.dispose();
      const texture = new THREE.DataTexture(data, w, rows.length, THREE.RGBAFormat);
      texture.needsUpdate = true;
      item.material.uniforms.uMap!.value = texture;
      (item.material.uniforms.uRect!.value as THREE.Vector4).set(0, 0, w, rows.length);
      item.text = key;
    }
    const rect = item.material.uniforms.uRect!.value as THREE.Vector4;
    rect.x = Math.round(x);
    rect.y = Math.round(y);
    item.mesh.visible = true;
  }

  /** Flat rectangle in target texels (HUD tablet, banner board, buttons). */
  panel(id: string, x: number, y: number, w: number, h: number, hex: string | null, order = 10): void {
    let item = this.ui.get(id);
    if (!hex) {
      if (item) item.mesh.visible = false;
      return;
    }
    if (!item) {
      const material = this.quadMaterial(this.white, true);
      const mesh = new THREE.Mesh(this.quad01, material);
      mesh.frustumCulled = false;
      this.uiScene.add(mesh);
      item = { mesh, material, text: '' };
      this.ui.set(id, item);
    }
    (item.material.uniforms.uRect!.value as THREE.Vector4).set(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    const [r, g, b] = hexToRgb(hex);
    (item.material.uniforms.uTint!.value as THREE.Vector3).set(r / 255, g / 255, b / 255);
    item.material.uniforms.uTintMix!.value = 1;
    item.mesh.renderOrder = order;
    item.mesh.visible = true;
  }

  render(view: FrameView): void {
    const { renderer, layout } = this;
    renderer.info.reset();
    const s = this.shared;
    s.uTime!.value = view.time;
    s.uNeon!.value = view.neon;
    s.uDarken!.value = view.darken;
    s.uDrift!.value = view.drift;
    s.uFlash!.value = view.flash;
    this.final.uniforms.uGlitch!.value = view.glitch;
    this.final.uniforms.uWarm!.value = view.warm;

    for (let i = 0; i < WATER_LIGHTS; i++) {
      const l = view.waterLights[i];
      if (l) {
        this.waterLights[i]?.set(l.x, l.z, l.radius, l.intensity);
        this.waterLightColors[i]?.set(l.color.r, l.color.g, l.color.b);
      } else this.waterLights[i]?.set(0, 0, 1, 0);
    }
    this.eelLights.forEach((light, i) => {
      const e = view.eelLights[i];
      light.intensity = e ? e.intensity * 0.05 : 0;
      if (e) light.position.set(e.x, 0.03, -e.z);
    });

    this.lantern.update(view.time, view.lantern, view.darken);
    this.lanternLight.position.copy(this.lantern.flame);
    this.lanternLight.intensity = 0.045 * view.lantern * (1 - view.darken);
    const flame = this.toTexel(this.lantern.flame);
    const gs = this.assets.gridW / 216;
    (s.uLantern!.value as THREE.Vector4).set(flame.x, flame.y + 9 * gs, 40 * gs, 0.55 * view.lantern);
    // The 3D actors dim with the painting behind menus and after the shock.
    const lit = 1 - view.darken;
    this.moon.intensity = 2.4 * lit + view.flash * 6;
    this.hemi.intensity = 1.5 * lit;
    this.neonFill.intensity = 0.9 * lit * view.neon;
    this.fogNow.copy(this.fogBase).lerp(this.night, view.darken);

    this.netVisible = view.net.visible;
    this.net.root.visible = view.net.visible;
    this.hoop.set(view.net.x, -this.net.radius * 0.12, -view.net.z);
    this.net.update(this.hoop, this.grip, view.net.velocity, view.net.lift, view.net.bulge, view.dt, view.net.charge);
    this.basket.update(view.basketFill, view.dt, view.time, view.basketFry, view.basketGlow);
    this.winLight.intensity = 0.014 * view.basketGlow;
    this.fish.time.value = view.time;
    this.airFish.time.value = view.time;

    const man = this.fishermanMaterial.uniforms;
    man.uBreath!.value = view.breath;
    man.uLean!.value = view.lean;
    man.uJolt!.value = view.jolt;
    man.uLight!.value = 0.3 * view.lantern;

    this.fish.update(view.fish);
    this.airFish.update(view.airFish);
    this.particles.update(view.dt, layout.originX, layout.originY);
    this.ripples.update(renderer, view.dt);
    s.uRipple!.value = this.ripples.texture;

    this.composer.render(view.dt);

    // Pixel UI last, straight to the screen, so it is never bloomed, graded or resampled.
    renderer.setRenderTarget(null);
    renderer.render(this.uiScene, this.identity);
  }

  dispose(): void {
    this.ripples.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  private drawScene(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const cam = this.camera;
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(this.world, this.identity);
    // Under the surface: fish, then the water over them, then the land that hides both.
    cam.layers.set(LAYER_RIVER);
    renderer.render(this.actors, cam);
    renderer.render(this.surface, this.identity);
    renderer.clearDepth();
    // Above it: the net and pole, the fisherman in front of the pole, then lantern, basket and caught fish.
    if (this.netVisible) {
      cam.layers.set(LAYER_NET);
      renderer.render(this.actors, cam);
    }
    renderer.render(this.flat, this.identity);
    renderer.clearDepth();
    cam.layers.set(LAYER_BRIDGE);
    renderer.render(this.actors, cam);
    renderer.render(this.fx, this.identity);
    cam.layers.enableAll();
  }

  private quadMaterial(map: THREE.Texture, flat: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: GLSL.QUAD_VERT,
      fragmentShader: GLSL.QUAD_FRAG,
      defines: flat ? { FLAT: '' } : {},
      uniforms: {
        uTarget: this.uiTarget,
        uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
        uMap: { value: map },
        uTint: { value: new THREE.Vector3() },
        uTintMix: { value: 0 },
      },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
  }
}
