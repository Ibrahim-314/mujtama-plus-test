/* v2.140: visitors (not signed in / not onboarded) can switch ar ⇄ en from the 🌐 button and from the welcome screen. */
/* global MPGate */
const test = require("node:test");
const assert = require("node:assert");
const { startStack, MOBILE } = require("./harness");

test("guest switches language without an account", async () => {
  const S = await startStack();
  try {
    // v2.149.13 «بوابة Pi»: the signed-out screen is the gate (the app bar is hidden there); its 🌐 (#ob-lang) switches the language
    const c = await S.browser.newContext({ ...MOBILE, gate: true });
    const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(S.base + "/?nosw");
    await p.waitForSelector("#gate #ob-lang", { state: "visible", timeout: 20000 });
    assert.equal(await p.evaluate(() => document.body.classList.contains("ob")), true, "guest is on the gate");
    await p.click("#gate #ob-lang");
    await p.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 10000 });
    assert.ok(!/settings\/language/.test(await p.evaluate(() => location.hash)), "globe does not route to the gated page");
    await p.waitForSelector("#gate #ob-lang", { state: "visible", timeout: 10000 });
    assert.ok(await p.$("#gate [data-m=register]"), "sign-in screen stays after the switch");
    await p.click("#gate #ob-lang");
    await p.waitForFunction(() => document.documentElement.dir === "rtl", null, { timeout: 10000 });
    // welcome screen button (after register in the owner sheet, before onboarding finishes)
    await p.waitForSelector("#gate #ob-lang", { state: "visible", timeout: 10000 });
    await p.evaluate(() => MPGate.openRec());
    await p.click("[data-m=register]");
    await p.fill("#a-name", "زائر"); await p.fill("#a-handle", "guestlang1"); await p.fill("#a-pass", "secret1234");
    await p.click("#a-go"); await p.waitForSelector("#n1");
    assert.equal((await p.textContent("#ob-lang")).trim(), "English");
    await p.click("#ob-lang");
    await p.waitForFunction(() => document.documentElement.dir === "ltr" && /Welcome/.test(document.querySelector("#view h2,.wrap h2")?.textContent || ""), null, { timeout: 10000 });
    assert.equal((await p.textContent("#ob-lang")).trim(), "العربية");
    await p.click("#ob-lang");
    await p.waitForFunction(() => document.documentElement.dir === "rtl", null, { timeout: 10000 });
    assert.deepEqual(errs, []);
    await c.close();
  } finally { await S.close(); }
});
