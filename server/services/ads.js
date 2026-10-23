/* Ethical ads — الإعلانات الأخلاقية (phase 40). Built on the Pi service (purpose `ads`, prepaid budget), the shared
 * double-entry ledger (lib/ledger.js), the ranking feed (insertion), automod (pre-publication check), notify, compliance
 * and minors. Contract: docs/integration/p40-contract.md · design: docs/ADS.md.
 * 1. Promoted posts: an advertiser promotes one of their OWN public posts (published, not a story, not paid/locked, not in a
 *    community, not sensitive). Feed items carry promoted:{campaignId, label:"مُروَّج", advertiser, token}.
 * 2. Targeting without tracking: only the topics a viewer follows or chose as interests, their UI language and the country
 *    they set on their profile. Sensitive categories (health, religion, politics, sexuality, ethnicity…) are refused
 *    (400 targeting_sensitive). Viewers who switch personalised ads off only get campaigns without topic/country targeting.
 * 3. Frequency caps: per viewer per campaign, counted under HMAC(daily random salt, userId:campaignId) in ad_freq. Salts
 *    live in ad_meta and are deleted after a day, ad_freq/ad_tokens rows after 7 days (leased scheduler job ads.maintain).
 * 4. Campaign manager: draft → submit (spam + automod) → in_review → staff approve/reject → awaiting_funds | active →
 *    paused ↔ active → completed (budget spent or end_at passed) | removed.
 * 5. Ad data separated from personal data: ad_stats_daily and ad_feedback hold aggregates only (no user id columns);
 *    advertisers see counts < ADS_K_ANON (10) as «أقل من 10».
 * 6. Charging: CPM from the prepaid budget. Spend accrues per impression on ad_campaigns.spent / ad_stats_daily.spend and is
 *    journaled in batches `ads:budget:<cid>` → `platform:ads` (idempotent ikey = cumulative spend). Funding journal:
 *    `user:<id>:pi_out` → `ads:budget:<cid>` on PI_PAYMENT_COMPLETED.
 * Minors never see ads and cannot advertise (403 minor_restricted). Pi off → fund 409 not_configured, campaigns can still
 * be created and reviewed (awaiting_funds). */
const crypto = require("node:crypto");
const { E, HttpError, id, Classifier, TOPICS } = require("../lib/core");
const { toUnits, pi, ACC, createLedger } = require("../lib/ledger");

const DAY = 864e5, HOUR = 3600e3;
const OFF = "مدفوعات Pi غير مفعّلة بعد";
const LABEL = "مُروَّج";
const STATUSES = ["draft", "in_review", "rejected", "awaiting_funds", "active", "paused", "completed", "removed"];
const OBJECTIVES = ["reach", "engagement", "visits"];
/** sensitive categories: never targetable (slugs + common Arabic/English aliases, compared lower-cased without "#") */
const SENSITIVE = ["health", "medical", "mental_health", "religion", "religious", "faith", "politics", "political", "elections", "sexuality", "sexual_orientation", "lgbt", "lgbtq", "ethnicity", "race", "ethnic",
  "صحة", "الصحة", "طب", "مرض", "دين", "الدين", "ديانة", "عقيدة", "مذهب", "سياسة", "السياسة", "انتخابات", "أحزاب", "جنس", "الجنس", "ميول", "عرق", "العرق", "أصل", "قبيلة", "طائفة"];
const SENSITIVE_SET = new Set(SENSITIVE.map((s) => s.toLowerCase()));
const TOPIC_SLUGS = new Set(TOPICS.map((t) => t.slug));
const REJECT_REASONS = { misleading: "ادعاءات مضللة", prohibited: "منتج أو خدمة محظورة", sensitive: "استهداف أو محتوى حساس", quality: "جودة منخفضة", guidelines: "يخالف إرشادات المجتمع", other: "سبب آخر" };
const HIDE_REASONS = ["irrelevant", "repetitive", "offensive", "misleading", "other"];
const FEED_MODES = ["for", "following", "chrono", "latest", "discover"];
const ADMIN_ROLES = ["admin", "moderator"];

