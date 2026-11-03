/* global MPI18n */
/* v2.149.2 «ولا ومضة»: a cold open of any screen paints that screen once, in the right language, with no other screen first */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    window.__fr = []; const t0 = performance.now();
    const tick = () => {
      const v = document.getElementById("view"), nav = document.querySelector(".bottomnav");
      if (v) {
        const lab = [...document.querySelectorAll(".bottomnav small")].filter((s) => getComputedStyle(s).visibility !== "hidden").map((s) => s.textContent).join(" ");
        window.__fr.push({ t: performance.now() - t0, kids: [...v.children].map((k) => k.className).join("|"), text: v.textContent.slice(0, 400), nav: nav ? getComputedStyle(nav).display : "", lab, vcls: v.className });
      }
      if (performance.now() - t0 < 3500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    document.addEventListener("DOMContentLoaded", () => {
      const v = document.getElementById("view"), d = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML"); window.__w = [];
      Object.defineProperty(v, "innerHTML", { set(x) { window.__w.push(String(x).slice(0, 60)); d.set.call(this, x); }, get() { return d.get.call(this); } });
    });
  });
  p = await ctx.newPage(); await onboard(p, S.base, "nf_user", "مختبر الوميض"); await dismissTour(p).catch(() => {});
});
test.after(async () => { await ctx.close(); await S.close(); });
const cold = async (h, ms = 3600) => { await p.goto("about:blank"); await p.goto(S.base + "/?nosw" + h); await p.waitForTimeout(ms); return p.evaluate(() => ({ fr: window.__fr, w: window.__w })); };
const WELCOME = "أهلاً بك في مجتمع بلس";

test("v2.149.2: a cold #/shorts, #/settings, #/explore, #/versions never show the welcome screen or hide the bottom bar first", async () => {
  for (const h of ["#/shorts", "#/settings", "#/explore", "#/versions"]) {
    const { fr } = await cold(h);
    assert.ok(fr.length > 10, h + " frames");
    assert.ok(!fr.some((f) => f.text.includes(WELCOME)), h + ": welcome/onboarding frame");
    if (h !== "#/shorts") assert.ok(!fr.some((f) => f.nav === "none"), h + ": bottom bar hidden in a frame");
  }
});
test("v2.149.2: a cold #/integrity or #/calls shows the skeleton, never «الصفحة غير موجودة», before the screen", async () => {
  for (const h of ["#/integrity", "#/calls"]) {
    const { fr } = await cold(h);
    assert.ok(!fr.some((f) => /nf-page/.test(f.kids)), h + ": not-found frame " + JSON.stringify(fr.find((f) => /nf-page/.test(f.kids))?.t));
    assert.ok(fr.at(-1).text.trim().length > 0, h + " rendered");
  }
});
test("v2.149.2: the settings hub and the versions page are drawn once (no redraw when idle chunks land)", async () => {
  for (const [h, rx] of [["#/settings", /set-page/], ["#/versions", /mp-vers/], ["#/settings/display", /page-head/], ["#/admin/security", /page-head/], ["#/admin/finance", /fn-page/]]) {
    const { w } = await cold(h, 4000);
    assert.equal(w.filter((x) => rx.test(x)).length, 1, h + " renders " + JSON.stringify(w));
  }
});
test("v2.149.2: the profile's classes leave #view with the profile (no profile tabs on the next screen)", async () => {
  await p.goto(S.base + "/?nosw#/me"); await p.waitForTimeout(2500);
  assert.ok(await p.evaluate(() => document.getElementById("view").classList.contains("pv3")), "pv3 on the profile");
  await p.evaluate(() => { location.hash = "#/communities"; }); await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => document.getElementById("view").className.match(/profile-v2|pv3/g)), null);
});
test("v2.149.2: the profile edit sheet still opens (moved out of the core bundle)", async () => {
  await p.goto(S.base + "/?nosw#/me"); await p.waitForTimeout(2500);
  await p.waitForFunction(() => window.MPProfEdit, null, { timeout: 8000 });
  await p.evaluate(() => { const b = document.querySelector("#edit2"); if (b) b.click(); else window.MPProfEdit.edit({ cover: null, avatar: null, location: "", expertise: [], links: [], sections: [], pinned: [] }, { pinned: [] }); });
  await p.waitForSelector("#sheet #ep-name", { timeout: 5000 });
  await p.keyboard.press("Escape");
});
test("v2.149.2: a saved English UI opens in English: no Arabic labels in any frame of the bottom bar or the screen chrome", async () => {
  await p.goto(S.base + "/?nosw#/home"); await p.waitForTimeout(1200);
  await p.evaluate(() => MPI18n.setLang("en")); await p.waitForTimeout(1500);
  for (const h of ["#/home", "#/settings", "#/communities"]) {
    const { fr } = await cold(h, 3800);
    const ar = fr.filter((f) => /[\u0600-\u06FF]/.test(f.lab));
    assert.equal(ar.length, 0, h + ": Arabic nav labels in " + ar.length + " frames, first " + JSON.stringify(ar[0]));
    const last = fr.at(-1); assert.ok(/[A-Za-z]/.test(last.lab), h + " English labels at the end: " + last.lab);
  }
  await p.evaluate(() => MPI18n.setLang("ar")); await p.waitForTimeout(800);
});
