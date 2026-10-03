import type { NetIntent } from '../sim/net';

export interface InputOptions {
  /** CSS-pixel x of lane 0 and lane 1 at the net rail. */
  readonly rail: () => { left: number; right: number };
  readonly onPause: () => void;
  readonly onConfirm: () => void;
  /** Space: pause/resume in play, confirm on menus. */
  readonly onSpace: () => void;
  /** Any press on the play surface (used to skip the win sequence). */
  readonly onTap: () => void;
  readonly onFirstGesture: () => void;
  /** A left or right arrow press, or a sideways swipe: the title screen's unlock code listens. */
  readonly onArrow?: (dir: -1 | 1, touch: boolean) => void;
  /** Enter, before anything else sees it: true means the title's code took it. */
  readonly onCode?: () => boolean;
}

const LEFT_KEYS = new Set(['ArrowLeft', 'KeyA']);
const RIGHT_KEYS = new Set(['ArrowRight', 'KeyD']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);
const DEADZONE = 0.18;

/**
 * Turns mouse, keyboard, touch and gamepad into net intents. The sim applies the same speed
 * cap to all of them, so this layer only decides *what the player asked for*.
 */
export class Input {
  touchMode: 'relative' | 'absolute' = 'relative';
  /** Lanes of net travel per rail-width of finger travel. */
  sensitivity = 1.25;

  private readonly held = new Set<string>();
  private device: 'none' | 'mouse' | 'keys' | 'touch' | 'pad' = 'none';
  private mouseLane = 0.5;
  private touchId: number | null = null;
  private touchX = 0;
  private swipeFrom: { id: number; x: number; y: number } | null = null;
  private pendingDelta = 0;
  private padStartHeld = false;
  private padConfirmHeld = false;
  private gestured = false;
  private readonly abort = new AbortController();

  constructor(
    surface: HTMLElement,
    private readonly options: InputOptions,
  ) {
    const signal = this.abort.signal;
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window): void =>
      target.addEventListener(type, fn as EventListener, { signal, passive: false });

    on('keydown', (e) => {
      this.gesture();
      if (e.repeat) return;
      // The audition tool is plain DOM over the game; its buttons keep their keys.
      if (document.getElementById('audition')) return;
      // Sliders keep their own keys, but pause keys still work from one.
      if (e.target instanceof HTMLInputElement) {
        if (PAUSE_KEYS.has(e.code)) {
          this.options.onPause();
          e.preventDefault();
        } else if (e.code === 'Space' && e.target.type === 'range') {
          this.options.onSpace();
          e.preventDefault();
        }
        return;
      }
      // The unlock code ends with Enter, whichever title button has focus.
      if (e.code === 'Enter' && this.options.onCode?.()) {
        e.preventDefault();
        return;
      }
      // The title's mode cards and Field Guide button are ordinary buttons: Space presses them.
      if (e.code === 'Space' && e.target instanceof HTMLButtonElement && /^btn-(mode-|guide)/.test(e.target.id)) return;
      // Buttons in the settings list keep Space and Enter for themselves.
      if (e.target instanceof HTMLButtonElement && e.target.closest('#settings-scroll') && (e.code === 'Space' || e.code === 'Enter'))
        return;
      if (LEFT_KEYS.has(e.code) || RIGHT_KEYS.has(e.code)) {
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') this.options.onArrow?.(e.code === 'ArrowLeft' ? -1 : 1, false);
        this.held.add(e.code);
        this.device = 'keys';
        e.preventDefault();
      } else if (PAUSE_KEYS.has(e.code)) {
        this.options.onPause();
        e.preventDefault();
      } else if (e.code === 'Space') {
        // Space only ever pauses or resumes during play; it never activates a focused control.
        this.options.onSpace();
        e.preventDefault();
      } else if (e.code === 'Enter') {
        // Buttons handle their own activation; only bare presses start or resume.
        if (!(e.target instanceof HTMLButtonElement)) {
          this.options.onConfirm();
          e.preventDefault();
        }
      }
    });
    on('keyup', (e) => this.held.delete(e.code));
    on('blur', () => this.held.clear());

