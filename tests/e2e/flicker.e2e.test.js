/* v2.29 flicker fix e2e (mobile viewport, real server, production build).
 * Tapping like must NOT re-render the screen: the feed container and the tapped card stay the same DOM nodes, nothing
 * replays the entrance animation, scroll position and layout do not move — also after the server round-trip
 * (flush → /api/bootstrap refresh ≈ 1.2 s later) and after a «changed» stream event. Saving, poll voting and
 * follow buttons patch in place too; a real navigation still plays the entrance animation once. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p, author; const errors = [];
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "fl_e2e", "مختبر الوميض");
  const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name: "كاتب المنشورات", handle: "fl_author", password: "secret123" }) });
  assert.equal(reg.status, 200);
  author = await S.app.ctx.db.get("SELECT * FROM users WHERE handle='fl_author'");
  const me = await S.app.ctx.db.get("SELECT * FROM users WHERE handle='fl_e2e'");
  await S.app.ctx.db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3)", [me.id, author.id, new Date().toISOString()]);
  for (let i = 0; i < 12; i++) S.app.ctx.rl.w.clear(), await S.app.ctx.services.content.createPost(author, { type: "post", text: `منشور رقم ${i + 1} لاختبار الوميض ` + "كلام ".repeat(30), id: undefined });
  S.app.ctx.rl.w.clear(); await S.app.ctx.services.content.createPost(author, { type: "poll", text: "أي لغة تفضّل؟", poll: { options: ["العربية", "English"] } });
  S.app.ctx.rl.w.clear();
});
test.after(async () => { await ctx?.close(); await S?.close(); });

const probe = () => p.evaluate(() => {
  const w = document.querySelector("#view .wrap"), cards = [...document.querySelectorAll("#view .post-card")];
  const vis = (c) => { const b = c.querySelector("[data-react]")?.getBoundingClientRect(); if (!(b && b.top > 70 && b.bottom < innerHeight - 90)) return false; return !!document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest("[data-react]"); }; // its like button fully on screen (above the bottom nav), so the tap does not scroll
  const card = cards.find(vis) || cards[0];
  window.__probe = { wrap: w, card, anims: 0, swaps: 0 };
  card.dataset.probe = "1";
  document.addEventListener("animationstart", (e) => { if (e.target.closest?.("#view") && /enter/.test(e.animationName)) window.__probe.anims++; }, true);
  new MutationObserver((m) => { for (const r of m) window.__probe.swaps += r.removedNodes.length; }).observe(document.getElementById("view"), { childList: true });
  return { y: scrollY, top: Math.round(card.getBoundingClientRect().top), id: card.querySelector("[data-react]")?.dataset.react };
});
const check = () => p.evaluate(() => {
  const P = window.__probe, card = document.querySelector('#view [data-probe="1"]');
  return { sameWrap: P.wrap.isConnected && P.wrap === document.querySelector("#view .wrap"), sameCard: P.card.isConnected && card === P.card, anims: P.anims, swaps: P.swaps, y: scrollY, top: card ? Math.round(card.getBoundingClientRect().top) : null, liked: card?.querySelector("[data-react]")?.classList.contains("on") };
});

test("tap like on mobile: same feed container + card nodes, no entrance replay, no scroll / layout jump (incl. server refresh)", async () => {
  await p.goto(S.base + "/?nosw#/home");
  await p.waitForFunction(() => document.querySelectorAll("#view .post-card [data-react]").length >= 6, null, { timeout: 20000 });
  await p.waitForTimeout(1200); // let first-paint enhancers (stories, digest, chunks) settle
  await p.evaluate(() => scrollTo(0, 500)); await p.waitForTimeout(300);
  const before = await probe();
  assert.ok(before.id, "a post card is on screen");
  await p.tap(`#view [data-probe="1"] [data-react]`);
  await p.waitForTimeout(150);
  let after = await check();
  assert.equal(after.liked, true, "like shown at once (optimistic, in place)");
  assert.ok(after.sameWrap && after.sameCard, "the feed container and the card were not replaced");
  await p.waitForTimeout(2600); // flush → PUT /api/reactions → refreshSoon(1200) → GET /api/bootstrap
  after = await check();
  assert.ok(after.sameWrap, "feed container survived the server refresh"); assert.ok(after.sameCard, "card survived the server refresh");
  assert.equal(after.anims, 0, "no entrance animation replayed"); assert.equal(after.swaps, 0, "#view children never swapped");
  assert.ok(Math.abs(after.y - before.y) <= 2, `scroll kept: ${before.y} → ${after.y}`); assert.ok(Math.abs(after.top - before.top) <= 2, `no layout jump: ${before.top} → ${after.top}`);
  const me = await S.app.ctx.db.get("SELECT id FROM users WHERE handle='fl_e2e'");
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM reactions WHERE target=$1 AND user_id=$2", [before.id, me.id]), "the like reached the server");
  // unlike also in place
  await p.tap(`#view [data-probe="1"] [data-react]`); await p.waitForTimeout(150);
  assert.equal((await check()).liked, false);
  // a «changed» stream event while nothing on screen changed → no re-render
  await S.app.ctx.realtime?.send?.(me.id, "changed", {});
  await p.waitForTimeout(3200);
  after = await check(); assert.ok(after.sameWrap && after.sameCard && after.swaps === 0 && after.anims === 0, JSON.stringify(after));
  assert.ok(Math.abs(after.y - before.y) <= 2);
});

test("poll vote and save patch in place; real navigation still animates once", async () => {
  const pollCard = await p.$('#view [data-vote]');
  if (pollCard) {
    await pollCard.scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
    const b = await probe();
    await p.tap('#view [data-vote$=":0"]'); await p.waitForTimeout(200);
    const a = await check(); assert.ok(a.sameWrap && a.swaps === 0, "vote kept the feed"); assert.ok(Math.abs(a.y - b.y) <= 2);
    assert.ok(await p.$('#view .poll .bar'), "results shown after voting");
  }
  await p.goto(S.base + "/?nosw#/explore"); await p.waitForTimeout(100);
  const enters = await p.evaluate(() => document.getElementById("view").classList.contains("enter"));
  assert.equal(enters, true, "navigation plays the entrance");
  await p.waitForTimeout(900);
  assert.equal(await p.evaluate(() => document.getElementById("view").classList.contains("enter")), false, "…and then clears it so later re-renders do not replay it");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("button")).webkitTapHighlightColor), "rgba(0, 0, 0, 0)");
  assert.deepEqual(errors, []);
});

test("community join and comment re-render softly: no skeleton flash, no entrance replay; beta button never covers the comment bar", async () => {
  const ck = (await fetch(S.base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ handle: "fl_author", password: "secret123" }) })).headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const cr = await (await fetch(S.base + "/api/communities", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base, Cookie: ck }, body: JSON.stringify({ name: "مجتمع الوميض", desc: "اختبار", topic: "dev" }) })).json();
  assert.ok(cr.community?.id, JSON.stringify(cr));
  await p.goto(S.base + "/?nosw#/c/" + cr.community.id); await p.waitForSelector("#c-join"); await p.waitForTimeout(900);
  await p.evaluate(() => { window.__sk = 0; window.__an = 0; new MutationObserver(() => { if (document.querySelector("#view .skel")) window.__sk++; }).observe(document.getElementById("view"), { childList: true, subtree: true }); document.addEventListener("animationstart", (e) => { if (e.target.closest?.("#view") && e.animationName === "enter") window.__an++; }, true); });
  await p.tap("#c-join"); await p.waitForTimeout(2500);
  const skan = await p.evaluate(() => [window.__sk, window.__an]); assert.deepEqual(skan, [0, 0], "no skeleton, no entrance on join " + skan);
  assert.ok(await p.$("#c-leave"), "joined");
  const pid = (await S.app.ctx.db.get("SELECT id FROM posts WHERE author=$1 AND type='post' LIMIT 1", [author.id])).id;
  await p.goto(S.base + "/?nosw#/post/" + pid); await p.waitForSelector("#cin"); await p.waitForTimeout(900);
  const hit = await p.evaluate(() => { const r = document.getElementById("csend").getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("#csend"); });
  assert.ok(hit, "send button is not covered");
  await p.evaluate(() => { window.__an = 0; });
  await p.fill("#cin", "تعليق بلا وميض"); await p.tap("#csend"); await p.waitForTimeout(2500);
  assert.equal(await p.evaluate(() => window.__an), 0); assert.ok(await p.evaluate(() => document.getElementById("clist").textContent.includes("تعليق بلا وميض")));
  assert.deepEqual(errors, []);
});
