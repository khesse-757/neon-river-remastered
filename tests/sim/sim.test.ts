import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { RIVER } from '../../src/data/river';
import { trackerIntent } from '../../src/sim/bots/tracker';
import { DEFAULT_CONFIG, type SimConfig } from '../../src/sim/config';
import { createNet, stepNet, type NetIntent } from '../../src/sim/net';
import { River } from '../../src/sim/river';
import { createRng } from '../../src/sim/rng';
import { Sim, type SimEvent } from '../../src/sim/sim';

const DT = 1 / 60;
const river = new River(RIVER);
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

function run(seed: number, seconds: number, intent: (sim: Sim) => NetIntent, config?: SimConfig): { sim: Sim; events: SimEvent[] } {
  const sim = new Sim({ seed, river, config });
  const events: SimEvent[] = [];
  for (let i = 0; i < seconds / DT && sim.state.status === 'playing'; i++) {
    sim.step(DT, intent(sim));
    events.push(...sim.drainEvents());
  }
  return { sim, events };
}
const idle = (): NetIntent => ({ kind: 'none' });
const tracker = (sim: Sim): NetIntent => trackerIntent(sim.state, sim.config.net.radius);

describe('rng', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(createRng(43).next()).not.toBe(createRng(42).next());
  });
});

describe('river', () => {
  it('round-trips the camera projection', () => {
    const p = river.camera.project(0.2, 4);
    const w = river.camera.unproject(p.x, p.y);
    expect(w.x).toBeCloseTo(0.2, 6);
    expect(w.z).toBeCloseTo(4, 6);
  });

  it('keeps every lane on the water from the far bend to the rail', () => {
    const png = PNG.sync.read(readFileSync('public/assets/scene/216x387/masks-a.png'));
    const onWater = (x: number, y: number): boolean => {
      const gx = Math.floor((x / 768) * png.width);
      const gy = Math.floor((y / 1376) * png.height);
      const i = (gy * png.width + gx) * 4;
      // Water or reeds standing in the water.
      return (png.data[i] ?? 0) > 0 || (png.data[i + 1] ?? 0) > 0;
    };
    const misses: string[] = [];
    for (let s = 0; s <= 1.0001; s += 0.01)
      for (let lane = 0; lane <= 1.0001; lane += 0.05) {
        const p = river.screenAt(s, lane);
        if (!onWater(p.x, p.y)) misses.push(`s=${s.toFixed(2)} lane=${lane.toFixed(2)} (${p.x.toFixed(0)},${p.y.toFixed(0)})`);
      }
    expect(misses).toEqual([]);
  });

  it('maps progress monotonically onto the path and grows fish toward the net', () => {
    let last = -1;
    for (let u = 0; u <= 1.05; u += 0.01) {
      const s = river.progressToS(u);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
    expect(river.progressToS(0)).toBeCloseTo(0, 6);
    expect(river.progressToS(1)).toBeCloseTo(1, 3);
    expect(river.screenAt(1, 0.5).scale).toBeGreaterThan(river.screenAt(0, 0.5).scale * 3);
  });
});

describe('net', () => {
  const cfg = DEFAULT_CONFIG.net;
  const measure = (intent: NetIntent, start: number): { peak: number; timeToCap: number } => {
    const net = createNet();
    net.lane = start;
    net.dragTarget = start;
    let peak = 0;
    let timeToCap = Infinity;
    for (let i = 0; i < 120; i++) {
      stepNet(net, intent, DT, cfg);
      peak = Math.max(peak, Math.abs(net.velocity));
      if (timeToCap === Infinity && Math.abs(net.velocity) >= cfg.cap * 0.999) timeToCap = (i + 1) * DT;
      expect(Math.abs(net.velocity)).toBeLessThanOrEqual(cfg.cap + 1e-9);
    }
    return { peak, timeToCap };
  };

  it('gives keyboard, pointer and touch the same top speed and time to reach it', () => {
    const key = measure({ kind: 'axis', value: 1 }, 0);
    const pointer = measure({ kind: 'target', lane: 1 }, 0);
    const netT = createNet();
    netT.lane = 0;
    netT.dragTarget = 0;
    stepNet(netT, { kind: 'delta', lanes: 1 }, DT, cfg);
    let touchPeak = Math.abs(netT.velocity);
    for (let i = 0; i < 60; i++) {
      stepNet(netT, { kind: 'delta', lanes: 0 }, DT, cfg);
      touchPeak = Math.max(touchPeak, Math.abs(netT.velocity));
    }
    expect(key.peak).toBeCloseTo(cfg.cap, 6);
    expect(pointer.peak).toBeCloseTo(cfg.cap, 6);
    expect(touchPeak).toBeCloseTo(cfg.cap, 6);
    expect(key.timeToCap).toBeCloseTo(pointer.timeToCap, 6);
    expect(key.timeToCap).toBeLessThan(0.15);
  });

  it('stops on a pointer target without overshooting and stays in bounds', () => {
    const net = createNet();
    net.lane = 0.1;
    let max = 0;
    for (let i = 0; i < 180; i++) {
      stepNet(net, { kind: 'target', lane: 0.7 }, DT, cfg);
      max = Math.max(max, net.lane);
    }
    expect(net.lane).toBeCloseTo(0.7, 3);
    expect(max).toBeLessThanOrEqual(0.7 + 1e-3);
    for (let i = 0; i < 120; i++) stepNet(net, { kind: 'axis', value: 1 }, DT, cfg);
    expect(net.lane).toBe(1);
    expect(net.velocity).toBe(0);
  });

  it('coasts to rest when input stops', () => {
    const net = createNet();
    for (let i = 0; i < 10; i++) stepNet(net, { kind: 'axis', value: -1 }, DT, cfg);
    for (let i = 0; i < 60; i++) stepNet(net, { kind: 'none' }, DT, cfg);
    expect(net.velocity).toBe(0);
  });
});

describe('phases and emitter', () => {
  it('opens straight into play with fish already in the river, then alternates phases and short rests', () => {
    const sim = new Sim({ seed: 7, river });
    expect(sim.state.resting).toBe(false);
    expect(sim.state.fish.length).toBe(DEFAULT_CONFIG.prefill.length);
    const marks: { type: string; t: number }[] = [];
    for (const e of sim.drainEvents()) marks.push({ type: e.type, t: 0 });
    let firstArrival = Infinity;
    for (let i = 0; i < 40 / DT && sim.state.status === 'playing'; i++) {
      sim.step(DT, tracker(sim));
      for (const e of sim.drainEvents()) {
        if (e.type === 'phaseStart' || e.type === 'restStart') marks.push({ type: e.type, t: sim.state.time });
        if ((e.type === 'catch' || e.type === 'miss') && firstArrival === Infinity) firstArrival = sim.state.time;
      }
    }
    // The first fish reaches the net within about two seconds.
    expect(firstArrival).toBeLessThan(2.1);
    expect(marks.slice(0, 4).map((m) => m.type)).toEqual(['phaseStart', 'restStart', 'phaseStart', 'restStart']);
    const [p0, p1] = DEFAULT_CONFIG.phases;
    expect(marks[1]?.t).toBeCloseTo(p0!.length, 1);
    expect(marks[2]?.t).toBeCloseTo(p0!.length + DEFAULT_CONFIG.restSeconds, 1);
    expect(marks[3]?.t).toBeCloseTo(p0!.length + DEFAULT_CONFIG.restSeconds + p1!.length, 1);
    expect(DEFAULT_CONFIG.restSeconds).toBeLessThanOrEqual(0.75);
  });

  it('tightens travel, period and sweep continuously along the ramp', () => {
    const sim = new Sim({ seed: 3, river });
    const start = sim.pace();
    let last = start;
    for (let i = 0; i < 9 / DT; i++) {
      sim.step(DT, tracker(sim));
      sim.drainEvents();
      const now = sim.pace();
      expect(now.travel).toBeLessThanOrEqual(last.travel + 1e-9);
      expect(now.period).toBeLessThanOrEqual(last.period + 1e-9);
      last = now;
    }
    expect(last.travel).toBeLessThan(start.travel);
    expect(sim.state.ramp).toBeGreaterThan(0);
    // The ramp also follows weight: a nearly full basket is at full pace whatever the clock says.
    const late = new Sim({ seed: 3, river, empty: true });
    late.state.caught = DEFAULT_CONFIG.winWeight - 1;
    late.step(DT, { kind: 'none' });
    expect(late.state.ramp).toBeGreaterThan(0.99);
    expect(late.pace().travel).toBeCloseTo(DEFAULT_CONFIG.ramp.travel[1] * late.state.phase.travelMul, 1);
  });

  it('never spawns during a rest, and never spawns eels in a phase without them', () => {
    const calm: SimConfig = { ...DEFAULT_CONFIG, phases: DEFAULT_CONFIG.phases.map((p, i) => (i === 0 ? { ...p, eelChance: 0 } : p)) };
    for (const seed of SEEDS.slice(0, 40)) {
      const sim = new Sim({ seed, river, config: calm });
      for (let i = 0; i < 16 / DT && sim.state.status === 'playing'; i++) {
        const resting = sim.state.resting;
        const phase = sim.state.phase.id;
        sim.step(DT, tracker(sim));
        for (const e of sim.drainEvents()) {
          if (e.type !== 'spawn') continue;
          expect(resting && sim.state.resting).toBe(false);
          if (phase === 'still-water' && sim.state.phase.id === 'still-water') expect(e.fish.kind).not.toBe('eel');
        }
      }
    }
  });

  it('keeps the emitter and every spawn inside the river on 200 seeds', () => {
    for (const seed of SEEDS) {
      const sim = new Sim({ seed, river });
      for (let i = 0; i < 34 / DT && sim.state.status === 'playing'; i++) {
        sim.step(DT, tracker(sim));
        const lane = sim.state.emitter.lane;
        expect(lane).toBeGreaterThanOrEqual(0);
        expect(lane).toBeLessThanOrEqual(1);
        for (const e of sim.drainEvents())
          if (e.type === 'spawn') {
            expect(e.fish.lane).toBeGreaterThanOrEqual(0);
            expect(e.fish.lane).toBeLessThanOrEqual(1);
          }
      }
    }
  });

  it('holds lanes: a swimming fish never drifts sideways', () => {
    const sim = new Sim({ seed: 3, river });
    const lanes = new Map<number, number>();
    for (let i = 0; i < 20 / DT; i++) {
      sim.step(DT, idle());
      for (const f of sim.state.fish) {
        if (f.status !== 'swimming') continue;
        if (!lanes.has(f.id)) lanes.set(f.id, f.lane);
        expect(f.lane).toBe(lanes.get(f.id));
      }
      if (sim.state.status !== 'playing') break;
    }
    expect(lanes.size).toBeGreaterThan(10);
  });

  it('telegraphs every eel before it appears', () => {
    const { events } = run(11, 34, tracker);
    let pending = 0;
    let eels = 0;
    for (const e of events) {
      if (e.type === 'telegraph') pending++;
      if (e.type === 'spawn' && e.fish.kind === 'eel') {
        eels++;
        expect(pending).toBeGreaterThan(0);
        pending--;
      }
    }
    expect(eels).toBeGreaterThan(0);
  });
});

describe('eel warnings and spacing at the net', () => {
  it('warns of every eel a full lead (or a full spawn period) ahead, even as the first spawn of a phase', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const sim = new Sim({ seed, river });
      let warnedAt: number | null = null;
      for (let i = 0; i < 34 / DT && sim.state.status === 'playing'; i++) {
        sim.step(DT, tracker(sim));
        for (const e of sim.drainEvents()) {
          if (e.type === 'telegraph') warnedAt = sim.state.time;
          if (e.type === 'spawn' && e.fish.kind === 'eel') {
            expect(warnedAt).not.toBeNull();
            // The warning comes as early as the spawn rhythm allows: the full lead, or one spawn period.
            const lead = Math.min(DEFAULT_CONFIG.telegraphLead, sim.pace().period);
            expect(sim.state.time - (warnedAt ?? 0)).toBeGreaterThanOrEqual(lead - 2 * DT - 1e-6);
            warnedAt = null;
          }
        }
      }
    }
  });

  it('never has an eel and a fish cross the rail close together in both time and lane', () => {
    // Measured where it matters: actual rail-crossing times and lanes, not spawn-time estimates.
    const { eelWindow, eelGap } = DEFAULT_CONFIG.fairness;
    for (const seed of SEEDS) {
      const sim = new Sim({ seed, river, config: { ...DEFAULT_CONFIG, maxEscaped: 1e9 } });
      const crossings: { t: number; lane: number; eel: boolean }[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < 34 / DT; i++) {
        sim.step(DT, idle());
        sim.drainEvents();
        for (const f of sim.state.fish)
          if (f.progress >= 1 && !seen.has(f.id) && f.status !== 'scooped') {
            seen.add(f.id);
            crossings.push({ t: sim.state.time, lane: f.lane, eel: f.kind === 'eel' });
          }
        if (sim.state.status !== 'playing') break;
      }
      for (const a of crossings)
        for (const b of crossings)
          if (a.eel && !b.eel && Math.abs(a.t - b.t) <= eelWindow - 2 * DT)
            expect(Math.abs(a.lane - b.lane)).toBeGreaterThanOrEqual(eelGap - 1e-6);
    }
  });
});

