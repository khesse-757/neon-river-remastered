/**
 * The catch melody and the game's leitmotif. Each candidate theme is built on one short motif
 * (3-5 notes with a strong rhythm) that is repeated, answered and varied across a 32-step catch
 * sequence, and quoted by the start sting, the phase stinger, the win fanfare and the loss phrase.
 * All original; all in D hirajoshi, the key of the music loop (80 BPM).
 */

/** D hirajoshi: D E F A Bb. Degree 0 is D4; degrees run up and down through the octaves. */
const SCALE_SEMITONES = [0, 2, 3, 7, 8];
const D4 = 293.66;

export function degreeToHz(degree: number): number {
  const octave = Math.floor(degree / SCALE_SEMITONES.length);
  const index = ((degree % SCALE_SEMITONES.length) + SCALE_SEMITONES.length) % SCALE_SEMITONES.length;
  return D4 * 2 ** (((SCALE_SEMITONES[index] ?? 0) + 12 * octave) / 12);
}

/** One note of a cue: scale degree, start in eighth-notes from the cue's start, and loudness 0..1. */
export interface CueNote {
  readonly degree: number;
  readonly at: number;
  readonly level?: number;
}

export interface Theme {
  readonly id: 'lantern' | 'heron' | 'ripple';
  readonly name: string;
  /** The hook itself. */
  readonly motif: readonly CueNote[];
  /** 32 catch steps (call, then answer) followed by a 32-step variation. */
  readonly sequence: readonly number[];
  readonly startSting: readonly CueNote[];
  readonly phaseSting: readonly CueNote[];
  readonly winFanfare: readonly CueNote[];
  readonly lossPhrase: readonly CueNote[];
}

const steps = (...bars: number[][]): number[] => bars.flat();

/** A: "Lantern" - a rising call that opens upward: D A F A D'. Long-short-short-long-long. */
const LANTERN: Theme = {
  id: 'lantern',
  name: 'Lantern (rising call)',
  motif: [
    { degree: 0, at: 0 },
    { degree: 3, at: 2 },
    { degree: 2, at: 3 },
    { degree: 3, at: 4 },
    { degree: 5, at: 6 },
  ],
  sequence: steps(
    [0, 3, 2, 3],
    [5, 3, 2, 3],
    [0, 3, 2, 3],
    [5, 4, 3, 2],
    [0, 3, 2, 3],
    [5, 6, 5, 3],
    [4, 3, 2, 3],
    [2, 0, 3, 0],
    [5, 8, 7, 8],
    [10, 8, 7, 8],
    [5, 8, 7, 8],
    [10, 9, 8, 7],
    [5, 8, 7, 8],
    [10, 11, 10, 8],
    [7, 5, 3, 2],
    [3, 2, 0, 0],
  ),
  startSting: [
    { degree: 0, at: 0 },
    { degree: 3, at: 2 },
    { degree: 2, at: 3 },
    { degree: 3, at: 4 },
    { degree: 5, at: 6, level: 1 },
    { degree: 0, at: 6, level: 0.5 },
  ],
  phaseSting: [
    { degree: 3, at: 0, level: 0.7 },
    { degree: 2, at: 1, level: 0.6 },
    { degree: 5, at: 2, level: 0.8 },
  ],
  winFanfare: [
    { degree: 0, at: 0 },
    { degree: 3, at: 2 },
    { degree: 2, at: 3 },
    { degree: 3, at: 4 },
    { degree: 5, at: 6 },
    { degree: 5, at: 8 },
    { degree: 8, at: 10 },
    { degree: 7, at: 11 },
    { degree: 8, at: 12 },
    { degree: 10, at: 14, level: 1 },
    { degree: 5, at: 14, level: 0.7 },
    { degree: 3, at: 14, level: 0.6 },
    { degree: 0, at: 14, level: 0.6 },
    { degree: 10, at: 18, level: 0.8 },
    { degree: 8, at: 18, level: 0.6 },
  ],
  lossPhrase: [
    { degree: 5, at: 0, level: 0.7 },
    { degree: 3, at: 3, level: 0.6 },
    { degree: 2, at: 5, level: 0.6 },
    { degree: 0, at: 7, level: 0.55 },
    { degree: -5, at: 10, level: 0.6 },
  ],
};

