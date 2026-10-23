/* =====================================================================
 * مجتمع بلس — Phase 60 UI: financial transparency (lazy "finance" chunk; 0 bytes in core).
 *   #/statement        account statement: date + category filters, totals, every Pi line, CSV, documents
 *   #/invoice/:id      invoice / credit note / payout receipt — printable (print → save as PDF), HTML download
 *   #/annual           annual summary (member spend + creator earnings, month by month)
 *   #/finance-report   public platform transparency report (aggregate, k-anonymous); also /transparency/finance
 *   #/admin/finance    reconciliation ledger vs Pi payments, annual summary for any member, issue documents now
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function FinanceUI() {
  if (window.MPFinance) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const num = (x) => (x === null || x === undefined ? "—" : `<bdi dir="ltr">${Number(x).toLocaleString("en-US", { maximumFractionDigits: 7 })}</bdi>`);
  const day = (iso) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(iso)); } catch { return String(iso); } };
  const $ = (s) => view.querySelector(s);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const ICO = { "كشف الحساب": "doc", "المستند": "receipt", "التقرير السنوي": "chart", "الشفافية المالية للمنصة": "scale", "التقارير المالية والمطابقة": "receipt" };
  const page = (title, body, back) => { view.innerHTML = `<div class="wrap fn-page">${UI.pageHead({ back, title, icon: ICO[title], id: "fn-h" })}${body}</div>`; $("#fn-h")?.focus({ preventScroll: true }); };
  const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  if (!document.getElementById("fn-css")) document.head.insertAdjacentHTML("beforeend", `<style id="fn-css">
.fn-page{max-width:760px;margin:auto}.fn-page h2:focus{outline:none}.fn-row{display:flex;gap:8px;flex-wrap:wrap;align-items:end;margin:8px 0}.fn-row .btn,.fn-row a.btn{min-height:44px}
.fn-f label{display:flex;flex-direction:column;gap:4px;font-size:13px;flex:1;min-width:130px}.fn-f input,.fn-f select{min-height:44px;width:100%;box-sizing:border-box}
.fn-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:10px 0}.fn-s{padding:12px;border-radius:14px;background:#8881}.fn-s b{display:block;font-size:20px}.fn-s span{font-size:13px;color:var(--muted,#666)}
.fn-list{list-style:none;padding:0;margin:0}.fn-list li{display:flex;gap:10px;align-items:center;padding:12px 4px;border-bottom:1px solid var(--line,#eee);min-height:44px}.fn-list .grow{flex:1;min-width:0}.fn-in{color:var(--ok-ink,#0f7a4a)}.fn-out{color:inherit}
.fn-note{padding:10px 12px;border-radius:12px;background:#8881;font-size:14px;margin:8px 0}.fn-chips{display:flex;gap:6px;overflow-x:auto;padding:4px 0}.fn-chips a{white-space:nowrap;min-height:44px;display:inline-flex;align-items:center}
.fn-t{width:100%;border-collapse:collapse;font-size:14px}.fn-t th,.fn-t td{padding:8px 6px;border-bottom:1px solid var(--line,#eee);text-align:start}.fn-t td.n{text-align:end}
.fn-bars{display:flex;gap:4px;align-items:flex-end;height:120px;margin:10px 0}.fn-bars div{flex:1;background:var(--accent,#5b2bd6);border-radius:6px 6px 0 0;min-height:2px}.fn-bl{display:flex;gap:4px;font-size:10px;color:var(--muted,#666)}.fn-bl span{flex:1;text-align:center}
.fn-doc{padding:20px;border:1px solid var(--line,#eee);border-radius:16px;background:var(--card,#fff)}.fn-doc .top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;border-bottom:2px solid var(--accent,#5b2bd6);padding-bottom:10px;margin-bottom:10px}.fn-mono{font-family:ui-monospace,monospace;direction:ltr;unicode-bidi:isolate}
@media print{.topbar,.bottomnav,.fab,.fn-noprint,#toast{display:none!important}.fn-page{max-width:none}.fn-doc{border:0}body{background:#fff}}
</style>`);

  /* ---------- #/statement ---------- */
  async function statementView() {
    const q = qs(), from = q.get("from") || "", to = q.get("to") || "", cat = q.get("category") || "";
    const query = () => [from && "from=" + enc(from), to && "to=" + enc(to), cat && "category=" + enc(cat)].filter(Boolean).join("&");
    page("كشف الحساب", `<p class="muted">كل حركة Pi في حسابك: ما دفعته وما وصلك والاستردادات والمدفوعات إلى محفظتك.</p>
      <form id="fn-sf" class="fn-row fn-f fn-noprint"><label>من<input type="date" name="from" value="${h(from)}"></label><label>إلى<input type="date" name="to" value="${h(to)}"></label>
      <label>النوع<select name="category" id="fn-cat"><option value="">الكل</option></select></label><button class="btn">تطبيق</button></form>
      <div class="fn-row fn-noprint"><a class="btn ghost" href="#/annual">التقرير السنوي</a><a class="btn ghost" id="fn-csv" href="/api/finance/statement.csv${query() ? "?" + query() : ""}" download>تنزيل CSV</a><a class="btn ghost" href="#/finance-report">شفافية المنصة</a></div>
      <div id="fn-s" aria-live="polite"><div class="skel"></div><div class="skel"></div></div>`, ["#/wallet", "المحفظة"]);
    const box = $("#fn-s"); /* stale-route guard (fast navigation) */
    let d; try { d = await api("GET", "/api/finance/statement" + (query() ? "?" + query() : "")); } catch (e) { if (box?.isConnected) box.innerHTML = errBox(e); return; }
    if (!box?.isConnected) return;
    $("#fn-cat").insertAdjacentHTML("beforeend", d.categories.map((c) => `<option value="${c.key}" ${c.key === cat ? "selected" : ""}>${h(c.label)}</option>`).join(""));
    $("#fn-sf").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); const p = ["from", "to", "category"].map((k) => f.get(k) ? `${k}=${enc(f.get(k))}` : "").filter(Boolean).join("&"); location.hash = "#/statement" + (p ? "?" + p : ""); });
    const T = d.totals;
    $("#fn-s").innerHTML = `<div class="fn-g"><div class="fn-s"><b>${num(T.paid)}</b><span>دفعتَ (π)</span></div><div class="fn-s"><b>${num(T.refunds)}</b><span>استردادات</span></div><div class="fn-s"><b>${num(T.earned)}</b><span>وصلك (أرباح وتحويلات)</span></div><div class="fn-s"><b>${num(T.paidOut)}</b><span>صُرف إلى محفظتك</span></div></div>
      ${d.note ? `<div class="empty">${h(d.note)}</div>` : ""}<ul class="fn-list" id="fn-l" aria-label="الحركات"></ul><div class="fn-row"><button type="button" class="btn ghost fn-noprint" id="fn-more" hidden>المزيد</button></div>`;
    const add = (lines) => $("#fn-l").insertAdjacentHTML("beforeend", lines.map((l) => `<li><span class="grow"><b>${h(l.label)}</b><span class="u-db u-t-sm muted">${h(l.categoryLabel)} · ${h(l.accountLabel)}${l.counterparty ? ` · ${l.counterparty.handle ? `<bdi dir="ltr">@${h(l.counterparty.handle)}</bdi>` : h(l.counterparty.name)}` : ""} · ${day(l.at)}</span>${l.document ? `<a href="#/invoice/${enc(l.document.id)}" class="u-t-xs fn-mono">${h(l.document.number)}</a>` : ""}</span>
      <b class="${l.direction === "in" ? "fn-in" : "fn-out"}" aria-label="${l.direction === "in" ? "وارد" : "صادر"} ${l.amount} باي">${l.direction === "in" ? "+" : "−"}${num(l.amount)} π</b></li>`).join(""));
    let next = d.next; add(d.lines); $("#fn-more").hidden = !next;
    $("#fn-more").addEventListener("click", async () => { try { const r = await api("GET", "/api/finance/statement?" + [query(), "cursor=" + enc(next)].filter(Boolean).join("&")); if (!box.isConnected) return; next = r.next; add(r.lines); $("#fn-more").hidden = !next; } catch (e) { say(e.message); } });
  }

  /* ---------- #/invoice/:id ---------- */
  async function invoiceView(id) {
    page("المستند", `<div id="fn-d"><div class="skel"></div></div>`, ["#/statement", "كشف الحساب"]);
    const box = $("#fn-d"); /* stale-route guard (fast navigation) */
    let d; try { d = (await api("GET", "/api/finance/invoices/" + enc(id))).document; } catch (e) { if (box?.isConnected) box.innerHTML = errBox(e); return; }
    if (!box?.isConnected) return;
    $("#fn-h").textContent = d.title;
    const who = (p) => `${h(p.name)}${p.handle ? ` <bdi dir="ltr">@${h(p.handle)}</bdi>` : ""}`;
    const [a, b] = d.series === "CN" ? [d.payee, d.payer] : [d.payer, d.payee];
    $("#fn-d").innerHTML = `<article class="fn-doc" aria-labelledby="fn-h"><div class="top"><div><b class="u-c-ac">مجتمع بلس</b><div class="u-t-sm muted">${h(d.categoryLabel)}</div></div><div class="u-te"><b>${h(d.title)}</b><div class="fn-mono">${h(d.number)}</div></div></div>
      <table class="fn-t"><tbody><tr><th scope="row">${d.series === "RC" ? "الجهة الصارفة" : "الدافع"}</th><td>${who(a)}</td></tr><tr><th scope="row">${d.series === "RC" ? "المستلم" : "المستفيد"}</th><td>${who(b)}</td></tr>
      <tr><th scope="row">البيان</th><td>${h(d.label)}${d.creditOf ? ` — عن <span class="fn-mono">${h(d.creditOf)}</span>` : ""}</td></tr><tr><th scope="row">تاريخ العملية</th><td>${day(d.journalAt)}</td></tr><tr><th scope="row">تاريخ الإصدار</th><td>${day(d.issuedAt)}</td></tr>
      ${d.fee > 0 ? `<tr><th scope="row">رسوم المنصة</th><td>${num(d.fee)} π</td></tr><tr><th scope="row">صافي المستفيد</th><td>${num(d.net)} π</td></tr>` : ""}
      <tr><th scope="row">الإجمالي</th><td><b class="u-t-xl">${num(d.amount)} π</b></td></tr>${d.piTx ? `<tr><th scope="row">مرجع الدفع</th><td class="u-wba fn-mono">${h(d.piTx)}</td></tr>` : ""}</tbody></table>
      <p class="u-t-xs muted">مُولَّد من السجل المحاسبي للمنصة ولا يُعدَّل بعد إصداره؛ أي استرداد يصدر له إشعار دائن مستقل.</p></article>
      <div class="fn-row fn-noprint"><button type="button" class="btn" id="fn-print">طباعة / حفظ PDF</button><a class="btn ghost" href="${h(d.html)}?download=1" download>تنزيل HTML</a></div>`;
    $("#fn-print").addEventListener("click", () => window.print());
  }

  /* ---------- #/annual ---------- */
  async function annualView() {
    const y = Number(qs().get("year")) || new Date().getUTCFullYear(), cur = new Date().getUTCFullYear();
    page("التقرير السنوي", `<div class="fn-chips fn-noprint">${[cur, cur - 1, cur - 2].map((x) => `<a class="btn ghost" href="#/annual?year=${x}" aria-current="${x === y}">${x}</a>`).join("")}</div><div id="fn-a"><div class="skel"></div></div>`, ["#/statement", "كشف الحساب"]);
    const box = $("#fn-a"); /* stale-route guard (fast navigation) */
    let d; try { d = await api("GET", "/api/finance/annual?year=" + y); } catch (e) { if (box?.isConnected) box.innerHTML = errBox(e); return; }
    if (!box?.isConnected) return;
    $("#fn-a").innerHTML = annualHtml(d) + `<div class="fn-row fn-noprint"><button type="button" class="btn ghost" id="fn-print">طباعة / حفظ PDF</button></div>`;
    $("#fn-print").addEventListener("click", () => window.print());
  }
  function annualHtml(d) {
    const M = d.member, C = d.creator, max = Math.max(0.0000001, ...C.monthly);
    const cats = (o) => Object.values(o.byCategory || {}).length ? `<table class="fn-t"><tbody>${Object.values(o.byCategory).map((c) => `<tr><td>${h(c.label)}</td><td class="n">${num(c.amount)} π</td></tr>`).join("")}</tbody></table>` : "";
    return `${d.note ? `<div class="empty">${h(d.note)}</div>` : ""}<h3 class="u-t-lg">ما دفعته في ${d.year}</h3><div class="fn-g"><div class="fn-s"><b>${num(M.paid)}</b><span>مدفوعات (π)</span></div><div class="fn-s"><b>${num(M.refunds)}</b><span>استردادات</span></div><div class="fn-s"><b>${num(M.net)}</b><span>الصافي</span></div></div>${cats(M)}
      ${d.isCreator ? `<h3 class="u-t-lg">أرباحك كمبدع وبائع</h3><div class="fn-g"><div class="fn-s"><b>${num(C.earned)}</b><span>إجمالي ما وصلك</span></div><div class="fn-s"><b>${num(C.fees)}</b><span>رسوم المنصة</span></div><div class="fn-s"><b>${num(C.reversed)}</b><span>مُعاد للدافعين</span></div><div class="fn-s"><b>${num(C.paidOut)}</b><span>صُرف لمحفظتك</span></div><div class="fn-s"><b>${num(C.supporters)}</b><span>داعمون مختلفون</span></div></div>${cats(C)}
      <div class="fn-bars" role="img" aria-label="الأرباح شهرياً: ${C.monthly.map((v, i) => `${MONTHS[i]} ${v}`).join("، ")}">${C.monthly.map((v) => `<div style="height:${Math.round((v / max) * 100)}%"></div>`).join("")}</div><div class="fn-bl" aria-hidden="true">${MONTHS.map((m) => `<span>${m.slice(0, 3)}</span>`).join("")}</div>` : ""}
      <p class="u-t-sm muted">${num(d.documents)} مستند مالي في هذه السنة. <a href="#/statement?from=${d.year}-01-01&to=${d.year}-12-31">عرض الحركات</a></p>`;
  }

  /* ---------- #/finance-report (public) ---------- */
  async function reportView() {
    const y = Number(qs().get("year")) || new Date().getUTCFullYear();
    page("الشفافية المالية للمنصة", `<p class="muted">أرقام مجمّعة لحركة Pi في مجتمع بلس — لا تظهر فيها معاملات أي شخص بعينه.</p><div id="fn-r"><div class="skel"></div></div>`, ["#/explore", "استكشف"]);
    const box = $("#fn-r"); /* stale-route guard (fast navigation) */
    let d; try { d = await api("GET", "/api/finance/transparency?year=" + y); } catch (e) { if (box?.isConnected) box.innerHTML = errBox(e); return; }
    if (!box?.isConnected) return;
    const T = d.totals, Rs = d.reserves;
    $("#fn-r").innerHTML = `${d.note ? `<div class="fn-note">${h(d.note)}</div>` : ""}<h3 class="u-t-lg">${d.year}</h3>
      <div class="fn-g"><div class="fn-s"><b>${num(T.volume)}</b><span>حجم المدفوعات (π)</span></div><div class="fn-s"><b>${num(T.fees)}</b><span>رسوم المنصة</span></div><div class="fn-s"><b>${num(T.payouts)}</b><span>مدفوعات للأعضاء</span></div><div class="fn-s"><b>${num(T.refunds)}</b><span>استردادات</span></div></div>
      <h3 class="u-t-lg">الاحتياطيات الآن</h3><div class="fn-g"><div class="fn-s"><b>${num(Rs.heldForReview)}</b><span>قيد المراجعة</span></div><div class="fn-s"><b>${num(Rs.marketEscrow)}</b><span>ضمان السوق</span></div><div class="fn-s"><b>${num(Rs.adBudgets)}</b><span>ميزانيات إعلانية</span></div><div class="fn-s"><b>${num(Rs.owedToMembers)}</b><span>مستحقة للأعضاء</span></div><div class="fn-s"><b>${num(Rs.rewardsPool)}</b><span>صندوق المكافآت</span></div></div>
      <table class="fn-t"><caption class="u-ts muted">شهرياً (π) — «—» تعني أرقاماً محجوبة لقلة الأعضاء</caption><thead><tr><th scope="col">الشهر</th><th scope="col">الحجم</th><th scope="col">الرسوم</th><th scope="col">الاستردادات</th></tr></thead><tbody>${d.months.map((m, i) => `<tr><td>${MONTHS[i]}</td><td class="n">${num(m.volume)}</td><td class="n">${num(m.fees)}</td><td class="n">${num(m.refunds)}</td></tr>`).join("")}</tbody></table>
      ${d.notes.map((n) => `<p class="u-t-sm muted">${h(n)}</p>`).join("")}<p><a href="/transparency/finance?year=${d.year}">نسخة الصفحة العامة</a></p>`;
  }

  /* ---------- #/admin/finance ---------- */
  async function adminView() {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
    page("التقارير المالية والمطابقة", `<form id="fn-rf" class="fn-row fn-f"><label>من<input type="date" name="from" value="${since}"></label><label>إلى<input type="date" name="to" value="${today}"></label><button class="btn">مطابقة السجل مع مدفوعات Pi</button></form>
      <div id="fn-rr" aria-live="polite"></div>
      <h3 class="u-t-lg">التقرير السنوي لعضو أو مبدع</h3><form id="fn-af" class="fn-row fn-f"><label>اسم المستخدم<input name="user" required placeholder="@handle" dir="ltr"></label><label>السنة<input type="number" name="year" value="${new Date().getUTCFullYear()}" min="2020" max="2100"></label><button class="btn ghost">عرض</button></form><div id="fn-ar"></div>
      <div class="fn-row"><button type="button" class="btn ghost" id="fn-iss">إصدار المستندات المتأخرة الآن</button><a class="btn ghost" href="#/finance-report">التقرير العام</a></div>`, ["#/admin", "الإدارة"]);
    const TYPES = { missing_journal: "دفعة مكتملة بلا قيد", amount_mismatch: "اختلاف في المبلغ", refunded_not_reversed: "مُستردّة دون عكس القيد", orphan_journal: "قيد بلا دفعة", journal_for_unfinished_payment: "قيد لدفعة غير مكتملة", unledgered: "غرض لا يُقيَّد (للعلم)" };
    async function run(from, to) {
      const out = $("#fn-rr"); if (out) out.innerHTML = `<div class="skel"></div>`;
      if (!out) return;
      let r; try { r = await api("GET", `/api/admin/finance/reconcile?from=${enc(from)}&to=${enc(to)}`); } catch (e) { if (out.isConnected) out.innerHTML = errBox(e); return; }
      if (!out.isConnected) return; /* stale-route guard (fast navigation) */
      const S = r.summary;
      out.innerHTML = `<div class="fn-note" role="status">${r.result === "ok" ? "متطابق" : "توجد فروقات"} · فُحصت ${num(S.payments)} دفعة، تطابقت ${num(S.matched)} · السجل متوازن: ${r.integrity?.balanced ? "نعم" : "لا"}</div>${r.note ? `<div class="empty">${h(r.note)}</div>` : ""}
        <div class="fn-g"><div class="fn-s"><b>${num(S.piReceived)}</b><span>مستلم عبر Pi</span></div><div class="fn-s"><b>${num(S.ledgerPaid)}</b><span>في السجل</span></div><div class="fn-s"><b>${num(S.refunded)}</b><span>مُسترد</span></div><div class="fn-s"><b>${num(S.high)}</b><span>فروقات مهمة</span></div></div>
        ${r.issues.length ? `<table class="fn-t"><thead><tr><th scope="col">النوع</th><th scope="col">المرجع</th><th scope="col">المبلغ</th></tr></thead><tbody>${r.issues.map((i) => `<tr><td>${h(TYPES[i.type] || i.type)}</td><td class="u-wba fn-mono">${h(i.tx || i.journal || "")}</td><td class="n">${i.amount !== undefined ? num(i.amount) : ""}${i.ledger !== undefined ? ` / ${num(i.ledger)}` : ""}</td></tr>`).join("")}</tbody></table>` : ""}`;
    }
    $("#fn-rf").addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); run(f.get("from"), f.get("to")); });
    $("#fn-af").addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); const ar = $("#fn-ar"); try { const d = await api("GET", `/api/admin/finance/annual?user=${enc(f.get("user"))}&year=${enc(f.get("year"))}`); if (!ar?.isConnected) return; ar.innerHTML = `<p><b>${h(d.user.name)}</b> <bdi dir="ltr">@${h(d.user.handle)}</bdi></p>` + annualHtml(d); } catch (err) { if (ar?.isConnected) ar.innerHTML = errBox(err); } });
    $("#fn-iss").addEventListener("click", async () => { try { const r = await api("POST", "/api/admin/finance/issue"); say(`أُصدر ${r.issued} مستند`); } catch (e) { say(e.message); } });
    run(since, today);
  }

  MPRoutes.extend((a, b, prev) => {
    return { statement: () => statementView(), invoice: () => invoiceView(a), annual: () => annualView(), "finance-report": () => reportView() };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "finance" ? adminView() : next()));
  window.MPFinance = { statementView, invoiceView, annualView, reportView, adminView, version: "2.28.0" };
  if (/^#\/(statement|invoice|annual|finance-report|admin\/finance)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
