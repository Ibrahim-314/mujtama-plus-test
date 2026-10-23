/* =====================================================================
 * مجتمع بلس — Phase 53 UI (lazy "econ" chunk; 0 bytes in core): admin pricing manager and revenue / cost dashboard.
 *   #/admin/pricing   every paid thing with its current price, source, scheduled changes (cancel), suggested price (shown only;
 *                     applying it needs an explicit confirmation), new / scheduled change with grandfathering, history.
 *   #/admin/revenue   range + day/month: totals, by stream, series bars, liabilities, costs (manual + usage counters), Pi→USD
 *                     rate, margin, break-even, CSV export.
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function EconUI() {
  if (window.MPEcon) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const n = (x, d = 7) => Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: d });
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)); } catch { return String(iso); } };
  const $ = (s) => view.querySelector(s);
  const val = (it, v) => (v == null ? "—" : it.unit === "bps" ? `${n(v / 100, 2)}٪` : `<bdi dir="ltr">${n(v)} π</bdi>`);
  const page = (title, body, icon) => { view.innerHTML = `<div class="wrap ec-page">${UI.pageHead({ back: ["#/admin", "الإدارة"], title, icon: icon || (/الإيرادات/.test(title) ? "chart" : undefined), id: "ec-h" })}${body}</div>`; $("#ec-h")?.focus({ preventScroll: true }); };
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const ST = { active: "سارٍ", scheduled: "مجدول", superseded: "سابق", cancelled: "ملغى" };
  if (!document.getElementById("ec-css")) document.head.insertAdjacentHTML("beforeend", `<style id="ec-css">
.ec-page{max-width:760px;margin:auto}.ec-page h2:focus{outline:none}.ec-it{padding:12px 14px;border-radius:16px;border:1px solid var(--line,#e5e5e5);margin-bottom:10px}
.ec-it .top{display:flex;gap:8px;align-items:baseline;justify-content:space-between;flex-wrap:wrap}.ec-it .cur{font-size:18px;font-weight:800}
.ec-sug{margin-top:8px;padding:8px 10px;border-radius:12px;background:#f59e0b14;font-size:13px}.ec-chip{font-size:12px;padding:2px 8px;border-radius:999px;background:#8882;margin-inline-start:6px}
.ec-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.ec-row .btn{min-height:44px}.ec-f label{display:block;margin-top:8px}.ec-f input,.ec-f select{width:100%;min-height:44px;box-sizing:border-box}
.ec-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:10px 0}.ec-k div{padding:12px;border-radius:14px;background:#8881}.ec-k b{display:block;font-size:19px}
.ec-t{width:100%;border-collapse:collapse;font-size:14px}.ec-t th,.ec-t td{padding:8px 6px;border-bottom:1px solid var(--line,#eee);text-align:start}.ec-t td.n{direction:ltr;text-align:end}
.ec-bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding:8px 0;overflow-x:auto}.ec-bars span{flex:1;min-width:8px;background:var(--brand,#5b2bd6);border-radius:4px 4px 0 0;position:relative}
.ec-scroll{overflow-x:auto}.ec-ok{color:#15803d}.ec-bad{color:#b91c1c}
</style>`);

  /* ---------- #/admin/pricing ---------- */
  async function pricingView() {
    page("الأسعار والرسوم", `<div class="skel"></div><div class="skel"></div>`, "coin");
    const wrap = $(".wrap"); /* stale-route guard: never strip skeletons from, or append into, the page the member moved on to */
    let d; try { d = await api("GET", "/api/admin/pricing"); } catch (e) { if (wrap?.isConnected) { wrap.querySelectorAll(".skel").forEach((x) => x.remove()); wrap.insertAdjacentHTML("beforeend", errBox(e)); } return; }
    if (!wrap?.isConnected) return;
    wrap.querySelectorAll(".skel").forEach((x) => x.remove());
    const pending = d.items.filter((i) => i.suggested && !i.suggested.applied);
    $(".wrap").insertAdjacentHTML("beforeend", `<p class="muted">${h(d.note)}</p>
      ${pending.length ? `<div class="ec-sug" role="note"><b>أسعار مقترحة لم تُطبَّق بعد (${pending.length})</b> — راجعها ثم اضغط «تطبيق المقترح» عند كل بند، أو طبّقها كلها مرة واحدة.<div class="ec-row"><button type="button" class="btn ghost" id="ec-all">تطبيق كل المقترحات…</button></div></div>` : ""}
      ${d.items.map((it) => `<section class="ec-it" aria-labelledby="ec-${h(it.key)}"><div class="top"><b id="ec-${h(it.key)}">${h(it.label)}</b><span class="cur">${val(it, it.current)}</span></div>
        <div class="u-t-sm muted">${it.source === "env" ? "القيمة الافتراضية للخادم" : it.source === "plan" ? "من إعداد الخطة" : "من سجل الأسعار"}${it.active ? ` · منذ ${day(it.active.appliedAt || it.active.effectiveAt)}` : ""}${it.grandfathered ? ` · ${n(it.grandfathered, 0)} مشترك بسعر محفوظ` : ""}</div>
        ${it.scheduled.map((s) => `<div class="ec-row"><span class="ec-chip">مجدول</span><span>${val(it, s.value)} في ${day(s.effectiveAt)}${s.grandfather ? " · مع حماية المشتركين الحاليين" : ""}</span><button type="button" class="btn ghost" data-cancel="${h(s.id)}">إلغاء</button></div>`).join("")}
        ${it.suggested ? `<div class="ec-sug">المقترح: <b>${val(it, it.unit === "pi" ? it.suggested.value : it.suggested.value)}</b> — ${h(it.suggested.reason)}${it.suggested.applied ? ` <span class="ec-chip">مطبّق</span>` : `<div class="ec-row"><button type="button" class="btn ghost" data-sug="${h(it.key)}">تطبيق المقترح…</button></div>`}</div>` : ""}
        <div class="ec-row"><button type="button" class="btn" data-edit="${h(it.key)}">تغيير السعر</button>${it.source === "price_book" && it.key.startsWith("fee.") ? `<button type="button" class="btn ghost" data-revert="${h(it.key)}">إرجاع للافتراضي</button>` : ""}<button type="button" class="btn ghost" data-hist="${h(it.key)}">السجل</button></div>
        <div data-slot="${h(it.key)}"></div></section>`).join("")}`);
    const item = (k) => d.items.find((i) => i.key === k);
    const confirmTxt = (it, v, when) => `تأكيد: «${it.label}» ← ${it.unit === "bps" ? n(v, 2) + "٪" : n(v) + " π"} ${when ? "ابتداءً من " + day(when) : "فوراً"}؟`;
    view.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
      const it = item(b.dataset.edit), slot = view.querySelector(`[data-slot="${CSS.escape(it.key)}"]`);
      slot.innerHTML = `<form class="ec-f"><label>${it.unit === "bps" ? "النسبة المئوية (٪)" : "السعر (π)"}<input type="number" name="v" step="any" min="0" required value="${it.current == null ? "" : it.unit === "bps" ? it.current / 100 : it.current}"></label>
        <label>يسري من (اتركه فارغاً للتطبيق فوراً)<input type="datetime-local" name="at"></label>
        ${it.grandfatherable ? `<label class="u-dflex u-g8 u-aic"><input type="checkbox" name="gf" checked style="width:auto;min-height:auto"> يحتفظ المشتركون الحاليون بسعرهم القديم</label><label>مدة الحماية بالأيام (فارغ = ما داموا يجدّدون)<input type="number" name="gd" min="1" max="3650"></label>` : ""}
        <label>ملاحظة<input type="text" name="note" maxlength="300"></label><div class="ec-row"><button class="btn">حفظ</button></div></form>`;
      slot.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault(); const f = e.target, raw = Number(f.v.value), v = it.unit === "bps" ? Math.round(raw * 100) : raw, at = f.at.value ? new Date(f.at.value).toISOString() : null;
        if (!confirm(confirmTxt(it, it.unit === "bps" ? raw : raw, at))) return;
        try { await api("POST", "/api/admin/pricing", { item: it.key, value: v, effectiveAt: at, grandfather: !!f.gf?.checked, grandfatherDays: f.gd?.value ? Number(f.gd.value) : null, note: f.note.value || null, confirm: true }); say("حُفظ ✓"); pricingView(); } catch (x) { say(x.message); }
      });
    }));
    view.querySelectorAll("[data-sug]").forEach((b) => b.addEventListener("click", async () => {
      const it = item(b.dataset.sug); if (!confirm(confirmTxt(it, it.unit === "bps" ? it.suggested.value / 100 : it.suggested.value, null))) return;
      try { await api("POST", "/api/admin/pricing/suggested", { items: [it.key], confirm: true }); say("طُبّق ✓"); pricingView(); } catch (x) { say(x.message); }
    }));
    $("#ec-all")?.addEventListener("click", async () => { if (!confirm(`تطبيق ${pending.length} سعراً مقترحاً فوراً؟ يحتفظ المشتركون الحاليون بأسعارهم.`)) return; try { await api("POST", "/api/admin/pricing/suggested", { items: pending.map((i) => i.key), confirm: true }); say("طُبّقت ✓"); pricingView(); } catch (x) { say(x.message); } });
    view.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => { try { await api("DELETE", "/api/admin/pricing/" + enc(b.dataset.cancel)); pricingView(); } catch (x) { say(x.message); } }));
    view.querySelectorAll("[data-revert]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("إرجاع إلى القيمة الافتراضية للخادم؟")) return; try { await api("POST", "/api/admin/pricing/revert", { item: b.dataset.revert }); pricingView(); } catch (x) { say(x.message); } }));
    view.querySelectorAll("[data-hist]").forEach((b) => b.addEventListener("click", async () => {
      const it = item(b.dataset.hist), slot = view.querySelector(`[data-slot="${CSS.escape(it.key)}"]`);
      try { const r = await api("GET", "/api/admin/pricing/history?item=" + enc(it.key));
        slot.innerHTML = `<div class="ec-scroll"><table class="ec-t"><thead><tr><th>القيمة</th><th>الحالة</th><th>يسري</th><th>ملاحظة</th></tr></thead><tbody>${r.items.map((x) => `<tr><td>${val(it, x.value)}</td><td>${ST[x.status] || h(x.status)}${x.source === "suggested" ? " · مقترح" : ""}</td><td>${day(x.effectiveAt)}</td><td>${h(x.note || "")}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">لا تغييرات مسجلة</td></tr>`}</tbody></table></div>`;
      } catch (x) { slot.innerHTML = errBox(x); }
    }));
  }

  /* ---------- #/admin/revenue ---------- */
  const R = { group: "day", from: "", to: "" };
  async function revenueView() {
    page("الإيرادات والتكاليف", `<form id="ec-rg" class="ec-row"><input type="date" name="from" value="${h(R.from)}" aria-label="من"><input type="date" name="to" value="${h(R.to)}" aria-label="إلى"><select name="group" aria-label="التجميع"><option value="day">يومي</option><option value="month"${R.group === "month" ? " selected" : ""}>شهري</option></select><button class="btn">عرض</button></form><div id="ec-body"><div class="skel"></div></div>`);
    $("#ec-rg").addEventListener("submit", (e) => { e.preventDefault(); R.from = e.target.from.value; R.to = e.target.to.value; R.group = e.target.group.value; revenueView(); });
    const q = `?group=${R.group}${R.from ? "&from=" + enc(R.from) : ""}${R.to ? "&to=" + enc(R.to) : ""}`;
    /* Fast route changes: if the member left while this loaded, the body is gone — drop the stale result instead of writing into the next page. */
    const body = $("#ec-body");
    let d; try { d = await api("GET", "/api/admin/revenue" + q); } catch (e) { if (body?.isConnected) body.innerHTML = errBox(e); return; }
    if (!body?.isConnected) return;
    const t = d.totals, m = d.margin, b = d.breakEven, max = Math.max(0.0000001, ...d.series.map((s) => s.platform));
    body.innerHTML = `<div class="ec-k"><div><b><bdi dir="ltr">${n(t.paidIn)} π</bdi></b>مدفوعات الأعضاء</div><div><b><bdi dir="ltr">${n(t.platform)} π</bdi></b>حصة المنصة</div><div><b><bdi dir="ltr">${n(t.creators)} π</bdi></b>لصنّاع المحتوى والبائعين</div><div><b><bdi dir="ltr">${n(t.refunds)} π</bdi></b>مبالغ مستردة</div></div>
      <h3>حسب المصدر</h3><div class="ec-scroll"><table class="ec-t"><thead><tr><th>المصدر</th><th>مدفوع</th><th>المنصة</th><th>الصنّاع</th><th>مسترد</th></tr></thead><tbody>${d.streams.map((s) => `<tr><td>${h(s.label)}</td><td class="n">${n(s.paidIn)}</td><td class="n">${n(s.platform)}</td><td class="n">${n(s.creators)}</td><td class="n">${n(s.refunds)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">لا حركات في هذه الفترة</td></tr>`}</tbody></table></div>
      <h3>حصة المنصة ${R.group === "month" ? "شهرياً" : "يومياً"}</h3><div class="ec-bars" role="img" aria-label="حصة المنصة عبر الزمن">${d.series.map((s) => `<span style="height:${Math.max(2, Math.round((s.platform / max) * 100))}%" title="${h(s.period)}: ${n(s.platform)} π"></span>`).join("") || `<span class="muted" style="background:none">—</span>`}</div>
      <p class="u-t-sm muted">أرصدة محجوزة (ليست إيراداً): ضمان السوق ${n(d.liabilities.escrow)} π · معلّق للمراجعة ${n(d.liabilities.held)} π · ميزانيات إعلانية غير مصروفة ${n(d.liabilities.adBudgets)} π · تحويلات بين الأعضاء ${n(t.transfers)} π</p>
      <h3>التكاليف (دولار)</h3><div class="ec-scroll"><table class="ec-t"><thead><tr><th>الشهر</th><th>يدوي</th><th>عدّادات الاستخدام</th><th>الإجمالي</th></tr></thead><tbody>${d.costs.months.map((c) => `<tr><td>${h(c.month)}</td><td class="n">$${n(c.manualUsd, 2)}</td><td class="n">$${n(c.usageUsd, 4)}</td><td class="n">$${n(c.totalUsd, 2)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">لم تُسجَّل تكاليف بعد</td></tr>`}</tbody></table></div>
      <ul class="u-lsn u-p0 ec-t">${d.costs.entries.map((c) => `<li class="u-jsb ec-row"><span>${h(c.month)} · ${h(c.category)}${c.provider ? " · " + h(c.provider) : ""}${c.note ? " — " + h(c.note) : ""}</span><span><bdi dir="ltr">$${n(c.amountUsd, 2)}</bdi> <button type="button" class="btn ghost" data-del="${h(c.id)}" aria-label="حذف التكلفة">حذف</button></span></li>`).join("")}</ul>
      <form id="ec-cost" class="u-p12 ec-f card"><b>إضافة تكلفة شهرية</b><label>الشهر<input type="month" name="month" required value="${new Date().toISOString().slice(0, 7)}"></label><label>التصنيف<select name="category">${[["hosting", "استضافة (Railway)"], ["database", "قاعدة البيانات"], ["provider", "مزوّد خدمة (ذكاء/بريد)"], ["domain", "نطاق"], ["other", "أخرى"]].map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label><label>المزوّد<input type="text" name="provider" maxlength="60" placeholder="Railway"></label><label>المبلغ بالدولار<input type="number" name="usd" step="0.01" min="0" required></label><label>ملاحظة<input type="text" name="note" maxlength="300"></label><div class="ec-row"><button class="btn">إضافة</button></div></form>
      <h3>الهامش ونقطة التعادل</h3><form id="ec-rate" class="ec-row"><label class="u-f1">سعر Pi بالدولار<input type="number" name="rate" step="any" min="0" value="${m.piUsdRate ?? ""}" class="u-w100 u-mh44"></label><button class="btn">حفظ</button></form>
      ${m.note ? `<p class="muted">${h(m.note)}</p>` : `<div class="ec-k"><div><b>$${n(m.revenueUsd, 2)}</b>إيراد المنصة</div><div><b>$${n(m.costUsd, 2)}</b>التكاليف</div><div><b class="${m.marginUsd >= 0 ? "ec-ok" : "ec-bad"}">$${n(m.marginUsd, 2)}</b>الهامش${m.marginPct != null ? ` (${n(m.marginPct, 1)}٪)` : ""}</div></div>`}
      <p>${b.reached === true ? `<span class="ec-ok">✓ الإيراد يغطي التكاليف في هذه الفترة</span>` : b.reached === false ? `<span class="ec-bad">لم تُبلغ نقطة التعادل بعد</span>` : ""} التكلفة الشهرية ≈ $${n(b.monthlyCostUsd, 2)}${b.payersNeeded ? ` · تحتاج نحو ${n(b.payersNeeded, 0)} عضواً دافعاً بالمتوسط الحالي (${n(b.payers, 0)} الآن)` : ""}${b.aiSubscribersNeeded ? ` · أو ${n(b.aiSubscribersNeeded, 0)} مشتركاً في «مجتمع+ ذكاء»` : ""}</p>
      <div class="ec-row"><a class="btn ghost" href="/api/admin/revenue.csv${q}" download>تصدير CSV</a></div>`;
    $("#ec-cost").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { await api("POST", "/api/admin/costs", { month: f.month.value, category: f.category.value, provider: f.provider.value || null, amountUsd: Number(f.usd.value), note: f.note.value || null }); say("أُضيفت ✓"); revenueView(); } catch (x) { say(x.message); } });
    $("#ec-rate").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PUT", "/api/admin/finance/settings", { piUsdRate: e.target.rate.value === "" ? null : Number(e.target.rate.value) }); revenueView(); } catch (x) { say(x.message); } });
    view.querySelectorAll("[data-del]").forEach((x) => x.addEventListener("click", async () => { if (!confirm("حذف هذه التكلفة؟")) return; try { await api("DELETE", "/api/admin/costs/" + enc(x.dataset.del)); revenueView(); } catch (er) { say(er.message); } }));
  }

  MPRoutes.add("admin", (a, b, next) => (a === "pricing" ? pricingView() : a === "revenue" ? revenueView() : next()));
  window.MPEcon = { pricingView, revenueView, version: "2.26.0" };
  if (/^#\/admin\/(pricing|revenue)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
