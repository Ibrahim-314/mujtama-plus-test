/* Phase 74 e2e (mentorship) against the REAL server (production build), mobile viewport.
 * Mentor (first account → admin): creates the mentor profile in the UI → weekly availability editor → dashboard KPIs.
 * Learner: discovers the mentor (topic chip, card), «اقترح لي مرشداً» shows reasons, opens the profile, picks a day + time in
 *   the slot picker and books → session page (pending); writes an open request.
 * Mentor: confirms from the dashboard, sees the request, accepts it with a reply; session notes shared; cancel form.
 * Completed session (set in the DB): learner rates with the star control → rating on the public profile.
 * Calendar feed link, admin screen. axe: no serious/critical WCAG A/AA issues on every new screen; no page errors; the
 * mentor chunk is lazy; no inline handlers; tap targets ≥ 44px on the main actions. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, tourDone, MOBILE } = require("./harness");

let S, ctx, p, k, kctx, learnerCk, sid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); }; // the fixed bottom nav may cover the bottom edge
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push("mentor: " + e.message));
  await onboard(p, S.base, "p74_mentor", "سارة القحطاني"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "فهد الدوسري", handle: "p74_learner", password: "secret123" }) });
  assert.equal(reg.status, 200);
  learnerCk = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await tourDone(S.base, learnerCk); // API-registered account: mark the guided tour done so it never overlays a click
  kctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  const [n, ...v] = learnerCk.split("="); await kctx.addCookies([{ name: n, value: v.join("="), url: S.base }]);
  k = await kctx.newPage(); k.on("pageerror", (e) => errors.push("learner: " + e.message));
  await k.goto(S.base + "/?nosw#/home"); await k.waitForTimeout(800); await k.evaluate(() => { try { DB.onboarded = true; save?.(); } catch { } });
  await dismissTour(k); // belt and braces: close the tour if it still rendered
});
test.after(async () => { await kctx?.close(); await ctx?.close(); await S?.close(); });

test("mentor: profile form → availability editor → dashboard; chunk is lazy", async () => {
  const before = await p.evaluate(() => !!window.MPMentor);
  assert.equal(before, false);
  await go(p, "#/mentoring");
  await until(p, () => !!document.querySelector("#mt-pfm"));
  assert.deepEqual(await axe(p), []);
  await p.fill("#mt-pfm [name=headline]", "مطوّرة ويب بخبرة عشر سنوات");
  await p.fill("#mt-pfm [name=bio]", "أساعد المبتدئين في JavaScript وبناء أول مشروع حقيقي.");
  await p.check('#mt-pfm [name=topics][value="programming"]'); await p.check('#mt-pfm [name=topics][value="career"]');
  await p.fill("#mt-pfm [name=languages]", "العربية، English");
  await p.selectOption("#mt-pfm [name=minutes]", "60");
  await p.fill("#mt-pfm [name=tz]", "Asia/Riyadh");
  await tap(p, "#mt-pfm [type=submit]");
  await until(p, () => /tab=availability/.test(location.hash) && !!document.querySelector("#mt-av"));
  assert.deepEqual(await axe(p), []);
  // every day: 00:00–23:45 so the learner always finds slots ≥ 12 h ahead
  for (let d = 0; d < 7; d++) {
    await tap(p, `.mt-wd[data-wd="${d}"] [data-add]`);
    await p.fill(`.mt-wd[data-wd="${d}"] [name=start]`, "00:00"); await p.fill(`.mt-wd[data-wd="${d}"] [name=end]`, "23:45");
  }
  assert.ok((await minTap(p, ".mt-wd [data-add]")) >= 44);
  await tap(p, "#mt-av [type=submit]"); await p.waitForTimeout(500);
  const me = await p.evaluate(() => Remote.api("GET", "/api/mentor/me"));
  assert.equal(me.slots.length, 7);
  await go(p, "#/mentoring?tab=sessions"); await until(p, () => !!document.querySelector(".kpi-tile"));
  assert.deepEqual(await axe(p), []);
  assert.equal(await p.evaluate(() => !!window.MPMentor), true);
});

test("learner: discover, match reasons, profile, slot picker → book → session page; open request", async () => {
  await go(k, "#/mentors"); await textHas(k, /مطوّرة ويب/);
  assert.deepEqual(await axe(k), []);
  await k.selectOption("#mt-mf [name=topic]", "programming"); await k.fill("#mt-mf [name=goal]", "أتعلم javascript");
  await tap(k, "#mt-mf [type=submit]"); await until(k, () => /متاح خلال هذا الأسبوع/.test(document.querySelector("#mt-mr")?.textContent || ""));
  assert.deepEqual(await axe(k), []);
  await go(k, "#/mentors?tab=find&topic=career"); await textHas(k, /سارة القحطاني/);
  await tap(k, ".mt-card"); await until(k, () => !!document.querySelector(".mt-day"));
  assert.deepEqual(await axe(k), []);
  assert.ok((await minTap(k, ".mt-day")) >= 44);
  await tap(k, ".mt-day >> nth=1"); await tap(k, ".mt-time >> nth=2");
  await until(k, () => !document.querySelector("#mt-bk").disabled);
  assert.ok((await minTap(k, ".mt-time")) >= 44);
  await k.fill("#mt-bf [name=note]", "أريد مراجعة مشروعي الأول");
  await tap(k, "#mt-bk");
  await until(k, () => /^#\/msession\//.test(location.hash) && /بانتظار التأكيد/.test(document.querySelector("#view").textContent));
  sid = await k.evaluate(() => location.hash.split("/")[2]);
  assert.deepEqual(await axe(k), []);
  // notes (private) + calendar link present
  await k.fill("#mt-nf [name=body]", "أسئلتي: الدوال غير المتزامنة"); await tap(k, "#mt-nf [type=submit]"); await k.waitForTimeout(300);
  assert.ok(await k.$('a[download][href$="/ics"]'));
  // open request
  await go(k, "#/mentors?tab=requests"); await until(k, () => !!document.querySelector("#mt-rf"));
  assert.deepEqual(await axe(k), []);
  await k.selectOption("#mt-rf [name=topic]", "career"); await k.fill("#mt-rf [name=goal]", "أستعد لمقابلات العمل التقنية الأولى");
  await tap(k, "#mt-rf [type=submit]"); await textHas(k, /طلب مفتوح/);
  await go(k, "#/mentors?tab=sessions"); await until(k, () => !!document.querySelector(".list .li"));
  assert.deepEqual(await axe(k), []);
  await tap(k, "#mt-feed-on"); await until(k, () => /mentor-feed/.test(document.querySelector("#mt-feed-u")?.value || ""));
  const feed = await k.$eval("#mt-feed-u", (e) => e.value); const fr = await fetch(feed.replace(/^webcal:/, "http:")); assert.equal(fr.status, 200);
});

test("mentor: confirm, accept open request, shared summary; learner sees it; cancel form", async () => {
  await go(p, "#/mentoring?tab=sessions"); await until(p, () => !!document.querySelector("[data-ok]"));
  await tap(p, "[data-ok]"); await until(p, () => !document.querySelector("[data-ok]"));
  await go(p, "#/mentoring?tab=requests"); await textHas(p, /مقابلات العمل/);
  assert.deepEqual(await axe(p), []);
  await p.fill("form[data-r] [name=reply]", "أهلاً فهد، احجز موعداً من صفحتي"); await tap(p, "form[data-r] [value=accept]");
  await textHas(p, /أهلاً فهد/);
  await go(p, "#/msession/" + sid); await textHas(p, /مؤكدة/);
  assert.deepEqual(await axe(p), []);
  await p.fill("#mt-nf [name=body]", "الخطوة القادمة: fetch وبناء صفحة"); await p.check("#mt-nf [name=shared]"); await tap(p, "#mt-nf [type=submit]"); await p.waitForTimeout(300);
  await go(k, "#/msession/" + sid); await textHas(k, /ملخص المرشد/); await textHas(k, /fetch/);
  await go(k, "#/mentors?tab=requests"); await textHas(k, /ردّ المرشد/);
  // cancel form opens and is labelled (not submitted)
  await go(k, "#/msession/" + sid); await until(k, () => !!document.querySelector("#mt-cx"));
  await tap(k, "#mt-cx"); await until(k, () => !document.querySelector("#mt-cf").hidden);
  assert.deepEqual(await axe(k), []);
});

test("completed session: star rating → profile shows the rating; admin screen", async () => {
  await S.app.ctx.db.run("UPDATE mentor_sessions SET status='completed', completed_at=$1 WHERE id=$2", [new Date().toISOString(), sid]);
  await go(k, "#/mentors"); await go(k, "#/msession/" + sid); await until(k, () => !!document.querySelector("#mt-fb"));
  assert.deepEqual(await axe(k), []);
  assert.ok((await minTap(k, ".mt-stars label")) >= 44);
  await tap(k, ".mt-stars label >> nth=4"); await k.fill("#mt-fb [name=comment]", "شرح واضح وصبر جميل");
  await tap(k, "#mt-fb [type=submit]"); await textHas(k, /تقييمك: 5 من 5/);
  await go(k, "#/mentor/p74_mentor"); await until(k, () => !!document.querySelector(".mt-dist")); await textHas(k, /شرح واضح/);
  assert.deepEqual(await axe(k), []);
  await go(p, "#/admin/mentors"); await until(p, () => !!document.querySelector(".kpi-tile")); await textHas(p, /سارة القحطاني/);
  assert.deepEqual(await axe(p), []);
});

test("dark mode screens pass axe; no page errors; no inline handlers in the new chunk", async () => {
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await go(p, "#/mentors"); await textHas(p, /الإرشاد/); assert.deepEqual(await axe(p), []);
  await p.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  assert.deepEqual(errors, []);
  const inline = await k.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name))).length);
  assert.equal(inline, 0);
  const fs = require("node:fs"), path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "../..", "mentor-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /data-chunk="mentor"/);
});
