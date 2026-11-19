/* global PiAdapter, showAuth */
/* v2.149.13 «بوابة Pi»: the signed-out screen is Pi-only (design C «القصة»). Real server + production build; /api/pi/config is
 * stubbed per test (network, piUrl) and window.Pi is a fake SDK, so nothing talks to Pi. Covers: the Pi button runs the Pi
 * sign-in (token → /api/pi/auth), the testnet badge only on testnet, three slides with dots + arrow keys in RTL and LTR,
 * «دخول تجريبي» only when the server enables demo login, the outside-Pi state (open link, copy row, QR at 1440),
 * the 3-second logo press (and #/login?recover=1) opening the kept password form, and a password sign-in through it,
 * tap targets >= 44px and no layout shift. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, MOBILE, DESKTOP } = require("./harness");
let S; const errors = [];
const PI_UA = MOBILE.userAgent + " Pi"; // the real Pi Browser UA ends with a bare " Pi" (v2.149.12)
const URL_PI = "https://mujtamakt6955.pinet.com";
const st = { network: "testnet", piUrl: URL_PI, demo: false, auth: [] };
const FAKE_PI = () => { window.__pi = {}; window.Pi = { init(o) { window.__pi.init = o; }, authenticate(scopes) { window.__pi.scopes = scopes; return Promise.resolve({ accessToken: "fake-token", user: { uid: "x" } }); } }; };
const CLS = () => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); };
async function ctxFor({ ua = PI_UA, sdk = true, size = MOBILE, lang = "ar", theme = "dark" } = {}) {
  const ctx = await S.browser.newContext({ ...size, userAgent: ua || size.userAgent, colorScheme: theme, gate: true });
  await ctx.addInitScript(([l, t]) => { localStorage.setItem("mp.shell", JSON.stringify({ l, t })); }, [lang, theme]);
  if (sdk) await ctx.addInitScript(FAKE_PI);
  await ctx.addInitScript(CLS);
  await ctx.route("**/api/pi/config", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: false, authEnabled: true, network: st.network, sandbox: st.network !== "mainnet", ...(st.piUrl ? { piUrl: st.piUrl } : {}) }) }));
  await ctx.route("**/api/pi/auth", (r) => { st.auth.push(r.request().postDataJSON()); return r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "stub" }) }); });
  await ctx.route("**/api/health", async (r) => { const res = await r.fetch(); const j = await res.json(); if (st.demo) j.demo = true; else delete j.demo; return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(j) }); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  return { ctx, p };
}
const open = async (p, hash = "") => { await p.goto(S.base + "/?nosw" + hash); await p.waitForSelector("#gate .gt-dock", { timeout: 20000 }); await p.waitForTimeout(300); };

test.before(async () => { ensureBuild(); S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("inside Pi Browser: one Pi button that runs the Pi sign-in; testnet badge; no password form; no layout shift; >= 44px targets", async () => {
  const { ctx, p } = await ctxFor();
  await open(p);
  assert.ok(await p.isVisible("#pi-signin"), "Pi button");
  assert.match(await p.textContent("#pi-signin"), /الدخول بحساب Pi/);
  assert.match(await p.textContent("#pi-signin-n"), /بدون كلمة مرور/);
  assert.equal(await p.isVisible("#a-handle"), false, "the password form is hidden");
  assert.ok(await p.isVisible(".gt-net"), "testnet badge");
  assert.match(await p.textContent(".gt-ver"), /الإصدار/);
  assert.equal(await p.$("#demo-login"), null, "no demo link when the server has demo login off");
  assert.equal(await p.$(".topbar:visible"), null, "app bar hidden on the gate");
  const small = await p.evaluate(() => [...document.querySelectorAll("#gate button, #gate a")].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return [b.id || b.className || b.textContent.trim().slice(0, 12), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, hh]) => w < 44 || hh < 44));
  assert.deepEqual(small, [], "tap targets >= 44px");
  const n0 = st.auth.length;
  await p.click("#pi-signin");
  await p.waitForSelector("#pi-signin-n.err[role=alert]", { timeout: 15000 }); // the stubbed server refuses the token
  assert.equal(st.auth.length, n0 + 1, "POST /api/pi/auth sent"); assert.deepEqual(st.auth.at(-1), { accessToken: "fake-token" });
  assert.deepEqual(await p.evaluate(() => window.__pi.scopes), ["username"], "username scope while payments are off");
  assert.ok(await p.evaluate(() => window.__cls) < 0.01, "no layout shift: " + (await p.evaluate(() => window.__cls)));
  st.network = "mainnet"; await p.evaluate(() => { PiAdapter.cfg = null; return PiAdapter.config(); }); await p.evaluate(() => showAuth("login"));
  await p.waitForSelector("#pi-signin"); assert.equal(await p.$(".gt-net"), null, "no badge on mainnet");
  st.network = "testnet"; await ctx.close();
});

