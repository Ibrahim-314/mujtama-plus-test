/* Verified creators program + creator support fund «برنامج الصنّاع الموثّقين وصندوق دعم» (phase 65). No external service, no keys.
 *  1. Eligibility (server-computed, transparent checklist): adult (phase 35), account age ≥ VC_MIN_AGE_DAYS (30), followers ≥
 *     VC_MIN_FOLLOWERS (50), published posts in the last 90 days ≥ VC_MIN_POSTS (10), two-step verification on (phase 3),
 *     profile photo + a bio of 20+ letters (phase 6), no standing moderation decision in the last 90 days (phase 31) and an
 *     active account. Every check says what is needed and where the member stands.
 *  2. Application: category (fixed list), statement, up to 3 links, code-of-conduct acceptance; the checks are snapshotted
 *     for the reviewer. One pending application at a time; a rejected member may re-apply after VC_REAPPLY_DAYS (30).
 *  3. Staff review (#/admin/creator-program): approve → program membership for one year, badge «صانع موثّق» (users.verified
 *     is set to 'creator' only when the member has no other verification — revoking removes only what the program added);
 *     reject with a reason; revoke with a reason (audited). Renewal: reminder 30 days before the end, membership lapses at the
 *     end (badge removed); the member renews from the program page when the checks still pass.
 *  4. Public directory of verified creators (category filter, search) — never lists minors (adults only by rule 1).
 *  5. Support fund: staff open rounds (budget, max grant, categories, window, criteria); verified creators apply once per
 *     round with a project, plan, amount and milestones (edit / withdraw while open); staff shortlist, approve an award
 *     (≤ request, round awards ≤ budget) or reject with a reason; funded creators post public progress updates; members may
 *     report a grant. Everything is public on #/fund: budgets, awards, payouts, donations (anonymous by choice).
 *  6. Money (existing double-entry ledger, lib/ledger.js): FUND journals — staff funding (platform:creator_fund_funding →
 *     platform:creator_fund), members' donations (user pi_out → fund, Pi purpose `fund`), a grant reservation (fund →
 *     creator:<id>:grants) and the staff payout recorded with the Pi txid (grants → platform:payouts; no A2U — the server holds
 *     no wallet seed). ALL of these need Pi payments on (PI_ENABLED + PI_API_KEY): while they are off (production today)
 *     they answer 501 not_configured with an Arabic notice; decisions are still recorded and shown «بانتظار تفعيل مدفوعات Pi».
 *  7. Minors: can read the directory and the fund; cannot apply, be verified, apply for a grant or donate. */
const { E, str, oneOf, id } = require("../lib/core");
const { pi, toUnits, createLedger, ACC, FUND, balance } = require("../lib/ledger");

const CATEGORIES = { education: "تعليم", tech: "تقنية وبرمجة", science: "علوم", culture: "ثقافة وأدب", islamic: "ثقافة إسلامية", arts: "فنون وتصميم", business: "أعمال وريادة", health: "صحة ولياقة", travel: "سفر وسياحة", food: "طبخ", gaming: "ألعاب", family: "أسرة وتربية", pi: "منظومة Pi", other: "أخرى" };
const APP_STATUS = { pending: "قيد المراجعة", approved: "مقبول", rejected: "مرفوض", withdrawn: "مسحوب" };
const VC_STATUS = { verified: "صانع موثّق", revoked: "سُحب التوثيق", lapsed: "انتهت المدة" };
const ROUND_STATUS = { draft: "مسودة", open: "مفتوحة للتقديم", review: "قيد المراجعة", closed: "مغلقة" };
const FA_STATUS = { submitted: "مُقدَّم", shortlisted: "في القائمة المختصرة", approved: "مقبول", rejected: "غير مقبول", withdrawn: "مسحوب" };
const PAY_STATUS = { none: "—", awaiting_pi: "بانتظار تفعيل مدفوعات Pi", reserved: "محجوز للصرف", paid: "صُرف" };
const REPORT_REASONS = { misuse: "سوء استخدام المنحة", misleading: "معلومات مضللة", plagiarism: "محتوى منسوخ", other: "سبب آخر" };
const DAY = 864e5;
const PI_OFF = "مدفوعات Pi غير مفعّلة بعد — التبرّع للصندوق وصرف المنح متوقفان حتى تفعيلها";

