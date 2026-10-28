/* v2.116 studio AI Stage 3 — weekly content ideas (from the creator's own top posts), repurpose a draft (thread / story / clip
 * script / summary), smart scheduling: the next best slot opens the composer with the time filled (nothing scheduled until
 * the creator presses «جدولة»). Free-allowance stub, no real provider. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let mode = "ok", lastAsk = "";
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  const q = (lastAsk = msgs[msgs.length - 1].content);
  if (mode === "junk") return { text: "لا", model: "free-model" };
  if (q.includes("5 أفكار منشورات")) return { text: '{"ideas":[{"title":"قهوة الصباح في جدة","hook":"جربت ٣ محامص هذا الأسبوع وهذا ترتيبي","format":"thread","why":"منشور القهوة أعلى تفاعل عندك"},{"title":"سؤال للمتابعين","hook":"وش أفضل محمصة عندكم؟","format":"weird","why":""}]}', model: "free-model" };
  if (q.includes("سلسلة من 3 إلى 6")) return { text: '{"parts":["الجزء الأول عن القهوة","الجزء الثاني","وش رأيكم؟"]}', model: "free-model" };
  if (q.includes("نص قصة قصيرة")) return { text: '{"text":"قهوة اليوم ☕ جربها!"}', model: "free-model" };
  return { text: "{}", model: "free-model" };
} };
let S, ctx, p; const errors = [];
const call = (method, url, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, url, body]);
const openTab = async () => {
  await p.goto(S.base + "/#/studio"); await p.waitForSelector('[data-stab="ai"]', { timeout: 15000 });
  await p.click('[data-stab="ai"]'); await p.waitForSelector("#sai3-time [data-sched]", { timeout: 10000 });
};
test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "sai3_owner", "منشئ المرحلة الثالثة");
  await call("POST", "/api/posts", { id: "p_sai3" + Date.now().toString(36), type: "general", text: "أفضل قهوة مختصة جربتها في جدة هذا الشهر" });
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("weekly ideas from my own posts; «اكتبها» puts the hook in the draft", async () => {
  await openTab();
  await p.click('[data-sai2="ideas"]'); await p.waitForSelector("#sai3-out .sai-idea", { timeout: 10000 });
  assert.ok(lastAsk.includes("أفضل قهوة مختصة"), "facts carry my top post");
  assert.equal(await p.locator("#sai3-out .sai-idea").count(), 2);
  assert.match(await p.textContent("#sai3-out"), /سلسلة/); assert.match(await p.textContent("#sai3-out"), /منشور/, "unknown format → post");
  await p.click("#sai3-out [data-idea] >> nth=0");
  assert.equal(await p.inputValue("#sai-in"), "جربت ٣ محامص هذا الأسبوع وهذا ترتيبي");
});

test("repurpose: thread parts with copy-all, story text with «استخدم»", async () => {
  await p.click('[data-sai="repurpose"][data-to="thread"]'); await p.waitForSelector("#sai-out .sai-res >> text=السلسلة المقترحة", { timeout: 10000 });
  assert.equal(await p.locator("#sai-out .sai-row").count(), 3); assert.ok(await p.locator("#sai-out >> text=نسخ الكل").count());
  await p.click('[data-sai="repurpose"][data-to="story"]'); await p.waitForSelector("#sai-out >> text=النسخة الجديدة", { timeout: 10000 });
  await p.click("#sai-out [data-use]"); assert.equal(await p.inputValue("#sai-in"), "قهوة اليوم ☕ جربها!");
});

test("smart time opens the composer with the slot filled, nothing scheduled yet", async () => {
  const at = await p.getAttribute("#sai3-time [data-sched]", "data-sched");
  assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:00$/); assert.ok(new Date(at) > new Date(), "slot in the future");
  await p.click("#sai3-time [data-sched]"); await p.waitForSelector("#c3-sch", { state: "attached", timeout: 10000 });
  assert.equal(await p.inputValue("#c3-sch"), at);
  const cal = await call("GET", "/api/studio/calendar"); assert.equal(cal.body.items.filter((x) => x.status === "scheduled").length, 0);
});

test("junk output → clear message; no page errors", async () => {
  mode = "junk"; await p.reload(); await openTab();
  await p.click('[data-sai2="ideas"]'); await p.waitForSelector("#sai3-out .sai-err", { timeout: 10000 }); mode = "ok";
  assert.deepEqual(errors, []);
});
