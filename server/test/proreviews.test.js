/* Phase 80 — professional reputation & verified reviews: eligibility (completed contracts / teams only, no self, no
 * outsiders, team members ≥ 3 days, viewers excluded), double-blind reveal (both sides or window end via the sweep),
 * edit until revealed, one review per engagement, public response, anti-abuse (latest per pair counts, young accounts and
 * quick engagements not counted, blocked pairs), reports → flagged → staff dismiss / hide (audited, notified), reciprocal
 * pairs for staff, window closes, skill endorsements (collaborators only, profile skills only, cap, withdraw), badges,
 * reputation on the CV / talent directory, minors (reputation never public), prompts sweep, migration 060 + data map.
 * PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, staff, cli, wrk, ana, bdr, kid, out; let clock = null;
const db = () => H.app.ctx.db;
const OLD = new Date(Date.now() - 40 * 864e5).toISOString(), DAYS = (n) => new Date(Date.now() - n * 864e5).toISOString();
async function mk(handle, name, old = true) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  if (old) await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [OLD, c.id]);
  return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
const SCOPE = "تصميم وتنفيذ واجهة متجر عربي متجاوبة مع لوحة تحكم بسيطة، وتسليم الملفات المصدرية مع توثيق مختصر.";
/** an unpaid one-milestone contract, completed; `age` days old unless quick */
async function done(c, w, { quick = false } = {}) {
  H.app.ctx.rl.w.clear();
  let r = await c.req("POST", "/api/contracts", { to: w.handle, title: "مراجعة نصوص الموقع", scope: SCOPE, maxRevisions: 1, milestones: [{ title: "التسليم" }] });
  assert.equal(r.status, 200, r.error); const cid = r.id;
  r = await w.req("POST", `/api/contracts/${cid}/respond`, { accept: true }); assert.equal(r.status, 200, r.error);
  await w.req("POST", `/api/contract-milestones/${r.milestones[0].id}/submit`, { note: "التسليم النهائي جاهز للمراجعة" });
  r = await c.req("POST", `/api/contract-milestones/${r.milestones[0].id}/review`, { action: "approve" }); assert.equal(r.contract.status, "completed");
  if (!quick) await db().run("UPDATE contracts SET created_at=$1 WHERE id=$2", [DAYS(5), cid]);
  return cid;
}
const rev = (c, ref, to, o = {}) => c.req("POST", "/api/proreviews", { kind: "contract", ref, to: to.id, overall: 5, c1: 5, c2: 4, c3: 5, body: "عمل متقن وتواصل ممتاز طوال المشروع", ...o });

