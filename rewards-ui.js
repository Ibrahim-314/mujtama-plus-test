/* =====================================================================
 * v2.160 — «محفظة المكافآت»: the MJT internal rewards wallet (phase 4). Rides the lazy `mjt` chunk (index.html, same
 * data-chunk) and its mjt.css; 0 bytes in core. RTL first, mobile / Pi Browser friendly.
 *   #/rewards[?tab=history|review]  v2.164 (phase 8.0): no longer a second wallet — redirects to the one wallet page #/mjt
 *                                   (#/rewards → #/mjt, ?tab=history → #/mjt?tab=history, ?tab=review → #/mjt?tab=review).
 *                                   The old member view was removed; its «قيد المراجعة» tab moved to #/mjt?tab=review.
 *   #/admin/rewards                 admin: stats, reward sources (amount, caps, approval, on/off, add / delete), velocity
 *                                   review threshold, pending approve / reject, transaction search + detail, wallet lookup
 *                                   with freeze / unfreeze (reason) and corrective credit / debit (reason, actor audited).
 * The page never sends an amount for the member; balances change only on the server. MJT here is an internal rewards
 * balance with no monetary value: no price, no withdrawal, no transfer, no conversion.
 * CSP: no inline handlers, no javascript: URLs, no inline styles.
 * ===================================================================== */
