/* v2.71 — Clips comments sheet: opens over the clip from the comment link and from the rail event "clips:comments",
 * lists + posts comments (count on the clip updates), closes by ✕ / Esc / backdrop / back button, traps focus, closes
 * on leaving the page; axe 0 serious/critical at 390 light, 1440 dark, 390 English LTR. CLIPS_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
const seed = (p) => p.evaluate(() => {
  if (S.post("clipcm_0")) return;
  for (let i = 0; i < 4; i++) DB.posts.push({ id: "clipcm_" + i, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة للتعليقات " + (i + 1), createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223", video: { short: true, duration: 12, variants: { "360p": "/media/none-" + i + ".mp4", poster: "" } } });
  if (!DB.comments.some(c => c.id === "ccm_seed1")) DB.comments.push({ id: "ccm_seed1", post: "clipcm_0", author: DB.me, text: "تعليق أول على اللقطة", parent: null, createdAt: new Date(Date.now() - 30000).toISOString(), status: "published" });
});
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.querySelector(".cl-cm"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
const open = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector(".shorts .short"); await p.waitForTimeout(400); };
// the comment control is the clip's link, or the v271 rail button once the rail block has replaced the actions
const first = '.short[data-short="clipcm_0"] :is(.short-actions a[href^="#/post/"], [data-cl-rail="comment"])';
const COUNT = '.short[data-short="clipcm_0"] :is(.short-actions a[href^="#/post/"] span, [data-cl-rail="comment"] .cl-rail-n)';
const isOpen = (p) => p.evaluate(() => !!document.querySelector(".cl-cm"));
const geom = (p) => p.evaluate(() => { const s = document.querySelector(".cl-cm-sheet").getBoundingClientRect(); const t = [...document.querySelectorAll(".cl-cm-x,.cl-cm-send,.cl-cm-in")].map(e => e.getBoundingClientRect()); return { inView: s.left >= -1 && s.right <= innerWidth + 1 && s.bottom <= innerHeight + 1, minH: Math.min(...t.map(r => r.height)), overflowX: document.documentElement.scrollWidth > innerWidth }; });

test("390 light: link opens sheet, post updates count, Esc/backdrop/✕/back close, focus trap, leave closes, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clipcm_a", "معلّق اللقطات"); await seed(p);
  await open(p, "#/clips");
  const hash0 = await p.evaluate(() => location.hash);
  await p.click(first); await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => location.hash), hash0, "link did not navigate to the post page");
  assert.equal(await p.getAttribute(".cl-cm-sheet", "role"), "dialog"); assert.equal(await p.getAttribute(".cl-cm-sheet", "aria-modal"), "true");
  assert.match(await p.textContent(".cl-cm-list"), /تعليق أول على اللقطة/);
  assert.ok(await p.evaluate(() => document.activeElement.classList.contains("cl-cm-x")), "focus moves into the sheet");
  const g = await geom(p); assert.ok(g.inView, "sheet within viewport"); assert.ok(g.minH >= 44, "44px targets, got " + g.minH); assert.ok(!g.overflowX);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/comments-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  // focus trap: tabbing many times never leaves the sheet
  for (let i = 0; i < 6; i++) await p.keyboard.press("Tab");
  assert.ok(await p.evaluate(() => document.querySelector(".cl-cm").contains(document.activeElement)), "focus trapped");
  // post a comment → list + count on the clip update
  await p.fill(".cl-cm-in", "تعليق جديد من الاختبار"); await p.click(".cl-cm-send"); await p.waitForTimeout(200);
  assert.match(await p.textContent(".cl-cm-list"), /تعليق جديد من الاختبار/);
  assert.equal((await p.$eval(COUNT, (e) => e.dataset.n ?? e.textContent)).trim(), "2", "count on the clip updated"); // the rail draws its count from data-n
  assert.match(await p.textContent(".cl-cm-n"), /2/);
  // Esc closes and restores focus to the link
  await p.keyboard.press("Escape"); await p.waitForTimeout(400);
  assert.equal(await isOpen(p), false, "Esc closes");
  // the comment push re-syncs the store, which can drop this test's local-only seed clips (feed re-renders empty): then
  // focus must land on the clips back button, never on <body>; with the clip still rendered it must be the clip's link
  await p.waitForTimeout(1000);
  const fb = await p.evaluate(() => ({ clips: document.querySelectorAll(".shorts .short").length, onLink: !!document.activeElement?.matches('.short-actions a[href^="#/post/"], [data-cl-rail="comment"]'), onBack: !!document.activeElement?.matches(".shorts-back") }));
  assert.ok(fb.clips ? fb.onLink : fb.onBack, "focus back on the opener " + JSON.stringify(fb));
  assert.equal(await p.evaluate(() => location.hash), hash0, "still on clips after Esc (history.back of our own entry only)");
  // the comment push re-syncs the store from the server, which drops this test's local-only seed clips: re-seed + reopen
  await p.waitForTimeout(1500); await seed(p); await p.evaluate(() => { location.hash = "#/explore"; }); await p.waitForTimeout(500); await open(p, "#/clips");
  // backdrop closes
  await p.click(first); await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(250);
  await p.mouse.click(195, 40); await p.waitForTimeout(400); assert.equal(await isOpen(p), false, "backdrop closes");
  // ✕ closes
  await p.click(first); await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(250);
  await p.click(".cl-cm-x"); await p.waitForTimeout(400); assert.equal(await isOpen(p), false, "✕ closes");
  // back button closes and stays on clips
  await p.click(first); await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(250);
  await p.goBack(); await p.waitForTimeout(400);
  assert.equal(await isOpen(p), false, "back closes"); assert.equal(await p.evaluate(() => location.hash), hash0, "back stayed on clips");
  assert.ok(await p.evaluate(() => document.body.classList.contains("shorts-mode")), "clips page still shown");
  // leaving the page closes without navigating back
  await p.click(first); await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(250);
  await p.evaluate(() => { location.hash = "#/explore"; }); await p.waitForTimeout(600);
  assert.equal(await isOpen(p), false, "leave closes"); assert.equal(await p.evaluate(() => location.hash), "#/explore", "onLeave did not history.back()");
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark: rail event clips:comments is handled (preventDefault + handled), axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "clipcm_b", "مشاهد"); await seed(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await open(p, "#/clips");
  const r = await p.evaluate(() => { const ev = new CustomEvent("clips:comments", { detail: { post: S.post("clipcm_0") }, cancelable: true }); const notCancelled = document.dispatchEvent(ev); return { notCancelled, handled: ev.detail.handled }; });
  assert.equal(r.notCancelled, false, "listener called preventDefault"); assert.equal(r.handled, true);
  await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(300);
  const bg = await p.evaluate(() => getComputedStyle(document.querySelector(".cl-cm-sheet")).backgroundColor); const [R, G, B] = bg.match(/\d+/g).map(Number); assert.ok(R + G + B < 120, "dark sheet, got " + bg);
  const g = await geom(p); assert.ok(g.inView); assert.ok(g.minH >= 44, "44px targets: " + await p.evaluate(() => [...document.querySelectorAll(".cl-cm-x,.cl-cm-send,.cl-cm-in")].map(e => e.className + ":" + e.getBoundingClientRect().height + ":" + getComputedStyle(e).minHeight + ":" + document.querySelectorAll(".cl-cm").length).join(","))); assert.ok(!g.overflowX);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/comments-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  // one real tap on the rail comment button (when the rail block is present) opens exactly one sheet, no navigation
  await p.keyboard.press("Escape"); await p.waitForTimeout(400); assert.equal(await isOpen(p), false);
  if (await p.$('.short[data-short="clipcm_0"] [data-cl-rail="comment"]')) {
    const h0 = await p.evaluate(() => ({ hash: location.hash }));
    await p.click('.short[data-short="clipcm_0"] [data-cl-rail="comment"]'); await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(400);
    const h1 = await p.evaluate(() => ({ hash: location.hash, cm: history.state?.clipsCm, n: document.querySelectorAll(".cl-cm").length }));
    assert.equal(h1.n, 1, "one sheet"); assert.equal(h1.hash, h0.hash, "rail tap did not navigate"); assert.equal(h1.cm, 1, "sheet history entry on top");
    await p.goBack(); await p.waitForTimeout(400); assert.equal(await isOpen(p), false, "one back closes it");
    assert.equal(await p.evaluate(() => location.hash), h0.hash, "one back = one entry (still on clips)");
  }
  await c.close();
});

test("390 English LTR: chrome in English, user content untranslated, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, locale: "en-US" }); const p = await c.newPage();
  await onboard(p, S.base, "clipcm_c", "Clip Commenter");
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.waitForTimeout(1500); await seed(p);
  await open(p, "#/clips");
  await p.click(first); await p.waitForSelector(".cl-cm.open"); await p.waitForTimeout(500);
  assert.match(await p.textContent("#cl-cm-h"), /Comments/);
  assert.equal(await p.getAttribute(".cl-cm-x", "aria-label"), "Close");
  assert.match(await p.textContent(".cl-cm-list"), /تعليق أول على اللقطة/, "user content not translated");
  const g = await geom(p); assert.ok(g.inView); assert.ok(!g.overflowX);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/comments-390-ltr.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
