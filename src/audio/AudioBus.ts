import { createRng } from '../sim/rng';
import { DEFAULT_THEME, degreeToHz, melodyNote, missFall, quantizeOnset, themeById, THEMES, type CueNote, type Theme } from './melody';

/** The four things a player can turn down or off, plus master mute. */
export type Channel = 'music' | 'ambience' | 'notes' | 'sfx';
export const CHANNELS: readonly Channel[] = ['music', 'ambience', 'notes', 'sfx'];
export const CHANNEL_LABELS: Record<Channel, string> = { music: 'MUSIC', ambience: 'AMBIENCE', notes: 'FISH NOTES', sfx: 'SPLASHES' };

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
export const EIGHTH = 60 / MUSIC_BPM / 2;
/** Channel trims: relative levels of loudness-normalized assets, before the player's sliders. */
const TRIM: Record<Channel, number> = { music: 0.5, ambience: 0.85, notes: 0.7, sfx: 0.7 };
const DEFAULT_VOLUME: Record<Channel, number> = { music: 0.7, ambience: 0.7, notes: 0.8, sfx: 0.75 };
const STORE = 'neonriver2_audio';
const THEME_STORE = 'neonriver2_theme';

interface Saved {
  muted?: boolean;
  volume?: Partial<Record<Channel, number>>;
  enabled?: Partial<Record<Channel, boolean>>;
}

/**
 * Web Audio mixer. Four channels (music, ambience, fish notes, splashes/SFX) feed a master EQ and
 * a compressor/limiter. Files are generated offline, loudness-normalized and committed; nothing
 * here calls a service.
 */
export class AudioBus {
  readonly errors: string[] = [];
  theme: Theme;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<Channel, GainNode>();
  private duck: GainNode | null = null;
  private reverb: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<'ambience' | 'music', AudioBufferSourceNode>();
  private readonly cue = new Set<AudioScheduledSourceNode>();
  private wantLoops = false;
  private loading: Promise<void> | null = null;
  private musicStart = 0;
  private muted = false;
  private volume: Record<Channel, number> = { ...DEFAULT_VOLUME };
  private enabled: Record<Channel, boolean> = { music: true, ambience: true, notes: true, sfx: true };
  private splashToggle = false;
  private readonly rng = createRng(0x5eed);

  constructor(themeId?: string | null) {
    let storedTheme: string | null = null;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Saved;
      this.muted = saved.muted === true;
      for (const key of CHANNELS) {
        const v = saved.volume?.[key];
        if (typeof v === 'number' && v >= 0 && v <= 1) this.volume[key] = v;
        if (saved.enabled?.[key] === false) this.enabled[key] = false;
      }
      storedTheme = localStorage.getItem(THEME_STORE);
    } catch {
      /* storage unavailable or corrupt: keep defaults */
    }
    // A valid ?theme= wins, then the stored choice, then the default.
    const valid = (id: string | null | undefined): string | null => (id && THEMES.some((t) => t.id === id) ? id : null);
    this.theme = themeById(valid(themeId) ?? valid(storedTheme) ?? DEFAULT_THEME);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  getVolume(key: Channel): number {
    return this.volume[key];
  }

  isEnabled(key: Channel): boolean {
    return this.enabled[key];
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  /** Pick the leitmotif (from the ?audition page) and remember it. */
  setTheme(id: string): void {
    this.theme = themeById(id);
    try {
      localStorage.setItem(THEME_STORE, this.theme.id);
    } catch {
      /* storage unavailable */
    }
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

      for (const bus of CHANNELS) {
        const gain = ctx.createGain();
        gain.gain.value = this.busGain(bus);
        if (bus === 'music') {
          // Music passes through a duck gain that dips under stingers and the shock.
          this.duck = ctx.createGain();
          gain.connect(this.duck).connect(lowCut);
        } else gain.connect(lowCut);
        this.buses.set(bus, gain);
      }

      // A light reverb send for the fish notes: a short synthetic room, darkened.
      const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * 1.4), ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        let smooth = 0;
        for (let i = 0; i < data.length; i++) {
          const t = i / data.length;
          smooth += ((this.rng.next() * 2 - 1) * (1 - t) ** 2.6 - smooth) * 0.35;
          data[i] = smooth;
        }
      }
      const convolver = ctx.createConvolver();
      convolver.buffer = impulse;
      this.reverb = ctx.createGain();
      this.reverb.gain.value = 0.5;
      const notes = this.buses.get('notes');
      if (notes) this.reverb.connect(convolver).connect(notes);
      this.loading = this.loadAll();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  /**
   * Unlock, start the beds, and wait (briefly) for the samples, so the first sting is played by
   * the real voice and lands on the music's grid.
   */
  async ready(maxWait = 2500): Promise<void> {
    await this.unlock();
    this.startLoops();
    await Promise.race([this.loading ?? Promise.resolve(), new Promise<void>((resolve) => setTimeout(resolve, maxWait))]);
    this.startLoops();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
    this.save();
  }

