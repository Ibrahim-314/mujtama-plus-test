/* global document, window, location, refresh, MPMenu, scrollTo */
/* v2.144 «ميزانية التصميم»: visual-regression gate. Proves a CSS refactor (tokens for colours / font sizes / shadows) changes
 * no pixel on screen. No new dependencies: the e2e harness (real server + SQLite temp DB + Chromium) and pngjs (already a
 * devDependency) do the work.
 *
 *   node tools/visual-diff.mjs shoot <outDir> [--core] [--jobs 2] [--only m-ar-light,d-en-dark] [--routes "#/home,#/me"]
 *   node tools/visual-diff.mjs compare <beforeDir> <afterDir> [--threshold 0.0001] [--tolerance 8]
 *
 * shoot: 8 combos = {m: 390x844 mobile ctx, d: 1440x900} x {ar, en} x {light, dark}. Without --core every route = the main
 * tabs + every «المزيد» hub screen (MPMenu.items(), the same list tap-sweep-v2143 sweeps); --core = 20 key screens for the
 * permanent ship gate. Output: <outDir>/<combo>/<route>.png + <outDir>/<combo>/manifest.json.
 *
 * Determinism (each combo gets its OWN stack — server, DB, browser — so no combo's visits can change another's data):
 * - server clock: Date is shifted so the server believes it is T0 (2027-01-11 09:00Z, a Monday noon in Riyadh) at start
 *   and is re-pinned to T0+1 min right before seeding, so every seeded timestamp is the same run to run, on any day
 * - page clock: context.clock installed at T0 before the first navigation, then fixed (setFixedTime) at T0+20 min once the
 *   data is seeded, so "منذ 25 دقيقة" style labels and dates render the same every run; timers keep running
 * - the viewer's avatar colour (random at sign-up) pinned to the first palette colour; the seed's two communities share
 *   one created_at, so one is moved a minute earlier (a tie had no stable directory order); page Math.random seeded; server row ids drawn from a
 *   seeded sequence (ids break ties in sorted lists), so list order repeats
 * - same sign-up handle (vd_user) and the same tests/e2e/discovery-seed.js world in every combo; en via MPI18n.setLang
 * - deviceScaleFactor 1, reducedMotion reduce, colorScheme per combo, every animation/transition off and the caret hidden
 *   by an injected style, toasts hidden (transient), every request off the local server answered 404 (no network)
 * - full mode hardening (v2.144): #/city's Godot game document is stubbed (it crashed the renderer); a closed/crashed tab is
 *   replaced by a fresh one in the same context and the run goes on; each screen is capped at 30 s; an unstable screen
 *   records lastFrameDiff (changed pixels + bounding box) in manifest.json and the progress log
 * - warm-up pass: every route is opened once before any shot, so every lazy chunk, icon sprite and en catalogue is loaded
 *   (without it the English MJT text and some profile tab icons differed run to run, depending on load order)
 * - per screen: wait for no .skel + view text, network quiet 300 ms, fonts ready + images complete, scroll to top, then
 *   screenshot (blurring focus before every frame: the search box focuses itself late) until two consecutive frames are
 *   byte-identical (max 6); a screen that never settles is marked unstable in manifest.json
 * - VIEWPORT screenshots at scroll 0, not full page: the feed / lists are lazy and infinite, so the page height (and with
 *   it a full-page image's size) depends on how much has loaded; the top viewport holds page heads, cards, tabs and bars.
 * compare: per pixel, a channel differing by more than --tolerance (8) counts as changed (ignores antialias noise). Writes
 * <afterDir>/diff/<combo>/<route>.png (changed pixels red over a faded copy) + <afterDir>/diff/report.json. Exit 1 when any
 * screen is over --threshold (fraction of pixels, default 0.0001 = 0.01 %), is missing in after, or differs in size. */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(SELF), "..");

const COMBOS = ["m-ar-light", "m-ar-dark", "m-en-light", "m-en-dark", "d-ar-light", "d-ar-dark", "d-en-light", "d-en-dark"];
const MAIN = ["#/home", "#/explore", "#/me", "#/menu", "#/messages", "#/notifications", "#/settings", "#/search", "#/communities", "#/digest", "#/clips", "#/versions"];
// core gate: ~20 key screens. {post} / {community} are filled from the seeded world.
const CORE = ["#/home", "#/explore", "#/search", "#/me", "#/post/{post}", "#/messages", "#/notifications", "#/menu", "#/settings", "#/communities", "#/c/{community}",
  "#/clips", "#/studio", "#/aihub", "#/mjt", "#/wallet", "#/jobs", "#/courses", "#/market", "#/cadmin", "#/about"];
