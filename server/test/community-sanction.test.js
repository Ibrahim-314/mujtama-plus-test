/* v2.62 T3 «مهندس العقوبات» — communities.sanction(): indefinite mute (muted_until NULL, never auto-lifted by
 * unmuteDue), ruleId recorded in community_sanctions.rule_id, unmute {reset} lifts the guard strikes; timed mute,
 * hours clamp, ban/warn/unmute and the discipline route behave exactly as before. No migration. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H, O, M1, U1, U2, U3, cid;
const mk = async (handle) => { H.app.ctx.rl.w?.clear?.(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const db = () => H.app.ctx.db;
const svc = () => H.app.ctx.services.communities;
const mem = (u) => db().get("SELECT role, prev_role, status, muted_until, warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, u]);
const sns = (u) => db().all("SELECT kind, until, rule_id, reason, actor, lifted_at, lifted_by FROM community_sanctions WHERE community=$1 AND user_id=$2 ORDER BY created_at, id", [cid, u]);
const H1 = 3600e3;

test.before(async () => {
  H = await boot();
  const all = []; for (const h of ["own_s3", "mod_s3", "usr_s3a", "usr_s3b", "usr_s3c"]) all.push(await mk(h)); [O, M1, U1, U2, U3] = all;
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع العقوبات", desc: "اختبار", topic: "dev" })).community.id;
  for (const c of [M1, U1, U2, U3]) await c.req("PUT", `/api/communities/${cid}/membership`);
  assert.equal((await O.req("PATCH", `/api/communities/${cid}/members/${M1.id}`, { role: "moderator" })).status, 200);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w?.clear?.());

test("indefinite mute: muted_until and until are NULL, rule_id stored, role remembered", async () => {
  await svc().sanction("system", cid, U1.id, "mute", { indefinite: true, ruleId: "autoguard_lock", reason: "عبارة ممنوعة" });
  const m = await mem(U1.id);
  assert.equal(m.role, "muted"); assert.equal(m.status, "muted"); assert.equal(m.prev_role, "member"); assert.equal(m.muted_until, null);
  const s = (await sns(U1.id)).filter(x => x.kind === "mute");
  assert.equal(s.length, 1); assert.equal(s[0].until, null); assert.equal(s[0].rule_id, "autoguard_lock"); assert.equal(s[0].actor, "system"); assert.equal(s[0].lifted_at, null);
});

test("unmuteDue never auto-lifts an indefinite mute, even far in the future", async () => {
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 400 * 24 * H1; // a year+ later
    await H.app.ctx.services.cmod.unmuteDue();
  } finally { Date.now = realNow; }
  // unmuteDue uses now() (ISO string); also exercise the SQL directly with a far-future clock
  await db().run("UPDATE memberships SET role=COALESCE(prev_role,'member'), status='active', prev_role=NULL, muted_until=NULL WHERE role='muted' AND muted_until IS NOT NULL AND muted_until < $1", ["9999-12-31T00:00:00.000Z"]);
  const m = await mem(U1.id); assert.equal(m.role, "muted"); assert.equal(m.muted_until, null);
  const s = (await sns(U1.id)).find(x => x.kind === "mute"); assert.equal(s.lifted_at, null, "the sanction row stays active");
});

test("a manual unmute lifts the indefinite mute and restores the role", async () => {
  assert.equal((await M1.req("POST", `/api/communities/${cid}/members/${U1.id}/discipline`, { action: "unmute" })).status, 200);
  const m = await mem(U1.id); assert.equal(m.role, "member"); assert.equal(m.status, "active"); assert.equal(m.prev_role, null);
  const s = (await sns(U1.id)).find(x => x.kind === "mute"); assert.ok(s.lifted_at); assert.equal(s.lifted_by, M1.id);
});

test("timed mute unchanged: default 24h, clamp 1..720h, rule_id NULL without ruleId, indefinite only when === true", async () => {
  const t0 = Date.now();
  await svc().sanction(M1.id, cid, U2.id, "mute", {});
  let m = await mem(U2.id); let d = Date.parse(m.muted_until) - t0; assert.ok(Math.abs(d - 24 * H1) < 60e3, "default 24h");
  assert.equal((await sns(U2.id)).find(x => x.kind === "mute").rule_id, null);
  await svc().sanction(M1.id, cid, U2.id, "mute", { hours: 100000 });
  m = await mem(U2.id); d = Date.parse(m.muted_until) - Date.now(); assert.ok(Math.abs(d - 720 * H1) < 60e3, "max 720h");
  await svc().sanction(M1.id, cid, U2.id, "mute", { hours: 0.01, indefinite: "true" });
  m = await mem(U2.id); assert.ok(m.muted_until, "string 'true' is not indefinite"); d = Date.parse(m.muted_until) - Date.now(); assert.ok(Math.abs(d - H1) < 60e3, "min 1h");
  assert.equal(m.prev_role, "member", "re-muting keeps the original role");
  // timed mutes still expire through unmuteDue
  await db().run("UPDATE memberships SET muted_until=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 1000).toISOString(), cid, U2.id]);
  await db().run("UPDATE community_sanctions SET until=$1 WHERE community=$2 AND user_id=$3 AND kind='mute'", [new Date(Date.now() - 1000).toISOString(), cid, U2.id]);
  assert.ok((await H.app.ctx.services.cmod.unmuteDue()) >= 1);
  m = await mem(U2.id); assert.equal(m.role, "member"); assert.equal(m.muted_until, null);
  assert.ok((await sns(U2.id)).filter(x => x.kind === "mute").every(x => x.lifted_by === "system"));
});

test("timed mute with ruleId records it; ruleId is capped to 64 chars", async () => {
  await svc().sanction("system", cid, U3.id, "mute", { hours: 1, ruleId: "autoguard" });
  let s = (await sns(U3.id)).find(x => x.kind === "mute" && !x.lifted_at); assert.equal(s.rule_id, "autoguard"); assert.ok(s.until);
  await svc().sanction("system", cid, U3.id, "unmute");
  await svc().sanction("system", cid, U3.id, "mute", { hours: 1, ruleId: "x".repeat(200) });
  s = (await sns(U3.id)).find(x => x.kind === "mute" && !x.lifted_at); assert.equal(s.rule_id.length, 64);
  await svc().sanction("system", cid, U3.id, "unmute");
});

test("warn records ruleId; unmute {reset:true} lifts only active autoguard strikes, manual warnings stay", async () => {
  await svc().sanction(M1.id, cid, U3.id, "warn", { reason: "يدوي" });
  await svc().sanction("system", cid, U3.id, "warn", { ruleId: "autoguard" });
  await svc().sanction("system", cid, U3.id, "warn", { ruleId: "autoguard" });
  await svc().sanction("system", cid, U3.id, "mute", { indefinite: true, ruleId: "autoguard_lock" });
  assert.equal((await mem(U3.id)).warnings, 3, "memberships.warnings still counts every warn");
  // plain unmute (no reset) leaves strikes active
  await svc().sanction(M1.id, cid, U3.id, "unmute");
  let w = (await sns(U3.id)).filter(x => x.kind === "warn");
  assert.equal(w.filter(x => x.rule_id === "autoguard" && !x.lifted_at).length, 2, "no reset → strikes kept");
  await svc().sanction("system", cid, U3.id, "mute", { indefinite: true, ruleId: "autoguard_lock" });
  await svc().sanction(M1.id, cid, U3.id, "unmute", { reset: true });
  w = (await sns(U3.id)).filter(x => x.kind === "warn");
  assert.ok(w.filter(x => x.rule_id === "autoguard").every(x => x.lifted_at && x.lifted_by === M1.id), "strikes reset");
  assert.equal(w.find(x => x.rule_id === null).lifted_at, null, "manual warning untouched");
  assert.equal((await mem(U3.id)).role, "member");
});

test("ban records ruleId and lifts an active indefinite mute; old ban behaviour unchanged", async () => {
  await svc().sanction("system", cid, U3.id, "mute", { indefinite: true, ruleId: "autoguard_lock" });
  await svc().sanction(O.id, cid, U3.id, "ban", { reason: "سبب", ruleId: "autoguard" });
  const m = await mem(U3.id); assert.equal(m.role, "banned"); assert.equal(m.prev_role, "member"); assert.equal(m.muted_until, null);
  const s = await sns(U3.id);
  assert.ok(s.filter(x => x.kind === "mute").every(x => x.lifted_at), "mutes lifted by the ban");
  const b = s.find(x => x.kind === "ban"); assert.equal(b.rule_id, "autoguard"); assert.equal(b.lifted_at, null);
  await svc().sanction(O.id, cid, U3.id, "unban");
  assert.equal(await mem(U3.id), undefined, "unban removes the membership row, as before");
});

test("discipline route unchanged: timed mute via API has until and NULL rule_id", async () => {
  await U3.req("PUT", `/api/communities/${cid}/membership`);
  const r = await M1.req("POST", `/api/communities/${cid}/members/${U3.id}/discipline`, { action: "mute", hours: 2, reason: "اختبار" });
  assert.equal(r.status, 200); assert.ok(r.member.mutedUntil); assert.equal(r.member.role, "muted");
  const s = (await sns(U3.id)).find(x => x.kind === "mute" && !x.lifted_at); assert.equal(s.kind, "mute"); assert.equal(s.rule_id, null); assert.ok(s.until);
  const d = Date.parse(s.until) - Date.now(); assert.ok(Math.abs(d - 2 * H1) < 60e3);
  assert.equal((await M1.req("POST", `/api/communities/${cid}/members/${U3.id}/discipline`, { action: "unmute" })).status, 200);
});
