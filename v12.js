/* =====================================================================
 * مجتمع بلس — v1.2.0 extensions
 * Implements the remaining layers of the product spec on top of v0.1:
 * content states, video pipeline, threads/series, discussions, events,
 * lists, scheduling, translation layer, interest center, multi-level trends,
 * community engine (roles, permissions, reputation, badges, invites, settings),
 * trust & safety (classification, anti-abuse, appeals, admin), analytics,
 * cross-posting to worlds, economy readiness, i18n (RTL/LTR), theming.
 * ===================================================================== */
const VERSION = "1.2.0";
const TOPIC_ALIASES = { // smart hashtags → canonical topic (prevents duplicate entities)
  "ذكاء_اصطناعي": "ai", "ذكاء_الاصطناعي": "ai", "ai": "ai", "برمجة": "dev", "تطوير": "dev", "dev": "dev",
  "شركات_ناشئة": "startups", "startups": "startups", "ريادة": "startups", "استثمار": "invest", "invest": "invest",
  "pinetwork": "pi", "pi": "pi", "باي": "pi", "تصميم": "design", "design": "design", "ألعاب": "games", "العاب": "games", "تعلم": "learn"
};
const SENSITIVE_WORDS = ["عنف", "دم", "مقامرة", "violence", "gore", "nsfw"];
const SPAM_PATTERNS = [/اربح\s*\d+/, /ضاعف\s*أموالك/, /(https?:\/\/\S+.*){3,}/, /free\s*money/i];
const DAILY_PROMPTS = ["ما الشيء الذي تعلمته اليوم؟", "ما المشروع الذي تعمل عليه الآن؟", "شارك أداة غيّرت طريقة عملك", "ما الكتاب الذي تنصح به؟", "ما أكبر خطأ تعلمت منه؟", "ما الفكرة التي تتمنى أن يبنيها أحد؟", "ما أفضل نصيحة سمعتها هذا الأسبوع؟"];

/* ---------- Migration: add v1.2 entities and seed content ---------- */
(function migrate() {
  DB.lists ||= []; DB.events ||= []; DB.appeals ||= []; DB.decisions ||= []; DB.impressions ||= {};
  DB.settings ||= { lang: "ar", theme: "system", sensitive: "warn", contentTypes: { video: true, article: true, poll: true }, languages: ["ar", "en"] };
  DB.interestWeights ||= {}; DB.interactions ||= [];
  DB.muted.hashtags ||= []; DB.muted.communities ||= [];
  if (DB.v12) return;
  DB.v12 = true;
  const P = (id, author, h, extra) => ({ id, author, type: "post", text: "", topic: null, createdAt: ago(h), updatedAt: null, edited: false, visibility: "public", status: "published", community: null, media: null, poll: null, quoteOf: null, repostOf: null, title: null, views: 100 + Math.floor(Math.random() * 1500), ...extra });
  DB.posts.push(
    P("p30", "u6", 2.5, { type: "video", text: "ملخص أفضل ٥ ألعاب مستقلة هذا الشهر 🎮 #ألعاب", topic: "games", media: "linear-gradient(135deg,#ff512f,#dd2476)", video: { duration: 58, completions: 140, starts: 400, status: "ready", short: true } }),
    P("p31", "u9", 39, { text: "٢/٣ المرحلة الثانية: تحدثت مع ٢٠ مستخدماً قبل كتابة أي سطر كود، وغيّرت الفكرة مرتين. #شركات_ناشئة", topic: "startups", series: "s1", part: 2, parts: 3 }),
    P("p32", "u9", 38, { text: "٣/٣ الإطلاق: نسخة بسيطة جداً، وأول ١٠٠ مستخدم جاؤوا من المجتمع نفسه. الدرس: ابنِ مع جمهورك. #شركات_ناشئة", topic: "startups", series: "s1", part: 3, parts: 3 }),
    P("p33", "u4", 8, { type: "discussion", title: "هل العمل عن بعد أفضل للشركات الناشئة؟", text: "نقاش منظم: شاركونا موقفكم مع السبب.", topic: "startups", stances: [{ t: "أفضل", v: 24 }, { t: "حسب المرحلة", v: 31 }, { t: "المكتب أفضل", v: 12 }], stanceVoters: {} }),
    P("p34", "u7", 3, { text: "AI copilots won't replace developers, but developers who use them will replace those who don't. #AI", topic: "ai", lang: "en" }),
    P("p35", "u5", 1.5, { type: "event", text: "لقاء مفتوح لبناة تطبيقات Pi 🟣", topic: "pi", community: "m2", event: "e1" }),
    P("p36", "u3", 30, { type: "post", text: "مجموعة ألوان لهوية تطبيق عربي حديث 🎨 #تصميم", topic: "design", media: "linear-gradient(135deg,#f7971e,#ffd200)", images: ["linear-gradient(135deg,#f7971e,#ffd200)", "linear-gradient(135deg,#00c6ff,#0072ff)", "linear-gradient(135deg,#f953c6,#b91d73)"] }),
    P("p37", "u2", 5, { sponsored: true, text: "تعلّم بناء تطبيقات الويب في ٨ أسابيع مع أكاديمية الكود. سجّل اليوم.", topic: "dev", media: "linear-gradient(135deg,#11998e,#38ef7d)" })
  );
  const p19 = DB.posts.find(p => p.id === "p19"); if (p19) Object.assign(p19, { series: "s1", part: 1, parts: 3 });
  const en = { p9: "إطلاق المنتج بسرعة أمر جيد، لكن إطلاق الشيء الصحيح أفضل. تحدّث مع ١٠ مستخدمين قبل كتابة الكود.", p20: "تجربة البداية الجيدة = تذاكر دعم أقل. كل شاشة يجب أن تجيب: ماذا الآن؟", p34: "مساعدات الذكاء الاصطناعي لن تستبدل المطورين، لكن المطورين الذين يستخدمونها سيستبدلون من لا يستخدمها." };
  Object.entries(en).forEach(([id, tr]) => { const p = DB.posts.find(x => x.id === id); if (p) { p.lang = "en"; p.translations = { ar: tr }; } });
  DB.events.push(
    { id: "e1", name: "لقاء بناة Pi الشهري", desc: "عرض مشاريع، أسئلة وأجوبة، وتعارف بين المطورين.", startsAt: new Date(Date.now() + 3 * 864e5).toISOString(), place: "أونلاين", organizer: "u5", community: "m2", going: ["u9", "u5"], interested: ["u2"], color: "linear-gradient(135deg,#9b51e0,#e0559b)", status: "upcoming" },
    { id: "e2", name: "ورشة: أساسيات تصميم الواجهات", desc: "ساعتان عمليتان مع نورة.", startsAt: new Date(Date.now() + 6 * 864e5).toISOString(), place: "جدة", organizer: "u3", community: "m4", going: ["u7"], interested: [], color: "linear-gradient(135deg,#e88b2a,#d6453a)", status: "upcoming" }
  );
  DB.lists.push({ id: "l1", name: "مطورون", members: ["u2", "u8"], createdAt: now() });
  save();
})();

