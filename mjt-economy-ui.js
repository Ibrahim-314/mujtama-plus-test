/* =====================================================================
 * v2.162 — «اقتصاد مجتمع كوين» #/admin/mjt-economy (phase 6). Its own lazy chunk `mjteco` (index.html data-chunk, with
 * mjt-economy.css); 0 bytes in core apart from the route name in chunks.js. Admin only — the server answers 403 to members.
 * Reads GET /api/admin/mjt/economy?period=…: overview (new vs legacy issuance apart, balances apart), issuance and usage over
 * time (hand-drawn SVG, no chart library), transaction classes, issuance control (caps next to usage, monthly budgets that
 * only alert, manual pause of a phase-4 source), service usage, inflow / outflow, alerts (every threshold empty = off),
 * text-only recommendations, ledger reconciliation, a hypothetical simulation («افتراضي», never saved), CSV exports.
 * Nothing on this page changes a limit by itself. RTL first; phone widths and Pi Browser. CSP: no inline handlers / styles.
 * ===================================================================== */
(function MjtEconomyUI() {
  if (window.MPMjtEconomy) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const ic = (n, c = "sm") => (window.MPFeat ? MPFeat.ico(n, c) : UI.icon(n, c));
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const amt = (s) => (s === null || s === undefined ? "—" : `<bdi dir="ltr" class="ec-n">${h(s)}</bdi>`);
  const pc = (v) => (v === null || v === undefined ? "—" : `<bdi dir="ltr" class="ec-n">${h(v)}%</bdi>`);
  const en = () => !!(window.MPI18n && MPI18n.current() === "en");
  const dshort = (s, y) => { try { return new Intl.DateTimeFormat(en() ? "en" : "ar", { numberingSystem: "latn", day: "numeric", month: "short", ...(y ? { year: "numeric" } : {}) }).format(new Date(s)); } catch { return String(s || "").slice(5, 10); } };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel row"></div>`).join("");
  const busy = async (btn, fn) => { if (btn) btn.disabled = true; try { return await fn(); } catch (e) { say(e.message); return null; } finally { if (btn && btn.isConnected) btn.disabled = false; } };
  const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
  const PERIODS = [["day", "يومي"], ["week", "أسبوعي"], ["month", "شهري"], ["year", "سنوي"]];
  const TABLES = [["summary", "الملخص"], ["classes", "التصنيف"], ["sources", "مصادر المكافآت"], ["legacy", "المسارات القديمة"], ["services", "الخدمات"], ["flows", "الداخل والخارج"], ["series", "عبر الزمن"], ["alerts", "التنبيهات"], ["reconciliation", "مطابقة الدفتر"], ["mapping", "جدول التصنيف"]];
  const ALERT_UNIT = { issuanceDailyMax: "MJT", useRateMinPct: "%", top10ShareMaxPct: "%", unusedGrowthMaxPct: "%", sourceSpikeFactor: "×", correctionsMaxCount: "", mismatch: "" };
  const sec = (id, icon, title, body, sub) => `<section class="card ec-sec" aria-labelledby="ech-${id}"><h3 class="f-h" id="ech-${id}">${ic(icon)}${h(title)}</h3>${sub ? `<p class="f-hint">${sub}</p>` : ""}${body}</section>`;
  const stat = (l, v, hint) => `<div><dt>${h(l)}</dt><dd>${v}</dd>${hint ? `<dd class="ec-hint">${h(hint)}</dd>` : ""}</div>`;
  const table = (cap, head, rows) => `<div class="ec-tw" role="region" aria-label="${h(cap)}" tabindex="0"><table class="ec-t"><caption class="ec-sr">${h(cap)}</caption><thead><tr>${head.map((x) => `<th scope="col">${h(x)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join("")}</tr>`).join("")}</tbody></table></div>`;

  /* ---------- hand-drawn SVG charts ---------- */
  /** grouped bars per bucket: new issuance, legacy issuance, spent (time runs left → right) */
  function barsSvg(points, yr) {
    const W = 340, H = 170, P = { l: 6, r: 6, t: 14, b: 22 }, keys = [["issuedNew", "ec-c1"], ["issuedLegacy", "ec-c2"], ["spent", "ec-c3"]];
    const max = Math.max(1e-9, ...points.flatMap((p) => keys.map(([k]) => p[k] || 0)));
    const gw = (W - P.l - P.r) / Math.max(1, points.length), bw = Math.max(2, (gw - 4) / keys.length), ih = H - P.t - P.b;
    const bars = points.map((p, i) => keys.map(([k, c], j) => { const v = p[k] || 0, bh = v > 0 ? Math.max(1.5, (v / max) * ih) : 0; return bh ? `<rect class="${c}" x="${(P.l + i * gw + 2 + j * bw).toFixed(1)}" y="${(P.t + ih - bh).toFixed(1)}" width="${(bw - 0.6).toFixed(1)}" height="${bh.toFixed(1)}"><title>${h(dshort(p.start))}: ${h(v)}</title></rect>` : ""; }).join("")).join("");
    const lbl = points.length ? `<text class="ec-ax" x="${P.l}" y="${H - 6}">${h(dshort(points[0].start, yr))}</text><text class="ec-ax" x="${W - P.r}" y="${H - 6}" text-anchor="end">${h(dshort(points[points.length - 1].start, yr))}</text>` : "";
    const total = (k) => points.reduce((x, p) => x + (p[k] || 0), 0);
    return `<figure class="ec-fig" dir="ltr"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(`إصدار جديد ${total("issuedNew")}، إصدار قديم ${total("issuedLegacy")}، مستخدم ${total("spent")} MJT`)}">
      <line class="ec-base" x1="${P.l}" x2="${W - P.r}" y1="${P.t + ih}" y2="${P.t + ih}"/><text class="ec-ax" x="${P.l}" y="10">${h(Math.round(max * 100) / 100)}</text>${bars}${lbl}</svg></figure>
      <ul class="ec-leg"><li><i class="ec-c1"></i>إصدار جديد</li><li><i class="ec-c2"></i>إصدار قديم</li><li><i class="ec-c3"></i>استخدام في الخدمات</li></ul>`;
  }
  /** two horizontal bars: inflow vs outflow */
  function flowSvg(inflow, outflow) {
    const a = Number(inflow) || 0, b = Number(outflow) || 0, m = Math.max(a, b, 1e-9), W = 300;
    const bar = (y, v, c) => `<rect class="${c}" x="0" y="${y}" width="${Math.max(v > 0 ? 2 : 0, (v / m) * W).toFixed(1)}" height="18" rx="4"/>`;
    return `<figure class="ec-fig" dir="ltr"><svg viewBox="0 0 ${W} 50" role="img" aria-label="${h(`الداخل ${a} — الخارج ${b} MJT`)}">${bar(2, a, "ec-c1")}${bar(28, b, "ec-c3")}</svg></figure><ul class="ec-leg"><li><i class="ec-c1"></i>الداخل إلى المحافظ ${amt(inflow)}</li><li><i class="ec-c3"></i>الخارج من المحافظ ${amt(outflow)}</li></ul>`;
  }

  /* ---------- page ---------- */
  async function view_() {
    const period = PERIODS.some(([k]) => k === qs().get("period")) ? qs().get("period") : "month";
    view.innerHTML = `<div class="wrap ec-page">${UI.pageHead({ title: "اقتصاد مجتمع كوين", icon: "chart", sub: "تحليلات الإصدار والاستخدام — للإدارة فقط", back: ["#/admin/rewards", "مكافآت مجتمع كوين"], id: "ec-h" })}
      <nav class="seg ec-seg" aria-label="الفترة">${PERIODS.map(([k, l]) => `<a href="#/admin/mjt-economy?period=${k}" ${k === period ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      <div id="ec-b" aria-busy="true">${skel(6)}</div></div>`;
    $("#ec-h")?.focus({ preventScroll: true });
    if (!signed()) { $("#ec-b").innerHTML = UI.empty({ title: "للإدارة فقط", text: "هذه الصفحة لمديري المنصة." }); return; }
    const box = $("#ec-b");
    const load = async () => {
      box.setAttribute("aria-busy", "true"); box.innerHTML = skel(6);
      let d; try { d = await api("GET", "/api/admin/mjt/economy?period=" + enc(period)); } catch (e) {
        box.removeAttribute("aria-busy"); const off = offline();
        box.innerHTML = UI.empty({ title: off ? "أنت غير متصل" : e?.status === 403 ? "للإدارة فقط" : "تعذّر التحميل", text: off ? "تحقق من اتصالك بالإنترنت." : e?.message || "", action: `<button type="button" class="btn outline" data-ec-retry>إعادة المحاولة</button>` });
        box.querySelector("[data-ec-retry]")?.addEventListener("click", load); return;
      }
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy");
      render(box, d, period, load);
    };
    load();
  }

  function render(box, d, period, reload) {
    const o = d.overview, c = o.cumulative, p = o.period, f = d.flows, sv = d.services, iss = d.issuance;
    const clsRows = d.classes.map((x) => [`${h(x.label)}${x.legacy ? ` <span class="sbadge warn">قديم</span>` : ""}`, amt(x.period.in), amt(x.period.out), h(x.period.tx), amt(x.all.in), amt(x.all.out)]);
    const capCell = (r) => `${h(r.count)} <small class="muted">(${r.cap === null ? "بلا حد" : "الحد " + h(r.cap)} · أعلى عضو ${h(r.peakPerMember)})</small>`;
    const src = iss.phase4.map((s) => `<article class="ec-src" data-key="${h(s.key)}"><header><b>${h(s.label)}</b> <span class="sbadge ${s.enabled ? "ok" : ""}">${s.enabled ? "مفعّل" : "معطّل"}</span> <small class="muted">المبلغ ${s.amount === null ? "غير محدد" : amt(s.amount)}</small></header>
        ${table("الحدود مقابل الاستخدام: " + s.label, ["الفترة", "العدد (الحد · أعلى عضو)"], [["يوم", capCell(s.caps.day)], ["أسبوع", capCell(s.caps.week)], ["شهر (30 يوماً)", capCell(s.caps.month)], ["لكل عنصر", `<small class="muted">${s.caps.item.cap === null ? "بلا حد" : "الحد " + h(s.caps.item.cap)} · أعلى عضو ${h(s.caps.item.peakPerMember)}</small>`]])}
        <p class="ec-line">إصدار الفترة ${amt(s.period)} · منذ البداية ${amt(s.allTime.issued)} (${h(s.allTime.count)}) · قيد المراجعة ${h(s.pending)}</p>
        <form class="ec-bud"><label>ميزانية شهرية (MJT) — تنبيه فقط<input name="budget" inputmode="decimal" value="${s.budget.monthly === null ? "" : h(s.budget.monthly)}" placeholder="بلا ميزانية"></label><button class="btn outline">حفظ</button></form>
        ${s.budget.monthly !== null ? `<p class="ec-line ${s.budget.reached ? "ec-warn" : ""}">استُخدم ${amt(s.budget.used30d)} من ${amt(s.budget.monthly)} خلال آخر 30 يوماً (${pc(s.budget.usedPct)})${s.budget.reached ? " — تجاوز الميزانية، لم يُوقف تلقائياً" : ""}</p>` : ""}
        <div class="ec-acts"><button type="button" class="btn ${s.enabled ? "ghost" : "outline"}" data-st="${s.enabled ? "0" : "1"}">${s.enabled ? "إيقاف يدوي" : "إعادة التشغيل"}</button></div></article>`).join("");
    const legacy = iss.legacy.length ? table("المسارات القديمة", ["المسار", "داخل", "خارج", "حركات"], iss.legacy.map((x) => [h(x.label), amt(x.period.in), amt(x.period.out), h(x.period.tx)])) : `<p class="f-hint">لا حركات من المسارات القديمة في الفترة.</p>`;
    const svcRows = sv.items.map((x) => [`${h(x.title)}${x.enabled ? "" : ` <span class="sbadge">معطّلة</span>`}`, h(x.purchases), amt(x.spent), `${h(x.refunds)} · ${amt(x.refunded)}`, h(x.buyers), h(x.repeatBuyers)]);
    const al = d.alerts.items.map((a) => `<li class="li ec-al ${a.triggered ? "on" : ""}"><span class="t"><b>${h(a.label)}${a.enabled && a.threshold !== true ? ` ${amt(a.threshold)}${h(ALERT_UNIT[a.key] || "")}` : ""}</b><small>${a.enabled ? `القيمة الحالية: ${typeof a.value === "object" ? "" : amt(a.value)}` : "معطّلة — لم تُحدَّد قيمة"}${a.detail && typeof a.detail === "string" ? ` · ${h(a.detail)}` : ""}${Array.isArray(a.detail) ? ` · ${a.detail.map((x) => h(x.source || x)).join("، ")}` : ""}</small></span><span class="sbadge ${a.triggered ? "bad" : a.enabled ? "ok" : ""}">${a.triggered ? "تنبيه" : a.enabled ? "طبيعي" : "معطّلة"}</span></li>`).join("");
    const thr = Object.entries(d.settings.alerts).map(([k, v]) => k === "mismatch" ? `<label class="chk"><input type="checkbox" name="${k}" ${v ? "checked" : ""}> نبّهني عند عدم تطابق الدفتر</label>` : `<label>${h((d.alerts.items.find((a) => a.key === k) || {}).label || k)} ${ALERT_UNIT[k] ? `(${h(ALERT_UNIT[k])})` : ""}<input name="${k}" inputmode="decimal" value="${v === null ? "" : h(v)}" placeholder="معطّلة"></label>`).join("");
    const rec = d.reconciliation;
    box.innerHTML = `<p class="ec-note" role="note">${ic("lock", "xs")}<span>${h(d.note)}</span></p>
      ${sec("ov", "chart", "نظرة عامة", `<dl class="ec-kpi">
        ${stat("الإصدار الجديد منذ البداية", amt(c.issuedNew), "مصادر المكافآت")}${stat("الإصدار القديم منذ البداية", amt(c.issuedLegacy), `منه مُسترجع ${c.legacyReversed}`)}
        ${stat("المستخدم في الخدمات", amt(c.spentOnServices), `المسترد ${c.refunded}`)}${stat("مجموع الأرصدة الحالية", amt(o.balances.total), "رقم مستقل لا يُجمع مع الإصدار")}
        ${stat("المحافظ النشطة", amt(o.activeWallets), `حركة واحدة على الأقل في آخر ${o.activeWindowDays} يوماً`)}${stat("نسبة استخدام الرصيد", pc(p.useRatePct), "صافي الاستخدام ÷ صافي الإصدار في الفترة")}
        ${stat("متوسط ما كسبه العضو", amt(p.avgEarnedPerEarner), `${p.earners} عضواً تلقّوا إصداراً`)}${stat("متوسط ما استخدمه العضو", amt(p.avgSpentPerSpender), `${p.spenders} عضواً استخدموا رصيداً`)}
        ${stat("التركّز (أعلى 10%)", pc(o.concentration.sharePct), `${o.concentration.topWallets} من ${o.concentration.holders} محفظة لديها رصيد`)}</dl>
        <p class="f-hint">الفترة: ${h(d.period.label)} — إصدار جديد ${amt(p.issuedNew)} · إصدار قديم ${amt(p.issuedLegacy)} · مستخدم ${amt(p.spent)} · مسترد ${amt(p.refunded)}</p>`)}
      ${sec("ts", "clock", "الإصدار والاستخدام عبر الزمن", barsSvg(d.series.points, d.series.bucketDays >= 7), `كل عمود = ${h(d.series.bucketDays)} يوم`)}
      ${d.topSources.length ? sec("top", "award", "أعلى مصادر المكافآت في الفترة", `<ul class="list">${d.topSources.map((x) => `<li class="li"><span class="t"><b>${h(x.label)}</b></span><span class="ec-amt">${amt(x.issued)}</span></li>`).join("")}</ul>`) : ""}
      ${sec("cls", "search", "تصنيف الحركات", table("تصنيف الحركات", ["الصنف", "داخل (الفترة)", "خارج (الفترة)", "حركات", "داخل (الكل)", "خارج (الكل)"], clsRows) + `<details class="ec-map"><summary>جدول التصنيف (نوع الحركة ← الصنف)</summary><div id="ec-map"></div></details>`, "«داخل» = ما أُضيف إلى محافظ الأعضاء، «خارج» = ما خُصم منها. المسارات القديمة صنف مستقل دائماً، وأي نوع غير معروف يظهر في «غير مصنّف».")}
      ${sec("iss", "award", "التحكم في الإصدار", `${src || `<p class="f-hint">لا مصادر مكافآت.</p>`}<h4 class="ec-h4">المسارات القديمة (للقراءة فقط)</h4>${legacy}<p class="f-hint">${h(iss.note)}</p>`, "الحدود تُعرض كما هي في صفحة المكافآت ولا تُغيَّر من هنا. الميزانية تنبيه فقط ولا توقف المصدر.")}
      ${sec("svc", "bag", "استخدام الخدمات", (svcRows.length ? table("استخدام الخدمات", ["الخدمة", "العمليات", "المستخدم", "المسترد", "المشترون", "مكررو الشراء"], svcRows) : `<p class="f-hint">لا خدمات.</p>`) + `<p class="ec-line">الأعلى استخداماً: ${h(sv.mostUsed || "—")} · الأقل: ${h(sv.leastUsed || "—")} · نسبة الأعضاء الذين استخدموا رصيداً ${pc(sv.spenderSharePct)} (${h(sv.spenders)} من ${h(sv.wallets)}) · مكررو الشراء ${h(sv.repeatBuyers)}</p>`)}
      ${sec("flow", "wallet", "الداخل مقابل الخارج", `${flowSvg(f.inflow, f.outflow)}<dl class="ec-kpi">${stat("الفرق", amt(f.gap))}${stat("تراكم الأرصدة غير المستخدمة", amt(f.unused.accumulated), `من ${f.unused.start} إلى ${f.unused.end}`)}${stat("نمو الأرصدة", pc(f.unused.growthPct))}${stat("لكل عضو نشط", amt(f.perActive?.gap))}${stat("التحويلات والإكراميات", `${amt(f.circulation.transfers)} · ${amt(f.circulation.tips)}`, "تداول بين الأعضاء — ليس دخلاً ولا خرجاً")}</dl>`)}
      ${sec("al", "lock", "التنبيهات الاقتصادية", `<ul class="list">${al}</ul><p class="f-hint">${h(d.alerts.note)}</p>
        <details class="ec-thr"><summary>تعديل الحدود (اتركها فارغة للتعطيل)</summary><form id="ec-thr">${thr}<div class="ec-acts"><button class="btn">حفظ</button><button type="button" class="btn ghost" id="ec-eval">تقييم الآن</button></div></form></details>`)}
      ${sec("rec", "award", "توصيات", `<ul class="ec-rec">${d.recommendations.items.map((r) => `<li>${h(r.text)}</li>`).join("")}</ul><p class="f-hint">${h(d.recommendations.note)}</p>`)}
      ${sec("rc", "search", "مطابقة الدفتر", rec.ok ? `<p class="notice ok">${ic("award")}<span>كل المحافظ (${h(rec.checked)}) يطابق رصيدها مجموع حركاتها.</span></p>` : table("محافظ غير مطابقة", ["المحفظة", "المخزَّن", "مجموع الحركات", "الفرق"], rec.mismatches.map((m) => [m.handle ? "@" + h(m.handle) : `<bdi dir="ltr">${h(m.account)}</bdi>`, amt(m.stored), amt(m.ledger), amt(m.diff)])))}
      ${sec("sim", "chart", "محاكاة (افتراضي)", `<p class="notice warn">${ic("lock")}<span>افتراضي — لا يُحفظ ولا يغيّر أي إعداد ولا يختلط بالبيانات الحقيقية.</span></p>
        <form id="ec-sim" class="ec-simf"><label>نمو الأعضاء شهرياً (%)<input name="memberGrowthPct" inputmode="decimal" value="0"></label><label>تغيّر النشاط اليومي (%)<input name="activityPct" inputmode="decimal" value="0"></label><label>تغيّر معدل المكافآت (%)<input name="rewardRatePct" inputmode="decimal" value="0"></label><label>تغيّر تكلفة الخدمات (%)<input name="serviceCostPct" inputmode="decimal" value="0"></label><label>تغيّر استخدام الخدمات (%)<input name="serviceUsagePct" inputmode="decimal" value="0"></label><label>عدد الأشهر<input name="months" inputmode="numeric" value="6"></label><div class="ec-acts"><button class="btn outline">احسب</button></div></form><div id="ec-simr"></div>`)}
      ${sec("csv", "bag", "تصدير CSV", `<div class="ec-csv">${TABLES.map(([t, l]) => `<a class="btn ghost" download href="/api/admin/mjt/economy/export.csv?table=${t}&period=${period}">${h(l)}</a>`).join("")}</div>`, `بيانات الفترة المختارة (${h(d.period.label)}). كل تصدير يُسجَّل باسم منفّذه.`)}
      <section class="card ec-sec"><h3 class="f-h">${ic("search")}التعريفات</h3><ul class="ec-def">${Object.values(d.definitions).map((x) => `<li>${h(x)}</li>`).join("")}</ul></section>`;

    // issuance control: budgets + manual pause / resume
    box.querySelectorAll(".ec-src").forEach((el) => {
      const k = el.dataset.key;
      el.querySelector(".ec-bud").addEventListener("submit", (e) => { e.preventDefault(); busy(e.submitter, async () => { await api("PUT", "/api/admin/mjt/economy/settings", { budgets: { [k]: e.target.budget.value.trim() || null } }); say("حُفظت الميزانية"); reload(); }); });
      el.querySelector("[data-st]").addEventListener("click", (e) => { const on = e.currentTarget.dataset.st === "1"; if (!on && !confirm("إيقاف هذا المصدر يدوياً؟ لن تُصرف منه مكافآت جديدة حتى تعيد تشغيله.")) return; busy(e.currentTarget, async () => { await api("POST", `/api/admin/mjt/economy/sources/${enc(k)}/state`, { enabled: on }); say(on ? "أُعيد تشغيل المصدر" : "أُوقف المصدر"); reload(); }); });
    });
    // thresholds
    $("#ec-thr").addEventListener("submit", (e) => { e.preventDefault(); const fm = e.target, alerts = {}; for (const k of Object.keys(d.settings.alerts)) alerts[k] = k === "mismatch" ? (fm.elements[k].checked || null) : fm.elements[k].value.trim() || null;
      busy(e.submitter, async () => { await api("PUT", "/api/admin/mjt/economy/settings", { alerts }); say("حُفظت الحدود"); reload(); }); });
    $("#ec-eval").addEventListener("click", (e) => busy(e.currentTarget, async () => { const r = await api("GET", "/api/admin/mjt/economy/alerts?period=" + enc(period)); say(r.alerts.triggered ? `${r.alerts.triggered} تنبيه نشط` : "لا تنبيهات نشطة"); reload(); }));
    // mapping (on demand)
    view.querySelector(".ec-map").addEventListener("toggle", (e) => { const t = $("#ec-map"); if (!e.target.open || t.dataset.done) return; t.dataset.done = "1"; t.innerHTML = skel(2);
      api("GET", "/api/admin/mjt/economy/mapping").then((m) => { t.innerHTML = table("جدول التصنيف", ["نوع الحركة", "الصنف", "الوصف"], m.rules.map((r) => [`<bdi dir="ltr">${h(r.kind)}${r.ikeyPrefix ? " · " + h(r.ikeyPrefix) + "…" : ""}${r.refType ? " · " + h(r.refType) : ""}</bdi>`, h(r.classLabel), h(r.label)])) + (m.seen.some((x) => !x.known) ? `<p class="ec-line ec-warn">أنواع غير مصنّفة في الدفتر: ${m.seen.filter((x) => !x.known).map((x) => `<bdi dir="ltr">${h(x.kind)}</bdi> (${h(x.count)})`).join("، ")}</p>` : ""); }, (err) => { t.innerHTML = `<p class="f-hint">${h(err.message)}</p>`; delete t.dataset.done; }); });
    // simulation (nothing saved)
    $("#ec-sim").addEventListener("submit", (e) => { e.preventDefault(); const fm = e.target, b = {}; for (const el of fm.elements) if (el.name) b[el.name] = el.value.trim();
      busy(e.submitter, async () => { const r = await api("POST", "/api/admin/mjt/economy/simulate", b);
        $("#ec-simr").innerHTML = `<p class="ec-line"><span class="sbadge warn">${h(r.label)}</span> الأساس (آخر ${h(r.baseline.windowDays)} يوماً): إصدار جديد ${amt(r.baseline.newIssued)} · قديم ${amt(r.baseline.legacyIssued)} · استخدام ${amt(r.baseline.netSpent)} · أرصدة ${amt(r.baseline.balance)}</p>`
          + table("نتيجة المحاكاة (افتراضي)", ["الشهر", "إصدار جديد", "إصدار قديم", "استخدام", "الأرصدة"], r.months.map((m) => [h(m.month), amt(m.issuedNew), amt(m.issuedLegacy), amt(m.spent), amt(m.balance)])) + `<p class="f-hint">${h(r.note)}</p>`; }); });
  }

  MPRoutes.add("admin", (a, b, next) => (a === "mjt-economy" ? view_() : next()));
  window.MPMjtEconomy = { view: view_, version: "2.162.0" };
  if (/^#\/admin\/mjt-economy\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
