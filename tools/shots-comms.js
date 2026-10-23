/* Screenshots of the v2.7 chat + encryption screens (production build, lazy "comms" chunk), 390px.
 *   node tools/shots-comms.js <chat.png> <e2ee.png> [extraDir]
 * Two real browser users (نورة, بدر) with device keys exchange end-to-end encrypted messages through
 * MPComms; group members without a browser session are written through the app context.
 * extraDir also receives: list, requests, menu, info, group-info, safety, explainer, devices, new-group. */
/* global MPComms */
const path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE } = require("../tests/e2e/harness");
const { id } = require("../server/lib/core");
const PEOPLE = [["khaled_dev", "خالد العتيبي", "#1d4ed8"], ["reem_ai", "ريم المصري", "#be185d"], ["lyan_design", "ليان الزهراني", "#b45309"], ["omar_x", "عمر الشهري", "#6d28d9"]];
(async () => {
  const [chatPng, e2eePng, extra] = process.argv.slice(2);
  if (!chatPng || !e2eePng) throw new Error("usage: node tools/shots-comms.js <chat.png> <e2ee.png> [extraDir]");
  const S = await startStack(), { db } = S.app.ctx, ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const errors = [];
  // CSP forbids eval, so waitForFunction cannot be used: poll with evaluate instead
  const until = async (p, fn, arg, ms = 10000) => { const end = Date.now() + ms; for (;;) { if (await p.evaluate(fn, arg).catch(() => false)) return; if (Date.now() > end) throw new Error("timeout: " + fn); await p.waitForTimeout(150); } };
  const ctxA = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }), A = await ctxA.newPage();
  const ctxB = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }), B = await ctxB.newPage();
  for (const p of [A, B]) p.on("pageerror", e => errors.push(e.message));
  await onboard(B, S.base, "badr_dev", "بدر الغامدي");
  await onboard(A, S.base, "noura_jed", "نورة السبيعي");
  const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return r.json(); }, [m, u, b]);
  const me = async (p) => (await call(p, "GET", "/api/me")).user.id;
  const a = await me(A), b = await me(B);
  const u = {};
  for (const [handle, name, color] of PEOPLE) { u[handle] = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'',$4,'user',$5,$6)", [u[handle], handle, name, color, { onboarded: true, interests: [] }, ago(60 * 24 * 90)]); }
  for (const x of [...Object.values(u), b]) { await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [a, x, ago(5000)]); await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [x, a, ago(5000)]); }
  await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [b, u.khaled_dev, ago(5000)]); await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [u.khaled_dev, b, ago(5000)]);
  // both browsers open the messages screen: loads comms-core + comms, registers each device key
  for (const p of [A, B]) { await p.evaluate(() => refresh()); await p.goto(S.base + "/?nosw#/messages"); await p.waitForSelector(".cm-head h2"); await until(p, () => !!window.MPComms?.e2ee.thisDevice()); }

  /* ---- group chat (plaintext group, real sends from both browsers + seeded members) ---- */
  const g = (await call(A, "POST", "/api/chat/groups", { title: "فريق تطبيق جدة", members: [b, u.khaled_dev, u.reem_ai, u.lyan_design] })).conversation.id;
  const put = async (from, text, min, o = {}) => { const mid = id("ms"); await db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind,reply_to,meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [mid, g, from, text, ago(min), o.kind || "text", o.reply || null, o.meta || null]); return mid; };
  await db.run("UPDATE messages SET created_at=$1 WHERE conv=$2", [ago(60 * 26), g]);
  await put(u.khaled_dev, "صباح الخير يا فريق! رفعت نسخة الواجهة الجديدة على بيئة الاختبار", 60 * 25);
  await put(u.reem_ai, "ممتاز، سأجرب البحث العربي عليها اليوم", 60 * 25 - 2);
  await put(a, "تمام، أرسلوا لي أي ملاحظة عن الاتجاه من اليمين لليسار", 60 * 24 - 5);
  const q = await put(u.lyan_design, "اجتماع المراجعة غداً الساعة ٨ مساءً في مكتب الكورنيش؟", 50);
  await put(u.khaled_dev, "يناسبني، سأكون هناك", 48);
  await put(u.reem_ai, "وأنا كذلك، سأحضر الحاسوب للعرض", 47);
  const mine = await put(a, "اتفقنا، سأحجز القاعة", 30, { reply: q });
  await db.run("INSERT INTO message_reactions(msg,user_id,emoji,at) VALUES($1,$2,'❤️',$3),($1,$4,'❤️',$3),($1,$5,'❤️',$3)", [mine, u.lyan_design, ago(29), u.khaled_dev, u.reem_ai]);
  // B sends a real voice note (WAV) and A sends a real image (canvas JPEG) through MPComms
  await B.evaluate(async (g) => {
    const sr = 8000, n = sr * 7, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 9) * 6000 * Math.abs(Math.sin(i / 3000)), true);
    const wave = Array.from({ length: 48 }, (_, i) => Math.round(25 + 70 * Math.abs(Math.sin(i / 3.1)) * (0.5 + 0.5 * Math.sin(i / 7))));
    await MPComms.send(g, { kind: "voice", file: new Blob([buf], { type: "audio/wav" }), meta: { duration: 7, wave } });
  }, g);
  await A.evaluate(async (g) => {
    const c = document.createElement("canvas"); c.width = 800; c.height = 560; const x = c.getContext("2d");
    const gr = x.createLinearGradient(0, 0, 800, 560); gr.addColorStop(0, "#0e7490"); gr.addColorStop(1, "#6d3cf4"); x.fillStyle = gr; x.fillRect(0, 0, 800, 560);
    x.fillStyle = "#ffffffcc"; x.fillRect(80, 90, 640, 380); x.fillStyle = "#6d3cf4"; x.fillRect(110, 120, 580, 60); x.fillStyle = "#e9e6f2"; for (let i = 0; i < 4; i++) x.fillRect(110, 210 + i * 60, 580 - i * 90, 34);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
    await MPComms.send(g, { kind: "image", file: blob, text: "هذه لقطة من الشاشة الرئيسية", meta: { w: 800, h: 560 } });
  }, g);

  /* ---- message request from a stranger ---- */
  const stranger = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,'salem_q','سالم القرني','', '#0f766e','user',$2,$3)", [stranger, { onboarded: true }, ago(9000)]);
  const rc = id("cv"); await db.run("INSERT INTO conversations(id,created_at,updated_at) VALUES($1,$2,$2)", [rc, ago(90)]);
  await db.run("INSERT INTO conversation_members(conv,user_id,state) VALUES($1,$2,'accepted'),($1,$3,'request')", [rc, stranger, a]);
  await db.run("INSERT INTO messages(id,conv,sender,text,created_at) VALUES($1,$2,$3,'مرحباً نورة، رأيت مشاركتك عن ورشة التصميم. هل تقبلين سؤالاً سريعاً؟',$4)", [id("ms"), rc, stranger, ago(90)]);

  /* ---- end-to-end encrypted DM between the two browsers ---- */
  const dm = await A.evaluate(async (b) => (await MPComms.openDM(b)).id, b);
  await A.evaluate(async (dm) => MPComms.setTimer(dm, 3600), dm);
  await B.evaluate(async (dm) => MPComms.conversation(dm), dm); // prime B's conversation cache (see report: core getConv race)
  const dmRef = { id: dm, kind: "dm", e2ee: true, members: [a, b] }; // the same conversation object the UI passes to MPComms.send
  const send = (p, text, o = {}) => p.evaluate(async ([dm, text, o]) => (await MPComms.send(dm, { text, ...o })).id, [dmRef, text, o]);
  await send(B, "أهلاً نورة، هذه المحادثة صارت مشفرة بالكامل");
  const m1 = await send(A, "رائع! أرسل لي رمز الدخول لبيئة الاختبار هنا إذن");
  await send(B, "الرمز: PI-7342-JED، صالح حتى نهاية الأسبوع", { replyTo: m1 });
  await send(A, "وصلني، شكراً يا بدر");
  await B.goto(S.base + "/?nosw#/chat/" + dm); await B.waitForSelector(".cm-comp textarea");
  await B.waitForTimeout(800);

  const shot = async (name, file) => { await A.waitForTimeout(600); const out = file || (extra && path.join(extra, name + ".png")); if (!out) return; fs.mkdirSync(path.dirname(out), { recursive: true }); await A.screenshot({ path: out }); };
  await A.goto(S.base + "/?nosw#/messages"); await A.waitForSelector(".cm-row"); await shot("list");
  await A.goto(S.base + "/?nosw#/messages?tab=requests"); await A.waitForSelector(".cm-req"); await shot("requests");
  await A.goto(S.base + "/?nosw#/chat/" + g); await A.waitForSelector(".cm-voice"); await until(A, () => document.querySelector(".cm-img")?.complete && document.querySelector(".cm-img").naturalWidth > 0);
  await A.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await shot("chat", chatPng);
  if (extra) {
    await A.evaluate(() => scrollTo(0, 0)); await shot("chat-top");
    await A.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await A.click(".cm-m.them .cm-b", { button: "right" }); await A.waitForSelector(".cm-pick"); await shot("menu"); await A.evaluate(() => closeSheet());
    await A.goto(S.base + "/?nosw#/chatinfo/" + g); await A.waitForSelector(".cm-hero"); await shot("group-info");
  }
  await A.goto(S.base + "/?nosw#/chat/" + dm); await A.waitForSelector(".cm-e2ee"); await until(A, () => document.querySelectorAll("#cm-thread .cm-m").length >= 4);
  await B.focus(".cm-comp textarea"); await B.keyboard.type("تمام", { delay: 40 }); await A.waitForSelector(".cm-typing", { timeout: 5000 }).catch(() => { });
  await shot("e2ee", e2eePng);
  if (extra) {
    await A.goto(S.base + "/?nosw#/chatinfo/" + dm); await A.waitForSelector(".cm-hero"); await shot("info");
    await A.goto(S.base + "/?nosw#/safety/" + b); await A.waitForSelector(".cm-code"); await A.waitForSelector("#sf-qr svg"); await shot("safety");
    await A.goto(S.base + "/?nosw#/e2ee"); await A.waitForSelector(".cm-step"); await shot("explainer");
    await A.goto(S.base + "/?nosw#/devices"); await A.waitForSelector(".cm-sec"); await shot("devices");
    await A.goto(S.base + "/?nosw#/newgroup"); await A.waitForSelector("#pp-l .cm-li"); await A.fill("#ng-t", "رحلة العُلا"); await A.click("#pp-l .cm-li"); await A.click("#pp-l .cm-li:nth-child(2)"); await shot("new-group");
  }
  if (errors.length) console.error("page errors:", errors);
  await S.close(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
