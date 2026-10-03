import { DEFAULT_CONFIG, type FishKind, type SimConfig, type StageSpec } from './config';
import { createNet, stepNet, NO_INTENT, type NetIntent, type NetState } from './net';
import type { River } from './river';
import { createRng, type Rng } from './rng';

export type FishStatus = 'swimming' | 'scooped' | 'escaped';

export interface Fish {
  readonly id: number;
  readonly kind: FishKind;
  /** A fish keeps the lane it was spawned in. Only a scooped fish slides (into the net). */
  lane: number;
  prevLane: number;
  /** 0 at the far bend, 1 at the net rail; linear in time. */
  progress: number;
  prevProgress: number;
  /** Progress per second: the river's current, shared by every fish. */
  speed: number;
  status: FishStatus;
  /** 1 -> 0 while being scooped into the net. */
  scoop: number;
  /** Closest an eel came to the net (world units), for near-miss feedback. */
  closest: number;
  readonly firstEel: boolean;
}

export type LossCause = 'eel' | 'escaped';

export type SimEvent =
  /** The night's opening stage (index 0), then one per speed-up. Spawning never pauses for it. */
  | { type: 'stage'; stage: StageSpec; index: number }
  | { type: 'telegraph'; lane: number; kind: FishKind }
  /** A warned eel will not appear after all (a fairness guard turned it into a fish). */
  | { type: 'telegraphCancel' }
  | { type: 'spawn'; fish: Fish }
  | { type: 'catch'; fish: Fish; weight: number; streak: number; caught: number }
  | { type: 'miss'; fish: Fish; weight: number; escaped: number }
  | { type: 'eelNear'; fish: Fish }
  | { type: 'eelCaught'; fish: Fish }
  | { type: 'win'; time: number }
  | { type: 'lose'; cause: LossCause; time: number };

export interface EmitterState {
  lane: number;
  /** The current swing: an eased move from one lane to another. */
  from: number;
  to: number;
  elapsed: number;
  duration: number;
  /** Seconds into the swing at which it turns back early (Infinity = it completes). */
  reverseAt: number;
  /** Bank to Bank: spawns left in the burst pinned at this bank, and bursts left in the run of them. */
  pinFish: number;
  pinBursts: number;
  /** A burst starts as soon as the emitter reaches a bank. */
  burstPending: boolean;
  spawnTimer: number;
  /** The next two spawns are rolled ahead so an eel can be announced a full lead early. */
  next: FishKind;
  afterNext: FishKind;
  telegraphed: boolean;
  afterTelegraphed: boolean;
  /** Spawns rolled since the last eel. */
  sinceEel: number;
}

export type RunStatus = 'playing' | 'won' | 'lost';

export interface SimState {
  time: number;
  status: RunStatus;
  lossCause: LossCause | null;
  /** 0 = Still Water; each speed-up adds one. */
  stageIndex: number;
  stage: StageSpec;
  /** The current's speed multiplier; glides to the stage's speed after a speed-up. */
  speed: number;
  emitter: EmitterState;
  net: NetState;
  fish: Fish[];
  caught: number;
  escaped: number;
  streak: number;
  bestStreak: number;
  catches: number;
  misses: number;
}

export interface SimOptions {
  readonly seed: number;
  readonly river: River;
  readonly config?: SimConfig;
  /** Start the night at this stage (test hooks). */
  readonly startStage?: number;
  /** Start without fish already in the river (unit tests). */
  readonly empty?: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const WARM_STEP = 1 / 60;
/** A swing never covers less than this, so the chain always moves. */
const MIN_SWING = 0.18;

export class Sim {
  /** Replaceable while running so the dev tune panel can change the pace live. */
  config: SimConfig;
  readonly river: River;
  readonly state: SimState;
  private readonly rng: Rng;
  private events: SimEvent[] = [];
  private nextId = 1;
  private lastFishLane: number | null = null;
  private lastFishTime = 0;
  /** Seconds the emitter has run, warm-up included. */
  private clock = 0;
  private eelSeen = false;
  /** While the river is being pre-run, no eels are rolled: their warnings would never be seen. */
  private warming = true;

