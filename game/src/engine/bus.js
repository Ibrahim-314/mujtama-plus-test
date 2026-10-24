/* A tiny event bus: systems talk through events, never through each other's internals. */
export class Bus {
  constructor() { this.m = new Map(); }
  on(ev, fn) { if (!this.m.has(ev)) this.m.set(ev, new Set()); this.m.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this.m.get(ev)?.delete(fn); }
  once(ev, fn) { const off = this.on(ev, (...a) => { off(); fn(...a); }); return off; }
  emit(ev, ...a) { for (const fn of [...(this.m.get(ev) || [])]) { try { fn(...a); } catch (e) { console.error("[game]", ev, e); } } }
  clear() { this.m.clear(); }
}
