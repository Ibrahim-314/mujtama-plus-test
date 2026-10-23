/* Phases 55 + 60 e2e against the REAL server (production build, Pi payments off like production).
 * P60: journals posted straight into the ledger (Pi is off) → #/wallet links → #/statement (totals, lines, category filter,
 * CSV link) → #/invoice/:id (document + print button) → #/annual → #/finance-report (public, k-anonymous) → #/admin/finance
 * (reconciliation + annual lookup) → /transparency/finance SSR. axe: no serious/critical WCAG A/AA issues on the new screens.
 * P55: core tap targets ≥ 44 px on home (top icons, tabs, buttons, bottom nav), RTL chip margins, skeleton aria-busy.
 * No page errors; finance chunk lazy, no inline handlers; core budget kept. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p, me; const errors = [];
const until = async (fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
async function axe() {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "fn_e2e", "مختبر مالي"); // first account → admin
  const { db } = S.app.ctx;
  me = await db.get("SELECT id FROM users WHERE handle='fn_e2e'");
  const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name: "مبدعة", handle: "fn_creator", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const other = await db.get("SELECT id FROM users WHERE handle='fn_creator'");
  const { createLedger, ACC } = require(path.join(ROOT, "server", "lib", "ledger"));
  const L = createLedger({ now: () => new Date().toISOString() });
  await db.tx((t) => L.postJournal(t, { ikey: "e2e:tip", kind: "tip", source: "tip", refId: "tip_e2e", creatorId: other.id, senderId: me.id, lines: [{ account: ACC.out(me.id), userId: me.id, debit: 25000000 }, { account: ACC.earn(other.id), userId: other.id, credit: 24000000 }, { account: ACC.fees, credit: 1000000 }] }));
  await db.tx((t) => L.postJournal(t, { ikey: "e2e:ai", kind: "ai_subscription", source: "ai", refId: "ais_e2e", senderId: me.id, lines: [{ account: ACC.out(me.id), userId: me.id, debit: 10000000 }, { account: "platform:ai", credit: 10000000 }] }));
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("P60: wallet → statement (filter, CSV) → invoice (print) → annual → public report → admin reconciliation; axe clean", async () => {
  await p.goto(S.base + "/?nosw#/wallet");
  await p.waitForSelector('a[href="#/statement"]', { timeout: 20000 });
  await p.click('a[href="#/statement"]');
  await until(() => document.querySelectorAll("#fn-l li").length === 2);
  assert.match(await p.textContent("#fn-s"), /3\.5/);
  assert.match(await p.getAttribute("#fn-csv", "href"), /^\/api\/finance\/statement\.csv/);
  const csv = await p.request.get(S.base + (await p.getAttribute("#fn-csv", "href"))); assert.equal(csv.status(), 200); assert.match(await csv.text(), /إكرامية/);
  assert.deepEqual(await axe(), []);
  await p.selectOption("#fn-cat", "ai"); await p.click("#fn-sf .btn");
  await until(() => /category=ai/.test(location.hash) && document.querySelectorAll("#fn-l li").length === 1);
  await p.click("#fn-l li a");
  await until(() => /^#\/invoice\//.test(location.hash) && !!document.querySelector(".fn-doc"));
  assert.match(await p.textContent(".fn-doc"), /INV-\d{4}-00000\d/);
  assert.ok(await p.$("#fn-print")); assert.match(await p.getAttribute('a[download][href*="/html"]', "href"), /download=1/);
  assert.deepEqual(await axe(), []);
  await p.goto(S.base + "/?nosw#/annual");
  await until(() => /ما دفعته في/.test(document.querySelector("#fn-a")?.textContent || "") && /3\.5/.test(document.querySelector("#fn-a")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/finance-report");
  await until(() => /الاحتياطيات الآن/.test(document.querySelector("#fn-r")?.textContent || ""));
  assert.ok(!/fn_e2e/.test(await p.textContent("#fn-r")), "no member names on the public report");
  assert.deepEqual(await axe(), []);
  await p.goto(S.base + "/?nosw#/admin");
  await p.waitForSelector("#fn-adm", { timeout: 20000 });
  await p.click("#fn-adm");
  await until(() => /السجل متوازن: نعم/.test(document.querySelector("#fn-rr")?.textContent || ""));
  await p.fill('#fn-af input[name="user"]', "@fn_e2e"); await p.click("#fn-af .btn");
  await until(() => /ما دفعته في/.test(document.querySelector("#fn-ar")?.textContent || ""));
  const ssr = await p.request.get(S.base + "/transparency/finance"); assert.equal(ssr.status(), 200); assert.match(await ssr.text(), /الشفافية المالية/);
  assert.deepEqual(errors, []);
});

test("P55: tap targets ≥ 44 px on core screens, logical chip margins, busy skeleton", async () => {
  await p.goto(S.base + "/?nosw#/home");
  await p.waitForSelector(".topbar .top-actions .icon-btn", { timeout: 20000 }); // v2.52: the bar starts with the (hidden on tab roots) back button
  const small = await p.evaluate(() => [...document.querySelectorAll(".topbar .icon-btn, .tab, .btn, .seg button, .bottomnav a")].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { c: e.className, h: Math.round(r.height), w: Math.round(r.width) }; }).filter((x) => x.h < 44 || x.w < 44));
  assert.deepEqual(small, []);
  const m = await p.evaluate(() => { const c = document.createElement("span"); c.className = "chip"; document.body.append(c); const s = getComputedStyle(c); const r = [s.marginLeft, s.marginRight]; c.remove(); return r; });
  assert.deepEqual(m, ["4px", "0px"], "RTL: chip end margin is on the left");
  await p.goto(S.base + "/?nosw#/settings");
  await p.waitForTimeout(400);
  assert.deepEqual(await axe(), []);
  assert.deepEqual(errors, []);
});

test("build: finance chunk lazy, no inline handlers; core JS + CSS within budget", () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file)); assert.ok(core.br <= 90 * 1024, "core " + core.br);
  const css = b.files.find((f) => /^assets\/app-.*\.css$/.test(f.file)); assert.ok(css.br <= 16 * 1024, "css " + css.br) /* v2.53: same CSS budget as tools/budget.mjs (14→16 KB) */;
  const ch = b.files.find((x) => /chunk-finance-.*\.js$/.test(x.file)); assert.ok(ch, "finance chunk built");
  const src = fs.readFileSync(path.join(ROOT, "dist", ch.file), "utf8"); assert.ok(!/\son[a-z]+=["']/.test(src) && !/javascript:/.test(src));
  assert.ok(!/finance-ui/.test(fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8")));
  assert.match(fs.readFileSync(path.join(ROOT, "chunks.js"), "utf8"), /class="wrap" aria-busy="true"/, "route skeleton announces loading");
});
