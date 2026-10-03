import type * as THREE from 'three';
import { V1_SPRITES } from '../data/v1Sprites';
import { PIXEL_FONT, textCanvas } from '../render/PixelText';
import { DEFAULT_CONFIG } from '../sim/config';
import { Turntable } from './Turntable';

export type GalleryEntryId = 'bluegill' | 'koi' | 'eel' | 'net';
export type GalleryView = 'original' | 'remaster';

export interface GalleryContext {
  /** Element to mount in (the game's #overlay, which covers the canvas; position: absolute children fill it). */
  host: HTMLElement;
  /** CSS pixels per pixel-art texel right now (may be fractional, e.g. 1.667 on a DPR-3 phone; ≥ 1). */
  texel: number;
  /** The game's 4-step toon gradient ramp texture (NearestFilter), for MeshToonMaterial.gradientMap. */
  ramp: THREE.Texture;
  /** Lifetime counts: fish netted per species; for 'eel' it is the number of times an eel was netted; 'net' is total fish netted. */
  counts: Record<GalleryEntryId, number>;
  reducedMotion: boolean;
  /** Play the UI tick sound. */
  tick: () => void;
  /** Called once when the player leaves (Back button, Esc). The gallery must already have removed its DOM and disposed its GPU resources. */
  onClose: () => void;
}

export interface GalleryHandle {
  close(): void;
  resize(texel: number): void;
  select(id: GalleryEntryId): void;
  setView(view: GalleryView): void;
}

interface Entry {
  readonly name: string;
  /** Tab labels, longest first; the first that fits is drawn. */
  readonly tab: readonly string[];
  readonly stat: readonly [label: string, value: string];
  readonly countLabel: string;
  readonly behaviour: string;
  readonly lore: string;
  /** What the swim toggle is called for this entry. */
  readonly motion: string;
}

const ORDER: readonly GalleryEntryId[] = ['bluegill', 'koi', 'eel', 'net'];
const { weights, winWeight: goalWeight, maxEscaped, telegraphLead } = DEFAULT_CONFIG;
/** The hoop's width as a share of the river's. */
const REACH = Math.round(DEFAULT_CONFIG.net.radius * 2 * 100);

/** Written in sentence case for screen readers; drawn in capitals. */
const ENTRIES: Record<GalleryEntryId, Entry> = {
  bluegill: {
    name: 'Bluegill',
    tab: ['Bluegill', 'Gill'],
    stat: ['Weight', `${weights.bluegill} lb`],
    countLabel: 'Netted',
    behaviour: `Comes down the river in long snaking chains. Follow the curve with the net: every one that slips past counts toward the ${maxEscaped} lb you may lose.`,
    lore: 'River folk say each one carries a sliver of the moon downstream.',
    motion: 'Swim',
  },
  koi: {
    name: 'Golden Koi',
    tab: ['Koi'],
    stat: ['Weight', `${weights.koi} lb`],
    countLabel: 'Netted',
    behaviour: `A gold gleam riding in the chain. Worth five bluegill toward your ${goalWeight} lb, and five lost if it gets by you.`,
    lore: 'Older than the lanterns on the bridge, and never once in a hurry.',
    motion: 'Swim',
  },
  eel: {
    name: 'Electric Eel',
    tab: ['Eel'],
    stat: ['Weight', 'Ends the night'],
    countLabel: 'Shocks',
    behaviour: `A cold glow on the water warns you ${telegraphLead} s before it arrives. Pull the net aside and let it pass. Net one and the night is over.`,
    lore: 'It drinks the neon that spills from the city and hums with what it stole.',
    motion: 'Swim',
  },
  net: {
    name: 'The Net',
    tab: ['Net'],
    stat: ['Reach', `${REACH}% of the river`],
    countLabel: 'Netted',
    behaviour: `Slide it from bank to bank. It scoops whatever crosses the hoop, so keep it clear of eels. Fill the basket with ${goalWeight} lb to win the night.`,
    lore: 'Bamboo from the old bank, a hinge from the new city. It remembers every fish.',
    motion: 'Sway',
  },
};

