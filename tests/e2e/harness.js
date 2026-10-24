/* E2E harness: real server (SQLite temp DB) serving the production build, driven by Chromium via
 * playwright-core. Browser resolved by tools/chromium.js (self-healing, persistent cache). */
const path = require("node:path"),
  fs = require("node:fs"),
  os = require("node:os");
const { chromium } = require("playwright-core");
const ROOT = path.join(__dirname, "..", "..");
const { resolveChromium } = require(path.join(ROOT, "tools", "chromium.js"));
/** Rebuild dist/ only when it is missing or older than any client source (index.html, root *.js/*.css, public/, vendor/, video/,
 * package.json, tools/build.mjs). Suites that need a current build (pi, tips) call this instead of an unconditional
 * `node tools/build.mjs`, which wiped the shared dist/ under parallel runs. A lock dir serialises the rare rebuild;
 * E2E_FORCE_BUILD=1 forces one. */
function ensureBuild() {
  const dist = path.join(ROOT, "dist"), stamp = path.join(dist, "build.json");
  const newest = () => {
    let m = 0; const see = (f) => { try { const t = fs.statSync(f).mtimeMs; if (t > m) m = t; } catch { /* gone */ } };
    for (const f of fs.readdirSync(ROOT)) if (/\.(js|css|html)$/.test(f) || f === "package.json") see(path.join(ROOT, f));
    see(path.join(ROOT, "tools", "build.mjs"));
    const walk = (d) => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else see(p); } };
    walk(path.join(ROOT, "public")); walk(path.join(ROOT, "vendor")); walk(path.join(ROOT, "video")); walk(path.join(ROOT, "game")); // v2.73: video/ modules · v2.88: game/ (the Digital City)
    return m;
  };
  const fresh = () => { try { return fs.existsSync(path.join(dist, "index.html")) && fs.statSync(stamp).mtimeMs >= newest(); } catch { return false; } };
  if (!process.env.E2E_FORCE_BUILD && fresh()) return false;
  const lock = path.join(os.tmpdir(), "mp-e2e-build-" + require("node:crypto").createHash("sha1").update(ROOT).digest("hex").slice(0, 10) + ".lock");
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const deadline = Date.now() + 180e3;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch {
      if (!process.env.E2E_FORCE_BUILD && fresh()) return false; // someone else just built it
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 180e3) fs.rmSync(lock, { recursive: true, force: true }); } catch { /* raced */ }
      if (Date.now() > deadline) throw new Error("ensureBuild: timed out waiting for build lock " + lock);
      sleep(250);
    }
  }
  try {
    if (process.env.E2E_FORCE_BUILD || !fresh()) require("node:child_process").execSync("node tools/build.mjs", { cwd: ROOT, stdio: "ignore" });
  } finally { fs.rmSync(lock, { recursive: true, force: true }); }
  return true;
}
/** @param {object} [extra] createApp options for this suite (v2.60: e.g. { storageDriver: "db" } like production) */
async function startStack(extra = {}) {
  if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) require("node:child_process").execSync("node tools/build.mjs", { cwd: ROOT, stdio: "inherit" });
  process.env.LOG_SILENT = "1";
  const { createApp } = require(path.join(ROOT, "server", "server.js"));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-e2e-"));
  const app = await createApp({
    databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"),
    storageDir: path.join(tmp, "st"),
    webRoot: path.join(ROOT, "dist"),
    seedDemo: false,
    ...extra
  });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + app.server.address().port;
  const browser = await chromium.launch({ ...resolveChromium(), args: ["--no-sandbox", "--disable-gpu", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  /* Phase 36b: index.html loads the real Pi SDK (https://sdk.minepi.com/pi-sdk.js). E2E never talks to Pi: every context
   * answers that URL with an empty script (suites that need window.Pi inject a fake one with addInitScript). The app's CSP
   * has no 'unsafe-inline' for scripts, which also blocks page.addScriptTag (axe); contexts bypass CSP by default, a suite
   * that wants the real policy enforced passes { bypassCSP: false } (pi.e2e does). */
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts = {}) => {
    const ctx = await newContext({ bypassCSP: true, ...opts });
    await ctx.route("https://sdk.minepi.com/**", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "/* Pi SDK stub (e2e) */" }));
    return ctx;
  };
  return {
    app,
    base,
    browser,
    async close() {
      if (browser) await browser.close();
      await app.close();
    }
  };
}
const MOBILE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "ar-SA",
  userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36"
};
const DESKTOP = { viewport: { width: 1440, height: 900 }, locale: "ar-SA" };
async function onboard(page, base, handle, name = "مستخدم تجريبي") {
  await page.goto(base + "/?nosw");
  await page.click("[data-m=register]");
  await page.fill("#a-name", name);
  await page.fill("#a-handle", handle);
  await page.fill("#a-pass", "secret1234");
  await page.click("#a-go");
  await page.waitForSelector("#n1");
  await markTourDone(page); // before #n3 schedules the forced tour, so it never opens over a test's clicks
  await page.click("#n1");
  for (const t of ["ai", "dev", "pi"]) await page.click(`[data-i="${t}"]`);
  await page.click("#n2");
  await page.click("#n3");
  await page.waitForSelector(".bottomnav a[data-r=home]");
  await meId(page); // the session's user id is in the store before the test reads it
  await dismissTour(page);
}
/* the signed-in user's id. `DB` is a top-level lexical binding of app.js, so read it bare: `window.DB` only exists once
 * comms-ui.js lazy-loads on the idle chain (chunks.js), which under CPU load can land after the test's next line. */
