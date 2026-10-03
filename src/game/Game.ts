import { AudioBus } from '../audio/AudioBus';
import { Loop } from '../core/Loop';
import { RIVER } from '../data/river';
import { Input } from '../input/Input';
import * as THREE from 'three';
import { color, loadSceneAssets } from '../render/assets';
import type { FishInstance } from '../render/models/fish';
import { PIXEL_FONT, TITLE_FONT } from '../render/PixelText';
import { SceneRenderer, type ActorResolution, type FrameView, type WaterLight } from '../render/SceneRenderer';
import { trackerIntent } from '../sim/bots/tracker';
import { DEFAULT_CONFIG, PHASES, type FishKind, type SimConfig } from '../sim/config';
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

const VOLUME_KEYS = ['music', 'ambience', 'sfx'] as const;
const SCOOP_TIME = 0.34;
/** Progress at which the emitter's lane is shown: the first place the river is wide enough to read it. */
const EMITTER_READ = 0.24;
const TOSS_TIME = 0.5;

const C = {
  eel: color('#39e6ee'),
  eelHot: color('#8ff8ff'),
  koi: color('#ffb347'),
  shimmer: color('#9fd8e8'),
  wake: color('#bfe6f0'),
  white: color('#ffffff'),
  droplet: color('#9ccbcf'),
  firefly: color('#ffd98a'),
};

/** A caught fish between the net and the basket. */
interface Carried {
  kind: FishKind;
  x: number;
  y: number;
  z: number;
  heading: number;
}

interface Pop {
  text: string;
  age: number;
  fromX: number;
  fromY: number;
  color: string;
}

