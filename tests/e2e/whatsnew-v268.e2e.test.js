/* v2.68: after a version change the app shows «تم التحديث إلى الإصدار ٢٫٦٨٫٠» with the short what's-new list; #/app shows the version as a number. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, ctx, p; const errors = [];
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "wn_e2e", "مختبر الجديد");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("what's-new card after an update + numeric version in #/app", async () => {
  const notes = await (await fetch(S.base + "/whatsnew.json")).json();
  assert.ok(Array.isArray(notes) && notes[0].ar.items.length && notes[0].en.items.length);
  // v2.143: a "quiet" release shows no card — check that first, then serve the same notes un-quieted for the card checks
  let quiet = true;
  await ctx.route("**/whatsnew.json*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(notes.map((n, i) => (i === 0 ? { ...n, quiet } : n))) }));
  await p.goto(S.base + "/#/home");
  await p.waitForFunction(() => !!window.MPPwa, null, { timeout: 30000 });
  await p.evaluate(() => localStorage.setItem("mp-last-ver", "2.67.0"));
  await p.reload(); await p.waitForTimeout(3500);
  assert.equal(await p.$("#mp-updated"), null, "quiet release: no «تم التحديث» card");
  quiet = false;
  await p.goto(S.base + "/#/home");
  await p.waitForFunction(() => !!window.MPPwa, null, { timeout: 30000 });
  await p.evaluate(() => localStorage.setItem("mp-last-ver", "2.67.0"));
  await p.reload();
  await p.waitForSelector("#mp-updated", { timeout: 30000 });
  const txt = await p.textContent("#mp-updated");
  assert.match(txt, /تم التحديث إلى الإصدار/);
  assert.match(txt, /[٠-٩]+٫[٠-٩]+/, "version in Arabic digits: " + txt);
  assert.ok(!/[a-f0-9]{8,}/i.test(txt.replace(/\s/g, "")), "no cache hash shown");
  await p.screenshot({ path: "/workspace/work/team/v268-whatsnew-ar.png" });
  await p.click('#mp-updated [data-a="x"]');
  assert.equal(await p.$("#mp-updated"), null);
  await p.reload(); await p.waitForTimeout(3500);
  assert.equal(await p.$("#mp-updated"), null, "shown once only");
  await p.goto(S.base + "/#/app");
  await p.waitForSelector(".mp-app-row");
  const rows = await p.$$eval(".mp-app-row", (rs) => rs.map((r) => r.textContent));
  const v = rows.find((r) => r.includes("الإصدار"));
  assert.match(v, /[٠-٩]+٫[٠-٩]+/, "version row numeric: " + v);
  assert.deepEqual(errors, []);
});
