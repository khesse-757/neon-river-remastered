Gate 1 decisions:
- Ruleset: approved — run the `gh api` call you proposed.
- PR #1: merge it as the foundation (infrastructure, sim, input, tests, CI are good). Then branch `gate-1.5/art-v2` from main.
- Look: **not approved yet.** It's faithful but too flat and low-res. I wanted an impression of the original that's enhanced, detailed and stylized — fish, river and net should read as 3D.

I've replaced `.claude/skills/neon-river-art-direction/SKILL.md` with **art direction v2**. Read it fully; it supersedes the v1 rules (single 216×387 grid, flat sprites, no 3D shading). Use threejs-game-director with threejs-aaa-graphics-builder (now in full) and neon-river-art-direction v2.

## Gate 1.5 — art direction v2 + audio fixes

First, update the docs to match v2 and commit: REMASTER_BRIEF §1 (the pixel-art bullet becomes "pixel-art painting as the world, stylized toon-lit 3D actors"), §4 (rewrite to v2), §8 non-goals (photoreal PBR stays out; procedural stylized 3D is in). Add to CLAUDE.md: "Never use broad `pkill`/`killall`; stop only the PIDs you started."

### My playtest notes — fix all of these
1. **Fish brightness / pop:** fish are too bright, and right before the catch they pop into a plain sprite. With v2: fish are 3D under real water with continuous depth fog and a smooth rise to the surface; they never outshine the water's brightest glints.
2. **The net looks like v1.** Build the new 3D net per v2: lacquered bamboo pole, glowing cyber hinge, hoop, cloth net that sags/bulges/drips, scoop-and-lift catch into a woven basket that fills toward 200 lb, and the swinging 3D paper lantern as the warm light.
3. **More 3D, more resolution:** procedural toon-lit 3D bluegill, koi and eel (spine-wave swim, fins, koi gleam, eel bioluminescence + arcs), a real 3D water surface (flow normals, Fresnel, reflections of the skyline/neon, refraction, depth absorption, bank foam, ripples, wakes), the painting split into parallax depth layers, real moon/lantern/eel/neon lights, selective bloom, palette grade.
4. **Audio — the streak tune:** the climbing note is great until it runs out and repeats the top note. Replace it with a **composed melody**: a 32-step phrase (two 16-step halves, call and answer) in a Japanese pentatonic scale, in the key and tempo of the music loop. Each catch plays the next note (onsets nudged ≤ 40 ms to the music's 8th-note grid), the phrase loops into a variation instead of stalling, koi catches add a harmony/chord on the current step, milestones (8/16/32 in a row) add a layer (harmony voice, chime), and a miss plays a soft falling resolution and resets to step 1. Improve the pluck timbre (koto-like); sample it with ElevenLabs if that sounds better than procedural.
5. **Audio — mix/EQ:** buses (music, ambience, SFX, melody, UI) → master EQ (low-cut ~80 Hz, tame harsh highs, slight presence) → compressor/limiter. Loudness-normalize every generated asset offline (e.g. ffmpeg loudnorm; music ≈ −16 LUFS, SFX peaks ≈ −3 dBFS), duck music under stingers/banners, and add Music / Ambience / SFX sliders in settings. Nothing should spike or bury the melody.

### Look-dev and evidence
- A/B the actor render resolution (device res vs 3× pitch target) and show both on mobile.
- Capture desktop 1440×900 and mobile 390×844 stills: early phase, a koi catch mid-scoop, an eel near the net, rest/banner. Also record 5–10 s Playwright videos of active play on both viewports — motion is the point of this pass.
- Make a side-by-side `docs/media/gate-1.5/v1-vs-gate1-vs-gate1.5.png`.
- Check performance on the production preview (fps, draw calls, payload) against v2 budgets.
- Commit, run the fresh-eyes-reviewer (it must re-run after its fixes this time), fix blockers/majors, update game-progress.md and the devlog (this art pivot is a good blog section).

Stop and show me: the comparisons, the videos, the A/B recommendation, reviewer verdict, perf numbers, and the PR. Don't start Gate 2 until I approve the look. ⏸
