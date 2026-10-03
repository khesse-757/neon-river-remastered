import { describe, expect, it } from 'vitest';
import { degreeToHz, melodyNote, MISS_FALL, PHRASE, PHRASE_STEPS, quantizeOnset } from '../../src/audio/melody';

describe('streak melody', () => {
  it('is a 32-step phrase (two 16-step halves) followed by a 32-step variation', () => {
    expect(PHRASE_STEPS).toBe(32);
    expect(PHRASE).toHaveLength(64);
    expect(PHRASE.slice(0, 32)).not.toEqual(PHRASE.slice(32));
    // Call and answer both come home to the tonic.
    expect(PHRASE[15]).toBe(0);
    expect(PHRASE[31]).toBe(0);
    expect(PHRASE[63]).toBe(0);
  });

  it('stays in D hirajoshi (D E F A Bb)', () => {
    const allowed = new Set([2, 4, 5, 9, 10]);
    for (const degree of [...PHRASE, ...MISS_FALL]) {
      const midi = Math.round(69 + 12 * Math.log2(degreeToHz(degree) / 440));
      expect(allowed.has(((midi % 12) + 12) % 12)).toBe(true);
    }
    expect(degreeToHz(0)).toBeCloseTo(293.66, 1);
    expect(degreeToHz(5)).toBeCloseTo(587.32, 1);
  });

  it('never stalls: long streaks keep moving and loop into the variation', () => {
    let repeats = 0;
    for (let streak = 1; streak < 200; streak++) {
      const a = melodyNote(streak, false);
      const b = melodyNote(streak + 1, false);
      if (a.degree === b.degree) repeats++;
      expect(a.step).toBe(((streak - 1) % 32) + 1);
    }
    // Only the composed cadences repeat a pitch; nothing sits on one note.
    expect(repeats).toBeLessThan(12);
    expect(melodyNote(33, false).degree).toBe(PHRASE[32]);
    expect(melodyNote(65, false).degree).toBe(PHRASE[0]);
    expect(melodyNote(1, false).step).toBe(1);
  });

  it('adds a chord for koi and layers at 8, 16 and 32 in a row', () => {
    expect(melodyNote(3, false).harmony).toEqual([]);
    expect(melodyNote(3, true).harmony).toHaveLength(2);
    expect(melodyNote(8, false).harmony).toHaveLength(1);
    expect(melodyNote(8, false).chime).toBe(true);
    expect(melodyNote(7, false).chime).toBe(false);
    expect(melodyNote(17, false).chime).toBe(true);
    expect(melodyNote(32, false).harmony.length).toBeGreaterThan(melodyNote(31, false).harmony.length);
  });

  it('nudges onsets to the eighth-note grid by at most 40 ms, and never into the past', () => {
    const eighth = 0.375;
    const start = 10;
    for (let i = 0; i < 400; i++) {
      const now = start + i * 0.0173;
      const when = quantizeOnset(now, start, eighth);
      expect(when).toBeGreaterThanOrEqual(now);
      expect(when - now).toBeLessThanOrEqual(0.04 + 1e-9);
      const offGrid = Math.abs((when - start) / eighth - Math.round((when - start) / eighth)) * eighth;
      if (when !== now) expect(offGrid).toBeLessThan(1e-9);
    }
    expect(quantizeOnset(10.36, 10, eighth)).toBeCloseTo(10.375, 9);
    expect(quantizeOnset(10.2, 10, eighth)).toBe(10.2);
    expect(quantizeOnset(5, 0, eighth)).toBe(5);
  });
});
