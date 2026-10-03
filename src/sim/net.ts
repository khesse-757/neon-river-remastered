import type { SimConfig } from './config';

/**
 * What the player asks of the net this step. Every device resolves to one of these and then
 * goes through the same speed cap, so no input method is faster than another.
 *  - axis: keyboard / gamepad, -1..1
 *  - target: pointer position as a lane 0..1
 *  - delta: relative touch drag, in lanes since the last step
 */
export type NetIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'axis'; readonly value: number }
  | { readonly kind: 'target'; readonly lane: number }
  | { readonly kind: 'delta'; readonly lanes: number };

export interface NetState {
  lane: number;
  prevLane: number;
  velocity: number;
  /** Where relative drags have asked the net to be. */
  dragTarget: number;
}

export const NO_INTENT: NetIntent = { kind: 'none' };

export function createNet(): NetState {
  return { lane: 0.5, prevLane: 0.5, velocity: 0, dragTarget: 0.5 };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function stepNet(net: NetState, intent: NetIntent, dt: number, config: SimConfig['net']): void {
  const { cap, accel, damping, followGain } = config;
  net.prevLane = net.lane;

  let wanted: number | null = null;
  if (intent.kind === 'axis' && intent.value !== 0) {
    wanted = clamp(intent.value, -1, 1) * cap;
    net.dragTarget = net.lane;
  } else if (intent.kind === 'target' || intent.kind === 'delta') {
    if (intent.kind === 'target') net.dragTarget = clamp(intent.lane, 0, 1);
    else net.dragTarget = clamp(net.dragTarget + intent.lanes, 0, 1);
    const error = net.dragTarget - net.lane;
    // Fastest approach that can still stop on the target without overshooting.
    const speed = Math.min(cap, followGain * Math.abs(error), Math.sqrt(2 * accel * Math.abs(error)));
    wanted = Math.sign(error) * speed;
  }

  if (wanted === null) {
    net.velocity *= Math.exp(-damping * dt);
    if (Math.abs(net.velocity) < 1e-4) net.velocity = 0;
    net.dragTarget = net.lane;
  } else {
    // Braking toward a pointer target may use the damping rate; speeding up uses accel.
    const braking = Math.abs(wanted) < Math.abs(net.velocity) && Math.sign(wanted) === Math.sign(net.velocity);
    const limit = (braking ? Math.max(accel, damping * Math.abs(net.velocity)) : accel) * dt;
    net.velocity += clamp(wanted - net.velocity, -limit, limit);
  }

  net.velocity = clamp(net.velocity, -cap, cap);
  net.lane += net.velocity * dt;
  if (net.lane <= 0 || net.lane >= 1) {
    net.lane = clamp(net.lane, 0, 1);
    net.velocity = 0;
  }
}
