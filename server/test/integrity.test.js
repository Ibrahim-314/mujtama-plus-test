/* Track 7 — Phase 32 (مكافحة الحسابات الوهمية): device fingerprint matching + multi-account soft limits,
 * optional phone OTP (test sink, hashing, attempts, uniqueness, provider gating), Pi KYC (stubbed Pi API),
 * "new account" badge, coordinated-network scan (near-duplicate content + timing bursts), dense-cluster
 * scan, relationship graph, fake-follower soft-hide / restore, investigations API authorization. */
const test = require("node:test"),
  assert = require("node:assert"),
  http = require("node:http"),
  crypto = require("node:crypto");
const { boot } = require("./helpers");

let H, ADMIN;
const ctx = () => H.app.ctx;
const db = () => H.app.ctx.db;
const svc = () => H.app.ctx.services.integrity;
const hex = s => crypto.createHash("sha256").update(s).digest("hex");
let n = 0;
const mk = async (handle, name) => {
  ctx().rl.w.clear();
  const c = new H.Client();
  const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  c.id = r.user.id;
  c.handle = handle;
  return c;
};
const many = async (prefix, k) => {
  const out = [];
  for (let i = 0; i < k; i++) out.push(await mk(`${prefix}${i}_${++n}`));
  return out;
};

test.before(async () => {
  H = await boot({ deviceMaxAccounts: 3, integrityScanMs: 3600e3, fakeFollowerCleanupMs: 3600e3 });
  // until the integrator registers the service in server.js, attach it here (idempotent afterwards)
  if (!ctx().services.integrity) ctx().services.integrity = require("../services/integrity")(ctx());
  ADMIN = await mk("ig_admin", "مشرفة الأمان");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [ADMIN.id])).role, "admin");
});
test.after(() => H.app.close());
test.beforeEach(() => {
  ctx().rl.w.clear();
  svc().resetLimiter();
});

test("migration 015 created every integrity table", async () => {
  for (const t of ["integrity_meta", "device_signals", "phone_otps", "phone_verifications", "pi_kyc", "integrity_flags", "integrity_limits", "follower_flags"]) assert.ok(await db().get(`SELECT COUNT(*) n FROM ${t}`), t);
  assert.ok(await db().get("SELECT 1 x FROM schema_migrations WHERE id='015_integrity'"));
});

test("authorization: members get 401 when signed out, 403 on every investigations endpoint", async () => {
  const anon = new H.Client(),
    m = await mk("ig_member");
  assert.equal((await anon.req("GET", "/api/integrity/me")).status, 401);
  assert.equal((await anon.req("POST", "/api/integrity/device", { did: hex("x") })).status, 401);
  for (const [meth, p] of [["GET", "/api/admin/integrity/overview"], ["GET", "/api/admin/integrity/flags"], ["GET", "/api/admin/integrity/users/" + m.id], ["POST", "/api/admin/integrity/scan"], ["POST", "/api/admin/integrity/cleanup"], ["GET", "/api/admin/integrity/followers"], ["POST", "/api/admin/integrity/users/" + m.id + "/limit"]]) assert.equal((await m.req(meth, p, meth === "POST" ? { level: "none" } : undefined)).status, 403, p);
  assert.equal((await ADMIN.req("GET", "/api/admin/integrity/overview")).status, 200);
});

