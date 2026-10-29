/* v2.61 page help «؟» (v2.137: small «i» + bubble, none on the main tabs) e2e against the REAL server (production build).
 * Lazy chunks: `help` + `helpcontent` arrive after sign-in, never in the core bundle. The «؟» sits in the page head (#/studio,
 * #/feedprefs) or the top bar on Home, never on a route without an entry (#/settings). Mobile: bottom sheet (#sheet); desktop:
 * anchored popover. Opens/closes (button, «فهمت», Esc, outside click), focus moves in, Tab is trapped, focus returns to «؟».
 * RTL Arabic and LTR English (content + glyph + dir), Arabic fallback when a language is missing. axe 0 serious/critical at
 * 390 light, 1440 dark, LTR. No page errors. Screenshots → tests/.out/help-shots (gitignored; or HELP_SHOTS). */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");

let S, mctx, m, dctx, d; const errors = [];
const until = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(200); };
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const SHOTS = process.env.HELP_SHOTS || path.join(__dirname, "../.out/help-shots"); // gitignored test output (HELP_SHOTS overrides)
const call = (p, mth, u, b) => p.evaluate(async ([mth, u, b]) => { const r = await fetch(u, { method: mth, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [mth, u, b]);
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `help-${name}.png`) }); };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const active = (pg) => pg.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.getAttribute("data-help") !== null && "help-btn" || a.className || a.tagName) : null; });

test.before(async () => {
  S = await startStack();
  mctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  m = await mctx.newPage(); m.on("pageerror", (e) => errors.push("mobile: " + e.message));
  await onboard(m, S.base, "help_m", "مختبر المساعدة");
  dctx = await S.browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  d = await dctx.newPage(); d.on("pageerror", (e) => errors.push("desktop: " + e.message));
  await onboard(d, S.base, "help_d", "مختبر سطح المكتب");
});
test.after(async () => { await dctx?.close(); await mctx?.close(); await S?.close(); });

test("lazy chunks: help is not in the core bundle and loads after sign-in", async () => {
  const core = await m.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => /\/assets\/app-/.test(s)));
  assert.ok(core.length >= 1);
  const src = await (await fetch(core[0])).text();
  assert.doesNotMatch(src, /MPHelpContent|hp-pop/, "help code stays out of app-*.js");
  await until(m, () => !!window.MPHelp && !!window.MPHelpContent);
  assert.ok(await m.evaluate(() => [...document.scripts].some((s) => /chunk-help-/.test(s.src)) && [...document.scripts].some((s) => /chunk-helpcontent-[\w-]{6,}\.js/.test(s.src) && !/helpcontent-(en|fr|ur)-/.test(s.src))));
  // help-wire: en/fr/ur text are their own chunks, fetched only in that language
  assert.equal(await m.evaluate(() => [...document.scripts].some((s) => /chunk-helpcontent-(en|fr|ur)-/.test(s.src))), false, "Arabic UI loads no other language");
});

const bubble = async (pg) => { await until(pg, () => !!document.querySelector(".hp-pop")); return pg.evaluate(() => { const p = document.querySelector(".hp-pop").getBoundingClientRect(), q = document.querySelector("[data-help][aria-expanded=true] .hp-q").getBoundingClientRect(), a = document.querySelector(".hp-arrow").getBoundingClientRect(); return { p: { x: p.x, y: p.y, w: p.width, h: p.height }, q: { x: q.x, y: q.y, w: q.width, h: q.height }, ax: a.x + a.width / 2, bg: getComputedStyle(document.querySelector(".hp-pop")).backgroundColor }; }); };
const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

