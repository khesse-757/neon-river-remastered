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
- Every 10–20 s: a new phase with a new pattern, announced and breathed into.
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
- Fish **hold their lane** (plus a tiny cosmetic wiggle that does not affect
  the hitbox). Chains must be readable.
- **Fairness guards:** (a) non-eel jump > 0.8 width → midpoint, (b) eel within
  0.35 s of a fish must be ≥ 0.25 width away from it (except in the storm phase
  where spacing is ≥ 0.18), (c) prove winnability with the oracle bot (§9).
- **Telegraphs:** the emitter's lane shows a faint shimmer/ripple at the far
  bend; eels announce ~0.6 s early with a crackle sound and a blue under-glow
  at the emitter.

### 3.3 Pace — "One Night on the River"

The run starts lively and keeps getting faster and harder the whole way. Two
layers set the pace (all numbers live in `src/sim/config.ts`; tune with the
playtester and the dev `?tune` panel, and record changes):

**Continuous ramp.** Progress 0→1 on whichever is further along: elapsed time
over 135 s, or weight caught over 200 lb.

| | Start | End |
| --- | --- | --- |
| Fish travel time (far bend → net) | 3.0 s | 1.9 s |
| Spawn period | 0.62 s | 0.42 s |
| Emitter sweep | 0.8 widths/s | 3.0 widths/s |

**Phases** shape the pattern on top of the ramp with multipliers and the
eel/koi mix. One emitter for now; the second emitter for Braided Stream is Gate 2.

| # | Name (banner) | Length | Sweep × | Period × | Eel | Koi | Pattern |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Still Water | 11 s | 0.8 | 1 | 22% | 3% | trace the chain; first eels |
| 2 | First Spark | 12 s | 1 | 1 | 34% | 4% | eels in the chain |
| 3 | Lantern Koi | 10 s | 1.6 | 1.25 | 28% | 14% | zigzag; choose the koi |
| 4 | Twin Banks | 9 s | pinned, alternating every 3 s | 1.2 | 24% | 8% | long traversals |
| 5 | Rising Tide | 14 s | 1 | 0.92 | 36% | 4% | density |
| 6 | Neon Rapids | 14 s | 1.4 | 1 | 38% | 4% | dense zigzag |
| 7 | Eel Storm | 10 s | 1 | 0.9 | 66% | 10% | thread through eels |
| 8 | Braided Stream | 12 s | 1.3, quick reversals | 0.93 | 50% | 5% | weave |
| 9 | Moonrise | 16 s | 1 | 0.93 | 52% | 6% | everything |

After Moonrise the script loops phases 6–9 until the run ends.

- **No calm opener:** a run starts with fish already in the river; the first one
  reaches the net at about 1.7 s.
- **Rests are 0.75 s**; the phase banner shows for 1.6 s and spawning resumes under it.
- **Pace targets for a solid player:** ~50 lb by 0:40, ~100 lb by 1:15, 200 lb by ~2:15.
- **Why the eel share is high and the period stops at 0.42 s:** only 20 lb may
  escape, so the weight spawned by any moment is, within 20 lb, the weight a
  winner has caught by then. The pace targets therefore fix the spawned weight
  at about 1.4–2 lb/s. Extra liveliness has to come from speed, sweep and eels
  (which weigh nothing), not from more catchable fish. A period of 0.28 s with
  this eel share would spawn roughly twice the target weight.
- **Fairness:** a non-eel may jump at most 40% of what the capped net can cover
  in one spawn period; eels and fish arriving within 0.35 s are at least 0.4
  widths apart; eel hitbox radius 0.032 widths.
- **Assist ("the river calms")** and **Endless "Hard River"** are unchanged in
  intent and are Gate 2.

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
  ring, weight pop (+1 / +5) that flies to the HUD.
- **Streak:** consecutive catches climb a pentatonic scale (Japanese *in* or
  *hirajōshi*) on a plucked-string voice; a koi plays a chord; a miss plays a
  low muted note. The music *is* the feedback.
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
  banner as a hanging wooden sign during rests. Never over the river's play path.
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
  `active-play`, `phase:<name>` for each phase, `rest`, `win`, `loss-eel`,
  `loss-escaped`, `pause`, `settings`.
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
  median time to 200, win rate, phase of first loss, and the pace curve (lb vs
  time). Targets: win rate 35–60%; ~50 lb by 0:40, ~100 lb by 1:15, 200 lb by
  ~2:15; first fish at the net within ~2 s.
- Playwright smoke + visual captures for all hook states on desktop (1440×900)
  and mobile (390×844), the canvas inspector manifest, renderer diagnostics.
- Real-input checks: mouse, keyboard, touch drag (emulated), gamepad (if
  testable), pause/resume, retry.
- Art-direction checklist from the project skill passes; scorecard filled with
  pixel-art equivalents.
- `docs/devlog.md` and before/after media ready for Kyle's blog post.
