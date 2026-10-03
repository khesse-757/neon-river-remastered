# Changelog

## 2.0.1 — 2026-10-03

### Fixed

- The skyline no longer shifts sideways when the net moves. The far layer's parallax followed the net; now only the slow
  camera drift moves it.

## 2.0.0 — 2026-10-03

The remaster. A rebuild of [Neon River v1](https://github.com/khesse-757/neon-river) on three.js.
Live at [neonriver2.kahdev.me](https://neonriver2.kahdev.me).

### New

- **The painting, in 3D.** The v1 painting is the world, split into depth layers; water, fish, eels, the net, the
  lantern and the basket are toon-lit 3D objects inside it, with reflections, ripples, wakes and bloom.
- **Scripted nights.** Fish come from one sweeping emitter in lines and S-shaped runs, after the fishing minigame in
  _Jak and Daxter_. Four named stages (Still Water, Quickening, Neon Rapids, Bank to Bank) with three speed-ups.
- **Three modes.** Zen (no eels, no losing, keep fishing after the win), Normal, and Storm Night (five stages, more
  eels, a 15-lb limit, rain and lightning; unlocked by a Normal win).
- **Fair eels.** Every eel is announced 0.6 s ahead, and the spawner never forces a catch and a dodge at the same spot.
- **A win worth chasing.** Slow motion on the 200th pound, paper lanterns down the river, a results card.
- **Field Guide.** Bluegill, Golden Koi, Electric Eel and the net on a 3D turntable, original sprite beside the remaster.
- **Audio.** Generated music, ambience, rain and thunder; a melody played by your catches; per-channel faders.
- **Advanced visuals.** Quality, render scale, four looks, bloom, reflections, weather, particles, camera drift,
  screen shake, reduce motion, reduce flashing, HUD size. Quality steps down by itself on slow devices.
- **Records** per mode: best time, best streak, wins, lifetime catches.
- **Input:** mouse, keyboard, relative touch drag, gamepad.
- **Installable:** web app manifest (portrait, fullscreen), icons, share card, a 404 page.

### Changed from v1

- Canvas 2D → three.js (WebGL). Random spawns → a deterministic, seeded simulation on a fixed timestep.
- The rules are the same: 200 lb to win, 20 lb may escape, an eel ends the night. Bluegill 1 lb, koi 5 lb.
- The catch sound from v1 is kept, layered under new splashes.

### Infrastructure

- CI: lint, typecheck, unit tests, build, secret scans and a browser smoke test on every PR.
- Deploy: GitHub Pages from `main` through GitHub Actions.
