import { createRng } from '../sim/rng';
import { degreeToHz, melodyNote, MISS_FALL, quantizeOnset } from './melody';

export type Bus = 'music' | 'ambience' | 'sfx' | 'melody' | 'ui';
/** The three sliders in settings. Melody and UI sounds follow the SFX slider. */
export type VolumeKey = 'music' | 'ambience' | 'sfx';

const FILES: Record<string, string> = {
  net: 'audio/sfx/net.mp3',
  splash1: 'audio/sfx/catch-splash-1.mp3',
  splash2: 'audio/sfx/catch-splash-2.mp3',
  koto: 'audio/sfx/koto-pluck.mp3',
  chime: 'audio/sfx/chime.mp3',
  ambience: 'audio/ambience/night-river-loop.mp3',
  music: 'audio/music/calm-loop.mp3',
};

/** Measured pitch of the koto sample (autocorrelation + third harmonic). */
const KOTO_HZ = 307.8;
const CHIME_HZ = 1760;
/** The music loop: 80 BPM, 64 beats. */
const MUSIC_BPM = 80;
const MUSIC_SECONDS = 48;
const EIGHTH = 60 / MUSIC_BPM / 2;
/** Bus trims: relative levels of loudness-normalized assets, before the user's sliders. */
const TRIM: Record<Bus, number> = { music: 0.5, ambience: 0.85, sfx: 0.7, melody: 0.62, ui: 0.25 };
const DEFAULT_VOLUME: Record<VolumeKey, number> = { music: 0.7, ambience: 0.7, sfx: 0.8 };
const SLIDER: Record<Bus, VolumeKey> = { music: 'music', ambience: 'ambience', sfx: 'sfx', melody: 'sfx', ui: 'sfx' };
const STORE = 'neonriver2_audio';

/**
 * Web Audio mixer. Buses (music, ambience, SFX, melody, UI) feed a master EQ and a
 * compressor/limiter so nothing spikes or buries the melody. Files are generated offline,
 * loudness-normalized (scripts/normalize-audio.mjs) and committed; nothing here calls a service.
 */