    on(
      'pointerdown',
      (e) => {
        this.gesture();
        this.options.onTap();
        if (e.pointerType === 'mouse') return;
        // The newest finger takes over, so handing off between thumbs never drops input.
        this.touchId = e.pointerId;
        this.touchX = e.clientX;
        this.device = 'touch';
        if (this.touchMode === 'absolute') this.mouseLane = this.laneAt(e.clientX);
        e.preventDefault();
      },
      surface,
    );
    on('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.mouseLane = this.laneAt(e.clientX);
        this.device = 'mouse';
        return;
      }
      if (e.pointerId !== this.touchId) return;
      const { left, right } = this.options.rail();
      this.pendingDelta += ((e.clientX - this.touchX) / Math.max(1, right - left)) * this.sensitivity;
      this.touchX = e.clientX;
      if (this.touchMode === 'absolute') this.mouseLane = this.laneAt(e.clientX);
      this.device = 'touch';
    });
    // Swipes are watched on the whole window, so one that starts on a title button still counts.
    on('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') this.swipeFrom = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    const release = (e: PointerEvent): void => {
      if (e.pointerId === this.touchId) this.touchId = null;
      const from = this.swipeFrom;
      if (!from || from.id !== e.pointerId) return;
      this.swipeFrom = null;
      if (e.type !== 'pointerup') return;
      const dx = e.clientX - from.x;
      // A clearly sideways stroke counts as an arrow.
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(e.clientY - from.y) * 2) this.options.onArrow?.(dx < 0 ? -1 : 1, true);
    };
    on('pointerup', release);
    on('pointercancel', release);
    on('contextmenu', (e) => e.preventDefault(), surface);
  }

  /** The net intent for the next sim step. Relative drag is consumed once. */
  consume(): NetIntent {
    const pad = this.pollGamepad();
    const axis =
      (this.held.has('ArrowRight') || this.held.has('KeyD') ? 1 : 0) - (this.held.has('ArrowLeft') || this.held.has('KeyA') ? 1 : 0);
    if (axis !== 0) return { kind: 'axis', value: axis };
    if (pad !== 0) {
      this.device = 'pad';
      return { kind: 'axis', value: pad };
    }
    if (this.device === 'mouse') return { kind: 'target', lane: this.mouseLane };
    if (this.device === 'touch') {
      if (this.touchMode === 'absolute') return { kind: 'target', lane: this.mouseLane };
      const lanes = this.pendingDelta;
      this.pendingDelta = 0;
      return { kind: 'delta', lanes };
    }
    return { kind: 'none' };
  }

  /** Drop drag travel collected while the game was not consuming input (paused). */
  flush(): void {
    this.pendingDelta = 0;
  }

  /** Forget pointer state so a new run does not inherit a stale target. */
  reset(): void {
    this.pendingDelta = 0;
    this.device = 'none';
    this.held.clear();
  }

  dispose(): void {
    this.abort.abort();
  }

  private laneAt(clientX: number): number {
    const { left, right } = this.options.rail();
    return Math.min(1, Math.max(0, (clientX - left) / Math.max(1, right - left)));
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.options.onFirstGesture();
  }

  private pollGamepad(): number {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const start = pad.buttons[9]?.pressed ?? false;
      if (start && !this.padStartHeld) this.options.onPause();
      this.padStartHeld = start;
      const confirm = pad.buttons[0]?.pressed ?? false;
      if (confirm && !this.padConfirmHeld) {
        this.gesture();
        this.options.onConfirm();
      }
      this.padConfirmHeld = confirm;
      const x = pad.axes[0] ?? 0;
      const dpad = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      if (dpad !== 0) return dpad;
      if (Math.abs(x) > DEADZONE) return (Math.sign(x) * (Math.abs(x) - DEADZONE)) / (1 - DEADZONE);
      return 0;
    }
    return 0;
  }
}
