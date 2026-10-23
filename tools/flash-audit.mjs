/* v2.29 flash audit (dev tool): drives the production build on a phone viewport through common taps on every main
 * screen and reports anything that looks like a flash: replayed entrance animations, #view children swapped,
 * scroll jumps, layout shifts and images re-created (blank while they decode). Usage: node tools/flash-audit.mjs */
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const { startStack, onboard, MOBILE } = require("../tests/e2e/harness.js");
const S = await startStack(); const ctx = await S.browser.newContext({ ...MOBILE }); const p = await ctx.newPage();
p.setDefaultTimeout(4000); const errs = []; p.on("pageerror", e => errs.push(e.message));
const j = (m, path, body, h = {}) => fetch(S.base + path, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, ...h }, body: body && JSON.stringify(body) });
await onboard(p, S.base, "fa_me", "مدقق الوميض");
const db = S.app.ctx.db, svc = S.app.ctx.services;
const reg = await j("POST", "/api/auth/register", { name: "سارة الكاتبة", handle: "fa_sara", password: "secret123" }); const ck = reg.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
const cr = await (await j("POST", "/api/communities", { name: "مجتمع التجربة", desc: "للتجربة", topic: "dev" }, { Cookie: ck })).json(); const CID = cr.community?.id;
const sara = await db.get("SELECT * FROM users WHERE handle='fa_sara'"), me = await db.get("SELECT * FROM users WHERE handle='fa_me'");
await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [me.id, sara.id, new Date().toISOString()]);
for (let i = 0; i < 8; i++) { S.app.ctx.rl.w.clear(); await svc.content.createPost(sara, { type: "post", text: `منشور ${i + 1} ` + "نص ".repeat(25) }); }
S.app.ctx.rl.w.clear(); await svc.content.createPost(sara, { type: "poll", text: "سؤال؟", poll: { options: ["أ", "ب"] } });
S.app.ctx.rl.w.clear();
const arm = () => p.evaluate(() => {
  const v = document.getElementById("view"); window.__fa = { names: [], anims: 0, swaps: 0, shifts: 0, imgs: 0, y: scrollY };
  if (!window.__faL) window.__faL = 1, document.addEventListener("animationstart", e => { if (e.target.closest?.("#view")) { window.__fa.anims++; if (window.__fa.names.length < 4) window.__fa.names.push(e.animationName + ":" + (e.target.className || e.target.tagName).toString().slice(0, 30)); } }, true);
  window.__mo?.disconnect(); window.__mo = new MutationObserver(m => { for (const r of m) { if (r.target === v) window.__fa.swaps += r.removedNodes.length; for (const n of r.addedNodes) if (n.nodeType === 1) for (const im of [n, ...n.querySelectorAll("img")]) if (im.tagName === "IMG" && !im.complete) window.__fa.imgs++; } }); window.__mo.observe(v, { childList: true, subtree: true });
  window.__po?.disconnect(); window.__po = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__fa.shifts += e.value; }); window.__po.observe({ type: "layout-shift" });
});
const read = () => p.evaluate(() => ({ ...window.__fa, dy: Math.round(scrollY - window.__fa.y), shifts: +window.__fa.shifts.toFixed(3) }));
const out = [];
async function step(name, act, wait = 1800) { await arm(); try { await act(); } catch (e) { out.push([name, "ERR " + e.message.split("\n")[0]]); console.log(name, out.at(-1)[1]); return; } await p.waitForTimeout(wait); out.push([name, JSON.stringify(await read())]); console.log(name.padEnd(36), out.at(-1)[1]); }
async function go(h) { await p.goto(S.base + "/?nosw#" + h); await p.waitForTimeout(1500); }
await go("/home"); await p.evaluate(() => scrollTo(0, 300)); await p.waitForTimeout(1400);
await step("home: like", () => p.click("#view .post-card [data-react]"), 3000);
await step("home: save sheet + save", async () => { await p.click("#view [data-save]"); await p.waitForTimeout(400); await p.click("#sheet [data-c]"); });
await step("home: poll vote", () => p.click('#view [data-vote$=":1"]'));
await step("home: feed mode tab", () => p.click("#view [data-mode]:not(.on)"));
await step("home: open more sheet", async () => { await p.click("#view [data-more]"); await p.waitForTimeout(500); await p.keyboard.press("Escape"); });
await go("/u/fa_sara");
await step("profile: follow", () => p.click("#view [data-follow]"), 3000);
await step("profile: like", () => p.click("#view [data-react]"), 3000);
await step("profile: tab", () => p.click("#view [data-pt]:not(.on)"));
await go("/me"); await step("me: tab", () => p.click("#view [data-pt]:nth-child(2)"));
await go("/communities"); await step("communities: category tab", () => p.click("#view [data-cat]:not(.on)"));
const cid = CID && "#/c/" + CID;
if (cid) { await go(cid.slice(1)); await step("community: tab", () => p.click("#view [data-ctab=members]")); await step("community: join toggle", () => p.click("#c-join"), 3000); await step("community: tab back", () => p.click("#view [data-ctab=posts]")); }
const post = (await db.get("SELECT id FROM posts WHERE author=$1 AND type='post' LIMIT 1", [sara.id])).id;
await go("/post/" + post);
await p.screenshot({ path: "/workspace/work/fa-post.png" }); console.log("cin", await p.evaluate(() => { const r = document.querySelector("#cin").getBoundingClientRect(); return JSON.stringify(r) + document.elementFromPoint(r.x + 20, r.y + 10)?.outerHTML.slice(0, 80); }));
await step("post: comment", async () => { await p.fill("#cin", "تعليق تجريبي جميل"); await p.click("#csend"); }, 3000);
await step("post: like comment", () => p.click("#view [data-cr]"), 3000);
await step("post: sort", () => p.click("#view [data-sort]:not(.on)"));
await step("post: like post", () => p.click("#view [data-react]"), 3000);
await go("/notifications"); await step("notifications: idle (SSE/refresh)", async () => { }, 3000);
await go("/messages"); await step("messages: idle", async () => { }, 3000);
await go("/explore"); await step("explore: idle", async () => { }, 2500);
await go("/market"); await step("market: idle", async () => { }, 2500);
await step("market: tab/filter", () => p.click("#view [data-mk-cat=books]"), 2000);
await go("/home"); await step("home: idle 4s (stream/refresh)", async () => { }, 4000);
console.log("errors:", errs);
await ctx.close(); await S.close();
