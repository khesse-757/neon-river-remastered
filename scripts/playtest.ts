// Balance playtest: oracle and human-like bots over many seeds, with a pace curve (lb vs time).
//   npm run playtest            (prints a report, writes artifacts/playtest.json)
//   npm run playtest -- --oracle 20 --human 60
import { mkdirSync, writeFileSync } from 'node:fs';
import { RIVER } from '../src/data/river';
import { HumanBot } from '../src/sim/bots/human';
import { oracleIntent } from '../src/sim/bots/oracle';
import { configFor } from '../src/sim/modes';
import type { NetIntent } from '../src/sim/net';
import { River } from '../src/sim/river';
import { Sim } from '../src/sim/sim';

const DT = 1 / 60;
const LIMIT = 360;
const MARKS = [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180];
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};

interface Run {
  seed: number;
  won: boolean;
  time: number;
  cause: string | null;
  stage: string;
  /** Seconds at which each speed-up fired (missing if the run ended first). */
  speedUps: number[];
  /** Longest time without a spawn, and seconds with nothing in the last 35% of the river. */
  maxGap: number;
  emptyZone: number;
  /** Largest lane step between consecutive catchable spawns while sweeping (bank jumps excluded). */
  maxStep: number;
  /** S-runs started, fish in them, and the tightest gap between two spawns. */
  runs: number;
  runFish: number;
  minGap: number;
  caught: number;
  escaped: number;
  bestStreak: number;
  accuracy: number;
  firstCatch: number | null;
  curve: number[];
}

const river = new River(RIVER);
// --mode zen | hard plays that mode's table.
const modeArg = process.argv.indexOf('--mode');
const CONFIG = configFor(modeArg >= 0 ? process.argv[modeArg + 1] : 'normal');
const median = (values: number[]): number => {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? NaN;
};
const quantile = (values: number[], q: number): number => {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? NaN;
};

function play(seed: number, pick: (sim: Sim) => NetIntent): Run {
  const sim = new Sim({ seed, river, config: CONFIG });
  const curve: number[] = [];
  let firstCatch: number | null = null;
  const speedUps: number[] = [];
  let lastSpawn = 0;
  let maxGap = 0;
  let emptyZone = 0;
  let lastLane: number | null = null;
  let maxStep = 0;
  let runs = 0;
  let runFish = 0;
  const gaps: number[] = [];
  while (sim.state.status === 'playing' && sim.state.time < LIMIT) {
    const pinned = sim.state.emitter.pinFish > 0;
    sim.step(DT, pick(sim));
    for (const e of sim.drainEvents()) {
      if (e.type === 'stage' && e.index > 0) speedUps.push(sim.state.time);
      if (e.type === 'run') {
        runs += 1;
        runFish += e.fish;
      }
      if (e.type !== 'spawn') continue;
      gaps.push(sim.state.time - lastSpawn);
      maxGap = Math.max(maxGap, sim.state.time - lastSpawn);
      lastSpawn = sim.state.time;
      if (e.fish.kind === 'eel') continue;
      if (lastLane !== null && !pinned) maxStep = Math.max(maxStep, Math.abs(e.fish.lane - lastLane));
      lastLane = e.fish.lane;
    }
    if (!sim.state.fish.some((f) => f.status === 'swimming' && f.progress >= 0.65 && f.progress <= 1)) emptyZone += DT;
    if (firstCatch === null && sim.state.caught > 0) firstCatch = sim.state.time;
    while (curve.length < MARKS.length && sim.state.time >= (MARKS[curve.length] ?? Infinity)) curve.push(sim.state.caught);
  }
  // A finished run holds its final weight for the rest of the curve.
  while (curve.length < MARKS.length) curve.push(sim.state.status === 'won' ? sim.config.winWeight : sim.state.caught);
  const s = sim.state;
  return {
    seed,
    won: s.status === 'won',
    time: s.time,
    cause: s.lossCause,
    stage: s.stage.id,
    speedUps,
    maxGap,
    emptyZone,
    maxStep,
    runs,
    runFish,
    minGap: Math.min(...gaps.slice(1)),
    caught: s.caught,
    escaped: s.escaped,
    bestStreak: s.bestStreak,
    accuracy: s.catches / Math.max(1, s.catches + s.misses),
    firstCatch,
    curve,
  };
}

