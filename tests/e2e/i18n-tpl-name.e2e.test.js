/* v2.145.4: a templated English string whose {name} is itself a UI page title was half-Arabic — «صفحة تقارير الشفافية»
 * rendered as «تقارير الشفافية page» on the 1440 home in English. {name} is now translated when it is an exact catalogue
 * string; a user-supplied name (a person, a community) is still kept as written.
 * v2.145.6: a single-word name that happens to be a catalogue word («سارة» → Sarah, «ذهبي» → Gold) was translated too
 * (a notification read «Sarah opened new mentoring times»); only multi-word page titles are translated now. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, DESKTOP } = require("./harness");
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });

test("en: {name} page titles are translated, user names kept; 1440 home has no half-Arabic page label", async () => {
  const ctx = await S.browser.newContext({ ...DESKTOP, reducedMotion: "reduce" }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "tpl_name", "سارة");
  await p.evaluate(() => window.MPChunks?.load("i18n").then(() => window.MPI18n.setLang("en")));
  await p.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 15000 });
  const r = await p.evaluate(() => ({ title: window.MPI18n.lookup("صفحة تقارير الشفافية", "en"), user: window.MPI18n.lookup("صفحة أبو فهد الغامدي", "en"), one: window.MPI18n.lookup("فتح سارة مواعيد إرشاد جديدة", "en"), word: window.MPI18n.lookup("صفحة ذهبي", "en") }));
  assert.equal(r.title, "Transparency Reports page");
  assert.equal(r.user, "أبو فهد الغامدي page", "a person's name is not translated");
  assert.equal(r.one, "سارة opened new mentoring times", "a one-word name that is also a catalogue word stays as written");
  assert.equal(r.word, "ذهبي page", "a one-word name that is also a catalogue word stays as written");
  await p.evaluate(() => { location.hash = "#/home"; });
  await p.waitForFunction(() => document.querySelector("#view")?.textContent.trim().length > 0 && !document.querySelector("#view .skel"), null, { timeout: 15000 });
  await p.waitForTimeout(1200);
  const txt = await p.evaluate(() => document.body.innerText);
  assert.ok(!/تقارير الشفافية/.test(txt), "no Arabic page title left on the English home");
  assert.deepEqual(errs, []);
  await ctx.close();
});
