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

## 2026-10-03 — Gate 1.5, round 3: the dance, and a quieter river

Kyle's verdict on round 2: the look is close, but the fish pattern "feels
disjointed and jagged, with too much down time", the catch melody clashes with
the music, and the `?audition` page plays nothing at all on his Mac.

### The audition page was silent because of a mute button

- I could not hear it either way, so I measured it: a Playwright script taps
  everything that reaches the output with an AnalyserNode and prints RMS.
  Fresh profile: 0.33. Saved mute: 0.0000. Fish Notes switched off: only the
  music bed (0.05–0.14), no motif.
- Root cause: the audition page played the motifs through the same master mute
  and the same Fish Notes switch as the game. Kyle had found the catch melody
  grating, so he had very likely turned exactly those off, and then the page
  built for choosing a melody could not play one. "Use this one" still
  registered because it only writes a setting.
- Fix: the page now plays at default levels whatever the saved mix says, has a
  live output meter, and the same measurement is a permanent test: Playwright
  clicks all 18 buttons with a fresh profile and with everything muted and
  zeroed, and checks the output level for each; then does the same in the game
  for the start sting, a catch, the eel shock and the win fanfare. "I can't
  hear it" stops being a reason for audio to go unverified.

### The fish pattern: measure "jagged" first

The playtester agent put numbers on the complaint before I touched anything:

|                                             | Before                                  | After                                                    |
| ------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Lane step between consecutive fish (median) | 0.26 widths                             | 0.22                                                     |
| Steps of 0.30 widths or more                | 44%                                     | 26% overall, 3% in Still Water                           |
| Direction reversals per 10 spawns           | 6.4                                     | 4.7 overall, 2.2 in Still Water (the turns at the banks) |
| Longest gap without a spawn                 | 2.1 s (ten times a night, at the rests) | the stage's own period: 0.9 → 0.5 s                      |
| Seconds per night with nothing near the net | 9.3                                     | 0.55                                                     |
| Eel warnings with no eel                    | ~4.7 per night                          | 0 (a warning is cancelled if a guard removes the eel)    |

(Before and after were both measured by the playtester agent on the same seeds.
The smooth part is the first half of the night; Neon Rapids and the sweep part
of Bank to Bank are deliberately about as jumpy as the old game was all night.)

- The old emitter was a linear ping-pong with random swing lengths, plus a
  fairness guard that moved fish 0.4 widths sideways when an eel was nearby.
  Two thirds of all spawns reversed direction. That is scatter, not a chain.
- New director: one emitter moving in eased swings. In Still Water that is a
  plain sine, bank to bank. Three speed-ups (40 / 90 / 140 lb, or the clock)
  add speed, density, shorter swings and sudden reversals. The last stage,
  Bank to Bank, pins a burst of fish at one bank and then jumps to the other.
- No rests, no phases. A speed-up is an event, not a pause. One detail that
  mattered: fish used to keep the speed they were born with, so a speed-up
  made new fish catch up with old ones and bunch. Now the whole river has one
  current and every fish speeds up together.

### The same arithmetic, a third time

Kyle asked for no spawn gap longer than ~0.5 s, koi at 8%, eels at 5%, and a
2:00–2:30 win. Those cannot all hold: 8% koi and 5% eels is 1.27 lb per spawn,
so a spawn every 0.5 s is 2.5 lb/s and the first speed-up arrives at 0:18, the
win around 1:20. My first table did exactly that (median win 1:45). I kept the
win time and the Still Water mix, and let the period be what the budget allows:
0.9 s in Still Water, tightening to 0.5 s in Bank to Bank, where almost half
the spawns are eels and weigh nothing. What was really "down time" before was
the rests, and those are gone.

A surprise while tuning: the human-like bot's win rate fell off a cliff
between a 0.50 s and a 0.47 s period in the last stage (58% → 24%), almost all
of it eel losses. Half a second is where a 220 ms reaction and a 0.6 s eel
warning stop being enough.

### Calming the audio

- Fish Notes are off by default. A catch is a splash and a 120 ms sine chime
  on the tonic or the fifth, which sits inside every chord of the bed.
- The spawn tick is gone; the eel warning and near-miss crackle are softer.
- Clicks: several voices started at full level (the pluck, the zap, the fry
  noise, every plain tone) and cues were cut with a hard `stop()`. Every voice
  now has an attack and a decay, cues fade, duplicates within 45 ms play once,
  and at most 16 one-shot voices sound at a time.