describe('fairness guards', () => {
  it('pulls far non-eel jumps to the midpoint and keeps eels clear of fish, on 200 seeds', () => {
    const { maxJump, eelWindow, eelGap } = DEFAULT_CONFIG.fairness;
    for (const seed of SEEDS) {
      const sim = new Sim({ seed, river });
      let lastLane: number | null = null;
      for (let i = 0; i < 34 / DT && sim.state.status === 'playing'; i++) {
        sim.step(DT, tracker(sim));
        for (const e of sim.drainEvents()) {
          if (e.type !== 'spawn') continue;
          if (e.fish.kind !== 'eel' && lastLane !== null) expect(Math.abs(e.fish.lane - lastLane)).toBeLessThanOrEqual(maxJump + 1e-9);
          lastLane = e.fish.lane;
          for (const other of sim.state.fish) {
            if (other === e.fish || other.status !== 'swimming') continue;
            if ((other.kind === 'eel') === (e.fish.kind === 'eel')) continue;
            const gapSeconds = Math.abs((1 - other.progress) / other.speed - (1 - e.fish.progress) / e.fish.speed);
            if (gapSeconds <= eelWindow) expect(Math.abs(other.lane - e.fish.lane)).toBeGreaterThanOrEqual(eelGap - 1e-6);
          }
        }
      }
    }
  });
});

