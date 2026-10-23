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

  function shell(id, body) {
    const r = ROOMS[id];
    view.innerHTML = `<div class="wrap cy-page cy-room" data-room="${id}">
      ${UI.pageHead({ back: ["#/city/mjt", T("قاعة مجتمع كوين")], title: T(r.t), id: "cy-rm-h" })}
      ${strip(id)}<div class="cy-rm-body" id="cy-rm">${body}</div></div>`;
    const room = $(".cy-room"); room.style.setProperty("--cy-acc", r.acc);
    const pal = ((window.MPCityScenes || {}).mjt || {}).palette || {}; for (const k in pal) room.style.setProperty(k, pal[k]);
    view.querySelectorAll(".cy-rm-nav a").forEach((a) => a.style.setProperty("--cy-acc", a.dataset.acc));
    const on = view.querySelector(".cy-rm-nav a[aria-current]"), nav = view.querySelector(".cy-rm-nav");
    if (on && nav) nav.scrollLeft += (on.getBoundingClientRect().left + on.offsetWidth / 2) - (nav.getBoundingClientRect().left + nav.clientWidth / 2); // the current room's chip, centred
    $("#cy-rm-h")?.focus({ preventScroll: true });
    return $("#cy-rm");
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

  /* ---------- المحفظة (send) ---------- */
  async function send(box) {
    let me, cfg; try { [me, cfg] = await Promise.all([api("GET", "/api/mjt/me"), api("GET", "/api/mjt/config")]); } catch (e) { return fail(box, e); }
    if (!box.isConnected) return;
    const off = !me.send.allowed, dis = off ? "disabled" : "";
    box.innerHTML = `<section class="cy-rm-card"><h3 class="cy-rm-h3">${ic("send", "xs")}${esc(T("إرسال إلى عضو"))}</h3>
        ${off ? `<p class="cy-rm-warn">${ic("lock", "xs")}<span>${esc(me.send.note)}</span></p>` : ""}
        <form class="cy-rm-form" id="cy-sf" novalidate>
          <label>${esc(T("إلى"))}<input name="to" required autocomplete="off" dir="ltr" placeholder="@handle" maxlength="60" ${dis}></label>
          <label>${esc(T("المبلغ (MJT)"))}<input name="amount" required inputmode="decimal" dir="ltr" autocomplete="off" placeholder="0" maxlength="17" ${dis}></label>
          <label>${esc(T("ملاحظة"))} <small>${esc(T("(اختياري)"))}</small><input name="note" maxlength="140" ${dis}></label>
          <p class="cy-rm-ferr" id="cy-err" role="alert" hidden></p>
          <p class="cy-rm-hint">${esc(T("رصيدك"))} ${num(me.balance.mjt)} MJT · ${esc(T("أرسلت اليوم"))} ${num(me.today.sent)} ${esc(T("من"))} ${num(me.today.sendLimit)} MJT · ${esc(T("حد التحويل الواحد"))} ${num(cfg.transfers.maxSingle)} MJT. ${esc(T("التحويل نهائي ولا يُسترد."))}</p>
          <button class="cy-rm-btn" type="submit" ${dis}>${ic("send", "xs")}${esc(T("إرسال"))}</button></form></section>
      <section class="cy-rm-card"><label class="cy-rm-sw"><span><b>${esc(T("استقبال التحويلات"))}</b><small>${esc(T("عند الإيقاف لا يستطيع أحد إرسال مجتمع كوين إليك"))}</small></span><input type="checkbox" role="switch" id="cy-rcv" ${me.receive ? "checked" : ""}></label></section>`;
    const f = $("#cy-sf"), err = $("#cy-err");
    let ikey = newKey();
    f.addEventListener("input", () => { ikey = newKey(); err.hidden = true; });
    f.addEventListener("submit", (e) => {
      e.preventDefault(); err.hidden = true;
      const to = f.to.value.trim().replace(/^@/, ""), amount = f.amount.value.trim().replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace("٫", ".");
      if (!to || !/^\d{1,8}(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) { err.textContent = T(!to ? "اكتب اسم المستخدم" : "اكتب مبلغاً صحيحاً (حتى ٧ منازل عشرية)"); err.hidden = false; (to ? f.amount : f.to).focus(); return; }
      if (!confirm(`${T("إرسال")} ${amount} MJT → @${to}? ${T("لا يمكن التراجع.")}`)) return;
      busy(e.submitter, async () => {
        try {
          const r = await api("POST", "/api/mjt/transfers", { to, amount, note: f.note.value.trim() || undefined, ikey });
          ikey = newKey(); say(`${T("أُرسل")} ${r.transfer.amount} MJT → ${r.transfer.to?.name || "@" + to}`); location.hash = "#/city/mjt/history";
        } catch (x) { err.textContent = x.message; err.hidden = false; }
      });
    });
    $("#cy-rcv").addEventListener("change", (e) => busy(null, async () => { const r = await api("PUT", "/api/mjt/receive", { receive: e.target.checked }); say(T(r.receive ? "سيصلك ما يرسله الأعضاء" : "أوقفت استقبال التحويلات")); }));
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
