# Neon River — Remaster Brief

Owner: Kyle Hesse (kahdev.me) · Status: approved direction, numbers are starting points

## 0. One sentence

The same quiet night on the same river, with the same fisherman and the same
200-lb challenge — but the water is alive, the night tells the story of the
run, and the fish move in readable, escalating patterns that reward mastery.

## 1. What must not change (the concept)

- **Pixel-art painting as the world, stylized toon-lit 3D actors.** The painted
  night is drawn crisp (nearest filtering, whole multiples of its native pitch).
  The things you play with — water, fish, eels, net, lantern, basket — are
  crafted, toon-lit 3D objects living inside it, lit by its moon, lantern and
  neon. HD-2D, flipped. No photoreal glossy PBR. Three.js is the renderer; the
  painting is still the identity.
- **The painting.** `background.png` and `fisherman.png` are the scene. The
  composition (portrait, river winding from the neon city to the stone bridge,
  fisherman bottom-right in his straw hat) stays. We animate and light it; we do
  not replace it.
- **Mood.** Moonlit, peaceful yet mysterious. Edo Japan × Studio Ghibli ×
  Blade Runner. Calm by default; tension comes from the fish, not from noise.
- **Rules.** Catch 200 lb to win. Let 20 lb escape and you lose. Catch one
  electric eel and you lose instantly. Bluegill = 1 lb, Golden Koi = 5 lb.
  Net moves on one axis.
- **Cast.** Exactly three river entities: Bluegill, Golden Koi, Electric Eel.
  Difficulty comes from patterns, not new enemy types.
- **No Jak and Daxter IP** in the game. Homage through mechanics only.
- **Plays great on phones (portrait) and desktop browsers.**

## 2. Player promise and loop

**Fantasy:** a calm, skilled fisherman reading the river.

**Core loop contract:** The player slides the net to trace the chain of fish
flowing down the river, to reach 200 lb, while the emitter's sweep, density,
speed, and eels create risk; each catch adds weight and builds a streak; each
miss spends the 20-lb budget; an eel ends the night. Restart is one tap.

- Every 1–3 s: pick the next fish in the chain, slide, scoop.
- Every ~30 s: a speed-up, announced without a pause (stinger, sign, current
  streaks); the last stage swaps banks.
- Across ~2:15: the night changes (rain, storm, moonrise) as the run
  escalates; the basket and HUD both show progress toward 200.
- A better player: reads the chain early, lets low-value fish go during
  zigzags, threads between eels for koi, keeps long streaks.

## 3. Fish paths and the ramp (the gameplay heart)

Read `ORIGINAL_FISHING_DESIGN.md` first. Implement:

### 3.1 River spline
- Replace v1's single cubic bezier with a **Catmull-Rom spline fitted to the
  painted river**, running from the far bend near the city (fish enter small
  and distant) down to the net zone at the bridge. Fish travel the *actual*
  meander.
- The river has a **width function along the spline**, derived from the water
  mask, so a lane value always lands on water, never grass.
- Fish positions live in a **world-space water plane**; the camera's
  perspective (matched to the painting) produces distance scaling. No fake
  `scale = 0.8 + t * 0.3`.
- Provide a **dev-only path editor** (lil-gui + overlay, gated out of prod) to
  drag control points and widths over the painting and export JSON.

### 3.2 Emitter and lanes
- One (later two) **sweeping emitters** with `sweep`, `swingMin/Max`,
  `period`, `travelTime`, `eelChance`, `koiChance`, `pinned: 'left'|'right'|null`.
- Fish **hold their lane** (the swim animation bends the tail, not the
  position). Chains must be readable.
- **Fairness guards:** see §3.3 for the current rules and numbers; prove
  winnability with the oracle bot (§9).
- **Telegraphs:** the emitter's lane shows a faint shimmer/ripple at the far
  bend; eels announce ~0.6 s early with a crackle sound and a blue under-glow
  at the emitter.

### 3.3 Pace — "One Night on the River": four stages, three speed-ups

A fun side-to-side dance, like the original: one emitter sweeps the river and
lays down a chain of fish that the net follows. Spawning never pauses. All
numbers live in `src/sim/config.ts`; tune with the playtester and the dev
`?tune` panel, and record changes in `artifacts/game-progress.md`.

**Stage 1, Still Water.** The emitter sweeps bank to bank as a smooth sine
(eased, no jitter, no reversals), so a steady chain of mostly 1-lb fish draws
a flowing S-curve. Koi ~8%. Eels rare (~5%) and at least five fish apart.