- Samples are fetched and decoded with an OfflineAudioContext while the title
  screen loads, before any gesture, so the first sting is the real instrument.

### One quad instead of forty

The pause panel sat at exactly 100 draw calls because every label, box and
slider part was its own quad and texture. Advanced audio needed about 25 more
rows. The settings list is now drawn on a 2D canvas at one pixel per texel and
shown as a single quad, over a real, natively scrolling DOM list of
transparent form controls. Touch scrolling, keyboard focus and screen readers
come for free, and the pause screen dropped to 72 draw calls.

### Asked for, then removed

Kyle asked for a neon surge at each speed-up and a pulse on the score tablet.
After playing the build he asked for both to go: distracting.
The speed-up is now its stinger, its sign and some quiet streaks of current.
The cheapest playtest is still the owner playing it.

### Round 3b: he played it, and asked for the thing the original had

Kyle's note after playing: "They are always evenly spaced in time." He was
right, and it was my fix for "down time" that did it: one fixed period per
stage. The original's stream is not a metronome. It comes in snaking chains
that speed up under your net.

- **S-runs.** A run is 8–13 one-pound fish laid down bank to bank, with the
  gap between fish shrinking and the sweep quickening as it goes. Every
  speed-up brings one, so the river is accelerating while you are in the
  middle of a chain. Later in the night an eel is planted in the S.
- Between runs the gaps wander by ±30%.
- The budget still rules: a run delivers 2–3.5 fish a second, so the water
  between runs had to get sparser (mean gap 0.90 → 1.02 s in Still Water) to
  keep the win at about 2:09. Time with nothing near the net went from 0.55 s
  back up to about 7 s a night. That is the trade: rhythm instead of a drip.
- Two rounds ago the fairness guard moved eels sideways when fish were close in
  time, which made scatter. Now an eel simply keeps 0.38 s from its neighbours
  in time, so nothing is ever moved.
- **Modes.** Zen is the same night with the eels taken out. Taking them out
  left holes: late in the night half the stream is eels, and the first version
  had 6-second stretches of empty river. Now an eel's place is left empty only
  if the place before it was not.

## Gate 2: feature complete (2026-10-03)

### Lean mode

Kyle's first instruction for this gate was about process, not the game: verification had been eating
time and tokens. The rules now: `npm run check` and the smoke test per change, one screenshot of the
screen that changed, one playtester run when balance code changes, one reviewer pass at the end. The
playtester agent moved to a smaller model, because it only runs a script and reads numbers.

### Closing the lulls without making a metronome

Round 3b's S-runs left about 7 s a night with nothing near the net. Kyle's call: 2 s at most, keep
the runs, fill between them with an uneven trickle.

A gap is "empty" when it is longer than the time a fish spends in the last third of the river (about
1.05 s at the opening speed). The old gaps were the stage period times 0.7-1.3, so nearly half of
Still Water's gaps were too long. The fix is a skew, not a clamp: period times 0.6-1.12, with periods
set so the longest gap just fits. Gaps still wander by a factor of almost two.

That added about a quarter more fish to the first three stages. First result: empty time 1.0 s, but
the night ended at 1:58 and the speed-ups came at 25 / 52 / 81 s. Paying it back took four small
changes (a few more eels early, koi 8% -> 7%, runs a few seconds further apart, speed-ups at
45 / 97 / 148 lb). After: empty time 1.1 s, speed-ups 0:30 / 1:00 / 1:30, median win 2:02.

### Storm Night: the first table was unwinnable

The spec: start at the first speed-up's pace, four speed-ups, half again the eels, 15 lb of escapes,
winnable by a perfect player, 15-30% for a human-like one. The literal version (+12% speed at every
step up to 1.76, full S-runs, bank swaps throughout) scored oracle 80% and human-like 0 out of 100.

The reason was already in Normal's numbers: the human-like bot lets about 13 lb escape in a winning
Normal night, most of it in S-runs and bank swaps. A 15-lb budget over a longer, faster night has no
room for that. Easing one thing at a time did almost nothing (0-7%): no swaps, slower sweeps, fewer
eels, sparser fish, even a 20-lb budget. It took all of them together, aimed at the leaks: runs of
8-10 fish with looser gaps and about half as often, no bank swaps in the two new stages, top speeds
of 1.5 and 1.6 instead of 1.57 and 1.76. Result: oracle 100%, human-like 29%, median win 2:27.

### Zen, properly

