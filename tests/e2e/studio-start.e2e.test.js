/* v2.61 — creator studio «ابدأ هنا»: compact start checklist computed from existing data (profile, first post, scheduled post,
 * community, tips opt-in), dismiss + restore saved per account in localStorage, up to 3 tips from the creator's own stats
 * (best-time tip schedules at that slot), all six studio tabs + shortcuts kept, studio chip on the own profile;
 * no page errors / native dialogs; axe (no serious/critical) at 390 light, 1440 dark, LTR. Screenshots → SHOTS dir. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SG_SHOTS || "";
let S, m; const errors = [];
const call = (p, mt, u, b) => p.evaluate(async ([mt, u, b]) => { const r = await fetch(u, { method: mt, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [mt, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const studio = async (p) => { await p.evaluate(() => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = "#/home"; }); await p.waitForTimeout(150); await p.evaluate(() => { location.hash = "#/studio"; }); await until(p, () => !!document.querySelector("#st-start") && !document.querySelector("#st-body .skel") && (document.querySelector("#st-start").hidden || document.querySelector("#st-start").children.length > 0)); await p.waitForTimeout(250); };
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
const closeComposer = async (p) => { await p.keyboard.press("Escape"); await p.waitForSelector("#composer3", { state: "hidden", timeout: 5000 }).catch(async () => { await p.evaluate(() => document.getElementById("c3-x")?.click()); await p.waitForSelector("#composer3", { state: "hidden", timeout: 5000 }); }); };
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: `${SHOTS}/${name}.png` }); } };
/* stats the creator could only have after weeks of activity: answered for this page only, so the tips render deterministically */
const fakeStats = async (p) => {
  await p.route("**/api/studio/best-time**", (r) => r.fulfill({ json: { enough: true, samples: 120, best: [{ day: 2, hour: 21 }, { day: 4, hour: 20 }, { day: 5, hour: 22 }], fallback: [], grid: Array.from({ length: 7 }, () => Array(24).fill(0.2)) } }));
  await p.route("**/api/studio/overview**", async (r) => { const res = await r.fetch(); const j = await res.json(); j.totals = { ...j.totals, views: 900 }; j.deltas = { ...j.deltas, engagement: -12 }; j.top = [{ id: "p_x", title: "دليلي للمبتدئين <b>", at: Date.now(), views: 400, reactions: 30, comments: 9 }]; await r.fulfill({ json: j }); });
};