test("device fingerprint: only salted HMACs stored; > DEVICE_MAX accounts on one device → flag + reversible soft limit on the extras", async () => {
  const did = hex("did|shared-device"),
    fp = hex("fp|iphone-traits");
  const accts = await many("ig_dev", 5);
  assert.equal((await accts[0].req("POST", "/api/integrity/device", { did: "nothex" })).status, 400);
  for (const a of accts) {
    const r = await a.req("POST", "/api/integrity/device", { did, fp });
    assert.equal(r.status, 200, r.error);
  }
  const rows = await db().all("SELECT hash FROM device_signals WHERE user_id=$1", [accts[0].id]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(r => r.hash !== did && r.hash !== fp && /^[a-f0-9]{64}$/.test(r.hash)), "raw client hashes are never stored");
  const linked = await svc().linkedAccounts(accts[0].id);
  assert.equal(linked.size, 4);
  assert.ok([...linked.values()].every(v => v === "device"));
  const flag = await db().get("SELECT * FROM integrity_flags WHERE kind='multi_account' AND status='open'");
  assert.ok(flag, "multi-account flag raised");
  const limited = (await db().all("SELECT user_id FROM integrity_limits WHERE reason='multi_account'")).map(r => r.user_id);
  assert.deepEqual(limited.sort(), [accts[3].id, accts[4].id].sort(), "the oldest DEVICE_MAX accounts stay free; extras are limited");
  // soft limit: follow is rate-limited much harder (20/h for 'limited')
  const me = await accts[4].req("GET", "/api/integrity/me");
  assert.equal(me.limit.level, "limited");
  assert.match(me.limit.text, /مراجعة/);
  assert.equal(me.limit.reason, undefined, "internal reason is staff-only");
  let blocked = null;
  for (let i = 0; i < 25 && !blocked; i++) await svc().guard(accts[4].id, "follow").catch(e => (blocked = e));
  assert.equal(blocked?.status, 429);
  assert.equal(blocked.code, "integrity_limited");
  await svc().guard(accts[0].id, "follow"); // unlimited account: no-op
  // dismissing the flag lifts the limits it caused
  const r = await ADMIN.req("POST", "/api/admin/integrity/flags/" + flag.id, { decision: "dismiss", note: "عائلة على جهاز واحد" });
  assert.equal(r.status, 200);
  assert.equal(r.state, "dismissed");
  assert.equal(r.changed, 2);
  assert.equal((await db().get("SELECT COUNT(*) n FROM integrity_limits WHERE reason='multi_account'")).n, 0);
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='integrity_flag_dismissed'"));
});

test("phone OTP: test sink, wrong code counts attempts, hashed storage, one account per number, removal, provider gating", async () => {
  const a = await mk("ig_phone_a"),
    b = await mk("ig_phone_b");
  assert.equal((await a.req("POST", "/api/integrity/phone/start", { phone: "12" })).status, 400);
  const st = await a.req("POST", "/api/integrity/phone/start", { phone: "٠٥٥ ١٢٣ ٤٥٦٧" });
  assert.equal(st.status, 200, st.error);
  assert.equal(st.hint, "•••• 67");
  assert.equal(st.code, undefined, "the code is never returned by the API");
  const sms = svc().smsOutbox.at(-1);
  assert.equal(sms.to, "+966551234567");
  assert.match(sms.text, /\d{6}/);
  const otp = await db().get("SELECT * FROM phone_otps WHERE user_id=$1", [a.id]);
  assert.ok(!JSON.stringify(otp).includes(sms.code) && !JSON.stringify(otp).includes("551234567"), "code and number stored hashed");
  const wrong = await a.req("POST", "/api/integrity/phone/verify", { code: sms.code === "000000" ? "111111" : "000000" });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.code, "otp_invalid");
  assert.equal((await db().get("SELECT attempts FROM phone_otps WHERE user_id=$1", [a.id])).attempts, 1);
  const ok = await a.req("POST", "/api/integrity/phone/verify", { code: sms.code });
  assert.equal(ok.status, 200, ok.error);
  assert.equal(ok.verified, true);
  const pv = await db().get("SELECT * FROM phone_verifications WHERE user_id=$1", [a.id]);
  assert.match(pv.phone_hash, /^[a-f0-9]{64}$/);
  assert.equal(pv.phone_hint, "67");
  assert.equal((await a.req("GET", "/api/integrity/me")).phone.verified, true);
  // same number on another account is refused (PHONE_MAX_ACCOUNTS=1), international form included
  assert.equal((await b.req("POST", "/api/integrity/phone/start", { phone: "+966551234567" })).status, 409);
  // OTP rate limit: 3 sends / 10 min per account
  for (let i = 0; i < 3; i++) await b.req("POST", "/api/integrity/phone/start", { phone: "0551112222" });
  assert.equal((await b.req("POST", "/api/integrity/phone/start", { phone: "0551112222" })).status, 429);
  // too many wrong attempts lock the code
  svc().resetLimiter();
  await b.req("POST", "/api/integrity/phone/start", { phone: "0553334444" });
  for (let i = 0; i < 5; i++) await b.req("POST", "/api/integrity/phone/verify", { code: "999999" === svc().smsOutbox.at(-1).code ? "888888" : "999999" });
  assert.equal((await b.req("POST", "/api/integrity/phone/verify", { code: svc().smsOutbox.at(-1).code })).status, 429);
  // removal is the member's choice
  assert.equal((await a.req("DELETE", "/api/integrity/phone")).verified, false);
  assert.equal(await db().get("SELECT 1 x FROM phone_verifications WHERE user_id=$1", [a.id]), undefined);
  // no provider configured → 501, nothing sent
  const before = svc().smsOutbox.length;
  ctx().config.smsProvider = "off";
  try {
    const off = await a.req("POST", "/api/integrity/phone/start", { phone: "0559998888" });
    assert.equal(off.status, 501);
    assert.equal(svc().smsOutbox.length, before);
    ctx().config.smsProvider = "webhook"; // webhook without SMS_WEBHOOK_URL is also off
    assert.equal((await a.req("POST", "/api/integrity/phone/start", { phone: "0559998888" })).status, 501);
  } finally {
    delete ctx().config.smsProvider;
  }
});

