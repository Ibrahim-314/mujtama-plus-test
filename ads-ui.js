/* =====================================================================
 * مجتمع بلس — Phase 40 UI: ethical ads «الإعلانات الأخلاقية» (lazy "ads" chunk).
 * • Promoted feed card: visible «مُروَّج» label + advertiser (also the card's accessible name), ⋯ menu:
 *   «لماذا أرى هذا الإعلان؟» (GET /api/ads/why/:id), «إخفاء الإعلان», «إخفاء هذا المعلن» (POST /api/ads/hide).
 *   Impression once when ≥ 50 % visible for ≥ 1 s (IntersectionObserver), click once on open (POST /api/ads/events).
 * • #/ads campaign list, #/ads/new + #/ads/edit/:id wizard (post → targeting + live audience estimate → budget → review),
 *   #/ads/campaigns/:id dashboard (KPIs, inline-SVG daily chart, pause/resume/fund via MPPi.pay purpose "ads"),
 *   #/settings/ads prefs, #/admin/ads/review queue. Entry cards on #/settings and #/admin.
 * • Privacy: only topics / language / country; aggregates with k-anonymity («أقل من 10»).
 * REST contract: docs/integration/p40-contract.md. Styles injected (#ad-css). CSP: no inline handlers, no javascript: URLs.
 * ===================================================================== */