test("mobile 390 light (v2.137): small round «i» in the page head, dark bubble with arrow under it, Esc / outside / toggle close", async () => {
  await go(m, "#/studio"); await until(m, () => !!document.querySelector("#view .page-head [data-help]"), null, 20000);
  const box = await m.locator("#view .page-head [data-help]").boundingBox();
  assert.ok(box.width >= 44 && box.height >= 44, "touch target ≥ 44");
  assert.equal(await m.textContent("#view .page-head [data-help] .hp-q"), "i");
  const q = await m.locator("#view .page-head [data-help] .hp-q").boundingBox(); assert.ok(q.width <= 24 && q.width >= 20, "the visible «i» is small: " + q.width);
  assert.equal(await m.locator(".topbar [data-help]").count(), 0, "one icon only");
  assert.equal(await m.locator("#view .page-head [data-help]").getAttribute("aria-label"), "كيف تعمل هذه الصفحة؟");
  await m.click("#view .page-head [data-help]");
  const B = await bubble(m);
  assert.equal(await m.evaluate(() => document.getElementById("sheet").classList.contains("hidden")), true, "no bottom sheet any more");
  assert.ok(B.p.y > B.q.y + B.q.h && B.p.y - (B.q.y + B.q.h) < 14, "bubble right under «i»: " + JSON.stringify(B));
  assert.ok(Math.abs(B.ax - (B.q.x + B.q.w / 2)) < 3, "arrow points at «i»");
  assert.ok(B.p.x >= 0 && B.p.x + B.p.w <= 390 && B.p.w <= 302, "fits the phone");
  assert.ok(lum(B.bg) < 0.3, "dark bubble on the light theme: " + B.bg);
  assert.equal(await active(m), "hp-pop", "focus moves into the bubble");
  assert.equal(await m.evaluate(() => document.querySelector(".hp-pop").getAttribute("aria-labelledby")), "hp-t");
  assert.match(await m.textContent("#hp-t"), /استوديو المنشئ/);
  assert.equal(await m.evaluate(() => document.querySelector(".hp-body").dir), "rtl");
  assert.ok(await m.locator(".hp-body p").count() >= 2 && await m.locator(".hp-body p").count() <= 4);
  assert.equal(await m.locator(".hp-pop .hp-foot, .hp-pop .hp-x").count(), 0, "no buttons inside the bubble");
  assert.ok(await noOverflow(m)); assert.deepEqual(await axe(m), [], "bubble 390 light"); await shot(m, "390-light-bubble");
  await m.keyboard.press("Escape"); await until(m, () => !document.querySelector(".hp-pop"));
  await until(m, () => document.activeElement?.hasAttribute("data-help"), null, 2000);
  assert.equal(await m.getAttribute("#view .page-head [data-help]", "aria-expanded"), "false");
  await m.click("#view .page-head [data-help]"); await until(m, () => !!document.querySelector(".hp-pop"));
  await m.mouse.click(200, 700); await until(m, () => !document.querySelector(".hp-pop"));
  await m.click("#view .page-head [data-help]"); await until(m, () => !!document.querySelector(".hp-pop"));
  await m.click("#view .page-head [data-help]"); await until(m, () => !document.querySelector(".hp-pop"));
});

