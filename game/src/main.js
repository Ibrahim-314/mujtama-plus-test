/* «المدينة الرقمية» — the game's entry point. The app loads this module only when the player opens #/city
 * (game/bridge.js), and gives it a small host interface; the game never reaches into the app's code otherwise.
 *
 *   mount(root, host) → game      host = { api(method, path, body), me(), lang(), member, openStation(id), exit() }
 *   game.showStation(id) / game.stationClosed()   the app tells the game when a terminal page opens / closes
 *   game.unmount()
 *
 * Systems: Renderer (three.js + bloom), Loop, Scenes, Input, Audio, Save, UI — each in engine/ or ui/. */
import { Renderer } from "./engine/renderer.js";
import { Loop } from "./engine/loop.js";
import { Scenes } from "./engine/scenes.js";
import { Input } from "./engine/input.js";
import { Audio } from "./engine/audio.js";
import { Save } from "./engine/save.js";
import { Missions } from "./engine/missions.js";
import { Bus } from "./engine/bus.js";
import { setLang, t } from "./engine/i18n.js";
import { UI } from "./ui/ui.js";
import { SCENES } from "./scenes/index.js";
import { onProgress } from "./engine/assets.js";
import { VERSION } from "./config.js";

class Game {
  constructor(root, host) {
    this.root = root; this.host = host; this.version = VERSION; this.member = !!host.member; this.bus = new Bus();
    setLang(host.lang?.() || "ar");
    root.classList.add("gm"); root.innerHTML = '<div class="gm-stage" id="gm-stage"><canvas class="gm-canvas" aria-label="" role="img"></canvas></div>';
    this.surface = root.querySelector("#gm-stage"); this.canvas = root.querySelector("canvas");
    this.canvas.setAttribute("aria-label", t("المدينة الرقمية — مشهد اللعبة", "The Digital City — game view"));
    this.audio = new Audio();
    this.ui = new UI(root, this);
    this.input = new Input(this.surface, root.querySelector("#gm-ui"));
    this.save = new Save(host.api, this.member);
    this.missions = new Missions(host.api, this.member, this); // Phase 2D-A: server-authoritative missions + XP
    this.loop = new Loop();
    this.scenes = new Scenes(this, SCENES);
    this.pendingStation = null;
    this.offProg = onProgress((p) => { if (this._loading) this.ui.loading(true, p); });
  }
  async start(station) {
    this._loading = true; this.ui.loading(true, 0.05);
    try {
      await this.save.load();
      this.missions.load(); // not awaited: the HUD shows the saved level until the server answers
      this.onHide = () => { if (document.visibilityState === "hidden") this.save.flush(); };
      document.addEventListener("visibilitychange", this.onHide);
      const s = this.save.data?.settings || {};
      for (const k of ["music", "ambient", "sfx"]) if (typeof s[k] === "number") this.audio.vol[k] = s[k];
      this.renderer = new Renderer(this.canvas, s.quality || "auto");
      this.loop.add((dt, time) => { this.scenes.update(dt, time); this.renderer.render(this.loop.fps); });
      this.loop.start();
      // opened straight on a terminal page (#/city/mjt/…): the game starts behind it, paused, in the player's room
      await this.scenes.go(station && this.save.exists ? "room" : "title", { fadeIn: station ? 300 : 650 });
      if (station) this.showStation(station);
    } catch (e) {
      console.error("[game]", e);
      this.ui.layer(`<div class="gm-err"><b>${t("تعذّر تشغيل اللعبة على هذا الجهاز", "The game could not start on this device")}</b><p>${t("قد لا يدعم المتصفح رسومات WebGL.", "The browser may not support WebGL graphics.")}</p><button type="button" class="gm-btn" data-a="exit">${t("رجوع", "Back")}</button></div>`).addEventListener("click", (ev) => { if (ev.target.closest("[data-a=exit]")) this.exit(); });
      this.ui.fade(false, 300);
    } finally { this._loading = false; this.ui.loading(false); }
  }
  setPaused(on) { this.loop.pause(on); this.input.setEnabled(!on); if (on) this.audio.setDuck(true); else this.audio.setDuck(false); }
  openStation(id) { this.host.openStation(id); }
  /** The app opened a terminal page over the game: pause rendering, duck the music. */
  showStation() { this.loop.pause(true); this.input.setEnabled(false); this.audio.setDuck(true); this.root.classList.add("gm-behind"); }
  stationClosed() { this.root.classList.remove("gm-behind"); this.loop.pause(false); this.input.setEnabled(true); this.audio.setDuck(false); this.bus.emit("station-closed"); }
  enterFullscreen() { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: "hide" }).catch(() => { }); }
  toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { }); else this.enterFullscreen(); }
  exit() { this.save.flush(); this.host.exit(); }
  unmount() {
    try { this.scenes.cur?.exit?.(); } catch { /* */ }
    this.save.flush(); this.missions?.dispose(); if (this.onHide) document.removeEventListener("visibilitychange", this.onHide); this.loop.stop(); this.scenes.dispose(); this.input.dispose(); this.audio.dispose(); this.renderer?.dispose(); this.offProg();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { });
    this.root.innerHTML = ""; this.root.classList.remove("gm", "gm-behind");
  }
}

export function mount(root, host, opts = {}) { const g = new Game(root, host); g.start(opts.station); return g; }
export { VERSION };
