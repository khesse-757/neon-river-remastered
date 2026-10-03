import { DEFAULT_CONFIG, type SimConfig } from './config';

/**
 * A way to play the night. A mode is a name, a line for the title screen, and a function that
 * turns the base tuning into its own. Add a mode by adding an entry to MODES.
 */
export interface GameMode {
  readonly id: string;
  readonly name: string;
  /** The title screen's third rule line in this mode. */
  readonly rule: string;
  /** A win in this mode unlocks Hard River. */
  readonly unlocks: boolean;
  readonly apply: (base: SimConfig) => SimConfig;
}

export const MODES: readonly GameMode[] = [
  {
    id: 'normal',
    name: 'Normal',
    rule: 'NEVER NET AN ELECTRIC EEL',
    unlocks: true,
    apply: (base) => base,
  },
  {
    // The same river and the same catch, with nothing in it that can shock you: an eel's place in
    // the stream is simply left empty.
    id: 'zen',
    name: 'Zen',
    rule: 'NO EELS TONIGHT. JUST FISH',
    unlocks: false,
    apply: (base) => ({ ...base, eels: false }),
  },
];

export const DEFAULT_MODE = 'normal';

export const modeById = (id: string | null | undefined): GameMode => MODES.find((m) => m.id === id) ?? (MODES[0] as GameMode);

export const configFor = (id: string | null | undefined, base: SimConfig = DEFAULT_CONFIG): SimConfig => modeById(id).apply(base);
