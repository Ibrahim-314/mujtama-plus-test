/* The pause menu and the settings panel (sound buses, graphics quality, full screen). Shared by every scene. */
import { t } from "../engine/i18n.js";
import { esc, icon } from "./ui.js";

const QL = () => [["auto", t("تلقائي", "Auto")], ["low", t("منخفض", "Low")], ["medium", t("متوسط", "Medium")], ["high", t("عالٍ", "High")]];

export function openSettings(game, back) {
  const s = { music: game.audio.vol.music, ambient: game.audio.vol.ambient, sfx: game.audio.vol.sfx, quality: game.renderer.mode };
  const slider = (k, label) => `<label class="gm-sl"><span>${esc(label)}</span><input type="range" min="0" max="100" step="5" value="${Math.round(s[k] * 100)}" data-k="${k}" aria-label="${esc(label)}"><b data-v="${k}">${Math.round(s[k] * 100)}</b></label>`;
  const p = game.ui.modal(`
    <header class="gm-ph">${icon("gear")}<h2>${esc(t("الإعدادات", "Settings"))}</h2></header>
    <section class="gm-sec"><h3>${esc(t("الصوت", "Sound"))}</h3>
      ${slider("music", t("الموسيقى", "Music"))}${slider("ambient", t("أجواء المكان", "Ambience"))}${slider("sfx", t("المؤثرات", "Effects"))}</section>
    <section class="gm-sec"><h3>${esc(t("الرسوميات", "Graphics"))}</h3>
      <div class="gm-seg" role="radiogroup" aria-label="${esc(t("الجودة", "Quality"))}">${QL().map(([k, l]) => `<button type="button" class="gm-opt" role="radio" aria-checked="${s.quality === k}" data-q="${k}">${esc(l)}</button>`).join("")}</div>
      <p class="gm-note">${esc(t("التلقائي يخفّض الجودة بنفسه إذا ثقل الجهاز.", "Auto lowers the quality by itself if the device struggles."))}</p></section>
    <section class="gm-sec"><button type="button" class="gm-btn ghost wide" data-a="fs">${icon("full")}<span>${esc(document.fullscreenElement ? t("الخروج من ملء الشاشة", "Exit full screen") : t("ملء الشاشة", "Full screen"))}</span></button></section>
    <footer class="gm-pf"><button type="button" class="gm-btn wide" data-a="done" data-sfx="back">${icon("back")}<span>${esc(t("رجوع", "Back"))}</span></button></footer>`, "gm-set");
  p.addEventListener("input", (e) => { const k = e.target.dataset.k; if (!k) return; const v = Number(e.target.value) / 100; game.audio.setVolume(k, v); p.querySelector(`[data-v="${k}"]`).textContent = e.target.value; s[k] = v; });
  p.addEventListener("change", (e) => { if (e.target.dataset.k) { game.save.set({ settings: { [e.target.dataset.k]: s[e.target.dataset.k] } }); if (e.target.dataset.k === "sfx") game.audio.sfx("click"); } });
  p.addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]"); if (q) { p.querySelectorAll("[data-q]").forEach((b) => b.setAttribute("aria-checked", String(b === q))); game.renderer.setQuality(q.dataset.q); game.save.set({ settings: { quality: q.dataset.q } }); return; }
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (a === "fs") { game.toggleFullscreen(); setTimeout(() => openSettings(game, back), 250); }
    if (a === "done") { if (back) back(); else game.ui.closeModal(); }
  });
  p.querySelector("input")?.focus();
}

export function openPause(game) {
  if (game.ui.modalOpen) return;
  game.setPaused(true);
  const p = game.ui.modal(`
    <header class="gm-ph">${icon("menu")}<h2>${esc(t("القائمة", "Menu"))}</h2></header>
    <nav class="gm-menu">
      <button type="button" class="gm-btn wide" data-a="resume">${icon("play")}<span>${esc(t("استئناف", "Resume"))}</span></button>
      <button type="button" class="gm-btn ghost wide" data-a="settings">${icon("gear")}<span>${esc(t("الإعدادات", "Settings"))}</span></button>
      <button type="button" class="gm-btn ghost wide" data-a="title">${icon("star")}<span>${esc(t("الشاشة الرئيسية للعبة", "Title screen"))}</span></button>
      <button type="button" class="gm-btn danger wide" data-a="exit" data-sfx="back">${icon("exit")}<span>${esc(t("الخروج إلى التطبيق", "Exit to the app"))}</span></button>
    </nav>`, "gm-pause");
  p.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
    if (a === "resume") { game.ui.closeModal(); game.setPaused(false); }
    if (a === "settings") openSettings(game, () => { game.ui.closeModal(); setTimeout(() => openPause(game), 230); });
    if (a === "title") { game.ui.closeModal(); game.setPaused(false); game.save.flush(); game.scenes.go("title"); }
    if (a === "exit") { game.ui.closeModal(); game.exit(); }
  });
  p.querySelector("button")?.focus();
}
