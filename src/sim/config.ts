/**
 * Every tuning value for the simulation. Record changes in artifacts/game-progress.md.
 * Distances are in river-widths at the net rail unless noted; times in seconds.
 */
export type FishKind = 'bluegill' | 'koi' | 'eel';

/**
 * One of the four stages of the night. The emitter sweeps the river in eased swings (a sine in
 * Still Water); each speed-up moves to the next stage without pausing the spawns.
 */
export interface StageSpec {
  readonly id: string;
  readonly name: string;
  /** Fish speed, as a multiple of the base travel time's speed. */
  readonly speed: number;
  /** Seconds between spawns. */
  readonly period: number;
  /** Seconds for the emitter to cross the river bank to bank. */
  readonly crossing: number;
  /** A swing covers between this share and all of the way to the far bank (1 = always bank to bank). */
  readonly swingMin: number;
  /** Sudden mid-swing reversals per second. */
  readonly reversals: number;
  readonly eelChance: number;
  readonly koiChance: number;
  /** Fewest spawns between two eels. */
  readonly eelSpacing: number;
  /**
   * Bank to Bank: at the end of a swing, with probability `share`, the emitter pins to a bank for a
   * burst of `fish` spawns, then jumps straight to the other bank for another.
   */
  readonly bursts?: { readonly share: number; readonly fish: readonly [number, number] };
}

/** A speed-up fires at this much weight caught, or at this many seconds, whichever comes first. */
export interface SpeedUpSpec {
  readonly weight: number;
  readonly seconds: number;
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
    /** While sweeping, a non-eel may be at most this share of the net's reach in one spawn period from the last one. */
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
  /** Seconds from the far bend to the net at speed 1. */
  readonly travel: number;
  /** Time constant of the current picking up speed at a speed-up. */
  readonly speedEase: number;
  /** The lanes the emitter turns at: [left bank, right bank]. */
  readonly banks: readonly [number, number];
  /** The river is run for this long before a night starts, so fish are already on their way down. */
  readonly prefillSeconds: number;
  readonly tune: TuneSpec;
  /** How long the stage banner shows (render side). Spawning never waits for it. */
  readonly bannerSeconds: number;
  readonly stages: readonly StageSpec[];
  /** One fewer than the stages: speed-up n moves from stage n to stage n + 1. */
  readonly speedUps: readonly SpeedUpSpec[];
}

/**
 * "One Night on the River": Still Water, three speed-ups, and Bank to Bank until 200 lb.
 * Each speed-up is +12% fish speed, denser spawns, a faster sweep and more randomness.
 */
export const STAGES: readonly StageSpec[] = [
  {
    id: 'still-water',
    name: 'Still Water',
    speed: 1,
    period: 0.9,
    crossing: 4,
    swingMin: 1,
    reversals: 0,
    eelChance: 0.067,
    koiChance: 0.08,
    eelSpacing: 5,
  },
  {
    id: 'quickening',
    name: 'Quickening',
    speed: 1.12,
    period: 0.74,
    crossing: 3.0,
    swingMin: 0.55,
    reversals: 0.12,
    eelChance: 0.22,
    koiChance: 0.08,
    eelSpacing: 2,
  },
  {
    id: 'neon-rapids',
    name: 'Neon Rapids',
    speed: 1.254,
    period: 0.62,
    crossing: 1.8,
    swingMin: 0.4,
    reversals: 0.3,
    eelChance: 0.4,
    koiChance: 0.08,
    eelSpacing: 1,
  },
  {
    id: 'bank-to-bank',
    name: 'Bank to Bank',
    speed: 1.405,
    period: 0.5,
    crossing: 1.15,
    swingMin: 0.4,
    reversals: 0.4,
    eelChance: 0.5,
    koiChance: 0.07,
    eelSpacing: 0,
    bursts: { share: 0.65, fish: [2, 4] },
  },
];

export const DEFAULT_CONFIG: SimConfig = {
  winWeight: 200,
  maxEscaped: 20,
  bannerSeconds: 1.6,
  travel: 3.0,
  speedEase: 0.25,
  banks: [0.08, 0.92],
  prefillSeconds: 1.4,
  tune: { speed: 1, density: 1, sweep: 1, eel: 1 },
  weights: { bluegill: 1, koi: 5, eel: 0 },
  radii: { bluegill: 0.035, koi: 0.045, eel: 0.032 },
  net: { radius: 0.11, cap: 2.2, accel: 18, damping: 14, followGain: 14 },
  fairness: { reachShare: 0.5, eelWindow: 0.35, eelGap: 0.4 },
  telegraphLead: 0.6,
  nearMissMargin: 0.06,
  scoopSeconds: 0.28,
  exitProgress: 1.07,
  stages: STAGES,
  speedUps: [
    { weight: 40, seconds: 35 },
    { weight: 90, seconds: 65 },
    { weight: 140, seconds: 95 },
  ],
};
