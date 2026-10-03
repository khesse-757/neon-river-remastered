Gate 2 approved. Merge its PR when CI is green. Then do **Gate 3 — release** on branch `release/v2.0.0` with a PR. Lean mode still applies: one fresh-eyes pass on the release candidate, and nothing else beyond `npm run check`, smoke and CI.

Domain: **neonriver2.kahdev.me**. I've already set up Pages (source: GitHub Actions, custom domain set) and the Cloudflare CNAME `neonriver2` → `khesse-757.github.io`, DNS only. Leave neonriver.kahdev.me (v1) untouched.

## 1. Deploy to GitHub Pages with the custom domain
- Add `.github/workflows/deploy.yml`: on push to main → `npm ci` → build → `check-secrets --dir dist` → `actions/upload-pages-artifact` → `actions/deploy-pages`. Set the `pages: write` and `id-token: write` permissions and the `github-pages` environment.
- Vite `base: '/'` (the custom domain serves from the root). Don't rely on a CNAME file: GitHub ignores it for Actions deployments. Add `public/CNAME` containing `neonriver2.kahdev.me` only as documentation, if you like.
- Pages is already configured; don't recreate it. Verify it with one read-only call (I'll approve it): `gh api repos/khesse-757/neon-river-remastered/pages`. Expect `build_type: workflow` and `cname: neonriver2.kahdev.me`. If either differs, tell me rather than changing it.
- HTTPS enforcement and live verification happen after the first deploy (see §4).
- Production must not ship `?tune`, `?audition` or test-hook verbosity unless `?debug` is set.

## 2. Ship polish
- Web app manifest: portrait, fullscreen, theme colors, icons (192/512 plus maskable) made from the pixel art, and an apple-touch-icon.
- Favicon.
- Open Graph and Twitter card image (1200×630, from the painting plus logo), with title and description.
- `<meta>` description.
- A 404 page that returns to the game.
- Bundle check: list chunk sizes, and confirm the gallery and dev tools are lazy.

## 3. Fill out the repo
- **README media:** this is the one place where recording is worth it, even in lean mode. Make it from the production build with a real (or bot-played) Normal night:
  - `docs/media/readme/hero.gif`: an 8–10 s seamless loop of active play showing an S-run, catches, an eel slipping past and a speed-up. Desktop crop of the painting, about 480 px wide, 15 fps. Use ffmpeg with `palettegen`/`paletteuse` so the neon doesn't band. Keep it ≤ 5 MB. It goes at the very top of the README, linked to the live site.
  - A screenshot row under it, in a 3-column table: `mobile-play.png` (390×844), `win.png` (the lantern finale) and `field-guide.png` (koi turntable, original vs remaster). Optionally a second row: `eel-shock.png`, `modes.png`, `settings-visuals.png`.
  - `v1-vs-v2.png`: side-by-side with the original, for the "Remastered from" section.
  - Compress the PNGs (oxipng or pngquant). Use repo-relative paths so they render on GitHub, and alt text on every image.
- **README.md:**
  - the hero GIF, then the screenshot row (from above)
  - a **Play now → https://neonriver2.kahdev.me** link
  - the three modes
  - controls (mouse/keys/touch/gamepad, Space/Esc/P pause)
  - features (the painting in 3D, the Jak-inspired S-runs, field guide, advanced audio/visual settings)
  - "Remastered from Neon River (v1)" with links to the v1 repo and site
  - tech stack, project structure, dev commands, credits and license
- **CHANGELOG.md** with 2.0.0. **VERSION** → 2.0.0, and package.json too.
- **ARCHITECTURE.md:** sim/render/audio/UI layers, the event flow, modes, and how to add a mode.
- **CREDITS.md:** complete. Verify the Freesound license for water_net.wav, list the ElevenLabs-generated audio families, Gemini for the original painting, three.js, the skills pack, and the OpenGOAL research credit.
- **LICENSE** (MIT, Kyle Hesse). `.github/ISSUE_TEMPLATE/bug_report.md`.
- Repo metadata, in one `gh repo edit` call I'll approve: description, homepage `https://neonriver2.kahdev.me`, topics (`threejs`, `game`, `pixel-art`, `typescript`, `vite`, `webgl`, `fishing`, `jak-and-daxter-inspired`).
- Make a 1280×640 social preview image at `docs/media/social-preview.png`. Tell me to upload it in Settings → General; there's no API for it.

## 4. Release
Order matters, because Pages deploys from main:
1. Run one fresh-eyes-reviewer pass on the production build (`npm run preview`). Fix blockers and majors.
2. Show me the checklist and **wait for my go** to merge the release PR. The merge triggers the first deploy.
3. Once my DNS record resolves, enforce HTTPS, then verify https://neonriver2.kahdev.me on desktop and a mobile viewport: it loads, plays, has no console errors, and the manifest and OG tags are present.
4. With my go, tag `v2.0.0` and create the GitHub release with notes.

Also:
- Final devlog entry for the blog:
  - v1 → v2 summary
  - the art pivot (flat pixel grid → painting plus 3D actors)
  - the fish-pattern research
  - modes
  - what Claude Code and the skills did well or badly
  - key numbers
  - the 8–10 best media files to use

Stop at step 2 and again before step 4. ⏸