/* Growth & Retention (Phase 10): interactive tour state, first-week challenges, smart follow
 * suggestions (interests, country, friends-of-friends), community welcome messages, sign-up funnel
 * analytics, and A/B experiments with deterministic assignment and conversion reporting. */
const crypto = require("node:crypto");
const { E, str, id, now } = require("../lib/core");
const FUNNEL_EVENTS = new Set(["registered", "onboarded", "tour_completed", "first_post", "first_follow", "first_comment", "challenge_completed", "experiment_exposed", "suggestion_followed"]);
const CHALLENGES = [
  { key: "avatar", text: "أضف صورة شخصية", goal: 1, sql: "SELECT CASE WHEN avatar IS NULL THEN 0 ELSE 1 END n FROM users WHERE id=$1" },
  { key: "follow", text: "تابع 5 أشخاص يهمّونك", goal: 5, sql: "SELECT COUNT(*) n FROM follows WHERE src=$1" },
  { key: "post", text: "انشر أول منشور", goal: 1, sql: "SELECT COUNT(*) n FROM posts WHERE author=$1 AND status='published'" },
  { key: "community", text: "انضم إلى مجتمع", goal: 1, sql: "SELECT COUNT(*) n FROM memberships WHERE user_id=$1 AND role NOT IN ('pending','banned')" },
  { key: "comment", text: "شارك في 3 نقاشات", goal: 3, sql: "SELECT COUNT(*) n FROM comments WHERE author=$1" }
];
const DEFAULT_EXPERIMENTS = [
  ["onboarding_suggestions", "عرض اقتراحات المتابعة في التعريف: شبكة بطاقات أم قائمة", ["grid", "list"], "first_follow"],
  ["tour_style", "الجولة التعريفية: إبراز تفاعلي أم بطاقة مختصرة", ["spotlight", "card"], "first_post"]
];
const GOALS = { first_post: "SELECT 1 x FROM posts WHERE author=$1 LIMIT 1", first_follow: "SELECT 1 x FROM follows WHERE src=$1 LIMIT 1", onboarded: null };