  constructor(options: SimOptions) {
    this.config = options.config ?? DEFAULT_CONFIG;
    this.river = options.river;
    this.rng = createRng(options.seed);
    const { stages, speedUps, banks } = this.config;
    const stageIndex = Math.min(stages.length - 1, Math.max(0, options.startStage ?? 0));
    const stage = stages[stageIndex] as StageSpec;
    const right = this.rng.next() < 0.5;
    this.state = {
      // Starting later in the night (test hooks) puts the clock where that stage would begin.
      time: stageIndex > 0 ? (speedUps[stageIndex - 1]?.seconds ?? 0) : 0,
      status: 'playing',
      lossCause: null,
      stageIndex,
      stage,
      speed: stage.speed * this.config.tune.speed,
      emitter: {
        lane: right ? banks[0] : banks[1],
        from: 0,
        to: 0,
        elapsed: 0,
        duration: 1,
        reverseAt: Infinity,
        pinFish: 0,
        pinBursts: 0,
        burstPending: false,
        // With `empty`, the first fish comes one period in instead of at once.
        spawnTimer: options.empty ? stage.period / this.config.tune.density : 0,
        next: 'bluegill',
        afterNext: 'bluegill',
        telegraphed: false,
        afterTelegraphed: false,
        sinceEel: 0,
      },
      net: createNet(),
      fish: [],
      caught: 0,
      escaped: 0,
      streak: 0,
      bestStreak: 0,
      catches: 0,
      misses: 0,
    };
    this.startSwing(right ? 1 : -1);
    const e = this.state.emitter;
    e.next = this.rollKind();
    e.afterNext = this.rollKind();
    if (!options.empty) {
      // A night opens mid-flow: the river has already been running, so the first fish is close.
      for (let t = 0; t < this.config.prefillSeconds; t += WARM_STEP) {
        this.stepEmitter(WARM_STEP);
        for (const fish of this.state.fish) {
          fish.prevProgress = fish.progress;
          fish.progress += this.currentSpeed() * WARM_STEP;
        }
      }
      this.events = [];
    }
    this.warming = false;
    this.events.unshift({ type: 'stage', stage, index: stageIndex });
  }

  /** Events since the last drain, oldest first. */
  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  step(dt: number, intent: NetIntent = NO_INTENT): void {
    const s = this.state;
    if (s.status !== 'playing') {
      // The net coasts to a stop and scooped fish finish their animation after the run ends.
      stepNet(s.net, NO_INTENT, dt, this.config.net);
      this.advanceFish(dt, false);
      return;
    }
    s.time += dt;
    this.stepStage(dt);
    stepNet(s.net, intent, dt, this.config.net);
    this.stepEmitter(dt);
    this.advanceFish(dt, true);
  }

  /** Place a fish directly (test hooks and unit tests). */
  debugSpawn(kind: FishKind, lane: number, progress: number): Fish {
    const fish = this.makeFish(kind, lane, progress);
    this.state.fish.push(fish);
    return fish;
  }

  /** Current travel time, spawn period, bank-to-bank crossing time and eel share, with the tune panel applied. */
  pace(): { travel: number; period: number; crossing: number; eelChance: number } {
    const { tune, travel } = this.config;
    const { stage, speed } = this.state;
    return {
      travel: travel / speed,
      period: stage.period / tune.density,
      crossing: stage.crossing / tune.sweep,
      eelChance: Math.min(0.9, stage.eelChance * tune.eel),
    };
  }

  /** Progress per second of every fish in the river. */
  private currentSpeed(): number {
    return this.state.speed / this.config.travel;
  }

