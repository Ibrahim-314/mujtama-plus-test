/* v2.74 — «لقطات»: MJT tip sent in place from the rail's support sheet (v274-tip).
 * 390 light RTL viewer: summary «كن أول…», balance, preset chips (aria-pressed), custom amount over the balance → send disabled
 * + alert, note + anonymous, send → success state, ledger moved exactly once, clip summary updated, coin burst, Escape returns
 * focus, wallet history row «إكرامية مُرسَلة» with «عرض اللقطة»; Pi option still visible and locked; wallet link kept.
 * 1440 dark EN creator: own clip → «Tips on your clip» summary only (no send), anonymous supporter shown as «؟», Studio link.
 * axe 0 serious/critical on the open sheet in both. TIP_SHOTS=dir → screenshots. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.TIP_SHOTS;
let S, creator, viewer;
test.before(async () => {
  S = await startStack({ fakeVideoMs: 1 });
  // v2.140.2: the daily sign-in reward (v2.87, +1 MJT on first load) would move the exact balances this tip test reads; it has its own tests
  await S.app.ctx.db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('mining',$1,'e2e',$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$2", [JSON.stringify({ checkinOn: false }), new Date().toISOString()]);
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
          text: "لقطة الإكراميات " + (i + 1),
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
      "cliptip_" + i,
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
const R = (id, k) => `.short[data-short="${id}"] [data-cl-rail="${k}"]`;
const axeSheet = async p => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () =>
    (await window.axe.run(document.querySelector(".cl-rail-sheet"), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(
        v =>
          v.id +
          ": " +
          v.nodes
            .slice(0, 3)
            .map(n => n.target.join(" "))
            .join(" | ")
      )
  );
};
const balOf = async uid => {
  const M = S.app.ctx.services.mjt;
  const r = await M.me({ id: uid });
  return r.balance.mjt;
};

test("390 light RTL viewer: tip in place, limits, anonymous, ledger once, history, axe", async () => {
  const cc = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const cp = await cc.newPage();
  await onboard(cp, S.base, "tip_creator", "صانعة اللقطات");
  creator = await meOf(cp);
  await seedClips(cp);
  const vc = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await vc.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "tip_viewer", "مشاهد داعم");
  viewer = await meOf(p);
  // an account old enough to send, with 100 MJT from a staff adjustment
  await S.app.ctx.db.run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 40 * 864e5).toISOString(), viewer]);
  await S.app.ctx.services.mjt.adjust(
    { id: creator, role: "admin" },
    { ikey: "e2e_tip_fund_1", handle: "tip_viewer", amount: "100", reason: "رصيد اختبار الإكراميات" }
  );
  await p.reload();
  await p.waitForSelector(".bottomnav a[data-r=home]");
  await openClip(p, "cliptip_0");
  await p.click(R("cliptip_0", "tip"));
  await p.waitForSelector('.cl-tip[role="dialog"]');
  await p.waitForFunction(() => /100 MJT/.test(document.querySelector("[data-cl-bal]")?.textContent || ""), null, { timeout: 10000 });
  assert.match(await p.textContent("[data-cl-sum]"), /كن أول من يدعم/);
  assert.equal(await p.getAttribute('[data-cl-amt="10"]', "aria-pressed"), "true");
  assert.ok(await p.evaluate(() => document.activeElement === document.querySelector('[data-cl-amt="10"]')), "focus starts on the selected amount");
  assert.ok(await p.$eval("[data-cl-pi]", b => b.disabled), "Pi stays visible and locked");
  assert.match(await p.textContent("[data-cl-pi]"), /غير مفعّل بعد/);
  assert.match(await p.getAttribute("[data-cl-mjt]", "href"), /^#\/mjt\?tab=send&to=tip_creator/);
  // chips: ≥44px, one pressed at a time
  const sizes = await p.$$eval("[data-cl-amt]", x =>
    x.map(e => {
      const r = e.getBoundingClientRect();
      return Math.min(r.width, r.height);
    })
  );
  sizes.forEach(v => assert.ok(v >= 44, "chip ≥44px " + v));
  await p.click('[data-cl-amt="25"]');
  assert.deepEqual(await p.$$eval("[data-cl-amt]", x => x.map(e => e.getAttribute("aria-pressed"))), ["false", "false", "true", "false"]);
  assert.match(await p.textContent("[data-cl-send]"), /25 MJT/);
  // a custom amount above the balance → send disabled + the reason announced
  await p.fill("[data-cl-custom]", "٥٠٠");
  await p.waitForTimeout(100);
  assert.ok(await p.$eval("[data-cl-send]", b => b.disabled));
  assert.match(await p.textContent("[data-cl-err]"), /لا يكفي/);
  assert.match(await p.textContent("[data-cl-send]"), /500 MJT/, "Arabic-Indic digits are read");
  await p.fill("[data-cl-custom]", "");
  await p.waitForTimeout(100);
  assert.equal(await p.getAttribute('[data-cl-amt="25"]', "aria-pressed"), "true", "clearing the custom amount returns to the chip");
  await p.fill("[data-cl-note]", "استمر يا مبدع");
  await p.check("[data-cl-anon]");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tip-390-light-sheet.png" });
  assert.deepEqual(await axeSheet(p), []);
  await p.click("[data-cl-send]");
  await p.waitForSelector(".cl-tip-done", { timeout: 10000 });
  assert.match(await p.textContent(".cl-tip-done"), /75 MJT/);
  assert.match(await p.textContent("[data-cl-sum]"), /25 MJT/);
  assert.ok(await p.$('.short[data-short="cliptip_0"] .cl-tip-burst'), "coin burst over the clip");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tip-390-light-done.png" });
  assert.equal(await balOf(viewer), "75");
  assert.equal(await balOf(creator), "25");
  const rows = await S.app.ctx.db.all("SELECT * FROM mjt_tips WHERE post_id='cliptip_0'", []);
  assert.equal(rows.length, 1, "exactly one tip");
  assert.equal(Number(rows[0].anon), 1);
  await p.keyboard.press("Escape");
  assert.equal(await p.$(".cl-rail-sheet"), null);
  assert.ok(await p.evaluate(s => document.activeElement === document.querySelector(s), R("cliptip_0", "tip")), "focus back on the tip button");
  // reopening: the viewer's own total is in the summary, the form is fresh
  await p.click(R("cliptip_0", "tip"));
  await p.waitForFunction(() => /25 MJT/.test(document.querySelector("[data-cl-sum]")?.textContent || ""));
  assert.ok(await p.$("[data-cl-send]"));
  await p.keyboard.press("Escape");
  // wallet history
  await p.evaluate(() => {
    location.hash = "#/mjt?tab=history";
  });
  await p.waitForSelector(".mj-hist li");
  const first = await p.textContent(".mj-hist li");
  assert.match(first, /إكرامية مُرسَلة/);
  assert.match(first, /عرض اللقطة/);
  assert.match(first, /استمر يا مبدع/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no horizontal overflow");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tip-390-light-history.png" });
  assert.deepEqual(errs, []);
  await vc.close();
  await cc.close();
});

test("1440 dark EN creator: own clip shows the summary only; anonymous supporter hidden; studio link", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto(S.base + "/?nosw");
  await p.fill("#a-handle", "tip_creator");
  await p.fill("#a-pass", "secret1234");
  await p.click("#a-go");
  await p.waitForSelector(".bottomnav a[data-r=home]");
  const sk = await p.$("#t-skip, #t-ok");
  if (sk) await sk.click().catch(() => {});
  await p.waitForFunction(() => !!window.MPI18n, null, { timeout: 15000 });
  await p.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
    window.MPI18n.setLang("en");
  });
  await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await openClip(p, "cliptip_0");
  await p.click(R("cliptip_0", "tip"));
  await p.waitForSelector('.cl-tip[role="dialog"]');
  await p.waitForFunction(() => /25 MJT/.test(document.querySelector("[data-cl-sum]")?.textContent || ""), null, { timeout: 10000 });
  assert.equal(await p.$("[data-cl-send]"), null, "no send on your own clip");
  assert.match(await p.textContent("#cl-rail-st"), /Tips on your clip/);
  assert.ok(!/مشاهد داعم/.test(await p.textContent("[data-cl-sum]")), "anonymous supporter not named");
  assert.ok(await p.$eval("[data-cl-pi]", b => b.disabled));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tip-1440-dark-en-own.png" });
  assert.deepEqual(await axeSheet(p), []);
  await p.keyboard.press("Escape");
  await p.evaluate(() => {
    location.hash = "#/studio";
  });
  await p.waitForSelector("#st-goals .sgl-links", { timeout: 15000 });
  const link = await p.textContent('#st-goals a[href="#/mjt?tab=history"]');
  assert.match(link, /\+25 MJT/);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tip-1440-dark-en-studio.png" });
  assert.deepEqual(errs, []);
  await c.close();
});
