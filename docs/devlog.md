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
