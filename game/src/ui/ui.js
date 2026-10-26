/* The game's interface layer (DOM over the canvas): fades, the loading screen, dialogue with a typewriter, toasts, the
 * pause menu and the settings panel. Scenes put their own HUD in a scene layer (layer()), cleared on every scene change.
 * Every button gets the game's hover/click sounds. CSP-safe: no inline handlers or styles (custom properties from JS). */
import { t, isRtl, getLang } from "../engine/i18n.js";
import { CSS_PALETTE } from "../config.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h10"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', back: '<path d="M15 18l-6-6 6-6"/>',
  play: '<path d="M7 5v14l11-7z"/>', gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  exit: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5v-6a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-2.3-4a1.5 1.5 0 0 1 2.6-1.5L8 13"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5h4a1.8 1.8 0 0 1 0 3.6h-3a1.8 1.8 0 0 0 0 3.6h4M12 7.5v1.8M12 16.7v1.8"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>', box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  bed: '<path d="M3 18v-7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7M3 14h18M7 9V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  wallet: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2M3 9h15"/>', spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'
};
export const icon = (n, cls = "") => `<svg class="gm-i ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[n] || ""}</svg>`;

const TIPS = [
  ["كل نافذة مضيئة في المدينة الرقمية لاعب يبني ثروته.", "Every lit window in the Digital City is a player building their fortune."],
  ["البرج الذهبي في قلب المدينة هو نواة مجتمع كوين.", "The golden tower at the heart of the city is the core of Mujtama Coin."],
  ["المس الأرض لتمشي إليها، أو استخدم عصا التحكم.", "Tap the floor to walk there, or use the joystick."],
  ["جهاز التعدين يعمل 24 ساعة حتى وأنت خارج اللعبة.", "Your mining rig runs 24 hours, even when you are away."],
  ["تقدّمك محفوظ، وتكمل من أي جهاز.", "Your progress is saved — continue on any device."]
];

