/* v2.153.0 «كل دفعة لها أثر»: every server payment purpose has an Arabic label in receipts / wallet (they showed «ppv», «jobs»…),
 * and the old «دعم المبدع» entry points (post menu, profile menu) open the tips sheet instead of a generic payment nobody is credited for. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..", "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("pi-ui: a label for every default purpose", () => {
  const server = read("server/services/pi.js"), ui = read("pi-ui.js");
  const purposes = JSON.parse(/const DEFAULT_PURPOSES = (\[[^\]]+\])/.exec(server)[1]);
  const m = /const PURPOSE = (\{[\s\S]*?\});/.exec(ui); assert.ok(m, "PURPOSE map");
  const labels = vm.runInNewContext("(" + m[1] + ")");
  for (const p of purposes) assert.ok(labels[p] && /[\u0600-\u06FF]/.test(labels[p]), "label for " + p);
});

test("PiAdapter.createPayment with toHandle opens the tips sheet (post and profile)", async () => {
  const calls = [];
  const sandbox = { window: { MPTips: { tipSheet: async (o) => { calls.push(o); return "tipped"; } }, MPPi: { paySheet: async () => "generic" }, MPChunks: { load: async () => { } } } };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(read("pi-adapter.js") + "\n;this.__A = PiAdapter;", sandbox);
  const A = sandbox.__A;
  assert.equal(await A.createPayment(1, "دعم أمل", { post: "p9", toHandle: "amal", name: "أمل" }), "tipped");
  assert.equal(await A.createPayment(1, "دعم", { toHandle: "amal" }), "tipped");
  assert.deepEqual(calls.map((c) => [c.postId, c.toHandle]), [["p9", "amal"], [null, "amal"]]);
  assert.equal(await A.createPayment(1, "تبرع", {}), "generic", "no creator → generic donation sheet");
  const v12 = read("v12.js");
  assert.match(v12, /createPayment\(1, "دعم " \+ au\.name, \{ post: pid, toHandle: au\.handle/);
  assert.match(v12, /createPayment\(1, "دعم", \{ toHandle: u\.handle/);
});
