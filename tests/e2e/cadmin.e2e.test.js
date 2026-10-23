/* v2.57.0 «المجتمع 3.0» stage 2 — the community admin panel (#/cadmin) in a real browser:
 * every section opens · save & discard · the unsaved-changes guard holds navigation · a moderator sees locked sections ·
 * a full ownership transfer accepted by the recipient · archive then restore · the old routes (#/cset #/cmod #/chealth)
 * open their sections · the «المزيد» entry · axe (no serious/critical) on the new screens, light/dark, 390/1440, LTR. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
let S, cid, own, adm, mod; const errors = [];
const NAME = "استوديو لوحة الإدارة";
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(150); };
const sheetBtn = async (p, sel) => { await p.waitForSelector("#sheet:not(.hidden) " + sel, { timeout: 8000 }); await p.click("#sheet:not(.hidden) " + sel); };
async function axe(p) {
  await p.evaluate(() => document.querySelectorAll("#nf-toasts .nf-toast .x").forEach((x) => x.click()));
  await p.waitForFunction(() => !document.querySelector("#nf-toasts .nf-toast"), null, { timeout: 5000 }).catch(() => {});
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const page = async (opts = MOBILE, who = "") => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", (e) => errors.push(who + ": " + e.message)); return p; };
const login = async (p, handle) => { await p.goto(S.base + "/?nosw"); await p.fill("#a-handle", handle); await p.fill("#a-pass", "secret1234"); await p.click("#a-go"); await p.waitForSelector(".bottomnav a[data-r=home]"); };
const SECTIONS = ["home", "general", "privacy", "rules", "members", "roles", "channels", "content", "knowledge", "moderation", "growth", "health", "danger"]; // v2.58: + rules, content, knowledge, growth

test.before(async () => {
  S = await startStack();
  own = await page(MOBILE, "owner"); await onboard(own, S.base, "cad_owner", "مالك اللوحة");
  cid = (await call(own, "POST", "/api/communities", { name: NAME, desc: "مجتمع لاختبار لوحة الإدارة الجديدة بكل أقسامها.", rules: ["الاحترام أولاً"] })).community.id;
  for (const [h, n] of [["cad_admin", "مديرة اللوحة"], ["cad_mod", "مشرف اللوحة"]]) {
    S.app.ctx.rl.w?.clear?.(); const u = await page(MOBILE, h); await onboard(u, S.base, h, n);
    await call(u, "PUT", `/api/communities/${cid}/membership`); const id = await meId(u);
    await call(own, "PATCH", `/api/communities/${cid}/members/${id}`, { role: h === "cad_admin" ? "admin" : "moderator" });
    if (h === "cad_admin") adm = u; else mod = u;
  }
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("every section opens for the owner; old routes and the «المزيد» entry lead into the panel", async () => {
  for (const s of SECTIONS) {
    await go(own, `#/cadmin/${cid}${s === "home" ? "" : "?s=" + s}`);
    await until(own, () => document.querySelector("#ca-body")?.children.length > 0 && !document.querySelector("#ca-body .skel"));
    assert.equal(await own.$$eval("#ca-body .empty.err", (x) => x.length), 0, s + ": no error state");
    assert.equal(await own.$$eval("#ca-body .ca-card.is-locked", (x) => x.length), 0, s + ": nothing locked for the owner");
  }
  for (const [old, s] of [["cset", "general"], ["cmod", "moderation"], ["chealth", "health"]]) {
    await own.evaluate((h) => { location.hash = h; }, `#/${old}/${cid}`);
    await until(own, (s) => location.hash.endsWith("?s=" + s) && !!document.querySelector('.ca[data-sec="' + s + '"]'), s);
  }
  await go(own, "#/cadmin"); await until(own, (n) => document.querySelector("#view").textContent.includes(n), NAME);
  assert.ok(await own.$(`a[href="#/cadmin/${cid}"]`), "the community is listed in «مجتمعاتي التي أديرها»");
  assert.ok(await own.evaluate(() => window.MPMenu?.items?.().some((x) => x.h === "#/cadmin")), "listed in the «المزيد» index");
  // the community page header leads to the panel
  await own.evaluate((h) => { location.hash = h; }, `#/c/${cid}`); await own.waitForSelector(".c-admin");
});

test("save & discard, and the unsaved-changes guard", async () => {
  await go(own, `#/cadmin/${cid}?s=general`); await own.waitForSelector('#ca-form [data-k="desc"]');
  const before = await own.inputValue('[data-k="desc"]');
  await own.fill('[data-k="desc"]', "وصف مؤقت سيتم تجاهله");
  await own.waitForSelector("#ca-save:not([hidden])");
  // guard: a section link does not navigate while dirty, the bar shakes
  const h0 = await own.evaluate(() => location.hash);
  await own.locator(".ca-strip a.ca-chip", { hasText: "الأعضاء" }).click();
  await own.waitForTimeout(300);
  assert.equal(await own.evaluate(() => location.hash), h0, "navigation held while there are unsaved changes");
  assert.ok(await own.$("#ca-save.shake"), "the bar shakes");
  // discard restores the value and hides the bar
  await own.click('[data-ca="discard"]');
  assert.equal(await own.inputValue('[data-k="desc"]'), before); assert.ok(await own.$("#ca-save[hidden]"));
  // save: description + a post-approval switch + a tag
  await own.fill('[data-k="desc"]', "وصف جديد محفوظ من لوحة الإدارة");
  await own.locator('label.switch-row:has([data-k="requireApproval"])').click();
  await own.fill("#ca-tag-in", "سؤال"); await own.click("#ca-tag-add");
  await own.click('[data-ca="save"]');
  await until(own, () => document.querySelector("#ca-save")?.hidden !== false);
  await until(own, () => !!document.querySelector('#ca-form [data-k="desc"]'));
  const sp = await call(own, "GET", `/api/communities/${cid}/space`);
  assert.equal(sp.community.desc, "وصف جديد محفوظ من لوحة الإدارة"); assert.equal(sp.community.requireApproval, true); assert.ok(sp.identity.tags.some((t) => t.name === "سؤال"));
  // after saving, navigation is free again
  await own.locator(".ca-strip a.ca-chip", { hasText: "الأعضاء" }).click();
  await until(own, () => location.hash.endsWith("?s=members"));
  // v2.58: structured rules through «القواعد والترحيب» (title, body, severity; the legacy list stays the mirror)
  await go(own, `#/cadmin/${cid}?s=rules`); await own.waitForSelector(".ca-radd");
  await own.click(".ca-radd"); await own.fill(".ca-ru:last-child .ca-rt", "لا إعلانات دون إذن"); await own.fill(".ca-ru:last-child .ca-rb", "العروض في قناة السوق فقط.");
  await own.locator(".ca-ru:last-child .sev-serious").click();
  await own.click('[data-ca="save"]'); await until(own, () => document.querySelector("#ca-save")?.hidden !== false);
  const rr = await call(own, "GET", `/api/communities/${cid}/rules`); assert.equal(rr.rules[1].severity, "serious"); assert.equal(rr.rules[1].body, "العروض في قناة السوق فقط.");
  // type through «الخصوصية والعضوية» (type change asks first)
  await go(own, `#/cadmin/${cid}?s=privacy`); await own.waitForSelector(".ca-type");
  await own.locator('.ca-type:has(input[value="private"])').click();
  await own.click('[data-ca="save"]'); await sheetBtn(own, "#ca-ask-ok");
  await until(own, () => document.querySelector("#ca-save")?.hidden !== false);
  const sp2 = await call(own, "GET", `/api/communities/${cid}/space`);
  assert.equal(sp2.community.type, "private"); assert.deepEqual(sp2.community.rules, ["الاحترام أولاً", "لا إعلانات دون إذن"]);
});

test("a moderator sees what they can do and locks on the rest", async () => {
  await go(mod, `#/cadmin/${cid}`);
  assert.ok(await mod.$('.ca-mlist a.li[href$="?s=roles"] .ico use[href="#i-lock"]'), "roles are locked in the section list");
  await go(mod, `#/cadmin/${cid}?s=general`); await mod.waitForSelector("#ca-body .ca-card.is-locked");
  assert.match(await mod.textContent("#ca-body"), /للمالك والمديرين/);
  await go(mod, `#/cadmin/${cid}?s=roles`); await mod.waitForSelector("#ca-body .ca-lock");
  assert.equal(await mod.$$eval('#ca-body [data-k]', (x) => x.length), 0, "no editable role fields");
  await go(mod, `#/cadmin/${cid}?s=danger`); await mod.waitForSelector("#ca-body .ca-lock");
  await go(mod, `#/cadmin/${cid}?s=members`); await mod.waitForSelector("#ca-ml .ca-mrow");
  assert.equal(await mod.$("#ca-mcsv"), null, "no export for moderators");
  await go(mod, `#/cadmin/${cid}?s=moderation`); await mod.waitForSelector("#m-body");
});

test("v2.58 channels & categories, pins and announcements from the panel", async () => {
  await go(own, `#/cadmin/${cid}?s=channels`); await own.waitForSelector("#ca-chnew");
  await own.click("#ca-chnew"); await own.waitForSelector("#sheet:not(.hidden) #ce-n");
  await own.fill("#ce-n", "نقاش اللوحة"); await own.selectOption("#ce-s", "60"); await own.click('#sheet [data-ico="bulb"]');
  await own.click("#sheet .ca-pick:has([data-ty=poll])"); await sheetBtn(own, "#ce-go");
  await own.waitForSelector('.ca-chr:has-text("نقاش اللوحة")');
  const ch = (await call(own, "GET", `/api/communities/${cid}/channels`)).channels.find((x) => x.name === "نقاش اللوحة");
  assert.equal(ch.slowModeSec, 60); assert.equal(ch.icon, "bulb"); assert.ok(ch.allowedTypes.length && !ch.allowedTypes.includes("poll"), "poll unticked → a narrowed list");
  await own.click("#ca-gnew"); await own.fill("#sheet:not(.hidden) #gr-n", "المشاريع"); await sheetBtn(own, "#gr-go");
  await own.waitForSelector('.ca-chgh:has-text("المشاريع")');
  await own.click(`[data-ed="${ch.id}"]`); await own.waitForSelector("#sheet:not(.hidden) #ce-g"); await own.selectOption("#ce-g", { label: "المشاريع" }); await sheetBtn(own, "#ce-go");
  await own.waitForFunction((id) => !!document.querySelector(`.ca-chg[data-gid]:not([data-gid=""]) [data-chid="${id}"]`), ch.id);
  await own.click(`[data-ed="${ch.id}"]`); await sheetBtn(own, "#ce-arc"); await sheetBtn(own, "#ca-ask-ok");
  await own.waitForSelector(`.ca-arch [data-chid="${ch.id}"]`, { state: "attached" }); // inside the closed «مؤرشفة» group
  assert.ok((await call(own, "GET", `/api/communities/${cid}/channels`)).channels.find((x) => x.id === ch.id).archivedAt);
  // content: announcement + pin
  const post = (await call(own, "POST", "/api/posts", { community: cid, text: "منشور يستحق التثبيت في اللوحة" })).post;
  await go(own, `#/cadmin/${cid}?s=content`); await own.waitForSelector("#ca-annnew");
  await own.click("#ca-annnew"); await own.fill("#sheet:not(.hidden) #an-t", "لقاء اللوحة الشهري"); await sheetBtn(own, "#an-go");
  await own.waitForSelector('#ca-anns .ca-row:has-text("لقاء اللوحة الشهري")');
  await own.click("#ca-pinpick summary"); await own.click(`[data-pin="${post.id}"][data-scope=community]`);
  await own.waitForSelector('#ca-pins .ca-row:has-text("منشور يستحق التثبيت")');
  const sp = await call(own, "GET", `/api/communities/${cid}/space`);
  assert.equal(sp.announcement?.title, "لقاء اللوحة الشهري"); assert.ok(sp.pins.some((p) => p.post.id === post.id));
  // the invite stats stay on one line at 390 px
  await go(own, `#/cadmin/${cid}?s=privacy`); await own.click("#ca-inv-new"); await sheetBtn(own, "#iv-go"); await own.waitForSelector(".ca-ist");
  assert.ok(await own.$eval(".ca-ist", (e) => e.getBoundingClientRect().height < 30), "one line");
});

test("ownership transfer: owner requests, the recipient accepts in their panel", async () => {
  await go(own, `#/cadmin/${cid}?s=danger`); await own.waitForSelector("#ca-tgo");
  await own.click("#ca-tgo"); await own.waitForSelector("#sheet:not(.hidden) #ca-ask-t");
  assert.equal(await own.$eval("#ca-ask-ok", (b) => b.disabled), true, "confirm stays disabled until the name is typed");
  await own.fill("#ca-ask-t", NAME); await sheetBtn(own, "#ca-ask-ok");
  await own.waitForSelector("#ca-tcancel");
  await go(adm, `#/cadmin/${cid}`); await adm.waitForSelector("#ca-tacc");
  await adm.click("#ca-tacc"); await sheetBtn(adm, "#ca-ask-ok");
  await until(adm, () => /أنت: المالك/.test(document.querySelector("#ca-body")?.textContent || ""));
  const c = await call(adm, "GET", `/api/communities/${cid}/admin`); assert.equal(c.role, "owner");
  const o = await call(own, "GET", `/api/communities/${cid}/admin`); assert.equal(o.role, "admin", "the previous owner is an admin now");
  // hand it back the same way (API) so the next test runs as the original owner
  const t = (await call(adm, "POST", `/api/communities/${cid}/transfer`, { to: o.keys ? (await meId(own)) : "", confirm: NAME })).transfer;
  assert.equal((await call(own, "POST", `/api/community-transfers/${t.id}/accept`)).status, "accepted");
});

test("archive then restore", async () => {
  await go(own, `#/cadmin/${cid}?s=danger`); await own.waitForSelector("#ca-archive");
  await own.click("#ca-archive"); await own.fill("#ca-ask-t", NAME); await sheetBtn(own, "#ca-ask-ok");
  await own.waitForSelector("#ca-restore"); assert.ok(await own.$(".ca-flag"), "archived banner");
  await own.evaluate((h) => { location.hash = h; }, `#/c/${cid}`); await own.waitForSelector(".c-meta .c-flag");
  assert.equal(await own.$("#c-compose"), null, "no composer in an archived community");
  await go(own, `#/cadmin/${cid}?s=danger`); await own.click("#ca-restore");
  await own.waitForSelector("#ca-archive");
  assert.equal((await call(own, "GET", `/api/communities/${cid}/space`)).community.archivedAt, null);
});

test("axe: no serious/critical issues — 390 light, 1440 dark, LTR", async () => {
  const bad = [];
  for (const s of ["home", "general", "privacy", "rules", "members", "roles", "channels", "content", "knowledge", "growth", "danger"]) { await go(own, `#/cadmin/${cid}${s === "home" ? "" : "?s=" + s}`); await own.waitForTimeout(400); for (const v of await axe(own)) bad.push("390 light " + s + " " + v); }
  const d = await page({ ...DESKTOP, colorScheme: "dark" }, "desk"); await login(d, "cad_owner");
  for (const s of ["home", "general", "privacy", "rules", "members", "roles", "channels", "content", "knowledge", "growth", "danger"]) { await go(d, `#/cadmin/${cid}${s === "home" ? "" : "?s=" + s}`); await d.waitForTimeout(400); for (const v of await axe(d)) bad.push("1440 dark " + s + " " + v); }
  assert.ok(await d.$(".ca-nav"), "desktop side list"); assert.equal(await d.evaluate(() => getComputedStyle(document.querySelector(".ca-nav")).display), "flex");
  await go(d, "#/cadmin"); for (const v of await axe(d)) bad.push("1440 dark index " + v);
  const l = await page(MOBILE, "ltr"); await login(l, "cad_owner"); await l.waitForFunction(() => window.MPI18n, null, { timeout: 15000 }); await l.evaluate(() => window.MPI18n.setLang("en"));
  await l.goto(S.base + `/?nosw#/cadmin/${cid}?s=general`); await until(l, () => document.documentElement.dir === "ltr" && !!document.querySelector("#ca-form"));
  for (const v of await axe(l)) bad.push("ltr general " + v);
  await l.evaluate((h) => { location.hash = h; }, `#/cadmin/${cid}`); await l.waitForSelector("#ca-body .ca-hero"); for (const v of await axe(l)) bad.push("ltr home " + v);
  for (const s of ["channels", "content", "rules", "knowledge", "growth"]) { await l.evaluate((h) => { location.hash = h; }, `#/cadmin/${cid}?s=${s}`); await l.waitForFunction(() => !!document.querySelector("#ca-body > *") && !document.querySelector("#ca-body .skel"), null, { timeout: 15000 }); await l.waitForTimeout(400); for (const v of await axe(l)) bad.push("ltr " + s + " " + v); }
  await l.evaluate(() => window.MPI18n.setLang("ar"));
  assert.deepEqual(bad, []);
});
