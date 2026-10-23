/* global MPEditor */
/* v2.50 screenshots of the two editors (community = simple, general = creative), mobile 390px, light + dark, Arabic.
 * Usage: node tools/shots-editors.js <out-dir>   (uses the E2E harness: real server + production build) */
const path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE, DESKTOP } = require("../tests/e2e/harness");
const out = process.argv[2] || "/tmp/editor-shots"; fs.mkdirSync(out, { recursive: true });
(async () => {
  const S = await startStack(); const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "hala_writer", "هلا الكاتبة");
  const cid = await p.evaluate(async () => {
    const H = { "X-Requested-With": "mujtama", "Content-Type": "application/json" };
    const j = (m, u, b) => fetch(u, { method: m, headers: H, body: b && JSON.stringify(b) }).then(r => r.json());
    const c = (await j("POST", "/api/communities", { name: "مطورو Pi في جدة", desc: "نبني معاً", topic: "dev", rules: ["الاحترام أولاً", "لا رسائل مزعجة", "شارك ما يفيد الأعضاء"] })).community;
    await j("PATCH", `/api/communities/${c.id}/identity`, { icon: "🚀", accent: "#0f766e", tags: [{ name: "سؤال" }, { name: "مشروع" }, { name: "فعالية" }] });
    await j("POST", `/api/communities/${c.id}/channels`, { name: "نقاش عام" });
    return c.id;
  });
  await p.evaluate(() => refresh()); await p.waitForTimeout(500);
  const theme = (t) => p.evaluate((t) => { document.documentElement.dataset.theme = t; }, t);
  // general (creative) editor
  for (const t of ["light", "dark"]) {
    await theme(t);
    await p.evaluate(() => document.getElementById("fab").click()); await p.waitForSelector("#composer3.ced-general");
    await p.fill("#c3-text", "أطلقنا اليوم **ميزة جديدة** في مجتمع بلس 🎉\n\n- محرر أبسط للمجتمعات\n- محرر إبداعي للمنشورات العامة\n\n#مجتمع_بلس");
    await p.waitForTimeout(500); await p.screenshot({ path: path.join(out, `general-${t}.png`) });
    await p.click('[data-t="poll"]'); await p.fill("#c3-text", "ما الميزة التي تريدها بعد ذلك؟"); await p.fill('[data-po="0"]', "رسائل صوتية"); await p.fill('[data-po="1"]', "بث مباشر");
    await p.evaluate(() => { document.querySelector("#c3-opts").open = true; }); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, `general-poll-${t}.png`), fullPage: false });
    await p.evaluate(() => document.querySelector("#c3-body").scrollTo(0, 9999)); await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(out, `general-options-${t}.png`) });
    await p.evaluate(() => MPEditor.current?.close(true));
  }
  // community (simple) editor
  await p.goto(S.base + "/?nosw#/c/" + cid); await p.waitForSelector("#c-compose", { timeout: 15000 });
  for (const t of ["light", "dark"]) {
    await theme(t);
    await p.click("#c-compose"); await p.waitForSelector("#composer3.ced-community");
    await p.fill("#c3-text", "مرحباً بالجميع! من يحضر لقاء المطورين يوم الخميس؟");
    await p.click('[data-ctag]'); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, `community-${t}.png`) });
    await p.click('[data-act="poll"]'); await p.fill('[data-po="0"]', "سأحضر"); await p.fill('[data-po="1"]', "ربما"); await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(out, `community-poll-${t}.png`) });
    await p.evaluate(() => MPEditor.current?.close(true));
  }
  // desktop: the creative editor with its live side-by-side preview
  const d = await (await S.browser.newContext({ ...DESKTOP, reducedMotion: "reduce" })).newPage(); d.on("pageerror", e => errs.push(e.message));
  await onboard(d, S.base, "hala_desk", "هلا");
  await d.evaluate(() => document.getElementById("fab").click()); await d.waitForSelector("#composer3.ced-general");
  await d.click('[data-t="article"]'); await d.fill("#c3-title", "دليل الكتابة الجيدة"); await d.fill("#c3-text", "# لماذا نكتب\n\nنكتب **بوضوح** و*اختصار*.\n\n- فكرة واحدة لكل فقرة\n- أمثلة من الواقع\n\n> القارئ مشغول، احترم وقته");
  await d.waitForTimeout(600); await d.screenshot({ path: path.join(out, "general-desktop-light.png") });
  console.log(JSON.stringify({ out, errs }));
  await S.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
