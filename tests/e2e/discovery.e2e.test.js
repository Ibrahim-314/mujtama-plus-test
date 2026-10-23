/* Track 5 — discovery journeys in a real browser (production build, lazily loaded discovery chunk), on a
 * small realistic Arabic world (tests/e2e/discovery-seed.js): smarter feed, search, explore/trends/topics,
 * collections, AI thread summaries, and an axe audit of every discovery screen with real content. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
let S, P, W; const errors = [];
const call = (method, path, body) => P.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [method, path, body]);
const go = async (hash, sel) => { await P.goto(S.base + "/?nosw" + hash); if (sel) await P.waitForSelector(sel); };
const cardIds = () => P.$$eval(".wrap > .post-card", cs => cs.map(c => c.querySelector("[data-more]")?.dataset.more));
const openMenu = async (pid) => { await P.click(`.post-card [data-more="${pid}"]`); await P.waitForSelector("#sheet .menu"); };
/* poll with evaluate: waitForFunction evals a string in-page, which the app's strict CSP correctly forbids */
const until = async (fn, arg, timeout = 8000) => { const end = Date.now() + timeout; for (;;) { if (await P.evaluate(fn, arg)) return; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 120)); await P.waitForTimeout(100); } };
const sheetButton = (label) => P.locator("#sheet .menu button", { hasText: label }).first();

test.before(async () => {
  S = await startStack();
  const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); P = await c.newPage();
  P.on("pageerror", e => errors.push(e.message));
  await onboard(P, S.base, "noura_disc", "نورة");
  W = await seedDiscovery(S.app.ctx, P);
  await P.evaluate(() => refresh());
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("feed: server-ranked «لك» with new-first and the caught-up marker; chronological tab; why-am-I-seeing-this; less of this", async () => {
  await go("#/home", "#d-tabedit");
  assert.ok(await P.evaluate(() => Object.keys(window.__CHUNKS || {}).includes("discovery")), "discovery code is a separate chunk");
  assert.equal(await P.getAttribute('.tabs [data-mode="for"]', "aria-pressed"), "true");
  await P.waitForSelector(".d-caught", { timeout: 8000 });
  assert.match(await P.textContent(".d-caught"), /وصلت لآخر الجديد/);
  // every card above the marker is newer than the last visit, every card below is older
  const split = await P.evaluate(() => { const seen = Date.parse(MPDiscovery.state().FD.prefs.seenAt); const out = { above: [], below: [] }; let after = false;
    for (const el of document.querySelectorAll(".wrap > .post-card, .wrap > .d-caught")) { if (el.classList.contains("d-caught")) { after = true; continue; } const p = S.post(el.querySelector("[data-more]").dataset.more); (after ? out.below : out.above).push(Date.parse(p.createdAt) > seen); }
    return out; });
  assert.ok(split.above.length && split.above.every(Boolean), "new posts first");
  assert.ok(split.below.length && split.below.every(x => !x), "older posts after the marker");
  // the digest card («فاتك اليوم») with an AI label
  await P.waitForSelector(".d-digest", { timeout: 8000 });
  assert.match(await P.textContent(".d-digest .d-ai"), /مولّد آلياً/);

  // chronological tab: strictly newest first
  await P.click('.tabs [data-mode="chrono"]'); await P.waitForSelector('.tabs [data-mode="chrono"][aria-pressed="true"]');
  await until(() => document.querySelectorAll(".wrap > .post-card").length >= 3);
  const times = await P.evaluate(() => [...document.querySelectorAll(".wrap > .post-card")].map(c => Date.parse(S.post(c.querySelector("[data-more]").dataset.more).createdAt)));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "chronological order");

  // «لماذا أرى هذا؟»: weighted factors and the more/less controls
  await P.click('.tabs [data-mode="for"]'); await P.waitForSelector('.tabs [data-mode="for"][aria-pressed="true"]');
  const first = (await cardIds())[0];
  await openMenu(first); await sheetButton("لماذا أرى هذا").click();
  await P.waitForSelector(".d-why-row");
  assert.ok((await P.$$(".d-why-row")).length >= 2, "several weighted factors");
  assert.match(await P.textContent(".d-why-row b"), /^[+-]?\d/);
  assert.ok((await P.$$(".d-ctrls [data-ctl]")).length >= 2, "more/less controls in the sheet");
  await P.evaluate(() => closeSheet());

  // «أقل من هذا» hides the post and is recorded (and listed on the feed settings page)
  const victim = W.posts.jed3; await go("#/home", "#d-tabedit");
  await until((id) => !!document.querySelector(`.post-card [data-more="${id}"]`), victim).catch(() => {});
  if (await P.$(`.post-card [data-more="${victim}"]`)) { await openMenu(victim); await sheetButton("أقل من هذا").click(); }
  else await call("POST", "/api/feed/feedback", { post: victim, signal: "less" });
  await until((id) => !document.querySelector(`.post-card [data-more="${id}"]`), victim);
  const fb = await call("GET", "/api/feed/feedback");
  assert.ok(fb.feedback.some(f => f.kind === "post" && f.target === victim && f.weight < 0));
  assert.ok(!(await call("GET", "/api/feed?mode=for&limit=50")).posts.some(p => p.id === victim), "gone from the ranked feed");
  await go("#/feedprefs", "#fp-chrono");
  assert.match(await P.textContent(".wrap"), /أقل من منشور/);
});