const T0 = Date.parse("2027-01-11T09:00:00Z");
const PAGE_NOW = T0 + 20 * 60e3;
const PORT_BASE = +(process.env.VDIFF_PORT || 7400); // team rule: own port range (7400-7499)

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(name);
const slug = (h) => h.replace(/^#\//, "").replace(/\{(\w+)\}/g, "$1").replace(/\/(p|c)_[A-Za-z0-9_-]+$/, "").replace(/[^\w-]+/g, "_") || "root";
const ms = (t) => (t / 1000).toFixed(1) + "s";

// diagnosis for an unstable screen: how many pixels changed between its last two frames, and their bounding box
function pxDiff(a, b) {
  const { PNG } = require("pngjs"); const A = PNG.sync.read(a), B = PNG.sync.read(b);
  if (A.width !== B.width || A.height !== B.height) return { size: true };
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let i = 0; i < A.data.length; i += 4) if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) { n++; const px = (i / 4) % A.width, py = Math.floor(i / 4 / A.width); if (px < x0) x0 = px; if (py < y0) y0 = py; if (px > x1) x1 = px; if (py > y1) y1 = py; }
  return { px: n, box: n ? [x0, y0, x1, y1] : null };
}

const TELEMETRY = /^\/api\/(status|admin\/ops\/overview)(\?|$)/;
const KEEP_NUM = new Set(["target", "windowDays", "thresholdMs", "threshold", "window_min", "hours", "errors24h", "enabled"]);
function pinLive(v, k = "") {
  if (typeof v === "number") return KEEP_NUM.has(k) ? v : 0;
  if (Array.isArray(v)) return v.map((x) => pinLive(x, k));
  if (v && typeof v === "object") { const o = {}; for (const [kk, x] of Object.entries(v)) o[kk] = pinLive(x, kk); return o; }
  return v;
}

/* ---------------------------------------------------------------- shoot (parent) */
async function shoot() {
  const out = path.resolve(args[1] || ""); if (!args[1]) usage();
  const combos = (opt("--only", "") || COMBOS.join(",")).split(",").filter(Boolean);
  const jobs = Math.max(1, +opt("--jobs", "2"));
  const { ensureBuild } = require(path.join(ROOT, "tests/e2e/harness.js"));
  ensureBuild(); // once, before the workers (they must never rebuild dist/ under each other)
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now(); let next = 0, failed = 0;
  const run = (combo, slot) => new Promise((res) => {
    const a = [SELF, "__worker", out, combo, String(PORT_BASE + slot)]; if (flag("--core")) a.push("--core"); if (opt("--routes")) a.push("--routes", opt("--routes"));
    const c = spawn(process.execPath, a, { stdio: ["ignore", "inherit", "inherit"] });
    c.on("exit", (code) => { if (code) { failed++; console.error(`✗ ${combo} worker exited ${code}`); } res(); });
  });
  await Promise.all(Array.from({ length: Math.min(jobs, combos.length) }, async (_, slot) => { while (next < combos.length) await run(combos[next++], slot); }));
  let shots = 0; const unstable = []; for (const c of combos) { try { const m = JSON.parse(fs.readFileSync(path.join(out, c, "manifest.json"), "utf8")); shots += m.shots.length; unstable.push(...m.shots.filter((s) => !s.stable).map((s) => c + "/" + s.file)); } catch { /* worker failed */ } }
  console.log(`\nshot ${shots} screens in ${combos.length} combos → ${out} (${ms(Date.now() - t0)})`);
  if (unstable.length) console.log("unstable (never settled):", unstable.join(", "));
  process.exit(failed ? 1 : 0);
}

