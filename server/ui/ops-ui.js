/* مجتمع بلس — لوحة التشغيل والمراقبة (Phase 49), admin-only lazy script.
 * #/admin/ops            live charts (requests, error rate, p95, queue backlog) as inline SVG, SLOs + error budgets,
 *                        on-call alert rules and history, incidents for the public /status page, DR drills, Prometheus/tracing.
 * #/admin/ops/product    product metrics: growth, DAU/WAU/MAU, engagement, weekly retention cohorts.
 * Served by services/observability.js at GET /ops-ui.js (brotli/gzip + ETag) and injected by the pi chunk for admins only,
 * so it is neither in the core bundle nor in the chunk map (0 bytes in core).
 * No chart library, no inline handlers (CSP): listeners are attached after render. */
/* global document, window, location, alert, Remote, view, toast, DB, Views, route */
(function OpsUI() {
  if (window.MPOps) return;
  const api = (m, u, b) => Remote.api(m, u, b);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nf = n => (n === null || n === undefined ? "—" : Number(n).toLocaleString("ar-SA-u-nu-latn"));
  const $ = s => document.querySelector(s);
  const note = (m, ok) => (typeof toast === "function" ? toast(m) : alert(m), ok);
  const st = document.createElement("style");
  st.textContent = `.ops-page h3{font-size:16px;margin:0 0 8px}.ops-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 12px}.ops-tabs a{padding:6px 12px;min-height:44px;box-sizing:border-box;display:inline-flex;align-items:center;border-radius:999px;border:1px solid var(--line,#e2e8f0);color:inherit;text-decoration:none;font-size:14px}.ops-tabs a[aria-current=page]{background:var(--accent2,#efe9ff);color:var(--accent-ink,#4f22d1);border-color:var(--accent,#6d3cf4);font-weight:700}
.ops-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}.ops-kpi{background:var(--card,#fff);border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:10px}.ops-kpi b{display:block;font-size:20px}.ops-kpi span{font-size:12px;color:var(--muted,#64748b)}
.ops-chart{width:100%;height:120px;direction:ltr;display:block}.ops-chart text{font-size:9px;fill:var(--muted,#64748b)}.ops-st{font-size:12px;border-radius:999px;padding:1px 8px;background:#dcfce7;color:#166534}.ops-st.warn,.ops-st.at_risk,.ops-st.degraded{background:#fef3c7;color:#92400e}.ops-st.bad,.ops-st.exhausted,.ops-st.firing,.ops-st.outage{background:#fee2e2;color:#991b1b}.ops-st.off,.ops-st.no_data,.ops-st.not_configured{background:#e2e8f0;color:#475569}
.ops-x{overflow-x:auto;max-width:100%}.ops-page{overflow-wrap:anywhere}.ops-tbl{width:100%;border-collapse:collapse;font-size:13px}.ops-tbl td,.ops-tbl th{padding:5px 4px;border-bottom:1px solid var(--line,#e2e8f0);text-align:start}.ops-tbl input[type=number]{width:72px;padding:6px}.ops-cell{text-align:center!important;border-radius:4px}.ops-form{display:grid;gap:6px}.ops-form input:not([type=checkbox]),.ops-form textarea,.ops-form select{width:100%;box-sizing:border-box}.ops-form label{display:inline-flex;align-items:center;gap:4px;margin:4px 0}.ops-bar{height:8px;border-radius:4px;background:var(--line,#e2e8f0);overflow:hidden}.ops-bar i{display:block;height:100%;background:#1f9d55}`;
  document.head.appendChild(st);

  /* ---------- inline SVG charts ---------- */
  function line(points, { key, color = "#2563eb", unit = "", w = 320, hgt = 120, fmtX = x => x } = {}) {
    if (!points.length) return `<p class="muted">لا توجد بيانات بعد — تظهر بعد أول دقيقة من الطلبات.</p>`;
    const vals = points.map(p => +p[key] || 0), max = Math.max(1, ...vals), pad = 18, iw = w - pad - 4, ih = hgt - 24;
    const x = i => pad + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw), y = v => 6 + ih - (v / max) * ih;
    const d = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = `${d}L${x(vals.length - 1).toFixed(1)},${6 + ih}L${x(0).toFixed(1)},${6 + ih}Z`;
    return `<svg class="ops-chart" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="${esc(key)}: آخر قيمة ${esc(vals[vals.length - 1])}${esc(unit)}, الأعلى ${esc(max)}${esc(unit)}">
<line x1="${pad}" x2="${w - 4}" y1="${6 + ih}" y2="${6 + ih}" stroke="currentColor" stroke-opacity=".15"/><line x1="${pad}" x2="${w - 4}" y1="6" y2="6" stroke="currentColor" stroke-opacity=".08"/>
<text x="2" y="12">${esc(nf(max))}</text><text x="2" y="${6 + ih}">0</text><text x="${pad}" y="${hgt - 2}">${esc(fmtX(points[0]))}</text><text x="${w - 4}" y="${hgt - 2}" text-anchor="end">${esc(fmtX(points[points.length - 1]))}</text>
<path d="${area}" fill="${color}" fill-opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  function bars(points, keys, colors, { w = 320, hgt = 120 } = {}) {
    if (!points.length) return "";
    const tot = points.map(p => keys.reduce((a, k) => a + (+p[k] || 0), 0)), max = Math.max(1, ...tot), bw = (w - 20) / points.length, ih = hgt - 20;
    return `<svg class="ops-chart" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="${esc(keys.join("، "))}"><text x="2" y="10">${esc(nf(max))}</text>${points.map((p, i) => { let y0 = 4 + ih; return keys.map((k, j) => { const hh = ((+p[k] || 0) / max) * ih; y0 -= hh; return `<rect x="${(18 + i * bw).toFixed(1)}" y="${y0.toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${hh.toFixed(1)}" fill="${colors[j]}"><title>${esc(p.day)} ${esc(k)}: ${esc(p[k])}</title></rect>`; }).join(""); }).join("")}<text x="18" y="${hgt - 2}">${esc(points[0].day)}</text><text x="${w - 2}" y="${hgt - 2}" text-anchor="end">${esc(points[points.length - 1].day)}</text></svg>`;
  }
  const hm = t => String(t).slice(11, 16), legend = (items) => `<p class="muted" style="margin:4px 0 0;font-size:12px">${items.map(([c, l]) => `<span style="display:inline-block;width:10px;height:10px;background:${c};border-radius:2px;margin-inline:6px 4px"></span>${esc(l)}`).join(" ")}</p>`;
  const tabs = cur => `<nav class="ops-tabs" aria-label="أقسام التشغيل">${[["", "التشغيل"], ["product", "مؤشرات المنتج"]].map(([k, l]) => `<a href="#/admin/ops${k ? "/" + k : ""}"${cur === k ? ' aria-current="page"' : ""}>${l}</a>`).join("")}<a href="/status" target="_blank" rel="noopener">صفحة الحالة العامة ↗</a></nav>`;
  const head = (cur) => `<a href="#/admin" class="muted">→ الإدارة</a><h2 id="ops-h" tabindex="-1"><svg class="ic hi" aria-hidden="true"><use href="#i-trendUp"/></svg>التشغيل والمراقبة</h2>${tabs(cur)}`;
  const SEV = { critical: "bad", warning: "warn", info: "off" };
  const COMP = { api: "الموقع والتطبيق", database: "قاعدة البيانات", realtime: "الفوري", media: "الوسائط", email: "البريد", pi: "مدفوعات Pi" };

  /* ---------- #/admin/ops ---------- */
  async function opsView(hours = 24) {
    const v = view, tok = (v._ops = {});
    v.innerHTML = `<div class="wrap ops-page">${head("")}<div id="ops-body" aria-busy="true"><div class="skel"></div><div class="skel"></div></div></div>`;
    let o; try { o = await api("GET", "/api/admin/ops/overview?hours=" + hours); } catch (e) { if (v._ops === tok) $("#ops-body").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (v._ops !== tok) return;
    const s = o.series, lm = o.now.lastMinute;
    const slo = o.slos.map(x => `<tr><td><b>${esc(x.name)}</b><div class="muted">الهدف ${esc(x.target)}٪ / ${esc(x.windowDays)} يوماً${x.thresholdMs ? ` · أقل من ${esc(x.thresholdMs)} م.ث` : ""}</div></td><td>${x.current === null ? "—" : esc(x.current) + "٪"}</td><td><div class="ops-bar" title="${esc(Math.round(x.budgetRemaining * 100))}٪"><i style="width:${Math.max(0, Math.min(100, x.budgetRemaining * 100))}%;${x.budgetRemaining < 0.25 ? "background:#dc2626" : ""}"></i></div><span class="muted">${esc(Math.round(x.budgetRemaining * 100))}٪ متبقٍ · حرق ${esc(x.burnRate1h)}× (ساعة)</span></td><td><span class="ops-st ${esc(x.state)}">${{ ok: "سليم", at_risk: "في خطر", exhausted: "مستنفد", no_data: "لا بيانات" }[x.state]}</span></td><td><input type="number" step="0.1" min="50" max="99.99" value="${esc(x.target)}" data-slo="${esc(x.id)}" aria-label="هدف ${esc(x.name)}"></td></tr>`).join("");
    const rules = o.rules.map(r => `<tr><td><b>${esc(r.name)}</b> <span class="ops-st ${SEV[r.severity] || "off"}">${esc(r.severity)}</span><div class="muted">${esc(o.metrics[r.metric] || r.metric)} ${esc(r.op)} · ${esc(r.window_min)} د · ${esc(r.channels)}</div></td><td><input type="number" step="any" value="${esc(r.threshold)}" data-rth="${esc(r.id)}" aria-label="حد ${esc(r.name)}"></td><td><label><input type="checkbox" data-ren="${esc(r.id)}"${r.enabled ? " checked" : ""}> مفعّل</label></td></tr>`).join("");
    const firing = o.alerts.firing.map(a => `<li><span class="ops-st firing">يعمل الآن</span> ${esc(a.name || a.rule_id)} = ${esc(a.value)} <span class="muted">منذ ${esc(hm(a.started_at))}</span></li>`).join("");
    const hist = o.alerts.recent.map(a => `<tr><td>${esc(a.name || a.rule_id)}</td><td><span class="ops-st ${a.state === "firing" ? "firing" : ""}">${a.state === "firing" ? "يعمل" : "انتهى"}</span></td><td>${esc(a.value)}</td><td class="muted">${esc(String(a.started_at).slice(0, 16).replace("T", " "))}</td><td class="muted">${esc(a.sent || "—")}</td></tr>`).join("");
    const ch = o.channels, chs = [["inapp", "إشعار داخل التطبيق"], ["webhook", "Webhook"], ["email", "البريد"]].map(([k, l]) => `<span class="ops-st ${ch[k] ? "" : "off"}">${l}: ${ch[k] ? "متاح" : "غير مضبوط"}</span>`).join(" ");
    const drills = o.drills.map(d => `<tr><td>${esc(String(d.at).slice(0, 16).replace("T", " "))}</td><td><span class="ops-st ${d.ok ? "" : "bad"}">${d.ok ? "نجح" : "فشل"}</span></td><td>${esc(d.backup)}</td><td>${nf(d.tables_n)} جدول · ${nf(d.rows_n)} صف</td><td>${nf(d.ms)} م.ث</td></tr>`).join("");
    const comps = Object.entries(o.now.components).map(([k, val]) => `<span class="ops-st ${val === null ? "not_configured" : val ? "" : "outage"}">${esc(COMP[k] || k)}</span>`).join(" ");
    $("#ops-body").removeAttribute("aria-busy");
    $("#ops-body").innerHTML = `
<div class="ops-tabs" role="group" aria-label="المدى الزمني">${[1, 6, 24, 168].map(h => `<a href="#" data-hours="${h}"${h === o.hours ? ' aria-current="page"' : ""}>${h === 168 ? "7 أيام" : h + " ساعة"}</a>`).join("")}</div>
<div class="ops-grid"><div class="ops-kpi"><b>${nf(lm.requests)}</b><span>طلبات آخر دقيقة</span></div><div class="ops-kpi"><b>${lm.requests ? esc(Math.round((lm.errors / lm.requests) * 1000) / 10) : 0}٪</b><span>أخطاء آخر دقيقة</span></div><div class="ops-kpi"><b>${nf(Math.round(lm.p95))}</b><span>p95 آخر دقيقة (م.ث)</span></div><div class="ops-kpi"><b>${nf(o.now.queue.queued || 0)}</b><span>مهام في الطابور</span></div><div class="ops-kpi"><b>${nf(o.now.memoryMb)}</b><span>الذاكرة (MB)</span></div><div class="ops-kpi"><b>${o.alerts.firing.length}</b><span>تنبيهات نشطة</span></div></div>
<div class="card"><p style="margin:0">${comps}</p></div>
<section class="card" id="ops-qoe" aria-labelledby="ops-qoe-h" aria-busy="true"><h3 id="ops-qoe-h">جودة تشغيل الفيديو</h3><div class="skel"></div></section>
<section class="card" id="ops-srch" aria-labelledby="ops-srch-h" aria-busy="true"><h3 id="ops-srch-h">جودة البحث</h3><div class="skel"></div></section>
<div class="card"><h3>الطلبات</h3>${line(s, { key: "requests", fmtX: p => hm(p.t) })}<p class="muted" style="margin:0;font-size:12px">كل نقطة = ${esc(o.stepMin)} دقيقة</p></div>
<div class="card"><h3>نسبة الأخطاء ٪</h3>${line(s, { key: "errorRate", color: "#dc2626", unit: "٪", fmtX: p => hm(p.t) })}</div>
<div class="card"><h3>زمن الاستجابة p95 (م.ث)</h3>${line(s, { key: "p95", color: "#d97706", fmtX: p => hm(p.t) })}</div>
<div class="card"><h3>طابور المهام</h3>${line(s, { key: "backlog", color: "#7c3aed", fmtX: p => hm(p.t) })}</div>
<div class="card"><h3>أهداف مستوى الخدمة (SLO) وميزانية الأخطاء</h3><div class="ops-x"><table class="ops-tbl"><thead><tr><th>الهدف</th><th>الحالي</th><th>الميزانية</th><th>الحالة</th><th>تعديل</th></tr></thead><tbody>${slo}</tbody></table></div></div>
<div class="card"><h3>تنبيهات المناوبة</h3>${firing ? `<ul>${firing}</ul>` : `<p class="muted">لا تنبيهات نشطة</p>`}<p>${chs}</p><div class="ops-x"><table class="ops-tbl"><thead><tr><th>القاعدة</th><th>الحد</th><th></th></tr></thead><tbody>${rules}</tbody></table></div>
<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn ghost" id="ops-eval">تقييم القواعد الآن</button><button class="btn ghost" id="ops-test">إرسال تنبيه تجريبي</button></div>
${hist ? `<details style="margin-top:8px"><summary>سجل التنبيهات</summary><div class="ops-x"><table class="ops-tbl">${hist}</table></div></details>` : ""}</div>
<div class="card"><h3>الحوادث (صفحة الحالة العامة)</h3><div id="ops-inc"><div class="skel"></div></div>
<form class="ops-form" id="ops-inc-f"><input id="ops-inc-t" maxlength="140" placeholder="عنوان الحادثة" required aria-label="عنوان الحادثة"><textarea id="ops-inc-b" maxlength="2000" rows="2" placeholder="ماذا يحدث؟ (يظهر للجميع)" required aria-label="وصف الحادثة"></textarea>
<select id="ops-inc-i" aria-label="التأثير"><option value="minor">تأثير طفيف</option><option value="major">تأثير كبير</option><option value="critical">انقطاع</option></select>
<fieldset style="border:0;padding:0;margin:0"><legend class="muted">المكوّنات المتأثرة</legend>${Object.entries(COMP).map(([k, l]) => `<label style="margin-inline-end:10px"><input type="checkbox" name="ops-c" value="${k}"> ${l}</label>`).join("")}</fieldset><button class="btn" type="submit" id="ops-inc-go">نشر الحادثة</button></form></div>
<div class="card"><h3>تمارين التعافي من الكوارث</h3>${drills ? `<div class="ops-x"><table class="ops-tbl">${drills}</table></div>` : `<p class="muted">لم يُسجَّل تمرين بعد. شغّل <code>node server/scripts/dr-drill.js drill --report-url …</code> على نسخة احتياطية.</p>`}</div>
<div class="card"><h3>Prometheus والتتبع</h3><p class="muted" style="margin:0">/metrics: ${o.prometheus.tokenSet ? "مفعّل بمفتاح METRICS_TOKEN" : "مغلق للعامة (اضبط METRICS_TOKEN لتفعيله)"} · التتبع الموزع: ${o.tracing.enabled ? `مفعّل (${esc(o.tracing.via)}) · أُرسل ${nf(o.tracing.sent)} · فشل ${nf(o.tracing.failed)}` : "غير مفعّل (OTEL_EXPORTER_OTLP_ENDPOINT)"}</p></div>`;
    v.querySelectorAll("[data-hours]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); opsView(+a.dataset.hours); }));
    v.querySelectorAll("[data-slo]").forEach(i => i.addEventListener("change", async () => { try { await api("PUT", "/api/admin/ops/slos/" + i.dataset.slo, { target: +i.value }); note("تم تحديث الهدف"); opsView(o.hours); } catch (e) { note(e.message); } }));
    v.querySelectorAll("[data-rth]").forEach(i => i.addEventListener("change", async () => { try { await api("PUT", "/api/admin/ops/rules/" + i.dataset.rth, { threshold: +i.value }); note("تم حفظ القاعدة"); } catch (e) { note(e.message); } }));
    v.querySelectorAll("[data-ren]").forEach(i => i.addEventListener("change", async () => { try { await api("PUT", "/api/admin/ops/rules/" + i.dataset.ren, { enabled: i.checked }); note("تم حفظ القاعدة"); } catch (e) { note(e.message); } }));
    $("#ops-eval").addEventListener("click", async () => { try { const r = await api("POST", "/api/admin/ops/alerts/evaluate"); note(r.results.length ? `تغيّرت ${r.results.length} حالة` : "لا تغيير — كل القواعد ضمن الحدود"); opsView(o.hours); } catch (e) { note(e.message); } });
    $("#ops-test").addEventListener("click", async () => { try { const r = await api("POST", "/api/admin/ops/alerts/test"); note(r.sent.length ? "أُرسل عبر: " + r.sent.join("، ") : "لا توجد قناة مضبوطة"); } catch (e) { note(e.message); } });
    $("#ops-inc-f").addEventListener("submit", async e => {
      e.preventDefault(); const btn = $("#ops-inc-go"); btn.disabled = true;
      try { await api("POST", "/api/admin/ops/incidents", { title: $("#ops-inc-t").value, body: $("#ops-inc-b").value, impact: $("#ops-inc-i").value, components: [...v.querySelectorAll("[name=ops-c]:checked")].map(c => c.value) }); note("نُشرت الحادثة على صفحة الحالة"); e.target.reset(); incidents(); }
      catch (er) { note(er.message); } finally { btn.disabled = false; }
    });
    incidents(); qoeCard(7); searchCard(7);
  }
  /* v2.70: «جودة تشغيل الفيديو» — startup p50/p90, stall rate, average watched time from GET /api/admin/video/qoe */
  async function qoeCard(days) {
    const box = $("#ops-qoe"); if (!box) return;
    const sec = ms => (ms === null || ms === undefined ? "—" : (Math.round(ms / 100) / 10).toLocaleString("ar-SA-u-nu-latn"));
    let q; try { q = await api("GET", "/api/admin/video/qoe?days=" + days); } catch (e) { box.removeAttribute("aria-busy"); box.innerHTML = `<h3 id="ops-qoe-h">جودة تشغيل الفيديو</h3><p class="muted">${esc(e.message)}</p>`; return; }
    if (!document.body.contains(box)) return;
    box.removeAttribute("aria-busy");
    const src = q.bySource || {}, row = (k, l) => { const x = src[k] || {}; return `<tr><td>${l}</td><td>${nf(x.plays)}</td><td>${sec(x.p50StartupMs)}</td><td>${sec(x.p90StartupMs)}</td><td>${x.stallRate === null || x.stallRate === undefined ? "—" : esc(x.stallRate) + "٪"}</td></tr>`; };
    box.innerHTML = `<h3 id="ops-qoe-h">جودة تشغيل الفيديو</h3>
<div class="ops-tabs" role="group" aria-label="مدى جودة التشغيل">${[1, 7, 30].map(d => `<a href="#" data-qdays="${d}"${d === q.days ? ' aria-current="page"' : ""}>${d === 1 ? "اليوم" : d === 7 ? "7 أيام" : d + " يوماً"}</a>`).join("")}</div>
${q.plays ? `<div class="ops-grid"><div class="ops-kpi"><b>${sec(q.p50StartupMs)}</b><span>زمن البدء p50 (ث)</span></div><div class="ops-kpi"><b>${sec(q.p90StartupMs)}</b><span>زمن البدء p90 (ث)</span></div><div class="ops-kpi"><b>${esc(q.stallRate)}٪</b><span>نسبة التشغيلات المتقطّعة</span></div><div class="ops-kpi"><b>${sec(q.avgWatchedMs)}</b><span>متوسط المشاهدة (ث)</span></div><div class="ops-kpi"><b>${nf(q.plays)}</b><span>عدد التشغيلات</span></div></div>
${q.perDay.length > 1 ? bars(q.perDay, ["plays"], ["#2563eb"]) + line(q.perDay.filter(d => d.plays), { key: "p90StartupMs", color: "#d97706", fmtX: x => x.day }) + legend([["#2563eb", "التشغيلات يومياً"], ["#d97706", "زمن البدء p90 يومياً (م.ث)"]]) : ""}
<div class="ops-x"><table class="ops-tbl"><thead><tr><th>المصدر</th><th>التشغيلات</th><th>p50 (ث)</th><th>p90 (ث)</th><th>التقطّع</th></tr></thead><tbody>${row("clips", "المقاطع القصيرة")}${row("post", "فيديو المنشورات")}</tbody></table></div>` : `<p class="muted">لا توجد قياسات تشغيل بعد في هذه المدة.</p>`}`;
    box.querySelectorAll("[data-qdays]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); qoeCard(+a.dataset.qdays); }));
  }
  /* v2.133: «جودة البحث» — searches, zero-result rate, click-through, latency, engine + index coverage, and the queries that found
   * nothing (what the index or the community is missing). GET /api/admin/search/metrics */
  async function searchCard(days) {
    const box = $("#ops-srch"); if (!box) return;
    let m; try { m = await api("GET", "/api/admin/search/metrics?days=" + days); } catch (e) { box.removeAttribute("aria-busy"); box.innerHTML = `<h3 id="ops-srch-h">جودة البحث</h3><p class="muted">${esc(e.message)}</p>`; return; }
    if (!document.body.contains(box)) return;
    box.removeAttribute("aria-busy");
    const pct = (x) => (x === null || x === undefined ? "—" : esc(x) + "٪"), eng = { hybrid: "هجين (كلمات + معنى)", index: "فهرس الكلمات", builtin: "مسح احتياطي" }[m.engine] || m.engine;
    box.innerHTML = `<h3 id="ops-srch-h">جودة البحث</h3>
<div class="ops-tabs" role="group" aria-label="مدى جودة البحث">${[1, 7, 30].map(d => `<a href="#" data-sdays="${d}"${d === m.days ? ' aria-current="page"' : ""}>${d === 1 ? "اليوم" : d === 7 ? "7 أيام" : d + " يوماً"}</a>`).join("")}</div>
<div class="ops-grid"><div class="ops-kpi"><b>${nf(m.searches)}</b><span>عمليات بحث</span></div><div class="ops-kpi"><b>${pct(m.zeroRate)}</b><span>بلا نتائج</span></div><div class="ops-kpi"><b>${pct(m.ctr)}</b><span>نسبة النقر</span></div><div class="ops-kpi"><b>${m.avgMs === null ? "—" : nf(m.avgMs)}</b><span>متوسط الزمن (م.ث)</span></div><div class="ops-kpi"><b>${pct(m.coverage ? Math.round(m.coverage.ratio * 1000) / 10 : null)}</b><span>تغطية الفهرس</span></div><div class="ops-kpi"><b>${esc(eng)}</b><span>المحرك</span></div></div>
${m.perDay.length > 1 ? bars(m.perDay.map(d => ({ ...d, ok: d.searches - d.zero })), ["ok", "zero"], ["#2563eb", "#d97706"]) + legend([["#2563eb", "بحث بنتائج"], ["#d97706", "بلا نتائج"]]) : ""}
${m.zeroQueries.length ? `<div class="ops-x"><table class="ops-tbl"><thead><tr><th>بحث بلا نتائج</th><th>المرات</th></tr></thead><tbody>${m.zeroQueries.map(z => `<tr><td><bdi>${esc(z.q)}</bdi></td><td>${nf(z.n)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">لا توجد عمليات بحث بلا نتائج في هذه الفترة.</p>`}`;
    box.querySelectorAll("[data-sdays]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); searchCard(+a.dataset.sdays); }));
  }
  async function incidents() {
    const box = $("#ops-inc"); if (!box) return;
    let r; try { r = await api("GET", "/api/admin/ops/incidents"); } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    box.innerHTML = r.incidents.length ? r.incidents.map(i => `<div style="border-bottom:1px solid var(--line,#e2e8f0);padding:6px 0"><b>${esc(i.title)}</b> <span class="ops-st ${i.status === "resolved" ? "" : i.impact === "critical" ? "bad" : "warn"}">${esc(i.statusLabel)}</span><div class="muted">${esc(i.impactLabel)} · ${esc(String(i.createdAt).slice(0, 16).replace("T", " "))}</div>${i.status === "resolved" ? "" : `<div style="display:flex;gap:6px;margin-top:4px"><input data-iu="${esc(i.id)}" maxlength="2000" placeholder="تحديث للمستخدمين" aria-label="تحديث الحادثة" style="flex:1"><select data-is="${esc(i.id)}" aria-label="الحالة"><option value="identified">تم تحديد السبب</option><option value="monitoring">قيد المراقبة</option><option value="resolved">تم الحل</option></select><button class="btn ghost" data-ig="${esc(i.id)}">نشر</button></div>`}</div>`).join("") : `<p class="muted">لا حوادث في آخر 14 يوماً.</p>`;
    box.querySelectorAll("[data-ig]").forEach(b => b.addEventListener("click", async () => {
      const iid = b.dataset.ig, body = box.querySelector(`[data-iu="${iid}"]`).value, status = box.querySelector(`[data-is="${iid}"]`).value;
      try { await api("POST", `/api/admin/ops/incidents/${encodeURIComponent(iid)}/updates`, { body, status }); note("نُشر التحديث"); incidents(); } catch (e) { note(e.message); }
    }));
  }

  /* ---------- #/admin/ops/product ---------- */
  async function productView(days = 30) {
    const v = view, tok = (v._ops = {});
    v.innerHTML = `<div class="wrap ops-page">${head("product")}<div id="ops-body" aria-busy="true"><div class="skel"></div><div class="skel"></div></div></div>`;
    let p; try { p = await api("GET", "/api/admin/ops/product?days=" + days); } catch (e) { if (v._ops === tok) $("#ops-body").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    if (v._ops !== tok) return;
    const t = p.totals, cell = x => (x === null ? `<td class="ops-cell muted">—</td>` : `<td class="ops-cell" style="background:rgba(37,99,235,${(0.08 + (x / 100) * 0.8).toFixed(2)});color:${x > 55 ? "#fff" : "inherit"}">${esc(x)}٪</td>`);
    $("#ops-body").removeAttribute("aria-busy");
    $("#ops-body").innerHTML = `
<div class="ops-tabs" role="group" aria-label="المدى">${[7, 30, 90].map(d => `<a href="#" data-days="${d}"${d === p.days ? ' aria-current="page"' : ""}>${d} يوماً</a>`).join("")}</div>
<div class="ops-grid"><div class="ops-kpi"><b>${nf(t.users)}</b><span>إجمالي المستخدمين</span></div><div class="ops-kpi"><b>${nf(t.signups)}</b><span>تسجيلات جديدة (${p.days} يوماً)</span></div><div class="ops-kpi"><b>${nf(t.dau)}</b><span>نشطون اليوم DAU</span></div><div class="ops-kpi"><b>${nf(t.wau)}</b><span>نشطون أسبوعياً WAU</span></div><div class="ops-kpi"><b>${nf(t.mau)}</b><span>نشطون شهرياً MAU</span></div><div class="ops-kpi"><b>${esc(t.stickiness)}٪</b><span>الالتصاق DAU/MAU</span></div><div class="ops-kpi"><b>${esc(t.actionsPerActiveDay)}</b><span>تفاعلات لكل يوم نشط</span></div></div>
<div class="card"><h3>النمو: إجمالي المستخدمين</h3>${line(p.growth, { key: "users", color: "#1f9d55", fmtX: x => x.day })}</div>
<div class="card"><h3>تسجيلات يومية</h3>${bars(p.growth, ["signups"], ["#2563eb"])}</div>
<div class="card"><h3>المستخدمون النشطون يومياً</h3>${line(p.engagement, { key: "active", color: "#7c3aed", fmtX: x => x.day })}</div>
<div class="card"><h3>التفاعل اليومي</h3>${bars(p.engagement, ["posts", "comments", "reactions"], ["#2563eb", "#d97706", "#db2777"])}${legend([["#2563eb", "منشورات"], ["#d97706", "تعليقات"], ["#db2777", "تفاعلات"]])}</div>
<div class="card"><h3>الاحتفاظ حسب أسبوع التسجيل</h3><div style="overflow-x:auto"><table class="ops-tbl"><thead><tr><th>أسبوع التسجيل</th><th>العدد</th>${Array.from({ length: 8 }, (_, k) => `<th class="ops-cell">أ${k}</th>`).join("")}</tr></thead><tbody>${p.cohorts.map(c => `<tr><td>${esc(c.week)}</td><td>${nf(c.size)}</td>${Array.from({ length: 8 }, (_, k) => k < c.retention.length ? cell(c.retention[k]) : `<td></td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="muted" style="font-size:12px;margin:6px 0 0">نسبة من سجّلوا في الأسبوع وكانوا نشطين (نشر، تعليق، تفاعل، أو استخدام) في الأسبوع k بعد التسجيل. محسوبة من الجداول الحالية، دون أي تتبع إضافي.</p></div>`;
    v.querySelectorAll("[data-days]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); productView(+a.dataset.days); }));
  }

  /* ---------- wiring ---------- */
  const card = `<a class="card" id="ops-adm" href="#/admin/ops" style="display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none"><span aria-hidden="true" style="font-size:24px"><svg class=ei aria-hidden=true><use href=#i-trendUp /></svg></span><span style="flex:1"><b>التشغيل والمراقبة</b><span class="muted" style="display:block">رسوم الأداء، أهداف الخدمة، التنبيهات، الحوادث، مؤشرات المنتج</span></span><span aria-hidden="true">‹</span></a>`;
  const _extra = window.ExtraRoutes;
  window.ExtraRoutes = (a, b) => {
    const prev = _extra ? _extra(a, b) : {};
    return { ...prev, admin: () => {
      if ((a || "").split("?")[0] === "ops") { if (!DB.isAdmin) return Views.notFound(); return (b || "").split("?")[0] === "product" ? productView() : opsView(); }
      (prev.admin || Views.notFound)();
      if (!a && DB.isAdmin) setTimeout(() => { if (location.hash === "#/admin" && !document.getElementById("ops-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", card); }, 0);
    } };
  };
  window.MPOps = { ops: opsView, product: productView, qoe: qoeCard, line, bars, version: "2.23.0" };
  if (/^#\/admin(\/ops)?(\/|$|\?)/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