test("search: Arabic normalisation, typeahead listbox, grouped results, type and language filters", async () => {
  await go("#/search", "#sq2");
  // typeahead: keyboard-navigable listbox
  await P.fill("#sq2", "نماذج"); await P.waitForSelector(".s-sugg:not([hidden]) .s-opt");
  assert.equal(await P.getAttribute("#sq2", "aria-expanded"), "true");
  await P.keyboard.press("ArrowDown");
  assert.equal(await P.getAttribute("#sq2", "aria-activedescendant"), "so-0");
  assert.equal(await P.getAttribute("#so-0", "aria-selected"), "true");
  await P.keyboard.press("Escape");
  // normalisation: no hamza and taa marbuta written as haa still find «الإصلاح» and «ورشة جدة»
  await P.fill("#sq2", "الاصلاح"); await P.keyboard.press("Enter");
  await P.waitForSelector("#s-body .s-sec");
  assert.ok(await P.$(`#s-body .post-card [data-more="${W.posts.dev1}"]`), "hamza-insensitive");
  await P.fill("#sq2", "ورشه جده"); await P.keyboard.press("Enter");
  await until((t) => (document.querySelector("#s-body")?.textContent || "").includes(t), "ورشة");
  const groups = await P.$$eval("#s-body .s-sec h3", hs => hs.map(h => h.firstChild.textContent.trim()));
  assert.ok(groups.includes("المنشورات"), "grouped results: " + groups.join("، "));
  assert.equal(P.url().split("#")[1], "/search/" + encodeURIComponent("ورشه جده"), "query lives in the URL");
  // type filter: people only
  await P.fill("#sq2", "خالد"); await P.keyboard.press("Enter"); await P.waitForSelector("#s-body .s-sec");
  await P.click('[data-type="people"]'); await P.waitForSelector('[data-type="people"][aria-pressed="true"]');
  await until((t) => !!document.querySelector("#s-body .s-sec") && [...document.querySelectorAll("#s-body .s-sec h3")].every(h => h.textContent.includes(t)), "الأشخاص");
  assert.match(await P.textContent("#s-body"), /خالد العتيبي/);
  // language filter: English only → a friendly empty state
  await P.click('[data-type="all"]'); await P.fill("#sq2", "الاصلاح"); await P.keyboard.press("Enter"); await P.waitForSelector(`#s-body .post-card [data-more="${W.posts.dev1}"]`);
  await P.selectOption("#s-lang", "en");
  await P.waitForSelector("#s-body .empty"); assert.match(await P.textContent("#s-body .empty"), /لا نتائج/);
  await P.selectOption("#s-lang", "");
  // clear button resets to the landing screen (history + trending)
  await P.click("#s-clear"); await until((t) => (document.querySelector("#s-body")?.textContent || "").includes(t), "عمليات بحثك الأخيرة");
  assert.equal(await P.evaluate(() => document.activeElement.id), "sq2", "focus returns to the field");
});

