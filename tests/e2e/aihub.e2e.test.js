/* global MPAIHub, Remote, DB */
/* v2.77 «مركز الذكاء» e2e against the real server (production build). Provider HTTP is stubbed server-side through
 * createApp({ aihubOpts: { fetch, freeProvider } }) — no real AI provider is contacted. Covers: guest 401, the hub screen,
 * ChatGPT shown as «بانتظار موافقة OpenAI» with no button, free daily chat (count goes down), key linking (bad format → clear
 * error, good key → linked + model list, key never echoed), OpenRouter one tap (start → openrouter.ai URL with S256 → callback →
 * linked banner), unlink, EN/LTR + dark at 1440, no page errors, no inline handlers. Screenshots go to $AH_SHOTS when set. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const calls = [];
async function stubFetch(url, init = {}) {
  const u = String(url); calls.push({ u, auth: (init.headers || {}).Authorization || (init.headers || {})["x-api-key"] || "" });
  if (u.includes("openrouter.ai/api/v1/auth/keys")) { const b = JSON.parse(init.body || "{}"); return b.code === "good-code" && b.code_verifier ? J({ key: "sk-or-v1-" + "a".repeat(48) }) : J({ error: "bad" }, 400); }
  if (u.endsWith("/models")) return J({ data: [{ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }, { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }, { id: "openrouter/auto", name: "Auto" }] });
  if (u.endsWith("/chat/completions")) return J({ model: "gemini-2.5-flash", choices: [{ message: { role: "assistant", content: "أهلاً! هذا رد من حسابك المرتبط." } }] });
  return J({ error: "nope" }, 404);
}
const freeProvider = { label: "مجتمع بلس", async chat() { return { text: "رد مجاني تجريبي من التطبيق.", model: "free-model" }; } };

let S, ctx, p; const errors = [];
const SHOTS = process.env.AH_SHOTS; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, n) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, n + ".png"), fullPage: true }); };
const GEM = "AIza" + "B".repeat(35);

test.before(async () => {
  S = await startStack({ aihubOpts: { fetch: stubFetch, freeProvider } });
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.route("https://openrouter.ai/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>OpenRouter</title><h1>OpenRouter (stub)</h1>" }));
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "ah_e2e", "مختبر الذكاء");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("guest gets 401 from the hub API", async () => {
  const r = await fetch(S.base + "/api/aihub", { headers: { "X-Requested-With": "mujtama" } });
  assert.equal(r.status, 401);
});

test("hub screen: free card, one-tap hero, ChatGPT pending with no button, privacy, help", async () => {
  await p.goto(S.base + "/#/aihub"); await p.waitForSelector("#ah-box:not([aria-busy])", { timeout: 15000 });
  assert.match(await p.textContent(".page-head h2"), /مركز الذكاء/);
  assert.match(await p.textContent(".ah-free"), /باقي 5 من 5/);
  assert.ok(await p.isVisible('.ah-hero [data-oauth="openrouter"]'));
  const gpt = p.locator('[data-p="chatgpt"]');
  assert.match(await gpt.textContent(), /بانتظار موافقة OpenAI/);
  assert.equal(await gpt.locator(".ah-blurb").count(), 1, "the ChatGPT blurb shows once");
  assert.equal(await gpt.locator("button, input, form").count(), 0, "no fake ChatGPT button");
  assert.match(await p.textContent(".ah-priv"), /لا نخزّن رسائلك/);
  const small = await p.$$eval(".ah button:not([hidden]), .ah summary, .ah select", (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).map((e) => e.outerHTML.slice(0, 80)));
  assert.deepEqual(small, [], "touch targets ≥ 40px");
  await shot(p, "390-light-ar-top");
});

test("free chat answers and the daily count goes down; nothing is stored", async () => {
  await p.fill("#ah-in", "مرحبا"); await p.click(".ah-send");
  await p.waitForSelector(".ah-msg.ai .ah-bub", { timeout: 10000 });
  assert.match(await p.textContent(".ah-log"), /رد مجاني تجريبي/);
  assert.match(await p.textContent(".ah-free"), /باقي 4 من 5/);
  const tables = await S.app.ctx.db.all("SELECT * FROM ai_link_usage");
  assert.ok(tables.every((r) => !JSON.stringify(r).includes("مرحبا")), "chat text never stored");
});

test("key linking: bad format → clear error; good key → linked with models; key never echoed", async () => {
  const card = p.locator('[data-p="gemini"]');
  await card.locator("summary").click();
  await card.locator("input").fill("not-a-key-123456789"); await card.locator("[type=submit]").click();
  await p.waitForFunction(() => document.querySelector('[data-p="gemini"] .ah-err')?.textContent.trim().length > 0);
  assert.equal(await card.locator("input").getAttribute("aria-invalid"), "true");
  await card.locator("input").fill(GEM); await card.locator("[type=submit]").click();
  await p.waitForSelector('[data-p="gemini"].is-linked select[data-model] option[value="gemini-2.5-pro"]', { state: "attached", timeout: 10000 });
  const html = await p.content(); assert.ok(!html.includes(GEM), "the key is never sent back to the page");
  const ov = await p.evaluate(() => Remote.api("GET", "/api/aihub"));
  assert.ok(!JSON.stringify(ov).includes(GEM));
  assert.equal(ov.providers.find((x) => x.id === "gemini").linked.hint, "••••BBBB");
  await shot(p, "390-light-ar-linked");
});

test("chat on the linked account", async () => {
  await p.selectOption("#ah-cp", "gemini");
  await p.fill("#ah-in", "اختبار"); await p.click(".ah-send");
  await p.waitForFunction(() => /من حسابك المرتبط/.test(document.querySelector(".ah-log")?.textContent || ""), null, { timeout: 10000 });
  assert.ok(calls.some((c) => c.u.endsWith("/chat/completions") && c.auth.includes(GEM)));
});

test("OpenRouter one tap: S256 authorize URL → callback → linked banner; a replayed state is refused", async () => {
  await p.click('.ah-hero [data-oauth="openrouter"]');
  await p.waitForURL(/openrouter\.ai\/auth/, { timeout: 10000 });
  const u = new URL(p.url());
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.match(u.searchParams.get("callback_url"), /\/api\/aihub\/oauth\/openrouter\/callback$/);
  const state = u.searchParams.get("state"); assert.ok(state && state.length >= 20);
  await p.goto(S.base + "/api/aihub/oauth/openrouter/callback?code=good-code&state=" + encodeURIComponent(state));
  await p.waitForSelector(".ah-banner.good", { timeout: 15000 });
  assert.match(await p.textContent(".ah-banner.good"), /تم ربط OpenRouter/);
  assert.ok(!(await p.isVisible(".ah-hero")), "hero hides once linked");
  await p.goto(S.base + "/api/aihub/oauth/openrouter/callback?code=good-code&state=" + encodeURIComponent(state));
  await p.waitForSelector(".ah-banner.bad", { timeout: 15000 });
  assert.match(await p.textContent(".ah-banner.bad"), /انتهت مهلة الربط/);
});

test("preferences: assistant can use the member's own account", async () => {
  await p.goto(S.base + "/#/aihub"); await p.waitForSelector("#ah-asst");
  await p.selectOption("#ah-asst", "gemini");
  await p.waitForFunction(async () => ((await Remote.api("GET", "/api/aihub")).prefs.features || {}).assistant === "gemini");
});

test("unlink removes the key", async () => {
  p.once("dialog", (d) => d.accept());
  await p.click('[data-unlink="gemini"]');
  await p.waitForSelector('[data-p="gemini"]:not(.is-linked)', { timeout: 10000 });
  const row = await S.app.ctx.db.get("SELECT * FROM ai_links WHERE provider='gemini'");
  assert.equal(row, undefined);
});

test("EN / LTR, dark, desktop 1440 render cleanly", async () => {
  const c2 = await S.browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", reducedMotion: "reduce", locale: "en-US" });
  const q = await c2.newPage(); q.on("pageerror", (e) => errors.push(e.message));
  await onboard(q, S.base, "ah_e2e_en", "AI Tester");
  await q.evaluate(() => Remote.api("PUT", "/api/me/lang", { lang: "en" }).catch(() => { }));
  await q.goto(S.base + "/#/aihub"); await q.reload(); await q.waitForSelector("#ah-box:not([aria-busy])", { timeout: 15000 });
  if (!(await q.evaluate(() => DB.settings && DB.settings.lang === "en"))) { await q.evaluate(() => { DB.settings.lang = "en"; document.documentElement.dir = "ltr"; document.documentElement.lang = "en"; MPAIHub.view(); }); await q.waitForSelector("#ah-box:not([aria-busy])"); }
  await q.waitForSelector("#ah-box .ah-p", { timeout: 15000 }); await q.waitForTimeout(400);
  assert.match(await q.textContent(".page-head h2"), /AI Hub/);
  assert.match(await q.textContent('[data-p="chatgpt"]'), /Awaiting OpenAI approval/);
  assert.match(await q.textContent('[data-p="chatgpt"]'), /Sign in with your ChatGPT account/);
  assert.match(await q.textContent(".ah-hero"), /including free models/);
  const overlap = await q.$$eval(".ah-p > .ah-row:first-child", (rows) => rows.filter((r) => { const c = r.querySelector(".ah-chip"), h = r.querySelector("h4"); if (!c || !h) return false; const a = c.getBoundingClientRect(), b = h.getBoundingClientRect(); return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom); }).length);
  assert.equal(overlap, 0, "status chips never overlap the provider name");
  const over = await q.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(over <= 1, "no horizontal overflow");
  await shot(q, "1440-dark-en");
  await q.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await shot(q, "1440-light-en");
  await c2.close();
});

test("dark mobile Arabic, no page errors, no inline handlers in the chunk", async () => {
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await p.goto(S.base + "/#/aihub"); await p.waitForSelector("#ah-box:not([aria-busy])");
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await shot(p, "390-dark-ar");
  const src = fs.readFileSync(path.join(ROOT, "aihub-ui.js"), "utf8");
  assert.ok(!/\son[a-z]+=/.test(src.replace(/aria-[a-z]+=|data-[a-z-]+=/g, "")), "no inline handlers");
  assert.deepEqual(errors, []);
});
