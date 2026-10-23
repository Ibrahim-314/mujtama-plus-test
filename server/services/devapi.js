/* Developer API «واجهة المطورين» (phase 47). Contract: docs/integration/p47.md.
 * • Public REST API v1 under /api/v1 — read PUBLIC posts, profiles and communities; post/comment as a user (scope write:posts)
 *   or as an app's bot (scope bot). Every read is evaluated as an ANONYMOUS viewer, whatever the token: private messages, E2EE,
 *   followers-only / private posts, paid posts, private-account profiles and private/invite communities never reach an app.
 * • OpenAPI 3 document generated from the same route definitions → GET /api/v1/openapi.json.
 * • OAuth 2.0 authorization code + PKCE (S256 only) with a consent screen (#/oauth, lazy chunk dev), refresh-token rotation with
 *   reuse detection, client_credentials for bots, revocation. Credentials are sha256-hashed at rest and shown once.
 * • Webhooks: HMAC-SHA256 signed (`X-Mujtama-Signature: t=<ts>,v1=<hex>`), retries with exponential backoff, delivery log.
 * • Community bots: a bot account bound to an app, installed by a community owner/admin into PUBLIC communities only;
 *   slash-commands (/name args) and @mentions are delivered as webhook events bot.command / bot.mention.
 * • Per-key rate limits (sliding minute; key > app > default), X-RateLimit-* headers.
 * Bearer-token routes are exempt from the cookie CSRF header (route opt apiToken) and never read the session cookie. */
const { E, HttpError, str, now, id, Classifier } = require("../lib/core");
const L = require("../lib/devapi-lib");
const { log } = require("../lib/log");

