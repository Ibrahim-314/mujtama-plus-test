/* Phase 79 — teams & group projects: create (validation, caps, minors cannot list), roles (owner / admin / member /
 * viewer) and their gates, direct invites (accept / decline), invite links (expiry, use cap), join requests on listed teams,
 * role changes, remove / leave, ownership transfer, task board (create, assign, move between columns and within a column,
 * delete rights, viewers cannot be assigned), files & links (http only, own image media), updates + replies with
 * notifications and scam warning, contract link (owner must be party; tasks → milestone; paid contract keeps minors out;
 * contract page lists the team), archive / staff access, directory search, migration 059 + data map. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, staff, own, ann, bob, vic, kid, out; let T; const clock = null;
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);

test.before(async () => {
  H = await boot({ teamsOpts: { now: () => clock ?? Date.now() } });
  staff = await mk("wt_staff"); own = await mk("wt_own", "ليلى"); ann = await mk("wt_ann", "آن"); bob = await mk("wt_bob", "بدر"); vic = await mk("wt_vic", "فيصل"); kid = await mk("wt_kid", "يافع"); out = await mk("wt_out");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("create, invites, links, requests, roles, leave, transfer", async () => {
  assert.equal((await own.req("POST", "/api/teams", { name: "اب" })).status, 400);
  assert.equal((await kid.req("POST", "/api/teams", { name: "فريق اليافعين", visibility: "listed" })).code, "minor_restricted");
  let r = await own.req("POST", "/api/teams", { name: "تطبيق مكتبة الحي", kind: "project", about: "تطبيق لإعارة الكتب بين الجيران", visibility: "listed", title: "مديرة المشروع" });
  assert.equal(r.status, 200, r.error); T = r.id;
  assert.equal((await out.req("GET", "/api/teams/" + T)).me.outsider, true, "listed → outsider preview");
  // direct invite: admin role only by the owner
  r = await own.req("POST", `/api/teams/${T}/invites`, { handle: "wt_ann", role: "admin" }); assert.equal(r.status, 200, r.error);
  assert.equal((await own.req("POST", `/api/teams/${T}/invites`, { handle: "wt_ann" })).code, "invited");
  assert.ok((await kinds(ann.id)).includes("team_invite"));
  const inv = (await ann.req("GET", "/api/teams")).invites[0]; assert.equal(inv.team.id, T);
  assert.equal((await bob.req("POST", `/api/team-invites/${inv.id}/respond`, { accept: true })).status, 404);
  r = await ann.req("POST", `/api/team-invites/${inv.id}/respond`, { accept: true }); assert.equal(r.joined, true);
  assert.ok((await kinds(own.id)).includes("team_joined"));
  assert.equal((await ann.req("POST", `/api/teams/${T}/invites`, { handle: "wt_bob", role: "admin" })).status, 403, "admins cannot make admins");
  // invite link with a use cap
  r = await ann.req("POST", `/api/teams/${T}/invites`, { link: true, role: "member", days: 2, maxUses: 1 }); assert.ok(r.code); const code = r.code;
  assert.equal((await new H.Client().req("GET", "/api/teams/join/" + code)).team.name, "تطبيق مكتبة الحي");
  assert.equal((await kid.req("POST", "/api/teams/join", { code })).code, "minor_restricted", "listed team links are adults only");
  r = await bob.req("POST", "/api/teams/join", { code }); assert.equal(r.status, 200, r.error);
  assert.equal((await vic.req("POST", "/api/teams/join", { code })).code, "expired", "use cap reached");
  // join request on a listed team
  assert.equal((await kid.req("POST", `/api/teams/${T}/request`, {})).code, "minor_restricted");
  r = await vic.req("POST", `/api/teams/${T}/request`, { note: "أستطيع المساعدة في الاختبار" }); assert.equal(r.status, 200, r.error);
  assert.equal((await vic.req("POST", `/api/teams/${T}/request`, {})).code, "requested");
  assert.ok((await kinds(ann.id)).includes("team_request"));
  let v = await ann.req("GET", "/api/teams/" + T); const rq = v.invites.find((i) => i.kind === "request");
  v = await ann.req("POST", `/api/teams/${T}/requests/${rq.id}`, { accept: true }); assert.equal(v.members.length, 4);
  // roles
  assert.equal((await bob.req("PATCH", `/api/teams/${T}/members/${vic.id}`, { role: "viewer" })).status, 403, "members cannot change roles");
  v = await ann.req("PATCH", `/api/teams/${T}/members/${vic.id}`, { role: "viewer", title: "مختبر" }); assert.equal(v.members.find((m) => m.user.id === vic.id).role, "viewer");
  assert.equal((await ann.req("PATCH", `/api/teams/${T}/members/${own.id}`, { role: "member" })).status, 403);
  assert.equal((await own.req("DELETE", `/api/teams/${T}/members/${own.id}`)).code, "owner", "owner transfers before leaving");
  // a kid joins a private team by invite
  const P = (await own.req("POST", "/api/teams", { name: "حلقة تطوع الحي", kind: "team" })).id;
  await own.req("POST", `/api/teams/${P}/invites`, { handle: "wt_kid" });
  const ki = (await kid.req("GET", "/api/teams")).invites[0]; assert.equal((await kid.req("POST", `/api/team-invites/${ki.id}/respond`, { accept: true })).joined, true);
  assert.equal((await out.req("GET", "/api/teams/" + P)).status, 404, "private team hidden");
  // transfer + leave
  v = await own.req("POST", `/api/teams/${P}/transfer`, { userId: kid.id }); assert.equal(v.members.find((m) => m.user.id === kid.id).role, "owner");
  r = await own.req("DELETE", `/api/teams/${P}/members/${own.id}`); assert.equal(r.left, true);
  assert.ok((await kinds(kid.id)).includes("team_owner"));
});

test("task board, files & links, updates and discussion", async () => {
  assert.equal((await vic.req("POST", `/api/teams/${T}/tasks`, { title: "مهمة" })).status, 403, "viewers cannot add tasks");
  assert.equal((await bob.req("POST", `/api/teams/${T}/tasks`, { title: "مهمة", assignee: vic.id })).code, "viewer");
  assert.equal((await bob.req("POST", `/api/teams/${T}/tasks`, { title: "مهمة", assignee: out.id })).code, "not_member");
  const a = (await bob.req("POST", `/api/teams/${T}/tasks`, { title: "تصميم الشاشات", assignee: ann.id, priority: "high", due: "2030-01-10" })).id;
  const b = (await bob.req("POST", `/api/teams/${T}/tasks`, { title: "قاعدة البيانات" })).id;
  const c = (await own.req("POST", `/api/teams/${T}/tasks`, { title: "صفحة الهبوط", status: "doing" })).id;
  assert.ok((await kinds(ann.id)).includes("team_task"));
  let r = await ann.req("PATCH", `/api/team-tasks/${b}`, { move: "up" }); assert.equal(r.status, 200, r.error);
  let v = await own.req("GET", "/api/teams/" + T); const todo = v.tasks.filter((k) => k.status === "todo").sort((x, y) => x.pos - y.pos).map((k) => k.id); assert.deepEqual(todo, [b, a]);
  await ann.req("PATCH", `/api/team-tasks/${a}`, { status: "review" }); await own.req("PATCH", `/api/team-tasks/${c}`, { status: "done" });
  v = await own.req("GET", "/api/teams/" + T); assert.equal(v.tasks.find((k) => k.id === a).status, "review"); assert.equal(v.tasks.find((k) => k.id === c).status, "done");
  assert.equal((await ann.req("DELETE", `/api/team-tasks/${c}`)).status, 200, "admins delete any task");
  assert.equal((await bob.req("DELETE", `/api/team-tasks/${a}`)).status, 200, "creator deletes own task");
  // files & links
  assert.equal((await bob.req("POST", `/api/teams/${T}/items`, { title: "المستودع", url: "javascript:alert(1)" })).code, "bad_link");
  const it = (await bob.req("POST", `/api/teams/${T}/items`, { title: "المستودع", url: "https://github.com/example/library", note: "الفرع الرئيسي" })).id;
  assert.equal((await bob.req("POST", `/api/teams/${T}/items`, { title: "صورة", mediaId: "md_nope" })).code, "bad_media");
  assert.equal((await vic.req("DELETE", `/api/team-items/${it}`)).status, 403);
  // updates + replies
  assert.equal((await vic.req("POST", `/api/teams/${T}/updates`, { body: "إعلان من مشاهد" })).status, 403, "viewers only reply");
  const u1 = (await own.req("POST", `/api/teams/${T}/updates`, { body: "انتهينا من التصميم الأولي، راجعوه قبل الخميس" })).id;
  assert.ok((await kinds(vic.id)).includes("team_update"));
  r = await vic.req("POST", `/api/teams/${T}/updates`, { body: "ممتاز، ادفع رسوم التسجيل على واتساب", parentId: u1 }); assert.equal(r.status, 200, r.error);
  v = await bob.req("GET", "/api/teams/" + T); assert.equal(v.updates[0].replies[0].warn, true); assert.equal(v.items[0].url, "https://github.com/example/library");
  v = await vic.req("GET", "/api/teams/" + T); assert.equal(v.updates[0].replies[0].warn, false, "the author sees no warning"); assert.equal(v.me.can.tasks, false);
  assert.equal((await bob.req("DELETE", `/api/team-updates/${u1}`)).status, 403);
  assert.equal((await own.req("DELETE", `/api/team-updates/${u1}`)).status, 200);
});

test("contract link, milestones on tasks, minors and paid contracts, archive, staff, directory, data map, migration", async () => {
  // a paid contract between own (client) and ann (worker)
  let r = await own.req("POST", "/api/contracts", { to: "wt_ann", title: "تطبيق مكتبة الحي — المرحلة الأولى", scope: "تصميم وتنفيذ الشاشات الأساسية لتطبيق إعارة الكتب مع لوحة إدارة بسيطة.", milestones: [{ title: "الشاشات", amount: 10 }] });
  assert.equal(r.status, 200, r.error); const cid = r.id; await ann.req("POST", `/api/contracts/${cid}/respond`, { accept: true });
  assert.equal((await bob.req("PATCH", `/api/teams/${T}`, { contractId: cid })).status, 403);
  assert.equal((await own.req("POST", "/api/teams", { name: "عقد غريب", contractId: "ctr_nope" })).code, "no_contract");
  let v = await own.req("PATCH", `/api/teams/${T}`, { contractId: cid }); assert.equal(v.contract.title, "تطبيق مكتبة الحي — المرحلة الأولى"); const mid = v.contract.milestones[0].id;
  assert.equal((await bob.req("POST", `/api/teams/${T}/tasks`, { title: "مهمة", milestoneId: "cms_nope" })).code, "bad_milestone");
  r = await bob.req("POST", `/api/teams/${T}/tasks`, { title: "شاشة الإعارة", milestoneId: mid }); assert.equal(r.status, 200, r.error);
  const cv = await ann.req("GET", "/api/contracts/" + cid); assert.deepEqual(cv.teams.map((t) => t.id), [T]);
  // minors stay out of teams linked to paid contracts
  await own.req("POST", `/api/teams/${T}/invites`, { handle: "wt_out" });
  assert.equal((await own.req("POST", `/api/teams/${T}/invites`, { handle: "wt_kid" })).code, "minor_restricted");
  const K = (await own.req("POST", "/api/teams", { name: "فريق فيه يافع", kind: "team" })).id;
  await own.req("POST", `/api/teams/${K}/invites`, { handle: "wt_kid" }); const ki = (await kid.req("GET", "/api/teams")).invites.find((i) => i.team.id === K); await kid.req("POST", `/api/team-invites/${ki.id}/respond`, { accept: true });
  assert.equal((await own.req("PATCH", `/api/teams/${K}`, { contractId: cid })).code, "minor_member");
  // archive → read only; staff can view and archive any team
  v = await own.req("POST", `/api/teams/${K}/state`, { status: "archived" }); assert.equal(v.team.status, "archived");
  assert.equal((await own.req("POST", `/api/teams/${K}/tasks`, { title: "بعد الأرشفة" })).code, "archived");
  assert.equal((await staff.req("GET", "/api/teams/" + K)).me.staff, true);
  assert.equal((await out.req("POST", `/api/teams/${T}/state`, { status: "archived" })).status, 403);
  // directory
  const d = await new H.Client().req("GET", "/api/teams/directory?q=" + encodeURIComponent("مكتبه")); assert.deepEqual(d.teams.map((t) => t.id), [T], "Arabic-normalised search");
  // data map + migration
  const map = JSON.stringify(require("../lib/compliance-lib").DATA_MAP.map((m) => m.t));
  for (const t of ["wt_teams", "wt_members", "wt_invites", "wt_tasks", "wt_items", "wt_updates"]) assert.ok(map.includes(t), t);
  const mig = require("../migrations/059_teams.js"), dl = db().dialect, exec = async (sql) => { for (const s of sql.replace(/\{TS\}/g, dl === "postgres" ? "TIMESTAMPTZ" : "TEXT").split(";").map((x) => x.trim()).filter(Boolean)) await db().exec(s); };
  await mig.up(db(), exec, dl); assert.ok(Number((await db().get("SELECT COUNT(*) n FROM wt_teams")).n) > 0, "re-run keeps data");
  await mig.down(db(), exec, dl); await mig.up(db(), exec, dl); assert.equal(Number((await db().get("SELECT COUNT(*) n FROM wt_teams")).n), 0);
});
