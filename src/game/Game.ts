import { AudioBus } from '../audio/AudioBus';
import { Loop } from '../core/Loop';
import { RIVER } from '../data/river';
import { Input } from '../input/Input';
import { loadSceneAssets, paletteColor } from '../render/assets';
import { PIXEL_FONT } from '../render/PixelText';
import { SceneRenderer, type FishStyle, type FishView, type FrameView, type LightView } from '../render/SceneRenderer';
import { trackerIntent } from '../sim/bots/tracker';
import { DEFAULT_CONFIG, PHASES, type SimConfig } from '../sim/config';
import type { NetIntent } from '../sim/net';
import { River, type RiverData } from '../sim/river';
import { createRng, type Rng } from '../sim/rng';
import { Sim, type Fish, type LossCause, type SimEvent } from '../sim/sim';
import { Overlay } from '../ui/Overlay';

export type Mode = 'loading' | 'title' | 'playing' | 'paused' | 'over';

const STEP = 1 / 60;
const GRIDS: readonly (readonly [number, number])[] = [
  [192, 344],
  [216, 387],
  [256, 459],
  [384, 688],
];
const DEFAULT_GRID: readonly [number, number] = [216, 387];

const C = {
  eel: paletteColor('#29bbc2'),
  eelHot: paletteColor('#8ff8ff'),
  koi: paletteColor('#ffb347'),
  shimmer: paletteColor('#3b6d92'),
  white: paletteColor('#ffffff'),
  droplet: paletteColor('#9ccbcf'),
  firefly: paletteColor('#ffd98a'),
};

interface Pop {
  text: string;
  age: number;
  fromX: number;
  fromY: number;
  color: string;
}

export interface GameOptions {
  readonly grid?: string | null;
  readonly fish?: string | null;
  readonly forceByteRipples?: boolean;
  readonly seed?: number;
}

export class Game {
  river = new River(RIVER);
  config: SimConfig = DEFAULT_CONFIG;
  mode: Mode = 'loading';
  /** Dev overlays read these. */
  sim!: Sim;
  view!: SceneRenderer;

