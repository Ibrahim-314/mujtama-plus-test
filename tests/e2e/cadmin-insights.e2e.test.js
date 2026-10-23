/* v2.60.0 «المجتمع 3.0» stage 5 — insights, growth, integrations, events and member notifications in a real browser:
 * the insights section (period switch, metric switch, bars painted through CSSOM, CSV download: members for the owner),
 * growth (invite QR sheet, revoke through the action sheet, partner search → proposal), integrations (webhook created
 * from the sheet, the secret shown once, Pi features visible + disabled «غير مفعّل بعد», market tab switch → the tab on
 * the community page, MJT rewards saved by the owner after a confirmation), events (server list, calendar link, default
 * reminders), the new-member notification default (privacy), a member's #/c/:id/notify page (level, digest, timed mute,
 * reachable from the «…» menu); no page errors, no native dialogs; axe (no serious/critical) at 390 light, 1440 dark, LTR. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
let S, cid, own, mem, memId; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(250); };
const sheetBtn = async (p, sel) => { await p.waitForSelector("#sheet:not(.hidden) " + sel, { timeout: 8000 }); await p.click("#sheet:not(.hidden) " + sel); };
async function axe(p) {
  await p.evaluate(() => document.querySelectorAll("#nf-toasts .nf-toast .x").forEach((x) => x.click()));
  await p.waitForFunction(() => !document.querySelector("#nf-toasts .nf-toast"), null, { timeout: 5000 }).catch(() => {});
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const page = async (opts = MOBILE, who = "") => {
  const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce", acceptDownloads: true }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(who + ": " + e.message)); p.on("dialog", (d) => { errors.push(who + ": native dialog " + d.type() + " " + d.message()); d.dismiss().catch(() => {}); });
  return p;
};

test.before(async () => {
  S = await startStack();
  own = await page(DESKTOP, "owner"); await onboard(own, S.base, "i6_owner", "مالك مجتمع الرؤى");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع الرؤى والنمو", desc: "مجتمع لاختبار التحليلات والنمو والتكاملات.", rules: ["الاحترام"] })).community.id;
  mem = await page(MOBILE, "member"); await onboard(mem, S.base, "i6_mem", "عضوة مجتمع الرؤى"); await call(mem, "PUT", `/api/communities/${cid}/membership`); memId = await meId(mem);
  for (const t of ["أول منشور في الرؤى", "ثاني منشور للتحليلات", "سؤال: من أين أبدأ؟"]) await call(mem, "POST", "/api/posts", { text: t, community: cid, ...(t.startsWith("سؤال") ? { type: "question" } : {}) });
  await call(own, "POST", "/api/posts", { text: "ترحيب من المالك", community: cid });
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors, no native prompt/confirm"); });
test.beforeEach(() => S.app.ctx.rl.w?.clear?.());

test("insights: KPIs, period + metric switch, bars painted (CSSOM, no inline style), CSV with members for the owner", async () => {
  await go(own, `#/cadmin/${cid}?s=insights`); await own.waitForSelector(".ca-ikpi .kpi-tile");
  assert.match(await own.textContent(".ca-ikpi"), /المنشورات/);
  assert.equal(await own.$$eval(".ca-ibars i", (x) => x.length), 30);
  assert.ok(await own.$eval(".ca-ibars i:last-child", (i) => i.style.getPropertyValue("--h") !== "" && !i.getAttribute("style")?.includes("height")));
  await own.click('[data-days="7"]'); await until(own, () => document.querySelectorAll(".ca-ibars i").length === 7);
  assert.match(own.url(), /d=7/);
  await own.click('[data-metric="posts"]'); await own.waitForSelector('[data-metric="posts"][aria-selected="true"]');
  assert.equal(await own.$$eval(".ca-heat i", (x) => x.length), 7 * 24); assert.ok(await own.$("#ca-hcard"), "health card for the owner");
  const [dl] = await Promise.all([own.waitForEvent("download"), own.click("#ca-iexp")]);
  const csv = fs.readFileSync(await dl.path(), "utf8"); assert.match(csv, /contributor_handle/); assert.ok(csv.includes("i6_mem"));
  /* the strip and the side nav carry the new sections */
  for (const k of ["insights", "events", "integrations"]) assert.ok(await own.$(`.ca-nav [data-sec="${k}"]`), k);
});

