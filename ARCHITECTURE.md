# Architecture

Neon River is a single-page three.js game with no backend. The code is split so that the rules of the game can
run, and be tested, with no browser at all.

```
input ──intent──▶ sim ──events──▶ Game ──▶ render (three.js)
                   ▲                 ├──▶ audio (Web Audio)
        fixed step │                 └──▶ ui (DOM overlay, settings, Field Guide)
                 Loop
```

## Layers

### Sim (`src/sim/`)

Pure game logic: no three.js, DOM, audio or timers. It is driven by a fixed timestep (1/60 s) and a seeded RNG
(`rng.ts`), so a seed and a list of inputs always give the same night. `Math.random()` is never used for gameplay.

| File                    | Job                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `config.ts`             | Every tuning value in one typed object: stages, speed-ups, net feel, radii, weights                                  |
| `modes.ts`              | The modes: each turns the base config into its own                                                                   |
| `sim.ts`                | `Sim`: the emitter (sweeps, S-runs, bank swaps, eel fairness), stages and speed-ups, catching, scoring, win and loss |
| `net.ts`                | Net movement: acceleration, speed cap, damping                                                                       |
| `river.ts`, `camera.ts` | The river spline and the pinhole camera that maps (distance, lane) to the painting                                   |
| `bots/`                 | The oracle and human-like players used by `npm run playtest` and by recordings                                       |

`Sim.step(dt, intent)` advances the night; `Sim.drainEvents()` returns what happened. The sim never calls out.

### Game (`src/game/Game.ts`)

The only place that knows about every other layer. Each frame it:

1. reads a net intent from `Input`,
2. steps the sim in fixed steps from an accumulator,
3. passes each sim event to `onEvent`, which starts the matching effects (particles, ripples, camera shake, a sound,
   a banner, haptics),
4. builds a `FrameView` (interpolated fish positions, net pose, light levels, HUD text) and hands it to the renderer.

It also owns the screen state (`title`, `playing`, `paused`, `over`), the test hooks
(`window.__THREE_GAME_TEST_HOOKS__`) and the diagnostics object the tests read. `records.ts` stores best times,
streaks, wins and lifetime catches in `localStorage`.

### Render (`src/render/`)

`SceneRenderer` draws two layers at two resolutions: the painting (nearest-filtered, at a whole multiple of its
216×387 grid, split into depth layers by masks) and the 3D actors and water at device resolution. A final pass
applies the look (grade, bloom), and the pixel UI is drawn after it so menus keep their colors.
`models/` builds the fish, eel, net, lantern and basket in code; `shaders.ts` holds the water and toon shaders;
`RippleField` is a GPU height-field for wakes and rain rings; `visuals.ts` holds the player's visual settings and
the automatic quality step-down.

The renderer only reads the `FrameView`. It never reads the sim or changes game state.

### Audio (`src/audio/`)

`AudioBus` wraps Web Audio: five channels (music, ambience, sfx, notes, ui) with their own gains, generated loops
and one-shots loaded from `public/audio/`, and procedural voices. `melody.ts` picks the note each catch plays.
`settings.ts` validates and stores the mix. Audio is told what happened by `Game.onEvent`; it never reads the sim.

### UI (`src/ui/`, `src/gallery/`)

All text and panels are drawn in the canvas with pixel fonts. The DOM (`Overlay`) only holds transparent,
focusable buttons and a live region placed over the drawn controls, so keyboard, screen readers and touch work.
`SettingsPanel` is the settings and advanced audio / visuals panel. The Field Guide (`src/gallery/`) has its own
small renderer and is a separate chunk, loaded when the button is pressed.

### Input (`src/input/Input.ts`)

Turns mouse, keyboard, relative touch drags and a gamepad into one of four intents: a target lane (mouse), an axis (keys, gamepad), a
relative delta (touch drag), or nothing. The sim applies the same speed cap to all of them.

