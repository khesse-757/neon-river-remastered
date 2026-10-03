import { AudioBus } from '../audio/AudioBus';
import { Loop } from '../core/Loop';
import { RIVER } from '../data/river';
import { Input } from '../input/Input';
import * as THREE from 'three';
import { color, loadSceneAssets } from '../render/assets';
import type { FishInstance } from '../render/models/fish';
import { PIXEL_FONT, TITLE_FONT } from '../render/PixelText';
import { SceneRenderer, type ActorResolution, type FrameView, type WaterLight } from '../render/SceneRenderer';
import { oracleIntent } from '../sim/bots/oracle';
import { trackerIntent } from '../sim/bots/tracker';
import { DEFAULT_CONFIG, STAGES, type FishKind, type SimConfig } from '../sim/config';
import type { NetIntent } from '../sim/net';
import { River, type RiverData } from '../sim/river';
import { createRng, type Rng } from '../sim/rng';
import { Sim, type Fish, type LossCause, type SimEvent } from '../sim/sim';
import { Overlay } from '../ui/Overlay';
import { PANEL_WIDTH, SettingsPanel } from '../ui/SettingsPanel';

export type Mode = 'loading' | 'title' | 'playing' | 'paused' | 'over';

const STEP = 1 / 60;
const GRIDS: readonly (readonly [number, number])[] = [
  [192, 344],
  [216, 387],
  [256, 459],
  [384, 688],
];
const DEFAULT_GRID: readonly [number, number] = [216, 387];

/** The win sequence: a slow-motion beat, then the celebration, then the results card. */
const WIN_SECONDS = 6;
const UNLOCK_STORE = 'neonriver2_hard_river';
const PAPER_LANTERN = ['.###.', '#####', '#.#.#', '#####', '#.#.#', '#####', '.###.', '..#..'];
const GEAR = ['...#.#...', '.#.###.#.', '..#####..', '###...###', '.##...##.', '###...###', '..#####..', '.#.###.#.', '...#.#...'];
const SPEAKER = ['...#.....', '..##..#..', '####...#.', '####.#.#.', '####...#.', '..##..#..', '...#.....'];
const SPEAKER_OFF = ['...#.....', '..##.#.#.', '####..#..', '####.#.#.', '####.....', '..##.....', '...#.....'];
const SCOOP_TIME = 0.34;
/** Progress at which the emitter's lane is shown: the first place the river is wide enough to read it. */
const EMITTER_READ = 0.24;
const TOSS_TIME = 0.5;
/** A weight pop rises and fades where the fish was caught. */
const POP_SECONDS = 0.75;
/** How long a speed-up's rush of current streaks lasts. */
const SURGE_SECONDS = 1.6;

