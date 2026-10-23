/* v2.62: member badges in the community feed — «عضو جديد» for the first week, «🎉 سنة معنا» in the anniversary week;
 * the owner's identity switch hides them. axe 390 light / 1440 dark / LTR; screenshots for review. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, cid; const errors = [];
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
const page = async (opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const call = (p, method, u, body) => p.evaluate(async ([m, x, b]) => { const r = await fetch(x, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, u, body]);
async function axeRun(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document.querySelector("#c-feed") || document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png") }); } };

test("badges render next to author names; owner switch hides them; axe clean", async () => {
  const o = await page(); await onboard(o, S.base, "mb_owner", "مالكة الشارات");
  cid = (await call(o, "POST", "/api/communities", { name: "مجتمع الشارات", desc: "تجربة" })).community.id;
  const n = await page(); await onboard(n, S.base, "mb_newbie", "سارة الجديدة"); await call(n, "PUT", `/api/communities/${cid}/membership`);
  await call(n, "POST", "/api/posts", { id: "p_mbnew0001", type: "text", text: "مرحباً بالجميع، أنا جديدة هنا", community: cid });
  const v = await page(); await onboard(v, S.base, "mb_veteran", "خالد القديم"); await call(v, "PUT", `/api/communities/${cid}/membership`);
  const vid = await meId(v), oid = await meId(o);
  await call(v, "POST", "/api/posts", { id: "p_mbold0001", type: "text", text: "سنة كاملة معكم، شكراً", community: cid });
  await S.app.ctx.db.run("UPDATE memberships SET joined_at=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 365 * 864e5 - 7200e3).toISOString(), cid, vid]);
  await S.app.ctx.db.run("UPDATE memberships SET joined_at=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 60 * 864e5).toISOString(), cid, oid]);
  await call(o, "POST", "/api/posts", { id: "p_mbown0001", type: "text", text: "أهلاً بكم في المجتمع", community: cid });
  await n.context().close(); await v.context().close();

  const bad = [];
  await o.goto(S.base + "/?nosw#/c/" + cid); await o.waitForSelector("#c-feed .c-mb");
  const got = await o.$$eval("#c-feed .post-card", (cs) => cs.map((c) => [c.querySelector(".name")?.textContent, c.querySelector(".c-mb")?.textContent || ""]));
  assert.ok(got.some(([nm, b]) => nm.includes("سارة") && b.includes("عضو جديد")), JSON.stringify(got));
  assert.ok(got.some(([nm, b]) => nm.includes("خالد") && b.includes("سنة معنا")), JSON.stringify(got));
  assert.ok(got.some(([nm, b]) => nm.includes("مالكة") && b === ""), "no badge for a 60-day member");
  for (const x of await axeRun(o)) bad.push("390 light " + x);
  await o.evaluate(() => document.querySelector("#c-feed .c-mb")?.scrollIntoView({ block: "center" })); await shot(o, "badges-390-ar-light");

  const d = await page({ ...DESKTOP, colorScheme: "dark" }); await d.context().addCookies(await o.context().cookies());
  await d.goto(S.base + "/?nosw"); await d.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await d.evaluate(() => window.MPI18n.setLang("en"));
  await d.goto(S.base + "/?nosw#/c/" + cid); await d.waitForFunction(() => document.documentElement.dir === "ltr" && !!document.querySelector("#c-feed .c-mb"), null, { timeout: 15000 }); await d.waitForTimeout(400);
  const en = await d.$$eval("#c-feed .c-mb", (b) => b.map((x) => x.textContent));
  assert.ok(en.some((t) => t.includes("New member")) && en.some((t) => t.includes("1 year with us")), JSON.stringify(en));
  for (const x of await axeRun(d)) bad.push("1440 dark ltr " + x);
  await d.evaluate(() => document.querySelector("#c-feed .c-mb")?.scrollIntoView({ block: "center" })); await shot(d, "badges-1440-en-dark");
  await d.evaluate(() => window.MPI18n.setLang("ar")); await d.context().close();
  assert.deepEqual(bad, []);

  // owner turns badges off from community settings (general → tags card switch)
  await o.goto(S.base + "/?nosw#/cadmin/" + cid + "?s=general"); const sw = await o.waitForSelector('input[data-k="memberBadges"]', { timeout: 15000 });
  assert.equal(await sw.isChecked(), true, "default ON"); await shot(o, "settings-390-ar-light");
  await sw.scrollIntoViewIfNeeded(); await sw.click(); await o.click('#ca-save [data-ca="save"]');
  await o.waitForTimeout(800);
  assert.equal((await call(o, "GET", `/api/communities/${cid}/space`)).identity.memberBadges, false);
  await o.goto(S.base + "/?nosw#/c/" + cid); await o.waitForSelector("#c-feed .post-card"); await o.waitForTimeout(500);
  assert.equal(await o.$$eval("#c-feed .c-mb", (b) => b.length), 0, "switch off hides every badge");
  await o.context().close();
});