test("phone verification lifts an automatic multi-account limit", async () => {
  const u = await mk("ig_lift");
  await svc().setLimit(u.id, "limited", "multi_account");
  await u.req("POST", "/api/integrity/phone/start", { phone: "0500000001" });
  await u.req("POST", "/api/integrity/phone/verify", { code: svc().smsOutbox.at(-1).code });
  assert.equal(await svc().limitOf(u.id), undefined);
});

test("Pi KYC: 501 when PI_ENABLED is off; verified through a stubbed /v2/me; uid mismatch refused", async () => {
  const u = await mk("ig_pi");
  assert.equal((await u.req("POST", "/api/integrity/pi-kyc", { accessToken: "t" })).status, 501);
  assert.deepEqual((await u.req("GET", "/api/integrity/me")).pi, { enabled: false, status: null });
  const stub = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization === "Bearer good") return res.end(JSON.stringify({ uid: "pi-uid-1", username: "pioneer", kyc_verified: true }));
    if (req.headers.authorization === "Bearer other") return res.end(JSON.stringify({ uid: "pi-uid-2", username: "x" }));
    res.statusCode = 401;
    res.end("{}");
  });
  await new Promise(r => stub.listen(0, "127.0.0.1", r));
  const old = { piEnabled: ctx().config.piEnabled, piApi: ctx().config.piApi };
  Object.assign(ctx().config, { piEnabled: true, piApi: "http://127.0.0.1:" + stub.address().port });
  try {
    assert.equal((await u.req("POST", "/api/integrity/pi-kyc", { accessToken: "good" })).status, 400, "account must be linked to Pi first");
    await db().run("UPDATE users SET pi_uid='pi-uid-1' WHERE id=$1", [u.id]);
    assert.equal((await u.req("POST", "/api/integrity/pi-kyc", { accessToken: "bad" })).status, 401);
    assert.equal((await u.req("POST", "/api/integrity/pi-kyc", { accessToken: "other" })).status, 403);
    const r = await u.req("POST", "/api/integrity/pi-kyc", { accessToken: "good" });
    assert.equal(r.status, 200, r.error);
    assert.equal(r.kyc, "verified");
    assert.equal((await db().get("SELECT status FROM pi_kyc WHERE user_id=$1", [u.id])).status, "verified");
    const me = await u.req("GET", "/api/integrity/me");
    assert.deepEqual(me.pi, { enabled: true, status: "verified" });
    const b = await new H.Client().req("GET", "/api/integrity/badges?ids=" + u.id);
    assert.deepEqual(b.badges[u.id].signals, ["pi"]);
  } finally {
    Object.assign(ctx().config, old);
    stub.close();
  }
});

test("'new account' badge is public, cached, and disappears after NEW_ACCOUNT_DAYS", async () => {
  const u = await mk("ig_badge"),
    old = await mk("ig_badge_old");
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 45 * 864e5).toISOString(), old.id]);
  const r = await new H.Client().req("GET", `/api/integrity/badges?ids=${u.id},${old.id},bad id!`);
  assert.equal(r.status, 200);
  assert.equal(r.newAccountDays, 30);
  assert.equal(r.badges[u.id].newAccount, true);
  assert.equal(r.badges[u.id].ageDays, 0);
  assert.equal(r.badges[old.id].newAccount, false);
  assert.equal(r.badges[old.id].ageDays, 45);
  assert.equal(Object.keys(r.badges).length, 2, "malformed ids ignored");
  const byHandle = await new H.Client().req("GET", "/api/integrity/badges?handle=IG_BADGE");
  assert.equal(byHandle.badges[u.id].newAccount, true);
  const me = await u.req("GET", "/api/integrity/me");
  assert.equal(me.newAccount, true);
  assert.ok(me.score >= 0 && me.score <= 100);
});

