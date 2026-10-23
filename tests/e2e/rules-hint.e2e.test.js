/* v2.62 lf-rules-hint — the community composer shows the community's top 3 rules in a small collapsible line with
 * «عرض الكل» (opens the about tab). Hidden for a community without rules; collapsing is remembered per community. */
const test = require("node:test"), assert = require("node:assert");
const path = require("node:path");
const { startStack, tourDone, MOBILE, DESKTOP } = require("./harness");
let S, cid, bare, O, U; const errors = [];
const SHOTS = process.env.RH_SHOTS || "";
const reg = async (handle, name) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name, handle, password: "secret1234" }) }); const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); await tourDone(S.base, ck); return ck; };
const api = (ck) => async (m, p, b) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + p, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const page = async (ck, opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); await c.addCookies(ck.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: S.base }; })); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(S.base + "/?nosw"); await p.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 }); await p.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/home"; route(); }); await p.waitForSelector(".bottomnav a[data-r=home], .side a[data-r=home], a[data-r=home]", { state: "attached", timeout: 20000 }); return p; };
const compose = async (p, id) => { await p.evaluate((x) => { location.hash = "#/c/" + x; }, id); await p.waitForSelector("#c-compose", { timeout: 15000 }); await p.click("#c-compose"); await p.waitForSelector("#composer3[data-mode=community]"); };
async function axeOn(p) {
  if (!(await p.evaluate(() => !!window.axe))) await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (await p.evaluate(async () => (await axe.run(document.querySelector("#composer3"), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => ({ id: v.id, impact: v.impact, sel: v.nodes[0]?.target?.join(" ") })))).filter((v) => ["serious", "critical"].includes(v.impact));
}
test.before(async () => {
  S = await startStack();
  O = await reg("rh_owner", "مالك القواعد"); U = await reg("rh_member", "عضو القواعد");
  const o = api(O);
  cid = (await o("POST", "/api/communities", { name: "مجتمع القواعد", desc: "اختبار تذكير القواعد", topic: "dev", rules: ["الاحترام أولاً", "لا رسائل مزعجة", "انشر في القناة الصحيحة", "لا روابط مشبوهة"] })).community.id;
  bare = (await o("POST", "/api/communities", { name: "مجتمع بلا قواعد", desc: "بلا قواعد", topic: "dev" })).community.id;
  await api(U)("PUT", `/api/communities/${cid}/membership`); await api(U)("PUT", `/api/communities/${bare}/membership`);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("rules hint: top 3 rules + «عرض الكل», collapse remembered per community, hidden without rules, axe clean", async () => {
  const u = await page(U);
  await compose(u, cid);
  await u.waitForSelector("#c3-rhint");
  assert.equal(await u.$$eval("#c3-rh-l span", (x) => x.length), 3, "exactly the top 3 rules");
  assert.match(await u.textContent("#c3-rh-l"), /الاحترام أولاً[\s\S]*لا رسائل مزعجة[\s\S]*انشر في القناة الصحيحة/);
  assert.doesNotMatch(await u.textContent("#c3-rh-l"), /روابط مشبوهة/);
  assert.equal(await u.getAttribute("#c3-rh-all", "href"), `#/c/${cid}/about`);
  assert.ok(await u.$("#composer3 .c3-rules"), "the existing full rules list is untouched");
  assert.match(await u.textContent("#c3-rh-t"), /أهم القواعد/, "hint title differs from the full list heading");
  assert.match(await u.textContent("#composer3 .c3-rules summary"), /قواعد المجتمع/, "old section keeps its heading");
  const box = await u.$eval("#c3-rh-t", (b) => b.getBoundingClientRect().height); assert.ok(box >= 44, "touch target ≥44px");
  assert.ok(await u.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
  assert.deepEqual(await axeOn(u), []);
  if (SHOTS) await u.screenshot({ path: path.join(SHOTS, "rules-hint-390-ar-light.png") });
  // collapse → remembered after reopening
  await u.click("#c3-rh-t");
  assert.equal(await u.getAttribute("#c3-rh-t", "aria-expanded"), "false"); assert.equal(await u.isVisible("#c3-rh-l"), false); assert.equal(await u.isVisible("#c3-rh-all"), false);
  if (SHOTS) await u.screenshot({ path: path.join(SHOTS, "rules-hint-390-ar-light-collapsed.png") });
  await u.click("#c3-x"); await u.waitForSelector("#composer3", { state: "detached" });
  await compose(u, cid);
  assert.equal(await u.getAttribute("#c3-rh-t", "aria-expanded"), "false", "collapsed state persists");
  assert.equal(await u.isVisible("#c3-rh-l"), false);
  await u.click("#c3-rh-t"); assert.equal(await u.isVisible("#c3-rh-l"), true);
  assert.equal(await u.evaluate((id) => localStorage.getItem("mp_rh_" + id), cid), null, "expanding clears the mark");
  // «عرض الكل» closes the editor and opens the rules
  await u.click("#c3-rh-all"); await u.waitForSelector("#composer3", { state: "detached" });
  await u.waitForSelector(".c-rcards .c-rc", { timeout: 15000 }); assert.match(await u.evaluate(() => location.hash), /\/about$/);
  // no rules → no line
  await compose(u, bare);
  assert.equal(await u.$("#c3-rhint"), null, "hidden for a community without rules");
  await u.context().close();
});

test("rules hint: 1440 dark + LTR (en): translated link, axe clean", async () => {
  const d = await page(U, { ...DESKTOP, colorScheme: "dark" });
  await d.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await d.evaluate(() => window.MPI18n.setLang("en"));
  await d.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 15000 });
  await compose(d, cid); await d.waitForSelector("#c3-rhint");
  await d.waitForFunction(() => /See all/.test(document.querySelector("#c3-rh-all")?.textContent || ""), null, { timeout: 8000 });
  assert.match(await d.textContent("#c3-rh-t"), /Key rules/);
  assert.deepEqual(await axeOn(d), []);
  if (SHOTS) await d.screenshot({ path: path.join(SHOTS, "rules-hint-1440-en-dark.png") });
  await d.evaluate(() => window.MPI18n.setLang("ar")); await d.context().close();
});

test("full rules list renders { title, text } objects (never «[object Object]») and keeps strings", async () => {
  const u = await page(U);
  await u.evaluate((x) => { location.hash = "#/c/" + x; }, cid); await u.waitForSelector("#c-compose", { timeout: 15000 });
  await u.evaluate((x) => { const c = S.community(x); c.rules = [{ title: "الاحترام أولاً", text: "لا إساءة لأي عضو" }, "لا رسائل مزعجة", { title: "", text: "نص بلا عنوان" }, {}]; }, cid);
  await u.click("#c-compose"); await u.waitForSelector("#composer3[data-mode=community]");
  const items = await u.$$eval("#composer3 .c3-rules li", (x) => x.map((li) => li.textContent.trim()));
  assert.deepEqual(items, ["الاحترام أولاً — لا إساءة لأي عضو", "لا رسائل مزعجة", "نص بلا عنوان"], JSON.stringify(items));
  assert.doesNotMatch(await u.textContent("#composer3"), /object Object/);
  await u.context().close();
});
