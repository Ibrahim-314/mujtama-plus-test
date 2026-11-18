/* v2.149.12 «Pi Browser يتعرّف صح» (2026-11-18): the real Pi Browser UA ends with a bare " Pi" token (no "PiBrowser"),
 * the app is opened through the official https://mujtamakt6955.pinet.com URL that frames it inside Pi Browser, and the
 * SDK sandbox mode is used ONLY when the parent is sandbox.minepi.com (never *.pinet.com, never in Pi Browser). */
const test = require("node:test"); const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path"); const vm = require("node:vm");
const root = path.join(__dirname, "../..");
const src = fs.readFileSync(path.join(root, "pi-adapter.js"), "utf8");
const REAL_PI_UA = "Mozilla/5.0 (Linux; Android 10; VOG-L29 Build/HUAWEIVOG-L29; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.8103.38 Mobile Safari/537.36 Pi";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
function load({ ua = CHROME_UA, framed = false, ancestors = null, referrer = "" } = {}) {
  const sent = [], win = {}; win.self = win; win.top = framed ? {} : win;
  win.location = ancestors ? { ancestorOrigins: Object.assign([...ancestors], { item: (i) => ancestors[i] }) } : {};
  const fetch = async (url, o = {}) => { if (url === "/api/pi/diag") sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; };
  const ctx = { window: win, location: win.location, navigator: { userAgent: ua }, document: { referrer, getElementById: () => null }, console: { warn() { } }, setTimeout, clearTimeout, Promise, fetch };
  vm.createContext(ctx); vm.runInContext(src + "\n;this.__A = PiAdapter;", ctx);
  return { A: ctx.__A, sent };
}

test("inPiBrowser: the real Pi Browser UA (trailing « Pi») and Pi/x.y match; PiBrowser still matches; plain browsers do not", () => {
  assert.equal(load({ ua: REAL_PI_UA }).A.inPiBrowser(), true, "real UA from the Pi Browser on Android");
  assert.equal(load({ ua: CHROME_UA + " Pi/2.3.1" }).A.inPiBrowser(), true, "Pi/x.y token");
  assert.equal(load({ ua: "Mozilla/5.0 PiBrowser/2.0" }).A.inPiBrowser(), true, "old PiBrowser token");
  assert.equal(load({ ua: CHROME_UA }).A.inPiBrowser(), false, "plain Chrome");
  assert.equal(load({ ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pi) Chrome/131 Mobile Safari/537.36" }).A.inPiBrowser(), false, "« Pi» not at the end");
  assert.equal(load({ ua: "Mozilla/5.0 Raspberry Pi" }).A.inPiBrowser(), true, "trailing Pi token is the rule (accepted edge case)");
});

test("useSandbox: real Pi UA top-level → false; Pi UA framed in pinet → false; desktop framed in sandbox.minepi.com → true; plain Chrome top-level → false", () => {
  const on = { sdkSandbox: true };
  assert.equal(load({ ua: REAL_PI_UA }).A.useSandbox(on), false, "Pi Browser top-level");
  assert.equal(load({ ua: REAL_PI_UA, framed: true, ancestors: ["https://mujtamakt6955.pinet.com"], referrer: "https://mujtamakt6955.pinet.com/" }).A.useSandbox(on), false, "Pi Browser framed in pinet");
  assert.equal(load({ framed: true, ancestors: ["https://mujtamakt6955.pinet.com"] }).A.useSandbox(on), false, "desktop framed in pinet");
  assert.equal(load({ framed: true, referrer: "https://mujtamakt6955.pinet.com/x" }).A.useSandbox(on), false, "pinet referrer only");
  assert.equal(load({ framed: true, ancestors: ["https://sandbox.minepi.com"] }).A.useSandbox(on), true, "desktop framed in the Pi sandbox (ancestorOrigins)");
  assert.equal(load({ framed: true, referrer: "https://sandbox.minepi.com/app/mujtama" }).A.useSandbox(on), true, "desktop framed in the Pi sandbox (referrer, Firefox)");
  assert.equal(load({ framed: true, ancestors: ["https://sandbox.minepi.com"] }).A.useSandbox({}), false, "server says no sandbox");
  assert.equal(load({ framed: true }).A.useSandbox(on), false, "framed by an unknown parent");
  assert.equal(load({}).A.useSandbox(on), false, "plain Chrome top-level");
  assert.equal(load({ ua: REAL_PI_UA, framed: true, ancestors: ["https://sandbox.minepi.com"] }).A.useSandbox(on), false, "never in Pi Browser");
});

test("parent(): origin host only (no path), from ancestorOrigins first, then the referrer; '' when top-level", () => {
  assert.equal(load({ framed: true, ancestors: ["https://mujtamakt6955.pinet.com"], referrer: "https://other.example/a" }).A.parent(), "mujtamakt6955.pinet.com");
  assert.equal(load({ framed: true, referrer: "https://sandbox.minepi.com/app/x?y=1" }).A.parent(), "sandbox.minepi.com");
  assert.equal(load({}).A.parent(), "");
});

test("diag beacon carries the framed parent host (no path, no token)", () => {
  const { A, sent } = load({ ua: REAL_PI_UA, framed: true, ancestors: ["https://mujtamakt6955.pinet.com"] });
  A.diag("init_ok", "", 0);
  assert.equal(sent.length, 1); assert.equal(sent[0].parent, "mujtamakt6955.pinet.com"); assert.equal(sent[0].framed, true);
});

test("server UA classifiers know the real Pi Browser UA", () => {
  const { deviceOf } = require(path.join(root, "server/services/canalytics.js"));
  assert.equal(deviceOf(REAL_PI_UA), "pi"); assert.equal(deviceOf("Mozilla/5.0 PiBrowser/2.0"), "pi"); assert.equal(deviceOf(CHROME_UA), "desktop");
  const sec = fs.readFileSync(path.join(root, "server/services/security.js"), "utf8");
  assert.ok(sec.includes("/PiBrowser|(?:^|\\s)Pi(?:\\/[\\d.]+)?\\s*$/"), "security.js describeUA uses the same rule");
});
