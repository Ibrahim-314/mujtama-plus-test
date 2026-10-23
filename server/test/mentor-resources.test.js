/* مسار الإرشاد M4-2 — mentor resources (069 mentor_resources, PLAN F8).
 * Owner CRUD /api/mentor/me/resources (≤30, https:// only, reorder); profile page shows public resources to anyone allowed to
 * see the page and mentees-only resources only to mentees (≥1 session) + their active guardians (+ owner/staff); never strangers;
 * preview «كما يراه» follows the same rule. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const M069 = require("../migrations/069_mentor_resources_saves");

let H, owner, member, mentee, kid, parent, other, staff, reqOnly;
const NOW = Date.parse("2027-01-03T06:00:00Z");
const db = () => H.app.ctx.db;
const HANDLE = "mres_owner";
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const sess = (n, learner, status = "completed") => db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming','',$4,60,$5,0,0,'none',0,$6,$6)",
  [n, owner.id, learner, new Date(NOW - 5 * 864e5).toISOString(), status, new Date(NOW).toISOString()]);
const add = (b, c = owner) => c.req("POST", "/api/mentor/me/resources", b);
const page = (c) => (c || new H.Client()).req("GET", "/api/mentors/" + HANDLE);
const titles = (r) => (r.resources || []).map((x) => x.title).sort();

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  owner = await mk(HANDLE); member = await mk("mres_member"); mentee = await mk("mres_mentee"); kid = await mk("mres_kid");
  parent = await mk("mres_parent"); other = await mk("mres_other"); staff = await mk("mres_staff"); reqOnly = await mk("mres_req");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  assert.equal((await owner.req("PUT", "/api/mentor/me", { headline: "مطوّرة ويب منذ عشر سنوات", topics: ["programming"] })).status, 200);
  await sess("mss_r1", mentee.id); await sess("mss_r2", kid.id, "confirmed");
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_mres',$1,$2,'active',$1,'{}',$3)", [parent.id, kid.id, new Date(NOW).toISOString()]);
  await db().run("INSERT INTO mentor_requests(id,mentor_id,learner_id,topic,level,length,goal,status,created_at,updated_at) VALUES('mrq_r1',$1,$2,'programming','beginner','single','تعلّم','accepted',$3,$3)", [owner.id, reqOnly.id, new Date(NOW).toISOString()]).catch(() => null);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("auth: visitor 401 on every own-resource route; no profile → 404", async () => {
  const v = new H.Client();
  for (const [m, u] of [["GET", ""], ["POST", ""], ["PUT", "/order"], ["PUT", "/x"], ["DELETE", "/x"]]) assert.equal((await v.req(m, "/api/mentor/me/resources" + u, m === "GET" ? undefined : {})).status, 401, m + u);
  assert.equal((await member.req("GET", "/api/mentor/me/resources")).status, 404);
  assert.equal((await add({ title: "x", url: "https://a.example.com" }, member)).status, 404);
});

test("validation: https only, title/note limits, kinds, visibility", async () => {
  for (const url of ["http://a.example.com", "javascript:alert(1)", "data:text/html,x", "ftp://a.example.com", "https://user:pw@a.example.com", "//a.example.com", "https://localhost", "https://" + "a".repeat(M069.URL_MAX) + ".com", "", null]) {
    const r = await add({ title: "رابط", url }); assert.equal(r.status, 400, String(url)); assert.match(r.code || "", /resource_url/);
  }
  assert.equal((await add({ title: "", url: "https://a.example.com" })).code, "resource_title_required");
  assert.equal((await add({ title: "ع".repeat(M069.TITLE_MAX + 1), url: "https://a.example.com" })).code, "resource_title_too_long");
  assert.equal((await add({ title: "t", url: "https://a.example.com", kind: "video" })).code, "resource_kind_invalid");
  assert.equal((await add({ title: "t", url: "https://a.example.com", visibility: "members" })).code, "resource_visibility_invalid");
  assert.equal((await add({ title: "t", kind: "note", note: "ن".repeat(M069.NOTE_MAX + 1) })).code, "resource_note_too_long");
  assert.equal((await add({ title: "t", kind: "note" })).code, "resource_note_required");
  const n = await add({ title: "ملاحظة", kind: "note", note: "اقرأ الفصل الأول" }); assert.equal(n.status, 200, n.error);
  assert.equal(n.resource.url, null); assert.equal(n.resource.visibility, "mentees", "default mentees");
  assert.equal((await owner.req("DELETE", "/api/mentor/me/resources/" + n.resource.id)).status, 200);
});

test("CRUD + ownership + reorder", async () => {
  const a = await add({ title: "دليل عام", url: "https://docs.example.com/a", visibility: "public" }); assert.equal(a.status, 200, a.error);
  const b = await add({ title: "ملف المتعلّمين", url: "https://files.example.com/b.pdf", kind: "file" }); assert.equal(b.status, 200, b.error);
  let l = await owner.req("GET", "/api/mentor/me/resources"); assert.deepEqual(l.resources.map((x) => x.id), [a.resource.id, b.resource.id]); assert.equal(l.meta.max, 30);
  // other mentor cannot touch them
  await other.req("PUT", "/api/mentor/me", { headline: "مرشد آخر للتجربة هنا", topics: ["programming"] });
  assert.equal((await other.req("PUT", "/api/mentor/me/resources/" + a.resource.id, { title: "x" })).status, 404);
  assert.equal((await other.req("DELETE", "/api/mentor/me/resources/" + a.resource.id)).status, 404);
  const u = await owner.req("PUT", "/api/mentor/me/resources/" + a.resource.id, { title: "دليل عام محدّث" }); assert.equal(u.status, 200, u.error);
  assert.equal(u.resource.url, "https://docs.example.com/a"); assert.equal(u.resource.visibility, "public");
  assert.equal((await owner.req("PUT", "/api/mentor/me/resources/" + a.resource.id, { url: "http://x.example.com" })).status, 400);
  assert.equal((await owner.req("PUT", "/api/mentor/me/resources/order", { order: [a.resource.id] })).code, "resource_order_invalid");
  assert.equal((await owner.req("PUT", "/api/mentor/me/resources/order", { order: [a.resource.id, a.resource.id] })).code, "resource_order_invalid");
  l = await owner.req("PUT", "/api/mentor/me/resources/order", { order: [b.resource.id, a.resource.id] }); assert.equal(l.status, 200, l.error);
  assert.deepEqual(l.resources.map((x) => x.id), [b.resource.id, a.resource.id]);
});

test("visibility matrix on the profile page + preview", async () => {
  const both = ["دليل عام محدّث", "ملف المتعلّمين"].sort(), pub = ["دليل عام محدّث"];
  assert.deepEqual(titles(await page()), pub, "visitor");
  assert.deepEqual(titles(await page(member)), pub, "member");
  assert.deepEqual(titles(await page(reqOnly)), pub, "accepted request without a session is not a mentee for resources");
  assert.deepEqual(titles(await page(mentee)), both, "mentee");
  assert.deepEqual(titles(await page(kid)), both, "minor mentee");
  assert.deepEqual(titles(await page(parent)), both, "guardian of mentee");
  assert.deepEqual(titles(await page(owner)), both, "owner");
  assert.deepEqual(titles(await page(staff)), both, "staff");
  const vr = await page(); assert.ok(!JSON.stringify(vr).includes("files.example.com"), "no mentees-only url leaks to strangers");
  for (const [as, want] of [["visitor", pub], ["member", pub], ["mentee", both], ["guardian", both]]) assert.deepEqual(titles(await owner.req("GET", "/api/mentor/me/preview?as=" + as)), want, "preview " + as);
  // hidden page → stranger 404 (no resources at all)
  await owner.req("PUT", "/api/mentor/me", { visibility: "hidden" });
  assert.equal((await page(member)).status, 404);
  assert.deepEqual(titles(await page(mentee)), both);
  await owner.req("PUT", "/api/mentor/me", { visibility: "public" });
  // guardian link revoked → back to public only
  await db().run("UPDATE guardian_links SET status='revoked' WHERE id='gl_mres'");
  assert.deepEqual(titles(await page(parent)), pub);
  await db().run("UPDATE guardian_links SET status='active' WHERE id='gl_mres'");
});

test("limit: at most 30 per mentor (409 resource_limit)", async () => {
  const have = (await owner.req("GET", "/api/mentor/me/resources")).resources.length;
  for (let i = have; i < M069.RESOURCES_MAX; i++) assert.equal((await add({ title: "مورد " + i, url: "https://x.example.com/" + i })).status, 200);
  const r = await add({ title: "زائد", url: "https://x.example.com/over" }); assert.equal(r.status, 409); assert.equal(r.code, "resource_limit");
});
