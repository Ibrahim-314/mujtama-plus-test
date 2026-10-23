/* v2.76 — Vidtik links plus (v276-links, v276-pin, «يظهر في فيديوتك»).
 * 390 light RTL author: the sheet lists every kind (product, job, community, event, course); link the event; pin a clip on
 * the creator profile (first tile + «مثبّت»); axe clean on the sheet and the profile.
 * 1440 dark EN viewer: event chip with date → «Remind me» toggles the reminder (server row); product chip → «Ask the seller»
 * opens the chat with a ready draft; the author then sees 1+ taps; the listing page shows «Featured on Vidtik» → opens the clip;
 * job chip → «Apply now» lands on the job page. No page errors anywhere. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S, author, authorState;
test.before(async () => {
  S = await startStack({ fakeVideoMs: 1 });
});
test.after(async () => {
  await S.close();
});
const now = () => new Date().toISOString();
const later = h => new Date(Date.now() + h * 3600e3).toISOString();
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
const seedClips = async p => {
  S.app.ctx.rl?.w?.clear?.();
  const made = await p.evaluate(async h => {
    const out = [];
    for (let i = 0; i < 3; i++) {
      const r = await fetch("/api/posts", { method: "POST", headers: h, body: JSON.stringify({ type: "video", visibility: "public", text: "فيديو الروابط " + (i + 1), media: "linear-gradient(135deg, #233, #466)", video: { short: true, source: "clips", duration: 12 } }) });
      out.push((await r.json()).post?.id || null);
    }
    return out;
  }, H);
  assert.ok(made.every(Boolean), "clips created " + JSON.stringify(made));
  await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < made.length; i++) {
    const row = await S.app.ctx.db.get("SELECT data FROM posts WHERE id=$1", [made[i]]);
    const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    d.video = { ...d.video, status: "ready", variants: { "360p": "/media/none-p" + i + ".mp4", poster: "" } };
    await S.app.ctx.db.run("UPDATE posts SET id=$1, status='published', data=$2, created_at=$3 WHERE id=$4", ["clipx_" + i, d, new Date(Date.now() - i * 60000).toISOString(), made[i]]);
  }
};
const openClip = async (p, id) => {
  await p.evaluate(() => { location.hash = "#/shorts"; });
  await p.waitForFunction(
    id => {
      const s = document.querySelector(`.short[data-short="${id}"]`);
      if (!s || !s.querySelector(".short-actions.cl-rail [data-cl-rail]")) return false;
      s.scrollIntoView({ block: "start" });
      return Math.abs(s.getBoundingClientRect().top - (document.querySelector(".shorts")?.getBoundingClientRect().top || 0)) < 4;
    },
    id,
    { timeout: 30000, polling: 200 }
  );
  await p.waitForTimeout(400);
};
const axe = async (p, sel) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async sel =>
    (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ")).join(", ")), sel);
};
const sec = id => `.short[data-short="${id}"]`;
const put = (p, url, body) => p.evaluate(([u, b, h]) => fetch(u, { method: "PUT", headers: h, body: JSON.stringify(b) }).then(x => x.status), [url, body, H]);

test("390 light RTL author: every kind in the sheet, link an event, pin a clip", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "lp_author", "صانعة الروابط");
  author = await p.evaluate(() => DB.me);
  await seedClips(p);
  const db = S.app.ctx.db;
  await db.run("INSERT INTO market_listings (id, seller_id, title, price, category, status, created_at, updated_at) VALUES ('ml_x1',$1,'قلم رقمي',100000000,'other','active',$2,$2)", [author, now()]);
  await db.run("INSERT INTO jobs (id, poster_id, kind, title, body, category, status, created_at, updated_at, published_at) VALUES ('job_x1',$1,'job','مصمم حركة','وصف','design','open',$2,$2,$2)", [author, now()]);
  await db.run("INSERT INTO communities(id,name,type,owner,created_at) VALUES('cm_x1','مجتمع الحركة','public',$1,$2)", [author, now()]);
  await db.run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES('cm_x1',$1,'owner',$2)", [author, now()]);
  await db.run("INSERT INTO events(id,name,starts_at,place,organizer,status,created_at) VALUES('ev_x1','ورشة الحركة',$1,'أونلاين',$2,'upcoming',$3)", [later(72), author, now()]);
  await db.run("INSERT INTO courses(id,community_id,author,title,status,access,created_at,updated_at) VALUES('co_x1','cm_x1',$1,'أساسيات الحركة','published','free',$2,$2)", [author, now()]);
  await openClip(p, "clipx_0");
  await p.waitForSelector(`${sec("clipx_0")} .cl-lk-add`, { timeout: 10000 });
  await p.click(`${sec("clipx_0")} .cl-lk-add`);
  await p.waitForSelector(".cl-lk-sheet[role=dialog]");
  const kinds = await p.$$eval(".cl-lk-opt", b => b.map(x => x.dataset.k).sort());
  assert.deepEqual(kinds, ["community", "course", "event", "job", "product"]);
  assert.equal(await p.$$eval(".cl-lk-sheet h4", h => h.length), 5);
  assert.deepEqual(await axe(p, ".cl-lk-sheet"), []);
  await p.click('.cl-lk-opt[data-id="ev_x1"]');
  await p.waitForSelector(`${sec("clipx_0")} .cl-lk-chip[href="#/event/ev_x1"]`, { timeout: 10000 });
  assert.match(await p.textContent(`${sec("clipx_0")} .cl-lk-chip`), /ورشة الحركة/);
  assert.equal(await p.$(`${sec("clipx_0")} [data-cl-lk-act]`), null, "the author gets no viewer action");
  // the other two clips: product and job (for the viewer test)
  assert.equal(await put(p, "/api/clips/clipx_1/link", { kind: "product", id: "ml_x1" }), 200);
  assert.equal(await put(p, "/api/clips/clipx_2/link", { kind: "job", id: "job_x1" }), 200);
  // pin clipx_2 from the creator profile
  await p.evaluate(() => { location.hash = "#/clips/@lp_author"; });
  await p.waitForSelector('.vt-grid [data-vt-pin="clipx_2"]', { timeout: 15000 });
  await p.click('.vt-grid [data-vt-pin="clipx_2"]');
  await p.waitForSelector(".vt-grid li.is-pinned", { timeout: 10000 });
  assert.equal(await p.$eval(".vt-grid li", li => li.querySelector(".vt-tile").getAttribute("href")), "#/clips?start=clipx_2");
  assert.match(await p.textContent(".vt-grid li.is-pinned .vt-tile-pin"), /مثبّت/);
  assert.equal(await p.$$eval('.vt-grid a[href="#/clips?start=clipx_2"]', a => a.length), 1, "not repeated");
  const pb = await p.$eval(".vt-grid li.is-pinned .vt-pin", b => b.getBoundingClientRect());
  assert.ok(pb.width >= 44 && pb.height >= 44, "pin target size");
  assert.deepEqual(await axe(p, ".vt-pf"), []);
  assert.deepEqual(errs, []);
  authorState = await c.storageState();
  await c.close();
});

test("1440 dark EN viewer: remind me, ask the seller, taps for the author, featured strip, apply now", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "lp_viewer", "Viewer");
  const me = await p.evaluate(() => DB.me);
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.waitForTimeout(300);
  // event: remind me
  await openClip(p, "clipx_0");
  await p.waitForSelector(`${sec("clipx_0")} [data-cl-lk-act="remind"]`, { timeout: 10000 });
  assert.match(await p.textContent(`${sec("clipx_0")} [data-cl-lk-act="remind"]`), /Remind me/);
  assert.deepEqual(await axe(p, `${sec("clipx_0")} .cl-lk`), []);
  await p.click(`${sec("clipx_0")} [data-cl-lk-act="remind"]`);
  await p.waitForSelector(`${sec("clipx_0")} [data-cl-lk-act="remind"][aria-pressed="true"]`, { timeout: 10000 });
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM event_rsvps WHERE event_id='ev_x1' AND user_id=$1 AND kind='reminder'", [me]), "reminder saved");
  // product: ask the seller → chat with a draft
  await openClip(p, "clipx_1");
  await p.waitForSelector(`${sec("clipx_1")} [data-cl-lk-act="ask"]`, { timeout: 10000 });
  assert.match(await p.textContent(`${sec("clipx_1")} [data-cl-lk-act="ask"]`), /Ask the seller/);
  await p.click(`${sec("clipx_1")} [data-cl-lk-act="ask"]`);
  await p.waitForFunction(() => location.hash.startsWith("#/chat/"), null, { timeout: 15000 });
  await p.waitForSelector("#cm-ta", { timeout: 15000 });
  assert.match(await p.$eval("#cm-ta", t => t.value), /قلم رقمي/);
  const taps = await S.app.ctx.db.get("SELECT COUNT(*) n FROM clip_link_clicks WHERE post_id='clipx_1'");
  assert.equal(Number(taps.n), 1, "one counted tap");
  // the listing page: «Featured on Vidtik» → opens the clip
  await p.evaluate(() => { location.hash = "#/market/item/ml_x1"; });
  await p.waitForSelector(".vt-strip .vt-strip-t", { timeout: 15000 });
  assert.match(await p.textContent(".vt-strip-h"), /Featured on Vidtik/);
  assert.deepEqual(await axe(p, ".vt-strip"), []);
  await p.click(".vt-strip .vt-strip-t");
  await p.waitForFunction(() => location.hash.startsWith("#/clips?start=clipx_1"), null, { timeout: 10000 });
  // job: apply now → the job page
  await openClip(p, "clipx_2");
  await p.waitForSelector(`${sec("clipx_2")} [data-cl-lk-act="apply"]`, { timeout: 10000 });
  await p.click(`${sec("clipx_2")} [data-cl-lk-act="apply"]`);
  await p.waitForFunction(() => location.hash.startsWith("#/job/job_x1"), null, { timeout: 10000 });
  await p.waitForSelector("#wk-ja", { timeout: 15000 });
  assert.equal(await p.evaluate(() => sessionStorage.getItem("mp-auto-apply")), null, "the hand-over flag is consumed");
  assert.deepEqual(errs, []);
  await c.close();
});

test("the author sees the tap count on their own clip", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", storageState: authorState });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(S.base + "/?nosw");
  await p.waitForSelector(".bottomnav a[data-r=home]", { timeout: 30000 });
  await openClip(p, "clipx_1");
  await p.waitForSelector(`${sec("clipx_1")} .cl-lk-n`, { timeout: 10000 });
  assert.match(await p.textContent(`${sec("clipx_1")} .cl-lk-n`), /\b1\b/);
  assert.equal(await p.$(`${sec("clipx_1")} [data-cl-lk-act]`), null);
  assert.deepEqual(errs, []);
  await c.close();
});
