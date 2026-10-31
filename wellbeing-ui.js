/* Digital wellbeing «الرفاهية الرقمية» (phase 45). Lazy chunk `wellbeing`, loaded right after first paint. Free for everyone.
 * • Usage time is measured HERE, on the device (localStorage "mp.wb.u": seconds + sessions per local day, 35 days kept).
 *   Active time = tab visible AND an interaction in the last 60 s. A gap of 5 min starts a new session.
 * • Break reminder after N minutes of continuous use; daily-limit notice once a day.
 * • Hide counts (likes/comments/reposts/views, profile followers): body[data-wb-hide] + CSS below.
 * • Focus mode (body[data-wb-focus]): no infinite scroll (explicit «عرض المزيد»), no suggestion/trend cards, no badges,
 *   counts hidden, no motion; posts after the caught-up marker are folded into «أنت مطّلع على كل شيء».
 * • Weekly report: computed locally; only when the user opts in (shareTotals) are weekly TOTALS posted to /api/wellbeing/weekly,
 *   which lets the server send the in-app report (and email when SMTP is configured and chosen).
 * • #/wellbeing screen + a card in #/settings. No inline handlers. */
(function WellbeingUI() {
  const UK = "mp.wb.u", SK = "mp.wb.s", TICK = 5, IDLE = 60e3, GAP = 5 * 60e3, KEEP = 35;
  const online = () => typeof Remote !== "undefined" && Remote.on && typeof DB !== "undefined" && DB.me;
  const api = (m, p, b) => Remote.api(m, p, b);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const T = (s) => (window.MPI18n ? window.MPI18n.t(s) : s);
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full / private mode */ } };
  const DEF = { breakMinutes: 0, dailyLimitMinutes: 0, hideCounts: false, focus: false, weeklyReport: true, shareTotals: false, emailReport: false };
  let S = { ...DEF, ...read(SK, {}) }, U = read(UK, { d: {}, n: {}, sent: {}, rep: null, lim: null }), cfg = null;

  /* ---------- dates (local) ---------- */
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekOf = (key) => { const [y, m, dd] = key.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, dd)), w = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - w); const yy = t.getUTCFullYear(); return `${yy}-W${String(Math.ceil(((t - Date.UTC(yy, 0, 1)) / 864e5 + 1) / 7)).padStart(2, "0")}`; };
  const daysBack = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayKey(d); };
  const fmt = (sec) => { const m = Math.round((sec || 0) / 60), h = Math.floor(m / 60); return h ? `${h} س ${m % 60} د` : `${m} د`; };
  function weeks() { // ISO week → { seconds, sessions, days }
    const w = {};
    for (const [k, s] of Object.entries(U.d)) { const id = weekOf(k), x = (w[id] ||= { week: id, seconds: 0, sessions: 0, days: 0 }); x.seconds += Math.round(s); x.sessions += U.n[k] || 0; if (s > 0) x.days++; }
    return w;
  }

  /* ---------- style (kept in the chunk: zero bytes in the core CSS budget) ---------- */
  const st = document.createElement("style");
  const H = 'body[data-wb-hide="1"]', F = 'body[data-wb-focus="1"]';
  st.textContent = `${[H, F].map((b) => `${b} .actions .a-like>span:last-child,${b} .actions .a-com>span,${b} .actions .a-rep>span,${b} .actions .views,${b} .stats a[href*="/follows/"] b`).join(",")}{display:none}
${F} #more-sentinel,${F} .wrap>.card.discover,${F} #notifBadge,${F} #msgBadge,${F} .d-digest{display:none!important}
${F} *{animation:none!important;transition:none!important;scroll-behavior:auto!important}
.wb-fold{display:none!important}
.wb-calm{display:flex;align-items:center;gap:8px;justify-content:space-between;font-size:var(--fs-sm);color:var(--muted)}
.wb-more{display:block;width:100%;margin:8px 0 18px}
.wb-cu{text-align:center;padding:28px 16px}.wb-ic{color:var(--accent);line-height:1}.wb-ic .ic{width:44px;height:44px}.wb-h{margin:0 0 6px;font-size:var(--fs-md);color:var(--muted)}.wb-big{font-size:var(--fs-3xl);font-weight:800;font-variant-numeric:tabular-nums}.wb-diff{display:flex;align-items:center;gap:8px;margin:8px 0 0;color:var(--muted);font-size:var(--fs-sm)}.wb-clear{margin-top:var(--s3);color:var(--danger)}.wb-cu h3{margin:10px 0 6px}
.wb-bars{display:flex;align-items:flex-end;gap:6px;height:120px;margin:10px 0 4px}.wb-bars div{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;height:100%;font-size:11px;color:var(--muted)}
.wb-bars i{display:block;width:100%;border-radius:6px 6px 2px 2px;background:var(--accent);min-height:2px}.wb-bars .t i{background:var(--ok,#0d7a55)}
.wb-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.wb-row:last-child{border:0}.wb-row small{display:block;font-size:var(--fs-xs);font-weight:400}
.wb-meter{height:8px;border-radius:4px;background:var(--line);overflow:hidden;margin-top:6px}.wb-meter i{display:block;height:100%;background:var(--accent)}
.wb-dlg{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);padding:16px}
.wb-dlg>div{background:var(--card);color:inherit;border-radius:18px;max-width:360px;width:100%;padding:22px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.25)}
.wb-dlg .btn{margin:6px 4px 0}`;
  document.head.appendChild(st);

  /* ---------- apply settings to the page ---------- */
  function apply() {
    const b = document.body; if (!b) return;
    S.hideCounts ? (b.dataset.wbHide = "1") : delete b.dataset.wbHide;
    S.focus ? (b.dataset.wbFocus = "1") : delete b.dataset.wbFocus;
  }
  async function save(patch) {
    const prev = S; S = { ...S, ...patch }; write(SK, S); apply();
    if (online()) {
      try { const r = await api("PUT", "/api/wellbeing/settings", patch); if (r?.settings) { S = { ...DEF, ...r.settings }; write(SK, S); apply(); } }
      catch (e) { S = prev; write(SK, S); apply(); throw e; }
    }
    if (patch.shareTotals) { U.sent = {}; write(UK, U); upload(true); }
    if (patch.shareTotals === false) { U.sent = {}; write(UK, U); }
  }
  async function pull() {
    if (!online()) return;
    try {
      const [r, c] = await Promise.all([api("GET", "/api/wellbeing/settings"), api("GET", "/api/wellbeing/config")]);
      cfg = c || null; if (r?.settings) { S = { ...DEF, ...r.settings }; write(SK, S); apply(); }
    } catch { /* keep the local copy */ }
  }

  /* ---------- tracker (device only) ---------- */
  let lastAct = Date.now(), lastTick = 0, cont = 0, snooze = 0, dlg = null;
  const act = () => { lastAct = Date.now(); };
  ["pointerdown", "keydown", "scroll", "touchstart", "wheel"].forEach((e) => addEventListener(e, act, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") act(); });
  function tick() {
    const t = Date.now();
    if (document.visibilityState !== "visible" || t - lastAct > IDLE) return;
    const k = dayKey();
    if (!lastTick || t - lastTick > GAP) { U.n[k] = (U.n[k] || 0) + 1; cont = 0; } // a new session
    lastTick = t; cont += TICK;
    U.d[k] = (U.d[k] || 0) + TICK;
    const keys = Object.keys(U.d).sort(); while (keys.length > KEEP) { const o = keys.shift(); delete U.d[o]; delete U.n[o]; }
    write(UK, U);
    if (S.breakMinutes && cont >= S.breakMinutes * 60 && t > snooze && !dlg) breakDlg();
    if (S.dailyLimitMinutes && U.d[k] >= S.dailyLimitMinutes * 60 && U.lim !== k && !dlg) { U.lim = k; write(UK, U); limitDlg(); }
  }
  setInterval(tick, TICK * 1000);

  function modal(html, wire) {
    dlg = document.createElement("div"); dlg.className = "wb-dlg"; dlg.setAttribute("role", "alertdialog"); dlg.setAttribute("aria-modal", "true");
    dlg.innerHTML = `<div>${html}</div>`; document.body.appendChild(dlg);
    const close = () => { dlg?.remove(); dlg = null; };
    wire(dlg, close); dlg.querySelector("button")?.focus();
    window.MPI18n?.apply(dlg);
  }
  function breakDlg() {
    modal(`<div class="wb-ic" aria-hidden="true">${UI.icon("heart")}</div><h3 id="wb-dt">${esc(T("وقت استراحة قصيرة"))}</h3><p class="muted">${esc(T("أنت تتصفح منذ"))} ${esc(fmt(cont))}. ${esc(T("قف، تمدّد، واشرب ماءً ثم عد إن شئت."))}</p>
      <button class="btn" data-wb="ok">${esc(T("حسناً، سآخذ استراحة"))}</button><button class="btn ghost" data-wb="snooze">${esc(T("ذكّرني بعد 5 دقائق"))}</button>`, (d, close) => {
      d.setAttribute("aria-labelledby", "wb-dt");
      d.querySelector('[data-wb="ok"]').addEventListener("click", () => { cont = 0; close(); });
      d.querySelector('[data-wb="snooze"]').addEventListener("click", () => { snooze = Date.now() + 5 * 60e3; close(); });
    });
  }
  function limitDlg() {
    modal(`<div class="wb-ic" aria-hidden="true">${window.MPFeat ? MPFeat.ico("clock") : UI.icon("bell")}</div><h3 id="wb-dt">${esc(T("بلغت حدّك اليومي"))}</h3><p class="muted">${esc(T("استخدمت مجتمع بلس اليوم"))} ${esc(fmt(U.d[dayKey()]))} ${esc(T("من أصل"))} ${esc(fmt(S.dailyLimitMinutes * 60))}.</p>
      <button class="btn" data-wb="ok">${esc(T("حسناً"))}</button><a class="btn ghost" href="#/wellbeing" data-wb="go">${esc(T("إحصاءاتي"))}</a>`, (d, close) => {
      d.setAttribute("aria-labelledby", "wb-dt");
      d.querySelectorAll("[data-wb]").forEach((b) => b.addEventListener("click", close));
    });
  }

  /* ---------- weekly report ---------- */
  let lastUp = 0;
  async function upload(force) { // opt-in only: finished weeks once (unless changed) + the running week
    if (!S.shareTotals || !online() || (!force && Date.now() - lastUp < 6 * 3600e3)) return;
    lastUp = Date.now();
    const cur = weekOf(dayKey()), list = Object.values(weeks()).filter((w) => w.week === cur || U.sent[w.week] !== w.seconds).sort((a, b) => (a.week < b.week ? 1 : -1)).slice(0, 8);
    if (!list.length) return;
    try { await api("POST", "/api/wellbeing/weekly", { weeks: list }); list.forEach((w) => { U.sent[w.week] = w.seconds; }); write(UK, U); } catch { /* retried on the next load */ }
  }
  function localReport() { // shown once per new week when the totals stay on the device (the server sends it otherwise)
    const prev = weekOf(daysBack(7)), w = weeks()[prev];
    if (!S.weeklyReport || S.shareTotals || !w || !w.seconds || U.rep === prev || typeof toast !== "function") return;
    U.rep = prev; write(UK, U);
    setTimeout(() => toast(`${T("تقرير أسبوعك")}: ${fmt(w.seconds)} · ${w.days} ${T("أيام")} — #/wellbeing`), 1500);
  }

  /* ---------- Home: focus mode + «أنت مطّلع على كل شيء» ---------- */
  const cuHTML = (older) => `<div class="card wb-cu" role="status" id="wb-cu"><div class="wb-ic" aria-hidden="true">${UI.icon("check")}</div><h3>${esc(T("أنت مطّلع على كل شيء"))}</h3>
    <p class="muted">${esc(T(older ? "شاهدت كل الجديد منذ زيارتك السابقة." : "لا جديد الآن. عُد لاحقاً، وخذ وقتك."))}</p>
    ${older ? `<button class="btn ghost" id="wb-older">${esc(T("عرض المنشورات الأقدم"))}</button> ` : ""}<a class="btn ghost" href="#/wellbeing">${esc(T("وقتي على مجتمع بلس"))}</a></div>`;
  function enhanceHome() {
    if (!/^(#\/?(home)?)?$/.test(location.hash.split("?")[0])) return;
    const wrap = typeof view !== "undefined" && view?.querySelector(".wrap"); if (!wrap || wrap.dataset.wb) return;
    wrap.dataset.wb = "1";
    const end = wrap.lastElementChild;
    if (end?.classList.contains("empty") && wrap.querySelector(".post-card")) end.outerHTML = cuHTML(false); // end of the feed
    if (!S.focus) return;
    wrap.querySelector(".tabs")?.insertAdjacentHTML("afterend", `<div class="wb-calm" id="wb-calm"><span>${UI.icon("heart","sm")} ${esc(T("وضع التركيز مفعّل: لا تمرير لا نهائي ولا أعداد"))}</span><button class="btn ghost" id="wb-unfocus">${esc(T("إيقاف"))}</button></div>`);
    wrap.querySelector("#wb-unfocus")?.addEventListener("click", () => save({ focus: false }).then(() => typeof rerender === "function" && rerender()).catch(() => { }));
    const sen = wrap.querySelector("#more-sentinel");
    if (sen) { sen.insertAdjacentHTML("afterend", `<button class="btn ghost wb-more" id="wb-more">${esc(T("عرض 10 منشورات أخرى"))}</button>`); wrap.querySelector("#wb-more").addEventListener("click", () => { feedLimit += 10; const y = scrollY; rerender(); scrollTo(0, y); }); }
    const mark = wrap.querySelector(".d-caught"); // phase 13 caught-up marker
    if (mark && !wrap.dataset.wbOlder) {
      const rest = []; for (let e = mark.nextElementSibling; e; e = e.nextElementSibling) rest.push(e);
      rest.forEach((e) => e.classList.add("wb-fold"));
      mark.classList.add("wb-fold"); mark.insertAdjacentHTML("afterend", cuHTML(true));
      wrap.querySelector("#wb-older")?.addEventListener("click", () => { wrap.dataset.wbOlder = "1"; wrap.querySelectorAll(".wb-fold").forEach((e) => e.classList.remove("wb-fold")); wrap.querySelector("#wb-cu")?.remove(); });
    }
    window.MPI18n?.apply(wrap);
  }
  if (typeof HomeHooks !== "undefined") HomeHooks.after("wellbeing", 50, enhanceHome);

  /* ---------- #/wellbeing ---------- */
  const tog = (id, on, label, hint) => `<label class="wb-row" for="${id}"><span><b>${esc(T(label))}</b>${hint ? `<small class="muted">${esc(T(hint))}</small>` : ""}</span><input type="checkbox" class="switch" id="${id}" ${on ? "checked" : ""}></label>`;
  const sel = (id, v, opts, label) => `<label class="wb-row" for="${id}"><b>${esc(T(label))}</b><select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(T(l))}</option>`).join("")}</select></label>`;
  function screen() {
    const k = dayKey(), today = U.d[k] || 0, W = weeks(), cur = W[weekOf(k)] || { seconds: 0, days: 0, sessions: 0 }, prev = W[weekOf(daysBack(7))] || { seconds: 0, days: 0, sessions: 0 };
    const days = Array.from({ length: 7 }, (_, i) => daysBack(6 - i)), max = Math.max(60, ...days.map((d) => U.d[d] || 0));
    const dn = (d) => new Date(d + "T12:00:00").toLocaleDateString("ar", { weekday: "short" });
    const diff = prev.seconds ? Math.round(((cur.seconds - prev.seconds) / prev.seconds) * 100) : null;
    const lim = S.dailyLimitMinutes * 60;
    const email = (cfg?.email) && S.shareTotals;
    view.innerHTML = `<div class="wrap">${UI.pageHead({ back: ["#/settings", T("الإعدادات")], title: T("الرفاهية الرقمية"), icon: "heart" })}
      <div class="notice">${UI.icon("lock", "sm")}<span>${esc(T("يُحسب وقت استخدامك على هذا الجهاز فقط ولا يُرسل إلى الخادم."))}</span></div>
      <section class="card" aria-labelledby="wb-h1"><h3 id="wb-h1" class="wb-h">${esc(T("اليوم"))}</h3>
        <div class="wb-big" id="wb-today">${esc(fmt(today))}</div><div class="muted">${U.n[k] || 0} ${esc(T("جلسات"))}</div>
        ${lim ? `<div class="wb-meter" role="progressbar" aria-valuemin="0" aria-valuemax="${lim}" aria-valuenow="${Math.min(today, lim)}" aria-label="${esc(T("الحد اليومي"))}"><i style="width:${Math.min(100, Math.round((today / lim) * 100))}%"></i></div><div class="u-t-xs u-mt4 muted">${esc(T("الحد اليومي"))}: ${esc(fmt(lim))}</div>` : ""}
        <div class="wb-bars" role="img" aria-label="${esc(T("آخر 7 أيام"))}">${days.map((d) => `<div class="${d === k ? "t" : ""}" title="${esc(fmt(U.d[d]))}"><i style="height:${Math.round(((U.d[d] || 0) / max) * 100)}%"></i>${esc(dn(d))}</div>`).join("")}</div></section>
      <section class="card" aria-labelledby="wb-h2"><h3 id="wb-h2" class="wb-h">${esc(T("التقرير الأسبوعي"))}</h3>
        <div class="wb-row"><span>${esc(T("هذا الأسبوع"))}</span><b>${esc(fmt(cur.seconds))}</b></div>
        <div class="wb-row"><span>${esc(T("الأسبوع الماضي"))}</span><b>${esc(fmt(prev.seconds))}</b></div>
        <div class="wb-row"><span>${esc(T("المتوسط اليومي"))}</span><b>${esc(fmt(cur.days ? cur.seconds / cur.days : 0))}</b></div>
        ${diff !== null ? `<p class="wb-diff"><span class="sbadge ${diff <= 0 ? "ok" : "warn"}">${diff <= 0 ? "−" : "+"}${UI.num(Math.abs(diff))}%</span> ${esc(T(diff <= 0 ? "أقل من الأسبوع الماضي بنسبة" : "أكثر من الأسبوع الماضي بنسبة"))}</p>` : ""}</section>
      <section class="card" aria-labelledby="wb-h3"><h3 id="wb-h3" class="wb-h">${esc(T("الإعدادات"))}</h3>
        ${sel("wb-break", S.breakMinutes, [[0, "متوقف"], [15, "كل 15 دقيقة"], [20, "كل 20 دقيقة"], [30, "كل 30 دقيقة"], [45, "كل 45 دقيقة"], [60, "كل ساعة"], [90, "كل ساعة ونصف"]], "تذكير بأخذ استراحة")}
        ${sel("wb-limit", S.dailyLimitMinutes, [[0, "بلا حد"], [30, "30 دقيقة"], [60, "ساعة"], [90, "ساعة ونصف"], [120, "ساعتان"], [180, "3 ساعات"]], "الحد اليومي")}
        ${tog("wb-hide", S.hideCounts, "إخفاء الأعداد", "الإعجابات والتعليقات وإعادة النشر والمشاهدات والمتابعون")}
        ${tog("wb-focus", S.focus, "وضع التركيز", "تصميم هادئ بلا تمرير لا نهائي ولا اقتراحات ولا شارات")}
        ${tog("wb-weekly", S.weeklyReport, "التقرير الأسبوعي", "ملخص لوقتك في بداية كل أسبوع")}
        ${tog("wb-share", S.shareTotals, "مشاركة المجاميع الأسبوعية مع الخادم (اختياري)", "يُرسل مجموع الأسبوع وعدد الجلسات والأيام فقط ليصلك التقرير إشعاراً على كل أجهزتك. الإيقاف يحذفها.")}
        ${email ? tog("wb-email", S.emailReport, "إرسال التقرير إلى بريدي", "") : ""}
        <p class="f-hint">${esc(T("مجانية للجميع."))}</p>
        <button class="btn outline wb-clear" id="wb-clear">${esc(T("مسح بيانات الاستخدام من هذا الجهاز"))}</button></section></div>`;
    const on = (id, f) => view.querySelector("#" + id)?.addEventListener("change", (e) => save(f(e.target)).then(screen).catch((er) => { if (typeof toast === "function") toast(er?.message || T("تعذّر الحفظ")); screen(); }));
    on("wb-break", (t) => ({ breakMinutes: +t.value })); on("wb-limit", (t) => ({ dailyLimitMinutes: +t.value }));
    on("wb-hide", (t) => ({ hideCounts: t.checked })); on("wb-focus", (t) => ({ focus: t.checked })); on("wb-weekly", (t) => ({ weeklyReport: t.checked }));
    on("wb-share", (t) => ({ shareTotals: t.checked })); on("wb-email", (t) => ({ emailReport: t.checked }));
    view.querySelector("#wb-clear").addEventListener("click", () => { U = { d: {}, n: {}, sent: {}, rep: null, lim: null }; write(UK, U); lastTick = 0; cont = 0; screen(); });
    window.MPI18n?.apply(view);
  }
  MPRoutes.extend((a, b) => ({ wellbeing: () => { screen(); pull().then(() => { if (/^#\/wellbeing/.test(location.hash)) screen(); }); } }));
  const setCard = () => { if (/^#\/settings\/?(\?|$)/.test(location.hash) && !document.getElementById("wb-set")) (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<a class="u-db u-ci card" id="wb-set" href="#/wellbeing"><b>${esc(T("الرفاهية الرقمية"))}</b><div class="u-t-sm muted">${esc(T("وقت الاستخدام، الاستراحات، إخفاء الأعداد، وضع التركيز"))}</div></a>`); };
  if (typeof Views !== "undefined" && Views.settings) { MPSettings.add(function () { setCard(); }); }

  window.MPWellbeing = { settings: () => ({ ...S }), usage: () => JSON.parse(JSON.stringify(U)), weeks, save, upload, tick, screen, enhanceHome, version: "2.23.0" };
  apply();
  pull().then(() => { upload(); localReport(); });
  if (typeof DB !== "undefined" && DB.onboarded) {
    if (/^#\/wellbeing/.test(location.hash) && typeof route === "function") route();
    else { if (/^#\/settings\/?(\?|$)/.test(location.hash)) setCard(); enhanceHome(); }
  }
})();
