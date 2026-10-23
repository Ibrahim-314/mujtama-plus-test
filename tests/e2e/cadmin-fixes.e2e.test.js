/* v2.61.1 — admin panel fixes in a real browser: directory category «بدون» survives save + reload (B1), an empty
 * community name shows an inline error (aria-invalid + aria-describedby) and takes focus (B14), free-text fields get
 * dir="auto" (B15), automod switches/chips have ≥44px touch targets (B13). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, p, cid; const errors = [];
const call = (m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const open = async (s) => {
  await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, `#/cadmin/${cid}?s=${s}`);
  await p.waitForFunction(() => document.querySelector("#ca-body")?.children.length > 0 && !document.querySelector("#ca-body .skel"), null, { timeout: 15000 });
  await p.waitForTimeout(200);
};
test.before(async () => {
  S = await startStack();
  const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "cfx_owner", "مالك الإصلاحات");
  cid = (await call("POST", "/api/communities", { name: "مجتمع الإصلاحات", desc: "وصف عربي.", topic: "dev" })).community.id;
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("B1: «بدون» is kept after save and reload", async () => {
  await open("general");
  assert.equal(await p.$eval('[data-k="category"]', (s) => s.value), "dev", "unset → topic preselected");
  await p.selectOption('[data-k="category"]', "none");
  await p.click('[data-ca="save"]'); await p.waitForFunction(() => !document.body.classList.contains("ca-dirty"), null, { timeout: 8000 });
  assert.equal((await call("GET", `/api/communities/${cid}/space`)).identity.category, null);
  await p.reload(); await p.waitForFunction(() => window.DB && typeof save === "function"); await open("general");
  assert.equal(await p.$eval('[data-k="category"]', (s) => s.value), "none", "still «بدون» after reload");
});

test("B14 + B15: empty name → inline error, aria-invalid, described-by, focus; text fields are dir=auto", async () => {
  await open("general");
  assert.equal(await p.$eval('[data-k="desc"]', (e) => e.getAttribute("dir")), "auto");
  assert.equal(await p.$eval('[data-k="name"]', (e) => e.getAttribute("dir")), "auto");
  await p.fill('[data-k="name"]', ""); await p.evaluate(() => document.activeElement?.blur());
  await p.click('[data-ca="save"]');
  await p.waitForFunction(() => document.querySelector("#ca-name")?.getAttribute("aria-invalid") === "true", null, { timeout: 5000 });
  const st = await p.evaluate(() => { const i = document.querySelector("#ca-name"), e = document.querySelector("#ca-name-e"); return { focus: document.activeElement === i, desc: i.getAttribute("aria-describedby"), shown: !e.hidden && e.textContent.trim().length > 0 }; });
  assert.ok(st.focus, "focus moved to the name field"); assert.ok(st.desc.split(" ").includes("ca-name-e"), "error linked via aria-describedby"); assert.ok(st.shown, "message visible");
  assert.equal((await call("GET", `/api/communities/${cid}/space`)).community.name, "مجتمع الإصلاحات", "nothing saved");
  await p.type('[data-k="name"]', "مجتمع جديد");
  assert.equal(await p.$eval("#ca-name", (i) => i.getAttribute("aria-invalid")), null, "typing clears the error");
  assert.ok(await p.$eval("#ca-name-e", (e) => e.hidden));
  await p.click('[data-ca="discard"]').catch(() => {});
});

test("B13: automod has no interactive element under 32px (switches/chips ≥44px)", async () => {
  await open("automod");
  const small = await p.evaluate(() => [...document.querySelectorAll("#view button, #view a, #view [role=button], #view input[type=checkbox]")].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && b.height < 32 && e.offsetParent && !e.closest(".ca-strip"); }).map((e) => e.className + "|" + e.getBoundingClientRect().height));
  assert.deepEqual(small, []);
  const sw = await p.$eval("#ca-body .switch", (e) => e.getBoundingClientRect().height); assert.ok(sw >= 44, "switch hit area " + sw);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal overflow");
});
