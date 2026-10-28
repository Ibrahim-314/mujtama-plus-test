/* v2.134 «الذكاء في الرسائل» end-to-end (production build, phone width, fake model behind the AI Hub free allowance):
 * the «لخّص لي اللي فاتني» pill appears with 5+ unread → summary sheet → a point jumps to its message; ✨ in the composer
 * shows suggested replies that fill the box (never sent), tone chips rewrite the draft with «الأصل» undo; encrypted chats get
 * no ✨; the Settings switch turns everything off and back on. Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert");
const path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE } = require("./harness");
const { id } = require("../../server/lib/core");

const fake = {
  label: "مجتمع بلس",
  async chat(messages) {
    const p = messages[messages.length - 1].content;
    if (p.includes("لخّص لصاحب الطلب")) { const msgs = JSON.parse(p.slice(p.indexOf("[", p.indexOf("الرسائل (JSON")))); return { text: JSON.stringify({ headline: "اتفقوا على اجتماع الخميس ٨ مساءً", forMe: true, points: [{ kind: "decision", text: "الاجتماع الخميس ٨ مساءً في مكتب الكورنيش", cites: [msgs[0].id] }, { kind: "todo", text: "تجهيز ملف العرض", cites: [msgs[1].id] }] }) }; }
    if (p.includes("اقترح 3 ردود")) return { text: JSON.stringify({ replies: ["تمام، أجهز العرض وأرسله الأربعاء", "أرد عليكم الليلة", "الخميس يناسبني"] }) };
    if (p.includes("أعد كتابة رسالة المستخدم")) return { text: JSON.stringify({ text: "أبشر، بجهز العرض إن شاء الله" }) };
    return { text: "{}" };
  }
};
let S, A, g, enc; const errors = [];
const SHOTS = process.env.SHOTS_DIR;
const shot = async (n) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await A.waitForTimeout(300); await A.screenshot({ path: path.join(SHOTS, n + ".png") }); };
const until = async (fn, arg, ms = 10000) => { const end = Date.now() + ms; for (;;) { if (await A.evaluate(fn, arg).catch(() => false)) return; if (Date.now() > end) throw new Error("timeout: " + fn); await A.waitForTimeout(150); } };

test.before(async () => {
  S = await startStack({ aihubOpts: { env: { AIHUB_SEAL_KEY: "e2e" }, freeProvider: fake } });
  const { db } = S.app.ctx, ago = (m) => new Date(Date.now() - m * 60e3).toISOString();
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); A = await ctx.newPage(); A.on("pageerror", (e) => errors.push(e.message));
  await onboard(A, S.base, "noura_ai", "نورة السبيعي");
  const me = (await A.evaluate(async () => (await (await fetch("/api/me")).json()).user.id));
  await db.run("UPDATE ai_link_usage SET requests=0").catch(() => { });
  const k = id("u"), r = id("u");
  for (const [u, h, n] of [[k, "khaled_ai", "خالد العتيبي"], [r, "reem_ai2", "ريم المصري"]]) await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'','#1d4ed8','user',$4,$5)", [u, h, n, { onboarded: true }, ago(9000)]);
  g = id("cv"); await db.run("INSERT INTO conversations(id,kind,title,owner,created_at,updated_at) VALUES($1,'group','فريق تطبيق جدة',$2,$3,$3)", [g, k, ago(600)]);
  await db.run("INSERT INTO conversation_members(conv,user_id,state,role) VALUES($1,$2,'accepted','owner'),($1,$3,'accepted','member'),($1,$4,'accepted','member')", [g, k, r, me]);
  const lines = [[k, "نسوي اجتماع المراجعة الخميس الساعة ٨ مساءً؟"], [r, "نورة تقدرين تجهزين ملف العرض؟"], [k, "يناسبني"], [r, "نخليه في مكتب الكورنيش"], [k, "ونحتاج قرار في لون الأزرار"], [r, "نورة ردي علينا لما تشوفين"]];
  let t = 300; for (const [u, x] of lines) { await db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,$4,$5,'text')", [id("ms"), g, u, x, ago(t)]); t -= 20; }
  enc = id("cv"); await db.run("INSERT INTO conversations(id,kind,e2ee,created_at,updated_at) VALUES($1,'dm',1,$2,$2)", [enc, ago(100)]);
  await db.run("INSERT INTO conversation_members(conv,user_id,state) VALUES($1,$2,'accepted'),($1,$3,'accepted')", [enc, k, me]);
  await A.evaluate(() => refresh());
});
test.after(async () => { await S?.close(); });

test("pill → summary sheet → jump to message", async () => {
  await A.goto(S.base + "/?nosw#/messages"); await A.waitForSelector(".cm-row");
  await A.goto(S.base + "/?nosw#/chat/" + g); await A.waitForSelector("#ai-pill", { timeout: 15000 });
  assert.match(await A.textContent("#ai-pill"), /لخّص لي اللي فاتني/);
  assert.ok(await A.isVisible("#cm-ai"), "✨ in the composer");
  await shot("1-pill");
  await A.click("#ai-pb"); await A.waitForSelector(".ai-pt");
  assert.match(await A.textContent("#ai-sb"), /الاجتماع الخميس/);
  await shot("2-summary");
  await A.evaluate(() => { window.__flash = 0; new MutationObserver((l) => { for (const m of l) if (m.target.classList?.contains("cm-flash")) window.__flash++; }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] }); });
  await A.click(".ai-pt[data-aigo]");
  await until(() => window.__flash > 0 && document.querySelector("#sheet").classList.contains("hidden"));
});

test("✨ suggested replies fill the box (not sent) and tones rewrite with undo", async () => {
  const before = await A.$$eval("#cm-thread .cm-m", (x) => x.length);
  await A.click("#cm-ai"); await A.waitForSelector("[data-rp]");
  await A.click("[data-rp]"); assert.equal(await A.inputValue("#cm-ta"), "تمام، أجهز العرض وأرسله الأربعاء");
  assert.equal(await A.$$eval("#cm-thread .cm-m", (x) => x.length), before, "nothing sent");
  await A.fill("#cm-ta", "اوكي بجهز العرض"); await A.dispatchEvent("#cm-ta", "input");
  await shot("3-replies");
  await A.click('[data-tone="kind"]'); await until(() => document.querySelector("#cm-ta").value === "أبشر، بجهز العرض إن شاء الله");
  await A.click("#ai-undo"); assert.equal(await A.inputValue("#cm-ta"), "اوكي بجهز العرض");
});

test("encrypted chats get no ✨", async () => {
  await A.goto(S.base + "/?nosw#/chat/" + enc); await A.waitForSelector("#cm-comp");
  await A.waitForTimeout(800);
  assert.equal(await A.$("#cm-ai"), null);
});

test("Settings switch turns it off and on", async () => {
  await A.goto(S.base + "/?nosw#/settings?s=privacy"); await A.waitForSelector("#msgai-sw", { state: "attached", timeout: 15000 });
  await until(() => document.querySelector("#msgai-sw").checked === true);
  await shot("4-settings");
  await A.evaluate(() => { const s = document.querySelector("#msgai-sw"); s.click(); });
  await until(async () => (await (await fetch("/api/aihub/messages/state")).json()).on === false);
  await A.goto(S.base + "/?nosw#/chat/" + g); await A.waitForSelector("#cm-ta"); await A.waitForTimeout(600);
  assert.equal(await A.$("#cm-ai"), null, "no ✨ when off");
  await A.goto(S.base + "/?nosw#/settings?s=privacy"); await A.waitForSelector("#msgai-sw", { state: "attached" });
  await until(() => document.querySelector("#msgai-sw").checked === false);
  await A.evaluate(() => document.querySelector("#msgai-sw").click());
  await until(async () => (await (await fetch("/api/aihub/messages/state")).json()).on === true);
  assert.deepEqual(errors, []);
});
