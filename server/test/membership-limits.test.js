/* v2.157 — Free / Plus usage limits (owner-approved numbers, 2026-11-23):
 *   saved searches 25 / 100 · collections 50 / 200 · quiz attempts per lesson per 24 h 10 / 30 · active teams owned 5 / 20 ·
 *   members per team 50 / 150 (by the team owner's tier).
 * Checks: the server enforces (not the UI) · Plus raises the ceiling · admin edits every number without code (members cannot) ·
 * nothing a member already has is removed when they are over a ceiling · archive → reopen cannot bypass it. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const AD = (...a) => require("./admin-shim").shim(H)(...a); // v2.167: removed admin routes → service fixtures (see admin-shim.js)

let H, admin, free, plus, legacy;
const db = () => H.app.ctx.db;
const M = () => H.app.ctx.services.membership;
const clear = () => H.app.ctx.rl.w.clear();
const mk = async (handle) => {
  clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), c.id]);
  return c;
};
const grantPlus = async (c) => { clear(); const r = await AD(admin, "POST", "/api/admin/ai/grants", { user: c.handle, days: 30 }); assert.equal(r.status, 200, r.error); };
const newTeam = (c, i) => { clear(); return c.req("POST", "/api/teams", { name: "فريق رقم " + i, kind: "project" }); };

test.before(async () => {
  H = await boot();
  admin = await mk("ql_admin"); free = await mk("ql_free"); plus = await mk("ql_plus"); legacy = await mk("ql_legacy");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [admin.id])).role, "admin");
  await grantPlus(plus);
});
test.after(() => H.app.close());

test("defaults are the approved numbers, and the tier comes from the server rows", async () => {
  const q = await M().quotas();
  assert.deepEqual(Object.fromEntries(Object.entries(q).map(([k, v]) => [k, [v.free, v.plus]])),
    { saved_searches: [25, 100], collections: [50, 200], quiz_attempts_daily: [10, 30], teams_owned: [5, 20], team_members: [50, 150] });
  assert.equal(await M().isPlus(free.id), false); assert.equal(await M().isPlus(plus.id), true);
  assert.equal((await M().limitFor(free.id, "quiz_attempts_daily")).limit, 10);
  assert.equal((await M().limitFor(plus.id, "quiz_attempts_daily")).limit, 30);
  assert.equal((await M().limitFor(plus.id, "team_members")).limit, 150);
  const me = await plus.req("GET", "/api/membership/me");
  assert.equal(me.limits.find((x) => x.key === "collections").mine, 200);
  const plans = await free.req("GET", "/api/membership/plans");
  assert.equal(plans.plus.quotas.find((x) => x.key === "saved_searches").plus, 100);
});

test("saved searches: Free stops at 25 on the server, Plus goes on", async () => {
  for (let i = 0; i < 25; i++) { clear(); const r = await free.req("POST", "/api/search/saved", { q: "بحث " + i }); assert.equal(r.status, 200, r.error); }
  clear(); const r = await free.req("POST", "/api/search/saved", { q: "زيادة" });
  assert.equal(r.status, 409); assert.equal(r.code, "quota_reached"); assert.equal(r.quota.limit, 25); assert.equal(r.quota.plusLimit, 100);
  for (let i = 0; i < 26; i++) await db().run("INSERT INTO saved_searches(id,user_id,q,filters,alert,last_checked,new_count,created_at) VALUES($1,$2,$3,$4,1,$5,0,$5)", ["ssx" + i, plus.id, "q" + i, "{}", new Date().toISOString()]);
  clear(); assert.equal((await plus.req("POST", "/api/search/saved", { q: "ممكن" })).status, 200);
});

test("collections: Free 50 / Plus 200, also through the offline sync path", async () => {
  for (let i = 0; i < 50; i++) await db().run("INSERT INTO collections(id,owner,name,position,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$5)", ["colq" + i, free.id, "م" + i, i, new Date().toISOString()]);
  clear(); const r = await free.req("POST", "/api/collections", { name: "جديدة" });
  assert.equal(r.status, 409); assert.equal(r.code, "quota_reached");
  clear(); await plus.req("POST", "/api/collections", { name: "أولى" });
  for (let i = 0; i < 60; i++) await db().run("INSERT INTO collections(id,owner,name,position,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$5)", ["colp" + i, plus.id, "م" + i, i + 1, new Date().toISOString()]);
  clear(); assert.equal((await plus.req("POST", "/api/collections", { name: "بعد الستين" })).status, 200);
});

test("teams: Free owns 5 active teams, Plus 20; archive → reopen cannot bypass it", async () => {
  for (let i = 0; i < 5; i++) { const r = await newTeam(free, i); assert.equal(r.status, 200, r.error); }
  const r6 = await newTeam(free, 6); assert.equal(r6.status, 409); assert.equal(r6.code, "quota_reached"); assert.equal(r6.quota.plusLimit, 20);
  const mine = (await free.req("GET", "/api/teams")).teams;
  clear(); assert.equal((await free.req("POST", `/api/teams/${mine[0].id}/state`, { status: "archived" })).status, 200);
  assert.equal((await newTeam(free, 7)).status, 200, "an archived team frees a slot");
  clear(); const back = await free.req("POST", `/api/teams/${mine[0].id}/state`, { status: "active" });
  assert.equal(back.status, 409); assert.equal(back.code, "quota_reached");
  for (let i = 0; i < 6; i++) assert.equal((await newTeam(plus, i)).status, 200, "Plus is past the Free ceiling");
});

test("existing data is kept: a member already above the new ceiling loses nothing", async () => {
  const now = new Date().toISOString();
  for (let i = 0; i < 8; i++) {
    await db().run("INSERT INTO wt_teams (id, owner_id, kind, name, about, visibility, status, created_at, updated_at) VALUES ($1,$2,'project',$3,'', 'private','active',$4,$4)", ["wtold" + i, legacy.id, "قديم " + i, now]);
    await db().run("INSERT INTO wt_members (team_id, user_id, role, joined_at) VALUES ($1,$2,'owner',$3)", ["wtold" + i, legacy.id, now]);
  }
  const before = (await legacy.req("GET", "/api/teams")).teams.length;
  assert.equal(before, 8);
  assert.equal((await newTeam(legacy, 9)).status, 409, "no new team while above the ceiling");
  assert.equal((await legacy.req("GET", "/api/teams")).teams.length, 8, "all 8 old teams still there");
  clear(); assert.equal((await legacy.req("POST", "/api/teams/wtold0/state", { status: "completed" })).status, 200, "owners still manage them");
});

test("team members: the ceiling follows the owner's tier", async () => {
  const t = (await plus.req("GET", "/api/teams")).teams[0];
  const v = await plus.req("GET", "/api/teams/" + t.id);
  assert.equal(v.options.maxMembers, 150);
  const f = (await free.req("GET", "/api/teams")).teams.find((x) => x.status === "active" || x.status === "نشط") || (await free.req("GET", "/api/teams")).teams[0];
  assert.equal((await free.req("GET", "/api/teams/" + f.id)).options.maxMembers, 50);
});

test("v2.167: the numbers are fixed in app-defaults — the admin limits API is gone for everyone and an old stored override is not read", async () => {
  for (const c of [free, admin]) {
    clear(); assert.equal((await c.req("PUT", "/api/admin/membership/limits", { limits: { saved_searches: { free: 999 } } })).status, 404);
    clear(); assert.equal((await c.req("GET", "/api/admin/membership/limits")).status, 404);
  }
  await db().run("INSERT INTO membership_meta(key,value,updated_at) VALUES('quotas',$1,$2) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify({ saved_searches: { free: 999, plus: 999 } }), new Date().toISOString()]);
  assert.deepEqual([(await M().quotas()).saved_searches.free, (await M().quotas()).saved_searches.plus], [25, 100]);
  await db().run("DELETE FROM membership_meta WHERE key='quotas'");
});

test("Plus ending returns the Free ceiling, without deleting anything", async () => {
  await db().run("UPDATE ai_subscriptions SET period_end=$1 WHERE user_id=$2", [new Date(Date.now() - 1000).toISOString(), plus.id]);
  assert.equal(await M().isPlus(plus.id), false);
  const n = Number((await db().get("SELECT COUNT(*) n FROM collections WHERE owner=$1", [plus.id])).n);
  clear(); assert.equal((await plus.req("POST", "/api/collections", { name: "بعد الانتهاء" })).status, 409);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM collections WHERE owner=$1", [plus.id])).n), n, "nothing removed");
});
