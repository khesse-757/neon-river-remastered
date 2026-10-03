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
- [ ] Gate 1.5 — Art direction v2 + audio: **look approved by Kyle** (2026-10-03, round-3 notes); round 3 (fish pattern, calmer audio, audition fix, advanced audio) built, awaiting Kyle's review (branch `gate-1.5/art-v2`, PR #2)
- [ ] Gate 2 — Full loop playable
- [ ] Gate 3 — Polish + QA pass
- [ ] Gate 4 — Release candidate

## Current state (2026-10-03, Gate 1.5 round 3 on `gate-1.5/art-v2`, PR #2 draft)

Stopped for Kyle's review after round 3. Do not merge PR #2 or start Gate 2 until he says so.

### Decisions pending from Kyle
1. **Spawn gap vs win time.** Still Water spawns every 0.9 s (then 0.74 / 0.62 / 0.5 s), not the ~0.5 s he asked for everywhere. With 8% koi and 5% eels, a 0.5 s period supplies 2.5 lb/s: first speed-up at 0:18, win near 1:20. I kept the 2:00–2:30 win and his Still Water mix. He can feel the denser version with `?tune` (density ×1.8). Options if he wants 0.5 s: accept ~1:20 wins, or cut koi / add eels early.
2. **Difficulty is fragile at the end.** Human-like win rate is 60% (57% over 400 seeds), at the top of the 35–60% band, and Bank to Bank's period moves it ~12 points per 0.01 s (0.48 s → 32%, 0.52 s → 79%). The cliff is eel deaths. A real-player check matters more than more bot tuning.
3. **Motif:** ripple is the default; he will choose on `?audition` now that it plays. Players can switch in Advanced audio.
4. **Audio by ear:** nobody has listened. Levels, routing, envelopes and non-silence are measured; clash, calmness and click-freeness by ear are not.
5. **Simple-panel semantics** (my choices): the Sounds switch and fader cover splashes, ambience and UI together; stingers follow Music, or Sounds when Music is off.
6. **Removed at his request mid-round:** the neon surge at speed-ups and the score tablet's pulse. The speed-up cue is now stinger + sign + quiet current streaks. The win's fireworks and neon were left alone; confirm that is what he meant.
7. **Real phone pass:** touch feel, safe areas, Safari audio unlock, frame rate, and the settings list's scroll-vs-fader behaviour (verified only with emulated touch).

### Links
- PR #2: https://github.com/khesse-757/neon-river-remastered/pull/2
- Videos (H.264 .mp4, bot-played night to the win, seed 42, production build): `docs/media/gate-1.5-r3/full-run-desktop.mp4`, `full-run-mobile.mp4`
- Stills: `docs/media/gate-1.5-r3/` — `speed-up-*`, `pause-*` (settings panel), `phase-bank-to-bank-*`, `win-*`, `win-results-*`, `active-play-*`
- Dev pages (dev server, port 5188): `/?audition`, `/?tune`, `/?theme=lantern|heron|ripple`, `/?debug`
- Bot numbers: `npm run playtest -- --oracle 100 --human 200` (writes `artifacts/playtest.json`)

### Open minors (none are blockers or majors)
- The first spawn after each speed-up still waits out the previous stage's period (three gaps a night of 0.90 / 0.74 / 0.62 s inside stages whose own period is shorter). A fix that shortened the pending timer cut eel warnings short and shifted the balance; reverted.
- Neon Rapids and the sweep part of Bank to Bank are as jumpy as the old game was (6.6 and 7.3 direction changes per 10 spawns); the smooth dance is Still Water and Quickening. By design ("more randomness"), but Kyle should judge it.
- No landscape orientation hint on phones; tablet portrait crowds the top-left HUD.
- The spawn guards (jump clamp, eel-window relocation, skip) never fire at the shipped pace; they only exist for `?tune`. The eel-window guard and `telegraphCancel` are exercised only by a density-×2.2 unit test.
- Brief §2 and §4.8 still promise weather per phase (rain, storm, moonrise); none exists yet and there are no phases now. Needs a Gate 2 design answer.
- CLAUDE.md says dev tools load only behind DEV or `?debug`; `?tune` and `?audition` also load lazy chunks in production (never on the default path). Kyle uses both; the rule's wording should be his call.
- Focus ring crosses neighbouring text at 1 CSS px per texel; net looks detached at lane 1; fry smoke faint; `dispose()` leaks on HMR; `dist/` ships unused files (Gate 4).
- Textures 59 in play vs the inspector's starting budget of 40 (one per UI label). The settings list is now one texture; the HUD and screens are not yet atlased.

