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
const visible = (p, sel, ms) => until(p, (s) => { const e = document.querySelector(s); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, sel, ms);
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
  await visible(p, "#gm-modal [data-st=earn]");
  await p.waitForTimeout(500);
  await shot(p, label + "-5-terminal");
  await tap(p, "#gm-modal [data-st=earn]");
  await until(p, () => location.hash === "#/city/mjt/earn");
  await visible(p, "body > .cy-st", 30000);
  assert.ok(await p.evaluate(() => document.querySelector("#gm-root").classList.contains("gm-behind")), "game paused behind the station");
  await p.waitForTimeout(600);
  await shot(p, label + "-6-station");
  await p.evaluate(() => window.MPCity.closeRoom());
  await until(p, () => !document.querySelector("#gm-root")?.classList.contains("gm-behind"));
  assert.ok(await p.evaluate(() => window.MPGame?.scenes.name === "room"), "back in the room after the station");

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