/** @param {any} ctx @param {{ now?: () => number, jobs?: boolean, env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const cfg = { minAge: +(env.VC_MIN_AGE_DAYS ?? 30), minFollowers: +(env.VC_MIN_FOLLOWERS ?? 50), minPosts: +(env.VC_MIN_POSTS ?? 10), reapply: +(env.VC_REAPPLY_DAYS ?? 30), term: 365 };
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const piOn = () => !!ctx.services.pi?.enabled?.();
  const { postJournal, reverseAll } = createLedger({ now: () => iso() });
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => ctx.log?.error?.("vcreators handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : E.bad(msg), { code });
  const userPub = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: u.verified || null } : null);
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; return a.length ? db.all(`SELECT id, name, handle, color, avatar, verified, status FROM users WHERE id IN (${ph(a)})`, a) : []; }
  const n = async (sql, a = []) => Number((await db.get(sql, a))?.n || 0);
  const amountIn = (v, max = 100000) => { const x = Number(v); if (!(Number.isFinite(x) && x > 0 && x <= max)) return null; return toUnits(Math.round(x * 100) / 100); };
  const linkList = (v) => (Array.isArray(v) ? v : String(v || "").split(/\s+/)).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 3).map((u) => { try { const x = new URL(u); if (!["https:", "http:"].includes(x.protocol)) throw 0; return x.toString().slice(0, 300); } catch { throw E.bad("رابط غير صالح: " + u.slice(0, 60)); } });

  /* ---------- 1. eligibility ---------- */
  async function checks(uid) {
    const u = await db.get("SELECT id, created_at, avatar, bio, status FROM users WHERE id=$1", [uid]); if (!u) throw E.nf();
    const t = clock();
    const ageDays = Math.floor((t - Date.parse(u.created_at)) / DAY);
    const followers = await n("SELECT COUNT(*) n FROM follows WHERE dst=$1", [uid]);
    const posts = await n("SELECT COUNT(*) n FROM posts WHERE author=$1 AND status='published' AND type<>'story' AND created_at > $2", [uid, iso(t - 90 * DAY)]);
    const twofa = !!(await db.get("SELECT 1 x FROM user_2fa WHERE user_id=$1 AND enabled=1", [uid]).catch(() => null));
    const strikes = await n("SELECT COUNT(*) n FROM decisions WHERE user_id=$1 AND restored=0 AND created_at > $2", [uid, iso(t - 90 * DAY)]).catch(() => 0);
    const minor = await isMinor(uid);
    const list = [
      { key: "adult", label: "عمرك ١٨ سنة فأكثر", ok: !minor, value: minor ? "دون ١٨" : "نعم", need: "١٨+" },
      { key: "age", label: `عمر الحساب ${cfg.minAge} يوماً على الأقل`, ok: ageDays >= cfg.minAge, value: ageDays, need: cfg.minAge },
      { key: "followers", label: `${cfg.minFollowers} متابعاً على الأقل`, ok: followers >= cfg.minFollowers, value: followers, need: cfg.minFollowers },
      { key: "posts", label: `${cfg.minPosts} منشورات خلال آخر ٩٠ يوماً`, ok: posts >= cfg.minPosts, value: posts, need: cfg.minPosts },
      { key: "twofa", label: "التحقق بخطوتين مفعّل", ok: twofa, value: twofa ? "مفعّل" : "غير مفعّل", need: "مفعّل", href: "#/security" },
      { key: "profile", label: "صورة شخصية ونبذة من ٢٠ حرفاً", ok: !!u.avatar && String(u.bio || "").trim().length >= 20, value: (u.avatar ? 1 : 0) + (String(u.bio || "").trim().length >= 20 ? 1 : 0), need: 2, href: "#/me" },
      { key: "record", label: "لا قرارات إشراف بحقك خلال ٩٠ يوماً", ok: strikes === 0 && u.status === "active", value: strikes, need: 0 }
    ];
    return { checks: list, eligible: list.every((c) => c.ok), minor };
  }

  /* ---------- 2–3. program ---------- */
  const memberOf = (uid) => db.get("SELECT * FROM vc_creators WHERE user_id=$1", [uid]);
  const memberClient = (m) => (m ? { status: m.status, statusLabel: VC_STATUS[m.status], category: { key: m.category, label: CATEGORIES[m.category] || m.category }, since: m.since, until: m.until, reason: m.status === "revoked" ? m.reason || null : null, renewable: m.status !== "revoked" && Date.parse(m.until) - clock() <= 60 * DAY } : null);
  const appClient = (a) => (a ? { id: a.id, category: { key: a.category, label: CATEGORIES[a.category] || a.category }, statement: a.statement, links: parse(a.links, []), status: a.status, statusLabel: APP_STATUS[a.status], reason: a.reason || null, createdAt: a.created_at, decidedAt: a.decided_at || null } : null);
  async function program(viewer) {
    const stats = { verified: await n("SELECT COUNT(*) n FROM vc_creators WHERE status='verified'"), categories: CATEGORIES };
    const benefits = ["شارة «صانع موثّق» بجانب اسمك", "الظهور في دليل الصنّاع الموثّقين", "أهلية التقديم على منح صندوق دعم الصنّاع", "مراجعة سنوية بسيطة للحفاظ على الثقة"];
    const conduct = ["أنشر محتوى أصلياً أو أذكر مصادره بوضوح", "أفصح عن أي محتوى مدفوع أو شراكة", "لا أضلّل جمهوري ولا أستغل ثقتهم", "أحترم الخصوصية وسياسات المجتمع وأحمي القُصّر", "أستخدم منح الصندوق فيما قدّمت له وأنشر تحديثات صادقة"];
    if (!viewer) return { ...stats, benefits, conduct, signedIn: false, piEnabled: piOn() };
    const ch = await checks(viewer.id);
    const last = await db.get("SELECT * FROM vc_applications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [viewer.id]);
    const m = await memberOf(viewer.id);
    let canApply = ch.eligible && (!m || m.status !== "verified") && !(last && last.status === "pending"), why = null;
    if (m?.status === "revoked") { canApply = false; why = "سُحب توثيقك من فريق المنصة" + (m.reason ? ": " + m.reason : ""); }
    if (last && last.status === "rejected" && clock() - Date.parse(last.decided_at || last.created_at) < cfg.reapply * DAY) { canApply = false; why = `يمكنك إعادة التقديم بعد ${cfg.reapply} يوماً من آخر قرار`; }
    if (!ch.eligible && !why) why = ch.minor ? "البرنامج متاح لمن هم ١٨ سنة فأكثر" : "أكمل الشروط أعلاه لتتمكن من التقديم";
    return { ...stats, benefits, conduct, signedIn: true, piEnabled: piOn(), ...ch, member: memberClient(m), application: appClient(last), canApply, why };
  }
  async function apply(user, b = {}) {
    if (!rl.hit("default", "vcapp:" + user.id)) throw E.rate();
    const p = await program(user);
    if (p.minor) throw fail(403, "minor_restricted", "البرنامج متاح لمن هم ١٨ سنة فأكثر");
    if (p.member?.status === "verified") throw E.conflict("أنت صانع موثّق بالفعل");
    if (p.application?.status === "pending") throw E.conflict("لديك طلب قيد المراجعة");
    if (!p.canApply) throw fail(403, "not_eligible", p.why || "لم تكتمل الشروط بعد");
    if (b.conduct !== true) throw E.bad("يلزم الموافقة على ميثاق الصنّاع");
    const category = CATEGORIES[b.category] ? b.category : null; if (!category) throw E.bad("اختر مجالك");
    const statement = str(b.statement, 1500, { required: true, min: 40 });
    const links = linkList(b.links);
    const aid = id("vca"), t = iso();
    await db.run("INSERT INTO vc_applications(id,user_id,category,statement,links,checks,conduct_at,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$7)", [aid, user.id, category, statement, JSON.stringify(links), JSON.stringify(p.checks), t]);
    return program(user);
  }
  async function withdraw(user) {
    const ch = await db.run("UPDATE vc_applications SET status='withdrawn', decided_at=$1 WHERE user_id=$2 AND status='pending'", [iso(), user.id]);
    if (!ch.changes) throw E.nf(); return program(user);
  }
  async function renew(user) {
    const m = await memberOf(user.id); if (!m || m.status === "revoked") throw E.forbid("لا يمكن التجديد");
    if (Date.parse(m.until) - clock() > 60 * DAY) throw E.conflict("التجديد متاح خلال آخر ٦٠ يوماً من المدة");
    const ch = await checks(user.id); if (!ch.eligible) throw fail(403, "not_eligible", "لم تعد كل الشروط مكتملة؛ أكملها ثم جدّد");
    const base = m.status === "verified" ? Math.max(clock(), Date.parse(m.until)) : clock();
    const u = await db.get("SELECT verified FROM users WHERE id=$1", [user.id]);
    const setBadge = !u.verified ? 1 : Number(m.badge_set) && u.verified === "creator" ? 1 : 0;
    await db.run("UPDATE vc_creators SET status='verified', until=$1, reminded=0, badge_set=$2, reason=NULL, updated_at=$3 WHERE user_id=$4", [iso(base + cfg.term * DAY), setBadge, iso(), user.id]);
    if (!u.verified) await db.run("UPDATE users SET verified='creator' WHERE id=$1 AND verified IS NULL", [user.id]);
    return program(user);
  }
  async function decide(by, aid, approve, b = {}) {
    const a = await db.get("SELECT * FROM vc_applications WHERE id=$1", [aid]); if (!a) throw E.nf();
    if (a.status !== "pending") throw E.conflict("تمت معالجة هذا الطلب");
    const reason = str(b.reason, 400, { required: !approve, min: 3 });
    if (approve && (await isMinor(a.user_id))) throw fail(403, "minor_restricted", "لا يمكن توثيق حساب دون ١٨ سنة");
    const t = iso();
    const ch = await db.run("UPDATE vc_applications SET status=$1, reason=$2, reviewer=$3, decided_at=$4 WHERE id=$5 AND status='pending'", [approve ? "approved" : "rejected", reason, by.id, t, aid]);
    if (!ch.changes) throw E.conflict("تمت معالجة هذا الطلب");
    if (approve) {
      const u = await db.get("SELECT verified FROM users WHERE id=$1", [a.user_id]);
      const setBadge = u && !u.verified ? 1 : 0, until = iso(clock() + cfg.term * DAY);
      const had = await memberOf(a.user_id);
      if (had) await db.run("UPDATE vc_creators SET category=$1, status='verified', since=$2, until=$3, badge_set=$4, reason=NULL, reminded=0, updated_at=$2 WHERE user_id=$5", [a.category, t, until, setBadge || (Number(had.badge_set) && u?.verified === "creator" ? 1 : 0), a.user_id]);
      else await db.run("INSERT INTO vc_creators(user_id,category,status,since,until,badge_set,updated_at) VALUES($1,$2,'verified',$3,$4,$5,$3)", [a.user_id, a.category, t, until, setBadge]);
      if (setBadge) await db.run("UPDATE users SET verified='creator' WHERE id=$1 AND verified IS NULL", [a.user_id]);
    }
    await notify(a.user_id, approve ? "vc_approved" : "vc_rejected", aid, by.id);
    ctx.audit?.(approve ? "vc_approved" : "vc_rejected", a.user_id, reason || a.category, by.id);
    return { ok: true, decision: approve ? "approved" : "rejected" };
  }
  async function dropBadge(m) { if (Number(m.badge_set)) await db.run("UPDATE users SET verified=NULL WHERE id=$1 AND verified='creator'", [m.user_id]); }
  async function revoke(by, uid, b = {}) {
    const m = await memberOf(uid); if (!m || m.status !== "verified") throw E.nf();
    const reason = str(b.reason, 400, { required: true, min: 3 });
    await db.run("UPDATE vc_creators SET status='revoked', reason=$1, updated_at=$2 WHERE user_id=$3", [reason, iso(), uid]);
    await dropBadge(m);
    // open grant applications of a revoked creator are withdrawn; decided ones stay on the public record
    await db.run("UPDATE fund_applications SET status='withdrawn', updated_at=$1 WHERE user_id=$2 AND status IN ('submitted','shortlisted')", [iso(), uid]);
    await notify(uid, "vc_revoked", uid, by.id);
    ctx.audit?.("vc_revoked", uid, reason, by.id);
    return { ok: true };
  }
  async function restore(by, uid) {
    const m = await memberOf(uid); if (!m || m.status !== "revoked") throw E.nf();
    const u = await db.get("SELECT verified FROM users WHERE id=$1", [uid]); const setBadge = u && !u.verified ? 1 : 0;
    await db.run("UPDATE vc_creators SET status='verified', reason=NULL, badge_set=$1, until=$2, reminded=0, updated_at=$3 WHERE user_id=$4", [setBadge, iso(Math.max(clock() + 30 * DAY, Date.parse(m.until))), iso(), uid]);
    if (setBadge) await db.run("UPDATE users SET verified='creator' WHERE id=$1 AND verified IS NULL", [uid]);
    ctx.audit?.("vc_restored", uid, "", by.id);
    return { ok: true };
  }

  /* ---------- 4. directory ---------- */
  async function directory(q = {}) {
    const cat = CATEGORIES[q.category] ? q.category : null, text = String(q.q || "").trim().toLowerCase().slice(0, 60);
    let rows = await db.all("SELECT c.user_id, c.category, c.since, u.name, u.handle, u.color, u.avatar, u.verified, u.bio, (SELECT COUNT(*) FROM follows f WHERE f.dst=u.id) followers FROM vc_creators c JOIN users u ON u.id=c.user_id WHERE c.status='verified' AND u.status='active' ORDER BY c.since DESC LIMIT 500");
    const counts = {}; for (const r of rows) counts[r.category] = (counts[r.category] || 0) + 1;
    if (cat) rows = rows.filter((r) => r.category === cat);
    if (text) rows = rows.filter((r) => [r.name, r.handle, r.bio, CATEGORIES[r.category]].join(" ").toLowerCase().includes(text));
    rows.sort((a, b) => Number(b.followers) - Number(a.followers));
    return { creators: rows.slice(0, 120).map((r) => ({ user: userPub({ id: r.user_id, name: r.name, handle: r.handle, color: r.color, avatar: r.avatar, verified: r.verified }), bio: String(r.bio || "").slice(0, 160), category: { key: r.category, label: CATEGORIES[r.category] || r.category }, since: r.since, followers: Number(r.followers) })), counts, categories: CATEGORIES };
  }
  async function badgeOf(handle) {
    const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1)", [String(handle || "").replace(/^@/, "")]); if (!u) throw E.nf();
    const m = await memberOf(u.id);
    return { verifiedCreator: !!(m && m.status === "verified"), category: m && m.status === "verified" ? { key: m.category, label: CATEGORIES[m.category] } : null, since: m && m.status === "verified" ? m.since : null };
  }

  /* ---------- 5. fund: rounds + applications ---------- */
  const roundOf = (rid) => db.get("SELECT * FROM fund_rounds WHERE id=$1", [rid]);
  const roundPhase = (r) => (r.status === "open" && clock() < Date.parse(r.opens_at) ? "soon" : r.status === "open" && clock() > Date.parse(r.closes_at) ? "ended" : r.status);
  async function awardedOf(rid) { return n("SELECT COALESCE(SUM(award),0) n FROM fund_applications WHERE round_id=$1 AND status='approved'", [rid]); }
  const roundClient = async (r, extra = {}) => ({ id: r.id, title: r.title, descr: r.descr, criteria: r.criteria || "", categories: parse(r.categories, []).map((k) => ({ key: k, label: CATEGORIES[k] || k })), budget: pi(r.budget), maxGrant: pi(r.max_grant), opensAt: r.opens_at, closesAt: r.closes_at, status: r.status, statusLabel: ROUND_STATUS[r.status], phase: roundPhase(r), awarded: pi(await awardedOf(r.id)), applications: await n("SELECT COUNT(*) n FROM fund_applications WHERE round_id=$1 AND status<>'withdrawn'", [r.id]), ...extra });
  const faClient = (a, us, opt = {}) => ({ id: a.id, roundId: a.round_id, title: a.title, plan: a.plan, amount: pi(a.amount), milestones: parse(a.milestones, []), status: a.status, statusLabel: FA_STATUS[a.status], award: pi(a.award), payStatus: a.pay_status, payLabel: PAY_STATUS[a.pay_status], payoutTx: a.payout_tx || null, reason: a.reason || null, createdAt: a.created_at, decidedAt: a.decided_at || null, paidAt: a.paid_at || null, creator: userPub(us.find((u) => u.id === a.user_id)), ...(opt.staff ? { score: a.score === null || a.score === undefined ? null : Number(a.score), note: a.note || "" } : {}) });
  async function fundOverview(viewer) {
    const pool = await balance(db, ACC.fundPool);
    const donated = await n("SELECT COALESCE(SUM(amount),0) n FROM fund_donations WHERE status='completed'");
    const donors = await n("SELECT COUNT(DISTINCT user_id) n FROM fund_donations WHERE status='completed'");
    const funded = await n("SELECT COALESCE(SUM(e.credit),0) n FROM ledger_entries e WHERE e.account=$1", [ACC.fundPool]);
    const awarded = await n("SELECT COALESCE(SUM(award),0) n FROM fund_applications WHERE status='approved'");
    const paid = await n("SELECT COALESCE(SUM(award),0) n FROM fund_applications WHERE status='approved' AND pay_status='paid'");
    const rounds = await db.all("SELECT * FROM fund_rounds WHERE status<>'draft' ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'review' THEN 1 ELSE 2 END, opens_at DESC LIMIT 40");
    const grants = await db.all("SELECT a.*, r.title rtitle FROM fund_applications a JOIN fund_rounds r ON r.id=a.round_id WHERE a.status='approved' AND r.status IN ('review','closed') ORDER BY a.decided_at DESC LIMIT 60");
    const us = await usersOf(grants.map((g) => g.user_id));
    const recent = await db.all("SELECT d.amount, d.anonymous, d.completed_at, d.user_id FROM fund_donations d WHERE d.status='completed' ORDER BY d.completed_at DESC LIMIT 12");
    const dus = await usersOf(recent.filter((d) => !Number(d.anonymous)).map((d) => d.user_id));
    const out = []; for (const r of rounds) out.push(await roundClient(r));
    let me = null;
    if (viewer) { const m = await memberOf(viewer.id); me = { verified: !!(m && m.status === "verified"), minor: await isMinor(viewer.id), applications: (await db.all("SELECT a.*, r.title rtitle FROM fund_applications a JOIN fund_rounds r ON r.id=a.round_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 20", [viewer.id])).map((a) => ({ ...faClient(a, [viewer]), round: a.rtitle })) }; }
    return { totals: { pool: pi(pool), received: pi(funded), donated: pi(donated), donors, awarded: pi(awarded), paid: pi(paid), grants: grants.length }, rounds: out, grants: grants.map((g) => ({ ...faClient(g, us), round: g.rtitle })), donations: recent.map((d) => ({ amount: pi(d.amount), at: d.completed_at, by: Number(d.anonymous) ? null : userPub(dus.find((u) => u.id === d.user_id)) })), piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF, me };
  }
  async function roundView(viewer, rid) {
    const r = await roundOf(rid); if (!r || (r.status === "draft" && viewer?.role !== "admin")) throw E.nf();
    const decided = ["review", "closed"].includes(r.status);
    const rows = decided ? await db.all("SELECT * FROM fund_applications WHERE round_id=$1 AND status='approved' ORDER BY award DESC", [rid]) : [];
    const us = await usersOf(rows.map((x) => x.user_id));
    let me = null;
    if (viewer) {
      const m = await memberOf(viewer.id), mine = await db.get("SELECT * FROM fund_applications WHERE round_id=$1 AND user_id=$2", [rid, viewer.id]);
      const verified = !!(m && m.status === "verified"), cats = parse(r.categories, []);
      let why = null;
      if (!verified) why = "التقديم متاح للصنّاع الموثّقين فقط";
      else if (roundPhase(r) !== "open") why = "باب التقديم ليس مفتوحاً الآن";
      else if (cats.length && !cats.includes(m.category)) why = "هذه الجولة لمجالات أخرى";
      me = { verified, application: mine ? faClient(mine, [viewer]) : null, canApply: !why && !mine, canEdit: !!mine && roundPhase(r) === "open" && ["submitted"].includes(mine.status), why };
    }
    return { round: await roundClient(r), awards: rows.map((a) => faClient(a, us)), me, piEnabled: piOn() };
  }
  function appFields(b, r) {
    const title = str(b.title, 140, { required: true, min: 6 }), plan = str(b.plan, 4000, { required: true, min: 80 });
    const amount = amountIn(b.amount); if (!amount) throw E.bad("حدّد المبلغ المطلوب بـ Pi");
    if (Number(r.max_grant) > 0 && amount > Number(r.max_grant)) throw E.bad(`الحد الأقصى للمنحة في هذه الجولة ${pi(r.max_grant)} Pi`);
    const ms = (Array.isArray(b.milestones) ? b.milestones : String(b.milestones || "").split("\n")).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 6).map((x) => x.slice(0, 200));
    if (!ms.length) throw E.bad("أضف مرحلة واحدة على الأقل لخطة التنفيذ");
    return { title, plan, amount, ms };
  }
  async function applyFund(user, rid, b = {}) {
    if (!rl.hit("default", "fapp:" + user.id)) throw E.rate();
    const v = await roundView(user, rid);
    if (!v.me.canApply) throw fail(v.me.application ? 409 : 403, v.me.verified ? "round_closed" : "not_verified", v.me.application ? "قدّمت على هذه الجولة بالفعل" : v.me.why);
    const r = await roundOf(rid), f = appFields(b, r), t = iso(), aid = id("fap");
    await db.run("INSERT INTO fund_applications(id,round_id,user_id,title,plan,amount,milestones,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'submitted',$8,$8)", [aid, rid, user.id, f.title, f.plan, f.amount, JSON.stringify(f.ms), t]);
    return roundView(user, rid);
  }
  async function editFund(user, aid, b = {}) {
    const a = await db.get("SELECT * FROM fund_applications WHERE id=$1 AND user_id=$2", [aid, user.id]); if (!a) throw E.nf();
    const r = await roundOf(a.round_id);
    if (b.withdraw) { if (!["submitted", "shortlisted"].includes(a.status)) throw E.conflict("لا يمكن سحب طلب تم البت فيه"); await db.run("UPDATE fund_applications SET status='withdrawn', updated_at=$1 WHERE id=$2", [iso(), aid]); return roundView(user, a.round_id); }
    if (a.status !== "submitted" || roundPhase(r) !== "open") throw E.conflict("لا يمكن تعديل الطلب الآن");
    const f = appFields({ title: a.title, plan: a.plan, amount: pi(a.amount), milestones: parse(a.milestones, []), ...b }, r);
    await db.run("UPDATE fund_applications SET title=$1, plan=$2, amount=$3, milestones=$4, updated_at=$5 WHERE id=$6", [f.title, f.plan, f.amount, JSON.stringify(f.ms), iso(), aid]);
    return roundView(user, a.round_id);
  }
  async function grantView(viewer, aid) {
    const a = await db.get("SELECT a.*, r.title rtitle, r.status rstatus FROM fund_applications a JOIN fund_rounds r ON r.id=a.round_id WHERE a.id=$1", [aid]); if (!a) throw E.nf();
    const own = viewer?.id === a.user_id, staff = viewer?.role === "admin";
    if (!own && !staff && !(a.status === "approved" && ["review", "closed"].includes(a.rstatus))) throw E.nf();
    const ups = await db.all("SELECT * FROM fund_updates WHERE application_id=$1 ORDER BY created_at DESC LIMIT 50", [aid]);
    const us = await usersOf([a.user_id]);
    return { grant: { ...faClient(a, us, { staff }), round: { id: a.round_id, title: a.rtitle } }, updates: ups.map((u) => ({ id: u.id, body: u.body, at: u.created_at })), me: { own, canUpdate: own && a.status === "approved", canReport: !!viewer && !own, reasons: REPORT_REASONS }, piEnabled: piOn() };
  }
  async function postUpdate(user, aid, b = {}) {
    if (!rl.hit("default", "fupd:" + user.id)) throw E.rate();
    const a = await db.get("SELECT * FROM fund_applications WHERE id=$1 AND user_id=$2", [aid, user.id]); if (!a) throw E.nf();
    if (a.status !== "approved") throw E.conflict("التحديثات للمنح المقبولة فقط");
    const body = str(b.body, 2000, { required: true, min: 10 });
    await db.run("INSERT INTO fund_updates(id,application_id,user_id,body,created_at) VALUES($1,$2,$3,$4,$5)", [id("fup"), aid, user.id, body, iso()]);
    return grantView(user, aid);
  }
  async function reportGrant(user, aid, b = {}) {
    if (!rl.hit("report", "freport:" + user.id)) throw E.rate();
    const a = await db.get("SELECT * FROM fund_applications WHERE id=$1 AND status='approved'", [aid]); if (!a) throw E.nf();
    if (a.user_id === user.id) throw E.bad("لا يمكنك الإبلاغ عن منحتك");
    const reason = oneOf(b.reason, Object.keys(REPORT_REASONS), null); if (!reason) throw E.bad("اختر سبب البلاغ");
    const r = await db.run("INSERT INTO fund_reports(id,application_id,by_user,reason,note,status,created_at) VALUES($1,$2,$3,$4,$5,'open',$6) ON CONFLICT DO NOTHING", [id("frp"), aid, user.id, reason, str(b.note, 600), iso()]);
    if (!r.changes) throw E.conflict("سبق أن أبلغت عن هذه المنحة");
    return { ok: true };
  }

  /* ---------- 6. money (Pi on only) ---------- */
  async function donate(user, b = {}) {
    if (!rl.hit("default", "fdon:" + user.id)) throw E.rate();
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "التبرّع غير متاح لمن هم دون ١٨ سنة");
    if (!piOn()) throw E.off(PI_OFF);
    const amount = amountIn(b.amount, 10000); if (!amount) throw E.bad("المبلغ بين 0.01 و10000 Pi");
    const did = id("fdn");
    await db.run("INSERT INTO fund_donations(id,user_id,amount,anonymous,status,created_at) VALUES($1,$2,$3,$4,'pending',$5)", [did, user.id, amount, b.anonymous ? 1 : 0, iso()]);
    try { const it = await ctx.services.pi.createIntent(user, { amount: pi(amount), memo: "تبرّع لصندوق دعم الصنّاع", purpose: "fund", refId: did }); await db.run("UPDATE fund_donations SET intent_id=$1 WHERE id=$2", [it.id, did]); return { donation: { id: did, amount: pi(amount) }, intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata } }; }
    catch (e) { await db.run("DELETE FROM fund_donations WHERE id=$1", [did]); throw e; }
  }
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "fund") return;
    const d = await db.get("SELECT * FROM fund_donations WHERE intent_id=$1", [e.tx]); if (!d) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(d.amount)) > 1) { ctx.log?.warn?.("fund donation amount mismatch", { donation: d.id }); return; }
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE fund_donations SET status='completed', completed_at=$1 WHERE id=$2 AND status='pending'", [iso(), d.id]); if (!r.changes) return;
      await postJournal(tx, { ikey: `fund:${d.id}:donation`, kind: "fund_donation", source: "fund", refId: d.id, senderId: d.user_id, anonymous: Number(d.anonymous), piTx: e.tx, lines: FUND.donate(Number(d.amount), d.user_id) });
    });
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "fund") await db.run("UPDATE fund_donations SET status='cancelled' WHERE intent_id=$1 AND status='pending'", [e.tx]); }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => {
    if (e.purpose !== "fund") return;
    const d = await db.get("SELECT * FROM fund_donations WHERE intent_id=$1 AND status='completed'", [e.tx]); if (!d) return;
    await db.tx(async (tx) => { const r = await tx.run("UPDATE fund_donations SET status='refunded' WHERE id=$1 AND status='completed'", [d.id]); if (r.changes) await reverseAll(tx, d.id, "fund donation refunded"); });
  }));
  async function fundPool(by, b = {}) {
    if (!piOn()) throw E.off(PI_OFF);
    const amount = amountIn(b.amount, 1e6); if (!amount) throw E.bad("مبلغ غير صالح");
    const memo = str(b.memo, 200, { required: true, min: 3 }), ref = id("ffd");
    await db.tx(async (tx) => postJournal(tx, { ikey: `fund:${ref}:fund`, kind: "fund_funding", source: "fund", refId: ref, memo, lines: FUND.fund(amount) }));
    ctx.audit?.("fund_funded", ref, `${pi(amount)} π · ${memo}`, by.id);
    return { ok: true, pool: pi(await balance(db, ACC.fundPool)) };
  }
  async function reserve(tx, a) {
    const pool = await balance(tx, ACC.fundPool); if (pool < Number(a.award)) return false;
    const r = await tx.run("UPDATE fund_applications SET pay_status='reserved', updated_at=$1 WHERE id=$2 AND pay_status IN ('none','awaiting_pi')", [iso(), a.id]); if (!r.changes) return false;
    await postJournal(tx, { ikey: `fund:${a.id}:reserve`, kind: "fund_grant", source: "fund", refId: a.id, creatorId: a.user_id, lines: FUND.reserve(Number(a.award), a.user_id) });
    return true;
  }
  async function payout(by, aid, b = {}) {
    if (!piOn()) throw E.off(PI_OFF);
    const a = await db.get("SELECT * FROM fund_applications WHERE id=$1 AND status='approved'", [aid]); if (!a) throw E.nf();
    if (a.pay_status === "paid") throw E.conflict("صُرفت هذه المنحة");
    const txid = str(b.txid, 120, { required: true, min: 8 });
    const done = await db.tx(async (tx) => {
      if (a.pay_status !== "reserved" && !(await reserve(tx, a))) return "funds";
      const r = await tx.run("UPDATE fund_applications SET pay_status='paid', payout_tx=$1, paid_at=$2, updated_at=$2 WHERE id=$3 AND pay_status='reserved'", [txid, iso(), aid]); if (!r.changes) return "race";
      await postJournal(tx, { ikey: `fund:${aid}:payout`, kind: "fund_payout", source: "fund", refId: aid, creatorId: a.user_id, piTx: txid, lines: FUND.payout(Number(a.award), a.user_id) });
      return "ok";
    });
    if (done === "funds") throw fail(409, "insufficient_pool", "رصيد الصندوق لا يكفي لهذه المنحة؛ موّل الصندوق أولاً");
    if (done !== "ok") throw E.conflict("تعذّر الصرف؛ حدّث الصفحة");
    await notify(a.user_id, "fund_paid", aid, by.id);
    ctx.audit?.("fund_paid", aid, `${pi(a.award)} π · ${txid}`, by.id);
    return { ok: true };
  }

  /* ---------- staff ---------- */
  function roundFields(b, prev) {
    const title = str(b.title ?? prev?.title, 140, { required: true, min: 6 }), descr = str(b.descr ?? prev?.descr, 3000, { required: true, min: 20 });
    const criteria = str(b.criteria ?? prev?.criteria ?? undefined, 2000);
    const cats = (Array.isArray(b.categories) ? b.categories : b.categories !== undefined ? String(b.categories || "").split(",") : parse(prev?.categories, [])).map((x) => String(x).trim()).filter((x) => CATEGORIES[x]);
    const budget = b.budget !== undefined ? amountIn(b.budget, 1e6) : Number(prev?.budget || 0); if (!budget) throw E.bad("حدّد ميزانية الجولة");
    const maxGrant = b.maxGrant !== undefined ? amountIn(b.maxGrant, 1e6) : Number(prev?.max_grant || 0); if (!maxGrant || maxGrant > budget) throw E.bad("الحد الأقصى للمنحة يجب أن يكون أقل من الميزانية أو مساوياً لها");
    const opens = Date.parse(b.opensAt ?? prev?.opens_at), closes = Date.parse(b.closesAt ?? prev?.closes_at);
    if (!Number.isFinite(opens) || !Number.isFinite(closes) || closes <= opens) throw E.bad("حدّد فترة تقديم صحيحة");
    return { title, descr, criteria, cats: [...new Set(cats)], budget, maxGrant, opens: iso(opens), closes: iso(closes) };
  }
  async function saveRound(by, rid, b = {}) {
    const prev = rid ? await roundOf(rid) : null; if (rid && !prev) throw E.nf();
    if (prev && prev.status === "closed") throw E.conflict("الجولة مغلقة");
    const f = roundFields(b, prev), t = iso();
    if (prev) await db.run("UPDATE fund_rounds SET title=$1, descr=$2, criteria=$3, categories=$4, budget=$5, max_grant=$6, opens_at=$7, closes_at=$8, updated_at=$9 WHERE id=$10", [f.title, f.descr, f.criteria, JSON.stringify(f.cats), f.budget, f.maxGrant, f.opens, f.closes, t, rid]);
    else { rid = id("frd"); await db.run("INSERT INTO fund_rounds(id,title,descr,criteria,categories,budget,max_grant,opens_at,closes_at,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$11)", [rid, f.title, f.descr, f.criteria, JSON.stringify(f.cats), f.budget, f.maxGrant, f.opens, f.closes, by.id, t]); }
    ctx.audit?.(prev ? "fund_round_edited" : "fund_round_created", rid, f.title, by.id);
    return { round: await roundClient(await roundOf(rid)) };
  }
  async function roundStatus(by, rid, b = {}) {
    const r = await roundOf(rid); if (!r) throw E.nf();
    const to = oneOf(b.status, ["open", "review", "closed"], null); if (!to) throw E.bad();
    const ok = { draft: ["open"], open: ["review"], review: ["closed", "open"], closed: [] }[r.status] || [];
    if (!ok.includes(to)) throw E.conflict("انتقال غير مسموح لحالة الجولة");
    await db.run("UPDATE fund_rounds SET status=$1, updated_at=$2 WHERE id=$3", [to, iso(), rid]);
    if (to === "open" && r.status === "draft") { const cats = parse(r.categories, []); for (const m of await db.all("SELECT user_id, category FROM vc_creators WHERE status='verified' LIMIT 5000")) if (!cats.length || cats.includes(m.category)) await notify(m.user_id, "fund_round", rid, by.id); }
    if (to === "closed") for (const a of await db.all("SELECT id, user_id FROM fund_applications WHERE round_id=$1 AND status IN ('submitted','shortlisted')", [rid])) { await db.run("UPDATE fund_applications SET status='rejected', reason=COALESCE(reason,'أُغلقت الجولة دون قبول الطلب'), decided_at=$1, updated_at=$1 WHERE id=$2", [iso(), a.id]); await notify(a.user_id, "fund_decision", a.id, by.id); }
    ctx.audit?.("fund_round_" + to, rid, r.title, by.id);
    return { round: await roundClient(await roundOf(rid)) };
  }
  async function decideFund(by, aid, b = {}) {
    const a = await db.get("SELECT * FROM fund_applications WHERE id=$1", [aid]); if (!a) throw E.nf();
    const r = await roundOf(a.round_id);
    const action = oneOf(b.action, ["shortlist", "approve", "reject"], null); if (!action) throw E.bad();
    if (!["submitted", "shortlisted"].includes(a.status)) throw E.conflict("تم البت في هذا الطلب");
    if (r.status === "draft" || r.status === "closed") throw E.conflict("لا يمكن البت في طلبات هذه الجولة الآن");
    const score = b.score === undefined || b.score === null || b.score === "" ? null : Math.max(0, Math.min(100, Math.round(Number(b.score) || 0)));
    const note = str(b.note, 1000), t = iso(); let awardU = 0;
    if (action === "shortlist") { await db.run("UPDATE fund_applications SET status='shortlisted', score=COALESCE($1,score), note=COALESCE($2,note), updated_at=$3 WHERE id=$4", [score, note, t, aid]); return adminRound(by, a.round_id); }
    if (action === "reject") {
      const reason = str(b.reason, 600, { required: true, min: 3 });
      await db.run("UPDATE fund_applications SET status='rejected', reason=$1, score=COALESCE($2,score), note=COALESCE($3,note), decided_by=$4, decided_at=$5, updated_at=$5 WHERE id=$6", [reason, score, note, by.id, t, aid]);
    } else {
      const award = b.award !== undefined && b.award !== "" ? amountIn(b.award) : Number(a.amount); if (!award) throw E.bad("مبلغ المنحة غير صالح"); awardU = award;
      if (award > Number(a.amount)) throw E.bad("المنحة لا تتجاوز المبلغ المطلوب");
      if ((await awardedOf(r.id)) + award > Number(r.budget)) throw fail(409, "over_budget", "مجموع المنح يتجاوز ميزانية الجولة");
      if ((await memberOf(a.user_id))?.status !== "verified") throw E.conflict("صاحب الطلب لم يعد صانعاً موثّقاً");
      await db.run("UPDATE fund_applications SET status='approved', award=$1, reason=$2, score=COALESCE($3,score), note=COALESCE($4,note), pay_status=$5, decided_by=$6, decided_at=$7, updated_at=$7 WHERE id=$8", [award, str(b.reason, 600), score, note, piOn() ? "none" : "awaiting_pi", by.id, t, aid]);
      if (piOn()) await db.tx(async (tx) => reserve(tx, { ...a, award }));
    }
    await notify(a.user_id, "fund_decision", aid, by.id);
    ctx.audit?.("fund_" + action, aid, `${a.title}${action === "approve" ? " · " + pi(awardU) + " π" : ""}`, by.id);
    return adminRound(by, a.round_id);
  }
  async function adminView() {
    const apps = await db.all("SELECT * FROM vc_applications WHERE status='pending' ORDER BY created_at LIMIT 100");
    const members = await db.all("SELECT * FROM vc_creators ORDER BY CASE status WHEN 'verified' THEN 0 ELSE 1 END, updated_at DESC LIMIT 300");
    const rounds = await db.all("SELECT * FROM fund_rounds ORDER BY created_at DESC LIMIT 50");
    const reports = await db.all("SELECT * FROM fund_reports WHERE status='open' ORDER BY created_at LIMIT 100");
    const due = await db.all("SELECT * FROM fund_applications WHERE status='approved' AND pay_status<>'paid' ORDER BY decided_at LIMIT 100");
    const us = await usersOf([...apps.map((a) => a.user_id), ...members.map((m) => m.user_id), ...due.map((a) => a.user_id), ...reports.map((r) => r.by_user)]);
    const rs = []; for (const r of rounds) rs.push(await roundClient(r));
    return {
      totals: { pending: apps.length, verified: members.filter((m) => m.status === "verified").length, rounds: rounds.length, reports: reports.length, pool: pi(await balance(db, ACC.fundPool)), due: pi(due.reduce((s, a) => s + Number(a.award), 0)) },
      applications: apps.map((a) => ({ ...appClient(a), checks: parse(a.checks, []), user: userPub(us.find((u) => u.id === a.user_id)) })),
      members: members.map((m) => ({ ...memberClient(m), user: userPub(us.find((u) => u.id === m.user_id)), reason: m.reason || null })),
      rounds: rs, payouts: due.map((a) => faClient(a, us, { staff: true })), reports: reports.map((r) => ({ id: r.id, grantId: r.application_id, reason: REPORT_REASONS[r.reason] || r.reason, note: r.note || "", at: r.created_at, by: userPub(us.find((u) => u.id === r.by_user)) })),
      categories: CATEGORIES, piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF
    };
  }
  async function adminRound(_by, rid) {
    const r = await roundOf(rid); if (!r) throw E.nf();
    const apps = await db.all("SELECT * FROM fund_applications WHERE round_id=$1 ORDER BY CASE status WHEN 'shortlisted' THEN 0 WHEN 'submitted' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, score DESC, created_at", [rid]);
    const us = await usersOf(apps.map((a) => a.user_id));
    return { round: await roundClient(r, { remaining: pi(Number(r.budget) - (await awardedOf(rid))) }), applications: apps.map((a) => faClient(a, us, { staff: true })), piEnabled: piOn() };
  }
  async function closeReport(by, rid, b = {}) {
    const ch = await db.run("UPDATE fund_reports SET status=$1, decided_at=$2 WHERE id=$3 AND status='open'", [b.action === "action" ? "actioned" : "dismissed", iso(), rid]);
    if (!ch.changes) throw E.nf(); ctx.audit?.("fund_report_" + (b.action === "action" ? "actioned" : "dismissed"), rid, "", by.id); return { ok: true };
  }

  /* ---------- renewal job ---------- */
  async function tick() {
    const t = clock(); let reminded = 0, lapsed = 0;
    for (const m of await db.all("SELECT * FROM vc_creators WHERE status='verified' AND reminded=0 AND until <= $1", [iso(t + 30 * DAY)])) {
      const ch = await db.run("UPDATE vc_creators SET reminded=1 WHERE user_id=$1 AND reminded=0", [m.user_id]); if (!ch.changes) continue;
      await notify(m.user_id, "vc_renew", m.user_id); reminded++;
    }
    for (const m of await db.all("SELECT * FROM vc_creators WHERE status='verified' AND until <= $1", [iso(t)])) {
      const ch = await db.run("UPDATE vc_creators SET status='lapsed', updated_at=$1 WHERE user_id=$2 AND status='verified'", [iso(t), m.user_id]); if (!ch.changes) continue;
      await dropBadge(m); await notify(m.user_id, "vc_renew", m.user_id); lapsed++;
    }
    return { reminded, lapsed };
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("vcreators.tick", +(env.VC_TICK_INTERVAL_MS || 6 * 3600e3), () => tick());

  /* ---------- routes ---------- */
  R.get("/api/creator-program", async (req) => program(req.user || null));
  R.post("/api/creator-program/apply", A(async (req) => apply(req.user, req.body || {})));
  R.post("/api/creator-program/withdraw", A(async (req) => withdraw(req.user)));
  R.post("/api/creator-program/renew", A(async (req) => renew(req.user)));
  R.get("/api/creator-program/directory", async (req) => directory(req.query || {}));
  R.get("/api/creator-program/badge/:handle", async (req) => badgeOf(req.params.handle));
  R.get("/api/fund", async (req) => fundOverview(req.user || null));
  R.post("/api/fund/donate", A(async (req) => donate(req.user, req.body || {})));
  R.get("/api/fund/rounds/:id", async (req) => roundView(req.user || null, req.params.id));
  R.post("/api/fund/rounds/:id/apply", A(async (req) => applyFund(req.user, req.params.id, req.body || {})));
  R.put("/api/fund/applications/:id", A(async (req) => editFund(req.user, req.params.id, req.body || {})));
  R.get("/api/fund/grants/:id", async (req) => grantView(req.user || null, req.params.id));
  R.post("/api/fund/grants/:id/updates", A(async (req) => postUpdate(req.user, req.params.id, req.body || {})));
  R.post("/api/fund/grants/:id/report", A(async (req) => reportGrant(req.user, req.params.id, req.body || {})));
  R.get("/api/admin/creator-program", admin(async () => adminView()));
  R.post("/api/admin/creator-program/applications/:id/approve", admin(async (req) => decide(req.user, req.params.id, true, req.body || {})));
  R.post("/api/admin/creator-program/applications/:id/reject", admin(async (req) => decide(req.user, req.params.id, false, req.body || {})));
  R.post("/api/admin/creator-program/members/:uid/revoke", admin(async (req) => revoke(req.user, req.params.uid, req.body || {})));
  R.post("/api/admin/creator-program/members/:uid/restore", admin(async (req) => restore(req.user, req.params.uid)));
  R.post("/api/admin/fund/rounds", admin(async (req) => saveRound(req.user, null, req.body || {})));
  R.put("/api/admin/fund/rounds/:id", admin(async (req) => saveRound(req.user, req.params.id, req.body || {})));
  R.get("/api/admin/fund/rounds/:id", admin(async (req) => adminRound(req.user, req.params.id)));
  R.post("/api/admin/fund/rounds/:id/status", admin(async (req) => roundStatus(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/fund/applications/:id/decide", admin(async (req) => decideFund(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/fund/applications/:id/payout", admin(async (req) => payout(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/fund/pool", admin(async (req) => fundPool(req.user, req.body || {})));
  R.post("/api/admin/fund/reports/:id", admin(async (req) => closeReport(req.user, req.params.id, req.body || {})));

  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  return { checks, program, directory, tick, settle, CATEGORIES };
};
