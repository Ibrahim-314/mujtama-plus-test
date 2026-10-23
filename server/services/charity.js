/* Volunteering, registered charities and transparent campaigns «تطوّع وجمعيات وحملات خيرية شفافة» (phase 70). No keys.
 *  1. Organisations: an adult member registers a charity / association / initiative / volunteer team with its registry and
 *     licence number, contact and description → staff verify (or reject / suspend, audited). Only verified organisations
 *     publish opportunities and campaigns; their owner adds editors by handle (adults).
 *  2. Volunteering: opportunities (place or online, dates, slots, expected hours, skills, whether guardian-linked minors may
 *     join). Members sign up with a note → the organisation accepts / declines → after the end it confirms attended hours
 *     (or no-show). Confirmed hours add up on «تطوّعي» and issue a signed volunteer certificate (phase 73 certificates,
 *     kind `volunteer`). Minors: only opportunities marked for minors, only with an active guardian link; the guardian is
 *     notified of every step.
 *  3. Campaigns: a verified organisation writes a campaign (story, beneficiaries, category, goal in Pi, dates) → staff review
 *     → live → ends at its end date (job) or when staff end it; staff may pause. Transparency on every campaign page: goal,
 *     raised (ledger), donors, disbursed to the organisation (each transfer with its Pi txid), spending reported by the
 *     organisation (amount + receipt link per item), and what is still unreported; news updates; the organisation's
 *     registry and licence. Reports on a campaign or an organisation go to staff; CHARITY_FLAG_REPORTS (3) open reports
 *     flag a live campaign «قيد المراجعة» and stop donations until staff decide.
 *  4. Money (existing ledger, lib/ledger.js CHARITY journals): donation user pi_out → charity:<id>:raised (Pi purpose
 *     `charity`), staff disbursement raised → platform:payouts recorded with the Pi txid (no A2U). Both need Pi payments on
 *     (PI_ENABLED + PI_API_KEY); while they are off (production today) they answer 501 not_configured with an Arabic notice.
 *     Refunded donations are reversed.
 *  5. Minors (phase 35): read campaigns and organisations; never donate, never register an organisation or manage one;
 *     volunteer only as in 2. */
const { E, str, oneOf, id } = require("../lib/core");
const { pi, toUnits, createLedger, ACC, CHARITY, balance } = require("../lib/ledger");

const KINDS = { charity: "جمعية خيرية", association: "جمعية أهلية", initiative: "مبادرة مجتمعية", team: "فريق تطوعي" };
const CATS = { relief: "إغاثة", food: "سلال غذائية", health: "صحة وعلاج", education: "تعليم", orphans: "رعاية أيتام", water: "سقيا ماء", housing: "إسكان", environment: "بيئة", disability: "ذوو الإعاقة", other: "أخرى" };
const ORG_STATUS = { pending: "قيد التحقق", verified: "موثّقة", rejected: "مرفوضة", suspended: "موقوفة" };
const CAMP_STATUS = { draft: "مسودة", review: "قيد المراجعة", live: "قائمة", paused: "متوقفة مؤقتاً", ended: "منتهية", rejected: "مرفوضة" };
const SIGN_STATUS = { applied: "بانتظار الرد", accepted: "مقبول", declined: "معتذر عنه", withdrawn: "منسحب", attended: "حضر", no_show: "لم يحضر" };
const REPORT_REASONS = { fraud: "احتيال أو جمع أموال مشبوه", misleading: "معلومات مضللة", unregistered: "جهة غير مرخّصة", misuse: "صرف لا يطابق الحملة", other: "سبب آخر" };
const DAY = 864e5;
const PI_OFF = "مدفوعات Pi غير مفعّلة بعد — التبرّع للحملات وتحويل المبالغ للجمعيات متوقفان حتى تفعيلها";

