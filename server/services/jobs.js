/* Jobs & freelance board «الوظائف والعمل الحر» (phase 77). Pay is stated in π; paying for work happens through phase 78 contracts.
 *  1. Postings: a job (full / part time, contract, internship) or a freelance project; title, description, category, skills,
 *     onsite / remote / hybrid + city, pay range in π (fixed / hourly / monthly) or unpaid, application deadline, up to 3
 *     screening questions. Posters pause, resume, close, mark filled, edit (re-checked).
 *  2. Search: Arabic-normalised text, filters (kind, category, mode, city, minimum pay, skill), sort newest / highest pay;
 *     featured postings first (a Pi-paid boost); saved postings; expired deadlines stop applications.
 *  3. Apply with the professional profile (phase 76): cover letter, answers, a bid (π + days) for freelance projects. The
 *     employer sees the applicant's full professional profile for this application only (the applicant is told so).
 *  4. Employer pipeline: submitted → viewed (automatic) → shortlisted → interview → offered → hired, or rejected; private
 *     note; a timeline with messages both sides see; applicants withdraw. Notifications on every step.
 *  5. Anti-scam: postings from new accounts or with risk signals (fees / deposits from applicants, payment outside the
 *     platform, messaging-app links, recovery phrase requests, «guaranteed income», contact details in the text, implausible
 *     pay, the phase 31 fraud classifier) wait for staff review with the reasons; risky application messages carry a warning
 *     to the recipient; reports (JOBS_FLAG_REPORTS = 3 open) pause the posting until staff decide; caps on open postings.
 *  6. Pi: «تمييز الإعلان» (featured for 7 / 14 / 30 days) is paid in π through the ledger (purpose `jobs`, revenue to
 *     platform:fees). While Pi payments are off (production) it answers 501 not_configured with an Arabic notice.
 *  7. Minors (phase 35): may browse; cannot post, and may apply only to unpaid postings the poster marked suitable for minors. */
const { E, str, oneOf, id } = require("../lib/core");
const { normalize } = require("../lib/arabic");
const { toUnits, pi, ACC, createLedger } = require("../lib/ledger");

const KIND = { job: "وظيفة", freelance: "مشروع عمل حر" };
const CATS = { tech: "تقنية وبرمجة", design: "تصميم وإبداع", writing: "كتابة وترجمة", marketing: "تسويق ومبيعات", education: "تعليم وتدريب", business: "أعمال وإدارة", media: "صوت وفيديو", support: "خدمة عملاء", engineering: "هندسة", other: "أخرى" };
const MODES = { remote: "عن بُعد", onsite: "في الموقع", hybrid: "هجين" };
const EMPLOY = { full: "دوام كامل", part: "دوام جزئي", contract: "عقد مؤقت", internship: "تدريب" };
const PAY = { fixed: "مبلغ ثابت", hourly: "بالساعة", monthly: "شهرياً", none: "بدون أجر" };
const STATUS = { review: "قيد المراجعة", open: "مفتوح", paused: "متوقف مؤقتاً", closed: "مغلق", filled: "تم التوظيف", removed: "أُزيل" };
const APP = { submitted: "مُرسَل", viewed: "اطّلع عليه", shortlisted: "في القائمة المختصرة", interview: "مقابلة", offered: "عرض مقدّم", hired: "تم التعيين", rejected: "لم يُقبل", withdrawn: "مسحوب" };
const NEXT = { submitted: ["shortlisted", "interview", "offered", "rejected"], viewed: ["shortlisted", "interview", "offered", "rejected"], shortlisted: ["interview", "offered", "rejected"], interview: ["offered", "rejected", "shortlisted"], offered: ["hired", "rejected"], hired: [], rejected: ["shortlisted"], withdrawn: [] };
const REASONS = { scam: "احتيال", fee: "يطلب رسوماً للتقديم", fake: "إعلان وهمي", inappropriate: "محتوى غير لائق", discrimination: "تمييز", other: "سبب آخر" };
const PI_OFF = "مدفوعات Pi غير مفعّلة بعد — تمييز الإعلانات متوقف حتى تفعيلها. نشر الإعلانات والتقديم عليها متاح مجاناً.";
const BOOST_DAYS = [7, 14, 30];
/* anti-scam signals (normalised Arabic + English); each hit is a reason staff see */
const RISK = [
  ["fee", /رسوم (ال)?(تسجيل|تقديم|اشتراك|ملف)|ادفع[^.\n]{0,30}(لل)?تقديم|مبلغ (تامين|ضمان) مسترد|ايداع (مبلغ|مسبق)|registration fee|application fee|security deposit|pay (a |the )?fee/i, "يطلب رسوماً أو إيداعاً من المتقدّمين"],
  ["offplatform", /(واتس ?اب|واتساب|تيليجرام|تلغرام|تليجرام|whats ?app|telegram|t\.me\/|wa\.me\/|signal ?app)/i, "يوجّه للتواصل أو الدفع خارج المنصة"],
  ["phrase", /(عبار[هة] المرور|كلمات الاسترداد|العبار[هة] السري[هة]|passphrase|seed phrase|recovery phrase|private key|المفتاح الخاص)/i, "يطلب عبارة المرور أو مفاتيح المحفظة"],
  ["income", /(ربح|دخل|راتب) (مضمون|يومي ثابت)|اربح [^.\n]{0,20}(يوميا|في اليوم)|guaranteed (income|profit|salary)|earn \$?\d+ (a|per) day/i, "يعد بأرباح أو دخل مضمون"],
  ["contact", /(\+?\d[\d\s-]{8,}\d)|([\w.+-]+@[\w-]+\.[\w.]{2,})/, "يحتوي رقم هاتف أو بريداً للتواصل خارج المنصة"]
];

