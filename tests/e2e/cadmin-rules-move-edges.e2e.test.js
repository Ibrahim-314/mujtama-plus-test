/* Fix #4 (community settings audit 2026-11-16): the rule «move up» on the first rule and «move down» on the last
 * looked active and did nothing (a single rule had both). They are now disabled at the edges, like channels. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p, cid;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); await onboard(p, S.base, "rm_o", "مالك القواعد"); await dismissTour(p).catch(() => {});
  cid = await p.evaluate(async () => { const r = await fetch("/api/communities", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ name: "مجتمع القواعد", desc: "وصف للفحص", topic: "dev" }) }); return (await r.json()).community.id; });
});
test.after(async () => { await ctx.close(); await S.close(); });
const st = () => p.evaluate(() => [...document.querySelectorAll(".ca-rl .ca-ru")].map((li) => [li.querySelector('[data-rmv="-1"]').disabled, li.querySelector('[data-rmv="1"]').disabled]));
test("rule move buttons are disabled at the edges, and moving still works", async () => {
  /* start from one saved rule (a community with zero rules is a separate finding, not this fix) */
  await p.evaluate(async (c) => { await fetch(`/api/communities/${c}/rules`, { method: "PUT", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ rules: [{ title: "أولى", body: "", severity: "info" }], required: false }) }); }, cid);
  await p.goto(`${S.base}/?nosw#/cadmin/${cid}?s=rules`); await p.waitForSelector(".ca-rl .ca-ru");
  while ((await p.$$(".ca-rl .ca-ru")).length > 1) { await p.click(".ca-rl .ca-ru:last-child [data-rrm]"); await p.waitForTimeout(150); }
  assert.deepEqual(await st(), [[true, true]], "single rule: both disabled");
  await p.click(".ca-radd"); await p.waitForTimeout(150);
  await p.fill(".ca-rl .ca-ru:nth-child(1) .ca-rt", "أولى"); await p.fill(".ca-rl .ca-ru:nth-child(2) .ca-rt", "ثانية");
  assert.deepEqual(await st(), [[true, false], [false, true]]);
  await p.click('.ca-rl .ca-ru:nth-child(1) [data-rmv="1"]'); await p.waitForTimeout(150);
  const r = await p.evaluate(() => ({ t: [...document.querySelectorAll(".ca-rl .ca-rt")].map((i) => i.value), f: document.activeElement?.getAttribute("data-rmv") }));
  assert.deepEqual(r.t, ["ثانية", "أولى"]); assert.equal(r.f, "-1", "focus moves to the usable button");
});