  /** Speed-ups fire on weight caught or on the clock, whichever comes first; the current then picks up. */
  private stepStage(dt: number): void {
    const s = this.state;
    const { speedUps, stages, tune, speedEase } = this.config;
    for (let up = speedUps[s.stageIndex]; up && s.stageIndex < stages.length - 1; up = speedUps[s.stageIndex]) {
      if (s.caught < up.weight && s.time < up.seconds) break;
      s.stageIndex += 1;
      s.stage = stages[s.stageIndex] as StageSpec;
      this.events.push({ type: 'stage', stage: s.stage, index: s.stageIndex });
    }
    const target = s.stage.speed * tune.speed;
    s.speed += (target - s.speed) * (1 - Math.exp(-dt / speedEase));
  }

  private rollKind(): FishKind {
    const { stage, emitter } = this.state;
    // Koi is rolled first, then eel, like the original's power-up / bad-fish order.
    const koi = this.rng.next() < stage.koiChance;
    const eel = this.rng.next() < Math.min(0.9, stage.eelChance * this.config.tune.eel);
    // Eels keep their distance from each other: "rare and well spaced" in Still Water.
    if (!koi && eel && !this.warming && emitter.sinceEel >= stage.eelSpacing) {
      emitter.sinceEel = 0;
      return 'eel';
    }
    emitter.sinceEel += 1;
    return koi ? 'koi' : 'bluegill';
  }

  /** Begin an eased swing from the emitter's lane toward one bank. */
  private startSwing(dir: 1 | -1): void {
    const { stage, emitter } = this.state;
    const [lo, hi] = this.config.banks;
    let d = dir;
    // Already at that bank (after a reversal near it): go the other way.
    if (Math.abs((d > 0 ? hi : lo) - emitter.lane) < MIN_SWING) d = d > 0 ? -1 : 1;
    const full = Math.abs((d > 0 ? hi : lo) - emitter.lane);
    const share = emitter.burstPending ? 1 : stage.swingMin + (1 - stage.swingMin) * this.rng.next();
    const distance = Math.min(full, Math.max(MIN_SWING, full * share));
    emitter.from = emitter.lane;
    emitter.to = emitter.lane + d * distance;
    emitter.elapsed = 0;
    // Swings share one peak speed, so a short swing is a quick one.
    emitter.duration = Math.max(0.4, (stage.crossing * distance) / (hi - lo));
    const turn = this.rng.next();
    const at = this.rng.next();
    emitter.reverseAt =
      !emitter.burstPending && turn < 1 - Math.exp(-stage.reversals * emitter.duration) ? emitter.duration * (0.3 + 0.4 * at) : Infinity;
  }

  /** Move the emitter along its pattern for this stage. */
  private moveEmitter(dt: number): void {
    const { stage, emitter } = this.state;
    if (emitter.pinFish > 0) return; // Pinned at a bank until the burst has spawned.
    emitter.elapsed += dt * this.config.tune.sweep;
    const dir: 1 | -1 = emitter.to >= emitter.from ? 1 : -1;
    if (emitter.elapsed >= emitter.reverseAt) {
      // A sudden reversal: the chain turns back mid-river.
      this.startSwing(dir > 0 ? -1 : 1);
      return;
    }
    const t = Math.min(1, emitter.elapsed / emitter.duration);
    emitter.lane = emitter.from + (emitter.to - emitter.from) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    if (t < 1) return;
    const [lo, hi] = this.config.banks;
    const atBank = Math.min(Math.abs(emitter.lane - lo), Math.abs(emitter.lane - hi)) < 0.01;
    if (stage.bursts && (emitter.burstPending || this.rng.next() < stage.bursts.share)) {
      if (atBank) {
        // Bank to Bank: a burst here, then straight across for another.
        emitter.burstPending = false;
        emitter.lane = Math.abs(emitter.lane - lo) < Math.abs(emitter.lane - hi) ? lo : hi;
        emitter.pinBursts = this.rng.next() < 0.3 ? 3 : 2;
        emitter.pinFish = this.burstSize();
        return;
      }
      emitter.burstPending = true;
      this.startSwing(dir);
      return;
    }
    this.startSwing(dir > 0 ? -1 : 1);
  }

  private burstSize(): number {
    const [min, max] = this.state.stage.bursts?.fish ?? [2, 3];
    return min + Math.floor(this.rng.next() * (max - min + 1));
  }

