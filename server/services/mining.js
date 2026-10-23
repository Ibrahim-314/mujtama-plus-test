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
 * Staff: GET/PUT /api/admin/mjt/mining (on/off, rate per day, sign-in reward). Not a blockchain, not Pi mining. */
const { E, HttpError, id } = require("../lib/core");
const L = require("../lib/mjt-ledger");
const { UNIT, SYS, userAcc, parseAmount, format } = L;

const HOUR = 3600e3, SESSION = 24 * HOUR;
const DEFAULTS = { enabled: true, rate: 5 * UNIT, checkin: 1 * UNIT, checkinOn: true };

/** @param {any} ctx @param {{ now?: () => Date|number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => { const n = opts.now ? opts.now() : new Date(); return n instanceof Date ? n : new Date(n); };
  const nowIso = () => clock().toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const mjt = () => ctx.services.mjt;
  const led = () => mjt().ledger;
  const parse = (v, d) => { try { return JSON.parse(v) ?? d; } catch { return d; } };

  let cache = null;
  async function settings() {
    if (cache && cache.at > Date.now() - 5e3) return cache.v;
    const s = parse((await db.get("SELECT value FROM mjt_settings WHERE key='mining'"))?.value, {});
    const v = { ...DEFAULTS, ...s }; cache = { at: Date.now(), v }; return v;
  }
  async function saveSettings(user, b = {}) {
    const cur = await settings(), next = { ...cur };
    const amt = (v, lo, hi) => { const u = parseAmount(String(v)); if (u < lo * UNIT || u > hi * UNIT) throw E.bad("قيمة خارج الحدود"); return u; };
    if (b.enabled !== undefined) next.enabled = !!b.enabled;
    if (b.checkinOn !== undefined) next.checkinOn = !!b.checkinOn;
    if (b.rate !== undefined) next.rate = amt(b.rate, 0.1, 1000);
    if (b.checkin !== undefined) next.checkin = amt(b.checkin, 0.1, 100);
    await db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('mining',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(next), user.id, nowIso()]);
    cache = null; ctx.audit?.("mjt_mining_settings", "mjt", null, user.id);
    return adminView();
  }
  const adminView = async () => { const s = await settings(); return { enabled: !!s.enabled, rate: format(s.rate), checkinOn: !!s.checkinOn, checkin: format(s.checkin) }; };

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

  async function claim(user) {
    const s = await active(user.id);
    if (!s) throw fail(409, "no_session", "لا يوجد تعدين نشط");
    if (Date.parse(s.ends_at) > clock().getTime()) throw fail(409, "not_ready", "لم تكتمل دورة التعدين بعد");
    const r = await db.tx((t) => payInside(t, s));
    ctx.realtime?.send?.(user.id, "mjt", { kind: "mining", amount: format(r.amount) });
    return { claimed: format(r.amount), state: await state(user) };
  }

  async function start(user) {
    const S = await settings();
    if (!S.enabled) throw fail(409, "mining_off", "التعدين متوقف مؤقتاً");
    const now = clock().getTime();
    let claimed = null;
    const cur = await active(user.id);
    if (cur && Date.parse(cur.ends_at) > now) return { started: false, claimed, state: await state(user) }; // already mining
    const boost = Math.max(0, Math.min(500, Math.floor(await boostOf(user.id)) || 0));
    const amount = Math.floor((S.rate * (100 + boost)) / 100);
    await db.tx(async (t) => {
      if (cur) { const p = await payInside(t, cur); claimed = p.amount; }
      const at = new Date(now).toISOString(), ends = new Date(now + SESSION).toISOString();
      await t.run("INSERT INTO mjt_mining(id,user_id,started_at,ends_at,rate,boost,amount,status) VALUES($1,$2,$3,$4,$5,$6,$7,'active') ON CONFLICT DO NOTHING", [id("mn"), user.id, at, ends, S.rate, boost, amount]);
    });
    if (claimed) ctx.realtime?.send?.(user.id, "mjt", { kind: "mining", amount: format(claimed) });
    return { started: true, claimed: claimed ? format(claimed) : null, state: await state(user) };
  }

  async function checkin(user) {
    const S = await settings();
    if (!S.checkinOn) return { credited: false, reason: "off", state: await checkinState(user.id) };
    const d = day(), acc = userAcc(user.id);
    const r = await db.tx(async (t) => {
      const ins = await t.run("INSERT INTO mjt_checkins(user_id,day,amount,tx_id,created_at) VALUES($1,$2,$3,NULL,$4) ON CONFLICT DO NOTHING", [user.id, d, S.checkin, nowIso()]);
      if (!ins.changes) return { credited: false, reason: "done" };
      await led().lock(t, [acc]);
      const p = await led().post(t, { ikey: `checkin:${user.id}:${d}`, kind: "checkin", userId: user.id, refType: "checkin", refId: d, memo: "daily_signin",
        lines: [{ account: SYS.mint, amount: -S.checkin }, { account: acc, amount: S.checkin }] });
      await t.run("UPDATE mjt_checkins SET tx_id=$1 WHERE user_id=$2 AND day=$3", [p.tx.id, user.id, d]);
      return { credited: true };
    });
    if (r.credited) ctx.realtime?.send?.(user.id, "mjt", { kind: "checkin", amount: format(S.checkin) });
    return { ...r, amount: format(S.checkin), state: await checkinState(user.id) };
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
    return { on: !!S.checkinOn, amount: format(S.checkin), today: days.includes(today), streak: streakOf(days, today), week };
  }

  async function state(user) {
    const S = await settings(), now = clock().getTime();
    const s = await active(user.id);
    const tot = await db.get("SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM mjt_mining WHERE user_id=$1 AND status='claimed'", [user.id]);
    const recent = await db.all("SELECT * FROM mjt_mining WHERE user_id=$1 AND status='claimed' ORDER BY started_at DESC LIMIT 7", [user.id]);
    const days = (await db.all("SELECT started_at FROM mjt_mining WHERE user_id=$1 ORDER BY started_at DESC LIMIT 60", [user.id])).map((r) => String(r.started_at).slice(0, 10));
    const w = await mjt().guards.walletOf(user.id);
    return {
      enabled: !!S.enabled, now: new Date(now).toISOString(), sessionHours: SESSION / HOUR,
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
  R.get("/api/admin/mjt/mining", A(async (req) => { if (!["admin", "moderator"].includes(req.user.role)) throw E.forbid("للفريق فقط"); return adminView(); }));
  R.put("/api/admin/mjt/mining", A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return saveSettings(req.user, req.body || {}); }));

  return { state, start, claim, checkin, settings, boostOf, SESSION };
};
