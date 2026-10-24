/* MJT Tower — what opens when the player walks into the MJT tower on the street (v2.96). Replaces the old station page
 * (the web app's #/city/mjt/* hall): a game screen in the same techy MJT OS style as the computer in the room.
 * A lobby with a live balance hero (count-up, spinning coin, today's reward cap) and a dock of the tower's programs —
 * the same MJT OS apps (balance, wallet, records, mining) running on the member's live data, one at a time.
 * Lives inside #gm-modal, so the game's input gate (game.ui.modalOpen) keeps the street still while it is open.
 *
 *   openTower(game, { onClose }) → { close(), show(id) }
 */
import { t, tl } from "../engine/i18n.js";
import { esc } from "../ui/ui.js";
import { apps, paintWall } from "./desktop.js";
import "./apps.js";

const TABS = ["balance", "send", "history", "mining"];
const X = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
const COIN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9h4.2a1.9 1.9 0 0 1 0 3.8h-3.4a1.9 1.9 0 0 0 0 3.8h4.4M12 6.8v2M12 16.6v2"/></svg>';

export function openTower(game, { onClose } = {}) {
  const list = new Map(apps().map((a) => [a.id, a]));
  const tabs = TABS.map((id) => list.get(id)).filter(Boolean);
  const nm = (a) => tl({ ar: a.name[0], en: a.name[1] });
  const panel = game.ui.modal(`
    <div class="os tw" id="gm-tw" dir="${document.dir || "rtl"}">
      <div class="os-wall" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="tw-grid" aria-hidden="true"></div>
      <header class="tw-top">
        <button type="button" class="tw-exit" data-tw="exit" aria-label="${esc(t("الخروج إلى الشارع", "Back to the street"))}">${X}<span>${esc(t("الشارع", "Street"))}</span></button>
        <div class="tw-title"><small>MJT TOWER</small><b>${esc(t("برج مجتمع كوين", "Mujtama Coin Tower"))}</b></div>
        <time class="tw-clock"></time>
      </header>
      <section class="tw-hero" aria-live="polite">
        <span class="tw-coin" aria-hidden="true"><i></i>${COIN}</span>
        <div class="tw-hv"><small>${esc(t("رصيدك", "Your balance"))}</small><b><bdi class="tw-amt">—</bdi> <i>MJT</i></b><span class="tw-ok"></span></div>
        <div class="tw-today"><div class="tw-bar"><i></i></div><small class="tw-cap"></small></div>
      </section>
      <nav class="tw-dock" role="tablist">${tabs.map((a) => `<button type="button" role="tab" class="tw-tab" data-tab="${a.id}" style="--tint:${a.tint}"><span class="os-gl" style="--tint:${a.tint}">${a.glyph}</span><span>${esc(nm(a))}</span></button>`).join("")}</nav>
      <section class="tw-win" role="tabpanel"><div class="os-wb tw-body"></div></section>
    </div>`, "gm-osm gm-twm");
  const $ = (s) => panel.querySelector(s), root = $("#gm-tw"), body = $(".tw-body");
  paintWall($(".os-wall"), { kind: "preset", id: "mjt" });
  let alive = true, cur = null, off = null, shown = 0, raf = 0;

  // the balance hero: count up to the live figure
  const count = (to) => {
    cancelAnimationFrame(raf); const from = shown, t0 = performance.now(), dec = (String(to).split(".")[1] || "").length;
    const step = (now) => { if (!alive) return; const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3); shown = from + (to - from) * e; $(".tw-amt").textContent = shown.toFixed(Math.min(dec, 4)); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
  };
  const refreshBal = () => {
    if (!game.member) { $(".tw-amt").textContent = "—"; $(".tw-ok").textContent = t("سجّل الدخول لترى رصيدك", "Sign in to see your balance"); root.classList.add("guest"); return; }
    game.host.api("GET", "/api/mjt/me").then((m) => {
      if (!alive) return; count(Number(m.balance.mjt) || 0);
      $(".tw-ok").textContent = m.frozen ? t("المحفظة مجمّدة", "Wallet frozen") : m.verified ? "✓ " + t("مطابق لسجل القيود", "Ledger-verified") : t("قيد المراجعة", "Under review");
      const td = m.today || {}, k = Math.min(1, Number(td.earned || 0) / Math.max(1, Number(td.cap || 1)));
      $(".tw-bar i").style.width = (k * 100).toFixed(1) + "%";
      $(".tw-cap").textContent = `${t("اليوم", "Today")} ${td.earned || "0"} / ${td.cap || "—"} MJT`;
      root.classList.add("live");
    }, () => { if (alive) $(".tw-ok").textContent = t("تعذّر تحميل الرصيد", "Couldn't load the balance"); });
  };
  const tick = () => { if (!alive) return; $(".tw-clock").textContent = new Date().toLocaleTimeString(document.documentElement.lang === "en" ? "en-GB" : "ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }); };
  tick(); const clock = setInterval(tick, 15000);

  const ctx = { game, t, close: () => close(), toast, refreshBal, wall: () => { } };
  function show(id) {
    const a = list.get(id); if (!a || id === cur || !alive) return;
    try { off?.(); } catch { /* app cleanup */ }
    off = null; cur = id; body.innerHTML = ""; body.scrollTop = 0;
    for (const b of root.querySelectorAll(".tw-tab")) { const on = b.dataset.tab === id; b.classList.toggle("act", on); b.setAttribute("aria-selected", String(on)); }
    const w = $(".tw-win"); w.classList.remove("on"); void w.offsetWidth; w.classList.add("on");
    try { off = a.mount(body, ctx) || null; } catch (e) { body.textContent = String(e?.message || e); }
  }
  function toast(msg) { const n = document.createElement("div"); n.className = "os-toast"; n.textContent = msg; root.appendChild(n); requestAnimationFrame(() => n.classList.add("on")); setTimeout(() => { n.classList.remove("on"); setTimeout(() => n.remove(), 300); }, 2600); }

  // the old station pages are gone from the tower: swallow «full page» links inside it
  body.addEventListener("click", (e) => { if (e.target.closest("[data-full]")) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tw === "exit") { close(); return; }
    if (b.dataset.tab) { game.audio.sfx("tap"); show(b.dataset.tab); }
  });
  const onKey = (e) => { if (e.key !== "Escape") return; e.stopPropagation(); close(); };
  addEventListener("keydown", onKey, true);

  function close() {
    if (!alive) return; alive = false; clearInterval(clock); cancelAnimationFrame(raf); removeEventListener("keydown", onKey, true);
    try { off?.(); } catch { /* app cleanup */ }
    off = null; game.audio.sfx("back"); game.ui.closeModal(); onClose?.();
  }
  refreshBal(); show("balance");
  root.classList.add("boot"); setTimeout(() => root.classList.remove("boot"), 900);
  return { close, show, root };
}
