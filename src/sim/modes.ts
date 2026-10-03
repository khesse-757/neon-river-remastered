import { DEFAULT_CONFIG, HARD_SPEED_UPS, HARD_STAGES, type SimConfig } from './config';

/**
 * A way to play the night. A mode is a name, a card for the title screen, and a function that
 * turns the base tuning into its own. Add a mode by adding an entry to MODES.
 */
export interface GameMode {
  readonly id: string;
  readonly name: string;
  /** One line for the mode's card on the title screen. */
  readonly blurb: string;
  /** The line shown on the card while the mode is locked; modes without one are always open. */
  readonly lockedBlurb?: string;
  /** A win in this mode unlocks the modes that start locked. */
  readonly unlocks: boolean;
  /** The night can be lost. When false, a win offers to keep fishing with no goal. */
  readonly losable: boolean;
  /**
   * Render side. 'story': the night's own weather (light rain from the second speed-up, heavier in
   * the last stage, clearing on the win). 'storm': steady rain with lightning from the start.
   */
  readonly weather: 'clear' | 'story' | 'storm';
  readonly apply: (base: SimConfig) => SimConfig;
}

export const MODES: readonly GameMode[] = [
  {
    // The same river with nothing in it that can end the night: eels become fish, and fish that
    // slip by cost nothing. 200 lb is still the win; after it the player can keep fishing.
    id: 'zen',
    name: 'Zen',
    blurb: 'NO EELS. NO LOSING. JUST FISH',
    unlocks: false,
    losable: false,
    weather: 'clear',
    apply: (base) => ({ ...base, eels: false, maxEscaped: Infinity }),
  },
  {
    id: 'normal',
    name: 'Normal',
    blurb: 'DODGE EELS. 20 LB MAY ESCAPE',
    unlocks: true,
    losable: true,
    weather: 'story',
    apply: (base) => base,
  },
  {
    // Storm Night: starts at the Normal night's first speed-up, four speed-ups, half again the eels.
    id: 'hard',
    name: 'Storm Night',
    blurb: 'MORE EELS. 15 LB MAY ESCAPE',
    lockedBlurb: 'WIN A NORMAL NIGHT TO UNLOCK',
    unlocks: false,
    losable: true,
    weather: 'storm',
    apply: (base) => ({ ...base, maxEscaped: 15, stages: HARD_STAGES, speedUps: HARD_SPEED_UPS }),
  },
];

export const DEFAULT_MODE = 'normal';

export const modeById = (id: string | null | undefined): GameMode =>
  MODES.find((m) => m.id === id) ?? (MODES.find((m) => m.id === DEFAULT_MODE) as GameMode);

export const configFor = (id: string | null | undefined, base: SimConfig = DEFAULT_CONFIG): SimConfig => modeById(id).apply(base);
