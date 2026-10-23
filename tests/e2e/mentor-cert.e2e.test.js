/* M5-1/F11 «مطوّر شهادة الإتمام» — mentorship completion certificate end to end.
 * Mentor (390 light AR): #/mentor-certs lists a mentee with a completed session → issue (title + note) → lands on #/cert/<code>
 * with the mentorship wording + print button. Mentee (second context): sees it in #/certificates and opens it. Visitor:
 * /cert/<code> verifies (minimal, no contact) and /api/certificates/verify/<code> is valid. EN 1440 dark (LTR) + UR: translated,
 * axe 0 serious/critical, no horizontal overflow. Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, c, p, CODE; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.status; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(300); };
const setLang = async (pg, L) => { await pg.evaluate((x) => window.MPI18n.setLang(x), L); await pg.waitForFunction((x) => document.documentElement.dir === (x === "ar" ? "rtl" : "ltr"), L); };

test.before(async () => {
  S = await startStack();
  c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "mc_mentor", "سارة القحطاني");
  assert.ok((await call(p, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة عشر سنوات في JavaScript", topics: ["programming"], minutes: 60, price: 0, tz: "Asia/Riyadh", open: true })) < 300);
  S.app.ctx.rl?.w?.clear?.();
  const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base };
  assert.equal((await fetch(S.base + "/api/auth/register", { method: "POST", headers: H, body: JSON.stringify({ name: "فهد الدوسري", handle: "mc_learner", password: "secret123" }) })).status, 200);
  const db = S.app.ctx.db, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const m = await db.get("SELECT id FROM users WHERE handle=$1", ["mc_mentor"]), l = await db.get("SELECT id FROM users WHERE handle=$1", ["mc_learner"]);
  await db.run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at,completed_at) VALUES($1,$2,$3,NULL,'programming','',$4,60,'completed',0,0,'none',0,$4,$4,$5)", ["mss_mc_done", m.id, l.id, iso(now - 3 * 86400e3), iso(now - 3 * 86400e3 + 3600e3)]);
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
});
test.after(async () => { await c?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("AR 390 light: mentor issues from #/mentor-certs → #/cert/<code>", async () => {
  await setLang(p, "ar");
  await go(p, "#/mentor-certs", "#ex-mc details[data-m]");
  assert.match(await p.textContent("#ex-mc"), /فهد الدوسري/);
  assert.ok(await noOverflow(p), "overflow list"); assert.deepEqual(await axe(p), [], "axe list");
  await p.click("#ex-mc details[data-m] summary");
  await p.fill("#ex-mc details[data-m] [name=title]", "برنامج إرشاد تطوير الويب");
  await p.fill("#ex-mc details[data-m] [name=note]", "ملتزم ومبادر في كل جلسة");
  assert.match(await p.textContent("#ex-mc .ex-cnt2"), /24|٢٤/);
  assert.deepEqual(await axe(p), [], "axe form");
  await shot(p, "390-light-ar-mentor-certs-form");
  await p.click("#ex-mc details[data-m] button[type=submit]");
  await p.waitForFunction(() => /^#\/cert\/MP-/.test(location.hash), null, { timeout: 15000 });
  await p.waitForSelector(".ex-cert .who");
  CODE = decodeURIComponent((await p.evaluate(() => location.hash)).split("/")[2]);
  const t = await p.textContent(".ex-cert");
  assert.match(t, /شهادة إتمام إرشاد/); assert.match(t, /سارة القحطاني/); assert.match(t, /فهد الدوسري/); assert.match(t, /برنامج إرشاد تطوير الويب/); assert.match(t, /ملتزم ومبادر/);
  assert.ok(await p.$("#ex-print")); assert.ok(await noOverflow(p)); assert.deepEqual(await axe(p), [], "axe cert 390");
  await shot(p, "390-light-ar-cert");
  await go(p, "#/mentor-certs", "#ex-mc .ex-cc");
  assert.match(await p.textContent("#ex-mc"), /منحت كل متدرّبيك شهاداتهم/);
  await shot(p, "390-light-ar-mentor-certs-issued");
});

test("mentee sees it in #/certificates; visitor verifies by code (minimal)", async () => {
  const c2 = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  const q = await c2.newPage(); q.on("pageerror", (e) => errors.push(e.message));
  await q.goto(S.base + "/");
  const st = await q.evaluate(async () => (await fetch("/api/auth/login", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ handle: "mc_learner", password: "secret123" }) })).status);
  assert.equal(st, 200);
  const mine = await q.evaluate(async () => (await (await fetch("/api/certificates", { headers: { "X-Requested-With": "mujtama" } })).json()));
  const mc = mine.certificates.find((x) => x.kind === "mentorship"); assert.ok(mc); assert.equal(mc.code, CODE);
  await c2.close();
  const v = await (await fetch(S.base + "/api/certificates/verify/" + CODE)).json();
  assert.equal(v.valid, true); assert.equal(v.certificate.holder, "فهد الدوسري"); assert.equal(v.mine, false);
  assert.ok(!/mc_learner|mc_mentor|secret|phone|email/.test(JSON.stringify(v.certificate)));
  const v2 = await c.newPage(); await v2.goto(S.base + "/cert/" + CODE);
  assert.match(await v2.textContent("body"), /إتمام إرشاد/); assert.match(await v2.textContent(".st"), /شهادة صحيحة/);
  await shot(v2, "390-light-ar-public-verify"); await v2.close();
});

test("EN 1440 dark (LTR) + UR: translated, axe 0, no overflow", async () => {
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await setLang(p, "en");
  await go(p, "#/mentor-certs", "#ex-mc .ex-cc");
  assert.match(await p.textContent("#view, body"), /Certificates you issued/);
  assert.ok(await noOverflow(p)); assert.deepEqual(await axe(p), [], "axe 1440 dark en list");
  await shot(p, "1440-dark-en-mentor-certs");
  await go(p, "#/cert/" + CODE, ".ex-cert .who");
  assert.match(await p.textContent(".ex-cert"), /Mentoring completion certificate/);
  assert.ok(await noOverflow(p)); assert.deepEqual(await axe(p), [], "axe 1440 dark en cert");
  await shot(p, "1440-dark-en-cert");
  await setLang(p, "ar"); await go(p, "#/mentor-certs", "#ex-mc .ex-cc"); // v2.67: ar + en only — the RTL pass runs in Arabic
  assert.match(await p.textContent("body"), /شهادات أصدرتها/); assert.deepEqual(await axe(p), [], "axe ar rtl");
  await shot(p, "1440-dark-ar-mentor-certs");
  await setLang(p, "ar");
});
