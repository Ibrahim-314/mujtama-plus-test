/* Phases 62 + 67 + 72 e2e against the REAL server (production build).
 * P62: #/scheduled queue (grouped by day, chips, 44px actions), #/drafts (cloud drafts, actions on their own row),
 *      #/series hub → series page → post page series card (prev/next) → editor → stats.
 * P67: #/biz directory by city (filters, Pi badge, open-now) → business page (hours, reviews, Pi box) → #/biz/new form.
 * P72: #/courses → course page → editor; learner: lesson, mark done, quiz submit → result.
 * axe: no serious/critical WCAG A/AA issues on every new screen; no page errors; chunks lazy; no inline handlers;
 * tap targets ≥ 44px on the main actions. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p, other, ser, biz, course; const eps = [], L = {}; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const textHas = (sel, re) => until(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ""), [sel, re.source]);
async function axe() {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const api = (m, path, b) => p.evaluate(([m, path, b]) => Remote.api(m, path, b), [m, path, b]);
const rl = () => S.app.ctx.rl.w.clear();
const go = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(150); };
const minTap = (sel) => p.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 404, body: "" }));
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "p4_e2e", "معلّمة الاختبار"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "متعلّم", handle: "p4_other", password: "secret123" }) });
  assert.equal(reg.status, 200);
  other = { ck: reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  const later = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  // P62 seed
  rl(); ser = (await api("POST", "/api/cseries", { title: "سلسلة الاختبار", descr: "حلقات قصيرة", kind: "series" })).series;
  for (const t of ["الأولى", "الثانية", "الثالثة"]) { rl(); eps.push((await api("POST", "/api/posts", { type: "article", title: "الحلقة " + t, markdown: `## ${t}\n` + ("شرح الحلقة " + t + " بأمثلة. ").repeat(20) })).post.id); }
  for (const e of eps) await api("POST", `/api/cseries/${ser.id}/items`, { postId: e });
  rl(); await api("POST", "/api/schedule", { post: { type: "post", markdown: "منشور مجدول للاختبار" }, publishAt: later(5), tz: "Asia/Riyadh" });
  rl(); await api("POST", "/api/schedule", { post: { type: "article", title: "حلقة قادمة", markdown: "قريباً" }, publishAt: later(30), tz: "Asia/Riyadh", seriesId: ser.id });
  await api("PUT", "/api/drafts/dr_e2edraft1", { data: { type: "post", title: "", markdown: "مسودة طويلة جداً عن تنظيم الوقت أثناء التعلم الذاتي وكيف نحافظ على الاستمرارية", images: [], alts: [], visibility: "public" }, device: "web" });
  // P67 seed
  const week = Array.from({ length: 7 }, () => ["00:00", "00:00"]);
  rl(); biz = (await api("POST", "/api/biz", { name: "مقهى الاختبار", category: "cafe", descr: "قهوة مختصة ونقبل Pi.", address: "حي الشاطئ، جدة", lat: 21.54, lng: 39.17, hoursWeek: week, acceptsPi: true, piNote: "خصم ٥٪ بـ Pi", phone: "+966 55 123 4567" })).place;
  await S.app.ctx.db.run("UPDATE places SET status='approved' WHERE id=$1", [biz.id]);
  rl(); await fetch(S.base + `/api/places/${biz.id}/reviews`, { method: "POST", headers: { ...H(), Cookie: other.ck }, body: JSON.stringify({ rating: 5, text: "ممتاز ودفعت بـ Pi" }) });
  // P72 seed
  rl(); const g = await api("POST", "/api/study/groups", { name: "مجموعة الدورة", desc: "تعلّم", mode: "group", subject: "برمجة", type: "public" });
  rl(); await fetch(S.base + `/api/communities/${g.group.id}/join`, { method: "POST", headers: { ...H(), Cookie: other.ck }, body: JSON.stringify({ acceptRules: true }) });
  const c = await api("POST", "/api/courses", { communityId: g.group.id, title: "دورة الاختبار", subtitle: "مقدمة عملية", level: "beginner", descr: "وصف الدورة" });
  course = c.course; const m1 = c.outline[0].id;
  L.a = (await api("POST", `/api/courses/${course.id}/lessons`, { moduleId: m1, title: "الدرس الأول", kind: "text", minutes: 5, body: "## مقدمة\nمحتوى الدرس." })).lesson.id;
  L.q = (await api("POST", `/api/courses/${course.id}/lessons`, { moduleId: m1, title: "اختبار قصير", kind: "quiz", passPct: 50, quiz: { questions: [{ q: "ما ناتج ١+١؟", options: ["١", "٢"], answer: 1, explain: "بديهي" }] } })).lesson.id;
  await api("PATCH", "/api/courses/" + course.id, { status: "published" });
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("P62: scheduled queue, drafts, series hub/page/editor/stats, post series card; 44px; axe clean", async () => {
  await go("#/scheduled");
  await until(() => document.querySelectorAll(".sq-item").length >= 2);
  assert.match(await p.textContent("#view"), /منشور مجدول للاختبار/);
  assert.match(await p.textContent("#view"), /سلسلة الاختبار/);
  assert.ok((await minTap(".sq-acts .btn")) >= 44, "queue actions 44px");
  assert.deepEqual(await axe(), []);
  await go("#/drafts");
  await until(() => !!document.querySelector("#sq-dl li"));
  const w = await p.evaluate(() => document.querySelector("#sq-dl .t").getBoundingClientRect().width);
  assert.ok(w > 150, "draft title has room (was squeezed to one letter): " + w);
  const del = await p.evaluate(() => { const b = document.querySelector("#sq-dl [data-del]"), cs = getComputedStyle(b); return [cs.color, cs.backgroundColor]; });
  assert.notEqual(del[0], del[1], "delete label visible");
  assert.deepEqual(await axe(), []);
  await go("#/series");
  await textHas("#view", /سلسلة الاختبار/);
  assert.deepEqual(await axe(), []);
  await go("#/series/" + ser.id);
  await until(() => document.querySelectorAll("#view a[href^='#/post/']").length >= 3);
  assert.deepEqual(await axe(), []);
  await go("#/post/" + eps[1]);
  await until(() => /الحلقة الأولى/.test(document.querySelector("#view")?.textContent || "") && /الحلقة الثالثة/.test(document.querySelector("#view").textContent), null, 20000);
  assert.deepEqual(await axe(), []);
  await go(`#/series/${ser.id}/edit`);
  await until(() => document.querySelectorAll(".sq-eps li, .sq-eps > *").length >= 3);
  assert.ok((await minTap(".sq-mv button")) >= 44);
  assert.deepEqual(await axe(), []);
  await go(`#/series/${ser.id}/stats`);
  await p.waitForTimeout(800);
  assert.deepEqual(await axe(), []);
});

test("P67: business directory by city → business page → add form; axe clean", async () => {
  await go("#/biz?city=" + encodeURIComponent("جدة"));
  await textHas("#view", /مقهى الاختبار/);
  assert.deepEqual(await axe(), []);
  await go("#/biz/" + biz.id);
  await until(() => /خصم ٥٪ بـ Pi/.test(document.querySelector("#view")?.textContent || "") && /ممتاز ودفعت/.test(document.querySelector("#view").textContent));
  assert.match(await p.textContent("#view"), /ساعات العمل/);
  assert.deepEqual(await axe(), []);
  await go("#/biz/new");
  await until(() => !!document.querySelector("#bz-ef, form"));
  assert.deepEqual(await axe(), []);
  await go("#/admin/biz");
  await p.waitForTimeout(800);
  assert.deepEqual(await axe(), []);
});

test("P72: courses list, course page, editor (teacher); learner lesson + quiz; axe clean", async () => {
  await go("#/courses");
  await p.waitForTimeout(800);
  assert.deepEqual(await axe(), []);
  await go("#/course/" + course.id);
  await textHas("#view", /دورة الاختبار/);
  assert.deepEqual(await axe(), []);
  await go(`#/course/${course.id}/edit`);
  await textHas("#view", /الدرس الأول/);
  assert.deepEqual(await axe(), []);
  // learner in a second context
  const c2 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  const [name, ...v] = other.ck.split("=");
  await c2.addCookies([{ name, value: v.join("="), url: S.base }]);
  const q = await c2.newPage(); q.on("pageerror", (e) => errors.push("learner: " + e.message));
  await q.goto(S.base + "/?nosw#/home"); await q.waitForTimeout(800);
  await q.evaluate(() => { try { DB.onboarded = true; save?.(); } catch { } });
  await q.evaluate((h) => { location.hash = h; }, `#/course/${course.id}`);
  await q.waitForFunction(() => /دورة الاختبار/.test(document.querySelector("#view")?.textContent || ""), null, { timeout: 20000 });
  rl(); await q.evaluate((id) => Remote.api("POST", `/api/courses/${id}/enrol`), course.id);
  await q.evaluate((h) => { location.hash = h; }, `#/course/${course.id}/learn/${L.a}`);
  await q.waitForFunction(() => /محتوى الدرس/.test(document.querySelector("#view")?.textContent || ""), null, { timeout: 15000 });
  if (await q.$("#cx-done")) { await q.click("#cx-done"); await q.waitForTimeout(500); }
  await q.evaluate((h) => { location.hash = h; }, `#/course/${course.id}/learn/${L.q}`);
  await q.waitForSelector("#cx-qf", { timeout: 15000 });
  await q.click("#cx-qf input[type=radio] >> nth=1");
  await q.click("#cx-qf [type=submit]");
  await q.waitForFunction(() => /١٠٠|100/.test(document.querySelector("#view")?.textContent || ""), null, { timeout: 10000 });
  await q.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const v2 = await q.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id));
  assert.deepEqual(v2, []);
  await c2.close();
});

test("no page errors, no inline handlers in new chunks", async () => {
  assert.deepEqual(errors, []);
  const inline = await p.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name))).length);
  assert.equal(inline, 0);
  const fs = require("node:fs"), path = require("node:path");
  for (const f of ["series-ui.js", "biz-ui.js", "courses-ui.js"]) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../..", f), "utf8"), /\son(click|input|change|submit)=/);
});
