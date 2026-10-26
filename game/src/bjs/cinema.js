/* The cinematic sequencer (Phase 2A): an ordered list of timed camera shots and subtitles, played on a camera the caller
 * hands in. It owns no engine, canvas, render loop or DOM: the scene that uses it calls seq.update(dt) from its own
 * update(dt, t) (the game's single Loop, engine/loop.js — dt in seconds, already clamped), and the scene's own
 * scene.render() draws the frame. Time-based, so it plays at the same speed at 30 or 120 fps.
 *
 * Works with a Babylon FreeCamera/TargetCamera (position is a Vector3, setTarget(v)) and nothing from three.js. It only
 * writes x/y/z on camera.position and calls camera.setTarget({x,y,z}-like) — and only when a camera is given.
 *
 *   const seq = new Sequence({
 *     camera,                                     // optional; without it shots only drive onFrame
 *     makeVec: (x, y, z) => new Vector3(x, y, z), // optional; what setTarget receives (default: a plain {x,y,z})
 *     shots: [
 *       { dur: 4, from: { pos: [0, 2, 8], look: [0, 1, 0] }, to: { pos: [2, 2, 5], look: [0, 1.4, 0] }, ease: "inOutCubic" },
 *       { dur: 1.5, hold: true },                // a pause: the camera stays where the last shot left it
 *       { dur: 3, to: { pos: [0, 6, 2], look: [0, 0, -30] } }   // no `from`: starts from where the camera is
 *     ],
 *     subtitles: [{ at: 0.5, dur: 3, text: { ar: "…", en: "…" }, who: { ar: "الراوي", en: "Narrator" } }],
 *     lang: () => "ar",                           // picks the line; a plain string text is used as is
 *     onSubtitle: (line) => {},                   // line = { text, who, dir } when one starts, null when it ends
 *     onShot: (i, shot) => {},                    // a shot begins
 *     onFrame: (pos, look, time) => {},           // every update, after the camera moved
 *     onComplete: ({ skipped }) => {}             // exactly once: at the end, on skip(), or never after cancel()
 *   });
 *   seq.start(); … seq.update(dt) every frame … seq.skip(); seq.dispose();
 */

/** Easing curves, t in 0..1 → 0..1. */
export const EASE = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => t * (2 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2
};
const clamp01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);
const easeOf = (e) => (typeof e === "function" ? e : EASE[e] || EASE.inOutCubic);
const v3 = (v) => (v == null ? null : Array.isArray(v) ? { x: +v[0] || 0, y: +v[1] || 0, z: +v[2] || 0 } : { x: +v.x || 0, y: +v.y || 0, z: +v.z || 0 });
const lerp3 = (a, b, k, out) => { out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.z = a.z + (b.z - a.z) * k; return out; };
const RTL = /^(ar|fa|ur|he)/i;

export class Sequence {
  constructor(opts = {}) {
    this.camera = opts.camera || null;
    this.makeVec = opts.makeVec || ((x, y, z) => ({ x, y, z }));
    this.lang = typeof opts.lang === "function" ? opts.lang : () => opts.lang || "ar";
    this.on = { subtitle: opts.onSubtitle, shot: opts.onShot, frame: opts.onFrame, complete: opts.onComplete };
    this.shots = (opts.shots || []).map((s) => ({
      dur: Math.max(0, Number(s.dur) || 0), hold: !!s.hold, ease: easeOf(s.ease),
      from: s.from ? { pos: v3(s.from.pos), look: v3(s.from.look) } : null,
      to: s.to ? { pos: v3(s.to.pos), look: v3(s.to.look) } : null, data: s.data
    }));
    this.subs = (opts.subtitles || []).map((l) => ({ at: Math.max(0, Number(l.at) || 0), dur: Math.max(0, Number(l.dur) || 0), text: l.text, who: l.who }))
      .sort((a, b) => a.at - b.at);
    this.duration = this.shots.reduce((s, x) => s + x.dur, 0);
    for (const l of this.subs) this.duration = Math.max(this.duration, l.at + l.dur);
    this.state = "idle"; // idle → playing → done | cancelled
    this.time = 0; this.shot = -1; this.sub = null;
    this.pos = { x: 0, y: 0, z: 0 }; this.look = { x: 0, y: 0, z: 0 };
    this._seg = null; // the running shot's resolved start/end
    this._completed = false;
    this._readCamera();
  }
  get playing() { return this.state === "playing"; }
  get finished() { return this.state === "done" || this.state === "cancelled"; }
  /** 0..1 through the whole sequence. */
  get progress() { return this.duration ? clamp01(this.time / this.duration) : this.finished ? 1 : 0; }

