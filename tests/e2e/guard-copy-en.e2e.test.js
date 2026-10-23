/* v2.63.1 fix-guard-copy: the auto-guard card copy follows the state (off → «معطّل افتراضياً.» / «متوقف حتى تشغّله»,
 * switched on but unsaved → «يعمل بعد «حفظ التغييرات»», saved on → «يعمل الآن…»), and in English the moderator's member card
 * (role · warnings · muted until, the log label + auto-guard reason) and the community page (composer, empty feed) carry no
 * Arabic UI text; the masked words stay as data. axe 0 serious/critical on the card + sheet. Screenshots in SHOTS when set. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS || "";
let S, own, mem, cid, uid; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(500); };
const page = async (opts, who) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(who + ": " + e.message)); p.on("dialog", (d) => { errors.push(who + ": native dialog"); d.dismiss().catch(() => {}); }); return p; };
/* visible Arabic text nodes under `sel`, skipping user data (names, bdi, data-noi18n, notes) */
const leftovers = (p, sel) => p.evaluate((sel) => {
  const AR = /[\u0600-\u06FF]/, SKIP = ".body,.cbody,textarea,input,select,[data-noi18n],bdi,b,.note,.av";
  const out = new Set(), root = document.querySelector(sel); if (!root) return ["(missing " + sel + ")"];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (AR.test(n.nodeValue) && !n.parentElement.closest(SKIP) && n.parentElement.offsetParent !== null) out.add(n.nodeValue.trim());
  return [...out];
}, sel);
async function axe(p, sel) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async (sel) => (await axe.run(document.querySelector(sel) || document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id), sel);
}
const shot = async (p, name, sel) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const el = sel && (await p.$(sel)); if (el) { await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: path.join(SHOTS, name + ".png") }); } else await p.screenshot({ path: path.join(SHOTS, name + ".png") }); };
const subs = (p) => p.evaluate(() => ({ head: document.querySelector("#ag-card .ca-ch p")?.textContent.trim(), sw: document.querySelector('#ag-card [data-k="g.enabled"]')?.closest(".switch-row").querySelector("small")?.textContent.trim() }));

test.before(async () => {
  S = await startStack();
  own = await page({ ...DESKTOP, colorScheme: "dark" }, "owner"); await onboard(own, S.base, "gc_owner", "مالكة الحارس");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع النصوص", desc: "مجتمع لاختبار نصوص الحارس.", rules: ["الاحترام"] })).community.id;
  mem = await page(MOBILE, "member"); await onboard(mem, S.base, "gc_mem", "عضو الحارس"); await call(mem, "PUT", `/api/communities/${cid}/membership`);
  uid = await meId(mem);
});
test.after(async () => { await S?.close(); assert.deepEqual(errors, [], "no page errors / native dialogs"); });
test.beforeEach(() => S.app.ctx.rl.w?.clear?.());

