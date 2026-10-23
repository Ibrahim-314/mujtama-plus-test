/* Operations Service (Phases 1, 3, 5): health/status, client error intake, real-user performance
 * metrics (Web Vitals), feature flags with percentage rollouts, personal data export, audit-chain
 * verification. Beacon endpoints accept navigator.sendBeacon (no custom header possible) but only
 * write append-only telemetry, so they carry no CSRF risk. */
const crypto = require("node:crypto");
const { E, str, sha, now } = require("../lib/core");
const M = require("../lib/migrations");
const DEFAULT_FLAGS = [
  ["passkeys", "تسجيل الدخول بمفاتيح المرور", 1, 100],
  ["data_saver", "وضع توفير البيانات", 1, 100],
  ["rum", "قياس أداء المستخدمين الحقيقيين", 1, 100],
  ["new_composer", "المحرر الجديد (المرحلة 11)", 0, 0],
  ["stories", "القصص (المرحلة 13)", 0, 0],
  ["community_lean_bootstrap", "bootstrap خفيف للمجتمعات: عضوياتك ومجتمعات تشرف عليها فقط (v2.57)", 1, 100]
];
module.exports = (ctx) => {
  const { db, router: R, rl, config, realtime, bus } = ctx;
  const started = Date.now();
  ctx.jobsState = ctx.jobsState || {};
  const admin = (fn) => ctx.requireUser(async (req, res) => { if (req.user.role !== "admin") throw E.forbid(); return fn(req, res); });

  (async () => { for (const [key, d, en, ro] of DEFAULT_FLAGS) await db.run("INSERT INTO feature_flags(key,description,enabled,rollout,allow,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING", [key, d, en, ro, [], now()]); })().catch(() => { });

  const bucket = (key, uid) => crypto.createHash("sha1").update(key + ":" + uid).digest().readUInt16BE(0) % 100;
  async function flagsFor(user) {
    const rows = await ctx.cache.wrap("flags", 30e3, () => db.all("SELECT * FROM feature_flags"));
    const out = {}; for (const f of rows) out[f.key] = !!f.enabled && ((f.allow || []).includes(user?.id) || f.rollout >= 100 || (!!user && bucket(f.key, user.id) < f.rollout));
    return out;
  }

  R.get("/api/health", async () => { await db.get("SELECT 1 x"); return { ok: true, version: config.version }; });
  R.get("/api/status", admin(async () => {
    const t0 = process.hrtime.bigint(); await db.get("SELECT 1 x"); const dbMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const since = new Date(Date.now() - 864e5).toISOString();
    const errors24h = (await db.get("SELECT COALESCE(SUM(count),0) n FROM client_errors WHERE last_at > $1", [since])).n;
    const rum = await db.all("SELECT name, value FROM rum_metrics WHERE at > $1", [since]);
    const byName = {}; for (const r of rum) (byName[r.name] ||= []).push(r.value);
    const p75 = Object.fromEntries(Object.entries(byName).map(([k, v]) => { v.sort((a, b) => a - b); return [k, { p75: Math.round(v[Math.floor(v.length * .75)] * 1000) / 1000, n: v.length }]; }));
    const mem = process.memoryUsage();
    return {
      version: config.version, node: process.version, uptimeSec: Math.round((Date.now() - started) / 1000),
      services: { database: { ok: true, dialect: db.dialect, latencyMs: Math.round(dbMs * 100) / 100, replica: !!db.hasReplica }, realtime: { ok: true, online: realtime.online() }, eventBus: { ok: true, recent: bus.log.length }, media: { ok: true }, pi: { ok: config.piEnabled, note: config.piEnabled ? "مفعّل" : "غير مفعّل بعد" } },
      jobs: ctx.jobsState, migrations: await M.status(db), memoryMb: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) },
      errors24h, webVitals: p75
    };
  }));

  R.post("/api/client-errors", async (req) => {
    if (!rl.hit("report", "err:" + req.ip)) return { ok: true };
    const b = req.body || {}; const message = String(b.message || "").slice(0, 500); if (!message) throw E.bad();
    const stack = String(b.stack || "").slice(0, 4000), fp = sha(message + "|" + (stack.split("\n")[1] || "")).slice(0, 24);
    const ex = await db.get("SELECT id FROM client_errors WHERE fingerprint=$1", [fp]);
    if (ex) await db.run("UPDATE client_errors SET count=count+1, last_at=$1 WHERE id=$2", [now(), ex.id]);
    else await db.run("INSERT INTO client_errors(user_id,message,stack,url,ua,release,request_id,fingerprint,first_at,last_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)", [req.user?.id || null, message, stack, String(b.url || "").slice(0, 300), (req.headers["user-agent"] || "").slice(0, 200), String(b.release || "").slice(0, 20), String(b.requestId || "").slice(0, 64), fp, now()]);
    if (process.env.ERROR_WEBHOOK_URL) fetch(process.env.ERROR_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, url: b.url, release: b.release, fingerprint: fp }) }).catch(() => { });
    return { ok: true };
  }, { beacon: true });
  R.get("/api/admin/errors", admin(async () => ({ errors: await db.all("SELECT id, message, url, release, count, first_at, last_at FROM client_errors ORDER BY last_at DESC LIMIT 100") })));

  const RUM = new Set(["LCP", "FCP", "CLS", "INP", "TTFB", "LONGTASK"]);
  R.post("/api/rum", async (req) => {
    if (!rl.hit("react", "rum:" + req.ip)) return { ok: true };
    const list = Array.isArray(req.body?.metrics) ? req.body.metrics.slice(0, 20) : [];
    for (const m of list) if (RUM.has(m.name) && Number.isFinite(+m.value) && +m.value >= 0 && +m.value < 6e5)
      await db.run("INSERT INTO rum_metrics(name,value,route,conn,device,at) VALUES($1,$2,$3,$4,$5,$6)", [m.name, +m.value, String(m.route || "").slice(0, 40), String(req.body.conn || "").slice(0, 10), String(req.body.device || "").slice(0, 10), now()]);
    return { ok: true };
  }, { beacon: true });

  R.get("/api/flags", async (req) => ({ flags: await flagsFor(req.user) }));
  R.get("/api/admin/flags", admin(async () => ({ flags: await db.all("SELECT * FROM feature_flags ORDER BY key") })));
  R.put("/api/admin/flags/:key", admin(async (req) => {
    const key = req.params.key; if (!/^[a-z0-9_]{2,40}$/.test(key)) throw E.bad();
    const enabled = req.body.enabled ? 1 : 0, rollout = Math.max(0, Math.min(100, Math.round(+req.body.rollout || 0))), allow = Array.isArray(req.body.allow) ? req.body.allow.filter(x => typeof x === "string").slice(0, 200) : [];
    await db.run("INSERT INTO feature_flags(key,description,enabled,rollout,allow,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO UPDATE SET enabled=$3, rollout=$4, allow=$5, updated_at=$6, description=COALESCE($2, feature_flags.description)", [key, str(req.body.description, 120), enabled, rollout, allow, now()]);
    ctx.cache.del("flags"); ctx.audit("flag_changed", key, `${enabled}:${rollout}`, req.user.id);
    return { ok: true };
  }));

  /* Right to data portability (Phase 3): everything the user created or that is about them. */
  R.get("/api/me/export", ctx.requireUser(async (req, res) => {
    if (!rl.hit("upload", "export:" + req.user.id)) throw E.rate();
    const u = req.user, q = (sql) => db.all(sql, [u.id]);
    const { password_hash: _ph, session_sid: _sid, session_seen: _seen, ...profile } = u; // never exported
    const data = {
      exportedAt: now(), app: "mujtama-plus", version: config.version, profile,
      posts: await q("SELECT * FROM posts WHERE author=$1 ORDER BY created_at"), comments: await q("SELECT * FROM comments WHERE author=$1 ORDER BY created_at"),
      reactions: await q("SELECT target, type, at FROM reactions WHERE user_id=$1"), following: await q("SELECT dst, at FROM follows WHERE src=$1"), followers: await q("SELECT src, at FROM follows WHERE dst=$1"),
      memberships: await q("SELECT community, role, joined_at FROM memberships WHERE user_id=$1"),
      messages: await q("SELECT m.conv, m.text, m.created_at FROM messages m WHERE m.sender=$1 ORDER BY m.created_at"),
      notifications: await q("SELECT kind, actor, post, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at"),
      media: await q("SELECT id, kind, mime, size, created_at FROM media WHERE owner=$1"), reports: await q("SELECT target, kind, reason, status, created_at FROM reports WHERE by_user=$1"),
      sessions: (await q("SELECT ip, ua, created_at, last_seen FROM sessions WHERE user_id=$1"))
    };
    res.setHeader("Content-Disposition", `attachment; filename="mujtama-plus-${u.handle}-${now().slice(0, 10)}.json"`);
    ctx.audit("data_exported", u.id, null, u.id);
    return data;
  }));

  R.get("/api/admin/audit", admin(async () => ({ entries: await db.all("SELECT id, action, target, reason, by_user, at FROM audit_log ORDER BY id DESC LIMIT 200") })));
  R.get("/api/admin/audit/verify", admin(async () => ctx.verifyAudit()));
  return { flagsFor };
};
