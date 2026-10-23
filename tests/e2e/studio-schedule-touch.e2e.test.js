/* v2.61 — creator studio: touch-first rescheduling of scheduled posts (calendar tab).
 * 390 touch: tap a scheduled chip → unified action sheet → «تغيير الموعد» → quick chips (بعد ساعة · الليلة 9م · غداً 9ص) and
 * native date + time pickers → PATCH /api/studio/schedule/:id; past times are refused in place; a tap on a busy day opens the
 * day list. 1440: HTML5 drag-to-day still reschedules, chips are keyboard-reachable (Enter opens, Escape closes + focus back).
 * axe (no serious/critical) at 390 light, 1440 dark, LTR (en); no horizontal overflow; no page errors, no native dialogs. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S; const errors = [];
const TZ = "Asia/Riyadh";
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const page = async (opts, who) => {
  const c = await S.browser.newContext({ ...opts, timezoneId: TZ, reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(who + ": " + e.message)); p.on("dialog", (d) => { errors.push(who + ": native dialog " + d.message()); d.dismiss().catch(() => {}); });
  return p;
};
const login = async (p) => { await p.goto(S.base + "/?nosw"); await p.fill("#a-handle", "sst_writer"); await p.fill("#a-pass", "secret1234"); await p.click("#a-go"); await p.waitForSelector(".bottomnav a[data-r=home]"); await p.waitForTimeout(400); const b = await p.$("#t-skip, #t-ok"); if (b) await b.click().catch(() => {}); };
async function axe(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png") }); } };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// a scheduled post 2 days ahead, 10:00 Riyadh (= 07:00 UTC)
const ahead = (days, h = 7) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); d.setUTCHours(h, 0, 0, 0); return d; };
let postA, postB, postC;
async function calendar(p, at) {
  await p.evaluate(() => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = "#/studio"; });
  await p.waitForSelector('[data-stab="calendar"]'); await p.click('[data-stab="calendar"]'); await p.waitForSelector(".cal-day");
  const want = at.toISOString().slice(0, 7), cur = new Date().toISOString().slice(0, 7);
  if (want !== cur) { await p.click("#cal-next"); await p.click('[data-stab="calendar"]').catch(() => {}); await p.waitForSelector(".cal-day"); }
}
const itemAt = async (p, id) => (await call(p, "GET", "/api/studio/calendar?month=" + new Date().toISOString().slice(0, 7))).items.concat((await call(p, "GET", "/api/studio/calendar?month=" + ahead(32).toISOString().slice(0, 7))).items).find((x) => x.id === id);

test.before(async () => {
  S = await startStack();
  const p = await page(DESKTOP, "setup"); await onboard(p, S.base, "sst_writer", "منشئة المحتوى");
  const mk = async (text, at) => { const r = await call(p, "POST", "/api/posts", { text, publishAt: at.toISOString() }); const post = r.post || r; assert.equal(post.status, "scheduled", JSON.stringify(r).slice(0, 200)); return post.id; };
  postA = await mk("منشور مجدول للهاتف", ahead(2)); postB = await mk("منشور مجدول للسحب", ahead(3)); postC = await mk("منشور ثالث لنفس اليوم", ahead(2, 9));
  await p.context().close();
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors, no native dialogs"); });
test.beforeEach(() => S.app.ctx.rl?.w?.clear?.());

test("390 touch: tap → action sheet → «تغيير الموعد» → chip «غداً 9ص» saves; manual date/time; past refused; day list", async () => {
  const m = await page(MOBILE, "390"); await login(m); await calendar(m, ahead(2));
  assert.ok(await m.evaluate(() => matchMedia("(pointer: coarse)").matches), "touch emulation");
  await m.tap(`.cal-item[data-item="${postA}"]`);
  await m.waitForSelector("#sheet:not(.hidden) .as.st-rs #rs-change"); await shot(m, "390-light-sheet");
  assert.equal(await m.evaluate(() => document.activeElement?.id), "rs-change", "focus moves into the sheet");
  await m.tap("#rs-change"); await m.waitForSelector("#rs-d");
  assert.equal(await m.getAttribute("#rs-d", "type"), "date"); assert.equal(await m.getAttribute("#rs-tm", "type"), "time");
  const sizes = await m.$$eval("#sheet .as-m, #rs-save, #rs-back, #rs-d, #rs-tm", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.ok(sizes.every((h) => h >= 44), "touch targets ≥44px: " + sizes);
  assert.equal((await m.$$("#sheet .as-m")).length, 3, "three quick chips");
  // past time is refused in place (no request)
  const today = await m.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await m.fill("#rs-d", today); await m.fill("#rs-tm", "00:00");
  assert.ok(await m.isDisabled("#rs-save")); assert.match(await m.textContent("#rs-err"), /المستقبل/);
  await shot(m, "390-light-picker");
  // quick chip: tomorrow 9:00 local
  await m.tap('#sheet .as-m[data-q="tomorrow"]');
  assert.equal(await m.getAttribute('#sheet .as-m[data-q="tomorrow"]', "aria-pressed"), "true"); assert.equal(await m.inputValue("#rs-tm"), "09:00");
  for (const v of await axe(m)) assert.fail("390 light picker " + v);
  assert.ok(await noOverflow(m), "no horizontal overflow at 390");
  await m.tap("#rs-save"); await m.waitForSelector("#sheet.hidden", { state: "attached" });
  const got = await itemAt(m, postA); const exp = await m.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); });
  assert.equal(new Date(got.at).toISOString(), exp, "rescheduled to tomorrow 09:00 (Riyadh)");
  // manual date + time
  await calendar(m, new Date(exp)); await m.tap(`.cal-item[data-item="${postA}"]`); await m.tap("#rs-change"); await m.waitForSelector("#rs-d");
  const d5 = await m.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  await m.fill("#rs-d", d5); await m.fill("#rs-tm", "18:30"); assert.ok(!(await m.isDisabled("#rs-save"))); assert.match(await m.textContent("#rs-prev"), /الموعد الجديد/);
  await m.tap("#rs-save"); await m.waitForSelector("#sheet.hidden", { state: "attached" });
  const got2 = await itemAt(m, postA); assert.equal(await m.evaluate((a) => { const d = new Date(a); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${d.getHours()}:${d.getMinutes()}`; }, got2.at), d5 + " 18:30");
  // a tap on a day that has posts opens its list (rows ≥ 48px) → row → action sheet
  await calendar(m, ahead(2)); const day = await m.evaluate((id) => document.querySelector(`.cal-item[data-item="${id}"]`)?.closest(".cal-day")?.dataset.day, postC);
  await m.tap(`.cal-day[data-day="${day}"] .cal-n`); await m.waitForSelector("#sheet:not(.hidden) .st-rs-row");
  const rh = await m.$$eval("#sheet .st-rs-row", (els) => els.map((e) => e.getBoundingClientRect().height)); assert.ok(rh.length >= 1 && rh.every((h) => h >= 48));
  await shot(m, "390-light-day"); for (const v of await axe(m)) assert.fail("390 light day list " + v);
  await m.tap(`#sheet [data-open="${postC}"]`); await m.waitForSelector("#rs-change"); await m.tap("#rs-x"); await m.waitForSelector("#sheet.hidden", { state: "attached" });
  // «انشر الآن» still publishes (kept)
  await m.tap(`.cal-item[data-item="${postC}"]`); await m.tap("#rs-now"); await m.waitForSelector("#sheet.hidden", { state: "attached" });
  assert.equal((await itemAt(m, postC))?.status, "published");
  for (const v of await axe(m)) assert.fail("390 light calendar " + v);
  await shot(m, "390-light-calendar"); await m.context().close();
});

test("1440 dark: HTML5 drag-to-day still reschedules; keyboard Enter opens the sheet, Escape closes and returns focus", async () => {
  const d = await page({ ...DESKTOP, colorScheme: "dark" }, "1440"); await login(d); await calendar(d, ahead(3));
  const before = new Date((await itemAt(d, postB)).at);
  const target = await d.evaluate((id) => { const cur = +document.querySelector(`.cal-item[data-item="${id}"]`).closest(".cal-day").dataset.day; const days = [...document.querySelectorAll(".cal-day")].map((x) => +x.dataset.day); return days.includes(cur + 1) ? cur + 1 : cur - 1; }, postB);
  // real mouse gesture (press → move in steps → release): Playwright's one-shot dragAndDrop can miss Chromium's drag threshold on small chips
  const src = d.locator(`.cal-item[data-item="${postB}"]`), dst = d.locator(`.cal-day[data-day="${target}"]`);
  // both the chip and the target day must be inside the viewport, or Chromium cancels the drag when the pointer leaves the window
  await d.evaluate(([a, b]) => { const r1 = document.querySelector(a).getBoundingClientRect(), r2 = document.querySelector(b).getBoundingClientRect(); scrollBy(0, (Math.min(r1.top, r2.top) + Math.max(r1.bottom, r2.bottom)) / 2 - innerHeight / 2); }, [`.cal-item[data-item="${postB}"]`, `.cal-day[data-day="${target}"]`]);
  await d.waitForTimeout(150); const sb = await src.boundingBox(), db = await dst.boundingBox();
  const vh = d.viewportSize().height; assert.ok(sb.y >= 0 && db.y + db.height <= vh, "chip and target day both on screen");
  await d.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await d.mouse.down();
  await d.mouse.move(sb.x + sb.width / 2 + 8, sb.y + sb.height / 2 + 4, { steps: 4 });
  await d.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 }); await d.mouse.up(); await d.waitForTimeout(700);
  const after = new Date((await itemAt(d, postB)).at);
  assert.equal(Math.round((after - before) / 864e5), target - (await d.evaluate((a) => new Date(a).getDate(), before.toISOString())), "moved by the dropped day, same time");
  assert.equal(after.getUTCHours(), before.getUTCHours());
  await calendar(d, after); await d.focus(`.cal-item[data-item="${postB}"]`); await d.keyboard.press("Enter");
  await d.waitForSelector("#sheet:not(.hidden) #rs-change"); await d.keyboard.press("Enter"); await d.waitForSelector("#rs-d");
  await shot(d, "1440-dark-picker"); for (const v of await axe(d)) assert.fail("1440 dark picker " + v);
  await d.keyboard.press("Escape"); await d.waitForSelector("#sheet.hidden", { state: "attached" });
  assert.equal(await d.evaluate(() => document.activeElement?.dataset?.item), postB, "focus returns to the chip");
  for (const v of await axe(d)) assert.fail("1440 dark calendar " + v);
  await shot(d, "1440-dark-calendar");
  // LTR (en)
  await d.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 }); await d.evaluate(() => window.MPI18n.setLang("en")); await d.waitForFunction(() => document.documentElement.dir === "ltr");
  await calendar(d, after); await d.click(`.cal-item[data-item="${postB}"]`); await d.waitForSelector("#rs-change");
  assert.match(await d.textContent("#rs-change"), /Reschedule/); await d.click("#rs-change"); await d.waitForSelector("#rs-d");
  assert.match(await d.textContent('#sheet .as-m[data-q="hour"]'), /In 1 hour/);
  // v2.67: every quick-time chip and the sheet chrome read English in the EN UI (no Arabic left, e.g. «بعد ساعة»)
  assert.match(await d.textContent('#sheet .as-m[data-q="tonight"]'), /Tonight 9 PM/); assert.match(await d.textContent('#sheet .as-m[data-q="tomorrow"]'), /Tomorrow 9 AM/);
  assert.deepEqual(await d.$$eval("#sheet .as-m", (els) => els.map((e) => e.textContent).filter((t) => /[\u0600-\u06FF]/.test(t))), [], "chips have no Arabic in EN");
  assert.match(await d.textContent("#rs-save"), /Save time/); assert.match(await d.textContent("#rs-q-l"), /Quick times/);
  await shot(d, "1440-ltr-picker"); for (const v of await axe(d)) assert.fail("LTR picker " + v);
  await d.evaluate(() => window.MPI18n?.setLang("ar")); await d.context().close();
});

test("360 LTR touch: picker fits, no overflow", async () => {
  const m = await page({ ...MOBILE, viewport: { width: 360, height: 760 } }, "360"); await login(m);
  await calendar(m, ahead(3)); await m.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await m.evaluate(() => window.MPI18n.setLang("en")); await m.waitForFunction(() => document.documentElement.dir === "ltr"); await calendar(m, ahead(3)); await m.tap(`.cal-item[data-item="${postB}"]`); await m.tap("#rs-change"); await m.waitForSelector("#rs-d");
  assert.ok(await noOverflow(m)); await shot(m, "360-ltr-picker"); for (const v of await axe(m)) assert.fail("360 LTR " + v);
  await m.evaluate(() => window.MPI18n?.setLang("ar")); await m.context().close();
});
