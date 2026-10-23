/* v2.62 T5 «مهندس التعليقات والتعديل» — the guard on comments (independent of «التعليقات») and on post edits; any active
 * mute (manual timed, guard timed, guard lock) blocks comments (QA H3-01); staff exempt; guard off = v2.61. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const AR = require("../lib/automod-rules");
let H, O, MO, U1, U2, U3, U4, U5, cid, pid, pidStaff;
const DEF = { words: [], blockLinks: false, newAccountDays: 0, toxicity: "off", action: "queue" };
const clear = () => H.app.ctx.rl.w?.clear?.();
const db = () => H.app.ctx.db;
const mk = async (handle) => { clear(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const setAm = (am) => db().run("UPDATE communities SET settings=$1 WHERE id=$2", [{ automod: am }, cid]);
const guard = (x = {}) => AR.parseGuard({ enabled: true, words: ["غبي", "يا حمار"], ...x });
const cmt = (c, text, post = pid) => { clear(); return c.req("POST", "/api/comments", { post, text }); };
const stored = async (text) => Number((await db().get("SELECT COUNT(*) n FROM comments WHERE text LIKE $1", ["%" + text + "%"])).n);
const strikes = async (u) => Number((await db().get("SELECT COUNT(*) n FROM community_sanctions WHERE community=$1 AND user_id=$2 AND kind='warn' AND rule_id='autoguard'", [cid, u])).n);
const mem = (u) => db().get("SELECT role, muted_until FROM memberships WHERE community=$1 AND user_id=$2", [cid, u]);

test.before(async () => {
  H = await boot();
  [O, MO, U1, U2, U3, U4, U5] = [await mk("own_g5"), await mk("mod_g5"), await mk("usr_g5a"), await mk("usr_g5b"), await mk("usr_g5c"), await mk("usr_g5d"), await mk("usr_g5e")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع تعليقات الحارس", desc: "اختبار", topic: "dev" })).community.id;
  for (const c of [MO, U1, U2, U3, U4, U5]) { clear(); await c.req("PUT", `/api/communities/${cid}/membership`); }
  clear(); assert.equal((await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" })).status, 200);
  clear(); pid = (await O.req("POST", "/api/posts", { text: "منشور للتعليق عليه", community: cid })).post.id;
  clear(); pidStaff = (await MO.req("POST", "/api/posts", { text: "منشور المشرف", community: cid })).post.id;
});
test.after(() => H.app.close());

test("guard off (no guard key) = v2.61: a matching comment and edit are published", async () => {
  await setAm({ ...DEF });
  const r = await cmt(U5, "غبي بدون حارس"); assert.equal(r.status, 200); assert.equal(r.comment.status, "published");
  clear(); const p = (await U5.req("POST", "/api/posts", { text: "نص أول للمحرر", community: cid })).post;
  clear(); const e = await U5.req("PATCH", `/api/posts/${p.id}`, { text: "غبي بعد التعديل" }); assert.equal(e.status, 200); assert.match(e.post.text, /غبي/);
  assert.equal(await strikes(U5.id), 0);
});

test("comment hit with «التعليقات» OFF: 400 autoguard, strike + timed mute, comment not stored", async () => {
  await setAm({ ...DEF, guard: guard() }); // v2 comments rules are not on
  const r = await cmt(U1, "انت غبي جدا تعليق");
  assert.equal(r.status, 400); assert.equal(r.code, "autoguard"); assert.equal(r.guard.n, 1); assert.equal(r.guard.max, 3);
  assert.ok(!JSON.stringify(r).includes("يا حمار"), "word list never leaks");
  assert.equal(await stored("انت غبي جدا تعليق"), 0);
  assert.equal(await strikes(U1.id), 1);
  const m = await mem(U1.id); assert.equal(m.role, "muted"); assert.ok(new Date(m.muted_until) > new Date());
});

test("guard-muted member cannot comment (403 muted, Arabic), even clean text", async () => {
  const r = await cmt(U1, "تعليق نظيف تماما");
  assert.equal(r.status, 403); assert.equal(r.code, "muted"); assert.match(r.error || r.message || JSON.stringify(r), /مكتوم/);
  assert.equal(await stored("تعليق نظيف تماما"), 0);
});

test("guard lock (indefinite) blocks comments with the lock message", async () => {
  await db().run("UPDATE memberships SET role='member', muted_until=NULL WHERE community=$1 AND user_id=$2", [cid, U4.id]);
  clear(); await H.app.ctx.services.communities.sanction("system", cid, U4.id, "mute", { indefinite: true, ruleId: "autoguard_lock" });
  assert.equal((await mem(U4.id)).muted_until, null);
  const r = await cmt(U4, "تعليق بعد القفل"); assert.equal(r.status, 403); assert.equal(r.code, "muted"); assert.equal(r.locked, true);
  assert.match(JSON.stringify(r), /موقوف عن الكتابة/);
});

test("H3-01: a manually (timed) muted member cannot comment; after unmute or once the mute elapsed they can", async () => {
  await setAm({ ...DEF });
  clear(); assert.equal((await MO.req("POST", `/api/communities/${cid}/members/${U2.id}/discipline`, { action: "mute", hours: 2, reason: "اختبار" })).status, 200);
  assert.equal((await mem(U2.id)).role, "muted");
  const r = await cmt(U2, "تعليق من مكتوم يدويا"); assert.equal(r.status, 403); assert.equal(r.code, "muted");
  assert.equal(await stored("تعليق من مكتوم يدويا"), 0);
  // elapsed but not yet swept → not blocked
  await db().run("UPDATE memberships SET muted_until=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 60e3).toISOString(), cid, U2.id]);
  assert.equal((await cmt(U2, "تعليق بعد انتهاء المدة")).status, 200);
  // manual unmute path
  await db().run("UPDATE memberships SET muted_until=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() + 36e5).toISOString(), cid, U2.id]);
  assert.equal((await cmt(U2, "ما زال مكتوما")).status, 403);
  clear(); assert.equal((await MO.req("POST", `/api/communities/${cid}/members/${U2.id}/discipline`, { action: "unmute" })).status, 200);
  assert.equal((await cmt(U2, "بعد رفع الكتم")).status, 200);
});

test("banned stays 403; staff comment freely (guard exempt)", async () => {
  await setAm({ ...DEF, guard: guard() });
  for (const c of [O, MO]) { const r = await cmt(c, "غبي من الطاقم " + c.id); assert.equal(r.status, 200, "staff exempt"); }
  assert.equal(await strikes(MO.id), 0);
  clear(); await H.app.ctx.services.communities.sanction(MO.id, cid, U5.id, "ban", {});
  assert.equal((await cmt(U5, "تعليق محظور")).status, 403);
});

test("edit hit: 400 autoguard, original published text preserved (no version), strike counted", async () => {
  await setAm({ ...DEF, guard: guard() });
  clear(); const p = (await U3.req("POST", "/api/posts", { text: "النص الاصلي المنشور", community: cid })).post;
  assert.ok(p && p.id);
  const versions = async () => Number((await db().get("SELECT COUNT(*) n FROM post_versions WHERE post_id=$1", [p.id])).n);
  const v0 = await versions();
  clear(); const e = await U3.req("PATCH", `/api/posts/${p.id}`, { text: "تعديل فيه يا حمار" });
  assert.equal(e.status, 400); assert.equal(e.code, "autoguard"); assert.equal(e.guard.n, 1);
  const row = await db().get("SELECT text, edited FROM posts WHERE id=$1", [p.id]);
  assert.equal(row.text, "النص الاصلي المنشور"); assert.ok(!row.edited);
  assert.equal(await versions(), v0);
  assert.equal(await strikes(U3.id), 1);
});

test("edits:false → edit not guarded; comments:false → comment not guarded; staff edit exempt", async () => {
  await setAm({ ...DEF, guard: guard({ edits: false, comments: false }) });
  const p = await db().get("SELECT id FROM posts WHERE author=$1 AND community=$2", [U3.id, cid]);
  await db().run("UPDATE memberships SET role='member', muted_until=NULL WHERE community=$1 AND user_id=$2", [cid, U3.id]);
  clear(); const e = await U3.req("PATCH", `/api/posts/${p.id}`, { text: "غبي والتعديل غير محروس" }); assert.equal(e.status, 200);
  const c = await cmt(U3, "غبي والتعليق غير محروس"); assert.equal(c.status, 200);
  await setAm({ ...DEF, guard: guard() });
  clear(); const s = await MO.req("PATCH", `/api/posts/${pidStaff}`, { text: "غبي من المشرف" }); assert.equal(s.status, 200);
});
