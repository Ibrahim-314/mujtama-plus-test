/* One requestAnimationFrame loop for the whole game. It stops when the tab is hidden or the game is paused (a terminal
 * page is open), clamps long frames, and keeps a rolling frame-rate so "auto" quality can step down on weak phones. */
export class Loop {
  constructor() {
    this.fns = new Set(); this.raf = 0; this.last = 0; this.running = false; this.paused = false; this.t = 0;
    this.fps = 60; this._acc = 0; this._n = 0;
    this._tick = (now) => this.tick(now);
    this._vis = () => (document.hidden ? this.halt() : this.resume());
    document.addEventListener("visibilitychange", this._vis);
  }
  add(fn) { this.fns.add(fn); return () => this.fns.delete(fn); }
  start() { this.running = true; this.resume(); }
  halt() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  resume() { if (!this.running || this.paused || document.hidden || this.raf) return; this.last = performance.now(); this.raf = requestAnimationFrame(this._tick); }
  pause(on) { this.paused = !!on; if (on) this.halt(); else this.resume(); }
  tick(now) {
    this.raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000)); this.last = now; this.t += dt;
    this._acc += dt; this._n++;
    if (this._acc >= 1) { this.fps = this._n / this._acc; this._acc = 0; this._n = 0; }
    for (const fn of this.fns) fn(dt, this.t);
    if (this.running && !this.paused && !document.hidden) this.raf = requestAnimationFrame(this._tick);
  }
  stop() { this.running = false; this.halt(); this.fns.clear(); document.removeEventListener("visibilitychange", this._vis); }
}