module.exports = (ctx, opts = {}) => {
  const { db, router: r, bus, config } = ctx;
  const env = opts.env || process.env;
  const cfg = {
    rate: +(env.DEVAPI_RATE_PER_MIN || 60), anonRate: +(env.DEVAPI_ANON_RATE_PER_MIN || 20), maxRate: +(env.DEVAPI_MAX_RATE_PER_MIN || 6000),
    accessTtl: +(env.DEVAPI_ACCESS_TTL_S || 3600), refreshTtl: +(env.DEVAPI_REFRESH_TTL_S || 30 * 86400), codeTtl: 600,
    backoffMs: opts.backoffMs ?? +(env.DEVAPI_WEBHOOK_BACKOFF_MS || 30e3), maxAttempts: +(env.DEVAPI_WEBHOOK_MAX_ATTEMPTS || 6),
    timeoutMs: +(env.DEVAPI_WEBHOOK_TIMEOUT_MS || 5000), pollMs: +(env.DEVAPI_WEBHOOK_POLL_MS || 15e3),
    allowPrivate: opts.allowPrivateUrls ?? (env.DEVAPI_ALLOW_PRIVATE_URLS === "1" || env.NODE_ENV !== "production"),
    maxApps: 20, maxKeys: 20, maxHooks: 10
  };
  const rw = new L.RateWindow();
  const J = (s, d = []) => { if (Array.isArray(s) || (s && typeof s === "object")) return s; try { return JSON.parse(s); } catch { return d; } };
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const isAdmin = (u) => u?.role === "admin";
  const A = (fn) => async (req, res) => { if (!req.user) throw E.auth(); return fn(req, res); };
  const hint = (s) => s.slice(0, 8) + "…" + s.slice(-4);
  const iso = (ms) => new Date(Date.now() + ms).toISOString();

  /* ====================== route definitions → router + OpenAPI ====================== */
  const defs = [];
  /** documented API route. auth: "none" | "optional" | "token"; scope required when auth=token */
  function api(def, handler) {
    defs.push(def);
    r.add(def.method, def.path, async (req, res) => {
      cors(res);
      const who = await authenticate(req, res, def);
      return handler(req, res, who);
    }, { apiToken: true });
  }
  function cors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After, X-Request-Id");
  }
  const preflight = (req, res) => { cors(res); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type"); res.setHeader("Access-Control-Max-Age", "600"); return {}; };
  r.add("OPTIONS", "/api/v1/.+", preflight, { apiToken: true });
  r.add("OPTIONS", "/api/oauth/(token|revoke)", preflight, { apiToken: true });

  /* ====================== authentication + rate limits ====================== */
  async function authenticate(req, res, def) {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
    let who = null;
    if (m) who = await resolveToken(m[1]);
    if (m && !who) throw fail(401, "invalid_token", "الرمز غير صالح أو منتهٍ");
    if (!who && def.auth === "token") throw fail(401, "unauthorized", "يلزم مفتاح API أو رمز وصول");
    const limit = who ? who.rate : cfg.anonRate, key = who ? who.rateKey : "ip:" + req.ip;
    if (def.auth !== "none" || who) {
      const w = rw.hit(key, limit);
      res.setHeader("X-RateLimit-Limit", String(w.limit)); res.setHeader("X-RateLimit-Remaining", String(w.remaining)); res.setHeader("X-RateLimit-Reset", String(w.reset));
      if (!w.ok) { res.setHeader("Retry-After", String(w.reset)); throw fail(429, "rate_limited", "تجاوزت حدّ المعدل لهذا المفتاح"); }
    }
    if (def.scope && def.auth === "token" && !(who.scopes.includes(def.scope) || (def.scope === "write:posts" && who.scopes.includes("bot")))) throw fail(403, "insufficient_scope", "الصلاحية المطلوبة: " + def.scope);
    if (who?.kind === "key") db.run("UPDATE devapi_keys SET last_used_at=$1 WHERE id=$2", [now(), who.keyId]).catch(() => { });
    return who;
  }
  async function resolveToken(t) {
    if (typeof t !== "string" || t.length > 200) return null;
    let row, kind;
    if (t.startsWith("mpk_")) { kind = "key"; row = await db.get("SELECT a.*, k.id AS key_id, k.user_id, k.scopes AS tscopes, k.rate_limit AS krate, k.status AS kstatus FROM devapi_keys k JOIN devapi_apps a ON a.id=k.app_id WHERE k.key_hash=$1", [L.sha(t)]); if (!row || row.kstatus !== "active") return null; }
    else if (t.startsWith("mpa_")) { kind = "token"; row = await db.get("SELECT a.*, t.user_id, t.scopes AS tscopes, t.family, t.expires_at, t.revoked_at, t.kind AS tkind FROM devapi_tokens t JOIN devapi_apps a ON a.id=t.app_id WHERE t.token_hash=$1", [L.sha(t)]); if (!row || row.tkind !== "access" || row.revoked_at || new Date(row.expires_at) < new Date()) return null; }
    else return null;
    if (row.status !== "active") return null;
    const user = await db.get("SELECT * FROM users WHERE id=$1", [row.user_id]);
    if (!user || user.status !== "active") return null;
    const rate = Math.min(cfg.maxRate, row.krate || row.rate_limit || cfg.rate);
    return { kind, app: row, appId: row.id, user, scopes: J(row.tscopes), rate, keyId: row.key_id, rateKey: kind === "key" ? "k:" + row.key_id : "t:" + row.family };
  }

  /* ====================== public projections (anonymous viewer only) ====================== */
  const pubUser = (u) => u && { id: u.id, handle: u.handle, name: u.name, bio: u.bio || "", verified: !!u.verified, bot: u.role === "bot", joinedAt: u.created_at };
  const pubCommunity = (c) => c && { id: c.id, name: c.name, description: c.descr || "", topic: c.topic || null, createdAt: c.created_at };
  async function publicPosts(rows) {
    const vis = await ctx.services.content.filterVisible(rows.filter((p) => p.status === "published" && p.visibility === "public" && !(p.data || {}).paid), null);
    const ok = []; for (const p of vis) if (!(p.data || {}).paid && !p.locked) ok.push(p);
    const ids = [...new Set(ok.map((p) => p.author))];
    const authors = ids.length ? Object.fromEntries((await db.all(`SELECT * FROM users WHERE id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids)).map((u) => [u.id, u])) : {};
    return ok.map((p) => ({ id: p.id, type: p.type, title: p.title || null, text: p.text || "", topic: p.topic || null, lang: p.lang || null, community: p.community || null,
      author: pubUser(authors[p.author]), sensitive: !!p.sensitive, images: (p.data || {}).images || ((p.data || {}).media ? [p.data.media] : []), createdAt: p.created_at, updatedAt: p.updated_at || null, url: "/#/post/" + p.id }));
  }
  async function publicPost(pid) {
    const p = typeof pid === "string" && pid.length < 100 ? await db.get("SELECT * FROM posts WHERE id=$1", [pid]) : null;
    const [out] = p ? await publicPosts([p]) : [];
    if (!out) throw E.nf("المنشور غير موجود أو غير عام");
    return out;
  }
  const lim = (q, d = 20) => Math.max(1, Math.min(50, +q || d));
  const before = (q) => (q && !isNaN(new Date(q)) ? new Date(q).toISOString() : "9999-12-31T00:00:00.000Z");
  async function postsWhere(where, args, q) {
    const n = lim(q.limit), b = before(q.before);
    const rows = await db.all(`SELECT * FROM posts WHERE status='published' AND visibility='public' AND ${where} AND created_at < $${args.length + 1} ORDER BY created_at DESC LIMIT $${args.length + 2}`, [...args, b, n * 2 + 5]);
    const items = (await publicPosts(rows)).slice(0, n);
    return { items, next: items.length === n ? items[items.length - 1].createdAt : null };
  }
  async function publicCommunity(cid) {
    const c = typeof cid === "string" && cid.length < 100 ? await db.get("SELECT * FROM communities WHERE id=$1", [cid]) : null;
    if (!c || c.type !== "public") throw E.nf("المجتمع غير موجود أو غير عام");
    return c;
  }
  async function publicUser(handle) {
    const u = typeof handle === "string" && handle.length < 40 ? await db.get("SELECT * FROM users WHERE LOWER(handle)=LOWER($1)", [handle.replace(/^@/, "")]) : null;
    if (!u || u.status !== "active" || u.private || (u.prefs || {}).private) throw E.nf("الحساب غير موجود أو خاص");
    return u;
  }

  /* ====================== v1 routes ====================== */
  const PostS = { type: "object", properties: { id: { type: "string" }, type: { type: "string" }, title: { type: "string", nullable: true }, text: { type: "string" }, community: { type: "string", nullable: true }, author: { type: "object", properties: { id: { type: "string" }, handle: { type: "string" }, name: { type: "string" }, bot: { type: "boolean" } } }, createdAt: { type: "string", format: "date-time" }, url: { type: "string" } } };
  const List = (s) => ({ type: "object", properties: { items: { type: "array", items: s }, next: { type: "string", nullable: true, description: "مرّره في before للصفحة التالية" } } });
  const Page = { limit: { type: "integer", description: "1–50", default: 20 }, before: { description: "تاريخ ISO: منشورات أقدم منه" } };
  const UserS = { type: "object", properties: { id: { type: "string" }, handle: { type: "string" }, name: { type: "string" }, bio: { type: "string" }, bot: { type: "boolean" } } };
  const CommS = { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, members: { type: "integer" } } };

  api({ id: "listPosts", method: "GET", path: "/api/v1/posts", tag: "المحتوى العام", auth: "optional", summary: "أحدث المنشورات العامة", description: "بدون رمز يُطبَّق حدّ معدل منخفض لكل عنوان IP.", query: { ...Page, tag: { description: "وسم بدون #" } }, response: List(PostS) },
    async (req) => req.query.tag ? postsWhere("id IN (SELECT post_id FROM post_hashtags WHERE tag=$1)", [String(req.query.tag).replace(/^#/, "").slice(0, 60)], req.query) : postsWhere("1=1", [], req.query));
  api({ id: "getPost", method: "GET", path: "/api/v1/posts/:id", tag: "المحتوى العام", auth: "optional", summary: "منشور عام واحد", response: PostS }, async (req) => ({ post: await publicPost(req.params.id) }));
  api({ id: "listComments", method: "GET", path: "/api/v1/posts/:id/comments", tag: "المحتوى العام", auth: "optional", summary: "تعليقات منشور عام", response: List({ type: "object" }) }, async (req) => {
    const p = await publicPost(req.params.id);
    const rows = await db.all("SELECT c.id, c.text, c.parent, c.created_at, u.id AS uid, u.handle, u.name, u.role, u.bio, u.verified, u.created_at AS ucreated FROM comments c JOIN users u ON u.id=c.author WHERE c.post=$1 AND c.status='published' ORDER BY c.created_at LIMIT 200", [p.id]);
    return { items: rows.map((c) => ({ id: c.id, text: c.text, parent: c.parent || null, createdAt: c.created_at, author: pubUser({ id: c.uid, handle: c.handle, name: c.name, role: c.role, bio: c.bio, verified: c.verified, created_at: c.ucreated }) })) };
  });
  api({ id: "getUser", method: "GET", path: "/api/v1/users/:handle", tag: "المحتوى العام", auth: "optional", summary: "ملف شخصي عام", description: "الحسابات الخاصة لا تظهر.", response: UserS }, async (req) => {
    const u = await publicUser(req.params.handle);
    const f = await db.get("SELECT (SELECT COUNT(*) FROM follows WHERE dst=$1) AS followers, (SELECT COUNT(*) FROM follows WHERE src=$1) AS following", [u.id]);
    return { user: { ...pubUser(u), followers: +f.followers, following: +f.following } };
  });
  api({ id: "listUserPosts", method: "GET", path: "/api/v1/users/:handle/posts", tag: "المحتوى العام", auth: "optional", summary: "المنشورات العامة لمستخدم", query: Page, response: List(PostS) },
    async (req) => { const u = await publicUser(req.params.handle); return postsWhere("author=$1", [u.id], req.query); });
  api({ id: "listCommunities", method: "GET", path: "/api/v1/communities", tag: "المحتوى العام", auth: "optional", summary: "المجتمعات العامة", query: { limit: Page.limit }, response: List(CommS) },
    async (req) => ({ items: (await db.all("SELECT * FROM communities WHERE type='public' ORDER BY created_at DESC LIMIT $1", [lim(req.query.limit)])).map(pubCommunity) }));
  api({ id: "getCommunity", method: "GET", path: "/api/v1/communities/:id", tag: "المحتوى العام", auth: "optional", summary: "مجتمع عام", response: CommS }, async (req) => {
    const c = await publicCommunity(req.params.id);
    const n = await db.get("SELECT COUNT(*) AS n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [c.id]);
    return { community: { ...pubCommunity(c), members: +n.n } };
  });
  api({ id: "listCommunityPosts", method: "GET", path: "/api/v1/communities/:id/posts", tag: "المحتوى العام", auth: "optional", summary: "منشورات مجتمع عام", query: Page, response: List(PostS) },
    async (req) => { const c = await publicCommunity(req.params.id); return postsWhere("community=$1", [c.id], req.query); });
  api({ id: "me", method: "GET", path: "/api/v1/me", tag: "المستخدم", auth: "token", scope: "profile", summary: "صاحب الرمز (أو البوت)", response: UserS }, async (req, res, who) => ({ user: pubUser(who.user), app: { id: who.appId, name: who.app.name }, scopes: who.scopes }));

  const PostIn = { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 5000 }, title: { type: "string" }, type: { type: "string", enum: ["post", "question", "article"] }, community: { type: "string", description: "مجتمع عام أنت عضو فيه (إلزامي للبوت)" } } };
  api({ id: "createPost", method: "POST", path: "/api/v1/posts", tag: "المستخدم", auth: "token", scope: "write:posts", summary: "نشر منشور عام باسم المستخدم أو البوت", description: "المنشورات عبر الواجهة علنية دائماً. البوت ينشر فقط في مجتمع ثُبّت فيه.", body: PostIn, response: PostS }, async (req, res, who) => {
    const b = req.body || {};
    if (typeof b.text !== "string" || !b.text.trim()) throw E.bad("النص مطلوب");
    if (b.community) await publicCommunity(b.community);
    if (who.scopes.includes("bot")) { if (!b.community || !(await db.get("SELECT 1 x FROM devapi_bot_installs WHERE app_id=$1 AND community=$2", [who.appId, b.community]))) throw fail(403, "bot_not_installed", "البوت غير مثبّت في هذا المجتمع"); }
    const post = await ctx.services.content.createPost(who.user, { text: b.text, title: typeof b.title === "string" ? b.title : undefined, type: ["post", "question", "article"].includes(b.type) ? b.type : "post", community: b.community || undefined, visibility: "public" });
    await ctx.audit("DEVAPI_POST", post.id, "app " + who.appId, who.user.id);
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [post.id]);
    const [out] = await publicPosts([row]);
    return { post: out || { id: row.id, status: row.status } };
  });
  api({ id: "createComment", method: "POST", path: "/api/v1/posts/:id/comments", tag: "المستخدم", auth: "token", scope: "write:posts", summary: "التعليق على منشور عام", body: { type: "object", required: ["text"], properties: { text: { type: "string", maxLength: 2000 }, parent: { type: "string" } } } }, async (req, res, who) => {
    const p = await publicPost(req.params.id);
    if (who.scopes.includes("bot") && !(p.community && (await db.get("SELECT 1 x FROM devapi_bot_installs WHERE app_id=$1 AND community=$2", [who.appId, p.community])))) throw fail(403, "bot_not_installed", "البوت غير مثبّت في مجتمع هذا المنشور");
    const c = await ctx.services.content.comment(who.user, { post: p.id, text: req.body?.text, parent: typeof req.body?.parent === "string" ? req.body.parent : undefined });
    return { comment: { id: c.id, post: p.id, text: c.text, createdAt: c.createdAt } };
  });
  api({ id: "openapi", method: "GET", path: "/api/v1/openapi.json", tag: "عام", auth: "none", summary: "وثيقة OpenAPI 3 لهذه الواجهة" }, async () => spec());
  let specCache = null;
  const spec = () => (specCache ||= L.openapi(defs, { version: config.version }));

  /* ====================== OAuth 2.0 ====================== */
  async function appById(cid) { const a = typeof cid === "string" && cid.length < 60 ? await db.get("SELECT * FROM devapi_apps WHERE id=$1", [cid]) : null; return a && a.status === "active" ? a : null; }
  async function authRequest(q) {
    const app = await appById(q.client_id);
    if (!app) throw fail(400, "invalid_client", "التطبيق غير موجود أو موقوف");
    const uris = J(app.redirect_uris);
    if (!q.redirect_uri || !uris.includes(q.redirect_uri)) throw fail(400, "invalid_redirect_uri", "عنوان إعادة التوجيه غير مسجّل لهذا التطبيق");
    if (q.response_type && q.response_type !== "code") throw fail(400, "unsupported_response_type", "نوع الاستجابة غير مدعوم");
    if (typeof q.code_challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge) || (q.code_challenge_method || "S256") !== "S256") throw fail(400, "invalid_request", "PKCE مطلوب (S256)");
    const scopes = L.parseScopes(q.scope || "read", J(app.scopes).filter((s) => L.USER_SCOPES.includes(s)));
    if (!scopes.length) throw fail(400, "invalid_scope", "الصلاحيات المطلوبة غير مسموحة لهذا التطبيق");
    return { app, scopes, redirectUri: q.redirect_uri, state: typeof q.state === "string" ? q.state.slice(0, 500) : undefined, challenge: q.code_challenge };
  }
  r.get("/api/oauth/authorize", A(async (req) => {
    const a = await authRequest(req.query), owner = await db.get("SELECT handle, name FROM users WHERE id=$1", [a.app.owner]);
    const g = await db.get("SELECT scopes FROM devapi_grants WHERE app_id=$1 AND user_id=$2", [a.app.id, req.user.id]);
    return { app: { id: a.app.id, name: a.app.name, description: a.app.descr, homepage: a.app.homepage, owner: owner && { handle: owner.handle, name: owner.name } }, scopes: a.scopes.map((s) => ({ scope: s, label: L.SCOPES[s] })),
      redirectUri: a.redirectUri, host: new URL(a.redirectUri).host || a.redirectUri, granted: !!g && a.scopes.every((s) => J(g.scopes).includes(s)), never: ["الرسائل الخاصة والمحادثات المشفّرة", "محتوى المجتمعات الخاصة", "المنشورات غير العامة", "كلمة المرور وبيانات الدفع"] };
  }));
  r.post("/api/oauth/authorize", A(async (req) => {
    const a = await authRequest(req.body || {}), u = new URL(a.redirectUri);
    if (a.state) u.searchParams.set("state", a.state);
    if (req.body.decision !== "allow") { u.searchParams.set("error", "access_denied"); return { redirect: u.toString() }; }
    const code = L.secretToken("mpo_");
    await db.run("INSERT INTO devapi_codes(code_hash,app_id,user_id,redirect_uri,scopes,challenge,method,expires_at) VALUES($1,$2,$3,$4,$5,$6,'S256',$7)", [L.sha(code), a.app.id, req.user.id, a.redirectUri, JSON.stringify(a.scopes), a.challenge, iso(cfg.codeTtl * 1000)]);
    const t = now(), had = await db.get("SELECT scopes FROM devapi_grants WHERE app_id=$1 AND user_id=$2", [a.app.id, req.user.id]);
    const merged = L.parseScopes([...J(had?.scopes), ...a.scopes]);
    await db.run("INSERT INTO devapi_grants(app_id,user_id,scopes,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT (app_id,user_id) DO UPDATE SET scopes=$3, updated_at=$4", [a.app.id, req.user.id, JSON.stringify(merged), t]);
    if (!had) emitApp(a.app.id, "app.authorized", { user: { id: req.user.id, handle: req.user.handle }, scopes: merged });
    u.searchParams.set("code", code);
    return { redirect: u.toString() };
  }));

  function formBody(req) {
    const raw = (req.rawBody || Buffer.alloc(0)); if (raw.length > 16384) throw E.bad();
    const s = raw.toString("utf8"), ct = String(req.headers["content-type"] || "");
    if (/json/.test(ct)) { try { const o = JSON.parse(s || "{}"); return o && typeof o === "object" ? o : {}; } catch { throw E.bad("JSON غير صالح"); } }
    return Object.fromEntries(new URLSearchParams(s));
  }
  const oerr = (code, msg, status = 400) => fail(status, code, msg);
  async function clientAuth(req, b, { requireSecret }) {
    let cid = b.client_id, sec = b.client_secret;
    const basic = /^Basic\s+(\S+)$/i.exec(req.headers.authorization || "");
    if (basic) { const [u, p] = Buffer.from(basic[1], "base64").toString().split(":"); cid = decodeURIComponent(u || ""); sec = decodeURIComponent(p || ""); }
    const app = await appById(cid);
    if (!app) throw oerr("invalid_client", "عميل غير صالح", 401);
    if (sec !== undefined && sec !== "" ? L.sha(sec) !== app.secret_hash : requireSecret) throw oerr("invalid_client", "عميل غير صالح", 401);
    return app;
  }
  async function issue(app, userId, scopes, family = id("tf")) {
    const access = L.secretToken("mpa_"), refresh = scopes.includes("bot") ? null : L.secretToken("mpr_"), t = now();
    await db.run("INSERT INTO devapi_tokens(token_hash,kind,app_id,user_id,scopes,family,expires_at,created_at) VALUES($1,'access',$2,$3,$4,$5,$6,$7)", [L.sha(access), app.id, userId, JSON.stringify(scopes), family, iso(cfg.accessTtl * 1000), t]);
    if (refresh) await db.run("INSERT INTO devapi_tokens(token_hash,kind,app_id,user_id,scopes,family,expires_at,created_at) VALUES($1,'refresh',$2,$3,$4,$5,$6,$7)", [L.sha(refresh), app.id, userId, JSON.stringify(scopes), family, iso(cfg.refreshTtl * 1000), t]);
    return { access_token: access, token_type: "Bearer", expires_in: cfg.accessTtl, scope: scopes.join(" "), ...(refresh ? { refresh_token: refresh } : {}) };
  }
  const revokeFamily = (fam) => db.run("UPDATE devapi_tokens SET revoked_at=$1 WHERE family=$2 AND revoked_at IS NULL", [now(), fam]);
  api({ id: "token", method: "POST", path: "/api/oauth/token", tag: "OAuth", auth: "none", form: true, summary: "تبادل الرمز (authorization_code + PKCE) أو التجديد (refresh_token) أو client_credentials للبوت",
    body: { type: "object", required: ["grant_type", "client_id"], properties: { grant_type: { type: "string", enum: ["authorization_code", "refresh_token", "client_credentials"] }, client_id: { type: "string" }, client_secret: { type: "string" }, code: { type: "string" }, redirect_uri: { type: "string" }, code_verifier: { type: "string" }, refresh_token: { type: "string" } } } }, async (req, res) => {
    res.setHeader("Pragma", "no-cache");
    const b = formBody(req);
    if (!ctx.rl.hit("devapi_token", req.ip)) throw fail(429, "rate_limited", "محاولات كثيرة");
    if (b.grant_type === "authorization_code") {
      const app = await clientAuth(req, b, { requireSecret: false });
      const row = typeof b.code === "string" ? await db.get("SELECT * FROM devapi_codes WHERE code_hash=$1", [L.sha(b.code)]) : null;
      if (!row || row.app_id !== app.id) throw oerr("invalid_grant", "الرمز غير صالح");
      if (row.used) { await db.run("UPDATE devapi_tokens SET revoked_at=$1 WHERE family=$2 AND revoked_at IS NULL", [now(), "code:" + row.code_hash]); throw oerr("invalid_grant", "استُخدم الرمز من قبل"); }
      const claimed = await db.run("UPDATE devapi_codes SET used=1 WHERE code_hash=$1 AND used=0", [row.code_hash]);
      if (!claimed.changes) throw oerr("invalid_grant", "استُخدم الرمز من قبل");
      if (new Date(row.expires_at) < new Date() || row.redirect_uri !== b.redirect_uri || !L.pkceOk(b.code_verifier, row.challenge, row.method)) throw oerr("invalid_grant", "الرمز منتهٍ أو PKCE غير مطابق");
      const g = await db.get("SELECT 1 x FROM devapi_grants WHERE app_id=$1 AND user_id=$2", [app.id, row.user_id]);
      if (!g) throw oerr("invalid_grant", "سُحبت الموافقة");
      return issue(app, row.user_id, J(row.scopes), "code:" + row.code_hash);
    }
    if (b.grant_type === "refresh_token") {
      const app = await clientAuth(req, b, { requireSecret: false });
      const row = typeof b.refresh_token === "string" ? await db.get("SELECT * FROM devapi_tokens WHERE token_hash=$1 AND kind='refresh'", [L.sha(b.refresh_token)]) : null;
      if (!row || row.app_id !== app.id) throw oerr("invalid_grant", "رمز التجديد غير صالح");
      if (row.revoked_at) { await revokeFamily(row.family); throw oerr("invalid_grant", "رمز التجديد مستخدم أو مسحوب"); } // reuse → whole family revoked
      if (new Date(row.expires_at) < new Date()) throw oerr("invalid_grant", "انتهى رمز التجديد");
      if (!(await db.get("SELECT 1 x FROM devapi_grants WHERE app_id=$1 AND user_id=$2", [app.id, row.user_id]))) throw oerr("invalid_grant", "سُحبت الموافقة");
      const claimed = await db.run("UPDATE devapi_tokens SET revoked_at=$1 WHERE token_hash=$2 AND revoked_at IS NULL", [now(), row.token_hash]);
      if (!claimed.changes) { await revokeFamily(row.family); throw oerr("invalid_grant", "رمز التجديد مستخدم"); }
      return issue(app, row.user_id, J(row.scopes), row.family);
    }
    if (b.grant_type === "client_credentials") {
      const app = await clientAuth(req, b, { requireSecret: true });
      if (!app.bot_user) throw oerr("unauthorized_client", "لا يملك التطبيق حساب بوت");
      return issue(app, app.bot_user, ["bot", "read", "profile"], id("tb"));
    }
    throw oerr("unsupported_grant_type", "نوع المنح غير مدعوم");
  });
  api({ id: "revoke", method: "POST", path: "/api/oauth/revoke", tag: "OAuth", auth: "none", form: true, summary: "سحب رمز وصول أو تجديد (RFC 7009)", body: { type: "object", required: ["token", "client_id"], properties: { token: { type: "string" }, client_id: { type: "string" }, client_secret: { type: "string" } } } }, async (req) => {
    const b = formBody(req), app = await clientAuth(req, b, { requireSecret: false });
    const row = typeof b.token === "string" ? await db.get("SELECT * FROM devapi_tokens WHERE token_hash=$1", [L.sha(b.token)]) : null;
    if (row && row.app_id === app.id) await revokeFamily(row.family);
    return { ok: true };
  });
  // the form/JSON token endpoints read the body themselves (third parties send x-www-form-urlencoded)
  for (const rt of r.routes) if (rt.opts.apiToken && rt.method === "POST" && /oauth/.test(String(rt.re))) rt.opts.raw = true;

  /** GET /oauth/authorize (what third-party apps link to) → the SPA consent screen */
  async function ssr(req, res, url) {
    if (url.pathname !== "/oauth/authorize") return false;
    res.writeHead(302, { Location: "/#/oauth?" + url.searchParams.toString(), "Cache-Control": "no-store" }); res.end();
    return true;
  }

  /* ====================== developer portal (session) ====================== */
  async function myApp(user, aid) {
    const a = typeof aid === "string" ? await db.get("SELECT * FROM devapi_apps WHERE id=$1", [aid]) : null;
    if (!a || (a.owner !== user.id && !isAdmin(user))) throw E.nf("التطبيق غير موجود");
    return a;
  }
  const appOut = async (a, full) => {
    const out = { id: a.id, clientId: a.id, name: a.name, description: a.descr || "", homepage: a.homepage || null, redirectUris: J(a.redirect_uris), scopes: J(a.scopes), status: a.status,
      rateLimit: a.rate_limit || cfg.rate, secretHint: a.secret_hint, commands: J(a.commands), createdAt: a.created_at, owner: a.owner };
    if (a.bot_user) { const b = await db.get("SELECT id, handle, name FROM users WHERE id=$1", [a.bot_user]); out.bot = b && { id: b.id, handle: b.handle, name: b.name }; }
    if (full) {
      out.keys = (await db.all("SELECT id, name, hint, scopes, rate_limit, status, last_used_at, created_at FROM devapi_keys WHERE app_id=$1 ORDER BY created_at DESC", [a.id])).map((k) => ({ id: k.id, name: k.name, hint: k.hint, scopes: J(k.scopes), rateLimit: k.rate_limit || out.rateLimit, status: k.status, lastUsedAt: k.last_used_at, createdAt: k.created_at }));
      out.webhooks = (await db.all("SELECT id, url, events, status, created_at FROM devapi_webhooks WHERE app_id=$1 ORDER BY created_at", [a.id])).map((w) => ({ id: w.id, url: w.url, events: J(w.events), status: w.status, createdAt: w.created_at }));
      out.installs = (await db.all("SELECT i.community, c.name, i.created_at FROM devapi_bot_installs i JOIN communities c ON c.id=i.community WHERE i.app_id=$1", [a.id])).map((i) => ({ community: i.community, name: i.name, installedAt: i.created_at }));
      out.users = +(await db.get("SELECT COUNT(*) AS n FROM devapi_grants WHERE app_id=$1", [a.id])).n;
    }
    return out;
  };
  function cleanUris(v) {
    const list = (Array.isArray(v) ? v : []).slice(0, 10).map((u) => L.checkUrl(u, { allowPrivate: cfg.allowPrivate, allowCustomScheme: true }));
    if (list.some((x) => !x)) throw E.bad("عنوان إعادة توجيه غير صالح (https أو مخطط تطبيق مخصص)");
    return [...new Set(list)];
  }
  const cleanScopes = (v) => { const s = L.parseScopes(v || ["read"], L.USER_SCOPES); return s.length ? s : ["read"]; };
  function cleanCommands(v) {
    return (Array.isArray(v) ? v : []).slice(0, 25).map((c) => ({ name: String(c?.name || "").replace(/^\//, "").toLowerCase(), description: str(c?.description, 100) || "" }))
      .filter((c) => /^[a-z0-9_\u0600-\u06ff]{1,32}$/.test(c.name));
  }
  r.get("/api/dev/meta", async () => ({ scopes: L.SCOPES, userScopes: L.USER_SCOPES, events: L.EVENTS, defaultRate: cfg.rate, anonRate: cfg.anonRate, docs: "/api/v1/openapi.json" }));
  r.get("/api/dev/apps", A(async (req) => {
    const all = req.query.all === "1" && isAdmin(req.user);
    const rows = await db.all(all ? "SELECT * FROM devapi_apps ORDER BY created_at DESC LIMIT 500" : "SELECT * FROM devapi_apps WHERE owner=$1 AND status<>'revoked' ORDER BY created_at DESC", all ? [] : [req.user.id]);
    return { apps: await Promise.all(rows.map((a) => appOut(a))) };
  }));
  r.post("/api/dev/apps", A(async (req) => {
    const b = req.body;
    if (!ctx.rl.hit("devapi_app", req.user.id)) throw E.rate();
    if (+(await db.get("SELECT COUNT(*) AS n FROM devapi_apps WHERE owner=$1 AND status<>'revoked'", [req.user.id])).n >= cfg.maxApps) throw E.conflict("بلغت الحد الأقصى للتطبيقات");
    const homepage = b.homepage ? L.checkUrl(b.homepage, { allowPrivate: cfg.allowPrivate }) : null;
    if (b.homepage && !homepage) throw E.bad("رابط الموقع غير صالح");
    const secret = L.secretToken("mps_"), t = now(), aid = id("ap");
    await db.run("INSERT INTO devapi_apps(id,owner,name,descr,homepage,redirect_uris,scopes,secret_hash,secret_hint,status,commands,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','[]',$10,$10)",
      [aid, req.user.id, str(b.name, 60, { required: true, min: 2 }), str(b.description, 300) || "", homepage, JSON.stringify(cleanUris(b.redirectUris)), JSON.stringify(cleanScopes(b.scopes)), L.sha(secret), hint(secret), t]);
    await ctx.audit("DEVAPI_APP_CREATED", aid, null, req.user.id);
    return { app: await appOut(await db.get("SELECT * FROM devapi_apps WHERE id=$1", [aid]), true), clientSecret: secret, note: "احفظ السر الآن؛ لن يظهر مرة أخرى" };
  }));
  r.get("/api/dev/apps/:id", A(async (req) => ({ app: await appOut(await myApp(req.user, req.params.id), true) })));
  r.patch("/api/dev/apps/:id", A(async (req) => {
    const a = await myApp(req.user, req.params.id), b = req.body, set = [], args = [];
    const put = (col, v) => { args.push(v); set.push(`${col}=$${args.length}`); };
    if (b.name !== undefined) put("name", str(b.name, 60, { required: true, min: 2 }));
    if (b.description !== undefined) put("descr", str(b.description, 300) || "");
    if (b.homepage !== undefined) { const h = b.homepage ? L.checkUrl(b.homepage, { allowPrivate: cfg.allowPrivate }) : null; if (b.homepage && !h) throw E.bad("رابط الموقع غير صالح"); put("homepage", h); }
    if (b.redirectUris !== undefined) put("redirect_uris", JSON.stringify(cleanUris(b.redirectUris)));
    if (b.scopes !== undefined) put("scopes", JSON.stringify(cleanScopes(b.scopes)));
    if (b.commands !== undefined) put("commands", JSON.stringify(cleanCommands(b.commands)));
    put("updated_at", now()); args.push(a.id);
    await db.run(`UPDATE devapi_apps SET ${set.join(",")} WHERE id=$${args.length}`, args);
    return { app: await appOut(await db.get("SELECT * FROM devapi_apps WHERE id=$1", [a.id]), true) };
  }));
  r.post("/api/dev/apps/:id/secret", A(async (req) => {
    const a = await myApp(req.user, req.params.id), secret = L.secretToken("mps_");
    await db.run("UPDATE devapi_apps SET secret_hash=$1, secret_hint=$2, updated_at=$3 WHERE id=$4", [L.sha(secret), hint(secret), now(), a.id]);
    await ctx.audit("DEVAPI_SECRET_ROTATED", a.id, null, req.user.id);
    return { clientSecret: secret, note: "احفظ السر الآن؛ لن يظهر مرة أخرى" };
  }));
  r.del("/api/dev/apps/:id", A(async (req) => {
    const a = await myApp(req.user, req.params.id), t = now();
    await db.run("UPDATE devapi_apps SET status='revoked', updated_at=$1 WHERE id=$2", [t, a.id]);
    await db.run("UPDATE devapi_keys SET status='revoked', revoked_at=$1 WHERE app_id=$2 AND status='active'", [t, a.id]);
    await db.run("UPDATE devapi_tokens SET revoked_at=$1 WHERE app_id=$2 AND revoked_at IS NULL", [t, a.id]);
    await db.run("UPDATE devapi_webhooks SET status='disabled' WHERE app_id=$1", [a.id]);
    await db.run("DELETE FROM devapi_bot_installs WHERE app_id=$1", [a.id]);
    await ctx.audit("DEVAPI_APP_REVOKED", a.id, null, req.user.id);
    return { ok: true };
  }));
  /* API keys: act as the key's creator (the app owner), scopes ⊆ app scopes; hashed, shown once */
  r.post("/api/dev/apps/:id/keys", A(async (req) => {
    const a = await myApp(req.user, req.params.id);
    if (a.status !== "active") throw E.conflict("التطبيق غير نشط");
    if (+(await db.get("SELECT COUNT(*) AS n FROM devapi_keys WHERE app_id=$1 AND status='active'", [a.id])).n >= cfg.maxKeys) throw E.conflict("بلغت الحد الأقصى للمفاتيح");
    const key = L.secretToken("mpk_"), kid = id("ak"), scopes = L.parseScopes(req.body.scopes || ["read"], J(a.scopes));
    const rate = req.body.rateLimit ? Math.max(1, Math.min(a.rate_limit || cfg.rate, +req.body.rateLimit || 0)) : null;
    await db.run("INSERT INTO devapi_keys(id,app_id,user_id,name,key_hash,hint,scopes,rate_limit,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)", [kid, a.id, a.owner, str(req.body.name, 40) || "مفتاح", L.sha(key), hint(key), JSON.stringify(scopes.length ? scopes : ["read"]), rate, now()]);
    await ctx.audit("DEVAPI_KEY_CREATED", kid, a.id, req.user.id);
    return { id: kid, key, scopes: scopes.length ? scopes : ["read"], note: "احفظ المفتاح الآن؛ لن يظهر مرة أخرى" };
  }));
  async function myKey(user, kid) { const k = await db.get("SELECT * FROM devapi_keys WHERE id=$1", [kid]); if (!k) throw E.nf(); await myApp(user, k.app_id); return k; }
  r.post("/api/dev/keys/:id/rotate", A(async (req) => {
    const k = await myKey(req.user, req.params.id);
    if (k.status !== "active") throw E.conflict("المفتاح مسحوب");
    const key = L.secretToken("mpk_");
    await db.run("UPDATE devapi_keys SET key_hash=$1, hint=$2 WHERE id=$3", [L.sha(key), hint(key), k.id]);
    await ctx.audit("DEVAPI_KEY_ROTATED", k.id, k.app_id, req.user.id);
    return { id: k.id, key, note: "احفظ المفتاح الآن؛ لن يظهر مرة أخرى" };
  }));
  r.del("/api/dev/keys/:id", A(async (req) => {
    const k = await myKey(req.user, req.params.id);
    await db.run("UPDATE devapi_keys SET status='revoked', revoked_at=$1 WHERE id=$2", [now(), k.id]);
    await ctx.audit("DEVAPI_KEY_REVOKED", k.id, k.app_id, req.user.id);
    return { ok: true };
  }));
  /* webhooks */
  r.post("/api/dev/apps/:id/webhooks", A(async (req) => {
    const a = await myApp(req.user, req.params.id);
    const url = L.checkUrl(req.body.url, { allowPrivate: cfg.allowPrivate });
    if (!url) throw E.bad("رابط Webhook غير صالح (https وعنوان عام)");
    const events = (Array.isArray(req.body.events) ? req.body.events : []).filter((e) => L.EVENTS[e]);
    if (!events.length) throw E.bad("اختر حدثاً واحداً على الأقل");
    if (+(await db.get("SELECT COUNT(*) AS n FROM devapi_webhooks WHERE app_id=$1", [a.id])).n >= cfg.maxHooks) throw E.conflict("بلغت الحد الأقصى");
    const secret = L.secretToken("whsec_"), wid = id("wh");
    await db.run("INSERT INTO devapi_webhooks(id,app_id,url,secret,events,status,created_at) VALUES($1,$2,$3,$4,$5,'active',$6)", [wid, a.id, url, secret, JSON.stringify([...new Set(events)]), now()]);
    return { webhook: { id: wid, url, events }, secret, note: "سرّ التوقيع يظهر مرة واحدة" };
  }));
  async function myHook(user, wid) { const w = await db.get("SELECT * FROM devapi_webhooks WHERE id=$1", [wid]); if (!w) throw E.nf(); await myApp(user, w.app_id); return w; }
  r.del("/api/dev/webhooks/:id", A(async (req) => { const w = await myHook(req.user, req.params.id); await db.run("DELETE FROM devapi_webhooks WHERE id=$1", [w.id]); return { ok: true }; }));
  r.post("/api/dev/webhooks/:id/test", A(async (req) => { const w = await myHook(req.user, req.params.id); const d = await enqueue(w, "ping", { app: w.app_id }); return { delivery: d }; }));
  r.get("/api/dev/apps/:id/deliveries", A(async (req) => {
    const a = await myApp(req.user, req.params.id);
    const rows = await db.all("SELECT id, webhook_id, event, status, attempts, next_at, last_code, last_error, created_at, delivered_at FROM devapi_deliveries WHERE app_id=$1 ORDER BY created_at DESC LIMIT 100", [a.id]);
    return { items: rows.map((d) => ({ id: d.id, webhook: d.webhook_id, event: d.event, status: d.status, attempts: d.attempts, nextAt: d.next_at, lastCode: d.last_code, lastError: d.last_error, createdAt: d.created_at, deliveredAt: d.delivered_at })) };
  }));
  r.post("/api/dev/deliveries/:id/retry", A(async (req) => {
    const d = await db.get("SELECT * FROM devapi_deliveries WHERE id=$1", [req.params.id]); if (!d) throw E.nf(); await myApp(req.user, d.app_id);
    await db.run("UPDATE devapi_deliveries SET status='pending', next_at=$1, attempts=0 WHERE id=$2", [now(), d.id]);
    setImmediate(() => attempt(d.id).catch(() => { }));
    return { ok: true };
  }));
  /* bots */
  r.post("/api/dev/apps/:id/bot", A(async (req) => {
    const a = await myApp(req.user, req.params.id);
    if (a.bot_user) throw E.conflict("للتطبيق بوت بالفعل");
    const handle = str(req.body.handle, 24, { required: true });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(handle) || !/bot$/i.test(handle)) throw E.bad("معرّف البوت: حروف إنجليزية وأرقام و _ وينتهي بـ bot");
    if (await db.get("SELECT 1 x FROM users WHERE LOWER(handle)=LOWER($1)", [handle])) throw E.conflict("المعرّف محجوز");
    const u = await ctx.services.users.createUser({ name: str(req.body.name, 50) || a.name, handle });
    await db.run("UPDATE users SET role='bot', bio=$1 WHERE id=$2", ["بوت تطبيق «" + a.name + "»", u.id]);
    await db.run("UPDATE devapi_apps SET bot_user=$1, updated_at=$2 WHERE id=$3", [u.id, now(), a.id]);
    await ctx.audit("DEVAPI_BOT_CREATED", u.id, a.id, req.user.id);
    return { bot: { id: u.id, handle, name: u.name } };
  }));
  r.post("/api/dev/apps/:id/installs", A(async (req) => { // community owner/admin installs another developer's bot by client id
    const a = await appById(req.params.id); if (!a || !a.bot_user) throw E.nf("لا يوجد بوت لهذا التطبيق");
    const c = await db.get("SELECT * FROM communities WHERE id=$1", [req.body.community]);
    if (!c) throw E.nf("المجتمع غير موجود");
    if (c.type !== "public") throw fail(409, "private_community", "تُثبَّت البوتات في المجتمعات العامة فقط");
    const role = await ctx.services.content.role(c.id, req.user.id);
    if (!["owner", "admin"].includes(role) && !isAdmin(req.user)) throw E.forbid("للمالك أو المشرف العام للمجتمع فقط");
    const t = now();
    await db.run("INSERT INTO devapi_bot_installs(app_id,community,installed_by,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [a.id, c.id, req.user.id, t]);
    await db.run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING", [c.id, a.bot_user, t]);
    await ctx.audit("DEVAPI_BOT_INSTALLED", c.id, a.id, req.user.id);
    return { ok: true };
  }));
  r.del("/api/dev/apps/:id/installs/:community", A(async (req) => {
    const a = await db.get("SELECT * FROM devapi_apps WHERE id=$1", [req.params.id]); if (!a) throw E.nf();
    const role = await ctx.services.content.role(req.params.community, req.user.id);
    if (!["owner", "admin"].includes(role) && !isAdmin(req.user) && a.owner !== req.user.id) throw E.forbid();
    await db.run("DELETE FROM devapi_bot_installs WHERE app_id=$1 AND community=$2", [a.id, req.params.community]);
    if (a.bot_user) await db.run("DELETE FROM memberships WHERE community=$1 AND user_id=$2", [req.params.community, a.bot_user]);
    return { ok: true };
  }));
  r.get("/api/dev/communities/:id/bots", A(async (req) => ({ bots: (await db.all("SELECT a.id, a.name, a.commands, u.handle FROM devapi_bot_installs i JOIN devapi_apps a ON a.id=i.app_id LEFT JOIN users u ON u.id=a.bot_user WHERE i.community=$1", [req.params.id])).map((b) => ({ app: b.id, name: b.name, handle: b.handle, commands: J(b.commands) })) })));
  /* the signed-in user's connected apps */
  r.get("/api/dev/connections", A(async (req) => ({ items: (await db.all("SELECT g.app_id, g.scopes, g.updated_at, a.name, a.homepage FROM devapi_grants g JOIN devapi_apps a ON a.id=g.app_id WHERE g.user_id=$1 ORDER BY g.updated_at DESC", [req.user.id]))
    .map((g) => ({ app: g.app_id, name: g.name, homepage: g.homepage, scopes: J(g.scopes).map((s) => ({ scope: s, label: L.SCOPES[s] })), grantedAt: g.updated_at })) })));
  r.del("/api/dev/connections/:app", A(async (req) => {
    const g = await db.get("SELECT 1 x FROM devapi_grants WHERE app_id=$1 AND user_id=$2", [req.params.app, req.user.id]);
    await db.run("DELETE FROM devapi_grants WHERE app_id=$1 AND user_id=$2", [req.params.app, req.user.id]);
    await db.run("UPDATE devapi_tokens SET revoked_at=$1 WHERE app_id=$2 AND user_id=$3 AND revoked_at IS NULL", [now(), req.params.app, req.user.id]);
    if (g) emitApp(req.params.app, "app.revoked", { user: { id: req.user.id, handle: req.user.handle } });
    return { ok: true };
  }));
  /* admin */
  const admin = (fn) => A(async (req, res) => { if (!isAdmin(req.user)) throw E.forbid("للإدارة فقط"); return fn(req, res); });
  r.post("/api/admin/devapi/apps/:id", admin(async (req) => {
    const a = await db.get("SELECT * FROM devapi_apps WHERE id=$1", [req.params.id]); if (!a) throw E.nf();
    if (req.body.status && ["active", "suspended"].includes(req.body.status) && a.status !== "revoked") await db.run("UPDATE devapi_apps SET status=$1, updated_at=$2 WHERE id=$3", [req.body.status, now(), a.id]);
    if (req.body.rateLimit !== undefined) await db.run("UPDATE devapi_apps SET rate_limit=$1 WHERE id=$2", [req.body.rateLimit ? Math.max(1, Math.min(cfg.maxRate, +req.body.rateLimit || cfg.rate)) : null, a.id]);
    await ctx.audit("DEVAPI_ADMIN", a.id, JSON.stringify({ status: req.body.status, rateLimit: req.body.rateLimit }), req.user.id);
    return { app: await appOut(await db.get("SELECT * FROM devapi_apps WHERE id=$1", [a.id])) };
  }));
  r.get("/api/admin/devapi/stats", admin(async () => {
    const q = async (s) => +(await db.get(s)).n;
    return { apps: await q("SELECT COUNT(*) AS n FROM devapi_apps WHERE status='active'"), keys: await q("SELECT COUNT(*) AS n FROM devapi_keys WHERE status='active'"), grants: await q("SELECT COUNT(*) AS n FROM devapi_grants"),
      pending: await q("SELECT COUNT(*) AS n FROM devapi_deliveries WHERE status='pending'"), failed: await q("SELECT COUNT(*) AS n FROM devapi_deliveries WHERE status='failed'") };
  }));

  /* ====================== webhooks: enqueue, sign, deliver, retry ====================== */
  async function enqueue(w, event, data) {
    const did = id("dl"), body = JSON.stringify({ id: did, event, createdAt: now(), data });
    await db.run("INSERT INTO devapi_deliveries(id,webhook_id,app_id,event,body,status,attempts,next_at,created_at) VALUES($1,$2,$3,$4,$5,'pending',0,$6,$6)", [did, w.id, w.app_id, event, body, now()]);
    setImmediate(() => attempt(did).catch(() => { }));
    return did;
  }
  async function fanout(event, data, appId) {
    const hooks = await db.all(`SELECT w.* FROM devapi_webhooks w JOIN devapi_apps a ON a.id=w.app_id WHERE w.status='active' AND a.status='active'${appId ? " AND w.app_id=$1" : ""}`, appId ? [appId] : []);
    for (const w of hooks) if (J(w.events).includes(event)) await enqueue(w, event, data);
  }
  const emitApp = (appId, event, data) => fanout(event, data, appId).catch((e) => log.error("devapi fanout failed", { err: e }));
  const inflight = new Set();
  async function attempt(did) {
    if (inflight.has(did)) return; inflight.add(did);
    try {
      const d = await db.get("SELECT d.*, w.url, w.secret, w.status AS wstatus FROM devapi_deliveries d JOIN devapi_webhooks w ON w.id=d.webhook_id WHERE d.id=$1", [did]);
      if (!d || d.status !== "pending") return;
      const n = d.attempts + 1, ts = Math.floor(Date.now() / 1000);
      let code = null, err = null;
      if (d.wstatus !== "active") err = "webhook disabled";
      else if (!L.checkUrl(d.url, { allowPrivate: cfg.allowPrivate })) err = "url not allowed";
      else {
        try {
          const res = await fetch(d.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(cfg.timeoutMs), body: d.body,
            headers: { "Content-Type": "application/json", "User-Agent": "Mujtama-Webhooks/1", "X-Mujtama-Event": d.event, "X-Mujtama-Delivery": d.id, "X-Mujtama-Signature": `t=${ts},v1=${L.sign(d.secret, ts, d.body)}` } });
          code = res.status; await res.arrayBuffer().catch(() => null);
          if (code < 200 || code >= 300) err = "HTTP " + code;
        } catch (e) { err = String(e?.name === "TimeoutError" ? "timeout" : e?.cause?.code || e?.message || e).slice(0, 200); }
      }
      if (!err) await db.run("UPDATE devapi_deliveries SET status='ok', attempts=$1, last_code=$2, last_error=NULL, delivered_at=$3, next_at=NULL WHERE id=$4", [n, code, now(), did]);
      else if (n >= cfg.maxAttempts || d.wstatus !== "active") await db.run("UPDATE devapi_deliveries SET status='failed', attempts=$1, last_code=$2, last_error=$3, next_at=NULL WHERE id=$4", [n, code, err, did]);
      else await db.run("UPDATE devapi_deliveries SET attempts=$1, last_code=$2, last_error=$3, next_at=$4 WHERE id=$5", [n, code, err, iso(L.backoff(n, cfg.backoffMs)), did]);
    } finally { inflight.delete(did); }
  }
  async function deliverDue(limit = 50) {
    const rows = await db.all("SELECT id FROM devapi_deliveries WHERE status='pending' AND next_at <= $1 ORDER BY next_at LIMIT $2", [now(), limit]);
    for (const x of rows) await attempt(x.id);
    return rows.length;
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("devapi.webhooks", cfg.pollMs, () => deliverDue());

  /* ====================== events → webhooks (public content only) ====================== */
  const seen = new Map(); // de-dupe POST_PUBLISHED re-emits (automod precheck, approvals)
  const once = (k) => { if (seen.has(k)) return false; seen.set(k, 1); if (seen.size > 5000) seen.delete(seen.keys().next().value); return true; };
  async function botsFor(communityId) {
    if (!communityId) return [];
    const c = await db.get("SELECT type FROM communities WHERE id=$1", [communityId]);
    if (!c || c.type !== "public") return []; // never relay private-community content, even if a bot was installed before the community changed type
    return db.all("SELECT a.id, a.commands, a.bot_user, u.handle FROM devapi_bot_installs i JOIN devapi_apps a ON a.id=i.app_id JOIN users u ON u.id=a.bot_user WHERE i.community=$1 AND a.status='active'", [communityId]);
  }
  async function botEvents(text, communityId, authorId, ref) {
    const bots = await botsFor(communityId); if (!bots.length) return;
    const author = await db.get("SELECT * FROM users WHERE id=$1", [authorId]);
    const t = String(text || "").trim(), m = /^\/([a-z0-9_\u0600-\u06ff]{1,32})(?:\s+([\s\S]*))?$/i.exec(t), mentions = Classifier.mentions(t).map((h) => h.toLowerCase());
    for (const b of bots) {
      if (b.bot_user === authorId) continue;
      const base = { community: communityId, ...ref, author: pubUser(author), text: t.slice(0, 2000) };
      if (m && J(b.commands).some((c) => c.name === m[1].toLowerCase())) await fanout("bot.command", { ...base, command: m[1].toLowerCase(), args: (m[2] || "").trim().slice(0, 1000) }, b.id);
      else if (mentions.includes(String(b.handle).toLowerCase())) await fanout("bot.mention", base, b.id);
    }
  }
  bus.on("POST_PUBLISHED", async (e) => {
    const row = e?.post?.id ? await db.get("SELECT * FROM posts WHERE id=$1", [e.post.id]) : null;
    if (!row || !once("p:" + row.id)) return;
    const [p] = await publicPosts([row]);
    if (!p) return; // not public → no app ever hears about it
    await fanout("post.created", { post: p });
    await botEvents(row.text, row.community, row.author, { post: row.id });
  });
  bus.on("COMMENT_CREATED", async (e) => {
    const c = e?.comment ? await db.get("SELECT * FROM comments WHERE id=$1", [e.comment]) : null;
    if (!c || !once("c:" + c.id)) return;
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [c.post]);
    const [p] = row ? await publicPosts([row]) : [];
    if (!p) return;
    const author = await db.get("SELECT * FROM users WHERE id=$1", [c.author]);
    await fanout("comment.created", { comment: { id: c.id, post: c.post, parent: c.parent || null, text: c.text, author: pubUser(author), createdAt: c.created_at } });
    await botEvents(c.text, row.community, c.author, { post: row.id, comment: c.id });
  });

  return { spec, deliverDue, attempt, ssr, resolveToken, publicPosts, cfg, defs };
};
