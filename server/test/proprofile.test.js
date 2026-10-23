/* Phase 76 — professional profile & CV: create/validate (headline, links, dates, own-post portfolio), entries + reorder,
 * skills (dedupe, cap), privacy (public / members / followers / private + stricter sections, owner preview), blocked
 * viewers, social-profile badge, printable /cv page (viewer rules, download), JSON Resume export, talent directory
 * (search, filters, opt-out, members-only), reports → flag out of the directory, staff hide / restore + notifications,
 * minors (never public / listed, no paid work), delete; migration 056 reversible + data map. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let saraPost;
let H, adminC, sara, omar, kid, anon, fol;
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
const PRO = { headline: "مطوّرة واجهات أمامية — React وتجربة المستخدم", about: "أبني واجهات عربية سريعة وسهلة الوصول منذ ٦ سنوات، وأحب تحويل الأفكار المعقدة إلى تجارب بسيطة.", city: "جدة", country: "السعودية", openTo: ["freelance", "jobs"], languages: [{ name: "العربية", level: "native" }, { name: "English", level: "fluent" }], links: [{ label: "GitHub", url: "https://github.com/sara" }], visibility: "public" };

test.before(async () => {
  H = await boot({ proprofileOpts: {} });
  adminC = await mk("pro_admin"); sara = await mk("pro_sara", "سارة"); omar = await mk("pro_omar", "عمر"); kid = await mk("pro_kid", "يافع"); fol = await mk("pro_fol", "متابع");
  anon = new H.Client();
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("create + validate; entries, reorder, own-post portfolio; skills; completeness", async () => {
  assert.equal((await anon.req("PUT", "/api/pro/me", PRO)).status, 401);
  assert.equal((await sara.req("POST", "/api/pro/me/items", { kind: "experience", title: "مطوّرة" })).code, "no_profile");
  assert.equal((await sara.req("PUT", "/api/pro/me", { ...PRO, headline: "" })).status, 400);
  assert.equal((await sara.req("PUT", "/api/pro/me", { ...PRO, links: [{ url: "javascript:alert(1)" }] })).code, "bad_link");
  let r = await sara.req("PUT", "/api/pro/me", PRO); assert.equal(r.status, 200, r.error);
  assert.equal(r.profile.visibility, "public"); assert.deepEqual(r.profile.openTo, ["freelance", "jobs"]);
  const e1 = await sara.req("POST", "/api/pro/me/items", { kind: "experience", title: "مطوّرة واجهات", org: "شركة نور", place: "جدة", start: "2021-03", current: true, body: "قيادة فريق الواجهات." });
  assert.equal(e1.status, 200, e1.error); assert.equal(e1.item.current, true); assert.equal(e1.item.end, null);
  const e2 = await sara.req("POST", "/api/pro/me/items", { kind: "experience", title: "متدرّبة", org: "استوديو", start: "2019-06", end: "2020-12" }); assert.equal(e2.status, 200);
  assert.equal((await sara.req("POST", "/api/pro/me/items", { kind: "experience", title: "خطأ", start: "2020-05", end: "2019-01" })).code, "bad_date");
  assert.equal((await sara.req("POST", "/api/pro/me/items", { kind: "experience", title: "مستقبل", start: "2999-01" })).code, "bad_date");
  assert.equal((await sara.req("POST", "/api/pro/me/items", { kind: "experience", title: "بلا تاريخ" })).code, "bad_date");
  assert.equal((await sara.req("POST", "/api/pro/me/items", { kind: "nope", title: "x" })).status, 400);
  // portfolio: only own published post
  const mine = await sara.req("POST", "/api/posts", { id: "p_pro_sara", type: "post", text: "مشروع واجهة متجر عربي" }); assert.equal(mine.status, 200, mine.error); saraPost = mine.post.id;
  const other = await omar.req("POST", "/api/posts", { id: "p_pro_omar", type: "post", text: "منشور عمر" }); assert.equal(other.status, 200);
  assert.equal((await sara.req("POST", "/api/pro/me/items", { kind: "portfolio", title: "سرقة", postId: other.post.id })).code, "bad_post");
  const pf = await sara.req("POST", "/api/pro/me/items", { kind: "portfolio", title: "متجر عربي", postId: mine.post.id, url: "https://example.com/shop" }); assert.equal(pf.status, 200, pf.error);
  await sara.req("POST", "/api/pro/me/items", { kind: "education", title: "بكالوريوس علوم الحاسب", org: "جامعة الملك عبدالعزيز", start: "2015-09", end: "2019-06" });
  // edit + reorder + delete
  assert.equal((await sara.req("PATCH", "/api/pro/me/items/" + e2.item.id, { title: "متدرّبة واجهات" })).item.title, "متدرّبة واجهات");
  assert.equal((await omar.req("PATCH", "/api/pro/me/items/" + e2.item.id, { title: "x" })).status, 404);
  assert.equal((await sara.req("POST", "/api/pro/me/items/reorder", { kind: "experience", ids: [e2.item.id] })).status, 400);
  assert.equal((await sara.req("POST", "/api/pro/me/items/reorder", { kind: "experience", ids: [e2.item.id, e1.item.id] })).status, 200);
  const tmp = await sara.req("POST", "/api/pro/me/items", { kind: "award", title: "جائزة", start: "2022-01" });
  assert.equal((await sara.req("DELETE", "/api/pro/me/items/" + tmp.item.id)).status, 200);
  // skills: dedupe by normalised name, levels clamped, cap
  r = await sara.req("PUT", "/api/pro/me/skills", { skills: [{ name: "React", level: 5, years: 6 }, { name: "react", level: 2 }, { name: "تصميم واجهات", level: 9 }, { name: "إمكانية الوصول", years: 4 }, "TypeScript"] });
  assert.equal(r.status, 200, r.error); assert.equal(r.skills.length, 4); assert.equal(r.skills[1].level, 5); assert.equal(r.skills[3].level, 3);
  assert.equal((await sara.req("PUT", "/api/pro/me/skills", { skills: Array.from({ length: 31 }, (_, i) => "مهارة " + i) })).status, 400);
  const me = await sara.req("GET", "/api/pro/me");
  assert.equal(me.items.filter((i) => i.kind === "experience")[0].id, e2.item.id); // reordered
  assert.equal(me.completeness.percent, 100);
});

test("privacy: visibility levels, stricter sections, owner preview, blocked, badge on the social profile", async () => {
  let v = await anon.req("GET", "/api/pro/u/pro_sara"); assert.equal(v.status, 200); assert.equal(v.profile.headline, PRO.headline);
  assert.ok(v.sections.experience.length === 2 && v.skills.length === 4); assert.equal(v.profile.views, undefined); assert.equal(v.sections.portfolio[0].post.id, saraPost);
  // stricter section: experience members-only; links followers-only
  await sara.req("PUT", "/api/pro/me", { sections: { experience: "members", links: "followers", about: "public" } });
  v = await anon.req("GET", "/api/pro/u/pro_sara"); assert.equal(v.sections.experience, null); assert.equal(v.profile.links, null); assert.ok(v.profile.about);
  v = await omar.req("GET", "/api/pro/u/pro_sara"); assert.equal(v.sections.experience.length, 2); assert.equal(v.profile.links, null);
  assert.equal((await fol.req("PUT", "/api/follows/" + sara.id)).status, 200);
  v = await fol.req("GET", "/api/pro/u/pro_sara"); assert.equal(v.profile.links.length, 1);
  // whole profile members-only
  await sara.req("PUT", "/api/pro/me", { visibility: "members" });
  v = await anon.req("GET", "/api/pro/u/pro_sara"); assert.equal(v.locked, true); assert.equal(v.sections, undefined);
  assert.equal((await omar.req("GET", "/api/pro/u/pro_sara")).locked, undefined);
  // owner preview as a stranger / member / follower
  v = await sara.req("GET", "/api/pro/u/pro_sara?as=stranger"); assert.equal(v.locked, true);
  v = await sara.req("GET", "/api/pro/u/pro_sara?as=member"); assert.equal(v.preview, "member"); assert.equal(v.profile.links, null); assert.equal(v.sections.experience.length, 2);
  v = await sara.req("GET", "/api/pro/u/pro_sara?as=follower"); assert.equal(v.profile.links.length, 1);
  // badge on the social profile
  assert.equal((await omar.req("GET", "/api/profiles/pro_sara")).pro.headline, PRO.headline);
  assert.equal((await anon.req("GET", "/api/profiles/pro_sara")).pro, null);
  // private
  await sara.req("PUT", "/api/pro/me", { visibility: "private" });
  v = await omar.req("GET", "/api/pro/u/pro_sara"); assert.equal(v.locked, true); assert.equal(v.headline, null);
  assert.equal((await adminC.req("GET", "/api/pro/u/pro_sara")).locked, undefined); // staff can review
  // views counted once per member, visible to the owner only
  await sara.req("PUT", "/api/pro/me", { visibility: "public" });
  await omar.req("GET", "/api/pro/u/pro_sara"); await omar.req("GET", "/api/pro/u/pro_sara");
  assert.ok((await sara.req("GET", "/api/pro/me")).profile.views >= 1);
  // blocked: nothing
  assert.equal((await sara.req("PUT", "/api/protection/blocks/" + omar.id, { linked: false })).status, 200);
  assert.equal((await omar.req("GET", "/api/pro/u/pro_sara")).status, 404);
  assert.equal((await omar.req("GET", "/api/pro/search")).profiles.some((p) => p.user.handle === "pro_sara"), false);
  assert.equal((await sara.req("DELETE", "/api/protection/blocks/" + omar.id)).status, 200);
  assert.equal((await omar.req("GET", "/api/pro/u/pro_sara")).status, 200);
  assert.equal((await anon.req("GET", "/api/pro/u/nobody_here")).status, 404);
  assert.equal((await anon.req("GET", "/api/pro/u/pro_omar")).code, "no_profile");
});

test("printable CV page + JSON Resume export", async () => {
  let r = await fetch(H.base + "/cv/pro_sara"); let html = await r.text();
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/html/); assert.match(html, /dir="rtl"/); assert.match(html, /مطوّرة واجهات أمامية/);
  assert.match(html, /@media print/); assert.match(html, /آخر تحديث \d{4}-\d{2}-\d{2}/); assert.doesNotMatch(html, /<script/); assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.match(html, /التعليم/); assert.doesNotMatch(html, /<h2>الخبرات/); assert.doesNotMatch(html, /github\.com\/sara/); // experience members-only, links followers-only
  r = await fetch(H.base + "/cv/pro_sara?download=1"); assert.match(r.headers.get("content-disposition") || "", /cv-pro_sara\.html/);
  r = await fetch(H.base + "/cv/pro_sara", { headers: { Cookie: sara.cookie } }); html = await r.text(); assert.match(html, /github\.com\/sara/); assert.match(html, /<h2>الخبرات/); // the owner sees everything
  await sara.req("PUT", "/api/pro/me", { visibility: "members" });
  r = await fetch(H.base + "/cv/pro_sara"); assert.equal(r.status, 403); assert.match(await r.text(), /لأعضاء مجتمع بلس/);
  r = await fetch(H.base + "/cv/pro_sara", { headers: { Cookie: omar.cookie } }); assert.equal(r.status, 200);
  assert.equal((await fetch(H.base + "/cv/no_such_user")).status, 404);
  await sara.req("PUT", "/api/pro/me", { visibility: "public" });
  const j = await sara.req("GET", "/api/pro/me/export"); assert.equal(j.status, 200);
  assert.equal(j.basics.name, "سارة"); assert.equal(j.basics.label, PRO.headline); assert.equal(j.work.length, 2); assert.equal(j.education.length, 1); assert.equal(j.skills.length, 4); assert.equal(j.languages.length, 2); assert.equal(j.projects[0].url, "https://example.com/shop");
  assert.equal((await omar.req("GET", "/api/pro/me/export")).code, "no_profile");
});

test("talent directory: search, filters, opt-out, members-only, reports flag, staff hide / restore", async () => {
  await omar.req("PUT", "/api/pro/me", { headline: "مصمم جرافيك وهويات بصرية", city: "الرياض", openTo: ["freelance"], visibility: "members" });
  await omar.req("PUT", "/api/pro/me/skills", { skills: ["تصميم شعارات", "Illustrator"] });
  const s = await omar.req("GET", "/api/pro/search"); assert.equal(s.status, 200); assert.equal(s.total, 2);
  assert.equal((await anon.req("GET", "/api/pro/search")).total, 1); // members-only profile hidden from visitors
  assert.equal((await omar.req("GET", "/api/pro/search?q=" + encodeURIComponent("واجهات"))).profiles[0].user.handle, "pro_sara");
  assert.equal((await omar.req("GET", "/api/pro/search?q=" + encodeURIComponent("تصميم"))).total, 2); // headline (omar) + skill «تصميم واجهات» (sara)
  assert.equal((await omar.req("GET", "/api/pro/search?skill=react")).profiles[0].user.handle, "pro_sara");
  assert.equal((await omar.req("GET", "/api/pro/search?city=" + encodeURIComponent("الرياض"))).profiles[0].user.handle, "pro_omar");
  assert.equal((await omar.req("GET", "/api/pro/search?open=jobs")).total, 1);
  await omar.req("PUT", "/api/pro/me", { searchable: false });
  assert.equal((await sara.req("GET", "/api/pro/search")).total, 1);
  // reports
  assert.equal((await sara.req("POST", "/api/pro/u/pro_sara/report", { reason: "fake" })).status, 400);
  assert.equal((await omar.req("POST", "/api/pro/u/pro_sara/report", { reason: "nope" })).status, 400);
  assert.equal((await omar.req("POST", "/api/pro/u/pro_sara/report", { reason: "fake", note: "شهادات غير حقيقية" })).status, 200);
  assert.equal((await omar.req("POST", "/api/pro/u/pro_sara/report", { reason: "fake" })).code, "already_reported");
  const r2 = await fol.req("POST", "/api/pro/u/pro_sara/report", { reason: "scam" }); assert.equal(r2.flagged, false);
  const r3 = await adminC.req("POST", "/api/pro/u/pro_sara/report", { reason: "impersonation" }); assert.equal(r3.flagged, true);
  assert.equal((await fol.req("GET", "/api/pro/search")).total, 0); // flagged → out of the directory
  assert.equal((await sara.req("GET", "/api/admin/pro")).status, 403);
  let a = await adminC.req("GET", "/api/admin/pro"); assert.equal(a.queue[0].reports.length, 3); assert.equal(a.queue[0].user.handle, "pro_sara");
  assert.equal((await adminC.req("POST", "/api/admin/pro/pro_sara", { action: "hide" })).status, 400); // reason required
  a = await adminC.req("POST", "/api/admin/pro/pro_sara", { action: "hide", reason: "بلاغات متعددة عن شهادات مزيّفة" }); assert.equal(a.hidden.length, 1);
  assert.ok((await kinds(sara.id)).includes("pro_hidden"));
  assert.equal((await omar.req("GET", "/api/pro/u/pro_sara")).status, 404);
  assert.equal((await sara.req("GET", "/api/pro/u/pro_sara")).hidden, true); // the owner still sees it, with the reason
  assert.equal((await omar.req("GET", "/api/profiles/pro_sara")).pro, null);
  a = await adminC.req("POST", "/api/admin/pro/pro_sara", { action: "restore" }); assert.equal(a.hidden.length, 0); assert.equal(a.queue.length, 0);
  assert.ok((await kinds(sara.id)).includes("pro_restored"));
  assert.equal((await fol.req("GET", "/api/pro/search")).total, 1);
});

test("minors: never public or listed, no paid work; delete; data map + migration down/up", async () => {
  assert.equal((await kid.req("PUT", "/api/pro/me", { headline: "طالب ثانوي مهتم بالبرمجة", visibility: "public" })).code, "minor_restricted");
  assert.equal((await kid.req("PUT", "/api/pro/me", { headline: "طالب ثانوي مهتم بالبرمجة", visibility: "followers", openTo: ["freelance"] })).code, "minor_restricted");
  const k = await kid.req("PUT", "/api/pro/me", { headline: "طالب ثانوي مهتم بالبرمجة", visibility: "followers", openTo: ["volunteer"], searchable: true });
  assert.equal(k.status, 200, k.error); assert.equal(k.profile.searchable, false); assert.equal(k.minor, true);
  assert.ok(k.options.visibility.every((o) => ["followers", "private"].includes(o.key))); assert.ok(k.options.openTo.every((o) => ["mentoring", "volunteer"].includes(o.key)));
  assert.equal((await sara.req("GET", "/api/pro/search?q=" + encodeURIComponent("طالب"))).total, 0);
  assert.equal((await anon.req("GET", "/api/pro/u/pro_kid")).locked, true);
  // data map + delete
  const map = require("../lib/compliance-lib.js");
  const tables = JSON.stringify(map.DATA_MAP || map.dataMap || map);
  for (const t of ["pro_profiles", "pro_items", "pro_skills", "pro_reports"]) assert.ok(tables.includes(t), t);
  assert.equal((await kid.req("DELETE", "/api/pro/me")).status, 200);
  assert.equal((await anon.req("GET", "/api/pro/u/pro_kid")).code, "no_profile");
  const mig = require("../migrations/056_proprofile.js"), exec = async (sql) => { for (const s of sql.replace(/\{TS\}/g, db().dialect === "postgres" ? "TIMESTAMPTZ" : "TEXT").split(";").map((x) => x.trim()).filter(Boolean)) await db().exec(s); };
  await mig.down(db(), exec); await mig.up(db(), exec); await mig.up(db(), exec); // idempotent
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM pro_profiles")).n), 0);
});