  /** A burst fish has spawned: when the burst is done, jump to the other bank or go back to sweeping. */
  private afterPinnedSpawn(): void {
    const { emitter } = this.state;
    const [lo, hi] = this.config.banks;
    emitter.pinFish -= 1;
    if (emitter.pinFish > 0) return;
    emitter.pinBursts -= 1;
    const left = Math.abs(emitter.lane - lo) < Math.abs(emitter.lane - hi);
    if (emitter.pinBursts > 0) {
      emitter.lane = left ? hi : lo;
      emitter.pinFish = this.burstSize();
    } else this.startSwing(left ? 1 : -1);
  }

  private stepEmitter(dt: number): void {
    const { emitter } = this.state;
    const pace = this.pace();
    this.clock += dt;
    this.moveEmitter(dt);

    emitter.spawnTimer -= dt;
    const lead = this.config.telegraphLead;
    if (!emitter.telegraphed && emitter.next === 'eel' && emitter.spawnTimer <= lead) {
      emitter.telegraphed = true;
      this.events.push({ type: 'telegraph', lane: emitter.lane, kind: 'eel' });
    }
    // When fish come faster than the lead time, the eel after next is announced too.
    if (!emitter.afterTelegraphed && emitter.afterNext === 'eel' && emitter.spawnTimer + pace.period <= lead) {
      emitter.afterTelegraphed = true;
      this.events.push({ type: 'telegraph', lane: emitter.lane, kind: 'eel' });
    }
    if (emitter.spawnTimer <= 0) {
      const pinned = emitter.pinFish > 0;
      this.spawn(emitter.next, emitter.lane, pinned);
      emitter.spawnTimer += pace.period;
      emitter.next = emitter.afterNext;
      emitter.telegraphed = emitter.afterTelegraphed;
      emitter.afterNext = this.rollKind();
      emitter.afterTelegraphed = false;
      if (pinned) this.afterPinnedSpawn();
    }
  }

  private makeFish(kind: FishKind, lane: number, progress: number): Fish {
    const firstEel = kind === 'eel' && !this.eelSeen;
    if (kind === 'eel') this.eelSeen = true;
    return {
      id: this.nextId++,
      kind,
      lane,
      prevLane: lane,
      progress,
      prevProgress: progress,
      speed: this.currentSpeed(),
      status: 'swimming',
      scoop: 1,
      closest: Infinity,
      firstEel,
    };
  }

  private spawn(kind: FishKind, emitterLane: number, pinned: boolean): void {
    const { fairness } = this.config;
    let lane = emitterLane;
    let finalKind = kind;

    // (a) While sweeping, the chain may not outrun the net: a non-eel stays within a share of what
    // the capped net covers in the time since the last one. The sweep itself keeps well inside
    // this; it only bites when the tune panel pushes the pace. A burst's jump across the river is
    // the pattern.
    const maxStep = this.config.net.cap * (this.clock - this.lastFishTime) * fairness.reachShare;
    if (!pinned && finalKind !== 'eel' && this.lastFishLane !== null && Math.abs(lane - this.lastFishLane) > maxStep) {
      lane = this.lastFishLane + Math.sign(lane - this.lastFishLane) * maxStep;
    }

    // (b) Eels and fish that reach the net within the window must be a gap apart.
    const speed = this.currentSpeed();
    const arrival = 1 / speed;
    const conflicts = this.state.fish.filter((other) => {
      if (other.status !== 'swimming' || (other.kind === 'eel') === (finalKind === 'eel')) return false;
      const otherArrival = (1 - other.progress) / speed;
      return Math.abs(otherArrival - arrival) <= fairness.eelWindow;
    });
    const clear = (candidate: number): boolean => conflicts.every((o) => Math.abs(o.lane - candidate) >= fairness.eelGap - 1e-9);
    if (!clear(lane)) {
      // Nearest lane that satisfies every conflict, if the river has room for one.
      const options = conflicts.flatMap((o) => [o.lane - fairness.eelGap, o.lane + fairness.eelGap]);
      const valid = options.filter((c) => c >= 0 && c <= 1 && clear(c)).sort((p, q) => Math.abs(p - lane) - Math.abs(q - lane));
      if (valid[0] !== undefined) lane = valid[0];
      else if (finalKind === 'eel') {
        // The warned eel becomes a fish: call the warning off.
        finalKind = 'bluegill';
        this.events.push({ type: 'telegraphCancel' });
      } else return; // No fair place for this fish: skip the spawn rather than trap the player.
    }

    const fish = this.makeFish(finalKind, clamp01(lane), 0);
    this.state.fish.push(fish);
    if (finalKind !== 'eel') {
      this.lastFishLane = fish.lane;
      this.lastFishTime = this.clock;
    }
    this.events.push({ type: 'spawn', fish });
  }

