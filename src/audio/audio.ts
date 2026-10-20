// Every sound is synthesized with Web Audio: no asset files. Nothing plays until start() is
// called from a click, as browsers require.

export enum Sfx {
  Jump = 'jump',
  Land = 'land',
  GrappleFire = 'grapple-fire',
  GrappleAttach = 'grapple-attach',
  GrappleMiss = 'grapple-miss',
  GrappleRelease = 'grapple-release',
  PadThrow = 'pad-throw',
  PadInvalid = 'pad-invalid',
  PadLaunch = 'pad-launch',
  Checkpoint = 'checkpoint',
  Finish = 'finish',
  PersonalBest = 'personal-best',
  Respawn = 'respawn',
  Slide = 'slide',
  Mantle = 'mantle',
  SkatesOn = 'skates-on',
  Select = 'select',
}

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** A gentle four-chord loop: pad, bass and soft percussion, scheduled ahead of time. */
const MUSIC = {
  bpm: 104,
  // I – vi – IV – V in C, one chord per bar, as MIDI notes.
  chords: [
    [60, 64, 67, 71],
    [57, 60, 64, 67],
    [53, 57, 60, 64],
    [55, 59, 62, 65],
  ],
  bass: [36, 33, 29, 31],
  /** Arpeggio pattern over each bar's chord, in 8th notes (index into the chord, -1 rest). */
  arp: [0, 2, 1, 3, 2, 1, 3, -1],
};

export class GameAudio {
  private ctx: AudioContext | null = null;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private roll!: { gain: GainNode; filter: BiquadFilterNode };
  private sfxVolume = 0.8;
  private musicVolume = 0.5;
  private nextBeat = 0;
  private beat = 0;
  private paused = false;

  /** Creates the audio graph; call from a user gesture. Safe to call again. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createDynamicsCompressor();
    master.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(master);
    this.musicBus.connect(master);
    this.applyVolumes();

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.wind = this.loopNoise('bandpass', 600);
    this.roll = this.loopNoise('lowpass', 900);
    this.nextBeat = ctx.currentTime + 0.1;
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    this.applyVolumes();
  }

  /** Silences the continuous sounds and music while the game is paused. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(paused ? 0 : this.musicVolume * 0.35, t, 0.1);
    if (paused) {
      this.wind.gain.gain.setTargetAtTime(0, t, 0.05);
      this.roll.gain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.02);
    this.musicBus.gain.setTargetAtTime(this.paused ? 0 : this.musicVolume * 0.35, t, 0.02);
  }

  private loopNoise(type: BiquadFilterType, freq: number): { gain: GainNode; filter: BiquadFilterNode } {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start();
    return { gain, filter };
  }

  /**
   * Per frame: wind rises with speed; the rollerblade roll hums while skating on the ground.
   * Also keeps the music scheduled.
   */
  update(speed: number, rolling: boolean, groundSpeed: number): void {
    const ctx = this.ctx;
    if (!ctx || this.paused) return;
    const t = ctx.currentTime;
    const w = Math.min(1, Math.max(0, (speed - 8) / 30));
    this.wind.gain.gain.setTargetAtTime(w * w * 0.35, t, 0.15);
    this.wind.filter.frequency.setTargetAtTime(400 + w * 1400, t, 0.15);
    const r = rolling ? Math.min(1, groundSpeed / 20) : 0;
    this.roll.gain.gain.setTargetAtTime(r * 0.12, t, 0.08);
    this.roll.filter.frequency.setTargetAtTime(300 + r * 900, t, 0.08);
    this.scheduleMusic();
  }

  private scheduleMusic(): void {
    const ctx = this.ctx!;
    const eighth = 60 / MUSIC.bpm / 2;
    while (this.nextBeat < ctx.currentTime + 0.3) {
      const t = this.nextBeat;
      const bar = Math.floor(this.beat / 8) % MUSIC.chords.length;
      const step = this.beat % 8;
      const chord = MUSIC.chords[bar];
      if (step === 0) {
        for (const n of chord) this.tone(midi(n), t, eighth * 8, 'triangle', 0.05, this.musicBus, 0.4, eighth * 3);
        this.tone(midi(MUSIC.bass[bar]), t, eighth * 3, 'sine', 0.22, this.musicBus, 0.01);
      }
      if (step === 4) this.tone(midi(MUSIC.bass[bar] + 7), t, eighth * 2, 'sine', 0.15, this.musicBus, 0.01);
      const a = MUSIC.arp[step];
      if (a >= 0) this.tone(midi(chord[a] + 12), t, eighth * 0.9, 'square', 0.025, this.musicBus, 0.005);
      // Soft kick on beats, a hat on the off-beats.
      if (step % 4 === 0) this.kick(t);
      if (step % 2 === 1) this.hat(t);
      this.nextBeat += eighth;
      this.beat++;
    }
  }

