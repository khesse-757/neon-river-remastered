---
name: neon-river-art-direction
description: "Pixel-art direction and rendering rules for the Neon River remaster. Load before ANY visual, shader, sprite, VFX, lighting, UI-art, or scorecard work in this repo. Overrides threejs-aaa-graphics-builder defaults wherever they conflict (PBR materials, generated 3D models, high-res detail, glow-heavy polish)."
---

# Neon River — Art Direction (pixel-art overrides)

The threejs-* skills target premium 3D. This project is **premium pixel art**
rendered with three.js. Keep their discipline (authored surfaces, event-driven
VFX, budgets, evidence) and replace their look with the rules below. When a
skill default conflicts with this file, this file wins.

## The look in one line

A hand-painted 16-bit night scene that is quietly alive: water that moves,
light that breathes, fish you read under the surface — and every pixel on the
same grid.

## Source of truth

- `public/assets/original/background.png` (768×1376, AI-painted pseudo-pixel
  art, effective grid ≈3.5–4 px, ~8k colors — not yet palettized).
- `public/assets/original/fisherman.png` (677×369, transparent).
- v1 sprite arrays in `reference/original/src/assets/sprites/` and palettes in
  `reference/original/src/assets/palettes/`.
- Mood: moonlit, peaceful yet mysterious; Edo Japan × Studio Ghibli × Blade Runner.
  Dark, moody base; neon (magenta, teal, cyan) only in the city, its reflections,
  eels, and UI signals; warm amber only for the lantern and koi.

## Hard rules

1. **One pixel grid.** Render the world into a low-res `WebGLRenderTarget`
   (decide the size in look-dev; start ≈256×459) with `NearestFilter`, then blit
   to the screen. Integer upscale when the viewport allows; otherwise nearest
   with the remainder letterboxed. Never `LinearFilter` on art, never CSS
   smoothing (`image-rendering: pixelated` on the canvas).
2. **No mixels.** The painting is re-quantized onto the chosen grid (area
   downsample → palette quantize). Sprites are drawn 1 art-pixel = 1 target
   texel. Perspective size changes are handled by **swapping authored sizes**
   (far/mid/near), not by resampling one sprite.
3. **Locked palette.** Extract 32–48 colors from the painting (k-means or
   median-cut, then hand-curate: keep the neon accents and the lantern amber).
   The final composite pass maps to the palette with a 4×4 Bayer dither anchored
   to the low-res grid. New effects must be drawn in palette colors.
4. **Stable motion.** Screen shake moves in whole target pixels (or uses a 1 px
   margin with a sub-pixel offset applied at the upscale blit). Particles,
   fireflies, rain, sparks: positions snapped to the grid. No shimmering edges
   on static scenery.
5. **Post budget.** One composite pass at target resolution (palette + dither +
   vignette + optional low-res bloom of neon/emissive only) + the upscale blit.
   No SSAO, no SMAA, no film grain, no chromatic aberration except a 2-frame
   glitch on the eel shock. No CRT/scanlines by default.
6. **No PBR, no generated 3D.** No `threejs-3d-generator` / Tripo. Lighting the
   painting means masks, ramps, and palette shifts, not physically based
   materials. `MeshBasicMaterial` / custom `ShaderMaterial` are the defaults.
7. **Glow is a signal.** Bloom/emissive is reserved for: neon signs and their
   reflections, eels and their sparks, the lantern, koi gleam, fireflies, UI
   focus. Never as a fix for empty composition.
8. **The painting stays recognizable.** Side-by-side with v1, a player must see
   the same place. Animate and light it; don't repaint it. Any generated image
   asset (Gemini) needs Kyle's explicit approval first and must be re-quantized
   to the palette and grid.

## Building the living painting

- **Masks** (PNG at target resolution, committed, regenerable by
  `scripts/build-masks.*`): water, reeds/cattails, tree canopies, sky, moon,
  neon emissive, lantern-lit zone, bridge. Generate by color segmentation + seed
  flood fills + hand-placed polygons in a JSON file. Always save a debug overlay
  image per mask and inspect it.
