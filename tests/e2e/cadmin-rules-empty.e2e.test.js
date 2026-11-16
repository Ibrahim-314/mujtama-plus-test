/* Fix (found 2026-11-16 while testing #4): a community with no rules could not open «القواعد والترحيب» at all
 * («تعذّر التحميل», null .value): the «لا قواعد بعد» placeholder row was read as a rule. Now the section opens,
 * the first rule can be added and saved, and removing the last rule saves an empty list. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S, ctx, p, cid;
test.before(async () => {
  ensureBuild(); S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); await onboard(p, S.base, "re_o", "مالك بلا قواعد"); await dismissTour(p).catch(() => {});
  p.on("pageerror", (e) => { throw e; });
  cid = await p.evaluate(async () => { const r = await fetch("/api/communities", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ name: "مجتمع فاضي", desc: "وصف للفحص", topic: "dev" }) }); return (await r.json()).community.id; });
});
test.after(async () => { await ctx.close(); await S.close(); });
const rules = () => p.evaluate(async (c) => (await (await fetch(`/api/communities/${c}/rules`)).json()).rules.map((r) => r.title), cid);
const open = async () => { await p.goto("about:blank"); await p.goto(`${S.base}/?nosw#/cadmin/${cid}?s=rules`); await p.waitForSelector(".ca-rl"); };
test("rules section opens with zero rules, first rule saves, last rule removal saves", async () => {
  assert.deepEqual(await rules(), []);
  await open();
  assert.equal(await p.$(".ca-body .err"), null, "no «تعذّر التحميل»");
  await p.click(".ca-radd"); await p.fill(".ca-rl .ca-ru .ca-rt", "احترم الجميع");
  await p.click('[data-ca="save"]'); await p.waitForTimeout(1200);
  assert.deepEqual(await rules(), ["احترم الجميع"]);
  await open(); await p.click(".ca-rl .ca-ru [data-rrm]");
  assert.ok(await p.$(".ca-rl .ca-rnone"), "placeholder shown");
  await p.click('[data-ca="save"]'); await p.waitForTimeout(1200);
  assert.deepEqual(await rules(), []);
  await open(); assert.equal(await p.$(".ca-body .err"), null);
});
