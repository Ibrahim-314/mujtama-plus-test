/* Phase 70 e2e (volunteering, verified charities, transparent campaigns) against the REAL server (production build), mobile viewport.
 * Owner (first account → admin): registers an organisation in #/organisation/new → staff verify it in #/admin/charity →
 *   writes a campaign (draft) on the organisation page → submits it → staff approve → publishes a volunteering opportunity.
 * Volunteer: sees the campaign in #/giving with the transparency figures; Pi is off, so the donate button is disabled with the
 *   notice; signs up for the opportunity; the owner accepts and confirms hours → «تطوّعي وتبرّعاتي» shows the hours and the
 *   certificate link; the volunteer reports the campaign.
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy chunk; no inline
 * handlers / styles / javascript: URLs; tap targets ≥ 44 px. Screenshots (390 light, 360 dark) → tests/visual/output/p70-*. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, ctx, p, vctx, v, oid, cid, pid; const errors = [];
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
const local = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output"); // SHOTS_DIR: private output dir for parallel runs
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `p70-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push("owner: " + e.message));
  p.on("dialog", (d) => d.accept(/الساعات/.test(d.message()) ? "3" : "سبب الاختبار"));
  await onboard(p, S.base, "p70_sara", "سارة الغامدي"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "مها الحربي", handle: "p70_maha", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await tourDone(S.base, ck); // API account: the guided tour (random tour_style variant) would otherwise open on its first home render and sit over later clicks
  vctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await vctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  v = await vctx.newPage(); v.on("pageerror", (e) => errors.push("volunteer: " + e.message));
  await v.goto(S.base + "/?nosw#/home"); await v.waitForTimeout(800); await v.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
});
test.after(async () => { await vctx?.close(); await ctx?.close(); await S?.close(); });

test("organisation: registration → staff verification; campaign draft → review → live; opportunity", async () => {
  assert.equal(await p.evaluate(() => !!window.MPCharity), false, "lazy chunk not in core");
  await go(p, "#/giving"); await textHas(p, /حملة قائمة/);
  assert.equal(await p.evaluate(() => !!window.MPCharity), true);
  assert.deepEqual(await axe(p), []);
  await go(p, "#/organisation/new"); await until(p, () => !!document.querySelector("#gv-gf"));
  await p.fill("#gv-gf [name=name]", "جمعية البر الأهلية بجدة"); await p.selectOption("#gv-gf [name=kind]", "charity");
  await p.fill("#gv-gf [name=registry]", "المركز الوطني لتنمية القطاع غير الربحي"); await p.fill("#gv-gf [name=licenseNo]", "1234");
  await p.fill("#gv-gf [name=city]", "جدة"); await p.fill("#gv-gf [name=descr]", "جمعية خيرية مرخّصة تعمل في جدة منذ عشر سنوات على السلال الغذائية والكسوة.");
  assert.deepEqual(await axe(p), []);
  await tap(p, "#gv-gf [type=submit]"); await textHas(p, /قيد التحقق/);
  oid = decodeURIComponent((await p.evaluate(() => location.hash)).split("/")[2]);
  await go(p, "#/admin/charity"); await until(p, () => !!document.querySelector("[data-os=verified]"));
  assert.deepEqual(await axe(p), []); await shot(p, "admin-390-light");
  await tap(p, "[data-os=verified]"); await until(p, () => !document.querySelector("[data-os=verified]"));
  await go(p, "#/organisation/" + oid); await until(p, () => !!document.querySelector("#gv-nc"));
  await p.click("#gv-nc >> xpath=.. >> summary");
  const t = Date.now();
  await p.fill("#gv-cf [name=title]", "سلال رمضان لخمسمئة أسرة"); await p.selectOption("#gv-cf [name=category]", "food");
  await p.fill("#gv-cf [name=story]", "نجمع لتوفير سلال غذائية متكاملة لخمسمئة أسرة متعففة في أحياء جنوب جدة خلال شهر رمضان، وتشمل كل سلة مواد أساسية تكفي الأسرة شهراً كاملاً.");
  await p.fill("#gv-cf [name=beneficiaries]", "٥٠٠ أسرة متعففة"); await p.fill("#gv-cf [name=goal]", "1000");
  await p.fill("#gv-cf [name=startsAt]", local(t - 864e5)); await p.fill("#gv-cf [name=endsAt]", local(t + 30 * 864e5));
  await tap(p, "#gv-cf [type=submit]"); await until(p, () => /#\/campaign\//.test(location.hash) && !!document.querySelector("#gv-sub"));
  cid = decodeURIComponent((await p.evaluate(() => location.hash)).split("/")[2]);
  assert.deepEqual(await axe(p), []);
  await tap(p, "#gv-sub"); await textHas(p, /لدى فريق المنصة للمراجعة/);
  await go(p, "#/admin/charity?tab=campaigns"); await until(p, () => !!document.querySelector("[data-ca=approve]"));
  assert.deepEqual(await axe(p), []);
  await tap(p, "[data-ca=approve]"); await until(p, () => !document.querySelector("[data-ca=approve]"));
  // opportunity
  await go(p, "#/organisation/" + oid); await until(p, () => !!document.querySelector("#gv-pf"));
  await p.click("#gv-pf >> xpath=../.. >> summary");
  await p.fill("#gv-pf [name=title]", "فرز وتعبئة السلال الغذائية"); await p.fill("#gv-pf [name=descr]", "نحتاج متطوعين لفرز وتعبئة السلال في مستودع الجمعية بجدة، مع إشراف فريق الجمعية.");
  await p.fill("#gv-pf [name=city]", "جدة"); await p.fill("#gv-pf [name=startsAt]", local(t + 2 * 864e5)); await p.fill("#gv-pf [name=endsAt]", local(t + 2 * 864e5 + 4 * 36e5));
  await p.fill("#gv-pf [name=hours]", "4");
  await tap(p, "#gv-pf [type=submit]"); await until(p, () => /#\/opportunity\//.test(location.hash) && !!document.querySelector(".f-cover"));
  pid = decodeURIComponent((await p.evaluate(() => location.hash)).split("/")[2]);
  await go(p, "#/organisation/" + oid); await textHas(p, /سلال رمضان/); await textHas(p, /فرز وتعبئة/);
  assert.deepEqual(await axe(p), []); await shot(p, "org-390-light");
});

test("volunteer: transparent campaign (Pi off), sign-up → accepted → hours + certificate; report", async () => {
  rl();
  await go(v, "#/giving"); await until(v, () => !!document.querySelector(".gv-card")); await textHas(v, /سلال رمضان/);
  await textHas(v, /مدفوعات Pi غير مفعّلة/);
  assert.deepEqual(await axe(v), []);
  await go(v, "#/campaign/" + cid); await until(v, () => !!document.querySelector("#gv-dn"));
  assert.equal(await v.locator("#gv-dn [type=submit]").isDisabled(), true);
  await textHas(v, /حُوّل ولم يُوثَّق صرفه/); await textHas(v, /المركز الوطني/);
  assert.deepEqual(await axe(v), []);
  await go(p, "#/campaign/" + cid); await until(p, () => !!document.querySelector("#gv-dn")); await shot(p, "campaign-390-light");
  await go(v, "#/giving?tab=volunteer"); await textHas(v, /فرز وتعبئة/);
  assert.deepEqual(await axe(v), []);
  await go(v, "#/opportunity/" + pid); await until(v, () => !!document.querySelector("#gv-su"));
  assert.deepEqual(await axe(v), []);
  await v.fill("#gv-su [name=note]", "عملت في مستودعات من قبل"); await tap(v, "#gv-su [type=submit]"); await textHas(v, /بانتظار الرد/);
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM notifications WHERE kind='vol_signup'"));
  await go(p, "#/opportunity/" + pid); await until(p, () => !!document.querySelector("[data-sa=accept]"));
  assert.deepEqual(await axe(p), []);
  await tap(p, "[data-sa=accept]"); await until(p, () => !document.querySelector("[data-sa=accept]"));
  await S.app.ctx.db.run("UPDATE vol_opps SET starts_at=$1, ends_at=$2 WHERE id=$3", [new Date(Date.now() - 5 * 36e5).toISOString(), new Date(Date.now() - 36e5).toISOString(), pid]);
  await go(p, "#/giving"); await go(p, "#/opportunity/" + pid); await until(p, () => !!document.querySelector("[data-sa=attended]"));
  assert.ok((await minTap(p, ".gv-acts .btn")) >= 44, "44px targets");
  await tap(p, "[data-sa=attended]"); await textHas(p, /حضر/);
  await go(v, "#/giving?tab=mine"); await until(v, () => !!document.querySelector('a[href^="#/cert/"]'));
  await textHas(v, /ساعة تطوّع مؤكّدة/);
  assert.deepEqual(await axe(v), []);
  const s = await S.app.ctx.db.get("SELECT hours, cert_code FROM vol_signups WHERE opp_id=$1", [pid]); assert.equal(Number(s.hours), 3); assert.ok(s.cert_code);
  // report
  await go(v, "#/campaign/" + cid); await until(v, () => !!document.querySelector("#gv-rp"));
  await v.click("#gv-rp >> xpath=.. >> summary"); await v.selectOption("#gv-rp [name=reason]", "misleading"); await tap(v, "#gv-rp [type=submit]");
  await until(v, () => !document.querySelector("details.card")?.open);
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM charity_reports WHERE target_id=$1", [cid]));
});

test("dark theme axe on every screen; 360 dark screenshots; CSP hygiene", async () => {
  for (const [hash, name] of [["#/giving", "hub"], ["#/campaign/" + cid, "campaign"], ["#/opportunity/" + pid, "opportunity"], ["#/organisation/" + oid, "org"], ["#/giving?tab=mine", "mine"]]) {
    await v.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await go(v, hash); await v.waitForTimeout(500); assert.deepEqual(await axe(v), [], hash + " dark"); await shot(v, `${name}-360-dark`);
  }
  for (const hash of ["#/admin/charity", "#/admin/charity?tab=reports"]) {
    await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await go(p, hash); await p.waitForTimeout(500); assert.deepEqual(await axe(p), [], hash + " dark");
  }
  assert.deepEqual(errors, []);
  const inline = await v.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name))).length);
  assert.equal(inline, 0);
  const src = fs.readFileSync(path.join(__dirname, "../..", "charity-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /data-chunk="charity"/);
});
