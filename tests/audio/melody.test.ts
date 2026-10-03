import { describe, expect, it } from 'vitest';
import { degreeToHz, melodyNote, missFall, PHRASE_STEPS, quantizeOnset, THEMES } from '../../src/audio/melody';

const pitchClass = (degree: number): number => {
  const midi = Math.round(69 + 12 * Math.log2(degreeToHz(degree) / 440));
  return ((midi % 12) + 12) % 12;
};
const HIRAJOSHI_D = new Set([2, 4, 5, 9, 10]);

describe('leitmotif themes', () => {
  it('offers three candidates, each a 3-5 note motif with a 32-step sequence and a 32-step variation', () => {
    expect(THEMES).toHaveLength(3);
    expect(PHRASE_STEPS).toBe(32);
    for (const theme of THEMES) {
      expect(theme.motif.length).toBeGreaterThanOrEqual(3);
      expect(theme.motif.length).toBeLessThanOrEqual(5);
      expect(theme.sequence).toHaveLength(64);
      expect(theme.sequence.slice(0, 32)).not.toEqual(theme.sequence.slice(32));
      // Call, answer and variation all come home to a D.
      for (const end of [31, 63]) expect(pitchClass(theme.sequence[end] ?? 1)).toBe(2);
    }
  });

  it('keeps every note of every cue in D hirajoshi', () => {
    for (const theme of THEMES) {
      const all = [
        ...theme.sequence,
        ...[theme.motif, theme.startSting, theme.phaseSting, theme.winFanfare, theme.lossPhrase, missFall(theme)]
          .flat()
          .map((n) => n.degree),
      ];
      for (const degree of all) expect(HIRAJOSHI_D.has(pitchClass(degree))).toBe(true);
    }
    expect(degreeToHz(0)).toBeCloseTo(293.66, 1);
    expect(degreeToHz(5)).toBeCloseTo(587.32, 1);
  });

  it('builds the catch sequence from the motif: the hook opens it and keeps returning', () => {
    for (const theme of THEMES) {
      const hook = theme.motif.slice(0, 3).map((n) => n.degree);
      const seq = theme.sequence.slice(0, 32);
      expect(seq.slice(0, 3)).toEqual(hook);
      let returns = 0;
      for (let i = 0; i + 3 <= seq.length; i += 4) if (hook.every((d, k) => seq[i + k] === d)) returns++;
      expect(returns).toBeGreaterThanOrEqual(3);
    }
  });

  it('quotes the motif in the start sting, the win fanfare and the loss phrase', () => {
    for (const theme of THEMES) {
      const hook = theme.motif.map((n) => n.degree);
      expect(theme.startSting.slice(0, hook.length).map((n) => n.degree)).toEqual(hook);
      expect(theme.winFanfare.slice(0, hook.length).map((n) => n.degree)).toEqual(hook);
      // The fanfare climbs; the loss phrase sinks to the low tonic.
      expect(Math.max(...theme.winFanfare.map((n) => n.degree))).toBeGreaterThan(Math.max(...hook));
      expect(theme.lossPhrase[theme.lossPhrase.length - 1]?.degree).toBe(-5);
      expect(theme.phaseSting.length).toBeLessThanOrEqual(3);
    }
  });

  it('never stalls on long streaks, and adds a chord for koi and layers at 8, 16 and 32', () => {
    for (const theme of THEMES) {
      for (let streak = 1; streak < 200; streak++) expect(melodyNote(theme, streak, false).step).toBe(((streak - 1) % 32) + 1);
      let run = 1;
      let longest = 1;
      for (let streak = 2; streak < 200; streak++) {
        run = melodyNote(theme, streak, false).degree === melodyNote(theme, streak - 1, false).degree ? run + 1 : 1;
        longest = Math.max(longest, run);
      }
      expect(longest).toBeLessThanOrEqual(3);
      expect(melodyNote(theme, 33, false).degree).toBe(theme.sequence[32]);
      expect(melodyNote(theme, 65, false).degree).toBe(theme.sequence[0]);
      expect(melodyNote(theme, 3, false).harmony).toEqual([]);
      expect(melodyNote(theme, 3, true).harmony).toHaveLength(2);
      expect(melodyNote(theme, 8, false).chime).toBe(true);
      expect(melodyNote(theme, 7, false).chime).toBe(false);
      expect(melodyNote(theme, 32, false).harmony.length).toBeGreaterThan(melodyNote(theme, 31, false).harmony.length);
    }
  });

  it('nudges onsets to the eighth-note grid by at most 40 ms, and never into the past', () => {
    const eighth = 0.375;
    const start = 10;
    for (let i = 0; i < 400; i++) {
      const now = start + i * 0.0173;
      const when = quantizeOnset(now, start, eighth);
      expect(when).toBeGreaterThanOrEqual(now);
      expect(when - now).toBeLessThanOrEqual(0.04 + 1e-9);
    }
    expect(quantizeOnset(10.36, 10, eighth)).toBeCloseTo(10.375, 9);
    expect(quantizeOnset(10.2, 10, eighth)).toBe(10.2);
    expect(quantizeOnset(5, 0, eighth)).toBe(5);
  });
});
