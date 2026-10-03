/**
 * The streak melody: a composed 32-step phrase (a 16-step call and a 16-step answer) in
 * D hirajoshi, the key of the music loop. Each catch plays the next note; when the phrase ends
 * it continues into a variation instead of stalling on a top note.
 */

/** D hirajoshi: D E F A Bb. Degree 0 is D4; degrees run up and down through the octaves. */
const SCALE_SEMITONES = [0, 2, 3, 7, 8];
const D4 = 293.66;

export function degreeToHz(degree: number): number {
  const octave = Math.floor(degree / SCALE_SEMITONES.length);
  const index = ((degree % SCALE_SEMITONES.length) + SCALE_SEMITONES.length) % SCALE_SEMITONES.length;
  return D4 * 2 ** (((SCALE_SEMITONES[index] ?? 0) + 12 * octave) / 12);
}

// prettier-ignore
const CALL =       [0, 2, 3, 2,  3, 4, 3, 2,  3, 5, 4, 3,  2, 3, 2, 0];
// prettier-ignore
const ANSWER =     [3, 5, 6, 5,  7, 6, 5, 3,  4, 3, 2, 3,  2, 0, -2, 0];
// prettier-ignore
const CALL_VAR =   [0, 2, 3, 5,  4, 3, 2, 3,  5, 6, 5, 3,  4, 3, 2, 0];
// prettier-ignore
const ANSWER_VAR = [5, 6, 7, 6,  8, 7, 5, 4,  3, 2, 3, 5,  3, 2, 0, 0];

/** Two passes of 32 steps: the phrase, then its variation, then round again. */
export const PHRASE: readonly number[] = [...CALL, ...ANSWER, ...CALL_VAR, ...ANSWER_VAR];
export const PHRASE_STEPS = 32;

export interface MelodyNote {
  /** Scale degree of the melody note. */
  readonly degree: number;
  /** Extra degrees sounded with it (koi chord, streak harmony). */
  readonly harmony: readonly number[];
  /** Add the chime layer. */
  readonly chime: boolean;
  /** 1-based position in the 32-step phrase. */
  readonly step: number;
}

/**
 * Pure melody state. `streak` is the number of catches in a row, starting at 1.
 * Milestones add layers: 8 in a row brings a harmony voice, 16 a chime, 32 a fuller chord.
 */
export function melodyNote(streak: number, koi: boolean): MelodyNote {
  const index = (Math.max(1, streak) - 1) % PHRASE.length;
  const degree = PHRASE[index] ?? 0;
  const harmony: number[] = [];
  // Koi: a chord on the current step (a third and a fifth up within the scale).
  if (koi) harmony.push(degree + 2, degree + 4);
  if (streak >= 8) harmony.push(degree - 3);
  if (streak >= 32 && !koi) harmony.push(degree + 2);
  const milestone = streak === 8 || streak === 16 || streak === 32;
  return { degree, harmony, chime: milestone || (streak >= 16 && index % 2 === 0), step: (index % PHRASE_STEPS) + 1 };
}

/** A soft falling resolution back to the tonic for a miss. */
export const MISS_FALL: readonly number[] = [3, 2, 0];

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
