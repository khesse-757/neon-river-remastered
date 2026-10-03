import { describe, expect, it } from 'vitest';
import { emptyRecords, formatTime, modeRecord, recordNight, sanitizeRecords } from '../../src/game/records';
import { defaultVisuals, LOOKS, lookById, sanitizeVisuals } from '../../src/render/visuals';

describe('records', () => {
  it('keeps best time, best streak and wins per mode', () => {
    const r = emptyRecords();
    recordNight(r, 'normal', { won: false, time: 80, bestStreak: 31 });
    expect(modeRecord(r, 'normal')).toEqual({ wins: 0, bestTime: null, bestStreak: 31 });
    recordNight(r, 'normal', { won: true, time: 131, bestStreak: 20 });
    recordNight(r, 'normal', { won: true, time: 125, bestStreak: 44 });
    recordNight(r, 'normal', { won: true, time: 140, bestStreak: 12 });
    expect(modeRecord(r, 'normal')).toEqual({ wins: 3, bestTime: 125, bestStreak: 44 });
    expect(modeRecord(r, 'hard')).toEqual({ wins: 0, bestTime: null, bestStreak: 0 });
    expect(formatTime(125.4)).toBe('2:05');
  });

  it('treats saved records as untrusted', () => {
    expect(sanitizeRecords(null)).toEqual(emptyRecords());
    expect(sanitizeRecords('x')).toEqual(emptyRecords());
    const r = sanitizeRecords({
      modes: { normal: { wins: -3, bestTime: 'fast', bestStreak: 12.7 }, zen: 7 },
      catches: { bluegill: 10, koi: NaN, eel: '4' },
      hardUnlocked: 'yes',
    });
    expect(r.modes.normal).toEqual({ wins: 0, bestTime: null, bestStreak: 12 });
    expect(r.modes.zen).toBeUndefined();
    expect(r.catches).toEqual({ bluegill: 10, koi: 0, eel: 0 });
    expect(r.hardUnlocked).toBe(false);
  });
});

describe('visual settings', () => {
  it('falls back to defaults for anything missing or out of range, and follows the system for reduced motion', () => {
    expect(sanitizeVisuals(null)).toEqual(defaultVisuals());
    expect(sanitizeVisuals(undefined, true).reduceMotion).toBe(true);
    expect(sanitizeVisuals(undefined, true).reduceFlashing).toBe(true);
    const v = sanitizeVisuals({
      quality: 'ultra',
      resolution: 0.6,
      bloomIntensity: 9,
      particles: 0.3,
      look: 'sepia',
      hudScale: 3,
      drift: false,
    });
    expect(v.quality).toBe('auto');
    expect(v.resolution).toBe(1);
    expect(v.bloomIntensity).toBe(1);
    expect(v.particles).toBe(0.3);
    expect(v.look).toBe('night');
    expect(v.hudScale).toBe(1);
    expect(v.drift).toBe(false);
    // The first saved format had weather as a switch.
    expect(sanitizeVisuals({ weather: false }).weather).toBe('off');
    expect(sanitizeVisuals({ weather: true }).weather).toBe('auto');
    expect(sanitizeVisuals({ weather: 'storm', rainAmount: 1.5, lightning: 0 })).toMatchObject({
      weather: 'storm',
      rainAmount: 1.5,
      lightning: 0,
    });
    expect(sanitizeVisuals({ rainAmount: 9, lightning: -1 })).toMatchObject({ rainAmount: 1, lightning: 1 });
  });

  it('has four looks, with Night as the unchanged picture', () => {
    expect(LOOKS.map((l) => l.id)).toEqual(['night', 'vivid', 'ukiyoe', 'moonlight']);
    const night = lookById('night');
    expect([night.grade, night.saturation, night.wash[3], night.neon, night.bloom, night.vignette]).toEqual([0.18, 1, 0, 1, 1, 0.35]);
    expect(lookById('nope').id).toBe('night');
  });
});