test("growth: invite QR sheet, revoke through the action sheet, partner search → proposal (no <select>)", async () => {
  const inv = (await call(own, "POST", `/api/communities/${cid}/invites`, { label: "ملصق المعرض" })).invite;
  const other = (await call(mem, "POST", "/api/communities", { name: "مجتمع شريك للتجربة", desc: "شريك" })).community.id;
  await go(own, `#/cadmin/${cid}?s=growth`); await own.waitForSelector(`[data-qr="${inv.code}"]`);
  await own.click(`[data-qr="${inv.code}"]`); await own.waitForSelector("#sheet:not(.hidden) .ca-qr svg"); assert.match(await own.textContent("#sheet .ca-qru"), new RegExp(inv.code));
  await sheetBtn(own, "#qr-cp"); await own.evaluate(() => closeSheet());
  assert.equal(await own.$("#ca-gpt select"), null, "partners: a search, not a select");
  await own.fill("#pt-q", "شريك للتجربة"); await own.waitForSelector(`#pt-r [data-pp="${other}"]`); await own.click(`#pt-r [data-pp="${other}"]`);
  await until(own, () => /بانتظار الرد/.test(document.querySelector("#ca-gpt")?.textContent || ""));
  await own.click(`[data-rvi="${inv.code}"]`); await sheetBtn(own, "#ca-ask-ok"); await until(own, (c) => !document.querySelector(`[data-qr="${c}"]`), inv.code);
  assert.ok((await call(own, "GET", `/api/communities/${cid}/invites`)).invites.find((i) => i.code === inv.code).revokedAt);
});

test("integrations: webhook from the sheet (secret once), Pi features shown OFF, market tab switch → community tab, MJT rewards saved", async () => {
  await go(own, `#/cadmin/${cid}?s=integrations`); await own.waitForSelector("#ca-pi");
  assert.equal(await own.$$eval('#ca-pi input[role="switch"]', (x) => x.filter((i) => i.disabled && !i.checked && i.getAttribute("aria-checked") === "false").length), 4);
  assert.equal((await own.textContent("#ca-pi")).match(/غير مفعّل بعد/g).length >= 4, true);
  await own.click("#ca-hknew"); await own.fill("#hk-u", "https://hooks.example.com/mujtama"); await sheetBtn(own, "#hk-go");
  await own.waitForSelector("#sheet:not(.hidden) #hk-sec"); assert.match(await own.inputValue("#hk-sec"), /^whsec_/); await sheetBtn(own, '[data-ui="close-sheet"]');
  assert.equal(await own.$$eval("#ca-hooks li", (x) => x.length), 1);
  await own.click('[data-k="mk-tab"]'); await until(own, () => !document.querySelector("#nf-toasts") || true); await own.waitForTimeout(400);
  assert.equal((await call(own, "GET", `/api/communities/${cid}/space`)).community.marketTab, true);
  await own.fill('[data-rw="perPost"]', "0.5"); await own.check('[data-k="rw-on"]'); await own.click("#ca-rwsave"); await sheetBtn(own, "#ca-ask-ok");
  await until(own, () => !!document.querySelector('#ca-mjt [data-k="rw-on"]:checked'));
  const iv = await call(own, "GET", `/api/communities/${cid}/integrations`); assert.equal(iv.mjt.settings.enabled, true); assert.equal(iv.mjt.settings.perPost, "0.5");
  await go(mem, `#/c/${cid}`); await mem.waitForSelector('[data-ctab="market"]'); await mem.click('[data-ctab="market"]'); await mem.waitForSelector("#c-body .empty, #c-body .list");
});

