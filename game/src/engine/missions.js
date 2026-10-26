/* Phase 2D-A — the game's missions, client side. The SERVER owns everything that matters: which missions exist, their
 * order, the XP each gives, the level curve and the chapter. This module only (1) tells the server "the player reached
 * this objective" (POST with no body — nothing to spoof), (2) shows the progress the server answered, never a local
 * number. Story flags in the save stay presentation only and never call this module. Guests (no account) have no missions.
 * Calls run one after another (story order), a repeat is skipped locally and answered {already} by the server, and a
 * transient failure (offline, 5xx, 429) is retried in memory only (twice) — nothing is stored on the device. */
import { t, getLang } from "./i18n.js";

const RETRY_MS = [4000, 15000];
const statusOf = (e) => Number(e?.status ?? e?.res?.status ?? e?.response?.status ?? 0);
const transient = (e) => { const s = statusOf(e); return !s || s >= 500 || s === 429; };

export class Missions {
  /** @param {(m:string,p:string,b?:any)=>Promise<any>} api @param {boolean} member @param {any} game */
  constructor(api, member, game) {
    this.api = api; this.member = member; this.game = game;
    this.progress = null; this.list = []; this.chain = Promise.resolve(); this.inflight = new Set(); this.timers = new Set();
  }
  async load() {
    if (!this.member) return null;
    try { this.apply(await this.api("GET", "/api/game/missions")); } catch { /* offline: the HUD keeps the saved level */ }
    return this.progress;
  }
  done(id) { return !!this.list.find((m) => m.id === id && m.done); }
  apply(r) {
    if (!r || !r.progress) return;
    this.progress = r.progress; this.list = Array.isArray(r.missions) ? r.missions : this.list;
    if (this.game?.save?.data) { this.game.save.data.level = r.progress.level; this.game.save.data.xp = r.progress.xp; this.game.save.data.chapter = r.progress.chapter; }
    this.paint();
  }
  /** the HUD plate (room and street): level text and the XP bar, from the server's numbers only */
  paint() {
    const p = this.progress, root = this.game?.root; if (!p || !root) return;
    root.querySelectorAll(".gm-plate span").forEach((s) => { s.textContent = `${t("المستوى", "Level")} ${p.level}`; });
    root.querySelectorAll(".gm-xp").forEach((x) => { x.style.setProperty("--xp", Math.max(4, p.pct) + "%"); x.title = `${p.xp} XP`; });
  }
  /** the player reached a mission's objective: ask the server. Resolves to the server's answer, or null. */
  complete(id, attempt = 0) {
    if (!this.member || this.done(id) || (attempt === 0 && this.inflight.has(id))) return Promise.resolve(null);
    this.inflight.add(id);
    const run = this.chain.then(async () => {
      try {
        const r = await this.api("POST", `/api/game/missions/${encodeURIComponent(id)}/complete`);
        this.inflight.delete(id); this.apply(r);
        if (r?.completed && r.xpGained > 0) this.celebrate(r);
        return r;
      } catch (e) {
        if (transient(e) && attempt < RETRY_MS.length) {
          const tm = setTimeout(() => { this.timers.delete(tm); this.complete(id, attempt + 1); }, RETRY_MS[attempt]); this.timers.add(tm);
        } else this.inflight.delete(id); // locked / invalid: the server said no — nothing to retry
        return null;
      }
    });
    this.chain = run.catch(() => null);
    return run;
  }
  celebrate(r) {
    const m = this.list.find((x) => x.id === r.mission), name = m?.title ? (getLang() === "ar" ? m.title.ar : m.title.en) : "";
    this.game?.ui?.toast?.(`<b><bdi dir="ltr">+${Number(r.xpGained) | 0} XP</bdi></b> ${name ? "· " + name.replace(/[&<>"']/g, "") : ""}`, "xp");
    this.game?.audio?.sfx?.("reveal");
  }
  dispose() { for (const tm of this.timers) clearTimeout(tm); this.timers.clear(); }
}
