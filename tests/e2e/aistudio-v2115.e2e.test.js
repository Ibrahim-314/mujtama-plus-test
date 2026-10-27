/* v2.115 studio AI Stage 2 «بعد النشر» — explain my numbers, summarise a post's comments, suggested replies the creator
 * edits and sends himself. The server gathers the creator's own stats/comments; the model (free allowance stub) only explains.
 * Covers: empty state (no posts) without spending the allowance, insights, comment summary + replies with unknown ids dropped,
 * edit + send a reply as a threaded comment, skip, someone else's post refused, junk output → clear error, no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let mode = "ok", calls = 0, lastAsk = "";
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  calls++; const q = (lastAsk = msgs[msgs.length - 1].content);
  if (mode === "junk") return { text: "لا أعرف", model: "free-model" };
  if (q.includes("هذه أرقام منشئ")) return { text: '{"headline":"مشاهداتك في بدايتها","points":[{"title":"منشور واحد يقود","detail":"أغلب المشاهدات من منشورك عن القهوة"}],"actions":["انشر مرتين هذا الأسبوع"]}', model: "free-model" };
  if (q.includes("هذه تعليقات الجمهور")) {
    const id = (q.match(/"id":"(c_[a-z0-9_]+)"/) || [])[1];
    return { text: JSON.stringify({ summary: "الناس أحبوا القهوة وسألوا عن المكان", mood: "positive", liked: ["الصور"], criticized: [], questions: ["وين المكان؟"], replies: [{ id, reply: "شكراً لك! المكان في حي الروضة" }, { id: "c_fake", reply: "يجب ألا يظهر" }] }), model: "free-model" };
  }
  return { text: "{}", model: "free-model" };
} };
let S, ctx, ctx2, p, q; const errors = [];
const call = (pg, method, url, body) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, url, body]);
const openTab = async () => {
  await p.goto(S.base + "/#/studio"); await p.waitForSelector('[data-stab="ai"]', { timeout: 15000 });
  await p.click('[data-stab="ai"]'); await p.waitForSelector("#sai2-posts:not(:has(.skel))", { timeout: 10000 });
};
test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); ctx2 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); q = await ctx2.newPage();
  await onboard(p, S.base, "sai2_owner", "منشئ المرحلة الثانية"); await onboard(q, S.base, "sai2_fan", "متابع");
});
test.after(async () => { await ctx?.close(); await ctx2?.close(); await S?.close(); });

test("empty creator: insights says post first, no allowance spent", async () => {
  await openTab(); calls = 0;
  await p.click('[data-sai2="insights"]'); await p.waitForSelector("#sai2-out .sai-res", { timeout: 10000 });
  assert.match(await p.textContent("#sai2-out"), /انشر أول منشوراتك/); assert.equal(calls, 0);
});

let post, cid;
test("insights + comment summary + suggested reply sent as a threaded comment", async () => {
  post = "p_sai2" + Date.now().toString(36);
  const r = await call(p, "POST", "/api/posts", { id: post, type: "general", text: "جربت قهوة مختصة جديدة اليوم وكانت رائعة جداً" });
  assert.ok(r.status < 300, "post created " + r.status);
  cid = "c_fan" + Date.now().toString(36);
  const c = await call(q, "POST", "/api/comments", { id: cid, post, text: "شكلها لذيذة! وين المكان؟" }); assert.ok(c.status < 300, "comment " + c.status);
  await openTab();
  await p.click('[data-sai2="insights"]'); await p.waitForSelector("#sai2-out .sai-head", { timeout: 10000 });
  assert.match(await p.textContent("#sai2-out"), /مشاهداتك في بدايتها/); assert.match(await p.textContent("#sai2-out"), /انشر مرتين/);
  assert.ok(!lastAsk.includes("متابع") && !lastAsk.includes("sai2_fan"), "no member names in the facts");
  await p.click(`[data-sai2="comments"][data-post="${post}"]`); await p.waitForSelector("#sai2-out .sai-reply", { timeout: 10000 });
  const t = await p.textContent("#sai2-out");
  assert.match(t, /الناس أحبوا القهوة/); assert.match(t, /إيجابي/); assert.match(t, /وين المكان؟/);
  assert.equal(await p.locator("#sai2-out .sai-reply").count(), 1, "made-up comment id dropped");
  await p.fill("#sai2-out .sai-rin", "شكراً لك! المكان في حي الروضة بمحايل");
  await p.click("#sai2-out [data-send]"); await p.waitForSelector("#sai2-out .sai-reply >> text=أُرسل ردّك", { timeout: 10000 });
  const list = await call(p, "GET", `/api/posts/${post}/comments`);
  const mine = list.body.comments.find((x) => x.parent === cid);
  assert.ok(mine && mine.text === "شكراً لك! المكان في حي الروضة بمحايل", "reply stored under the fan's comment");
});

test("guards: someone else's post refused, junk output → clear message", async () => {
  const r = await call(q, "POST", "/api/aihub/studio", { tool: "comments", post }); assert.equal(r.status, 404);
  mode = "junk"; await openTab();
  await p.click('[data-sai2="insights"]'); await p.waitForSelector("#sai2-out .sai-err", { timeout: 10000 });
  assert.match(await p.textContent("#sai2-out"), /لم يرجع النموذج تحليلاً مفهوماً/); mode = "ok";
});

test("no page errors", () => assert.deepEqual(errors, []));
