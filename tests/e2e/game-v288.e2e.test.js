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
  // wait for THIS dialogue to open (a previous one may still be fading out, and a gesture can precede the lines)
  await until(p, () => { const d = document.querySelector("#gm-dlg"); return !!d && !d.hidden && d.classList.contains("on"); }, null, ms);
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
  await until(p, () => { const l = document.querySelector("#gm-load"); return !l || getComputedStyle(l).visibility === "hidden"; }, null, 30000); // the loading veil has finished fading out
  await p.waitForTimeout(800);
  await shot(p, label + "-1-title");

  // title → menu → new game: the press button must be the top element under its own centre (no invisible layer over it)
  const top = await p.evaluate(() => { const b = document.querySelector("#gm-press").getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e && (e.closest("#gm-press") ? "gm-press" : (e.id || "") + "." + e.className + " in " + (e.parentElement?.id || e.parentElement?.className)); });
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

  // v2.99 Phase 2B: the prologue «الإشارة» plays first — one canvas, a visible skip, then the room as before
  await until(p, () => window.MPGame?.scenes.name === "prologue" && !window.MPGame.scenes.busy, null, 120000);
  await visible(p, "#gm-cine-skip", 60000);
  // 2026-10-27: the world is 2D pixel art by default (the prologue paints on one 2D canvas; 3D stays a setting)
  const PX = await p.evaluate(() => window.MPGame.prologue?.engine === "pixel");
  assert.ok(PX, "the prologue plays in pixel art");
  assert.ok(await p.evaluate(() => document.querySelectorAll("#gm-root canvas.gm-px").length === 1 && window.MPGame.prologue?.shareContext === true), "the prologue draws on one pixel canvas");
  await tap(p, "#gm-cine-skip");

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
  const pos0 = await p.evaluate(() => ({ ...window.MPGame.room.player.pos, x: window.MPGame.room.player.pos.x, z: window.MPGame.room.player.pos.z }));
  // software WebGL renders few frames a second here, so hold the key until the player has covered some ground (≤ 6 s)
  await p.keyboard.down("KeyD");
  await until(p, (a) => { const q = window.MPGame.room.player.pos; return Math.hypot(q.x - a.x, q.z - a.z) > 0.3; }, pos0, 6000).catch(() => {});
  await p.keyboard.up("KeyD");
  const pos1 = await p.evaluate(() => ({ ...window.MPGame.room.player.pos, x: window.MPGame.room.player.pos.x, z: window.MPGame.room.player.pos.z }));
  assert.ok(Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) > 0.2, `player moved ${JSON.stringify(pos0)} → ${JSON.stringify(pos1)}`);

  // the window (a story goal)
  await until(p, () => { const d = document.querySelector("#gm-dlg"); return !d || d.hidden; }, null, 10000); // the arrival lines are over
  await p.evaluate(() => { window.MPGame.room.use("window"); });
  await talk(p);
  await until(p, () => !!window.MPGame.save.flag("room.window"), null, 5000).catch(() => {});
  assert.ok(await p.evaluate(() => !!window.MPGame.save.flag("room.window")), "window goal done");

  // the computer → terminal → mining station over the paused game
  await p.evaluate(() => { window.MPGame.room.use("computer"); });
  await talk(p);
  // MJT OS: desktop + taskbar + start menu, the Mining program opens in a window
  // outside view: the desktop is drawn on the monitor in the room, then «ادخل الشاشة» dives in
  // pixel world: MJT OS fills the screen straight away and the pixel loop rests behind it
  assert.ok(await p.evaluate(() => window.MPGame.room.engine === "pixel"), "the room is pixel art");
  await visible(p, "#gm-modal.os-full #gm-os .os-bar");
  await until(p, () => window.MPGame.loop.paused);
  await p.waitForTimeout(700);
  await shot(p, label + "-5a-desktop");
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
  await until(p, () => (window.MPGame.room && window.MPGame.room.door() > 0.3) || window.MPGame.scenes.name === "street", null, 45000).catch(async (e) => { console.log("DOORSTATE", JSON.stringify(await p.evaluate(() => ({ flags: window.MPGame.save.data.flags, door: window.MPGame.room?.door(), scene: window.MPGame.scenes.name, dlg: !document.querySelector("#gm-dlg")?.hidden, act: document.querySelector("#gm-act")?.hidden })))); await shot(p, "FAIL-door"); throw e; });
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
  // Season 1: the first time in, Salma speaks at the door (the key «40», Yousuf, the fortieth floor) before the screen opens
  { const end = Date.now() + 60000; // several dialogue beats in a row: keep tapping until the beat is saved
    while (Date.now() < end && !(await p.evaluate(() => window.MPGame.street.state().salma))) { await p.evaluate(() => { const d = document.querySelector("#gm-dlg"); if (d && !d.hidden && d.classList.contains("on")) d.click(); }); await p.waitForTimeout(150); } }
  if (!(await p.evaluate(() => window.MPGame.street.state().salma))) console.log("SALMASTATE", JSON.stringify(await p.evaluate(() => ({ st: window.MPGame.street.state(), dlg: document.querySelector("#gm-dlg")?.className, flags: window.MPGame.save?.data?.flags }))), errors.slice(0, 5));
  assert.ok(await p.evaluate(() => window.MPGame.street.state().salma), "Salma's beat played and was saved");
  assert.ok(await p.evaluate(() => /40/.test(document.querySelector("#gm-obj-t")?.textContent || "")), "the objective moved on to the fortieth floor");
  await visible(p, "#gm-tw .tw-hero", 20000);
  assert.ok(await p.evaluate(() => !!window.MPGame.save.flag("street.tower")), "tower goal done");
  const h0 = await p.evaluate(() => location.hash);
  await p.waitForTimeout(600);
  assert.ok(await p.evaluate((h) => !document.querySelector("body > .cy-st") && location.hash === h, h0), "the old station page no longer opens");
  await until(p, () => document.querySelector("#gm-tw")?.classList.contains("live") && document.querySelector("#gm-tw .tw-tab.act")?.dataset.tab === "balance", null, 20000);
  await until(p, () => !!document.querySelector("#gm-tw .tw-body .wl-card"), null, 20000);
  await p.waitForTimeout(1100);
  await shot(p, label + "-8c-tower");
  await tap(p, "#gm-tw [data-tab=history]");
  await until(p, () => document.querySelector("#gm-tw .tw-tab.act")?.dataset.tab === "history", null, 5000);
  await tap(p, "#gm-tw [data-tab=send]");
  await until(p, () => !!document.querySelector("#gm-tw .tw-body .wl-card"), null, 20000);
  await shot(p, label + "-8d-tower-wallet");
  await tap(p, "#gm-tw [data-tw=exit]");
  await until(p, () => !document.querySelector("#gm-tw") && !window.MPGame.ui.modalOpen && window.MPGame.street.state().busy === false, null, 10000);
  assert.ok(await p.evaluate(() => window.MPGame?.scenes.name === "street"), "back on the street after the tower");
  // Season 1 «الإشارة الأولى»: the terminal is live now, the player walks up to it and acts (the real action button)
  assert.ok(await p.evaluate(() => window.MPGame.street.state().signal && !window.MPGame.street.state().sada), "the signal is live after Salma");
  // v2.101.1: the way to the terminal is shown (a beam + a trail), and tapping the goal walks the player there
  await p.waitForTimeout(800);
  assert.ok(await p.evaluate(() => window.MPGame.street.state().guide === "signal"), "the guide points at the terminal");
  await shot(p, label + "-8e-signal-guide");
  assert.ok(await p.evaluate(() => !document.querySelector("#gm-guide").hidden), "the on-screen guide shows the way");
  const zG = await p.evaluate(() => window.MPGame.street.player.pos.z);
  await tap(p, "#gm-obj [data-g=salma]");
  await p.waitForTimeout(2500);
  await shot(p, label + "-8f-signal-walking");
  // headless frames are slow, so check the route was taken (heading down the clear middle of the road) rather than wait it out
  assert.ok(await p.evaluate((z) => { const pl = window.MPGame.street.player; return !!pl.target && Math.abs(pl.target.x) < 0.01 && pl.pos.z > z + 0.3; }, zG), "tapping the goal walks the player toward the terminal");
  await p.evaluate(() => { const s = window.MPGame.street, a = s.state().sigAt; s.player.walkTo(null); s.player.pos.set(a.x, 0, a.z + 0.3); });
  await until(p, () => window.MPGame.street.state().near === "signal" && !document.querySelector("#gm-act").hidden, null, 10000);
  assert.ok(await p.evaluate(() => /محطة|terminal/i.test(document.querySelector("#gm-act-k").textContent)), "the action names the terminal");
  await tap(p, "#gm-act");
  { const end = Date.now() + 80000;
    while (Date.now() < end && !(await p.evaluate(() => window.MPGame.street.state().sada))) { await p.evaluate(() => { const d = document.querySelector("#gm-dlg"); if (d && !d.hidden && d.classList.contains("on")) d.click(); }); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate(() => window.MPGame.street.state().sada && window.MPGame.save.flag("story.sada")), "Sada's beat played and was saved");
  await until(p, () => !window.MPGame.street.state().busy && !window.MPGame.ui.modalOpen, null, 10000);
  assert.ok(await p.evaluate(() => /الطابق|floor/i.test(document.querySelector("#gm-obj-t").textContent) && !window.MPGame.street.state().signal), "the next objective is up and the terminal went quiet");
  await shot(p, label + "-8e-sada");
  // Season 1 Phase 3 «السوق السفلي»: back at the tower Sada stops you, then the market stairs, Abu Nasser and a choice
  const clickDlg = () => p.evaluate(() => { const d = document.querySelector("#gm-dlg"); if (d && !d.hidden && d.classList.contains("on")) d.click(); });
  assert.ok(await p.evaluate(() => !window.MPGame.street.state().market), "the market is quiet before Sada finds the route");
  p.evaluate(() => { window.MPGame.street.use("tower"); }).catch(() => {});
  { const end = Date.now() + 30000;
    while (Date.now() < end && !(await p.evaluate(() => window.MPGame.street.state().route))) { await clickDlg(); await p.waitForTimeout(150); } }
  await until(p, () => !window.MPGame.street.state().busy && !window.MPGame.ui.modalOpen && !document.querySelector("#gm-tw"), null, 10000);
  assert.ok(await p.evaluate(() => window.MPGame.street.state().market && /السوق|market/i.test(document.querySelector("#gm-obj-t").textContent)), "route found: the market is the objective");
  await p.evaluate(() => { const s = window.MPGame.street, a = s.state().mkAt; s.player.pos.set(a.x, 0, a.z + 0.3); });
  await until(p, () => window.MPGame.street.state().near === "market" && !document.querySelector("#gm-act").hidden, null, 10000);
  assert.ok(await p.evaluate(() => /أبو ناصر|Abu Nasser/.test(document.querySelector("#gm-act-v").textContent)), "the action names Abu Nasser");
  await shot(p, label + "-8f-market");
  await tap(p, "#gm-act");
  const pickN = label === "m" ? 1 : 0; // phone takes the signal way, desktop the key way
  { const end = Date.now() + 30000;
    while (Date.now() < end && !(await p.evaluate(() => !!document.querySelector("#gm-modal [data-ch]")))) { await clickDlg(); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate(() => document.querySelectorAll("#gm-modal [data-ch]").length === 2 && getComputedStyle(document.querySelector("#gm-modal .gm-panel")).direction === "rtl"), "two choices, RTL");
  await shot(p, label + "-8g-choice");
  await tap(p, `#gm-modal [data-ch="${pickN}"]`);
  { const end = Date.now() + 80000;
    while (Date.now() < end && !(await p.evaluate(() => window.MPGame.street.state().record))) { await clickDlg(); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate((w) => window.MPGame.street.state().record && window.MPGame.save.flag("story.nasser." + w), pickN ? "signal" : "key"), "the record is saved with the chosen way");
  await until(p, () => !window.MPGame.street.state().busy, null, 10000);
  assert.ok(await p.evaluate(() => /مدخل الخدمة|service entrance/i.test(document.querySelector("#gm-obj-t").textContent) && !window.MPGame.street.state().market), "next objective: the service entrance; the stall went quiet");
  await shot(p, label + "-8h-record");
  // Season 1 Phase 4 «المدخل المحظور»: the service entrance is the guide's goal; the record at the reader, Salma, a choice,
  // examining the record reveals the hidden floor-40 reference, then the message to Yousuf and the next objective
  assert.ok(await p.evaluate(() => window.MPGame.street.state().service && window.MPGame.street.state().guide === "service"), "the service entrance is live and guided");
  assert.ok(await p.evaluate(() => !document.querySelector("#gm-svc").classList.contains("f40")), "no floor-40 reference before examining");
  await p.evaluate(() => { const s = window.MPGame.street, a = s.state().svcAt; s.player.walkTo(null); s.player.pos.set(a.x, 0, a.z + 0.2); });
  await until(p, () => window.MPGame.street.state().near === "service" && !document.querySelector("#gm-act").hidden, null, 10000);
  await shot(p, label + "-8i-service");
  await tap(p, "#gm-act");
  { const end = Date.now() + 80000;
    while (Date.now() < end && !(await p.evaluate(() => window.MPGame.ui.modalOpen && !!document.querySelector("#gm-modal [data-ch='1']")))) { await clickDlg(); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate(() => window.MPGame.street.state().inside), "inside the service corridor");
  assert.ok(await p.evaluate(() => getComputedStyle(document.querySelector("#gm-modal .gm-term-o")).direction === (document.documentElement.dir || "rtl")), "the choice reads in RTL");
  await shot(p, label + "-8j-salma-choice");
  const pickS = label === "m" ? 0 : 1; // phone asks about Yousuf, desktop about the floor
  await tap(p, `#gm-modal [data-ch="${pickS}"]`);
  await until(p, () => !document.querySelector("#gm-modal [data-ch]"), null, 10000); // the first choice has gone
  { const end = Date.now() + 80000;
    while (Date.now() < end && !(await p.evaluate(() => window.MPGame.ui.modalOpen && !!document.querySelector("#gm-modal [data-ch='0']")))) { await clickDlg(); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate(() => !document.querySelector("#gm-svc").classList.contains("f40") && !window.MPGame.street.state().served), "examining is still required");
  await tap(p, `#gm-modal [data-ch="0"]`);
  await until(p, () => document.querySelector("#gm-svc").classList.contains("f40"), null, 10000);
  await shot(p, label + "-8k-f40");
  { const end = Date.now() + 80000;
    while (Date.now() < end && !(await p.evaluate(() => window.MPGame.street.state().served))) { await clickDlg(); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate((w) => window.MPGame.street.state().served && window.MPGame.save.flag("story.salma2." + w), pickS ? "floor" : "knew"), "the entrance is saved with the chosen question");
  await until(p, () => !window.MPGame.street.state().busy && !window.MPGame.street.state().inside, null, 10000);
  assert.ok(await p.evaluate(() => /العليا|upper floors/i.test(document.querySelector("#gm-obj-t").textContent) && !window.MPGame.street.state().service && window.MPGame.street.state().guide === "maint"), "next objective: the upper floors; the guide moves to the old panel");
  await shot(p, label + "-8l-next");
  // Season 1 Phase 5 «وصول الطابق الأربعين»: the old maintenance panel — evidence (two at least), the route code (a wrong
  // one first is refused), the key's bit, a 60-second window, the service door, the old log against the official one
  const pickCh = async (want, ms = 40000) => { const end = Date.now() + ms; while (Date.now() < end && !(await p.evaluate(() => !!document.querySelector("#gm-modal [data-ch]")))) { await clickDlg(); await p.waitForTimeout(150); } assert.ok(await p.evaluate(() => !!document.querySelector("#gm-modal [data-ch]")), "a choice is up"); await tap(p, `#gm-modal [data-ch="${want}"]`); await p.waitForTimeout(350); };
  assert.ok(await p.evaluate(() => window.MPGame.street.state().maint), "the panel is live after the restricted entrance");
  await p.evaluate(() => { const s = window.MPGame.street, a = s.state().mtAt; s.player.walkTo(null); s.player.pos.set(a.x, 0, a.z + 0.2); });
  await until(p, () => window.MPGame.street.state().near === "maint" && !document.querySelector("#gm-act").hidden, null, 10000);
  await shot(p, label + "-8m-panel");
  await tap(p, "#gm-act");
  await pickCh(0); await pickCh(0); // two pieces of evidence…
  await pickCh(1); // …then «that's enough» (the option after the one evidence left)
  await pickCh(0); // a wrong code: refused, asked again
  await pickCh(1); // F-40
  await pickCh(1); // the record is not what the panel asks for
  await pickCh(0); // the key's bit
  { const end = Date.now() + 40000; while (Date.now() < end && !(await p.evaluate(() => window.MPGame.street.state().win > 0 && !window.MPGame.street.state().busy))) { await clickDlg(); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate(() => window.MPGame.street.state().win > 40 && !document.querySelector("#gm-timer").hidden && window.MPGame.save.flag("story.maintCode")), "the window is open with its countdown");
  await shot(p, label + "-8n-window");
  await p.evaluate(() => { const s = window.MPGame.street, a = s.state().svcAt; s.player.walkTo(null); s.player.pos.set(a.x, 0, a.z + 0.2); });
  await until(p, () => window.MPGame.street.state().near === "service" && !document.querySelector("#gm-act").hidden, null, 10000);
  await tap(p, "#gm-act");
  await pickCh(0); // open the night's logs
  { const end = Date.now() + 80000; while (Date.now() < end && !(await p.evaluate(() => window.MPGame.street.state().maintDone))) { await clickDlg(); await p.waitForTimeout(150); } }
  assert.ok(await p.evaluate(() => window.MPGame.street.state().maintDone && window.MPGame.save.flag("story.maint")), "the maintenance route is saved");
  await until(p, () => !window.MPGame.street.state().busy && !window.MPGame.street.state().inside, null, 10000);
  assert.ok(await p.evaluate(() => !window.MPGame.street.state().guide && document.querySelector("#gm-timer").hidden && /التناقض|contradiction/i.test(document.querySelector("#gm-obj-t").textContent)), "next objective set; no guide, no timer");
  await shot(p, label + "-8o-done");
  // repeating: the door is locked now, no second sequence
  await p.evaluate(() => window.MPGame.street.use("service")); await p.waitForTimeout(400);
  assert.ok(await p.evaluate(() => !document.querySelector("#gm-dlg").classList.contains("on") && !window.MPGame.ui.modalOpen && !window.MPGame.street.state().inside), "no replay at the service door");
  // repeating: the stall no longer offers the beat, the tower opens normally (no second route beat)
  await p.evaluate(() => window.MPGame.street.use("market")); await p.waitForTimeout(300);
  assert.ok(await p.evaluate(() => !document.querySelector("#gm-dlg").classList.contains("on") && !window.MPGame.ui.modalOpen), "no replay at the stall");
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

test("game v2.88 — phone 390", { timeout: 660000 }, () => run("m", MOBILE));
test("game v2.88 — desktop 1366", { timeout: 660000 }, () => run("d", { viewport: { width: 1366, height: 800 }, locale: "ar-SA" }));
