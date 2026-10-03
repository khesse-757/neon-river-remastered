Gate 3 approved. Continue into **Gate 4 — release candidate** with threejs-qa-release, on branch `gate-4/release` with a PR.

- Production build, gate all dev tools/debug UI/test-hook verbosity, check the bundle and asset sizes, `check-secrets --dir dist`, preview on a static server, re-verify on desktop and mobile viewports.
- GitHub Pages deploy workflow (build on main, deploy artifact). Set Vite `base` for the hosting choice below.
- Hosting: [choose one — "staging at the default khesse-757.github.io/neon-river-remastered URL" or "custom subdomain <name>.kahdev.me via public/CNAME"]. Do not replace neonriver.kahdev.me unless I say so.
- Web app manifest (portrait, fullscreen, icons from the pixel art) for add-to-home-screen. Open Graph image + description for link previews.
- README (play link, controls, features, tech, credits), CREDITS.md complete (verify the Freesound license for water_net.wav; list every ElevenLabs-generated file family), ARCHITECTURE.md updated, VERSION 2.0.0, CHANGELOG entry.
- Final fresh-eyes-reviewer pass on the release build.
- Final devlog entry: what changed from v1, the key numbers, the three hardest problems, and a list of the best screenshots/clips in docs/media for the blog.

Then show me the release checklist and the PR. Wait for my go before merging, enabling Pages, tagging v2.0.0, or touching DNS. ⏸
