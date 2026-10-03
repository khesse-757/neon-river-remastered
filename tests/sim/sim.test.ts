import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { RIVER } from '../../src/data/river';
import { HumanBot } from '../../src/sim/bots/human';
import { oracleIntent } from '../../src/sim/bots/oracle';
import { trackerIntent } from '../../src/sim/bots/tracker';
import { DEFAULT_CONFIG, type SimConfig } from '../../src/sim/config';
import { configFor, MODES } from '../../src/sim/modes';
import { createNet, stepNet, type NetIntent } from '../../src/sim/net';
import { River } from '../../src/sim/river';
import { createRng } from '../../src/sim/rng';
import { EEL_MARGIN, Sim, type SimEvent } from '../../src/sim/sim';

/** Whole-night, many-seed tests. `npm run test:quick` (CI) skips them; `npm run test` and the pre-commit hook run them. */
const slow = process.env.QUICK ? it.skip : it;

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
/** A night nobody can end: no escape limit, and a net too small to touch anything from the bank (lane 0). */
const ENDLESS: SimConfig = { ...DEFAULT_CONFIG, maxEscaped: 1e9, net: { ...DEFAULT_CONFIG.net, radius: 0.001 } };
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

describe('stages and emitter', () => {
  slow('opens straight into play with fish already in the river, and never pauses the spawns', () => {
    const { stages, spacing, fairness } = DEFAULT_CONFIG;
    // The longest wait the pattern allows anywhere: the slowest stage's period at the top of its wander.
    const longest = Math.max(stages[0]!.period * spacing[1], fairness.eelWindow + EEL_MARGIN);
    for (const seed of SEEDS.slice(0, 12)) {
      const sim = new Sim({ seed, river });
      expect(sim.state.fish.length).toBeGreaterThanOrEqual(2);
      expect(sim.drainEvents()[0]?.type).toBe('stage');
      let firstArrival = Infinity;
      let lastSpawn = 0;
      let emptyZone = 0;
      while (sim.state.status === 'playing' && sim.state.time < 200) {
        const stage = sim.state.stage;
        sim.step(DT, oracleIntent(sim.state, sim.config));
        for (const e of sim.drainEvents()) {
          if ((e.type === 'catch' || e.type === 'miss') && firstArrival === Infinity) firstArrival = sim.state.time;
          if (e.type !== 'spawn') continue;
          const gap = sim.state.time - lastSpawn;
          // No rests and no skipped spawns: never longer than the pattern's own longest wait, and
          // within a stage never longer than that stage's (one period of slack across a speed-up).
          expect(gap, `seed ${seed} t=${sim.state.time.toFixed(2)}`).toBeLessThanOrEqual(longest + 2 * DT);
          if (sim.state.stage === stage && sim.state.time - gap > (DEFAULT_CONFIG.speedUps[sim.state.stageIndex - 1]?.seconds ?? 0))
            expect(gap).toBeLessThanOrEqual(
              Math.max(stages[Math.max(0, sim.state.stageIndex - 1)]!.period * spacing[1], fairness.eelWindow + EEL_MARGIN) + 2 * DT,
            );
          lastSpawn = sim.state.time;
        }
        if (!sim.state.fish.some((f) => f.status === 'swimming' && f.progress >= 0.5 && f.progress <= 1)) emptyZone += DT;
      }
      // The first fish reaches the net within about two seconds, and one is almost always on its way.
      expect(firstArrival).toBeLessThan(2.1);
      expect(emptyZone).toBeLessThan(1);
    }
  });

  it('speeds up three distinct times, on weight caught or on the clock, without pausing', () => {
    const { stages, speedUps } = DEFAULT_CONFIG;
    expect(stages).toHaveLength(4);
    expect(speedUps.map((u) => [u.weight, u.seconds])).toEqual([
      [45, 35],
      [97, 65],
      [148, 95],
    ]);
    // Each speed-up is about +12% fish speed, with denser spawns, a faster sweep and tighter S-runs.
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i]!.speed / stages[i - 1]!.speed).toBeCloseTo(1.12, 2);
      expect(stages[i]!.period).toBeLessThan(stages[i - 1]!.period);
      expect(stages[i]!.crossing).toBeLessThan(stages[i - 1]!.crossing);
      expect(stages[i]!.reversals).toBeGreaterThan(stages[i - 1]!.reversals);
      expect(stages[i]!.run.period[1]).toBeLessThan(stages[i - 1]!.run.period[1]);
      expect(stages[i]!.run.crossing).toBeLessThan(stages[i - 1]!.run.crossing);
    }
    for (const stage of stages) {
      // A run is denser than the water around it and tightens as it goes.
      expect(stage.run.period[0]).toBeLessThan(stage.period * 0.75);
      expect(stage.run.period[1]).toBeLessThan(stage.run.period[0]);
    }

    // On weight: a good player triggers them early.
    const good = new Sim({ seed: 5, river });
    good.drainEvents();
    const byWeight: { t: number; caught: number; index: number }[] = [];
    while (good.state.status === 'playing' && good.state.time < 200) {
      good.step(DT, oracleIntent(good.state, good.config));
      for (const e of good.drainEvents())
        if (e.type === 'stage') byWeight.push({ t: good.state.time, caught: good.state.caught, index: e.index });
    }
    expect(byWeight.map((m) => m.index)).toEqual([1, 2, 3]);
    byWeight.forEach((m, i) => {
      expect(m.caught).toBeGreaterThanOrEqual(speedUps[i]!.weight);
      expect(m.caught).toBeLessThan(speedUps[i]!.weight + 6);
      expect(m.t).toBeLessThan(speedUps[i]!.seconds);
    });
    expect(good.state.stage.id).toBe('bank-to-bank');

    // On the clock: an idle net still gets the speed-ups at 0:35, 1:05 and 1:35.
    const idleSim = new Sim({ seed: 5, river, config: ENDLESS });
    idleSim.drainEvents();
    const byClock: number[] = [];
    while (idleSim.state.time < 115) {
      idleSim.step(DT, { kind: 'target', lane: 0 });
      for (const e of idleSim.drainEvents()) if (e.type === 'stage') byClock.push(idleSim.state.time);
    }
    expect(byClock).toHaveLength(3);
    byClock.forEach((t, i) => expect(t).toBeCloseTo(speedUps[i]!.seconds, 1));
    // The current has picked the new speed up: fish cross the river in the stage's travel time.
    expect(idleSim.pace().travel).toBeCloseTo(DEFAULT_CONFIG.travel / stages[3]!.speed, 2);
  });

  it('brings an S-run with every speed-up: a tight chain that tightens while the current picks up', () => {
    let runs = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      const sim = new Sim({ seed, river, config: ENDLESS });
      sim.drainEvents();
      let speedUpAt = -Infinity;
      let runAt = -Infinity;
      let gaps: number[] = [];
      let lastSpawn = 0;
      let wasInRun = false;
      const close = (): void => {
        if (gaps.length < 4) return;
        runs++;
        // The chain tightens: its last gap is shorter than its first (gaps held open around an eel aside).
        const plain = gaps.filter((g) => g < DEFAULT_CONFIG.fairness.eelWindow);
        if (plain.length >= 4) expect(Math.min(...plain.slice(1))).toBeLessThan(plain[0]! - DT / 2);
        gaps = [];
      };
      while (sim.state.time < 100) {
        const speedBefore = sim.state.speed;
        sim.step(DT, { kind: 'target', lane: 0 });
        const { emitter, stage } = sim.state;
        for (const e of sim.drainEvents()) {
          if (e.type === 'stage') speedUpAt = sim.state.time;
          if (e.type === 'run') {
            runAt = sim.state.time;
            expect(e.fish).toBeGreaterThanOrEqual(stage.run.fish[0]);
            // (+4: a speed-up that fires while a run is coming down lengthens it.)
            expect(e.fish).toBeLessThanOrEqual(stage.run.fish[1] + 4);
            // The speed-up's run arrives within a couple of spawns, while the current is still picking up.
            if (sim.state.time - speedUpAt < 4) expect(sim.state.speed).toBeLessThan(stage.speed - 0.02);
          }
          if (e.type !== 'spawn') continue;
          if (emitter.inRun) {
            // Inside a run: no koi, and every fish closer in time than anything outside one.
            expect(e.fish.kind).not.toBe('koi');
            if (wasInRun) {
              const gap = sim.state.time - lastSpawn;
              gaps.push(gap);
              if (e.fish.kind !== 'eel')
                expect(gap).toBeLessThanOrEqual(Math.max(stage.run.period[0], DEFAULT_CONFIG.fairness.eelWindow + EEL_MARGIN) + 2 * DT);
            }
          } else close();
          wasInRun = emitter.inRun;
          lastSpawn = sim.state.time;
        }
        // The current never jumps: it glides to each stage's speed.
        expect(sim.state.speed - speedBefore).toBeLessThan(0.004);
        if (speedUpAt > 0 && sim.state.time - speedUpAt > 4 && sim.state.time - speedUpAt < 4 + DT)
          // (A run already coming down when the speed-up fires is lengthened instead.)
          expect(runAt).toBeGreaterThan(speedUpAt - 5);
      }
    }
    // Runs also recur between speed-ups.
    expect(runs / 20).toBeGreaterThan(4);
  });

  it('never spaces the stream evenly: gaps wander outside runs and tighten inside them', () => {
    const sim = new Sim({ seed: 21, river, config: ENDLESS });
    sim.drainEvents();
    const outside: number[] = [];
    const inside: number[] = [];
    let lastSpawn = 0;
    let wasInRun = false;
    while (sim.state.time < 34) {
      sim.step(DT, { kind: 'target', lane: 0 });
      for (const e of sim.drainEvents()) {
        if (e.type !== 'spawn') continue;
        const inRun = sim.state.emitter.inRun;
        if (inRun && wasInRun) inside.push(sim.state.time - lastSpawn);
        else if (!inRun && !wasInRun) outside.push(sim.state.time - lastSpawn);
        wasInRun = inRun;
        lastSpawn = sim.state.time;
      }
    }
    const [lo, hi] = DEFAULT_CONFIG.spacing;
    const period = DEFAULT_CONFIG.stages[0]!.period;
    expect(outside.length).toBeGreaterThan(10);
    expect(inside.length).toBeGreaterThan(6);
    expect(Math.min(...outside)).toBeGreaterThanOrEqual(Math.min(period * lo, DEFAULT_CONFIG.fairness.eelWindow) - 2 * DT);
    expect(Math.max(...outside)).toBeLessThanOrEqual(period * hi + 2 * DT);
    // A real spread, not one repeated value.
    expect(Math.max(...outside) - Math.min(...outside)).toBeGreaterThan(period * 0.3);
    const mid = (v: number[]): number => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
    expect(mid(inside)).toBeLessThan(mid(outside) * 0.75);
  });

  it('sweeps Still Water as a smooth sine: bank to bank, no jitter, no reversals', () => {
    const [lo, hi] = DEFAULT_CONFIG.banks;
    const stage = DEFAULT_CONFIG.stages[0]!;
    for (const seed of SEEDS.slice(0, 20)) {
      const sim = new Sim({ seed, river, config: { ...ENDLESS, speedUps: [] } });
      const lanes: number[] = [];
      const runEnded: boolean[] = [];
      for (let i = 0; i < 24 / DT; i++) {
        const inRun = sim.state.emitter.inRun;
        sim.step(DT, { kind: 'target', lane: 0 });
        lanes.push(sim.state.emitter.lane);
        runEnded.push(inRun && !sim.state.emitter.inRun);
      }
      // Velocity never jumps (eased), and peaks at the sine's peak speed (an S-run's is the fastest).
      const peak = ((Math.PI / 2) * (hi - lo)) / Math.min(stage.crossing, stage.run.crossing * 0.7);
      let turns = 0;
      let heading = 0;
      for (let i = 2; i < lanes.length; i++) {
        const v0 = (lanes[i - 1]! - lanes[i - 2]!) / DT;
        const v1 = (lanes[i]! - lanes[i - 1]!) / DT;
        expect(Math.abs(v1)).toBeLessThanOrEqual(peak + 1e-6);
        // (The one allowed change of pace: easing off as an S-run ends.)
        if (!runEnded[i] && !runEnded[i - 1]) expect(Math.abs(v1 - v0)).toBeLessThan(0.03);
        if (Math.abs(v1) < 1e-9) continue;
        if (heading !== 0 && Math.sign(v1) !== heading) {
          turns++;
          // It only ever turns at a bank.
          expect(Math.min(Math.abs(lanes[i]! - lo), Math.abs(lanes[i]! - hi))).toBeLessThan(0.01);
        }
        heading = Math.sign(v1);
      }
      expect(turns).toBeGreaterThanOrEqual(5);
      expect(Math.min(...lanes)).toBeCloseTo(lo, 2);
      expect(Math.max(...lanes)).toBeCloseTo(hi, 2);
    }
  });

  slow('draws the chain as a curve: every fish spawns on the emitter, and consecutive fish are close', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const sim = new Sim({ seed, river });
      sim.drainEvents();
      let last: number | null = null;
      let reversals = 0;
      let steps = 0;
      let lastDir = 0;
      while (sim.state.status === 'playing' && sim.state.stageIndex === 0 && sim.state.time < 34) {
        sim.step(DT, oracleIntent(sim.state, sim.config));
        for (const e of sim.drainEvents()) {
          if (e.type !== 'spawn') continue;
          // No relocation: the fish is exactly where the emitter is.
          expect(e.fish.lane).toBeCloseTo(sim.state.emitter.lane, 9);
          if (last !== null) {
            const d = e.fish.lane - last;
            expect(Math.abs(d)).toBeLessThan(0.62);
            // In an S-run the fish are a short step apart.
            if (sim.state.emitter.inRun && sim.state.emitter.runK > 0) expect(Math.abs(d)).toBeLessThan(0.3);
            if (lastDir !== 0 && Math.sign(d) !== lastDir) reversals++;
            if (d !== 0) lastDir = Math.sign(d);
            steps++;
          }
          last = e.fish.lane;
        }
      }
      // The old director reversed on about two of every three spawns; a sine turns once per crossing.
      expect(reversals / steps).toBeLessThan(0.3);
    }
  });

  it('keeps Still Water mostly 1-lb fish with koi near 8% and eels rare and well spaced', () => {
    const count = { bluegill: 0, koi: 0, eel: 0 };
    let inRuns = 0;
    for (const seed of SEEDS) {
      const sim = new Sim({ seed, river, config: { ...ENDLESS, speedUps: [] } });
      sim.drainEvents();
      let sinceEel = 99;
      for (let i = 0; i < 40 / DT; i++) {
        sim.step(DT, { kind: 'target', lane: 0 });
        for (const e of sim.drainEvents()) {
          if (e.type !== 'spawn') continue;
          if (e.fish.kind === 'eel') {
            expect(sinceEel).toBeGreaterThanOrEqual(DEFAULT_CONFIG.stages[0]!.eelSpacing);
            sinceEel = 0;
          } else sinceEel++;
          // An S-run in Still Water is all 1-lb fish; the mix is what flows between runs.
          if (sim.state.emitter.inRun) {
            expect(e.fish.kind).toBe('bluegill');
            inRuns++;
          } else count[e.fish.kind]++;
        }
      }
    }
    const total = count.bluegill + count.koi + count.eel;
    expect(inRuns).toBeGreaterThan(total * 0.2);
    expect(count.koi / total).toBeGreaterThan(0.06);
    expect(count.koi / total).toBeLessThan(0.1);
    expect(count.eel / total).toBeGreaterThan(0.03);
    expect(count.eel / total).toBeLessThan(0.07);
  });

  it('swaps banks in Bank to Bank: bursts pinned at one bank, then immediately the other', () => {
    const [lo, hi] = DEFAULT_CONFIG.banks;
    let swaps = 0;
    let others = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      const sim = new Sim({ seed, river, startStage: 3, config: ENDLESS });
      expect(sim.state.stage.id).toBe('bank-to-bank');
      sim.drainEvents();
      let last: number | null = null;
      for (let i = 0; i < 40 / DT; i++) {
        sim.step(DT, { kind: 'target', lane: 0 });
        for (const e of sim.drainEvents()) {
          if (e.type !== 'spawn') continue;
          const lane = e.fish.lane;
          // A clean swap: one spawn exactly at one bank, the next exactly at the other.
          const atBanks = last !== null && Math.abs(Math.min(lane, last) - lo) < 1e-6 && Math.abs(Math.max(lane, last) - hi) < 1e-6;
          if (atBanks) swaps++;
          else others++;
          last = lane;
        }
      }
    }
    expect(swaps).toBeGreaterThan(60);
    expect(others).toBeGreaterThan(swaps);
  });

  slow('has a Zen mode that cannot be lost: eels become fish, escapes cost nothing, and a win can carry on', () => {
    expect(MODES.map((m) => m.id)).toEqual(['zen', 'normal', 'hard']);
    expect(new Set(MODES.map((m) => m.id)).size).toBe(MODES.length);
    expect(configFor('normal')).toBe(DEFAULT_CONFIG);
    expect(configFor('nonsense')).toBe(DEFAULT_CONFIG);
    const zen = configFor('zen');
    expect(zen.eels).toBe(false);
    // A net that catches nothing never loses the night.
    const { sim: idleSim, events: idleEvents } = run(3, 60, idle, zen);
    expect(idleSim.state.status).toBe('playing');
    expect(idleSim.state.escaped).toBeGreaterThan(20);
    expect(idleEvents.some((e) => e.type === 'lose' || e.type === 'telegraph')).toBe(false);
    for (const seed of SEEDS.slice(0, 8)) {
      const sim = new Sim({ seed, river, config: zen });
      sim.drainEvents();
      const bot = new HumanBot(seed);
      let lastSpawn = 0;
      let longest = 0;
      while (sim.state.status === 'playing' && sim.state.time < 300) {
        sim.step(DT, bot.intent(sim.state, sim.config));
        for (const e of sim.drainEvents()) {
          expect(e.type).not.toBe('telegraph');
          if (e.type !== 'spawn') continue;
          expect(e.fish.kind).not.toBe('eel');
          longest = Math.max(longest, sim.state.time - lastSpawn);
          lastSpawn = sim.state.time;
        }
      }
      expect(sim.state.status).toBe('won');
      expect(sim.state.stageIndex).toBe(3);
      // An eel's place is filled with a fish, never left as a gap.
      expect(longest).toBeLessThan(DEFAULT_CONFIG.stages[0]!.period * DEFAULT_CONFIG.spacing[1] + 0.1);
      // Keep fishing: the same river carries on, and there is no second win.
      sim.keepFishing();
      expect(sim.state.status).toBe('playing');
      const events: SimEvent[] = [];
      for (let i = 0; i < 20 / DT; i++) {
        sim.step(DT, bot.intent(sim.state, sim.config));
        events.push(...sim.drainEvents());
      }
      expect(sim.state.status).toBe('playing');
      expect(sim.state.caught).toBeGreaterThan(zen.winWeight + 5);
      expect(events.some((e) => e.type === 'win' || e.type === 'lose')).toBe(false);
    }
  });

  slow('has a Storm Night: five stages from the first speed-up pace, more eels, a 15-lb budget, still winnable', () => {
    const hard = configFor('hard');
    expect(hard.stages.length).toBe(5);
    expect(hard.speedUps.length).toBe(4);
    expect(hard.maxEscaped).toBe(15);
    expect(hard.stages[0]!.speed).toBe(DEFAULT_CONFIG.stages[1]!.speed);
    for (let i = 0; i < 3; i++) {
      expect(hard.stages[i]!.eelChance).toBeGreaterThan(DEFAULT_CONFIG.stages[i + 1]!.eelChance * 1.25);
      expect(hard.stages[i]!.run.eelChance).toBeGreaterThan(0);
    }
    for (let i = 1; i < 5; i++) expect(hard.stages[i]!.speed).toBeGreaterThan(hard.stages[i - 1]!.speed);
    for (const seed of SEEDS.slice(0, 10)) {
      const { sim } = run(seed, 300, (s) => oracleIntent(s.state, s.config), hard);
      expect(sim.state.status, `seed ${seed}`).toBe('won');
      expect(sim.state.stageIndex).toBe(4);
    }
  });

  slow('spawns every fish exactly on the emitter in every stage, and keeps S-runs apart', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const sim = new Sim({ seed, river });
      sim.drainEvents();
      let lastRun = -Infinity;
      while (sim.state.status === 'playing' && sim.state.time < 200) {
        sim.step(DT, oracleIntent(sim.state, sim.config));
        for (const e of sim.drainEvents()) {
          // Nothing is moved, clamped or relocated at the shipped pace, bursts and run starts included.
          // (After a burst's last fish the emitter has already jumped to the other bank.)
          if (e.type === 'spawn') {
            const [lo, hi] = DEFAULT_CONFIG.banks;
            const { lane } = sim.state.emitter;
            const swapped = Math.abs(e.fish.lane + lane - (lo + hi)) < 1e-9 && Math.abs(Math.abs(e.fish.lane - lane) - (hi - lo)) < 1e-9;
            if (!swapped) expect(e.fish.lane, `seed ${seed} t=${sim.state.time.toFixed(1)}`).toBeCloseTo(lane, 9);
          }
          if (e.type !== 'run') continue;
          // A run never starts on the tail of another: a speed-up lengthens the one under way.
          expect(sim.state.time - lastRun, `seed ${seed}`).toBeGreaterThan(4);
          expect(e.fish).toBeLessThanOrEqual(sim.state.stage.run.fish[1] + 4);
          lastRun = sim.state.time;
        }
      }
    }
  });

  slow('keeps the emitter and every spawn inside the river on 200 seeds', () => {
    for (const seed of SEEDS) {
      const sim = new Sim({ seed, river, startStage: seed % 4 });
      for (let i = 0; i < 20 / DT && sim.state.status === 'playing'; i++) {
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

  it('holds lanes: a swimming fish never drifts or jumps sideways', () => {
    for (const startStage of [0, 3]) {
      const sim = new Sim({ seed: 3, river, startStage, config: ENDLESS });
      const lanes = new Map<number, number>();
      for (let i = 0; i < 20 / DT; i++) {
        sim.step(DT, { kind: 'target', lane: 0 });
        for (const f of sim.state.fish) {
          if (f.status !== 'swimming') continue;
          if (!lanes.has(f.id)) lanes.set(f.id, f.lane);
          expect(f.lane).toBe(lanes.get(f.id));
        }
        if (sim.state.status !== 'playing') break;
      }
      expect(lanes.size).toBeGreaterThan(10);
    }
  });

  it('keeps the chain evenly spaced through a speed-up: one current carries every fish', () => {
    const sim = new Sim({ seed: 9, river, config: ENDLESS });
    for (let i = 0; i < 37 / DT; i++) {
      sim.step(DT, { kind: 'target', lane: 0 });
      const swimming = sim.state.fish.filter((f) => f.status === 'swimming');
      const speeds = new Set(swimming.map((f) => f.speed));
      expect(speeds.size).toBeLessThanOrEqual(1);
      // Nobody overtakes: progress order is spawn order.
      for (let k = 1; k < swimming.length; k++) expect(swimming[k]!.progress).toBeLessThan(swimming[k - 1]!.progress);
    }
    expect(sim.state.stageIndex).toBe(1);
  });

  it('telegraphs every eel before it appears, and calls a warning off if the eel will not come', () => {
    let eels = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      // Doubled density makes the eel-window guard bite, so some warned eels become fish.
      const config: SimConfig = seed % 2 ? ENDLESS : { ...ENDLESS, tune: { ...ENDLESS.tune, density: 2.2 } };
      const sim = new Sim({ seed, river, startStage: 2, config });
      sim.drainEvents();
      let pending = 0;
      for (let i = 0; i < 30 / DT && sim.state.status === 'playing'; i++) {
        sim.step(DT, { kind: 'target', lane: 0 });
        for (const e of sim.drainEvents()) {
          if (e.type === 'telegraph') pending++;
          if (e.type === 'telegraphCancel') pending--;
          if (e.type === 'spawn' && e.fish.kind === 'eel') {
            eels++;
            expect(pending).toBeGreaterThan(0);
            pending--;
          }
        }
        // Never more open warnings than the two spawns rolled ahead.
        expect(pending).toBeGreaterThanOrEqual(0);
        expect(pending).toBeLessThanOrEqual(2);
      }
    }
    expect(eels).toBeGreaterThan(100);
  });
});

describe('eel warnings and spacing at the net', () => {
  it('never has an eel and a fish cross the rail close together in both time and lane', () => {
    // Measured where it matters: actual rail-crossing times and lanes, not spawn-time estimates.
    const { eelWindow, eelGap } = DEFAULT_CONFIG.fairness;
    for (const seed of SEEDS) {
      const sim = new Sim({ seed, river, startStage: seed % 4, config: { ...DEFAULT_CONFIG, maxEscaped: 1e9 } });
      const crossings: { t: number; lane: number; eel: boolean }[] = [];
      const seen = new Set<number>();
      for (let i = 0; i < 24 / DT; i++) {
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

describe('catching and scoring', () => {
  // No spawns at all: a script whose only phase never reaches its first spawn.
  const quiet: SimConfig = {
    ...DEFAULT_CONFIG,
    prefillSeconds: 0,
    speedUps: [],
    stages: DEFAULT_CONFIG.stages.map((st) => ({ ...st, period: 1e6 })),
    telegraphLead: -1,
  };

  it('catches with a circle test and adds weight and streak', () => {
    const sim = new Sim({ seed: 1, river, config: quiet, empty: true });
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
    const sim = new Sim({ seed: 1, river, config: quiet, empty: true });
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
    const pass = new Sim({ seed: 1, river, config: quiet, empty: true });
    pass.debugSpawn('eel', 0.95, 0.9);
    for (let i = 0; i < 120; i++) pass.step(DT, idle());
    expect(pass.state.status).toBe('playing');
    expect(pass.state.escaped).toBe(0);

    const hit = new Sim({ seed: 1, river, config: quiet, empty: true });
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
    const sim = new Sim({ seed: 1, river, config: quiet, empty: true });
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
    // A net parked at the bank with no eels in the night: only the escape budget can end it,
    // and it ends exactly when the 20th pound slips past.
    const noEels: SimConfig = {
      ...DEFAULT_CONFIG,
      stages: DEFAULT_CONFIG.stages.map((st) => ({ ...st, eelChance: 0 })),
      // A net too small to reach the sweep from where it is parked, hard against the bank.
      net: { ...DEFAULT_CONFIG.net, radius: 0.001 },
    };
    for (const seed of SEEDS.slice(0, 20)) {
      const sim = new Sim({ seed, river, config: noEels });
      let before = 0;
      for (let i = 0; i < 200 / DT && sim.state.status === 'playing'; i++) {
        before = sim.state.escaped;
        sim.step(DT, { kind: 'target', lane: 1 });
      }
      expect(sim.state.status).toBe('lost');
      expect(sim.state.lossCause).toBe('escaped');
      expect(before).toBeLessThan(20);
      expect(sim.state.escaped).toBeGreaterThanOrEqual(20);
    }

    const win = new Sim({ seed: 1, river, config: { ...quiet, winWeight: 10 }, empty: true });
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

  it('the tracker catches fish in the opening stage on most seeds', () => {
    let caught = 0;
    for (const seed of SEEDS.slice(0, 50)) caught += run(seed, 14, tracker).sim.state.caught;
    expect(caught / 50).toBeGreaterThan(10);
  });
});

describe('the whole night', () => {
  const oracle = (sim: Sim): NetIntent => oracleIntent(sim.state, sim.config);
  const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? NaN;

  slow('is winnable on every seed by a planner with the real net, without touching an eel', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const { sim } = run(seed, 300, oracle);
      expect(sim.state.status, `seed ${seed}`).toBe('won');
      expect(sim.state.escaped).toBeLessThan(DEFAULT_CONFIG.maxEscaped);
    }
  });

  slow('keeps the full eel warning in Bank to Bank, where the pace is fastest', () => {
    let lateEels = 0;
    for (const seed of SEEDS.slice(0, 24)) {
      const sim = new Sim({ seed, river });
      const warned: number[] = [];
      while (sim.state.status === 'playing' && sim.state.time < 170) {
        sim.step(DT, oracle(sim));
        for (const e of sim.drainEvents()) {
          if (e.type === 'telegraph') warned.push(sim.state.time);
          if (e.type === 'telegraphCancel') warned.shift();
          if (e.type !== 'spawn' || e.fish.kind !== 'eel') continue;
          if (sim.state.stageIndex === 3) lateEels++;
          // Its warning came a full lead earlier, even when fish spawn faster than the lead.
          const at = warned.shift();
          expect(at, `seed ${seed} t=${sim.state.time.toFixed(2)}`).toBeDefined();
          expect(sim.state.time - (at ?? 0)).toBeGreaterThanOrEqual(DEFAULT_CONFIG.telegraphLead - 2 * DT - 1e-6);
        }
      }
    }
    expect(lateEels).toBeGreaterThan(200);
  });

  slow('holds the pace for a human-like player: speed-ups near 0:30, 1:00 and 1:30, a win in 2:00-2:30', () => {
    const ups: number[][] = [[], [], []];
    const wins: number[] = [];
    const N = 40;
    for (const seed of SEEDS.slice(0, N)) {
      const sim = new Sim({ seed, river });
      sim.drainEvents();
      const bot = new HumanBot(seed);
      while (sim.state.status === 'playing' && sim.state.time < 300) {
        sim.step(DT, bot.intent(sim.state, sim.config));
        for (const e of sim.drainEvents()) if (e.type === 'stage') ups[e.index - 1]?.push(sim.state.time);
      }
      if (sim.state.status === 'won') wins.push(sim.state.time);
    }
    expect(median(ups[0]!)).toBeGreaterThan(24);
    expect(median(ups[0]!)).toBeLessThanOrEqual(35);
    expect(median(ups[1]!)).toBeGreaterThan(52);
    expect(median(ups[1]!)).toBeLessThanOrEqual(65);
    expect(median(ups[2]!)).toBeGreaterThan(80);
    expect(median(ups[2]!)).toBeLessThanOrEqual(95);
    // A solid player wins in about 2:00-2:30, and the night is neither a formality nor a wall.
    expect(median(wins)).toBeGreaterThanOrEqual(120);
    expect(median(wins)).toBeLessThanOrEqual(150);
    expect(wins.length / N).toBeGreaterThan(0.3);
    expect(wins.length / N).toBeLessThan(0.8);
  });

  it('applies the tune multipliers to the running pace', () => {
    const sim = new Sim({ seed: 1, river });
    sim.config = { ...sim.config, tune: { speed: 2, density: 2, sweep: 0.5, eel: 0 } };
    // The current glides to the new speed rather than snapping.
    for (let i = 0; i < 22 / DT; i++) sim.step(DT, oracle(sim));
    sim.drainEvents();
    const tuned = sim.pace();
    // (A speed-up may have come in the meantime: measure against the stage the night is in.)
    expect(tuned.travel).toBeCloseTo(DEFAULT_CONFIG.travel / (sim.state.stage.speed * 2), 1);
    expect(tuned.period).toBeCloseTo(sim.state.stage.period / 2, 6);
    expect(tuned.crossing).toBeCloseTo(sim.state.stage.crossing * 2, 6);
    expect(tuned.eelChance).toBe(0);
    for (let i = 0; i < 20 / DT && sim.state.status === 'playing'; i++) {
      sim.step(DT, oracle(sim));
      for (const e of sim.drainEvents()) if (e.type === 'spawn') expect(e.fish.kind).not.toBe('eel');
    }
  });
});
