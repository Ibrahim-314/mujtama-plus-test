/* global MPPrefs */
/* v2.53 deep-screen navigation e2e (production build, 390 px Arabic RTL):
 * a community page lights «المجتمعات» wherever it was opened from (here: from the home feed), its title is the community name
 * and appears in the top bar once the (re-rendered) community heading scrolls away; a post keeps the tab it was opened from;
 * a hub feature (jobs) opened from home lights «المزيد»; switching the theme leaves no tab label with an animated colour (no transitions during the scheme flip). */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p;
const errors = [];
const until = async (fn, arg, ms = 10000) => p.waitForFunction(fn, arg, { timeout: ms });
const state = () => p.evaluate(() => ({ act: document.querySelector(".bottomnav a.active")?.dataset.r, title: document.getElementById("tbTitle").textContent,
  titled: document.querySelector(".topbar").classList.contains("titled") }));

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "deep_admin", "مدير العمق");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("community page owns «المجتمعات», shows its name in the top bar after scrolling; post keeps its opener tab; theme flip has no transitions", async () => {
  const call = (m, u, b) => p.evaluate(async ([m, u, b]) => (await fetch(u, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: b ? JSON.stringify(b) : undefined })).json(), [m, u, b]);
  const cid = (await call("POST", "/api/communities", { name: "مطورو Pi في جدة", desc: "مجتمع للتجربة", topic: "dev", rules: ["الاحترام"] })).community.id;
  const ids = []; for (let i = 0; i < 6; i++) ids.push((await call("POST", "/api/posts", { text: "منشور رقم " + i + " لتجربة التمرير داخل المجتمع", community: cid })).post.id); const pid = ids[5];
  await p.evaluate(() => { location.hash = "#/home"; }); await until(() => document.querySelector(".bottomnav a.active")?.dataset.r === "home");
  await p.evaluate((c) => { location.hash = "#/c/" + c; }, cid);
  await p.waitForSelector("#view h2.c-name");
  await until(() => document.getElementById("tbTitle").textContent === "مطورو Pi في جدة");
  const s = await state(); assert.equal(s.act, "communities"); assert.equal(s.titled, false); // the name is still on screen
  await p.evaluate(() => scrollTo(0, 900));
  await until(() => document.querySelector(".topbar").classList.contains("titled"));
  // a post opened from the community keeps «المجتمعات»; opened from home it keeps «الرئيسية»
  await p.evaluate((x) => { location.hash = "#/post/" + x; }, pid); await until(() => document.getElementById("tbTitle").textContent === "المنشور");
  assert.equal((await state()).act, "communities");
  await p.evaluate(() => { location.hash = "#/home"; }); await until(() => document.querySelector(".bottomnav a.active")?.dataset.r === "home");
  await p.evaluate((x) => { location.hash = "#/post/" + x; }, ids[0]); await until(() => document.getElementById("tbTitle").textContent === "المنشور");
  assert.equal((await state()).act, "home");
  // a hub feature opened from home lights «المزيد» (where it lives), not «الرئيسية»
  await p.evaluate(() => { location.hash = "#/jobs"; }); await until(() => document.querySelector(".bottomnav a.active")?.dataset.r === "menu");
  await p.evaluate(() => { location.hash = "#/home"; }); await until(() => document.querySelector(".bottomnav a.active")?.dataset.r === "home");
  // theme flip: the class that disables transitions is on for the flip and gone right after
  const r = await p.evaluate(() => new Promise((res) => {
    const H = document.documentElement, seen = [];
    new MutationObserver(() => seen.push(H.classList.contains("no-tx") + ":" + H.dataset.theme)).observe(H, { attributes: true, attributeFilter: ["data-theme"] });
    MPPrefs.set("theme", H.dataset.theme === "dark" ? "light" : "dark");
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => res({ seen, after: H.classList.contains("no-tx"), tx: getComputedStyle(document.querySelector('.bottomnav a[data-r="home"]')).transitionProperty }))));
  }));
  assert.ok(r.seen.length >= 1 && r.seen.every((x) => x.startsWith("true")), JSON.stringify(r)); assert.equal(r.after, false);
  assert.ok(!/color/.test(r.tx), r.tx);
  assert.deepEqual(errors, []);
});
