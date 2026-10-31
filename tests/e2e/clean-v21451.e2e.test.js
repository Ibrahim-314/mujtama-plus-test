/* v2.145.1 «أرض نظيفة»: the four v2.144 leftovers.
 * a) #/admin cards come in one fixed order however the module calls finish (two loads → same order, known ids in ADM order)
 * b) «التشغيل والمراقبة» card: English in EN, its arrow uses .fwd (flipped in LTR), like the other admin cards
 * c) #/admin/ops at 390: SLO + alert-rule tables stack (no column narrower than its text), no horizontal overflow; 1440 keeps the table
 * d) the feed's #more-sentinel is not a skeleton at rest (1px, no .skel); axe 0 serious/critical on the touched screens */
const test = require("node:test"),
  assert = require("node:assert");
const fs = require("node:fs"),
  path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP, ROOT } = require("./harness");

let S, ctx, p;
const errors = [];
const axeSrc = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
async function axe(page) {
  await page.addScriptTag({ content: axeSrc });
  const r = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 2).map(n => n.target.join(" ")).join(" | ")));
  return r;
}
const adminIds = page => page.evaluate(() => { const h = document.querySelector("#view .page-head h2"); const out = []; for (let n = h?.nextElementSibling; n; n = n.nextElementSibling) out.push(n.id || n.getAttribute("href")); return out; });

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage();
  p.on("pageerror", e => errors.push(e.message));
  await onboard(p, S.base, "clean_admin", "مدير النظافة"); // first account = admin
});
test.after(async () => {
  await ctx?.close();
  await S?.close();
  assert.deepEqual(errors, [], "no page errors");
});

test("a+b: admin cards in a fixed order; ops card English + .fwd arrow in LTR", async () => {
  const runs = [];
  for (let k = 0; k < 2; k++) {
    await p.goto(S.base + "/?nosw#/admin");
    await p.waitForSelector("#ops-adm", { timeout: 20000 });
    await p.waitForTimeout(1500);
    runs.push(await adminIds(p));
  }
  assert.deepEqual(runs[0], runs[1], "same order on every load");
  const order = ["lc-adm", "ops-adm", "mp-adm-ai", "ah-adm-link", "mp-adm-i18n", "ad-adm", "tp-adm", "pd-adm", "mk-adm", "tr-adm", "pi-adm", "bz-adm", "fn-adm"];
  const known = runs[0].filter(id => order.includes(id));
  assert.deepEqual(known, [...known].sort((x, y) => order.indexOf(x) - order.indexOf(y)), "known cards follow the fixed order: " + runs[0].join(","));
  assert.equal(await p.locator("#ops-adm .fwd").count(), 1, "ops card arrow is .fwd");
  assert.equal(await p.getAttribute("#ops-adm", "style"), null, "no inline style on the ops card");
  assert.deepEqual(await axe(p), [], "axe #/admin 390 ar");
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.goto(S.base + "/?nosw#/admin");
  await p.waitForSelector("#ops-adm", { timeout: 20000 });
  await p.waitForTimeout(1500);
  const t = await p.textContent("#ops-adm");
  assert.match(t, /Operations & Monitoring/);
  assert.doesNotMatch(t, /[\u0600-\u06FF]/, "no Arabic left in the EN ops card: " + t);
  assert.equal(await p.evaluate(() => document.documentElement.dir), "ltr");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#ops-adm .fwd")).transform !== "none"), true, "arrow flipped in LTR");
  for (const h of ["#/trust", "#/investigations"]) {
    const n = p.locator(`#view .page-head a[href="${h}"] .fwd`);
    if (await p.locator(`#view .page-head a[href="${h}"]`).count()) assert.equal(await n.count(), 1, h + " arrow is .fwd");
  }
  assert.deepEqual(await axe(p), [], "axe #/admin 390 en");
  await p.evaluate(() => window.MPI18n.setLang("ar"));
});

test("c: #/admin/ops readable at 390 (tables stack, no overflow); 1440 keeps the table", async () => {
  await p.goto(S.base + "/?nosw#/admin/ops");
  await p.waitForSelector(".ops-stack tbody tr", { timeout: 20000 });
  const m = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    head: getComputedStyle(document.querySelector(".ops-stack thead")).display,
    row: getComputedStyle(document.querySelector(".ops-stack tbody tr")).display,
    firstW: Math.round(document.querySelector(".ops-stack tbody tr td").getBoundingClientRect().width)
  }));
  assert.ok(m.sw <= 390, "no horizontal overflow at 390: " + m.sw);
  assert.equal(m.head, "none");
  assert.equal(m.row, "grid");
  assert.ok(m.firstW > 250, "name cell spans the card: " + m.firstW);
  assert.deepEqual(await axe(p), [], "axe #/admin/ops 390");
  const d = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", reducedMotion: "reduce" });
  const q = await d.newPage();
  await q.goto(S.base + "/?nosw");
  await d.addCookies(await ctx.cookies());
  await q.goto(S.base + "/?nosw#/admin/ops");
  await q.waitForSelector(".ops-stack tbody tr", { timeout: 20000 });
  assert.equal(await q.evaluate(() => getComputedStyle(document.querySelector(".ops-stack thead")).display), "table-header-group", "1440 keeps the table");
  await d.close();
});

test("d: #more-sentinel is not a skeleton at rest", async () => {
  await p.goto(S.base + "/?nosw#/home");
  await p.waitForSelector("#hcomp");
  // enough posts for a second page (feedLimit = 10)
  await p.evaluate(async () => { for (let i = 0; i < 14; i++) await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ text: "منشور اختبار الحارس " + i }) }); });
  await p.goto(S.base + "/?nosw#/home");
  await p.waitForSelector("#hcomp");
  await p.waitForTimeout(800);
  const s = await p.evaluate(() => { const e = document.querySelector("#more-sentinel"); return e ? { skel: e.classList.contains("skel"), h: Math.round(e.getBoundingClientRect().height) } : null; });
  if (s) {
    assert.equal(s.skel, false, "no .skel at rest");
    assert.ok(s.h <= 1, "1px sentinel: " + s.h);
  }
  assert.deepEqual(await axe(p), [], "axe home 390");
});
