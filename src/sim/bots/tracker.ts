import type { NetIntent } from '../net';
import type { SimState } from '../sim';

/**
 * A simple fish-following player used by the test hooks and smoke tests to produce
 * representative play. It is not the oracle bot (Gate 2): it chases the nearest catchable fish
 * and sidesteps eels that are about to arrive on its lane.
 */
export function trackerIntent(state: SimState, netRadius: number): NetIntent {
  let target: number | null = null;
  let best = -Infinity;
  for (const fish of state.fish) {
    if (fish.status !== 'swimming' || fish.kind === 'eel' || fish.progress > 1) continue;
    if (fish.progress > best) {
      best = fish.progress;
      target = fish.lane;
    }
  }
  let lane = target ?? state.net.lane;
  for (const fish of state.fish) {
    if (fish.kind !== 'eel' || fish.status !== 'swimming' || fish.progress < 0.8) continue;
    const gap = lane - fish.lane;
    const safe = netRadius * 1.9;
    if (Math.abs(gap) < safe) lane = fish.lane + (gap >= 0 ? safe : -safe);
  }
  return { kind: 'target', lane: Math.min(1, Math.max(0, lane)) };
}
