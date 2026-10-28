/* v2.135 «الذكاء في الرسائل» المرحلة 2 end-to-end (production build, phone width, fake model behind the AI Hub free allowance):
 * a scam-like message shows a red warning → «ليش؟» explains; the bubble's «ترجمة» button (paid service off) uses the free
 * AI Hub translator and toggles back; ✨ → «مواعيد ومهام» lists cited items with «أضف للتقويم» (an .ics download, nothing saved). */
const test = require("node:test"), assert = require("node:assert");
const path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE } = require("./harness");
const { id } = require("../../server/lib/core");

let firstMsg = "";
const fake = {
  label: "مجتمع بلس",
  async chat(messages) {
    const p = messages[messages.length - 1].content;
    if (p.startsWith("ترجم الرسالة")) return { text: JSON.stringify({ text: "نتمنى نعرض مجتمع+ في نشرتنا الأسبوع الجاي", from: "en" }) };
    if (p.startsWith("استخرج")) return { text: JSON.stringify({ items: [{ kind: "event", title: "مقابلة النشرة", date: "2026-11-05", time: "17:00", forMe: true, cites: [firstMsg] }, { kind: "task", title: "إرسال وصف ولقطتين", cites: [firstMsg] }] }) };
    if (p.startsWith("هل الرسالة")) return { text: JSON.stringify({ risk: "high", reasons: ["يطلب رمز تحقق"], advice: "لا ترسل الرمز لأي أحد" }) };
    if (p.includes("اقترح 3 ردود")) return { text: JSON.stringify({ replies: ["تمام", "أرد عليك بعدين", "شكراً"] }) };
    return { text: "{}" };
  }
};
let S, A, dm; const errors = [];
const SHOTS = process.env.SHOTS_DIR;
const shot = async (n) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await A.waitForTimeout(300); await A.screenshot({ path: path.join(SHOTS, n + ".png") }); };
const until = async (fn, arg, ms = 10000) => { const end = Date.now() + ms; for (;;) { if (await A.evaluate(fn, arg).catch(() => false)) return; if (Date.now() > end) throw new Error("timeout: " + fn); await A.waitForTimeout(150); } };

test.before(async () => {
  S = await startStack({ aihubOpts: { env: { AIHUB_SEAL_KEY: "e2e" }, freeProvider: fake } });
  const { db } = S.app.ctx, ago = (m) => new Date(Date.now() - m * 60e3).toISOString();
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce", acceptDownloads: true }); A = await ctx.newPage(); A.on("pageerror", (e) => errors.push(e.message));
  await onboard(A, S.base, "hemo_ai2", "هيمو");
  const me = (await A.evaluate(async () => (await (await fetch("/api/me")).json()).user.id));
  await db.run("UPDATE ai_link_usage SET requests=0").catch(() => { });
  const d = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,'daniel_ai2','Daniel Carter','','#1d4ed8','user',$2,$3)", [d, { onboarded: true }, ago(9000)]);
  dm = id("cv"); await db.run("INSERT INTO conversations(id,kind,created_at,updated_at) VALUES($1,'dm',$2,$2)", [dm, ago(60)]);
  await db.run("INSERT INTO conversation_members(conv,user_id,state,last_read_at) VALUES($1,$2,'accepted',$4),($1,$3,'accepted',$4)", [dm, d, me, ago(1)]);
  firstMsg = id("ms");
  await db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,'We would love to feature Mujtama+ in our newsletter next week',$4,'text')", [firstMsg, dm, d, ago(30)]);
  await db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,'لإعادة تفعيل حسابك أرسل رمز التحقق الذي وصلك خلال 10 دقائق',$4,'text')", [id("ms"), dm, d, ago(20)]);
  await A.evaluate(() => refresh());
});
test.after(async () => { await S?.close(); });

test("scam warning on the message, «ليش؟» explains", async () => {
  await A.goto(S.base + "/?nosw#/messages"); await A.waitForSelector(".cm-row");
  await A.goto(S.base + "/?nosw#/chat/" + dm); await A.waitForSelector(".ai-risk", { timeout: 15000 });
  assert.equal(await A.$$eval(".ai-risk", (x) => x.length), 1, "only the scam-like message");
  await shot("s2-1-risk");
  await A.click("[data-risk]"); await A.waitForSelector("#ai-rb .ai-sub");
  assert.match(await A.textContent("#ai-rb"), /خطر عالٍ/); assert.match(await A.textContent("#ai-rb"), /يطلب رمز تحقق/);
  await shot("s2-2-why");
  await A.click("#ai-rc");
});

test("the bubble's «ترجمة» uses the free messages translator, then shows the original again", async () => {
  const btn = `#cm-thread [data-id="${firstMsg}"] .mp-trb`;
  await A.waitForSelector(btn); await A.click(btn); await A.waitForSelector(".mp-tr-out:not([hidden])");
  assert.match(await A.textContent(".mp-tr-out"), /نشرتنا/);
  await shot("s2-3-translate");
  await A.click(btn); await until(() => document.querySelector(".mp-tr-out")?.hidden === true);
});

test("✨ → مواعيد ومهام → add to calendar downloads an .ics", async () => {
  await A.click("#cm-ai"); await A.waitForSelector("#ai-ex");
  await A.click("#ai-ex"); await A.waitForSelector(".ai-it [data-ics]");
  assert.equal(await A.$$eval("#ai-eb .ai-it", (x) => x.length), 2);
  await shot("s2-4-extract");
  const [dl] = await Promise.all([A.waitForEvent("download"), A.click("[data-ics]")]);
  const body = fs.readFileSync(await dl.path(), "utf8");
  assert.match(body, /DTSTART;TZID=Asia\/Riyadh:20261105T170000/); assert.match(body, /SUMMARY:مقابلة النشرة/);
  assert.deepEqual(errors, []);
});
