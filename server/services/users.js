/* User Service + Social Graph: accounts, sessions, Pi authentication, profiles, preferences, follows. */
const { E, str, id, hashPassword, verifyPassword, token, sha, now } = require("../lib/core");
const COLORS = ["#5b2bd6", "#e0559b", "#1f9d8b", "#e88b2a", "#3478f6", "#9b51e0", "#2fa84f", "#d6453a", "#00a3c4", "#7a5af8"];
const SESSION_DAYS = 30;
const HANDLE = /^[a-zA-Z0-9_]{3,24}$/;

module.exports = (ctx) => {
  const { db, bus, rl, config } = ctx;
  const Sessions = require("../repos/sessions")(db);
  const pub = (u) => u && ({ id: u.id, name: u.name, handle: u.handle, bio: u.bio || "", color: u.color, badge: u.badge, creator: !!u.badge, topics: (u.prefs && u.prefs.interests) || [], joinedAt: u.created_at, pinned: u.pinned, role: u.role === "admin" ? "admin" : undefined,
    avatar: u.avatar || null, cover: u.cover || null, verified: u.verified || null, accountType: u.account_type || "person", private: !!u.private, reputation: u.reputation || 0 });

  async function sessionFor(res, user, req, { mfa = false } = {}) {
    const t = token(), sid = require("node:crypto").randomBytes(9).toString("base64url");
    await Sessions.create({ tokenHash: sha(t), userId: user.id, ip: req.ip, ua: (req.headers["user-agent"] || "").slice(0, 200), expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), sid, mfa });
    ctx.services.identity?.stashCurrent(req, res);
    res.cookie("mp_session", t, { maxAge: SESSION_DAYS * 86400 });
    ctx.services.security?.noteDevice(user, req).catch(() => { });
    return t;
  }
  async function resolve(req) {
    const t = req.cookies.mp_session || (req.headers.authorization || "").replace(/^Bearer /, "");
    if (!t) return null;
    const row = await Sessions.userByToken(t);
    if (!row || row.status !== "active") return null;
    if (row.session_sid && (!row.session_seen || Date.now() - new Date(row.session_seen) > 5 * 60e3)) Sessions.touch(row.session_sid).catch(() => {});
    if (row.role === "admin" || row.role === "moderator") return (await ctx.services.security?.gate?.(row)) || row; // v2.79: staff 2FA policy
    return row;
  }
  /* Admin bootstrap (v2.51). Before: whoever registered while no admin existed became admin — so after the last admin was
   * deleted or demoted, the NEXT stranger to sign up took over the platform (and two parallel sign-ups on a fresh DB could both
   * win). Now only the very first real account ever (demo seed accounts u_demo* do not count) becomes admin, decided by one
   * conditional UPDATE: it promotes this account only if no admin exists AND no other real account was created before it
   * (ties broken by id), so exactly one account can ever win, and never once real accounts exist. Existing admins are untouched.
   * A lost admin is restored by an operator (DB or ADMIN_BOOTSTRAP_HANDLE below), never by a sign-up.
   * ADMIN_BOOTSTRAP_HANDLE=<handle> (optional env): that handle becomes admin when it registers, only while no admin exists. */
  async function createUser({ name, handle, password, piUid }) {
    const u = { id: id("u"), handle, name, color: COLORS[Math.floor(Math.random() * COLORS.length)], created_at: now() };
    await db.run("INSERT INTO users(id,handle,name,color,role,password_hash,pi_uid,prefs,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [u.id, handle, name, u.color, "user", password ? hashPassword(password) : null, piUid || null, { onboarded: false, interests: [] }, u.created_at]);
    if (!config.seedOnly) {
      await db.run(`UPDATE users SET role='admin' WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM users a WHERE a.role='admin')
        AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id<>$1 AND SUBSTR(o.id,1,6)<>'u_demo' AND (o.created_at < $2 OR (o.created_at = $2 AND o.id < $1)))`, [u.id, u.created_at]);
      const boot = String(process.env.ADMIN_BOOTSTRAP_HANDLE || "").trim();
      if (boot && boot.toLowerCase() === String(handle).toLowerCase())
        await db.run("UPDATE users SET role='admin' WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM users a WHERE a.role='admin')", [u.id]);
    }
    const row = await db.get("SELECT * FROM users WHERE id=$1", [u.id]);
    if (row.role === "admin") ctx.audit?.("admin_bootstrap", row.id, "first account", row.id);
    bus.emit("USER_REGISTERED", { user: row.id });
    return row;
  }

  async function register(req, res) {
    if (!rl.hit("register", req.ip)) throw E.rate();
    const name = str(req.body.name, 50, { required: true, min: 2 }), handle = str(req.body.handle, 24, { required: true });
    const password = req.body.password;
    if (!HANDLE.test(handle)) throw E.bad("اسم المستخدم: حروف إنجليزية وأرقام و _ فقط (٣-٢٤)");
    if (typeof password !== "string" || password.length < 8 || password.length > 200) throw E.bad("كلمة المرور 8 أحرف على الأقل");
    if (await db.get("SELECT 1 x FROM users WHERE LOWER(handle)=LOWER($1)", [handle])) throw E.conflict("اسم المستخدم محجوز");
    const u = await createUser({ name, handle, password });
    await sessionFor(res, u, req);
    return { user: pub(u) };
  }
  async function login(req, res) {
    if (!rl.hit("login", req.ip)) throw E.rate();
    const handle = str(req.body.handle, 24, { required: true });
    const u = await db.get("SELECT * FROM users WHERE LOWER(handle)=LOWER($1)", [handle]);
    if (u && !verifyPassword(String(req.body.password || ""), u.password_hash)) ctx.services.security?.noteFailed?.(u, req); // v2.79: repeated-failure alert
    if (!u || !verifyPassword(String(req.body.password || ""), u.password_hash))
      throw new (require("../lib/core").HttpError)(401, "بيانات الدخول غير صحيحة", "bad_credentials");
    if (u.status !== "active") throw E.forbid("الحساب موقوف");
    const mfa = await ctx.services.security.checkSecondFactor(u, req.body.code);
    await sessionFor(res, u, req, { mfa });
    return { user: pub(u) };
  }
  async function logout(req, res) {
    const t = req.cookies.mp_session; if (t) await Sessions.deleteByToken(t);
    res.cookie("mp_session", "", { maxAge: 0 }); return { ok: true };
  }
  /* Pi Network authentication (spec: Pi last phase). Client gets accessToken from Pi.authenticate();
   * the server verifies it with Pi Platform API GET /v2/me — never trust the client's uid. */
  async function piAuth(req, res) {
    const pi = ctx.services.pi;
    let me; // { uid, username } — from the server-side App Studio exchange only (phase 36b), never from the request
    if (pi?.verify) {
      if (!pi.authEnabled()) throw E.off("تسجيل الدخول بـ Pi غير مفعّل بعد");
      if (!rl.hit("login", req.ip)) throw E.rate();
      me = await pi.verify(str(req.body.accessToken, 4000, { required: true }));
    } else { // Pi service not registered (older builds/tests): Pi Platform /v2/me
      if (!config.piEnabled) throw E.off("تسجيل الدخول بـ Pi غير مفعّل بعد");
      const at = str(req.body.accessToken, 2000, { required: true });
      const r = await fetch(config.piApi + "/v2/me", { headers: { Authorization: "Bearer " + at } });
      if (!r.ok) throw new (require("../lib/core").HttpError)(401, "تعذر التحقق من حساب Pi", "pi_invalid");
      me = await r.json();
    }
    let u = await db.get("SELECT * FROM users WHERE pi_uid=$1", [me.uid]);
    if (!u) {
      let handle = (me.username || "pi_user").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20) || "pi_user";
      while (await db.get("SELECT 1 x FROM users WHERE LOWER(handle)=LOWER($1)", [handle])) handle = handle.slice(0, 18) + Math.floor(Math.random() * 99);
      u = await createUser({ name: me.username || handle, handle, piUid: me.uid });
    }
    await sessionFor(res, u, req, { mfa: true }); // v2.79: Pi sign-in is strong auth (Pi app unlock + server-verified token)
    return { user: pub(u) };
  }

  async function updateMe(user, b) {
    const name = b.name !== undefined ? str(b.name, 50, { required: true, min: 2 }) : user.name;
    const bio = b.bio !== undefined ? (str(b.bio, 300) || "") : user.bio;
    let pinned = user.pinned;
    if (b.pinned !== undefined) { pinned = b.pinned || null; if (pinned && !(await db.get("SELECT 1 x FROM posts WHERE id=$1 AND author=$2", [pinned, user.id]))) throw E.bad(); }
    await db.run("UPDATE users SET name=$1, bio=$2, pinned=$3 WHERE id=$4", [name, bio, pinned, user.id]);
    ctx.cache.del("card:"); bus.emit("PROFILE_UPDATED", { user: user.id });
    return { user: pub(await db.get("SELECT * FROM users WHERE id=$1", [user.id])) };
  }
  const PREF_KEYS = ["mutedWords", "onboarded", "interests", "interestWeights", "muted", "blocked", "lists", "collections", "drafts", "history", "settings"];
  async function setPrefs(user, b) {
    const raw = JSON.stringify(b || {}); if (raw.length > 200e3) throw E.bad("الإعدادات كبيرة جداً");
    const prefs = { ...(user.prefs || {}) }; for (const k of PREF_KEYS) if (b[k] !== undefined) prefs[k] = b[k];
    if (Array.isArray(prefs.blocked)) { // blocking severs the graph both ways (spec: block)
      for (const x of prefs.blocked) if (typeof x === "string") await db.run("DELETE FROM follows WHERE (src=$1 AND dst=$2) OR (src=$2 AND dst=$1)", [user.id, x]);
    }
    await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [prefs, user.id]);
    ctx.cache.del("feed:" + user.id);
    bus.emit("PREFS_UPDATED", { user: user.id }); // phase 33: protection.sync() reconciles blocks / linked accounts
    return { ok: true };
  }
  async function follow(user, to) {
    if (!rl.hit("follow", user.id)) throw E.rate();
    if (to === user.id) throw E.bad();
    const t = await db.get("SELECT id, prefs, private FROM users WHERE id=$1", [to]); if (!t) throw E.nf();
    const mode = await ctx.policy.followMode(user.id, t); if (!mode) throw E.forbid();
    if (mode === "request" && !(await db.get("SELECT 1 x FROM follows WHERE src=$1 AND dst=$2", [user.id, to]))) {
      const r = await db.run("INSERT INTO follow_requests(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [user.id, to, now()]);
      if (r.changes) await ctx.services.messaging.notify(to, "follow_request", { actor: user.id });
      return "requested";
    }
    const r = await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [user.id, to, now()]);
    if (r.changes) bus.emit("USER_FOLLOWED", { from: user.id, to, actor: user.id });
    ctx.cache.del("feed:" + user.id);
  }
  async function unfollow(user, to) { if (!rl.hit("unfollow", user.id)) throw E.rate(); await db.run("DELETE FROM follows WHERE src=$1 AND dst=$2", [user.id, to]); await db.run("DELETE FROM follow_requests WHERE src=$1 AND dst=$2", [user.id, to]); bus.emit("USER_UNFOLLOWED", { from: user.id, to }); ctx.cache.del("feed:" + user.id); }
  async function profile(viewer, handle) {
    const u = await db.get("SELECT * FROM users WHERE LOWER(handle)=LOWER($1)", [handle]); if (!u) throw E.nf();
    const followers = (await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [u.id])).n, following = (await db.get("SELECT COUNT(*) n FROM follows WHERE src=$1", [u.id])).n;
    return { user: { ...pub(u), followers, following, followsYou: viewer ? !!(await db.get("SELECT 1 x FROM follows WHERE src=$1 AND dst=$2", [u.id, viewer.id])) : false } };
  }

  const r = ctx.router, A = ctx.requireUser;
  r.post("/api/auth/register", register);
  r.post("/api/auth/login", login);
  r.post("/api/auth/logout", logout);
  r.post("/api/auth/pi", piAuth, { piLogin: true }); // CSRF header not required: authenticated by the Pi accessToken
  r.get("/api/me", A(async (req) => ({ user: pub(req.user), prefs: req.user.prefs || {} })));
  r.patch("/api/me", A(async (req) => updateMe(req.user, req.body)));
  r.put("/api/me/prefs", A(async (req) => setPrefs(req.user, req.body)));
  r.get("/api/users/:handle", async (req) => profile(req.user, req.params.handle));
  r.put("/api/follows/:id", A(async (req) => ({ ok: true, state: (await follow(req.user, req.params.id)) === "requested" ? "requested" : "following" })));
  r.del("/api/follows/:id", A(async (req) => (await unfollow(req.user, req.params.id), { ok: true })));
  return { resolve, pub, createUser, sessionFor };
};