test("explore: magazine page with location trends and AI summary; hashtag page follow; topic page follow", async () => {
  await go("#/explore", ".x-hero");
  assert.ok((await P.$$(".x-topic")).length >= 4, "coloured topic cards");
  assert.ok((await P.$$(".x-locs [data-sc]")).length >= 2, "global + places");
  const city = await P.$('.x-locs [data-sc="city"][data-k="جدة"]');
  if (city) { await city.click(); await P.waitForSelector('.x-locs [data-k="جدة"][aria-pressed="true"]'); await P.waitForSelector(".x-hero, .discover"); }
  // hashtag page: summary + follow
  await go("#/tag/" + encodeURIComponent("ورشة_جدة"), "#tg-f");
  assert.match(await P.textContent(".tp-head h2"), /#ورشة_جدة/);
  if (await P.$(".d-sum")) assert.match(await P.textContent(".d-sum .d-ai"), /مولّد آلياً/);
  const was = await P.getAttribute("#tg-f", "aria-pressed");
  await P.click("#tg-f"); await until((w) => document.querySelector("#tg-f").getAttribute("aria-pressed") !== w, was);
  assert.ok((await call("GET", "/api/follows/topics")).tags.includes("ورشة_جدة"), "hashtag followed");
  // topic page: curated header, notable voices that actually paint, follow
  await go("#/topic/design", "#tp-f");
  assert.equal(await P.getAttribute("#tp-f", "aria-pressed"), "false");
  await P.click("#tp-f"); await P.waitForSelector('#tp-f[aria-pressed="true"]');
  assert.ok((await call("GET", "/api/follows/topics")).topics.includes("design"), "topic followed");
  await go("#/topic/ai"); await until((t) => (document.querySelector(".tp-head h2")?.textContent || "").includes(t), "الذكاء الاصطناعي");
  const voices = await P.$$eval(".wrap > .card.row", cs => cs.map(c => ({ op: getComputedStyle(c).opacity, h: c.offsetHeight })));
  assert.ok(voices.length && voices.every(v => v.op === "1" && v.h > 40), "«أصوات بارزة» rows are painted");
});

test("collections: grid, create, private note, move between folders, share without the note", async () => {
  await go("#/library", ".col-tile[data-id]");
  const before = (await P.$$(".col-tile[data-id]")).length;
  assert.ok(await P.$(".col-tile[data-id] .col-meta .d-grip"), "drag handle sits in the meta row");
  assert.ok(await P.$(".col-tile[data-id] .col-mosaic"), "image mosaic");
  await P.click("#col-new"); await P.waitForSelector("#nc-name");
  await P.fill("#nc-name", "مراجع التصميم"); await P.click("#nc-go");
  await until((n) => document.querySelectorAll(".col-tile[data-id]").length === n + 1, before);
  assert.match(await P.textContent("#col-grid"), /مراجع التصميم/);

  await go("#/collection/" + W.collection, ".ci");
  const pid = W.posts.dev1;
  await P.click(`[data-note="${W.collection}|${pid}"]`); await P.waitForSelector("#nt");
  await P.fill("#nt", "أرسلها لفريق الواجهات"); await P.click("#nt-go");
  await until(([id, t]) => (document.querySelector(`.ci[data-id="${id}"] .ci-note`)?.textContent || "").includes(t), [pid, "أرسلها لفريق الواجهات"]);
  // move to «أفكار لمشروعي»
  const ideas = W.collections[2];
  await P.click(`[data-mv="${W.collection}|${W.posts.ai3}"]`); await P.waitForSelector(`#sheet [data-to="${ideas}"]`);
  await P.click(`#sheet [data-to="${ideas}"]`);
  await until((id) => !document.querySelector(`.ci[data-id="${id}"]`), W.posts.ai3);
  const sync = await call("GET", "/api/collections/sync");
  assert.ok(sync.items.some(i => i.collection === ideas && i.postId === W.posts.ai3), "moved on the server");
  assert.ok(sync.items.some(i => i.collection === W.collection && i.postId === pid && i.note === "أرسلها لفريق الواجهات"), "note saved");
  // share: link sheet, the public page omits private notes
  await P.click("#cv-share"); await P.waitForSelector("#sh-url");
  const url = await P.inputValue("#sh-url"); assert.match(url, /\/#\/sc\/[\w-]+$/);
  await P.evaluate(() => closeSheet());
  await go("#/sc/" + url.split("/sc/")[1]); await until((t) => (document.querySelector("#view")?.textContent || "").includes(t), "مجموعة مشتركة من");
  const shared = await P.textContent("#view");
  assert.match(shared, /مجموعة مشتركة من/);
  assert.ok(!/أرسلها لفريق الواجهات|أطبّق الطريقة الثانية/.test(shared), "private notes are never shared");
});

test("thread summary: card on top of a long discussion, labelled AI-generated, citations jump to the source", async () => {
  await go("#/post/" + W.discussion, ".d-sum .d-points");
  const box = ".d-sum";
  assert.match(await P.textContent(`${box} .d-ai`), /مولّد آلياً/);
  assert.match(await P.textContent(box), /قد يغفل تفاصيل/);
  const pts = await P.$$eval(`${box} .d-points li`, ls => ls.map(l => l.firstChild.textContent.trim()));
  assert.ok(pts.length >= 2 && pts.length <= 5, "a few bullet points");
  assert.ok(!pts.includes("العمل عن بعد في الشركات الناشئة"), "the title is not summarised as a claim");
  const cites = await P.$$eval(`${box} .d-cite`, bs => bs.map(b => ({ id: b.dataset.cite, kind: b.dataset.kind, label: b.getAttribute("aria-label") })));
  assert.ok(cites.length >= pts.length && cites.every(c => c.id && /المصدر/.test(c.label)), "every point cites a source");
  const comment = cites.find(c => c.kind === "comment");
  assert.ok(comment, "comments are cited");
  await P.click(`${box} .d-cite[data-cite="${comment.id}"]`);
  await P.waitForSelector(".comment.d-flash");
  const api = await call("GET", `/api/posts/${W.discussion}/summary`);
  assert.equal(api.summary.ai, true); assert.equal(api.summary.provider, "extractive");
});

test("accessibility: discovery screens with real content have no serious/critical WCAG A/AA violations", async () => {
  const report = {};
  for (const r of ["#/home", "#/search", "#/search/" + encodeURIComponent("نماذج"), "#/explore", "#/topic/ai", "#/tag/" + encodeURIComponent("ورشة_جدة"), "#/library", "#/collection/" + W.collection, "#/digest", "#/feedprefs", "#/post/" + W.discussion]) {
    await go(r); await P.waitForTimeout(800);
    await P.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    report[r] = (await P.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length }))))
      .filter(v => ["serious", "critical"].includes(v.impact));
  }
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