describe('catching and scoring', () => {
  // No spawns at all: a script whose only phase never reaches its first spawn.
  const quiet: SimConfig = { ...DEFAULT_CONFIG, prefill: [], ramp: { ...DEFAULT_CONFIG.ramp, period: [1e6, 1e6] }, telegraphLead: 1e6 };

  it('catches with a circle test and adds weight and streak', () => {
    const sim = new Sim({ seed: 1, river, config: quiet });
    sim.debugSpawn('bluegill', 0.5, 0.9);
    sim.debugSpawn('koi', 0.52, 0.8);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      sim.step(DT, idle());
      events.push(...sim.drainEvents());
    }
    const catches = events.filter((e) => e.type === 'catch');
    expect(catches).toHaveLength(2);
    expect(sim.state.caught).toBe(6);
    expect(sim.state.streak).toBe(2);
    expect(sim.state.fish).toHaveLength(0);
  });

  it('counts a fish that passes outside the net as escaped and resets the streak', () => {
    const sim = new Sim({ seed: 1, river, config: quiet });
    sim.debugSpawn('bluegill', 0.5, 0.9);
    sim.debugSpawn('koi', 0.95, 0.85);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      sim.step(DT, idle());
      events.push(...sim.drainEvents());
    }
    expect(events.filter((e) => e.type === 'miss')).toHaveLength(1);
    expect(sim.state.escaped).toBe(5);
    expect(sim.state.streak).toBe(0);
    expect(sim.state.bestStreak).toBe(1);
  });

  it('ends the run on one eel, and eels that pass cost nothing', () => {
    const pass = new Sim({ seed: 1, river, config: quiet });
    pass.debugSpawn('eel', 0.95, 0.9);
    for (let i = 0; i < 120; i++) pass.step(DT, idle());
    expect(pass.state.status).toBe('playing');
    expect(pass.state.escaped).toBe(0);

    const hit = new Sim({ seed: 1, river, config: quiet });
    hit.debugSpawn('eel', 0.5, 0.9);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      hit.step(DT, idle());
      events.push(...hit.drainEvents());
    }
    expect(hit.state.status).toBe('lost');
    expect(hit.state.lossCause).toBe('eel');
    expect(events.some((e) => e.type === 'eelCaught')).toBe(true);
  });

  it('reports a near miss when an eel slips just past the net', () => {
    const sim = new Sim({ seed: 1, river, config: quiet });
    const reach = DEFAULT_CONFIG.net.radius + DEFAULT_CONFIG.radii.eel;
    // Lanes span the usable width, which is slightly narrower than a full river-width.
    const laneGap = (reach + 0.02) / (1 - 2 * RIVER.laneMargin) / 1;
    sim.debugSpawn('eel', 0.5 + laneGap * 1.02, 0.9);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      sim.step(DT, idle());
      events.push(...sim.drainEvents());
    }
    expect(sim.state.status).toBe('playing');
    expect(events.some((e) => e.type === 'eelNear')).toBe(true);
  });

  it('loses at 20 lb escaped and wins at 200 lb caught', () => {
    // A net parked at the bank with no eels in the script: only the escape budget can end it,
    // and it ends exactly when the 20th pound slips past.
    const noEels: SimConfig = {
      ...DEFAULT_CONFIG,
      phases: DEFAULT_CONFIG.phases.map((p) => ({ ...p, eelChance: 0, sweepMul: 0, pinned: undefined })),
    };
    for (const seed of SEEDS.slice(0, 20)) {
      const sim = new Sim({ seed, river, config: noEels });
      let before = 0;
      for (let i = 0; i < 200 / DT && sim.state.status === 'playing'; i++) {
        before = sim.state.escaped;
        sim.step(DT, { kind: 'target', lane: sim.state.emitter.lane > 0.5 ? 0 : 1 });
      }
      expect(sim.state.status).toBe('lost');
      expect(sim.state.lossCause).toBe('escaped');
      expect(before).toBeLessThan(20);
      expect(sim.state.escaped).toBeGreaterThanOrEqual(20);
    }

    const win = new Sim({ seed: 1, river, config: { ...quiet, winWeight: 10 } });
    win.debugSpawn('koi', 0.5, 0.9);
    win.debugSpawn('koi', 0.5, 0.8);
    const events: SimEvent[] = [];
    for (let i = 0; i < 120; i++) {
      win.step(DT, idle());
      events.push(...win.drainEvents());
    }
    expect(win.state.status).toBe('won');
    expect(events.some((e) => e.type === 'win')).toBe(true);
  });
});

describe('determinism', () => {
  it('replays identically for the same seed and inputs', () => {
    const a = run(99, 30, tracker);
    const b = run(99, 30, tracker);
    expect(a.sim.state.caught).toBe(b.sim.state.caught);
    expect(a.sim.state.escaped).toBe(b.sim.state.escaped);
    expect(a.events.length).toBe(b.events.length);
    expect(a.events.map((e) => e.type)).toEqual(b.events.map((e) => e.type));
  });

  it('the tracker catches fish in the opening phases on most seeds', () => {
    let caught = 0;
    for (const seed of SEEDS.slice(0, 50)) caught += run(seed, 14, tracker).sim.state.caught;
    expect(caught / 50).toBeGreaterThan(12);
  });
});
