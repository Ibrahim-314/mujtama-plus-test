/* v2.88 «المدينة الرقمية» — the game (game/) end to end against the REAL server (production build), phone 390 px and
 * desktop 1366 px: open #/city (lazy game chunk), title → «ابدأ اللعبة» → character creator → name → enter the city (profile
 * saved through PUT /api/game/profile), the room: intro dialogue, keyboard movement, the window, the computer terminal →
 * mining station page over the paused game → close → back in the room; pause menu → settings → back → exit to the app
 * (game unmounted, renderer released). Reload → the title offers «متابعة». No page errors.
 * WebGL in headless Chromium is software-rendered (slow, uneven frames), so taps on game UI are dispatched straight to the
 * element instead of waiting for Playwright's "stable across animation frames" check. GAME_SHOTS=<dir> saves screenshots. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, ensureBuild, onboard, MOBILE } = require("./harness");

let S;
const SHOTS = process.env.GAME_SHOTS;
const shot = async (p, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png") }); };
const tap = (p, sel) => p.$eval(sel, (el) => el.click());
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
const visible0 = (p, sel, ms) => until(p, (s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, sel, ms);
const visible = async (p, sel, ms) => { try { await visible0(p, sel, ms); } catch (e) { await shot(p, "FAIL-" + sel.replace(/[^a-z0-9]+/gi, "_")); const st = await p.evaluate(() => ({ cls: document.querySelector("#gm-modal")?.className, html: document.querySelector("#gm-modal")?.innerHTML.slice(0, 300), dlg: !document.querySelector("#gm-dlg")?.hidden })); console.log("FAILSTATE", JSON.stringify(st)); throw e; } };
/** advance a dialogue to its end (taps: first finishes the typing, the next moves on) */
async function talk(p, ms = 40000) {
  await visible(p, "#gm-dlg", ms);
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const open = await p.evaluate(() => { const d = document.querySelector("#gm-dlg"); return !!d && !d.hidden && d.classList.contains("on"); });
    if (!open) return;
    await p.evaluate(() => document.querySelector("#gm-dlg")?.click());
    await p.waitForTimeout(120);
  }
  throw new Error("dialogue never ended");
}

