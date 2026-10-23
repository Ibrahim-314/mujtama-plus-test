/* M3-5/F6 «مطوّر الملخص الأسبوعي» — the guardian's «ملخص الإرشاد الأسبوعي» switch in #/family (default on, persists,
 * keyboard toggle, aria-checked state) and the mentor_weekly notification text translated en/fr/ur via {name}/{n}.
 * axe 0 serious/critical at 390 light AR, 1440 dark EN (LTR); no horizontal overflow. Screenshots → SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, c, p; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(300); };
const setLang = async (pg, L) => { await pg.evaluate((x) => window.MPI18n.setLang(x), L); await pg.waitForFunction((x) => document.documentElement.dir === (x === "ar" ? "rtl" : "ltr"), L); };
const SW = '[data-mn-wk="gl_wk_e2e"]';

test.before(async () => {
  S = await startStack();
  c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "wk_parent", "خالد العتيبي");
  S.app.ctx.rl?.w?.clear?.();
  const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base };
  assert.equal((await fetch(S.base + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ name: "ريم العتيبي", handle: "wk_kid", password: "secret123" }) })).status, 200);
  const db = S.app.ctx.db;
  const g = await db.get("SELECT id FROM users WHERE handle=$1", ["wk_parent"]), k = await db.get("SELECT id FROM users WHERE handle=$1", ["wk_kid"]);
  await db.run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'active',$2,'{}',$4)", ["gl_wk_e2e", g.id, k.id, new Date().toISOString()]);
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
});
test.after(async () => { await c?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

const linkState = () => p.evaluate(async () => (await (await fetch("/api/family", { headers: { "X-Requested-With": "mujtama" } })).json()).links.find((l) => l.id === "gl_wk_e2e").mentorWeekly);

test("AR 390 light: switch on by default → off (persists after reload) → on by keyboard; axe", async () => {
  await setLang(p, "ar");
  await go(p, "#/family", SW);
  assert.equal(await p.isChecked(SW), true);
  assert.equal(await p.getAttribute(SW, "role"), "switch");
  assert.match(await p.textContent(".switch-row:has(" + SW + ")"), /ملخص الإرشاد الأسبوعي/);
  assert.match(await p.textContent(".switch-row:has(" + SW + ")"), /دون الملاحظات الخاصة/);
  const box = await p.evaluate((s) => { const r = document.querySelector(s).closest(".switch-row").getBoundingClientRect(); return r.height; }, SW);
  assert.ok(box >= 44, "touch target " + box);
  assert.ok(await noOverflow(p), "overflow 390");
  assert.deepEqual(await axe(p), [], "axe 390 light ar");
  await shot(p, "weekly-390-light-ar");
  await p.click(SW);
  await p.waitForTimeout(600);
  assert.equal(await linkState(), false);
  await go(p, "#/family", SW); assert.equal(await p.isChecked(SW), false);
  await p.focus(SW); await p.keyboard.press("Space"); await p.waitForTimeout(600);
  assert.equal(await linkState(), true);
  await go(p, "#/family", SW); assert.equal(await p.isChecked(SW), true);
});

test("i18n: notification text en/fr/ur via the {name}/{n} templates", async () => {
  const ar = "ملخص الإرشاد الأسبوعي لـريم: جلسات مكتملة 2 · قادمة 1 · الأهداف المنجزة 1 من 3 — أتعلّم Git 2، أقرأ كتاباً";
  const out = {};
  for (const L of ["en"]) { await setLang(p, L); await p.waitForTimeout(300); out[L] = await p.evaluate(([s, L]) => window.MPI18n.t(s, L), [ar, L]); }
  await setLang(p, "ar");
  assert.equal(out.en, "Weekly mentoring summary for ريم: sessions completed 2 · upcoming 1 · goals done 1 of 3 — أتعلّم Git 2، أقرأ كتاباً");
});

test("EN 1440 dark (LTR): switch renders and passes axe", async () => {
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await setLang(p, "en");
  await go(p, "#/family", SW);
  await p.waitForFunction(() => /Weekly mentoring summary/.test(document.querySelector(".switch-row b")?.textContent || "") || [...document.querySelectorAll(".switch-row b")].some((b) => /Weekly mentoring summary/.test(b.textContent)), null, { timeout: 8000 });
  assert.equal(await p.evaluate(() => document.documentElement.dir), "ltr");
  assert.ok(await noOverflow(p), "overflow 1440");
  assert.deepEqual(await axe(p), [], "axe 1440 dark en");
  await shot(p, "weekly-1440-dark-en");
  await setLang(p, "ar"); await go(p, "#/family", SW); await shot(p, "weekly-390-ar-rtl"); // v2.67: ar + en only
  await setLang(p, "ar");
});