/** B: "Heron" - a dip and return from the high tonic: D' A D' F. Short-short-long-long. */
const HERON: Theme = {
  id: 'heron',
  name: 'Heron (dip and return)',
  motif: [
    { degree: 5, at: 0 },
    { degree: 3, at: 1 },
    { degree: 5, at: 2 },
    { degree: 2, at: 4 },
  ],
  sequence: steps(
    [5, 3, 5, 2],
    [3, 2, 0, 2],
    [5, 3, 5, 2],
    [3, 5, 6, 5],
    [7, 5, 7, 3],
    [5, 3, 2, 3],
    [5, 3, 5, 2],
    [3, 2, 0, 0],
    [5, 3, 5, 2],
    [3, 2, 3, 5],
    [7, 5, 7, 3],
    [5, 6, 7, 8],
    [10, 8, 10, 7],
    [8, 7, 5, 3],
    [5, 3, 5, 2],
    [0, 2, 0, 0],
  ),
  startSting: [
    { degree: 5, at: 0 },
    { degree: 3, at: 1 },
    { degree: 5, at: 2 },
    { degree: 2, at: 4 },
    { degree: 0, at: 6, level: 0.9 },
  ],
  phaseSting: [
    { degree: 5, at: 0, level: 0.7 },
    { degree: 3, at: 1, level: 0.6 },
    { degree: 5, at: 2, level: 0.8 },
  ],
  winFanfare: [
    { degree: 5, at: 0 },
    { degree: 3, at: 1 },
    { degree: 5, at: 2 },
    { degree: 2, at: 4 },
    { degree: 7, at: 6 },
    { degree: 5, at: 7 },
    { degree: 7, at: 8 },
    { degree: 3, at: 10 },
    { degree: 10, at: 12 },
    { degree: 8, at: 13 },
    { degree: 10, at: 14, level: 1 },
    { degree: 5, at: 14, level: 0.7 },
    { degree: 0, at: 14, level: 0.6 },
    { degree: 10, at: 18, level: 0.8 },
  ],
  lossPhrase: [
    { degree: 5, at: 0, level: 0.7 },
    { degree: 3, at: 2, level: 0.6 },
    { degree: 2, at: 4, level: 0.6 },
    { degree: 0, at: 7, level: 0.55 },
    { degree: -5, at: 10, level: 0.6 },
  ],
};

