/* v2.73 — video infrastructure: the source picker (video/player/sources.js, window.MPVideoSources) is pure and decides
 * the order a <video> tries its sources and whether hls.js drives the HLS master. Same rules as the v2.70 player. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../../video/player/sources.js");

const V = { master: "/m/a/master.m3u8", "720p": "/m/a/720.mp4", "360p": "/m/a/360.mp4", original: "/m/a/orig.mov" };
const env = (types, mediaSource) => ({ canPlayType: (t) => (types.includes(t) ? "maybe" : ""), mediaSource });
const HLS = "application/vnd.apple.mpegurl";

test("Safari / iOS (native HLS): master first, then the MP4 chain; no hls.js", () => {
  const r = S.pick(V, env([HLS, "video/mp4"], true));
  assert.deepEqual(r.srcs, [V.master, V["720p"], V["360p"], V.original]);
  assert.equal(r.useHlsJs, false);
});

test("Chrome / Android (MediaSource, no native HLS): hls.js drives the master, the element keeps the MP4 chain", () => {
  const r = S.pick(V, env(["video/mp4"], true));
  assert.equal(r.useHlsJs, true);
  assert.deepEqual(r.srcs, [V["720p"], V["360p"], V.original]);
  assert.deepEqual(r.all, [V.master, V["720p"], V["360p"], V.original]);
});

test("no MediaSource and no native HLS: MP4 chain only", () => {
  const r = S.pick(V, env(["video/mp4"], false));
  assert.equal(r.useHlsJs, false);
  assert.deepEqual(r.srcs, [V["720p"], V["360p"], V.original]);
});

test("nothing claims support: still try the original; duplicates are dropped", () => {
  const r = S.pick({ "720p": "/x.mp4", "360p": "/x.mp4", original: "/x.webm" }, env([], false));
  assert.deepEqual(r.all, ["/x.mp4", "/x.webm"]);
  assert.deepEqual(r.srcs, ["/x.webm"]);
});

test("master only on Chrome: hls.js, and the element has nothing else to fall back to", () => {
  const r = S.pick({ master: V.master }, env(["video/mp4"], true));
  assert.equal(r.useHlsJs, true);
  assert.deepEqual(r.srcs, []);
});

test("typeOf maps extensions (query strings allowed)", () => {
  assert.equal(S.typeOf("/a.m3u8?t=1"), HLS);
  assert.equal(S.typeOf("/a.webm"), "video/webm");
  assert.equal(S.typeOf("/a.MOV".toLowerCase()), "video/mp4");
  assert.equal(S.typeOf("/a.bin"), "");
});

test("layout: every clips feature is its own file in the clips chunk, core first and boot last", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  const js = [...html.matchAll(/<script src="(video\/clips\/[\w.-]+\.js)" data-chunk="clips"><\/script>/g)].map((m) => m[1]);
  assert.equal(js[0], "video/clips/core.js");
  assert.equal(js.at(-1), "video/clips/boot.js");
  for (const f of js) {
    assert.ok(fs.existsSync(path.join(__dirname, "../..", f)), f + " exists");
    if (f !== "video/clips/core.js") assert.ok(!/view\.innerHTML\s*=\s*`<div class="shorts"/.test(fs.readFileSync(path.join(__dirname, "../..", f), "utf8")), f + " does not render the feed itself");
  }
  const order = [...html.matchAll(/<script src="([\w./-]+\.js)"><\/script>/g)].map((m) => m[1]);
  const at = (f) => order.indexOf(f);
  assert.ok(at("video/player/sources.js") >= 0 && at("video/player/sources.js") < at("video/player/player.js"), "sources before player");
  assert.ok(at("video/player/player.js") < at("video/player/resume.js") && at("video/player/resume.js") < at("content-ui.js"), "player, resume, then content-ui");
});

/* v2.82 data saver */
{
  const S = require("../../video/player/sources.js");
  const assert = require("node:assert");
  const env = (saver) => ({ canPlayType: (t) => (t === "video/mp4" ? "probably" : ""), mediaSource: true, saver });
  const v = { master: "/m/a/master.m3u8", "720p": "/m/a/720.mp4", "360p": "/m/a/360.mp4", original: "/m/a/o.mp4" };
  const on = S.pick(v, env(true));
  assert.deepStrictEqual(on.srcs, ["/m/a/360.mp4", "/m/a/o.mp4"]); assert.strictEqual(on.useHlsJs, false);
  const off = S.pick(v, env(false));
  assert.strictEqual(off.useHlsJs, true); assert.strictEqual(off.srcs[0], "/m/a/720.mp4");
  const no360 = S.pick({ master: v.master, original: v.original }, env(true));
  assert.strictEqual(no360.useHlsJs, true); // no 360p: normal chain
  console.log("ok v2.82 data saver sources");
}
