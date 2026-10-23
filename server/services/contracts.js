/* Contracts, milestones & escrow «العقود والمراحل» (phase 78).
 *  1. A client offers a contract to a worker — from a job application the client moved to «عرض مقدّم» or «تم التعيين»
 *     (phase 77), or directly to any member: title, scope, revisions allowed per milestone, 1–10 milestones (title, details,
 *     amount in π — 0 for unpaid work — and an optional due date). The worker accepts or declines; the client may withdraw a
 *     pending offer. Accepting an offer made from an «offered» application marks the application hired.
 *  2. Escrow per milestone through the shared ledger: the client funds a paid milestone with Pi (purpose `contract`):
 *     `user:<client>:pi_out` → `escrow:contracts`. Approval releases it to `work:<worker>:earnings` (minus CONTRACT_FEE_PCT,
 *     default 0, to `platform:fees`); a refund returns it to the client; a staff split does both. Work on a paid milestone
 *     starts once it is funded. While Pi payments are off (production) funding answers 501 not_configured with an Arabic
 *     notice; unpaid contracts work fully.
 *  3. Delivery: the worker submits a deliverable (note + up to 5 links); the client approves or asks for a revision (up to
 *     the agreed number, then approve or dispute). A submission the client ignores for CONTRACT_AUTO_RELEASE_DAYS (14) is
 *     approved automatically.
 *  4. Disputes: either side opens one on a funded milestone (frozen: no approval, revision, refund or auto-release); staff
 *     resolve it at #/admin/contracts — release, refund or split with a worker share — with a note both sides see.
 *  5. Cancelling: the client withdraws an offer or cancels an active contract while no money is held; the worker may end
 *     the contract at any time, which refunds every held, undisputed milestone to the client.
 *  6. One timeline (offer, acceptance, funding, deliveries, reviews, messages, disputes); risky messages (fees, off-platform
 *     contact or payment, wallet passphrase) carry a warning to the recipient. Notifications on every step.
 *  7. Minors (phase 35): cannot take part in a contract with any paid milestone, on either side; unpaid contracts are allowed.
 *  A contract whose milestones are all approved / released (or refunded / cancelled with at least one paid out) is completed;
 *  completed contracts are what phase 80 reviews are written from. */
const { E, str, oneOf, id } = require("../lib/core");
const { toUnits, pi, ACC, createLedger } = require("../lib/ledger");

const ESCROW = "escrow:contracts";
const WORK = (uid) => `work:${uid}:earnings`;
const C_STATUS = { offer: "عرض بانتظار الرد", active: "نشط", completed: "مكتمل", declined: "مرفوض", cancelled: "ملغى" };
const M_STATUS = { pending: "بانتظار البدء", funded: "مموّلة بالضمان", submitted: "سُلّمت للمراجعة", revision: "مطلوب تعديل", approved: "معتمدة", released: "معتمدة ومدفوعة", refunded: "مستردّة للعميل", cancelled: "ملغاة" };
const REASONS = { quality: "التسليم لا يطابق المتفق عليه", late: "تأخر كبير في التسليم", unresponsive: "الطرف الآخر لا يستجيب", scope: "طلب أعمال خارج الاتفاق", payment: "مشكلة في الدفع أو الاعتماد", other: "سبب آخر" };
const PI_OFF = "مدفوعات Pi غير مفعّلة بعد — تمويل المراحل بالضمان متوقف حتى تفعيلها. يمكنكم الاتفاق على العقد وتوثيقه، والعقود غير المدفوعة تعمل بالكامل.";
const MINOR = "العقود المدفوعة متاحة لمن هم ١٨ سنة فأكثر";
const HELD = ["funded", "submitted", "revision"];
const DONE = ["approved", "released", "refunded", "cancelled"];

