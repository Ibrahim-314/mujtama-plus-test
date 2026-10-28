/* v2.117 «نشرتك الذكية» on «فاتك اليوم» (#/digest) — AI from «مركز الذكاء» (free allowance stub). Made on request, sectioned
 * (top / people you follow / communities / topics), every point cites real source posts (made-up ids and empty sections dropped),
 * cached (reload shows it without a new model call), refresh makes a new one, source chip opens the post, junk → clear error. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, meId, MOBILE } = require("./harness");

let mode = "ok", calls = 0, lastAsk = "";
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  calls++; const q = (lastAsk = msgs[msgs.length - 1].content);
  if (mode === "junk") return { text: "لا أعرف", model: "free-model" };
  const id = (q.match(/"id":"([^"]+)"/) || [])[1];
  return { text: JSON.stringify({ headline: "يومك كان عن القهوة والسفر", sections: [
    { kind: "people", items: [{ text: "سارة جربت محمصة جديدة في جدة", cites: [id] }, { text: "نقطة بلا مصدر", cites: ["p_fake"] }] },
    { kind: "top", items: [{ text: "أبرز ما دار: القهوة المختصة", cites: [id, "p_fake"] }] },
    { kind: "weird", items: [{ text: "x", cites: [id] }] }, { kind: "topics", items: [] }] }), model: "free-model" };
} };
let S, ctx, ctx2, p, q, post; const errors = [];
const call = (pg, method, url, body) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, url, body]);
test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); ctx2 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); q = await ctx2.newPage();
  await onboard(p, S.base, "dbr_reader", "قارئ"); await onboard(q, S.base, "dbr_sara", "سارة");
  const sara = await meId(q);
  assert.ok((await call(p, "PUT", "/api/follows/" + sara, {})).status < 300, "follow");
  post = "p_dbr" + Date.now().toString(36);
  assert.ok((await call(q, "POST", "/api/posts", { id: post, type: "general", text: "جربت اليوم محمصة جديدة في جدة والقهوة كانت ممتازة جداً" })).status < 300, "post");
});
test.after(async () => { await ctx?.close(); await ctx2?.close(); await S?.close(); });

const open = async () => { await p.goto(S.base + "/#/digest"); await p.waitForSelector("#dbr [data-br], #dbr .dbr-lead", { timeout: 15000 }); await p.waitForTimeout(600); };

test("intro first (no model call), then a sectioned brief with real citations only", async () => {
  calls = 0; await open();
  await p.waitForSelector('#dbr [data-br="make"]', { timeout: 15000 }); assert.equal(calls, 0, "made on request");
  await p.click('#dbr [data-br="make"]'); await p.waitForSelector("#dbr .dbr-lead", { timeout: 10000 });
  assert.equal(calls, 1); assert.ok(lastAsk.includes("محمصة جديدة") && lastAsk.includes('"followed":true'), "facts carry the followed post");
  const t = await p.textContent("#dbr");
  assert.match(t, /يومك كان عن القهوة والسفر/); assert.match(t, /الأبرز اليوم/); assert.match(t, /من الناس اللي تتابعهم/);
  assert.ok(!t.includes("نقطة بلا مصدر"), "uncited point dropped"); assert.ok(!t.includes("مواضيع قد تهمك"), "empty section dropped");
  assert.ok(t.indexOf("الأبرز اليوم") < t.indexOf("من الناس"), "top first");
  assert.equal(await p.locator("#dbr [data-cite]").count(), 2, "one real source per point");
});

test("cached on reload, refresh makes a new one, source chip opens the post", async () => {
  calls = 0; await open(); await p.waitForSelector("#dbr .dbr-lead"); assert.equal(calls, 0, "served from cache");
  await p.click('#dbr [data-br="refresh"]'); await p.waitForSelector("#dbr .dbr-lead", { timeout: 10000 }); assert.equal(calls, 1);
  await p.click("#dbr [data-cite] >> nth=0"); await p.waitForFunction((id) => location.hash === "#/post/" + id, post);
});

test("junk output → clear message with retry; no page errors", async () => {
  mode = "junk"; await open(); await p.click('#dbr [data-br="refresh"]');
  await p.waitForSelector('#dbr [data-br="make"]', { timeout: 10000 }); assert.match(await p.textContent("#dbr"), /لم يرجع النموذج نشرة مفهومة/); mode = "ok";
  assert.deepEqual(errors, []);
});
