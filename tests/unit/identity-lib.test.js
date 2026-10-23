/* Track 2 — unit tests: central policy, look-alike detection, perceptual hash, S3 signing. */
const test = require("node:test"), assert = require("node:assert");
const { createPolicy } = require("../../server/lib/policy"); const IMG = require("../../server/lib/images"); const { s3Sign } = require("../../server/lib/storage");
const rep = require("../../server/services/reputation")({ db: {}, router: { get() {}, post() {}, put() {}, del() {} }, bus: { on() {} }, rl: {}, requireUser: f => f });
const P = createPolicy({ get: async () => null });
const facts = (o = {}) => ({ author: { prefs: {}, private: 0 }, followsAuthor: false, closeFriend: false, communityOk: true, ...o });
test("policy.visible covers public, followers, close friends, private accounts, blocks", () => {
  const post = (v) => ({ author: "a", status: "published", visibility: v });
  assert.equal(P.visible(post("public"), "v", facts()), true);
  assert.equal(P.visible(post("followers"), "v", facts()), false);
  assert.equal(P.visible(post("followers"), "v", facts({ followsAuthor: true })), true);
  assert.equal(P.visible(post("close"), "v", facts({ followsAuthor: true })), false);
  assert.equal(P.visible(post("close"), "v", facts({ closeFriend: true })), true);
  assert.equal(P.visible(post("public"), "v", facts({ author: { private: 1, prefs: {} } })), false, "private account hides public posts from non-followers");
  assert.equal(P.visible(post("public"), "v", facts({ author: { private: 1, prefs: {} }, followsAuthor: true })), true);
  assert.equal(P.visible(post("public"), "v", facts({ author: { prefs: { blocked: ["v"] } } })), false);
  assert.equal(P.visible({ ...post("private"), author: "v" }, "v", facts()), true, "authors always see their own");
});
test("muted words match case-insensitively inside text", () => {
  assert.equal(P.mutedWordHit("Spoiler: the END", ["spoiler"]), true);
  assert.equal(P.mutedWordHit("نقاش هادئ", ["حرق"]), false);
});
test("Arabic name normalisation and look-alike handles", () => {
  assert.equal(rep.normName("أحمد  العتيبي"), rep.normName("احمد_العتيبي"));
  assert.equal(rep.normName("فاطمة"), rep.normName("فاطمه"));
  assert.equal(rep.normHandle("sa1ma"), rep.normHandle("salma"));
  assert.equal(rep.normHandle("rnohamed"), rep.normHandle("mohamed"));
  assert.ok(rep.sim("salma", "salmaa") > 0.8 && rep.sim("salma", "khaled") < 0.4);
});
test("perceptual hash distance", () => {
  assert.equal(IMG.hamming("ffff0000ffff0000", "ffff0000ffff0000"), 0);
  assert.equal(IMG.hamming("0000000000000000", "000000000000000f"), 4);
  assert.equal(IMG.hamming(null, "00"), 64);
  assert.equal(IMG.sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpg"); assert.equal(IMG.sniff(Buffer.from("hello")), null);
});
test("S3 SigV4 headers are well-formed", () => {
  const h = s3Sign({ method: "PUT", url: "https://acc.r2.cloudflarestorage.com/bucket/a.webp", body: "x", region: "auto", accessKey: "AK", secretKey: "SK", contentType: "image/webp" });
  assert.match(h.authorization, /^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(h["x-amz-content-sha256"], "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");
});