  setVolume(key: Channel, value: number): void {
    this.volume[key] = Math.min(1, Math.max(0, value));
    this.applyGains();
  }

  setEnabled(key: Channel, on: boolean): void {
    this.enabled[key] = on;
    this.applyGains();
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

  /** Dip the music under a stinger, then let it back up. */
  duckMusic(seconds = 1.4, depth = 0.45): void {
    if (!this.ctx || !this.duck) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(depth, t, 0.06);
    this.duck.gain.setTargetAtTime(1, t + seconds, 0.35);
  }

  /** Catch: splash and net on the SFX channel, the next melody note on the notes channel. */
  catch(streak: number, koi: boolean): void {
    this.splashToggle = !this.splashToggle;
    this.play(koi ? 'splash2' : this.splashToggle ? 'splash1' : 'splash2', 'sfx', koi ? 0.75 : 0.5, 0.94 + this.rng.next() * 0.12);
    this.play('net', 'sfx', 0.2);
    const { ctx } = this;
    if (!ctx) return;
    const note = melodyNote(this.theme, streak, koi);
    const when = quantizeOnset(ctx.currentTime, this.musicStart, EIGHTH);
    this.voice(note.degree, 0.9, when);
    note.harmony.forEach((degree, i) => this.voice(degree, 0.4, when + 0.012 * (i + 1)));
    if (note.chime) this.chime(note.degree + 5, 0.5, when);
  }

  /** Miss: the motif's tail falls softly to the low tonic; the melody restarts at step 1. */
  miss(): void {
    this.playCue(missFall(this.theme), 0.45, 0.8);
  }

  /** Soft tick on every spawn: the river's metronome. */
  spawn(): void {
    this.tone(1320, 0.05, 0.12, 'sine', 'sfx');
  }

  /** Title / run start: the leitmotif, stated once. */
  startSting(): void {
    this.duckMusic(2.4, 0.5);
    this.playCue(this.theme.startSting, 1, 0.85, true);
  }

  /** Phase change: three notes of the motif. */
  phaseSting(): void {
    this.duckMusic(1.2, 0.6);
    this.playCue(this.theme.phaseSting, 1, 0.7);
  }

  /** Win: the motif answered an octave up, ending on a held chord. */
  winFanfare(): void {
    this.duckMusic(7, 0.3);
    this.playCue(this.theme.winFanfare, 1, 1, true, true);
  }

  /** Loss: the motif sinking to the low tonic. */
  lossPhrase(): void {
    this.playCue(this.theme.lossPhrase, 1.25, 0.8, true);
  }

  /** Audition: play `count` steps of the catch sequence as eighth notes. */
  playSequence(theme: Theme, count = 32, offset = 0): void {
    const { ctx } = this;
    if (!ctx) return;
    this.stopCue();
    // On the music's eighth-note grid when the loop is playing, so it is auditioned in time.
    const now = ctx.currentTime + 0.06;
    const start = this.musicStart > 0 ? this.musicStart + Math.ceil((now - this.musicStart) / EIGHTH) * EIGHTH : now;
    for (let i = 0; i < count; i++) {
      const note = melodyNote(theme, offset + i + 1, false);
      this.voice(note.degree, 0.9, start + i * EIGHTH, true);
    }
  }

  playThemeCue(theme: Theme, kind: 'startSting' | 'phaseSting' | 'winFanfare' | 'lossPhrase'): void {
    const previous = this.theme;
    this.theme = theme;
    this.stopCue();
    if (kind === 'startSting') this.startSting();
    else if (kind === 'phaseSting') this.phaseSting();
    else if (kind === 'winFanfare') this.winFanfare();
    else this.lossPhrase();
    this.theme = previous;
  }

  /** Stop any sting, fanfare or audition sequence still sounding. */
  stopCue(): void {
    for (const source of this.cue) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.cue.clear();
  }

  /** One note, so a channel's slider can be set by ear. */
  preview(key: Channel): void {
    if (!this.ctx) return;
    if (key === 'notes') this.voice(3, 0.8, this.ctx.currentTime);
    else if (key === 'sfx') this.play('splash1', 'sfx', 0.5);
  }

  /** Eel warning crackle (also used, shorter, for near misses and the frying basket). */
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
    this.duckMusic(3.5, 0.12);
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

  /** The basket frying: a longer sizzle under the crackle. */
  fry(): void {
    const { ctx } = this;
    const bus = this.buses.get('sfx');
    if (!ctx || !bus) return;
    const length = 1.2;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (this.rng.next() * 2 - 1) * (1 - i / data.length) ** 1.5;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3800;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    source.connect(filter).connect(gain).connect(bus);
    source.start();
    this.crackle(1.0, 0.3);
  }

  private busGain(bus: Channel): number {
    // Sliders are perceptual: square the 0..1 position.
    return this.enabled[bus] ? TRIM[bus] * this.volume[bus] ** 2 * 1.6 : 0;
  }

  private applyGains(): void {
    if (this.ctx) for (const [bus, gain] of this.buses) gain.gain.setTargetAtTime(this.busGain(bus), this.ctx.currentTime, 0.03);
    this.save();
  }

  private save(): void {
    try {
      const saved: Saved = { muted: this.muted, volume: this.volume, enabled: this.enabled };
      localStorage.setItem(STORE, JSON.stringify(saved));
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

  private play(id: string, bus: Channel, volume: number, rate = 1, when = 0): void {
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

  /** Play a rhythmic cue (sting, fanfare, phrase). `stretch` slows it; `hold` lets the last notes ring. */
  private playCue(notes: readonly CueNote[], stretch: number, level: number, pad = false, hold = false): void {
    const { ctx } = this;
    if (!ctx) return;
    // Start on the music's next eighth so the cue sits in time.
    const now = ctx.currentTime + 0.03;
    const start = this.musicStart > 0 ? this.musicStart + Math.ceil((now - this.musicStart) / EIGHTH) * EIGHTH : now;
    const last = Math.max(...notes.map((n) => n.at));
    for (const note of notes) {
      const when = start + note.at * EIGHTH * stretch;
      this.voice(note.degree, (note.level ?? 0.85) * level, when, true, hold && note.at === last ? 2.6 : 1);
    }
    if (pad) this.pad(notes[0]?.degree ?? 0, start, (last + 6) * EIGHTH * stretch, 0.1 * level);
  }

  /**
   * The melody voice: the koto pluck with its harsh top rolled off, a mallet-like sine body for
   * warmth, a soft octave below, and a little reverb. Falls back to a synthesized string.
   */
  private voice(degree: number, volume: number, when: number, track = false, ring = 1): void {
    const { ctx } = this;
    const out = this.buses.get('notes');
    if (!ctx || !out) return;
    const hz = degreeToHz(degree);
    const mix = ctx.createGain();
    mix.gain.value = volume;
    mix.connect(out);
    if (this.reverb) {
      const send = ctx.createGain();
      send.gain.value = 0.22;
      mix.connect(send).connect(this.reverb);
    }
    const keep = (node: AudioScheduledSourceNode): void => {
      if (!track) return;
      this.cue.add(node);
      node.onended = () => this.cue.delete(node);
    };

    // Pluck (attack and character), low-passed.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = Math.min(3400, hz * 5);
    tone.Q.value = 0.5;
    const pluckGain = ctx.createGain();
    pluckGain.gain.setValueAtTime(0.75, when);
    pluckGain.gain.setTargetAtTime(0, when + 0.5 * ring, 0.3 * ring);
    tone.connect(pluckGain).connect(mix);
    const sample = this.buffers.get('koto');
    if (sample) {
      const source = ctx.createBufferSource();
      source.buffer = sample;
      source.playbackRate.value = hz / KOTO_HZ;
      source.connect(tone);
      source.start(when);
      source.stop(when + 2.4 * ring);
      keep(source);
    } else {
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
      keep(source);
    }

    // Body: a kalimba-like sine at the fundamental with a quick overtone ping.
    const partial = (ratio: number, level: number, decay: number): void => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level, when + 0.006);
      gain.gain.setTargetAtTime(0, when + 0.02, decay * ring);
      osc.connect(gain).connect(mix);
      osc.start(when);
      osc.stop(when + 0.1 + decay * 6 * ring);
      keep(osc);
    };
    partial(1, 0.5, 0.28);
    partial(4, 0.1, 0.05);
    // Support an octave below, soft and slow.
    partial(0.5, 0.2, 0.4);
  }

  /** A soft sustained fifth under a sting or fanfare. */
  private pad(degree: number, when: number, length: number, level: number): void {
    const { ctx } = this;
    const out = this.buses.get('notes');
    if (!ctx || !out) return;
    for (const [d, l] of [
      [degree - 5, 1],
      [degree - 2, 0.6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = degreeToHz(d);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level * l, when + 0.4);
      gain.gain.setTargetAtTime(0, when + length, 0.5);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(when);
      osc.stop(when + length + 3);
      this.cue.add(osc);
      osc.onended = () => this.cue.delete(osc);
    }
  }

  private chime(degree: number, volume: number, when: number): void {
    const sample = this.buffers.get('chime');
    if (sample) this.play('chime', 'notes', volume * 0.45, Math.min(2, Math.max(0.5, degreeToHz(degree + 5) / CHIME_HZ)), when);
    else this.tone(degreeToHz(degree + 10), 0.9, volume * 0.2, 'sine', 'notes', when);
  }

  private tone(hz: number, length: number, volume: number, type: OscillatorType, bus: Channel, when = 0): void {
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
