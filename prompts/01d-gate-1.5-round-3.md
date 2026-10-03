Gate 1.5, round 3. Same branch and PR #2. The look is close; this round is about the **feel of the fish pattern** and calming the audio. Use threejs-game-director with neon-river-art-direction. Run the playtester before and after.

Answers to your questions:
- Motif: I couldn't pick because the audition page is silent (see §5). Default to ripple for now. I'll choose once the audition actually plays, and players can switch it in Advanced audio.
- Period: drop the 0.28 s target. It was a guess. Use the 4-stage structure below. A solid player should win in about 2:00–2:30. The 20-lb escape rule stays.
- Look: approved, apart from the fixes below.

## 1. The fish pattern — a fun side-to-side dance, like the original
Right now it feels disjointed and jagged, with too much down time. Rebuild the director around this structure, and update REMASTER_BRIEF §3.3 to match:

- **Stage 1, Still Water.** One emitter sweeping **smoothly** across the river (eased/sinusoidal, not linear ping-pong with jitter). A steady chain of mostly 1-lb fish, so the stream draws a flowing S-curve the net can dance along. Koi ~8%. Eels rare (~5%) and well spaced.
- **Speed-ups 1, 2, 3.** The game speeds up **three distinct times**, triggered at about 40 / 90 / 140 lb caught, with a time fallback of 0:35 / 1:05 / 1:35. Each speed-up raises fish speed (~+12%), spawn density and sweep speed, and adds randomness: shorter swing times and sudden reversals.
  - Announce each one with a short stinger and a visual cue (current streaks, neon surge).
  - **Spawning never pauses** for an announcement.
- **Stage 4, Bank to Bank** (after speed-up 3). Fish and eels swap sides unpredictably: a short burst pinned at the left bank, then immediately the right bank, mixed with fast zigzags and eels dropped in. This runs until 200 lb.
- **No down time:**
  - no gap without spawns longer than ~0.5 s anywhere
  - a fish is always approaching the net zone
  - no separate rest phases
- **Smoothness:**
  - fish never jump lanes
  - cut the cosmetic wobble
  - chains read as curves, not scatter
- Keep the fairness guards and the oracle-bot proof that every seed is winnable. Tune with the playtester, and report a lb-vs-time curve with the three speed-ups marked.

## 2. Audio — calm it down
- The catch melody and the music clash. Notes land against the bed and leave artifacts. **Set Fish Notes OFF by default** and keep the toggle as an option.
- With Fish Notes off, a catch is a clean splash plus a soft, short, non-pitched or in-key chime that never clashes.
- Remove or soften any sound tied to fish passing or spawning, so the bed stays calm.
- Do a pass for clicks and pops: envelopes on every voice (no zero-attack starts or hard stops), no stacked identical sounds in the same frame, and a limit on how many voices play at once.
- Keep the chosen motif for the start sting, speed-up stingers, win and loss.

## 3. Score pop
On desktop the +1/+5 flies to the wrong place. Show it as a small pop at the catch point that rises and fades in place. Pulse the score tablet wherever the layout puts it. No flying across the screen.

## 4. Settings and mute stay put
The gear and mute buttons stay visible in the top-left corner at all times: title, play, pause and results. No auto-hide.

## 5. Audition page is silent — fix first, and prove it
On my Mac (Chrome), clicking any button on `?audition` plays nothing, though "Use this one" registers.
- Find the root cause. Likely suspects: an AudioContext that was never `resume()`d inside the click handler, routing through a bus that the saved mute or Fish-Notes-off setting silences, or samples that only load when a game starts.
- The audition page must play regardless of in-game mute and toggles. It should show a small live level meter so I can see sound is coming out.
- Add an automated check: Playwright clicks each audition button, and an AnalyserNode on the master output reports non-silent RMS. Do the same for in-game catch, eel, start and win. "I can't hear it" is no longer a reason for audio to go unverified.

## 6. Advanced audio settings for players
Keep the main settings simple (Master, Music, Sounds, Fish Notes on/off), and add an **Advanced audio** section that expands:
- Volume sliders: Master, Music, Ambience, Splashes and SFX, Fish Notes, UI.
- Fish Notes: instrument (koto / kalimba / soft bell / marimba) and theme (lantern / heron / ripple), each with a preview button.
- Tone: an EQ preset (Default, Warm, Bright, Headphones, Night: quieter and compressed for late-night play), plus manual Bass / Mid / Treble sliders (±6 dB).
- Reverb amount, and Mono on/off.
- "Mute when the tab is in the background" on/off. Haptics on/off (mobile).
- A "Test sound" button with a level meter, and "Reset to defaults".
- Everything persists in localStorage (wrapped in try/catch), applies live without restarting, and fits on a 390×844 phone with 44 px targets.

## 7. Open minors from round 4
- Cancel eel warnings when the eel won't spawn.
- Preload the sting so a slow first load doesn't fall back.
- Collapse the tune dock so it never hides the net.
- Make the fisherman's cheer read clearly.
- Get the pause panel under 100 draw calls.

## Done
- `npm run check` and the build pass, and CI is green.
- The playtester reports a curve showing the three speed-ups and a 2:00–2:30 solid-player win.
- New full-run videos on desktop and mobile, re-encoded to **.mp4 (H.264)** so I can open them in QuickTime.
- The fresh-eyes-reviewer re-run, with no open blockers or majors.
- game-progress.md and the devlog updated.

Then stop and show me. ⏸