(function AdsUI() {
  if (window.MPAds) return;
  const A = () => (typeof PiAdapter !== "undefined" ? PiAdapter : null);
  const online = () => typeof Remote !== "undefined" && !!Remote.on;
  const api = (m, p, b) => Remote.api(m, p, b);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;
  const num = (n) => { const x = Number(n); return Number.isFinite(x) ? x.toLocaleString("en-US", { maximumFractionDigits: 7 }) : String(n ?? ""); };
  const pi = (n) => `<bdi dir="ltr" class="ad-n">${h(num(n))} π</bdi>`;
  const cnt = (n) => Number(n || 0).toLocaleString("ar-EG");
  const dayF = (iso, o = { dateStyle: "medium" }) => { if (!iso) return "—"; try { return new Intl.DateTimeFormat("ar", o).format(new Date(iso)); } catch { return String(iso); } };
  const list = (r, ...keys) => Array.isArray(r) ? r : (keys.map(k => r?.[k]).find(Array.isArray) || []);
  const say = (msg) => { let r = document.getElementById("ad-say"); if (!r) { r = document.createElement("div"); r.id = "ad-say"; r.className = "ad-sr"; r.setAttribute("aria-live", "polite"); document.body.appendChild(r); } r.textContent = ""; setTimeout(() => (r.textContent = msg), 40); };
  const begin = () => (view._ad = { h: location.hash });
  const live = (t) => view._ad === t && location.hash === t.h;
  const focusH = () => { const t = document.getElementById("ad-h"); if (t && (!document.activeElement || document.activeElement === document.body || !view.contains(document.activeElement))) t.focus({ preventScroll: true }); };
  const head = (href, label, title, icon, actions) => UI.pageHead({ back: [href, label], title, icon, actions, id: "ad-h" });
  const topicName = (t) => { const s = typeof t === "object" && t ? (t.name || t.slug || t.id) : t; try { return (typeof S !== "undefined" && S.topic?.(s)?.name) || (typeof t === "object" && t?.name) || s; } catch { return s; } };
  const OFF = "مدفوعات Pi غير مفعّلة بعد";
  const LT10 = "أقل من 10";
  const MAXB = 1000;
  const ERR = {
    campaign_invalid: "بيانات الحملة غير صالحة، راجع الحقول.", targeting_invalid: "خيارات الاستهداف غير صالحة.", targeting_sensitive: "لا يمكن استهداف الفئات الحساسة (الصحة، الدين، السياسة، الميول، العِرق). أزل هذا الموضوع.",
    budget_invalid: "الميزانية أو الحد اليومي أو التواريخ غير صالحة.", post_invalid: "لا يمكن ترويج هذا المنشور: يجب أن يكون منشوراً عاماً لك، غير مدفوع وخارج سياق القُصّر.",
    minor_restricted: "الإعلانات غير متاحة لمن هم دون 18 عاماً.", invalid_state: "لا يمكن تنفيذ هذا الإجراء في حالة الحملة الحالية.", not_configured: OFF + ". سيُتاح التمويل فور تفعيلها.", pi_disabled: OFF + ".",
    ad_rejected: "رفض الفحص الآلي هذا الإعلان لأنه يبدو مخالفاً لسياسة الإعلانات. عدّل المنشور أو الحملة ثم أعد الإرسال.", not_found: "غير موجود أو أُزيل.", forbidden: "لا تملك صلاحية هذا الإجراء.",
    unauthorized: "سجّل الدخول أولاً.", sign_in: "سجّل الدخول أولاً.", pi_not_linked: "اربط حساب Pi أولاً من الإعدادات ← Pi Network.", reasons_required: "اختر سبباً واحداً على الأقل للرفض.",
    review_invalid: "قرار المراجعة غير صالح؛ اختر سبباً واحداً على الأقل للرفض.", event_invalid: "حدث إعلاني غير صالح.", token_invalid: "انتهت صلاحية هذا الإعلان، حدّث الخلاصة.",
    bad_request: "الطلب غير صالح.", spam: "يبدو المحتوى مزعجاً (سبام). عدّله ثم أعد المحاولة.", rate_limited: "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة."
  };
  const errText = (e) => (e?.code && /[\u0600-\u06FF]/.test(e.message || "") && e.message !== "تعذر الاتصال بالخادم" ? e.message : ERR[e?.code]) || (e?.status === 429 ? "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة." : e?.status === 403 ? ERR.forbidden : e?.message || "تعذّرت العملية.");
  const ST = { draft: ["مسودة", "mute"], in_review: ["قيد المراجعة", "wait"], rejected: ["مرفوض", "bad"], awaiting_funds: ["بانتظار التمويل", "wait"], active: ["نشط", "ok"], paused: ["متوقف مؤقتاً", "info"], completed: ["مكتمل", "info"], removed: ["محذوف", "mute"] };
  const chip = (s) => { const [t, c] = ST[s] || [s || "—", "mute"]; return `<span class="sbadge ad-chip ${{ wait: "warn", mute: "" }[c] ?? c}">${h(t)}</span>`; };
  const OBJ = { reach: ["الوصول", "اعرض منشورك لأكبر عدد من المهتمين"], engagement: ["التفاعل", "إعجابات وتعليقات أكثر"], visits: ["زيارات الملف", "زيارات أكثر لملفك الشخصي"] };
  const LANGS = [["ar", "العربية"], ["en", "English"], ["fr", "Français"], ["ur", "اردو"], ["tr", "Türkçe"], ["id", "Bahasa Indonesia"]];
  const COUNTRIES = [["SA", "السعودية"], ["AE", "الإمارات"], ["EG", "مصر"], ["KW", "الكويت"], ["QA", "قطر"], ["BH", "البحرين"], ["OM", "عُمان"], ["JO", "الأردن"], ["IQ", "العراق"], ["MA", "المغرب"], ["DZ", "الجزائر"], ["TN", "تونس"], ["LB", "لبنان"], ["PS", "فلسطين"], ["SD", "السودان"], ["YE", "اليمن"], ["LY", "ليبيا"], ["SY", "سوريا"], ["TR", "تركيا"], ["PK", "باكستان"], ["ID", "إندونيسيا"], ["NG", "نيجيريا"], ["GB", "المملكة المتحدة"], ["US", "الولايات المتحدة"]];
  const nameOf = (arr, k) => (arr.find(x => x[0] === k) || [0, k])[1];
  const REJECT = [["misleading", "ادعاءات مضللة أو مبالغ فيها"], ["prohibited", "منتج أو خدمة محظورة"], ["sensitive", "محتوى أو استهداف حساس"], ["quality", "جودة منخفضة أو مزعج"], ["guidelines", "يخالف إرشادات المجتمع"], ["other", "سبب آخر (وضّحه في الملاحظة)"]];
  const REASON_X = { spam: "محتوى مزعج (سبام)", rights: "انتهاك حقوق الآخرين" }; // automod / legacy codes
  const reasonText = (x) => (REJECT.find(z => z[0] === x) || [0, REASON_X[x] || x])[1];
  const HIDE_R = [["irrelevant", "لا يهمني"], ["repetitive", "أراه كثيراً"], ["misleading", "مضلل"], ["offensive", "مسيء"]];
  const HIDE_TXT = Object.fromEntries([...HIDE_R, ["other", "سبب آخر"]]);
  const hrsText = (n) => ({ 24: "يوم", 48: "يومين", 168: "أسبوع" })[n] || `${cnt(n)} ساعة`;
  let cfgP = null; // GET /api/ads/config (limits), fetched once per chunk load
  const loadCfg = () => (cfgP ||= api("GET", "/api/ads/config").catch(() => { cfgP = null; return {}; }));

  /* k-anonymity: masked counts arrive as null / "<10" / {lt:10}; 1–9 are also masked client-side */
  const masked = (v) => v == null || (typeof v === "object" && v !== null) || /^(<\s*10|lt_?10|under_?10|k_?anon)$/i.test(String(v)) || (Number(v) > 0 && Number(v) < 10);
  const kv = (v) => masked(v) ? LT10 : cnt(v);
  function bucketText(r) {
    const b = r?.bucket ?? r?.audience ?? r?.estimate ?? r?.size ?? r;
    if (b == null || b === "") return "—";
    if (typeof b === "object") {
      if (b.label && /[\u0600-\u06FF]/.test(b.label)) return b.label;
      if (b.lt != null || b.kAnon || b.below) return LT10;
      if (b.max != null && Number(b.max) < 10) return LT10;
      if (b.min != null && b.max != null) return `${cnt(b.min)} – ${cnt(b.max)}`;
      if (b.min != null) return `أكثر من ${cnt(b.min)}`;
      return "—";
    }
    if (typeof b === "number") return b < 10 ? LT10 : `≈ ${cnt(b)}`;
    return masked(b) ? LT10 : String(b);
  }

  /* campaign shape: camelCase, snake_case accepted */
  function norm(c) {
    c = c?.campaign || c || {};
    const g = (...k) => k.map(x => c[x]).find(v => v !== undefined);
    const fc = g("freqCap", "freq_cap") || {}, bu = c.budget && typeof c.budget === "object" ? c.budget : {};
    return { ...c, id: c.id, name: g("name") || "", objective: g("objective") || "reach", status: g("status") || "draft", postId: g("postId", "post_id") || c.post?.id || null, post: c.post || null,
      targeting: { topics: list(c.targeting?.topics), languages: list(c.targeting?.languages), countries: list(c.targeting?.countries) },
      budgetTotal: Number(g("budgetTotal", "budget_total") ?? (typeof c.budget === "object" ? bu.total : c.budget)) || 0, dailyCap: Number(g("dailyCap", "daily_cap") ?? bu.dailyCap) || 0,
      freqCap: { impressions: Number(fc.impressions) || 3, perHours: Number(fc.perHours ?? fc.per_hours) || 24 },
      startAt: g("startAt", "start_at") || null, endAt: g("endAt", "end_at") || null, reviewNote: g("reviewNote", "review_note") || "",
      reviewReasons: ((r) => r.length ? r : list(c.review?.reasons))(list(g("reviewReasons", "review_reasons", "reasons"))), spent: g("spent", "spend") ?? bu.spent, funded: g("funded", "fundedAmount", "funded_amount") ?? bu.funded, actions: Array.isArray(c.actions) ? c.actions : null, stats: c.stats || null };
  }

  /* ---------- styles (kept out of the core CSS budget) ---------- */
  if (!document.getElementById("ad-css")) document.head.insertAdjacentHTML("beforeend", `<style id="ad-css">
.ad-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ad-n{white-space:nowrap;font-variant-numeric:tabular-nums}.ad-page{max-width:680px;margin:auto}.ad-ul{list-style:none;margin:0;padding:0}.ad-end{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.ad-why li>.ix{color:var(--accent);margin-top:3px}.ad-menu .btn,.ad-btns .btn{display:inline-flex;align-items:center;gap:8px}.ad-btns .btn{justify-content:center}.ad-del{color:var(--danger)}.ad-page h2:focus,.ad-sheet h3:focus{outline:none}
.ad-card{border:1.5px solid #e9c46a}[data-theme=dark] .ad-card{border-color:#7a5d17}
.ad-tag{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px;margin:0 0 6px;color:var(--text-2)}
.ad-lbl{display:inline-flex;align-items:center;font-weight:800;font-size:12.5px;border-radius:999px;padding:2px 10px;background:#fff3d6;color:#5c3800}[data-theme=dark] .ad-lbl{background:#3a2c0c;color:#ffd27a}
.ad-by a{color:inherit;font-weight:700}
.ad-menu{display:flex;flex-direction:column;gap:8px;margin:8px 0}.ad-menu button,.ad-menu a{width:100%;text-align:start;min-height:44px;justify-content:flex-start;text-decoration:none}
.ad-why{margin:8px 0;padding:0;list-style:none}.ad-why li{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)}.ad-why li:last-child{border:0}
.ad-f{display:block;margin:10px 0}.ad-f>span{display:block;font-weight:700;margin-bottom:4px;font-size:14px}.ad-f input,.ad-f select,.ad-f textarea{width:100%;box-sizing:border-box;border:1.5px solid var(--line);border-radius:12px;padding:9px 12px;font:inherit;background:var(--card);color:inherit;min-height:44px}
.ad-f input[aria-invalid=true],.ad-f select[aria-invalid=true]{border-color:#c62828}.ad-err{color:#a11616;font-weight:600;min-height:1em;margin:4px 0;font-size:13.5px}[data-theme=dark] .ad-err{color:#ff9a9a}
.ad-page fieldset{border:1.5px solid var(--line);border-radius:14px;padding:10px 12px;margin:10px 0}.ad-page legend{font-weight:800;padding:0 6px}
.ad-steps{display:flex;gap:6px;list-style:none;padding:0;margin:0 0 12px;counter-reset:s}.ad-steps li{flex:1;text-align:center;font-size:12.5px;font-weight:700;padding:6px 2px;border-bottom:3px solid var(--line);color:var(--text-2)}
.ad-steps li[aria-current=step]{border-color:var(--accent);color:var(--text)}.ad-steps li.done{border-color:#18a676}
.ad-posts{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto}.ad-opt{display:flex;gap:10px;align-items:flex-start;padding:10px;border:1.5px solid var(--line);border-radius:12px;cursor:pointer}
.ad-opt:has(input:checked){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent)}.ad-opt input{width:20px;height:20px;margin:2px 0 0;flex:none}.ad-opt small{display:block;color:var(--text-2)}
.ad-chips{display:flex;flex-wrap:wrap;gap:6px}.ad-chips button{min-height:40px;border-radius:999px;border:1.5px solid var(--line);background:var(--card);color:inherit;padding:4px 14px;font:inherit;cursor:pointer}
.ad-chips button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#fff}
.ad-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:4px 10px;max-height:220px;overflow:auto}.ad-checks label{display:flex;align-items:center;gap:8px;min-height:36px}.ad-checks input{width:18px;height:18px;margin:0}
.ad-est{position:sticky;bottom:calc(var(--nav-h,64px) + 8px);background:var(--card);box-shadow:var(--sh-2);border-radius:14px;padding:10px 14px;margin:12px 0;display:flex;justify-content:space-between;gap:8px;align-items:center}.ad-est b{font-size:17px}
.ad-note{border-inline-start:4px solid #e8a412;padding:8px 12px;border-radius:10px;background:var(--bg-2);font-size:13.5px;margin:8px 0}
.ad-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.ad-btns>*{flex:1 1 130px;text-align:center;text-decoration:none}
.ad-row{display:flex;align-items:flex-start;gap:10px;padding:12px 0;border-bottom:1px solid var(--line)}.ad-row:last-child{border:0}.ad-row .grow{flex:1;min-width:0}.ad-row .grow>a{font-weight:800;display:block;overflow:hidden;text-overflow:ellipsis}
.ad-bar{height:10px;border-radius:999px;background:var(--bg-2);overflow:hidden;margin:6px 0}.ad-bar i{display:block;height:100%;background:var(--grad,var(--accent))}
.ad-chart svg{width:100%;height:auto;display:block}.ad-chart .b{fill:var(--accent);opacity:.85}.ad-chart .m{fill:var(--line)}.ad-chart .l{fill:none;stroke:#18a676;stroke-width:2.5}.ad-chart .d{fill:#18a676}.ad-chart text{font-size:11px;fill:var(--text-2)}
.ad-leg{display:flex;gap:14px;font-size:12.5px;color:var(--text-2);margin:4px 0}.ad-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:4px;vertical-align:middle}
.ad-dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px;margin:8px 0}.ad-dl dt{font-weight:700;color:var(--text-2)}.ad-dl dd{margin:0}
.ad-prev{pointer-events:none;opacity:.97}.ad-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}.ad-sw input{width:46px;height:26px;flex:none}
.ad-page [hidden],.ad-sheet [hidden]{display:none!important}
</style>`);

  /* =================== promoted feed card =================== */
  const AD = new Map(); // campaignId → { promoted, postId }
  const hid = { ads: new Set(), adv: new Set() };
  const advKey = (a) => (a && (a.handle || a.id)) || "";
  const shown = (pr) => pr && pr.campaignId && !hid.ads.has(pr.campaignId) && !hid.adv.has(advKey(pr.advertiser));
  function promotedMap(mode) {
    const st = window.MPDiscovery?.state?.()?.FD; if (!st || typeof mode !== "string") return null;
    const eff = mode === "for" && st.prefs?.chrono ? "chrono" : mode, m = new Map();
    for (const sp of st.ranked?.[eff]?.posts || []) if (sp?.promoted) m.set(sp.id, { ...sp.promoted, token: sp.promoted.token ?? sp.adToken ?? sp.token ?? null });
    return m;
  }
  function mark(arr, mode) {
    if (!Array.isArray(arr)) return arr;
    const m = promotedMap(mode), used = new Set();
    const out = arr.map(p => { const pr = p && (p.promoted || m?.get(p.id)); if (!pr) return p; if (!shown(pr) || used.has(pr.campaignId)) return null; used.add(pr.campaignId); return p.promoted === pr ? p : { ...p, promoted: pr }; }).filter(Boolean);
    if (out[0]?.promoted && out.length > 1) out.splice(1, 0, out.shift()); // never the first slot
    return out;
  }
  if (typeof Feed !== "undefined") { const _b = Feed.build; Feed.build = function (mode) { return mark(_b.apply(Feed, arguments), mode); }; }
  if (typeof Views !== "undefined" && Views.home) {
    const _home = Views.home;
    Views.home = function () { // outermost at call time, whatever chunk wrapped Feed.build last
      const b = Feed.build; Feed.build = function (mode) { return mark(b.apply(Feed, arguments), mode); };
      try { return _home.apply(this, arguments); } finally { Feed.build = b; setTimeout(watch, 0); }
    };
  }
  function promo(p, html) {
    const pr = p.promoted, cid = String(pr.campaignId), adv = pr.advertiser || {}, lid = "ad-l-" + h(cid) + "-" + h(p.id);
    AD.set(cid, { promoted: pr, postId: p.id });
    const advName = adv.name || (adv.handle ? "@" + adv.handle : "معلن");
    const head = `<div class="ad-tag" id="${lid}"><span class="ad-lbl">${h(pr.label || "مُروَّج")}</span><span aria-hidden="true">·</span><span class="ad-by">من ${adv.handle ? `<a href="#/u/${enc(adv.handle)}">${h(advName)}</a>` : h(advName)}</span><span class="ad-sr">، محتوى إعلاني</span></div>`;
    html = html.replace(/<div class="card([^"]*)"([^>]*)>/, (_m, c, rest) => `<div class="card${c} ad-card" data-ad="${h(cid)}" data-ad-post="${h(p.id)}" role="article" aria-labelledby="${lid}"${rest}>${head}`);
    return html.replace(new RegExp(`<button([^>]*?)data-more="${p.id.replace(/[^\w-]/g, "")}"([^>]*)>`), (_m, a, b) => `<button${(a + b).replace(/\s(aria-label|title|aria-haspopup)="[^"]*"/g, "")} data-more="${h(p.id)}" data-ad-more="${h(cid)}" aria-haspopup="dialog" aria-label="خيارات الإعلان: ${h(advName)}">`);
  }
  if (typeof postCard === "function") {
    const _pc = postCard;
    postCard = function (p) { const html = _pc.apply(this, arguments); return p?.promoted?.campaignId && !p.repostOf && shown(p.promoted) ? promo(p, html) : html; };
  }
  /* events: impression (≥ 50 % for ≥ 1 s, once per feed token) and click (once, on open) */
  const sent = new Set();
  function send(cid, type) {
    const pr = AD.get(cid)?.promoted || {}, k = type + "|" + cid + "|" + (pr.token || "");
    if (sent.has(k) || !online()) return; sent.add(k);
    api("POST", "/api/ads/events", { campaignId: cid, type, token: pr.token ?? null }).catch(() => { });
  }
  let io = null; const timers = new Map();
  function watch() {
    if (!("IntersectionObserver" in window) || !view) return;
    io ||= new IntersectionObserver((ens) => {
      for (const en of ens) {
        const el = en.target, cid = el.dataset.ad, enough = en.isIntersecting && (en.intersectionRatio >= 0.5 || en.intersectionRect.height >= innerHeight * 0.5);
        if (enough && !timers.has(el)) timers.set(el, setTimeout(() => { timers.delete(el); if (!el.isConnected || document.hidden) return; io.unobserve(el); send(cid, "impression"); }, 1000));
        else if (!enough && timers.has(el)) { clearTimeout(timers.get(el)); timers.delete(el); }
      }
    }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
    view.querySelectorAll(".ad-card[data-ad]:not([data-ad-w])").forEach(c => { c.dataset.adW = "1"; io.observe(c); });
  }
  // window capture runs before the core's document-level handlers (double-tap / open-post stop propagation there)
  let pending = null; // a click inside an ad card counts once the post (or the advertiser) actually opens
  addEventListener("click", (e) => {
    const m = e.target.closest?.("[data-ad-more]");
    if (m) { e.preventDefault(); e.stopImmediatePropagation(); return menu(m.dataset.adMore, m); }
    const c = e.target.closest?.(".ad-card[data-ad]");
    pending = c && !e.target.closest(".actions,[data-react],[data-share],[data-save],[data-vote]") ? { cid: c.dataset.ad, at: Date.now() } : null;
  }, true);
  addEventListener("hashchange", () => { const p = pending; pending = null; if (p && Date.now() - p.at < 2500 && /^#\/(post|u)\//.test(location.hash)) send(p.cid, "click"); });
  const advOf = (cid) => AD.get(cid)?.promoted?.advertiser || {};
  const advLabel = (a) => a.name || (a.handle ? "@" + a.handle : "هذا المعلن");
  function openSheet(html, ret) { const s = sheet(`<div class="ad-sheet" role="dialog" aria-modal="true" aria-labelledby="ad-st">${html}</div>`); s._onclose = () => { if (ret?.isConnected) ret.focus(); }; setTimeout(() => s.querySelector("#ad-st")?.focus(), 30); return s; }
  function menu(cid, btn) {
    const a = advOf(cid);
    const s = openSheet(`<h3 id="ad-st" tabindex="-1" class="u-my4">إعلان مُروَّج من ${h(advLabel(a))}</h3>
      <div class="ad-menu"><button type="button" class="btn ghost" id="ad-m-why">${UI.icon("help","sm")} لماذا أرى هذا الإعلان؟</button><button type="button" class="btn ghost" id="ad-m-ad">${UI.icon("eye","sm")} إخفاء الإعلان</button>
      <button type="button" class="btn ghost" id="ad-m-adv">${UI.icon("x","sm")} إخفاء هذا المعلن</button><button type="button" class="btn ghost" data-ui="close-sheet">إلغاء</button></div>`, btn);
    s.querySelector("#ad-m-why").onclick = () => why(cid, btn);
    s.querySelector("#ad-m-ad").onclick = () => hideSheet(cid, "ad", btn);
    s.querySelector("#ad-m-adv").onclick = () => hideSheet(cid, "advertiser", btn);
  }
  const WHY = { topic: (r) => `لأنك تتابع موضوع «${h(r.name || topicName(r.topic))}» أو اخترته ضمن اهتماماتك.`, language: () => "لأن لغة الإعلان تطابق لغة التطبيق لديك.", country: () => "لأن البلد في إعدادات ملفك الشخصي ضمن البلدان المستهدفة (لا نستخدم موقعك الجغرافي).", general: () => "إعلان عام يظهر لجميع البالغين دون تخصيص." };
  async function why(cid, ret) {
    const s = openSheet(`<h3 id="ad-st" tabindex="-1" class="u-m0 u-mt4 u-mb8">لماذا أرى هذا الإعلان؟</h3><div id="ad-wb" aria-busy="true"><div class="skel"></div></div>`, ret);
    let r; try { r = await api("GET", `/api/ads/why/${enc(cid)}`); } catch (e) { const b = s.querySelector("#ad-wb"); if (b) { b.removeAttribute("aria-busy"); b.innerHTML = `<p class="ad-err" role="alert">${h(errText(e))}</p><button type="button" class="btn ghost" data-ui="close-sheet">إغلاق</button>`; } return; }
    const b = s.querySelector("#ad-wb"); if (!b) return; b.removeAttribute("aria-busy");
    const rs = list(r, "reasons"), a = advOf(cid);
    b.innerHTML = `<p class="u-m0 u-mb6">يروّج <b>${h(advLabel(a))}</b> هذا المنشور. ${r?.personalized === false ? "الإعلانات المخصصة متوقفة لديك، لذا يظهر لك إعلان عام فقط." : "اخترناه لك بناءً على:"}</p>
      <ul class="ad-why">${(rs.length ? rs : [{ type: "general" }]).map(x => `<li>${MPFeat.ico({ topic: "tag", language: "globe", country: "mapPin" }[x.type] || "mega")}<span>${(WHY[x.type] || WHY.general)(x)}</span></li>`).join("")}</ul>
      <p class="ad-note">لا نتتبعك خارج مجتمع بلس، ولا نستخدم رسائلك أو منشوراتك الخاصة أو موقعك، ولا يرى المعلن هويتك؛ يرى أرقاماً مجمّعة فقط.</p>
      <div class="ad-menu"><a class="btn ghost" href="#/settings/ads" id="ad-w-prefs">${UI.icon("settings","sm")} تفضيلات الإعلانات</a><button type="button" class="btn ghost" id="ad-w-ad">${UI.icon("eye","sm")} إخفاء الإعلان</button><button type="button" class="btn ghost" id="ad-w-adv">${UI.icon("x","sm")} إخفاء هذا المعلن</button></div>`;
    b.querySelector("#ad-w-prefs").onclick = () => closeSheet();
    b.querySelector("#ad-w-ad").onclick = () => hideSheet(cid, "ad", ret);
    b.querySelector("#ad-w-adv").onclick = () => hideSheet(cid, "advertiser", ret);
    say("أسباب ظهور الإعلان معروضة");
  }
  function hideSheet(cid, scope, ret) {
    const a = advOf(cid), card = ret?.closest?.(".ad-card");
    const s = openSheet(`<h3 id="ad-st" tabindex="-1" class="u-my4">${scope === "ad" ? "إخفاء هذا الإعلان" : `إخفاء كل إعلانات ${h(advLabel(a))}`}</h3><p class="u-m0 u-mb8 muted">ما السبب؟ يساعدنا ذلك على تحسين الإعلانات (لا يُشارك مع المعلن إلا مجمّعاً).</p>
      <div class="ad-menu" role="group" aria-label="سبب الإخفاء">${HIDE_R.map(([k, t]) => `<button type="button" class="btn ghost" data-ad-hr="${k}">${h(t)}</button>`).join("")}<button type="button" class="btn ghost" data-ui="close-sheet">إلغاء</button></div><p class="ad-err" id="ad-he" role="alert"></p>`, ret);
    s.querySelectorAll("[data-ad-hr]").forEach(b => b.onclick = async () => {
      s.querySelectorAll("button").forEach(x => (x.disabled = true));
      try { await api("POST", "/api/ads/hide", { campaignId: cid, scope, reason: b.dataset.adHr }); }
      catch (e) { s.querySelectorAll("button").forEach(x => (x.disabled = false)); s.querySelector("#ad-he").textContent = errText(e); return; }
      if (scope === "ad") hid.ads.add(cid); else hid.adv.add(advKey(a));
      const gone = [...document.querySelectorAll(".ad-card[data-ad]")].filter(c => scope === "ad" ? c.dataset.ad === cid : advKey(advOf(c.dataset.ad)) === advKey(a));
      const next = (card || gone[0])?.nextElementSibling;
      s._onclose = null; closeSheet(); gone.forEach(c => c.remove());
      const msg = scope === "ad" ? "أُخفي الإعلان. لن يظهر لك مجدداً." : `لن تظهر لك إعلانات ${advLabel(a)} بعد الآن.`;
      toast(msg); say(msg); (next?.querySelector("a,button") || document.getElementById("view"))?.focus?.({ preventScroll: true });
    });
  }

  /* =================== Pi availability =================== */
  async function piOn() { try { const c = online() ? await A()?.config?.() : null; return !!c?.enabled; } catch { return false; } }

  /* =================== #/ads — campaign list =================== */
  const intro = "روّج منشوراتك العامة لجمهور مهتم بمواضيعها، دون تتبع، ودون أن يرى المعلن هوية أحد. تُراجع كل حملة قبل نشرها.";
  async function listView() {
    const t = begin();
    view.innerHTML = `<div class="wrap ad-page">${UI.pageHead({ back: ["#/settings", "الإعدادات"], title: "حملاتي الإعلانية", icon: "mega", sub: intro, id: "ad-h", actions: `<a class="btn" href="#/ads/new" id="ad-new">${UI.icon("plus","sm")} حملة جديدة</a><a class="btn outline" href="#/settings/ads">${UI.icon("settings","sm")} تفضيلات الإعلانات</a>` })}
      <div class="card" id="ad-list" aria-busy="true"><div class="skel"></div><div class="skel"></div></div></div>`;
    focusH();
    let r; try { r = await api("GET", "/api/ads/campaigns"); } catch (e) { if (!live(t)) return; return fail("#ad-list", e); }
    if (!live(t)) return;
    const items = list(r, "items", "campaigns").map(norm).filter(c => c.status !== "removed"), box = view.querySelector("#ad-list");
    box.removeAttribute("aria-busy");
    box.innerHTML = items.length ? `<ul class="ad-ul" aria-label="الحملات">${items.map(c => `<li class="ad-row" data-ad-c="${h(c.id)}"><div class="grow"><a href="#/ads/campaigns/${enc(c.id)}">${h(c.name || "حملة بلا اسم")}</a>
      <small class="muted">${h(OBJ[c.objective]?.[0] || c.objective)} · الميزانية ${pi(c.budgetTotal)}${c.startAt ? ` · ${h(dayF(c.startAt))} – ${h(dayF(c.endAt))}` : ""}</small></div>
      <div class="ad-end">${chip(c.status)}${["draft", "rejected"].includes(c.status) ? `<a href="#/ads/edit/${enc(c.id)}" class="muted" aria-label="تعديل ${h(c.name)}">تعديل</a>` : ""}</div></li>`).join("")}</ul>`
      : UI.empty({ title: "لا حملات بعد", text: "ابدأ بترويج أحد منشوراتك العامة.", action: `<a class="btn" href="#/ads/new">${UI.icon("plus","sm")} حملة جديدة</a>` });
  }
  function fail(sel, e) {
    const b = view.querySelector(sel); if (!b) return;
    b.removeAttribute("aria-busy");
    b.innerHTML = `<p class="ad-err" role="alert">${h(errText(e))}</p>${e?.code === "minor_restricted" ? "" : `<button type="button" class="btn ghost" data-ui="route">إعادة المحاولة</button>`}`;
  }

  /* =================== #/ads/new, #/ads/edit/:id — wizard =================== */
  const STEPS = ["المنشور", "الجمهور", "الميزانية", "المراجعة"];
  const isoDay = (d) => { const x = d ? new Date(d) : new Date(); return isNaN(x) ? "" : new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const eligible = () => (typeof DB !== "undefined" ? DB.posts || [] : []).filter(p => p.author === DB.me && p.status !== "deleted" && (p.status || "published") === "published" && (p.visibility || "public") === "public" && !p.locked && !p.paid?.mode && p.type !== "story" && !p.repostOf && (!p.community || S.community(p.community)?.type === "public")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 40);
  const preview = (p) => { const s = String(p?.title || p?.text || p?.teaser || "").replace(/\s+/g, " ").trim(); return s.length > 110 ? s.slice(0, 105) + "…" : s || "منشور بلا نص"; };
  let topicsP = null;
  const loadTopics = () => (topicsP ||= api("GET", "/api/ads/topics").then(r => list(r, "topics", "items").map(t => typeof t === "string" ? { slug: t, name: topicName(t) } : { slug: t.slug || t.id, name: t.name || topicName(t.slug || t.id) })).catch((e) => { topicsP = null; throw e; }));
  async function wizard(id) {
    const t = begin();
    const W = { step: 1, id: id || null, postId: null, post: null, name: "", objective: "reach", targeting: { topics: [], languages: [], countries: [] }, budgetTotal: "", dailyCap: "", startAt: isoDay(), endAt: isoDay(Date.now() + 7 * 864e5), freqCap: { impressions: 3, perHours: 24 }, pi: false, minB: 1, maxB: MAXB, maxF: 20, maxH: 24 };
    view.innerHTML = `<div class="wrap ad-page">${head(id ? "#/ads/campaigns/" + enc(id) : "#/ads", id ? "الحملة" : "حملاتي", id ? "تعديل الحملة" : "حملة جديدة", id ? "pen" : "mega")}
      <ol class="ad-steps" id="ad-steps" aria-label="خطوات إنشاء الحملة">${STEPS.map((s, i) => `<li data-s="${i + 1}"><span class="ad-sr">الخطوة ${i + 1}: </span>${h(s)}</li>`).join("")}</ol>
      <form id="ad-wz" novalidate aria-busy="true"><div class="skel"></div></form></div>`;
    focusH();
    try {
      const cf = await loadCfg(), fcf = cf?.freqCap || {}; if (!live(t)) return;
      if (Number(cf?.minBudget) > 0) W.minB = Number(cf.minBudget);
      if (Number(cf?.maxBudget) > 0) W.maxB = Number(cf.maxBudget);
      if (Number(fcf.maxImpressions) > 0) W.maxF = Number(fcf.maxImpressions);
      if (Number(fcf.maxHours) > 0) W.maxH = Number(fcf.maxHours);
      if (id) {
        const c = norm(await api("GET", `/api/ads/campaigns/${enc(id)}`)); if (!live(t)) return;
        if (!["draft", "rejected"].includes(c.status)) { view.querySelector("#ad-wz").outerHTML = `<div class="card"><p>${chip(c.status)} لا يمكن تعديل الحملة في هذه الحالة.</p><a class="btn ghost" href="#/ads/campaigns/${enc(id)}">لوحة الحملة</a></div>`; return; }
        Object.assign(W, { postId: c.postId, post: c.post, name: c.name, objective: c.objective, targeting: { topics: c.targeting.topics.map(x => typeof x === "object" ? x.slug || x.id : x), languages: [...c.targeting.languages], countries: [...c.targeting.countries] },
          budgetTotal: c.budgetTotal || "", dailyCap: c.dailyCap || "", startAt: c.startAt ? isoDay(c.startAt) : W.startAt, endAt: c.endAt ? isoDay(c.endAt) : W.endAt, freqCap: c.freqCap, reviewNote: c.reviewNote, status: c.status });
      }
      W.pi = await piOn();
    } catch (e) { if (live(t)) fail("#ad-wz", e); return; }
    if (!live(t)) return;
    const form = view.querySelector("#ad-wz"); form.removeAttribute("aria-busy");
    form.onsubmit = (e) => e.preventDefault();
    const $f = (s) => form.querySelector(s);
    const err = (fid, msg, focusSel) => { const p = form.querySelector("#ad-e-" + fid); if (p) p.textContent = msg || ""; const inp = focusSel && form.querySelector(focusSel); if (inp) { inp.setAttribute("aria-invalid", msg ? "true" : "false"); if (msg) inp.focus(); } return !msg; };
    const stepper = () => view.querySelectorAll("#ad-steps li").forEach(li => { const n = +li.dataset.s; li.classList.toggle("done", n < W.step); n === W.step ? li.setAttribute("aria-current", "step") : li.removeAttribute("aria-current"); });
    const nav = (last) => `<div class="ad-btns">${W.step > 1 ? `<button type="button" class="btn ghost" id="ad-prev">السابق</button>` : `<a class="btn ghost" href="#/ads">إلغاء</a>`}${last || `<button type="button" class="btn" id="ad-next">التالي</button>`}</div>`;
    let estT = null, estN = 0;
    function estimate() {
      clearTimeout(estT); const box = $f("#ad-est b"); if (!box) return;
      box.textContent = "…"; const n = ++estN;
      estT = setTimeout(async () => {
        try { const r = await api("POST", "/api/ads/estimate", { targeting: W.targeting }); if (n === estN && $f("#ad-est b")) { $f("#ad-est b").textContent = bucketText(r); } }
        catch { if (n === estN && $f("#ad-est b")) $f("#ad-est b").textContent = "تعذّر التقدير"; }
      }, 400);
    }
    const S1 = () => {
      const posts = eligible(); if (W.post && W.postId && !posts.some(p => p.id === W.postId)) posts.unshift({ ...W.post, id: W.postId });
      return `<fieldset><legend>1. اختر منشوراً من منشوراتك العامة</legend>
        ${posts.length ? `<div class="ad-posts" role="radiogroup" aria-describedby="ad-e-post">${posts.map(p => `<label class="ad-opt"><input type="radio" name="ad-post" value="${h(p.id)}" ${p.id === W.postId ? "checked" : ""}><span><b>${h(preview(p))}</b><small>${h(dayF(p.createdAt))}${p.topic ? " · " + h(topicName(p.topic)) : ""}</small></span></label>`).join("")}</div>`
          : `<p class="muted">لا منشورات عامة يمكن ترويجها بعد. المنشورات المدفوعة والخاصة ومنشورات المجتمعات المغلقة لا تُروّج.</p><button type="button" class="btn ghost" data-ui="compose">${UI.icon("pen","sm")} منشور جديد</button>`}
        <p class="ad-err" id="ad-e-post"></p></fieldset>
        <label class="ad-f"><span>اسم الحملة (لك وحدك)</span><input id="ad-name" maxlength="80" autocomplete="off" value="${h(W.name)}" aria-describedby="ad-e-name"></label><p class="ad-err" id="ad-e-name"></p>
        <fieldset><legend>الهدف</legend>${Object.entries(OBJ).map(([k, [a, b]]) => `<label class="ad-opt"><input type="radio" name="ad-obj" value="${k}" ${W.objective === k ? "checked" : ""}><span><b>${h(a)}</b><small>${h(b)}</small></span></label>`).join("")}</fieldset>${nav()}`;
    };
    const S2 = () => `<fieldset><legend>2. الجمهور: المواضيع</legend><p class="u-m0 u-mb8 muted">يظهر الإعلان لمن يتابع هذه المواضيع أو اختارها بنفسه. اتركها فارغة لجمهور عام.</p>
        <div class="ad-chips" id="ad-topics" role="group" aria-label="المواضيع المستهدفة" aria-busy="true"><div class="skel"></div></div>
        <p class="ad-note">${UI.icon("lock","sm")} الفئات الحساسة (الصحة، الدين، السياسة، الميول، العِرق) لا يمكن استهدافها، ولا نستخدم سجل التصفح أو الرسائل أو الموقع.</p><p class="ad-err" id="ad-e-tg" role="alert"></p></fieldset>
      <fieldset><legend>اللغة</legend><div class="ad-checks">${LANGS.map(([k, n]) => `<label><input type="checkbox" data-ad-lang="${k}" ${W.targeting.languages.includes(k) ? "checked" : ""}><span lang="${k}">${h(n)}</span></label>`).join("")}</div><p class="u-m0 u-mt6 u-t-sm muted">بلا اختيار = كل اللغات.</p></fieldset>
      <fieldset><legend>البلد</legend><p class="u-m0 u-mb6 u-t-sm muted">حسب البلد في إعدادات الملف الشخصي فقط، لا الموقع الجغرافي. بلا اختيار = كل البلدان.</p><div class="ad-checks">${COUNTRIES.map(([k, n]) => `<label><input type="checkbox" data-ad-cty="${k}" ${W.targeting.countries.includes(k) ? "checked" : ""}><span>${h(n)}</span></label>`).join("")}</div></fieldset>
      <div class="ad-est" id="ad-est" role="status" aria-live="polite" aria-atomic="true"><span>الجمهور المتوقع</span><b>…</b></div>${nav()}`;
    const S3 = () => `<fieldset><legend>3. الميزانية والجدول</legend>
        <label class="ad-f"><span>الميزانية الإجمالية (Pi)</span><input id="ad-budget" type="number" inputmode="decimal" min="${h(W.minB)}" max="${h(W.maxB)}" step="0.01" dir="ltr" value="${h(W.budgetTotal)}" aria-describedby="ad-e-budget ad-hint"></label><p class="ad-err" id="ad-e-budget"></p>
        <label class="ad-f"><span>الحد اليومي (Pi)</span><input id="ad-daily" type="number" inputmode="decimal" min="0.01" step="0.01" dir="ltr" value="${h(W.dailyCap)}" aria-describedby="ad-e-daily ad-hint"></label><p class="ad-err" id="ad-e-daily"></p>
        <div class="u-dflex u-g10 u-fww"><label class="ad-f" style="flex:1 1 140px"><span>تاريخ البدء</span><input id="ad-start" type="date" value="${h(W.startAt)}" aria-describedby="ad-e-dates"></label>
        <label class="ad-f" style="flex:1 1 140px"><span>تاريخ الانتهاء</span><input id="ad-end" type="date" value="${h(W.endAt)}" aria-describedby="ad-e-dates"></label></div><p class="ad-err" id="ad-e-dates"></p>
        <p class="u-t-sm u-m0 muted" id="ad-hint" aria-live="polite"></p></fieldset>
      <fieldset><legend>حد التكرار</legend><p class="u-m0 u-mb6 u-t-sm muted">أقصى عدد مرات يرى فيها الشخص نفسه الإعلان.</p>
        <div class="u-dflex u-g10 u-fww"><label class="ad-f" style="flex:1 1 120px"><span>عدد المرات</span><input id="ad-fq" type="number" min="1" max="${h(W.maxF)}" step="1" dir="ltr" value="${h(W.freqCap.impressions)}" aria-describedby="ad-e-fq"></label>
        <label class="ad-f" style="flex:1 1 140px"><span>خلال</span><select id="ad-fh">${[...new Set([6, 12, 24, W.freqCap.perHours])].filter(v => v > 0 && v <= W.maxH).sort((a, b) => a - b).map((v) => `<option value="${v}" ${W.freqCap.perHours === v ? "selected" : ""}>${h(hrsText(v))}</option>`).join("")}</select></label></div><p class="ad-err" id="ad-e-fq"></p></fieldset>${nav()}`;
    const S4 = () => {
      const p = (typeof S !== "undefined" && S.post(W.postId)) || (W.post ? { ...W.post, id: W.postId } : null), me = (() => { try { return S.me(); } catch { return {}; } })() || {};
      let pv = ""; try { pv = p && typeof postCard === "function" && S.user(p.author) ? postCard({ ...p, promoted: { campaignId: "preview", label: "مُروَّج", advertiser: { handle: me.handle, name: me.name } } }) : ""; } catch { pv = ""; }
      const tg = W.targeting;
      return `<fieldset><legend>4. المراجعة والإرسال</legend>
        <dl class="ad-dl"><dt>الحملة</dt><dd>${h(W.name)}</dd><dt>الهدف</dt><dd>${h(OBJ[W.objective]?.[0])}</dd><dt>المنشور</dt><dd>${h(preview(p))}</dd>
        <dt>المواضيع</dt><dd>${tg.topics.length ? tg.topics.map(x => h(topicName(x))).join("، ") : "جمهور عام"}</dd><dt>اللغة</dt><dd>${tg.languages.length ? tg.languages.map(x => h(nameOf(LANGS, x))).join("، ") : "كل اللغات"}</dd>
        <dt>البلد</dt><dd>${tg.countries.length ? tg.countries.map(x => h(nameOf(COUNTRIES, x))).join("، ") : "كل البلدان"}</dd><dt>الميزانية</dt><dd>${pi(W.budgetTotal)} · يومياً حتى ${pi(W.dailyCap)}</dd>
        <dt>المدة</dt><dd>${h(dayF(W.startAt))} – ${h(dayF(W.endAt))}</dd><dt>التكرار</dt><dd>حتى ${cnt(W.freqCap.impressions)} مرات كل ${h(hrsText(W.freqCap.perHours))}</dd></dl>
        ${pv ? `<p class="u-fw7 u-m0 u-mt10 u-mb4">معاينة كما سيظهر في الخلاصة</p><div class="ad-prev" inert aria-hidden="true">${pv}</div>` : ""}
        <p class="ad-note">يُراجع فريق الإشراف الإعلان قبل نشره. بعد الموافقة تموّل الحملة بعملة Pi، ولا يُخصم إلا ما يُستهلك فعلاً.${W.pi ? "" : ` <b>${OFF}:</b> يمكنك إرسال الحملة للمراجعة الآن، والتمويل يُتاح لاحقاً.`}</p>
        ${W.reviewNote ? `<p class="ad-note" role="note"><b>ملاحظة المراجعة السابقة:</b> ${h(W.reviewNote)}</p>` : ""}
        <div class="ad-err" id="ad-es" role="alert" tabindex="-1"></div></fieldset>
        ${nav(`<button type="button" class="btn ghost" id="ad-draft">حفظ كمسودة</button><button type="button" class="btn" id="ad-submit">إرسال للمراجعة</button>`)}`;
    };
    function read() {
      if (W.step === 1) { W.postId = $f("input[name=ad-post]:checked")?.value || null; W.name = ($f("#ad-name")?.value || "").trim(); W.objective = $f("input[name=ad-obj]:checked")?.value || "reach"; }
      if (W.step === 3) { W.budgetTotal = $f("#ad-budget").value; W.dailyCap = $f("#ad-daily").value; W.startAt = $f("#ad-start").value; W.endAt = $f("#ad-end").value; W.freqCap = { impressions: Number($f("#ad-fq").value), perHours: Number($f("#ad-fh").value) }; }
    }
    function valid() {
      if (W.step === 1) {
        let ok = err("post", W.postId ? "" : "اختر المنشور الذي تريد ترويجه.", W.postId ? null : "input[name=ad-post]");
        const nOk = W.name.length >= 3; ok = err("name", nOk ? "" : "اكتب اسماً للحملة من 3 أحرف على الأقل.", "#ad-name") && ok;
        if (!W.postId && nOk) $f("input[name=ad-post]")?.focus();
        return ok;
      }
      if (W.step === 3) {
        const b = Number(W.budgetTotal), d = Number(W.dailyCap), f = W.freqCap.impressions, today = isoDay();
        const eb = !(b >= W.minB) ? `الميزانية يجب أن تكون ${num(W.minB)} Pi على الأقل.` : b > W.maxB ? `الميزانية القصوى ${num(W.maxB)} Pi.` : "";
        const ed = !(d > 0) ? "أدخل حداً يومياً أكبر من صفر." : d > b ? "الحد اليومي لا يتجاوز الميزانية الإجمالية." : "";
        const et = !W.startAt || !W.endAt ? "حدّد تاريخي البدء والانتهاء." : (!W.id && W.startAt < today) ? "تاريخ البدء لا يكون في الماضي." : W.endAt < W.startAt ? "تاريخ الانتهاء بعد تاريخ البدء." : "";
        const ef = !(Number.isInteger(f) && f >= 1 && f <= W.maxF) ? `حد التكرار عدد صحيح من 1 إلى ${W.maxF}.` : "";
        const okF = err("fq", ef, "#ad-fq"), okT = err("dates", et, et && W.startAt ? "#ad-end" : "#ad-start"), okD = err("daily", ed, "#ad-daily"), okB = err("budget", eb, "#ad-budget");
        return okB && okD && okT && okF;
      }
      return true;
    }
    const hint = () => { const b = Number($f("#ad-budget")?.value), d = Number($f("#ad-daily")?.value), el = $f("#ad-hint"); if (!el) return; el.textContent = b > 0 && d > 0 ? `تكفي الميزانية لنحو ${cnt(Math.ceil(b / d))} يوم بالحد اليومي.` : ""; };
    function render(focusFirst = true) {
      stepper(); form.innerHTML = [S1, S2, S3, S4][W.step - 1]();
      form.querySelector("#ad-prev")?.addEventListener("click", () => { read(); W.step--; render(); });
      form.querySelector("#ad-next")?.addEventListener("click", () => { read(); if (!valid()) return; W.step++; render(); });
      if (W.step === 2) {
        const box = $f("#ad-topics");
        loadTopics().then(ts => { if (!box.isConnected) return; box.removeAttribute("aria-busy"); const all = [...ts]; W.targeting.topics.forEach(s => { if (!all.some(x => x.slug === s)) all.push({ slug: s, name: topicName(s) }); });
          box.innerHTML = all.length ? all.map(x => `<button type="button" data-ad-topic="${h(x.slug)}" aria-pressed="${W.targeting.topics.includes(x.slug)}">${h(x.name)}</button>`).join("") : `<p class="muted">لا مواضيع متاحة للاستهداف الآن.</p>`;
          box.querySelectorAll("[data-ad-topic]").forEach(b => b.onclick = () => { const s = b.dataset.adTopic, on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); W.targeting.topics = on ? [...W.targeting.topics, s] : W.targeting.topics.filter(x => x !== s); err("tg", ""); estimate(); });
        }).catch(e => { if (box.isConnected) { box.removeAttribute("aria-busy"); box.innerHTML = `<p class="ad-err">${h(errText(e))}</p>`; } });
        form.querySelectorAll("[data-ad-lang]").forEach(c => c.onchange = () => { W.targeting.languages = [...form.querySelectorAll("[data-ad-lang]:checked")].map(x => x.dataset.adLang); estimate(); });
        form.querySelectorAll("[data-ad-cty]").forEach(c => c.onchange = () => { W.targeting.countries = [...form.querySelectorAll("[data-ad-cty]:checked")].map(x => x.dataset.adCty); estimate(); });
        estimate();
      }
      if (W.step === 3) { $f("#ad-budget").oninput = hint; $f("#ad-daily").oninput = hint; hint(); }
      if (W.step === 4) { $f("#ad-submit").onclick = () => save(true); $f("#ad-draft").onclick = () => save(false); }
      if (focusFirst) { const lg = form.querySelector("legend"); if (lg) { lg.tabIndex = -1; lg.focus({ preventScroll: false }); } say(`الخطوة ${W.step} من 4: ${STEPS[W.step - 1]}`); }
    }
    const body = () => ({ postId: W.postId, name: W.name, objective: W.objective, targeting: { topics: [...W.targeting.topics], languages: [...W.targeting.languages], countries: [...W.targeting.countries] },
      budgetTotal: Number(W.budgetTotal), dailyCap: Number(W.dailyCap), startAt: new Date(Math.max(Date.parse(W.startAt + "T00:00:00"), Date.now())).toISOString(), endAt: new Date(W.endAt + "T23:59:59").toISOString(), freqCap: { ...W.freqCap } });
    async function save(submit) {
      const btns = form.querySelectorAll(".ad-btns button"); btns.forEach(b => (b.disabled = true));
      const es = $f("#ad-es"); if (es) es.textContent = "";
      try {
        if (W.id) await api("PATCH", `/api/ads/campaigns/${enc(W.id)}`, body());
        else { const c = norm(await api("POST", "/api/ads/campaigns", body())); W.id = c.id; }
        if (submit) await api("POST", `/api/ads/campaigns/${enc(W.id)}/submit`);
        toast(submit ? "أُرسلت الحملة للمراجعة" : "حُفظت المسودة");
        location.hash = "#/ads/campaigns/" + enc(W.id);
      } catch (e) {
        if (!form.isConnected) return;
        const to = { post_invalid: [1, "post"], targeting_invalid: [2, "tg"], targeting_sensitive: [2, "tg"], budget_invalid: [3, "budget"] }[e?.code];
        if (to) { W.step = to[0]; render(false); err(to[1], errText(e)); (form.querySelector("#ad-e-" + to[1])?.previousElementSibling?.querySelector?.("input") || form.querySelector("legend"))?.focus?.(); say(errText(e)); return; }
        btns.forEach(b => (b.disabled = false));
        const box = $f("#ad-es"); if (box) { box.innerHTML = h(errText(e)) + (e?.code === "ad_rejected" && W.id ? ` <a href="#/ads/campaigns/${enc(W.id)}">لوحة الحملة</a>` : ""); box.focus(); }
      }
    }
    render(false);
  }

  /* =================== #/ads/campaigns/:id — dashboard =================== */
  function chart(days) {
    if (!days.length) return `<p class="muted">لا بيانات يومية بعد. تظهر الأرقام بعد بدء عرض الحملة.</p>`;
    const W = 600, H = 170, P = 22, n = days.length, bw = (W - P * 2) / n;
    const imp = days.map(d => masked(d.impressions) ? null : Number(d.impressions) || 0), clk = days.map(d => masked(d.clicks) ? null : Number(d.clicks) || 0);
    const mi = Math.max(10, ...imp.filter(x => x != null)), mc = Math.max(1, ...clk.filter(x => x != null)), y = (v, m) => H - P - (v / m) * (H - P * 2);
    const x = (i) => W - P - (i + 1) * bw; // RTL: oldest on the right
    const bars = days.map((d, i) => { const v = imp[i], ht = v == null ? 6 : Math.max(1, H - P - y(v, mi)); return `<rect class="${v == null ? "m" : "b"}" x="${(x(i) + bw * 0.15).toFixed(1)}" y="${(H - P - ht).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${ht.toFixed(1)}" rx="3"><title>${h(dayF(d.day, { day: "numeric", month: "short" }))}: ${h(kv(d.impressions))} ظهور، ${h(kv(d.clicks))} نقرة</title></rect>`; }).join("");
    const pts = clk.map((v, i) => v == null ? null : [x(i) + bw / 2, y(v, mc)]).filter(Boolean);
    const line = pts.length > 1 ? `<polyline class="l" points="${pts.map(p => p.map(z => z.toFixed(1)).join(",")).join(" ")}"/>` : "";
    const dots = pts.map(p => `<circle class="d" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3"/>`).join("");
    const lab = [0, n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => `<text x="${(x(i) + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${h(dayF(days[i].day, { day: "numeric", month: "short" }))}</text>`).join("");
    const sum = `الأداء اليومي لـ ${cnt(n)} يوم: أعمدة للظهور وخط للنقرات. التفاصيل في الجدول التالي.`;
    return `<div class="ad-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${h(sum)}" focusable="false"><line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="currentColor" stroke-opacity=".2"/>${bars}${line}${dots}${lab}</svg>
      <div class="ad-leg" aria-hidden="true"><span><i style="background:var(--accent)"></i>الظهور</span><span><i style="background:#18a676"></i>النقرات</span><span><i style="background:var(--line)"></i>${LT10}</span></div>
      <table class="ad-sr"><caption>الأداء اليومي</caption><thead><tr><th scope="col">اليوم</th><th scope="col">الظهور</th><th scope="col">النقرات</th><th scope="col">الإنفاق</th></tr></thead><tbody>${days.map(d => `<tr><th scope="row">${h(dayF(d.day))}</th><td>${h(kv(d.impressions))}</td><td>${h(kv(d.clicks))}</td><td>${h(num(d.spend || 0))} Pi</td></tr>`).join("")}</tbody></table></div>`;
  }
  function actionsFor(c) {
    if (c.actions) return c.actions;
    return { draft: ["edit", "submit", "delete"], rejected: ["edit", "delete"], in_review: [], awaiting_funds: ["fund", "delete"], active: ["pause"], paused: ["resume", "fund", "delete"], completed: [], removed: [] }[c.status] || [];
  }
  async function dashboard(id) {
    const t = begin();
    view.innerHTML = `<div class="wrap ad-page">${head("#/ads", "حملاتي", "لوحة الحملة", "chart")}<div id="ad-db" aria-busy="true"><div class="skel"></div><div class="skel"></div></div></div>`;
    focusH();
    let r, on; try { [r, on] = await Promise.all([api("GET", `/api/ads/campaigns/${enc(id)}`), piOn()]); } catch (e) { if (live(t)) fail("#ad-db", e); return; }
    if (!live(t)) return;
    const c = norm(r), st = r?.stats || c.stats || {}, days = list(st.days || st, "days").slice().sort((a, b) => String(a.day).localeCompare(String(b.day))), tot = st.totals || {};
    const sum = (k) => k in tot ? tot[k] : days.reduce((a, d) => masked(d[k]) ? a : a + Number(d[k] || 0), 0), imp = sum("impressions"), clk = sum("clicks");
    const spend = Number(tot.spend ?? c.spent ?? days.reduce((a, d) => a + Number(d.spend || 0), 0)) || 0;
    const pctCtr = "impressionsText" in tot || st.kAnon != null; // the P40 server sends CTR as a percentage (2 decimals)
    const ctr = tot.ctr != null && !masked(imp) ? (pctCtr ? Number(tot.ctr) / 100 : Number(tot.ctr)) : (!masked(imp) && !masked(clk) && Number(imp) > 0 ? Number(clk) / Number(imp) : null);
    if (c.piEnabled === false) on = false;
    const hides = list(st.hides).filter(x => x && x.reason);
    const ctrTxt = ctr == null ? "—" : `${(pctCtr || ctr <= 1 ? ctr * 100 : ctr).toLocaleString("ar-EG", { maximumFractionDigits: 2 })}٪`;
    const pct = c.budgetTotal > 0 ? Math.min(100, Math.round(spend / c.budgetTotal * 100)) : 0, acts = actionsFor(c);
    view.querySelector("#ad-h").lastChild.textContent = c.name || "لوحة الحملة";
    const box = view.querySelector("#ad-db"); box.removeAttribute("aria-busy");
    box.innerHTML = `<div class="card" data-ad-camp="${h(c.id)}"><div class="u-dflex u-jsb u-g8 u-aic u-fww"><span>الحالة: ${chip(c.status)}</span><small class="muted">${h(OBJ[c.objective]?.[0] || c.objective)}${c.startAt ? ` · ${h(dayF(c.startAt))} – ${h(dayF(c.endAt))}` : ""}</small></div>
        ${c.postId ? `<p class="u-m0 u-mt8"><a href="#/post/${enc(c.postId)}">عرض المنشور المُروَّج</a></p>` : ""}</div>
      ${c.reviewNote || c.reviewReasons.length || c.status === "rejected" ? `<div class="card ad-note" role="note" id="ad-rn"><b>${c.status === "rejected" ? "سبب الرفض" : "ملاحظة المراجعة"}</b>${c.reviewReasons.length ? `<ul class="u-my6">${c.reviewReasons.map(x => `<li>${h(reasonText(x))}</li>`).join("")}</ul>` : ""}<p class="u-m0 u-mt6">${h(c.reviewNote || (c.status === "rejected" ? "عدّل الحملة ثم أعد إرسالها." : ""))}</p></div>` : ""}
      ${c.status === "in_review" ? `<p class="ad-note" role="status">الحملة قيد المراجعة. سنُعلمك عند القرار.</p>` : ""}
      <section aria-labelledby="ad-kh"><h3 id="ad-kh" class="f-h">الأداء</h3>
      <div class="ad-kpi f-kpis" id="ad-kpi"><div class="kpi-tile"><b>${h(kv(imp))}</b><span>مرات الظهور</span></div><div class="kpi-tile"><b>${h(kv(clk))}</b><span>النقرات</span></div><div class="kpi-tile"><b>${h(ctrTxt)}</b><span>نسبة النقر</span></div><div class="kpi-tile"><b>${pi(spend)}</b><span>الإنفاق</span></div></div>
      <div class="card"><div class="u-dflex u-jsb u-t-sm"><span>المُنفق من الميزانية</span><span>${pi(spend)} / ${pi(c.budgetTotal)}</span></div><div class="ad-bar" role="img" aria-label="أُنفق ${pct}٪ من الميزانية"><i style="width:${pct}%"></i></div><small class="muted">الحد اليومي ${pi(c.dailyCap)} · حتى ${cnt(c.freqCap.impressions)} ظهور للشخص كل ${h(hrsText(c.freqCap.perHours))}</small></div>
      <div class="card">${chart(days)}</div>
      ${hides.length ? `<div class="card" id="ad-hides"><b class="u-t-md">مرات إخفاء الإعلان</b><ul style="margin:6px 0 0;padding-inline-start:20px">${hides.map(x => `<li>${h(HIDE_TXT[x.reason] || x.reason)}: ${h(x.count == null ? (x.countText && /[\u0600-\u06FF]/.test(x.countText) ? x.countText : LT10) : cnt(x.count))}</li>`).join("")}</ul></div>` : ""}
      <p class="u-t-xs muted">أرقام مجمّعة فقط، والأعداد الأقل من 10 تظهر «${LT10}» حمايةً للخصوصية.</p></section>
      <div class="ad-btns" id="ad-acts">${acts.includes("edit") ? `<a class="btn outline" href="#/ads/edit/${enc(c.id)}">${UI.icon("pen","sm")} تعديل</a>` : ""}${acts.includes("submit") ? `<button type="button" class="btn" data-ad-act="submit">إرسال للمراجعة</button>` : ""}
        ${acts.includes("pause") ? `<button type="button" class="btn outline" data-ad-act="pause">${UI.icon("pause","sm")} إيقاف مؤقت</button>` : ""}${acts.includes("resume") ? `<button type="button" class="btn" data-ad-act="resume">${UI.icon("play","sm")} استئناف</button>` : ""}
        ${acts.includes("fund") ? `<button type="button" class="pi-btn btn" id="ad-fund" ${on ? "" : "disabled"} aria-describedby="ad-fn"><span class="pi-logo" aria-hidden="true">π</span>تمويل الحملة (${h(num(c.budgetTotal))} Pi)</button>` : ""}
        ${acts.includes("delete") ? `<button type="button" class="btn outline ad-del" data-ad-act="delete">${MPFeat.ico("trash","sm")} حذف</button>` : ""}</div>
      ${acts.includes("fund") ? `<p class="u-t-sm ${on ? "muted" : "ad-note"}" id="ad-fn" role="status">${on ? "يُدفع المبلغ بعملة Pi ويُحفظ لهذه الحملة؛ يُعاد غير المُنفق عند الانتهاء." : h(c.fundNote || OFF) + ". يمكن تمويل الحملة فور تفعيلها."}</p>` : ""}
      <p class="ad-err" id="ad-ae" role="alert"></p>`;
    const ae = box.querySelector("#ad-ae");
    box.querySelectorAll("[data-ad-act]").forEach(b => b.onclick = async () => {
      const a = b.dataset.adAct;
      if (a === "delete" && b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "تأكيد الحذف؟"; say("اضغط مرة أخرى لتأكيد حذف الحملة"); return; }
      b.disabled = true; ae.textContent = "";
      try {
        if (a === "delete") { await api("DELETE", `/api/ads/campaigns/${enc(id)}`); toast("حُذفت الحملة"); location.hash = "#/ads"; return; }
        await api("POST", `/api/ads/campaigns/${enc(id)}/${a}`);
        const m = { submit: "أُرسلت الحملة للمراجعة", pause: "أُوقفت الحملة مؤقتاً", resume: "استُؤنفت الحملة" }[a]; toast(m); say(m);
        if (live(t)) dashboard(id);
      } catch (e) { b.disabled = false; ae.textContent = errText(e); }
    });
    const fb = box.querySelector("#ad-fund");
    if (fb) fb.onclick = async () => {
      if (fb.disabled) return; fb.disabled = true; ae.textContent = ""; const note = box.querySelector("#ad-fn"); note.textContent = "أكمل التأكيد في نافذة Pi…";
      try {
        if (!window.MPPi) await window.MPChunks?.load("pi").catch(() => { });
        if (!window.MPPi) throw new Error(OFF);
        await window.MPPi.pay({ amount: c.budgetTotal, memo: `إعلان: ${c.name}`.slice(0, 120), purpose: "ads", refId: c.id, intent: async () => { const x = await api("POST", `/api/ads/campaigns/${enc(c.id)}/fund`); return x?.intent || x; } });
        toast("تم تمويل الحملة ✓"); say("تم تمويل الحملة"); if (live(t)) dashboard(id);
      } catch (e) {
        if (!fb.isConnected) return;
        if (e?.code === "not_configured" || e?.status === 501) { note.className = "ad-note"; note.textContent = OFF + ". يمكن تمويل الحملة فور تفعيلها."; return; }
        fb.disabled = false; note.textContent = e?.cancelled ? "أُلغيت عملية الدفع، لم يُخصم شيء." : ""; if (!e?.cancelled) ae.textContent = errText(e);
      }
    };
  }

  /* =================== #/settings/ads — preferences =================== */
  async function prefsView() {
    const t = begin();
    view.innerHTML = `<div class="wrap ad-page">${head("#/settings", "الإعدادات", "تفضيلات الإعلانات", "sliders")}<div id="ad-pf" aria-busy="true"><div class="skel"></div></div></div>`;
    focusH();
    let P; try { P = await api("GET", "/api/me/ads/prefs"); } catch (e) { if (live(t)) fail("#ad-pf", e); return; }
    if (!live(t)) return;
    P = P?.prefs || P || {}; let pz = P.personalized !== false, hidden = list(P.hiddenAdvertisers ?? P.hidden_advertisers);
    const key = (x) => typeof x === "object" && x ? x.id || x.handle : x, lab = (x) => typeof x === "object" && x ? (x.name ? `${x.name}${x.handle ? " (@" + x.handle + ")" : ""}` : "@" + (x.handle || x.id)) : "@" + x;
    const box = view.querySelector("#ad-pf"); box.removeAttribute("aria-busy");
    const draw = () => {
      box.innerHTML = `<div class="card"><div class="ad-sw"><label for="ad-pz"><b>إعلانات حسب اهتماماتي</b><span class="u-db u-t-sm muted" id="ad-pzd">تُستخدم المواضيع التي تتابعها أو اخترتها، ولغتك وبلد ملفك فقط. عند الإيقاف تظهر إعلانات عامة غير مخصصة.</span></label>
        <input type="checkbox" role="switch" id="ad-pz" ${pz ? "checked" : ""} aria-describedby="ad-pzd"></div><p class="ad-err" id="ad-pe" role="alert"></p></div>
        <section class="card" aria-labelledby="ad-hh"><h3 id="ad-hh" class="u-t-lg u-m0 u-mb6">معلنون أخفيتهم</h3>
        ${hidden.length ? `<ul class="u-lsn u-m0 u-p0">${hidden.map(x => `<li class="ad-row"><span class="grow">${h(lab(x))}</span><button type="button" class="btn ghost" data-ad-unhide="${h(key(x))}" aria-label="إظهار إعلانات ${h(lab(x))}">إظهار</button></li>`).join("")}</ul>` : `<p class="u-m0 muted">لم تُخفِ أي معلن.</p>`}</section>
        <section class="card" aria-labelledby="ad-ph"><h3 id="ad-ph" class="u-t-lg u-m0 u-mb6">كيف نحمي خصوصيتك</h3><ul style="margin:0;padding-inline-start:20px;line-height:1.9">
        <li>لا تتبع عبر المواقع، ولا بكسلات طرف ثالث، ولا بصمة جهاز.</li><li>لا نستخدم رسائلك أو منشوراتك الخاصة أو موقعك الجغرافي.</li><li>لا استهداف للفئات الحساسة: الصحة والدين والسياسة والميول والعِرق.</li>
        <li>المعلن يرى أرقاماً مجمّعة فقط، والأعداد الأقل من 10 تظهر «${LT10}».</li><li>من هم دون 18 عاماً لا يرون إعلانات.</li></ul>
        <p class="u-m0 u-mt8"><a href="#/ads">حملاتي الإعلانية</a></p></section>`;
      const sw = box.querySelector("#ad-pz");
      sw.onchange = async () => { const want = sw.checked; sw.disabled = true; box.querySelector("#ad-pe").textContent = "";
        try { await put({ personalized: want }); pz = want; say(want ? "فُعّلت الإعلانات حسب الاهتمامات" : "أُوقفت الإعلانات المخصصة؛ ستظهر إعلانات عامة فقط"); toast(want ? "فُعّلت الإعلانات حسب الاهتمامات" : "ستظهر إعلانات عامة فقط"); }
        catch (e) { sw.checked = pz; box.querySelector("#ad-pe").textContent = errText(e); } sw.disabled = false; sw.focus(); };
      box.querySelectorAll("[data-ad-unhide]").forEach(b => b.onclick = async () => {
        const k = b.dataset.adUnhide, rest = hidden.filter(x => String(key(x)) !== k); b.disabled = true;
        try { await put({ hiddenAdvertisers: rest.map(key) }); const x = hidden.find(y => String(key(y)) === k); hidden = rest; hid.adv.delete(k); if (typeof x === "object" && x?.handle) hid.adv.delete(x.handle); draw(); say("ستظهر إعلانات هذا المعلن مجدداً"); box.querySelector("#ad-hh")?.focus?.(); }
        catch (e) { b.disabled = false; box.querySelector("#ad-pe").textContent = errText(e); }
      });
    };
    const put = (patch) => api("PUT", "/api/me/ads/prefs", { personalized: pz, hiddenAdvertisers: hidden.map(key), ...patch });
    draw();
  }

  /* =================== #/admin/ads/review — review queue =================== */
  async function reviewView() {
    const t = begin();
    view.innerHTML = `<div class="wrap ad-page">${head("#/admin", "الإدارة", "مراجعة الإعلانات", "doc")}<p class="u-m0 u-mb10 muted">راجِع المنشور والاستهداف قبل النشر. الرفض يتطلب سبباً يُرسل للمعلن.</p><div id="ad-rq" aria-busy="true"><div class="skel"></div></div></div>`;
    focusH();
    let r; try { r = await api("GET", "/api/admin/ads/review"); } catch (e) { if (live(t)) fail("#ad-rq", e); return; }
    if (!live(t)) return;
    const items = list(r, "items", "campaigns").map(x => ({ ...norm(x), advertiser: x.advertiser || x.owner || {}, automod: x.automod || x.flags || null, submittedAt: x.submittedAt || x.submitted_at || x.updatedAt })), box = view.querySelector("#ad-rq");
    box.removeAttribute("aria-busy");
    const sr = list(r, "reasons").filter(x => x && x.code), RJ = sr.length ? sr.map(x => [x.code, (REJECT.find(z => z[0] === x.code) || [0, x.label || x.code])[1]]) : REJECT; // server codes win
    const empty = () => { box.innerHTML = `<p class="card muted" role="status">لا حملات بانتظار المراجعة.</p>`; };
    if (!items.length) return empty();
    box.innerHTML = items.map(c => { const tg = c.targeting, a = c.advertiser, rid = "ad-r-" + h(c.id), flags = c.automod ? list(c.automod, "labels", "flags", "explanations", "reasons") : [];
      return `<article class="card" data-ad-rv="${h(c.id)}" aria-labelledby="${rid}"><h3 id="${rid}" class="u-t-lg u-m0 u-mb4">${h(c.name || "حملة")}</h3>
        <small class="muted">من ${h(a.name || "")} ${a.handle ? `<a href="#/u/${enc(a.handle)}">@${h(a.handle)}</a>` : ""}${c.submittedAt ? " · " + h(dayF(c.submittedAt, { dateStyle: "medium", timeStyle: "short" })) : ""}</small>
        <blockquote style="margin:8px 0;padding:8px 12px;border-inline-start:4px solid var(--line);background:var(--bg-2);border-radius:10px">${h(preview(c.post || (typeof S !== "undefined" && S.post(c.postId)) || {}))}${c.postId ? ` <a href="#/post/${enc(c.postId)}">فتح المنشور</a>` : ""}</blockquote>
        <dl class="ad-dl"><dt>المواضيع</dt><dd>${tg.topics.length ? tg.topics.map(x => h(topicName(x))).join("، ") : "عام"}</dd><dt>اللغة / البلد</dt><dd>${tg.languages.map(x => h(nameOf(LANGS, x))).join("، ") || "الكل"} / ${tg.countries.map(x => h(nameOf(COUNTRIES, x))).join("، ") || "الكل"}</dd><dt>الميزانية</dt><dd>${pi(c.budgetTotal)} · ${h(dayF(c.startAt))} – ${h(dayF(c.endAt))}</dd></dl>
        ${flags.length ? `<p class="ad-note"><b>الفحص الآلي:</b> ${flags.map(x => h(typeof x === "object" ? x.label || x.code : reasonText(x))).join("، ")}</p>` : ""}
        <fieldset><legend>أسباب الرفض</legend><div class="ad-checks">${RJ.map(([k, n]) => `<label><input type="checkbox" value="${k}" data-ad-rs><span>${h(n)}</span></label>`).join("")}</div></fieldset>
        <label class="ad-f"><span>ملاحظة للمعلن (اختيارية)</span><textarea data-ad-note maxlength="500" rows="2"></textarea></label><p class="ad-err" data-ad-err role="alert"></p>
        <div class="ad-btns"><button type="button" class="btn" data-ad-dec="approve">✓ موافقة</button><button type="button" class="btn ghost" data-ad-dec="reject">✕ رفض</button></div></article>`; }).join("");
    box.querySelectorAll("[data-ad-dec]").forEach(b => b.onclick = async () => {
      const art = b.closest("[data-ad-rv]"), cid = art.dataset.adRv, decision = b.dataset.adDec, er = art.querySelector("[data-ad-err]");
      const reasons = decision === "reject" ? [...art.querySelectorAll("[data-ad-rs]:checked")].map(x => x.value) : [], note = art.querySelector("[data-ad-note]").value.trim();
      if (decision === "reject" && !reasons.length) { er.textContent = ERR.reasons_required; art.querySelector("[data-ad-rs]").focus(); return; }
      art.querySelectorAll("button").forEach(x => (x.disabled = true)); er.textContent = "";
      try { await api("POST", `/api/admin/ads/review/${enc(cid)}`, { decision, reasons, note }); }
      catch (e) { art.querySelectorAll("button").forEach(x => (x.disabled = false)); er.textContent = errText(e); return; }
      const next = art.nextElementSibling || art.previousElementSibling; art.remove();
      const m = decision === "approve" ? "تمت الموافقة على الحملة" : "رُفضت الحملة وأُبلغ المعلن"; toast(m); say(m);
      if (!box.querySelector("[data-ad-rv]")) empty(); else next?.querySelector("h3")?.setAttribute("tabindex", "-1"), next?.querySelector("h3")?.focus();
    });
  }

  /* =================== routes + entry points =================== */
  function adsRoute(a, b) {
    const id = b ? decodeURIComponent(b.split("?")[0]) : null; a = (a || "").split("?")[0];
    if (!a) return listView();
    if (a === "new") return wizard(null);
    if (a === "edit" && id) return wizard(id);
    if (a === "campaigns") return id ? dashboard(id) : listView();
    return Views.notFound();
  }
  const card = (id, href, icon, title, sub) => `<a class="u-dflex u-aic u-g12 u-ci u-tdn card" id="${id}" href="${href}"><span class="ico" aria-hidden="true">${MPFeat.ico(icon)}</span><span class="u-f1"><b>${title}</b><span class="u-db muted">${sub}</span></span><span class="fwd" aria-hidden="true">←</span></a>`;
  const setCard = () => { if (/^#\/settings\/?(\?|$)/.test(location.hash) && !document.getElementById("ad-set")) (view.querySelector(".wrap") || view).insertAdjacentHTML("beforeend", `<div class="card" id="ad-set"><h3 class="u-m0 u-mb8 u-t-lg">الإعلانات</h3><div class="u-m0 ad-btns"><a class="btn ghost" href="#/ads" id="ad-set-c">حملاتي الإعلانية</a><a class="btn ghost" href="#/settings/ads" id="ad-set-p">تفضيلات الإعلانات</a></div></div>`); };
  if (typeof Views !== "undefined" && Views.settings) { MPSettings.add(function () { setCard(); }); }
  MPRoutes.extend((a, b, prev) => {
    return { ads: () => adsRoute(a, b) };
  });
  MPRoutes.add("admin", (a, b, next) => {
        if (a === "ads") return !b || b.split("?")[0] === "review" ? reviewView() : Views.notFound();
        next();
        if (!a && DB.isAdmin) setTimeout(() => { if (location.hash === "#/admin" && !document.getElementById("ad-adm")) view.querySelector(".wrap h2")?.insertAdjacentHTML("afterend", card("ad-adm", "#/admin/ads/review", "doc", "مراجعة الإعلانات", "الموافقة على الحملات الإعلانية أو رفضها قبل النشر")); }, 0);
      });
  MPRoutes.add("settings", (a, b, next) => (a === "ads" ? prefsView() : next()));
  window.MPAds = { list: listView, wizard, dashboard, prefs: prefsView, review: reviewView, why, mark, bucketText, kv, version: "2.13.0" };
  if (typeof DB !== "undefined" && DB.onboarded) {
    if (/^#\/(ads|settings\/ads|admin\/ads)(\/|$|\?)/.test(location.hash)) route();
    else if (/^#\/settings\/?(\?|$)/.test(location.hash)) setCard();
    else if (/^#?\/?(home)?$|^#\/home/.test(location.hash || "#/home") && promotedMap(typeof feedMode !== "undefined" ? feedMode : "for")?.size && document.getElementById("sheet")?.classList.contains("hidden") && typeof rerender === "function") rerender();
  }
})();
