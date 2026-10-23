/* v2.62 «جديد منذ زيارتك» — inside a channel a thin line marks where the member's unread starts, from the existing
 * channel_reads (no migration). Shown only when the channel has unread posts AND the member had a previous read;
 * gone once everything is read. API: lastSeenAt is the member's own, null for a visitor / first-time reader. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, tourDone, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.NEW_SINCE_SHOTS || "";
let S, cid, chId, O, U; const errors = [];
const reg = async (handle, name) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name, handle, password: "secret1234" }) }); const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); await tourDone(S.base, ck); return ck; };
const api = (ck) => async (m, p, b) => { S.app.ctx.rl.w?.clear?.(); const h = { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }; if (ck) h.Cookie = ck; const r = await fetch(S.base + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const page = async (ck, opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); await c.addCookies(ck.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: S.base }; })); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(S.base + "/?nosw"); await p.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 }); await p.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/home"; route(); }); await p.waitForSelector(".bottomnav a[data-r=home]", { state: "visible", timeout: 20000 }); return p; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const chOf = async (ck) => (await api(ck)("GET", `/api/communities/${cid}/channels`)).channels.find((c) => c.id === chId);
async function axeRun(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const openCh = async (p) => { await p.goto(S.base + "/?nosw#/c/" + cid); await p.waitForSelector(`[data-ch="${chId}"]`); await p.click(`[data-ch="${chId}"]`); await p.waitForFunction(() => /منشور-/.test(document.querySelector("#c-feed")?.textContent || ""), null, { timeout: 15000 }); await p.waitForTimeout(300); };
const order = (p) => p.evaluate(() => [...document.querySelector("#c-feed").children].map((el) => (el.classList.contains("c-new") ? "NEW" : (el.textContent.match(/منشور-(\w+)/) || [])[1] || "?")));

test.before(async () => {
  S = await startStack();
  O = await reg("ns_owner", "مالك القناة"); U = await reg("ns_member", "عضو القناة");
  cid = (await api(O)("POST", "/api/communities", { name: "مجتمع الفاصل", desc: "تجربة جديد منذ زيارتك", topic: "dev" })).community.id;
  chId = (await api(O)("POST", `/api/communities/${cid}/channels`, { name: "نقاشات", viewPerm: "public" })).channel.id;
  await api(U)("PUT", `/api/communities/${cid}/membership`);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("API: lastSeenAt is null before a first read and for visitors, the member's own after a read", async () => {
  await api(O)("POST", "/api/posts", { community: cid, channel: chId, text: "منشور-A قديم" });
  assert.equal((await chOf(U)).lastSeenAt, null, "no previous read → no divider data");
  assert.equal((await chOf(null)).lastSeenAt ?? null, null, "visitor gets nothing");
  assert.equal((await chOf(U)).unread, 1);
  await api(U)("POST", `/api/communities/${cid}/channels/${chId}/read`);
  const c = await chOf(U); assert.ok(c.lastSeenAt && !Number.isNaN(Date.parse(c.lastSeenAt))); assert.equal(c.unread, 0);
  assert.equal((await chOf(O)).lastSeenAt, null, "another member's read is not leaked");
});

test("UI: divider under the new posts (above the last-seen one), gone after re-open; first-time reader sees none", async () => {
  await wait(30);
  await api(O)("POST", "/api/posts", { community: cid, channel: chId, text: "منشور-B جديد" }); await wait(20);
  await api(O)("POST", "/api/posts", { community: cid, channel: chId, text: "منشور-C أحدث" });
  const u = await page(U); await openCh(u);
  assert.deepEqual(await order(u), ["C", "B", "NEW", "A"], "divider right where the unread starts");
  assert.match(await u.textContent(".c-new"), /جديد منذ زيارتك/);
  assert.equal(await u.getAttribute(".c-new", "role"), "separator");
  for (const v of await axeRun(u)) assert.fail("axe 390 light: " + v);
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await u.locator(".c-new").scrollIntoViewIfNeeded(); await u.screenshot({ path: path.join(SHOTS, "new-since-390-ar-light.png") }); }
  // switch away and back: everything is read now → no divider
  await u.click('[data-ch=""]'); await u.waitForTimeout(300); await u.click(`[data-ch="${chId}"]`); await u.waitForTimeout(600);
  assert.equal(await u.$(".c-new"), null, "hidden when all read (same page)");
  await openCh(u); assert.equal(await u.$(".c-new"), null, "hidden when all read (reload)");
  await u.context().close();
  // the owner never opened the channel → no previous read → no divider even with posts
  const o = await page(O); await openCh(o); assert.equal(await o.$(".c-new"), null); await o.context().close();
});

test("UI: 1440 en dark (LTR) shows the translated divider; axe clean; own posts alone add no divider", async () => {
  await wait(30); await api(O)("POST", "/api/posts", { community: cid, channel: chId, text: "منشور-D للغة" });
  const d = await page(U, { ...DESKTOP, colorScheme: "dark" }); await d.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await d.evaluate(() => window.MPI18n.setLang("en"));
  await d.goto(S.base + "/?nosw#/c/" + cid); await d.waitForFunction(() => document.documentElement.dir === "ltr", null, { timeout: 15000 });
  await openCh(d); await d.waitForFunction(() => /New since your visit/.test(document.querySelector(".c-new")?.textContent || ""), null, { timeout: 10000 });
  assert.equal((await order(d)).indexOf("NEW"), 1);
  for (const v of await axeRun(d)) assert.fail("axe 1440 dark en: " + v);
  if (SHOTS) { await d.evaluate(() => document.querySelector(".c-new").scrollIntoView({ block: "center" })); await d.waitForTimeout(200); } if (SHOTS) await d.screenshot({ path: path.join(SHOTS, "new-since-1440-en-dark.png") });
  await d.evaluate(() => window.MPI18n.setLang("ar")); await d.context().close();
  await wait(30); await api(U)("POST", "/api/posts", { community: cid, channel: chId, text: "منشور-E مني" });
  assert.equal((await chOf(U)).unread, 0); const u = await page(U); await openCh(u); assert.equal(await u.$(".c-new"), null, "own post is not «new»"); await u.context().close();
});
