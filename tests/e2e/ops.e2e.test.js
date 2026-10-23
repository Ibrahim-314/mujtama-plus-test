/* Phase 49 e2e against the REAL server (production build): an admin opens #/admin → «التشغيل والمراقبة» card (admin-only
 * script /ops-ui.js injected by the pi chunk, not in core) → inline-SVG charts, SLOs, alert rules, publish an incident →
 * it shows on the public server-rendered /status page → product metrics tab with the cohort table.
 * Also: no page errors, no CSP violations (real policy), no inline handlers in the ops script, core budgets untouched. */
const test = require("node:test"),
  assert = require("node:assert");
const fs = require("node:fs"),
  path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p;
const errors = [],
  csp = [];
// real CSP (no 'unsafe-eval') → poll from Node instead of page.waitForFunction
async function waitText(sel, re, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const t = await p.textContent(sel).catch(() => "");
    if (re.test(t || "")) return t;
    if (Date.now() > end) throw new Error(`timeout waiting for ${re} in ${sel}`);
    await new Promise(r => setTimeout(r, 150));
  }
}
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce", bypassCSP: false });
  p = await ctx.newPage();
  p.on("pageerror", e => errors.push(e.message));
  p.on("console", m => {
    if (/Content Security Policy/i.test(m.text())) csp.push(m.text());
  });
  await onboard(p, S.base, "ops_admin", "مديرة التشغيل"); // first account = admin
});
test.after(async () => {
  await ctx?.close();
  await S?.close();
});

test("admin ops dashboard: charts, SLOs, rules, incident → public /status, product metrics", async () => {
  const obs = S.app.ctx.services.observability;
  await obs.flushRollup();
  await obs.checkComponents();
  await p.goto(S.base + "/?nosw#/admin");
  await p.waitForSelector("#ops-adm", { timeout: 20000 });
  await p.click("#ops-adm");
  await p.waitForSelector("#ops-body .ops-chart", { timeout: 15000 });
  assert.ok((await p.$$("#ops-body svg.ops-chart[role=img]")).length >= 4, "requests / errors / p95 / backlog charts");
  const body = await p.textContent("#ops-body");
  assert.match(body, /أهداف مستوى الخدمة/);
  assert.match(body, /التوفر/);
  assert.match(body, /نسبة أخطاء الخادم مرتفعة/);
  assert.match(body, /مغلق للعامة/);
  // publish an incident
  await p.fill("#ops-inc-t", "صيانة قاعدة البيانات");
  await p.fill("#ops-inc-b", "نجري صيانة قصيرة وقد تلاحظ بطئاً");
  await p.selectOption("#ops-inc-i", "major");
  await p.check("[name=ops-c][value=database]");
  await p.click("#ops-inc-go");
  await waitText("#ops-inc", /صيانة قاعدة البيانات/);
  // public status page (server-rendered, no JS)
  const sp = await ctx.newPage();
  sp.on("pageerror", e => errors.push(e.message));
  await sp.goto(S.base + "/status");
  assert.match(await sp.textContent("main"), /بعض الخدمات تعمل بأداء متراجع/);
  assert.match(await sp.textContent("main"), /صيانة قاعدة البيانات/);
  assert.equal(await sp.$$eval("script", s => s.length), 0);
  await sp.close();
  // resolve it from the dashboard
  await p.selectOption("#ops-inc [data-is]", "resolved");
  await p.fill("#ops-inc [data-iu]", "انتهت الصيانة");
  await p.click("#ops-inc [data-ig]");
  await waitText("#ops-inc", /تم الحل/);
  // product metrics
  await p.click('.ops-tabs a[href="#/admin/ops/product"]');
  await waitText("#ops-body", /الاحتفاظ حسب أسبوع التسجيل/);
  assert.match(await p.textContent("#ops-body"), /إجمالي المستخدمين/);
  assert.ok((await p.$$("#ops-body .ops-tbl tbody tr")).length === 8, "8 weekly cohorts");
  // the ops script is not in core, is served compressed, has no inline handlers
  const r = await fetch(S.base + "/ops-ui.js", { headers: { "Accept-Encoding": "br" } });
  assert.equal(r.status, 200);
  assert.ok(r.headers.get("etag"));
  const src = fs.readFileSync(path.join(ROOT, "server", "ui", "ops-ui.js"), "utf8");
  assert.ok(!/\son[a-z]+=["'`]/.test(src), "no inline event handlers");
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json"), "utf8"));
  const core = build.files.find(f => /^assets\/app-.*\.js$/.test(f.file));
  assert.ok(core.br <= 92160, "core JS budget");
  assert.ok(!fs.readFileSync(path.join(ROOT, "dist", core.file), "utf8").includes("MPOps"), "ops UI not in core");
  assert.deepEqual(errors, []);
  assert.deepEqual(csp, []);
});
