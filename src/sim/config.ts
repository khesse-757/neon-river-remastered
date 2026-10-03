/**
 * Every tuning value for the simulation. Record changes in artifacts/game-progress.md.
 * Distances are in river-widths at the net rail unless noted; times in seconds.
 */
export type FishKind = 'bluegill' | 'koi' | 'eel';

export interface PhaseSpec {
  readonly id: string;
  readonly name: string;
  readonly length: number;
  /** Emitter sweep speed, river-widths per second. */
  readonly sweep: number;
  /** Sweep at the end of the phase, when it ramps. */
  readonly sweepEnd?: number;
  readonly swingMin: number;
  readonly swingMax: number;
  readonly period: number;
  /** Seconds from the far bend to the net. */
  readonly travel: number;
  readonly eelChance: number;
  readonly koiChance: number;
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
  readonly phases: readonly PhaseSpec[];
  /** Phase indices to cycle through once the script runs out. */
  readonly loopPhases: readonly number[];
}

const swing = { swingMin: 0.5, swingMax: 2 };

/** "One Night on the River", brief §3.3. Gate 1 runs the first three and loops 2–3. */
export const PHASES: readonly PhaseSpec[] = [
  { id: 'still-water', name: 'Still Water', length: 10, sweep: 0.6, ...swing, period: 0.7, travel: 4.2, eelChance: 0, koiChance: 0.1 },
  { id: 'first-spark', name: 'First Spark', length: 10, sweep: 0.6, ...swing, period: 0.7, travel: 4.0, eelChance: 0.2, koiChance: 0.1 },
  { id: 'lantern-koi', name: 'Lantern Koi', length: 8, sweep: 3.0, ...swing, period: 0.65, travel: 3.8, eelChance: 0.1, koiChance: 0.25 },
];

export const DEFAULT_CONFIG: SimConfig = {
  winWeight: 200,
  maxEscaped: 20,
  restSeconds: 2,
  weights: { bluegill: 1, koi: 5, eel: 0 },
  radii: { bluegill: 0.035, koi: 0.045, eel: 0.0425 },
  net: { radius: 0.11, cap: 2.2, accel: 18, damping: 14, followGain: 14 },
  fairness: { maxJump: 0.8, eelWindow: 0.35, eelGap: 0.25 },
  telegraphLead: 0.6,
  nearMissMargin: 0.06,
  scoopSeconds: 0.28,
  exitProgress: 1.07,
  phases: PHASES,
  loopPhases: [1, 2],
};
