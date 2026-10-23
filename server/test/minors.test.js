/* Track 7 — phase 35: child safety & sensitive content. Age gate at sign-up and in settings, protected
 * defaults for minors (and that they cannot be loosened), publisher labels and the server-side age filter
 * across post links, lists and people search, the escalation queue (severity, hold, staff-only access,
 * evidence hash chain), authority-report records (manual delivery), family links with two-sided consent,
 * the env-gated Pi KYC signal and staff review of age raises.
 * The service is registered here exactly as INTEGRATION.md tells the integrator to register it. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const ids = {};
let H, admin, adult, adult2, teen, teen2, nodob, agent;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = () => H.app.ctx.db;
const ymd = (yearsAgo, days = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - yearsAgo); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const mk = async (handle, birthDate, extra = {}) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123", ...(birthDate ? { birthDate } : {}), ...extra }); assert.equal(r.status, 200, r.error); c.id = r.user.id; c.reg = r; return c; };
async function until(fn, ms = 4000, label = "condition") { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(30); } throw new Error("timeout: " + label); }
const piCalls = [];
const fakeFetch = async (url, o) => { piCalls.push(url); const tok = o.headers.Authorization.slice(7); if (tok === "bad") return { ok: false, json: async () => ({}) }; return { ok: true, json: async () => ({ uid: tok.split(":")[0], username: "x", kyc_verified: tok.endsWith(":kyc") }) }; };

test.before(async () => {
  H = await boot({ minorsOpts: { env: { MINORS_PI_KYC: "1", MINORS_AUTHORITY_CHANNEL: "بوابة الجهة الرسمية (يدوي)" }, fetch: fakeFetch } });
  admin = await mk("mn_admin", ymd(40));
  adult = await mk("mn_adult", ymd(30)); adult2 = await mk("mn_adult2", ymd(25));
  teen = await mk("mn_teen", ymd(15)); teen2 = await mk("mn_teen2", ymd(16));
  nodob = await mk("mn_nodob"); agent = await mk("mn_agent", ymd(33));
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("service wiring: hooks installed on the existing routes and content service", () => {
  const m = H.app.ctx.services.minors;
  for (const r of ["POST /api/auth/register", "PUT /api/privacy", "PATCH /api/profile", "POST /api/posts", "GET /api/search/full", "GET /api/search/suggest", "GET /api/bootstrap"]) assert.ok(m.hooked.includes(r), r);
  assert.equal(H.app.ctx.services.content.__mpMinors, true);
  assert.deepEqual(m.install().length, m.hooked.length, "install() is idempotent (no double wrapping)");
});

test("age gate at sign-up: under 13 refused with a one-day cookie, invalid dates rejected, adults and teens get a band", async () => {
  const c = new H.Client();
  const r = await c.req("POST", "/api/auth/register", { name: "طفل", handle: "mn_child", password: "secret123", birthDate: ymd(10) });
  assert.equal(r.status, 403); assert.equal(r.code, "age_gate"); assert.match(r.error, /١٣|13/);
  assert.match(c.cookie, /mp_agegate=1/);
  const again = await c.req("POST", "/api/auth/register", { name: "طفل", handle: "mn_child2", password: "secret123", birthDate: ymd(30) });
  assert.equal(again.status, 403, "retrying with another date from the same browser is refused");
  assert.equal(await db().get("SELECT 1 x FROM users WHERE handle IN ('mn_child','mn_child2')"), undefined, "no account and no birth date kept for a child");
  assert.equal((await new H.Client().req("POST", "/api/auth/register", { name: "خطأ", handle: "mn_bad", password: "secret123", birthDate: "2010-02-30" })).status, 400);
  assert.equal((await new H.Client().req("POST", "/api/auth/register", { name: "مستقبل", handle: "mn_fut", password: "secret123", birthDate: ymd(-1) })).status, 400);
  assert.equal(adult.reg.age.band, "adult"); assert.equal(teen.reg.age.band, "teen"); assert.equal(teen.reg.age.minor, true);
  assert.equal(nodob.reg.age, undefined, "birth date stays optional unless MINORS_REQUIRE_DOB=1");
  const me = await nodob.req("GET", "/api/age"); assert.equal(me.band, "unknown"); assert.equal(me.declared, false);
  // 13 exactly today is allowed; one day short is not
  assert.equal((await new H.Client().req("POST", "/api/auth/register", { name: "ثلاثة عشر", handle: "mn_13", password: "secret123", birthDate: ymd(13) })).status, 200);
  assert.equal((await new H.Client().req("POST", "/api/auth/register", { name: "تقريباً", handle: "mn_12", password: "secret123", birthDate: ymd(13, 1) })).status, 403);
});

test("minor defaults: private, DMs/mentions from followed only, no location, cannot be loosened; adults unaffected", async () => {
  const p = await teen.req("GET", "/api/privacy");
  assert.equal(p.private, true); assert.equal(p.dm, "following"); assert.equal(p.mentions, "following"); assert.equal(p.filterRequests, true);
  assert.equal((await teen.req("PUT", "/api/privacy", { private: false })).status, 403);
  assert.equal((await teen.req("PUT", "/api/privacy", { dm: "everyone" })).status, 403);
  assert.equal((await teen.req("PUT", "/api/privacy", { filterRequests: false })).status, 403);
  assert.equal((await teen.req("PUT", "/api/privacy", { dm: "nobody" })).status, 200, "tightening is always allowed");
  assert.equal((await teen.req("PUT", "/api/privacy", { dm: "following" })).status, 200);
  assert.equal((await teen.req("PATCH", "/api/profile", { location: "جدة" })).status, 403);
  const post = await teen.req("POST", "/api/posts", { text: "مرحبا من المدرسة", location: "الرياض" });
  assert.equal(post.status, 200); assert.equal(post.post.location, null, "location stripped from a minor's post");
  // a stranger adult cannot DM the minor; the summary lists the protections
  assert.equal((await adult.req("POST", "/api/conversations", { user: teen.id })).status, 403);
  const s = await teen.req("GET", "/api/age"); assert.equal(s.protections.private, true); assert.equal(s.contentPref, "hide"); assert.ok(s.adultOn > new Date().toISOString().slice(0, 10));
  assert.equal((await adult.req("PUT", "/api/privacy", { dm: "everyone", private: false })).status, 200);
  assert.equal((await adult.req("PATCH", "/api/profile", { location: "جدة" })).status, 200);
});

test("labels + age filter: adult-only hidden from minors and unknown age, cover for adults, preferences show/hide, spoiler only covered", async () => {
  const graphic = (await adult.req("POST", "/api/posts", { text: "صورة من موقع الحادث", labels: ["graphic"] })).post;
  assert.deepEqual(graphic.contentLabels.post, ["graphic"]); assert.equal(graphic.sensitive, true);
  const violence = (await adult.req("POST", "/api/posts", { text: "مقطع من فيلم حربي", labels: ["violence"] })).post;
  const spoiler = (await adult.req("POST", "/api/posts", { text: "نهاية المسلسل كانت مفاجئة", labels: ["spoiler", "bogus"] })).post;
  assert.deepEqual(spoiler.contentLabels.post, ["spoiler"], "unknown labels dropped");
  const plain = (await adult.req("POST", "/api/posts", { text: "صباح الخير" })).post;
  const get = (c, p) => c.req("GET", "/api/posts/" + p.id);
  assert.equal((await get(teen, graphic)).status, 404); assert.equal((await get(teen, violence)).status, 404);
  const sp = await get(teen, spoiler); assert.equal(sp.status, 200); assert.equal(sp.post.cover, "blur");
  assert.equal((await get(teen, plain)).status, 200);
  assert.equal((await get(nodob, graphic)).status, 404, "unknown age never sees adult-only labels");
  const nv = await get(nodob, violence); assert.equal(nv.status, 200); assert.equal(nv.post.cover, "blur");
  assert.equal((await get(new H.Client(), graphic)).status, 404, "signed-out viewers are unknown age");
  const ag = await get(adult2, graphic); assert.equal(ag.status, 200); assert.equal(ag.post.cover, "blur"); assert.deepEqual(ag.post.contentLabels.post, ["graphic"]);
  assert.equal((await nodob.req("PUT", "/api/age/preferences", { sensitive: "show" })).status, 403);
  assert.equal((await teen.req("PUT", "/api/age/preferences", { sensitive: "blur" })).status, 403);
  assert.equal((await adult2.req("PUT", "/api/age/preferences", { sensitive: "show" })).contentPref, "show");
  assert.equal((await get(adult2, graphic)).post.cover, "none");
  await adult2.req("PUT", "/api/age/preferences", { sensitive: "hide" });
  assert.equal((await get(adult2, graphic)).status, 404); assert.equal((await get(adult2, spoiler)).status, 200, "spoilers are never hidden, only covered");
  await adult2.req("PUT", "/api/age/preferences", { sensitive: "blur" });
  assert.equal((await get(adult, graphic)).post.cover, "none", "own posts are never covered");
  // the shared filter used by feed/search/profile code paths
  const rows = await db().all("SELECT * FROM posts WHERE id IN ($1,$2,$3,$4)", [graphic.id, violence.id, spoiler.id, plain.id]);
  const vis = (await H.app.ctx.services.content.filterVisible(rows, teen.id)).map(r => r.id).sort();
  assert.deepEqual(vis, [spoiler.id, plain.id].sort());
  const feedIds = async (c) => { const f = await c.req("GET", "/api/feed?mode=latest"); assert.equal(f.status, 200, f.error); return (f.posts || f.items || []).map(p => p.id); };
  const tf = await feedIds(teen); assert.ok(tf.includes(plain.id), "feed works for the minor"); assert.ok(!tf.includes(graphic.id) && !tf.includes(violence.id), "feed is age-filtered");
  const af = await feedIds(adult2); assert.ok(af.includes(graphic.id), "adults keep the post (covered)");
  const fp = (await adult2.req("GET", "/api/feed?mode=latest")).posts.find(p => p.id === graphic.id);
  assert.equal(fp.cover, "blur"); assert.deepEqual(fp.contentLabels.post, ["graphic"], "feed items carry labels + cover via toClient");
  const batch = await adult2.req("GET", `/api/content-labels/batch?ids=${graphic.id},${plain.id},${violence.id}`);
  assert.equal(batch.items[graphic.id].cover, "blur"); assert.equal(batch.items[plain.id].cover, "none"); assert.deepEqual(batch.items[violence.id].labels.post, ["violence"]);
  assert.equal((await teen.req("GET", `/api/content-labels/batch?ids=${graphic.id}`)).items[graphic.id], undefined);
  // publisher edits labels; per-media labels; strangers cannot label
  assert.equal((await teen.req("PUT", `/api/posts/${plain.id}/labels`, { labels: ["violence"] })).status, 403);
  const img = (await adult.req("POST", "/api/posts", { text: "ألبوم", images: ["linear-gradient(135deg,#111,#222)", "linear-gradient(135deg,#333,#444)"], mediaLabels: { 1: ["medical"] } })).post;
  assert.deepEqual(img.contentLabels.media, { 1: ["medical"] });
  assert.equal((await get(teen, img)).status, 404, "a labelled image hides the post from minors");
  const cleared = await adult.req("PUT", `/api/posts/${img.id}/labels`, { labels: [], media: { 1: [] } });
  assert.deepEqual(cleared.labels, { post: [], media: {} }); assert.equal((await get(teen, img)).status, 200);
  // moderators can add a label the publisher cannot remove
  await admin.req("PUT", `/api/posts/${plain.id}/labels`, { labels: ["violence"] });
  const keep = await adult.req("PUT", `/api/posts/${plain.id}/labels`, { labels: [] });
  assert.deepEqual(keep.labels.post, ["violence"]);
  assert.equal((await new H.Client().req("GET", "/api/content-labels")).labels.length, 7);
});

test("people search & suggestions: minors are not suggested to adults unless already connected", async () => {
  const has = (r) => JSON.stringify(r).includes(teen.id);
  assert.equal((await teen.req("PATCH", "/api/me", { name: "ريماس" })).status, 200);
  const q = encodeURIComponent("ريماس");
  assert.equal(has(await teen2.req("GET", "/api/search/suggest?q=" + q)), true, "minors can find each other");
  assert.equal(has(await H.app.ctx.services.search.suggest({ id: adult.id }, "ريماس")), true, "the underlying search does return the minor");
  assert.equal(has(await adult.req("GET", "/api/search/suggest?q=" + q)), false);
  assert.equal(has(await adult.req("GET", "/api/search?q=" + q)), false);
  const users = [{ id: teen.id }, { id: adult.id }];
  assert.deepEqual((await H.app.ctx.services.minors.filterUsers(users, adult2.id)).map(u => u.id), [adult.id]);
  await db().run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [adult2.id, teen.id, new Date().toISOString()]);
  assert.deepEqual((await H.app.ctx.services.minors.filterUsers(users, adult2.id)).map(u => u.id), [teen.id, adult.id], "existing connection is kept");
  const boot = await adult.req("GET", "/api/bootstrap");
  assert.equal(boot.users.some(u => u.id === teen.id), false, "not in the bootstrap suggestion pool");
  await db().run("DELETE FROM follows WHERE src=$1 AND dst=$2", [adult2.id, teen.id]);
});

test("escalation: a severe report opens a critical held case, staff alerted, others cannot see the queue, evidence chain verifies", async () => {
  await admin.req("PUT", `/api/safety/staff/${agent.id}`, { role: "agent" });
  const bad = (await adult2.req("POST", "/api/posts", { text: "تواصل معي على الخاص يا صغيرة" })).post;
  assert.equal((await teen.req("GET", "/api/posts/" + bad.id)).status, 200);
  const rep = await teen.req("POST", "/api/reports", { target: bad.id, kind: "post", reason: "استدراج طفل عبر الرسائل" });
  assert.equal(rep.status, 200);
  const c = await until(() => db().get("SELECT * FROM safety_cases WHERE target=$1", [bad.id]), 4000, "case");
  assert.equal(c.severity, "critical"); assert.equal(c.category, "child_safety"); assert.equal(c.hold, 1); assert.equal(c.minor_involved, 1); assert.equal(c.subject_user, adult2.id);
  assert.equal((await adult.req("GET", "/api/posts/" + bad.id)).status, 404, "held content is quarantined for everyone else");
  assert.equal((await adult2.req("GET", "/api/posts/" + bad.id)).status, 200, "the author still sees it (no tip-off)");
  assert.equal((await admin.req("GET", "/api/posts/" + bad.id)).status, 200, "staff can still open it");
  const n = await until(() => db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='safety_case' AND ref=$2", [agent.id, c.id]), 3000, "staff alert");
  assert.ok(n);
  // a normal report does not open a case
  const ok = (await adult.req("POST", "/api/posts", { text: "منشور عادي للتجربة" })).post;
  await adult2.req("POST", "/api/reports", { target: ok.id, kind: "post", reason: "مزعج" }); await sleep(200);
  assert.equal(await db().get("SELECT 1 x FROM safety_cases WHERE target=$1", [ok.id]), undefined);
  // access restricted
  assert.equal((await adult.req("GET", "/api/safety/cases")).status, 404);
  assert.equal((await teen.req("GET", "/api/safety/cases/" + c.id)).status, 404);
  const list = await agent.req("GET", "/api/safety/cases"); assert.equal(list.cases[0].id, c.id); assert.equal(list.cases[0].severity, "critical"); assert.ok(list.counts.critical >= 1);
  const d = await agent.req("GET", "/api/safety/cases/" + c.id);
  assert.equal(d.chain.ok, true); assert.ok(d.evidence.length >= 2); assert.equal(d.evidence[0].kind, "post"); assert.equal(d.evidence[0].payload.text, bad.text);
  assert.equal(d.access, undefined, "agents do not see the access log");
  assert.ok(await db().get("SELECT 1 x FROM case_access_log WHERE case_id=$1 AND user_id=$2 AND action='view'", [c.id, agent.id]));
  // the author deletes the post: the preserved snapshot survives
  assert.equal((await adult2.req("DELETE", "/api/posts/" + bad.id)).status, 200);
  await agent.req("POST", "/api/safety/cases/" + c.id, { action: "note", note: "تمت المراجعة الأولية" });
  assert.equal((await agent.req("GET", "/api/safety/cases/" + c.id + "/verify")).ok, true);
  assert.equal(await H.app.ctx.services.minors.isPreserved(bad.id), true);
  // tampering breaks the chain
  await db().run("UPDATE case_evidence SET payload=$1 WHERE case_id=$2 AND seq=1", [{ text: "edited" }, c.id]);
  const v = await agent.req("GET", "/api/safety/cases/" + c.id + "/verify"); assert.equal(v.ok, false); assert.equal(v.brokenAt, 1);
  // agents cannot release a hold; admin (lead) can; close needs an outcome
  assert.equal((await agent.req("POST", "/api/safety/cases/" + c.id, { action: "release" })).status, 403);
  assert.equal((await agent.req("POST", "/api/safety/cases/" + c.id, { action: "close" })).status, 400);
  ids.case = c.id;
});

test("urgent flag from a user: self-harm becomes high priority with helplines; message targets must be the reporter's own conversation", async () => {
  const r = await teen2.req("POST", "/api/safety/escalate", { category: "self_harm", details: "صديقي يقول إنه سيؤذي نفسه الليلة" });
  assert.equal(r.status, 200); assert.equal(r.selfHarm, true); assert.ok(["high", "critical"].includes(r.severity)); assert.ok(r.helplines.length >= 1); assert.match(r.reference, /^[A-Z0-9]{6}$/);
  assert.equal(r.severity, "critical", "a minor involved + severe signal → critical");
  assert.equal((await adult.req("POST", "/api/safety/escalate", {})).status, 400);
  assert.equal((await adult.req("POST", "/api/safety/escalate", { target: "ms_doesnotexist", kind: "message", category: "child_safety" })).status, 404);
  const q = await admin.req("GET", "/api/safety/cases"); assert.ok(q.cases.findIndex(x => x.severity === "critical") < q.cases.findIndex(x => x.severity !== "critical") || q.cases.every(x => x.severity === "critical"), "critical first");
});

test("authority reports: lead/admin only, structured payload, manual delivery, export hash verified, submission recorded", async () => {
  assert.equal((await agent.req("POST", `/api/safety/cases/${ids.case}/authority-reports`, { body: "ncmec" })).status, 403);
  assert.equal((await admin.req("POST", `/api/safety/cases/${ids.case}/authority-reports`, { body: "unknown_body" })).status, 400);
  const d = await admin.req("POST", `/api/safety/cases/${ids.case}/authority-reports`, { body: "ncmec", jurisdiction: "SA", notes: "مرفق للإحالة" });
  assert.equal(d.status, 200); assert.equal(d.delivery, "manual"); assert.equal(d.report.status, "draft"); assert.equal(d.channelConfigured, true);
  const x = await admin.req("GET", `/api/safety/authority-reports/${d.report.id}/export`);
  assert.equal(x.verified, true); assert.equal(x.payload.schema, "mujtama.authority-report/1"); assert.equal(x.payload.delivery, "manual");
  assert.equal(x.payload.subject.handle, "mn_adult2"); assert.ok(Array.isArray(x.payload.subject.recentSessions)); assert.ok(x.payload.evidence.length >= 2);
  assert.equal(x.payload.incident.minorInvolved, true); assert.match(x.instructions, /يدوي|القناة/);
  assert.equal(JSON.stringify(x.payload).includes(teen.id), false, "the reporter's identity is not in the export");
  const s = await admin.req("POST", `/api/safety/authority-reports/${d.report.id}/submitted`, { externalRef: "CT-12345" });
  assert.equal(s.status, 200); assert.equal(s.state, "submitted");
  const row = await db().get("SELECT * FROM authority_reports WHERE id=$1", [d.report.id]); assert.equal(row.status, "submitted"); assert.equal(row.external_ref, "CT-12345"); assert.ok(row.exported_at);
  const cd = await admin.req("GET", "/api/safety/cases/" + ids.case); assert.ok(cd.access.some(a => a.action === "authority_export")); assert.equal(cd.authorityReports.length, 1);
  const closed = await admin.req("POST", "/api/safety/cases/" + ids.case, { action: "close", outcome: "referred" }); assert.equal(closed.case.status, "closed"); assert.equal(closed.case.hold, true, "a referred case keeps its evidence held");
});

test("family links: mutual follow + two-sided consent, tighten-only controls, transparency for the minor, either side can end it", async () => {
  assert.equal((await adult.req("POST", "/api/family/links", { handle: "mn_teen", as: "guardian" })).status, 403, "strangers cannot send link requests");
  await teen.req("PUT", "/api/follows/" + adult.id); await adult.req("PUT", "/api/follows/" + teen.id);
  await db().run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [adult.id, teen.id, new Date().toISOString()]); // teen is private: approve the request
  assert.equal((await teen.req("POST", "/api/family/links", { handle: "mn_teen2", as: "guardian" })).status, 400, "a minor cannot be a guardian");
  assert.equal((await nodob.req("POST", "/api/family/links", { handle: "mn_teen", as: "guardian" })).status, 400);
  const inv = await teen.req("POST", "/api/family/links", { handle: "mn_adult", as: "minor" });
  assert.equal(inv.status, 200); assert.equal(inv.link.status, "pending"); assert.equal(inv.link.role, "minor");
  assert.equal((await teen.req("POST", `/api/family/links/${inv.link.id}/accept`)).status, 403, "the initiator cannot accept their own request");
  const acc = await adult.req("POST", `/api/family/links/${inv.link.id}/accept`); assert.equal(acc.link.status, "active"); assert.equal(acc.link.role, "guardian");
  const ctl = await adult.req("PUT", `/api/family/links/${inv.link.id}/controls`, { dm: "nobody", comments: "following", private: false, location: true });
  assert.deepEqual(ctl.link.controls, { dm: "nobody", comments: "following" }, "only the limited controls exist");
  const p = await teen.req("GET", "/api/privacy"); assert.equal(p.dm, "nobody"); assert.equal(p.comments, "following");
  assert.equal((await teen.req("PUT", "/api/privacy", { dm: "following" })).status, 403, "the guardian's tighter setting is the new floor");
  assert.equal((await teen2.req("PUT", "/api/family/links/" + inv.link.id + "/controls", { dm: "nobody" })).status, 404);
  const f = await teen.req("GET", "/api/family");
  assert.equal(f.whatGuardiansSee.privacy.dm, "nobody"); assert.match(f.whatGuardiansSee.note, /لا يرى/);
  assert.ok(f.activity.some(a => a.action === "guardian_controls" && /من يراسله/.test(a.detail)), "the minor sees what changed");
  const ov = await adult.req("GET", `/api/family/links/${inv.link.id}/overview`); assert.deepEqual(Object.keys(ov.view).sort(), Object.keys(f.whatGuardiansSee).sort(), "guardian sees exactly what the minor is shown");
  assert.ok(await until(() => db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='family_update'", [teen.id]), 3000));
  assert.equal((await teen.req("DELETE", "/api/family/links/" + inv.link.id)).status, 200);
  assert.equal((await adult.req("GET", `/api/family/links/${inv.link.id}/overview`)).status, 404);
});

test("age changes: a minor's raise to adult waits for review (or a Pi KYC signal); under-13 declared later suspends the account", async () => {
  const r = await teen2.req("POST", "/api/age", { birthDate: ymd(20) });
  assert.equal(r.review, true); assert.equal(r.band, "teen"); assert.ok(r.pending);
  const list = await admin.req("GET", "/api/safety/age-reviews"); assert.ok(list.reviews.some(x => x.user === teen2.id));
  assert.equal((await agent.req("POST", "/api/safety/age-reviews/" + teen2.id, { action: "approve" })).status, 403);
  assert.equal((await admin.req("POST", "/api/safety/age-reviews/" + teen2.id, { action: "approve" })).status, 200);
  assert.equal((await teen2.req("GET", "/api/age")).band, "adult");
  // Pi KYC signal (env-gated) auto-approves a pending raise only for the linked Pi account
  await db().run("UPDATE users SET pi_uid='pi_teen' WHERE id=$1", [teen.id]);
  await teen.req("POST", "/api/age", { birthDate: ymd(19) });
  assert.equal((await teen.req("POST", "/api/age/pi-kyc", { accessToken: "someone_else:kyc" })).status, 403);
  assert.equal((await teen.req("POST", "/api/age/pi-kyc", { accessToken: "bad" })).status, 401);
  const nk = await teen.req("POST", "/api/age/pi-kyc", { accessToken: "pi_teen:nokyc" }); assert.equal(nk.kyc.signal, "unverified"); assert.equal(nk.band, "teen");
  const k = await teen.req("POST", "/api/age/pi-kyc", { accessToken: "pi_teen:kyc" }); assert.equal(k.kyc.signal, "verified"); assert.equal(k.band, "adult"); assert.equal(k.source, "pi_kyc");
  assert.ok(piCalls.every(u => u.endsWith("/v2/me")));
  // adult → minor applies immediately and protections follow
  const down = await nodob.req("POST", "/api/age", { birthDate: ymd(14) }); assert.equal(down.band, "teen"); assert.equal((await nodob.req("GET", "/api/privacy")).private, true);
  // declaring under 13 later suspends the account and ends its sessions
  const kid = await mk("mn_kid", ymd(14));
  const g = await kid.req("POST", "/api/age", { birthDate: ymd(9) }); assert.equal(g.blocked, true);
  assert.equal((await db().get("SELECT status FROM users WHERE id=$1", [kid.id])).status, "suspended");
  assert.equal((await kid.req("GET", "/api/age")).status, 401);
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='AGE_GATE' AND target=$1", [kid.id]));
});

test("migration 018 is additive and reversible on this dialect", async () => {
  const { render } = require("../lib/migrations"), mig = require("../migrations/018_minors");
  const exec = async (sql) => { for (const s of render(sql, db().dialect).split(";").map(x => x.trim()).filter(Boolean)) await db().exec(s); };
  const src = require("node:fs").readFileSync(require.resolve("../migrations/018_minors"), "utf8").split("async down")[0];
  assert.ok(!/\b(DROP|DELETE|UPDATE)\b/i.test(src.replace(/ON DELETE CASCADE/g, "")), "up() only creates");
  await mig.down(db(), exec);
  const still = await db().get("SELECT id FROM users WHERE id=$1", [adult.id]); assert.equal(still?.id, adult.id, "existing data untouched");
  await mig.up(db(), exec); await mig.up(db(), exec); // idempotent (IF NOT EXISTS)
  assert.equal((await db().get("SELECT COUNT(*) n FROM age_profiles")).n, 0);
});

// last: on PostgreSQL a second boot() resets the shared schema
test("Pi KYC is off unless MINORS_PI_KYC=1; MINORS_REQUIRE_DOB makes the birth date mandatory", async () => {
  const H2 = await boot({ minorsOpts: { env: { MINORS_REQUIRE_DOB: "1" } } });
  try {
    const c = new H2.Client();
    const r = await c.req("POST", "/api/auth/register", { name: "بلا تاريخ", handle: "mn_req", password: "secret123" }); assert.equal(r.status, 400); assert.equal(r.code, "dob_required");
    const ok = await c.req("POST", "/api/auth/register", { name: "بتاريخ", handle: "mn_req2", password: "secret123", birthDate: ymd(22) }); assert.equal(ok.status, 200);
    assert.equal((await c.req("POST", "/api/age/pi-kyc", { accessToken: "x" })).status, 501);
  } finally { await H2.app.close(); }
});