const C = {
  deep: '#030911',
  back: '#06121c',
  edge: '#243e48',
  row: '#091a27',
  text: '#c5e1e8',
  dim: '#5f696b',
  soft: '#99c8cd',
  accent: '#29bcc2',
  gold: '#ffd98a',
  cyan: '#8ff8ff',
  button: '#604336',
  lip: '#a0977a',
  off: '#414d51',
};
/** The wells' night water, top to bottom. */
const WATER = ['#0b2536', '#092031', '#071a29', '#051421'];
const MIN_TOUCH = 44;
const GAP = 3;
const LINE = 9;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Card {
  readonly splitCount: boolean;
  readonly behaviour: string[];
  readonly lore: string[];
  readonly height: number;
}
interface Layout {
  W: number;
  H: number;
  wide: boolean;
  compact: boolean;
  back: Rect;
  title: Rect | null;
  tabs: Rect[] | null;
  prev: Rect;
  next: Rect;
  name: Rect;
  view: Rect | null;
  spin: Rect;
  swim: Rect;
  heads: { original: Rect; remaster: Rect } | null;
  wells: Partial<Record<GalleryView, Rect>>;
  card: Rect;
}

let measurer: CanvasRenderingContext2D | null = null;
function measure(text: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 6;
  measurer.font = `8px ${PIXEL_FONT}`;
  return Math.ceil(measurer.measureText(text).width);
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** A well's drawable area (inside the frame, above the caption strip), in texels. */
const wellArea = (r: Rect): Rect => ({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 - 11 });

class Gallery implements GalleryHandle {
  private readonly root = document.createElement('div');
  private readonly stage = document.createElement('div');
  private readonly ui = document.createElement('canvas');
  private readonly sprite = document.createElement('canvas');
  private readonly info = document.createElement('p');
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly listeners = new AbortController();
  private readonly observer: ResizeObserver | null;
  private turntable: Turntable | null = null;
  private entry: GalleryEntryId = 'bluegill';
  private view: GalleryView = 'remaster';
  private texel: number;
  private layout: Layout | null = null;
  private animate: boolean;
  private spin: boolean;
  private spriteTime = 0;
  private spriteFrame = -1;
  private raf = 0;
  private last = 0;
  private closed = false;

  constructor(private readonly ctx: GalleryContext) {
    this.texel = Math.max(1, ctx.texel);
    this.animate = !ctx.reducedMotion;
    this.spin = !ctx.reducedMotion;
    const signal = this.listeners.signal;

    const { root, stage } = this;
    root.id = 'gallery';
    root.tabIndex = -1;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Field guide');
    stage.className = 'gal-stage';
    this.ui.className = 'gal-ui';
    this.ui.setAttribute('aria-hidden', 'true');
    this.sprite.id = 'gal-sprite';
    this.sprite.setAttribute('role', 'img');
    this.info.className = 'gal-sr';
    this.info.setAttribute('role', 'status');
    this.info.setAttribute('aria-live', 'polite');
    stage.append(this.ui, this.sprite);

    try {
      this.turntable = new Turntable(ctx.ramp, ctx.reducedMotion);
      const canvas = this.turntable.canvas;
      canvas.id = 'gal-model';
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'img');
      stage.append(canvas);
    } catch {
      // No WebGL context to spare: the guide still works, with the well saying so.
      this.turntable = null;
    }

    // In reading order: back, entries, views and toggles.
    this.button('gal-back', () => this.close());
    for (const id of ORDER) this.button(`gal-tab-${id}`, () => this.select(id));
    this.button('gal-prev', () => this.step(-1));
    this.button('gal-next', () => this.step(1));
    this.button('gal-view', () => this.setView(this.view === 'original' ? 'remaster' : 'original'));
    this.button('gal-spin', () => {
      this.spin = !this.spin;
      this.refresh();
    });
    this.button('gal-swim', () => {
      this.animate = !this.animate;
      this.refresh();
    });
    stage.append(this.info);
    root.append(stage);

    // Nothing in here reaches the game underneath.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick'] as const)
      root.addEventListener(type, (e) => e.stopPropagation(), { signal });
    for (const type of ['touchstart', 'touchmove', 'touchend', 'wheel'] as const)
      root.addEventListener(type, (e) => e.stopPropagation(), { signal, passive: true });
    root.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    // Captured at the window, so the game's own key handlers never see a key while the guide is open.
    window.addEventListener('keydown', (e) => this.key(e), { signal, capture: true });
    window.addEventListener('keyup', (e) => e.stopPropagation(), { signal, capture: true });

    ctx.host.append(root);
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.relayout());
    this.observer?.observe(stage);
    this.relayout();
    root.focus({ preventScroll: true });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.listeners.abort();
    this.observer?.disconnect();
    this.turntable?.dispose();
    this.turntable = null;
    this.root.remove();
    this.ctx.onClose();
  }

  resize(texel: number): void {
    if (this.closed) return;
    this.texel = Math.max(1, texel);
    this.relayout();
  }

  select(id: GalleryEntryId): void {
    if (this.closed || !ORDER.includes(id) || id === this.entry) return;
    this.entry = id;
    this.spriteTime = 0;
    this.refresh();
  }

  setView(view: GalleryView): void {
    if (this.closed || (view !== 'original' && view !== 'remaster') || view === this.view) return;
    this.view = view;
    this.relayout();
  }

  private step(by: number): void {
    const index = (ORDER.indexOf(this.entry) + by + ORDER.length) % ORDER.length;
    this.select(ORDER[index] ?? 'bluegill');
  }

  private button(id: string, run: () => void): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.addEventListener(
      'click',
      () => {
        if (this.closed) return;
        this.ctx.tick();
        run();
      },
      { signal: this.listeners.signal },
    );
    this.stage.append(b);
    this.buttons.set(id, b);
  }

  private key(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const onModel = this.turntable !== null && document.activeElement === this.turntable.canvas;
    const turn = 0.2;
    if (e.key === 'Escape') this.close();
    else if (onModel && e.key === 'ArrowLeft') this.turntable?.nudge(-turn, 0, 1);
    else if (onModel && e.key === 'ArrowRight') this.turntable?.nudge(turn, 0, 1);
    else if (onModel && e.key === 'ArrowUp') this.turntable?.nudge(0, turn / 2, 1);
    else if (onModel && e.key === 'ArrowDown') this.turntable?.nudge(0, -turn / 2, 1);
    else if (onModel && (e.key === '+' || e.key === '=')) this.turntable?.nudge(0, 0, 1.15);
    else if (onModel && e.key === '-') this.turntable?.nudge(0, 0, 1 / 1.15);
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === 'ArrowRight') this.step(1);
    else return;
    e.preventDefault();
  }

  private readonly frame = (now: number): void => {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const layout = this.layout;
    if (!layout) return;
    if (layout.wells.original) {
      if (this.animate) this.spriteTime += dt;
      this.drawSprite();
    }
    if (layout.wells.remaster && this.turntable) {
      this.turntable.spin = this.spin;
      this.turntable.swim = this.animate;
      this.turntable.frame(dt);
    }
  };

  /** The card for one entry at this width; the tallest of the four sets the card's height. */
  private cardFor(id: GalleryEntryId, width: number): Card {
    const e = ENTRIES[id];
    const inner = width - 12;
    const stat = measure(`${e.stat[0]}  ${e.stat[1]}`.toUpperCase());
    const count = measure(this.countText(id));
    const splitCount = stat + 10 + count > inner;
    const behaviour = wrap(e.behaviour.toUpperCase(), inner);
    const lore = wrap(e.lore.toUpperCase(), inner);
    const height = 5 + LINE + (splitCount ? LINE : 0) + 3 + behaviour.length * LINE + 3 + lore.length * LINE + 4;
    return { splitCount, behaviour, lore, height };
  }

  private countText(id: GalleryEntryId): string {
    const n = Math.max(0, Math.floor(Number(this.ctx.counts[id]) || 0));
    return `${ENTRIES[id].countLabel} ${n}`.toUpperCase();
  }

  private compute(): Layout {
    const t = this.texel;
    const W = Math.max(120, Math.floor(this.stage.clientWidth / t));
    const H = Math.max(140, Math.floor(this.stage.clientHeight / t));
    const btn = Math.max(16, Math.ceil(MIN_TOUCH / t));
    const wide = W >= 400;
    const PW = Math.min(W - (wide ? 16 : 4), wide ? 600 : 280);
    const x0 = Math.floor((W - PW) / 2);
    const cardH = Math.max(...ORDER.map((id) => this.cardFor(id, PW).height));
    const rows = (compact: boolean): number => (compact ? 2 : 4) * (btn + GAP);
    const top = GAP;
    const bottom = H - GAP;
    const compact = bottom - cardH - GAP - top - rows(false) < 90;
    let y = top;

    const backW = Math.max(btn, 40);
    const back: Rect = { x: x0, y, w: backW, h: btn };
    let title: Rect | null = null;
    let tabs: Rect[] | null = null;
    let nameRow: Rect;
    if (compact) nameRow = { x: x0 + backW + GAP, y, w: PW - backW - GAP, h: btn };
    else {
      title = { x: x0 + backW + GAP, y, w: PW - backW - GAP, h: btn };
      y += btn + GAP;
      const tabW = Math.floor((PW - GAP * 3) / 4);
      tabs = ORDER.map((_, i) => ({ x: x0 + i * (tabW + GAP), y, w: i === 3 ? PW - 3 * (tabW + GAP) : tabW, h: btn }));
      y += btn + GAP;
      nameRow = { x: x0, y, w: PW, h: btn };
    }
    const arrowW = Math.max(btn, 22);
    const prev: Rect = { x: nameRow.x, y: nameRow.y, w: arrowW, h: btn };
    const next: Rect = { x: nameRow.x + nameRow.w - arrowW, y: nameRow.y, w: arrowW, h: btn };
    const name: Rect = { x: prev.x + arrowW + 2, y: nameRow.y, w: nameRow.w - 2 * arrowW - 4, h: btn };
    y += btn + GAP;

    const toggleW = Math.max(btn, wide ? 54 : 46);
    const colW = Math.floor((PW - GAP * 2) / 2);
    const rightX = x0 + PW - colW;
    const swim: Rect = { x: x0 + PW - toggleW, y, w: toggleW, h: btn };
    const spin: Rect = { x: swim.x - GAP - toggleW, y, w: toggleW, h: btn };
    const view: Rect | null = wide ? null : { x: x0, y, w: spin.x - GAP - x0, h: btn };
    const heads = wide ? { original: { x: x0, y, w: colW, h: btn }, remaster: { x: rightX, y, w: spin.x - GAP - rightX, h: btn } } : null;
    y += btn + GAP;

    const card: Rect = { x: x0, y: bottom - cardH, w: PW, h: cardH };
    const wellH = Math.max(24, card.y - GAP - y);
    const wells: Layout['wells'] = wide
      ? { original: { x: x0, y, w: colW, h: wellH }, remaster: { x: rightX, y, w: colW, h: wellH } }
      : { [this.view]: { x: x0, y, w: PW, h: wellH } };
    return { W, H, wide, compact, back, title, tabs, prev, next, name, view, spin, swim, heads, wells, card };
  }

  /** Lay everything out again (size, texel or view changed), then redraw. */
  private relayout(): void {
    if (this.closed) return;
    const t = this.texel;
    const layout = this.compute();
    this.layout = layout;
    this.root.style.setProperty('--texel', `${t}px`);
    this.root.dataset.layout = layout.wide ? 'wide' : 'narrow';
    this.ui.width = layout.W;
    this.ui.height = layout.H;
    this.ui.style.width = `${(layout.W * t).toFixed(3)}px`;
    this.ui.style.height = `${(layout.H * t).toFixed(3)}px`;

    const place = (id: string, r: Rect | null): void => {
      const b = this.buttons.get(id);
      if (!b) return;
      b.hidden = r === null;
      if (r)
        b.setAttribute(
          'style',
          `left:${(r.x * t).toFixed(3)}px;top:${(r.y * t).toFixed(3)}px;width:${(r.w * t).toFixed(3)}px;height:${(r.h * t).toFixed(3)}px`,
        );
    };
    place('gal-back', layout.back);
    ORDER.forEach((id, i) => place(`gal-tab-${id}`, layout.tabs?.[i] ?? null));
    place('gal-prev', layout.prev);
    place('gal-next', layout.next);
    place('gal-view', layout.view);
    place('gal-spin', layout.spin);
    place('gal-swim', layout.swim);

    const model = this.turntable?.canvas;
    if (model) {
      const well = layout.wells.remaster;
      model.hidden = !well;
      if (well) {
        const a = wellArea(well);
        model.setAttribute(
          'style',
          `left:${(a.x * t).toFixed(3)}px;top:${(a.y * t).toFixed(3)}px;width:${(a.w * t).toFixed(3)}px;height:${(a.h * t).toFixed(3)}px`,
        );
        this.turntable?.setSize(a.w * t, a.h * t);
      }
    }
    this.sprite.hidden = !layout.wells.original;
    this.refresh();
  }

  /** Redraw for the current entry and toggles; the layout stays. */
  private refresh(): void {
    const layout = this.layout;
    if (this.closed || !layout) return;
    const e = ENTRIES[this.entry];
    this.root.dataset.entry = this.entry;
    this.root.dataset.view = this.view;
    this.turntable?.setModel(this.entry);
    this.placeSprite();
    this.spriteFrame = -1;
    this.drawSprite();

    const label = (id: string, text: string, pressed?: boolean): void => {
      const b = this.buttons.get(id);
      if (!b) return;
      b.setAttribute('aria-label', text);
      if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
    };
    label('gal-back', 'Back to the title screen');
    for (const id of ORDER) label(`gal-tab-${id}`, ENTRIES[id].name, id === this.entry);
    label('gal-prev', 'Previous entry');
    label('gal-next', 'Next entry');
    label(
      'gal-view',
      this.view === 'original'
        ? 'Showing the original 2026 sprite. Switch to the remaster'
        : 'Showing the remaster model. Switch to the original',
    );
    label('gal-spin', 'Auto-spin', this.spin);
    label('gal-swim', e.motion === 'Sway' ? 'Sway animation' : 'Swim animation', this.animate);
    const spin = this.buttons.get('gal-spin');
    if (spin) spin.disabled = !layout.wells.remaster || !this.turntable;
    this.sprite.setAttribute('aria-label', `${e.name}, original 2026 pixel sprite`);
    this.turntable?.canvas.setAttribute(
      'aria-label',
      `${e.name}, remaster 3D model on a turntable. Drag or use the arrow keys to turn it, pinch, scroll or use plus and minus to zoom`,
    );
    const text = `${e.name}. ${e.stat[0]}: ${e.stat[1]}. ${e.behaviour} ${e.lore} ${this.countText(this.entry).toLowerCase()}.`;
    if (this.info.textContent !== text) this.info.textContent = text;
    this.draw(layout);
  }

  /** The v1 sprite canvas: its own pixels, scaled by a whole number of device pixels. */
  private placeSprite(): void {
    const well = this.layout?.wells.original;
    if (!well) return;
    const sprite = V1_SPRITES[this.entry];
    const t = this.texel;
    const dpr = window.devicePixelRatio || 1;
    const a = wellArea(well);
    const n = Math.max(1, Math.floor(Math.min((a.w * t * dpr * 0.72) / sprite.width, (a.h * t * dpr * 0.6) / sprite.height)));
    const w = (sprite.width * n) / dpr;
    const h = (sprite.height * n) / dpr;
    const snap = (v: number): number => Math.round(v * dpr) / dpr;
    this.sprite.width = sprite.width;
    this.sprite.height = sprite.height;
    this.sprite.setAttribute(
      'style',
      `left:${snap(a.x * t + (a.w * t - w) / 2)}px;top:${snap(a.y * t + (a.h * t - h) / 2)}px;width:${w}px;height:${h}px`,
    );
  }

  private drawSprite(): void {
    if (!this.layout?.wells.original) return;
    const sprite = V1_SPRITES[this.entry];
    // v1's SpriteRenderer: frame = floor(elapsed * frameRate), looping.
    const frame = sprite.frameRate > 0 ? Math.floor(this.spriteTime * sprite.frameRate) % sprite.frames.length : 0;
    if (frame === this.spriteFrame) return;
    this.spriteFrame = frame;
    const ctx = this.sprite.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, sprite.width, sprite.height);
    (sprite.frames[frame] ?? []).forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const index = row.charCodeAt(x) - 48;
        const hex = index > 0 ? sprite.palette[index - 1] : undefined;
        if (!hex) continue;
        ctx.fillStyle = hex;
        ctx.fillRect(x, y, 1, 1);
      }
    });
  }

  private draw(layout: Layout): void {
    const ctx = this.ui.getContext('2d');
    if (!ctx) return;
    const e = ENTRIES[this.entry];
    const { W, H } = layout;
    ctx.imageSmoothingEnabled = false;
    const rect = (x: number, y: number, w: number, h: number, hex: string): void => {
      ctx.fillStyle = hex;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };
    const text = (str: string, x: number, y: number, hex: string, align: 'left' | 'right' | 'center' = 'left', title = false): void => {
      const bitmap = textCanvas(str, hex, title);
      const left = align === 'right' ? x - bitmap.width : align === 'center' ? x - Math.floor(bitmap.width / 2) : x;
      ctx.drawImage(bitmap, Math.round(left), Math.round(y));
    };
    /** The first label that fits the width (the last one if none does). */
    const fit = (labels: readonly string[], width: number, title = false): string => {
      const upper = labels.map((l) => l.toUpperCase());
      return upper.find((l) => (title ? textCanvas(l, C.gold, true).width : measure(l)) <= width) ?? upper[upper.length - 1] ?? '';
    };
    const mid = (r: Rect): number => r.y + Math.floor(r.h / 2);
    const plate = (r: Rect, label: string): void => {
      rect(r.x, r.y + 2, r.w, r.h - 4, C.button);
      rect(r.x, r.y + 2, r.w, 1, C.lip);
      text(label, r.x + Math.floor(r.w / 2), mid(r) - 4, C.gold, 'center');
    };
    const tab = (r: Rect, label: string, on: boolean): void => {
      rect(r.x, r.y + 2, r.w, r.h - 4, on ? C.edge : C.row);
      if (on) rect(r.x, r.y + r.h - 4, r.w, 2, C.accent);
      text(label, r.x + Math.floor(r.w / 2), mid(r) - 4, on ? C.gold : C.soft, 'center');
    };
    const toggle = (r: Rect, label: string, on: boolean, enabled: boolean): void => {
      rect(r.x, r.y + 2, r.w, r.h - 4, C.row);
      const width = measure(label) + 4 + 9;
      const x = r.x + Math.floor((r.w - width) / 2);
      text(label, x, mid(r) - 4, enabled ? (on ? C.text : C.soft) : C.dim);
      rect(x + width - 9, mid(r) - 5, 9, 9, enabled ? C.soft : C.off);
      rect(x + width - 8, mid(r) - 4, 7, 7, on && enabled ? C.accent : C.row);
    };

    rect(0, 0, W, H, C.deep);

    // Header.
    plate(layout.back, fit(['< Back', '<'], layout.back.w - 4));
    if (layout.title) {
      const r = layout.title;
      const label = textCanvas('FIELD GUIDE', C.cyan, true);
      if (label.width <= r.w) {
        // Centred on the panel when that clears the Back button, otherwise against the right edge.
        const centred = layout.back.x + Math.floor((r.x + r.w - layout.back.x - label.width) / 2);
        ctx.drawImage(label, centred >= r.x + 2 ? centred : r.x + r.w - label.width, mid(r) - 9);
      } else text('FIELD GUIDE', r.x + r.w, mid(r) - 4, C.cyan, 'right');
    }
    layout.tabs?.forEach((r, i) => {
      const id = ORDER[i] ?? 'bluegill';
      tab(r, fit(ENTRIES[id].tab, r.w - 4), id === this.entry);
    });

    // Entry name between the arrows.
    plate(layout.prev, '<');
    plate(layout.next, '>');
    const name = e.name.toUpperCase();
    if (textCanvas(name, C.gold, true).width <= layout.name.w)
      text(name, layout.name.x + Math.floor(layout.name.w / 2), mid(layout.name) - 9, C.gold, 'center', true);
    else text(name, layout.name.x + Math.floor(layout.name.w / 2), mid(layout.name) - 4, C.gold, 'center');

    // Views and toggles.
    if (layout.view) {
      const r = layout.view;
      const half = Math.floor((r.w - 1) / 2);
      const long = measure('ORIGINAL') + 6 <= half;
      tab({ x: r.x, y: r.y, w: half, h: r.h }, long ? 'ORIGINAL' : 'V1', this.view === 'original');
      tab({ x: r.x + r.w - half, y: r.y, w: half, h: r.h }, long ? 'REMASTER' : '3D', this.view === 'remaster');
    }
    if (layout.heads) {
      const { original, remaster } = layout.heads;
      text('ORIGINAL', original.x + 2, mid(original) - 4, C.gold);
      text('2026 V1', original.x + original.w - 2, mid(original) - 4, C.soft, 'right');
      text('REMASTER', remaster.x + 2, mid(remaster) - 4, C.gold);
    }
    const remasterShown = Boolean(layout.wells.remaster) && this.turntable !== null;
    toggle(layout.spin, 'SPIN', this.spin, remasterShown);
    toggle(layout.swim, e.motion.toUpperCase(), this.animate, true);

    // Wells: framed night water, with a caption strip along the bottom.
    const well = (r: Rect, caption: readonly string[]): Rect => {
      rect(r.x, r.y, r.w, r.h, C.edge);
      const a = wellArea(r);
      const band = Math.ceil(a.h / WATER.length);
      WATER.forEach((hex, i) => rect(a.x, a.y + i * band, a.w, Math.min(band, a.h - i * band), hex));
      rect(a.x, a.y + a.h, a.w, 11, C.back);
      text(fit(caption, a.w - 6), a.x + Math.floor(a.w / 2), a.y + a.h + 2, C.soft, 'center');
      return a;
    };
    if (layout.wells.original) {
      const s = V1_SPRITES[this.entry];
      const size = `${s.width}x${s.height}`;
      const frames = s.frames.length > 1 ? `${s.frames.length} frames at ${s.frameRate} fps` : 'still';
      well(layout.wells.original, [`2026 v1 sprite, ${size}, ${frames}`, `v1 sprite ${size}, ${frames}`, `v1 ${size}`]);
    }
    if (layout.wells.remaster) {
      const a = well(layout.wells.remaster, ['Drag to turn, pinch or scroll to zoom', 'Drag to turn, pinch to zoom', 'Drag to turn']);
      if (!this.turntable)
        text(fit(['3D view unavailable', 'No 3D'], a.w - 6), a.x + Math.floor(a.w / 2), a.y + Math.floor(a.h / 2) - 4, C.soft, 'center');
    }

    // Info card.
    const r = layout.card;
    const card = this.cardFor(this.entry, r.w);
    rect(r.x, r.y, r.w, r.h, C.edge);
    rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, C.back);
    rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, C.row);
    let y = r.y + 5;
    const label = e.stat[0].toUpperCase();
    text(label, r.x + 6, y, C.accent);
    text(e.stat[1].toUpperCase(), r.x + 6 + measure(`${label}  `), y, C.text);
    if (card.splitCount) {
      y += LINE;
      text(this.countText(this.entry), r.x + 6, y, C.gold);
    } else text(this.countText(this.entry), r.x + r.w - 6, y, C.gold, 'right');
    y += LINE + 3;
    for (const line of card.behaviour) {
      text(line, r.x + 6, y, C.text);
      y += LINE;
    }
    y += 3;
    for (const line of card.lore) {
      text(line, r.x + 6, y, C.soft);
      y += LINE;
    }
  }
}

/** Open the Field Guide over the game. Loaded on demand; nothing here is in the first load. */
export function openGallery(ctx: GalleryContext): GalleryHandle {
  return new Gallery(ctx);
}