/** @param {any} ctx @param {{ now?: () => number, env?: Record<string,string|undefined>, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl, bus } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const today = () => iso().slice(0, 10);
  const ts = (v) => (v ? new Date(v).getTime() || 0 : 0);
  const isoOf = (v) => (v ? new Date(v).toISOString() : null);
  const FEE_PCT = Math.max(0, Math.min(30, +(env.CONTRACT_FEE_PCT || 0))), AUTO_DAYS = +(env.CONTRACT_AUTO_RELEASE_DAYS || 14), MAX_PI = +(env.CONTRACT_MAX_PI || 100000);
  const { postJournal } = createLedger({ now: () => iso() });
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const piOn = () => !!ctx.services.pi?.enabled?.();
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : status === 404 ? E.nf(msg) : E.bad(msg), { code });
  const parse = (v, d) => { try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const inflight = new Set(); const track = (fn) => (e) => { const p = Promise.resolve(fn(e)).catch((err) => ctx.log?.warn?.("contracts bus", { err: String(err) })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const risky = (text) => { try { return (ctx.services.jobs?.risks?.(text) || []).some((r) => ["fee", "offplatform", "phrase", "income"].includes(r.key)); } catch { return false; } };

  async function blockedBetween(a, b) {
    if (!a || !b || a === b) return false;
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    const pa = parse(ua?.prefs, {}), pb = parse(ub?.prefs, {});
    if ((pa.blocked || []).includes(b) || (pb.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; const m = new Map(); if (!a.length) return m; for (const u of await db.all(`SELECT id, name, handle, color, avatar, verified FROM users WHERE id IN (${ph(a)})`, a)) m.set(u.id, u); return m; }
  const pubU = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: u.verified || null } : null);
  async function event(t, cid, mid, actor, kind, body, warn = 0) { await t.run("INSERT INTO contract_events (id, contract_id, milestone_id, actor_id, kind, body, warn, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id("cev"), cid, mid || null, actor || null, kind, body || null, warn ? 1 : 0, iso()]); }

  /* ---------- validation ---------- */
  const amt = (v) => { const x = Number(v ?? 0); if (!Number.isFinite(x) || x < 0 || x > MAX_PI) throw fail(400, "bad_amount", "مبلغ غير صالح"); return toUnits(x); };
  function terms(b) {
    const title = str(b.title, 120, { required: true, min: 6 });
    const scope = String(b.scope ?? "").replace(/\r\n?/g, "\n").trim(); if (scope.length < 30) throw fail(400, "too_short", "صف نطاق العمل في ٣٠ حرفاً على الأقل"); if (scope.length > 6000) throw E.bad("نطاق العمل أطول من الحد");
    const maxRevisions = Math.max(0, Math.min(5, Math.round(Number(b.maxRevisions ?? 2)) || 0));
    const msIn = Array.isArray(b.milestones) ? b.milestones : [];
    if (!msIn.length || msIn.length > 10) throw fail(400, "milestones", "أضف من مرحلة إلى ١٠ مراحل");
    const milestones = msIn.map((m) => {
      const t = str(String(m?.title ?? ""), 120, { required: true, min: 3 }), body = str(m?.body ? String(m.body) : undefined, 1000), amount = amt(m?.amount);
      const due = m?.due || null; if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < today())) throw fail(400, "bad_date", "موعد المرحلة يجب أن يكون اليوم أو بعده");
      return { title: t, body, amount, due };
    });
    const total = milestones.reduce((s, m) => s + m.amount, 0);
    return { title, scope, maxRevisions, milestones, total };
  }

  /* ---------- views ---------- */
  const row = (cid) => db.get("SELECT * FROM contracts WHERE id=$1", [String(cid)]);
  const msOf = (cid) => db.all("SELECT * FROM contract_milestones WHERE contract_id=$1 ORDER BY pos", [cid]);
  async function access(user, c, { staffOk = true } = {}) {
    if (!c) throw E.nf();
    const client = c.client_id === user.id, worker = c.worker_id === user.id, staff = staffOk && user.role === "admin";
    if (!client && !worker && !staff) throw E.nf();
    return { client, worker, staff };
  }
  function summary(c, us, ms) {
    const paidOut = ms.filter((m) => ["released", "approved"].includes(m.status)).length;
    return { id: c.id, title: c.title, status: c.status, statusLabel: C_STATUS[c.status], total: pi(c.total), paid: !!Number(c.paid), client: pubU(us.get(c.client_id)), worker: pubU(us.get(c.worker_id)),
      source: c.source, jobId: c.job_id || null, appId: c.app_id || null, milestones: ms.length, done: paidOut, held: pi(ms.filter((m) => HELD.includes(m.status) && Number(m.amount) > 0).reduce((s, m) => s + Number(m.amount), 0)),
      createdAt: isoOf(c.created_at), updatedAt: isoOf(c.updated_at), completedAt: isoOf(c.completed_at) };
  }
  async function list(user, q = {}) {
    const role = q.role === "client" ? "client" : q.role === "worker" ? "worker" : "all";
    const where = role === "client" ? "client_id=$1" : role === "worker" ? "worker_id=$1" : "(client_id=$1 OR worker_id=$1)";
    const rows = await db.all(`SELECT * FROM contracts WHERE ${where} ORDER BY updated_at DESC LIMIT 200`, [user.id]);
    const us = await usersOf(rows.flatMap((c) => [c.client_id, c.worker_id]));
    const ms = rows.length ? await db.all(`SELECT * FROM contract_milestones WHERE contract_id IN (${ph(rows.map((c) => c.id))})`, rows.map((c) => c.id)) : [];
    const out = rows.map((c) => ({ ...summary(c, us, ms.filter((m) => m.contract_id === c.id)), role: c.client_id === user.id ? "client" : "worker" }));
    const open = out.filter((c) => ["offer", "active"].includes(c.status)), closed = out.filter((c) => !["offer", "active"].includes(c.status));
    return { open, closed, piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF, minor: await isMinor(user.id), options: options() };
  }
  const options = () => ({ reasons: REASONS, statuses: C_STATUS, milestoneStatuses: M_STATUS, feePct: FEE_PCT, autoReleaseDays: AUTO_DAYS, maxMilestones: 10, maxRevisions: 5 });
  async function view(user, cid) {
    const c = await row(cid), who = await access(user, c);
    const ms = await msOf(c.id), us = await usersOf([c.client_id, c.worker_id]);
    const dls = await db.all("SELECT * FROM contract_deliverables WHERE contract_id=$1 ORDER BY created_at, id", [c.id]);
    const evs = await db.all("SELECT * FROM contract_events WHERE contract_id=$1 ORDER BY created_at, id", [c.id]);
    const dps = await db.all("SELECT * FROM contract_disputes WHERE contract_id=$1 ORDER BY created_at", [c.id]);
    const active = c.status === "active", on = piOn();
    const party = who.client || who.worker;
    const mview = (m) => {
      const amount = Number(m.amount), paid = amount > 0, dispute = dps.find((d) => d.milestone_id === m.id && d.status === "open");
      const acts = [];
      if (active && !Number(m.disputed)) {
        if (who.client && m.status === "pending" && paid) acts.push("fund");
        if (who.worker && ((m.status === "pending" && !paid) || ["funded", "revision"].includes(m.status))) acts.push("submit");
        if (who.client && m.status === "submitted") { acts.push("approve"); if (Number(m.revisions) < Number(c.max_revisions)) acts.push("revision"); }
        if (party && paid && HELD.includes(m.status)) acts.push("dispute");
      }
      return { id: m.id, pos: Number(m.pos), title: m.title, body: m.body || "", amount: pi(amount), paid, due: m.due || null, overdue: !!m.due && m.due < today() && !DONE.includes(m.status), status: m.status, statusLabel: M_STATUS[m.status],
        revisions: Number(m.revisions), workerAmount: m.worker_amount === null || m.worker_amount === undefined ? null : pi(m.worker_amount), disputed: !!Number(m.disputed), dispute: dispute ? { id: dispute.id, reason: REASONS[dispute.reason], openedBy: dispute.opened_by === c.client_id ? "client" : "worker" } : null,
        autoReleaseAt: m.status === "submitted" && !Number(m.disputed) ? iso(ts(m.submitted_at) + AUTO_DAYS * 864e5) : null,
        deliverables: dls.filter((d) => d.milestone_id === m.id).map((d) => ({ id: d.id, note: d.note, links: parse(d.links, []), at: isoOf(d.created_at) })), actions: acts };
    };
    return {
      contract: { ...summary(c, us, ms), scope: c.scope, maxRevisions: Number(c.max_revisions), declineNote: c.decline_note || null, acceptedAt: isoOf(c.accepted_at) },
      milestones: ms.map(mview),
      events: evs.map((e) => ({ id: e.id, kind: e.kind, body: e.body || null, milestoneId: e.milestone_id || null, mine: e.actor_id === user.id, by: !e.actor_id ? "system" : e.actor_id === c.client_id ? "client" : e.actor_id === c.worker_id ? "worker" : "staff", warn: !!Number(e.warn) && e.actor_id !== user.id, at: isoOf(e.created_at) })),
      disputes: dps.map((d) => ({ id: d.id, milestoneId: d.milestone_id, reason: REASONS[d.reason], body: d.body, status: d.status, outcome: d.outcome || null, workerShare: d.worker_share === null || d.worker_share === undefined ? null : pi(d.worker_share), staffNote: d.staff_note || null, openedBy: d.opened_by === c.client_id ? "client" : "worker", at: isoOf(d.created_at), resolvedAt: isoOf(d.resolved_at) })),
      me: { client: who.client, worker: who.worker, staff: who.staff, canRespond: who.worker && c.status === "offer", canWithdraw: who.client && c.status === "offer",
        canCancel: active && ((who.client && !ms.some((m) => HELD.includes(m.status) && Number(m.amount) > 0)) || who.worker), canMessage: party && ["offer", "active"].includes(c.status) },
      teams: party ? await ctx.services.teams?.forContract?.(user.id, c.id) || [] : [],
      piEnabled: on, piNotice: on ? null : PI_OFF, options: options(),
      safety: "لا تدفع ولا تستلم أي مبلغ خارج المنصة، ولا تشارك عبارة مرور محفظتك. المبالغ المموّلة تبقى في الضمان حتى اعتماد المرحلة."
    };
  }

  /* ---------- offers ---------- */
  async function create(user, b) {
    if (!rl.hit("default", "ctnew:" + user.id)) throw E.rate();
    const f = terms(b);
    let worker, source = "offer", jobId = null, appId = null;
    if (b.appId) {
      const a = await ctx.services.jobs?.appRow?.(String(b.appId));
      if (!a || (a.poster_id !== user.id)) throw E.nf();
      if (!["offered", "hired"].includes(a.status)) throw fail(409, "not_offered", "انقل الطلب إلى «عرض مقدّم» أو «تم التعيين» قبل إنشاء العقد");
      if (await db.get("SELECT 1 x FROM contracts WHERE app_id=$1 AND status IN ('offer','active')", [a.id])) throw fail(409, "exists", "يوجد عقد قائم لهذا الطلب");
      worker = await db.get("SELECT id, status FROM users WHERE id=$1", [a.applicant_id]); source = "application"; jobId = a.job_id; appId = a.id;
    } else {
      const h = String(b.to || "").replace(/^@/, "").trim().toLowerCase(); if (!h) throw E.bad("اختر الطرف الآخر");
      worker = await db.get("SELECT id, status FROM users WHERE LOWER(handle)=$1", [h]);
    }
    if (!worker || worker.status === "banned" || worker.status === "deleted") throw fail(404, "no_user", "لم نجد هذا العضو");
    if (worker.id === user.id) throw E.bad("لا يمكنك التعاقد مع نفسك");
    if (await blockedBetween(user.id, worker.id)) throw fail(404, "no_user", "لم نجد هذا العضو");
    if (f.total > 0 && ((await isMinor(user.id)) || (await isMinor(worker.id)))) throw fail(403, "minor_restricted", MINOR);
    const open = Number((await db.get("SELECT COUNT(*) n FROM contracts WHERE client_id=$1 AND status IN ('offer','active')", [user.id]))?.n || 0);
    if (open >= +(env.CONTRACT_MAX_OPEN || 25)) throw fail(409, "limit", "لديك عقود نشطة كثيرة؛ أنهِ بعضها أولاً");
    const cid = id("ctr"), now = iso();
    await db.tx(async (t) => {
      await t.run("INSERT INTO contracts (id, client_id, worker_id, source, job_id, app_id, title, scope, max_revisions, total, paid, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'offer',$12,$12)",
        [cid, user.id, worker.id, source, jobId, appId, f.title, f.scope, f.maxRevisions, f.total, f.total > 0 ? 1 : 0, now]);
      let pos = 0; for (const m of f.milestones) await t.run("INSERT INTO contract_milestones (id, contract_id, pos, title, body, amount, due, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')", [id("cms"), cid, pos++, m.title, m.body, m.amount, m.due]);
      await event(t, cid, null, user.id, "offer", null, risky(`${f.title}\n${f.scope}`) ? 1 : 0);
    });
    await notify(worker.id, "contract_offer", cid, user.id);
    return { id: cid, state: "offer", statusLabel: C_STATUS.offer, total: pi(f.total) };
  }
  async function respond(user, cid, b) {
    const c = await row(cid); if (!c || c.worker_id !== user.id) throw E.nf();
    if (c.status !== "offer") throw fail(409, "not_offer", "العرض لم يعد متاحاً");
    const accept = b.accept === true || b.action === "accept", note = str(b.note, 600);
    if (accept && Number(c.paid) && ((await isMinor(c.client_id)) || (await isMinor(c.worker_id)))) throw fail(403, "minor_restricted", MINOR);
    const now = iso();
    await db.tx(async (t) => {
      const r = await t.run(`UPDATE contracts SET status=$1, accepted_at=$2, decline_note=$3, updated_at=$4, closed_at=$5 WHERE id=$6 AND status='offer'`, [accept ? "active" : "declined", accept ? now : null, accept ? null : note, now, accept ? null : now, c.id]);
      if (!r.changes) throw fail(409, "not_offer", "العرض لم يعد متاحاً");
      await event(t, c.id, null, user.id, accept ? "accepted" : "declined", note);
      if (accept && c.app_id) {
        const a = await t.get("SELECT id, status FROM job_applications WHERE id=$1", [c.app_id]);
        if (a?.status === "offered") { await t.run("UPDATE job_applications SET status='hired', updated_at=$1 WHERE id=$2", [now, a.id]); await t.run("INSERT INTO job_events (id, app_id, actor_id, kind, status, body, warn, created_at) VALUES ($1,$2,$3,'status','hired',$4,0,$5)", [id("jev"), a.id, user.id, "قبل المتقدّم العقد.", now]); }
      }
    });
    await notify(c.client_id, "contract_status", c.id, user.id);
    return view(user, c.id);
  }
  async function withdraw(user, cid) {
    const c = await row(cid); if (!c || c.client_id !== user.id) throw E.nf();
    if (c.status !== "offer") throw fail(409, "not_offer", "لا يمكن سحب العرض الآن");
    await db.tx(async (t) => { await t.run("UPDATE contracts SET status='cancelled', updated_at=$1, closed_at=$1 WHERE id=$2 AND status='offer'", [iso(), c.id]); await t.run("UPDATE contract_milestones SET status='cancelled' WHERE contract_id=$1", [c.id]); await event(t, c.id, null, user.id, "withdrawn", null); });
    await notify(c.worker_id, "contract_status", c.id, user.id);
    return view(user, c.id);
  }

  /* ---------- escrow ---------- */
  async function settle(t, m, c, workerUnits, kind, extra = {}) {
    const amount = Number(m.amount), w = Math.max(0, Math.min(amount, Math.round(workerUnits))), fee = Math.round((w * FEE_PCT) / 100), back = amount - w;
    const to = w === amount ? "released" : w === 0 ? "refunded" : "released";
    const r = await t.run(`UPDATE contract_milestones SET status=$1, worker_amount=$2, fee=$3, settled_at=$4, approved_at=COALESCE(approved_at,$4), disputed=0 WHERE id=$5 AND status IN ('funded','submitted','revision')`, [to, w, fee, iso(), m.id]);
    if (!r.changes) return false;
    const jid = await postJournal(t, { ikey: `contract:${m.id}:${kind}`, kind: "contract_" + kind, source: "contract", refId: m.id, senderId: c.client_id, creatorId: c.worker_id, memo: extra.memo || null,
      lines: [{ account: ESCROW, debit: amount }, { account: WORK(c.worker_id), userId: c.worker_id, credit: w - fee }, { account: ACC.fees, credit: fee }, { account: ACC.out(c.client_id), userId: c.client_id, credit: back }] });
    if (jid) await t.run("UPDATE contract_milestones SET settle_journal=$1 WHERE id=$2", [jid, m.id]);
    return true;
  }
  async function maybeComplete(t, cid) {
    const c = await t.get("SELECT * FROM contracts WHERE id=$1", [cid]); if (!c || c.status !== "active") return null;
    const ms = await t.all("SELECT status FROM contract_milestones WHERE contract_id=$1", [cid]);
    if (!ms.every((m) => DONE.includes(m.status))) return null;
    const ok = ms.some((m) => ["approved", "released"].includes(m.status)), to = ok ? "completed" : "cancelled";
    await t.run(`UPDATE contracts SET status=$1, completed_at=$2, closed_at=$2, updated_at=$2 WHERE id=$3 AND status='active'`, [to, iso(), cid]);
    await event(t, cid, null, null, to, null);
    return to;
  }
  async function msFor(user, mid) {
    const m = await db.get("SELECT * FROM contract_milestones WHERE id=$1", [String(mid)]); if (!m) throw E.nf();
    const c = await row(m.contract_id), who = await access(user, c, { staffOk: false });
    return { m, c, who };
  }
  async function fund(user, mid) {
    const { m, c, who } = await msFor(user, mid);
    if (!who.client) throw E.forbid("يموّل العميل المراحل");
    if (!piOn()) throw E.off(PI_OFF);
    if (c.status !== "active") throw fail(409, "not_active", "العقد غير نشط");
    if (m.status !== "pending" || Number(m.amount) <= 0) throw fail(409, "not_fundable", "لا تحتاج هذه المرحلة إلى تمويل");
    if ((await isMinor(c.client_id)) || (await isMinor(c.worker_id))) throw fail(403, "minor_restricted", MINOR);
    const it = await ctx.services.pi.createIntent(user, { amount: pi(m.amount), memo: `ضمان مرحلة: ${m.title} — ${c.title}`.slice(0, 200), purpose: "contract", refId: m.id });
    await db.run("UPDATE contract_milestones SET intent_id=$1 WHERE id=$2 AND status='pending'", [it.id, m.id]);
    return { milestone: m.id, intent: it, amount: pi(m.amount) };
  }
  bus?.on?.("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "contract") return;
    const m = await db.get("SELECT * FROM contract_milestones WHERE intent_id=$1", [e.tx]); if (!m) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(m.amount)) > 1) { ctx.log?.warn?.("contract funding amount mismatch", { milestone: m.id }); return; }
    const c = await row(m.contract_id); if (!c) return;
    let ok = false;
    await db.tx(async (t) => {
      const r = await t.run("UPDATE contract_milestones SET status='funded', funded_at=$1 WHERE id=$2 AND status='pending'", [iso(), m.id]); if (!r.changes) return;
      const jid = await postJournal(t, { ikey: `contract:${m.id}:hold`, kind: "contract_hold", source: "contract", refId: m.id, senderId: c.client_id, creatorId: c.worker_id, piTx: e.tx,
        lines: [{ account: ACC.out(c.client_id), userId: c.client_id, debit: Number(m.amount) }, { account: ESCROW, credit: Number(m.amount) }] });
      if (jid) await t.run("UPDATE contract_milestones SET hold_journal=$1 WHERE id=$2", [jid, m.id]);
      await t.run("UPDATE contracts SET updated_at=$1 WHERE id=$2", [iso(), c.id]);
      await event(t, c.id, m.id, c.client_id, "funded", null); ok = true;
    });
    if (ok) await notify(c.worker_id, "contract_funded", c.id, c.client_id);
  }));
  bus?.on?.("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "contract") await db.run("UPDATE contract_milestones SET intent_id=NULL WHERE intent_id=$1 AND status='pending'", [e.tx]); }));

  /* ---------- delivery & review ---------- */
  async function submit(user, mid, b) {
    const { m, c, who } = await msFor(user, mid);
    if (!who.worker) throw E.forbid("يسلّم المنفّذ المراحل");
    if (c.status !== "active") throw fail(409, "not_active", "العقد غير نشط");
    if (Number(m.disputed)) throw fail(409, "disputed", "المرحلة مجمّدة بسبب نزاع مفتوح");
    const paid = Number(m.amount) > 0;
    if (paid && m.status === "pending") throw fail(409, "not_funded", "ابدأ العمل المدفوع بعد تمويل المرحلة بالضمان");
    if (!["pending", "funded", "revision"].includes(m.status)) throw fail(409, "bad_state", "لا يمكن التسليم الآن");
    if (!rl.hit("default", "ctsub:" + user.id)) throw E.rate();
    const note = str(b.note, 3000, { required: true, min: 10 });
    const links = (Array.isArray(b.links) ? b.links : []).map((l) => String(l || "").trim()).filter(Boolean).slice(0, 5);
    for (const l of links) { let u; try { u = new URL(l); } catch { throw fail(400, "bad_link", "رابط غير صالح"); } if (!["https:", "http:"].includes(u.protocol)) throw fail(400, "bad_link", "رابط غير صالح"); }
    await db.tx(async (t) => {
      const r = await t.run("UPDATE contract_milestones SET status='submitted', submitted_at=$1 WHERE id=$2 AND status=$3 AND disputed=0", [iso(), m.id, m.status]); if (!r.changes) throw fail(409, "bad_state", "لا يمكن التسليم الآن");
      await t.run("INSERT INTO contract_deliverables (id, contract_id, milestone_id, user_id, note, links, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id("cdl"), c.id, m.id, user.id, note, JSON.stringify(links), iso()]);
      await t.run("UPDATE contracts SET updated_at=$1 WHERE id=$2", [iso(), c.id]);
      await event(t, c.id, m.id, user.id, "submitted", null);
    });
    await notify(c.client_id, "contract_submitted", c.id, user.id);
    return view(user, c.id);
  }
  async function approveTx(t, m, c, actor, auto = false) {
    if (Number(m.amount) > 0) { if (!(await settle(t, m, c, Number(m.amount), "release"))) return false; }
    else { const r = await t.run("UPDATE contract_milestones SET status='approved', approved_at=$1 WHERE id=$2 AND status='submitted' AND disputed=0", [iso(), m.id]); if (!r.changes) return false; }
    await event(t, c.id, m.id, actor, auto ? "auto_approved" : "approved", null);
    await t.run("UPDATE contracts SET updated_at=$1 WHERE id=$2", [iso(), c.id]);
    await maybeComplete(t, c.id);
    return true;
  }
  async function review(user, mid, b) {
    const { m, c, who } = await msFor(user, mid);
    if (!who.client) throw E.forbid("يراجع العميل التسليم");
    if (c.status !== "active") throw fail(409, "not_active", "العقد غير نشط");
    if (Number(m.disputed)) throw fail(409, "disputed", "المرحلة مجمّدة بسبب نزاع مفتوح");
    if (m.status !== "submitted") throw fail(409, "bad_state", "لا يوجد تسليم بانتظار المراجعة");
    const action = oneOf(b.action, ["approve", "revision"], null); if (!action) throw E.bad();
    if (action === "revision") {
      if (Number(m.revisions) >= Number(c.max_revisions)) throw fail(409, "no_revisions", "استنفدت التعديلات المتفق عليها: اعتمد المرحلة أو افتح نزاعاً");
      const note = str(b.note, 2000, { required: true, min: 5 });
      await db.tx(async (t) => { await t.run("UPDATE contract_milestones SET status='revision', revisions=revisions+1 WHERE id=$1 AND status='submitted'", [m.id]); await event(t, c.id, m.id, user.id, "revision", note); await t.run("UPDATE contracts SET updated_at=$1 WHERE id=$2", [iso(), c.id]); });
    } else {
      let ok = false; await db.tx(async (t) => { ok = await approveTx(t, m, c, user.id); }); if (!ok) throw fail(409, "bad_state", "تعذّر الاعتماد");
    }
    await notify(c.worker_id, "contract_review", c.id, user.id);
    const after = await row(c.id); if (after.status === "completed") { await notify(c.worker_id, "contract_status", c.id, user.id); await notify(c.client_id, "contract_status", c.id); }
    return view(user, c.id);
  }

  /* ---------- cancel ---------- */
  async function cancel(user, cid, b) {
    const c = await row(cid), who = await access(user, c, { staffOk: false });
    if (c.status !== "active") throw fail(409, "not_active", "العقد غير نشط");
    const ms = await msOf(c.id), note = str(b?.note, 600);
    if (who.client && ms.some((m) => HELD.includes(m.status) && Number(m.amount) > 0)) throw fail(409, "held", "لا يمكن الإلغاء ومبالغ المراحل في الضمان؛ اطلب من المنفّذ إنهاء العقد أو افتح نزاعاً");
    if (ms.some((m) => Number(m.disputed))) throw fail(409, "disputed", "يوجد نزاع مفتوح؛ ينتظر قرار فريق المنصة");
    await db.tx(async (t) => {
      for (const m of ms) {
        if (HELD.includes(m.status) && Number(m.amount) > 0) { if (!(await settle(t, m, c, 0, "refund", { memo: "إنهاء العقد من المنفّذ" }))) throw fail(409, "bad_state", "تعذّر الاسترداد"); }
        else if (["pending", "funded", "submitted", "revision"].includes(m.status)) await t.run("UPDATE contract_milestones SET status='cancelled' WHERE id=$1", [m.id]);
      }
      await event(t, c.id, null, user.id, "cancelled", note);
      const done = await maybeComplete(t, c.id);
      if (!done) await t.run("UPDATE contracts SET status='cancelled', closed_at=$1, updated_at=$1 WHERE id=$2 AND status='active'", [iso(), c.id]);
    });
    await notify(who.client ? c.worker_id : c.client_id, "contract_status", c.id, user.id);
    return view(user, c.id);
  }

  /* ---------- disputes ---------- */
  async function dispute(user, mid, b) {
    const { m, c } = await msFor(user, mid);
    if (c.status !== "active") throw fail(409, "not_active", "العقد غير نشط");
    if (!(Number(m.amount) > 0 && HELD.includes(m.status))) throw fail(409, "not_held", "النزاع متاح على المراحل المموّلة بالضمان");
    if (Number(m.disputed)) throw fail(409, "disputed", "يوجد نزاع مفتوح على هذه المرحلة");
    if (!rl.hit("report", "ctdisp:" + user.id)) throw E.rate();
    const reason = oneOf(b.reason, Object.keys(REASONS), null); if (!reason) throw E.bad("اختر سبب النزاع");
    const body = str(b.body, 3000, { required: true, min: 20 });
    const did = id("cdp");
    await db.tx(async (t) => {
      const r = await t.run("UPDATE contract_milestones SET disputed=1 WHERE id=$1 AND disputed=0", [m.id]); if (!r.changes) throw fail(409, "disputed", "يوجد نزاع مفتوح على هذه المرحلة");
      await t.run("INSERT INTO contract_disputes (id, contract_id, milestone_id, opened_by, reason, body, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'open',$7)", [did, c.id, m.id, user.id, reason, body, iso()]);
      await event(t, c.id, m.id, user.id, "dispute", `${REASONS[reason]} — ${body}`);
      await t.run("UPDATE contracts SET updated_at=$1 WHERE id=$2", [iso(), c.id]);
    });
    await notify(user.id === c.client_id ? c.worker_id : c.client_id, "contract_dispute", c.id, user.id);
    return view(user, c.id);
  }
  async function adminView() {
    const open = await db.all("SELECT d.*, m.title mtitle, m.amount, m.status mstatus, c.title ctitle, c.client_id, c.worker_id FROM contract_disputes d JOIN contract_milestones m ON m.id=d.milestone_id JOIN contracts c ON c.id=d.contract_id WHERE d.status='open' ORDER BY d.created_at LIMIT 200");
    const us = await usersOf(open.flatMap((d) => [d.client_id, d.worker_id]));
    const n = async (sql) => Number((await db.get(sql))?.n || 0);
    const held = await db.get("SELECT COALESCE(SUM(credit),0) - COALESCE(SUM(debit),0) b FROM ledger_entries WHERE account=$1", [ESCROW]).catch(() => ({ b: 0 }));
    const dls = open.length ? await db.all(`SELECT milestone_id, note, links, created_at FROM contract_deliverables WHERE milestone_id IN (${ph(open.map((d) => d.milestone_id))}) ORDER BY created_at`, open.map((d) => d.milestone_id)) : [];
    return { totals: { active: await n("SELECT COUNT(*) n FROM contracts WHERE status='active'"), completed: await n("SELECT COUNT(*) n FROM contracts WHERE status='completed'"), disputes: open.length, escrow: pi(Number(held?.b || 0)) },
      disputes: open.map((d) => ({ id: d.id, contractId: d.contract_id, contract: d.ctitle, milestone: d.mtitle, amount: pi(d.amount), milestoneStatus: M_STATUS[d.mstatus], reason: REASONS[d.reason], body: d.body, openedBy: d.opened_by === d.client_id ? "client" : "worker",
        client: pubU(us.get(d.client_id)), worker: pubU(us.get(d.worker_id)), at: isoOf(d.created_at), deliverables: dls.filter((x) => x.milestone_id === d.milestone_id).map((x) => ({ note: x.note, links: parse(x.links, []), at: isoOf(x.created_at) })) })),
      piEnabled: piOn() };
  }
  async function resolve(staff, did, b) {
    const d = await db.get("SELECT * FROM contract_disputes WHERE id=$1", [String(did)]); if (!d) throw E.nf();
    if (d.status !== "open") throw fail(409, "resolved", "حُسم هذا النزاع");
    const outcome = oneOf(b.outcome, ["release", "refund", "split"], null); if (!outcome) throw E.bad("اختر القرار");
    const note = str(b.note, 2000, { required: true, min: 5 });
    const m = await db.get("SELECT * FROM contract_milestones WHERE id=$1", [d.milestone_id]), c = await row(d.contract_id);
    const amount = Number(m.amount);
    const w = outcome === "release" ? amount : outcome === "refund" ? 0 : toUnits(Number(b.workerShare));
    if (outcome === "split" && (!Number.isFinite(w) || w <= 0 || w >= amount)) throw fail(400, "bad_share", "حصة المنفّذ يجب أن تكون بين صفر وكامل المبلغ");
    await db.tx(async (t) => {
      const r = await t.run("UPDATE contract_disputes SET status='resolved', outcome=$1, worker_share=$2, staff_id=$3, staff_note=$4, resolved_at=$5 WHERE id=$6 AND status='open'", [outcome, w, staff.id, note, iso(), d.id]);
      if (!r.changes) throw fail(409, "resolved", "حُسم هذا النزاع");
      if (!(await settle(t, m, c, w, "dispute", { memo: "قرار نزاع " + d.id }))) throw fail(409, "bad_state", "المرحلة ليست في الضمان");
      await event(t, c.id, m.id, staff.id, "resolved", `${outcome === "release" ? "صُرف المبلغ للمنفّذ" : outcome === "refund" ? "أُعيد المبلغ للعميل" : `تقسيم: ${pi(w)} π للمنفّذ و${pi(amount - w)} π للعميل`} — ${note}`);
      await maybeComplete(t, c.id);
    });
    ctx.audit?.("contract_dispute_" + outcome, d.id, note, staff.id);
    for (const uid of [c.client_id, c.worker_id]) await notify(uid, "contract_resolved", c.id, staff.id);
    return adminView();
  }

  /* ---------- messages ---------- */
  async function message(user, cid, b) {
    const c = await row(cid), who = await access(user, c, { staffOk: false });
    if (!["offer", "active"].includes(c.status)) throw fail(409, "closed", "العقد مغلق");
    if (!rl.hit("default", "ctmsg:" + user.id)) throw E.rate();
    const body = str(b.body, 2000, { required: true, min: 1 });
    if (await blockedBetween(c.client_id, c.worker_id)) throw E.forbid("لا يمكن المراسلة");
    await db.tx(async (t) => { await event(t, c.id, null, user.id, "message", body, risky(body) ? 1 : 0); await t.run("UPDATE contracts SET updated_at=$1 WHERE id=$2", [iso(), c.id]); });
    await notify(who.client ? c.worker_id : c.client_id, "contract_msg", c.id, user.id);
    return view(user, c.id);
  }

  /* ---------- auto-release ---------- */
  async function sweep() {
    const cut = iso(clock() - AUTO_DAYS * 864e5); let n = 0;
    for (const m of await db.all("SELECT * FROM contract_milestones WHERE status='submitted' AND disputed=0 AND submitted_at < $1 LIMIT 200", [cut])) {
      const c = await row(m.contract_id); if (!c || c.status !== "active") continue;
      let ok = false; await db.tx(async (t) => { ok = await approveTx(t, m, c, null, true); });
      if (ok) { n++; await notify(c.worker_id, "contract_review", c.id); await notify(c.client_id, "contract_review", c.id); }
    }
    return n;
  }
  if (opts.jobs !== false && !process.env.NODE_TEST_CONTEXT) { const tm = setInterval(() => sweep().catch(() => {}), 3600e3); tm.unref?.(); }

  /* ---------- prefill from a job application ---------- */
  async function draft(user, q) {
    if (!q.app) return { draft: null, options: options(), piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF };
    const a = await ctx.services.jobs?.appRow?.(String(q.app)); if (!a || a.poster_id !== user.id) throw E.nf();
    const us = await usersOf([a.applicant_id]);
    return { draft: { appId: a.id, worker: pubU(us.get(a.applicant_id)), title: a.jtitle, bid: a.bid === null || a.bid === undefined ? null : pi(a.bid), days: a.days ?? null, status: a.status, ready: ["offered", "hired"].includes(a.status) }, options: options(), piEnabled: piOn(), piNotice: piOn() ? null : PI_OFF };
  }

  /* ---------- routes ---------- */
  R.get("/api/contracts", A(async (req) => list(req.user, req.query || {})));
  R.post("/api/contracts", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/contracts/draft", A(async (req) => draft(req.user, req.query || {})));
  R.get("/api/contracts/:id", A(async (req) => view(req.user, req.params.id)));
  R.post("/api/contracts/:id/respond", A(async (req) => respond(req.user, req.params.id, req.body || {})));
  R.post("/api/contracts/:id/withdraw", A(async (req) => withdraw(req.user, req.params.id)));
  R.post("/api/contracts/:id/cancel", A(async (req) => cancel(req.user, req.params.id, req.body || {})));
  R.post("/api/contracts/:id/messages", A(async (req) => message(req.user, req.params.id, req.body || {})));
  R.post("/api/contract-milestones/:id/fund", A(async (req) => fund(req.user, req.params.id)));
  R.post("/api/contract-milestones/:id/submit", A(async (req) => submit(req.user, req.params.id, req.body || {})));
  R.post("/api/contract-milestones/:id/review", A(async (req) => review(req.user, req.params.id, req.body || {})));
  R.post("/api/contract-milestones/:id/dispute", A(async (req) => dispute(req.user, req.params.id, req.body || {})));
  R.get("/api/admin/contracts", admin(async () => adminView()));
  R.post("/api/admin/contract-disputes/:id", admin(async (req) => resolve(req.user, req.params.id, req.body || {})));

  /** completed contracts between two members (phase 80 reviews) */
  async function completedFor(uid) { return db.all("SELECT * FROM contracts WHERE status='completed' AND (client_id=$1 OR worker_id=$1) ORDER BY completed_at DESC", [uid]); }
  return { view, list, sweep, completedFor, C_STATUS, M_STATUS, PI_OFF, ESCROW, flush: () => Promise.all([...inflight]) };
};
