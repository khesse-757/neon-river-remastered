import { createRng } from '../sim/rng';
import { degreeToHz, melodyNote, missFall, quantizeOnset, themeById, THEMES, type CueNote, type Theme } from './melody';
import {
  CHANNELS,
  DEFAULT_AUDIO,
  defaultAudio,
  EQ_PRESETS,
  loadAudio,
  saveAudio,
  type AudioSettings,
  type Channel,
  type EqPreset,
  type Instrument,
} from './settings';

const FILES: Record<string, string> = {
  net: 'audio/sfx/net.mp3',
  splash1: 'audio/sfx/catch-splash-1.mp3',
  splash2: 'audio/sfx/catch-splash-2.mp3',
  koto: 'audio/sfx/koto-pluck.mp3',
  chime: 'audio/sfx/chime.mp3',
  ambience: 'audio/ambience/night-river-loop.mp3',
  music: 'audio/music/calm-loop.mp3',
};

/** Weather sounds are fetched the first time a night can rain, not with the page. */
const WEATHER_FILES: Record<string, string> = {
  rainLight: 'audio/ambience/rain-light-loop.mp3',
  rainHeavy: 'audio/ambience/rain-heavy-loop.mp3',
  thunder1: 'audio/sfx/thunder-1.mp3',
  thunder2: 'audio/sfx/thunder-2.mp3',
  thunder3: 'audio/sfx/thunder-3.mp3',
};

/** Measured pitch of the koto sample (autocorrelation + third harmonic). */
const KOTO_HZ = 307.8;
const CHIME_HZ = 1760;
/** The music loop: 80 BPM, 64 beats. */
const MUSIC_BPM = 80;
const MUSIC_SECONDS = 48;
export const EIGHTH = 60 / MUSIC_BPM / 2;

/**
 * Where a voice goes. The five player faders, plus two internal routes: `cue` (stingers and
 * fanfares: they follow the music fader, not Fish Notes) and `preview` (settings previews and the
 * test sound: master only, so they are heard whatever the channel switches say).
 */
type Route = Channel | 'cue' | 'preview';
const ROUTES: readonly Route[] = [...CHANNELS, 'cue', 'preview'];
/** Routes with a reverb send, and how much of each voice goes to it. */
const WET: Partial<Record<Route, number>> = { notes: 0.22, cue: 0.22, preview: 0.22, sfx: 0.1 };
/** Relative levels of loudness-normalized assets and voices, before the player's faders. */
const TRIM: Record<Route, number> = { music: 0.5, ambience: 0.85, sfx: 0.7, notes: 0.7, ui: 0.5, cue: 0.9, preview: 0.7 };
/** At most this many one-shot voices sound at once; stingers are exempt. */
const MAX_VOICES = 16;
/** The same sound asked for twice within this many seconds plays once. */
const SAME_SOUND_GAP = 0.045;
const ATTACK = 0.005;

/** Sine partials of each Fish Notes instrument: [frequency ratio, level, decay seconds, attack seconds]. */
const BODIES: Record<Instrument, readonly (readonly [number, number, number, number])[]> = {
  // Under the sampled pluck: a mallet-like body, a quick overtone and a soft octave below.
  koto: [
    [1, 0.5, 0.28, 0.006],
    [4, 0.1, 0.05, 0.004],
    [0.5, 0.2, 0.4, 0.01],
  ],
  kalimba: [
    [1, 0.62, 0.34, 0.004],
    [3, 0.14, 0.045, 0.003],
    [6, 0.05, 0.02, 0.003],
  ],
  bell: [
    [1, 0.42, 0.9, 0.012],
    [2, 0.2, 0.55, 0.012],
    [3, 0.1, 0.3, 0.01],
    [0.5, 0.1, 0.8, 0.02],
  ],
  marimba: [
    [1, 0.7, 0.14, 0.004],
    [4, 0.16, 0.03, 0.003],
    [0.5, 0.12, 0.2, 0.006],
  ],
};

interface VoiceOptions {
  route?: 'notes' | 'cue' | 'preview';
  /** Tracked voices can be faded out by stopCue(). */
  track?: boolean;
  /** Stretches the decay (held final chords). */
  ring?: number;
  instrument?: Instrument;
  /** Stingers always sound; catch notes give way when the voice cap is reached. */
  important?: boolean;
}

/**
 * Web Audio mixer. Five faders (music, ambience, splashes/SFX, fish notes, UI) feed a master
 * stage: master volume and mute, mono fold-down, tone EQ, compressor, limiter, level meter. Files
 * are generated offline, loudness-normalized and committed; nothing here calls a service.
 * Every voice has an attack and a decay envelope, so nothing starts or stops on a non-zero sample.
 */
