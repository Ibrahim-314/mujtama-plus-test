/* v2.149.10 (2026-11-18): Pi.init({sandbox:true}) only inside the sandbox.minepi.com frame (not in Pi Browser, not in a top-level tab),
 * and Pi.authenticate never spins forever (90 s timeout with a clear message). */
const test = require("node:test"); const assert = require("node:assert/strict");
const fs = require("node:fs"); const path = require("node:path"); const vm = require("node:vm");
const src = fs.readFileSync(path.join(__dirname, "../../pi-adapter.js"), "utf8");
function load({ ua = "Mozilla/5.0", framed = false } = {}) {
  const win = {}; win.self = win; win.top = framed ? {} : win;
  const ctx = { window: win, navigator: { userAgent: ua }, console, setTimeout, clearTimeout, Promise, fetch: async () => ({ ok: false }) };
  vm.createContext(ctx); vm.runInContext(src + "\n;this.__A = PiAdapter;", ctx); return ctx.__A;
}
test("useSandbox: only framed, not Pi Browser, and only when the server says sdkSandbox", () => {
  assert.equal(load({ framed: true }).useSandbox({ sdkSandbox: true }), true);
  assert.equal(load({ framed: false }).useSandbox({ sdkSandbox: true }), false, "top-level tab");
  assert.equal(load({ framed: true, ua: "Mozilla/5.0 PiBrowser/2.0" }).useSandbox({ sdkSandbox: true }), false, "Pi Browser");
  assert.equal(load({ framed: true }).useSandbox({}), false, "server off");
});
test("authenticate has a timeout and the message has an English translation", () => {
  assert.match(src, /Promise\.race\(\[window\.Pi\.authenticate/); assert.match(src, /90e3/);
  const en = fs.readFileSync(path.join(__dirname, "../../i18n-enextra.js"), "utf8");
  assert.ok(en.includes('"انتهت مهلة الدخول بحساب Pi. افتح مجتمع بلس من متصفح Pi وحاول مرة أخرى.": "Pi sign-in timed out.'));
});
