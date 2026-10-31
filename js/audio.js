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

  // knife whoosh: a noise sweep (heavier and lower for stabs)
  knife(pos = null, heavy = false) {
    if (!this.ctx) return;
    const sp = this.spatial(pos, 18); if (!sp) return;
    const t = this.ctx.currentTime, o = this.out(sp);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.6;
    f.frequency.setValueAtTime(heavy ? 500 : 900, t);
    f.frequency.exponentialRampToValueAtTime(heavy ? 1800 : 4200, t + (heavy ? 0.25 : 0.14));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.5 : 0.4, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (heavy ? 0.32 : 0.2));
    src.connect(f); f.connect(g); g.connect(o);
    src.start(t, Math.random() * 0.5, 0.4);
    if (heavy) this.tone(o, t + 0.12, 'sine', 160, 70, 0.25, 0.12);
  }

  footstep(pos = null, mode = 'run', surface = 'stone', self = false) {
    if (!this.ctx) return;
    const range = mode === 'run' ? 28 : mode === 'walk' ? 7 : 4;
    const sp = this.spatial(pos, range); if (!sp) return;
    const t = this.ctx.currentTime, o = this.out(sp);
    const loud = { run: 0.34, walk: 0.11, crouch: 0.06 }[mode] * (self ? 0.45 : 1);
    const soft = mode === 'run' ? 1 : mode === 'walk' ? 0.7 : 0.45;   // quieter steps are also duller
    const r = Math.random();
    switch (surface) {
      case 'snow':     // crunch: a short burst of tiny clicks
        this.noise(o, t, 0.12, 'bandpass', 2600 * soft, 0.8, loud * 0.8, 0.1);
        for (let i = 0; i < 3; i++) this.noise(o, t + i * 0.018, 0.02, 'highpass', 4000, 1, loud * 0.35, 0.015);
        break;
      case 'sand':
        this.noise(o, t, 0.14, 'lowpass', 1800 * soft, 0.7, loud * 0.7, 0.12);
        break;
      case 'wood':
        this.tone(o, t, 'triangle', 180 + r * 30, 110, loud * 0.9, 0.08);
        this.noise(o, t, 0.05, 'bandpass', 1200 * soft, 2, loud * 0.5, 0.04);
        break;
      case 'metal':
        this.tone(o, t, 'square', 340 + r * 60, 300, loud * 0.25, 0.09);
        this.noise(o, t, 0.06, 'bandpass', 3000 * soft, 3, loud * 0.5, 0.05);
        break;
      case 'wet':      // splashy asphalt
        this.noise(o, t, 0.1, 'bandpass', 2200 * soft, 1.2, loud * 0.7, 0.09);
        this.tone(o, t, 'sine', 95, 50, loud * 0.5, 0.06);
        break;
      case 'grass':
        this.noise(o, t, 0.12, 'bandpass', 2400 * soft, 0.6, loud * 0.5, 0.1);
        this.tone(o, t, 'sine', 80, 45, loud * 0.4, 0.06);
        break;
      default:         // stone / concrete
        this.noise(o, t, 0.08, 'bandpass', (900 + r * 400) * soft, 1.5, loud, 0.07);
        this.tone(o, t, 'sine', 90, 50, loud * 0.6, 0.06);
    }
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

  // Kill confirm: a bright two-layer bell chime that climbs higher with each kill in the round.
  kill(n = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    const steps = [0, 2, 4, 7, 9, 12];
    const f = 880 * Math.pow(2, steps[Math.min(n - 1, steps.length - 1)] / 12);
    this.tone(o, t, 'sine', f, f, 0.32, 0.45);              // body
    this.tone(o, t, 'sine', f * 2.01, f * 2.01, 0.12, 0.3); // shimmer
    this.tone(o, t, 'triangle', f * 3, f * 2.9, 0.06, 0.12); // click on top
    this.noise(o, t, 0.03, 'highpass', 6000, 1, 0.08, 0.025);
    if (n >= 2) this.tone(o, t + 0.09, 'sine', f * 1.5, f * 1.5, 0.15, 0.35);
  }

  // softer, lower chime for assists
  assist() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    this.tone(o, t, 'sine', 660, 660, 0.16, 0.3);
    this.tone(o, t + 0.07, 'sine', 990, 990, 0.1, 0.3);
  }

  // ACE fanfare
  ace() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.out({ gain: 1, pan: 0 });
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      this.tone(o, t + i * 0.08, 'triangle', f, f, 0.22, 0.6);
      this.tone(o, t + i * 0.08, 'sine', f * 2, f * 2, 0.06, 0.4);
    });
    this.tone(o, t + 0.45, 'sawtooth', 130, 260, 0.2, 1.2);
    this.noise(o, t + 0.45, 1.2, 'highpass', 5000, 0.7, 0.12, 1.1);
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

  // ---- ambience & music ----

  // Looping background sound for a map theme.
  ambient(kind) {
    if (!this.ctx) return;
    this.stopAmbient();
    const ctx = this.ctx, t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(1, t + 2);
    bus.connect(this.master);
    const nodes = [bus];
    const loopNoise = (type, freq, q, gain) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(bus);
      src.start();
      nodes.push(src);
      return { f, g };
    };
    const lfo = (param, rate, depth) => {
      const o = ctx.createOscillator(); o.frequency.value = rate;
      const d = ctx.createGain(); d.gain.value = depth;
      o.connect(d); d.connect(param); o.start();
      nodes.push(o);
    };
    const spec = {
      neon: () => { loopNoise('bandpass', 3200, 0.6, 0.05); loopNoise('lowpass', 200, 0.7, 0.05); },             // rain + city hum
      desert: () => { const w = loopNoise('bandpass', 500, 0.8, 0.035); lfo(w.f.frequency, 0.08, 250); lfo(w.g.gain, 0.13, 0.02); },
      snow: () => { const w = loopNoise('bandpass', 700, 1.2, 0.045); lfo(w.f.frequency, 0.1, 400); lfo(w.g.gain, 0.07, 0.03); },
      jungle: () => { loopNoise('lowpass', 900, 0.5, 0.025); this.chirps = setInterval(() => this.chirp(bus), 900); },
      canals: () => { const w = loopNoise('lowpass', 420, 1.5, 0.05); lfo(w.g.gain, 0.3, 0.025); this.chirps = setInterval(() => { if (Math.random() < 0.3) this.chirp(bus, 2200); }, 1500); },
    }[kind];
    spec?.();
    this.amb = nodes;
  }

  chirp(dest, base = 2800) {
    if (!this.ctx || Math.random() < 0.4) return;
    const t = this.ctx.currentTime, f = base + Math.random() * 1500;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    const g = this.ctx.createGain(); g.gain.value = 0.5;
    if (pan) { pan.pan.value = Math.random() * 2 - 1; g.connect(pan); pan.connect(dest); } else g.connect(dest);
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(g, t + i * 0.09, 'sine', f, f * 1.25, 0.04, 0.07);
  }

  stopAmbient() {
    clearInterval(this.chirps);
    if (!this.amb) return;
    const [bus, ...rest] = this.amb;
    const t = this.ctx.currentTime;
    bus.gain.cancelScheduledValues(t);
    bus.gain.setValueAtTime(bus.gain.value, t);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    setTimeout(() => { for (const n of rest) { try { n.stop(); } catch { /* ignore */ } } bus.disconnect(); }, 700);
    this.amb = null;
  }

  // Soft synth pad + arpeggio for the lobby.
  lobbyMusic(on) {
    if (!this.ctx) return;
    if (!on) { clearInterval(this.musicTimer); this.musicTimer = null; return; }
    if (this.musicTimer || this.musicOff) return;
    const chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 294]];
    let step = 0;
    const play = () => {
      const t = this.ctx.currentTime, ch = chords[Math.floor(step / 8) % chords.length];
      const o = this.out({ gain: 0.18, pan: 0 });
      if (step % 8 === 0) for (const f of ch) this.tone(o, t, 'triangle', f, f, 0.06, 3.2);
      const n = ch[[0, 1, 2, 1][step % 4]] * 2;
      this.tone(o, t, 'sine', n, n, 0.05, 0.35);
      step++;
    };
    play();
    this.musicTimer = setInterval(play, 400);
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
