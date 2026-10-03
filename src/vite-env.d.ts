/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  mode: string;
  /** Stage id (still-water, quickening, neon-rapids, bank-to-bank) and its index 0..3. */
  phase: string;
  stage: number;
  /** Game mode id: zen, normal, hard. */
  gameMode: string;
  hardUnlocked: boolean;
  /** A Zen night that was won and carried on. */
  endless: boolean;
  /** The Field Guide is open. */
  gallery: boolean;
  visuals: import('./render/visuals').VisualSettings;
  /** The settings panel is open (pause, or the gear on other screens). */
  settings: boolean;
  status: string;
  lossCause: string | null;
  caught: number;
  escaped: number;
  streak: number;
  fish: number;
  net: { lane: number; velocity: number };
  actors: string;
  basket: number;
  audioErrors: number;
  renderer: { calls: number; triangles: number; geometries: number; textures: number; programs: number };
  canvas: { clientWidth: number; clientHeight: number; width: number; height: number; dpr: number };
  layout: { scale: number; targetW: number; targetH: number; gridW: number; gridH: number; pixelsPerTexel: number };
  quality: number;
  winning: boolean;
  audio: string;
  /** RMS at the final output now, and its recent peak. */
  audioLevel: number;
  audioPeak: number;
  fishNotes: boolean;
  theme: string;
  rippleEncoding: string;
}

interface ThreeGameTestHooks {
  /** Seed for the next run; all gameplay randomness flows from it. */
  seed(value: number): void | Promise<void>;
  /** Acknowledge after setup/assets are ready; throws for unknown states. */
  setState(name: string): { state: string } | Promise<{ state: string }>;
  /** Stop simulation and animation immediately; keep rendering. */
  setPausedForScreenshot(paused: boolean): void | Promise<void>;
  /** Freeze ambient animation time. */
  setReducedMotion(enabled: boolean): void | Promise<void>;
  /** Hide debug UI (lil-gui, path editor) before capturing. */
  hideDebugUi(hidden: boolean): void | Promise<void>;
  /** Let the built-in fish tracker drive the net (smoke tests, captures). */
  setAutoplay(enabled: boolean): void;
  /** Drop a fish just upstream of the net (video capture of the eel sequence). */
  spawnAtNet(kind: 'bluegill' | 'koi' | 'eel'): void;
  /** RMS at the final audio output (after mute, mix, EQ and limiter). */
  audioLevel(): number;
  /** Music and ambience beds off or on, so a test can listen for one sound at a time. */
  setAudioBeds(on: boolean): void;
  /** Only this named sound may play (start, catch, miss, eel, win, loss, speed-up, warn, near, fry, ui); null restores all. */
  soloAudio(name: string | null): void;
  /** Set the weight caught so far (to reach a real win with one more fish). */
  setWeight(pounds: number): void;
  /** Go to the title screen and choose a game mode (zen, normal, hard); a locked mode is opened for this visit. */
  setGameMode(id: string): void;
  /** Expand or collapse the Advanced visuals section of the settings panel. */
  openAdvancedVisuals(open: boolean): void;
  /** Change picture settings (applies live and is saved, like the panel). */
  setVisuals(patch: Partial<import('./render/visuals').VisualSettings>): void;
  /** The open Field Guide, or null. */
  gallery(): import('./gallery/Gallery').GalleryHandle | null;
  /** Expand or collapse the Advanced audio section of the settings panel. */
  openAdvancedAudio(open: boolean): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
