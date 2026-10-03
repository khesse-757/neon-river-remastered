import { DEFAULT_THEME, THEMES, type Theme } from './melody';

/** The faders a player can set. Stingers and fanfares follow the music fader. */
export type Channel = 'music' | 'ambience' | 'sfx' | 'notes' | 'ui';
export const CHANNELS: readonly Channel[] = ['music', 'ambience', 'sfx', 'notes', 'ui'];

export type Instrument = 'koto' | 'kalimba' | 'bell' | 'marimba';
export const INSTRUMENTS: readonly Instrument[] = ['koto', 'kalimba', 'bell', 'marimba'];
export const INSTRUMENT_LABELS: Record<Instrument, string> = { koto: 'KOTO', kalimba: 'KALIMBA', bell: 'SOFT BELL', marimba: 'MARIMBA' };

export type EqPreset = 'default' | 'warm' | 'bright' | 'headphones' | 'night';
export const EQ_PRESETS: Record<EqPreset, { readonly bass: number; readonly mid: number; readonly treble: number }> = {
  default: { bass: 0, mid: 0, treble: 0 },
  warm: { bass: 3, mid: 0, treble: -3 },
  bright: { bass: -1, mid: 1, treble: 4 },
  headphones: { bass: 2, mid: -1, treble: 1 },
  // Night is also quieter and more compressed (see AudioBus).
  night: { bass: -4, mid: 0, treble: -2 },
};
export const EQ_PRESET_IDS = Object.keys(EQ_PRESETS) as EqPreset[];
export const EQ_RANGE = 6;

/** The three switches on the simple panel. "Sounds" covers splashes, effects, ambience and UI. */
export type Toggle = 'music' | 'sfx' | 'notes';

export interface AudioSettings {
  muted: boolean;
  /** Faders are slider positions 0..1. */
  master: number;
  volume: Record<Channel, number>;
  enabled: Record<Toggle, boolean>;
  instrument: Instrument;
  theme: Theme['id'];
  /** 'custom' once a tone slider has been moved by hand. */
  eq: EqPreset | 'custom';
  /** dB, -6..6. */
  bass: number;
  mid: number;
  treble: number;
  reverb: number;
  mono: boolean;
  muteInBackground: boolean;
  haptics: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = {
  muted: false,
  master: 0.8,
  volume: { music: 0.7, ambience: 0.7, sfx: 0.75, notes: 0.7, ui: 0.6 },
  // Fish Notes are off by default: a catch is a splash and a soft chime.
  enabled: { music: true, sfx: true, notes: false },
  instrument: 'koto',
  theme: DEFAULT_THEME,
  eq: 'default',
  bass: 0,
  mid: 0,
  treble: 0,
  reverb: 0.5,
  mono: false,
  muteInBackground: true,
  haptics: true,
};

export const defaultAudio = (): AudioSettings => ({
  ...DEFAULT_AUDIO,
  volume: { ...DEFAULT_AUDIO.volume },
  enabled: { ...DEFAULT_AUDIO.enabled },
});

const unit = (value: unknown, fallback: number): number => (typeof value === 'number' && value >= 0 && value <= 1 ? value : fallback);
const db = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(EQ_RANGE, Math.max(-EQ_RANGE, value)) : 0;
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/** Saved settings are untrusted: anything missing or out of range falls back to its default. */
export function sanitizeAudio(raw: unknown): AudioSettings {
  const out = defaultAudio();
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  const volume = (typeof r.volume === 'object' && r.volume !== null ? r.volume : {}) as Record<string, unknown>;
  const enabled = (typeof r.enabled === 'object' && r.enabled !== null ? r.enabled : {}) as Record<string, unknown>;
  out.muted = flag(r.muted, out.muted);
  out.master = unit(r.master, out.master);
  for (const key of CHANNELS) out.volume[key] = unit(volume[key], out.volume[key]);
  for (const key of ['music', 'sfx', 'notes'] as const) out.enabled[key] = flag(enabled[key], out.enabled[key]);
  if (INSTRUMENTS.includes(r.instrument as Instrument)) out.instrument = r.instrument as Instrument;
  if (THEMES.some((t) => t.id === r.theme)) out.theme = r.theme as Theme['id'];
  if (r.eq === 'custom' || EQ_PRESET_IDS.includes(r.eq as EqPreset)) out.eq = r.eq as AudioSettings['eq'];
  out.bass = db(r.bass);
  out.mid = db(r.mid);
  out.treble = db(r.treble);
  out.reverb = unit(r.reverb, out.reverb);
  out.mono = flag(r.mono, out.mono);
  out.muteInBackground = flag(r.muteInBackground, out.muteInBackground);
  out.haptics = flag(r.haptics, out.haptics);
  return out;
}

/** v2: the first format saved Fish Notes as on, which is no longer the default. */
const STORE = 'neonriver2_audio_v2';

export function loadAudio(): AudioSettings {
  try {
    return sanitizeAudio(JSON.parse(localStorage.getItem(STORE) ?? 'null'));
  } catch {
    return defaultAudio();
  }
}

export function saveAudio(settings: AudioSettings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}