**Speed-ups 1, 2, 3.** The game speeds up three distinct times, at 40 / 90 /
140 lb caught, or at 0:35 / 1:05 / 1:35 if the player is behind. Each one
raises fish speed by 12% (the whole river's current picks up, so the chain
keeps its spacing), shortens the spawn period, speeds the sweep, and adds
randomness: swings that stop short and sudden mid-river reversals. Each is
announced by a short stinger, the stage's sign, and quiet
streaks of current down the river (no neon surge and no flash: Kyle found
them distracting). **Spawning never pauses for an announcement.**

**Stage 4, Bank to Bank** (after speed-up 3, until 200 lb). Fish and eels
swap sides: a burst of 2–4 pinned at one bank, then immediately the other
bank, mixed with fast zigzags and eels dropped into the chain.

| # | Stage (sign) | Fish speed | Mean gap between runs | S-run: fish, gaps | Bank-to-bank sweep (run) | Reversals | Eel roll / spacing | Koi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Still Water | ×1 (3.0 s far bend → net) | 1.02 s | 8–10, 0.50 → 0.38 s, no eels | 4.0 s (2.6 s) | none | 6.7% / 5 fish | 8% |
| 2 | Quickening | ×1.12 | 0.88 s | 9–11, 0.46 → 0.34 s, eel 5% | 3.0 s (2.3 s) | 0.12 /s | 22% / 2 fish | 8% |
| 3 | Neon Rapids | ×1.25 | 0.76 s | 10–12, 0.42 → 0.31 s, eel 9% | 1.8 s (2.0 s) | 0.30 /s | 40% / 1 fish | 8% |
| 4 | Bank to Bank | ×1.40 | 0.56 s | 10–13, 0.38 → 0.29 s, eel 12% | 1.15 s (1.8 s) | 0.40 /s | 50% / none | 7% |

**The stream is never evenly spaced.** Two rhythms alternate:

