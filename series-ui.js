/* =====================================================================
 * مجتمع بلس — Phase 62 UI: scheduled publishing + content series (lazy "series" chunk; 0 bytes in core).
 *   #/scheduled              my queue grouped by day, in my time zone (or the one I chose per post): schedule a post /
 *                            story / article with quick times, edit in place, publish now, cancel → back to drafts;
 *                            failed items on top; published in the last 7 days
 *   #/drafts                 synced drafts: continue in the composer, schedule, delete
 *   #/series                 my series + series I follow (notify toggle)
 *   #/series/new             new series / collection
 *   #/series/:id             series page: follow, resume where I stopped, numbered episodes (read ✓), share
 *   #/series/:id/edit        owner: details, order (move up / down), add / remove episodes, archive / delete
 *   #/series/:id/stats       owner: readers per episode, retention, completion, followers per week (phase 61 links)
 *   post page                «episode N of M» card with previous / next and follow (rendered from cache on re-render)
 * Older thread series (#/series/<thread id>, phase 12) still open the old view.
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function SeriesUI() {
  if (window.MPSeries) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const num = (x) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US")}</bdi>`;
  const pc = (x) => (x === null || x === undefined ? "—" : `<bdi dir="ltr">${Math.round(x)}%</bdi>`);
  const rel = (iso) => (typeof relTime === "function" ? relTime(iso) : "");
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const signedIn = () => typeof DB !== "undefined" && !!DB.me && online();

  /* ---------- time zones (Intl only) ---------- */
  const myTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Riyadh"; } catch { return "Asia/Riyadh"; } };
  const TZS = [["Asia/Riyadh", "الرياض ومكة"], ["Asia/Dubai", "دبي وأبوظبي"], ["Asia/Kuwait", "الكويت"], ["Asia/Qatar", "الدوحة"], ["Asia/Bahrain", "المنامة"], ["Asia/Muscat", "مسقط"], ["Asia/Baghdad", "بغداد"], ["Asia/Amman", "عمّان"], ["Africa/Cairo", "القاهرة"], ["Africa/Casablanca", "الدار البيضاء"], ["Europe/Istanbul", "إسطنبول"], ["Europe/London", "لندن"]];
  const tzLabel = (tz) => { const l = (TZS.find((x) => x[0] === tz) || [tz, tz.split("/").pop().replace(/_/g, " ")])[1]; return window.MPI18n?.t ? window.MPI18n.t(l) : l; }; /* v2.69: zone names follow the UI language */
  /* v2.69: English schedule line built in English (day/clock/zone/countdown), not word-swapped from the Arabic one */
  const enWhen = (ms, tz) => {
    const d = new Date(ms), o = { hour: "numeric", minute: "2-digit" };
    const at = d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", ...o });
    const m = Math.max(1, Math.round((ms - Date.now()) / 60000)), left = m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
    return `Publishes ${at} (${tzLabel(tz)} time) · in ${left}${tz !== myTz() ? ` (${d.toLocaleTimeString("en-US", { timeZone: myTz(), ...o })} your time)` : ""}`;
  };
  const tzOptions = (sel) => { const list = TZS.some((x) => x[0] === myTz()) ? TZS : [[myTz(), tzLabel(myTz()) + " (جهازك)"], ...TZS]; return list.map(([v, l]) => `<option value="${h(v)}" ${v === sel ? "selected" : ""}>${h(l)}${v === myTz() && !/جهازك/.test(l) ? " · جهازك" : ""}</option>`).join(""); };
  function partsIn(ms, tz) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
  }
  const offsetAt = (ms, tz) => { const p = partsIn(ms, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ms / 60e3) * 60e3; };
  const zonedToUtc = (y, m, d, hh, mm, tz) => { const g = Date.UTC(y, m - 1, d, hh, mm); let t = g - offsetAt(g, tz); t = g - offsetAt(t, tz); return t; };
  const pad = (n) => String(n).padStart(2, "0");
  const inputIn = (ms, tz) => { const p = partsIn(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`; };
  const fromInput = (v, tz) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ""); return m ? zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz) : NaN; };
  const fmt = (iso, tz, o) => { try { return new Intl.DateTimeFormat("ar", { timeZone: tz || myTz(), ...o }).format(new Date(iso)); } catch { return iso; } };
  const clock = (iso, tz) => fmt(iso, tz, { hour: "numeric", minute: "2-digit" });
  const dayKey = (iso, tz) => { const p = partsIn(Date.parse(iso), tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
  function dayLabel(iso, tz) {
    const k = dayKey(iso, tz), t = dayKey(new Date().toISOString(), tz), tm = dayKey(new Date(Date.now() + 864e5).toISOString(), tz);
    return k === t ? "اليوم" : k === tm ? "غداً" : fmt(iso, tz, { weekday: "long", day: "numeric", month: "long" });
  }
  function until(iso) {
    const m = Math.round((Date.parse(iso) - Date.now()) / 60e3);
    if (m <= 0) return "خلال لحظات"; if (m < 60) return `بعد ${m} د`; const hh = Math.round(m / 60); if (hh < 24) return `بعد ${hh} س`; const d = Math.round(hh / 24); return d === 1 ? "بعد يوم" : d === 2 ? "بعد يومين" : `بعد ${d} ${d <= 10 ? "أيام" : "يوماً"}`;
  }
  /** quick times in the chosen zone */
  function quick(tz) {
    const now = Date.now(), p = partsIn(now, tz), at = (dd, hh, mm = 0) => { const b = partsIn(now + dd * 864e5, tz); return zonedToUtc(b.y, b.m, b.d, hh, mm, tz); };
    const tonight = at(0, 21) > now + 15 * 60e3 ? at(0, 21) : at(1, 21);
    const fri = ((5 - p.wd + 7) % 7) || 7;
    return [["بعد ساعة", Math.ceil((now + 3600e3) / 300e3) * 300e3], [at(0, 21) > now + 15 * 60e3 ? "الليلة ٩م" : "غداً ٩م", tonight], ["غداً ٨ص", at(1, 8)], ["الجمعة ٤م", at(fri, 16)]];
  }
  const TYPE = { post: ["منشور", ""], article: ["مقال", ""], story: ["قصة", ""], audio: ["صوت", ""], video: ["فيديو", ""] };

  const page = (title, body, back, sub) => { view.innerHTML = `<div class="wrap sq-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="sq-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div></div></header>${body}</div>`; $("#sq-h")?.focus({ preventScroll: true }); };
  const tabs = (cur, n = {}) => `<nav class="sq-tabs seg" aria-label="أقسام النشر"><a href="#/scheduled" ${cur === "q" ? 'aria-current="page"' : ""}>المجدولة${n.q ? ` <span class="sq-n">${num(n.q)}</span>` : ""}</a><a href="#/drafts" ${cur === "d" ? 'aria-current="page"' : ""}>المسودات${n.d ? ` <span class="sq-n">${num(n.d)}</span>` : ""}</a><a href="#/series" ${cur === "s" ? 'aria-current="page"' : ""}>السلاسل</a></nav>`;
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel sq-skel"></div>`).join("");
  const needLogin = () => { page("سجّل الدخول", `<div class="empty">سجّل الدخول لإدارة منشوراتك المجدولة وسلاسلك.</div>`); };

  if (!document.getElementById("sq-css")) document.head.insertAdjacentHTML("beforeend", `<style id="sq-css">
.sq-page{max-width:820px;margin:auto}.sq-page .sq-sub{margin:0 0 var(--s3)}.sq-page h2:focus{outline:none}
.sq-page h3{font-size:16px;font-weight:800;margin:22px 0 8px}
.sq-n{font-size:11.5px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--accent2);color:var(--accent-ink);display:inline-grid;place-items:center}
.sq-card{padding:14px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:8px 0}.sq-skel{height:86px;border-radius:var(--r);margin:8px 0}
.sq-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.sq-row .btn{min-height:44px}.sq-grow{flex:1;min-width:0}
.sq-day{display:flex;align-items:center;gap:8px;margin:18px 2px 6px;font-size:13px;font-weight:800;color:var(--text-2)}.sq-day::after{content:"";flex:1;height:1px;background:var(--line)}
.sq-item{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;padding:12px 14px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:8px 0;transition:opacity .2s var(--ease),transform .2s var(--ease)}.sq-item.out{opacity:0;transform:scale(.98)}
.sq-time{grid-row:span 2;display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:64px;padding:8px 6px;border-radius:var(--r-sm);background:var(--accent2);color:var(--accent-ink);text-align:center}.sq-time b{font-size:16px;font-weight:800;line-height:1.2;white-space:nowrap}.sq-time span{font-size:11px;font-weight:600;opacity:.85;white-space:nowrap}
.sq-item .t{font-weight:700;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}.sq-meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12.5px;color:var(--muted)}
.sq-chip{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.sq-acts{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.sq-acts .btn{min-height:44px;padding:0 14px;font-size:14px}.sq-acts .btn.danger{background:transparent;color:color-mix(in srgb,var(--danger) 72%,var(--text));border-color:color-mix(in srgb,var(--danger) 35%,var(--line-2))}.sq-dacts{flex-basis:100%;padding-inline-start:52px}
.sq-item.failed{border-color:color-mix(in srgb,var(--danger) 45%,var(--line));background:color-mix(in srgb,var(--danger) 5%,var(--card))}.sq-item.failed .sq-time{background:color-mix(in srgb,var(--danger) 14%,transparent);color:color-mix(in srgb,var(--danger) 70%,var(--text))}
.sq-f{display:flex;flex-direction:column;gap:10px}.sq-f label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--text-2)}.sq-f input,.sq-f select,.sq-f textarea{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}.sq-f textarea{min-height:110px;line-height:1.7;resize:vertical}
.sq-two{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:520px){.sq-two{grid-template-columns:1.3fr 1fr}}
.sq-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;background:var(--bg-2);border-radius:999px;border:0;margin:0}.sq-seg legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.sq-seg label{flex-direction:row;justify-content:center;align-items:center;min-height:44px;border-radius:999px;cursor:pointer;font-size:14px;gap:6px;color:var(--text-2)}.sq-seg input{position:absolute;opacity:0;width:1px;height:1px}.sq-seg label:has(input:checked){background:var(--card);color:var(--accent-ink);box-shadow:var(--sh-1)}.sq-seg label:has(input:focus-visible){outline:2px solid var(--accent)}
.sq-when{font-size:13px;color:var(--muted);margin:-2px 2px 0;min-height:1.6em}.sq-count{font-size:12px;color:var(--muted);text-align:end;margin-top:-6px}
.sq-new>summary{list-style:none;min-height:52px;display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:800}.sq-new>summary::-webkit-details-marker{display:none}.sq-new>summary .plus{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:#fff;font-size:20px;flex:none;transition:transform .2s var(--ease)}.sq-new[open]>summary .plus{transform:rotate(45deg)}.sq-new[open]>summary{margin-bottom:10px}
.sq-list{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.sq-list:empty{display:none}.sq-list>li{display:flex;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);min-height:56px;flex-wrap:wrap}.sq-list>li:last-child{border-bottom:0}.sq-list a{color:inherit;text-decoration:none}.sq-ic{width:40px;height:40px;flex:none;border-radius:var(--r-sm);display:grid;place-items:center;background:var(--bg-2);font-size:20px}
.sq-list .t{font-weight:700;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sq-list .m{font-size:12.5px;color:var(--muted)}
.sq-grid{display:grid;grid-template-columns:1fr;gap:10px;margin:10px 0}@media(min-width:560px){.sq-grid{grid-template-columns:1fr 1fr}}
.sq-sc{display:flex;flex-direction:column;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);overflow:hidden;color:var(--text);text-decoration:none;min-width:0}.sq-sc .cv{height:96px;background:var(--hero-grad);display:flex;align-items:flex-end;padding:10px 12px;color:#fff;font-size:28px;position:relative}.sq-sc .cv img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.sq-sc .cv .k{position:relative;font-size:11.5px;font-weight:700;background:#0006;padding:2px 10px;border-radius:999px;margin-inline-start:auto}
.sq-sc .bd{padding:10px 12px 12px;display:flex;flex-direction:column;gap:4px;min-width:0}.sq-sc .bd b{font-size:15.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sq-sc .bd .m{font-size:12.5px;color:var(--muted);display:flex;gap:8px;flex-wrap:wrap}
.sq-hero{border-radius:var(--r-lg);overflow:hidden;border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:10px 0}.sq-hero .cv{min-height:120px;background:var(--hero-grad);position:relative;display:flex;align-items:flex-end;padding:14px 16px;color:#fff}.sq-hero .cv img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}.sq-hero .cv .in{position:relative}.sq-hero .cv .k{font-size:12px;font-weight:700;background:#0005;padding:3px 10px;border-radius:999px}.sq-hero .cv h1{margin:8px 0 0;font-size:22px;line-height:1.35;font-weight:800;color:#fff}
.sq-hero .bd{padding:12px 16px 16px}.sq-hero .by{display:flex;gap:8px;align-items:center;font-size:13.5px;color:var(--text-2)}.sq-hero .by a{color:var(--accent-ink);font-weight:700;text-decoration:none}.sq-hero p.d{margin:8px 0;line-height:1.8;color:var(--text-2);white-space:pre-wrap}
.sq-stats{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin:6px 0}.sq-stats b{color:var(--text);font-size:15px}
.sq-prog{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-2);margin:8px 0}.sq-bar{flex:1;height:8px;border-radius:6px;background:var(--bg-2);overflow:hidden}.sq-bar i{display:block;height:100%;background:var(--accent);border-radius:6px}
.sq-cta{display:flex;justify-content:center;min-height:48px;margin:10px 0 8px}.sq-act3{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px}.sq-act3 .btn{min-height:44px;justify-content:center;padding:0 8px;white-space:nowrap}.sq-act3 [hidden]{display:none}.btn.sq-follow[aria-pressed="true"]{background:var(--accent2);color:var(--accent-ink);border-color:var(--accent)}.sq-bell{min-width:44px;min-height:44px;border-radius:50%;border:1px solid var(--line-2);background:var(--card);cursor:pointer;font-size:18px}.sq-bell[aria-pressed="false"]{opacity:.55}
.sq-eps{counter-reset:none;list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.sq-eps li{display:flex;gap:12px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);min-height:60px}.sq-eps li:last-child{border-bottom:0}.sq-eps a{color:inherit;text-decoration:none;display:flex;gap:12px;align-items:center;flex:1;min-width:0;min-height:44px}
.sq-no{width:34px;height:34px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:800;font-size:14px;background:var(--bg-2);color:var(--text-2)}.sq-no.seen{background:color-mix(in srgb,var(--ok) 18%,transparent);color:color-mix(in srgb,var(--ok) 60%,var(--text))}.sq-no.soon{background:color-mix(in srgb,var(--warn) 18%,transparent);color:color-mix(in srgb,var(--warn) 60%,var(--text))}
.sq-eps .t{font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.35}.sq-eps .m{font-size:12.5px;color:var(--muted)}.sq-mv{display:flex;gap:4px;flex:none}.sq-mv button{min-width:44px;min-height:44px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--card);color:var(--text-2);cursor:pointer;font-size:16px}.sq-mv button:disabled{opacity:.35;cursor:default}.sq-mv .x{color:var(--danger)}
.sq-nav{margin:10px 0;padding:12px 14px;border-radius:var(--r);border:1px solid var(--line);background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 6%,var(--card)),var(--card));box-shadow:var(--sh-1)}.sq-nav .hd{display:flex;gap:10px;align-items:center}.sq-nav .hd a{color:inherit;text-decoration:none;flex:1;min-width:0;min-height:44px;display:flex;flex-direction:column;justify-content:center}.sq-nav .hd small{color:var(--muted);font-size:12px}.sq-nav .hd b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sq-pn{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.sq-pn a,.sq-pn span{min-height:52px;display:flex;flex-direction:column;justify-content:center;padding:6px 12px;border-radius:var(--r-sm);background:var(--bg-2);color:var(--text);text-decoration:none;min-width:0}.sq-pn small{font-size:11.5px;color:var(--muted)}.sq-pn b{font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sq-pn .nx{text-align:end}.sq-pn span{opacity:.5}
.sq-k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}@media(min-width:620px){.sq-k{grid-template-columns:repeat(4,minmax(0,1fr))}}.sq-k div{padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1)}.sq-k b{display:block;font-size:24px;font-weight:800;line-height:1.25}.sq-k span{font-size:12.5px;color:var(--muted)}
.sq-ret li{flex-wrap:wrap}.sq-ret .tr{flex-basis:100%;height:8px;border-radius:6px;background:var(--bg-2);overflow:hidden}.sq-ret .tr i{display:block;height:100%;background:var(--accent);border-radius:6px}.sq-chart{width:100%;height:auto;display:block;max-height:130px}.sq-chart rect{fill:var(--accent)}.sq-chart text{font-size:11px;fill:var(--muted)}
.sq-ins{padding:12px 14px;border-radius:var(--r-sm);background:color-mix(in srgb,var(--info) 10%,var(--card));border:1px solid color-mix(in srgb,var(--info) 30%,var(--line));color:var(--text-2);line-height:1.7;font-size:14px;margin:10px 0}
</style>`);

  /* =================== schedule form (new / from draft) =================== */
  let mySeries = null;
  const loadSeries = async () => (mySeries ||= (await api("GET", "/api/cseries?mine=1").catch(() => ({ series: [] }))).series.filter((s) => s.status === "active"));
  function schedForm(pre = {}) {
    const tz = pre.tz || myTz(), type = pre.type && ["post", "article", "story"].includes(pre.type) ? pre.type : "post";
    const at = pre.publishAt ? Date.parse(pre.publishAt) : Math.ceil((Date.now() + 3600e3) / 300e3) * 300e3;
    return `<form class="sq-f" id="sq-form" novalidate>
      <fieldset class="sq-seg"><legend>نوع المحتوى</legend>${["post", "article", "story"].map((t) => `<label><input type="radio" name="type" value="${t}" ${t === type ? "checked" : ""}><span aria-hidden="true">${TYPE[t][1]}</span> ${TYPE[t][0]}</label>`).join("")}</fieldset>
      <label data-for="article" ${type === "article" ? "" : "hidden"}>عنوان المقال<input name="title" maxlength="200" value="${h(pre.title || "")}" placeholder="عنوان واضح يجذب القارئ"></label>
      <label><span data-lbl>${type === "story" ? "نص القصة" : "النص"}</span><textarea name="text" maxlength="${type === "story" ? 500 : 5000}" placeholder="${type === "story" ? "قصة قصيرة تظهر ٢٤ ساعة من لحظة نشرها" : "ماذا تريد أن تقول؟"}">${h(pre.text || "")}</textarea></label><div class="sq-count" aria-live="polite"></div>
      <div class="sq-quick f-chips" role="group" aria-label="مواعيد سريعة"></div>
      <div class="sq-two"><label>موعد النشر<input type="datetime-local" name="at" required value="${inputIn(at, tz)}"></label><label>المنطقة الزمنية<select name="tz">${tzOptions(tz)}</select></label></div>
      <p class="sq-when" aria-live="polite"></p>
      <label data-for="series" ${type === "story" ? "hidden" : ""}>ضمن سلسلة (اختياري)<select name="series"><option value="">بدون سلسلة</option></select></label>
      <div class="sq-row"><button class="btn" type="submit"><svg class=ix aria-hidden=true><use href=#i-cal /></svg> جدولة</button>${pre.cancel ? `<button class="btn ghost" type="button" data-cancel>إلغاء</button>` : ""}</div></form>`;
  }
  function wireForm(form, { draftId, seriesId, onDone } = {}) {
    if (!form) return;
    const f = (n) => form.elements[n];
    const refresh = () => {
      const tz = f("tz").value, ms = fromInput(f("at").value, tz), type = form.querySelector("input[name=type]:checked").value;
      form.querySelector('[data-for="article"]').hidden = type !== "article";
      form.querySelector('[data-for="series"]').hidden = type === "story";
      form.querySelector("[data-lbl]").textContent = type === "story" ? "نص القصة" : "النص";
      f("text").maxLength = type === "story" ? 500 : 5000;
      const w = form.querySelector(".sq-when");
      w.textContent = Number.isFinite(ms) && ms >= Date.now() + 60e3 && window.MPI18n?.current?.() === "en" ? enWhen(ms, tz) : Number.isFinite(ms) ? (ms < Date.now() + 60e3 ? "اختر موعداً في المستقبل" : `يُنشر ${dayLabel(new Date(ms).toISOString(), tz)} الساعة ${clock(new Date(ms).toISOString(), tz)} بتوقيت ${tzLabel(tz)} · ${until(new Date(ms).toISOString())}${tz !== myTz() ? ` (${clock(new Date(ms).toISOString(), myTz())} بتوقيتك)` : ""}`) : "";
      form.querySelector(".sq-count").textContent = `${f("text").value.length.toLocaleString("en-US")} / ${f("text").maxLength.toLocaleString("en-US")}`;
      form.querySelectorAll(".sq-quick button").forEach((b) => b.setAttribute("aria-pressed", String(Math.abs(+b.dataset.ms - ms) < 60e3)));
    };
    const drawQuick = () => { form.querySelector(".sq-quick").innerHTML = quick(f("tz").value).map(([l, ms]) => `<button type="button" data-ms="${ms}" aria-pressed="false">${h(l)}</button>`).join(""); };
    form.querySelector(".sq-quick").addEventListener("click", (e) => { const b = e.target.closest("button[data-ms]"); if (!b) return; f("at").value = inputIn(+b.dataset.ms, f("tz").value); refresh(); });
    f("tz").addEventListener("change", () => { const prevTz = form.dataset.tz || myTz(), ms = fromInput(f("at").value, prevTz); form.dataset.tz = f("tz").value; if (Number.isFinite(ms)) f("at").value = inputIn(ms, f("tz").value); drawQuick(); refresh(); });
    form.dataset.tz = f("tz").value;
    form.addEventListener("input", refresh); form.addEventListener("change", refresh);
    form.querySelector("[data-cancel]")?.addEventListener("click", () => onDone?.(null));
    drawQuick(); refresh();
    loadSeries().then((list) => { const sel = f("series"); if (!sel || !sel.isConnected) return; sel.insertAdjacentHTML("beforeend", list.map((s) => `<option value="${h(s.id)}" ${s.id === seriesId ? "selected" : ""}>${h(s.title)}</option>`).join("")); if (!list.length) sel.closest("label").hidden = true; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const type = form.querySelector("input[name=type]:checked").value, tz = f("tz").value, ms = fromInput(f("at").value, tz), text = f("text").value.trim(), title = f("title").value.trim();
      if (!Number.isFinite(ms) || ms < Date.now() + 60e3) { say("اختر موعداً بعد دقيقة على الأقل"); f("at").focus(); return; }
      if (type === "article" && !title) { say("المقال يحتاج عنواناً"); f("title").focus(); return; }
      if (!text) { say("اكتب نص المنشور"); f("text").focus(); return; }
      const post = type === "article" ? { type, title, markdown: text } : type === "story" ? { type, text, media: "linear-gradient(135deg,#5b2bd6,#e0559b)" } : { type, markdown: text };
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "…";
      try {
        const r = await api("POST", "/api/schedule", { post, publishAt: new Date(ms).toISOString(), tz, seriesId: type !== "story" && f("series").value ? f("series").value : undefined });
        if (draftId) api("DELETE", "/api/drafts/" + enc(draftId)).catch(() => { });
        if (r.note) say(r.note); else say(`✓ جُدول — ${dayLabel(new Date(ms).toISOString(), tz)} ${clock(new Date(ms).toISOString(), tz)}`);
        onDone?.(r.item);
      } catch (x) { say(x.message); } finally { btn.disabled = false; btn.textContent = "جدولة"; }
    });
  }

  /* =================== #/scheduled =================== */
  const Q = { items: [], recent: [], drafts: 0 };
  function itemCard(it) {
    const tz = it.tz || myTz(), failed = it.state === "failed";
    return `<article class="sq-item${failed ? " failed" : ""}" data-id="${h(it.id)}" aria-label="${h(TYPE[it.type]?.[0] || "منشور")}: ${h(it.title)}">
      <div class="sq-time"><b>${clock(it.publishAt, tz)}</b><span>${failed ? "تعذّر النشر" : until(it.publishAt)}</span></div>
      <div class="t">${h(it.title)}</div>
      <div class="sq-meta"><span class="sq-chip sbadge">${TYPE[it.type]?.[1] || ""} ${TYPE[it.type]?.[0] || "منشور"}</span>${it.series ? `<a class="sq-chip sbadge info" href="#/series/${enc(it.series.id)}"><svg class=ix aria-hidden=true><use href=#i-book /></svg> ${h(it.series.title)} · ${num(it.series.position)}</a>` : ""}${it.tz && it.tz !== myTz() ? `<span class="sq-chip sbadge"><svg class=ix aria-hidden=true><use href=#i-globe /></svg> ${h(tzLabel(it.tz))}</span>` : ""}${it.visibility !== "public" ? `<span class="sq-chip sbadge"><svg class=ix aria-hidden=true><use href=#i-lock /></svg> ${it.visibility === "followers" ? "المتابعون" : it.visibility === "close" ? "المقربون" : "أنا فقط"}</span>` : ""}${failed ? `<span class="sq-chip sbadge bad"><svg class=ix aria-hidden=true><use href=#i-alert /></svg> ${h(it.lastError || "تعذّر النشر")} — أعد الجدولة</span>` : ""}</div>
      <div class="sq-acts"><button type="button" class="btn ghost" data-edit aria-expanded="false">تعديل</button><button type="button" class="btn ghost" data-now><svg class=ix aria-hidden=true><use href=#i-rocket /></svg> انشر الآن</button><button type="button" class="btn ghost danger" data-cancel>إلغاء ← المسودات</button></div>
    </article>`;
  }
  function editForm(it) {
    const tz = it.tz || myTz();
    return `<form class="sq-f sq-card" data-ed="${h(it.id)}" novalidate>${it.hasTitle ? `<label>العنوان<input name="title" maxlength="200" value="${h(it.title)}"></label>` : ""}
      <label>النص<textarea name="text" maxlength="5000">${h(it.text)}</textarea></label>
      <div class="sq-two"><label>موعد النشر<input type="datetime-local" name="at" value="${inputIn(Date.parse(it.publishAt), tz)}"></label><label>المنطقة الزمنية<select name="tz">${tzOptions(tz)}</select></label></div>
      <div class="sq-row"><button class="btn" type="submit">حفظ التعديلات</button><button class="btn ghost" type="button" data-close>إغلاق</button></div></form>`;
  }
  function renderQueue() {
    const box = $("#sq-q"); if (!box) return;
    const failed = Q.items.filter((i) => i.state === "failed"), ok = Q.items.filter((i) => i.state !== "failed").sort((a, b) => (a.publishAt < b.publishAt ? -1 : 1));
    if (!Q.items.length) { box.innerHTML = `<div class="empty"><b>لا منشورات مجدولة</b>جهّز منشوراتك مسبقاً واتركها تُنشر في أفضل وقت لجمهورك — حتى وأنت بعيد عن الشاشة.<br><button type="button" class="btn" data-open-new><svg class=ix aria-hidden=true><use href=#i-plus /></svg>جدولة أول منشور</button></div>`; box.querySelector("[data-open-new]")?.addEventListener("click", () => { const d = $("#sq-new"); if (d) { d.open = true; d.querySelector("textarea")?.focus(); } }); return; }
    let last = "", html = failed.length ? `<div class="u-c-dg sq-day">يحتاج انتباهك</div>${failed.map(itemCard).join("")}` : "";
    for (const it of ok) { const tz = myTz(), k = dayKey(it.publishAt, tz); if (k !== last) { last = k; html += `<div class="sq-day">${h(dayLabel(it.publishAt, tz))}</div>`; } html += itemCard(it); }
    box.innerHTML = html;
    const cnt = $(".sq-tabs .sq-n"); if (cnt) cnt.innerHTML = num(Q.items.length);
  }
  async function queueView() {
    if (!signedIn()) return needLogin();
    page("النشر المجدول", `${tabs("q")}
      <details class="sq-card sq-new" id="sq-new"><summary><span class="plus" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-plus /></svg></span><span>جدولة منشور أو قصة أو مقال</span></summary>${schedForm()}</details>
      <div id="sq-q">${skel(3)}</div><div id="sq-recent"></div>`, null, `المواعيد معروضة بتوقيتك (${h(tzLabel(myTz()))}). يمكنك اختيار منطقة أخرى لكل منشور.`);
    rewireNew();
    let r; try { r = await api("GET", "/api/schedule"); } catch (e) { if ($("#sq-q")) $("#sq-q").innerHTML = errBox(e); return; }
    Object.assign(Q, { items: r.items, recent: r.recent, drafts: r.drafts });
    if (!$("#sq-q")) return;
    const t = view.querySelector(".sq-tabs"); if (t) t.outerHTML = tabs("q", { q: r.items.length, d: r.drafts });
    renderQueue();
    if (r.recent.length) $("#sq-recent").innerHTML = `<h3>نُشر خلال الأسبوع</h3><ul class="sq-list">${r.recent.map((x) => `<li><span class="sq-ic" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-check /></svg></span><a class="sq-grow" href="#/post/${enc(x.id)}"><span class="t">${h(x.title)}</span><span class="m">${rel(x.publishedAt)}</span></a></li>`).join("")}</ul>`;
  }
  function onNew(item) {
    if (!item) return; Q.items.push(item); renderQueue();
    const d = $("#sq-new"); if (d) { d.open = false; d.querySelector("form")?.remove(); d.insertAdjacentHTML("beforeend", schedForm()); rewireNew(); }
    view.querySelector(`.sq-item[data-id="${CSS.escape(item.id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function rewireNew() { wireForm($("#sq-form"), { onDone: onNew }); }
  // one delegated listener for the queue (survives list re-renders)
  addEventListener("click", async (e) => {
    const card = e.target.closest?.(".sq-item"); if (!card || !view.contains(card)) return;
    const pid = card.dataset.id, it = Q.items.find((x) => x.id === pid); if (!it) return;
    if (e.target.closest("[data-edit]")) {
      const open = card.nextElementSibling?.matches?.(`form[data-ed="${CSS.escape(pid)}"]`);
      if (open) { card.nextElementSibling.remove(); e.target.closest("[data-edit]").setAttribute("aria-expanded", "false"); return; }
      card.insertAdjacentHTML("afterend", editForm(it)); e.target.closest("[data-edit]").setAttribute("aria-expanded", "true");
      const f = card.nextElementSibling; f.querySelector("textarea").focus();
      f.querySelector("[data-close]").addEventListener("click", () => { f.remove(); card.querySelector("[data-edit]")?.setAttribute("aria-expanded", "false"); });
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault(); const tz = f.elements.tz.value, ms = fromInput(f.elements.at.value, tz);
        const body = { text: f.elements.text.value, tz, publishAt: Number.isFinite(ms) ? new Date(ms).toISOString() : undefined }; if (f.elements.title) body.title = f.elements.title.value;
        try { const r = await api("PATCH", "/api/schedule/" + enc(pid), body); Object.assign(it, r.item); renderQueue(); say("✓ حُفظت التعديلات"); view.querySelector(`.sq-item[data-id="${CSS.escape(pid)}"] [data-edit]`)?.focus(); } catch (x) { say(x.message); }
      });
    } else if (e.target.closest("[data-now]")) {
      if (!confirm("نشر هذا المنشور الآن بدل موعده؟")) return;
      try { const r = await api("POST", `/api/schedule/${enc(pid)}/now`); if (r.ok) { drop(card, pid); say("نُشر الآن"); } else say("تعذّر النشر الآن؛ حاول لاحقاً"); } catch (x) { say(x.message); }
    } else if (e.target.closest("[data-cancel]")) {
      if (!confirm("إلغاء الجدولة؟ سيعود المحتوى إلى مسوداتك ولن يُنشر.")) return;
      try { await api("DELETE", "/api/schedule/" + enc(pid)); drop(card, pid); Q.drafts++; const t = view.querySelector(".sq-tabs"); if (t) t.outerHTML = tabs("q", { q: Q.items.length, d: Q.drafts }); say("أُلغيت الجدولة — تجده في المسودات"); } catch (x) { say(x.message); }
    }
  });
  function drop(card, pid) { Q.items = Q.items.filter((x) => x.id !== pid); card.classList.add("out"); const ed = card.nextElementSibling?.matches?.("form[data-ed]") ? card.nextElementSibling : null; setTimeout(() => { ed?.remove(); renderQueue(); }, 200); }

  /* =================== #/drafts =================== */
  async function draftsView() {
    if (!signedIn()) return needLogin();
    page("المسودات", `${tabs("d")}<div id="sq-d">${skel(3)}</div>`, null, "مسوداتك محفوظة على حسابك وتتزامن بين أجهزتك.");
    let r; try { r = await api("GET", "/api/drafts"); } catch (e) { if ($("#sq-d")) $("#sq-d").innerHTML = errBox(e); return; }
    const box = $("#sq-d"); if (!box) return;
    const list = r.drafts || [];
    const t = view.querySelector(".sq-tabs"); if (t) t.outerHTML = tabs("d", { d: list.length });
    if (!list.length) { box.innerHTML = `<div class="empty"><b>لا مسودات</b>عندما تغلق المحرر قبل النشر، تُحفظ كتابتك هنا تلقائياً.<br><button type="button" class="btn" data-ui="compose"><svg class=ix aria-hidden=true><use href=#i-pen /></svg> ابدأ الكتابة</button></div>`; return; }
    const title = (d) => (d.data?.title || String(d.data?.markdown || "").replace(/[#*_>`-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90) || "مسودة بلا عنوان");
    box.innerHTML = `<ul class="sq-list" id="sq-dl">${list.map((d) => `<li data-d="${h(d.id)}"><span class="sq-ic" aria-hidden="true">${TYPE[d.data?.type]?.[1] || ""}</span><span class="sq-grow"><span class="t">${h(title(d))}</span><span class="m">${TYPE[d.data?.type]?.[0] || "منشور"} · عُدّلت ${rel(d.updatedAt)}${d.device === "schedule" ? " · أُعيدت من الجدولة" : ""}</span></span>
      <span class="sq-acts sq-dacts" style="grid-column:auto;margin:0"><button type="button" class="btn ghost" data-go>متابعة</button><button type="button" class="btn ghost" data-sch aria-expanded="false">جدولة</button><button type="button" class="btn ghost danger" data-del aria-label="حذف المسودة ${h(title(d))}">حذف</button></span></li>`).join("")}</ul>`;
    box.addEventListener("click", async (e) => {
      const li = e.target.closest("li[data-d]"); if (!li) return; const d = list.find((x) => x.id === li.dataset.d); if (!d) return;
      if (e.target.closest("[data-go]")) { if (typeof openComposer === "function") openComposer({ draftId: d.id, data: { ...d.data, updatedAt: d.updatedAt } }); }
      else if (e.target.closest("[data-del]")) { if (!confirm("حذف المسودة نهائياً؟")) return; try { await api("DELETE", "/api/drafts/" + enc(d.id)); li.remove(); list.splice(list.indexOf(d), 1); if (!list.length) draftsView(); say("حُذفت المسودة"); } catch (x) { say(x.message); } }
      else if (e.target.closest("[data-sch]")) {
        const b = e.target.closest("[data-sch]"), nx = li.nextElementSibling;
        if (nx?.classList.contains("sq-sf")) { nx.remove(); b.setAttribute("aria-expanded", "false"); return; }
        li.insertAdjacentHTML("afterend", `<li class="u-db sq-sf">${schedForm({ type: d.data?.type, title: d.data?.title, text: d.data?.markdown, cancel: true })}</li>`); b.setAttribute("aria-expanded", "true");
        const f = li.nextElementSibling.querySelector("form"); f.id = "";
        wireForm(f, { draftId: d.id, onDone: (item) => { f.closest("li").remove(); b.setAttribute("aria-expanded", "false"); if (item) { li.remove(); list.splice(list.indexOf(d), 1); if (!list.length) draftsView(); } } });
      }
    });
  }

  /* =================== series =================== */
  const cover = (s, big) => (s.cover ? `<img src="${h(s.cover)}" alt="" loading="lazy">` : big ? "" : `<span aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-book /></svg></span>`);
  const seriesCard = (s, mine) => `<a class="sq-sc" href="#/series/${enc(s.id)}"><div class="cv">${cover(s)}<span class="k">${h(s.kindLabel)}${s.status === "archived" ? " · مؤرشفة" : s.visibility === "unlisted" ? " · غير مدرجة" : ""}</span></div><div class="bd"><b>${h(s.title)}</b><div class="m"><span>${num(s.episodes)} ${s.episodes === 1 ? "حلقة" : "حلقات"}</span>${mine && s.scheduled ? `<span><svg class=ix aria-hidden=true><use href=#i-cal /></svg> ${num(s.scheduled)} مجدولة</span>` : ""}<span><svg class=ix aria-hidden=true><use href=#i-users /></svg> ${num(s.followers)}</span>${!mine ? `<span>@${h(s.author?.handle || "")}</span>` : ""}${s.lastEpisodeAt ? `<span>آخر حلقة ${rel(s.lastEpisodeAt)}</span>` : ""}</div></div></a>`;
  async function hubView() {
    if (!signedIn()) return needLogin();
    const f = qs().get("tab") === "following";
    page("السلاسل", `${tabs("s")}<nav class="sq-sub f-chips" aria-label="عرض السلاسل"><a class="chip f" href="#/series" ${!f ? 'aria-current="page"' : ""}>سلاسلي</a><a class="chip f" href="#/series?tab=following" ${f ? 'aria-current="page"' : ""}>أتابعها</a></nav>
      ${!f ? `<div class="sq-row"><a class="btn" href="#/series/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>سلسلة جديدة</a></div>` : ""}<div id="sq-s"><div class="sq-grid">${skel(2)}</div></div>`, null, f ? "تصلك إشعارات عند نشر حلقة جديدة — يمكنك كتمها لكل سلسلة." : "اجمع منشوراتك ومقالاتك في سلاسل مرتبة، ليتابعها جمهورك حلقة بعد حلقة.");
    let r; try { r = await api("GET", f ? "/api/cseries?following=1" : "/api/cseries?mine=1"); } catch (e) { if ($("#sq-s")) $("#sq-s").innerHTML = errBox(e); return; }
    const box = $("#sq-s"); if (!box) return;
    if (!r.series.length) { box.innerHTML = f ? `<div class="empty"><b>لا تتابع أي سلسلة بعد</b>افتح سلسلة تعجبك واضغط «تابع السلسلة» لتصلك الحلقات الجديدة.</div>` : `<div class="empty"><b>ابدأ سلسلتك الأولى</b>دروس أسبوعية، يوميات مشروع، أو مجموعة مقالات حول موضوع واحد — رتّبها في سلسلة واحدة.<br><a class="btn" href="#/series/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>سلسلة جديدة</a></div>`; return; }
    box.innerHTML = `<div class="sq-grid">${r.series.map((s) => f ? `<div style="position:relative">${seriesCard(s)}<button type="button" class="sq-bell" data-bell="${h(s.id)}" aria-pressed="${s.notify}" aria-label="إشعارات الحلقات الجديدة من ${h(s.title)}" style="position:absolute;top:8px;inset-inline-start:8px;background:var(--card)">${s.notify ? "" : ""}</button></div>` : seriesCard(s, true)).join("")}</div>`;
    box.querySelectorAll("[data-bell]").forEach((b) => b.addEventListener("click", async () => { const on = b.getAttribute("aria-pressed") !== "true"; try { await api("PUT", `/api/cseries/${enc(b.dataset.bell)}/follow`, { notify: on }); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "" : ""; say(on ? "ستصلك الحلقات الجديدة" : "كُتمت إشعارات هذه السلسلة"); } catch (x) { say(x.message); } }));
  }
  function seriesFields(s = {}) {
    return `<label>اسم السلسلة<input name="title" required minlength="2" maxlength="90" value="${h(s.title || "")}" placeholder="مثال: رحلة تعلم البرمجة"></label>
      <label>الوصف<textarea name="descr" maxlength="600" placeholder="عمّ تتحدث السلسلة، ولمن هي، وكم مرة تنشر؟">${h(s.descr || "")}</textarea></label>
      <fieldset class="sq-seg" style="grid-template-columns:1fr 1fr"><legend>النوع</legend><label><input type="radio" name="kind" value="series" ${s.kind !== "collection" ? "checked" : ""}>سلسلة حلقات</label><label><input type="radio" name="kind" value="collection" ${s.kind === "collection" ? "checked" : ""}>مجموعة مختارة</label></fieldset>
      <fieldset class="sq-seg" style="grid-template-columns:1fr 1fr"><legend>الظهور</legend><label><input type="radio" name="visibility" value="public" ${s.visibility !== "unlisted" ? "checked" : ""}>عامة</label><label><input type="radio" name="visibility" value="unlisted" ${s.visibility === "unlisted" ? "checked" : ""}>بالرابط فقط</label></fieldset>`;
  }
  const readFields = (f) => ({ title: f.elements.title.value.trim(), descr: f.elements.descr.value.trim(), kind: f.querySelector("input[name=kind]:checked")?.value, visibility: f.querySelector("input[name=visibility]:checked")?.value });
  function newView() {
    if (!signedIn()) return needLogin();
    page("سلسلة جديدة", `<form class="sq-f sq-card" id="sq-nf">${seriesFields()}<div class="sq-row"><button class="btn" type="submit">إنشاء السلسلة</button></div></form>`, ["#/series", "السلاسل"], "بعد الإنشاء أضف حلقاتها من منشوراتك، أو اختر السلسلة عند جدولة منشور جديد.");
    $("#sq-nf").addEventListener("submit", async (e) => { e.preventDefault(); const b = readFields(e.target); if (b.title.length < 2) return say("اكتب اسم السلسلة"); try { const r = await api("POST", "/api/cseries", b); mySeries = null; location.hash = `#/series/${enc(r.series.id)}/edit`; say("✓ أُنشئت السلسلة — أضف حلقاتها"); } catch (x) { say(x.message); } });
  }
  async function seriesView(sid) {
    page("…", `<div id="sq-sv">${skel(3)}</div>`, ["#/series", "السلاسل"]);
    let d; try { d = await api("GET", "/api/cseries/" + enc(sid)); } catch (e) { if ($("#sq-sv")) $("#sq-sv").innerHTML = errBox(e); return; }
    const box = $("#sq-sv"); if (!box) return;
    const s = d.series, me = d.me, eps = d.items, pub = eps.filter((x) => x.episode);
    const hd = $("#sq-h"); if (hd) { hd.textContent = s.title; hd.classList.add("sr-only"); hd.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"; }
    const start = me.resume || (pub[0] ? { id: pub[0].id, episode: 1 } : null);
    box.innerHTML = `<section class="sq-hero" aria-labelledby="sq-t"><div class="cv">${cover(s, true)}<div class="in"><span class="k">${h(s.kindLabel)}${s.visibility === "unlisted" ? " · بالرابط فقط" : ""}${s.status === "archived" ? " · مؤرشفة" : ""}</span><h1 id="sq-t">${h(s.title)}</h1></div></div>
      <div class="bd"><div class="by">بقلم <a href="#/u/${enc(s.author.handle)}">${h(s.author.name)}</a></div>${s.descr ? `<p class="d">${h(s.descr)}</p>` : ""}
        <div class="sq-stats"><span><b>${num(s.episodes)}</b> ${s.episodes === 1 ? "حلقة" : "حلقات"}</span><span><b data-fc>${num(s.followers)}</b> متابع</span>${s.lastEpisodeAt ? `<span>آخر حلقة ${rel(s.lastEpisodeAt)}</span>` : ""}</div>
        ${me.seen && pub.length ? `<div class="sq-prog"><span>قرأت ${num(me.seen)} من ${num(pub.length)}</span><span class="sq-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${pub.length}" aria-valuenow="${me.seen}" aria-label="تقدّمك في السلسلة"><i style="width:${Math.round((me.seen / pub.length) * 100)}%"></i></span></div>` : ""}
        ${start ? `<a class="btn sq-cta" href="#/post/${enc(start.id)}">${me.resume && me.seen ? `تابع: الحلقة ${num(me.resume.episode)}` : "ابدأ من الحلقة الأولى"}</a>` : ""}
        <div class="sq-act3">${me.owner ? `<a class="btn ghost" href="#/series/${enc(s.id)}/edit"><svg class=ix aria-hidden=true><use href=#i-pen /></svg> تعديل</a><a class="btn ghost" href="#/series/${enc(s.id)}/stats"><svg class=ix aria-hidden=true><use href=#i-chart /></svg> الإحصاءات</a>` : signedIn() ? `<button type="button" class="btn ghost sq-follow" id="sq-fl" aria-pressed="${me.following}">${me.following ? "✓ تتابعها" : "＋ تابع"}</button><button type="button" class="btn ghost" id="sq-bl" aria-pressed="${me.notify}" aria-label="إشعارات الحلقات الجديدة" ${me.following ? "" : "hidden"}>${me.notify ? "الإشعارات" : "مكتومة"}</button>` : ""}
          <button type="button" class="btn ghost" id="sq-sh" aria-label="مشاركة السلسلة">↗ مشاركة</button></div></div></section>
      <h3>الحلقات</h3>${eps.length ? `<ol class="sq-eps" aria-label="حلقات السلسلة">${eps.map((x) => `<li><a href="#/post/${enc(x.id)}"><span class="sq-no ${x.status === "scheduled" ? "soon" : x.seen ? "seen" : ""}" aria-hidden="true">${x.status === "scheduled" ? "" : x.seen ? "✓" : x.episode}</span><span class="sq-grow"><span class="t">${h(x.title)}</span><span class="m">${x.status === "scheduled" ? `مجدولة · ${h(dayLabel(x.publishAt, myTz()))} ${clock(x.publishAt)}` : `${TYPE[x.type]?.[0] || "منشور"}${x.readingMin ? ` · ${num(x.readingMin)} د قراءة` : ""} · ${rel(x.createdAt)}${x.reactions ? ` · ${num(x.reactions)}` : ""}`}${x.seen ? " · قرأتها" : ""}</span></span></a></li>`).join("")}</ol>` : `<div class="empty"><b>لا حلقات بعد</b>${me.owner ? `أضف منشوراتك إلى السلسلة من صفحة التعديل.<br><a class="btn" href="#/series/${enc(s.id)}/edit"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>إضافة حلقات</a>` : "ستظهر الحلقات هنا فور نشرها. تابع السلسلة ليصلك إشعار."}</div>`}`;
    $("#sq-sh")?.addEventListener("click", () => share(d.shareUrl, s.title));
    $("#sq-fl")?.addEventListener("click", async (e) => {
      const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true";
      try { const r = await api(on ? "PUT" : "DELETE", `/api/cseries/${enc(s.id)}/follow`); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "✓ تتابعها" : "＋ تابع"; const fc = box.querySelector("[data-fc]"); if (fc) fc.innerHTML = num(r.followers); const bl = $("#sq-bl"); if (bl) { bl.hidden = !on; if (on) { bl.setAttribute("aria-pressed", "true"); bl.textContent = "الإشعارات"; } } say(on ? "تابعت السلسلة — ستصلك الحلقات الجديدة" : "ألغيت المتابعة"); } catch (x) { say(x.message); }
    });
    const wireBell = () => $("#sq-bl")?.addEventListener("click", async (e) => { const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true"; try { await api("PUT", `/api/cseries/${enc(s.id)}/follow`, { notify: on }); b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "الإشعارات" : "مكتومة"; say(on ? "ستصلك الحلقات الجديدة" : "كُتمت الإشعارات وما زلت تتابعها"); } catch (x) { say(x.message); } });
    wireBell();
  }
  async function share(url, title) {
    const full = location.origin + "/" + String(url).replace(/^\/?/, "");
    try { if (navigator.share) { await navigator.share({ title, url: full }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(full); say("نُسخ الرابط"); } catch { prompt("انسخ الرابط", full); }
  }
  async function editView(sid) {
    if (!signedIn()) return needLogin();
    page("تعديل السلسلة", `<div id="sq-ev">${skel(3)}</div>`, ["#/series/" + enc(sid), "صفحة السلسلة"]);
    let d; try { d = await api("GET", "/api/cseries/" + enc(sid)); } catch (e) { if ($("#sq-ev")) $("#sq-ev").innerHTML = errBox(e); return; }
    const box = $("#sq-ev"); if (!box) return;
    if (!d.me.owner) { box.innerHTML = `<div class="empty">هذه السلسلة ليست لك.</div>`; return; }
    const s = d.series; let items = d.items;
    box.innerHTML = `<details class="sq-card" ${s.episodes ? "" : "open"}><summary class="u-mh44 u-dflex u-aic u-cp u-fw8">تفاصيل «${h(s.title)}»</summary><form class="u-mt10 sq-f" id="sq-mf">${seriesFields(s)}<div class="sq-row"><button class="btn" type="submit">حفظ</button><button type="button" class="btn ghost" id="sq-arc">${s.status === "archived" ? "إعادة التفعيل" : "أرشفة"}</button><button type="button" class="u-c-dg btn ghost" id="sq-del">حذف السلسلة</button></div></form></details>
      <h3>الحلقات وترتيبها</h3><p class="sq-sub">استخدم الأسهم لتغيير الترتيب. الحلقات المجدولة تظهر للقراء عند نشرها.</p><div id="sq-el"></div>
      <h3>إضافة حلقات من منشوراتك</h3><div id="sq-cand">${skel(2)}</div>`;
    const drawItems = () => {
      const el = $("#sq-el"); if (!el) return;
      el.innerHTML = items.length ? `<ol class="sq-eps" aria-label="ترتيب الحلقات">${items.map((x, i) => `<li data-p="${h(x.id)}"><span class="sq-no ${x.status === "scheduled" ? "soon" : ""}" aria-hidden="true">${i + 1}</span><span class="sq-grow"><span class="t">${h(x.title)}</span><span class="m">${x.status === "scheduled" ? "مجدولة" : TYPE[x.type]?.[0] || "منشور"}</span></span><span class="sq-mv"><button type="button" data-mv="up" ${i ? "" : "disabled"} aria-label="تقديم «${h(x.title)}»">↑</button><button type="button" data-mv="down" ${i < items.length - 1 ? "" : "disabled"} aria-label="تأخير «${h(x.title)}»">↓</button><button type="button" class="x" data-rm aria-label="إزالة «${h(x.title)}» من السلسلة">✕</button></span></li>`).join("")}</ol>` : `<div class="empty">لا حلقات بعد — أضفها من القائمة أدناه.</div>`;
    };
    drawItems();
    $("#sq-el").addEventListener("click", async (e) => {
      const li = e.target.closest("li[data-p]"), b = e.target.closest("button"); if (!li || !b || b.disabled) return;
      try {
        const r = b.dataset.mv ? await api("PUT", `/api/cseries/${enc(sid)}/order`, { postId: li.dataset.p, move: b.dataset.mv }) : (confirm("إزالة هذه الحلقة من السلسلة؟ (لن يُحذف المنشور)") ? await api("DELETE", `/api/cseries/${enc(sid)}/items/${enc(li.dataset.p)}`) : null);
        if (!r) return; items = r.items; drawItems(); if (b.dataset.mv) $(`#sq-el li[data-p="${CSS.escape(li.dataset.p)}"] [data-mv="${b.dataset.mv}"]:not(:disabled)`)?.focus(); else loadCand();
      } catch (x) { say(x.message); }
    });
    const loadCand = async () => {
      const c = $("#sq-cand"); if (!c) return;
      let r; try { r = await api("GET", `/api/cseries/${enc(sid)}/candidates`); } catch (e) { c.innerHTML = errBox(e); return; }
      c.innerHTML = r.posts.length ? `<ul class="sq-list">${r.posts.map((p) => `<li><span class="sq-ic" aria-hidden="true">${TYPE[p.type]?.[1] || ""}</span><span class="sq-grow"><span class="t">${h(p.title)}</span><span class="m">${p.status === "scheduled" ? "مجدول" : rel(p.at)}${p.inSeries ? ` · سينتقل من «${h(p.inSeries)}»` : ""}</span></span><button type="button" class="u-mh44 btn ghost" data-add="${h(p.id)}"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>إضافة</button></li>`).join("")}</ul>` : `<div class="empty">كل منشوراتك مضافة، أو لا منشورات لديك بعد.</div>`;
      c.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { const r2 = await api("POST", `/api/cseries/${enc(sid)}/items`, { postId: b.dataset.add }); items = r2.items; drawItems(); b.closest("li").remove(); say("✓ أُضيفت الحلقة"); } catch (x) { say(x.message); b.disabled = false; } }));
    };
    loadCand();
    $("#sq-mf").addEventListener("submit", async (e) => { e.preventDefault(); try { await api("PATCH", "/api/cseries/" + enc(sid), readFields(e.target)); mySeries = null; say("✓ حُفظت التفاصيل"); } catch (x) { say(x.message); } });
    $("#sq-arc").addEventListener("click", async () => { try { await api("PATCH", "/api/cseries/" + enc(sid), { status: s.status === "archived" ? "active" : "archived" }); mySeries = null; editView(sid); } catch (x) { say(x.message); } });
    $("#sq-del").addEventListener("click", async () => { if (!confirm("حذف السلسلة؟ تبقى المنشورات كما هي وتُزال من السلسلة فقط.")) return; try { await api("DELETE", "/api/cseries/" + enc(sid)); mySeries = null; location.hash = "#/series"; say("حُذفت السلسلة"); } catch (x) { say(x.message); } });
  }
  async function statsView(sid) {
    if (!signedIn()) return needLogin();
    page("إحصاءات السلسلة", `<div id="sq-st">${skel(3)}</div>`, ["#/series/" + enc(sid), "صفحة السلسلة"]);
    let d; try { d = await api("GET", `/api/cseries/${enc(sid)}/stats`); } catch (e) { if ($("#sq-st")) $("#sq-st").innerHTML = errBox(e); return; }
    const box = $("#sq-st"); if (!box) return;
    const hd = $("#sq-h"); if (hd) hd.textContent = "" + d.series.title;
    const T = d.totals, W = d.followersWeekly, max = Math.max(1, ...W.map((w) => w.value));
    box.innerHTML = `<div class="sq-k"><div><b>${num(T.episodes)}</b><span>حلقات منشورة</span></div><div><b>${num(T.followers)}</b><span>متابعو السلسلة</span></div><div><b>${num(T.views)}</b><span>مشاهدات الحلقات</span></div><div><b>${pc(T.completion)}</b><span>أكملوا حتى آخر حلقة</span></div></div>
      ${d.insight ? `<p class="sq-ins"><svg class=ix aria-hidden=true><use href=#i-bulb /></svg> ${h(d.insight)}</p>` : ""}
      <h3>القراء في كل حلقة</h3>${d.episodes.length ? `<ul class="sq-list sq-ret">${d.episodes.map((e) => `<li><span class="sq-no" aria-hidden="true">${e.episode}</span><a class="sq-grow" href="${h(e.href)}"><span class="t">${h(e.title)}</span><span class="m">${num(e.readers)} قارئ · ${num(e.views)} مشاهدة · ${num(e.reactions)} · ${num(e.comments)}</span></a><b style="font-variant-numeric:tabular-nums">${pc(e.retention)}</b><span class="tr" aria-hidden="true"><i style="width:${Math.max(2, e.retention ?? 0)}%"></i></span></li>`).join("")}</ul><p class="sq-sub">النسبة = قراء الحلقة مقارنة بقراء الحلقة الأولى. اضغط حلقة لتحليلها بالتفصيل.</p>` : `<div class="empty">لا حلقات منشورة بعد.</div>`}
      <h3>متابعون جدد أسبوعياً</h3><figure class="u-my8 sq-card"><svg class="sq-chart" viewBox="0 0 320 120" role="img" aria-label="متابعون جدد في آخر ٨ أسابيع: ${W.map((w) => w.value).join("، ")}">${W.map((w, i) => { const bh = Math.round((w.value / max) * 80); return `<rect x="${12 + i * 38}" y="${92 - bh}" width="26" height="${Math.max(bh, 2)}" rx="5"></rect><text x="${25 + i * 38}" y="112" text-anchor="middle">${w.value}</text>`; }).join("")}</svg><figcaption class="u-m0 u-mt6 sq-sub">آخر ٨ أسابيع، الأحدث على اليسار</figcaption></figure>`;
  }

  /* =================== post page: episode navigation =================== */
  const navCache = new Map();
  function navHtml(n, pid) {
    if (!n?.series) return "";
    return `<nav class="sq-nav" data-csnav="${h(pid)}" aria-label="تنقل السلسلة"><div class="hd"><span class="sq-ic" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-book /></svg></span><a href="#/series/${enc(n.series.id)}"><small>${n.episode ? `الحلقة ${n.episode} من ${n.total}` : "مجدولة"} · ${h(n.series.kindLabel)}</small><b>${h(n.series.title)}</b></a>${!n.owner && signedIn() ? `<button type="button" class="u-mh44 btn ghost sq-follow" data-csf="${h(n.series.id)}" aria-pressed="${n.following}">${n.following ? "✓ تتابعها" : "＋ تابع"}</button>` : ""}</div>
      <div class="sq-pn">${n.prev ? `<a href="#/post/${enc(n.prev.id)}"><small>→ السابقة</small><b>${h(n.prev.title)}</b></a>` : `<span><small>→ السابقة</small><b>بداية السلسلة</b></span>`}${n.next ? `<a class="nx" href="#/post/${enc(n.next.id)}"><small>التالية ←</small><b>${h(n.next.title)}</b></a>` : `<span class="nx"><small>التالية ←</small><b>${n.upcoming ? "قريباً" : "آخر حلقة"}</b></span>`}</div></nav>`;
  }
  function placeNav(pid) {
    const n = navCache.get(pid); if (!n?.series) return;
    const card = view.querySelector(".wrap > .card"); if (!card) return;
    const old = view.querySelector(`[data-csnav]`); const html = navHtml(n, pid);
    if (old) old.outerHTML = html; else card.insertAdjacentHTML("afterend", html);
    view.querySelector("[data-csf]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true";
      try { await api(on ? "PUT" : "DELETE", `/api/cseries/${enc(b.dataset.csf)}/follow`); n.following = on; b.setAttribute("aria-pressed", String(on)); b.textContent = on ? "✓ تتابعها" : "＋ تابع"; say(on ? "تابعت السلسلة" : "ألغيت المتابعة"); } catch (x) { say(x.message); }
    });
  }
  function enhancePost(pid) {
    if (!online()) return;
    if (navCache.has(pid)) placeNav(pid);
    api("GET", "/api/cseries/for-post/" + enc(pid)).then((n) => { navCache.set(pid, n); if (location.hash.split("?")[0] === "#/post/" + pid) placeNav(pid); }).catch(() => { });
  }
  if (typeof Views !== "undefined" && Views.post) { const _post = Views.post; Views.post = function (pid) { const r = _post.apply(this, arguments); try { enhancePost(pid); } catch { /* optional */ } return r; }; }

  /* =================== routes =================== */
  MPRoutes.extend((a, b, base) => {
    const oldSeries = base.series;
    return { scheduled: () => queueView(), drafts: () => draftsView(),
      series: () => (!a ? hubView() : a === "new" ? newView() : /^cs_/.test(a) ? (b === "edit" ? editView(a) : b === "stats" ? statsView(a) : seriesView(a)) : oldSeries ? oldSeries() : hubView()) };
  });
  window.MPSeries = { queueView, draftsView, hubView, seriesView, editView, statsView, zonedToUtc, version: "__APP_VERSION__" };
  if (/^#\/(scheduled|drafts|series)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
  else if (/^#\/post\//.test(location.hash)) enhancePost(location.hash.split("/")[2].split("?")[0]);
})();
