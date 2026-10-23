/* Phase 2 — accessibility (axe-core) and visual regression snapshots (pixelmatch). Update
 * baselines with UPDATE_SNAPSHOTS=1. */
const test = require("node:test"),
  assert = require("node:assert"),
  fs = require("node:fs"),
  path = require("node:path");
const { PNG } = require("pngjs");
const pixelmatch = require("pixelmatch");
const { startStack, onboard, MOBILE, DESKTOP, ROOT } = require("./harness");
let S, P;
const SNAP = path.join(ROOT, "tests", "visual", "baseline"),
  OUT = process.env.SHOTS_DIR || path.join(ROOT, "tests", "visual", "output"); // SHOTS_DIR: private output dir for parallel runs
test.before(async () => {
  S = await startStack();
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  P = await ctx.newPage();
  await onboard(P, S.base, "visual_user", "نورة");
});
test.after(() => S.close());

async function axe(page) {
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return page.evaluate(async () =>
    (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"], rules: { "color-contrast": { enabled: true } } })).violations.map(v => ({
      id: v.id,
      impact: v.impact,
      n: v.nodes.length
    }))
  );
}
test("accessibility: no serious/critical WCAG A/AA violations on key screens", async () => {
  const report = {};
  for (const r of ["#/home", "#/explore", "#/notifications", "#/settings", "#/security", "#/privacy", "#/orgs", "#/verify", "#/me", "#/menu", "#/jobs"]) { // v2.52: + the hub and a deep screen
    await P.goto(S.base + "/?nosw" + r);
    await P.waitForTimeout(500);
    report[r] = (await axe(P)).filter(v => ["serious", "critical"].includes(v.impact));
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "a11y.json"), JSON.stringify(report, null, 2));
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});

async function snap(name, page) {
  fs.mkdirSync(SNAP, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  await page.addStyleTag({ content: "#bt-fab,.time,.handle .time,[data-imp] .muted,#rail,.nf-toast{visibility:hidden!important} *{caret-color:transparent!important}" });
  const buf = await page.screenshot({ animations: "disabled" });
  const base = path.join(SNAP, name + ".png");
  if (!fs.existsSync(base) || process.env.UPDATE_SNAPSHOTS) {
    fs.writeFileSync(base, buf);
    return 0;
  }
  const a = PNG.sync.read(fs.readFileSync(base)),
    b = PNG.sync.read(buf);
  if (a.width !== b.width || a.height !== b.height) return 1;
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.15 });
  fs.writeFileSync(path.join(OUT, name + "-diff.png"), PNG.sync.write(diff));
  return n / (a.width * a.height);
}
test("visual: key screens match their baselines (≤1% pixels)", async () => {
  for (const [name, route, opts, lang] of [
    ["settings-mobile", "#/settings", MOBILE],
    ["security-mobile", "#/security", MOBILE],
    ["auth-desktop", "", DESKTOP],
    // v2.36 (D5): centred three-column shell at 1440 px, and the LTR (English) layout — LTR last: it saves the language
    ["settings-desktop", "#/settings", DESKTOP],
    ["settings-ltr-mobile", "#/settings", MOBILE, "en"]
  ]) {
    const ctx = await S.browser.newContext({ ...opts, reducedMotion: "reduce" });
    const pg = await ctx.newPage();
    if (route) {
      await pg.goto(S.base + "/?nosw");
      await pg.fill("#a-handle", "visual_user");
      await pg.fill("#a-pass", "secret1234");
      await pg.click("#a-go");
      await pg.waitForSelector(".bottomnav a[data-r=home]");
      if (lang) {
        await pg.waitForFunction(() => window.MPI18n);
        await pg.evaluate((L) => window.MPI18n.setLang(L), lang);
      }
      await pg.goto(S.base + "/?nosw" + route);
    } else await pg.goto(S.base + "/?nosw");
    // v2.61: wait for the screen's data (no skeletons left) instead of a fixed sleep only — under load #/security was sometimes
    // captured while its cards were still skeletons (a 7% false diff); same readiness rule as the cadmin suites.
    if (route) await pg.waitForFunction(() => !!document.querySelector("#view .page-head h2") && !document.querySelector("#view .skel"), null, { timeout: 15000 });
    await pg.waitForTimeout(700);
    const ratio = await snap(name, pg);
    assert.ok(ratio <= 0.01, `${name} differs by ${(ratio * 100).toFixed(2)}%`);
    await ctx.close();
  }
});