test.before(async () => {
  H = await boot({ proreviewsOpts: { now: () => clock ?? Date.now() } });
  staff = await mk("pr_staff"); cli = await mk("pr_cli", "سارة"); wrk = await mk("pr_wrk", "خالد"); ana = await mk("pr_ana", "أنس"); bdr = await mk("pr_bdr", "بدور"); kid = await mk("pr_kid", "يافع"); out = await mk("pr_out", "جديد", false);
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
  for (const u of [wrk, cli]) { H.app.ctx.rl.w.clear(); assert.equal((await u.req("PUT", "/api/pro/me", { headline: "مطوّر واجهات ومصمم تجربة", visibility: "public" })).status, 200); }
  assert.equal((await wrk.req("PUT", "/api/pro/me/skills", { skills: [{ name: "React", level: 4 }, { name: "تصميم واجهات", level: 4 }, { name: "Node", level: 3 }] })).status, 200);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("eligibility, double-blind reveal, edit window, one review per engagement, response", async () => {
  const c1 = await done(cli, wrk);
  assert.equal((await out.req("POST", "/api/proreviews", { kind: "contract", ref: c1, to: wrk.id, overall: 5 })).code, "not_eligible", "outsiders cannot review");
  assert.equal((await cli.req("POST", "/api/proreviews", { kind: "contract", ref: c1, to: cli.id, overall: 5 })).code, "self_review");
  assert.equal((await rev(cli, c1, wrk, { overall: 9 })).code, "bad_rating");
  assert.equal((await rev(cli, c1, wrk, { body: "قصير" })).status, 400);
  // pending: both sides see the engagement
  let hub = await cli.req("GET", "/api/proreviews"); const p = hub.pending.find((x) => x.ref === c1);
  assert.ok(p, "pending to review"); assert.equal(p.role, "client"); assert.equal(p.to.handle, "pr_wrk"); assert.equal(p.criteria[0], "جودة العمل");
  let r = await rev(cli, c1, wrk, { overall: 4 }); assert.equal(r.status, 200, r.error); assert.equal(r.revealed, false); const R1 = r.id;
  assert.equal((await rev(cli, c1, wrk)).code, "already_reviewed");
  assert.ok((await kinds(wrk.id)).includes("prr_waiting"));
  // hidden from the reviewee and the public until both reviewed
  hub = await wrk.req("GET", "/api/proreviews"); assert.equal(hub.waiting, 1); assert.equal(hub.received.length, 0); assert.equal(hub.pending.find((x) => x.ref === c1).theyReviewed, true);
  let pg = await new H.Client().req("GET", "/api/proreviews/u/pr_wrk"); assert.equal(pg.reviews.length, 0); assert.equal(pg.summary.count, 0);
  assert.equal((await cli.req("PATCH", "/api/proreviews/" + R1, { overall: 5 })).status, 200, "edit while hidden");
  assert.equal((await wrk.req("PATCH", "/api/proreviews/" + R1, { overall: 1 })).status, 404, "only the author edits");
  // the other side reviews → both revealed
  r = await rev(wrk, c1, cli, { c1: 5, c2: 5, c3: 4, body: "متطلبات واضحة ومراجعة سريعة" }); assert.equal(r.revealed, true);
  assert.ok((await kinds(wrk.id)).includes("prr_received")); assert.ok((await kinds(cli.id)).includes("prr_received"));
  assert.equal((await cli.req("PATCH", "/api/proreviews/" + R1, { overall: 3 })).code, "locked");
  pg = await new H.Client().req("GET", "/api/proreviews/u/pr_wrk");
  assert.equal(pg.summary.avg, 5); assert.equal(pg.summary.count, 1); assert.equal(pg.reviews[0].asLabel, "كمنفّذ"); assert.equal(pg.reviews[0].criteria[2].label, "الالتزام بالمواعيد");
  assert.ok(pg.summary.badges.some((b) => b.key === "first")); assert.equal(pg.summary.completed.contracts, 1); assert.equal(pg.summary.as.worker.n, 1);
  // response by the reviewee only, no off-platform contact
  assert.equal((await cli.req("PUT", `/api/proreviews/${R1}/response`, { body: "شكراً" })).status, 404);
  assert.equal((await wrk.req("PUT", `/api/proreviews/${R1}/response`, { body: "تواصلي معي على واتساب 0551234567" })).code, "risky");
  r = await wrk.req("PUT", `/api/proreviews/${R1}/response`, { body: "شكراً سارة، سعدت بالعمل معك" }); assert.equal(r.response.body, "شكراً سارة، سعدت بالعمل معك");
  assert.ok((await kinds(cli.id)).includes("prr_response"));
  assert.equal((await new H.Client().req("GET", "/api/proreviews/u/pr_wrk")).reviews[0].response.body, "شكراً سارة، سعدت بالعمل معك");
  hub = await cli.req("GET", "/api/proreviews"); assert.ok(!hub.pending.some((x) => x.ref === c1), "nothing left to review"); assert.equal(hub.given.length, 1);
  // CV + talent directory carry the reputation
  const cv = await new H.Client().req("GET", "/api/pro/u/pr_wrk"); assert.equal(cv.reputation.count, 1); assert.equal(cv.reputation.avg, 5);
  const sr = await new H.Client().req("GET", "/api/pro/search?q=" + encodeURIComponent("مطور")); assert.equal(sr.profiles.find((x) => x.user.handle === "pr_wrk").rep.count, 1);
});

test("anti-abuse: latest per pair counts, young accounts, quick jobs, blocks, reports and staff, window and sweep", async () => {
  // a second job between the same pair: only the latest review counts
  const c2 = await done(cli, wrk);
  await rev(cli, c2, wrk, { overall: 3, body: "تأخر التسليم قليلاً لكن النتيجة مقبولة" }); await rev(wrk, c2, cli);
  let pg = await new H.Client().req("GET", "/api/proreviews/u/pr_wrk");
  assert.equal(pg.summary.count, 1); assert.equal(pg.summary.avg, 3); assert.equal(pg.summary.total, 2);
  const old = pg.reviews.find((x) => x.overall === 5); assert.equal(old.counted, false); assert.ok(old.notCounted.includes("تقييم سابق من نفس العضو"));
  // a new account and a same-day job are shown but not counted
  const c3 = await done(out, wrk); let r = await rev(out, c3, wrk, { overall: 1, body: "لم يعجبني العمل إطلاقاً للأسف" }); assert.equal(r.status, 200, r.error);
  const c4 = await done(ana, wrk, { quick: true }); await rev(ana, c4, wrk, { overall: 5 }); await rev(wrk, c3, out); await rev(wrk, c4, ana);
  pg = await new H.Client().req("GET", "/api/proreviews/u/pr_wrk");
  assert.equal(pg.summary.count, 1, "young + quick not counted"); assert.deepEqual(pg.reviews.find((x) => x.author.handle === "pr_out").notCounted, ["حساب المقيّم جديد"]);
  assert.deepEqual(pg.reviews.find((x) => x.author.handle === "pr_ana").notCounted, ["تعامل قصير جداً"]);
  // blocked pair cannot review
  const c5 = await done(bdr, wrk); await db().run("INSERT INTO user_blocks (owner, target, root, source, created_at) VALUES ($1,$2,$2,'direct',$3)", [wrk.id, bdr.id, new Date().toISOString()]);
  assert.equal((await rev(bdr, c5, wrk)).status, 404); await db().run("DELETE FROM user_blocks WHERE owner=$1", [wrk.id]);
  // reports: 3 open reports take it down until staff decide
  const target = pg.reviews.find((x) => x.author.handle === "pr_out").id;
  assert.equal((await out.req("POST", `/api/proreviews/${target}/report`, { reason: "fake" })).code, "own_review");
  assert.equal((await wrk.req("POST", `/api/proreviews/${target}/report`, { reason: "nope" })).status, 400);
  for (const u of [wrk, ana, bdr]) assert.equal((await u.req("POST", `/api/proreviews/${target}/report`, { reason: "abusive", note: "تقييم انتقامي" })).status, 200);
  assert.equal((await ana.req("POST", `/api/proreviews/${target}/report`, { reason: "abusive" })).code, "reported");
  assert.ok(!(await new H.Client().req("GET", "/api/proreviews/u/pr_wrk")).reviews.some((x) => x.id === target), "flagged → off the public page");
  assert.equal((await cli.req("GET", "/api/admin/proreviews")).status, 403);
  const q = await staff.req("GET", "/api/admin/proreviews"); const item = q.queue.find((x) => x.id === target);
  assert.equal(item.status, "flagged"); assert.equal(item.reports.length, 3); assert.ok(q.pairs.some((p) => p.engagements >= 2), "reciprocal pair cli ↔ wrk");
  assert.equal((await staff.req("POST", "/api/admin/proreviews/" + target, { action: "dismiss" })).status, "published");
  assert.equal((await staff.req("POST", "/api/admin/proreviews/" + target, { action: "hide" })).status, 400, "hide needs a reason");
  assert.equal((await staff.req("POST", "/api/admin/proreviews/" + target, { action: "hide", note: "تقييم مسيء لا يصف العمل" })).status, "hidden");
  assert.ok((await kinds(out.id)).includes("prr_moderated"));
  assert.equal((await out.req("GET", "/api/proreviews")).given.find((x) => x.id === target).staffNote, "تقييم مسيء لا يصف العمل");
  assert.ok(!(await new H.Client().req("GET", "/api/proreviews/u/pr_wrk")).reviews.some((x) => x.id === target));
  // the window: one-sided reviews are revealed by the sweep when it closes; later reviews are refused
  r = await rev(bdr, c5, wrk, { overall: 4 }); assert.equal(r.revealed, false);
  clock = Date.now() + 31 * 864e5;
  assert.equal((await rev(wrk, c5, bdr)).code, "window_closed");
  assert.ok((await new H.Client().req("GET", "/api/proreviews/u/pr_wrk")).reviews.some((x) => x.id === r.id), "revealed once the window closed");
  const s = await H.app.ctx.services.proreviews.sweep(); assert.ok(s.revealed >= 1);
  assert.ok((await wrk.req("GET", "/api/proreviews")).pending.every((x) => x.ref !== c5));
  clock = null;
});

test("teams, endorsements, badges, minors, prompts, data map, migration", async () => {
  // a completed team: members ≥ 3 days with a finished task; viewers excluded
  let r = await ana.req("POST", "/api/teams", { name: "تطبيق مكتبة الحي", kind: "project" }); const T = r.id;
  for (const [u, role] of [[bdr, "member"], [out, "viewer"]]) { await ana.req("POST", `/api/teams/${T}/invites`, { handle: u.handle, role }); const inv = (await u.req("GET", "/api/teams")).invites[0]; await u.req("POST", `/api/team-invites/${inv.id}/respond`, { accept: true }); }
  const tk = (await ana.req("POST", `/api/teams/${T}/tasks`, { title: "صفحة الهبوط" })).id; await ana.req("PATCH", `/api/team-tasks/${tk}`, { status: "done" });
  await db().run("UPDATE wt_members SET joined_at=$1 WHERE team_id=$2", [DAYS(6), T]);
  await ana.req("POST", `/api/teams/${T}/state`, { status: "completed" });
  assert.equal((await out.req("POST", "/api/proreviews", { kind: "team", ref: T, to: ana.id, overall: 5 })).code, "not_eligible", "viewers do not review");
  r = await ana.req("POST", "/api/proreviews", { kind: "team", ref: T, to: bdr.id, overall: 5, c1: 5, c2: 5, c3: 5 }); assert.equal(r.status, 200, r.error);
  assert.equal((await ana.req("GET", "/api/proreviews")).pending.some((x) => x.ref === T), false);
  assert.equal((await bdr.req("GET", "/api/proreviews")).pending.find((x) => x.ref === T).criteria[1], "التعاون والتواصل");
  // a team joined the same day does not qualify
  r = await bdr.req("POST", "/api/teams", { name: "فريق سريع جداً" }); const T2 = r.id; await bdr.req("POST", `/api/teams/${T2}/invites`, { handle: "pr_cli" });
  const inv = (await cli.req("GET", "/api/teams")).invites[0]; await cli.req("POST", `/api/team-invites/${inv.id}/respond`, { accept: true });
  const tk2 = (await bdr.req("POST", `/api/teams/${T2}/tasks`, { title: "مهمة" })).id; await bdr.req("PATCH", `/api/team-tasks/${tk2}`, { status: "done" }); await bdr.req("POST", `/api/teams/${T2}/state`, { status: "completed" });
  assert.equal((await bdr.req("POST", "/api/proreviews", { kind: "team", ref: T2, to: cli.id, overall: 5 })).code, "not_eligible");
  // endorsements: verified collaborators only, profile skills only, cap, withdraw
  assert.equal((await kid.req("PUT", "/api/proreviews/endorse/pr_wrk", { skills: ["React"] })).code, "not_collaborator");
  assert.equal((await wrk.req("PUT", "/api/proreviews/endorse/pr_wrk", { skills: ["React"] })).code, "self_endorse");
  let e = await cli.req("GET", "/api/proreviews/endorse/pr_wrk"); assert.equal(e.can, true); assert.deepEqual(e.skills.map((s) => s.name), ["React", "تصميم واجهات", "Node"]);
  e = await cli.req("PUT", "/api/proreviews/endorse/pr_wrk", { skills: ["React", "Python"] }); assert.deepEqual(e.skills.filter((s) => s.mine).map((s) => s.name), ["React"], "unknown skills ignored");
  assert.ok((await kinds(wrk.id)).includes("prr_endorsed"));
  for (const u of [out, ana]) await u.req("PUT", "/api/proreviews/endorse/pr_wrk", { skills: ["React", "Node"] });
  const pg = await new H.Client().req("GET", "/api/proreviews/u/pr_wrk");
  assert.deepEqual(pg.summary.verifiedSkills, ["React"]); assert.ok(pg.summary.badges.some((b) => b.key === "skills"));
  assert.equal(pg.summary.endorsements.find((x) => x.name === "Node").n, 2);
  await ana.req("PUT", "/api/proreviews/endorse/pr_wrk", { skills: [] });
  assert.equal((await new H.Client().req("GET", "/api/proreviews/u/pr_wrk")).summary.endorsements.find((x) => x.name === "Node").n, 1, "withdrawn");
  assert.equal((await cli.req("GET", "/api/proreviews/u/pr_wrk")).endorse.skills.find((s) => s.name === "React").mine, true);
  // minors: an unpaid contract is reviewable, but the reputation is never public
  const ck = await done(cli, kid); assert.equal((await rev(cli, ck, kid)).status, 200); await rev(kid, ck, cli);
  assert.equal((await new H.Client().req("GET", "/api/proreviews/u/pr_kid")).locked, true);
  assert.equal((await out.req("GET", "/api/proreviews/u/pr_kid")).locked, true);
  assert.equal((await kid.req("GET", "/api/proreviews/u/pr_kid")).summary.count, 1);
  assert.equal((await staff.req("GET", "/api/proreviews/u/pr_kid")).reviews.length, 1);
  // prompts: one «you can review now» per engagement and member
  const s1 = await H.app.ctx.services.proreviews.sweep(), s2 = await H.app.ctx.services.proreviews.sweep();
  assert.ok(s1.prompted > 0); assert.equal(s2.prompted, 0); assert.ok((await kinds(bdr.id)).includes("prr_open"));
  // data map + migration
  const map = JSON.stringify(require("../lib/compliance-lib").DATA_MAP.map((m) => m.t));
  for (const t of ["pr_reviews", "pr_endorsements", "pr_reports", "pr_prompts"]) assert.ok(map.includes(t), t);
  const mig = require("../migrations/060_proreviews.js"), dl = db().dialect, exec = async (sql) => { for (const s of sql.replace(/\{TS\}/g, dl === "postgres" ? "TIMESTAMPTZ" : "TEXT").split(";").map((x) => x.trim()).filter(Boolean)) await db().exec(s); };
  await mig.up(db(), exec, dl); assert.ok(Number((await db().get("SELECT COUNT(*) n FROM pr_reviews")).n) > 0, "re-run keeps data");
  await mig.down(db(), exec, dl); await mig.up(db(), exec, dl); assert.equal(Number((await db().get("SELECT COUNT(*) n FROM pr_reviews")).n), 0);
});
