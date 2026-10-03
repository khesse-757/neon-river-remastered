import type { SimConfig } from '../config';
import type { NetIntent } from '../net';
import { createRng, type Rng } from '../rng';
import type { SimState } from '../sim';
import { observe, planLane, toIntent, type Seen } from './planner';

export interface HumanOptions {
  /** Seconds between seeing the river and acting on it. */
  readonly reaction: number;
  /** Standard deviation of aim error, in lanes. */
  readonly aimNoise: number;
  /** How many arrivals ahead the player plans. */
  readonly lookahead: number;
}

export const SOLID_PLAYER: HumanOptions = { reaction: 0.22, aimNoise: 0.03, lookahead: 4 };

/**
 * Human-like player: sees the river 220 ms late, plans only a few fish ahead, aims with noise,
 * and uses the same speed-capped net.
 */
export class HumanBot {
  private readonly rng: Rng;
  private readonly history: { time: number; lane: number; fish: Seen[] }[] = [];
  private wobble = 0;
  private wobbleUntil = 0;

  constructor(
    seed: number,
    private readonly options: HumanOptions = SOLID_PLAYER,
  ) {
    this.rng = createRng(seed ^ 0x51ed270b);
  }

  intent(state: SimState, config: SimConfig): NetIntent {
    this.history.push({ time: state.time, ...observe(state) });
    while (this.history.length > 2 && (this.history[1]?.time ?? Infinity) <= state.time - this.options.reaction) this.history.shift();
    const seen = this.history[0];
    if (!seen || seen.time > state.time - this.options.reaction + 1e-9) return { kind: 'none' };
    // The delayed picture, advanced by nothing: the player aims at where things were heading.
    const fish = seen.fish.map((f) => ({ ...f, eta: f.eta - (state.time - seen.time) }));
    if (state.time >= this.wobbleUntil) {
      // Aim error is re-drawn a few times a second (Box-Muller).
      const u = Math.max(1e-9, this.rng.next());
      this.wobble = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng.next()) * this.options.aimNoise;
      this.wobbleUntil = state.time + 0.2 + this.rng.next() * 0.2;
    }
    const lane = planLane(
      state.net.lane,
      fish,
      config, // A person aims at the middle of the fish, not at the edge of what would still count.
      { lookahead: this.options.lookahead, eelMargin: 0.09, catchShare: 0.45 },
    );
    return toIntent(lane + this.wobble);
  }
}
