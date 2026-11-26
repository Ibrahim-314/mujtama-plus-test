/* =====================================================================
 * v2.161 — «خدمات MJT»: spend the internal MJT rewards balance on services that already exist in the app (phase 5).
 * Rides the lazy `mjt` chunk (index.html, same data-chunk) and its mjt.css; 0 bytes in core. RTL first, mobile / Pi Browser.
 *   #/mjt/services[?tab=mine|history]  balance + no-monetary-value line, the enabled services (benefit, cost, term, access
 *                                      state), a confirmation sheet (name, what you get, cost, current balance, balance after)
 *                                      → success message; «خدماتي» (owned, with expiry) and «السجل» (purchases + refunds).
 *                                      States: signed out, loading, empty, error (retry), offline (retry when back online).
 *   #/admin/mjt-services               admin: catalog (cost → new price version, term permanent / days, access mode, eligible
 *                                      memberships, enable / disable), usage count + MJT spent, price history, register an
 *                                      existing feature / paid course, purchases list, manual refund with a mandatory reason.
 * The page never sends an amount: the purchase carries only the service id, the price version the member saw and an
 * idempotency key; the server reads the cost, checks balance / membership / ownership and debits through the phase-4 engine.
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function MjtServicesUI() {
  if (window.MPMjtServices) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => (window.MPFeat ? MPFeat.ico(n, c) : UI.icon(n, c));
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const amt = (s) => `<bdi dir="ltr" class="mj-n">${h(s)}</bdi>`;
  const day = (s) => { try { return new Intl.DateTimeFormat(window.MPI18n && MPI18n.current() === "en" ? "en" : "ar", { numberingSystem: "latn", day: "numeric", month: "short", year: "numeric" }).format(new Date(s)); } catch { return String(s || "").slice(0, 10); } };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap mj-page">${UI.pageHead({ ...head, id: "sv-h" })}${body}</div>`; $("#sv-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); return null; } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const newKey = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* fallback below */ } const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const NOTE = "مجتمع كوين (MJT) رصيد مكافآت داخلي فقط: ليس له قيمة نقدية، ولا يُشترى ولا يُباع ولا يُسحب، ولا يُحوَّل إلى Pi أو مال.";
  const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
  const num = (s) => Number(String(s ?? "0").replace(/,/g, "")) || 0;
  const fmt = (x) => { const r = Math.round(x * 1e7) / 1e7; return String(r); };
  function failBox(el, e, again) {
    const off = offline();
    el.innerHTML = UI.empty({ title: off ? "أنت غير متصل" : "تعذّر التحميل", text: off ? "تحقق من اتصالك بالإنترنت، وسنحاول مجدداً عند عودته." : e?.message || "تعذّر الاتصال بالخادم", action: `<button type="button" class="btn outline" data-sv-retry>إعادة المحاولة</button>` });
    el.querySelector("[data-sv-retry]")?.addEventListener("click", () => again());
    if (off) addEventListener("online", () => { if (el.isConnected) again(); }, { once: true });
  }

  /* ---------- #/mjt/services ---------- */
  async function servicesView() {
    if (!signed()) { page({ title: "خدمات مجتمع كوين", icon: "bag" }, UI.empty({ title: "سجّل الدخول", text: "لترى الخدمات التي يمكنك الحصول عليها برصيد مكافآتك.", action: `<a class="btn" href="#/settings">تسجيل الدخول</a>` })); return; }
    const tab = ["mine", "history"].includes(qs().get("tab")) ? qs().get("tab") : "home";
    page({ title: "خدمات مجتمع كوين", icon: "bag", sub: "استخدم رصيد مجتمع كوين في خدمات داخل التطبيق", back: ["#/mjt", "مجتمع كوين"] }, `<div id="sv-w" aria-busy="true">${skel(4)}</div>`);
    const box = $("#sv-w");
    const load = async () => {
      box.setAttribute("aria-busy", "true"); box.innerHTML = skel(4);
      let d; try { d = await api("GET", "/api/mjt/services"); } catch (e) { box.removeAttribute("aria-busy"); failBox(box, e, load); return; }
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy");
      // v2.164: the balance lives on one page (#/mjt); here a link to it, the confirmation sheet still shows balance before / after
      box.innerHTML = `<a class="card li sv-wal" href="#/mjt"><span class="ico">${ic("wallet")}</span><span class="t"><b>رصيدك ومحفظتك في «مجتمع كوين»</b><small>${h(d.note || NOTE)}</small></span><span class="chev" aria-hidden="true">←</span></a>
        ${d.wallet.frozen ? `<p class="notice warn">${ic("lock")}<span>محفظة مكافآتك موقوفة مؤقتاً للمراجعة، فلا يمكن استخدام الرصيد الآن. <a href="#/tickets">تواصل مع الدعم</a>.</span></p>` : ""}
        <nav class="seg mj-seg" aria-label="خدمات مجتمع كوين"><a href="#/mjt/services" ${tab === "home" ? 'aria-current="page"' : ""}>الخدمات</a><a href="#/mjt/services?tab=mine" ${tab === "mine" ? 'aria-current="page"' : ""}>خدماتي</a><a href="#/mjt/services?tab=history" ${tab === "history" ? 'aria-current="page"' : ""}>السجل</a></nav>
        <div id="sv-tab"></div>`;
      const t = $("#sv-tab");
      if (tab === "mine") mineTab(t); else if (tab === "history") historyTab(t); else listTab(t, d, load);
    };
    if (offline()) failBox(box, null, load); else load();
  }
  function card(s, bal, frozen) {
    const short = s.canBuy && num(s.cost) > bal;
    const state = s.hasAccess ? `<p class="sv-state ok">${ic("check", "xs")}<span>${h(s.accessReasonLabel || "لديك وصول")}${s.expiresAt ? ` · حتى ${h(day(s.expiresAt))}` : ""}</span></p>`
      : s.needsPlus ? `<p class="sv-state">${ic("star", "xs")}<span>متاحة لأعضاء Plus</span></p>` : "";
    const act = s.hasAccess ? (s.href ? `<a class="btn outline" href="${h(s.href)}">افتح الخدمة</a>` : "")
      : s.needsPlus ? `<a class="btn outline" href="#/membership">اعرف عن Plus</a>`
        : s.canBuy ? `<button type="button" class="btn" data-buy="${h(s.id)}" ${frozen || short ? "disabled" : ""}>احصل عليها</button>${short ? `<small class="sv-hint">رصيدك لا يكفي لهذه الخدمة</small>` : ""}` : "";
    return `<li class="card sv-card"><h3 class="f-h">${ic(s.kind === "course" ? "cap" : "chart")}${h(s.title)}</h3><p class="sv-ben">${h(s.benefit)}</p>
      <dl class="sv-meta"><div><dt>التكلفة</dt><dd>${s.cost != null ? `${amt(s.cost)} MJT` : h(s.accessModeLabel)}</dd></div><div><dt>المدة</dt><dd>${h(s.termLabel)}</dd></div></dl>
      ${state}<div class="mj-acts">${act}</div></li>`;
  }
  function listTab(t, d, reload) {
    const bal = num(d.wallet.balance);
    t.innerHTML = d.services.length ? `<ul class="sv-list">${d.services.map((s) => card(s, bal, d.wallet.frozen)).join("")}</ul>
        <p class="f-hint">لا يُخصم شيء مقابل ما تملكه بالفعل أو ما تشمله عضويتك. تحفظ كل عملية السعر الذي وافقت عليه.</p>`
      : UI.empty({ title: "لا خدمات متاحة الآن", text: "تعلن الإدارة عن الخدمات عند تفعيلها. رصيدك محفوظ في «مجتمع كوين».", action: `<a class="btn outline" href="#/mjt">مجتمع كوين</a>` });
    t.querySelectorAll("[data-buy]").forEach((b) => b.addEventListener("click", () => confirmSheet(d.services.find((x) => x.id === b.dataset.buy), d.wallet, b, reload)));
  }
  /** confirmation sheet: name, what you get, cost, current balance, balance after → purchase (id + price version + ikey only) */
  function confirmSheet(s, w, ret, reload) {
    if (!s) return;
    const ikey = newKey();
    const body = (x) => { const after = num(w.balance) - num(x.cost); return `<h3 id="sv-st" tabindex="-1" class="u-m0 u-mb8">${ic("bag")}تأكيد الحصول على الخدمة</h3>
      <dl class="sv-conf"><div><dt>الخدمة</dt><dd>${h(x.title)}</dd></div><div><dt>ما ستحصل عليه</dt><dd>${h(x.benefit)} (${h(x.termLabel)})</dd></div>
        <div><dt>التكلفة</dt><dd>${amt(x.cost)} MJT</dd></div><div><dt>رصيدك الحالي</dt><dd>${amt(w.balance)} MJT</dd></div><div><dt>رصيدك بعد العملية</dt><dd>${amt(fmt(after))} MJT</dd></div></dl>
      <p class="mj-stage" role="note">${ic("lock", "xs")}<span>${h(NOTE)}</span></p>
      <p class="pd-err" id="sv-err" role="alert"></p>
      <div class="mj-acts"><button type="button" class="btn" id="sv-go">تأكيد واستخدام ${amt(x.cost)} MJT</button><button type="button" class="btn ghost" id="sv-x">إلغاء</button></div>`; };
    let cur = { ...s };
    const sh = sheet(`<div class="sv-sheet" role="dialog" aria-modal="true" aria-labelledby="sv-st"><div id="sv-sb">${body(cur)}</div></div>`);
    sh._onclose = () => { if (ret?.isConnected) ret.focus(); };
    const wire = () => {
      sh.querySelector("#sv-st")?.focus();
      sh.querySelector("#sv-x").addEventListener("click", () => closeSheet());
      sh.querySelector("#sv-go").addEventListener("click", (e) => go(e.currentTarget));
    };
    const done = (title, text, href) => {
      sh.querySelector("#sv-sb").innerHTML = `<div class="pd-done" id="sv-done" tabindex="-1"><div class="big" aria-hidden="true">${ic("check", "lg")}</div><b>${h(title)}</b><p class="u-m0 u-mb10 muted">${h(text)}</p>
        <div class="mj-acts">${href ? `<a class="btn" href="${h(href)}" id="sv-open">افتح الخدمة</a>` : ""}<button type="button" class="btn ghost" id="sv-x2">إغلاق</button></div></div>`;
      sh.querySelector("#sv-done").focus();
      sh.querySelector("#sv-x2").addEventListener("click", () => closeSheet());
      sh.querySelector("#sv-open")?.addEventListener("click", () => closeSheet());
      reload();
    };
    async function go(btn) {
      const err = sh.querySelector("#sv-err"); err.textContent = "";
      if (offline()) { err.textContent = "أنت غير متصل — لم يُخصم شيء. أعد المحاولة عند عودة الاتصال."; return; }
      btn.disabled = true;
      try {
        const r = await api("POST", `/api/mjt/services/${enc(cur.id)}/purchase`, { priceVersion: cur.priceVersion, ikey });
        if (r.alreadyHasAccess) { say(r.message); done("لديك وصول بالفعل", `${r.message} — لم يُخصم شيء من رصيدك.`, cur.href); return; }
        const left = r.wallet?.balance ?? r.balanceAfter;
        say("تمت العملية"); done("تمت العملية بنجاح", r.expiresAt ? `حصلت على «${cur.title}» حتى ${day(r.expiresAt)}. رصيدك الآن ${left} MJT.` : `حصلت على «${cur.title}». رصيدك الآن ${left} MJT.`, cur.href);
      } catch (e) {
        if (!btn.isConnected) return;
        btn.disabled = false;
        if (e.code === "price_changed") { // re-read the current price from the server (the client never decides it), then ask again
          const fresh = (await api("GET", "/api/mjt/services").catch(() => null))?.services?.find((x) => x.id === cur.id);
          if (!fresh || !fresh.canBuy) { err.textContent = "تغيّرت هذه الخدمة ولم تعد متاحة بالشروط نفسها — لم يُخصم شيء."; reload(); return; }
          cur = fresh; sh.querySelector("#sv-sb").innerHTML = body(cur); wire(); sh.querySelector("#sv-err").textContent = "تغيّرت تكلفة الخدمة. راجع السعر الجديد ثم أكّد من جديد — لم يُخصم شيء."; return; }
        if (e.code === "delivery_failed_refunded") { err.textContent = "تعذّر تسليم الخدمة، وأُعيد المبلغ كاملاً إلى رصيدك."; reload(); return; }
        err.textContent = e.code === "insufficient_balance" ? "رصيدك لا يكفي — لم يُخصم شيء." : e.code === "account_frozen" ? "محفظتك موقوفة مؤقتاً — لم يُخصم شيء." : e.message || "تعذّرت العملية — لم يُخصم شيء.";
      }
    }
    wire();
  }
  async function mineTab(t) {
    const load = async () => {
      t.innerHTML = skel(2);
      let d; try { d = await api("GET", "/api/mjt/services/mine"); } catch (e) { failBox(t, e, load); return; }
      if (!t.isConnected) return;
      t.innerHTML = d.items.length ? `<ul class="list mj-hist">${d.items.map((x) => `<li class="li"><span class="ico">${ic(x.state === "active" ? "check" : "clock")}</span><span class="t"><b>${x.href && x.state === "active" ? `<a href="${h(x.href)}">${h(x.title)}</a>` : h(x.title)}</b>
          <small>${x.permanent ? "دائمة" : `حتى ${h(day(x.expiresAt))}`} · <span class="sbadge ${x.state === "active" ? "ok" : x.state === "expired" ? "warn" : "bad"}">${h(x.stateLabel)}</span></small></span>${x.cost != null ? `<span class="mj-amt out">${amt(x.cost)}</span>` : ""}</li>`).join("")}</ul>`
        : UI.empty({ title: "لا خدمات بعد", text: "ستظهر هنا الخدمات التي تحصل عليها ومدة صلاحيتها." });
    };
    load();
  }
  async function historyTab(t) {
    const load = async () => {
      t.innerHTML = skel(3);
      let d; try { d = await api("GET", "/api/mjt/services/history"); } catch (e) { failBox(t, e, load); return; }
      if (!t.isConnected) return;
      t.innerHTML = d.items.length ? `<ul class="list mj-hist">${d.items.map((x) => `<li class="li"><span class="ico">${ic("bag")}</span><span class="t"><b>${h(x.title)}</b>
          <small>${h(day(x.createdAt))} · ${h(x.termLabel)} · <span class="sbadge ${x.status === "refunded" ? "warn" : "ok"}">${h(x.statusLabel)}</span>${x.refundReason ? ` · ${h(x.refundReason)}` : ""}</small></span><span class="mj-amt out">${amt("-" + x.cost)}</span></li>`).join("")}</ul>
          <p class="f-hint">تظهر هذه العمليات أيضاً في <a href="#/mjt?tab=history">سجل مجتمع كوين</a>.</p>`
        : UI.empty({ title: "لا عمليات بعد", text: "سيظهر هنا كل ما حصلت عليه برصيدك وأي استرداد." });
    };
    load();
  }

  /* ---------- #/admin/mjt-services ---------- */
  async function adminView() {
    if (!signed()) { page({ title: "خدمات مجتمع كوين", icon: "bag" }, UI.empty({ title: "للإدارة فقط", text: "هذه الصفحة لمديري المنصة." })); return; } // the server decides (403 for members)
    page({ title: "إدارة خدمات مجتمع كوين", icon: "bag", sub: "كتالوج الخدمات التي تُستخدم برصيد المكافآت", back: ["#/admin/rewards", "مكافآت مجتمع كوين"], actions: `<a class="btn outline" href="#/admin/mjt-economy">اقتصاد MJT</a>` }, `<div id="sv-a" aria-busy="true">${skel(5)}</div>`);
    const box = $("#sv-a");
    const reload = async () => {
      let d; try { d = await api("GET", "/api/admin/mjt/services"); } catch (e) { box.removeAttribute("aria-busy"); failBox(box, e, reload); return; }
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy");
      const opt = (v, cur, l) => `<option value="${h(v)}" ${v === cur ? "selected" : ""}>${h(l)}</option>`;
      box.innerHTML = `<p class="mj-stage" role="note">${ic("lock", "xs")}<span>${h(d.note || NOTE)}</span></p>
        <section class="card mj-sec"><h3 class="f-h">${ic("shield")}سياسة الاسترداد</h3><ul class="mj-facts">${d.policy.map((x) => `<li>${h(x)}</li>`).join("")}</ul>
          <p class="f-hint">كل الخدمات تبدأ معطّلة وبلا تكلفة. لا تُفعَّل خدمة تُشترى بمجتمع كوين قبل تحديد التكلفة ونوع المدة. كل تغيير في التكلفة أو المدة يُنشئ نسخة سعر جديدة ولا يمسّ المشتريات السابقة.</p></section>
        <section class="card mj-sec"><h3 class="f-h">${ic("bag")}الكتالوج</h3>
          ${d.services.length ? d.services.map((s) => `<form class="sv-f" data-id="${h(s.id)}"><fieldset><legend><b>${h(s.title)}</b> <small class="muted">${h(s.kind === "course" ? "دورة مدفوعة" : "ميزة")} · ${h(s.key)} · نسخة السعر ${h(s.priceVersion)}</small></legend>
            <label>الاسم<input name="title" value="${h(s.title)}" required minlength="2" maxlength="80"></label>
            <label class="sv-wide">ما يحصل عليه العضو<input name="benefit" value="${h(s.benefit)}" maxlength="300"></label>
            <label>التكلفة (MJT، عدد صحيح)<input name="cost" inputmode="numeric" value="${s.cost == null ? "" : h(s.cost)}" placeholder="غير محددة"></label>
            <label>المدة<select name="term">${opt("", s.term || "", "غير محددة")}${opt("permanent", s.term, "دائمة")}${opt("days", s.term, "مدة بالأيام")}</select></label>
            <label>عدد الأيام<input name="durationDays" inputmode="numeric" value="${s.durationDays == null ? "" : h(s.durationDays)}"></label>
            <label>الإتاحة<select name="accessMode">${d.modes.map((m) => opt(m.key, s.accessMode, m.label)).join("")}</select></label>
            <label>من يستطيع الشراء<select name="eligible">${opt("all", s.eligible, "كل الأعضاء")}${opt("plus", s.eligible, "أعضاء Plus فقط")}</select></label>
            <label class="chk"><input type="checkbox" name="enabled" ${s.enabled ? "checked" : ""}> مفعّلة</label>
            <p class="sv-wide f-hint">${h(s.usage.purchases)} عملية · ${h(s.usage.active)} فعّالة · ${h(s.usage.refunded)} مستردة · المستخدم ${amt(s.usage.spent)} MJT</p>
            <div class="mj-acts sv-wide"><button class="btn">حفظ</button><button type="button" class="btn ghost" data-pur="${h(s.id)}">المشتريات</button><button type="button" class="btn ghost" data-det="${h(s.id)}">سجل الأسعار</button></div></fieldset></form>`).join("") : `<p class="f-hint">لا خدمات في الكتالوج.</p>`}
          <div id="sv-det"></div></section>
        <section class="card mj-sec"><h3 class="f-h">${ic("plus")}إضافة عنصر موجود إلى الكتالوج</h3>
          ${d.candidates.features.map((f) => `<button type="button" class="btn outline" data-addf="${h(f.target)}">إضافة ميزة: ${h(f.title)}</button>`).join("")}
          <p class="f-hint">يمكن ربط الدورات المدفوعة فقط (الدورات المجانية تبقى مجانية). صاحب الدورة لا يتلقى Pi عن الوصول بمجتمع كوين — احصل على موافقته قبل التفعيل.</p>
          <form id="sv-cq"><label>ابحث في الدورات المدفوعة<input name="q" placeholder="اسم الدورة"></label><button class="btn outline">بحث</button></form><div id="sv-cr"></div></section>
        <section class="card mj-sec"><h3 class="f-h">${ic("search")}المشتريات</h3>
          <form id="sv-pq"><label>العضو<input name="handle" placeholder="@handle" dir="ltr"></label><label>الحالة<select name="status"><option value="">الكل</option><option value="active">مكتملة</option><option value="refunded">مستردة</option></select></label><button class="btn outline">بحث</button></form>
          <div id="sv-pr"></div></section>`;
      box.querySelectorAll(".sv-f").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); const g = (n) => f.elements[n].value.trim(); busy(e.submitter, async () => {
        await api("PUT", "/api/admin/mjt/services/" + enc(f.dataset.id), { title: g("title"), benefit: g("benefit"), cost: g("cost") || null, term: g("term") || null, durationDays: g("durationDays") || null, accessMode: g("accessMode"), eligible: g("eligible"), enabled: f.elements.enabled.checked });
        say("حُفظت الخدمة"); reload(); }); }));
      box.querySelectorAll("[data-pur]").forEach((b) => b.addEventListener("click", () => busy(b, () => purchases({ service: b.dataset.pur }))));
      box.querySelectorAll("[data-det]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { const r = await api("GET", "/api/admin/mjt/services/" + enc(b.dataset.det));
        $("#sv-det").innerHTML = `<h4>سجل الأسعار: ${h(r.service.title)}</h4><ul class="list mj-hist">${r.prices.map((p) => `<li class="li"><span class="t"><b>النسخة ${h(p.version)}</b><small>${h(day(p.at))} · ${p.term === "permanent" ? "دائمة" : p.term === "days" ? `${h(p.durationDays)} يوماً` : "مدة غير محددة"}</small></span><span class="mj-amt">${p.cost == null ? "—" : amt(p.cost)}</span></li>`).join("")}</ul>`; })));
      box.querySelectorAll("[data-addf]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", "/api/admin/mjt/services", { kind: "feature", target: b.dataset.addf }); say("أُضيفت الخدمة معطّلة"); reload(); })));
      $("#sv-cq").addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { const r = await api("GET", "/api/admin/mjt/services/candidates?kind=course&q=" + enc(e.target.q.value.trim())), out = $("#sv-cr");
        out.innerHTML = r.items.length ? `<ul class="list">${r.items.map((c) => `<li class="li"><span class="t"><b>${h(c.title)}</b><small>${c.author ? "@" + h(c.author) : ""} · ${h(c.status === "published" ? "منشورة" : "غير منشورة")}</small></span><button type="button" class="btn outline" data-addc="${h(c.target)}">إضافة</button></li>`).join("")}</ul>` : `<p class="f-hint">لا دورات مدفوعة غير مسجّلة.</p>`;
        out.querySelectorAll("[data-addc]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { await api("POST", "/api/admin/mjt/services", { kind: "course", target: b.dataset.addc }); say("أُضيفت الدورة معطّلة وبلا تكلفة"); reload(); }))); }); });
      $("#sv-pq").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; busy(e.submitter, () => purchases({ handle: f.handle.value.trim().replace(/^@/, ""), status: f.status.value })); });
    };
    async function purchases(q) {
      const p = new URLSearchParams(); for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
      const r = await api("GET", "/api/admin/mjt/services/purchases?" + p.toString()), out = $("#sv-pr");
      out.innerHTML = r.items.length ? `<ul class="list mj-hist">${r.items.map((x) => `<li class="li"><span class="t"><b>@${h(x.handle || "")} · ${h(x.title)}</b><small>${h(day(x.createdAt))} · النسخة ${h(x.priceVersion)} · ${h(x.termLabel)} · <span class="sbadge ${x.status === "refunded" ? "warn" : "ok"}">${h(x.statusLabel)}</span>${x.refundReason ? ` · ${h(x.refundReason)}` : ""}</small></span>
          <span class="mj-amt">${amt(x.cost)}</span>${x.status === "active" ? `<button type="button" class="btn ghost" data-ref="${h(x.id)}">استرداد</button>` : ""}</li>`).join("")}</ul>` : `<p class="f-hint">لا مشتريات.</p>`;
      out.scrollIntoView?.({ block: "nearest" });
      out.querySelectorAll("[data-ref]").forEach((b) => b.addEventListener("click", () => { const reason = prompt("سبب الاسترداد (إلزامي، 5 أحرف على الأقل)"); if (!reason || reason.trim().length < 5) { if (reason !== null) say("اكتب سبباً واضحاً للاسترداد"); return; }
        busy(b, async () => { await api("POST", `/api/admin/mjt/services/purchases/${enc(b.dataset.ref)}/refund`, { reason: reason.trim() }); say("أُعيد المبلغ كاملاً وأُلغيت الصلاحية"); reload(); purchases(q); }); }));
    }
    reload();
  }

  MPRoutes.add("mjt", (a, b, next) => (a === "services" ? servicesView() : next()));
  MPRoutes.add("admin", (a, b, next) => (a === "mjt-services" ? adminView() : next()));
  window.MPMjtServices = { servicesView, adminView, version: "2.161.0" };
  if (/^#\/(mjt\/services|admin\/mjt-services)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
