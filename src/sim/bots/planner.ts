import type { SimConfig } from '../config';
import type { NetIntent } from '../net';
import type { SimState } from '../sim';

/** What a bot can see of one fish. */
export interface Seen {
  readonly kind: 'bluegill' | 'koi' | 'eel';
  readonly lane: number;
  /** Seconds until it crosses the net rail. */
  readonly eta: number;
}

export function observe(state: SimState): { lane: number; fish: Seen[] } {
  const fish: Seen[] = [];
  for (const f of state.fish) {
    // An eel stays dangerous for a moment after it reaches the rail, so it is kept until it has passed.
    if (f.status !== 'swimming') continue;
    fish.push({ kind: f.kind, lane: f.lane, eta: (1 - f.progress) / f.speed });
  }
  fish.sort((a, b) => a.eta - b.eta);
  return { lane: state.net.lane, fish };
}

/** Seconds either side of an eel's arrival during which its lane is treated as occupied. */
const EEL_WINDOW = 0.22;

const CELLS = 61;

/**
 * Best lane to head for: a dynamic program over the upcoming arrivals. The net may only move as
 * far as its real speed cap allows between arrivals; it scores a fish it is under when the fish
 * arrives and may never be within reach of an eel when the eel arrives.
 */
export function planLane(
  netLane: number,
  fish: readonly Seen[],
  config: SimConfig,
  options: { lookahead: number; eelMargin: number; catchShare: number },
): number {
  // Catchable fish score at their arrival; each eel blocks its lane for a short window, sampled
  // densely enough that the net cannot hop across it between samples.
  interface Event {
    time: number;
    lane: number;
    kind: Seen['kind'];
  }
  const events: Event[] = [];
  let counted = 0;
  for (const f of fish) {
    if (f.kind === 'eel') {
      if (f.eta < -EEL_WINDOW) continue;
      for (const k of [-1, -0.5, 0, 0.5, 1]) events.push({ time: Math.max(0, f.eta + k * EEL_WINDOW), lane: f.lane, kind: 'eel' });
    } else if (f.eta > 0 && counted < options.lookahead) {
      counted += 1;
      events.push({ time: f.eta, lane: f.lane, kind: f.kind });
    }
  }
  if (events.length === 0) return netLane;
  events.sort((p, q) => p.time - q.time);
  const { cap, accel, radius } = config.net;
  const lane = (i: number): number => i / (CELLS - 1);
  // Only the first leg pays for getting up to speed; later legs chain at speed.
  const reachable = (dt: number, first: boolean): number => Math.max(0, cap * (dt - (first ? cap / accel / 2 : 0)) * 0.92);

  let score = new Float64Array(CELLS).fill(-Infinity);
  let first = new Int16Array(CELLS).fill(-1);
  let prevTime = 0;
  let started = false;
  for (const e of events) {
    const next = new Float64Array(CELLS).fill(-Infinity);
    const nextFirst = new Int16Array(CELLS).fill(-1);
    const reach = radius + config.radii[e.kind];
    const span = reachable(e.time - prevTime, !started);
    for (let j = 0; j < CELLS; j++) {
      const d = Math.abs(lane(j) - e.lane);
      if (e.kind === 'eel' && d < reach + options.eelMargin) continue;
      const gain = e.kind !== 'eel' && d < reach * options.catchShare ? config.weights[e.kind] : 0;
      if (!started) {
        if (Math.abs(lane(j) - netLane) > span + 1e-9) continue;
        next[j] = gain - Math.abs(lane(j) - netLane) * 0.01;
        nextFirst[j] = j;
        continue;
      }
      let best = -Infinity;
      let bestFirst = -1;
      const lo = Math.max(0, Math.ceil((lane(j) - span) * (CELLS - 1) - 1e-9));
      const hi = Math.min(CELLS - 1, Math.floor((lane(j) + span) * (CELLS - 1) + 1e-9));
      for (let k = lo; k <= hi; k++) {
        const v = (score[k] ?? -Infinity) - Math.abs(lane(j) - lane(k)) * 0.01;
        if (v > best) {
          best = v;
          bestFirst = first[k] ?? -1;
        }
      }
      if (best === -Infinity) continue;
      next[j] = best + gain;
      nextFirst[j] = bestFirst;
    }
    if (next.every((v) => v === -Infinity)) {
      // No legal cell in reach. If this is the very first event the net is inside an eel's lane
      // right now: run for the nearer edge of it.
      if (!started && e.kind === 'eel') {
        // Back away on the side the net is already on; crossing the eel's lane is how you get shocked.
        const edge = reach + options.eelMargin + 0.02;
        return netLane >= e.lane ? Math.min(1, e.lane + edge) : Math.max(0, e.lane - edge);
      }
      break;
    }
    score = next;
    first = nextFirst;
    prevTime = e.time;
    started = true;
  }
  let bestJ = -1;
  let bestS = -Infinity;
  for (let j = 0; j < CELLS; j++) {
    const s = score[j] ?? -Infinity;
    if (s > bestS) {
      bestS = s;
      bestJ = j;
    }
  }
  const target = bestJ >= 0 ? (first[bestJ] ?? -1) : -1;
  return target >= 0 ? lane(target) : netLane;
}

export const toIntent = (lane: number): NetIntent => ({ kind: 'target', lane: Math.min(1, Math.max(0, lane)) });
