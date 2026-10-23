/* Phases 61 + 66 + 71 e2e against the REAL server (production build).
 * P61: attention beacon from a post page → #/studio «تحليلات متقدمة» → #/analytics overview / audience / content / earnings
 *      / compare, CSV link works. P66: #/nearby by city (list + map pins + OSM attribution, tiles stubbed and only requested
 *      when the map is shown), pin selection, device location → 5-char area only, #/places/new → pending → #/admin/places
 *      approve → #/city/جدة. P71: #/study/new halaqa → sessions (add, start in person) → notes → goals → progress →
 *      community page link. axe: no serious/critical WCAG A/AA issues; no page errors; chunks lazy, no inline handlers. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p, me, other; const errors = [], tiles = [];
const until = async (fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
async function axe() {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce", permissions: ["geolocation"], geolocation: { latitude: 21.5433, longitude: 39.1728 } });
  await ctx.route("https://tile.openstreetmap.org/**", (r) => { tiles.push(r.request().url()); return r.fulfill({ status: 200, contentType: "image/png", body: PNG }); });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message + " @ " + String(e.stack || "").split("\n").slice(1, 3).join(" | ")));
  await onboard(p, S.base, "p3_e2e", "مختبر الجولة"); // first account → admin
  const { db } = S.app.ctx;
  me = await db.get("SELECT * FROM users WHERE handle='p3_e2e'");
  const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name: "مبدع آخر", handle: "p3_other", password: "secret123" }) });
  assert.equal(reg.status, 200); other = await db.get("SELECT * FROM users WHERE handle='p3_other'");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("P61: attention beacon from a post page; studio → advanced analytics (all tabs), CSV; axe clean", async () => {
  const sv = S.app.ctx.services;
  const theirs = await sv.content.createPost(other, { type: "article", title: "مقال للاختبار", text: "نص طويل ".repeat(300) });
  const mine = await sv.content.createPost(me, { type: "post", text: "منشوري الأول للتحليلات" });
  await S.app.ctx.db.run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,'feed',$3)", [mine.id, other.id, new Date().toISOString()]);
  await p.goto(S.base + `/?nosw#/post/${theirs.id}`);
  await p.waitForSelector(".wrap", { timeout: 20000 });
  await until(() => !!window.MPAttn, null, 20000);
  await p.waitForTimeout(1600);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = "#/home"; });
  let row; for (let i = 0; i < 40 && !row; i++) { await p.waitForTimeout(150); row = await S.app.ctx.db.get("SELECT * FROM content_attention WHERE post=$1 AND user_id=$2", [theirs.id, me.id]); }
  assert.ok(row, "attention recorded"); assert.ok(Number(row.ms) >= 1000); assert.ok(Number(row.progress) > 0);
  await p.goto(S.base + "/?nosw#/studio");
  await p.waitForSelector('a[href="#/analytics"]', { timeout: 20000 });
  await p.click('a[href="#/analytics"]');
  await until(() => document.querySelectorAll(".ca-k").length >= 8 && !!document.querySelector("svg.ca-chart"));
  assert.match(await p.textContent("#ca-b"), /المشاهدات/);
  assert.deepEqual(await axe(), []);
  await p.click('.ca-tabs a[href^="#/analytics/audience"]');
  await until(() => /نمو الجمهور/.test(document.querySelector("#ca-b")?.textContent || "") && /يظهر هذا التوزيع عندما/.test(document.querySelector("#ca-b").textContent));
  await p.click('.ca-tabs a[href^="#/analytics/content"]');
  await until(() => !!document.querySelector("#ca-b .ca-plist") && /منشوري الأول/.test(document.querySelector("#ca-b").textContent));
  const csv = await p.getAttribute('#ca-b a[download]', "href"); assert.match(csv, /report=content/);
  const r = await p.request.get(S.base + csv); assert.equal(r.status(), 200); assert.match(await r.text(), /منشوري الأول/);
  assert.deepEqual(await axe(), []);
  await p.click('.ca-tabs a[href^="#/analytics/earnings"]');
  await until(() => /مدفوعات Pi غير مفعّلة/.test(document.querySelector("#ca-b")?.textContent || "") && !!document.querySelector("#ca-b .ca-streams"));
  await p.click('.ca-tabs a[href^="#/analytics/compare"]');
  await until(() => !!document.querySelector("#ca-xr table"));
  await p.click('.ca-per a[href$="days=7"]').catch(() => { });
  assert.deepEqual(errors, []);
});

test("P66: nearby by city, map pins + attribution (tiles only when shown), device area is 5 chars, add place → moderate → city page; axe", async () => {
  const sv = S.app.ctx.services;
  const lib = (await sv.nearby.submit(other, { name: "مكتبة الشاطئ", category: "library", descr: "مكتبة عامة", address: "حي الشاطئ", lat: 21.5435, lng: 39.1735 })).place;
  await sv.nearby.review(me, lib.id, { decision: "approve" });
  const tilesBefore = tiles.length;
  await p.goto(S.base + "/?nosw#/nearby");
  await p.waitForSelector("#nb-city", { timeout: 20000 });
  assert.equal(tiles.length, tilesBefore, "no tiles before a map is shown");
  await p.selectOption("#nb-city", "جدة");
  await until(() => /city=/.test(location.hash) && !!document.querySelector(".nb-list li"));
  assert.match(await p.textContent("#nb-res"), /مكتبة الشاطئ/);
  await p.waitForSelector(".nb-pin", { timeout: 10000 });
  const attr = await p.getAttribute(".nb-attr a", "href"); assert.equal(attr, "https://www.openstreetmap.org/copyright");
  assert.match(await p.textContent(".nb-attr"), /OpenStreetMap/);
  await until(() => document.querySelectorAll(".nb-tiles img").length > 0);
  assert.ok(tiles.length > tilesBefore && tiles.length - tilesBefore <= 30, "only the visible tiles: " + (tiles.length - tilesBefore));
  await p.click(".nb-pin");
  await until(() => /التفاصيل/.test(document.querySelector("#nb-sel")?.textContent || ""));
  assert.deepEqual(await axe(), []);
  // keyboard: the map pans with arrows and zooms with +
  await p.focus("#nb-map"); await p.keyboard.press("+"); await p.keyboard.press("ArrowLeft");
  await p.waitForSelector(".nb-here:not([hidden])", { timeout: 5000 });
  // device location → only a 5-character area leaves the device; saved when asked
  await p.goto(S.base + "/?nosw#/nearby");
  await p.waitForSelector("#nb-dev", { timeout: 20000 });
  await p.check("#nb-save"); await p.click("#nb-dev");
  await until(() => /area=[0-9a-z]{5}(&|$)/.test(location.hash));
  const pref = await S.app.ctx.db.get("SELECT * FROM geo_prefs WHERE user_id=$1", [me.id]); assert.equal(pref.geohash.length, 5); assert.equal(pref.city, "جدة");
  // add a place → pending → admin approves → city page lists it
  await p.goto(S.base + "/?nosw#/places/new?city=" + encodeURIComponent("جدة"));
  await p.waitForSelector("#nb-pf", { timeout: 20000 });
  await p.fill('#nb-pf [name="name"]', "مسجد الحي الكبير"); await p.selectOption('#nb-pf [name="category"]', "mosque"); await p.fill('#nb-pf [name="descr"]', "صلاة الجمعة");
  assert.deepEqual(await axe(), []);
  await p.click("#nb-pf .btn.block");
  await until(() => /^#\/place\//.test(location.hash) && /بانتظار المراجعة/.test(document.querySelector("#nb-p")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/admin/places");
  await p.waitForSelector('[data-rv="approve"]', { timeout: 20000 });
  await p.click('[data-rv="approve"]');
  await until(() => !document.querySelector('[data-rv="approve"]'));
  await p.goto(S.base + "/?nosw#/city/" + encodeURIComponent("جدة"));
  await until(() => /مسجد الحي الكبير/.test(document.querySelector("#nb-cy")?.textContent || "") && /الرائج في جدة/.test(document.querySelector("#nb-cy").textContent));
  assert.deepEqual(await axe(), []);
  assert.deepEqual(errors, []);
});

test("P71: create a halaqa → add + start a session in person → notes → goals → progress → community link; axe", async () => {
  await p.goto(S.base + "/?nosw#/study/new");
  await p.waitForSelector("#sd-gf", { timeout: 20000 });
  await p.fill('#sd-gf [name="name"]', "حلقة جزء عمّ للمبتدئين");
  await p.check('#sd-gf [name="mode"][value="halaqa"]'); await p.fill('#sd-gf [name="subject"]', "جزء عمّ");
  for (const d of ["0", "3"]) await p.check(`#sd-gf [name="day"][value="${d}"]`);
  assert.deepEqual(await axe(), []);
  await p.click("#sd-gf .btn.block");
  await until(() => /^#\/study\/m_/.test(location.hash) && document.querySelectorAll(".sd-tabs a").length >= 6);
  const cid = await p.evaluate(() => location.hash.split("/")[2]);
  await until(() => document.querySelectorAll("#sd-b .sd-list li").length >= 2, null, 15000);
  // an extra session in 30 minutes, started in person
  await p.click("#sd-b details summary");
  const at = await p.evaluate(() => { const d = new Date(Date.now() + 30 * 60e3); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); });
  await p.fill('#sd-sf [name="title"]', "جلسة تعارف"); await p.fill('#sd-sf [name="at"]', at); await p.click("#sd-sf .btn");
  await until(() => /جلسة تعارف/.test(document.querySelector("#sd-b")?.textContent || ""));
  const sid = await p.evaluate(() => [...document.querySelectorAll("#sd-b .sd-list li")].find((li) => /جلسة تعارف/.test(li.textContent)).querySelector("[data-start]").dataset.start);
  await p.click(`[data-start="${sid}"]`); await p.click("#sd-st-p");
  await until((x) => location.hash === "#/study/session/" + x && /مباشرة الآن/.test(document.querySelector("#sd-s")?.textContent || ""), sid);
  assert.deepEqual(await axe(), []);
  await p.click("#sd-end").catch(() => { });
  // notes
  await p.goto(S.base + `/?nosw#/study/${cid}/notes`);
  await p.waitForSelector("#sd-nf", { state: "attached", timeout: 20000 });
  await p.click("#sd-b details summary"); await p.fill('#sd-nf [name="title"]', "ملخص سورة النبأ"); await p.fill('#sd-nf [name="body"]', "الوقفات الرئيسة"); await p.click("#sd-nf .btn");
  await until(() => /ملخص سورة النبأ/.test(document.querySelector("#sd-b")?.textContent || ""));
  // goals
  await p.goto(S.base + `/?nosw#/study/${cid}/goals`);
  await p.waitForSelector("#sd-gl", { timeout: 20000 });
  await p.fill('#sd-gl [name="title"]', "حفظ ٣ سور"); await p.fill('#sd-gl [name="target"]', "3"); await p.click("#sd-gl .btn");
  await until(() => /حفظ ٣ سور/.test(document.querySelector("#sd-b")?.textContent || ""));
  await p.click("[data-gp][data-add='1']");
  await until(() => !!document.querySelector('[role="progressbar"][aria-valuenow="33"]'));
  assert.deepEqual(await axe(), []);
  // halaqa progress (as the teacher: the roster is empty, own record shown)
  await p.goto(S.base + `/?nosw#/study/${cid}/progress`);
  await until(() => /من القرآن/.test(document.querySelector("#sd-b")?.textContent || ""));
  // the community page links to the study tools
  await p.goto(S.base + `/?nosw#/c/${cid}`);
  await p.waitForSelector(`a[href="#/study/${cid}"]`, { timeout: 20000 });
  assert.deepEqual(errors, []);
});

test("build: new chunks lazy, no inline handlers / javascript: URLs; core within budget", () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file)); assert.ok(core.br <= 92160, "core " + core.br);
  const html = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8");
  for (const n of ["attn", "canalytics", "nearby", "study"]) {
    const ch = b.files.find((x) => new RegExp(`chunk-${n}-.*\\.js$`).test(x.file)); assert.ok(ch, n + " chunk built");
    const src = fs.readFileSync(path.join(ROOT, "dist", ch.file), "utf8"); assert.ok(!/\son[a-z]+=["']/.test(src) && !/javascript:/.test(src), n);
    assert.ok(!html.includes(n + "-ui"), n + " not in the shell");
  }
  const coreSrc = fs.readFileSync(path.join(ROOT, "dist", core.file), "utf8"); assert.ok(coreSrc.includes(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version), "app shell carries the version");
});
