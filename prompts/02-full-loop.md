Look approved. [Add any notes on the look-dev here: which resolution, flat or voxel fish, anything to change.]

Continue with threejs-game-director (plus neon-river-art-direction) into **Gate 2 — full loop playable**. Re-read artifacts/game-progress.md first. Work on branch `gate-2/full-loop` (from main after I merge Gate 1), with a draft PR kept green. Generate the full audio batch from the audio matrix with ElevenLabs (listen-check each family through its real game event before generating variants). Use the playtester agent for every balance measurement.

Build out, in playable increments (keep the game runnable after every step, commit per milestone):
1. The whole phase script (all 9 phases + rests + Moonrise looping), the second emitter for Braided Stream, pinned-bank mode, fairness guards, assist ("the river calms"), and the Hard River endless mode + the ←←→→←←→→ unlock.
2. Complete game states: title, playing, rest/banner, pause (Esc/P/Space, tab hidden, gamepad Start), settings, win, loss-eel, loss-escaped, retry in one tap. Persist best time, best streak, unlocks and settings.
3. Feedback for every sim event: scoop, weight pop to HUD, streak scale on the plucked voice, koi chord, miss, near-miss eel sparks, eel shock sequence, fisherman reactions and rate-limited speech bubbles (write original lines).
4. The world beats per phase: rain, rain rings on the ripple field, lightning (respect reduce-flashing), moonrise, neon intensity, floating lanterns on win, blackout on eel loss.
5. HUD (stone tablet: caught toward 200, 20 escaped notches, streak), phase banners, all menus in the pixel font, safe areas, touch targets, wide-screen gutters.
6. Audio buses and the full event matrix (generated assets if ELEVENLABS_API_KEY is set, procedural otherwise).
7. Test hooks for every state in REMASTER_BRIEF §7, Vitest sim suite on 200+ seeds, the oracle bot and the human-like bot (brief §9). Tune the phase table until the weight-budget rule and the target win rate hold; record every change and the bot metrics in game-progress.md.

Gate 2 is done when a full run is playable start to finish on desktop and mobile through real input, `npm run check` passes, the playtester reports PASS on the brief's targets, CI is green on the PR, the fresh-eyes-reviewer has no open blockers/majors, and the devlog has an entry with clips/screenshots. Then stop and show me: bot metrics, active-play captures for desktop and mobile (early phase, Eel Storm, Moonrise, win, eel loss), and anything you'd still change. ⏸
