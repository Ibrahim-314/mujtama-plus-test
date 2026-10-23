/* v2.75 — «لقطات» clip ↔ product/job link (v275-links). 390 light RTL author: «＋ اربط منتجاً أو وظيفة» on their own clip
 * → sheet lists only their active listing and open job → pick the product → chip with title + price; «تعديل» → «إزالة
 * الربط» → the add link returns. 1440 dark EN viewer: the chip (job) shows translated and opens #/job/:id; axe clean.
 * Double-tap and 2× are covered by the clips E2E suites (unchanged gestures). */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S, author;
test.before(async () => {
  S = await startStack({ fakeVideoMs: 1 });
});
test.after(async () => {
  await S.close();
});
const seedClips = async p => {
  S.app.ctx.rl?.w?.clear?.();
  const made = await p.evaluate(async () => {
    const h = { "Content-Type": "application/json", "X-Requested-With": "mujtama" },
      out = [];
    for (let i = 0; i < 2; i++) {
      const r = await fetch("/api/posts", {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          type: "video",
          visibility: "public",
          text: "لقطة الربط " + (i + 1),
          media: "linear-gradient(135deg, #332, #664)",
          video: { short: true, duration: 12 }
        })
      });
      out.push((await r.json()).post?.id || null);
    }
    return out;
  });
  assert.ok(made.every(Boolean), "clips created " + JSON.stringify(made));
  await new Promise(r => setTimeout(r, 100));
  for (let i = 0; i < made.length; i++) {
    const row = await S.app.ctx.db.get("SELECT data FROM posts WHERE id=$1", [made[i]]);
    const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    d.video = { ...d.video, status: "ready", variants: { "360p": "/media/none-t" + i + ".mp4", poster: "" } };
    await S.app.ctx.db.run("UPDATE posts SET id=$1, status='published', data=$2, created_at=$3 WHERE id=$4", [
      "cliplk_" + i,
      d,
      new Date(Date.now() - i * 60000).toISOString(),
      made[i]
    ]);
  }
};
const meOf = async p => p.evaluate(() => DB.me);
const openClip = async (p, id) => {
  await p.evaluate(() => {
    location.hash = "#/shorts";
  });
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
const now = () => new Date().toISOString();
const axe = async (p, sel) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async sel =>
    (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ")).join(", ")), sel);
};
const sec = id => `.short[data-short="${id}"]`;

test("390 light RTL author links a product, edits, removes", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "lk_author", "صانع الروابط");
  author = await meOf(p);
  await seedClips(p);
  const db = S.app.ctx.db;
  await db.run("INSERT INTO market_listings (id, seller_id, title, price, category, status, created_at, updated_at) VALUES ('ml_e2e1',$1,'سماعة لاسلكية',250000000,'other','active',$2,$2)", [author, now()]);
  await db.run("INSERT INTO market_listings (id, seller_id, title, price, category, status, created_at, updated_at) VALUES ('ml_e2e2',$1,'منتج محذوف',10000000,'other','removed',$2,$2)", [author, now()]);
  await db.run("INSERT INTO jobs (id, poster_id, kind, title, body, category, status, created_at, updated_at, published_at) VALUES ('job_e2e1',$1,'job','مطوّر واجهات','وصف','dev','open',$2,$2,$2)", [author, now()]);
  await openClip(p, "cliplk_0");
  await p.waitForSelector(`${sec("cliplk_0")} .cl-lk-add`, { timeout: 10000 });
  await p.click(`${sec("cliplk_0")} .cl-lk-add`);
  await p.waitForSelector(".cl-lk-sheet[role=dialog]");
  const opts = await p.$$eval(".cl-lk-opt", b => b.map(x => x.dataset.id).sort());
  assert.deepEqual(opts, ["job_e2e1", "ml_e2e1"]);
  assert.deepEqual(await axe(p, ".cl-lk-sheet"), []);
  await p.click('.cl-lk-opt[data-id="ml_e2e1"]');
  await p.waitForSelector(`${sec("cliplk_0")} .cl-lk-chip`, { timeout: 10000 });
  const chip = await p.textContent(`${sec("cliplk_0")} .cl-lk-chip`);
  assert.match(chip, /سماعة لاسلكية/);
  assert.match(chip, /25 Pi/);
  assert.equal(await p.getAttribute(`${sec("cliplk_0")} .cl-lk-chip`, "href"), "#/market/item/ml_e2e1");
  const h = await p.$eval(`${sec("cliplk_0")} .cl-lk-chip`, a => a.getBoundingClientRect().height);
  assert.ok(h >= 44, "chip height " + h);
  // edit → remove
  await p.click(`${sec("cliplk_0")} [data-cl-lk-edit]`);
  await p.waitForSelector("[data-cl-lk-rm]");
  assert.equal(await p.getAttribute('.cl-lk-opt[data-id="ml_e2e1"]', "aria-pressed"), "true");
  await p.click("[data-cl-lk-rm]");
  await p.waitForSelector(`${sec("cliplk_0")} .cl-lk-add`, { timeout: 10000 });
  assert.equal(await p.$(`${sec("cliplk_0")} .cl-lk-chip`), null);
  // link the job for the viewer test
  const r = await p.evaluate(() => fetch("/api/clips/cliplk_0/link", { method: "PUT", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ kind: "job", id: "job_e2e1" }) }).then(x => x.status));
  assert.equal(r, 200);
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark EN viewer: job chip translated, opens the job", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "lk_viewer", "Viewer");
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.waitForTimeout(300);
  await openClip(p, "cliplk_0");
  await p.waitForSelector(`${sec("cliplk_0")} .cl-lk-chip`, { timeout: 10000 });
  const chip = await p.textContent(`${sec("cliplk_0")} .cl-lk-chip`);
  assert.match(chip, /مطوّر واجهات/);
  assert.match(chip, /Job/);
  assert.equal(await p.$(`${sec("cliplk_0")} [data-cl-lk-edit]`), null, "no edit for a viewer");
  assert.equal(await p.$(`${sec("cliplk_0")} .cl-lk-add`), null);
  assert.deepEqual(await axe(p, `${sec("cliplk_0")} .cl-lk`), []);
  await p.click(`${sec("cliplk_0")} .cl-lk-chip`);
  await p.waitForFunction(() => location.hash.startsWith("#/job/job_e2e1"), null, { timeout: 10000 });
  assert.deepEqual(errs, []);
  await c.close();
});
