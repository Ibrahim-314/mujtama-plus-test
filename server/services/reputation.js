/* Trust & Reputation (Phase 7): verification requests with document review, quality-weighted
 * reputation computed by a background job, achievements, and impersonation detection
 * (normalised Arabic/Latin name similarity, look-alike handles, avatar perceptual hash). */
const { E, str, id, now } = require("../lib/core");
const IMG = require("../lib/images");
const KINDS = ["person", "creator", "org", "expert"];

/* --- text normalisation for look-alike detection --- */
const normName = (s = "") => s.normalize("NFKC").toLowerCase().replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/[\s_.-]/g, "");
const normHandle = (s = "") => s.toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/[0]/g, "o").replace(/[1|]/g, "l").replace(/[3]/g, "e").replace(/[5]/g, "s").replace(/_/g, "");
function lev(a, b) { if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n; let prev = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
const sim = (a, b) => { const L = Math.max(a.length, b.length); return L ? 1 - lev(a, b) / L : 0; };

module.exports = (ctx) => {
  const { db, router: R, bus, rl } = ctx; const A = ctx.requireUser;
  const admin = (fn) => A(async (req, res) => { if ((req.actor || req.user).role !== "admin") throw E.forbid(); return fn(req, res); });
  const notify = (...a) => ctx.services.messaging.notify(...a);

  /* ---------- Achievements ---------- */
  const count = async (sql, p) => (await db.get(sql, p)).n;
  const RULES = {
    first_post: (u) => count("SELECT COUNT(*) n FROM posts WHERE author=$1 AND status='published'", [u]).then(n => n >= 1),
    first_comment: (u) => count("SELECT COUNT(*) n FROM comments WHERE author=$1", [u]).then(n => n >= 1),
    followers_10: (u) => count("SELECT COUNT(*) n FROM follows WHERE dst=$1", [u]).then(n => n >= 10),
    followers_100: (u) => count("SELECT COUNT(*) n FROM follows WHERE dst=$1", [u]).then(n => n >= 100),
    helpful_10: (u) => count("SELECT COUNT(*) n FROM reactions r JOIN posts p ON p.id=r.target WHERE p.author=$1 AND r.type='useful'", [u]).then(n => n >= 10),
    helpful_100: (u) => count("SELECT COUNT(*) n FROM reactions r JOIN posts p ON p.id=r.target WHERE p.author=$1 AND r.type='useful'", [u]).then(n => n >= 100),
    community_member: (u) => count("SELECT COUNT(*) n FROM memberships WHERE user_id=$1 AND role NOT IN ('pending','banned')", [u]).then(n => n >= 1),
    secure: (u) => count("SELECT COUNT(*) n FROM user_2fa WHERE user_id=$1 AND enabled=1", [u]).then(n => n >= 1),
    conversation_starter: (u) => db.get("SELECT MAX(c) n FROM (SELECT COUNT(DISTINCT c.author) c FROM comments c JOIN posts p ON p.id=c.post WHERE p.author=$1 GROUP BY c.post) x", [u]).then(r => (r?.n || 0) >= 10),
    profile_complete: async (u) => ctx.services.identity.completeness(await db.get("SELECT * FROM users WHERE id=$1", [u])).percent === 100
  };
  async function checkAchievements(uid, keys = Object.keys(RULES)) {
    if (!uid) return [];
    const have = new Set((await db.all("SELECT key FROM achievements WHERE user_id=$1", [uid])).map(r => r.key)); const won = [];
    for (const k of keys) if (!have.has(k) && await RULES[k](uid).catch(() => false)) {
      const r = await db.run("INSERT INTO achievements(user_id,key,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [uid, k, now()]);
      if (r.changes) { won.push(k); await notify(uid, "achievement", { ref: k }); ctx.realtime.send(uid, "achievement", { key: k, ...achInfo(k) }); }
    }
    return won;
  }
  const achInfo = (k) => { const i = ctx.services.identity.ACHIEVEMENT_INFO[k] || [k, ""]; return { name: i[0], description: i[1] }; };
  bus.on("POST_CREATED", e => checkAchievements(e.post?.author || e.author, ["first_post"]));
  bus.on("COMMENT_CREATED", async e => { await checkAchievements(e.actor, ["first_comment"]); await checkAchievements(e.postAuthor, ["conversation_starter"]); });
  bus.on("USER_FOLLOWED", e => checkAchievements(e.to, ["followers_10", "followers_100"]));
  bus.on("POST_REACTED", e => checkAchievements(e.owner, ["helpful_10", "helpful_100"]));
  bus.on("COMMUNITY_JOINED", e => checkAchievements(e.actor, ["community_member"]));
  bus.on("PROFILE_UPDATED", e => { checkAchievements(e.user, ["profile_complete"]); impersonationCheck(e.user).catch(() => { }); });
  bus.on("USER_REGISTERED", e => impersonationCheck(e.user).catch(() => { }));

  /* ---------- Reputation: quality over quantity ---------- */
  async function computeReputation(uid) {
    const rx = await db.all("SELECT r.target, SUM(CASE WHEN r.type IN ('useful','insightful') THEN 3 ELSE 1 END) w FROM reactions r JOIN posts p ON p.id=r.target WHERE p.author=$1 AND p.status='published' AND r.user_id<>$1 GROUP BY r.target", [uid]);
    const perPost = rx.map(r => 10 * Math.log2(1 + r.w)).sort((a, b) => b - a);
    const quality = perPost.slice(0, 20).reduce((a, b) => a + b, 0);            // only your best 20 posts count
    const discussion = Math.min(200, (await count("SELECT COUNT(DISTINCT c.author) n FROM comments c JOIN posts p ON p.id=c.post WHERE p.author=$1 AND c.author<>$1", [uid])) * 2);
    const reach = Math.sqrt(await count("SELECT COUNT(*) n FROM follows WHERE dst=$1", [uid])) * 3;
    const helpfulGiven = Math.min(50, (await count("SELECT COUNT(*) n FROM comments WHERE author=$1 AND status='published'", [uid])) * 0.5);
    const penalties = (await count("SELECT COUNT(*) n FROM decisions WHERE user_id=$1 AND restored=0", [uid])) * 25;
    const score = Math.max(0, Math.round(quality + discussion + reach + helpfulGiven - penalties));
    const breakdown = { quality: Math.round(quality), discussion: Math.round(discussion), reach: Math.round(reach), participation: Math.round(helpfulGiven), penalties };
    await db.run("INSERT INTO user_reputation(user_id,score,breakdown,computed_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET score=$2, breakdown=$3, computed_at=$4", [uid, score, breakdown, now()]);
    await db.run("UPDATE users SET reputation=$1 WHERE id=$2", [score, uid]);
    return { score, breakdown };
  }
  async function reputationJob() {
    const since = new Date(Date.now() - 864e5).toISOString();
    const ids = (await db.all("SELECT DISTINCT p.author id FROM posts p WHERE p.created_at > $1 UNION SELECT DISTINCT p.author FROM reactions r JOIN posts p ON p.id=r.target WHERE r.at > $1 UNION SELECT dst FROM follows WHERE at > $1", [since])).map(r => r.id);
    for (const uid of ids) { await computeReputation(uid); await checkAchievements(uid); }
    return ids.length;
  }

  /* ---------- Impersonation detection ---------- */
  async function impersonationCheck(uid) {
    const u = await db.get("SELECT id, name, handle, avatar_hash, verified FROM users WHERE id=$1", [uid]); if (!u || u.verified) return [];
    const notable = await db.all("SELECT u.id, u.name, u.handle, u.avatar_hash FROM users u WHERE u.id<>$1 AND (u.verified IS NOT NULL OR u.id IN (SELECT dst FROM follows GROUP BY dst HAVING COUNT(*) >= 50)) LIMIT 2000", [uid]);
    const flags = [];
    for (const v of notable) {
      const nameSim = sim(normName(u.name), normName(v.name)), handleSim = sim(normHandle(u.handle), normHandle(v.handle)), img = IMG.hamming(u.avatar_hash, v.avatar_hash);
      const reasons = []; if (nameSim >= 0.88) reasons.push("اسم مطابق تقريباً"); if (handleSim >= 0.85) reasons.push("اسم مستخدم مشابه"); if (img <= 6) reasons.push("صورة شخصية متطابقة");
      const score = Math.max(nameSim, handleSim) * 0.6 + (img <= 6 ? 0.4 : 0);
      if (reasons.length && (score >= 0.6 || reasons.length >= 2)) {
        if (await db.get("SELECT 1 x FROM impersonation_flags WHERE user_id=$1 AND similar_to=$2", [u.id, v.id])) continue;
        const f = { id: id("if"), reason: reasons.join("، "), score: Math.round(score * 100) / 100 };
        await db.run("INSERT INTO impersonation_flags(id,user_id,similar_to,reason,score,created_at) VALUES($1,$2,$3,$4,$5,$6)", [f.id, u.id, v.id, f.reason, f.score, now()]); flags.push(f);
      }
    }
    return flags;
  }

  /* ---------- Verification requests ---------- */
  R.post("/api/verification", A(async (req) => {
    const u = req.actor || req.user;
    if (!rl.hit("report", "verify:" + u.id)) throw E.rate();
    if (await db.get("SELECT 1 x FROM verification_requests WHERE user_id=$1 AND status='pending'", [req.user.id])) throw E.conflict("لديك طلب قيد المراجعة");
    const kind = KINDS.includes(req.body.kind) ? req.body.kind : null; if (!kind) throw E.bad("نوع التوثيق غير صالح");
    const docs = Array.isArray(req.body.docs) ? req.body.docs.slice(0, 5) : [];
    for (const d of docs) if (!(await db.get("SELECT 1 x FROM media WHERE id=$1 AND owner=$2", [d, u.id]))) throw E.bad("مستند غير صالح");
    if (kind !== "creator" && !docs.length) throw E.bad("أرفق مستنداً واحداً على الأقل");
    const vid = id("vr"); await db.run("INSERT INTO verification_requests(id,user_id,kind,note,docs,created_at) VALUES($1,$2,$3,$4,$5,$6)", [vid, req.user.id, kind, str(req.body.note, 1000), docs, now()]);
    return { request: { id: vid, kind, status: "pending" } };
  }));
  R.get("/api/verification", A(async (req) => ({ request: await db.get("SELECT id, kind, status, reason, created_at, decided_at FROM verification_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [req.user.id]) || null, verified: req.user.verified || null })));
  R.get("/api/admin/verification", admin(async (req) => ({ requests: (await db.all("SELECT v.*, u.name, u.handle, u.avatar, u.reputation, (SELECT COUNT(*) FROM follows f WHERE f.dst=u.id) followers FROM verification_requests v JOIN users u ON u.id=v.user_id WHERE v.status=$1 ORDER BY v.created_at", [req.query.status || "pending"])).map(r => ({ ...r, docs: (r.docs || []).map(d => "/api/media/" + d) })) })));
  R.post("/api/admin/verification/:id", admin(async (req) => {
    const v = await db.get("SELECT * FROM verification_requests WHERE id=$1 AND status='pending'", [req.params.id]); if (!v) throw E.nf();
    const approve = req.body.decision === "approve", reason = str(req.body.reason, 300);
    await db.run("UPDATE verification_requests SET status=$1, reason=$2, reviewer=$3, decided_at=$4 WHERE id=$5", [approve ? "approved" : "rejected", reason, req.user.id, now(), v.id]);
    if (approve) await db.run("UPDATE users SET verified=$1 WHERE id=$2", [v.kind, v.user_id]);
    await notify(v.user_id, approve ? "verified" : "verification_rejected", { ref: v.kind });
    ctx.audit(approve ? "verification_approved" : "verification_rejected", v.user_id, reason || v.kind, req.user.id);
    return { ok: true };
  }));
  R.get("/api/admin/impersonation", admin(async () => ({ flags: (await db.all("SELECT f.*, a.name an, a.handle ah, a.avatar aa, b.name bn, b.handle bh, b.avatar ba FROM impersonation_flags f JOIN users a ON a.id=f.user_id JOIN users b ON b.id=f.similar_to WHERE f.status='open' ORDER BY f.score DESC LIMIT 100")).map(f => ({ id: f.id, reason: f.reason, score: f.score, at: f.created_at, suspect: { id: f.user_id, name: f.an, handle: f.ah, avatar: f.aa }, original: { id: f.similar_to, name: f.bn, handle: f.bh, avatar: f.ba } })) })));
  R.post("/api/admin/impersonation/:id", admin(async (req) => {
    const f = await db.get("SELECT * FROM impersonation_flags WHERE id=$1", [req.params.id]); if (!f) throw E.nf();
    const confirm = req.body.decision === "confirm";
    await db.run("UPDATE impersonation_flags SET status=$1 WHERE id=$2", [confirm ? "confirmed" : "dismissed", f.id]);
    if (confirm) { await db.run("UPDATE users SET status='suspended' WHERE id=$1", [f.user_id]); await db.run("DELETE FROM sessions WHERE user_id=$1", [f.user_id]); }
    ctx.audit(confirm ? "impersonation_confirmed" : "impersonation_dismissed", f.user_id, f.reason, req.user.id); return { ok: true };
  }));
  R.post("/api/admin/reputation/recompute", admin(async () => ({ users: await reputationJob() })));
  R.get("/api/reputation/:handle", async (req) => { const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1)", [req.params.handle]); if (!u) throw E.nf(); return (await db.get("SELECT score, breakdown, computed_at FROM user_reputation WHERE user_id=$1", [u.id])) || { score: 0, breakdown: null }; });

  return { computeReputation, reputationJob, checkAchievements, impersonationCheck, normName, normHandle, sim };
};