/* ---------- pure helpers (unit-testable) ---------- */
const normTopic = (s) => String(s || "").trim().replace(/^#/, "").toLowerCase();
const isSensitive = (s) => SENSITIVE_SET.has(normTopic(s));
/**
 * Does a campaign's targeting match a viewer? Returns null (no match) or the list of reasons.
 * @param {{topics?:string[], languages?:string[], countries?:string[]}} t
 * @param {null | {personalized:boolean, topics:Set<string>, lang:string|null, country:string|null}} v  null = signed out
 */
function matchTargeting(t, v) {
  const topics = t.topics || [], langs = t.languages || [], countries = t.countries || [];
  if (!v) return topics.length || langs.length || countries.length ? null : [{ type: "general" }];
  const reasons = [];
  if (topics.length) {
    if (!v.personalized) return null;
    const hit = topics.filter((x) => v.topics.has(x));
    if (!hit.length) return null;
    for (const x of hit.slice(0, 3)) reasons.push({ type: "topic", topic: x });
  }
  if (langs.length) { if (!v.lang || !langs.includes(v.lang)) return null; reasons.push({ type: "language" }); }
  if (countries.length) {
    if (!v.personalized || !v.country || !countries.includes(v.country)) return null;
    reasons.push({ type: "country" });
  }
  return reasons.length ? reasons : [{ type: "general" }];
}
/** k-anonymous audience bucket */
function audienceBucket(n, k = 10) {
  if (n < k) return { bucket: "lt" + k, min: 0, max: k - 1, label: `أقل من ${k}` };
  for (const [min, max, label] of [[k, 99, `${k}–100`], [100, 999, "100–1,000"], [1000, 9999, "1,000–10,000"], [10000, 99999, "10,000–100,000"]])
    if (n <= max) return { bucket: `${min}-${max + 1}`, min, max: max + 1, label };
  return { bucket: "100000+", min: 100000, max: null, label: "أكثر من 100,000" };
}
/** feed positions (0-based index into the organic page) AFTER which an ad goes: never first, ≤ 1 per `interval` organic posts */
function slotsFor(cursor, count, interval) {
  const out = [];
  if (!(interval >= 2)) return out;
  for (let i = 0; i < count; i++) if ((cursor + i + 1) % interval === 0) out.push(i);
  return out;
}

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const dayOf = (d = clock()) => new Date(d).toISOString().slice(0, 10);
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const cfg = {
    interval: Math.max(2, Math.floor(num("ADS_FEED_INTERVAL", 8))),
    kAnon: Math.max(2, Math.floor(num("ADS_K_ANON", 10))),
    minBudget: toUnits(num("ADS_MIN_BUDGET", 1)),
    maxBudget: toUnits(num("ADS_MAX_BUDGET", 1000)),
    minCpm: toUnits(num("ADS_MIN_CPM", 0.01)),
    maxCpm: toUnits(num("ADS_MAX_CPM", 100)),
    defaultCpm: toUnits(num("ADS_DEFAULT_CPM", 0.5)),
    maxDays: Math.max(1, num("ADS_MAX_DAYS", 90)),
    lowPct: Math.min(100, num("ADS_BUDGET_LOW_PCT", 80)),
    retentionMs: num("ADS_FREQ_RETENTION_DAYS", 7) * DAY
  };
  const { postJournal } = createLedger({ now: nowIso });
  const BUDGET = (cid) => `ads:budget:${cid}`;
  const PLATFORM = "platform:ads";
  const inList = (arr, start = 1) => arr.map((_, i) => "$" + (i + start)).join(",");
  const iso = (v) => (v == null ? null : typeof v === "string" ? v : new Date(v).toISOString());
  const ms = (v) => (v == null ? NaN : new Date(v).getTime());
  const parseJson = (v, d) => { if (v && typeof v === "object") return v; try { const x = JSON.parse(v); return x ?? d; } catch { return d; } };
  const isStaff = (u) => ADMIN_ROLES.includes(u?.role);
  const piSvc = () => ctx.services.pi;
  const piOn = () => !!piSvc()?.enabled?.();
  const content = () => ctx.services.content;
  const notify = (uid, kind, o) => ctx.services.notify?.notify?.(uid, kind, o)?.catch?.((e) => logger.warn?.("ads notify failed", { kind, err: e.message }));
  const audit = (action, target, reason, by) => { try { ctx.audit?.(action, target, reason, by); } catch { /* audit is best effort */ } };

  async function isMinor(uid) {
    const m = ctx.services.minors; // registered last
    if (!uid || !m?.isMinorUser) return false;
    try { return !!(await m.isMinorUser(uid)); } catch { return false; }
  }
  const minorRestricted = () => fail(403, "minor_restricted", "الإعلانات غير متاحة لمن هم دون ١٨ سنة");

  /* ======================= keys: token key + rotating daily salt ======================= */
  async function meta(key, make) {
    const r = await db.get("SELECT value FROM ad_meta WHERE key=$1", [key]);
    if (r) return r.value;
    await db.run("INSERT INTO ad_meta(key,value,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [key, make(), nowIso()]);
    return (await db.get("SELECT value FROM ad_meta WHERE key=$1", [key])).value;
  }
  let tokenKeyP = null;
  const tokenKey = () => (tokenKeyP ||= (async () => env.ADS_TOKEN_SECRET || meta("token_key", () => crypto.randomBytes(32).toString("base64url")))().catch((e) => { tokenKeyP = null; throw e; }));
  const salts = new Map();
  async function saltFor(day) {
    if (salts.has(day)) return salts.get(day);
    const v = await meta("salt:" + day, () => crypto.randomBytes(32).toString("base64url"));
    salts.set(day, v);
    if (salts.size > 4) salts.delete(salts.keys().next().value);
    return v;
  }
  /** per-viewer, per-campaign, per-day pseudonymous key; the salt is random and deleted after a day */
  async function viewerHash(uid, cid, day = dayOf()) {
    return crypto.createHmac("sha256", await saltFor(day)).update(uid + ":" + cid).digest("hex").slice(0, 40);
  }
  async function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = crypto.createHmac("sha256", await tokenKey()).update(body).digest().subarray(0, 18).toString("base64url");
    return `${body}.${sig}`;
  }
  async function readToken(tok) {
    if (typeof tok !== "string" || tok.length > 600 || !tok.includes(".")) return null;
    const [body, sig] = tok.split(".");
    const want = crypto.createHmac("sha256", await tokenKey()).update(body).digest().subarray(0, 18);
    const got = Buffer.from(String(sig || ""), "base64url");
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    try { return JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  }

  /* ======================= prefs ======================= */
  async function prefsRow(uid) {
    const r = uid ? await db.get("SELECT * FROM ad_prefs WHERE user_id=$1", [uid]) : null;
    return { personalized: r ? !!Number(r.personalized) : true, hiddenAdvertisers: parseJson(r?.hidden_advertisers, []), hiddenAds: parseJson(r?.hidden_ads, []) };
  }
  async function savePrefsRow(uid, p) {
    await db.run(`INSERT INTO ad_prefs(user_id,personalized,hidden_advertisers,hidden_ads,updated_at) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (user_id) DO UPDATE SET personalized=$2, hidden_advertisers=$3, hidden_ads=$4, updated_at=$5`,
    [uid, p.personalized ? 1 : 0, JSON.stringify(p.hiddenAdvertisers.slice(0, 500)), JSON.stringify(p.hiddenAds.slice(-500)), nowIso()]);
  }
  async function prefsClient(uid) {
    const p = await prefsRow(uid);
    const users = p.hiddenAdvertisers.length ? await db.all(`SELECT id, handle, name, avatar FROM users WHERE id IN (${inList(p.hiddenAdvertisers)})`, p.hiddenAdvertisers) : [];
    return { personalized: p.personalized, hiddenAdvertisers: users.map((u) => ({ id: u.id, handle: u.handle, name: u.name, avatar: u.avatar || null })), hiddenAdsCount: p.hiddenAds.length,
      explain: "نستخدم فقط المواضيع التي تتابعها أو اخترتها، ولغتك، والبلد في ملفك. لا تتبّع عبر المواقع ولا رسائل خاصة ولا فئات حساسة." };
  }
  async function putPrefs(user, b) {
    if (!b || typeof b !== "object") throw E.bad();
    const p = await prefsRow(user.id);
    if (b.personalized !== undefined) { if (typeof b.personalized !== "boolean") throw E.bad("personalized: true أو false"); p.personalized = b.personalized; }
    if (b.hiddenAdvertisers !== undefined) {
      if (!Array.isArray(b.hiddenAdvertisers) || b.hiddenAdvertisers.length > 500) throw E.bad("قائمة المعلنين المخفيين غير صالحة");
      p.hiddenAdvertisers = [...new Set(b.hiddenAdvertisers.map((x) => (x && typeof x === "object" ? x.id : x)).filter((x) => typeof x === "string" && x.length <= 80))];
    }
    if (b.hiddenAds === null || (Array.isArray(b.hiddenAds) && !b.hiddenAds.length)) p.hiddenAds = []; // "reset hidden ads"
    await savePrefsRow(user.id, p);
    return prefsClient(user.id);
  }

  /* ======================= validation ======================= */
  const invalid = (msg) => fail(400, "campaign_invalid", msg);
  function piAmount(v, min, max, label) {
    const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof x !== "number" || !Number.isFinite(x)) throw fail(400, "budget_invalid", `${label} غير صالح`);
    const u = toUnits(x);
    if (Math.abs(u - x * 1e7) > 1e-3 * Math.max(1, x)) throw fail(400, "budget_invalid", `${label}: بحد أقصى ٧ خانات عشرية`);
    if (u < min || u > max) throw fail(400, "budget_invalid", `${label} بين ${pi(min)} و${pi(max)} Pi`);
    return u;
  }
  function validateTargeting(t) {
    if (t === undefined || t === null) return { topics: [], languages: [], countries: [] };
    if (typeof t !== "object" || Array.isArray(t)) throw fail(400, "targeting_invalid", "الاستهداف غير صالح");
    const arr = (v, max, label) => { if (v === undefined || v === null) return []; if (!Array.isArray(v) || v.length > max) throw fail(400, "targeting_invalid", `${label}: حتى ${max}`); return v; };
    const topics = arr(t.topics, 10, "المواضيع").map((x) => (typeof x === "object" && x ? x.slug : x));
    for (const x of topics) if (typeof x !== "string" || isSensitive(x)) { if (typeof x === "string") throw fail(400, "targeting_sensitive", "لا يمكن الاستهداف حسب فئات حساسة (الصحة، الدين، السياسة، الميول، العرق)"); throw fail(400, "targeting_invalid", "موضوع غير صالح"); }
    for (const x of topics) if (!TOPIC_SLUGS.has(normTopic(x))) throw fail(400, "targeting_invalid", "موضوع غير معروف: " + String(x).slice(0, 40));
    const languages = arr(t.languages, 5, "اللغات").map((x) => String(x || "").toLowerCase());
    for (const x of languages) if (!/^[a-z]{2}$/.test(x)) throw fail(400, "targeting_invalid", "رمز لغة غير صالح");
    const countries = arr(t.countries, 30, "الدول").map((x) => String(x || "").toUpperCase());
    for (const x of countries) if (!/^[A-Z]{2}$/.test(x)) throw fail(400, "targeting_invalid", "رمز دولة غير صالح");
    const extra = Object.keys(t).filter((k) => !["topics", "languages", "countries"].includes(k));
    if (extra.length) throw fail(400, "targeting_invalid", "مدخلات استهداف غير مسموحة: " + extra.join(", ").slice(0, 80)); // no age/gender/behaviour targeting
    return { topics: [...new Set(topics.map(normTopic))], languages: [...new Set(languages)], countries: [...new Set(countries)] };
  }
  async function validatePost(user, pid) {
    if (typeof pid !== "string" || !pid || pid.length > 100) throw fail(400, "post_invalid", "اختر منشوراً من منشوراتك");
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!p || p.author !== user.id) throw fail(400, "post_invalid", "يمكنك ترويج منشوراتك أنت فقط");
    if (p.status !== "published" || p.type === "story") throw fail(400, "post_invalid", "المنشور غير منشور أو قصة");
    if (p.visibility !== "public") throw fail(400, "post_invalid", "روّج منشوراً عاماً فقط");
    if (p.community) throw fail(400, "post_invalid", "منشورات المجتمعات لا تُروَّج حالياً");
    if (Number(p.sensitive)) throw fail(400, "post_invalid", "لا يمكن ترويج محتوى حساس");
    if (parseJson(p.data, {})?.paid || (await db.get("SELECT 1 x FROM paid_posts WHERE post_id=$1 AND state='active'", [pid]).catch(() => null))) throw fail(400, "post_invalid", "لا يمكن ترويج منشور مدفوع");
    const u = await db.get("SELECT private FROM users WHERE id=$1", [user.id]).catch(() => null);
    if (u && Number(u.private)) throw fail(400, "post_invalid", "حسابك خاص؛ اجعله عاماً لترويج منشوراته");
    const lab = await db.get("SELECT 1 x FROM content_labels WHERE target=$1 LIMIT 1", [pid]).catch(() => null);
    if (lab) throw fail(400, "post_invalid", "المنشور يحمل وسم محتوى حساس");
    return p;
  }
  /** cur = stored campaign row for PATCH, null for create */
  async function validateCampaign(user, b, cur = null) {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw invalid("بيانات الحملة غير صالحة");
    const has = (k) => b[k] !== undefined;
    const out = {};
    if (!cur || has("name")) {
      const n = typeof b.name === "string" ? b.name.trim() : "";
      if (n.length < 3 || n.length > 80) throw invalid("اسم الحملة من ٣ إلى ٨٠ حرفاً");
      out.name = n;
    }
    if (!cur || has("objective")) { const o = b.objective ?? "reach"; if (!OBJECTIVES.includes(o)) throw invalid("الهدف: وصول أو تفاعل أو زيارات"); out.objective = o; }
    const pid = has("postId") ? b.postId : has("post_id") ? b.post_id : undefined;
    if (!cur || pid !== undefined) out.post_id = (await validatePost(user, pid)).id;
    if (!cur || has("targeting")) out.targeting = JSON.stringify(validateTargeting(b.targeting));
    const bud = b.budget && typeof b.budget === "object" ? b.budget : {};
    const total = b.budgetTotal ?? bud.total, daily = b.dailyCap ?? bud.dailyCap, cpm = b.bidCpm ?? bud.bidCpm;
    if (!cur || total !== undefined) out.budget_total = piAmount(total, cfg.minBudget, cfg.maxBudget, "الميزانية");
    const budgetTotal = out.budget_total ?? Number(cur?.budget_total);
    if (!cur || daily !== undefined || out.budget_total !== undefined) {
      const d = daily === undefined || daily === null ? (cur ? Math.min(Number(cur.daily_cap), budgetTotal) : budgetTotal) : piAmount(daily, toUnits(0.01), cfg.maxBudget, "السقف اليومي");
      if (d > budgetTotal) throw fail(400, "budget_invalid", "السقف اليومي لا يتجاوز الميزانية");
      out.daily_cap = d;
    }
    if (!cur || cpm !== undefined) out.bid_cpm = cpm === undefined || cpm === null ? cfg.defaultCpm : piAmount(cpm, cfg.minCpm, cfg.maxCpm, "سعر الألف ظهور");
    if (!cur || has("freqCap")) {
      const f = b.freqCap ?? { impressions: 3, perHours: 24 };
      if (!f || typeof f !== "object") throw invalid("حد التكرار غير صالح");
      const im = f.impressions ?? 3, hr = f.perHours ?? 24;
      if (!Number.isInteger(im) || im < 1 || im > 20) throw invalid("حد التكرار: من ١ إلى ٢٠ ظهوراً");
      if (!Number.isInteger(hr) || hr < 1 || hr > 24) throw invalid("نافذة التكرار: من ١ إلى ٢٤ ساعة");
      out.freq_impressions = im; out.freq_hours = hr;
    }
    const t0 = clock().getTime();
    if (!cur || has("startAt") || has("endAt")) {
      const s = has("startAt") && b.startAt !== null ? Date.parse(b.startAt) : cur ? ms(cur.start_at) : t0;
      if (!Number.isFinite(s)) throw invalid("تاريخ البدء غير صالح");
      const startMs = has("startAt") && b.startAt !== null && s < t0 - 10 * 60e3 ? NaN : s;
      if (!Number.isFinite(startMs)) throw invalid("تاريخ البدء في الماضي");
      const e = has("endAt") && b.endAt !== null ? Date.parse(b.endAt) : cur ? ms(cur.end_at) : startMs + 30 * DAY;
      if (!Number.isFinite(e) || e <= startMs + HOUR) throw invalid("تاريخ الانتهاء بعد البدء بساعة على الأقل");
      if (e - startMs > cfg.maxDays * DAY) throw invalid(`مدة الحملة حتى ${cfg.maxDays} يوماً`);
      out.start_at = new Date(startMs).toISOString(); out.end_at = new Date(e).toISOString();
    }
    return out;
  }

  /* ======================= serialisation ======================= */
  const kCount = (n) => { n = Number(n || 0); return n < cfg.kAnon ? { value: null, text: `أقل من ${cfg.kAnon}` } : { value: n, text: n.toLocaleString("en-US") }; };
  function statsRow(day, imp, clk, spend) {
    const i = kCount(imp), c = kCount(clk);
    return { day, impressions: i.value, impressionsText: i.text, clicks: c.value, clicksText: c.text, spend: pi(spend),
      ctr: i.value !== null && c.value !== null && i.value > 0 ? Math.round((c.value / i.value) * 10000) / 100 : null };
  }
  async function stats(c) {
    const rows = await db.all("SELECT day, impressions, clicks, spend FROM ad_stats_daily WHERE campaign_id=$1 ORDER BY day", [c.id]);
    const sum = rows.reduce((a, r) => ({ i: a.i + Number(r.impressions), c: a.c + Number(r.clicks), s: a.s + Number(r.spend) }), { i: 0, c: 0, s: 0 });
    const fb = await db.all("SELECT reason, SUM(count) AS n FROM ad_feedback WHERE campaign_id=$1 GROUP BY reason", [c.id]);
    return { days: rows.map((r) => statsRow(r.day, r.impressions, r.clicks, r.spend)), totals: statsRow(null, sum.i, sum.c, sum.s),
      hides: fb.map((r) => ({ reason: r.reason, ...((k) => ({ count: k.value, countText: k.text }))(kCount(r.n)) })), kAnon: cfg.kAnon };
  }
  function actionsOf(c) {
    const a = [];
    if (["draft", "rejected"].includes(c.status)) a.push("edit", "submit");
    if (["awaiting_funds", "active", "paused"].includes(c.status)) a.push("edit_limited");
    if (c.status === "active") a.push("pause");
    if (c.status === "paused") a.push("resume");
    if (!Number(c.funded_amount) && ["draft", "in_review", "awaiting_funds"].includes(c.status)) a.push("fund");
    if (c.status !== "removed") a.push("delete");
    return a;
  }
  async function postBrief(pid) {
    const p = await db.get("SELECT id, author, type, title, text, topic, lang, status, visibility, created_at FROM posts WHERE id=$1", [pid]);
    return p ? { id: p.id, type: p.type, title: p.title || null, text: String(p.text || "").slice(0, 280), topic: p.topic || null, lang: p.lang || null, status: p.status, visibility: p.visibility, createdAt: iso(p.created_at) } : null;
  }
  async function campaignClient(c, viewer, full = false) {
    const t = parseJson(c.targeting, {});
    const lastReview = await db.get("SELECT decision, reasons, note, at, reviewer FROM ad_reviews WHERE campaign_id=$1 ORDER BY at DESC, id DESC LIMIT 1", [c.id]);
    const funded = Number(c.funded_amount), spent = Number(c.spent);
    const out = {
      id: c.id, name: c.name, objective: c.objective, status: c.status, post: await postBrief(c.post_id), postId: c.post_id,
      targeting: { topics: t.topics || [], languages: t.languages || [], countries: t.countries || [] },
      budget: { total: pi(c.budget_total), dailyCap: pi(c.daily_cap), bidCpm: pi(c.bid_cpm), spent: pi(spent), remaining: pi(Math.max(0, (funded || Number(c.budget_total)) - spent)), funded: funded > 0, fundedAmount: pi(funded), currency: "PI" },
      freqCap: { impressions: Number(c.freq_impressions), perHours: Number(c.freq_hours) },
      startAt: iso(c.start_at), endAt: iso(c.end_at), reviewNote: c.review_note || null,
      review: lastReview ? { decision: lastReview.decision, reasons: parseJson(lastReview.reasons, []), note: lastReview.note || null, at: iso(lastReview.at), automated: lastReview.reviewer === "automod" } : null,
      piEnabled: piOn(), ...(piOn() ? {} : { fundNote: OFF }), actions: actionsOf(c), label: LABEL,
      submittedAt: iso(c.submitted_at), completedAt: iso(c.completed_at), createdAt: iso(c.created_at), updatedAt: iso(c.updated_at)
    };
    if (full) {
      out.stats = await stats(c);
      if (c.intent_id && !funded && viewer?.id === c.advertiser_id) {
        const tx = await db.get("SELECT id, amount, memo, status FROM pi_transactions WHERE id=$1", [c.intent_id]).catch(() => null);
        if (tx && ["created", "approved"].includes(tx.status)) out.intent = { id: tx.id, amount: Number(tx.amount), memo: tx.memo, metadata: { intentId: tx.id } };
      }
    }
    return out;
  }
  const getCampaign = (cid) => db.get("SELECT * FROM ad_campaigns WHERE id=$1", [String(cid || "").slice(0, 100)]);
  async function own(user, cid) {
    const c = await getCampaign(cid);
    if (!c || (c.advertiser_id !== user.id && !isStaff(user)) || (c.status === "removed" && !isStaff(user))) throw E.nf("الحملة غير موجودة");
    return c;
  }
  async function setStatus(t, c, to, from, extra = {}) {
    const keys = Object.keys(extra);
    const args = [to, nowIso(), c.id, ...from, ...keys.map((k) => extra[k])];
    const r = await t.run(`UPDATE ad_campaigns SET status=$1, updated_at=$2${keys.map((k, i) => `, ${k}=$${4 + from.length + i}`).join("")} WHERE id=$3 AND status IN (${inList(from, 4)})`, args);
    return r.changes ? t.get("SELECT * FROM ad_campaigns WHERE id=$1", [c.id]) : null;
  }
  const badState = (msg = "لا يمكن تنفيذ هذا الإجراء في حالة الحملة الحالية") => fail(409, "invalid_state", msg);

  /* ======================= advertiser ======================= */
  async function create(user, b) {
    if (await isMinor(user.id)) throw minorRestricted();
    if (!rl.hit("post", "ads:" + user.id)) throw E.rate();
    const v = await validateCampaign(user, b);
    const cid = id("ac"), at = nowIso();
    await db.run(`INSERT INTO ad_campaigns(id,advertiser_id,post_id,name,objective,targeting,budget_total,daily_cap,bid_cpm,freq_impressions,freq_hours,start_at,end_at,status,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$14)`,
    [cid, user.id, v.post_id, v.name, v.objective, v.targeting, v.budget_total, v.daily_cap, v.bid_cpm, v.freq_impressions, v.freq_hours, v.start_at, v.end_at, at]);
    audit("ad_campaign_created", cid, null, user.id);
    return { campaign: await campaignClient(await getCampaign(cid), user, true) };
  }
  const LIMITED = ["name", "daily_cap", "end_at", "freq_impressions", "freq_hours"]; // editable after approval without a new review
  async function update(user, cid, b) {
    if (await isMinor(user.id)) throw minorRestricted();
    const c = await own(user, cid);
    if (c.advertiser_id !== user.id) throw E.forbid("ليست حملتك");
    if (!["draft", "rejected", "awaiting_funds", "active", "paused"].includes(c.status)) throw badState();
    const v = await validateCampaign(user, b, c);
    if (Number(c.funded_amount) && v.budget_total !== undefined && v.budget_total !== Number(c.budget_total)) throw badState("لا يمكن تغيير ميزانية حملة مموّلة");
    if (!["draft", "rejected"].includes(c.status)) {
      if (v.start_at === c.start_at || iso(c.start_at) === v.start_at) delete v.start_at;
      const bad = Object.keys(v).filter((k) => !LIMITED.includes(k) && !(k === "budget_total" && v.budget_total === Number(c.budget_total)));
      if (bad.length) throw badState("بعد الموافقة يمكن تعديل الاسم والسقف اليومي وتاريخ الانتهاء وحد التكرار فقط");
    }
    const keys = Object.keys(v);
    if (keys.length) await db.run(`UPDATE ad_campaigns SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => v[k]), nowIso(), c.id]);
    return { campaign: await campaignClient(await getCampaign(c.id), user, true) };
  }
  async function submit(user, cid) {
    if (await isMinor(user.id)) throw minorRestricted();
    const c = await own(user, cid);
    if (c.advertiser_id !== user.id) throw E.forbid("ليست حملتك");
    if (!["draft", "rejected"].includes(c.status)) throw badState();
    const p = await validatePost(user, c.post_id); // the post may have changed since the draft
    const text = `${c.name} ${p.title || ""} ${p.text || ""}`;
    let verdict = null;
    if (Classifier.spam(text)) verdict = { action: "reject", reasons: ["spam"] };
    const am = ctx.services.automod;
    if (!verdict && am?.assess && env.AUTOMOD_ENABLED !== "0") {
      const v = await am.assess({ text, doc: parseJson(p.data, {})?.doc || null, author: user.id }).catch(() => null);
      if (v && (v.action === "hold" || v.action === "escalate")) verdict = { action: "reject", reasons: v.reasons || ["guidelines"], explanations: (v.explanations || []).map((x) => x.label || String(x)) };
      else if (v) verdict = { action: v.action || "allow", reasons: v.reasons || [] };
    }
    const at = nowIso();
    if (verdict?.action === "reject") {
      const note = "رُفض تلقائياً: قد يخالف الإعلان إرشادات المجتمع" + (verdict.explanations?.length ? " (" + verdict.explanations.join("، ") + ")" : "");
      await db.tx(async (t) => {
        await t.run("INSERT INTO ad_reviews(id,campaign_id,reviewer,decision,reasons,note,at) VALUES($1,$2,'automod','reject',$3,$4,$5)", [id("ar"), c.id, JSON.stringify(verdict.reasons), note, at]);
        await setStatus(t, c, "rejected", ["draft", "rejected"], { review_note: note, automod: JSON.stringify(verdict), submitted_at: at });
      });
      audit("AD_REJECTED_AUTOMOD", c.id, verdict.reasons.join(","), "system");
      await notify(user.id, "ad_rejected", { ref: c.id });
      throw new HttpError(422, note, "ad_rejected");
    }
    const n = await setStatus(db, c, "in_review", ["draft", "rejected"], { submitted_at: at, review_note: null, automod: verdict ? JSON.stringify(verdict) : null });
    if (!n) throw badState();
    bus.emit("AD_SUBMITTED", { campaign: c.id, actor: user.id });
    return { campaign: await campaignClient(n, user, true) };
  }
  async function pause(user, cid) {
    const c = await own(user, cid);
    if (c.advertiser_id !== user.id && !isStaff(user)) throw E.forbid();
    const n = await setStatus(db, c, "paused", ["active"]);
    if (!n) throw badState();
    await flushCharges(c.id);
    return { campaign: await campaignClient(n, user, true) };
  }
  async function resume(user, cid) {
    if (await isMinor(user.id)) throw minorRestricted();
    const c = await own(user, cid);
    if (c.advertiser_id !== user.id) throw E.forbid();
    if (c.status !== "paused") throw badState();
    if (ms(c.end_at) <= clock().getTime() || Number(c.spent) >= Number(c.funded_amount)) { await complete(c, "resume_after_end"); throw badState("انتهت الحملة"); }
    const n = await setStatus(db, c, "active", ["paused"]);
    if (!n) throw badState();
    return { campaign: await campaignClient(n, user, true) };
  }
  async function remove(user, cid) {
    const c = await own(user, cid);
    if (c.advertiser_id !== user.id && !isStaff(user)) throw E.forbid();
    if (c.status === "removed") return { ok: true, campaign: { id: c.id, status: "removed" } };
    await setStatus(db, c, "removed", STATUSES.filter((s) => s !== "removed"));
    await flushCharges(c.id);
    if (c.intent_id && !Number(c.funded_amount)) await piSvc()?.cancel?.(user, { intentId: c.intent_id }).catch(() => null);
    audit("ad_campaign_removed", c.id, null, user.id);
    return { ok: true, campaign: { id: c.id, status: "removed" } };
  }
  async function fund(user, cid) {
    if (await isMinor(user.id)) throw minorRestricted();
    const c = await own(user, cid);
    if (c.advertiser_id !== user.id) throw E.forbid();
    if (Number(c.funded_amount) || !["draft", "in_review", "awaiting_funds"].includes(c.status)) throw badState("الحملة مموّلة أو لا تقبل التمويل الآن");
    if (!piOn()) throw fail(409, "not_configured", OFF);
    if (c.intent_id) { // reuse an intent the user has not finished paying
      const tx = await db.get("SELECT id, amount, memo, status FROM pi_transactions WHERE id=$1", [c.intent_id]).catch(() => null);
      if (tx && ["created", "approved"].includes(tx.status)) return { campaign: await campaignClient(c, user, true), intent: { id: tx.id, amount: Number(tx.amount), memo: tx.memo, metadata: { intentId: tx.id } } };
    }
    const it = await piSvc().createIntent(user, { amount: pi(c.budget_total), memo: `إعلان: ${c.name}`.slice(0, 200), purpose: "ads", refId: c.id });
    await db.run("UPDATE ad_campaigns SET intent_id=$1, updated_at=$2 WHERE id=$3", [it.id, nowIso(), c.id]);
    return { campaign: await campaignClient(await getCampaign(c.id), user, true), intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata } };
  }
  async function list(user, q) {
    const st = q.status && STATUSES.includes(q.status) ? q.status : null;
    const rows = await db.all(`SELECT * FROM ad_campaigns WHERE advertiser_id=$1 AND status<>'removed'${st ? " AND status=$2" : ""} ORDER BY created_at DESC, id DESC LIMIT 200`, st ? [user.id, st] : [user.id]);
    const items = [];
    for (const r of rows) {
      const c = await campaignClient(r, user, false);
      const t = await db.get("SELECT COALESCE(SUM(impressions),0) AS i, COALESCE(SUM(clicks),0) AS c FROM ad_stats_daily WHERE campaign_id=$1", [r.id]);
      items.push({ ...c, totals: statsRow(null, t.i, t.c, r.spent) });
    }
    return { items, piEnabled: piOn(), ...(piOn() ? {} : { piNote: OFF }) };
  }
  async function estimate(user, b) {
    const t = validateTargeting(b?.targeting ?? b);
    const minors = ctx.services.minors;
    const where = ["u.status='active'"], args = [];
    if (t.languages.length) { where.push(`u.lang IN (${inList(t.languages, args.length + 1)})`); args.push(...t.languages); }
    if (t.countries.length) { where.push(`u.country IN (${inList(t.countries, args.length + 1)})`); args.push(...t.countries); }
    if (t.topics.length || t.countries.length) where.push("NOT EXISTS (SELECT 1 FROM ad_prefs ap WHERE ap.user_id=u.id AND ap.personalized=0)");
    let rows = await db.all(`SELECT u.id, u.prefs FROM users u WHERE ${where.join(" AND ")} LIMIT 200000`, args).catch(async () => {
      // `country` arrives with the identity migration; fall back without it
      return db.all("SELECT u.id, u.prefs FROM users u WHERE u.status='active' LIMIT 200000");
    });
    if (t.topics.length) {
      const tf = new Set((await db.all(`SELECT DISTINCT user_id FROM topic_follows WHERE kind='topic' AND ref IN (${inList(t.topics)})`, t.topics)).map((r) => r.user_id));
      rows = rows.filter((r) => tf.has(r.id) || (parseJson(r.prefs, {})?.interests || []).some((x) => t.topics.includes(x)));
    }
    let ids = rows.map((r) => r.id).filter((x) => x !== user.id);
    if (minors?.minorIds && ids.length) { const m = await minors.minorIds(ids); ids = ids.filter((x) => !m.has(x)); }
    return { audience: audienceBucket(ids.length, cfg.kAnon), kAnon: cfg.kAnon, targeting: t };
  }

  /* ======================= review ======================= */
  async function reviewQueue(q) {
    const st = q.status === "all" ? null : q.status && STATUSES.includes(q.status) ? q.status : "in_review";
    const rows = await db.all(`SELECT * FROM ad_campaigns${st ? " WHERE status=$1" : ""} ORDER BY COALESCE(submitted_at, created_at) ASC LIMIT 200`, st ? [st] : []);
    const items = [];
    for (const r of rows) {
      const a = await db.get("SELECT id, handle, name, avatar FROM users WHERE id=$1", [r.advertiser_id]);
      items.push({ ...(await campaignClient(r, null, false)), advertiser: a ? { id: a.id, handle: a.handle, name: a.name, avatar: a.avatar || null } : null, automod: parseJson(r.automod, null) });
    }
    return { status: st || "all", items, reasons: Object.entries(REJECT_REASONS).map(([code, label]) => ({ code, label })) };
  }
  async function decide(staff, cid, b) {
    const c = await getCampaign(cid);
    if (!c) throw E.nf("الحملة غير موجودة");
    const decision = b?.decision;
    if (!["approve", "reject"].includes(decision)) throw fail(400, "review_invalid", "القرار: approve أو reject");
    const reasons = Array.isArray(b.reasons) ? [...new Set(b.reasons.map((x) => (x === "rights" ? "guidelines" : x)).filter((x) => REJECT_REASONS[x]))] : []; // "rights" = tolerant alias
    if (decision === "reject" && !reasons.length) throw fail(400, "review_invalid", "اختر سبب الرفض");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) || null : null;
    if (c.status !== "in_review") throw badState("الحملة ليست قيد المراجعة");
    const at = nowIso();
    const n = await db.tx(async (t) => {
      const to = decision === "reject" ? "rejected" : Number(c.funded_amount) > 0 ? "active" : "awaiting_funds";
      const x = await setStatus(t, c, to, ["in_review"], { review_note: decision === "reject" ? note || reasons.map((r) => REJECT_REASONS[r]).join("، ") : note });
      if (!x) return null;
      await t.run("INSERT INTO ad_reviews(id,campaign_id,reviewer,decision,reasons,note,at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id("ar"), c.id, staff.id, decision, JSON.stringify(reasons), note, at]);
      return x;
    });
    if (!n) throw badState();
    audit(decision === "approve" ? "AD_APPROVED" : "AD_REJECTED", c.id, reasons.join(",") || null, staff.id);
    await notify(c.advertiser_id, decision === "approve" ? "ad_approved" : "ad_rejected", { actor: null, ref: c.id });
    return { campaign: await campaignClient(n, staff, true) };
  }

  /* ======================= money ======================= */
  /** journal accrued spend: ads:budget:<cid> → platform:ads (idempotent: ikey carries the cumulative spend) */
  async function flushCharges(cid) {
    return db.tx(async (t) => {
      const c = await t.get("SELECT id, advertiser_id, spent, charged FROM ad_campaigns WHERE id=$1", [cid]);
      if (!c) return 0;
      const spent = Number(c.spent), charged = Number(c.charged), delta = spent - charged;
      if (delta <= 0) return 0;
      const r = await t.run("UPDATE ad_campaigns SET charged=$1 WHERE id=$2 AND charged=$3", [spent, cid, charged]);
      if (!r.changes) return 0;
      await postJournal(t, { ikey: `ads:${cid}:charge:${spent}`, kind: "ads_charge", source: "ads", refId: cid, senderId: c.advertiser_id,
        lines: [{ account: BUDGET(cid), debit: delta }, { account: PLATFORM, credit: delta }] });
      return delta;
    });
  }
  async function complete(c, why) {
    const n = await setStatus(db, c, "completed", ["active", "paused", "awaiting_funds"], { completed_at: nowIso() });
    await flushCharges(c.id);
    if (n) { await notify(c.advertiser_id, "ad_completed", { ref: c.id }); bus.emit("AD_COMPLETED", { campaign: c.id, reason: why }); }
    return n;
  }
  async function onFunded(e) {
    const c = await db.get("SELECT * FROM ad_campaigns WHERE intent_id=$1", [e.tx]) || (e.refId ? await getCampaign(e.refId) : null);
    if (!c) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(c.budget_total)) > 1) { logger.warn?.("ads amount mismatch; campaign not funded", { campaign: c.id }); return; }
    const n = await db.tx(async (t) => {
      const r = await t.run("UPDATE ad_campaigns SET funded_amount=budget_total, funded_at=$1, intent_id=$2, updated_at=$1 WHERE id=$3 AND funded_amount=0", [nowIso(), e.tx, c.id]);
      if (!r.changes) return null;
      await postJournal(t, { ikey: `ads:${c.id}:fund`, kind: "ads_fund", source: "ads", refId: c.id, senderId: c.advertiser_id, piTx: e.tx,
        lines: [{ account: ACC.out(c.advertiser_id), userId: c.advertiser_id, debit: Number(c.budget_total) }, { account: BUDGET(c.id), credit: Number(c.budget_total) }] });
      await t.run("UPDATE ad_campaigns SET status='active', updated_at=$1 WHERE id=$2 AND status='awaiting_funds'", [nowIso(), c.id]);
      return t.get("SELECT * FROM ad_campaigns WHERE id=$1", [c.id]);
    });
    if (n) bus.emit("AD_FUNDED", { campaign: c.id, actor: c.advertiser_id, amount: pi(c.budget_total) });
  }
  /** staff refunded the Pi payment directly: stop the campaign and give the unspent budget back in the ledger */
  async function onRefunded(e) {
    const c = await db.get("SELECT * FROM ad_campaigns WHERE intent_id=$1", [e.tx]);
    if (!c || !Number(c.funded_amount)) return;
    if (!["completed", "removed"].includes(c.status)) await setStatus(db, c, "removed", STATUSES.filter((s) => !["completed", "removed"].includes(s)), { review_note: "أُعيد المبلغ" });
    await db.run("UPDATE ad_campaigns SET status='removed' WHERE id=$1 AND status IN ('active','paused')", [c.id]); // stop delivery even under a race
    await flushCharges(c.id);
    await db.tx(async (t) => {
      const x = await t.get("SELECT funded_amount, spent FROM ad_campaigns WHERE id=$1", [c.id]);
      const left = Number(x.funded_amount) - Number(x.spent);
      if (left > 0) await postJournal(t, { ikey: `ads:${c.id}:refund`, kind: "ads_refund", source: "ads", refId: c.id, senderId: c.advertiser_id, piTx: e.tx,
        lines: [{ account: BUDGET(c.id), debit: left }, { account: ACC.out(c.advertiser_id), userId: c.advertiser_id, credit: left }] });
    });
  }

  /* ======================= delivery ======================= */
  async function viewerContext(viewer) {
    if (!viewer) return null;
    const p = await prefsRow(viewer.id);
    const u = await db.get("SELECT * FROM users WHERE id=$1", [viewer.id]);
    const topics = new Set((await db.all("SELECT ref FROM topic_follows WHERE user_id=$1 AND kind='topic'", [viewer.id])).map((r) => r.ref));
    for (const x of parseJson(u?.prefs, {})?.interests || []) topics.add(x);
    return { personalized: p.personalized, topics, lang: u?.lang || null, country: u?.country || null, prefs: p, userPrefs: parseJson(u?.prefs, {}) };
  }
  async function blockedSet(uid) {
    const out = new Set();
    for (const r of await db.all("SELECT owner, target FROM user_blocks WHERE owner=$1 OR target=$1", [uid]).catch(() => [])) out.add(r.owner === uid ? r.target : r.owner);
    for (const r of await db.all("SELECT id, prefs FROM users WHERE prefs IS NOT NULL AND id IN (SELECT DISTINCT advertiser_id FROM ad_campaigns WHERE status='active')").catch(() => [])) if ((parseJson(r.prefs, {})?.blocked || []).includes(uid)) out.add(r.id);
    return out;
  }
  async function freqCounts(hashes) {
    const m = new Map();
    if (!hashes.length) return m;
    for (const r of await db.all(`SELECT hash, count, window_start FROM ad_freq WHERE hash IN (${inList(hashes)})`, hashes)) m.set(r.hash, r);
    return m;
  }
  /**
   * Pick up to `n` distinct campaigns for a viewer. Hard filters: minors (never), status/funding/dates/daily cap, targeting,
   * frequency cap, hidden ads/advertisers, blocks both ways, muted accounts, own campaigns, the post must still be visible.
   * @returns {Promise<Array<{c:any, post:any, reasons:any[], hash:string|null}>>}
   */
  async function pick(viewer, n, exclude = new Set()) {
    if (n <= 0) return [];
    if (viewer && (await isMinor(viewer.id))) return [];
    const at = nowIso(), day = dayOf();
    let rows = await db.all("SELECT * FROM ad_campaigns WHERE status='active' AND funded_amount > 0 AND spent < funded_amount AND start_at <= $1 AND end_at > $1 ORDER BY bid_cpm DESC, created_at ASC LIMIT 200", [at]);
    if (!rows.length) return [];
    const daily = new Map((await db.all(`SELECT campaign_id, spend FROM ad_stats_daily WHERE day=$1 AND campaign_id IN (${inList(rows.map((r) => r.id), 2)})`, [day, ...rows.map((r) => r.id)])).map((r) => [r.campaign_id, Number(r.spend)]));
    rows = rows.filter((r) => (daily.get(r.id) || 0) < Number(r.daily_cap) && !exclude.has(r.post_id));
    const v = await viewerContext(viewer);
    if (v) {
      const blocked = await blockedSet(viewer.id);
      for (const b of v.userPrefs.blocked || []) blocked.add(b);
      const muted = new Set(v.userPrefs.muted?.users || []);
      const hiddenA = new Set(v.prefs.hiddenAdvertisers), hiddenC = new Set(v.prefs.hiddenAds);
      rows = rows.filter((r) => r.advertiser_id !== viewer.id && !blocked.has(r.advertiser_id) && !muted.has(r.advertiser_id) && !hiddenA.has(r.advertiser_id) && !hiddenC.has(r.id));
    }
    const matched = rows.map((r) => ({ c: r, reasons: matchTargeting(parseJson(r.targeting, {}), v) })).filter((x) => x.reasons);
    if (!matched.length) return [];
    const hashes = new Map();
    if (viewer) {
      for (const x of matched) hashes.set(x.c.id, await viewerHash(viewer.id, x.c.id, day));
      const fc = await freqCounts([...hashes.values()]);
      const t0 = clock().getTime();
      for (const x of matched) {
        const f = fc.get(hashes.get(x.c.id));
        x.freqOk = !f || ms(f.window_start) + Number(x.c.freq_hours) * HOUR <= t0 || Number(f.count) < Number(x.c.freq_impressions);
      }
    }
    const pool = matched.filter((x) => x.freqOk !== false);
    if (!pool.length) return [];
    const posts = await db.all(`SELECT * FROM posts WHERE id IN (${inList(pool.map((x) => x.c.post_id))})`, pool.map((x) => x.c.post_id));
    const okAuthors = new Set((await db.all(`SELECT id FROM users WHERE status='active' AND id IN (${inList(pool.map((x) => x.c.advertiser_id))})`, pool.map((x) => x.c.advertiser_id))).map((r) => r.id));
    const visible = new Map((await content().filterVisible(posts.filter((p) => p.status === "published" && p.visibility === "public" && !p.community), viewer?.id || null)).map((p) => [p.id, p]));
    const out = [], seenPosts = new Set();
    for (const x of pool) {
      const p = visible.get(x.c.post_id);
      if (!p || !okAuthors.has(x.c.advertiser_id) || seenPosts.has(p.id)) continue;
      seenPosts.add(p.id);
      out.push({ c: x.c, post: p, reasons: x.reasons, hash: viewer ? hashes.get(x.c.id) : null });
      if (out.length >= n) break;
    }
    return out;
  }
  async function itemFor(viewer, x) {
    const adv = await db.get("SELECT id, handle, name, avatar FROM users WHERE id=$1", [x.c.advertiser_id]);
    const day = dayOf();
    const token = await signToken({ c: x.c.id, h: x.hash || "anon", d: day, n: crypto.randomBytes(9).toString("base64url"), e: clock().getTime() + DAY });
    return { ...content().toClient(x.post, viewer?.id || null), why: undefined,
      promoted: { campaignId: x.c.id, label: LABEL, advertiser: adv ? { id: adv.id, handle: adv.handle, name: adv.name, avatar: adv.avatar || null } : null, objective: x.c.objective, token } };
  }
  /** feed insertion (called by services/ranking.js): ≤ 1 ad per cfg.interval organic posts, never the first slot */
  async function inject(viewer, posts, { mode = "for", cursor = 0 } = {}) {
    if (env.ADS_ENABLED === "0" || !FEED_MODES.includes(String(mode).split(":")[0])) return posts;
    const slots = slotsFor(Number(cursor) || 0, posts.length, cfg.interval);
    if (!slots.length) return posts;
    let picks;
    try { picks = await pick(viewer, slots.length, new Set(posts.map((p) => p.id))); } catch (e) { logger.warn?.("ads pick failed", { err: e.message }); return posts; }
    if (!picks.length) return posts;
    const items = [];
    for (const x of picks) items.push(await itemFor(viewer, x));
    const out = [];
    posts.forEach((p, i) => { out.push(p); const k = slots.indexOf(i); if (k >= 0 && items[k]) out.push(items[k]); });
    return out;
  }

  /* ======================= events ======================= */
  async function recordEvent(req, b) {
    const cid = typeof b?.campaignId === "string" ? b.campaignId.slice(0, 100) : "";
    const type = b?.type;
    if (!cid || !["impression", "click"].includes(type)) throw fail(400, "event_invalid", "حدث غير صالح");
    if (!rl.hit("default", "ads_ev:" + (req.user?.id || req.ip || "anon"))) throw E.rate();
    const tk = await readToken(b.token);
    if (!tk || tk.c !== cid || !(tk.e > clock().getTime())) throw fail(400, "token_invalid", "رمز الإعلان غير صالح أو منتهٍ");
    if (req.user) { if (tk.h !== (await viewerHash(req.user.id, cid, tk.d))) throw fail(400, "token_invalid", "رمز الإعلان لا يخص هذا الحساب"); }
    else if (tk.h !== "anon") throw fail(400, "token_invalid", "رمز الإعلان غير صالح");
    const used = crypto.createHash("sha256").update(tk.n + ":" + type).digest("hex").slice(0, 40);
    const ins = await db.run("INSERT INTO ad_tokens(hash,campaign_id,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [used, cid, new Date(clock().getTime() + cfg.retentionMs).toISOString()]);
    if (!ins.changes) return { ok: true, counted: false };
    const day = dayOf(), at = nowIso();
    if (type === "click") {
      const c = await getCampaign(cid);
      if (!c || !["active", "paused", "completed"].includes(c.status)) return { ok: true, counted: false };
      await db.run("INSERT INTO ad_stats_daily(campaign_id,day,impressions,clicks,spend) VALUES($1,$2,0,1,0) ON CONFLICT (campaign_id, day) DO UPDATE SET clicks=ad_stats_daily.clicks+1", [cid, day]);
      return { ok: true, counted: true };
    }
    const res = await db.tx(async (t) => {
      const c = await t.get("SELECT * FROM ad_campaigns WHERE id=$1", [cid]);
      if (!c || c.status !== "active") return null;
      const per = Math.max(1, Math.round(Number(c.bid_cpm) / 1000));
      const charge = Math.min(per, Number(c.funded_amount) - Number(c.spent));
      if (charge <= 0) return { c, charge: 0 };
      const r = await t.run("UPDATE ad_campaigns SET spent=spent+$1 WHERE id=$2 AND status='active' AND spent+$1 <= funded_amount", [charge, cid]);
      if (!r.changes) return null;
      await t.run("INSERT INTO ad_stats_daily(campaign_id,day,impressions,clicks,spend) VALUES($1,$2,1,0,$3) ON CONFLICT (campaign_id, day) DO UPDATE SET impressions=ad_stats_daily.impressions+1, spend=ad_stats_daily.spend+$3", [cid, day, charge]);
      if (tk.h !== "anon") {
        const f = await t.get("SELECT count, window_start FROM ad_freq WHERE hash=$1", [tk.h]);
        const exp = new Date(clock().getTime() + cfg.retentionMs).toISOString();
        if (!f) await t.run("INSERT INTO ad_freq(hash,campaign_id,count,window_start,expires_at) VALUES($1,$2,1,$3,$4) ON CONFLICT (hash) DO UPDATE SET count=ad_freq.count+1, expires_at=$4", [tk.h, cid, at, exp]);
        else if (ms(f.window_start) + Number(c.freq_hours) * HOUR <= clock().getTime()) await t.run("UPDATE ad_freq SET count=1, window_start=$1, expires_at=$2 WHERE hash=$3", [at, exp, tk.h]);
        else await t.run("UPDATE ad_freq SET count=count+1, expires_at=$1 WHERE hash=$2", [exp, tk.h]);
      }
      return { c: await t.get("SELECT * FROM ad_campaigns WHERE id=$1", [cid]), charge };
    });
    if (!res) return { ok: true, counted: false };
    await afterSpend(res.c);
    return { ok: true, counted: true };
  }
  async function afterSpend(c) {
    const funded = Number(c.funded_amount), spent = Number(c.spent);
    if (!funded) return;
    const minLeft = Math.max(1, Math.round(Number(c.bid_cpm) / 1000));
    if (funded - spent < minLeft) { await complete(c, "budget"); return; }
    if (!Number(c.low_notified) && spent * 100 >= funded * cfg.lowPct) {
      const r = await db.run("UPDATE ad_campaigns SET low_notified=1 WHERE id=$1 AND low_notified=0", [c.id]);
      if (r.changes) await notify(c.advertiser_id, "ad_budget_low", { ref: c.id });
    }
  }

  /* ======================= why / hide ======================= */
  async function why(viewer, cid) {
    const c = await getCampaign(cid);
    if (!c || c.status === "removed") throw E.nf("الإعلان غير موجود");
    const v = await viewerContext(viewer);
    const reasons = (matchTargeting(parseJson(c.targeting, {}), v) || [{ type: "general" }]).map((r) => r.type === "topic" ? { ...r, name: TOPICS.find((x) => x.slug === r.topic)?.name || r.topic } : r);
    const adv = await db.get("SELECT id, handle, name, avatar FROM users WHERE id=$1", [c.advertiser_id]);
    return {
      campaignId: c.id, label: LABEL, advertiser: adv ? { id: adv.id, handle: adv.handle, name: adv.name, avatar: adv.avatar || null } : null, reasons, personalized: v ? v.personalized : false,
      notUsed: ["الرسائل الخاصة", "المنشورات الخاصة", "التصفح خارج المواضيع التي تتابعها", "التتبع عبر المواقع", "الموقع الجغرافي من عنوان IP", "الفئات الحساسة"],
      controls: [
        { action: "hide_ad", label: "إخفاء الإعلان", method: "POST", path: "/api/ads/hide", body: { campaignId: c.id, scope: "ad" } },
        { action: "hide_advertiser", label: "إخفاء هذا المعلن", method: "POST", path: "/api/ads/hide", body: { campaignId: c.id, scope: "advertiser" } },
        { action: "prefs", label: "إعدادات الإعلانات", href: "/#/settings/ads" }
      ]
    };
  }
  async function hide(user, b) {
    const c = await getCampaign(b?.campaignId);
    if (!c) throw E.nf("الإعلان غير موجود");
    const scope = b.scope === "advertiser" ? "advertiser" : b.scope === "ad" || b.scope === undefined ? "ad" : null;
    if (!scope) throw E.bad("النطاق: ad أو advertiser");
    const rs = b.reason === "not_interested" ? "irrelevant" : b.reason; // tolerant alias (early client)
    const reason = HIDE_REASONS.includes(rs) ? rs : "other";
    const p = await prefsRow(user.id);
    if (scope === "ad" && !p.hiddenAds.includes(c.id)) p.hiddenAds.push(c.id);
    if (scope === "advertiser" && !p.hiddenAdvertisers.includes(c.advertiser_id)) p.hiddenAdvertisers.push(c.advertiser_id);
    await savePrefsRow(user.id, p);
    await db.run("INSERT INTO ad_feedback(campaign_id,reason,day,count) VALUES($1,$2,$3,1) ON CONFLICT (campaign_id, reason, day) DO UPDATE SET count=ad_feedback.count+1", [c.id, reason, dayOf()]);
    return { ok: true, scope, campaignId: c.id };
  }

  /* ======================= jobs ======================= */
  /** purge expired frequency/token rows and old salts, complete ended campaigns, journal accrued spend */
  async function maintain() {
    const at = nowIso(), t0 = clock().getTime();
    const purged = { freq: (await db.run("DELETE FROM ad_freq WHERE expires_at < $1", [at])).changes, tokens: (await db.run("DELETE FROM ad_tokens WHERE expires_at < $1", [at])).changes,
      salts: (await db.run("DELETE FROM ad_meta WHERE key LIKE 'salt:%' AND key < $1", ["salt:" + dayOf(new Date(t0 - DAY))])).changes };
    for (const k of [...salts.keys()]) if (k < dayOf(new Date(t0 - DAY))) salts.delete(k);
    let completed = 0;
    for (const c of await db.all("SELECT * FROM ad_campaigns WHERE status IN ('active','paused','awaiting_funds') AND (end_at <= $1 OR (funded_amount > 0 AND spent >= funded_amount))", [at])) if (await complete(c, "ended")) completed++;
    let charged = 0;
    for (const c of await db.all("SELECT id FROM ad_campaigns WHERE spent > charged")) charged += await flushCharges(c.id);
    return { purged, completed, charged: pi(charged) };
  }
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.ADS_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("ads.maintain", +(env.ADS_JOB_INTERVAL_MS || 10 * 60e3), maintain);

  /* ======================= bus ======================= */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("ads handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => { if (e.purpose === "ads") await onFunded(e); }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "ads") await db.run("UPDATE ad_campaigns SET intent_id=NULL WHERE intent_id=$1 AND funded_amount=0", [e.tx]); }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => { if (e.purpose === "ads") await onRefunded(e); }));
  bus.on("USER_ANONYMISED", track(async (e) => {
    if (!e?.user) return;
    for (const c of await db.all("SELECT * FROM ad_campaigns WHERE advertiser_id=$1", [e.user])) {
      await db.run("UPDATE ad_campaigns SET status='removed', name='حملة محذوفة', targeting='{}', review_note=NULL, automod=NULL, updated_at=$2 WHERE id=$1", [c.id, nowIso()]);
      await flushCharges(c.id);
    }
  }));

  /* ======================= routes ======================= */
  const staff = (fn) => A(async (req, res) => { if (!isStaff(req.user)) throw E.forbid("للإدارة والمشرفين فقط"); return fn(req, res); });
  R.get("/api/ads/config", async () => ({ enabled: env.ADS_ENABLED !== "0", piEnabled: piOn(), ...(piOn() ? {} : { piNote: OFF }), label: LABEL, currency: "PI", objectives: OBJECTIVES, feedInterval: cfg.interval, kAnon: cfg.kAnon,
    minBudget: pi(cfg.minBudget), maxBudget: pi(cfg.maxBudget), minCpm: pi(cfg.minCpm), maxCpm: pi(cfg.maxCpm), defaultCpm: pi(cfg.defaultCpm), maxDays: cfg.maxDays,
    freqCap: { impressions: 3, perHours: 24, maxImpressions: 20, maxHours: 24 }, hideReasons: HIDE_REASONS, rejectReasons: Object.entries(REJECT_REASONS).map(([code, label]) => ({ code, label })) }));
  R.get("/api/ads/topics", async () => ({ topics: TOPICS.filter((t) => !isSensitive(t.slug)).map((t) => ({ slug: t.slug, name: t.name })), sensitiveNote: "لا يمكن الاستهداف حسب الصحة أو الدين أو السياسة أو الميول أو العرق" }));
  R.post("/api/ads/estimate", A(async (req) => { if (await isMinor(req.user.id)) throw minorRestricted(); return estimate(req.user, req.body || {}); }));
  R.post("/api/ads/campaigns", A(async (req) => create(req.user, req.body)));
  R.get("/api/ads/campaigns", A(async (req) => list(req.user, req.query || {})));
  R.get("/api/ads/campaigns/:id", A(async (req) => ({ campaign: await campaignClient(await own(req.user, req.params.id), req.user, true) })));
  R.patch("/api/ads/campaigns/:id", A(async (req) => update(req.user, req.params.id, req.body)));
  R.del("/api/ads/campaigns/:id", A(async (req) => remove(req.user, req.params.id)));
  R.post("/api/ads/campaigns/:id/submit", A(async (req) => submit(req.user, req.params.id)));
  R.post("/api/ads/campaigns/:id/pause", A(async (req) => pause(req.user, req.params.id)));
  R.post("/api/ads/campaigns/:id/resume", A(async (req) => resume(req.user, req.params.id)));
  R.post("/api/ads/campaigns/:id/fund", A(async (req) => fund(req.user, req.params.id)));
  R.post("/api/ads/events", async (req) => recordEvent(req, req.body || {}));
  R.get("/api/ads/why/:campaignId", async (req) => why(req.user || null, req.params.campaignId));
  R.post("/api/ads/hide", A(async (req) => hide(req.user, req.body || {})));
  R.get("/api/me/ads/prefs", A(async (req) => prefsClient(req.user.id)));
  R.put("/api/me/ads/prefs", A(async (req) => putPrefs(req.user, req.body)));
  R.get("/api/admin/ads/review", staff(async (req) => reviewQueue(req.query || {})));
  R.post("/api/admin/ads/review/:id", staff(async (req) => decide(req.user, req.params.id, req.body || {})));

  return { config: cfg, inject, pick, maintain, flushCharges, settle, viewerHash, matchTargeting, stats };
};
Object.assign(module.exports, { matchTargeting, audienceBucket, slotsFor, isSensitive, SENSITIVE, STATUSES });