test("events: server list with attendance, calendar link, default reminders saved", async () => {
  const ev = (await call(own, "POST", "/api/events/plus", { name: "أمسية المجتمع", startsAt: new Date(Date.now() + 2 * 864e5).toISOString(), community: cid, capacity: 20 })).event;
  await go(own, `#/cadmin/${cid}?s=events`); await own.waitForSelector(".ca-ev");
  assert.match(await own.textContent(".ca-ev"), /أمسية المجتمع/); assert.match(await own.textContent(".ca-ev"), /من 20 مقعد/);
  assert.match(await own.inputValue("#ca-icsv"), new RegExp(`/c/${cid}/events\\.ics$`));
  await own.click('[data-k="ev-hour"]'); await own.waitForTimeout(400);
  assert.equal(await S.app.ctx.services.cinsights.reminderOn(ev.id, "1h"), false);
});

test("new-member notification default (privacy) and a member's #/c/:id/notify page (from the «…» menu)", async () => {
  await go(own, `#/cadmin/${cid}?s=privacy`); await own.waitForSelector('#ca-ndef input[value="digest"]');
  await own.check('#ca-ndef input[value="digest"]'); await own.waitForTimeout(400);
  assert.equal((await S.app.ctx.db.get("SELECT settings FROM communities WHERE id=$1", [cid])).settings.notifyDefault, "digest");
  await go(mem, `#/c/${cid}`); await mem.click("#c-more"); await sheetBtn(mem, `a[href="#/c/${cid}/notify"]`);
  await mem.waitForSelector('.c-nt input[name="cn-l"]'); await mem.check('.c-nt input[value="highlights"]');
  await until(mem, () => document.querySelector('.c-nt input[value="highlights"]')?.checked);
  await mem.click('[data-mute="8"]'); await mem.waitForSelector(".c-nt .notice");
  await mem.click("#cn-dg"); await mem.waitForTimeout(300);
  const p = (await call(mem, "GET", `/api/communities/${cid}/notify`)).prefs; assert.equal(p.level, "highlights"); assert.equal(p.digest, true); assert.ok(p.mutedUntil);
  await mem.click("#cn-unmute"); await until(mem, () => !document.querySelector(".c-nt .notice"));
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM community_member_prefs WHERE community=$1 AND user_id=$2", [cid, memId]));
});

test("axe: no serious/critical — insights, growth, integrations, events, notify; 390 light, 1440 dark, LTR", async () => {
  const bad = [], secs = ["insights", "growth", "integrations", "events", "privacy"];
  const m = await page(MOBILE, "own390"); await m.goto(S.base + "/?nosw"); await m.fill("#a-handle", "i6_owner"); await m.fill("#a-pass", "secret1234"); await m.click("#a-go"); await m.waitForSelector(".bottomnav a[data-r=home]");
  for (const s of secs) { await go(m, `#/cadmin/${cid}?s=${s}`); await m.waitForTimeout(300); for (const v of await axe(m)) bad.push("390 light " + s + " " + v); }
  await go(mem, `#/c/${cid}/notify`); await mem.waitForSelector(".c-nt"); for (const v of await axe(mem)) bad.push("390 notify " + v);
  const d = await page({ ...DESKTOP, colorScheme: "dark" }, "dark"); await d.goto(S.base + "/?nosw"); await d.fill("#a-handle", "i6_owner"); await d.fill("#a-pass", "secret1234"); await d.click("#a-go"); await d.waitForSelector(".bottomnav a[data-r=home]");
  for (const s of secs) { await go(d, `#/cadmin/${cid}?s=${s}`); await d.waitForTimeout(300); for (const v of await axe(d)) bad.push("1440 dark " + s + " " + v); }
  await go(d, `#/c/${cid}/notify`); for (const v of await axe(d)) bad.push("1440 dark notify " + v);
  await d.evaluate(() => window.MPI18n?.setLang("en")); await go(d, `#/cadmin/${cid}?s=insights`); await until(d, () => document.documentElement.dir === "ltr");
  for (const s of ["insights", "integrations", "events"]) { await go(d, `#/cadmin/${cid}?s=${s}`); await d.waitForTimeout(300); for (const v of await axe(d)) bad.push("LTR " + s + " " + v); }
  await d.evaluate(() => window.MPI18n?.setLang("ar")); await d.context().close(); await m.context().close();
  assert.deepEqual(bad, []);
});
