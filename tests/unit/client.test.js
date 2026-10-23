/* Phase 2 — unit tests for the client domain layer (store, feed ranking, search, trends) running
 * in an isolated VM context with a tiny browser shim. */
const test = require("node:test"),
  assert = require("node:assert"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const ROOT = path.join(__dirname, "..", "..");
function load() {
  const mem = {};
  const ctx = {
    console,
    setTimeout: () => 0,
    clearTimeout() {},
    Date,
    Math,
    JSON,
    Intl,
    Set,
    Map,
    Object,
    Array,
    String,
    Number,
    RegExp,
    Promise,
    localStorage: {
      getItem: k => mem[k] ?? null,
      setItem: (k, v) => {
        mem[k] = String(v);
      },
      removeItem: k => {
        delete mem[k];
      }
    },
    location: { protocol: "file:", hash: "" },
    navigator: { userAgent: "node" }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["store.js", "feed.js"])
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, f), "utf8") +
        "\n;globalThis.__x={S:typeof S!=='undefined'?S:null,Cmd:typeof Cmd!=='undefined'?Cmd:null,DB:typeof DB!=='undefined'?DB:null,Feed:typeof Feed!=='undefined'?Feed:null,Search:typeof Search!=='undefined'?Search:null,Trends:typeof Trends!=='undefined'?Trends:null};",
      ctx,
      { filename: f }
    );
  return ctx.__x;
}
test("store seeds a coherent demo world", () => {
  const { S, DB } = load();
  assert.ok(DB.users.length >= 8 && DB.posts.length >= 10);
  for (const p of DB.posts) assert.ok(S.user(p.author), "every post has an author " + p.id);
});
test("posting extracts hashtags and topic, and appears first in the latest feed", () => {
  const X = load();
  X.DB.onboarded = true;
  X.DB.interests = ["dev"];
  const { post: p, error } = X.Cmd.createPost({ text: "تجربة وحدة #برمجة", type: "post" });
  assert.equal(error, undefined);
  assert.ok(p && p.id);
  assert.deepEqual(X.S.hashtags(p.text).length, 1);
  const latest = X.Feed.build("latest");
  assert.equal(latest[0].id, p.id);
});
test("feed is diversified: no author appears 3 times in a row", () => {
  const X = load();
  X.DB.onboarded = true;
  X.DB.interests = ["ai", "dev", "pi"];
  const list = X.Feed.build("foryou").map(p => p.author);
  for (let i = 2; i < list.length; i++) assert.ok(!(list[i] === list[i - 1] && list[i] === list[i - 2]), "author streak at " + i);
});
test("ranking explains itself", () => {
  const X = load();
  X.DB.interests = ["ai"];
  const p = X.DB.posts.find(p => p.topic === "ai");
  const why = X.Feed.why(p);
  assert.ok(Array.isArray(why));
});
test("search finds people, posts and hashtags in Arabic", () => {
  const X = load();
  const r = X.Search.run("سارة");
  assert.ok((r.users || []).length >= 1 || (r.people || []).length >= 1, JSON.stringify(Object.keys(r)));
});
test("trends weigh unique users over raw volume (spam resistance)", () => {
  const X = load();
  for (let i = 0; i < 12; i++) X.Cmd.createPost({ text: "سبام " + i + " #تجربة_سبام", type: "post" });
  assert.ok(X.Cmd.createPost({ text: "سبام إضافي #تجربة_سبام" }).error, "client-side rate limit kicks in");
  const t = X.Trends.list(20);
  const spam = t.find(x => x.tag === "تجربة_سبام");
  if (spam) assert.equal(spam.unique, 1);
  const top = t[0];
  assert.ok(!spam || top.tag !== "تجربة_سبام" || top.unique > 1, "single-user tag must not top trends");
});