- **Water shader** (masked): flow-aligned scrolling ripple bands (direction from
  the river spline), moon glints quantized to 2–3 palette steps, a distorted
  reflection of the skyline/neon (sample the city region flipped, offset by the
  ripple height-field), depth tint near the banks, rain rings, wakes. Fish render
  *under* the surface: refraction wobble + depth color ramp; a bright surface
  break only when they splash or are caught.
- **Ripple height-field:** small ping-pong render target (e.g., 128×128 in water
  UV space); fish, net dips, rain, and splashes inject impulses; water shader
  reads it for distortion and highlights.
- **Foliage and reeds:** UV/vertex sway inside their masks, slow and
  out-of-phase; stronger in the storm.
- **Neon city:** emissive mask flicker (per-sign noise), brightens with run
  intensity, blacks out on eel loss.
- **Sky:** stars twinkle (palette steps), clouds drift across the moon, moon
  rises subtly across the run; lightning back-lights the skyline in the storm
  (respect reduce-flashing).
- **Lantern:** flickering radial light baked into a light-ramp over the bridge
  and nearby water; warm, in-palette.

## Sprites

- Start from v1's arrays (bluegill 16×12, koi, eel, net). Upgrade to 4–6 frame
  swim cycles, plus turn and caught-flail frames. Eel: undulating body frames +
  2–3 spark overlay frames.
- Author far/mid/near sizes (e.g., 8×6, 12×9, 16×12 for bluegill) with a
  consistent palette ramp; choose by projected size with hysteresis.
- Outline: 1 px dark outline in the deepest palette blue; underwater fish
  drop the outline and take the depth tint.
- Fisherman: deform the existing sprite (breathing, hat tilt, reactions) with a
  vertex-displaced quad or a few cut regions; keep his pixels on the grid.
- Look-dev A/B: also try **voxel-extruded** fish (each sprite pixel → instanced
  cube, lit with 2–3 palette ramps, rendered through the same grid). Keep
  whichever reads better in active-play screenshots at both viewports.

## Readability

- Fish vs eel: different silhouettes, motion (eels undulate, slower travel,
  sparks), light (cold glow), and sound. Never color alone.
- The river's play path (spline ± half width, from far bend to net) is never
  covered by HUD, banners, or speech bubbles.
- At the far bend, fish may be only a few pixels; the emitter shimmer and chain
  rhythm carry readability there.

## Scorecard translation (for threejs-aaa-graphics-builder)

Keep all 10 categories, but score them as:

| Category | Means here |
| --- | --- |
| Art direction | Painting, palette, mood and UI read as one hand-made piece |
| Hero/player | Net + pole + fisherman: silhouette, dip, reactions |
| Obstacles/enemies | Eels: telegraph, silhouette, glow, near-miss sparks |
| Rewards/interactables | Bluegill and koi: swim cycles, scoop, weight pop |
| World/environment | Living painting: water, reeds, trees, neon, sky, weather |
| Materials/textures | Palette discipline, dither quality, no mixels |
| Lighting/render | Lantern, moon, eel light, lightning; grid-stable composite |
| VFX/motion | Ripples, splashes, rain, sparks, fireflies, lanterns — event-driven |
| UI/HUD | Stone tablet, banners, menus in the pixel font, crisp, safe-area clean |
| Performance evidence | Phone 60 fps, draw calls, payload size, diagnostics |

Inspector metrics: a pixel-art frame can legitimately show high edge density
and lower color entropy (palette lock). Explain metrics; never add noise or
clutter to move them.

## Automatic failures (in addition to the scorecard's)

- Any visible smoothing/bilinear blur on art, or mixed pixel sizes.
- Colors outside the palette in the final frame (spot-check by histogram).
- The scene no longer reads as the v1 painting.
- Glossy/PBR-looking objects or smooth-shaded 3D models.
- Shimmering static scenery when the camera is still.
