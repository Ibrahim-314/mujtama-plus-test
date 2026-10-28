/* v2.118 «فاتك اليوم» Stage 2 — «اسأل عن يومك» (answers only from the reader's last-24h posts; uncited/“not found” answers show
 * no sources) and «ليش رائج؟» (why a tag trends + angles, each citing visible posts; cached per reader+tag). Free allowance stub. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, meId, MOBILE } = require("./harness");

let calls = 0, last = "", junk = false;
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  calls++; const q = (last = msgs[msgs.length - 1].content); if (junk) return { text: "؟", model: "m" };
  const ids = [...q.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);
  if (q.startsWith("سؤال القارئ")) {
    if (q.includes("الطقس")) return { text: JSON.stringify({ answer: "ما لقيت شيئاً عن الطقس في يومك.", found: false, cites: [ids[0]] }), model: "m" };
    return { text: JSON.stringify({ answer: "سارة جربت محمصة جديدة في جدة.", found: true, cites: [ids[0], "p_fake"] }), model: "m" };
  }
  if (q.startsWith("الوسم")) return { text: JSON.stringify({ why: "الناس يتكلمون عن افتتاح محامص جديدة.", angles: [{ text: "ناس مبسوطين بالجودة", cites: [ids[0]] }, { text: "ناس يشتكون من الأسعار", cites: [ids[1]] }, { text: "بلا مصدر", cites: [] }] }), model: "m" };
  return { text: "{}", model: "m" };
} };
let S, c1, c2, p, q; const posts = []; const errors = [];
const call = (pg, method, url, body) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, url, body]);
test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  c1 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); c2 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await c1.newPage(); p.on("pageerror", (e) => errors.push(e.message)); q = await c2.newPage();
  await onboard(p, S.base, "dask_reader", "قارئ"); await onboard(q, S.base, "dask_sara", "سارة");
  assert.ok((await call(p, "PUT", "/api/follows/" + (await meId(q)), {})).status < 300);
  for (const t of ["جربت محمصة جديدة في جدة والقهوة ممتازة #قهوة_جدة", "الأسعار صارت غالية في المحامص الجديدة #قهوة_جدة"]) {
    const id = "p_dask" + Math.random().toString(36).slice(2, 8); posts.push(id);
    assert.ok((await call(q, "POST", "/api/posts", { id, type: "general", text: t })).status < 300);
  }
  const tr = S.app.ctx.services.trends, orig = tr.list.bind(tr);
  tr.list = async (o) => ({ ...(await orig(o)), trends: [{ tag: "قهوة_جدة", posts: 2 }] });
});
test.after(async () => { await c1?.close(); await c2?.close(); await S?.close(); });

test("ask about your day: grounded answer with real sources; “not found” shows none; chips work", async () => {
  await p.goto(S.base + "/#/digest"); await p.waitForSelector("#dask:not([hidden])", { timeout: 15000 });
  calls = 0; await p.click('#dask [data-ask]'); await p.waitForSelector("#dask-out .dask-a [data-cite]", { timeout: 10000 });
  assert.equal(calls, 1); assert.ok(last.includes("محمصة جديدة") && last.includes("وش أهم شي فاتني"));
  assert.match(await p.textContent("#dask-out"), /سارة جربت محمصة/); assert.equal(await p.locator("#dask-out .dask-a >> nth=0 >> [data-cite]").count(), 1, "made-up id dropped");
  await p.fill("#dask-q", "كيف الطقس اليوم؟"); await p.press("#dask-q", "Enter");
  await p.waitForFunction(() => /ما لقيت شيئاً عن الطقس/.test(document.querySelector("#dask-out")?.textContent || ""), null, { timeout: 10000 });
  assert.equal(await p.locator("#dask-out .dask-a >> nth=0 >> [data-cite]").count(), 0, "not found → no sources");
  assert.equal(await p.locator("#dask-out .dask-a").count(), 2, "both answers kept, newest first");
});

test("why trending: explanation + cited angles, cached; source opens the post", async () => {
  await p.goto(S.base + "/#/digest"); await p.waitForSelector("#dwhy [data-why]", { timeout: 15000 });
  calls = 0; await p.click("#dwhy [data-why]"); await p.waitForSelector("#dwhy-out .dbr-lead", { timeout: 10000 });
  assert.equal(calls, 1); const t = await p.textContent("#dwhy-out");
  assert.match(t, /افتتاح محامص/); assert.match(t, /يشتكون من الأسعار/); assert.ok(!t.includes("بلا مصدر"));
  assert.equal(await p.locator("#dwhy-out [data-cite]").count(), 2);
  await p.click("#dwhy [data-why]"); await p.waitForSelector("#dwhy-out .dbr-lead"); assert.equal(calls, 1, "cached");
  await p.click("#dwhy-out [data-cite] >> nth=0"); await p.waitForFunction(() => location.hash.startsWith("#/post/p_dask"));
});

test("validation, junk and no page errors", async () => {
  assert.equal((await call(p, "POST", "/api/aihub/brief/ask", { q: "" })).status, 400);
  assert.equal((await call(p, "POST", "/api/aihub/trend", { tag: "" })).status, 400);
  junk = true; const r = await call(p, "POST", "/api/aihub/brief/ask", { q: "سؤال" }); junk = false;
  assert.equal(r.status, 502);
  assert.deepEqual(errors, []);
});
