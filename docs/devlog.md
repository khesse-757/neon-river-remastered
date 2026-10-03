# Devlog — Neon River Remaster

Notes for the "rebuilding Neon River" blog post. Newest entries at the bottom.

## 2026-10-02 — Kickoff

- Starting point: v1 (Canvas 2D, TypeScript, Vite) @ f6651c0 — screenshot in docs/media/v1/.
- Tooling: Claude Code + threejs-game-skills @ 8286774, plus a project
  pixel-art direction skill.
- Research finding: the original minigame spawns every fish from one sweeping
  emitter and scripts the run as timed phases with rests
  (docs/design/ORIGINAL_FISHING_DESIGN.md).

## 2026-10-02 — Gate 1: the look-dev slice

**What exists now:** one playable scene. The v1 painting, re-quantized onto a
single pixel grid, with moving water, swaying reeds, flickering neon, a lantern,
the fisherman, a net you can move with mouse / keys / touch / gamepad, and
phases 1–3 of the script spawning real bluegill, koi and eels from a pure,
seeded simulation.

Media: `docs/media/gate-1/` — `before-after-v1-vs-gate1.png`,
`sheet-grid-desktop.png`, `sheet-grid-mobile.png`, and the individual
`grid-*` and `fish-*` captures.

### Numbers

- Painting: 768×1376, 224,459 unique colors, 2.2 MB → 216×387, 48 colors, 108 kB.
- The painting's "pixels" are 3.56 px wide (measured with an FFT of edge
  positions). None of the three resolutions in the brief matched that; 216×387
  does, so it became a fourth candidate and the default.
- 18–34 draw calls a frame. Zero off-palette texels in the final frame.
- 20 unit tests on the sim, several over 200 seeds.

### Things the brief got wrong (found by doing the arithmetic)

- With accel 18 and damping 14 applied together, keyboard tops out at
  18/14 = 1.29 widths/s, far under the 2.2 cap that the mouse reaches. Damping
  now only applies when there is no input.
- The phase table spawns ~220 lb in the first 99 s, and you can only lose 20 lb,
  so every winner finishes around 1:45 — not the 2.5–3.5 minutes the brief
  targets. To be settled with the bots in Gate 2.
- There is no lantern in the painting. I drew a small one.

### Dead ends and surprises

- **Automatic palettes eat the neon.** A plain median-cut to 40 colors turned
  the magenta reflections beige. Fix: weight k-means by saturation and reserve
  slots by hand.
- **A vignette turned the moon pink.** Multiply a pale blue by 0.82, snap to the
  nearest palette color, and the nearest one was a pink. Removed the vignette.
  Same trap with dimming for menus: multiplying toward black walked the cobbles
  through green and purple. Dimming now mixes toward the darkest night blue.
- **Correct perspective made a bad game.** With the camera matched to the
  painting, a fish moving at constant world speed spends half its trip as a
  two-pixel speck at the far bend and then rushes the net. Fish progress now
  blends 60% screen-uniform with 40% world-uniform motion.
- **Blue fish on blue water.** v1's bluegill colors vanish against the night
  river; lifted two palette steps. Eels were worse (dark on dark) and now carry
  a teal electric outline plus a cold light on the water.
- **DOM text is never on the grid.** The first menus used the pixel font in
  HTML. It was anti-aliased and sat between game pixels. All text is now
  rasterized at the font's native size and drawn inside the low-res frame; the
  DOM only holds invisible buttons for focus and screen readers.
- **Voxel fish lost the A/B.** Extruding each sprite pixel into a cube and
  rendering through the same grid turns small fish into smears; flat sprites
  keep their silhouette.
- **Everything drawn with a flipped Y was invisible** for one build: the quads
  were back-face culled. The net showed up because it was a full-screen pass.
- The ripple simulation was planned in river space. The near half of the screen
  is only 9% of the river's length, so it had no resolution where it mattered;
  moved to screen space with squashed rings.

### What I could not do

- Hear the audio. The ambience loop's seam is measured (no padding, wrap jump an
  order of magnitude under a normal sample step), not listened to.
- Test on a real phone or Safari.

### The independent review found what I had stopped seeing

A reviewer agent ran the build cold in its own worktree and came back with
"needs fixes": the HUD numbers were off-screen on a 1536×864 laptop, pause and
mute overlapped on a phone, there was no safe-area handling, bluegill were
nearly invisible for two-thirds of the river, and one of my test hooks
(`loss-escaped`) had never actually shown the loss screen — so a capture I had
counted as evidence was just a picture of normal play. All fixed; the two loss
hooks now throw if they don't reach the state they claim. Still open: at the
far bend the river is three pixels wide, so you cannot read which lane a fish
is in until it is a quarter of the way down.

## 2026-10-03 — Gate 1.5: the art pivot ("the painting, in 3D")

Kyle's verdict on Gate 1: the infrastructure is good, the look is not. It was
faithful but flat and low-res. I had followed the rule "every pixel on one
grid" to the letter and delivered exactly that: a 216×387 picture with flat
sprites on it. What he wanted was an _impression_ of the original with fish,
river and net that read as 3D. The art-direction skill was rewritten (v2) and
the renderer with it. The sim, input, tests and UI did not change at all, which
is the argument for keeping the simulation pure.

Media: `docs/media/gate-1.5/` — `v1-vs-gate1-vs-gate1.5.png`,
`active-play-desktop.webm`, `active-play-mobile.webm`, `koi-scoop-*`,
`eel-near-*`, `early-phase-*`, `rest-banner-*`,
`sheet-actors-device-vs-3x-mobile.png`.

### What changed