test("coordinated network: near-duplicate posts + repeated synchronized reactions → one network flag; confirm restricts, reopen keeps history", async () => {
  const ring = await many("ig_ring", 4);
  const bystander = await mk("ig_by");
  const variants = ["اربحوا معنا الآن انضموا إلى قناتنا الرائعة للحصول على أفضل العروض اليومية", "اربحوا معنا الان انضموا الى قناتنا الرائعة للحصول على افضل العروض اليومية!!", "اربحوا معنا الآن، انضموا إلى قناتنا الرائعة للحصول على أفضل العروض اليومية 🔥", "اربحوا معنا الآن انضموا إلى قناتنا الرائعة للحصول على أفضل العروض اليومية @promo"];
  for (let i = 0; i < ring.length; i++) {
    const r = await ring[i].req("POST", "/api/posts", { text: variants[i] });
    assert.equal(r.status, 200, r.error);
  }
  await bystander.req("POST", "/api/posts", { text: "مساء الخير جميعاً، اليوم جربت وصفة جديدة للقهوة العربية بالهيل وكانت رائعة" });
  // two targets, each hit by the whole ring within seconds
  const t1 = await bystander.req("POST", "/api/posts", { text: "منشور أول عادي تماماً عن التقنية والبرمجة" });
  const t2 = await bystander.req("POST", "/api/posts", { text: "منشور ثانٍ عادي تماماً عن التصميم والفنون" });
  for (const t of [t1.post.id, t2.post.id]) for (const a of ring) assert.equal((await a.req("PUT", `/api/reactions/${t}`, { type: "like" })).status, 200);
  const out = await svc().scanNetworks();
  const nf = out.flags.find(f => f.size === 4);
  assert.ok(nf, "network flag for the ring: " + JSON.stringify(out));
  const flag = await db().get("SELECT * FROM integrity_flags WHERE id=$1", [nf.id]);
  const members = typeof flag.members === "string" ? JSON.parse(flag.members) : flag.members;
  assert.deepEqual(members.sort(), ring.map(a => a.id).sort());
  assert.ok(!members.includes(bystander.id));
  assert.ok(flag.score >= 0.5, "score " + flag.score);
  // a re-scan updates instead of duplicating
  await svc().scanNetworks();
  assert.equal((await db().get("SELECT COUNT(*) n FROM integrity_flags WHERE kind='network' AND sig=$1", [flag.sig])).n, 1);
  // investigations API
  const ov = await ADMIN.req("GET", "/api/admin/integrity/overview");
  assert.ok(ov.flags.some(f => f.id === flag.id));
  assert.ok(ov.stats.openFlags >= 1);
  const det = await ADMIN.req("GET", "/api/admin/integrity/flags/" + flag.id);
  assert.equal(det.flag.members.length, 4);
  assert.ok(det.flag.evidence.content.length >= 1);
  assert.ok(det.flag.evidence.signals.timing > 0);
  const conf = await ADMIN.req("POST", "/api/admin/integrity/flags/" + flag.id, { decision: "confirm", note: "حملة سبام" });
  assert.equal(conf.changed, 4);
  for (const a of ring) assert.equal((await svc().limitOf(a.id)).level, "restricted");
  assert.equal((await ADMIN.req("GET", "/api/admin/integrity/flags?status=confirmed")).flags[0].id, flag.id);
  assert.equal((await db().get("SELECT COUNT(*) n FROM users WHERE id IN ($1,$2,$3,$4) AND status='active'", ring.map(a => a.id))).n, 4, "confirmation never suspends");
  const u = await ADMIN.req("GET", "/api/admin/integrity/users/" + ring[0].handle);
  assert.equal(u.status, 200, u.error);
  assert.equal(u.signals.limit.level, "restricted");
  assert.ok(u.flags.some(f => f.id === flag.id));
  await ADMIN.req("POST", "/api/admin/integrity/users/" + ring[0].id + "/limit", { level: "none" });
  assert.equal(await svc().limitOf(ring[0].id), undefined);
});

test("relationship graph: a closed follow-ring of new accounts becomes a dense-cluster flag; neighborhood graph exposes it", async () => {
  const ring = await many("ig_den", 5);
  for (const a of ring) for (const b of ring) if (a !== b) assert.equal((await a.req("PUT", "/api/follows/" + b.id)).status, 200);
  const out = await svc().scanDensity();
  const f = out.flags.find(x => x.size === 5);
  assert.ok(f, JSON.stringify(out));
  const row = await db().get("SELECT * FROM integrity_flags WHERE id=$1", [f.id]);
  assert.equal(row.kind, "cluster");
  const nb = await svc().neighborhood(ring[0].id);
  assert.equal(nb.nodes.length, 5);
  assert.ok(nb.suspicious.some(c => c.size === 5 && c.density === 1 && c.reciprocity === 1));
  assert.ok(nb.nodes.every(x => x.flagged), "members show as flagged once the flag scores >= 0.6");
});