  private readonly loop = new Loop(
    (delta) => this.frame(delta),
    () => undefined,
  );
  private readonly audio = new AudioBus();
  private readonly overlay: Overlay;
  private input!: Input;
  private fx: Rng = createRng(1);
  private seed: number;
  private accumulator = 0;
  private time = 0;
  private frameCount = 0;
  private frozen = false;
  private reducedMotion = false;
  private autoplay = false;
  private hitstop = 0;
  private lossCause: LossCause | null = null;
  private lossTimer = 0;
  private shock = 0;
  private netKick = 0;
  private banner = 0;
  private bannerText = '';
  private telegraph: { lane: number; age: number } | null = null;
  private fireflyTimer = 0;
  private readonly wake = new Map<number, number>();
  private readonly pops: Pop[] = [];
  private readonly ready: Promise<void>;
  private readonly gridScale: number;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: GameOptions = {},
  ) {
    this.seed = options.seed ?? 1;
    const grid = GRIDS.find(([w, h]) => `${w}x${h}` === options.grid) ?? DEFAULT_GRID;
    this.gridScale = grid[0] / 768;
    this.overlay = new Overlay({
      start: () => this.confirm(),
      resume: () => this.togglePause(),
      retry: () => this.confirm(),
      pause: () => this.togglePause(),
      mute: () => {
        this.audio.setMuted(!this.audio.isMuted);
        this.overlay.setMuted(this.audio.isMuted);
      },
    });
    this.overlay.setMuted(this.audio.isMuted);
    this.sim = new Sim({ seed: this.seed, river: this.river, config: this.config });
    this.installTestHooks();
    this.ready = this.load(grid[0], grid[1]);
  }

  start(): void {
    void this.ready.then(() => this.loop.start());
  }

  dispose(): void {
    this.loop.stop();
    this.input?.dispose();
    this.audio.stopAmbience();
    this.view?.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  /** Dev: swap the river fit and restart on it. */
  applyRiver(data: RiverData): void {
    this.river = new River(data);
    this.startRun();
  }

  setFishStyle(style: FishStyle): void {
    this.view.fishStyle = style;
  }

  togglePause(): void {
    if (this.mode === 'playing') this.setMode('paused');
    else if (this.mode === 'paused') this.setMode('playing');
  }

  private async load(gridW: number, gridH: number): Promise<void> {
    const [assets] = await Promise.all([loadSceneAssets(gridW, gridH), document.fonts.load(`8px ${PIXEL_FONT}`)]);
    this.view = new SceneRenderer(this.canvas, assets, this.river, { forceByteRipples: this.options.forceByteRipples });
    if (this.options.fish === 'voxel') this.view.fishStyle = 'voxel';
    this.input = new Input(this.canvas, {
      rail: () => this.railCss(),
      onPause: () => this.togglePause(),
      onConfirm: () => this.confirm(),
      onFirstGesture: () => {
        void this.audio.unlock().then(() => this.audio.startAmbience());
      },
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'playing') this.setMode('paused');
    });
    window.addEventListener('blur', () => {
      if (this.mode === 'playing') this.setMode('paused');
    });
    this.overlay.setTexel(this.view.layout.scale / (window.devicePixelRatio || 1));
    this.setMode('title');
    this.frame(0);
  }

  private confirm(): void {
    void this.audio.unlock().then(() => this.audio.startAmbience());
    if (this.mode === 'title' || this.mode === 'over') this.startRun();
    else if (this.mode === 'paused') this.setMode('playing');
  }

  private startRun(startPhase = 0, skipRest = false): void {
    this.sim = new Sim({ seed: this.seed, river: this.river, config: this.config, startPhase, skipRest });
    this.fx = createRng(this.seed ^ 0x9e3779b9);
    this.accumulator = 0;
    this.hitstop = 0;
    this.lossCause = null;
    this.lossTimer = 0;
    this.shock = 0;
    this.netKick = 0;
    this.telegraph = null;
    this.pops.length = 0;
    this.wake.clear();
    this.input?.reset();
    this.view?.particles.clear();
    if (this.view) this.view.ripples.clear(this.view.renderer);
    this.setMode('playing');
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.audio.setPaused(mode === 'paused');
    const s = this.sim.state;
    this.overlay.announce(mode, { cause: this.lossCause, caught: s.caught, escaped: s.escaped, bestStreak: s.bestStreak });
    this.canvas.style.cursor = mode === 'playing' ? 'none' : 'default';
  }

  /** CSS-pixel x of lane 0 and lane 1 at the rail, for pointer mapping. */
  private railCss(): { left: number; right: number } {
    const rect = this.canvas.getBoundingClientRect();
    const { originX, scale } = this.view.layout;
    const dpr = window.devicePixelRatio || 1;
    const css = (lane: number): number => rect.left + ((originX + this.river.screenAt(1, lane).x * this.gridScale) * scale) / dpr;
    return { left: css(0), right: css(1) };
  }

  private frame(delta: number): void {
    this.frameCount += 1;
    if (this.view.resize()) this.overlay.setTexel(this.view.layout.scale / (window.devicePixelRatio || 1));
    const dt = this.frozen ? 0 : delta;
    const live = this.mode === 'playing' || (this.mode === 'over' && !this.frozen);

    if (this.mode === 'playing' && dt > 0) {
      if (this.hitstop > 0) this.hitstop -= dt;
      else {
        this.accumulator += dt;
        while (this.accumulator >= STEP) {
          this.accumulator -= STEP;
          const intent: NetIntent = this.autoplay ? trackerIntent(this.sim.state, this.config.net.radius) : this.input.consume();
          this.sim.step(STEP, intent);
          for (const event of this.sim.drainEvents()) this.onEvent(event);
        }
      }
    } else if (this.mode === 'over' && dt > 0) {
      this.sim.step(dt);
      this.sim.drainEvents();
    }

    const animDt = this.mode === 'paused' || this.reducedMotion ? 0 : dt;
    this.time += animDt;
    if (live || this.mode === 'title') this.updateEffects(animDt);
    this.view.render(this.buildView(animDt));
    this.publishDiagnostics();
  }

  private gridPoint(s: number, lane: number): { x: number; y: number; scale: number } {
    const p = this.river.screenAt(s, lane);
    return { x: p.x * this.gridScale, y: p.y * this.gridScale, scale: p.scale };
  }

  private fishPoint(fish: Fish, alpha = 1): { x: number; y: number; scale: number; s: number; lane: number } {
    const u = fish.prevProgress + (fish.progress - fish.prevProgress) * alpha;
    const lane = fish.prevLane + (fish.lane - fish.prevLane) * alpha;
    const s = this.river.progressToS(u);
    return { ...this.gridPoint(s, lane), s, lane };
  }

  private onEvent(event: SimEvent): void {
    const { particles, ripples } = this.view;
    switch (event.type) {
      case 'restStart':
        this.bannerText = event.next.name.toUpperCase();
        this.banner = this.config.restSeconds;
        break;
      case 'phaseStart':
        this.banner = Math.min(this.banner, 0.4);
        break;
      case 'telegraph':
        this.telegraph = { lane: event.lane, age: 0 };
        this.audio.crackle(0.5, 0.22);
        break;
      case 'spawn':
        this.audio.spawn();
        this.telegraph = null;
        break;
      case 'catch': {
        const p = this.fishPoint(event.fish);
        const koi = event.fish.kind === 'koi';
        this.audio.catch(event.streak, koi);
        this.netKick = 0.12;
        ripples.inject(p.x, p.y, koi ? 5 : 4, koi ? 0.9 : 0.7);
        for (let i = 0; i < (koi ? 12 : 7); i++) {
          particles.emit({
            x: p.x + (this.fx.next() - 0.5) * 6,
            y: p.y - 1,
            vx: (this.fx.next() - 0.5) * 30,
            vy: -18 - this.fx.next() * 26,
            gravity: 110,
            life: 0.35 + this.fx.next() * 0.25,
            color: this.fx.next() > 0.5 ? C.droplet : C.white,
          });
        }
        this.pops.push({ text: `+${event.weight}`, age: 0, fromX: p.x, fromY: p.y - 8, color: koi ? '#ffcc66' : '#c7e1e8' });
        if (navigator.vibrate && !this.reducedMotion) navigator.vibrate(koi ? 18 : 8);
        break;
      }
      case 'miss': {
        const p = this.fishPoint(event.fish);
        this.audio.miss();
        ripples.inject(p.x, p.y, 3, 0.5);
        for (let i = 0; i < 3; i++)
          particles.emit({
            x: p.x,
            y: p.y,
            vx: (this.fx.next() - 0.5) * 16,
            vy: -12 - this.fx.next() * 10,
            gravity: 90,
            life: 0.3,
            color: C.droplet,
          });
        break;
      }
      case 'eelNear': {
        const p = this.fishPoint(event.fish);
        this.audio.crackle(0.25, 0.3);
        this.sparks(p.x, p.y, 8);
        break;
      }
      case 'eelCaught': {
        this.audio.zap();
        this.hitstop = 0.12;
        this.shock = 0.0001;
        const net = this.gridPoint(1, this.sim.state.net.lane);
        // Lightning runs up the pole to the fisherman's hands.
        for (let i = 0; i <= 14; i++) {
          const f = i / 14;
          this.sparks(net.x + (this.view.grip.x - net.x) * f, net.y + (this.view.grip.y - net.y) * f, 2, 0.5);
        }
        if (navigator.vibrate && !this.reducedMotion) navigator.vibrate([40, 30, 80]);
        break;
      }
      case 'lose':
        this.lossCause = event.cause;
        this.lossTimer = event.cause === 'eel' ? 1.25 : 0.7;
        break;
      case 'win':
        this.lossCause = null;
        this.lossTimer = 0.7;
        break;
    }
  }

  private sparks(x: number, y: number, count: number, life = 0.2): void {
    for (let i = 0; i < count; i++) {
      this.view.particles.emit({
        x: x + (this.fx.next() - 0.5) * 8,
        y: y + (this.fx.next() - 0.5) * 6,
        vx: (this.fx.next() - 0.5) * 50,
        vy: (this.fx.next() - 0.5) * 50,
        life: life * (0.5 + this.fx.next()),
        color: this.fx.next() > 0.5 ? C.eelHot : C.white,
      });
    }
  }

  /** Render-side effects driven by time: wakes, sparks, fireflies, end-of-run sequences. */
  private updateEffects(dt: number): void {
    if (dt <= 0) return;
    const { particles, ripples } = this.view;
    const state = this.sim.state;
    this.netKick = Math.max(0, this.netKick - dt);
    this.banner = Math.max(0, this.banner - dt);
    if (this.telegraph) this.telegraph.age += dt;
    for (const pop of this.pops) pop.age += dt;
    while (this.pops[0] && this.pops[0].age > 0.7) this.pops.shift();

    if (this.shock > 0) this.shock += dt;
    if (this.lossTimer > 0 && this.mode === 'playing' && state.status !== 'playing') {
      this.lossTimer -= dt;
      if (this.lossTimer <= 0) this.setMode('over');
    }

    for (const fish of state.fish) {
      const p = this.fishPoint(fish);
      const rel = p.scale / this.river.screenAt(1, 0.5).scale;
      const last = this.wake.get(fish.id) ?? 0;
      if (fish.status === 'swimming' && this.time - last > 0.14 && rel > 0.2) {
        this.wake.set(fish.id, this.time);
        ripples.inject(p.x, p.y - 3 * rel, 1.2 + 2 * rel, 0.16 + 0.2 * rel);
      }
      if (fish.kind === 'eel' && fish.status === 'swimming' && rel > 0.22 && this.fx.next() < dt * (fish.firstEel ? 22 : 12)) {
        particles.emit({
          x: p.x + (this.fx.next() - 0.5) * 10 * rel,
          y: p.y + (this.fx.next() - 0.6) * 22 * rel,
          life: 0.1 + this.fx.next() * 0.1,
          color: this.fx.next() > 0.4 ? C.eelHot : C.white,
        });
      }
    }
    if (state.fish.length === 0) this.wake.clear();
    if (Math.abs(state.net.velocity) > 0.5 && this.mode === 'playing' && this.fx.next() < dt * 14) {
      const net = this.gridPoint(1, state.net.lane);
      ripples.inject(net.x, net.y, 3, 0.14);
    }

    // Fireflies over the banks; calm nights have more of them.
    this.fireflyTimer -= dt;
    if (this.fireflyTimer <= 0) {
      this.fireflyTimer = 0.5 + this.fx.next() * 0.6;
      const left = this.fx.next() < 0.55;
      const gw = this.view.assets.gridW;
      const gh = this.view.assets.gridH;
      particles.emit({
        x: (left ? 0.04 + this.fx.next() * 0.3 : 0.7 + this.fx.next() * 0.27) * gw,
        y: (0.3 + this.fx.next() * 0.3) * gh,
        vx: (this.fx.next() - 0.5) * 4,
        vy: -1 - this.fx.next() * 3,
        life: 4 + this.fx.next() * 4,
        blink: 0.5 + this.fx.next() * 0.5,
        color: C.firefly,
      });
    }
  }

  private buildView(dt: number): FrameView {
    const state = this.sim.state;
    const alpha = this.mode === 'playing' && this.hitstop <= 0 ? this.accumulator / STEP : 1;
    const railScale = this.river.screenAt(1, 0.5).scale;
    const gs = this.view.assets.gridW / 216;
    const lights: LightView[] = [];
    const fish: FishView[] = [];

    const ordered = [...state.fish].sort((a, b) => a.progress - b.progress);
    for (const f of ordered) {
      const p = this.fishPoint(f, alpha);
      const rel = p.scale / railScale;
      const tangent = this.river.screenTangent(p.s, p.lane);
      const a = this.river.pointAt(p.s, p.lane);
      const b = this.river.pointAt(Math.min(this.river.maxS, p.s + 0.004), p.lane);
      const rate = f.kind === 'bluegill' ? 9 : f.kind === 'koi' ? 7 : 6;
      fish.push({
        kind: f.kind,
        x: p.x,
        y: p.y,
        rel,
        slope: tangent.y > 0.25 ? tangent.x / tangent.y : Math.sign(tangent.x) * 0.7,
        phase: this.time * rate * (f.status === 'scooped' ? 2.2 : 1) + f.id * 1.7,
        scoop: f.scoop,
        flash: f.status === 'scooped' ? (f.scoop > 0.7 ? 0.8 : 0) : 0,
        worldX: a.x,
        worldZ: a.z,
        heading: Math.atan2(b.x - a.x, a.z - b.z),
      });
      if (f.status !== 'swimming') continue;
      if (f.kind === 'eel') {
        const pulse = f.firstEel ? 0.75 + 0.25 * Math.sin(this.time * 9) : 0.55;
        lights.push({ x: p.x, y: p.y, radius: (5 + 12 * rel) * gs * (f.firstEel ? 1.5 : 1), intensity: pulse, color: C.eel });
      } else if (f.kind === 'koi') {
        lights.push({ x: p.x, y: p.y, radius: (3 + 7 * rel) * gs, intensity: 0.3, color: C.koi });
      }
    }
    // Nearest lights win the eight slots.
    lights.reverse();
    lights.length = Math.min(lights.length, 6);

    // The emitter's lane shimmers at the far bend; an incoming eel glows cold blue there.
    if (this.mode === 'playing' && !state.resting) {
      const e = this.gridPoint(0.04, state.emitter.lane);
      const flick = Math.floor(this.time * 6) % 2 === 0 ? 0.5 : 0.3;
      lights.push({ x: e.x, y: e.y, radius: 4 * gs, intensity: flick, color: C.shimmer });
    }
    if (this.telegraph) {
      const e = this.gridPoint(0.04, this.telegraph.lane);
      const grow = Math.min(1, this.telegraph.age / this.config.telegraphLead);
      lights.push({ x: e.x, y: e.y, radius: (4 + 7 * grow) * gs, intensity: 0.5 + 0.4 * grow, color: C.eel });
    }

    const net = this.gridPoint(1, state.net.prevLane + (state.net.lane - state.net.prevLane) * alpha);
    const railPx = (this.river.screenAt(1, 1).x - this.river.screenAt(1, 0).x) * this.gridScale;

    // Eel shock: glitch, the river goes dark, the neon dies.
    const shock = this.shock;
    const darken = shock > 0 ? Math.min(0.55, shock * 1.6) : 0;
    const neonOut = shock > 0 ? (shock > 0.6 ? 0.12 : Math.floor(shock * 14) % 2 === 0 ? 1 : 0.2) : 1;
    const flicker = Math.floor(this.time * 7) % 5 === 0 ? 0.82 : 1;

    const dim = this.mode === 'title' ? 0.3 : this.mode === 'paused' ? 0.45 : this.mode === 'over' ? 0.5 : 0;
    this.drawHud();
    this.drawScreens();
    return {
      time: this.time,
      dt,
      fish,
      netX: net.x,
      netY: net.y,
      netRadius: Math.round(this.config.net.radius * railPx),
      netKick: this.netKick > 0.06 ? 1 : 0,
      netVisible: this.mode !== 'title',
      lights,
      lantern: (0.92 + 0.08 * Math.sin(this.time * 2.3)) * flicker * (1 - darken),
      breath: Math.sin(this.time * 1.4) > 0.3 ? 1 : 0,
      lean: this.mode === 'title' ? 0 : state.net.lane < 0.33 ? -1 : state.net.lane > 0.72 ? 1 : 0,
      jolt: shock > 0 && shock < 0.5 ? (Math.floor(shock * 30) % 2 === 0 ? 1 : -1) : 0,
      darken: Math.max(darken, dim),
      neon: neonOut,
      glitch: shock > 0 && shock < 0.05 && !this.reducedMotion ? 2 : 0,
    };
  }

  /** In-canvas HUD on the shared grid: stone tablet, streak, banner, weight pops. */
  private drawHud(): void {
    const v = this.view;
    const { originX, originY, targetW, targetH } = v.layout;
    const { gridW, gridH } = v.assets;
    const s = this.sim.state;
    const show = this.mode === 'playing' || this.mode === 'paused' || this.mode === 'over';

    const gutter = targetH - (originY + gridH);
    const w = 100;
    const h = 23;
    const x = gutter >= h + 6 ? Math.floor(targetW / 2 - w / 2) : originX + 4;
    const y = gutter >= h + 6 ? originY + gridH + Math.floor((gutter - h) / 2) : originY + gridH - h - 5;
    v.panel('hud-edge', x - 1, y - 1, w + 2, h + 2, show ? '#030911' : null);
    v.panel('hud-body', x, y, w, h, show ? '#404d51' : null);
    v.panel('hud-lip', x, y, w, 1, show ? '#5f696c' : null);
    v.label('hud-caught-label', show ? 'CAUGHT' : '', x + 5, y + 3, '#a1987a');
    v.label('hud-caught', show ? `${s.caught}/${this.config.winWeight}` : '', x + 5, y + 12, '#9ccbcf');
    v.label('hud-escaped-label', show ? 'ESCAPED' : '', x + 53, y + 3, '#a1987a');
    const danger = s.escaped >= this.config.maxEscaped - 6;
    v.label('hud-escaped', show ? `${s.escaped}/${this.config.maxEscaped}` : '', x + 53, y + 12, danger ? '#ff9933' : '#9ccbcf');
    v.label('hud-streak', show && s.streak >= 3 ? `x${s.streak}` : '', x + w + 4, y + 8, '#ffd98a');

    // Phase banner: a hanging wooden sign over the sky, clear of the river's path.
    const banner = this.banner > 0 && (this.mode === 'playing' || this.mode === 'paused');
    const bw = this.bannerText.length * 6 + 14;
    const bx = Math.floor(originX + gridW / 2 - bw / 2);
    const by = originY + Math.floor(gridH * 0.035);
    v.panel('banner-edge', bx - 1, by - 1, bw + 2, 15, banner ? '#030911' : null);
    v.panel('banner-body', bx, by, bw, 13, banner ? '#834433' : null);
    v.label('banner-text', banner ? this.bannerText : '', originX + gridW / 2, by + 3, '#ffd98a', 'center');

    for (let i = 0; i < 6; i++) {
      const pop = this.pops[i];
      if (!pop) {
        v.label(`pop-${i}`, '', 0, 0, '#ffffff');
        continue;
      }
      // Rise from the net, then fly to the tablet.
      const t = Math.min(1, pop.age / 0.7);
      const fly = Math.max(0, (t - 0.35) / 0.65);
      const px = originX + pop.fromX + (x + 20 - (originX + pop.fromX)) * fly * fly;
      const py = originY + pop.fromY - 10 * Math.min(1, t / 0.35) + (y + 10 - (originY + pop.fromY - 10)) * fly * fly;
      v.label(`pop-${i}`, pop.text, px, py, pop.color, 'center');
    }
  }

  /** Title, pause and end screens, drawn on the grid; the DOM only supplies hit areas. */
  private drawScreens(): void {
    const v = this.view;
    const { originY, targetW, targetH } = v.layout;
    const { gridH } = v.assets;
    const s = this.sim.state;
    const cx = Math.floor(targetW / 2);
    const top = Math.max(0, originY);
    const height = Math.min(targetH, originY + gridH) - top;
    const at = (f: number): number => top + Math.floor(height * f);
    const text = (id: string, on: boolean, str: string, y: number, color: string): void => {
      v.label(id, on ? str : '', cx, y, color, 'center');
    };
    const button = (name: 'start' | 'resume' | 'retry', on: boolean, str: string, y: number): void => {
      const tw = v.label(`btn-${name}-text`, on ? str : '', cx, y + 6, '#ffd98a', 'center');
      const w = tw + 16;
      const x = cx - Math.ceil(w / 2);
      v.panel(`btn-${name}-edge`, x - 1, y - 1, w + 2, 22, on ? '#030911' : null, 12);
      v.panel(`btn-${name}-body`, x, y, w, 20, on ? '#604336' : null, 13);
      v.panel(`btn-${name}-lip`, x, y, w, 1, on ? '#a0977a' : null, 14);
      this.overlay.place(name, on ? { x: x - 1, y: y - 1, w: w + 2, h: 22 } : null);
    };

    const title = this.mode === 'title';
    text('title-logo', title, 'N E O N   R I V E R', at(0.27), '#8ff8ff');
    text('title-sub', title, 'A NIGHT ON THE WATER', at(0.27) + 13, '#6d9bb1');
    text('title-rule-1', title, 'CATCH 200 LB', at(0.42), '#c5e1e8');
    text('title-rule-2', title, 'LET NO MORE THAN 20 LB ESCAPE', at(0.42) + 11, '#c5e1e8');
    text('title-rule-3', title, 'NEVER NET AN ELECTRIC EEL', at(0.42) + 22, '#c5e1e8');
    button('start', title, 'TAP TO FISH', at(0.58));
    text('title-hint', title, 'DRAG - MOUSE - A/D - GAMEPAD', at(0.58) + 30, '#6d9bb1');

    const paused = this.mode === 'paused';
    text('paused-title', paused, 'P A U S E D', at(0.36), '#8ff8ff');
    button('resume', paused, 'RESUME', at(0.44));

    const over = this.mode === 'over';
    const won = this.lossCause === null;
    text('over-title', over, won ? 'A   F U L L   N E T' : 'T H E   N I G H T   E N D S', at(0.3), won ? '#ffd98a' : '#8ff8ff');
    const cause = won ? 'THE RIVER PROVIDES' : this.lossCause === 'eel' ? 'AN ELECTRIC EEL FOUND YOUR NET' : 'TOO MANY FISH SLIPPED AWAY';
    text('over-cause', over, cause, at(0.3) + 14, '#c5e1e8');
    text('over-stats-1', over, `${s.caught} LB CAUGHT - ${s.escaped} LB ESCAPED`, at(0.3) + 30, '#6d9bb1');
    text('over-stats-2', over, `BEST STREAK ${s.bestStreak}`, at(0.3) + 41, '#6d9bb1');
    button('retry', over, 'FISH AGAIN', at(0.3) + 58);

    // Pause and sound, top-left, clear of the river.
    const controls = this.mode === 'playing' || this.mode === 'paused';
    v.panel('ctl-pause-body', 3, 3, 13, 13, controls ? '#091a27' : null, 12);
    v.label('ctl-pause-text', controls ? (paused ? '>' : 'II') : '', 10, 6, '#99c8cd', 'center');
    const sound = this.audio.isMuted ? 'MUTED' : 'SOUND';
    v.panel('ctl-mute-body', 18, 3, 33, 13, controls ? '#091a27' : null, 12);
    v.label('ctl-mute-text', controls ? sound : '', 35, 6, this.audio.isMuted ? '#6d9bb1' : '#99c8cd', 'center');
    this.overlay.place('pause', controls ? { x: 2, y: 2, w: 15, h: 15 } : null);
    this.overlay.place('mute', controls ? { x: 18, y: 2, w: 34, h: 15 } : null);
  }

  private installTestHooks(): void {
    const phaseIds = PHASES.map((p) => p.id);
    const settle = (seconds: number, opts: { startPhase?: number; skipRest?: boolean; idle?: boolean } = {}): void => {
      this.frozen = false;
      this.startRun(opts.startPhase ?? 0, opts.skipRest ?? false);
      this.autoplay = !opts.idle;
      const warm = 1.5;
      for (let t = 0; t < seconds - warm && this.sim.state.status === 'playing'; t += STEP) {
        this.sim.step(STEP, opts.idle ? { kind: 'none' } : trackerIntent(this.sim.state, this.config.net.radius));
        for (const e of this.sim.drainEvents()) if (e.type === 'restStart' || e.type === 'phaseStart') this.onEvent(e);
      }
      // The last stretch runs through the full frame path so wakes, ripples and particles exist.
      for (let t = 0; t < warm && this.mode === 'playing'; t += STEP) this.frame(STEP);
      this.autoplay = false;
    };
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seed = value;
      },
      setState: async (name: string) => {
        await this.ready;
        const phase = /^phase[:.](.+)$/.exec(name);
        if (name === 'title') {
          this.frozen = false;
          this.setMode('title');
        } else if (name === 'active-play') settle(9);
        else if (phase && phaseIds.includes(phase[1] ?? '')) settle(5, { startPhase: phaseIds.indexOf(phase[1] ?? ''), skipRest: true });
        else if (name === 'rest') settle(12.7);
        else if (name === 'pause') {
          settle(9);
          this.setMode('paused');
        } else if (name === 'loss-eel') {
          settle(12);
          this.sim.debugSpawn('eel', this.sim.state.net.lane, 0.97);
          this.autoplay = false;
          for (let i = 0; i < 240 && this.mode !== 'over'; i++) this.frame(STEP);
        } else if (name === 'loss-escaped') {
          settle(60, { idle: true });
          for (let i = 0; i < 120 && this.mode !== 'over'; i++) this.frame(STEP);
        } else throw new Error(`Unknown test state: ${name}`);
        this.frame(0);
        return { state: name };
      },
      setPausedForScreenshot: (paused: boolean) => {
        this.frozen = paused;
      },
      setReducedMotion: (enabled: boolean) => {
        this.reducedMotion = enabled;
      },
      hideDebugUi: (hidden: boolean) => {
        document.documentElement.classList.toggle('hide-debug', hidden);
      },
      setAutoplay: (enabled: boolean) => {
        this.autoplay = enabled;
      },
      paletteReport: () => {
        const frame = this.view.readFrame();
        const palette = new Set<number>();
        const tex = this.view.assets.paletteTexture.image.data as Uint8Array;
        for (let i = 0; i < tex.length; i += 4) palette.add(((tex[i] ?? 0) << 16) | ((tex[i + 1] ?? 0) << 8) | (tex[i + 2] ?? 0));
        const used = new Set<number>();
        let off = 0;
        for (let i = 0; i < frame.data.length; i += 4) {
          const c = ((frame.data[i] ?? 0) << 16) | ((frame.data[i + 1] ?? 0) << 8) | (frame.data[i + 2] ?? 0);
          used.add(c);
          if (!palette.has(c)) off++;
        }
        return { texels: frame.data.length / 4, offPalette: off, colorsUsed: used.size, paletteSize: palette.size };
      },
    };
  }

  private publishDiagnostics(): void {
    const info = this.view.renderer.info;
    const s = this.sim.state;
    const { layout } = this.view;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frameCount,
      elapsed: s.time,
      mode: this.mode,
      phase: s.phase.id,
      resting: s.resting,
      status: s.status,
      lossCause: s.lossCause,
      caught: s.caught,
      escaped: s.escaped,
      streak: s.streak,
      fish: s.fish.length,
      net: { lane: s.net.lane, velocity: s.net.velocity },
      fishStyle: this.view.fishStyle,
      audioErrors: this.audio.errors.length,
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: window.devicePixelRatio || 1,
      },
      layout: { scale: layout.scale, targetW: layout.targetW, targetH: layout.targetH, gridW: layout.gridW, gridH: layout.gridH },
      rippleEncoding: this.view.ripples.byteEncoded ? 'byte' : 'half-float',
    };
  }
}