test("main tabs carry no icon (Home, Explore, Communities, Messages, Notifications, More, my profile, Vidtik, rooms, digest); inner pages do", async () => {
  const me = await m.evaluate(() => DB.users.find((u) => u.id === DB.me).handle);
  for (const r of ["#/home", "#/explore", "#/communities", "#/messages", "#/notifications", "#/menu", "#/me", "#/u/" + me, "#/clips", "#/rooms", "#/digest"]) {
    await go(m, r); await m.waitForTimeout(450);
    assert.equal(await m.locator("[data-help]").count(), 0, r + ": no icon");
    assert.equal(await m.evaluate((h) => window.MPHelp.isMain(h, DB.users.find((u) => u.id === DB.me).handle), r), true, r);
  }
  assert.equal(await m.locator(".topbar #tbHelp.on").count(), 0, "top-bar slot off");
  await go(m, "#/no-such-page-help"); await until(m, () => !!document.querySelector("#view .nf-page")); await m.waitForTimeout(300);
  assert.equal(await m.locator("[data-help]").count(), 0, "no entry → no icon");
  for (const r of ["#/settings", "#/clips/drafts", "#/wallet"]) { await go(m, r); await until(m, () => !!document.querySelector("[data-help]"), null, 20000); assert.equal(await m.locator("[data-help]").count(), 1, r); }
  // a screen with a legacy heading (no .page-head) still gets one icon
  await go(m, "#/feedprefs"); await until(m, () => !!document.querySelector("#view .hp-strip [data-help], .topbar [data-help]"));
  assert.equal(await m.locator("[data-help]").count(), 1);
  await m.click("[data-help]"); await until(m, () => !!document.querySelector(".hp-pop"));
  assert.match(await m.textContent("#hp-t"), /الخلاصة والملخصات/);
  assert.ok(await m.evaluate(() => { const r = document.querySelector(".hp-pop").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }));
  await m.keyboard.press("Escape"); await until(m, () => !document.querySelector(".hp-pop"));
});

test("desktop 1440 dark: light bubble anchored under «i», outside click + Esc close", async () => {
  await d.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await go(d, "#/studio"); await until(d, () => !!document.querySelector("#view .page-head [data-help]"), null, 20000);
  await d.click("#view .page-head [data-help]"); const B = await bubble(d);
  assert.ok(B.p.y > B.q.y + B.q.h && B.p.y - (B.q.y + B.q.h) < 14, "under «i»");
  assert.ok(Math.abs(B.ax - (B.q.x + B.q.w / 2)) < 3, "arrow points at «i»");
  assert.ok(B.p.x >= 0 && B.p.x + B.p.w <= 1440);
  assert.ok(lum(B.bg) > 0.7, "light bubble on the dark theme: " + B.bg);
  assert.equal(await active(d), "hp-pop");
  assert.equal(await d.locator(".hp-tips li").count(), 3, "help-core tips + the merged learn-work tip (≤3)");
  assert.deepEqual(await axe(d), [], "bubble 1440 dark"); await shot(d, "1440-dark-bubble");
  await d.keyboard.press("Escape"); await until(d, () => !document.querySelector(".hp-pop"));
  await until(d, () => document.activeElement?.hasAttribute("data-help"), null, 2000);
  await d.click("#view .page-head [data-help]"); await until(d, () => !!document.querySelector(".hp-pop"));
  await d.mouse.click(700, 860); await until(d, () => !document.querySelector(".hp-pop"));
  await d.click("#view .page-head [data-help]"); await until(d, () => !!document.querySelector(".hp-pop"));
  await d.click("#view .page-head [data-help]"); await until(d, () => !document.querySelector(".hp-pop"));
});

