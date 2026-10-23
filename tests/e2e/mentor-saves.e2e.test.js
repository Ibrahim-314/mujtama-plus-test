/* M4-3 «مطوّر حفظ المرشدين وتنبيه المواعيد» — «حفظ» on #/mentor/:handle and on directory cards (aria-pressed), the
 * «المرشدون المحفوظون» list in #/mentoring with its bell toggle, and unsave from the list. Learner at 390 light AR (RTL),
 * then 1440 dark EN (LTR); axe 0 serious/critical; no overflow; 44px targets. Screenshots → SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, cm, cl, pm, pl; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(300); };
const setLang = async (pg, L) => { await pg.evaluate((x) => window.MPI18n.setLang(x), L); await pg.waitForFunction((x) => document.documentElement.dir === (x === "ar" ? "rtl" : "ltr"), L); };
const size = (pg, sel) => pg.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); });

test.before(async () => {
  S = await startStack();
  cm = await S.browser.newContext({ ...DESKTOP, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  cl = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  pm = await cm.newPage(); pl = await cl.newPage();
  for (const pg of [pm, pl]) pg.on("pageerror", (e) => errors.push(e.message));
  await onboard(pm, S.base, "sv_mentor", "سارة المرشدة");
  assert.ok((await call(pm, "PUT", "/api/mentor/me", { headline: "مرشدة خبيرة في البرمجة والمسار المهني", topics: ["programming"], minutes: 60, price: 0, tz: "Asia/Riyadh", open: true })).status < 300);
  assert.ok((await call(pm, "PUT", "/api/mentor/me/slots", { slots: [{ weekday: 1, start: "18:00", end: "20:00" }] })).status < 300);
  await onboard(pl, S.base, "sv_learner", "متعلّم الحفظ");
  await pl.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
});
test.after(async () => { await cm?.close(); await cl?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("AR 390 light: save on profile → listed in #/mentoring → bell off → unsave; card reflects state; axe", async () => {
  await setLang(pl, "ar");
  await go(pl, "#/mentor/sv_mentor", ".mt-saverow [data-msave]");
  const B = ".mt-saverow [data-msave]";
  assert.equal(await pl.getAttribute(B, "aria-pressed"), "false");
  assert.ok((await size(pl, B)) >= 44, "save 44px");
  await pl.click(B); await pl.waitForFunction((s) => document.querySelector(s)?.getAttribute("aria-pressed") === "true", B);
  assert.ok(await noOverflow(pl)); assert.deepEqual(await axe(pl), [], "axe profile 390");
  await shot(pl, "saves-profile-390-light-ar");
  // directory card shows it saved
  await go(pl, "#/mentors", ".mt-save-c");
  assert.equal(await pl.getAttribute(".mt-save-c", "aria-pressed"), "true");
  assert.ok((await size(pl, ".mt-save-c")) >= 44, "card save 44px");
  assert.ok(await noOverflow(pl)); assert.deepEqual(await axe(pl), [], "axe directory 390");
  await shot(pl, "saves-directory-390-light-ar");
  // list in #/mentoring
  await go(pl, "#/mentoring", "#mt-saved [data-bell]");
  assert.match(await pl.textContent("#mt-saved"), /المرشدون المحفوظون/);
  assert.match(await pl.textContent("#mt-saved"), /سارة المرشدة/);
  assert.equal(await pl.getAttribute("#mt-saved [data-bell]", "aria-pressed"), "true");
  assert.ok((await size(pl, "#mt-saved [data-bell]")) >= 44);
  await pl.focus("#mt-saved [data-bell]"); await pl.keyboard.press("Enter");
  await pl.waitForFunction(() => document.querySelector("#mt-saved [data-bell]")?.getAttribute("aria-pressed") === "false");
  assert.equal((await call(pl, "GET", "/api/mentor/saved")).body.saved[0].notifySlots, false);
  assert.ok(await noOverflow(pl)); assert.deepEqual(await axe(pl), [], "axe saved list 390");
  await shot(pl, "saves-list-390-light-ar");
  await pl.click("#mt-saved [data-msave]");
  await pl.waitForFunction(() => /لا مرشدين محفوظين/.test(document.querySelector("#mt-saved")?.textContent || ""));
  assert.deepEqual((await call(pl, "GET", "/api/mentor/saved")).body.saved, []);
  await go(pl, "#/mentor/sv_mentor", B); assert.equal(await pl.getAttribute(B, "aria-pressed"), "false");
});

test("EN 1440 dark (LTR): save from a card, list translated, axe", async () => {
  await pl.setViewportSize({ width: 1440, height: 900 });
  await pl.emulateMedia({ colorScheme: "dark" }); await pl.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await setLang(pl, "en");
  await go(pl, "#/mentors", ".mt-save-c");
  await pl.click(".mt-save-c"); await pl.waitForFunction(() => document.querySelector(".mt-save-c")?.getAttribute("aria-pressed") === "true");
  assert.ok(await noOverflow(pl)); assert.deepEqual(await axe(pl), [], "axe directory 1440 dark en");
  await shot(pl, "saves-directory-1440-dark-en");
  await go(pl, "#/mentoring", "#mt-saved [data-bell]");
  await pl.waitForFunction(() => /Saved mentors/.test(document.querySelector("#mt-saved-h")?.textContent || ""), null, { timeout: 8000 });
  assert.equal(await pl.evaluate(() => document.documentElement.dir), "ltr");
  assert.ok(await noOverflow(pl)); assert.deepEqual(await axe(pl), [], "axe list 1440 dark en");
  await shot(pl, "saves-list-1440-dark-en");
  const t = await pl.evaluate(() => ["فتح {name} مواعيد إرشاد جديدة", "فتح مرشد حفظته مواعيد جديدة"].map((s) => window.MPI18n.t(s.replace("{name}", "سارة"), "en")));
  assert.deepEqual(t, ["سارة opened new mentoring times", "A mentor you saved opened new times"]);
  await setLang(pl, "en"); await go(pl, "#/mentor/sv_mentor", ".mt-saverow [data-msave]"); await shot(pl, "saves-profile-1440-dark-en"); // v2.67: ar + en only
  await setLang(pl, "ar");
});
