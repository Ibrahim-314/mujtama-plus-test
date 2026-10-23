/* Phase 42 e2e against the REAL server (production build, Pi payments off, no assistant provider — exactly like production).
 * Then a staff grant + a stub provider installed server-side (services.assistant.setProvider) prove the subscriber path:
 * ✨ button in the comment composer → upsell for non-subscribers («المساعد الذكي غير مفعّل بعد», «مدفوعات Pi غير مفعّلة بعد»)
 * → subscriber sheet with «المساعد الذكي غير مفعّل بعد» → transparency sheet → with a provider: improve → «استخدام» fills the box.
 * Also: no page errors, no inline handlers in the new chunk, core JS + CSS budgets untouched. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
const SUG = "شكراً جزيلاً على هذه النصيحة القيّمة";
const until = async (fn, arg, ms = 10000) => p.waitForFunction(fn, arg, { timeout: ms });
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "as_e2e", "مختبر المساعد");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("real server: ✨ assistant in the composer — upsell, not-enabled note, transparency, subscriber improve → use", async () => {
  const mk = await p.evaluate(async () => (await (await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ text: "تعلم البرمجة خطوة بخطوة هو أفضل طريق لبدء مسيرتك" }) })).json()));
  const pid = mk.post.id;
  await p.goto(S.base + "/?nosw#/post/" + pid);
  await p.waitForSelector("#cin + .mp-asb", { timeout: 20000 }); // lazy `assistant` chunk attached the button to the comment box
  // non-subscriber → the existing «مجتمع+ ذكاء» upsell, with the assistant note (no provider) and Pi off
  await p.click("#cin + .mp-asb");
  await p.waitForSelector("#mp-sub", { timeout: 10000 });
  const sh = await p.textContent("#sheet");
  assert.match(sh, /مجتمع\+ ذكاء/); assert.match(sh, /المساعد الذكي غير مفعّل بعد/); assert.match(sh, /المساعد الذكي: صياغة/);
  await p.click("#mp-sub");
  await until(() => /مدفوعات Pi غير مفعّلة بعد/.test(document.querySelector("#mp-sub-n")?.textContent || ""));
  await p.click("#mp-not");
  // API truth: 402 for non-subscribers
  const st = await p.evaluate(async () => (await fetch("/api/assistant/write", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ text: "مرحبا", mode: "improve" }) })).status);
  assert.equal(st, 402);
  // staff grant (DB) → subscriber sheet still says the assistant is not enabled (no provider key)
  const { db } = S.app.ctx; const uid = (await db.get("SELECT id FROM users WHERE handle='as_e2e'")).id;
  await S.app.ctx.services.ai.ensurePlans();
  const plan = await db.get("SELECT id FROM ai_plans WHERE slug='ai_plus'"), now = new Date();
  await db.run("INSERT INTO ai_subscriptions(id,user_id,plan_id,state,source,period_start,period_end,created_at,updated_at) VALUES('aisub_as_e2e',$1,$2,'active','grant',$3,$4,$3,$3)", [uid, plan.id, now.toISOString(), new Date(+now + 7 * 864e5).toISOString()]);
  await p.click("#cin + .mp-asb");
  await p.waitForSelector("#mp-as-sheet", { timeout: 10000 });
  assert.match(await p.textContent("#mp-as-off"), /المساعد الذكي غير مفعّل بعد/);
  await p.click('[data-mode="improve"]');
  await until(() => /اكتب نصاً أولاً/.test(document.querySelector("#mp-as-res")?.textContent || ""));
  // transparency: what the assistant sees
  await p.click("#mp-as-why");
  await p.waitForSelector("#mp-as-why-s", { timeout: 10000 });
  const why = await p.textContent("#mp-as-why-s");
  assert.match(why, /ما الذي يراه المساعد؟/); assert.match(why, /المشفّرة طرفياً/); assert.match(why, /لا نخزّن/);
  await p.click("#mp-as-ok");
  // a provider on the real server → improve → «استخدام» fills the comment box (never posted automatically)
  S.app.ctx.services.assistant.setProvider({ name: "stub", private: true, async chat(m) { return { text: SUG, costMicros: 1 }; }, async embed(t) { return { vectors: t.map(() => [1, 0]), costMicros: 0 }; } });
  await p.fill("#cin", "شكرا عالنصيحه");
  await p.click("#cin + .mp-asb");
  await p.waitForSelector("#mp-as-sheet [data-mode=improve]", { timeout: 10000 });
  assert.equal(await p.$("#mp-as-off"), null);
  await p.click('[data-mode="improve"]');
  await p.waitForSelector("#mp-as-use", { timeout: 10000 });
  assert.match(await p.textContent("#mp-as-res"), /مقترح من المساعد الذكي/);
  await p.click("#mp-as-use");
  await until((v) => document.querySelector("#cin")?.value === v, SUG);
  assert.equal(Number((await db.get("SELECT COUNT(*) n FROM comments WHERE post=$1", [pid])).n), 0, "nothing posted by the assistant");
  assert.equal(Number((await db.get("SELECT requests FROM ai_usage WHERE user_id=$1 AND feature='assistant'", [uid])).requests), 1);
  assert.deepEqual(errors, []);
});

test("build: assistant chunk has no inline handlers; core JS and CSS stay within budget", () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file)), css = b.files.find((f) => /^assets\/app-.*\.css$/.test(f.file));
  assert.ok(core.br <= 90 * 1024, "core " + core.br); assert.ok(css.br <= 16 * 1024, "css " + css.br) /* v2.53: same CSS budget as tools/budget.mjs (14→16 KB) */;
  const ch = b.files.find((x) => /chunk-assistant-.*\.js$/.test(x.file)); assert.ok(ch, "assistant chunk built");
  const src = fs.readFileSync(path.join(ROOT, "dist", ch.file), "utf8");
  assert.ok(!/\son[a-z]+=["']/.test(src) && !/javascript:/.test(src));
});
