/* مجتمع بلس — «مدينة المجتمع الرقمية»: the MJT hall's own rooms (city/rooms.js, lazy "town" chunk).
 * The owner's rule (2026-10-23): the city is its own place with its own pages, never linked to the app's pages
 * («لا اريد يكون لها ربط مع صفحات التطبيق نهائيا يكون لها صفحات متخصصه فيها هي»), showing the member's REAL data
 * in the city's design («تعرض بياناتي الحقيقيه ولكن بتصميم المدينه»). Each station of the hall opens one room:
 *   #/city/mjt/balance  الرصيد     — the balance counts up in gold neon, today's rewards against the daily cap
 *   #/city/mjt/history  السجلات    — every movement (keyset «المزيد»), in and out
 *   #/city/mjt/send     المحفظة    — send MJT to a member (idempotency key per attempt), receive on/off
 *   #/city/mjt/earn     التعدين    — the live mining ring (today's earnings), what earns MJT and its caps
 *   #/city/mjt/stats    الإحصاءات  — today, this page of movements in numbers, and where it came from
 * Same server APIs and rules as the app's MJT screens (/api/mjt/*); the app's own screens are untouched.
 * CSP: no inline handlers or styles (custom properties are set from JS). */
(function CityRooms() {
  "use strict";
  const api = (m, p, b) => Remote.api(m, p, b);
  const { T, esc, reduced } = MPCity.util;
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const ic = (n, c = "sm") => (window.UI && UI.icon ? UI.icon(n, c) : "");
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const num = (s) => `<bdi dir="ltr" class="cy-rm-n">${esc(s)}</bdi>`;
  const day = (s) => { try { return new Intl.DateTimeFormat(MPCity.util.lang() === "en" ? "en" : "ar", { numberingSystem: "latn", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(s)); } catch { return String(s || "").slice(0, 16); } };
  const newKey = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* below */ } const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); return null; } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  // the wallet's own small icons, inline (they do not depend on the app's sprite)
  const SVG = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    up: '<path d="M7 17 17 7M8 7h9v9"/>',
    down: '<path d="M17 7 7 17M16 17H7V8"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>'
  };
  const svgI = (n) => `<svg class="cy-wi" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG[n] || ""}</svg>`;
  const KIND_ICO = { reward: "award", conversion: "swap", conversion_reversal: "swap", transfer: "send", tip: "gift", adjustment: "shield", clawback: "flag", spend: "bag", refund: "refresh" };

  const ROOMS = {
    balance: { t: "الرصيد", i: "coin", acc: "#ffcf5a" },
    history: { t: "السجلات", i: "receipt", acc: "#b48cff" },
    send: { t: "المحفظة", i: "wallet", acc: "#ff4fd8" },
    earn: { t: "التعدين", i: "sparkle", acc: "#ffd76a" },
    stats: { t: "الإحصاءات", i: "chart", acc: "#ff7a59" }
  };
  // the room strip: the hall's other rooms, so the member moves between them without leaving the city
  const strip = (cur) => `<nav class="cy-rm-nav" aria-label="${esc(T("قاعة مجتمع كوين"))}">${Object.keys(ROOMS).map((k) => `<a href="#/city/mjt/${k}"${k === cur ? ' aria-current="page"' : ""} data-acc="${ROOMS[k].acc}">${ic(ROOMS[k].i, "xs")}<span>${esc(T(ROOMS[k].t))}</span></a>`).join("")}</nav>`;

  /* v2.86.1 «التنقل داخل المبنى»: a station opens IN the hall — the hall stays behind (dimmed), the room rises as a neon
   * panel over it, the dock moves between stations in place, and closing it leaves the character standing at that station.
   * No full-screen loader and no page change per station (owner 2026-10-23: «طريقة النقل داخل المبنى ليست احترافيه»).
   * A room opened without its hall (should not happen: the route renders the hall first) falls back to its own page. */
  const STATION = { send: "wallet", history: "records", balance: "balance", earn: "mining", stats: "stats" };
  MPCity.stationOf = (room) => STATION[room] || null;
  let sheetKey = null;
  function closeSheet(sh, instant) {
    if (!sh) return;
    sh.classList.remove("on"); document.body.classList.remove("cy-st-open");
    if (sheetKey) { removeEventListener("keydown", sheetKey, true); sheetKey = null; }
    const gone = () => sh.remove();
    if (instant || reduced()) gone(); else setTimeout(gone, 280);
    view.querySelector("#cy-page-slot .cy-stage")?.focus?.({ preventScroll: true });
  }
  MPCity.closeRoom = () => closeSheet(view.querySelector(".cy-st"));
  function shell(id, body) {
    const r = ROOMS[id];
    const hall = view.querySelector('.cy-hall[data-scene="mjt"]');
    if (!hall) {
      view.innerHTML = `<div class="wrap cy-page cy-room" data-room="${id}">
        ${UI.pageHead({ back: ["#/city/mjt", T("قاعة مجتمع كوين")], title: T(r.t), id: "cy-rm-h" })}
        ${strip(id)}<div class="cy-rm-body" id="cy-rm">${body}</div></div>`;
      const room = $(".cy-room"); room.style.setProperty("--cy-acc", r.acc);
      const pal = ((window.MPCityScenes || {}).mjt || {}).palette || {}; for (const k in pal) room.style.setProperty(k, pal[k]);
      view.querySelectorAll(".cy-rm-nav a").forEach((a) => a.style.setProperty("--cy-acc", a.dataset.acc));
      return $("#cy-rm");
    }
    let sh = hall.querySelector(".cy-st");
    if (!sh) {
      sh = document.createElement("div"); sh.className = "cy-st";
      sh.innerHTML = `<div class="cy-st-scrim" data-close="1" aria-hidden="true"></div>
        <section class="cy-st-panel cy-room" role="dialog" aria-modal="true" aria-labelledby="cy-rm-h">
          <div class="cy-st-grip" aria-hidden="true"></div>
          <header class="cy-st-head"><span class="cy-st-ico" aria-hidden="true"></span><h2 id="cy-rm-h" tabindex="-1"></h2>
            <button type="button" class="cy-st-x" data-close="1" aria-label="${esc(T("إغلاق"))}">${svgI("x")}</button></header>
          <div class="cy-st-nav"></div><div class="cy-st-scroll" tabindex="0" aria-label="${esc(T(r.t))}"><div class="cy-rm-body" id="cy-rm"></div></div></section>`;
      const pal = ((window.MPCityScenes || {}).mjt || {}).palette || {}; for (const k in pal) sh.style.setProperty(k, pal[k]);
      hall.append(sh);
      sh.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) { e.preventDefault(); location.hash = "#/city/mjt"; } });
      // swipe the grip down to close
      let y0 = null; const panel = sh.querySelector(".cy-st-panel"), grip = sh.querySelector(".cy-st-head");
      grip.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; y0 = e.clientY; panel.style.transition = "none"; });
      addEventListener("pointermove", (e) => { if (y0 == null) return; const d = Math.max(0, e.clientY - y0); panel.style.transform = `translateY(${d}px)`; }, { passive: true });
      addEventListener("pointerup", (e) => { if (y0 == null) return; const d = e.clientY - y0; y0 = null; panel.style.transition = ""; panel.style.transform = ""; if (d > 90) location.hash = "#/city/mjt"; });
      sheetKey = (e) => { if (e.key === "Escape" && sh.isConnected) { e.preventDefault(); location.hash = "#/city/mjt"; } };
      addEventListener("keydown", sheetKey, true);
      document.body.classList.add("cy-st-open");
      requestAnimationFrame(() => requestAnimationFrame(() => sh.classList.add("on")));
    }
    const panel = sh.querySelector(".cy-st-panel");
    panel.dataset.room = id; panel.style.setProperty("--cy-acc", r.acc); sh.style.setProperty("--cy-acc", r.acc);
    sh.querySelector(".cy-st-ico").innerHTML = ic(r.i, "sm");
    sh.querySelector("#cy-rm-h").textContent = T(r.t);
    sh.querySelector(".cy-st-nav").innerHTML = strip(id);
    sh.querySelectorAll(".cy-rm-nav a").forEach((a) => a.style.setProperty("--cy-acc", a.dataset.acc));
    const on = sh.querySelector(".cy-rm-nav a[aria-current]"), nav = sh.querySelector(".cy-rm-nav");
    if (on && nav) nav.scrollLeft += (on.getBoundingClientRect().left + on.offsetWidth / 2) - (nav.getBoundingClientRect().left + nav.clientWidth / 2);
    const box = sh.querySelector("#cy-rm"); box.innerHTML = body;
    sh.querySelector(".cy-st-scroll").scrollTop = 0;
    box.classList.remove("cy-st-in"); void box.offsetWidth; box.classList.add("cy-st-in");
    sh.querySelector("#cy-rm-h").focus({ preventScroll: true });
    return box;
  }
  const skel = (n) => `<div class="cy-rm-skel" aria-hidden="true">${"<i></i>".repeat(n)}</div>`;
  const fail = (box, e) => { box.innerHTML = `<section class="cy-rm-card cy-rm-err" role="alert"><b>${esc(T("تعذّر التحميل"))}</b><p>${esc(e?.message || T("تعذّر الاتصال بالخادم"))}</p></section>`; };
  const guest = (box) => { box.innerHTML = `<section class="cy-rm-card cy-rm-err"><b>${esc(T("سجّل الدخول"))}</b><p>${esc(T("ادخل بحسابك لترى رصيدك وحركاتك في مدينة المجتمع الرقمية."))}</p></section>`; };

  /* the gold number counts up once (reduced motion: shown at once) */
  function countUp(node, target) {
    const end = Number(target); if (!node || !isFinite(end) || reduced() || end === 0) return;
    const dec = (String(target).split(".")[1] || "").length, t0 = performance.now(), dur = 900;
    const tick = (t) => { const k = Math.min(1, (t - t0) / dur), v = end * (1 - Math.pow(1 - k, 3)); node.textContent = v.toFixed(Math.min(dec, 2)); if (k < 1 && node.isConnected) requestAnimationFrame(tick); else node.textContent = String(target); };
    requestAnimationFrame(tick);
  }
  const meter = (label, a, b) => { const pct = Math.max(0, Math.min(100, (Number(a) / (Number(b) || 1)) * 100)); return `<div class="cy-rm-meter"><span class="cy-rm-ml">${esc(label)}</span><span class="cy-rm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-label="${esc(label)}"><i data-pct="${pct.toFixed(1)}"></i></span><span class="cy-rm-mv">${num(a)} / ${num(b)} MJT</span></div>`; };
  const paintMeters = (box) => box.querySelectorAll(".cy-rm-bar i").forEach((i) => i.style.setProperty("--p", i.dataset.pct + "%"));

  /* ---------- الرصيد ---------- */
  async function balance(box) {
    let me; try { me = await api("GET", "/api/mjt/me"); } catch (e) { return fail(box, e); }
    if (!box.isConnected) return;
    box.innerHTML = `<section class="cy-rm-card cy-rm-hero" aria-labelledby="cy-bal-l">
        <span class="cy-rm-ring" aria-hidden="true"></span>
        <span class="cy-rm-lbl" id="cy-bal-l">${esc(T("رصيدك"))}</span>
        <p class="cy-rm-big"><bdi dir="ltr" class="cy-rm-n" data-count>${esc(me.balance.mjt)}</bdi> <small>MJT</small></p>
        <p class="cy-rm-note">${ic("lock", "xs")}<span>${esc(T("رصيد داخل التطبيق فقط — ليس عملة على أي بلوكشين، ولا يُسحب ولا يُباع."))}</span></p>
        ${meter(T("مكافآت اليوم"), me.today.earned, me.today.cap)}</section>
      ${me.frozen ? `<p class="cy-rm-card cy-rm-warn" role="status">${ic("lock", "xs")}<span>${esc(T("محفظتك موقوفة مؤقتاً للمراجعة: يمكنك الاستلام فقط."))}</span></p>` : ""}
      ${!me.verified ? `<p class="cy-rm-card cy-rm-warn" role="status">${ic("alert", "xs")}<span>${esc(T("نراجع رصيدك الآن. لا داعي لأي إجراء."))}</span></p>` : ""}
      <div class="cy-rm-tiles">
        <div class="cy-rm-tile"><span>${esc(T("أرسلت اليوم"))}</span><b>${num(me.today.sent)}</b><small>${esc(T("من"))} ${num(me.today.sendLimit)} MJT</small></div>
        <div class="cy-rm-tile"><span>${esc(T("استقبال التحويلات"))}</span><b>${esc(T(me.receive ? "مفعّل" : "متوقف"))}</b><small>${esc(T("من المحفظة تغيّره"))}</small></div></div>`;
    paintMeters(box); countUp(box.querySelector("[data-count]"), me.balance.mjt);
  }

  /* ---------- السجلات ---------- */
  async function history(box) {
    let d; try { d = await api("GET", "/api/mjt/history"); } catch (e) { return fail(box, e); }
    if (!box.isConnected) return;
    if (!d.items.length) { box.innerHTML = `<section class="cy-rm-card cy-rm-empty"><b>${esc(T("لا حركات بعد"))}</b><p>${esc(T("ادخل غرفة التعدين لتعرف كيف تكسب أول مجتمع كوين."))}</p><a class="cy-rm-btn" href="#/city/mjt/earn">${ic("sparkle", "xs")}${esc(T("التعدين"))}</a></section>`; return; }
    box.innerHTML = `<ul class="cy-rm-list" id="cy-hl"></ul><div class="cy-rm-more"><button type="button" class="cy-rm-btn ghost" id="cy-more">${esc(T("المزيد"))}</button></div>`;
    let next = d.next;
    const row = (i) => { const neg = String(i.amount).startsWith("-"); return `<li class="cy-rm-li ${neg ? "out" : "in"}"><span class="cy-rm-ico">${ic(KIND_ICO[i.kind] || "wallet", "xs")}</span><span class="cy-rm-t"><b>${esc(i.label)}${i.with ? ` · <bdi>${esc(i.with.name || "")}</bdi>` : ""}</b><small>${esc(day(i.createdAt))}${i.note ? ` · ${esc(i.note)}` : ""}</small></span><span class="cy-rm-amt">${num((neg ? "" : "+") + i.amount)}<small>${esc(T("الرصيد"))} ${num(i.balanceAfter)}</small></span></li>`; };
    const add = (items) => $("#cy-hl").insertAdjacentHTML("beforeend", items.map(row).join(""));
    const more = () => { if (!next) $("#cy-more")?.closest(".cy-rm-more")?.remove(); };
    add(d.items); more();
    $("#cy-more")?.addEventListener("click", (e) => busy(e.currentTarget, async () => { const r = await api("GET", "/api/mjt/history?cursor=" + enc(next)); next = r.next; add(r.items); more(); }));
  }

  /* ---------- المحفظة ---------- v2.86.1: a real wallet — the card with the live balance and the member's handle, «إرسال» and
   * «استقبال» tabs, recent people, a live recipient check, a big amount with quick amounts and «الأقصى», the day's limit as a
   * bar, an in-wallet review step (no browser confirm) and a success receipt. Same API and rules: /api/mjt/me, /config,
   * /history, /transfers (idempotency key per attempt), /receive; /api/users/:handle only to show who will receive. */
  const toNum = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const trim7 = (n) => { const s = Math.max(0, n).toFixed(7).replace(/\.?0+$/, ""); return s || "0"; };
  const normAmt = (v) => String(v || "").trim().replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/[٫,]/g, ".");
  const avatar = (u) => u && u.avatar ? `<img src="${esc(u.avatar)}" alt="" width="40" height="40" loading="lazy" decoding="async">` : `<span>${esc(((u && (u.name || u.handle)) || "?").trim().charAt(0).toUpperCase())}</span>`;
  async function send(box) {
    let me, cfg, hist;
    try { [me, cfg, hist] = await Promise.all([api("GET", "/api/mjt/me"), api("GET", "/api/mjt/config"), api("GET", "/api/mjt/history").catch(() => ({ items: [] }))]); } catch (e) { return fail(box, e); }
    if (!box.isConnected) return;
    const meU = (typeof S !== "undefined" && S.me && S.me()) || {};
    const handle = meU.handle || "";
    const off = !me.send.allowed, dis = off ? "disabled" : "";
    const bal = toNum(me.balance.mjt), left = Math.max(0, toNum(me.today.sendLimit) - toNum(me.today.sent)), single = toNum(cfg.transfers.maxSingle);
    const maxNow = Math.min(bal, left, single || Infinity);
    const usedPct = Math.max(0, Math.min(100, (toNum(me.today.sent) / (toNum(me.today.sendLimit) || 1)) * 100));
    const people = []; const seen = new Set();
    for (const i of (hist.items || [])) { const w = i.with; if (!w || !w.handle || seen.has(w.handle.toLowerCase()) || w.handle === handle) continue; seen.add(w.handle.toLowerCase()); people.push(w); if (people.length >= 6) break; }
    const quick = [1, 5, 10, 25].filter((q) => q <= maxNow);
    box.innerHTML = `
      <section class="cy-w-card" aria-labelledby="cy-w-l">
        <span class="cy-w-shine" aria-hidden="true"></span>
        <div class="cy-w-top"><span class="cy-w-brand">${ic("coin", "xs")}<b>${esc(T("مجتمع كوين"))}</b></span><span class="cy-w-chipc" aria-hidden="true"></span></div>
        <span class="cy-w-l" id="cy-w-l">${esc(T("رصيدك"))}</span>
        <p class="cy-w-bal"><bdi dir="ltr" class="cy-rm-n" data-count>${esc(me.balance.mjt)}</bdi><small>MJT</small></p>
        <div class="cy-w-foot"><bdi dir="ltr" class="cy-w-h">@${esc(handle)}</bdi><span class="cy-w-st ${me.receive ? "on" : ""}">${esc(T(me.receive ? "الاستقبال مفعّل" : "الاستقبال متوقف"))}</span></div>
      </section>
      <div class="cy-w-tabs" role="tablist" aria-label="${esc(T("المحفظة"))}">
        <button type="button" role="tab" id="cy-wt-s" aria-controls="cy-wp-s" aria-selected="true" class="on">${svgI("up")}<span>${esc(T("إرسال"))}</span></button>
        <button type="button" role="tab" id="cy-wt-r" aria-controls="cy-wp-r" aria-selected="false" tabindex="-1">${svgI("down")}<span>${esc(T("استقبال"))}</span></button>
      </div>
      <section class="cy-w-pane" id="cy-wp-s" role="tabpanel" aria-labelledby="cy-wt-s">
        ${off ? `<p class="cy-rm-warn">${ic("lock", "xs")}<span>${esc(me.send.note)}</span></p>` : ""}
        <form class="cy-w-form" id="cy-sf" novalidate>
          ${people.length ? `<div class="cy-w-ppl"><span class="cy-w-k">${esc(T("أرسلت إليهم مؤخراً"))}</span><ul>${people.map((u) => `<li><button type="button" class="cy-w-p" data-h="${esc(u.handle)}" ${dis}><span class="cy-w-av">${avatar(u)}</span><small>${esc(u.name || "@" + u.handle)}</small></button></li>`).join("")}</ul></div>` : ""}
          <label class="cy-w-f"><span class="cy-w-k">${esc(T("إلى"))}</span><span class="cy-w-in"><b aria-hidden="true">@</b><input name="to" required autocomplete="off" autocapitalize="off" spellcheck="false" dir="ltr" placeholder="handle" maxlength="60" ${dis}></span></label>
          <div class="cy-w-who" id="cy-who" aria-live="polite"></div>
          <label class="cy-w-f cy-w-amtf"><span class="cy-w-k">${esc(T("المبلغ (MJT)"))}</span>
            <span class="cy-w-amt"><input name="amount" required inputmode="decimal" dir="ltr" autocomplete="off" placeholder="0" maxlength="17" ${dis}><small>MJT</small></span></label>
          <div class="cy-w-q" role="group" aria-label="${esc(T("مبالغ سريعة"))}">${quick.map((q) => `<button type="button" data-q="${q}" ${dis}>${num(q)}</button>`).join("")}<button type="button" data-q="max" ${dis || (maxNow <= 0 ? "disabled" : "")}>${esc(T("الأقصى"))}</button></div>
          <label class="cy-w-f"><span class="cy-w-k">${esc(T("ملاحظة"))} <small>${esc(T("(اختياري)"))}</small></span><span class="cy-w-in"><input name="note" maxlength="140" ${dis}></span></label>
          <div class="cy-w-lim"><div class="cy-w-limt"><span>${esc(T("حد اليوم"))}</span><span>${num(me.today.sent)} / ${num(me.today.sendLimit)} MJT</span></div>
            <span class="cy-rm-bar" role="progressbar" aria-label="${esc(T("أرسلت اليوم"))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usedPct.toFixed(0)}"><i data-pct="${usedPct.toFixed(1)}"></i></span>
            <small>${esc(T("حد التحويل الواحد"))} ${num(cfg.transfers.maxSingle)} MJT · ${esc(T("التحويل نهائي ولا يُسترد."))}</small></div>
          <p class="cy-rm-ferr" id="cy-err" role="alert" hidden></p>
          <button class="cy-w-go" type="submit" ${dis}>${esc(T("مراجعة التحويل"))}</button>
        </form>
        <div class="cy-w-rev" id="cy-rev" hidden></div>
      </section>
      <section class="cy-w-pane" id="cy-wp-r" role="tabpanel" aria-labelledby="cy-wt-r" hidden>
        <div class="cy-w-recv">
          <div class="cy-w-qr" id="cy-qr" aria-hidden="true"></div>
          <p class="cy-w-k">${esc(T("اسم المستخدم الذي يرسلون إليه"))}</p>
          <p class="cy-w-me"><bdi dir="ltr">@${esc(handle)}</bdi><button type="button" class="cy-w-copy" id="cy-copy" aria-label="${esc(T("نسخ"))}">${svgI("copy")}</button></p>
        </div>
        <label class="cy-rm-sw"><span><b>${esc(T("استقبال التحويلات"))}</b><small>${esc(T("عند الإيقاف لا يستطيع أحد إرسال مجتمع كوين إليك"))}</small></span><input type="checkbox" role="switch" id="cy-rcv" ${me.receive ? "checked" : ""}></label>
      </section>`;
    paintMeters(box); countUp(box.querySelector("[data-count]"), me.balance.mjt);
    // tabs (arrow keys move between them)
    const tabs = [...box.querySelectorAll('.cy-w-tabs [role="tab"]')];
    const pick = (t) => { tabs.forEach((x) => { const on = x === t; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); x.tabIndex = on ? 0 : -1; box.querySelector("#" + x.getAttribute("aria-controls")).hidden = !on; }); if (t.id === "cy-wt-r") qr(); };
    tabs.forEach((t, i) => { t.addEventListener("click", () => pick(t)); t.addEventListener("keydown", (e) => { if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return; e.preventDefault(); const n = tabs[(i + 1) % tabs.length]; pick(n); n.focus(); }); });
    let qrDone = false;
    function qr() {
      if (qrDone || !handle) return; qrDone = true;
      const host = box.querySelector("#cy-qr");
      const load = () => (window.qrcode ? Promise.resolve() : new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "vendor/qrcode.js"; sc.onload = ok; sc.onerror = no; document.head.append(sc); }));
      load().then(() => { const q = qrcode(0, "M"); q.addData("mjt:@" + handle); q.make(); host.innerHTML = q.createSvgTag({ cellSize: 5, margin: 1, scalable: true }); }).catch(() => host.remove());
    }
    box.querySelector("#cy-copy").addEventListener("click", async (e) => { try { await navigator.clipboard.writeText("@" + handle); e.currentTarget.innerHTML = svgI("check"); say(T("نُسخ")); } catch { say("@" + handle); } });
    box.querySelector("#cy-rcv").addEventListener("change", (e) => busy(null, async () => { const r = await api("PUT", "/api/mjt/receive", { receive: e.target.checked }); const st = box.querySelector(".cy-w-st"); st.classList.toggle("on", r.receive); st.textContent = T(r.receive ? "الاستقبال مفعّل" : "الاستقبال متوقف"); say(T(r.receive ? "سيصلك ما يرسله الأعضاء" : "أوقفت استقبال التحويلات")); }));

    const f = box.querySelector("#cy-sf"), err = box.querySelector("#cy-err"), who = box.querySelector("#cy-who"), rev = box.querySelector("#cy-rev");
    let ikey = newKey(), found = null, look = 0, tmr = 0;
    const showErr = (m, el) => { err.textContent = m; err.hidden = false; if (el) el.focus(); };
    function check() {
      const h = f.to.value.trim().replace(/^@/, ""); found = null; clearTimeout(tmr);
      if (!h) { who.innerHTML = ""; return; }
      const n = ++look; who.innerHTML = `<span class="cy-w-wait">${esc(T("جارٍ البحث…"))}</span>`;
      tmr = setTimeout(() => api("GET", "/api/users/" + enc(h)).then((r) => { if (n !== look) return; const u = r.user || r; found = u; who.innerHTML = `<span class="cy-w-av">${avatar(u)}</span><span><b>${esc(u.name || u.handle)}</b><bdi dir="ltr">@${esc(u.handle)}</bdi></span>${svgI("check")}`; who.className = "cy-w-who ok"; },
        () => { if (n !== look) return; who.className = "cy-w-who no"; who.innerHTML = `<span>${esc(T("لا يوجد عضو بهذا الاسم"))}</span>`; }), 350);
    }
    f.to.addEventListener("input", () => { who.className = "cy-w-who"; check(); });
    f.addEventListener("input", () => { ikey = newKey(); err.hidden = true; });
    box.querySelectorAll(".cy-w-p").forEach((b) => b.addEventListener("click", () => { f.to.value = b.dataset.h; box.querySelectorAll(".cy-w-p").forEach((x) => x.classList.toggle("on", x === b)); check(); f.amount.focus(); }));
    box.querySelectorAll(".cy-w-q button").forEach((b) => b.addEventListener("click", () => { f.amount.value = b.dataset.q === "max" ? trim7(maxNow) : b.dataset.q; ikey = newKey(); err.hidden = true; box.querySelectorAll(".cy-w-q button").forEach((x) => x.classList.toggle("on", x === b)); }));

    f.addEventListener("submit", (e) => {
      e.preventDefault(); err.hidden = true;
      const to = f.to.value.trim().replace(/^@/, ""), amount = normAmt(f.amount.value);
      if (!to) return showErr(T("اكتب اسم المستخدم"), f.to);
      if (to.toLowerCase() === handle.toLowerCase()) return showErr(T("لا يمكنك الإرسال إلى نفسك"), f.to);
      if (!/^\d{1,8}(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) return showErr(T("اكتب مبلغاً صحيحاً (حتى ٧ منازل عشرية)"), f.amount);
      if (Number(amount) > bal) return showErr(T("المبلغ أكبر من رصيدك"), f.amount);
      const note = f.note.value.trim();
      const u = found && String(found.handle).toLowerCase() === to.toLowerCase() ? found : { handle: to };
      f.hidden = true; rev.hidden = false;
      rev.innerHTML = `<h3 class="cy-w-rh" tabindex="-1">${esc(T("مراجعة التحويل"))}</h3>
        <div class="cy-w-rto"><span class="cy-w-av lg">${avatar(u)}</span><b>${esc(u.name || "@" + u.handle)}</b><bdi dir="ltr">@${esc(u.handle)}</bdi></div>
        <p class="cy-w-ramt"><bdi dir="ltr" class="cy-rm-n">${esc(amount)}</bdi><small>MJT</small></p>
        <dl class="cy-w-rdl"><div><dt>${esc(T("رصيدك بعد التحويل"))}</dt><dd>${num(trim7(bal - Number(amount)))} MJT</dd></div>${note ? `<div><dt>${esc(T("ملاحظة"))}</dt><dd>${esc(note)}</dd></div>` : ""}</dl>
        <p class="cy-w-final">${svgI("shield")}<span>${esc(T("التحويل نهائي ولا يُسترد."))}</span></p>
        <div class="cy-w-ract"><button type="button" class="cy-w-back" data-a="edit">${esc(T("تعديل"))}</button><button type="button" class="cy-w-go" data-a="ok">${esc(T("تأكيد الإرسال"))}</button></div>`;
      rev.querySelector(".cy-w-rh").focus({ preventScroll: true });
      rev.querySelector('[data-a="edit"]').addEventListener("click", () => { rev.hidden = true; f.hidden = false; f.amount.focus(); });
      rev.querySelector('[data-a="ok"]').addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
        try {
          const r = await api("POST", "/api/mjt/transfers", { to, amount, note: note || undefined, ikey });
          ikey = newKey(); Sound();
          rev.innerHTML = `<div class="cy-w-done" role="status"><span class="cy-w-tick">${svgI("check")}</span><h3 tabindex="-1">${esc(T("تم الإرسال"))}</h3>
            <p class="cy-w-ramt"><bdi dir="ltr" class="cy-rm-n">${esc(r.transfer.amount)}</bdi><small>MJT</small></p><p>${esc(T("إلى"))} <b>${esc(r.transfer.to?.name || "@" + to)}</b></p>
            <div class="cy-w-ract"><a class="cy-w-back" href="#/city/mjt/history">${esc(T("السجلات"))}</a><button type="button" class="cy-w-go" data-a="again">${esc(T("تحويل آخر"))}</button></div></div>`;
          rev.querySelector("h3").focus({ preventScroll: true });
          rev.querySelector('[data-a="again"]').addEventListener("click", () => send(box));
        } catch (x) { rev.hidden = true; f.hidden = false; showErr(x.message); }
      }));
    });
    function Sound() { try { MPCity.sound && MPCity.sound.coin && MPCity.sound.coin(); } catch { /* sound is optional */ } }
  }

  /* ---------- التعدين ---------- */
  async function earn(box) {
    let me, cfg; try { [me, cfg] = await Promise.all([api("GET", "/api/mjt/me"), api("GET", "/api/mjt/config")]); } catch (e) { return fail(box, e); }
    if (!box.isConnected) return;
    const pct = Math.max(0, Math.min(100, (Number(me.today.earned) / (Number(me.today.cap) || 1)) * 100));
    box.innerHTML = `<section class="cy-rm-card cy-rm-mine" aria-labelledby="cy-mine-l">
        <div class="cy-rm-core" aria-hidden="true"><span class="cy-rm-orbit o1"></span><span class="cy-rm-orbit o2"></span><span class="cy-rm-gauge"></span><span class="cy-rm-coin">${ic("coin")}</span></div>
        <p class="cy-rm-lbl" id="cy-mine-l">${esc(T("تعدين اليوم"))}</p>
        <p class="cy-rm-big"><bdi dir="ltr" class="cy-rm-n" data-count>${esc(me.today.earned)}</bdi> <small>/ ${num(me.today.cap)} MJT</small></p>
        <p class="cy-rm-note">${esc(cfg.earn.enabled ? T("كل مساهمة مفيدة تُعدِّن لك مجتمع كوين") : T("المكافآت متوقفة مؤقتاً."))}</p></section>
      <section class="cy-rm-card"><h3 class="cy-rm-h3">${ic("award", "xs")}${esc(T("ما يُعدِّن لك"))}</h3>
        <ul class="cy-rm-list kinds">${cfg.earn.kinds.map((k) => `<li class="cy-rm-li"><span class="cy-rm-t"><b>${esc(k.label)}</b>${k.dailyCap != null ? `<small>${esc(T("حتى"))} ${num(k.dailyCap)} ${esc(T("مرات يومياً"))}</small>` : ""}</span><span class="cy-rm-amt in">${num("+" + k.mjt)}<small>MJT</small></span></li>`).join("")}</ul>
        <p class="cy-rm-hint">${esc(cfg.rate.text)} · ${esc(T("بحد أقصى"))} ${num(cfg.earn.dailyCap)} MJT ${esc(T("يومياً"))}</p></section>`;
    box.querySelector(".cy-rm-gauge").style.setProperty("--p", pct.toFixed(1) + "%");
    countUp(box.querySelector("[data-count]"), me.today.earned);
  }

  /* ---------- الإحصاءات ---------- */
  async function stats(box) {
    let me, d; try { [me, d] = await Promise.all([api("GET", "/api/mjt/me"), api("GET", "/api/mjt/history")]); } catch (e) { return fail(box, e); }
    if (!box.isConnected) return;
    let inn = 0, out = 0; const by = {};
    for (const i of d.items) { const v = Number(i.amount) || 0; if (v < 0) out += -v; else inn += v; const k = i.label || i.kind; by[k] = (by[k] || 0) + Math.abs(v); }
    const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5), max = top.length ? top[0][1] : 1;
    const fmt = (v) => String(Math.round(v * 100) / 100);
    box.innerHTML = `<div class="cy-rm-tiles three">
        <div class="cy-rm-tile"><span>${esc(T("الرصيد"))}</span><b>${num(me.balance.mjt)}</b><small>MJT</small></div>
        <div class="cy-rm-tile in"><span>${esc(T("دخل"))}</span><b>${num("+" + fmt(inn))}</b><small>${esc(T("آخر الحركات"))}</small></div>
        <div class="cy-rm-tile out"><span>${esc(T("خرج"))}</span><b>${num("-" + fmt(out))}</b><small>${esc(T("آخر الحركات"))}</small></div></div>
      <section class="cy-rm-card">${meter(T("مكافآت اليوم"), me.today.earned, me.today.cap)}${meter(T("أرسلت اليوم"), me.today.sent, me.today.sendLimit)}</section>
      <section class="cy-rm-card"><h3 class="cy-rm-h3">${ic("chart", "xs")}${esc(T("من أين جاء رصيدك"))}</h3>
        ${top.length ? `<ul class="cy-rm-bars">${top.map(([k, v]) => `<li><span>${esc(k)}</span><i data-pct="${((v / max) * 100).toFixed(1)}"></i>${num(fmt(v))}</li>`).join("")}</ul>` : `<p class="cy-rm-hint">${esc(T("لا حركات بعد"))}</p>`}</section>`;
    paintMeters(box); box.querySelectorAll(".cy-rm-bars i").forEach((i) => i.style.setProperty("--p", i.dataset.pct + "%"));
  }

  const VIEWS = { balance, history, send, earn, stats };
  MPCity.room = (id) => {
    if (!VIEWS[id]) return false;
    const box = shell(id, skel(3));
    if (!signed()) { guest(box); return true; }
    VIEWS[id](box);
    return true;
  };
})();
