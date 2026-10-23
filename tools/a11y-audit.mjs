/* Periodic accessibility audit (phase 43): axe-core (WCAG 2 A/AA) over the key screens of the production build, in normal
 * mode and with high contrast + dyslexia mode on, using the e2e harness (real server, SQLite, headless Chromium).
 *   npm run build && node tools/a11y-audit.mjs            → tests/visual/output/a11y-audit.json, exit 1 on serious/critical
 * The JSON `report` field is exactly the body of POST /api/admin/a11y/audits, so staff can record a CI run in the app.
 * Scheduled weekly by .github/workflows/a11y-audit.yml (artifact only: no secrets, no network writes). */
/* global window, document */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { startStack, onboard, MOBILE, ROOT } = require("../tests/e2e/harness.js");

const ROUTES = (process.env.A11Y_ROUTES || "#/home,#/explore,#/notifications,#/settings,#/settings/display,#/me,#/search,#/communities").split(",");
const MODES = { normal: {}, "contrast+dyslexia": { contrast: "high", dyslexia: true, spacing: "wide", fontScale: 1.25 } };
const S = await startStack();
const out = { at: new Date().toISOString(), pages: [] };
let serious = 0;
try {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await onboard(p, S.base, "a11y_audit", "مدقق الوصول");
  for (const [mode, prefs] of Object.entries(MODES)) {
    await p.goto(S.base + "/?nosw#/home");
    await p.waitForFunction(() => window.MPA11y, null, { timeout: 15000 });
    await p.evaluate(x => window.MPA11y.apply(x), prefs);
    for (const r of ROUTES) {
      await p.goto(S.base + "/?nosw" + r);
      await p.waitForTimeout(600);
      await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const v = await p.evaluate(async () =>
        (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(x => ({ id: x.id, impact: x.impact, n: x.nodes.length }))
      );
      const bad = v.filter(x => ["serious", "critical"].includes(x.impact));
      serious += bad.length;
      out.pages.push({
        route: `${r} [${mode}]`,
        violations: v.reduce((s, x) => s + x.n, 0),
        serious: bad.length,
        rules: [...new Set(v.map(x => x.id))],
        detail: v
      });
      console.log(`${bad.length ? "✗" : "✓"} ${r.padEnd(20)} ${mode.padEnd(18)} ${v.map(x => `${x.id}(${x.impact}×${x.n})`).join(" ") || "clean"}`);
    }
  }
  await ctx.close();
} finally {
  await S.close();
}
out.report = {
  release: process.env.GITHUB_SHA?.slice(0, 12) || null,
  pages: out.pages.map(({ route, violations, rules }) => ({ route: route.slice(0, 100), violations, rules }))
};
const dir = path.join(ROOT, "tests", "visual", "output");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "a11y-audit.json"), JSON.stringify(out, null, 2));
console.log(`${serious ? "✗" : "✓"} ${serious} serious/critical rule violation(s) across ${out.pages.length} page checks`);
process.exit(serious ? 1 : 0);
