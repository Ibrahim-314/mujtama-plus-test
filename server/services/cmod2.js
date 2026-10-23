/* Community moderation v2 + automod v2 (v2.59.0, «المجتمع 3.0» stage 4). Builds on services/cmod.js (queue, act,
 * discipline, log) — nothing there is replaced:
 *  • queue v2: filters/sort, claims («سأتولاها», 15 min, renewable), assignment to another moderator, bulk decisions;
 *  • macros («قوالب»): saved action + reason (+ penalty, + member-facing message);
 *  • appeals: a member appeals a ban, mute, warning or removed post; a HIGHER rank (never the moderator who decided,
 *    unless the owner) accepts → the penalty is lifted and the member's previous role comes back;
 *  • moderator notification preferences (digest 6 h | daily | off, instant appeal / assignment alerts);
 *  • automod v2 (lib/automod-rules.js): all rules OFF by default; «جرّب القاعدة» tester (nothing stored), stats,
 *    presets, penalty ladder (OFF by default), duplicate fingerprints (written only while that rule is on). */
const { E, str, oneOf, id, now } = require("../lib/core");
const AR = require("../lib/automod-rules");
const Tox = require("../lib/toxicity");
const C = require("../lib/ar-classify");
const KINDS = ["post", "comment", "report", "join"];
const CLAIM_MS = 15 * 60e3, ASSIGN_MS = 24 * 3600e3, DAY = 864e5;
const MACRO_ACTIONS = ["none", "approve", "reject", "remove", "dismiss"], PENALTIES = ["none", "warn", "mute", "ban"];
const PREF_DEF = { digest: "6h", appeals: true, assigned: true };
const since = (ms) => new Date(Date.now() - ms).toISOString();
const jp = (v) => { if (typeof v !== "string") return v ?? null; try { return JSON.parse(v); } catch { return null; } };

