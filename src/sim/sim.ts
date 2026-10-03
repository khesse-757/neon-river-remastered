import { DEFAULT_CONFIG, type FishKind, type PhaseSpec, type SimConfig } from './config';
import { createNet, stepNet, NO_INTENT, type NetIntent, type NetState } from './net';
import type { River } from './river';
import { createRng, type Rng } from './rng';

export type FishStatus = 'swimming' | 'scooped' | 'escaped';

export interface Fish {
  readonly id: number;
  readonly kind: FishKind;
  lane: number;
  prevLane: number;
  /** 0 at the far bend, 1 at the net rail; linear in time. */
  progress: number;
  prevProgress: number;
  /** Progress per second. */
  readonly speed: number;
  status: FishStatus;
  /** 1 -> 0 while being scooped into the net. */
  scoop: number;
  /** Closest an eel came to the net (world units), for near-miss feedback. */
  closest: number;
  readonly firstEel: boolean;
}

export type LossCause = 'eel' | 'escaped';

export type SimEvent =
  | { type: 'restStart'; next: PhaseSpec }
  | { type: 'phaseStart'; phase: PhaseSpec; index: number }
  | { type: 'telegraph'; lane: number; kind: FishKind }
  | { type: 'spawn'; fish: Fish }
  | { type: 'catch'; fish: Fish; weight: number; streak: number; caught: number }
  | { type: 'miss'; fish: Fish; weight: number; escaped: number }
  | { type: 'eelNear'; fish: Fish }
  | { type: 'eelCaught'; fish: Fish }
  | { type: 'win'; time: number }
  | { type: 'lose'; cause: LossCause; time: number };

export interface EmitterState {
  lane: number;
  dir: 1 | -1;
  swingLeft: number;
  spawnTimer: number;
  next: FishKind;
  telegraphed: boolean;
}

export type RunStatus = 'playing' | 'won' | 'lost';