  /** Begin playing from 0. Calling start() again while playing, or after the end, does nothing. */
  start() {
    if (this.state !== "idle") return this;
    this.state = "playing"; this.time = 0;
    this._advance(0);
    if (this.duration === 0) this._finish(false);
    return this;
  }
  /** Move time forward by dt seconds (the Loop's clamped dt). Safe to call in any state. */
  update(dt) {
    if (this.state !== "playing") return;
    const d = Number(dt);
    if (!Number.isFinite(d) || d <= 0) return;
    this.time = Math.min(this.duration, this.time + d);
    this._advance(this.time);
    if (this.time >= this.duration) this._finish(false);
  }
  /** Jump to the end: the camera lands on the last shot's final framing, subtitles clear, onComplete({skipped:true}).
   *  Repeated skips, or a skip after the end or after cancel(), do nothing. A skip before start() finishes it too. */
  skip() {
    if (this.finished) return;
    this.state = "playing"; this.time = this.duration;
    this._advance(this.duration, true);
    this._finish(true);
  }
  /** Stop without completing: no onComplete, subtitles cleared, the camera left where it is. */
  cancel() {
    if (this.finished) return;
    this.state = "cancelled"; this._setSub(null); this._completed = true;
  }
  /** cancel() and drop every reference (camera, callbacks), e.g. from the scene's dispose(). */
  dispose() { this.cancel(); this.camera = null; this.on = {}; this.shots = []; this.subs = []; this._seg = null; }

  // ---- internals ----
  _readCamera() {
    const p = this.camera?.position; if (p) { this.pos.x = p.x; this.pos.y = p.y; this.pos.z = p.z; }
    const tg = this.camera?.getTarget?.(); if (tg) { this.look.x = tg.x; this.look.y = tg.y; this.look.z = tg.z; }
  }
  _advance(time, jump = false) {
    // which shot holds this time (the last one at or past the end)
    let i = -1, t0 = 0;
    for (let k = 0; k < this.shots.length; k++) { const end = t0 + this.shots[k].dur; if (time < end || k === this.shots.length - 1) { i = k; break; } t0 = end; }
    // enter every shot between the current one and i in order, so a long frame or a skip never misses a shot's start
    while (this.shot < i) {
      // the shot being left lands on its end framing first, so the next one starts exactly where it finished
      if (this._seg) { lerp3(this._seg.p0, this._seg.p1, 1, this.pos); lerp3(this._seg.l0, this._seg.l1, 1, this.look); }
      this.shot++;
      const s = this.shots[this.shot];
      this._begin(s);
      if (!jump) this.on.shot?.(this.shot, s);
    }
    if (i >= 0) {
      const s = this.shots[i], k = s.dur ? clamp01((time - t0) / s.dur) : 1, e = s.ease(k);
      lerp3(this._seg.p0, this._seg.p1, e, this.pos); lerp3(this._seg.l0, this._seg.l1, e, this.look);
      this._apply();
    }
    // subtitles: the line whose window holds this time
    let cur = null; if (!jump) for (const l of this.subs) { if (l.at > time) break; if (time < l.at + l.dur) cur = l; }
    if (cur !== this.sub) this._setSub(cur);
    this.on.frame?.(this.pos, this.look, time);
  }
  _begin(s) {
    const p0 = { ...(s.from?.pos || this.pos) }, l0 = { ...(s.from?.look || this.look) };
    const p1 = s.hold ? { ...p0 } : { ...(s.to?.pos || p0) }, l1 = s.hold ? { ...l0 } : { ...(s.to?.look || l0) };
    this._seg = { p0, p1, l0, l1 };
  }
  _apply() {
    const c = this.camera; if (!c) return;
    if (c.position) { c.position.x = this.pos.x; c.position.y = this.pos.y; c.position.z = this.pos.z; }
    c.setTarget?.(this.makeVec(this.look.x, this.look.y, this.look.z));
  }
  _pick(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    const l = String(this.lang() || "ar").slice(0, 2);
    return v[l] ?? v.en ?? v.ar ?? "";
  }
  _setSub(l) {
    this.sub = l;
    if (!this.on.subtitle) return;
    if (!l) return this.on.subtitle(null);
    const lang = String(this.lang() || "ar");
    this.on.subtitle({ text: this._pick(l.text), who: this._pick(l.who), dir: RTL.test(lang) ? "rtl" : "ltr" });
  }
  _finish(skipped) {
    if (this._completed) return;
    this._completed = true; this.state = "done";
    this._setSub(null);
    const fn = this.on.complete;
    try { fn?.({ skipped }); } catch (e) { console.error("[cinema] onComplete", e); }
  }
}
