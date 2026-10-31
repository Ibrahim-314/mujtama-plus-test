/* =====================================================================
 * مجتمع بلس — Phase 68 UI: Hijri calendar and seasons (lazy "hijri" chunk; 0 bytes in core except the fmtDate hook).
 *   #/hijri[?cal=g&y=&m=]   today hero (Hijri + Gregorian, season greeting or countdown), month grid (Hijri month with
 *                           Gregorian days, or the reverse), day details, occasions of the month, season cards, converter,
 *                           settings (Hijri dates across the app, country for national days, white days), iCal link
 *   #/season/:key           season hub: countdown / «day N of M» with progress, greeting, reminders, related days,
 *                           tips, events in the season, posts under the season hashtags
 *   #/admin/hijri           moon-sighting overrides per month (validated on the server)
 *   window.MPHijri.label(iso) — Hijri label with the admin overrides, used by fmtDate when «show Hijri dates» is on.
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function HijriUI() {
  if (window.MPHijri) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty hj-empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const AR = (n) => (window.UI && UI.num ? UI.num(Number(n), { useGrouping: false }) : String(n)); // v2.34: Western digits, same as the rest of the app
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const isAdmin = () => { try { return S.me()?.role === "admin"; } catch { return false; } };
  const WD = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
  const MONTHS = ["محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة"];
  const settings = () => (typeof DB !== "undefined" && DB.settings) || {};
  const saveSettings = () => { try { save(); } catch { /* local only */ } };
  const page = (title, body, back) => { view.innerHTML = `<div class="wrap hj-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="hj-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2></div></div></header>${body}</div>`; $("#hj-h")?.focus({ preventScroll: true }); };
  const skel = (n = 2) => Array.from({ length: n }, () => `<div class="skel hj-skel"></div>`).join("");
  const days = (n) => (n === 1 ? "يوم واحد" : n === 2 ? "يومان" : n <= 10 ? `${AR(n)} أيام` : `${AR(n)} يوماً`);
  const gShort = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); return d.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" }); };

  /* ---------- client conversion with the same overrides as the server (for fmtDate) ---------- */
  let overrides = {};
  const fmt = (() => { try { return new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }); } catch { return null; } })();
  const DAY = 864e5;
  const uq = (n) => { const p = {}; for (const x of fmt.formatToParts(new Date(n * DAY + DAY / 2))) p[x.type] = x.value; return { y: +String(p.year).replace(/\D/g, ""), m: +p.month, d: +p.day }; };
  function hijriOf(ymd) {
    if (!fmt) return null;
    const n = Date.parse(ymd + "T00:00:00Z") / DAY, u = uq(n), s0 = n - (u.d - 1);
    const ps = s0 - 1 - (uq(s0 - 1).d - 1), pu = uq(ps);
    let ns = s0 + 29; if (uq(ns).d !== 1) ns++; const nu = uq(ns);
    let best = null;
    for (const [y, m, s] of [[pu.y, pu.m, ps], [u.y, u.m, s0], [nu.y, nu.m, ns]]) { const o = overrides[`${y}-${m}`], st = o ? Date.parse(o + "T00:00:00Z") / DAY : s; if (st <= n && (!best || st > best.s)) best = { y, m, s: st }; }
    return { y: best.y, m: best.m, d: n - best.s + 1 };
  }
  const label = (iso) => { const d = new Date(iso); const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); const x = hijriOf(ymd); return x ? `${AR(x.d)} ${MONTHS[x.m - 1]} ${AR(x.y)} هـ` : ""; };
  api("GET", "/api/hijri/config").then((c) => { overrides = c.overrides || {}; }).catch(() => { });
  // keep the per-device toggle in sync with the account (prefs namespace "hijri")
  if (signed()) api("GET", "/api/prefs?ns=hijri").then((r) => { const v = r?.prefs?.hijri; if (v && typeof v.show === "boolean" && v.show !== !!settings().hijri) { settings().hijri = v.show; if (v.country) settings().hijriCountry = v.country; saveSettings(); } }).catch(() => { });

  if (!document.getElementById("hj-css")) document.head.insertAdjacentHTML("beforeend", `<style id="hj-css">
.hj-page{max-width:760px;margin:auto}.hj-page h2:focus{outline:none}.hj-page h3{font-size:16px;font-weight:800;margin:22px 0 8px}
.hj-skel{height:120px;border-radius:var(--r);margin:8px 0}.hj-sub{color:var(--muted);font-size:13.5px;line-height:1.6;margin:0}
.hj-hero{position:relative;overflow:hidden;border-radius:var(--r-lg);padding:18px 18px 16px;color:var(--white);background:var(--hero-grad);box-shadow:var(--sh-1);margin:6px 0 12px}
.hj-hero:after{content:"";position:absolute;inset-inline-start:-30px;top:-40px;width:150px;height:150px;border-radius:50%;box-shadow:-26px 14px 0 0 #ffffff26;transform:rotate(-20deg);pointer-events:none}
.hj-hero .wd{font-size:13.5px;opacity:.9}.hj-hero .big{font-size:var(--fs-3xl);font-weight:800;line-height:1.3;margin:2px 0}.hj-hero .g{font-size:14.5px;opacity:.92}
.hj-hero .band{margin-top:12px;padding:10px 12px;border-radius:var(--r-sm);background:#ffffff1f;display:flex;gap:10px;align-items:center;text-decoration:none;color:var(--white);min-height:48px;position:relative;z-index:1}.hj-hero .band b{display:block}.hj-hero .band span{font-size:13px;opacity:.92}.hj-hero .band .e{font-size:var(--fs-3xl)}.hj-hero .band .go{margin-inline-start:auto;font-size:18px}

.hj-cal{background:var(--card);border:1px solid var(--line);border-radius:var(--r-lg);box-shadow:var(--sh-1);padding:10px 8px 12px;margin:8px 0}
.hj-nav{display:flex;align-items:center;gap:6px;padding:0 2px 8px}.hj-nav a{width:44px;height:44px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--bg-2);color:var(--text);text-decoration:none;font-size:18px}.hj-nav .t{flex:1;text-align:center;min-width:0}.hj-nav .t b{display:block;font-size:17px;line-height:1.35}.hj-nav .t span{font-size:12.5px;color:var(--muted)}
.hj-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px;text-align:center}.hj-grid .wh{font-size:11px;color:var(--muted);font-weight:700;padding:4px 0}
.hj-d{position:relative;min-height:50px;border:0;border-radius:12px;background:transparent;color:var(--text);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:2px 0;font:inherit}.hj-d .n{font-size:16px;font-weight:700;line-height:1.2}.hj-d .o{font-size:10.5px;color:var(--muted);line-height:1.2}
.hj-d.fr .n{color:var(--accent-ink)}.hj-d.occ{background:color-mix(in srgb,var(--accent) 9%,transparent)}.hj-d.occ.season{background:color-mix(in srgb,var(--accent) 16%,transparent)}.hj-d .dot{position:absolute;bottom:4px;width:5px;height:5px;border-radius:50%;background:var(--accent)}
.hj-d.occ .o{color:var(--text-2)}.hj-d.today{background:color-mix(in srgb,var(--accent) 78%,#000);color:var(--white)}.hj-d.today .o,.hj-d.today .n{color:var(--white)}.hj-d.today .dot{background:var(--white)}.hj-d[aria-pressed="true"]:not(.today){outline:2px solid var(--accent);outline-offset:-2px}.hj-d:focus-visible{outline:2px solid var(--accent-ink);outline-offset:1px}
.hj-today-btn{display:flex;justify-content:center;margin-top:6px}.hj-today-btn a{min-height:40px;display:inline-flex;align-items:center;padding:0 16px;border-radius:999px;background:var(--bg-2);color:var(--accent-ink);font-weight:700;text-decoration:none;font-size:13.5px}
.hj-day{margin:8px 0;padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1)}.hj-day b{font-size:16px}.hj-day .row2{color:var(--muted);font-size:13.5px}
.hj-list{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.hj-list li{border-bottom:1px solid var(--line)}.hj-list li:last-child{border-bottom:0}
.hj-list a,.hj-list .it{display:flex;gap:12px;align-items:center;padding:10px 14px;min-height:56px;color:inherit;text-decoration:none}.hj-list .e{width:40px;height:40px;flex:none;border-radius:12px;display:grid;place-items:center;background:var(--bg-2);font-size:var(--fs-xl)}.hj-list .t{flex:1;min-width:0}.hj-list .t b{display:block;line-height:1.45}.hj-list .t span{font-size:12.5px;color:var(--muted)}.hj-list .k{font-size:var(--fs-xs);font-weight:700;white-space:nowrap;color:var(--accent-ink)}
.hj-seasons{display:grid;grid-template-columns:1fr 1fr;gap:8px}.hj-sc{display:flex;flex-direction:column;gap:2px;padding:12px;border-radius:var(--r);text-decoration:none;color:var(--white);min-height:112px;background:linear-gradient(160deg,color-mix(in srgb,var(--hj-t,transparent) 55%,transparent),transparent 75%),var(--hero-grad);box-shadow:var(--sh-1)}.hj-sc[data-s=eid_fitr]{--hj-t:var(--ok)}.hj-sc[data-s=hajj]{--hj-t:var(--warn)}.hj-sc[data-s=eid_adha]{--hj-t:var(--info)}.hj-sc .e{font-size:24px}.hj-sc b{font-size:15.5px}.hj-sc span{font-size:12.5px;opacity:.95}.hj-sc .cd{margin-top:auto;font-weight:800;font-size:14px}
.hj-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);padding:12px 14px;margin:8px 0}.hj-f{display:flex;flex-direction:column;gap:8px}.hj-f label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--text-2)}.hj-f input,.hj-f select{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}.hj-3{display:grid;grid-template-columns:1fr 1.6fr 1.2fr;gap:6px}.hj-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hj-row .btn{min-height:44px}
.hj-out{margin-top:6px;padding:10px 12px;border-radius:var(--r-sm);background:var(--accent2);color:var(--accent-ink);font-weight:700;min-height:22px}.hj-out:empty{display:none}
.hj-sw{display:flex;align-items:center;gap:12px;min-height:56px;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer}.hj-sw:last-child{border-bottom:0}.hj-sw .t{flex:1}.hj-sw .t b{display:block;font-size:14.5px}.hj-sw .t span{font-size:12.5px;color:var(--muted)}.hj-sw input{width:22px;height:22px;accent-color:var(--accent);flex:none}.hj-sw select{min-height:44px;width:auto}
.hj-shero{border-radius:var(--r-lg);overflow:hidden;color:var(--white);background:var(--hero-grad);padding:20px 18px;box-shadow:var(--sh-1);margin:6px 0 10px}.hj-shero .e{font-size:40px;line-height:1}.hj-shero h1{margin:6px 0 2px;font-size:26px;font-weight:800;color:#fff}.hj-shero .st{font-size:14.5px;opacity:.95}.hj-shero .cnt{font-size:44px;font-weight:800;line-height:1.1;margin:10px 0 2px}.hj-shero .prog{height:8px;border-radius:6px;background:#ffffff33;overflow:hidden;margin:10px 0 4px}.hj-shero .prog i{display:block;height:100%;background:#fff;border-radius:6px}.hj-shero .gr{margin-top:10px;font-size:var(--fs-md);font-weight:700}
.hj-chips{display:flex;gap:6px;flex-wrap:wrap}.hj-chips button{min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line-2);background:var(--card);color:var(--text-2);font:inherit;font-weight:600;font-size:14px;cursor:pointer}.hj-chips button[aria-pressed="true"]{background:var(--accent2);border-color:var(--accent);color:var(--accent-ink)}
.hj-tips{margin:0;padding:0;list-style:none;counter-reset:t}.hj-tips li{display:flex;gap:10px;align-items:flex-start;padding:8px 0;line-height:1.7;font-size:14.5px}.hj-tips li:before{counter-increment:t;content:counter(t);width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--accent2);color:var(--accent-ink);font-weight:800;font-size:13px}
.hj-list a.hj-post,.hj-post{display:block;min-height:0;padding:12px 14px;border-bottom:1px solid var(--line);color:inherit;text-decoration:none}.hj-post:last-child{border-bottom:0}.hj-post .a{font-size:var(--fs-sm);color:var(--muted)}.hj-post .a b{color:var(--text)}.hj-post p{margin:4px 0 0;line-height:1.7;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}

.hj-adm{list-style:none;margin:0;padding:0}.hj-adm li{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;margin:8px 0;box-shadow:var(--sh-1)}.hj-adm li.cur{border-color:var(--accent)}.hj-adm .hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.hj-adm .hd b{flex:1;min-width:0}.hj-adm form{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.hj-adm form input{min-height:44px;width:100%;box-sizing:border-box}.hj-adm form .btn{min-height:44px;grid-column:1/-1}
.hj-chip{display:inline-flex;align-items:center;font-size:var(--fs-xs);font-weight:700;padding:2px 10px;border-radius:999px;background:var(--bg-2);color:var(--text-2);white-space:nowrap}.hj-chip.warn{background:color-mix(in srgb,var(--warn) 18%,transparent);color:color-mix(in srgb,var(--warn) 50%,var(--text))}
</style>`);

  /* =================== #/hijri =================== */
  const ctry = () => settings().hijriCountry || "SA";
  async function calView() {
    const p = qs(), mode = p.get("cal") === "g" ? "g" : "h";
    page("التقويم الهجري", `<div id="hj-hero">${skel(1)}</div><nav class="hj-seg seg" aria-label="نوع التقويم"><a href="#/hijri" ${mode === "h" ? 'aria-current="page"' : ""}>هجري</a><a href="#/hijri?cal=g" ${mode === "g" ? 'aria-current="page"' : ""}>ميلادي</a></nav><div id="hj-cal">${skel(2)}</div><div id="hj-dd" aria-live="polite"></div><div id="hj-occ"></div><div id="hj-rest"></div>`);
    const q = new URLSearchParams({ country: ctry(), sunnah: settings().hijriWhite ? "1" : "0", ...(mode === "g" ? { cal: "g" } : {}), ...(p.get("y") ? { y: p.get("y"), m: p.get("m") } : {}) });
    let t, m; try { [t, m] = await Promise.all([api("GET", "/api/hijri/today?country=" + enc(ctry())), api("GET", "/api/hijri/month?" + q)]); } catch (e) { const b = $("#hj-cal"); if (b) b.innerHTML = errBox(e); return; }
    if (!$("#hj-hero")) return;
    const cur = t.current, nx = t.next;
    $("#hj-hero").innerHTML = `<section class="hj-hero" style="--hj-h:${cur?.hue || 262}" aria-label="تاريخ اليوم"><div class="wd">اليوم ${h(t.today.weekday)}</div><div class="big">${h(AR(t.today.hijri.d))} ${h(t.today.hijri.monthName)} ${h(AR(t.today.hijri.y))}&nbsp;هـ</div><div class="g">${h(gShort(t.today.g))} ${h(AR(t.today.g.slice(0, 4)))}م</div>
      ${cur ? `<a class="band" href="#/season/${enc(cur.key)}"><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-moon /></svg></span><div><b>${h(cur.greeting)}</b><span>اليوم ${h(AR(cur.dayOf))} من ${h(cur.name)} · بقي ${h(days(cur.remaining))}</span></div><span class="go" aria-hidden="true">←</span></a>`
        : nx ? `<a class="band" href="#/season/${enc(nx.key)}"><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-moon /></svg></span><div><b>${h(nx.name)} بعد ${h(days(nx.daysLeft))}</b><span>يبدأ ${h(gShort(nx.start))} تقريباً</span></div><span class="go" aria-hidden="true">←</span></a>` : ""}</section>`;
    const cell = (d) => { const main = mode === "h" ? d.hd : d.gd, other = mode === "h" ? d.gd : d.hd, occ = m.occasions.filter((o) => d.occ.includes(o.key)), season = occ.some((o) => o.kind === "season");
      const lbl = `${mode === "h" ? `${d.hd} ${m.title.replace(/ \d+ هـ$/, "")}` : `${d.gd} ${m.title.replace(/ \d+$/, "")}`}${d.today ? "، اليوم" : ""}${occ.length ? "، " + occ.map((o) => o.name).join("، ") : ""}`;
      return `<button type="button" class="hj-d${d.wd === 5 ? " fr" : ""}${occ.length ? " occ" : ""}${season ? " season" : ""}${d.today ? " today" : ""}" data-d="${h(d.g)}" aria-pressed="false" aria-label="${h(lbl)}"><span class="n">${h(AR(main))}</span><span class="o" aria-hidden="true">${h(AR(other))}</span>${occ.length ? `<span class="dot" aria-hidden="true"></span>` : ""}</button>`; };
    const navQ = (x) => `#/hijri?${mode === "g" ? "cal=g&" : ""}y=${x.y}&m=${x.m}`;
    $("#hj-cal").innerHTML = `<section class="hj-cal" aria-labelledby="hj-mt"><div class="hj-nav"><a href="${navQ(m.prev)}" aria-label="الشهر السابق: ${h(m.prev.label)}">›</a><div class="t"><b id="hj-mt">${h(m.title.replace(/\d+/g, (x) => AR(x)))}</b><span>${h(m.sub.replace(/\d+/g, (x) => AR(x)))}</span></div><a href="${navQ(m.next)}" aria-label="الشهر التالي: ${h(m.next.label)}">‹</a></div>
      <div class="hj-grid" role="group" aria-label="أيام الشهر">${WD.map((w) => `<div class="wh" aria-hidden="true">${w}</div>`).join("")}${Array.from({ length: m.lead }, () => "<div></div>").join("")}${m.days.map(cell).join("")}</div>
      ${m.overridden ? `<p class="u-mt8 hj-sub"><svg class=ix aria-hidden=true><use href=#i-mega /></svg> بداية الشهر حسب إعلان الرؤية (${h(gShort(m.overridden.startsOn))})${m.overridden.note ? " — " + h(m.overridden.note) : ""}</p>` : ""}
      ${m.isCurrent ? "" : `<div class="hj-today-btn"><a href="#/hijri${mode === "g" ? "?cal=g" : ""}">العودة إلى اليوم</a></div>`}</section>`;
    const showDay = async (g) => {
      view.querySelectorAll(".hj-d").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.d === g)));
      const box = $("#hj-dd"); if (!box) return;
      try { const c = await api("GET", "/api/hijri/convert?date=" + g); const d = m.days.find((x) => x.g === g); const occ = m.occasions.filter((o) => d?.occ.includes(o.key));
        box.innerHTML = `<div class="hj-day"><b>${h(c.weekday)} ${h(c.hijri.label.replace(/\d+/g, (x) => AR(x)))}</b><div class="row2">${h(gShort(g))} ${h(AR(g.slice(0, 4)))}م</div>${occ.length ? `<div class="u-mt6 hj-row">${occ.map((o) => `<span class="hj-chip"><svg class=ix aria-hidden=true><use href=#i-moon /></svg> ${h(o.name)}</span>`).join("")}</div>` : ""}</div>`; } catch (e) { box.innerHTML = errBox(e); }
    };
    $("#hj-cal").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) showDay(b.dataset.d); });
    const occ = m.occasions.filter((o) => o.kind !== "sunnah" || settings().hijriWhite);
    const range = (o) => (o.start === o.end ? gShort(o.start) : `${gShort(o.start)} – ${gShort(o.end)}`);
    const hl = (o) => { const d = m.days.find((x) => x.g === o.start); return d ? `${AR(d.hd)} ${MONTHS[d.hm - 1]}` : ""; };
    $("#hj-occ").innerHTML = `<h3>مناسبات ${mode === "h" ? "هذا الشهر" : "الشهر"}</h3>${occ.length ? `<ul class="hj-list">${occ.map((o) => { const inner = `<span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-moon /></svg></span><span class="t"><b>${h(o.name)}</b><span>${h(range(o))}${hl(o) ? " · " + h(hl(o)) : ""}${o.days > 1 ? " · " + h(days(o.days)) : ""}</span></span>${o.kind === "season" ? `<span class="k">الموسم ←</span>` : ""}`; return `<li>${o.kind === "season" ? `<a href="#/season/${enc(o.key)}">${inner}</a>` : `<div class="it">${inner}</div>`}</li>`; }).join("")}</ul>` : `<div class="empty hj-empty">لا مناسبات في هذا الشهر — تصفّح الأشهر بالسهمين</div>`}`;
    const ss = t.seasons;
    $("#hj-rest").innerHTML = `<h3>المواسم القادمة</h3><div class="hj-seasons">${ss.map((s) => `<a class="hj-sc" data-s="${h(s.key)}" href="#/season/${enc(s.key)}"><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-moon /></svg></span><b>${h(s.name)}</b><span>${h(gShort(s.start))}</span><span class="cd">${s.active ? `اليوم ${h(AR(s.dayOf))} من ${h(AR(s.days))}` : `بعد ${h(days(s.daysLeft))}`}</span></a>`).join("")}</div>
      <h3>محوّل التاريخ</h3><div class="hj-card"><form class="hj-f" id="hj-c1"><label>من ميلادي إلى هجري<input type="date" name="d" value="${h(t.today.g)}" required></label><button class="btn" type="submit">حوّل</button><div class="hj-out" id="hj-o1" aria-live="polite"></div></form></div>
      <div class="hj-card"><form class="hj-f" id="hj-c2"><fieldset class="u-b0 u-p0 u-m0"><legend style="font-size:14px;font-weight:600;color:var(--text-2);margin-bottom:6px">من هجري إلى ميلادي</legend><div class="hj-3"><label>اليوم<select name="d">${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${i + 1 === t.today.hijri.d ? "selected" : ""}>${AR(i + 1)}</option>`).join("")}</select></label><label>الشهر<select name="m">${MONTHS.map((x, i) => `<option value="${i + 1}" ${i + 1 === t.today.hijri.m ? "selected" : ""}>${x}</option>`).join("")}</select></label><label>السنة<input name="y" type="number" inputmode="numeric" min="1356" max="1500" value="${t.today.hijri.y}" required></label></div></fieldset><button class="btn" type="submit">حوّل</button><div class="hj-out" id="hj-o2" aria-live="polite"></div></form></div>
      <h3>الإعدادات</h3><div class="hj-card"><label class="hj-sw"><span class="t"><b>إظهار التاريخ الهجري في التطبيق</b><span>بجانب التواريخ الميلادية في الفعاليات والجدولة</span></span><input type="checkbox" id="hj-show" ${settings().hijri ? "checked" : ""}></label>
      <label class="hj-sw"><span class="t"><b>الأيام البيض</b><span>إظهار ١٣–١٥ من كل شهر في التقويم</span></span><input type="checkbox" id="hj-white" ${settings().hijriWhite ? "checked" : ""}></label>
      <label class="hj-sw"><span class="t"><b>الأيام الوطنية</b><span>لدولتك</span></span><select id="hj-ctry">${[["SA", "السعودية"], ["AE", "الإمارات"], ["KW", "الكويت"], ["QA", "قطر"], ["BH", "البحرين"], ["NONE", "بلا"]].map(([k, l]) => `<option value="${k}" ${ctry() === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <div class="hj-row"><a class="btn ghost" href="/hijri.ics?country=${enc(ctry())}" download="hijri.ics">أضف المواسم إلى تقويم جوالك</a>${isAdmin() ? `<a class="btn ghost" href="#/admin/hijri"><svg class=ix aria-hidden=true><use href=#i-settings /></svg> إعلانات الرؤية</a>` : ""}</div>`;
    $("#hj-c1").addEventListener("submit", async (e) => { e.preventDefault(); const o = $("#hj-o1"); try { const c = await api("GET", "/api/hijri/convert?date=" + enc(e.target.d.value)); o.textContent = `${c.weekday} ${c.hijri.label.replace(/\d+/g, (x) => AR(x))}`; } catch (x) { o.textContent = x.message; } });
    $("#hj-c2").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target, o = $("#hj-o2"); try { const c = await api("GET", `/api/hijri/convert?hy=${enc(f.y.value)}&hm=${enc(f.m.value)}&hd=${enc(f.d.value)}`); o.textContent = `${c.weekday} ${gShort(c.g)} ${AR(c.g.slice(0, 4))}م`; } catch (x) { o.textContent = x.message; } });
    const sync = () => { if (signed()) api("PUT", "/api/prefs", { ns: "hijri", values: { show: !!settings().hijri, country: ctry() } }).catch(() => { }); };
    $("#hj-show").addEventListener("change", (e) => { settings().hijri = e.target.checked; saveSettings(); sync(); say(e.target.checked ? "✓ ستظهر التواريخ الهجرية في التطبيق" : "أُخفيت التواريخ الهجرية"); });
    $("#hj-white").addEventListener("change", (e) => { settings().hijriWhite = e.target.checked; saveSettings(); calView(); });
    $("#hj-ctry").addEventListener("change", (e) => { settings().hijriCountry = e.target.value; saveSettings(); sync(); calView(); });
    const today = view.querySelector(".hj-d.today"); if (today) showDay(today.dataset.d);
  }

  /* =================== #/season/:key =================== */
  const REM = [["off", "بدون تذكير"], ["0", "يوم البداية"], ["1", "قبله بيوم"], ["3", "قبله ٣ أيام"], ["7", "قبله بأسبوع"]];
  async function seasonView(key) {
    page("", `<div id="hj-s">${skel(3)}</div>`, ["#/hijri", "التقويم الهجري"]);
    let d; try { d = await api("GET", "/api/hijri/seasons/" + enc(key)); } catch (e) { const b = $("#hj-s"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#hj-s"); if (!box) return;
    const s = d.season, st = d.state, hd = $("#hj-h"); if (hd) { hd.textContent = s.name; hd.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"; }
    const remKey = !d.reminder ? "off" : d.reminder.daysBefore > 0 ? String(d.reminder.daysBefore) : "0";
    box.innerHTML = `<section class="hj-shero" style="--hj-h:${s.hue}" aria-label="${h(s.name)}"><div class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-moon /></svg></div><h1>${h(s.name)} ${st ? h(AR(st.hijriYear)) + " هـ" : ""}</h1>
      ${st ? (st.active ? `<div class="cnt">اليوم ${h(AR(st.dayOf))}</div><div class="st">من ${h(AR(st.days))} · بقي ${h(days(st.remaining))}</div><div class="prog" role="progressbar" aria-label="مضى من الموسم" aria-valuemin="0" aria-valuemax="${st.days}" aria-valuenow="${st.dayOf}"><i style="width:${Math.round((st.dayOf / st.days) * 100)}%"></i></div>`
        : `<div class="cnt">${h(AR(st.daysLeft))}</div><div class="st">${st.daysLeft === 1 ? "يوم واحد" : st.daysLeft === 2 ? "يومان" : st.daysLeft <= 10 ? "أيام" : "يوماً"} حتى البداية · ${h(st.startLabel.hijri.label.replace(/\d+/g, (x) => AR(x)))}</div><div class="st">${h(gShort(st.start))} ${h(AR(st.start.slice(0, 4)))}م (تقريباً، حسب الرؤية)</div>`) : ""}
      <div class="gr">${h(s.greeting)}</div></section>
      ${signed() ? `<h3 id="hj-rl">ذكّرني</h3><div class="hj-chips" role="group" aria-labelledby="hj-rl">${REM.map(([k, l]) => `<button type="button" data-rem="${k}" aria-pressed="${remKey === k}">${l}</button>`).join("")}</div>` : ""}
      ${d.within.length ? `<h3>أيام مميزة في الموسم</h3><ul class="hj-list">${d.within.map((o) => `<li><div class="it"><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-moon /></svg></span><span class="t"><b>${h(o.name)}</b><span>${h(o.start === o.end ? gShort(o.start) : `${gShort(o.start)} – ${gShort(o.end)}`)}</span></span></div></li>`).join("")}</ul>` : ""}
      <h3>اقتراحات للموسم</h3><div class="hj-card"><ol class="hj-tips">${s.tips.map((x) => `<li>${h(x)}</li>`).join("")}</ol></div>
      <h3>فعاليات في الموسم</h3>${d.events.length ? `<ul class="hj-list">${d.events.map((e) => `<li><a href="#/events"><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-cal /></svg></span><span class="t"><b>${h(e.name)}</b><span>${h(e.hijri.replace(/\d+/g, (x) => AR(x)))}${e.community ? " · " + h(e.community.name) : ""}${e.place ? " · " + h(e.place) : ""}</span></span></a></li>`).join("")}</ul>` : `<div class="empty hj-empty">لا فعاليات معلنة بعد — أنشئ فعالية في مجتمعك لتظهر هنا</div>`}
      <h3>من المجتمع ${s.tags.map((t) => `<a class="u-ms4 hj-chip" href="#/tag/${enc(t)}">#${h(t)}</a>`).slice(0, 2).join("")}</h3>${d.posts.length ? `<div class="hj-list">${d.posts.map((p) => `<a class="hj-post" href="#/post/${enc(p.id)}"><div class="a"><b>${h(p.author.name || "")}</b> @${h(p.author.handle || "")} · ${h(typeof relTime === "function" ? relTime(p.createdAt) : "")}</div><p>${h(p.title || p.text)}</p></a>`).join("")}</div>` : `<div class="empty hj-empty">كن أول من يكتب بوسم #${h(s.tags[0])}</div>`}`;
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-rem]"); if (!b) return;
      const k = b.dataset.rem;
      try { if (k === "off") await api("DELETE", "/api/hijri/reminders/" + enc(key)); else await api("PUT", "/api/hijri/reminders/" + enc(key), { daysBefore: +k, onStart: true });
        box.querySelectorAll("[data-rem]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); say(k === "off" ? "أُلغي التذكير" : "✓ سنذكّرك"); } catch (x) { say(x.message); }
    });
  }

  /* =================== #/admin/hijri =================== */
  async function adminView() {
    page("إعلانات الرؤية", `<p class="hj-sub">التقويم يتبع أم القرى، وعند إعلان رسمي مختلف حدّد يوم بداية الشهر هنا. يُسمح بفرق يومين كحد أقصى، ويبقى كل شهر ٢٩ أو ٣٠ يوماً.</p><div id="hj-a">${skel(3)}</div>`, ["#/hijri", "التقويم الهجري"]);
    const draw = (d) => { const box = $("#hj-a"); if (!box) return;
      box.innerHTML = `<ul class="hj-adm">${d.months.map((m) => `<li class="${m.current ? "cur" : ""}"><div class="hd"><b>${h(m.name)} ${h(AR(m.y))} هـ</b>${m.current ? `<span class="hj-chip">الشهر الحالي</span>` : ""}${m.overridden ? `<span class="hj-chip warn">معدّل</span>` : ""}</div>
        <p class="hj-sub">أم القرى: ${h(gShort(m.umalqura))} · المعتمد: ${h(gShort(m.starts))} · ${h(days(m.length))}</p>
        <form data-y="${m.y}" data-m="${m.m}"><label class="u-t-sm hj-f">يبدأ في<input type="date" name="s" value="${h(m.starts)}" required></label><label class="u-t-sm hj-f">المصدر<input name="n" maxlength="200" placeholder="إعلان المحكمة العليا"></label><button class="btn" type="submit">حفظ</button></form>
        ${m.overridden ? `<button class="u-mh44 u-mt6 btn ghost" type="button" data-clear="${m.y}/${m.m}">العودة إلى أم القرى</button>` : ""}</li>`).join("")}</ul>`; };
    let d; try { d = await api("GET", "/api/admin/hijri"); } catch (e) { const b = $("#hj-a"); if (b) b.innerHTML = errBox(e); return; }
    draw(d);
    const box = $("#hj-a");
    box.addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { d = await api("PUT", "/api/admin/hijri/overrides", { y: +f.dataset.y, m: +f.dataset.m, startsOn: f.s.value, note: f.n.value.trim() || undefined }); draw(d); overrides = (await api("GET", "/api/hijri/config")).overrides; say("✓ حُفظ"); } catch (x) { say(x.message); } });
    box.addEventListener("click", async (e) => { const b = e.target.closest("[data-clear]"); if (!b) return; try { d = await api("DELETE", "/api/admin/hijri/overrides/" + b.dataset.clear); draw(d); say("أُعيد إلى أم القرى"); } catch (x) { say(x.message); } });
  }

  MPRoutes.extend((a, b, base) => {
    return { hijri: () => calView(), season: () => seasonView(a) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "hijri" ? adminView() : next()));
  window.MPHijri = { label, hijriOf, calView, seasonView, adminView, version: "__APP_VERSION__" };
  if (/^#\/(hijri|season|admin\/hijri)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
