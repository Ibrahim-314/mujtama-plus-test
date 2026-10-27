/* v2.105 «نبض النواة»: the Godot 4 Web game mounted at #/city against the production build.
 * Covers: menu entry, lazy "nabd" chunk, full-screen same-origin iframe with the app bars hidden, the engine served
 * pre-gzipped with the right MIME, the game page's CSP (wasm-unsafe-eval only there, not on the app shell), no CSP
 * violations, no cross-origin-isolation requirement, exit button, and #/city/<name> still the nearby city page.
 * Rendering needs WebGL2 (not in the headless CI browser), so the game's own "nabd:ready" is reported, not required. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S, ctx, p; const errors = [];
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "nabd_e2e", "لاعب النواة");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("engine assets: gzip + application/wasm, game CSP allows wasm only on its own page, no COOP/COEP", async () => {
  const w = await fetch(S.base + "/nabd/engine/index.wasm", { headers: { "accept-encoding": "gzip" } });
  assert.equal(w.status, 200); assert.equal(w.headers.get("content-type"), "application/wasm");
  const buf = new Uint8Array(await w.arrayBuffer());
  assert.deepEqual([...buf.slice(0, 4)], [0, 0x61, 0x73, 0x6d], "valid wasm magic");
  const raw = await fetch(S.base + "/nabd/engine/index.pck", { headers: { "accept-encoding": "identity" } });
  assert.equal(raw.status, 200); assert.ok(!raw.headers.get("content-encoding"));
  const h = await fetch(S.base + "/nabd/engine/index.html");
  assert.match(h.headers.get("content-security-policy") || "", /script-src[^;]*'wasm-unsafe-eval'/);
  assert.ok(!h.headers.get("cross-origin-embedder-policy"), "no COEP needed (single-threaded export)");
  assert.ok(!h.headers.get("link"), "no app preloads on the game page");
  assert.doesNotMatch((await fetch(S.base + "/")).headers.get("content-security-policy") || "", /unsafe-eval/, "app shell CSP stays strict");
});

test("#/city mounts the game full screen, bars hidden, exit returns, #/city/<name> stays nearby", async () => {
  await p.goto(S.base + "/#/menu"); await p.waitForSelector('a[href="#/city"]', { timeout: 20000, state: "attached" });
  assert.match(await p.textContent('a[href="#/city"]'), /نبض النواة/);
  const viol = [];
  p.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) viol.push(m.text()); });
  await p.evaluate(() => { location.hash = "#/city"; });
  await p.waitForSelector("#nb-root iframe", { timeout: 20000 });
  assert.ok(await p.evaluate(() => document.body.classList.contains("nb-on")));
  assert.ok(await p.evaluate(() => [...document.querySelectorAll(".bottomnav, .topbar")].every((e) => getComputedStyle(e).visibility === "hidden")));
  const box = await p.$eval("#nb-root", (e) => { const r = e.getBoundingClientRect(); return [r.width, r.height, innerWidth, innerHeight]; });
  assert.equal(box[0], box[2]); assert.equal(box[1], box[3]);
  await p.waitForFunction(() => { const f = document.querySelector("#nb-root iframe"); try { return f.contentWindow.document.readyState === "complete" && typeof f.contentWindow.Engine === "function"; } catch { return false; } }, null, { timeout: 30000 });
  const ready = await p.waitForFunction(() => document.querySelector("#nb-root.ready"), null, { timeout: 45000 }).then(() => true, () => false);
  console.log("# nabd:ready in headless:", ready);
  assert.deepEqual(viol, [], "no CSP violations");
  await p.click(".nb-x"); await p.waitForFunction(() => !document.querySelector("#nb-root") && !location.hash.startsWith("#/city"), null, { timeout: 10000 });
  assert.ok(!(await p.evaluate(() => document.body.classList.contains("nb-on"))));
  await p.goto(S.base + "/#/city/riyadh"); await p.waitForTimeout(2500);
  assert.equal(await p.$("#nb-root"), null, "#/city/<name> is the nearby page, not the game");
  assert.deepEqual(errors.filter((e) => !/AudioContext/.test(e)), []);
});
