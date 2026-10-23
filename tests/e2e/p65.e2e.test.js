/* Phase 65 e2e (verified creators program + support fund) against the REAL server (production build), mobile viewport.
 * Creator (first account → admin): eligibility checklist all green → application with the code of conduct → staff approves
 *   in #/admin/creator-program → membership card + directory card.
 * Staff: creates a fund round in the UI (draft) → opens it; the creator applies from the round page; staff approves an award
 *   → Pi is off, so the grant shows «بانتظار تفعيل مدفوعات Pi» and the donate button is disabled with the notice.
 * Grant page: the creator posts a progress update; another member reports the grant.
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy chunk; no inline
 * handlers / styles / javascript: URLs; tap targets ≥ 44 px on the main actions. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, tourDone, MOBILE } = require("./harness");

let S, ctx, p, fctx, f, rid, gid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const local = (ms) => { const d = new Date(ms); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push("creator: " + e.message));
  p.on("dialog", (d) => d.accept("tx_e2e_ignored"));
  await onboard(p, S.base, "p65_cara", "كارا العتيبي"); // first account → admin
  const db = S.app.ctx.db, uid = (await db.get("SELECT id FROM users WHERE handle='p65_cara'")).id, t = Date.now();
  await db.run("UPDATE users SET created_at=$1, avatar='av.webp', bio='أقدّم دروساً عربية مبسّطة في البرمجة للمبتدئين' WHERE id=$2", [new Date(t - 100 * 864e5).toISOString(), uid]);
  for (let i = 0; i < 50; i++) { await db.run("INSERT INTO users(id,handle,name,role,status,created_at) VALUES($1,$1,'متابع','user','active',$2)", [`p65f${i}`, new Date(t - 200 * 864e5).toISOString()]); await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [`p65f${i}`, uid, new Date().toISOString()]); }
  for (let i = 0; i < 10; i++) await db.run("INSERT INTO posts(id,author,type,text,status,visibility,created_at) VALUES($1,$2,'post','درس جديد','published','public',$3)", [`p65p${i}`, uid, new Date(t - i * 864e5).toISOString()]);
  await db.run("INSERT INTO user_2fa(user_id,secret,enabled,created_at) VALUES($1,'x',1,$2)", [uid, new Date().toISOString()]);
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "فهد", handle: "p65_fan", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await tourDone(S.base, ck); // API-registered account: mark the guided tour done so it never overlays a click
  fctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  const [n, ...v] = ck.split("="); await fctx.addCookies([{ name: n, value: v.join("="), url: S.base }]);
  f = await fctx.newPage(); f.on("pageerror", (e) => errors.push("fan: " + e.message));
  await f.goto(S.base + "/?nosw#/home"); await f.waitForTimeout(800); await f.evaluate(() => { try { DB.onboarded = true; save?.(); } catch { } });
  await dismissTour(f); // belt and braces: close the tour if it still rendered
});
test.after(async () => { await fctx?.close(); await ctx?.close(); await S?.close(); });

test("program: checklist → application with code of conduct → staff approval → membership + directory", async () => {
  assert.equal(await p.evaluate(() => !!window.MPVCreators), false);
  await go(p, "#/creator-program"); await until(p, () => !!document.querySelector(".vc-checks"));
  assert.equal(await p.locator(".vc-checks li.no").count(), 0, "all checks green");
  assert.deepEqual(await axe(p), []);
  await p.selectOption("#vc-af [name=category]", "education");
  await p.fill("#vc-af [name=statement]", "أنشر دروساً أسبوعية مبسّطة في البرمجة للمبتدئين العرب منذ سنتين، مع تمارين ومشاريع.");
  await p.fill("#vc-af [name=links]", "https://example.com/cara");
  await tap(p, "#vc-af [type=submit]"); await textHas(p, /اكتمل|يلزم|الميثاق/).catch(() => null);
  await p.check("#vc-af [name=conduct]"); await tap(p, "#vc-af [type=submit]");
  await textHas(p, /طلبك قيد المراجعة/);
  assert.deepEqual(await axe(p), []);
  await go(p, "#/admin/creator-program"); await until(p, () => !!document.querySelector("[data-ok]"));
  assert.deepEqual(await axe(p), []);
  assert.ok((await minTap(p, "[data-ok]")) >= 44);
  await tap(p, "[data-ok]"); await textHas(p, /لا طلبات توثيق معلّقة/);
  await go(p, "#/creator-program"); await textHas(p, /صانع موثّق/); await until(p, () => !!document.querySelector(".vc-status"));
  await go(p, "#/creator-program?tab=directory"); await until(p, () => !!document.querySelector(".vc-card")); await textHas(p, /كارا العتيبي/);
  assert.deepEqual(await axe(p), []);
  assert.equal(await p.evaluate(() => !!window.MPVCreators), true);
});

test("fund: staff round (draft → open), creator applies, staff awards; Pi off notices", async () => {
  await go(p, "#/admin/creator-program?tab=rounds"); await until(p, () => !!document.querySelector("#vc-rf"));
  await p.fill("#vc-rf [name=title]", "جولة المحتوى التعليمي");
  await p.fill("#vc-rf [name=descr]", "منح لسلاسل تعليمية عربية مفتوحة للجميع.");
  await p.fill("#vc-rf [name=criteria]", "الأثر، الأصالة، الجدوى");
  await p.check('#vc-rf [name=categories][value="education"]');
  await p.fill("#vc-rf [name=budget]", "100"); await p.fill("#vc-rf [name=maxGrant]", "40");
  await p.fill("#vc-rf [name=opensAt]", local(Date.now() - 864e5)); await p.fill("#vc-rf [name=closesAt]", local(Date.now() + 20 * 864e5));
  await tap(p, "#vc-rf [type=submit]"); await until(p, () => /round=/.test(location.hash) && !!document.querySelector("[data-to]"));
  rid = await p.evaluate(() => new URLSearchParams(location.hash.split("?")[1]).get("round"));
  assert.deepEqual(await axe(p), []);
  await tap(p, '[data-to="open"]'); await textHas(p, /مفتوحة للتقديم/);
  await go(p, "#/fund/r/" + rid); await until(p, () => !!document.querySelector("#vc-ff"));
  assert.deepEqual(await axe(p), []);
  await p.fill("#vc-ff [name=title]", "سلسلة JavaScript للمبتدئين");
  await p.fill("#vc-ff [name=plan]", "عشرون درساً قصيراً بالعربية مع تمارين ومشاريع صغيرة، تُنشر أسبوعياً على المنصة مجاناً مع ملف تمارين مفتوح للجميع.");
  await p.fill("#vc-ff [name=amount]", "30"); await p.fill("#vc-ff [name=milestones]", "الدروس ١–١٠\nالدروس ١١–٢٠");
  await tap(p, "#vc-ff [type=submit]"); await textHas(p, /طلبي/); await textHas(p, /مُقدَّم/);
  await go(p, `#/admin/creator-program?tab=rounds&round=${rid}`); await until(p, () => !!document.querySelector("form[data-a]"));
  await p.fill("form[data-a] [name=reason]", "خطة واضحة وقابلة للقياس");
  await tap(p, 'form[data-a] [value="approve"]'); await textHas(p, /المعتمد/);
  gid = await S.app.ctx.db.get("SELECT id FROM fund_applications WHERE round_id=$1", [rid]).then((r) => r.id);
  await tap(p, '[data-to="review"]'); await textHas(p, /قيد المراجعة/);
  await go(f, "#/fund"); await until(f, () => !!document.querySelector("#vc-dn")); await textHas(f, /بانتظار Pi/);
  assert.ok(await f.$eval("#vc-dn [type=submit]", (b) => b.disabled)); await textHas(f, /مدفوعات Pi غير مفعّلة/);
  assert.deepEqual(await axe(f), []);
});

test("grant page: progress update by the creator, report by a member; dark mode; source hygiene", async () => {
  await go(p, "#/fund/g/" + gid); await until(p, () => !!document.querySelector("#vc-up"));
  await p.fill("#vc-up [name=body]", "نُشرت الدروس الخمسة الأولى على المنصة."); await tap(p, "#vc-up [type=submit]");
  await textHas(p, /الدروس الخمسة الأولى/);
  assert.deepEqual(await axe(p), []);
  await go(f, "#/fund/g/" + gid); await until(f, () => !!document.querySelector("#vc-rp"));
  await f.click("#vc-rp >> xpath=.. >> summary"); await f.selectOption("#vc-rp [name=reason]", "misleading"); await tap(f, "#vc-rp [type=submit]");
  await until(f, () => !document.querySelector("details.card")?.open);
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM fund_reports WHERE application_id=$1", [gid]));
  for (const hash of ["#/fund", "#/creator-program", "#/fund/g/" + gid]) {
    await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await go(p, hash); await p.waitForTimeout(500); assert.deepEqual(await axe(p), [], hash + " dark");
  }
  await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  assert.deepEqual(errors, []);
  const inline = await f.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name))).length);
  assert.equal(inline, 0);
  const fs = require("node:fs"), path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../..", "vcreators-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /data-chunk="vcreators"/);
});