Zen used to leave an eel's place empty and keep the 20-lb rule. Now eels become fish, nothing can end
the night, and 200 lb plays the win and then offers KEEP FISHING. The sim change is three lines: a
`keepFishing()` that puts a won night back in play with the win switched off.

### Looks without new art

The four looks (Night, Vivid Neon, Ukiyo-e, Moonlight) are numbers in the final pass that already
graded the picture: palette-blend strength, saturation, a tint, a wash toward a paper tone, and how
hard neon and bloom push. The pixel UI is drawn after that pass, so menus keep their colors.

### Rain that could not be seen

The first rain was two soft dots per drop. In the screenshot there was no rain at all: soft round
particles a texel wide, three texels apart, read as faint specks. Six overlapping dots along the
fall line read as a streak. The particle system only has round dots, so a streak is a short row of
them.

### The Field Guide was built in parallel

The gallery is isolated enough (its own chunk, its own small renderer) that a second agent built it
in a separate worktree against a written contract while the sim and menus changed underneath. It
merged with no conflicts. It adds 7.9 kB gzip, loaded only when the button is pressed.

### After Kyle's Gate 2 notes

- Normal now tells the night's story in weather: light rain from the second speed-up, heavier in
  Bank to Bank, clearing on the win. Zen stays clear.
- Rain is two generated loops (light and heavy) crossfaded by one "how hard is it raining" number,
  and thunder is three generated rolls. Two of the thunder takes came back almost silent (peaks of
  -33 and -27 dBFS) and were raised by 29 and 23 dB in normalization; nobody has listened yet.
- "Koi stay gold in every look" turned out to be one line in the grade: pixels that are strongly
  warm (red well above blue, and above green) skip the desaturation and tint. The lantern keeps its
  color for free.
- The bluegill's dorsal fin was a single upright triangle with a sideways normal, so on the
  turntable one side was always unlit. In the river it is seen from above and nobody noticed. It is
  now two faces a hair apart, each lit as if it leaned.
- Assist is out of the design. Zen is the casual mode.

## Gate 3: release 2.0.0 (2026-10-03)

The last entry. This one is the summary for the blog post.

### v1 to v2 in one paragraph

v1 was a Canvas 2D game: one painting, flat sprites, fish spawned at random, a speed multiplier that
rose with the score. v2 keeps the painting, the fisherman, the rules (200 lb to win, 20 lb may
escape, an eel ends the night) and the catch sound. Everything else is new: a three.js renderer with
3D fish, water and net inside the painting; a deterministic simulation that scripts the night as
stages; three modes; generated music, weather and a catch melody; a Field Guide; settings for sound
and picture. It was built in two days of sessions, 2 to 3 October 2026, in four gates.

### The art pivot

Gate 1 followed the first art rules to the letter: every pixel on the painting's 216×387 grid, flat
sprites, a 48-color lock. It was faithful and Kyle did not like it: flat and low-res. The second
direction ("the painting, in 3D") kept the painting as a pixel-art world and made everything the
player touches a toon-lit 3D object at device resolution. The simulation, input, tests and UI did not
change during the pivot, because the rules never knew what a pixel was. That is the best argument in
the project for keeping game logic pure.

### The fish-pattern research

The original minigame does not spawn fish at random. The OpenGOAL decompilation shows one emitter
sweeping across the river on a timer, with the night scripted as phases. That is why its fish arrive
in lines you can follow. The remaster's emitter does the same and adds S-runs (a chain of fish
snaking bank to bank), bank swaps in the last stage, and a fairness guard for eels. The original has
rests between phases; Kyle played ours and asked for the opposite, so the stages now run into each
other and each speed-up brings a run.

### Modes

Zen cannot be lost (eels become fish, no escape limit, keep fishing after the win). Normal is the
game. Storm Night starts at Normal's first speed-up, adds two stages, half again the eels and a 15-lb
limit. Its first table was unwinnable: perfect bot 80%, human-like bot 0 of 100. It took easing
several things together, aimed at where the human-like bot leaked pounds, to reach 100% and 29%.

### What Claude Code and the skills did well

- The pure, seeded simulation. It made the art pivot cheap, let bots play hundreds of nights in
  seconds, and let tests check fairness over 200 seeds.
- Doing the arithmetic before tuning. Three times the brief's numbers could not work as written
  (keyboard speed under the cap, more fish than a night could hold, an unwinnable hard mode) and the
  sums showed it before any playtest did.
- The independent reviewer. A second agent that runs the build cold found a clipped HUD, overlapping
  buttons and a test hook that had never reached the state it claimed.
