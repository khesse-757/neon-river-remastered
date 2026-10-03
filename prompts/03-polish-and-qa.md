[Add my playtest notes here: what felt off, which phases were too hard/easy, bugs I saw, device I tested on.]

Continue with threejs-game-director into **Gate 3 — polish and QA**. Re-read artifacts/game-progress.md. Work on branch `gate-3/polish` with a draft PR. Address my notes above first.

Then run the full production pass the skills describe, with the pixel-art overrides:
- Score the 10-category scorecard using the translation table in neon-river-art-direction, against active-play captures (desktop 1440×900 and mobile 390×844), with the canvas inspector's metrics. Fix the weakest categories until every category is ≥ 2 and the average ≥ 2.3, and none of the art skill's automatic failures stand. Use the fresh-eyes-reviewer agent as the independent review (commit first); fix its blockers and majors, then run it once more.
- Game feel pass with threejs-gameplay-systems/references/game-feel.md: hit-stop, grid-snapped shake, squash on scoop, gamepad rumble, navigator.vibrate where supported — all off under reduced motion.
- Performance with threejs-debug-profiler on the production preview: baseline, find the bottleneck, fix, re-measure. Budgets: 60 fps mid-range phone, ≤ 60 draw calls, one composite pass + blit, initial download ≤ 3 MB before audio.
- QA with threejs-qa-release: declare artifacts/evidence.json covering title, each phase:<name>, rest, pause, settings, win, loss-eel, loss-escaped on desktop and mobile; run the inspector manifest and check_evidence.py; Playwright smoke + visual baselines; playtester agent; audio checks (unlock, mute, volume, pause cleanup); text fit and safe areas; orientation handling; tab-hidden pause.
- Write artifacts/final-evidence.md and update the devlog with before/after (v1 vs now) media.

Stop with: scorecard before/after, evidence paths, performance numbers, remaining risks. ⏸
