/* v2.62 T6 «مهندس واجهات الحارس» — member endpoints (GET /autoguard/me, POST /autoguard/check), lifting a guard lock
 * through the discipline path (liftMin + reset / resetOnLift), /automod/test with the saved guard (config.guard null
 * never drops it), /automod/meta guard defaults, member notes guard line, muted base perms no longer comment. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const AR = require("../lib/automod-rules");
const CP = require("../lib/cperm");
let H, O, AD, MO, U1, U2, U3, X, cid;
const DEF = { words: [], blockLinks: false, newAccountDays: 0, toxicity: "off", action: "queue" };
const clear = () => H.app.ctx.rl.w?.clear?.();
const db = () => H.app.ctx.db;
const mk = async (handle) => { clear(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const setAm = (am) => db().run("UPDATE communities SET settings=$1 WHERE id=$2", [{ automod: am }, cid]);
const guard = (x = {}) => AR.parseGuard({ enabled: true, words: ["غبي", "يا حمار"], ...x });
const post = (c, text) => { clear(); return c.req("POST", "/api/posts", { text, community: cid }); };
const strikesLive = async (u) => Number((await db().get("SELECT COUNT(*) n FROM community_sanctions WHERE community=$1 AND user_id=$2 AND kind='warn' AND rule_id='autoguard' AND lifted_at IS NULL", [cid, u])).n);
const mem = (u) => db().get("SELECT role, muted_until FROM memberships WHERE community=$1 AND user_id=$2", [cid, u]);
const lock = async (u) => { await H.app.ctx.services.communities.sanction("system", cid, u, "mute", { indefinite: true, ruleId: "autoguard_lock" }); };
const disc = (c, u, body) => { clear(); return c.req("POST", `/api/communities/${cid}/members/${u}/discipline`, body); };

test.before(async () => {
  H = await boot();
  [O, AD, MO, U1, U2, U3, X] = [await mk("own_g6"), await mk("adm_g6"), await mk("mod_g6"), await mk("usr_g6a"), await mk("usr_g6b"), await mk("usr_g6c"), await mk("out_g6")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع واجهات الحارس", desc: "اختبار", topic: "dev" })).community.id;
  for (const c of [AD, MO, U1, U2, U3]) { clear(); await c.req("PUT", `/api/communities/${cid}/membership`); }
  clear(); assert.equal((await O.req("PATCH", `/api/communities/${cid}/members/${AD.id}`, { role: "admin" })).status, 200);
  clear(); assert.equal((await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" })).status, 200);
});
test.after(() => H.app.close());

/* ---------------- (e) muted base permissions ---------------- */
test("muted base permissions: no comment (cperm.BASE + legacy PERMS); other roles unchanged", () => {
  assert.deepEqual(CP.BASE.muted, []);
  assert.deepEqual(H.app.ctx.services.communities.PERMS.muted, []);
  assert.ok(CP.BASE.member.includes("comment") && CP.BASE.moderator.includes("comment") && CP.BASE.admin.includes("comment"));
  assert.deepEqual(H.app.ctx.services.communities.PERMS.member, ["CanPost", "CanComment", "CanInvite"]);
  assert.deepEqual(CP.BASE.pending, []); assert.deepEqual(CP.BASE.banned, []);
});

/* ---------------- (a) live pre-check ---------------- */
test("check: visitor 401; non-member 403; guard off → hit:false", async () => {
  await setAm({ ...DEF });
  const anon = new H.Client(); clear();
  assert.equal((await anon.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "غبي" })).status, 401);
  clear(); assert.equal((await X.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "غبي" })).status, 403);
  clear(); const r = await U1.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "انت غبي" });
  assert.equal(r.status, 200); assert.equal(r.hit, false); assert.deepEqual(r.words, []);
  await setAm({ ...DEF, guard: guard({ enabled: false }) });
  clear(); assert.equal((await U1.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "انت غبي" })).hit, false);
});

test("check: hit → {hit, words masked} only; never the list; no strike, no log, nothing stored", async () => {
  await setAm({ ...DEF, guard: guard() });
  const logs0 = Number((await db().get("SELECT COUNT(*) n FROM mod_actions WHERE community=$1", [cid])).n);
  clear(); const r = await U1.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "ويا حمار انت غبييي نص_فحص_سري" });
  assert.equal(r.status, 200); assert.equal(r.hit, true);
  assert.deepEqual(Object.keys(r).filter(k => !["status", "headers"].includes(k)).sort(), ["hit", "words"]);
  assert.ok(r.words.length >= 1 && r.words.every(w => w.includes("*")));
  const js = JSON.stringify(r); assert.ok(!js.includes("غبي") && !js.includes("حمار"), "word list never leaks");
  assert.equal(await strikesLive(U1.id), 0);
  assert.equal((await mem(U1.id)).role, "member");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mod_actions WHERE community=$1", [cid])).n), logs0);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM posts WHERE text LIKE '%نص_فحص_سري%'")).n), 0);
  clear(); const clean = await U1.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "نص نظيف تماما" });
  assert.equal(clean.hit, false);
});

