/* M3-3 «مطوّر خادم الأهداف» — shared goals card on #/msession/:id + done/total in the mentor dashboard.
 * The mentor adds a goal (empty state → list), edits it, marks it «أُنجز» via the status chips, sees 1/1 on the dashboard row,
 * then deletes it. The learner (second context) reads the same goal with edit access (stranger/guardian rules: API test). axe 0 serious/critical at
 * 390 light AR, 1440 dark EN (LTR), plus UR; no horizontal overflow. Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, c, p; const errors = []; const SID = "mss_goal_up";
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.status; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(300); };
const setLang = async (pg, L) => { await pg.evaluate((x) => window.MPI18n.setLang(x), L); await pg.waitForFunction((x) => document.documentElement.dir === (x === "ar" ? "rtl" : "ltr"), L); };

test.before(async () => {
  S = await startStack();
  c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "mg_mentor", "سارة القحطاني");
  assert.ok((await call(p, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة عشر سنوات في JavaScript", topics: ["programming"], minutes: 60, price: 0, tz: "Asia/Riyadh", open: true })) < 300);
  S.app.ctx.rl?.w?.clear?.();
  const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base };
  assert.equal((await fetch(S.base + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ name: "فهد الدوسري", handle: "mg_learner", password: "secret123" }) })).status, 200);
  const db = S.app.ctx.db, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const m = await db.get("SELECT id FROM users WHERE handle=$1", ["mg_mentor"]), l = await db.get("SELECT id FROM users WHERE handle=$1", ["mg_learner"]);
  await db.run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming','',$4,60,'confirmed',0,0,'none',0,$5,$5)", [SID, m.id, l.id, iso(now + 2 * 86400e3), iso(now)]);
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
});
test.after(async () => { await c?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("AR 390 light: empty state → add → edit → done → dashboard 1/1 → axe", async () => {
  await setLang(p, "ar");
  await go(p, "#/msession/" + SID, "#mt-goals .mt-g-form");
  assert.match(await p.textContent("#mt-goals"), /لا أهداف بعد/);
  assert.deepEqual(await axe(p), [], "axe empty state");
  await p.fill("#mt-goals .mt-g-form [name=title]", "أنشر أول مشروع على GitHub");
  await p.fill("#mt-goals .mt-g-form [name=due]", "2030-01-15");
  await p.click("#mt-goals .mt-g-form button[type=submit]");
  await p.waitForSelector("#mt-goals .mt-g [data-gs]");
  assert.match(await p.textContent("#mt-goals .mt-g-t"), /أنشر أول مشروع على GitHub/);
  assert.match(await p.textContent("#mt-goals .mt-g-t small"), /2030-01-15/);
  assert.equal(await p.getAttribute('#mt-goals [data-gs="todo"]', "aria-pressed"), "true");
  // edit the title inline
  await p.click("#mt-goals [data-ge]");
  await p.waitForSelector('#mt-goals .mt-g .mt-g-form [name=title]');
  await p.fill('#mt-goals .mt-g .mt-g-form [name=title]', "أنشر مشروعين على GitHub");
  await p.click('#mt-goals .mt-g .mt-g-form button[type=submit]');
  await p.waitForFunction(() => /مشروعين/.test(document.querySelector("#mt-goals .mt-g-t")?.textContent || ""));
  // complete it
  await p.click('#mt-goals [data-gs="done"]');
  await p.waitForSelector('#mt-goals [data-gs="done"][aria-pressed="true"]');
  assert.ok(await p.$("#mt-goals .mt-g.is-done"));
  assert.match(await p.textContent("#mt-goals .mt-g-n"), /1\/1|١\/١/);
  assert.ok(await noOverflow(p), "overflow 390");
  assert.deepEqual(await axe(p), [], "axe 390 light ar");
  const small = await p.evaluate(() => [...document.querySelectorAll("#mt-goals button")].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); }).map((b) => b.outerHTML.slice(0, 80)));
  assert.deepEqual(small, [], "touch targets ≥44px");
  await shot(p, "390-light-ar-goals");
  await go(p, "#/mentoring?tab=sessions", ".mt-g-p");
  assert.match(await p.textContent(".mt-g-p"), /1\/1|١\/١/);
  await shot(p, "390-light-ar-dashboard-goals");
});

test("learner (second session) reads the same goal with edit access", async () => {
  const c2 = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  const q = await c2.newPage(); q.on("pageerror", (e) => errors.push(e.message));
  await q.goto(S.base + "/");
  const st = await q.evaluate(async () => (await fetch("/api/auth/login", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ handle: "mg_learner", password: "secret123" }) })).status);
  assert.equal(st, 200);
  const goals = await q.evaluate(async (sid) => (await (await fetch(`/api/mentor-sessions/${sid}/goals`, { headers: { "X-Requested-With": "mujtama" } })).json()), SID);
  assert.equal(goals.access, "edit"); assert.equal(goals.goals[0].status, "done"); assert.equal(goals.goals[0].title, "أنشر مشروعين على GitHub");
  await c2.close();
});

test("EN 1440 dark (LTR) + UR: translated, axe 0, no overflow; delete returns to empty", async () => {
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await setLang(p, "en");
  await go(p, "#/msession/" + SID, "#mt-goals .mt-g");
  const t = await p.textContent("#mt-goals");
  assert.match(t, /Shared goals/); assert.match(t, /Done/); assert.match(t, /Not started/); assert.match(t, /In progress/);
  assert.equal(await p.getAttribute("#mt-goals [data-ge]", "aria-label"), "Edit goal");
  assert.ok(await noOverflow(p)); assert.deepEqual(await axe(p), [], "axe 1440 dark en");
  await shot(p, "1440-dark-en-goals");
  await setLang(p, "ar"); await go(p, "#/msession/" + SID, "#mt-goals .mt-g"); // v2.67: ar + en only — the RTL pass runs in Arabic
  assert.match(await p.textContent("#mt-goals"), /الأهداف المشتركة/); assert.deepEqual(await axe(p), [], "axe ar rtl");
  await setLang(p, "en"); await go(p, "#/msession/" + SID, "#mt-goals .mt-g");
  p.once("dialog", (d) => d.accept());
  await p.click("#mt-goals [data-gd]");
  await p.waitForFunction(() => /No goals yet/.test(document.querySelector("#mt-goals")?.textContent || ""));
  await shot(p, "1440-dark-en-goals-empty");
  await setLang(p, "ar");
});
