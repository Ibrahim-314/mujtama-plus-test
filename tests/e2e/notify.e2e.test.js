/* global MPNotify */
/* Track 6 — notifications in a real browser: realtime toast when someone follows you, the notification
 * center with grouping («بدر وشادي أعجبهما منشورك»), tabs and mark-all-read, the settings screen saving a
 * per-kind switch and quiet hours, and an axe audit of the notification + email-preference screens. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, A, B, C; const errors = [], ids = {};
const until = async (P, fn, arg, timeout = 10000) => { const end = Date.now() + timeout; for (;;) { const v = await P.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140)); await P.waitForTimeout(100); } };
const call = (P, method, path, body) => P.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, path, body]);
async function user(handle, name) {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const P = await ctx.newPage();
  P.on("pageerror", e => errors.push(handle + ": " + e.message));
  await onboard(P, S.base, handle, name);
  ids[handle] = (await call(P, "GET", "/api/me")).user.id;
  return P;
}

test.before(async () => {
  S = await startStack();
  A = await user("amal_nf", "أمل"); B = await user("badr_nf", "بدر"); C = await user("chadi_nf", "شادي");
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("realtime toast: a new follower pops an Arabic toast that links to the notification", async () => {
  await A.evaluate(() => { location.hash = "#/home"; });
  await A.evaluate(() => window.MPChunks?.load("notify"));
  await until(A, () => !!window.MPNotify && !!document.getElementById("nf-toasts"));
  await A.waitForTimeout(500);
  await call(B, "PUT", "/api/follows/" + ids.amal_nf);
  await A.waitForSelector("#nf-toasts .nf-toast", { timeout: 10000 });
  const t = await A.textContent("#nf-toasts .nf-toast"); assert.match(t, /بدر/); assert.match(t, /بدأ بمتابعتك/);
  assert.equal(await A.getAttribute("#nf-toasts .nf-toast", "role"), "status");
  await A.click("#nf-toasts .nf-toast .x"); await A.waitForSelector("#nf-toasts .nf-toast", { state: "detached", timeout: 5000 });
});

test("notification center: grouped likes with Arabic dual, tabs with unread counts, mark all read", async () => {
  const post = (await call(A, "POST", "/api/posts", { text: "منشور لاختبار مركز الإشعارات" })).post;
  await call(B, "PUT", "/api/reactions/" + post.id, { type: "like" });
  await call(C, "PUT", "/api/reactions/" + post.id, { type: "like" });
  await A.evaluate(() => { location.hash = "#/notifications"; });
  await A.waitForSelector(".nf-tabs [role=tab]");
  const item = await until(A, () => [...document.querySelectorAll(".nf-it")].map(x => x.textContent).find(t => /أعجبهما منشورك/.test(t)) || null);
  assert.match(item, /شادي وبدر أعجبهما منشورك/);
  assert.ok(await A.$(`.nf-it[href$="#/post/${post.id}"]`), "group links to the post: " + (await A.$$eval(".nf-it", xs => xs.map(x => x.getAttribute("href")).join(" "))));
  assert.ok((await A.$$(".nf-it.un")).length >= 2, "unread items are marked");
  const tabs = await A.$$eval(".nf-tabs [role=tab]", ts => ts.map(t => t.textContent));
  assert.ok(tabs.some(t => /التفاعلات/.test(t)) && tabs.some(t => /المتابعات/.test(t)));
  await A.click("#nft-follows"); await until(A, () => document.querySelector("#nft-follows")?.getAttribute("aria-selected") === "true");
  assert.ok(!(await A.$$eval(".nf-it", xs => xs.some(x => /أعجب/.test(x.textContent)))), "tab filters to follows");
  await A.click("#nft-all"); await A.waitForSelector("#nf-all");
  await A.click("#nf-all");
  await until(A, () => !document.querySelector(".nf-it.un"));
  assert.equal((await call(A, "GET", "/api/notifications?view=center")).unread, 0);
});

test("settings: per-kind switch and quiet hours persist to the server", async () => {
  await A.evaluate(() => { location.hash = "#/notifsettings"; });
  await A.waitForSelector("input[type=checkbox]", { timeout: 10000 });
  const r = await A.evaluate(async () => { await MPNotify.setChannel("reaction", "push", false); return MPNotify.setQuiet({ enabled: true, start: "23:00", end: "06:30" }); });
  assert.equal(r.quiet.enabled, true); assert.equal(r.quiet.start, "23:00");
  const st = await call(A, "GET", "/api/notify/settings");
  assert.equal(st.kinds.find(k => k.kind === "reaction").push, 0); assert.equal(st.quiet.end, "06:30"); assert.ok(st.quiet.tz, "browser timezone recorded");
});

test("accessibility: notification center, settings and email preferences have no serious/critical WCAG A/AA violations", async () => {
  const report = {};
  for (const r of ["#/notifications", "#/notifsettings", "#/emailprefs"]) {
    await A.goto(S.base + "/?nosw" + r); await A.waitForTimeout(1200);
    await A.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    report[r] = (await A.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") }))))
      .filter(v => ["serious", "critical"].includes(v.impact));
  }
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