/* ---------- Helpers ---------- */
const isAr = (t = "") => /[\u0600-\u06FF]/.test(t);
const langOf = (p) => p.lang || (isAr(p.text + (p.title || "")) ? "ar" : "en");
const classify = (text = "") => ({ sensitive: SENSITIVE_WORDS.some(w => text.toLowerCase().includes(w)), spam: SPAM_PATTERNS.some(r => r.test(text)) });
const topicFromTags = (text) => { for (const t of S.hashtags(text)) if (TOPIC_ALIASES[t]) return TOPIC_ALIASES[t]; return null; };
const fmtDate = (iso) => new Date(iso).toLocaleString(DB.settings.lang === "en" ? "en" : "ar", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) + (DB.settings.hijri ? " · " + (window.MPHijri ? MPHijri.label(iso) : new Date(iso).toLocaleDateString("ar-SA-u-ca-islamic-umalqura", { day: "numeric", month: "long" })) : ""); // phase 68
const track = (type, data = {}) => { DB.interactions.push({ type, ...data, at: now() }); if (DB.interactions.length > 2000) DB.interactions = DB.interactions.slice(-1500); };
const CANON = { ai: "ذكاء_اصطناعي", dev: "برمجة", startups: "شركات_ناشئة", invest: "استثمار", pi: "pinetwork", design: "تصميم", games: "ألعاب", learn: "تعلم" };
const canonTag = (n) => TOPIC_ALIASES[n] ? CANON[TOPIC_ALIASES[n]] : n;
S.hashtags = (text = "") => [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => canonTag(normalizeTag(h))))];
const _tagView = Views.tag; Views.tag = (t) => _tagView(encodeURIComponent(canonTag(normalizeTag(decodeURIComponent(t)))));

/* ---------- i18n (UI shell) + theme ---------- */
const I18N = {
  en: { home: "Home", explore: "Explore", communities: "Communities", notifications: "Alerts", me: "Me", menu: "More", brand: "Mujtama Plus", compose: "What do you want to post?" },
  ar: { home: "الرئيسية", explore: "استكشف", communities: "المجتمعات", notifications: "الإشعارات", me: "حسابي", menu: "المزيد", brand: "مجتمع بلس", compose: "ماذا تريد أن تنشر؟" }
};
function applyShell() {
  if (DB.settings.lang === "fr" || DB.settings.lang === "ur") DB.settings.lang = "en"; // v2.67: ar + en only; retired fr/ur fall back to English
  const L = DB.settings.lang, t = I18N[L] || I18N.ar;
  document.documentElement.lang = L; document.documentElement.dir = L === "en" ? "ltr" : "rtl";
  document.querySelectorAll(".bottomnav a").forEach(a => { const k = a.dataset.r; if (t[k]) a.querySelector("small").textContent = t[k]; });
  document.querySelector(".brand span:last-child").textContent = t.brand;
  // v2.36: "system" resolves to the effective scheme so module rules written as [data-theme=dark] also apply on a dark OS
  const th = DB.settings.theme, H = document.documentElement, eff = th === "dark" || th === "light" ? th : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  if (H.dataset.theme !== eff) { // v2.53: no transitions while the scheme flips (colours must not lag behind the tokens)
    H.classList.add("no-tx"); H.dataset.theme = eff;
    requestAnimationFrame(() => requestAnimationFrame(() => H.classList.remove("no-tx")));
  }
}
/* v2.64: any data-theme flip that bypasses applyShell (other modules, extensions, automation) gets the same no-transition
   window, so inherited text/background colours never sit mid-transition on the old scheme (axe dark #/msession race). */
try { const H = document.documentElement; new MutationObserver(() => { if (H.classList.contains("no-tx")) return; H.classList.add("no-tx"); requestAnimationFrame(() => requestAnimationFrame(() => H.classList.remove("no-tx"))); }).observe(H, { attributes: true, attributeFilter: ["data-theme"] }); } catch { /* old browser */ }
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (DB.settings.theme !== "dark" && DB.settings.theme !== "light" && typeof applyShell === "function") applyShell(); }); } catch { /* old browser */ }
const themeCss = document.createElement("style");
themeCss.textContent = `
:root[data-theme=dark]{--bg:#0f0d16;--card:#1a1724;--text:#f1eef9;--muted:#9b95ad;--line:#2a2638;--accent:#8f6bff;--accent2:#2a2145}
:root[data-theme=light]{--bg:#f7f6fb;--card:#fff;--text:#16131f;--muted:#6f6a80;--line:#e8e5f0;--accent:#5b2bd6;--accent2:#ede6ff}
.blurwrap{position:relative}.blurwrap .blurred{filter:blur(14px);pointer-events:none;user-select:none}
.blurwrap .reveal{position:absolute;inset:0;display:grid;place-items:center;text-align:center;z-index:2}
.play{position:relative}.play::after{content:"▶";position:absolute;inset:0;display:grid;place-items:center;font-size:44px;color:#fff;text-shadow:0 4px 18px #0008}
.dur{position:absolute;bottom:8px;inset-inline-end:8px;background:#000a;color:var(--white);font-size:var(--fs-xs);padding:2px 8px;border-radius:8px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:8px 0}.grid3 div{aspect-ratio:1;border-radius:10px}
.series{display:flex;gap:6px;align-items:center;font-size:var(--fs-sm);color:var(--accent);margin-top:4px}
.sponsored{font-size:var(--fs-xs);color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px}
.event-card{border-radius:14px;padding:14px;color:var(--white);margin:8px 0}
.progress{height:6px;border-radius:3px;background:var(--line);overflow:hidden}.progress i{display:block;height:100%;background:var(--accent)}

.world{display:inline-block;font-size:var(--fs-xs);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 8px;margin:4px 4px 0 0}
.suggest{border:1px solid var(--line);border-radius:12px;margin-top:4px;overflow:hidden}.suggest button{display:block;width:100%;text-align:start;border:0;background:var(--card);padding:9px 12px;color:var(--text)}
[dir=ltr] .fab{left:auto;right:calc(50% - min(280px,50vw) + 16px)}
label.chk{display:flex;gap:8px;align-items:center;margin:8px 0}label.chk input{width:auto}
.rep{font-size:11px;background:var(--accent2);color:var(--accent);border-radius:6px;padding:1px 6px;margin-inline-start:4px}`;
document.head.appendChild(themeCss);

/* ---------- Anti-abuse: mass-action detection ---------- */
const Abuse = {
  check(action) {
    const limits = { follow: [20, 60e3], react: [40, 60e3], invite: [10, 60e3], report: [5, 60e3], comment: [10, 60e3] };
    const [max, ms] = limits[action] || [30, 60e3];
    if (!Rate.ok("abuse_" + action, max, ms)) { DB.audit.push({ action: "ABUSE_FLAG", target: DB.me, reason: "Mass " + action, by: "system", at: now() }); save(); toast("تم رصد نشاط غير طبيعي، تمهّل قليلاً"); return false; }
    return true;
  }
};
const _follow = Cmd.toggleFollow; Cmd.toggleFollow = (to) => { if (!S.follows(DB.me, to) && !Abuse.check("follow")) return; _follow(to); track("follow", { to }); };
const _react = Cmd.react; Cmd.react = (t, type, owner) => { if (!Abuse.check("react")) return; _react(t, type, owner); track("react", { target: t, type }); const p = S.post(t); if (p?.topic) DB.interestWeights[p.topic] = (DB.interestWeights[p.topic] || 0) + 0.2; };
const _report = Cmd.report; Cmd.report = (target, kind, reason) => {
  // malicious-report analysis: repeated reports on same target by same user are ignored
  if (DB.reports.some(r => r.target === target && r.by === DB.me)) return toast("سبق أن أبلغت عن هذا");
  _report(target, kind, reason);
  const count = DB.reports.filter(r => r.target === target && r.status === "open").length;
  const p = S.post(target); if (p && count >= 1) { p.moderation = "reported"; save(); }
};