- **S-runs.** A tight chain of 1-lb fish snaking bank to bank, like the
  original's stream: the gaps between its fish shrink and its sweep quickens
  as it goes. One arrives with every speed-up, so the current is picking up
  while the player is catching it, and runs recur every 15–22 s (about eight a
  night, roughly 80 of the night's fish). From Quickening on, an eel may be
  planted in the S to steer around (never its first two fish or its last).
- **Between runs** the gaps wander: each is the stage's mean gap times a
  random 0.7–1.3, with koi and eels in the mix. An eel always keeps at least
  0.38 s from its neighbours in time.

- **No down time:** no rests and no separate phases; at the shipped pace a
  spawn is never skipped, so the longest gap without a spawn is 1.3 × the stage's mean gap (1.33 s in Still Water, 0.73 s in Bank to Bank); a fish is
  nearly always in the half of the river nearest the net (the lulls are the
  water between S-runs). A night starts with the
  river already running: the first fish reaches the net at about 1.5 s.
- **Smoothness:** a fish never changes lane after it spawns; every fish
  spawns exactly on the emitter (the fairness guards that can move or drop a
  spawn never fire at the shipped pace, only when `?tune` pushes it); the swim animation
  keeps the head on its lane (the tail works, the body does not wander); the
  chain reads as a curve. The only jump is Bank to Bank's swap, which is the
  pattern.
- **Pace targets for a solid player:** speed-ups near 0:30 / 1:00 / 1:30 and
  200 lb in about 2:00–2:30.
- **Why the stream is not dense all night:** only 20 lb may escape, so the
  weight spawned by any moment is, within 20 lb, the weight a winner has caught
  by then. A 2:00–2:30 win fixes the supply at about 1.5 lb/s. The S-runs spend
  that budget in bursts (2–3.5 fish a second while one lasts); the water
  between them is sparser to pay for it.
- **Fairness:** every eel is warned 0.6 s before it appears, and the warning
  is called off if the eel will not come; while sweeping, a non-eel is never
  further from the last one than half of what the capped net can cover in the
  time between them; eels and fish arriving within 0.35 s are at least 0.4
  widths apart; eel hitbox radius 0.032 widths; the oracle bot wins every seed
  without touching an eel (§9).
- **Assist ("the river calms")** and **Endless "Hard River"** are unchanged in
  intent and are Gate 2.

### 3.3a Game modes

Chosen on the title screen (a button that cycles), saved, and defined in
`src/sim/modes.ts` as a name plus a function over the base tuning, so adding a
mode is adding an entry.

- **Normal:** the night described above.
- **Zen:** the same river, runs and speed-ups with no eels. An eel's place in
  the stream is left empty (never two in a row), so the catch and the pace stay
  close to Normal's. The 200-lb goal and the 20-lb escape rule still apply.
- More modes later (Hard River, timed, endless) plug into the same list.

### 3.4 Net feel
- Net moves along a 1-D rail across the river at the catch zone, drawn as a
  pole pivoting from the fisherman's hands, dipping into the water.
- Physics: velocity + damping + **speed cap** (start: cap 2.2 widths/s,
  accel 18, damping 14). Same cap for every input so no device is advantaged.
- **Desktop:** mouse X sets a target; a critically damped follower obeys the cap.
  Keyboard A/D and ←/→ use acceleration. **Gamepad** left stick (analog,
  deadzone), Start pauses.
- **Touch:** **relative drag** anywhere in the lower ~60% of the screen moves
  the net by finger delta (sensitivity setting). The finger never covers the
  net. "Absolute" mode as a setting. No scroll, no zoom, no long-press menu.
- All motion is delta-time based (v1's per-frame lerp is not).

### 3.5 Catching and feedback
- Circle test in water-plane space: `dist < netRadius + fishRadius`. Fish
  hitbox slightly generous, eel hitbox slightly forgiving (≈85% of visual).
- Scoop: fish slows, snaps toward net lane, shrinks into the net; splash, ripple
  ring, and a small weight pop (+1 / +5) that rises and fades at the catch
  point. The score tablet does not light up or pulse. Nothing flies across
  the screen.
- **Catch sound:** a clean splash and a soft, short chime on the tonic or the
  fifth, which cannot clash with the music bed. **Fish Notes** (off by
  default, a setting): consecutive catches play the leitmotif's catch melody
  in D *hirajōshi* on the chosen instrument; a koi plays a chord; a miss
  answers with a low phrase. Nothing sounds when a fish spawns or passes.
- **Near-miss eel:** sparks + crackle when an eel passes within a small margin.
- **Eel catch:** hit-stop (~120 ms), the river goes dark, neon city flickers
  out, the eel's lightning arcs up the pole, fisherman jolts, screen to results.
- **Miss:** fish flicks its tail past the net and vanishes under the bridge;
  escaped meter notches; fisherman reacts when within 6 lb of failing.
- Fisherman speech bubbles (pixel font, original lines, rate-limited like the
  original): big fish spotted, steady, slipping, almost there, win, loss.

## 4. Visual direction — "the painting, in 3D" (art direction v2)

`.claude/skills/neon-river-art-direction/SKILL.md` (v2) is the rulebook. v1 of
this section locked everything to one 216×387 pixel grid with flat sprites; Kyle
found that faithful but too flat and low-res. v2:

1. **Two layers.** The painting is the world: crisp, nearest-filtered, at an
   integer multiple of its native pitch (≈216×387), split by masks into depth
   layers (sky/city, hills and banks, reeds, bridge) that shift slightly for
   parallax. Actors and water render at high resolution on top (A/B device
   resolution against a 3×-pitch target; pick by phone screenshot).
2. **The river is a real surface** fitted to the water mask and spline: flow
   normals, Fresnel, stepped moon glints, reflections of the skyline and neon,
   refraction of the painted bed, depth absorption, bank foam, the GPU ripple
   height-field, wakes.
3. **Fish and eels are procedural toon-lit 3D** (built in code, no external 3D
   generation): spine-wave swim, fins, koi gleam, eel bioluminescence and arcs.
   They sit under the water with continuous depth fog and rise smoothly toward
   the surface near the net. They never pop, and never outshine the water's
   brightest glints unless caught.
4. **The net is a 3D hero prop:** lacquered bamboo pole, glowing cyber hinge,
   hoop, cloth net that sags, bulges and drips; a scoop-and-lift catch tipped
   into a woven **basket that fills toward 200 lb** (diegetic progress).
5. **Light from places you can see:** cool moon key, warm swinging paper
   lantern, cyan eel lights, magenta/teal neon fill, lightning in the storm.
   The painted fisherman stays, lit with a normal map derived from his sprite.
6. **Post (≤ 2 passes on mobile):** selective bloom (neon, eels, lantern, koi
   gleam, fireflies), a palette grade with a strength value (not a hard
   quantize), vignette.
7. **VFX:** splashes, ripple rings, wakes, rain, sparks and arcs, fireflies,
   floating lanterns on win, the neon blackout on an eel loss. Pooled.
8. **The night is the progress bar:** phases change weather and light (§3.3).
9. **UI stays pixel art** (crisp pixel font on authored panels). That contrast
   with the 3D actors is intended.
10. **Wide screens:** the portrait scene stays the playfield; gutters extend the
    night.

Accessibility: reduced-motion (no shake, no parallax), reduce-flashing
(lightning ≤ 1 flash/s, softened), eels distinguished by silhouette, motion,
light and sound — never color alone.

## 5. UI

- Fonts: a self-hosted OFL pixel font (try DotGothic16 for the Edo flavor,
  Silkscreen or Pixelify Sans as fallbacks). Crisp at every size.
- **HUD:** keep v1's "stone tablet" idea: carved tablet with caught-weight
  progress toward 200 and an escaped budget of 20 notches; streak badge; phase
  banner as a hanging wooden sign at the start and at each speed-up. Never over the river's play path.
- Screens: Title (painting + logo, "tap to fish"), Pause, Settings (music, SFX,
  mute, touch mode, sensitivity, assist, reduced motion, reduce flashing), Win
  (time, accuracy, best streak, rating, floating lanterns), Loss (eel / escaped
  variants), Hard River unlocked toast.
- Safe areas (notches, home indicator), 44 px minimum touch targets, keyboard
  focus states, pause on tab hidden / blur, orientation guidance on phones held
  landscape.
- Persist best time, best streak, unlocks, settings in localStorage (try/catch).

## 6. Audio

- Web Audio, unlocked on first gesture (v1's lesson: <20 ms latency).
- Keep `water_net.wav` (Freesound, by nilbul) layered into the catch; keep its
  attribution in CREDITS.md.
- Procedural fallback for everything else: Karplus-Strong pluck for the streak
  scale, filtered noise for river/rain, crackle for eels, thunder rumble.
- If `ELEVENLABS_API_KEY` is set: night ambience loop (river, crickets, distant
  city hum), a calm koto-and-synth music loop with a storm-intensity layer,
  splash variants, koi chime, eel crackle and zap, phase stinger, win and loss
  cues. Never put keys in client code.
- Music and SFX buses with volume, ducking on banners, pause cleanup.

## 7. Technical shape

- Vite + TypeScript (strict) + three.js, starting from the skills pack scaffold.
- **Pure simulation core** (`src/sim/`): phase director, emitters, lanes,
  spline math, catch tests, scoring, assist, seeded RNG. No three.js imports.
  Fully unit-tested with Vitest across many seeds.
- Rendering, input, UI, audio subscribe to sim events.
- Scaffold's `__THREE_GAME_TEST_HOOKS__` with real states: `title`,
  `active-play`, `phase:<id>` for each stage, `speed-up` (`rest` is kept as
  an alias), `win`, `loss-eel`, `loss-escaped`, `pause`, `settings`.
- Keep v1 quality tooling: ESLint, Prettier, Husky pre-commit, GitHub Actions
  CI (lint, typecheck, unit tests, build) and Pages deploy.
- Budgets (v2): 60 fps on a mid-range phone; ≤ 100 draw calls mobile / 200
  desktop; ≤ 2 post passes on mobile; initial download ≤ 4 MB before audio.
- Optional: web app manifest (portrait, fullscreen) for add-to-home-screen.

## 8. Non-goals for this release

New enemy types, story mode, online leaderboards, externally generated 3D
models (Tripo etc.), photoreal glossy PBR, landscape-only redesign,
monetization, CRT/scanline filters by default. Procedural stylized 3D built in
code is in scope.

## 9. Proof of done

- Unit: sim invariants on 200+ seeds (lanes stay on water, fairness guards,
  phase timing, win/lose math, assist stacking).
- **Oracle bot:** a planner with perfect information but the real net speed cap
  must reach 200 lb with zero eels on every test seed (proves winnability).
- **Human-like bot:** reaction delay 220 ms, aim noise, same speed cap; report
  median time to 200, win rate, stage of first loss, and the pace curve (lb vs
  time) with the three speed-ups marked. Targets: win rate 35–60%; speed-ups
  near 0:30 / 1:00 / 1:30; 200 lb in 2:00–2:30; first fish at the net within
  ~2 s.
- **Audio by measurement:** Playwright clicks every `?audition` button and
  triggers the in-game start sting, catch, eel shock and win fanfare; an
  AnalyserNode on the final output must report non-silent RMS for each.
- Playwright smoke + visual captures for all hook states on desktop (1440×900)
  and mobile (390×844), the canvas inspector manifest, renderer diagnostics.
- Real-input checks: mouse, keyboard, touch drag (emulated), gamepad (if
  testable), pause/resume, retry.
- Art-direction checklist from the project skill passes; scorecard filled with
  pixel-art equivalents.
- `docs/devlog.md` and before/after media ready for Kyle's blog post.
