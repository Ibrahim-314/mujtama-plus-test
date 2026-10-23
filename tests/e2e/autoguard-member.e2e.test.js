/* v2.62 T9 «الحارس التلقائي» — the member side in a real browser: strip «تحذير 1 من 3» with a mute countdown, the lock text
 * + appeal link, the composer's blocked state, the live warning before submit, the draft kept on a server rejection,
 * the staff guard line + lift in the member sheet. axe 0 serious/critical (390 light, 1440 dark, LTR), no overflow at 360. */
const test = require("node:test"), assert = require("node:assert");
const path = require("node:path"), fs = require("node:fs");
const { startStack, tourDone, MOBILE, DESKTOP } = require("./harness");
const AR = require("../../server/lib/automod-rules");
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "..", "visual", "output");
let S, cid, O, U, uid; const errors = [];
const reg = async (handle, name) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name, handle, password: "secret1234" }) }); const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; "); await tourDone(S.base, ck); return ck; };
const api = (ck) => async (m, p, b) => { S.app.ctx.rl.w?.clear?.(); const r = await fetch(S.base + p, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); j._status = r.status; return j; };
const page = async (ck, opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); await c.addCookies(ck.split("; ").map((kv) => { const [name, ...v] = kv.split("="); return { name, value: v.join("="), url: S.base }; })); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message)); await p.goto(S.base + "/?nosw"); await p.waitForFunction(() => window.DB && typeof save === "function", null, { timeout: 20000 }); await p.evaluate(() => { DB.onboarded = true; save(); location.hash = "#/home"; route(); }); await p.waitForSelector(".bottomnav a[data-r=home]", { state: "visible", timeout: 20000 }); return p; };
const shot = async (p, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); };
const open = async (p) => { await p.goto(S.base + "/?nosw#/c/" + cid); await p.waitForSelector("#c-guard", { state: "attached" }); await p.waitForTimeout(400); };
async function axeRun(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const setGuard = (g) => S.app.ctx.db.run("UPDATE communities SET settings=$1 WHERE id=$2", [{ automod: { words: [], blockLinks: false, newAccountDays: 0, toxicity: "off", action: "queue", guard: g } }, cid]);

test.before(async () => {
  S = await startStack();
  O = await reg("ag9_owner", "مالكة الحارس"); U = await reg("ag9_member", "عضو الحارس");
  cid = (await api(O)("POST", "/api/communities", { name: "مجتمع الحارس", desc: "تجربة الحارس التلقائي", topic: "dev", rules: ["الاحترام"] })).community.id;
  await api(U)("PUT", `/api/communities/${cid}/membership`);
  uid = (await api(U)("GET", "/api/me")).user.id;
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("guard off: no strip, no live check", async () => {
  const p = await page(U); await open(p);
  assert.equal(await p.innerHTML("#c-guard"), "", "nothing renders while the guard is off");
  await p.context().close();
});

test("strike → strip «تحذير 1 من 3» + countdown; live warning; draft kept on rejection; lock text + appeal; staff lift", async () => {
  await setGuard(AR.parseGuard({ enabled: true, words: ["غبي", "يا حمار"], muteHours: 1, maxStrikes: 3, decayDays: 30, fullLock: true }));
  const u = api(U), o = api(O);
  // strike 1 through the API: rejected (not stored), warn + 1 h mute
  const r1 = await u("POST", "/api/posts", { community: cid, text: "انت غبي" });
  assert.equal(r1._status, 400); assert.equal(r1.code, "autoguard");
  let p = await page(U); await open(p);
  await p.waitForSelector(".c-ag.mute");
  assert.match(await p.textContent(".c-ag"), /تحذير 1 من 3/);
  assert.match(await p.textContent(".c-ag"), /لا يمكنك الكتابة الآن/);
  const t0 = await p.textContent(".c-ag-c"); assert.match(t0, /^\d+:\d{2}$/);
  await p.waitForFunction((t) => document.querySelector(".c-ag-c")?.textContent !== t, t0, { timeout: 4000 });
  assert.match(await p.getAttribute(".c-ag-ap", "href"), new RegExp("#/cappeal/" + cid));
  await shot(p, "ag-member-390-light-mute");
  // the composer is blocked while muted, with the mute line and the appeal link
  await p.click("#c-compose"); await p.waitForSelector("#composer3 .c3-note.warn");
  assert.match(await p.textContent("#composer3 .c3-note.warn"), /مكتوم مؤقتاً/);
  assert.ok(await p.$eval("#c3-pub", (b) => b.disabled), "publish disabled");
  await p.click("#c3-x"); await p.context().close();

  // lift the mute keeping the strike → light strip; live check warns before submit; the rejected draft stays
  assert.equal((await o("POST", `/api/communities/${cid}/members/${uid}/discipline`, { action: "unmute", reset: false }))._status, 200);
  p = await page(U); await open(p);
  await p.waitForSelector(".c-ag:not(.mute):not(.lock)");
  assert.match(await p.textContent(".c-ag"), /لديك تحذير 1 من 3/);
  assert.match(await p.textContent(".c-ag"), /30 يوماً/);
  await p.click("#c-compose"); await p.waitForSelector("#c3-text");
  const draft = "كلام عادي ثم انت غبي جداً";
  await p.fill("#c3-text", draft);
  await p.waitForSelector("#c3-guard:not([hidden])", { timeout: 5000 });
  assert.match(await p.textContent("#c3-guard"), /عبارة ممنوعة/);
  assert.match(await p.textContent("#c3-guard"), /غ\*/, "masked word only");
  assert.ok(!/غبي/.test(await p.textContent("#c3-guard")), "never the clear word");
  await shot(p, "ag-member-390-light-live");
  await p.click("#c3-pub");
  await p.waitForSelector("#c3-err:not([hidden])");
  assert.match(await p.textContent("#c3-err"), /تحذير 2 من 3/);
  assert.equal(await p.inputValue("#c3-text"), draft, "the draft is kept");
  assert.ok(await p.$("#composer3"), "the editor stays open");
  assert.ok(await p.$eval("#c3-pub", (b) => b.disabled), "publish disabled after the strike muted the member");
  await shot(p, "ag-member-390-light-rejected");
  await p.click("#c3-x"); await p.context().close();

  // lock: indefinite guard lock → the stop text + appeal; the composer explains it
  await S.app.ctx.services.communities.sanction("system", cid, uid, "mute", { indefinite: true, ruleId: "autoguard_lock" });
  p = await page(U); await open(p);
  await p.waitForSelector(".c-ag.lock");
  assert.match(await p.textContent(".c-ag"), /أنت موقوف عن الكتابة في هذا المجتمع حتى يراجع مشرف وضعك/);
  assert.ok(await p.$(".c-ag.lock .c-ag-ap"), "appeal link");
  await shot(p, "ag-member-390-light-lock");
  await p.click("#c-compose"); await p.waitForSelector("#composer3 .c3-note.warn");
  assert.match(await p.textContent("#composer3 .c3-note.warn"), /موقوف عن الكتابة/);
  assert.ok(await p.$("#composer3 .c3-ap"));
  await p.click("#c3-x");
  // no overflow at 360
  await p.setViewportSize({ width: 360, height: 780 }); await open(p); await p.waitForSelector(".c-ag.lock");
  assert.ok((await overflow(p)) <= 0, "no horizontal overflow at 360");
  await shot(p, "ag-member-360-light-lock");
  await p.context().close();

  // staff: the member sheet shows the guard line and lifts the lock through discipline unmute
  const s = await page(O, { ...DESKTOP, colorScheme: "dark" });
  await s.goto(S.base + "/?nosw#/c/" + cid + "/members"); await s.waitForSelector(`[data-mem="${uid}"]`);
  await s.click(`[data-mem="${uid}"]`); await s.waitForSelector("#sheet .c-ag-ms");
  assert.match(await s.textContent("#sheet .c-ag-ms"), /تحذيرات الحارس \d من 3/);
  assert.match(await s.textContent("#sheet .c-ag-ms"), /موقوف حتى يرفعه مشرف/);
  await shot(s, "ag-staff-1440-dark-sheet");
  await s.click("#sheet [data-lift]"); await s.waitForSelector("#as-ok"); await s.click("#as-ok");
  await s.waitForFunction(() => !document.querySelector("#sheet [data-lift]") && !!document.querySelector("#sheet .u-g10"), null, { timeout: 8000 });
  await s.context().close();
  const m = await S.app.ctx.db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]);
  assert.notEqual(m.role, "muted", "lock lifted");
});

test("axe: guard strip + composer — 390 light, 1440 dark, LTR (en)", async () => {
  const u = api(U); await u("POST", "/api/posts", { community: cid, text: "يا حمار" }); // strike → muted strip
  const bad = [];
  const m = await page(U); await open(m); await m.waitForSelector(".c-ag"); for (const v of await axeRun(m)) bad.push("390 light " + v);
  await m.context().close();
  const d = await page(U, { ...DESKTOP, colorScheme: "dark" }); await open(d); await d.waitForSelector(".c-ag"); for (const v of await axeRun(d)) bad.push("1440 dark " + v);
  await shot(d, "ag-member-1440-dark");
  await d.click("#c-compose"); await d.waitForSelector("#composer3 .c3-note.warn"); for (const v of await axeRun(d)) bad.push("1440 dark composer " + v);
  await d.context().close();
  const l = await page(U); await l.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await l.evaluate(() => window.MPI18n.setLang("en"));
  await open(l); await l.waitForFunction(() => document.documentElement.dir === "ltr" && !!document.querySelector(".c-ag"), null, { timeout: 15000 });
  await l.waitForFunction(() => /Warning \d of \d|You can't write|Mute ends/.test(document.querySelector(".c-ag")?.textContent || ""), null, { timeout: 8000 });
  for (const v of await axeRun(l)) bad.push("ltr " + v);
  assert.ok((await overflow(l)) <= 0, "no overflow LTR");
  await shot(l, "ag-member-390-ltr-en");
  await l.evaluate(() => window.MPI18n.setLang("ar")); await l.context().close();
  assert.deepEqual(bad, []);
});
