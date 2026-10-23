/* Screenshots of the v2.6 discovery features using the E2E harness (production build, lazy chunk).
 *   node tools/shots-discovery.js <explore.png> <search.png> [extraDir]
 * extraDir (optional) also receives home, search landing, clear-button focus, collections, collection, summary, topic,
 * why-sheet and tab-editor screens for design review. */
const path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE } = require("../tests/e2e/harness");
const { seedDiscovery } = require("../tests/e2e/discovery-seed");
(async () => {
  const [explorePng, searchPng, extra] = process.argv.slice(2);
  if (!explorePng || !searchPng) throw new Error("usage: node tools/shots-discovery.js <explore.png> <search.png> [extraDir]");
  const S = await startStack(); const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await c.newPage();
  const errors = []; p.on("pageerror", e => errors.push(e.message));
  await onboard(p, S.base, "noura_jed", "نورة");
  const world = await seedDiscovery(S.app.ctx, p);
  const shot = async (name, file) => { await p.waitForTimeout(500); if (file) await p.screenshot({ path: file }); else if (extra) { fs.mkdirSync(extra, { recursive: true }); await p.screenshot({ path: path.join(extra, name + ".png") }); } };
  await p.evaluate(() => refresh()); await p.goto(S.base + "/?nosw#/explore"); await p.waitForSelector(".x-hero"); await shot("explore", explorePng);
  await p.goto(S.base + "/?nosw#/search/" + encodeURIComponent("المطورين")); await p.waitForSelector(".s-sec"); await p.waitForTimeout(300);
  await p.click("#sq2"); await p.fill("#sq2", "الذكا"); await p.waitForSelector(".s-sugg:not([hidden]) .s-opt"); await shot("search", searchPng);
  if (extra) {
    await p.keyboard.press("Escape"); await p.fill("#sq2", "الذكاء"); await p.keyboard.press("Tab"); await shot("search-clear-focus");
    await p.click("#s-clear"); await p.evaluate(() => document.activeElement.blur()); await p.waitForSelector("#s-body .s-sec"); await shot("search-landing");
    await p.goto(S.base + "/?nosw#/home"); await p.waitForSelector("#d-tabedit"); await p.waitForSelector(".d-digest", { timeout: 6000 }).catch(() => { }); await shot("home");
    await p.evaluate(() => scrollTo(0, document.querySelector(".d-caught")?.getBoundingClientRect().top + scrollY - 300 || 0)); await shot("home-caught-up");
    await p.evaluate(() => scrollTo(0, 0)); await p.click("#d-tabedit"); await p.waitForSelector("#d-te"); await shot("tab-editor"); await p.evaluate(() => closeSheet());
    await p.goto(S.base + "/?nosw#/library"); await p.waitForSelector(".col-tile[data-id]"); await shot("collections");
    await p.goto(S.base + "/?nosw#/collection/" + world.collection); await p.waitForSelector(".ci"); await shot("collection");
    await p.goto(S.base + "/?nosw#/post/" + world.discussion); await p.waitForSelector(".d-sum .d-points"); await p.evaluate(() => scrollTo(0, document.querySelector(".d-sum").getBoundingClientRect().top + scrollY - 80)); await shot("summary");
    await p.goto(S.base + "/?nosw#/topic/ai"); await p.waitForSelector(".tp-head"); await shot("topic");
    await p.goto(S.base + "/?nosw#/home"); await p.waitForSelector("#d-tabedit"); await p.click(".post-card [data-more]"); await p.waitForSelector("#sheet .menu"); await p.click("#sheet .menu button"); await p.waitForSelector(".d-why-row"); await shot("why");
    await p.evaluate(() => closeSheet()); await p.goto(S.base + "/?nosw#/digest"); await p.waitForSelector(".tp-head"); await shot("digest");
  }
  if (errors.length) console.error("page errors:", errors);
  await S.close(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