export class AudioBus {
  readonly errors: string[] = [];
  readonly settings: AudioSettings;
  theme: Theme;
  private ctx: AudioContext | null = null;
  private mix: GainNode | null = null;
  private mono: GainNode | null = null;
  private eq: { bass: BiquadFilterNode; mid: BiquadFilterNode; treble: BiquadFilterNode } | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private out: GainNode | null = null;
  private hush: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private scope = new Float32Array(1024);
  private readonly buses = new Map<Route, GainNode>();
  private readonly wetFaders = new Map<Route, GainNode>();
  private readonly entries = new Map<Route, GainNode>();
  private readonly groups = new Map<Route, GainNode>();
  private duck: GainNode | null = null;
  private reverbReturn: GainNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly loops = new Map<'ambience' | 'music', { source: AudioBufferSourceNode; fade: GainNode }>();
  private readonly rain = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();
  private rainLevel = 0;
  private weatherLoading = false;
  private readonly cue = new Set<AudioScheduledSourceNode>();
  private voices: number[] = [];
  private readonly lastPlayed = new Map<string, number>();
  private warning: GainNode | null = null;
  private wantLoops = false;
  private bedsOn = true;
  /** Tests: when set, only this named sound is allowed to play. */
  private solo: string | null = null;
  private readonly loading: Promise<void>;
  private readonly files = new Map<string, Promise<void>>();
  private pending: [string, ArrayBuffer][] = [];
  private musicStart = 0;
  private audition = false;
  private hidden = false;
  private suspendTimer = 0;
  private splashToggle = false;
  private chimeToggle = false;
  private readonly rng = createRng(0x5eed);

  constructor(themeId?: string | null) {
    this.settings = loadAudio();
    // A valid ?theme= wins for this visit without changing the saved choice.
    this.theme = themeById(THEMES.some((t) => t.id === themeId) ? themeId : this.settings.theme);
    // Samples are fetched and decoded as the page loads, before any gesture, so the first sting
    // after "tap to fish" is the real instrument.
    this.loading = this.preload();
  }

  get isMuted(): boolean {
    return this.settings.muted;
  }

  get state(): string {
    return this.ctx?.state ?? 'none';
  }

  hasSample(id: string): boolean {
    return this.buffers.has(id);
  }

  /** Resolves when one sample has loaded (or failed), or after `maxWait` ms, whichever is first. */
  async sample(id: string, maxWait: number): Promise<boolean> {
    await Promise.race([this.files.get(id) ?? this.loading, new Promise<void>((resolve) => setTimeout(resolve, maxWait))]);
    return this.buffers.has(id);
  }

  /** Change settings; they apply to whatever is sounding now and are saved. */
  update(patch: Partial<AudioSettings>): void {
    Object.assign(this.settings, patch);
    if (patch.theme) this.theme = themeById(patch.theme);
    this.apply();
    saveAudio(this.settings);
  }

  setVolume(key: Channel, value: number): void {
    this.settings.volume[key] = Math.min(1, Math.max(0, value));
    this.apply();
    saveAudio(this.settings);
  }

  setEnabled(key: keyof AudioSettings['enabled'], on: boolean): void {
    this.settings.enabled[key] = on;
    this.apply();
    saveAudio(this.settings);
  }

  /** An EQ preset sets the three tone sliders; Night also turns the level down and compresses harder. */
  setEqPreset(preset: EqPreset): void {
    this.update({ eq: preset, night: preset === 'night', ...EQ_PRESETS[preset] });
  }

  resetSettings(): void {
    const muted = this.settings.muted;
    Object.assign(this.settings, defaultAudio(), { muted });
    this.theme = themeById(this.settings.theme);
    this.apply();
    saveAudio(this.settings);
  }

  setMuted(muted: boolean): void {
    this.update({ muted });
  }

  /** Pick the leitmotif and remember it. */
  setTheme(id: string): void {
    this.update({ theme: themeById(id).id });
  }

  /**
   * The ?audition page: while on, the motifs play at default levels whatever the saved mute, master
   * volume and channel switches say. Nothing saved is changed.
   */
  setAudition(on: boolean): void {
    this.audition = on;
    this.apply();
  }

