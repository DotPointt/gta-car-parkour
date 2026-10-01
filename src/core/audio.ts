/** Fully procedural WebAudio sound: engine, tyres, wind, scraping, crashes, glass, UI beeps. */
export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;

  // engine
  private eOsc: OscillatorNode[] = [];
  private eFilter!: BiquadFilterNode;
  private eGain!: GainNode;
  // loops
  private tyreGain!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private scrapeGain!: GainNode;
  private hornGain!: GainNode;

  private lastCrash = 0;

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // white noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // --- engine: detuned saws + sub square -> waveshaper -> lowpass
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    this.eFilter = ctx.createBiquadFilter();
    this.eFilter.type = 'lowpass';
    this.eFilter.Q.value = 2.5;
    this.eGain = ctx.createGain();
    this.eGain.gain.value = 0;
    const mix = ctx.createGain();
    mix.gain.value = 0.35;
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'square', 'triangle'];
    const gains = [0.5, 0.35, 0.28, 0.5];
    types.forEach((t, i) => {
      const o = ctx.createOscillator();
      o.type = t;
      const g = ctx.createGain();
      g.gain.value = gains[i];
      o.connect(g).connect(mix);
      o.start();
      this.eOsc.push(o);
    });
    mix.connect(shaper).connect(this.eFilter).connect(this.eGain).connect(this.master);

    // --- tyre screech: noise -> 2 bandpasses
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    const tSrc = this.loopNoise();
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = 1150;
    bp1.Q.value = 6;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2250;
    bp2.Q.value = 8;
    tSrc.connect(bp1).connect(this.tyreGain);
    tSrc.connect(bp2).connect(this.tyreGain);
    this.tyreGain.connect(this.master);

    // --- wind
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 400;
    this.loopNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // --- scrape (metal on asphalt)
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 3200;
    sbp.Q.value = 1.5;
    this.loopNoise().connect(sbp).connect(this.scrapeGain).connect(this.master);

    // --- horn (two detuned squares)
    this.hornGain = ctx.createGain();
    this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter();
    hf.type = 'lowpass';
    hf.frequency.value = 1800;
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hf);
      o.start();
    }
    hf.connect(this.hornGain).connect(this.master);
  }

  private loopNoise() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * 1.5);
    return src;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** Per-frame continuous sounds. */
  update(p: { rpm: number; throttle: number; speed: number; slip: number; scrape: number; horn: boolean; active: boolean }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const k = 0.04;
    const rpm = p.rpm;
    // V8: 4 firing pulses per crank revolution
    const f = (rpm / 60) * 4 * 0.5;
    const jitter = 1 + (Math.random() - 0.5) * 0.012;
    this.eOsc[0].frequency.setTargetAtTime(f * jitter, t, 0.015);
    this.eOsc[1].frequency.setTargetAtTime(f * 1.007 * 2, t, 0.015);
    this.eOsc[2].frequency.setTargetAtTime(f * 0.5, t, 0.015);
    this.eOsc[3].frequency.setTargetAtTime(f * 0.25, t, 0.015);
    const load = 0.35 + 0.65 * p.throttle;
    this.eFilter.frequency.setTargetAtTime(220 + (rpm / 7200) * 2600 * load, t, k);
    this.eGain.gain.setTargetAtTime(p.active ? 0.2 + 0.28 * p.throttle + (rpm / 7200) * 0.12 : 0, t, 0.06);

    const tyre = Math.min(1, Math.max(0, (p.slip - 1.2) / 6));
    this.tyreGain.gain.setTargetAtTime(p.active ? tyre * 0.22 : 0, t, 0.05);

    const w = Math.min(1, p.speed / 70);
    this.windGain.gain.setTargetAtTime(p.active ? w * w * 0.35 : 0, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + w * 1400, t, 0.1);

    this.scrapeGain.gain.setTargetAtTime(p.active ? Math.min(0.3, p.scrape * 0.3) : 0, t, 0.04);
    this.hornGain.gain.setTargetAtTime(p.horn ? 0.12 : 0, t, 0.02);
  }

  crash(intensity: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (t - this.lastCrash < 0.06) return;
    this.lastCrash = t;
    const I = Math.min(1, Math.max(0.05, intensity));
    // noise body
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 + 3500 * I, t);
    lp.frequency.exponentialRampToValueAtTime(250, t + 0.35 + 0.3 * I);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 + 0.9 * I, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3 + 0.5 * I);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 1.2);
    // low thump
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9 * I, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
    // metallic clank partials
    for (let i = 0; i < 3; i++) {
      const m = ctx.createOscillator();
      m.type = 'triangle';
      m.frequency.value = 280 + Math.random() * 900;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.18 * I, t);
      mg.gain.exponentialRampToValueAtTime(0.001, t + 0.12 + Math.random() * 0.25);
      m.connect(mg).connect(this.master);
      m.start(t);
      m.stop(t + 0.5);
    }
  }

  glass() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 7; i++) {
      const t = t0 + Math.random() * 0.25;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000 + Math.random() * 4000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.12);
      src.connect(hp).connect(g).connect(this.master);
      src.start(t, Math.random());
      src.stop(t + 0.3);
    }
  }

  beep(high = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = high ? 1046 : 523;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.7 : 0.25));
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.8);
  }

  whoosh() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(3000, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.8);
  }

  fanfare() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const g = ctx.createGain();
      const s = t + i * 0.12;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.18, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, s + (i === 3 ? 1.2 : 0.3));
      o.connect(lp).connect(g).connect(this.master);
      o.start(s);
      o.stop(s + 1.3);
    });
  }
}
