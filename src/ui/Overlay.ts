import type { LossCause } from '../sim/sim';

export type ButtonName = 'start' | 'resume' | 'retry' | 'home' | 'settings' | 'mute';
export type ControlName = ButtonName;

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

export type OverlayHandlers = Record<ButtonName, () => void>;

const el = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing element: ${selector}`);
  return node;
};

const MIN_TOUCH = 44;

/**
 * The accessible layer over the canvas. All visible UI is drawn in the game's pixel grid; these
 * are transparent, focusable controls placed over that art, plus a live region for screen readers.
 */
export class Overlay {
  private readonly controls = new Map<ControlName, HTMLElement>();
  private readonly status = el<HTMLElement>('#status');
  private readonly probe = el<HTMLElement>('#safe-area');
  private texel = 2;

  constructor(handlers: OverlayHandlers) {
    for (const name of ['start', 'resume', 'retry', 'home', 'settings', 'mute'] as const) {
      const button = el<HTMLButtonElement>(`#btn-${name}`);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        handlers[name]();
      });
      button.hidden = true;
      this.controls.set(name, button);
    }
  }

  /** CSS pixels per target texel. */
  setTexel(px: number): void {
    this.texel = px;
    document.documentElement.style.setProperty('--texel', `${px}px`);
  }

  setMuted(muted: boolean): void {
    const button = this.controls.get('mute');
    button?.setAttribute('aria-pressed', String(muted));
    button?.setAttribute('aria-label', muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off');
  }

  /** Put a control over its drawn art (target texels), padded out to a 44 px touch target. */
  place(name: ControlName, rect: TexelRect | null): void {
    const control = this.controls.get(name);
    if (!control) return;
    if (!rect) {
      if (!control.hidden) control.hidden = true;
      return;
    }
    // Pad in whole texels so the hit area and focus ring stay on the pixel grid.
    const t = this.texel;
    const padX = Math.max(0, Math.ceil((MIN_TOUCH - rect.w * t) / 2 / t));
    const padY = Math.max(0, Math.ceil((MIN_TOUCH - rect.h * t) / 2 / t));
    const x = Math.max(0, rect.x - padX) * t;
    const y = Math.max(0, rect.y - padY) * t;
    const w = (rect.w + padX * 2) * t;
    const h = (rect.h + padY * 2) * t;
    const style = `left:${x.toFixed(3)}px;top:${y.toFixed(3)}px;width:${w.toFixed(3)}px;height:${h.toFixed(3)}px`;
    if (control.getAttribute('style') !== style) control.setAttribute('style', style);
    if (control.hidden) control.hidden = false;
  }

  /** Safe-area insets in CSS pixels, read from a probe padded with env(safe-area-inset-*). */
  safeInsets(): { top: number; left: number; bottom: number } {
    const style = getComputedStyle(this.probe);
    return {
      top: parseFloat(style.paddingTop) || 0,
      left: parseFloat(style.paddingLeft) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
    };
  }

  /** Announce the screen and move focus to its main action. */
  announce(mode: string, summary: RunSummary): void {
    document.documentElement.dataset.mode = mode;
    const won = summary.cause === null;
    const text =
      mode === 'title'
        ? 'Neon River. Catch 200 pounds, do not let 20 pounds escape, never net an electric eel.'
        : mode === 'paused'
          ? 'Paused. Sound settings.'
          : mode === 'over'
            ? `${won ? 'A full net. You win.' : summary.cause === 'eel' ? 'An electric eel found your net.' : 'Too many fish slipped away.'} ${summary.caught} pounds caught, ${summary.escaped} escaped.`
            : '';
    this.status.textContent = text;
    const focus: ButtonName | null = mode === 'title' ? 'start' : mode === 'paused' ? 'resume' : mode === 'over' ? 'retry' : null;
    // Focus after the next placement so the button is visible.
    requestAnimationFrame(() => {
      if (focus) this.controls.get(focus)?.focus({ preventScroll: true });
      else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  }
}
