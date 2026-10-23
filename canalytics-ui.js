/* =====================================================================
 * مجتمع بلس — Phase 61 UI: advanced creator analytics (lazy "canalytics" chunk; 0 bytes in core).
 * Extends the creator studio (#/studio, Phase 15) — linked from its header.
 *   #/analytics                 overview: KPIs vs the previous period, daily views / engagement, weekly trend
 *   #/analytics/audience        growth (gained / lost / net), retention (returning viewers, follower cohorts), demographics (k-anonymous)
 *   #/analytics/content         per-post performance (reach, attention, completion, engagement), by type, best time to post
 *   #/analytics/earnings        tips, subscriptions, paid posts, digital products, market — gross / fees / net, ad spend
 *   #/analytics/compare         any two periods side by side
 * Every report: period chips (7 / 28 / 90 / 365 days) or a custom range, CSV export. Charts are self-drawn SVG.
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function CreatorAnalyticsUI() {
  if (window.MPCAnalytics) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const fmt = (x, d = 1) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: d })}</bdi>`;
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const tz = () => -new Date().getTimezoneOffset();
  const TABS = [["", "نظرة عامة"], ["audience", "الجمهور"], ["content", "المحتوى"], ["earnings", "الأرباح"], ["compare", "مقارنة"]];
  if (!document.getElementById("ca-css")) document.head.insertAdjacentHTML("beforeend", `<style id="ca-css">
.ca-page{max-width:820px;margin:auto}.ca-page h2:focus{outline:none}
.ca-h3{font-size:16px;font-weight:800;margin:24px 0 10px;display:flex;align-items:center;gap:6px}.ca-small{font-size:13px;margin:4px 0 8px}
.ca-per{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 var(--s3);overflow:visible}.ca-per a,.ca-per button{min-height:40px}.ca-per label{display:flex;flex-direction:column;font-size:13px;gap:4px;color:var(--muted)}.ca-per input,.ca-per select{min-height:44px}
.ca-range>summary{list-style:none;cursor:pointer;min-height:40px;display:inline-flex;align-items:center;gap:6px;padding:0 12px;border-radius:999px;border:1px dashed var(--line-2);color:var(--text-2);font-size:14px}.ca-range>summary::-webkit-details-marker{display:none}.ca-range[open]>summary{border-style:solid;border-color:var(--accent)}
.ca-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}@media(min-width:620px){.ca-g{grid-template-columns:repeat(3,minmax(0,1fr))}}
.ca-k{min-width:0}.ca-k b{font-size:var(--fs-3xl);letter-spacing:-.01em}.ca-k b small{font-size:13px;font-weight:600;color:var(--muted)}.ca-k>div{margin-top:4px;min-height:16px}
.ca-up{color:color-mix(in srgb,var(--ok) 65%,var(--text));font-size:12px;font-weight:600}.ca-dn{color:color-mix(in srgb,var(--danger) 75%,var(--text));font-size:12px;font-weight:600}.ca-eq{color:var(--muted);font-size:12px}
.ca-card{padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1);margin:8px 0}
.ca-chart{width:100%;height:auto;display:block;margin:4px 0;overflow:visible}.ca-chart .ln{fill:none;stroke:var(--accent);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}.ca-chart .ln2{fill:none;stroke:var(--brand-3);stroke-width:2;stroke-dasharray:4 3}.ca-chart .br{fill:var(--accent)}.ca-chart .bn{fill:var(--danger)}.ca-chart .ax{stroke:var(--line-2);stroke-width:1}.ca-chart text{font-size:11px;fill:var(--muted)}
.ca-leg{display:flex;gap:14px;font-size:12px;color:var(--muted);margin-top:2px}.ca-leg i{display:inline-block;width:12px;height:3px;border-radius:2px;background:var(--accent);vertical-align:middle;margin-inline-end:4px}.ca-leg i.b{background:var(--brand-3)}
.ca-bars{list-style:none;padding:0;margin:6px 0}.ca-bars li{display:flex;gap:10px;align-items:center;margin:8px 0;font-size:14px}.ca-bars .lb{width:118px;flex:none;line-height:1.35}.ca-bars .tr{flex:1;height:8px;background:var(--bg-2);border-radius:6px;overflow:hidden}.ca-bars .tr i{display:block;height:100%;border-radius:6px;background:var(--grad)}.ca-bars .v{min-width:44px;text-align:end;flex:none;font-weight:700;font-size:13px}
.ca-t{width:100%;border-collapse:collapse;font-size:14px}.ca-t th{font-size:12.5px;color:var(--muted);font-weight:600}.ca-t th,.ca-t td{padding:9px 6px;border-bottom:1px solid var(--line);text-align:start;vertical-align:top}.ca-t td.n,.ca-t th.n{text-align:end;white-space:nowrap}.ca-scroll{overflow-x:auto;border-radius:var(--r-sm)}
.ca-note{padding:10px 12px;border-radius:var(--r-sm);background:var(--bg-2);color:var(--text-2);font-size:13.5px;line-height:1.7;margin:8px 0}.ca-row{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.ca-row .btn,.ca-row a.btn{min-height:44px}
.ca-fig{margin:0;padding:10px 10px 4px;border-radius:var(--r);background:var(--card);border:1px solid var(--line)}.ca-int{touch-action:pan-y;cursor:crosshair}.ca-chart .gr{stroke:var(--line);stroke-dasharray:3 4}.ca-chart .cur{stroke:var(--muted);stroke-width:1;stroke-dasharray:2 3}.ca-chart .dot{fill:var(--accent);stroke:var(--card);stroke-width:2.5}.ca-read{font-size:12.5px;min-height:20px;margin:2px 4px 4px;color:var(--muted)}.ca-read b{color:var(--text)}
.ca-ins{display:grid;gap:8px;margin:8px 0}.ca-in{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1)}.ca-in .ico{flex:none;width:34px;height:34px;border-radius:11px;display:grid;place-items:center;font-size:17px;background:var(--accent2)}.ca-in.good .ico{background:color-mix(in srgb,var(--ok) 16%,transparent)}.ca-in.warn .ico{background:color-mix(in srgb,var(--warn) 18%,transparent)}.ca-in b{display:block;margin-bottom:2px;font-size:15px}.ca-in p{margin:0;font-size:14px;line-height:1.75;color:var(--text-2)}.ca-in .btn{min-height:40px;margin-top:8px}
.ca-goals{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin:8px 0}.ca-goal{display:flex;gap:12px;align-items:center;padding:10px 12px;border-radius:var(--r);background:var(--card);border:1px solid var(--line)}.ca-goal .grow{flex:1;min-width:0}.ca-goal small{display:block;color:var(--muted);margin-top:2px}.ca-goal button{min-height:44px;min-width:44px;color:var(--muted)}
.ca-ring .bg{fill:none;stroke:var(--bg-2);stroke-width:6}.ca-ring .fg{fill:none;stroke:var(--accent);stroke-width:6;stroke-linecap:round;transition:stroke-dashoffset .6s}.ca-ring text{font-size:12.5px;font-weight:800;fill:var(--text)}
.ca-hero{text-align:center;padding:28px 18px;border-radius:var(--r-lg);background:var(--hero-grad);color:#fff;box-shadow:var(--sh-2)}.ca-hero p,.ca-hero ol{color:#ffffffd8}.ca-hero h3{margin:6px 0;font-size:19px;font-weight:800}.ca-hero p{color:#ffffffd8;line-height:1.8;margin:6px auto;max-width:420px}.ca-hero ol{text-align:start;display:inline-block;margin:10px auto;line-height:2.1;color:#ffffffd8}.ca-hero .btn{min-height:46px;padding-inline:22px;background:#fff;color:var(--accent-ink);box-shadow:none}
.ca-ph{padding:16px;border-radius:var(--r-lg);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1);margin:8px 0}.ca-ph h3{margin:6px 0 8px;font-size:18px;font-weight:800;line-height:1.6}.ca-rank{display:inline-block;padding:3px 10px;border-radius:999px;background:var(--grad);color:#fff;font-size:12px;font-weight:700}
.ca-types{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.ca-type{padding:12px;border-radius:var(--r);background:var(--card);border:1px solid var(--line)}.ca-type>b{font-size:15px}.ca-type>span{display:block;font-size:12.5px}.ca-type dl{margin:8px 0 0;display:grid;gap:4px}.ca-type dl div{display:flex;justify-content:space-between;gap:6px;font-size:13px}.ca-type dt{color:var(--muted)}.ca-type dd{margin:0;font-weight:700}
.ca-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ca-slot{padding:12px 8px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);text-align:center;display:flex;flex-direction:column;gap:2px}.ca-slot.top{border-color:var(--accent);background:var(--accent2)}.ca-slot .d{font-weight:800}.ca-slot .t{font-size:13px;color:var(--text-2)}.ca-slot .muted{font-size:11.5px;line-height:1.4}
.ca-plist{list-style:none;padding:0;margin:0;display:grid;gap:8px}.ca-pc{display:block;padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);text-decoration:none;color:inherit;box-shadow:var(--sh-1)}.ca-pc:active{background:var(--bg-2)}.ca-pc .top{display:flex;justify-content:space-between;align-items:center;gap:8px}.ca-pc .ttl{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:6px 0 10px;line-height:1.55;font-size:15px}
.ca-pc .mx{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;border-top:1px solid var(--line);padding-top:8px}.ca-pc .mx span{display:flex;flex-direction:column;align-items:center;font-size:11px;color:var(--muted)}.ca-pc .mx b{font-size:14.5px;color:var(--text);font-weight:800}
.ca-streams{list-style:none;padding:0;margin:0;border-radius:var(--r);background:var(--card);border:1px solid var(--line);overflow:hidden}.ca-streams li{display:flex;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line)}.ca-streams li:last-child{border-bottom:0}.ca-streams .grow{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.ca-streams .grow .muted{font-size:12.5px;line-height:1.5}.ca-streams .nt{display:flex;flex-direction:column;align-items:flex-end;text-align:end;flex:none}.ca-streams .nt .muted{font-size:11.5px}
.ca-empty{text-align:center;padding:26px 12px;color:var(--muted)}.ca-empty>span{font-size:30px;display:block}.ca-empty p{margin:6px 0 0;line-height:1.7}
.ca-sk{height:86px;border-radius:var(--r);margin:8px 0}
</style>`);

  /* ---------- period + shell ---------- */
  function periodQuery() {
    const q = qs(), from = q.get("from"), to = q.get("to");
    return from && to ? `from=${enc(from)}&to=${enc(to)}&tz=${tz()}` : `days=${enc(q.get("days") || "28")}&tz=${tz()}`;
  }
  function shell(tab, body) {
    const q = qs(), days = q.get("days") || (q.get("from") ? "" : "28"), base = "#/analytics" + (tab ? "/" + tab : "");
    view.innerHTML = `<div class="wrap ca-page"><header class="page-head"><a class="back" href="#/studio"><span class="fwd" aria-hidden="true">→</span> استوديو المنشئ</a><div class="ph-main"><div><h2 id="ca-h" tabindex="-1"><svg class="ic" aria-hidden="true"><use href="#i-chart"/></svg>تحليلات متقدمة</h2></div></div></header>
      <nav class="ca-tabs seg" aria-label="أقسام التحليلات">${TABS.map(([k, l]) => `<a href="#/analytics${k ? "/" + k : ""}${days ? "?days=" + days : ""}" ${k === tab ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      ${tab === "compare" ? "" : `<div class="ca-per f-chips" role="group" aria-label="الفترة">${[["7", "7 أيام"], ["28", "28 يوماً"], ["90", "90 يوماً"], ["365", "سنة"]].map(([d, l]) => `<a class="chip f ${days === d ? "on" : ""}" href="${base}?days=${d}" ${days === d ? 'aria-current="true"' : ""}>${l}</a>`).join("")}
        <details class="ca-range" ${q.get("from") ? "open" : ""}><summary><svg class=ix aria-hidden=true><use href=#i-cal /></svg> فترة مخصصة</summary><form id="ca-cf" class="ca-per"><label>من<input type="date" name="from" value="${h(q.get("from") || "")}" required></label><label>إلى<input type="date" name="to" value="${h(q.get("to") || "")}" required></label><button class="btn ghost">تطبيق</button></form></details></div>`}
      <div id="ca-b" aria-live="polite">${body || `<div class="ca-g" aria-hidden="true">${"<div class=\"skel ca-sk\"></div>".repeat(4)}</div><div class="skel ca-sk" style="height:170px" aria-hidden="true"></div>`}</div></div>`;
    $("#ca-h")?.focus({ preventScroll: true });
    $("#ca-cf")?.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); location.hash = `${base}?from=${enc(f.get("from"))}&to=${enc(f.get("to"))}`; });
  }
  const csvBtn = (report) => `<a class="btn ghost" download href="/api/creator/analytics/export.csv?report=${report}&${periodQuery()}">تصدير CSV</a>`;
  function deltaTag(v, invert) {
    if (!v) return `<span class="ca-eq">— كما السابق</span>`;
    const good = invert ? v < 0 : v > 0;
    return `<span class="${good ? "ca-up" : "ca-dn"}">${v > 0 ? "▲" : "▼"} <bdi dir="ltr">${Math.abs(v)}%</bdi> عن السابقة</span>`;
  }
  const kpi = (label, value, d, unit = "", invert = false) => `<div class="ca-k kpi-tile"><b>${value}${unit ? ` <small>${unit}</small>` : ""}</b><span>${label}</span><div>${d === undefined ? "" : deltaTag(d, invert)}</div></div>`;

  /* ---------- SVG charts (time runs left → right, like every chart reader expects) ---------- */
  let chartN = 0;
  /** chart width in user units = its real width on screen, so labels stay legible on a phone */
  const cw = () => Math.round(Math.min(760, Math.max(300, (document.querySelector("#view .ca-page")?.clientWidth || innerWidth) - 24)));
  function lineChart(series, { second, label, w = cw(), hgt = 170, unit = "" } = {}) {
    if (!series.length) return "";
    const all = [...series.map((x) => x.value), ...(second || []).map((x) => x.value)], max = Math.max(1, ...all), n = series.length, px = (i) => 30 + (i * (w - 40)) / Math.max(1, n - 1), py = (v) => hgt - 20 - (v / max) * (hgt - 35);
    const pts = (s) => s.map((x, i) => `${px(i).toFixed(1)},${py(x.value).toFixed(1)}`).join(" ");
    const ticks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
    const sum = series.reduce((a, x) => a + x.value, 0), peak = series.reduce((a, x) => (x.value > a.value ? x : a), series[0]), id = "cag" + ++chartN;
    const area = `30,${hgt - 20} ${pts(series)} ${px(n - 1).toFixed(1)},${hgt - 20}`;
    const data = h(JSON.stringify({ d: series.map((x) => x.day), a: series.map((x) => x.value), b: second ? second.map((x) => x.value) : null, w, n, u: unit }));
    return `<figure class="ca-fig"><svg class="ca-chart ca-int" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="${h(label)}: المجموع ${sum}، الذروة ${peak.value} يوم ${peak.day}" dir="ltr" data-c="${data}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent,#5b2bd6)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent,#5b2bd6)" stop-opacity="0"/></linearGradient></defs>
      <line class="gr" x1="30" y1="${py(max / 2)}" x2="${w - 10}" y2="${py(max / 2)}"/><line class="ax" x1="30" y1="${hgt - 20}" x2="${w - 10}" y2="${hgt - 20}"/><text x="2" y="${py(max) + 4}">${max}</text><text x="2" y="${hgt - 18}">0</text>
      <polygon points="${area}" fill="url(#${id})"/>${second ? `<polyline class="ln2" points="${pts(second)}"/>` : ""}<polyline class="ln" points="${pts(series)}"/>${ticks.map((i) => `<text x="${px(i) - 14}" y="${hgt - 4}">${h(series[i].day.slice(5))}</text>`).join("")}
      <line class="cur" x1="0" y1="10" x2="0" y2="${hgt - 20}" visibility="hidden"/><circle class="dot" r="4" visibility="hidden"/></svg><figcaption class="ca-read muted" aria-live="polite">المس الرسم لعرض قيمة يوم محدد</figcaption></figure>`;
  }
  /** tap / hover readout for line charts (no library: one pointer handler per chart) */
  function wireCharts(root = view) {
    root.querySelectorAll("svg.ca-int:not([data-w])").forEach((svg) => {
      svg.dataset.w = "1"; let c; try { c = JSON.parse(svg.dataset.c); } catch { return; }
      const read = svg.parentElement.querySelector(".ca-read"), cur = svg.querySelector(".cur"), dot = svg.querySelector(".dot"), hgt = svg.viewBox.baseVal.height, max = Math.max(1, ...c.a, ...(c.b || []));
      const show = (e) => {
        const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * c.w, i = Math.max(0, Math.min(c.n - 1, Math.round(((x - 30) / (c.w - 40)) * (c.n - 1))));
        const X = 30 + (i * (c.w - 40)) / Math.max(1, c.n - 1), Y = hgt - 20 - (c.a[i] / max) * (hgt - 35);
        cur.setAttribute("x1", X); cur.setAttribute("x2", X); cur.setAttribute("visibility", "visible"); dot.setAttribute("cx", X); dot.setAttribute("cy", Y); dot.setAttribute("visibility", "visible");
        read.innerHTML = `<b><bdi dir="ltr">${h(c.d[i])}</bdi></b> · ${fmt(c.a[i])}${c.u ? " " + h(c.u) : ""}${c.b ? ` · التفاعل ${fmt(c.b[i])}` : ""}`;
      };
      svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show);
    });
  }
  /** progress ring for a goal (0–100) */
  const ring = (p, size = 64) => { const r = size / 2 - 6, C = 2 * Math.PI * r, off = C * (1 - Math.min(100, Math.max(0, p)) / 100); return `<svg class="ca-ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="bg"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/><text x="50%" y="54%" text-anchor="middle">${Math.round(p)}%</text></svg>`; };
  function barChart(series, { label, w = cw(), hgt = 150, key = "value" } = {}) {
    if (!series.length) return "";
    const vals = series.map((x) => Number(x[key] || 0)), max = Math.max(1e-9, ...vals.map(Math.abs)), n = series.length, bw = (w - 40) / n, zero = vals.some((v) => v < 0) ? (hgt - 20) / 2 + 5 : hgt - 20;
    return `<svg class="ca-chart" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="${h(label)}" dir="ltr"><line class="ax" x1="30" y1="${zero}" x2="${w - 10}" y2="${zero}"/>${vals.map((v, i) => { const bh = (Math.abs(v) / max) * (zero - 15); return `<rect class="${v < 0 ? "bn" : "br"}" x="${(30 + i * bw + 1).toFixed(1)}" y="${(v < 0 ? zero : zero - bh).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(v ? 1 : 0, bh).toFixed(1)}"><title>${h(series[i].day || "")}: ${v}</title></rect>`; }).join("")}
      <text x="30" y="${hgt - 4}">${h((series[0].day || "").slice(5))}</text><text x="${w - 50}" y="${hgt - 4}">${h((series[n - 1].day || "").slice(5))}</text></svg>`;
  }
  const bars = (list, emptyMsg) => (list.length ? `<ul class="ca-bars">${list.map((b) => `<li><span class="lb">${h(b.label)}</span><span class="tr" aria-hidden="true"><i style="width:${Math.min(100, Math.max(0, b.share))}%"></i></span><span class="v"><bdi dir="ltr">${b.value !== undefined ? Number(b.value || 0).toLocaleString("en-US", { maximumFractionDigits: 1 }) + (b.unit || "") : Number(b.share || 0).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%"}</bdi></span></li>`).join("")}</ul>` : `<p class="muted">${h(emptyMsg)}</p>`);

  /* ---------- overview ---------- */
  async function overviewView() {
    shell("");
    let d; try { d = await api("GET", "/api/creator/analytics/overview?" + periodQuery()); } catch (e) { if (!$("#ca-b")) return; $("#ca-b").innerHTML = errBox(e); return; }
    const K = d.kpis, D = d.deltas;
    if (!$("#ca-b")) return; $("#ca-b").innerHTML = `<div class="ca-g">${kpi("المشاهدات", fmt(K.views), D.views)}${kpi("الوصول (أشخاص)", fmt(K.reach), D.reach)}${kpi("معدل التفاعل", fmt(K.engagementRate), D.engagementRate, "%")}${kpi("صافي المتابعين", (K.followersNet > 0 ? "+" : "") + fmt(K.followersNet), D.followersNet)}
      ${kpi("متوسط مدة الانتباه", fmt(K.avgAttentionSeconds, 0), D.avgAttentionSeconds, "ث")}${kpi("نسبة الإكمال", fmt(K.completionRate), D.completionRate, "%")}${kpi("دقائق القراءة والمشاهدة", fmt(K.watchMinutes, 0), D.watchMinutes)}${kpi("صافي الأرباح", fmt(K.earningsNet, 4), D.earningsNet, "π")}</div>
      <h3 class="ca-h3">المشاهدات والتفاعل يومياً</h3><div class="ca-leg"><span><i></i>المشاهدات</span><span><i class="b"></i>التفاعل</span></div>${lineChart(d.daily.views, { unit: "مشاهدة", second: d.daily.engagement, label: "المشاهدات اليومية" })}
      <div class="ca-note">${d.weekly.length >= 2 ? `آخر أسبوع: ${deltaTag(d.weekTrend)} مقارنة بالأسبوع الذي قبله.` : "تحتاج أسبوعين على الأقل لعرض الاتجاه الأسبوعي."} الأرقام تقارن بالفترة السابقة بنفس الطول (${fmt(d.previous.views)} مشاهدة).</div>
      ${d.minor ? `<div class="ca-note">حسابات القاصرين لا تستقبل أرباحاً؛ بقية التحليلات متاحة.</div>` : ""}<section id="ca-ins" aria-label="نصائح من أرقامك"></section><section id="ca-gl" aria-labelledby="ca-glh"></section>`;
    insightsBox(); goalsBox();
  }

  /* ---------- insights (plain-language tips from the creator's own numbers) ---------- */
  async function insightsBox() {
    let d; try { d = await api("GET", "/api/creator/analytics/insights?" + periodQuery()); } catch { return; }
    const box = $("#ca-ins"); if (!box) return;
    if (d.empty) {
      box.parentElement?.prepend(box);
      box.innerHTML = `<div class="ca-hero"><div class="em" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-chart /></svg></div><h3>تحليلاتك تبدأ من أول منشور</h3><p class="muted">هنا سترى من يشاهدك، ومتى، وما الذي يجعل محتواك ينجح — بأرقام مجمّعة تحفظ خصوصية جمهورك.</p>
        <ol><li>انشر منشوراً أو مقالاً أو فيديو قصيراً</li><li>شاركه في مجتمع مهتم بالموضوع</li><li>عد بعد يوم لترى أول النتائج والنصائح</li></ol><div><button class="btn" id="ca-compose"><svg class=ix aria-hidden=true><use href=#i-pen /></svg> اكتب أول منشور</button></div></div>`;
      $("#ca-compose")?.addEventListener("click", () => document.getElementById("fab")?.click());
      return;
    }
    const ICO = { good: "", tip: "", warn: "" };
    box.innerHTML = d.insights.length ? `<h3 class="ca-h3">ماذا تقول أرقامك؟</h3><div class="ca-ins">${d.insights.map((x) => `<div class="ca-in ${h(x.tone)}"><span class="ico" aria-hidden="true">${ICO[x.tone] || ""}</span><div><b>${h(x.title)}</b><p>${h(x.body)}</p>${x.action ? (x.action.compose ? `<button class="btn ghost" data-ca-compose>${h(x.action.label)}</button>` : `<a class="btn ghost" href="${h(x.action.href)}">${h(x.action.label)}</a>`) : ""}</div></div>`).join("")}</div>` : "";
    box.querySelectorAll("[data-ca-compose]").forEach((b) => b.addEventListener("click", () => document.getElementById("fab")?.click()));
  }

  /* ---------- goals ---------- */
  async function goalsBox() {
    const box = $("#ca-gl"); if (!box) return;
    let d; try { d = await api("GET", "/api/creator/analytics/goals"); } catch { return; }
    const free = d.available.filter((a) => !d.goals.some((g) => g.metric === a.key));
    box.innerHTML = `<h3 id="ca-glh" class="ca-h3"><svg class=ix aria-hidden=true><use href=#i-target /></svg> أهدافي</h3>${d.goals.length ? `<div class="ca-goals">${d.goals.map((g) => `<div class="ca-goal">${ring(g.percent)}<div class="grow"><b>${h(g.label)}</b><small>${fmt(g.current)} من ${fmt(g.target)} ${h(g.unit)}${g.done ? " — تحقق" : ""}</small></div><button class="btn ghost" data-gdel="${h(g.metric)}" aria-label="حذف هدف ${h(g.label)}">✕</button></div>`).join("")}</div>` : `<p class="muted">حدّد هدفاً واحداً واضحاً — مثل ١٠٠ متابع أو ٣ منشورات أسبوعياً — وتابع تقدّمك هنا.</p>`}
      ${free.length ? `<form id="ca-gf" class="ca-per"><label>الهدف<select name="metric">${free.map((a) => `<option value="${a.key}">${h(a.label)}</option>`).join("")}</select></label><label>القيمة<input type="number" name="target" min="1" step="any" required inputmode="decimal" style="width:110px"></label><button class="btn">إضافة الهدف</button></form>` : ""}`;
    box.querySelector("#ca-gf")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("PUT", "/api/creator/analytics/goals", { metric: f.get("metric"), target: +f.get("target") }); toast("تم حفظ الهدف"); goalsBox(); } catch (er) { toast(er.message); } });
    box.querySelectorAll("[data-gdel]").forEach((b) => b.addEventListener("click", async () => { try { await api("DELETE", "/api/creator/analytics/goals/" + enc(b.dataset.gdel)); goalsBox(); } catch (er) { toast(er.message); } }));
  }

  /* ---------- one post in depth ---------- */
  async function postView(id) {
    shell("content");
    $(".ca-per")?.remove(); $("#ca-cf")?.remove();
    let d; try { d = await api("GET", `/api/creator/analytics/post/${enc(id)}?tz=${tz()}`); } catch (e) { if (!$("#ca-b")) return; $("#ca-b").innerHTML = errBox(e) + `<div class="ca-row"><a class="btn ghost" href="#/analytics/content">→ كل المنشورات</a></div>`; return; }
    const T = d.totals, X = d.versus, P = d.post;
    if (!$("#ca-b")) return;
    $("#ca-b").innerHTML = `<a href="#/analytics/content" class="ca-back">→ كل المنشورات</a>
      <div class="ca-ph"><span class="ca-chip sbadge role">${h(P.typeLabel)}</span> <span class="u-t-sm muted">نُشر ${h(new Date(P.at).toLocaleDateString("ar-u-nu-latn", { day: "numeric", month: "long", year: "numeric" }))}</span><h3>${h(P.title || "(بلا عنوان)")}</h3>
        ${X.rank ? `<span class="ca-rank">#${X.rank} من ${X.of} في آخر 90 يوماً</span> ` : ""}${X.medianViews ? (X.viewsVsMedian ? `<span class="u-t-sm ${X.viewsVsMedian > 0 ? "ca-up" : "ca-dn"}">${X.viewsVsMedian > 0 ? "▲" : "▼"} <bdi dir="ltr">${Math.abs(X.viewsVsMedian)}%</bdi> عن متوسط منشوراتك</span>` : `<span class="ca-eq">عند متوسط منشوراتك</span>`) : ""}
        <div class="ca-row"><a class="btn ghost" href="#/post/${enc(P.id)}">فتح المنشور</a></div></div>
      <div class="ca-g">${kpi("المشاهدات", fmt(T.views))}${kpi("الوصول (أشخاص)", fmt(T.reach))}${kpi("أول 24 ساعة", fmt(T.first24h))}${kpi("معدل التفاعل", fmt(T.engagementRate), undefined, "%")}${kpi("متوسط الانتباه", T.attentionSessions ? fmt(T.avgAttentionSeconds, 0) : "—", undefined, T.attentionSessions ? "ث" : "")}${kpi("نسبة الإكمال", T.attentionSessions ? fmt(T.completionRate) : "—", undefined, T.attentionSessions ? "%" : "")}</div>
      <h3 class="ca-h3">منذ النشر</h3><div class="ca-leg"><span><i></i>المشاهدات</span><span><i class="b"></i>التفاعل</span></div>${lineChart(d.daily.views, { unit: "مشاهدة", second: d.daily.engagement, label: "مشاهدات المنشور وتفاعله يومياً منذ نشره" })}
      <h3 class="ca-h3">التفاعل بالتفصيل</h3><div class="ca-g">${kpi("تفاعلات", fmt(T.reactions))}${kpi("تعليقات", fmt(T.comments))}${kpi("حفظ", fmt(T.saves))}${kpi("مشاركات", fmt(T.shares))}</div>
      ${d.reactions.length ? bars(d.reactions.map((r) => ({ label: r.label, share: (r.count / Math.max(1, T.reactions)) * 100, value: r.count })), "") : ""}
      <h3 class="ca-h3">إلى أين وصل القرّاء؟</h3>${d.depth.length ? bars(d.depth.map((b) => ({ label: b.label, share: b.share, value: b.share, unit: "%" })), "") : `<p class="muted">يظهر عمق القراءة أو المشاهدة بعد ٣ جلسات على الأقل.</p>`}
      <h3 class="ca-h3">من أين جاءت المشاهدات؟</h3>${d.sources.length ? bars(d.sources.map((b) => ({ label: b.label, share: b.share, value: b.count })), "") : `<p class="muted">لا مشاهدات بعد.</p>`}
      ${d.tips.length ? `<h3 class="ca-h3"><svg class=ix aria-hidden=true><use href=#i-bulb /></svg> اقتراحات لهذا المنشور</h3><div class="ca-ins">${d.tips.map((t) => `<div class="ca-in"><span class="ico" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-bulb /></svg></span><p>${h(t)}</p></div>`).join("")}</div>` : ""}`;
  }

  /* ---------- audience ---------- */
  async function audienceView() {
    shell("audience");
    let d; try { d = await api("GET", "/api/creator/analytics/audience?" + periodQuery()); } catch (e) { if (!$("#ca-b")) return; $("#ca-b").innerHTML = errBox(e); return; }
    const R = d.retention, M = d.demographics;
    const demo = (title, x) => `<div><h4 class="u-m0 u-mt10 u-mb4">${title}</h4>${x.shown ? bars(x.buckets, "") + (x.suppressed ? `<p class="u-t-xs muted">${x.suppressed} فئة صغيرة محجوبة لحماية الخصوصية.</p>` : "") : `<p class="muted">يظهر هذا التوزيع عندما يصل جمهورك إلى ${M.k} أشخاص على الأقل.</p>`}</div>`;
    if (!$("#ca-b")) return; $("#ca-b").innerHTML = `<div class="ca-g">${kpi("المتابعون الآن", fmt(d.followers))}${kpi("متابعون جدد", fmt(d.gained))}${kpi("ألغوا المتابعة", fmt(d.lost))}${kpi("متابعون نشطون", fmt(d.activeFollowers.share), undefined, "%")}</div>
      <h3 class="ca-h3">نمو الجمهور</h3><div class="ca-leg"><span><i></i>إجمالي المتابعين</span></div>${lineChart(d.growth.map((g) => ({ day: g.day, value: g.total })), { label: "إجمالي المتابعين" })}
      ${barChart(d.growth.map((g) => ({ day: g.day, value: g.net })), { label: "صافي المتابعين يومياً (موجب = زيادة)" })}
      <h3 class="ca-h3">الاحتفاظ</h3><div class="ca-g">${kpi("مشاهدون عادوا", fmt(R.returningRate), undefined, "%")}${kpi("مشاهدون جدد", fmt(R.newViewers))}${kpi("مشاهدو الفترة", fmt(R.viewers))}</div>
      ${R.cohorts.length ? `<div class="ca-scroll" tabindex="0" role="region" aria-label="جدول قابل للتمرير"><table class="ca-t"><caption class="u-ts muted">من تابعك في كل أسبوع — كم بقي يتابعك اليوم</caption><thead><tr><th scope="col">أسبوع المتابعة</th><th scope="col" class="n">تابعوا</th><th scope="col" class="n">ما زالوا</th><th scope="col" class="n">النسبة</th></tr></thead><tbody>${R.cohorts.map((c) => `<tr><td><bdi dir="ltr">${h(c.week)}</bdi></td><td class="n">${fmt(c.gained)}</td><td class="n">${fmt(c.retained)}</td><td class="n">${fmt(c.rate)}%</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">لا توجد مجموعات متابعة بعد في هذه الفترة.</p>`}
      <h3 class="ca-h3">من هم جمهورك؟ (تقريبي ومجهول الهوية)</h3>${demo("الدولة", M.countries)}${demo("لغة الواجهة", M.languages)}${demo("نوع الجهاز", M.devices)}
      <div class="ca-note">${h(d.note)}</div><div class="ca-row">${csvBtn("audience")}</div>`;
  }

  /* ---------- content ---------- */
  async function contentView() {
    shell("content");
    const q = qs(), type = q.get("type") || "", sort = q.get("sort") || "views";
    let d; try { d = await api("GET", `/api/creator/analytics/content?${periodQuery()}&sort=${enc(sort)}${type ? "&type=" + enc(type) : ""}`); } catch (e) { if (!$("#ca-b")) return; $("#ca-b").innerHTML = errBox(e); return; }
    const SORTS = [["views", "الأكثر مشاهدة"], ["engagement", "الأعلى تفاعلاً"], ["attention", "الأطول انتباهاً"], ["completion", "الأعلى إكمالاً"], ["recent", "الأحدث"]];
    const bt = d.bestTime;
    if (!$("#ca-b")) return; $("#ca-b").innerHTML = `<form id="ca-ff" class="ca-per"><label>النوع<select name="type"><option value="">كل الأنواع</option>${d.types.map((t) => `<option value="${t.key}" ${t.key === type ? "selected" : ""}>${h(t.label)}</option>`).join("")}</select></label>
        <label>الترتيب<select name="sort">${SORTS.map(([k, l]) => `<option value="${k}" ${k === sort ? "selected" : ""}>${l}</option>`).join("")}</select></label><button class="btn ghost">عرض</button></form>
      ${d.byType.length ? `<h3 class="ca-h3">حسب نوع المحتوى</h3><div class="ca-types">${d.byType.map((t) => `<div class="ca-type"><b>${h(t.label)}</b><span class="muted">${fmt(t.posts)} منشور</span><dl><div><dt>متوسط المشاهدات</dt><dd>${fmt(t.avgViews)}</dd></div><div><dt>التفاعل</dt><dd><bdi dir="ltr">${Number(t.engagementRate).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</bdi></dd></div><div><dt>الانتباه</dt><dd>${t.avgAttentionSeconds ? fmt(t.avgAttentionSeconds, 0) + " ث" : "—"}</dd></div></dl></div>`).join("")}</div>` : ""}
      <h3 class="ca-h3">أفضل وقت للنشر</h3>${bt.slots.length ? `<div class="ca-slots">${bt.slots.map((s, i) => `<div class="ca-slot ${i ? "" : "top"}"><span class="d">${DAYS[s.day]}</span><span class="t"><bdi dir="ltr">${String(s.hour).padStart(2, "0")}:00${bt.source === "own" ? `–${String(s.hour + 3).padStart(2, "0")}:00` : ""}</bdi></span>${s.avgViews !== undefined ? `<span class="muted">${fmt(s.avgViews)} مشاهدة في المتوسط</span>` : ""}</div>`).join("")}</div><p class="muted ca-small">${bt.source === "own" ? "من نتائج منشوراتك أنت في هذه الفترة." : "من أوقات نشاط متابعيك (لا تكفي منشوراتك بعد للمقارنة)."}</p>` : `<p class="muted">لا توجد بيانات كافية بعد.</p>`}
      <h3 class="ca-h3">المنشورات <span class="muted">(${fmt(d.count)})</span></h3>${d.posts.length ? `<p class="muted ca-small">الوسيط لمنشوراتك: ${fmt(d.medians.views)} مشاهدة · <bdi dir="ltr">${Number(d.medians.engagementRate).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</bdi> تفاعل. اضغط أي منشور لتحليله بالتفصيل.</p>
        <ul class="ca-plist">${d.posts.map((p) => `<li><a class="ca-pc" href="#/analytics/post/${enc(p.id)}"><span class="top"><span class="ca-chip sbadge role">${h(p.typeLabel)}</span><span class="${p.vsMedian.views > 0 ? "ca-up" : p.vsMedian.views < 0 ? "ca-dn" : "muted"}">${p.vsMedian.views > 0 ? `▲ <bdi dir="ltr">${p.vsMedian.views}%</bdi> فوق الوسيط` : p.vsMedian.views < 0 ? `▼ <bdi dir="ltr">${-p.vsMedian.views}%</bdi> تحت الوسيط` : "عند الوسيط"}</span></span>
          <b class="ttl">${h(p.title || "(بلا عنوان)")}</b>
          <span class="mx"><span><b>${fmt(p.views)}</b>مشاهدة</span><span><b>${fmt(p.reach)}</b>وصول</span><span><b><bdi dir="ltr">${Number(p.engagementRate).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</bdi></b>تفاعل</span><span><b>${p.attentionSessions ? fmt(p.avgAttentionSeconds, 0) + "ث" : "—"}</b>انتباه</span><span><b>${p.attentionSessions ? `<bdi dir="ltr">${Number(p.completionRate).toLocaleString("en-US", { maximumFractionDigits: 0 })}%</bdi>` : "—"}</b>إكمال</span></span></a></li>`).join("")}</ul>` : `<div class="ca-empty"><span aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-doc /></svg></span><p>لا منشورات في هذه الفترة. جرّب فترة أطول أو انشر شيئاً جديداً.</p></div>`}
      <div class="ca-row">${csvBtn("content")}</div>`;
    $("#ca-ff")?.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target), p = new URLSearchParams(location.hash.split("?")[1] || ""); p.set("sort", f.get("sort")); if (f.get("type")) p.set("type", f.get("type")); else p.delete("type"); location.hash = "#/analytics/content?" + p.toString(); });
  }

  /* ---------- earnings ---------- */
  async function earningsView() {
    shell("earnings");
    let d; try { d = await api("GET", "/api/creator/analytics/earnings?" + periodQuery()); } catch (e) { if (!$("#ca-b")) return; $("#ca-b").innerHTML = errBox(e); return; }
    const T = d.totals;
    if (!$("#ca-b")) return; $("#ca-b").innerHTML = `${d.note ? `<div class="ca-note" role="status">${h(d.note)}</div>` : ""}
      <div class="ca-g">${kpi("صافي الأرباح", fmt(T.net, 4), d.deltas.net, "π")}${kpi("الإجمالي قبل الرسوم", fmt(T.gross, 4), d.deltas.gross, "π")}${kpi("رسوم المنصة", fmt(T.fees, 4), undefined, "π")}${kpi("الداعمون والمشترون", fmt(T.supporters), d.deltas.supporters)}
        ${kpi("متوسط لكل داعم", fmt(T.perSupporter, 4), undefined, "π")}${kpi("مستردّ / معكوس", fmt(T.reversed, 4), undefined, "π")}${kpi("إنفاق إعلاني", fmt(T.adSpend, 4), undefined, "π")}${kpi("الصافي بعد الإعلانات", fmt(T.afterAds, 4), undefined, "π")}</div>
      <h3 class="ca-h3">صافي الأرباح يومياً</h3>${barChart(d.daily, { label: "صافي الأرباح اليومية بعملة Pi" })}
      <h3 class="ca-h3">حسب المصدر</h3><ul class="ca-streams">${d.streams.map((s) => `<li><span class="grow"><b>${h(s.label)}</b><span class="muted">${fmt(s.count)} عملية · إجمالي ${fmt(s.gross, 4)} π · رسوم ${fmt(s.fees, 4)} π${s.reversed ? ` · ${fmt(s.reversed, 4)} π مستردّ` : ""}</span>${s.net || s.previousNet ? `<span>${deltaTag(s.delta)}</span>` : ""}</span><span class="nt"><b>${fmt(s.net, 4)} π</b><span class="muted"><bdi dir="ltr">${Number(T.net ? s.share : 0).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</bdi> من الصافي</span></span></li>`).join("")}</ul>
      <div class="ca-row">${csvBtn("earnings")}<a class="btn ghost" href="#/earnings">سجل الأرباح التفصيلي</a><a class="btn ghost" href="#/statement">كشف الحساب</a></div>`;
  }

  /* ---------- compare ---------- */
  async function compareView() {
    shell("compare");
    const q = qs(), d0 = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    const v = { aFrom: q.get("aFrom") || d0(56), aTo: q.get("aTo") || d0(29), bFrom: q.get("bFrom") || d0(28), bTo: q.get("bTo") || d0(0) };
    const LBL = { views: "المشاهدات", reach: "الوصول", engagement: "التفاعلات", engagementRate: "معدل التفاعل %", followersGained: "متابعون جدد", followersLost: "ألغوا المتابعة", followersNet: "صافي المتابعين", avgAttentionSeconds: "متوسط الانتباه (ث)", completionRate: "الإكمال %", watchMinutes: "دقائق القراءة والمشاهدة", earningsNet: "صافي الأرباح π", supporters: "الداعمون" };
    if (!$("#ca-b")) return; $("#ca-b").innerHTML = `<form id="ca-xf" class="ca-per"><fieldset class="u-b0 u-p0 u-dflex u-g6 u-fww"><legend class="u-t-sm muted">الفترة (أ)</legend><label>من<input type="date" name="aFrom" value="${h(v.aFrom)}" required></label><label>إلى<input type="date" name="aTo" value="${h(v.aTo)}" required></label></fieldset>
      <fieldset class="u-b0 u-p0 u-dflex u-g6 u-fww"><legend class="u-t-sm muted">الفترة (ب)</legend><label>من<input type="date" name="bFrom" value="${h(v.bFrom)}" required></label><label>إلى<input type="date" name="bTo" value="${h(v.bTo)}" required></label></fieldset><button class="btn">قارن</button></form><div id="ca-xr"><div class="skel"></div></div>`;
    $("#ca-xf")?.addEventListener("submit", (e) => { e.preventDefault(); const f = new FormData(e.target); location.hash = "#/analytics/compare?" + ["aFrom", "aTo", "bFrom", "bTo"].map((k) => `${k}=${enc(f.get(k))}`).join("&"); });
    let r; try { r = await api("GET", `/api/creator/analytics/compare?${["aFrom", "aTo", "bFrom", "bTo"].map((k) => `${k}=${enc(v[k])}`).join("&")}&tz=${tz()}`); } catch (e) { if (!$("#ca-xr")) return; $("#ca-xr").innerHTML = errBox(e); return; }
    if (!$("#ca-xr")) return; $("#ca-xr").innerHTML = `<div class="ca-scroll" tabindex="0" role="region" aria-label="جدول قابل للتمرير"><table class="ca-t"><thead><tr><th scope="col">المؤشر</th><th scope="col" class="n">أ (${fmt(r.a.days, 0)} يوم)</th><th scope="col" class="n">ب (${fmt(r.b.days, 0)} يوم)</th><th scope="col" class="n">التغيّر</th></tr></thead><tbody>${r.keys.map((k) => `<tr><td>${LBL[k] || k}</td><td class="n">${fmt(r.a.kpis[k], 4)}</td><td class="n">${fmt(r.b.kpis[k], 4)}</td><td class="n">${r.a.kpis[k] || r.b.kpis[k] ? deltaTag(r.deltas[k], k === "followersLost").replace(" عن الفترة السابقة", "") : "—"}</td></tr>`).join("")}</tbody></table></div>`;
  }

  const ROUTES = { post: () => postView(decodeURIComponent((location.hash.split("?")[0].split("/")[3] || ""))), "": overviewView, audience: audienceView, content: contentView, earnings: earningsView, compare: compareView };
  MPRoutes.extend((a, b) => ({ analytics: () => Promise.resolve((ROUTES[(a || "").split("?")[0]] || ROUTES[""])()).then(() => wireCharts()) }));
  window.MPCAnalytics = { postView, ring, overviewView, audienceView, contentView, earningsView, compareView, lineChart, barChart, version: "__APP_VERSION__" };
  if (/^#\/analytics\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
