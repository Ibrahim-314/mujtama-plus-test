/* global PiAdapter */
/* Phase 40 (client): ethical ads «الإعلانات الأخلاقية» in a real browser against the production build.
 * The ads API (/api/ads/*, /api/me/ads/*, /api/admin/ads/*) and Pi (/api/pi/*, fake window.Pi) are stubbed per
 * docs/integration/p40-contract.md; /api/feed is the REAL ranked feed with promoted items spliced in (as the server will).
 * Users, session, posts, chunks and the CSP are real.
 * Covers: lazy "ads" chunk (not in core, core ≤ 90 KB br), promoted card («مُروَّج» label + advertiser, accessible name,
 * never first slot), impression once at ≥ 50 % for ≥ 1 s, click once on open, ⋯ menu (why sheet, hide ad, hide advertiser),
 * #/ads list, wizard (validation, topics, live estimate with «أقل من 10», server error → right step, submit), dashboard
 * (KPIs with k-anon, inline-SVG chart + table, pause/resume, fund via MPPi.pay purpose ads, Pi off), #/settings/ads prefs,
 * #/admin/ads/review (reasons required, approve/reject), entry cards, minors, axe, and the real CSP with no violations. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path"), fs = require("node:fs");
const { ensureBuild, startStack, onboard, MOBILE, ROOT } = require("./harness");
let S, P, ctxMain, ME = null; const errors = [];
const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
const now = () => new Date().toISOString();
const ADV = { handle: "noor_brand", name: "متجر نور" }, ADV2 = { handle: "fahad_tools", name: "أدوات فهد" };
const W = {}; // seeded ids

/* ---------- contract stub ---------- */
const st = { enabled: true, minor: false, calls: [], campaigns: {}, queue: [], prefs: null, createError: null, fundError: null, adsInFeed: true };
function seed() {
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10); return { day: d, impressions: i === 0 ? null : 40 + i * 25, clicks: i < 3 ? null : 10 + i, spend: 0.05 * (i + 1), ctr: null }; });
  st.campaigns = {
    ac_dash: { id: "ac_dash", name: "ترويج دليل RTL", objective: "reach", postId: W.mine, status: "active", targeting: { topics: ["dev"], languages: ["ar"], countries: ["SA"] }, budgetTotal: 5, dailyCap: 1, freqCap: { impressions: 3, perHours: 24 }, startAt: now(), endAt: new Date(Date.now() + 6 * 864e5).toISOString(), reviewNote: "", stats: { days, totals: { impressions: 345, clicks: null, spend: 1.4, ctr: null } } },
    ac_wait: { id: "ac_wait", name: "حملة بانتظار التمويل", objective: "engagement", postId: W.mine, status: "awaiting_funds", targeting: { topics: [], languages: [], countries: [] }, budgetTotal: 3, dailyCap: 0.5, freqCap: { impressions: 2, perHours: 48 }, startAt: now(), endAt: new Date(Date.now() + 5 * 864e5).toISOString(), stats: { days: [], totals: { impressions: 0, clicks: 0, spend: 0 } } },
    ac_rej: { id: "ac_rej", name: "حملة مرفوضة", objective: "visits", postId: W.mine, status: "rejected", targeting: { topics: ["ai"], languages: [], countries: [] }, budgetTotal: 2, dailyCap: 1, startAt: now(), endAt: new Date(Date.now() + 2 * 864e5).toISOString(), reviewNote: "العنوان يعد بنتائج مضمونة", reviewReasons: ["misleading"], stats: { days: [], totals: {} } }
  };
  st.queue = [
    { id: "ac_q1", name: "خصم على الدورات", advertiser: { handle: "sara_b", name: "سارة" }, post: { id: "p_q1", text: "دورة برمجة بخصم 50٪ لأول 100 مشترك" }, postId: "p_q1", targeting: { topics: ["learn"], languages: ["ar"], countries: ["EG"] }, budgetTotal: 4, startAt: now(), endAt: now(), automod: { labels: ["promo_claim"] }, submittedAt: now() },
    { id: "ac_q2", name: "تطبيق محفظة", advertiser: { handle: "yousef_pi", name: "يوسف" }, post: { id: "p_q2", text: "جرّب محفظة الإيصالات الجديدة" }, postId: "p_q2", targeting: { topics: [], languages: [], countries: [] }, budgetTotal: 1, startAt: now(), endAt: now(), submittedAt: now() }];
  st.prefs = { personalized: true, hiddenAdvertisers: [{ id: "u_x", handle: "brand_x", name: "متجر إكس" }] };
}
const PROMO = () => ({ [W.ad1]: { campaignId: "ac_1", label: "مُروَّج", advertiser: ADV, token: "tok_1" }, [W.ad2]: { campaignId: "ac_2", label: "مُروَّج", advertiser: ADV2, token: "tok_2" } });
async function stub(ctx) {
  const rt = (g, fn) => ctx.route(g, async (r) => { try { await fn(r); } catch (e) { if (!/disposed|closed|Target page/i.test(e.message)) throw e; } });
  const json = (r, status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // the REAL ranked feed; the ad posts are placed at server positions 0 (client must move it) and 5, carrying `promoted`
  await rt(/\/api\/feed\?/, async (r) => {
    const u = new URL(r.request().url()); if (r.request().method() !== "GET" || !st.adsInFeed || /^list:/.test(u.searchParams.get("mode") || "")) return r.fallback();
    const res = await r.fetch(), j = await res.json(), pr = PROMO(), ads = (j.posts || []).filter(p => pr[p.id]), org = (j.posts || []).filter(p => !pr[p.id]);
    const a1 = ads.find(p => p.id === W.ad1), a2 = ads.find(p => p.id === W.ad2), out = [...org];
    if (a2) out.splice(Math.min(5, out.length), 0, { ...a2, promoted: pr[W.ad2] });
    if (a1) out.unshift({ ...a1, promoted: pr[W.ad1] });
    return json(r, 200, { ...j, posts: out });
  });
  const handler = async (r) => {
    const req = r.request(), u = new URL(req.url()), m = req.method(), p = u.pathname; let body = null, mm;
    try { body = req.postDataJSON(); } catch { body = null; }
    st.calls.push({ m, p, q: u.search, body, t: Date.now() });
    if (p === "/api/pi/config") return json(r, 200, { enabled: st.enabled, authEnabled: true, network: "testnet", sandbox: true });
    if (p === "/api/pi/payments/complete") { const c = st.campaigns.ac_wait; if (c && c.status === "awaiting_funds") c.status = "active"; return json(r, 200, { ok: true, receipt: { status: "completed" } }); }
    if (/^\/api\/pi\/payments\/(approve|cancel|incomplete)$/.test(p)) return json(r, 200, { ok: true, status: "approved" });
    if (p === "/api/pi/auth") return json(r, 200, { linked: true, piUsername: "pi_huda" });
    if (st.minor && /^\/api\/ads\/campaigns/.test(p)) return json(r, 403, { error: "minor", code: "minor_restricted" });
    if (p === "/api/ads/events") return json(r, 200, { ok: true });
    if (p === "/api/ads/hide") return json(r, 200, { ok: true });
    if ((mm = /^\/api\/ads\/why\/([^/]+)$/.exec(p))) return json(r, 200, mm[1] === "ac_1" ? { reasons: [{ type: "topic", topic: "dev" }, { type: "language" }, { type: "country" }], personalized: true, controls: { prefs: "/#/settings/ads" } } : { reasons: [{ type: "general" }], personalized: false });
    if (p === "/api/ads/topics") return json(r, 200, { topics: [{ slug: "ai", name: "الذكاء الاصطناعي" }, { slug: "dev", name: "البرمجة" }, { slug: "pi", name: "Pi Network" }, { slug: "learn", name: "التعلم" }] });
    if (p === "/api/ads/estimate") { const t = body?.targeting || {}; return json(r, 200, (t.countries || []).includes("YE") ? { bucket: "<10" } : { bucket: { min: (t.topics || []).length ? 100 : 1000, max: (t.topics || []).length ? 1000 : 10000 } }); }
    if (p === "/api/ads/campaigns" && m === "GET") return json(r, 200, { items: Object.values(st.campaigns).map(({ stats: _s, ...c }) => c) });
    if (p === "/api/ads/campaigns" && m === "POST") {
      if (st.createError) { const e = st.createError; st.createError = null; return json(r, e.status, e.body); }
      const c = { ...body, id: "ac_new", status: "draft", stats: { days: [], totals: {} } }; st.campaigns.ac_new = c; return json(r, 201, { campaign: c });
    }
    if ((mm = /^\/api\/ads\/campaigns\/([^/]+)$/.exec(p))) {
      const c = st.campaigns[mm[1]]; if (!c) return json(r, 404, { error: "not found", code: "not_found" });
      if (m === "GET") { const { stats, ...rest } = c; return json(r, 200, { campaign: rest, stats }); }
      if (m === "PATCH") { Object.assign(c, body); return json(r, 200, { campaign: c }); }
      if (m === "DELETE") { c.status = "removed"; return json(r, 200, { ok: true }); }
    }
    if ((mm = /^\/api\/ads\/campaigns\/([^/]+)\/(submit|pause|resume|fund)$/.exec(p))) {
      const c = st.campaigns[mm[1]], a = mm[2];
      if (a === "fund") {
        if (!st.enabled) return json(r, 409, { error: "Pi payments are not configured", code: "not_configured" });
        if (st.fundError) { const e = st.fundError; st.fundError = null; return json(r, e.status, e.body); }
        return json(r, 200, { intent: { id: "int_" + c.id, amount: c.budgetTotal, memo: `مجتمع بلس — إعلان: ${c.name}`, metadata: { intentId: "int_" + c.id, app: "mujtama", kind: "ads", campaignId: c.id } } });
      }
      c.status = { submit: "in_review", pause: "paused", resume: "active" }[a]; return json(r, 200, { campaign: c });
    }
    if (p === "/api/me/ads/prefs") { if (m === "PUT") st.prefs = { ...st.prefs, ...body, hiddenAdvertisers: body.hiddenAdvertisers.map(id => st.prefs.hiddenAdvertisers.find(x => x.id === id) || id) }; return json(r, 200, st.prefs); }
    if (p === "/api/admin/ads/review") return json(r, 200, { items: st.queue });
    if ((mm = /^\/api\/admin\/ads\/review\/([^/]+)$/.exec(p))) { st.queue = st.queue.filter(x => x.id !== mm[1]); return json(r, 200, { ok: true }); }
    return json(r, 404, { error: "not stubbed " + p });
  };
  for (const g of ["**/api/pi/**", "**/api/ads/**", "**/api/me/ads/**", "**/api/admin/ads/**"]) await rt(g, handler);
}
const FAKE_PI = () => {
  window.__pi = { payments: [] }; window.__piMode = "ok";
  window.Pi = {
    init() { }, authenticate() { return Promise.resolve({ accessToken: "fake-token", user: { uid: "uid-1", username: "pi_huda" } }); },
    createPayment(data, cb) {
      window.__pi.payments.push(JSON.parse(JSON.stringify(data))); const id = "pay_" + window.__pi.payments.length;
      setTimeout(() => cb.onReadyForServerApproval(id), 30);
      if (window.__piMode === "cancel") setTimeout(() => cb.onCancel(id), 120);
      else setTimeout(() => cb.onReadyForServerCompletion(id, "txid_" + id), 150);
    }
  };
};
const until = async (fn, arg, timeout = 12000, page = P) => { const end = Date.now() + timeout; for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 160)); await page.waitForTimeout(60); } };
const waitNode = async (fn, timeout = 8000) => { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error("timed out (node): " + fn.toString().slice(0, 120)); await new Promise(r => setTimeout(r, 50)); } };
const calls = (p, m) => st.calls.filter(c => c.p === p && (!m || c.m === m));
async function axeOn(page, sel) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (await page.evaluate(async (s) => (await axe.run(s ? document.querySelector(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })), sel)).filter(v => ["serious", "critical"].includes(v.impact));
}
const go = async (hash, page = P) => { await page.evaluate((h) => { location.hash = h; }, hash); };
const reloadPi = (page = P) => page.evaluate(() => { window.MPPi?.refresh?.(); PiAdapter.cfg = null; });
const shot = (name, page = P) => process.env.AD_SHOTS ? page.screenshot({ path: path.join(process.env.AD_SHOTS, name + ".png"), fullPage: false }) : null;

