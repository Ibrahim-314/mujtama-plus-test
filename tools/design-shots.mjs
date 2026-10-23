/* v2.29 design review (dev tool): seeds realistic data and screenshots every new screen of phases 61 / 66 / 71 at a
 * phone width, light or dark. Usage: node tools/design-shots.mjs <width> <light|dark> <outDir> [screen,screen…] */
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const { startStack, onboard } = require("../tests/e2e/harness.js");
const [W = "390", THEME = "light", OUT = "/tmp/shots", ONLY = ""] = process.argv.slice(2);
const fs = require("node:fs"); fs.mkdirSync(OUT, { recursive: true });
const S = await startStack();
const MOB = { viewport: { width: +W, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: "ar-SA", colorScheme: THEME, reducedMotion: "reduce" };
const ctx = await S.browser.newContext(MOB);
await ctx.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 404, body: "" }));
const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await onboard(p, S.base, "ds_me", "نورة المعلّمة");
const db = S.app.ctx.db, sv = S.app.ctx.services, rl = () => S.app.ctx.rl.w.clear();
const api = (m, path, b) => p.evaluate(([m, path, b]) => Remote.api(m, path, b), [m, path, b]);
const me = await db.get("SELECT * FROM users WHERE handle='ds_me'");
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base };
const others = [];
for (const [h, n] of [["ds_a", "خالد العتيبي"], ["ds_b", "سارة الحربي"], ["ds_c", "ليان القحطاني"]]) {
  rl(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ name: n, handle: h, password: "secret123" }) });
  others.push({ ck: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "), u: await db.get("SELECT * FROM users WHERE handle=$1", [h]) });
}
const as = async (i, m, path, b) => (await fetch(S.base + path, { method: m, headers: { ...H, Cookie: others[i].ck }, body: b && JSON.stringify(b) })).json();
// P61 data
const posts = [];
const T = ["دليل المبتدئين إلى شبكة Pi", "خمس نصائح لكتابة منشور ناجح", "كيف تبني مجتمعاً متفاعلاً", "تجربتي مع العمل الحر", "أسئلة شائعة عن المحفظة"];
for (let i = 0; i < 5; i++) { rl(); posts.push(await sv.content.createPost(me, { type: i % 2 ? "post" : "article", title: i % 2 ? undefined : T[i], text: T[i] + " — " + "نص تجريبي ".repeat(30) })); }
for (let d = 0; d < 20; d++) for (let k = 0; k < (d * 7) % 5 + 1; k++) { const o = others[k % 3].u, pp = posts[(d + k) % 5]; await db.run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,$3,$4)", [pp.id, o.id, ["feed", "share", "profile", "explore"][k % 4], new Date(Date.now() - d * 864e5 - k * 3600e3).toISOString()]); }
for (const o of others) await db.run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,'like',$3) ON CONFLICT DO NOTHING", [posts[0].id, o.u.id, new Date().toISOString()]);
for (const o of others) await db.run("INSERT INTO content_attention(post,author,user_id,day,kind,ms,progress,media_ms,at) VALUES($1,$2,$3,$4,'page',$5,$6,0,$7)", [posts[0].id, me.id, o.u.id, new Date().toISOString().slice(0, 10), 90000, [40, 80, 100][others.indexOf(o)], new Date().toISOString()]);
await api("PUT", "/api/creator/analytics/goals", { metric: "followers", target: 50 });
await api("PUT", "/api/creator/analytics/goals", { metric: "posts", target: 3 });
// P66 data
const week = [["08:00", "23:00"], ["08:00", "23:00"], ["08:00", "23:00"], ["08:00", "23:00"], ["08:00", "23:59"], ["14:00", "01:00"], null];
const places = [];
for (const [n, c, dl] of [["مقهى المرسى", "cafe", 0.004], ["مكتبة الملك فهد العامة", "library", 0.012], ["مسجد الحي", "mosque", -0.006], ["حديقة الشاطئ", "park", 0.02]]) {
  rl(); const r = await as(0, "POST", "/api/places", { name: n, category: c, descr: "مكان جميل وهادئ يناسب القراءة واللقاءات الصغيرة مع الأصدقاء.", address: "حي الشاطئ، جدة", lat: 21.5433 + dl, lng: 39.1728 + dl / 2, hoursWeek: c === "park" ? null : week, url: "https://example.com" });
  await db.run("UPDATE places SET status='approved' WHERE id=$1", [r.place.id]); places.push(r.place);
}
rl(); await as(1, "POST", `/api/places/${places[0].id}/reviews`, { rating: 5, text: "أفضل قهوة مختصة في الحي، والجلسات مريحة للعمل." });
rl(); await as(2, "POST", `/api/places/${places[0].id}/reviews`, { rating: 4, text: "مكان جميل لكنه مزدحم مساء الخميس." });
await db.run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES('m_x1',$1,'image','image/png',1,'x','ready',$2,$3)", [others[1].u.id, JSON.stringify({ original: "/icons/icon-512.png" }), new Date().toISOString()]);
rl(); await as(1, "POST", `/api/places/${places[0].id}/photos`, { media: "m_x1", caption: "الواجهة" });
rl(); await as(0, "POST", "/api/events/plus", { name: "أمسية قراءة في الحي", startsAt: new Date(Date.now() + 2 * 864e5).toISOString(), place: "مكتبة الملك فهد", lat: 21.551, lng: 39.176 });
rl(); await as(0, "POST", "/api/events/plus", { name: "لقاء مطوري Pi في جدة", startsAt: new Date(Date.now() + 5 * 864e5).toISOString(), place: "مقهى المرسى", lat: 21.547, lng: 39.175 });
// P71 data
rl(); const g = await api("POST", "/api/study/groups", { name: "حلقة الفجر لتحفيظ القرآن", desc: "نحفظ جزء عمّ معاً بهدوء وإتقان", mode: "halaqa", subject: "جزء عمّ", level: "beginner", type: "public", schedule: { days: [0, 2, 4], time: "05:30", tz: "Asia/Riyadh", durationMin: 45 } });
const cid = g.group.id;
for (let i = 0; i < 3; i++) { rl(); await as(i, "POST", `/api/communities/${cid}/join`, { acceptRules: true }); }
for (let k = 0; k < 4; k++) {
  rl(); const s = await api("POST", `/api/study/groups/${cid}/sessions`, { title: `مراجعة سورة ${["النبأ", "النازعات", "عبس", "التكوير"][k]}`, startsAt: new Date(Date.now() + (k + 1) * 600e3).toISOString(), durationMin: 45, agenda: "تسميع الحفظ السابق\nحفظ جديد\nمراجعة جماعية" });
  const sid = s.session.id; await api("POST", `/api/study/sessions/${sid}/start`, { room: false });
  for (let i = 0; i < 3; i++) if ((i + k) % 3) { rl(); await as(i, "POST", `/api/study/sessions/${sid}/join`); }
  await api("POST", `/api/study/sessions/${sid}/end`);
}
rl(); const up = await api("POST", `/api/study/groups/${cid}/sessions`, { title: "مراجعة سورة الانفطار", startsAt: new Date(Date.now() + 864e5).toISOString(), durationMin: 45, agenda: "تسميع سورة التكوير\nحفظ الانفطار ١–١٠\nأسئلة" });
const a1 = await api("POST", `/api/study/groups/${cid}/assignments`, { title: "مراجعة سورة النبأ", body: "سمّع الآيات ١–٢٠ وسجّل صوتك", dueAt: new Date(Date.now() + 2 * 864e5).toISOString(), points: 10, sessionId: up.session.id });
await api("POST", `/api/study/groups/${cid}/assignments`, { title: "كتابة معاني الكلمات الغريبة", dueAt: new Date(Date.now() - 864e5).toISOString(), points: 10 });
rl(); await as(0, "POST", `/api/study/assignments/${a1.assignment.id}/submit`, { body: "سمّعت الآيات كاملة والحمد لله", url: "https://example.com/rec" });
rl(); await as(1, "POST", `/api/study/assignments/${a1.assignment.id}/submit`, { body: "أخطأت في الآية ١٤ وأعدتها" });
await api("POST", `/api/study/assignments/${a1.assignment.id}/review/${others[0].u.id}`, { grade: 9, feedback: "ممتاز، انتبه للمدّ في الآية ٦" });
rl(); await api("POST", `/api/study/groups/${cid}/progress`, { studentId: others[0].u.id, kind: "memorisation", surah: 78, fromAyah: 1, toAyah: 20, grade: "excellent" });
// fresh creator for empty states
const SCREENS = [
  ["ca-overview", "#/analytics"], ["ca-audience", "#/analytics/audience"], ["ca-content", "#/analytics/content"], ["ca-post", "#/analytics/post/" + posts[0].id], ["ca-earnings", "#/analytics/earnings"],
  ["nb-nearby", "#/nearby?city=" + encodeURIComponent("جدة") + "&radius=10"], ["nb-place", "#/place/" + places[0].id], ["nb-place2", "#/place/" + places[3].id], ["nb-city", "#/city/" + encodeURIComponent("جدة")], ["nb-cities", "#/cities"], ["nb-saved", "#/places/saved"], ["nb-new", "#/places/new"],
  ["sd-list", "#/study"], ["sd-group", `#/study/${cid}/sessions`], ["sd-asg", `#/study/${cid}/assignments`], ["sd-dash", `#/study/${cid}/dashboard`], ["sd-progress", `#/study/${cid}/progress`], ["sd-session", "#/study/session/" + up.session.id], ["sd-assignment", "#/study/assignment/" + a1.assignment.id], ["sd-attendance", `#/study/${cid}/attendance`],
];
const want = ONLY ? ONLY.split(",") : null;
for (const [name, hash] of SCREENS) {
  if (want && !want.includes(name)) continue;
  await p.goto(S.base + "/?nosw" + hash); await p.waitForTimeout(1700);
  await p.evaluate(() => { document.querySelectorAll(".nf-toast, .toast, #toast, .tour").forEach((x) => x.remove()); document.activeElement?.blur?.(); if (!document.getElementById("ds-hide")) document.head.insertAdjacentHTML("beforeend", `<style id="ds-hide">.bottomnav,#fab,#bt-fab,.skip-link,a[href="#view"]{display:none!important}</style>`); });
  await p.screenshot({ path: `${OUT}/${name}-${W}-${THEME}.png`, fullPage: true });
}
// empty states with a brand-new account
if (!want || want.includes("empty")) {
  const c2 = await S.browser.newContext(MOB); const q = await c2.newPage(); await onboard(q, S.base, "ds_new", "عضو جديد");
  for (const [name, hash] of [["empty-analytics", "#/analytics"], ["empty-saved", "#/places/saved"], ["empty-study", "#/study"]]) { await q.goto(S.base + "/?nosw" + hash); await q.waitForTimeout(1500); await q.evaluate(() => { document.querySelectorAll(".nf-toast,.tour").forEach((x) => x.remove()); document.head.insertAdjacentHTML("beforeend", `<style>.bottomnav,#fab,#bt-fab{display:none!important}</style>`); }); await q.screenshot({ path: `${OUT}/${name}-${W}-${THEME}.png`, fullPage: true }); }
  await c2.close();
}
console.log("errors:", errs);
await ctx.close(); await S.close();