async function run(label, ctxOpts) {
  const ctx = await S.browser.newContext(ctxOpts);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_|net::|Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
  await onboard(p, S.base, "gm" + label + Date.now().toString(36).slice(-4));
  // from here on (signed in) any failed request to our server is a bug (the signed-out boot's 401 /api/bootstrap is expected)
  p.on("response", (r) => { if (r.status() >= 400 && new URL(r.url()).origin === S.base) errors.push(r.status() + " " + r.request().method() + " " + new URL(r.url()).pathname); });

  // open the game: the lazy chunk mounts full screen and the app's bars step aside
  await p.evaluate(() => { location.hash = "#/city"; });
  await p.waitForSelector("#gm-root #gm-press", { timeout: 60000 });
  await until(p, () => !document.querySelector("#gm-load")?.classList.contains("on"), null, 60000);
  assert.ok(await p.evaluate(() => document.body.classList.contains("gm-on")), "body.gm-on while the game is open");
  assert.ok(await p.evaluate(() => !!window.MPGame && window.MPGame.scenes.name === "title"), "title scene");
  await p.waitForTimeout(800);
  await shot(p, label + "-1-title");

  // title → menu → new game: the press button must be the top element under its own centre (no invisible layer over it)
  const top = await p.evaluate(() => { const b = document.querySelector("#gm-press").getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)?.id; });
  assert.equal(top, "gm-press", "nothing covers «المس للبدء»");
  for (const id of await p.$$eval("#gm-root [hidden]", (els) => els.filter((e) => getComputedStyle(e).display !== "none").map((e) => e.id || e.className))) assert.fail("hidden but displayed: " + id);
  await tap(p, "#gm-press");
  await visible(p, "#gm-tmenu [data-a=new]");
  await shot(p, label + "-2-menu");
  await tap(p, "#gm-tmenu [data-a=new]");

  // character creator
  await until(p, () => window.MPGame?.scenes.name === "creator");
  await visible(p, "#gm-nm");
  const first = await p.textContent("#gm-cname");
  await tap(p, "[data-d='1']");
  await until(p, (f) => document.querySelector("#gm-cname")?.textContent !== f, first);
  await p.waitForTimeout(600);
  await shot(p, label + "-3-creator");
  await p.fill("#gm-nm", "x");
  await tap(p, "#gm-go");
  await until(p, () => document.querySelector("#gm-nm")?.classList.contains("bad"));
  await p.fill("#gm-nm", "نور");
  await tap(p, "#gm-go");

  // the room: arrival, saved profile, intro dialogue
  await until(p, () => window.MPGame?.scenes.name === "room", null, 60000);
  const prof = await p.evaluate(async () => (await fetch("/api/game/profile", { headers: { "X-Requested-With": "mujtama" } })).json());
  const pr = prof.player || {};
  assert.equal(pr.name, "نور", "profile saved on the server: " + JSON.stringify(prof));
  await talk(p, 60000);
  await visible(p, "#gm-obj");
  await p.waitForTimeout(2500); // the follow camera settles after the arrival sweep
  await shot(p, label + "-4-room");

  // movement (keyboard): the player actually moves
  const pos0 = await p.evaluate(() => ({ ...window.MPGame.room.player.pos }));
  // software WebGL renders few frames a second here, so hold the key until the player has covered some ground (≤ 6 s)
  await p.keyboard.down("KeyD");
  await until(p, (a) => { const q = window.MPGame.room.player.pos; return Math.hypot(q.x - a.x, q.z - a.z) > 0.3; }, pos0, 6000).catch(() => {});
  await p.keyboard.up("KeyD");
  const pos1 = await p.evaluate(() => ({ ...window.MPGame.room.player.pos }));
  assert.ok(Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) > 0.2, `player moved ${JSON.stringify(pos0)} → ${JSON.stringify(pos1)}`);

  // the window (a story goal)
  await p.evaluate(() => { window.MPGame.room.use("window"); });
  await talk(p);
  assert.ok(await p.evaluate(() => !!window.MPGame.save.flag("room.window")), "window goal done");

  // the computer → terminal → mining station over the paused game
  await p.evaluate(() => { window.MPGame.room.use("computer"); });
  await talk(p);
  // MJT OS: desktop + taskbar + start menu, the Mining program opens in a window
  // outside view: the desktop is drawn on the monitor in the room, then «ادخل الشاشة» dives in
  await visible(p, "#gm-modal.os-out .os-cb.in");
  await until(p, () => window.MPGame.loop.paused);
  await shot(p, label + "-5o-outside");
  assert.ok(await p.evaluate(() => /matrix3d/.test(document.querySelector("#gm-modal .gm-panel").style.transform)), "OS sits on the monitor in perspective");
  assert.ok(await p.evaluate(() => window.MPGame.loop.paused), "3D loop rests while the view is still");
  await tap(p, "#gm-modal .os-cb.in");
  await visible(p, "#gm-modal.os-full #gm-os .os-bar");
  await p.waitForTimeout(700);
  await shot(p, label + "-5a-desktop");
  // back outside and in again via the taskbar button
  await tap(p, "#gm-os [data-os=out]");
  await visible(p, "#gm-modal.os-out .os-cb.in");
  await until(p, () => window.MPGame.loop.paused);
  await tap(p, "#gm-modal .os-cb.in");
  await visible(p, "#gm-modal.os-full #gm-os .os-bar");
  await p.waitForTimeout(500);
  await tap(p, "#gm-os [data-os=start]");
  await visible(p, "#gm-os .os-start .os-pin[data-app=mining]");
  await shot(p, label + "-5b-start");
  await tap(p, "#gm-os .os-start .os-pin[data-app=mining]");
  await visible(p, "#gm-os .os-win[data-win=mining] .mn-go");
  await until(p, () => !!document.querySelector("#gm-os .mn-kpi div"));
  assert.equal(await p.evaluate(() => document.querySelectorAll("#gm-modal [data-st=earn]").length), 0, "old mining terminal is gone");
  await p.waitForTimeout(700);
  await shot(p, label + "-5-terminal");
  // wallet / balance / records are real programs on live MJT data; photos changes the wallpaper
  await tap(p, "#gm-os .os-win[data-win=mining] [data-w=x]");
  await tap(p, "#gm-os .os-desk [data-app=balance]");
  await until(p, () => !!document.querySelector("#gm-os .os-win[data-win=balance] .wl-amt"));
  await p.waitForTimeout(400); await shot(p, label + "-5c-balance");
  await tap(p, "#gm-os .os-win[data-win=balance] [data-w=x]");
  await tap(p, "#gm-os .os-desk [data-app=history]");
  await until(p, () => !!document.querySelector("#gm-os .os-win[data-win=history] .rc-list li"));
  await p.waitForTimeout(400); await shot(p, label + "-5d-records");
  await tap(p, "#gm-os .os-win[data-win=history] [data-w=x]");
  await tap(p, "#gm-os .os-desk [data-app=photos]");
  await visible(p, "#gm-os .os-win[data-win=photos] [data-wall=aurora]");
  await tap(p, "#gm-os .os-win[data-win=photos] [data-wall=aurora]");
  await until(p, () => document.querySelector("#gm-os .os-wall").classList.contains("custom") && JSON.parse(localStorage.getItem("mjtos.wall")).id === "aurora");
  await p.waitForTimeout(400); await shot(p, label + "-5e-photos");
  await tap(p, "#gm-os .os-win[data-win=photos] [data-w=x]");
  await tap(p, "#gm-os .os-desk [data-app=send]");
  await visible(p, "#gm-os .os-win[data-win=send] .wl-amt");
  await p.waitForTimeout(400); await shot(p, label + "-5f-wallet");
  // «الصفحة الكاملة» still opens the real station page
  await tap(p, "#gm-os .os-win[data-win=send] [data-full=send]");
  await until(p, () => location.hash === "#/city/mjt/send");
  await visible(p, "body > .cy-st", 30000);
  assert.ok(await p.evaluate(() => document.querySelector("#gm-root").classList.contains("gm-behind")), "game paused behind the station");
  await p.waitForTimeout(600);
  await shot(p, label + "-6-station");
  await p.evaluate(() => window.MPCity.closeRoom());
  await until(p, () => !document.querySelector("#gm-root")?.classList.contains("gm-behind"));
  assert.ok(await p.evaluate(() => window.MPGame?.scenes.name === "room"), "back in the room after the station");

  // v2.94 stage 4 — the door: locked until chapter 0 is complete, then it slides open onto the street
  await p.evaluate(() => { window.MPGame.room.use("door"); });
  await talk(p); // locked lines
  await until(p, () => !!window.MPGame.save.flag("room.done"), null, 20000);
  await until(p, () => document.querySelector("#gm-dlg")?.classList.contains("on"), null, 20000);
  await talk(p, 40000); // chapter 0 complete (window + computer + door)
  assert.ok(await p.evaluate(() => !!window.MPGame.save.flag("room.done")), "chapter 0 complete");
  await until(p, () => !window.MPGame.room || window.MPGame.scenes.busy === false);
  p.evaluate(() => { window.MPGame.room.use("door"); }).catch(() => {});
  await until(p, () => window.MPGame.room && window.MPGame.room.door() > 0.3, null, 45000).catch(async (e) => { console.log("DOORSTATE", JSON.stringify(await p.evaluate(() => ({ flags: window.MPGame.save.data.flags, door: window.MPGame.room?.door(), scene: window.MPGame.scenes.name, dlg: !document.querySelector("#gm-dlg")?.hidden, act: document.querySelector("#gm-act")?.hidden })))); await shot(p, "FAIL-door"); throw e; });
  await shot(p, label + "-8a-door");
  await until(p, () => window.MPGame?.scenes.name === "street" && !window.MPGame.scenes.busy, null, 60000);
  await until(p, () => document.querySelector("#gm-dlg")?.classList.contains("on"), null, 20000);
  await talk(p, 40000); // street intro
  await p.waitForTimeout(1500);
  await shot(p, label + "-8b-street");
  // walk a few metres up the road towards the tower, through the same path a tap on the road takes
  await until(p, () => !window.MPGame.street.state().busy && !window.MPGame.street.state().intro, null, 20000);
  const z0 = await p.evaluate(() => window.MPGame.street.player.pos.z);
  assert.ok(await p.evaluate(() => { const s = window.MPGame.street; return s.walk(0, s.player.pos.z - 6); }), "street accepts a walk");
  await until(p, (a) => window.MPGame.street.player.pos.z < a - 0.5, z0, 20000).catch(async (e) => { console.log("STREETSTATE", JSON.stringify(await p.evaluate(() => ({ st: window.MPGame.street.state(), pos: window.MPGame.street.player.pos, modal: window.MPGame.ui.modalOpen })))); throw e; });
  await p.waitForTimeout(1200);
  await shot(p, label + "-8b2-walk");
  // up to the tower and in: the tower's own game screen (v2.96, MJT OS style) opens over the still street — no station page
  await p.evaluate(() => { const s = window.MPGame.street; s.player.pos.set(0, 0, s.gate + 2); });
  await p.evaluate(() => { window.MPGame.street.use("tower"); });
  await visible(p, "#gm-tw .tw-hero", 20000);
  assert.ok(await p.evaluate(() => !!window.MPGame.save.flag("street.tower")), "tower goal done");
  const h0 = await p.evaluate(() => location.hash);
  await p.waitForTimeout(600);
  assert.ok(await p.evaluate((h) => !document.querySelector("body > .cy-st") && location.hash === h, h0), "the old station page no longer opens");
  await until(p, () => document.querySelector("#gm-tw")?.classList.contains("live") && document.querySelector("#gm-tw .tw-tab.act")?.dataset.tab === "balance", null, 20000);
  await until(p, () => !!document.querySelector("#gm-tw .tw-body .wl-card"), null, 20000);
  await p.waitForTimeout(1100);
  await shot(p, label + "-8c-tower");
  await p.click("#gm-tw [data-tab=history]");
  await until(p, () => document.querySelector("#gm-tw .tw-tab.act")?.dataset.tab === "history", null, 5000);
  await p.click("#gm-tw [data-tab=send]");
  await until(p, () => !!document.querySelector("#gm-tw .tw-body .wl-card"), null, 20000);
  await shot(p, label + "-8d-tower-wallet");
  await p.click("#gm-tw [data-tw=exit]");
  await until(p, () => !document.querySelector("#gm-tw") && !window.MPGame.ui.modalOpen && window.MPGame.street.state().busy === false, null, 10000);
  assert.ok(await p.evaluate(() => window.MPGame?.scenes.name === "street"), "back on the street after the tower");
  // and home again: the room, the door closes behind the player
  p.evaluate(() => { window.MPGame.street.use("home"); }).catch(() => {});
  await until(p, () => window.MPGame?.scenes.name === "room" && !window.MPGame.scenes.busy, null, 60000);
  await until(p, () => window.MPGame.room.door() === 0, null, 20000);
  assert.ok(await p.evaluate(() => !document.querySelector("#gm-root").classList.contains("gm-flash-on")), "flash cleared");

  // pause → settings → back → exit to the app
  await tap(p, "#gm-menu");
  await visible(p, "#gm-modal [data-a=settings]");
  await tap(p, "#gm-modal [data-a=settings]");
  await visible(p, "#gm-modal [data-a=done]");
  await p.waitForTimeout(500); // modal fade-in
  await shot(p, label + "-7-settings");
  await tap(p, "#gm-modal [data-a=done]");
  await visible(p, "#gm-modal [data-a=exit]");
  await tap(p, "#gm-modal [data-a=exit]");
  await until(p, () => location.hash === "#/menu" && !document.querySelector("#gm-root") && !window.MPGame && !document.body.classList.contains("gm-on"));

  // reload into the game: the title offers «متابعة» with the saved name
  await p.evaluate(() => { location.hash = "#/city"; });
  await p.waitForSelector("#gm-root #gm-press", { timeout: 60000 });
  await tap(p, "#gm-press");
  await visible(p, "#gm-tmenu [data-a=continue]");
  assert.match(await p.textContent("#gm-tmenu [data-a=continue]"), /نور/);
  await p.evaluate(() => { location.hash = "#/menu"; });
  await until(p, () => !document.querySelector("#gm-root"));

  assert.deepEqual(errors, [], "no page errors");
  await ctx.close();
}

test.before(async () => { ensureBuild(); S = await startStack(); });
test.after(async () => { if (S) await S.close(); });

test("game v2.88 — phone 390", { timeout: 300000 }, () => run("m", MOBILE));
test("game v2.88 — desktop 1366", { timeout: 300000 }, () => run("d", { viewport: { width: 1366, height: 800 }, locale: "ar-SA" }));
