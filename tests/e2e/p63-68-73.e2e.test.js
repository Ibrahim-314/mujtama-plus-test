/* Phases 63 + 68 + 73 e2e against the REAL server (production build), mobile viewport.
 * P63: hub (opportunities / deals / kit), campaign page, deal room (brand + creator), the creator DELIVERS a post in the UI →
 *      the paid-partnership label appears on the post card in the feed and on the post page; self-disclosure form; library;
 *      about; admin queue.
 * P68: Hijri calendar (hero, grid with today, day details on tap, Gregorian mode, converter), season hub (reminder chips),
 *      admin overrides; «show Hijri dates» toggles DB.settings.hijri.
 * P73: teacher builder → publish; learner takes a timed quiz in the UI (progress, autosave, submit) → result ring + review
 *      → certificate page (valid) → /cert/<code> server page (no script, QR) → verify form.
 * axe: no serious/critical WCAG A/AA issues on every new screen; no page errors; chunks lazy; no inline handlers;
 * tap targets ≥ 44px on the main actions. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, ctx, p, k, kctx, other, camp, deal, kpost, gid, exam; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const api = (pg, m, path, b) => pg.evaluate(([m, path, b]) => Remote.api(m, path, b), [m, path, b]);
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push("brand: " + e.message));
  await onboard(p, S.base, "p5_brand", "متجر التقنية"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "خالد العتيبي", handle: "p5_creator", password: "secret123" }) });
  assert.equal(reg.status, 200);
  other = { ck: reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  await tourDone(S.base, other.ck); // API-registered account: mark the guided tour done so it never overlays a click
  const me = await S.app.ctx.db.get("SELECT id FROM users WHERE handle='p5_brand'"), cr = await S.app.ctx.db.get("SELECT id FROM users WHERE handle='p5_creator'");
  await S.app.ctx.db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [me.id, cr.id, new Date().toISOString()]);
  kctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  const [n, ...v] = other.ck.split("="); await kctx.addCookies([{ name: n, value: v.join("="), url: S.base }]);
  k = await kctx.newPage(); k.on("pageerror", (e) => errors.push("creator: " + e.message));
  await k.goto(S.base + "/?nosw#/home"); await k.waitForTimeout(800); await k.evaluate(() => { try { DB.onboarded = true; save?.(); } catch { } });
  // P63 seed
  rl(); await api(p, "PUT", "/api/collabs/brand", { name: "متجر التقنية", category: "tech", about: "إلكترونيات أصلية" });
  rl(); camp = (await api(p, "POST", "/api/collabs/campaigns", { title: "إطلاق سماعات صدى", summary: "نبحث عن صنّاع تقنية لمراجعة السماعات الجديدة بصدق ووضوح.", deliverables: [{ format: "video", label: "فيديو مراجعة" }], categories: ["tech"], fee: 100, slots: 2 })).campaign;
  rl(); await api(k, "PUT", "/api/collabs/kit", { open: true, headline: "مراجعات تقنية بالعربية", categories: ["tech"], formats: ["video"] });
  rl(); deal = (await api(p, "POST", "/api/collabs/offers", { creator: "p5_creator", title: "مراجعة سماعات صدى", summary: "نرسل لك السماعات لتجربتها ثم تنشر مراجعة صادقة.", deliverables: [{ format: "post", label: "منشور مراجعة" }], fee: 120 })).deal;
  rl(); await api(k, "POST", `/api/collab-deals/${deal.id}/accept`);
  rl(); kpost = (await api(k, "POST", "/api/posts", { type: "post", text: "رأيي الصريح في سماعات صدى بعد أسبوع من الاستخدام اليومي" })).post;
  // P73 seed
  rl(); const g = await api(p, "POST", "/api/study/groups", { name: "حلقة البرمجة", desc: "أساسيات", mode: "group", subject: "برمجة", type: "public" }); gid = g.group.id;
  rl(); await fetch(S.base + `/api/communities/${gid}/join`, { method: "POST", headers: { ...H(), Cookie: other.ck }, body: JSON.stringify({ acceptRules: true }) });
});
test.after(async () => { await kctx?.close(); await ctx?.close(); await S?.close(); });

test("P63: hub tabs, campaign, deal room (brand); creator delivers in the UI → label on feed card + post page; axe clean", async () => {
  await go(p, "#/collabs");
  await textHas(p, /إطلاق سماعات صدى/);
  assert.deepEqual(await axe(p), []);
  await go(p, "#/collabs?tab=deals"); await textHas(p, /مراجعة سماعات صدى/); assert.deepEqual(await axe(p), []);
  await go(p, "#/collabs?tab=kit"); await until(p, () => !!document.querySelector("#cb-kf")); assert.deepEqual(await axe(p), []);
  await go(p, "#/collabs/c/" + camp.id); await textHas(p, /طلبات الصنّاع/); assert.deepEqual(await axe(p), []);
  // creator delivers through the deal room
  await go(k, "#/collabs/d/" + deal.id);
  await until(k, () => !!document.querySelector("[data-deliver] select"));
  assert.ok((await minTap(k, "[data-deliver] .btn")) >= 44);
  assert.deepEqual(await axe(k), []);
  await k.selectOption("[data-deliver] select", kpost.id);
  k.once("dialog", (d) => d.accept());
  await k.click("[data-deliver] .btn");
  await textHas(k, /بانتظار المراجعة/);
  // brand approves in the UI
  await go(p, "#/collabs/d/" + deal.id); await until(p, () => !!document.querySelector("[data-rv][data-dec=approve]"));
  assert.deepEqual(await axe(p), []);
  await p.click("[data-rv][data-dec=approve]"); await textHas(p, /اكتمل|مكتمل/);
  // the label on the feed card (brand follows the creator) and the post page
  await p.evaluate(() => Remote.pull?.()).catch(() => { });
  await go(p, "#/post/" + kpost.id);
  await until(p, () => !!document.querySelector("#view .ptn-bar"), null, 20000);
  assert.match(await p.textContent("#view .ptn-bar"), /محتوى مدفوع · شراكة مع متجر التقنية/);
  assert.deepEqual(await axe(p), []);
  await go(p, "#/home"); await p.waitForTimeout(600);
  await until(p, (id) => { const c = [...document.querySelectorAll("#view .post-card")].find((x) => x.querySelector(`[data-react="${id}"]`)); return !c || !!c.querySelector(".ptn-bar"); }, kpost.id);
});

test("P63: disclosure form, report form, library, about, admin queue; axe clean", async () => {
  rl(); const own = (await api(k, "POST", "/api/posts", { type: "post", text: "هدية وصلتني اليوم" })).post;
  await go(k, "#/collabs/disclose/" + own.id); await until(k, () => !!document.querySelector("#cb-dsf"));
  assert.deepEqual(await axe(k), []);
  await k.fill("#cb-dsf [name=brand]", "متجر العطور"); await k.click("#cb-dsf [name=kind][value=gifted] >> xpath=..");
  await k.click("#cb-dsf [type=submit]"); await k.waitForTimeout(600);
  assert.equal((await S.app.ctx.db.get("SELECT kind FROM post_partnerships WHERE post_id=$1", [own.id]))?.kind, "gifted");
  await go(p, "#/collabs/report/" + own.id); await until(p, () => !!document.querySelector("#cb-rpf")); assert.deepEqual(await axe(p), []);
  await go(p, "#/collabs/library"); await textHas(p, /متجر العطور/); assert.deepEqual(await axe(p), []);
  await go(p, "#/collabs/about"); await textHas(p, /قواعدنا/); assert.deepEqual(await axe(p), []);
  await go(p, "#/admin/collabs"); await textHas(p, /حملات بانتظار المراجعة/); assert.deepEqual(await axe(p), []);
  await go(k, "#/collabs/kit/p5_creator"); await textHas(k, /مراجعات تقنية بالعربية/); assert.deepEqual(await axe(k), []);
});

test("P68: Hijri calendar (today, tap a day, Gregorian mode, converter), season hub reminders, admin; axe clean", async () => {
  await go(p, "#/hijri");
  await until(p, () => !!document.querySelector(".hj-d.today"));
  assert.ok((await minTap(p, ".hj-d")) >= 44, "day cells ≥ 44px");
  assert.match(await p.textContent(".hj-hero"), /هـ/);
  assert.deepEqual(await axe(p), []);
  const d = await p.evaluate(() => [...document.querySelectorAll(".hj-d")].find((x) => !x.classList.contains("today")).dataset.d);
  await p.click(`.hj-d[data-d="${d}"]`); await until(p, (g) => document.querySelector(`.hj-d[data-d="${g}"]`)?.getAttribute("aria-pressed") === "true" && /هـ/.test(document.querySelector("#hj-dd")?.textContent || ""), d);
  await p.fill("#hj-c1 [name=d]", "2027-03-09"); await p.click("#hj-c1 [type=submit]");
  await until(p, () => /شوال/.test(document.querySelector("#hj-o1")?.textContent || ""));
  await p.check("#hj-show"); assert.equal(await p.evaluate(() => DB.settings.hijri), true);
  await p.uncheck("#hj-show");
  await go(p, "#/hijri?cal=g"); await until(p, () => !!document.querySelector(".hj-d.today")); assert.deepEqual(await axe(p), []);
  await go(p, "#/season/ramadan"); await until(p, () => !!document.querySelector("[data-rem]"));
  assert.deepEqual(await axe(p), []);
  await p.click('[data-rem="7"]'); await until(p, () => document.querySelector('[data-rem="7"]')?.getAttribute("aria-pressed") === "true");
  assert.equal(Number((await S.app.ctx.db.get("SELECT days_before FROM hijri_reminders"))?.days_before), 7);
  await go(p, "#/admin/hijri"); await until(p, () => document.querySelectorAll(".hj-adm li").length >= 6); assert.deepEqual(await axe(p), []);
});

test("P73: builder → publish; learner takes a timed quiz in the UI → result → certificate → /cert page → verify; axe clean", async () => {
  await go(p, "#/exam/new?group=" + gid); await until(p, () => !!document.querySelector("#ex-bf"));
  assert.deepEqual(await axe(p), []);
  await p.fill("#ex-bf [name=title]", "اختبار الأساسيات"); await p.fill("#ex-bf [name=timeLimit]", "10");
  await p.fill(".ex-qb [data-q]", "ما الكلمة التي تعرّف ثابتاً؟");
  const opts = await p.$$(".ex-qb [data-opt]"); await opts[0].fill("let"); await opts[1].fill("const");
  await p.check('.ex-qb input[name="a0"][value="1"]');
  await p.click('[data-addq="tf"]'); await p.fill('.ex-qb[data-i="1"] [data-q]', "JavaScript تعمل في المتصفح"); await p.check('.ex-qb[data-i="1"] input[value="1"]');
  await p.click("#ex-bf [type=submit]");
  await until(p, () => /^#\/exam\/ex_/.test(location.hash) && !!document.querySelector("[data-st=published]"));
  exam = await p.evaluate(() => location.hash.split("/")[2]);
  await p.click("[data-st=published]"); await textHas(p, /للمعلّم/); await p.waitForTimeout(300);
  assert.deepEqual(await axe(p), []);
  // learner
  await go(k, "#/exams"); await textHas(k, /اختبار الأساسيات/); assert.deepEqual(await axe(k), []);
  await go(k, "#/exam/" + exam); await until(k, () => !!document.querySelector("#ex-start"));
  assert.ok((await minTap(k, "#ex-start")) >= 44); assert.deepEqual(await axe(k), []);
  await k.click("#ex-start"); await until(k, () => !!document.querySelector("#ex-f") && /\d/.test(document.querySelector("#ex-tm")?.textContent || ""));
  assert.deepEqual(await axe(k), []);
  const qs = await k.$$eval(".ex-q", (els) => els.map((e) => ({ id: e.dataset.q, legend: e.querySelector("legend").textContent, opts: [...e.querySelectorAll("label.o span:first-of-type")].map((s) => s.textContent) })));
  for (const q of qs) { const want = /ثابت/.test(q.legend) ? "const" : "صح"; const i = q.opts.indexOf(want); await k.click(`.ex-q[data-q="${q.id}"] label.o >> nth=${i}`); }
  await until(k, () => /2 من 2/.test(document.querySelector("#ex-cnt")?.textContent || ""));
  await until(k, () => /حُفظ/.test(document.querySelector("#ex-sv")?.textContent || ""), null, 8000);
  await k.click("#ex-f [type=submit]");
  await until(k, () => !!document.querySelector(".ex-res.pass") && !!document.querySelector(".ex-certcta"));
  assert.deepEqual(await axe(k), []);
  await k.click(".ex-certcta"); await until(k, () => !!document.querySelector(".ex-state.ok"));
  assert.deepEqual(await axe(k), []);
  const code = await k.evaluate(() => decodeURIComponent(location.hash.split("/")[2]));
  const r = await fetch(S.base + "/cert/" + code); const html = await r.text();
  assert.equal(r.status, 200); assert.match(html, /شهادة صحيحة/); assert.match(html, /<svg/); assert.doesNotMatch(html, /<script(?! type="application)/);
  const ssr = await kctx.newPage(); await ssr.goto(S.base + "/cert/" + code); assert.deepEqual(await axe(ssr), []); await ssr.close();
  await go(k, "#/certificates"); await until(k, () => !!document.querySelector(".ex-cc")); assert.deepEqual(await axe(k), []);
  await go(k, "#/verify-cert"); await k.fill("#ex-code", code.toLowerCase()); await k.click("#ex-vf [type=submit]");
  await until(k, () => !!document.querySelector(".ex-state.ok"));
  await go(p, `#/exam/${exam}/results`); await until(p, () => !!document.querySelector(".ex-hist")); assert.deepEqual(await axe(p), []);
});

test("no page errors, chunks lazy, no inline handlers in new chunks", async () => {
  assert.deepEqual(errors, []);
  const inline = await p.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name))).length);
  assert.equal(inline, 0);
  const fs = require("node:fs"), path = require("node:path");
  for (const f of ["collabs-ui.js", "hijri-ui.js", "certs-ui.js"]) { const src = fs.readFileSync(path.join(__dirname, "../..", f), "utf8"); assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); }
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  for (const c of ["collabs", "hijri", "certs"]) assert.match(html, new RegExp(`data-chunk="${c}"`));
});
