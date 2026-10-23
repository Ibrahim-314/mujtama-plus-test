/* Tips & creator support (phase 37). Built on the Pi service (phase 36): this service never talks to the Pi API.
 * 1. Creators opt in (creator_settings.enabled, default off) and define up to 3 monthly support tiers.
 * 2. Tips: POST /api/tips/intent validates the fraud limits, then asks ctx.services.pi.createIntent for a `tip`
 *    intent (refId = post id, or the creator id for a profile tip). Monthly support: POST /api/support/intent →
 *    `subscription` intent (refId = creator id); every month is a separate Pi payment the supporter approves.
 * 3. Business effects happen ONLY on bus events from the Pi service: PI_PAYMENT_COMPLETED (credit), PI_PAYMENT_CANCELLED
 *    (drop the pending tip / month), PI_PAYMENT_REFUNDED (reversing journal). Each effect is a conditional status
 *    update + a journal with a unique idempotency key, inside one DB transaction, so replays never double-credit.
 * 4. Double-entry ledger (append-only; balances are derived): accounts `user:<id>:pi_out`, `creator:<id>:earnings`,
 *    `platform:fees` (CREATOR_FEE_BPS, default 0) and `platform:held` (suspense for tips held for review).
 * 5. Fraud limits (env-configurable) + held queue with admin release/reject; soft integrity integration.
 * 6. Leased scheduler job: renewal reminders 3 days before active_until, lapse after a 3-day grace.
 * 7. Honour roll, per-post tip summary, creator earnings report (+ CSV), personal ledger, admin balance check.
 * Minors (minors service band < 18) can neither send nor receive tips or support. */
const { E, HttpError, str, id } = require("../lib/core");

