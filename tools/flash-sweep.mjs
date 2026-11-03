/* global document, window, location, requestAnimationFrame */
/* v2.149.2 «ولا ومضة»: first-paint flash sweep (dev tool). For every screen (main tabs + every «المزيد» hub screen) it opens
 * the screen two ways — COLD (full reload, like opening the app on that link) and NAV (in-app hash change from #/home) —
 * and records every animation frame for 5 s: the classes + rounded boxes of the first 60 elements of #view, the page
 * language, CLS, and the Arabic-letter count of the app's own chrome (header, side rail, bottom nav, tabs, buttons, headings,
 * labels; user content such as post bodies is skipped). It does not judge text, it judges CHANGE after the first frame
 * that already had content:
 *   restyle   = frames where an element that was already on screen changed its class (old look → new look)
 *   moves     = frames where a box already on screen moved/resized by > 8 px (a jump, even if CLS misses it)
 *   swaps     = #view's top-level children replaced after content was shown (whole screen redrawn)
 *   arMs      = (en only) ms the chrome showed more Arabic than its settled frame (the «Arabic for 1.5 s» bug)
 *   settleMs  = ms from first content to the last change
 * score = restyle*3 + moves*2 + swaps*4 + arMs/100 + cls*100. Output: JSON report + ranked table.
 *   node tools/flash-sweep.mjs <out.json> [--combos m-ar-light,m-en-dark,d-ar-light,d-en-dark] [--routes "#/home,#/me"] [--modes cold,nav] */
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { startStack, onboard, dismissTour, MOBILE, DESKTOP } = require(path.join(ROOT, "tests/e2e/harness.js"));
const { seedDiscovery } = require(path.join(ROOT, "tests/e2e/discovery-seed.js"));
const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = args[0] && !args[0].startsWith("--") ? args[0] : "/workspace/work/flash-sweep.json";
const COMBOS = (opt("--combos") || "m-ar-light,m-en-dark,d-ar-light,d-en-dark").split(",");
const MODES = (opt("--modes") || "cold,nav").split(",");
const MAIN = ["#/home", "#/explore", "#/me", "#/u/fs_sara", "#/post/{post}", "#/c/{community}", "#/menu", "#/messages", "#/notifications", "#/settings", "#/search", "#/communities", "#/digest", "#/shorts", "#/versions"];
const WINDOW = +(opt("--window") || 3500);
const probe = () => {
  const AR = /[\u0600-\u06FF]/g, USER = ".post-body,.post-text,.pc-text,.bubble,.msg,.comment-text,.c-text,.bio,.pv3-bio,.name,.handle,.uname,.author,.who,.ttl-user,[dir=auto],input,textarea,.ex-text,.n-text,.card-body p";
  const CHROME = "header,.topbar,.side,.siderail,.bottomnav,.tabs,.tab,button,h1,h2,h3,label,.chip,.btn,.empty,.sec-title,.pg-title,.hint";
  const st = { frames: [], cls: 0, t0: performance.now(), on: true };
  window.__fs = st;
  const sig = () => {
    const v = document.getElementById("view"); if (!v) return null;
    const els = [v, ...v.querySelectorAll("*")].slice(0, 61), boxes = [], cls = [];
    for (const e of els) { const r = e.getBoundingClientRect(); boxes.push([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]); cls.push((e.getAttribute("class") || "").split(/\s+/).filter((c) => c && !/^(on|active|focus|hover|is-|in$|show$|vis|enter$)/.test(c)).sort().join(".")); }
    let ar = 0;
    if (document.documentElement.lang === "en") for (const e of document.querySelectorAll(CHROME)) { if (e.closest(USER) || !e.getClientRects().length) continue; for (const n of e.childNodes) if (n.nodeType === 3) ar += (n.nodeValue.match(AR) || []).length; }
    const text = v.textContent.trim().length, skel = !!v.querySelector(".skel:not(#more-sentinel)");
    return { t: Math.round(performance.now() - st.t0), n: v.children.length, kids: [...v.children].slice(0, 6).map((k) => k.tagName + "." + (k.className || "").toString().slice(0, 40)).join("|"), cls, boxes, ar, text, skel, lang: document.documentElement.lang, vcls: v.className };
  };
  const tick = () => { if (!st.on) return; const s = sig(); if (s) st.frames.push(s); if (performance.now() - st.t0 < (window.__fsWin || 5000)) requestAnimationFrame(tick); else st.on = false; };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) st.cls += e.value; }).observe({ type: "layout-shift", buffered: false }); } catch { /* old engine */ }
  window.__fsStart = () => { st.frames = []; st.cls = 0; st.t0 = performance.now(); st.on = true; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
function analyse(st, mode) {
  let fr = st.frames;
  if (mode === "nav" && fr.length) { const k0 = fr[0].kids; const i = fr.findIndex((f) => f.kids !== k0); fr = i > 0 ? fr.slice(i) : fr; } // the previous screen's frames before the new one is drawn
  const first = fr.findIndex((f) => f.text > 0 && !f.skel);
  if (first < 0) return { noContent: true, score: 0, frames: fr.length };
  let restyle = 0, moves = 0, swaps = 0, last = fr[first].t, arMs = 0; const ex = [];
  const fin = fr[fr.length - 1];
  for (let i = first + 1; i < fr.length; i++) {
    const a = fr[i - 1], b = fr[i]; let rs = false, mv = false;
    if (a.kids !== b.kids && b.text > 0) { swaps++; last = b.t; if (ex.length < 6) ex.push(b.t + "ms swap " + a.kids.slice(0, 70) + " → " + b.kids.slice(0, 70)); }
    const n = Math.min(a.cls.length, b.cls.length);
    for (let k = 0; k < n; k++) {
      if (a.cls[k] !== b.cls[k] && a.boxes[k][2] > 0) { rs = true; if (ex.length < 6) ex.push(b.t + "ms class [" + a.cls[k].slice(0, 50) + "] → [" + b.cls[k].slice(0, 50) + "]"); break; }
    }
    for (let k = 1; k < n; k++) { const p = a.boxes[k], q = b.boxes[k]; if (p[2] && q[2] && a.cls[k] === b.cls[k] && (Math.abs(p[0] - q[0]) > 8 || Math.abs(p[1] - q[1]) > 8 || Math.abs(p[2] - q[2]) > 8)) { mv = true; if (ex.length < 6) ex.push(b.t + "ms move #" + k + " [" + b.cls[k].slice(0, 40) + "] " + p + " → " + q); break; } }
    if (rs) restyle++; if (mv) moves++; if (rs || mv) last = b.t;
    if (fin.lang === "en" && a.ar > fin.ar + 15) arMs += b.t - a.t;
  }
  const settleMs = last - fr[first].t, cls = +st.cls.toFixed(4);
  return { firstMs: fr[first].t, settleMs, restyle, moves, swaps, arMs, cls, score: +(restyle * 3 + moves * 2 + swaps * 4 + arMs / 100 + cls * 100).toFixed(1), ex };
}
async function runCombo(combo) {
  const S = await startStack(); const [dev, lang, scheme] = combo.split("-");
  const ctx = await S.browser.newContext({ ...(dev === "m" ? MOBILE : DESKTOP), reducedMotion: "reduce", colorScheme: scheme, timezoneId: "Asia/Riyadh" });
  await ctx.route("**/*", (r) => { const u = r.request().url(); if (u.startsWith(S.base + "/nabd/engine/")) return r.fulfill({ status: 200, contentType: "text/html", body: "<html><body></body></html>" }); if (u.startsWith(S.base) || u.startsWith("data:") || u.startsWith("blob:")) return r.continue(); return r.fulfill({ status: 404, body: "" }); });
  await ctx.addInitScript(probe);
  let p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  await onboard(p, S.base, "fs_user", "حساب فحص الوميض"); await dismissTour(p).catch(() => {});
  const world = await seedDiscovery(S.app.ctx, p);
  // a second author with a profile to open (#/u/fs_sara)
  const j = (m, pth, body) => fetch(S.base + pth, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: body && JSON.stringify(body) });
  S.app.ctx.rl.w?.clear?.(); await j("POST", "/api/auth/register", { name: "سارة الكاتبة", handle: "fs_sara", password: "secret123" });
  if (scheme === "dark") await p.evaluate(() => { try { window.DB.settings.theme = "dark"; window.save(); window.applyShell(); } catch { /* */ } });
  if (lang === "en") { await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForTimeout(600); }
  await p.evaluate(() => { location.hash = "#/menu"; }); await p.waitForSelector("#mn-q", { timeout: 15000 }).catch(() => {});
  let routes = opt("--routes") ? opt("--routes").split(",") : [...MAIN, ...[...new Set(await p.evaluate(() => (window.MPMenu?.items?.() || []).map((x) => x.h)))].filter((h) => !MAIN.includes(h))];
  routes = routes.filter((h) => !/^#\/city$/.test(h));
  const part = opt("--part"); if (part) { const [i, n] = part.split("/").map(Number); routes = routes.filter((_, k) => k % n === i - 1); }
  const commId = (await S.app.ctx.db.get("SELECT id FROM communities WHERE name=$1", ["مطورو الويب العرب"]))?.id;
  const fill = (h) => h.replace("{post}", world.posts?.ai1).replace("{community}", commId);
  // warm pass: every chunk in the HTTP cache (a returning user), so COLD measures the app, not the network
  for (const h of routes) { S.app.ctx.rl.w?.clear?.(); await p.evaluate((h) => { location.hash = h; }, fill(h)).catch(() => {}); await p.waitForTimeout(700); }
  const res = [];
  await ctx.addInitScript((w) => { window.__fsWin = w; }, WINDOW);
  const NAVSET = opt("--nav-all") ? null : new Set(MAIN);
  for (const h of routes) for (const mode of MODES) {
    if (mode === "nav" && NAVSET && !NAVSET.has(h)) continue;
    S.app.ctx.rl.w?.clear?.();
    try {
      if (mode === "cold") { await p.goto("about:blank"); await p.goto(S.base + "/?nosw" + fill(h), { timeout: 20000 }); }
      else { await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(1200); await p.evaluate((h) => { window.__fsStart(); location.hash = h; }, fill(h)); }
      await p.waitForTimeout(WINDOW + 200);
      const st = await p.evaluate(() => ({ frames: window.__fs.frames, cls: window.__fs.cls }));
      const a = analyse(st, mode); res.push({ combo, mode, route: h, ...a }); fs.appendFileSync(OUT + ".jsonl", JSON.stringify({ combo, mode, route: h, ...a }) + "\n"); if (a.score >= 3) console.log(combo, mode, h.padEnd(28), "score", a.score, JSON.stringify(a.ex?.slice(0, 2)));
    } catch (e) {
      res.push({ combo, mode, route: h, err: e.message.split("\n")[0].slice(0, 120) });
      if (/closed|crash/i.test(e.message)) { try { await p.close(); } catch { /* */ } p = await ctx.newPage(); p.on("pageerror", (er) => errors.push(er.message.slice(0, 160))); }
    }
  }
  await ctx.close(); await S.close();
  return { res, errors: [...new Set(errors)].slice(0, 40) };
}
const all = { at: new Date().toISOString(), combos: COMBOS, rows: [], errors: {} };
for (const c of COMBOS) { const t = Date.now(); const { res, errors } = await runCombo(c); all.rows.push(...res); all.errors[c] = errors; console.log("== combo", c, "done", res.length, "rows", Math.round((Date.now() - t) / 1000) + "s"); fs.writeFileSync(OUT, JSON.stringify(all, null, 1)); }
const rank = all.rows.filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
console.log("\nTOP 40"); for (const r of rank.slice(0, 40)) console.log(String(r.score).padStart(6), r.combo.padEnd(11), r.mode.padEnd(5), r.route.padEnd(30), `rs${r.restyle} mv${r.moves} sw${r.swaps} ar${r.arMs} cls${r.cls} settle${r.settleMs}`);