export interface SimState {
  time: number;
  status: RunStatus;
  lossCause: LossCause | null;
  /** Index into the script of the current (or upcoming, during a rest) phase. */
  phaseIndex: number;
  phase: PhaseSpec;
  resting: boolean;
  /** Seconds left in the current rest or phase. */
  phaseTimer: number;
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
  /** Start the script at this phase (test hooks). */
  readonly startPhase?: number;
  /** Skip the opening rest. */
  readonly skipRest?: boolean;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export class Sim {
  readonly config: SimConfig;
  readonly river: River;
  readonly state: SimState;
  private readonly rng: Rng;
  private events: SimEvent[] = [];
  private nextId = 1;
  private lastSpawnLane: number | null = null;
  private eelSeen = false;
  private scriptStep: number;

  constructor(options: SimOptions) {
    this.config = options.config ?? DEFAULT_CONFIG;
    this.river = options.river;
    this.rng = createRng(options.seed);
    this.scriptStep = options.startPhase ?? 0;
    const phase = this.phaseForStep(this.scriptStep);
    this.state = {
      time: 0,
      status: 'playing',
      lossCause: null,
      phaseIndex: this.config.phases.indexOf(phase),
      phase,
      resting: !options.skipRest,
      phaseTimer: options.skipRest ? phase.length : this.config.restSeconds,
      emitter: this.freshEmitter(phase),
      net: createNet(),
      fish: [],
      caught: 0,
      escaped: 0,
      streak: 0,
      bestStreak: 0,
      catches: 0,
      misses: 0,
    };
    if (options.skipRest) this.events.push({ type: 'phaseStart', phase, index: this.state.phaseIndex });
    else this.events.push({ type: 'restStart', next: phase });
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
    stepNet(s.net, intent, dt, this.config.net);
    this.stepDirector(dt);
    if (!s.resting) this.stepEmitter(dt);
    this.advanceFish(dt, true);
  }

  /** Place a fish directly (test hooks and unit tests). */
  debugSpawn(kind: FishKind, lane: number, progress: number): Fish {
    const fish = this.makeFish(kind, lane, progress);
    this.state.fish.push(fish);
    return fish;
  }

  private phaseForStep(step: number): PhaseSpec {
    const { phases, loopPhases } = this.config;
    if (step < phases.length) return phases[step] as PhaseSpec;
    const loopIndex = loopPhases[(step - phases.length) % loopPhases.length] ?? 0;
    return phases[loopIndex] as PhaseSpec;
  }

  private freshEmitter(phase: PhaseSpec): EmitterState {
    const prev = this.state as SimState | undefined;
    return {
      lane: prev?.emitter.lane ?? 0.5,
      dir: prev?.emitter.dir ?? (this.rng.next() < 0.5 ? 1 : -1),
      swingLeft: this.rng.range(phase.swingMin, phase.swingMax),
      // Long enough that an eel opening a phase still gets its full warning.
      spawnTimer: Math.max(this.config.telegraphLead + 0.05, Math.min(0.35, phase.period)),
      next: this.rollKind(phase),
      telegraphed: false,
    };
  }

  private stepDirector(dt: number): void {
    const s = this.state;
    s.phaseTimer -= dt;
    if (s.phaseTimer > 0) return;
    if (s.resting) {
      s.resting = false;
      s.phaseTimer += s.phase.length;
      s.emitter = this.freshEmitter(s.phase);
      this.events.push({ type: 'phaseStart', phase: s.phase, index: s.phaseIndex });
    } else {
      this.scriptStep += 1;
      s.phase = this.phaseForStep(this.scriptStep);
      s.phaseIndex = this.config.phases.indexOf(s.phase);
      s.resting = true;
      s.phaseTimer += this.config.restSeconds;
      this.events.push({ type: 'restStart', next: s.phase });
    }
  }

  private rollKind(phase: PhaseSpec): FishKind {
    // Koi is rolled first, then eel, like the original's power-up / bad-fish order.
    if (this.rng.next() < phase.koiChance) return 'koi';
    if (this.rng.next() < phase.eelChance) return 'eel';
    return 'bluegill';
  }

  private stepEmitter(dt: number): void {
    const { phase, emitter } = this.state;
    const elapsed = clamp01(1 - this.state.phaseTimer / phase.length);
    const sweep = phase.sweepEnd === undefined ? phase.sweep : phase.sweep + (phase.sweepEnd - phase.sweep) * elapsed;

    emitter.lane += emitter.dir * sweep * dt;
    // Reflect off the banks; a fast sweep can cross the river more than once per step.
    while (emitter.lane < 0 || emitter.lane > 1) {
      emitter.lane = emitter.lane < 0 ? -emitter.lane : 2 - emitter.lane;
      emitter.dir = emitter.dir === 1 ? -1 : 1;
    }
    emitter.swingLeft -= dt;
    if (emitter.swingLeft <= 0) {
      emitter.dir = emitter.dir === 1 ? -1 : 1;
      emitter.swingLeft += this.rng.range(phase.swingMin, phase.swingMax);
    }

    emitter.spawnTimer -= dt;
    if (!emitter.telegraphed && emitter.next === 'eel' && emitter.spawnTimer <= this.config.telegraphLead) {
      emitter.telegraphed = true;
      this.events.push({ type: 'telegraph', lane: emitter.lane, kind: 'eel' });
    }
    if (emitter.spawnTimer <= 0) {
      this.spawn(emitter.next, emitter.lane);
      emitter.spawnTimer += phase.period;
      emitter.next = this.rollKind(phase);
      emitter.telegraphed = false;
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
      speed: 1 / this.state.phase.travel,
      status: 'swimming',
      scoop: 1,
      closest: Infinity,
      firstEel,
    };
  }

  private spawn(kind: FishKind, emitterLane: number): void {
    const { fairness } = this.config;
    let lane = emitterLane;
    let finalKind = kind;

    // (a) A non-eel that would appear too far from the previous spawn is pulled to the midpoint.
    if (finalKind !== 'eel' && this.lastSpawnLane !== null && Math.abs(lane - this.lastSpawnLane) > fairness.maxJump) {
      lane = (lane + this.lastSpawnLane) / 2;
    }

    // (b) Eels and fish that reach the net within the window must be a gap apart.
    const speed = 1 / this.state.phase.travel;
    const arrival = 1 / speed;
    const conflicts = this.state.fish.filter((other) => {
      if (other.status !== 'swimming' || (other.kind === 'eel') === (finalKind === 'eel')) return false;
      const otherArrival = (1 - other.progress) / other.speed;
      return Math.abs(otherArrival - arrival) <= fairness.eelWindow;
    });
    const clear = (candidate: number): boolean => conflicts.every((o) => Math.abs(o.lane - candidate) >= fairness.eelGap - 1e-9);
    if (!clear(lane)) {
      // Nearest lane that satisfies every conflict, if the river has room for one.
      const options = conflicts.flatMap((o) => [o.lane - fairness.eelGap, o.lane + fairness.eelGap]);
      const valid = options.filter((c) => c >= 0 && c <= 1 && clear(c)).sort((p, q) => Math.abs(p - lane) - Math.abs(q - lane));
      if (valid[0] !== undefined) lane = valid[0];
      else if (finalKind === 'eel') finalKind = 'bluegill';
      else return; // No fair place for this fish: skip the spawn rather than trap the player.
    }

    const fish = this.makeFish(finalKind, clamp01(lane), 0);
    this.state.fish.push(fish);
    this.lastSpawnLane = fish.lane;
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
