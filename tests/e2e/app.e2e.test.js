/* Phase 2 — end-to-end journeys on mobile and desktop against the production build. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const TOTP = require("../../server/lib/totp");
let S;
const pageErrors = [];
test.before(async () => {
  S = await startStack();
});
test.after(async () => {
  await S.close();
  assert.deepEqual(pageErrors, [], "no uncaught page errors");
});
const newPage = async opts => {
  const ctx = await S.browser.newContext(opts);
  const p = await ctx.newPage();
  p.on("pageerror", e => pageErrors.push(e.message));
  return p;
};

test("mobile: register → onboarding → post → tap-to-like → comment", async () => {
  const p = await newPage(MOBILE);
  await onboard(p, S.base, "e2e_mobile", "سارة");
  await p.click("#cbar");
  await p.fill("#c3-text", "أول منشور من اختبار طرف لطرف #برمجة");
  await p.click("#c3-pub");
  await p.waitForSelector(".post-card >> text=أول منشور من اختبار");
  const like = p.locator(".post-card", { hasText: "أول منشور من اختبار" }).locator("[data-react]");
  await like.click();
  await p.waitForTimeout(300);
  assert.equal(await like.getAttribute("aria-pressed"), "true");
  const status = await p.evaluate(async () => (await fetch("/api/bootstrap", { headers: { "X-Requested-With": "mujtama" } })).json());
  assert.ok(
    status.posts.some(x => x.text.includes("أول منشور من اختبار")),
    "post persisted on server"
  );
  await p.context().close();
});

test("security: enable 2FA from the security center, then sign-in asks for the code", async () => {
  const p = await newPage(MOBILE);
  await onboard(p, S.base, "e2e_secure", "خالد");
  await p.goto(S.base + "/?nosw#/security");
  await p.waitForSelector("#tfa-on");
  await p.click("#tfa-on");
  await p.waitForSelector("#tfa-code");
  await p.click("details summary");
  const secret = (await p.textContent("details code")).replace(/\s/g, "");
  await p.fill("#tfa-code", TOTP.generate(secret));
  await p.click("#tfa-confirm");
  await p.waitForSelector("text=احفظ رموزك الاحتياطية");
  await p.evaluate(() => closeSheet());
  await p.waitForSelector("#tfa-off");
  // sign in on a fresh device
  const q = await newPage(DESKTOP);
  await q.goto(S.base + "/?nosw");
  await q.fill("#a-handle", "e2e_secure");
  await q.fill("#a-pass", "secret1234");
  await q.click("#a-go");
  await q.waitForSelector("#a-code");
  await new Promise(r => setTimeout(r, 30e3 - (Date.now() % 30e3) + 200)); // fresh TOTP step (replay protection)
  await q.fill("#a-code", TOTP.generate(secret));
  await q.click("#a-go");
  await q.waitForSelector(".bottomnav a[data-r=home]");
  await p.context().close();
  await q.context().close();
});

test("desktop: three-column layout with live rail; status page for admins", async () => {
  const p = await newPage(DESKTOP);
  await p.goto(S.base + "/?nosw");
  await p.fill("#a-handle", "e2e_mobile");
  await p.fill("#a-pass", "secret1234");
  await p.click("#a-go");
  await p.waitForSelector("#rail .rail-card");
  const navWidth = await p.$eval(".bottomnav", el => el.getBoundingClientRect().width);
  assert.ok(navWidth >= 200, "side navigation is expanded on desktop");
  await p.goto(S.base + "/?nosw#/status");
  await p.waitForSelector("text=حالة النظام");
  await p.waitForSelector("text=قاعدة البيانات");
  await p.context().close();
});

test("offline shell: service worker caches the app for repeat visits", async () => {
  const ctx = await S.browser.newContext(MOBILE);
  const p = await ctx.newPage();
  await p.goto(S.base + "/");
  await p
    .evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true))
    .catch(() => {});
  await p.reload();
  // poll with evaluate (waitForFunction evals a string in-page, which our strict CSP correctly forbids)
  for (let i = 0; i < 40 && !(await p.evaluate(() => !!navigator.serviceWorker.controller)); i++) await p.waitForTimeout(200);
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForSelector(".topbar");
  assert.ok(await p.$(".brand"), "app shell renders offline");
  await ctx.close();
});
