/* i18n-moderation-ltr: v2.59 moderation v2 tabs, automod v2 and #/cappeal render in English (LTR) with no stray Arabic UI
 * text (user content excluded), Arabic stays the source in RTL; screenshots 1440 LTR + 390 RTL. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS || "";
let S, own, mem, cid; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(600); };
const page = async (opts, who) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(who + ": " + e.message)); return p; };
/* Arabic UI strings left in #view (skips user content, names and the community's own text) */
const leftovers = (p) => p.evaluate(() => {
  const AR = /[\u0600-\u06FF]/, SKIP = ".body,.cbody,textarea,input,select,[data-noi18n],.bio,bdi,.page-head .sub,.ca-cname,.mq-text,.ap-q,.m-log-row .why";
  const out = new Set(); const w = document.createTreeWalker(document.querySelector("#view"), NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (AR.test(n.nodeValue) && !n.parentElement.closest(SKIP) && n.parentElement.offsetParent !== null) out.add(n.nodeValue.trim());
  return [...out];
});
const shot = async (p, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); };

test.before(async () => {
  S = await startStack();
  own = await page(DESKTOP, "owner"); await onboard(own, S.base, "ltr_owner", "مالكة المجتمع");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع الترجمة", desc: "مجتمع لاختبار الواجهة باتجاه اليسار.", rules: ["الاحترام"] })).community.id;
  mem = await page(MOBILE, "member"); await onboard(mem, S.base, "ltr_mem", "عضوة المجتمع"); await call(mem, "PUT", `/api/communities/${cid}/membership`);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, []); });

test("LTR (en): moderation tabs, automod and #/cappeal show no untranslated UI strings", async () => {
  await own.evaluate(() => window.MPI18n?.setLang("en")); await go(own, `#/cadmin/${cid}?s=moderation`); await until(own, () => document.documentElement.dir === "ltr");
  const report = {};
  for (const [t, name] of [["", "queue"], ["&t=appeals", "appeals"], ["&t=macros", "macros"], ["&t=log", "log"], ["&t=alerts", "alerts"]]) { await go(own, `#/cadmin/${cid}?s=moderation${t}`); report[name] = await leftovers(own); await shot(own, "1440-ltr-mod-" + name); }
  await go(own, `#/cadmin/${cid}?s=automod`); report.automod = await leftovers(own); await shot(own, "1440-ltr-automod");
  /* i18n-select-template: <option> text is translated in LTR (values untouched); show a select's list for the screenshot */
  report.options = await own.evaluate(() => {
    const sel = [...document.querySelectorAll("#view select")].find((x) => !x.closest("[data-noi18n]") && x.options.length > 1);
    if (!sel) return ["(no select)"];
    const ladder = sel.closest(".am-ladder"); if (ladder) ladder.hidden = false;
    sel.hidden = false; sel.size = Math.min(sel.options.length, 6); sel.scrollIntoView({ block: "center" }); sel.focus();
    return [...sel.options].filter((o) => /[\u0600-\u06FF]/.test(o.textContent)).map((o) => o.textContent.trim());
  });
  await own.waitForTimeout(300); await shot(own, "1440-ltr-automod-select");
  await own.evaluate(() => { const sel = document.activeElement; if (sel?.tagName === "SELECT") { sel.removeAttribute("size"); sel.blur(); } });
  await own.evaluate(() => { window.MPCommunities?.ask({ title: "حذف المحتوى المبلَّغ عنه؟", ok: "حذف", danger: true, icon: "trash", input: "السبب (يظهر في سجل الإشراف)", text: "يستطيع صاحب المحتوى تقديم استئناف." }); }); // don't await the sheet's promise (it resolves only on a user choice)
  await own.waitForSelector("#sheet:not(.hidden)"); await own.waitForTimeout(500);
  report.sheet = await own.evaluate(() => [...document.querySelectorAll("#sheet *")].flatMap((e) => [...e.childNodes].filter((n) => n.nodeType === 3 && /[\u0600-\u06FF]/.test(n.nodeValue)).map((n) => n.nodeValue.trim())));
  await shot(own, "1440-ltr-action-sheet"); await own.keyboard.press("Escape");
  await mem.evaluate(() => window.MPI18n?.setLang("en")); await go(mem, `#/cappeal/${cid}`); report.cappeal = await leftovers(mem);
  fs.writeFileSync(path.join(SHOTS || ".", "ltr-leftovers.json"), JSON.stringify(report, null, 1));
  const total = Object.values(report).flat().length; console.log("LTR leftovers:", total, JSON.stringify(report));
  assert.ok(!report.queue.includes("الطابور") && !report.automod.includes("سُلَّم العقوبات") && !report.cappeal.includes("قراراتي والاستئناف") && report.options.length === 0, "key v2.59 strings are translated: " + JSON.stringify(report));
});

test("RTL (ar) unchanged: 390 screenshots", async () => {
  await mem.evaluate(() => window.MPI18n?.setLang("ar")); await go(mem, `#/cappeal/${cid}`); await until(mem, () => document.documentElement.dir === "rtl");
  assert.match(await mem.textContent("#view .page-head h2"), /قراراتي والاستئناف/); await shot(mem, "390-rtl-cappeal");
  await own.evaluate(() => window.MPI18n?.setLang("ar")); await own.setViewportSize({ width: 390, height: 844 });
  await go(own, `#/cadmin/${cid}?s=moderation`); assert.match(await own.textContent("#view"), /الطابور/); await shot(own, "390-rtl-mod-queue");
  await go(own, `#/cadmin/${cid}?s=automod`); await shot(own, "390-rtl-automod");
});
