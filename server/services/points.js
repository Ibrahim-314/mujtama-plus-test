/* Contribution rewards + points linked to Pi (phase 59).
 *  1. Points for QUALITY contributions only (a periodic, idempotent scan of what already happened — no other service is edited):
 *     answer_accepted (your answer accepted by the asker), engaged_post (a post that got meaningful engagement from ≥ N distinct,
 *     trusted, unlinked people), report_confirmed (a report staff/moderators actioned), wiki_edit (substantial wiki edit, one per
 *     page per day), mentoring (accepted answer to a newcomer's question; a referred member who stays active 7 days).
 *  2. Anti-gaming: per-kind + total daily caps, cooldown between awards of a kind, minimum trust score (phase 7/32 trust signals)
 *     and account age, integrity-flagged accounts earn nothing, linked accounts (same device) never count for each other, a
 *     weekly cap per pair of accounts, and engagement only counts from accounts older than ENGAGER_MIN_AGE days.
 *     Minors (< 18, phase 35) earn points that can NEVER be redeemed (redeemable = 0) and are hidden from the public leaderboard.
 *     Removed content (CONTENT_REMOVED) reverses its points.
 *  3. Levels (8) + leaderboard (all time / this month / campaign) with opt-out; full points history.
 *  4. Optional redemption of points into Pi rewards from a PLATFORM-FUNDED pool recorded in lib/ledger.js (REWARDS journals):
 *     admin sets the rate (points per 1 π), the monthly pool cap and funds the pool; a request reserves pool → user:<id>:rewards,
 *     staff pay it from the app wallet and record the Pi txid (no A2U — the server holds no wallet seed) or reject it (reversal,
 *     points restored). Redemption is OFF until Pi payments are enabled (PI_ENABLED + PI_API_KEY) AND the admin turns it on with
 *     a rate, a monthly cap and a funded pool.
 *  5. Seasonal campaigns: time-boxed multiplier and/or bonus on chosen kinds, with their own leaderboard. */
const { E, HttpError, str, id } = require("../lib/core");
const { U, toUnits, pi, ACC, createLedger, REWARDS, balance } = require("../lib/ledger");