test("LTR English: translated content, «i» glyph, ltr direction; Arabic fallback for a missing language", async () => {
  await until(d, () => !!window.MPI18n); await d.evaluate(() => window.MPI18n.setLang("en"));
  await until(d, () => document.documentElement.dir === "ltr");
  await go(d, "#/studio"); await until(d, () => document.querySelector("#view .page-head [data-help] .hp-q")?.textContent === "i" && document.querySelector("#view .page-head [data-help]").getAttribute("aria-label") === "How does this page work?", null, 20000);
  await d.click("#view .page-head [data-help]"); await until(d, () => !!document.querySelector(".hp-pop"));
  assert.equal(await d.textContent("#hp-t"), "Creator studio");
  assert.equal(await d.evaluate(() => document.querySelector(".hp-body").dir), "ltr");
  assert.deepEqual(await axe(d), [], "bubble LTR"); await shot(d, "1440-ltr-bubble");
  await d.keyboard.press("Escape");
  assert.ok(await d.evaluate(() => [...document.scripts].some((s) => /chunk-helpcontent-en-/.test(s.src))), "en text chunk fetched on switching to English");
  await d.evaluate(() => { const e = window.MPHelp.entryFor("#/settings"); window.__hpSaved = JSON.stringify(e); for (const f of ["title", "body", "tips"]) if (e[f]) delete e[f].en; if (e.tips) delete e.tips.ar; });
  await go(d, "#/settings"); await until(d, () => !!document.querySelector("#view .page-head [data-help]"));
  await d.click("#view .page-head [data-help]"); await until(d, () => !!document.querySelector(".hp-pop"));
  assert.deepEqual(await d.evaluate(() => [document.getElementById("hp-t").lang, document.querySelector(".hp-body").dir]), ["ar", "rtl"]);
  assert.equal(await d.locator(".hp-tips").count(), 0, "no tips → no tips block");
  await d.keyboard.press("Escape");
  await d.evaluate(() => { const e = window.MPHelp.entryFor("#/settings"), o = JSON.parse(window.__hpSaved); for (const f of ["title", "body", "tips"]) if (o[f]) e[f] = o[f]; });
  await until(m, () => !!window.MPI18n); await m.evaluate(() => window.MPI18n.setLang("en")); await until(m, () => document.documentElement.dir === "ltr");
  await go(m, "#/studio"); await until(m, () => !!document.querySelector("#view .page-head [data-help]"), null, 20000);
  await m.click("#view .page-head [data-help]"); await until(m, () => !!document.querySelector(".hp-pop"));
  assert.ok(await noOverflow(m)); assert.ok(await m.evaluate(() => { const r = document.querySelector(".hp-pop").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), "LTR bubble fits");
  assert.deepEqual(await axe(m), [], "bubble 390 LTR"); await shot(m, "390-ltr-bubble");
  await m.keyboard.press("Escape");
  await d.evaluate(() => window.MPI18n.setLang("ar")); await m.evaluate(() => window.MPI18n.setLang("ar"));
});

/* help-wire: the merged registry (215 entries, per-language chunks) + inner sections */
let cid;
const openHelp = async (pg, sel = "#view [data-help], .topbar [data-help]") => {
  await until(pg, (q) => !!document.querySelector(q), sel, 20000); await pg.click(sel);
  await until(pg, () => !!document.querySelector(".hp-pop"));
};
const closeHelp = async (pg) => { await pg.keyboard.press("Escape"); await until(pg, () => !document.querySelector(".hp-pop")); };
test("sections: #/cadmin/<id>?s=automod shows automod help; another section changes it; mobile 390 light", async () => {
  cid = (await call(m, "POST", "/api/communities", { name: "مجتمع اختبار المساعدة", desc: "مجتمع لاختبار صفحات المساعدة.", rules: ["الاحترام"] })).community.id;
  assert.ok(cid, "community created");
  await go(m, `#/cadmin/${cid}?s=automod`); await until(m, () => !!document.querySelector("#view .ca[data-sec='automod'], #view [data-sec='automod']"), null, 20000);
  await openHelp(m);
  assert.match(await m.textContent("#hp-t"), /الإشراف الآلي/); assert.equal(await m.evaluate(() => document.querySelector(".hp-body").dir), "rtl");
  assert.ok(await noOverflow(m)); assert.deepEqual(await axe(m), [], "cadmin automod 390 light"); await shot(m, "390-light-cadmin-automod");
  await closeHelp(m);
  await go(m, `#/cadmin/${cid}?s=roles`); await until(m, () => !!document.querySelector("#view [data-sec='roles']"), null, 20000);
  await openHelp(m); assert.doesNotMatch(await m.textContent("#hp-t"), /الإشراف الآلي/, "section help follows ?s="); await closeHelp(m);
  await go(m, `#/cadmin/${cid}`); await until(m, () => !!document.querySelector("#view [data-sec]"), null, 20000);
  await openHelp(m); const home = await m.textContent("#hp-t"); assert.ok(home.length > 1); await closeHelp(m);
});
test("sections: studio tab «التقويم» shows the calendar help, the page-wide entry before a tab is picked; 1440 dark", async () => {
  await d.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await go(d, "#/studio"); await until(d, () => !!document.querySelector("#view .page-head [data-help]") && !!document.querySelector("[data-stab='calendar']"), null, 20000);
  await openHelp(d, "#view .page-head [data-help]"); assert.equal(await d.textContent("#hp-t"), "استوديو المنشئ"); await closeHelp(d);
  await d.click("[data-stab='calendar']"); await until(d, () => document.getElementById("view")._stab === "calendar" && !!document.querySelector("#view .page-head [data-help]"), null, 20000);
  await openHelp(d, "#view .page-head [data-help]");
  assert.match(await d.textContent("#hp-t"), /التقويم/);
  assert.deepEqual(await axe(d), [], "studio calendar 1440 dark"); await shot(d, "1440-dark-studio-calendar");
  await closeHelp(d);
  await d.click("[data-stab='best']"); await until(d, () => document.getElementById("view")._stab === "best", null, 20000);
  await openHelp(d, "#view .page-head [data-help]"); assert.match(await d.textContent("#hp-t"), /أفضل وقت/); await closeHelp(d);
  await d.evaluate(() => { document.getElementById("view")._stab = null; });
});
test("community page: posts help, channels help when a channel is open (view state), knowledge sub-route", async () => {
  const at = (h, st) => m.evaluate(([h, st]) => { const v = document.getElementById("view"), keep = { _ctab: v._ctab, _cch: v._cch }; Object.assign(v, st); const e = window.MPHelp.entryFor(h); Object.assign(v, keep); return e && e.title.ar; }, [h, st]);
  assert.equal(await at(`#/c/${cid}`, { _ctab: "posts", _cch: {} }), "صفحة المجتمع");
  assert.equal(await at(`#/c/${cid}`, { _ctab: "posts", _cch: { [cid]: "x" } }), "القنوات والتصنيفات");
  await go(m, `#/c/${cid}`); await until(m, () => !!document.querySelector("#view .c-tabs"), null, 20000);
  await openHelp(m); assert.match(await m.textContent("#hp-t"), /صفحة المجتمع/); await closeHelp(m);
});
test("LTR English: a money page and a trust page show English help (ltr); axe 1440 dark LTR + 390 LTR", async () => {
  await d.evaluate(() => window.MPI18n.setLang("en")); await until(d, () => document.documentElement.dir === "ltr");
  await m.evaluate(() => window.MPI18n.setLang("en")); await until(m, () => document.documentElement.dir === "ltr");
  for (const [pg, hash, re, tag] of [[d, "#/wallet", /wallet/i, "1440-ltr-wallet"], [d, "#/security", /security/i, "1440-ltr-security"], [m, "#/mjt", /MJT|coin/i, "390-ltr-mjt"], [m, "#/security", /security/i, "390-ltr-security"]]) {
    await go(pg, hash); await until(pg, () => !!window.MPHelp && !!window.MPHelp.entryFor(), null, 20000);
    await openHelp(pg);
    const t = await pg.textContent("#hp-t"); assert.match(t, re, hash + " → " + t);
    assert.deepEqual(await pg.evaluate(() => [document.getElementById("hp-t").lang, document.querySelector(".hp-body").dir, document.querySelector(".hp-body").lang]), ["en", "ltr", "en"], hash);
    assert.doesNotMatch(await pg.textContent(".hp-body"), /[\u0600-\u06FF]/, hash + " body has no Arabic");
    assert.ok(await noOverflow(pg)); assert.deepEqual(await axe(pg), [], hash + " LTR"); await shot(pg, tag);
    await closeHelp(pg);
  }
  await d.evaluate(() => window.MPI18n.setLang("ar")); await m.evaluate(() => window.MPI18n.setLang("ar"));
});

test("no page errors", () => { assert.deepEqual(errors, []); });