- Parallel work on isolated parts. The Field Guide was built by a second agent in its own worktree
  against a written contract and merged with no conflicts.
- The skills pack's structure: test hooks that reach real states, a diagnostics object, a progress
  file. Sessions could be cleared and resumed from `artifacts/game-progress.md`.

### What they did badly

- Followed the letter of the first art rules into a look nobody wanted. A rough mock-up for Kyle
  before building the pipeline would have saved a gate.
- Cannot hear. Every level and loop seam was measured, not listened to. Two thunder takes came back
  almost silent and the audition page was silent because of a mute button; Kyle found both by ear.
- Cannot hold a phone. Safe areas, touch feel and Safari were only ever checked by Kyle.
- Over-verified. Before lean mode, a small change could trigger scorecards, manifests, videos and
  repeat playtests chasing a 2% shift. The verification budget in CLAUDE.md fixed that by rule.
- The skills pack's defaults pull toward photoreal PBR and generic glow. A project skill had to
  override them.
- The first hero GIF for the README was 14 MB. It was cut from a screen recording, and the video
  codec's noise made every pixel change on every frame. Capturing lossless frames at a tenth of game
  speed and using a 64-color palette with no dither (the painting has 48 colors) gave 4.6 MB.

### Key numbers

- 2 days, 4 gates, 5 pull requests before the release PR, 42 commits on `main` before the release
  branch.
- About 11,000 lines of TypeScript in `src/`.
- Painting: 768×1376 and 224,459 colors, down to 216×387 and 48 colors, 108 kB.
- Production build: 4.1 MB in total, of which audio is 2.1 MB. Main script 697 kB (191 kB gzip);
  Field Guide 20.8 kB (7.9 kB gzip), loaded on demand; dev tools 35 kB + 4 kB, never loaded without
  `?debug`. Moving the v1 source art out of `public/` took 2.4 MB out of the build, and the
  sourcemaps no longer ship.
- A Normal night: speed-ups at about 0:30 / 1:00 / 1:30, median win 2:02. The bot-played night
  recorded for the README won at 204 lb in 2:05 with 2 lb escaped.
- Storm Night: perfect bot 100%, human-like bot 29%, median win 2:27.
- CI: two required jobs, each about a minute.

### The best media for the post

1. `docs/media/readme/hero.gif` — ten seconds of Normal: a speed-up, an S-run, an eel slipping past.
2. `docs/media/readme/v1-vs-v2.png` — the two title screens side by side.
3. `docs/media/gate-1.5/v1-vs-gate1-vs-gate1.5.png` — the art pivot in one picture.
4. `docs/media/gate-1/sheet-grid-desktop.png` — the four pixel grids from the look-dev that was rejected.
5. `docs/media/gate-1/sheet-fish-flat-vs-voxel.png` — flat sprites against voxel fish, a dead end.
6. `docs/media/readme/win.png` — the lantern finale.
7. `docs/media/readme/field-guide.png` — the koi on its turntable.
8. `docs/media/gate-1.5-r3/full-run-desktop.mp4` — a whole bot-played night.
9. `docs/media/gate-2/looks.png` — the four looks.
10. `docs/media/readme/eel-shock.png` — the blackout when an eel reaches the net.

### After release: the city moved with the net

Kyle's first bug on the live site: moving the net shifted the whole skyline. It was deliberate and
wrong. The far layer's parallax was `(net lane - 0.5) * 3` texels plus a slow sine, a leftover
"camera follows the player" idea, and because the layer moves in whole texels the sky and city
jumped up to three texels (12 px on a 4x screen) as the net crossed the river. The net term is gone;
the slow drift stays and CAMERA DRIFT still switches it off.

### After release: the hero GIF's colors

The first hero GIF had two faults. It was recorded before the parallax fix, so the skyline slid with
the net. And its colors were off: a 64-color palette chosen by pixel count has no room for small
bright things, so the lantern came out pale yellow (saturation 0.30 against 0.38 in the source) and
the pink neon reflections went blue. More colors alone did not fit in 5 MB (256 colors: 7.6 MB).

What worked: build the palette in parts. 60 colors from the whole picture, plus 44 reserved from
crops of the lantern, the reflections, the skyline and the basket, merged into one palette. The
recording now turns camera drift off, and runs at 12.5 fps instead of 15 (GIF delays are whole
centiseconds, so "15 fps" was really 14.3 with uneven steps). Result: 4.9 MB, lantern saturation
back to the source's. Drawing no rain was tried and saved only 4%, so the rain stays.
