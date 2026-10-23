/* Phase 41 e2e against the REAL Phase 41 server (production build, no AI/i18n stubs; Pi payments off and no translation
 * provider, exactly like production). Then a stub provider is installed server-side (services.translate.setProvider) and a
 * staff grant is given, to prove the subscriber path end to end: translate → toggle original ⇄ translation.
 * Covers: language switcher ar → en (LTR) → ar (v2.67: Arabic + English only; a legacy fr / ur opens in English), /api/me/lang persisted, catalogue strings in the shell,
 * upsell sheet for non-subscribers with «خدمة الترجمة غير مفعّلة بعد» / «مدفوعات Pi غير مفعّلة بعد», #/ai page, subscriber
 * translation + toggle, no page errors, no inline handlers in the new chunks, core budget untouched. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
const until = async (fn, arg, ms = 10000) => p.waitForFunction(fn, arg, { timeout: ms });
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "ai_e2e", "مختبر الترجمة");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("real P41 server: language switcher ar → en (LTR) → ar, only ar + en offered, legacy fr/ur → en, persisted, catalogue applied", async () => {
  const cfg = await (await p.request.get(S.base + "/api/i18n/config")).json();
  assert.deepEqual(cfg.languages.map((l) => l.code), ["ar", "en"]);
  await p.waitForSelector("#mp-lang-btn", { timeout: 15000 }); // i18n chunk loaded lazily, 🌐 in the top bar
  await p.click("#mp-lang-btn");
  await p.waitForSelector('[data-mplang="en"]', { timeout: 15000 });
  assert.deepEqual(await p.$$eval("[data-mplang]", (b) => b.map((x) => x.dataset.mplang)), ["ar", "en"], "picker offers Arabic and English only (v2.67)");
  await p.click('[data-mplang="en"]');
  await until(() => document.documentElement.dir === "ltr" && document.documentElement.lang === "en");
  await until(() => document.querySelector('.bottomnav a[data-r=home] small')?.textContent === "Home");
  const uid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='ai_e2e'")).id;
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await S.app.ctx.db.get("SELECT lang FROM users WHERE id=$1", [uid])).lang, "en");
  // reload keeps the language (DB.settings + early i18n load)
  await p.reload(); await until(() => document.documentElement.lang === "en" && document.querySelector('.bottomnav a[data-r=home] small')?.textContent === "Home", null, 15000);
  // a retired fr / ur (account value from before v2.67 + this device's saved settings) opens in English, LTR, never broken
  for (const L of ["ur", "fr"]) {
    await S.app.ctx.db.run("UPDATE users SET lang=$1 WHERE id=$2", [L, uid]);
    await p.evaluate((x) => { DB.settings.lang = x; save(); }, L);
    await p.reload(); await until(() => document.documentElement.lang === "en" && document.documentElement.dir === "ltr" && document.querySelector('.bottomnav a[data-r=home] small')?.textContent === "Home", null, 15000);
  }
  await p.goto(S.base + "/?nosw#/settings/language"); await p.waitForSelector('[data-mplang="ar"]', { timeout: 15000 });
  await p.click('[data-mplang="ar"]');
  await until(() => document.documentElement.dir === "rtl" && document.documentElement.lang === "ar" && document.querySelector('.bottomnav a[data-r=home] small')?.textContent === "الرئيسية");
  // picker screenshots: 390 light AR, 1440 dark EN (two buttons only, no overflow)
  const dir = process.env.SHOTS_DIR; const shot = async (n) => { if (dir) { fs.mkdirSync(dir, { recursive: true }); await p.screenshot({ path: path.join(dir, n + ".png") }); } };
  const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  await p.evaluate(() => { DB.settings.theme = "light"; save(); globalThis.applyShell(); }); await p.waitForTimeout(300);
  assert.equal(await p.$$eval(".mp-lang [data-mplang]", (b) => b.length), 2); assert.ok(await noOverflow(), "390 overflow");
  await shot("lang-picker-390-light-ar");
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.click('[data-mplang="en"]'); await until(() => document.documentElement.lang === "en");
  await p.evaluate(() => { DB.settings.theme = "dark"; save(); globalThis.applyShell(); }); await p.waitForTimeout(300);
  assert.equal(await p.$$eval(".mp-lang [data-mplang]", (b) => b.length), 2); assert.ok(await noOverflow(), "1440 overflow");
  await shot("lang-picker-1440-dark-en");
  await p.click('[data-mplang="ar"]'); await until(() => document.documentElement.lang === "ar");
  await p.evaluate(() => { DB.settings.theme = "system"; save(); globalThis.applyShell(); });
  await p.setViewportSize({ width: MOBILE.viewport?.width || 390, height: MOBILE.viewport?.height || 844 });
});

test("real P41 server: non-subscriber upsell (service off, Pi off) → grant + provider → translate and toggle", async () => {
  const mk = await p.evaluate(async () => { const r = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ text: "Learning to code step by step is the best way to start your career in tech" }) }); return r.json(); });
  const pid = mk.post.id;
  await p.goto(S.base + "/?nosw#/post/" + pid);
  await p.waitForSelector(`[data-aitr="post:${pid}"]`, { timeout: 20000 });
  await p.click(`[data-aitr="post:${pid}"]`);
  await p.waitForSelector("#mp-sub", { timeout: 10000 });
  const sh = await p.textContent("#sheet");
  assert.match(sh, /مجتمع\+ ذكاء/); assert.match(sh, /خدمة الترجمة غير مفعّلة بعد/); assert.match(sh, /لم يُحدَّد سعر الاشتراك بعد/);
  await p.click("#mp-sub");
  await until(() => /مدفوعات Pi غير مفعّلة بعد/.test(document.querySelector("#mp-sub-n")?.textContent || ""));
  await p.click("#mp-not");
  // API truth: 402 for non-subscribers
  const r402 = await p.evaluate(async (id) => (await fetch("/api/ai/translate", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ kind: "post", id }) })).status, pid);
  assert.equal(r402, 402);
  // staff grant (DB) + a provider installed on the real server
  const { db } = S.app.ctx; const uid = (await db.get("SELECT id FROM users WHERE handle='ai_e2e'")).id;
  await S.app.ctx.services.ai.ensurePlans();
  const plan = await db.get("SELECT id FROM ai_plans WHERE slug='ai_plus'");
  const now = new Date();
  await db.run("INSERT INTO ai_subscriptions(id,user_id,plan_id,state,source,period_start,period_end,created_at,updated_at) VALUES('aisub_e2e',$1,$2,'active','grant',$3,$4,$3,$3)", [uid, plan.id, now.toISOString(), new Date(+now + 7 * 864e5).toISOString()]);
  S.app.ctx.services.translate.setProvider({ name: "stub", private: true, supports: () => true, async translate(t, to) { return { text: `[${to}] تعلم البرمجة خطوة بخطوة`, costMicros: 1 }; } });
  await p.evaluate(() => window.MPAI.refresh());
  await p.click(`[data-aitr="post:${pid}"]`);
  await until(() => !!document.querySelector(".mp-tr-out:not([hidden])"), null, 10000);
  assert.match(await p.textContent(".mp-tr-out"), /\[ar\] تعلم البرمجة/);
  assert.match(await p.textContent(".mp-tr-out .mp-tr-lbl"), /ترجمة آلية/);
  assert.equal(await p.textContent(`[data-aitr="post:${pid}"]`), "عرض الأصل");
  await p.click(`[data-aitr="post:${pid}"]`);
  await until((id) => document.querySelector(`[data-aitr="post:${id}"]`)?.textContent === "ترجمة" && !document.querySelector(".post-open .body").hidden, pid);
  // #/ai page
  await p.goto(S.base + "/?nosw#/ai"); await p.waitForSelector("#mp-sub", { timeout: 15000 });
  assert.match(await p.textContent("#mp-ai"), /فعّال/);
  assert.deepEqual(errors, []);
});

test("build: new chunks have no inline handlers and the core stays within budget", () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file));
  assert.ok(core.br <= 90 * 1024, "core " + core.br);
  for (const f of b.files.filter((x) => /chunk-(ai|i18n)/.test(x.file) && x.file.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(ROOT, "dist", f.file), "utf8");
    assert.ok(!/\son[a-z]+=["']/.test(src) && !/javascript:/.test(src), f.file);
  }
  assert.ok(b.files.some((x) => /chunk-i18n-en-/.test(x.file)) && !b.files.some((x) => /chunk-(i18n|helpcontent)-(fr|ur)-/.test(x.file)) && b.files.some((x) => /chunk-ai-/.test(x.file)));
});
