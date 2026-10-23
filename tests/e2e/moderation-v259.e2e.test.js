/* v2.59.0 «المجتمع 3.0» stage 4 — moderation v2 + automod v2 in a real browser: the queue inside the panel (filters,
 * claim, keyboard shortcuts J/K/A/R/C/?, bulk with the unified action sheet), appeals decided by the owner, saved
 * replies, the legacy log + CSV link, moderator alerts; the automod section (presets fill the form but save nothing,
 * enable a rule + save, «جرّب القاعدة»); a member's appeal page; a pending comment is not shown; no prompt()/confirm()
 * anywhere in the flows; the community composer (slow-mode note + countdown, no empty note); axe (no serious/critical)
 * on the new screens at 390 light, 1440 dark and LTR. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
let S, cid, own, mod, mem, memId; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(200); };
const sheetBtn = async (p, sel) => { await p.waitForSelector("#sheet:not(.hidden) " + sel, { timeout: 8000 }); await p.click("#sheet:not(.hidden) " + sel); };
async function axe(p) {
  await p.evaluate(() => document.querySelectorAll("#nf-toasts .nf-toast .x").forEach((x) => x.click()));
  await p.waitForFunction(() => !document.querySelector("#nf-toasts .nf-toast"), null, { timeout: 5000 }).catch(() => {});
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const page = async (opts = MOBILE, who = "") => {
  const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(who + ": " + e.message)); p.on("dialog", (d) => { errors.push(who + ": native dialog " + d.type() + " " + d.message()); d.dismiss().catch(() => {}); });
  return p;
};
const pend = async (p, text) => { const r = await call(p, "POST", "/api/posts", { text, community: cid }); return r.post; };

test.before(async () => {
  S = await startStack();
  own = await page(DESKTOP, "owner"); await onboard(own, S.base, "m9_owner", "مالكة المجتمع");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع الإشراف الثاني", desc: "مجتمع لاختبار الإشراف والإشراف الآلي.", rules: ["الاحترام"] })).community.id;
  mod = await page(MOBILE, "mod"); await onboard(mod, S.base, "m9_mod", "مشرف المجتمع"); await call(mod, "PUT", `/api/communities/${cid}/membership`);
  await call(own, "PATCH", `/api/communities/${cid}/members/${await meId(mod)}`, { role: "moderator" });
  S.app.ctx.rl.w?.clear?.(); mem = await page(MOBILE, "member"); await onboard(mem, S.base, "m9_mem", "عضوة المجتمع"); await call(mem, "PUT", `/api/communities/${cid}/membership`); memId = await meId(mem);
  await call(own, "PATCH", `/api/communities/${cid}/automod`, { words: ["كازينو"], toxicity: "off", v2: { words: { enabled: true, words: ["ممنوع*"] }, comments: { enabled: true } } });
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors, no native prompt/confirm"); });
test.beforeEach(() => S.app.ctx.rl.w?.clear?.());

test("queue: filters, claim, keyboard (J/K/A, ? help), reject through the action sheet with a saved reply", async () => {
  await call(own, "POST", `/api/communities/${cid}/macros`, { title: "رفض: خارج الموضوع", action: "reject", reason: "خارج موضوع المجتمع" });
  for (const t of ["عرض كازينو أول", "منشور فيه كلمة ممنوعة", "عرض كازينو ثالث"]) assert.equal((await pend(mem, t)).status, "pending");
  await go(mod, `#/cadmin/${cid}?s=moderation`); await mod.waitForSelector("#m-body .mq-item.sel");
  assert.equal(await mod.$$eval("#m-body .mq-item", (x) => x.length), 3);
  await mod.click('[data-mk="post"]'); await mod.waitForSelector('[data-mk="post"][aria-pressed="true"]'); assert.equal(await mod.$$eval(".mq-item", (x) => x.length), 3);
  await mod.click('.mq-item.sel [data-act="claim"]'); await mod.waitForSelector(".mq-item.sel .ca-badge.ok"); assert.match(await mod.textContent(".mq-item.sel"), /أنت تتولاه/);
  // keyboard: K/J move, ? opens the shortcuts sheet, A approves
  await mod.keyboard.press("j"); await until(mod, () => document.querySelector(".mq-item.sel")?.dataset.i === "1");
  await mod.keyboard.press("k"); await until(mod, () => document.querySelector(".mq-item.sel")?.dataset.i === "0");
  await mod.keyboard.press("?"); await mod.waitForSelector("#sheet:not(.hidden) .mq2-keys"); await sheetBtn(mod, '[data-ui="close-sheet"]'); await mod.waitForSelector("#sheet.hidden", { state: "attached" });
  await mod.keyboard.press("a"); await until(mod, () => document.querySelectorAll(".mq-item").length === 2, null, 8000);
  // reject: the unified action sheet (no prompt), a saved reply fills the reason
  await mod.click('.mq-item.sel [data-act="reject"]'); await mod.waitForSelector("#sheet:not(.hidden) .as #ca-ask-i");
  await sheetBtn(mod, ".as-m"); assert.equal(await mod.inputValue("#ca-ask-i"), "خارج موضوع المجتمع");
  await sheetBtn(mod, "#ca-ask-ok"); await until(mod, () => document.querySelectorAll(".mq-item").length === 1, null, 8000);
  const log = await call(own, "GET", `/api/communities/${cid}/modlog`); assert.ok(log.log.some((l) => l.action === "reject" && l.reason === "خارج موضوع المجتمع"));
});

test("bulk: select mode with checkboxes (touch-friendly), approve all, per-item result", async () => {
  for (const t of ["كازينو أ", "كازينو ب"]) await pend(mem, "عرض " + t + " " + Date.now());
  await go(mod, `#/cadmin/${cid}?s=moderation`); await mod.waitForSelector(".mq-item");
  await mod.click("#mq-selm"); await mod.waitForSelector("#mq-all"); await mod.check("#mq-all");
  await mod.waitForSelector("#mq-bulk:not([hidden])"); assert.match(await mod.textContent("#mq-bn"), /محدد/);
  await mod.click('#mq-bulk [data-bulk="approve"]'); await mod.waitForSelector("#m-body .empty", { timeout: 8000 });
  assert.equal((await call(own, "GET", `/api/communities/${cid}/modqueue/v2`)).items.filter((i) => i.kind === "post").length, 0);
});

test("a pending comment is hidden, shows in the queue as «تعليق معلّق», approve publishes it", async () => {
  const p = (await call(own, "POST", "/api/posts", { text: "منشور للتعليقات", community: cid })).post;
  const c = await call(mem, "POST", "/api/comments", { post: p.id, text: "تعليق ممنوع هنا" }); assert.equal(c.comment.status, "pending");
  assert.ok(!(await call(own, "GET", `/api/posts/${p.id}/comments`)).comments.some((x) => x.id === c.comment.id));
  await go(mod, `#/cadmin/${cid}?s=moderation`); await mod.click('[data-mk="comment"]'); await mod.waitForSelector(".mq-item .k-comment");
  await mod.click('.mq-item [data-act="approve"]'); await mod.waitForSelector("#m-body .empty", { timeout: 8000 });
  assert.ok((await call(own, "GET", `/api/posts/${p.id}/comments`)).comments.some((x) => x.id === c.comment.id));
});

test("appeal: the member's page → owner accepts in the panel → role restored", async () => {
  await call(mod, "POST", `/api/communities/${cid}/members/${memId}/discipline`, { action: "mute", hours: 24, reason: "ردود حادة" });
  await go(mem, `#/cappeal/${cid}`); await mem.waitForSelector(".ap-it [data-apx]");
  assert.match(await mem.textContent(".notice"), /مكتوم/);
  await mem.click(".ap-it [data-apx]"); await mem.waitForSelector("#sheet:not(.hidden) #ca-ask-i");
  assert.equal(await mem.$eval("#ca-ask-ok", (b) => b.disabled), true, "empty reason cannot be sent");
  await mem.fill("#ca-ask-i", "كان سوء فهم وأعتذر، لن يتكرر ذلك."); await sheetBtn(mem, "#ca-ask-ok");
  await mem.waitForSelector(".ap-st.warn"); assert.match(await mem.textContent(".ap-st"), /قيد المراجعة/);
  await go(own, `#/cadmin/${cid}?s=moderation&t=appeals`); await own.waitForSelector('.mq2-ap [data-apd="accept"]');
  await own.click('.mq2-ap [data-apd="accept"]'); await sheetBtn(own, "#ca-ask-ok"); await own.waitForSelector("#m-body .empty", { timeout: 8000 });
  assert.equal((await call(mem, "GET", `/api/communities/${cid}/appeals/mine`)).membership.role, "member");
  await go(mem, `#/c/${cid}`); await go(mem, `#/cappeal/${cid}`); await mem.waitForSelector(".ap-st.ok");
});

test("saved replies, the legacy log + CSV, moderator alerts (autosave)", async () => {
  await go(own, `#/cadmin/${cid}?s=moderation&t=macros`); await own.waitForSelector("#mc-new"); await own.waitForTimeout(400); await own.click("#mc-new"); await own.waitForSelector("#sheet:not(.hidden) #mc-t");
  await own.fill("#mc-t", "حذف وإنذار"); await own.click('#sheet label:has(input[name="mc-a"][value="remove"]) span'); await own.click('#sheet label:has(input[name="mc-p"][value="warn"]) span');
  await own.fill("#mc-r", "إساءة"); await sheetBtn(own, "#mc-go"); await own.waitForSelector('.mq2-mc:has-text("حذف وإنذار")');
  await go(own, `#/cadmin/${cid}?s=moderation&t=log`); await own.waitForSelector(".m-log-row"); assert.match(await own.textContent(".m-log"), /قبول استئناف|قبول منشور/);
  assert.ok(await own.$('a[href$="modlog?format=csv"]'));
  await go(mod, `#/cadmin/${cid}?s=moderation&t=alerts`); await mod.click('label:has(input[name="mp-d"][value="daily"]) span'); await mod.waitForSelector("#mp-st:has-text('حُفظت')");
  assert.equal((await call(mod, "GET", `/api/communities/${cid}/modprefs`)).prefs.digest, "daily");
});

test("automod section: presets fill the form (nothing saved), enable a rule + save, «جرّب القاعدة»; a moderator sees it read-only", async () => {
  await go(own, `#/cadmin/${cid}?s=automod`); await own.waitForSelector('[data-rule="invites"]');
  assert.equal(await own.$eval('[data-k="v2.invites.enabled"]', (x) => x.checked), false, "off by default");
  await own.click('[data-preset="balanced"]'); await own.waitForSelector("#ca-save:not([hidden])");
  assert.equal(await own.$eval('[data-k="v2.invites.enabled"]', (x) => x.checked), true);
  assert.equal((await call(own, "GET", `/api/communities/${cid}/automod`)).automod.v2.invites.enabled, false, "a preset saves nothing");
  await own.click('[data-ca="discard"]'); assert.equal(await own.$eval('[data-k="v2.invites.enabled"]', (x) => x.checked), false);
  await own.click('[data-rule="invites"] .am-sw'); await own.waitForSelector('[data-rule="invites"] .am-opts:not([hidden])');
  await own.click('label:has(input[name="am-invites-a"][value="reject"]) span'); await own.click('[data-ca="save"]'); await own.waitForSelector("#ca-save[hidden]", { state: "attached" });
  const am = (await call(own, "GET", `/api/communities/${cid}/automod`)).automod; assert.equal(am.v2.invites.enabled, true); assert.equal(am.v2.invites.action, "reject"); assert.deepEqual(am.words, ["كازينو"], "legacy fields kept");
  await own.waitForSelector("#am-tt"); await own.fill("#am-tt", "انضموا t.me/abc"); await own.click("#am-tgo"); await own.waitForSelector("#am-tres .am-verdict.danger"); assert.match(await own.textContent("#am-tres"), /روابط دعوة/);
  const r = await call(mem, "POST", "/api/posts", { text: "انضموا t.me/abc", community: cid }); assert.equal(r.status, 400, "the saved rule applies");
  await go(mod, `#/cadmin/${cid}?s=automod`); await mod.waitForSelector("#ca-body .ca-lock"); assert.equal(await mod.$eval('[data-k="v2.invites.enabled"]', (x) => x.disabled), true);
});

test("composer in a slow-mode channel: note with mm:ss countdown, no empty note elsewhere, nothing off-screen at 360", async () => {
  const ch = (await call(own, "POST", `/api/communities/${cid}/channels`, { name: "معرض بطيء", viewPerm: "public", slowModeSec: 600 })).channel;
  await call(mem, "POST", "/api/posts", { text: "منشور أول في المعرض", community: cid, channel: ch.id });
  await mem.setViewportSize({ width: 360, height: 740 });
  await go(mem, `#/c/${cid}`); await mem.waitForSelector("#c-compose"); await mem.click("#c-compose"); await mem.waitForSelector("#composer3 #c3-text");
  assert.equal(await mem.$eval("#c3-slow", (n) => getComputedStyle(n).display), "none", "no empty slow-mode bar");
  await mem.selectOption("#composer3 #c3-ch", ch.id); await mem.waitForSelector("#c3-slow:not([hidden]) .c3-wait");
  assert.match(await mem.textContent("#c3-slow .c3-wait"), /^\d+:\d\d$/); assert.equal(await mem.$eval("#c3-pub", (b) => b.disabled), true);
  const off = await mem.evaluate(() => [...document.querySelectorAll("#composer3 *")].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).map((n) => n.className).slice(0, 5));
  assert.deepEqual(off, [], "nothing clipped off-screen");
  for (const v of await axe(mem)) errors.push("composer axe " + v);
  await mem.click("#c3-x"); await mem.setViewportSize(MOBILE.viewport);
});

test("axe: no serious/critical on queue, appeals, macros, automod and the appeal page — 390 light, 1440 dark, LTR", async () => {
  const bad = [];
  for (const [p, tag] of [[mod, "390 light"]]) for (const t of ["", "&t=appeals", "&t=macros", "&t=alerts"]) { await go(p, `#/cadmin/${cid}?s=moderation${t}`); for (const v of await axe(p)) bad.push(tag + " mod" + t + " " + v); }
  await go(mod, `#/cadmin/${cid}?s=automod`); for (const v of await axe(mod)) bad.push("390 automod " + v);
  await go(mem, `#/cappeal/${cid}`); for (const v of await axe(mem)) bad.push("390 appeal " + v);
  const d = await page({ ...DESKTOP, colorScheme: "dark" }, "dark"); await d.goto(S.base + "/?nosw"); await d.fill("#a-handle", "m9_owner"); await d.fill("#a-pass", "secret1234"); await d.click("#a-go"); await d.waitForSelector(".bottomnav a[data-r=home]");
  for (const h of [`#/cadmin/${cid}?s=moderation`, `#/cadmin/${cid}?s=moderation&t=appeals`, `#/cadmin/${cid}?s=automod`]) { await go(d, h); for (const v of await axe(d)) bad.push("1440 dark " + h + " " + v); }
  await d.evaluate(() => window.MPI18n?.setLang("en")); await go(d, `#/cadmin/${cid}?s=moderation`); await until(d, () => document.documentElement.dir === "ltr");
  for (const h of [`#/cadmin/${cid}?s=moderation`, `#/cadmin/${cid}?s=automod`]) { await go(d, h); for (const v of await axe(d)) bad.push("LTR " + h + " " + v); }
  await d.evaluate(() => window.MPI18n?.setLang("ar")); await d.context().close();
  assert.deepEqual(bad, []);
});
