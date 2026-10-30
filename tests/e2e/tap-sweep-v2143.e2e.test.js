/* global MPMenu, openComposer, closeSheet, refresh */
/* v2.143.0 «مسح الأزرار»: no control on screen may be drawn but untappable (covered by another layer), the bug class of the
 * v2.142 cover-photo button. tests/e2e/tap-audit.js probes every visible button/link/input at its own spots while the page is
 * scrolled step by step (fixed bars count as normal scrolling, not covering).
 * - every «المزيد» hub screen + the main tabs at 390, Arabic, light (two halves)
 * - the main tabs in the other modes: 390 English dark, 1440 Arabic light, 1440 English dark
 * - opened layers: the post «⋯» sheet and the composer
 * Intended exceptions go in ALLOW with the reason, never a silent skip. A fix makes the control visible and tappable;
 * it never hides or removes it. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
const { tapAudit } = require("./tap-audit");

const ALLOW = new Map([
  // "<route> <control key>": "why it is intended"
]);
const MAIN = ["#/home", "#/explore", "#/me", "#/menu", "#/messages", "#/notifications", "#/settings", "#/search", "#/communities", "#/digest", "#/clips", "#/versions"];
let S, hub = [];

test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });
// 7 sign-ups in one file: the server allows 5 per IP per hour, so reset the limiter like the other suites do
test.beforeEach(() => S.app.ctx.rl.w?.clear?.());

async function page(combo, handle) {
  const [dev, lang, scheme] = combo.split("-");
  const c = await S.browser.newContext({ ...(dev === "m" ? MOBILE : DESKTOP), reducedMotion: "reduce", colorScheme: scheme });
  await c.route("https://tile.openstreetmap.org/**", (r) => r.fulfill({ status: 404, body: "" }));
  const p = await c.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, handle, "فحص الأزرار");
  if (lang === "en") { await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForTimeout(300); }
  return { c, p, errors, vh: dev === "m" ? 844 : 900 };
}
async function sweep(p, vh, list, tag) {
  const bad = [];
  for (const h of list) {
    await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h);
    await p.waitForFunction(() => !document.querySelector("#view .skel") && document.querySelector("#view")?.textContent.trim().length > 0, null, { timeout: 12000 }).catch(() => {});
    // a focused search box opens its suggestions list over the filters by design (it closes on blur); scan the resting page
    await p.evaluate(() => document.activeElement?.blur?.()); await p.waitForTimeout(200);
    bad.push(...(await scan(p, vh)).filter((b) => !ALLOW.has(h + " " + b.key)).map((b) => `${tag} ${h}: «${b.text}» ${b.sel} — covered by ${b.by}`));
  }
  return bad;
}
async function scan(p, vh) {
  const found = new Map(), H = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0, k = 0; y < H && k < 8; y += Math.round(vh * 0.6), k++) {
    await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(60);
    for (const b of await p.evaluate(`(${tapAudit.toString()})()`)) found.set(b.key, b);
  }
  await p.evaluate(() => scrollTo(0, 0));
  return [...found.values()];
}

test("390 Arabic light: main tabs + first half of the hub, with real content", async () => {
  const { c, p, errors, vh } = await page("m-ar-light", "tap_m_ar_1");
  await seedDiscovery(S.app.ctx, p); await p.evaluate(() => refresh());
  await p.evaluate(() => { location.hash = "#/menu"; }); await p.waitForSelector("#mn-q", { timeout: 15000 });
  hub = [...new Set(await p.evaluate(() => MPMenu.items().map((x) => x.h)))].filter((h) => !MAIN.includes(h));
  assert.ok(hub.length > 100, "the hub lists its screens");
  assert.deepEqual(await sweep(p, vh, [...MAIN, ...hub.slice(0, Math.ceil(hub.length / 2))], "390/ar"), []);
  // opened layers: the post «⋯» sheet and the composer
  await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForSelector(".post-card [data-more]", { timeout: 10000 });
  await p.click(".post-card [data-more]"); await p.waitForSelector("#sheet .menu");
  assert.deepEqual((await scan(p, vh)).map((b) => `sheet «${b.text}» covered by ${b.by}`), []);
  await p.evaluate(() => closeSheet());
  await p.evaluate(() => openComposer({})); await p.waitForTimeout(600);
  assert.deepEqual((await scan(p, vh)).map((b) => `composer «${b.text}» covered by ${b.by}`), []);
  assert.deepEqual(errors, [], "no page errors"); await c.close();
});

test("390 Arabic light: second half of the hub", async () => {
  const { c, p, errors, vh } = await page("m-ar-light", "tap_m_ar_2");
  assert.deepEqual(await sweep(p, vh, hub.slice(Math.ceil(hub.length / 2)), "390/ar"), []);
  assert.deepEqual(errors, [], "no page errors"); await c.close();
});

for (const combo of ["m-en-dark", "d-ar-light", "d-en-dark"]) {
  test(`${combo}: main tabs`, async () => {
    const { c, p, errors, vh } = await page(combo, "tap_" + combo.replace(/-/g, "_"));
    assert.deepEqual(await sweep(p, vh, MAIN, combo), []);
    assert.deepEqual(errors, [], "no page errors"); await c.close();
  });
}

test("the audit itself catches a covered control (guards against a check that always passes)", async () => {
  const { c, p } = await page("m-ar-light", "tap_selfcheck");
  await p.goto(S.base + "/?nosw#/me"); await p.waitForSelector(".cover-cam");
  assert.deepEqual(await p.evaluate(`(${tapAudit.toString()})()`), []);
  await p.evaluate(() => { const b = document.querySelector(".cover-cam"), r = b.getBoundingClientRect(), d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${r.left - 4}px;top:${r.top + scrollY - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;z-index:2147483000`; document.body.appendChild(d); });
  const bad = await p.evaluate(`(${tapAudit.toString()})()`);
  assert.equal(bad.length, 1); assert.match(bad[0].sel, /cover-cam/);
  await c.close();
});

test("explore hero: «ما الذي يدور؟» and the source buttons are tappable (the glow circle sat over them until v2.143)", async () => {
  const { c, p, errors } = await page("m-ar-light", "tap_hero");
  try { await seedDiscovery(S.app.ctx, p); } catch (e) { if (!/UNIQUE/.test(e.message)) throw e; } // already seeded by an earlier test in this file
  await p.evaluate(() => refresh());
  await p.goto(S.base + "/?nosw#/explore"); await p.waitForSelector(".x-hero a.x-go", { timeout: 10000 });
  await p.evaluate(() => document.querySelector(".x-hero").scrollIntoView({ block: "center" }));
  const blocked = await p.evaluate(() => [...document.querySelectorAll(".x-hero a.x-go, .x-hero .d-cite")].filter((el) => { const r = el.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(h && el.contains(h)); }).map((el) => el.textContent.trim()));
  assert.deepEqual(blocked, []);
  assert.equal(await p.$eval(".x-hero", (e) => getComputedStyle(e, "::after").pointerEvents), "none");
  assert.deepEqual(errors, []); await c.close();
});