(function RewardsUI() {
  if (window.MPRewards) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => (window.MPFeat ? MPFeat.ico(n, c) : UI.icon(n, c));
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const amt = (s) => `<bdi dir="ltr" class="mj-n">${h(s)}</bdi>`;
  const day = (s) => { try { return new Intl.DateTimeFormat(window.MPI18n && MPI18n.current() === "en" ? "en" : "ar", { numberingSystem: "latn", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(s)); } catch { return String(s || "").slice(0, 16); } };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const page = (head, body) => { view.innerHTML = `<div class="wrap mj-page">${UI.pageHead({ ...head, id: "rw-h" })}${body}</div>`; $("#rw-h")?.focus({ preventScroll: true }); };
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); return null; } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const newKey = () => { try { if (crypto.randomUUID) return crypto.randomUUID(); } catch { /* fallback below */ } const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const NOTE = "مجتمع كوين (MJT) رصيد مكافآت داخلي فقط: ليس له قيمة نقدية، ولا يُشترى ولا يُباع ولا يُسحب، ولا يُحوَّل إلى Pi أو مال.";
  const ST_CLS = { posted: "ok", pending: "warn", rejected: "bad" };
  const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
  /** error / offline box with a retry button that re-runs `again` */
  function failBox(el, e, again) {
    const off = offline();
    el.innerHTML = UI.empty({ title: off ? "أنت غير متصل" : "تعذّر التحميل", text: off ? "تحقق من اتصالك بالإنترنت، وسنحاول مجدداً عند عودته." : e?.message || "تعذّر الاتصال بالخادم", action: `<button type="button" class="btn outline" data-rw-retry>إعادة المحاولة</button>` });
    el.querySelector("[data-rw-retry]")?.addEventListener("click", () => again());
    if (off) addEventListener("online", () => { if (el.isConnected) again(); }, { once: true });
  }
  const row = (i) => {
    const neg = String(i.amount).startsWith("-") || i.kind === "spend" || i.kind === "adjust_debit";
    const a = String(i.amount).replace(/^-/, "");
    return `<li class="li"><span class="ico">${ic(neg ? "bag" : "award")}</span><span class="t"><b>${h(i.label || i.kindLabel || "")}${i.source ? ` · ${h(i.source)}` : ""}</b>
      <small>${h(day(i.createdAt))}${i.reason ? ` · ${h(i.reason)}` : ""} · <span class="sbadge ${ST_CLS[i.status] || ""}">${h(i.statusLabel || i.status)}</span></small></span>
      <span class="mj-amt ${neg ? "out" : "in"}">${amt((neg ? "-" : "+") + a)}${i.balanceAfter != null ? `<small>الرصيد ${amt(i.balanceAfter)}</small>` : ""}</span></li>`;
  };

  /* ---------- #/admin/rewards ---------- */
  async function adminView() {
    if (!signed()) { page({ title: "مكافآت مجتمع كوين", icon: "award" }, UI.empty({ title: "للإدارة فقط", text: "هذه الصفحة لمديري المنصة." })); return; } // the server decides (403 for members)
    page({ title: "مكافآت مجتمع كوين", icon: "award", sub: "رصيد مكافآت داخلي بلا قيمة نقدية", back: ["#/admin", "لوحة الإدارة"], actions: `<a class="btn outline" href="#/admin/mjt-services">خدمات مجتمع كوين</a><a class="btn outline" href="#/admin/mjt-economy">اقتصاد مجتمع كوين</a><a class="btn outline" href="#/admin/mjt-safety">الحماية والسقوف</a><a class="btn outline" href="#/admin/mjt-review">قائمة المراجعة</a>` }, `<div id="rw-a" aria-busy="true">${skel(5)}</div>`);
    const box = $("#rw-a");
    const reload = async () => {
      let s, src, pend;
      try { [s, src, pend] = await Promise.all([api("GET", "/api/admin/mjt/rewards/stats"), api("GET", "/api/admin/mjt/rewards/sources"), api("GET", "/api/admin/mjt/rewards/entries?status=open&limit=50")]); } catch (e) { box.removeAttribute("aria-busy"); failBox(box, e, reload); return; }
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy");
      const stat = (l, v) => `<div><dt>${h(l)}</dt><dd>${amt(v)}</dd></div>`;
      const num = (v) => (v === null || v === undefined ? "" : h(v));
      box.innerHTML = `<p class="mj-stage" role="note">${ic("lock", "xs")}<span>${h(s.note || NOTE)}</span></p>
        <section class="card mj-sec"><h3 class="f-h">${ic("chart")}الإحصاءات</h3><dl class="rw-tot">
          ${stat("مجموع الأرصدة", s.totalBalances)}${stat("المُصدَر كمكافآت", s.rewards.issued)}${stat("المستخدم", s.rewards.spent)}${s.rewards.refunds !== undefined ? stat("المسترد", s.rewards.refunds) : ""}${stat("المحافظ النشطة", s.wallets.active)}${stat("الموقوفة", s.wallets.frozen)}${stat("عدد الحركات", s.ledger.txCount)}${stat("قيد المراجعة", s.rewards.pending)}</dl>
          ${s.bySource.length ? `<ul class="list">${s.bySource.map((x) => `<li class="li"><span class="t"><b>${h(x.label)}</b><small>${h(x.posted)} مُضافة · ${h(x.pending)} معلّقة</small></span><span class="mj-amt in">${amt(x.issued)}</span></li>`).join("")}</ul>` : ""}</section>
        <section class="card mj-sec"><h3 class="f-h">${ic("award")}مصادر المكافآت</h3>
          <p class="f-hint">كل المصادر تبدأ معطّلة وبلا مبلغ. لا يُدفع شيء حتى تحدد المبلغ وتفعّل المصدر. الحدود اختيارية: اتركها فارغة لعدم التقييد.</p>
          ${src.sources.map((x) => `<form class="rw-src" data-key="${h(x.key)}"><fieldset><legend><b>${h(x.label)}</b> <small class="muted">${h(x.key)}</small></legend>
            <label>المبلغ (MJT، عدد صحيح)<input name="amount" inputmode="numeric" value="${x.amount === null ? "" : h(x.amount)}" placeholder="غير محدد"></label>
            <label>حد يومي للعضو<input name="dailyCap" inputmode="numeric" value="${num(x.dailyCap)}"></label>
            <label>حد أسبوعي<input name="weeklyCap" inputmode="numeric" value="${num(x.weeklyCap)}"></label>
            <label>حد شهري<input name="monthlyCap" inputmode="numeric" value="${num(x.monthlyCap)}"></label>
            <label>مرات لكل عنصر<input name="maxPerRef" inputmode="numeric" value="${num(x.maxPerRef)}"></label>
            <label class="chk"><input type="checkbox" name="approval" ${x.requiresApproval ? "checked" : ""}> تحتاج موافقة</label>
            <label class="chk"><input type="checkbox" name="enabled" ${x.enabled ? "checked" : ""}> مفعّل</label>
            <div class="mj-acts"><button class="btn">حفظ</button><button type="button" class="btn ghost" data-del>حذف</button></div></fieldset></form>`).join("")}
          ${src.rewardable.filter((k) => !src.sources.some((x) => x.key === k)).map((k) => `<button type="button" class="btn outline" data-add="${h(k)}">إضافة مصدر: ${h(k)}</button>`).join("")}
          <form id="rw-set" class="u-mt12"><label>مراجعة تلقائية إذا تجاوز العضو هذا العدد من المكافآت خلال ساعة<input name="v" inputmode="numeric" value="${h(s.settings.velocityPerHour)}"></label><button class="btn outline">حفظ</button></form></section>
        <section class="card mj-sec"><h3 class="f-h">${ic("clock")}بانتظار الموافقة</h3>
          ${pend.items.length ? `<ul class="list">${pend.items.map((x) => `<li class="li"><span class="t"><b>@${h(x.handle || "")} · ${h(x.sourceLabel || "")}</b><small>${h(day(x.createdAt))}${x.reason ? ` · ${h(x.reason)}` : ""}</small></span><span class="mj-amt in">${amt(x.amount)}</span>
            <span class="mj-acts"><button type="button" class="btn" data-ok="${h(x.id)}">موافقة</button><button type="button" class="btn ghost" data-no="${h(x.id)}">رفض</button></span></li>`).join("")}</ul>` : `<p class="f-hint">لا حركات معلّقة.</p>`}</section>
        <section class="card mj-sec"><h3 class="f-h">${ic("search")}البحث في الحركات</h3>
          <form id="rw-q"><label>العضو<input name="handle" placeholder="@handle" dir="ltr"></label>
            <label>الحالة<select name="status"><option value="">الكل</option><option value="posted">مُضافة</option><option value="open">معلّقة</option><option value="rejected">مرفوضة</option></select></label>
            <label>المصدر<select name="source"><option value="">الكل</option>${src.sources.map((x) => `<option value="${h(x.key)}">${h(x.label)}</option>`).join("")}<option value="admin">الإدارة</option></select></label>
            <button class="btn outline">بحث</button></form><div id="rw-qr"></div><div id="rw-det"></div></section>
        <section class="card mj-sec"><h3 class="f-h">${ic("wallet")}محفظة عضو</h3>
          <form id="rw-wl"><label>العضو<input name="handle" placeholder="@handle" dir="ltr" required></label><button class="btn outline">عرض</button></form><div id="rw-wr"></div></section>`;
      // sources
      box.querySelectorAll(".rw-src").forEach((f) => {
        f.addEventListener("submit", (e) => { e.preventDefault(); const g = (n) => f.elements[n].value.trim(); busy(e.submitter, async () => {
          await api("PUT", "/api/admin/mjt/rewards/sources/" + enc(f.dataset.key), { amount: g("amount") || null, dailyCap: g("dailyCap") || null, weeklyCap: g("weeklyCap") || null, monthlyCap: g("monthlyCap") || null, maxPerRef: g("maxPerRef") || null, requiresApproval: f.elements.approval.checked, enabled: f.elements.enabled.checked });
          say("حُفظ المصدر"); reload(); }); });
        f.querySelector("[data-del]").addEventListener("click", (e) => { if (!confirm("حذف هذا المصدر؟ المصادر ذات الحركات تُعطَّل ولا تُحذف.")) return; busy(e.currentTarget, async () => { await api("DELETE", "/api/admin/mjt/rewards/sources/" + enc(f.dataset.key)); say("حُذف المصدر"); reload(); }); });
      });
      box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("POST", "/api/admin/mjt/rewards/sources", { key: b.dataset.add }); say("أُضيف المصدر معطّلاً"); reload(); })));
      $("#rw-set").addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/api/admin/mjt/rewards/settings", { velocityPerHour: +e.target.v.value }); say("حُفظ الإعداد"); reload(); }); });
      // pending
      box.querySelectorAll("[data-ok]").forEach((b) => b.addEventListener("click", (e) => busy(e.currentTarget, async () => { await api("POST", `/api/admin/mjt/rewards/entries/${enc(b.dataset.ok)}/approve`, {}); say("أُضيفت المكافأة"); reload(); })));
      box.querySelectorAll("[data-no]").forEach((b) => b.addEventListener("click", (e) => { const reason = prompt("سبب الرفض (إلزامي)"); if (!reason) return; busy(e.currentTarget, async () => { await api("POST", `/api/admin/mjt/rewards/entries/${enc(b.dataset.no)}/reject`, { reason }); say("رُفضت المكافأة"); reload(); }); }));
      // search + detail
      $("#rw-q").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target, p = new URLSearchParams(); for (const n of ["handle", "status", "source"]) if (f.elements[n].value.trim()) p.set(n, f.elements[n].value.trim().replace(/^@/, ""));
        busy(e.submitter, async () => { const r = await api("GET", "/api/admin/mjt/rewards/entries?" + p.toString()); const out = $("#rw-qr");
          out.innerHTML = r.items.length ? `<ul class="list mj-hist">${r.items.map((x) => `<li class="li"><button type="button" class="t lnk" data-det="${h(x.id)}"><b>@${h(x.handle || "")} · ${h(x.kindLabel)}${x.sourceLabel ? ` · ${h(x.sourceLabel)}` : ""}</b><small>${h(day(x.createdAt))} · ${h(x.statusLabel)}</small></button><span class="mj-amt">${amt(x.amount)}</span></li>`).join("")}</ul>` : `<p class="f-hint">لا نتائج.</p>`;
          out.querySelectorAll("[data-det]").forEach((b) => b.addEventListener("click", () => busy(b, async () => { const d = await api("GET", "/api/admin/mjt/rewards/entries/" + enc(b.dataset.det)), x = d.entry;
            $("#rw-det").innerHTML = `<dl class="rw-det card u-p12"><div><dt>الرقم</dt><dd dir="ltr">${h(x.id)}</dd></div><div><dt>العضو</dt><dd>@${h(x.handle || "")}</dd></div><div><dt>النوع</dt><dd>${h(x.kindLabel)}</dd></div><div><dt>المبلغ</dt><dd>${amt(x.amount)}</dd></div><div><dt>الحالة</dt><dd>${h(x.statusLabel)}</dd></div><div><dt>المصدر</dt><dd>${h(x.sourceLabel || "—")}</dd></div><div><dt>السبب</dt><dd>${h(x.reason || "—")}</dd></div><div><dt>المنفّذ</dt><dd>${x.actor ? "@" + h(x.actor) : "—"}</dd></div><div><dt>الرصيد بعدها</dt><dd>${x.balanceAfter == null ? "—" : amt(x.balanceAfter)}</dd></div><div><dt>التاريخ</dt><dd>${h(day(x.createdAt))}</dd></div>${d.decision ? `<div><dt>القرار</dt><dd>${h(d.decision.statusLabel)} · ${h(day(d.decision.createdAt))}${d.decision.reason ? ` · ${h(d.decision.reason)}` : ""}</dd></div>` : ""}</dl>`; })));
        }); });
      // wallet lookup, freeze, corrective adjust
      $("#rw-wl").addEventListener("submit", (e) => { e.preventDefault(); const handle = e.target.handle.value.trim().replace(/^@/, ""); busy(e.submitter, () => showWallet(handle)); });
    };
    async function showWallet(handle) {
      const r = await api("GET", "/api/admin/mjt/rewards/wallets/" + enc(handle)), w = r.wallet, out = $("#rw-wr");
      let adjKey = newKey();
      out.innerHTML = `<dl class="rw-tot"><div><dt>الرصيد</dt><dd>${amt(w.balance)}</dd></div><div><dt>المكتسب</dt><dd>${amt(w.earnedTotal)}</dd></div><div><dt>المستخدم</dt><dd>${amt(w.spentTotal)}</dd></div><div><dt>الحالة</dt><dd>${w.frozen ? "موقوفة" : "نشطة"}</dd></div></dl>
        <form id="rw-fz"><label>السبب (إلزامي)<input name="reason" required minlength="5"></label><button class="btn ${w.frozen ? "outline" : "ghost"}" value="${w.frozen ? "0" : "1"}">${w.frozen ? "إعادة التفعيل" : "إيقاف مؤقت"}</button></form>
        <form id="rw-adj"><label>تصحيح<select name="direction"><option value="credit">إضافة</option><option value="debit">خصم</option></select></label><label>المبلغ (عدد صحيح)<input name="amount" inputmode="numeric" required></label><label>السبب (إلزامي)<input name="reason" required minlength="5"></label><button class="btn outline">تنفيذ التصحيح</button></form>
        ${r.entries.length ? `<ul class="list mj-hist">${r.entries.map((x) => row({ ...x, label: x.kindLabel, source: x.sourceLabel })).join("")}</ul>` : `<p class="f-hint">لا حركات مكافآت لهذا العضو.</p>`}`;
      $("#rw-fz").addEventListener("submit", (e) => { e.preventDefault(); const on = e.submitter?.value === "1"; busy(e.submitter, async () => { await api("POST", `/api/admin/mjt/rewards/wallets/${enc(handle)}/freeze`, { frozen: on, reason: e.target.reason.value.trim() }); say(on ? "أُوقفت المحفظة" : "أُعيد تفعيل المحفظة"); showWallet(handle); }); });
      $("#rw-adj").addEventListener("input", () => { adjKey = newKey(); });
      $("#rw-adj").addEventListener("submit", (e) => { e.preventDefault(); const f = e.target; if (!confirm(`تنفيذ تصحيح بمقدار ${f.amount.value.trim()} MJT لـ @${handle}؟`)) return;
        busy(e.submitter, async () => { await api("POST", `/api/admin/mjt/rewards/wallets/${enc(handle)}/adjust`, { direction: f.direction.value, amount: f.amount.value.trim(), reason: f.reason.value.trim(), ikey: adjKey }); adjKey = newKey(); say("نُفّذ التصحيح"); showWallet(handle); }); });
    }
    reload();
  }

  /** v2.164: #/rewards is an alias of the one wallet page; replace() keeps «back» from bouncing between the two */
  const redirect = () => { const t = qs().get("tab"); location.replace(t === "history" || t === "review" ? "#/mjt?tab=" + t : "#/mjt"); };
  MPRoutes.extend(() => ({ rewards: () => redirect() }));
  MPRoutes.add("admin", (a, b, next) => (a === "rewards" ? adminView() : next()));
  window.MPRewards = { adminView, redirect, version: "2.164.0" };
  if (/^#\/(rewards|admin\/rewards)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