  private advanceFish(dt: number, live: boolean): void {
    const s = this.state;
    const { river, config } = this;
    const netPos = river.pointAt(1, s.net.lane);
    const netRadius = config.net.radius * river.railWidth;

    for (const fish of s.fish) {
      fish.prevProgress = fish.progress;
      fish.prevLane = fish.lane;

      // One current carries every fish, so a speed-up never bunches the chain.
      fish.speed = this.currentSpeed();
      if (fish.status === 'scooped') {
        // Slow to a quarter speed, slide to the net's lane, and shrink into it.
        fish.progress += fish.speed * 0.25 * dt;
        fish.lane += (s.net.lane - fish.lane) * (1 - Math.exp(-18 * dt));
        fish.scoop = Math.max(0, fish.scoop - dt / config.scoopSeconds);
        continue;
      }

      fish.progress += fish.speed * dt;
      if (!live || fish.status !== 'swimming') continue;

      const pos = river.pointAt(river.progressToS(fish.progress), fish.lane);
      const dist = Math.hypot(pos.x - netPos.x, pos.z - netPos.z);
      const reach = netRadius + config.radii[fish.kind] * river.railWidth;
      if (fish.kind === 'eel') fish.closest = Math.min(fish.closest, dist - reach);

      if (dist < reach) {
        this.onCatch(fish);
        if (s.status !== 'playing') live = false;
        continue;
      }
      // Past the rail and out of the net's reach: gone under the bridge.
      if (fish.progress >= 1 && pos.z < netPos.z - reach) this.onPass(fish);
      if (s.status !== 'playing') live = false;
    }

    s.fish = s.fish.filter((f) => (f.status === 'scooped' ? f.scoop > 0 : f.progress < config.exitProgress));
  }

  private onCatch(fish: Fish): void {
    const s = this.state;
    fish.status = 'scooped';
    if (fish.kind === 'eel') {
      s.status = 'lost';
      s.lossCause = 'eel';
      this.events.push({ type: 'eelCaught', fish }, { type: 'lose', cause: 'eel', time: s.time });
      return;
    }
    const weight = this.config.weights[fish.kind];
    s.caught += weight;
    s.catches += 1;
    s.streak += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    this.events.push({ type: 'catch', fish, weight, streak: s.streak, caught: s.caught });
    if (s.caught >= this.config.winWeight) {
      s.status = 'won';
      this.events.push({ type: 'win', time: s.time });
    }
  }

  private onPass(fish: Fish): void {
    const s = this.state;
    fish.status = 'escaped';
    if (fish.kind === 'eel') {
      if (fish.closest < this.config.nearMissMargin * this.river.railWidth) this.events.push({ type: 'eelNear', fish });
      return;
    }
    const weight = this.config.weights[fish.kind];
    s.escaped += weight;
    s.misses += 1;
    s.streak = 0;
    this.events.push({ type: 'miss', fish, weight, escaped: s.escaped });
    if (s.escaped >= this.config.maxEscaped) {
      s.status = 'lost';
      s.lossCause = 'escaped';
      this.events.push({ type: 'lose', cause: 'escaped', time: s.time });
    }
  }
}