const C = {
  eel: color('#39e6ee'),
  eelHot: color('#8ff8ff'),
  koi: color('#ffb347'),
  shimmer: color('#9fd8e8'),
  wake: color('#bfe6f0'),
  white: color('#ffffff'),
  droplet: color('#9ccbcf'),
  firefly: color('#ffd98a'),
  paper: color('#ffc66a'),
  smoke: color('#5f696b'),
  fireA: color('#ff5fd0'),
  fireB: color('#39e6ee'),
  fireC: color('#ffd98a'),
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
  /** Leitmotif candidate id (from the ?audition page). */
  readonly theme?: string | null;
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
  readonly audio: AudioBus;
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
  /** Seconds into the win sequence (0 = not winning). */
  private win = 0;
  /** Seconds into the eel frying the basket (0 = not frying). */
  private fry = 0;
  private lossCue = 0;
  private leapTimer = 0;
  private lanternTimer = 0;
  private fireworkTimer = 0;
  private readonly leaps: { age: number; from: number; to: number; s: number }[] = [];
  private readonly lanterns: { x: number; y: number; vx: number; vy: number; age: number; phase: number }[] = [];
  private settingsOpen = false;
  private reduceFlashing = false;
  private banner = 0;
  private bannerText = '';
  /** Seconds left of a speed-up's surge. */
  private surge = 0;
  private streakTimer = 0;
  private audioPeak = 0;
  private readonly panel: SettingsPanel;
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
    this.audio = new AudioBus(options.theme);
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.reduceFlashing = this.reducedMotion;
    this.overlay = new Overlay({
      start: () => this.confirm(),
      resume: () => this.closePanel(),
      retry: () => this.confirm(),
      settings: () => this.toggleSettings(),
      mute: () => {
        void this.audio.unlock();
        this.audio.setMuted(!this.audio.isMuted);
        this.overlay.setMuted(this.audio.isMuted);
        this.audio.uiTick();
      },
    });
    this.overlay.setMuted(this.audio.isMuted);
    this.panel = new SettingsPanel(this.audio);
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

  /** Dev tune panel: change the pace multipliers of the running night. */
  setTune(tune: SimConfig['tune']): void {
    this.config = { ...this.config, tune };
    this.sim.config = this.config;
  }

  togglePause(): void {
    // Esc / P close the settings panel wherever it is open.
    if (this.settingsOpen && this.mode !== 'paused') this.settingsOpen = false;
    else if (this.mode === 'playing' && this.win === 0) this.setMode('paused');
    else if (this.mode === 'paused') this.setMode('playing');
  }

  /**
   * The gear, always on screen: pause-and-settings during play; a settings panel over the title,
   * the win sequence and the results.
   */
  toggleSettings(): void {
    if (this.mode === 'playing' && this.win === 0) this.setMode('paused');
    else if (this.mode === 'paused') this.setMode('playing');
    else if (this.mode !== 'loading') this.settingsOpen = !this.settingsOpen;
  }

  /** The panel's RESUME / CLOSE button. */
  private closePanel(): void {
    if (this.mode === 'paused') this.setMode('playing');
    else this.settingsOpen = false;
  }

  private buzz(pattern: number | number[]): void {
    if (navigator.vibrate && this.audio.settings.haptics && !this.reducedMotion) navigator.vibrate(pattern);
  }

  /** Space pauses and resumes during play and never does anything else there. */
  private space(): void {
    if (this.win > 0 && this.mode === 'playing') this.skipWin();
    else if (this.mode === 'playing' || this.mode === 'paused') this.togglePause();
    else if (this.settingsOpen) this.settingsOpen = false;
    else this.confirm();
  }

  /**
   * Skip the win sequence to the results card. A key works almost at once; a touch only after
   * 1.5 s, so re-gripping the phone after the last catch does not throw the celebration away.
   */
  private skipWin(touch = false): void {
    if (this.win > (touch ? 1.5 : 0.4) && this.mode === 'playing') {
      this.audio.stopCue();
      this.setMode('over');
    }
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
      onSpace: () => this.space(),
      onTap: () => this.skipWin(true),
      onFirstGesture: () => {
        void this.audio.unlock().then(() => this.audio.startLoops());
      },
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'playing' && this.win === 0) this.setMode('paused');
      // A hidden tab goes quiet (unless that setting is off); a paused game keeps its beds so the
      // mix can be set by ear.
      this.audio.setHidden(document.hidden);
    });
    window.addEventListener('blur', () => {
      if (this.mode === 'playing' && this.win === 0) this.setMode('paused');
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
    // With the settings panel open over the title, the win or the results, Enter closes it.
    if (this.settingsOpen && this.mode !== 'paused') {
      this.settingsOpen = false;
      return;
    }
    if (this.win > 0 && this.mode === 'playing') this.skipWin();
    else if (this.mode === 'title' || this.mode === 'over') {
      this.settingsOpen = false;
      this.startRun();
      // The leitmotif, stated once, as the night begins. The samples were preloaded with the page;
      // on a slow first load the sting waits for its own voice (the small koto sample, not the
      // music), plays if that arrives within the first four seconds, and is otherwise dropped
      // rather than played on a stand-in.
      const run = this.runCount;
      const koto = this.audio.settings.instrument === 'koto';
      void this.audio
        .unlock()
        .then(() => (koto ? this.audio.sample('koto', 4000) : true))
        .then((voiced) => {
          const live = this.runCount === run && this.mode === 'playing' && this.sim.state.status === 'playing';
          if (live && voiced && this.sim.state.time < 4) this.audio.startSting();
        });
    } else if (this.mode === 'paused') this.setMode('playing');
  }

  private startRun(startStage = 0): void {
    // Wall-clock time only picks the seed; the run itself stays deterministic for that seed.
    if (!this.seedPinned) this.seed = (Date.now() + this.runCount * 7919) >>> 0;
    this.runCount += 1;
    this.sim = new Sim({ seed: this.seed, river: this.river, config: this.config, startStage });
    this.banner = 0;
    this.settingsOpen = false;
    this.surge = 0;
    this.audio.cancelWarning();
    this.fx = createRng(this.seed ^ 0x9e3779b9);
    this.accumulator = 0;
    this.hitstop = 0;
    this.lossCause = null;
    this.lossTimer = 0;
    this.shock = 0;
    this.win = 0;
    this.fry = 0;
    this.lossCue = 0;
    this.leaps.length = 0;
    this.lanterns.length = 0;
    this.audio.stopCue();
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
          // Autoplay (test hooks, video capture) uses the planning bot so it can play a whole night.
          const intent: NetIntent = this.autoplay ? oracleIntent(this.sim.state, this.config) : this.input.consume();
          this.sim.step(STEP, intent);
          for (const event of this.sim.drainEvents()) this.onEvent(event);
        }
      }
    } else if (this.mode === 'over' && dt > 0) {
      this.sim.step(dt);
      this.sim.drainEvents();
    }

    // The 200th pound lands in slow motion.
    const slow = this.win > 0 && this.win < 0.7 && !this.reducedMotion ? 0.3 : 1;
    const animDt = this.mode === 'paused' ? 0 : dt * slow;
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
      case 'stage':
        // The sign names the stage; the fish keep coming under it.
        this.bannerText = event.stage.name.toUpperCase();
        this.banner = this.config.bannerSeconds;
        if (event.index > 0) {
          // A speed-up: stinger and a rush of current streaks down the river. No flash, no neon.
          this.surge = SURGE_SECONDS;
          this.audio.speedUpSting(event.index);
          this.buzz(14);
        }
        break;
      case 'telegraph':
        this.telegraph = { lane: event.lane, age: 0 };
        this.audio.warn();
        break;
      case 'telegraphCancel':
        // The eel is not coming after all: its glow and crackle let go. The cancel arrives when the
        // eel would have spawned, so it only applies to a warning that has run its full lead; a
        // newer warning for the next eel is left alone.
        if (this.telegraph && this.telegraph.age >= this.config.telegraphLead - 0.1) {
          this.telegraph = null;
          this.audio.cancelWarning();
        }
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
        this.buzz(koi ? 18 : 8);
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
        this.audio.nearMiss();
        this.sparks(p.x, p.y, 10);
        break;
      }
      case 'eelCaught': {
        this.audio.zap();
        this.hitstop = 0.12;
        this.shock = 0.0001;
        this.fry = 0.0001;
        // Lightning runs up the pole to the fisherman's hands.
        const net = this.gridPoint(1, this.sim.state.net.lane);
        const grip = this.view.toTexel(this.view.grip);
        for (let i = 0; i <= 16; i++) {
          const f = i / 16;
          this.sparks(net.x + (grip.x - net.x) * f, net.y + (grip.y - net.y) * f, 2, 0.5);
        }
        this.buzz([40, 30, 80]);
        break;
      }
      case 'lose':
        this.lossCause = event.cause;
        // The eel loss plays out longer: the shock runs to the basket before the screen comes up.
        this.lossTimer = event.cause === 'eel' ? 2.1 : 0.9;
        this.lossCue = event.cause === 'eel' ? 1.1 : 0.15;
        break;
      case 'win':
        this.lossCause = null;
        this.win = 0.0001;
        this.audio.winFanfare();
        try {
          localStorage.setItem(UNLOCK_STORE, '1');
        } catch {
          /* storage unavailable */
        }
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
    if (this.telegraph) {
      // The warning glow lasts its lead time and then lets go (the eel has spawned by then).
      this.telegraph.age += dt;
      if (this.telegraph.age > this.config.telegraphLead + 0.15) this.telegraph = null;
    }
    for (const pop of this.pops) pop.age += dt;
    while (this.pops[0] && this.pops[0].age > POP_SECONDS) this.pops.shift();

    // The current: streaks of light run down the river, a rush of them at each speed-up and a
    // few more with every stage, so the water itself looks faster.
    this.surge = Math.max(0, this.surge - dt);
    const rush = this.surge / SURGE_SECONDS;
    // Reduced motion: no streaks at all; the sign and the stinger announce the speed-up.
    const streaks = this.mode === 'playing' && this.win === 0 && !this.reducedMotion ? state.stageIndex * 4 + 36 * rush * rush : 0;
    const railSize = this.river.screenAt(1, 0.5).scale;
    this.streakTimer += dt * streaks;
    while (this.streakTimer >= 1) {
      this.streakTimer -= 1;
      const s = 0.12 + this.fx.next() * 0.8;
      const lane = 0.04 + this.fx.next() * 0.92;
      const a = this.gridPoint(s, lane);
      const b = this.gridPoint(Math.min(this.river.maxS, s + 0.03), lane);
      const pull = (rush > 0 ? 20 : 14) * (0.8 + state.stageIndex * 0.15);
      // A few dots in a line read as one streak. Water-colored and below the bloom threshold:
      // they should look like faster water, not sparks.
      const rel = a.scale / railSize;
      for (let k = 0; k < 5; k++)
        particles.emit({
          x: a.x - (b.x - a.x) * k * 0.5,
          y: a.y - (b.y - a.y) * k * 0.5,
          vx: (b.x - a.x) * pull,
          vy: (b.y - a.y) * pull,
          life: 0.5 - k * 0.05,
          color: C.shimmer,
          size: 1.2 + rel * 1.6 - k * 0.15,
          glow: 0.6 - k * 0.06,
        });
    }

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
    if (this.lossCue > 0) {
      this.lossCue -= dt;
      if (this.lossCue <= 0) this.audio.lossPhrase();
    }
    this.updateFry(dt);
    this.updateWin(dt);
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

  /** An eel ruins the catch: arcs jump from the net to the basket and the fish in it fry. */
  private updateFry(dt: number): void {
    if (this.fry <= 0) return;
    const before = this.fry;
    this.fry += dt;
    const { particles } = this.view;
    const basket = this.view.toTexel(this.view.basket.mouth);
    if (before < 0.3 && this.fry >= 0.3) {
      this.audio.fry();
      const net = this.gridPoint(1, this.sim.state.net.lane);
      // A jagged arc from the hoop to the basket.
      for (let i = 0; i <= 18; i++) {
        const f = i / 18;
        this.sparks(
          net.x + (basket.x - net.x) * f + Math.sin(f * 21) * 4,
          net.y + (basket.y - net.y) * f - Math.sin(f * Math.PI) * 14,
          2,
          0.45,
        );
      }
    }
    if (this.fry > 0.3 && this.fry < 1.5 && this.basketWeight > 0) {
      if (this.fx.next() < dt * (this.reduceFlashing ? 14 : 40)) this.sparks(basket.x, basket.y + 4, 1, 0.3);
      // Smoke: dark puffs that rise and thin out.
      if (this.fx.next() < dt * 22)
        particles.emit({
          x: basket.x + (this.fx.next() - 0.5) * 12,
          y: basket.y + 2,
          vx: (this.fx.next() - 0.5) * 6,
          vy: -9 - this.fx.next() * 8,
          life: 1.1 + this.fx.next() * 0.6,
          color: C.smoke,
          size: 2.5 + this.fx.next() * 2.5,
          glow: 1,
        });
    }
  }

  /** The win: slow-motion beat, golden basket, the net raised, koi leaping, lanterns, fireworks. */
  private updateWin(dt: number): void {
    const card = this.mode === 'over' && this.lossCause === null;
    if (this.win <= 0 || (this.mode !== 'playing' && !card)) return;
    // The sequence runs on real time; only the world's motion is slowed during the first beat.
    const real = this.win < 0.7 && !this.reducedMotion ? dt / 0.3 : dt;
    this.win += real;
    // Behind the results card the lanterns and fireworks carry on; the leaping koi finish and stop.
    if (card) this.win = Math.max(this.win, 2);
    const { particles, ripples } = this.view;
    const { gridW, gridH } = this.view.assets;
    for (const leap of this.leaps) leap.age += dt;
    while (this.leaps[0] && this.leaps[0].age > 1) {
      const done = this.leaps.shift();
      if (done) {
        const p = this.gridPoint(done.s, done.to);
        ripples.inject(p.x, p.y, 4, 0.7);
      }
    }
    if (this.win > 1.1 && !this.reducedMotion && !card) {
      // Koi leap in arcs across the river.
      this.leapTimer -= dt;
      if (this.leapTimer <= 0) {
        this.leapTimer = 0.42;
        const from = this.fx.next() * 0.6;
        const leap = { age: 0, from, to: from + 0.3 + this.fx.next() * 0.1, s: 0.72 + this.fx.next() * 0.26 };
        if (this.fx.next() < 0.5) [leap.from, leap.to] = [leap.to, leap.from];
        this.leaps.push(leap);
        const p = this.gridPoint(leap.s, leap.from);
        ripples.inject(p.x, p.y, 4, 0.8);
        for (let i = 0; i < 6; i++)
          particles.emit({
            x: p.x,
            y: p.y,
            vx: (this.fx.next() - 0.5) * 26,
            vy: -16 - this.fx.next() * 20,
            gravity: 110,
            life: 0.45,
            color: C.droplet,
            glow: 0.9,
          });
      }
    }
    if (this.win > 1.4) {
      // Paper lanterns rise from the water.
      this.lanternTimer -= dt;
      if (this.lanternTimer <= 0) {
        this.lanternTimer = 0.22;
        const p = this.gridPoint(0.45 + this.fx.next() * 0.55, 0.08 + this.fx.next() * 0.84);
        this.lanterns.push({
          x: p.x,
          y: p.y,
          vx: (this.fx.next() - 0.5) * 3,
          vy: -7 - this.fx.next() * 5,
          age: 0,
          phase: this.fx.next() * 6,
        });
        if (this.lanterns.length > 14) this.lanterns.shift();
      }
      // Pixel fireworks over the skyline; fewer and softer when flashing is reduced.
      this.fireworkTimer -= dt;
      if (this.fireworkTimer <= 0) {
        this.fireworkTimer = this.reduceFlashing ? 1.1 : 0.45;
        const cx = (0.18 + this.fx.next() * 0.7) * gridW;
        const cy = (0.03 + this.fx.next() * 0.1) * gridH;
        const tint = [C.fireA, C.fireB, C.fireC][Math.floor(this.fx.next() * 3)] ?? C.fireA;
        const flashy = !this.reduceFlashing;
        for (let i = 0; i < 28; i++) {
          const a = (i / 14) * Math.PI * 2;
          const v = (i < 14 ? 16 : 9) + this.fx.next() * 4;
          particles.emit({
            x: cx,
            y: cy,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            gravity: 8,
            life: 1.1 + this.fx.next() * 0.3,
            color: i < 14 ? tint : C.white,
            size: flashy ? 1.7 : 1.2,
            glow: flashy ? 3 : 1.1,
          });
        }
      }
    }
    for (const lantern of this.lanterns) {
      lantern.age += dt;
      lantern.x += (lantern.vx + Math.sin(this.time * 1.3 + lantern.phase) * 2) * dt;
      lantern.y += lantern.vy * dt;
      // Each paper lantern carries its own warm glow.
      if (this.fx.next() < dt * 9)
        particles.emit({ x: lantern.x + 2.5, y: lantern.y + 4, life: 0.35, color: C.paper, size: 5.5, glow: 1.5 });
    }
    if (this.win >= WIN_SECONDS && this.mode === 'playing') this.setMode('over');
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
    // On a win the net is raised and held; otherwise it lifts with each scoop.
    const triumph = this.win > 0 ? THREE.MathUtils.smoothstep(this.win, 0.7, 1.5) : 0;
    const lift = Math.max(this.scoopLift(), triumph);
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

    // Celebration koi, leaping bank to bank.
    for (const leap of this.leaps) {
      const t = Math.min(1, leap.age);
      const lane = leap.from + (leap.to - leap.from) * t;
      const w = river.pointAt(leap.s, lane);
      const dir = Math.sign(leap.to - leap.from);
      airFish.push({
        kind: 'koi',
        x: w.x,
        y: Math.sin(t * Math.PI) * 0.14 - 0.01,
        z: -w.z,
        heading: (dir * Math.PI) / 2,
        pitch: (0.5 - t) * 2.2,
        scale: 1.5,
        phase: this.time * 22,
        fog: 0,
        glow: 1.2,
        flash: 0,
        flop: 1,
      });
    }

    // The emitter's lane is marked twice: at the far bend, and again a little downstream where the
    // river is wide enough for the lane to be read. An incoming eel turns both cold blue and bigger.
    if (this.mode === 'playing' && this.win === 0) {
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
    // With flashing reduced the neon fades out once instead of strobing.
    const neonOut =
      shock > 0
        ? this.reduceFlashing
          ? Math.max(0.12, 1 - shock * 1.6)
          : shock > 0.6
            ? 0.12
            : Math.floor(shock * 14) % 2 === 0
              ? 1
              : 0.2
        : 1;
    const cheer = this.win > 0.7 && !this.reducedMotion;
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
      basketFry: THREE.MathUtils.smoothstep(this.fry, 0.3, 1.2),
      basketGlow: this.win > 0 ? THREE.MathUtils.smoothstep(this.win, 0.3, 1.6) : 0,
      waterLights,
      eelLights,
      lantern: flicker,
      // On a win he bobs with the fanfare; otherwise he just breathes.
      breath: cheer ? (Math.floor(this.time * 5.33) % 2 === 0 ? 1 : 0) : Math.sin(this.time * 1.4) > 0.3 ? 1 : 0,
      lean:
        this.mode === 'title'
          ? 0
          : cheer
            ? Math.floor(this.time * 2.67) % 2 === 0
              ? 2
              : -2
            : state.net.lane < 0.33
              ? -1
              : state.net.lane > 0.72
                ? 1
                : 0,
      jolt: shock > 0 && shock < (this.reduceFlashing ? 0.12 : 0.5) ? (Math.floor(shock * 30) % 2 === 0 ? 1 : -1) : 0,
      darken: Math.max(darken, dim),
      // The city surges on a win.
      neon: this.win > 0 ? 1 + 0.55 * THREE.MathUtils.smoothstep(this.win, 1, 2.2) * (0.85 + 0.15 * Math.sin(this.time * 6)) : neonOut,
      flash,
      glitch: shock > 0 && shock < 0.06 && !this.reducedMotion ? 0.004 : 0,
      // A swell of gold as the celebration starts, settling to a faint warmth.
      warm:
        this.win > 0.5
          ? (this.reduceFlashing ? 0.25 : 0.25 + 0.75 * Math.max(0, 1 - (this.win - 0.7) / 1.4) ** 2) *
            THREE.MathUtils.smoothstep(this.win, 0.5, 0.8)
          : 0,
      drift: this.reducedMotion ? 0 : (netLane - 0.5) * 3 + Math.sin(this.time * 0.13) * 1.2,
      // He jumps on the fanfare's beat.
      hop: cheer && Math.floor(this.time * 5.33) % 2 === 0 ? 3 : 0,
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
    const corner = this.cornerTexels();
    const x = inGutter ? Math.floor(targetW / 2 - w / 2) : corner.x;
    // Without a gutter the tablet sits top-left under the pause button, over trees and sky: the
    // cobbles belong to the basket and the fisherman.
    const y = inGutter ? originY + gridH + Math.floor((gutter - h) / 2) : corner.y + controlSize + 5;
    // The tablet stays calm: the number changes, nothing lights up (Kyle found a pulse distracting).
    v.panel('hud-edge', x - 1, y - 1, w + 2, h + 2, show ? '#030911' : null);
    v.panel('hud-body', x, y, w, h, show ? '#404d51' : null);
    v.panel('hud-lip', x, y, w, 1, show ? '#5f696c' : null);
    v.label('hud-caught-label', show ? 'CAUGHT' : '', x + 5, y + 3, '#a1987a');
    v.label('hud-caught', show ? `${s.caught}/${this.config.winWeight}` : '', x + 5, y + 12, '#9ccbcf');
    v.label('hud-escaped-label', show ? 'ESCAPED' : '', x + 53, y + 3, '#a1987a');
    const danger = s.escaped >= this.config.maxEscaped - 6;
    v.label('hud-escaped', show ? `${s.escaped}/${this.config.maxEscaped}` : '', x + 53, y + 12, danger ? '#ff9933' : '#9ccbcf');
    v.label('hud-streak', show && this.mode !== 'over' && s.streak >= 3 ? `x${s.streak}` : '', x + w + 4, y + 8, '#ffd98a');

    // Phase banner: a hanging wooden sign over the sky, clear of the river's path.
    const banner = this.banner > 0 && this.mode === 'playing' && !this.settingsOpen;
    const bw = this.bannerText.length * 6 + 14;
    const bx = Math.floor(originX + gridW / 2 - bw / 2);
    const by = originY + Math.floor(gridH * 0.035);
    v.panel('banner-edge', bx - 1, by - 1, bw + 2, 15, banner ? '#030911' : null);
    v.panel('banner-body', bx, by, bw, 13, banner ? '#834433' : null);
    v.label('banner-text', banner ? this.bannerText : '', originX + gridW / 2, by + 3, '#ffd98a', 'center');

    for (let i = 0; i < 14; i++) {
      const lantern = this.lanterns[i];
      const on = lantern && lantern.age < 6 && this.win > 0;
      v.icon(`win-lantern-${i}`, on ? PAPER_LANTERN : null, originX + (lantern?.x ?? 0), originY + (lantern?.y ?? 0), '#ffd98a', 5);
    }
    for (let i = 0; i < 6; i++) {
      const pop = this.pops[i];
      if (!pop) {
        v.label(`pop-${i}`, '', 0, 0, '#ffffff');
        continue;
      }
      // A small pop that rises a little and fades where the fish was caught.
      const t = Math.min(1, pop.age / POP_SECONDS);
      const fade = t > 0.75 ? '#5f696b' : t > 0.5 ? (pop.color === '#ffcc66' ? '#a0773a' : '#7c9aa0') : pop.color;
      v.label(`pop-${i}`, pop.text, originX + pop.fromX, originY + pop.fromY - Math.round(9 * (1 - (1 - t) ** 2)), fade, 'center');
    }

    // The fisherman calls out as he cheers.
    const f = v.assets.fishermanRect;
    const shout = this.win > 0.9 && this.mode === 'playing' && !this.settingsOpen;
    const sx = originX + f.x + Math.floor(f.width / 2) - 8;
    const sy = originY + f.y - 15;
    const sw = v.label('cheer-text', shout ? 'A FULL NET!' : '', sx, sy + 3, '#030911', 'center', false);
    v.panel('cheer-edge', sx - Math.ceil(sw / 2) - 4, sy - 1, sw + 8, 15, shout ? '#030911' : null, 16);
    v.panel('cheer-body', sx - Math.ceil(sw / 2) - 3, sy, sw + 6, 13, shout ? '#ffd98a' : null, 17);
    v.panel('cheer-tail', sx + 2, sy + 13, 3, 3, shout ? '#ffd98a' : null, 17);
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
    const panel = this.settingsOpen && this.mode !== 'paused';
    const title = this.mode === 'title' && !panel;
    heading('title-logo', title, 'NEON RIVER', at(0.27) - 8, '#8ff8ff');
    text('title-sub', title, 'A NIGHT ON THE WATER', at(0.27) + 13, '#99c8cd');
    text('title-rule-1', title, 'CATCH 200 LB', at(0.42), '#c5e1e8');
    text('title-rule-2', title, "DON'T LET 20 LB ESCAPE", at(0.42) + 11, '#c5e1e8');
    text('title-rule-3', title, 'NEVER NET AN ELECTRIC EEL', at(0.42) + 22, '#c5e1e8');
    button('start', title, 'TAP TO FISH', at(0.58));
    text('title-hint', title, 'DRAG - MOUSE - A/D - GAMEPAD', at(0.58) + 30, '#99c8cd');

    // Pause and settings are the same panel; on the title the gear opens it without a run.
    const paused = this.mode === 'paused';
    const mix = paused || panel;
    const safe = this.safeTexels();
    const t = this.texelCss();
    const size = Math.max(13, Math.ceil(44 / t));
    // Heading and close button stay put; the settings list scrolls in the window below them.
    const headY = Math.max(at(0.06), safe.top + size + 6);
    heading('paused-title', mix, paused ? 'PAUSED' : 'SOUND', headY, '#8ff8ff');
    button('resume', mix, paused ? 'RESUME' : 'CLOSE', headY + 21);
    if (mix) {
      const listY = headY + 21 + Math.max(24, Math.ceil(46 / t));
      const listX = cx - PANEL_WIDTH / 2;
      const sheet = this.panel.show(listX, listY, targetH - safe.bottom - 3 - listY, t);
      v.sheet('settings-sheet', sheet, listX, listY, this.panel.version, 22);
    } else {
      this.panel.hide();
      v.sheet('settings-sheet', null);
    }
    // The test sound's level meter, live.
    const meter = mix ? this.panel.meterRect() : null;
    const level = this.audio.level();
    const lit = meter ? Math.round(meter.w * Math.min(1, Math.max(0, (20 * Math.log10(Math.max(level, 1e-6)) + 54) / 54))) : 0;
    v.panel(
      'meter-fill',
      meter?.x ?? 0,
      meter?.y ?? 0,
      lit,
      meter?.h ?? 0,
      meter && lit > 0 ? (lit > (meter.w * 5) / 6 ? '#ffd98a' : '#39e6ee') : null,
      23,
    );

    // End of the night. A win shows the results card.
    const over = this.mode === 'over' && !panel;
    const won = this.lossCause === null;
    heading('over-title', over, won ? 'A FULL NET' : 'THE NIGHT ENDS', at(0.22) - 8, won ? '#ffd98a' : '#8ff8ff');
    const cause = won ? 'THE RIVER PROVIDES' : this.lossCause === 'eel' ? 'AN EEL RUINED THE CATCH' : 'TOO MANY FISH SLIPPED AWAY';
    text('over-cause', over, cause, at(0.22) + 14, '#c5e1e8');
    const seconds = Math.round(s.time);
    const accuracy = Math.round((s.catches / Math.max(1, s.catches + s.misses)) * 100);
    const rating = accuracy >= 95 ? 'MASTER' : accuracy >= 85 ? 'EXPERT' : accuracy >= 70 ? 'SKILLED' : 'NOVICE';
    const lines = won
      ? [
          `TIME ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
          `ACCURACY ${accuracy}%`,
          `BEST STREAK ${s.bestStreak}`,
          `RATING - ${rating}`,
          'HARD RIVER UNLOCKED',
        ]
      : [`${s.caught} LB CAUGHT - ${s.escaped} LB ESCAPED`, `BEST STREAK ${s.bestStreak}`];
    for (let i = 0; i < 5; i++) {
      const line = lines[i];
      text(`over-line-${i}`, over && line !== undefined, line ?? '', at(0.22) + 30 + i * 11, i === 3 || i === 4 ? '#ffd98a' : '#99c8cd');
    }
    button('retry', over, 'FISH AGAIN', at(0.22) + 36 + lines.length * 11);

    // Settings (gear) and mute stay in the top-left corner, inside the safe area, on every screen:
    // title, play, pause, the win and the results. Each is drawn at least 44 CSS px square, so art,
    // hit area and focus ring are one rectangle.
    const controls = this.mode !== 'loading';
    const { x: px, y: py } = this.cornerTexels();
    const inset = Math.floor((size - 9) / 2);
    v.panel('ctl-gear-body', px, py, size, size, controls ? '#091a27' : null, 18);
    v.icon('ctl-gear-icon', controls ? GEAR : null, px + inset, py + inset, '#99c8cd');
    v.panel('ctl-mute-body', px + size + 2, py, size, size, controls ? '#091a27' : null, 18);
    v.icon(
      'ctl-mute-icon',
      controls ? (this.audio.isMuted ? SPEAKER_OFF : SPEAKER) : null,
      px + size + 2 + inset,
      py + inset + 1,
      this.audio.isMuted ? '#6d9bb1' : '#99c8cd',
    );
    this.overlay.place('settings', controls ? { x: px, y: py, w: size, h: size } : null);
    this.overlay.place('mute', controls ? { x: px + size + 2, y: py, w: size, h: size } : null);
  }

  /**
   * Where the gear, the mute button and (without a bottom gutter) the score tablet start. On a
   * phone that is the screen's top-left corner. On a wide screen it is the painting's top-left
   * corner, so the score is next to the river instead of at the far edge of the window.
   */
  private cornerTexels(): { x: number; y: number } {
    const { originX, originY } = this.view.layout;
    const safe = this.safeTexels();
    const wide = originX > 40;
    return { x: Math.max(safe.left, wide ? originX : 0) + 3, y: Math.max(safe.top, wide ? originY : 0) + 3 };
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
    const stageIds = STAGES.map((p) => p.id);
    const settle = (seconds: number, opts: { startStage?: number; idle?: boolean } = {}): void => {
      this.frozen = false;
      this.startRun(opts.startStage ?? 0);
      this.autoplay = !opts.idle;
      const warm = 1.5;
      for (let t = 0; t < seconds - warm && this.sim.state.status === 'playing'; t += STEP) {
        this.sim.step(STEP, opts.idle ? { kind: 'none' } : trackerIntent(this.sim.state, this.config.net.radius));
        for (const e of this.sim.drainEvents()) if (e.type === 'stage' || e.type === 'lose' || e.type === 'win') this.onEvent(e);
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
          this.settingsOpen = false;
          this.setMode('title');
        } else if (name === 'active-play') settle(9);
        else if (phase && stageIds.includes(phase[1] ?? '')) settle(5, { startStage: stageIds.indexOf(phase[1] ?? '') });
        else if (name === 'speed-up' || name === 'rest') {
          // The first speed-up, caught mid-surge with its sign up ('rest' is the old name for the
          // moment between phases; there are no rests any more).
          settle(9);
          this.sim.state.caught = Math.max(this.sim.state.caught, this.config.speedUps[0]?.weight ?? 40);
          this.basketWeight = this.sim.state.caught;
          this.autoplay = true;
          for (let i = 0; i < 26; i++) this.frame(STEP);
          this.autoplay = false;
          if (this.sim.state.stageIndex !== 1 || this.surge <= 0) throw new Error('speed-up not reached');
        } else if (name === 'pause') {
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
          settle(5, { startStage: 1 });
          const lane = this.sim.state.net.lane;
          this.sim.debugSpawn('eel', lane > 0.5 ? lane - 0.3 : lane + 0.3, 0.86);
          for (let i = 0; i < 14; i++) this.frame(STEP);
          if (this.sim.state.status !== 'playing') throw new Error('eel-near ended the run');
        } else if (name === 'settings') {
          this.frozen = false;
          this.setMode('title');
          this.settingsOpen = true;
        } else if (name === 'win' || name === 'win-results') {
          // The real path to a win: one pound short, then a koi lands in the net.
          settle(9);
          this.sim.state.caught = this.config.winWeight - 1;
          this.sim.state.catches = 140;
          this.sim.state.misses = 9;
          this.sim.state.bestStreak = 37;
          this.sim.state.time = 133;
          this.basketWeight = this.sim.state.caught;
          this.sim.debugSpawn('koi', this.sim.state.net.lane, 0.985);
          for (let i = 0; i < 90 && this.win === 0; i++) this.frame(STEP);
          if (this.win === 0) throw new Error('win not reached');
          for (let i = 0; i < 600 && this.win < 3.4; i++) this.frame(STEP);
          if (name === 'win-results') {
            this.skipWin();
            for (let i = 0; i < 30; i++) this.frame(STEP);
            if (this.mode !== 'over' || this.lossCause !== null) throw new Error('win-results not reached');
          }
        } else if (name === 'eel-basket') {
          // An eel in the net with fish already in the basket: stopped while the catch fries.
          settle(12);
          this.sim.debugSpawn('eel', this.sim.state.net.lane, 0.97);
          for (let i = 0; i < 240 && this.fry < 0.75; i++) this.frame(STEP);
          if (this.fry < 0.75 || this.lossCause !== 'eel') throw new Error('eel-basket not reached');
        } else if (name === 'loss-eel') {
          settle(12);
          this.sim.debugSpawn('eel', this.sim.state.net.lane, 0.97);
          this.autoplay = false;
          for (let i = 0; i < 400 && this.mode !== 'over'; i++) this.frame(STEP);
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
      spawnAtNet: (kind: FishKind) => {
        this.sim.debugSpawn(kind, this.sim.state.net.lane, 0.93);
      },
      audioLevel: () => this.audio.level(),
      setAudioBeds: (on: boolean) => this.audio.setBeds(on),
      soloAudio: (name: string | null) => this.audio.setSolo(name),
      setWeight: (pounds: number) => {
        this.sim.state.caught = pounds;
        this.basketWeight = pounds;
      },
      openAdvancedAudio: (open: boolean) => this.panel.setAdvanced(open),
    };
  }

  private publishDiagnostics(): void {
    const info = this.view.renderer.info;
    const s = this.sim.state;
    const { layout } = this.view;
    // Output level now, and its recent peak (falls back over about a second) for polling tests.
    const level = this.audio.level();
    this.audioPeak = Math.max(level, this.audioPeak * 0.96);
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frameCount,
      elapsed: s.time,
      mode: this.mode,
      phase: s.stage.id,
      stage: s.stageIndex,
      settings: this.mode === 'paused' || this.settingsOpen,
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
      winning: this.win > 0 && this.mode === 'playing',
      audio: this.audio.state,
      audioLevel: level,
      audioPeak: this.audioPeak,
      fishNotes: this.audio.settings.enabled.notes,
      theme: this.audio.theme.id,
      rippleEncoding: this.view.ripples.byteEncoded ? 'byte' : 'half-float',
    };
  }
}