export class AudioBus {
  readonly errors: string[] = [];
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<Bus, GainNode>();
  private duck: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<'ambience' | 'music', AudioBufferSourceNode>();
  private wantLoops = false;
  private musicStart = 0;
  private muted = false;
  private volume: Record<VolumeKey, number> = { ...DEFAULT_VOLUME };
  private splashToggle = false;
  private readonly rng = createRng(0x5eed);

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Partial<Record<VolumeKey | 'muted', number | boolean>>;
      this.muted = saved.muted === true;
      for (const key of Object.keys(DEFAULT_VOLUME) as VolumeKey[]) {
        const v = saved[key];
        if (typeof v === 'number' && v >= 0 && v <= 1) this.volume[key] = v;
      }
    } catch {
      /* storage unavailable or corrupt: keep defaults */
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  getVolume(key: VolumeKey): number {
    return this.volume[key];
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;

      // Master chain: low-cut, tame the top, a little presence, then compress and limit.
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = 80;
      lowCut.Q.value = 0.7;
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 8500;
      air.gain.value = -3.5;
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 2800;
      presence.Q.value = 0.8;
      presence.gain.value = 1.5;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.006;
      comp.release.value = 0.22;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      lowCut.connect(air).connect(presence).connect(comp).connect(limiter).connect(this.master).connect(ctx.destination);

      for (const bus of Object.keys(TRIM) as Bus[]) {
        const gain = ctx.createGain();
        gain.gain.value = this.busGain(bus);
        if (bus === 'music') {
          // Music passes through a duck gain that dips under banners and stingers.
          this.duck = ctx.createGain();
          gain.connect(this.duck).connect(lowCut);
        } else gain.connect(lowCut);
        this.buses.set(bus, gain);
      }
      void this.loadAll();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    this.save();
  }

  setVolume(key: VolumeKey, value: number): void {
    this.volume[key] = Math.min(1, Math.max(0, value));
    if (this.ctx) for (const [bus, gain] of this.buses) gain.gain.setTargetAtTime(this.busGain(bus), this.ctx.currentTime, 0.03);
    this.save();
  }

  /** Suspend while the tab is hidden so nothing keeps sounding or stacking. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') void this.ctx.suspend();
    if (!paused && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Start the ambience and music beds (once their files have decoded). */
  startLoops(): void {
    this.wantLoops = true;
    this.startLoop('ambience');
    this.startLoop('music');
  }

  stopLoops(): void {
    this.wantLoops = false;
    for (const source of this.loops.values()) source.stop();
    this.loops.clear();
    this.musicStart = 0;
  }

  /** Dip the music under a banner or stinger, then let it back up. */
  duckMusic(seconds = 1.4, depth = 0.45): void {
    if (!this.ctx || !this.duck) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(depth, t, 0.06);
    this.duck.gain.setTargetAtTime(1, t + seconds, 0.35);
  }

  /** Catch: splash, the net, and the next note of the streak melody (a chord for koi). */
  catch(streak: number, koi: boolean): void {
    this.splashToggle = !this.splashToggle;
    this.play(koi ? 'splash2' : this.splashToggle ? 'splash1' : 'splash2', 'sfx', koi ? 0.75 : 0.5, 0.94 + this.rng.next() * 0.12);
    this.play('net', 'sfx', 0.2);
    const { ctx } = this;
    if (!ctx) return;
    const note = melodyNote(streak, koi);
    const when = quantizeOnset(ctx.currentTime, this.musicStart, EIGHTH);
    this.pluck(note.degree, 0.9, when);
    note.harmony.forEach((degree, i) => this.pluck(degree, 0.42, when + 0.012 * (i + 1)));
    if (note.chime) this.chime(note.degree + 5, 0.5, when);
  }

  /** Miss: a soft falling resolution back to the tonic; the melody restarts at step 1. */
  miss(): void {
    const { ctx } = this;
    if (!ctx) return;
    MISS_FALL.forEach((degree, i) => this.pluck(degree - 5, 0.3 - i * 0.05, ctx.currentTime + i * 0.16, 1400));
  }

  /** A single melody note, so the SFX slider can be set by ear. */
  preview(): void {
    if (this.ctx) this.pluck(3, 0.8, this.ctx.currentTime);
  }

  /** Soft tick on every spawn: the river's metronome. */
  spawn(): void {
    this.tone(1320, 0.05, 0.5, 'sine', 'ui');
  }

  /** Phase banner stinger: two chimes a fifth apart; ducks the music. */
  banner(): void {
    const { ctx } = this;
    if (!ctx) return;
    this.duckMusic();
    this.chime(5, 0.55, ctx.currentTime);
    this.chime(8, 0.4, ctx.currentTime + 0.18);
  }

  /** Eel warning crackle (also used, shorter, for near misses). */
  crackle(length = 0.5, level = 0.3): void {
    const { ctx } = this;
    const bus = this.buses.get('sfx');
    if (!ctx || !bus) return;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - i / data.length;
      // Sparse clicks: mostly silence with sharp spikes.
      data[i] = this.rng.next() > 0.985 ? (this.rng.next() * 2 - 1) * env : (data[i - 1] ?? 0) * 0.6;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = level * 1.6;
    source.connect(filter).connect(gain).connect(bus);
    source.start();
  }

  /** The shock: a falling buzz and a burst of crackle; the music drops away. */
  zap(): void {
    const { ctx } = this;
    const bus = this.buses.get('sfx');
    if (!ctx || !bus) return;
    this.duckMusic(3, 0.15);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.7);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(tone).connect(gain).connect(bus);
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
    this.crackle(0.9, 0.4);
  }

  private busGain(bus: Bus): number {
    // Sliders are perceptual: square the 0..1 position.
    return TRIM[bus] * this.volume[SLIDER[bus]] ** 2 * 1.6;
  }

  private save(): void {
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...this.volume, muted: this.muted }));
    } catch {
      /* storage unavailable */
    }
  }

  private async loadAll(): Promise<void> {
    await Promise.all(
      Object.entries(FILES).map(async ([id, path]) => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
          if (!response.ok) throw new Error(`${response.status}`);
          const data = await response.arrayBuffer();
          if (this.ctx) this.buffers.set(id, await this.ctx.decodeAudioData(data));
          if (this.wantLoops && (id === 'ambience' || id === 'music')) this.startLoop(id);
        } catch (error) {
          this.errors.push(`${id}: ${String(error)}`);
          console.warn(`Audio "${id}" failed to load; continuing without it.`, error);
        }
      }),
    );
  }

  private startLoop(id: 'ambience' | 'music'): void {
    const buffer = this.buffers.get(id);
    const bus = this.buses.get(id);
    if (!this.ctx || !buffer || !bus || this.loops.has(id)) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    if (id === 'music') {
      // Loop on the bar line, not at the encoder's padding.
      source.loopStart = 0;
      source.loopEnd = Math.min(MUSIC_SECONDS, buffer.duration);
    }
    const fade = this.ctx.createGain();
    const start = this.ctx.currentTime + 0.05;
    fade.gain.setValueAtTime(0, start);
    fade.gain.linearRampToValueAtTime(1, start + 1.5);
    source.connect(fade).connect(bus);
    source.start(start);
    if (id === 'music') this.musicStart = start;
    this.loops.set(id, source);
  }

  private play(id: string, bus: Bus, volume: number, rate = 1, when = 0): void {
    const buffer = this.buffers.get(id);
    const out = this.buses.get(bus);
    if (!this.ctx || !buffer || !out) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(out);
    source.start(when);
  }

  /** One koto note: the sampled pluck repitched, or a synthesized string if the sample is missing. */
  private pluck(degree: number, volume: number, when: number, cutoff = 5200): void {
    const { ctx } = this;
    const out = this.buses.get('melody');
    if (!ctx || !out) return;
    const hz = degreeToHz(degree);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, when);
    gain.gain.setTargetAtTime(0, when + 0.9, 0.25);
    tone.connect(gain).connect(out);
    const sample = this.buffers.get('koto');
    if (sample) {
      const source = ctx.createBufferSource();
      source.buffer = sample;
      source.playbackRate.value = hz / KOTO_HZ;
      source.connect(tone);
      source.start(when);
      source.stop(when + 2.2);
      return;
    }
    // Fallback string: Karplus-Strong with a pick-position comb, for a koto-like bite.
    const period = Math.max(2, Math.round(ctx.sampleRate / hz));
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const pick = Math.max(1, Math.round(period * 0.18));
    for (let i = 0; i < period; i++) data[i] = this.rng.next() * 2 - 1;
    for (let i = period - 1; i >= pick; i--) data[i] = (data[i] ?? 0) - (data[i - pick] ?? 0);
    for (let i = period; i < data.length; i++) data[i] = ((data[i - period] ?? 0) + (data[i - period + 1] ?? 0)) * 0.5 * 0.995;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(tone);
    source.start(when);
  }

  private chime(degree: number, volume: number, when: number): void {
    const sample = this.buffers.get('chime');
    if (sample) this.play('chime', 'melody', volume * 0.6, Math.min(2, Math.max(0.5, degreeToHz(degree + 5) / CHIME_HZ)), when);
    else this.tone(degreeToHz(degree + 10), 0.9, volume * 0.25, 'sine', 'melody', when);
  }

  private tone(hz: number, length: number, volume: number, type: OscillatorType, bus: Bus, when = 0): void {
    const { ctx } = this;
    const out = this.buses.get(bus);
    if (!ctx || !out) return;
    const start = Math.max(ctx.currentTime, when);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0008, start + length);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }
}