/* ---------- Create post v2: classification, topics, states, video pipeline, scheduling ---------- */
const _create = Cmd.createPost;
Cmd.createPost = (data) => {
  const cls = classify((data.text || "") + " " + (data.title || ""));
  if (cls.spam) { DB.audit.push({ action: "SPAM_BLOCKED", target: DB.me, reason: "Spam pattern", by: "system", at: now() }); save(); return { error: "يبدو المحتوى كرسالة مزعجة ولم يُنشر" }; }
  data.sensitive = data.sensitive || cls.sensitive;
  data.topic = data.topic || topicFromTags(data.text || "");
  data.lang = isAr((data.text || "") + (data.title || "")) ? "ar" : "en";
  const r = _create(data); if (r.error) return r;
  const p = r.post;
  if (data.publishAt && new Date(data.publishAt) > new Date()) { p.status = "scheduled"; p.publishAt = data.publishAt; save(); }
  else if (p.type === "video") {
    p.status = "processing"; p.video = { duration: 30 + Math.floor(Math.random() * 90), starts: 0, completions: 0, status: "processing", short: !!data.short }; save();
    setTimeout(() => { p.status = "published"; p.video.status = "ready"; save(); Bus.emit("VIDEO_PROCESSED", p); notify(DB.me, "video", { actor: DB.me, post: p.id }); App.refreshBadges(); rerender(); }, 3500);
  }
  if (p.type === "event" && data.eventData) { const e = { id: uid("e"), organizer: DB.me, going: [DB.me], interested: [], status: "upcoming", color: `linear-gradient(135deg,${COLORS[Math.floor(Math.random() * 10)]},#c04cf0)`, community: p.community, ...data.eventData }; DB.events.push(e); p.event = e.id; save(); }
  if (data.threadParts && data.threadParts.length) {
    const sid = uid("s"), parts = [p, ...data.threadParts.map(t => _create({ ...data, threadParts: null, text: t }).post).filter(Boolean)];
    parts.forEach((x, i) => { x.series = sid; x.part = i + 1; x.parts = parts.length; }); save();
  }
  // mentions → notification event for the mentioned user (server-side delivery)
  (p.text.match(/@([a-zA-Z0-9_]+)/g) || []).forEach(m => { const u = S.byHandle(m.slice(1)); if (u) Bus.emit("USER_MENTIONED", { user: u.id, post: p.id }); });
  return r;
};
Bus.on("POST_UPDATED", p => DB.audit.push({ action: "POST_EDITED", target: p.id, by: DB.me, at: now() }));
Bus.on("POST_DELETED", p => DB.audit.push({ action: "POST_DELETED", target: p.id, by: DB.me, at: now() }));
// Scheduled publisher
setInterval(() => DB.posts.forEach(p => { if (p.status === "scheduled" && new Date(p.publishAt) <= new Date()) { p.status = "published"; p.createdAt = now(); save(); notify(DB.me, "scheduled", { actor: DB.me, post: p.id }); App.refreshBadges(); } }), 15e3);

/* ---------- Feed engine v2: spam/duplicate penalty, content types, languages, sponsored separation ---------- */
const _score = Feed.score;
Feed.score = (p, reasons) => {
  let s = _score(p, reasons);
  const dupes = DB.posts.filter(x => x.text && x.text === p.text && x.id !== p.id).length; s -= dupes * 2;   // duplicates
  if (p.moderation === "reported") s -= 3;
  if (p.quoteOf || p.type === "article" || p.type === "discussion") s += 0.5;                          // originality/discussion quality
  const cTypes = DB.settings.contentTypes; if ((p.type === "video" && !cTypes.video) || (p.type === "article" && !cTypes.article) || (p.poll && !cTypes.poll)) s -= 100;
  if (!DB.settings.languages.includes(langOf(p)) && !p.translations) s -= 100;
  if (DB.muted.hashtags.some(h => S.hashtags(p.text).includes(h)) || (p.community && DB.muted.communities.includes(p.community))) s -= 100;
  const ageH = (Date.now() - new Date(p.createdAt)) / 3600e3;
  if (S.followers(p.author).length < 3 && ageH < 48 && S.reactionsOf(p.id).length >= 2) { s += 1.5; reasons && reasons.push("منشور جديد يحصل على تفاعل جيد من مجموعة صغيرة"); } // fair chance for new creators
  return s;
};
const _build = Feed.build;
Feed.build = (mode) => {
  const list = _build(mode).filter(p => p.status === "published" && !p.sponsored);
  if (mode === "for" && list.length > 5) { const sp = S.visiblePosts().find(p => p.sponsored); if (sp) list.splice(4, 0, sp); } // sponsored clearly separated & labeled
  return list;
};

/* ---------- Trends v2: multi-level + early (rising) detection ---------- */
Trends.multi = (scope = "global", key) => {
  const map = {};
  S.visiblePosts().filter(p => !p.sponsored).filter(p => scope === "lang" ? langOf(p) === key : scope === "topic" ? p.topic === key : scope === "community" ? p.community === key : true)
    .forEach(p => S.hashtags(p.text).forEach(t => {
      const m = (map[t] ||= { tag: t, users: new Set(), last6: 0, prev: 0, eng: 0, posts: 0, perUser: {} });
      m.users.add(p.author); m.posts++; m.perUser[p.author] = (m.perUser[p.author] || 0) + 1;
      const ageH = (Date.now() - new Date(p.createdAt)) / 3600e3;
      if (ageH < 6) m.last6++; else if (ageH < 24) m.prev++;
      m.eng += S.reactionsOf(p.id).length + S.commentsOf(p.id).length;
    }));
  return Object.values(map).map(m => {
    const maxShare = Math.max(...Object.values(m.perUser)) / m.posts;           // manipulation: one user dominating
    const velocity = m.last6 / Math.max(1, m.prev);
    return { ...m, unique: m.users.size, velocity, score: (m.users.size * 3 + m.last6 * 2 + Math.log2(1 + m.eng)) * (maxShare > 0.8 && m.posts > 3 ? 0.3 : 1) };
  }).sort((a, b) => b.score - a.score);
};
Trends.rising = () => Trends.multi().filter(t => t.last6 > 0).sort((a, b) => b.velocity - a.velocity || b.last6 - a.last6).slice(0, 4);

/* ---------- Translation layer (keeps originals; server MT replaces the stub) ---------- */
const Translate = {
  get(p) {
    const target = DB.settings.lang; if (langOf(p) === target) return null;
    return (p.translations || {})[target] || null;
  }
};

/* ---------- Post card v2 ---------- */