/** C: "Ripple" - a knocked rhythm on the tonic that springs up and settles: D D A F D. */
const RIPPLE: Theme = {
  id: 'ripple',
  name: 'Ripple (knock and spring)',
  motif: [
    { degree: 0, at: 0 },
    { degree: 0, at: 1 },
    { degree: 3, at: 2 },
    { degree: 2, at: 4 },
    { degree: 0, at: 5 },
  ],
  sequence: steps(
    [0, 0, 3, 2],
    [0, 0, 5, 3],
    [0, 0, 3, 2],
    [3, 4, 3, 2],
    [3, 3, 5, 4],
    [3, 3, 7, 5],
    [0, 0, 3, 2],
    [3, 2, 3, 0],
    [5, 5, 8, 7],
    [5, 5, 10, 8],
    [5, 5, 8, 7],
    [8, 9, 8, 7],
    [3, 3, 5, 4],
    [3, 3, 7, 5],
    [5, 5, 3, 2],
    [3, 2, 3, 5],
  ),
  startSting: [
    { degree: 0, at: 0 },
    { degree: 0, at: 1 },
    { degree: 3, at: 2 },
    { degree: 2, at: 4 },
    { degree: 0, at: 5 },
    { degree: 5, at: 7, level: 0.9 },
  ],
  phaseSting: [
    { degree: 0, at: 0, level: 0.7 },
    { degree: 0, at: 1, level: 0.6 },
    { degree: 3, at: 2, level: 0.8 },
  ],
  winFanfare: [
    { degree: 0, at: 0 },
    { degree: 0, at: 1 },
    { degree: 3, at: 2 },
    { degree: 2, at: 4 },
    { degree: 0, at: 5 },
    { degree: 5, at: 7 },
    { degree: 5, at: 8 },
    { degree: 8, at: 9 },
    { degree: 7, at: 11 },
    { degree: 5, at: 12 },
    { degree: 10, at: 14, level: 1 },
    { degree: 5, at: 14, level: 0.7 },
    { degree: 0, at: 14, level: 0.6 },
    { degree: 10, at: 18, level: 0.8 },
  ],
  lossPhrase: [
    { degree: 5, at: 0, level: 0.7 },
    { degree: 5, at: 1, level: 0.55 },
    { degree: 3, at: 3, level: 0.6 },
    { degree: 2, at: 5, level: 0.6 },
    { degree: 0, at: 8, level: 0.55 },
    { degree: -5, at: 11, level: 0.6 },
  ],
};

export const THEMES: readonly Theme[] = [LANTERN, HERON, RIPPLE];
/** The default until Kyle picks one on the ?audition page; players can switch it in Advanced audio. */
export const DEFAULT_THEME: Theme['id'] = 'ripple';
export const PHRASE_STEPS = 32;

export const themeById = (id: string | null | undefined): Theme => THEMES.find((t) => t.id === id) ?? RIPPLE;

export interface MelodyNote {
  readonly degree: number;
  /** Extra degrees sounded with it (koi chord, streak harmony). */
  readonly harmony: readonly number[];
  readonly chime: boolean;
  /** 1-based position in the 32-step phrase. */
  readonly step: number;
}

/**
 * The note for the `streak`-th catch in a row (1-based). Koi add a chord on the current step;
 * 8, 16 and 32 in a row each add a layer. After 32 steps the phrase runs on into its variation.
 */
export function melodyNote(theme: Theme, streak: number, koi: boolean): MelodyNote {
  const index = (Math.max(1, streak) - 1) % theme.sequence.length;
  const degree = theme.sequence[index] ?? 0;
  const harmony: number[] = [];
  if (koi) harmony.push(degree + 2, degree + 4);
  if (streak >= 8) harmony.push(degree - 3);
  if (streak >= 32 && !koi) harmony.push(degree + 2);
  const milestone = streak === 8 || streak === 16 || streak === 32;
  return { degree, harmony, chime: milestone || (streak >= 16 && index % 2 === 0), step: (index % PHRASE_STEPS) + 1 };
}

/** A miss answers with the motif's last two notes falling to the low tonic, softly. */
export function missFall(theme: Theme): CueNote[] {
  const tail = theme.motif.slice(-2).map((n) => n.degree);
  return [
    { degree: (tail[0] ?? 3) - 5, at: 0, level: 0.34 },
    { degree: (tail[1] ?? 2) - 5, at: 1, level: 0.3 },
    { degree: -5, at: 2, level: 0.3 },
  ];
}

/**
 * Onset for a note asked for at `now`: nudged to the nearest eighth-note of the music if that is
 * within `maxNudge` seconds, otherwise played immediately.
 */
export function quantizeOnset(now: number, musicStart: number, eighth: number, maxNudge = 0.04): number {
  if (musicStart <= 0 || now < musicStart) return now;
  const phase = (now - musicStart) / eighth;
  const nearest = musicStart + Math.round(phase) * eighth;
  const diff = nearest - now;
  if (Math.abs(diff) > maxNudge) return now;
  return Math.max(now, nearest);
}
