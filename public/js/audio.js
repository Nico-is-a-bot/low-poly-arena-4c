// Sound effects, all generated in code with the Web Audio API (no audio files).
// Everything goes through one master volume.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.volume = 0.7;
    this.timers = [];
  }

  /** Must be called from a click or key press (browsers block sound before that). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -8;
      comp.knee.value = 12;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      this.master = this.ctx.createGain();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.applyVolume();

      // One second of white noise, reused for every noisy sound.
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  /** percent is 0 to 100 */
  setVolume(percent) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    this.applyVolume();
  }

  applyVolume() {
    if (this.master) this.master.gain.value = this.volume * this.volume;
  }

  get ready() {
    return !!this.ctx && this.volume > 0;
  }

  // ------------------------------------------------------------ building blocks

  // Quick attack, then a smooth exponential fade (about -35 dB by the end of `decay`).
  _gain(peak, t0, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.setTargetAtTime(0.0001, t0 + attack, decay / 4);
    g.connect(this.master);
    return g;
  }

  /** A short pitched sound. */
  tone({ type = 'sine', f0 = 440, f1 = null, dur = 0.1, vol = 0.3, attack = 0.002, when = 0 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);   // pitch glide
    const g = this._gain(vol, t0, attack, dur);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + attack + dur * 1.6 + 0.05);
  }

  /** A burst of filtered noise. */
  noise({ dur = 0.1, vol = 0.3, type = 'bandpass', f0 = 1500, f1 = null, q = 0.8, attack = 0.001, when = 0 }) {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t0);
    if (f1 !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = this._gain(vol, t0, attack, dur);
    src.connect(filt);
    filt.connect(g);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + attack + dur * 1.6 + 0.05);
  }

  _later(ms, fn) {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }

  // ------------------------------------------------------------ weapons

  /** gain 0..1 makes far away shots (from other players) quieter and duller. */
  shot(kind, gain = 1) {
    if (!this.ready || gain <= 0.01) return;
    const v = 0.94 + Math.random() * 0.12;   // tiny random pitch change so it never sounds copy-pasted
    const dull = 0.5 + 0.5 * gain;
    switch (kind) {
      case 'smg':
        this.noise({ dur: 0.08, vol: 1.4 * gain, type: 'bandpass', f0: 3200 * v * dull, f1: 1200, q: 0.8 });
        this.tone({ type: 'triangle', f0: 200 * v, f1: 70, dur: 0.12, vol: 1.0 * gain });
        this.noise({ dur: 0.25, vol: 0.5 * gain, type: 'lowpass', f0: 1200, f1: 200, q: 0.5, when: 0.01 });
        break;
      case 'shotgun':
        this.noise({ dur: 0.2, vol: 2.0 * gain, type: 'bandpass', f0: 1800 * v * dull, f1: 500, q: 0.5 });
        this.tone({ type: 'triangle', f0: 110 * v, f1: 32, dur: 0.35, vol: 1.8 * gain });
        this.noise({ dur: 0.7, vol: 1.0 * gain, type: 'lowpass', f0: 800, f1: 90, q: 0.5, when: 0.015 });
        break;
      case 'lmg':
        this.noise({ dur: 0.14, vol: 1.8 * gain, type: 'bandpass', f0: 2000 * v * dull, f1: 700, q: 0.6 });
        this.tone({ type: 'triangle', f0: 130 * v, f1: 38, dur: 0.24, vol: 1.6 * gain });
        this.noise({ dur: 0.55, vol: 0.9 * gain, type: 'lowpass', f0: 900, f1: 120, q: 0.5, when: 0.01 });
        break;
      case 'sniper':
        this.noise({ dur: 0.1, vol: 2.2 * gain, type: 'highpass', f0: 2500 * dull, q: 0.7 });
        this.tone({ type: 'triangle', f0: 95 * v, f1: 26, dur: 0.45, vol: 2.0 * gain });
        this.noise({ dur: 1.2, vol: 1.1 * gain, type: 'lowpass', f0: 700, f1: 70, q: 0.5, when: 0.02 });
        this.noise({ dur: 0.4, vol: 0.5 * gain, type: 'bandpass', f0: 1500, f1: 400, q: 2, when: 0.18 });  // echo
        break;
      case 'pistol':
        this.noise({ dur: 0.07, vol: 1.5 * gain, type: 'bandpass', f0: 3000 * v * dull, f1: 1100, q: 0.9 });
        this.tone({ type: 'triangle', f0: 230 * v, f1: 80, dur: 0.14, vol: 1.1 * gain });
        this.noise({ dur: 0.3, vol: 0.5 * gain, type: 'lowpass', f0: 1100, f1: 200, q: 0.5, when: 0.01 });
        break;
      case 'mpistol':
        this.noise({ dur: 0.06, vol: 1.3 * gain, type: 'bandpass', f0: 3500 * v * dull, f1: 1400, q: 0.9 });
        this.tone({ type: 'square', f0: 260 * v, f1: 100, dur: 0.08, vol: 0.5 * gain });
        this.noise({ dur: 0.18, vol: 0.4 * gain, type: 'lowpass', f0: 1300, f1: 250, q: 0.5, when: 0.01 });
        break;
      case 'revolver':
        this.noise({ dur: 0.14, vol: 2.0 * gain, type: 'bandpass', f0: 2200 * v * dull, f1: 600, q: 0.6 });
        this.tone({ type: 'triangle', f0: 150 * v, f1: 36, dur: 0.4, vol: 1.9 * gain });
        this.noise({ dur: 0.8, vol: 0.9 * gain, type: 'lowpass', f0: 900, f1: 100, q: 0.5, when: 0.012 });
        break;
      case 'laser':
        this.tone({ type: 'sawtooth', f0: 1900 * v, f1: 300, dur: 0.14, vol: 0.55 * gain });
        this.tone({ type: 'square', f0: 900 * v, f1: 180, dur: 0.1, vol: 0.3 * gain });
        this.noise({ dur: 0.06, vol: 0.5 * gain, type: 'highpass', f0: 5000, q: 0.7 });
        break;
      case 'rail':
        this.tone({ type: 'sawtooth', f0: 90, f1: 1400 * v, dur: 0.12, vol: 0.6 * gain });
        this.tone({ type: 'sine', f0: 1800 * v, f1: 120, dur: 0.5, vol: 0.8 * gain, when: 0.1 });
        this.noise({ dur: 0.25, vol: 1.8 * gain, type: 'bandpass', f0: 3000 * dull, f1: 300, q: 0.5, when: 0.1 });
        this.tone({ type: 'triangle', f0: 100 * v, f1: 28, dur: 0.6, vol: 2.0 * gain, when: 0.1 });
        this.noise({ dur: 0.9, vol: 0.8 * gain, type: 'lowpass', f0: 600, f1: 70, q: 0.5, when: 0.12 });
        break;
      default:   // 'rifle'
        this.noise({ dur: 0.12, vol: 1.6 * gain, type: 'bandpass', f0: 2600 * v * dull, f1: 900, q: 0.7 });
        this.tone({ type: 'triangle', f0: 170 * v, f1: 46, dur: 0.2, vol: 1.3 * gain });
        this.noise({ dur: 0.5, vol: 0.75 * gain, type: 'lowpass', f0: 1000, f1: 160, q: 0.5, when: 0.01 });
    }
  }

  // ------------------------------------------------------------ melee

  /** The swish of a swing. gain makes other players' swings quieter. */
  swing(kind, gain = 1) {
    if (!this.ready || gain <= 0.01) return;
    const v = 0.92 + Math.random() * 0.16;
    if (kind === 'energy') {
      this.tone({ type: 'sawtooth', f0: 300 * v, f1: 900 * v, dur: 0.2, vol: 0.35 * gain });
      this.tone({ type: 'sine', f0: 600 * v, f1: 200, dur: 0.28, vol: 0.45 * gain, when: 0.05 });
      this.noise({ dur: 0.2, vol: 0.5 * gain, type: 'bandpass', f0: 2500, f1: 800, q: 1.2 });
    } else {
      this.noise({ dur: 0.2, vol: 0.9 * gain, type: 'bandpass', f0: 1200 * v, f1: 4200, q: 1.1 });
      this.noise({ dur: 0.12, vol: 0.4 * gain, type: 'highpass', f0: 5000, q: 0.7, when: 0.05 });
    }
  }

  /** A blade landing. */
  meleeHit(gain = 1) {
    if (!this.ready || gain <= 0.01) return;
    this.noise({ dur: 0.08, vol: 1.3 * gain, type: 'lowpass', f0: 900, f1: 250, q: 0.7 });
    this.tone({ type: 'sine', f0: 140, f1: 55, dur: 0.14, vol: 1.2 * gain });
    this.noise({ dur: 0.05, vol: 0.7 * gain, type: 'highpass', f0: 4500, q: 0.7 });
  }

  /** The loud sting for a backstab. */
  backstab() {
    this.tone({ type: 'sawtooth', f0: 90, f1: 40, dur: 0.35, vol: 1.2 });
    this.tone({ type: 'sine', f0: 1500, f1: 700, dur: 0.18, vol: 0.5, when: 0.02 });
    this.tone({ type: 'sine', f0: 2200, dur: 0.14, vol: 0.4, when: 0.06 });
  }

  /** A weapon coming out. */
  equip() {
    this.noise({ dur: 0.05, vol: 0.8, type: 'bandpass', f0: 2400, q: 1.2 });
    this.tone({ type: 'square', f0: 520, f1: 300, dur: 0.05, vol: 0.18, when: 0.02 });
    this.tone({ type: 'sine', f0: 160, f1: 90, dur: 0.08, vol: 0.5, when: 0.06 });
  }

  /** One shell going into the shotgun. */
  shell() {
    this.noise({ dur: 0.04, vol: 0.9, type: 'bandpass', f0: 2600, q: 1.4 });
    this.tone({ type: 'sine', f0: 200, f1: 100, dur: 0.07, vol: 0.7 });
  }

  /** Pumping the shotgun. */
  pump() {
    this.noise({ dur: 0.05, vol: 1.0, type: 'bandpass', f0: 1800, q: 1.2 });
    this.tone({ type: 'square', f0: 420, f1: 220, dur: 0.06, vol: 0.25 });
    this.noise({ dur: 0.05, vol: 1.1, type: 'bandpass', f0: 2300, q: 1.2, when: 0.16 });
    this.tone({ type: 'sine', f0: 190, f1: 90, dur: 0.1, vol: 0.9, when: 0.16 });
  }

  /** Working the bolt of the sniper rifle. */
  bolt() {
    this.noise({ dur: 0.04, vol: 1.0, type: 'bandpass', f0: 3000, q: 1.4 });
    this.tone({ type: 'square', f0: 900, f1: 500, dur: 0.04, vol: 0.2 });
    this.noise({ dur: 0.05, vol: 1.0, type: 'bandpass', f0: 2000, q: 1.2, when: 0.2 });
    this.tone({ type: 'sine', f0: 240, f1: 110, dur: 0.1, vol: 0.9, when: 0.2 });
  }

  /** Sounds that go with a shot: the bolt or pump a moment later. */
  afterShot(kind) {
    if (kind === 'shotgun') this._later(280, () => this.pump());
    else if (kind === 'sniper') this._later(450, () => this.bolt());
  }

  empty() {
    this.noise({ dur: 0.03, vol: 1.0, type: 'bandpass', f0: 4200, q: 1.5 });
    this.tone({ type: 'square', f0: 1300, f1: 800, dur: 0.04, vol: 0.22 });
  }

  /** Reload with magazine out, magazine in and bolt sounds spread over the reload time. */
  reload(duration, kind) {
    if (!this.ready) return;
    if (kind === 'shotgun') return;     // shells make their own sound, one at a time
    const at = (frac, fn) => this._later(frac * duration * 1000, fn);
    if (kind === 'laser' || kind === 'rail') {
      at(0.2, () => { this.tone({ type: 'sine', f0: 900, f1: 300, dur: 0.18, vol: 0.4 }); });
      at(0.6, () => { this.tone({ type: 'sine', f0: 300, f1: 1100, dur: 0.22, vol: 0.45 }); this.noise({ dur: 0.05, vol: 0.6, type: 'bandpass', f0: 2500, q: 1.2 }); });
      at(0.92, () => { this.tone({ type: 'sawtooth', f0: 200, f1: 900, dur: 0.15, vol: 0.3 }); });
      return;
    }
    if (kind === 'revolver') {
      at(0.15, () => { this.noise({ dur: 0.05, vol: 0.9, type: 'bandpass', f0: 2600, q: 1.3 }); this.tone({ type: 'square', f0: 600, f1: 300, dur: 0.05, vol: 0.2 }); });
      at(0.4, () => { this.noise({ dur: 0.12, vol: 0.9, type: 'bandpass', f0: 1800, f1: 3500, q: 2 }); });
      at(0.7, () => { this.noise({ dur: 0.1, vol: 0.9, type: 'bandpass', f0: 2200, f1: 1200, q: 2 }); });
      at(0.92, () => { this.noise({ dur: 0.05, vol: 1.2, type: 'bandpass', f0: 2000, q: 1.2 }); this.tone({ type: 'sine', f0: 220, f1: 110, dur: 0.09, vol: 0.9 }); });
      return;
    }
    at(0.2, () => {   // magazine out
      this.noise({ dur: 0.04, vol: 1.0, type: 'highpass', f0: 3500 });
      this.tone({ type: 'square', f0: 320, f1: 140, dur: 0.08, vol: 0.3 });
    });
    at(0.58, () => {  // new magazine in
      this.tone({ type: 'sine', f0: 130, f1: 70, dur: 0.12, vol: 1.1 });
      this.noise({ dur: 0.05, vol: 1.0, type: 'bandpass', f0: 2200, q: 1.2 });
    });
    if (kind === 'pistol' || kind === 'mpistol' || kind === 'smg') {
      at(0.86, () => {
        this.noise({ dur: 0.05, vol: 1.2, type: 'bandpass', f0: 2000, q: 1.2 });
        this.tone({ type: 'sine', f0: 220, f1: 110, dur: 0.09, vol: 0.9 });
      });
      return;
    }
    at(0.86, () => {  // pull the bolt
      this.noise({ dur: 0.04, vol: 1.1, type: 'bandpass', f0: 2800, q: 1.4 });
      this.tone({ type: 'square', f0: 900, f1: 500, dur: 0.04, vol: 0.22 });
    });
    at(0.94, () => {
      this.noise({ dur: 0.05, vol: 1.2, type: 'bandpass', f0: 2000, q: 1.2 });
      this.tone({ type: 'sine', f0: 220, f1: 110, dur: 0.09, vol: 0.9 });
    });
  }

  cancelReload() {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
  }

  // ------------------------------------------------------------ grenades

  /** Pulling the pin and throwing. */
  throwGrenade(gain = 1) {
    if (!this.ready || gain <= 0.01) return;
    this.tone({ type: 'square', f0: 1400, f1: 900, dur: 0.04, vol: 0.2 * gain });                  // the pin
    this.noise({ dur: 0.05, vol: 0.7 * gain, type: 'highpass', f0: 4000 });
    this.noise({ dur: 0.28, vol: 0.9 * gain, type: 'bandpass', f0: 500, f1: 1800, q: 0.8, when: 0.06 });   // whoosh
  }

  /** The bang (or hiss) of a grenade. gain 0..1 falls with distance. */
  grenadeBoom(kind, gain = 1) {
    if (!this.ready || gain <= 0.01) return;
    if (kind === 'flash') {
      this.noise({ dur: 0.12, vol: 2.4 * gain, type: 'highpass', f0: 1800, q: 0.7 });
      this.tone({ type: 'sine', f0: 220, f1: 50, dur: 0.25, vol: 1.2 * gain });
    } else if (kind === 'smoke') {
      this.noise({ dur: 1.4, vol: 0.9 * gain, type: 'highpass', f0: 2500, f1: 1500, q: 0.5 });
      this.tone({ type: 'sine', f0: 120, f1: 60, dur: 0.2, vol: 0.5 * gain });
    } else if (kind === 'incendiary') {
      this.tone({ type: 'sine', f0: 130, f1: 40, dur: 0.4, vol: 1.2 * gain });
      this.noise({ dur: 0.9, vol: 1.1 * gain, type: 'bandpass', f0: 900, f1: 300, q: 0.6 });
      for (let i = 0; i < 6; i++) this.noise({ dur: 0.04, vol: 0.5 * gain, type: 'highpass', f0: 3500, q: 0.7, when: 0.2 + i * 0.13 + Math.random() * 0.05 });   // crackle
    } else {   // frag and sticky
      this.noise({ dur: 0.18, vol: 2.4 * gain, type: 'bandpass', f0: 1600, f1: 400, q: 0.5 });
      this.tone({ type: 'triangle', f0: 95, f1: 24, dur: 0.7, vol: 2.4 * gain });
      this.noise({ dur: 1.1, vol: 1.2 * gain, type: 'lowpass', f0: 700, f1: 70, q: 0.5, when: 0.02 });
      this.noise({ dur: 0.5, vol: 0.5 * gain, type: 'bandpass', f0: 1200, f1: 300, q: 2, when: 0.25 });   // echo
    }
  }

  /** The high whine in your ears after a flashbang. */
  ring(seconds) {
    if (!this.ready) return;
    const dur = Math.max(0.5, seconds);
    this.tone({ type: 'sine', f0: 3400, f1: 3300, dur, vol: 0.18, attack: 0.05 });
    this.tone({ type: 'sine', f0: 5100, f1: 5000, dur: dur * 0.8, vol: 0.07, attack: 0.05 });
  }

  /** A grenade that cannot be thrown (none left or still waiting). */
  noGrenade() {
    this.tone({ type: 'square', f0: 300, f1: 200, dur: 0.06, vol: 0.2 });
  }

  // ------------------------------------------------------------ abilities

  /** gain 0..1 lets other players' abilities be heard quietly. */
  ability(kind, gain = 1) {
    if (!this.ready || gain <= 0.01) return;
    switch (kind) {
      case 'dash':
      case 'airdash':
        this.noise({ dur: 0.3, vol: 1.1 * gain, type: 'bandpass', f0: 400, f1: 2600, q: 0.8 });
        this.tone({ type: 'sine', f0: 180, f1: 420, dur: 0.18, vol: 0.5 * gain });
        break;
      case 'heal':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.5, vol: 0.4 * gain, when: i * 0.09 }));
        break;
      case 'armor':
        this.noise({ dur: 0.08, vol: 1.2 * gain, type: 'highpass', f0: 3000 });
        this.tone({ type: 'square', f0: 220, f1: 140, dur: 0.18, vol: 0.3 * gain });
        this.tone({ type: 'sine', f0: 880, f1: 1320, dur: 0.4, vol: 0.35 * gain, when: 0.05 });
        break;
      case 'scan':
        this.tone({ type: 'sine', f0: 700, f1: 700, dur: 0.12, vol: 0.5 * gain });
        this.tone({ type: 'sine', f0: 1400, f1: 300, dur: 0.9, vol: 0.4 * gain, when: 0.05 });
        this.noise({ dur: 0.5, vol: 0.3 * gain, type: 'bandpass', f0: 2000, f1: 500, q: 3, when: 0.05 });
        break;
      case 'grapple':
        this.noise({ dur: 0.05, vol: 1.2 * gain, type: 'highpass', f0: 3500 });
        this.tone({ type: 'sawtooth', f0: 1200, f1: 200, dur: 0.15, vol: 0.35 * gain });
        this.noise({ dur: 0.4, vol: 0.6 * gain, type: 'bandpass', f0: 600, f1: 1800, q: 1.5, when: 0.15 });
        break;
      case 'surge':
        this.tone({ type: 'sawtooth', f0: 110, f1: 440, dur: 0.5, vol: 0.5 * gain });
        this.tone({ type: 'square', f0: 220, f1: 880, dur: 0.4, vol: 0.2 * gain, when: 0.1 });
        this.noise({ dur: 0.3, vol: 0.5 * gain, type: 'highpass', f0: 2500, when: 0.35 });
        break;
      case 'shield':
        this.tone({ type: 'sine', f0: 140, f1: 420, dur: 0.5, vol: 0.5 * gain });
        this.tone({ type: 'triangle', f0: 280, f1: 840, dur: 0.45, vol: 0.25 * gain, when: 0.05 });
        this.noise({ dur: 0.35, vol: 0.5 * gain, type: 'bandpass', f0: 1500, f1: 3500, q: 1.5 });
        break;
      case 'mine':
        this.noise({ dur: 0.05, vol: 0.9 * gain, type: 'bandpass', f0: 2500, q: 1.2 });
        this.tone({ type: 'square', f0: 900, dur: 0.07, vol: 0.2 * gain, when: 0.03 });
        this.tone({ type: 'square', f0: 900, dur: 0.07, vol: 0.2 * gain, when: 0.16 });
        break;
      case 'cloak':
        this.noise({ dur: 0.6, vol: 0.7 * gain, type: 'bandpass', f0: 3000, f1: 300, q: 0.8 });
        this.tone({ type: 'sine', f0: 600, f1: 90, dur: 0.6, vol: 0.4 * gain });
        break;
      case 'orbital':
        for (let i = 0; i < 4; i++) {
          this.tone({ type: 'square', f0: 1000 + i * 150, dur: 0.1, vol: 0.28 * gain, when: i * 0.45 });
          this.tone({ type: 'square', f0: 1000 + i * 150, dur: 0.1, vol: 0.28 * gain, when: i * 0.45 + 0.15 });
        }
        break;
      case 'secondwind':
        this.tone({ type: 'sine', f0: 60, f1: 40, dur: 0.25, vol: 1.4 * gain });
        this.tone({ type: 'sine', f0: 60, f1: 40, dur: 0.25, vol: 1.2 * gain, when: 0.3 });
        [392, 523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.9, vol: 0.4 * gain, when: 0.5 + i * 0.05 }));
        break;
      default: break;
    }
  }

  /** Godzilla sounds. gain is 0..1 (falls off with distance). */
  zilla(kind, gain = 1) {
    if (!this.ready || gain <= 0.01) return;
    switch (kind) {
      case 'roar':
        this.tone({ type: 'sawtooth', f0: 95, f1: 55, dur: 1.5, vol: 0.55 * gain, attack: 0.08 });
        this.tone({ type: 'sawtooth', f0: 142, f1: 70, dur: 1.4, vol: 0.3 * gain, attack: 0.1 });
        this.noise({ dur: 1.5, vol: 0.9 * gain, type: 'lowpass', f0: 900, f1: 200, q: 0.9, attack: 0.1 });
        this.tone({ type: 'sine', f0: 40, f1: 28, dur: 1.2, vol: 0.9 * gain });
        break;
      case 'breath':
        this.noise({ dur: 0.45, vol: 0.9 * gain, type: 'bandpass', f0: 1100, f1: 350, q: 0.7 });
        this.noise({ dur: 0.4, vol: 0.5 * gain, type: 'lowpass', f0: 500, q: 0.8 });
        this.tone({ type: 'sawtooth', f0: 70, f1: 50, dur: 0.4, vol: 0.2 * gain });
        break;
      case 'stomp':
        this.tone({ type: 'sine', f0: 75, f1: 28, dur: 0.6, vol: 1.6 * gain });
        this.noise({ dur: 0.5, vol: 1.3 * gain, type: 'lowpass', f0: 260, f1: 70, q: 0.7 });
        this.noise({ dur: 0.1, vol: 0.9 * gain, type: 'highpass', f0: 2500 });
        break;
      case 'windup':
        this.tone({ type: 'sawtooth', f0: 60, f1: 110, dur: 0.35, vol: 0.35 * gain });
        break;
      case 'grab':
        this.noise({ dur: 0.28, vol: 0.9 * gain, type: 'bandpass', f0: 500, f1: 2000, q: 1 });
        this.tone({ type: 'square', f0: 110, f1: 70, dur: 0.12, vol: 0.4 * gain, when: 0.22 });
        break;
      case 'whiff':
        this.noise({ dur: 0.3, vol: 0.8 * gain, type: 'bandpass', f0: 400, f1: 1800, q: 1 });
        break;
      case 'chomp':
        this.noise({ dur: 0.06, vol: 1.3 * gain, type: 'highpass', f0: 2200 });
        this.tone({ type: 'square', f0: 140, f1: 55, dur: 0.14, vol: 0.7 * gain });
        this.tone({ type: 'sine', f0: 60, f1: 30, dur: 0.3, vol: 1.1 * gain, when: 0.05 });
        this.noise({ dur: 0.35, vol: 0.5 * gain, type: 'bandpass', f0: 300, f1: 120, q: 1, when: 0.08 });
        break;
      case 'step':
        this.tone({ type: 'sine', f0: 62, f1: 34, dur: 0.28, vol: 1.1 * gain });
        this.noise({ dur: 0.14, vol: 0.6 * gain, type: 'lowpass', f0: 180, q: 0.8 });
        break;
      default: break;
    }
  }

  // ------------------------------------------------------------ feedback

  hitTick() {
    this.tone({ type: 'sine', f0: 1900, f1: 1500, dur: 0.07, vol: 0.55 });
  }

  headshot() {
    this.tone({ type: 'sine', f0: 2700, dur: 0.1, vol: 0.6 });
    this.tone({ type: 'sine', f0: 4000, dur: 0.14, vol: 0.4, when: 0.025 });
    this.noise({ dur: 0.05, vol: 0.9, type: 'highpass', f0: 4000 });
  }

  kill() {
    this.tone({ type: 'triangle', f0: 260, f1: 100, dur: 0.3, vol: 1.0 });
    this.tone({ type: 'sine', f0: 2300, dur: 0.1, vol: 0.5, when: 0.02 });
  }

  hurt() {
    this.tone({ type: 'sawtooth', f0: 150, f1: 60, dur: 0.25, vol: 0.5 });
    this.noise({ dur: 0.18, vol: 1.0, type: 'lowpass', f0: 700, f1: 200 });
  }

  dummyRespawn() {
    this.tone({ type: 'sine', f0: 420, f1: 780, dur: 0.15, vol: 0.3 });
  }

  // ------------------------------------------------------------ movement

  step(strength = 1) {
    const v = 0.85 + Math.random() * 0.3;
    this.noise({ dur: 0.08, vol: 0.7 * strength, type: 'lowpass', f0: 520 * v, f1: 200 });
    this.tone({ type: 'sine', f0: 95 * v, f1: 48, dur: 0.1, vol: 0.8 * strength });
  }

  jump() {
    this.noise({ dur: 0.16, vol: 1.2, type: 'lowpass', f0: 800, f1: 300 });
    this.tone({ type: 'sine', f0: 140, f1: 220, dur: 0.1, vol: 0.4 });
  }

  land(speed) {
    const s = Math.min(1, speed / 12);
    this.noise({ dur: 0.2, vol: 0.5 + 0.9 * s, type: 'lowpass', f0: 500, f1: 150 });
    this.tone({ type: 'sine', f0: 80, f1: 38, dur: 0.25, vol: 0.7 + 1.0 * s });
  }

  click() {
    this.tone({ type: 'square', f0: 820, f1: 620, dur: 0.06, vol: 0.4 });
    this.noise({ dur: 0.03, vol: 0.6, type: 'bandpass', f0: 3000, q: 1.2 });
  }
}