export class UI {
  constructor(root, game) {
    this.root = root; this.game = game;
    for (const k in CSS_PALETTE) root.style.setProperty(k, CSS_PALETTE[k]);
    root.dir = isRtl() ? "rtl" : "ltr"; root.lang = getLang();
    root.insertAdjacentHTML("beforeend", `
      <div class="gm-ui" id="gm-ui"><div class="gm-scene" id="gm-scene"></div></div>
      <div class="gm-vignette" aria-hidden="true"></div>
      <div class="gm-fade on" id="gm-fade" aria-hidden="true"></div>
      <div class="gm-load" id="gm-load" role="status" aria-live="polite">
        <div class="gm-emblem" aria-hidden="true"><i></i><i></i><i></i><b>MJT</b></div>
        <div class="gm-load-t">${esc(t("المدينة الرقمية", "The Digital City"))}</div>
        <div class="gm-bar"><i id="gm-load-bar"></i></div>
        <p class="gm-tip" id="gm-tip"></p>
      </div>
      <div class="gm-toasts" id="gm-toasts" aria-live="polite"></div>
      <div class="gm-dlg" id="gm-dlg" hidden><div class="gm-dlg-in"><b class="gm-dlg-who" id="gm-dlg-who"></b><p class="gm-dlg-t" id="gm-dlg-t"></p><span class="gm-dlg-next" aria-hidden="true">▼</span></div></div>
      <div class="gm-modal" id="gm-modal" hidden></div>`);
    this.$ = (s) => root.querySelector(s);
    this.scene = this.$("#gm-scene");
    // the game's button sounds
    root.addEventListener("pointerenter", (e) => { if (e.target.closest?.(".gm-btn, .gm-opt, .gm-arrow") && e.pointerType === "mouse") game.audio.sfx("hover"); }, true);
    root.addEventListener("click", (e) => { const b = e.target.closest(".gm-btn, .gm-opt, .gm-arrow, .gm-ico"); if (b && !b.disabled) game.audio.sfx(b.dataset.sfx || "click"); }, true);
    this.tipT = 0;
  }
  fade(on, ms = 450) {
    const f = this.$("#gm-fade"); f.style.setProperty("--d", ms + "ms");
    return new Promise((res) => { requestAnimationFrame(() => { f.classList.toggle("on", on); setTimeout(res, ms); }); });
  }
  loading(on, p = 0) {
    const l = this.$("#gm-load"); l.classList.toggle("on", on);
    this.$("#gm-load-bar").style.setProperty("--p", Math.round(p * 100) + "%");
    if (on && !this.tipT) { const show = () => { const k = TIPS[Math.floor(Math.random() * TIPS.length)]; this.$("#gm-tip").textContent = t(k[0], k[1]); }; show(); this.tipT = setInterval(show, 3200); }
    if (!on) { clearInterval(this.tipT); this.tipT = 0; }
  }
  clearScene() { this.scene.innerHTML = ""; this.scene.className = "gm-scene"; }
  /** Add a block of HTML to the current scene's layer and return its element. */
  layer(html, cls = "") { const d = document.createElement("div"); d.className = "gm-layer " + cls; d.innerHTML = html; this.scene.append(d); return d; }
  toast(text, kind = "") {
    const box = this.$("#gm-toasts"), d = document.createElement("div"); d.className = "gm-toast " + kind; d.innerHTML = text; box.append(d);
    requestAnimationFrame(() => d.classList.add("on")); setTimeout(() => { d.classList.remove("on"); setTimeout(() => d.remove(), 400); }, 3200);
  }
  /** Show dialogue lines one by one (typewriter); tap/Enter/Space skips the typing, then advances. */
  dialog(lines, who = "") {
    const box = this.$("#gm-dlg"), tx = this.$("#gm-dlg-t"); this.$("#gm-dlg-who").textContent = who; this.$("#gm-dlg-who").hidden = !who;
    box.hidden = false; requestAnimationFrame(() => box.classList.add("on")); this.game.input?.setEnabled(false); this.game.audio.setDuck(true);
    return new Promise((res) => {
      let i = 0, typing = 0, full = "";
      const show = () => {
        full = lines[i]; tx.textContent = ""; let k = 0; clearInterval(typing);
        typing = setInterval(() => { k += 1; tx.textContent = full.slice(0, k); if (k % 2 === 0) this.game.audio.sfx("type"); if (k >= full.length) { clearInterval(typing); typing = 0; } }, 24);
      };
      const next = (e) => {
        if (e?.type === "keydown" && !["Enter", " ", "e", "E", "Escape"].includes(e.key)) return; e?.preventDefault?.();
        if (typing) { clearInterval(typing); typing = 0; tx.textContent = full; return; }
        i++; if (i < lines.length) return show();
        box.classList.remove("on"); setTimeout(() => { if (!box.classList.contains("on")) box.hidden = true; }, 250); // a dialogue straight after this one keeps the box
        box.removeEventListener("click", next); removeEventListener("keydown", next, true);
        this.game.input?.setEnabled(true); this.game.audio.setDuck(false); res();
      };
      box.addEventListener("click", next); addEventListener("keydown", next, true); show();
    });
  }
  /** A small explicit choice (story): a modal of option buttons; resolves with the chosen index. No outside close. */
  choose(title, opts) {
    const p = this.modal(`<div class="gm-ph term"><h2>${esc(title)}</h2></div><div class="gm-term">${opts.map((o, i) =>
      `<button type="button" class="gm-term-o" data-ch="${i}"><span><b>${esc(o.label)}</b>${o.hint ? `<small>${esc(o.hint)}</small>` : ""}</span></button>`).join("")}</div>`, "gm-termm gm-choice");
    this.game.input?.setEnabled(false);
    return new Promise((res) => {
      const pick = (i) => { removeEventListener("keydown", key, true); this.closeModal(); this.game.input?.setEnabled(true); this.game.audio?.sfx?.("click"); res(i); };
      const key = (e) => { const n = Number(e.key) - 1; if (n >= 0 && n < opts.length) { e.preventDefault(); pick(n); } };
      p.querySelectorAll("[data-ch]").forEach((b) => b.addEventListener("click", () => pick(Number(b.dataset.ch)), { once: true }));
      addEventListener("keydown", key, true); requestAnimationFrame(() => p.querySelector("[data-ch]")?.focus());
    });
  }
  /** A centred modal (pause menu, settings, terminal menu). Returns the panel element; close() removes it. */
  modal(html, cls = "") {
    const m = this.$("#gm-modal"); m.className = "gm-modal " + cls; m.innerHTML = `<div class="gm-panel" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false;
    requestAnimationFrame(() => m.classList.add("on")); return m.querySelector(".gm-panel");
  }
  closeModal() { const m = this.$("#gm-modal"); m.classList.remove("on"); setTimeout(() => { if (!m.classList.contains("on")) { m.hidden = true; m.innerHTML = ""; } }, 220); }
  get modalOpen() { return !this.$("#gm-modal").hidden; }
}