const { toUnits, pi, ACC, createLedger } = require("../lib/ledger"); // shared with services/paid.js (phase 38)
const DAY = 864e5, HOUR = 3600e3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };

  /* ======================= configuration ======================= */
  const cfg = {
    maxSingle: toUnits(num("TIPS_MAX_SINGLE", 100)),
    maxDaily: toUnits(num("TIPS_MAX_DAILY", 500)),
    maxHourly: num("TIPS_MAX_PER_HOUR", 20),
    newDays: num("TIPS_NEW_ACCOUNT_DAYS", 3),
    newDaily: toUnits(num("TIPS_NEW_ACCOUNT_DAILY", 10)),
    velocityCount: num("TIPS_VELOCITY_COUNT", 5),
    velocityMs: num("TIPS_VELOCITY_WINDOW_MIN", 10) * 60e3,
    holdAmount: toUnits(num("TIPS_HOLD_AMOUNT", 0)), // 0 = off: every tip ≥ this is held
    feeBps: Math.min(10000, Math.floor(num("CREATOR_FEE_BPS", 0))),
    supportFeeBps: null, // phase 53: pricing item fee.subscriptions (null = same as feeBps)
    supportMax: toUnits(num("SUPPORT_MAX_AMOUNT", 100)),
    periodMs: num("SUPPORT_PERIOD_DAYS", 30) * DAY,
    remindMs: num("SUPPORT_REMIND_DAYS", 3) * DAY,
    graceMs: num("SUPPORT_GRACE_DAYS", 3) * DAY,
    maxTiers: 3
  };
  const feeOf = (units) => Math.floor((units * cfg.feeBps) / 10000);
  const supportFeeOf = (units) => Math.floor((units * (cfg.supportFeeBps ?? cfg.feeBps)) / 10000);

  /* ======================= small helpers ======================= */
  const handleOf = (h) => str(String(h ?? "").replace(/^@/, ""), 60, { required: true });
  const userByHandle = (h) => db.get("SELECT id, handle, name, avatar, status, role, prefs, created_at FROM users WHERE handle=$1", [h]);
  const userById = (uid) => db.get("SELECT id, handle, name, avatar, status, role, prefs, created_at FROM users WHERE id=$1", [uid]);
  const pubUser = (u) => (u ? { handle: u.handle, name: u.name, avatar: u.avatar || null } : null);
  const settingsOf = async (uid) => (await db.get("SELECT * FROM creator_settings WHERE user_id=$1", [uid])) || { user_id: uid, enabled: 0, show_amounts: 0 };
  const tiersOf = (uid) => db.all("SELECT * FROM creator_tiers WHERE creator_id=$1 AND active=1 ORDER BY position, created_at", [uid]);
  const tierClient = (t) => ({ id: t.id, name: t.name, amount: pi(t.amount), perks: t.perks || "" });
  const bool = (v) => v === true || v === 1 || v === "1" || v === "true";
  async function isMinor(uid) {
    const m = ctx.services.minors; // registered after this service (it must stay last); looked up lazily, optional
    if (!m?.isMinorUser) return false;
    try { return !!(await m.isMinorUser(uid)); } catch { return false; }
  }
  async function blockedBetween(a, b) {
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    if ((ua?.prefs?.blocked || []).includes(b) || (ub?.prefs?.blocked || []).includes(a)) return true;
    const r = await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null);
    return !!r;
  }
  const fail = (status, code, msg) => new HttpError(status, msg, code);

  /* ======================= ledger ======================= */
  const { postJournal, creditLines, reverseAll } = createLedger({ now: nowIso });
  const meta = (row, source) => ({ source, refId: row.id, creatorId: row.creator_id, senderId: row.sender_id || row.supporter_id, postId: row.post_id || null, anonymous: !!row.anonymous, showAmount: !!row.show_amount });
  async function ledgerCheck() {
    const rows = await db.all("SELECT j.id, j.kind, COUNT(e.id) AS n, COALESCE(SUM(e.debit),0) AS d, COALESCE(SUM(e.credit),0) AS c, MIN(e.debit) AS mind, MIN(e.credit) AS minc FROM ledger_journals j LEFT JOIN ledger_entries e ON e.journal_id=j.id GROUP BY j.id, j.kind");
    const imbalances = [];
    let debit = 0, credit = 0;
    for (const r of rows) {
      const d = Number(r.d), c = Number(r.c); debit += d; credit += c;
      if (d !== c || Number(r.n) < 2 || Number(r.mind) < 0 || Number(r.minc) < 0) imbalances.push({ journalId: r.id, kind: r.kind, lines: Number(r.n), debit: pi(d), credit: pi(c) });
    }
    const orphans = await db.all("SELECT e.id, e.journal_id FROM ledger_entries e LEFT JOIN ledger_journals j ON j.id=e.journal_id WHERE j.id IS NULL LIMIT 100");
    for (const o of orphans) imbalances.push({ journalId: o.journal_id, kind: "orphan_entry", entryId: Number(o.id) });
    const doubleRev = await db.all("SELECT reverses, COUNT(*) AS n FROM ledger_journals WHERE reverses IS NOT NULL GROUP BY reverses HAVING COUNT(*) > 1");
    for (const x of doubleRev) imbalances.push({ journalId: x.reverses, kind: "reversed_twice", count: Number(x.n) });
    return { journals: rows.length, balanced: imbalances.length === 0, imbalances, totals: { debit: pi(debit), credit: pi(credit) }, checkedAt: nowIso() };
  }

  /* ======================= creator settings ======================= */
  async function getCreator(user) {
    const s = await settingsOf(user.id);
    return { enabled: !!s.enabled, showAmounts: !!s.show_amounts, tiers: (await tiersOf(user.id)).map(tierClient), feeBps: cfg.feeBps, limits: { maxTierAmount: pi(cfg.supportMax), maxTiers: cfg.maxTiers } };
  }
  async function putCreator(user, b) {
    const cur = await settingsOf(user.id);
    const enabled = b.enabled === undefined ? !!cur.enabled : bool(b.enabled);
    const showAmounts = b.showAmounts === undefined ? !!cur.show_amounts : bool(b.showAmounts);
    if (enabled && (await isMinor(user.id))) throw fail(403, "minor_restricted", "الإكراميات والدعم غير متاحين لمن هم دون ١٨ سنة");
    let tiers = null;
    if (b.tiers !== undefined) {
      if (!Array.isArray(b.tiers)) throw E.bad("قائمة المستويات غير صالحة");
      if (b.tiers.length > cfg.maxTiers) throw E.bad(`الحد الأقصى ${cfg.maxTiers} مستويات`);
      const own = new Map((await tiersOf(user.id)).map((t) => [t.id, t]));
      tiers = b.tiers.map((t, i) => {
        if (!t || typeof t !== "object") throw E.bad("مستوى غير صالح");
        const amount = Number(t.amount);
        if (!Number.isFinite(amount) || amount <= 0) throw E.bad("مبلغ المستوى غير صالح");
        const units = toUnits(amount);
        if (units > cfg.supportMax) throw E.bad(`أعلى مبلغ شهري ${pi(cfg.supportMax)} Pi`);
        if (t.id !== undefined && t.id !== null && !own.has(String(t.id))) throw E.bad("مستوى غير معروف");
        return { id: t.id ? String(t.id) : null, name: str(t.name, 40, { required: true }), amount: units, perks: str(t.perks, 500) || "", position: i };
      });
    }
    const t = nowIso();
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE creator_settings SET enabled=$1, show_amounts=$2, updated_at=$3 WHERE user_id=$4", [enabled ? 1 : 0, showAmounts ? 1 : 0, t, user.id]);
      if (!r.changes) await tx.run("INSERT INTO creator_settings(user_id,enabled,show_amounts,created_at,updated_at) VALUES($1,$2,$3,$4,$4)", [user.id, enabled ? 1 : 0, showAmounts ? 1 : 0, t]);
      if (tiers) {
        const keep = tiers.filter((x) => x.id).map((x) => x.id);
        for (const old of await tx.all("SELECT id FROM creator_tiers WHERE creator_id=$1 AND active=1", [user.id])) if (!keep.includes(old.id)) await tx.run("UPDATE creator_tiers SET active=0, updated_at=$1 WHERE id=$2", [t, old.id]);
        for (const x of tiers) {
          if (x.id) await tx.run("UPDATE creator_tiers SET name=$1, amount=$2, perks=$3, position=$4, updated_at=$5 WHERE id=$6 AND creator_id=$7", [x.name, x.amount, x.perks, x.position, t, x.id, user.id]);
          else await tx.run("INSERT INTO creator_tiers(id,creator_id,name,amount,perks,position,active,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,$7)", [id("tier"), user.id, x.name, x.amount, x.perks, x.position, t]);
        }
      }
    });
    if (enabled !== !!cur.enabled) ctx.audit?.(enabled ? "creator_enabled" : "creator_disabled", user.id, null, user.id);
    return getCreator(user);
  }

  /* ======================= limits ======================= */
  /** Pi committed by `uid` in the last 24 h (tips + support months that are not cancelled/rejected) */
  async function sentLastDay(uid, at) {
    const since = new Date(at - DAY).toISOString();
    const a = await db.get("SELECT COALESCE(SUM(amount),0) AS s FROM tips WHERE sender_id=$1 AND created_at >= $2 AND status NOT IN ('cancelled','rejected')", [uid, since]);
    const b = await db.get("SELECT COALESCE(SUM(amount),0) AS s FROM support_payments WHERE supporter_id=$1 AND created_at >= $2 AND status NOT IN ('cancelled')", [uid, since]);
    return Number(a.s) + Number(b.s);
  }
  async function checkDaily(sender, units, at) {
    const young = at - Date.parse(sender.created_at) < cfg.newDays * DAY;
    const cap = young ? Math.min(cfg.newDaily, cfg.maxDaily) : cfg.maxDaily;
    if ((await sentLastDay(sender.id, at)) + units > cap)
      throw fail(429, "tip_daily_limit", young ? `الحسابات الجديدة يمكنها إرسال ${pi(cap)} Pi يومياً كحد أقصى` : `تجاوزت الحد اليومي (${pi(cap)} Pi)`);
  }
  /** shared checks for tips and support: creator exists + opted in, not self, no minors, no blocks */
  async function checkPair(sender, toHandle) {
    const creator = await userByHandle(handleOf(toHandle));
    if (!creator || creator.status !== "active") throw E.nf("الحساب غير موجود");
    if (creator.id === sender.id) throw fail(400, "self_tip", "لا يمكنك دعم نفسك");
    if (!(await settingsOf(creator.id)).enabled) throw fail(409, "creator_disabled", "هذا الحساب لا يستقبل الإكراميات");
    if ((await isMinor(sender.id)) || (await isMinor(creator.id))) throw fail(403, "minor_restricted", "الإكراميات والدعم غير متاحين لمن هم دون ١٨ سنة");
    if (await blockedBetween(sender.id, creator.id)) throw fail(403, "blocked", "لا يمكن إرسال دعم لهذا الحساب");
    return creator;
  }
  async function holdReason(sender, units, at) {
    const recent = await db.get("SELECT COUNT(*) AS n FROM tips WHERE sender_id=$1 AND created_at >= $2 AND status <> 'cancelled'", [sender.id, new Date(at - cfg.velocityMs).toISOString()]);
    if (cfg.velocityCount > 0 && Number(recent.n) >= cfg.velocityCount) return "velocity";
    if (cfg.holdAmount > 0 && units >= cfg.holdAmount) return "amount";
    try { if (await ctx.services.integrity?.limitOf?.(sender.id)) return "integrity_limited"; } catch { /* integrity is optional */ }
    return null;
  }
  async function softFlag(tip) { // integrity review queue (optional table; never blocks the tip flow)
    try {
      const t = nowIso();
      await db.run("INSERT INTO integrity_flags(id,kind,sig,members,score,reason,evidence,status,created_at,updated_at) VALUES($1,'tip_velocity',$2,$3,50,$4,$5,'open',$6,$6)",
        [id("if"), "tip:" + tip.id, JSON.stringify([tip.sender_id, tip.creator_id]), "إكرامية معلّقة للمراجعة (" + tip.hold_reason + ")", JSON.stringify({ tipId: tip.id, amount: pi(tip.amount) }), t]);
    } catch { /* no integrity tables: ignore */ }
  }

  /* ======================= tips ======================= */
  async function tipIntent(user, b) {
    const pis = ctx.services.pi; if (!pis) throw E.off("مدفوعات Pi غير مفعّلة بعد");
    if (!pis.enabled()) throw E.off("مدفوعات Pi غير مفعّلة بعد");
    const sender = await userById(user.id);
    const creator = await checkPair(sender, b.toHandle);
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw E.bad("مبلغ غير صالح");
    const units = toUnits(amount);
    if (units <= 0) throw E.bad("مبلغ غير صالح");
    if (units > cfg.maxSingle) throw fail(400, "tip_max", `أعلى مبلغ للإكرامية ${pi(cfg.maxSingle)} Pi`);
    let postId = null;
    if (b.postId !== undefined && b.postId !== null && b.postId !== "") {
      postId = str(String(b.postId), 100);
      const p = await db.get("SELECT id, author, status FROM posts WHERE id=$1", [postId]);
      if (!p || p.status !== "published") throw E.nf("المنشور غير موجود");
      if (p.author !== creator.id) throw E.bad("المنشور لا يخص هذا الحساب");
    }
    const message = str(b.message, 280) || null;
    const at = clock().getTime();
    const hour = await db.get("SELECT COUNT(*) AS n FROM tips WHERE sender_id=$1 AND created_at >= $2 AND status <> 'cancelled'", [sender.id, new Date(at - HOUR).toISOString()]);
    if (Number(hour.n) >= cfg.maxHourly) throw fail(429, "tip_hourly_limit", `الحد الأقصى ${cfg.maxHourly} إكرامية في الساعة`);
    await checkDaily(sender, units, at);
    const hold = await holdReason(sender, units, at);
    const intent = await pis.createIntent(user, { amount: pi(units), memo: `إكرامية إلى @${creator.handle}`, purpose: "tip", refId: postId || creator.id });
    const tipId = id("tip");
    await db.run("INSERT INTO tips(id,sender_id,creator_id,post_id,amount,fee,message,anonymous,show_amount,intent_id,status,hold_reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12)",
      [tipId, sender.id, creator.id, postId, units, feeOf(units), message, bool(b.anonymous) ? 1 : 0, bool(b.showAmount) ? 1 : 0, intent.id, hold, new Date(at).toISOString()]);
    return { intent: { id: intent.id, amount: intent.amount, memo: intent.memo, metadata: intent.metadata }, tipId };
  }

  async function onTipPaid(tip, piTx) {
    const t = nowIso();
    if (tip.hold_reason) {
      const moved = await db.tx(async (tx) => {
        const r = await tx.run("UPDATE tips SET status='held', paid_at=$1 WHERE id=$2 AND status='pending'", [t, tip.id]);
        if (!r.changes) return false;
        await postJournal(tx, { ikey: `tip:${tip.id}:hold`, kind: "tip_hold", ...meta(tip, "tip"), piTx, lines: [{ account: ACC.out(tip.sender_id), userId: tip.sender_id, debit: Number(tip.amount) }, { account: ACC.held, credit: Number(tip.amount) }] });
        return true;
      });
      if (moved) { await softFlag(tip); ctx.audit?.("tip_held", tip.id, tip.hold_reason, "system"); }
      return;
    }
    const moved = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE tips SET status='completed', paid_at=$1, completed_at=$1 WHERE id=$2 AND status='pending'", [t, tip.id]);
      if (!r.changes) return false;
      await postJournal(tx, { ikey: `tip:${tip.id}:credit`, kind: "tip", ...meta(tip, "tip"), piTx, lines: creditLines(Number(tip.amount), Number(tip.fee), tip.sender_id, tip.creator_id) });
      return true;
    });
    if (moved) await received(tip);
  }
  async function received(tip) {
    bus.emit("TIP_RECEIVED", { tip: tip.id, creator: tip.creator_id, sender: tip.anonymous ? null : tip.sender_id, anonymous: !!tip.anonymous, amount: pi(tip.amount), postId: tip.post_id || null, actor: tip.sender_id });
    const n = ctx.services.notify;
    if (n?.notify) await n.notify(tip.creator_id, tip.anonymous ? "tip_anon" : "tip", { actor: tip.anonymous ? null : tip.sender_id, post: tip.post_id || null, ref: tip.id }).catch((e) => logger.warn?.("tip notify failed", { err: e.message }));
  }

  async function heldList() {
    const rows = await db.all("SELECT t.*, s.handle AS s_handle, s.name AS s_name, s.created_at AS s_created, c.handle AS c_handle, c.name AS c_name FROM tips t LEFT JOIN users s ON s.id=t.sender_id LEFT JOIN users c ON c.id=t.creator_id WHERE t.status='held' ORDER BY t.paid_at, t.created_at LIMIT 200");
    return { items: rows.map((r) => ({ id: r.id, amount: pi(r.amount), holdReason: r.hold_reason, postId: r.post_id || null, message: r.message || null, anonymous: !!r.anonymous, createdAt: r.created_at, paidAt: r.paid_at,
      sender: { id: r.sender_id, handle: r.s_handle, name: r.s_name, joinedAt: r.s_created }, creator: { id: r.creator_id, handle: r.c_handle, name: r.c_name } })) };
  }
  async function release(by, tipId, b) {
    const tip = await db.get("SELECT * FROM tips WHERE id=$1", [tipId]); if (!tip) throw E.nf();
    if (tip.status === "completed" && tip.reviewed_by) return { ok: true, id: tip.id, status: "completed" };
    if (tip.status !== "held") throw E.conflict("الإكرامية ليست معلّقة");
    const note = str(b.note, 300) || null, t = nowIso();
    const moved = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE tips SET status='completed', completed_at=$1, reviewed_by=$2, reviewed_at=$1, review_note=$3 WHERE id=$4 AND status='held'", [t, by.id, note, tip.id]);
      if (!r.changes) return false;
      await postJournal(tx, { ikey: `tip:${tip.id}:release`, kind: "tip_release", ...meta(tip, "tip"), lines: creditLines(Number(tip.amount), Number(tip.fee), tip.sender_id, tip.creator_id, true) });
      return true;
    });
    if (!moved) throw E.conflict("تغيّرت حالة الإكرامية، حدّث الصفحة");
    ctx.audit?.("tip_release", tip.id, note, by.id);
    await received(tip);
    return { ok: true, id: tip.id, status: "completed" };
  }
  async function reject(by, tipId, b) {
    const tip = await db.get("SELECT * FROM tips WHERE id=$1", [tipId]); if (!tip) throw E.nf();
    if (tip.status === "rejected") return { ok: true, id: tip.id, status: "rejected", refundRecorded: false };
    if (tip.status !== "held") throw E.conflict("الإكرامية ليست معلّقة");
    const note = str(b.note, 300) || null, t = nowIso();
    const moved = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE tips SET status='rejected', reviewed_by=$1, reviewed_at=$2, review_note=$3 WHERE id=$4 AND status='held'", [by.id, t, note, tip.id]);
      if (!r.changes) return false;
      await reverseAll(tx, tip.id, "rejected");
      return true;
    });
    if (!moved) throw E.conflict("تغيّرت حالة الإكرامية، حدّث الصفحة");
    ctx.audit?.("tip_reject", tip.id, note, by.id);
    // the Pi itself must be sent back by the operator outside the app (no app→user payments here); record it on the Pi row
    let refundRecorded = false;
    try { await ctx.services.pi.refund(by, tip.intent_id, { note: "إكرامية مرفوضة: " + (note || ""), txid: b.txid }); refundRecorded = true; }
    catch (e) { logger.warn?.("tip reject: pi refund not recorded", { tip: tip.id, err: e.message }); }
    return { ok: true, id: tip.id, status: "rejected", refundRecorded };
  }

  async function postTips(viewer, postId) {
    const p = await db.get("SELECT id, author, status FROM posts WHERE id=$1", [str(postId, 100, { required: true })]);
    if (!p || p.status !== "published") throw E.nf();
    const s = await settingsOf(p.author), own = viewer && (viewer.id === p.author || viewer.role === "admin");
    const agg = await db.get("SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM tips WHERE post_id=$1 AND status='completed'", [p.id]);
    const rows = await db.all("SELECT t.sender_id, t.amount, t.anonymous, t.show_amount, t.message, t.completed_at, u.handle, u.name, u.avatar FROM tips t LEFT JOIN users u ON u.id=t.sender_id WHERE t.post_id=$1 AND t.status='completed' ORDER BY t.completed_at DESC LIMIT 10", [p.id]);
    return {
      count: Number(agg.n), total: own || s.show_amounts ? pi(agg.s) : null,
      recent: rows.map((r) => ({ user: r.anonymous ? null : pubUser(r), amount: own || (s.show_amounts && r.show_amount) ? pi(r.amount) : null, at: r.completed_at, ...(own ? { message: r.anonymous && viewer.id !== p.author ? null : r.message || null } : {}) }))
    };
  }

  /* ======================= monthly support ======================= */
  function stateOf(sub, at = clock().getTime()) {
    if (!sub || !sub.started_at) return "none";
    if (sub.state === "cancelled" || sub.state === "lapsed") return sub.state;
    const until = Date.parse(sub.active_until);
    if (at > until + cfg.graceMs) return "lapsed";
    return at < until - cfg.remindMs ? "active" : "due";
  }
  const subClient = (sub, creator) => ({ id: sub.id, creator: pubUser(creator), tier: sub.tier_id ? { id: sub.tier_id, name: sub.tier_name, amount: pi(sub.amount) } : null, state: stateOf(sub), activeUntil: sub.active_until || null, startedAt: sub.started_at || null, lastPaidAt: sub.last_paid_at || null, cancelledAt: sub.cancelled_at || null, anonymous: !!sub.anonymous });

  async function supportIntent(user, b) {
    const pis = ctx.services.pi; if (!pis || !pis.enabled()) throw E.off("مدفوعات Pi غير مفعّلة بعد");
    const sender = await userById(user.id);
    const creator = await checkPair(sender, b.toHandle);
    const tier = await db.get("SELECT * FROM creator_tiers WHERE id=$1 AND creator_id=$2 AND active=1", [str(String(b.tierId ?? ""), 100, { required: true }), creator.id]);
    if (!tier) throw E.nf("المستوى غير موجود");
    const at = clock().getTime();
    let sub = await db.get("SELECT * FROM support_subscriptions WHERE supporter_id=$1 AND creator_id=$2", [sender.id, creator.id]);
    if (sub && sub.state === "active" && stateOf(sub, at) === "active") throw fail(409, "support_active", "دعمك فعّال؛ يمكنك التجديد قبل انتهائه بثلاثة أيام");
    await checkDaily(sender, Number(tier.amount), at);
    const intent = await pis.createIntent(user, { amount: pi(tier.amount), memo: `دعم شهري لـ @${creator.handle} — ${tier.name}`.slice(0, 200), purpose: "subscription", refId: creator.id });
    const t = new Date(at).toISOString();
    if (!sub) {
      await db.run("INSERT INTO support_subscriptions(id,supporter_id,creator_id,tier_id,tier_name,amount,state,anonymous,show_amount,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$9) ON CONFLICT DO NOTHING",
        [id("sup"), sender.id, creator.id, tier.id, tier.name, Number(tier.amount), bool(b.anonymous) ? 1 : 0, bool(b.showAmount) ? 1 : 0, t]);
      sub = await db.get("SELECT * FROM support_subscriptions WHERE supporter_id=$1 AND creator_id=$2", [sender.id, creator.id]);
    } else if (b.anonymous !== undefined || b.showAmount !== undefined) {
      await db.run("UPDATE support_subscriptions SET anonymous=$1, show_amount=$2, updated_at=$3 WHERE id=$4", [b.anonymous === undefined ? sub.anonymous : bool(b.anonymous) ? 1 : 0, b.showAmount === undefined ? sub.show_amount : bool(b.showAmount) ? 1 : 0, t, sub.id]);
    }
    const spId = id("spay");
    await db.run("INSERT INTO support_payments(id,support_id,supporter_id,creator_id,tier_id,tier_name,amount,fee,intent_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)",
      [spId, sub.id, sender.id, creator.id, tier.id, tier.name, Number(tier.amount), supportFeeOf(Number(tier.amount)), intent.id, t]);
    return { intent: { id: intent.id, amount: intent.amount, memo: intent.memo, metadata: intent.metadata }, supportId: sub.id, paymentId: spId };
  }

  async function onSupportPaid(sp, piTx) {
    const at = clock().getTime(), t = new Date(at).toISOString();
    const out = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE support_payments SET status='completed', completed_at=$1 WHERE id=$2 AND status='pending'", [t, sp.id]);
      if (!r.changes) return null;
      const sub = await tx.get("SELECT * FROM support_subscriptions WHERE id=$1", [sp.support_id]);
      const until = sub.active_until ? Date.parse(sub.active_until) : 0;
      const continuing = !!sub.started_at && (sub.state === "active" || sub.state === "cancelled") && until && at <= until + cfg.graceMs;
      const start = continuing ? Math.max(until, at - cfg.graceMs) : at, end = start + cfg.periodMs;
      const renewed = continuing && sub.state === "active";
      await tx.run(`UPDATE support_subscriptions SET state='active', tier_id=$1, tier_name=$2, amount=$3, active_until=$4, last_paid_at=$5, cancelled_at=NULL, lapsed_at=NULL, reminded_for=NULL, updated_at=$5${renewed ? "" : ", started_at=$5"} WHERE id=$6`,
        [sp.tier_id, sp.tier_name, Number(sp.amount), new Date(end).toISOString(), t, sub.id]);
      await tx.run("UPDATE support_payments SET period_start=$1, period_end=$2 WHERE id=$3", [new Date(start).toISOString(), new Date(end).toISOString(), sp.id]);
      await postJournal(tx, { ikey: `support:${sp.id}:credit`, kind: "support", source: "support", refId: sp.id, creatorId: sp.creator_id, senderId: sp.supporter_id, anonymous: !!sub.anonymous, showAmount: !!sub.show_amount, piTx,
        lines: creditLines(Number(sp.amount), Number(sp.fee), sp.supporter_id, sp.creator_id) });
      return { renewed, anonymous: !!sub.anonymous, activeUntil: new Date(end).toISOString(), supportId: sub.id };
    });
    if (!out) return;
    const evt = out.renewed ? "SUPPORT_RENEWED" : "SUPPORT_STARTED";
    bus.emit(evt, { support: out.supportId, payment: sp.id, creator: sp.creator_id, supporter: out.anonymous ? null : sp.supporter_id, anonymous: out.anonymous, tierId: sp.tier_id, amount: pi(sp.amount), activeUntil: out.activeUntil, actor: sp.supporter_id });
    const n = ctx.services.notify;
    if (n?.notify) await n.notify(sp.creator_id, out.anonymous ? "support_anon" : out.renewed ? "support_renewed" : "support_started", { actor: out.anonymous ? null : sp.supporter_id, ref: out.supportId }).catch(() => { });
  }

  async function cancelSupport(user, supId) {
    const sub = await db.get("SELECT * FROM support_subscriptions WHERE id=$1", [supId]);
    if (!sub || sub.supporter_id !== user.id) throw E.nf();
    const t = nowIso();
    if (sub.state === "pending" || sub.state === "active") await db.run("UPDATE support_subscriptions SET state='cancelled', cancelled_at=$1, updated_at=$1 WHERE id=$2 AND state IN ('pending','active')", [t, sub.id]);
    const now2 = await db.get("SELECT * FROM support_subscriptions WHERE id=$1", [sub.id]);
    if (now2.state === "cancelled" && sub.state !== "cancelled") { ctx.audit?.("support_cancel", sub.id, null, user.id); bus.emit("SUPPORT_CANCELLED", { support: sub.id, creator: sub.creator_id, supporter: sub.supporter_id, actor: user.id }); } // phase 57: churn stats
    const last = now2.last_paid_at ? Date.parse(now2.last_paid_at) : 0;
    return { ok: true, id: now2.id, state: stateOf(now2), activeUntil: now2.active_until || null, refundEligible: !!last && clock().getTime() - last < DAY,
      note: "يبقى دعمك فعّالاً حتى نهاية الشهر المدفوع؛ لا يُسترد مبلغ الشهر الحالي إلا خلال ٢٤ ساعة من الدفع وبموافقة الإدارة" };
  }

  async function mySupporting(user) {
    const rows = await db.all("SELECT s.*, u.handle, u.name, u.avatar FROM support_subscriptions s LEFT JOIN users u ON u.id=s.creator_id WHERE s.supporter_id=$1 AND s.started_at IS NOT NULL ORDER BY s.updated_at DESC LIMIT 200", [user.id]);
    return { items: rows.map((r) => subClient(r, r)) };
  }

  /** leased job: renewal reminders (once per period) and lapse after the grace period */
  async function supportJob() {
    const at = clock().getTime(), t = new Date(at).toISOString();
    let reminded = 0, lapsed = 0;
    const due = await db.all("SELECT s.*, u.handle AS c_handle FROM support_subscriptions s LEFT JOIN users u ON u.id=s.creator_id WHERE s.state='active' AND s.active_until <= $1 AND s.active_until >= $2 AND (s.reminded_for IS NULL OR s.reminded_for <> s.active_until) LIMIT 1000",
      [new Date(at + cfg.remindMs).toISOString(), new Date(at - cfg.graceMs).toISOString()]);
    for (const s of due) {
      const r = await db.run("UPDATE support_subscriptions SET reminded_for=active_until, updated_at=$1 WHERE id=$2 AND state='active' AND (reminded_for IS NULL OR reminded_for <> active_until)", [t, s.id]);
      if (!r.changes) continue;
      reminded++;
      await ctx.services.notify?.notify?.(s.supporter_id, "support_due", { ref: s.c_handle || null }).catch(() => { });
    }
    const old = await db.all("SELECT s.*, u.handle AS c_handle FROM support_subscriptions s LEFT JOIN users u ON u.id=s.creator_id WHERE s.state='active' AND s.active_until < $1 LIMIT 1000", [new Date(at - cfg.graceMs).toISOString()]);
    for (const s of old) {
      const r = await db.run("UPDATE support_subscriptions SET state='lapsed', lapsed_at=$1, updated_at=$1 WHERE id=$2 AND state='active' AND active_until < $3", [t, s.id, new Date(at - cfg.graceMs).toISOString()]);
      if (!r.changes) continue;
      lapsed++;
      bus.emit("SUPPORT_LAPSED", { support: s.id, creator: s.creator_id, supporter: s.supporter_id, actor: s.supporter_id });
      await ctx.services.notify?.notify?.(s.supporter_id, "support_lapsed", { ref: s.c_handle || null }).catch(() => { });
    }
    return { reminded, lapsed };
  }
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.TIPS_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("tips.support", +(env.TIPS_JOB_INTERVAL_MS || HOUR), supportJob);

  /* ======================= bus: grant on Pi events only ======================= */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("tips handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  const sameAmount = (a, units) => Math.abs(toUnits(a) - Number(units)) <= 1;
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose === "tip") {
      const tip = await db.get("SELECT * FROM tips WHERE intent_id=$1", [e.tx]); if (!tip) return;
      if (e.amount !== undefined && !sameAmount(e.amount, tip.amount)) { logger.warn?.("tip amount mismatch; not credited", { tip: tip.id }); return; }
      await onTipPaid(tip, e.tx);
    } else if (e.purpose === "subscription") {
      const sp = await db.get("SELECT * FROM support_payments WHERE intent_id=$1", [e.tx]); if (!sp) return;
      if (e.amount !== undefined && !sameAmount(e.amount, sp.amount)) { logger.warn?.("support amount mismatch; not credited", { payment: sp.id }); return; }
      await onSupportPaid(sp, e.tx);
    }
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => {
    const t = nowIso();
    if (e.purpose === "tip") await db.run("UPDATE tips SET status='cancelled', cancelled_at=$1 WHERE intent_id=$2 AND status='pending'", [t, e.tx]);
    else if (e.purpose === "subscription") await db.run("UPDATE support_payments SET status='cancelled', cancelled_at=$1 WHERE intent_id=$2 AND status='pending'", [t, e.tx]);
  }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => {
    const t = nowIso();
    if (e.purpose === "tip") {
      const tip = await db.get("SELECT * FROM tips WHERE intent_id=$1", [e.tx]); if (!tip) return;
      await db.tx(async (tx) => {
        await tx.run("UPDATE tips SET status='refunded', refunded_at=$1 WHERE id=$2 AND status IN ('completed','held')", [t, tip.id]);
        await reverseAll(tx, tip.id, "refund");
      });
    } else if (e.purpose === "subscription") {
      const sp = await db.get("SELECT * FROM support_payments WHERE intent_id=$1", [e.tx]); if (!sp) return;
      await db.tx(async (tx) => {
        const r = await tx.run("UPDATE support_payments SET status='refunded', refunded_at=$1 WHERE id=$2 AND status='completed'", [t, sp.id]);
        await reverseAll(tx, sp.id, "refund");
        if (!r.changes) return;
        // the refunded month no longer counts: the support ends where that month began
        const sub = await tx.get("SELECT * FROM support_subscriptions WHERE id=$1", [sp.support_id]);
        if (sub && sp.period_end && sub.active_until && Date.parse(sub.active_until) === Date.parse(sp.period_end))
          await tx.run("UPDATE support_subscriptions SET active_until=$1, state='cancelled', cancelled_at=COALESCE(cancelled_at,$2), updated_at=$2 WHERE id=$3", [sp.period_start, t, sub.id]);
      });
    }
  }));
  bus.on("USER_ANONYMISED", track(async (e) => { if (e?.user) await db.run("UPDATE tips SET message=NULL WHERE sender_id=$1", [e.user]); }));

  /* ======================= public creator page, honour roll ======================= */
  const PERIODS = ["month", "all"];
  function monthStart(at) { const d = new Date(at); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(); }
  /** journals of a creator with their gross (creator net + platform fee) — reversals carry negative values */
  async function creatorJournals(creatorId, from, to) {
    const args = [creatorId, ACC.earn(creatorId), ACC.fees]; let where = "j.creator_id=$1";
    if (from) { args.push(from); where += ` AND j.created_at >= $${args.length}`; }
    if (to) { args.push(to); where += ` AND j.created_at < $${args.length}`; }
    const rows = await db.all(`SELECT j.id, j.kind, j.source, j.ref_id, j.sender_id, j.post_id, j.anonymous, j.show_amount, j.created_at,
        COALESCE(SUM(CASE WHEN e.account=$2 THEN e.credit - e.debit ELSE 0 END),0) AS net, COALESCE(SUM(CASE WHEN e.account=$3 THEN e.credit - e.debit ELSE 0 END),0) AS fee
      FROM ledger_journals j JOIN ledger_entries e ON e.journal_id=j.id WHERE ${where}
      GROUP BY j.id, j.kind, j.source, j.ref_id, j.sender_id, j.post_id, j.anonymous, j.show_amount, j.created_at ORDER BY j.created_at, j.id`, args);
    return rows.map((r) => ({ ...r, net: Number(r.net), fee: Number(r.fee), created_at: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString() }));
  }
  async function usersMap(ids) {
    const list = [...new Set(ids.filter(Boolean))]; const m = new Map();
    for (let i = 0; i < list.length; i += 200) {
      const ch = list.slice(i, i + 200);
      for (const u of await db.all(`SELECT id, handle, name, avatar, status FROM users WHERE id IN (${ch.map((_, k) => "$" + (k + 1)).join(",")})`, ch)) m.set(u.id, u);
    }
    return m;
  }
  async function leaderboard(creatorId, period, showAmounts, limit = 50) {
    const js = (await creatorJournals(creatorId, period === "month" ? monthStart(clock().getTime()) : null, null)).filter((j) => j.net + j.fee !== 0 && j.source !== "ppv"); // purchases are private, not support
    const by = new Map();
    for (const j of js) {
      const k = j.sender_id + "|" + (j.anonymous ? 1 : 0);
      const g = by.get(k) || { sender: j.sender_id, anonymous: !!j.anonymous, total: 0, count: 0, show: true, kinds: new Set() };
      g.total += j.net + j.fee; if (j.kind !== "reversal") { g.count++; g.kinds.add(j.source); } if (!j.show_amount) g.show = false;
      by.set(k, g);
    }
    const top = [...by.values()].filter((g) => g.total > 0).sort((a, b) => b.total - a.total || b.count - a.count).slice(0, limit);
    const um = await usersMap(top.filter((g) => !g.anonymous).map((g) => g.sender));
    return top.map((g, i) => {
      const u = g.anonymous ? null : um.get(g.sender);
      return { rank: i + 1, user: u && u.status !== "deleted" ? pubUser(u) : null, amount: showAmounts && g.show ? pi(g.total) : null, count: g.count, kinds: [...g.kinds] };
    });
  }
  async function supportPage(viewer, handle) {
    const c = await userByHandle(handleOf(handle));
    if (!c || c.status !== "active") throw E.nf("الحساب غير موجود");
    const s = await settingsOf(c.id), enabled = !!s.enabled && !(await isMinor(c.id));
    const tiers = enabled ? (await tiersOf(c.id)).map(tierClient) : [];
    const at = clock().getTime();
    const subs = await db.all("SELECT state, active_until, started_at FROM support_subscriptions WHERE creator_id=$1 AND state='active' AND started_at IS NOT NULL", [c.id]);
    const supporters = subs.filter((x) => at <= Date.parse(x.active_until) + cfg.graceMs).length;
    const tipsCount = Number((await db.get("SELECT COUNT(*) AS n FROM tips WHERE creator_id=$1 AND status='completed'", [c.id])).n);
    let myStatus = { tier: null, activeUntil: null, state: "none" };
    if (viewer) {
      const sub = await db.get("SELECT * FROM support_subscriptions WHERE supporter_id=$1 AND creator_id=$2", [viewer.id, c.id]);
      if (sub && sub.started_at) myStatus = { tier: sub.tier_id ? { id: sub.tier_id, name: sub.tier_name, amount: pi(sub.amount) } : null, activeUntil: sub.active_until || null, state: stateOf(sub, at), supportId: sub.id };
    }
    const recent = await db.all("SELECT j.kind, j.source, j.sender_id, j.anonymous, j.show_amount, j.created_at, COALESCE(SUM(CASE WHEN e.debit > 0 THEN e.debit ELSE 0 END),0) AS gross FROM ledger_journals j JOIN ledger_entries e ON e.journal_id=j.id WHERE j.creator_id=$1 AND j.kind IN ('tip','tip_release','support') AND NOT EXISTS (SELECT 1 FROM ledger_journals r WHERE r.reverses=j.id) GROUP BY j.id, j.kind, j.source, j.sender_id, j.anonymous, j.show_amount, j.created_at ORDER BY j.created_at DESC LIMIT 20", [c.id]);
    const um = await usersMap(recent.filter((r) => !r.anonymous).map((r) => r.sender_id));
    const wall = recent.map((r) => { const u = r.anonymous ? null : um.get(r.sender_id); return { user: u && u.status !== "deleted" ? pubUser(u) : null, amount: s.show_amounts && r.show_amount ? pi(r.gross) : null, kind: r.source === "support" ? "support" : "tip", at: typeof r.created_at === "string" ? r.created_at : new Date(r.created_at).toISOString() }; });
    return { creator: { id: c.id, handle: c.handle, name: c.name, avatar: c.avatar || null, enabled }, tiers, stats: { supporters, tipsCount }, myStatus, wall };
  }
  async function wallRoute(handle, q) {
    const c = await userByHandle(handleOf(handle));
    if (!c || c.status !== "active") throw E.nf("الحساب غير موجود");
    const period = PERIODS.includes(q.period) ? q.period : "month";
    const s = await settingsOf(c.id);
    return { creator: { handle: c.handle, name: c.name, avatar: c.avatar || null }, period, items: await leaderboard(c.id, period, !!s.show_amounts, 50) };
  }

  /* ======================= earnings ======================= */
  function range(q) {
    const at = clock().getTime();
    const valid = (d) => DATE_RE.test(d) && !isNaN(Date.parse(d + "T00:00:00Z"));
    if (q.from || q.to) {
      const from = q.from ? String(q.from) : null, to = q.to ? String(q.to) : null;
      if ((from && !valid(from)) || (to && !valid(to))) throw E.bad("تاريخ غير صالح");
      const f = from ? Date.parse(from + "T00:00:00Z") : at - 30 * DAY, t = to ? Date.parse(to + "T00:00:00Z") + DAY : at + 1;
      if (t <= f) throw E.bad("نطاق التاريخ غير صالح");
      if (t - f > 366 * DAY) throw E.bad("أقصى نطاق سنة واحدة");
      return { period: "custom", from: new Date(f).toISOString(), to: new Date(t).toISOString() };
    }
    const period = ["day", "week", "month"].includes(q.period) ? q.period : "month";
    const days = { day: 1, week: 7, month: 30 }[period];
    const end = Date.parse(new Date(at).toISOString().slice(0, 10) + "T00:00:00Z") + DAY;
    return { period, from: new Date(end - days * DAY).toISOString(), to: new Date(end).toISOString() };
  }
  async function earnings(user, q) {
    const r = range(q || {});
    const js = await creatorJournals(user.id, r.from, r.to);
    let gross = 0, fees = 0, refunds = 0, net = 0;
    const series = new Map(), src = { tips: 0, support: 0, ppv: 0 }, posts = new Map(), sup = new Map();
    for (let d = Date.parse(r.from); d < Date.parse(r.to); d += DAY) series.set(new Date(d).toISOString().slice(0, 10), { gross: 0, net: 0 });
    for (const j of js) {
      const g = j.net + j.fee, day = j.created_at.slice(0, 10), s = series.get(day) || { gross: 0, net: 0 };
      net += j.net; s.net += j.net;
      if (j.kind === "reversal") refunds += -j.net;
      else if (j.kind !== "tip_hold") { gross += g; fees += j.fee; s.gross += g; }
      series.set(day, s);
      src[j.source === "support" ? "support" : j.source === "ppv" ? "ppv" : "tips"] += g;
      if (j.post_id) posts.set(j.post_id, (posts.get(j.post_id) || 0) + g);
      const k = j.anonymous ? "anon" : j.sender_id;
      const e = sup.get(k) || { sender: j.anonymous ? null : j.sender_id, total: 0, count: 0 };
      e.total += g; if (j.kind !== "reversal" && j.kind !== "tip_hold") e.count++; sup.set(k, e);
    }
    const topSup = [...sup.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total).slice(0, 10);
    const um = await usersMap(topSup.map((x) => x.sender));
    const qs = `from=${r.from.slice(0, 10)}&to=${new Date(Date.parse(r.to) - DAY).toISOString().slice(0, 10)}`;
    return {
      currency: "Pi", period: r.period, from: r.from, to: r.to, gross: pi(gross), fees: pi(fees), net: pi(net), refunds: pi(refunds),
      series: [...series.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, gross: pi(v.gross), net: pi(v.net) })),
      bySource: { tips: pi(src.tips), support: pi(src.support), ppv: pi(src.ppv) },
      topPosts: [...posts.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([postId, v]) => ({ postId, total: pi(v) })),
      topSupporters: topSup.map((x) => ({ user: x.sender ? pubUser(um.get(x.sender)) : null, anonymous: !x.sender, total: pi(x.total), count: x.count })),
      csvUrl: "/api/me/earnings.csv?" + qs
    };
  }
  const csvCell = (v) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  async function earningsCsv(req, res) {
    const r = range(req.query || {});
    const js = await creatorJournals(req.user.id, r.from, r.to);
    const um = await usersMap(js.filter((j) => !j.anonymous).map((j) => j.sender_id));
    const KIND = { tip: "إكرامية", tip_hold: "إكرامية معلّقة", tip_release: "إكرامية (بعد المراجعة)", support: "دعم شهري", ppv: "محتوى مدفوع", reversal: "استرداد" };
    const lines = ["date,journal,kind,source,post,supporter,gross,fee,net"];
    for (const j of js) lines.push([j.created_at, j.id, KIND[j.kind] || j.kind, j.source, j.post_id || "", j.anonymous ? "مجهول" : "@" + (um.get(j.sender_id)?.handle || "?"), pi(j.kind === "tip_hold" ? 0 : j.net + j.fee), pi(j.fee), pi(j.net)].map(csvCell).join(","));
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="earnings-${r.from.slice(0, 10)}-${r.to.slice(0, 10)}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end("\uFEFF" + lines.join("\r\n"));
    return ctx.STREAM;
  }
  async function myLedger(user, q) {
    const limit = Math.min(100, Math.max(1, +q.limit || 50));
    let after = null;
    if (q.cursor) { const v = Number(Buffer.from(String(q.cursor), "base64url").toString()); if (!Number.isInteger(v) || v <= 0) throw E.bad("مؤشر غير صالح"); after = v; }
    const args = [user.id]; let where = "e.user_id=$1";
    if (after) { args.push(after); where += " AND e.id < $2"; }
    const rows = await db.all(`SELECT e.id, e.journal_id, e.account, e.debit, e.credit, e.created_at, j.kind, j.source, j.ref_id, j.reverses FROM ledger_entries e JOIN ledger_journals j ON j.id=e.journal_id WHERE ${where} ORDER BY e.id DESC LIMIT ${limit + 1}`, args);
    const more = rows.length > limit, page = rows.slice(0, limit);
    const own = (acc) => (acc.startsWith("creator:") ? "earnings" : "pi_out");
    return {
      entries: page.map((e) => ({ id: Number(e.id), journalId: e.journal_id, kind: e.kind, source: e.source, refId: e.ref_id, reverses: e.reverses || null, account: own(e.account), debit: pi(e.debit), credit: pi(e.credit),
        amount: own(e.account) === "earnings" ? pi(Number(e.credit) - Number(e.debit)) : pi(Number(e.debit) - Number(e.credit)), at: e.created_at })),
      nextCursor: more ? Buffer.from(String(page[page.length - 1].id)).toString("base64url") : null
    };
  }

  /* ======================= routes ======================= */
  R.get("/api/creators/:handle/support", async (req) => supportPage(req.user || null, req.params.handle));
  R.get("/api/creators/:handle/wall", async (req) => wallRoute(req.params.handle, req.query || {}));
  R.get("/api/me/creator", A(async (req) => getCreator(req.user)));
  R.put("/api/me/creator", A(async (req) => putCreator(req.user, req.body)));
  R.post("/api/tips/intent", A(async (req) => tipIntent(req.user, req.body)));
  R.post("/api/support/intent", A(async (req) => supportIntent(req.user, req.body)));
  R.post("/api/support/:id/cancel", A(async (req) => cancelSupport(req.user, req.params.id)));
  R.get("/api/me/supporting", A(async (req) => mySupporting(req.user)));
  R.get("/api/posts/:id/tips", async (req) => postTips(req.user || null, req.params.id));
  R.get("/api/me/earnings", A(async (req) => earnings(req.user, req.query)));
  R.get("/api/me/earnings.csv", A(earningsCsv));
  R.get("/api/me/ledger", A(async (req) => myLedger(req.user, req.query || {})));
  R.get("/api/admin/tips/held", admin(async () => heldList()));
  R.post("/api/admin/tips/:id/release", admin(async (req) => release(req.user, req.params.id, req.body)));
  R.post("/api/admin/tips/:id/reject", admin(async (req) => reject(req.user, req.params.id, req.body)));
  R.get("/api/admin/ledger/check", admin(async () => ledgerCheck()));

  return { config: cfg, supportJob, ledgerCheck, earnings, settle, stateOf, isMinor, supportIntent, checkPair, blockedBetween }; // phase 57 reuses supportIntent for renewals
};
