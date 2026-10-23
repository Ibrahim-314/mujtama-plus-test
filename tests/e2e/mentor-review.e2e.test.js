/* مسار الإرشاد M5-2 «مراجَع من الفريق» — staff toggle in #/admin/mentors → badge on #/mentor/:handle and the directory card.
 * The first account is admin (staff). A second mentor accepts minors and is unreviewed: its dashboard shows the review notice,
 * the admin list shows a warning row + flag and the «تحتاج مراجعة» filter; nothing is blocked. Toggle on → badge appears;
 * reviewed / unreviewed filters. 390 light AR, 1440 dark EN (LTR): axe 0 serious/critical, no horizontal overflow.
 * Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, c, p, mck; const errors = [];
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, hash, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, hash); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(300); };

test.before(async () => {
  S = await startStack();
  c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "mrv_admin", "نورة الشهري"); // first account → admin
  S.app.ctx.rl?.w?.clear?.();
  const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { ...H, Origin: S.base }, body: JSON.stringify({ name: "خالد العتيبي", handle: "mrv_mentor", password: "secret1234" }) });
  assert.equal(r.status, 200); mck = r.headers.getSetCookie().map((x) => x.split(";")[0]).join("; "); await tourDone(S.base, mck);
  const put = await fetch(S.base + "/api/mentor/me", { method: "PUT", headers: { ...H, Origin: S.base, Cookie: mck }, body: JSON.stringify({ headline: "مهندس برمجيات يرشد الطلاب في البرمجة", topics: ["programming"], allowMinors: true, price: 0, tz: "Asia/Riyadh", open: true }) });
  assert.equal(put.status, 200, await put.text());
});
test.after(async () => { await c?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("mentor dashboard: review notice for an unreviewed mentor accepting minors (not blocked)", async () => {
  const c2 = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  await c2.addCookies(mck.split("; ").map((kv) => { const i = kv.indexOf("="); return { name: kv.slice(0, i), value: kv.slice(i + 1), url: S.base }; }));
  const pm = await c2.newPage(); pm.on("pageerror", (e) => errors.push(e.message));
  await pm.goto(S.base + "/?nosw"); await pm.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 });
  await pm.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/mentoring"; route(); }); await pm.waitForSelector("#mt-rev-need", { timeout: 15000 });
  assert.match(await pm.textContent("#mt-rev-need"), /مراجعة فريق المنصة/);
  assert.ok(await pm.$(".f-kpis"), "dashboard still works");
  assert.deepEqual(await axe(pm), [], "axe dashboard 390 light");
  await shot(pm, "390-light-ar-dashboard-notice"); await c2.close();
});

test("390 light AR: admin warning row + filter, toggle → badge on profile and directory card", async () => {
  await go(p, "#/admin/mentors", "#mt-a-list");
  assert.ok(await p.$("#mt-rev-flag"), "flag notice");
  assert.equal((await p.$$(".mt-rev-warn")).length, 1, "warning row for the minors mentor");
  await go(p, "#/admin/mentors?tab=minors", "#mt-a-list"); assert.equal((await p.$$("#mt-a-list > li")).length, 1);
  await go(p, "#/admin/mentors?tab=reviewed", ".seg"); assert.equal(await p.$("#mt-a-list"), null, "no reviewed mentors yet");
  await go(p, "#/admin/mentors", "#mt-a-list");
  assert.deepEqual(await axe(p), [], "axe admin 390 light"); assert.ok(await noOverflow(p)); await shot(p, "390-light-ar-admin-before");
  const btn = await p.$('[data-rv="1"]'); assert.equal(await btn.getAttribute("aria-pressed"), "false");
  await btn.click(); await p.waitForSelector('[data-rv="0"][aria-pressed="true"]', { timeout: 10000 });
  assert.equal((await p.$$(".mt-rev-warn")).length, 0, "warning row gone after review");
  await shot(p, "390-light-ar-admin-after");
  await go(p, "#/admin/mentors?tab=reviewed", "#mt-a-list"); assert.equal((await p.$$("#mt-a-list > li")).length, 1);
  await go(p, "#/mentor/mrv_mentor", ".mt-hero"); assert.match(await p.textContent(".mt-hero .mt-rev"), /مراجَع من الفريق/);
  assert.deepEqual(await axe(p), [], "axe profile 390 light"); assert.ok(await noOverflow(p)); await shot(p, "390-light-ar-profile-badge");
  await go(p, "#/mentors?tab=find", ".mt-card"); assert.ok(await p.$('.mt-card[href="#/mentor/mrv_mentor"] .mt-rev'), "badge on directory card");
  await shot(p, "390-light-ar-directory-badge");
});

test("1440 dark EN (LTR): badge + admin translated, axe 0, no overflow; clear removes badge", async () => {
  await p.setViewportSize({ width: 1440, height: 900 }); await p.emulateMedia({ colorScheme: "dark" });
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await go(p, "#/mentor/mrv_mentor", ".mt-hero"); assert.match(await p.textContent(".mt-hero .mt-rev"), /Reviewed by the team/);
  assert.deepEqual(await axe(p), [], "axe profile 1440 dark en"); assert.ok(await noOverflow(p)); await shot(p, "1440-dark-en-profile-badge");
  await go(p, "#/admin/mentors", "#mt-a-list"); assert.match(await p.textContent(".seg"), /Not reviewed/);
  assert.deepEqual(await axe(p), [], "axe admin 1440 dark en"); assert.ok(await noOverflow(p)); await shot(p, "1440-dark-en-admin");
  await (await p.$('[data-rv="0"]')).click(); await p.waitForSelector(".mt-rev-warn", { timeout: 10000 });
  await go(p, "#/mentor/mrv_mentor", ".mt-hero"); assert.equal(await p.$(".mt-hero .mt-rev"), null, "badge cleared");
  await p.evaluate(() => window.MPI18n.setLang("ar"));
});
