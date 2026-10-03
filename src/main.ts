import './styles.css';
import { Game } from './game/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
if (!canvas) throw new Error('Missing #game-canvas element.');

const params = new URLSearchParams(window.location.search);
const game = new Game(canvas, {
  grid: params.get('grid'),
  fish: params.get('fish'),
  forceByteRipples: params.get('ripple') === 'byte',
  seed: Number(params.get('seed')) || 1,
});
game.start();

// Dev tools (path editor, lil-gui) never load on the default production path.
if (import.meta.env.DEV || params.has('debug')) {
  (window as unknown as { __neonRiver?: Game }).__neonRiver = game;
  void import('./dev/DevTools').then(({ installDevTools }) => installDevTools(game));
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => game.dispose());
}
