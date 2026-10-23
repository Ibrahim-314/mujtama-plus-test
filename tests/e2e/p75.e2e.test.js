/* Phase 75 e2e (open knowledge library) against the REAL server (production build), mobile viewport.
 * Author (member): writes an article in #/knowledge/new (licence + agreement, preview) → waits for review.
 * Staff (first account → admin): adds a reviewer in #/admin/knowledge; the admin approves the article from the review queue
 *   (#/knowledge/review → version page); the author proposes an edit; the reviewer sees the diff and approves it; history lists
 *   both versions; search finds the article; helpful vote; a member reports it.
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy chunk; no inline
 * handlers / styles / javascript: URLs; tap targets ≥ 44 px. Screenshots (390 light, 360 dark) → tests/visual/output/p75-*. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u, aid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output"); // SHOTS_DIR: private output dir for parallel runs
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `p75-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const BODY = "## ما هي الطاقة الشمسية؟\nالطاقة الشمسية هي الطاقة المستمدة من أشعة الشمس، وتُحوَّل إلى كهرباء بالألواح الكهروضوئية أو إلى حرارة بالمجمّعات الشمسية.\n\n## الاستخدامات\n- توليد الكهرباء في المنازل والمزارع\n- تسخين المياه\n- تحلية مياه البحر\n\n## في منطقتنا\nتتميز المنطقة بإشعاع شمسي مرتفع طوال العام، ما يجعلها من أنسب المواقع لهذه التقنية، مع **تحديات** مثل الغبار والحرارة.";

test.before(async () => {
  S = await startStack();
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message));
  p.on("dialog", (d) => d.accept("سبب الاختبار"));
  await onboard(p, S.base, "p75_admin", "نورة الإدارية"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "عمر الكاتب", handle: "p75_omar", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("author: " + e.message));
  u.on("dialog", (d) => d.accept());
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("write → review → published; edit → diff → approve; history", async () => {
  assert.equal(await u.evaluate(() => !!window.MPKnowledge), false, "lazy chunk not in core");
  await go(u, "#/knowledge"); await textHas(u, /المكتبة فارغة بعد/);
  assert.deepEqual(await axe(u), []);
  await go(u, "#/knowledge/new"); await until(u, () => !!document.querySelector("#kb-f"));
  await u.fill("#kb-f [name=title]", "الطاقة الشمسية: مدخل مبسّط"); await u.fill("#kb-f [name=summary]", "تعريف مختصر بالطاقة الشمسية واستخداماتها.");
  await u.selectOption("#kb-f [name=category]", "science"); await u.fill("#kb-f [name=tags]", "طاقة، بيئة");
  await u.fill("#kb-f [name=body]", BODY); await u.fill("#kb-f [name=sources]", "https://example.org/solar");
  await tap(u, '[data-tab="p"]'); await until(u, () => !document.querySelector("#kb-p").hidden && /الاستخدامات/.test(document.querySelector("#kb-p").textContent));
  assert.deepEqual(await axe(u), []); await shot(u, "editor-360-light");
  await tap(u, '[data-tab="w"]');
  await u.check("#kb-f [name=agree]"); await tap(u, "#kb-f [type=submit]");
  await until(u, () => /#\/kb\/kb/.test(location.hash)); await textHas(u, /بانتظار المراجعة/);
  aid = decodeURIComponent((await u.evaluate(() => location.hash)).split("/")[2]);
  // staff adds the admin's queue; approve from the version page
  await go(p, "#/admin/knowledge"); await until(p, () => !!document.querySelector("#kb-addr"));
  assert.deepEqual(await axe(p), []);
  await p.fill("#kb-addr [name=handle]", "p75_admin"); await tap(p, "#kb-addr [type=submit]"); await textHas(p, /p75_admin/);
  await go(p, "#/knowledge/review"); await until(p, () => !!document.querySelector('.list a[href^="#/kb/rev/"]'));
  assert.deepEqual(await axe(p), []);
  await tap(p, '.list a[href^="#/kb/rev/"]'); await until(p, () => !!document.querySelector("#kb-ok"));
  assert.deepEqual(await axe(p), []);
  await tap(p, "#kb-ok"); await textHas(p, /النسخة 1/);
  await go(u, "#/knowledge"); await go(u, "#/kb/" + aid); await until(u, () => !!document.querySelector(".kb-body h3") && !!document.querySelector(".kb-vote")); await textHas(u, /CC BY-SA 4.0/);
  assert.equal(await u.locator(".kb-toc li").count(), 3);
  assert.deepEqual(await axe(u), []);
  // author proposes an edit
  await tap(u, `a[href="#/kb/${aid}/edit"]`); await until(u, () => !!document.querySelector("#kb-f [name=note]"));
  await u.fill("#kb-f [name=body]", BODY + "\n\n## الصيانة\nتحتاج الألواح إلى تنظيف دوري من الغبار للحفاظ على كفاءتها.");
  await u.fill("#kb-f [name=note]", "إضافة قسم الصيانة"); await u.check("#kb-f [name=agree]"); await tap(u, "#kb-f [type=submit]");
  await until(u, () => /#\/kb\/rev\//.test(location.hash)); await textHas(u, /بانتظار المراجعة/); await until(u, () => !!document.querySelector(".kb-l.add"));
  const rid = decodeURIComponent((await u.evaluate(() => location.hash)).split("/")[3]);
  assert.deepEqual(await axe(u), []); await shot(u, "diff-360-light");
  await go(p, "#/kb/rev/" + rid); await until(p, () => !!document.querySelector("#kb-ok")); await textHas(p, /الصيانة/);
  await shot(p, "review-390-light");
  await tap(p, "#kb-ok"); await textHas(p, /النسخة 2/);
  await go(u, `#/kb/${aid}/history`); await until(u, () => document.querySelectorAll(".kb-hist li").length === 2);
  assert.deepEqual(await axe(u), []);
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM notifications WHERE kind='kb_decision'"));
});

test("search, vote, report; reader screens; dark theme axe; CSP hygiene", async () => {
  rl();
  await go(p, "#/knowledge?q=" + encodeURIComponent("الطاقه")); await until(p, () => !!document.querySelector(".kb-card")); await textHas(p, /الطاقة الشمسية/);
  assert.deepEqual(await axe(p), []); await shot(p, "hub-390-light");
  await go(p, "#/kb/" + aid); await until(p, () => !!document.querySelector('[data-v="1"]'));
  assert.ok((await minTap(p, ".kb-vote .btn, .kb-acts .btn")) >= 44, "44px targets");
  await tap(p, '[data-v="1"]'); await until(p, () => document.querySelector('[data-v="1"]')?.getAttribute("aria-pressed") === "true");
  await p.click("#kb-rp >> xpath=.. >> summary"); await p.selectOption("#kb-rp [name=reason]", "inaccurate"); await tap(p, "#kb-rp [type=submit]");
  await until(p, () => !document.querySelector("#kb-rp")?.closest("details")?.open);
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM kb_reports WHERE article_id=$1", [aid]));
  await shot(p, "article-390-light");
  for (const [hash, name] of [["#/knowledge", "hub"], ["#/kb/" + aid, "article"], [`#/kb/${aid}/history`, "history"], ["#/knowledge/mine", "mine"], ["#/knowledge/new", "editor"]]) {
    await u.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await go(u, hash); await u.waitForTimeout(500); assert.deepEqual(await axe(u), [], hash + " dark"); await shot(u, `${name}-360-dark`);
  }
  for (const hash of ["#/knowledge/review", "#/admin/knowledge"]) {
    await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await go(p, hash); await p.waitForTimeout(500); assert.deepEqual(await axe(p), [], hash + " dark");
  }
  assert.deepEqual(errors, []);
  const inline = await u.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name))).length);
  assert.equal(inline, 0);
  const src = fs.readFileSync(path.join(__dirname, "../..", "knowledge-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /data-chunk="knowledge"/);
});