  /** RMS of the last ~20 ms at the output, after everything (0 = silence). Drives the level meters. */
  level(): number {
    if (!this.analyser || this.ctx?.state !== 'running') return 0;
    this.analyser.getFloatTimeDomainData(this.scope);
    let sum = 0;
    for (const v of this.scope) sum += v * v;
    return Math.sqrt(sum / this.scope.length);
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;

      // Master stage: volume and mute, optional mono fold-down, low-cut, the player's tone EQ, a
      // fixed voicing (tame the top, a little presence), then compress, limit and meter.
      this.mix = ctx.createGain();
      this.mono = ctx.createGain();
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = 'highpass';
      lowCut.frequency.value = 80;
      lowCut.Q.value = 0.7;
      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 160;
      const mid = ctx.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.Q.value = 0.9;
      const treble = ctx.createBiquadFilter();
      treble.type = 'highshelf';
      treble.frequency.value = 4500;
      this.eq = { bass, mid, treble };
      const air = ctx.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 8500;
      air.gain.value = -3.5;
      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 2800;
      presence.Q.value = 0.8;
      presence.gain.value = 1.5;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.knee.value = 12;
      this.comp.attack.value = 0.006;
      this.comp.release.value = 0.22;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
      this.out = ctx.createGain();
      this.hush = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = this.scope.length;
      this.mix
        .connect(this.mono)
        .connect(lowCut)
        .connect(bass)
        .connect(mid)
        .connect(treble)
        .connect(air)
        .connect(presence)
        .connect(this.comp)
        .connect(limiter)
        .connect(this.out)
        .connect(this.hush)
        .connect(this.analyser)
        .connect(ctx.destination);

      // A short synthetic room, darkened. Sends are post-fader, so a fader at zero is silent.
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
      this.reverbReturn = ctx.createGain();
      convolver.connect(this.reverbReturn).connect(this.mix);

      for (const route of ROUTES) {
        const bus = ctx.createGain();
        bus.gain.value = 0;
        bus.connect(this.mix);
        this.buses.set(route, bus);
        if (WET[route] !== undefined) {
          const wet = ctx.createGain();
          wet.gain.value = 0;
          wet.connect(convolver);
          this.wetFaders.set(route, wet);
        }
      }
      // The music bed passes through a duck gain that dips under stingers and the shock.
      this.duck = ctx.createGain();
      const music = this.buses.get('music');
      if (music) this.duck.connect(music);
      this.apply(true);
      for (const [id, data] of this.pending) void this.decode(id, data, ctx);
      this.pending = [];
    }
    if (this.ctx.state === 'suspended' && !(this.hidden && this.settings.muteInBackground)) await this.ctx.resume().catch(() => undefined);
  }

  /**
   * Unlock, start the beds, and wait (up to `maxWait` ms) for the samples, so a sting is played by
   * the real voice and lands on the music's grid.
   */
  async ready(maxWait = 2500): Promise<void> {
    await this.unlock();
    this.startLoops();
    await Promise.race([this.loading, new Promise<void>((resolve) => setTimeout(resolve, maxWait))]);
    this.startLoops();
  }

  /**
   * The tab went to the background or came back. With "mute in background" on (the default) the
   * output fades out and the context is suspended, so nothing keeps sounding or stacking.
   */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    const { ctx, hush } = this;
    if (!ctx || !hush) return;
    window.clearTimeout(this.suspendTimer);
    if (hidden && this.settings.muteInBackground) {
      hush.gain.setTargetAtTime(0, ctx.currentTime, 0.012);
      this.suspendTimer = window.setTimeout(() => {
        if (this.hidden && ctx.state === 'running') void ctx.suspend();
      }, 80);
    } else {
      if (ctx.state === 'suspended') void ctx.resume();
      hush.gain.setTargetAtTime(1, ctx.currentTime, 0.03);
    }
  }

  /**
   * Tests listen for one sound at a time: with a name set, every other game sound stays silent, so
   * a level at the output can only be that sound. Null restores normal play.
   */
  setSolo(name: string | null): void {
    this.solo = name;
  }

  private allowed(name: string): boolean {
    return this.solo === null || this.solo === name;
  }

  /**
   * Turn the music and ambience beds off or back on (the audition page's "over the music" switch,
   * and tests that listen for one sound at a time).
   */
  setBeds(on: boolean): void {
    this.bedsOn = on;
    if (!on) this.stopLoops();
    else if (this.ctx) this.startLoops();
    this.applyRain();
  }

  /** Start the ambience and music beds (once their files have decoded). */
  startLoops(): void {
    if (!this.bedsOn) return;
    this.wantLoops = true;
    this.startLoop('ambience');
    this.startLoop('music');
  }

  stopLoops(): void {
    this.wantLoops = false;
    const now = this.ctx?.currentTime ?? 0;
    for (const { source, fade } of this.loops.values()) {
      // Hold wherever the fade-in has got to, then fade from there: no cut if stopped mid-ramp.
      const held = fade.gain.value;
      fade.gain.cancelScheduledValues(now);
      fade.gain.setValueAtTime(held, now);
      fade.gain.setTargetAtTime(0, now, 0.04);
      source.stop(now + 0.3);
    }
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

  /**
   * Catch. Always a clean splash. With Fish Notes on, the next note of the catch melody; with it
   * off (the default), a soft short chime on the tonic or the fifth, which cannot clash with the bed.
   */
  catch(streak: number, koi: boolean): void {
    const { ctx } = this;
    // Two fish scooped in the same frame sound once.
    if (!ctx || !this.allowed('catch') || !this.fresh('catch')) return;
    this.splashToggle = !this.splashToggle;
    this.play(koi ? 'splash2' : this.splashToggle ? 'splash1' : 'splash2', 'sfx', koi ? 0.7 : 0.48, 0.94 + this.rng.next() * 0.12);
    this.play('net', 'sfx', 0.18);
    if (!this.settings.enabled.notes && !this.audition) {
      this.softChime(koi);
      return;
    }
    const note = melodyNote(this.theme, streak, koi);
    const when = quantizeOnset(ctx.currentTime, this.musicStart, EIGHTH);
    this.voice(note.degree, 0.9, when);
    note.harmony.forEach((degree, i) => this.voice(degree, 0.4, when + 0.012 * (i + 1)));
    if (note.chime) this.chime(note.degree + 5, 0.5, when);
  }

  /** Miss: with Fish Notes on, the motif's tail falls to the low tonic; otherwise a soft low knock. */
  miss(): void {
    if (!this.allowed('miss') || !this.fresh('miss', 0.12)) return;
    if (this.settings.enabled.notes) this.playCue(missFall(this.theme), 0.45, 0.8, { route: 'notes' });
    else this.tone(degreeToHz(-7), 0.16, 0.1, 'sine', 'sfx', 0, degreeToHz(-10));
  }

  /** Run start: the leitmotif, stated once. */
  startSting(): void {
    if (!this.allowed('start')) return;
    this.duckMusic(2.4, 0.5);
    this.playCue(this.theme.startSting, 1, 0.85, { pad: true });
  }

  /** A speed-up: three notes of the motif, a step higher each time, over a rising rush of water. */
  speedUpSting(index = 1): void {
    if (!this.allowed('speed-up')) return;
    this.duckMusic(1.2, 0.6);
    const lift = Math.max(0, index - 1);
    this.playCue(
      this.theme.phaseSting.map((n) => ({ ...n, degree: n.degree + lift })),
      1,
      0.75,
    );
    this.rush();
  }

  /** Win: the motif answered an octave up, ending on a held chord. */
  winFanfare(): void {
    if (!this.allowed('win')) return;
    this.duckMusic(7, 0.3);
    this.playCue(this.theme.winFanfare, 1, 1, { pad: true, hold: true });
  }

  /** Loss: the motif sinking to the low tonic. */
  lossPhrase(): void {
    if (!this.allowed('loss')) return;
    this.playCue(this.theme.lossPhrase, 1.25, 0.8, { pad: true });
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
      this.voice(note.degree, 0.9, start + i * EIGHTH, { track: true, important: true });
    }
  }

  playThemeCue(theme: Theme, kind: 'startSting' | 'phaseSting' | 'winFanfare' | 'lossPhrase'): void {
    const previous = this.theme;
    this.theme = theme;
    this.stopCue();
    if (kind === 'startSting') this.startSting();
    else if (kind === 'phaseSting') this.speedUpSting();
    else if (kind === 'winFanfare') this.winFanfare();
    else this.lossPhrase();
    this.theme = previous;
  }

  /** Fade out any sting, fanfare or audition sequence still sounding. */
  stopCue(): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const group of this.groups.values()) {
      group.gain.setTargetAtTime(0, now, 0.012);
      window.setTimeout(() => group.disconnect(), 400);
    }
    this.groups.clear();
    for (const source of this.cue) {
      try {
        source.stop(now + 0.1);
      } catch {
        /* already stopped */
      }
    }
    this.cue.clear();
  }

  /** Settings: the motif's opening on the chosen instrument (heard even with Fish Notes off). */
  previewInstrument(): void {
    this.stopCue();
    this.playCue(this.theme.motif, 1, 0.85, { route: 'preview' });
  }

  /** Settings: the chosen theme's start sting. */
  previewTheme(): void {
    this.stopCue();
    this.playCue(this.theme.startSting, 1, 0.85, { route: 'preview', pad: true });
  }

  /** Settings: a splash and three notes through the whole output chain, for the level meter. */
  testSound(): void {
    this.stopCue();
    this.play('splash1', 'preview', 0.5);
    this.playCue(this.theme.phaseSting, 1, 0.85, { route: 'preview' });
  }

  /** A tiny tick for buttons and switches. */
  uiTick(): void {
    if (this.allowed('ui') && this.fresh('ui')) this.tone(1320, 0.05, 0.1, 'sine', 'ui');
  }

  /** One sound, so a fader can be set by ear. */
  preview(key: Channel): void {
    if (!this.ctx || !this.fresh(`preview-${key}`, 0.12)) return;
    if (key === 'notes') this.voice(3, 0.8, this.ctx.currentTime, { route: 'preview' });
    else if (key === 'sfx') this.play('splash1', 'sfx', 0.5);
    else if (key === 'ui') this.tone(1320, 0.05, 0.1, 'sine', 'ui');
  }

  /** Eel warning: a soft crackle for the length of the warning. It is cut short if the eel does not come. */
  warn(): void {
    if (this.allowed('warn')) this.warning = this.crackle(0.6, 0.15);
  }

  /** An eel slipping just past the net. */
  nearMiss(): void {
    if (this.allowed('near')) this.crackle(0.25, 0.18);
  }

  cancelWarning(): void {
    if (this.ctx && this.warning) this.warning.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
    this.warning = null;
  }

  /** Dry electric crackle (eel warning, near misses, the frying basket). */
  crackle(length = 0.5, level = 0.3): GainNode | null {
    const { ctx } = this;
    const bus = this.buses.get('sfx');
    if (!ctx || !bus || !this.fresh(`crackle-${length}`) || !this.claim(ctx.currentTime, length)) return null;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const env = 1 - i / data.length;
      // Sparse spikes that ring down, band-passed below: the crackle is in the filter, not in clicks.
      data[i] = this.rng.next() > 0.985 ? (this.rng.next() * 2 - 1) * env : (data[i - 1] ?? 0) * 0.6;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level * 1.6, now + ATTACK);
    gain.gain.setTargetAtTime(0, now + length * 0.8, length * 0.05);
    source.connect(filter).connect(gain).connect(bus);
    source.start(now);
    return gain;
  }

  /** The shock: a falling buzz and a burst of crackle; the music drops away. */
  zap(): void {
    const { ctx } = this;
    const bus = this.buses.get('sfx');
    if (!ctx || !bus || !this.allowed('eel')) return;
    this.duckMusic(3.5, 0.12);
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.7);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + ATTACK);
    gain.gain.setTargetAtTime(0, now + 0.05, 0.16);
    osc.connect(tone).connect(gain).connect(bus);
    osc.start(now);
    osc.stop(now + 1.2);
    // The buzz is the shock; the crackle rides on it (and stays out of a solo'd measurement).
    if (this.solo === null) this.crackle(0.9, 0.4);
  }

  /** The basket frying: a longer sizzle under the crackle. */
  fry(): void {
    if (!this.allowed('fry')) return;
    this.noise(1.2, 0.16, 'highpass', 3800, 3800, 0.02);
    this.crackle(1.0, 0.3);
  }

  /** Fetch and decode the rain and thunder files (once). Until they arrive, thunder is a synthesized rumble. */
  loadWeather(): void {
    if (this.weatherLoading) return;
    this.weatherLoading = true;
    for (const [id, path] of Object.entries(WEATHER_FILES)) {
      void (async (): Promise<void> => {
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
          if (!response.ok) throw new Error(`${response.status}`);
          const data = await response.arrayBuffer();
          if (this.ctx) await this.decode(id, data, this.ctx);
          else this.pending.push([id, data]);
          this.applyRain();
        } catch (error) {
          this.errors.push(`${id}: ${String(error)}`);
          console.warn(`Audio "${id}" failed to load; continuing without it.`, error);
        }
      })();
    }
  }

  /** How hard it is raining: 0 none, about 0.7 light, 1.7 heavy. The two layers crossfade on the ambience fader. */
  setRain(level: number): void {
    if (Math.abs(level - this.rainLevel) < 0.02 && level > 0 === this.rainLevel > 0) return;
    this.rainLevel = level;
    this.applyRain();
  }

  private applyRain(): void {
    const { ctx } = this;
    const bus = this.buses.get('ambience');
    if (!ctx || !bus) return;
    const level = this.bedsOn && this.allowed('rain') ? this.rainLevel : 0;
    const want: Record<string, number> = {
      rainLight: Math.min(1, level) * (1 - 0.5 * Math.max(0, Math.min(1, level - 1))),
      rainHeavy: Math.max(0, Math.min(1, level - 0.9)),
    };
    for (const [id, target] of Object.entries(want)) {
      let layer = this.rain.get(id);
      const buffer = this.buffers.get(id);
      if (!layer && target > 0 && buffer) {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        // Loop inside the encoder's padding so the seam is rain, not a gap.
        source.loopStart = 0.05;
        source.loopEnd = Math.max(1, buffer.duration - 0.08);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(gain).connect(bus);
        source.start();
        layer = { source, gain };
        this.rain.set(id, layer);
      }
      layer?.gain.gain.setTargetAtTime(target, ctx.currentTime, 0.6);
    }
  }

  /** Thunder: one of three recorded rolls, or a synthesized rumble until they have loaded. */
  thunder(): void {
    if (!this.allowed('thunder')) return;
    const id = `thunder${1 + Math.floor(this.rng.next() * 3)}`;
    if (this.buffers.has(id)) this.play(id, 'sfx', 0.55, 0.92 + this.rng.next() * 0.16);
    else this.noise(2.8, 0.2, 'lowpass', 240, 70, 0.12);
  }

  /** Filtered noise with a swell-and-fade envelope (the rush of a speed-up, the frying basket). */
  private noise(length: number, level: number, type: BiquadFilterType, fromHz: number, toHz: number, attack: number): void {
    const { ctx } = this;
    const bus = this.buses.get('sfx');
    if (!ctx || !bus || !this.claim(ctx.currentTime, length)) return;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = this.rng.next() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 0.8;
    const now = ctx.currentTime;
    filter.frequency.setValueAtTime(fromHz, now);
    filter.frequency.exponentialRampToValueAtTime(toHz, now + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + attack);
    gain.gain.setTargetAtTime(0, now + attack, (length - attack) / 5);
    source.connect(filter).connect(gain).connect(bus);
    source.start(now);
  }

  /** The current quickening: a soft band of water noise sweeping upward. */
  private rush(): void {
    this.noise(0.9, 0.09, 'bandpass', 500, 2400, 0.3);
  }

  /** Fader position to gain. Sliders are perceptual: the position is squared. */
  private routeGain(route: Route): number {
    const s = this.settings;
    const fader = (key: Channel, from: AudioSettings = s): number => TRIM[route] * from.volume[key] ** 2 * 1.6;
    if (this.audition) {
      // Motifs and the bed at default levels; the game's other sounds stay out of the way.
      if (route === 'music' || route === 'cue') return fader('music', DEFAULT_AUDIO);
      return route === 'notes' || route === 'preview' ? fader('notes', DEFAULT_AUDIO) : 0;
    }
    switch (route) {
      case 'music':
        return s.enabled.music ? fader('music') : 0;
      case 'cue':
        // Stingers follow the music fader; with Music off they are game cues and follow Sounds.
        return s.enabled.music ? fader('music') : s.enabled.sfx ? fader('sfx') * 0.8 : 0;
      case 'notes':
        return s.enabled.notes ? fader('notes') : 0;
      case 'preview':
        return fader('notes', DEFAULT_AUDIO);
      default:
        return s.enabled.sfx ? fader(route) : 0;
    }
  }

  /** Push the settings into the running graph. Changes glide over a few tens of milliseconds. */
  private apply(immediate = false): void {
    const { ctx, mix, mono, eq, comp, out, reverbReturn } = this;
    if (!ctx || !mix || !mono || !eq || !comp || !out || !reverbReturn) return;
    const s = this.settings;
    const now = ctx.currentTime;
    const set = (param: AudioParam, value: number, glide = 0.03): void => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, glide);
    };
    set(mix.gain, this.audition ? 1 : s.muted ? 0 : (s.master / DEFAULT_AUDIO.master) ** 2, 0.02);
    for (const route of ROUTES) {
      const gain = this.routeGain(route);
      const bus = this.buses.get(route);
      const wet = this.wetFaders.get(route);
      if (bus) set(bus.gain, gain);
      if (wet) set(wet.gain, gain);
    }
    set(eq.bass.gain, s.bass);
    set(eq.mid.gain, s.mid);
    set(eq.treble.gain, s.treble);
    // Night: quieter, with the loud moments pulled down toward the quiet ones.
    const night = s.night;
    set(comp.threshold, night ? -30 : -16);
    set(comp.ratio, night ? 8 : 3);
    // The compressor's make-up gain rises as its threshold drops, so the trim is larger than it looks.
    set(out.gain, night ? 0.4 : 1);
    set(reverbReturn.gain, s.reverb);
    mono.channelCount = s.mono ? 1 : 2;
    mono.channelCountMode = s.mono ? 'explicit' : 'max';
    mono.channelInterpretation = 'speakers';
  }

  /** False when the same sound was started a moment ago (same frame, or stacked events). */
  private fresh(key: string, gap = SAME_SOUND_GAP): boolean {
    const now = this.ctx?.currentTime ?? 0;
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < gap) return false;
    this.lastPlayed.set(key, now);
    return true;
  }

  /** Reserve a voice until `when + length`. Returns false when the cap is reached. */
  private claim(when: number, length: number, important = false): boolean {
    const now = this.ctx?.currentTime ?? 0;
    this.voices = this.voices.filter((end) => end > now);
    if (!important && this.voices.length >= MAX_VOICES) return false;
    this.voices.push(Math.max(now, when) + length);
    return true;
  }

  /** Where voices on a route connect: dry to the fader, and a share to the reverb. */
  private entry(route: Route, tracked = false): AudioNode | null {
    const { ctx } = this;
    const bus = this.buses.get(route);
    if (!ctx || !bus) return null;
    const store = tracked ? this.groups : this.entries;
    let node = store.get(route);
    if (!node) {
      node = ctx.createGain();
      node.connect(bus);
      const wet = this.wetFaders.get(route);
      if (wet) {
        const send = ctx.createGain();
        send.gain.value = WET[route] ?? 0;
        node.connect(send).connect(wet);
      }
      store.set(route, node);
    }
    return node;
  }

  private async preload(): Promise<void> {
    // An offline context can decode before any gesture; without one, decoding waits for unlock().
    const Offline = window.OfflineAudioContext;
    const decoder = Offline ? new Offline(2, 1, 44100) : null;
    await Promise.all(
      Object.entries(FILES).map(([id, path]) => {
        const job = (async (): Promise<void> => {
          try {
            const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
            if (!response.ok) throw new Error(`${response.status}`);
            const data = await response.arrayBuffer();
            const context = decoder ?? this.ctx;
            if (context) await this.decode(id, data, context);
            else this.pending.push([id, data]);
          } catch (error) {
            this.errors.push(`${id}: ${String(error)}`);
            console.warn(`Audio "${id}" failed to load; continuing without it.`, error);
          }
        })();
        this.files.set(id, job);
        return job;
      }),
    );
  }

  private async decode(id: string, data: ArrayBuffer, context: BaseAudioContext): Promise<void> {
    try {
      this.buffers.set(id, await context.decodeAudioData(data));
      if (this.wantLoops && (id === 'ambience' || id === 'music')) this.startLoop(id);
    } catch (error) {
      this.errors.push(`${id}: ${String(error)}`);
    }
  }

  private startLoop(id: 'ambience' | 'music'): void {
    const buffer = this.buffers.get(id);
    const bus = id === 'music' ? this.duck : this.buses.get(id);
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
    this.loops.set(id, { source, fade });
  }

  /** A sample one-shot, faded in over a few milliseconds. */
  private play(id: string, route: Route, volume: number, rate = 1, when = 0): void {
    const { ctx } = this;
    const buffer = this.buffers.get(id);
    const out = this.buses.get(route);
    if (!ctx || !buffer || !out) return;
    const start = Math.max(ctx.currentTime, when);
    if (!this.claim(start, Math.min(1.2, buffer.duration / rate))) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + ATTACK);
    source.connect(gain).connect(out);
    source.start(start);
  }

  /** Play a rhythmic cue (sting, fanfare, phrase). `stretch` slows it; `hold` lets the last notes ring. */
  private playCue(
    notes: readonly CueNote[],
    stretch: number,
    level: number,
    options: { route?: 'notes' | 'cue' | 'preview'; pad?: boolean; hold?: boolean } = {},
  ): void {
    const { ctx } = this;
    if (!ctx) return;
    const route = options.route ?? 'cue';
    // Start on the music's next eighth so the cue sits in time.
    const now = ctx.currentTime + 0.03;
    const start = this.musicStart > 0 ? this.musicStart + Math.ceil((now - this.musicStart) / EIGHTH) * EIGHTH : now;
    const last = Math.max(...notes.map((n) => n.at));
    for (const note of notes) {
      const when = start + note.at * EIGHTH * stretch;
      this.voice(note.degree, (note.level ?? 0.85) * level, when, {
        route,
        track: true,
        important: true,
        ring: options.hold && note.at === last ? 2.6 : 1,
      });
    }
    if (options.pad) this.pad(notes[0]?.degree ?? 0, start, (last + 6) * EIGHTH * stretch, 0.1 * level, route);
  }

  /**
   * One note on the chosen Fish Notes instrument. Koto is the sampled pluck with its harsh top
   * rolled off over a sine body; kalimba, soft bell and marimba are small sets of sine partials.
   */
  private voice(degree: number, volume: number, when: number, options: VoiceOptions = {}): void {
    const { ctx } = this;
    const route = options.route ?? 'notes';
    const out = this.entry(route, options.track);
    if (!ctx || !out) return;
    const ring = options.ring ?? 1;
    const start = Math.max(ctx.currentTime, when);
    if (!this.claim(start, 1.1 * ring, options.important)) return;
    const instrument = options.instrument ?? this.settings.instrument;
    const hz = degreeToHz(degree);
    const mix = ctx.createGain();
    mix.gain.value = volume;
    mix.connect(out);
    const keep = (node: AudioScheduledSourceNode): void => {
      if (!options.track) return;
      this.cue.add(node);
      node.onended = () => this.cue.delete(node);
    };

    if (instrument === 'koto') {
      // Pluck (attack and character), low-passed.
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = Math.min(3400, hz * 5);
      tone.Q.value = 0.5;
      const pluckGain = ctx.createGain();
      pluckGain.gain.setValueAtTime(0, start);
      pluckGain.gain.linearRampToValueAtTime(0.75, start + 0.003);
      pluckGain.gain.setTargetAtTime(0, start + 0.5 * ring, 0.3 * ring);
      tone.connect(pluckGain).connect(mix);
      const source = ctx.createBufferSource();
      const sample = this.buffers.get('koto');
      if (sample) {
        source.buffer = sample;
        source.playbackRate.value = hz / KOTO_HZ;
      } else {
        // Sample missing: a synthesized plucked string (Karplus-Strong).
        const period = Math.max(2, Math.round(ctx.sampleRate / hz));
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        const pick = Math.max(1, Math.round(period * 0.18));
        for (let i = 0; i < period; i++) data[i] = this.rng.next() * 2 - 1;
        for (let i = period - 1; i >= pick; i--) data[i] = (data[i] ?? 0) - (data[i - pick] ?? 0);
        for (let i = period; i < data.length; i++) data[i] = ((data[i - period] ?? 0) + (data[i - period + 1] ?? 0)) * 0.5 * 0.995;
        source.buffer = buffer;
      }
      source.connect(tone);
      source.start(start);
      // By now the envelope above has closed (seven time constants).
      source.stop(start + (0.5 + 0.3 * 7) * ring);
      keep(source);
    }

    for (const [ratio, level, decay, attack] of BODIES[instrument]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = hz * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(level, start + attack);
      gain.gain.setTargetAtTime(0, start + attack, decay * ring);
      osc.connect(gain).connect(mix);
      osc.start(start);
      osc.stop(start + attack + decay * 7 * ring);
      keep(osc);
    }
  }

  /** A soft sustained fifth under a sting or fanfare. */
  private pad(degree: number, when: number, length: number, level: number, route: Route): void {
    const { ctx } = this;
    const out = this.entry(route, true);
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
      osc.stop(when + length + 3.5);
      this.cue.add(osc);
      osc.onended = () => this.cue.delete(osc);
    }
  }

  /**
   * The Fish-Notes-off catch chime: two soft sine partials on the tonic or the fifth (alternating),
   * 120 ms long. Both notes sit inside every chord of the D-centred bed. A koi rolls three of them.
   */
  private softChime(koi: boolean): void {
    const { ctx } = this;
    const out = this.entry('sfx');
    if (!ctx || !out) return;
    this.chimeToggle = !this.chimeToggle;
    const degrees = koi ? [5, 8, 10] : [this.chimeToggle ? 10 : 8];
    degrees.forEach((degree, i) => {
      const start = ctx.currentTime + i * 0.055;
      if (!this.claim(start, 0.3)) return;
      const hz = degreeToHz(degree);
      for (const [ratio, level, decay] of [
        [1, koi ? 0.11 : 0.085, 0.06],
        [2, 0.02, 0.03],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz * ratio;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(level, start + 0.006);
        gain.gain.setTargetAtTime(0, start + 0.006, decay);
        osc.connect(gain).connect(out);
        osc.start(start);
        osc.stop(start + 0.006 + decay * 7);
      }
    });
  }

  private chime(degree: number, volume: number, when: number): void {
    if (this.buffers.has('chime'))
      this.play('chime', 'notes', volume * 0.45, Math.min(2, Math.max(0.5, degreeToHz(degree + 5) / CHIME_HZ)), when);
    else this.tone(degreeToHz(degree + 10), 0.9, volume * 0.2, 'sine', 'notes', when);
  }

  /** A plain enveloped tone; `toHz` glides the pitch (the miss knock). */
  private tone(hz: number, length: number, volume: number, type: OscillatorType, route: Route, when = 0, toHz?: number): void {
    const { ctx } = this;
    const out = this.buses.get(route);
    if (!ctx || !out) return;
    const start = Math.max(ctx.currentTime, when);
    if (!this.claim(start, length)) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, start);
    if (toHz) osc.frequency.exponentialRampToValueAtTime(toHz, start + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + ATTACK);
    gain.gain.setTargetAtTime(0, start + ATTACK, length / 5);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + ATTACK + length * 1.4);
  }
}
