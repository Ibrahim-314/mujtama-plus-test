/* v2.56.0 «المجتمع 3.0» stage 1 — security fixes seen from a real browser: the client store never holds another
 * community's moderation settings, private memberships or private events; the members tab pages from the server;
 * hierarchy errors surface; a signed-out visitor has no avatar tile; the admin page uses the unified page header. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, meId, MOBILE } = require("./harness");
let S, pub, priv, evId; const errors = [];
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
const page = async (opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const call = (p, method, path, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, path, body]);

test("signed-out visitor: no avatar tile in the top bar", async () => {
  const g = await page(); await g.goto(S.base + "/?nosw"); await g.waitForTimeout(1500);
  assert.equal(await g.evaluate(() => { const m = document.getElementById("tbMe"); return !m || m.hidden || getComputedStyle(m).display === "none"; }), true);
  await g.context().close();
});

test("owner sets moderation settings; an outsider's client store never receives them, nor private memberships/events", async () => {
  const o = await page(); await onboard(o, S.base, "core_owner", "مالك الأساس");
  const pr = await call(o, "POST", "/api/communities", { name: "ساحة الأساس العامة", desc: "عام" }); assert.ok(pr.community, JSON.stringify(pr)); pub = pr.community.id;
  S.app.ctx.rl.w?.clear?.(); // the community-creation limit is 1 per user in a short window in this harness
  const vr = await call(o, "POST", "/api/communities", { name: "غرفة الأساس الخاصة", type: "private" }); assert.ok(vr.community, JSON.stringify(vr)); priv = vr.community.id;
  await call(o, "PATCH", `/api/communities/${pub}/automod`, { words: ["كلمةمخفية"] });
  await call(o, "PATCH", `/api/communities/${priv}/identity`, { joinQuestions: ["سؤال سري للانضمام"] });
  const evr = await call(o, "POST", "/api/events/plus", { name: "لقاء الغرفة الخاصة", startsAt: new Date(Date.now() + 5 * 864e5).toISOString(), community: priv }); assert.ok(evr.event, JSON.stringify(evr)); evId = evr.event.id;
  const x = await page(); await onboard(x, S.base, "core_outsider", "زائر فضولي");
  await x.evaluate(() => refresh()); await x.waitForTimeout(500);
  const store = await x.evaluate(() => JSON.stringify({ c: DB.communities, m: DB.memberships, e: DB.events }));
  assert.doesNotMatch(store, /كلمةمخفية|سؤال سري|automod|joinQuestions/, "no moderation settings in the client store");
  const parsed = JSON.parse(store);
  assert.ok(!parsed.m.some(m => m.community === priv), "no member list of a private community");
  assert.ok(!parsed.e.some(e => e.id === evId), "no private event");
  assert.equal((await call(x, "GET", `/api/events/${evId}/details`)).status, 404);
  // the private community page: outsiders get the page but no member list
  await x.goto(S.base + "/?nosw#/c/" + priv); await x.waitForSelector(".c-stats");
  await x.click('[data-ctab="members"]'); await x.waitForSelector("#m-list .empty, #m-list .m-row", { timeout: 8000 });
  assert.equal(await x.$$eval("#m-list .m-row", (r) => r.length), 0, "no member rows for outsiders of a private community");
  await o.context().close(); await x.context().close();
});

test("members tab pages from the server; moderators see actions; strict hierarchy holds in the API", async () => {
  const o = await page(); await onboard(o, S.base, "core_owner2", "مالك ثانٍ");
  const cid = (await call(o, "POST", "/api/communities", { name: "مجتمع الأعضاء الكبير" })).community.id;
  const ids = [];
  for (let i = 0; i < 3; i++) { const u = await page(); await onboard(u, S.base, "core_m" + i, "عضو " + i); await call(u, "PUT", `/api/communities/${cid}/membership`); ids.push(await meId(u)); await u.context().close(); }
  await call(o, "PATCH", `/api/communities/${cid}/members/${ids[0]}`, { role: "admin" }); await call(o, "PATCH", `/api/communities/${cid}/members/${ids[1]}`, { role: "admin" });
  await o.goto(S.base + "/?nosw#/c/" + cid); await o.waitForSelector(".c-stats"); await o.click('[data-ctab="members"]');
  await o.waitForSelector("#m-list .m-row", { timeout: 8000 });
  assert.ok((await o.$$("#m-list .m-row")).length >= 4, "every member listed from the server");
  assert.ok((await o.$$("#m-list [data-mem]")).length >= 1, "moderator actions on members");
  // admin → admin is refused (strict hierarchy)
  const a = await page(); await a.goto(S.base + "/?nosw"); await a.fill("#a-handle", "core_m0"); await a.fill("#a-pass", "secret1234"); await a.click("#a-go"); await a.waitForSelector(".bottomnav a[data-r=home]");
  assert.equal((await call(a, "PATCH", `/api/communities/${cid}/members/${ids[1]}`, { role: "member" })).status, 403);
  assert.equal((await call(a, "PATCH", `/api/communities/${cid}/members/${ids[2]}`, { role: "moderator" })).status, 200, "admin → member is fine");
  await o.context().close(); await a.context().close();
});

test("admin page: unified page header with a back link", async () => {
  const p = await page(); await p.goto(S.base + "/?nosw"); await p.fill("#a-handle", "core_owner"); await p.fill("#a-pass", "secret1234"); await p.click("#a-go"); await p.waitForSelector(".bottomnav a[data-r=home]");
  await p.evaluate(() => { location.hash = "#/admin"; }); await p.waitForSelector("#view .page-head h2", { timeout: 8000 });
  assert.match(await p.textContent("#view .page-head h2"), /لوحة الإدارة/);
  assert.equal(await p.$$eval("#view .wrap > a.muted", (xs) => xs.filter((a) => /→ الإعدادات/.test(a.textContent)).length), 0, "no old «→ الإعدادات» link");
  await p.context().close();
});
