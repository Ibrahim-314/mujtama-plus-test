/* «مجتمع كوين» — MJT token system, stage 1 (v2.47.0). An IN-APP balance on its own double-entry ledger (lib/mjt-ledger.js).
 * It is NOT on any blockchain (no Ethereum/BNB/Polygon/Solana, and NOT a Pi Mainnet token); it cannot be withdrawn or sold.
 * Stage 2 (docs/MJT-PI-TESTNET-PLAN.md) links it to a test asset on the Pi Testnet — nothing of that exists yet.
 *
 * 1. Conversion of contribution points (phase 59) → MJT at a fixed, documented rate: 1 point = 1 MJT (RATE units).
 *    Counted per user from points_awards created BEFORE the MJT launch time (mjt_settings 'launch', set on first boot):
 *      earned  = active awards of the earning kinds (answer_accepted, engaged_post, report_confirmed, wiki_edit, mentoring)
 *      + penalties = active NEGATIVE staff adjustments
 *      − redeemed  = points in points→Pi redemptions that are pending or paid (already turned into value once)
 *      amount = max(0, earned + penalties − redeemed) × RATE. Positive staff point adjustments are NOT converted — the
 *      phase 59 rule "admin adjustments never become value" carries over.
 *    The points tables are never written: points stay as reputation/levels; each converted award gets a row in
 *    mjt_point_links (at most one live link per award), the user a row in mjt_conversions (at most one applied per user),
 *    the run a row in mjt_conversion_batches (with its dry-run report). One DB transaction per run (all users or none).
 *    Re-running converts nobody twice. Rollback (per batch) reverses every conversion with a reversal transaction — only if
 *    every user still holds the converted amount (minus anything already clawed back), otherwise it refuses and reports;
 *    after a rollback, automatic conversion stays off until an admin applies again. Dry run = the same plan, nothing written.
 *    Production runs the conversion once automatically after boot (MJT_AUTO_CONVERT=0 disables it).
 * 2. Rewards: every NEW points award of an earning kind (created after launch) mints MJT at the same rate, capped per user per
 *    UTC day (rewards.dailyCap, default 150 MJT) on top of all the phase 59 anti-gaming rules (trust, account age, linked
 *    accounts, cooldowns, per-kind caps). Removed content reverses its points → the MJT minted for it is clawed back (burned)
 *    up to the user's balance (never below 0; the shortfall is logged). A reconcile job repairs a missed hook.
 *    While MJT is linked, the old points → Pi redemption is retired (points.js), so a point is never paid twice.
 * 3. Transfers between members (POST /api/mjt/transfers): idempotency key required; per-transfer, daily and hourly limits;
 *    sender account ≥ minAccountDays old; minors (< 18) can neither send nor receive; blocked pairs, linked accounts (same
 *    device), integrity-flagged senders and recipients who switched receiving off are refused; frozen wallets cannot send.
 * 4. Staff: adjustments (admin only, reason required, ± with no negative balances), freeze/unfreeze, settings, verify,
 *    conversion dry-run / apply / rollback. Every money movement is in mjt_audit (same DB transaction) + the hash-chained
 *    audit log for staff actions.
 * 5. Pi → MJT purchase: POST /api/mjt/buy answers 501 not_configured (Pi payments are off; and even with Pi on, buying MJT is
 *    a later stage).
 * 6. Store/services spending: no store or service accepted contribution points before v2.47.0, so there is nothing to
 *    re-wire; spend()/refund() are the tested internal primitives a later stage will use (user → sys:treasury and back). */
const { E, HttpError, str, id } = require("../lib/core");
const L = require("../lib/mjt-ledger");
const { UNIT, SYS, userAcc, parseAmount, format } = L;

const DAY = 864e5, HOUR = 3600e3;
const RATE = UNIT; // minor units per contribution point: 1 point = 1 MJT
const EARN_KINDS = ["answer_accepted", "engaged_post", "report_confirmed", "wiki_edit", "mentoring"];
const TOKEN = { name: "مجتمع كوين", nameEn: "Mujtama Coin", symbol: "MJT", decimals: L.DECIMALS, stage: 1,
  stageNote: "رصيد داخل التطبيق فقط — ليس عملة على أي بلوكشين، ولا يُسحب ولا يُباع. ربطه بشبكة Pi التجريبية مرحلة لاحقة." };
