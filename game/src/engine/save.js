/* The player's save. Members: kept on the server (/api/game/profile) so the story follows them to any device, with a
 * local copy for an instant start. Guests: local only. Writes are merged and debounced (one request per 1.5 s at most). */
const LS = "mp.game.save";

export class Save {
  /** @param {(m:string,p:string,b?:any)=>Promise<any>} api @param {boolean} member */
  constructor(api, member) { this.api = api; this.member = member; this.data = null; this.queue = null; this.timer = 0; }
  local() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; } }
  keepLocal() { try { localStorage.setItem(LS, JSON.stringify(this.data)); } catch { /* private mode */ } }
  async load() {
    const loc = this.local();
    if (this.member) {
      try { const r = await this.api("GET", "/api/game/profile"); this.data = r.player || null; this.keepLocal(); return this.data; } catch { /* offline: use the local copy */ }
    }
    this.data = loc; return this.data;
  }
  get exists() { return !!(this.data && this.data.char && this.data.name); }
  /** Merge a change into the save (flags and settings merge key by key) and write it soon. */
  set(patch) {
    const d = this.data || {};
    this.data = { ...d, ...patch, flags: { ...(d.flags || {}), ...(patch.flags || {}) }, settings: { ...(d.settings || {}), ...(patch.settings || {}) } };
    this.keepLocal();
    const q = this.queue || {};
    this.queue = { ...q, ...patch, flags: patch.flags ? { ...(q.flags || {}), ...patch.flags } : q.flags, settings: patch.settings ? { ...(q.settings || {}), ...patch.settings } : q.settings };
    if (!this.queue.flags) delete this.queue.flags; if (!this.queue.settings) delete this.queue.settings;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 1500);
  }
  async flush() {
    clearTimeout(this.timer); const q = this.queue; this.queue = null;
    if (!q || !this.member) return;
    try {
      const r = await this.api("PUT", "/api/game/profile", { char: this.data.char, name: this.data.name, ...q });
      this.fails = 0;
      if (r?.player) { this.data = { ...this.data, ...r.player }; this.keepLocal(); } // the server's copy (incl. xp/level) wins
    } catch (e) {
      console.warn("[game] save failed", e?.message);
      // Phase 2D-A: a TRANSIENT failure (offline, 5xx, 429) puts the change back UNDER anything newer and retries twice;
      // a refusal (4xx: invalid value) is dropped as before, so a bad patch can never loop or block later saves.
      const s = Number(e?.status ?? e?.res?.status ?? 0);
      if ((!s || s >= 500 || s === 429) && (this.fails = (this.fails || 0) + 1) <= 2) {
        const n = this.queue || {};
        this.queue = { ...q, ...n, flags: q.flags || n.flags ? { ...(q.flags || {}), ...(n.flags || {}) } : undefined, settings: q.settings || n.settings ? { ...(q.settings || {}), ...(n.settings || {}) } : undefined };
        if (!this.queue.flags) delete this.queue.flags; if (!this.queue.settings) delete this.queue.settings;
        clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.fails * 5000);
      } else this.fails = 0;
    }
  }
  flag(k) { return this.data?.flags?.[k]; }
}
