/* v2.120 community dashboard AI (#/cadmin, free allowance stub): health → weekly report (made on request, cited posts, cached);
 * moderation queue → «رأي الذكاء» on a report (verdict, rule only if it really exists, suggestion, copyable note — nothing applied);
 * rules → AI rules + welcome drafts fill the form unsaved (save bar), saved only on «حفظ». Plain members are refused (403). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let calls = 0, last = "";
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  calls++; const q = (last = msgs[msgs.length - 1].content); const id = (q.match(/"id":"([^"]+)"/) || [])[1];
  if (q.startsWith("اكتب تقريراً")) return { text: JSON.stringify({ headline: "أسبوع نشيط حول القهوة", good: [{ text: "نقاش جميل عن المحامص", cites: [id, "p_fake"] }], watch: [{ text: "أسئلة بلا رد", cites: [] }], actions: ["ثبّت منشور ترحيب"] }), model: "m" };
  if (q.startsWith("عنصر في طابور")) return { text: JSON.stringify({ verdict: "violation", rule: "الاحترام", why: "فيه سبّ لعضو آخر.", suggest: "remove", note: "نرجو الالتزام بالاحترام." }), model: "m" };
  if (q.startsWith("اقترح قواعد")) return { text: JSON.stringify({ rules: [{ title: "الاحترام أولاً", body: "لا سبّ ولا تنمّر", severity: "serious" }, { title: "لا إعلانات", body: "", severity: "weird" }] }), model: "m" };
  if (q.startsWith("اكتب رسالة ترحيب")) return { text: JSON.stringify({ message: "أهلاً بك في مجتمع القهوة!", steps: ["عرّف بنفسك في منشور", "أكمل ملفك"] }), model: "m" };
  return { text: "{}", model: "m" };
} };
let S, cid, own, mem, rep; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const go = async (p, h) => { await p.evaluate((h) => { location.hash = h; }, h); await p.waitForFunction(() => !document.querySelector("#view .skel"), null, { timeout: 15000 }); };
const mk = async (who) => { const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); await c.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {}); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(who + ": " + e.message)); p.on("dialog", (d) => d.dismiss().catch(() => {})); return p; };

test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  own = await mk("owner"); await onboard(own, S.base, "cai_owner", "مالك القهوة");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع القهوة المختصة", desc: "كل شي عن القهوة", rules: ["الاحترام"] })).community.id;
  mem = await mk("member"); await onboard(mem, S.base, "cai_mem", "عضو القهوة"); await call(mem, "PUT", `/api/communities/${cid}/membership`);
  for (const t of ["أفضل محمصة في جدة؟ شاركونا تجاربكم", "اشتروا من متجري خصم كبير على القهوة كلموني خاص"]) await call(mem, "POST", "/api/posts", { text: t, community: cid });
  const bad = await S.app.ctx.db.get("SELECT id, status FROM posts WHERE text LIKE '%متجري%'");
  assert.ok(bad, "post stored"); rep = bad; // held by the auto-guard (pending) — or published, then reported
  if (bad.status === "published") assert.ok((await call(own, "POST", "/api/reports", { target: bad.id, kind: "post", reason: "إساءة" })).status < 300, "report filed");
});
test.after(async () => { await S?.close(); });
test.beforeEach(() => S.app.ctx.rl.w?.clear?.());

test("health: weekly AI report on request, real citations only, cached on revisit", async () => {
  await go(own, `#/cadmin/${cid}?s=health`); await own.waitForSelector("#cai-rep [data-rep]");
  calls = 0; await own.click("#cai-rep [data-rep]"); await own.waitForSelector("#cai-rep .cai-lead", { timeout: 10000 });
  assert.equal(calls, 1); assert.ok(last.includes("أفضل محمصة"), "posts sent");
  const t = await own.textContent("#cai-rep"); assert.match(t, /أسبوع نشيط/); assert.match(t, /يحتاج انتباهك/); assert.match(t, /ثبّت منشور ترحيب/);
  assert.equal(await own.locator("#cai-rep .cai-src").count(), 1, "made-up id dropped");
  if (process.env.SHOT) await own.locator("#cai-rep").screenshot({ path: process.env.SHOT + "-rep.png" });
  await go(own, `#/cadmin/${cid}?s=home`); await go(own, `#/cadmin/${cid}?s=health`);
  await own.click("#cai-rep [data-rep]"); await own.waitForSelector("#cai-rep .cai-lead"); assert.equal(calls, 1, "cached");
});

test("queue: «رأي الذكاء» suggests, applies nothing; toggles closed", async () => {
  await go(own, `#/cadmin/${cid}?s=moderation`); await own.waitForSelector('.mq-item [data-act="ai"]', { timeout: 15000 });
  calls = 0; await own.click('.mq-item [data-act="ai"] >> nth=0'); await own.waitForSelector(".mq-item [data-ai-out] .cai-v", { timeout: 10000 });
  assert.equal(calls, 1); assert.ok(last.includes("متجري") && last.includes("الاحترام"));
  const t = await own.textContent(".mq-item [data-ai-out]"); assert.match(t, /يبدو مخالفاً/); assert.match(t, /نرجو الالتزام/);
  assert.equal((await S.app.ctx.db.get("SELECT status FROM posts WHERE id=$1", [rep.id])).status, rep.status, "nothing applied to the post");
  if (rep.status === "published") assert.equal((await S.app.ctx.db.get("SELECT status FROM reports WHERE target=$1", [rep.id])).status, "open", "report still open");
  else assert.match(t, /اقتراح: (حذف المحتوى|الرفض)/);
  if (process.env.SHOT) await own.locator(".mq-item").first().screenshot({ path: process.env.SHOT + "-rv.png" });
  await own.click('.mq-item [data-act="ai"] >> nth=0'); assert.ok(await own.locator(".mq-item [data-ai-out]").first().isHidden());
});

test("rules: AI drafts fill the form unsaved; saved only on «حفظ»", async () => {
  await go(own, `#/cadmin/${cid}?s=rules`); await own.waitForSelector('[data-aid="rules"]');
  const before = (await call(own, "GET", `/api/communities/${cid}/rules`)).rules.length;
  await own.click('[data-aid="rules"]'); await own.waitForFunction(() => [...document.querySelectorAll(".ca-rt")].some((i) => i.value === "الاحترام أولاً"), null, { timeout: 10000 });
  assert.equal(await own.$eval(".ca-ru:last-child input[type=radio]:checked", (i) => i.value), "info", "unknown severity → info");
  await own.click('[data-aid="welcome"]'); await own.waitForFunction(() => document.querySelector('[data-k="welcome"]')?.value === "أهلاً بك في مجتمع القهوة!", null, { timeout: 10000 });
  assert.equal(await own.$$eval('[data-list="steps"] input, [data-list="steps"] textarea', (x) => x.map((i) => i.value).join("|")), "عرّف بنفسك في منشور|أكمل ملفك");
  assert.equal((await call(own, "GET", `/api/communities/${cid}/rules`)).rules.length, before, "not saved yet");
  await own.waitForSelector("#ca-save:not([hidden]) [data-ca=\"save\"]", { timeout: 8000 }); await own.click("#ca-save [data-ca=\"save\"]");
  await own.waitForFunction(async (cid) => { const r = await (await fetch(`/api/communities/${cid}/rules`)).json(); return r.rules.some((x) => x.title === "الاحترام أولاً"); }, cid, { timeout: 10000, polling: 500 });
});

test("permissions: a plain member is refused; no page errors", async () => {
  assert.equal((await call(mem, "POST", "/api/aihub/community", { cid, tool: "report" })).status, 403);
  assert.equal((await call(own, "POST", "/api/aihub/community", { cid, tool: "nope" })).status, 400);
  assert.deepEqual(errors, []);
});