- The painting stays pixel art, but everything you play with is now a toon-lit
  3D object: procedural fish (300–500 triangles each, swimming with a spine wave
  in the vertex shader), a net with a cloth bowl, a glowing hinge and a bamboo
  pole, a swinging paper lantern that is a real point light, and a basket that
  fills as you catch — the progress bar is now an object in the world.
- The river is a real surface: Fresnel reflections that follow the mirrored
  view ray out to the painted skyline, stepped moon glints, foam along a
  distance field of the banks, and the painted river bed refracting underneath.
- Fish sink into depth fog and rise smoothly toward the net. In Gate 1 they
  popped from "tinted" to "plain sprite"; that was Kyle's first playtest note.
- Bloom on neon, eels, lantern and the hinge; a palette grade at 18% strength
  instead of the hard 48-color quantize.

### Numbers

- Gate 1: 18–37 draw calls, 0 triangles that mattered. Gate 1.5: ≤ 70 draw
  calls, ≤ 5.4k triangles, 58–59 fps at phone resolution on a desktop GPU.
- Whole renderer rewrite: about 2,000 lines replaced; 0 lines of `src/sim`.

### Audio

- The streak tune used to climb a scale and then sit on its top note. It is now
  a composed 32-step melody (call and answer) with a 32-step variation, in the
  key of the music, snapped to the music's eighth notes when a catch lands
  within 40 ms of one.
- I measured the generated music instead of trusting the prompt: 80 BPM and
  D-centred as asked, but the file was 48.065 s and the loop point clicked
  (the sample jump across the wrap was four times a normal step). Trimmed to
  exactly 64 beats and added 20 ms fades.
- The generated "D4" koto note is actually 307.8 Hz (between D and E-flat).
  The melody repitches from the measured value, not the requested one.
- The ambience came out of the generator at −33 LUFS; the splashes peaked at
  −14 and −10 dBFS. Everything is now normalized offline by a script.

### Surprises

- The first v2 frame worked. The hard part had been done in Gate 1: the camera
  fitted to the painting meant a real 3D net, placed in world units, landed on
  the painted river at the right size on the first try.
- A broad `pkill` to stop my dev server also killed the Playwright MCP server.
  New rule: stop only the PIDs you started.

### Still can't do

- Hear any of it, or run it on a real phone. Frame rates are from a desktop GPU.

### Review round (Gate 1.5)

The reviewer measured what I had only eyeballed: bluegill contrast against the
water was within ±15 luma levels even right at the net. I had over-corrected
Kyle's "fish are too bright" note into "fish are invisible". It also caught the
3D lantern hanging directly over the spot where fish are caught, a basket whose
"heap of fish" looked like a bucket of water, and pause-screen sliders that
could not be heard (pausing suspended the audio) or used with arrow keys (the
game's own key handler ate them). The resolution A/B flipped too: rendering the
3D layer at 3 px per painted pixel looked bad with a nearest upscale, and fine
with a sharp-bilinear one — so the cheaper option is now the default.

## 2026-10-03 — Gate 1.5, round 2: pace, a hook, and a win worth chasing

Kyle played it: right look, too slow for too long, and the catch tune was "thin".

### Pace: the arithmetic that sets everything

- Before: first fish reached the net at 6.7 s (2 s rest + first spawn + 4.2 s
  swim). After: 1.65 s, because the river starts with fish already in it.
- Rests went from 2 s to 0.75 s, travel from 4.2 s to a ramp of 3.0 → 1.9 s.
- The surprise: measured in pounds, the old build was already _on_ Kyle's pace
  targets (53 lb at 0:40, 104 at 1:15). It felt slow because of dead time and
  slow fish, not because weight arrived slowly.
- Kyle asked for a spawn period of 0.28 s by the end. It can't be done with the
  other rules: only 20 lb may escape, so a winner has caught nearly everything
  that spawned, so the target "200 lb at 2:15" fixes how much may spawn — about
  1.55 lb/s. More catchable fish just ends the night sooner. A test run at
  0.28 s dropped the human-like bot's win rate from 61% to 3.5%. The honest
  levers are speed, sweep, and eels (they weigh nothing). The table stops at
  0.42 s and 46–66% eels late; there is a `?tune` panel to feel the alternative.

### Bots found my bugs, and I found theirs

- The oracle bot now wins 100 of 100 seeds without touching an eel.
- My first "human-like" bot lost every single run to eels. The cause was mine:
  when boxed in it "fled" to the nearer edge of the eel's lane, which was
  sometimes _across_ the eel. A second bug: it aimed for the very edge of the
  catch radius to save travel, so 3% aim noise turned catches into misses.
- An attempt to make the planner smarter (fall back to tighter margins, follow
  its own best path) made it oscillate between two plans and die more. Reverted.

### The melody

- Three original motifs to choose from, each stated by a start sting, quoted by
  the phase stinger, turned into a fanfare for the win and sunk to the low
  tonic for a loss. Since I can't hear, there is an `?audition` page.
- Reviewer catch: the very first sting played before the koto sample had
  decoded, so the first thing a player heard was the fallback synth.

### The win

- First version was thin next to the eel shock (the reviewer's words). The
  "paper lanterns" were yellow dots, and koi leaping in celebration froze in
  mid-air when the results card appeared. Now: a gold wash, pixel-art lanterns,
  bigger fireworks, a cheering fisherman, and effects that carry on behind the
  card.

Media: `docs/media/gate-1.5/` — `full-run-desktop.webm`, `full-run-mobile.webm`
(a whole bot-played night to the win), `eel-basket-*.webm`, `win-*`,
`win-results-*`, `eel-basket-*`, `eel-storm-*`, `title-settings-*`.
