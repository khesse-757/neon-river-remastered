import type { AudioBus } from '../audio/AudioBus';
import { THEMES } from '../audio/melody';
import {
  EQ_PRESET_IDS,
  EQ_RANGE,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  type AudioSettings,
  type Channel,
  type EqPreset,
} from '../audio/settings';
import { textCanvas } from '../render/PixelText';
import { HUD_SCALES, LOOKS, QUALITY_PRESETS, RESOLUTION_STEPS, type VisualSettings, type VisualStore } from '../render/visuals';

/** Width of the panel in texels. Fits a 320 px phone at one CSS pixel per texel. */
export const PANEL_WIDTH = 208;
const MIN_TOUCH = 44;
const PAD = 6;
const TRACK_W = 68;
const VALUE_W = 22;

interface SliderRow {
  kind: 'slider';
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (value: number) => void;
  text: (value: number) => string;
  /** An on/off switch in front of the slider (the simple panel's Music and Sounds). */
  toggle?: { name: string; get: () => boolean; set: (on: boolean) => void };
}
interface ToggleRow {
  kind: 'toggle';
  id: string;
  label: string;
  get: () => boolean;
  set: (on: boolean) => void;
}
interface ChoiceRow {
  kind: 'choice';
  id: string;
  label: string;
  options: readonly string[];
  get: () => number;
  set: (index: number) => void;
  preview?: () => void;
}
interface ButtonRow {
  kind: 'button';
  id: string;
  label: () => string;
  run: () => void;
  /** Leave room on the right for the live level meter. */
  meter?: boolean;
}
interface HeadingRow {
  kind: 'heading';
  text: string;
}
type Row = SliderRow | ToggleRow | ChoiceRow | ButtonRow | HeadingRow;

const COLORS = {
  back: '#06121c',
  edge: '#243e48',
  row: '#091a27',
  text: '#c5e1e8',
  dim: '#5f696b',
  accent: '#29bcc2',
  knob: '#ffd98a',
  heading: '#ffd98a',
  off: '#414d51',
};
const PLAY_ICON = ['#....', '##...', '###..', '####.', '###..', '##...', '#....'];

/**
 * The settings: four simple sound rows, and Advanced audio and Advanced visuals sections that expand below them.
 * Everything visible is composed on one canvas at one pixel per texel and drawn by the game as a
 * single quad. The DOM side is a transparent, natively scrolling list of real form controls laid
 * exactly over that art, so touch scrolling, keyboard focus and screen readers all work.
 */
export class SettingsPanel {
  readonly canvas = document.createElement('canvas');
  /** Bumped whenever the canvas is redrawn. */
  version = 0;
  private readonly scroller: HTMLDivElement;
  private readonly inner = document.createElement('div');
  private readonly controls = new Map<string, HTMLElement>();
  private rowList: Row[] = [];
  private advanced = false;
  private visualsOpen = false;
  private dirty = true;
  private built = '';
  private texel = 2;
  private rowH = 22;
  private scrollTexels = 0;
  private x = 0;
  private y = 0;
  private open = false;

  constructor(
    private readonly audio: AudioBus,
    private readonly visuals: VisualStore,
    private readonly hooks: { changed: () => void } = { changed: () => undefined },
  ) {
    const scroller = document.querySelector<HTMLDivElement>('#settings-scroll');
    if (!scroller) throw new Error('Missing element: #settings-scroll');
    this.scroller = scroller;
    this.scroller.hidden = true;
    this.scroller.append(this.inner);
    this.inner.className = 'settings-inner';
    this.scroller.addEventListener('scroll', () => (this.dirty = true), { passive: true });
  }

  get isAdvanced(): boolean {
    return this.advanced;
  }

  setAdvanced(open: boolean): void {
    this.advanced = open;
    this.built = '';
    this.dirty = true;
  }

  get isVisualsOpen(): boolean {
    return this.visualsOpen;
  }