PostHooks.inner("v12#1", 70, (_inner) => function (p, opts = {}) {
  if (!p || p.status === "deleted" || p.status === "removed") return `<div class="muted">المنشور الأصلي غير متاح</div>`;
  let h = _inner(p, opts);
  let extra = "";
  if (p.images && p.images.length > 1) extra += `<div class="grid3">${p.images.map(g => `<div style="background:${g}"></div>`).join("")}</div>`;
  if (p.type === "video") {
    const v = p.video || {};
    extra += p.status === "processing" ? `<div class="u-tc card"><svg class=ei aria-hidden=true><use href=#i-hourglass /></svg> جاري معالجة الفيديو وتحويله لعدة دقات…<div class="u-mt8 progress"><i style="width:60%"></i></div></div>`
      : `<div class="media play" data-play="${p.id}" style="background:${p.media};position:relative;height:${v.short ? 300 : 200}px;cursor:pointer"><span class="dur">${Math.floor((v.duration || 0) / 60)}:${String((v.duration || 0) % 60).padStart(2, "0")}${v.short ? " · قصير" : ""}</span></div>`;
    h = h.replace(`<div class="media" style="background:${p.media}"></div>`, "");
  }
  if (p.type === "discussion") {
    const total = p.stances.reduce((a, s) => a + s.v, 0) || 1, mine = p.stanceVoters[DB.me];
    extra += `<div class="u-my8 card discover"><b><svg class=ei aria-hidden=true><use href=#i-mega /></svg> ${esc(p.title)}</b><div class="u-my4 muted">نقاش منظم · اختر موقفك</div>${p.stances.map((s, i) => `<div class="poll"><div class="opt" data-stance="${p.id}:${i}"><div class="bar" style="width:${Math.round(s.v / total * 100)}%"></div><span>${esc(s.t)} · ${Math.round(s.v / total * 100)}%${mine === i ? " ✓" : ""}</span></div></div>`).join("")}</div>`;
  }
  if (p.type === "event" && p.event) {
    const e = DB.events.find(x => x.id === p.event);
    if (e) extra += `<a href="#/event/${e.id}" class="event-card" style="display:block;background:${e.color}"><div style="opacity:.85"><svg class=ei aria-hidden=true><use href=#i-calendar /></svg> ${fmtDate(e.startsAt)}</div><b class="u-t-lg">${esc(e.name)}</b><div style="opacity:.85"><svg class=ei aria-hidden=true><use href=#i-mapPin /></svg> ${esc(e.place)} · ${e.going.length} سيحضر</div></a>`;
  }
  if (p.series) {
    extra += `<a href="#/series/${p.series}" class="series"><svg class=ei aria-hidden=true><use href=#i-layers /></svg> سلسلة · الجزء ${p.part} من ${p.parts} · عرض السلسلة كاملة</a>`;
  }
  const tr = Translate.get(p);
  if (tr) extra += `<div class="translate-box"><button class="btn ghost" data-tr="${p.id}" style="padding:4px 10px;font-size:13px;margin-top:6px"><svg class=ei aria-hidden=true><use href=#i-globe /></svg> ترجمة إلى العربية</button><div class="body" id="tr-${p.id}" style="display:none;border-inline-start:3px solid var(--accent);padding-inline-start:8px">${esc(tr)}<div class="muted">ترجمة آلية · النص الأصلي محفوظ</div></div></div>`;
  if (p.location) extra += `<div class="muted"><svg class=ei aria-hidden=true><use href=#i-mapPin /></svg> ${esc(p.location)}</div>`;
  // v2.49.0: «العوالم» removed from the UI (owner decision 2026-10-18); old posts keep the field but no label is shown.
  if (p.status === "scheduled") extra += `<div class="chip"><svg class=ei aria-hidden=true><use href=#i-clock /></svg> مجدول: ${fmtDate(p.publishAt)}</div>`;
  if (p.status === "archived") extra += `<div class="chip"><svg class=ei aria-hidden=true><use href=#i-archive /></svg> مؤرشف</div>`;
  h = h.replace('<div class="actions">', extra + '<div class="actions">');
  if (p.poll && p.poll.hideResults && p.author !== DB.me && new Date(p.poll.endsAt) > new Date()) h = h.replace(/<div class="bar"[^>]*><\/div>/g, "").replace(/ · \d+%/g, "").replace(/(\d+) صوت/, "النتائج تظهر بعد انتهاء الاستطلاع");
  if (p.sponsored) h = h.replace('<div class="meta">', '<div class="meta"><span class="sponsored">مُموَّل</span> ');
  if (p.partner && p.partner.label) h = h.replace('<div class="post-open"', `<a class="ptn-bar${p.partner.paid ? " paid" : ""}" href="#/collabs/about" aria-label="إفصاح: ${esc(p.partner.label)}"><span aria-hidden="true">${p.partner.paid ? "<svg class=ei aria-hidden=true><use href=#i-brief /></svg>" : "<svg class=ei aria-hidden=true><use href=#i-handshake /></svg>"}</span>${esc(p.partner.label)}</a><div class="post-open"`); // phase 63: disclosure, never hidden
  if (p.edited) h = h.replace(" · تم التعديل", ` · <a data-hist="${p.id}" style="text-decoration:underline">تم التعديل</a>`);
  if (p.sensitive && DB.settings.sensitive === "warn" && !opts.revealed && !(window._revealed || {})[p.id])
    h = `<div class="blurwrap"><div class="blurred">${h}</div><div class="reveal"><div><div><svg class=ei aria-hidden=true><use href=#i-alert /></svg> محتوى قد يكون حساساً</div><button class="u-mt8 btn" data-reveal="${p.id}">عرض</button></div></div></div>`;
  if (p.sensitive && DB.settings.sensitive === "hide" && p.author !== DB.me) return `<div class="muted">محتوى مخفي حسب إعداداتك</div>`;
  return h;
});

/* impressions vs opens vs dwell (view quality signals) */
const impObs = new IntersectionObserver(en => en.forEach(e => { if (e.isIntersecting) { const id = e.target.dataset.imp; DB.impressions[id] = (DB.impressions[id] || 0) + 1; impObs.unobserve(e.target); } }), { threshold: .6 });
const dwellStart = null, dwellPost = null;
function afterRender() {
  document.querySelectorAll('#view .card [data-more]').forEach(b => { const card = b.closest(".card"); if (card && !card.dataset.imp) { card.dataset.imp = b.dataset.more; impObs.observe(card); } });
}

/* extra delegated actions */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-tr],[data-reveal],[data-play],[data-stance],[data-hist],[data-going],[data-interested]"); if (!t) return;
  e.preventDefault(); e.stopPropagation(); const d = t.dataset;
  if (d.tr) { const box = document.getElementById("tr-" + d.tr); const on = box.style.display === "none"; box.style.display = on ? "block" : "none"; t.textContent = on ? "عرض النص الأصلي فقط" : "ترجمة إلى العربية"; }
  if (d.reveal) { (window._revealed ||= {})[d.reveal] = true; rerender(); }
  if (d.play) playVideo(d.play);
  if (d.stance) { const [pid, i] = d.stance.split(":"); const p = S.post(pid); if (p.stanceVoters[DB.me] === undefined) { p.stanceVoters[DB.me] = +i; p.stances[i].v++; save(); } rerender(); }
  if (d.hist) { const p = S.post(d.hist); sheet(`<h4>سجل التعديلات</h4>${(p.history || []).map(x => `<div class="card"><div class="muted">${fmtDate(x.at)}</div><div class="body">${esc(x.text)}</div></div>`).join("")}<div class="card"><div class="muted">الحالي · ${fmtDate(p.updatedAt)}</div><div class="body">${esc(p.text)}</div></div>`); }
  if (d.going || d.interested) { const ev = DB.events.find(x => x.id === (d.going || d.interested)); const k = d.going ? "going" : "interested"; ev[k] = ev[k].includes(DB.me) ? ev[k].filter(x => x !== DB.me) : [...ev[k], DB.me]; save(); rerender(); }
}, true);
function playVideo(pid) {
  const p = S.post(pid), v = p.video; v.starts++; track("video_start", { post: pid }); save();
  const s = sheet(`<div class="media" style="background:${p.media};height:${v.short ? 420 : 240}px;display:grid;place-items:center;color:#fff;font-size:18px" id="vp">▶ جاري التشغيل…</div><div class="progress"><i id="vbar" style="width:0"></i></div><p class="body">${richText(p.text)}</p><div class="muted">بث متكيف حسب سرعة الاتصال · ${v.starts} تشغيل · ${v.completions} إكمال</div>`);
  let pct = 0; const iv = setInterval(() => { pct += 10; const bar = document.getElementById("vbar"); if (!bar) return clearInterval(iv); bar.style.width = pct + "%"; if (pct >= 100) { clearInterval(iv); v.completions++; track("video_complete", { post: pid }); save(); document.getElementById("vp").textContent = "✓ اكتمل"; } }, 400);
  s._onclose = () => { clearInterval(iv); track("video_watch", { post: pid, pct }); };
}

