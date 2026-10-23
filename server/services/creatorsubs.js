/* Creator monthly subscriptions with tiers (phase 57). Extends — never duplicates — phase 37 (creator_tiers, monthly support
 * = support_subscriptions/support_payments, reminders 3 days before expiry, 3-day grace, lapse) and phase 38 (supporter-only
 * posts by minimum tier). This service adds:
 * 1. Tier benefits (sub_tier_meta): posts (supporter-only posts), channel (subscriber chat), badge (label + emoji shown next
 *    to the subscriber in the channel and via /api/subs/badges), early (early access: hours before a post goes public),
 *    plus a description. Tier names/amounts stay in PUT /api/me/creator (phase 37).
 * 2. Renewal (POST /api/subs/:handle/renew): a user-confirmed Pi payment (purpose `subscription`, reusing tips.supportIntent)
 *    at the current tier or at a scheduled downgrade; the phase 37 job reminds 3 days before expiry; this service adds a
 *    grace-period reminder (sub_grace) once the period has ended but before the lapse.
 * 3. Tier changes (lib/ledger.js PRORATION rules): upgrade = prorated user-confirmed payment (sub_changes.intent_id, purpose
 *    `subscription`, journal ref = change id) applied on PI_PAYMENT_COMPLETED; tiny charges waived; downgrade scheduled for
 *    the next renewal; refund of an upgrade reverses its journal and reverts the tier.
 * 4. Subscriber channel (sub_channel_msgs): creator + current subscribers whose tier has the `channel` benefit.
 * 5. Early access (sub_early): a supporter-only post (phase 38) released to everyone at public_at by a leased job (body moves
 *    back from paid_content to posts, paid media unlocked).
 * 6. Creator studio: subscriber list (anonymous supporters stay anonymous), churn stats (sub_events), MRR, by tier, 6 months.
 * Minors (< 18) can neither subscribe nor offer subscriptions (tips.checkPair / isMinor). Pi payments off → change/renew
 * answer 501 not_configured; reading, tier benefits and the channel keep working. */
const { E, HttpError, str, id } = require("../lib/core");
const { pi, toUnits, createLedger, prorate, PRORATION } = require("../lib/ledger");