async function meId(page, timeout = 30000) {
  await page.waitForFunction(() => typeof DB !== "undefined" && !!DB && !!DB.me, null, { timeout });
  return page.evaluate(() => DB.me);
}
/* v2.63: mark the guided tour done for the signed-in account the same way the app does when it is skipped (server
 * onboarding.tour_done + localStorage mp_tour, see identity-ui.js startTour/done). startTour reads GET /api/onboarding and
 * returns when tourDone is set (also on the forced post-onboarding trigger), so no tour can land mid-test under load. */
async function markTourDone(page) {
  const ok = await page.evaluate(async () => {
    const h = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
    await fetch("/api/onboarding", { headers: h }); // creates the onboarding row
    const r = await fetch("/api/onboarding/tour", { method: "POST", headers: h, body: JSON.stringify({ skipped: true }) });
    localStorage.setItem("mp_tour", "1");
    return r.ok;
  });
  if (!ok) throw new Error("markTourDone: POST /api/onboarding/tour failed");
}
/* the guided tour appears once after onboarding; tests skip it. Accounts made by onboard() are marked done up front, so this
 * only waits briefly for a stray tour (a page loaded before the flag) and always returns with no div.tour in the DOM. */
async function dismissTour(page) {
  await markTourDone(page).catch(() => {});
  // v2.54: a fresh sign-up always gets the tour (600 ms timer + GET /api/onboarding); under load it can land after 4 s and then
  // sits over the next click (.tour intercepts pointer events) — wait long enough for it instead of racing it
  const btn = await page.waitForSelector("#t-skip, #t-ok", { timeout: 1500 }).catch(() => null);
  if (btn) await btn.click().catch(() => {});
  await page.waitForSelector(".tour", { state: "detached", timeout: 10000 });
}
/* v2.54: an account made through the API (not the UI onboarding) still gets the tour on its first home render — 900 ms
 * after it, so under load it can open mid-test and sit over the next click. Mark it done server-side up front. */
async function tourDone(base, cookie) {
  const h = { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: base, Cookie: cookie };
  await fetch(base + "/api/onboarding", { headers: h }); // creates the onboarding row
  const r = await fetch(base + "/api/onboarding/tour", { method: "POST", headers: h, body: JSON.stringify({ skipped: true }) });
  if (!r.ok) throw new Error("tourDone: " + r.status);
}
module.exports = { ensureBuild, startStack, onboard, meId, dismissTour, markTourDone, tourDone, MOBILE, DESKTOP, ROOT };
