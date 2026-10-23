/* global MPAutomod, postCard, Remote */
/* Track 7 — Phase 31 in a real browser: the «هل أنت متأكد؟» dialog before a hostile reply (accessible
 * alertdialog, focus on «تعديل الرد», Escape = edit, «النشر على أي حال» sends), friendly replies go straight
 * through, the gentle held banner on the author's card and the «قيد المراجعة» sheet, and an axe audit of the
 * dialog. automod-ui.js is injected (the integrator adds it to index.html / the build). */
const test = require("node:test"),
  assert = require("node:assert"),
  path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
let S, P;
const errors = [];
const call = (p, method, url, body) =>
  p.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(u, {
        method: m,
        headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" },
        body: b ? JSON.stringify(b) : undefined
      });
      return { status: r.status, ...(await r.json().catch(() => ({}))) };
    },
    [method, url, body]
  );
const UI = path.join(__dirname, "..", "..", "automod-ui.js");

test.before(async () => {
  S = await startStack();
  if (!S.app.ctx.services.automod) S.app.ctx.services.automod = require("../../server/services/automod")(S.app.ctx); // server.js registers it after integration
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  P = await ctx.newPage();
  P.on("pageerror", e => errors.push(e.message));
  await onboard(P, S.base, "amod_e2e", "سارة");
  await S.app.ctx.db.run("UPDATE users SET role='user' WHERE handle='amod_e2e'"); // the first account is the bootstrap admin, and admins are exempt
  await P.addScriptTag({ path: UI });
  await P.waitForFunction(() => !!window.MPAutomod && !!Remote.__amOrig);
});
test.after(async () => {
  await S.close();
  assert.deepEqual(errors, [], "no uncaught page errors");
});

test("hostile reply: accessible dialog, edit by default (Escape), send anyway posts it", async () => {
  const post = (await call(P, "POST", "/api/posts", { text: "ما رأيكم في التحديث الجديد؟" })).post;
  // 1) Escape → edit: the request is not sent
  const pending = P.evaluate(
    pid =>
      Remote.api("POST", "/api/comments", { post: pid, text: "انت غبي وما تفهم شي" }).then(
        () => "sent",
        e => e.code || e.message
      ),
    post.id
  );
  await P.waitForSelector("#am-nudge [role=alertdialog]");
  assert.match(await P.textContent("#am-t"), /هل أنت متأكد/);
  assert.equal(await P.evaluate(() => document.activeElement?.dataset.am), "edit", "focus starts on the safe choice");
  assert.equal(await P.getAttribute("#am-nudge [role=alertdialog]", "aria-modal"), "true");
  await P.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const v = await P.evaluate(async () => (await axe.run("#am-nudge", { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(x => x.id));
  assert.deepEqual(v, [], "dialog passes axe WCAG 2 AA");
  await P.keyboard.press("Escape");
  assert.equal(await pending, "automod_edit");
  assert.equal((await call(P, "GET", `/api/posts/${post.id}/comments`)).comments.length, 0);
  // 2) send anyway
  const sent = P.evaluate(
    pid =>
      Remote.api("POST", "/api/comments", { post: pid, text: "انت غبي وما تفهم شي" }).then(
        () => "sent",
        e => e.code || e.message
      ),
    post.id
  );
  await P.waitForSelector("#am-nudge [data-am=post]");
  await P.click("#am-nudge [data-am=post]");
  assert.equal(await sent, "sent");
  await P.waitForSelector("#am-nudge", { state: "detached" });
  // 3) friendly reply: no dialog at all
  const t0 = Date.now();
  assert.equal(await P.evaluate(pid => Remote.api("POST", "/api/comments", { post: pid, text: "شكراً، فكرة رائعة 🌷" }).then(() => "sent"), post.id), "sent");
  assert.equal(await P.$("#am-nudge"), null);
  assert.ok(Date.now() - t0 < 5000);
});

test("held post: gentle banner for its author, «لماذا؟» explains, and the review sheet lists it", async () => {
  const held = await P.evaluate(() => Remote.__amOrig("POST", "/api/posts", { text: "انت حقير ووسخ يا كلب" }));
  let p;
  for (let i = 0; i < 40; i++) {
    p = (await call(P, "GET", "/api/posts/" + held.post.id)).post;
    if (p.status === "held") break;
    await P.waitForTimeout(150);
  }
  assert.equal(p.status, "held");
  const html = await P.evaluate(post => (typeof postCard === "function" ? postCard(post) : MPAutomod.heldBanner(post)), p);
  assert.match(html, /am-banner/);
  assert.match(html, /بانتظار مراجعة سريعة/);
  await P.evaluate(h => {
    const d = document.createElement("div");
    d.id = "am-test";
    d.innerHTML = h;
    document.body.appendChild(d);
  }, html);
  await P.click("#am-test [data-am-why]");
  await P.waitForSelector("#am-nudge [role=alertdialog]");
  assert.match(await P.textContent("#am-d"), /إساءة/);
  await P.click("#am-nudge [data-am=ok]");
  await P.evaluate(() => MPAutomod.openHeld());
  await P.waitForSelector("#sheet [role=region]");
  assert.match(await P.textContent("#sheet"), /قيد المراجعة/);
  assert.match(await P.textContent("#sheet"), /حقير/);
});