test("guard card copy follows the state (AR source + EN), EN member card + community page have no Arabic UI text", async () => {
  // AR, off: the original copy
  await go(own, `#/cadmin/${cid}?s=automod`); await own.waitForSelector("#ag-card");
  assert.deepEqual(await subs(own), { head: "معطّل افتراضياً.", sw: "متوقف حتى تشغّله" });
  // EN, off
  await own.evaluate(() => window.MPI18n?.setLang("en")); await until(own, () => document.documentElement.dir === "ltr");
  await go(own, `#/cadmin/${cid}?s=automod`); await own.waitForSelector("#ag-card");
  assert.deepEqual(await subs(own), { head: "Off by default.", sw: "Off until you turn it on" });
  await shot(own, "guard-card-off-1440-dark-en", "#ag-card");
  // switched on, not saved yet
  await own.click('#ag-card label:has([data-k="g.enabled"])'); await until(own, () => document.querySelector('[data-k="g.enabled"]').checked);
  await until(own, () => /Runs after/.test(document.querySelector('#ag-card [data-k="g.enabled"]').closest(".switch-row").querySelector("small").textContent));
  assert.equal((await subs(own)).head, "Off by default.", "the header follows the saved state");
  await own.fill('[data-k="g.words"]', "كلمة سيئة");
  await own.click('[data-ca="save"]'); await own.waitForSelector("#ca-save[hidden]", { state: "attached" }); await own.waitForSelector("#ag-card");
  await until(own, () => /Running now/.test(document.querySelector("#ag-card .ca-ch p")?.textContent || ""));
  assert.deepEqual(await subs(own), { head: "Running now in this community.", sw: "Running now" });
  assert.deepEqual(await leftovers(own, "#ag-card .ca-ch"), []);
  assert.deepEqual(await axe(own, "#ag-card"), [], "axe on the card (1440 dark EN)");
  await shot(own, "guard-card-on-1440-dark-en", "#ag-card");
  // switched off again (unsaved) → «Stops after…»
  await own.click('#ag-card label:has([data-k="g.enabled"])');
  await until(own, () => /Stops after/.test(document.querySelector('#ag-card [data-k="g.enabled"]').closest(".switch-row").querySelector("small").textContent));
  await own.click('#ag-card label:has([data-k="g.enabled"])'); await own.evaluate(() => document.querySelector('[data-ca="discard"]')?.click());

  // P2: EN community page (no posts yet): composer prompt + empty feed are English
  await go(own, `#/c/${cid}`); await own.waitForSelector("#c-cmp");
  await until(own, () => /Write in/.test(document.querySelector("#c-cmp")?.textContent || ""));
  const feed = await own.evaluate(() => document.querySelector("#view .empty")?.textContent || "");
  assert.match(feed, /No posts/); assert.doesNotMatch(feed, /[\u0600-\u06FF]/);

  // member trips the guard → strike + mute
  const r = await call(mem, "POST", "/api/posts", { community: cid, text: "هذه كلمة سيئة" }); assert.notEqual(r.status, 200);
  // EN member card: line + log
  await own.goto(S.base + "/?nosw#/c/" + cid + "/members"); await own.waitForSelector(`[data-mem="${uid}"]`);
  await own.click(`[data-mem="${uid}"]`); await own.waitForSelector("#sheet .c-ag-ms"); await own.waitForTimeout(400);
  const sheetTxt = await own.textContent("#sheet");
  assert.match(sheetTxt, /1 warning/); assert.match(sheetTxt, /Muted until/); assert.match(sheetTxt, /Auto guard: warning/); assert.match(sheetTxt, /Auto guard: banned phrase \(/);
  assert.deepEqual(await leftovers(own, "#sheet"), [], "no Arabic UI text in the EN member card");
  assert.deepEqual(await axe(own, "#sheet"), [], "axe on the member card (1440 dark EN)");
  await shot(own, "member-card-log-1440-dark-en", "#sheet");
  // the server still stores the Arabic label + reason (backward compatible)
  const n = await call(own, "GET", `/api/communities/${cid}/members/${uid}/notes`);
  assert.ok(n.history.some((h) => h.label === "الحارس التلقائي: تحذير" && /^الحارس التلقائي: عبارة ممنوعة/.test(h.reason)));

  // AR 390 light: the saved-on copy in Arabic
  const ar = await page(MOBILE, "owner-ar"); await ar.context().addCookies(await own.context().cookies()); await ar.goto(S.base + "/?nosw");
  await until(ar, () => !!window.DB && typeof route === "function");
  await go(ar, `#/cadmin/${cid}?s=automod`); await ar.waitForSelector("#ag-card");
  await ar.evaluate(() => window.MPI18n?.setLang("ar")); await until(ar, () => document.documentElement.dir === "rtl");
  await go(ar, `#/cadmin/${cid}?s=automod`); await ar.waitForSelector("#ag-card");
  assert.deepEqual(await subs(ar), { head: "يعمل الآن في هذا المجتمع.", sw: "يعمل الآن" });
  assert.deepEqual(await axe(ar, "#ag-card"), [], "axe on the card (390 light AR)");
  await shot(ar, "guard-card-on-390-light-ar", "#ag-card");
});
