// All sounds are synthesized with WebAudio so the game ships no audio files.
// Positional sounds use distance attenuation and stereo panning relative to the listener.

const SHOTS = {
  pistol: { freq: 2400, q: 0.8, decay: 0.12, thump: 140, gain: 0.55 },
  heavy: { freq: 1500, q: 0.7, decay: 0.22, thump: 90, gain: 0.8 },
  smg: { freq: 2800, q: 0.9, decay: 0.08, thump: 150, gain: 0.45 },
  rifle: { freq: 1900, q: 0.7, decay: 0.16, thump: 110, gain: 0.65 },
  sniper: { freq: 1100, q: 0.6, decay: 0.45, thump: 70, gain: 1.0 },
  shotgun: { freq: 1250, q: 0.5, decay: 0.32, thump: 75, gain: 1.0 },
  lmg: { freq: 1700, q: 0.7, decay: 0.15, thump: 95, gain: 0.72 },
  dmr: { freq: 1450, q: 0.6, decay: 0.3, thump: 85, gain: 0.85 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.lx = 0; this.lz = 0; this.lyaw = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(x, z, yaw) { this.lx = x; this.lz = z; this.lyaw = yaw; }

  // Returns {gain, pan, muffle} for a world position or null if inaudible.
  spatial(pos, maxDist) {
    if (!pos) return { gain: 1, pan: 0, muffle: 1 };
    const dx = pos.x - this.lx, dz = pos.z - this.lz;
    const d = Math.hypot(dx, dz);
    if (d > maxDist) return null;
    const f = 1 - d / maxDist;
    // listener right vector for yaw: (cos yaw, 0, -sin yaw)
    const rx = Math.cos(this.lyaw), rz = -Math.sin(this.lyaw);
    const pan = d > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.85 : 0;
    return { gain: f * f, pan, muffle: 0.25 + 0.75 * f };
  }

  out(sp) {
    const g = this.ctx.createGain();
    g.gain.value = sp.gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = sp.pan;
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noise(dest, t, dur, type, freq, q, peak, decay) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5, dur);
  }

  tone(dest, t, type, f0, f1, peak, decay) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + decay);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + decay + 0.05);
  }

  shot(kind, pos = null) {
    if (!this.ctx) return;
    const s = SHOTS[kind] || SHOTS.rifle;
    const sp = this.spatial(pos, 90);
    if (!sp) return;
    const t = this.ctx.currentTime, o = this.out(sp);
    this.noise(o, t, s.decay + 0.05, 'lowpass', s.freq * sp.muffle, s.q, s.gain, s.decay);
    this.noise(o, t, 0.04, 'highpass', 3000, 0.5, s.gain * 0.35 * sp.muffle, 0.04);
    this.tone(o, t, 'sine', s.thump * 1.6, s.thump * 0.5, s.gain * 0.9, s.decay * 0.8);
  }

  knife(pos = null) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 15); if (!sp) return;
    this.noise(this.out(sp), this.ctx.currentTime, 0.15, 'bandpass', 4500, 2, 0.25, 0.12);
  }

  footstep(pos = null, quiet = false) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 28); if (!sp) return;
    const t = this.ctx.currentTime, o = this.out(sp);
    const v = quiet ? 0.08 : 0.32;
    this.noise(o, t, 0.08, 'bandpass', 900 + Math.random() * 400, 1.5, v, 0.07);
    this.tone(o, t, 'sine', 90, 50, v * 0.6, 0.06);
  }

  land() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.noise(o, t, 0.12, 'lowpass', 700, 1, 0.3, 0.1);
  }

  hit(head) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    if (head) {
      this.tone(o, t, 'triangle', 1900, 1700, 0.35, 0.18);
      this.tone(o, t, 'sine', 2850, 2600, 0.2, 0.2);
    } else {
      this.noise(o, t, 0.06, 'bandpass', 1400, 1.2, 0.35, 0.05);
    }
  }

  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.noise(o, t, 0.15, 'lowpass', 500, 1, 0.5, 0.14);
  }

  kill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.tone(o, t, 'square', 660, 660, 0.12, 0.08);
    this.tone(o, t + 0.07, 'square', 990, 990, 0.12, 0.12);
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.tone(o, t, 'square', 1800, 1200, 0.1, 0.03);
  }

  reload() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.noise(o, t, 0.06, 'bandpass', 2500, 3, 0.25, 0.05);
    this.noise(o, t + 0.35, 0.06, 'bandpass', 1800, 3, 0.3, 0.06);
  }

  equip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.noise(o, t, 0.08, 'bandpass', 3200, 4, 0.18, 0.07);
  }

  buy() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.tone(o, t, 'sine', 880, 1320, 0.15, 0.12);
  }

  deny() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.tone(o, t, 'square', 200, 160, 0.1, 0.15);
  }

  beep(pos, urgent) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 60) || { gain: 0.05, pan: 0 };
    sp.gain = Math.max(sp.gain, 0.12);
    const t = this.ctx.currentTime;
    this.tone(this.out(sp), t, 'square', urgent ? 1650 : 1250, urgent ? 1650 : 1250, 0.18, 0.09);
  }

  action() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.tone(o, t, 'sawtooth', 300, 600, 0.06, 0.25);
  }

  announce(good) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    const notes = good ? [523, 659, 784] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(o, t + i * 0.12, 'triangle', f, f, 0.2, 0.25));
  }

  heartbeat() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.tone(o, t, 'sine', 70, 45, 0.5, 0.12);
    this.tone(o, t + 0.16, 'sine', 60, 40, 0.35, 0.12);
  }

  streak(n) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    const base = [660, 784, 880, 1047, 1175][Math.min(n - 1, 4)];
    for (let i = 0; i < Math.min(n, 4); i++) this.tone(o, t + i * 0.07, 'triangle', base * (1 + i * 0.25), base * (1 + i * 0.25), 0.18, 0.14);
  }

  casing() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.25 + Math.random() * 0.1, o = this.out({ gain: 0.25, pan: 0.3 });
    this.tone(o, t, 'triangle', 3400 + Math.random() * 600, 2800, 0.12, 0.05);
  }

  // ---- abilities ----

  throw(pos = null) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 30); if (!sp) return;
    this.noise(this.out(sp), this.ctx.currentTime, 0.25, 'bandpass', 1200, 1.5, 0.2, 0.22);
  }

  bounce(pos) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 25); if (!sp) return;
    this.tone(this.out(sp), this.ctx.currentTime, 'triangle', 900, 600, 0.12, 0.05);
  }

  smoke(pos) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 60) || { gain: 0.05, pan: 0, muffle: 0.3 };
    this.noise(this.out(sp), this.ctx.currentTime, 1.2, 'lowpass', 1800 * sp.muffle, 0.5, 0.5, 1.1);
  }

  flash(pos) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 70) || { gain: 0.05, pan: 0, muffle: 0.3 };
    const t = this.ctx.currentTime, o = this.out(sp);
    this.noise(o, t, 0.3, 'highpass', 2500, 0.7, 0.7, 0.25);
    this.tone(o, t, 'sine', 3200, 2800, 0.25, 0.6);
  }

  fire(pos) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 50) || { gain: 0.05, pan: 0, muffle: 0.3 };
    const t = this.ctx.currentTime, o = this.out(sp);
    this.noise(o, t, 0.8, 'lowpass', 900, 0.7, 0.6, 0.7);
    for (let i = 0; i < 6; i++) this.noise(o, t + 0.1 + i * 0.12, 0.05, 'bandpass', 2500 + Math.random() * 2000, 3, 0.2, 0.04);
  }

  recon(pos) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 60) || { gain: 0.15, pan: 0 };
    sp.gain = Math.max(sp.gain, 0.15);
    const t = this.ctx.currentTime, o = this.out(sp);
    this.tone(o, t, 'sine', 1400, 1400, 0.2, 0.12);
    this.tone(o, t + 0.14, 'sine', 2100, 2100, 0.15, 0.2);
  }

  dash(pos = null) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 30); if (!sp) return;
    this.noise(this.out(sp), this.ctx.currentTime, 0.3, 'bandpass', 700, 0.8, 0.5, 0.28);
  }

  heal(pos = null) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 30); if (!sp) return;
    const t = this.ctx.currentTime, o = this.out(sp);
    [660, 880, 1100].forEach((f, i) => this.tone(o, t + i * 0.08, 'sine', f, f, 0.15, 0.3));
  }

  wall(pos = null) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 50); if (!sp) return;
    const t = this.ctx.currentTime, o = this.out(sp);
    this.tone(o, t, 'sawtooth', 80, 160, 0.3, 0.4);
    this.noise(o, t, 0.3, 'lowpass', 600, 0.7, 0.4, 0.3);
  }

  ult(pos = null) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 90) || { gain: 0.15, pan: 0 };
    const t = this.ctx.currentTime, o = this.out(sp);
    this.tone(o, t, 'sawtooth', 110, 220, 0.35, 0.8);
    this.tone(o, t + 0.05, 'square', 220, 440, 0.12, 0.7);
  }

  burn() {
    if (!this.ctx) return;
    this.noise(this.out({ gain: 1, pan: 0 }), this.ctx.currentTime, 0.15, 'bandpass', 3000, 2, 0.15, 0.12);
  }

  explosion(pos) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 200) || { gain: 0.1, pan: 0 };
    sp.gain = Math.max(0.35, sp.gain);
    const t = this.ctx.currentTime, o = this.out(sp);
    this.noise(o, t, 1.6, 'lowpass', 900, 0.7, 1.0, 1.5);
    this.tone(o, t, 'sine', 120, 25, 1.0, 1.2);
  }
}
