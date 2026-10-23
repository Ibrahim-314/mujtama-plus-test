/* Phase 44 e2e against the real server (production build): #/settings/appearance — colour theme, live preview, mode +
 * true-black OLED, compact density, reorderable nav, alternate app icon — saved to the server (/api/prefs), restored early
 * from localStorage on reload (no flash), picked up by a second device signing in, and pushed live to it (realtime "prefs").
 * Also: «تراجع», no page errors, no inline handlers in the chunk, core within budget. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, dismissTour, MOBILE, ROOT } = require("./harness");

let S, c1, c2, p, q; const errors = [];
const until = async (pg, fn, arg, ms = 10000) => pg.waitForFunction(fn, arg, { timeout: ms });
const rootVar = (pg, v) => pg.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), v);
const navOrder = (pg) => pg.evaluate(() => [...document.querySelectorAll(".bottomnav a[data-r]")].map((a) => a.dataset.r));
const serverUi = async () => { const { db } = S.app.ctx; const uid = (await db.get("SELECT id FROM users WHERE handle='pf_e2e'")).id; const r = await S.app.ctx.services.prefs.read(uid); return r.prefs.ui || {}; };

test.before(async () => {
  S = await startStack();
  c1 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await c1.newPage(); p.on("pageerror", (e) => errors.push("p: " + e.message));
  await onboard(p, S.base, "pf_e2e", "مختبر المظهر");
});
test.after(async () => { await c1?.close(); await c2?.close(); await S?.close(); });

test("appearance screen: palette + live preview, mode + OLED, density, nav order, icon — saved to the server", async () => {
  await p.goto(S.base + "/?nosw#/settings?s=display"); // v2.38: «المظهر واللغة»
  await p.waitForSelector("#mp-pf-set", { timeout: 15000 }); // lazy chunk adds the entry card
  await p.click("#mp-pf-set");
  await p.waitForSelector("#pf-pv");
  await p.click('[data-pfmode="light"]');
  await until(p, () => document.documentElement.dataset.theme === "light");
  await p.click('[data-pf="pal:ocean"]');
  await until(p, () => document.documentElement.dataset.palette === "ocean");
  assert.equal(await rootVar(p, "--accent"), "#0b63c1");
  assert.equal(await p.getAttribute('[data-pf="pal:ocean"]', "aria-pressed"), "true");
  // live preview: focusing another swatch previews it in the card only
  await p.focus('[data-pf="pal:forest"]');
  assert.equal(await p.evaluate(() => document.getElementById("pf-pv").style.getPropertyValue("--pv-accent")), "#1d7a44");
  assert.equal(await rootVar(p, "--accent"), "#0b63c1", "app keeps the chosen theme while previewing");
  await p.focus('[data-pf="pal:ocean"]');
  // dark + true black OLED
  await p.click('[data-pfmode="dark"]');
  await p.check("#pf-oled");
  await until(p, () => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() === "#000" && document.documentElement.dataset.theme === "dark");
  assert.equal(await rootVar(p, "--accent"), "#5aa9ff");
  assert.equal(await p.getAttribute('meta[name="theme-color"]', "content"), "#000000");
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(0, 0, 0)");
  // compact density
  await p.click('[data-pfden="compact"]');
  await until(p, () => document.documentElement.dataset.density === "compact");
  assert.equal(await rootVar(p, "--s4"), "12px");
  // nav: move «المزيد» to the front with the ↑ buttons (keyboard-reachable, focus follows the item)
  for (let i = 0; i < 4; i++) await p.click('[data-pfup="menu"]');
  assert.deepEqual(await navOrder(p), ["menu", "home", "explore", "communities", "notifications"]);
  assert.equal(await p.evaluate(() => document.activeElement?.dataset.pfdn), "menu");
  // alternate icon: manifest + apple-touch-icon swapped, both served
  await p.click('[data-pf="ic:midnight"]');
  await until(p, () => /icon=midnight/.test(document.querySelector('link[rel="manifest"]')?.href || ""));
  const touch = await p.getAttribute('link[rel="apple-touch-icon"]', "href");
  assert.equal(touch, "/api/prefs/icons/midnight-180.png");
  const png = await p.request.get(S.base + touch); assert.equal(png.status(), 200); assert.equal(png.headers()["content-type"], "image/png");
  const man = await (await p.request.get(S.base + "/api/prefs/manifest.webmanifest?icon=midnight")).json();
  assert.equal(man.icons[0].src, "/api/prefs/icons/midnight-192.png");
  // saved on the server (debounced PUT)
  const want = { theme: "dark", palette: "ocean", oled: true, density: "compact", icon: "midnight", nav: ["menu", "home", "explore", "communities", "notifications"] };
  for (let i = 0; i < 40; i++) { const u = await serverUi(); if (JSON.stringify(Object.keys(want).map((k) => u[k])) === JSON.stringify(Object.values(want))) break; await new Promise((r) => setTimeout(r, 150)); }
  const u = await serverUi(); for (const k of Object.keys(want)) assert.deepEqual(u[k], want[k], k);
});

test("reload: saved theme is applied by the core before the chunk loads", async () => {
  await p.reload();
  await p.waitForSelector(".bottomnav a[data-r=home]");
  const early = await p.evaluate(() => ({ style: !!document.getElementById("mp-ui"), css: document.getElementById("mp-ui")?.textContent || "" }));
  assert.ok(early.style); assert.match(early.css, /--bg:#000/); assert.match(early.css, /a\[data-r=menu\]\{order:1\}/);
  assert.equal(await rootVar(p, "--bg"), "#000");
  assert.equal(await rootVar(p, "--s4"), "12px");
  const box = await p.evaluate(() => [...document.querySelectorAll(".bottomnav a[data-r]")].map((a) => [a.dataset.r, a.getBoundingClientRect().left]).sort((x, y) => y[1] - x[1]).map((x) => x[0]));
  assert.equal(box[0], "menu", "RTL: first item on the right");
});

test("second device: signing in adopts the account's prefs; later changes arrive live", async () => {
  c2 = await S.browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "ar-SA", reducedMotion: "reduce" });
  q = await c2.newPage(); q.on("pageerror", (e) => errors.push("q: " + e.message));
  await q.goto(S.base + "/?nosw");
  await q.fill("#a-handle", "pf_e2e"); await q.fill("#a-pass", "secret1234"); await q.click("#a-go");
  const ob = await q.waitForSelector("#n1, .bottomnav a[data-r=home]", { timeout: 15000 });
  if (await ob.getAttribute("id") === "n1") { await q.click("#n1"); for (const t of ["ai", "dev", "pi"]) await q.click(`[data-i="${t}"]`); await q.click("#n2"); await q.click("#n3"); }
  await dismissTour(q);
  await until(q, () => document.documentElement.dataset.palette === "ocean" && document.documentElement.dataset.oled === "" && document.documentElement.dataset.theme === "dark", null, 20000);
  assert.equal(await rootVar(q, "--bg"), "#000");
  await until(q, () => document.querySelector(".bottomnav a[data-r]")?.dataset.r === "menu");
  // device 1 picks «وردي» → device 2 follows (realtime ping or focus re-fetch)
  await p.goto(S.base + "/?nosw#/settings/appearance"); await p.waitForSelector('[data-pf="pal:rose"]', { timeout: 15000 });
  await p.click('[data-pf="pal:rose"]');
  await q.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await until(q, () => document.documentElement.dataset.palette === "rose", null, 15000);
  assert.equal(await rootVar(q, "--accent"), "#ff7aa8");
});

test("تراجع restores how things were when the screen opened; defaults reset everything", async () => {
  await p.goto(S.base + "/?nosw#/home"); await p.waitForSelector(".bottomnav a[data-r=home]");
  await p.goto(S.base + "/?nosw#/settings/appearance"); await p.waitForSelector("#pf-undo", { timeout: 15000 }); // a fresh visit: the undo point is now (rose, compact)
  await p.click('[data-pf="pal:gold"]'); await p.click('[data-pfden="comfortable"]');
  await until(p, () => document.documentElement.dataset.palette === "gold" && document.documentElement.dataset.density === "comfortable");
  await p.click("#pf-undo");
  await until(p, () => document.documentElement.dataset.palette === "rose" && document.documentElement.dataset.density === "compact");
  await p.click("#pf-reset");
  await until(p, () => document.documentElement.dataset.palette === "violet" && document.documentElement.dataset.density === "comfortable" && document.documentElement.dataset.oled === undefined);
  assert.deepEqual(await navOrder(p), ["home", "explore", "communities", "notifications", "menu"]);
  assert.equal(await p.evaluate(() => localStorage.getItem("mp.ui")), null, "nothing to inject for the default look");
  assert.deepEqual(errors, []);
});

test("phase 43 interplay: high contrast wins over palettes + OLED even when the palette CSS comes later", async () => {
  await until(p, () => !!window.MPA11y && !!window.MPPrefs, null, 15000);
  const r = await p.evaluate(() => {
    const H = document.documentElement, was = H.dataset.theme, add = (id, css) => { const st = document.createElement("style"); st.id = id; st.textContent = css; document.head.appendChild(st); return st; };
    const a = add("t-hc", window.MPA11y.css({ fontScale: 1, contrast: "high", spacing: "normal", motion: "system" })), b = add("t-pal", window.MPPrefs.css({ palette: "ocean", oled: true }));
    const v = (n) => getComputedStyle(H).getPropertyValue(n).trim(), out = {};
    H.dataset.theme = "dark"; out.dark = [v("--bg"), v("--accent")];
    H.dataset.theme = "light"; out.light = [v("--bg"), v("--accent")];
    a.remove(); b.remove(); if (was) H.dataset.theme = was; else delete H.dataset.theme; return out;
  });
  assert.deepEqual(r.dark, ["#000", "#d9c9ff"]);
  assert.deepEqual(r.light, ["#fff", "#3a00b8"]);
});

test("build: prefs chunk has no inline handlers and the core stays within budget", () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file));
  assert.ok(core.br <= 90 * 1024, "core " + core.br);
  const f = b.files.find((x) => /chunk-prefs-.*\.js$/.test(x.file)); assert.ok(f);
  const src = fs.readFileSync(path.join(ROOT, "dist", f.file), "utf8");
  assert.ok(!/\son[a-z]+=["']/.test(src) && !/javascript:/.test(src));
});
