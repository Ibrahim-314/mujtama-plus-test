/* =====================================================================
 * مجتمع بلس — Phase 67 UI: local business directory that accepts Pi (lazy "biz" chunk; 0 bytes in core).
 *   #/biz                  directory: search, category chips with counts, filters (accepts Pi, open now, verified, delivery),
 *                          city / near me, sort; filters update only the results (no full re-render, URL kept in sync)
 *   #/biz/:id              business page: Pi badge, open now, contact actions (hidden from minors), hours, photos,
 *                          reviews (phase 66), claim «هذا نشاطي», report, owner edit
 *   #/biz/new              add a business: storefront (pin on the phase 66 map) or home-based (city only — no address)
 *   #/biz/:id/edit         owner: description, contact, Pi declaration, links, delivery, price, tags, hours
 *   #/biz/mine             my businesses + my claims
 *   #/admin/biz            staff: ownership claims (evidence + contact), approve / reject with a reason
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function BizUI() {
  if (window.MPBiz) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const errBox = (e) => `<div class="empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const num = (x, d = 0) => `<bdi dir="ltr">${Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: d })}</bdi>`;
  const km = (x) => (x === null || x === undefined ? "" : x < 1 ? "أقل من 1 كم" : `${num(x, 1)} كم`);
  const rel = (iso) => (typeof relTime === "function" ? relTime(iso) : "");
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const stars = (n) => `<span class="bz-stars" aria-hidden="true">${"★".repeat(Math.round(n))}<span>${"★".repeat(5 - Math.round(n))}</span></span>`;
  const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  let CFG = null;
  const config = async () => (CFG ||= await api("GET", "/api/biz/config"));
  const page = (title, body, back, sub) => { view.innerHTML = `<div class="wrap bz-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="bz-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div></div></header>${body}</div>`; $("#bz-h")?.focus({ preventScroll: true }); };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel bz-skel"></div>`).join("");
  const piPill = (on, big) => (on ? `<span class="bz-pi${big ? " big" : ""}" title="يقبل الدفع بعملة Pi"><span aria-hidden="true">π</span> يقبل Pi</span>` : "");
  const verified = (on) => (on ? `<span class="bz-ver" title="ملكية موثّقة من المشرفين"><span aria-hidden="true">✓</span> موثّق</span>` : "");
  const openChip = (o) => (o ? `<span class="bz-open ${o.open ? "" : "no"}">${h(o.label)}</span>` : "");

  if (!document.getElementById("bz-css")) document.head.insertAdjacentHTML("beforeend", `<style id="bz-css">
.bz-page{max-width:820px;margin:auto}.bz-page h2:focus{outline:none}.bz-page h3{font-size:16px;font-weight:800;margin:22px 0 8px}
.bz-skel{height:92px;border-radius:var(--r);margin:8px 0}.bz-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.bz-row .btn{min-height:44px}.bz-grow{flex:1;min-width:0}
.bz-count{font-size:var(--fs-sm);color:var(--muted);margin:10px 2px 4px;display:flex;gap:8px;align-items:center;justify-content:space-between}
.bz-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:8px}.bz-it a{display:grid;grid-template-columns:72px 1fr;gap:12px;padding:10px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);color:var(--text);text-decoration:none;min-height:44px;transition:border-color .15s}.bz-it a:hover{border-color:var(--accent)}
.bz-th{width:72px;height:72px;border-radius:var(--r-sm);background:var(--accent-soft);color:var(--accent-ink);display:grid;place-items:center;overflow:hidden}.bz-top{gap:8px;margin:0 0 var(--s3)}.bz-th img{width:100%;height:100%;object-fit:cover}
.bz-it .nm{display:flex;gap:6px;align-items:center;min-width:0}.bz-it .nm b{font-size:15.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bz-it .m{font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bz-it .tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:6px}
.bz-pi{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-xs);font-weight:800;padding:2px 10px;border-radius:999px;background:color-mix(in srgb,var(--warn) 22%,transparent);color:color-mix(in srgb,var(--warn) 50%,var(--text));white-space:nowrap}.bz-pi span{font-family:serif;font-size:14px;line-height:1}.bz-pi.big{font-size:14px;padding:6px 14px}
.bz-ver{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;font-weight:700;padding:1px 8px;border-radius:999px;background:var(--accent2);color:var(--accent-ink);white-space:nowrap;flex:none}
.bz-open{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-xs);font-weight:600;padding:2px 10px;border-radius:999px;background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok) 55%,var(--text));white-space:nowrap}.bz-open.no{background:color-mix(in srgb,var(--danger) 13%,transparent);color:color-mix(in srgb,var(--danger) 65%,var(--text))}.bz-open::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.bz-stars{color:var(--warn);letter-spacing:1px;font-size:var(--fs-sm)}.bz-stars span{color:var(--line-2)}.bz-rt{font-size:12.5px;color:var(--text-2);display:inline-flex;gap:4px;align-items:center}
.bz-hero{border-radius:var(--r-lg);overflow:hidden;border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:10px 0}.bz-cv{height:150px;background:var(--hero-grad);color:var(--white);display:grid;place-items:center;position:relative}.bz-cv .ic.lg{width:56px;height:56px;opacity:.85}.bz-cv img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.bz-hero .bd{padding:12px 16px 16px}.bz-hero h1{margin:0;font-size:22px;line-height:1.35;font-weight:800;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.bz-hero .m{font-size:13.5px;color:var(--text-2);margin:4px 0 8px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.bz-acts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:12px 0 4px}.bz-acts a,.bz-acts button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:64px;padding:6px 4px;border-radius:var(--r-sm);background:var(--bg-2);border:0;color:var(--text);font-size:12.5px;font-weight:700;text-decoration:none;cursor:pointer;text-align:center}.bz-acts .i{font-size:var(--fs-xl);line-height:1}.bz-acts [aria-pressed="true"]{background:var(--accent2);color:var(--accent-ink)}
.bz-pibox{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:var(--r);border:1px solid color-mix(in srgb,var(--warn) 40%,var(--line));background:color-mix(in srgb,var(--warn) 8%,var(--card));margin:10px 0;line-height:1.7}.bz-pibox .ic{font-family:serif;font-size:30px;line-height:1;width:44px;height:44px;flex:none;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--warn) 22%,transparent);color:color-mix(in srgb,var(--warn) 45%,var(--text))}.bz-pibox small{display:block;color:var(--muted);font-size:12.5px}
.bz-pibox.dis{border-color:color-mix(in srgb,var(--danger) 35%,var(--line));background:color-mix(in srgb,var(--danger) 6%,var(--card))}.bz-pibox.dis .ic{background:color-mix(in srgb,var(--danger) 14%,transparent);color:color-mix(in srgb,var(--danger) 60%,var(--text))}
.bz-card{padding:14px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:8px 0}.bz-note{padding:12px 14px;border-radius:var(--r-sm);background:var(--bg-2);color:var(--text-2);font-size:14px;line-height:1.7;margin:10px 0}
.bz-hours{width:100%;border-collapse:collapse;font-size:14px}.bz-hours td{padding:8px 4px;border-bottom:1px solid var(--line);color:var(--text-2)}.bz-hours tr:last-child td{border-bottom:0}.bz-hours tr.today td{font-weight:700;color:var(--accent-ink)}.bz-hours td:last-child{text-align:end}
.bz-ph{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 0}.bz-ph img{flex:none;width:min(70vw,240px);height:160px;object-fit:cover;border-radius:var(--r);scroll-snap-align:start;background:var(--bg-2)}
.bz-rate{display:flex;gap:16px;align-items:center;padding:14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1);margin:8px 0}.bz-rate .big{font-size:36px;font-weight:800;line-height:1}.bz-rate ul{list-style:none;padding:0;margin:0;flex:1}.bz-rate li{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--muted)}.bz-rate .tr{flex:1;height:6px;border-radius:4px;background:var(--bg-2);overflow:hidden}.bz-rate .tr i{display:block;height:100%;background:var(--warn)}
.bz-rv{padding:12px 0;border-bottom:1px solid var(--line)}.bz-rv:last-child{border-bottom:0}.bz-rv p{margin:6px 0 0;line-height:1.75;color:var(--text-2)}.bz-rv .who{display:flex;gap:8px;align-items:center;font-size:var(--fs-sm)}
.bz-starpick{display:flex;gap:2px}.bz-starpick button{min-width:44px;min-height:44px;font-size:26px;border:0;background:none;color:var(--line-2);cursor:pointer}.bz-starpick button.on{color:var(--warn)}
.bz-f{display:flex;flex-direction:column;gap:10px}.bz-f label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--text-2)}.bz-f input,.bz-f select,.bz-f textarea{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}.bz-f textarea{min-height:96px;line-height:1.7}.bz-f fieldset{border:1px solid var(--line);border-radius:var(--r);padding:12px 14px;margin:0;display:flex;flex-direction:column;gap:10px}.bz-f legend{font-weight:800;padding:0 6px;color:var(--text)}
.bz-two{display:grid;grid-template-columns:1fr;gap:10px}@media(min-width:520px){.bz-two{grid-template-columns:1fr 1fr}}
.bz-chk{flex-direction:row !important;align-items:center;gap:10px !important;min-height:44px;font-weight:600}.bz-chk input{width:22px !important;height:22px;min-height:0 !important;flex:none}
.bz-seg,.bz-f fieldset.bz-seg{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;background:var(--bg-2);border-radius:999px;border:0 !important}.bz-seg legend{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.bz-seg label{flex-direction:row !important;justify-content:center;align-items:center;min-height:44px;border-radius:999px;cursor:pointer;font-size:14px}.bz-seg input{position:absolute;opacity:0;width:1px !important;height:1px}.bz-seg label:has(input:checked){background:var(--card);color:var(--accent-ink);box-shadow:var(--sh-1)}.bz-seg label:has(input:focus-visible){outline:2px solid var(--accent)}
.bz-wk{display:grid;grid-template-columns:auto 1fr 1fr auto;gap:6px 8px;align-items:center;font-size:var(--fs-sm)}.bz-wk input[type=time]{min-height:44px}.bz-wk label{flex-direction:row !important;align-items:center;gap:4px !important;font-size:12.5px;font-weight:600}.bz-wk label input{width:20px !important;min-height:0 !important}
.bz-cl{display:flex;flex-direction:column;gap:6px}.bz-cl blockquote{margin:6px 0;padding:8px 12px;border-inline-start:3px solid var(--accent);background:var(--bg-2);border-radius:var(--r-xs);line-height:1.7;white-space:pre-wrap}
.bz-st{display:inline-block;font-size:var(--fs-xs);font-weight:600;padding:2px 10px;border-radius:999px;background:var(--bg-2);color:var(--text-2)}.bz-st.pending{background:color-mix(in srgb,var(--warn) 18%,transparent);color:color-mix(in srgb,var(--warn) 55%,var(--text))}.bz-st.rejected,.bz-st.withdrawn{background:color-mix(in srgb,var(--danger) 14%,transparent);color:color-mix(in srgb,var(--danger) 65%,var(--text))}.bz-st.approved{background:color-mix(in srgb,var(--ok) 16%,transparent);color:color-mix(in srgb,var(--ok) 55%,var(--text))}
.bz-ul{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.bz-ul li{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--line);min-height:56px;flex-wrap:wrap}.bz-ul li:last-child{border-bottom:0}.bz-ul a{color:inherit;text-decoration:none}
.bz-rep>summary,.bz-claim>summary{list-style:none;min-height:44px;display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700}.bz-rep>summary::-webkit-details-marker,.bz-claim>summary::-webkit-details-marker{display:none}.bz-radios{display:flex;flex-direction:column;gap:2px}.bz-radios label{flex-direction:row !important;align-items:center;gap:10px !important;min-height:44px;font-weight:500 !important}.bz-radios input{width:20px !important;min-height:0 !important;flex:none}
</style>`);

  /* =================== #/biz =================== */
  const F = { q: "", category: "", pi: false, open: false, verified: false, delivery: false, city: "", sort: "", near: false };
  function readUrl() { const p = qs(); Object.assign(F, { q: p.get("q") || "", category: p.get("category") || "", pi: p.get("pi") === "1", open: p.get("open") === "1", verified: p.get("verified") === "1", delivery: p.get("delivery") === "1", city: p.get("city") || "", sort: p.get("sort") || "", near: p.get("near") === "1" }); }
  function params() { const p = new URLSearchParams(); if (F.q) p.set("q", F.q); if (F.category) p.set("category", F.category); for (const k of ["pi", "open", "verified", "delivery", "near"]) if (F[k]) p.set(k, "1"); if (F.city) p.set("city", F.city); if (F.sort) p.set("sort", F.sort); return p; }
  const syncUrl = () => { const s = params().toString(); history.replaceState(history.state, "", "#/biz" + (s ? "?" + s : "")); };
  function itemHtml(x) {
    return `<li class="bz-it"><a href="#/biz/${enc(x.id)}"><span class="bz-th">${x.thumb ? `<img src="${h(x.thumb)}" alt="" loading="lazy">` : `<svg class="ic" aria-hidden="true"><use href="#i-store"/></svg>`}</span>
      <span class="u-mw0"><span class="nm"><b>${h(x.name)}</b>${verified(x.verified)}</span><span class="m">${h(x.categoryLabel)}${x.homeBased ? " · نشاط منزلي" : ""}${x.city ? ` · ${h(x.city)}` : ""}${x.distanceKm !== null && x.distanceKm !== undefined ? ` · ${km(x.distanceKm)}` : ""}</span>
      <span class="tags">${piPill(x.acceptsPi)}${x.rating.count ? `<span class="bz-rt">${stars(x.rating.avg)} ${num(x.rating.avg, 1)} <span class="u-c-mu">· ${num(x.rating.count)}</span></span>` : ""}${openChip(x.open)}${x.delivery ? `<span class="bz-st"><svg class=ix aria-hidden=true><use href=#i-truck /></svg> توصيل</span>` : ""}</span></span></a></li>`;
  }
  let seq = 0;
  async function loadResults() {
    const my = ++seq, box = $("#bz-r"); if (!box) return;
    box.setAttribute("aria-busy", "true"); box.style.opacity = ".55";
    let r; try { r = await api("GET", "/api/biz?" + params()); } catch (e) { if (my === seq && $("#bz-r")) { box.innerHTML = errBox(e); box.style.opacity = ""; } return; }
    if (my !== seq || !$("#bz-r")) return;
    box.removeAttribute("aria-busy"); box.style.opacity = "";
    const cfg = await config();
    const chips = $("#bz-cats");
    if (chips) chips.innerHTML = `<button type="button" data-cat="" aria-pressed="${!F.category}">الكل</button>${cfg.categories.map((c) => { const n = r.facets.find((f) => f.key === c.key)?.n; return n || F.category === c.key ? `<button type="button" data-cat="${c.key}" aria-pressed="${F.category === c.key}">${h(c.label)}${n ? ` <span class="n">${num(n)}</span>` : ""}</button>` : ""; }).join("")}`;
    box.innerHTML = `<p class="bz-count" aria-live="polite"><span>${r.total ? `${num(r.total)} ${r.total === 1 ? "نشاط" : "نشاطاً"}${r.city ? ` في ${h(r.city)}` : r.center ? ` حول ${h(r.center.label || "موقعك")}` : ""}` : "لا نتائج"}</span>${r.piCount ? `<span>${piPill(true)} ${num(r.piCount)}</span>` : ""}</p>
      ${r.items.length ? `<ul class="bz-list">${r.items.map(itemHtml).join("")}</ul>` : `<div class="empty"><b>لم نجد أنشطة بهذه المواصفات</b>جرّب إزالة بعض الفلاتر أو اختيار مدينة أخرى — أو أضف نشاطاً تعرفه ليستفيد غيرك.<br><a class="btn" href="#/biz/new">أضف نشاطاً</a></div>`}`;
  }
  async function listView() {
    readUrl();
    page("أعمال محلية تقبل Pi", `<div class="bz-row bz-top"><a class="btn sm" href="#/biz/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>أضف نشاطك</a>${signed() ? `<a class="btn outline sm" href="#/biz/mine"><svg class=ix aria-hidden=true><use href=#i-store /></svg>أنشطتي</a>` : ""}</div>
      <form class="bz-search fx-host" id="bz-sf" role="search"><input type="search" name="q" value="${h(F.q)}" maxlength="60" placeholder="ابحث: مطعم، قهوة، صيانة جوالات…" aria-label="ابحث في الدليل"><button class="btn" aria-label="بحث"><svg class=ix aria-hidden=true><use href=#i-search /></svg></button></form>
      <div class="bz-chips f-chips" id="bz-cats" role="group" aria-label="التصنيف"></div>
      <div class="bz-chips f-chips" id="bz-fl" role="group" aria-label="فلاتر"><button type="button" data-f="pi" aria-pressed="${F.pi}"><span aria-hidden="true" style="font-family:serif">π</span> يقبل Pi</button><button type="button" data-f="open" aria-pressed="${F.open}">مفتوح الآن</button><button type="button" data-f="verified" aria-pressed="${F.verified}">✓ موثّق</button><button type="button" data-f="delivery" aria-pressed="${F.delivery}">توصيل</button></div>
      <div class="bz-bar fx-form"><label>المدينة<select id="bz-city"><option value="">كل المدن</option><option value="@near" ${F.near ? "selected" : ""}>حولي (تقريبي)</option></select></label><label>الترتيب<select id="bz-sort"><option value="">تلقائي</option><option value="distance" ${F.sort === "distance" ? "selected" : ""}>الأقرب</option><option value="rating" ${F.sort === "rating" ? "selected" : ""}>الأعلى تقييماً</option><option value="new" ${F.sort === "new" ? "selected" : ""}>الأحدث</option></select></label></div>
      <div id="bz-r">${skel(4)}</div>`, null, "«يقبل Pi» تصريح من صاحب النشاط؛ علامة «موثّق» تعني أن المشرفين راجعوا ملكيته.");
    config().then((c) => { const sel = $("#bz-city"); if (!sel) return; sel.insertAdjacentHTML("beforeend", c.cities.map((x) => `<option ${x === F.city ? "selected" : ""}>${h(x)}</option>`).join("")); }).catch(() => { });
    { const sf = $("#bz-sf"); if (sf && window.MPFeat) MPFeat.filters({ host: sf, move: [$("#bz-fl"), view.querySelector(".bz-bar")] }); }
    $("#bz-sf").addEventListener("submit", (e) => { e.preventDefault(); F.q = e.target.q.value.trim(); syncUrl(); loadResults(); });
    $("#bz-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (!b) return; F.category = b.dataset.cat; view.querySelectorAll("#bz-cats [data-cat]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); syncUrl(); loadResults(); });
    $("#bz-fl").addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (!b) return; F[b.dataset.f] = !F[b.dataset.f]; b.setAttribute("aria-pressed", String(F[b.dataset.f])); syncUrl(); loadResults(); });
    $("#bz-city").addEventListener("change", (e) => { const v = e.target.value; F.near = v === "@near"; F.city = F.near ? "" : v; syncUrl(); loadResults(); });
    $("#bz-sort").addEventListener("change", (e) => { F.sort = e.target.value; syncUrl(); loadResults(); });
    loadResults();
  }

  /* =================== #/biz/:id =================== */
  async function bizView(id) {
    page("…", `<div id="bz-p">${skel(3)}</div>`, ["#/biz", "دليل الأعمال"]);
    let d; try { d = await api("GET", "/api/biz/" + enc(id)); } catch (e) { if ($("#bz-p")) $("#bz-p").innerHTML = errBox(e); return; }
    const box = $("#bz-p"); if (!box) return;
    const p = d.place, b = d.business, R = p.rating || { avg: 0, count: 0, dist: [0, 0, 0, 0, 0] }, today = new Date().getDay();
    const hd = $("#bz-h"); if (hd) { hd.textContent = p.name; hd.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"; }
    const c = b.contact || {}, live = p.status === "approved";
    const acts = [];
    if (c.phone) acts.push(`<a href="tel:${h(c.phone.replace(/[^\d+]/g, ""))}"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-phone /></svg></span>اتصال</a>`);
    if (c.whatsapp) acts.push(`<a href="https://wa.me/${h(c.whatsapp.replace(/[^\d]/g, ""))}" target="_blank" rel="noopener"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-comment /></svg></span>واتساب</a>`);
    if (c.website) acts.push(`<a href="${h(c.website)}" target="_blank" rel="noopener"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-globe /></svg></span>الموقع</a>`);
    if (b.menuUrl) acts.push(`<a href="${h(b.menuUrl)}" target="_blank" rel="noopener"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-doc /></svg></span>القائمة</a>`);
    if (b.catalog) acts.push(`<a href="${h(b.catalog.href)}"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-bag /></svg></span>المتجر (${num(b.catalog.listings)})</a>`);
    if (c.instagram) acts.push(`<a href="https://instagram.com/${h(c.instagram)}" target="_blank" rel="noopener"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-camera /></svg></span>إنستغرام</a>`);
    if (c.email) acts.push(`<a href="mailto:${h(c.email)}"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-mail /></svg></span>بريد</a>`);
    if (!b.homeBased && p.lat !== null && live) acts.push(`<a href="https://www.openstreetmap.org/?mlat=${p.lat}&amp;mlon=${p.lng}#map=17/${p.lat}/${p.lng}" target="_blank" rel="noopener"><span class="i" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-compass /></svg></span>الاتجاهات</a>`);
    if (live && signed()) acts.push(`<button type="button" id="bz-save" aria-pressed="${!!p.saved}"><span class="i" aria-hidden="true"><svg class="ic sm"><use href="#i-${p.saved ? "bookmarkF" : "bookmark"}"/></svg></span>${p.saved ? "محفوظ" : "حفظ"}</button>`);
    acts.push(`<button type="button" id="bz-share"><span class="i" aria-hidden="true">↗</span>مشاركة</button>`);
    box.innerHTML = `${!live ? `<div class="bz-note"><span class="bz-st pending">${p.status === "pending" ? "بانتظار مراجعة المشرفين" : p.status === "rejected" ? "مرفوض" : "مخفي للمراجعة"}</span>${p.reviewNote ? ` — ${h(p.reviewNote)}` : " — يظهر في الدليل بعد الموافقة."}</div>` : ""}
      <section class="bz-hero" aria-labelledby="bz-t"><div class="bz-cv">${p.photos?.[0] ? `<img src="${h(p.photos[0].url)}" alt="${h(p.photos[0].caption || p.name)}">` : `<svg class="ic lg" aria-hidden="true"><use href="#i-store"/></svg>`}</div>
        <div class="bd"><h1 id="bz-t">${h(p.name)} ${verified(b.verified)}</h1>
          <div class="m"><span>${h(b.categoryLabel)}</span>${b.homeBased ? `<span><svg class=ix aria-hidden=true><use href=#i-home /></svg> نشاط منزلي · ${h(p.city || "")}</span>` : p.city ? `<span><svg class=ix aria-hidden=true><use href=#i-mapPin /></svg> ${h(p.city)}</span>` : ""}${R.count ? `<span class="bz-rt">${stars(R.avg)} ${num(R.avg, 1)} · ${num(R.count)} تقييم</span>` : ""}${b.priceLevel ? `<span>· ${["اقتصادي", "متوسط السعر", "مرتفع السعر", "فاخر"][b.priceLevel - 1]}</span>` : ""}</div>
          <div class="u-my6 bz-row">${openChip(p.openNow)}${b.delivery ? `<span class="bz-st"><svg class=ix aria-hidden=true><use href=#i-truck /></svg> توصيل</span>` : ""}${b.onlineOnly ? `<span class="bz-st"><svg class=ix aria-hidden=true><use href=#i-globe /></svg> أونلاين</span>` : ""}${b.tags.map((t) => `<span class="bz-st">#${h(t)}</span>`).join("")}</div>
          ${b.owner ? `<p class="u-m0 u-mt4 bz-sub">يديره <a href="#/u/${enc(b.owner.handle)}" style="color:var(--accent-ink);font-weight:700">${h(b.owner.name)}</a></p>` : ""}
          <div class="bz-acts">${acts.join("")}</div>${b.minorView ? `<p class="bz-sub"><svg class=ix aria-hidden=true><use href=#i-shield /></svg> تُخفى أرقام التواصل المباشر لحسابات من هم دون ١٨ عاماً حفاظاً على سلامتهم.</p>` : ""}</div></section>
      ${b.piDeclared ? `<div class="bz-pibox${b.piDisputed ? " dis" : ""}"><span class="ic" aria-hidden="true">π</span><div>${b.piDisputed ? `<b>قبول Pi قيد المراجعة</b><small>أبلغ أعضاء أن هذا النشاط لا يقبل Pi فعلياً. نراجع البلاغات مع صاحبه.</small>` : `<b>يقبل الدفع بعملة Pi</b>${b.piNote ? `<div>${h(b.piNote)}</div>` : ""}<small>${b.verified ? "تصريح من صاحب نشاط موثّق." : "تصريح من صاحب النشاط — لم تُوثَّق الملكية بعد."} تأكد من السعر قبل الدفع.</small>`}</div></div>` : ""}
      ${p.descr ? `<h3>عن النشاط</h3><p style="line-height:1.85;color:var(--text-2);white-space:pre-wrap;margin:0">${h(p.descr)}</p>` : ""}
      ${!b.homeBased && p.address ? `<p class="u-mt8 bz-sub"><svg class=ix aria-hidden=true><use href=#i-mapPin /></svg> ${h(p.address)}</p>` : ""}
      ${p.hoursTable ? `<h3>ساعات العمل</h3><div class="bz-card" style="padding:4px 14px"><table class="bz-hours"><tbody>${p.hoursTable.map((r, i) => `<tr class="${i === today ? "today" : ""}"><td>${r.day}${i === today ? " (اليوم)" : ""}</td><td><bdi dir="ltr">${h(r.hours)}</bdi></td></tr>`).join("")}</tbody></table></div>` : ""}
      ${p.photos?.length > 1 ? `<h3>الصور</h3><div class="bz-ph">${p.photos.slice(1).map((x) => `<img src="${h(x.url)}" alt="${h(x.caption || "صورة من " + p.name)}" loading="lazy">`).join("")}</div>` : ""}
      ${live ? `<h3>التقييمات</h3>${R.count ? `<div class="bz-rate"><div class="u-tc"><div class="big">${num(R.avg, 1)}</div>${stars(R.avg)}<div class="u-m0 u-mt2 bz-sub">${num(R.count)} تقييم</div></div><ul>${[5, 4, 3, 2, 1].map((n) => `<li><span>${n}</span><span class="tr"><i style="width:${R.count ? Math.round((R.dist[n - 1] / R.count) * 100) : 0}%"></i></span></li>`).join("")}</ul></div>` : `<p class="bz-sub">لا تقييمات بعد — كن أول من يقيّم.</p>`}
        ${signed() && !b.mine && !p.mine && b.myClaim?.status !== "pending" ? `<form class="bz-card bz-f" id="bz-rf"><b>${p.myReview ? "تقييمك" : "قيّم هذا النشاط"}</b><div class="bz-starpick" role="radiogroup" aria-label="عدد النجوم">${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-s="${n}" aria-checked="${p.myReview?.rating === n}" aria-label="${n} من 5" class="${(p.myReview?.rating || 0) >= n ? "on" : ""}">★</button>`).join("")}</div><label>رأيك (اختياري)<textarea name="text" maxlength="500" placeholder="جودة الخدمة، الأسعار، هل الدفع بـ Pi سهل؟">${h(p.myReview?.text || "")}</textarea></label><div class="bz-row"><button class="btn">${p.myReview ? "تحديث التقييم" : "نشر التقييم"}</button></div></form>` : ""}
        <div id="bz-rvs">${(p.reviews || []).map((r) => `<div class="bz-rv"><div class="who"><b>${h(r.author.name)}</b>${stars(r.rating)}<span class="u-m0 bz-sub">${rel(r.at)}</span></div><p>${h(r.text)}</p></div>`).join("")}</div>` : ""}
      ${b.canEdit ? `<div class="u-mt18 bz-row"><a class="btn" href="#/biz/${enc(id)}/edit"><svg class=ix aria-hidden=true><use href=#i-pen /></svg> تعديل ملف النشاط</a></div>` : ""}
      ${b.myClaim?.status === "pending" ? `<div class="bz-card"><span class="bz-st pending">طلب الإدارة قيد المراجعة</span><p class="u-my6 bz-sub">أرسلت طلباً لإدارة هذا النشاط ${rel(b.myClaim.at)}. سيصلك إشعار بالقرار.</p><button type="button" class="btn ghost" id="bz-wd">سحب الطلب</button></div>` : ""}
      ${b.myClaim?.status === "rejected" ? `<div class="bz-note"><span class="bz-st rejected">رُفض طلبك السابق</span>${b.myClaim.note ? ` — ${h(b.myClaim.note)}` : ""}</div>` : ""}
      ${b.canClaim && live ? `<details class="bz-card bz-claim"><summary><svg class=ix aria-hidden=true><use href=#i-tag /></svg> هل هذا نشاطك؟ اطلب إدارته</summary><form class="u-mt8 bz-f" id="bz-cf"><p class="bz-sub">يراجع المشرفون طلبك. ما تكتبه هنا لا يظهر للعامة.</p><label>صفتك<select name="role"><option value="owner">المالك</option><option value="manager">مدير مفوّض</option></select></label><label>كيف نتحقق؟<textarea name="evidence" required minlength="10" maxlength="500" placeholder="مثال: رقم السجل التجاري، أو أضف رمز التحقق في حسابنا على إنستغرام…"></textarea></label><label>وسيلة تواصل للمشرفين (اختياري)<input name="contact" maxlength="120" placeholder="رقم أو بريد العمل"></label><div class="bz-row"><button class="btn">إرسال الطلب</button></div></form></details>` : ""}
      ${live && signed() && !b.mine && !p.mine ? `<details class="bz-card bz-rep"><summary><svg class=ix aria-hidden=true><use href=#i-flag /></svg> الإبلاغ عن مشكلة</summary><form class="u-mt8 bz-f" id="bz-rp"><div class="bz-radios" role="radiogroup" aria-label="سبب البلاغ">${Object.entries(d.reasons || {}).map(([k, v]) => `<label><input type="radio" name="reason" value="${k}"> ${h(v)}</label>`).join("")}</div><label>تفاصيل (اختياري)<input name="note" maxlength="300"></label><div class="bz-row"><button class="btn ghost">إرسال البلاغ</button></div></form></details>` : ""}`;
    $("#bz-share")?.addEventListener("click", async () => { const full = location.origin + "/" + d.shareUrl.replace(/^\//, ""); try { if (navigator.share) { await navigator.share({ title: p.name, url: full }); return; } } catch { return; } try { await navigator.clipboard.writeText(full); say("نُسخ الرابط"); } catch { prompt("انسخ الرابط", full); } });
    $("#bz-save")?.addEventListener("click", async (e) => { const btn = e.currentTarget, on = btn.getAttribute("aria-pressed") !== "true"; try { await api(on ? "PUT" : "DELETE", `/api/places/${enc(id)}/save`); btn.setAttribute("aria-pressed", String(on)); btn.innerHTML = `<span class="i" aria-hidden="true"><svg class="ic sm"><use href="#i-${on ? "bookmarkF" : "bookmark"}"/></svg></span>${on ? "محفوظ" : "حفظ"}`; say(on ? "حُفظ في أماكنك" : "أُزيل من المحفوظات"); } catch (x) { say(x.message); } });
    let rating = p.myReview?.rating || 0;
    view.querySelectorAll(".bz-starpick [data-s]").forEach((s) => s.addEventListener("click", () => { rating = +s.dataset.s; view.querySelectorAll(".bz-starpick [data-s]").forEach((x) => { x.classList.toggle("on", +x.dataset.s <= rating); x.setAttribute("aria-checked", String(+x.dataset.s === rating)); }); }));
    $("#bz-rf")?.addEventListener("submit", async (e) => { e.preventDefault(); if (!rating) return say("اختر عدد النجوم"); try { await api("POST", `/api/places/${enc(id)}/reviews`, { rating, text: e.target.text.value.trim() }); say("✓ شكراً على تقييمك"); bizView(id); } catch (x) { say(x.message); } });
    $("#bz-cf")?.addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { await api("POST", `/api/biz/${enc(id)}/claim`, { role: f.role.value, evidence: f.evidence.value.trim(), contact: f.contact.value.trim() }); say("✓ أُرسل الطلب للمراجعة"); bizView(id); } catch (x) { say(x.message); } });
    $("#bz-wd")?.addEventListener("click", async () => { if (!confirm("سحب طلب الإدارة؟")) return; try { await api("DELETE", "/api/biz/claims/" + enc(b.myClaim.id)); bizView(id); } catch (x) { say(x.message); } });
    $("#bz-rp")?.addEventListener("submit", async (e) => { e.preventDefault(); const r = e.target.querySelector("input[name=reason]:checked"); if (!r) return say("اختر سبب البلاغ"); try { const x = await api("POST", `/api/places/${enc(id)}/report`, { reason: r.value, note: e.target.note.value.trim() }); e.target.closest("details").outerHTML = `<p class="bz-note">${x.duplicate ? "أبلغت عن هذا النشاط سابقاً." : "شكراً — وصل بلاغك للمشرفين."}</p>`; } catch (x) { say(x.message); } });
  }

  /* =================== forms =================== */
  function hoursEditor(week) {
    return `<fieldset><legend><svg class=ix aria-hidden=true><use href=#i-clock /></svg> ساعات العمل <span class="bz-sub" style="font-weight:400">(تُظهر «مفتوح الآن»)</span></legend><label class="bz-chk"><input type="checkbox" id="bz-wk-on" ${week ? "checked" : ""}> تحديد الساعات لكل يوم</label>
      <div id="bz-wk" ${week ? "" : "hidden"}><div class="bz-wk">${DAYS.map((dn, i) => { const x = week?.[i]; const closed = week && x === null; return `<span>${dn}</span><input type="time" data-wo="${i}" value="${x ? x[0] : "09:00"}" aria-label="يفتح ${dn}" ${closed ? "disabled" : ""}><input type="time" data-wc="${i}" value="${x ? x[1] : "22:00"}" aria-label="يغلق ${dn}" ${closed ? "disabled" : ""}><label><input type="checkbox" data-wx="${i}" ${closed ? "checked" : ""}> مغلق</label>`; }).join("")}</div><button type="button" class="u-mt8 u-mh44 btn ghost" id="bz-wk-copy">نسخ ساعات الأحد لكل الأيام</button></div></fieldset>`;
  }
  function wireHours() {
    $("#bz-wk-on")?.addEventListener("change", (e) => { $("#bz-wk").hidden = !e.target.checked; });
    view.querySelectorAll("[data-wx]").forEach((x) => x.addEventListener("change", () => { const i = x.dataset.wx; $(`[data-wo="${i}"]`).disabled = $(`[data-wc="${i}"]`).disabled = x.checked; }));
    $("#bz-wk-copy")?.addEventListener("click", () => { for (let i = 1; i < 7; i++) { $(`[data-wo="${i}"]`).value = $('[data-wo="0"]').value; $(`[data-wc="${i}"]`).value = $('[data-wc="0"]').value; const x = $(`[data-wx="${i}"]`); x.checked = $('[data-wx="0"]').checked; x.dispatchEvent(new Event("change")); } say("نُسخت الساعات"); });
  }
  const readHours = () => ($("#bz-wk-on")?.checked ? DAYS.map((_, i) => ($(`[data-wx="${i}"]`).checked ? null : [$(`[data-wo="${i}"]`).value, $(`[data-wc="${i}"]`).value])) : null);
  function contactFields(b = {}) {
    const c = b.contact || {};
    return `<fieldset><legend><span style="font-family:serif">π</span> الدفع بعملة Pi</legend><label class="bz-chk"><input type="checkbox" name="acceptsPi" ${b.piDeclared ? "checked" : ""}> نقبل الدفع بـ Pi</label><label>ملاحظة للعملاء (اختياري)<input name="piNote" maxlength="140" value="${h(b.piNote || "")}" placeholder="مثال: خصم ٥٪ عند الدفع بـ Pi"></label></fieldset>
      <fieldset><legend><svg class=ix aria-hidden=true><use href=#i-phone /></svg> التواصل والروابط</legend><div class="bz-two"><label>هاتف<input name="phone" type="tel" dir="ltr" maxlength="24" value="${h(c.phone || "")}" placeholder="+966 5x xxx xxxx"></label><label>واتساب<input name="whatsapp" type="tel" dir="ltr" maxlength="24" value="${h(c.whatsapp || "")}" placeholder="+9665xxxxxxxx"></label></div>
        <div class="bz-two"><label>الموقع الإلكتروني<input name="website" type="url" dir="ltr" maxlength="300" value="${h(c.website || "")}" placeholder="https://"></label><label>إنستغرام<input name="instagram" dir="ltr" maxlength="40" value="${h(c.instagram || "")}" placeholder="@account"></label></div>
        <div class="bz-two"><label>البريد<input name="email" type="email" dir="ltr" maxlength="120" value="${h(c.email || "")}"></label><label>رابط القائمة أو الكتالوج<input name="menuUrl" type="url" dir="ltr" maxlength="300" value="${h(b.menuUrl || "")}" placeholder="https://"></label></div>
        <p class="u-m0 bz-sub"><svg class=ix aria-hidden=true><use href=#i-bulb /></svg> منتجاتك المعروضة في سوق مجتمع بلس تظهر تلقائياً في صفحة النشاط بعد توثيق الملكية.</p></fieldset>
      <fieldset><legend><svg class=ix aria-hidden=true><use href=#i-doc /></svg> تفاصيل</legend><label class="bz-chk"><input type="checkbox" name="delivery" ${b.delivery ? "checked" : ""}> نوفّر التوصيل</label><label class="bz-chk"><input type="checkbox" name="onlineOnly" ${b.onlineOnly ? "checked" : ""}> نخدم أونلاين فقط</label>
        <div class="bz-two"><label>مستوى الأسعار<select name="priceLevel"><option value="">—</option>${[1, 2, 3, 4].map((n) => `<option value="${n}" ${b.priceLevel === n ? "selected" : ""}>${"$".repeat(n)} ${["اقتصادي", "متوسط", "مرتفع", "فاخر"][n - 1]}</option>`).join("")}</select></label><label>كلمات مفتاحية<input name="tags" maxlength="200" value="${h((b.tags || []).join("، "))}" placeholder="قهوة مختصة، واي فاي"></label></div></fieldset>`;
  }
  const readContact = (f) => ({ acceptsPi: f.acceptsPi.checked, piNote: f.piNote.value.trim(), phone: f.phone.value.trim(), whatsapp: f.whatsapp.value.trim(), website: f.website.value.trim(), instagram: f.instagram.value.trim(), email: f.email.value.trim(), menuUrl: f.menuUrl.value.trim(), delivery: f.delivery.checked, onlineOnly: f.onlineOnly.checked, priceLevel: f.priceLevel.value ? +f.priceLevel.value : null, tags: f.tags.value });
  async function newView() {
    if (!signed()) { page("أضف نشاطك", `<div class="empty">سجّل الدخول لإضافة نشاط تجاري.</div>`, ["#/biz", "دليل الأعمال"]); return; }
    const cfg = await config().catch(() => ({ categories: [], cities: [] }));
    page("＋ أضف نشاطاً تجارياً", `<div class="bz-note"><svg class=ix aria-hidden=true><use href=#i-shield /></svg> لا نعرض عناوين المنازل. إن كان نشاطك من البيت أو أونلاين اختر «منزلي أو أونلاين» لنعرض مدينتك فقط. يراجع المشرفون كل نشاط قبل ظهوره.</div>
      <form class="bz-f" id="bz-nf" novalidate><label>اسم النشاط<input name="name" required minlength="2" maxlength="80" placeholder="مثال: مقهى الواحة"></label>
        <label>التصنيف<select name="category" required><option value="">اختر التصنيف…</option>${cfg.categories.map((c) => `<option value="${c.key}">${h(c.label)}</option>`).join("")}</select></label>
        <label>وصف مختصر<textarea name="descr" maxlength="500" placeholder="ما الذي تقدمه؟ ما الذي يميزك؟"></textarea></label>
        <fieldset class="bz-seg"><legend>نوع الموقع</legend><label><input type="radio" name="loc" value="store" checked><svg class=ix aria-hidden=true><use href=#i-store /></svg> محل بعنوان</label><label><input type="radio" name="loc" value="home"><svg class=ix aria-hidden=true><use href=#i-home /></svg> منزلي أو أونلاين</label></fieldset>
        <div id="bz-store"><label>العنوان (للمحل فقط)<input name="address" maxlength="200" placeholder="الحي والشارع"></label><p class="u-m0 u-mt8 u-mb4 bz-sub">حرّك الخريطة حتى يقع الدبوس على المحل تماماً.</p><div id="bz-map" style="min-height:300px"></div></div>
        <div id="bz-home" hidden><label>المدينة<select name="city"><option value="">اختر المدينة…</option>${cfg.cities.map((c) => `<option>${h(c)}</option>`).join("")}</select></label><p class="bz-sub">يظهر النشاط بمدينته فقط، دون عنوان ولا دبوس على الخريطة.</p></div>
        ${contactFields()}${hoursEditor(null)}
        <label class="bz-chk"><input type="checkbox" name="owner" checked> أنا صاحب هذا النشاط (يُرسل طلب توثيق الملكية تلقائياً)</label>
        <div class="bz-row"><button class="btn" type="submit">إرسال للمراجعة</button></div></form>`, ["#/biz", "دليل الأعمال"]);
    wireHours();
    let picker = null;
    try {
      await window.MPChunks?.load("nearby");
      const nc = await api("GET", "/api/nearby/config"); let start = null;
      try { const n = await api("GET", "/api/nearby"); if (n.center) start = n.center; } catch { /* none */ }
      if ($("#bz-map") && window.MPNearby?.mountMap) picker = window.MPNearby.mountMap($("#bz-map"), { config: nc, center: start || { lat: 21.4858, lng: 39.1925 }, zoom: start ? 16 : 12, items: [], picker: true });
    } catch { /* map optional */ }
    const f = $("#bz-nf");
    f.addEventListener("change", (e) => { if (e.target.name === "loc") { const home = e.target.value === "home"; $("#bz-store").hidden = home; $("#bz-home").hidden = !home; } });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const home = f.querySelector("input[name=loc]:checked").value === "home";
      if (f.name.value.trim().length < 2) { say("اكتب اسم النشاط"); f.name.focus(); return; }
      if (!f.category.value) { say("اختر التصنيف"); f.category.focus(); return; }
      if (home && !f.city.value) { say("اختر المدينة"); f.city.focus(); return; }
      const c = picker?.center?.() || null;
      if (!home && !c) { say("تعذّر تحميل الخريطة؛ اختر «منزلي أو أونلاين» أو حاول لاحقاً"); return; }
      const body = { name: f.name.value.trim(), category: f.category.value, descr: f.descr.value.trim(), homeBased: home, city: home ? f.city.value : undefined, address: home ? "" : f.address.value.trim(), lat: home ? undefined : c.lat, lng: home ? undefined : c.lng, hoursWeek: readHours(), owner: f.owner.checked, ...readContact(f) };
      const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
      try { const r = await api("POST", "/api/biz", body); say("✓ أُرسل النشاط للمراجعة"); location.hash = "#/biz/" + enc(r.place.id); }
      catch (x) { say(x.message); if (x.code === "home_address") { f.querySelector('input[value="home"]').click(); } if (x.code === "duplicate" && x.details?.existing) location.hash = "#/biz/" + enc(x.details.existing); }
      finally { btn.disabled = false; }
    });
  }
  async function editView(id) {
    page("تعديل ملف النشاط", `<div id="bz-e">${skel(3)}</div>`, ["#/biz/" + enc(id), "صفحة النشاط"]);
    let d; try { d = await api("GET", "/api/biz/" + enc(id)); } catch (e) { if ($("#bz-e")) $("#bz-e").innerHTML = errBox(e); return; }
    const box = $("#bz-e"); if (!box) return;
    if (!d.business.canEdit) { box.innerHTML = `<div class="empty">يعدّل النشاط صاحبه الموثّق فقط. أرسل طلب إدارة من صفحة النشاط.</div>`; return; }
    const cfg = await config();
    const b = d.business;
    box.innerHTML = `<form class="bz-f" id="bz-ef"><label>التصنيف<select name="category">${cfg.categories.map((c) => `<option value="${c.key}" ${c.key === b.category ? "selected" : ""}>${h(c.label)}</option>`).join("")}</select></label><label>وصف النشاط<textarea name="descr" maxlength="500">${h(d.place.descr || "")}</textarea></label>${contactFields(b)}${hoursEditor(d.place.hoursWeek)}<p class="bz-sub">لتغيير الاسم أو الموقع أبلغ المشرفين عبر «الإبلاغ عن مشكلة ← معلومات خاطئة».</p><div class="bz-row"><button class="btn" type="submit">حفظ التعديلات</button><a class="btn ghost" href="#/biz/${enc(id)}">إلغاء</a></div></form>`;
    wireHours();
    $("#bz-ef").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { await api("PATCH", "/api/biz/" + enc(id), { category: f.category.value, descr: f.descr.value.trim(), hoursWeek: readHours(), ...readContact(f) }); say("✓ حُفظت التعديلات"); location.hash = "#/biz/" + enc(id); } catch (x) { say(x.message); } });
  }
  async function mineView() {
    if (!signed()) { page("أنشطتي", `<div class="empty">سجّل الدخول.</div>`, ["#/biz", "دليل الأعمال"]); return; }
    page("أنشطتي التجارية", `<div id="bz-m">${skel(2)}</div>`, ["#/biz", "دليل الأعمال"]);
    let r; try { r = await api("GET", "/api/biz/mine"); } catch (e) { if ($("#bz-m")) $("#bz-m").innerHTML = errBox(e); return; }
    const box = $("#bz-m"); if (!box) return;
    const ST = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض", withdrawn: "مسحوب" };
    box.innerHTML = `${r.businesses.length ? `<ul class="bz-ul">${r.businesses.map((b) => `<li><a class="bz-grow" href="${h(b.href)}"><b>${h(b.name)}</b> ${verified(b.verified)}<div class="u-m0 bz-sub">${h(b.categoryLabel || "")}${b.city ? ` · ${h(b.city)}` : ""}</div></a>${b.status !== "approved" ? `<span class="bz-st ${b.status === "pending" ? "pending" : "rejected"}">${b.status === "pending" ? "بانتظار المراجعة" : "مرفوض"}</span>` : b.mine ? `<a class="u-mh44 btn ghost" href="#/biz/${enc(b.id)}/edit">تعديل</a>` : ""}</li>`).join("")}</ul>` : `<div class="empty"><b>لا أنشطة لك بعد</b>أضف نشاطك ليجده عملاء يقبلون الدفع بـ Pi في مدينتك.<br><a class="btn" href="#/biz/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>أضف نشاطك</a></div>`}
      ${r.claims.length ? `<h3>طلبات الإدارة</h3><ul class="bz-ul">${r.claims.map((c) => `<li><a class="bz-grow" href="#/biz/${enc(c.placeId)}"><b>${h(c.name)}</b><div class="u-m0 bz-sub">${rel(c.at)}${c.note ? ` · ${h(c.note)}` : ""}</div></a><span class="bz-st ${c.status}">${ST[c.status] || c.status}</span></li>`).join("")}</ul>` : ""}`;
  }
  async function adminView() {
    const st = qs().get("status") || "pending";
    page("طلبات إدارة الأنشطة", `<nav class="bz-tabs seg" aria-label="الحالة">${[["pending", "قيد المراجعة"], ["approved", "مقبولة"], ["rejected", "مرفوضة"]].map(([k, l]) => `<a href="#/admin/biz?status=${k}" ${k === st ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav><div id="bz-a">${skel(2)}</div>`, ["#/admin", "الإدارة"], "تحقق من الأدلة قبل القبول. القبول يمنح الملكية وعلامة «موثّق»؛ الرفض يحتاج سبباً يصل لصاحب الطلب. الأماكن الجديدة تُراجع في <a href=\"#/admin/places\">طابور الأماكن</a>.");
    let r; try { r = await api("GET", "/api/admin/biz/claims?status=" + enc(st)); } catch (e) { if ($("#bz-a")) $("#bz-a").innerHTML = errBox(e); return; }
    const box = $("#bz-a"); if (!box) return;
    box.innerHTML = r.claims.length ? r.claims.map((c) => `<article class="bz-card bz-cl" data-c="${h(c.id)}"><div class="u-m0 bz-row"><a class="u-ci u-fw8 u-tdn bz-grow" href="#/biz/${enc(c.placeId)}">${h(c.place.name)}</a>${c.place.status !== "approved" ? `<span class="bz-st pending">المكان ${c.place.status === "pending" ? "بانتظار المراجعة" : h(c.place.status)}</span>` : ""}${c.hasOwner ? `<span class="bz-st rejected">له مالك موثّق</span>` : ""}</div>
      <div class="u-m0 bz-sub">${h(c.place.categoryLabel)}${c.place.city ? ` · ${h(c.place.city)}` : ""} · ${c.roleLabel} · <a href="#/u/${enc(c.by.handle)}"><bdi dir="ltr">@${h(c.by.handle)}</bdi></a> (انضم ${rel(c.by.since)}) · ${rel(c.at)}</div>
      <blockquote>${h(c.evidence)}</blockquote>${c.contact ? `<div class="u-m0 bz-sub"><svg class=ix aria-hidden=true><use href=#i-phone /></svg> للمشرفين: <bdi dir="ltr">${h(c.contact)}</bdi></div>` : ""}${c.note ? `<div class="bz-sub">ملاحظة: ${h(c.note)}</div>` : ""}
      ${c.status === "pending" ? `<div class="bz-row"><button type="button" class="btn" data-ok>✓ قبول وتوثيق</button><button type="button" class="btn ghost" data-no>رفض…</button></div>` : ""}</article>`).join("") : `<div class="empty"><b>لا طلبات هنا</b>${st === "pending" ? "كل الطلبات رُوجعت." : ""}</div>`;
    box.addEventListener("click", async (e) => {
      const card = e.target.closest("[data-c]"); if (!card) return; const ok = e.target.closest("[data-ok]"), no = e.target.closest("[data-no]"); if (!ok && !no) return;
      const note = no ? prompt("سبب الرفض (يصل لصاحب الطلب):") : null; if (no && !note) return;
      try { await api("POST", "/api/admin/biz/claims/" + enc(card.dataset.c), { decision: ok ? "approve" : "reject", note: note || undefined }); card.style.opacity = ".5"; card.querySelector(".bz-row:last-child").outerHTML = `<p class="bz-sub">${ok ? "✓ قُبل ووُثّق" : "رُفض"}</p>`; } catch (x) { say(x.message); }
    });
  }

  MPRoutes.extend((a, b, base) => {
    return { biz: () => (!a ? listView() : a === "new" ? newView() : a === "mine" ? mineView() : b === "edit" ? editView(a) : bizView(a)) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "biz" ? adminView() : next()));
  window.MPBiz = { listView, bizView, newView, editView, mineView, adminView, version: "__APP_VERSION__" };
  if (/^#\/(biz|admin\/biz)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
