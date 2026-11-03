/* global MPI18n */
/* v2.149.3 «ما يتحرك تحت إصبعك»: English cold opens — a settings section title does not flip Arabic↔English, a screen its own
 * chunk drew is not redrawn from the skeleton when a late chain lands, and the shorts tabs paint in English from frame one */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    window.__fr = []; const t0 = performance.now();
    const tick = () => {
      const v = document.getElementById("view");
      if (v) {
        const h2 = v.querySelector(".page-head h2"), tabs = document.querySelector(".cl-tabs");
        window.__fr.push({ t: performance.now() - t0, h2: h2 ? h2.textContent.trim() : "", hh: h2 ? Math.round(h2.getBoundingClientRect().height) : 0,
          busy: !!v.querySelector(':scope > .wrap[aria-busy="true"]'), tabs: tabs ? tabs.textContent : "", tx: tabs ? Math.round(tabs.getBoundingClientRect().left) : null });
      }
      if (performance.now() - t0 < 3500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  p = await ctx.newPage(); await onboard(p, S.base, "nf3_user", "مختبر القفزات"); await dismissTour(p).catch(() => {});
  await p.evaluate(() => MPI18n.setLang("en")); await p.waitForTimeout(600);
});
test.after(async () => { await ctx.close(); await S.close(); });
const cold = async (h, ms = 3600) => { await p.goto("about:blank"); await p.goto(S.base + "/?nosw" + h); await p.waitForTimeout(ms); return p.evaluate(() => window.__fr); };
const AR = /[\u0600-\u06FF]/;

test("v2.149.3: #/settings?s=display (en) — the title settles in English once and its height never changes", async () => {
  const fr = (await cold("#/settings?s=display")).filter((f) => f.h2);
  assert.ok(fr.length > 10, "frames with a title");
  const firstEn = fr.findIndex((f) => !AR.test(f.h2));
  assert.ok(firstEn >= 0, "title translated");
  const back = fr.slice(firstEn).filter((f) => AR.test(f.h2));
  assert.equal(back.length, 0, "title went back to Arabic in " + back.length + " frames");
  const hs = new Set(fr.slice(firstEn).map((f) => f.hh)); assert.equal(hs.size, 1, "title height changed: " + [...hs]);
});
test("v2.149.3: a cold #/security (en) is drawn once — no return to the loading skeleton after the screen showed", async () => {
  const fr = await cold("#/security");
  const shown = fr.findIndex((f) => f.h2 && !f.busy);
  assert.ok(shown >= 0, "security screen shown");
  assert.ok(!fr.slice(shown).some((f) => f.busy || !f.h2), "went back to the skeleton at " + JSON.stringify(fr.slice(shown).find((f) => f.busy || !f.h2)?.t));
});
test("v2.149.3: #/shorts (en) — the tabs paint in English from their first frame and never slide", async () => {
  const fr = (await cold("#/shorts")).filter((f) => f.tabs);
  assert.ok(fr.length > 5, "tabs frames");
  assert.ok(!fr.some((f) => AR.test(f.tabs)), "Arabic tab labels in a frame");
  assert.equal(new Set(fr.map((f) => f.tx)).size, 1, "tabs moved: " + [...new Set(fr.map((f) => f.tx))]);
});
