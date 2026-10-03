import type { LossCause } from '../sim/sim';

export type ButtonName = 'start' | 'resume' | 'retry' | 'pause' | 'mute';

export interface RunSummary {
  readonly cause: LossCause | null;
  readonly caught: number;
  readonly escaped: number;
  readonly bestStreak: number;
}

export interface TexelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const el = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const MIN_TOUCH = 44;

/**
 * The accessible layer over the canvas. All visible UI is drawn in the game's pixel grid; these
 * are transparent, focusable buttons placed over that art, plus a live region for screen readers.
 */
export class Overlay {
  private readonly buttons: Record<ButtonName, HTMLButtonElement> = {
    start: el('#btn-start'),
    resume: el('#btn-resume'),
    retry: el('#btn-retry'),
    pause: el('#btn-pause'),
    mute: el('#btn-mute'),
  };
  private readonly status = el<HTMLElement>('#status');
  private texel = 2;

  constructor(handlers: Record<ButtonName, () => void>) {
    for (const [name, button] of Object.entries(this.buttons) as [ButtonName, HTMLButtonElement][]) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handlers[name]();
      });
      button.hidden = true;
    }
  }

  /** CSS pixels per target texel. */
  setTexel(px: number): void {
    this.texel = px;
    document.documentElement.style.setProperty('--texel', `${px}px`);
  }

  setMuted(muted: boolean): void {
    this.buttons.mute.setAttribute('aria-pressed', String(muted));
    this.buttons.mute.setAttribute('aria-label', muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
  }

  /** Put a button over its drawn art (target texels), padded out to a 44 px touch target. */
  place(name: ButtonName, rect: TexelRect | null): void {
    const button = this.buttons[name];
    if (!rect) {
      if (!button.hidden) button.hidden = true;
      return;
    }
    const t = this.texel;
    const w = Math.max(MIN_TOUCH, rect.w * t);
    const h = Math.max(MIN_TOUCH, rect.h * t);
    const x = Math.max(0, rect.x * t - (w - rect.w * t) / 2);
    const y = Math.max(0, rect.y * t - (h - rect.h * t) / 2);
    const style = `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${w.toFixed(1)}px;height:${h.toFixed(1)}px`;
    if (button.getAttribute('style') !== style) button.setAttribute('style', style);
    if (button.hidden) button.hidden = false;
  }

  /** Announce the screen and move focus to its main action. */
  announce(mode: string, summary: RunSummary): void {
    document.documentElement.dataset.mode = mode;
    const won = summary.cause === null;
    const text =
      mode === 'title'
        ? 'Neon River. Catch 200 pounds, let no more than 20 pounds escape, never net an electric eel.'
        : mode === 'paused'
          ? 'Paused.'
          : mode === 'over'
            ? `${won ? 'A full net.' : summary.cause === 'eel' ? 'An electric eel found your net.' : 'Too many fish slipped away.'} ${summary.caught} pounds caught, ${summary.escaped} escaped.`
            : '';
    this.status.textContent = text;
    const focus: ButtonName | null = mode === 'title' ? 'start' : mode === 'paused' ? 'resume' : mode === 'over' ? 'retry' : null;
    // Focus after the next placement so the button is visible.
    requestAnimationFrame(() => {
      if (focus) this.buttons[focus].focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  }
}
