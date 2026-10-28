/* v2.121 «البحث الذكي» UI: a question-like query shows the «اسأل الذكاء» card; «جاوبني» answers with source chips that open the post;
 * a follow-up chip searches and asks again; a short keyword query gets only the small button. Free allowance stub. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let n = 0;
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  n++; const q = msgs[msgs.length - 1].content, ids = [...q.matchAll(/"id":"(p_[a-z0-9]+)"/g)].map((m) => m[1]);
  if (q.startsWith("حوّل سؤال البحث")) return { text: JSON.stringify({ concepts: [] }), model: "m" };
  return { text: JSON.stringify({ found: true, answer: "الأغلب ينصحون بمحمصة النخبة.", points: [{ text: "النخبة في حي الروضة", cites: [ids[0]] }], followups: ["وش أفضل محمصة بالرياض؟"] }), model: "m" };
} };
let S, p, pid; const errors = [];
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "sai_user", "باحث القهوة");
  pid = (await call(p, "POST", "/api/posts", { text: "مين يعرف محمصة زينة في جدة؟ جربت النخبة في الروضة" })).post?.id;
  assert.ok(pid);
});
test.after(async () => { await S?.close(); });

test("question query → AI card → answer with a source that opens the post; follow-up asks again", async () => {
  await p.evaluate(() => { location.hash = "#/search/" + encodeURIComponent("وش أفضل محمصة بجدة؟"); });
  await p.waitForSelector("#s-ai.s-ai #s-ai-go", { timeout: 15000 });
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "-card.png" });
  n = 0; await p.click("#s-ai-go"); await p.waitForSelector("#s-ai .dbr-lead", { timeout: 10000 });
  assert.ok(n >= 1 && n <= 2, "answer (+ a plan for thin results)"); assert.match(await p.textContent("#s-ai"), /النخبة/);
  assert.equal(await p.locator("#s-ai [data-cite]").count(), 1);
  if (process.env.SHOT) await p.locator("#s-ai").screenshot({ path: process.env.SHOT + "-ans.png" });
  await p.click("#s-ai [data-fq]"); await p.waitForFunction(() => decodeURIComponent(location.hash).includes("بالرياض"), null, { timeout: 8000 });
  await p.waitForSelector("#s-ai .dbr-lead, #s-ai p", { timeout: 10000 });
  await p.evaluate(() => { location.hash = "#/search/" + encodeURIComponent("وش أفضل محمصة بجدة؟"); });
  await p.waitForSelector("#s-ai-go"); await p.click("#s-ai-go"); await p.waitForSelector("#s-ai [data-cite]");
  await p.click("#s-ai [data-cite]"); await p.waitForFunction((id) => location.hash === "#/post/" + id, pid, { timeout: 8000 });
});

test("keyword query → only the small «اسأل الذكاء» button; no page errors", async () => {
  await p.evaluate(() => { location.hash = "#/search/" + encodeURIComponent("محمصة"); });
  await p.waitForSelector("#s-ai.s-ai-mini #s-ai-go", { timeout: 15000 });
  assert.match(await p.textContent("#s-ai-go"), /اسأل الذكاء عن «محمصة»/);
  assert.deepEqual(errors, []);
});