test("check: kind respected (comments off → comment check false); staff → hit:false", async () => {
  await setAm({ ...DEF, guard: guard({ comments: false }) });
  clear(); assert.equal((await U1.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "غبي", kind: "comment" })).hit, false);
  clear(); assert.equal((await U1.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "غبي", kind: "post" })).hit, true);
  clear(); assert.equal((await MO.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "غبي" })).hit, false);
});

test("check: rate-limited (20/min per member) → 429", async () => {
  await setAm({ ...DEF, guard: guard() }); clear();
  for (let i = 0; i < 20; i++) assert.equal((await U2.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "نص " + i })).status, 200);
  const r = await U2.req("POST", `/api/communities/${cid}/autoguard/check`, { text: "نص زائد" });
  assert.equal(r.status, 429);
  clear();
});

/* ---------------- (c) own guard status ---------------- */
test("me: visitor 401; non-member member:false; clean member zeros; no lists", async () => {
  await setAm({ ...DEF, guard: guard() });
  clear(); assert.equal((await new H.Client().req("GET", `/api/communities/${cid}/autoguard/me`)).status, 401);
  clear(); const x = await X.req("GET", `/api/communities/${cid}/autoguard/me`); assert.equal(x.status, 200); assert.equal(x.member, false); assert.equal(x.strikes, 0);
  clear(); const r = await U3.req("GET", `/api/communities/${cid}/autoguard/me`);
  assert.equal(r.member, true); assert.equal(r.enabled, true); assert.equal(r.strikes, 0); assert.equal(r.max, 3); assert.equal(r.decayDays, 30);
  assert.equal(r.muted, false); assert.equal(r.mutedUntil, null); assert.equal(r.locked, false); assert.equal(r.appealUrl, "#/cappeal/" + cid);
  assert.ok(!("words" in r) && !("allow" in r)); assert.ok(!JSON.stringify(r).includes("غبي"));
});

