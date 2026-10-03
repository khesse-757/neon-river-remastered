# Game Progress — Neon River Remaster

## Intent
See docs/design/REMASTER_BRIEF.md. Pixel art stays; three.js renders it.

## Constraints
- Pixel-art rules: .claude/skills/neon-river-art-direction/SKILL.md
- No 3D generation. Image generation only with Kyle's approval.
- Don't merge/deploy/change repo settings without asking.

## Provenance
- Skills: majidmanzarpour/threejs-game-skills @ 8286774
- v1 reference: khesse-757/neon-river @ f6651c0

## Gate status
- [x] Gate 0 — Design + tech plan approved (2026-10-02)
- [x] Gate 1 — Look-dev slice: merged as the foundation (PR #1, 2026-10-03). Look NOT approved: too flat and low-res.
- [ ] Gate 1.5 — Art direction v2 + audio fixes: built, awaiting Kyle's review (branch `gate-1.5/art-v2`)
- [ ] Gate 2 — Full loop playable
- [ ] Gate 3 — Polish + QA pass
- [ ] Gate 4 — Release candidate

## Gate 1.5 (art direction v2) — decisions
- **Supersedes** the Gate 1 decisions about one 216×387 grid for everything, flat sprites, palette-lock composite, voxel A/B and ripple thresholds. The sim, input, in-canvas pixel UI, hooks and tooling carry over unchanged.
- **Two layers:** the painting is still drawn crisp (nearest, integer multiple of the 216×387 pitch, lit per painted texel). Water surface, fish, net, lantern and basket are shaded per device pixel on top.
- **One HDR frame, fixed draw order:** painting + refracted river bed → fish (3D, depth-fogged) → water surface (Fresnel skyline reflection, stepped moon glints, bank foam, ripple crests, eel/koi light) → land redrawn as an occluder → net and pole → fisherman → lantern, basket, caught fish → particles. Then bloom, then one final pass (vignette, palette grade at 0.18 strength, sRGB). Pixel UI is drawn after post, straight to the screen.
- **Fish:** procedural toon-lit geometry (bluegill ≈ 330 tris, koi ≈ 420, eel ≈ 500), spine wave in the vertex shader, instanced per species. Depth, fog and brightness change together as a smoothstep of progress, so there is no pop; in the net they are lifted clear of the water and flop, then fly to the basket.
- **True perspective sizes.** Fish are no longer oversized at the far bend; a wake line and the emitter light carry the read there (v2 rule).
- **Net:** hoop, cloth bowl with a knotted pixel texture (sways, bulges, drips), cyber hinge whose teal ring brightens with the streak, lacquered bamboo pole to the fisherman's hands. Scoop-and-lift is 0.34 s and cosmetic; the sim's net never leaves the water.
- **Basket = progress:** fills with landed weight / 200 lb.
- **Lights:** hemisphere + moon directional + neon fill directional + lantern point light + up to 3 eel point lights (real three.js lights on MeshToonMaterial). The painting takes the lantern as a stepped per-texel pool; the fisherman is relit with normals derived from his own pixels in the shader.
- **Parallax:** only the far layer (sky + skyline, flood-filled mask) slides, in whole texels, with the net and a slow drift. Sliding the bridge layer would detach it from the 3D props standing on it.
- **Actor resolution A/B:** device pixels (`?actors=device`) vs capped (default: about DPR 2, i.e. 3 px per painting texel on a DPR-3 phone, upscaled by a sharp-bilinear final pass so painting pixels stay even). Recommend **capped**: on the phone crop the two are nearly indistinguishable and capped shades 64% fewer pixels. A plain nearest upscale at 3 px/texel (first attempt) gave uneven painting pixels; the sharp-bilinear filter fixed that.
- **Audio:** 5 buses → master low-cut 80 Hz / −3.5 dB shelf at 8.5 kHz / +1.5 dB at 2.8 kHz → compressor → limiter. Music ducks under banners and the shock. Assets are normalized offline (`scripts/normalize-audio.mjs`): music −16 LUFS, ambience −24 LUFS, one-shots −3 dBFS peak.
- **Streak melody:** composed 32-step call-and-answer in D hirajoshi plus a 32-step variation (64 steps before it repeats), onsets nudged ≤ 40 ms to the music's 8th-note grid, koi chord, layers at 8/16/32, falling resolution on a miss. Voice is a sampled koto pluck (measured at 307.8 Hz) repitched; Karplus-Strong fallback.
- **Music loop:** measured 80 BPM, D-centred; trimmed to exactly 48 s (64 beats); 20 ms edge fades because the raw wrap jumped 4× a normal sample step.

## Gate 1.5 measurements (2026-10-03, production preview, Apple GPU — not a phone)
- Desktop 1440×900: 59.3 fps, p95 17.1 ms. Mobile 390×844 @3, capped (default): 59.4 fps, p95 17.1 ms. Mobile at full device resolution: 57.2 fps. All vsync-bound on a desktop GPU; a mid-range phone is unmeasured.
- Draw calls ≤ 69 in play, 85 on the pause screen (budget 100 mobile / 200 desktop). Triangles ≤ 5.4k. 2 post passes (bloom, final).
- Textures 61–81 vs the inspector's mobile starting budget of 40: every UI label is its own tiny texture. Fix with a glyph atlas in Gate 2.
- First load before audio ≈ 0.8 MB (JS 168 kB gzip, default-grid scene, fonts); audio 1.2 MB. Budget 4 MB. `dist/` also carries files the game never loads (original 2.2 MB painting, three unused grids, source maps) — Gate 4 cleanup.
- Loudness after normalization (reviewer's ffmpeg measurements): music −16.5 LUFS, ambience −24.6 LUFS, SFX peaks −3.0 to −3.7 dBFS, chime −5.6.

## Gate 1.5 fresh-eyes review, round 1 (HEAD 0498a49): "needs fixes" — 0 blockers, 8 majors
Fixed: bluegill readability (lighter paint, less fog, earlier rise, larger, moonlit rim, stronger wakes and emitter light); lantern moved off the catch line onto the deck; basket shows a heap of individual fish instead of a blue dome; HUD moves top-left when there is no gutter (was covering the basket); slider rows spaced for 44 px hit areas; arrow keys work on sliders; paused game keeps music and ambience playing so the mix can be set by ear (hidden tab suspends audio in every mode); 3D layer capped near DPR 2. Minors fixed: fisherman relight no longer blooms, 3D actors dim with the scene, scoop no longer snaps on back-to-back catches, calmer eel wave, hook states count the basket, 26 ms of leading silence trimmed from the music loop.
Not fixed (recorded): net reads as floating at lane 1 and its cloth overlaps the parapet at lane 0; `dispose()` does not free every GPU resource (HMR only); the end-of-run screen steps the sim with a variable delta; no automated test for the sliders or AudioBus.

## Decisions
- **Grid:** default 216×387. The painting's own pixel pitch measures 3.56 px (FFT of edge positions), so 216×387 is the only candidate that does not resample painted pixels. Other three kept behind `?grid=` until Kyle picks.
- **Scaling:** integer only. One step larger is allowed when ≥ 90% of the painting's height still shows (crops sky/cobbles, never width). The low-res target is viewport-sized, so spare space is gutter, not letterbox.
- **Palette:** 48 colors = 32 k-means (saturation-weighted) from the painting + 6 from the fisherman + 10 reserved (koi, eel, lantern amber, white, outline).
- **Camera fit:** pinhole, focal 1100 px, horizon y=150, principal point at the painting centre. With these the painted river unprojects to a near-constant world width (≈0.8 camera heights), so real perspective scaling works.
- **Speed profile 0.6:** fish progress blends world-uniform (40%) and screen-uniform (60%) motion. Pure world speed left fish as specks at the far bend for half the trip.
- **Fish facing:** v1 sprites turned a quarter turn (head down-river). Swim cycle and heading lean are whole-texel row shifts in the shader, quantised to 8 poses; distance uses four authored sizes.
- **Bluegill colors** lifted two palette steps from v1 (blue fish on blue water was unreadable). Eels get a teal electric outline for the same reason.
- **Ripple field** is in painting-grid space (216×387, squashed rings), not river (s, lane) space as planned: the near half of the screen is only ~9% of the river's world length, so river space starved it of resolution.
- **All UI text is drawn in-canvas** (Silkscreen 8 px, DotGothic16 16 px for headings). DOM text was anti-aliased and off-grid. DOM now only holds transparent focusable buttons + a live region.
- **Dimming** (menus, eel shock) mixes toward the darkest night blue with dithering off; multiply-to-black dragged stone and grass through unrelated hues.
- **No vignette:** a stepped multiply turned the moon pink after palette lock.
- **Lantern:** small authored sprite on the parapet (none exists in the painting); warm ramp light that keeps the lit surface's texture.
- **Net damping** applies only with no input (brief flag 2), so keyboard reaches the same 2.2 widths/s cap in the same 0.12 s as pointer/touch. Unit-tested.
- **Hook state names:** `phase:<id>` and `phase.<id>` both accepted (the canvas inspector rejects colons).

## Tuning values (src/sim/config.ts) — unchanged from the brief unless noted
- Phases 1–3 exactly as brief §3.3. Gate 1 loops phases 2–3 after phase 3 (placeholder until Gate 2).
- Net: cap 2.2, accel 18, damping 14 (no-input only), follower gain 14, radius 0.11 widths.
- Radii: bluegill 0.035, koi 0.045, eel 0.0425 (0.05 × 0.85). Near-miss margin 0.06. Scoop 0.28 s.
- Lane margin 0.09 per bank. Telegraph lead 0.6 s. First spawn of a phase after 0.35 s.

## Completed (Gate 1)
- Repo `khesse-757/neon-river-remastered` (public), `main` pushed, branch `gate-1/look-dev`, draft PR #1, CI green.
- Sim: rng, camera, river, net, emitter + fairness, director, catching, scoring; 22 Vitest tests incl. 200-seed invariants.
- Scene build script, masks, palette; pixel pipeline; water; ripple field; sway; neon; lantern; fisherman deformation; particles.
- Input: mouse, keyboard, relative touch, gamepad. Audio bus + 3 generated files + procedural voices.
- Dev tools: lil-gui + path editor (dev or `?debug` only, separate chunk).
- Look-dev captures in docs/media/gate-1/.

## Measurements (2026-10-02, local, Apple GPU, dev server)
- Draw calls: 18–34 per frame (budget 60). Final frame off-palette texels: 0 on every capture.
- Canvas inspector manifest `gate1-pass-1`: 10/10 PASS; `check_evidence.py` passed.
- Mobile texture count 42–54 vs the inspector's starting budget of 40: each UI label is its own tiny texture. Accepted for Gate 1; move text to a glyph atlas in Gate 2.
- JS bundle 583 kB (154 kB gzip) + dev-tools chunk 34 kB (not loaded by default). Scene assets for the default grid ≈ 120 kB.
- Ambience loop seam (measured, not heard): 22.0 s, no leading/trailing silence, wrap jump 0.001 vs typical sample step 0.009, first/last second within 2 dB.

## Pending jobs / task IDs
- None. ElevenLabs: 3 sound-effect generations done (ambience loop, two splashes). Full batch waits for Gate 2.

## Fresh-eyes review (2026-10-02, HEAD 4d1a553): "needs fixes" — 6 majors, 12 minors
Fixed after the review (not re-reviewed by the agent; verified by my own captures, unit tests and e2e):
- HUD tablet clipped when the painting is cropped (1536×864 @1.25, `?grid=256x459` desktop) → placed inside the visible area.
- `loss-escaped` hook never reached the loss screen and often ended by eel → now a net that dodges everything; both loss hooks throw if the state is not reached. The earlier evidence manifest did not include loss-escaped.
- Pause/mute hit areas overlapped → drawn ≥ 44 CSS px, hit area = art, padded in whole texels (focus ring on grid).
- Safe areas → controls and HUD offset by `env(safe-area-inset-*)`. Emulation reports zero insets, so this is untested on a real notch.
- Bluegill readability → silver-blue ramp, brighter small sizes, almost no depth tint.
- Title/pause/loss dimming blotches → dither stays on with the night-blue mix; body text on dark strips; heading glyphs spaced one texel.
- Minors fixed: fresh seed per run unless `?seed=` or the hook pins it; drags made while paused are dropped; newest finger takes over; telegraph glow follows the emitter; eels opening a phase get the full 0.6 s warning; rule text now "don't let 20 lb escape"; quieter fish wakes and lantern slab.
- Tests added: telegraph lead ≥ 0.6 s; eel/fish separation measured at actual rail crossings on 200 seeds; escape loss lands exactly on the 20th pound.

## Known defects / open items
- **Lane is unreadable at the far bend**: the river is ~3 texels wide at spawn and ~18 at 25% of the trip, so the emitter shimmer cannot show a lane there. Needs a design answer in Gate 2 (start the playable path lower, or a lane indicator).
- ~5% of eel telegraphs are false alarms: the fairness guard turns the eel into a bluegill after the warning.
- `paletteReport()` reads the composite target, which can only output palette colors, so it proves the pipeline is wired, not that inputs were in range. DOM focus rings are outside the palette pass.
- Net hoop overhangs the left bank at lane 0. Streak badge can sit on the pole when the HUD is on the cobbles.
- Landscape phones get a 216-px-wide painting and no orientation hint. 320-px-wide phones and 1440×900 only reach ×2.
- Wide-screen gutters are plain night + stars (brief §4.10 is Gate 2).
- Kyle must ear-check the ambience loop and splash levels; I can only measure them.
- Gamepad untested (not available headless). Real phone / Safari untested.
- Eel hitbox/visual and phase balance are untuned (Gate 2, playtester).
- Sourcemaps and `public/assets/original/background.png` ship in `dist/` (Gate 4 cleanup).
- Brief flags 1 and 3 (win time vs table; Braided Stream density) are open until Gate 2.

## Next actions
1. Kyle: review look-dev (grid choice, flat vs voxel fish, lantern), play on a real phone.
2. Kyle: approve or edit the proposed `main` ruleset call.
3. After approval: merge PR #1 (Kyle), start Gate 2 on `gate-2/full-loop`.
