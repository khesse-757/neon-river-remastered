Use the threejs-game-director skill to remaster my game Neon River in three.js. Treat this as a premium, release-ready build — but premium *pixel art*, not premium 3D. Also load the project skill neon-river-art-direction for every visual decision; where it conflicts with threejs-aaa-graphics-builder, it wins.

## Context — read all of this before planning
- CLAUDE.md
- docs/design/REMASTER_BRIEF.md — the spec. It is the source of truth for scope, rules, the phase script, controls, visuals, UI, audio, and proof of done.
- docs/design/ORIGINAL_FISHING_DESIGN.md — how the original Jak and Daxter fishing minigame really works (single sweeping emitter, fish that hold their lane, timed phases with rests, momentum net, circle catches). The new fish paths and ramp are built on this.
- .claude/skills/neon-river-art-direction/SKILL.md
- reference/original/ — Neon River v1 (Canvas 2D). Read its README, CLAUDE.md, ARCHITECTURE.md, src/utils/constants.ts, src/game/Spawner.ts, src/entities/*, src/assets/sprites/*, src/ui/*. Read-only: port ideas and sprite data, never import from it.
- public/assets/original/ — the painting, the fisherman, the catch sound. Look at the images yourself before planning, and at docs/media/v1/v1-title-screenshot.png.

## What I want
Something that wows players visually and stays true to the original concept: the same painted night river, same fisherman, same 200-lb / 20-lb / one-eel rules, same three fish — with living water, light and weather that tell the story of the run, an improved game loop and fish paths that ramp the challenge in readable patterns, and controls that feel great on both phones (portrait, touch) and desktop browsers (mouse, keyboard, gamepad).

## Non-negotiables
1. Pixel art on a single shared pixel grid. No smoothing, no mixels, locked palette, no PBR/glossy 3D.
2. The scene must still read as the v1 painting. Animate and light it; don't repaint it.
3. No threejs-3d-generator. threejs-image-generator only after I approve a specific asset. Use threejs-audio-generator with my ElevenLabs key (run the credential probe first; it only prints SET/MISSING). Follow CLAUDE.md "Secrets" exactly — the key never appears in a command, file, log, or the browser bundle.
4. Pure, seeded, unit-tested simulation in src/sim/, separate from rendering.
5. Mobile is a first-class target from the first playable, not a final pass.
6. No Jak and Daxter names, characters, dialogue, audio, or art in the game.
7. You own git and GitHub per CLAUDE.md: branches, conventional commits, pushes, PRs, CI. Ask me before merging to main, deploying, changing repo settings/rulesets, or touching DNS/CNAME.

## How to work — gated, and slow where it matters
Use the director's process (design brief → core loop contract → level/encounter plan → representative playable scene → expand → verify), mapped onto these gates. Stop at each ⏸ and wait for me.

**Gate 0 — Plan (we're in plan mode now).**
Read everything above, then present a plan that covers: your design brief and core-loop contract (from REMASTER_BRIEF §2), your reading of the phase script and any changes you'd make with reasons, the module architecture and event flow (sim ↔ render/input/UI/audio), the rendering pipeline (low-res target size candidates, palette extraction, masks, water shader, ripple field, composite pass, upscale), how you'll fit the camera and river spline to the painting, the asset plan (which masks, which sprite sizes and frames, audio list), the test-hook states, the verification plan, and the risks you see. Flag anything in the brief you think is wrong. List any questions for me only if the answer changes what you build. ⏸

**Gate 1 — Look-dev slice (after I approve the plan).**
Scaffold the project with the skills pack scaffold (create_threejs_game.py, --force into this repo), keep CLAUDE.md and docs intact, merge the scaffold's .gitignore with the original one from the first commit (`git diff .gitignore`) so nothing is lost, and add ESLint/Prettier/Vitest/Husky like v1. Then build ONE representative playable scene: the painting on the pixel grid with its palette, the water mask + water shader + ripple field, reeds and neon animated, the lantern light, the net with the new feel on mouse, keyboard and touch, the river spline + dev path editor, and phases 1–3 of the script running from the sim with real bluegill, koi and eel sprites. Do the look-dev A/Bs the art skill asks for (target resolution candidates; flat vs voxel-extruded fish) and capture desktop 1440×900 and mobile 390×844 active-play screenshots for each option. For audio look-dev, generate only a night-river ambience loop and two catch-splash variants with ElevenLabs, wire them in, and listen-check the loop seam; the full batch waits for Gate 2.

GitHub and safety rails, also in Gate 1:
- `gh auth status`, then create the public repo `neon-river-remastered` with `gh repo create` and push `main` (the kickoff commit).
- Do all Gate 1 work on branch `gate-1/look-dev`; push and open a draft PR.
- Wire `scripts/check-secrets.mjs` into the Husky pre-commit (`--staged`), a `postbuild` script (`--dir dist`), and `npm run check`.
- Add GitHub Actions CI (lint, typecheck, unit tests, build, `check-secrets --tracked`, Playwright smoke) and get it green on the PR.
- Propose (and wait for my approval of the `gh api` call) a ruleset on `main`: require PR, require the CI check, block force-push and deletion. Confirm secret scanning push protection is on.

Before reporting: commit, then run the fresh-eyes-reviewer agent on the slice and fix its blockers/majors. Write artifacts/game-progress.md and the first docs/devlog.md entry with before/after media. Then show me the screenshots, your recommendation, the reviewer's verdict, the PR link, and a 5-line summary of how it plays. ⏸

Don't start Gate 2 until I've approved the look.

## See and play it yourself
Run the game, don't just compile it: start the dev server in the background, drive it through the test hooks and the canvas inspector, and use the Playwright MCP browser (if connected) to actually play — move the net, catch fish, hit an eel, pause, retry — on desktop and mobile viewports. Look at the screenshots before you judge anything.

## Reporting
Say what you ran and what you saw. If you couldn't run something, say so. Keep the final message of each gate short: outcome first, then screenshots/paths, then decisions you need from me.