### Not verified by anyone
- Audio by ear; real phone / Safari / gamepad; haptics; frame rate on a mid-range phone (59 fps is from a desktop Apple GPU); the suspend/resume seam when the tab is hidden; the `?tune` dock's open state and auto-collapse (the reviewer could not expand it by script; its collapsed bar clears the gear, mute and net at 320×568, 390×844, 844×390 and 1440×900).
- The fresh-eyes reviewer saw 7516c32. The fixes for its findings (fd225bb), the removal of the neon surge and tablet pulse (aced2b7) and the new videos have not been re-reviewed; they are covered by unit tests, e2e (also under software GL) and my own captures.

### Environment note
- A vite dev server that this session did not start is listening on 5188 from the main checkout (PID 17287). Left alone; Playwright reuses it locally.

## Gate 1.5, round 3 (Kyle's notes of 2026-10-03) — the dance, calmer audio

### Fish pattern (brief §3.3 rewritten)
- Director rebuilt: one emitter in eased swings. Still Water is a sine, bank to bank. Speed-ups at 40 / 90 / 140 lb or 0:35 / 1:05 / 1:35 move to Quickening, Neon Rapids and Bank to Bank (bursts of 2–4 pinned at a bank, then the other bank; zigzags; eels in the chain). No rests, no phases; one current carries every fish; fish spawn on the emitter and never change lane; swim wobble roughly halved (tail amplitude 0.055 / 0.065 / 0.045 of body length, head nearly still).
- **Tuning values** (`src/sim/config.ts`), all new this round:

| Stage | Speed | Period | Bank-to-bank sweep | Swing | Reversals /s | Eel roll, spacing (measured share) | Koi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Still Water | 1 | 0.90 s | 4.0 s | full | 0 | 6.7%, 5 fish (4%) | 8% |
| Quickening | 1.12 | 0.74 s | 3.0 s | 55–100% | 0.12 | 22%, 2 fish (14%) | 8% |
| Neon Rapids | 1.254 | 0.62 s | 1.8 s | 40–100% | 0.30 | 40%, 1 fish (25%) | 8% |
| Bank to Bank | 1.405 | 0.50 s | 1.15 s | 40–100%, bursts 65% | 0.40 | 50%, none (46%) | 7% |

  Also: travel 3.0 s at speed 1; current eases over 0.25 s; banks at lanes 0.08 / 0.92; river pre-run 1.4 s; sweep guard at half the net's reach since the last fish. Removed: `restSeconds`, the continuous ramp, the nine-phase table, the prefill table, `maxJump`.
- Tuning path: first table (periods 0.8 → 0.48) won in 1:45; slowing supply and correcting the effective eel share (spacing lowers it) gave 2:08–2:16; Bank to Bank period 0.47 s dropped the human-like win rate to 24%, so it sits at 0.50 s.

### Playtest (playtester agent, same seeds before and after)
| | Before (eaf3a1e) | After (7516c32; sim unchanged since) | Target |
| --- | --- | --- | --- |
| Oracle | 100/100, 0 eel contacts | 100/100, 0 eel contacts, 0 lb escaped | every seed, 0 eels |
| Human-like win rate | 49% | 60% (57% over 400 seeds) | 35–60% |
| Human-like median win (p25–p75) | 2:20 | 2:16 (2:09–2:23) | 2:00–2:30 |
| Speed-ups, human-like median | n/a | 0:29 / 1:02 / 1:32 | ~0:30 / 1:00 / 1:30 |
| First catch | 1.65 s | 1.52 s | ~2 s |
| Longest gap without a spawn | 2.08 s | 0.90 s | (asked: ~0.5 s) |
| Net zone empty per night | 9.3 s, 11 spells | 0.55 s, 1 spell (the opening) | none |
| Lane step, median / share ≥ 0.30 | 0.263 / 44% | 0.216 / 26% (Still Water 3%) | curves |
| Direction changes per 10 spawns | 6.4 | 4.7 (Still Water 2.2) | |
| Orphaned eel warnings per night | ~4.7 | 0 | 0 |
| Human-like losses | spread over 4 loop phases | 79 of 80 in Bank to Bank (35 eel, 44 escaped) | |

Pace curve, median lb (speed-ups at about 29 s, 61 s, 90 s):
| t (s) | 15 | 30 | 45 | 60 | 75 | 90 | 105 | 120 | 135 | 150 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Oracle | 20 | 41 | 64 | 88 | 115 | 141 | 165 | 191 | 200 | 200 |
| Human-like, all runs | 20 | 40 | 64 | 87 | 112 | 136 | 157 | 173 | 189 | 200 |
| Human-like, winners | 19 | 40 | 64 | 88 | 111 | 135 | 158 | 178 | 198 | 200 |