/** @param {any} ctx @param {{ now?: () => number, env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl, bus } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const today = () => iso().slice(0, 10);
  const ts = (v) => (v ? new Date(v).getTime() || 0 : 0);
  const FLAG_AT = +(env.JOBS_FLAG_REPORTS || 3), NEW_DAYS = +(env.JOBS_NEW_ACCOUNT_DAYS || 3), MAX_OPEN = +(env.JOBS_MAX_OPEN || 10), MAX_PI = +(env.JOBS_MAX_PI || 100000);
  const BOOST_PER_DAY = toUnits(+(env.JOBS_BOOST_PI_PER_DAY || 0.5));
  const { postJournal } = createLedger({ now: () => iso() });
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const piOn = () => !!ctx.services.pi?.enabled?.();
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : status === 404 ? E.nf(msg) : E.bad(msg), { code });
  const parse = (v, d) => { try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const n = async (sql, a = []) => Number((await db.get(sql, a))?.n || 0);
  const inflight = new Set(); const track = (fn) => (e) => { const p = Promise.resolve(fn(e)).catch((err) => ctx.log?.warn?.("jobs bus", { err: String(err) })).finally(() => inflight.delete(p)); inflight.add(p); return p; };

  async function blockedBetween(a, b) {
    if (!a || !b || a === b) return false;
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    const pa = parse(ua?.prefs, {}), pb = parse(ub?.prefs, {});
    if ((pa.blocked || []).includes(b) || (pb.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; const m = new Map(); if (!a.length) return m; for (const u of await db.all(`SELECT id, name, handle, color, avatar, verified, created_at FROM users WHERE id IN (${ph(a)})`, a)) m.set(u.id, u); return m; }
  const pubU = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: u.verified || null } : null);

  /* ---------- anti-scam ---------- */
  function risks(text, payMax) {
    const t = normalize(String(text || "")).toLowerCase(), raw = String(text || ""), out = [];
    for (const [key, re, label] of RISK) if (re.test(t) || re.test(raw)) out.push({ key, label });
    try { const c = require("../lib/ar-classify").classify(raw); if ((c.categories?.fraud || 0) >= 0.5 && !out.some((x) => x.key === "income")) out.push({ key: "fraud", label: "يشبه أساليب الاحتيال المعروفة" }); } catch { /* classifier optional */ }
    if (payMax && payMax > toUnits(MAX_PI)) out.push({ key: "pay", label: "أجر مرتفع بشكل غير معتاد" });
    return out;
  }

  /* ---------- validation ---------- */
  const amt = (v) => { if (v === undefined || v === null || v === "") return null; const x = Number(v); if (!Number.isFinite(x) || x < 0 || x > 10 * MAX_PI) throw fail(400, "bad_pay", "أجر غير صالح"); return toUnits(x); };
  function fields(b, prev) {
    const kind = prev ? prev.kind : oneOf(b.kind, Object.keys(KIND), null); if (!kind) throw E.bad("اختر النوع: وظيفة أو مشروع");
    const title = str(b.title ?? prev?.title, 120, { required: true, min: 6 });
    const body = String(b.body ?? prev?.body ?? "").replace(/\r\n?/g, "\n").trim(); if (body.length < 60) throw fail(400, "too_short", "صف العمل في ٦٠ حرفاً على الأقل"); if (body.length > 8000) throw E.bad("الوصف أطول من الحد");
    const category = oneOf(b.category ?? prev?.category, Object.keys(CATS), null); if (!category) throw E.bad("اختر التصنيف");
    const skIn = b.skills !== undefined ? b.skills : parse(prev?.skills, []);
    const skills = [...new Set((Array.isArray(skIn) ? skIn : String(skIn || "").split(/[,،\n]/)).map((s) => String(s).trim().slice(0, 40)).filter((s) => s.length >= 2))].slice(0, 10);
    const mode = oneOf(b.mode ?? prev?.mode, Object.keys(MODES), "remote");
    const city = str(b.city ?? prev?.city ?? undefined, 60), country = str(b.country ?? prev?.country ?? undefined, 60);
    if (mode !== "remote" && !city) throw E.bad("حدّد المدينة للعمل في الموقع أو الهجين");
    const employment = kind === "job" ? oneOf(b.employment ?? prev?.employment, Object.keys(EMPLOY), "full") : null;
    const payType = oneOf(b.payType ?? prev?.pay_type, Object.keys(PAY), "fixed");
    let min = b.payMin !== undefined ? amt(b.payMin) : prev?.pay_min ?? null, max = b.payMax !== undefined ? amt(b.payMax) : prev?.pay_max ?? null;
    if (payType === "none") { min = null; max = null; } else { if (min === null && max === null) throw fail(400, "bad_pay", "حدّد الأجر بالـ Pi (أو اختر «بدون أجر»)"); if (min === null) min = max; if (max === null) max = min; if (Number(max) < Number(min)) throw fail(400, "bad_pay", "الحد الأعلى للأجر أقل من الأدنى"); }
    const deadline = b.deadline !== undefined ? (b.deadline || null) : prev?.deadline || null;
    if (deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || deadline < today())) throw fail(400, "bad_date", "آخر موعد للتقديم يجب أن يكون اليوم أو بعده");
    const qIn = b.questions !== undefined ? b.questions : parse(prev?.questions, []);
    if (!Array.isArray(qIn) || qIn.length > 3) throw E.bad("حتى ٣ أسئلة");
    const questions = qIn.map((q) => str(String(q ?? ""), 200, { required: true, min: 5 }));
    const minorsOk = payType === "none" ? (b.minorsOk !== undefined ? (b.minorsOk ? 1 : 0) : prev ? Number(prev.minors_ok) : 0) : 0;
    return { kind, title, body, category, skills, mode, city, country, employment, payType, min, max, deadline, questions, minorsOk };
  }

  /* ---------- views ---------- */
  const expired = (j) => !!j.deadline && j.deadline < today();
  async function savedSet(uid, ids) { if (!uid || !ids.length) return new Set(); return new Set((await db.all(`SELECT job_id FROM job_saved WHERE user_id=$1 AND job_id IN (${ph(ids, 1)})`, [uid, ...ids])).map((r) => r.job_id)); }
  function card(j, u, saved) {
    return { id: j.id, kind: { key: j.kind, label: KIND[j.kind] }, title: j.title, category: { key: j.category, label: CATS[j.category] }, skills: parse(j.skills, []), mode: { key: j.mode, label: MODES[j.mode] }, city: j.city || null, country: j.country || null,
      employment: j.employment ? { key: j.employment, label: EMPLOY[j.employment] } : null, pay: { type: j.pay_type, label: PAY[j.pay_type], min: j.pay_min === null || j.pay_min === undefined ? null : pi(j.pay_min), max: j.pay_max === null || j.pay_max === undefined ? null : pi(j.pay_max) },
      deadline: j.deadline || null, expired: expired(j), status: j.status, statusLabel: STATUS[j.status], featured: ts(j.featured_until) > clock(), apps: Number(j.apps || 0), publishedAt: j.published_at || j.created_at, poster: pubU(u), saved: !!saved?.has(j.id), minorsOk: !!Number(j.minors_ok) };
  }
  async function search(viewer, q = {}) {
    const text = normalize(String(q.q || "")).toLowerCase().trim().slice(0, 80), skill = normalize(String(q.skill || "")).toLowerCase().trim().slice(0, 40), city = normalize(String(q.city || "")).toLowerCase().trim().slice(0, 60);
    const kind = KIND[q.kind] ? q.kind : null, cat = CATS[q.category] ? q.category : null, mode = MODES[q.mode] ? q.mode : null, minPay = q.minPay ? toUnits(Math.max(0, Number(q.minPay) || 0)) : 0, sort = q.sort === "pay" ? "pay" : "recent";
    const page = Math.max(0, Math.min(50, Number(q.page) || 0)), per = 20;
    const rows = await db.all("SELECT * FROM jobs WHERE status='open' ORDER BY published_at DESC LIMIT 3000");
    const flagged = new Set((await db.all("SELECT job_id FROM job_reports WHERE status='open' GROUP BY job_id HAVING COUNT(*) >= $1", [FLAG_AT])).map((r) => r.job_id));
    const minor = viewer ? await isMinor(viewer.id) : false, out = [];
    for (const j of rows) {
      if (flagged.has(j.id) || expired(j) || (kind && j.kind !== kind) || (cat && j.category !== cat) || (mode && j.mode !== mode)) continue;
      if (minor && !Number(j.minors_ok)) continue;
      if (minPay && Number(j.pay_max || 0) < minPay) continue;
      const sks = parse(j.skills, []).map((s) => normalize(s).toLowerCase());
      if (skill && !sks.some((s) => s.includes(skill))) continue;
      if (city && !normalize(`${j.city || ""} ${j.country || ""}`).toLowerCase().includes(city)) continue;
      let s = 1;
      if (text) { const terms = text.split(/\s+/).filter(Boolean), t = normalize(j.title).toLowerCase(), b = normalize(j.body).toLowerCase(), k = sks.join(" "); s = 0; for (const w of terms) { if (t.includes(w)) s += 5; if (k.includes(w)) s += 4; if (b.includes(w)) s += 1; } if (!s) continue; }
      if (viewer && (await blockedBetween(viewer.id, j.poster_id))) continue;
      out.push({ j, s });
    }
    const feat = (j) => (ts(j.featured_until) > clock() ? 1 : 0);
    out.sort((a, b) => feat(b.j) - feat(a.j) || (text ? b.s - a.s : 0) || (sort === "pay" ? Number(b.j.pay_max || 0) - Number(a.j.pay_max || 0) : 0) || ts(b.j.published_at) - ts(a.j.published_at));
    const slice = out.slice(page * per, (page + 1) * per), us = await usersOf(slice.map((x) => x.j.poster_id)), saved = await savedSet(viewer?.id, slice.map((x) => x.j.id));
    const counts = {}; for (const { j } of out) counts[j.category] = (counts[j.category] || 0) + 1;
    return { jobs: slice.map(({ j }) => card(j, us.get(j.poster_id), saved)), total: out.length, page, more: out.length > (page + 1) * per, counts, options: options(), minor, piEnabled: piOn() };
  }
  const options = () => ({ kinds: KIND, categories: CATS, modes: MODES, employment: EMPLOY, pay: PAY, reasons: REASONS, boostDays: BOOST_DAYS, boostPerDay: pi(BOOST_PER_DAY) });
  const jobRow = (jid) => db.get("SELECT * FROM jobs WHERE id=$1", [String(jid)]);
  async function jobView(viewer, jid) {
    const j = await jobRow(jid); if (!j) throw E.nf();
    const owner = !!viewer && viewer.id === j.poster_id, staff = viewer?.role === "admin";
    if (!owner && !staff && (j.status === "review" || j.status === "removed")) throw E.nf();
    if (viewer && !owner && (await blockedBetween(viewer.id, j.poster_id))) throw E.nf();
    const minor = viewer ? await isMinor(viewer.id) : false;
    if (minor && !owner && !Number(j.minors_ok)) throw fail(403, "minor_restricted", "هذا الإعلان غير متاح لمن هم دون ١٨ سنة");
    const us = await usersOf([j.poster_id]), saved = await savedSet(viewer?.id, [j.id]);
    const mine = viewer && !owner ? await db.get("SELECT id, status FROM job_applications WHERE job_id=$1 AND applicant_id=$2", [j.id, viewer.id]) : null;
    if (viewer && !owner && !mine) await db.run("UPDATE jobs SET views=views+1 WHERE id=$1", [j.id]);
    const hasPro = viewer && !owner ? !!(await db.get("SELECT 1 x FROM pro_profiles WHERE user_id=$1", [viewer.id]).catch(() => null)) : false;
    let why = null, whyCode = null;
    if (!viewer) [why, whyCode] = ["سجّل الدخول للتقديم", "auth"];
    else if (owner) [why, whyCode] = [null, "own"];
    else if (j.status !== "open") [why, whyCode] = ["الإعلان غير مفتوح للتقديم", "not_open"];
    else if (expired(j)) [why, whyCode] = ["انتهى موعد التقديم", "expired"];
    else if (minor && j.pay_type !== "none") [why, whyCode] = ["التقديم على الأعمال المدفوعة متاح لمن هم ١٨ سنة فأكثر", "minor_restricted"];
    else if (mine) [why, whyCode] = ["قدّمت على هذا الإعلان", "already_applied"];
    else if (!hasPro) [why, whyCode] = ["أنشئ ملفك المهني أولاً للتقديم", "no_profile"];
    const poster = us.get(j.poster_id);
    return {
      job: { ...card(j, poster, saved), body: j.body, questions: parse(j.questions, []), views: owner || staff ? Number(j.views || 0) : undefined, reviewReasons: owner || staff ? parse(j.review_reasons, []) : undefined, removedReason: owner || staff ? j.removed_reason || null : undefined,
        posterSince: poster?.created_at || null, featuredUntil: owner ? j.featured_until || null : undefined },
      me: { owner, staff, signedIn: !!viewer, canApply: !!viewer && !owner && !why, why, whyCode, application: mine ? { id: mine.id, status: mine.status, statusLabel: APP[mine.status] } : null, hasPro, canReport: !!viewer && !owner, minor },
      options: options(), piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF,
      safety: "لا تدفع أي مبلغ للتقديم على عمل، ولا تشارك عبارة مرور محفظتك أبداً. الدفع مقابل العمل يتم عبر عقود مجتمع بلس بالضمان."
    };
  }

  /* ---------- postings ---------- */
  async function create(user, b) {
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "نشر الوظائف والمشاريع متاح لمن هم ١٨ سنة فأكثر");
    if (!rl.hit("default", "jobnew:" + user.id)) throw E.rate();
    const open = await n("SELECT COUNT(*) n FROM jobs WHERE poster_id=$1 AND status IN ('review','open','paused')", [user.id]);
    if (open >= MAX_OPEN) throw fail(409, "limit", `لديك ${MAX_OPEN} إعلانات نشطة؛ أغلق بعضها أولاً`);
    const f = fields(b), now = iso();
    const reasons = risks(`${f.title}\n${f.body}\n${f.questions.join("\n")}`, f.max);
    const u = await db.get("SELECT created_at, verified FROM users WHERE id=$1", [user.id]);
    if (!u?.verified && clock() - new Date(u?.created_at || now).getTime() < NEW_DAYS * 864e5) reasons.push({ key: "new", label: "حساب جديد (مراجعة أولى روتينية)" });
    const status = reasons.length && user.role !== "admin" ? "review" : "open", jid = id("job");
    await db.run("INSERT INTO jobs (id, poster_id, kind, title, body, category, skills, mode, city, country, employment, pay_type, pay_min, pay_max, deadline, questions, minors_ok, status, review_reasons, created_at, updated_at, published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20,$21)",
      [jid, user.id, f.kind, f.title, f.body, f.category, JSON.stringify(f.skills), f.mode, f.city, f.country, f.employment, f.payType, f.min, f.max, f.deadline, JSON.stringify(f.questions), f.minorsOk, status, JSON.stringify(status === "review" ? reasons : []), now, status === "open" ? now : null]);
    return { id: jid, state: status, statusLabel: STATUS[status], reasons: status === "review" ? reasons : [] };
  }
  async function own(user, jid) { const j = await jobRow(jid); if (!j || (j.poster_id !== user.id && user.role !== "admin")) throw E.nf(); return j; }
  async function edit(user, jid, b) {
    const j = await own(user, jid); if (j.status === "removed") throw fail(409, "removed", "أزال فريق المنصة هذا الإعلان");
    const f = fields(b, j), reasons = risks(`${f.title}\n${f.body}\n${f.questions.join("\n")}`, f.max);
    const status = reasons.length && user.role !== "admin" ? "review" : j.status === "review" ? "review" : j.status;
    await db.run("UPDATE jobs SET title=$1, body=$2, category=$3, skills=$4, mode=$5, city=$6, country=$7, employment=$8, pay_type=$9, pay_min=$10, pay_max=$11, deadline=$12, questions=$13, minors_ok=$14, status=$15, review_reasons=$16, updated_at=$17 WHERE id=$18",
      [f.title, f.body, f.category, JSON.stringify(f.skills), f.mode, f.city, f.country, f.employment, f.payType, f.min, f.max, f.deadline, JSON.stringify(f.questions), f.minorsOk, status, JSON.stringify(status === "review" ? (reasons.length ? reasons : parse(j.review_reasons, [])) : []), iso(), j.id]);
    return { id: j.id, state: status, statusLabel: STATUS[status], reasons: status === "review" ? reasons : [] };
  }
  async function setState(user, jid, b) {
    const j = await own(user, jid), to = oneOf(b.status, ["open", "paused", "closed", "filled"], null); if (!to) throw E.bad();
    if (["review", "removed"].includes(j.status)) throw fail(409, "not_allowed", j.status === "review" ? "الإعلان قيد المراجعة" : "أزال فريق المنصة هذا الإعلان");
    if (to === "open" && ["closed", "filled"].includes(j.status) && expired(j)) throw fail(409, "expired", "حدّث آخر موعد للتقديم قبل إعادة الفتح");
    if (to === "open" && await n("SELECT COUNT(*) n FROM job_reports WHERE job_id=$1 AND status='open'", [j.id]) >= FLAG_AT) throw fail(409, "flagged", "الإعلان قيد مراجعة فريق المنصة بسبب البلاغات");
    await db.run("UPDATE jobs SET status=$1, updated_at=$2, closed_at=$3, published_at=COALESCE(published_at,$2) WHERE id=$4", [to, iso(), ["closed", "filled"].includes(to) ? iso() : null, j.id]);
    if (["closed", "filled"].includes(to)) for (const a of await db.all("SELECT id, applicant_id FROM job_applications WHERE job_id=$1 AND status IN ('submitted','viewed','shortlisted','interview')", [j.id])) { await db.run("UPDATE job_applications SET status='rejected', updated_at=$1 WHERE id=$2", [iso(), a.id]); await event(a.id, null, "status", "rejected", to === "filled" ? "تم شغل هذه الفرصة. شكراً لاهتمامك." : "أُغلق الإعلان."); await notify(a.applicant_id, "job_app_status", a.id); }
    return { state: to, statusLabel: STATUS[to] };
  }
  async function mine(user) {
    const rows = await db.all("SELECT * FROM jobs WHERE poster_id=$1 AND status<>'removed' ORDER BY created_at DESC LIMIT 100", [user.id]);
    const counts = {}; for (const r of await db.all(`SELECT job_id, status, COUNT(*) n FROM job_applications WHERE job_id IN (SELECT id FROM jobs WHERE poster_id=$1) GROUP BY job_id, status`, [user.id])) (counts[r.job_id] ||= {})[r.status] = Number(r.n);
    const apps = await db.all("SELECT a.id, a.status, a.updated_at, j.id jid, j.title, j.kind, j.status jstatus, j.poster_id FROM job_applications a JOIN jobs j ON j.id=a.job_id WHERE a.applicant_id=$1 ORDER BY a.updated_at DESC LIMIT 100", [user.id]);
    const us = await usersOf(apps.map((a) => a.poster_id));
    const saved = await db.all("SELECT j.* FROM job_saved s JOIN jobs j ON j.id=s.job_id WHERE s.user_id=$1 AND j.status NOT IN ('removed','review') ORDER BY s.created_at DESC LIMIT 100", [user.id]);
    const su = await usersOf(saved.map((j) => j.poster_id));
    return { postings: rows.map((j) => ({ ...card(j, null), counts: counts[j.id] || {}, reviewReasons: parse(j.review_reasons, []), views: Number(j.views || 0) })),
      applications: apps.map((a) => ({ id: a.id, status: a.status, statusLabel: APP[a.status], updatedAt: a.updated_at, job: { id: a.jid, title: a.title, kind: KIND[a.kind], status: a.jstatus, poster: pubU(us.get(a.poster_id)) } })),
      saved: saved.map((j) => card(j, su.get(j.poster_id), new Set(saved.map((x) => x.id)))), minor: await isMinor(user.id), options: options() };
  }
  async function save(user, jid, on) { const j = await jobRow(jid); if (!j) throw E.nf(); if (on) { if (!(await db.get("SELECT 1 x FROM job_saved WHERE user_id=$1 AND job_id=$2", [user.id, j.id]))) await db.run("INSERT INTO job_saved (user_id, job_id, created_at) VALUES ($1,$2,$3)", [user.id, j.id, iso()]); } else await db.run("DELETE FROM job_saved WHERE user_id=$1 AND job_id=$2", [user.id, j.id]); return { saved: !!on }; }

  /* ---------- applications ---------- */
  async function event(aid, actor, kind, status, body, warn = 0) { await db.run("INSERT INTO job_events (id, app_id, actor_id, kind, status, body, warn, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id("jev"), aid, actor, kind, status || null, body || null, warn ? 1 : 0, iso()]); }
  async function apply(user, jid, b) {
    if (!rl.hit("default", "jobapp:" + user.id)) throw E.rate();
    const v = await jobView(user, jid); const j = await jobRow(jid);
    if (!v.me.canApply) { const code = v.me.whyCode || "not_open"; throw fail(code === "minor_restricted" ? 403 : 409, code, v.me.why || "لا يمكنك التقديم على إعلانك"); }
    const cover = String(b.cover || "").trim(); if (cover.length < 30) throw fail(400, "too_short", "اكتب رسالة تقديم من ٣٠ حرفاً على الأقل"); if (cover.length > 3000) throw E.bad("رسالة التقديم أطول من الحد");
    const qs = parse(j.questions, []), ansIn = Array.isArray(b.answers) ? b.answers : [];
    const answers = qs.map((_, i) => { const a = String(ansIn[i] ?? "").trim(); if (a.length < 2) throw fail(400, "answers", "أجب عن كل الأسئلة"); return a.slice(0, 1000); });
    let bid = null, days = null;
    if (j.kind === "freelance" && j.pay_type !== "none") { bid = amt(b.bid); days = Math.round(Number(b.days) || 0); if (!bid || bid <= 0) throw fail(400, "bid", "اكتب عرضك بالـ Pi"); if (days < 1 || days > 365) throw fail(400, "bid", "مدة التنفيذ بين يوم و٣٦٥ يوماً"); }
    const aid = id("jap"), now = iso();
    await db.run("INSERT INTO job_applications (id, job_id, applicant_id, cover, answers, bid, days, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$8)", [aid, j.id, user.id, cover, JSON.stringify(answers), bid, days, now]);
    await db.run("UPDATE jobs SET apps=apps+1 WHERE id=$1", [j.id]);
    await event(aid, user.id, "status", "submitted", null);
    await notify(j.poster_id, "job_app_new", aid, user.id);
    return { id: aid, state: "submitted", statusLabel: APP.submitted };
  }
  async function appRow(aid) { return db.get("SELECT a.*, j.poster_id, j.title jtitle, j.kind jkind, j.status jstatus, j.questions jquestions, j.pay_type FROM job_applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1", [String(aid)]); }
  async function access(user, a) { if (!a) throw E.nf(); const employer = a.poster_id === user.id || user.role === "admin", applicant = a.applicant_id === user.id; if (!employer && !applicant) throw E.nf(); return { employer, applicant }; }
  async function appView(user, aid) {
    const a = await appRow(aid), who = await access(user, a);
    if (who.employer && !who.applicant && a.status === "submitted" && a.poster_id === user.id) { await db.run("UPDATE job_applications SET status='viewed', updated_at=$1 WHERE id=$2", [iso(), a.id]); await event(a.id, user.id, "status", "viewed", null); a.status = "viewed"; }
    const us = await usersOf([a.applicant_id, a.poster_id]);
    const evs = await db.all("SELECT * FROM job_events WHERE app_id=$1 ORDER BY created_at, id", [a.id]);
    let profile = null;
    if (who.employer) { try { const ap = us.get(a.applicant_id); const full = await db.get("SELECT id, name, handle, color, avatar, verified, role, status FROM users WHERE id=$1", [ap.id]); profile = await ctx.services.proprofile?.build?.(full, { id: full.id, role: "user" }); if (profile) { delete profile.profile.views; profile.self = false; } } catch { profile = null; } }
    return {
      application: { id: a.id, status: a.status, statusLabel: APP[a.status], cover: a.cover, answers: parse(a.answers, []), questions: parse(a.jquestions, []), bid: a.bid === null || a.bid === undefined ? null : pi(a.bid), days: a.days === null || a.days === undefined ? null : Number(a.days), createdAt: a.created_at, note: who.employer ? a.note || "" : undefined,
        job: { id: a.job_id, title: a.jtitle, kind: { key: a.jkind, label: KIND[a.jkind] }, status: a.jstatus }, applicant: pubU(us.get(a.applicant_id)), employer: pubU(us.get(a.poster_id)) },
      events: evs.map((e) => ({ id: e.id, kind: e.kind, status: e.status || null, statusLabel: e.status ? APP[e.status] : null, body: e.body || null, warn: !!Number(e.warn) && e.actor_id !== user.id, mine: e.actor_id === user.id, by: e.actor_id ? (e.actor_id === a.applicant_id ? "applicant" : "employer") : "system", at: e.created_at })),
      me: { employer: who.employer, applicant: who.applicant, next: who.employer ? NEXT[a.status] || [] : [], canWithdraw: who.applicant && !["hired", "rejected", "withdrawn"].includes(a.status), canMessage: !["withdrawn"].includes(a.status) },
      profile, statuses: APP
    };
  }
  async function pipeline(user, jid, q = {}) {
    const j = await own(user, jid);
    const rows = await db.all("SELECT * FROM job_applications WHERE job_id=$1 ORDER BY created_at DESC", [j.id]);
    const us = await usersOf(rows.map((r) => r.applicant_id));
    const pros = rows.length ? await db.all(`SELECT user_id, headline, city FROM pro_profiles WHERE user_id IN (${ph(rows.map((r) => r.applicant_id))})`, rows.map((r) => r.applicant_id)).catch(() => []) : [];
    const skills = rows.length ? await db.all(`SELECT user_id, name FROM pro_skills WHERE user_id IN (${ph(rows.map((r) => r.applicant_id))}) ORDER BY pos`, rows.map((r) => r.applicant_id)).catch(() => []) : [];
    const counts = {}; for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
    let reps = new Map(); try { reps = (await ctx.services.proreviews?.cards?.(rows.map((r) => r.applicant_id))) || reps; } catch { /* phase 80 optional */ }
    const st = APP[q.status] ? q.status : null;
    return { job: card(j, null), counts, statuses: APP,
      applications: rows.filter((r) => !st || r.status === st || (st === "submitted" && r.status === "viewed")).map((r) => ({ id: r.id, status: r.status, statusLabel: APP[r.status], createdAt: r.created_at, bid: r.bid === null || r.bid === undefined ? null : pi(r.bid), days: r.days === null || r.days === undefined ? null : Number(r.days),
        applicant: pubU(us.get(r.applicant_id)), headline: pros.find((p) => p.user_id === r.applicant_id)?.headline || null, skills: skills.filter((s) => s.user_id === r.applicant_id).slice(0, 4).map((s) => s.name), excerpt: String(r.cover).slice(0, 160), rep: reps.get(r.applicant_id) || null })) };
  }
  async function setAppStatus(user, aid, b) {
    const a = await appRow(aid), who = await access(user, a); if (!who.employer) throw E.forbid();
    const to = oneOf(b.status, Object.keys(APP), null); if (!to || !(NEXT[a.status] || []).includes(to)) throw fail(409, "bad_transition", "لا يمكن نقل الطلب إلى هذه المرحلة");
    const msg = str(b.message, 1000);
    await db.run("UPDATE job_applications SET status=$1, updated_at=$2 WHERE id=$3", [to, iso(), a.id]);
    await event(a.id, user.id, "status", to, msg);
    await notify(a.applicant_id, "job_app_status", a.id, user.id);
    if (to === "hired" && a.jkind === "job") { const left = await n("SELECT COUNT(*) n FROM job_applications WHERE job_id=$1 AND status IN ('submitted','viewed','shortlisted','interview','offered')", [a.job_id]); if (!left) await db.run("UPDATE jobs SET status='filled', closed_at=$1, updated_at=$1 WHERE id=$2 AND status IN ('open','paused')", [iso(), a.job_id]); }
    return appView(user, aid);
  }
  async function setNote(user, aid, b) { const a = await appRow(aid), who = await access(user, a); if (!who.employer) throw E.forbid(); await db.run("UPDATE job_applications SET note=$1 WHERE id=$2", [str(b.note, 2000), a.id]); return { ok: true }; }
  async function message(user, aid, b) {
    const a = await appRow(aid); await access(user, a);
    if (a.status === "withdrawn") throw fail(409, "withdrawn", "سُحب هذا الطلب");
    if (!rl.hit("default", "jobmsg:" + user.id)) throw E.rate();
    const body = str(b.body, 2000, { required: true, min: 1 });
    if (await blockedBetween(a.applicant_id, a.poster_id)) throw E.forbid("لا يمكن المراسلة");
    const warn = risks(body).some((r) => ["fee", "offplatform", "phrase", "income"].includes(r.key));
    await event(a.id, user.id, "message", null, body, warn ? 1 : 0);
    await notify(user.id === a.applicant_id ? a.poster_id : a.applicant_id, "job_app_msg", a.id, user.id);
    return appView(user, aid);
  }
  async function withdraw(user, aid) {
    const a = await appRow(aid); if (!a || a.applicant_id !== user.id) throw E.nf();
    if (["hired", "rejected", "withdrawn"].includes(a.status)) throw fail(409, "bad_transition", "لا يمكن سحب هذا الطلب");
    await db.run("UPDATE job_applications SET status='withdrawn', updated_at=$1 WHERE id=$2", [iso(), a.id]); await event(a.id, user.id, "status", "withdrawn", null);
    await notify(a.poster_id, "job_app_status", a.id, user.id);
    return { ok: true };
  }

  /* ---------- reports + staff ---------- */
  async function report(user, jid, b) {
    const j = await jobRow(jid); if (!j || j.status === "removed") throw E.nf(); if (j.poster_id === user.id) throw E.bad("لا يمكنك الإبلاغ عن إعلانك");
    if (!rl.hit("report", "jobrep:" + user.id)) throw E.rate();
    const reason = oneOf(b.reason, Object.keys(REASONS), null); if (!reason) throw E.bad("اختر سبب البلاغ");
    if (await db.get("SELECT 1 x FROM job_reports WHERE job_id=$1 AND by_user=$2", [j.id, user.id])) throw fail(409, "already_reported", "أبلغت عن هذا الإعلان من قبل");
    await db.run("INSERT INTO job_reports (id, job_id, by_user, reason, note, status, created_at) VALUES ($1,$2,$3,$4,$5,'open',$6)", [id("jrp"), j.id, user.id, reason, str(b.note, 600), iso()]);
    const open = await n("SELECT COUNT(*) n FROM job_reports WHERE job_id=$1 AND status='open'", [j.id]);
    if (open >= FLAG_AT && j.status === "open") { await db.run("UPDATE jobs SET status='paused', updated_at=$1 WHERE id=$2", [iso(), j.id]); await notify(j.poster_id, "job_review", j.id); }
    return { ok: true, flagged: open >= FLAG_AT };
  }
  async function adminView() {
    const review = await db.all("SELECT * FROM jobs WHERE status='review' ORDER BY created_at LIMIT 200");
    const reps = await db.all("SELECT r.*, j.title, j.status jstatus, j.poster_id FROM job_reports r JOIN jobs j ON j.id=r.job_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 300");
    const us = await usersOf([...review.map((j) => j.poster_id), ...reps.map((r) => r.poster_id)]);
    const byJob = {}; for (const r of reps) { const g = (byJob[r.job_id] ||= { job: { id: r.job_id, title: r.title, status: r.jstatus, poster: pubU(us.get(r.poster_id)) }, reports: [] }); g.reports.push({ id: r.id, reason: r.reason, reasonLabel: REASONS[r.reason], note: r.note || "", at: r.created_at }); }
    return { flagAt: FLAG_AT, review: review.map((j) => ({ ...card(j, us.get(j.poster_id)), body: j.body.slice(0, 600), reasons: parse(j.review_reasons, []) })), reports: Object.values(byJob).sort((a, b) => b.reports.length - a.reports.length),
      totals: { open: await n("SELECT COUNT(*) n FROM jobs WHERE status='open'"), review: review.length, reports: reps.length, applications: await n("SELECT COUNT(*) n FROM job_applications") } };
  }
  async function moderate(staff, jid, b) {
    const j = await jobRow(jid); if (!j) throw E.nf(); const action = oneOf(b.action, ["approve", "remove", "dismiss"], null); if (!action) throw E.bad();
    const reason = str(b.reason, 400), now = iso();
    if (action === "approve") { if (!["review", "paused"].includes(j.status)) throw fail(409, "not_allowed", "الإعلان ليس قيد المراجعة"); await db.run("UPDATE jobs SET status='open', review_reasons='[]', published_at=COALESCE(published_at,$1), updated_at=$1 WHERE id=$2", [now, j.id]); await notify(j.poster_id, "job_approved", j.id, staff.id); }
    if (action === "remove") { if (!reason) throw E.bad("اكتب سبب الإزالة ليصل لصاحب الإعلان"); await db.run("UPDATE jobs SET status='removed', removed_reason=$1, updated_at=$2, closed_at=$2 WHERE id=$3", [reason, now, j.id]); await notify(j.poster_id, "job_removed", j.id, staff.id);
      for (const a of await db.all("SELECT id, applicant_id FROM job_applications WHERE job_id=$1 AND status NOT IN ('hired','rejected','withdrawn')", [j.id])) { await db.run("UPDATE job_applications SET status='rejected', updated_at=$1 WHERE id=$2", [now, a.id]); await event(a.id, null, "status", "rejected", "أزال فريق المنصة هذا الإعلان لمخالفته السياسات. لا تتواصل مع صاحبه خارج المنصة ولا تدفع له أي مبلغ."); await notify(a.applicant_id, "job_app_status", a.id); } }
    if (action === "dismiss" && j.status === "paused") await db.run("UPDATE jobs SET status='open', updated_at=$1 WHERE id=$2", [now, j.id]);
    await db.run("UPDATE job_reports SET status=$1, decided_at=$2, decided_by=$3 WHERE job_id=$4 AND status='open'", [action === "remove" ? "actioned" : "dismissed", now, staff.id, j.id]);
    ctx.audit?.("job_" + action, j.id, reason || j.title, staff.id);
    return adminView();
  }

  /* ---------- Pi: featured boost ---------- */
  async function boost(user, jid, b) {
    const j = await own(user, jid);
    if (!piOn()) throw E.off(PI_OFF);
    if (j.status !== "open") throw fail(409, "not_open", "يمكن تمييز الإعلانات المفتوحة فقط");
    const days = BOOST_DAYS.includes(Number(b.days)) ? Number(b.days) : null; if (!days) throw E.bad("اختر مدة التمييز");
    const amount = BOOST_PER_DAY * days, bid = id("jbo");
    await db.run("INSERT INTO job_boosts (id, job_id, user_id, days, amount, status, created_at) VALUES ($1,$2,$3,$4,$5,'pending',$6)", [bid, j.id, user.id, days, amount, iso()]);
    try { const it = await ctx.services.pi.createIntent(user, { amount: pi(amount), memo: `تمييز إعلان: ${j.title}`.slice(0, 200), purpose: "jobs", refId: bid }); await db.run("UPDATE job_boosts SET intent_id=$1 WHERE id=$2", [it.id, bid]); return { boost: bid, intent: it, amount: pi(amount), days }; }
    catch (e) { await db.run("DELETE FROM job_boosts WHERE id=$1", [bid]); throw e; }
  }
  bus?.on?.("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "jobs") return;
    const bo = await db.get("SELECT * FROM job_boosts WHERE intent_id=$1", [e.tx]); if (!bo) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(bo.amount)) > 1) { ctx.log?.warn?.("jobs boost amount mismatch", { boost: bo.id }); return; }
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE job_boosts SET status='completed', completed_at=$1 WHERE id=$2 AND status='pending'", [iso(), bo.id]); if (!r.changes) return;
      const j = await tx.get("SELECT featured_until FROM jobs WHERE id=$1", [bo.job_id]);
      const from = Math.max(clock(), j?.featured_until ? new Date(j.featured_until).getTime() : 0);
      await tx.run("UPDATE jobs SET featured_until=$1 WHERE id=$2", [iso(from + Number(bo.days) * 864e5), bo.job_id]);
      await postJournal(tx, { ikey: `jobs:${bo.id}:boost`, kind: "jobs_boost", source: "jobs", refId: bo.id, senderId: bo.user_id, piTx: e.tx, lines: [{ account: ACC.out(bo.user_id), userId: bo.user_id, debit: Number(bo.amount) }, { account: ACC.fees, credit: Number(bo.amount) }] });
    });
  }));
  bus?.on?.("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "jobs") await db.run("UPDATE job_boosts SET status='cancelled' WHERE intent_id=$1 AND status='pending'", [e.tx]); }));

  /* ---------- routes ---------- */
  R.get("/api/jobs", async (req) => search(req.user || null, req.query || {}));
  R.post("/api/jobs", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/jobs/me", A(async (req) => mine(req.user)));
  R.get("/api/jobs/:id", async (req) => jobView(req.user || null, req.params.id));
  R.patch("/api/jobs/:id", A(async (req) => edit(req.user, req.params.id, req.body || {})));
  R.post("/api/jobs/:id/state", A(async (req) => setState(req.user, req.params.id, req.body || {})));
  R.post("/api/jobs/:id/save", A(async (req) => save(req.user, req.params.id, (req.body || {}).saved !== false)));
  R.post("/api/jobs/:id/apply", A(async (req) => apply(req.user, req.params.id, req.body || {})));
  R.post("/api/jobs/:id/report", A(async (req) => report(req.user, req.params.id, req.body || {})));
  R.post("/api/jobs/:id/boost", A(async (req) => boost(req.user, req.params.id, req.body || {})));
  R.get("/api/jobs/:id/applications", A(async (req) => pipeline(req.user, req.params.id, req.query || {})));
  R.get("/api/job-applications/:id", A(async (req) => appView(req.user, req.params.id)));
  R.post("/api/job-applications/:id/status", A(async (req) => setAppStatus(req.user, req.params.id, req.body || {})));
  R.put("/api/job-applications/:id/note", A(async (req) => setNote(req.user, req.params.id, req.body || {})));
  R.post("/api/job-applications/:id/messages", A(async (req) => message(req.user, req.params.id, req.body || {})));
  R.post("/api/job-applications/:id/withdraw", A(async (req) => withdraw(req.user, req.params.id)));
  R.get("/api/admin/jobs", admin(async () => adminView()));
  R.post("/api/admin/jobs/:id", admin(async (req) => moderate(req.user, req.params.id, req.body || {})));

  return { search, jobView, risks, appRow, KIND, CATS, APP, STATUS, PI_OFF, flush: () => Promise.all([...inflight]) };
};