  setVisualsOpen(open: boolean): void {
    this.visualsOpen = open;
    this.built = '';
    this.dirty = true;
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.scroller.hidden = true;
  }

  /**
   * Show the list in this window (target texels; `texel` is CSS pixels per texel). Returns the
   * canvas to draw at (x, y), redrawn only when something changed.
   */
  show(x: number, y: number, height: number, texel: number): HTMLCanvasElement {
    const rowH = Math.max(16, Math.ceil(MIN_TOUCH / texel));
    const h = Math.max(rowH * 2, Math.floor(height));
    const key = `${this.advanced}|${this.visualsOpen}|${texel}|${rowH}`;
    if (key !== this.built) {
      this.texel = texel;
      this.rowH = rowH;
      this.rowList = this.rows();
      this.build();
      this.built = key;
      this.dirty = true;
    }
    if (!this.open || x !== this.x || y !== this.y || h !== this.canvas.height) {
      this.open = true;
      this.x = x;
      this.y = y;
      this.canvas.width = PANEL_WIDTH;
      this.canvas.height = h;
      this.scroller.hidden = false;
      this.scroller.setAttribute(
        'style',
        `left:${(x * texel).toFixed(3)}px;top:${(y * texel).toFixed(3)}px;width:${(PANEL_WIDTH * texel).toFixed(3)}px;height:${(h * texel).toFixed(3)}px`,
      );
      this.dirty = true;
    }
    const scroll = Math.round(this.scroller.scrollTop / texel);
    if (scroll !== this.scrollTexels) {
      this.scrollTexels = scroll;
      this.dirty = true;
    }
    if (this.dirty) this.draw();
    return this.canvas;
  }

  /** Where the live level meter goes, in target texels, or null when its row is off screen. */
  meterRect(): { x: number; y: number; w: number; h: number } | null {
    const index = this.rowList.findIndex((r) => r.kind === 'button' && r.meter);
    if (!this.open || index < 0) return null;
    const top = this.rowTop(index) - this.scrollTexels;
    const y = top + Math.floor(this.rowH / 2) - 2;
    if (y < 0 || y + 5 > this.canvas.height) return null;
    return { x: this.x + PANEL_WIDTH - PAD - 62, y: this.y + y, w: 60, h: 5 };
  }

  private rowTop(index: number): number {
    return 2 + index * this.rowH;
  }