export interface GameOptions {
  readonly grid?: string | null;
  /** '3x' renders the 3D layer at three pixels per painting texel instead of device pixels. */
  readonly actors?: string | null;
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
    (delta) => {
      this.watchFrameRate();
      this.frame(delta);
    },
    () => undefined,
  );
  private lastFrameAt = 0;
  private slowFrames = 0;
  private settleFrames = 90;
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
  /** A pinned seed (URL or test hook) replays the same night; otherwise each run is new. */
  private seedPinned = false;
  private runCount = 0;
  private hitstop = 0;
  private lossCause: LossCause | null = null;
  private lossTimer = 0;
  private shock = 0;
  private scoop = 0;
  private bulge = 0;
  private drip = 0;
  private basketWeight = 0;
  private readonly held = new Map<number, Carried>();
  private readonly tosses: (Carried & { age: number })[] = [];
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
    this.seedPinned = options.seed !== undefined;
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
      volume: (key, value) => {
        this.audio.setVolume(key, value);
        if (key === 'sfx') this.audio.preview();
      },
    });
    for (const key of VOLUME_KEYS) this.overlay.setRange(key, this.audio.getVolume(key));
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
    this.audio.stopLoops();
    this.view?.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
  }

  /** Dev: swap the river fit and restart on it. */
  applyRiver(data: RiverData): void {
    this.river = new River(data);
    this.startRun();
  }

  togglePause(): void {
    if (this.mode === 'playing') this.setMode('paused');
    else if (this.mode === 'paused') this.setMode('playing');
  }

  private async load(gridW: number, gridH: number): Promise<void> {
    const [assets] = await Promise.all([
      loadSceneAssets(gridW, gridH, this.river),
      document.fonts.load(`8px ${PIXEL_FONT}`),
      document.fonts.load(`16px ${TITLE_FONT}`),
    ]);
    this.view = new SceneRenderer(this.canvas, assets, this.river, {
      forceByteRipples: this.options.forceByteRipples,
      actors: (this.options.actors === '3x' || this.options.actors === 'device' ? this.options.actors : 'auto') as ActorResolution,
      netRadius: this.config.net.radius * this.river.railWidth,
    });
    this.input = new Input(this.canvas, {
      rail: () => this.railCss(),
      onPause: () => this.togglePause(),
      onConfirm: () => this.confirm(),
      onFirstGesture: () => {
        void this.audio.unlock().then(() => this.audio.startLoops());
      },
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'playing') this.setMode('paused');
      // A hidden tab is silent in every mode; a paused game keeps its beds so the mix can be set by ear.
      this.audio.setPaused(document.hidden);
    });
    window.addEventListener('blur', () => {
      if (this.mode === 'playing') this.setMode('paused');
    });
    this.overlay.setTexel(this.view.layout.scale / (window.devicePixelRatio || 1));
    this.setMode('title');
    this.frame(0);
  }

  /** Slow GPU (weak phone, software rendering): drop the 3D layer's resolution, then the bloom. */
  private watchFrameRate(): void {
    const now = performance.now();
    const elapsed = now - this.lastFrameAt;
    this.lastFrameAt = now;
    if (this.settleFrames > 0 || document.hidden || elapsed > 500) {
      this.settleFrames = Math.max(0, this.settleFrames - 1);
      return;
    }
    // Count frames slower than ~36 fps; a run of them means the device cannot hold the load.
    this.slowFrames = elapsed > 28 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 24) {
      this.slowFrames = 0;
      this.settleFrames = 60;
      this.view.lowerQuality();
    }
  }

  private confirm(): void {
    void this.audio.unlock().then(() => this.audio.startLoops());
    if (this.mode === 'title' || this.mode === 'over') this.startRun();
    else if (this.mode === 'paused') this.setMode('playing');
  }

  private startRun(startPhase = 0, skipRest = false): void {
    // Wall-clock time only picks the seed; the run itself stays deterministic for that seed.
    if (!this.seedPinned) this.seed = (Date.now() + this.runCount * 7919) >>> 0;
    this.runCount += 1;
    this.sim = new Sim({ seed: this.seed, river: this.river, config: this.config, startPhase, skipRest });
    this.fx = createRng(this.seed ^ 0x9e3779b9);
    this.accumulator = 0;
    this.hitstop = 0;
    this.lossCause = null;
    this.lossTimer = 0;
    this.shock = 0;
    this.scoop = 0;
    this.bulge = 0;
    this.drip = 0;
    this.basketWeight = 0;
    this.held.clear();
    this.tosses.length = 0;
    this.telegraph = null;
    this.pops.length = 0;
    this.wake.clear();
    this.input?.reset();
    this.view?.particles.clear();
    if (this.view) this.view.ripples.clear(this.view.renderer);
    this.setMode('playing');
  }

  private setMode(mode: Mode): void {
    if (mode === 'playing' && this.mode === 'paused') this.input?.flush();
    this.mode = mode;
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
        this.audio.banner();
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
        // Mirror onto the rising half at the same height, so the lift never jumps.
        if (this.scoop === 0) this.scoop = 0.0001;
        else if (this.scoop > SCOOP_TIME / 2) this.scoop = SCOOP_TIME - this.scoop;
        this.bulge = 1;
        this.drip = 0.9;
        ripples.inject(p.x, p.y, koi ? 5 : 4, koi ? 0.9 : 0.7);
        for (let i = 0; i < (koi ? 14 : 9); i++) {
          particles.emit({
            x: p.x + (this.fx.next() - 0.5) * 7,
            y: p.y - 1,
            vx: (this.fx.next() - 0.5) * 34,
            vy: -20 - this.fx.next() * 30,
            gravity: 120,
            life: 0.4 + this.fx.next() * 0.25,
            color: C.droplet,
            size: 0.9 + this.fx.next() * 0.9,
            glow: 0.9,
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
        for (let i = 0; i < 4; i++)
          particles.emit({
            x: p.x,
            y: p.y,
            vx: (this.fx.next() - 0.5) * 18,
            vy: -12 - this.fx.next() * 12,
            gravity: 100,
            life: 0.3,
            color: C.droplet,
            glow: 0.7,
          });
        break;
      }
      case 'eelNear': {
        const p = this.fishPoint(event.fish);
        this.audio.crackle(0.25, 0.3);
        this.sparks(p.x, p.y, 10);
        break;
      }
      case 'eelCaught': {
        this.audio.zap();
        this.hitstop = 0.12;
        this.shock = 0.0001;
        // Lightning runs up the pole to the fisherman's hands.
        const net = this.gridPoint(1, this.sim.state.net.lane);
        const grip = this.view.toTexel(this.view.grip);
        for (let i = 0; i <= 16; i++) {
          const f = i / 16;
          this.sparks(net.x + (grip.x - net.x) * f, net.y + (grip.y - net.y) * f, 2, 0.5);
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
        vx: (this.fx.next() - 0.5) * 60,
        vy: (this.fx.next() - 0.5) * 60,
        life: life * (0.5 + this.fx.next()),
        color: this.fx.next() > 0.5 ? C.eelHot : C.white,
        size: 0.8 + this.fx.next() * 0.8,
        glow: 3,
      });
    }
  }

  /** Render-side effects driven by time: wakes, sparks, fireflies, the scoop, end-of-run sequences. */
  private updateEffects(dt: number): void {
    if (dt <= 0) return;
    const { particles, ripples } = this.view;
    const state = this.sim.state;
    this.banner = Math.max(0, this.banner - dt);
    if (this.telegraph) this.telegraph.age += dt;
    for (const pop of this.pops) pop.age += dt;
    while (this.pops[0] && this.pops[0].age > 0.7) this.pops.shift();

    // Scoop: the hoop lifts and tips, the cloth swells, then both settle.
    if (this.scoop > 0) {
      this.scoop += dt;
      if (this.scoop > SCOOP_TIME) this.scoop = 0;
    }
    this.bulge = Math.max(0, this.bulge - dt * 2.2);
    if (this.drip > 0) {
      this.drip -= dt;
      if (this.fx.next() < dt * 26) {
        const net = this.gridPoint(1, state.net.lane);
        particles.emit({
          x: net.x + (this.fx.next() - 0.5) * 12,
          y: net.y - 2 - this.scoopLift() * 6,
          vy: 10,
          gravity: 90,
          life: 0.35,
          color: C.droplet,
          size: 0.8,
          glow: 0.8,
        });
      }
    }

    // Caught fish leave the net for the basket; the basket only fills when they land.
    const live = new Set(state.fish.map((f) => f.id));
    for (const [id, held] of this.held) {
      if (live.has(id)) continue;
      this.held.delete(id);
      this.tosses.push({ ...held, age: 0 });
    }
    for (const toss of this.tosses) toss.age += dt;
    while (this.tosses[0] && this.tosses[0].age >= TOSS_TIME) {
      const landed = this.tosses.shift();
      if (landed) this.basketWeight += this.config.weights[landed.kind];
    }

    if (this.shock > 0) this.shock += dt;
    if (this.lossTimer > 0 && this.mode === 'playing' && state.status !== 'playing') {
      this.lossTimer -= dt;
      if (this.lossTimer <= 0) this.setMode('over');
    }

    const railScale = this.river.screenAt(1, 0.5).scale;
    for (const fish of state.fish) {
      const p = this.fishPoint(fish);
      const rel = p.scale / railScale;
      const last = this.wake.get(fish.id) ?? 0;
      // A faint wake line carries the read at the far bend, where the fish itself is tiny.
      if (fish.status === 'swimming' && this.time - last > 0.12) {
        this.wake.set(fish.id, this.time);
        ripples.inject(p.x, p.y - 2 * rel, 1 + 1.6 * rel, 0.16 + 0.12 * rel);
        // Far up the river the fish is a few pixels; a short bright wake line carries the read.
        if (fish.progress < 0.6)
          particles.emit({
            x: p.x,
            y: p.y,
            life: 0.7,
            color: fish.kind === 'eel' ? C.eel : fish.kind === 'koi' ? C.koi : C.wake,
            size: 1.1 + 1.4 * rel,
            glow: fish.kind === 'bluegill' ? 0.85 : 1.3,
          });
      }
      if (fish.kind === 'eel' && fish.status === 'swimming' && rel > 0.2 && this.fx.next() < dt * (fish.firstEel ? 26 : 14)) {
        // Arcs crawl along the body.
        particles.emit({
          x: p.x + (this.fx.next() - 0.5) * 12 * rel,
          y: p.y + (this.fx.next() - 0.6) * 26 * rel,
          vx: (this.fx.next() - 0.5) * 30,
          vy: (this.fx.next() - 0.5) * 30,
          life: 0.08 + this.fx.next() * 0.1,
          color: this.fx.next() > 0.4 ? C.eelHot : C.white,
          size: 0.6 + rel,
          glow: 2.6,
        });
      }
      if (fish.kind === 'koi' && fish.status === 'swimming' && rel > 0.3 && this.fx.next() < dt * 1.6) {
        particles.emit({ x: p.x + (this.fx.next() - 0.5) * 6, y: p.y - 3 * rel, life: 0.35, color: C.koi, size: 1.2, glow: 1.6 });
      }
    }
    if (state.fish.length === 0) this.wake.clear();
    if (Math.abs(state.net.velocity) > 0.5 && this.mode === 'playing' && this.fx.next() < dt * 16) {
      const net = this.gridPoint(1, state.net.lane);
      ripples.inject(net.x, net.y, 3, 0.16);
    }

    // Fireflies over the banks.
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
        blink: 1.2 + this.fx.next() * 1.2,
        color: C.firefly,
        size: 1.5,
        glow: 2.2,
      });
    }
  }

  private scoopLift(): number {
    return this.scoop > 0 ? Math.sin((this.scoop / SCOOP_TIME) * Math.PI) : 0;
  }

  private buildView(dt: number): FrameView {
    const state = this.sim.state;
    const river = this.river;
    const alpha = this.mode === 'playing' && this.hitstop <= 0 ? this.accumulator / STEP : 1;
    const railScale = river.screenAt(1, 0.5).scale;
    const waterLights: WaterLight[] = [];
    const eelLights: { x: number; z: number; intensity: number }[] = [];
    const fish: FishInstance[] = [];
    const airFish: FishInstance[] = [];

    const netLane = state.net.prevLane + (state.net.lane - state.net.prevLane) * alpha;
    const netWorld = river.pointAt(1, netLane);
    const lift = this.scoopLift();
    const netRadius = this.config.net.radius * river.railWidth;

    const ordered = [...state.fish].sort((a, b) => a.progress - b.progress);
    for (const f of ordered) {
      const p = this.fishPoint(f, alpha);
      const a = river.pointAt(p.s, p.lane);
      const b = river.pointAt(Math.min(river.maxS, p.s + 0.004), p.lane);
      const heading = Math.atan2(b.x - a.x, a.z - b.z);
      const rate = f.kind === 'bluegill' ? 11 : f.kind === 'koi' ? 8 : 7;
      const phase = this.time * rate + f.id * 1.7;
      const u = f.prevProgress + (f.progress - f.prevProgress) * alpha;
      // A fish rises steadily as it nears the net: depth, fog and brightness all change together.
      const rise = THREE.MathUtils.smoothstep(u, 0.15, 0.95);
      const eel = f.kind === 'eel';

      if (f.status === 'scooped') {
        // In the net: lifted clear of the water, flopping in the mesh.
        const k = 1 - f.scoop;
        this.held.set(f.id, { kind: f.kind, x: netWorld.x, y: netRadius * (0.2 + lift * 1.0), z: -netWorld.z, heading });
        airFish.push({
          kind: f.kind,
          x: a.x + (netWorld.x - a.x) * Math.min(1, k * 2.5),
          y: -0.01 + (netRadius * (0.2 + lift * 1.0) + 0.01) * Math.min(1, k * 2),
          z: -(a.z + (netWorld.z - a.z) * Math.min(1, k * 2.5)),
          heading: heading + Math.sin(this.time * 30 + f.id) * 0.7,
          pitch: Math.sin(this.time * 24 + f.id) * 0.4,
          scale: 0.95,
          phase: phase * 2.4,
          fog: 0,
          glow: eel ? 2 : 0.5,
          flash: Math.max(0, 0.5 - k * 2),
          flop: 1.6,
        });
        continue;
      }

      const pulse = eel ? 0.75 + 0.25 * Math.sin(this.time * (f.firstEel ? 11 : 7) + f.id) : 0.5 + 0.5 * Math.sin(this.time * 3 + f.id);
      fish.push({
        kind: f.kind,
        x: a.x,
        y: -(0.05 - 0.04 * rise),
        z: -a.z,
        heading,
        pitch: 0,
        scale: 1.35,
        phase,
        fog: (eel ? 0.3 : 0.36) * (1 - rise) + 0.05,
        glow: eel ? 0.7 + 0.5 * pulse : f.kind === 'koi' ? 0.35 * pulse * rise : 0,
        flash: 0,
        flop: 0,
      });
      if (f.status !== 'swimming') continue;
      const rel = p.scale / railScale;
      if (eel) {
        waterLights.push({
          x: a.x,
          z: a.z,
          radius: 0.07 + 0.05 * (f.firstEel ? 1.5 : 1),
          intensity: (0.5 + 0.35 * pulse) * (0.5 + 0.5 * rel),
          color: C.eel,
        });
        if (u > 0.6) eelLights.push({ x: a.x, z: a.z, intensity: 0.5 + 0.5 * pulse });
      } else if (f.kind === 'koi') {
        waterLights.push({ x: a.x, z: a.z, radius: 0.06, intensity: 0.16 * rise, color: C.koi });
      }
    }
    // Nearest lights win the slots.
    waterLights.reverse();
    waterLights.length = Math.min(waterLights.length, 4);
    eelLights.reverse();

    // Fish in flight from the net to the basket.
    for (const toss of this.tosses) {
      const t = Math.min(1, toss.age / TOSS_TIME);
      const to = this.view.basket.mouth;
      airFish.push({
        kind: toss.kind,
        x: toss.x + (to.x - toss.x) * t,
        y: toss.y + (to.y - toss.y) * t + Math.sin(t * Math.PI) * 0.12,
        z: toss.z + (to.z - toss.z) * t,
        heading: toss.heading + t * 7,
        pitch: t * 5,
        scale: 0.9 - t * 0.25,
        phase: this.time * 30,
        fog: 0,
        glow: 0.4,
        flash: 0,
        flop: 1.2,
      });
    }

    // The emitter's lane is marked twice: at the far bend, and again a little downstream where the
    // river is wide enough for the lane to be read. An incoming eel turns both cold blue and bigger.
    if (this.mode === 'playing' && !state.resting) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
      const far = river.pointAt(0.05, state.emitter.lane);
      const read = river.pointAt(river.progressToS(EMITTER_READ), state.emitter.lane);
      const grow = this.telegraph ? Math.min(1, this.telegraph.age / this.config.telegraphLead) : 0;
      const tint = this.telegraph ? C.eel : C.shimmer;
      waterLights.push({ x: far.x, z: far.z, radius: 0.6 + 0.5 * grow, intensity: 0.5 + 0.2 * pulse + 0.6 * grow, color: tint });
      waterLights.push({ x: read.x, z: read.z, radius: 0.2 + 0.12 * grow, intensity: 0.55 + 0.25 * pulse + 0.5 * grow, color: tint });
    }

    // Eel shock: a white-blue flash, then the river goes dark and the neon dies.
    const shock = this.shock;
    const darken = shock > 0 ? Math.min(0.55, Math.max(0, shock - 0.12) * 1.6) : 0;
    const neonOut = shock > 0 ? (shock > 0.6 ? 0.12 : Math.floor(shock * 14) % 2 === 0 ? 1 : 0.2) : 1;
    const flash = shock > 0 && !this.reducedMotion ? Math.max(0, 1 - shock * 5) : 0;
    const flicker = 0.9 + 0.1 * Math.sin(this.time * 13) * Math.sin(this.time * 7.3);
    const dim = this.mode === 'title' ? 0.3 : this.mode === 'paused' ? 0.45 : this.mode === 'over' ? 0.5 : 0;

    this.drawHud();
    this.drawScreens();
    return {
      time: this.time,
      dt,
      fish,
      airFish,
      net: {
        x: netWorld.x,
        z: netWorld.z,
        velocity: state.net.velocity,
        lift,
        bulge: this.bulge,
        charge: Math.min(1, state.streak / 16),
        visible: this.mode !== 'title',
      },
      basketFill: Math.min(1, this.basketWeight / this.config.winWeight),
      waterLights,
      eelLights,
      lantern: flicker,
      breath: Math.sin(this.time * 1.4) > 0.3 ? 1 : 0,
      lean: this.mode === 'title' ? 0 : state.net.lane < 0.33 ? -1 : state.net.lane > 0.72 ? 1 : 0,
      jolt: shock > 0 && shock < 0.5 ? (Math.floor(shock * 30) % 2 === 0 ? 1 : -1) : 0,
      darken: Math.max(darken, dim),
      neon: neonOut,
      flash,
      glitch: shock > 0 && shock < 0.06 && !this.reducedMotion ? 0.004 : 0,
      drift: this.reducedMotion ? 0 : (netLane - 0.5) * 3 + Math.sin(this.time * 0.13) * 1.2,
    };
  }

  /** In-canvas HUD on the shared grid: stone tablet, streak, banner, weight pops. */
  private drawHud(): void {
    const v = this.view;
    const { originX, originY, targetW, targetH } = v.layout;
    const { gridW, gridH } = v.assets;
    const s = this.sim.state;
    const show = this.mode === 'playing' || this.mode === 'paused' || this.mode === 'over';

    const safe = this.safeTexels();
    const bottom = targetH - safe.bottom;
    const gutter = bottom - (originY + gridH);
    const w = 100;
    const h = 23;
    const inGutter = gutter >= h + 6;
    const controlSize = Math.max(13, Math.ceil(44 / this.texelCss()));
    const x = inGutter ? Math.floor(targetW / 2 - w / 2) : safe.left + 3;
    // Without a gutter the tablet sits top-left under the pause button, over trees and sky: the
    // cobbles belong to the basket and the fisherman.
    const y = inGutter ? originY + gridH + Math.floor((gutter - h) / 2) : safe.top + controlSize + 8;
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
    // Body text sits on a dark strip so it stays legible over foam, grass and neon.
    const text = (id: string, on: boolean, str: string, y: number, color: string): void => {
      const tw = v.label(id, on ? str : '', cx, y, color, 'center');
      v.panel(`${id}-strip`, cx - Math.ceil(tw / 2) - 3, y - 2, tw + 6, 11, on ? '#030911' : null, 11);
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

    const heading = (id: string, on: boolean, str: string, y: number, color: string): void => {
      v.label(id, on ? str : '', cx, y, color, 'center', true, true);
    };
    const title = this.mode === 'title';
    heading('title-logo', title, 'NEON RIVER', at(0.27) - 8, '#8ff8ff');
    text('title-sub', title, 'A NIGHT ON THE WATER', at(0.27) + 13, '#99c8cd');
    text('title-rule-1', title, 'CATCH 200 LB', at(0.42), '#c5e1e8');
    text('title-rule-2', title, "DON'T LET 20 LB ESCAPE", at(0.42) + 11, '#c5e1e8');
    text('title-rule-3', title, 'NEVER NET AN ELECTRIC EEL', at(0.42) + 22, '#c5e1e8');
    button('start', title, 'TAP TO FISH', at(0.58));
    text('title-hint', title, 'DRAG - MOUSE - A/D - GAMEPAD', at(0.58) + 30, '#99c8cd');

    const paused = this.mode === 'paused';
    heading('paused-title', paused, 'PAUSED', at(0.26) - 8, '#8ff8ff');
    button('resume', paused, 'RESUME', at(0.34));
    // Mix sliders: drawn here, operated through transparent range inputs laid over the tracks.
    const rowPitch = Math.max(18, Math.ceil(46 / this.texelCss()));
    VOLUME_KEYS.forEach((key, i) => {
      const y = at(0.34) + 24 + Math.ceil(rowPitch / 2) + 6 + i * rowPitch;
      const trackW = 72;
      const x = cx - 14;
      const value = this.audio.getVolume(key);
      v.label(`vol-${key}-label`, paused ? key.toUpperCase() : '', x - 6, y, '#c5e1e8', 'right');
      v.panel(`vol-${key}-plate`, x - 62, y - 3, trackW + 70, 13, paused ? '#030911' : null, 11);
      v.panel(`vol-${key}-track`, x, y + 2, trackW, 3, paused ? '#243e48' : null, 12);
      v.panel(`vol-${key}-fill`, x, y + 2, Math.round(trackW * value), 3, paused ? '#29bcc2' : null, 13);
      v.panel(`vol-${key}-knob`, x + Math.round((trackW - 4) * value), y - 1, 4, 9, paused ? '#ffd98a' : null, 14);
      this.overlay.place(key, paused ? { x, y: y - 3, w: trackW, h: 13 } : null);
    });

    const over = this.mode === 'over';
    const won = this.lossCause === null;
    heading('over-title', over, won ? 'A FULL NET' : 'THE NIGHT ENDS', at(0.3) - 8, won ? '#ffd98a' : '#8ff8ff');
    const cause = won ? 'THE RIVER PROVIDES' : this.lossCause === 'eel' ? 'AN ELECTRIC EEL FOUND YOUR NET' : 'TOO MANY FISH SLIPPED AWAY';
    text('over-cause', over, cause, at(0.3) + 14, '#c5e1e8');
    text('over-stats-1', over, `${s.caught} LB CAUGHT - ${s.escaped} LB ESCAPED`, at(0.3) + 30, '#99c8cd');
    text('over-stats-2', over, `BEST STREAK ${s.bestStreak}`, at(0.3) + 41, '#99c8cd');
    button('retry', over, 'FISH AGAIN', at(0.3) + 58);

    // Pause and sound, top-left, clear of the river. Each is drawn at least 44 CSS px square and
    // inside the safe area, so the art, the hit area and the focus ring are the same rectangle.
    const controls = this.mode === 'playing' || this.mode === 'paused';
    const safe = this.safeTexels();
    const size = Math.max(13, Math.ceil(44 / this.texelCss()));
    const px = safe.left + 3;
    const py = safe.top + 3;
    const mw = Math.max(33, size);
    const ty = py + Math.floor((size - 7) / 2);
    v.panel('ctl-pause-body', px, py, size, size, controls ? '#091a27' : null, 12);
    v.label('ctl-pause-text', controls ? (paused ? '>' : 'II') : '', px + Math.ceil(size / 2), ty, '#99c8cd', 'center');
    const sound = this.audio.isMuted ? 'MUTED' : 'SOUND';
    v.panel('ctl-mute-body', px + size + 2, py, mw, size, controls ? '#091a27' : null, 12);
    v.label(
      'ctl-mute-text',
      controls ? sound : '',
      px + size + 2 + Math.ceil(mw / 2),
      ty,
      this.audio.isMuted ? '#6d9bb1' : '#99c8cd',
      'center',
    );
    this.overlay.place('pause', controls ? { x: px, y: py, w: size, h: size } : null);
    this.overlay.place('mute', controls ? { x: px + size + 2, y: py, w: mw, h: size } : null);
  }

  private texelCss(): number {
    return this.view.layout.scale / (window.devicePixelRatio || 1);
  }

  /** Device safe-area insets (notch, home indicator) in whole target texels. */
  private safeTexels(): { top: number; left: number; bottom: number } {
    const inset = this.overlay.safeInsets();
    const t = this.texelCss();
    return { top: Math.ceil(inset.top / t), left: Math.ceil(inset.left / t), bottom: Math.ceil(inset.bottom / t) };
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
        for (const e of this.sim.drainEvents())
          if (e.type === 'restStart' || e.type === 'phaseStart' || e.type === 'lose' || e.type === 'win') this.onEvent(e);
      }
      // Everything caught so far has landed, except fish still in the net (they add when they land).
      this.basketWeight = this.sim.state.fish
        .filter((f) => f.status === 'scooped')
        .reduce((w, f) => w - this.config.weights[f.kind], this.sim.state.caught);
      // The last stretch runs through the full frame path so wakes, ripples and particles exist.
      for (let t = 0; t < warm && this.mode === 'playing'; t += STEP) this.frame(STEP);
      this.autoplay = false;
    };
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.seed = value;
        this.seedPinned = true;
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
        } else if (name === 'koi-scoop') {
          // A koi arriving in the net, stopped partway through the scoop-and-lift.
          settle(9);
          this.sim.debugSpawn('koi', this.sim.state.net.lane, 0.985);
          for (let i = 0; i < 60 && this.scoop === 0; i++) this.frame(STEP);
          for (let i = 0; i < 9; i++) this.frame(STEP);
          if (this.scoop === 0) throw new Error('koi-scoop not reached');
        } else if (name === 'eel-near') {
          // An eel passing just beside the net.
          settle(5, { startPhase: 1, skipRest: true });
          const lane = this.sim.state.net.lane;
          this.sim.debugSpawn('eel', lane > 0.5 ? lane - 0.3 : lane + 0.3, 0.86);
          for (let i = 0; i < 14; i++) this.frame(STEP);
          if (this.sim.state.status !== 'playing') throw new Error('eel-near ended the run');
        } else if (name === 'loss-eel') {
          settle(12);
          this.sim.debugSpawn('eel', this.sim.state.net.lane, 0.97);
          this.autoplay = false;
          for (let i = 0; i < 240 && this.mode !== 'over'; i++) this.frame(STEP);
          if (this.mode !== 'over' || this.lossCause !== 'eel') throw new Error(`loss-eel not reached (cause ${this.lossCause})`);
        } else if (name === 'loss-escaped') {
          // A net that keeps clear of everything, so the night ends on the escape budget.
          this.frozen = false;
          this.startRun();
          while (this.sim.state.status === 'playing') {
            const arriving = this.sim.state.fish.filter((f) => f.status === 'swimming' && f.progress > 0.6).map((f) => f.lane);
            const spots = [0, 0.2, 0.4, 0.6, 0.8, 1];
            const clear = (lane: number): number => Math.min(1, ...arriving.map((l) => Math.abs(l - lane)));
            const lane = spots.reduce((best, c) => (clear(c) > clear(best) ? c : best), this.sim.state.net.lane);
            this.sim.step(STEP, { kind: 'target', lane });
            for (const e of this.sim.drainEvents()) this.onEvent(e);
          }
          for (let i = 0; i < 240 && this.mode !== 'over'; i++) this.frame(STEP);
          if (this.mode !== 'over' || this.lossCause !== 'escaped') throw new Error(`loss-escaped not reached (cause ${this.lossCause})`);
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
      actors: this.view.pixelsPerTexel === layout.scale ? 'device' : 'capped',
      basket: this.basketWeight,
      audioErrors: this.audio.errors.length,
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        programs: info.programs?.length ?? 0,
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
      layout: {
        scale: layout.scale,
        targetW: layout.targetW,
        targetH: layout.targetH,
        gridW: layout.gridW,
        gridH: layout.gridH,
        pixelsPerTexel: this.view.pixelsPerTexel,
      },
      quality: this.view.quality,
      rippleEncoding: this.view.ripples.byteEncoded ? 'byte' : 'half-float',
    };
  }
}
