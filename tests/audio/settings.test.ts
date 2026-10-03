import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../../src/audio/melody';
import { DEFAULT_AUDIO, defaultAudio, EQ_PRESETS, EQ_RANGE, sanitizeAudio } from '../../src/audio/settings';

describe('audio settings', () => {
  it('defaults to Fish Notes off, the ripple motif, and muting in the background', () => {
    expect(DEFAULT_AUDIO.enabled).toEqual({ music: true, sfx: true, notes: false });
    expect(DEFAULT_AUDIO.theme).toBe('ripple');
    expect(DEFAULT_THEME).toBe('ripple');
    expect(DEFAULT_AUDIO.muted).toBe(false);
    expect(DEFAULT_AUDIO.muteInBackground).toBe(true);
    expect(DEFAULT_AUDIO.eq).toBe('default');
  });

  it('falls back to defaults for anything missing, mistyped or out of range', () => {
    expect(sanitizeAudio(null)).toEqual(DEFAULT_AUDIO);
    expect(sanitizeAudio('nonsense')).toEqual(DEFAULT_AUDIO);
    const out = sanitizeAudio({
      muted: 'yes',
      master: 4,
      volume: { music: -1, sfx: 0.2, bogus: 1 },
      enabled: { notes: true, music: 0 },
      instrument: 'banjo',
      theme: 'heron',
      eq: 'night',
      bass: 40,
      mid: 'x',
      treble: -2,
      reverb: 0,
      mono: true,
    });
    expect(out.muted).toBe(false);
    expect(out.master).toBe(DEFAULT_AUDIO.master);
    expect(out.volume).toEqual({ ...DEFAULT_AUDIO.volume, sfx: 0.2 });
    expect(out.enabled).toEqual({ music: true, sfx: true, notes: true });
    expect(out.instrument).toBe('koto');
    expect(out.theme).toBe('heron');
    expect(out.eq).toBe('night');
    expect(out.bass).toBe(EQ_RANGE);
    expect(out.mid).toBe(0);
    expect(out.treble).toBe(-2);
    expect(out.reverb).toBe(0);
    expect(out.mono).toBe(true);
    expect(out.haptics).toBe(true);
  });

  it('never shares state between copies of the defaults, and keeps presets within the slider range', () => {
    const a = defaultAudio();
    a.volume.music = 0;
    a.enabled.notes = true;
    expect(defaultAudio()).toEqual(DEFAULT_AUDIO);
    for (const preset of Object.values(EQ_PRESETS))
      for (const value of Object.values(preset)) expect(Math.abs(value)).toBeLessThanOrEqual(EQ_RANGE);
    expect(EQ_PRESETS.default).toEqual({ bass: 0, mid: 0, treble: 0 });
  });
});