/* ---------------------------------------------------------------- shoot (one combo, own stack) */
async function worker() {
  const [, out, combo, port] = args; const core = flag("--core");
  // server clock → T0 (before the server module loads)
  const RealDate = Date; let OFF = RealDate.now() - T0;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(RealDate.now() - OFF); else super(...a); } static now() { return RealDate.now() - OFF; } }
  globalThis.Date = FakeDate;
  // row ids (core.js id() = crypto.randomBytes(6) + time) break ties in sorted lists: give 6-byte draws their own seeded
  // sequence so ids — and every tie-broken list order — repeat run to run (other sizes stay truly random)
  let seed = 0x2144; const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const nodeCrypto = require("node:crypto"), realBytes = nodeCrypto.randomBytes;
  nodeCrypto.randomBytes = (n, cb) => { if (n !== 6) return realBytes(n, cb); const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = Math.floor(rnd() * 256); if (typeof cb === "function") { process.nextTick(cb, null, b); return; } return b; };
  // harness listens on port 0: pin it to our range
  const net = require("node:net"), listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (p, ...rest) { if (p === 0) p = +port; return listen.call(this, p, ...rest); };
  const { startStack, onboard, MOBILE, DESKTOP } = require(path.join(ROOT, "tests/e2e/harness.js"));
  const { seedDiscovery } = require(path.join(ROOT, "tests/e2e/discovery-seed.js"));
  const tStart = RealDate.now();
  const S = await startStack();
  const [dev, lang, scheme] = combo.split("-");
  const ctx = await S.browser.newContext({ ...(dev === "m" ? MOBILE : DESKTOP), deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: scheme, timezoneId: "Asia/Riyadh" });
  await ctx.clock.install({ time: T0 });
  await ctx.route("**/*", async (r) => {
    const u = r.request().url();
    // the en catalogue's two lazy halves load in parallel and merge in arrival order, and some Arabic keys are translated in
    // BOTH with different English (e.g. the MJT «رصيد داخل التطبيق فقط…» line in i18n-enplus.js and i18n-enextra.js), so the
    // text shown depended on which file landed first: hold enextra back so the merge order is the same every run
    if (/chunk-i18n-enextra-/.test(u)) await new Promise((res) => setTimeout(res, 400));
    // #/city mounts the Godot 3D game (WASM + WebGL, ~7 MB) in an iframe: its frames never repeat and on this box it crashed
    // the renderer (one full run lost 146 of 158 screens to "Target page … has been closed"). The gate checks the app's part
    // of that screen (the full-screen shell + its ✕ button), so the game document is answered with a fixed blank stub.
    // live server telemetry (#/status, #/admin/ops): process memory, uptime, DB ping, requests / p95 of the last minute and
    // their per-minute series are measured on the real process, so they change on every read. Every number in those two
    // responses is pinned to 0 except the configured ones (targets, thresholds, windows): layout and labels are still checked
    if (TELEMETRY.test(u.slice(S.base.length)) && r.request().method() === "GET") {
      const res = await r.fetch(); let body = await res.text();
      try { body = JSON.stringify(pinLive(JSON.parse(body))); } catch { /* not JSON: pass through */ }
      return r.fulfill({ response: res, body });
    }
    if (u.startsWith(S.base + "/nabd/engine/")) return r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body style='margin:0;background:#05070d'></body></html>" });
    if (u.startsWith(S.base) || u.startsWith("data:") || u.startsWith("blob:")) return r.continue(); if (u.startsWith("https://sdk.minepi.com/")) return r.fallback(); return r.fulfill({ status: 404, body: "" }); });
  await ctx.addInitScript(() => {
    // #/wellbeing counts time-in-app on the device: a 5 s interval adds 5 s while the tab is visible and was used in the last
    // minute. With the page clock fixed, "last used" never ages, so the minutes shown = real seconds since sign-up, i.e. how
    // long the run took to reach that screen. That one counter is not started (it shows 0, every run); all else runs.
    const si = window.setInterval;
    window.setInterval = function (fn, ms, ...a) { if (ms === 5000 && typeof fn === "function") { const src = String(fn); if (/visibilityState\s*!==\s*["']visible["']/.test(src) && /\.d\[/.test(src) && /\.n\[/.test(src)) return 0; } return si.call(this, fn, ms, ...a); };
    let sd = 0x2144; Math.random = () => { sd = (sd + 0x6d2b79f5) | 0; let t = Math.imul(sd ^ (sd >>> 15), 1 | sd); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const css = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}#toast,.toast,.toasts{display:none!important}";
    const add = () => { if (document.getElementById("vd-freeze")) return; const s = document.createElement("style"); s.id = "vd-freeze"; s.textContent = css; const host = document.head || document.documentElement; if (host) host.appendChild(s); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", add); else add(); add();
  });
  let p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  S.app.ctx.rl.w?.clear?.();
  const realRandom = Math.random; Math.random = () => 0; // sign-up picks a random avatar colour: pin it to the first one
  await onboard(p, S.base, "vd_user", "حساب الفحص البصري");
  Math.random = realRandom;
  OFF = RealDate.now() - (T0 + 60e3); // the seeded world is always written at T0+1 min, however long start-up took
  const world = await seedDiscovery(S.app.ctx, p);
  // the seed writes both communities at the same instant; the directory order of a created_at tie is not stable: split it
  await S.app.ctx.db.run("UPDATE communities SET created_at=$1 WHERE name=$2", [new Date(T0 - 9001 * 60e3).toISOString(), "تصميم بالعربي"]);
  await ctx.clock.setFixedTime(PAGE_NOW);
  await p.evaluate(() => refresh());
  if (lang === "en") { await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForTimeout(400); }
  let routes;
  if (opt("--routes")) routes = opt("--routes").split(",");
  else if (core) routes = CORE;
  else {
    await p.evaluate(() => { location.hash = "#/menu"; }); await p.waitForSelector("#mn-q", { timeout: 15000 });
    routes = [...MAIN, ...[...new Set(await p.evaluate(() => MPMenu.items().map((x) => x.h)))].filter((h) => !MAIN.includes(h))];
  }
  const commId = (await S.app.ctx.db.get("SELECT id FROM communities WHERE name=$1", ["مطورو الويب العرب"]))?.id;
  const fill = (h) => h.replace("{post}", world.posts.ai1).replace("{community}", commId);
  const dir = path.join(out, combo); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  // requests in flight (lazy chunks, i18n catalogues, API): a screen is shot only once the network has been quiet for 300 ms
  let inflight = 0, quietSince = RealDate.now();
  const done = () => { inflight = Math.max(0, inflight - 1); if (!inflight) quietSince = RealDate.now(); };
  const attach = (pg) => { pg.on("request", () => { inflight++; }); pg.on("requestfinished", done); pg.on("requestfailed", done); };
  attach(p);
  // a crashed / closed tab must not take every later screen with it: open a fresh tab in the same context (session cookie,
  // localStorage language and the fixed page clock all live on the context) and carry on
  let crashes = 0;
  const revive = async () => {
    crashes++; try { await p.close(); } catch { /* already gone */ }
    p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); attach(p); inflight = 0; quietSince = RealDate.now();
    await p.goto(S.base + "/#/home"); await p.waitForFunction(() => document.querySelector("#view")?.textContent.trim().length > 0, null, { timeout: 15000 }).catch(() => {});
    if (lang === "en") { await p.evaluate(() => window.MPI18n?.setLang?.("en")); await p.waitForTimeout(400); }
    await netIdle();
  };
  const ROUTE_MS = 30000; // hard cap per screen: a stuck screen is reported, never stalls the run
  const capped = (pr, what) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout " + ROUTE_MS + "ms in " + what)), ROUTE_MS))]);
  const netIdle = async (max = 8000) => { const end = RealDate.now() + max; while (RealDate.now() < end) { if (!inflight && RealDate.now() - quietSince >= 300) return; await p.waitForTimeout(50); } };
  const open = async (h) => {
    S.app.ctx.rl.w?.clear?.();
    // (#more-sentinel is the home feed's infinite-scroll trigger: it wears .skel for good, and waiting on it cost 12 s per open)
    await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); if (location.hash === h) location.hash = "#/"; location.hash = h; }, fill(h));
    await p.waitForFunction(() => !document.querySelector("#view .skel:not(#more-sentinel)") && document.querySelector("#view")?.textContent.trim().length > 0, null, { timeout: 12000 }).catch(() => {});
    await netIdle();
  };
  // warm-up pass: every route once, so every lazy chunk / icon sprite / en catalogue is loaded before anything is shot
  // (without it a screen could render before a late catalogue or sprite and differ run to run)
  // (the full run warms with the main tabs + core screens only: they pull in the shared chunks, and warming all ~165 routes
  // would double a run that already takes the longest)
  // every route is warmed, full mode included: warming only MAIN+CORE left each «المزيد» screen's own chunk to load during
  // its shot (late paint = frames differ). A warm open is ~1 s, so this adds ~2.5 min to a full combo.
  const warm = routes;
  const progress = path.join(dir, "..", combo + ".progress.log"); fs.writeFileSync(progress, `warm-up ${warm.length} routes\n`);
  for (const h of warm) { await capped(open(h), "warm " + h).catch(() => {}); if (p.isClosed()) await revive(); }
  await netIdle();
  fs.appendFileSync(progress, `warm-up done in ${ms(RealDate.now() - tStart)}\n`);
  // en: re-apply the catalogue to the DOM before each frame. A heading can be painted after the i18n pass ran (seen: the
  // post page title «المنشور» stayed Arabic in one English run and read "Post" in the next); applying it again shows the
  // finished English page every time instead of whichever side of that race a run landed on
  // #/admin: each lazy module adds its own admin card (#xx-adm) after its OWN api call returns, inserted right after the
  // heading, so the cards' order is the order those calls happened to finish (app-side race, reported to the integrator).
  // Before each frame they are put in id order, in the slot where they landed — every card is still shown and checked.
  const frame = async () => {
    await p.evaluate(() => {
      if (location.hash !== "#/admin") return;
      const cards = [...document.querySelectorAll("#view [id$='-adm']")]; if (cards.length < 2) return;
      const parent = cards[0].parentElement; if (cards.some((c) => c.parentElement !== parent)) return;
      const anchor = document.createComment("vd"); parent.insertBefore(anchor, cards[0]);
      cards.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((c) => parent.insertBefore(c, anchor)); anchor.remove();
    });
    await p.evaluate((en) => { document.activeElement?.blur?.(); if (en && window.MPI18n?.apply) window.MPI18n.apply(document.body, "en"); }, lang === "en");
    return p.screenshot({ animations: "disabled", caret: "hide" });
  };
  const shots = [];
  for (const h of routes) {
    const t = RealDate.now(), file = slug(h) + ".png", before = errors.length;
    if (p.isClosed()) await revive();
    let diffPx = null;
    try { await capped((async () => {
      await open(h);
      await p.evaluate(async () => {
        document.activeElement?.blur?.(); await document.fonts.ready;
        await Promise.race([Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))), new Promise((r) => setTimeout(r, 3000))]);
        scrollTo(0, 0); document.querySelectorAll("#view, main, .scroller").forEach((e) => { e.scrollTop = 0; });
      });
      await p.waitForTimeout(250); await netIdle();
      // a search box may focus itself a moment after render (its suggestions list then covers the page): blur on every frame
      let prev = await frame(), stable = false;
      for (let k = 0; k < 5 && !stable; k++) { await p.waitForTimeout(300); const cur = await frame(); stable = cur.equals(prev); if (!stable) diffPx = pxDiff(prev, cur); prev = cur; }
      fs.writeFileSync(path.join(dir, file), prev);
      shots.push({ route: h, file, stable, ms: RealDate.now() - t, ...(stable ? {} : { lastFrameDiff: diffPx }), errors: errors.slice(before) });
      fs.appendFileSync(progress, `${shots.length}/${routes.length} ${h} ${RealDate.now() - t}ms${stable ? "" : " UNSTABLE " + JSON.stringify(diffPx)}\n`);
    })(), "shot " + h); } catch (e) {
      const error = String(e.message || e).slice(0, 200), closed = p.isClosed() || /closed|crash/i.test(error);
      shots.push({ route: h, file, stable: false, ms: RealDate.now() - t, error, crashed: closed });
      fs.appendFileSync(progress, `${shots.length}/${routes.length} ${h} ${RealDate.now() - t}ms ERROR ${error}\n`);
      if (closed || /^timeout/.test(error)) await revive().catch(() => {});
    }
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ combo, core, t0: new RealDate(T0).toISOString(), pageNow: new RealDate(PAGE_NOW).toISOString(), runtimeMs: RealDate.now() - tStart, crashes, shots }, null, 1));
  console.log(`✓ ${combo}: ${shots.length} screens (${shots.filter((s) => !s.stable).length} unstable) in ${ms(RealDate.now() - tStart)}`);
  await S.close(); process.exit(0);
}

