/* global MPMinorsUI, reportFlow */
/* Track 7 — phase 35 in a real browser. The production build does not list minors-core.js / minors-ui.js
 * until the integrator applies INTEGRATION.md, so this file registers the service on the running server and
 * injects both scripts into each page (that is exactly what the chunk loader will do).
 * Covers: the age gate in the register form, the frosted cover with tap-to-reveal (and keyboard focus),
 * age-filtered feed for a minor with the protections page, the composer label chips, the urgent report sheet,
 * the staff queue + case page, and an axe audit of the new screens. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");
let S, A, B, T; const errors = [], ids = {};
const until = async (P, fn, arg, timeout = 10000) => { const end = Date.now() + timeout; for (;;) { const v = await P.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140)); await P.waitForTimeout(100); } };
const call = (P, method, p, body) => P.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, p, body]);
const ymd = (y) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };
async function inject(P) {
  await P.addScriptTag({ path: path.join(ROOT, "minors-core.js") });
  await P.addScriptTag({ path: path.join(ROOT, "minors-ui.js") });
  await until(P, () => !!window.MPMinorsUI);
}
async function user(handle, name, birthDate) {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const P = await ctx.newPage();
  P.on("pageerror", e => errors.push(handle + ": " + e.message));
  await onboard(P, S.base, handle, name);
  ids[handle] = (await call(P, "GET", "/api/me")).user.id;
  if (birthDate) {
    assert.equal((await call(P, "POST", "/api/age", { birthDate })).status, 200);
    /* the store was hydrated at sign-up while the age was still unknown, and the server hides adult-only labels (graphic)
     * from unknown ages. The age is declared through the API here (not the #/age screen), so re-sync the store the way the
     * app's own refresh does; before v2.63 a late guided-tour skip triggered this refresh by accident. */
    await P.evaluate(() => refresh());
  }
  await inject(P);
  return P;
}
async function axeOn(P) {
  await P.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (await P.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })))).filter(v => ["serious", "critical"].includes(v.impact));
}

