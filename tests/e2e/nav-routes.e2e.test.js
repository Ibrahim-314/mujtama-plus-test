/* global MPMenu, MPNav */
/* v2.52: every entry of the «المزيد» hub opens a real screen (admin account, 390 px RTL): no «الصفحة غير موجودة», no page
 * error, a title the top bar can show, and a back button that leads somewhere inside the app (its parent). Split in two
 * halves so each test stays short. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p, items = [];
const errors = [];
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 404, body: "" }));
  p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(location + " " + e.message));
  await onboard(p, S.base, "navr_admin", "مدير المسارات");
  await p.evaluate(() => { location.hash = "#/menu"; }); await p.waitForSelector("#mn-q", { timeout: 15000 });
  items = await p.evaluate(() => MPMenu.items().map((x) => x.h));
});
test.after(async () => { await ctx?.close(); await S?.close(); });

async function visit(list) {
  const bad = [];
  for (const h of list) {
    let cur = h; p.removeAllListeners("pageerror"); p.on("pageerror", (e) => errors.push(cur + " " + e.message));
    await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h);
    await p.waitForFunction(() => !document.querySelector("#view .skel") && document.querySelector("#view")?.textContent.trim().length > 0, null, { timeout: 15000 }).catch(() => bad.push(h + " never rendered"));
    await p.waitForTimeout(120);
    const r = await p.evaluate(() => ({ text: document.getElementById("view").innerText, root: MPNav.isRoot(), parent: MPNav.parentOf(), title: MPNav.title() }));
    if (/الصفحة غير موجودة/.test(r.text)) bad.push(h + " not found");
    if (!r.root && !/^#\//.test(r.parent)) bad.push(h + " parent " + r.parent);
    if (!r.root && !r.title) bad.push(h + " no title");
    cur = "";
  }
  return bad;
}
test("hub entries, first half", async () => { assert.ok(items.length > 100); assert.deepEqual(await visit(items.slice(0, Math.ceil(items.length / 2))), []); });
test("hub entries, second half", async () => { assert.deepEqual(await visit(items.slice(Math.ceil(items.length / 2))), []); assert.deepEqual(errors, []); });
