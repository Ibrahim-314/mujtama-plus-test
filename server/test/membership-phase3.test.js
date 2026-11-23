/* v2.158 — phase 3: Free / Plus ceilings wired into the services, end to end.
 * Free + Plus accounts · every ceiling crossed · upgrade / expiry / revoke · parallel requests can't cross a ceiling ·
 * direct API calls (no session, a forged tier in the body) · usage shown with used / allowed / what to do · nothing deleted. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, admin, free, plus; const joiners = [];
const db = () => H.app.ctx.db;
const M = () => H.app.ctx.services.membership;
const clear = () => H.app.ctx.rl.w.clear();
const now = () => new Date().toISOString();
const n = async (sql, p) => Number((await db().get(sql, p)).n);
const mk = async (handle) => {
  clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), c.id]);
  return c;
};
const grantPlus = async (c) => { clear(); const r = await admin.req("POST", "/api/admin/ai/grants", { user: c.handle, days: 30 }); assert.equal(r.status, 200, r.error); };
const fillSaved = async (c, k, pre) => { for (let i = 0; i < k; i++) await db().run("INSERT INTO saved_searches(id,user_id,q,filters,alert,last_checked,new_count,created_at) VALUES($1,$2,$3,$4,1,$5,0,$5)", [pre + i, c.id, "q" + pre + i, "{}", now()]); };
const fillCols = async (c, k, pre) => { for (let i = 0; i < k; i++) await db().run("INSERT INTO collections(id,owner,name,position,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$5)", [pre + i, c.id, "م" + i, i, now()]); };

test.before(async () => {
  H = await boot();
  admin = await mk("p3_admin"); free = await mk("p3_free"); plus = await mk("p3_plus");
  for (let i = 0; i < 6; i++) joiners.push(await mk("p3_j" + i));
  await grantPlus(plus);
});
test.after(() => H.app.close());

test("usage: used / allowed / near / what to do, per member, from the server", async () => {
  await fillSaved(free, 20, "u");
  const u = (await free.req("GET", "/api/membership/usage")).usage;
  const s = u.find((x) => x.key === "saved_searches");
  assert.deepEqual([s.used, s.limit, s.tier, s.plusLimit, s.pct, s.near, s.full], [20, 25, "free", 100, 80, true, false]);
  assert.match(s.advice, /احذف/);
  assert.equal(u.find((x) => x.key === "quiz_attempts_daily").used, null, "per-lesson ceilings are shown where they apply");
  const me = await free.req("GET", "/api/membership/me"); assert.ok(Array.isArray(me.usage));
  const p = (await plus.req("GET", "/api/membership/usage")).usage.find((x) => x.key === "teams_owned");
  assert.equal(p.limit, 20); assert.equal(p.tier, "plus");
  clear(); const anon = await new H.Client().req("GET", "/api/membership/usage"); assert.equal(anon.status, 401);
});

test("the message says used / allowed, what to do, and offers Plus once — Plus members get no upsell", async () => {
  await fillSaved(free, 5, "v");
  clear(); const r = await free.req("POST", "/api/search/saved", { q: "زيادة" });
  assert.equal(r.status, 409); assert.equal(r.code, "quota_reached");
  assert.match(r.error, /25 من 25/); assert.match(r.error, /احذف بحثًا/); assert.match(r.error, /Plus ليصير الحد 100/);
  assert.equal(r.quota.upgrade, "#/membership");
  await fillSaved(plus, 100, "w");
  clear(); const p = await plus.req("POST", "/api/search/saved", { q: "زيادة" });
  assert.equal(p.status, 409); assert.doesNotMatch(p.error, /اشترك/); assert.equal(p.quota.upgrade, null);
});

test("direct API: a forged tier in the body changes nothing; no session → 401", async () => {
  clear(); const r = await free.req("POST", "/api/search/saved", { q: "مزور", tier: "plus", plan: "ai_plus", plus: true });
  assert.equal(r.status, 409, "still Free");
  clear(); assert.equal((await new H.Client().req("POST", "/api/collections", { name: "x" })).status, 401);
  clear(); assert.equal((await new H.Client().req("POST", "/api/teams", { name: "فريق مجهول" })).status, 401);
  clear(); assert.equal((await free.req("PUT", "/api/admin/membership/limits", { limits: { collections: { free: 9999 } } })).status, 403);
});

test("parallel requests can't cross a ceiling: saved searches, collections, teams", async () => {
  const c = await mk("p3_race");
  await fillSaved(c, 23, "r");
  let rs = await Promise.all(Array.from({ length: 8 }, (_, i) => { clear(); return c.req("POST", "/api/search/saved", { q: "سباق " + i }); }));
  assert.equal(rs.filter((r) => r.status === 200).length, 2, rs.map((r) => r.status).join(","));
  assert.equal(await n("SELECT COUNT(*) n FROM saved_searches WHERE user_id=$1", [c.id]), 25);

  clear(); await c.req("GET", "/api/collections"); // first visit may import legacy bookmarks into a collection
  await fillCols(c, 48 - (await n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id])), "rc");
  rs = await Promise.all(Array.from({ length: 8 }, (_, i) => { clear(); return c.req("POST", "/api/collections", { name: "سباق " + i }); }));
  assert.equal(rs.filter((r) => r.status === 200).length, 2, JSON.stringify(rs.map((r) => [r.status, r.code, r.error])));
  assert.equal(await n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id]), 50);

  rs = await Promise.all(Array.from({ length: 9 }, (_, i) => { clear(); return c.req("POST", "/api/teams", { name: "فريق السباق " + i, kind: "project" }); }));
  assert.equal(rs.filter((r) => r.status === 200).length, 5, rs.map((r) => r.status + ":" + (r.code || "")).join(","));
  assert.equal(await n("SELECT COUNT(*) n FROM wt_teams WHERE owner_id=$1 AND status<>'archived'", [c.id]), 5);
  assert.equal(await n("SELECT COUNT(*) n FROM wt_members m JOIN wt_teams t ON t.id=m.team_id WHERE t.owner_id=$1", [c.id]), 5, "no orphan members");
});

test("the guard undoes only its own row when another instance raced it (post-insert re-count)", async () => {
  const c = await mk("p3_multi");
  clear(); await c.req("GET", "/api/collections");
  await fillCols(c, 49 - (await n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id])), "mi");
  // simulate another server instance inserting between our count and our insert
  const r = M().guarded(c.id, "collections", {
    count: async () => n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id]),
    create: async () => { await fillCols(c, 1, "other"); await db().run("INSERT INTO collections(id,owner,name,position,updated_at,created_at) VALUES('mine1',$1,'لي',99,$2,$2)", [c.id, now()]); return "mine1"; },
    undo: (cid) => db().run("DELETE FROM collections WHERE id=$1", [cid])
  });
  await assert.rejects(r, (e) => e.code === "quota_reached");
  assert.equal(await n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id]), 50, "the other instance's row stays; ours is undone");
  assert.equal(await n("SELECT COUNT(*) n FROM collections WHERE id='mine1'"), 0);
});

test("team members: parallel joins through one link stop at the owner's ceiling; invite uses are given back", async () => {
  clear(); await admin.req("PUT", "/api/admin/membership/limits", { limits: { team_members: { free: 4 } } });
  const owner = await mk("p3_owner");
  clear(); const t = await owner.req("POST", "/api/teams", { name: "فريق الروابط", kind: "project" }); assert.equal(t.status, 200, t.error);
  clear(); const inv = await owner.req("POST", `/api/teams/${t.id}/invites`, { link: true, days: 7 }); assert.ok(inv.code, inv.error);
  const rs = await Promise.all(joiners.map((j) => { clear(); return j.req("POST", "/api/teams/join", { code: inv.code }); }));
  assert.equal(rs.filter((r) => r.status === 200).length, 3, rs.map((r) => r.status + ":" + (r.code || "")).join(","));
  assert.ok(rs.filter((r) => r.status !== 200).every((r) => r.code === "full"));
  assert.match(rs.find((r) => r.code === "full").error, /4 من 4/);
  assert.equal(await n("SELECT COUNT(*) n FROM wt_members WHERE team_id=$1", [t.id]), 4);
  assert.equal(Number((await db().get("SELECT uses FROM wt_invites WHERE code=$1", [inv.code])).uses), 3);
  // the owner upgrades → the team's ceiling follows the owner
  await grantPlus(owner);
  clear(); const more = await joiners[5].req("POST", "/api/teams/join", { code: inv.code });
  if (rs[5].status === 200) assert.equal(more.code, "member"); else assert.equal(more.status, 200, more.error);
  // lowering the number never removes anybody
  clear(); await admin.req("PUT", "/api/admin/membership/limits", { limits: { team_members: { free: 2, plus: 2 } } });
  assert.ok(await n("SELECT COUNT(*) n FROM wt_members WHERE team_id=$1", [t.id]) >= 4, "members kept");
  clear(); await admin.req("PUT", "/api/admin/membership/limits", { limits: { team_members: { free: 50, plus: 150 } } });
});

test("membership changes: upgrade raises at once; expiry and revoke return Free ceilings and delete nothing", async () => {
  const c = await mk("p3_cycle");
  clear(); await c.req("GET", "/api/collections");
  await fillCols(c, 50 - (await n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id])), "cy");
  clear(); assert.equal((await c.req("POST", "/api/collections", { name: "قبل" })).status, 409);
  await grantPlus(c);
  clear(); assert.equal((await c.req("POST", "/api/collections", { name: "مع Plus" })).status, 200);
  await fillCols(c, 10, "cz");
  const had = await n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id]);
  clear(); assert.equal((await admin.req("POST", "/api/admin/ai/grants/revoke", { user: c.handle })).status, 200);
  assert.equal(await M().isPlus(c.id), false);
  clear(); const r = await c.req("POST", "/api/collections", { name: "بعد الإلغاء" });
  assert.equal(r.status, 409); assert.match(r.error, new RegExp(`${had} من 50`));
  assert.equal(await n("SELECT COUNT(*) n FROM collections WHERE owner=$1", [c.id]), had, "nothing deleted");
  clear(); const list = await c.req("GET", "/api/collections"); assert.equal((list.collections || list).length, had, "old data still readable");
  const u = (await c.req("GET", "/api/membership/usage")).usage.find((x) => x.key === "collections");
  assert.equal(u.over, true); assert.equal(u.full, true);
});

test("AI: the assistant's per-member cap is unset until an admin sets one; then the server enforces it", async () => {
  const AI = H.app.ctx.services.ai, c = await mk("p3_ai");
  clear(); const pl = (await admin.req("GET", "/api/admin/ai/plans")); const cur = (pl.plans || pl).find((x) => x.slug === "ai_plus");
  assert.equal(cur.limits.assistant, null, "not set yet → no invented number");
  clear(); const up = await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { limits: { assistant: { chars: 500, costUsd: 1 } } });
  assert.equal(up.status, 200, up.error); assert.equal(up.plan.limits.assistant.chars, 500);
  await AI.meter(c.id, "assistant", { chars: 480 });
  await assert.rejects(AI.checkCaps(c.id, "assistant", up.plan.limits.assistant, 50), (x) => x.status === 429);
  clear(); assert.equal((await c.req("PUT", "/api/admin/ai/plans/ai_plus", { limits: { assistant: { chars: 1e7, costUsd: 9 } } })).status, 403);
  clear(); const off = await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { limits: { assistant: null } });
  assert.equal(off.status, 200, off.error); assert.equal(off.plan.limits.assistant, null);
});