/* ---------------------------------------------------------------- compare */
function compare() {
  const [, bDir, aDir] = args; if (!bDir || !aDir) usage();
  // default 0.0001 (0.01 %): a deliberate button text-colour change touched only 0.046–0.4 % of a screen, so the 0.1 % first
  // proposed let 87 of 125 changed screens pass; repeat runs on the same commit are 0 px (rare 4 px antialias specks pass)
  const threshold = +opt("--threshold", "0.0001"), tol = +opt("--tolerance", "8");
  const { PNG } = require("pngjs");
  const report = { threshold, tolerance: tol, screens: [], failed: [] };
  const diffRoot = path.join(aDir, "diff"); fs.rmSync(diffRoot, { recursive: true, force: true });
  const combos = fs.readdirSync(bDir).filter((d) => d !== "diff" && fs.statSync(path.join(bDir, d)).isDirectory()).sort();
  for (const combo of combos) {
    for (const file of fs.readdirSync(path.join(bDir, combo)).filter((f) => f.endsWith(".png")).sort()) {
      const key = combo + "/" + file, af = path.join(aDir, combo, file);
      if (!fs.existsSync(af)) { report.screens.push({ key, status: "missing" }); report.failed.push(key); continue; }
      const A = PNG.sync.read(fs.readFileSync(path.join(bDir, combo, file))), B = PNG.sync.read(fs.readFileSync(af));
      if (A.width !== B.width || A.height !== B.height) { report.screens.push({ key, status: "size", before: [A.width, A.height], after: [B.width, B.height], changed: 1 }); report.failed.push(key); continue; }
      const D = new PNG({ width: B.width, height: B.height }); let n = 0;
      for (let i = 0; i < A.data.length; i += 4) {
        const hit = Math.abs(A.data[i] - B.data[i]) > tol || Math.abs(A.data[i + 1] - B.data[i + 1]) > tol || Math.abs(A.data[i + 2] - B.data[i + 2]) > tol || Math.abs(A.data[i + 3] - B.data[i + 3]) > tol;
        if (hit) { n++; D.data[i] = 255; D.data[i + 1] = 0; D.data[i + 2] = 0; D.data[i + 3] = 255; }
        else { const g = 255 - ((255 - (B.data[i] * 0.3 + B.data[i + 1] * 0.59 + B.data[i + 2] * 0.11)) * 0.25); D.data[i] = D.data[i + 1] = D.data[i + 2] = g; D.data[i + 3] = 255; }
      }
      const changed = n / (A.width * A.height);
      if (n) { fs.mkdirSync(path.join(diffRoot, combo), { recursive: true }); fs.writeFileSync(path.join(diffRoot, combo, file), PNG.sync.write(D)); }
      const over = changed > threshold;
      report.screens.push({ key, status: n ? (over ? "changed" : "within") : "same", pixels: n, changed });
      if (over) report.failed.push(key);
    }
    if (fs.existsSync(path.join(aDir, combo))) for (const f of fs.readdirSync(path.join(aDir, combo))) if (f.endsWith(".png") && !fs.existsSync(path.join(bDir, combo, f))) report.screens.push({ key: combo + "/" + f, status: "new" });
  }
  fs.mkdirSync(diffRoot, { recursive: true }); fs.writeFileSync(path.join(diffRoot, "report.json"), JSON.stringify(report, null, 1));
  const shown = report.screens.filter((s) => s.status !== "same");
  for (const s of shown) console.log(`${s.status === "within" ? " " : "✗"} ${s.key}  ${s.status}${s.changed != null ? "  " + (s.changed * 100).toFixed(3) + "%" : ""}`);
  console.log(`\n${report.screens.length} screens compared, ${report.screens.filter((s) => s.status === "same").length} identical, ${report.failed.length} over threshold/missing → ${path.join(diffRoot, "report.json")}`);
  process.exit(report.failed.length ? 1 : 0);
}

function usage() { console.error("usage:\n  node tools/visual-diff.mjs shoot <outDir> [--core] [--jobs 2] [--only combo,…] [--routes '#/a,#/b']\n  node tools/visual-diff.mjs compare <beforeDir> <afterDir> [--threshold 0.0001] [--tolerance 8]"); process.exit(2); }

const cmd = args[0];
if (cmd === "shoot") await shoot();
else if (cmd === "__worker") await worker();
else if (cmd === "compare") compare();
else usage();
