import type { SimConfig } from '../config';
import type { NetIntent } from '../net';
import type { SimState } from '../sim';
import { observe, planLane, toIntent } from './planner';

/**
 * Oracle: perfect information about every fish in the river, but the real net (same speed cap,
 * same acceleration). Proves a run is winnable without touching an eel.
 */
export function oracleIntent(state: SimState, config: SimConfig): NetIntent {
  const seen = observe(state);
  return toIntent(planLane(seen.lane, seen.fish, config, { lookahead: 10, eelMargin: 0.035, catchShare: 0.7 }));
}
