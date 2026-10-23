/* M3-4 «مطوّر الأجندة» — session agenda on #/msession/:id.
 * Learner (390 light, Arabic RTL): empty state → adds two points → removes one → adds again; the 140-char cap holds in the
 * field; axe 0 serious/critical; no overflow. Mentor (1440 dark, English LTR): sees the points, cannot add, ticks one after
 * confirming; the tick persists across reload and the learner sees it; axe 0 serious/critical; agenda UI translated.
 * Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, cm, cl, pm, pl, sid; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const open = async (pg, sel) => {
  await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120);
  await pg.evaluate((x) => { location.hash = x; }, "#/msession/" + sid);
  await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(250);
};
const items = (pg) => pg.$$eval("#mt-ag .mt-ag-list .t", (a) => a.map((e) => e.textContent));

test.before(async () => {
  S = await startStack();
  cm = await S.browser.newContext({ ...DESKTOP, timezoneId: "Asia/Riyadh", reducedMotion: "reduce", colorScheme: "dark" });
  cl = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  pm = await cm.newPage(); pl = await cl.newPage();
  for (const pg of [pm, pl]) pg.on("pageerror", (e) => errors.push(e.message));
  await onboard(pm, S.base, "ag_mentor", "Mentor Agenda");
  assert.ok((await call(pm, "PUT", "/api/mentor/me", { headline: "مرشد خبير في البرمجة والمسار المهني", topics: ["programming"], minutes: 60, price: 0, tz: "Asia/Riyadh", open: true })).status < 300);
  assert.ok((await call(pm, "PUT", "/api/mentor/me/slots", { slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, start: "00:00", end: "23:45" })) })).status < 300);
  await onboard(pl, S.base, "ag_learner", "متعلّم الأجندة");
  const sl = await call(pl, "GET", "/api/mentors/ag_mentor/slots"); assert.ok(sl.body.slots.length, "slots");
  const b = await call(pl, "POST", "/api/mentors/ag_mentor/book", { startsAt: sl.body.slots[0], topic: "programming" }); assert.equal(b.status, 200, JSON.stringify(b.body)); sid = b.body.session.id;
});
test.after(async () => { await cm?.close(); await cl?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("learner 390 light AR: empty state, add / remove / add, cap 140, axe 0", async () => {
  await open(pl, "#mt-ag .empty");
  assert.match(await pl.textContent("#mt-ag-h"), /أجندة الجلسة/);
  assert.equal(await pl.getAttribute("#mt-ag-in", "maxlength"), "140");
  assert.deepEqual(await axe(pl), [], "axe empty");
  await shot(pl, "390-light-ar-agenda-empty");
  await pl.fill("#mt-ag-in", "مراجعة سيرتي الذاتية قبل التقديم على وظيفة مطوّر واجهات");
  await pl.click("#mt-ag-f button[type=submit]"); await pl.waitForSelector("#mt-ag .mt-ag-list li");
  assert.equal(await pl.evaluate(() => document.activeElement?.id), "mt-ag-in", "focus back in the field");
  await pl.fill("#mt-ag-in", "نقطة للحذف"); await pl.keyboard.press("Enter");
  await pl.waitForFunction(() => document.querySelectorAll("#mt-ag .mt-ag-list li").length === 2);
  await pl.click("#mt-ag [data-ag-del='1']"); await pl.waitForFunction(() => document.querySelectorAll("#mt-ag .mt-ag-list li").length === 1);
  await pl.fill("#mt-ag-in", "خطة تعلّم TypeScript في ثلاثة أشهر"); await pl.keyboard.press("Enter");
  await pl.waitForFunction(() => document.querySelectorAll("#mt-ag .mt-ag-list li").length === 2);
  assert.deepEqual(await items(pl), ["مراجعة سيرتي الذاتية قبل التقديم على وظيفة مطوّر واجهات", "خطة تعلّم TypeScript في ثلاثة أشهر"]);
  assert.equal(await pl.getAttribute("#mt-ag .mt-ag-list .t", "dir"), "auto");
  assert.ok(await pl.$("#mt-ag [data-ag-del]"), "learner can remove before start");
  assert.equal(await pl.$("#mt-ag [data-ag-tick]"), null, "learner cannot tick");
  const minH = await pl.$$eval("#mt-ag [data-ag-del], #mt-ag-f button", (a) => Math.min(...a.map((e) => e.getBoundingClientRect().height)));
  assert.ok(minH >= 44, "targets ≥ 44px");
  assert.ok(await noOverflow(pl), "no overflow at 390");
  assert.deepEqual(await axe(pl), [], "axe with items");
  await shot(pl, "390-light-ar-agenda-learner");
});

test("mentor 1440 dark EN LTR: read-only before confirm, ticks after confirm, persists, learner sees it, axe 0", async () => {
  await pm.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await pm.evaluate(() => window.MPI18n.setLang("en")); await pm.waitForFunction(() => document.documentElement.dir === "ltr");
  await pm.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await open(pm, "#mt-ag .mt-ag-list");
  assert.equal(await pm.$("#mt-ag-f"), null, "mentor cannot add");
  assert.equal(await pm.$("#mt-ag [data-ag-tick]"), null, "no ticks while pending");
  assert.ok((await call(pm, "POST", `/api/mentor-sessions/${sid}/confirm`)).status < 300);
  await open(pm, "#mt-ag [data-ag-tick]");
  assert.match(await pm.textContent("#mt-ag-h"), /Session agenda/);
  await pm.check("#mt-ag [data-ag-tick='0']");
  await pm.waitForSelector("#mt-ag .mt-ag-i.done");
  assert.match(await pm.textContent("#mt-ag .mt-ag-meta"), /1 of 2/);
  await open(pm, "#mt-ag [data-ag-tick]");
  assert.equal(await pm.isChecked("#mt-ag [data-ag-tick='0']"), true, "tick persisted");
  assert.equal(await pm.isChecked("#mt-ag [data-ag-tick='1']"), false);
  assert.ok(await noOverflow(pm));
  assert.deepEqual(await axe(pm), [], "axe dark en");
  await shot(pm, "1440-dark-en-agenda-mentor");
  await open(pl, "#mt-ag .mt-ag-i.done");
  assert.equal((await pl.$$("#mt-ag .mt-ag-i.done")).length, 1, "learner sees the tick");
  await shot(pl, "390-light-ar-agenda-ticked");
});
