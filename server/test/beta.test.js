/* Phase 54 — invite-based beta on top of phase 50 (waitlist, launch codes, LAUNCH_MODE): waves in order + capacity, waitlist →
 * wave invites → sign-up with the code → cohort member, member invite quotas, badge, feedback (screenshot + device) → triage
 * board → reply notification, NPS / satisfaction surveys, cohort dashboard (activation, D1/D7, client errors), flag kill switch +
 * cohort early access. PostgreSQL. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { users } = require("./pi-stub");

const DAY = 864e5;
const env = { LAUNCH_MODE: "open" };
let H, admin, mod, plain, t1, wave1, wave2;
const db = () => H.app.ctx.db, S = () => H.app.ctx.services;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
async function mk(handle, extra = {}) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123", ...extra });
  c.status = r.status; c.code = r.code; if (r.user) { c.id = r.user.id; c.handle = handle; }
  return c;
}
test.before(async () => {
  H = await boot({ launchOpts: { env }, betaOpts: { env, jobs: false }, pointsOpts: { jobs: false } });
  users(H, null); // binary-safe Client.req (media uploads)
  admin = await mk("bt_admin"); mod = await mk("bt_mod"); plain = await mk("bt_plain");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  await db().run("UPDATE users SET role='moderator' WHERE id=$1", [mod.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 039: reversible, additive, data map", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '039_beta' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "039_beta"]);
  await assert.rejects(() => db().get("SELECT 1 FROM beta_cohorts"));
  assert.deepEqual(await mig.up(db()), ["039_beta", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  for (const m of require("../lib/compliance-lib").DATA_MAP.filter((x) => x.t.startsWith("beta_"))) await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [plain.id]);
});

test("waves: seeded 100 → 1000, opened in order, waitlist invites, sign-up with code joins the wave (invite mode)", async () => {
  assert.equal((await plain.req("GET", "/api/admin/beta/cohorts")).status, 403);
  const c = await mod.req("GET", "/api/admin/beta/cohorts"); assert.equal(c.status, 200);
  assert.deepEqual(c.items.map((x) => [x.wave, x.capacity, x.status]), [[1, 100, "planned"], [2, 1000, "planned"]]);
  assert.equal(c.mode, "open");
  [wave1, wave2] = c.items;
  assert.equal((await mod.req("POST", `/api/admin/beta/cohorts/${wave1.id}/open`, {})).status, 403); // waves are admin-only
  assert.equal((await admin.req("POST", `/api/admin/beta/cohorts/${wave2.id}/open`, {})).code, "previous_wave_planned");
  // a small wave 1 so capacity is testable
  assert.equal((await admin.req("PUT", `/api/admin/beta/cohorts/${wave1.id}`, { capacity: 4, inviteQuota: 2 })).cohort.capacity, 4);
  env.LAUNCH_MODE = "invite";
  for (const who of ["wl_one", "wl_two", "wl_three"]) assert.equal((await new H.Client().req("POST", "/api/launch/waitlist", { contact: who })).status, 200);
  const o = await admin.req("POST", `/api/admin/beta/cohorts/${wave1.id}/open`, { inviteWaitlist: true, count: 2 });
  assert.equal(o.status, 200, o.error); assert.equal(o.cohort.status, "open"); assert.equal(o.invited.length, 2);
  assert.equal(o.cohort.pendingInvites, 2); assert.equal(o.cohort.room, 2);
  assert.equal((await mk("bt_nocode")).code, "invite_required"); // phase 50 gate still applies
  t1 = await mk("bt_t1", { invite: o.invited[0].code }); assert.equal(t1.status, 200);
  const me = await t1.req("GET", "/api/beta/me"); assert.equal(me.member, true); assert.equal(me.cohort.wave, 1); assert.equal(me.quota, 2); assert.equal(me.invitesLeft, 2);
  assert.equal((await db().get("SELECT source FROM beta_members WHERE user_id=$1", [t1.id])).source, "waitlist");
  // staff add an existing account; already-member + unknown are skipped
  const add = await admin.req("POST", `/api/admin/beta/cohorts/${wave1.id}/members`, { handles: "@bt_plain, bt_t1 nobody_x" });
  assert.deepEqual(add.added, ["bt_plain"]); assert.deepEqual(add.skipped.map((s) => s.reason).sort(), ["already_member", "not_found"]);
  assert.equal((await plain.req("GET", "/api/beta/me")).member, true);
  env.LAUNCH_MODE = "open";
});

test("member invite quota, wave room, badge", async () => {
  const a = await t1.req("POST", "/api/beta/invites"); assert.equal(a.status, 200, a.error); assert.match(a.code, /^[A-Z0-9-]{8,12}$/);
  // wave capacity 4: t1 + plain + 1 pending waitlist code + this code → full
  assert.equal((await t1.req("POST", "/api/beta/invites")).code, "wave_full");
  await admin.req("PUT", `/api/admin/beta/cohorts/${wave1.id}`, { capacity: 100 });
  assert.equal((await t1.req("POST", "/api/beta/invites")).status, 200);
  assert.equal((await t1.req("POST", "/api/beta/invites")).code, "quota_exhausted");
  assert.equal((await mod.req("POST", "/api/beta/invites")).code, "not_beta");
  const friend = await mk("bt_friend", { invite: a.code }); assert.equal(friend.status, 200);
  assert.equal((await friend.req("GET", "/api/beta/me")).member, true);
  assert.equal((await db().get("SELECT source FROM beta_members WHERE user_id=$1", [friend.id])).source, "invite");
  const me = await t1.req("GET", "/api/beta/me"); assert.equal(me.invites.length, 2); assert.equal(me.invites.filter((i) => i.used).length, 1);
  assert.equal((await new H.Client().req("GET", "/api/beta/badge/bt_t1")).badge, true);
  assert.equal((await new H.Client().req("GET", "/api/beta/badge/bt_mod")).badge, false);
  await t1.req("PUT", "/api/beta/badge", { show: false });
  assert.equal((await new H.Client().req("GET", "/api/beta/badge/bt_t1")).badge, false);
  await t1.req("PUT", "/api/beta/badge", { show: true });
});

test("feedback with screenshot + device → triage board → staff reply notifies the tester", async () => {
  const m = await t1.req("POST", "/api/media", PNG, { "Content-Type": "image/png" }); assert.equal(m.status, 200, m.error);
  const other = await plain.req("POST", "/api/media", PNG, { "Content-Type": "image/png" });
  assert.equal((await t1.req("POST", "/api/beta/feedback", { kind: "bug", text: "زر النشر لا يعمل", mediaId: other.media.id })).code, "attachment_invalid");
  assert.equal((await t1.req("POST", "/api/beta/feedback", { kind: "rant", text: "xxx" })).status, 400);
  const f = await t1.req("POST", "/api/beta/feedback", { kind: "bug", text: "زر النشر لا يعمل أحياناً", mediaId: m.media.id, route: "#/compose", device: { platform: "Android", screen: "412x915", lang: "ar", piBrowser: true, release: "2.27.0", junk: "x".repeat(5000) } });
  assert.equal(f.status, 200, f.error); const fb = f.feedback;
  assert.equal(fb.status, "new"); assert.equal(fb.device.platform, "Android"); assert.equal(fb.device.piBrowser, 1); assert.equal(fb.device.junk, undefined); assert.match(fb.device.ua, /Mozilla/); assert.equal(fb.cohortId, wave1.id);
  await plain.req("POST", "/api/beta/feedback", { kind: "idea", text: "أريد وضعاً ليلياً أغمق" });
  assert.equal((await plain.req("GET", "/api/beta/feedback/" + fb.id)).status, 404); // someone else's feedback
  assert.equal((await plain.req("GET", "/api/admin/beta/feedback")).status, 403);
  const b = await mod.req("GET", "/api/admin/beta/feedback?kind=bug"); assert.equal(b.status, 200);
  assert.equal(b.items.length, 1); assert.equal(b.items[0].author, "@bt_t1"); assert.equal(b.columns.new, 2);
  const tr = await mod.req("PUT", "/api/admin/beta/feedback/" + fb.id, { status: "in_progress", priority: "high", assignee: "bt_mod", reply: "شكراً، نعمل على إصلاحه" });
  assert.equal(tr.status, 200, tr.error); assert.equal(tr.feedback.status, "in_progress"); assert.equal(tr.feedback.priority, "high");
  assert.equal((await mod.req("PUT", "/api/admin/beta/feedback/" + fb.id, { assignee: "bt_plain" })).status, 400);
  const v = await t1.req("GET", "/api/beta/feedback/" + fb.id);
  assert.equal(v.messages.length, 1); assert.equal(v.messages[0].by, "فريق مجتمع بلس"); assert.equal(v.feedback.statusLabel, "قيد التنفيذ");
  const n = await db().get("SELECT kind FROM notifications WHERE user_id=$1 AND kind='beta_feedback_reply'", [t1.id]); assert.ok(n, "reply notification");
  assert.equal((await t1.req("POST", `/api/beta/feedback/${fb.id}/reply`, { text: "يحدث عند ضعف الشبكة" })).messages.length, 2);
  assert.equal((await t1.req("GET", "/api/beta/feedback")).items.length, 1);
});

test("NPS + satisfaction micro-surveys", async () => {
  assert.equal((await t1.req("GET", "/api/beta/me")).survey, null); // just joined → no prompt yet
  await db().run("UPDATE beta_members SET joined_at=$1 WHERE user_id=$2", [new Date(Date.now() - 3 * DAY).toISOString(), t1.id]);
  const s = (await t1.req("GET", "/api/beta/me")).survey; assert.equal(s.kind, "nps"); assert.equal(s.max, 10);
  assert.equal((await t1.req("POST", "/api/beta/survey", { kind: "nps", score: 11 })).status, 400);
  assert.equal((await t1.req("POST", "/api/beta/survey", { kind: "nps", score: 9, comment: "رائع" })).status, 200);
  assert.equal((await t1.req("POST", "/api/beta/survey", { kind: "nps", score: 10 })).code, "already_answered");
  assert.equal((await t1.req("GET", "/api/beta/me")).survey.kind, "csat");
  await t1.req("POST", "/api/beta/survey/shown", { kind: "csat", dismissed: true });
  assert.equal((await t1.req("GET", "/api/beta/me")).survey, null);
  await plain.req("POST", "/api/beta/survey", { kind: "nps", score: 3 });
  await plain.req("POST", "/api/beta/survey", { kind: "csat", score: 4 });
});

test("cohort dashboard: activation, D1/D7 retention, client errors, NPS, top feedback", async () => {
  const p = await t1.req("POST", "/api/posts", { text: "أول منشور لي في النسخة التجريبية" }); assert.equal(p.status, 200, p.error);
  await new Promise((r) => setTimeout(r, 50));
  // t1 joined 3 days ago; active on day+1 (D1); plain joined 8 days ago, back on day 7
  const j1 = new Date(Date.now() - 3 * DAY).toISOString(), j2 = new Date(Date.now() - 8 * DAY).toISOString();
  await db().run("UPDATE beta_members SET joined_at=$1 WHERE user_id=$2", [j2, plain.id]);
  await db().run("INSERT INTO beta_activity(user_id,day) VALUES($1,$2),($3,$4) ON CONFLICT DO NOTHING", [t1.id, new Date(Date.parse(j1) + DAY).toISOString().slice(0, 10), plain.id, new Date(Date.parse(j2) + 7 * DAY).toISOString().slice(0, 10)]);
  await t1.req("POST", "/api/client-errors", { message: "TypeError: x is undefined", stack: "at a\nat b", url: "/#/compose", release: "2.27.0" });
  await mod.req("POST", "/api/client-errors", { message: "not a tester error", stack: "at z\nat y" });
  const d = await mod.req("GET", "/api/admin/beta/dashboard?cohort=" + wave1.id); assert.equal(d.status, 200, d.error);
  assert.equal(d.members, 3);
  assert.ok(d.activation.activated >= 1); assert.ok(d.activation.rate > 0);
  assert.equal(d.retention.d1.eligible, 2); assert.equal(d.retention.d1.returned, 1);
  assert.equal(d.retention.d7.eligible, 1); assert.equal(d.retention.d7.rate, 100);
  assert.equal(d.errors.total, 1); assert.match(d.errors.top[0].message, /TypeError/);
  assert.equal(d.surveys.nps, 0); assert.equal(d.surveys.npsAnswers, 2); assert.equal(d.surveys.csat, 4);
  assert.equal(d.feedback.byKind.bug, 1); assert.equal(d.feedback.top[0].priority, "high");
  assert.equal((await plain.req("GET", "/api/admin/beta/dashboard")).status, 403);
});

test("feature flags: cohort early access + kill switch (API and server-side flagsFor)", async () => {
  const flag = async (c) => (await c.req("GET", "/api/flags")).flags;
  assert.equal((await flag(t1)).stories, false);
  assert.equal((await mod.req("PUT", "/api/admin/beta/flags/stories", { cohorts: [wave1.id] })).status, 403);
  const r = await admin.req("PUT", "/api/admin/beta/flags/stories", { cohorts: [wave1.id] }); assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.items.find((x) => x.key === "stories").cohorts, [wave1.id]);
  assert.equal((await flag(t1)).stories, true); assert.equal((await flag(mod)).stories, false);
  assert.equal((await admin.req("PUT", "/api/admin/beta/flags/passkeys", { killed: true })).status, 400); // a reason is required
  assert.equal((await flag(mod)).passkeys, true);
  const k = await admin.req("PUT", "/api/admin/beta/flags/passkeys", { killed: true, reason: "خلل في تسجيل الدخول" }); assert.equal(k.status, 200);
  assert.equal((await flag(mod)).passkeys, false); assert.equal((await flag(t1)).passkeys, false); assert.equal((await flag(new H.Client())).passkeys, false);
  const u = await db().get("SELECT * FROM users WHERE id=$1", [mod.id]);
  assert.equal((await S().ops.flagsFor(u)).passkeys, false);
  await admin.req("PUT", "/api/admin/beta/flags/passkeys", { killed: false });
  assert.equal((await flag(mod)).passkeys, true);
  assert.equal((await admin.req("PUT", "/api/admin/beta/flags/nope_x", { killed: true, reason: "x" })).status, 404);
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='beta_flag_killed'"));
});

test("close a wave stops member invites; production default stays open", async () => {
  await admin.req("POST", `/api/admin/beta/cohorts/${wave1.id}/close`);
  await db().run("UPDATE beta_members SET quota=10 WHERE user_id=$1", [plain.id]);
  assert.equal((await plain.req("POST", "/api/beta/invites")).code, "wave_not_open");
  assert.equal((await new H.Client().req("GET", "/api/launch/config")).mode, "open");
});
