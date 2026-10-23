/* v2.78 — «تحدي الأسبوع» (v278-challenges).
 * 390 light RTL staff: «تحدٍّ جديد» form → the challenge page (hero, tag, countdown) → «شارك بلقطة» opens the Vidtik editor
 * with «#tag » in the caption; tagged clips show up ranked (gold #1), the feed has the pill under the tabs and the
 * «مشارك في التحدي» chip on a taking-part clip; the pill hides in clean-screen mode. axe clean on the list, form and page.
 * 1440 dark EN member: no staff controls, «Join with a clip», Newest tab, a past challenge shows its winners podium;
 * the menu has the entry. No page errors anywhere. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S, cid;
const TAG = "تحدي_الرسم";
test.before(async () => {
  S = await startStack({ fakeVideoMs: 1 });
});
test.after(async () => {
  await S.close();
});
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
const axe = async (p, sel) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async sel =>
    (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ")).join(", ")), sel);
};
const seedClips = async (p, n, prefix) => {
  S.app.ctx.rl?.w?.clear?.();
  const made = await p.evaluate(async ([h, n, tag]) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = await fetch("/api/posts", { method: "POST", headers: h, body: JSON.stringify({ type: "video", visibility: "public", text: "رسمتي " + (i + 1) + " #" + tag, media: "linear-gradient(135deg, #335, #669)", video: { short: true, source: "clips", duration: 12 } }) });
      out.push((await r.json()).post?.id || null);
    }
    return out;
  }, [H, n, TAG]);
  assert.ok(made.every(Boolean), "clips created " + JSON.stringify(made));
  await new Promise(r => setTimeout(r, 100));
  const db = S.app.ctx.db;
  for (let i = 0; i < made.length; i++) {
    const row = await db.get("SELECT data FROM posts WHERE id=$1", [made[i]]);
    const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    d.video = { ...d.video, status: "ready", variants: { "360p": "/media/none-c" + i + ".mp4", poster: "" } };
    const id = prefix + i;
    await db.run("DELETE FROM post_hashtags WHERE post_id=$1", [made[i]]);
    await db.run("UPDATE posts SET id=$1, status='published', data=$2, created_at=$3 WHERE id=$4", [id, d, new Date(Date.now() - i * 100).toISOString(), made[i]]);
    await db.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3)", [id, TAG, new Date().toISOString()]);
  }
};

test("390 light RTL staff: create, page, join prefill, ranked grid, feed pill + chip", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "chl_staff", "مشرفة التحديات");
  const me = await p.evaluate(() => DB.me);
  await S.app.ctx.db.run("UPDATE users SET role='admin' WHERE id=$1", [me]);
  await p.evaluate(() => { location.hash = "#/clips/challenges"; });
  await p.waitForSelector('[data-clc="new"]', { timeout: 20000 });
  assert.deepEqual(await axe(p, ".clc"), []);
  await p.click('[data-clc="new"]');
  await p.waitForSelector(".clc-form");
  await p.fill("#clc-title", "تحدي الرسم السريع");
  await p.fill("#clc-tag", "#" + TAG);
  await p.fill("#clc-body", "ارسم شيئاً في دقيقة واحدة");
  await p.click('.clc-quick [data-days="7"]');
  assert.deepEqual(await axe(p, ".clc-form"), []);
  await p.click('.clc-form [type="submit"]');
  await p.waitForSelector(".clc-hero", { timeout: 15000 });
  cid = decodeURIComponent((await p.evaluate(() => location.hash)).split("/").pop());
  assert.match(cid, /^chl_/);
  assert.match(await p.textContent(".clc-hero-tag"), new RegExp(TAG));
  assert.match(await p.textContent("[data-clc-when]"), /ينتهي بعد/);
  assert.match(await p.textContent(".page-head h2"), /تحدي الرسم السريع/);
  const join = await p.getAttribute(".clc-join", "href");
  assert.equal(join, "#/clips/create?tag=" + encodeURIComponent(TAG));
  const jb = await p.$eval(".clc-join", b => b.getBoundingClientRect());
  assert.ok(jb.height >= 44, "join target size");
  assert.ok(await p.$('[data-clc="cancel"]'), "staff sees cancel");
  assert.deepEqual(await axe(p, ".clc"), []);
  // join → editor caption prefilled
  await p.click(".clc-join");
  await p.waitForSelector("#vt-cap", { state: "attached", timeout: 15000 });
  assert.match(await p.textContent(".vt-chl-note"), new RegExp(TAG));
  assert.equal(await p.inputValue("#vt-cap"), "#" + TAG + " ");
  // tagged clips appear ranked
  await seedClips(p, 3, "chlc_");
  const db = S.app.ctx.db;
  for (let i = 0; i < 2; i++) await db.run("INSERT INTO users(id,handle,name,created_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", ["lkx" + i, "likerx" + i, "معجب", new Date().toISOString()]);
  await db.run("INSERT INTO reactions(target,user_id,type,at) VALUES('chlc_2','lkx0','like',$1),('chlc_2','lkx1','like',$1)", [new Date().toISOString()]);
  await p.evaluate(id => { location.hash = "#/clips/challenge/" + encodeURIComponent(id); }, cid);
  await p.waitForSelector(".clc-grid li", { timeout: 15000 });
  assert.equal(await p.$$eval(".clc-grid li", li => li.length), 1, "top keeps each creator's best clip once");
  assert.equal(await p.getAttribute(".clc-grid li a", "href"), "#/clips?start=chlc_2");
  assert.ok(await p.$(".clc-grid .clc-rank-1"));
  assert.match(await p.textContent(".clc-me"), /#1/);
  await p.click('[data-sort="new"]');
  await p.waitForFunction(() => document.querySelectorAll(".clc-grid li").length === 3, null, { timeout: 10000 });
  assert.equal(await p.getAttribute('[data-sort="new"]', "aria-selected"), "true");
  // feed: pill under the tabs + chip on a taking-part clip
  await p.evaluate(() => { location.hash = "#/shorts?start=chlc_0"; });
  await p.waitForSelector(".cl-chl-pill", { timeout: 20000 });
  assert.equal(await p.getAttribute(".cl-chl-pill", "href"), "#/clips/challenge/" + encodeURIComponent(cid));
  await p.waitForSelector('.short[data-short="chlc_0"] .cl-chl-chip', { timeout: 10000 });
  const pill = await p.$eval(".cl-chl-pill", a => a.getBoundingClientRect()), tabs = await p.$eval(".cl-tabs", a => a.getBoundingClientRect());
  assert.ok(pill.top >= tabs.bottom - 2, "pill sits under the tabs");
  await p.evaluate(() => document.body.classList.add("cl-clean"));
  await p.waitForTimeout(350);
  assert.equal(await p.$eval(".cl-chl-pill", a => getComputedStyle(a).visibility), "hidden");
  await p.evaluate(() => document.body.classList.remove("cl-clean"));
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark EN member: no staff controls, newest tab, past winners, menu entry", async () => {
  const db = S.app.ctx.db, at = new Date().toISOString();
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "chl_member", "Member");
  const me = await p.evaluate(() => DB.me);
  // a finished challenge won by the staff member's clip
  await db.run("INSERT INTO clip_challenges(id,title,tag,body,starts_at,ends_at,status,created_by,created_at,updated_at) VALUES('chl_past','تحدي الأمس','رسم_الامس','',$1,$2,'active',$3,$4,$4)", [new Date(Date.now() - 8 * 864e5).toISOString(), new Date(Date.now() - 864e5).toISOString(), me, at]);
  await db.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES('chlc_2','رسم_الامس',$1)", [at]);
  await db.run("UPDATE posts SET created_at=$1 WHERE id='chlc_2'", [new Date(Date.now() - 3 * 864e5).toISOString()]);
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = "#/clips/challenges"; });
  await p.waitForSelector(".clc-card-big", { timeout: 20000 });
  assert.equal(await p.$('[data-clc="new"]'), null, "members get no staff button");
  assert.match(await p.textContent(".clc"), /Current challenge/);
  assert.match(await p.textContent(".clc"), /Past challenges/);
  await p.waitForSelector('.clc-card[href="#/clips/challenge/chl_past"] .clc-av-1');
  assert.deepEqual(await axe(p, ".clc"), []);
  await p.click('.clc-card[href="#/clips/challenge/chl_past"]');
  await p.waitForSelector(".clc-pod li", { timeout: 15000 });
  assert.equal(await p.$(".clc-join"), null, "an ended challenge has no join button");
  assert.match(await p.textContent(".clc-pod"), /Winners/);
  assert.deepEqual(await axe(p, ".clc"), []);
  await p.evaluate(id => { location.hash = "#/clips/challenge/" + encodeURIComponent(id); }, cid);
  await p.waitForSelector(".clc-join", { timeout: 15000 });
  assert.match(await p.textContent(".clc-join"), /Join with a clip/);
  assert.equal(await p.$('[data-clc="cancel"]'), null);
  await p.click('[data-sort="new"]');
  await p.waitForFunction(() => document.querySelectorAll(".clc-grid li").length >= 2, null, { timeout: 10000 });
  assert.deepEqual(await axe(p, ".clc"), []);
  await p.evaluate(() => { location.hash = "#/menu"; });
  await p.waitForSelector('a[href="#/clips/challenges"]', { timeout: 15000 });
  assert.deepEqual(errs, []);
  await c.close();
});
