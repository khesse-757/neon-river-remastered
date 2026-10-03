/** The picture settings a player can change (Advanced visuals). Everything applies live and is saved. */
export type QualityPreset = 'auto' | 'low' | 'medium' | 'high';
export const QUALITY_PRESETS: readonly QualityPreset[] = ['auto', 'low', 'medium', 'high'];

export type LookId = 'night' | 'vivid' | 'ukiyoe' | 'moonlight';

/**
 * A look is the existing color grade with different numbers: palette blend, saturation, a tint,
 * a wash toward one tone, and how hard the neon and bloom push. No new art.
 */
export interface Look {
  readonly id: LookId;
  readonly label: string;
  /** Blend toward the painting's palette (0..1). */
  readonly grade: number;
  readonly saturation: number;
  readonly tint: readonly [number, number, number];
  /** Wash toward this display-space tone, scaled by brightness: [r, g, b, amount]. */
  readonly wash: readonly [number, number, number, number];
  readonly neon: number;
  readonly bloom: number;
  readonly vignette: number;
}

export const LOOKS: readonly Look[] = [
  { id: 'night', label: 'NIGHT', grade: 0.18, saturation: 1, tint: [1, 1, 1], wash: [1, 1, 1, 0], neon: 1, bloom: 1, vignette: 0.35 },
  {
    id: 'vivid',
    label: 'VIVID NEON',
    grade: 0.05,
    saturation: 1.4,
    tint: [1.02, 1, 1.06],
    wash: [1, 1, 1, 0],
    neon: 1.3,
    bloom: 1.35,
    vignette: 0.4,
  },
  // Muted and paper-toned: a woodblock print left in a drawer.
  {
    id: 'ukiyoe',
    label: 'UKIYO-E',
    grade: 0.5,
    saturation: 0.55,
    tint: [1.04, 1, 0.9],
    wash: [0.93, 0.85, 0.68, 0.3],
    neon: 0.8,
    bloom: 0.6,
    vignette: 0.2,
  },
  // Near-monochrome blue.
  {
    id: 'moonlight',
    label: 'MOONLIGHT',
    grade: 0.1,
    saturation: 0.12,
    tint: [0.72, 0.9, 1.2],
    wash: [1, 1, 1, 0],
    neon: 0.9,
    bloom: 0.9,
    vignette: 0.45,
  },
];

export const lookById = (id: string): Look => LOOKS.find((l) => l.id === id) ?? (LOOKS[0] as Look);

export const RESOLUTION_STEPS: readonly number[] = [0.5, 0.75, 1];
export const HUD_SCALES: readonly number[] = [1, 2];

export interface VisualSettings {
  quality: QualityPreset;
  /** Share of the 3D layer's full resolution: 0.5, 0.75 or 1. */
  resolution: number;
  bloom: boolean;
  /** 0..1.5; 1 is the authored strength. */
  bloomIntensity: number;
  reflections: boolean;
  weather: boolean;
  /** Particles and fireflies, 0..1. Fish wakes and warnings are never thinned: they carry the read. */
  particles: number;
  drift: boolean;
  shake: boolean;
  reduceMotion: boolean;
  reduceFlashing: boolean;
  look: LookId;
  hudScale: number;
  showFps: boolean;
}

/** `system` is what the device asks for (prefers-reduced-motion) and seeds the two reduce switches. */
export const defaultVisuals = (system = false): VisualSettings => ({
  quality: 'auto',
  resolution: 1,
  bloom: true,
  bloomIntensity: 1,
  reflections: true,
  weather: true,
  particles: 1,
  drift: true,
  shake: true,
  reduceMotion: system,
  reduceFlashing: system,
  look: 'night',
  hudScale: 1,
  showFps: false,
});

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const within = (value: unknown, lo: number, hi: number, fallback: number): number =>
  typeof value === 'number' && value >= lo && value <= hi ? value : fallback;

/** Saved settings are untrusted: anything missing or out of range falls back to its default. */
export function sanitizeVisuals(raw: unknown, system = false): VisualSettings {
  const out = defaultVisuals(system);
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  if (QUALITY_PRESETS.includes(r.quality as QualityPreset)) out.quality = r.quality as QualityPreset;
  if (RESOLUTION_STEPS.includes(r.resolution as number)) out.resolution = r.resolution as number;
  out.bloom = flag(r.bloom, out.bloom);
  out.bloomIntensity = within(r.bloomIntensity, 0, 1.5, out.bloomIntensity);
  out.reflections = flag(r.reflections, out.reflections);
  out.weather = flag(r.weather, out.weather);
  out.particles = within(r.particles, 0, 1, out.particles);
  out.drift = flag(r.drift, out.drift);
  out.shake = flag(r.shake, out.shake);
  out.reduceMotion = flag(r.reduceMotion, out.reduceMotion);
  out.reduceFlashing = flag(r.reduceFlashing, out.reduceFlashing);
  if (LOOKS.some((l) => l.id === r.look)) out.look = r.look as LookId;
  if (HUD_SCALES.includes(r.hudScale as number)) out.hudScale = r.hudScale as number;
  out.showFps = flag(r.showFps, out.showFps);
  return out;
}

const STORE = 'neonriver2_visuals_v1';

const systemReduced = (): boolean => {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
};

/** Holds the settings, saves every change, and tells the game to apply it. */
export class VisualStore {
  settings: VisualSettings;
  onChange: () => void = () => undefined;

  constructor() {
    const system = systemReduced();
    try {
      this.settings = sanitizeVisuals(JSON.parse(localStorage.getItem(STORE) ?? 'null'), system);
    } catch {
      this.settings = defaultVisuals(system);
    }
  }

  update(patch: Partial<VisualSettings>): void {
    this.settings = sanitizeVisuals({ ...this.settings, ...patch }, systemReduced());
    this.save();
    this.onChange();
  }

  reset(): void {
    this.settings = defaultVisuals(systemReduced());
    this.save();
    this.onChange();
  }

  private save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify(this.settings));
    } catch {
      /* storage unavailable */
    }
  }
}