/* ---------- More-menu v2: pin, archive, mute hashtag, appeal-aware ---------- */
const _more = moreMenu;
moreMenu = function (pid) {
  const p = S.post(pid);
  if (p.author !== DB.me) {
    _more(pid);
    const menu = document.querySelector("#sheet .menu");
    const tags = S.hashtags(p.text);
    if (tags[0]) { const b = document.createElement("button"); b.textContent = "كتم #" + tags[0]; b.onclick = () => { DB.muted.hashtags.push(tags[0]); save(); closeSheet(); toast("تم كتم الهاشتاغ"); rerender(); }; menu.appendChild(b); }
    if (p.community) { const b = document.createElement("button"); b.textContent = "كتم هذا المجتمع في الخلاصة"; b.onclick = () => { DB.muted.communities.push(p.community); save(); closeSheet(); toast("تم الكتم"); rerender(); }; menu.appendChild(b); }
    const lb = document.createElement("button"); lb.textContent = "إضافة الكاتب إلى قائمة"; lb.onclick = () => addToList(p.author); menu.appendChild(lb);
    const sup = document.createElement("button"); sup.textContent = "دعم المبدع (Pi)"; sup.onclick = async () => { closeSheet(); try { await PiAdapter.createPayment(1, "دعم " + S.user(p.author).name, { post: pid }); } catch (e) { toast("دعم المبدعين بعملة Pi يُفعّل مع الربط"); } }; menu.appendChild(sup);
    return;
  }
  const me = S.me();
  const s = sheet(`<div class="menu">
    <button data-a="why"><svg class=ei aria-hidden=true><use href=#i-bulb /></svg> لماذا أرى هذا؟</button>
    <button data-a="edit"><svg class=ei aria-hidden=true><use href=#i-pen /></svg> تعديل</button>
    <button data-a="pin"><svg class=ei aria-hidden=true><use href=#i-pin /></svg> ${me.pinned === pid ? "إلغاء التثبيت" : "تثبيت في ملفي"}</button>
    <button data-a="arch">${p.status === "archived" ? "<svg class=ei aria-hidden=true><use href=#i-unarchive /></svg>" : "<svg class=ei aria-hidden=true><use href=#i-archive /></svg>"} ${p.status === "archived" ? "إلغاء الأرشفة" : "أرشفة"}</button>
    <button data-a="stats"><svg class=ei aria-hidden=true><use href=#i-trendUp /></svg> إحصائيات المنشور</button>
    <button data-a="del" class="u-c-dg"><svg class=ei aria-hidden=true><use href=#i-trash /></svg> حذف</button></div>`);
  s.querySelectorAll("[data-a]").forEach(b => b.onclick = () => {
    const a = b.dataset.a;
    if (a === "why") return sheet(`<h4>لماذا أرى هذا؟</h4>${Feed.why(p).map(r => `<p>• ${r}</p>`).join("")}`);
    if (a === "stats") return sheet(`<h4>إحصائيات المنشور</h4><div class="kpi"><div><b>${DB.impressions[pid] || 0}</b>ظهور</div><div><b>${p.views}</b>فتح</div><div><b>${S.reactionsOf(pid).length}</b>تفاعل</div><div><b>${S.commentsOf(pid).length}</b>تعليق</div><div><b>${S.repostsOf(pid)}</b>إعادة نشر</div><div><b>${DB.collections.filter(c => c.items.includes(pid)).length}</b>حفظ</div></div>`);
    closeSheet();
    if (a === "edit") openComposer({ edit: pid, text: p.text }); // v2.50: the edit editor, not prompt()
    if (a === "pin") { me.pinned = me.pinned === pid ? null : pid; save(); toast(me.pinned ? "تم التثبيت" : "أُلغي التثبيت"); }
    if (a === "arch") { p.status = p.status === "archived" ? "published" : "archived"; save(); toast(p.status === "archived" ? "تمت الأرشفة" : "أعيد نشره"); }
    if (a === "del") window.MPConfirm("حذف المنشور؟", { ok: "حذف" }).then((y) => { if (y) { Cmd.deletePost(pid); toast("تم الحذف"); } });
    rerender();
  });
};
function addToList(uidv) {
  const s = sheet(`<h4>إضافة إلى قائمة</h4><div class="menu">${DB.lists.map(l => `<button data-l="${l.id}">${l.members.includes(uidv) ? "✓ " : ""}${esc(l.name)}</button>`).join("")}<button data-new="1">＋ قائمة جديدة</button></div>`);
  s.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { const l = DB.lists.find(x => x.id === b.dataset.l); l.members = l.members.includes(uidv) ? l.members.filter(x => x !== uidv) : [...l.members, uidv]; save(); closeSheet(); toast("تم التحديث"); });
  s.querySelector("[data-new]").onclick = () => { const n = prompt("اسم القائمة"); if (n) { DB.lists.push({ id: uid("l"), name: n, members: [uidv], createdAt: now() }); save(); closeSheet(); toast("أُنشئت القائمة"); } };
}

/* v2.50: the v2 composer sheet that used to override openComposer here was removed — see composer-ui.js */

/* poll v2: multi-choice, hide results, expiry */
const _vote = Cmd.vote;
Cmd.vote = (pid, i) => {
  const p = S.post(pid), poll = p.poll;
  if (poll.endsAt && new Date(poll.endsAt) < new Date()) return toast("انتهى الاستطلاع");
  if (poll.multi) { const cur = Array.isArray(poll.voters[DB.me]) ? poll.voters[DB.me] : []; if (cur.includes(i)) return; poll.voters[DB.me] = [...cur, i]; poll.options[i].v++; save(); }
  else _vote(pid, i);
};

/* ---------- Views: new screens ---------- */
/* v2.81: the v1.2 screens live in the lazy «v12x» chunk (v12-screens.js); this facade forwards to them, so wrappers of
 * V12.<screen> (sync, security, identity, compliance, integrity) still wrap the same object. */
const V12 = {};
["series", "events", "event", "lists", "list", "interests", "trends", "admin", "decisions"].forEach((n) => { V12[n] = function () { const X = window.V12X; return X && X[n] ? X[n].apply(this, arguments) : undefined; }; });
function eventRow(e) { return `<a class="card row" href="#/event/${e.id}"><div class="av" style="background:${e.color}"></div><div class="grow"><b>${esc(e.name)}</b><div class="muted">${fmtDate(e.startsAt)} · ${esc(e.place)}</div><div class="muted">${e.going.length} سيحضر</div></div></a>`; }
function inviteFlow(kind, id) {
  const s = sheet(`<h4>دعوة أشخاص</h4><div class="menu">${S.following(DB.me).concat(S.followers(DB.me)).filter((v, i, a) => a.indexOf(v) === i).map(S.user).map(u => `<button data-u="${u.id}"><svg class=ei aria-hidden=true><use href=#i-mail /></svg> ${esc(u.name)}</button>`).join("") || '<p class="muted">تابع أشخاصاً لتتمكن من دعوتهم</p>'}</div>`);
  s.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { if (!Abuse.check("invite")) return; Bus.emit("INVITE_SENT", { kind, id, to: b.dataset.u }); b.textContent = "✓ تمت الدعوة"; b.disabled = true; });
}

