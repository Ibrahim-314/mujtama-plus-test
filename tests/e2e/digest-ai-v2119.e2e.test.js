/* v2.119 «فاتك اليوم» Stage 3 — brief length + tone (saved on the device, sent to the model, cached per choice) and listen-aloud
 * (browser speechSynthesis, stubbed here: speaks headline + sections in Arabic, second tap stops). */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, meId, MOBILE } = require("./harness");

let calls = 0, last = "";
const freeProvider = { label: "مجتمع بلس", async chat(msgs) {
  calls++; const q = (last = msgs[msgs.length - 1].content); const id = (q.match(/"id":"([^"]+)"/) || [])[1];
  return { text: JSON.stringify({ headline: "يومك هادئ ومليء بالقهوة", sections: [{ kind: "people", items: [{ text: "سارة جربت محمصة جديدة", cites: [id] }] }] }), model: "m" };
} };
let S, c1, c2, p, q; const errors = [];
const call = (pg, method, url, body) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status }; }, [method, url, body]);
test.before(async () => {
  S = await startStack({ aihubOpts: { freeProvider } });
  c1 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); c2 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  await c1.addInitScript(() => {
    window.__said = []; let speaking = false;
    window.SpeechSynthesisUtterance = function (t) { this.text = t; };
    Object.defineProperty(window, "speechSynthesis", { value: { get speaking() { return speaking; }, getVoices: () => [{ lang: "ar-SA", name: "ar" }],
      speak(u) { speaking = true; window.__said.push({ text: u.text, lang: u.lang }); window.__u = u; }, cancel() { if (speaking) { speaking = false; window.__u?.onend?.(); } } } });
  });
  p = await c1.newPage(); p.on("pageerror", (e) => errors.push(e.message)); q = await c2.newPage();
  await onboard(p, S.base, "dlen_reader", "قارئ"); await onboard(q, S.base, "dlen_sara", "سارة");
  assert.ok((await call(p, "PUT", "/api/follows/" + (await meId(q)), {})).status < 300);
  assert.ok((await call(q, "POST", "/api/posts", { id: "p_dlen" + Date.now().toString(36), type: "general", text: "جربت اليوم محمصة جديدة في جدة والقهوة كانت ممتازة" })).status < 300);
});
test.after(async () => { await c1?.close(); await c2?.close(); await S?.close(); });

test("length + tone chosen before making: no model call until «اصنع», then sent and remembered", async () => {
  await p.goto(S.base + "/#/digest"); await p.waitForSelector('#dbr [data-br="make"]', { timeout: 15000 }); await p.waitForTimeout(500);
  calls = 0;
  await p.click('#dbr [data-opt="len"][data-v="short"]'); await p.click('#dbr [data-opt="tone"][data-v="formal"]');
  assert.equal(calls, 0); assert.equal(await p.getAttribute('#dbr [data-opt="len"][data-v="short"]', "aria-pressed"), "true");
  await p.click('#dbr [data-br="make"]'); await p.waitForSelector("#dbr .dbr-lead", { timeout: 10000 });
  assert.equal(calls, 1); assert.match(last, /مختصرة جداً/); assert.match(last, /رسمية/);
  assert.equal(await p.getAttribute('#dbr [data-opt="tone"][data-v="formal"]', "aria-pressed"), "true");
  await p.click('#dbr [data-opt="len"][data-v="long"]'); await p.waitForFunction(() => document.querySelector('#dbr [data-opt="len"][data-v="long"]')?.getAttribute("aria-pressed") === "true", null, { timeout: 10000 });
  assert.equal(calls, 2); assert.match(last, /مفصّلة/);
  assert.deepEqual(JSON.parse(await p.evaluate(() => localStorage.getItem("mp_brief"))), { len: "long", tone: "formal" });
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
});

test("listen aloud reads the brief in Arabic; second tap stops", async () => {
  await p.click("#dbr [data-say]");
  const said = await p.evaluate(() => window.__said);
  assert.equal(said.length, 1); assert.equal(said[0].lang, "ar-SA"); assert.match(said[0].text, /يومك هادئ/); assert.match(said[0].text, /سارة جربت/);
  assert.equal(await p.getAttribute("#dbr [data-say]", "aria-pressed"), "true"); assert.match(await p.textContent("#dbr [data-say]"), /إيقاف/);
  await p.click("#dbr [data-say]"); assert.equal(await p.getAttribute("#dbr [data-say]", "aria-pressed"), "false");
  assert.deepEqual(errors, []);
});
