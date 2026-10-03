# Neon River — Remaster Brief

Owner: Kyle Hesse (kahdev.me) · Status: approved direction, numbers are starting points

## 0. One sentence

The same quiet night on the same river, with the same fisherman and the same
200-lb challenge — but the water is alive, the night tells the story of the
run, and the fish move in readable, escalating patterns that reward mastery.

## 1. What must not change (the concept)

- **Pixel art.** 16-bit-era look. Every pixel on screen lands on one shared
  pixel grid. No smooth/bilinear scaling, no PBR-glossy 3D, no "HD remaster"
  look. Three.js is the renderer, not the art style.
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
- Across 2.5–3.5 min: the night changes (rain, storm, moonrise) as the run
  escalates; the HUD and world both show progress toward 200.
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

### 3.3 Phase script — "One Night on the River"
Starting values. `sweep` in river-widths/s; `travel` = seconds from appearing
at the far bend to the net. Tune with the bot playtest; record changes.

| # | Name (banner) | Length | Sweep | Swing | Period | Travel | Eel | Koi | Teaches | World beat |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Still Water | 10 s | 0.6 | 0.5–2 s | 0.70 | 4.2 s | 0 | 10% | trace the chain | fireflies, calm |
| 2 | First Spark | 10 s | 0.6 | 0.5–2 s | 0.70 | 4.0 s | 20% | 10% | eels exist; first eel gets a gentle highlight | neon flickers |
| 3 | Lantern Koi | 8 s | 3.0 | 0.5–2 s | 0.65 | 3.8 s | 10% | 25% | zigzag; choose the koi | lantern glow swells |
| 4 | Twin Banks | 9 s | pinned, alternating every 3 s | — | 0.60 | 3.8 s | 0 | 25% | long traversals | bonanza sparkle |
| 5 | Rising Tide | 12 s | 0.6 → 1.2 | 0.5–2 s | 0.50 | 3.4 s | 10% | 10% | density | rain begins |
| 6 | Neon Rapids | 12 s | 3.0 | 0.5–2 s | 0.45 | 3.1 s | 10% | 10% | dense zigzag | heavier rain, city reflections sharpen |
| 7 | Eel Storm | 10 s | 3.0 | 0.5–2 s | 0.50 | 3.0 s | 80% | 10% | thread through eels | lightning, thunder |
| 8 | Braided Stream | 12 s | two emitters in counter-phase, 1.0 | 0.5–2 s | 0.50 each | 3.0 s | 10% | 10% | combine weave + choice | storm breaks |
| 9 | Moonrise | until 200 lb | 0.8 | 0.5–2 s | 0.35 | 2.8 s | 10% | 10% | everything | rain stops, moon path on water |

**Weight budget rule:** the script must be budgeted so a *perfect* player
reaches Moonrise with roughly 160–190 lb. Nobody who wins skips the Eel Storm.
(Rough math with the values above: ≈20, 37, 60, 90, 121, 147, 159, 190 lb
cumulative for near-perfect play.) Verify with the oracle bot and retune.

- 2-second **rest** between phases (no spawns, banner + breath).
- If 200 lb is reached early, jump to the win. If Moonrise runs long, it cycles
  phases 6–8 variants.
- Target: a solid player wins in **2.5–3.5 min**; first-time players often lose
  first around phases 6–7 and want to retry.
- **Assist ("the river calms"):** after a loss, next attempt uses a gentler
  table (+15% period, +10% travel, −30% eel), stacking up to 3 times; a win
  resets. On by default, toggle in settings, never shown as a penalty.
- **Endless "Hard River"** unlocked after the first win, or on the title screen
  with ←←→→←←→→ then Enter (swipe pattern on touch). Uses tighter numbers
  (period down to 0.15 s, travel 2.4 s), score = weight caught before 20 lb
  missed or an eel.

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

## 4. Visual direction — "the painting comes alive"

See `.claude/skills/neon-river-art-direction/SKILL.md` for the rules. Features:

1. **One pixel grid.** Render the scene into a low-res target (start ≈256×459,
   evaluate 192×344 and 384×688 in look-dev) and upscale with nearest filtering.
   Re-quantize the background onto that grid so painting, sprites, and VFX
   share one pixel density.
2. **Curated palette.** Extract ~32–48 colors from the painting; final pass
   quantizes with ordered (Bayer) dithering so new light, rain, and glow all
   stay in-palette.
3. **Living water** inside a water mask: flow-aligned scrolling ripples, moonlit
   glints, distorted reflections of the neon skyline, fish **under** the surface
   (refraction wobble + depth tint), a GPU ripple height-field that fish, net,
   rain and splashes disturb, wakes behind fish.
4. **Animated painting** via masks: reeds and cattails sway, tree canopies
   breathe, neon signs flicker, stars twinkle, clouds drift past the moon.
5. **Light:** the paper lantern flickers and lights the bridge and nearby water;
   eels emit a cold electric light on the water; koi have a warm gleam; lightning
   back-lights the skyline in the storm.
6. **Particles:** fireflies, rain streaks + rain rings, splash droplets, sparks,
   floating paper lanterns on win — all pixel-snapped.
7. **Fish:** pixel sprites with 4–6 frame swim cycles plus turn and flail frames,
   authored at 2–3 sizes (far/mid/near) and swapped by projected size so pixels
   never resample. Look-dev also tries voxel-extruded versions of the same
   sprites; pick by screenshot.
8. **Fisherman:** idle breathing, hat tilting toward the net, reactions (nod,
   jolt, slump, triumphant lift) done by deforming the existing sprite.
9. **The night is the progress bar:** phases change weather and light (table
   §3.3). The player feels the ramp before reading the HUD.
10. **Wide screens:** the portrait scene stays the playfield; side gutters show
    a calm extension of the night (stars, distant silhouettes, fireflies,
    vignette) and can host HUD. (Optional, needs Kyle's approval: a Gemini
    outpaint of the painting to 16:9.)

Accessibility: reduced-motion (no shake, no parallax), reduce-flashing
(lightning ≤ 1 flash/s, softened), eels distinguished by silhouette, motion,
sparks, and sound — never color alone.

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
- Budgets: 60 fps on a mid-range phone; ≤ 60 draw calls; one composite post
  pass plus the upscale blit; initial download ≤ 3 MB before audio
  (the re-quantized painting is far smaller than v1's 2.2 MB PNG).
- Optional: web app manifest (portrait, fullscreen) for add-to-home-screen.

## 8. Non-goals for this release

New enemy types, story mode, online leaderboards, 3D-generated models,
landscape-only redesign, monetization, CRT/scanline filters by default.

## 9. Proof of done

- Unit: sim invariants on 200+ seeds (lanes stay on water, fairness guards,
  phase timing, win/lose math, assist stacking).
- **Oracle bot:** a planner with perfect information but the real net speed cap
  must reach 200 lb with zero eels on every test seed (proves winnability).
- **Human-like bot:** reaction delay 220 ms, aim noise, same speed cap; report
  median time to 200, win rate, phase of first loss. Target win rate 35–60%.
- Playwright smoke + visual captures for all hook states on desktop (1440×900)
  and mobile (390×844), the canvas inspector manifest, renderer diagnostics.
- Real-input checks: mouse, keyboard, touch drag (emulated), gamepad (if
  testable), pause/resume, retry.
- Art-direction checklist from the project skill passes; scorecard filled with
  pixel-art equivalents.
- `docs/devlog.md` and before/after media ready for Kyle's blog post.
