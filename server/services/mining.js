/* v2.87 «التعدين» — daily MJT mining + the daily sign-in reward (migration 079_mjt_mining). Owner, 2026-10-24:
 * «العضو يربح كل 24 ساعه ويشوف عداد التعدين يرتفع معه ... كل يوم يكسب 5 من العمله وفيه تسجيل الدخول يكسب 1 عمله
 *  وفيه إضافات في المتجر تزود التعدين ولكن لا تضيفها الان».
 *
 * 1. Mining: the member taps «ابدأ التعدين» → a 24-hour session starts with its amount fixed up front
 *    (rate per day × (100 + boost)/100; default rate 5 MJT, boost 0). The counter is computed from started_at/ends_at, so
 *    the client animates it and the server never trusts a client number. When the session ends the member claims it
 *    (or starting the next session claims it first). A claim mints exactly `amount` from sys:mint to the member in ONE
 *    ledger transaction keyed "mine:<session>" — a replayed or concurrent claim pays once. One active session per member
 *    (partial unique index). Mining rewards are their own kind ("mining") and do not use the contribution daily cap.
 * 2. Sign-in reward: once per UTC day, +1 MJT ("checkin"), keyed "checkin:<user>:<day>" + primary key (user, day).
 * 3. Boosts: boostOf(uid) is the single hook the store will use later; it returns 0 today, and the API reports no boosts.
 * 4. Frozen wallets keep mining but cannot claim until unfrozen (the session waits, nothing is lost).
 * v2.167 «تلقائي»: rate and sign-in amount are fixed (app-defaults mjt.mining: 5 / 1); the admin API was removed. Both paths
 *   now count inside the overall earning caps (services/mjt-safety.js capRoom: 30–50 a day by level, 250 a week, 800 a month):
 *   a new session's amount is the room left (none left → 409 cap_reached), the sign-in reward likewise. And both pass the
 *   identity checks: an account that fails them gets its mining / sign-in amount as a WAITING entry in the reward journal
 *   (mjt_reward_entries, source mining | checkin) that services/auto-rules.js releases after 72 h unless the account is
 *   reported or banned. Not a blockchain, not Pi mining. */
const { HttpError, id } = require("../lib/core");
const L = require("../lib/mjt-ledger");
const { UNIT, SYS, userAcc, format } = L;
const DEF = require("../config/app-defaults");

const HOUR = 3600e3, SESSION = 24 * HOUR;
const DEFAULTS = { enabled: true, rate: DEF.mjt.mining.rate * UNIT, checkin: DEF.mjt.mining.checkin * UNIT, checkinOn: true };

