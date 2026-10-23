/* v2.29 breadth for phases 61 / 66 / 71 (mobile, real server, production build).
 * P61: overview insights + goals (set one, ring shows), post drilldown from the content table, chart readout on tap.
 * P66: place page — open-now chip, hours table, rate with stars + review, save → saved list, share; RSVP from the map list.
 * P71: teacher posts homework from a session page (agenda edited), student submits, teacher reviews; dashboard;
 *      completion card for the student. axe clean on each new screen; no page errors. Screenshots → $SHOTS (optional). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p, me, other, otherCk; const errors = [];
const SHOTS = process.env.SHOTS || "";
const shot = async (n) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }); };
const until = (fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
async function axe() {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const H = (ck) => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, ...(ck ? { Cookie: ck } : {}) });
const as = async (ck, m, path, body) => { const r = await fetch(S.base + path, { method: m, headers: H(ck), body: body && JSON.stringify(body) }); return r.json(); };
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await ctx.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 404, body: "" }));
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "px_me", "صانعة المحتوى"); // first account → admin
  me = await S.app.ctx.db.get("SELECT * FROM users WHERE handle='px_me'");
  const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "خالد المتابع", handle: "px_other", password: "secret123" }) });
  otherCk = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  other = await S.app.ctx.db.get("SELECT * FROM users WHERE handle='px_other'");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("P61: insights + goals on the overview; post drilldown from the content table; tap readout on the chart", async () => {
  const sv = S.app.ctx.services, db = S.app.ctx.db;
  const posts = [];
  for (let i = 0; i < 3; i++) { S.app.ctx.rl.w.clear(); posts.push(await sv.content.createPost(me, { type: i ? "post" : "article", title: i ? undefined : "دليل Pi للمبتدئين", text: `منشور تحليلات رقم ${i + 1} ` + "نص ".repeat(40) })); }
  for (const x of posts) await db.run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,'feed',$3)", [x.id, other.id, new Date().toISOString()]);
  await db.run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,'share',$3)", [posts[0].id, other.id, new Date().toISOString()]);
  await p.goto(S.base + "/?nosw#/analytics");
  await until(() => !!document.querySelector("#ca-ins .ca-in") && !!document.querySelector("#ca-gf"));
  await p.selectOption("#ca-gf select[name=metric]", "posts"); await p.fill("#ca-gf input[name=target]", "5"); await p.click("#ca-gf button");
  await until(() => !!document.querySelector(".ca-goal .ca-ring"));
  assert.match(await p.textContent(".ca-goal"), /منشورات هذا الأسبوع/);
  // chart readout
  const svgEl = await p.$("svg.ca-int"); await svgEl.scrollIntoViewIfNeeded(); const box = await svgEl.boundingBox(); await p.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
  await until(() => /·/.test(document.querySelector(".ca-read")?.textContent || ""));
  assert.deepEqual(await axe(), []); await shot("p61-overview");
  await p.goto(S.base + "/?nosw#/analytics/content"); await until(() => !!document.querySelector('#ca-b a[href^="#/analytics/post/"]'));
  await p.click(`#ca-b a[href="#/analytics/post/${posts[0].id}"]`);
  await until(() => /من أين جاءت المشاهدات/.test(document.querySelector("#ca-b")?.textContent || "") && !!document.querySelector("#ca-b svg.ca-chart"));
  const t = await p.textContent("#ca-b"); assert.match(t, /دليل Pi للمبتدئين/); assert.match(t, /رابط مباشر أو مشاركة/); assert.match(t, /أول 24 ساعة/);
  assert.deepEqual(await axe(), []); await shot("p61-post");
  assert.deepEqual(errors, []);
});

test("P66: place page (open now, hours, stars + review, save → saved list, share) and RSVP from the map list", async () => {
  const db = S.app.ctx.db;
  const week = Array.from({ length: 7 }, () => ["00:00", "00:00"]); // open 24h every day → «مفتوح الآن»
  const pl = await as(otherCk, "POST", "/api/places", { name: "مكتبة الحي العامة", category: "library", descr: "مكتبة هادئة للقراءة", address: "الشاطئ، جدة", lat: 21.5433, lng: 39.1728, hoursWeek: week });
  assert.ok(pl.place?.id, JSON.stringify(pl));
  await db.run("UPDATE places SET status='approved' WHERE id=$1", [pl.place.id]);
  const ev = await as(otherCk, "POST", "/api/events/plus", { name: "أمسية قراءة في الحي", startsAt: new Date(Date.now() + 2 * 864e5).toISOString(), place: "المكتبة", lat: 21.545, lng: 39.173 });
  assert.ok(ev.event?.id || ev.id, JSON.stringify(ev));
  await p.goto(S.base + "/?nosw#/place/" + pl.place.id);
  await until(() => !!document.querySelector(".nb-open") && !!document.querySelector("#nb-rf2"));
  assert.match(await p.textContent(".nb-open"), /مفتوح الآن/);
  assert.ok(await p.$("details.nb-card table.nb-hours"));
  await p.click('#nb-rf2 [data-st="4"]'); await p.fill('#nb-rf2 textarea', "مكان رائع للمذاكرة"); await p.click("#nb-rf2 button.btn:not(.ghost)");
  await until(() => !!document.querySelector(".nb-rate") && /مكان رائع للمذاكرة/.test(document.querySelector("#nb-rv").textContent));
  await p.click("#nb-save"); await until(() => document.querySelector("#nb-save")?.getAttribute("aria-pressed") === "true");
  await p.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d; }; });
  await p.click("#nb-share"); await until(() => !!window.__shared); assert.match(await p.evaluate(() => window.__shared.url), /#\/place\//);
  assert.deepEqual(await axe(), []); await shot("p66-place");
  await p.goto(S.base + "/?nosw#/places/saved"); await until(() => /مكتبة الحي العامة/.test(document.querySelector("#nb-sv")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/nearby?city=" + encodeURIComponent("جدة") + "&radius=10");
  await until(() => !!document.querySelector("#nb-res [data-rsvp]"));
  await p.click("#nb-res [data-rsvp]"); await until(() => document.querySelector("#nb-res [data-rsvp]").getAttribute("aria-pressed") === "true");
  assert.ok(await db.get("SELECT 1 x FROM event_rsvps WHERE user_id=$1 AND kind='going'", [me.id]), "RSVP stored");
  assert.deepEqual(await axe(), []); await shot("p66-nearby");
  assert.deepEqual(errors, []);
});

test("P71: session agenda + homework from the session page; student submits; teacher reviews; dashboard; completion card", async () => {
  const g = await p.evaluate(async () => Remote.api("POST", "/api/study/groups", { name: "مجموعة الرياضيات للصف الثالث", desc: "نذاكر معاً", mode: "group", subject: "الرياضيات", type: "public" }));
  const cid = g.group.id;
  const st = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const q = await st.newPage(); q.on("pageerror", (e) => errors.push(e.message));
  await onboard(q, S.base, "px_student", "ليان الطالبة");
  await q.evaluate(async (c) => Remote.api("POST", `/api/communities/${c}/join`, { acceptRules: true }), cid);
  const ss = await p.evaluate(async (c) => Remote.api("POST", `/api/study/groups/${c}/sessions`, { title: "الكسور العشرية", startsAt: new Date(Date.now() + 864e5).toISOString(), durationMin: 60 }), cid);
  const sid = ss.session?.id || ss.id; assert.ok(sid, JSON.stringify(ss));
  await p.goto(S.base + "/?nosw#/study/session/" + sid); await until(() => !!document.querySelector("#sd-agf") && !!document.querySelector("#sd-af"));
  await p.click("#sd-agf >> xpath=.."); await p.fill("#sd-agf textarea", "مراجعة الواجب\nشرح الكسور العشرية\nتمارين"); await p.click("#sd-agf button");
  await until(() => document.querySelectorAll(".sd-agenda li").length === 3);
  await p.click("#sd-af >> xpath=.."); await p.fill("#sd-af input[name=title]", "تمارين الكسور ص ٣٤"); await p.fill("#sd-af textarea", "حل التمارين ١–١٠"); await p.click("#sd-af button");
  await until(() => /تمارين الكسور/.test(document.querySelector("#sd-sas")?.textContent || ""));
  assert.deepEqual(await axe(), []); await shot("p71-session");
  const aid = (await S.app.ctx.db.get("SELECT id FROM study_assignments WHERE community_id=$1", [cid])).id;
  assert.equal((await S.app.ctx.db.get("SELECT session_id FROM study_assignments WHERE id=$1", [aid])).session_id, sid);
  await q.goto(S.base + "/?nosw#/study/assignment/" + aid); await q.waitForSelector("#sd-sub", { timeout: 20000 });
  await q.fill("#sd-sub textarea", "حللت التمارين كلها"); await q.fill("#sd-sub input[name=url]", "https://example.com/sol"); await q.click("#sd-sub button");
  await q.waitForFunction(() => /بانتظار التصحيح/.test(document.querySelector("#sd-as")?.textContent || ""), null, { timeout: 15000 });
  await p.goto(S.base + "/?nosw#/study/assignment/" + aid); await until(() => !!document.querySelector("[data-rv]"));
  await p.fill("[data-rv] input[name=grade]", "9"); await p.fill("[data-rv] input[name=feedback]", "ممتاز، راجع التمرين ٧"); await p.click("[data-rv] button.btn:not(.ghost)");
  await until(() => /صُحّح/.test(document.querySelector("#sd-as")?.textContent || ""));
  assert.deepEqual(await axe(), []); await shot("p71-assignment");
  await p.goto(S.base + `/?nosw#/study/${cid}/dashboard`); await until(() => !!document.querySelector("#sd-b .sd-g") && /ليان الطالبة/.test(document.querySelector("#sd-b").textContent));
  assert.deepEqual(await axe(), []); await shot("p71-dashboard");
  // the student sees the feedback and the completion card
  await q.goto(S.base + "/?nosw#/study/assignment/" + aid); await q.waitForFunction(() => /ممتاز، راجع التمرين ٧/.test(document.querySelector("#sd-as")?.textContent || ""), null, { timeout: 20000 });
  await q.goto(S.base + `/?nosw#/study/${cid}/assignments`); await q.waitForFunction(() => !!document.querySelector("#sd-cmp details, #sd-cmp .sd-cert"), null, { timeout: 15000 });
  if (SHOTS) await q.screenshot({ path: `${SHOTS}/p71-student.png`, fullPage: true });
  await st.close();
  assert.deepEqual(errors, []);
});