/* ---------- Community engine v2 (wrap view to add tabs: media, events, settings, pending, invites, reputation) ---------- */
function reputation(cid, u) {
  const posts = DB.posts.filter(p => p.community === cid && p.author === u && p.status === "published");
  const reacts = posts.reduce((a, p) => a + S.reactionsOf(p.id).length, 0);
  const answers = DB.posts.filter(p => p.community === cid && p.acceptedAnswer && DB.comments.find(c => c.id === p.acceptedAnswer)?.author === u).length;
  const m = S.membership(cid, u), days = m ? (Date.now() - new Date(m.joinedAt)) / 864e5 : 0;
  return Math.round(posts.length * 5 + reacts * 2 + answers * 15 + Math.min(days, 365) * 0.1);
}
function communityBadges(cid, u) {
  const c = S.community(cid), m = S.membership(cid, u), r = reputation(cid, u), b = [];
  if (c.owner === u) b.push("عضو مؤسس"); if (m && ["moderator", "admin"].includes(m.role)) b.push("مشرف");
  if (r >= 30) b.push("مساهم مميز"); if (r >= 80) b.push("خبير مجتمع"); return b;
}
const PERMS = { owner: ["CanPost", "CanComment", "CanInvite", "CanModerate", "CanEditRules", "CanManageMembers", "CanManagePosts"], admin: ["CanPost", "CanComment", "CanInvite", "CanModerate", "CanManageMembers", "CanManagePosts"], moderator: ["CanPost", "CanComment", "CanInvite", "CanModerate", "CanManagePosts"], member: ["CanPost", "CanComment", "CanInvite"], muted: ["CanComment"], pending: [], banned: [] };
const can = (cid, perm) => (PERMS[S.membership(cid)?.role] || []).includes(perm);
const _community = Views.community;
Views.community = function (id) {
  const c = S.community(id); if (!c) return Views.notFound();
  const tab = view._ctab || "home";
  const extraTabs = ["media", "events", "pending", "settings", "rep"];
  if (!extraTabs.includes(tab)) { _community(id); }
  else { view._ctab = "about"; _community(id); view._ctab = tab; }
  const tabsEl = view.querySelector(".tabs"), m = S.membership(id);
  const add = (k, l) => { const b = document.createElement("button"); b.className = "tab" + (tab === k ? " on" : ""); b.textContent = l; b.onclick = () => { view._ctab = k; rerender(); }; tabsEl.appendChild(b); };
  tabsEl.querySelectorAll(".tab").forEach(t => { if (extraTabs.includes(tab)) t.classList.remove("on"); });
  add("media", "الوسائط"); add("events", "الأحداث"); add("rep", "السمعة");
  const pendings = DB.memberships.filter(x => x.community === id && x.role === "pending");
  if (can(id, "CanManageMembers")) add("pending", `الطلبات${pendings.length ? " (" + pendings.length + ")" : ""}`);
  if (can(id, "CanEditRules")) add("settings", "الإعدادات");
  // header actions: invite + my badges
  const head = view.querySelector(".profile-top .stats");
  if (head && m && !["pending", "banned"].includes(m.role)) {
    head.insertAdjacentHTML("beforeend", `<span>سمعتك: <b>${reputation(id, DB.me)}</b></span>${communityBadges(id, DB.me).map(b => `<span class="rep">${b}</span>`).join("")}`);
    if (can(id, "CanInvite")) { const ib = document.createElement("button"); ib.className = "btn ghost"; ib.textContent = "دعوة"; ib.style.marginTop = "8px"; ib.onclick = () => inviteFlow("community", id); head.after(ib); }
  }
  if (c.type === "invite" && !m) { const jb = view.querySelector(`[data-join="${id}"]`); if (jb) { jb.textContent = "بالدعوة فقط"; jb.disabled = true; jb.removeAttribute("data-join"); } }
  if (!extraTabs.includes(tab)) {
    // members tab: add mute/ban for managers + rep
    if (tab === "members") view.querySelectorAll(".wrap > .card.row").forEach(row => {
      const link = row.querySelector("a.grow"); const handle = link?.getAttribute("href").split("/").pop(); const u = S.byHandle(handle); if (!u) return;
      link.querySelector(".muted").insertAdjacentHTML("beforeend", ` · سمعة ${reputation(id, u.id)} ${communityBadges(id, u.id).map(b => `<span class="rep">${b}</span>`).join("")}`);
      if (can(id, "CanManageMembers") && u.id !== DB.me && c.owner !== u.id) { const b = document.createElement("button"); b.className = "btn ghost"; b.textContent = "⋯"; b.style.marginInlineStart = "6px"; b.onclick = () => memberActions(id, u.id); row.appendChild(b); }
    });
    if (tab === "queue") view.querySelectorAll("[data-reject]").forEach(rb => { const eb = document.createElement("button"); eb.className = "btn ghost"; eb.textContent = "طلب تعديل"; eb.onclick = () => { const p = S.post(rb.dataset.reject); p.status = "draft"; DB.drafts.unshift({ id: uid("d"), text: p.text, community: id, at: now() }); DB.audit.push({ action: "EDIT_REQUESTED", target: p.id, by: DB.me, at: now() }); save(); toast("أُعيد للكاتب لطلب التعديل"); rerender(); }; rb.after(eb); });
    return;
  }
  const body = view.querySelector(".wrap"); const tabsHtml = tabsEl.outerHTML;
  let html = "";
  if (tab === "media") html = DB.posts.filter(p => p.community === id && p.status === "published" && (p.media || p.images || p.video)).map(p => postCard(p)).join("") || '<div class="empty">لا وسائط</div>';
  if (tab === "events") html = (can(id, "CanPost") ? `<button class="u-mb10 btn block" id="cev">＋ حدث للمجتمع</button>` : "") + (DB.events.filter(e => e.community === id).map(eventRow).join("") || '<div class="empty">لا أحداث</div>');
  if (tab === "rep") html = `<div class="card"><p class="muted">السمعة تُحسب داخل كل مجتمع على حدة: جودة المساهمات، الإجابات المقبولة، التفاعل الإيجابي، ومدة العضوية.</p></div>` + S.members(id).map(x => ({ u: S.user(x.user), r: reputation(id, x.user) })).sort((a, b) => b.r - a.r).map((x, i) => `<div class="card row"><b>${i + 1}</b>${av(x.u, "sm")}<div class="grow"><b>${esc(x.u.name)}</b> ${communityBadges(id, x.u.id).map(b => `<span class="rep">${b}</span>`).join("")}</div><b>${x.r}</b></div>`).join("");
  if (tab === "pending") html = pendings.map(x => { const u = S.user(x.user); return `<div class="card row">${av(u)}<div class="grow"><b>${esc(u.name)}</b><div class="muted">طلب انضمام</div></div><button class="btn" data-ok="${u.id}">قبول</button><button class="u-ms6 btn ghost" data-no="${u.id}">رفض</button></div>`; }).join("") || '<div class="empty">لا طلبات</div>';
  if (tab === "settings") html = `<div class="card"><label class="muted">الاسم</label><input id="sn" value="${esc(c.name)}"><label class="u-db u-mt8 muted">الوصف</label><textarea id="sd" class="u-mh70">${esc(c.desc)}</textarea>
    <label class="u-db u-mt8 muted">الخصوصية</label><select id="stp"><option value="public">عام</option><option value="private">خاص</option><option value="invite">بالدعوة</option></select>
    <label class="u-db u-mt8 muted">القواعد (سطر لكل قاعدة)</label><textarea id="sr" class="u-mh80">${esc(c.rules.join("\n"))}</textarea>
    <label class="u-db u-mt8 muted">من يستطيع النشر</label><select id="swho"><option value="members">كل الأعضاء</option><option value="mods">المشرفون فقط</option></select>
    <label class="chk"><input type="checkbox" id="sap" ${c.requireApproval ? "checked" : ""}> المنشورات تحتاج موافقة</label>
    <label class="chk"><input type="checkbox" id="slk" ${c.allowLinks !== false ? "checked" : ""}> السماح بالروابط</label>
    <label class="chk"><input type="checkbox" id="smd" ${c.allowMedia !== false ? "checked" : ""}> السماح بالصور والفيديو</label>
    <label class="chk"><input type="checkbox" id="scm" ${c.allowCommercial ? "checked" : ""}> السماح بالمحتوى التجاري</label>
    <label class="chk"><input type="checkbox" id="sai" ${c.aiModeration ? "checked" : ""}> مساعد الإشراف الذكي (فحص المخالفات قبل النشر)</label>
    <input id="sloc" placeholder="النطاق الجغرافي (اختياري) مثل: جدة" value="${esc(c.location || "")}" class="u-mt8">
    <button class="u-mt12 btn block" id="ssave">حفظ</button></div>`;
  body.innerHTML = tabsHtml + html;
  body.querySelectorAll(".tabs .tab").forEach(b => { const map = { "الوسائط": "media", "الأحداث": "events", "السمعة": "rep", "الإعدادات": "settings" }; const k = map[b.textContent] || (b.textContent.startsWith("الطلبات") ? "pending" : b.dataset.ct); b.onclick = () => { view._ctab = k; rerender(); }; });
  if ($("#cev")) $("#cev").onclick = () => openComposer({ type: "event", community: id });
  body.querySelectorAll("[data-ok]").forEach(b => b.onclick = () => { S.membership(id, b.dataset.ok).role = "member"; DB.audit.push({ action: "MEMBER_APPROVED", target: b.dataset.ok, by: DB.me, at: now() }); save(); rerender(); });
  body.querySelectorAll("[data-no]").forEach(b => b.onclick = () => { DB.memberships = DB.memberships.filter(x => !(x.community === id && x.user === b.dataset.no)); save(); rerender(); });
  if ($("#ssave")) {
    $("#stp").value = c.type; $("#swho").value = c.whoCanPost || "members";
    $("#ssave").onclick = () => { Object.assign(c, { name: $("#sn").value.trim() || c.name, desc: $("#sd").value.trim(), type: $("#stp").value, rules: $("#sr").value.split("\n").filter(Boolean), whoCanPost: $("#swho").value, requireApproval: $("#sap").checked, allowLinks: $("#slk").checked, allowMedia: $("#smd").checked, allowCommercial: $("#scm").checked, aiModeration: $("#sai").checked, location: $("#sloc").value.trim() || null }); DB.audit.push({ action: "COMMUNITY_SETTINGS_UPDATED", target: id, by: DB.me, at: now() }); save(); toast("تم الحفظ"); rerender(); };
  }
};
function memberActions(cid, u) {
  const m = S.membership(cid, u);
  const s = sheet(`<h4>${esc(S.user(u).name)}</h4><div class="menu"><button data-r="moderator">تعيين مشرف</button><button data-r="admin">تعيين مدير</button><button data-r="member">عضو عادي</button><button data-r="muted"><svg class=ei aria-hidden=true><use href=#i-volumeX /></svg> كتم داخل المجتمع</button><button data-r="banned" class="u-c-dg"><svg class=ei aria-hidden=true><use href=#i-ban /></svg> حظر من المجتمع</button></div>`);
  s.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { m.role = b.dataset.r; DB.audit.push({ action: "ROLE_CHANGED", target: u, reason: b.dataset.r, by: DB.me, at: now() }); save(); closeSheet(); rerender(); });
}
// community posting rules enforced at create time
const _create2 = Cmd.createPost;
Cmd.createPost = (data) => {
  if (data.community) {
    const c = S.community(data.community), role = S.membership(c.id)?.role;
    if (!can(c.id, "CanPost") || (c.whoCanPost === "mods" && !["owner", "admin", "moderator"].includes(role))) return { error: "لا تملك صلاحية النشر في هذا المجتمع" };
    if (c.allowLinks === false && /https?:\/\//.test(data.text)) return { error: "الروابط غير مسموحة في هذا المجتمع" };
    if (c.allowMedia === false && (data.media || data.images || data.type === "video")) return { error: "الوسائط غير مسموحة في هذا المجتمع" };
    if (c.aiModeration && (classify(data.text).sensitive || /إعلان|خصم|اشترِ/.test(data.text) && !c.allowCommercial)) return { error: "مساعد الإشراف: قد يخالف المنشور قواعد المجتمع" };
  }
  return _create2(data);
};

/* ---------- Explore v2: events, trends link, natural-language location search ---------- */
const _explore = Views.explore;
Views.explore = function () {
  _explore();
  const q = view._q || "";
  const wrap = view.querySelector(".wrap");
  if (!q) {
    const prompt = DAILY_PROMPTS[new Date().getDay()];
    const dq = wrap.querySelector(".card.discover p"); if (dq) dq.textContent = prompt;
    const dqb = $("#dq"); if (dqb) dqb.onclick = () => openComposer({ text: prompt + "\n\n", topic: "learn" });
    const trendCard = wrap.querySelector(".card");
    trendCard.insertAdjacentHTML("beforeend", `<a href="#/trends" class="u-mt10 u-db u-tc btn ghost block">كل الترندات ومستوياتها ←</a>`);
    const rising = Trends.rising();
    const up = DB.events.filter(e => new Date(e.startsAt) > new Date()).slice(0, 2);
    trendCard.insertAdjacentHTML("afterend", (rising.length ? `<div class="card"><b><svg class=ei aria-hidden=true><use href=#i-trendUp /></svg> يصعد الآن</b>${rising.map(t => `<a class="trend" href="#/tag/${encodeURIComponent(t.tag)}"><span><bdi>#${esc(t.tag)}</bdi></span><span class="muted">+${t.last6} خلال ٦س</span></a>`).join("")}</div>` : "") +
      (up.length ? `<div class="row"><h4 class="grow"><svg class="ic hi" aria-hidden="true"><use href="#i-calendar"/></svg>أحداث قادمة</h4><a href="#/events" class="muted">الكل</a></div>${up.map(eventRow).join("")}` : "") +
      `<div class="row"><h4 class="grow"><svg class="ic hi" aria-hidden="true"><use href="#i-clapper"/></svg>فيديوهات قصيرة</h4></div><div class="grid3">${S.visiblePosts().filter(p => p.type === "video" && p.status === "published").map(p => `<div data-play="${p.id}" class="play" style="background:${p.media};cursor:pointer;aspect-ratio:9/14"></div>`).join("")}</div>`);
  } else {
    const loc = q.match(/في\s+(\S+)/); const extra = [];
    if (loc) { const city = loc[1].replace(/^ال/, ""); const posts = S.visiblePosts().filter(p => (p.location || "").includes(city)); const comms = DB.communities.filter(c => (c.location || "").includes(city)); if (posts.length || comms.length) extra.push(`<h4><svg class="ic hi" aria-hidden="true"><use href="#i-mapPin"/></svg>في ${esc(loc[1])}</h4>${comms.map(commRow).join("")}${posts.map(p => postCard(p)).join("")}`); }
    const evs = DB.events.filter(e => (e.name + e.desc).includes(q.replace(/[#@]/g, "").split(" ")[0]));
    if (evs.length) extra.push(`<h4>الأحداث</h4>${evs.map(eventRow).join("")}`);
    const tags = Trends.multi().filter(t => t.tag.includes(q.replace(/[#@\s]/g, "").replace(/^ال/, ""))).slice(0, 5);
    if (tags.length) extra.push(`<h4>الهاشتاغات</h4><div class="chips">${tags.map(t => `<a class="tab" href="#/tag/${encodeURIComponent(t.tag)}"><bdi>#${esc(t.tag)}</bdi></a>`).join("")}</div>`);
    if (extra.length) { const emp = wrap.querySelector(".empty"); if (emp) emp.remove(); wrap.insertAdjacentHTML("beforeend", extra.join("")); }
  }
};

/* ---------- Topic page v2: hashtags, events ---------- */
const _topic = Views.topic;
Views.topic = function (slug) {
  _topic(slug);
  const tags = Object.entries(TOPIC_ALIASES).filter(([k, v]) => v === slug).map(([k]) => k);
  const card = view.querySelector(".card.discover");
  if (card && tags.length) card.insertAdjacentHTML("beforeend", `<div class="u-mt10 chips">${tags.slice(0, 4).map(t => `<a class="tab" href="#/tag/${encodeURIComponent(t)}">#${t}</a>`).join("")}</div>`);
  const t = Trends.multi("topic", slug).slice(0, 3);
  if (card && t.length) card.insertAdjacentHTML("afterend", `<div class="card"><b><svg class=ei aria-hidden=true><use href=#i-fire /></svg> ترند ${S.topic(slug).name}</b>${t.map(x => `<a class="trend" href="#/tag/${encodeURIComponent(x.tag)}"><span><bdi>#${esc(x.tag)}</bdi></span><span class="muted">${x.unique} مشارك</span></a>`).join("")}</div>`);
};

/* ---------- Profile v2: add-to-list, support, activity (reposts) ---------- */
const _profile = Views.profile;
Views.profile = function (handle) {
  _profile(handle);
  const u = handle ? S.byHandle(handle) : S.me(); if (!u) return;
  if (u.id !== DB.me) {
    const pm = $("#pmore"); if (pm) { const old = pm.onclick; pm.onclick = () => { old(); const menu = document.querySelector("#sheet .menu"); const b = document.createElement("button"); b.textContent = "إضافة إلى قائمة"; b.onclick = () => addToList(u.id); menu.prepend(b); const b2 = document.createElement("button"); b2.textContent = "دعم بعملة Pi"; b2.onclick = async () => { closeSheet(); try { await PiAdapter.createPayment(1, "دعم", {}); } catch (e) { toast("دعم المبدعين بعملة Pi يُفعّل مع الربط"); } }; menu.prepend(b2); }; }
  } else {
    const top = view.querySelector(".profile-top p");
    if (top) top.insertAdjacentHTML("afterend", `<div class="u-mb6 chips"><a class="tab" href="#/lists"><svg class=ei aria-hidden=true><use href=#i-list /></svg> القوائم</a><a class="tab" href="#/events"><svg class=ei aria-hidden=true><use href=#i-calendar /></svg> الأحداث</a><a class="tab" href="#/interests"><svg class=ei aria-hidden=true><use href=#i-target /></svg> الاهتمامات</a><a class="tab" href="#/library"><svg class=ei aria-hidden=true><use href=#i-bookmarkF /></svg> المكتبة</a><a class="tab" href="#/studio"><svg class=ei aria-hidden=true><use href=#i-chart /></svg> استوديو المنشئ</a></div>`);
  }
};

/* ---------- Library v2: interacted history + collection management ---------- */
const _library = Views.library;
Views.library = function () {
  const tab = view._ltab || "saved";
  if (tab === "interacted") {
    view._ltab = "history"; _library(); view._ltab = "interacted";
    const ids = [...new Set(DB.reactions.filter(r => r.user === DB.me).map(r => r.target).concat(DB.comments.filter(c => c.author === DB.me).map(c => c.post)))].filter(id => S.post(id));
    const wrap = view.querySelector(".wrap"); wrap.querySelectorAll(".card,.empty").forEach(x => x.remove());
    wrap.insertAdjacentHTML("beforeend", ids.map(id => postCard(S.post(id))).join("") || '<div class="empty">لم تتفاعل مع شيء بعد</div>');
  } else _library();
  const tabs = view.querySelector(".tabs");
  const b = document.createElement("button"); b.className = "tab" + (tab === "interacted" ? " on" : ""); b.textContent = "تفاعلت معه"; b.onclick = () => { view._ltab = "interacted"; rerender(); }; tabs.appendChild(b);
  if (tab === "interacted") tabs.querySelectorAll(".tab").forEach(t => t !== b && t.classList.remove("on"));
  if (tab === "saved") view.querySelectorAll(".wrap h4").forEach((h, i) => { const col = DB.collections[i]; if (!col) return; h.insertAdjacentHTML("beforeend", ` <a data-rn="${col.id}" class="u-t-xs u-cp muted"><svg class=ei aria-hidden=true><use href=#i-pen /></svg> إعادة تسمية</a>`); });
  view.querySelectorAll("[data-rn]").forEach(a => a.onclick = () => { const c = DB.collections.find(x => x.id === a.dataset.rn); const n = prompt("الاسم الجديد", c.name); if (n) { c.name = n; save(); rerender(); } });
  if (tab === "saved") view.querySelector(".tabs").insertAdjacentHTML("afterend", `<button class="btn ghost" id="ncol">＋ مجموعة جديدة</button>`);
  if ($("#ncol")) $("#ncol").onclick = () => { const n = prompt("اسم المجموعة"); if (n) { DB.collections.push({ id: uid("col"), name: n, items: [] }); save(); rerender(); } };
};

/* v2.81: the settings hub lives in the lazy «setx» chunk (settings-hub.js); this hook keeps its place in the MPSettings order */
MPSettings.add(function () { if (window.MPSettingsV2) window.MPSettingsV2.apply(this, arguments); });

/* ---------- Notifications v2: more kinds ---------- */
const _notifs = Views.notifications;
Views.notifications = function () {
  _notifs();
  const map = { video: "اكتملت معالجة الفيديو الخاص بك ✓", scheduled: "نُشر منشورك المجدول ✓", invite: "دعاك", approved: "قُبل طلب انضمامك", event: "تذكير بحدث قادم" };
  view.querySelectorAll(".card.row .grow").forEach((g, i) => { const n = DB.notifications.filter(x => x.user === DB.me)[i]; if (n && map[n.kind]) g.innerHTML = g.innerHTML.replace(n.kind, map[n.kind]); });
};
// event reminders (client side; server cron later)
setInterval(() => DB.events.forEach(e => { const dt = new Date(e.startsAt) - Date.now(); if ((e.reminders || []).includes(DB.me) && dt > 0 && dt < 3600e3 && !e._reminded) { e._reminded = true; notify(DB.me, "event", { actor: e.organizer }); save(); App.refreshBadges(); } }), 60e3);

/* ---------- Home v2: daily prompt card + new-user discovery when feed is thin ---------- */
HomeHooks.section("circle", 10, function () {
  const bar = $("#cbar"); if (bar) bar.querySelector(".fake").textContent = (I18N[DB.settings.lang] || I18N.ar).compose;
  const following = S.following(DB.me).length;
  if (following < 2 && feedMode === "for") {
    const tabs = view.querySelector(".tabs");
    tabs.insertAdjacentHTML("afterend", `<div class="card discover"><b><svg class=ei aria-hidden=true><use href=#i-raise /></svg> ابدأ ببناء دائرتك</b><p class="muted">تابع أشخاصاً وانضم لمجتمعات لتصبح خلاصتك أذكى.</p>${DB.users.filter(u => u.id !== DB.me && !S.follows(DB.me, u.id)).slice(0, 3).map(userRow).join("")}</div>`);
  }
});

/* ---------- Routes ---------- */
MPRoutes.extend((a, b) => ({
  series: () => V12.series(a), events: () => V12.events(), event: () => V12.event(a), lists: () => V12.lists(), list: () => V12.list(a),
  interests: () => V12.interests(), trends: () => V12.trends(), admin: () => V12.admin(), decisions: () => V12.decisions(),
  search: () => { location.replace("#/explore"); setTimeout(() => $("#sq")?.focus(), 50); }
}));

/* wrap route to apply shell + post-render hooks */
const _route = route;
route = function () { _route(); afterRender(); };
window.addEventListener("hashchange", () => afterRender());
applyShell();
if (!window.__deferRoute) route();