test.before(async () => {
  S = await startStack();
  S.app.ctx.services.minors = require(path.join(ROOT, "server", "services", "minors"))(S.app.ctx);
  A = await user("amal_mn", "أمل", ymd(34)); // first account = admin = safety staff
  const r = await call(A, "POST", "/api/posts", { text: "لقطة من موقع الحادث المروري اليوم", labels: ["graphic"] }); assert.equal(r.status, 200); ids.graphic = r.post.id;
  ids.plain = (await call(A, "POST", "/api/posts", { text: "صباح الخير يا جماعة ☀️" })).post.id;
  B = await user("badr_mn", "بدر", ymd(28)); // bootstraps after the posts exist
  T = await user("tala_mn", "تالا", ymd(15));
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("register form: birth-date field, under-13 shows the kind refusal screen and creates nothing", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const P = await ctx.newPage();
  P.on("pageerror", e => errors.push("gate: " + e.message));
  await P.goto(S.base + "/?nosw"); await inject(P);
  await P.click("[data-m=register]");
  await P.waitForSelector("#mn-dob");
  assert.equal(await P.getAttribute("#mn-dob", "type"), "date");
  assert.ok(await P.$("label[for=mn-dob]"), "the field is labelled");
  await P.fill("#a-name", "صغير"); await P.fill("#a-handle", "kid_mn"); await P.fill("#a-pass", "secret1234");
  await P.fill("#mn-dob", ymd(10)); await P.dispatchEvent("#mn-dob", "change");
  assert.match(await P.textContent("#mn-dob-h"), /١٣|13/);
  await P.click("#a-go");
  await P.waitForSelector(".mn-gate[role=alertdialog]");
  assert.match(await P.textContent(".mn-gate"), /١٣|13/);
  assert.equal(await P.evaluate(() => document.activeElement?.id), "mn-gate-t", "focus moves into the dialog");
  assert.equal(await S.app.ctx.db.get("SELECT 1 x FROM users WHERE handle='kid_mn'"), undefined);
  await ctx.close();
});

test("adult viewer: labelled post is covered with a frosted veil; «عرض» reveals it in place and moves focus", async () => {
  const sel = `[data-mn-cover="${ids.graphic}"]`;
  await until(B, (id) => !!S.post(id), ids.graphic);
  assert.equal(await B.evaluate((id) => MPMinorsUI.coverState(S.post(id)), ids.graphic), "cover");
  await B.evaluate((id) => { location.hash = "#/post/" + id; }, ids.graphic);
  await B.waitForSelector(sel);
  assert.match(await B.textContent(sel + " .mn-veil"), /مشاهد صادمة/);
  assert.equal(await B.getAttribute(sel + " .mn-blur", "aria-hidden"), "true"); assert.notEqual(await B.getAttribute(sel + " .mn-blur", "inert"), null, "covered content is not focusable");
  await B.click(sel + " [data-mn-reveal]");
  await B.waitForSelector(sel + ".on");
  assert.equal(await B.getAttribute(sel + " .mn-blur", "inert"), null);
  assert.ok(await B.evaluate((s) => document.querySelector(s).contains(document.activeElement), sel), "focus lands inside the revealed post");
  await B.click(sel + " [data-mn-recover]"); await B.waitForSelector(sel + ":not(.on)");
  await B.click(sel + " [data-mn-why]"); await B.waitForSelector("#sheet:not(.hidden) #mn-why-go");
  assert.match(await B.textContent("#sheet"), /مشاهد صادمة/);
  await B.click("#mn-why-go"); await B.waitForSelector("#mn-h");
  assert.match(await B.textContent("#mn-h"), /العمر والمحتوى الحساس/);
});

test("declaring an adult age on #/age re-syncs the store: the adult-only post appears covered without a reload", async () => {
  const U = await user("umar_mn", "عمر"); // no age yet → the server withholds the adult-only (graphic) post
  assert.ok(!(await call(U, "GET", "/api/feed?mode=latest")).posts.some(p => p.id === ids.graphic), "unknown age: graphic withheld");
  await U.waitForTimeout(3000); // let the sign-up's own delayed sync settle, so only the #/age save can bring the post in
  assert.equal(await U.evaluate((id) => !!S.post(id), ids.graphic), false);
  await U.evaluate(() => { window.__mnNoReload = 1; });
  await U.evaluate(() => { location.hash = "#/age"; });
  await U.waitForSelector("#mn-bd-go");
  await U.fill("#mn-bd", ymd(30)); await U.click("#mn-bd-go");
  await until(U, (id) => !!S.post(id), ids.graphic, 4000);
  assert.equal(await U.evaluate((id) => MPMinorsUI.coverState(S.post(id)), ids.graphic), "cover");
  assert.equal(await U.evaluate(() => window.__mnNoReload), 1, "no page reload happened");
  const sel = `[data-mn-cover="${ids.graphic}"]`;
  await U.evaluate((id) => { location.hash = "#/post/" + id; }, ids.graphic);
  await U.waitForSelector(sel + " .mn-veil");
  await U.context().close();
});

test("minor: the labelled post never reaches the client; #/age lists the protections and locks the preference", async () => {
  const feed = await call(T, "GET", "/api/feed?mode=latest");
  assert.ok(feed.posts.some(p => p.id === ids.plain)); assert.ok(!feed.posts.some(p => p.id === ids.graphic));
  assert.equal((await call(T, "GET", "/api/posts/" + ids.graphic)).status, 404);
  await T.evaluate(() => { location.hash = "#/age"; });
  await T.waitForSelector("#mn-h");
  const txt = await T.textContent(".mn-page");
  assert.match(txt, /حسابك خاص/); assert.match(txt, /دون ١٨/); assert.match(txt, /تُرفع هذه القيود تلقائياً/);
  assert.equal(await T.evaluate(() => [...document.querySelectorAll("input[name=mn-pref]")].filter(i => !i.disabled).map(i => i.value).join()), "hide");
  assert.equal((await call(T, "PUT", "/api/privacy", { private: false })).status, 403);
});

test("composer chips and the urgent report sheet", async () => {
  await B.evaluate(() => { location.hash = "#/home"; });
  await B.waitForSelector("#cbar", { state: "visible" }); await B.click("#cbar");
  await B.waitForSelector("#composer3 #mn-lbl [data-mn-l=violence]", { state: "attached" }); await B.evaluate(() => { document.querySelector("#composer3 #c3-opts").open = true; });
  await B.fill("#c3-text", "مشهد قتال من فيلم الأكشن الجديد");
  await B.click("#mn-lbl [data-mn-l=violence]");
  assert.equal(await B.getAttribute("#mn-lbl [data-mn-l=violence]", "aria-pressed"), "true");
  await B.click("#c3-pub");
  await B.waitForSelector("#composer3", { state: "detached" });
  let mine; for (let i = 0; i < 50 && !mine; i++) { mine = await S.app.ctx.db.get("SELECT p.id, l.labels FROM posts p JOIN content_labels l ON l.target=p.id WHERE p.text LIKE '%فيلم الأكشن%'"); if (!mine) await B.waitForTimeout(100); }
  assert.equal(mine?.labels, "violence", "labels chosen in the composer are saved with the post");
  await B.evaluate((id) => reportFlow(id, "post"), ids.plain);
  await B.waitForSelector("#mn-urg"); await B.click("#mn-urg");
  await B.waitForSelector("input[name=mn-cat]");
  await B.check("input[name=mn-cat][value=self_harm]"); await B.fill("#mn-ud", "صديق يتحدث عن إيذاء نفسه");
  await B.click("#mn-ugo");
  await B.waitForSelector("#mn-udone");
  assert.match(await B.textContent("#sheet"), /رقم المرجع/);
  await B.click("#mn-udone");
});

test("staff queue: the admin sees the urgent case first and opens it with the evidence chain", async () => {
  await A.evaluate(() => { location.hash = "#/safety-cases"; });
  await A.waitForSelector(".mn-case");
  const first = await A.textContent(".mn-case");
  assert.match(first, /إيذاء النفس|سلامة/);
  await A.click(".mn-case"); await A.waitForSelector(".mn-ev");
  assert.match(await A.textContent(".mn-page"), /سلسلة الأدلة سليمة/);
  assert.match(await A.textContent(".mn-page"), /لا يُرسل شيء تلقائياً/);
  assert.equal((await call(B, "GET", "/api/safety/cases")).status, 404, "not staff → the queue does not exist");
});

test("accessibility: age, family, staff case and a covered post have no serious/critical WCAG A/AA violations", async () => {
  const report = {};
  for (const [P, r] of [[T, "#/age"], [T, "#/family"], [B, "#/post/" + ids.graphic], [A, "#/safety-cases"]]) {
    await P.evaluate((h) => { location.hash = h; }, r); await P.waitForTimeout(900);
    report[r] = await axeOn(P);
  }
  await A.click(".mn-case"); await A.waitForSelector(".mn-ev"); report.case = await axeOn(A);
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
