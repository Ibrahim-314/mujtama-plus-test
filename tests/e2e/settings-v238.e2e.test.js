/* v2.38 Settings rework e2e (real server, production build, mobile 390 px).
 * Hub: search + profile row + one row per section (empty sections hidden) + sign-out + version.
 * Every section opens as its own page (#/settings?s=<key>) with the section title and a back link to the hub; every entry the
 * old one-page Settings had is still reachable in exactly one section (no duplicate links); rows keep a fixed order; controls
 * keep working (data saver switch, theme segment); search filters across sections and says when nothing matches; the
 * lazy modules still add their rows (lazy chunks untouched). axe light + dark on the hub and every section; tap targets
 * ≥ 44 px; no horizontal overflow at 390 / 360; no page errors; no inline handlers. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p; const errors = [];
const until = async (fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms });
async function axe() {
  /* v2.53: let the reduced-motion 0.01 ms transitions (theme.css gives every element one) finish — right after a theme switch
   * inherited colours are one frame behind the new tokens, which axe would read as text on the wrong background */
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const go = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(250); };
const SECS = ["acct", "privacy", "notif", "content", "display", "money", "family", "help", "admin"];
// every entry of the v2.37 Settings page (admin account, server mode) → the section it must be in now
const EXPECT = { "#/verify": "acct", "#/integrity": "acct", "#/orgs": "acct", "#/studio": "acct", "#/points": "acct", "#/leaderboard": "acct",
  "#/security": "privacy", "#/privacy": "privacy", "#/protection": "privacy", "#/mydata": "privacy", "#/decisions": "privacy",
  "#/notifsettings": "notif", "#/wellbeing": "notif", "#/feedprefs": "content", "#/settings/translate": "content", "#/settings/ads": "content",
  "#/settings/language": "display", "#/settings/appearance": "display", "#/settings/display": "display", "#/app": "display", ds: "display",
  "#/me/purchases": "money", "#/me/paid-posts": "money", "#/ai": "money", "#/creator": "money", "#/ads": "money", "#/age": "family", "#/family": "family",
  "#/faq": "help", "#/tickets": "help", "#/help": "help", "bt-fab": "help", "replay-tour": "help", "#/beta": "help", "#/ambassadors": "help", "#/policies": "help", "#/legal": "help",
  "#/developers": "help", "#/developers/docs": "help", "#/about": "help", "#/admin": "admin", "#/safety-cases": "admin", "#/admin/beta": "admin", "#/admin/points": "admin" };

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "set_admin", "سارة القحطاني"); // first account → admin (sees the admin section too)
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("hub: search, profile, a short list of sections, sign-out and version; axe; 44 px; no overflow", async () => {
  await go("#/settings");
  await until((n) => document.querySelectorAll(".set-sec .list > .li").length >= n, Object.keys(EXPECT).length); // lazy modules filed their rows
  const hub = await p.evaluate(() => ({ sv: document.querySelector(".set-page").dataset.sv, rows: [...document.querySelectorAll(".set-nav > .li")].filter((x) => !x.hidden).map((x) => x.dataset.s), search: !!document.querySelector("#set-q"), me: !document.querySelector(".set-me").hidden, out: !!document.querySelector(".set-foot #logout"), ver: !!document.querySelector(".set-foot #ver"), secsVisible: [...document.querySelectorAll(".set-sec")].filter((x) => !x.hidden).length, sw: document.documentElement.scrollWidth, w: innerWidth }));
  assert.equal(hub.sv, "hub"); assert.deepEqual(hub.rows, SECS); assert.ok(hub.search); assert.ok(hub.me); assert.ok(hub.out); assert.ok(hub.ver);
  assert.equal(hub.secsVisible, 0, "the hub shows sections, not every setting"); assert.ok(hub.sw <= hub.w, "no horizontal overflow");
  assert.ok((await p.evaluate(() => Math.min(...[...document.querySelectorAll(".set-nav > .li, #logout, #set-q")].map((e) => e.getBoundingClientRect().height)))) >= 44);
  assert.deepEqual(await axe(), []);
});