test("me: strike → strikes 1/3 + mutedUntil; lock → locked, mutedUntil null; elapsed unswept mute → not muted", async () => {
  await setAm({ ...DEF, guard: guard() });
  assert.equal((await post(U3, "انت غبي نص_me1")).status, 400);
  clear(); let r = await U3.req("GET", `/api/communities/${cid}/autoguard/me`);
  assert.equal(r.strikes, 1); assert.equal(r.max, 3); assert.equal(r.muted, true); assert.ok(Date.parse(r.mutedUntil) > Date.now()); assert.equal(r.locked, false);
  await db().run("UPDATE memberships SET muted_until=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 60e3).toISOString(), cid, U3.id]);
  clear(); r = await U3.req("GET", `/api/communities/${cid}/autoguard/me`); assert.equal(r.muted, false); assert.equal(r.mutedUntil, null);
  await H.app.ctx.services.cmod.unmuteDue();
  await lock(U3.id);
  clear(); r = await U3.req("GET", `/api/communities/${cid}/autoguard/me`); assert.equal(r.locked, true); assert.equal(r.muted, true); assert.equal(r.mutedUntil, null);
  clear(); const st = await MO.req("GET", `/api/communities/${cid}/autoguard/me`); assert.equal(st.exempt, true); assert.equal(st.strikes, 0);
});

/* ---------------- (b) lifting a guard lock ---------------- */
test("lift lock: liftMin=admin → moderator 403, admin 200; resetOnLift clears strikes by default", async () => {
  await setAm({ ...DEF, guard: guard({ liftMin: "admin" }) });
  assert.equal((await mem(U3.id)).role, "muted"); assert.ok(await strikesLive(U3.id) >= 1);
  const d1 = await disc(MO, U3.id, { action: "unmute" }); assert.equal(d1.status, 403); assert.match(d1.error, /للمديرين/);
  assert.equal((await mem(U3.id)).role, "muted");
  const d2 = await disc(AD, U3.id, { action: "unmute" }); assert.equal(d2.status, 200); assert.equal(d2.member.role, "member");
  assert.equal(await strikesLive(U3.id), 0, "resetOnLift (default) cleared the strikes");
  const lg = await db().get("SELECT meta FROM mod_actions WHERE community=$1 AND target_user=$2 AND action='unmute' ORDER BY created_at DESC LIMIT 1", [cid, U3.id]);
  const meta = typeof lg.meta === "string" ? JSON.parse(lg.meta) : lg.meta; assert.equal(meta.autoguardLock, true); assert.equal(meta.reset, true);
  const lk = await db().get("SELECT lifted_at FROM community_sanctions WHERE community=$1 AND user_id=$2 AND rule_id='autoguard_lock'", [cid, U3.id]); assert.ok(lk.lifted_at);
});

test("lift lock: liftMin=owner → admin 403, owner 200; reset:false keeps strikes", async () => {
  await setAm({ ...DEF, guard: guard({ liftMin: "owner" }) });
  assert.equal((await post(U2, "انت غبي نص_lift2")).status, 400);
  await H.app.ctx.services.communities.sanction("system", cid, U2.id, "unmute", {});
  await lock(U2.id);
  const a = await disc(AD, U2.id, { action: "unmute" }); assert.equal(a.status, 403); assert.match(a.error, /للمالك/);
  const o = await disc(O, U2.id, { action: "unmute", reset: false }); assert.equal(o.status, 200);
  assert.equal(await strikesLive(U2.id), 1, "reset:false kept the strike");
});

test("lift lock: liftMin=moderator (default) → moderator 200; reset:true with resetOnLift:false still clears", async () => {
  await setAm({ ...DEF, guard: guard({ resetOnLift: false }) });
  await lock(U2.id);
  const r = await disc(MO, U2.id, { action: "unmute" }); assert.equal(r.status, 200);
  assert.equal(await strikesLive(U2.id), 1, "resetOnLift:false → strikes kept by default");
  await lock(U2.id);
  const r2 = await disc(MO, U2.id, { action: "unmute", reset: true }); assert.equal(r2.status, 200);
  assert.equal(await strikesLive(U2.id), 0);
});

test("non-guard mute: liftMin does not apply (moderator unmutes a manual mute under liftMin=owner); no guard → no reset", async () => {
  await setAm({ ...DEF, guard: guard({ liftMin: "owner" }) });
  assert.equal((await disc(MO, U1.id, { action: "mute", hours: 2 })).status, 200);
  assert.equal((await disc(MO, U1.id, { action: "unmute" })).status, 200);
  assert.equal((await mem(U1.id)).role, "member");
  await setAm({ ...DEF });
  await lock(U1.id); // a lock with the guard key removed: default liftMin moderator
  assert.equal((await disc(MO, U1.id, { action: "unmute" })).status, 200);
});

test("notes: guard line {strikes, max, locked} for moderators", async () => {
  await setAm({ ...DEF, guard: guard() });
  assert.equal((await post(U1, "انت غبي نص_notes")).status, 400);
  clear(); const n = await MO.req("GET", `/api/communities/${cid}/members/${U1.id}/notes`);
  assert.equal(n.status, 200); assert.deepEqual(n.guard, { strikes: 1, max: 3, locked: false });
});

/* ---------------- (d) /automod/test + /meta ---------------- */
test("automod/test: saved guard used; config.guard null keeps it (explicit); draft guard overrides; masked words only", async () => {
  await setAm({ ...DEF, guard: guard() });
  clear(); let t = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غبي" });
  assert.equal(t.status, 200); assert.equal(t.final, "reject"); assert.equal(t.guard.hit, true); assert.equal(t.guard.applies, true); assert.equal(t.guard.source, "saved");
  assert.equal(t.guard.outcome.n, 1); assert.equal(t.guard.outcome.max, 3); assert.match(t.label, /الحارس التلقائي/);
  assert.ok(!JSON.stringify(t.guard).includes("غبي"));
  clear(); t = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غبي", config: { guard: null } });
  assert.equal(t.status, 200); assert.ok(t.guard, "config.guard=null must not drop the saved guard"); assert.equal(t.guard.hit, true); assert.equal(t.final, "reject"); assert.equal(t.guard.source, "saved");
  clear(); t = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غبي", config: { words: [] } });
  assert.equal(t.guard.hit, true, "a legacy-only draft keeps the saved guard");
  clear(); t = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غبي", config: { guard: { enabled: true, words: ["كلمة_اخرى"] } } });
  assert.equal(t.guard.source, "draft"); assert.equal(t.guard.hit, false); assert.equal(t.final, "allow");
  clear(); t = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غبي", strike: 3 });
  assert.equal(t.guard.outcome.locked, true);
  await setAm({ ...DEF, guard: guard({ enabled: false }) });
  clear(); t = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غبي" });
  assert.equal(t.guard.enabled, false); assert.equal(t.guard.hit, true); assert.equal(t.guard.applies, false); assert.equal(t.final, "allow");
  await setAm({ ...DEF });
  clear(); t = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غبي" }); assert.equal(t.guard, null);
  clear(); assert.equal((await U1.req("POST", `/api/communities/${cid}/automod/test`, { text: "x" })).status, 403);
});

test("automod/meta: guardDefaults (OFF) + guardPreset + liftMin", async () => {
  clear(); const m = await MO.req("GET", `/api/communities/${cid}/automod/meta`);
  assert.equal(m.status, 200); assert.equal(m.guardDefaults.enabled, false); assert.equal(m.guardPreset.guard.maxStrikes, 3);
  assert.deepEqual(m.liftMin, ["moderator", "admin", "owner"]);
});
