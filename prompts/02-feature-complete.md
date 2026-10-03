Fresh session: read CLAUDE.md and artifacts/game-progress.md first, and check `git status` and `gh pr checks 2`.

Round 3 approved. Merge PR #2 once CI is green on its last commit. Then start **Gate 2 — feature complete** on branch `gate-2/feature-complete` with a draft PR. Use threejs-game-director with neon-river-art-direction. This replaces the old prompts 02 and 03; delete them, and delete the old 04, which is replaced by `prompts/03-release.md`.

## 0. Lean mode — do this first
Verification has been eating time and tokens. Add this section to CLAUDE.md, replacing any conflicting guidance, and follow it from now on:

```
## Verification budget (lean mode)
- Per change: `npm run check` + the Playwright smoke test. Rely on CI for the rest.
- Screenshots: only of the screen you changed, one viewport, only when the change is visual. No videos unless Kyle asks.
- No canvas-inspector manifests or scorecards until the release pass.
- playtester: only when spawn/balance code changes, 100 human-like + 20 oracle seeds, one run. No re-runs to chase a 2–3% shift.
- fresh-eyes-reviewer: once at the end of this gate and once on the release candidate. Not per change.
- Kyle playtests on real devices; prefer asking him over more bot tuning.
- Keep reports short: what changed, what ran, what Kyle needs to decide.
```

Also set `model: sonnet` in `.claude/agents/playtester.md`.

## 1. Close round 3's open items (my calls)
- **Lulls:** about 7 s a night with nothing near the net is too much. Bring it to ≤ 2 s. Keep the S-runs, but fill the gaps between them with a light, uneven trickle of single fish.
- **Zen can't be lost.** No eels, no escape loss. The night ends at 200 lb with the win sequence, then a "keep fishing" option for endless calm play. Fill eel slots with fish, not gaps.
- **Dev tools:** `?tune` and `?audition` load only in dev or with `?debug`. Advanced audio already covers previews for players. Update CLAUDE.md to match.
- **Tablet portrait HUD crowding:** fix.
- **Speed-up streaks:** make them readable again (a subtle current shimmer), without the neon surge.

## 2. Modes: Zen / Normal / Hard
Replace the MODE cycle button with a small mode picker on the title screen: three cards, each with a one-line description and its best result.
- **Zen:** as above.
- **Normal:** as it is now.
- **Hard ("Storm Night"):**
  - It's the original's hard table in spirit. It starts at speed-up-1 pace and has 4 speed-ups instead of 3.
  - Eel share is about 1.5× Normal, and eels can sit in S-runs from the start.
  - 15-lb escape budget, no assist, and permanent light rain plus lightning (respect reduce-flashing).
  - Winnable: oracle 100% with zero eels. Human-like win rate target 15–30%.
  - Unlocked by winning Normal once, or by the ←←→→←←→→ + Enter code (swipe pattern on touch).
- Fold the old "Hard River endless" idea into Zen's keep-fishing for now. More modes later stay one entry in `src/sim/modes.ts`.
- Save best time, best streak and wins per mode.

## 3. Advanced visuals (mirror Advanced audio)
Keep the simple settings, and add an expandable **Advanced visuals** panel. All options apply live and persist:
- Quality preset: Auto / Low / Medium / High. Auto uses the existing GPU step-down.
- Resolution scale.
- Bloom: on/off and intensity.
- Water reflections: on/off.
- Weather: on/off. Particles and fireflies: density.
- Camera drift/parallax: on/off. Screen shake: on/off.
- Reduce motion. Reduce flashing.
- **Look** preset: Night (default), Vivid Neon, Ukiyo-e (muted, paper-toned), Moonlight (near-monochrome blue). Done with the existing color grade and palette blend, not new art.
- HUD scale. Show FPS.
- Reset to defaults.

Same rules as audio: fits at 390×844 with 44 px targets, try/catch around storage.

## 4. Fish gallery ("Field Guide") in the main menu
- A title-screen button opens a gallery with Bluegill, Golden Koi, Electric Eel and the Net.
- Each has an **Original (2026 v1)** view and a **Remaster** view, with a toggle or side-by-side on desktop:
  - **Original:** the v1 pixel sprite, rebuilt from the arrays in `reference/original/src/assets/sprites/`, animated with its v1 frames, scaled crisp. Copy the sprite data into `src/` — never import from `reference/`.
  - **Remaster:** the live 3D model on a turntable. Drag or swipe to rotate, scroll or pinch to zoom, an auto-spin toggle, and a swim-animation toggle. Lit by the scene's moon and lantern.
- An info card for each: weight, behavior, a short line of lore (original writing), and the player's catch count.
- Lazy-load the gallery so it adds nothing to the first load. Same pixel UI style. Back returns to the title.

## Done for Gate 2
- `npm run check`, smoke and CI are green.
- One playtester run each for Normal and Hard.
- One fresh-eyes-reviewer pass, with blockers and majors fixed.
- game-progress.md and the devlog updated.

Then report briefly, in one message:
1. what changed
2. the playtester table
3. anything I need to decide

Include one screenshot each of the mode picker, Advanced visuals, and the gallery. ⏸