test("every old entry is reachable in exactly one section, in a fixed order; sections are their own pages", async () => {
  const where = await p.evaluate(() => { const m = {}; for (const s of document.querySelectorAll(".set-sec")) for (const r of s.querySelectorAll(":scope > .list > .li")) { const k = r.getAttribute("href") || r.id || r.querySelector("input")?.id; (m[k] = m[k] || []).push(s.dataset.s); } return m; });
  for (const [k, sec] of Object.entries(EXPECT)) assert.deepEqual(where[k], [sec], k);
  for (const [k, v] of Object.entries(where)) assert.equal(v.length, 1, "duplicate entry " + k);
  for (const s of SECS) {
    await go("#/settings?s=" + s);
    await until((k) => document.querySelector(".set-page")?.dataset.sv === "sec" && !document.querySelector(`.set-sec[data-s="${k}"]`).hidden, s);
    const v = await p.evaluate(() => ({ h2: document.querySelector(".page-head h2").textContent, back: document.querySelector(".page-head .back").getAttribute("href"), visible: [...document.querySelectorAll(".set-sec")].filter((x) => !x.hidden).map((x) => x.dataset.s), hub: document.querySelector(".set-hub").hidden, sw: document.documentElement.scrollWidth, w: innerWidth, y: scrollY }));
    assert.deepEqual(v.visible, [s]); assert.equal(v.back, "#/settings"); assert.equal(v.hub, true); assert.ok(v.sw <= v.w, s + " overflow"); assert.equal(v.y, 0);
    assert.ok((await p.evaluate(() => Math.min(...[...document.querySelectorAll(".set-sec:not([hidden]) > .list > .li")].map((e) => e.getBoundingClientRect().height)))) >= 44, s + " tap targets");
    assert.deepEqual(await axe(), [], s);
  }
  // fixed order inside a section (v2.36 row-order fix kept)
  await go("#/settings?s=privacy");
  // v2.140.2: the messages-AI switch row (v2.13x, no href) leads the section; the linked rows keep their fixed order
  assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll('.set-sec[data-s="privacy"] > .list > .li')].map((x) => x.getAttribute("href") || x.id)), ["msgai-set", "#/security", "#/privacy", "#/protection", "#/mydata", "#/decisions"]);
  assert.equal(await p.textContent(".page-head h2"), "الخصوصية والأمان");
  await p.click(".page-head .back"); await until(() => document.querySelector(".set-page")?.dataset.sv === "hub");
  await p.click('.set-nav [data-s="display"]'); await until(() => /s=display/.test(location.hash) && !document.querySelector('.set-sec[data-s="display"]').hidden);
});

test("controls still work inside their section: data saver switch, theme segment", async () => {
  await go("#/settings?s=display"); await until(() => !!document.querySelector("#ds"));
  const before = await p.isChecked("#ds"); await p.click("#ds"); await p.waitForTimeout(200);
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem("mp.prefs") || "{}").dataSaver ?? document.querySelector("#ds").checked), !before);
  await p.click("#ds"); // restore
  await p.click('[data-theme="dark"]'); await until(() => document.documentElement.getAttribute("data-theme") === "dark" || document.documentElement.classList.contains("dark") || DB.settings.theme === "dark");
  await until(() => !document.querySelector('.set-sec[data-s="display"]').hidden && /s=display/.test(location.hash));
  assert.deepEqual(await axe(), [], "display dark");
  await p.click('[data-theme="light"]'); await p.waitForTimeout(300);
});

test("search filters across sections, shows section names, and says when nothing matches", async () => {
  await go("#/settings"); await until(() => document.querySelector(".set-page")?.dataset.sv === "hub");
  await p.fill("#set-q", "الحظر");
  await until(() => document.querySelector(".set-page").dataset.sv === "find");
  const r = await p.evaluate(() => ({ secs: [...document.querySelectorAll(".set-sec")].filter((x) => !x.hidden).map((x) => x.dataset.s), rows: [...document.querySelectorAll(".set-sec:not([hidden]) > .list > .li:not([hidden])")].map((x) => x.getAttribute("href")), nav: document.querySelector(".set-nav").hidden }));
  assert.deepEqual(r.secs, ["privacy"]); assert.deepEqual(r.rows, ["#/protection"]); assert.equal(r.nav, true);
  await p.fill("#set-q", "مشتريات"); await p.waitForTimeout(150);
  assert.ok((await p.evaluate(() => [...document.querySelectorAll(".set-sec:not([hidden]) > .list > .li:not([hidden])")].map((x) => x.getAttribute("href")))).includes("#/me/purchases"));
  assert.deepEqual(await axe(), []);
  await p.fill("#set-q", "كلمة غير موجودة إطلاقاً"); await p.waitForTimeout(150);
  assert.equal(await p.isVisible(".set-none"), true);
  await p.fill("#set-q", ""); await until(() => document.querySelector(".set-page").dataset.sv === "hub");
});

test("dark 360: hub + sections pass axe, no overflow; no page errors; no inline handlers in settings", async () => {
  await p.setViewportSize({ width: 360, height: 780 });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  for (const h of ["#/settings", ...SECS.map((s) => "#/settings?s=" + s)]) {
    await go(h); await p.waitForTimeout(250);
    assert.deepEqual(await axe(), [], h + " dark");
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), h + " overflow 360");
  }
  await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  assert.equal(await p.evaluate(() => [...document.querySelectorAll(".set-page *")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name))).length), 0);
  assert.deepEqual(errors, []);
});