test("fake-follower cleanup: soft-hides (follows untouched), counts adjust, auto-hides new follows, admin restore sticks, earning trust auto-restores", async () => {
  const star = await mk("ig_star");
  const real = await mk("ig_real");
  await real.req("POST", "/api/posts", { text: "متابع حقيقي ينشر محتوى مفيداً هنا" });
  await db().run("UPDATE users SET bio='مهندس', avatar=$1 WHERE id=$2", [{ 200: "/x.webp" }, real.id]);
  const fakes = await many("ig_fake", 3);
  for (const f of [...fakes, real]) await f.req("PUT", "/api/follows/" + star.id);
  for (const f of fakes.slice(0, 2)) await svc().setLimit(f.id, "limited", "test"); // limited + new + no activity → 0.9
  await db().run("UPDATE users SET status='suspended' WHERE id=$1", [fakes[2].id]);
  assert.equal(await svc().visibleFollowerCount(star.id), 4);
  const r = await svc().cleanupFakeFollowers();
  assert.ok(r.hidden >= 3, JSON.stringify(r));
  assert.equal(await svc().visibleFollowerCount(star.id), 1);
  assert.equal(await svc().hiddenFollowerCount(star.id), 3);
  assert.equal((await db().get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [star.id])).n, 4, "follows rows are never deleted");
  assert.equal(await db().get("SELECT 1 x FROM follower_flags WHERE src=$1", [real.id]), undefined, "a real follower is untouched");
  assert.equal((await star.req("GET", "/api/integrity/me")).hiddenFollowers, 3);
  // a new follow by an account already judged fake is hidden right away
  const other = await mk("ig_other");
  await fakes[0].req("PUT", "/api/follows/" + other.id);
  for (let i = 0; i < 40 && !(await svc().hiddenFollowerCount(other.id)); i++) await new Promise(res => setTimeout(res, 50)); // bus delivery is async
  assert.equal(await svc().hiddenFollowerCount(other.id), 1);
  // staff restore is sticky (cleanup does not re-hide it)
  const list = await ADMIN.req("GET", "/api/admin/integrity/followers?user=" + star.handle);
  assert.equal(list.followers.length, 3);
  const rs = await ADMIN.req("POST", "/api/admin/integrity/followers/restore", { src: fakes[1].id, dst: star.id });
  assert.equal(rs.restored, 1);
  await svc().cleanupFakeFollowers();
  assert.equal((await db().get("SELECT status, restored_by FROM follower_flags WHERE src=$1 AND dst=$2", [fakes[1].id, star.id])).status, "restored");
  // earning trust (limit lifted + verified phone) → the job restores automatically
  await svc().setLimit(fakes[0].id, "none", "ok");
  await fakes[0].req("POST", "/api/integrity/phone/start", { phone: "0577777777" });
  await fakes[0].req("POST", "/api/integrity/phone/verify", { code: svc().smsOutbox.at(-1).code });
  const r2 = await svc().cleanupFakeFollowers();
  assert.ok(r2.restored >= 2, JSON.stringify(r2));
  assert.equal((await db().get("SELECT restored_by FROM follower_flags WHERE src=$1 AND dst=$2", [fakes[0].id, star.id])).restored_by, "system");
  assert.equal(await svc().visibleFollowerCount(star.id), 3);
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='fake_followers_cleanup'"));
  // the admin cleanup endpoint runs the same job
  const api = await ADMIN.req("POST", "/api/admin/integrity/cleanup");
  assert.equal(api.status, 200);
  assert.ok(api.scanned >= 1);
});

test("scheduled jobs are registered on the leased scheduler and can run once", async () => {
  const r = await ctx().scheduler.runOnce("integrityScan_test", () => svc().scanNetworks({ sinceMs: 3600e3 }));
  assert.equal(r.ok, true);
  const s = await ADMIN.req("POST", "/api/admin/integrity/scan", { days: 2 });
  assert.equal(s.status, 200);
  assert.ok(Array.isArray(s.networks.flags) && Array.isArray(s.clusters.flags));
});