Sensitivity (400 human-like seeds, Bank to Bank period): 0.46 s 23% · 0.48 s 32% · 0.49 s 41% · **0.50 s 57%** · 0.51 s 69% · 0.52 s 79% · 0.54 s 87%.

### Audio
- **Silent `?audition` root cause:** motifs were routed through the in-game master mute and the Fish Notes switch (measured: 0.0000 RMS with a saved mute; bed only with Fish Notes off; 0.33 on a clean profile). The page now ignores both, plays at default levels, and shows a live output meter.
- Fish Notes off by default; a catch is a splash plus a 120 ms sine chime on the tonic or fifth. Spawn tick removed; warning and near-miss crackle softened; miss is a soft low knock when Fish Notes are off.
- Envelopes on every voice, cues fade instead of stopping, duplicates within 45 ms play once, 16-voice cap, samples preload with an OfflineAudioContext before the first gesture; the start sting waits for the koto sample only.
- Graph: 5 faders + cue + preview → master (volume, mute) → mono fold-down → low-cut → bass / mid / treble → voicing → compressor → limiter → night trim → background fade → analyser. Reverb sends are post-fader. Settings in `src/audio/settings.ts`, saved under `neonriver2_audio_v2` (new key: the old one stored Fish Notes as on).
- Advanced audio (`src/ui/SettingsPanel.ts`): six faders, instrument (koto / kalimba / soft bell / marimba) and theme with previews, EQ presets + bass / mid / treble ±6 dB, reverb, mono, mute in background, haptics, test sound with meter, reset.

### UI
- Settings list is one canvas-backed quad over a natively scrolling DOM list; pause panel 100 → 72 draw calls (68 with Advanced open). Faders take pointers through a grip, so a touch starting on a fader scrolls.
- Gear and mute top-left on every screen; Esc / Enter close the panel where there is no pause.
- Score pop rises and fades at the catch point. Tablet pulse and neon surge added, then removed at Kyle's request.
- Fisherman hops and calls "A FULL NET!" on a win. `?tune` dock top-right, collapses on any touch outside it.

### Verification
- `npm run check`: lint, typecheck, 38 unit tests (29 sim, 3 settings, 6 melody), secret scan. Build passes.
- Playwright (5 tests; also run with `PW_SOFTWARE_GL=1`): smoke on desktop and mobile (corner controls on every screen, settings persistence, 44 px targets, touch scroll vs fader, knob accuracy, pause panel under 100 draw calls) and `audio.spec.ts` (18 audition buttons on a clean and on a fully muted profile; in-game start sting, catch, eel shock and win fanfare, one soloed at a time). The in-game test was mutation-checked: silencing each of the four sounds makes it fail.
- Performance (production preview, Apple GPU): 59.2 fps desktop, 59.3 fps mobile-capped, ≤ 68 draw calls in play, 90 on the results card.

### Fresh-eyes review, round 5 (HEAD 7516c32): "needs fixes" — 1 blocker, 3 majors
- Blocker: CI red, the in-game audio test missed the win fanfare on software GL. Major: that test passed with any of its sounds removed. Both fixed (solo hook, real win path) and mutation-checked.
- Major: a touch scroll starting on a fader changed it. Fixed with the grip; covered by the mobile smoke test (emulated touch).
- Major: the 0.9 s gap needs Kyle's sign-off (pending decision 1).
- Minors fixed: panel state leaking into hook states; beds cut when stopped mid fade-in; sting dropped on slow connections; Esc / Space / Enter with the panel open; Sounds fader not covering ambience; stingers silent with Music off; Night lost when a tone slider moved, and barely quieter; warning cancel hitting a newer warning; knob one step off at 1 px per texel; streaks under reduced motion; stale brief wording.
- Left open: listed under "Open minors".

## Gate 1.5, round 2 (Kyle's review of 2026-10-03) — pace, leitmotif, win

Kyle: v2 look is the right direction; capped actor resolution approved. Not approved yet. This round, on the same branch / PR #2:

### Pace (measured by the playtester agent and `npm run playtest`)
| | BEFORE (3db463a) | AFTER (final table, 100 oracle / 200 human seeds) | Target |
| --- | --- | --- | --- |
| First fish at the net | 6.73 s | 1.65 s | ~2 s |
| Human-like lb at 0:40 / 1:15 | 53 / 104 | 53 / 101 (winners 55 / 105) | ~50 / ~100 |
| Human-like median win | 123.5 s | 139.6 s (2:20) | ~2:15 |
| Human-like win rate | 43.3% | 49% | 35–60% |
| Oracle | 95%, 1 eel loss | 100%, 0 eel contacts, median 134.3 s | 100%, 0 eels |

