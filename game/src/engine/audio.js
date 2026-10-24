/* The game's sound: three buses (music, ambient, sfx) into a master with a shared reverb, all synthesized live with the
 * Web Audio API — no audio files to download, every track and effect is a few lines of data below.
 *   music(name)    crossfades to a track: "title" (synthwave), "creator" (hologram pads), "room" (late-night lo-fi)
 *   ambient(name)  a bed under the music: "city" (distant traffic hum + wind), "room" (rain on the window + AC hum)
 *   sfx(name)      ui hover/click/confirm/back, whoosh, step, coin, locked, open, type, scan, ping
 * The context starts on the first tap (browser rule); volumes come from the player's settings and are kept there. */

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
// note names → midi (C4 = 60)
const N = (s) => { const m = /^([A-G])(#|b)?(-?\d)$/.exec(s); const b = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0); return 12 * (Number(m[3]) + 1) + b; };
const chord = (...ns) => ns.map(N);

/* ---------- the tracks: chords per bar, a bass line, an arpeggio and drums on a 16-step grid ---------- */
const TRACKS = {
  title: {
    bpm: 88, padCut: 1400, padGain: 0.11, arpGain: 0.05, bassGain: 0.16, kick: [0, 8], hat: [4, 12], hatGain: 0.018, kickGain: 0.32,
    bars: [chord("A3", "C4", "E4", "B4"), chord("F3", "A3", "C4", "E4"), chord("C3", "E3", "G3", "D4"), chord("G3", "B3", "D4", "F#4")],
    bass: [N("A1"), N("F1"), N("C2"), N("G1")], bassSteps: [0, 3, 6, 8, 11, 14],
    arp: [0, 1, 2, 3, 2, 1, 2, 3], arpOct: 12, arpEvery: 2
  },
  creator: {
    bpm: 76, padCut: 900, padGain: 0.12, arpGain: 0.045, bassGain: 0.1, kick: [], hat: [], hatGain: 0, kickGain: 0,
    bars: [chord("D3", "F3", "A3", "E4"), chord("Bb2", "D3", "F3", "C4"), chord("F3", "A3", "C4", "G4"), chord("C3", "E3", "G3", "D4")],
    bass: [N("D2"), N("Bb1"), N("F1"), N("C2")], bassSteps: [0, 8],
    arp: [0, 2, 1, 3, 2, 0, 3, 1], arpOct: 24, arpEvery: 2
  },
  room: {
    bpm: 72, padCut: 1100, padGain: 0.075, arpGain: 0.035, bassGain: 0.13, kick: [0, 7, 10], hat: [2, 6, 10, 14], hatGain: 0.012, kickGain: 0.22, snare: [4, 12],
    bars: [chord("D3", "F3", "A3", "C4"), chord("G2", "B2", "D3", "F3"), chord("C3", "E3", "G3", "B3"), chord("A2", "C3", "E3", "G3")],
    bass: [N("D2"), N("G1"), N("C2"), N("A1")], bassSteps: [0, 7, 10],
    arp: [3, 2, 1, 2, 0, 1, 2, 3], arpOct: 12, arpEvery: 4, keys: true
  }
};

export class Audio {
  constructor(settings = {}) {
    this.ctx = null; this.vol = { music: 0.7, ambient: 0.6, sfx: 0.8, ...settings };
    this.want = { music: null, ambient: null }; this.cur = { music: null, ambient: null };
    this.timer = 0; this.step = 0; this.nextAt = 0; this.duck = 1;
  }
  /** Must run inside a user gesture (a tap). Safe to call many times. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = 0.9; this.master.connect(c.destination);
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.connect(this.master);
      this.out = comp;
      this.rev = c.createConvolver(); this.rev.buffer = this.impulse(2.8); this.revGain = c.createGain(); this.revGain.gain.value = 0.32; this.rev.connect(this.revGain).connect(comp);
      this.bus = {};
      for (const k of ["music", "ambient", "sfx"]) { const g = c.createGain(); g.gain.value = this.vol[k]; g.connect(comp); this.bus[k] = g; }
      this.delay = c.createDelay(1); this.delay.delayTime.value = 0.34; const fb = c.createGain(); fb.gain.value = 0.32; const dl = c.createBiquadFilter(); dl.type = "lowpass"; dl.frequency.value = 2400;
      this.delay.connect(dl).connect(fb).connect(this.delay); dl.connect(this.bus.music);
      this.noiseBuf = this.noise(2);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    if (this.want.music && this.cur.music?.name !== this.want.music) this.music(this.want.music);
    if (this.want.ambient && this.cur.ambient?.name !== this.want.ambient) this.ambient(this.want.ambient);
  }
  get ready() { return !!this.ctx && this.ctx.state === "running"; }
  setVolume(k, v) { this.vol[k] = v; if (this.bus) this.bus[k].gain.setTargetAtTime(v * (k === "music" ? this.duck : 1), this.ctx.currentTime, 0.1); }
  /** Lower the music while a terminal page or dialogue has the player's attention. */
  setDuck(on) { this.duck = on ? 0.35 : 1; if (this.bus) this.bus.music.gain.setTargetAtTime(this.vol.music * this.duck, this.ctx.currentTime, 0.3); }
  suspend() { if (this.ctx && this.ctx.state === "running") this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  impulse(sec) { const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); } return b; }
  noise(sec) { const c = this.ctx, len = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; return b; }
  env(g, t, a, peak, d, sustain, r, end) { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.setTargetAtTime(sustain, t + a, d); g.gain.setTargetAtTime(0.0001, end, r); }

  /* ---------- music ---------- */
  music(name) {
    this.want.music = name; if (!this.ctx) return;
    if (this.cur.music?.name === name) return;
    const old = this.cur.music; if (old) { old.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.6); setTimeout(() => old.gain.disconnect(), 3000); }
    if (!name || !TRACKS[name]) { this.cur.music = null; this.stopSeq(); return; }
    const g = this.ctx.createGain(); g.gain.value = 0.0001; g.connect(this.bus.music); g.gain.setTargetAtTime(1, this.ctx.currentTime + 0.2, 0.8);
    const send = this.ctx.createGain(); send.gain.value = 0.55; g.connect(send).connect(this.rev);
    this.cur.music = { name, gain: g, tr: TRACKS[name] };
    this.step = 0; this.nextAt = this.ctx.currentTime + 0.1;
    if (!this.timer) this.timer = setInterval(() => this.sched(), 40);
  }
  stopSeq() { clearInterval(this.timer); this.timer = 0; }
  sched() {
    const m = this.cur.music; if (!m || !this.ctx) return;
    const tr = m.tr, sp = 60 / tr.bpm / 4;
    while (this.nextAt < this.ctx.currentTime + 0.25) { this.play(tr, m.gain, this.step, this.nextAt, sp); this.nextAt += sp; this.step = (this.step + 1) % (16 * tr.bars.length); }
  }
  play(tr, out, step, t, sp) {
    const bar = Math.floor(step / 16), s = step % 16, ch = tr.bars[bar];
    if (s === 0) for (const n of ch) this.pad(out, midi(n), t, sp * 16, tr);
    if (tr.bassSteps.includes(s)) this.bass(out, midi(tr.bass[bar] + (s === 14 || s === 11 ? 12 : 0)), t, sp * 2.5, tr.bassGain);
    if (s % tr.arpEvery === 0) { const i = tr.arp[(s / tr.arpEvery) % tr.arp.length] % ch.length; this.pluck(out, midi(ch[i] + tr.arpOct), t, sp * 1.6, tr.arpGain, tr.keys); }
    if (tr.kick.includes(s)) this.kick(out, t, tr.kickGain);
    if (tr.hat.includes(s)) this.hat(out, t, tr.hatGain);
    if (tr.snare?.includes(s)) this.snare(out, t, 0.05);
  }
  pad(out, f, t, len, tr) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = tr.padCut; lp.Q.value = 0.6;
    lp.frequency.setValueAtTime(tr.padCut * 0.6, t); lp.frequency.linearRampToValueAtTime(tr.padCut, t + len * 0.5); lp.frequency.linearRampToValueAtTime(tr.padCut * 0.7, t + len);
    for (const d of [-7, 6]) { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + len + 1.6); }
    lp.connect(g).connect(out); this.env(g, t, 0.9, tr.padGain / 2, 0.8, tr.padGain / 2.6, 0.5, t + len - 0.1);
  }
  bass(out, f, t, len, gain) {
    const c = this.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = "sine"; o2.type = "sawtooth"; o.frequency.value = f; o2.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = 320;
    const m = c.createGain(); m.gain.value = 0.25; o2.connect(m).connect(lp); o.connect(lp); lp.connect(g).connect(out);
    this.env(g, t, 0.01, gain, 0.15, gain * 0.6, 0.08, t + len); o.start(t); o2.start(t); o.stop(t + len + 0.5); o2.stop(t + len + 0.5);
  }
  pluck(out, f, t, len, gain, keys) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = keys ? "sine" : "triangle"; o.frequency.value = f;
    if (keys) { const mod = c.createOscillator(), mg = c.createGain(); mod.frequency.value = f * 2; mg.gain.value = f * 0.8; mod.connect(mg).connect(o.frequency); mod.start(t); mod.stop(t + len + 0.6); mg.gain.setTargetAtTime(0, t, 0.12); }
    o.connect(g); g.connect(out); g.connect(this.delay);
    this.env(g, t, 0.005, gain, 0.12, gain * 0.25, 0.15, t + len); o.start(t); o.stop(t + len + 0.8);
  }
  kick(out, t, gain) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = "sine";
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32); o.connect(g).connect(out); o.start(t); o.stop(t + 0.35);
  }
  hat(out, t, gain) { this.burst(out, t, 0.04, "highpass", 7000, gain); }
  snare(out, t, gain) { this.burst(out, t, 0.16, "bandpass", 1800, gain); }
  burst(out, t, len, type, freq, gain, q = 0.8) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4; f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    s.connect(f).connect(g).connect(out); s.start(t, Math.random()); s.stop(t + len + 0.05);
  }

  /* ---------- ambient beds ---------- */
  ambient(name) {
    this.want.ambient = name; if (!this.ctx) return;
    if (this.cur.ambient?.name === name) return;
    const old = this.cur.ambient; if (old) { old.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.8); setTimeout(() => { old.stop(); old.gain.disconnect(); }, 4000); }
    if (!name) { this.cur.ambient = null; return; }
    const c = this.ctx, g = c.createGain(); g.gain.value = 0.0001; g.connect(this.bus.ambient); g.gain.setTargetAtTime(1, c.currentTime + 0.3, 1.2);
    const nodes = [];
    const loop = (type, freq, gain, q = 0.7, rate = 1) => { const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.playbackRate.value = rate; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const v = c.createGain(); v.gain.value = gain; s.connect(f).connect(v).connect(g); s.start(); nodes.push(s); return { f, v }; };
    const lfo = (param, rate, depth) => { const o = c.createOscillator(), d = c.createGain(); o.frequency.value = rate; d.gain.value = depth; o.connect(d).connect(param); o.start(); nodes.push(o); };
    if (name === "city") {
      const hum = loop("lowpass", 220, 0.5, 0.5, 0.5); lfo(hum.v.gain, 0.07, 0.18);
      const wind = loop("bandpass", 600, 0.12, 1.2); lfo(wind.f.frequency, 0.05, 260); lfo(wind.v.gain, 0.11, 0.06);
      const drone = c.createOscillator(); drone.type = "sine"; drone.frequency.value = 55; const dg = c.createGain(); dg.gain.value = 0.05; drone.connect(dg).connect(g); drone.start(); nodes.push(drone);
    } else if (name === "room") {
      const rain = loop("highpass", 1400, 0.11, 0.4); lfo(rain.v.gain, 0.3, 0.03);
      const drops = loop("bandpass", 3200, 0.05, 3, 1.3); lfo(drops.v.gain, 1.7, 0.04);
      const ac = loop("lowpass", 160, 0.22, 0.5, 0.4);
      const hum = c.createOscillator(); hum.frequency.value = 60; const hg = c.createGain(); hg.gain.value = 0.012; hum.connect(hg).connect(g); hum.start(); nodes.push(hum);
      void ac;
    }
    this.cur.ambient = { name, gain: g, stop: () => nodes.forEach((n) => { try { n.stop(); } catch { /* stopped */ } }) };
  }

  /* ---------- effects ---------- */
  sfx(name, opt = {}) {
    if (!this.ready) return;
    const c = this.ctx, t = c.currentTime + 0.005, out = this.bus.sfx;
    const tone = (f, at, len, type = "sine", gain = 0.2, to) => { const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t + at); if (to) o.frequency.exponentialRampToValueAtTime(to, t + at + len); g.gain.setValueAtTime(0.0001, t + at); g.gain.linearRampToValueAtTime(gain, t + at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len); o.connect(g).connect(out); const s = c.createGain(); s.gain.value = 0.25; g.connect(s).connect(this.rev); o.start(t + at); o.stop(t + at + len + 0.05); };
    switch (name) {
      case "hover": tone(1500, 0, 0.05, "sine", 0.05); break;
      case "click": tone(700, 0, 0.06, "square", 0.05); tone(1050, 0.04, 0.08, "sine", 0.09); break;
      case "back": tone(900, 0, 0.07, "sine", 0.08, 500); break;
      case "confirm": [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.07, 0.35, "triangle", 0.11)); break;
      case "whoosh": { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noiseBuf; f.type = "bandpass"; f.Q.value = 1.4; f.frequency.setValueAtTime(opt.down ? 3000 : 300, t); f.frequency.exponentialRampToValueAtTime(opt.down ? 300 : 3200, t + 0.6); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75); s.connect(f).connect(g).connect(out); s.start(t); s.stop(t + 0.8); break; }
      case "step": this.burst(out, t, 0.07, "lowpass", 380 + Math.random() * 200, 0.12 * (opt.v ?? 1)); break;
      case "coin": tone(1318, 0, 0.5, "sine", 0.14); tone(1760, 0.08, 0.7, "sine", 0.12); tone(2637, 0.08, 0.4, "triangle", 0.04); break;
      case "locked": tone(140, 0, 0.12, "square", 0.08); tone(110, 0.15, 0.18, "square", 0.08); break;
      case "open": tone(400, 0, 0.4, "triangle", 0.1, 900); tone(1200, 0.2, 0.3, "sine", 0.06); break;
      case "type": tone(1800 + Math.random() * 400, 0, 0.02, "square", 0.015); break;
      case "scan": tone(300, 0, 0.9, "sawtooth", 0.035, 1600); tone(2400, 0.7, 0.2, "sine", 0.05); break;
      case "ping": tone(1975, 0, 0.6, "sine", 0.08); tone(2960, 0.03, 0.5, "sine", 0.03); break;
      case "reveal": [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.09, 0.9, "triangle", 0.07)); tone(65, 0, 1.6, "sine", 0.25, 40); break;
    }
  }
  dispose() { this.stopSeq(); try { this.cur.ambient?.stop(); } catch { /* */ } try { this.ctx?.close(); } catch { /* */ } this.ctx = null; }
}
