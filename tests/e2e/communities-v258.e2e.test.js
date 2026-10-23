/* v2.58.0 «المجتمع 3.0» stage 3 — the community page in a real browser: announcement bar (dismiss per member), pins,
 * channels grouped by category with unread counts, tabs that repaint only #c-body (the link follows, CLS 0, no re-render),
 * members from the server with search and filters, numbered rule cards with severity, welcome steps moved from
 * localStorage to the server. Accounts are made through the API (fast; the UI sign-up is covered elsewhere). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, tourDone, MOBILE, DESKTOP } = require("./harness");
let S, cid, O, U; const errors = [];
const reg = async (handle, name) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name, handle, password: "secret1234" }) }); const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); await tourDone(S.base, ck); return ck; };
const api = (ck) => async (m, path, b) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + path, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
const page = async (ck, opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); await c.addCookies(ck.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: S.base }; })); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(S.base + "/?nosw"); await p.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 }); await p.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/home"; route(); }); await p.waitForSelector(".bottomnav a[data-r=home]", { state: "visible", timeout: 20000 }); return p; };
test.before(async () => {
  S = await startStack();
  O = await reg("c8_owner", "مالكة صنّاع Pi"); U = await reg("c8_member", "عضو صنّاع Pi");
  const o = api(O);
  cid = (await o("POST", "/api/communities", { name: "صنّاع Pi في مكة", desc: "نلتقي ونبني معاً", topic: "dev", rules: ["الاحترام أولاً"] })).community.id;
  await o("PATCH", `/api/communities/${cid}/identity`, { welcome: { message: "أهلاً بك بيننا!", steps: ["عرّف بنفسك", "اقرأ الويكي"] } });
  await api(U)("PUT", `/api/communities/${cid}/membership`);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
test("v2.58 page: announcement bar, pins, grouped channels with unread, tabs repaint only the body (link + CLS 0), members filters, rule cards, welcome steps on the server", async () => {
  const o = api(O), call = (_p, m, u, b) => (_p === "o" ? o : api(U))(m, u, b);
  const g = (await call("o", "POST", `/api/communities/${cid}/channel-groups`, { name: "المشاريع" })).group;
  const proj = (await call("o", "POST", `/api/communities/${cid}/channels`, { name: "عرض المشاريع", group: g.id, viewPerm: "public" })).channel;
  const pin = (await call("o", "POST", "/api/posts", { community: cid, text: "اقرؤوا دليل المبتدئين قبل أول مشروع" })).post;
  await call("o", "POST", `/api/communities/${cid}/pins`, { post: pin.id });
  await call("o", "POST", `/api/communities/${cid}/announcements`, { title: "لقاء صنّاع Pi يوم الجمعة", body: "في مقهى الحي، الساعة 8 مساءً" });
  await call("o", "PUT", `/api/communities/${cid}/rules`, { rules: [{ title: "الاحترام أولاً", body: "نقد الفكرة لا الشخص", severity: "serious" }, { title: "لا رسائل مزعجة", severity: "warn" }], required: true });
  await call("o", "POST", "/api/posts", { community: cid, channel: proj.id, text: "مشروع جديد: متجر صغير يقبل Pi" });
  const u = await page(U);
  await u.evaluate((id) => localStorage.setItem(`mp_ob_${id}_1`, "1"), cid); // a step ticked before v2.58
  await u.goto(S.base + "/?nosw#/c/" + cid); await u.waitForSelector(".c-ann");
  assert.match(await u.textContent(".c-ann"), /لقاء صنّاع Pi/);
  await u.waitForSelector(".c-pins"); assert.match(await u.textContent(".c-pins"), /دليل المبتدئين/);
  assert.ok(await u.$('.c-chs .c-chgl:text("المشاريع")'), "channels grouped by category");
  await u.waitForSelector(`[data-ch="${proj.id}"] .c-unr:not([hidden])`);
  await u.click(`[data-ch="${proj.id}"]`); await u.waitForSelector(`[data-ch="${proj.id}"].on .c-unr[hidden]`, { state: "attached" });
  await u.waitForFunction(() => /متجر صغير/.test(document.querySelector("#c-feed")?.textContent || ""));
  // tabs: the page stays, the link follows, nothing shifts
  await u.evaluate(() => { window.__pg = document.querySelector(".c-page"); window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift" }); });
  await u.click('[data-ctab="about"]'); await u.waitForSelector(".c-rcards .c-rc");
  assert.match(await u.evaluate(() => location.hash), /\/about$/); assert.ok(await u.evaluate(() => window.__pg === document.querySelector(".c-page")), "no full re-render");
  assert.equal(await u.$$eval(".c-rc", (x) => x.length), 2); assert.match(await u.textContent(".c-rc.sev-serious"), /نقد الفكرة لا الشخص/);
  await u.click('[data-ctab="members"]'); await u.waitForSelector("#m-list .m-row");
  await u.fill("#m-q", "c8_owner"); await u.waitForFunction(() => document.querySelectorAll("#m-list .m-row").length === 1);
  await u.fill("#m-q", ""); await u.click('[data-mf="staff"]'); await u.waitForFunction(() => document.querySelectorAll("#m-list .m-row").length >= 1 && /المالك/.test(document.querySelector("#m-list").textContent));
  await u.click('[data-ctab="posts"]'); await u.waitForSelector("#c-feed");
  assert.equal(await u.evaluate(() => Math.round(window.__cls * 1000)), 0, "CLS 0 on tab switch");
  // welcome steps moved to the server; the old localStorage mark is gone
  const ob = (await call("u", "GET", `/api/communities/${cid}/onboarding`)).onboarding; assert.equal(ob.steps[1].done, true);
  assert.equal(await u.evaluate((id) => localStorage.getItem(`mp_ob_${id}_1`), cid), null);
  // the announcement closes for this member only
  await u.click(".c-ann-x"); await u.waitForSelector(".c-ann", { state: "detached" });
  await u.waitForFunction(async (id) => (await (await fetch(`/api/communities/${id}/space`)).json()).announcement === null, cid);
  assert.ok((await call("o", "GET", `/api/communities/${cid}/space`)).announcement, "still shown to the others");
  await u.context().close();
});


async function axeRun(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
test("axe on the community page: no serious/critical issues — 390 light, 1440 dark, LTR", async () => {
  const bad = [];
  const tabs = async (p, tag) => { for (const t of ["posts", "about", "members"]) { await p.click(`[data-ctab="${t}"]`); await p.waitForTimeout(500); for (const v of await axeRun(p)) bad.push(tag + " " + t + " " + v); } };
  const m = await page(U); await m.goto(S.base + "/?nosw#/c/" + cid); await m.waitForSelector(".c-chs"); await tabs(m, "390 light"); await m.context().close();
  const d = await page(O, { ...DESKTOP, colorScheme: "dark" }); await d.goto(S.base + "/?nosw#/c/" + cid); await d.waitForSelector(".c-chs"); await tabs(d, "1440 dark"); await d.context().close();
  const l = await page(U); await l.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await l.evaluate(() => window.MPI18n.setLang("en"));
  await l.goto(S.base + "/?nosw#/c/" + cid); await l.waitForFunction(() => document.documentElement.dir === "ltr" && !!document.querySelector(".c-chs"), null, { timeout: 15000 }); await tabs(l, "ltr");
  await l.evaluate(() => window.MPI18n.setLang("ar")); await l.context().close();
  assert.deepEqual(bad, []);
});