test("carousel: three slides, dots and arrow keys follow RTL (Arabic) and LTR (English)", async () => {
  for (const [lang, next] of [["ar", "ArrowLeft"], ["en", "ArrowRight"]]) {
    const { ctx, p } = await ctxFor({ lang });
    await open(p);
    assert.equal(await p.$$eval(".gt-slide", (n) => n.length), 3);
    const cur = () => p.$$eval("[data-gt-dot]", (d) => d.findIndex((x) => x.getAttribute("aria-current") === "true"));
    assert.equal(await cur(), 0);
    await p.focus("#gt-track"); await p.keyboard.press(next); await p.waitForFunction(() => document.querySelector("[data-gt-dot='1']").getAttribute("aria-current") === "true", null, { timeout: 5000 });
    await p.waitForFunction(() => Math.abs(document.querySelector(".gt-slide:nth-child(2)").getBoundingClientRect().x) <= 2, null, { timeout: 5000 }); // slide 2 settles in view (smooth scroll)
    await p.click("[data-gt-dot='2']"); await p.waitForFunction(() => document.querySelector("[data-gt-dot='2']").getAttribute("aria-current") === "true", null, { timeout: 5000 });
    await p.keyboard.press("Home"); // focus moved to the dot; Home on the track
    await p.focus("#gt-track"); await p.keyboard.press("Home"); await p.waitForFunction(() => document.querySelector("[data-gt-dot='0']").getAttribute("aria-current") === "true", null, { timeout: 5000 });
    if (lang === "en") assert.match(await p.textContent(".gt-slide:nth-child(3) h2"), /Your activity has value/);
    await ctx.close();
  }
});

test("«دخول تجريبي» only when the server enables demo login", async () => {
  st.demo = true;
  const { ctx, p } = await ctxFor();
  await open(p);
  assert.ok(await p.isVisible("#demo-login"), "demo link on a test copy");
  st.demo = false; await ctx.close();
});

test("outside Pi Browser: «افتح في متصفح Pi» to the official Pi URL + copy row; QR at 1440; no URL configured → a note only", async () => {
  let { ctx, p } = await ctxFor({ ua: MOBILE.userAgent, sdk: false });
  await open(p);
  assert.equal(await p.$("#pi-signin"), null);
  assert.equal(await p.getAttribute("#gt-open", "href"), URL_PI);
  assert.match(await p.textContent(".gt-url code"), /mujtamakt6955\.pinet\.com/);
  assert.equal(await p.isVisible(".gt-qr"), false, "no QR on a phone");
  await ctx.close();
  ({ ctx, p } = await ctxFor({ ua: "Mozilla/5.0 Chrome/130", sdk: false, size: DESKTOP }));
  await open(p);
  await p.waitForSelector("#gt-qr svg", { timeout: 10000 });
  assert.ok(await p.isVisible(".gt-qr"), "QR at 1440");
  assert.equal(await p.isVisible(".gt-dots"), false, "slides side by side, no dots");
  await ctx.close();
  st.piUrl = null; ({ ctx, p } = await ctxFor({ ua: MOBILE.userAgent, sdk: false }));
  await open(p);
  assert.equal(await p.$("#gt-open"), null); assert.match(await p.textContent("#pi-signin-n"), /متصفح Pi/);
  assert.equal(await p.isDisabled("#gt-pi-try"), true, "no Pi SDK: the «داخل متصفح Pi؟» sign-in waits for it");
  st.piUrl = URL_PI; await ctx.close();
});

test("v2.149.11 kept: an unrecognised browser with the Pi SDK present can still sign in with Pi («داخل متصفح Pi؟»), same flow", async () => {
  const { ctx, p } = await ctxFor({ ua: MOBILE.userAgent, sdk: true });
  await open(p);
  assert.ok(await p.isVisible("#gt-open"), "the open-in-Pi link stays the main action");
  assert.equal(await p.isDisabled("#gt-pi-try"), false, "usable when the SDK is present");
  const r = await p.$eval("#gt-pi-try", (b) => { const x = b.getBoundingClientRect(); return [x.width, x.height]; });
  assert.ok(r[0] >= 44 && r[1] >= 44, "44px target " + r);
  const n0 = st.auth.length;
  await p.click("#gt-pi-try");
  await p.waitForSelector("#pi-signin-n.err[role=alert]", { timeout: 15000 });
  assert.equal(st.auth.length, n0 + 1, "POST /api/pi/auth sent"); assert.deepEqual(st.auth.at(-1), { accessToken: "fake-token" });
  await ctx.close();
});

test("owner recovery: a 3-second press on the logo opens the kept password form (not a short one); #/login?recover=1 too; password sign-in still works", async () => {
  const { ctx, p } = await ctxFor();
  const reg = await (await ctx.request.post(S.base + "/api/auth/register", { headers: { "X-Requested-With": "mujtama" }, data: { handle: "gate_owner", password: "secret1234", name: "المالك" } })).status();
  assert.equal(reg, 200);
  await ctx.clearCookies();
  await open(p);
  const box = await p.$eval("#gt-logo", (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.waitForTimeout(1000); await p.mouse.up();
  await p.waitForTimeout(2500);
  assert.equal(await p.isVisible("#gt-rec"), false, "a short press does nothing");
  await p.mouse.down(); await p.waitForTimeout(3300); await p.mouse.up();
  await p.waitForSelector("#gt-rec:not([hidden]) #a-handle", { state: "visible" });
  await p.keyboard.press("Escape"); await p.waitForSelector("#gt-rec", { state: "hidden" });
  await p.goto(S.base + "/?nosw#/login?recover=1"); await p.waitForSelector("#a-handle", { state: "visible", timeout: 20000 });
  await p.fill("#a-handle", "gate_owner"); await p.fill("#a-pass", "secret1234"); await p.click("#a-go");
  await p.waitForFunction(() => !document.body.classList.contains("gate-on"), null, { timeout: 20000 });
  assert.ok(!/login/.test(await p.evaluate(() => location.hash)), "left #/login after signing in");
  await ctx.close();
});
