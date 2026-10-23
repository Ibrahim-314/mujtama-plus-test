/* global MPEditor, openComposer, moreMenu */
/* v2.50 — the two editors on one core: the simple community editor and the creative general editor.
 * Every entry point routes to the right mode (FAB, community page, quote, edit, drafts resume); poll / question / event /
 * thread publish from the general editor (no more bounce to the old bottom-sheet editor); community rules respected. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, P, cid; const errors = [];
const call = (p, method, path, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [method, path, body]);
const page = async () => { const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const until = async (fn, timeout = 12000) => { const end = Date.now() + timeout; for (;;) { const v = await fn().catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out: " + fn.toString().slice(0, 120)); await new Promise(r => setTimeout(r, 100)); } };
const row = (sql, args) => until(() => S.app.ctx.db.get(sql, args));
const data = (r) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data) || {};
const local = (ms) => { const d = new Date(Date.now() + ms); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); };
async function axeOn(p, sel) {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (await p.evaluate(async (s) => (await axe.run(document.querySelector(s), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, sel: v.nodes[0]?.target?.join(" ") })), sel)).filter(v => ["serious", "critical"].includes(v.impact));
}
const fab = async () => { await P.evaluate(() => { location.hash = "#/home"; }); await P.click("#fab"); await P.waitForSelector("#composer3[data-mode=general]"); };
const published = async (p = P) => { try { await p.waitForSelector("#composer3", { state: "detached", timeout: 10000 }); } catch (e) { throw new Error("editor still open: " + (await p.textContent("#c3-err").catch(() => "")) + " | " + e.message.split("\n")[0]); } };

test.before(async () => {
  S = await startStack(); P = await page();
  await onboard(P, S.base, "ed_owner", "صاحبة المحرر");
  cid = (await call(P, "POST", "/api/communities", { name: "مجتمع المحررين", desc: "نكتب معاً", topic: "dev", rules: ["الاحترام أولاً", "لا روابط مزعجة"] })).community.id;
  await P.evaluate(() => refresh());
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("FAB → creative general editor: every type in one editor, poll publishes without the old sheet, axe clean", async () => {
  await fab();
  assert.equal(await P.$$eval("#composer3 [data-t]", b => b.length), 10, "all post types");
  assert.equal(await P.$("#composer3 .c3-chead"), null, "no community header in the general editor");
  assert.ok(await P.$("#composer3 #c3-opts"), "publishing options");
  assert.deepEqual(await axeOn(P, "#composer3"), []);
  await P.click('[data-t="poll"]');
  assert.equal(await P.$("#sheet:not(.hidden) textarea"), null, "the legacy bottom-sheet editor is gone");
  await P.fill("#c3-text", "أي لغة تفضّل للبدء؟"); await P.fill('[data-po="0"]', "جافاسكربت"); await P.fill('[data-po="1"]', "بايثون");
  await P.click("#c3-po-add"); await P.fill('[data-po="2"]', "جافاسكربت"); await P.click("#c3-pub");
  assert.match(await P.textContent("#c3-err"), /مكررة/, "core validation shown inline"); await P.fill('[data-po="2"]', "روست");
  await P.click("#c3-pub"); await published();
  const r = await row("SELECT type, community, data FROM posts WHERE text=$1", ["أي لغة تفضّل للبدء؟"]);
  assert.equal(r.type, "poll"); assert.equal(r.community, null); assert.deepEqual(data(r).poll.options.map(o => o.t), ["جافاسكربت", "بايثون", "روست"]);
});

test("general editor: question, event (creates the event) and thread (numbered series) through the core plan", async () => {
  await fab(); await P.click('[data-t="question"]'); await P.fill("#c3-title", "كيف أبدأ مع Pi SDK؟"); await P.fill("#c3-text", "جربت المثال الرسمي");
  await P.click("#c3-pub"); await published();
  assert.equal((await row("SELECT type FROM posts WHERE title=$1", ["كيف أبدأ مع Pi SDK؟"])).type, "question");

  await fab(); await P.click('[data-t="event"]'); await P.fill("#c3-evn", "لقاء مطوري جدة"); await P.fill("#c3-evt", local(2 * 864e5)); await P.fill("#c3-evp", "جدة");
  await P.click("#c3-pub"); await published();
  const ev = await row("SELECT id, place FROM events WHERE name=$1", ["لقاء مطوري جدة"]); assert.equal(ev.place, "جدة");
  assert.equal(data(await row("SELECT data FROM posts WHERE type='event' AND author=(SELECT id FROM users WHERE handle='ed_owner')")).event, ev.id);

  await fab(); await P.click('[data-t="thread"]'); await P.fill("#c3-text", "سلسلة: دروس من أول تطبيق"); await P.fill('[data-pt="0"]', "الدرس الثاني: ابدأ صغيراً");
  await P.click("#c3-pub"); await published();
  const t1 = await row("SELECT series, part, parts FROM posts WHERE text=$1", ["سلسلة: دروس من أول تطبيق"]);
  const t2 = await row("SELECT series, part FROM posts WHERE text=$1", ["الدرس الثاني: ابدأ صغيراً"]);
  assert.equal(t1.series, t2.series); assert.deepEqual([t1.part, t1.parts, t2.part], [1, 2, 2]);
});

test("community page → simple community editor: community fixed, minimal tools, poll posted into the community", async () => {
  await P.evaluate((id) => { location.hash = "#/c/" + id; }, cid); await P.waitForSelector("#c-compose", { timeout: 15000 });
  await P.click("#c-compose"); await P.waitForSelector("#composer3[data-mode=community]");
  assert.match(await P.textContent("#composer3 .c3-cinfo"), /مجتمع المحررين/);
  assert.equal(await P.$("#composer3 [data-t]"), null, "no type picker"); assert.equal(await P.$("#composer3 #c3-opts"), null, "no publishing options");
  assert.equal(await P.$$eval("#composer3 .c3-act", b => b.length), 4, "image · video (v2.60 M1) · poll · question");
  assert.ok(await P.$("#composer3 .c3-rules"), "community rules at hand");
  assert.deepEqual(await axeOn(P, "#composer3"), []);
  await P.click('[data-act="poll"]'); await P.fill("#c3-text", "متى نلتقي هذا الشهر؟"); await P.fill('[data-po="0"]', "الخميس"); await P.fill('[data-po="1"]', "السبت");
  await P.click("#c3-pub"); await published();
  const r = await row("SELECT type, community FROM posts WHERE text=$1", ["متى نلتقي هذا الشهر؟"]);
  assert.deepEqual([r.type, r.community], ["poll", cid]);
  await P.waitForSelector(`#c-feed :text("متى نلتقي هذا الشهر؟")`, { timeout: 8000 });
});

test("community with approval: a member's editor says «إرسال للمراجعة» and the post waits for moderators", async () => {
  await call(P, "PATCH", "/api/communities/" + cid, { requireApproval: true });
  const M = await page(); await onboard(M, S.base, "ed_member", "عضو المحرر");
  await call(M, "PUT", `/api/communities/${cid}/membership`); await M.evaluate(() => refresh());
  await M.evaluate((id) => { location.hash = "#/c/" + id; }, cid); await M.waitForSelector("#c-compose", { timeout: 15000 });
  await M.click("#c-compose"); await M.waitForSelector("#composer3[data-mode=community]");
  assert.equal((await M.textContent("#c3-pub")).trim(), "إرسال للمراجعة");
  await M.fill("#c3-text", "منشوري الأول في المجتمع"); await M.click("#c3-pub"); await M.waitForSelector("#composer3", { state: "detached" });
  assert.equal((await row("SELECT status FROM posts WHERE text=$1", ["منشوري الأول في المجتمع"])).status, "pending");
  await call(P, "PATCH", "/api/communities/" + cid, { requireApproval: false });
  await M.context().close();
});

test("drafts: closing the community editor keeps a draft that resumes in the same editor from #/drafts", async () => {
  await P.evaluate((id) => { location.hash = "#/c/" + id; }, cid); await P.waitForSelector("#c-compose", { timeout: 15000 });
  await P.click("#c-compose"); await P.waitForSelector("#composer3[data-mode=community]");
  await P.fill("#c3-text", "مسودة للمجتمع لم تكتمل"); await P.click("#c3-x"); await P.waitForSelector("#composer3", { state: "detached" });
  const d = await until(async () => (await call(P, "GET", "/api/drafts")).drafts.find(x => x.data.markdown === "مسودة للمجتمع لم تكتمل"));
  assert.equal(d.data.x.community, cid); assert.equal(d.data.x.mode, "community");
  await P.evaluate(() => { location.hash = "#/drafts"; }); await P.waitForSelector(`li[data-d="${d.id}"] [data-go]`, { timeout: 15000 });
  await P.click(`li[data-d="${d.id}"] [data-go]`); await P.waitForSelector("#composer3[data-mode=community]");
  assert.equal(await P.inputValue("#c3-text"), "مسودة للمجتمع لم تكتمل");
  await P.evaluate(() => MPEditor.current.close(true)); await call(P, "DELETE", "/api/drafts/" + d.id);
});

test("quote opens the general editor in quote mode; «تعديل» opens the edit editor and saves the text", async () => {
  const pid = (await row("SELECT id FROM posts WHERE text=$1", ["أي لغة تفضّل للبدء؟"])).id;
  const Q = await page(); await onboard(Q, S.base, "ed_quoter", "مقتبس"); // a second author: the first one is at the posts-per-minute limit
  await Q.evaluate(() => refresh());
  await Q.evaluate((id) => openComposer({ quoteOf: id }), pid); await Q.waitForSelector("#composer3[data-mode=general] .c3-quote");
  assert.equal(await Q.$("#composer3 [data-t]"), null, "a quote is a post: no type picker");
  await Q.fill("#c3-text", "سؤال ممتاز، صوّتوا!"); await Q.click("#c3-pub"); await published(Q);
  const mine = (await row("SELECT id, quote_of FROM posts WHERE text=$1", ["سؤال ممتاز، صوّتوا!"]));
  assert.equal(mine.quote_of, pid);
  await Q.evaluate(() => refresh()); await Q.evaluate((id) => moreMenu(id), mine.id); await Q.click('#sheet [data-a="edit"]');
  await Q.waitForSelector("#composer3[data-mode=edit]"); assert.equal(await Q.inputValue("#c3-text"), "سؤال ممتاز، صوّتوا!");
  await Q.fill("#c3-text", "سؤال ممتاز، صوّتوا الآن!"); await Q.click("#c3-pub"); await published(Q);
  await row("SELECT id FROM posts WHERE id=$1 AND text=$2", [mine.id, "سؤال ممتاز، صوّتوا الآن!"]);
  await Q.context().close();
});

test("one editor at a time, Escape closes, no override chain left", async () => {
  await fab(); await P.evaluate(() => openComposer({ type: "article" }));
  assert.equal(await P.$$eval("#composer3", e => e.length), 1);
  assert.equal(await P.getAttribute("#composer3", "data-type"), "article");
  await P.keyboard.press("Escape"); await P.waitForSelector("#composer3", { state: "detached" });
  assert.equal(await P.evaluate(() => typeof window.MPEditor.open === "function" && typeof window.MPComposer === "function"), true);
});

test("v2.58: the community editor follows the channel — allowed types and slow mode (the wait counts down, publish waits)", async () => {
  const ch = (await call(P, "POST", `/api/communities/${cid}/channels`, { name: "صور فقط", viewPerm: "public", allowedTypes: ["image"], slowModeSec: 60 })).channel;
  const M = await page(); await onboard(M, S.base, "ed_slow", "عضو بطيء");
  await call(M, "PUT", `/api/communities/${cid}/membership`); await M.evaluate(() => refresh());
  await M.evaluate((id) => { location.hash = "#/c/" + id; }, cid); await M.waitForSelector(`[data-ch="${ch.id}"]`, { timeout: 15000 });
  await M.click(`[data-ch="${ch.id}"]`); await M.waitForSelector(`[data-ch="${ch.id}"].on`); await M.waitForSelector(".c-chh"); assert.match(await M.textContent(".c-chh"), /الوضع البطيء/);
  await M.click("#c-compose"); await M.waitForSelector("#composer3[data-mode=community]");
  assert.equal(await M.inputValue("#c3-ch"), ch.id);
  assert.deepEqual(await M.$$eval("#composer3 .c3-act", (b) => b.map((x) => [x.dataset.act, x.hidden])), [["img", false], ["video", true], ["poll", true], ["question", true]], "only pictures besides text (no video either)");
  assert.deepEqual(await M.$$eval("#composer3 .c3-act", (b) => b.map((x) => [x.dataset.act, x.getClientRects().length > 0])), [["img", true], ["video", false], ["poll", false], ["question", false]], "the hidden types are really not on screen");
  await M.waitForSelector("#c3-slow:not([hidden])"); assert.match(await M.textContent("#c3-slow"), /منشور (واحد )?كل/);
  await M.selectOption("#c3-ch", ""); assert.equal(await M.$eval('[data-act="poll"]', (b) => b.hidden), false, "another channel: every type again"); assert.equal(await M.$eval('[data-act="poll"]', (b) => b.getClientRects().length > 0), true, "and on screen");
  await M.selectOption("#c3-ch", ch.id);
  await M.fill("#c3-text", "أول صورة في القناة البطيئة (نص)"); await M.click("#c3-pub"); await published(M);
  await M.waitForSelector("#c-compose"); await M.click(`[data-ch="${ch.id}"]`); await M.waitForSelector(`[data-ch="${ch.id}"].on`);
  await M.click("#c-compose"); await M.waitForSelector("#composer3[data-mode=community]");
  await M.waitForFunction(() => { const w = document.querySelector("#c3-slow .c3-wait"); return w && !w.hidden && /^\d+:\d\d$/.test(w.textContent) && /يمكنك النشر بعد/.test(document.querySelector("#c3-pub")?.title || ""); }); // v2.59: mm:ss chip + the reason on the button
  assert.equal(await M.$eval("#c3-pub", (b) => b.disabled), true, "publish waits for the slow mode");
  await M.keyboard.press("Escape"); await M.context().close();
});

