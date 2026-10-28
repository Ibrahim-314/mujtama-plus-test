/* Design mockup only (not shipped): how the messages AI button would look. Real chat screen, with the AI pieces injected.
 *   node tools/shots-chat-ai-mock.js <outDir> */
const path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE } = require("../tests/e2e/harness");
const { id } = require("../server/lib/core");
const PEOPLE = [["khaled_dev", "خالد العتيبي", "#1d4ed8"], ["reem_ai", "ريم المصري", "#be185d"], ["lyan_design", "ليان الزهراني", "#b45309"]];
const CSS = `
.ai-sp{width:22px;height:22px}
.ai-ib{background:linear-gradient(135deg,#6d3cf4,#c04cf0)!important;color:#fff!important;box-shadow:0 4px 14px -4px #6d3cf499}
.ai-pill{position:fixed;inset-inline:0;bottom:calc(76px + env(safe-area-inset-bottom));z-index:31;display:flex;justify-content:center;pointer-events:none}
.ai-pill button{pointer-events:auto;display:inline-flex;align-items:center;gap:8px;padding:9px 16px 9px 14px;border-radius:999px;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);background:var(--card);color:var(--accent-ink);font:600 14px/1.2 inherit;box-shadow:0 10px 28px -10px #6d3cf466,var(--sh-1)}
.ai-pill .ai-sp{width:18px;height:18px;color:var(--accent)}
.ai-pill small{color:var(--muted);font-weight:500}
.ai-sheet-bg{position:fixed;inset:0;background:#0007;z-index:60}
.ai-sheet{position:fixed;inset-inline:0;bottom:0;z-index:61;background:var(--card);color:var(--text);border-radius:24px 24px 0 0;padding:10px 18px 22px;box-shadow:var(--sh-3)}
.ai-grab{width:40px;height:5px;border-radius:9px;background:var(--line-2);margin:0 auto 12px}
.ai-h{display:flex;align-items:center;gap:8px;font-weight:700;font-size:17px;margin-bottom:4px}
.ai-h .ai-sp{color:var(--accent)}
.ai-sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.ai-pt{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border-radius:14px;background:var(--bg-2);margin-bottom:8px;font-size:15px;line-height:1.6}
.ai-pt b{color:var(--accent-ink)}
.ai-pt .go{margin-inline-start:auto;color:var(--muted);font-size:12px;white-space:nowrap;padding-top:3px}
.ai-pt.todo{background:color-mix(in srgb,var(--accent) 12%,var(--bg-2))}
.ai-row{display:flex;gap:8px;margin-top:12px}
.ai-btn{flex:1;padding:12px;border-radius:14px;border:0;font:600 15px inherit;background:var(--accent);color:#fff}
.ai-btn.ghost{background:var(--bg-2);color:var(--text)}
.ai-note{font-size:12px;color:var(--muted);text-align:center;margin-top:10px}
.ai-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:9px;flex:none}
.toast,.toasts,#toast,#toasts{display:none!important}
.ai-sugg{display:flex;flex-wrap:wrap;gap:8px;padding:2px 2px 8px;scrollbar-width:none}
.ai-sugg .lbl{display:inline-flex;align-items:center;gap:4px;color:var(--accent);font-size:13px;font-weight:600;white-space:nowrap}
.ai-sugg .lbl .ai-sp{width:16px;height:16px}
.ai-chip{white-space:nowrap;padding:8px 14px;border-radius:999px;border:1px solid var(--line-2);background:var(--card);color:var(--text);font:500 14px inherit}
.ai-tone{display:flex;gap:6px;padding:0 2px 8px}
.ai-tone .ai-chip{padding:6px 12px;font-size:13px;color:var(--accent-ink);border-color:color-mix(in srgb,var(--accent) 30%,transparent);background:color-mix(in srgb,var(--accent) 8%,var(--card))}
`;
const SP = `<svg class="ai-sp" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 15l.9 2.1 2.1.9-2.1.9L19 21l-.9-2.1-2.1-.9 2.1-.9z" opacity=".75"/></svg>`;
(async () => {
  const out = process.argv[2]; if (!out) throw new Error("usage: node tools/shots-chat-ai-mock.js <outDir>"); fs.mkdirSync(out, { recursive: true });
  const S = await startStack(), { db } = S.app.ctx, ago = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const until = async (p, fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { if (await p.evaluate(fn).catch(() => false)) return; if (Date.now() > end) throw new Error("timeout"); await p.waitForTimeout(150); } };
  for (const theme of ["light", "dark"]) {
    const ctx = await S.browser.newContext({ ...MOBILE, colorScheme: theme, reducedMotion: "reduce" }), A = await ctx.newPage();
    await onboard(A, S.base, "noura_" + theme, "نورة السبيعي");
    const call = (m, u, b) => A.evaluate(async ([m, u, b]) => (await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined })).json(), [m, u, b]);
    const a = (await call("GET", "/api/me")).user.id, u = {};
    for (const [handle, name, color] of PEOPLE) { u[handle] = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'',$4,'user',$5,$6)", [u[handle], handle + "_" + theme, name, color, { onboarded: true, interests: [] }, ago(90000)]); await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3),($2,$1,$3) ON CONFLICT DO NOTHING", [a, u[handle], ago(5000)]); }
    await A.evaluate(() => refresh()); await A.goto(S.base + "/?nosw#/messages"); await A.waitForSelector(".cm-head h2");
    const g = (await call("POST", "/api/chat/groups", { title: "فريق تطبيق جدة", members: Object.values(u) })).conversation.id;
    await db.run("UPDATE messages SET created_at=$1 WHERE conv=$2", [ago(60 * 30), g]);
    const msgs = [[u.khaled_dev, "صباح الخير يا فريق! رفعت نسخة الواجهة الجديدة على بيئة الاختبار"], [u.reem_ai, "ممتاز، سأجرب البحث العربي عليها اليوم"],
      [u.lyan_design, "نسوي اجتماع المراجعة الخميس الساعة ٨ مساءً؟"], [u.khaled_dev, "يناسبني"], [u.reem_ai, "وأنا كذلك، بس نخليه في مكتب الكورنيش بدل الأونلاين"],
      [u.lyan_design, "تمام الكورنيش. نورة تقدرين تجهزين ملف العرض؟"], [u.khaled_dev, "ونحتاج قرار في لون الأزرار قبل الخميس"], [u.reem_ai, "@نورة لما تشوفين الرسايل ردي علينا"]];
    let t = 60 * 6; for (const [from, text] of msgs) { await db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind) VALUES($1,$2,$3,$4,$5,'text')", [id("ms"), g, from, text, ago(t)]); t -= 25; }
    await A.goto(S.base + "/?nosw#/chat/" + g); await until(A, () => document.querySelectorAll("#cm-thread .cm-m").length >= 8 && !!document.querySelector("#cm-ta"));
    await A.addStyleTag({ content: CSS });
    await A.evaluate((SP) => { scrollTo(0, document.documentElement.scrollHeight); const att = document.querySelector("#cm-att"); att.insertAdjacentHTML("afterend", `<button class="cm-ib ai-ib" aria-label="مساعد الذكاء">${SP}</button>`); }, SP);
    const shot = async (n) => { await A.waitForTimeout(500); await A.screenshot({ path: path.join(out, `${n}-${theme}.png`) }); };
    // 1) the pill (appears only when you have many unread) + the ✨ button in the composer
    await A.evaluate((SP) => document.body.insertAdjacentHTML("beforeend", `<div class="ai-pill" id="ai-pill"><button>${SP} لخّص لي اللي فاتني <small>· ٨ رسائل</small></button></div>`), SP);
    await shot("1-button");
    // 2) tapping the pill → summary sheet
    await A.evaluate((SP) => { document.getElementById("ai-pill").remove(); document.body.insertAdjacentHTML("beforeend", `<div class="ai-sheet-bg" id="ai-bg"></div><div class="ai-sheet" id="ai-sh"><div class="ai-grab"></div>
      <div class="ai-h">${SP} اللي فاتك في «فريق تطبيق جدة»</div><p class="ai-sub">٨ رسائل · آخر ٦ ساعات</p>
      <div class="ai-pt"><span class="ai-dot"></span><span>اتفقوا على <b>اجتماع المراجعة الخميس ٨ مساءً</b> في مكتب الكورنيش.</span><span class="go">الرسالة ←</span></div>
      <div class="ai-pt todo"><span class="ai-dot"></span><span><b>مطلوب منك:</b> تجهيز ملف العرض، وريم تنتظر ردك.</span><span class="go">الرسالة ←</span></div>
      <div class="ai-pt"><span class="ai-dot"></span><span>خالد يحتاج قرار في <b>لون الأزرار</b> قبل الخميس.</span><span class="go">الرسالة ←</span></div>
      <div class="ai-row"><button class="ai-btn">اقترح لي رد</button><button class="ai-btn ghost">ذكّرني بالاجتماع</button></div>
      <p class="ai-note">يعمل فقط لما تضغط · ما ينحفظ شي من المحادثة</p></div>`); }, SP);
    await shot("2-summary");
    // 3) tapping the ✨ in the composer → suggested replies + improve-my-message tones
    await A.evaluate((SP) => { document.getElementById("ai-bg").remove(); document.getElementById("ai-sh").remove();
      const box = document.querySelector("#cm-comp > div"); box.insertAdjacentHTML("afterbegin", `<div class="ai-sugg"><span class="lbl">${SP} ردود مقترحة</span><button class="ai-chip">تمام، أجهز العرض وأرسله الأربعاء</button><button class="ai-chip">أشوف الألوان وأرد عليكم الليلة</button><button class="ai-chip">الخميس يناسبني</button></div>`);
      const ta = document.querySelector("#cm-ta"); ta.value = "اوكي بجهز العرض"; ta.dispatchEvent(new Event("input"));
      document.querySelector(".ai-sugg").insertAdjacentHTML("afterend", `<div class="ai-tone"><button class="ai-chip">ألطف</button><button class="ai-chip">أقصر</button><button class="ai-chip">أرسمي</button><button class="ai-chip">صحّح الإملاء</button></div>`);
      scrollTo(0, document.documentElement.scrollHeight); }, SP);
    await shot("3-replies");
    await ctx.close();
  }
  await S.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
