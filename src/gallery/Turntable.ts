import * as THREE from 'three';
import { color } from '../render/assets';
import { FishSchool, type FishInstance } from '../render/models/fish';
import { NetProp } from '../render/models/props';

export type TurntableModel = 'bluegill' | 'koi' | 'eel' | 'net';

const NET_RADIUS = 0.05;
/** Radius of the sphere each model must fit in (world units), and where the camera looks. */
const FRAME: Record<TurntableModel, { radius: number; y: number }> = {
  bluegill: { radius: 0.052, y: 0.004 },
  koi: { radius: 0.084, y: 0.002 },
  eel: { radius: 0.106, y: 0.002 },
  net: { radius: NET_RADIUS * 2.45, y: 0 },
};
/** Self-light per model: the eel's stripes burn, the koi only gleams. */
const GLOW: Record<TurntableModel, number> = { bluegill: 0, koi: 0.7, eel: 1, net: 0 };
/** Head to the left and a little toward the viewer, like the v1 sprites. */
const START_YAW: Record<TurntableModel, number> = { bluegill: -1.1, koi: -1.1, eel: -1.2, net: 0.75 };
const FOV = 28;
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 3;
const PITCH_MIN = -0.25;
const PITCH_MAX = 1.45;

/**
 * The Field Guide's 3D well: one game model on a turntable, on its own small renderer (the game's
 * renderer is not touched). Lit like the river scene: moon, sky/ground hemisphere, warm lantern.
 */
export class Turntable {
  readonly canvas: HTMLCanvasElement;
  spin: boolean;
  swim: boolean;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 10);
  private readonly school: FishSchool;
  private readonly net: NetProp;
  private readonly netPivot = new THREE.Group();
  private readonly moonDir = new THREE.Vector3(-0.35, 0.75, -0.55).normalize();
  private readonly hoop = new THREE.Vector3();
  private readonly grip = new THREE.Vector3(0, NET_RADIUS * 0.9, NET_RADIUS * 3.4);
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly listeners = new AbortController();
  private model: TurntableModel = 'bluegill';
  private yaw = START_YAW.bluegill;
  private pitch = 0.62;
  private zoom = 1;
  private phase = 0;
  private time = 0;

  constructor(ramp: THREE.Texture, reducedMotion: boolean) {
    this.spin = !reducedMotion;
    this.swim = !reducedMotion;
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // The scene's lights (SceneRenderer): actor space flips z, so the moon sits behind and above.
    const hemi = new THREE.HemisphereLight(color('#40649a'), color('#0b1622'), 1.5);
    const moon = new THREE.DirectionalLight(color('#b7d2ff'), 2.4);
    moon.position.copy(this.moonDir).multiplyScalar(10);
    const lantern = new THREE.PointLight(color('#ffb060'), 0.03, 1.1, 2);
    lantern.position.set(0.17, 0.11, 0.2);
    this.scene.add(hemi, moon, lantern);

    this.school = new FishSchool(ramp, color('#06121c'), 0);
    this.scene.add(this.school.group);

    this.net = new NetProp(ramp, NET_RADIUS, 0);
    // Turn about the middle of hoop and pole, not the hoop's centre.
    this.net.root.position.set(0, NET_RADIUS * 0.25, -NET_RADIUS * 1.2);
    this.netPivot.add(this.net.root);
    this.scene.add(this.netPivot);

    this.bind();
  }

  setModel(model: TurntableModel): void {
    if (model === this.model) return;
    this.model = model;
    this.yaw = START_YAW[model];
    this.pitch = 0.62;
    this.zoom = 1;
  }

  /** Size of the well in CSS pixels. */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keyboard control: turn, tilt, zoom. */
  nudge(yaw: number, pitch: number, zoom: number): void {
    this.yaw += yaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + pitch, PITCH_MIN, PITCH_MAX);
    this.zoom = THREE.MathUtils.clamp(this.zoom * zoom, ZOOM_MIN, ZOOM_MAX);
  }

  frame(dt: number): void {
    if (this.spin && this.pointers.size === 0) this.yaw += dt * 0.55;
    if (this.swim) {
      this.phase += dt * 7;
      this.time += dt;
    }
    const model = this.model;
    const fit = FRAME[model];
    const half = THREE.MathUtils.degToRad(FOV / 2);
    const distance = (fit.radius * 1.04) / Math.tan(half) / Math.min(1, this.camera.aspect) / this.zoom;
    this.camera.position.set(0, fit.y + Math.sin(this.pitch) * distance, Math.cos(this.pitch) * distance);
    this.camera.lookAt(0, fit.y, 0);
    this.camera.updateMatrixWorld();

    const fish: FishInstance[] = [];
    if (model !== 'net') {
      const pulse = model === 'eel' ? 0.85 + 0.25 * Math.sin(this.time * 5) : 1;
      fish.push({
        kind: model,
        x: 0,
        y: 0,
        z: 0,
        heading: this.yaw,
        pitch: 0,
        scale: 1,
        phase: this.phase,
        fog: 0,
        glow: GLOW[model] * pulse,
        flash: 0,
        flop: 0.35,
      });
    }
    this.school.update(fish);
    this.school.time.value = this.time;
    this.school.moonView.value.copy(this.moonDir).transformDirection(this.camera.matrixWorldInverse);

    this.netPivot.visible = model === 'net';
    if (model === 'net') {
      this.netPivot.rotation.y = this.yaw;
      // "Swim" for the net: the cloth trails and fills as if it were being swept.
      const sweep = this.swim ? Math.sin(this.time * 1.7) * 1.3 : 0;
      const bulge = this.swim ? 0.14 + 0.12 * Math.sin(this.time * 0.9) : 0;
      this.net.update(this.hoop, this.grip, sweep, 0, bulge, dt, 0.3 + 0.2 * Math.sin(this.time * 2.2));
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.listeners.abort();
    this.pointers.clear();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        // The pixel textures the props made for themselves; the gradient ramp belongs to the game.
        const map = (material as THREE.MeshToonMaterial).map;
        if (map) textures.add(map);
        material.dispose();
      }
    });
    textures.forEach((texture) => texture.dispose());
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private bind(): void {
    const { canvas } = this;
    const signal = this.listeners.signal;
    const spread = (): number => {
      const [a, b] = [...this.pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // A synthetic pointer cannot be captured; the drag still works inside the canvas.
        }
        e.preventDefault();
      },
      { signal },
    );
    canvas.addEventListener(
      'pointermove',
      (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const before = spread();
        const dx = e.clientX - p.x;
        const dy = e.clientY - p.y;
        p.x = e.clientX;
        p.y = e.clientY;
        if (this.pointers.size >= 2) {
          const after = spread();
          if (before > 0 && after > 0) this.nudge(0, 0, after / before);
        } else this.nudge(dx * 0.012, dy * 0.008, 1);
      },
      { signal },
    );
    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
    };
    canvas.addEventListener('pointerup', release, { signal });
    canvas.addEventListener('pointercancel', release, { signal });
    canvas.addEventListener('lostpointercapture', release, { signal });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.nudge(0, 0, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      },
      { signal, passive: false },
    );
  }
}