Pace curve, median lb caught (AFTER): 
| t (s) | 15 | 30 | 40 | 60 | 75 | 90 | 105 | 120 | 135 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Oracle | 18 | 40 | 55 | 84 | 105 | 128 | 150 | 173 | 200 |
| Human-like, all runs | 17 | 39 | 53 | 82 | 101 | 121 | 140 | 162 | 181 |
| Human-like, winners | 18 | 41 | 55 | 84 | 105 | 125 | 147 | 169 | 193 |

- The playtester's AFTER run was on 7392ee4 (human win rate 61%, just over the band). I then raised eel share in Lantern Koi, Twin Banks, Braided Stream and Moonrise and tightened the last two phases' period; the numbers above are my own run of the same script on the final table, not the agent's.
- **Tuning changes this round** (all in `src/sim/config.ts`): rest 2 → 0.75 s; prefilled river (3 fish at progress 0.42 / 0.24 / 0.06); ramp over 135 s or 200 lb: travel 3.0→1.9 s, period 0.62→0.42 s, sweep 0.8→3.0; nine phases as multipliers (table in brief §3.3); non-eel jump ≤ 40% of net reach per period; eel/fish spacing 0.25 → 0.4 lanes; eel hitbox 0.0425 → 0.032; eels rolled two spawns ahead so the 0.6 s warning holds when fish spawn faster than that.
- **Kyle's starting target of period 0.28 s is not met, deliberately.** The playtester checked the argument: spawned non-eel weight is pinned near 1.55 lb/s by the 2:15 target and the 20-lb escape limit (winners see 216 lb spawned: 200 caught, 13 escaped). A counterfactual with period → 0.28 s at the same mix: human win rate 3.5%, wins 25 s too fast. Reaching 0.28 s would need roughly 80% eels late. Kyle can try it live with `?tune` (density ×1.5).
- **Difficulty shape (playtester):** rises in steps, flat at 0–45 s and 60–120 s, with most losses after 120 s in the loop phases. Partly addressed by the eel-share changes above; a smoother climb is Gate 2 tuning.
- Bots: `src/sim/bots/` oracle (DP over arrivals with the real net cap; eels block their lane for ±0.22 s) and human-like (220 ms old picture, aim noise, 4-fish lookahead, aims at fish centres). An attempt to make the planner fall back to tighter eel margins and backtrack its path made it oscillate and die; reverted to the simpler version with only the flee-direction fix.

### Audio
- Three original leitmotif candidates in D hirajoshi (`src/audio/melody.ts`): Lantern (default), Heron, Ripple. Each has a 3–5 note motif, a 32-step catch sequence + 32-step variation, start sting, phase stinger, win fanfare, loss phrase. `?audition` plays them; `?theme=` selects.
- Voice: koto sample low-passed, sine "mallet" body with a short overtone, soft octave below, convolution reverb send.
- Channels: Music, Ambience, Fish Notes, Splashes, each with toggle + slider, plus master mute. First sting waits for the samples to decode (was playing the fallback string).

### Look / feel
- Fish: stepped moon specular, scale sparkle, stronger koi gleam; surface brightness clamped at 0.58 linear so only self-light exceeds it. Eel emissive × 0.87.
- Basket: contact shadow, water, wet sheen, top fish flops. An eel now fries the catch (arc from net to basket, sparks, smoke, charring) before the loss screen (2.1 s).
- Win (6 s, skippable by key after 0.4 s or touch after 1.5 s): slow-motion beat, gold wash, golden basket, raised net and cheering fisherman, leaping koi, pixel paper lanterns, fireworks, neon surge, fanfare, results card. Reduced motion removes slow-motion and leaps; reduced flashing softens fireworks, wash and the eel strobe.
- Controls: Space pauses/resumes only; gear + mute top-left on title and in play; settings panel on the title.

### Performance (production preview, Apple GPU, not a phone)
- 59.3 fps desktop, 59.2 fps mobile-capped; ≤ 66 draw calls in play, 100 on the pause panel (at the mobile budget: each UI panel is a draw call — atlas the UI in Gate 2); ≤ 6k triangles.

