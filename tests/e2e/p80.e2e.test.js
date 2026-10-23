/* global Remote */
/* Phase 80 e2e (professional reputation & verified reviews) against the REAL server (production build), mobile viewport.
 * Client = staff (first account, 390 light) and worker (360 dark) complete an unpaid contract; the client reviews from
 * #/reviews (pending → form with stars, criteria, skill endorsement), the review stays hidden until the worker reviews back,
 * the worker responds, the CV shows the reputation strip, #/reviews/u/:handle shows score + badges + endorsements, the talent
 * directory shows the rating, endorsements from the reputation page, a report reaches #/admin/reviews and is dismissed.
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy `proreviews` chunk
 * (after `work`); no inline handlers / styles / javascript: URLs; tap targets ≥ 44 px. Screenshots → tests/visual/output/p80-*. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u, cid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output"); // SHOTS_DIR: private output dir for parallel runs
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `p80-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const dark = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
const SCOPE = "مراجعة نصوص موقع المتجر وتدقيقها لغوياً مع اقتراحات لتحسين الصياغة ووضوح الأزرار.";

test.before(async () => {
  S = await startStack();
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("client: " + e.message));
  p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "p80_admin", "ليلى العميلة"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "سارة المدققة", handle: "p80_sara", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("worker: " + e.message));
  u.on("dialog", (d) => d.accept());
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
  await S.app.ctx.db.run("UPDATE users SET created_at=$1 WHERE handle IN ('p80_admin','p80_sara')", [new Date(Date.now() - 60 * 864e5).toISOString()]);
  // the worker's CV, then a completed unpaid contract between the two
  rl(); await u.evaluate(async () => { await Remote.api("PUT", "/api/pro/me", { headline: "مدققة لغوية ومحررة محتوى", visibility: "public" }); await Remote.api("PUT", "/api/pro/me/skills", { skills: [{ name: "تدقيق لغوي", level: 5 }, { name: "كتابة المحتوى", level: 4 }, { name: "ترجمة", level: 3 }] }); });
  rl(); cid = await p.evaluate(async (sc) => (await Remote.api("POST", "/api/contracts", { to: "p80_sara", title: "تدقيق نصوص المتجر", scope: sc, milestones: [{ title: "التدقيق الكامل" }] })).id, SCOPE);
  rl(); const m = await u.evaluate(async (c) => (await Remote.api("POST", `/api/contracts/${c}/respond`, { accept: true })).milestones[0].id, cid);
  rl(); await u.evaluate(async (mi) => Remote.api("POST", `/api/contract-milestones/${mi}/submit`, { note: "النصوص المدققة مرفقة مع ملاحظات" }), m);
  rl(); await p.evaluate(async (mi) => Remote.api("POST", `/api/contract-milestones/${mi}/review`, { action: "approve" }), m);
  await S.app.ctx.db.run("UPDATE contracts SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 6 * 864e5).toISOString(), cid]);
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("client reviews from #/reviews; double-blind; worker reviews back and responds; CV + reputation page", async () => {
  await go(p, "#/contract/" + cid); await until(p, () => !!document.querySelector('#view a[href="#/reviews?tab=pending"]'));
  assert.equal(await p.evaluate(() => !!window.MPProReviews), false, "lazy chunk not loaded yet");
  await go(p, "#/settings?s=acct"); await until(p, () => !!document.querySelector('#view a[href="#/reviews"]'));
  rl(); await go(p, "#/reviews"); await until(p, () => !!document.querySelector(".pr-pend a.btn"));
  assert.equal(await p.evaluate(() => !!window.MPProReviews && !!window.MPWork), true, "proreviews chunk loads after work");
  assert.ok((await minTap(p, ".pr-pend .btn, .seg a")) >= 44); assert.deepEqual(await axe(p), [], "pending light"); await shot(p, "pending-390-light");
  rl(); await tap(p, ".pr-pend a.btn"); await until(p, () => !!document.querySelector("#pr-form .pr-chk"));
  assert.ok((await minTap(p, ".pr-opts span, .pr-chk span, #pr-form .btn")) >= 44, "44px rating + skills");
  // submit without a rating → accessible error
  await tap(p, "#pr-form [type=submit]"); await until(p, () => !document.querySelector("#pr-err").hidden);
  await p.click('.pr-rate:nth-of-type(1) label:nth-child(5)'); await p.click('#pr-form input[name="c1"][value="5"] + span'); await p.click('#pr-form input[name="c3"][value="4"] + span');
  await p.fill("#pr-form [name=body]", "تدقيق دقيق جداً وملاحظات مفيدة، وسلّمت قبل الموعد.");
  await p.click('#pr-form .pr-chk label:nth-child(1) span');
  assert.deepEqual(await axe(p), [], "form light"); await shot(p, "form-390-light");
  rl(); await tap(p, "#pr-form [type=submit]"); await until(p, () => location.hash === "#/reviews?tab=given"); await textHas(p, /مخفي عن سارة/);
  // the worker: sees «waiting», cannot read it yet
  rl(); await go(u, "#/reviews?tab=received"); await dark(u); await textHas(u, /بانتظار الظهور/); assert.equal(await u.evaluate(() => document.querySelectorAll(".pr-rev").length), 0);
  rl(); await go(u, "#/reviews"); await textHas(u, /قيّمك بالفعل/); assert.deepEqual(await axe(u), [], "pending dark"); await shot(u, "pending-360-dark");
  rl(); await tap(u, ".pr-pend a.btn"); await until(u, () => !!document.querySelector("#pr-form"));
  await u.click('.pr-rate:nth-of-type(1) label:nth-child(5)'); await u.fill("#pr-form [name=body]", "متطلبات واضحة ومراجعة سريعة جداً.");
  assert.deepEqual(await axe(u), [], "form dark"); await shot(u, "form-360-dark");
  rl(); await tap(u, "#pr-form [type=submit]"); await until(u, () => location.hash === "#/reviews?tab=given");
  // both revealed: the worker responds
  rl(); await go(u, "#/reviews?tab=received"); await until(u, () => !!document.querySelector(".pr-rev [data-resp]"));
  await u.locator(".pr-rev details summary").first().click(); await u.fill(".pr-rev [data-resp] textarea", "شكراً ليلى، سعدت بالعمل معك.");
  rl(); await u.click(".pr-rev [data-resp] [type=submit]"); await until(u, () => !!document.querySelector(".pr-resp"));
  assert.deepEqual(await axe(u), [], "received dark"); await shot(u, "received-360-dark");
  // CV strip → reputation page
  rl(); await go(p, "#/cv/p80_sara"); await until(p, () => !!document.querySelector(".wk-rep a[href='#/reviews/u/p80_sara']"));
  assert.match(await p.textContent(".wk-rep"), /5\.0|٥٫٠/); assert.match(await p.textContent(".wk-rep"), /أول عمل منجز/);
  rl(); await tap(p, ".wk-rep a.btn"); await until(p, () => !!document.querySelector(".pr-sum")); await textHas(p, /شكراً ليلى/); await textHas(p, /تدقيق لغوي/);
  assert.deepEqual(await axe(p), [], "reputation light"); await shot(p, "user-390-light");
  rl(); await go(u, "#/reviews/u/p80_sara"); await until(u, () => !!document.querySelector(".pr-sum")); assert.deepEqual(await axe(u), [], "reputation dark"); await shot(u, "user-360-dark");
});

test("talent directory rating, endorsements, report → staff queue, CSP", async () => {
  rl(); await go(p, "#/talent"); await until(p, () => !!document.querySelector(".wk-card .wk-rt"));
  // endorse one more skill from the reputation page
  rl(); await go(p, "#/reviews/u/p80_sara"); await until(p, () => !!document.querySelector("#pr-en"));
  await p.locator(".pr-more summary").first().click(); await p.click("#pr-en .pr-chk label:nth-child(2) span");
  rl(); await p.click("#pr-en [type=submit]"); await until(p, () => /كتابة المحتوى/.test(document.querySelector(".pr-sum")?.textContent || ""));
  // the client reports the review about them; staff dismisses it
  rl(); await go(p, "#/reviews/u/p80_admin"); await until(p, () => !!document.querySelector("[data-rep]"));
  await p.locator(".pr-rev details summary").first().click(); await p.selectOption("[data-rep] [name=reason]", "offtopic");
  rl(); await p.click("[data-rep] [type=submit]"); await p.waitForTimeout(300);
  rl(); await go(p, "#/admin/reviews"); await until(p, () => !!document.querySelector("[data-mod]"));
  assert.ok((await minTap(p, "[data-mod] .btn")) >= 44); assert.deepEqual(await axe(p), [], "admin light"); await shot(p, "admin-390-light");
  rl(); await tap(p, '[data-mod] [data-act="dismiss"]'); await textHas(p, /لا بلاغات مفتوحة/);
  assert.deepEqual(errors, []);
  for (const pg of [p, u]) {
    const inline = await pg.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name)) || (!!e.getAttribute("style") && !!e.closest("#view .wk-page"))).map((e) => e.outerHTML.slice(0, 160)));
    assert.deepEqual(inline, []);
  }
  const src = fs.readFileSync(path.join(__dirname, "../..", "proreviews-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /proreviews-ui\.js" data-chunk="proreviews"/);
});
