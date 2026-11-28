/* =====================================================================
 * مجتمع بلس — v2.156 membership page (lazy "membership" chunk; 0 bytes in core).
 *   #/membership   my tier (Free / Plus), state, start / end dates, Free vs Plus comparison, upgrade · renew (Pi, testnet),
 *                  cancel renewal / resume, and my payment + subscription history.
 * Everything shown comes from GET /api/membership/me and /api/membership/plans; the page never decides a tier itself.
 * Payments go through MPPi.pay (pi chunk) with the feature intent POST /api/membership/subscribe. No pop-ups elsewhere.
 * ===================================================================== */
(function MembershipUI() {
  if (window.MPMembership) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const amt = (n) => `<bdi dir="ltr">${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 7 })} π</bdi>`;
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso)); } catch { return String(iso); } };
  const $ = (s) => view.querySelector(s);
  const CHIP = { free: "", plus_active: "ok", plus_cancelling: "warn", payment_pending: "warn", payment_failed: "bad", expired: "" };
  const EV = { started: "بدأت Plus", renewed: "جُدّدت Plus", cancelled: "أُوقف التجديد", resumed: "استؤنف التجديد", expired: "انتهت Plus", payment_failed: "فشلت دفعة", payment_cancelled: "أُلغيت دفعة" };

  if (!document.getElementById("mb-css")) document.head.insertAdjacentHTML("beforeend", `<style id="mb-css">
.mb-page{max-width:640px;margin:auto}.mb-hero{border-radius:20px;padding:18px;margin-bottom:14px;background:var(--card);box-shadow:var(--sh-1);border:1px solid var(--line)}
.mb-hero.plus{color:var(--white);border:0;background:radial-gradient(120% 120% at 100% 0%,var(--brand-1),color-mix(in srgb,var(--brand-1),black 45%))}.mb-hero.plus .muted{color:color-mix(in srgb,var(--white) 88%,transparent)}
.mb-tier{font-size:var(--fs-3xl);font-weight:850;margin:4px 0}.mb-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:12px 0 0}.mb-dl dt{opacity:.8}.mb-dl dd{margin:0;font-weight:700}
.mb-cmp{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}.mb-col{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px}.mb-col.plus{border:2px solid var(--brand-1)}
.mb-col h3{margin:0 0 4px;font-size:18px}.mb-col ul{margin:8px 0 0;padding-inline-start:18px;line-height:1.7;font-size:14px}.mb-acts{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.mb-hist{list-style:none;margin:0;padding:0}.mb-hist li{display:flex;gap:10px;justify-content:space-between;padding:10px 4px;border-bottom:1px solid var(--line)}.mb-hist li:last-child{border:0}
.mb-bar{display:block;height:4px;border-radius:4px;background:var(--line);margin-top:4px;min-width:72px}.mb-bar i{display:block;height:100%;border-radius:4px;background:var(--accent)}.mb-bar i.w{background:var(--warn)}
.mb-q{margin:6px 0;font-size:var(--fs-sm)}.mb-q.w{color:var(--warn)}
@media (max-width:520px){.mb-cmp{grid-template-columns:1fr}}
</style>`);

  async function needPi() { if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { }); if (!window.MPPi) throw new Error("تعذّر تحميل مدفوعات Pi"); }

  function hero(m) {
    const s = m.subscription, plus = m.tier === "plus";
    return `<section class="mb-hero ${plus ? "plus" : ""}" aria-labelledby="mb-t"><div class="muted">عضويتك الحالية</div>
      <div class="mb-tier" id="mb-t">${plus ? "Plus" : "Free"}</div><span class="sbadge ${CHIP[m.state] || ""}" data-state="${h(m.state)}">${h(m.stateLabel)}</span>
      ${s ? `<dl class="mb-dl"><dt>البداية</dt><dd>${day(s.periodStart)}</dd><dt>${plus ? "تنتهي في" : "انتهت في"}</dt><dd>${day(s.periodEnd)}</dd>${plus ? `<dt>المتبقي</dt><dd>${h(s.daysLeft)} يوماً</dd>` : ""}</dl>` : ""}
      ${m.state === "payment_pending" ? `<p class="muted">دفعتك قيد التحقق من شبكة Pi. لن تُفعَّل Plus قبل تأكيدها.</p>` : ""}
      ${m.state === "payment_failed" ? `<p class="muted">آخر دفعة لم تكتمل، ولم يُخصم منك شيء مقابل Plus. يمكنك المحاولة مجدداً.</p>` : ""}
      ${m.state === "plus_cancelling" ? `<p class="muted">أوقفت التجديد. تبقى مزايا Plus حتى تاريخ الانتهاء ثم تعود إلى Free.</p>` : ""}</section>`;
  }
  /* v2.158 — usage of the per-member ceilings: used / allowed, what to do, and (Free only) a quiet note on Plus */
  function meter(u, compact) {
    if (u.used == null) return compact ? "" : `<li><span>${h(u.label)}</span><span class="muted">حتى ${h(u.limit)}</span></li>`;
    const warn = u.full || u.near, plus = u.tier !== "plus" && u.plusLimit > u.limit;
    const tip = warn ? `<small class="u-db muted">${h(u.advice)}${plus ? ` · <a href="#/membership">Plus يرفع الحد إلى ${h(u.plusLimit)}</a>` : ""}</small>` : "";
    const bar = `<span class="mb-bar" aria-hidden="true"><i style="width:${Math.min(100, u.pct || 0)}%"${warn ? ' class="w"' : ""}></i></span>`;
    if (compact) return `<p class="mb-q ${warn ? "w" : ""}" role="note"><span>${h(u.label)}: <b>${h(u.used)}</b> من ${h(u.limit)}</span>${bar}${tip}</p>`;
    return `<li><span>${h(u.label)}${tip}</span><span><b>${h(u.used)}</b> من ${h(u.limit)}${bar}</span></li>`;
  }
  function usage(m) {
    const u = m.usage || []; if (!u.length) return "";
    return `<h3 class="u-mt12">استخدامك</h3><ul class="mb-hist mb-use card u-p12">${u.map((x) => meter(x)).join("")}</ul>
      <p class="muted">الحدود تُطبَّق عند إنشاء عنصر جديد فقط — لا يُحذف شيء مما لديك ولا يُخفى.</p>`;
  }
  /** a one-line usage note other screens add next to their «create» action (saved searches, collections, teams) */
  let cache = null;
  async function note(key) {
    if (!cache || Date.now() - cache.at > 30e3) cache = { at: Date.now(), p: api("GET", "/api/membership/usage").catch(() => ({ usage: [] })) };
    const u = ((await cache.p).usage || []).find((x) => x.key === key);
    return u ? meter(u, true) : "";
  }
  const fresh = () => { cache = null; };
  function compare(c, m) {
    const p = c.plus;
    const price = p && p.price != null ? `${amt(p.price)} / ${h(p.periodDays)} يوماً` : h(p?.priceNote || "السعر يُحدد قريباً");
    return `<div class="mb-cmp"><div class="mb-col"><h3>Free</h3><div class="muted">مجانية دائماً</div><ul>${c.free.features.map((f) => `<li>${h(f)}</li>`).join("")}</ul></div>
      ${p ? `<div class="mb-col plus"><h3>Plus</h3><div><b>${price}</b></div><div class="muted">${h(p.renewal)}</div><div class="muted">كل مزايا Free، وفوقها:</div>
        <ul>${p.features.map((f) => `<li>${h(f.label)}</li>`).join("")}${(p.quotas || []).filter((q) => q.plus > q.free).map((q) => `<li>${h(q.label)}: ${h(q.plus)} <small class="muted">(Free ${h(q.free)})</small></li>`).join("")}</ul>
        <div class="mb-acts">${actions(m, p)}</div><p id="mb-n" class="muted" role="status"></p></div>` : ""}</div>`;
  }
  function actions(m, p) {
    if (m.minor) return `<p class="muted">الاشتراكات المدفوعة غير متاحة لمن هم دون ١٨ سنة.</p>`;
    if (!m.piEnabled) return `<p class="muted">${h(m.piNote || "مدفوعات Pi غير مفعّلة بعد")}</p>`;
    if (p.price == null) return `<button class="btn" type="button" id="mb-buy" disabled>رقِّ إلى Plus</button><p class="muted">السعر يُحدد قريباً</p>`; // v2.167: the button stays visible
    const net = m.network !== "mainnet" ? `<small class="muted">على الشبكة التجريبية (Testnet) — لا أموال حقيقية.</small>` : "";
    if (m.state === "payment_pending") return `<button class="btn" type="button" disabled>بانتظار تأكيد الدفعة…</button>`;
    const plus = m.tier === "plus";
    return `<button class="btn" type="button" id="mb-buy">${plus ? "جدّد شهراً إضافياً" : "رقِّ إلى Plus"}</button>${net}
      ${plus ? (m.state === "plus_cancelling" ? `<button class="btn ghost" type="button" id="mb-res">استئناف التجديد</button>` : `<button class="btn ghost" type="button" id="mb-can">إيقاف التجديد</button>`) : ""}`;
  }
  function hist(m) {
    const rows = [...m.payments.map((x) => ({ at: x.createdAt, html: `<span>دفعة ${amt(x.amount)}${x.periodEnd && x.status === "completed" ? `<small class="u-db muted">حتى ${day(x.periodEnd)}</small>` : ""}</span><span class="sbadge">${h(x.statusLabel)}</span>` })),
      ...m.events.map((e) => ({ at: e.at, html: `<span>${h(EV[e.kind] || e.kind)}${e.until ? `<small class="u-db muted">حتى ${day(e.until)}</small>` : ""}</span><span class="muted">${day(e.at)}</span>` }))]
      .sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return `<h3 class="u-mt12">سجل العضوية والدفع</h3>${rows.length ? `<ul class="mb-hist card u-p12">${rows.map((r) => `<li>${r.html}</li>`).join("")}</ul>` : `<div class="empty">لا توجد عمليات بعد.</div>`}`;
  }

  async function page() {
    view.innerHTML = `<div class="wrap mb-page">${UI.pageHead({ back: "#/settings", title: "العضوية", icon: "star", id: "mb-h" })}<div id="mb-b" aria-busy="true"><div class="empty">جارٍ التحميل…</div></div></div>`;
    $("#mb-h")?.focus({ preventScroll: true });
    const body = $("#mb-b");
    try {
      const [m, c] = await Promise.all([api("GET", "/api/membership/me"), api("GET", "/api/membership/plans")]);
      body.innerHTML = hero(m) + usage(m) + compare(c, m) + hist(m); body.removeAttribute("aria-busy");
      $("#mb-buy")?.addEventListener("click", () => buy($("#mb-buy"), c.plus));
      $("#mb-can")?.addEventListener("click", () => toggle("cancel"));
      $("#mb-res")?.addEventListener("click", () => toggle("resume"));
      window.MPI18n?.apply?.(body);
    } catch (e) { body.innerHTML = `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`; }
  }
  async function buy(btn, p) {
    if (btn.disabled) return; btn.disabled = true; const n = $("#mb-n"); if (n) n.textContent = "";
    try {
      await needPi();
      await window.MPPi.pay({ amount: p.price, memo: `اشتراك شهري: ${p.label}`, purpose: "ai", refId: "ai_plus", intent: async () => (await api("POST", "/api/membership/subscribe", {})).intent });
      say("تم الدفع. جارٍ تفعيل Plus…"); await page();
    } catch (e) {
      btn.disabled = false;
      if (n) n.textContent = e.cancelled ? "أُلغيت عملية الدفع، لم يُخصم شيء." : e.code === "pi_unverified" ? "الدفعة قيد التحقق من شبكة Pi. ستُفعَّل Plus بعد تأكيدها." : (e.message || "تعذّرت عملية الدفع.");
      if (e.paid) page();
    }
  }
  async function toggle(k) { try { await api("POST", "/api/membership/" + k, {}); say(k === "cancel" ? "أُوقف التجديد" : "استؤنف التجديد"); page(); } catch (e) { say(e.message); } }

  MPRoutes.extend(() => ({ membership: () => page() }));
  window.MPMembership = { page, note, fresh, version: "2.161.0" };
  if (/^#\/membership\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
