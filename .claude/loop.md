Keep the Neon River remaster moving, one useful step per iteration.

1. Re-read artifacts/game-progress.md (current gate, next actions, defects).
2. If there is an open PR for the current branch: check CI with `gh pr checks`.
   If red, read the failing job log, fix the cause, commit, and push. If there
   are new review comments, address them.
3. Otherwise continue the current gate's next action from game-progress.md,
   commit with a conventional message, and push the feature branch.
4. If the gate's done-condition is met, run the fresh-eyes-reviewer agent,
   fix blockers/majors, update game-progress.md and docs/devlog.md, then stop
   the loop and tell Kyle the gate is ready for review.

Never merge to main, deploy, change repo settings, or spend on new asset
generation beyond what the current gate planned. If nothing is actionable,
say so in one line.