/** @param {any} ctx @param {{ now?: () => number, jobs?: boolean, env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const FLAG_AT = +(env.CHARITY_FLAG_REPORTS || 3);
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const guardiansOf = async (minorId) => (await db.all("SELECT guardian_id FROM guardian_links WHERE minor_id=$1 AND status='active'", [minorId]).catch(() => [])).map((r) => r.guardian_id);
  const piOn = () => !!ctx.services.pi?.enabled?.();
  const { postJournal, reverseAll } = createLedger({ now: () => iso() });
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => ctx.log?.error?.("charity handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : E.bad(msg), { code });
  const userPub = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null } : null);
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; return a.length ? db.all(`SELECT id, name, handle, color, avatar, status FROM users WHERE id IN (${ph(a)})`, a) : []; }
  const n = async (sql, a = []) => Number((await db.get(sql, a))?.n || 0);
  const url = (v) => { const s = String(v || "").trim(); if (!s) return null; try { const x = new URL(s); if (!["https:", "http:"].includes(x.protocol)) throw 0; return x.toString().slice(0, 300); } catch { throw E.bad("رابط غير صالح"); } };
  const amountIn = (v, max = 1e6) => { const x = Number(v); if (!(Number.isFinite(x) && x > 0 && x <= max)) return null; return toUnits(Math.round(x * 100) / 100); };
  const when = (v, name) => { const t = Date.parse(v); if (!Number.isFinite(t)) throw E.bad(`حدّد ${name}`); return t; };

  /* ---------- 1. organisations ---------- */
  const orgOf = (oid) => db.get("SELECT * FROM charity_orgs WHERE id=$1", [oid]);
  const roleIn = async (oid, uid) => (uid ? (await db.get("SELECT role FROM charity_org_members WHERE org_id=$1 AND user_id=$2", [oid, uid]))?.role || null : null);
  const orgClient = (o, extra = {}) => ({ id: o.id, name: o.name, kind: { key: o.kind, label: KINDS[o.kind] || o.kind }, country: o.country || "", city: o.city || "", registry: o.registry || "", licenseNo: o.license_no || "", website: o.website || null, email: o.email || null, descr: o.descr, status: o.status, statusLabel: ORG_STATUS[o.status], verified: o.status === "verified", verifiedAt: o.verified_at || null, createdAt: o.created_at, ...extra });
  async function manageable(user, oid) {
    const o = await orgOf(oid); if (!o) throw E.nf();
    const r = await roleIn(oid, user.id); if (!r && user.role !== "admin") throw E.forbid("لإدارة الجهة فقط");
    return { o, role: r || "staff" };
  }
  function orgFields(b, prev) {
    const name = str(b.name ?? prev?.name, 120, { required: true, min: 3 }), descr = str(b.descr ?? prev?.descr, 3000, { required: true, min: 30 });
    const kind = oneOf(b.kind ?? prev?.kind, Object.keys(KINDS), null); if (!kind) throw E.bad("اختر نوع الجهة");
    const registry = str(b.registry ?? prev?.registry, 160, { required: true, min: 3 }), license = str(b.licenseNo ?? prev?.license_no, 60, { required: true, min: 2 });
    const email = str(b.email ?? prev?.email ?? undefined, 120); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw E.bad("بريد غير صالح");
    return { name, descr, kind, registry, license, email, country: str(b.country ?? prev?.country ?? undefined, 60), city: str(b.city ?? prev?.city ?? undefined, 60), website: b.website !== undefined ? url(b.website) : prev?.website || null };
  }
  async function registerOrg(user, b = {}) {
    if (!rl.hit("default", "corg:" + user.id)) throw E.rate();
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "تسجيل الجهات متاح لمن هم ١٨ سنة فأكثر");
    if (await db.get("SELECT 1 x FROM charity_orgs WHERE owner_id=$1 AND status='pending'", [user.id])) throw E.conflict("لديك جهة قيد التحقق");
    const f = orgFields(b), oid = id("cor"), t = iso();
    await db.run("INSERT INTO charity_orgs(id,owner_id,name,kind,country,city,registry,license_no,website,email,descr,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$12)", [oid, user.id, f.name, f.kind, f.country, f.city, f.registry, f.license, f.website, f.email, f.descr, t]);
    await db.run("INSERT INTO charity_org_members(org_id,user_id,role,created_at) VALUES($1,$2,'owner',$3)", [oid, user.id, t]);
    return orgView(user, oid);
  }
  async function editOrg(user, oid, b = {}) {
    const { o } = await manageable(user, oid);
    if (o.status === "suspended") throw E.forbid("الجهة موقوفة من فريق المنصة");
    const f = orgFields(b, o);
    // changing registry / licence of a verified organisation sends it back to verification
    const recheck = o.status === "verified" && (f.registry !== o.registry || f.license !== o.license_no);
    await db.run("UPDATE charity_orgs SET name=$1, kind=$2, country=$3, city=$4, registry=$5, license_no=$6, website=$7, email=$8, descr=$9, status=$10, updated_at=$11 WHERE id=$12", [f.name, f.kind, f.country, f.city, f.registry, f.license, f.website, f.email, f.descr, recheck || o.status === "rejected" ? "pending" : o.status, iso(), oid]);
    return orgView(user, oid);
  }
  async function addMember(user, oid, b = {}) {
    const { o, role } = await manageable(user, oid); if (role !== "owner" && role !== "staff") throw E.forbid("لمالك الجهة فقط");
    const u = await db.get("SELECT id, status FROM users WHERE LOWER(handle)=LOWER($1)", [String(b.handle || "").replace(/^@/, "")]); if (!u || u.status !== "active") throw E.nf("الحساب غير موجود");
    if (await isMinor(u.id)) throw fail(403, "minor_restricted", "لا يمكن إضافة من هم دون ١٨ سنة لإدارة جهة");
    if (b.remove) { if (u.id === o.owner_id) throw E.bad("لا يمكن إزالة المالك"); await db.run("DELETE FROM charity_org_members WHERE org_id=$1 AND user_id=$2", [oid, u.id]); }
    else await db.run("INSERT INTO charity_org_members(org_id,user_id,role,created_at) VALUES($1,$2,'editor',$3) ON CONFLICT DO NOTHING", [oid, u.id, iso()]);
    return orgView(user, oid);
  }
  async function orgView(viewer, oid) {
    const o = await orgOf(oid); if (!o) throw E.nf();
    const role = await roleIn(oid, viewer?.id), staff = viewer?.role === "admin";
    if (o.status !== "verified" && !role && !staff) throw E.nf();
    const camps = await db.all(`SELECT * FROM charity_campaigns WHERE org_id=$1 ${role || staff ? "" : "AND status IN ('live','ended','paused')"} ORDER BY created_at DESC LIMIT 50`, [oid]);
    const opps = role || staff ? await db.all("SELECT * FROM vol_opps WHERE org_id=$1 ORDER BY starts_at DESC LIMIT 50", [oid]) : await db.all("SELECT * FROM vol_opps WHERE org_id=$1 AND status='open' AND ends_at > $2 ORDER BY starts_at LIMIT 50", [oid, iso()]);
    const cs = []; for (const c of camps) cs.push(await campClient(c, o));
    const os = []; for (const p of opps) os.push(await oppClient(p, o));
    const out = { org: orgClient(o, role || staff ? { reason: o.reason || null } : {}), campaigns: cs, opportunities: os, me: { role, canManage: !!role || staff, canReport: !!viewer && !role }, kinds: KINDS, categories: CATS, reasons: REPORT_REASONS, piEnabled: piOn() };
    if (role || staff) {
      const ms = await db.all("SELECT * FROM charity_org_members WHERE org_id=$1 ORDER BY created_at", [oid]); const us = await usersOf(ms.map((m) => m.user_id));
      out.members = ms.map((m) => ({ role: m.role, user: userPub(us.find((u) => u.id === m.user_id)) }));
    }
    return out;
  }
  async function orgsList(viewer, q = {}) {
    const text = String(q.q || "").trim().toLowerCase().slice(0, 60);
    let rows = await db.all("SELECT * FROM charity_orgs WHERE status='verified' ORDER BY verified_at DESC LIMIT 300");
    if (text) rows = rows.filter((o) => [o.name, o.descr, o.city, o.country, KINDS[o.kind]].join(" ").toLowerCase().includes(text));
    const mine = viewer ? await db.all("SELECT o.*, m.role FROM charity_orgs o JOIN charity_org_members m ON m.org_id=o.id WHERE m.user_id=$1 ORDER BY o.created_at DESC", [viewer.id]) : [];
    const out = []; for (const o of rows.slice(0, 100)) out.push(orgClient(o, { campaigns: await n("SELECT COUNT(*) n FROM charity_campaigns WHERE org_id=$1 AND status IN ('live','ended')", [o.id]), opportunities: await n("SELECT COUNT(*) n FROM vol_opps WHERE org_id=$1 AND status='open'", [o.id]) }));
    return { orgs: out, mine: mine.map((o) => orgClient(o, { role: o.role, reason: o.reason || null })), kinds: KINDS, minor: viewer ? await isMinor(viewer.id) : false };
  }

  /* ---------- 3. campaigns ---------- */
  const campOf = (cid) => db.get("SELECT * FROM charity_campaigns WHERE id=$1", [cid]);
  async function money(cid) {
    const raised = await n("SELECT COALESCE(SUM(credit),0) n FROM ledger_entries WHERE account=$1", [ACC.campaign(cid)]) - await n("SELECT COALESCE(SUM(e.debit),0) n FROM ledger_entries e JOIN ledger_journals j ON j.id=e.journal_id WHERE e.account=$1 AND j.kind='reversal'", [ACC.campaign(cid)]);
    const bal = await balance(db, ACC.campaign(cid));
    const disbursed = await n("SELECT COALESCE(SUM(amount),0) n FROM charity_disbursements WHERE campaign_id=$1", [cid]);
    const spent = await n("SELECT COALESCE(SUM(amount),0) n FROM charity_updates WHERE campaign_id=$1 AND kind='spending'", [cid]);
    const donors = await n("SELECT COUNT(DISTINCT user_id) n FROM charity_donations WHERE campaign_id=$1 AND status='completed'", [cid]);
    return { raised, balance: bal, disbursed, spent, donors };
  }
  async function campClient(c, o, extra = {}) {
    const m = await money(c.id); const goal = Number(c.goal);
    const t = clock(), phase = c.status === "live" && t < Date.parse(c.starts_at) ? "soon" : c.status;
    return { id: c.id, title: c.title, story: c.story, category: { key: c.category, label: CATS[c.category] || c.category }, beneficiaries: c.beneficiaries || "", goal: pi(goal), startsAt: c.starts_at, endsAt: c.ends_at, status: c.status, statusLabel: CAMP_STATUS[c.status], phase, flagged: !!Number(c.flagged), reviewReason: c.review_reason || null, publishedAt: c.published_at || null,
      raised: pi(m.raised), balance: pi(m.balance), disbursed: pi(m.disbursed), spent: pi(m.spent), unreported: pi(Math.max(0, m.disbursed - m.spent)), donors: m.donors, percent: goal ? Math.min(100, Math.round((m.raised / goal) * 100)) : 0,
      org: o ? { id: o.id, name: o.name, verified: o.status === "verified", kind: KINDS[o.kind] || o.kind } : null, ...extra };
  }
  function campFields(b, prev) {
    const title = str(b.title ?? prev?.title, 140, { required: true, min: 8 }), story = str(b.story ?? prev?.story, 5000, { required: true, min: 80 });
    const category = oneOf(b.category ?? prev?.category, Object.keys(CATS), null); if (!category) throw E.bad("اختر تصنيف الحملة");
    const goal = b.goal !== undefined ? amountIn(b.goal) : Number(prev?.goal || 0); if (!goal) throw E.bad("حدّد هدف الحملة بـ Pi");
    const s = when(b.startsAt ?? prev?.starts_at, "تاريخ البداية"), e = when(b.endsAt ?? prev?.ends_at, "تاريخ النهاية");
    if (e <= s) throw E.bad("تاريخ النهاية بعد البداية"); if (e - s > 180 * DAY) throw E.bad("مدة الحملة ١٨٠ يوماً كحد أقصى");
    return { title, story, category, goal, s: iso(s), e: iso(e), beneficiaries: str(b.beneficiaries ?? prev?.beneficiaries ?? undefined, 600) };
  }
  async function createCampaign(user, oid, b = {}) {
    if (!rl.hit("default", "ccamp:" + user.id)) throw E.rate();
    const { o } = await manageable(user, oid); if (o.status !== "verified") throw fail(403, "org_unverified", "الحملات للجهات الموثّقة فقط");
    const f = campFields(b), cid = id("cmp"), t = iso();
    await db.run("INSERT INTO charity_campaigns(id,org_id,title,story,category,beneficiaries,goal,starts_at,ends_at,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$11)", [cid, oid, f.title, f.story, f.category, f.beneficiaries, f.goal, f.s, f.e, user.id, t]);
    return campaignView(user, cid);
  }
  async function editCampaign(user, cid, b = {}) {
    const c = await campOf(cid); if (!c) throw E.nf(); const { o } = await manageable(user, c.org_id);
    if (b.submit) { if (!["draft", "rejected"].includes(c.status)) throw E.conflict("الحملة ليست مسودة"); if (o.status !== "verified") throw fail(403, "org_unverified", "الحملات للجهات الموثّقة فقط"); await db.run("UPDATE charity_campaigns SET status='review', updated_at=$1 WHERE id=$2", [iso(), cid]); return campaignView(user, cid); }
    if (!["draft", "rejected"].includes(c.status)) throw E.conflict("لا تُعدَّل الحملة بعد إرسالها للمراجعة؛ انشر تحديثاً بدلاً من ذلك");
    const f = campFields(b, c);
    await db.run("UPDATE charity_campaigns SET title=$1, story=$2, category=$3, beneficiaries=$4, goal=$5, starts_at=$6, ends_at=$7, status='draft', updated_at=$8 WHERE id=$9", [f.title, f.story, f.category, f.beneficiaries, f.goal, f.s, f.e, iso(), cid]);
    return campaignView(user, cid);
  }
  async function campaignView(viewer, cid) {
    const c = await campOf(cid); if (!c) throw E.nf(); const o = await orgOf(c.org_id);
    const role = await roleIn(c.org_id, viewer?.id), staff = viewer?.role === "admin";
    if (!["live", "ended", "paused"].includes(c.status) && !role && !staff) throw E.nf();
    const ups = await db.all("SELECT * FROM charity_updates WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 100", [cid]);
    const ds = await db.all("SELECT * FROM charity_disbursements WHERE campaign_id=$1 ORDER BY created_at DESC", [cid]);
    const recent = await db.all("SELECT amount, anonymous, user_id, completed_at FROM charity_donations WHERE campaign_id=$1 AND status='completed' ORDER BY completed_at DESC LIMIT 12", [cid]);
    const us = await usersOf([...ups.map((u) => u.user_id), ...recent.filter((d) => !Number(d.anonymous)).map((d) => d.user_id)]);
    const minorSet = new Set(); for (const d of recent) if (!Number(d.anonymous) && (await isMinor(d.user_id))) minorSet.add(d.user_id);
    let canDonate = false, why = null;
    if (!viewer) why = "سجّل الدخول لتتبرّع";
    else if (await isMinor(viewer.id)) why = "التبرّع غير متاح لمن هم دون ١٨ سنة";
    else if (c.status !== "live" || clock() < Date.parse(c.starts_at) || clock() > Date.parse(c.ends_at)) why = "الحملة لا تستقبل تبرّعات الآن";
    else if (Number(c.flagged)) why = "الحملة قيد مراجعة فريق المنصة؛ التبرّعات متوقفة مؤقتاً";
    else if (!piOn()) why = PI_OFF;
    else canDonate = true;
    return { campaign: await campClient(c, o), org: orgClient(o), updates: ups.map((u) => ({ id: u.id, kind: u.kind, body: u.body, amount: pi(u.amount), receipt: u.receipt_url || null, at: u.created_at, by: userPub(us.find((x) => x.id === u.user_id)) })),
      disbursements: ds.map((d) => ({ amount: pi(d.amount), txid: d.txid, memo: d.memo || "", at: d.created_at })), donations: recent.map((d) => ({ amount: pi(d.amount), at: d.completed_at, by: Number(d.anonymous) || minorSet.has(d.user_id) ? null : userPub(us.find((x) => x.id === d.user_id)) })),
      me: { role, canManage: !!role || staff, canDonate, why, canReport: !!viewer && !role }, categories: CATS, reasons: REPORT_REASONS, piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF };
  }
  async function campaigns(viewer, q = {}) {
    const cat = CATS[q.category] ? q.category : null, text = String(q.q || "").trim().toLowerCase().slice(0, 60), st = q.status === "ended" ? "ended" : "live";
    let rows = await db.all("SELECT c.*, o.name oname, o.status ostatus, o.kind okind FROM charity_campaigns c JOIN charity_orgs o ON o.id=c.org_id WHERE c.status=$1 AND o.status='verified' ORDER BY c.published_at DESC LIMIT 300", [st]);
    const counts = {}; for (const r of rows) counts[r.category] = (counts[r.category] || 0) + 1;
    if (cat) rows = rows.filter((r) => r.category === cat);
    if (text) rows = rows.filter((r) => [r.title, r.story, r.oname].join(" ").toLowerCase().includes(text));
    const out = []; for (const r of rows.slice(0, 60)) out.push(await campClient(r, { id: r.org_id, name: r.oname, status: r.ostatus, kind: r.okind }));
    const totals = { live: await n("SELECT COUNT(*) n FROM charity_campaigns WHERE status='live'"), orgs: await n("SELECT COUNT(*) n FROM charity_orgs WHERE status='verified'"), opportunities: await n("SELECT COUNT(*) n FROM vol_opps WHERE status='open' AND ends_at > $1", [iso()]), raised: pi(await n("SELECT COALESCE(SUM(amount),0) n FROM charity_donations WHERE status='completed'")), hours: Number((await db.get("SELECT COALESCE(SUM(hours),0) n FROM vol_signups WHERE status='attended'"))?.n || 0) };
    return { campaigns: out, counts, categories: CATS, totals, piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF };
  }
  async function postUpdate(user, cid, b = {}) {
    if (!rl.hit("default", "cupd:" + user.id)) throw E.rate();
    const c = await campOf(cid); if (!c) throw E.nf(); await manageable(user, c.org_id);
    if (!["live", "paused", "ended"].includes(c.status)) throw E.conflict("التحديثات للحملات المنشورة");
    const kind = b.kind === "spending" ? "spending" : "update", body = str(b.body, 2000, { required: true, min: 10 });
    let amount = 0, receipt = null;
    if (kind === "spending") {
      amount = amountIn(b.amount); if (!amount) throw E.bad("حدّد المبلغ المصروف");
      receipt = url(b.receipt); if (!receipt) throw E.bad("أرفق رابط الإيصال أو الفاتورة");
      const m = await money(cid); if (m.spent + amount > m.raised) throw E.bad("المصروف المعلن يتجاوز ما جُمع للحملة");
    }
    await db.run("INSERT INTO charity_updates(id,campaign_id,user_id,kind,body,amount,receipt_url,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id("cup"), cid, user.id, kind, body, amount, receipt, iso()]);
    for (const d of await db.all("SELECT DISTINCT user_id FROM charity_donations WHERE campaign_id=$1 AND status='completed' LIMIT 2000", [cid])) await notify(d.user_id, "charity_update", cid, user.id);
    return campaignView(user, cid);
  }

  /* ---------- reports ---------- */
  async function report(user, type, tid, b = {}) {
    if (!rl.hit("report", "crep:" + user.id)) throw E.rate();
    const reason = oneOf(b.reason, Object.keys(REPORT_REASONS), null); if (!reason) throw E.bad("اختر سبب البلاغ");
    const target = type === "org" ? await orgOf(tid) : await campOf(tid); if (!target) throw E.nf();
    if (await roleIn(type === "org" ? tid : target.org_id, user.id)) throw E.bad("لا يمكنك الإبلاغ عن جهتك");
    const r = await db.run("INSERT INTO charity_reports(id,target_type,target_id,by_user,reason,note,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7) ON CONFLICT DO NOTHING", [id("crp"), type, tid, user.id, reason, str(b.note, 600), iso()]);
    if (!r.changes) throw E.conflict("سبق أن أبلغت عن هذا");
    if (type === "campaign" && (await n("SELECT COUNT(*) n FROM charity_reports WHERE target_id=$1 AND status='open'", [tid])) >= FLAG_AT) await db.run("UPDATE charity_campaigns SET flagged=1, updated_at=$1 WHERE id=$2 AND flagged=0", [iso(), tid]);
    return { ok: true };
  }

  /* ---------- 4. money (Pi on only) ---------- */
  async function donate(user, cid, b = {}) {
    if (!rl.hit("default", "cdon:" + user.id)) throw E.rate();
    const v = await campaignView(user, cid);
    if (!v.me.canDonate) { if (v.me.why === PI_OFF) throw E.off(PI_OFF); throw fail(v.me.why?.includes("دون ١٨") ? 403 : 409, v.me.why?.includes("دون ١٨") ? "minor_restricted" : "not_open", v.me.why); }
    const amount = amountIn(b.amount, 10000); if (!amount) throw E.bad("المبلغ بين 0.01 و10000 Pi");
    const did = id("cdn");
    await db.run("INSERT INTO charity_donations(id,campaign_id,user_id,amount,anonymous,status,created_at) VALUES($1,$2,$3,$4,$5,'pending',$6)", [did, cid, user.id, amount, b.anonymous ? 1 : 0, iso()]);
    try { const it = await ctx.services.pi.createIntent(user, { amount: pi(amount), memo: `تبرّع: ${v.campaign.title}`.slice(0, 200), purpose: "charity", refId: did }); await db.run("UPDATE charity_donations SET intent_id=$1 WHERE id=$2", [it.id, did]); return { donation: { id: did, amount: pi(amount) }, intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata } }; }
    catch (e) { await db.run("DELETE FROM charity_donations WHERE id=$1", [did]); throw e; }
  }
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "charity") return;
    const d = await db.get("SELECT * FROM charity_donations WHERE intent_id=$1", [e.tx]); if (!d) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(d.amount)) > 1) { ctx.log?.warn?.("charity donation amount mismatch", { donation: d.id }); return; }
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE charity_donations SET status='completed', completed_at=$1 WHERE id=$2 AND status='pending'", [iso(), d.id]); if (!r.changes) return;
      await postJournal(tx, { ikey: `charity:${d.id}:donation`, kind: "charity_donation", source: "charity", refId: d.id, senderId: d.user_id, anonymous: Number(d.anonymous), piTx: e.tx, lines: CHARITY.donate(Number(d.amount), d.user_id, d.campaign_id) });
    });
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "charity") await db.run("UPDATE charity_donations SET status='cancelled' WHERE intent_id=$1 AND status='pending'", [e.tx]); }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => {
    if (e.purpose !== "charity") return;
    const d = await db.get("SELECT * FROM charity_donations WHERE intent_id=$1 AND status='completed'", [e.tx]); if (!d) return;
    await db.tx(async (tx) => { const r = await tx.run("UPDATE charity_donations SET status='refunded' WHERE id=$1 AND status='completed'", [d.id]); if (r.changes) await reverseAll(tx, d.id, "charity donation refunded"); });
  }));
  async function disburse(by, cid, b = {}) {
    if (!piOn()) throw E.off(PI_OFF);
    const c = await campOf(cid); if (!c) throw E.nf();
    const amount = amountIn(b.amount); if (!amount) throw E.bad("مبلغ غير صالح");
    const txid = str(b.txid, 120, { required: true, min: 8 }), memo = str(b.memo, 200);
    const done = await db.tx(async (tx) => {
      if ((await balance(tx, ACC.campaign(cid))) < amount) return false;
      const did = id("cdb"); await tx.run("INSERT INTO charity_disbursements(id,campaign_id,amount,txid,memo,by_user,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [did, cid, amount, txid, memo, by.id, iso()]);
      await postJournal(tx, { ikey: `charity:${did}:disburse`, kind: "charity_disbursement", source: "charity", refId: did, piTx: txid, memo, lines: CHARITY.disburse(amount, cid) });
      return true;
    });
    if (!done) throw fail(409, "insufficient_balance", "رصيد الحملة لا يكفي لهذا التحويل");
    for (const m of await db.all("SELECT user_id FROM charity_org_members WHERE org_id=$1", [c.org_id])) await notify(m.user_id, "charity_review", cid, by.id);
    ctx.audit?.("charity_disbursed", cid, `${pi(amount)} π · ${txid}`, by.id);
    return campaignView(by, cid);
  }

  /* ---------- 2. volunteering ---------- */
  const oppOf = (pid) => db.get("SELECT * FROM vol_opps WHERE id=$1", [pid]);
  async function oppClient(p, o, extra = {}) {
    const taken = await n("SELECT COUNT(*) n FROM vol_signups WHERE opp_id=$1 AND status IN ('accepted','attended')", [p.id]);
    return { id: p.id, title: p.title, descr: p.descr, city: p.city || "", online: !!Number(p.online), startsAt: p.starts_at, endsAt: p.ends_at, slots: Number(p.slots), taken, left: Math.max(0, Number(p.slots) - taken), hours: Number(p.hours), skills: p.skills || "", minors: !!Number(p.minors), status: p.status, past: Date.parse(p.ends_at) < clock(),
      org: o ? { id: o.id, name: o.name, verified: o.status === "verified" } : null, ...extra };
  }
  function oppFields(b, prev) {
    const title = str(b.title ?? prev?.title, 140, { required: true, min: 6 }), descr = str(b.descr ?? prev?.descr, 3000, { required: true, min: 30 });
    const s = when(b.startsAt ?? prev?.starts_at, "موعد البداية"), e = when(b.endsAt ?? prev?.ends_at, "موعد النهاية"); if (e <= s) throw E.bad("النهاية بعد البداية");
    const slots = Math.round(Number(b.slots ?? prev?.slots ?? 10)); if (!(slots >= 1 && slots <= 1000)) throw E.bad("عدد المقاعد بين 1 و1000");
    const hours = Math.round(Number(b.hours ?? prev?.hours ?? 2) * 2) / 2; if (!(hours > 0 && hours <= 200)) throw E.bad("الساعات المتوقعة غير صالحة");
    const online = (b.online !== undefined ? !!b.online : !!Number(prev?.online)) ? 1 : 0, city = str(b.city ?? prev?.city ?? undefined, 60);
    if (!online && !city) throw E.bad("حدّد المدينة أو اجعلها عن بُعد");
    return { title, descr, s: iso(s), e: iso(e), slots, hours, online, city, skills: str(b.skills ?? prev?.skills ?? undefined, 200), minors: (b.minors !== undefined ? !!b.minors : !!Number(prev?.minors)) ? 1 : 0 };
  }
  async function createOpp(user, oid, b = {}) {
    if (!rl.hit("default", "copp:" + user.id)) throw E.rate();
    const { o } = await manageable(user, oid); if (o.status !== "verified") throw fail(403, "org_unverified", "فرص التطوّع للجهات الموثّقة فقط");
    const f = oppFields(b), pid = id("vop"), t = iso();
    await db.run("INSERT INTO vol_opps(id,org_id,title,descr,city,online,starts_at,ends_at,slots,hours,skills,minors,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open',$13,$14,$14)", [pid, oid, f.title, f.descr, f.city, f.online, f.s, f.e, f.slots, f.hours, f.skills, f.minors, user.id, t]);
    return oppView(user, pid);
  }
  async function editOpp(user, pid, b = {}) {
    const p = await oppOf(pid); if (!p) throw E.nf(); await manageable(user, p.org_id);
    if (b.status) { const st = oneOf(b.status, ["open", "closed", "cancelled"], null); if (!st) throw E.bad(); await db.run("UPDATE vol_opps SET status=$1, updated_at=$2 WHERE id=$3", [st, iso(), pid]);
      if (st === "cancelled") for (const s of await db.all("SELECT * FROM vol_signups WHERE opp_id=$1 AND status IN ('applied','accepted')", [pid])) { await db.run("UPDATE vol_signups SET status='declined', decided_at=$1 WHERE id=$2", [iso(), s.id]); await notify(s.user_id, "vol_decision", pid); }
      return oppView(user, pid); }
    const f = oppFields(b, p);
    await db.run("UPDATE vol_opps SET title=$1, descr=$2, city=$3, online=$4, starts_at=$5, ends_at=$6, slots=$7, hours=$8, skills=$9, minors=$10, updated_at=$11 WHERE id=$12", [f.title, f.descr, f.city, f.online, f.s, f.e, f.slots, f.hours, f.skills, f.minors, iso(), pid]);
    return oppView(user, pid);
  }
  const signClient = (s, us) => ({ id: s.id, status: s.status, statusLabel: SIGN_STATUS[s.status], note: s.note || "", hours: s.hours === null || s.hours === undefined ? null : Number(s.hours), minor: !!Number(s.minor), certCode: s.cert_code || null, createdAt: s.created_at, user: userPub(us.find((u) => u.id === s.user_id)) });
  async function oppView(viewer, pid) {
    const p = await oppOf(pid); if (!p) throw E.nf(); const o = await orgOf(p.org_id);
    const role = await roleIn(p.org_id, viewer?.id), staff = viewer?.role === "admin";
    if ((o.status !== "verified" || p.status === "cancelled") && !role && !staff) throw E.nf();
    const out = { opportunity: await oppClient(p, o), org: orgClient(o), me: { role, canManage: !!role || staff, signup: null, canSignUp: false, why: null } };
    if (viewer && !role) {
      const s = await db.get("SELECT * FROM vol_signups WHERE opp_id=$1 AND user_id=$2", [pid, viewer.id]);
      out.me.signup = s ? signClient(s, [viewer]) : null;
      out.me.why = await signBlock(viewer, p, out.opportunity); out.me.canSignUp = !out.me.why && (!s || s.status === "withdrawn");
    }
    if (role || staff) { const ss = await db.all("SELECT * FROM vol_signups WHERE opp_id=$1 ORDER BY CASE status WHEN 'applied' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, created_at", [pid]); const us = await usersOf(ss.map((s) => s.user_id)); out.signups = ss.map((s) => signClient(s, us)); }
    return out;
  }
  async function signBlock(user, p, oc) {
    // minors first: the age rule explains more than "closed" would
    if (await isMinor(user.id)) { if (!Number(p.minors)) return "هذه الفرصة لمن هم ١٨ سنة فأكثر"; if (!(await guardiansOf(user.id)).length) return "يلزم ربط حسابك بوليّ أمر (من «العائلة») قبل التسجيل"; }
    if (p.status !== "open") return "التسجيل مغلق";
    if (Date.parse(p.ends_at) < clock()) return "انتهت الفرصة";
    if (oc.left <= 0) return "اكتملت المقاعد";
    return null;
  }
  async function signUp(user, pid, b = {}) {
    if (!rl.hit("default", "vsign:" + user.id)) throw E.rate();
    const v = await oppView(user, pid); if (v.me.role) throw E.bad("أنت من إدارة الجهة");
    if (b.withdraw) { const ch = await db.run("UPDATE vol_signups SET status='withdrawn', decided_at=$1 WHERE opp_id=$2 AND user_id=$3 AND status IN ('applied','accepted')", [iso(), pid, user.id]); if (!ch.changes) throw E.nf(); return oppView(user, pid); }
    if (!v.me.canSignUp) { const minorWhy = /وليّ أمر|١٨ سنة فأكثر/.test(v.me.why || ""); throw fail(v.me.signup ? 409 : 403, minorWhy ? "minor_restricted" : "closed", v.me.signup && v.me.signup.status !== "withdrawn" ? "سجّلت في هذه الفرصة" : v.me.why); }
    const minor = await isMinor(user.id), note = str(b.note, 500), t = iso(), p = await oppOf(pid);
    const had = await db.get("SELECT id FROM vol_signups WHERE opp_id=$1 AND user_id=$2", [pid, user.id]);
    if (had) await db.run("UPDATE vol_signups SET status='applied', note=$1, created_at=$2, decided_at=NULL WHERE id=$3", [note, t, had.id]);
    else await db.run("INSERT INTO vol_signups(id,opp_id,user_id,note,status,minor,created_at) VALUES($1,$2,$3,$4,'applied',$5,$6)", [id("vsu"), pid, user.id, note, minor ? 1 : 0, t]);
    for (const m of await db.all("SELECT user_id FROM charity_org_members WHERE org_id=$1", [p.org_id])) await notify(m.user_id, "vol_signup", pid, user.id);
    if (minor) for (const g of await guardiansOf(user.id)) await notify(g, "charity_guardian", pid, user.id);
    return oppView(user, pid);
  }
  async function decideSignup(user, sid, b = {}) {
    const s = await db.get("SELECT * FROM vol_signups WHERE id=$1", [sid]); if (!s) throw E.nf();
    const p = await oppOf(s.opp_id); const { o } = await manageable(user, p.org_id);
    const action = oneOf(b.action, ["accept", "decline", "attended", "no_show"], null); if (!action) throw E.bad();
    const t = iso();
    if (action === "accept" || action === "decline") {
      if (s.status !== "applied" && !(action === "decline" && s.status === "accepted")) throw E.conflict("تمت معالجة هذا التسجيل");
      if (action === "accept" && (await oppClient(p, o)).left <= 0) throw E.conflict("اكتملت المقاعد");
      await db.run("UPDATE vol_signups SET status=$1, decided_at=$2 WHERE id=$3", [action === "accept" ? "accepted" : "declined", t, sid]);
      await notify(s.user_id, "vol_decision", p.id, user.id);
    } else {
      if (s.status !== "accepted") throw E.conflict("يُسجَّل الحضور للمقبولين فقط");
      if (Date.parse(p.starts_at) > clock()) throw E.conflict("يُسجَّل الحضور بعد بدء الفرصة");
      let hours = null;
      if (action === "attended") { hours = Math.round(Number(b.hours ?? p.hours) * 2) / 2; if (!(hours > 0 && hours <= 200)) throw E.bad("عدد الساعات غير صالح"); }
      await db.run("UPDATE vol_signups SET status=$1, hours=$2, decided_at=$3 WHERE id=$4", [action, hours, t, sid]);
      if (action === "attended") {
        try { const r = await ctx.services.certs?.issue?.("volunteer", sid, s.user_id, { title: p.title, issuer: o.name, issuerUser: user.id, details: { hours, organisation: o.name, date: p.starts_at.slice(0, 10), place: Number(p.online) ? "عن بُعد" : p.city || null } }); if (r?.cert?.code) await db.run("UPDATE vol_signups SET cert_code=$1 WHERE id=$2", [r.cert.code, sid]); } catch (e) { ctx.log?.warn?.("volunteer certificate not issued", { err: e.message }); }
        await notify(s.user_id, "vol_hours", p.id, user.id);
      }
    }
    if (Number(s.minor)) for (const g of await guardiansOf(s.user_id)) await notify(g, "charity_guardian", p.id, user.id);
    return oppView(user, p.id);
  }
  async function opportunities(viewer, q = {}) {
    const text = String(q.q || "").trim().toLowerCase().slice(0, 60), mode = oneOf(q.mode, ["online", "onsite"], null), city = String(q.city || "").trim();
    const minor = viewer ? await isMinor(viewer.id) : false;
    let rows = await db.all("SELECT p.*, o.name oname, o.status ostatus FROM vol_opps p JOIN charity_orgs o ON o.id=p.org_id WHERE p.status='open' AND o.status='verified' AND p.ends_at > $1 ORDER BY p.starts_at LIMIT 300", [iso()]);
    if (minor) rows = rows.filter((r) => Number(r.minors));
    if (mode) rows = rows.filter((r) => (mode === "online" ? Number(r.online) : !Number(r.online)));
    if (city) rows = rows.filter((r) => String(r.city || "").includes(city));
    if (text) rows = rows.filter((r) => [r.title, r.descr, r.skills, r.oname, r.city].join(" ").toLowerCase().includes(text));
    const out = []; for (const r of rows.slice(0, 60)) out.push(await oppClient(r, { id: r.org_id, name: r.oname, status: r.ostatus }));
    return { opportunities: out, minor };
  }
  async function mine(user) {
    const ss = await db.all("SELECT s.*, p.title, p.starts_at, p.org_id, o.name oname FROM vol_signups s JOIN vol_opps p ON p.id=s.opp_id JOIN charity_orgs o ON o.id=p.org_id WHERE s.user_id=$1 ORDER BY p.starts_at DESC LIMIT 100", [user.id]);
    const ds = await db.all("SELECT d.*, c.title FROM charity_donations d JOIN charity_campaigns c ON c.id=d.campaign_id WHERE d.user_id=$1 AND d.status='completed' ORDER BY d.completed_at DESC LIMIT 100", [user.id]);
    return { hours: ss.filter((s) => s.status === "attended").reduce((a, s) => a + Number(s.hours || 0), 0), signups: ss.map((s) => ({ ...signClient(s, [user]), opportunity: { id: s.opp_id, title: s.title, startsAt: s.starts_at }, org: { id: s.org_id, name: s.oname } })),
      donations: ds.map((d) => ({ amount: pi(d.amount), at: d.completed_at, campaign: { id: d.campaign_id, title: d.title }, anonymous: !!Number(d.anonymous) })), minor: await isMinor(user.id), ...(await orgsList(user, {})) };
  }

  /* ---------- staff ---------- */
  async function adminView() {
    const orgs = await db.all("SELECT * FROM charity_orgs ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END, created_at DESC LIMIT 200");
    const review = await db.all("SELECT * FROM charity_campaigns WHERE status='review' OR flagged=1 ORDER BY updated_at LIMIT 100");
    const live = await db.all("SELECT * FROM charity_campaigns WHERE status IN ('live','paused') ORDER BY published_at DESC LIMIT 100");
    const reports = await db.all("SELECT * FROM charity_reports WHERE status='open' ORDER BY created_at LIMIT 200");
    const us = await usersOf([...orgs.map((o) => o.owner_id), ...reports.map((r) => r.by_user)]);
    const oById = new Map(orgs.map((o) => [o.id, o]));
    const rc = []; for (const c of review) rc.push(await campClient(c, oById.get(c.org_id) || (await orgOf(c.org_id))));
    const lc = []; for (const c of live) lc.push(await campClient(c, oById.get(c.org_id) || (await orgOf(c.org_id))));
    return { totals: { pendingOrgs: orgs.filter((o) => o.status === "pending").length, verifiedOrgs: orgs.filter((o) => o.status === "verified").length, review: review.filter((c) => c.status === "review").length, flagged: review.filter((c) => Number(c.flagged)).length, reports: reports.length },
      orgs: orgs.map((o) => ({ ...orgClient(o, { reason: o.reason || null }), owner: userPub(us.find((u) => u.id === o.owner_id)) })), review: rc, live: lc,
      reports: reports.map((r) => ({ id: r.id, type: r.target_type, targetId: r.target_id, reason: REPORT_REASONS[r.reason] || r.reason, note: r.note || "", at: r.created_at, by: userPub(us.find((u) => u.id === r.by_user)) })), piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF };
  }
  async function orgDecision(by, oid, b = {}) {
    const o = await orgOf(oid); if (!o) throw E.nf();
    const to = oneOf(b.status, ["verified", "rejected", "suspended"], null); if (!to) throw E.bad();
    const reason = str(b.reason, 400, { required: to !== "verified", min: 3 });
    await db.run("UPDATE charity_orgs SET status=$1, reason=$2, verified_by=$3, verified_at=$4, updated_at=$5 WHERE id=$6", [to, reason, by.id, to === "verified" ? iso() : o.verified_at, iso(), oid]);
    if (to === "suspended") {
      await db.run("UPDATE charity_campaigns SET status='paused', updated_at=$1 WHERE org_id=$2 AND status='live'", [iso(), oid]);
      await db.run("UPDATE vol_opps SET status='closed', updated_at=$1 WHERE org_id=$2 AND status='open'", [iso(), oid]);
    }
    await notify(o.owner_id, "charity_org", oid, by.id);
    ctx.audit?.("charity_org_" + to, oid, reason || o.name, by.id);
    return { ok: true };
  }
  async function campaignDecision(by, cid, b = {}) {
    const c = await campOf(cid); if (!c) throw E.nf();
    const action = oneOf(b.action, ["approve", "reject", "pause", "resume", "end", "unflag"], null); if (!action) throw E.bad();
    const reason = str(b.reason, 400, { required: ["reject", "pause"].includes(action), min: 3 }), t = iso();
    const ok = { approve: ["review"], reject: ["review"], pause: ["live"], resume: ["paused"], end: ["live", "paused"], unflag: ["live", "paused", "review", "ended"] }[action];
    if (!ok.includes(c.status)) throw E.conflict("الإجراء غير متاح لحالة الحملة");
    if (action === "approve") { const o = await orgOf(c.org_id); if (o.status !== "verified") throw E.conflict("الجهة غير موثّقة"); await db.run("UPDATE charity_campaigns SET status='live', review_reason=NULL, published_at=$1, updated_at=$1 WHERE id=$2", [t, cid]); }
    else if (action === "reject") await db.run("UPDATE charity_campaigns SET status='rejected', review_reason=$1, updated_at=$2 WHERE id=$3", [reason, t, cid]);
    else if (action === "pause") await db.run("UPDATE charity_campaigns SET status='paused', review_reason=$1, updated_at=$2 WHERE id=$3", [reason, t, cid]);
    else if (action === "resume") await db.run("UPDATE charity_campaigns SET status='live', updated_at=$1 WHERE id=$2", [t, cid]);
    else if (action === "end") await db.run("UPDATE charity_campaigns SET status='ended', updated_at=$1 WHERE id=$2", [t, cid]);
    else { await db.run("UPDATE charity_campaigns SET flagged=0, updated_at=$1 WHERE id=$2", [t, cid]); await db.run("UPDATE charity_reports SET status='dismissed', decided_at=$1 WHERE target_id=$2 AND status='open'", [t, cid]); }
    for (const m of await db.all("SELECT user_id FROM charity_org_members WHERE org_id=$1", [c.org_id])) await notify(m.user_id, "charity_review", cid, by.id);
    ctx.audit?.("charity_campaign_" + action, cid, reason || c.title, by.id);
    return { ok: true };
  }
  async function closeReport(by, rid, b = {}) {
    const r = await db.get("SELECT * FROM charity_reports WHERE id=$1 AND status='open'", [rid]); if (!r) throw E.nf();
    await db.run("UPDATE charity_reports SET status=$1, decided_at=$2 WHERE id=$3", [b.action === "action" ? "actioned" : "dismissed", iso(), rid]);
    if (r.target_type === "campaign" && (await n("SELECT COUNT(*) n FROM charity_reports WHERE target_id=$1 AND status='open'", [r.target_id])) < FLAG_AT && b.action !== "action") await db.run("UPDATE charity_campaigns SET flagged=0 WHERE id=$1", [r.target_id]);
    ctx.audit?.("charity_report_" + (b.action === "action" ? "actioned" : "dismissed"), rid, r.target_id, by.id);
    return { ok: true };
  }

  /* ---------- job: campaigns end at their end date ---------- */
  async function tick() {
    const t = iso(); let ended = 0;
    for (const c of await db.all("SELECT id, org_id FROM charity_campaigns WHERE status IN ('live','paused') AND ends_at <= $1", [t])) {
      const ch = await db.run("UPDATE charity_campaigns SET status='ended', updated_at=$1 WHERE id=$2 AND status IN ('live','paused')", [t, c.id]); if (!ch.changes) continue;
      ended++; for (const m of await db.all("SELECT user_id FROM charity_org_members WHERE org_id=$1", [c.org_id])) await notify(m.user_id, "charity_review", c.id);
    }
    return { ended };
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("charity.tick", +(env.CHARITY_TICK_INTERVAL_MS || 30 * 60e3), () => tick());

  /* ---------- routes ---------- */
  R.get("/api/charity/campaigns", async (req) => campaigns(req.user || null, req.query || {}));
  R.get("/api/charity/campaigns/:id", async (req) => campaignView(req.user || null, req.params.id));
  R.put("/api/charity/campaigns/:id", A(async (req) => editCampaign(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/campaigns/:id/updates", A(async (req) => postUpdate(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/campaigns/:id/donate", A(async (req) => donate(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/campaigns/:id/report", A(async (req) => report(req.user, "campaign", req.params.id, req.body || {})));
  R.get("/api/charity/orgs", async (req) => orgsList(req.user || null, req.query || {}));
  R.post("/api/charity/orgs", A(async (req) => registerOrg(req.user, req.body || {})));
  R.get("/api/charity/orgs/:id", async (req) => orgView(req.user || null, req.params.id));
  R.put("/api/charity/orgs/:id", A(async (req) => editOrg(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/orgs/:id/members", A(async (req) => addMember(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/orgs/:id/campaigns", A(async (req) => createCampaign(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/orgs/:id/opportunities", A(async (req) => createOpp(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/orgs/:id/report", A(async (req) => report(req.user, "org", req.params.id, req.body || {})));
  R.get("/api/charity/opportunities", async (req) => opportunities(req.user || null, req.query || {}));
  R.get("/api/charity/opportunities/:id", async (req) => oppView(req.user || null, req.params.id));
  R.put("/api/charity/opportunities/:id", A(async (req) => editOpp(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/opportunities/:id/signup", A(async (req) => signUp(req.user, req.params.id, req.body || {})));
  R.post("/api/charity/signups/:id", A(async (req) => decideSignup(req.user, req.params.id, req.body || {})));
  R.get("/api/charity/me", A(async (req) => mine(req.user)));
  R.get("/api/admin/charity", admin(async () => adminView()));
  R.post("/api/admin/charity/orgs/:id", admin(async (req) => orgDecision(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/charity/campaigns/:id", admin(async (req) => campaignDecision(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/charity/campaigns/:id/disburse", admin(async (req) => disburse(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/charity/reports/:id", admin(async (req) => closeReport(req.user, req.params.id, req.body || {})));

  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  return { tick, settle, money, KINDS, CATS };
};