/** @param {any} ctx @param {{ now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const mjt = () => ctx.services.mjt;
  const led = () => mjt().ledger;
  /* v2.163 legacy switches (services/mjt-legacy.js, default ON): mining → no NEW session; checkin → no new +1 MJT.
   * A session started before the switch can still be claimed (its amount was fixed at start; nothing is lost). */
  const legacyOn = async (k) => { const l = ctx.services.mjtLegacy; return l ? l.isOn(k) : true; };

  async function settings() { return { ...DEFAULTS }; } // v2.167: fixed (app-defaults)
  const SF = () => ctx.services.mjtSafety, RW = () => ctx.services.mjtRewards;
  /** identity check codes for this member's own legacy earning ([] = pay now) */
  const heldFor = async (uid) => (SF() ? SF().earnReasons(uid) : []);
  /** room left under the overall caps, in minor units */
  const roomFor = async (uid) => (SF() ? (await SF().capRoom(uid)).room : Infinity);
  const capErr = () => fail(409, "cap_reached", "وصلت حد الكسب لهذه الفترة (اليوم أو الأسبوع أو الشهر) — يرجع التعدين بعد تجدّد الحد");

  /** the store hook (later stage): extra mining percent for a member. Nothing sells boosts yet. */
  async function boostOf(/* uid */) { return 0; }

  const day = (iso = nowIso()) => iso.slice(0, 10);
  const sessionOut = (s, now) => s && ({
    id: s.id, startedAt: s.started_at, endsAt: s.ends_at, status: s.status, boost: Number(s.boost || 0),
    amount: format(s.amount), units: Number(s.amount), ready: s.status === "active" && Date.parse(s.ends_at) <= now,
    claimedAt: s.claimed_at || null
  });
  const active = (uid, q = db) => q.get("SELECT * FROM mjt_mining WHERE user_id=$1 AND status='active'", [uid]);

  /** mint a finished session (inside transaction t). Idempotent by the ledger key and the status flip. */
  async function payInside(t, s) {
    const acc = userAcc(s.user_id);
    await led().lock(t, [acc]);
    const w = await t.get("SELECT status FROM mjt_accounts WHERE id=$1", [acc]);
    if (w && w.status !== "active") throw fail(409, "account_frozen", "المحفظة موقوفة مؤقتاً — يبقى تعدينك محفوظاً حتى تُفعَّل");
    const r = await led().post(t, { ikey: "mine:" + s.id, kind: "mining", userId: s.user_id, refType: "mining", refId: s.id, memo: "daily_mining",
      lines: [{ account: SYS.mint, amount: -Number(s.amount) }, { account: acc, amount: Number(s.amount) }] });
    const at = nowIso();
    const up = await t.run("UPDATE mjt_mining SET status='claimed', claimed_at=$1, tx_id=$2 WHERE id=$3 AND status='active'", [at, r.tx.id, s.id]);
    return { paid: !!up.changes || r.replayed, txId: r.tx.id, amount: Number(s.amount) };
  }

  /** a finished session: held by the identity checks → a waiting journal entry (released automatically), else minted now */
  async function settle(s) {
    const why = await heldFor(s.user_id);
    if (why.length && RW()) {
      await RW().credit(s.user_id, { amount: Number(s.amount), source: "mining", ref: s.id, reason: "التعدين اليومي", ikey: "mine:" + s.id, pending: why.join(" · ") });
      await db.run("UPDATE mjt_mining SET status='claimed', claimed_at=$1 WHERE id=$2 AND status='active'", [nowIso(), s.id]);
      return { paid: false, held: true, amount: Number(s.amount) };
    }
    return db.tx((t) => payInside(t, s));
  }

  async function claim(user) {
    const s = await active(user.id);
    if (!s) throw fail(409, "no_session", "لا يوجد تعدين نشط");
    if (Date.parse(s.ends_at) > clock().getTime()) throw fail(409, "not_ready", "لم تكتمل دورة التعدين بعد");
    const r = await settle(s);
    if (!r.held) ctx.realtime?.send?.(user.id, "mjt", { kind: "mining", amount: format(r.amount) });
    return { claimed: format(r.amount), held: !!r.held, ...(r.held ? { note: "التعدين قيد التحقق التلقائي ويُضاف لرصيدك خلال 72 ساعة" } : {}), state: await state(user) };
  }

  async function start(user) {
    const S = await settings();
    if (!S.enabled) throw fail(409, "mining_off", "التعدين متوقف مؤقتاً");
    if (!(await legacyOn("mining"))) throw ctx.services.mjtLegacy.error("mining");
    const now = clock().getTime();
    let claimed = null;
    const cur = await active(user.id);
    if (cur && Date.parse(cur.ends_at) > now) return { started: false, claimed, state: await state(user) }; // already mining
    if (cur) { const p = await settle(cur); claimed = p.amount; if (!p.held) ctx.realtime?.send?.(user.id, "mjt", { kind: "mining", amount: format(p.amount) }); }
    const boost = Math.max(0, Math.min(500, Math.floor(await boostOf(user.id)) || 0));
    const room = await roomFor(user.id);
    if (room <= 0) throw capErr();
    const amount = Math.min(Math.floor((S.rate * (100 + boost)) / 100), room);
    const at = new Date(now).toISOString(), ends = new Date(now + SESSION).toISOString();
    await db.run("INSERT INTO mjt_mining(id,user_id,started_at,ends_at,rate,boost,amount,status) VALUES($1,$2,$3,$4,$5,$6,$7,'active') ON CONFLICT DO NOTHING", [id("mn"), user.id, at, ends, S.rate, boost, amount]);
    return { started: true, claimed: claimed ? format(claimed) : null, state: await state(user) };
  }

  async function checkin(user) {
    const S = await settings();
    if (!S.checkinOn) return { credited: false, reason: "off", state: await checkinState(user.id) };
    if (!(await legacyOn("checkin"))) throw ctx.services.mjtLegacy.error("checkin");
    const d = day(), acc = userAcc(user.id);
    if (await db.get("SELECT 1 x FROM mjt_checkins WHERE user_id=$1 AND day=$2", [user.id, d])) return { credited: false, reason: "done", amount: format(S.checkin), state: await checkinState(user.id) };
    const room = await roomFor(user.id);
    if (room <= 0) return { credited: false, reason: "cap_reached", note: "وصلت حد الكسب لهذه الفترة", amount: format(S.checkin), state: await checkinState(user.id) };
    const amount = Math.min(S.checkin, room);
    const why = await heldFor(user.id);
    if (why.length && RW()) {
      const ins = await db.run("INSERT INTO mjt_checkins(user_id,day,amount,tx_id,created_at) VALUES($1,$2,$3,NULL,$4) ON CONFLICT DO NOTHING", [user.id, d, amount, nowIso()]);
      if (!ins.changes) return { credited: false, reason: "done", amount: format(S.checkin), state: await checkinState(user.id) };
      await RW().credit(user.id, { amount, source: "checkin", ref: d, reason: "مكافأة الدخول اليومي", ikey: `checkin:${user.id}:${d}`, pending: why.join(" · ") });
      return { credited: false, held: true, reason: "held", note: "المكافأة قيد التحقق التلقائي وتُضاف لرصيدك خلال 72 ساعة", amount: format(amount), state: await checkinState(user.id) };
    }
    const r = await db.tx(async (t) => {
      const ins = await t.run("INSERT INTO mjt_checkins(user_id,day,amount,tx_id,created_at) VALUES($1,$2,$3,NULL,$4) ON CONFLICT DO NOTHING", [user.id, d, amount, nowIso()]);
      if (!ins.changes) return { credited: false, reason: "done" };
      await led().lock(t, [acc]);
      const p = await led().post(t, { ikey: `checkin:${user.id}:${d}`, kind: "checkin", userId: user.id, refType: "checkin", refId: d, memo: "daily_signin",
        lines: [{ account: SYS.mint, amount: -amount }, { account: acc, amount }] });
      await t.run("UPDATE mjt_checkins SET tx_id=$1 WHERE user_id=$2 AND day=$3", [p.tx.id, user.id, d]);
      return { credited: true };
    });
    if (r.credited) ctx.realtime?.send?.(user.id, "mjt", { kind: "checkin", amount: format(amount) });
    return { ...r, amount: format(r.credited ? amount : S.checkin), state: await checkinState(user.id) };
  }

  /** consecutive UTC days ending today (or yesterday, when today is not done yet) */
  function streakOf(days, today) {
    const set = new Set(days); let n = 0;
    let t = Date.parse(today + "T00:00:00Z"); if (!set.has(today)) t -= 864e5;
    while (set.has(new Date(t).toISOString().slice(0, 10))) { n++; t -= 864e5; }
    return n;
  }
  async function checkinState(uid) {
    const S = await settings(), today = day();
    const rows = await db.all("SELECT day FROM mjt_checkins WHERE user_id=$1 ORDER BY day DESC LIMIT 60", [uid]);
    const days = rows.map((r) => r.day);
    const week = []; for (let i = 6; i >= 0; i--) { const d = new Date(Date.parse(today + "T00:00:00Z") - i * 864e5).toISOString().slice(0, 10); week.push({ day: d, done: days.includes(d) }); }
    return { on: !!S.checkinOn && (await legacyOn("checkin")), amount: format(S.checkin), today: days.includes(today), streak: streakOf(days, today), week };
  }

  async function state(user) {
    const S = await settings(), now = clock().getTime();
    const s = await active(user.id);
    const tot = await db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM mjt_mining WHERE user_id=$1 AND status='claimed'", [user.id]);
    const recent = await db.all("SELECT * FROM mjt_mining WHERE user_id=$1 AND status='claimed' ORDER BY started_at DESC LIMIT 7", [user.id]);
    const days = (await db.all("SELECT started_at FROM mjt_mining WHERE user_id=$1 ORDER BY started_at DESC LIMIT 60", [user.id])).map((r) => String(r.started_at).slice(0, 10));
    const w = await mjt().guards.walletOf(user.id);
    return {
      enabled: !!S.enabled && (await legacyOn("mining")), now: new Date(now).toISOString(), sessionHours: SESSION / HOUR,
      rate: format(S.rate), rateUnits: Number(S.rate), boost: await boostOf(user.id),
      session: sessionOut(s, now), balance: format(w.balance), frozen: w.status !== "active",
      totals: { mined: format(tot?.s || 0), sessions: Number(tot?.n || 0), streak: streakOf(days, day()) },
      recent: recent.map((r) => ({ amount: format(r.amount), startedAt: r.started_at, claimedAt: r.claimed_at })),
      checkin: await checkinState(user.id)
    };
  }

  R.get("/api/mjt/mining", A(async (req) => state(req.user)));
  R.post("/api/mjt/mining/start", A(async (req) => start(req.user)));
  R.post("/api/mjt/mining/claim", A(async (req) => claim(req.user)));
  R.post("/api/mjt/checkin", A(async (req) => checkin(req.user)));

  return { state, start, claim, checkin, settings, boostOf, SESSION };
};
