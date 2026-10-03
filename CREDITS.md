# Credits

## People

- Game design and direction: Kyle Hesse ([kahdev.me](https://kahdev.me))
- Code, 3D models, shaders and tuning: written with [Claude Code](https://claude.com/claude-code) (Anthropic), directed and playtested by Kyle

## Inspiration and research

- Inspired by the fishing minigame in _Jak and Daxter: The Precursor Legacy_ (Naughty Dog, 2001). Neon River is a
  fan-made homage. It is not affiliated with or endorsed by Naughty Dog or Sony Interactive Entertainment, and it
  uses no code, art or audio from the game.
- Mechanics research: the [OpenGOAL](https://github.com/open-goal/jak-project) community's decompilation of the
  game showed how the original spawns its fish (one sweeping emitter, timed phases). Notes in
  `docs/design/ORIGINAL_FISHING_DESIGN.md`. No OpenGOAL code is used.
- Remastered from [Neon River v1](https://github.com/khesse-757/neon-river) (MIT, Kyle Hesse).

## Art

- Background painting and fisherman: generated with Google Gemini (Nano Banana Pro) for Neon River v1; sources in
  `assets-src/original/`. Re-quantized to a 48-color palette and split into depth layers by `scripts/build-scene.mjs`.
- Fish, eel and net sprites shown as "Original" in the Field Guide: from Neon River v1.
- 3D fish, eel, net, lantern and basket: built in code for the remaster (`src/render/models/`).
- Icons and the share images: made from the painting by `scripts/build-brand.mjs`.

## Audio

- **Catch sound** (`assets-src/original/water_net.wav`, shipped as `public/audio/sfx/net.mp3`): from
  [Freesound](https://freesound.org), by [nilbul](https://freesound.org/people/nilbul/). v1 did not record the
  sound's id. Checked on 2026-10-03: nilbul's public water sound is
  ["Water splash"](https://freesound.org/people/nilbul/sounds/404829/), licensed
  [Creative Commons 0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain; attribution not
  required, given here anyway). The shipped file is 0.76 s against that sound's 0.87 s, which fits a trimmed copy,
  but the match was not confirmed by ear.
- **Generated with ElevenLabs**, offline, for this game (raw files in `assets-src/audio/`, loudness-normalized
  copies in `public/audio/`):
  - Ambience: the night-river loop
  - Weather: light-rain and heavy-rain loops, three thunder rolls
  - Music: the calm koto-and-synth loop
  - Catch: two splashes
  - Instruments: a koto pluck (the catch melody is played on it) and a chime
- **Synthesized in the browser** (Web Audio, `src/audio/AudioBus.ts`): the speed-up stinger, the eel warning and
  shock, UI sounds, and the win melody.

## Fonts

- Silkscreen by Jason Kottke, SIL Open Font License 1.1 (`public/fonts/Silkscreen-OFL.txt`)
- DotGothic16 by Fontworks Inc., SIL Open Font License 1.1 (`public/fonts/DotGothic16-OFL.txt`), subset to Basic Latin

## Software

- [three.js](https://threejs.org) (MIT)
- [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev),
  [Playwright](https://playwright.dev), [lil-gui](https://lil-gui.georgealways.com) (dev tools only)
- [threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills) by Majid Manzarpour: the Claude Code
  skills pack used to plan, build and check the game (at commit 8286774), plus a project art-direction skill
- ffmpeg and gifsicle for audio normalization and README media

## License

The game's code is MIT (see `LICENSE`).
