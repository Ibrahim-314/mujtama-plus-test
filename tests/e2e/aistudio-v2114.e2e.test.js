/* v2.114 «✨ مساعد الذكاء» in the creator studio — AI comes from «مركز الذكاء» (free allowance stub here, no real provider).
 * Covers: meta (titles/description/hashtags + publish into the composer), pre-publish check (score, issues, unsafe warning,
 * use improved text), translation, short-text guard, free count shown, broken model output → clear error, no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let mode = "ok";
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  const q = msgs[msgs.length - 1].content;
  if (mode === "junk") return { text: "عذراً لا أستطيع", model: "free-model" };
  if (q.includes("اقترح لها")) return { text: '```json\n{"titles":["تجربتي في مطعم جديد بجدة","أكلة لا تُنسى"],"description":"جولة سريعة في مطعم جديد.","hashtags":["#جدة","مطاعم","#أكل جدة"]}\n```', model: "free-model" };
  if (q.includes("راجع مسودة")) return { text: '{"score":62,"safe":false,"issues":[{"kind":"privacy","note":"النص فيه رقم جوال","fix":"احذف الرقم"},{"kind":"weird","note":"جملة طويلة","fix":"قسّمها"}],"improved":"جربت اليوم مطعماً جديداً في جدة."}', model: "free-model" };
  if (q.includes("ترجم")) return { text: '{"text":"I tried a new restaurant in Jeddah today."}', model: "free-model" };
  return { text: "{}", model: "free-model" };
} };
let S, ctx, p; const errors = [];
test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "sai_e2e", "منشئ تجريبي");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

const openTab = async () => {
  await p.goto(S.base + "/#/studio"); await p.waitForSelector('[data-stab="ai"]', { timeout: 15000 });
  await p.click('[data-stab="ai"]'); await p.waitForSelector("#sai-in", { timeout: 10000 });
};

test("guest gets 401 from the studio AI API", async () => {
  const r = await fetch(S.base + "/api/aihub/studio", { method: "POST", headers: { "X-Requested-With": "mujtama", "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 401);
});

test("meta: titles, description, cleaned hashtags, free count, publish opens the composer", async () => {
  await openTab();
  await p.fill("#sai-in", "جربت اليوم مطعم جديد في جدة والأكل كان رائع");
  await p.click('[data-sai="meta"]'); await p.waitForSelector(".sai-res", { timeout: 10000 });
  const t = await p.textContent("#sai-out");
  assert.match(t, /تجربتي في مطعم جديد بجدة/); assert.match(t, /جولة سريعة/);
  assert.match(t, /#مطاعم/); assert.match(t, /#أكل_جدة/);
  assert.match(t, /باقي \d+ من \d+ مجاناً اليوم/);
  await p.click("[data-compose]");
  const has = await p.waitForFunction(() => [...document.querySelectorAll("textarea, [contenteditable=true]")].some((e) => (e.value || e.textContent || "").includes("تجربتي في مطعم جديد بجدة")), null, { timeout: 10000 }).then(() => true, () => false);
  assert.ok(has, "composer opened with the suggestions");
  await p.goto(S.base + "/#/home"); await p.reload();
});

test("check: score, unsafe warning, unknown kind tolerated, use improved text", async () => {
  await openTab();
  await p.fill("#sai-in", "جربت اليوم مطعم جديد في جدة اتصلوا 0500000000");
  await p.click('[data-sai="check"]'); await p.waitForSelector(".sai-score", { timeout: 10000 });
  assert.match(await p.textContent(".sai-score"), /62\/100/);
  assert.ok(await p.isVisible(".sai-warn"));
  assert.equal(await p.locator(".sai-issue").count(), 2);
  await p.click("#sai-out [data-use]");
  assert.equal(await p.inputValue("#sai-in"), "جربت اليوم مطعماً جديداً في جدة.");
});

test("translate to English", async () => {
  await p.click('[data-sai="translate"][data-lang="en"]'); await p.waitForSelector(".sai-res", { timeout: 10000 });
  assert.match(await p.textContent("#sai-out"), /new restaurant in Jeddah/);
});

test("guards: short text and broken model output give clear messages", async () => {
  const before = await p.textContent("#sai-out");
  await p.fill("#sai-in", "ه"); await p.click('[data-sai="meta"]');
  await p.waitForTimeout(300); assert.equal(await p.textContent("#sai-out"), before, "short text sends nothing");
  mode = "junk"; await p.fill("#sai-in", "نص كافٍ للتجربة هنا");
  await p.click('[data-sai="meta"]'); await p.waitForSelector(".sai-err", { timeout: 10000 });
  assert.match(await p.textContent(".sai-err"), /لم يرجع النموذج اقتراحات مفهومة/);
  mode = "ok";
});

test("no page errors", () => assert.deepEqual(errors, []));