### Dev tools (`src/dev/`)

The path editor, lil-gui, `?tune` and `?audition`. They are dynamic imports in `main.ts` behind
`import.meta.env.DEV || ?debug`, so the default production path never downloads them.

## Event flow

The sim's events are the contract between the rules and everything the player sees and hears:

| Event                          | Raised when                                 | What subscribes                                             |
| ------------------------------ | ------------------------------------------- | ----------------------------------------------------------- |
| `stage`                        | A stage starts (index > 0 is a speed-up)    | Stage sign, speed-up stinger, the surge of current, weather |
| `telegraph`, `telegraphCancel` | An eel is about to spawn, or was called off | Warning glow at the emitter, warning sound                  |
| `run`                          | The first fish of an S-run has spawned      | Tests and the playtest report (nothing on screen)           |
| `spawn`                        | A fish enters the river                     | Emitter shimmer, wake                                       |
| `catch`                        | A fish reaches the net                      | Scoop animation, splash, melody note, basket, streak        |
| `miss`                         | A fish passes the net                       | Escape splash, HUD                                          |
| `eelNear`                      | An eel passes just beside the net           | Crackle, flinch                                             |
| `eelCaught`, `lose`            | An eel touches the net, or 20 lb escaped    | Shock, blackout, frying basket, loss screen                 |
| `win`                          | The 200th pound lands                       | Slow motion, lanterns, results card, records                |

Events flow one way. Nothing downstream can change the sim except through the next frame's intent.

## Modes

A mode (`src/sim/modes.ts`) is an id, a name, a card for the title screen, a few flags, and an `apply` function
from the base `SimConfig` to the mode's own:

- **Zen**: `eels: false`, `maxEscaped: Infinity`, `losable: false`. A win offers KEEP FISHING (`Sim.keepFishing()`).
- **Normal**: the base config. A win here unlocks locked modes (`unlocks: true`).
- **Storm Night** (`hard`): its own stage table and speed-ups (`HARD_STAGES`, `HARD_SPEED_UPS`), `maxEscaped: 15`,
  `weather: 'storm'`, locked until a Normal win.

### Adding a mode

1. Add an entry to `MODES` in `src/sim/modes.ts`. Give it an `id`, `name`, `blurb`, `losable`, `weather` and an
   `apply` that returns a changed copy of the base config. Add `lockedBlurb` if it should start locked.
2. If it needs its own stages, add a stage table and speed-up list to `src/sim/config.ts` beside `HARD_STAGES`.
3. Add its button to `index.html` (`<button id="btn-mode-<id>">`). The title screen draws one card per entry in `MODES`.
4. Records are keyed by mode id, so best times work without changes.
5. Add a case to `tests/sim/sim.test.ts`, then run `npm run playtest -- --mode <id> --oracle 20 --human 100` and
   record the result and any tuning in `artifacts/game-progress.md`.

## Testing

- **Unit** (`tests/sim`, `tests/audio`, `tests/game`, Vitest): the sim's invariants over many seeds (fairness,
  telegraph lead, win and loss conditions), the melody, settings and records.
- **Browser** (`tests/e2e`, Playwright): `ci.spec.ts` is the short required check; `smoke.spec.ts` and
  `audio.spec.ts` are the full suites. They drive the game through `__THREE_GAME_TEST_HOOKS__`, which reach each
  state by the real path (for example, the win hook puts the night one pound short and sends a koi into the net).
- **Bots** (`npm run playtest`): an oracle and a human-like player over fixed seeds, for balance.

## Build and deploy

Vite builds to `dist/` with `base: '/'`. `.github/workflows/ci.yml` runs the checks on every PR;
`.github/workflows/deploy.yml` builds `main`, scans `dist/` for secrets and publishes it to GitHub Pages at
[neonriver2.kahdev.me](https://neonriver2.kahdev.me). The custom domain is set in the repository's Pages settings.