  private rows(): Row[] {
    const audio = this.audio;
    const s = audio.settings;
    const percent = (v: number): string => String(Math.round(v));
    const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));
    const fader = (id: string, label: string, key: Channel, toggle?: SliderRow['toggle']): SliderRow => ({
      kind: 'slider',
      id,
      label,
      min: 0,
      max: 100,
      step: 5,
      get: () => Math.round(s.volume[key] * 100),
      set: (v) => {
        audio.setVolume(key, v / 100);
        audio.preview(key);
      },
      text: percent,
      toggle,
    });
    const master = (id: string): SliderRow => ({
      kind: 'slider',
      id,
      label: 'MASTER',
      min: 0,
      max: 100,
      step: 5,
      get: () => Math.round(s.master * 100),
      set: (v) => audio.update({ master: v / 100 }),
      text: percent,
    });
    const tone = (id: 'bass' | 'mid' | 'treble', label: string): SliderRow => ({
      kind: 'slider',
      id,
      label,
      min: -EQ_RANGE,
      max: EQ_RANGE,
      step: 1,
      get: () => s[id],
      // Moving a tone slider by hand leaves the preset.
      set: (v) => audio.update({ [id]: v, eq: 'custom' } as Partial<AudioSettings>),
      text: signed,
    });
    const flag = (id: 'mono' | 'muteInBackground' | 'haptics', label: string): ToggleRow => ({
      kind: 'toggle',
      id,
      label,
      get: () => s[id],
      set: (on) => audio.update({ [id]: on } as Partial<AudioSettings>),
    });
    const simple: Row[] = [
      master('master'),
      fader('music', 'MUSIC', 'music', { name: 'Music', get: () => s.enabled.music, set: (on) => audio.setEnabled('music', on) }),
      {
        // One fader for everything that is not music or Fish Notes: it moves splashes, ambience
        // and UI together. Advanced audio sets them apart.
        ...fader('sounds', 'SOUNDS', 'sfx', { name: 'Sounds', get: () => s.enabled.sfx, set: (on) => audio.setEnabled('sfx', on) }),
        set: (v: number) => {
          for (const key of ['sfx', 'ambience', 'ui'] as const) audio.setVolume(key, v / 100);
          audio.preview('sfx');
        },
      },
      {
        kind: 'toggle',
        id: 'notes',
        label: 'FISH NOTES',
        get: () => s.enabled.notes,
        set: (on) => {
          audio.setEnabled('notes', on);
          if (on) audio.previewInstrument();
        },
      },
      {
        kind: 'button',
        id: 'advanced',
        label: () => (this.advanced ? 'ADVANCED AUDIO  -' : 'ADVANCED AUDIO  +'),
        run: () => this.setAdvanced(!this.advanced),
      },
    ];
    return [...simple, ...(this.advanced ? this.audioRows(master, fader, tone, flag, percent) : []), ...this.visualRows()];
  }

  /** Advanced visuals: every row applies at once and is saved by the store. */
  private visualRows(): Row[] {
    const store = this.visuals;
    const opener: Row = {
      kind: 'button',
      id: 'visuals',
      label: () => (this.visualsOpen ? 'ADVANCED VISUALS  -' : 'ADVANCED VISUALS  +'),
      run: () => this.setVisualsOpen(!this.visualsOpen),
    };
    if (!this.visualsOpen) return [opener];
    type Flag = { [K in keyof VisualSettings]: VisualSettings[K] extends boolean ? K : never }[keyof VisualSettings];
    const flag = (key: Flag, label: string): ToggleRow => ({
      kind: 'toggle',
      id: `vis-${key}`,
      label,
      get: () => store.settings[key],
      set: (on) => store.update({ [key]: on } as Partial<VisualSettings>),
    });
    const percent = (v: number): string => String(Math.round(v));
    return [
      opener,
      { kind: 'heading', text: 'PICTURE' },
      {
        kind: 'choice',
        id: 'vis-quality',
        label: 'QUALITY',
        options: QUALITY_PRESETS.map((q) => q.toUpperCase()),
        get: () => QUALITY_PRESETS.indexOf(store.settings.quality),
        set: (i) => store.update({ quality: QUALITY_PRESETS[i] ?? 'auto' }),
      },
      {
        kind: 'choice',
        id: 'vis-resolution',
        label: 'RENDER',
        options: RESOLUTION_STEPS.map((r) => `${Math.round(r * 100)}%`),
        get: () => RESOLUTION_STEPS.indexOf(store.settings.resolution),
        set: (i) => store.update({ resolution: RESOLUTION_STEPS[i] ?? 1 }),
      },
      {
        kind: 'choice',
        id: 'vis-look',
        label: 'LOOK',
        options: LOOKS.map((l) => l.label),
        get: () => LOOKS.findIndex((l) => l.id === store.settings.look),
        set: (i) => store.update({ look: LOOKS[i]?.id ?? 'night' }),
      },
      {
        kind: 'slider',
        id: 'vis-bloom',
        label: 'BLOOM',
        min: 0,
        max: 150,
        step: 10,
        get: () => Math.round(store.settings.bloomIntensity * 100),
        set: (v) => store.update({ bloomIntensity: v / 100 }),
        text: percent,
        toggle: { name: 'Bloom', get: () => store.settings.bloom, set: (on) => store.update({ bloom: on }) },
      },
      flag('reflections', 'WATER REFLECTIONS'),
      flag('weather', 'WEATHER'),
      {
        kind: 'slider',
        id: 'vis-particles',
        label: 'PARTICLES',
        min: 0,
        max: 100,
        step: 10,
        get: () => Math.round(store.settings.particles * 100),
        set: (v) => store.update({ particles: v / 100 }),
        text: percent,
      },
      { kind: 'heading', text: 'MOTION' },
      flag('drift', 'CAMERA DRIFT'),
      flag('shake', 'SCREEN SHAKE'),
      flag('reduceMotion', 'REDUCE MOTION'),
      flag('reduceFlashing', 'REDUCE FLASHING'),
      { kind: 'heading', text: 'HUD' },
      {
        kind: 'choice',
        id: 'vis-hud',
        label: 'HUD SIZE',
        options: HUD_SCALES.map((k) => `${k}X`),
        get: () => HUD_SCALES.indexOf(store.settings.hudScale),
        set: (i) => store.update({ hudScale: HUD_SCALES[i] ?? 1 }),
      },
      flag('showFps', 'SHOW FPS'),
      { kind: 'button', id: 'vis-reset', label: () => 'RESET VISUALS', run: () => store.reset() },
    ];
  }

  private audioRows(
    master: (id: string) => SliderRow,
    fader: (id: string, label: string, key: Channel) => SliderRow,
    tone: (id: 'bass' | 'mid' | 'treble', label: string) => SliderRow,
    flag: (id: 'mono' | 'muteInBackground' | 'haptics', label: string) => ToggleRow,
    percent: (v: number) => string,
  ): Row[] {
    const audio = this.audio;
    const s = audio.settings;
    // Moving a tone slider leaves the preset; Night keeps its quieter, compressed output while edited.
    const presets = [...EQ_PRESET_IDS.map((p) => p.toUpperCase()), 'CUSTOM', 'NIGHT, EDITED'];
    return [
      { kind: 'heading', text: 'VOLUME' },
      master('adv-master'),
      fader('adv-music', 'MUSIC', 'music'),
      fader('adv-ambience', 'AMBIENCE', 'ambience'),
      fader('adv-sfx', 'SPLASH + SFX', 'sfx'),
      fader('adv-notes', 'FISH NOTES', 'notes'),
      fader('adv-ui', 'UI', 'ui'),
      { kind: 'heading', text: 'FISH NOTES' },
      {
        kind: 'choice',
        id: 'instrument',
        label: 'VOICE',
        options: INSTRUMENTS.map((i) => INSTRUMENT_LABELS[i]),
        get: () => INSTRUMENTS.indexOf(s.instrument),
        set: (i) => {
          audio.update({ instrument: INSTRUMENTS[i] ?? 'koto' });
          audio.previewInstrument();
        },
        preview: () => audio.previewInstrument(),
      },
      {
        kind: 'choice',
        id: 'theme',
        label: 'THEME',
        options: THEMES.map((t) => t.id.toUpperCase()),
        get: () => THEMES.findIndex((t) => t.id === audio.theme.id),
        set: (i) => {
          audio.setTheme(THEMES[i]?.id ?? 'ripple');
          audio.previewTheme();
        },
        preview: () => audio.previewTheme(),
      },
      { kind: 'heading', text: 'TONE' },
      {
        kind: 'choice',
        id: 'eq',
        label: 'EQ',
        options: presets,
        get: () => (s.eq === 'custom' ? EQ_PRESET_IDS.length + (s.night ? 1 : 0) : EQ_PRESET_IDS.indexOf(s.eq)),
        // The two edited states are where the sliders put you; stepping on from them returns to a preset.
        set: (i) => audio.setEqPreset(EQ_PRESET_IDS[i % EQ_PRESET_IDS.length] as EqPreset),
      },
      tone('bass', 'BASS'),
      tone('mid', 'MID'),
      tone('treble', 'TREBLE'),
      {
        kind: 'slider',
        id: 'reverb',
        label: 'REVERB',
        min: 0,
        max: 100,
        step: 5,
        get: () => Math.round(s.reverb * 100),
        set: (v) => {
          audio.update({ reverb: v / 100 });
          audio.preview('notes');
        },
        text: percent,
      },
      flag('mono', 'MONO'),
      flag('muteInBackground', 'MUTE IN BACKGROUND'),
      flag('haptics', 'HAPTICS'),
      { kind: 'button', id: 'test', label: () => (s.muted ? 'TEST (MUTED)' : 'TEST SOUND'), run: () => audio.testSound(), meter: true },
      {
        kind: 'button',
        id: 'reset',
        label: () => 'RESET TO DEFAULTS',
        run: () => {
          audio.resetSettings();
          audio.testSound();
        },
      },
    ];
  }

  /** Rebuild the transparent controls for the current rows. */
  private build(): void {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.id : '';
    this.inner.replaceChildren();
    this.controls.clear();
    const t = this.texel;
    const place = (el: HTMLElement, x: number, top: number, w: number): void => {
      el.setAttribute(
        'style',
        `left:${(x * t).toFixed(3)}px;top:${(top * t).toFixed(3)}px;width:${(w * t).toFixed(3)}px;height:${(this.rowH * t).toFixed(3)}px`,
      );
      this.inner.append(el);
      this.controls.set(el.id, el);
    };
    const changed = (): void => {
      void this.audio.unlock();
      this.sync();
      this.dirty = true;
      this.hooks.changed();
    };
    const button = (id: string, label: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `set-${id}`;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.audio.unlock().then(() => {
          run();
          this.audio.uiTick();
          changed();
        });
      });
      return b;
    };
    const { trackX, previewW, choiceX } = this.metrics();
    this.rowList.forEach((row, index) => {
      const top = this.rowTop(index);
      if (row.kind === 'slider') {
        if (row.toggle) {
          const toggle = row.toggle;
          const box = document.createElement('input');
          box.type = 'checkbox';
          box.id = `set-${row.id}-on`;
          box.setAttribute('aria-label', `${toggle.name} on`);
          box.addEventListener('change', () => {
            toggle.set(box.checked);
            this.audio.uiTick();
            changed();
          });
          place(box, 0, top, trackX - 4);
        }
        const range = document.createElement('input');
        range.type = 'range';
        range.id = `set-${row.id}`;
        range.min = String(row.min);
        range.max = String(row.max);
        range.step = String(row.step);
        range.setAttribute('aria-label', row.label.toLowerCase());
        range.addEventListener('input', () => {
          row.set(Number(range.value));
          changed();
        });
        place(range, trackX, top, TRACK_W);
        // The range keeps keyboard and screen-reader control; pointers go through this grip, so a
        // touch that starts on a slider can still scroll the list. A fader only moves on a tap or
        // on a drag that is clearly sideways.
        const grip = document.createElement('div');
        grip.id = `set-${row.id}-grip`;
        grip.className = 'settings-grip';
        grip.setAttribute('aria-hidden', 'true');
        const apply = (clientX: number): void => {
          const box = grip.getBoundingClientRect();
          // The same mapping the knob is drawn with, so the value under the finger is the value set.
          const f = Math.min(1, Math.max(0, ((clientX - box.left) / t - 2) / (TRACK_W - 4)));
          const value = Math.round((row.min + f * (row.max - row.min)) / row.step) * row.step;
          if (value === row.get()) return;
          range.value = String(value);
          row.set(value);
          changed();
        };
        let drag: { id: number; x: number; y: number; active: boolean } | null = null;
        grip.addEventListener('pointerdown', (e) => {
          drag = { id: e.pointerId, x: e.clientX, y: e.clientY, active: e.pointerType !== 'touch' };
          if (!drag.active) return;
          grip.setPointerCapture(e.pointerId);
          apply(e.clientX);
        });
        grip.addEventListener('pointermove', (e) => {
          if (!drag || drag.id !== e.pointerId) return;
          if (!drag.active) {
            const dx = Math.abs(e.clientX - drag.x);
            if (dx < 8 || dx < Math.abs(e.clientY - drag.y) * 1.5) return;
            drag.active = true;
            grip.setPointerCapture(e.pointerId);
          }
          apply(e.clientX);
        });
        grip.addEventListener('pointerup', (e) => {
          // A tap (no scroll, no drag) sets the fader to where it landed.
          if (drag && drag.id === e.pointerId && !drag.active && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) apply(e.clientX);
          drag = null;
        });
        // The browser took the gesture for scrolling.
        grip.addEventListener('pointercancel', () => (drag = null));
        place(grip, trackX, top, TRACK_W);
      } else if (row.kind === 'toggle') {
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = `set-${row.id}`;
        box.setAttribute('aria-label', row.label.toLowerCase());
        box.addEventListener('change', () => {
          row.set(box.checked);
          this.audio.uiTick();
          changed();
        });
        place(box, 0, top, PANEL_WIDTH);
      } else if (row.kind === 'choice') {
        const next = button(row.id, `${row.label.toLowerCase()}: change`, () => row.set((row.get() + 1) % row.options.length));
        place(next, choiceX, top, PANEL_WIDTH - choiceX - (row.preview ? previewW + 2 : 0));
        if (row.preview)
          place(button(`${row.id}-preview`, `preview ${row.label.toLowerCase()}`, row.preview), PANEL_WIDTH - previewW, top, previewW);
      } else if (row.kind === 'button') {
        place(button(row.id, row.label().toLowerCase(), row.run), 0, top, PANEL_WIDTH);
      }
    });
    this.inner.style.height = `${((this.rowTop(this.rowList.length) + 4) * t).toFixed(3)}px`;
    this.sync();
    // Rebuilding (opening Advanced) must not drop keyboard focus.
    if (focused) this.controls.get(focused)?.focus({ preventScroll: true });
  }

  /** Put the settings' current values into the controls (a preset or reset moves several at once). */
  private sync(): void {
    for (const row of this.rowList) {
      if (row.kind === 'slider') {
        (this.controls.get(`set-${row.id}`) as HTMLInputElement).value = String(row.get());
        if (row.toggle) (this.controls.get(`set-${row.id}-on`) as HTMLInputElement).checked = row.toggle.get();
      } else if (row.kind === 'toggle') (this.controls.get(`set-${row.id}`) as HTMLInputElement).checked = row.get();
      else if (row.kind === 'choice')
        this.controls
          .get(`set-${row.id}`)
          ?.setAttribute('aria-label', `${row.label.toLowerCase()}: ${row.options[row.get()] ?? ''}. change`);
    }
  }

  private metrics(): { trackX: number; previewW: number; choiceX: number } {
    const previewW = Math.max(22, Math.ceil(MIN_TOUCH / this.texel));
    return { trackX: PANEL_WIDTH - PAD - VALUE_W - TRACK_W, previewW, choiceX: 58 };
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    this.dirty = false;
    this.version += 1;
    const { width, height } = this.canvas;
    const rowH = this.rowH;
    const { trackX, previewW, choiceX } = this.metrics();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = COLORS.edge;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = COLORS.back;
    ctx.fillRect(1, 1, width - 2, height - 2);
    const text = (str: string, x: number, y: number, hex: string, align: 'left' | 'right' | 'center' = 'left'): void => {
      const bitmap = textCanvas(str, hex);
      const left = align === 'right' ? x - bitmap.width : align === 'center' ? x - Math.floor(bitmap.width / 2) : x;
      ctx.drawImage(bitmap, Math.round(left), Math.round(y));
    };
    const rect = (x: number, y: number, w: number, h: number, hex: string): void => {
      ctx.fillStyle = hex;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };
    const box = (x: number, mid: number, on: boolean): void => {
      rect(x, mid - 5, 9, 9, '#99c8cd');
      rect(x + 1, mid - 4, 7, 7, on ? COLORS.accent : COLORS.row);
    };

    this.rowList.forEach((row, index) => {
      const top = this.rowTop(index) - this.scrollTexels;
      if (top + rowH < 0 || top > height) return;
      const mid = top + Math.floor(rowH / 2);
      const textY = mid - 4;
      if (row.kind === 'heading') {
        text(row.text, PAD, mid - 1, COLORS.heading);
        rect(PAD, mid + 9, width - PAD * 2, 1, COLORS.edge);
        return;
      }
      rect(2, top + 1, width - 4, rowH - 2, COLORS.row);
      if (row.kind === 'slider') {
        const on = row.toggle ? row.toggle.get() : true;
        text(row.label, PAD, textY, on ? COLORS.text : COLORS.dim);
        if (row.toggle) box(trackX - 16, mid, on);
        const value = row.get();
        const f = (value - row.min) / (row.max - row.min);
        rect(trackX, mid - 1, TRACK_W, 3, COLORS.edge);
        if (row.min < 0) {
          // Tone sliders fill from the centre.
          const centre = trackX + TRACK_W / 2;
          rect(Math.min(centre, trackX + TRACK_W * f), mid - 1, Math.abs(TRACK_W * (f - 0.5)), 3, COLORS.accent);
          rect(centre, mid - 3, 1, 7, COLORS.dim);
        } else rect(trackX, mid - 1, TRACK_W * f, 3, on ? COLORS.accent : COLORS.off);
        rect(trackX + (TRACK_W - 4) * f, mid - 4, 4, 9, on ? COLORS.knob : '#7c806a');
        text(row.text(value), width - PAD, textY, on ? COLORS.text : COLORS.dim, 'right');
      } else if (row.kind === 'toggle') {
        text(row.label, PAD, textY, row.get() ? COLORS.text : '#99c8cd');
        box(width - PAD - 9, mid, row.get());
      } else if (row.kind === 'choice') {
        text(row.label, PAD, textY, COLORS.text);
        const right = width - (row.preview ? previewW + 2 : 0) - 3;
        rect(choiceX, top + 3, right - choiceX, rowH - 6, COLORS.edge);
        text(row.options[row.get()] ?? '', choiceX + 5, textY, COLORS.knob);
        text('>', right - 4, textY, COLORS.accent, 'right');
        if (row.preview) {
          const px = width - previewW;
          rect(px, top + 3, previewW - 3, rowH - 6, COLORS.edge);
          const ix = px + Math.floor((previewW - 3 - 5) / 2);
          PLAY_ICON.forEach((line, yy) => [...line].forEach((c, xx) => c === '#' && rect(ix + xx, mid - 3 + yy, 1, 1, COLORS.knob)));
        }
      } else {
        rect(PAD, top + 3, width - PAD * 2, rowH - 6, '#604336');
        rect(PAD, top + 3, width - PAD * 2, 1, '#a0977a');
        if (row.meter) {
          text(row.label(), PAD + 6, textY, COLORS.knob);
          // The meter's well; the game draws the live level over it every frame.
          rect(width - PAD - 63, mid - 3, 62, 7, '#030911');
        } else text(row.label(), width / 2, textY, COLORS.knob, 'center');
      }
    });

    // A pixel scrollbar when the list is taller than its window.
    const content = this.rowTop(this.rowList.length) + 4;
    if (content > height) {
      const bar = Math.max(8, Math.round((height * height) / content));
      const at = Math.round(((height - bar) * this.scrollTexels) / Math.max(1, content - height));
      rect(width - 2, at, 2, bar, COLORS.accent);
    }
  }
}
