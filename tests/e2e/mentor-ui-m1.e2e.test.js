/* v2.62 mentorship M1-5 «مصلّح لوحة المرشد» — UI sweep of #/mentoring, #/mentors, #/mentor/:handle.
 * • 390 light Arabic RTL: axe 0 serious/critical on the three routes; no horizontal overflow; touch targets ≥ 44px
 *   (topic chips on the profile, topic pickers in the editor, tab links); user-written text sits in <bdi dir=auto data-noi18n>.
 * • 360: no horizontal overflow even with a long unbroken headline / bio / name.
 * • 1440 dark English LTR: axe 0 serious/critical; page heads, tabs and empty states are translated (no Arabic UI text
 *   left outside user content); chevrons mirrored. No uncaught page errors. Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, c, p; const errors = [];
const LONG = "مطوّرةويببخبرةعشرسنواتفيJavaScriptوTypeScriptوNodeوالتصميمالمتجاوبوالأداءوالوصولية"; // no spaces → must wrap
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.status; }, [m, u, b]);
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const ROUTES = { dash: ["#/mentoring?tab=profile", "#mt-pfm"], hub: ["#/mentors", ".mt-grid,.empty"], prof: ["#/mentor/m1ui_mentor", ".mt-hero"] };
const open = async (k) => {
  const [h, sel] = ROUTES[k];
  await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(120);
  await p.evaluate((x) => { location.hash = x; }, h);
  await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(350);
};
const minH = (sel) => p.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
/* Arabic UI text left in the page (user content, topic labels from the server, and bdi excluded) */
const arabicLeft = () => p.evaluate(() => {
  const root = document.querySelector(".wrap.mt-page"), out = [], AR = /[\u0600-\u06FF]/;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,[data-noi18n],textarea,select,.mt-tags,.mt-topics,.help-pop,.helpi")) continue; out.push(n.nodeValue.trim()); }
  return out;
});

test.before(async () => {
  S = await startStack();
  c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "m1ui_mentor", "سارة " + "القحطانيالقحطانيالقحطاني");
  assert.ok((await call(p, "PUT", "/api/mentor/me", { headline: LONG.slice(0, 110), bio: LONG + " " + LONG, topics: ["programming", "career"], languages: "العربية، English", minutes: 60, price: 0, tz: "Asia/Riyadh", allowMinors: false, open: true })) < 300);
  assert.ok((await call(p, "PUT", "/api/mentor/me/slots", { slots: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, start: "00:00", end: "23:45" })) })) < 300);
});
test.after(async () => { await c?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("390 light AR: axe 0 serious/critical, no overflow, 44px targets, dir=auto on user text", async () => {
  for (const k of Object.keys(ROUTES)) {
    await open(k);
    assert.deepEqual(await axe(p), [], k + " axe");
    assert.ok(await noOverflow(), k + " overflow at 390");
    await shot(`390-light-ar-${k}`);
  }
  await open("dash");
  assert.ok((await minH(".mt-topics label")) >= 44, "topic pickers ≥ 44px");
  assert.ok((await minH(".mt-page .seg a")) >= 44, "dashboard tabs ≥ 44px");
  assert.equal(await p.getAttribute("#mt-pfm [name=headline]", "dir"), "auto");
  await open("prof");
  assert.ok((await minH(".mt-tags a.chip")) >= 44, "profile topic chips ≥ 44px");
  assert.equal(await p.getAttribute(".mt-hero h3", "dir"), "auto");
  assert.equal(await p.getAttribute(".mt-bio", "dir"), "auto");
  assert.ok(await p.$(".mt-hero bdi[dir=ltr]"), "@handle isolated LTR");
  await open("hub");
  if (await p.$(".mt-card")) assert.ok(await p.$(".mt-card bdi[dir=auto][data-noi18n]"), "mentor name isolated on the card");
});

test("360: no horizontal overflow with long unbroken text", async () => {
  await p.setViewportSize({ width: 360, height: 780 });
  for (const k of Object.keys(ROUTES)) { await open(k); assert.ok(await noOverflow(), k + " overflow at 360"); }
  await open("prof"); await shot("360-light-ar-prof");
});

test("1440 dark EN (LTR): axe 0 serious/critical, translated UI, mirrored chevrons", async () => {
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  for (const k of Object.keys(ROUTES)) {
    await open(k); await p.waitForTimeout(300);
    assert.deepEqual(await axe(p), [], k + " axe dark en");
    assert.ok(await noOverflow(), k + " overflow at 1440");
    assert.deepEqual(await arabicLeft(), [], k + " Arabic UI text left in en");
    await shot(`1440-dark-en-${k}`);
  }
  await open("dash");
  assert.match(await p.textContent(".mt-page .page-head h2"), /Mentor dashboard/);
  const chev = await p.$eval(".mt-page .chev", (e) => getComputedStyle(e).transform);
  assert.notEqual(chev, "none", "chevron mirrored in LTR");
  await open("hub");
  assert.match(await p.textContent(".mt-page .page-head h2"), /Mentorship/);
  // back to Arabic: source strings intact
  await p.evaluate(() => window.MPI18n.setLang("ar")); await p.waitForFunction(() => document.documentElement.dir === "rtl");
  await open("hub");
  assert.match(await p.textContent(".mt-page .page-head h2"), /الإرشاد/);
});