function summarize(name: string, runs: Run[]): Record<string, unknown> {
  const wins = runs.filter((r) => r.won);
  const losses = runs.filter((r) => !r.won);
  const byPhase: Record<string, number> = {};
  for (const r of losses) byPhase[r.stage] = (byPhase[r.stage] ?? 0) + 1;
  const summary = {
    bot: name,
    seeds: runs.length,
    winRate: +(wins.length / runs.length).toFixed(3),
    eelLosses: losses.filter((r) => r.cause === 'eel').length,
    escapedLosses: losses.filter((r) => r.cause === 'escaped').length,
    timeouts: losses.filter((r) => r.cause === null).length,
    winTimeMedian: +median(wins.map((r) => r.time)).toFixed(1),
    winTimeP25: +quantile(
      wins.map((r) => r.time),
      0.25,
    ).toFixed(1),
    winTimeP75: +quantile(
      wins.map((r) => r.time),
      0.75,
    ).toFixed(1),
    firstCatchMedian: +median(runs.map((r) => r.firstCatch ?? LIMIT)).toFixed(2),
    bestStreakMedian: median(runs.map((r) => r.bestStreak)),
    accuracyMedian: +median(runs.map((r) => r.accuracy)).toFixed(3),
    escapedMedianInWins: median(wins.map((r) => r.escaped)),
    lossStages: byPhase,
    // Median time of each speed-up, over the runs that reached it.
    speedUpMedians: CONFIG.speedUps
      .map((_, i) => i)
      .map((i) => +median(runs.filter((r) => r.speedUps[i] !== undefined).map((r) => r.speedUps[i] ?? 0)).toFixed(1)),
    maxSpawnGap: +Math.max(...runs.map((r) => r.maxGap)).toFixed(3),
    emptyNetZoneSecondsMedian: +median(runs.map((r) => r.emptyZone)).toFixed(2),
    runsPerNightMedian: median(runs.map((r) => r.runs)),
    runFishMedian: median(runs.map((r) => r.runFish)),
    minSpawnGap: +Math.min(...runs.map((r) => r.minGap)).toFixed(3),
    maxSweepStep: +Math.max(...runs.map((r) => r.maxStep)).toFixed(3),
    // Median lb caught at each time mark, over all runs (wins hold at 200).
    paceCurve: Object.fromEntries(MARKS.map((t, i) => [t, median(runs.map((r) => r.curve[i] ?? 0))])),
    paceCurveWinners: Object.fromEntries(MARKS.map((t, i) => [t, median(wins.map((r) => r.curve[i] ?? 0))])),
  };
  return summary;
}

const oracleSeeds = arg('oracle', 20);
const humanSeeds = arg('human', 60);
const oracle = summarize(
  'oracle',
  Array.from({ length: oracleSeeds }, (_, i) => play(i + 1, (sim) => oracleIntent(sim.state, sim.config))),
);
const human = summarize(
  'human-like (220 ms, aim noise 0.03)',
  Array.from({ length: humanSeeds }, (_, i) => {
    const bot = new HumanBot(i + 1);
    return play(i + 1, (sim) => bot.intent(sim.state, sim.config));
  }),
);

mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/playtest.json', JSON.stringify({ oracle, human }, null, 2) + '\n');
for (const s of [oracle, human]) {
  console.log(`\n== ${String(s.bot)} (${String(s.seeds)} seeds) ==`);
  console.log(JSON.stringify(s, null, 1));
}
