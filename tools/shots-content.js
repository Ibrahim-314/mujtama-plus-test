/* Screenshots of the v2.4 creation features (composer + studio) using the E2E harness. */
const { startStack, onboard, MOBILE } = require("../tests/e2e/harness");
(async () => {
  const S = await startStack(); const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await c.newPage();
  await onboard(p, S.base, "hala_writer", "هلا الكاتبة");
  await p.evaluate(async () => { const H = { "X-Requested-With": "mujtama", "Content-Type": "application/json" };
    await fetch("/api/posts", { method: "POST", headers: H, body: JSON.stringify({ type: "article", title: "كيف تبني مجتمعاً عربياً حول Pi", markdown: "# البداية\n\nابدأ **بقيمة واضحة** لأعضائك.\n\n# الأدوات\n\n- غرف صوتية أسبوعية\n- مقالات بسلاسل\n\n# الخلاصة\n\n> المجتمع يُبنى بالثقة" }) });
    await fetch("/api/posts", { method: "POST", headers: H, body: JSON.stringify({ markdown: "ثلاث نصائح للمحتوى:\n\n1. **اختصر**\n2. اكتب `بوضوح`\n3. انشر في *أفضل وقت*" }) }); });
  await p.evaluate(() => refresh()); await p.waitForTimeout(600);
  await p.evaluate(() => document.getElementById("fab").click()); await p.waitForSelector("#composer3");
  await p.click('[data-t="article"]'); await p.fill("#c3-title", "دليل الكتابة الجيدة"); await p.fill("#c3-text", "# لماذا نكتب\n\nانشاء الله نكتب **بوضوح** و*اختصار*.\n\n- فكرة واحدة لكل فقرة\n- أمثلة من الواقع\n\n> القارئ مشغول، احترم وقته");
  await p.waitForSelector(".c3-assist .fix", { timeout: 6000 }).catch(() => { }); await p.waitForTimeout(400);
  await p.screenshot({ path: process.argv[2] });
  await p.click("#c3-x"); await p.goto(S.base + "/?nosw#/studio"); await p.waitForSelector(".kpi-card"); await p.waitForTimeout(500);
  await p.screenshot({ path: process.argv[3] });
  await S.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
