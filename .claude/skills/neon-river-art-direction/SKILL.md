---
name: neon-river-art-direction
description: "Art direction v2 for the Neon River remaster: an HD-2D-style blend of the original pixel-art painting with stylized, toon-lit 3D actors, real water, and cinematic light. Load before ANY visual, shader, model, sprite, VFX, lighting, UI-art, or scorecard work in this repo. Overrides threejs-aaa-graphics-builder defaults where they conflict (photoreal PBR, generic glow polish)."
---

# Neon River — Art Direction v2 ("the painting, in 3D")

v1 of these rules locked everything to the painting's own pixel grid. That was
too literal: Kyle wants an **impression** of the original, enhanced, detailed and
stylized, with fish, river and net that read as **3D**. Use this file; ignore
any memory of the v1 rules.

## The look in one line

The hand-painted pixel night stays as the world; the things you play with —
water, fish, eels, net, lantern — are crafted, toon-lit 3D objects living
inside it, lit by its moon, lantern and neon. Think HD-2D (pixel art meets 3D
light and depth), flipped: pixel-art world, stylized 3D actors.

## Pillars

1. **Recognizably the same place.** Same composition, palette family and mood
   (moonlit, peaceful yet mysterious; Edo Japan × Ghibli × Blade Runner). A v1
   player says "it's Neon River, but alive."
2. **Real depth.** The river has a surface, a depth, and a bed. Fish swim *in*
   it. The net is an object with weight. Light comes from places you can see.
3. **Stylized, not photoreal.** Toon/stepped lighting, rim light, painted or
   pixel-textured surfaces, crisp silhouettes. No glossy realism.
4. **Readable first.** Every visual choice must make the next fish easier to
   read, never harder.

## Rendering

- **Two layers, two resolutions.**
  - *World (the painting):* drawn crisp with nearest filtering at an integer
    multiple of its native pitch (≈216×387). Split into depth layers with the
    masks (sky, city, hills/trees, banks, reeds, bridge) on planes at matching
    depths so a tiny camera drift and lighting give real parallax.
  - *Actors + water:* rendered at **high resolution** (device pixels, DPR capped
    at 2 desktop / 1.5–2 mobile). Look-dev A/B against a 3× pitch target
    (≈648×1161) with nearest upscale; keep whichever reads better on a phone.
- **Shading:** `MeshToonMaterial` or custom toon shaders with a 3–4 step
  gradient ramp (NearestFilter) built from palette colors, plus a rim term
  toward the moon and neon. Pixel-art textures on 3D models (NearestFilter) are
  encouraged: they tie the models to the painting.
- **Lights (real three.js lights on actors and water):** cool moonlight
  directional; warm flickering paper-lantern point light; cyan eel point
  lights; magenta/teal neon fill from the city side; lightning flashes in the
  storm. Shadows: one cheap shadow (net/fish onto the water) or blob shadows on
  the riverbed.
- **Post (≤2 passes on mobile):** selective bloom (neon, eels, lantern, koi
  gleam, fireflies), color grade toward the painting's palette (a LUT or
  palette-blend with a strength value, not a hard quantize), vignette. Optional
  subtle tilt-shift depth of field at the very top and bottom edges only —
  never over the play path.

## The river (hero surface)

- A 3D water surface fitted to the river mask and spline, with: animated
  normals flowing along the spline, Fresnel, moon specular glints (stepped),
  reflections of the skyline and neon (planar/reflection target or sampled
  city layer, distorted by normals), refraction of a riverbed layer, depth
  color absorption (deeper = darker teal), foam lines at banks and around
  reeds, the GPU ripple height-field (fish, net, rain, splashes), wakes.
- Fish are visible **through** the water with continuous depth fog. As a fish
  nears the net it rises smoothly toward the surface: tint, blur and
  brightness change gradually. **No pop** from "under water" to "sprite".

## Fish and eels (procedural 3D, stylized)

- Built in code (no external 3D generation): lathe/extruded bodies ~300–1,200
  triangles, separate fins and tails, eyes. Swim via vertex shader (spine wave
  from head to tail, speed-linked), fin flutter, banking when the lane wiggles.
- Bluegill: blue-green with a dark ear spot, modest, readable at distance.
  Golden Koi: gold/orange with white patches, long flowing fins, a warm gleam
  and occasional sparkle — the valuable one should *look* valuable.
  Electric Eel: long segmented body, dark with bioluminescent cyan stripes,
  crawling arcs between segments, a cold light on the water around it.
- Brightness discipline: under water, fish sit 1–2 value steps below the
  brightest surface glints; only koi gleam and eel light may bloom. Nothing
  white-hot unless caught.
- Far-bend readability: emitter shimmer + a faint wake line, not oversized fish.

## The net and fisherman (the player)

- **Net: a new 3D hero prop.** Lacquered bamboo pole with wrapped bindings, a
  brushed-metal cyber hinge with a glowing teal ring, a hoop, and a cloth net
  (verlet or vertex-shader cloth) that sags, bulges when it catches, and drips
  when lifted. The pole pivots from the fisherman's hands along an arc; the hoop
  dips into the water and makes ripples. Catch = a short scoop-and-lift with the
  fish flopping in the mesh, then tipped into a woven basket beside him.
- **Basket = diegetic progress.** It visibly fills toward 200 lb.
- **Paper lantern:** a 3D lantern hung near the fisherman, gently swinging, the
  warm light source for the bridge, net and nearby water.
- **Fisherman:** keep the painted figure (it's the identity of the piece), but
  light it: generate a normal map from the sprite so the lantern, lightning
  and eel shock light him; subtle breathing; arms aligned to the pole; reactions
  (nod, jolt, slump, triumphant lift).

## VFX

Event-driven and in-palette: splashes with droplets, ripple rings, wakes,
rain streaks and rain rings, sparks and arcs, fireflies, floating paper lanterns
on win, the neon blackout on an eel loss. Pooled; cheap on mobile.

## UI

Pixel font (crisp) on authored panels: the stone tablet, wooden phase sign,
menus. UI stays pixel-art even though actors are 3D; that contrast is intended.

## Budgets (unchanged intent)

60 fps on a mid-range phone, ≤ 100 draw calls mobile / 200 desktop, ≤ 2 post
passes on mobile, initial download ≤ 4 MB before audio. Measure on the
production preview.

## Scorecard translation

| Category | Means here |
| --- | --- |
| Art direction | Painting + 3D actors + light read as one piece; still Neon River |
| Hero/player | Net, hinge, cloth, lantern, basket, fisherman reactions |
| Obstacles/enemies | Eels: silhouette, bioluminescence, arcs, telegraph |
| Rewards/interactables | Bluegill/koi models, swim, scoop, koi gleam |
| World/environment | Water surface/depth/reflections, layered parallax painting, weather |
| Materials/textures | Toon ramps, pixel textures, palette-graded cohesion |
| Lighting/render | Moon, lantern, eel, neon, lightning; grade; bloom discipline |
| VFX/motion | Splash, ripples, wakes, rain, sparks, lanterns — event-driven |
| UI/HUD | Pixel UI crisp, safe-area clean, never over the play path |
| Performance evidence | Phone fps, draw calls, payload, diagnostics |

## Automatic failures

- It no longer reads as the v1 painting / Neon River.
- Fish pop from tinted to bright at the surface, or outshine the water's
  brightest highlights.
- Flat sprites or v1's net assets standing in for the 3D actors.
- Photoreal glossy PBR, or bloom/fog hiding missing form.
- Blurred or obscured play path; UI over the river.