test.before(async () => {
  ensureBuild(); // rebuilds dist only when stale — never wipes a fresh shared dist mid-run
  S = await startStack();
  ctxMain = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce" });
  await stub(ctxMain); await ctxMain.addInitScript(FAKE_PI);
  P = await ctxMain.newPage(); P.on("pageerror", e => errors.push(e.message));
  await onboard(P, S.base, "huda_ads", "هدى"); // first account = admin
  ME = await P.evaluate(() => DB.me);
  // real rows: two advertisers with public posts, a few organic posts, and my own public post (promotable)
  const { db } = S.app.ctx, { id } = require(path.join(ROOT, "server", "lib", "core")), at = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const users = {};
  for (const [hd, name, color] of [[ADV.handle, ADV.name, "#b45309"], [ADV2.handle, ADV2.name, "#047857"], ["reem_ai", "ريم", "#be185d"], ["khaled_dev", "خالد", "#1d4ed8"]]) {
    const uid = id("u"); users[hd] = uid;
    await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'',$4,'user',$5,$6)", [uid, hd, name, color, { onboarded: true, interests: [] }, at(60 * 24 * 90)]);
  }
  const post = async (author, text, topic, ago) => { const pid = id("p"); await db.run("INSERT INTO posts(id,author,type,title,text,topic,lang,visibility,status,location,data,created_at) VALUES($1,$2,'post',NULL,$3,$4,'ar','public','published',NULL,NULL,$5)", [pid, author, text, topic, at(ago)]); return pid; };
  for (let i = 0; i < 9; i++) await post(i % 2 ? users.reem_ai : users.khaled_dev, `منشور عضوي رقم ${i + 1} عن البرمجة والذكاء الاصطناعي`, i % 2 ? "ai" : "dev", 10 + i * 7);
  W.ad1 = await post(users[ADV.handle], "عطور نور الجديدة متوفرة الآن بتغليف صديق للبيئة", "dev", 300);
  W.ad2 = await post(users[ADV2.handle], "أدوات فهد: عُدّة برمجة إلكترونيات للمبتدئين", "dev", 320);
  W.mine = await post(ME, "دليلي لاختبار الواجهات باتجاه RTL من اليوم الأول", "dev", 60);
  seed();
  // raw rows skip the services' "feed:<uid>" invalidation, so drop the ranked-feed cache warmed by onboard's #/home visit
  S.app.ctx.cache.del("feed:");
  // onboard() leaves the page on /?nosw#/home, so goto() to the same URL is a same-document hash change (no reload,
  // no /api/bootstrap): reload explicitly so the seeded posts reach the store (wizard) and the ranked feed (promoted cards)
  await P.goto(S.base + "/?nosw#/home"); await P.reload(); await P.waitForSelector(".bottomnav a[data-r=home]");
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("lazy chunk: ads-ui is its own chunk, not in core (core ≤ 90 KB br); «الإعلانات» card on #/settings", async () => {
  const src = await P.evaluate(() => (window.__CHUNKS || {}).ads);
  assert.match(src, /^\/assets\/chunk-ads-.+\.js$/);
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json"), "utf8")), core = b.files.find(f => /^assets\/app-.*\.js$/.test(f.file));
  assert.ok(!/ad-card|\/api\/ads\/|MPAds\s*=/.test(fs.readFileSync(path.join(ROOT, "dist", core.file), "utf8")), "ads code is not in the core bundle");
  assert.ok(core.br <= 90 * 1024, "core ≤ 90 KB br: " + core.br);
  await go("#/settings?s=money"); await P.waitForSelector("#ad-set-c", { timeout: 15000 }); // v2.38: rows filed into sections (campaigns → payments, preferences → content)
  assert.equal(await P.getAttribute("#ad-set-c", "href"), "#/ads"); assert.equal(await P.getAttribute("#ad-set-p", "href"), "#/settings/ads");
  assert.ok(await P.evaluate(() => window.MPChunks.loaded.ads && !!window.MPAds));
});

test("promoted card: «مُروَّج» + advertiser, accessible name, never the first slot; impression once (≥50% ≥1 s), click once on open", async () => {
  await go("#/home"); await P.evaluate(() => scrollTo(0, 0));
  await until(() => document.querySelectorAll("#view .ad-card[data-ad]").length >= 1, null, 20000);
  const info = await P.evaluate(() => { const cards = [...document.querySelectorAll("#view .wrap > .post-card")]; const ad = document.querySelector(".ad-card[data-ad=ac_1]"); const lbl = ad && document.getElementById(ad.getAttribute("aria-labelledby"));
    return { idx: cards.indexOf(ad), role: ad?.getAttribute("role"), name: lbl?.textContent, more: ad?.querySelector("[data-ad-more]")?.getAttribute("aria-label") }; });
  assert.ok(info.idx >= 1, "ad never in the first slot (index " + info.idx + ")");
  assert.equal(info.role, "article"); assert.match(info.name, /مُروَّج/); assert.match(info.name, /متجر نور/); assert.match(info.more, /خيارات الإعلان/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  // ac_1 is near the top: impression after ≥ 1 s, exactly once
  await P.evaluate(() => document.querySelector(".ad-card[data-ad=ac_1]").scrollIntoView({ block: "center" }));
  await shot("feed-ad"); await P.waitForTimeout(1600);
  const imp = calls("/api/ads/events").filter(c => c.body.type === "impression" && c.body.campaignId === "ac_1");
  assert.equal(imp.length, 1); assert.deepEqual(imp[0].body, { campaignId: "ac_1", type: "impression", token: "tok_1" });
  // ac_2 off-screen → nothing; in view < 1 s → nothing; then sent once
  const ac2 = await P.$(".ad-card[data-ad=ac_2]");
  assert.ok(ac2, "second ad (other advertiser) rendered further down"); {
    assert.equal(calls("/api/ads/events").filter(c => c.body.campaignId === "ac_2").length, 0, "no impression while off-screen");
    await P.evaluate(() => document.querySelector(".ad-card[data-ad=ac_2]").scrollIntoView({ block: "center" }));
    await P.waitForTimeout(400); assert.equal(calls("/api/ads/events").filter(c => c.body.campaignId === "ac_2").length, 0, "not before 1 s");
    await P.waitForTimeout(1300); assert.equal(calls("/api/ads/events").filter(c => c.body.campaignId === "ac_2" && c.body.type === "impression").length, 1);
  }
  // scrolling away and back does not resend
  await P.evaluate(() => scrollTo(0, 0)); await P.waitForTimeout(300);
  await P.evaluate(() => document.querySelector(".ad-card[data-ad=ac_1]").scrollIntoView({ block: "center" })); await P.waitForTimeout(1300);
  assert.equal(calls("/api/ads/events").filter(c => c.body.type === "impression" && c.body.campaignId === "ac_1").length, 1);
  // click on open → one click event, post opens
  await P.click(".ad-card[data-ad=ac_1] .post-open");
  await until((id) => location.hash === "#/post/" + id, W.ad1);
  const clk = calls("/api/ads/events").filter(c => c.body.type === "click");
  assert.equal(clk.length, 1); assert.deepEqual(clk[0].body, { campaignId: "ac_1", type: "click", token: "tok_1" });
});

test("⋯ menu: «لماذا أرى هذا الإعلان؟» sheet (reasons + prefs link), keyboard, hide ad, hide advertiser", async () => {
  await go("#/home"); await until(() => !!document.querySelector(".ad-card[data-ad=ac_1] [data-ad-more]"), null, 15000);
  await P.focus(".ad-card[data-ad=ac_1] [data-ad-more]"); await P.keyboard.press("Enter");
  await P.waitForSelector(".ad-sheet #ad-m-why");
  assert.equal(await P.getAttribute(".ad-sheet", "role"), "dialog");
  await P.click("#ad-m-why"); await P.waitForSelector(".ad-why li");
  const t = await P.textContent(".ad-sheet");
  assert.match(t, /لماذا أرى هذا الإعلان؟/); assert.match(t, /البرمجة/); assert.match(t, /لغة/); assert.match(t, /لا نستخدم موقعك/);
  assert.equal(await P.getAttribute("#ad-w-prefs", "href"), "#/settings/ads");
  assert.deepEqual(await axeOn(P, "#sheet"), []);
  await shot("why-sheet");
  await P.keyboard.press("Escape"); await until(() => document.getElementById("sheet").classList.contains("hidden"));
  assert.equal(await P.evaluate(() => document.activeElement?.dataset?.adMore), "ac_1", "focus returns to ⋯");
  // hide this ad
  await P.click(".ad-card[data-ad=ac_1] [data-ad-more]"); await P.click("#ad-m-ad"); await P.click("[data-ad-hr=repetitive]");
  await until(() => !document.querySelector(".ad-card[data-ad=ac_1]"));
  assert.deepEqual(calls("/api/ads/hide", "POST").at(-1).body, { campaignId: "ac_1", scope: "ad", reason: "repetitive" });
  // hide this advertiser (ac_2)
  await P.evaluate(() => { window.rerender?.(); }); await until(() => !document.querySelector(".ad-card[data-ad=ac_1]") && !!document.querySelector(".ad-card[data-ad=ac_2]"), null, 8000);
  await P.click(".ad-card[data-ad=ac_2] [data-ad-more]"); await P.click("#ad-m-adv"); await P.click("[data-ad-hr=irrelevant]");
  await until(() => !document.querySelector(".ad-card[data-ad=ac_2]"));
  assert.deepEqual(calls("/api/ads/hide", "POST").at(-1).body, { campaignId: "ac_2", scope: "advertiser", reason: "irrelevant" });
  await P.evaluate(() => window.rerender?.()); await P.waitForTimeout(300);
  assert.equal(await P.$$eval(".ad-card[data-ad]", n => n.length), 0, "hidden ads stay hidden after a re-render");
});

test("campaign list #/ads + wizard: validation, topics, live estimate («أقل من 10»), server error → right step, submit", async () => {
  await go("#/ads"); await P.waitForSelector("#ad-list [data-ad-c]", { timeout: 15000 });
  assert.equal(await P.$$eval("#ad-list [data-ad-c]", n => n.length), 3);
  assert.match(await P.textContent("[data-ad-c=ac_rej]"), /مرفوض/); assert.ok(await P.$("[data-ad-c=ac_rej] a[href='#/ads/edit/ac_rej']"));
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.click("#ad-new"); await P.waitForSelector("#ad-wz input[name=ad-post]", { timeout: 15000 });
  assert.equal(await P.getAttribute("#ad-steps li[data-s='1']", "aria-current"), "step");
  // step 1 validation
  await P.click("#ad-next"); await until(() => /اختر المنشور/.test(document.getElementById("ad-e-post").textContent) && /3 أحرف/.test(document.getElementById("ad-e-name").textContent));
  await P.check(`input[name=ad-post][value="${W.mine}"]`); await P.fill("#ad-name", "ترويج دليل الواجهات"); await P.check("input[name=ad-obj][value=engagement]");
  await P.click("#ad-next"); await P.waitForSelector("#ad-topics [data-ad-topic]");
  assert.equal(await P.getAttribute("#ad-steps li[data-s='2']", "aria-current"), "step");
  await until(() => /1,000|١٬٠٠٠/.test(document.querySelector("#ad-est b").textContent));
  await P.click("[data-ad-topic=dev]"); assert.equal(await P.getAttribute("[data-ad-topic=dev]", "aria-pressed"), "true");
  await until(() => /١٠٠/.test(document.querySelector("#ad-est b").textContent));
  assert.deepEqual(calls("/api/ads/estimate", "POST").at(-1).body, { targeting: { topics: ["dev"], languages: [], countries: [] } });
  await P.check("[data-ad-lang=ar]"); await P.check("[data-ad-cty=YE]");
  await until(() => document.querySelector("#ad-est b").textContent === "أقل من 10");
  assert.equal(await P.getAttribute("#ad-est", "aria-live"), "polite");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await shot("wizard-targeting");
  await P.uncheck("[data-ad-cty=YE]"); await P.check("[data-ad-cty=SA]");
  await P.click("#ad-next"); await P.waitForSelector("#ad-budget");
  // step 3 validation
  await P.fill("#ad-budget", "2"); await P.fill("#ad-daily", "5"); await P.fill("#ad-fq", "0");
  await P.click("#ad-next"); await until(() => /لا يتجاوز الميزانية/.test(document.getElementById("ad-e-daily").textContent) && /من 1 إلى 20/.test(document.getElementById("ad-e-fq").textContent));
  assert.equal(await P.getAttribute("#ad-daily", "aria-invalid"), "true");
  await P.fill("#ad-daily", "0.5"); await P.fill("#ad-fq", "2"); await P.selectOption("#ad-fh", "12");
  await until(() => /٤ يوم/.test(document.getElementById("ad-hint").textContent));
  await P.click("#ad-next"); await P.waitForSelector("#ad-submit");
  const rv = await P.textContent("#ad-wz");
  assert.match(rv, /ترويج دليل الواجهات/); assert.match(rv, /البرمجة/); assert.match(rv, /السعودية/); assert.match(rv, /العربية/); assert.match(rv, /١٢ ساعة/);
  assert.ok(await P.$(".ad-prev .ad-lbl"), "feed preview shows the «مُروَّج» label");
  // server says a topic is sensitive → back to step 2 with the error
  st.createError = { status: 400, body: { error: "sensitive", code: "targeting_sensitive" } };
  await P.click("#ad-submit"); await until(() => /الفئات الحساسة/.test(document.getElementById("ad-e-tg")?.textContent || ""));
  assert.equal(await P.getAttribute("#ad-steps li[data-s='2']", "aria-current"), "step");
  await P.click("#ad-next"); await P.click("#ad-next"); await P.waitForSelector("#ad-submit"); await P.click("#ad-submit");
  await until(() => location.hash === "#/ads/campaigns/ac_new" && !!document.querySelector("[data-ad-camp=ac_new]"));
  const sent = calls("/api/ads/campaigns", "POST").at(-1).body;
  assert.equal(sent.postId, W.mine); assert.equal(sent.objective, "engagement"); assert.equal(sent.budgetTotal, 2); assert.equal(sent.dailyCap, 0.5);
  assert.deepEqual(sent.targeting, { topics: ["dev"], languages: ["ar"], countries: ["SA"] }); assert.deepEqual(sent.freqCap, { impressions: 2, perHours: 12 });
  assert.ok(Date.parse(sent.startAt) && Date.parse(sent.endAt) > Date.parse(sent.startAt));
  assert.equal(calls("/api/ads/campaigns/ac_new/submit", "POST").length, 1);
  assert.match(await P.textContent("[data-ad-camp=ac_new]"), /قيد المراجعة/);
  // edit a rejected campaign: review note shown, fields prefilled
  await go("#/ads/edit/ac_rej"); await P.waitForSelector("#ad-name");
  assert.equal(await P.inputValue("#ad-name"), "حملة مرفوضة");
});

test("dashboard: KPIs with k-anon, inline-SVG chart + table, review note, pause/resume", async () => {
  await reloadPi(); await go("#/ads/campaigns/ac_dash"); await P.waitForSelector("#ad-kpi", { timeout: 15000 });
  const k = await P.$$eval("#ad-kpi div", n => n.map(x => x.textContent));
  assert.match(k[0], /٣٤٥/); assert.match(k[1], /أقل من 10/); assert.match(k[2], /—/); assert.match(k[3], /1.4 π/);
  assert.equal(await P.$$eval(".ad-chart svg rect", n => n.length), 7);
  assert.equal(await P.$$eval(".ad-chart svg rect.m", n => n.length), 1, "masked day drawn as k-anon");
  assert.equal(await P.getAttribute(".ad-chart svg", "role"), "img");
  assert.equal(await P.$$eval(".ad-chart table tbody tr", n => n.length), 7);
  assert.match(await P.textContent(".ad-chart table"), /أقل من 10/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  await shot("dashboard");
  await P.click("[data-ad-act=pause]"); await until(() => !!document.querySelector("[data-ad-act=resume]"));
  assert.equal(calls("/api/ads/campaigns/ac_dash/pause", "POST").length, 1);
  assert.match(await P.textContent("[data-ad-camp=ac_dash]"), /متوقف مؤقتاً/);
  await P.click("[data-ad-act=resume]"); await until(() => !!document.querySelector("[data-ad-act=pause]"));
  await go("#/ads/campaigns/ac_rej"); await P.waitForSelector("#ad-rn");
  const rn = await P.textContent("#ad-rn"); assert.match(rn, /سبب الرفض/); assert.match(rn, /مضللة/); assert.match(rn, /نتائج مضمونة/);
});

test("fund: Pi off → disabled + «مدفوعات Pi غير مفعّلة بعد»; Pi on → intent unchanged to Pi.createPayment (purpose ads); 409 not_configured", async () => {
  st.enabled = false; await reloadPi();
  await go("#/ads/campaigns/ac_wait"); await P.waitForSelector("#ad-fund", { timeout: 15000 });
  assert.equal(await P.isDisabled("#ad-fund"), true); assert.match(await P.textContent("#ad-fn"), /مدفوعات Pi غير مفعّلة بعد/);
  assert.equal(calls("/api/ads/campaigns/ac_wait/fund").length, 0);
  st.enabled = true; await reloadPi();
  await go("#/ads"); await go("#/ads/campaigns/ac_wait"); await P.waitForSelector("#ad-fund:not([disabled])", { timeout: 15000 });
  st.fundError = { status: 409, body: { error: "Pi payments are not configured", code: "not_configured" } };
  await P.click("#ad-fund"); await until(() => /غير مفعّلة بعد/.test(document.getElementById("ad-fn").textContent));
  assert.equal(await P.isDisabled("#ad-fund"), true);
  await go("#/ads"); await go("#/ads/campaigns/ac_wait"); await P.waitForSelector("#ad-fund:not([disabled])");
  const before = await P.evaluate(() => window.__pi.payments.length);
  await P.click("#ad-fund");
  await until(() => !document.querySelector("#ad-fund") && /نشط/.test(document.querySelector("[data-ad-camp=ac_wait]")?.textContent || ""));
  const pays = await P.evaluate(() => window.__pi.payments);
  assert.equal(pays.length, before + 1);
  assert.deepEqual(pays.at(-1), { amount: 3, memo: "مجتمع بلس — إعلان: حملة بانتظار التمويل", metadata: { intentId: "int_ac_wait", app: "mujtama", kind: "ads", campaignId: "ac_wait" } });
});

test("#/settings/ads prefs: personalized switch + hidden advertisers", async () => {
  await go("#/settings/ads"); await P.waitForSelector("#ad-pz", { timeout: 15000 });
  assert.equal(await P.getAttribute("#ad-pz", "role"), "switch"); assert.equal(await P.isChecked("#ad-pz"), true);
  assert.match(await P.textContent("#ad-pf"), /متجر إكس/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.click("#ad-pz"); await waitNode(() => calls("/api/me/ads/prefs", "PUT").length === 1);
  assert.deepEqual(calls("/api/me/ads/prefs", "PUT")[0].body, { personalized: false, hiddenAdvertisers: ["u_x"] });
  await P.click("[data-ad-unhide=u_x]"); await until(() => /لم تُخفِ أي معلن/.test(document.getElementById("ad-pf").textContent));
  assert.deepEqual(calls("/api/me/ads/prefs", "PUT").at(-1).body, { personalized: false, hiddenAdvertisers: [] });
  assert.equal(await P.isChecked("#ad-pz"), false);
});

test("admin: card on #/admin + #/admin/ads/review (reasons required for reject, approve)", async () => {
  await go("#/admin"); await P.waitForSelector("#ad-adm", { timeout: 15000 });
  await P.click("#ad-adm"); await P.waitForSelector("#ad-rq [data-ad-rv]");
  assert.equal(await P.$$eval("#ad-rq [data-ad-rv]", n => n.length), 2);
  assert.match(await P.textContent("[data-ad-rv=ac_q1]"), /promo_claim/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.click("[data-ad-rv=ac_q1] [data-ad-dec=reject]");
  await until(() => /سبباً واحداً/.test(document.querySelector("[data-ad-rv=ac_q1] [data-ad-err]").textContent));
  assert.equal(calls("/api/admin/ads/review/ac_q1").length, 0);
  await P.check("[data-ad-rv=ac_q1] input[value=misleading]"); await P.fill("[data-ad-rv=ac_q1] [data-ad-note]", "الخصم غير موضّح");
  await P.click("[data-ad-rv=ac_q1] [data-ad-dec=reject]"); await until(() => !document.querySelector("[data-ad-rv=ac_q1]"));
  assert.deepEqual(calls("/api/admin/ads/review/ac_q1", "POST").at(-1).body, { decision: "reject", reasons: ["misleading"], note: "الخصم غير موضّح" });
  await P.click("[data-ad-rv=ac_q2] [data-ad-dec=approve]"); await until(() => /لا حملات بانتظار المراجعة/.test(document.getElementById("ad-rq").textContent));
  assert.deepEqual(calls("/api/admin/ads/review/ac_q2", "POST").at(-1).body, { decision: "approve", reasons: [], note: "" });
});

test("minors: 403 minor_restricted on #/ads shows the Arabic reason (no retry)", async () => {
  st.minor = true;
  await go("#/ads"); await until(() => /دون 18/.test(document.getElementById("ad-list")?.textContent || ""));
  assert.equal(await P.$("#ad-list [data-ui=route]"), null);
  st.minor = false;
});

test("real CSP (no 'unsafe-inline'): deep link to a dashboard, pause, feed ad menu + why sheet, with no violations", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce", bypassCSP: false });
  await stub(ctx); await ctx.addInitScript(FAKE_PI);
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
  const p = await ctx.newPage(); p.on("pageerror", e => errors.push("csp page: " + e.message));
  await ctx.addCookies(await ctxMain.cookies());
  st.campaigns.ac_dash.status = "active";
  await p.goto(S.base + "/?nosw#/ads/campaigns/ac_dash");
  await p.waitForSelector("[data-ad-act=pause]", { timeout: 15000 });
  assert.match((await (await p.request.get(S.base + "/")).headers()["content-security-policy"]) || "", /script-src 'self'/);
  await p.click("[data-ad-act=pause]"); await until(() => !!document.querySelector("[data-ad-act=resume]"), null, 12000, p);
  await p.evaluate(() => { location.hash = "#/home"; });
  await until(() => !!document.querySelector(".ad-card [data-ad-more]"), null, 20000, p);
  await p.click(".ad-card [data-ad-more]"); await p.click("#ad-m-why"); await p.waitForSelector(".ad-why li");
  await p.click("#ad-w-prefs"); await until(() => location.hash === "#/settings/ads" && !!document.querySelector("#ad-pz"), null, 12000, p);
  assert.deepEqual((await p.evaluate(() => window.__csp)).filter(v => /script/.test(v)), []);
  await ctx.unrouteAll({ behavior: "ignoreErrors" }); await ctx.close();
});

test("real P40 server (no ads / Pi stubs): wizard on own post → submit → admin approves → awaiting_funds (Pi off); promoted item in the real feed; why sheet; hide advertiser; no user ids in stats tables", async () => {
  const { db, bus } = S.app.ctx, { id } = require(path.join(ROOT, "server", "lib", "core")), at = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce" });
  await ctx.addInitScript(FAKE_PI); await ctx.addCookies(await ctxMain.cookies());
  const p = await ctx.newPage(); p.on("pageerror", e => errors.push("real page: " + e.message));
  const evts = []; p.on("response", async (r) => { if (/\/api\/ads\/events$/.test(r.url())) evts.push({ status: r.status(), body: await r.json().catch(() => null) }); });
  const cfg = await (await p.request.get(S.base + "/api/ads/config")).json();
  assert.equal(cfg.label, "مُروَّج"); assert.ok(cfg.minBudget > 0 && cfg.freqCap.maxHours === 24);
  const pc = await (await p.request.get(S.base + "/api/pi/config")).json();
  assert.equal(pc.enabled, false, "this stack runs with Pi payments off (as production)");
  // 1) wizard against the real server, on my own public post
  await p.goto(S.base + "/?nosw#/ads/new");
  await p.waitForSelector(`#ad-wz input[name=ad-post][value="${W.mine}"]`, { timeout: 15000 });
  await p.check(`input[name=ad-post][value="${W.mine}"]`); await p.fill("#ad-name", "حملة حقيقية للدليل"); await p.click("#ad-next");
  await p.waitForSelector("#ad-topics [data-ad-topic]", { timeout: 15000 });
  const topic = await p.getAttribute("#ad-topics [data-ad-topic]", "data-ad-topic");
  const [est] = await Promise.all([p.waitForResponse(r => /\/api\/ads\/estimate$/.test(r.url()) && r.request().method() === "POST"), p.click(`[data-ad-topic="${topic}"]`)]);
  assert.equal(est.status(), 200); const ej = await est.json(); assert.ok(ej.audience?.label, "server estimate has an Arabic-ready label");
  await until((l) => document.querySelector("#ad-est b")?.textContent === l, ej.audience.label, 8000, p);
  await p.check("[data-ad-lang=ar]"); await p.click("#ad-next"); await p.waitForSelector("#ad-budget");
  assert.equal(await p.getAttribute("#ad-budget", "min"), String(cfg.minBudget), "budget min from /api/ads/config");
  assert.deepEqual(await p.$$eval("#ad-fh option", n => n.map(o => Number(o.value))).then(v => v.every(x => x <= 24)), true, "frequency window ≤ 24 h (server rule)");
  await p.fill("#ad-budget", "2"); await p.fill("#ad-daily", "1"); await p.fill("#ad-fq", "3"); await p.selectOption("#ad-fh", "12");
  await p.click("#ad-next"); await p.waitForSelector("#ad-submit"); await p.click("#ad-submit");
  await until(() => /^#\/ads\/campaigns\/ac_/.test(location.hash) && !!document.querySelector("[data-ad-camp]"), null, 15000, p);
  const mine = await db.get("SELECT * FROM ad_campaigns WHERE advertiser_id=$1 ORDER BY created_at DESC", [ME]);
  assert.equal(mine.status, "in_review"); assert.equal(mine.post_id, W.mine); assert.equal(Number(mine.budget_total), 2e7); assert.equal(Number(mine.daily_cap), 1e7);
  assert.equal(Number(mine.freq_impressions), 3); assert.equal(Number(mine.freq_hours), 12);
  assert.deepEqual(JSON.parse(mine.targeting), { topics: [topic], languages: ["ar"], countries: [] });
  assert.match(await p.textContent(`[data-ad-camp="${mine.id}"]`), /قيد المراجعة/);
  // 2) admin review queue (real rows) → approve
  await go("#/admin/ads/review", p); await p.waitForSelector(`[data-ad-rv="${mine.id}"]`, { timeout: 15000 });
  assert.ok(await p.waitForSelector(`[data-ad-rv="${mine.id}"] input[data-ad-rs][value=guidelines]`, { state: "attached", timeout: 15000 }).catch(() => null), "reject reasons come from the server"); // reasons arrive after the row renders: wait, don't sample
  assert.match(await p.textContent(`[data-ad-rv="${mine.id}"]`), /2 π/);
  await p.click(`[data-ad-rv="${mine.id}"] [data-ad-dec=approve]`); await until((cid) => !document.querySelector(`[data-ad-rv="${cid}"]`), mine.id, 12000, p);
  assert.equal((await db.get("SELECT status FROM ad_campaigns WHERE id=$1", [mine.id])).status, "awaiting_funds");
  // 3) dashboard: awaiting funds, fund disabled with the Arabic note, budget from the server's budget object
  await go("#/ads/campaigns/" + mine.id, p); await p.waitForSelector("#ad-fund", { timeout: 15000 });
  assert.equal(await p.isDisabled("#ad-fund"), true); assert.match(await p.textContent("#ad-fn"), /مدفوعات Pi غير مفعّلة بعد/);
  const dash = await p.textContent(`[data-ad-camp="${mine.id}"]`); assert.match(dash, /بانتظار التمويل/);
  assert.match(await p.textContent("#ad-db"), /0 π \/ 2 π/); assert.match(await p.textContent("#ad-kpi"), /أقل من 10/);
  // 4) another advertiser's untargeted campaign, funded through the ledger (Pi completion event) → active
  const sid = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'',$4,'user',$5,$6)", [sid, "salem_shop", "متجر سالم", "#7c3aed", { onboarded: true, interests: [] }, at(60 * 24 * 120)]);
  const spid = id("p"); await db.run("INSERT INTO posts(id,author,type,title,text,topic,lang,visibility,status,location,data,created_at) VALUES($1,$2,'post',NULL,$3,'dev','ar','public','published',NULL,NULL,$4)", [spid, sid, "متجر سالم: لوحات مفاتيح عربية بإضاءة هادئة", at(60 * 24 * 30)]);
  const cid = id("ac"), t0 = at(5), end = new Date(Date.now() + 5 * 864e5).toISOString();
  await db.run(`INSERT INTO ad_campaigns(id,advertiser_id,post_id,name,objective,targeting,budget_total,daily_cap,bid_cpm,freq_impressions,freq_hours,start_at,end_at,status,submitted_at,created_at,updated_at)
    VALUES($1,$2,$3,'لوحات سالم','reach','{"topics":[],"languages":[],"countries":[]}',20000000,10000000,5000000,3,24,$4,$5,'awaiting_funds',$4,$4,$4)`, [cid, sid, spid, t0, end]);
  bus.emit("PI_PAYMENT_COMPLETED", { purpose: "ads", tx: "tx_e2e_" + cid, refId: cid, amount: 2, user: sid });
  for (let i = 0; i < 100 && (await db.get("SELECT status FROM ad_campaigns WHERE id=$1", [cid])).status !== "active"; i++) await new Promise(r => setTimeout(r, 50));
  const act = await db.get("SELECT status, funded_amount FROM ad_campaigns WHERE id=$1", [cid]);
  assert.equal(act.status, "active"); assert.equal(Number(act.funded_amount), 2e7);
  assert.equal((await (await p.request.get(S.base + "/api/admin/ledger/check")).json()).balanced, true, "ledger balanced after funding");
  // 5) the real ranked feed carries it; the card shows «مُروَّج» + advertiser and is never first
  const fj = await (await p.request.get(S.base + "/api/feed?mode=for&limit=50")).json();
  const pi = fj.posts.findIndex(x => x.promoted?.campaignId === cid);
  assert.ok(pi >= 8, "server inserts the ad after organic #8 (index " + pi + ")"); assert.ok(fj.posts[pi].promoted.token, "signed token");
  // the campaign was activated server-side (DB + bus), not through this page, and the client keeps its ranked «لك» list for
  // 60 s (discovery-ui fetchRanked, refreshed when stale/older) — so reopen home with a real reload, as a viewer arriving now
  // would (a hash-only goto is a same-document navigation and keeps the cache)
  await p.evaluate(() => { location.hash = "#/home"; }); await p.reload(); await p.evaluate(() => scrollTo(0, 0));
  await until((c) => !!document.querySelector(`#view .ad-card[data-ad="${c}"]`), cid, 20000, p);
  const info = await p.evaluate((c) => { const cards = [...document.querySelectorAll("#view .wrap > .post-card")], ad = document.querySelector(`.ad-card[data-ad="${c}"]`); return { idx: cards.indexOf(ad), lbl: document.getElementById(ad.getAttribute("aria-labelledby"))?.textContent }; }, cid);
  assert.ok(info.idx >= 1, "never the first slot"); assert.match(info.lbl, /مُروَّج/); assert.match(info.lbl, /متجر سالم/);
  // impression via the real token → counted, aggregated
  await p.evaluate((c) => document.querySelector(`.ad-card[data-ad="${c}"]`).scrollIntoView({ block: "center" }), cid);
  for (let i = 0; i < 80 && !evts.length; i++) await p.waitForTimeout(50);
  assert.deepEqual(evts[0], { status: 200, body: { ok: true, counted: true } });
  const sd = await db.get("SELECT impressions, spend FROM ad_stats_daily WHERE campaign_id=$1", [cid]);
  assert.equal(Number(sd.impressions), 1); assert.equal(Number(sd.spend), 5000, "CPM 0.5 → 0.0005 Pi per impression");
  // 6) why sheet from the real endpoint (untargeted → general)
  await p.click(`.ad-card[data-ad="${cid}"] [data-ad-more]`); await p.click("#ad-m-why"); await p.waitForSelector(".ad-why li");
  const wt = await p.textContent(".ad-sheet"); assert.match(wt, /متجر سالم/); assert.match(wt, /إعلان عام/);
  // 7) hide this advertiser → server prefs + aggregated feedback; the feed has no ad afterwards
  await p.click("#ad-w-adv"); await p.click("[data-ad-hr=irrelevant]");
  await until((c) => !document.querySelector(`.ad-card[data-ad="${c}"]`), cid, 8000, p);
  const pr = await db.get("SELECT hidden_advertisers FROM ad_prefs WHERE user_id=$1", [ME]); assert.deepEqual(JSON.parse(pr.hidden_advertisers), [sid]);
  assert.equal(Number((await db.get("SELECT count FROM ad_feedback WHERE campaign_id=$1 AND reason='irrelevant'", [cid])).count), 1);
  const after = await (await p.request.get(S.base + "/api/feed?mode=for&limit=50")).json();
  assert.equal(after.posts.filter(x => x.promoted).length, 0, "hidden advertiser → no ad");
  const pv = await (await p.request.get(S.base + "/api/me/ads/prefs")).json(); assert.deepEqual(pv.hiddenAdvertisers.map(x => x.handle), ["salem_shop"]);
  // 8) privacy: no user id (column or value) in the delivery / stats tables
  const uids = (await db.all("SELECT id FROM users")).map(r => r.id);
  for (const t of ["ad_stats_daily", "ad_feedback", "ad_freq", "ad_tokens"]) {
    const rows = await db.all(`SELECT * FROM ${t}`);
    if (t !== "ad_feedback") assert.ok(rows.length >= 1, t + " has rows");
    for (const r of rows) { for (const k of Object.keys(r)) assert.ok(!/user|viewer|^uid$|^ip$/i.test(k), `${t}.${k} is not a user column`); const v = JSON.stringify(Object.values(r)); for (const u of uids) assert.ok(!v.includes(u), `${t} contains a user id`); }
  }
  await ctx.close();
});
