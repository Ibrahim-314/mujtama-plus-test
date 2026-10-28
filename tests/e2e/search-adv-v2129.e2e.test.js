/* v2.129 search stages 3–6 UI on a phone: X-style tabs (الأبرز/الأحدث/وسائط…), «بحث متقدم» writes operators into the box and runs
 * them (chips show what ran), the best answer shows under an answered question, no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, p; const errors = [];
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [m, u, b]);
let qid;
test.before(async () => {
  S = await startStack({});
  const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "adv_user", "باحث متقدم");
  qid = (await call(p, "POST", "/api/posts", { type: "question", text: "كيف أبدأ تعلم الطبخ الياباني في البيت؟" })).post?.id; assert.ok(qid);
  const cm = await call(p, "POST", "/api/comments", { post: qid, text: "ابدأ بالأرز والميسو، ودورة يوتيوب مجانية تكفي" });
  assert.ok(cm.comment?.id); assert.equal((await call(p, "POST", `/api/posts/${qid}/accept`, { comment: cm.comment.id })).ok, true);
  await call(p, "POST", "/api/posts", { text: "وصفة رامن سريعة للطبخ الياباني" });
});
test.after(async () => { await S?.close(); });

test("tabs, advanced search and best answer", async () => {
  await p.evaluate(() => { location.hash = "#/search/" + encodeURIComponent("الطبخ الياباني"); });
  await p.waitForSelector('#s-body [aria-label="المنشورات"]', { timeout: 15000 });
  for (const t of ["all", "latest", "media", "people"]) assert.equal(await p.locator(`[data-type="${t}"]`).count(), 1);
  await p.waitForSelector(".s-ans.s-ans-ok", { timeout: 8000 }); assert.match(await p.textContent(".s-ans"), /الميسو/);
  await p.click('[data-type="latest"]'); await p.waitForSelector('[data-type="latest"][aria-pressed="true"]');
  await p.click("#s-adv-btn"); await p.waitForSelector("#s-adv-f");
  await p.fill('#s-adv-f [name="phrase"]', "الطبخ الياباني"); await p.selectOption('#s-adv-f [name="kind"]', "questions");
  assert.match(await p.textContent("#s-adv-prev"), /filter:questions/);
  await p.click('#s-adv-f [type="submit"]');
  await p.waitForSelector(".s-ops", { timeout: 10000 });
  assert.equal(await p.inputValue("#sq2"), '"الطبخ الياباني" filter:questions');
  await p.waitForFunction((id) => !!document.querySelector(`#s-body [data-more="${id}"]`) || document.querySelectorAll("#s-body .post-card").length === 1, qid, { timeout: 8000 });
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "-adv.png", fullPage: true });
  assert.deepEqual(errors, []);
});