test.before(async () => {
  S = await startStack();
  m = await page(MOBILE, "creator"); await onboard(m, S.base, "sg_creator", "منشئة جديدة");
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors, no native prompt/confirm"); });
test.beforeEach(() => S.app.ctx.rl.w?.clear?.());

test("fresh creator: «ابدأ هنا» on top, 0/5, all tabs + shortcuts kept; studio reachable from the own profile and the menu", async () => {
  await studio(m); await m.waitForSelector("#st-start .sg-card");
  const order = await m.evaluate(() => { const w = document.querySelector(".studio"); const i = (s) => [...w.children].indexOf(w.querySelector(s)); return [i(".page-head"), i("#st-start"), i(":scope > .explore-shortcuts"), i(".seg")]; });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "head → start guide → shortcuts → tabs");
  assert.equal(await m.getAttribute(".sg-bar", "aria-valuenow"), "0");
  assert.equal(await m.$$eval(".sg-list .li", (x) => x.length), 5);
  assert.equal(await m.$$eval(".studio .seg [data-stab]", (x) => x.length), 7, "all seven studio tabs remain");
  assert.equal(await m.$$eval(".studio > .explore-shortcuts a", (x) => x.length), 3, "top shortcuts row kept (goals «روابطك» nav is separate)");
  assert.ok(await m.$('.sg-list [data-sg="schedule"]') && await m.$('.sg-list [data-ui="compose"]') && await m.$('.sg-list a[href="#/creator"]') && await m.$('.sg-list a[href="#/communities"]') && await m.$('.sg-list a[href="#/me"]'));
  assert.ok(await m.$eval(".sg-bar i", (i) => !i.getAttribute("style") || /width/.test(i.style.cssText)), "progress painted through CSSOM");
  const sizes = await m.$$eval(".sg-list .li, #sg-hide", (x) => x.map((e) => e.getBoundingClientRect().height));
  assert.ok(sizes.every((h) => h >= 44), "touch targets ≥44px: " + sizes);
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow at 390");
  await shot(m, "390-light-fresh");
  await m.evaluate(() => { location.hash = "#/me"; }); await m.waitForSelector('.profile-top a[href="#/studio"]');
  await m.click('.profile-top a[href="#/studio"]'); await m.waitForSelector("#st-start .sg-card");
  await m.evaluate(() => { location.hash = "#/menu"; }); await m.waitForSelector('#view a[href="#/studio"]');
});

test("progress comes from real data: post + schedule + community + tips; finished steps stay finished; tap schedule opens composer", async () => {
  await studio(m); await m.click('.sg-list [data-sg="schedule"]'); await m.waitForSelector("#composer3", { state: "visible", timeout: 8000 });
  assert.ok(await m.$eval("#c3-sch", (i) => i.value && new Date(i.value) > new Date()), "composer opens prefilled with a future time");
  await closeComposer(m);
  const pub = await call(m, "POST", "/api/posts", { text: "أول منشور لي في الاستوديو" }); assert.equal(pub.status < 300, true, JSON.stringify(pub));
  const at = new Date(Date.now() + 3 * 864e5).toISOString();
  const sch = await call(m, "POST", "/api/posts", { text: "منشور مجدول للتجربة", publishAt: at }); assert.equal(sch.status < 300, true, JSON.stringify(sch));
  const cid = (await call(m, "POST", "/api/communities", { name: "مجتمع دليل البدء", desc: "تجربة دليل البدء في الاستوديو" })).community.id; assert.ok(cid);
  const cr = await call(m, "PUT", "/api/me/creator", { enabled: true }); assert.equal(cr.status < 300, true, JSON.stringify(cr));
  await m.evaluate(() => window.Sync?.pull?.()).catch(() => {});
  await m.reload(); await m.waitForSelector(".bottomnav a[data-r=home]"); await m.evaluate(() => { window.view._sgCache = null; });
  await studio(m); await m.waitForSelector("#st-start .sg-card");
  const n = +(await m.getAttribute(".sg-bar", "aria-valuenow"));
  assert.ok(n >= 3, "post, scheduled post, tips counted (community via sync): " + n);
  assert.ok(await m.$(".sg-done summary"), "finished steps folded under «المكتمل»");
  assert.equal(await m.$('.sg-list a[href="#/creator"]'), null, "tips step done"); assert.equal(await m.$('.sg-list [data-sg="schedule"]'), null, "schedule step done");
  const st = await m.evaluate(() => JSON.parse(localStorage.getItem("mp.studioStart." + DB.me)));
  assert.ok(st.done.post && st.done.schedule && st.done.tips, JSON.stringify(st));
});

test("dismiss → compact restore chip, persisted across reloads; restore brings the card back with focus", async () => {
  await studio(m); await m.click("#sg-hide"); await m.waitForSelector("#sg-show");
  assert.equal(await m.$("#st-start .sg-card"), null);
  assert.equal(await m.evaluate(() => document.activeElement?.id), "sg-show");
  await m.reload(); await m.waitForSelector(".bottomnav a[data-r=home]"); await studio(m);
  assert.ok(await m.$("#sg-show"), "still dismissed after reload"); assert.equal(await m.$$eval(".studio .seg [data-stab]", (x) => x.length), 7);
  await m.click("#sg-show"); await m.waitForSelector("#st-start .sg-card"); assert.equal(await m.evaluate(() => document.activeElement?.id), "sg-hide");
});

test("tips from own stats: best time (schedules at that slot), engagement drop, top post (escaped, not sent to i18n)", async () => {
  const p = await page(MOBILE, "stats"); await p.goto(S.base + "/?nosw"); await p.fill("#a-handle", "sg_creator"); await p.fill("#a-pass", "secret1234"); await p.click("#a-go"); await p.waitForSelector(".bottomnav a[data-r=home]");
  await fakeStats(p); await studio(p); await p.waitForSelector("#st-start .sg-tips");
  assert.equal(await p.$$eval(".sg-tips .li", (x) => x.length), 3);
  assert.match(await p.textContent(".sg-tips"), /أفضل وقت لجمهورك/); assert.match(await p.textContent(".sg-slot"), /الثلاثاء\s*21:00/);
  assert.match(await p.textContent(".sg-tips"), /تراجع التفاعل 12٪/);
  assert.ok(await p.$eval('.sg-tips [data-sg="recycle"] bdi[data-noi18n]', (b) => b.textContent === "دليلي للمبتدئين <b>" && !b.querySelector("b")), "user title escaped + skipped by the translator");
  await p.click('.sg-tips [data-sg="best"]'); await p.waitForSelector("#composer3", { state: "visible", timeout: 8000 });
  const d = new Date(await p.$eval("#c3-sch", (i) => i.value)); assert.equal(d.getDay(), 2); assert.equal(d.getHours(), 21); assert.ok(d > new Date());
  await closeComposer(p);
  await p.click('.sg-tips [data-sg="recycle"]'); await p.waitForSelector('.seg [data-stab="recycle"].on');
  await p.close();
});

test("axe: no serious/critical — 390 light, 1440 dark, LTR (en); no overflow; screenshots", async () => {
  const bad = [];
  await studio(m); for (const v of await axe(m)) bad.push("390 light " + v);
  const d = await page({ ...DESKTOP, colorScheme: "dark" }, "dark"); await d.goto(S.base + "/?nosw"); await d.fill("#a-handle", "sg_creator"); await d.fill("#a-pass", "secret1234"); await d.click("#a-go"); await d.waitForSelector(".bottomnav a[data-r=home]");
  await fakeStats(d); await studio(d); await d.waitForSelector("#st-start .sg-card");
  for (const v of await axe(d)) bad.push("1440 dark " + v); await shot(d, "1440-dark");
  await d.evaluate(() => window.MPI18n?.setLang("en")); await until(d, () => document.documentElement.dir === "ltr");
  await studio(d); await d.waitForTimeout(400);
  assert.match(await d.textContent("#st-start"), /Start here/); assert.match(await d.textContent("#st-start"), /Best time for your audience/);
  for (const v of await axe(d)) bad.push("LTR " + v);
  assert.ok(await d.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow (LTR 1440)");
  await shot(d, "1440-ltr");
  const l = await page({ ...MOBILE, colorScheme: "light" }, "ltr390"); await l.goto(S.base + "/?nosw"); await l.fill("#a-handle", "sg_creator"); await l.fill("#a-pass", "secret1234"); await l.click("#a-go"); await l.waitForSelector(".bottomnav a[data-r=home]");
  await l.evaluate(() => window.MPI18n?.setLang("en")); await until(l, () => document.documentElement.dir === "ltr"); await fakeStats(l); await studio(l);
  for (const v of await axe(l)) bad.push("390 LTR " + v);
  assert.ok(await l.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow (LTR 390)");
  await shot(l, "390-ltr"); await shot(m, "390-light");
  assert.deepEqual(bad, []);
});
