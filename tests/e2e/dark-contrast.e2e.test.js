/* v2.145.5: dark-mode contrast of selected chips and danger text. The deep sweep (axe color-contrast) found white text on the
 * dark accent #9a7bff (3.15:1) for the selected filter chip in the help centre (#/faq), the staff tickets filter (#/staff) and the
 * search region chips; red #d42f3f sign-out / unsubscribe text on the dark card (3.67 / 4.01); and accent-ink text on the white
 * analytics hero button (2.13). They now use the theme's own dark tokens (--chip-on-bg/--chip-on-fg, --danger-ink). Light mode is
 * unchanged (the tokens resolve to the old values there). Check: WCAG ratio >= 4.5 in dark, and the light values unchanged. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });

function ratio(fg, bg) {
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05);
}
// effective background: first non-transparent background up the tree
const read = (sel) => { const e = document.querySelector(sel); if (!e) return null; let n = e, bg = "rgba(0, 0, 0, 0)"; while (n && n.nodeType === 1) { const b = getComputedStyle(n).backgroundColor; if (!/rgba\(.*, 0\)$/.test(b) && b !== "transparent") { bg = b; break; } n = n.parentElement; } return { fg: getComputedStyle(e).color, bg }; };
const CASES = [["#/faq", "#view .lc-chips button[aria-pressed=true]"], ["#/settings", "#logout .t b"], ["#/emailprefs", "#ep-all"]];

for (const scheme of ["dark", "light"]) {
  test(`${scheme}: selected chips and danger text reach 4.5:1`, async () => {
    const ctx = await S.browser.newContext({ ...MOBILE, colorScheme: scheme }); const p = await ctx.newPage();
    await onboard(p, S.base, "contrast_" + scheme, "فحص التباين");
    // v2.145.6: light #ep-all was 4.49:1 and is now covered too
    for (const [h, sel] of CASES) {
      await p.evaluate((h) => { location.hash = h; }, h);
      await p.waitForSelector(sel, { timeout: 15000 });
      const c = await p.evaluate(read, sel);
      const r = ratio(c.fg, c.bg);
      assert.ok(r >= 4.5, `${scheme} ${h} ${sel}: ${c.fg} on ${c.bg} = ${r.toFixed(2)}`);
    }
    await ctx.close();
  });
}
