/* v2.62 mentorship «مترجم صفحات الإرشاد المتبقية» — #/msession/:id and #/admin/mentors in en/fr/ur.
 * Sessions (confirmed with a booking note, completed awaiting feedback, cancelled paid with a refund due) are seeded in the DB;
 * the mentor is the first account (→ admin) so it sees both pages.
 * • English LTR at 360 / 390 light and 1440 dark: no Arabic UI text left outside user content (bdi / data-noi18n / form fields),
 *   no horizontal scroll, axe 0 serious/critical.
 * • User text sits in <bdi dir=auto data-noi18n>; text inputs carry dir=auto. fr / ur spot checks; Arabic source intact.
 * Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, c, p; const errors = []; const sid = {};
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.status; }, [m, u, b]);
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const routes = () => ({ upcoming: ["#/msession/" + sid.up, ".mt-who"], done: ["#/msession/" + sid.done, "#mt-fb"], refund: ["#/msession/" + sid.cx, ".mt-who"], admin: ["#/admin/mentors", ".f-kpis"] });
const open = async (k) => {
  const [h, sel] = routes()[k];
  await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(120);
  await p.evaluate((x) => { location.hash = x; }, h);
  await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(350);
};
const arabicLeft = () => p.evaluate(() => {
  const root = document.querySelector(".wrap.mt-page"), out = [], AR = /[\u0600-\u06FF]/;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,[data-noi18n],textarea,select,.help-pop,.helpi")) continue; out.push(n.nodeValue.trim()); }
  for (const el of root.querySelectorAll("[placeholder],[aria-label]")) for (const a of ["placeholder", "aria-label"]) { const v = el.getAttribute(a); if (v && AR.test(v) && !el.closest("[data-noi18n]")) out.push(a + "=" + v); }
  return out;
});
const setLang = async (L) => { await p.evaluate((x) => window.MPI18n.setLang(x), L); await p.waitForFunction((x) => document.documentElement.dir === (x === "ar" ? "rtl" : "ltr"), L); };

test.before(async () => {
  S = await startStack();
  c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "mir_mentor", "سارة القحطاني"); // first account → admin
  assert.ok((await call(p, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة عشر سنوات في JavaScript", bio: "أساعد المبتدئين.", topics: ["programming", "career"], languages: "العربية، English", minutes: 60, price: 0, tz: "Asia/Riyadh", allowMinors: false, open: true })) < 300);
  const db = S.app.ctx.db, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base };
  S.app.ctx.rl?.w?.clear?.();
  const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ name: "فهد الدوسري", handle: "mir_learner", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const m = await db.get("SELECT id FROM users WHERE handle=$1", ["mir_mentor"]), l = await db.get("SELECT id FROM users WHERE handle=$1", ["mir_learner"]);
  const ins = (id, st, status, extra = {}) => db.run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,$4,$5,$6,60,$7,$8,0,$9,0,$10,$10)",
    [id, m.id, l.id, "programming", extra.note || "", iso(st), status, extra.price || 0, extra.pay || "none", iso(now)]);
  sid.up = "mss_mir_up"; sid.done = "mss_mir_done"; sid.cx = "mss_mir_cx";
  await ins(sid.up, now + 2 * 86400e3, "confirmed", { note: "أريد مراجعة مشروعي الأول في React" });
  await ins(sid.done, now - 2 * 86400e3, "completed");
  await db.run("UPDATE mentor_sessions SET completed_at=$1 WHERE id=$2", [iso(now - 2 * 86400e3 + 3600e3), sid.done]);
  await ins(sid.cx, now + 3 * 86400e3, "cancelled", { price: 5, pay: "refund_due" });
  await db.run("UPDATE mentor_sessions SET cancel_reason=$1, cancelled_by=$2 WHERE id=$3", ["ظرف طارئ", m.id, sid.cx]);
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
});
test.after(async () => { await c?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("EN 390 light + 360: translated, no overflow, axe 0 serious/critical, user text isolated", async () => {
  await setLang("en");
  for (const k of Object.keys(routes())) {
    await open(k);
    assert.deepEqual(await arabicLeft(), [], k + " Arabic UI text left in en");
    assert.ok(await noOverflow(), k + " overflow at 390");
    assert.deepEqual(await axe(p), [], k + " axe 390 en");
    await shot(`390-light-en-${k}`);
  }
  await open("upcoming");
  assert.match(await p.textContent(".mt-page .page-head h2"), /Mentoring session: Programming & development/);
  assert.match(await p.textContent(".mt-page .page-head .back"), /Mentor dashboard/);
  assert.ok(await p.$('.mt-who bdi[dir=auto][data-noi18n]'), "names isolated");
  assert.ok(await p.$('.mt-quote[dir=auto][data-noi18n]'), "booking note isolated");
  for (const sel of ["#mt-nf textarea", "#mt-cf [name=reason]"]) assert.equal(await p.getAttribute(sel, "dir"), "auto", sel);
  await open("done"); assert.equal(await p.getAttribute("#mt-fb textarea", "dir"), "auto");
  await open("refund"); assert.match(await p.textContent(".notice.warn"), /Cancelled by the mentor:/);
  await open("admin"); assert.match(await p.textContent(".mt-page .page-head h2"), /Mentorship — Admin/);
  assert.match(await p.textContent("#mt-a"), /Refund due/);
  await p.setViewportSize({ width: 360, height: 780 });
  for (const k of Object.keys(routes())) { await open(k); assert.ok(await noOverflow(), k + " overflow at 360"); }
  await shot("360-light-en-admin"); await open("upcoming"); await shot("360-light-en-upcoming");
});

test("EN 1440 dark: axe 0 serious/critical, no overflow, translated", async () => {
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  for (const k of Object.keys(routes())) {
    await open(k);
    assert.deepEqual(await arabicLeft(), [], k + " Arabic UI text left in en (1440)");
    assert.ok(await noOverflow(), k + " overflow at 1440");
    assert.deepEqual(await axe(p), [], k + " axe 1440 dark en");
    await shot(`1440-dark-en-${k}`);
  }
});

test("en admin + Arabic RTL spot checks, then Arabic source intact (v2.67: ar + en only)", async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await setLang("en"); await open("admin");
  assert.match(await p.textContent(".mt-page .page-head h2"), /Mentorship — Admin/);
  assert.deepEqual(await arabicLeft(), [], "en admin");
  await setLang("ar"); await open("upcoming");
  assert.match(await p.textContent(".mt-page"), /إلغاء الجلسة/);
  await shot("390-dark-ar-upcoming");
  await setLang("ar"); await open("upcoming");
  assert.match(await p.textContent(".mt-page .page-head h2"), /جلسة إرشاد:/);
  assert.match(await p.textContent(".mt-page"), /إلغاء الجلسة/);
});