module.exports = (ctx) => {
  const { db, router: R, bus } = ctx; const A = ctx.requireUser; const users = () => ctx.services.users;
  const admin = (fn) => A(async (req, res) => { if ((req.actor || req.user).role !== "admin") throw E.forbid(); return fn(req, res); });

  /* persist only funnel-relevant analytics (high-volume events stay in memory/RUM) */
  ctx.track = (uid, name, props) => { if (FUNNEL_EVENTS.has(name)) db.run("INSERT INTO analytics_events(user_id,name,props,at) VALUES($1,$2,$3,$4)", [uid || null, name, props || {}, now()]).catch(() => { }); };
  const once = async (uid, name, props) => { if (!(await db.get("SELECT 1 x FROM analytics_events WHERE user_id=$1 AND name=$2", [uid, name]))) ctx.track(uid, name, props); };
  bus.on("USER_REGISTERED", e => ctx.track(e.user, "registered"));
  bus.on("POST_CREATED", e => once(e.actor, "first_post"));
  bus.on("USER_FOLLOWED", e => once(e.from, "first_follow"));
  bus.on("COMMENT_CREATED", e => once(e.actor, "first_comment"));

  (async () => { for (const [k, d, v, g] of DEFAULT_EXPERIMENTS) await db.run("INSERT INTO experiments(key,description,variants,goal,enabled,created_at) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT (key) DO NOTHING", [k, d, v, g, now()]); })().catch(() => { });
  const assign = (key, uid, variants) => variants[crypto.createHash("sha1").update("exp:" + key + ":" + uid).digest().readUInt32BE(0) % variants.length];
  async function experimentsFor(uid) {
    const out = {}; for (const e of await db.all("SELECT * FROM experiments WHERE enabled=1")) {
      const variant = assign(e.key, uid, e.variants); out[e.key] = variant;
      const r = await db.run("INSERT INTO experiment_exposures(key,user_id,variant,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [e.key, uid, variant, now()]);
      if (r.changes) ctx.track(uid, "experiment_exposed", { key: e.key, variant });
    }
    return out;
  }

  async function challenges(u) {
    const created = new Date(u.created_at).getTime(), daysLeft = Math.max(0, 7 - Math.floor((Date.now() - created) / 864e5));
    const list = []; for (const c of CHALLENGES) { const n = Math.min(c.goal, Number((await db.get(c.sql, [u.id]))?.n || 0)); list.push({ key: c.key, text: c.text, goal: c.goal, progress: n, done: n >= c.goal }); }
    return { daysLeft, active: daysLeft > 0 && list.some(c => !c.done), items: list, completed: list.filter(c => c.done).length };
  }
  async function suggestions(u, limit = 12) {
    const interests = u.prefs?.interests || [], blocked = u.prefs?.blocked || [];
    const rows = await db.all(`SELECT x.*, (SELECT COUNT(*) FROM follows f WHERE f.dst=x.id) followers,
        (SELECT COUNT(*) FROM follows a JOIN follows b ON b.src=a.dst WHERE a.src=$1 AND b.dst=x.id) mutual
      FROM users x WHERE x.id<>$1 AND x.status='active' AND x.id NOT IN (SELECT dst FROM follows WHERE src=$1) AND x.id NOT IN (SELECT dst FROM follow_requests WHERE src=$1) LIMIT 400`, [u.id]);
    // v2.67 privacy: minors are never suggested to adults and unrelated adults never to minors (guardian links kept)
    const mn = ctx.services.minors, safe = mn?.filterSuggest ? await mn.filterSuggest(rows, u.id) : rows;
    return safe.filter(x => !blocked.includes(x.id) && !(x.prefs?.blocked || []).includes(u.id)).map(x => {
      const shared = (x.prefs?.interests || []).filter(t => interests.includes(t)), reasons = [];
      let s = shared.length * 3 + Math.log2(1 + x.followers) + (x.verified ? 2 : 0) + Math.min(x.mutual, 5) * 2 + (x.reputation || 0) / 200;
      if (u.country && x.country === u.country) { s += 2; reasons.push("من بلدك"); }
      if (x.mutual) reasons.push(x.mutual === 1 ? "يتابعه شخص تتابعه" : `يتابعه ${x.mutual} ممن تتابعهم`);
      if (shared.length) reasons.push("يشاركك الاهتمامات");
      if (x.verified) reasons.push("حساب موثق");
      return { user: users().pub(x), followers: x.followers, score: s, reason: reasons[0] || "حساب نشط" };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  R.get("/api/onboarding", A(async (req) => {
    const u = req.user; let st = await db.get("SELECT * FROM onboarding WHERE user_id=$1", [u.id]);
    if (!st) { await db.run("INSERT INTO onboarding(user_id,tour_done,celebrated,created_at) VALUES($1,0,$2,$3) ON CONFLICT DO NOTHING", [u.id, [], now()]); st = { tour_done: 0, celebrated: [] }; }
    return { tourDone: !!st.tour_done, celebrated: st.celebrated || [], challenges: await challenges(u), experiments: await experimentsFor(u.id) };
  }));
  R.post("/api/onboarding/tour", A(async (req) => { await db.run("UPDATE onboarding SET tour_done=1 WHERE user_id=$1", [req.user.id]); ctx.track(req.user.id, "tour_completed", { skipped: !!req.body.skipped }); return { ok: true }; }));
  R.post("/api/onboarding/celebrated", A(async (req) => {
    const st = await db.get("SELECT celebrated FROM onboarding WHERE user_id=$1", [req.user.id]); const list = [...new Set([...(st?.celebrated || []), str(req.body.key, 40)].filter(Boolean))].slice(-50);
    await db.run("UPDATE onboarding SET celebrated=$1 WHERE user_id=$2", [list, req.user.id]); ctx.track(req.user.id, "challenge_completed", { key: req.body.key }); return { ok: true };
  }));
  R.post("/api/onboarding/onboarded", A(async (req) => { await once(req.user.id, "onboarded"); return { ok: true }; }));
  R.get("/api/suggestions/follow", A(async (req) => ({ suggestions: await suggestions(req.user, Math.min(30, +req.query.limit || 12)) })));
  R.get("/api/experiments", A(async (req) => ({ experiments: await experimentsFor(req.user.id) })));

  /* Community welcome messages: owners write one; every new member receives it as a DM. */
  R.put("/api/communities/:id/welcome", A(async (req) => {
    const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [req.params.id, req.user.id]); if (!m || !["owner", "admin"].includes(m.role)) throw E.forbid();
    const c = await db.get("SELECT settings FROM communities WHERE id=$1", [req.params.id]);
    await db.run("UPDATE communities SET settings=$1 WHERE id=$2", [{ ...(c.settings || {}), welcome: str(req.body.text, 1000) || null }, req.params.id]); return { ok: true };
  }));
  bus.on("COMMUNITY_JOINED", async e => {
    const c = await db.get("SELECT id, name, owner, settings FROM communities WHERE id=$1", [e.community]); const text = c?.settings?.welcome;
    if (!text || !e.actor || c.owner === e.actor) return;
    const ex = await db.get("SELECT a.conv FROM conversation_members a JOIN conversation_members b ON a.conv=b.conv JOIN conversations cv ON cv.id=a.conv AND cv.kind='dm' WHERE a.user_id=$1 AND b.user_id=$2", [c.owner, e.actor]);
    const cid = ex?.conv || id("cv"), at = now();
    if (!ex) await db.tx(async t => { await t.run("INSERT INTO conversations(id,created_at,updated_at) VALUES($1,$2,$2)", [cid, at]); await t.run("INSERT INTO conversation_members(conv,user_id) VALUES($1,$2)", [cid, c.owner]); await t.run("INSERT INTO conversation_members(conv,user_id,state) VALUES($1,$2,'accepted')", [cid, e.actor]); });
    const mid = id("ms"); const body = `مرحباً بك في «${c.name}»\n\n${text}`;
    await db.run("INSERT INTO messages(id,conv,sender,text,created_at) VALUES($1,$2,$3,$4,$5)", [mid, cid, c.owner, body, at]);
    await db.run("UPDATE conversations SET updated_at=$1 WHERE id=$2", [at, cid]);
    ctx.realtime.send(e.actor, "message", { id: mid, conv: cid, from: c.owner, text: body, at });
  });

  /* Sign-up funnel (cohort of the last N days) and experiment results */
  R.get("/api/admin/funnel", admin(async (req) => {
    const days = Math.min(90, +req.query.days || 30), since = new Date(Date.now() - days * 864e5).toISOString();
    const cohort = await db.all("SELECT id, prefs, created_at FROM users WHERE account_type='person' AND created_at > $1", [since]); const ids = cohort.map(u => u.id);
    const has = async (sql) => { if (!ids.length) return 0; const ph = ids.map((_, i) => "$" + (i + 1)).join(","); return (await db.get(sql.replaceAll("{IDS}", ph), ids)).n; };
    const steps = [
      ["سجّل", ids.length],
      ["أكمل التعريف", cohort.filter(u => u.prefs?.onboarded).length],
      ["تابع شخصاً", await has("SELECT COUNT(DISTINCT src) n FROM follows WHERE src IN ({IDS})")],
      ["نشر أو علّق", await has("SELECT COUNT(DISTINCT a) n FROM (SELECT author a FROM posts WHERE author IN ({IDS}) UNION SELECT author FROM comments WHERE author IN ({IDS})) x")],
      ["عاد في يوم لاحق", cohort.length ? (await Promise.all(cohort.map(u => db.get("SELECT 1 x FROM sessions WHERE user_id=$1 AND last_seen > $2", [u.id, new Date(new Date(u.created_at).getTime() + 864e5).toISOString()])))).filter(Boolean).length : 0]
    ];
    return { days, steps: steps.map(([label, n], i) => ({ label, users: n, rate: steps[0][1] ? Math.round(n / steps[0][1] * 1000) / 10 : 0, dropFromPrev: i && steps[i - 1][1] ? Math.round((1 - n / steps[i - 1][1]) * 1000) / 10 : 0 })) };
  }));
  R.get("/api/admin/experiments", admin(async () => {
    const out = []; for (const e of await db.all("SELECT * FROM experiments ORDER BY created_at")) {
      const variants = []; for (const v of e.variants) {
        const ex = await db.all("SELECT user_id FROM experiment_exposures WHERE key=$1 AND variant=$2", [e.key, v]); let conv = 0;
        for (const x of ex) {
          const hit = e.goal === "onboarded" ? (await db.get("SELECT prefs FROM users WHERE id=$1", [x.user_id]))?.prefs?.onboarded : await db.get(GOALS[e.goal] || GOALS.first_post, [x.user_id]);
          if (hit) conv++;
        }
        variants.push({ variant: v, exposed: ex.length, converted: conv, rate: ex.length ? Math.round(conv / ex.length * 1000) / 10 : 0 });
      }
      out.push({ key: e.key, description: e.description, goal: e.goal, enabled: !!e.enabled, variants });
    }
    return { experiments: out };
  }));
  R.put("/api/admin/experiments/:key", admin(async (req) => { await db.run("UPDATE experiments SET enabled=$1 WHERE key=$2", [req.body.enabled ? 1 : 0, req.params.key]); return { ok: true }; }));
  return { suggestions, challenges, experimentsFor };
};