const DAY = 864e5;
const KIND_INFO = {
  answer_accepted: "إجابة مقبولة", engaged_post: "منشور بتفاعل حقيقي", report_confirmed: "بلاغ مؤكَّد", wiki_edit: "تحرير في الويكي", mentoring: "إرشاد عضو جديد",
  adjustment: "تعديل من الإدارة"
};
const EARN_KINDS = ["answer_accepted", "engaged_post", "report_confirmed", "wiki_edit", "mentoring"];
const LEVELS = [[0, "مبتدئ"], [50, "مشارك"], [150, "مساهم"], [400, "نشِط"], [1000, "موثوق"], [2500, "خبير"], [6000, "مرشد"], [15000, "قدوة المجتمع"]];
const DEFAULTS = {
  kinds: { answer_accepted: { points: 15, dailyCap: 5 }, engaged_post: { points: 10, dailyCap: 3 }, report_confirmed: { points: 5, dailyCap: 5 }, wiki_edit: { points: 4, dailyCap: 5 }, mentoring: { points: 20, dailyCap: 3 } },
  dailyCap: 150, cooldownSec: 60, minTrust: 35, minAccountDays: 3, engagementMin: 3, engagerMinAgeDays: 7, pairWeeklyCap: 3, wikiMinChars: 40, newcomerDays: 30,
  redemption: { enabled: false, rate: 0, monthlyCap: 0, minPoints: 500, perUserMonthly: 1 }
};
const levelOf = (total) => { let l = 0; for (let i = 0; i < LEVELS.length; i++) if (total >= LEVELS[i][0]) l = i; return l; };
const levelInfo = (total) => { const l = levelOf(total), next = LEVELS[l + 1]; return { level: l + 1, name: LEVELS[l][1], min: LEVELS[l][0], next: next ? { level: l + 2, name: next[1], at: next[0], remaining: next[0] - total } : null }; };

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
  const monthOf = (d) => new Date(d).toISOString().slice(0, 7);
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const isStaff = (u) => !!u && ["admin", "moderator"].includes(u.role);
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const staff = (fn) => A(async (req, res) => { if (!isStaff(req.user)) throw E.forbid("للفريق فقط"); return fn(req, res); });
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const { postJournal, reverseAll } = createLedger({ now: nowIso });
  const notify = async (uid, kind, o) => { try { await ctx.services.notify?.notify(uid, kind, o); } catch { /* best effort */ } };
  const piOn = () => { const d = ctx.services.pi?.diag?.(); return !!(d && d.enabled && d.apiKeyPresent); };
  const minors = async (ids) => { try { return (await ctx.services.minors?.minorIds?.(ids)) || new Set(); } catch { return new Set(); } };
  const isMinor = async (uid) => (await minors([uid])).has(uid);

  /* ---------- settings ---------- */
  let cfgCache = null;
  async function settings() {
    if (cfgCache && cfgCache.at > Date.now() - 10e3) return cfgCache.v;
    const r = await db.get("SELECT value FROM points_settings WHERE key='rules'");
    const s = parse(r?.value, {});
    const v = { ...DEFAULTS, ...s, kinds: Object.fromEntries(EARN_KINDS.map((k) => [k, { ...DEFAULTS.kinds[k], ...(s.kinds?.[k] || {}) }])), redemption: { ...DEFAULTS.redemption, ...(s.redemption || {}) } };
    cfgCache = { at: Date.now(), v }; return v;
  }
  async function saveSettings(user, b = {}) {
    const cur = await settings(), next = JSON.parse(JSON.stringify(cur));
    for (const k of EARN_KINDS) if (b.kinds?.[k]) { const x = b.kinds[k]; if (x.points !== undefined) next.kinds[k].points = int(x.points, cur.kinds[k].points, 0, 1000); if (x.dailyCap !== undefined) next.kinds[k].dailyCap = int(x.dailyCap, cur.kinds[k].dailyCap, 0, 100); }
    const nums = { dailyCap: [0, 10000], cooldownSec: [0, 86400], minTrust: [0, 100], minAccountDays: [0, 365], engagementMin: [1, 100], engagerMinAgeDays: [0, 365], pairWeeklyCap: [1, 100], wikiMinChars: [1, 10000], newcomerDays: [1, 365] };
    for (const [k, [lo, hi]] of Object.entries(nums)) if (b[k] !== undefined) next[k] = int(b[k], cur[k], lo, hi);
    if (b.redemption) {
      const r = b.redemption;
      if (r.rate !== undefined) next.redemption.rate = int(r.rate, cur.redemption.rate, 0, 1e9);
      if (r.monthlyCap !== undefined) { const c = Number(r.monthlyCap); if (!Number.isFinite(c) || c < 0 || c > 1e6) throw E.bad("سقف شهري غير صالح"); next.redemption.monthlyCap = Math.round(c * 1e7) / 1e7; }
      if (r.minPoints !== undefined) next.redemption.minPoints = int(r.minPoints, cur.redemption.minPoints, 1, 1e9);
      if (r.perUserMonthly !== undefined) next.redemption.perUserMonthly = int(r.perUserMonthly, cur.redemption.perUserMonthly, 1, 31);
      if (r.enabled !== undefined) {
        next.redemption.enabled = !!r.enabled;
        if (next.redemption.enabled && (!(next.redemption.rate > 0) || !(next.redemption.monthlyCap > 0))) throw fail(409, "redemption_incomplete", "حدّد سعر الاستبدال والسقف الشهري قبل التفعيل");
      }
    }
    await db.run("INSERT INTO points_settings(key,value,updated_by,updated_at) VALUES('rules',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(next), user.id, nowIso()]);
    cfgCache = null; ctx.audit?.("points_settings_saved", user.id, null, "rules");
    return { settings: await settings() };
  }

  /* ---------- balances ---------- */
  async function recompute(uid, q = db) {
    const a = await q.get("SELECT COALESCE(SUM(points),0) t, COALESCE(SUM(CASE WHEN redeemable=1 THEN points ELSE 0 END),0) r FROM points_awards WHERE user_id=$1 AND status='active'", [uid]);
    const red = await q.get("SELECT COALESCE(SUM(points),0) p FROM points_redemptions WHERE user_id=$1 AND status IN ('pending','paid')", [uid]);
    const total = Math.max(0, Number(a?.t || 0)), redeemed = Number(red?.p || 0), redeemable = Math.max(0, Number(a?.r || 0) - redeemed), level = levelOf(total);
    const prev = await q.get("SELECT level FROM points_balances WHERE user_id=$1", [uid]);
    await q.run("INSERT INTO points_balances(user_id,total,redeemable,redeemed,level,optout,updated_at) VALUES($1,$2,$3,$4,$5,0,$6) ON CONFLICT (user_id) DO UPDATE SET total=$2, redeemable=$3, redeemed=$4, level=$5, updated_at=$6", [uid, total, redeemable, redeemed, level, nowIso()]);
    return { total, redeemable, redeemed, level, leveledUp: !!prev && level > Number(prev.level) };
  }

  /* ---------- trust + anti-gaming ---------- */
  const flagged = async () => { const s = new Set(); for (const f of await db.all("SELECT members FROM integrity_flags WHERE status IN ('open','confirmed') AND score >= 0.6").catch(() => [])) for (const m of parse(f.members, [])) s.add(m); return s; };
  async function trustOf(uid) {
    try { const t = await ctx.services.integrity?.trustSignals?.(uid); if (t && Number.isFinite(Number(t.score))) return Number(t.score); } catch { /* fall back */ }
    const u = await db.get("SELECT reputation FROM users WHERE id=$1", [uid]); return 30 + Math.min(30, Number(u?.reputation || 0) / 20);
  }
  async function linked(a, b) {
    if (!a || !b) return false; if (a === b) return true;
    try { const m = await ctx.services.integrity?.linkedAccounts?.(a); return !!m?.has?.(b); } catch { return false; }
  }
  /** one award attempt; returns {awarded, points} or {awarded:false, reason} — idempotent on (user, kind, source) */
  async function award(uid, kind, sourceId, o = {}) {
    const S = await settings(), k = S.kinds[kind];
    if (!k || !(k.points > 0)) return { awarded: false, reason: "kind_off" };
    if (await db.get("SELECT 1 x FROM points_awards WHERE user_id=$1 AND kind=$2 AND source_id=$3", [uid, kind, sourceId])) return { awarded: false, reason: "duplicate" };
    const u = await db.get("SELECT id, status, created_at FROM users WHERE id=$1", [uid]);
    if (!u || u.status !== "active") return { awarded: false, reason: "inactive" };
    const t = Date.parse(nowIso());
    if (t - Date.parse(u.created_at) < S.minAccountDays * DAY) return { awarded: false, reason: "account_too_new" };
    if ((o.flagged || (await flagged())).has(uid)) return { awarded: false, reason: "integrity_flagged" };
    if (o.counterpart && (await linked(uid, o.counterpart))) return { awarded: false, reason: "linked_accounts" };
    if ((await trustOf(uid)) < S.minTrust) return { awarded: false, reason: "low_trust" };
    const today = dayOf(t);
    const last = await db.get("SELECT MAX(created_at) at FROM points_awards WHERE user_id=$1 AND kind=$2", [uid, kind]);
    if (last?.at && t - Date.parse(last.at) < S.cooldownSec * 1000) return { awarded: false, reason: "cooldown" };
    const kindToday = Number((await db.get("SELECT COUNT(*) n FROM points_awards WHERE user_id=$1 AND kind=$2 AND day=$3 AND points > 0", [uid, kind, today]))?.n || 0);
    if (kindToday >= k.dailyCap) return { awarded: false, reason: "kind_daily_cap" };
    if (o.counterpart) {
      const pair = Number((await db.get("SELECT COUNT(*) n FROM points_awards WHERE user_id=$1 AND reason=$2 AND created_at > $3", [uid, "with:" + o.counterpart, new Date(t - 7 * DAY).toISOString()]))?.n || 0);
      if (pair >= S.pairWeeklyCap) return { awarded: false, reason: "pair_weekly_cap" };
    }
    // seasonal campaign: best active campaign for this kind
    const camps = (await db.all("SELECT * FROM points_campaigns WHERE status='active' AND starts_at <= $1 AND ends_at > $1", [nowIso()])).filter((c) => { const ks = parse(c.kinds, []); return !ks.length || ks.includes(kind); });
    let pts = k.points, campaign = null;
    for (const c of camps) { const p = Math.round(k.points * Number(c.multiplier || 1)) + Number(c.bonus || 0); if (p > pts) { pts = p; campaign = c.id; } }
    const usedToday = Number((await db.get("SELECT COALESCE(SUM(points),0) n FROM points_awards WHERE user_id=$1 AND day=$2 AND points > 0 AND kind<>'adjustment'", [uid, today]))?.n || 0);
    pts = Math.min(pts, Math.max(0, S.dailyCap - usedToday));
    if (pts <= 0) return { awarded: false, reason: "daily_cap" };
    const redeemable = (await isMinor(uid)) ? 0 : 1;
    const aid = id("pa"), at = nowIso();
    const r = await db.run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,campaign_id,day,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10) ON CONFLICT DO NOTHING",
      [aid, uid, kind, String(sourceId).slice(0, 120), pts, redeemable, campaign, today, o.counterpart ? "with:" + o.counterpart : (o.reason || null), at]);
    if (!r?.changes) return { awarded: false, reason: "duplicate" };
    // v2.47: the same award mints «مجتمع كوين» (MJT) once — capped per day in services/mjt.js; a failure is repaired by its reconcile job
    let mjt = null; try { mjt = (await ctx.services.mjt?.onAward?.({ id: aid, user_id: uid, kind, points: pts, status: "active", created_at: at })) || null; } catch { /* reconcile retries */ }
    const bal = await recompute(uid);
    if (bal.leveledUp) await notify(uid, "points_level_up", { ref: String(bal.level + 1) });
    ctx.realtime?.send?.(uid, "points", { kind, points: pts, total: bal.total });
    return { awarded: true, points: pts, redeemable: !!redeemable, campaign, mjt: mjt ? { minted: !!mjt.minted, reason: mjt.reason || null } : null };
  }
  async function reverseSource(sourceId, why) {
    const rows = await db.all("SELECT id, user_id FROM points_awards WHERE source_id=$1 AND status='active'", [String(sourceId)]);
    for (const r of rows) { await db.run("UPDATE points_awards SET status='reversed', reason=$1 WHERE id=$2", [why, r.id]); await recompute(r.user_id); try { await ctx.services.mjt?.onAwardReversed?.(r.id); } catch { /* reconcile retries */ } }
    return rows.length;
  }
  bus.on("CONTENT_REMOVED", (e) => { if (e?.post) reverseSource(e.post, "content_removed").catch(() => { }); });

  /* ---------- the scan: find quality contributions that happened ---------- */
  let scanning = null;
  const scan = () => (scanning ||= (async () => {
    const S = await settings(), t = Date.parse(nowIso()), out = { answer_accepted: 0, engaged_post: 0, report_confirmed: 0, wiki_edit: 0, mentoring: 0, skipped: {} };
    const fl = await flagged();
    const note = (k, r) => { if (r.awarded) out[k]++; else if (r.reason !== "duplicate") out.skipped[r.reason] = (out.skipped[r.reason] || 0) + 1; };
    const ageAt = (u, at) => (Date.parse(at) - Date.parse(u)) / DAY;
    // 1. accepted answers (+ mentoring when the asker was a newcomer)
    for (const q of await db.all("SELECT p.id, p.author, p.data, p.created_at, u.created_at ucreated FROM posts p JOIN users u ON u.id=p.author WHERE p.type='question' AND p.status='published' AND p.created_at > $1", [new Date(t - 90 * DAY).toISOString()])) {
      const acc = parse(q.data, {})?.acceptedAnswer; if (!acc) continue;
      const c = await db.get("SELECT id, author, status FROM comments WHERE id=$1 AND post=$2", [acc, q.id]);
      if (!c || c.status !== "published" || c.author === q.author) continue;
      note("answer_accepted", await award(c.author, "answer_accepted", c.id, { counterpart: q.author, flagged: fl }));
      if (ageAt(q.ucreated, q.created_at) < S.newcomerDays) note("mentoring", await award(c.author, "mentoring", "q:" + c.id, { counterpart: q.author, flagged: fl }));
    }
    // 2. posts with meaningful engagement from distinct, trusted, unlinked, non-flagged accounts
    const since = new Date(t - 14 * DAY).toISOString(), settled = new Date(t - 3600e3).toISOString(), engAge = new Date(t - S.engagerMinAgeDays * DAY).toISOString();
    const cands = await db.all(`SELECT p.id, p.author FROM posts p WHERE p.status='published' AND p.type<>'question' AND p.created_at > $1 AND p.created_at < $2 AND p.repost_of IS NULL AND
      (SELECT COUNT(DISTINCT x.u) FROM (SELECT r.user_id u FROM reactions r WHERE r.target=p.id AND r.type IN ('useful','insightful','support','like') UNION SELECT c.author u FROM comments c WHERE c.post=p.id AND c.status='published') x WHERE x.u<>p.author) >= $3 LIMIT 500`, [since, settled, S.engagementMin]);
    for (const p of cands) {
      if (await db.get("SELECT 1 x FROM points_awards WHERE user_id=$1 AND kind='engaged_post' AND source_id=$2", [p.author, p.id])) continue;
      const people = await db.all(`SELECT DISTINCT x.u, us.created_at FROM (SELECT r.user_id u FROM reactions r WHERE r.target=$1 AND r.type IN ('useful','insightful','support','like') UNION SELECT c.author u FROM comments c WHERE c.post=$1 AND c.status='published' AND LENGTH(c.text) >= 10) x JOIN users us ON us.id=x.u WHERE x.u<>$2 AND us.status='active' AND us.created_at < $3`, [p.id, p.author, engAge]);
      let n = 0; for (const e of people) if (!fl.has(e.u) && !(await linked(p.author, e.u))) n++;
      if (n >= S.engagementMin) note("engaged_post", await award(p.author, "engaged_post", p.id, { flagged: fl, reason: `engagers:${n}` }));
    }
    // 3. reports that staff / moderators actioned
    for (const r of await db.all("SELECT id, by_user FROM reports WHERE status='actioned' AND resolved_at > $1", [new Date(t - 30 * DAY).toISOString()])) note("report_confirmed", await award(r.by_user, "report_confirmed", r.id, { flagged: fl }));
    // 4. substantial wiki edits (one award per page per day)
    for (const w of await db.all("SELECT r.id, r.page, r.version, r.body, r.author, r.created_at FROM wiki_revisions r JOIN wiki_pages p ON p.id=r.page WHERE r.created_at > $1 ORDER BY r.created_at", [since])) {
      const prev = w.version > 1 ? await db.get("SELECT body FROM wiki_revisions WHERE page=$1 AND version < $2 ORDER BY version DESC LIMIT 1", [w.page, w.version]) : null;
      const delta = Math.abs(String(w.body || "").length - String(prev?.body || "").length);
      const changed = prev ? delta >= S.wikiMinChars || (String(w.body) !== String(prev.body) && String(w.body).length >= S.wikiMinChars && delta >= S.wikiMinChars / 2) : String(w.body || "").length >= S.wikiMinChars;
      if (changed) note("wiki_edit", await award(w.author, "wiki_edit", `${w.page}:${dayOf(w.created_at)}`, { flagged: fl }));
    }
    // 5. mentoring: a member referred by an ambassador who is still active and contributing after 7 days
    for (const r of await db.all("SELECT a.user_id, a.ambassador_id FROM ambassador_referrals a JOIN users u ON u.id=a.user_id WHERE u.status='active' AND a.created_at < $1 AND a.created_at > $2", [new Date(t - 7 * DAY).toISOString(), new Date(t - 60 * DAY).toISOString()])) {
      const active = await db.get("SELECT 1 x FROM posts WHERE author=$1 AND status='published' UNION SELECT 1 x FROM comments WHERE author=$1 AND status='published' LIMIT 1", [r.user_id]);
      if (active) note("mentoring", await award(r.ambassador_id, "mentoring", "ref:" + r.user_id, { counterpart: r.user_id, flagged: fl }));
    }
    return out;
  })().finally(() => { scanning = null; }));

  /* ---------- reads ---------- */
  const awardClient = (a) => ({ id: a.id, kind: a.kind, label: KIND_INFO[a.kind] || a.kind, points: Number(a.points), redeemable: !!Number(a.redeemable), status: a.status, campaignId: a.campaign_id || null, createdAt: a.created_at });
  async function mine(user) {
    const b = (await db.get("SELECT * FROM points_balances WHERE user_id=$1", [user.id])) || { total: 0, redeemable: 0, redeemed: 0, optout: 0 };
    const minor = await isMinor(user.id);
    const rank = Number(b.optout) || minor ? null : Number((await db.get("SELECT COUNT(*) n FROM points_balances WHERE total > $1 AND optout=0", [Number(b.total)]))?.n || 0) + 1;
    return { total: Number(b.total), redeemable: minor ? 0 : Number(b.redeemable), redeemed: Number(b.redeemed), level: levelInfo(Number(b.total)), optOut: !!Number(b.optout), rank, minor, redemption: await redemptionState(user) };
  }
  async function history(user, q = {}) {
    const lim = int(q.limit, 30, 1, 100), args = [user.id]; let w = "";
    if (q.cursor) { args.push(String(q.cursor)); w = ` AND created_at < $${args.length}`; }
    const rows = await db.all(`SELECT * FROM points_awards WHERE user_id=$1${w} ORDER BY created_at DESC LIMIT ${lim + 1}`, args);
    const reds = q.cursor ? [] : await db.all("SELECT * FROM points_redemptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [user.id]);
    return { items: rows.slice(0, lim).map(awardClient), next: rows.length > lim ? rows[lim - 1].created_at : null, redemptions: reds.map(redClient) };
  }
  async function leaderboard(user, q = {}) {
    const period = String(q.period || "all");
    let rows;
    if (period === "all") rows = await db.all("SELECT b.user_id, b.total pts FROM points_balances b JOIN users u ON u.id=b.user_id WHERE b.optout=0 AND u.status='active' AND b.total > 0 ORDER BY b.total DESC, b.updated_at LIMIT 200");
    else if (period === "month") rows = await db.all("SELECT a.user_id, SUM(a.points) pts FROM points_awards a JOIN users u ON u.id=a.user_id LEFT JOIN points_balances b ON b.user_id=a.user_id WHERE a.status='active' AND a.day >= $1 AND COALESCE(b.optout,0)=0 AND u.status='active' GROUP BY a.user_id HAVING SUM(a.points) > 0 ORDER BY pts DESC LIMIT 200", [monthOf(nowIso()) + "-01"]);
    else if (period.startsWith("campaign:")) rows = await db.all("SELECT a.user_id, SUM(a.points) pts FROM points_awards a JOIN users u ON u.id=a.user_id LEFT JOIN points_balances b ON b.user_id=a.user_id WHERE a.status='active' AND a.campaign_id=$1 AND COALESCE(b.optout,0)=0 AND u.status='active' GROUP BY a.user_id ORDER BY pts DESC LIMIT 200", [period.slice(9, 80)]);
    else throw E.bad("فترة غير صالحة");
    const hidden = await minors(rows.map((r) => r.user_id));
    rows = rows.filter((r) => !hidden.has(r.user_id)).slice(0, int(q.limit, 50, 1, 100));
    const users = new Map();
    for (const r of rows) users.set(r.user_id, await db.get("SELECT handle, name, avatar, color FROM users WHERE id=$1", [r.user_id]));
    const items = rows.map((r, i) => { const u = users.get(r.user_id) || {}; return { rank: i + 1, handle: u.handle, name: u.name, avatar: u.avatar || null, color: u.color || null, points: Number(r.pts), level: period === "all" ? levelInfo(Number(r.pts)).level : undefined, me: user?.id === r.user_id }; });
    return { period, items, note: "يظهر هنا من لم يُخفِ نفسه من لوحة الصدارة؛ حسابات القاصرين لا تظهر." };
  }
  async function setOptOut(user, on) {
    await db.run("INSERT INTO points_balances(user_id,total,redeemable,redeemed,level,optout,updated_at) VALUES($1,0,0,0,0,$2,$3) ON CONFLICT (user_id) DO UPDATE SET optout=$2, updated_at=$3", [user.id, on ? 1 : 0, nowIso()]);
    return { optOut: !!on };
  }
  const campClient = (c) => ({ id: c.id, name: c.name, description: c.description || "", kinds: parse(c.kinds, []), multiplier: Number(c.multiplier), bonus: Number(c.bonus), startsAt: c.starts_at, endsAt: c.ends_at, status: c.status, live: c.status === "active" && c.starts_at <= nowIso() && c.ends_at > nowIso() });
  async function campaigns(all) { return { items: (await db.all(`SELECT * FROM points_campaigns ${all ? "" : "WHERE status='active' AND ends_at > $1"} ORDER BY starts_at DESC LIMIT 100`, all ? [] : [nowIso()])).map(campClient) }; }
  async function saveCampaign(user, cid, b = {}) {
    const prev = cid ? await db.get("SELECT * FROM points_campaigns WHERE id=$1", [cid]) : null; if (cid && !prev) throw E.nf();
    const name = b.name !== undefined ? str(b.name, 100, { required: true, min: 2 }) : prev?.name; if (!name) throw E.bad("اسم الحملة مطلوب");
    const kinds = b.kinds !== undefined ? (Array.isArray(b.kinds) ? b.kinds.filter((k) => EARN_KINDS.includes(k)) : null) : parse(prev?.kinds, []); if (!kinds) throw E.bad();
    const multiplier = b.multiplier !== undefined ? Number(b.multiplier) : Number(prev?.multiplier ?? 1); if (!(multiplier >= 1 && multiplier <= 5)) throw E.bad("المضاعف بين 1 و5");
    const bonus = b.bonus !== undefined ? int(b.bonus, 0, 0, 500) : Number(prev?.bonus || 0);
    const starts = b.startsAt !== undefined ? new Date(b.startsAt) : new Date(prev?.starts_at || nowIso()), ends = b.endsAt !== undefined ? new Date(b.endsAt) : new Date(prev?.ends_at || 0);
    if (!(starts.getTime() > 0) || !(ends.getTime() > starts.getTime())) throw E.bad("تاريخ النهاية يجب أن يكون بعد البداية");
    if (ends - starts > 180 * DAY) throw E.bad("مدة الحملة ستة أشهر كحد أقصى");
    const status = b.status !== undefined ? (["active", "ended"].includes(b.status) ? b.status : null) : prev?.status || "active"; if (!status) throw E.bad();
    const v = [name, str(b.description, 500) ?? prev?.description ?? null, JSON.stringify(kinds), multiplier, bonus, starts.toISOString(), ends.toISOString(), status];
    if (prev) await db.run("UPDATE points_campaigns SET name=$1, description=$2, kinds=$3, multiplier=$4, bonus=$5, starts_at=$6, ends_at=$7, status=$8 WHERE id=$9", [...v, prev.id]);
    else { cid = id("pc"); await db.run("INSERT INTO points_campaigns(id,name,description,kinds,multiplier,bonus,starts_at,ends_at,status,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [cid, ...v, user.id, nowIso()]); }
    ctx.audit?.("points_campaign_saved", user.id, null, cid);
    return { campaign: campClient(await db.get("SELECT * FROM points_campaigns WHERE id=$1", [cid])) };
  }

  /* ---------- redemption into Pi rewards (platform-funded pool) ---------- */
  const redClient = (r) => ({ id: r.id, points: Number(r.points), amount: pi(r.amount), rate: Number(r.rate), month: r.month, status: r.status, txid: r.txid || null, note: r.note || null, createdAt: r.created_at, decidedAt: r.decided_at || null });
  async function pool() {
    const S = await settings(), month = monthOf(nowIso());
    const used = Number((await db.get("SELECT COALESCE(SUM(amount),0) s FROM points_redemptions WHERE month=$1 AND status IN ('pending','paid')", [month]))?.s || 0);
    const bal = await balance(db, ACC.rewardsPool), cap = toUnits(S.redemption.monthlyCap || 0);
    return { month, poolBalance: pi(bal), monthlyCap: pi(cap), usedThisMonth: pi(used), leftThisMonth: pi(Math.max(0, Math.min(cap - used, bal))), rate: S.redemption.rate, piEnabled: piOn(), enabled: piOn() && !!S.redemption.enabled && S.redemption.rate > 0 && cap > 0 && bal > 0 };
  }
  async function redemptionState(user) {
    const S = await settings(), p = await pool();
    if (ctx.services.mjt?.linked?.()) return { available: false, reason: "mjt", note: "نقاط المساهمة تتحوّل الآن إلى «مجتمع كوين» (MJT) داخل التطبيق، لذلك توقّف استبدالها بمكافآت Pi.", rate: null, minPoints: S.redemption.minPoints, leftThisMonth: 0, minor: user ? await isMinor(user.id) : false };
    const why = !p.piEnabled ? "pi_off" : !S.redemption.enabled ? "disabled" : !(S.redemption.rate > 0) || !(p.monthlyCap > 0) ? "not_configured" : !(p.poolBalance > 0) ? "pool_empty" : null;
    return { available: !why, reason: why, note: why === "pi_off" ? "الاستبدال بمكافآت Pi يعمل بعد تفعيل مدفوعات Pi" : why ? "الاستبدال غير متاح حالياً" : null, rate: S.redemption.rate || null, minPoints: S.redemption.minPoints, leftThisMonth: p.leftThisMonth, minor: user ? await isMinor(user.id) : false };
  }
  async function redeem(user, b = {}) {
    if (!rl.hit("tip", "redeem:" + user.id)) throw E.rate();
    const S = await settings(), st = await redemptionState(user);
    if (st.reason === "mjt") throw fail(409, "redemption_retired", st.note);
    if (st.reason === "pi_off") throw E.off(st.note);
    if (!st.available) throw fail(409, "redemption_unavailable", st.note);
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "نقاط من هم دون ١٨ سنة لا تُستبدل");
    const u = await db.get("SELECT pi_uid FROM users WHERE id=$1", [user.id]);
    if (!u?.pi_uid) throw fail(409, "pi_not_linked", "اربط حساب Pi أولاً لاستلام المكافأة");
    const points = int(b.points, 0, 0, 1e9);
    if (points < S.redemption.minPoints) throw fail(400, "below_minimum", `الحد الأدنى للاستبدال ${S.redemption.minPoints} نقطة`);
    const month = monthOf(nowIso());
    const mineMonth = Number((await db.get("SELECT COUNT(*) n FROM points_redemptions WHERE user_id=$1 AND month=$2 AND status IN ('pending','paid')", [user.id, month]))?.n || 0);
    if (mineMonth >= S.redemption.perUserMonthly) throw fail(429, "monthly_limit", "وصلت إلى حد الاستبدال لهذا الشهر");
    const amount = Math.floor((points * U) / S.redemption.rate);
    if (!(amount > 0)) throw E.bad("عدد النقاط قليل جداً");
    const rid = id("pr");
    await db.tx(async (tx) => {
      const bal = await recompute(user.id, tx);
      if (points > bal.redeemable) throw fail(409, "insufficient_points", "نقاطك القابلة للاستبدال أقل من ذلك");
      const used = Number((await tx.get("SELECT COALESCE(SUM(amount),0) s FROM points_redemptions WHERE month=$1 AND status IN ('pending','paid')", [month]))?.s || 0);
      const cap = toUnits(S.redemption.monthlyCap), poolBal = await balance(tx, ACC.rewardsPool);
      if (used + amount > cap) throw fail(409, "monthly_pool_cap", "اكتمل سقف مكافآت هذا الشهر");
      if (amount > poolBal) throw fail(409, "pool_empty", "رصيد صندوق المكافآت لا يكفي");
      await tx.run("INSERT INTO points_redemptions(id,user_id,points,amount,rate,month,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)", [rid, user.id, points, amount, S.redemption.rate, month, nowIso()]);
      await postJournal(tx, { ikey: "redeem:" + rid, kind: "rewards_redeem", source: "rewards", refId: rid, creatorId: user.id, memo: `${points} نقطة`, lines: REWARDS.reserve(amount, user.id) });
      await recompute(user.id, tx);
    });
    ctx.audit?.("points_redeem_requested", user.id, String(points), rid);
    return { redemption: redClient(await db.get("SELECT * FROM points_redemptions WHERE id=$1", [rid])), note: "سيُرسل الفريق المكافأة إلى محفظة Pi المرتبطة بحسابك ويسجّل رقم المعاملة." };
  }
  async function fundPool(user, b = {}) {
    if (!piOn()) throw E.off("تمويل صندوق المكافآت متاح بعد تفعيل مدفوعات Pi");
    const amount = toUnits(Number(b.amount)); if (!(amount > 0) || amount > toUnits(1e6)) throw E.bad("مبلغ غير صالح");
    const fid = id("pf");
    await db.tx(async (tx) => { await postJournal(tx, { ikey: "fund:" + fid, kind: "rewards_fund", source: "rewards", refId: fid, piTx: str(b.txid, 200) || null, memo: str(b.note, 300) || "تمويل صندوق المكافآت", lines: REWARDS.fund(amount) }); });
    ctx.audit?.("points_pool_funded", user.id, String(pi(amount)), fid);
    return { ok: true, id: fid, pool: await pool() };
  }
  async function decide(user, rid, action, b = {}) {
    const r = await db.get("SELECT * FROM points_redemptions WHERE id=$1", [String(rid).slice(0, 64)]); if (!r) throw E.nf();
    if (r.status !== "pending") throw fail(409, "already_decided", "تم البت في الطلب");
    if (action === "pay") {
      const txid = str(b.txid, 200, { required: true });
      await db.tx(async (tx) => {
        await tx.run("UPDATE points_redemptions SET status='paid', txid=$1, note=$2, decided_by=$3, decided_at=$4 WHERE id=$5", [txid, str(b.note, 300) || null, user.id, nowIso(), r.id]);
        await postJournal(tx, { ikey: "rpay:" + r.id, kind: "rewards_payout", source: "rewards", refId: "rpay:" + r.id, creatorId: r.user_id, piTx: txid, memo: "مكافأة نقاط المساهمة", lines: REWARDS.payout(Number(r.amount), r.user_id) });
      });
    } else {
      await db.tx(async (tx) => {
        await tx.run("UPDATE points_redemptions SET status='rejected', note=$1, decided_by=$2, decided_at=$3 WHERE id=$4", [str(b.note, 300) || null, user.id, nowIso(), r.id]);
        await reverseAll(tx, r.id, "رفض استبدال النقاط");
        await recompute(r.user_id, tx);
      });
    }
    ctx.audit?.("points_redeem_" + action, user.id, b.txid || b.note || null, r.id);
    await notify(r.user_id, "points_redemption", { ref: r.id });
    return { redemption: redClient(await db.get("SELECT * FROM points_redemptions WHERE id=$1", [r.id])), pool: await pool() };
  }
  async function adjust(user, b = {}) {
    const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1)", [String(b.handle || "").replace(/^@/, "").slice(0, 40)]); if (!u) throw E.nf("الحساب غير موجود");
    const points = int(b.points, 0, -100000, 100000); if (!points) throw E.bad("عدد نقاط غير صالح");
    const reason = str(b.reason, 300, { required: true, min: 3 });
    // admin adjustments never become redeemable Pi (no money from thin air)
    await db.run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,day,reason,created_at) VALUES($1,$2,'adjustment',$3,$4,0,'active',$5,$6,$7)", [id("pa"), u.id, id("adj"), points, dayOf(nowIso()), reason, nowIso()]);
    ctx.audit?.("points_adjusted", user.id, `${points}: ${reason}`, u.id);
    return { balance: await recompute(u.id) };
  }
  async function adminOverview() {
    const S = await settings();
    const by = await db.all("SELECT kind, COUNT(*) n, COALESCE(SUM(points),0) p FROM points_awards WHERE status='active' AND day >= $1 GROUP BY kind", [dayOf(Date.parse(nowIso()) - 30 * DAY)]);
    const top = await db.all("SELECT a.user_id, u.handle, COUNT(*) n, SUM(a.points) p FROM points_awards a JOIN users u ON u.id=a.user_id WHERE a.status='active' AND a.day=$1 GROUP BY a.user_id, u.handle ORDER BY p DESC LIMIT 10", [dayOf(nowIso())]);
    return { settings: S, kinds: EARN_KINDS.map((k) => ({ key: k, label: KIND_INFO[k] })), levels: LEVELS.map(([at, name], i) => ({ level: i + 1, name, at })), last30d: by.map((r) => ({ kind: r.kind, label: KIND_INFO[r.kind] || r.kind, awards: Number(r.n), points: Number(r.p) })),
      topToday: top.map((r) => ({ handle: r.handle, awards: Number(r.n), points: Number(r.p), atCap: Number(r.p) >= S.dailyCap })), pool: await pool(),
      pending: (await db.all("SELECT r.*, u.handle FROM points_redemptions r JOIN users u ON u.id=r.user_id WHERE r.status='pending' ORDER BY r.created_at LIMIT 100")).map((r) => ({ ...redClient(r), handle: r.handle })) };
  }

  /* ---------- routes ---------- */
  R.get("/api/points/config", async (req) => ({ kinds: EARN_KINDS.map((k) => ({ key: k, label: KIND_INFO[k] })), rules: await (async () => { const S = await settings(); return { kinds: S.kinds, dailyCap: S.dailyCap }; })(), levels: LEVELS.map(([at, name], i) => ({ level: i + 1, name, at })), redemption: await redemptionState(req.user) }));
  R.get("/api/points/me", A(async (req) => mine(req.user)));
  R.get("/api/points/history", A(async (req) => history(req.user, req.query)));
  R.put("/api/points/leaderboard-optout", A(async (req) => setOptOut(req.user, !!req.body?.optOut)));
  R.get("/api/points/leaderboard", async (req) => leaderboard(req.user, req.query));
  R.get("/api/points/campaigns", async () => campaigns(false));
  R.post("/api/points/redeem", A(async (req) => redeem(req.user, req.body)));
  R.get("/api/admin/points", staff(async () => adminOverview()));
  R.put("/api/admin/points/settings", admin(async (req) => saveSettings(req.user, req.body)));
  R.post("/api/admin/points/scan", admin(async () => scan()));
  R.post("/api/admin/points/adjust", admin(async (req) => adjust(req.user, req.body)));
  R.post("/api/admin/points/awards/:id/reverse", admin(async (req) => { const a = await db.get("SELECT * FROM points_awards WHERE id=$1 AND status='active'", [req.params.id]); if (!a) throw E.nf(); await db.run("UPDATE points_awards SET status='reversed', reason=$1 WHERE id=$2", ["admin:" + (str(req.body?.reason, 200) || ""), a.id]); ctx.audit?.("points_award_reversed", req.user.id, null, a.id); try { await ctx.services.mjt?.onAwardReversed?.(a.id); } catch { /* reconcile retries */ } return { balance: await recompute(a.user_id) }; }));
  R.get("/api/admin/points/campaigns", staff(async () => campaigns(true)));
  R.post("/api/admin/points/campaigns", admin(async (req) => saveCampaign(req.user, null, req.body)));
  R.put("/api/admin/points/campaigns/:id", admin(async (req) => saveCampaign(req.user, req.params.id, req.body)));
  R.get("/api/admin/points/pool", admin(async () => pool()));
  R.post("/api/admin/points/pool/fund", admin(async (req) => fundPool(req.user, req.body)));
  R.post("/api/admin/points/redemptions/:id/pay", admin(async (req) => decide(req.user, req.params.id, "pay", req.body)));
  R.post("/api/admin/points/redemptions/:id/reject", admin(async (req) => decide(req.user, req.params.id, "reject", req.body)));

  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("points.scan", +(env.POINTS_SCAN_INTERVAL_MS || 15 * 60e3), () => scan());
  return { scan, award, recompute, settings, pool, leaderboard, levelInfo, reverseSource, KIND_INFO, LEVELS };
};
