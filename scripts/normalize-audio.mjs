#!/usr/bin/env node
// Loudness-normalizes every audio source in assets-src/audio into public/audio (needs ffmpeg).
//   node scripts/normalize-audio.mjs
// Loops are normalized to an integrated loudness (LUFS); one-shots to a peak level (dBFS).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SRC = 'assets-src/audio';
const JOBS = [
  // Trimmed to exactly 64 beats at 80 BPM so the loop point sits on the bar line.
  // 20 ms edge fades remove the click at the loop point (measured wrap jump was 4x a normal sample step).
  {
    in: `${SRC}/music-calm-raw.mp3`,
    out: 'public/audio/music/calm-loop.mp3',
    lufs: -16,
    // Drop the encoder's leading silence so beat one sits at t = 0.
    skip: 0.0265,
    trim: 48,
    edge: 'afade=t=in:d=0.02,afade=t=out:st=47.98:d=0.02',
  },
  { in: `${SRC}/ambience-night-river-raw.mp3`, out: 'public/audio/ambience/night-river-loop.mp3', lufs: -24 },
  { in: `${SRC}/catch-splash-1-raw.mp3`, out: 'public/audio/sfx/catch-splash-1.mp3', peak: -3 },
  { in: `${SRC}/catch-splash-2-raw.mp3`, out: 'public/audio/sfx/catch-splash-2.mp3', peak: -3 },
  { in: `${SRC}/koto-pluck-raw.mp3`, out: 'public/audio/sfx/koto-pluck.mp3', peak: -3 },
  { in: `${SRC}/chime-raw.mp3`, out: 'public/audio/sfx/chime.mp3', peak: -6 },
  { in: 'assets-src/original/water_net.wav', out: 'public/audio/sfx/net.mp3', peak: -3 },
  // Weather (Gate 2): two rain layers that crossfade with the night, and three thunder rolls.
  { in: `${SRC}/rain-light-raw.mp3`, out: 'public/audio/ambience/rain-light-loop.mp3', lufs: -29 },
  { in: `${SRC}/rain-heavy-raw.mp3`, out: 'public/audio/ambience/rain-heavy-loop.mp3', lufs: -25 },
  { in: `${SRC}/thunder-1-raw.mp3`, out: 'public/audio/sfx/thunder-1.mp3', peak: -4 },
  { in: `${SRC}/thunder-2-raw.mp3`, out: 'public/audio/sfx/thunder-2.mp3', peak: -4 },
  { in: `${SRC}/thunder-3-raw.mp3`, out: 'public/audio/sfx/thunder-3.mp3', peak: -4 },
];

const analyse = (file, filter) => {
  const r = execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${file}" -af "${filter}" -f null - 2>&1`], { encoding: 'utf8' });
  return r;
};

for (const job of JOBS) {
  mkdirSync(dirname(job.out), { recursive: true });
  const seek = job.skip ? ['-ss', String(job.skip)] : [];
  const pre = job.trim ? ['-t', String(job.trim)] : [];
  let filter;
  let note;
  if (job.lufs !== undefined) {
    const log = analyse(job.in, 'ebur128=peak=true');
    const measured = Number(/I:\s+(-?[\d.]+) LUFS/g.exec(log.slice(log.lastIndexOf('Summary')))?.[1]);
    const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(log.slice(log.lastIndexOf('Summary')))?.[1]);
    // A plain gain keeps the loop sample-exact (two-pass loudnorm resamples and pads); cap at -1 dBTP.
    const gain = Math.min(job.lufs - measured, -1 - peak);
    filter = `volume=${gain.toFixed(2)}dB`;
    note = `${measured} LUFS, peak ${peak} dBFS -> gain ${gain.toFixed(2)} dB (target ${job.lufs} LUFS)`;
  } else {
    const log = analyse(job.in, 'volumedetect');
    const peak = Number(/max_volume: (-?[\d.]+) dB/.exec(log)?.[1]);
    const gain = job.peak - peak;
    filter = `volume=${gain.toFixed(2)}dB`;
    note = `peak ${peak} dBFS -> gain ${gain.toFixed(2)} dB (target ${job.peak} dBFS)`;
  }
  if (job.edge) filter += `,${job.edge}`;
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    ...seek,
    '-i',
    job.in,
    ...pre,
    '-af',
    filter,
    '-ac',
    '2',
    '-ar',
    '44100',
    '-b:a',
    '128k',
    job.out,
  ]);
  console.log(`${job.out}: ${note}`);
}
