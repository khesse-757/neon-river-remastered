/// <reference types="vite/client" />

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  mode: string;
  phase: string;
  resting: boolean;
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
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}
