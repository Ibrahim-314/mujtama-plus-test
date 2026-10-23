/* Screenshots of the v2.5 community features using the E2E harness. */
const { startStack, onboard, MOBILE } = require("../tests/e2e/harness");
(async () => {
  const S = await startStack(); const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await c.newPage();
  await onboard(p, S.base, "jeddah_makers", "صناع جدة");
  const call = (m, u, b) => p.evaluate(async ([m, u, b]) => (await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json(), [m, u, b]);
  const cid = (await call("POST", "/api/communities", { name: "صنّاع Pi في جدة", desc: "مطورون ومصممون يبنون تطبيقات Pi معاً. لقاء شهري وتحديات أسبوعية.", topic: "dev", rules: ["الاحترام أولاً", "لا إعلانات"] })).community.id;
  await call("PATCH", `/api/communities/${cid}/identity`, { icon: "🚀", accent: "#0f766e", tags: [{ name: "سؤال", color: "#2563eb" }, { name: "مشروع", color: "#16a34a" }], welcome: { message: "أهلاً بك بيننا! ابدأ بهذه الخطوات:", steps: ["عرّف بنفسك في #نقاش-عام", "اقرأ دليل المبتدئين في الويكي"] } });
  await call("POST", `/api/communities/${cid}/channels`, { name: "الإعلانات", kind: "announcements" });
  const gen = (await call("POST", `/api/communities/${cid}/channels`, { name: "نقاش عام" })).channel;
  await call("POST", `/api/communities/${cid}/channels`, { name: "عرض المشاريع" });
  await call("POST", "/api/posts", { text: "أطلقنا اليوم أول نسخة من محفظة الإيصالات 🎉 جرّبوها وشاركونا رأيكم", community: cid, channel: gen.id, ctag: "مشروع" });
  await call("POST", `/api/communities/${cid}/challenges`, { title: "تحدي أسبوع الواجهات", tag: "تحدي_الواجهات", endsAt: new Date(Date.now() + 5 * 864e5).toISOString() });
  const ev = (await call("POST", "/api/events/plus", { name: "لقاء صنّاع Pi الشهري", desc: "عروض مشاريع ونقاش مفتوح", startsAt: new Date(Date.now() + 4 * 864e5 + 3 * 3600e3).toISOString(), place: "جدة", address: "حي الشاطئ، جدة", lat: 21.5904, lng: 39.1063, capacity: 40, recurrence: "monthly", community: cid })).event;
  await p.evaluate(() => refresh());
  await p.goto(S.base + "/?nosw#/c/" + cid); await p.waitForSelector(".c-icon"); await p.waitForTimeout(700);
  await p.screenshot({ path: process.argv[2] });
  await p.goto(S.base + "/?nosw#/event/" + ev.id); await p.waitForSelector("#ev-cd span"); await p.waitForTimeout(1500);
  await p.screenshot({ path: process.argv[3] });
  await S.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
