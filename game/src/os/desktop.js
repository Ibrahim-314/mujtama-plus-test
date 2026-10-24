/* MJT OS — the in-room computer. A Windows-11-style shell (wallpaper, desktop icons, centred taskbar,
 * Start menu with search, a window manager) built as an extensible base: every program is one entry in
 * the app registry (register()). An app either opens a window (mount → body) or launches something
 * outside the OS (launch → e.g. a full station page). Lives inside #gm-modal so the game's input gate
 * (game.ui.modalOpen) keeps the room paused while the computer is on.
 *
 *   register({ id, name: [ar, en], glyph, tint, mount(body, ctx) → cleanup?, launch?(ctx), pinned, desktop })
 *   openOS(game, { onClose }) → { open(id), close() }
 */
import { t, tl } from "../engine/i18n.js";
import { esc } from "../ui/ui.js";

const APPS = new Map();
export function register(app) { APPS.set(app.id, app); }
export const apps = () => [...APPS.values()];

/* wallpaper: a preset (layered CSS gradients) or the member's own photo (downscaled JPEG data URL), kept on this
 * device. { kind: "preset", id } | { kind: "img", data, fit: cover|contain|center, x, y (focal %), dim 0..70, blur 0..12 } */
export const WALLS = {
  mjt: { name: ["مجتمع الذهبي", "MJT Gold"], css: "" },
  aurora: { name: ["الشفق", "Aurora"], css: "radial-gradient(60% 50% at 20% 30%, rgba(46,230,190,.55), transparent 70%), radial-gradient(55% 45% at 75% 25%, rgba(120,90,255,.55), transparent 70%), radial-gradient(80% 60% at 50% 110%, rgba(30,120,255,.5), transparent 70%), linear-gradient(180deg, #040814, #0a1430)" },
  dunes: { name: ["كثبان الربع الخالي", "Desert dunes"], css: "radial-gradient(120% 60% at 30% 120%, #7a3c12 0%, transparent 60%), radial-gradient(110% 55% at 80% 115%, #b8642a 0%, transparent 60%), radial-gradient(140% 70% at 50% 130%, #e3a35a 0%, transparent 65%), linear-gradient(180deg, #1b1033 0%, #6b3a5a 45%, #f0a565 75%, #f7c98a 100%)" },
  night: { name: ["ليل المدينة", "City night"], css: "radial-gradient(40% 30% at 70% 25%, rgba(255,214,140,.35), transparent 70%), repeating-linear-gradient(90deg, rgba(255,255,255,.03) 0 2px, transparent 2px 46px), linear-gradient(180deg, #02030a 0%, #0c1230 60%, #2a1d4a 100%)" },
  bloom: { name: ["ويندوز أزرق", "Bloom"], css: "radial-gradient(35% 45% at 50% 55%, rgba(120,200,255,.95), rgba(40,110,255,.5) 45%, transparent 70%), radial-gradient(60% 70% at 50% 60%, rgba(30,70,200,.6), transparent 75%), linear-gradient(180deg, #031030, #061a4a)" },
  graphite: { name: ["جرافيت", "Graphite"], css: "radial-gradient(90% 70% at 50% 0%, #2b2f3a 0%, transparent 70%), linear-gradient(180deg, #15171d, #0b0c10)" },
  rose: { name: ["وردي هادئ", "Rose"], css: "radial-gradient(70% 60% at 25% 20%, #ffb3c7 0%, transparent 60%), radial-gradient(70% 60% at 85% 80%, #a98bff 0%, transparent 60%), linear-gradient(135deg, #3a1d3f, #1b1430)" },
  forest: { name: ["غابة", "Forest"], css: "radial-gradient(70% 50% at 50% 0%, rgba(190,255,200,.35), transparent 70%), linear-gradient(180deg, #0d2a1f 0%, #0a1f17 50%, #06120d 100%)" }
};
const WKEY = "mjtos.wall", PKEY = "mjtos.photos";
export const wallGet = () => { try { return JSON.parse(localStorage.getItem(WKEY)) || { kind: "preset", id: "mjt" }; } catch { return { kind: "preset", id: "mjt" }; } };
export const wallSet = (w) => { try { localStorage.setItem(WKEY, JSON.stringify(w)); return true; } catch { return false; } };
export const photosGet = () => { try { return JSON.parse(localStorage.getItem(PKEY)) || []; } catch { return []; } };
export const photosSet = (a) => { try { localStorage.setItem(PKEY, JSON.stringify(a)); return true; } catch { return false; } };
export function paintWall(el, w = wallGet()) {
  if (!el) return;
  const img = el.querySelector(".os-wimg") || el.appendChild(Object.assign(document.createElement("b"), { className: "os-wimg" }));
  el.classList.toggle("custom", w.kind !== "preset" || w.id !== "mjt");
  if (w.kind === "img" && w.data) {
    const fit = w.fit === "contain" ? "contain" : w.fit === "center" ? "auto" : "cover";
    Object.assign(img.style, { background: `#06070d url("${w.data}") ${w.x ?? 50}% ${w.y ?? 50}% / ${fit} no-repeat`, filter: w.blur ? `blur(${w.blur}px)` : "", inset: w.blur ? `-${w.blur * 2}px` : "0" });
    img.style.setProperty("--dim", String((w.dim || 0) / 100));
  } else {
    const p = WALLS[w.id] || WALLS.mjt;
    Object.assign(img.style, { background: p.css || "none", filter: "", inset: "0" }); img.style.setProperty("--dim", "0");
  }
}

