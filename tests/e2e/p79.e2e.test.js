/* global Remote */
/* Phase 79 e2e (teams & group projects) against the REAL server (production build), mobile viewport.
 * Owner = staff (first account, 390 light): creates a listed project from #/teams/new, invites the member, adds a task in the
 *   sheet (assignee, priority), shares a link, replies to an update, changes a role, creates an invite link, accepts a join
 *   request on a second listed project.
 * Member (360 dark): accepts the invite in #/teams, moves the task on the board, posts an update, browses the directory,
 *   asks to join the second project, joins a private team by invite link.
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy `teams` chunk (after
 * `work`); no inline handlers / styles / javascript: URLs; tap targets ≥ 44 px. Screenshots → tests/visual/output/p79-*. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u, tid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
const sheetHas = (pg, sel) => until(pg, (s) => !!document.querySelector("#sheet:not(.hidden) " + s), sel);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output"); // SHOTS_DIR: private output dir for parallel runs
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `p79-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const dark = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

test.before(async () => {
  S = await startStack();
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message));
  p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "p79_admin", "ليلى المديرة"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "سارة المطوّرة", handle: "p79_sara", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("member: " + e.message));
  u.on("dialog", (d) => d.accept());
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("owner creates a project, invites, assigns; member accepts, moves the task, posts; files; roles", async () => {
  await go(p, "#/settings?s=acct"); await until(p, () => !!document.querySelector('#view a[href="#/teams"]'));
  assert.equal(await p.evaluate(() => !!window.MPTeams), false, "lazy chunk not loaded yet");
  rl(); await go(p, "#/teams"); await textHas(p, /لا فرق بعد/); assert.equal(await p.evaluate(() => !!window.MPTeams && !!window.MPWork), true, "teams chunk loads after work");
  assert.deepEqual(await axe(p), [], "hub empty");
  await go(p, "#/teams/new"); await until(p, () => !!document.querySelector("#wt-f"));
  await p.fill("#wt-f [name=name]", "تطبيق مكتبة الحي"); await p.fill("#wt-f [name=about]", "تطبيق لإعارة الكتب بين الجيران مع خريطة للمكتبات المنزلية.");
  await p.selectOption("#wt-f [name=visibility]", "listed"); await p.fill("#wt-f [name=title]", "مديرة المشروع");
  assert.deepEqual(await axe(p), [], "new team"); await shot(p, "new-390-light");
  rl(); await tap(p, "#wt-f [type=submit]"); await until(p, () => /^#\/team\/[^/?]+$/.test(location.hash)); await textHas(p, /للتنفيذ/);
  tid = await p.evaluate(() => location.hash.split("/")[2]);
  // invite the member
  await go(p, `#/team/${tid}?tab=members`); await until(p, () => !!document.querySelector("#wt-inv"));
  await p.fill("#wt-inv [name=handle]", "p79_sara"); rl(); await tap(p, "#wt-inv [type=submit]"); await until(p, () => /سارة المطوّرة/.test(document.querySelector("#wt-tab")?.textContent || ""));
  rl(); await go(u, "#/teams"); await until(u, () => !!document.querySelector("[data-inv][data-ok]")); await dark(u); await u.waitForTimeout(200);
  assert.deepEqual(await axe(u), [], "invites dark"); await shot(u, "invites-360-dark");
  rl(); await tap(u, "[data-inv][data-ok]"); await until(u, () => /^#\/team\//.test(location.hash)); await textHas(u, /للتنفيذ/);
  // owner adds a task for the member
  rl(); await go(p, "#/teams"); await go(p, "#/team/" + tid); await until(p, () => !!document.querySelector("#wt-add"));
  await tap(p, "#wt-add"); await sheetHas(p, "#wt-tf"); assert.deepEqual(await axe(p), [], "task sheet");
  await p.fill("#wt-tf [name=title]", "تصميم شاشة الإعارة"); await p.fill("#wt-tf [name=body]", "شاشة واحدة بسيطة مع زر طلب الإعارة.");
  const sara = await S.app.ctx.db.get("SELECT id FROM users WHERE handle='p79_sara'");
  await p.selectOption("#wt-tf [name=assignee]", sara.id); await p.selectOption("#wt-tf [name=priority]", "high"); await p.fill("#wt-tf [name=due]", "2030-01-15");
  rl(); await p.click("#wt-tf [type=submit]"); await until(p, () => !!document.querySelector(".wt-task"));
  await tap(p, "#wt-add"); await sheetHas(p, "#wt-tf"); await p.fill("#wt-tf [name=title]", "قاعدة بيانات الكتب"); rl(); await p.click("#wt-tf [type=submit]"); await until(p, () => document.querySelectorAll(".wt-task").length === 2);
  assert.ok((await minTap(p, ".wt-task .btn, #wt-add")) >= 44, "44px board actions");
  assert.deepEqual(await axe(p), [], "board light"); await shot(p, "board-390-light");
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM notifications WHERE kind='team_task'"));
  // member moves the task to «قيد العمل»
  rl(); await go(u, "#/teams"); await go(u, "#/team/" + tid); await until(u, () => !!document.querySelector(".wt-task.mine [data-to=doing]"));
  rl(); await tap(u, ".wt-task.mine [data-to=doing]"); await until(u, () => !!document.querySelector("#wt-c-doing")?.closest("section").querySelector(".wt-task"));
  assert.deepEqual(await axe(u), [], "board dark"); await shot(u, "board-360-dark");
  // member posts an update; owner replies
  await go(u, `#/team/${tid}?tab=updates`); await until(u, () => !!document.querySelector("#wt-pf"));
  await u.fill("#wt-pf [name=body]", "بدأت بتصميم شاشة الإعارة، أرفع النسخة الأولى غداً."); rl(); await tap(u, "#wt-pf [type=submit]"); await until(u, () => !!document.querySelector(".wt-up"));
  assert.deepEqual(await axe(u), [], "updates dark");
  rl(); await go(p, `#/team/${tid}?tab=updates`); await until(p, () => !!document.querySelector("[data-rp]"));
  await p.fill("[data-rp] [name=body]", "ممتاز، بانتظارها"); rl(); await tap(p, "[data-rp] [type=submit]"); await until(p, () => !!document.querySelector(".wt-reply"));
  assert.deepEqual(await axe(p), [], "updates light"); await shot(p, "updates-390-light");
  // files & links
  await go(p, `#/team/${tid}?tab=files`); await until(p, () => !!document.querySelector("#wt-if"));
  await p.fill("#wt-if [name=title]", "مستودع الكود"); await p.fill("#wt-if [name=url]", "https://github.com/example/library"); rl(); await tap(p, "#wt-if [type=submit]");
  await until(p, () => !!document.querySelector('.wt-items a[href="https://github.com/example/library"]'));
  assert.deepEqual(await axe(p), [], "files light");
  // members: role change + invite link
  await go(p, `#/team/${tid}?tab=members`); await until(p, () => !!document.querySelector("[data-role]"));
  rl(); await p.selectOption("[data-role]", "admin"); await until(p, () => /مشرف/.test(document.querySelector(".wt-mem")?.textContent || ""));
  rl(); await tap(p, "#wt-lnk [type=submit]"); await until(p, () => !!document.querySelector("[data-cp]"));
  assert.ok((await minTap(p, ".wt-mem .btn, #wt-tab .wk-acts .btn, [data-role]")) >= 44, "44px member controls");
  assert.deepEqual(await axe(p), [], "members light"); await shot(p, "members-390-light");
  await dark(u); await go(u, `#/team/${tid}?tab=members`); await until(u, () => !!document.querySelector(".wt-mem")); await u.waitForTimeout(200); assert.deepEqual(await axe(u), [], "members dark");
});

test("directory, join request, invite link, contract link; CSP", async () => {
  rl(); const second = await p.evaluate(async () => (await Remote.api("POST", "/api/teams", { name: "ترجمة كتب الأطفال", kind: "project", about: "ترجمة قصص قصيرة للأطفال إلى العربية", visibility: "listed" })).id);
  rl(); await go(u, "#/teams?tab=directory"); await until(u, () => !!document.querySelector("#wt-sf")); await u.fill("#wt-sf [name=q]", "ترجمه"); await tap(u, "#wt-sf [type=submit]");
  await until(u, () => document.querySelectorAll("#wt-l .list li").length === 1); assert.deepEqual(await axe(u), [], "directory dark"); await shot(u, "directory-360-dark");
  await tap(u, "#wt-l .list a.li"); await until(u, () => !!document.querySelector("#wt-rq")); assert.deepEqual(await axe(u), [], "outsider dark");
  rl(); await tap(u, "#wt-rq"); await textHas(u, /طلبك بانتظار الرد/);
  rl(); await go(p, `#/team/${second}?tab=members`); await until(p, () => !!document.querySelector("[data-rq][data-ok]"));
  rl(); await tap(p, "[data-rq][data-ok]"); await until(p, () => /سارة المطوّرة/.test(document.querySelector(".wt-mem")?.textContent || ""));
  // private team + invite link
  rl(); const priv = await p.evaluate(async () => (await Remote.api("POST", "/api/teams", { name: "فريق المراجعة الداخلي", kind: "team" })).id);
  rl(); const link = await p.evaluate(async (t) => (await Remote.api("POST", `/api/teams/${t}/invites`, { link: true, days: 3 })).code, priv);
  rl(); await go(u, "#/teams/join/" + link); await until(u, () => !!document.querySelector("#wt-join")); assert.deepEqual(await axe(u), [], "join link dark"); await shot(u, "join-360-dark");
  rl(); await tap(u, "#wt-join"); await until(u, (t) => location.hash === "#/team/" + t, priv);
  // contract → team link (unpaid contract between the two)
  rl(); const cid = await p.evaluate(async () => (await Remote.api("POST", "/api/contracts", { to: "p79_sara", title: "تصميم تطبيق المكتبة", scope: "تصميم واجهات تطبيق مكتبة الحي كاملة مع ملفات مصدرية ودليل ألوان.", milestones: [{ title: "الواجهات" }] })).id);
  rl(); await u.evaluate(async (c) => Remote.api("POST", `/api/contracts/${c}/respond`, { accept: true }), cid);
  await go(p, "#/contract/" + cid); await until(p, (c) => !!document.querySelector(`a[href="#/teams/new?contract=${c}"]`), cid);
  await tap(p, `a[href="#/teams/new?contract=${cid}"]`); await until(p, () => !!document.querySelector("#wt-f [name=contract]"));
  assert.equal(await p.inputValue("#wt-f [name=contract]"), cid); assert.equal(await p.inputValue("#wt-f [name=name]"), "تصميم تطبيق المكتبة");
  rl(); await tap(p, "#wt-f [type=submit]"); await until(p, () => /^#\/team\//.test(location.hash)); await textHas(p, /مرتبط بعقد/);
  await go(p, "#/contracts"); await go(p, "#/contract/" + cid); await until(p, () => !!document.querySelector('#wk-cv a[href^="#/team/"]'));
  assert.deepEqual(errors, []);
  const inline = await u.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name)) || (!!e.getAttribute("style") && !!e.closest("#view .wk-page"))).map((e) => e.outerHTML.slice(0, 160)));
  assert.deepEqual(inline, []);
  const src = fs.readFileSync(path.join(__dirname, "../..", "teams-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /teams-ui\.js" data-chunk="teams"/);
});
