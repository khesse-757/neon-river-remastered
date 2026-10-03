import { createRng } from '../sim/rng';

type Group = 'sfx' | 'ambience' | 'music';

const FILES: Record<string, string> = {
  net: 'assets/original/water_net.wav',
  splash1: 'audio/sfx/catch-splash-1.mp3',
  splash2: 'audio/sfx/catch-splash-2.mp3',
  ambience: 'audio/ambience/night-river-loop.mp3',
};

/** Hirajoshi scale, in semitones from the root. Streaks climb it. */
const SCALE = [0, 2, 3, 7, 8];
const ROOT_HZ = 196;
const NOTES = 15;
const MUTE_KEY = 'neonriver2_muted';

/**
 * Web Audio bus: generated files where they exist, small procedural voices for the rest.
 * Nothing here calls a network service; the files are generated offline and committed.
 */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly groups = new Map<Group, GainNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly plucks: AudioBuffer[] = [];
  private ambience: AudioBufferSourceNode | null = null;
  private wantAmbience = false;
  private muted = false;
  private splashToggle = false;
  private readonly rng = createRng(0x5eed);
  readonly errors: string[] = [];

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      /* storage unavailable */
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      for (const [group, volume] of [
        ['sfx', 0.8],
        ['ambience', 1.5],
        ['music', 0.5],
      ] as const) {
        const gain = this.ctx.createGain();
        gain.gain.value = volume;
        gain.connect(this.master);
        this.groups.set(group, gain);
      }
      this.buildPlucks();
      void this.loadAll();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }

  /** Suspend with the game so nothing keeps sounding (or stacking) while paused or hidden. */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') void this.ctx.suspend();
    if (!paused && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  startAmbience(): void {
    this.wantAmbience = true;
    const buffer = this.buffers.get('ambience');
    const group = this.groups.get('ambience');
    if (!this.ctx || !buffer || !group || this.ambience) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const fade = this.ctx.createGain();
    fade.gain.setValueAtTime(0, this.ctx.currentTime);
    fade.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 1.5);
    source.connect(fade).connect(group);
    source.start();
    this.ambience = source;
  }

  stopAmbience(): void {
    this.wantAmbience = false;
    this.ambience?.stop();
    this.ambience = null;
  }

  /** Catch: splash variant, v1's net sound underneath, and the streak note (a chord for koi). */
  catch(streak: number, koi: boolean): void {
    this.splashToggle = !this.splashToggle;
    this.play(koi ? 'splash2' : this.splashToggle ? 'splash1' : 'splash2', koi ? 0.8 : 0.55, 0.94 + this.rng.next() * 0.12);
    this.play('net', 0.22);
    const degree = Math.min(NOTES - 1, streak - 1);
    this.pluck(degree, 0.5);
    if (koi) {
      this.pluck(Math.min(NOTES - 1, degree + 2), 0.36, 0.03);
      this.pluck(Math.min(NOTES - 1, degree + 4), 0.3, 0.06);
    }
  }

  /** A low, muted note for a fish that got away. */
  miss(): void {
    this.tone(98, 0.28, 0.2, 'triangle');
  }

  /** Soft tick on every spawn: the river's metronome. */
  spawn(): void {
    this.tone(1320, 0.05, 0.035, 'sine');
  }

  /** Eel warning crackle (also used, shorter, for near misses). */
  crackle(length = 0.5, level = 0.3): void {
    const { ctx } = this;
    const group = this.groups.get('sfx');
    if (!ctx || !group) return;
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
    filter.type = 'highpass';
    filter.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.value = level;
    source.connect(filter).connect(gain).connect(group);
    source.start();
  }

  /** The shock: a falling buzz and a burst of crackle. */
  zap(): void {
    const { ctx } = this;
    const group = this.groups.get('sfx');
    if (!ctx || !group) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(55, ctx.currentTime + 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain).connect(group);
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
    this.crackle(0.9, 0.5);
  }

  private async loadAll(): Promise<void> {
    await Promise.all(
      Object.entries(FILES).map(async ([id, path]) => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
          if (!response.ok) throw new Error(`${response.status}`);
          const data = await response.arrayBuffer();
          if (this.ctx) this.buffers.set(id, await this.ctx.decodeAudioData(data));
        } catch (error) {
          this.errors.push(`${id}: ${String(error)}`);
          console.warn(`Audio "${id}" failed to load; continuing without it.`, error);
        }
      }),
    );
    if (this.wantAmbience) this.startAmbience();
  }

  private play(id: string, volume: number, rate = 1): void {
    const buffer = this.buffers.get(id);
    const group = this.groups.get('sfx');
    if (!this.ctx || !buffer || !group) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(group);
    source.start();
  }

  private pluck(degree: number, volume: number, delay = 0): void {
    const buffer = this.plucks[degree];
    const group = this.groups.get('sfx');
    if (!this.ctx || !buffer || !group) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(group);
    source.start(this.ctx.currentTime + delay);
  }

  private tone(hz: number, length: number, volume: number, type: OscillatorType): void {
    const { ctx } = this;
    const group = this.groups.get('sfx');
    if (!ctx || !group) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + length);
    osc.connect(gain).connect(group);
    osc.start();
    osc.stop(ctx.currentTime + length + 0.02);
  }

  /** Karplus-Strong plucked string, rendered once per scale degree. */
  private buildPlucks(): void {
    const { ctx } = this;
    if (!ctx) return;
    for (let degree = 0; degree < NOTES; degree++) {
      const semis = (SCALE[degree % SCALE.length] ?? 0) + 12 * Math.floor(degree / SCALE.length);
      const hz = ROOT_HZ * 2 ** (semis / 12);
      const period = Math.max(2, Math.round(ctx.sampleRate / hz));
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.1), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < period; i++) data[i] = this.rng.next() * 2 - 1;
      for (let i = period; i < data.length; i++) data[i] = ((data[i - period] ?? 0) + (data[i - period + 1] ?? 0)) * 0.5 * 0.994;
      const fadeFrom = data.length - Math.floor(ctx.sampleRate * 0.1);
      for (let i = fadeFrom; i < data.length; i++) data[i] = (data[i] ?? 0) * ((data.length - i) / (data.length - fadeFrom));
      this.plucks.push(buffer);
    }
  }
}