module.exports = (ctx) => {
  const { db, router: R } = ctx; const A = ctx.requireUser; const P = ctx.cperm;
  const cmod = () => ctx.services.cmod;
  const notify = (u, k, o) => ctx.services.messaging?.notify?.(u, k, o)?.catch?.(() => { });
  const needMod = async (cid, uid, key = "queue_review") => P.need(cid, uid, key, "للمشرفين فقط");
  const getC = async (cid) => { const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf(); return c; };
  const cfg = (c) => c?.settings?.automod || {};

  /* ======================= automod v2 ======================= */
  async function evalV2(community, user, text, kind = "post") {
    const v2 = cfg(community).v2; if (!AR.anyOn(v2)) return null;
    if (kind === "comment" && !v2.comments?.enabled) return null;
    const c = {};
    if (v2.duplicate?.enabled) { const fp = AR.fingerprint(text); if (fp) c.duplicate = !!(await db.get("SELECT 1 x FROM content_fingerprints WHERE community=$1 AND user_id=$2 AND fp=$3 AND created_at > $4 LIMIT 1", [community.id, user.id, fp, since(v2.duplicate.windowMin * 60e3)])); }
    if (v2.newMember?.enabled && kind === "post") c.memberPosts = Number((await db.get("SELECT COUNT(*) n FROM posts WHERE community=$1 AND author=$2 AND status='published'", [community.id, user.id]))?.n || 0);
    const r = AR.evaluate(v2, { text, kind, ctx: c });
    return r.action ? r : null;
  }
  /** the community row when its automod v2 applies to comments, else null (one read per comment, nothing more) */
  /* v2.62 T5: also when the guard covers comments (guard.comments), independent of «التعليقات». evalV2 still gates the v2
   * rules on v2.comments.enabled, so a guard-only community runs the guard and nothing else on comments. */
  async function commentRulesOn(cid) { const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) return null; const v2 = cfg(c).v2; return (v2?.comments?.enabled && AR.anyOn(v2)) || AR.guardApplies(guardOf(c), "comment") ? c : null; }
  /** v2.61 parity: the post-insert v2 bookkeeping (fingerprints, report-only, ladder) runs on comments only when «التعليقات» is on */
  const commentV2On = (c) => { const v2 = cfg(c).v2; return !!(v2?.comments?.enabled && AR.anyOn(v2)); };
  /** after the insert: fingerprints (duplicate rule on), report-only rules, comment queue log, penalty ladder */
  async function afterPost(community, user, kind, tid, text, verdict, status) {
    const v2 = cfg(community).v2;
    if (v2?.duplicate?.enabled) { const fp = AR.fingerprint(text); if (fp) await db.run("INSERT INTO content_fingerprints(id,community,user_id,fp,kind,created_at) VALUES($1,$2,$3,$4,$5,$6)", [id("fp"), community.id, user.id, fp, kind, now()]); }
    if (!verdict) return;
    if (verdict.action === "report") {
      if (!(await db.get("SELECT 1 x FROM reports WHERE target=$1 AND by_user='system' AND status='open'", [tid]))) await db.run("INSERT INTO reports(id,target,kind,reason,by_user,status,created_at) VALUES($1,$2,$3,$4,'system','open',$5)", [id("rp"), tid, kind, ("قواعد المجتمع الآلية: " + verdict.reasons.join("، ")).slice(0, 200), now()]);
      await cmod().log(community.id, "system", { post: tid, user: user.id, action: "automod_flag", reason: verdict.reasons.join("، "), meta: { rules: verdict.rules || [], kind } });
    } else if (kind === "comment" && verdict.action === "queue" && status === "pending") {
      await cmod().log(community.id, "system", { post: tid, user: user.id, action: "automod_queue", reason: verdict.reasons.join("، "), meta: { rules: verdict.rules || [], kind: "comment" } });
    }
    if (verdict.action !== "reject") await ladder(community, user.id);
  }
  /** penalty ladder (OFF by default): the N-th automod hit inside the window applies that step's penalty once */
  async function ladder(community, uid) {
    const L = cfg(community).ladder; if (!L?.enabled || !L.steps?.length) return null;
    const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [community.id, uid]);
    if (!m || ["owner", "admin", "moderator", "banned"].includes(m.role)) return null;
    const n = Number((await db.get("SELECT COUNT(*) n FROM mod_actions WHERE community=$1 AND target_user=$2 AND action IN ('automod_queue','automod_reject','automod_flag') AND created_at > $3", [community.id, uid, since(L.windowDays * DAY)]))?.n || 0);
    const step = L.steps.find(s => s.at === n); if (!step) return null;
    if (step.action === "mute" && m.role === "muted") return null;
    const reason = `سُلَّم العقوبات الآلي: ${n} مخالفات آلية خلال ${L.windowDays} يوماً`;
    await ctx.services.communities.sanction("system", community.id, uid, step.action, { hours: step.hours, reason });
    if (step.action === "warn") await notify(uid, "mod_warning", { ref: community.id });
    await cmod().log(community.id, "system", { user: uid, action: "automod_penalty", reason, meta: { step: step.action, hours: step.hours || null, count: n } });
    return step;
  }
  /* ======================= v2.62 «الحارس التلقائي» ======================= */
  const STAFF = ["owner", "admin", "moderator"];
  const guardOf = (community) => { const g = cfg(community).guard; return g && typeof g === "object" ? AR.parseGuard(g) : null; };
  /* T7 notify ref "cid~n~max~hours" (notify-lib guardRef when present) */
  const guardRef = (cid, s) => { try { const L = require("../lib/notify-lib"); if (typeof L.guardRef === "function") return L.guardRef(cid, s); } catch { /* optional */ } return [cid, s.n, s.max, s.hours].join("~"); };
  /** active guard strikes of a member: unlifted autoguard warns inside the decay window (decayDays 0 = never decay) */
  async function guardCount(cid, uid, g) {
    const days = Number(g?.decayDays) || 0, args = [cid, uid];
    const q = "SELECT COUNT(*) n FROM community_sanctions WHERE community=$1 AND user_id=$2 AND kind='warn' AND rule_id='autoguard' AND lifted_at IS NULL" + (days > 0 ? " AND created_at > $3" : "");
    if (days > 0) args.push(since(days * DAY));
    return Number((await db.get(q, args))?.n || 0);
  }
  /** one strike: warn (+ timed mute) or, at maxStrikes with fullLock, an indefinite mute. Staff are exempt. The
   * rejected text is never stored; the log keeps only the masked words in `reason` and the patterns in staff meta. */
  async function guardStrike(community, uid, hits = [], kind = "post") {
    const g = guardOf(community); if (!g) return null;
    const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [community.id, uid]);
    if (m && STAFF.includes(m.role)) return null;
    const masked = [...new Set((hits || []).map(AR.maskWord).filter(Boolean))].slice(0, 5);
    if (!m || m.role === "banned" || m.role === "pending") { const st = AR.guardStep(1, g); return { n: 0, max: st.max, hours: 0, locked: false, mutedUntil: null, words: masked, message: "لم يُنشر نصك لأنه يحتوي عبارة ممنوعة في هذا المجتمع." }; }
    const n = (await guardCount(community.id, uid, g)) + 1, st = AR.guardStep(n, g);
    const reason = "الحارس التلقائي: عبارة ممنوعة" + (masked.length ? " (" + masked.join("، ") + ")" : "");
    const S = ctx.services.communities;
    await S.sanction("system", community.id, uid, "warn", { reason, ruleId: "autoguard" });
    if (st.locked) await S.sanction("system", community.id, uid, "mute", { indefinite: true, reason, ruleId: "autoguard_lock" });
    else if (st.hours > 0) await S.sanction("system", community.id, uid, "mute", { hours: st.hours, reason, ruleId: "autoguard" });
    const mutedUntil = st.locked ? null : (await db.get("SELECT muted_until FROM memberships WHERE community=$1 AND user_id=$2", [community.id, uid]))?.muted_until || null;
    await cmod().log(community.id, "system", { user: uid, action: st.locked ? "autoguard_lock" : "autoguard_strike", reason, meta: { n: st.n, max: st.max, hours: st.hours, locked: st.locked, kind, rules: ["guard"], words: (hits || []).slice(0, 10) } });
    if (st.locked) await notify(uid, "autoguard_lock", { ref: community.id });
    else await notify(uid, "autoguard_strike", { ref: guardRef(community.id, { n: st.n, max: st.max, hours: st.hours }) });
    return { n: st.n, max: st.max, hours: st.hours, locked: st.locked, mutedUntil, words: masked, message: st.message };
  }
  /** runs first in cmod.automod: null when the guard is off / not for this kind / no hit (no DB read then) */
  async function guardCheck(community, user, text, kind = "post") {
    const g = guardOf(community); if (!AR.guardApplies(g, kind)) return null;
    const r = AR.matchGuard(text, g); if (!r.hit) return null;
    const s = await guardStrike(community, user.id, r.words, kind); if (!s) return null;
    return { action: "reject", reasons: ["عبارة ممنوعة"], rules: ["guard"], guard: s, message: s.message };
  }
  /** v2.62 T6: is there an active (unlifted) guard lock on this member? (rule_id autoguard_lock, indefinite mute) */
  async function guardLocked(cid, uid) { return !!(await db.get("SELECT 1 x FROM community_sanctions WHERE community=$1 AND user_id=$2 AND kind='mute' AND rule_id='autoguard_lock' AND lifted_at IS NULL LIMIT 1", [cid, uid])); }
  /** a member's own guard status (T9 banner): counts and times only, never the word / allow lists */
  async function guardState(community, uid) {
    const g = guardOf(community), G = g || AR.parseGuard({}), cid = community.id;
    const m = await db.get("SELECT role, muted_until FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]);
    const base = { enabled: !!(g && g.enabled), max: G.maxStrikes, decayDays: G.decayDays, appealUrl: "#/cappeal/" + cid };
    if (!m || m.role === "pending" || m.role === "banned") return { member: false, ...base, strikes: 0, muted: false, mutedUntil: null, locked: false };
    const exempt = STAFF.includes(m.role);
    const strikes = exempt ? 0 : await guardCount(cid, uid, G);
    const muted = m.role === "muted" && (!m.muted_until || new Date(m.muted_until).getTime() > Date.now());
    const locked = muted && !m.muted_until && (await guardLocked(cid, uid));
    return { member: true, exempt, ...base, strikes: Math.min(strikes, G.maxStrikes), muted, mutedUntil: muted ? m.muted_until || null : null, locked };
  }
  /* the legacy rules, evaluated WITHOUT logging (tester). Mirrors cmod.legacyAutomod exactly; parity asserted in tests. */
  function legacyTest(am, text, accountAgeDays) {
    const c = { words: [], blockLinks: false, newAccountDays: 0, toxicity: "queue", action: "queue", ...(am || {}) }, reasons = []; let hard = false;
    const low = Tox.norm(text);
    const words = (c.words || []).filter(w => w && low.includes(Tox.norm(w))); if (words.length) reasons.push(`كلمات محظورة: ${words.slice(0, 3).join("، ")}`);
    if (c.blockLinks && /https?:\/\/|www\./i.test(text)) reasons.push("يحتوي رابطاً");
    if (c.newAccountDays > 0 && accountAgeDays < c.newAccountDays) reasons.push(`حساب أحدث من ${c.newAccountDays} أيام`);
    if (c.toxicity !== "off") { const t = Tox.score(text); if (t.score >= 0.6) { reasons.push(`محتوى مسيء محتمل (${Math.round(t.score * 100)}٪)`); if (c.toxicity === "reject" && t.score >= 0.8) hard = true; } }
    if (!reasons.length) return null;
    return { action: hard || c.action === "reject" ? "reject" : "queue", reasons };
  }

  R.get("/api/communities/:id/automod/meta", A(async (req) => {
    await needMod(req.params.id, req.user.id, "view_automod");
    return { rules: Object.fromEntries(Object.entries(AR.RULES).map(([k, r]) => [k, { title: r.t, sub: r.sub, defaults: r.def }])), actions: AR.ACTION_AR, categories: Object.fromEntries(AR.CATS.map(k => [k, C.explain([k])[0] || k])), presets: Object.fromEntries(Object.entries(AR.PRESETS).map(([k, p]) => [k, { title: p.t, sub: p.sub, v2: AR.parseV2(p.v2) }])), defaults: { v2: AR.parseV2({}), ladder: AR.parseLadder({}) }, inviteHosts: AR.INVITE_HOSTS, guardDefaults: AR.parseGuard({}), guardPreset: { title: AR.GUARD_PRESET.t, sub: AR.GUARD_PRESET.sub, guard: { ...AR.GUARD_PRESET.guard } }, liftMin: AR.LIFT_MIN };
  }));
  /* «جرّب القاعدة»: the draft configuration (or the saved one) against a sample text; nothing is stored or logged */
  R.post("/api/communities/:id/automod/test", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id, "view_automod");
    if (!ctx.rl.hit("default", "amtest:" + req.user.id)) throw E.rate();
    const c = await getC(cid), b = req.body || {}, text = str(b.text, 5000) || "", kind = oneOf(b.kind, ["post", "comment"], "post");
    /* v2.62 T6: the saved guard is part of the test; a draft that sends guard null/absent keeps the saved one (never dropped silently) */
    const saved = cfg(c), draft = b.config && typeof b.config === "object" ? require("../lib/community-settings").automodOf({ ...saved, ...b.config, v2: b.config.v2 ?? saved.v2, ladder: b.config.ladder ?? saved.ladder, guard: b.config.guard ?? saved.guard }) : { ...saved };
    const age = Math.max(0, Math.min(3650, Number(b.accountAgeDays ?? 365) || 0));
    const legacy = kind === "post" ? legacyTest(draft, text, age) : null;
    const v2 = AR.evaluate(draft.v2 ? AR.parseV2(draft.v2) : null, { text, kind, ctx: { duplicate: !!b.duplicate, memberPosts: b.memberPosts === undefined ? 99 : Math.max(0, +b.memberPosts || 0) } });
    const order = { reject: 3, queue: 2, report: 1 };
    let final = legacy?.action || null; if (v2.action && (!final || order[v2.action] > order[final])) final = v2.action;
    /* guard (runs first on the server): a hit on an enabled guard rejects before any other rule. Masked words only. */
    const gd = draft.guard && typeof draft.guard === "object" ? AR.parseGuard(draft.guard) : null;
    let guard = null;
    if (gd) {
      const gm = AR.matchGuard(text, gd), applies = AR.guardApplies(gd, kind), st = AR.guardStep(Math.max(1, Math.min(10, +b.strike || 1)), gd);
      const words = [...new Set(gm.words.map(AR.maskWord).filter(Boolean))].slice(0, 5);
      guard = { enabled: gd.enabled, applies, hit: !!gm.hit, words, source: b.config && b.config.guard ? "draft" : "saved", outcome: gm.hit ? { n: st.n, max: st.max, hours: st.hours, locked: st.locked, message: st.message } : null };
      if (applies && gm.hit) final = "reject";
    }
    const glabel = guard?.applies && guard.hit ? "سيُحذف (الحارس التلقائي) · " + guard.outcome.message.split(". ").slice(1).join(". ") : null;
    return { final: final || "allow", label: glabel || (final ? AR.ACTION_AR[final] : "يُنشر عادياً"), guard, legacy, v2: v2.matches.map(m => ({ rule: m.rule, title: AR.RULES[m.rule]?.t || m.rule, action: m.action, reason: m.reason })), normalized: AR.tokens(text).join(" ").slice(0, 300), note: "اختبار فقط: لا يُحفظ النص ولا يُسجَّل." };
  }));
  /* v2.62 T6 — member endpoints of «الحارس التلقائي» (signed-in only: visitors get 401 from requireUser) */
  R.get("/api/communities/:id/autoguard/me", A(async (req) => guardState(await getC(req.params.id), req.user.id)));
  /* live pre-check for the composer: {hit, words(masked)} only. Rate-limited, members only, nothing stored or logged,
   * never a strike, never the list. Guard off / not for this kind / staff → hit:false without matching. */
  R.post("/api/communities/:id/autoguard/check", A(async (req) => {
    if (!ctx.rl.hit("guardcheck", req.user.id)) throw E.rate();
    const c = await getC(req.params.id), m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [c.id, req.user.id]);
    if (!m || m.role === "pending" || m.role === "banned") throw E.forbid("للأعضاء فقط");
    const none = { hit: false, words: [] }, b = req.body || {}, kind = oneOf(b.kind, ["post", "comment", "edit"], "post");
    const g = guardOf(c); if (!AR.guardApplies(g, kind) || STAFF.includes(m.role)) return none;
    const text = typeof b.text === "string" ? b.text.slice(0, 20000) : ""; if (text.trim().length < 2) return none;
    const r = AR.matchGuard(text, g); if (!r.hit) return none;
    return { hit: true, words: [...new Set(r.words.map(AR.maskWord).filter(Boolean))].slice(0, 5) };
  }));
  R.get("/api/communities/:id/automod/stats", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id, "view_automod");
    const days = Math.max(7, Math.min(90, +req.query.days || 30)), from = since(days * DAY);
    const rows = await db.all("SELECT action, meta, target_post, created_at FROM mod_actions WHERE community=$1 AND created_at > $2 AND action IN ('automod_queue','automod_reject','automod_flag','automod_penalty') ORDER BY created_at", [cid, from]);
    const by = { automod_queue: 0, automod_reject: 0, automod_flag: 0, automod_penalty: 0 }, rules = {}, daily = {};
    for (const r of rows) { by[r.action]++; const m = jp(r.meta) || {}; for (const k of (m.rules || ["legacy"])) if (r.action !== "automod_penalty") rules[k] = (rules[k] || 0) + 1; const d = String(r.created_at).slice(0, 10); daily[d] = (daily[d] || 0) + 1; }
    const queued = rows.filter(r => r.action === "automod_queue" && r.target_post).map(r => r.target_post);
    let approved = 0, rejected = 0;
    if (queued.length) {
      const ph = queued.slice(0, 500).map((_, i) => "$" + (i + 2)).join(",");
      const dec = await db.all(`SELECT action, COUNT(*) n FROM mod_actions WHERE community=$1 AND action IN ('approve','reject') AND target_post IN (${ph}) GROUP BY action`, [cid, ...queued.slice(0, 500)]);
      for (const d of dec) { if (d.action === "approve") approved = Number(d.n); else rejected = Number(d.n); }
    }
    const series = []; for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10); series.push({ day: d, n: daily[d] || 0 }); }
    /* v2.62 T8: «الحارس التلقائي» KPI — strikes/locks in the window and members locked now (counts only, no names) */
    const gs = await db.all("SELECT action, COUNT(*) n FROM mod_actions WHERE community=$1 AND created_at > $2 AND action IN ('autoguard_strike','autoguard_lock') GROUP BY action", [cid, from]);
    const gl = await db.get("SELECT COUNT(DISTINCT user_id) n FROM community_sanctions WHERE community=$1 AND kind='mute' AND rule_id='autoguard_lock' AND lifted_at IS NULL", [cid]);
    const guard = { strikes: 0, locks: 0, lockedNow: Number(gl?.n || 0) }; for (const g of gs) guard[g.action === "autoguard_lock" ? "locks" : "strikes"] = Number(g.n);
    return { guard, days, total: rows.length - by.automod_penalty, byAction: by, byRule: Object.entries(rules).sort((a, b) => b[1] - a[1]).map(([rule, n]) => ({ rule, title: AR.RULES[rule]?.t || (rule === "legacy" ? "القواعد الأساسية" : rule), n })), reviewed: { approved, rejected, falsePositiveRate: approved + rejected ? Math.round(approved / (approved + rejected) * 100) : null }, series };
  }));

  /* ======================= claims and assignment ======================= */
  const claimRow = (cid, kind, iid) => db.get("SELECT c.*, u.name FROM mod_claims c LEFT JOIN users u ON u.id=c.claimed_by WHERE c.community=$1 AND c.item_kind=$2 AND c.item_id=$3", [cid, kind, iid]);
  const live = (r) => r && new Date(r.expires_at).getTime() > Date.now();
  async function guardClaim(cid, kind, iid, uid) {
    if (!KINDS.includes(kind) || !iid) return;
    const r = await claimRow(cid, kind, String(iid));
    if (live(r) && r.claimed_by !== uid) throw E.conflict(`يعمل على هذا العنصر مشرف آخر (${r.name || "مشرف"})`);
  }
  const clearClaim = (cid, kind, iid) => KINDS.includes(kind) && iid ? db.run("DELETE FROM mod_claims WHERE community=$1 AND item_kind=$2 AND item_id=$3", [cid, kind, String(iid)]) : null;
  const kindId = (b) => { const kind = oneOf(b?.kind, KINDS, null), iid = str(b?.id, 80); if (!kind || !iid) throw E.bad(); return { kind, iid }; };
  /* atomic: INSERT … ON CONFLICT DO NOTHING, then take over only an expired (or my own) claim — two moderators pressing
   * «سأتولاها» at the same moment: exactly one wins, the other gets 409 with the winner's name */
  R.post("/api/communities/:id/modqueue/claim", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id); const { kind, iid } = kindId(req.body);
    const t = now(), exp = new Date(Date.now() + CLAIM_MS).toISOString();
    let r = await db.run("INSERT INTO mod_claims(community,item_kind,item_id,claimed_by,claimed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [cid, kind, iid, req.user.id, t, exp]);
    if (!r.changes) r = await db.run("UPDATE mod_claims SET claimed_by=$1, assigned_by=NULL, claimed_at=$2, expires_at=$3 WHERE community=$4 AND item_kind=$5 AND item_id=$6 AND (claimed_by=$1 OR expires_at < $2)", [req.user.id, t, exp, cid, kind, iid]);
    if (!r.changes) { const w = await claimRow(cid, kind, iid); throw E.conflict(`يعمل على هذا العنصر مشرف آخر (${w?.name || "مشرف"})`); }
    return { claim: { kind, id: iid, by: req.user.id, mine: true, expiresAt: exp } };
  }));
  R.post("/api/communities/:id/modqueue/release", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id); const { kind, iid } = kindId(req.body);
    const r = await claimRow(cid, kind, iid); if (!r) return { ok: true };
    if (r.claimed_by !== req.user.id && live(r)) await P.needAct(cid, req.user.id, r.claimed_by, "لا يمكنك إلغاء تولّي مشرف في رتبتك أو أعلى");
    await clearClaim(cid, kind, iid); return { ok: true };
  }));
  R.post("/api/communities/:id/modqueue/assign", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id); const { kind, iid } = kindId(req.body), to = str(req.body.to, 80, { required: true });
    if (!(await P.has(cid, to, "queue_review"))) throw E.bad("يمكن الإسناد إلى المشرفين فقط");
    const cur = await claimRow(cid, kind, iid);
    if (live(cur) && cur.claimed_by !== req.user.id && cur.claimed_by !== to) await P.needAct(cid, req.user.id, cur.claimed_by, "العنصر مع مشرف في رتبتك أو أعلى");
    const t = now(), exp = new Date(Date.now() + ASSIGN_MS).toISOString();
    await db.run("INSERT INTO mod_claims(community,item_kind,item_id,claimed_by,assigned_by,claimed_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (community,item_kind,item_id) DO UPDATE SET claimed_by=$4, assigned_by=$5, claimed_at=$6, expires_at=$7", [cid, kind, iid, to, req.user.id, t, exp]);
    await cmod().log(cid, req.user.id, { user: to, action: "assign", meta: { kind, id: iid } });
    if (to !== req.user.id && (await prefsOf(cid, to)).assigned) await notify(to, "mod_assigned", { actor: req.user.id, ref: cid });
    return { claim: { kind, id: iid, by: to, assignedBy: req.user.id, expiresAt: exp } };
  }));

  /* ======================= queue v2 ======================= */
  R.get("/api/communities/:id/modqueue/v2", A(async (req) => {
    const cid = req.params.id; const me = await needMod(cid, req.user.id);
    const q = await cmod().queue(cid);
    const claims = await db.all("SELECT c.*, u.name, u.handle FROM mod_claims c LEFT JOIN users u ON u.id=c.claimed_by WHERE c.community=$1 AND c.expires_at > $2", [cid, now()]);
    const cm = Object.fromEntries(claims.map(c => [c.item_kind + ":" + c.item_id, { by: c.claimed_by, name: c.name, handle: c.handle, mine: c.claimed_by === req.user.id, assigned: !!c.assigned_by, expiresAt: c.expires_at }]));
    let items = q.items.map(it => ({ ...it, claim: cm[it.kind + ":" + it.id] || null }));
    const kind = oneOf(req.query.kind, [...KINDS, "all", "mine"], "all");
    if (kind === "mine") items = items.filter(it => it.claim?.mine); else if (kind !== "all") items = items.filter(it => it.kind === kind);
    const sort = oneOf(req.query.sort, ["risk", "old", "new"], "risk");
    if (sort === "old") items.sort((a, b) => (a.at > b.at ? 1 : -1)); else if (sort === "new") items.sort((a, b) => (a.at < b.at ? 1 : -1));
    const staff = await db.all("SELECT m.user_id id, m.role, u.name, u.handle FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community=$1 AND m.role IN ('owner','admin','moderator') ORDER BY m.role, u.name LIMIT 50", [cid]);
    const appeals = Number((await db.get("SELECT COUNT(*) n FROM community_appeals WHERE community=$1 AND status='open'", [cid]))?.n || 0);
    return { items, counts: { ...q.counts, mine: q.items.filter(it => cm[it.kind + ":" + it.id]?.mine).length, appeals }, staff, me: { id: req.user.id, role: me.role } };
  }));
  const BULK = { approve: { post: "approve", comment: "approve", join: "approve" }, reject: { post: "reject", comment: "reject", join: "reject", report: "remove" }, dismiss: { report: "dismiss" } };
  R.post("/api/communities/:id/modqueue/bulk", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id); const b = req.body || {};
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50); if (!items.length) throw E.bad("اختر عناصر أولاً");
    let action = oneOf(b.action, Object.keys(BULK), null), reason = str(b.reason, 300), macro = null;
    if (b.macro) { macro = await db.get("SELECT * FROM mod_macros WHERE id=$1 AND community=$2", [b.macro, cid]); if (!macro) throw E.nf("القالب غير موجود"); reason = reason || macro.reason; const qa = { approve: "approve", reject: "reject", remove: "reject", dismiss: "dismiss" }[String(macro.action).split("+")[0]]; action = action || qa || null; }
    if (!action) throw E.bad();
    const results = [];
    for (const it of items) {
      const kind = oneOf(it?.kind, KINDS, null), a = kind && BULK[action][kind];
      if (!a) { results.push({ kind, id: it?.id, ok: false, skipped: true, error: "لا ينطبق على هذا النوع" }); continue; }
      try { await cmod().act(req.user, cid, { kind, id: it.id, action: a, reason }); results.push({ kind, id: it.id, ok: true }); }
      catch (e) { results.push({ kind, id: it.id, ok: false, status: e.status || 400, error: e.message }); }
    }
    if (macro) await db.run("UPDATE mod_macros SET uses=uses+$1 WHERE id=$2", [results.filter(r => r.ok).length, macro.id]);
    return { done: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok && !r.skipped).length, skipped: results.filter(r => r.skipped).length, results };
  }));

  /* ======================= macros ======================= */
  const macroOut = (m) => { const [qa, pen] = String(m.action || "none").split("+"); return { id: m.id, title: m.title, action: qa || "none", penalty: pen || "none", reason: m.reason || "", hours: m.hours || null, message: m.message || "", uses: Number(m.uses || 0), createdBy: m.created_by, updatedAt: m.updated_at || m.created_at }; };
  const macroIn = (b) => {
    const title = str(b.title, 60, { required: true }), qa = oneOf(b.action, MACRO_ACTIONS, "none"), pen = oneOf(b.penalty, PENALTIES, "none");
    if (qa === "none" && pen === "none") throw E.bad("اختر إجراءً أو عقوبة للقالب");
    return { title, action: qa + (pen !== "none" ? "+" + pen : ""), reason: str(b.reason, 300) || null, hours: pen === "mute" ? Math.max(1, Math.min(720, +b.hours || 24)) : null, message: str(b.message, 500) || null };
  };
  R.get("/api/communities/:id/macros", A(async (req) => { await needMod(req.params.id, req.user.id); return { macros: (await db.all("SELECT * FROM mod_macros WHERE community=$1 ORDER BY uses DESC, title LIMIT 100", [req.params.id])).map(macroOut) }; }));
  R.post("/api/communities/:id/macros", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id);
    if (Number((await db.get("SELECT COUNT(*) n FROM mod_macros WHERE community=$1", [cid]))?.n || 0) >= 100) throw E.bad("الحد 100 قالب");
    const m = macroIn(req.body || {}), mid = id("mc"), t = now();
    await db.run("INSERT INTO mod_macros(id,community,title,action,reason,hours,message,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)", [mid, cid, m.title, m.action, m.reason, m.hours, m.message, req.user.id, t]);
    await cmod().log(cid, req.user.id, { action: "macro_saved", reason: m.title });
    return { macro: macroOut(await db.get("SELECT * FROM mod_macros WHERE id=$1", [mid])) };
  }));
  const ownOrManage = async (cid, uid, m) => { if (m.created_by !== uid) await P.need(cid, uid, "manage_automod", "تعديل قوالب الآخرين للمالك والمديرين"); };
  R.patch("/api/communities/:id/macros/:mid", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id);
    const cur = await db.get("SELECT * FROM mod_macros WHERE id=$1 AND community=$2", [req.params.mid, cid]); if (!cur) throw E.nf(); await ownOrManage(cid, req.user.id, cur);
    const m = macroIn({ ...macroOut(cur), ...(req.body || {}) });
    await db.run("UPDATE mod_macros SET title=$1, action=$2, reason=$3, hours=$4, message=$5, updated_at=$6 WHERE id=$7", [m.title, m.action, m.reason, m.hours, m.message, now(), cur.id]);
    await cmod().log(cid, req.user.id, { action: "macro_saved", reason: m.title });
    return { macro: macroOut(await db.get("SELECT * FROM mod_macros WHERE id=$1", [cur.id])) };
  }));
  R.del("/api/communities/:id/macros/:mid", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id);
    const cur = await db.get("SELECT * FROM mod_macros WHERE id=$1 AND community=$2", [req.params.mid, cid]); if (!cur) throw E.nf(); await ownOrManage(cid, req.user.id, cur);
    await db.run("DELETE FROM mod_macros WHERE id=$1", [cur.id]); await cmod().log(cid, req.user.id, { action: "macro_deleted", reason: cur.title });
    return { ok: true };
  }));
  /* apply a macro to one queue item: the queue action (if any) then the penalty on the item's author (if any) */
  R.post("/api/communities/:id/macros/:mid/apply", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id); const { kind, iid } = kindId(req.body);
    const m = await db.get("SELECT * FROM mod_macros WHERE id=$1 AND community=$2", [req.params.mid, cid]); if (!m) throw E.nf("القالب غير موجود");
    const mo = macroOut(m), out = { macro: mo.id, action: null, penalty: null };
    const target = req.body.user ? str(req.body.user, 80) : null;
    if (mo.action !== "none") {
      const a = kind === "report" ? ({ remove: "remove", reject: "remove", dismiss: "dismiss" })[mo.action] : kind === "join" || kind === "post" || kind === "comment" ? ({ approve: "approve", reject: "reject", remove: "reject" })[mo.action] : null;
      if (!a) throw E.bad("إجراء القالب لا ينطبق على هذا العنصر");
      await cmod().act(req.user, cid, { kind, id: iid, action: a, reason: mo.reason }); out.action = a;
    }
    if (mo.penalty !== "none") {
      if (!target) throw E.bad("لا يوجد عضو لتطبيق العقوبة عليه");
      await cmod().discipline(req.user, cid, target, { action: mo.penalty, hours: mo.hours, reason: mo.message || mo.reason }); out.penalty = mo.penalty;
    }
    await db.run("UPDATE mod_macros SET uses=uses+1 WHERE id=$1", [m.id]);
    return { ok: true, ...out };
  }));

  /* ======================= appeals ======================= */
  const APPEAL_PERM = { ban: "ban", mute: "mute", warn: "warn", removal: "remove_content" };
  const KIND_AR = { ban: "حظر", mute: "كتم", warn: "إنذار", removal: "حذف منشور" };
  async function mySanctions(cid, uid) {
    const sanctions = await db.all("SELECT id, kind, until, reason, actor, created_at, lifted_at FROM community_sanctions WHERE community=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 30", [cid, uid]);
    const removed = await db.all("SELECT p.id, p.title, p.text, p.status, p.created_at FROM posts p WHERE p.community=$1 AND p.author=$2 AND p.status IN ('removed','rejected') ORDER BY p.created_at DESC LIMIT 20", [cid, uid]);
    const appeals = await db.all("SELECT id, kind, ref, text, status, note, created_at, decided_at FROM community_appeals WHERE community=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50", [cid, uid]);
    const ap = (kind, ref) => appeals.find(a => a.kind === kind && a.ref === ref) || null;
    const items = [
      ...sanctions.map(s => { const active = !s.lifted_at && (s.kind !== "mute" || !s.until || new Date(s.until) > new Date()); return { kind: s.kind, ref: s.id, label: KIND_AR[s.kind] || s.kind, reason: s.reason, at: s.created_at, until: s.until, active, automatic: s.actor === "system", appeal: ap(s.kind, s.id), canAppeal: active && !ap(s.kind, s.id) }; }),
      ...removed.map(p => ({ kind: "removal", ref: p.id, label: KIND_AR.removal, reason: null, preview: ((p.title ? p.title + " — " : "") + (p.text || "")).slice(0, 160), at: p.created_at, active: true, appeal: ap("removal", p.id), canAppeal: !ap("removal", p.id) }))
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    return { items, appeals };
  }
  R.get("/api/communities/:id/appeals/mine", A(async (req) => {
    const c = await getC(req.params.id), m = await db.get("SELECT role, warnings, muted_until FROM memberships WHERE community=$1 AND user_id=$2", [c.id, req.user.id]);
    const s = await mySanctions(c.id, req.user.id);
    return { community: { id: c.id, name: c.name }, membership: m ? { role: m.role, warnings: m.warnings, mutedUntil: m.muted_until } : null, items: s.items, guide: "يراجع استئنافك مشرف أعلى رتبة من صاحب القرار. اكتب ما حدث بهدوء ووضوح، ولماذا ترى أن القرار يستحق المراجعة." };
  }));
  R.post("/api/communities/:id/appeals", A(async (req) => {
    const c = await getC(req.params.id), b = req.body || {}, kind = oneOf(b.kind, Object.keys(APPEAL_PERM), null), ref = str(b.ref, 80);
    if (!kind || !ref) throw E.bad();
    const text = str(b.text, 1000, { required: true }); if (text.trim().length < 10) throw E.bad("اكتب عشرة أحرف على الأقل");
    if (!ctx.rl.hit("report", "appeal:" + req.user.id)) throw E.rate();
    const it = (await mySanctions(c.id, req.user.id)).items.find(x => x.kind === kind && x.ref === ref);
    if (!it) throw E.nf("لا يوجد قرار بهذا المعرّف"); if (!it.canAppeal) throw E.conflict(it.appeal ? "قدّمت استئنافاً على هذا القرار" : "هذا القرار لم يعد سارياً");
    if (Number((await db.get("SELECT COUNT(*) n FROM community_appeals WHERE community=$1 AND user_id=$2 AND status='open'", [c.id, req.user.id]))?.n || 0) >= 5) throw E.bad("لديك خمسة استئنافات مفتوحة بالفعل");
    const aid = id("ap");
    try { await db.run("INSERT INTO community_appeals(id,community,user_id,kind,ref,text,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7)", [aid, c.id, req.user.id, kind, ref, text, now()]); }
    catch { throw E.conflict("قدّمت استئنافاً على هذا القرار"); }
    for (const m of await db.all("SELECT user_id FROM memberships WHERE community=$1 AND role IN ('owner','admin','moderator')", [c.id])) if ((await prefsOf(c.id, m.user_id)).appeals) await notify(m.user_id, "mod_appeal", { actor: req.user.id, ref: c.id });
    return { appeal: { id: aid, kind, ref, status: "open" } };
  }));
  R.get("/api/communities/:id/appeals", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id);
    const st = oneOf(req.query.status, ["open", "closed"], "open");
    const rows = await db.all(`SELECT a.*, u.name, u.handle, u.avatar, u.color, d.name decider FROM community_appeals a JOIN users u ON u.id=a.user_id LEFT JOIN users d ON d.id=a.decided_by WHERE a.community=$1 AND ${st === "open" ? "a.status='open'" : "a.status<>'open'"} ORDER BY a.created_at ${st === "open" ? "" : "DESC"} LIMIT 200`, [cid]);
    const out = [];
    for (const a of rows) {
      let decision = null;
      if (a.kind === "removal") { const p = await db.get("SELECT title, text, status FROM posts WHERE id=$1", [a.ref]); decision = p ? { preview: ((p.title ? p.title + " — " : "") + (p.text || "")).slice(0, 200), status: p.status } : null; }
      else { const s = await db.get("SELECT s.kind, s.reason, s.until, s.created_at, s.actor, s.lifted_at, u.name actor_name FROM community_sanctions s LEFT JOIN users u ON u.id=s.actor WHERE s.id=$1", [a.ref]); decision = s ? { reason: s.reason, until: s.until, at: s.created_at, by: s.actor === "system" ? "النظام" : s.actor_name, byId: s.actor, lifted: !!s.lifted_at } : null; }
      out.push({ id: a.id, kind: a.kind, label: KIND_AR[a.kind], ref: a.ref, text: a.text, status: a.status, note: a.note, at: a.created_at, decidedAt: a.decided_at, decider: a.decider, user: { id: a.user_id, name: a.name, handle: a.handle, avatar: a.avatar, color: a.color }, decision, mineDecision: decision?.byId === req.user.id });
    }
    return { appeals: out };
  }));
  R.post("/api/communities/:id/appeals/:aid/decide", A(async (req) => {
    const cid = req.params.id; const me = await needMod(cid, req.user.id);
    const a = await db.get("SELECT * FROM community_appeals WHERE id=$1 AND community=$2", [req.params.aid, cid]); if (!a) throw E.nf();
    if (a.status !== "open") throw E.conflict("تم البت في هذا الاستئناف");
    const decision = oneOf(req.body?.decision, ["accept", "reject"], null); if (!decision) throw E.bad(); const note = str(req.body.note, 500);
    await P.need(cid, req.user.id, APPEAL_PERM[a.kind]);
    if (a.user_id === req.user.id) throw E.forbid("لا يمكنك البت في استئنافك");
    await P.needAct(cid, req.user.id, a.user_id, "يبت في الاستئناف مشرف أعلى رتبة من صاحبه");
    const s = a.kind !== "removal" ? await db.get("SELECT * FROM community_sanctions WHERE id=$1 AND community=$2", [a.ref, cid]) : null;
    if (s && s.actor === req.user.id && me.role !== "owner") throw E.forbid("يبت في الاستئناف مشرف غير صاحب القرار");
    const r = await db.run("UPDATE community_appeals SET status=$1, decided_by=$2, decided_at=$3, note=$4 WHERE id=$5 AND status='open'", [decision === "accept" ? "accepted" : "rejected", req.user.id, now(), note, a.id]);
    if (!r.changes) throw E.conflict("تم البت في هذا الاستئناف");
    let restored = null;
    if (decision === "accept") {
      const t = now();
      if (a.kind === "ban" || a.kind === "mute") {
        const role = a.kind === "ban" ? "banned" : "muted";
        const m = await db.get("SELECT prev_role FROM memberships WHERE community=$1 AND user_id=$2 AND role=$3", [cid, a.user_id, role]);
        if (m) { await db.run("UPDATE memberships SET role=COALESCE(prev_role,'member'), status='active', prev_role=NULL, muted_until=NULL WHERE community=$1 AND user_id=$2 AND role=$3", [cid, a.user_id, role]); restored = m.prev_role || "member"; }
        await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by=$2 WHERE id=$3 AND lifted_at IS NULL", [t, req.user.id, a.ref]);
        P.invalidate?.(cid);
      } else if (a.kind === "warn") {
        await db.run("UPDATE memberships SET warnings=CASE WHEN warnings > 0 THEN warnings - 1 ELSE 0 END WHERE community=$1 AND user_id=$2", [cid, a.user_id]);
        await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by=$2 WHERE id=$3 AND lifted_at IS NULL", [t, req.user.id, a.ref]);
      } else if (a.kind === "removal") {
        await db.run("UPDATE posts SET status='published' WHERE id=$1 AND community=$2 AND status IN ('removed','rejected')", [a.ref, cid]);
        ctx.cache?.del?.("feed:");
      }
    }
    await cmod().log(cid, req.user.id, { user: a.user_id, post: a.kind === "removal" ? a.ref : null, action: decision === "accept" ? "appeal_accepted" : "appeal_rejected", reason: note, meta: { appeal: a.id, kind: a.kind } });
    await notify(a.user_id, "appeal_decided", { actor: req.user.id, ref: cid });
    return { ok: true, result: decision === "accept" ? "accepted" : "rejected", restoredRole: restored };
  }));

  /* ======================= moderator notification preferences ======================= */
  async function prefsOf(cid, uid) { const r = await db.get("SELECT prefs FROM mod_prefs WHERE community=$1 AND user_id=$2", [cid, uid]).catch(() => null); return { ...PREF_DEF, ...(jp(r?.prefs) || {}) }; }
  async function prefsMap(cid) { const rows = await db.all("SELECT user_id, prefs FROM mod_prefs WHERE community=$1", [cid]); return Object.fromEntries(rows.map(r => [r.user_id, { ...PREF_DEF, ...(jp(r.prefs) || {}) }])); }
  R.get("/api/communities/:id/modprefs", A(async (req) => { await needMod(req.params.id, req.user.id); return { prefs: await prefsOf(req.params.id, req.user.id), defaults: PREF_DEF }; }));
  R.put("/api/communities/:id/modprefs", A(async (req) => {
    const cid = req.params.id; await needMod(cid, req.user.id); const b = req.body || {};
    const prefs = { digest: oneOf(b.digest, ["6h", "daily", "off"], "6h"), appeals: b.appeals !== false, assigned: b.assigned !== false };
    await db.run("INSERT INTO mod_prefs(community,user_id,prefs,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (community,user_id) DO UPDATE SET prefs=$3, updated_at=$4", [cid, req.user.id, prefs, now()]);
    return { prefs };
  }));

  async function sweep() { await db.run("DELETE FROM mod_claims WHERE expires_at < $1", [since(DAY)]); await db.run("DELETE FROM content_fingerprints WHERE created_at < $1", [since(8 * DAY)]); }
  ctx.scheduler.every("cmod2Sweep", 3600e3, sweep);
  return { guardCheck, guardStrike, guardCount, guardState, guardLocked, guardOf, evalV2, commentRulesOn, commentV2On, afterPost, ladder, legacyTest, guardClaim, clearClaim, prefsOf, prefsMap, sweep };
};