const KIND_AR = { reward: "مكافأة مساهمة", conversion: "تحويل نقاط المساهمة", conversion_reversal: "إلغاء تحويل النقاط", transfer: "تحويل", tip: "إكرامية", adjustment: "تعديل من الإدارة", clawback: "استرجاع مكافأة محتوى محذوف", spend: "شراء", refund: "استرداد", community_reward: "مكافأة نشاط في مجتمع", community_reward_reversal: "استرجاع مكافأة مجتمع", mining: "تعدين يومي", checkin: "مكافأة الدخول اليومي" }; // v2.60: community rewards (services/cintegrations.js)
const DEFAULTS = {
  rewards: { enabled: true, dailyCap: 150 * UNIT },
  transfers: { enabled: true, maxSingle: 500 * UNIT, maxDaily: 2000 * UNIT, maxPerHour: 10, minAccountDays: 0 } // v2.74.2: no waiting period by default (owner request); admins can still set one
};
const IKEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date|number, jobs?: boolean, autoConvert?: boolean, linkPoints?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const dayStart = (iso = nowIso()) => iso.slice(0, 10) + "T00:00:00.000Z";
  const fail = (status, code, msg, details) => Object.assign(new HttpError(status, msg, code), details ? { details } : {});
  const isStaff = (u) => !!u && ["admin", "moderator"].includes(u.role);
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const staff = (fn) => A(async (req, res) => { if (!isStaff(req.user)) throw E.forbid("للفريق فقط"); return fn(req, res); });
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const linked = () => opts.linkPoints !== false;
  const led = L.createMjtLedger(db, { now: nowIso });
  const notify = async (uid, kind, o) => { try { await ctx.services.notify?.notify(uid, kind, o); } catch { /* best effort */ } };
  const minorSet = async (ids) => { try { return (await ctx.services.minors?.minorIds?.(ids)) || new Set(); } catch { return new Set(); } };
  const isMinor = async (uid) => (await minorSet([uid])).has(uid);
  const piOn = () => { const d = ctx.services.pi?.diag?.(); return !!(d && d.enabled && d.apiKeyPresent); };
  const pub = (u) => (u ? { handle: u.handle, name: u.name, avatar: u.avatar || null } : null);
  const money = (units) => ({ units: Number(units), mjt: format(units) });

  /* ---------- settings ---------- */
  let cfgCache = null;
  async function settings() {
    if (cfgCache && cfgCache.at > Date.now() - 5e3) return cfgCache.v;
    const s = parse((await db.get("SELECT value FROM mjt_settings WHERE key='rules'"))?.value, {});
    const v = { rewards: { ...DEFAULTS.rewards, ...(s.rewards || {}) }, transfers: { ...DEFAULTS.transfers, ...(s.transfers || {}) }, conversion: { auto: true, ...(s.conversion || {}) } };
    cfgCache = { at: Date.now(), v }; return v;
  }
  async function writeSettings(v, by) {
    await db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('rules',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(v), by || null, nowIso()]);
    cfgCache = null;
  }
  async function saveSettings(user, b = {}) {
    const cur = await settings(), next = JSON.parse(JSON.stringify(cur));
    const amt = (v, lo, hi) => { const u = parseAmount(String(v)); if (u < lo * UNIT || u > hi * UNIT) throw E.bad("قيمة خارج الحدود"); return u; };
    if (b.rewards) {
      if (b.rewards.enabled !== undefined) next.rewards.enabled = !!b.rewards.enabled;
      if (b.rewards.dailyCap !== undefined) next.rewards.dailyCap = amt(b.rewards.dailyCap, 1, 100000);
    }
    if (b.transfers) {
      const t = b.transfers;
      if (t.enabled !== undefined) next.transfers.enabled = !!t.enabled;
      if (t.maxSingle !== undefined) next.transfers.maxSingle = amt(t.maxSingle, 1, 1000000);
      if (t.maxDaily !== undefined) next.transfers.maxDaily = amt(t.maxDaily, 1, 10000000);
      if (t.maxPerHour !== undefined) next.transfers.maxPerHour = int(t.maxPerHour, cur.transfers.maxPerHour, 1, 1000);
      if (t.minAccountDays !== undefined) next.transfers.minAccountDays = int(t.minAccountDays, cur.transfers.minAccountDays, 0, 365);
      if (next.transfers.maxSingle > next.transfers.maxDaily) throw E.bad("حد التحويل الواحد أكبر من الحد اليومي");
    }
    await writeSettings(next, user.id);
    ctx.audit?.("mjt_settings_saved", "mjt", null, user.id);
    return { settings: settingsClient(await settings()) };
  }
  const settingsClient = (s) => ({ rewards: { enabled: !!s.rewards.enabled, dailyCap: format(s.rewards.dailyCap) }, transfers: { enabled: !!s.transfers.enabled, maxSingle: format(s.transfers.maxSingle), maxDaily: format(s.transfers.maxDaily), maxPerHour: s.transfers.maxPerHour, minAccountDays: s.transfers.minAccountDays }, conversion: { auto: s.conversion.auto !== false } });
  /** the MJT launch time: awards before it are converted, awards after it are rewards. Set once, never moved. */
  let launchCache = null;
  async function launchAt() {
    if (launchCache) return launchCache;
    await db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('launch',$1,'system',$2) ON CONFLICT DO NOTHING", [nowIso(), nowIso()]);
    launchCache = (await db.get("SELECT value FROM mjt_settings WHERE key='launch'")).value;
    return launchCache;
  }

  /* ---------- balances ---------- */
  async function walletOf(uid, q = db) {
    const a = await q.get("SELECT balance, status, receive FROM mjt_accounts WHERE id=$1", [userAcc(uid)]);
    return { balance: Number(a?.balance || 0), status: a?.status || "active", receive: a ? Number(a.receive) === 1 : true };
  }
  async function earnedToday(uid, q = db) {
    return Number((await q.get("SELECT COALESCE(SUM(amount),0) s FROM mjt_tx WHERE user_id=$1 AND kind='reward' AND created_at >= $2", [uid, dayStart()]))?.s || 0);
  }
  async function sentSince(uid, since, q = db) {
    const r = await q.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM mjt_tx WHERE user_id=$1 AND kind IN ('transfer','tip') AND created_at >= $2", [uid, since]); // v2.74: tips share the transfer limits
    return { sum: Number(r?.s || 0), n: Number(r?.n || 0) };
  }

  /* ---------- rewards from points awards ---------- */
  /** called by points.award right after an award row is written (and by the reconcile job). Exactly once per award. */
  async function onAward(a) {
    if (!linked() || !a || !EARN_KINDS.includes(a.kind) || !(Number(a.points) > 0) || a.status === "reversed") return { minted: false, reason: "not_eligible" };
    if (a.created_at < (await launchAt())) return { minted: false, reason: "before_launch" }; // the conversion covers it
    const S = await settings(), uid = a.user_id, acc = userAcc(uid);
    return db.tx(async (t) => {
      const w = (await led.lock(t, [acc])).get(acc), at = nowIso(), lid = id("ml");
      const ins = await t.run("INSERT INTO mjt_point_links(id,award_id,user_id,pts,amount,clawed,source,tx_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,0,0,'reward',NULL,'pending',$5,$5) ON CONFLICT DO NOTHING", [lid, a.id, uid, Number(a.points), at]);
      if (!ins.changes) return { minted: false, reason: "duplicate" };
      const why = !S.rewards.enabled ? "rewards_off" : w.status !== "active" ? "frozen" : null;
      if (why) { await t.run("UPDATE mjt_point_links SET status='skipped', updated_at=$1 WHERE id=$2", [at, lid]); return { minted: false, reason: why }; }
      const room = Math.max(0, S.rewards.dailyCap - (await earnedToday(uid, t)));
      const amount = Math.min(Number(a.points) * RATE, room);
      if (amount <= 0) { await t.run("UPDATE mjt_point_links SET status='capped', updated_at=$1 WHERE id=$2", [at, lid]); return { minted: false, reason: "daily_cap" }; }
      const r = await led.post(t, { ikey: "reward:" + a.id, kind: "reward", userId: uid, refType: "points_award", refId: a.id, memo: a.kind, lines: [{ account: SYS.mint, amount: -amount }, { account: acc, amount }] });
      await t.run("UPDATE mjt_point_links SET status='active', amount=$1, tx_id=$2, updated_at=$3 WHERE id=$4", [amount, r.tx.id, at, lid]);
      return { minted: true, amount, capped: amount < Number(a.points) * RATE, txId: r.tx.id };
    }).then((r) => { if (r.minted) ctx.realtime?.send?.(uid, "mjt", { kind: "reward", amount: format(r.amount) }); return r; });
  }
  /** the award behind a live link was reversed (content removed / staff): burn what was minted for it, never below 0 */
  async function onAwardReversed(awardId) {
    if (!linked()) return { clawed: 0 };
    const l0 = await db.get("SELECT * FROM mjt_point_links WHERE award_id=$1 AND status='active'", [String(awardId)]);
    if (!l0 || !(Number(l0.amount) > 0)) return { clawed: 0 };
    const acc = userAcc(l0.user_id);
    return db.tx(async (t) => {
      const w = (await led.lock(t, [acc])).get(acc);
      const l = await t.get("SELECT * FROM mjt_point_links WHERE id=$1 AND status='active'", [l0.id]); if (!l) return { clawed: 0 };
      const want = Number(l.amount), burn = Math.min(want, w.balance), at = nowIso();
      let txId = null;
      if (burn > 0) txId = (await led.post(t, { ikey: "claw:" + l.id, kind: "clawback", userId: l.user_id, refType: "points_award", refId: l.award_id, allowFrozen: true, memo: "content_removed", lines: [{ account: acc, amount: -burn }, { account: SYS.burn, amount: burn }] })).tx.id;
      await t.run("UPDATE mjt_point_links SET status='clawed', clawed=$1, updated_at=$2 WHERE id=$3", [burn, at, l.id]);
      if (burn < want) await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('clawback_shortfall','system',$1,$2,$3,$4)", [l.user_id, txId, JSON.stringify({ award: l.award_id, wanted: format(want), clawed: format(burn) }), at]);
      return { clawed: burn, shortfall: want - burn };
    });
  }
  let reconciling = null;
  const reconcile = () => (reconciling ||= (async () => {
    const out = { minted: 0, clawed: 0, skipped: 0 };
    if (!linked()) return out;
    const L0 = await launchAt();
    const missing = await db.all(`SELECT a.* FROM points_awards a WHERE a.status='active' AND a.points > 0 AND a.kind IN (${EARN_KINDS.map((k) => `'${k}'`).join(",")}) AND a.created_at >= $1
      AND NOT EXISTS (SELECT 1 FROM mjt_point_links l WHERE l.award_id=a.id AND l.status <> 'rolled_back') ORDER BY a.created_at LIMIT 500`, [L0]);
    for (const a of missing) { try { const r = await onAward(a); if (r.minted) out.minted++; else out.skipped++; } catch (e) { logger.warn?.("mjt reward failed", { err: e?.message, award: a.id }); } }
    for (const l of await db.all("SELECT l.award_id FROM mjt_point_links l JOIN points_awards a ON a.id=l.award_id WHERE l.status='active' AND a.status <> 'active' LIMIT 500")) {
      try { if ((await onAwardReversed(l.award_id)).clawed >= 0) out.clawed++; } catch (e) { logger.warn?.("mjt clawback failed", { err: e?.message }); }
    }
    return out;
  })().finally(() => { reconciling = null; }));

  /* ---------- conversion of contribution points ---------- */
  /** the plan (inside q): per user, the not-yet-linked awards before the cutoff */
  async function plan(q, cutoff) {
    const rows = await q.all(`SELECT a.id, a.user_id, a.kind, a.points FROM points_awards a WHERE a.status='active' AND a.created_at < $1
      AND NOT EXISTS (SELECT 1 FROM mjt_point_links l WHERE l.award_id=a.id AND l.status <> 'rolled_back')
      AND NOT EXISTS (SELECT 1 FROM mjt_conversions c WHERE c.user_id=a.user_id AND c.status='applied') ORDER BY a.user_id, a.created_at, a.id`, [cutoff]);
    const users = new Map();
    for (const a of rows) {
      const p = Number(a.points), k = a.kind;
      let u = users.get(a.user_id); if (!u) users.set(a.user_id, (u = { userId: a.user_id, awards: [], earned: 0, penalties: 0, excluded: 0, redeemed: 0 }));
      if (EARN_KINDS.includes(k) && p > 0) { u.earned += p; u.awards.push({ id: a.id, pts: p }); }
      else if (k === "adjustment" && p < 0) { u.penalties += p; u.awards.push({ id: a.id, pts: p }); }
      else if (p > 0) u.excluded += p; // positive staff point adjustments are not converted
    }
    for (const u of users.values()) {
      u.redeemed = Number((await q.get("SELECT COALESCE(SUM(points),0) s FROM points_redemptions WHERE user_id=$1 AND status IN ('pending','paid')", [u.userId]))?.s || 0);
      u.pts = Math.max(0, u.earned + u.penalties - u.redeemed); u.amount = u.pts * RATE;
    }
    const list = [...users.values()].filter((u) => u.awards.length);
    return { cutoff, rate: format(RATE), users: list, totals: { users: list.length, withBalance: list.filter((u) => u.amount > 0).length, pts: list.reduce((s, u) => s + u.pts, 0), amount: list.reduce((s, u) => s + u.amount, 0), excludedPts: [...users.values()].reduce((s, u) => s + u.excluded, 0), usersOnlyExcluded: [...users.values()].filter((u) => !u.awards.length).length, redeemedPts: list.reduce((s, u) => s + u.redeemed, 0), awards: list.reduce((s, u) => s + u.awards.length, 0) } };
  }
  const planReport = async (p, { detail = true } = {}) => {
    const handles = new Map(); if (detail) for (const u of p.users.slice(0, 500)) handles.set(u.userId, (await db.get("SELECT handle FROM users WHERE id=$1", [u.userId]))?.handle || null);
    return { cutoff: p.cutoff, rate: `1 نقطة = ${p.rate} MJT`, totals: { ...p.totals, amount: format(p.totals.amount) },
      users: detail ? p.users.slice(0, 500).map((u) => ({ handle: handles.get(u.userId), earned: u.earned, penalties: u.penalties, excluded: u.excluded, redeemed: u.redeemed, pts: u.pts, mjt: format(u.amount) })) : undefined };
  };
  async function dryRun() { const p = await plan(db, await launchAt()); return { dryRun: true, ...(await planReport(p)) }; }
  class Empty extends Error { }
  /** apply: one DB transaction for the whole run. Idempotent: users already converted (or awards already linked) are skipped. */
  async function convert(actorId = "system") {
    const cutoff = await launchAt(), bid = id("mb");
    try {
      const res = await db.tx(async (t) => {
        const p0 = await plan(t, cutoff);
        if (!p0.users.length) throw new Empty();
        await led.lock(t, p0.users.map((u) => userAcc(u.userId))); // users first (sorted), sys:mint last — the global lock order
        const p = await plan(t, cutoff); // re-read under the locks
        const at = nowIso();
        await t.run("INSERT INTO mjt_conversion_batches(id,rate,cutoff,status,users,pts,amount,report,created_by,created_at) VALUES($1,$2,$3,'applied',0,0,0,NULL,$4,$5)", [bid, RATE, cutoff, actorId, at]);
        let users = 0, pts = 0, amount = 0;
        for (const u of p.users) {
          const cid = id("mc");
          const ins = await t.run("INSERT INTO mjt_conversions(id,batch_id,user_id,pts,redeemed_pts,excluded_pts,amount,tx_id,status,created_at) VALUES($1,$2,$3,0,$4,$5,0,NULL,'applied',$6) ON CONFLICT DO NOTHING", [cid, bid, u.userId, u.redeemed, u.excluded, at]);
          if (!ins.changes) continue; // converted concurrently
          let sum = 0;
          for (const a of u.awards) {
            const li = await t.run("INSERT INTO mjt_point_links(id,award_id,user_id,pts,amount,clawed,source,batch_id,conversion_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,0,'conversion',$6,$7,'active',$8,$8) ON CONFLICT DO NOTHING", [id("ml"), a.id, u.userId, a.pts, a.pts * RATE, bid, cid, at]);
            if (li.changes) sum += a.pts;
          }
          const upts = Math.max(0, sum - u.redeemed), uamt = upts * RATE;
          let txId = null;
          if (uamt > 0) txId = (await led.post(t, { ikey: `convert:${bid}:${u.userId}`, kind: "conversion", actorId, userId: u.userId, refType: "conversion", refId: cid, batchId: bid, allowFrozen: true, memo: `${upts} نقطة`, lines: [{ account: SYS.mint, amount: -uamt }, { account: userAcc(u.userId), amount: uamt }] })).tx.id;
          await t.run("UPDATE mjt_conversions SET pts=$1, amount=$2, tx_id=$3 WHERE id=$4", [upts, uamt, txId, cid]);
          users++; pts += upts; amount += uamt;
        }
        if (!users) throw new Empty();
        const report = await (async () => { const r = await planReport(p, { detail: false }); return { ...r, applied: { users, pts, amount: format(amount) } }; })();
        await t.run("UPDATE mjt_conversion_batches SET users=$1, pts=$2, amount=$3, report=$4 WHERE id=$5", [users, pts, amount, JSON.stringify(report), bid]);
        await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('conversion_applied',$1,$2,NULL,$3,$4)", [actorId, bid, JSON.stringify({ users, pts, amount: format(amount) }), at]);
        return { batch: bid, users, pts, amount };
      });
      ctx.audit?.("mjt_conversion_applied", bid, `${res.users} users, ${format(res.amount)} MJT`, actorId);
      if (actorId !== "system") { const s = await settings(); if (s.conversion.auto === false) await writeSettings({ ...s, conversion: { ...s.conversion, auto: true } }, actorId); }
      return { applied: true, batch: await batchClient(await db.get("SELECT * FROM mjt_conversion_batches WHERE id=$1", [bid])) };
    } catch (e) { if (e instanceof Empty) return { applied: false, reason: "nothing_to_convert" }; throw e; }
  }
  /** rollback of one batch: all users or none. dryRun → the report, nothing written. */
  async function rollback(batchId, actorId, { dryRun = false } = {}) {
    const b = await db.get("SELECT * FROM mjt_conversion_batches WHERE id=$1", [String(batchId).slice(0, 64)]); if (!b) throw E.nf();
    if (b.status !== "applied") throw fail(409, "already_rolled_back", "أُلغي هذا التحويل من قبل");
    const run = async (t) => {
      const convs = await t.all("SELECT * FROM mjt_conversions WHERE batch_id=$1 AND status='applied' ORDER BY user_id", [b.id]);
      const locks = dryRun ? new Map(await Promise.all(convs.map(async (c) => [userAcc(c.user_id), await walletOf(c.user_id, t)]))) : await led.lock(t, convs.map((c) => userAcc(c.user_id)));
      const lines = [];
      for (const c of convs) {
        const clawed = Number((await t.get("SELECT COALESCE(SUM(clawed),0) s FROM mjt_point_links WHERE conversion_id=$1", [c.id]))?.s || 0);
        const back = Math.max(0, Number(c.amount) - clawed), bal = locks.get(userAcc(c.user_id)).balance;
        lines.push({ c, back, bal, short: Math.max(0, back - bal) });
      }
      const short = lines.filter((x) => x.short > 0);
      const report = { batch: b.id, users: lines.length, amount: format(lines.reduce((s, x) => s + x.back, 0)), blocked: short.length,
        blockedUsers: await Promise.all(short.slice(0, 50).map(async (x) => ({ handle: (await t.get("SELECT handle FROM users WHERE id=$1", [x.c.user_id]))?.handle || null, needs: format(x.back), has: format(x.bal) }))) };
      if (dryRun) return { dryRun: true, possible: !short.length, ...report };
      if (short.length) throw fail(409, "rollback_blocked", "لا يمكن إلغاء التحويل: بعض الأعضاء صرفوا جزءاً من الرصيد المحوَّل", report);
      const at = nowIso();
      for (const x of lines) {
        let rtx = null;
        if (x.back > 0) rtx = (await led.post(t, { ikey: "unconvert:" + x.c.id, kind: "conversion_reversal", actorId, userId: x.c.user_id, refType: "conversion", refId: x.c.id, batchId: b.id, reverses: x.c.tx_id, allowFrozen: true, lines: [{ account: userAcc(x.c.user_id), amount: -x.back }, { account: SYS.mint, amount: x.back }] })).tx.id;
        await t.run("UPDATE mjt_conversions SET status='rolled_back', reversal_tx_id=$1, rolled_back_at=$2 WHERE id=$3", [rtx, at, x.c.id]);
      }
      await t.run("UPDATE mjt_point_links SET status='rolled_back', updated_at=$1 WHERE batch_id=$2 AND status IN ('active','clawed')", [at, b.id]);
      await t.run("UPDATE mjt_conversion_batches SET status='rolled_back', rolled_back_by=$1, rolled_back_at=$2 WHERE id=$3", [actorId, at, b.id]);
      await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES('conversion_rolled_back',$1,$2,NULL,$3,$4)", [actorId, b.id, JSON.stringify(report), at]);
      return { rolledBack: true, ...report };
    };
    if (dryRun) return run(db);
    const out = await db.tx(run);
    const s = await settings(); await writeSettings({ ...s, conversion: { ...s.conversion, auto: false } }, actorId); // no automatic re-conversion after a rollback
    ctx.audit?.("mjt_conversion_rolled_back", b.id, `${out.users} users`, actorId);
    return out;
  }
  const batchClient = async (b) => (b ? { id: b.id, rate: format(b.rate), cutoff: b.cutoff, status: b.status, users: Number(b.users), pts: Number(b.pts), amount: format(b.amount), createdAt: b.created_at, createdBy: b.created_by, rolledBackAt: b.rolled_back_at || null, report: parse(b.report, null) } : null);

  /* ---------- transfers ---------- */
  async function blockedBetween(a, b) {
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    if ((ua?.prefs?.blocked || []).includes(b) || (ub?.prefs?.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  async function linkedPair(a, b) { try { const m = await ctx.services.integrity?.linkedAccounts?.(a); return !!m?.has?.(b); } catch { return false; } }
  async function flagged(uid) {
    try { if (await ctx.services.integrity?.limitOf?.(uid)) return true; } catch { /* optional */ }
    for (const f of await db.all("SELECT members FROM integrity_flags WHERE status IN ('open','confirmed') AND score >= 0.6").catch(() => [])) if (parse(f.members, []).includes(uid)) return true;
    return false;
  }
  /** why this user cannot send right now (null = can) */
  async function sendBlock(user, S) {
    if (!S.transfers.enabled) return { code: "transfers_off", msg: "التحويل بين الأعضاء متوقف مؤقتاً" };
    if (await isMinor(user.id)) return { code: "minor_restricted", msg: "التحويل غير متاح لمن هم دون ١٨ سنة" };
    const u = await db.get("SELECT status, created_at FROM users WHERE id=$1", [user.id]);
    if (!u || u.status !== "active") return { code: "inactive", msg: "الحساب غير نشط" };
    if (Date.parse(nowIso()) - Date.parse(u.created_at) < S.transfers.minAccountDays * DAY) return { code: "account_too_new", msg: `التحويل متاح بعد ${S.transfers.minAccountDays} أيام من إنشاء الحساب` };
    if ((await walletOf(user.id)).status !== "active") return { code: "account_frozen", msg: "المحفظة موقوفة مؤقتاً — تواصل مع الدعم" };
    if (await flagged(user.id)) return { code: "integrity_limited", msg: "التحويل موقوف على هذا الحساب لمراجعة أمان" };
    return null;
  }
  async function transfer(user, b = {}) {
    const ikeyIn = String(b.ikey || ""); if (!IKEY_RE.test(ikeyIn)) throw fail(400, "ikey_required", "مفتاح العملية مطلوب");
    const ikey = `xfer:${user.id}:${ikeyIn}`;
    const amount = parseAmount(b.amount);
    const note = str(b.note, 140) || null;
    const S = await settings();
    // a replay returns the first result before any limit is re-checked
    const prev = await db.get("SELECT * FROM mjt_tx WHERE ikey=$1", [ikey]);
    if (prev) {
      const other = await db.get("SELECT id, handle, name, avatar FROM users WHERE id=$1", [prev.other_id]);
      const sameTo = other && String(b.to || "").replace(/^@/, "").toLowerCase() === String(other.handle).toLowerCase();
      if (!sameTo || Number(prev.amount) !== amount) throw fail(409, "idempotency_conflict", "مفتاح العملية مستخدم لطلب مختلف");
      return { replayed: true, transfer: { id: prev.id, amount: format(prev.amount), to: pub(other), createdAt: prev.created_at }, balance: money((await walletOf(user.id)).balance) };
    }
    if (!rl.hit("mjt_transfer", user.id)) throw E.rate();
    const why = await sendBlock(user, S); if (why) throw fail(why.code === "transfers_off" ? 409 : 403, why.code, why.msg);
    const handle = str(String(b.to ?? "").replace(/^@/, ""), 60, { required: true });
    const other = await db.get("SELECT id, handle, name, avatar, status FROM users WHERE LOWER(handle)=LOWER($1)", [handle]);
    if (!other || other.status !== "active") throw E.nf("الحساب غير موجود");
    if (other.id === user.id) throw fail(400, "self_transfer", "لا يمكنك التحويل إلى نفسك");
    if (await isMinor(other.id)) throw fail(403, "minor_restricted", "التحويل غير متاح لمن هم دون ١٨ سنة");
    if (await blockedBetween(user.id, other.id)) throw fail(403, "blocked", "لا يمكن التحويل مع هذا الحساب");
    if (await linkedPair(user.id, other.id)) throw fail(403, "linked_accounts", "لا يمكن التحويل بين حسابات على الجهاز نفسه");
    if (amount > S.transfers.maxSingle) throw fail(400, "transfer_max", `أعلى مبلغ للتحويل الواحد ${format(S.transfers.maxSingle)} MJT`);
    const from = userAcc(user.id), to = userAcc(other.id);
    const r = await db.tx(async (t) => {
      const w = await led.lock(t, [from, to]);
      // a concurrent request with the same key committed while we waited for the lock → answer as its replay
      const dup = await t.get("SELECT id FROM mjt_tx WHERE ikey=$1", [ikey]);
      if (dup) return led.post(t, { ikey, kind: "transfer", actorId: user.id, userId: user.id, otherId: other.id, refType: "transfer", memo: note, lines: [{ account: from, amount: -amount }, { account: to, amount }] });
      if (!w.get(to).receive) throw fail(409, "recipient_off", "هذا العضو أوقف استقبال التحويلات");
      if (w.get(from).balance < amount) throw fail(409, "insufficient_balance", "رصيدك من مجتمع كوين لا يكفي");
      const at = Date.parse(nowIso());
      const d = await sentSince(user.id, dayStart(), t), h = await sentSince(user.id, new Date(at - HOUR).toISOString(), t);
      if (d.sum + amount > S.transfers.maxDaily) throw fail(429, "daily_limit", `تجاوزت حد التحويل اليومي (${format(S.transfers.maxDaily)} MJT)`);
      if (h.n >= S.transfers.maxPerHour) throw fail(429, "hourly_limit", "تحويلات كثيرة خلال ساعة، حاول لاحقاً");
      return led.post(t, { ikey, kind: "transfer", actorId: user.id, userId: user.id, otherId: other.id, refType: "transfer", memo: note, lines: [{ account: from, amount: -amount }, { account: to, amount }] });
    });
    if (!r.replayed) {
      ctx.audit?.("mjt_transfer", other.id, format(amount), user.id);
      await notify(other.id, "mjt_received", { actor: user.id, ref: r.tx.id });
      ctx.realtime?.send?.(other.id, "mjt", { kind: "transfer", amount: format(amount) });
    }
    return { replayed: r.replayed, transfer: { id: r.tx.id, amount: format(r.tx.amount), to: pub(other), note, createdAt: r.tx.created_at }, balance: money((await walletOf(user.id)).balance) };
  }
  /* ---------- v2.74 tips on clips / video posts («إكرامية») ----------
   * A tip = one ledger transfer (kind 'tip', ref_type 'post', ref_id = post id) from the viewer to the post author, with the
   * SAME guards as a member transfer (sendBlock, minors, blocks, linked accounts, receive switch, balance, single/daily/hourly
   * limits — tips count toward the transfer limits) plus: the post must be published and visible to the tipper, and nobody
   * tips their own post. One mjt_tips row (073) in the same DB transaction holds who/anon for the supporters list.
   * Idempotent per (tipper, ikey): a replay answers the first result; the same key for another post/amount → 409. */
  const TIP_PRESETS = [5, 10, 25, 50];
  const tipKey = (uid, k) => `tip:${uid}:${k}`;
  async function tipPost(user, pid, b = {}) { return tipTarget(user, "post", pid, b); }
  /* v2.75 live-room tips: the same guarded ledger tip to the HOST of a room that is live right now (ref_type 'room').
   * The mjt_tips row reuses post_id for the room id (ids are prefixed: rm_… vs posts), so summaries work unchanged. */
  async function tipRoom(user, rid, b = {}) { return tipTarget(user, "room", rid, b); }
  async function tipTarget(user, kind, pid, b = {}) {
    const ikeyIn = String(b.ikey || ""); if (!IKEY_RE.test(ikeyIn)) throw fail(400, "ikey_required", "مفتاح العملية مطلوب");
    pid = str(pid, 80, { required: true });
    const ikey = tipKey(user.id, ikeyIn), amount = parseAmount(b.amount), anon = b.anon === true ? 1 : 0;
    const S = await settings();
    const prev = await db.get("SELECT * FROM mjt_tx WHERE ikey=$1", [ikey]);
    if (prev) {
      if (prev.ref_id !== pid || Number(prev.amount) !== amount) throw fail(409, "idempotency_conflict", "مفتاح العملية مستخدم لطلب مختلف");
      return { replayed: true, tip: { id: prev.id, amount: format(prev.amount), [kind]: pid, createdAt: prev.created_at }, balance: money((await walletOf(user.id)).balance), summary: await tipSummary(user, pid) };
    }
    if (!rl.hit("mjt_transfer", user.id)) throw E.rate();
    const why = await sendBlock(user, S); if (why) throw fail(why.code === "transfers_off" ? 409 : 403, why.code, why.msg);
    let ownerId;
    if (kind === "room") {
      const room = await db.get("SELECT id, host, status FROM rooms WHERE id=$1", [pid]);
      if (!room || (user.prefs?.blocked || []).includes(room.host)) throw E.nf("الغرفة غير موجودة");
      if (room.status !== "live") throw fail(409, "room_ended", "انتهى البث");
      if (room.host === user.id) throw fail(400, "self_tip", "لا يمكنك دعم بثّك");
      ownerId = room.host;
    } else {
      const post = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
      if (!post || post.status !== "published" || (user.prefs?.blocked || []).includes(post.author)) throw E.nf("المنشور غير موجود");
      try { if (ctx.services.content?.canSee && !(await ctx.services.content.canSee(post, user.id))) throw E.nf("المنشور غير موجود"); } catch (e) { if (e instanceof HttpError) throw e; }
      if (post.author === user.id) throw fail(400, "self_tip", "لا يمكنك دعم منشورك");
      ownerId = post.author;
    }
    const other = await db.get("SELECT id, handle, name, avatar, status FROM users WHERE id=$1", [ownerId]);
    if (!other || other.status !== "active") throw E.nf("صاحب المنشور غير متاح");
    if (await isMinor(other.id)) throw fail(403, "minor_restricted", "الإكراميات غير متاحة لمن هم دون ١٨ سنة");
    if (await blockedBetween(user.id, other.id)) throw fail(403, "blocked", "لا يمكن دعم هذا الحساب");
    if (await linkedPair(user.id, other.id)) throw fail(403, "linked_accounts", "لا يمكن الدعم بين حسابات على الجهاز نفسه");
    if (amount > S.transfers.maxSingle) throw fail(400, "transfer_max", `أعلى مبلغ للإكرامية الواحدة ${format(S.transfers.maxSingle)} MJT`);
    const note = str(b.note, 140) || null;
    const from = userAcc(user.id), to = userAcc(other.id);
    const j = { ikey, kind: "tip", actorId: user.id, userId: user.id, otherId: other.id, refType: kind, refId: pid, memo: note, lines: [{ account: from, amount: -amount }, { account: to, amount }] };
    const r = await db.tx(async (t) => {
      const w = await led.lock(t, [from, to]);
      const dup = await t.get("SELECT id FROM mjt_tx WHERE ikey=$1", [ikey]);
      if (dup) return led.post(t, j);
      if (!w.get(to).receive) throw fail(409, "recipient_off", "صاحب اللقطة أوقف استقبال الإكراميات");
      if (w.get(from).balance < amount) throw fail(409, "insufficient_balance", "رصيدك من مجتمع كوين لا يكفي");
      const at = Date.parse(nowIso());
      const d = await sentSince(user.id, dayStart(), t), h = await sentSince(user.id, new Date(at - HOUR).toISOString(), t);
      if (d.sum + amount > S.transfers.maxDaily) throw fail(429, "daily_limit", `تجاوزت حد التحويل اليومي (${format(S.transfers.maxDaily)} MJT)`);
      if (h.n >= S.transfers.maxPerHour) throw fail(429, "hourly_limit", "عمليات كثيرة خلال ساعة، حاول لاحقاً");
      const out = await led.post(t, j);
      if (!out.replayed) await t.run("INSERT INTO mjt_tips(tx_id,post_id,from_id,to_id,amount,anon,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [out.tx.id, pid, user.id, other.id, amount, anon, out.tx.created_at]);
      return out;
    });
    if (!r.replayed) {
      ctx.audit?.("mjt_tip", other.id, format(amount), user.id);
      await notify(other.id, "mjt_tip", { actor: anon ? null : user.id, ref: pid });
      ctx.realtime?.send?.(other.id, "mjt", { kind: "tip", amount: format(amount), [kind]: pid });
      if (kind === "room") ctx.services.rooms?.tipCheer?.(pid, { amount: format(amount), from: anon ? null : { handle: user.handle, name: user.name } });
    }
    return { replayed: r.replayed, tip: { id: r.tx.id, amount: format(r.tx.amount), [kind]: pid, anon: !!anon, note, createdAt: r.tx.created_at }, balance: money((await walletOf(user.id)).balance), summary: await tipSummary(user, pid) };
  }
  /** per-post: total, number of tips, distinct supporters, top 5 (anonymous ones hidden), the viewer's own total */
  async function tipSummary(user, pid) {
    pid = str(pid, 80, { required: true });
    const agg = await db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n, COUNT(DISTINCT from_id) p FROM mjt_tips WHERE post_id=$1", [pid]);
    const top = await db.all("SELECT t.from_id, SUM(t.amount) s, MAX(t.anon) a, u.handle, u.name, u.avatar FROM mjt_tips t LEFT JOIN users u ON u.id=t.from_id WHERE t.post_id=$1 GROUP BY t.from_id, u.handle, u.name, u.avatar ORDER BY SUM(t.amount) DESC, MIN(t.created_at), t.from_id LIMIT 5", [pid]);
    const mine = user ? await db.get("SELECT COALESCE(SUM(amount),0) s FROM mjt_tips WHERE post_id=$1 AND from_id=$2", [pid, user.id]) : null;
    return { post: pid, total: format(agg?.s || 0), count: Number(agg?.n || 0), supporters: Number(agg?.p || 0), mine: format(mine?.s || 0),
      top: top.map((x) => (Number(x.a) ? { anon: true, amount: format(x.s) } : { anon: false, user: pub(x), amount: format(x.s) })), presets: TIP_PRESETS };
  }
  /** the creator's tips received: all-time + last 30 days, top posts */
  async function tipsReceived(user) {
    const since = new Date(Date.parse(nowIso()) - 30 * DAY).toISOString();
    const all = await db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM mjt_tips WHERE to_id=$1", [user.id]);
    const m = await db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n, COUNT(DISTINCT from_id) p FROM mjt_tips WHERE to_id=$1 AND created_at >= $2", [user.id, since]);
    const posts = await db.all("SELECT post_id, SUM(amount) s, COUNT(*) n FROM mjt_tips WHERE to_id=$1 GROUP BY post_id ORDER BY SUM(amount) DESC, post_id LIMIT 5", [user.id]);
    return { total: format(all?.s || 0), count: Number(all?.n || 0), last30: { total: format(m?.s || 0), count: Number(m?.n || 0), supporters: Number(m?.p || 0) }, topPosts: posts.map((x) => ({ post: x.post_id, total: format(x.s), count: Number(x.n) })) };
  }
  async function setReceive(user, on) {
    await led.ensureAccount(db, userAcc(user.id));
    await db.run("UPDATE mjt_accounts SET receive=$1, updated_at=$2 WHERE id=$3", [on ? 1 : 0, nowIso(), userAcc(user.id)]);
    return { receive: !!on };
  }

  /* ---------- internal spend / refund (store integration point for a later stage) ---------- */
  async function spend(uid, units, { ikey, refType = "purchase", refId = null, memo = null, to = SYS.treasury } = {}) {
    if (!ikey) throw new Error("MJT spend: ikey required");
    const acc = userAcc(uid);
    return db.tx(async (t) => { await led.lock(t, [acc]); return led.post(t, { ikey: "spend:" + ikey, kind: "spend", userId: uid, refType, refId, memo, lines: [{ account: acc, amount: -units }, { account: to, amount: units }] }); });
  }
  async function refund(spendTxId, { ikey } = {}) {
    const s = await db.get("SELECT * FROM mjt_tx WHERE id=$1 AND kind='spend'", [spendTxId]); if (!s) throw E.nf();
    return db.tx(async (t) => {
      await led.lock(t, [userAcc(s.user_id)]);
      if (await t.get("SELECT 1 x FROM mjt_tx WHERE reverses=$1 AND kind='refund'", [s.id])) { const p = await t.get("SELECT * FROM mjt_tx WHERE reverses=$1 AND kind='refund'", [s.id]); return { tx: p, replayed: true }; }
      return led.post(t, { ikey: "refund:" + (ikey || s.id), kind: "refund", userId: s.user_id, refType: s.ref_type, refId: s.ref_id, reverses: s.id, allowFrozen: true, lines: await led.reversalLines(t, s.id) });
    });
  }

  /* ---------- staff ---------- */
  async function adjust(user, b = {}) {
    const ikeyIn = String(b.ikey || ""); if (!IKEY_RE.test(ikeyIn)) throw fail(400, "ikey_required", "مفتاح العملية مطلوب");
    const u = await db.get("SELECT id, handle FROM users WHERE LOWER(handle)=LOWER($1)", [String(b.handle || "").replace(/^@/, "").slice(0, 60)]); if (!u) throw E.nf("الحساب غير موجود");
    const amount = parseAmount(b.amount, { allowNegative: true });
    if (Math.abs(amount) > 10000 * UNIT) throw fail(400, "adjust_max", "أقصى تعديل ١٠٬٠٠٠ MJT في المرة");
    const reason = str(b.reason, 300, { required: true, min: 5 });
    const acc = userAcc(u.id);
    const r = await db.tx(async (t) => {
      await led.lock(t, [acc]);
      return led.post(t, { ikey: `adj:${user.id}:${ikeyIn}`, kind: "adjustment", actorId: user.id, userId: u.id, refType: "staff", memo: reason, allowFrozen: true,
        lines: amount > 0 ? [{ account: SYS.mint, amount: -amount }, { account: acc, amount }] : [{ account: acc, amount }, { account: SYS.burn, amount: -amount }] });
    });
    if (!r.replayed) { ctx.audit?.("mjt_adjusted", u.id, `${format(amount)} MJT: ${reason}`, user.id); await notify(u.id, "mjt_adjusted", { ref: r.tx.id }); }
    return { replayed: r.replayed, txId: r.tx.id, handle: u.handle, amount: format(amount), balance: money((await walletOf(u.id)).balance) };
  }
  async function freeze(user, handle, b = {}) {
    const u = await db.get("SELECT id, handle FROM users WHERE LOWER(handle)=LOWER($1)", [String(handle || "").replace(/^@/, "").slice(0, 60)]); if (!u) throw E.nf("الحساب غير موجود");
    const reason = str(b.reason, 300, { required: true, min: 5 }), on = !!b.frozen;
    await led.ensureAccount(db, userAcc(u.id));
    await db.run("UPDATE mjt_accounts SET status=$1, updated_at=$2 WHERE id=$3", [on ? "frozen" : "active", nowIso(), userAcc(u.id)]);
    await db.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES($1,$2,$3,NULL,$4,$5)", [on ? "freeze" : "unfreeze", user.id, u.id, JSON.stringify({ reason }), nowIso()]);
    ctx.audit?.(on ? "mjt_frozen" : "mjt_unfrozen", u.id, reason, user.id);
    return { handle: u.handle, frozen: on };
  }

  /* ---------- reads ---------- */
  async function me(user) {
    const S = await settings(), w = await walletOf(user.id), derived = await led.derivedOf(db, userAcc(user.id));
    if (derived !== w.balance) logger.error?.("mjt balance mismatch", { user: user.id });
    const conv = await db.get("SELECT pts, amount, created_at FROM mjt_conversions WHERE user_id=$1 AND status='applied'", [user.id]);
    const why = await sendBlock(user, S), d = await sentSince(user.id, dayStart());
    return { token: TOKEN, balance: money(w.balance), verified: derived === w.balance, frozen: w.status !== "active", receive: w.receive, minor: await isMinor(user.id),
      today: { earned: format(await earnedToday(user.id)), cap: format(S.rewards.dailyCap), sent: format(d.sum), sendLimit: format(S.transfers.maxDaily) },
      conversion: conv ? { pts: Number(conv.pts), mjt: format(conv.amount), at: conv.created_at } : null,
      send: { allowed: !why, reason: why?.code || null, note: why?.msg || null } };
  }
  async function history(user, q = {}) {
    const lim = int(q.limit, 30, 1, 100), args = [userAcc(user.id)]; let w = "";
    if (q.cursor) { args.push(int(q.cursor, 0, 0, Number.MAX_SAFE_INTEGER)); w = ` AND e.id < $${args.length}`; }
    const rows = await db.all(`SELECT e.id eid, e.amount, e.balance_after, e.created_at, t.id tid, t.kind, t.memo, t.user_id, t.other_id, t.ref_id, t.ref_type, k.anon tip_anon FROM mjt_entries e JOIN mjt_tx t ON t.id=e.tx_id LEFT JOIN mjt_tips k ON k.tx_id=t.id WHERE e.account_id=$1${w} ORDER BY e.id DESC LIMIT ${lim + 1}`, args);
    const ids = [...new Set(rows.slice(0, lim).flatMap((r) => (r.kind === "transfer" || r.kind === "tip" ? [r.user_id, r.other_id] : [])).filter((x) => x && x !== user.id))];
    const ppl = new Map(); for (const uid of ids) ppl.set(uid, pub(await db.get("SELECT handle, name, avatar FROM users WHERE id=$1", [uid])));
    const items = rows.slice(0, lim).map((r) => {
      const amt = Number(r.amount), tip = r.kind === "tip";
      // an anonymous tip hides the tipper from the creator's history (the tipper still sees whom they supported)
      const cp = r.kind === "transfer" || (tip && !(amt > 0 && Number(r.tip_anon))) ? ppl.get(amt < 0 ? r.other_id : r.user_id) || null : null;
      const label = r.kind === "transfer" ? (amt < 0 ? "تحويل مُرسَل" : "تحويل مُستلَم") : tip && r.ref_type === "room" ? (amt < 0 ? "إكرامية في بث مباشر" : Number(r.tip_anon) ? "إكرامية بث من داعم مجهول" : "إكرامية في بثّك المباشر") : tip ? (amt < 0 ? "إكرامية مُرسَلة" : Number(r.tip_anon) ? "إكرامية من داعم مجهول" : "إكرامية مُستلَمة") : KIND_AR[r.kind] || r.kind;
      return { id: r.tid, kind: r.kind, label, amount: format(amt), balanceAfter: format(r.balance_after), with: cp, post: tip && r.ref_type !== "room" ? r.ref_id || null : undefined, room: tip && r.ref_type === "room" ? r.ref_id || null : undefined,
        note: r.kind === "transfer" || r.kind === "adjustment" || tip ? r.memo || null : null, createdAt: r.created_at };
    });
    return { items, next: rows.length > lim ? String(rows[lim - 1].eid) : null };
  }
  async function config(user) {
    const S = await settings();
    let kinds = []; try { const P = await ctx.services.points?.settings?.(); kinds = EARN_KINDS.map((k) => ({ key: k, label: ctx.services.points?.KIND_INFO?.[k] || k, mjt: format((P?.kinds?.[k]?.points || 0) * RATE), dailyCap: P?.kinds?.[k]?.dailyCap ?? null })); } catch { /* points optional */ }
    return { token: TOKEN, rate: { pointsPerMjt: 1, text: "1 نقطة مساهمة = 1 MJT" }, earn: { kinds, dailyCap: format(S.rewards.dailyCap), enabled: !!S.rewards.enabled },
      transfers: { enabled: !!S.transfers.enabled, maxSingle: format(S.transfers.maxSingle), maxDaily: format(S.transfers.maxDaily), maxPerHour: S.transfers.maxPerHour, minAccountDays: S.transfers.minAccountDays },
      buy: { available: false, reason: piOn() ? "later_stage" : "pi_off", note: piOn() ? "شراء مجتمع كوين بـ Pi يأتي في مرحلة لاحقة" : "شراء مجتمع كوين بـ Pi غير متاح الآن — مدفوعات Pi غير مفعّلة بعد" },
      signedIn: !!user };
  }
  async function publicSupply() {
    const s = await led.supply();
    const c = await db.get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) a, COALESCE(SUM(pts),0) p FROM mjt_conversions WHERE status='applied'");
    const b = await db.get("SELECT COUNT(*) n FROM mjt_conversion_batches WHERE status='applied'");
    return { token: TOKEN, minted: format(s.minted), burned: format(s.burned), circulating: format(s.circulating), holders: s.holders,
      conversion: { rate: "1 نقطة = 1 MJT", batches: Number(b?.n || 0), users: Number(c?.n || 0), pts: Number(c?.p || 0), mjt: format(c?.a || 0) }, launch: await launchAt() };
  }
  async function adminOverview() {
    const S = await settings(), v = await led.verify();
    const batches = await db.all("SELECT * FROM mjt_conversion_batches ORDER BY created_at DESC LIMIT 20");
    const recent = await db.all("SELECT t.id, t.kind, t.amount, t.memo, t.created_at, u.handle FROM mjt_tx t LEFT JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC, t.id DESC LIMIT 30");
    const frozen = await db.all("SELECT u.handle FROM mjt_accounts a JOIN users u ON u.id=a.user_id WHERE a.status='frozen' LIMIT 100");
    return { token: TOKEN, settings: settingsClient(S), launch: await launchAt(), verify: { ok: v.ok, problems: v.problems, checkedAt: v.checkedAt },
      supply: { minted: format(v.supply.minted), burned: format(v.supply.burned), circulating: format(v.supply.circulating), treasury: format(v.supply.treasury), holders: v.supply.holders, accounts: v.supply.accounts },
      batches: await Promise.all(batches.map(batchClient)), recent: recent.map((r) => ({ id: r.id, kind: r.kind, label: KIND_AR[r.kind] || r.kind, amount: format(r.amount), handle: r.handle || null, memo: r.kind === "adjustment" ? r.memo : null, createdAt: r.created_at })),
      frozen: frozen.map((r) => r.handle) };
  }

  /* ---------- routes ---------- */
  R.get("/api/mjt/config", async (req) => config(req.user));
  R.get("/api/mjt/supply", async () => publicSupply());
  R.get("/api/mjt/me", A(async (req) => me(req.user)));
  R.get("/api/mjt/history", A(async (req) => history(req.user, req.query)));
  R.post("/api/mjt/transfers", A(async (req) => transfer(req.user, req.body)));
  R.post("/api/mjt/posts/:id/tips", A(async (req) => tipPost(req.user, req.params.id, req.body || {})));
  R.get("/api/mjt/posts/:id/tips", A(async (req) => tipSummary(req.user, req.params.id)));
  R.post("/api/mjt/rooms/:id/tips", A(async (req) => tipRoom(req.user, req.params.id, req.body || {})));
  R.get("/api/mjt/rooms/:id/tips", A(async (req) => tipSummary(req.user, req.params.id)));
  R.get("/api/mjt/tips/received", A(async (req) => tipsReceived(req.user)));
  R.put("/api/mjt/receive", A(async (req) => setReceive(req.user, req.body?.receive !== false)));
  R.post("/api/mjt/buy", A(async () => { throw E.off(piOn() ? "شراء مجتمع كوين بـ Pi يأتي في مرحلة لاحقة" : "شراء مجتمع كوين بـ Pi غير متاح الآن — مدفوعات Pi غير مفعّلة بعد"); }));
  R.get("/api/admin/mjt", staff(async () => adminOverview()));
  R.get("/api/admin/mjt/verify", staff(async () => led.verify()));
  R.put("/api/admin/mjt/settings", admin(async (req) => saveSettings(req.user, req.body)));
  R.post("/api/admin/mjt/adjust", admin(async (req) => adjust(req.user, req.body)));
  R.post("/api/admin/mjt/accounts/:handle/freeze", admin(async (req) => freeze(req.user, req.params.handle, req.body)));
  R.get("/api/admin/mjt/conversion/dry-run", admin(async () => dryRun()));
  R.post("/api/admin/mjt/conversion", admin(async (req) => convert(req.user.id)));
  R.post("/api/admin/mjt/conversion/:id/rollback", admin(async (req) => rollback(req.params.id, req.user.id, { dryRun: !!req.body?.dryRun })));
  R.post("/api/admin/mjt/reconcile", admin(async () => reconcile()));

  /* ---------- boot ---------- */
  const ready = (async () => { await led.ensureSystem(); await launchAt(); })().catch((e) => logger.error?.("mjt init failed", { err: e?.message }));
  if (opts.autoConvert !== false && env.MJT_AUTO_CONVERT !== "0" && linked()) {
    const tm = setTimeout(async () => {
      try { await ready; const s = await settings(); if (s.conversion.auto === false) return; const r = await convert("system"); if (r.applied) logger.info?.("mjt conversion applied", { batch: r.batch.id, users: r.batch.users, amount: r.batch.amount }); }
      catch (e) { logger.error?.("mjt auto conversion failed", { err: e?.message }); }
    }, +(env.MJT_AUTO_CONVERT_DELAY_MS || 4000));
    tm.unref?.();
  }
  /* v2.74.1 owner test balance: MJT_OWNER_GRANT="<whole MJT>:<key>" mints that amount ONCE to the platform owner (the oldest
   * admin) as a staff adjustment, so the owner can try every MJT feature. Idempotent forever by key (a redeploy or restart
   * never pays twice; a new key = a new grant). Audited; reversible with a negative staff adjustment from #/admin/mjt. */
  async function ownerGrant(spec) {
    const m = /^(\d{1,7}):([A-Za-z0-9_-]{3,40})(?::@?([A-Za-z0-9_.]{2,60}))?$/.exec(String(spec || "").trim()); if (!m) return null;
    const amount = Number(m[1]) * UNIT; if (!(amount > 0)) return null;
    // v2.74.2: an explicit handle (3rd part) names the owner's own account; without it, the oldest admin
    const owner = m[3] ? await db.get("SELECT id, handle FROM users WHERE LOWER(handle)=LOWER($1) AND status='active'", [m[3]])
      : await db.get("SELECT id, handle FROM users WHERE role='admin' AND status='active' ORDER BY created_at, id LIMIT 1"); if (!owner) return null;
    const acc = userAcc(owner.id);
    const r = await db.tx(async (t) => { await led.lock(t, [acc]); return led.post(t, { ikey: `owner-grant:${m[2]}`, kind: "adjustment", actorId: "system", userId: owner.id, refType: "staff", memo: "رصيد تجربة للمالك (بطلبه)", allowFrozen: true, lines: [{ account: SYS.mint, amount: -amount }, { account: acc, amount }] }); });
    if (!r.replayed) { ctx.audit?.("mjt_adjusted", owner.id, `${format(amount)} MJT: owner test grant`, "system"); logger.info?.("mjt owner grant applied", { amount: format(amount) }); }
    return { replayed: r.replayed, handle: owner.handle, amount: format(amount) };
  }
  /** v2.74.2: undo an owner grant by key (it went to the wrong account) — one reversal tx, idempotent */
  async function ownerGrantUndo(key) {
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(String(key || ""))) return null;
    const g = await db.get("SELECT * FROM mjt_tx WHERE ikey=$1", [`owner-grant:${key}`]); if (!g) return null;
    const r = await db.tx(async (t) => { await led.lock(t, [userAcc(g.user_id)]); return led.post(t, { ikey: `owner-grant-undo:${key}`, kind: "adjustment", actorId: "system", userId: g.user_id, refType: "staff", reverses: g.id, memo: "إلغاء رصيد تجربة أُضيف لحساب خاطئ", allowFrozen: true, lines: await led.reversalLines(t, g.id) }); });
    if (!r.replayed) logger.info?.("mjt owner grant undone", { key });
    return { replayed: r.replayed };
  }
  /** v2.74.2: one-time move of a stored 7-day transfer wait to 0 (the owner removed the wait); later admin edits stay */
  async function dropMinAge() {
    const done = await db.get("SELECT 1 x FROM mjt_settings WHERE key='min_age_v2742'"); if (done) return;
    const cur = await settings();
    if (cur.transfers.minAccountDays === 7) { const next = JSON.parse(JSON.stringify(cur)); next.transfers.minAccountDays = 0; await writeSettings(next, "system"); }
    await db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('min_age_v2742','1','system',$1) ON CONFLICT DO NOTHING", [nowIso()]);
  }
  ready.then(() => dropMinAge()).catch((e) => logger.error?.("mjt min age reset failed", { err: e?.message }));
  if (env.MJT_OWNER_GRANT || env.MJT_OWNER_GRANT_UNDO) {
    const tu = setTimeout(async () => { try { await ready; if (env.MJT_OWNER_GRANT_UNDO) await ownerGrantUndo(env.MJT_OWNER_GRANT_UNDO); } catch (e) { logger.error?.("mjt owner grant undo failed", { err: e?.message }); } }, 5000); tu.unref?.();
  }
  if (env.MJT_OWNER_GRANT) { const tg = setTimeout(async () => { try { await ready; await ownerGrant(env.MJT_OWNER_GRANT); } catch (e) { logger.error?.("mjt owner grant failed", { err: e?.message }); } }, 6000); tg.unref?.(); }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("mjt.reconcile", +(env.MJT_RECONCILE_INTERVAL_MS || 15 * 60e3), () => reconcile());
  return { ready, onAward, onAwardReversed, reconcile, convert, dryRun, rollback, transfer, tipPost, tipRoom, tipSummary, tipsReceived, ownerGrant, ownerGrantUndo, dropMinAge, adjust, freeze, spend, refund, me, history, settings, launchAt, linked, verify: () => led.verify(), supply: () => led.supply(), ledger: led, RATE, TOKEN, EARN_KINDS,
    guards: { isMinor, blockedBetween, linkedPair, flagged, walletOf } }; // v2.60: the transfer safety checks, reused by community MJT rewards
};
