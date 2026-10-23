/* M5-1/F11 «مطوّر شهادة الإتمام» — mentorship completion certificate (reuses certificates, kind 'mentorship', no migration).
 *  only the mentor of a pair with ≥1 COMPLETED session issues · validation codes · one per pair · mentee lists it ·
 *  public verify returns the minimum (no age / contact / ids) · minor: first name + initial, unlisted · guardian lists it ·
 *  stranger 404 / visitor 401 · issuing mentor can revoke. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H; const NOW = Date.parse("2027-01-03T06:00:00.000Z");
let mentor, learner, kid, parent, stranger, other, sid, kidSid;
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const minors = new Set(); let realIs, realIds;
test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  mentor = await mk("mc_mentor", "سارة الحربي"); learner = await mk("mc_learner", "فهد العتيبي"); kid = await mk("mc_kid", "ريم سالم");
  parent = await mk("mc_parent"); stranger = await mk("mc_x"); other = await mk("mc_other", "مرشد آخر");
  const ms = H.app.ctx.services.minors; realIs = ms.isMinorUser; realIds = ms.minorIds;
  ms.isMinorUser = async (uid) => minors.has(uid) || (await realIs(uid));
  if (realIds) ms.minorIds = async (ids) => { const out = new Set(await realIds(ids)); for (const i of ids || []) if (minors.has(i)) out.add(i); return out; };
  minors.add(kid.id);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'active',$2,'{}',$4)", ["gl_mc", parent.id, kid.id, new Date().toISOString()]);
  assert.equal((await mentor.req("PUT", "/api/mentor/me", { headline: "مرشدة خبيرة في البرمجة", topics: ["programming"], minutes: 60, tz: "Asia/Riyadh", allowMinors: true })).status, 200);
  assert.equal((await mentor.req("PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }] })).status, 200);
  const ins = (id, who, at) => db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,topic,starts_at,minutes,status,created_at,updated_at) VALUES($1,$2,$3,'programming',$4,60,'confirmed',$4,$4)", [id, mentor.id, who, at]);
  sid = "ms_mc1"; kidSid = "ms_mc2"; await ins(sid, learner.id, "2027-01-04T15:00:00.000Z"); await ins(kidSid, kid.id, "2027-01-11T15:00:00.000Z");
});
test.after(() => { const ms = H.app.ctx.services.minors; ms.isMinorUser = realIs; if (realIds) ms.minorIds = realIds; return H.app.close(); });
test.beforeEach(() => H.app.ctx.rl.w.clear());
const complete = (id) => db().run("UPDATE mentor_sessions SET status='completed', completed_at=$1 WHERE id=$2", [new Date(NOW).toISOString(), id]);

test("no completed session → 403 mcert_no_completed_session; visitor 401", async () => {
  const r = await mentor.req("POST", "/api/mentor-certificates", { menteeId: learner.id, title: "برنامج البرمجة" });
  assert.equal(r.status, 403); assert.equal(r.code, "mcert_no_completed_session");
  assert.equal((await new H.Client().req("POST", "/api/mentor-certificates", { menteeId: learner.id, title: "x" })).status, 401);
  assert.equal((await new H.Client().req("GET", "/api/mentor-certificates")).status, 401);
});

test("only the mentor of the completed pair issues; validation; idempotent", async () => {
  await complete(sid);
  assert.equal((await learner.req("POST", "/api/mentor-certificates", { menteeId: mentor.id, title: "عكسية" })).code, "mcert_no_completed_session");
  assert.equal((await other.req("POST", "/api/mentor-certificates", { menteeId: learner.id, title: "ليست لي" })).status, 403);
  assert.equal((await stranger.req("POST", "/api/mentor-certificates", { menteeId: learner.id, title: "ليست لي" })).status, 403);
  const code = async (b) => (await mentor.req("POST", "/api/mentor-certificates", { menteeId: learner.id, ...b })).code;
  assert.equal(await code({ title: "  " }), "mcert_title_required");
  assert.equal(await code({ title: "ا".repeat(81) }), "mcert_title_too_long");
  assert.equal(await code({ title: "برنامج", note: "ن".repeat(201) }), "mcert_note_too_long");
  assert.equal(await code({ title: "برنامج" , menteeId: "" }), "mcert_mentee_required");
  let r = await mentor.req("POST", "/api/mentor-certificates", { menteeId: learner.id, title: "ا".repeat(80), note: "ملتزم ومبادر" });
  assert.equal(r.status, 200, r.error); assert.equal(r.created, true); assert.equal(r.certificate.kind, "mentorship");
  assert.equal(r.certificate.holder, "فهد العتيبي"); assert.equal(r.certificate.issuer, "سارة الحربي"); assert.deepEqual(r.certificate.details, { note: "ملتزم ومبادر", sessions: 1 });
  const c1 = r.certificate.code;
  r = await mentor.req("POST", "/api/mentor-certificates", { menteeId: learner.id, title: "مرة ثانية" }); assert.equal(r.created, false); assert.equal(r.certificate.code, c1);
  const mine = await learner.req("GET", "/api/certificates"); assert.ok(mine.certificates.some((c) => c.code === c1 && c.kind === "mentorship"));
  const list = await mentor.req("GET", "/api/mentor-certificates"); assert.equal(list.certificates.length, 1); assert.equal(list.mentees.find((m) => m.id === learner.id).certificate, c1);
  assert.deepEqual(list.limits, { title: 80, note: 200 });
  const s = await stranger.req("GET", "/api/mentor-certificates"); assert.deepEqual(s.certificates, []); assert.deepEqual(s.mentees, []);
});

test("public verify shows the minimum; ssr page renders; issuing mentor revokes", async () => {
  const c1 = (await learner.req("GET", "/api/certificates")).certificates.find((c) => c.kind === "mentorship").code;
  const v = await new H.Client().req("GET", "/api/certificates/verify/" + c1);
  assert.equal(v.status, 200); assert.equal(v.valid, true);
  const json = JSON.stringify(v);
  for (const leak of [learner.id, mentor.id, "mc_learner", "secret", "birth", "dob", "phone", "email"]) assert.ok(!json.includes(leak), "leak " + leak);
  assert.deepEqual(Object.keys(v.certificate).sort(), ["code", "details", "holder", "issuedAt", "issuer", "kind", "kindLabel", "revokeReason", "revokedAt", "status", "title", "url"]);
  const res = await fetch(H.base + "/cert/" + c1); const html = await res.text();
  assert.equal(res.status, 200); assert.ok(html.includes("إتمام إرشاد")); assert.ok(html.includes("فهد العتيبي")); assert.ok(html.includes("@media print"));
  assert.equal((await other.req("POST", `/api/certificates/${c1}/revoke`, { reason: "ليست لك" })).status, 403);
  assert.equal((await mentor.req("POST", `/api/certificates/${c1}/revoke`, { reason: "خطأ في العنوان" })).status, "revoked"); // body.status = certificate status
  assert.equal((await mentor.req("POST", `/api/certificates/${c1}/restore`)).status, "valid");
});

test("minor mentee: first name + initial, unlisted; guardian lists it; stranger 404", async () => {
  await complete(kidSid);
  const r = await mentor.req("POST", "/api/mentor-certificates", { menteeId: kid.id, title: "برنامج الإرشاد الصيفي" });
  assert.equal(r.status, 200, r.error); assert.equal(r.certificate.holder, "ريم س.");
  const row = await db().get("SELECT visibility FROM certificates WHERE code=$1", [r.certificate.code]); assert.equal(row.visibility, "unlisted");
  const g = await parent.req("GET", "/api/guardian/certificates/" + kid.id); assert.equal(g.status, 200); assert.equal(g.certificates[0].code, r.certificate.code);
  assert.equal((await stranger.req("GET", "/api/guardian/certificates/" + kid.id)).status, 404);
  assert.equal((await parent.req("GET", "/api/guardian/certificates/" + learner.id)).status, 404);
  const list = await mentor.req("GET", "/api/mentor-certificates"); const m = list.mentees.find((x) => x.id === kid.id); assert.equal(m.name, "ريم س."); assert.equal(m.handle, null);
});
