/**
 * Every tuning value for the simulation. Record changes in artifacts/game-progress.md.
 * Distances are in river-widths at the net rail unless noted; times in seconds.
 */
export type FishKind = 'bluegill' | 'koi' | 'eel';

/** A phase shapes the pattern; the continuous ramp sets the base speed, density and sweep. */
export interface PhaseSpec {
  readonly id: string;
  readonly name: string;
  readonly length: number;
  /** Multipliers on the ramp's sweep, spawn period and travel time. */
  readonly sweepMul: number;
  readonly periodMul: number;
  readonly travelMul: number;
  readonly swingMin: number;
  readonly swingMax: number;
  readonly eelChance: number;
  readonly koiChance: number;
  /** Pin the emitter to alternating banks, switching every this many seconds. */
  readonly pinned?: number;
}

/**
 * The continuous ramp. Progress runs 0..1 on whichever is further along: elapsed time over
 * `seconds`, or weight caught over the goal. Each pair is [start, end].
 */
export interface RampSpec {
  readonly seconds: number;
  /** Seconds from the far bend to the net. */
  readonly travel: readonly [number, number];
  /** Seconds between spawns. */
  readonly period: readonly [number, number];
  /** Emitter sweep, river-widths per second. */
  readonly sweep: readonly [number, number];
}

/** Live multipliers from the dev `?tune` panel. All 1 in a normal run. */
export interface TuneSpec {
  readonly speed: number;
  readonly density: number;
  readonly sweep: number;
  readonly eel: number;
}

export interface SimConfig {
  readonly winWeight: number;
  readonly maxEscaped: number;
  readonly restSeconds: number;
  readonly weights: Readonly<Record<FishKind, number>>;
  /** Hitbox radii. The eel's is already scaled to ~85% of its visual. */
  readonly radii: Readonly<Record<FishKind, number>>;
  readonly net: {
    readonly radius: number;
    /** Max speed, widths/s. The same for every input device. */
    readonly cap: number;
    readonly accel: number;
    /** Velocity decay rate when there is no input. */
    readonly damping: number;
    /** Pointer follower stiffness, 1/s. */
    readonly followGain: number;
  };
  readonly fairness: {
    /** Non-eel spawns further than this from the previous spawn are pulled to the midpoint. */
    readonly maxJump: number;
    /** A non-eel may jump at most this share of what the net can cover in one spawn period. */
    readonly reachShare: number;
    /** Eels and fish arriving within this many seconds must be `eelGap` apart. */
    readonly eelWindow: number;
    readonly eelGap: number;
  };
  /** Eels announce themselves this long before they appear. */
  readonly telegraphLead: number;
  /** Extra clearance that still counts as a near miss with an eel. */
  readonly nearMissMargin: number;
  readonly scoopSeconds: number;
  /** Progress past the rail at which a fish is gone under the bridge. */
  readonly exitProgress: number;
  readonly ramp: RampSpec;
  readonly tune: TuneSpec;
  /** Fish already in the river when a run starts: [progress, lane offset from the emitter]. */
  readonly prefill: readonly (readonly [number, number])[];
  /** How long the phase banner shows (render side); spawning resumes after `restSeconds`. */
  readonly bannerSeconds: number;
  readonly phases: readonly PhaseSpec[];
  /** Phase indices to cycle through once the script runs out. */
  readonly loopPhases: readonly number[];
}

const swing = { swingMin: 0.5, swingMax: 2 };
const base = { sweepMul: 1, periodMul: 1, travelMul: 1, ...swing };

/**
 * "One Night on the River". The whole night runs on a single emitter for now (pinned banks in
 * Twin Banks); the second emitter for Braided Stream is Gate 2. After Moonrise the script loops
 * the last four phases until the run ends.
 */
export const PHASES: readonly PhaseSpec[] = [
  { ...base, id: 'still-water', name: 'Still Water', length: 11, sweepMul: 0.8, eelChance: 0.22, koiChance: 0.03 },
  { ...base, id: 'first-spark', name: 'First Spark', length: 12, eelChance: 0.34, koiChance: 0.04 },
  { ...base, id: 'lantern-koi', name: 'Lantern Koi', length: 10, sweepMul: 1.6, periodMul: 1.25, eelChance: 0.28, koiChance: 0.14 },
  { ...base, id: 'twin-banks', name: 'Twin Banks', length: 9, pinned: 3, periodMul: 1.2, eelChance: 0.24, koiChance: 0.08 },
  { ...base, id: 'rising-tide', name: 'Rising Tide', length: 14, periodMul: 0.92, eelChance: 0.36, koiChance: 0.04 },
  { ...base, id: 'neon-rapids', name: 'Neon Rapids', length: 14, sweepMul: 1.4, eelChance: 0.38, koiChance: 0.04 },
  { ...base, id: 'eel-storm', name: 'Eel Storm', length: 10, periodMul: 0.9, eelChance: 0.66, koiChance: 0.1 },
  {
    ...base,
    id: 'braided-stream',
    name: 'Braided Stream',
    length: 12,
    sweepMul: 1.3,
    swingMin: 0.3,
    swingMax: 0.9,
    periodMul: 0.93,
    eelChance: 0.5,
    koiChance: 0.05,
  },
  { ...base, id: 'moonrise', name: 'Moonrise', length: 16, periodMul: 0.93, sweepMul: 1, eelChance: 0.52, koiChance: 0.06 },
];

export const DEFAULT_CONFIG: SimConfig = {
  winWeight: 200,
  maxEscaped: 20,
  restSeconds: 0.75,
  bannerSeconds: 1.6,
  ramp: { seconds: 135, travel: [3.0, 1.9], period: [0.62, 0.42], sweep: [0.8, 3.0] },
  tune: { speed: 1, density: 1, sweep: 1, eel: 1 },
  prefill: [
    [0.42, 0],
    [0.24, 0.07],
    [0.06, 0.14],
  ],
  weights: { bluegill: 1, koi: 5, eel: 0 },
  radii: { bluegill: 0.035, koi: 0.045, eel: 0.032 },
  net: { radius: 0.11, cap: 2.2, accel: 18, damping: 14, followGain: 14 },
  fairness: { maxJump: 0.8, reachShare: 0.4, eelWindow: 0.35, eelGap: 0.4 },
  telegraphLead: 0.6,
  nearMissMargin: 0.06,
  scoopSeconds: 0.28,
  exitProgress: 1.07,
  phases: PHASES,
  loopPhases: [5, 6, 7, 8],
};
