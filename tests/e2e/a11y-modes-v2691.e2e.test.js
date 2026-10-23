/* v2.69.1 — text must stay readable in every display mode (normal, dark, dyslexia, high contrast, large text + wide spacing).
 * For each visible text run we take its colour and the first opaque background behind it (walking up the tree) and fail
 * when the two are nearly the same (contrast < 2:1 → text effectively invisible, like white text on a cream paragraph).
 * Text over a gradient passes when it is readable against at least one opaque colour stop; text over images is skipped.
 *   A11Y_MODES_ROUTES=/path/routes.json  → scan a custom route list (JSON array); A11Y_MODES_OUT=file → write findings. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
const fs = require("fs");
const ROUTES = process.env.A11Y_MODES_ROUTES ? JSON.parse(fs.readFileSync(process.env.A11Y_MODES_ROUTES, "utf8"))
  : ["#/home", "#/mjt", "#/wallet", "#/menu", "#/settings", "#/settings/display", "#/me", "#/communities", "#/explore", "#/notifications", "#/studio", "#/jobs", "#/help", "#/security"];
const MODES = {
  normal: [{}, "light"],
  dark: [{}, "dark"],
  dyslexia: [{ dyslexia: true }, "light"],
  "dyslexia-dark": [{ dyslexia: true }, "dark"],
  contrast: [{ contrast: "high" }, "light"],
  "contrast-dark": [{ contrast: "high" }, "dark"],
  "large+wide": [{ fontScale: 1.5, spacing: "wider" }, "light"],
};
const scan = (p) => p.evaluate(() => {
  const parse = (c) => {
    const k = c && c.match(/color\(srgb ([^)]+)\)/); if (k) { const v = k[1].split(/[ /]+/).filter(Boolean).map(Number); return { r: v[0] * 255, g: v[1] * 255, b: v[2] * 255, a: v.length > 3 ? v[3] : 1 }; }
    const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05); };
  const bgOf = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none") {
        if (/url\(/.test(cs.backgroundImage)) return null;
        const stops = (cs.backgroundImage.match(/(?:rgba?|color)\([^)]+\)/g) || []).map(parse).filter((g) => g && g.a > 0.5);
        if (stops.length) return stops;
        if (/gradient/.test(cs.backgroundImage)) return null;
      }
      const c = parse(cs.backgroundColor); if (c && c.a > 0.85) return [c];
    }
    return [parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }];
  };
  const out = [];
  for (const root of document.querySelectorAll("#view,.topbar,.bottomnav")) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const t = n.nodeValue.trim(); if (t.length < 2) continue;
      const el = n.parentElement; if (!el || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity < 0.2 || el.closest("[aria-hidden=true],.sr-only,.visually-hidden,img,video,canvas,.skel")) continue;
      const fg = parse(cs.color), bg = bgOf(el); if (!fg || !bg || !bg.length || fg.a < 0.3) continue;
      const r = Math.max(...bg.map((b) => ratio(fg, b))); if (r < 2) out.push({ t: t.slice(0, 60), r: +r.toFixed(2), sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "") });
    }
  }
  return out;
});
let S; const errors = [];
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });
test("390: text stays readable in every display mode", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "modes_scan", "فاحص الأوضاع");
  await p.waitForFunction(() => window.MPA11y, null, { timeout: 15000 });
  const bad = {};
  for (const [mode, [prefs, scheme]] of Object.entries(MODES)) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.evaluate(([x, s]) => { document.documentElement.dataset.theme = s; window.MPA11y.apply({ fontScale: 1, contrast: "normal", dyslexia: false, spacing: "normal", ...x }, false); }, [prefs, scheme]);
    for (const r of ROUTES) {
      await p.evaluate((r) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = r; }, r);
      await p.waitForTimeout(700);
      const f = await scan(p); if (f.length) bad[`${r} [${mode}]`] = f.slice(0, 8);
    }
  }
  await p.evaluate(() => window.MPA11y.apply({ fontScale: 1, contrast: "normal", dyslexia: false, spacing: "normal" }, false));
  if (process.env.A11Y_MODES_OUT) fs.writeFileSync(process.env.A11Y_MODES_OUT, JSON.stringify(bad, null, 1));
  await c.close();
  assert.deepEqual(bad, {}, "unreadable text: " + JSON.stringify(bad).slice(0, 3000));
});
