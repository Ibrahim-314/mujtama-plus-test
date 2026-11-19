/* v2.149.11 «دخول Pi سلس» (2026-11-18): eager Pi.init at app start, scopes username only while payments are off,
 * the sign-in button usable whenever the Pi SDK is present (not the UA alone), step beacons to POST /api/pi/diag
 * (no token), and an init that never answers ends in 15 s with an «open in Pi Browser» hint instead of a silent wait. */
const test = require("node:test"); const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path"); const vm = require("node:vm");
const root = path.join(__dirname, "../..");
const src = fs.readFileSync(path.join(root, "pi-adapter.js"), "utf8");
function load({ ua = "Mozilla/5.0", framed = false, cfg = { enabled: false, authEnabled: true, network: "testnet" }, pi = null } = {}) {
  const sent = [], win = {}; win.self = win; win.top = framed ? {} : win;
  if (pi) win.Pi = pi;
  const fetch = async (url, o = {}) => { if (url === "/api/pi/diag") { sent.push(JSON.parse(o.body)); return { ok: true }; } return { ok: true, json: async () => cfg }; };
  const ctx = { window: win, navigator: { userAgent: ua }, document: { getElementById: () => null }, console: { warn() { } }, setTimeout, clearTimeout, setInterval, clearInterval, Promise, fetch, performance: { getEntriesByName: () => [] } };
  vm.createContext(ctx); vm.runInContext(src + "\n;this.__A = PiAdapter;", ctx);
  return { A: ctx.__A, sent, win };
}
const fakePi = (o = {}) => ({ inits: [], scopes: null, init(x) { this.inits.push(x); return o.initHang ? new Promise(() => { }) : undefined; }, authenticate(s, cb) { this.scopes = s; return Promise.resolve({ accessToken: "secret-token-xyz", user: { uid: "u", username: "pi_amal" } }); } });

test("scopes: username only while Pi payments are off, + payments when they are on", async () => {
  const pi = fakePi(); const { A } = load({ ua: "PiBrowser/2.0", pi });
  assert.deepEqual([...A.scopes({ enabled: false })], ["username"]);
  assert.deepEqual([...A.scopes({ enabled: true })], ["username", "payments"]);
  const r = await A.authenticate();
  assert.deepEqual({ ...r }, { accessToken: "secret-token-xyz" });
  assert.deepEqual([...pi.scopes], ["username"], "payments off on the server config → no payments scope");
  const pi2 = fakePi(); const b = load({ ua: "PiBrowser/2.0", pi: pi2, cfg: { enabled: true, authEnabled: true } });
  await b.A.authenticate(); assert.deepEqual([...pi2.scopes], ["username", "payments"]);
});

test("boot: eager Pi.init once at app start (no sandbox in Pi Browser), idempotent; app.js calls it", async () => {
  const pi = fakePi(); const { A } = load({ ua: "Mozilla/5.0 PiBrowser/2.0", pi, cfg: { enabled: false, authEnabled: true, sdkSandbox: true } });
  assert.equal(await A.boot(), true); await A.boot(); await A.init();
  assert.equal(pi.inits.length, 1); assert.deepEqual({ ...pi.inits[0] }, { version: "2.0" });
  assert.match(fs.readFileSync(path.join(root, "app.js"), "utf8"), /^PiAdapter\.boot\(\);/m);
});

test("host(): the sign-in button is usable when the Pi SDK is present even if the UA has no PiBrowser", () => {
  assert.equal(load({ pi: fakePi() }).A.host(), true);
  assert.equal(load({ ua: "Mozilla/5.0 PiBrowser/2.0" }).A.host(), true);
  assert.equal(load({}).A.host(), false);
  // v2.149.13: the Pi sign-in button lives in the gate screen (gate-ui.js); outside the detected Pi Browser it is «داخل متصفح Pi؟»,
  // usable whenever the SDK is present (and enabled once the async SDK arrives), and it runs the same MPPi.signIn flow
  const ui = fs.readFileSync(path.join(root, "gate-ui.js"), "utf8");
  assert.match(ui, /usable = \(c\) => inPi\(c\) \|\| !!PiAdapter\.host\?\.\(\)/);
  assert.match(ui, /id="gt-pi-try"[^`]*\$\{usable\(c\) \? "" : "disabled"\}/);
  assert.match(ui, /tb\.onclick = piGo\(tb\)/);
  assert.match(ui, /PiAdapter\.sdk\?\.\(\)\.then\(\(\) => \{ if \(tb\.isConnected && usable\(cfg\)[^}]*tb\.disabled = false/);
  assert.match(ui, /MPPi\.signIn\(pb, n,/);
  assert.match(fs.readFileSync(path.join(root, "pi-ui.js"), "utf8"), /async function signIn\(b, n, opts = \{\}\)/);
});

test("diag beacons: init_ok + auth_start/auth_ok in Pi Browser, never the access token; nothing on a plain page load", async () => {
  const pi = fakePi(); const { A, sent } = load({ ua: "Mozilla/5.0 PiBrowser/2.0", pi });
  await A.authenticate(); await new Promise(r => setTimeout(r, 5));
  const steps = sent.map(s => s.step);
  for (const s of ["sdk_loaded", "init_ok", "auth_start", "auth_ok"]) assert.ok(steps.includes(s), s);
  assert.ok(!JSON.stringify(sent).includes("secret-token"), "no token in beacons");
  assert.ok(sent.every(s => typeof s.ms === "number" && s.ua.length <= 160 && s.framed === false));
  const plain = load({ pi: fakePi() }); await plain.A.boot();
  assert.deepEqual(plain.sent, [], "a regular browser page load sends no beacons");
});

test("an init that never answers fails in 15 s (init_err beacon) instead of hanging; the UI then shows the Pi Browser hint", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pi = fakePi({ initHang: true }); const { A, sent } = load({ ua: "PiBrowser/2.0", pi });
  const p = A.init();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); // config + sdk awaits run, then the 15 s race timer is armed
  t.mock.timers.tick(15e3);
  assert.equal(await p, false);
  assert.ok(sent.some(s => s.step === "init_err" && /timeout/.test(s.msg)));
  const ui = fs.readFileSync(path.join(root, "pi-ui.js"), "utf8");
  assert.ok(ui.includes("تعذّر تشغيل Pi هنا. افتح التطبيق من متصفح Pi."));
  const en = fs.readFileSync(path.join(root, "i18n-enextra.js"), "utf8");
  for (const k of ["جارٍ تجهيز Pi…", "أكّد الدخول في نافذة Pi…", "جارٍ تسجيل الدخول…", "أُنشئ حسابك بحساب Pi", "تعذّر تشغيل Pi هنا. افتح التطبيق من متصفح Pi."]) assert.ok(en.includes(JSON.stringify(k) + ":"), k);
});
