const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, MOBILE } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
test("v2.148.2: every link and button on #/digest is at least 24px to tap", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "tp_dig", "لمس"); await seedDiscovery(S.app.ctx, p); await dismissTour(p);
  for (const r of (process.env.ROUTES || "digest").split(",")) {
    await p.goto(S.base + "/?nosw#/" + r); await p.waitForTimeout(3000);
    const small = await p.evaluate(() => [...document.querySelectorAll("#view a[href],#view button,#view [role=button],#view input,#view select,#view summary")].filter((e) => { const b = e.getBoundingClientRect(); if (!b.width || !b.height) return false; if (getComputedStyle(e).visibility === "hidden") return false; if (e.closest("p,li") && e.tagName === "A" && e.closest("p,li").textContent.length > e.textContent.length + 20) return false; const af = getComputedStyle(e, "::after"); if (af.content !== "none" && parseFloat(af.height) >= 24 && af.position === "absolute") return false; return b.width < 24 || b.height < 24; }).map((e) => { const b = e.getBoundingClientRect(); return e.tagName + "." + String(e.className).slice(0, 30) + " " + Math.round(b.width) + "x" + Math.round(b.height) + " " + (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 20); }));
    assert.equal(small.length, 0, r + " small targets " + JSON.stringify([...new Set(small)].slice(0, 8)));
  }
  await c.close();
});
