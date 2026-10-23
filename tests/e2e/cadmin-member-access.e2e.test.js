/* H3-06 — a plain member who opens #/cadmin/:id directly sees the friendly «اللوحة لفريق الإشراف» message, the client
 * checks access first (GET …/admin/access) and never calls GET …/admin, so there is no 403 and no console error.
 * Staff (moderator) still open the panel as before. */
const test = require("node:test"), assert = require("node:assert");
const path = require("path");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
let S, cid, own, mem, mod; const errors = [];
const SHOTS = path.join(__dirname, "../../../shots");
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const watch = (p, who) => {
  p.log = { console: [], adminCalls: [], forbidden: [] };
  p.on("pageerror", (e) => errors.push(who + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error") p.log.console.push(m.text()); });
  p.on("response", (r) => { const u = r.url(); if (/\/api\/communities\/[^/]+\/admin(\?|$)/.test(u)) p.log.adminCalls.push(r.status()); if (r.status() === 403) p.log.forbidden.push(u); });
};
const page = async (opts, who) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); watch(p, who); return p; };
const open = async (p, h) => { await p.evaluate((h) => { location.hash = h; }, h); await p.waitForFunction(() => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2"), null, { timeout: 15000 }); await p.waitForTimeout(300); };

test.before(async () => {
  S = await startStack();
  own = await page(MOBILE, "owner"); await onboard(own, S.base, "cma_owner", "مالك المجتمع");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع صلاحيات اللوحة", desc: "اختبار فتح لوحة الإدارة من عضو عادي.", rules: ["الاحترام"] })).community.id;
  S.app.ctx.rl.w?.clear?.(); mem = await page(MOBILE, "member"); await onboard(mem, S.base, "cma_member", "عضو عادي"); await call(mem, "PUT", `/api/communities/${cid}/membership`);
  S.app.ctx.rl.w?.clear?.(); mod = await page(DESKTOP, "moderator"); await onboard(mod, S.base, "cma_mod", "مشرف المجتمع"); await call(mod, "PUT", `/api/communities/${cid}/membership`);
  const modId = await meId(mod); await call(own, "PATCH", `/api/communities/${cid}/members/${modId}`, { role: "moderator" });
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("plain member: friendly message, no /admin call, no 403, no console error (390 + 1440)", async () => {
  for (const [opts, tag] of [[MOBILE, "390-light-ar"], [DESKTOP, "1440-dark-ar"]]) {
    await mem.setViewportSize(opts.viewport);
    if (tag.includes("dark")) await mem.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    mem.log.console.length = 0; mem.log.adminCalls.length = 0; mem.log.forbidden.length = 0;
    await open(mem, `#/cadmin/${cid}`);
    await mem.waitForSelector("#view .empty", { timeout: 8000 });
    assert.match(await mem.textContent("#view .empty"), /اللوحة لفريق الإشراف/);
    assert.ok(await mem.$(`#view .empty a[href="#/c/${cid}"]`), "link back to the community page");
    assert.deepEqual(mem.log.adminCalls, [], "GET /admin is never requested for a plain member");
    assert.deepEqual(mem.log.forbidden, [], "no 403 responses");
    assert.deepEqual(mem.log.console, [], "no console errors");
    await mem.screenshot({ path: path.join(SHOTS, `cadmin-as-member-${tag}.png`) }).catch(() => {});
  }
  // sub-route too
  await open(mem, `#/cadmin/${cid}?s=members`);
  assert.deepEqual(mem.log.adminCalls, []); assert.deepEqual(mem.log.console, []);
});

test("access endpoint: member false, moderator/owner true; moderator still opens the panel", async () => {
  assert.equal((await call(mem, "GET", `/api/communities/${cid}/admin/access`)).allowed, false);
  assert.equal((await call(mod, "GET", `/api/communities/${cid}/admin/access`)).allowed, true);
  assert.equal((await call(own, "GET", `/api/communities/${cid}/admin/access`)).allowed, true);
  assert.equal((await call(mem, "GET", `/api/communities/c_nope/admin/access`)).status, 404);
  await open(mod, `#/cadmin/${cid}`);
  await mod.waitForFunction(() => document.querySelector("#ca-body")?.children.length > 0, null, { timeout: 15000 });
  assert.ok(mod.log.adminCalls.length >= 1 && mod.log.adminCalls.every((s) => s === 200), "staff: /admin 200 " + JSON.stringify(mod.log)); assert.deepEqual(mod.log.forbidden, [], JSON.stringify(mod.log));
});
