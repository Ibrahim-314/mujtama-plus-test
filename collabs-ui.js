/* =====================================================================
 * مجتمع بلس — Phase 63 UI: creator ↔ brand collaborations and sponsorships (lazy "collabs" chunk; the disclosure label
 * itself is rendered by the core post card so it can never be missed).
 *   #/collabs[?tab=opps|deals|kit]   hub: opportunities (campaigns), my deals (needs-me first), my media kit + brand
 *   #/collabs/c/:id[/edit]           campaign page (apply / applications) · #/collabs/new campaign form
 *   #/collabs/d/:id                  deal room: stepper, terms, counter / accept / decline / cancel, deliverables (deliver,
 *                                    approve, ask for changes), «paid» record, results, private thread
 *   #/collabs/creators · #/collabs/kit/:handle · #/collabs/offer/:handle   discover creators, media kit, send an offer
 *   #/collabs/brand                  brand profile · #/collabs/library  public library of disclosed partnerships
 *   #/collabs/about                  what the labels mean · #/collabs/disclose/:post · #/collabs/report/:post
 *   #/admin/collabs                  staff: held campaigns, undisclosed-ad reports, brands
 * CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function CollabsUI() {
  if (window.MPCollabs) return;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const $ = (s) => view.querySelector(s);
  const say = (m) => (typeof toast === "function" ? toast(m) : null);
  const qs = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const seg = (i) => location.hash.split("?")[0].split("/")[i];
  const errBox = (e) => `<div class="empty cb-empty" role="alert">${h(e?.message || "تعذر الاتصال بالخادم")}</div>`;
  const AR = (n) => Number(n || 0).toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 1 });
  const piA = (n) => `${AR(n)} Pi`;
  const signed = () => typeof DB !== "undefined" && !!DB.me;
  const rel = (iso) => (typeof relTime === "function" ? relTime(iso) : "");
  const dateAr = (iso) => new Date(iso).toLocaleDateString("ar-SA-u-ca-gregory-nu-arab", { day: "numeric", month: "long" });
  const isAdmin = () => { try { return S.me()?.role === "admin"; } catch { return false; } };
  const KIND = { sponsored: ["", "محتوى مدفوع"], gifted: ["", "هدية"], affiliate: ["", "رابط عمولة"], collab: ["", "تعاون بين صنّاع"] };
  const STATUS = { proposed: ["warn", "قيد التفاوض"], active: ["acc", "ساري"], completed: ["ok", "مكتمل"], declined: ["", "مرفوض"], cancelled: ["", "ملغى"] };
  const FMT = { post: "منشور", article: "مقال", video: "فيديو", short: "فيديو قصير", story: "قصة", live: "بث مباشر", audio: "صوتي" };
  const DST = { pending: ["", "لم يُسلَّم"], submitted: ["warn", "بانتظار المراجعة"], changes: ["bad", "مطلوب تعديل"], approved: ["ok", "معتمد ✓"] };
  const page = (title, body, back, sub) => { view.innerHTML = `<div class="wrap cb-page"><header class="page-head">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${h(back[1])}</a>` : ""}<div class="ph-main"><div><h2 id="cb-h" tabindex="-1">${String(title).replaceAll("<svg class=ix", "<svg class=ic")}</h2>${sub ? `<p class="sub">${sub}</p>` : ""}</div></div></header>${body}</div>`; $("#cb-h")?.focus({ preventScroll: true }); };
  const skel = (n = 3) => Array.from({ length: n }, () => `<div class="skel cb-skel"></div>`).join("");
  const av = (u, s = 40) => `<span class="cb-av" style="width:${s}px;height:${s}px;background:${h(u?.color || "var(--accent)")}" aria-hidden="true">${h((u?.name || "?").slice(0, 1))}</span>`;
  const chip = (cls, t) => `<span class="cb-chip sbadge ${({ acc: "role", paid: "warn paid" })[cls] ?? cls}">${h(t)}</span>`;
  const minorBox = `<div class="empty cb-empty"><b>غير متاحة لمن هم دون 18 سنة</b>التعاونات والرعايات مخصصة للبالغين لحمايتك.</div>`;

  if (!document.getElementById("cb-css")) document.head.insertAdjacentHTML("beforeend", `<style id="cb-css">
.cb-page{max-width:780px;margin:auto}.cb-page h2:focus{outline:none}.cb-page h3{font-size:16px;font-weight:800;margin:22px 0 8px}
.cb-skel{height:96px;border-radius:var(--r);margin:8px 0}.cb-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.cb-row .btn{min-height:44px}.cb-grow{flex:1;min-width:0}
.cb-tabs .n{min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--danger);color:var(--white);font-size:11.5px;display:inline-grid;place-items:center}
.cb-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
.cb-camp{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);color:inherit;text-decoration:none}.cb-camp:hover{border-color:var(--accent)}.cb-camp .br{display:flex;gap:8px;align-items:center;font-size:var(--fs-sm);color:var(--text-2)}.cb-camp .br b{color:var(--text)}.cb-camp>b{font-size:16.5px;line-height:1.45}.cb-camp p{margin:0;color:var(--text-2);font-size:14px;line-height:1.65;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.cb-facts{display:flex;gap:6px;flex-wrap:wrap}.cb-fee{font-weight:800;color:var(--accent-ink)}
.cb-chip.paid{border-radius:999px;background:color-mix(in srgb,var(--warn) 14%,var(--card));color:color-mix(in srgb,var(--warn) 45%,var(--text));border:1px solid color-mix(in srgb,var(--warn) 45%,transparent)}
.cb-av{border-radius:50%;display:inline-grid;place-items:center;color:var(--white);font-weight:800;flex:none;font-size:var(--fs-md)}
.cb-deal{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:var(--r);border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);color:inherit;text-decoration:none;flex-wrap:wrap}.cb-deal.turn{border-color:var(--accent);background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 6%,var(--card)),var(--card))}.cb-deal b{display:block;line-height:1.45}.cb-deal .m{font-size:12.5px;color:var(--muted)}
.cb-bar{height:6px;border-radius:4px;background:var(--bg-2);overflow:hidden;flex-basis:100%}.cb-bar i{display:block;height:100%;background:var(--ok);border-radius:4px}
.cb-hero{border-radius:var(--r-lg);border:1px solid var(--line);background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 10%,var(--card)),var(--card) 65%);box-shadow:var(--sh-1);padding:16px;margin:8px 0}.cb-hero .who{display:flex;gap:10px;align-items:center}.cb-hero .who b{display:block;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cb-hero .who span{font-size:12.5px;color:var(--muted)}.cb-hero p{margin:10px 0 0;line-height:1.75;white-space:pre-wrap;color:var(--text-2)}
.cb-k{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}@media(min-width:620px){.cb-k{grid-template-columns:repeat(4,minmax(0,1fr))}}.cb-k div{padding:12px 14px;border-radius:var(--r);background:var(--card);border:1px solid var(--line);box-shadow:var(--sh-1)}.cb-k b{display:block;font-size:22px;font-weight:800;line-height:1.25}.cb-k span{font-size:12.5px;color:var(--muted)}
.cb-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin:10px 0;list-style:none;padding:0;counter-reset:s}.cb-steps li{text-align:center;font-size:11.5px;color:var(--muted);display:flex;flex-direction:column;align-items:center;gap:4px;position:relative}.cb-steps li:before{counter-increment:s;content:counter(s,arabic-indic);width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:var(--bg-2);font-weight:800;color:var(--text-2);position:relative;z-index:1}.cb-steps li:after{content:"";position:absolute;top:15px;inset-inline-start:50%;width:100%;height:2px;background:var(--line)}.cb-steps li:last-child:after{display:none}
.cb-steps li.done:before{content:"✓";background:var(--ok);color:#fff}.cb-steps li.now:before{background:var(--accent);color:#fff;box-shadow:0 0 0 4px var(--accent2)}.cb-steps li.now{color:var(--text);font-weight:700}.cb-steps li.done:after{background:var(--ok)}
.cb-card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);padding:12px 14px;margin:8px 0}.cb-card dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0;font-size:14px}.cb-card dt{color:var(--muted)}.cb-card dd{margin:0;font-weight:600}
.cb-act{display:flex;gap:8px;flex-wrap:wrap;padding:12px;border-radius:var(--r);background:var(--accent2);margin:10px 0;align-items:center}.cb-act p{margin:0;flex-basis:100%;font-weight:700;color:var(--accent-ink)}.cb-act .btn{min-height:44px;flex:1 1 40%;white-space:nowrap}.cb-act .btn:not(.ghost){flex-basis:100%}
.cb-dl{list-style:none;padding:0;margin:0;background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:hidden}.cb-dl>li{padding:12px 14px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px}.cb-dl>li:last-child{border-bottom:0}.cb-dl .hd{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cb-dl .hd b{flex:1;min-width:60%;line-height:1.5}.cb-dl .m{font-size:12.5px;color:var(--muted)}.cb-dl .note{font-size:var(--fs-sm);padding:6px 10px;border-radius:var(--r-xs);background:color-mix(in srgb,var(--danger) 8%,var(--card))}.cb-dl form{display:flex;gap:6px;flex-wrap:wrap}.cb-dl select{flex:1;min-width:0;min-height:44px}.cb-dl .btn{min-height:44px}
.cb-label{display:inline-flex;align-items:center;gap:6px;max-width:100%;line-height:1.5;padding:3px 12px;border-radius:999px;font-size:12.5px;font-weight:700;color:color-mix(in srgb,var(--warn) 45%,var(--text));background:color-mix(in srgb,var(--warn) 14%,var(--card));border:1px solid color-mix(in srgb,var(--warn) 45%,transparent)}.cb-label.free{color:var(--accent-ink);background:var(--accent2);border-color:color-mix(in srgb,var(--accent) 35%,transparent)}
.cb-thread{display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--bg-2);border-radius:var(--r);max-height:480px;overflow-y:auto}.cb-msg{max-width:84%;padding:8px 12px;border-radius:16px;background:var(--card);border:1px solid var(--line);line-height:1.65;font-size:14.5px;white-space:pre-wrap;word-break:break-word;align-self:flex-start}.cb-msg.mine{align-self:flex-end;background:color-mix(in srgb,var(--accent) 72%,#000);color:var(--white);border-color:transparent}.cb-msg small{display:block;font-size:11px;opacity:.8;margin-top:2px}.cb-msg.mine small{opacity:.95}.cb-ev{align-self:center;text-align:center;font-size:12.5px;color:var(--text-2);padding:4px 12px;border-radius:999px;background:var(--card);border:1px solid var(--line);max-width:92%;line-height:1.6}
.cb-say{display:flex;gap:6px;margin-top:8px}.cb-say textarea{flex:1;min-width:0;min-height:48px;max-height:140px;resize:vertical;line-height:1.6}.cb-say button{min-height:48px;min-width:64px}
.cb-f{display:flex;flex-direction:column;gap:10px}.cb-f label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--text-2)}.cb-f input:not([type=checkbox]):not([type=radio]),.cb-f select,.cb-f textarea{min-height:44px;width:100%;box-sizing:border-box;font-weight:400}.cb-f textarea{min-height:110px;line-height:1.7}.cb-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cb-sw{flex-direction:row !important;align-items:center;gap:10px !important;min-height:52px;font-size:var(--fs-md) !important}.cb-sw input{width:22px;height:22px;accent-color:var(--accent);flex:none}
.cb-pick{display:flex;flex-wrap:wrap;gap:6px;border:0;padding:0;margin:0}.cb-pick legend{font-size:14px;font-weight:600;color:var(--text-2);margin-bottom:6px;padding:0}.cb-fs{border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:8px;min-width:0}.cb-fs legend{font-size:14px;font-weight:600;color:var(--text-2);margin-bottom:6px;padding:0}.cb-pick>label{flex-direction:row !important;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line-2);background:var(--card);cursor:pointer;font-weight:600;font-size:14px;gap:6px !important}.cb-pick>label>input{position:absolute;opacity:0;width:1px;height:1px}.cb-pick>label:has(input:checked){background:var(--accent2);border-color:var(--accent);color:var(--accent-ink)}.cb-pick>label:has(input:focus-visible){outline:2px solid var(--accent)}
.cb-dlb{display:flex;flex-direction:column;gap:8px}.cb-dlr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr) auto;gap:6px;align-items:end}.cb-dlr label{min-width:0}.cb-dlr select,.cb-dlr input{min-height:44px;height:44px;width:100%;box-sizing:border-box}.cb-dlr button{min-width:44px;min-height:44px;border-radius:var(--r-sm);border:1px solid var(--line-2);background:var(--card);color:var(--danger);cursor:pointer}
.cb-kit{border-radius:var(--r-lg);overflow:hidden;border:1px solid var(--line);background:var(--card);box-shadow:var(--sh-1);margin:8px 0}.cb-kit .top{padding:18px 16px;background:linear-gradient(135deg,hsl(262 60% 44%),hsl(300 52% 34%));color:var(--white);display:flex;gap:12px;align-items:center}.cb-kit .top b{display:block;font-size:19px}.cb-kit .top span{font-size:13px;opacity:.92}.cb-kit .bd{padding:12px 16px 16px}
.cb-lib{display:block;padding:12px 14px;border-bottom:1px solid var(--line);color:inherit;text-decoration:none}.cb-lib:last-child{border-bottom:0}.cb-lib .hd{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:var(--fs-sm);color:var(--muted)}.cb-lib p{margin:6px 0 0;line-height:1.65}
.cb-rules{list-style:none;margin:0;padding:0}.cb-rules li{display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);line-height:1.7}.cb-rules li:last-child{border-bottom:0}.cb-rules .e{font-size:var(--fs-2xl);flex:none;width:32px;text-align:center}
.cb-page 
.cb-note{font-size:var(--fs-sm);line-height:1.7;padding:10px 12px;border-radius:var(--r-sm);background:var(--bg-2);color:var(--text-2);margin:8px 0}
</style>`);

  /* =================== hub #/collabs =================== */
  async function hubView() {
    const p = qs(), tab = p.get("tab") || "opps";
    page("التعاونات والرعايات", `<nav class="cb-tabs seg" aria-label="أقسام التعاونات"><a href="#/collabs" ${tab === "opps" ? 'aria-current="page"' : ""}>الفرص</a><a href="#/collabs?tab=deals" ${tab === "deals" ? 'aria-current="page"' : ""} id="cb-tdeals">اتفاقاتي</a><a href="#/collabs?tab=kit" ${tab === "kit" ? 'aria-current="page"' : ""}>ملفّي</a></nav><div id="cb-b">${skel(3)}</div>`, null, "صنّاع ومعلنون يتعاونون بشفافية: كل محتوى مدفوع يحمل وسماً واضحاً لا يُزال.");
    if (!signed()) { $("#cb-b").innerHTML = `<div class="empty cb-empty">سجّل الدخول لتصفّح فرص التعاون</div>`; return; }
    const box = () => $("#cb-b");
    try {
      if (tab === "deals") return dealsTab(box(), p.get("f") || "action");
      if (tab === "kit") return kitTab(box());
      const q = p.get("q") || "", cat = p.get("category") || "";
      const d = await api("GET", "/api/collabs/campaigns?" + new URLSearchParams({ q, category: cat }));
      const b = box(); if (!b) return;
      const href = (o) => "#/collabs?" + new URLSearchParams({ ...(q ? { q } : {}), ...(cat ? { category: cat } : {}), ...o });
      b.innerHTML = `<form class="cb-search fx-host" role="search" id="cb-sf"><input type="search" enterkeyhint="search" name="q" value="${h(q)}" placeholder="ابحث في الحملات" aria-label="ابحث في الحملات"><button class="btn" type="submit" aria-label="بحث"><svg class=ix aria-hidden=true><use href=#i-search /></svg></button></form>
        <div class="cb-chips f-chips cb-cats" role="list"><a role="listitem" data-fx-all class="chip f" href="${href({ category: "" })}" ${!cat ? 'aria-current="true"' : ""}>الكل</a>${Object.entries(d.categories).map(([k, l]) => `<a role="listitem" class="chip f" href="${href({ category: k })}" ${cat === k ? 'aria-current="true"' : ""}>${h(l)}</a>`).join("")}</div>
        <nav class="cb-chips f-chips" aria-label="روابط"><a href="#/collabs/creators"><svg class=ix aria-hidden=true><use href=#i-users /></svg> اكتشف الصنّاع</a><a href="#/collabs/library"><svg class=ix aria-hidden=true><use href=#i-book /></svg> مكتبة الشراكات</a><a href="#/collabs/about">قواعد الإفصاح</a></nav>
        ${d.campaigns.length ? `<ul class="cb-list">${d.campaigns.map((c) => `<li><a class="cb-camp" href="#/collabs/c/${enc(c.id)}"><span class="br">${av({ name: c.brand.name }, 28)}<b>${h(c.brand.name)}</b>${c.brand.verified ? chip("ok", "✓ موثّقة") : ""}<span>· ${h(c.brand.categoryLabel || "")}</span></span><b>${h(c.title)}</b><p>${h(c.summary)}</p>
          <span class="cb-facts">${c.fee !== null ? `<span class="cb-chip sbadge role cb-fee">${piA(c.fee)}</span>` : chip("", "المبلغ بالاتفاق")}${c.deadline ? chip("", "حتى " + dateAr(c.deadline)) : ""}${c.formats.slice(0, 3).map((f) => chip("", f.label)).join("")}${c.applied ? chip("ok", "✓ تقدّمت") : ""}</span></a></li>`).join("")}</ul>`
        : `<div class="empty cb-empty"><b>لا حملات مطابقة الآن</b>افتح ملفك للتعاون ليجدك المعلنون ويرسلوا لك عروضاً مباشرة.<br><a class="btn" href="#/collabs?tab=kit">افتح ملفّي للتعاون</a></div>`}`;
      { const sf = $("#cb-sf"); if (sf && window.MPFeat) MPFeat.filters({ host: sf, move: [b.querySelector(".cb-cats")], title: "التصنيف" }); }
      $("#cb-sf").addEventListener("submit", (e) => { e.preventDefault(); location.hash = href({ q: e.target.q.value.trim() }); });
    } catch (e) { const b = box(); if (b) b.innerHTML = e.code === "minor_restricted" ? minorBox : errBox(e); }
  }
  async function dealsTab(box, f) {
    const d = await api("GET", "/api/collabs/deals?tab=" + enc(f === "action" ? "all" : f));
    if (!box.isConnected) return;
    if (d.minor) { box.innerHTML = minorBox; return; }
    const tn = $("#cb-tdeals"); if (tn && d.counts.myTurn) tn.insertAdjacentHTML("beforeend", ` <span class="n" aria-label="${d.counts.myTurn} بانتظارك">${AR(d.counts.myTurn)}</span>`);
    let list = d.deals; if (f === "action") list = [...list].sort((a, b) => (b.myTurn - a.myTurn) || (a.status === "active" ? -1 : 0));
    const F = [["action", "الأحدث"], ["active", "سارية"], ["done", "منتهية"]];
    box.innerHTML = `<div class="cb-chips f-chips">${F.map(([k, l]) => `<a href="#/collabs?tab=deals&f=${k}" ${f === k ? 'aria-current="true"' : ""}>${l}</a>`).join("")}</div>
      ${list.length ? `<ul class="cb-list">${list.map((x) => `<li><a class="cb-deal ${x.myTurn ? "turn" : ""}" href="#/collabs/d/${enc(x.id)}">${av(x.other)}<span class="cb-grow"><b>${h(x.title)}</b><span class="m">${x.side === "brand" ? "مع الصانع" : "مع"} ${h(x.other.brandName || x.other.name)} · ${h(rel(x.updatedAt))}</span></span><span style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${x.myTurn ? chip("acc", "بانتظارك") : chip(STATUS[x.status][0], STATUS[x.status][1])}${x.fee ? `<span class="m">${piA(x.fee)}</span>` : chip("", KIND[x.kind][1])}</span>${x.status === "active" ? `<span class="cb-bar" aria-label="التسليمات المعتمدة ${x.progress.done} من ${x.progress.total}"><i style="width:${(x.progress.done / Math.max(1, x.progress.total)) * 100}%"></i></span>` : ""}</a></li>`).join("")}</ul>`
        : `<div class="empty cb-empty"><b>لا اتفاقات بعد</b>تقدّم لحملة من «الفرص»، أو افتح ملفك ليصلك عرض.</div>`}`;
  }
  async function kitTab(box) {
    const [k, b, c] = await Promise.all([api("GET", "/api/collabs/kit"), api("GET", "/api/collabs/brand"), api("GET", "/api/collabs/campaigns")]);
    if (!box.isConnected) return;
    if (k.minor) { box.innerHTML = minorBox; return; }
    const kit = k.kit, has = (arr, key) => arr.some((x) => x.key === key);
    box.innerHTML = `<h3>ملف التعاون (للصنّاع)</h3><form class="cb-f cb-card" id="cb-kf"><label class="cb-sw"><input type="checkbox" name="open" ${kit.open ? "checked" : ""}> أستقبل عروض التعاون</label>
      <label>تعريف قصير<input name="headline" maxlength="140" value="${h(kit.headline)}" placeholder="مثال: أراجع الأجهزة التقنية بصدق وبالعربية"></label>
      <fieldset class="cb-pick"><legend>المجالات</legend>${Object.entries(k.categories).map(([key, l]) => `<label><input type="checkbox" name="cat" value="${key}" ${has(kit.categories, key) ? "checked" : ""}>${h(l)}</label>`).join("")}</fieldset>
      <fieldset class="cb-pick"><legend>أنواع المحتوى</legend>${Object.entries(k.formats).map(([key, l]) => `<label><input type="checkbox" name="fmt" value="${key}" ${has(kit.formats, key) ? "checked" : ""}>${h(l)}</label>`).join("")}</fieldset>
      <div class="cb-two"><label>يبدأ السعر من (Pi)<input name="rateFrom" type="number" inputmode="numeric" min="0" value="${kit.rateFrom ?? ""}" placeholder="اختياري"></label><label>اللغات<input name="languages" maxlength="60" value="${h(kit.languages)}" placeholder="العربية، English"></label></div>
      <label>ملاحظة عن الأسعار<input name="rateNote" maxlength="200" value="${h(kit.rateNote)}" placeholder="مثال: حسب مدة الفيديو"></label>
      <div class="u-m0 cb-k"><div><b>${AR(kit.stats.followers)}</b><span>متابِع</span></div><div><b>${AR(kit.stats.posts90)}</b><span>منشور في 90 يوماً</span></div><div><b>${AR(kit.stats.avgReactions)}</b><span>متوسط التفاعل</span></div><div><b>${AR(kit.stats.completedDeals)}</b><span>تعاون مكتمل</span></div></div>
      <p class="u-m0 cb-sub">يرى المعلنون هذه الأرقام العامة فقط — لا رقم جوال ولا بريد. المحادثة داخل غرفة الاتفاق.</p>
      <div class="u-m0 cb-row"><button class="u-f1 btn" type="submit">حفظ</button>${kit.open ? `<a class="btn ghost" href="#/collabs/kit/${enc(kit.user.handle)}">معاينة</a>` : ""}</div></form>
      <h3>العلامة التجارية (للمعلنين)</h3>${b.brand ? `<div class="cb-card"><div class="u-m0 cb-row">${av({ name: b.brand.name })}<span class="cb-grow"><b>${h(b.brand.name)}</b><span class="u-db u-m0 cb-sub">${h(b.brand.categoryLabel)}${b.brand.verified ? " · ✓ موثّقة" : ""}${b.brand.status === "suspended" ? " · موقوفة" : ""}</span></span><a class="btn ghost" href="#/collabs/brand">تعديل</a></div></div>
        <div class="cb-row"><a class="btn" href="#/collabs/new"><svg class=ix aria-hidden=true><use href=#i-plus /></svg>حملة جديدة</a><a class="btn ghost" href="#/collabs/creators"><svg class=ix aria-hidden=true><use href=#i-users /></svg> اكتشف الصنّاع</a></div>
        ${c.mine.length ? `<ul class="cb-list">${c.mine.map((x) => `<li><a class="cb-deal" href="#/collabs/c/${enc(x.id)}"><span class="cb-grow"><b>${h(x.title)}</b><span class="m">${AR(x.applications)} طلب · ${AR(x.slots)} مقاعد</span></span>${chip(x.status === "open" ? "ok" : x.status === "review" ? "warn" : x.status === "removed" ? "bad" : "", { open: "مفتوحة", review: "قيد المراجعة", closed: "مغلقة", removed: "أُزيلت" }[x.status])}</a></li>`).join("")}</ul>` : ""}`
      : `<div class="empty cb-empty"><b>هل تمثّل علامة تجارية؟</b>أنشئ ملف علامة لتنشر حملات وترسل عروضاً للصنّاع.<br><a class="btn" href="#/collabs/brand">إنشاء ملف علامة</a></div>`}`;
    $("#cb-kf").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target;
      try { await api("PUT", "/api/collabs/kit", { open: f.open.checked, headline: f.headline.value.trim(), categories: [...f.querySelectorAll("[name=cat]:checked")].map((x) => x.value), formats: [...f.querySelectorAll("[name=fmt]:checked")].map((x) => x.value), rateFrom: f.rateFrom.value, rateNote: f.rateNote.value.trim(), languages: f.languages.value.trim() }); say("✓ حُفظ ملف التعاون"); kitTab(box); } catch (x) { say(x.message); } });
  }

  /* =================== brand + campaign forms =================== */
  async function brandView() {
    page("ملف العلامة التجارية", `<div id="cb-bf">${skel(2)}</div>`, ["#/collabs?tab=kit", "ملفّي"], "يظهر للصنّاع في حملاتك وعروضك. المجالات المحظورة (القمار، التبغ، الكحول، الأسلحة، المحتوى الإباحي، مخططات الربح السريع، الأدوية بلا ترخيص) لا تُقبل.");
    let d; try { d = await api("GET", "/api/collabs/brand"); } catch (e) { const b = $("#cb-bf"); if (b) b.innerHTML = errBox(e); return; }
    if (d.minor) { $("#cb-bf").innerHTML = minorBox; return; }
    const b = d.brand || {};
    $("#cb-bf").innerHTML = `<form class="cb-f" id="cb-brf"><label>اسم العلامة<input name="name" required minlength="2" maxlength="80" value="${h(b.name || "")}"></label><label>المجال<select name="category" required>${Object.entries(d.categories).map(([k, l]) => `<option value="${k}" ${b.category === k ? "selected" : ""}>${h(l)}</option>`).join("")}</select></label>
      <label>الموقع الإلكتروني<input name="website" type="url" inputmode="url" maxlength="200" value="${h(b.website || "")}" placeholder="https://"></label><label>نبذة<textarea name="about" maxlength="600">${h(b.about || "")}</textarea></label><button class="u-mh48 btn" type="submit">حفظ</button></form>`;
    $("#cb-brf").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { await api("PUT", "/api/collabs/brand", { name: f.name.value.trim(), category: f.category.value, website: f.website.value.trim(), about: f.about.value.trim() }); say("✓ حُفظ ملف العلامة"); location.hash = "#/collabs?tab=kit"; } catch (x) { say(x.message); } });
  }
  const dlRow = (d = {}, i = 0) => `<div class="cb-dlr" data-dl="${h(d.id || "")}"><label class="u-t-xs cb-f">النوع<select name="format">${Object.entries(FMT).map(([k, l]) => `<option value="${k}" ${d.format === k ? "selected" : ""}>${l}</option>`).join("")}</select></label><label class="u-t-xs cb-f">الوصف<input name="label" maxlength="140" value="${h(d.label || "")}" placeholder="مثال: فيديو مراجعة دقيقة" required></label><button type="button" data-rmdl aria-label="حذف التسليم ${i + 1}">✕</button></div>`;
  const readDl = (root) => [...root.querySelectorAll(".cb-dlr")].map((r) => ({ id: r.dataset.dl || undefined, format: r.querySelector("[name=format]").value, label: r.querySelector("[name=label]").value.trim() })).filter((x) => x.label);
  const wireDl = (root) => root.addEventListener("click", (e) => { if (e.target.closest("[data-adddl]")) { root.querySelector(".cb-dlb").insertAdjacentHTML("beforeend", dlRow({}, root.querySelectorAll(".cb-dlr").length)); root.querySelector(".cb-dlr:last-child input")?.focus(); } const rm = e.target.closest("[data-rmdl]"); if (rm && root.querySelectorAll(".cb-dlr").length > 1) rm.closest(".cb-dlr").remove(); });
  async function campaignForm(id) {
    let c = null;
    if (id) { try { c = (await api("GET", "/api/collabs/campaigns/" + enc(id))).campaign; } catch (e) { page("الحملة", errBox(e)); return; } }
    page(id ? "تعديل الحملة" : "＋ حملة جديدة", `<form class="cb-f" id="cb-cf"><label>عنوان الحملة<input name="title" required minlength="4" maxlength="100" value="${h(c?.title || "")}" placeholder="مثال: إطلاق سماعات لاسلكية"></label>
      <label>تفاصيل الحملة<textarea name="summary" required minlength="20" maxlength="3000" placeholder="ما المنتج؟ ما المطلوب؟ ما الذي لا تريده؟">${h(c?.summary || "")}</textarea></label>
      <fieldset class="cb-fs"><legend>التسليمات المطلوبة</legend><div class="cb-dlb">${(c?.deliverables?.length ? c.deliverables : [{}]).map(dlRow).join("")}</div><button type="button" class="u-mh44 btn ghost" data-adddl><svg class=ix aria-hidden=true><use href=#i-plus /></svg>تسليم</button></fieldset>
      <div class="cb-two"><label>المبلغ لكل صانع (Pi)<input name="fee" type="number" inputmode="numeric" min="0" value="${c?.fee ?? ""}" placeholder="بالاتفاق"></label><label>عدد الصنّاع<input name="slots" type="number" inputmode="numeric" min="1" max="100" value="${c?.slots || 3}"></label></div>
      <div class="cb-two"><label>آخر موعد للتقديم<input name="deadline" type="date" value="${c?.deadline ? h(c.deadline.slice(0, 10)) : ""}"></label><label>المجال<select name="category">${Object.entries({ "": "—", tech: "تقنية", education: "تعليم", food: "طعام ومطاعم", fashion: "أزياء", beauty: "عناية وجمال", travel: "سفر وسياحة", sports: "رياضة ولياقة", gaming: "ألعاب", family: "أسرة وأطفال", finance: "مال وأعمال", books: "كتب وثقافة", home: "منزل وديكور", auto: "سيارات", charity: "عمل خيري", pi: "مشاريع Pi", other: "أخرى" }).map(([k, l]) => `<option value="${k}" ${c?.categories?.[0]?.key === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <div class="cb-note"><svg class=ix aria-hidden=true><use href=#i-bulb /></svg> المبلغ للاتفاق والتوثيق فقط — الدفع داخل المنصة غير مفعّل حالياً. كل محتوى يُسلَّم في هذه الحملة يُوسم تلقائياً «محتوى مدفوع» ولا يمكن إزالة الوسم.</div>
      <button class="u-mh48 btn" type="submit">${id ? "حفظ" : "نشر الحملة"}</button></form>`, id ? ["#/collabs/c/" + enc(id), "الحملة"] : ["#/collabs?tab=kit", "ملفّي"]);
    const f = $("#cb-cf"); wireDl(f);
    f.addEventListener("submit", async (e) => { e.preventDefault();
      const body = { title: f.title.value.trim(), summary: f.summary.value.trim(), deliverables: readDl(f), fee: f.fee.value === "" ? null : +f.fee.value, slots: +f.slots.value, deadline: f.deadline.value || null, categories: f.category.value ? [f.category.value] : [], formats: [...new Set(readDl(f).map((d) => d.format))] };
      try { const r = id ? await api("PATCH", "/api/collabs/campaigns/" + enc(id), body) : await api("POST", "/api/collabs/campaigns", body); say(r.campaign.status === "review" ? "أُحيلت الحملة لمراجعة فريق المنصة" : "✓ نُشرت الحملة"); location.hash = "#/collabs/c/" + enc(r.campaign.id); } catch (x) { if (x.code === "no_brand") location.hash = "#/collabs/brand"; say(x.message); } });
  }

  /* =================== campaign page =================== */
  async function campaignView(id) {
    page("…", `<div id="cb-c">${skel(3)}</div>`, ["#/collabs", "الفرص"]);
    let d; try { d = await api("GET", "/api/collabs/campaigns/" + enc(id)); } catch (e) { const b = $("#cb-c"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#cb-c"); if (!box) return;
    const c = d.campaign, br = c.brand || {}; const hd = $("#cb-h"); if (hd) hd.textContent = c.title;
    box.innerHTML = `<section class="cb-hero"><div class="who">${av({ name: br.name }, 44)}<div class="cb-grow"><b><a href="#/collabs/b/${enc(c.brandId)}" class="u-ci">${h(br.name)}</a></b><span>${h(br.categoryLabel || "")}${br.verified ? " · ✓ موثّقة" : ""}</span></div>${c.status !== "open" ? chip(c.status === "review" ? "warn" : "", { review: "قيد المراجعة", closed: "مغلقة" }[c.status] || "") : ""}</div><p>${h(c.summary)}</p></section>
      ${c.reviewNote && d.owner ? `<div class="cb-note"><svg class=ix aria-hidden=true><use href=#i-clock /></svg> ${h(c.reviewNote)}</div>` : ""}
      <div class="cb-card"><dl><dt>المبلغ</dt><dd>${c.fee !== null ? piA(c.fee) + " لكل صانع" : "بالاتفاق"}</dd><dt>الصنّاع</dt><dd>${AR(c.accepted)} من ${AR(c.slots)}${c.full ? " · اكتمل العدد" : ""}</dd>${c.deadline ? `<dt>التقديم حتى</dt><dd>${h(dateAr(c.deadline))}</dd>` : ""}<dt>الإفصاح</dt><dd><span class="cb-label"><svg class=ix aria-hidden=true><use href=#i-brief /></svg> محتوى مدفوع · شراكة مع ${h(br.name)}</span></dd></dl></div>
      <h3>التسليمات</h3><ul class="cb-dl">${c.deliverables.map((x) => `<li><div class="hd"><b>${h(x.label)}</b>${chip("", FMT[x.format] || x.format)}</div></li>`).join("")}</ul>
      <div id="cb-ap"></div>`;
    const ap = $("#cb-ap");
    if (d.owner) {
      ap.innerHTML = `<div class="cb-row"><a class="btn ghost" href="#/collabs/c/${enc(c.id)}/edit"><svg class=ix aria-hidden=true><use href=#i-pen /></svg> تعديل</a>${c.status === "open" ? `<button class="btn ghost" type="button" data-cs="closed">إغلاق الحملة</button>` : c.status === "closed" ? `<button class="btn ghost" type="button" data-cs="open">إعادة فتحها</button>` : ""}</div><h3>طلبات الصنّاع</h3>${d.applications.length ? `<ul class="cb-list">${d.applications.map((x) => `<li><a class="cb-deal ${x.turn === "brand" && x.status === "proposed" ? "turn" : ""}" href="#/collabs/d/${enc(x.id)}">${av(x.creator)}<span class="cb-grow"><b>${h(x.creator.name)}</b><span class="m">@${h(x.creator.handle)} · ${h(rel(x.at))} · ${piA(x.fee)}</span></span>${chip(STATUS[x.status][0], x.turn === "brand" && x.status === "proposed" ? "بانتظارك" : x.statusLabel)}</a></li>`).join("")}</ul>` : `<div class="empty cb-empty">لا طلبات بعد — شارك رابط الحملة مع الصنّاع</div>`}`;
      ap.querySelectorAll("[data-cs]").forEach((b) => b.addEventListener("click", async () => { try { await api("PATCH", "/api/collabs/campaigns/" + enc(c.id), { status: b.dataset.cs }); campaignView(id); } catch (x) { say(x.message); } }));
    } else if (d.me.minor) ap.innerHTML = minorBox;
    else if (d.applied) ap.innerHTML = `<a class="u-mt12 cb-deal turn" href="#/collabs/d/${enc(d.applied.id)}"><span class="cb-grow"><b>✓ تقدّمت لهذه الحملة</b><span class="m">تابع التفاوض في غرفة الاتفاق</span></span><span aria-hidden="true">←</span></a>`;
    else if (c.status === "open" && !c.full) {
      ap.innerHTML = `<h3>تقدّم للحملة</h3><form class="cb-f cb-card" id="cb-apf"><label>لماذا أنت مناسب؟<textarea name="pitch" required minlength="20" maxlength="1500" placeholder="عرّف بنفسك وبجمهورك وفكرتك للمحتوى"></textarea></label><label>المبلغ الذي تقترحه (Pi)<input name="fee" type="number" inputmode="numeric" min="0" value="${c.fee ?? ""}"></label>${d.me.hasKit ? "" : `<p class="u-m0 cb-sub">نصيحة: <a href="#/collabs?tab=kit">أكمل ملف التعاون</a> ليرى المعلن أرقامك.</p>`}<button class="u-mh48 btn" type="submit">إرسال الطلب</button></form>`;
      $("#cb-apf").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { const r = await api("POST", `/api/collabs/campaigns/${enc(c.id)}/apply`, { pitch: f.pitch.value.trim(), fee: f.fee.value }); say("✓ أُرسل طلبك"); location.hash = "#/collabs/d/" + enc(r.deal.id); } catch (x) { say(x.message); } });
    }
  }

  /* =================== deal room =================== */
  let myPosts = [];
  async function dealView(id) {
    page("…", `<div id="cb-d">${skel(4)}</div>`, ["#/collabs?tab=deals", "اتفاقاتي"]);
    let d; try { d = await api("GET", "/api/collab-deals/" + enc(id)); if (d.side === "creator" && d.deal.status === "active") myPosts = (await api("GET", "/api/collabs/my-posts")).posts; } catch (e) { const b = $("#cb-d"); if (b) b.innerHTML = errBox(e); return; }
    drawDeal(d);
  }
  function drawDeal(d) {
    const box = $("#cb-d"); if (!box) return;
    const x = d.deal, side = d.side, other = side === "brand" ? x.creator : x.brand; const hd = $("#cb-h"); if (hd) hd.textContent = x.title;
    const stepN = { proposed: 1, active: x.deliverables.some((y) => y.status !== "pending") ? 3 : 2, completed: 4, declined: 1, cancelled: x.acceptedAt ? 2 : 1 }[x.status];
    const steps = ["العرض", "الاتفاق", "التسليم", "الاكتمال"];
    const ended = ["declined", "cancelled"].includes(x.status);
    let act = "";
    if (x.status === "proposed" && d.myTurn) act = `<div class="cb-act" role="region" aria-label="مطلوب منك"><p>${x.initiator === (side === "brand" ? x.brand.id : x.creator.id) ? "عدّل الطرف الآخر العرض — دورك للرد" : side === "creator" ? "وصلك عرض — اقبله أو اقترح تعديلاً" : "طلب جديد من صانع — اقبله أو اقترح تعديلاً"}</p><button class="btn" type="button" data-do="accept">قبول الاتفاق</button><button class="btn ghost" type="button" data-do="counter">اقتراح تعديل</button><button class="btn ghost" type="button" data-do="decline">اعتذار</button></div>`;
    else if (x.status === "proposed") act = `<div class="cb-note"><svg class=ix aria-hidden=true><use href=#i-clock /></svg> بانتظار رد ${side === "brand" ? "الصانع" : "العلامة"}.${x.initiator === (side === "brand" ? x.brand.id : x.creator.id) ? ` <button class="u-mh40 btn ghost" type="button" data-do="cancel">سحب العرض</button>` : ""}</div>`;
    const dlItem = (y) => {
      let ctl = "";
      if (x.status === "active" && side === "creator" && y.status !== "approved" && y.status !== "submitted") ctl = myPosts.length ? `<form data-deliver="${h(y.id)}"><select name="post" aria-label="اختر المنشور لتسليم «${h(y.label)}»" required><option value="">اختر منشوراً من منشوراتك…</option>${myPosts.map((p) => `<option value="${h(p.id)}" ${p.id === y.postId ? "selected" : ""}>${h(p.title.slice(0, 60))}${p.status === "scheduled" ? " (مجدول)" : ""}</option>`).join("")}</select><button class="btn" type="submit">تسليم</button></form>` : `<p class="u-m0 cb-sub">انشر المحتوى أولاً ثم عُد لتسليمه هنا.</p>`;
      if (x.status === "active" && side === "brand" && y.status === "submitted") ctl = `<div class="u-m0 cb-row"><button class="btn" type="button" data-rv="${h(y.id)}" data-dec="approve">اعتماد ✓</button><button class="btn ghost" type="button" data-rv="${h(y.id)}" data-dec="changes">طلب تعديل</button></div>`;
      return `<li><div class="hd"><b>${h(y.label)}</b>${chip("", y.formatLabel || FMT[y.format])}${chip(DST[y.status][0], DST[y.status][1])}</div>${y.post ? `<a class="u-m0 cb-sub" href="#/post/${enc(y.post.id)}">${h(y.post.title || "المنشور")}</a>` : ""}${y.note ? `<div class="note">✎ ${h(y.note)}</div>` : ""}${ctl}</li>`;
    };
    box.innerHTML = `<section class="cb-hero"><div class="who">${av(other, 44)}<div class="cb-grow"><b>${h(side === "creator" ? x.brand.brandName || x.brand.name : x.creator.name)}</b><span>${side === "creator" ? (x.kind === "collab" ? "صانع محتوى" : "العلامة التجارية") : "الصانع"} · @${h(other.handle)}</span></div>${chip(STATUS[x.status][0], x.statusLabel)}</div>${x.summary ? `<p>${h(x.summary)}</p>` : ""}</section>
      ${ended ? `<div class="cb-note">${x.status === "declined" ? "اعتُذر عن هذا العرض" : "أُلغي هذا الاتفاق"}${x.endReason ? ": " + h(x.endReason) : ""}</div>` : `<ol class="cb-steps" aria-label="مراحل الاتفاق">${steps.map((s, i) => `<li class="${i + 1 < stepN || x.status === "completed" ? "done" : i + 1 === stepN ? "now" : ""}" ${i + 1 === stepN ? 'aria-current="step"' : ""}>${s}</li>`).join("")}</ol>`}
      ${act}
      <div class="cb-card"><dl><dt>النوع</dt><dd>${KIND[x.kind][0]} ${h(x.kindLabel)}</dd><dt>المبلغ</dt><dd>${x.kind === "collab" ? "بلا مقابل" : piA(x.fee)}</dd><dt>الوسم</dt><dd><span class="cb-label ${x.kind === "collab" ? "free" : ""}">${x.kind === "collab" ? "" : ""} ${h(x.label)}</span></dd>${x.campaign ? `<dt>الحملة</dt><dd><a href="#/collabs/c/${enc(x.campaign.id)}">${h(x.campaign.title)}</a></dd>` : ""}${x.acceptedAt ? `<dt>بدأ</dt><dd>${h(dateAr(x.acceptedAt))}</dd>` : ""}</dl></div>
      <h3>التسليمات</h3><ul class="cb-dl">${x.deliverables.map(dlItem).join("")}</ul>${x.status === "active" && side === "creator" ? `<p class="u-mt6 cb-sub">عند التسليم يُضاف إلى منشورك تلقائياً وسم «${h(x.label)}» ولا يمكن إزالته.</p>` : ""}
      ${x.fee && ["active", "completed"].includes(x.status) ? `<h3>الدفع</h3><div class="cb-card"><p class="u-mt0 cb-sub">يُتفق على الدفع بين الطرفين؛ الدفع عبر المنصة غير مفعّل حالياً. هذا سجل للطرفين فقط.</p><div class="u-m0 cb-row">${x.paid.brand ? chip("ok", "✓ سجّلت العلامة الدفع") : side === "brand" ? `<button class="btn ghost" type="button" data-do="paid">سجّلتُ أنني دفعت</button>` : chip("", "لم تسجّل العلامة الدفع")}${x.paid.creator ? chip("ok", "✓ أكّد الصانع الاستلام") : side === "creator" ? `<button class="btn ghost" type="button" data-do="paid">أكّد استلام المبلغ</button>` : chip("", "لم يؤكد الصانع الاستلام")}</div></div>` : ""}
      ${["active", "completed"].includes(x.status) && x.deliverables.some((y) => y.post) ? `<h3>النتائج</h3><div id="cb-rep">${skel(1)}</div>` : ""}
      <h3>المحادثة</h3><div class="cb-thread" id="cb-th" role="log" aria-label="محادثة الاتفاق">${d.messages.map((m) => m.kind === "event" ? `<div class="cb-ev">${h(m.body)}</div>` : `<div class="cb-msg ${m.mine ? "mine" : ""}">${h(m.body)}<small>${m.mine ? "أنت" : h(m.who || "")} · ${h(rel(m.at))}</small></div>`).join("")}</div>
      ${ended ? "" : `<form class="cb-say" id="cb-sy"><textarea name="body" maxlength="1500" required placeholder="اكتب رسالة…" aria-label="رسالة"></textarea><button class="btn" type="submit">إرسال</button></form><p class="u-mt6 cb-sub"><svg class=ix aria-hidden=true><use href=#i-lock /></svg> لا تشارك رقم جوالك أو بياناتك البنكية؛ أبقِ الاتفاق هنا ليكون موثقاً.</p>`}
      ${x.status === "active" ? `<div class="cb-row"><button class="u-c-dg btn ghost" type="button" data-do="cancel">إلغاء الاتفاق</button></div>` : ""}`;
    const th = $("#cb-th"); if (th) th.scrollTop = th.scrollHeight;
    const run = async (path, body) => { try { drawDeal(await api("POST", `/api/collab-deals/${enc(x.id)}/${path}`, body)); } catch (er) { say(er.message); } };
    box.onclick = async (e) => { // replaced on every redraw (one handler for the current deal)
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.do === "accept") { if (confirm(`قبول الاتفاق${x.fee ? ` بمبلغ ${x.fee} Pi` : ""}؟`)) run("accept"); }
      else if (b.dataset.do === "decline") { const r = prompt("سبب الاعتذار (اختياري)") ?? null; if (r !== null) run("decline", { reason: r }); }
      else if (b.dataset.do === "cancel") { const r = prompt(x.status === "active" ? "سبب الإلغاء (مطلوب)" : "سبب سحب العرض (اختياري)"); if (r !== null) run("cancel", { reason: r }); }
      else if (b.dataset.do === "paid") run("paid");
      else if (b.dataset.do === "counter") counterForm(x);
      else if (b.dataset.rv) { const ok = b.dataset.dec === "approve"; const note = ok ? null : prompt("ما التعديل المطلوب؟"); if (!ok && !note) return; run("review", { deliverableId: b.dataset.rv, decision: b.dataset.dec, note }); }
    };
    box.querySelectorAll("[data-deliver]").forEach((f) => f.addEventListener("submit", (e) => { e.preventDefault(); if (!confirm("سيُوسم المنشور تلقائياً بالإفصاح ولا يمكن إزالة الوسم. متابعة؟")) return; run("deliver", { deliverableId: f.dataset.deliver, postId: f.post.value }); }));
    $("#cb-sy")?.addEventListener("submit", (e) => { e.preventDefault(); const v = e.target.body.value.trim(); if (v) run("messages", { body: v }); });
    if ($("#cb-rep")) api("GET", `/api/collab-deals/${enc(x.id)}/report`).then((r) => { const el = $("#cb-rep"); if (!el) return; const T = r.totals; el.innerHTML = `<div class="u-m0 cb-k"><div><b>${AR(T.views)}</b><span>مشاهدة</span></div><div><b>${AR(T.reactions)}</b><span>تفاعل</span></div><div><b>${AR(T.comments)}</b><span>تعليق</span></div><div><b>${T.engagement === null ? "—" : AR(T.engagement) + "٪"}</b><span>معدل التفاعل</span></div></div>`; }).catch(() => { const el = $("#cb-rep"); if (el) el.textContent = ""; });
  }
  function counterForm(x) {
    const box = $("#cb-d"); if (!box) return;
    box.querySelector(".cb-act")?.insertAdjacentHTML("afterend", `<form class="cb-f cb-card" id="cb-co"><h3 class="u-m0">اقتراح تعديل</h3>${x.kind === "collab" ? "" : `<label>المبلغ (Pi)<input name="fee" type="number" inputmode="numeric" min="0" value="${x.fee}"></label>`}<fieldset class="cb-fs"><legend>التسليمات</legend><div class="cb-dlb">${x.deliverables.map(dlRow).join("")}</div><button type="button" class="u-mh44 btn ghost" data-adddl><svg class=ix aria-hidden=true><use href=#i-plus /></svg>تسليم</button></fieldset><label>رسالة<textarea name="message" maxlength="1500" placeholder="وضّح سبب التعديل"></textarea></label><div class="u-m0 cb-row"><button class="u-f1 btn" type="submit">إرسال الاقتراح</button><button class="btn ghost" type="button" id="cb-cx">إلغاء</button></div></form>`);
    const f = $("#cb-co"); wireDl(f); f.querySelector("input,textarea")?.focus();
    $("#cb-cx").addEventListener("click", () => f.remove());
    f.addEventListener("submit", async (e) => { e.preventDefault(); try { drawDeal(await api("POST", `/api/collab-deals/${enc(x.id)}/counter`, { ...(f.fee ? { fee: f.fee.value } : {}), deliverables: readDl(f), message: f.message.value.trim() || undefined })); say("✓ أُرسل الاقتراح"); } catch (er) { say(er.message); } });
  }

  /* =================== creators, media kit, offer =================== */
  async function creatorsView() {
    const cat = qs().get("category") || "";
    page("اكتشف الصنّاع", `<div id="cb-cr">${skel(3)}</div>`, ["#/collabs", "التعاونات"], "صنّاع فتحوا ملفاتهم لعروض التعاون. الأرقام عامة ومحدّثة.");
    let d; try { d = await api("GET", "/api/collabs/creators?category=" + enc(cat)); } catch (e) { const b = $("#cb-cr"); if (b) b.innerHTML = e.code === "minor_restricted" ? minorBox : errBox(e); return; }
    const box = $("#cb-cr"); if (!box) return;
    box.innerHTML = `<div class="cb-chips f-chips"><a href="#/collabs/creators" ${!cat ? 'aria-current="true"' : ""}>الكل</a>${Object.entries(d.categories).map(([k, l]) => `<a href="#/collabs/creators?category=${k}" ${cat === k ? 'aria-current="true"' : ""}>${h(l)}</a>`).join("")}</div>
      ${d.creators.length ? `<ul class="cb-list">${d.creators.map((k) => `<li><a class="cb-deal" href="#/collabs/kit/${enc(k.user.handle)}">${av(k.user, 48)}<span class="cb-grow"><b>${h(k.user.name)}</b><span class="m">${h(k.headline || "@" + k.user.handle)}</span><span class="u-mt4 cb-facts">${k.categories.slice(0, 2).map((c) => chip("", c.label)).join("")}</span></span><span class="u-tc"><b>${AR(k.stats.followers)}</b><span class="m">متابِع</span></span></a></li>`).join("")}</ul>` : `<div class="empty cb-empty"><b>لا صنّاع في هذا المجال بعد</b></div>`}`;
  }
  async function kitView(handle) {
    page("…", `<div id="cb-kt">${skel(3)}</div>`, ["#/collabs/creators", "الصنّاع"]);
    let d; try { d = await api("GET", "/api/collabs/kits/" + enc(handle)); } catch (e) { const b = $("#cb-kt"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#cb-kt"); if (!box) return;
    const k = d.kit, s = k.stats; const hd = $("#cb-h"); if (hd) hd.textContent = "ملف التعاون";
    const me = signed() && k.user.id === DB.me;
    box.innerHTML = `<section class="cb-kit"><div class="top">${av(k.user, 56)}<div class="cb-grow"><b>${h(k.user.name)}</b><span>@${h(k.user.handle)}${k.user.verified ? " · ✓" : ""}</span></div></div><div class="bd">${k.headline ? `<p class="u-m0 u-mb10 u-lh17">${h(k.headline)}</p>` : ""}<div class="cb-facts">${k.categories.map((c) => chip("acc", c.label)).join("")}${k.formats.map((c) => chip("", c.label)).join("")}</div>
      <div class="cb-k"><div><b>${AR(s.followers)}</b><span>متابِع</span></div><div><b>${AR(s.posts90)}</b><span>منشور في 90 يوماً</span></div><div><b>${AR(s.avgReactions)}</b><span>متوسط التفاعل</span></div><div><b>${AR(s.avgViews)}</b><span>متوسط المشاهدات</span></div></div>
      <dl class="cb-card" style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;margin:0"><dt class="u-m0 cb-sub">يبدأ من</dt><dd class="u-m0 u-fw7">${k.rateFrom !== null ? piA(k.rateFrom) : "بالاتفاق"}${k.rateNote ? ` <span class="cb-sub">· ${h(k.rateNote)}</span>` : ""}</dd>${k.languages ? `<dt class="u-m0 cb-sub">اللغات</dt><dd class="u-m0">${h(k.languages)}</dd>` : ""}<dt class="u-m0 cb-sub">تعاونات</dt><dd class="u-m0">${AR(s.completedDeals)} مكتمل · ${AR(s.partnerships)} منشور مُفصح عنه</dd></dl></div></section>
      ${d.recent.length ? `<h3>شراكات سابقة مُفصح عنها</h3><div class="cb-facts">${d.recent.map((r) => chip("paid", `${KIND[r.kind][0]} ${r.brand}`)).join("")}</div>` : ""}
      ${me ? `<div class="cb-row"><a class="btn ghost" href="#/collabs?tab=kit">تعديل ملفي</a></div>` : signed() ? `<div class="cb-row"><a class="u-f1 u-mh48 btn" href="#/collabs/offer/${enc(k.user.handle)}">أرسل عرض تعاون</a></div>` : ""}`;
  }
  async function offerView(handle) {
    page("عرض تعاون", `<div id="cb-of">${skel(2)}</div>`, ["#/collabs/kit/" + enc(handle), "ملف الصانع"]);
    let b; try { b = await api("GET", "/api/collabs/brand"); } catch (e) { const x = $("#cb-of"); if (x) x.innerHTML = errBox(e); return; }
    if (b.minor) { $("#cb-of").innerHTML = minorBox; return; }
    const hd = $("#cb-h"); if (hd) hd.textContent = "عرض تعاون إلى @" + handle;
    $("#cb-of").innerHTML = `<form class="cb-f" id="cb-off"><fieldset class="cb-pick"><legend>نوع التعاون</legend>${Object.entries(KIND).map(([k, [i, l]]) => `<label><input type="radio" name="kind" value="${k}" ${(b.brand ? k === "sponsored" : k === "collab") ? "checked" : ""} ${!b.brand && k !== "collab" ? "disabled" : ""}>${i} ${l}</label>`).join("")}</fieldset>
      ${b.brand ? "" : `<p class="u-m0 cb-sub">للعروض المدفوعة <a href="#/collabs/brand">أنشئ ملف علامة</a>. بدونه يمكنك دعوة الصانع لتعاون بلا مقابل.</p>`}
      <label>العنوان<input name="title" required minlength="4" maxlength="100" placeholder="مثال: مراجعة جهازنا الجديد"></label><label>التفاصيل<textarea name="summary" required minlength="20" maxlength="3000" placeholder="ما المطلوب، ومتى، وما الرسائل الأساسية؟"></textarea></label>
      <fieldset class="cb-fs"><legend>التسليمات</legend><div class="cb-dlb">${dlRow({}, 0)}</div><button type="button" class="u-mh44 btn ghost" data-adddl><svg class=ix aria-hidden=true><use href=#i-plus /></svg>تسليم</button></fieldset>
      <label id="cb-feel">المبلغ (Pi)<input name="fee" type="number" inputmode="numeric" min="0" placeholder="٠"></label><label>رسالة شخصية<textarea name="message" maxlength="1500" class="u-mh70"></textarea></label>
      <div class="cb-note">سيُوسم كل محتوى يُسلَّم بهذا الاتفاق تلقائياً، ولا يمكن إزالة الوسم.</div><button class="u-mh48 btn" type="submit">إرسال العرض</button></form>`;
    const f = $("#cb-off"); wireDl(f);
    const feeVis = () => { const k = f.querySelector("[name=kind]:checked")?.value; $("#cb-feel").style.display = k === "collab" ? "none" : ""; }; feeVis(); f.addEventListener("change", feeVis);
    f.addEventListener("submit", async (e) => { e.preventDefault(); const kind = f.querySelector("[name=kind]:checked")?.value || "collab";
      try { const r = await api("POST", "/api/collabs/offers", { creator: handle, kind, title: f.title.value.trim(), summary: f.summary.value.trim(), deliverables: readDl(f), fee: kind === "collab" ? 0 : f.fee.value, message: f.message.value.trim() || undefined }); say("✓ أُرسل العرض"); location.hash = "#/collabs/d/" + enc(r.deal.id); }
      catch (x) { if (x.code === "open_deal" && x.details?.id) location.hash = "#/collabs/d/" + enc(x.details.id); say(x.message); } });
  }
  async function brandPageView(id) {
    page("…", `<div id="cb-bp">${skel(2)}</div>`, ["#/collabs", "التعاونات"]);
    let d; try { d = await api("GET", "/api/collabs/brands/" + enc(id)); } catch (e) { const b = $("#cb-bp"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#cb-bp"); if (!box) return; const br = d.brand; const hd = $("#cb-h"); if (hd) hd.textContent = br.name;
    box.innerHTML = `<section class="cb-hero"><div class="who">${av({ name: br.name }, 48)}<div class="cb-grow"><b>${h(br.name)}</b><span>${h(br.categoryLabel)}${br.verified ? " · ✓ موثّقة" : ""}</span></div></div>${br.about ? `<p>${h(br.about)}</p>` : ""}${br.website ? `<p><a href="${h(br.website)}" target="_blank" rel="noopener nofollow">${h(br.website.replace(/^https:\/\//, ""))}</a></p>` : ""}</section>
      <div class="cb-k"><div><b>${AR(br.completedDeals)}</b><span>تعاون مكتمل</span></div><div><b>${AR(br.disclosedPosts)}</b><span>منشور مُفصح عنه</span></div></div>
      <h3>حملات مفتوحة</h3>${d.campaigns.length ? `<ul class="cb-list">${d.campaigns.map((c) => `<li><a class="cb-camp" href="#/collabs/c/${enc(c.id)}"><b>${h(c.title)}</b><p>${h(c.summary)}</p></a></li>`).join("")}</ul>` : `<div class="empty cb-empty">لا حملات مفتوحة حالياً</div>`}
      <div class="cb-row"><a class="btn ghost" href="#/collabs/library?brand=${enc(br.id)}">منشوراتها المُفصح عنها</a></div>`;
  }

  /* =================== transparency: library, about, disclose, report =================== */
  async function libraryView() {
    const p = qs(), kind = p.get("kind") || "", brand = p.get("brand") || "";
    page("مكتبة الشراكات", `<div id="cb-lb">${skel(3)}</div>`, ["#/collabs", "التعاونات"], "كل منشور عام عليه إفصاح عن شراكة مدفوعة أو هدية أو رابط عمولة — للشفافية أمام الجميع.");
    let d; try { d = await api("GET", "/api/collabs/library?" + new URLSearchParams({ kind, brand })); } catch (e) { const b = $("#cb-lb"); if (b) b.innerHTML = errBox(e); return; }
    const box = $("#cb-lb"); if (!box) return;
    box.innerHTML = `<div class="cb-chips f-chips"><a href="#/collabs/library" ${!kind ? 'aria-current="true"' : ""}>الكل</a>${Object.entries(d.kinds).map(([k, l]) => `<a href="#/collabs/library?kind=${k}" ${kind === k ? 'aria-current="true"' : ""}>${KIND[k][0]} ${h(l)} <span class="cb-sub" style="margin:0 4px 0 0">${AR(d.counts[k] || 0)}</span></a>`).join("")}</div>
      ${d.items.length ? `<div class="cb-card" style="padding:0;overflow:hidden">${d.items.map((i) => `<a class="cb-lib" href="#/post/${enc(i.postId)}"><div class="hd"><span class="cb-label ${i.kind === "collab" ? "free" : ""}">${KIND[i.kind][0]} ${h(i.kindLabel)} · ${h(i.brand)}</span><span>${h(i.creator?.name || "")} · ${h(rel(i.at))}</span>${i.source === "staff" ? chip("warn", "وسمه فريق المنصة") : ""}</div><p>${h(i.excerpt)}</p></a>`).join("")}</div>` : `<div class="empty cb-empty">لا منشورات بعد</div>`}`;
  }
  function aboutView() {
    page("ماذا يعني وسم الشراكة؟", `<div class="cb-card"><ul class="cb-rules">
      <li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-brief /></svg></span><div><b>محتوى مدفوع · شراكة مع …</b><br>حصل الصانع على مقابل من العلامة لنشر هذا المحتوى.</div></li>
      <li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-gift /></svg></span><div><b>هدية من …</b><br>تلقّى الصانع المنتج مجاناً، حتى لو لم يُطلب منه النشر.</div></li>
      <li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-link /></svg></span><div><b>رابط عمولة</b><br>قد يحصل الصانع على نسبة إن اشتريت عبر الرابط.</div></li>
      <li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-hand /></svg></span><div><b>تعاون مع …</b><br>عمل مشترك بين صانعين بلا مقابل مادي.</div></li></ul></div>
      <h3>قواعدنا</h3><div class="cb-card"><ul class="cb-rules"><li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-lock /></svg></span><div>المحتوى المسلَّم ضمن اتفاق يُوسم تلقائياً، ولا يستطيع أحد إزالة الوسم.</div></li><li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-x /></svg></span><div>لا رعايات للقمار والمراهنات والتبغ والكحول والأسلحة والمحتوى الإباحي ومخططات الربح السريع والأدوية بلا ترخيص.</div></li><li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-shield /></svg></span><div>لا عروض ولا اتفاقات مع من هم دون 18 سنة.</div></li><li><span class="e" aria-hidden="true"><svg class=ix aria-hidden=true><use href=#i-flag /></svg></span><div>رأيت إعلاناً بلا إفصاح؟ اختر «⋯» على المنشور ثم «إعلان غير مُفصح عنه؟».</div></li></ul></div>
      <div class="cb-row"><a class="btn ghost" href="#/collabs/library"><svg class=ix aria-hidden=true><use href=#i-book /></svg> مكتبة الشراكات</a><a class="btn ghost" href="#/collabs"><svg class=ix aria-hidden=true><use href=#i-brief /></svg> التعاونات</a></div>`, null);
  }
  function discloseView(pid) {
    const p = (typeof S !== "undefined" && S.post) ? S.post(pid) : null;
    page("الإفصاح عن شراكة", `<p class="cb-sub">إن حصلت على مقابل أو هدية أو عمولة مقابل هذا المنشور فأفصح عنها — يظهر الوسم لكل من يرى المنشور.</p>${p?.partner ? `<div class="cb-card"><span class="cb-label ${p.partner.paid ? "" : "free"}">${h(p.partner.label)}</span><div class="cb-row"><button class="btn ghost" type="button" id="cb-und">إزالة الإفصاح</button></div><p class="u-m0 cb-sub">الإفصاح المرتبط باتفاق أو بقرار فريق المنصة لا يمكن إزالته.</p></div>` : ""}
      <form class="cb-f cb-card" id="cb-dsf"><fieldset class="cb-pick"><legend>النوع</legend>${["sponsored", "gifted", "affiliate"].map((k, i) => `<label><input type="radio" name="kind" value="${k}" ${(p?.partner?.kind || "sponsored") === k || (!p?.partner && i === 0) ? "checked" : ""}>${KIND[k][0]} ${KIND[k][1]}</label>`).join("")}</fieldset><label>اسم العلامة<input name="brand" required minlength="2" maxlength="80" value="${h(p?.partner?.name || "")}"></label><button class="u-mh48 btn" type="submit">حفظ الإفصاح</button></form>`, ["#/post/" + enc(pid), "المنشور"]);
    $("#cb-dsf").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { const r = await api("PUT", `/api/posts/${enc(pid)}/partnership`, { kind: f.querySelector("[name=kind]:checked").value, brand: f.brand.value.trim() }); if (p) p.partner = { ...r.partner, paid: true }; say("✓ أُضيف الإفصاح"); location.hash = "#/post/" + enc(pid); } catch (x) { say(x.message); } });
    $("#cb-und")?.addEventListener("click", async () => { try { await api("DELETE", `/api/posts/${enc(pid)}/partnership`); if (p) delete p.partner; say("أُزيل الإفصاح"); location.hash = "#/post/" + enc(pid); } catch (x) { say(x.message); } });
  }
  function reportView(pid) {
    page("إعلان غير مُفصح عنه؟", `<p class="cb-sub">إن بدا لك أن المنشور إعلان مدفوع بلا وسم، أخبر فريق المنصة. لن يعرف صاحب المنشور من أبلغ.</p><form class="cb-f cb-card" id="cb-rpf"><label>العلامة التجارية (إن عرفتها)<input name="brand" maxlength="80"></label><label>ملاحظة<textarea name="note" maxlength="300" class="u-mh80" placeholder="ما الذي يجعله يبدو إعلاناً؟"></textarea></label><button class="u-mh48 btn" type="submit">إرسال البلاغ</button></form>`, ["#/post/" + enc(pid), "المنشور"]);
    $("#cb-rpf").addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; try { await api("POST", `/api/posts/${enc(pid)}/undisclosed-report`, { brand: f.brand.value.trim() || undefined, note: f.note.value.trim() || undefined }); say("✓ شكراً، وصل بلاغك"); location.hash = "#/post/" + enc(pid); } catch (x) { say(x.message); } });
  }

  /* =================== #/admin/collabs =================== */
  async function adminView() {
    page("إشراف التعاونات", `<div id="cb-ad">${skel(3)}</div>`, ["#/collabs", "التعاونات"]);
    const draw = (d) => { const box = $("#cb-ad"); if (!box) return; const T = d.totals;
      box.innerHTML = `<div class="cb-k"><div><b>${AR(T.deals)}</b><span>اتفاق</span></div><div><b>${AR(T.active)}</b><span>ساري</span></div><div><b>${AR(T.disclosed)}</b><span>منشور مُفصح</span></div><div><b>${AR(T.openKits)}</b><span>صانع مفتوح</span></div></div>
        <h3>حملات بانتظار المراجعة</h3>${d.held.length ? `<ul class="cb-dl">${d.held.map((c) => `<li><div class="hd"><b>${h(c.title)}</b>${chip("", c.brand.name || "")}</div><p class="u-m0 cb-sub">${h(c.summary.slice(0, 240))}</p><div class="u-m0 cb-row"><button class="btn" type="button" data-camp="${h(c.id)}" data-dec="approve">قبول</button><button class="btn ghost" type="button" data-camp="${h(c.id)}" data-dec="reject">إزالة</button></div></li>`).join("")}</ul>` : `<div class="empty cb-empty">لا حملات معلّقة ✓</div>`}
        <h3>بلاغات إعلانات بلا إفصاح</h3>${d.reports.length ? `<ul class="cb-dl">${d.reports.map((r) => `<li><div class="hd"><b><a href="#/post/${enc(r.postId)}">${h(r.excerpt || "منشور")}</a></b>${chip("warn", `${AR(r.count)} بلاغ`)}</div><span class="m">@${h(r.author.handle || "")}${r.brand ? " · العلامة المذكورة: " + h(r.brand) : ""}${r.note ? " · " + h(r.note) : ""}</span><form data-rep="${h(r.postId)}"><input name="brand" value="${h(r.brand || "")}" placeholder="اسم العلامة" aria-label="اسم العلامة" class="u-f1 u-mh44 u-mw0"><button class="btn" type="submit">وسم كمدفوع</button><button class="btn ghost" type="button" data-dismiss="${h(r.postId)}">رفض</button></form></li>`).join("")}</ul>` : `<div class="empty cb-empty">لا بلاغات ✓</div>`}
        <h3>العلامات</h3>${d.brands.length ? `<ul class="cb-dl">${d.brands.map((b) => `<li><div class="hd"><b>${h(b.name)}</b>${chip("", b.categoryLabel)}${b.verified ? chip("ok", "موثّقة") : ""}${b.status === "suspended" ? chip("bad", "موقوفة") : ""}</div><span class="m">${AR(b.deals)} اتفاق</span><div class="u-m0 cb-row"><button class="btn ghost" type="button" data-brand="${h(b.id)}" data-set='${b.verified ? '{"verified":false}' : '{"verified":true}'}'>${b.verified ? "إلغاء التوثيق" : "توثيق"}</button><button class="btn ghost" type="button" data-brand="${h(b.id)}" data-set='${b.status === "suspended" ? '{"status":"active"}' : '{"status":"suspended"}'}'>${b.status === "suspended" ? "إعادة التفعيل" : "إيقاف"}</button></div></li>`).join("")}</ul>` : `<div class="empty cb-empty">لا علامات بعد</div>`}`; };
    let d; try { d = await api("GET", "/api/admin/collabs"); } catch (e) { const b = $("#cb-ad"); if (b) b.innerHTML = errBox(e); return; }
    draw(d);
    const box = $("#cb-ad");
    box.addEventListener("click", async (e) => { const b = e.target.closest("button"); if (!b) return;
      try {
        if (b.dataset.camp) draw(await api("POST", "/api/admin/collabs/campaigns/" + enc(b.dataset.camp), { decision: b.dataset.dec, note: b.dataset.dec === "reject" ? prompt("سبب الإزالة") || undefined : undefined }));
        else if (b.dataset.dismiss) draw(await api("POST", "/api/admin/collabs/reports/" + enc(b.dataset.dismiss), { decision: "dismiss" }));
        else if (b.dataset.brand) draw(await api("POST", "/api/admin/collabs/brands/" + enc(b.dataset.brand), JSON.parse(b.dataset.set)));
      } catch (x) { say(x.message); } });
    box.addEventListener("submit", async (e) => { e.preventDefault(); const f = e.target; if (!f.dataset.rep) return; try { draw(await api("POST", "/api/admin/collabs/reports/" + enc(f.dataset.rep), { decision: "label", kind: "sponsored", brand: f.brand.value.trim() })); say("✓ وُسم المنشور"); } catch (x) { say(x.message); } });
  }

  MPRoutes.extend((a, b, base) => {
    return { collabs: () => (!a ? hubView() : a === "c" ? (seg(4) === "edit" ? campaignForm(b) : campaignView(b)) : a === "new" ? campaignForm(null) : a === "d" ? dealView(b) : a === "creators" ? creatorsView() : a === "kit" ? kitView(b) : a === "offer" ? offerView(b) : a === "brand" ? brandView() : a === "b" ? brandPageView(b) : a === "library" ? libraryView() : a === "about" ? aboutView() : a === "disclose" ? discloseView(b) : a === "report" ? reportView(b) : hubView()) };
  });
  MPRoutes.add("admin", (a, b, next) => (a === "collabs" ? (isAdmin() ? adminView() : page("إشراف التعاونات", `<div class="empty cb-empty">للإدارة فقط</div>`)) : next()));
  window.MPCollabs = { hubView, dealView, campaignView, kitView, libraryView, aboutView, adminView, version: "__APP_VERSION__" };
  if (/^#\/(collabs|admin\/collabs)\b/.test(location.hash) && typeof DB !== "undefined" && DB.onboarded) route();
})();
