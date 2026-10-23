/* Phase 47 e2e against the REAL server (production build): the lazy `dev` sub-chunk (registered by the `ai` chunk, 0 B in core)
 * → developer portal: create an app (secret shown once) → interactive Arabic docs from /api/v1/openapi.json with try-it
 * (bearer key, no cookie) → OAuth consent screen (/oauth/authorize → #/oauth) → allow → redirect carries code + state.
 * Also: core bundle has no dev code, no inline handlers in the chunk, no page errors. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "dv_e2e", "مختبر المطورين");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("portal → app + key → docs try-it → OAuth consent", async () => {
  await p.goto(S.base + "/?nosw#/developers");
  await p.waitForSelector("#dv-new", { state: "attached", timeout: 20000 });
  await p.click("#dv-mine summary");
  await p.fill('#dv-new [name="name"]', "تطبيق الاختبار");
  await p.fill('#dv-new [name="uris"]', "https://client.example/cb");
  await p.check('#dv-new [value="write:posts"]');
  await p.click('#dv-new button[type="submit"]');
  await p.waitForSelector("#dv-once .once", { timeout: 10000 });
  const secret = (await p.textContent("#dv-once .once pre")).trim();
  assert.match(secret, /^mps_/);
  await p.click("#dv-once a.btn");
  await p.waitForSelector("#dv-key", { timeout: 10000 });
  const appId = (await p.textContent(".dv .card pre")).trim();
  await p.click('#dv-key button[type="submit"]');
  await p.waitForSelector("#dv-once .once", { timeout: 10000 });
  const key = (await p.textContent("#dv-once pre")).trim();
  assert.match(key, /^mpk_/);
  // interactive docs: try GET /api/v1/users/{handle} with the key (no cookie)
  await p.goto(S.base + "/?nosw#/developers/docs");
  await p.waitForSelector("form[data-op]", { state: "attached", timeout: 15000 });
  assert.match(await p.textContent(".dv"), /واجهة مجتمع\+ البرمجية/);
  await p.fill("#dv-tk", key);
  const op = p.locator("details", { hasText: "ملف شخصي عام" });
  await op.locator("summary").click();
  await op.locator('[name="p_handle"]').fill("dv_e2e");
  await op.locator('button[type="submit"]').click();
  await p.waitForFunction(() => [...document.querySelectorAll("form[data-op] pre")].some((x) => /HTTP 200/.test(x.textContent) && /dv_e2e/.test(x.textContent)), null, { timeout: 10000 });
  // OAuth consent
  const challenge = crypto.createHash("sha256").update("v".repeat(50)).digest("base64url");
  const q = new URLSearchParams({ client_id: appId, redirect_uri: "https://client.example/cb", response_type: "code", scope: "read write:posts", state: "xyz", code_challenge: challenge, code_challenge_method: "S256" });
  await p.route("https://client.example/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>cb</p>" }));
  await p.goto(S.base + "/oauth/authorize?" + q);
  await p.waitForSelector('[data-d="allow"]', { timeout: 15000 });
  const txt = await p.textContent(".dv");
  assert.match(txt, /تطبيق الاختبار/); assert.match(txt, /النشر والتعليق باسمك/); assert.match(txt, /الرسائل الخاصة/);
  await Promise.all([p.waitForURL(/client\.example\/cb\?/, { timeout: 10000 }), p.click('[data-d="allow"]')]);
  const u = new URL(p.url());
  assert.equal(u.searchParams.get("state"), "xyz"); assert.match(u.searchParams.get("code"), /^mpo_/);
  assert.deepEqual(errors, []);
});

test("bundle: dev code lives only in its lazy chunk; no inline handlers", () => {
  const dist = path.join(ROOT, "dist"), b = JSON.parse(fs.readFileSync(path.join(dist, "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file));
  const coreSrc = fs.readFileSync(path.join(dist, core.file), "utf8");
  // v2.51: since the v2.38 settings hub, the core's settings index carries the «بوابة المطورين» row LABEL (a link to #/developers)
  // by design — what must stay out of core is the portal CODE: the chunk file and dev-ui.js's own markers.
  assert.ok(!/chunk-dev-|mp-dev-set|function DevUI/.test(coreSrc), "developer portal code is not in core");
  const src = fs.readFileSync(path.join(ROOT, "dev-ui.js"), "utf8");
  assert.ok(!/\son[a-z]+="/i.test(src) && !/javascript:/i.test(src));
});
