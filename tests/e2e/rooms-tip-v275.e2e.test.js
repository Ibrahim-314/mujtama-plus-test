/* v2.75 — MJT tips in live rooms. 390 light RTL listener: «إكرامية» in the room bar → sheet (presets aria-pressed, custom,
 * anonymous, balance, Pi locked) → send → toast, ledger moved once, the cheer shows in the room; host bar has no tip button.
 * 1440 dark EN: labels translated, axe 0 serious/critical on the open sheet. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S, host, room;
test.before(async () => {
  S = await startStack({});
  // v2.140.2: the daily sign-in reward (v2.87, +1 MJT on first load) would move the exact balances this tip test reads; it has its own tests
  await S.app.ctx.db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('mining',$1,'e2e',$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$2", [JSON.stringify({ checkinOn: false }), new Date().toISOString()]);
  // every browser context here shares one test IP/device, which the integrity service links; the guard has API tests
  if (S.app.ctx.services.integrity) S.app.ctx.services.integrity.linkedAccounts = async () => new Set();
});
test.after(async () => {
  await S.close();
});
const meOf = async p => p.evaluate(() => DB.me);
const axeSheet = async p => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () =>
    (await window.axe.run(document.querySelector(".rt-sheet"), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ")).join(", "))
  );
};
const fund = async (handle, ikey) => {
  const admin = await S.app.ctx.db.get("SELECT id FROM users WHERE id=$1", [host]);
  await S.app.ctx.services.mjt.adjust({ id: admin.id, role: "admin" }, { ikey, handle, amount: "100", reason: "رصيد اختبار البث" });
};
const openRoom = async p => {
  await p.evaluate(id => {
    location.hash = "#/room/" + id;
  }, room);
  await p.waitForSelector(".room .room-bar", { timeout: 20000 });
};

test("390 light RTL listener tips the host in place; cheer; ledger once", async () => {
  const hc = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const hp = await hc.newPage();
  await onboard(hp, S.base, "rt_host", "مضيفة البث");
  host = await meOf(hp);
  S.app.ctx.rl?.w?.clear?.();
  room = (await S.app.ctx.services.rooms.createRoom({ id: host, handle: "rt_host" }, { title: "بث تجريبي للإكراميات", notifyFollowers: false })).room?.id;
  if (!room) room = (await S.app.ctx.db.get("SELECT id FROM rooms WHERE host=$1 AND status='live'", [host])).id;
  assert.ok(room);
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "rt_fan", "مستمع داعم");
  const fan = await meOf(p);
  await S.app.ctx.db.run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 40 * 864e5).toISOString(), fan]);
  await fund("rt_fan", "e2e_rt_fund_1");
  await openRoom(p);
  assert.equal(await p.$("#rm-tip").then(Boolean), true, "listener sees the tip button");
  const bh = await p.$eval("#rm-tip", b => b.getBoundingClientRect().height);
  assert.ok(bh >= 40, "tip button height " + bh);
  await p.click("#rm-tip");
  await p.waitForSelector(".rt-sheet[role=dialog]");
  await p.waitForFunction(() => /100 MJT/.test(document.querySelector("[data-rt-bal]")?.textContent || ""), null, { timeout: 10000 });
  assert.equal(await p.getAttribute('[data-rt-amt="10"]', "aria-pressed"), "true");
  assert.match(await p.textContent(".rt-bal"), /Pi غير مفعّل بعد/);
  await p.click('[data-rt-amt="25"]');
  assert.equal(await p.getAttribute('[data-rt-amt="25"]', "aria-pressed"), "true");
  assert.equal(await p.getAttribute('[data-rt-amt="10"]', "aria-pressed"), "false");
  assert.deepEqual(await axeSheet(p), []);
  await p.click("[data-rt-send]");
  await p.waitForFunction(() => document.querySelector(".rt-cheer") || (document.querySelector("[data-rt-err]")?.textContent || "").trim(), null, { timeout: 10000 }).catch(() => {});
  const why = await p.evaluate(() => document.querySelector("[data-rt-err]")?.textContent || "");
  assert.equal(why, "", "tip refused: " + why);
  await p.waitForSelector(".rt-cheer", { timeout: 10000 });
  assert.match(await p.textContent(".rt-cheer"), /\+25 MJT/);
  assert.match(await p.textContent(".rt-cheer"), /مستمع داعم/);
  const me = await p.evaluate(() => fetch("/api/mjt/me").then(r => r.json()));
  assert.equal(me.balance.mjt, "75", "ledger moved once");
  const sm = await p.evaluate(id => fetch("/api/mjt/rooms/" + id + "/tips").then(r => r.json()), room);
  assert.equal(sm.total, "25");
  // host's own bar: no tip button
  await openRoom(hp);
  assert.equal(await hp.$("#rm-tip"), null, "host has no tip button");
  assert.deepEqual(errs, []);
  await hc.close();
  await c.close();
});

test("1440 dark EN: tip sheet translated, axe clean", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  await onboard(p, S.base, "rt_fan2", "Fan Two");
  const fan = await meOf(p);
  await S.app.ctx.db.run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 40 * 864e5).toISOString(), fan]);
  await fund("rt_fan2", "e2e_rt_fund_2");
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.waitForTimeout(300);
  await openRoom(p);
  await p.click("#rm-tip");
  await p.waitForSelector(".rt-sheet[role=dialog]");
  await p.waitForTimeout(300);
  const t = await p.textContent(".rt-sheet");
  assert.match(t, /Tip the host/);
  assert.match(t, /Send without showing my name/);
  assert.match(t, /Pi not active yet/);
  assert.equal(await p.evaluate(() => document.documentElement.dir), "ltr");
  assert.deepEqual(await axeSheet(p), []);
  await c.close();
});