const DAY = 864e5, HOUR = 3600e3;
const BENEFITS = ["posts", "channel", "badge", "early"];
const BENEFIT_AR = { posts: "منشورات للمشتركين فقط", channel: "قناة دردشة المشتركين", badge: "شارة مشترك", early: "وصول مبكر للمنشورات" };

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus } = ctx, R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const tips = () => ctx.services.tips;
  const cfg = () => tips().config; // periodMs, remindMs, graceMs, feeBps
  const feeOf = (u) => Math.floor((u * (cfg().supportFeeBps ?? cfg().feeBps)) / 10000);
  const piOn = () => !!ctx.services.pi?.enabled?.();
  const requirePi = () => { if (!piOn()) throw fail(501, "not_configured", "مدفوعات Pi غير مفعّلة بعد؛ الاشتراكات تعمل فور تفعيلها"); };
  const { postJournal, creditLines, reverseAll } = createLedger({ now: nowIso });
  const handleOf = (h) => str(String(h ?? "").replace(/^@/, ""), 60, { required: true });
  const pubUser = (u) => (u ? { handle: u.handle, name: u.name, avatar: u.avatar || null } : null);
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const isMinor = (uid) => tips().isMinor(uid);

  async function creatorByHandle(h) {
    const c = await db.get("SELECT id, handle, name, avatar, status FROM users WHERE handle=$1", [handleOf(h)]);
    if (!c || c.status !== "active") throw E.nf("الحساب غير موجود");
    return c;
  }
  const tiersOf = (cid) => db.all("SELECT * FROM creator_tiers WHERE creator_id=$1 AND active=1 ORDER BY amount, position", [cid]);
  async function metaMap(cid) { return new Map((await db.all("SELECT * FROM sub_tier_meta WHERE creator_id=$1", [cid])).map((m) => [m.tier_id, m])); }
  const metaClient = (m) => ({ benefits: m ? parse(m.benefits, []).filter((b) => BENEFITS.includes(b)) : ["posts"], badge: m?.badge || null, badgeEmoji: m?.badge_emoji || null, earlyHours: Number(m?.early_hours || 0), description: m?.description || "" });
  const tierClient = (t, m) => ({ id: t.id, name: t.name, amount: pi(t.amount), perks: t.perks || "", ...metaClient(m) });
  const subOf = (uid, cid) => db.get("SELECT * FROM support_subscriptions WHERE supporter_id=$1 AND creator_id=$2", [uid, cid]);
  /** current = paid period not over (+ grace). Cancelled keeps benefits until active_until (phase 38 rule). */
  function current(sub, at = clock().getTime()) {
    if (!sub || !sub.started_at || !sub.active_until) return false;
    const until = Date.parse(sub.active_until);
    if (sub.state === "active") return at <= until + cfg().graceMs;
    if (sub.state === "cancelled") return at <= until;
    return false;
  }
  function statusOf(sub, at = clock().getTime()) {
    if (!sub || !sub.started_at) return "none";
    const st = tips().stateOf(sub, at);
    if (st === "due" && at > Date.parse(sub.active_until)) return "grace";
    return st;
  }
  async function event(kind, sub, extra = {}) {
    if (!sub) return;
    await db.run("INSERT INTO sub_events(id,creator_id,supporter_id,support_id,kind,tier_id,amount,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [id("sev"), sub.creator_id, sub.supporter_id, sub.id, kind, extra.tierId ?? sub.tier_id ?? null, Number(extra.amount ?? sub.amount ?? 0), nowIso()]).catch((e) => logger.warn?.("sub event failed", { err: e.message }));
  }
  const tierBenefit = async (sub, b) => { if (!sub?.tier_id) return false; const m = await db.get("SELECT benefits FROM sub_tier_meta WHERE tier_id=$1", [sub.tier_id]); return metaClient(m).benefits.includes(b); };

  /* ======================= 1. tier benefits ======================= */
  async function putTiers(user, b) {
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "الاشتراكات غير متاحة لمن هم دون ١٨ سنة");
    if (!Array.isArray(b.tiers)) throw E.bad("قائمة المستويات غير صالحة");
    const own = new Map((await tiersOf(user.id)).map((t) => [t.id, t]));
    const rows = b.tiers.map((t) => {
      if (!t || !own.has(String(t.id))) throw E.bad("مستوى غير معروف — أنشئ المستوى أولاً من إعدادات الدعم");
      const benefits = Array.isArray(t.benefits) ? [...new Set(t.benefits.map(String))] : [];
      if (benefits.some((x) => !BENEFITS.includes(x))) throw E.bad("ميزة غير معروفة");
      const earlyHours = Math.floor(Number(t.earlyHours || 0));
      if (!Number.isFinite(earlyHours) || earlyHours < 0 || earlyHours > 168) throw E.bad("الوصول المبكر من ساعة إلى ٧ أيام");
      const emoji = t.badgeEmoji ? String(t.badgeEmoji).trim() : "";
      if (emoji && [...emoji].length > 2) throw E.bad("رمز الشارة حرف أو رمز تعبيري واحد");
      return { id: String(t.id), benefits, badge: str(t.badge, 24) || null, emoji: emoji || null, earlyHours: benefits.includes("early") ? earlyHours || 24 : 0, description: str(t.description, 300) || null };
    });
    const t = nowIso();
    await db.tx(async (tx) => { for (const r of rows) await tx.run("INSERT INTO sub_tier_meta(tier_id,creator_id,benefits,badge,badge_emoji,early_hours,description,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tier_id) DO UPDATE SET benefits=$3, badge=$4, badge_emoji=$5, early_hours=$6, description=$7, updated_at=$8",
      [r.id, user.id, JSON.stringify(r.benefits), r.badge, r.emoji, r.earlyHours, r.description, t]); });
    return myTiers(user);
  }
  async function myTiers(user) { const m = await metaMap(user.id); return { tiers: (await tiersOf(user.id)).map((t) => tierClient(t, m.get(t.id))), benefits: BENEFITS.map((k) => ({ key: k, label: BENEFIT_AR[k] })) }; }

  /* ======================= public page + my status ======================= */
  async function page(viewer, handle) {
    const c = await creatorByHandle(handle);
    const s = await db.get("SELECT enabled FROM creator_settings WHERE user_id=$1", [c.id]);
    const enabled = !!Number(s?.enabled || 0) && !(await isMinor(c.id));
    const m = await metaMap(c.id), tiers = enabled ? (await tiersOf(c.id)).map((t) => tierClient(t, m.get(t.id))) : [];
    const at = clock().getTime();
    let me = { state: "none" };
    if (viewer && viewer.id !== c.id) {
      const sub = await subOf(viewer.id, c.id);
      if (sub?.started_at) {
        const sched = await db.get("SELECT * FROM sub_changes WHERE support_id=$1 AND kind='downgrade' AND status='scheduled' ORDER BY created_at DESC LIMIT 1", [sub.id]);
        const st = statusOf(sub, at);
        me = { supportId: sub.id, state: st, tier: sub.tier_id ? { id: sub.tier_id, name: sub.tier_name, amount: pi(sub.amount) } : null, activeUntil: sub.active_until, current: current(sub, at),
          canRenew: ["due", "grace", "cancelled", "lapsed"].includes(st), graceUntil: new Date(Date.parse(sub.active_until) + cfg().graceMs).toISOString(),
          daysLeft: Math.max(0, Math.ceil((Date.parse(sub.active_until) - at) / DAY)), scheduled: sched ? { tierId: sched.to_tier_id, effectiveAt: sched.effective_at } : null,
          channel: current(sub, at) && (await tierBenefit(sub, "channel")) };
      }
      me.minor = await isMinor(viewer.id);
    }
    const subscribers = Number((await db.get("SELECT COUNT(*) n FROM support_subscriptions WHERE creator_id=$1 AND state='active' AND active_until >= $2", [c.id, new Date(at - cfg().graceMs).toISOString()])).n);
    return { creator: { ...pubUser(c), enabled }, tiers, me, stats: { subscribers }, payments: piOn(), isOwner: !!viewer && viewer.id === c.id,
      rules: { periodDays: Math.round(cfg().periodMs / DAY), remindDays: Math.round(cfg().remindMs / DAY), graceDays: Math.round(cfg().graceMs / DAY), minCharge: pi(PRORATION.minCharge) } };
  }

  /* ======================= 2. renewal ======================= */
  async function renew(user, handle, b) {
    requirePi();
    const c = await creatorByHandle(handle);
    const sub = await subOf(user.id, c.id);
    let tierId = b.tierId ? String(b.tierId) : null;
    if (!tierId && sub) {
      const sched = await db.get("SELECT * FROM sub_changes WHERE support_id=$1 AND kind='downgrade' AND status='scheduled' ORDER BY created_at DESC LIMIT 1", [sub.id]);
      tierId = sched?.to_tier_id || sub.tier_id;
    }
    if (!tierId) throw E.bad("اختر مستوى الاشتراك");
    return tips().supportIntent(user, { toHandle: c.handle, tierId, anonymous: b.anonymous, showAmount: b.showAmount });
  }

  /* ======================= 3. tier changes ======================= */
  async function quote(user, handle, tierId) {
    const c = await creatorByHandle(handle);
    const tier = await db.get("SELECT * FROM creator_tiers WHERE id=$1 AND creator_id=$2 AND active=1", [str(String(tierId ?? ""), 100, { required: true }), c.id]);
    if (!tier) throw E.nf("المستوى غير موجود");
    const sub = await subOf(user.id, c.id), at = clock().getTime();
    const inPeriod = !!sub && ["active", "cancelled"].includes(sub.state) && !!sub.started_at;
    const q = prorate({ fromAmount: sub?.amount || 0, toAmount: tier.amount, activeUntil: sub?.active_until, at, periodMs: cfg().periodMs, inPeriod });
    return { c, tier, sub, q, client: { kind: q.kind, charge: pi(q.charge), waived: !!q.waived, effectiveAt: q.effectiveAt, remainingDays: Math.round((q.remainingMs / DAY) * 10) / 10, from: sub?.tier_id ? { id: sub.tier_id, name: sub.tier_name, amount: pi(sub.amount) } : null, to: { id: tier.id, name: tier.name, amount: pi(tier.amount) } } };
  }
  async function change(user, handle, b) {
    requirePi();
    const { c, tier, sub, q, client } = await quote(user, handle, b.tierId);
    await tips().checkPair({ id: user.id }, c.handle); // creator opted in, not self, no minors, no blocks
    if (q.kind === "same") throw fail(409, "same_tier", "أنت مشترك في هذا المستوى");
    if (q.kind === "renew") throw fail(409, "not_in_period", "لا توجد فترة مدفوعة حالية؛ جدّد الاشتراك بالمستوى الذي تختاره");
    const t = nowIso();
    await db.run("UPDATE sub_changes SET status='superseded', cancelled_at=$1 WHERE support_id=$2 AND status IN ('scheduled','pending')", [t, sub.id]);
    const cid = id("sch");
    const base = [cid, sub.id, user.id, c.id, q.kind, sub.tier_id, tier.id, Number(sub.amount), Number(tier.amount)];
    if (q.kind === "downgrade") {
      await db.run("INSERT INTO sub_changes(id,support_id,supporter_id,creator_id,kind,from_tier_id,to_tier_id,from_amount,to_amount,charge,fee,remaining_ms,status,effective_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10,'scheduled',$11,$12)", [...base, q.remainingMs, q.effectiveAt, t]);
      await event("downgrade_scheduled", sub, { tierId: tier.id, amount: tier.amount });
      return { ...client, changeId: cid, changeStatus: "scheduled", note: "يبقى مستواك الحالي ومزاياه حتى نهاية الفترة المدفوعة، ثم يبدأ المستوى الجديد عند التجديد" };
    }
    if (q.waived || q.charge === 0) {
      await db.run("INSERT INTO sub_changes(id,support_id,supporter_id,creator_id,kind,from_tier_id,to_tier_id,from_amount,to_amount,charge,fee,remaining_ms,status,effective_at,created_at,applied_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,0,$10,'applied',$11,$11,$11)", [...base, q.remainingMs, t]);
      await applyUpgrade(cid);
      return { ...client, changeId: cid, changeStatus: "applied" };
    }
    const intent = await ctx.services.pi.createIntent(user, { amount: pi(q.charge), memo: `ترقية اشتراك @${c.handle} إلى ${tier.name}`.slice(0, 200), purpose: "subscription", refId: c.id });
    await db.run("INSERT INTO sub_changes(id,support_id,supporter_id,creator_id,kind,from_tier_id,to_tier_id,from_amount,to_amount,charge,fee,remaining_ms,intent_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)",
      [...base, q.charge, feeOf(q.charge), q.remainingMs, intent.id, t]);
    return { ...client, changeId: cid, changeStatus: "pending", intent: { id: intent.id, amount: intent.amount, memo: intent.memo, metadata: intent.metadata } };
  }
  async function applyUpgrade(cid, piTx = null) {
    const t = nowIso();
    const out = await db.tx(async (tx) => {
      const ch = await tx.get("SELECT * FROM sub_changes WHERE id=$1", [cid]); if (!ch) return null;
      if (ch.status === "pending") { const r = await tx.run("UPDATE sub_changes SET status='applied', applied_at=$1, effective_at=$1 WHERE id=$2 AND status='pending'", [t, cid]); if (!r.changes) return null; }
      else if (ch.status !== "applied") return null;
      const tier = await tx.get("SELECT * FROM creator_tiers WHERE id=$1", [ch.to_tier_id]);
      await tx.run("UPDATE support_subscriptions SET tier_id=$1, tier_name=$2, amount=$3, updated_at=$4 WHERE id=$5", [ch.to_tier_id, tier?.name || null, Number(ch.to_amount), t, ch.support_id]);
      if (Number(ch.charge) > 0) await postJournal(tx, { ikey: `subchange:${ch.id}:credit`, kind: "support", source: "support", refId: ch.id, creatorId: ch.creator_id, senderId: ch.supporter_id, piTx, memo: "upgrade", lines: creditLines(Number(ch.charge), Number(ch.fee), ch.supporter_id, ch.creator_id) });
      return ch;
    });
    if (!out) return;
    const sub = await db.get("SELECT * FROM support_subscriptions WHERE id=$1", [out.support_id]);
    await event("upgraded", sub, { tierId: out.to_tier_id, amount: out.to_amount });
    const anon = !!Number(sub?.anonymous || 0);
    await ctx.services.notify?.notify?.(out.creator_id, "sub_upgraded", { actor: anon ? null : out.supporter_id, ref: out.support_id }).catch(() => { });
  }
  async function cancelChange(user, handle) {
    const c = await creatorByHandle(handle), sub = await subOf(user.id, c.id); if (!sub) throw E.nf();
    const r = await db.run("UPDATE sub_changes SET status='cancelled', cancelled_at=$1 WHERE support_id=$2 AND status='scheduled'", [nowIso(), sub.id]);
    return { ok: true, cancelled: r.changes };
  }

  /* ======================= 4. subscriber channel ======================= */
  async function channelAccess(user, c) {
    if (user.id === c.id) return "owner";
    if (user.role === "admin") return "admin";
    if (await isMinor(user.id)) return null;
    const sub = await subOf(user.id, c.id);
    return current(sub) && (await tierBenefit(sub, "channel")) ? "member" : null;
  }
  async function badgesFor(cid, uids) {
    const list = [...new Set(uids.filter(Boolean))]; if (!list.length) return new Map();
    const ph = list.map((_, i) => "$" + (i + 2)).join(",");
    const subs = await db.all(`SELECT s.*, m.badge, m.badge_emoji, m.benefits FROM support_subscriptions s LEFT JOIN sub_tier_meta m ON m.tier_id=s.tier_id WHERE s.creator_id=$1 AND s.supporter_id IN (${ph})`, [cid, ...list]);
    const out = new Map();
    for (const s of subs) if (current(s) && !Number(s.anonymous || 0) && parse(s.benefits, []).includes("badge")) out.set(s.supporter_id, { label: s.badge || s.tier_name || "مشترك", emoji: s.badge_emoji || "⭐", tier: s.tier_name, since: s.started_at });
    return out;
  }
  async function channel(user, handle, q) {
    const c = await creatorByHandle(handle), access = await channelAccess(user, c);
    if (!access) throw fail(403, "subscribers_only", "القناة للمشتركين في مستوى يتضمن قناة الدردشة");
    const args = [c.id]; let where = "m.creator_id=$1 AND m.deleted_at IS NULL";
    if (q.before) { args.push(String(q.before)); where += " AND m.created_at < $2"; }
    const rows = await db.all(`SELECT m.*, u.handle, u.name, u.avatar FROM sub_channel_msgs m LEFT JOIN users u ON u.id=m.author_id WHERE ${where} ORDER BY m.created_at DESC LIMIT 50`, args);
    const badges = await badgesFor(c.id, rows.map((r) => r.author_id));
    return { creator: pubUser(c), access, items: rows.reverse().map((r) => ({ id: r.id, text: r.text, at: r.created_at, author: pubUser(r), isCreator: r.author_id === c.id, badge: badges.get(r.author_id) || null, mine: r.author_id === user.id, canDelete: r.author_id === user.id || access !== "member" })) };
  }
  const rate = new Map();
  async function postChannel(user, handle, b) {
    const c = await creatorByHandle(handle), access = await channelAccess(user, c);
    if (!access) throw fail(403, "subscribers_only", "القناة للمشتركين في مستوى يتضمن قناة الدردشة");
    const text = str(b.text, 1000, { required: true });
    const t0 = Date.now(), hits = (rate.get(user.id) || []).filter((x) => t0 - x < 60e3); if (hits.length >= 20) throw E.rate(); hits.push(t0); rate.set(user.id, hits);
    if (c.id !== user.id && (await tips().blockedBetween(user.id, c.id))) throw fail(403, "blocked", "غير مسموح");
    const mid = id("scm"), at = nowIso();
    await db.run("INSERT INTO sub_channel_msgs(id,creator_id,author_id,text,created_at) VALUES($1,$2,$3,$4,$5)", [mid, c.id, user.id, text, at]);
    ctx.realtime?.publish?.("subch:" + c.id, { type: "sub_channel", id: mid });
    if (access === "owner") { // creator posts notify current channel members (bounded)
      const subs = await db.all("SELECT s.* FROM support_subscriptions s JOIN sub_tier_meta m ON m.tier_id=s.tier_id WHERE s.creator_id=$1 AND s.state IN ('active','cancelled') AND s.active_until >= $2 LIMIT 500", [c.id, at]);
      for (const s of subs) if (parse((await db.get("SELECT benefits FROM sub_tier_meta WHERE tier_id=$1", [s.tier_id]))?.benefits, []).includes("channel")) await ctx.services.notify?.notify?.(s.supporter_id, "sub_channel", { actor: c.id, ref: c.handle }).catch(() => { });
    }
    return { ok: true, id: mid, at };
  }
  async function delChannel(user, handle, mid) {
    const c = await creatorByHandle(handle), access = await channelAccess(user, c);
    const m = await db.get("SELECT * FROM sub_channel_msgs WHERE id=$1 AND creator_id=$2", [mid, c.id]);
    if (!m || m.deleted_at) throw E.nf();
    if (!(m.author_id === user.id || access === "owner" || access === "admin")) throw E.forbid();
    await db.run("UPDATE sub_channel_msgs SET deleted_at=$1 WHERE id=$2", [nowIso(), mid]);
    return { ok: true };
  }
  async function badgesRoute(handle, users) {
    const c = await creatorByHandle(handle);
    const hs = String(users || "").split(",").map((x) => x.trim().replace(/^@/, "")).filter(Boolean).slice(0, 100);
    if (!hs.length) return { badges: {} };
    const us = await db.all(`SELECT id, handle FROM users WHERE handle IN (${hs.map((_, i) => "$" + (i + 1)).join(",")})`, hs);
    const b = await badgesFor(c.id, us.map((u) => u.id));
    return { badges: Object.fromEntries(us.filter((u) => b.has(u.id)).map((u) => [u.handle, b.get(u.id)])) };
  }

  /* ======================= 5. early access ======================= */
  async function setEarly(user, b) {
    const pid = str(String(b.postId ?? ""), 100, { required: true });
    const pp = await db.get("SELECT * FROM paid_posts WHERE post_id=$1", [pid]);
    if (!pp || pp.creator_id !== user.id || pp.mode !== "supporters" || pp.state !== "active") throw fail(400, "not_supporters_post", "الوصول المبكر لمنشوراتك المخصصة للمشتركين فقط");
    let hours = Math.floor(Number(b.hours));
    if (!Number.isFinite(hours) || hours <= 0) { const m = pp.min_tier_id ? await db.get("SELECT early_hours FROM sub_tier_meta WHERE tier_id=$1", [pp.min_tier_id]) : null; hours = Number(m?.early_hours || 24); }
    if (hours < 1 || hours > 168) throw E.bad("الوصول المبكر من ساعة إلى ٧ أيام");
    const publicAt = new Date(clock().getTime() + hours * HOUR).toISOString();
    await db.run("INSERT INTO sub_early(post_id,creator_id,public_at,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (post_id) DO UPDATE SET public_at=$3 WHERE sub_early.released_at IS NULL", [pid, user.id, publicAt, nowIso()]);
    return { postId: pid, publicAt, hours };
  }
  async function cancelEarly(user, pid) { const r = await db.run("DELETE FROM sub_early WHERE post_id=$1 AND creator_id=$2 AND released_at IS NULL", [pid, user.id]); if (!r.changes) throw E.nf(); return { ok: true }; }
  async function release(pid) {
    const t = nowIso();
    return db.tx(async (tx) => {
      const r = await tx.run("UPDATE sub_early SET released_at=$1 WHERE post_id=$2 AND released_at IS NULL", [t, pid]); if (!r.changes) return false;
      const pp = await tx.get("SELECT * FROM paid_posts WHERE post_id=$1", [pid]), post = await tx.get("SELECT id, data, status FROM posts WHERE id=$1", [pid]);
      if (!pp || pp.state !== "active" || pp.mode !== "supporters" || !post || post.status === "deleted") return true;
      const body = await tx.get("SELECT * FROM paid_content WHERE post_id=$1", [pid]);
      const data = { ...(parse(post.data, {}) || {}) }; delete data.paid;
      const doc = parse(body?.data, {})?.doc; if (doc) data.doc = doc;
      await tx.run("UPDATE posts SET text=$1, data=$2 WHERE id=$3", [body?.text || "", data, pid]);
      await tx.run("DELETE FROM paid_media WHERE post_id=$1", [pid]);
      await tx.run("UPDATE paid_posts SET state='released', changed_at=$1, change_kind='early_release', updated_at=$1 WHERE post_id=$2", [t, pid]);
      return true;
    });
  }
  async function earlyList(user) {
    const rows = await db.all("SELECT e.*, p.text FROM sub_early e LEFT JOIN posts p ON p.id=e.post_id WHERE e.creator_id=$1 ORDER BY e.public_at DESC LIMIT 100", [user.id]);
    return { items: rows.map((r) => ({ postId: r.post_id, publicAt: r.public_at, releasedAt: r.released_at || null, teaser: String(r.text || "").slice(0, 120) })) };
  }

  /* ======================= 6. studio: subscribers + churn ======================= */
  async function subscribers(user, q) {
    const at = clock().getTime(), args = [user.id]; let where = "s.creator_id=$1 AND s.started_at IS NOT NULL";
    if (q.tier) { args.push(String(q.tier)); where += ` AND s.tier_id=$${args.length}`; }
    const rows = await db.all(`SELECT s.*, u.handle, u.name, u.avatar, (SELECT COUNT(*) FROM support_payments p WHERE p.support_id=s.id AND p.status='completed') AS months FROM support_subscriptions s LEFT JOIN users u ON u.id=s.supporter_id WHERE ${where} ORDER BY s.updated_at DESC LIMIT 500`, args);
    let items = rows.map((r) => { const st = statusOf(r, at); return { id: r.id, user: Number(r.anonymous || 0) ? null : pubUser(r), anonymous: !!Number(r.anonymous || 0), tier: r.tier_id ? { id: r.tier_id, name: r.tier_name, amount: pi(r.amount) } : null, state: st, current: current(r, at), startedAt: r.started_at, activeUntil: r.active_until, months: Number(r.months || 0) }; });
    if (q.state) items = items.filter((i) => (q.state === "current" ? i.current : i.state === q.state));
    return { items, total: items.length };
  }
  async function stats(user) {
    const at = clock().getTime(), since30 = new Date(at - 30 * DAY).toISOString();
    const all = await db.all("SELECT * FROM support_subscriptions WHERE creator_id=$1 AND started_at IS NOT NULL", [user.id]);
    const cur = all.filter((s) => current(s, at));
    const byTier = new Map();
    for (const s of cur) { const k = s.tier_id || "—"; const g = byTier.get(k) || { tierId: s.tier_id, name: s.tier_name, count: 0, mrr: 0 }; g.count++; g.mrr += Number(s.amount); byTier.set(k, g); }
    const ev = await db.all("SELECT kind, support_id, created_at FROM sub_events WHERE creator_id=$1 AND created_at >= $2", [user.id, new Date(at - 183 * DAY).toISOString()]);
    const in30 = ev.filter((e) => e.created_at >= since30), count = (k, list = in30) => list.filter((e) => e.kind === k).length;
    const curIds = new Set(cur.map((s) => s.id));
    const churned = new Set(in30.filter((e) => e.kind === "lapsed" || e.kind === "cancelled").map((e) => e.support_id).filter((x) => !curIds.has(x) || all.find((s) => s.id === x)?.state === "cancelled"));
    const started = count("started"), startBase = Math.max(0, cur.length - started + churned.size);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(at); const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)), to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i + 1, 1));
      const inM = ev.filter((e) => e.created_at >= from.toISOString() && e.created_at < to.toISOString());
      months.push({ month: from.toISOString().slice(0, 7), started: count("started", inM), renewed: count("renewed", inM), churned: count("lapsed", inM) + count("cancelled", inM), upgraded: count("upgraded", inM), downgraded: count("downgrade_scheduled", inM) });
    }
    return {
      currency: "Pi", current: cur.length, mrr: pi(cur.reduce((a, s) => a + Number(s.amount), 0)), byTier: [...byTier.values()].map((g) => ({ ...g, mrr: pi(g.mrr) })),
      last30: { started, renewed: count("renewed"), churned: churned.size, upgraded: count("upgraded"), downgrades: count("downgrade_scheduled"), cancellations: count("cancelled"), lapses: count("lapsed") },
      churnRate: startBase ? Math.round((churned.size / startBase) * 1000) / 10 : 0, inGrace: all.filter((s) => statusOf(s, at) === "grace").length, dueSoon: all.filter((s) => statusOf(s, at) === "due").length, months
    };
  }

  /* ======================= bus + job ======================= */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("creatorsubs handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); await tips().settle?.(); while (inflight.size) await Promise.all([...inflight]); } };
  const lifecycle = (kind) => track(async (e) => {
    const sub = e?.support ? await db.get("SELECT * FROM support_subscriptions WHERE id=$1", [e.support]) : null; if (!sub) return;
    await event(kind, sub);
    if (kind === "started" || kind === "renewed") { // a renewal settles any scheduled downgrade
      await db.run(`UPDATE sub_changes SET status=CASE WHEN to_tier_id=$1 THEN 'applied' ELSE 'superseded' END, applied_at=$2 WHERE support_id=$3 AND status='scheduled'`, [sub.tier_id, nowIso(), sub.id]);
    }
  });
  bus.on("SUPPORT_STARTED", lifecycle("started"));
  bus.on("SUPPORT_RENEWED", lifecycle("renewed"));
  bus.on("SUPPORT_LAPSED", lifecycle("lapsed"));
  bus.on("SUPPORT_CANCELLED", lifecycle("cancelled"));
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "subscription") return;
    const ch = await db.get("SELECT * FROM sub_changes WHERE intent_id=$1", [e.tx]); if (!ch) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(ch.charge)) > 1) { logger.warn?.("upgrade amount mismatch; not applied", { change: ch.id }); return; }
    await applyUpgrade(ch.id, e.tx);
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "subscription") await db.run("UPDATE sub_changes SET status='cancelled', cancelled_at=$1 WHERE intent_id=$2 AND status='pending'", [nowIso(), e.tx]); }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => {
    if (e.purpose !== "subscription") return;
    const ch = await db.get("SELECT * FROM sub_changes WHERE intent_id=$1", [e.tx]); if (!ch) return;
    const t = nowIso();
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE sub_changes SET status='refunded', cancelled_at=$1 WHERE id=$2 AND status='applied'", [t, ch.id]); if (!r.changes) return;
      await reverseAll(tx, ch.id, "refund");
      const from = ch.from_tier_id ? await tx.get("SELECT name FROM creator_tiers WHERE id=$1", [ch.from_tier_id]) : null;
      await tx.run("UPDATE support_subscriptions SET tier_id=$1, tier_name=$2, amount=$3, updated_at=$4 WHERE id=$5 AND tier_id=$6", [ch.from_tier_id, from?.name || null, Number(ch.from_amount), t, ch.support_id, ch.to_tier_id]);
    });
  }));

  /** leased job: grace reminders (once per period) + early-access releases */
  async function job() {
    const at = clock().getTime(), t = new Date(at).toISOString();
    let grace = 0, released = 0;
    const rows = await db.all("SELECT s.*, u.handle AS c_handle FROM support_subscriptions s LEFT JOIN users u ON u.id=s.creator_id WHERE s.state='active' AND s.active_until < $1 AND s.active_until >= $2 LIMIT 1000", [t, new Date(at - cfg().graceMs).toISOString()]);
    for (const s of rows) {
      const already = await db.get("SELECT 1 x FROM sub_events WHERE support_id=$1 AND kind='grace_reminded' AND created_at >= $2", [s.id, s.active_until]); if (already) continue;
      await event("grace_reminded", s); grace++;
      await ctx.services.notify?.notify?.(s.supporter_id, "sub_grace", { ref: s.c_handle || null }).catch(() => { });
    }
    for (const e of await db.all("SELECT post_id FROM sub_early WHERE released_at IS NULL AND public_at <= $1 LIMIT 200", [t])) if (await release(e.post_id)) released++;
    return { grace, released };
  }
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.CREATOR_SUBS_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("creatorsubs", +(env.CREATOR_SUBS_JOB_INTERVAL_MS || 15 * 60e3), job);

  /* ======================= routes ======================= */
  R.get("/api/subs/config", async () => ({ enabled: piOn(), benefits: BENEFITS.map((k) => ({ key: k, label: BENEFIT_AR[k] })), note: piOn() ? null : "الاشتراكات تعمل فور تفعيل مدفوعات Pi" }));
  R.get("/api/subs/:handle", async (req) => page(req.user || null, req.params.handle));
  R.get("/api/subs/:handle/quote", A(async (req) => (await quote(req.user, req.params.handle, req.query.tierId)).client));
  R.post("/api/subs/:handle/change", A(async (req) => change(req.user, req.params.handle, req.body || {})));
  R.del("/api/subs/:handle/change", A(async (req) => cancelChange(req.user, req.params.handle)));
  R.post("/api/subs/:handle/renew", A(async (req) => renew(req.user, req.params.handle, req.body || {})));
  R.get("/api/subs/:handle/channel", A(async (req) => channel(req.user, req.params.handle, req.query || {})));
  R.post("/api/subs/:handle/channel", A(async (req) => postChannel(req.user, req.params.handle, req.body || {})));
  R.del("/api/subs/:handle/channel/:mid", A(async (req) => delChannel(req.user, req.params.handle, req.params.mid)));
  R.get("/api/subs/:handle/badges", async (req) => badgesRoute(req.params.handle, req.query.users));
  R.get("/api/me/subs/tiers", A(async (req) => myTiers(req.user)));
  R.put("/api/me/subs/tiers", A(async (req) => putTiers(req.user, req.body || {})));
  R.get("/api/me/subscribers", A(async (req) => subscribers(req.user, req.query || {})));
  R.get("/api/me/subscribers/stats", A(async (req) => stats(req.user)));
  R.get("/api/me/subs/early", A(async (req) => earlyList(req.user)));
  R.post("/api/me/subs/early", A(async (req) => setEarly(req.user, req.body || {})));
  R.del("/api/me/subs/early/:postId", A(async (req) => cancelEarly(req.user, req.params.postId)));

  return { job, settle, release, stats, page, BENEFITS };
};
