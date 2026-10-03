import GUI from 'lil-gui';
import { RIVER } from '../data/river';
import type { Game } from '../game/Game';
import type { RiverData } from '../sim/river';

/**
 * Dev-only: lil-gui tuning plus a path editor drawn over the game. Drag bank points to refit the
 * river to the painting, then "export" to copy JSON for src/data/river.ts.
 */
export function installDevTools(game: Game, openTune = false): void {
  const data = structuredClone(RIVER) as { -readonly [K in keyof RiverData]: RiverData[K] };
  const banks = data.banks.map((b) => [...b]) as [number, number, number, number][];
  const camera = { ...data.camera };
  const state = {
    editor: false,
    lanes: true,
    speedProfile: data.speedProfile,
    laneMargin: data.laneMargin,
  };

  const editor = document.createElement('canvas');
  editor.id = 'path-editor';
  Object.assign(editor.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'none', touchAction: 'none' });
  document.querySelector('#app')?.appendChild(editor);
  const ctx = editor.getContext('2d');

  const current = (): RiverData => ({
    camera: { ...camera },
    banks,
    railIndex: data.railIndex,
    laneMargin: state.laneMargin,
    speedProfile: state.speedProfile,
  });
  const apply = (): void => game.applyRiver(current());

  /** Painting pixels <-> CSS pixels of the editor canvas. */
  const toCss = (x: number, y: number): [number, number] => {
    const { originX, originY, scale, gridW } = game.view.layout;
    const dpr = window.devicePixelRatio || 1;
    const k = gridW / 768;
    return [((originX + x * k) * scale) / dpr, ((originY + y * k) * scale) / dpr];
  };
  const fromCss = (cx: number, cy: number): [number, number] => {
    const { originX, originY, scale, gridW } = game.view.layout;
    const dpr = window.devicePixelRatio || 1;
    const k = gridW / 768;
    return [((cx * dpr) / scale - originX) / k, ((cy * dpr) / scale - originY) / k];
  };

  const draw = (): void => {
    requestAnimationFrame(draw);
    if (!ctx || !state.editor) return;
    if (editor.width !== editor.clientWidth || editor.height !== editor.clientHeight) {
      editor.width = editor.clientWidth;
      editor.height = editor.clientHeight;
    }
    ctx.clearRect(0, 0, editor.width, editor.height);
    const river = game.river;
    if (state.lanes) {
      for (let lane = 0; lane <= 1.001; lane += 0.25) {
        ctx.beginPath();
        for (let s = 0; s <= river.maxS; s += 0.01) {
          const p = river.screenAt(s, lane);
          const [x, y] = toCss(p.x, p.y);
          if (s === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = lane === 0 || lane > 0.99 ? '#ff0' : 'rgba(255,255,0,0.4)';
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(...toCss(river.screenAt(1, 0).x, river.screenAt(1, 0).y));
      ctx.lineTo(...toCss(river.screenAt(1, 1).x, river.screenAt(1, 1).y));
      ctx.strokeStyle = '#f0f';
      ctx.stroke();
      for (const fish of game.sim.state.fish) {
        const p = river.screenAt(river.progressToS(fish.progress), fish.lane);
        const [x, y] = toCss(p.x, p.y);
        const [x2] = toCss(p.x + game.config.radii[fish.kind] * river.railWidth * p.scale, p.y);
        ctx.beginPath();
        ctx.ellipse(x, y, x2 - x, (x2 - x) * 0.5, 0, 0, Math.PI * 2);
        ctx.strokeStyle = fish.kind === 'eel' ? '#0ff' : '#fff';
        ctx.stroke();
      }
    }
    banks.forEach((b, i) => {
      for (const [x, y] of [toCss(b[0], b[1]), toCss(b[2], b[3])]) {
        ctx.fillStyle = i === data.railIndex ? '#f0f' : '#0f0';
        ctx.fillRect(x - 4, y - 4, 8, 8);
      }
    });
  };

  let drag: { bank: number; side: 0 | 2 } | null = null;
  editor.addEventListener('pointerdown', (e) => {
    const [px, py] = fromCss(e.offsetX, e.offsetY);
    let best = 30;
    banks.forEach((b, i) => {
      for (const side of [0, 2] as const) {
        const d = Math.hypot(b[side] - px, b[side + 1]! - py);
        if (d < best) {
          best = d;
          drag = { bank: i, side };
        }
      }
    });
  });
  editor.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const [px, py] = fromCss(e.offsetX, e.offsetY);
    const b = banks[drag.bank];
    if (!b) return;
    b[drag.side] = Math.round(px);
    b[drag.side + 1] = Math.round(py);
  });
  editor.addEventListener('pointerup', () => {
    if (drag) apply();
    drag = null;
  });

  const gui = new GUI({ title: 'Neon River dev' });
  gui.close();

  // ?tune: live pace multipliers. On its own it is a compact strip docked in the top-right corner,
  // over the sky: even open it never reaches the net, on a small phone or in landscape. It starts
  // collapsed to its title bar and collapses again as soon as the game is touched.
  const tune = { ...game.config.tune, values: '' };
  const tuneGui = openTune ? new GUI({ title: 'tune pace', autoPlace: false, width: 320 }) : gui.addFolder('tune (pace)');
  if (openTune) {
    gui.hide();
    const style = document.createElement('style');
    style.textContent =
      '#tune-dock{position:fixed;right:env(safe-area-inset-right,0);top:env(safe-area-inset-top,0);z-index:15;max-width:calc(100vw - 104px)}' +
      '#tune-dock .lil-gui{--widget-height:26px;--spacing:3px;--font-size:12px;--input-font-size:12px;--name-width:34%;width:min(300px,calc(100vw - 104px));max-height:42vh;overflow-y:auto}' +
      '#tune-dock .lil-gui .lil-controller{min-height:28px}';
    const dock = document.createElement('div');
    dock.id = 'tune-dock';
    dock.append(tuneGui.domElement);
    document.head.append(style);
    document.body.append(dock);
    window.addEventListener(
      'pointerdown',
      (event) => {
        if (!dock.contains(event.target as Node)) tuneGui.close();
      },
      true,
    );
  }
  const show = (): void => {
    const { speed, density, sweep, eel } = tune;
    tune.values = JSON.stringify({ speed, density, sweep, eel });
    game.setTune({ speed, density, sweep, eel });
    valuesField.updateDisplay();
  };
  tuneGui.add(tune, 'speed', 0.5, 2, 0.05).name('speed x').onChange(show);
  tuneGui.add(tune, 'density', 0.5, 2, 0.05).name('density x').onChange(show);
  tuneGui.add(tune, 'sweep', 0.25, 2, 0.05).name('sweep x').onChange(show);
  tuneGui.add(tune, 'eel', 0, 2, 0.05).name('eel x').onChange(show);
  const valuesField = tuneGui.add(tune, 'values').name('values');
  tuneGui
    .add(
      {
        copy: () => {
          show();
          // Clipboard needs a secure context; on a LAN dev URL the field above can be selected instead.
          void navigator.clipboard?.writeText(tune.values).catch(() => undefined);
        },
      },
      'copy',
    )
    .name('copy values');
  show();
  // Starts collapsed to its title bar; tap it to open.
  if (openTune) tuneGui.close();

  const river = gui.addFolder('river fit');
  river.add(camera, 'focal', 600, 2000, 10).onFinishChange(apply);
  river.add(camera, 'horizonY', 0, 300, 1).onFinishChange(apply);
  river.add(state, 'speedProfile', 0, 1, 0.05).onFinishChange(apply);
  river.add(state, 'laneMargin', 0, 0.2, 0.01).onFinishChange(apply);
  river.add(
    {
      export: () => {
        const json = JSON.stringify(current(), null, 2);
        void navigator.clipboard?.writeText(json);
        console.warn('River JSON (copied to clipboard):\n' + json);
      },
    },
    'export',
  );
  const net = gui.addFolder('net feel');
  const netCfg = { ...game.config.net };
  const setNet = (): void => {
    game.config = { ...game.config, net: { ...netCfg } };
  };
  net.add(netCfg, 'cap', 1, 4, 0.1).onChange(setNet);
  net.add(netCfg, 'accel', 4, 40, 1).onChange(setNet);
  net.add(netCfg, 'damping', 2, 30, 1).onChange(setNet);
  net.add(netCfg, 'followGain', 4, 30, 1).onChange(setNet);
  draw();
}
