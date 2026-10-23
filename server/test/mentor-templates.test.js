/* مسار الإرشاد M4-5/F10 «الردود الجاهزة» — mentor reply templates in mentor_profiles.extra.templates (no migration).
 * Owner-only: up to 8, title ≤40, body ≤500, both required; whole list replaced on save; ids kept/minted; partial saves of
 * other profile fields keep them; null resets. NEVER in GET /api/mentors/:handle (visitor / member / mentee / staff), the
 * directory, or GET /api/mentor/me/preview for any viewer. A template body fits the request reply (≤600). PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, owner, member, mentee, staff;
const NOW = Date.parse("Sun 2027-01-03 9:00 AM (UTC+03:00)");
const db = () => H.app.ctx.db;
const HANDLE = "mtp_owner";
const SECRET = "نصّ-خاص-بالمرشد-لا-يظهر";
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const BASE = { headline: "مطوّرة ويب منذ عشر سنوات", topics: ["programming"] };
const put = (b) => owner.req("PUT", "/api/mentor/me", { ...BASE, ...b });
const tpl = (n, o = {}) => ({ title: "ردّ " + n, body: "أهلاً بك، " + SECRET + " " + n, ...o });

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  owner = await mk(HANDLE); member = await mk("mtp_member"); mentee = await mk("mtp_mentee"); staff = await mk("mtp_staff");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  const r = await put({ extra: { approach: "أسلوبي", templates: [tpl(1), tpl(2)] } }); assert.equal(r.status, 200, r.error);
  await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES('mss_mtp1',$1,$2,NULL,'programming','',$3,60,'completed',0,0,'none',0,$4,$4)",
    [owner.id, mentee.id, new Date(NOW - 5 * 864e5).toISOString(), new Date(NOW).toISOString()]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("owner: saved, trimmed, ids minted and kept; meta exposes limits; other partial saves keep them", async () => {
  const me = await owner.req("GET", "/api/mentor/me");
  assert.equal(me.status, 200, me.error);
  const t = me.profile.extra.templates;
  assert.equal(t.length, 2); assert.match(t[0].id, /^t[a-z0-9]+$/); assert.notEqual(t[0].id, t[1].id);
  assert.deepEqual(t.map((x) => x.title), ["ردّ 1", "ردّ 2"]);
  assert.deepEqual(me.profileMeta.templates, { max: 8, title: 40, body: 500 });
  const keep = t[0].id;
  const r = await put({ extra: { templates: [{ id: keep, title: "  معدّل  ", body: " نص " }, { id: keep, title: "مكرر", body: "x" }, { id: "BAD ID", title: "ج", body: "y" }] } });
  assert.equal(r.status, 200, r.error);
  const n = r.profile.extra.templates;
  assert.equal(n[0].id, keep, "valid id kept"); assert.equal(n[0].title, "معدّل"); assert.equal(n[0].body, "نص");
  assert.equal(new Set(n.map((x) => x.id)).size, 3, "duplicate / invalid ids replaced by fresh ones");
  const p = await put({ headline: "عنوان جديد للمرشدة", extra: { city: "جدة" } });
  assert.equal(p.profile.extra.templates.length, 3, "saving other fields keeps templates");
  assert.equal(p.profile.extra.approach, "أسلوبي");
  const unknown = await put({ extra: { templates: [{ ...tpl(9), extraKey: "drop" }] } });
  assert.deepEqual(Object.keys(unknown.profile.extra.templates[0]).sort(), ["body", "id", "title"], "unknown per-item keys dropped");
  const reset = await put({ extra: { templates: null } });
  assert.deepEqual(reset.profile.extra.templates, []);
  assert.equal((await put({ extra: { templates: [tpl(1), tpl(2)] } })).status, 200);
});

test("limits: max 8, title ≤40, body ≤500, both required, items must be objects, list must be an array", async () => {
  const bad = async (templates, why) => { const r = await put({ extra: { templates } }); assert.equal(r.status, 400, why); assert.equal(r.code, "invalid_templates", why); };
  assert.equal((await put({ extra: { templates: Array.from({ length: 8 }, (_, i) => tpl(i)) } })).status, 200, "8 ok");
  await bad(Array.from({ length: 9 }, (_, i) => tpl(i)), "9 rejected");
  assert.equal((await put({ extra: { templates: [tpl(1, { title: "ع".repeat(40), body: "ب".repeat(500) })] } })).status, 200, "edges ok");
  await bad([tpl(1, { title: "ع".repeat(41) })], "title 41");
  await bad([tpl(1, { body: "ب".repeat(501) })], "body 501");
  await bad([tpl(1, { title: "" })], "title required");
  await bad([tpl(1, { body: "   " })], "body required");
  await bad(["نص"], "item not object");
  await bad({ a: 1 }, "not array");
  const me = await owner.req("GET", "/api/mentor/me");
  assert.equal(me.profile.extra.templates.length, 1, "rejected saves changed nothing");
  assert.equal((await put({ extra: { templates: [tpl(1), tpl(2)] } })).status, 200);
});

test("never leaked: visitor / member / mentee / staff page, directory, and every preview", async () => {
  const leak = (j, who) => { const s = JSON.stringify(j); assert.ok(!s.includes(SECRET), who + " got template text"); assert.ok(!s.includes('"templates"'), who + " got templates key"); };
  for (const [who, c] of [["visitor", new H.Client()], ["member", member], ["mentee", mentee], ["staff", staff]]) {
    const r = await c.req("GET", "/api/mentors/" + HANDLE); assert.equal(r.status, 200, who + " " + r.error); leak(r, who);
    const d = await c.req("GET", "/api/mentors"); assert.equal(d.status, 200); leak(d, who + " directory");
  }
  for (const as of ["visitor", "member", "mentee", "guardian"]) { const r = await owner.req("GET", "/api/mentor/me/preview?as=" + as); assert.equal(r.status, 200, as); leak(r, "preview " + as); }
  for (const vis of ["members", "hidden"]) { await put({ visibility: vis }); for (const c of [mentee, staff]) leak(await c.req("GET", "/api/mentors/" + HANDLE), vis); }
  await put({ visibility: "public" });
  assert.equal((await new H.Client().req("GET", "/api/mentor/me")).status, 401, "visitor 401 on the owner endpoint");
  const other = await member.req("GET", "/api/mentor/me"); assert.equal(other.profile, null, "another member never reads them");
});

test("a template body is a valid request reply (≤600) and reaches the learner as typed", async () => {
  const me = await owner.req("GET", "/api/mentor/me"), body = me.profile.extra.templates[0].body;
  const rq = await member.req("POST", "/api/mentor/requests", { topic: "programming", goal: "أريد مساعدة في أول مشروع ويب لي", mentor: HANDLE });
  assert.equal(rq.status, 200, rq.error);
  const ok = await owner.req("POST", `/api/mentor/requests/${rq.request.id}/accept`, { reply: body + " — تعديل" });
  assert.equal(ok.status, 200, ok.error); assert.equal(ok.request.reply, body + " — تعديل");
});