const G = {
  start: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8.4" height="8.4" rx="1.4"/><rect x="12.6" y="3" width="8.4" height="8.4" rx="1.4"/><rect x="3" y="12.6" width="8.4" height="8.4" rx="1.4"/><rect x="12.6" y="12.6" width="8.4" height="8.4" rx="1.4"/></svg>',
  min: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  max: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  power: '<svg viewBox="0 0 24 24"><path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>'
};
const glyph = (a, cls = "") => `<span class="os-gl ${cls}" style="--tint:${a.tint || "#4cc2ff"}">${a.glyph}</span>`;
const nm = (a) => tl({ ar: a.name[0], en: a.name[1] });

export function openOS(game, { onClose, onOutside, user = "" } = {}) {
  const panel = game.ui.modal(`
    <div class="os" id="gm-os" dir="${document.dir || "rtl"}">
      <div class="os-wall" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="os-desk" role="list"></div>
      <div class="os-wins"></div>
      <div class="os-start" hidden role="dialog" aria-label="${esc(t("قائمة ابدأ", "Start"))}">
        <label class="os-search">${G.search}<input type="search" placeholder="${esc(t("ابحث عن برنامج", "Search for an app"))}" /></label>
        <h3>${esc(t("المثبّتة", "Pinned"))}</h3>
        <div class="os-pins"></div>
        <footer><span class="os-me"><b>${esc(String(user || t("أنت", "You")).slice(0, 24))}</b></span>
          <button type="button" class="os-pow" data-os="off">${G.power}<span>${esc(t("خروج إلى الغرفة", "Exit to the room"))}</span></button></footer>
      </div>
      <nav class="os-bar">
        <div class="os-bar-c">
          <button type="button" class="os-tb os-sb" data-os="start" aria-label="${esc(t("ابدأ", "Start"))}">${G.start}</button>
          <span class="os-tasks"></span>
        </div>
        <div class="os-tray"><button type="button" class="os-tb os-outb" data-os="out" aria-label="${esc(t("عرض من الخارج", "View from outside"))}">${G.eye}</button><span class="os-ti"><span class="os-bal"></span><time class="os-clock"></time></span></div>
      </nav>
    </div>`, "gm-osm");
  const $ = (s) => panel.querySelector(s), root = $("#gm-os");
  paintWall($(".os-wall"));
  const wins = new Map(); let z = 10, alive = true;
  const ctx = { game, t, close: () => close(), toast, wall: (w) => paintWall($(".os-wall"), w) };

  // desktop icons + start pins + taskbar pins
  const list = apps();
  $(".os-desk").innerHTML = list.filter((a) => a.desktop !== false).map((a) => `<button type="button" class="os-di" data-app="${a.id}" role="listitem">${glyph(a)}<span>${esc(nm(a))}</span></button>`).join("");
  const pins = (q = "") => { const s = q.trim().toLowerCase(); $(".os-pins").innerHTML = list.filter((a) => !s || a.name.some((n) => n.toLowerCase().includes(s))).map((a) => `<button type="button" class="os-pin" data-app="${a.id}">${glyph(a)}<span>${esc(nm(a))}</span></button>`).join("") || `<p class="os-none">${esc(t("لا نتائج", "No results"))}</p>`; };
  pins();
  const tasks = () => { $(".os-tasks").innerHTML = list.filter((a) => a.pinned || wins.has(a.id)).map((a) => { const w = wins.get(a.id); return `<button type="button" class="os-tb ${w ? "open" : ""} ${w && !w.min && Number(w.el.style.zIndex) === z ? "act" : ""}" data-app="${a.id}" aria-label="${esc(nm(a))}">${glyph(a, "sm")}</button>`; }).join(""); };
  tasks();

  // clock + balance
  const tick = () => { if (!alive) return; const d = new Date(); $(".os-clock").textContent = d.toLocaleTimeString(document.documentElement.lang === "en" ? "en-GB" : "ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }); };
  tick(); const clock = setInterval(tick, 15000);
  ctx.refreshBal = () => { if (!game.member) { $(".os-bal").textContent = ""; return; } game.host.api("GET", "/api/mjt/me").then((m) => { if (alive) $(".os-bal").textContent = m.balance.mjt + " MJT"; }, () => { }); };
  ctx.refreshBal();

  function startMenu(show) { const s = $(".os-start"); const on = show ?? s.hidden; s.hidden = !on; $(".os-sb").classList.toggle("act", on); if (on) { pins(); const i = s.querySelector("input"); i.value = ""; setTimeout(() => i.focus({ preventScroll: true }), 30); } }
  function focus(id) { const w = wins.get(id); if (!w) return; w.min = false; w.el.hidden = false; w.el.style.zIndex = ++z; tasks(); }
  function open(id) {
    const a = APPS.get(id); if (!a) return; startMenu(false); game.audio.sfx("tap");
    if (a.launch) { a.launch(ctx); return; }
    if (wins.has(id)) { const w = wins.get(id); if (w.min || Number(w.el.style.zIndex) !== z) focus(id); else { w.min = true; w.el.hidden = true; tasks(); } return; }
    const el = document.createElement("section"); el.className = "os-win" + (a.wide ? " wide" : ""); el.dataset.win = id; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", nm(a));
    el.innerHTML = `<header class="os-wt">${glyph(a, "xs")}<b>${esc(nm(a))}</b><span class="os-wc">
      <button type="button" data-w="min" aria-label="${esc(t("تصغير", "Minimise"))}">${G.min}</button>
      <button type="button" data-w="max" aria-label="${esc(t("تكبير", "Maximise"))}">${G.max}</button>
      <button type="button" data-w="x" class="cl" aria-label="${esc(t("إغلاق", "Close"))}">${G.x}</button></span></header><div class="os-wb"></div>`;
    if (matchMedia("(max-width: 720px)").matches) el.classList.add("maxd");
    $(".os-wins").appendChild(el);
    const w = { el, min: false, off: null }; wins.set(id, w); focus(id);
    requestAnimationFrame(() => el.classList.add("on"));
    try { w.off = a.mount(el.querySelector(".os-wb"), ctx) || null; } catch (e) { el.querySelector(".os-wb").textContent = String(e?.message || e); }
    drag(el);
  }
  function shut(id) { const w = wins.get(id); if (!w) return; try { w.off?.(); } catch { /* app cleanup */ } wins.delete(id); w.el.classList.remove("on"); setTimeout(() => w.el.remove(), 160); tasks(); }
  function drag(el) {
    const bar = el.querySelector(".os-wt"); let sx = 0, sy = 0, ox = 0, oy = 0, on = false;
    bar.addEventListener("pointerdown", (e) => { if (e.target.closest("button") || el.classList.contains("maxd")) return; on = true; sx = e.clientX; sy = e.clientY; const r = el.getBoundingClientRect(), pr = root.getBoundingClientRect(); ox = r.left - pr.left; oy = r.top - pr.top; bar.setPointerCapture(e.pointerId); });
    bar.addEventListener("pointermove", (e) => { if (!on) return; const pr = root.getBoundingClientRect(); el.style.left = Math.max(0, Math.min(pr.width - 120, ox + e.clientX - sx)) + "px"; el.style.top = Math.max(0, Math.min(pr.height - 90, oy + e.clientY - sy)) + "px"; el.style.right = "auto"; el.style.transform = "none"; });
    bar.addEventListener("pointerup", () => { on = false; });
    bar.addEventListener("dblclick", () => el.classList.toggle("maxd"));
  }
  function toast(msg) { const n = document.createElement("div"); n.className = "os-toast"; n.textContent = msg; root.appendChild(n); requestAnimationFrame(() => n.classList.add("on")); setTimeout(() => { n.classList.remove("on"); setTimeout(() => n.remove(), 300); }, 2600); }

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) { if (!e.target.closest(".os-start")) startMenu(false); return; }
    const win = b.closest(".os-win"), act = b.dataset.w;
    if (win && act) { const id = win.dataset.win; if (act === "x") shut(id); else if (act === "min") { const w = wins.get(id); w.min = true; win.hidden = true; tasks(); } else win.classList.toggle("maxd"); return; }
    if (b.dataset.os === "start") { game.audio.sfx("tap"); startMenu(); return; }
    if (b.dataset.os === "off") { close(); return; }
    if (b.dataset.os === "out") { startMenu(false); onOutside?.(); return; }
    if (b.dataset.app) open(b.dataset.app);
  });
  root.addEventListener("pointerdown", (e) => { const w = e.target.closest(".os-win"); if (w && Number(w.style.zIndex) !== z) focus(w.dataset.win); });
  $(".os-start input").addEventListener("input", (e) => pins(e.target.value));
  $(".os-start input").addEventListener("keydown", (e) => { if (e.key === "Enter") { const f = $(".os-pins [data-app]"); if (f) open(f.dataset.app); } });
  const onKey = (e) => { if (e.key !== "Escape") return; e.stopPropagation(); if (!$(".os-start").hidden) startMenu(false); else { const top = [...wins.entries()].filter(([, w]) => !w.min).sort((a, b) => b[1].el.style.zIndex - a[1].el.style.zIndex)[0]; if (top) shut(top[0]); else close(); } };
  addEventListener("keydown", onKey, true);

  function close() {
    if (!alive) return; alive = false; clearInterval(clock); removeEventListener("keydown", onKey, true);
    for (const id of [...wins.keys()]) shut(id);
    game.audio.sfx("back"); game.ui.closeModal(); onClose?.();
  }
  root.classList.add("boot"); setTimeout(() => root.classList.remove("boot"), 700);
  return { open, close, root, panel };
}