  private tone(
    freq: number,
    t: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    bus: AudioNode = this.sfxBus,
    attack = 0.005,
    release = dur * 0.8,
    endFreq?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.setTargetAtTime(0, t + Math.max(attack, dur - release), release / 3 + 0.001);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + release + 0.1);
  }

  private burst(t: number, dur: number, type: BiquadFilterType, freq: number, vol: number, bus: AudioNode = this.sfxBus, endFreq?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    this.tone(120, t, 0.18, 'sine', 0.25, this.musicBus, 0.002, 0.15, 45);
  }

  private hat(t: number): void {
    this.burst(t, 0.05, 'highpass', 7000, 0.04, this.musicBus);
  }

  play(sfx: Sfx, intensity = 1): void {
    const ctx = this.ctx;
    if (!ctx || this.paused) return;
    const t = ctx.currentTime + 0.005;
    switch (sfx) {
      case Sfx.Jump:
        this.tone(330, t, 0.12, 'square', 0.06, undefined, 0.003, 0.08, 620);
        break;
      case Sfx.Land:
        this.burst(t, 0.12, 'lowpass', 500 + 800 * Math.min(1, intensity / 20), 0.12 + 0.2 * Math.min(1, intensity / 25));
        break;
      case Sfx.GrappleFire:
        this.burst(t, 0.14, 'bandpass', 3000, 0.15, undefined, 900);
        break;
      case Sfx.GrappleAttach:
        this.tone(880, t, 0.06, 'square', 0.08);
        this.burst(t, 0.05, 'highpass', 4000, 0.1);
        break;
      case Sfx.GrappleMiss:
        this.tone(300, t, 0.12, 'triangle', 0.06, undefined, 0.003, 0.1, 200);
        break;
      case Sfx.GrappleRelease:
        this.burst(t, 0.25, 'bandpass', 800, 0.12, undefined, 2400);
        break;
      case Sfx.PadThrow:
        this.tone(500, t, 0.1, 'sine', 0.1, undefined, 0.003, 0.08, 900);
        this.burst(t + 0.08, 0.06, 'lowpass', 1200, 0.12);
        break;
      case Sfx.PadInvalid:
        this.tone(220, t, 0.15, 'triangle', 0.08, undefined, 0.003, 0.1, 160);
        break;
      case Sfx.PadLaunch:
        this.tone(160, t, 0.35, 'sine', 0.3, undefined, 0.003, 0.2, 720);
        this.burst(t, 0.3, 'bandpass', 600, 0.15, undefined, 3000);
        break;
      case Sfx.Checkpoint:
        this.tone(midi(76), t, 0.15, 'triangle', 0.12);
        this.tone(midi(83), t + 0.1, 0.25, 'triangle', 0.12);
        break;
      case Sfx.Finish:
        [72, 76, 79, 84].forEach((n, i) => this.tone(midi(n), t + i * 0.09, 0.4, 'triangle', 0.13));
        break;
      case Sfx.PersonalBest:
        [72, 76, 79, 84, 88, 91].forEach((n, i) => this.tone(midi(n), t + i * 0.07, 0.5, 'square', 0.06));
        this.tone(midi(96), t + 0.45, 0.8, 'triangle', 0.1);
        break;
      case Sfx.Slide:
        this.burst(t, 0.45, 'bandpass', 2600, 0.14, undefined, 900);
        break;
      case Sfx.Mantle:
        this.burst(t, 0.08, 'lowpass', 700, 0.25);
        this.tone(180, t + 0.05, 0.15, 'triangle', 0.08, undefined, 0.01, 0.1, 260);
        break;
      case Sfx.SkatesOn:
        this.tone(330, t, 0.08, 'square', 0.06);
        this.tone(660, t + 0.07, 0.12, 'square', 0.06);
        this.burst(t, 0.2, 'highpass', 3000, 0.08);
        break;
      case Sfx.Respawn:
        this.tone(600, t, 0.2, 'sine', 0.1, undefined, 0.003, 0.15, 300);
        break;
      case Sfx.Select:
        this.tone(midi(79), t, 0.06, 'square', 0.05);
        break;
    }
  }
}
