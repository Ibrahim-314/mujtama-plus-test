/* Track 4 — community journeys in a real browser (production build with the lazily loaded chunk). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, MOBILE, DESKTOP } = require("./harness");
let S, cid; const errors = [];
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
const page = async (opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const login = async (p, handle) => { await p.goto(S.base + "/?nosw"); await p.fill("#a-handle", handle); await p.fill("#a-pass", "secret1234"); await p.click("#a-go"); await p.waitForSelector(".bottomnav a[data-r=home]"); await dismissTour(p); };
const call = (p, method, path, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [method, path, body]);

test("owner sets up a community: identity, channels, tags; page renders from the lazy chunk; post into a channel", async () => {
  const p = await page(); await onboard(p, S.base, "c_owner", "مالكة المجتمع");
  cid = (await call(p, "POST", "/api/communities", { name: "صنّاع Pi في جدة", desc: "نلتقي ونبني معاً", topic: "dev", rules: ["الاحترام أولاً", "لا رسائل مزعجة"] })).community.id;
  await call(p, "PATCH", `/api/communities/${cid}/identity`, { icon: "🚀", accent: "#0f766e", rulesRequired: true, tags: [{ name: "سؤال" }, { name: "مشروع" }], welcome: { message: "أهلاً بك بيننا!", steps: ["عرّف بنفسك", "اقرأ الويكي"] } });
  await call(p, "POST", `/api/communities/${cid}/channels`, { name: "الإعلانات", kind: "announcements" });
  const gen = (await call(p, "POST", `/api/communities/${cid}/channels`, { name: "نقاش عام" })).channel;
  await p.evaluate(() => refresh());
  await p.goto(S.base + "/?nosw#/c/" + cid); await p.waitForSelector(".c-icon");
  assert.equal((await p.textContent(".c-icon")).trim(), "🚀");
  assert.ok(await p.evaluate(() => Object.keys(window.__CHUNKS || {}).includes("communities")), "communities code is a separate chunk");
  await p.click(`[data-ch="${gen.id}"]`); await p.waitForSelector(`[data-ch="${gen.id}"].on`);
  await p.click("#c-compose"); await p.waitForSelector("#c3-ch");
  assert.equal(await p.inputValue("#c3-ch"), gen.id); assert.equal(await p.getAttribute("#composer3", "data-mode"), "community"); await p.click('[data-ctag="مشروع"]');
  await p.fill("#c3-text", "أول مشروع في المجتمع: محفظة بسيطة"); await p.click("#c3-pub"); await p.waitForSelector("#composer3", { state: "detached" });
  const posts = await call(p, "GET", `/api/communities/${cid}/posts?channel=${gen.id}`); assert.equal(posts.posts[0].ctag, "مشروع");
  await p.context().close();
});

test("member joins through the rules sheet, sees onboarding; automod sends a post to review; mod approves with the keyboard", async () => {
  const u = await page(); await onboard(u, S.base, "c_member", "عضو جديد");
  await u.goto(S.base + "/?nosw#/c/" + cid); await u.waitForSelector("#c-join"); await u.click("#c-join");
  await u.waitForSelector("#j-acc"); await u.click("#j-go"); await u.waitForTimeout(300);
  await u.check("#j-acc"); await u.click("#j-go"); await u.waitForSelector(".c-onboard");
  assert.match(await u.textContent(".c-onboard"), /أهلاً بك بيننا/);
  const o = await page(DESKTOP); await login(o, "c_owner");
  await call(o, "PATCH", `/api/communities/${cid}/automod`, { words: ["كازينو"] });
  const r = await call(u, "POST", "/api/posts", { text: "عرض كازينو مجاني", community: cid }); assert.equal(r.post.status, "pending");
  await o.goto(S.base + "/?nosw#/cmod/" + cid); await o.waitForSelector(".mq-item.sel");
  assert.match(await o.textContent(".mq-item.sel"), /كلمات محظورة/);
  await o.keyboard.press("a"); await o.waitForSelector(".empty", { timeout: 6000 });
  await o.click('[data-mtab="log"]'); await o.waitForSelector(".m-log-row"); assert.match(await o.textContent(".m-log"), /قبول منشور/);
  await u.context().close(); await o.context().close();
});

test("wiki: create a page, edit it, compare versions; ask a question and get a duplicate suggestion", async () => {
  const u = await page(DESKTOP); await login(u, "c_member");
  await u.goto(S.base + `/?nosw#/wiki/${cid}/new`); await u.waitForSelector("#we-t");
  await u.fill("#we-t", "دليل المبتدئين"); await u.fill("#we-b", "# البداية\n\nثبّت متصفح Pi.\n\n# الخطوة التالية\n\nأنشئ تطبيقاً."); await u.click("#we-go");
  await u.waitForSelector(".docs-content h2"); assert.equal(await u.$$eval(".docs-nav a.l2", a => a.length), 2);
  await u.click("#w-edit"); await u.fill("#we-b", "# البداية\n\nثبّت متصفح Pi من المتجر.\n\n# الخطوة التالية\n\nأنشئ تطبيقاً."); await u.fill("#we-s", "توضيح"); await u.click("#we-go");
  await u.waitForSelector(".docs-content"); await u.click("#w-hist"); await u.waitForSelector("[data-diff]"); await u.click("[data-diff]");
  await u.waitForSelector(".diff .da"); assert.match(await u.textContent(".diff .da"), /من المتجر/);
  await u.keyboard.press("Escape").catch(() => { }); await u.evaluate(() => closeSheet());
  const q = await call(u, "POST", "/api/posts", { type: "question", title: "كيف أنشئ تطبيقاً على Pi؟", text: "أريد إنشاء تطبيق على Pi", community: cid });
  assert.ok(q.post, JSON.stringify(q));
  await u.goto(S.base + "/?nosw#/c/" + cid); await u.waitForSelector("[data-ctab=knowledge]"); await u.click("[data-ctab=knowledge]");
  await u.waitForSelector("#ask"); await u.click("#ask"); await u.fill("#aq-t", "طريقة إنشاء تطبيق على Pi");
  await u.waitForSelector(".sim-box", { timeout: 6000 }); assert.match(await u.textContent(".sim-box"), /كيف أنشئ تطبيقاً/);
  await u.context().close();
});

test("events: book the last seat, waitlist, QR ticket, organiser check-in by code, calendar export", async () => {
  const o = await page(); await login(o, "c_owner");
  const ev = (await call(o, "POST", "/api/events/plus", { name: "لقاء المطورين الشهري", startsAt: new Date(Date.now() + 3 * 864e5).toISOString(), place: "جدة", address: "حي الروضة", lat: 21.56, lng: 39.16, capacity: 1, community: cid })).event;
  const u = await page(); await login(u, "c_member");
  await u.goto(S.base + "/?nosw#/event/" + ev.id); await u.waitForSelector("#ev-cd span"); await u.waitForSelector(".ev-map img");
  await u.click("#t-get"); await u.waitForSelector("#t-show"); await u.click("#t-show"); await u.waitForSelector(".ticket-qr svg");
  const code = (await u.textContent(".ticket-code")).trim(); assert.equal(code.length, 8);
  const w = await page(); await onboard(w, S.base, "c_late", "متأخر");
  await w.goto(S.base + "/?nosw#/event/" + ev.id); await w.waitForSelector("#t-get"); assert.match(await w.textContent("#t-get"), /قائمة الانتظار/);
  await w.click("#t-get"); await w.waitForSelector(".ev-wait"); assert.match(await w.textContent(".ev-wait"), /رقم 1/);
  await o.goto(S.base + "/?nosw#/event/" + ev.id); await o.waitForSelector("#ev-scan"); await o.click("#ev-scan");
  await o.fill("#sc-code", code); await o.click("#sc-go"); await o.waitForSelector(".scan-res.ok"); assert.match(await o.textContent(".scan-res"), /عضو جديد/);
  const ics = await (await fetch(`${S.base}/e/${ev.id}.ics`)).text(); assert.match(ics, /SUMMARY:لقاء المطورين الشهري/);
  for (const x of [o, u, w]) await x.context().close();
});

test("directory, health report, settings and invite landing", async () => {
  const o = await page(DESKTOP); await login(o, "c_owner");
  await o.goto(S.base + "/?nosw#/communities"); await o.waitForSelector(".dir-c"); assert.ok(await o.$(`.dir-c[href="#/c/${cid}"]`));
  await o.goto(S.base + "/?nosw#/chealth/" + cid); await o.waitForSelector(".h-ring"); assert.ok(await o.$(".h-tips li"));
  // v2.57: #/cset opens «عام والهوية» in the admin panel (identity moved there; save through the unsaved-changes bar)
  await o.goto(S.base + "/?nosw#/cset/" + cid); await o.waitForSelector('#ca-form [data-k="icon"]'); assert.match(o.url(), /#\/cadmin\/.+\?s=general$/);
  await o.fill('[data-k="icon"]', "🛰️"); await o.waitForFunction(() => document.querySelector("#ca-save")?.hidden === false); // the unsaved-changes bar is up
  await o.click('[data-ca="save"]'); await o.waitForFunction(() => document.querySelector("#ca-save")?.hidden !== false, null, { timeout: 10000 });
  // wait for the saved value on the server (the bar can hide before the write lands) instead of sampling once
  let icon = null; for (let i = 0; i < 50 && icon !== "🛰️"; i++) { icon = (await call(o, "GET", `/api/communities/${cid}/space`)).identity.icon; if (icon !== "🛰️") await o.waitForTimeout(100); }
  assert.equal(icon, "🛰️");
  const inv = (await call(o, "POST", `/api/communities/${cid}/invites`, { label: "واتساب" })).invite;
  const g = await page(); await onboard(g, S.base, "c_guest", "ضيف");
  await g.goto(S.base + "/?nosw#/join/" + inv.code); await g.waitForSelector("#jl-go"); await g.click("#jl-go");
  await g.waitForSelector("#j-acc"); await g.check("#j-acc"); await g.click("#j-go"); await g.waitForSelector(".c-onboard");
  const stats = (await call(o, "GET", `/api/communities/${cid}/invites`)).invites.find(i => i.code === inv.code); assert.equal(stats.joins, 1);
  await o.context().close(); await g.context().close();
});