### Fresh-eyes review, round 3 (HEAD 7392ee4): "needs fixes" — 0 blockers, 5 majors
Fixed afterwards: `?tune` is now a compact strip docked under the painting (was covering the phone screen); first sting waits for the koto sample and the music; leaping koi no longer freeze on the results card and lanterns/fireworks continue behind it; win made bigger (gold wash, pixel lanterns, larger fireworks, cheering fisherman, softer basket glow); sim tests now cover the whole night (oracle winnability on 30 seeds, telegraph lead and jump guard through the loop phases, pace targets, tune multipliers). Minors fixed: full 0.6 s eel warning at dense spawn rates, reduce-flashing covers the eel shock, visible smoke, fish clamp, audition on the beat, audition owns the keyboard, `?theme=` fallback, toggle/slider overlap, blur during the win, touch-skip delay, Space closes the title panel, streak badge off the results card.
Left: eel-window guard is never exercised with one emitter (matters for Braided Stream's second emitter in Gate 2); focus ring crosses text at 1 CSS px per texel; texture and draw-call counts on UI-heavy screens.

### Fresh-eyes review, round 4 (HEAD b344968): one open major, since closed
- The reviewer confirmed the five round-3 majors fixed in behaviour (first sting, frozen koi, win scale, late-game tests; `?tune` usable at 390×844 but its open dock hides the net at 320×568 and in landscape) and all balance targets met on its own 100/200-seed run (first catch 1.65 s; human-like 53 lb @0:40, 101 lb @1:15, median win 2:20, win rate 49%; oracle 100/100 with 0 eel contacts). It verified the new tests by mutating the sim: each mutation made them fail.
- Its one open major was `npm run check` timing out on the new whole-night tests (vitest's 5 s default). That was fixed in c64efb5 (test timeout 90 s; CI green), which the reviewer saw on the remote but did not review.
- Fixed after round 4, **not re-reviewed**: win wash no longer lights the dark gutters; basket glow reduced again; the start sting is skipped if the night ended while samples were loading.
- Open minors: the fisherman's cheer does not read; ~4.7 eel warnings per run are orphaned when a phase ends (no eel is ever unwarned); on a first load slower than 2.5 s the start sting uses the fallback voice; the open tune dock hides the net on very small or landscape phones; no landscape orientation hint; pause panel sits at exactly 100 draw calls.

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

## Gate 1.5 fresh-eyes review, round 2 (HEAD 6bd29f1): "needs fixes" — 7 of 8 majors confirmed fixed, 1 partly
- Confirmed fixed by the reviewer: lantern off the catch line, basket heap, HUD placement, slider hit areas, slider keys, sliders audible while paused, DPR cap (painting pixels even at 390×844@3, 360×800@2.625, 412×915@2.625). Fish never exceed the water's glints (glint p99 luma 212; bluegill peak 170, koi 192–209) and do not pop.
- Still open after round 2 → fixed afterwards, **not re-reviewed**: the far-bend read. Added a bright wake trail behind every fish for the first 60% of the trip and a second emitter-lane light at 24% progress, where the river is wide enough to show a lane. In my own captures the wake trails are clearly visible; the lane light is subtle. Kyle should judge this from the videos.
- Round-2 minors fixed: Esc/P work while a slider has focus; the scoop mirrors onto its rising half instead of jumping; lantern body dims with the scene; hook states no longer double-count the basket; heap fish pulled inside the basket wall; diagnostics say `capped`.
- Round-2 minors left: slider value is a few percent off near the track ends (native thumb width); tablet portrait (768×1024@2) crowds the top-left HUD against the banner; net at lane 0 / lane 1 extremes.

## CI on Gate 1.5
- CI was red on 0498a49 and 6bd29f1: GitHub's runners rasterize in software and the full-resolution 3D frame + bloom ran too slowly for the smoke test's timing. Fix: render quality steps down automatically (0 full → 1: 3D layer at 2 px/texel → 2: 1 px/texel, no bloom) after a run of frames slower than ~36 fps, and software rasterizers start at level 2. `PW_SOFTWARE_GL=1 npm run test:e2e` reproduces the CI renderer locally. This is also the fallback for weak phones; `quality` is in the diagnostics.

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
- None running. ElevenLabs generations so far (sources in `assets-src/audio/`): ambience loop, two catch splashes, calm music loop, koto pluck, chime. The rest of the audio matrix (rain, thunder, storm music layer, UI sounds) waits for Gate 2.

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
1. Kyle: the pending decisions at the top of this file; play it, listen to it, and try `?audition`.
2. After his notes: apply them on `gate-1.5/art-v2`, re-record the round-3 media, re-run the playtester and the fresh-eyes-reviewer.
3. On approval: Kyle merges PR #2; Gate 2 starts on `gate-2/full-loop` (weather beats, assist, Hard River, settings for touch mode / reduced motion / reduce flashing, UI atlas, landscape hint, a real-player difficulty pass on Bank to Bank).
