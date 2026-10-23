/* v2.67 — family page (#/family) and age page (#/age) text follow the UI language.
 * EN (1440 dark): no Arabic UI text left on the guardian's family page (active link: controls, weekly summary, overview,
 * protection log) nor on the minor's family/age pages. AR (390 light): Arabic copy, no English UI leftovers.
 * Names are Latin on purpose so any Arabic found is UI chrome. axe 0 serious/critical on both. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, G, M, linkId; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const ymd = (y) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); return d.toISOString().slice(0, 10); };
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
async function axe(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
async function user(opts, handle, name, years) {
  const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(handle + ": " + e.message)); p.on("dialog", (d) => d.dismiss().catch(() => {}));
  await onboard(p, S.base, handle, name);
  assert.equal((await call(p, "POST", "/api/age", { birthDate: ymd(years) })).status, 200);
  const id = (await call(p, "GET", "/api/me")).user.id;
  return { p, id };
}
/** visible Arabic text inside the view (scripts, hidden nodes and the help popover excluded); option labels too */
const arabicLeft = (p) => p.evaluate(() => {
  const out = []; const root = document.querySelector("#view") || document.body; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const el = n.parentElement; if (!el || el.closest("script,style,[hidden],.hidden,svg")) continue; if (/[\u0600-\u06FF]/.test(n.nodeValue) && el.getClientRects().length) out.push(n.nodeValue.trim()); }
  for (const o of root.querySelectorAll("option")) if (/[\u0600-\u06FF]/.test(o.textContent)) out.push("option:" + o.textContent.trim());
  return out;
});
const setLang = async (p, L) => {
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await p.evaluate((l) => window.MPI18n.setLang(l), L);
  await p.waitForFunction((l) => document.documentElement.dir === (l === "en" ? "ltr" : "rtl"), L);
};
const go = async (p, hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForSelector("#mn-h"); await p.waitForTimeout(600); };

test.before(async () => {
  S = await startStack();
  G = await user({ ...DESKTOP, colorScheme: "dark" }, "fi_guard", "Guardian Gail", 40);
  M = await user({ ...MOBILE, colorScheme: "light" }, "fi_teen", "Teen Tam", 14);
  /* mutual follow through the real flow: PUT /api/follows/:id; a private/minor target gets a request it approves */
  const follow = async (A, B, label) => {
    const f = await call(A.p, "PUT", "/api/follows/" + B.id); assert.equal(f.status, 200, label + " " + JSON.stringify(f));
    if (f.state === "requested") assert.equal((await call(B.p, "POST", `/api/follow-requests/${A.id}/approve`)).status, 200, label + " approved");
  };
  await follow(G, M, "guardian follows"); await follow(M, G, "teen follows");
  const r = await call(G.p, "POST", "/api/family/links", { handle: "fi_teen", as: "guardian" }); assert.ok(r.status < 300, JSON.stringify(r));
  linkId = (await call(M.p, "GET", "/api/family")).links[0].id;
  assert.ok((await call(M.p, "POST", `/api/family/links/${linkId}/accept`)).status < 300, "teen accepts");
  assert.ok((await call(G.p, "PUT", `/api/family/links/${linkId}/controls`, { dm: "nobody" })).status < 300, "guardian tightens dm");
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("1440 dark EN: guardian family page has no Arabic UI text", async () => {
  const p = G.p; await setLang(p, "en"); await go(p, "#/family");
  await p.click(`[data-mn-ov="${linkId}"]`); await p.waitForFunction((id) => (document.querySelector(`#mn-ov-${id}`)?.textContent || "").includes("Protection log"), linkId, { timeout: 15000 });
  const left = await arabicLeft(p); assert.deepEqual(left, [], "Arabic left in EN: " + left.join(" | "));
  const txt = await p.textContent("#view");
  for (const s of ["Family settings", "You're the guardian", "Who can message them", "Protected default", "No one", "Weekly mentoring summary", "Add a family link", "Your role", "Protection log", "Messages:", "Guardians never see"]) assert.ok(txt.includes(s), "EN text: " + s);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow");
  await shot(p, "family-1440-dark-en"); for (const v of await axe(p)) assert.fail("1440 dark EN family " + v);
  await p.evaluate(() => window.MPI18n.setLang("ar"));
});

test("390 EN minor: family + age pages have no Arabic; 390 light AR: Arabic copy, no English leftovers", async () => {
  const p = M.p; await setLang(p, "en");
  await go(p, "#/family"); let left = await arabicLeft(p); assert.deepEqual(left, [], "family EN: " + left.join(" | "));
  assert.ok((await p.textContent("#view")).includes("Your guardian"), "EN: Your guardian");
  await go(p, "#/age"); left = await arabicLeft(p); assert.deepEqual(left, [], "age EN: " + left.join(" | "));
  await setLang(p, "ar"); await go(p, "#/family");
  const txt = await p.textContent("#view");
  for (const s of ["الإعدادات العائلية", "وليّ أمرك", "إعدادات اختارها:", "ما يراه وليّ أمرك", "سجل الحماية"]) assert.ok(txt.includes(s), "AR text: " + s);
  for (const s of ["Family settings", "Your guardian", "Messages:", "Protection log", "Guardians never see"]) assert.ok(!txt.includes(s), "no EN leftover in AR: " + s);
  await shot(p, "family-390-light-ar"); for (const v of await axe(p)) assert.fail("390 light AR family " + v);
});
