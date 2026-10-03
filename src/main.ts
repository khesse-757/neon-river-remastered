import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Missing #game-canvas element.');

const params = new URLSearchParams(window.location.search);
const game = new Game(canvas, {
  grid: params.get('grid'),
  actors: params.get('actors'),
  theme: params.get('theme'),
  mode: params.get('mode'),
  ci: params.has('ci'),
  forceByteRipples: params.get('ripple') === 'byte',
  seed: params.has('seed') ? Number(params.get('seed')) || 1 : undefined,
});
game.start();

// Dev tools (path editor, lil-gui, ?tune, ?audition) load only on the dev server or with ?debug.
const dev = import.meta.env.DEV || params.has('debug');
if (dev) {
  (window as unknown as { __neonRiver?: Game }).__neonRiver = game;
  void import('./dev/DevTools').then(({ installDevTools }) => installDevTools(game, params.has('tune')));
}

// Leitmotif audition page: three candidate themes with play buttons.
if (dev && params.has('audition')) {
  void import('./dev/Audition').then(({ installAudition }) => installAudition(game));
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
