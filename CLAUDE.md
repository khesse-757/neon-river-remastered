# CLAUDE.md — Neon River (Remaster)

A pixel-art-world arcade fishing game with stylized 3D actors, inspired by the Jak and Daxter fishing
minigame, rebuilt on three.js. Catch 200 lb, let no more than 20 lb escape,
never net an electric eel. Plays on phones (portrait) and desktop browsers.

## Read before working

1. `docs/design/REMASTER_BRIEF.md` — what we're building and why (source of truth)
2. `docs/design/ORIGINAL_FISHING_DESIGN.md` — how the original minigame's fish
   patterns and pacing work
3. `.claude/skills/neon-river-art-direction/SKILL.md` — art direction v2 (painted
   pixel world + toon-lit 3D actors); overrides the threejs-* skills where they conflict
4. `artifacts/game-progress.md` — current state, decisions, next actions
5. `reference/original/` — Neon River v1 (Canvas 2D). Read-only reference.
   Port ideas and sprite data from it; never import from it.

## Skills

Use `threejs-game-director` for broad work; it routes to the threejs-* specialists
installed in `.claude/skills/`. Always also load `neon-river-art-direction` for
anything visual. Do **not** use `threejs-3d-generator`. Use
`threejs-image-generator` only with Kyle's explicit approval for a specific asset.
`threejs-audio-generator` is allowed when `ELEVENLABS_API_KEY` is set.

## Architecture rules

- TypeScript strict. Vite. three.js via npm (`three/addons/...` for addons).
- `src/sim/` is pure game logic (phases, emitters, lanes, spline, catching,
  scoring, assist). No three.js, DOM, audio, or timers in it. Driven by fixed
  timestep + seeded RNG. Everything else subscribes to sim events.
- No `Math.random()` in gameplay — use the seeded RNG.
- All motion is delta-time based. No per-frame lerps.
- Tuning values live in one typed config (`src/sim/config.ts` + phase table);
  record every tuning change in `artifacts/game-progress.md`.
- Dev tools (path editor, lil-gui, debug overlays, stats) only behind
  `import.meta.env.DEV` or `?debug`; never in the production bundle's default path.
- Keep `__THREE_GAME_TEST_HOOKS__` states real (see brief §7).

## Quality gates (before every commit)

`npm run check` = lint + typecheck + unit tests + secret scan. Playwright/visual
suites run at milestones. Never claim something works without having run it;
say what ran.

## Git and GitHub (you own this)

- Remote: `github.com/khesse-757/neon-river-remastered` (create it with `gh` in
  Gate 1 if it doesn't exist). `main` is protected: changes land by PR with green CI.
- Work on a branch per gate or feature (`gate-1/look-dev`, `feat/eel-storm`,
  `fix/touch-drag`). Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`,
  `test:`, `perf:`), small and per milestone. Push the branch, open or update
  the PR with `gh pr create` / `gh pr edit`, and watch CI with `gh pr checks`.
- **Ask Kyle before:** merging to main, deploying, changing repo settings or
  rulesets, creating releases, touching DNS/CNAME. Never force-push.
- **Commit before delegating to a worktree agent** — worktree agents branch from
  your committed HEAD and cannot see uncommitted changes.

## Secrets

- API keys (ELEVENLABS_API_KEY, optional GEMINI_API_KEY) exist only in Kyle's
  shell environment. Generator scripts read them from env. Never echo, print,
  read, pass (`--api-key`), log, or write them; never read shell profiles or
  `.env` files. `.claude/hooks/guard-secrets.mjs` enforces this.
- Nothing secret ever reaches the browser: no `VITE_*` key variables, no API
  calls from game code to paid services. Audio is generated offline into
  `public/audio/` and committed as files.
- `scripts/check-secrets.mjs` runs on pre-commit (`--staged`), after build
  (`--dir dist`), and in CI (`--tracked`). Keep those hooks wired.
- To check key availability use the probe scripts (they print SET/MISSING only).

## Agents and loops

- `fresh-eyes-reviewer` (own worktree): run at the end of every gate and after
  big changes, before telling Kyle something is done. Fix blockers/majors.
- `playtester` (own worktree): run whenever balance-relevant code changes.
- Run the game yourself: start the dev server in the background, drive it with
  the test hooks / canvas inspector or the Playwright MCP browser, and look at
  the screenshots. Stop servers you start.
- Never use broad `pkill`/`killall`; stop only the PIDs you started.
- `.claude/loop.md` is the default `/loop` prompt (CI babysitting + next action).

## Journaling for the blog

Keep `docs/devlog.md` as you go: decisions, dead ends, surprising bugs, numbers
before/after, and save before/after screenshots or short clips to `docs/media/`.
Kyle will turn this into a blog post, so write it plainly and honestly.

## Commands

- `npm run dev` — dev server at http://127.0.0.1:5188 (dev tools + path editor load here, or with `?debug`)
- `npm run build` — typecheck + production build; `postbuild` scans `dist/` for secrets
- `npm run preview` — serve the build at http://127.0.0.1:4188
- `npm run check` — lint + typecheck + unit tests + secret scan of tracked files
- `npm run test` — Vitest suites (`tests/sim/`, `tests/audio/`)
- `npm run test:e2e` — Playwright smoke on desktop + mobile projects (`tests/e2e/`), real input
- `npm run build:scene` — regenerate palette, re-quantized painting, masks, fisherman from the v1 art
  (`scripts/build-scene.mjs` + `scripts/masks.json`); inspect `artifacts/scene-debug/` afterwards
- `node scripts/capture.mjs --out <dir> --state <hook-state> [--query "grid=216x387&fish=voxel"] [--frames N]`
  — captures at exactly 1440×900 and 390×844 through the test hooks (dev server must be running)
- `npm run inspect:canvas -- --manifest artifacts/evidence.json --url http://127.0.0.1:5188 --seed 42`
  — canvas inspector; then `python3 .claude/skills/threejs-game-director/scripts/check_evidence.py . --manifest artifacts/evidence.json`
- Bot playtest: not built yet (Gate 2). `src/sim/bots/tracker.ts` is only a capture/smoke helper.

Hook states (`__THREE_GAME_TEST_HOOKS__.setState`): `title`, `active-play`, `phase:<id>` (also
`phase.<id>`, because the inspector rejects colons), `rest`, `pause`, `koi-scoop`, `eel-near`,
`loss-eel`, `loss-escaped`.
Look-dev URL params: `?actors=3x` (3D layer at 3 px per painting texel instead of device pixels),
`?grid=192x344|216x387|256x459|384x688`, `?ripple=byte`, `?seed=N`.

- `node scripts/record.mjs --url http://127.0.0.1:4188 --out <dir>` — 9 s active-play videos on both
  viewports plus fps / draw-call stats (run against `npm run preview` for performance numbers)
- `node scripts/normalize-audio.mjs` — loudness-normalize `assets-src/audio/*` into `public/audio/` (needs ffmpeg)
