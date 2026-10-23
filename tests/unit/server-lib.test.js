/* Phase 2 — unit tests for server primitives. */
const test = require("node:test"),
  assert = require("node:assert");
const TOTP = require("../../server/lib/totp"),
  WA = require("../../server/lib/webauthn"),
  core = require("../../server/lib/core"),
  { requestId } = require("../../server/lib/log"),
  { secret } = require("../../server/lib/secrets");
test("TOTP matches RFC 6238 reference vectors", () => {
  const s = TOTP.b32encode(Buffer.from("12345678901234567890"));
  assert.equal(TOTP.generate(s, 59e3), "287082");
  assert.equal(TOTP.generate(s, 1111111109e3), "081804");
  assert.equal(TOTP.generate(s, 20000000000e3), "353130");
});
test("TOTP rejects replays and tolerates ±30s drift", () => {
  const s = TOTP.newSecret(),
    t = 1_700_000_000_000;
  const c = TOTP.generate(s, t - 30e3);
  const st = TOTP.verify(s, c, { t });
  assert.ok(st !== null);
  assert.equal(TOTP.verify(s, c, { t, lastStep: st }), null);
});
test("CBOR decoder handles maps, negative ints, byte strings", () => {
  const buf = Buffer.from([0xa2, 0x01, 0x02, 0x20, 0x43, 1, 2, 3]);
  const m = WA.cbor(buf).value;
  assert.equal(m.get(1), 2);
  assert.deepEqual([...m.get(-1)], [1, 2, 3]);
});
test("classifier: hashtags canonicalised, spam and sensitive detection", () => {
  assert.deepEqual(core.Classifier.hashtags("#الذكاء_الاصطناعي #برمجة"), ["ذكاء_اصطناعي", "برمجة"]);
  assert.equal(core.Classifier.spam("اربح 1000 دولار الآن"), true);
  assert.equal(core.Classifier.sensitive("مشهد عنف"), true);
  assert.equal(core.Classifier.lang("hello"), "en");
});
test("rate limiter blocks after the window budget", () => {
  const rl = new core.RateLimiter();
  let ok = 0;
  for (let i = 0; i < 20; i++) if (rl.hit("community", "k")) ok++;
  assert.equal(ok, core.LIMITS.community[0]);
});
test("request ids: accepts safe incoming ids, replaces unsafe ones", () => {
  assert.equal(requestId("abcDEF12-34"), "abcDEF12-34");
  assert.notEqual(requestId("<script>"), "<script>");
});
test("secrets: *_FILE takes precedence", () => {
  const f = require("os").tmpdir() + "/mp-secret";
  require("fs").writeFileSync(f, "from-file\n");
  process.env.MP_TEST = "env";
  process.env.MP_TEST_FILE = f;
  assert.equal(secret("MP_TEST"), "from-file");
  delete process.env.MP_TEST_FILE;
  assert.equal(secret("MP_TEST"), "env");
});
test("password hashing: scrypt, salted, verifiable", () => {
  const h = core.hashPassword("secret123");
  assert.ok(h.startsWith("scrypt$"));
  assert.notEqual(h, core.hashPassword("secret123"));
  assert.ok(core.verifyPassword("secret123", h));
  assert.ok(!core.verifyPassword("nope", h));
});
