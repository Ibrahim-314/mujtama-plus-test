/* v2.70 video infrastructure (STORAGE_DRIVER=db like production, real ffmpeg on tiny lavfi clips):
 *  · clips (≤ 180 s): 240/360/540/720p HLS rungs, never upscaled, 2 s segments (#EXT-X-TARGETDURATION:2), keyframe every 2 s
 *  · long videos keep 4 s segments; 1080p only for ≥ 1080p sources (ladder rule)
 *  · master lists every rung lowest first with measured BANDWIDTH + correct RESOLUTION; legacy MP4 fallback keys kept
 *  · variants.preview (3 s muted ≤ 240p faststart H.264) and variants.storyboard {vtt, sprite} — durable (db store)
 *  · preview/storyboard failures never fail the job; outputs are removed by the partial-output cleanup */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), { execFileSync } = require("node:child_process");
process.env.LOG_SILENT = "1";
process.env.MEDIA_MAX_ATTEMPTS = "1";
const { createApp } = require("../server");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mp-v270-"));
let app, base, cookie = "";
const req = async (method, p, body, raw) => {
  const r = await fetch(base + p, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": raw ? "application/octet-stream" : "application/json", Cookie: cookie, Origin: base }, body: raw || (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
};
const until = async (fn, ms = 90000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 200)); } return null; };
function clip(name, w, h, secs, audio = true, rate = 30) {
  const f = path.join(tmp, name);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=${rate}:duration=${secs}`, ...(audio ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${secs}`] : []),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p", ...(audio ? ["-c:a", "aac", "-b:a", "64k", "-shortest"] : []), f]);
  return fs.readFileSync(f);
}
const fetchBuf = async (u) => { const r = await fetch(base + u, { headers: { Cookie: cookie } }); assert.equal(r.status, 200, u); return Buffer.from(await r.arrayBuffer()); };
const boxes = (buf) => { const out = []; let o = 0; while (o + 8 <= buf.length) { let len = buf.readUInt32BE(o); out.push(buf.toString("latin1", o + 4, o + 8)); if (len === 1) len = Number(buf.readBigUInt64BE(o + 8)); if (len < 8) break; o += len; } return out; };
const faststart = (buf) => { const b = boxes(buf); return b.includes("moov") && b.includes("mdat") && b.indexOf("moov") < b.indexOf("mdat"); };
const probe = (buf, name) => { const f = path.join(tmp, name); fs.writeFileSync(f, buf); return JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", f]).toString()); };
async function upAndWait(buf) {
  const up = await req("POST", "/api/media", null, buf); assert.equal(up.status, 200, up.error);
  const m = await until(async () => { const r = await req("GET", "/api/media/" + up.media.id); return r.media && r.media.status !== "processing" ? r.media : null; });
  assert.ok(m, "processing finished"); return m;
}
async function checkPlaylist(url, target) {
  const pl = (await fetchBuf(url)).toString();
  assert.match(pl, /^#EXTM3U/); assert.match(pl, /#EXT-X-ENDLIST/); assert.match(pl, new RegExp(`#EXT-X-TARGETDURATION:${target}\\n`), pl);
  const durs = [...pl.matchAll(/#EXTINF:([\d.]+)/g)].map(m => +m[1]);
  assert.ok(durs.length >= 2, "several segments"); for (const d of durs) assert.ok(d <= target + 0.05, `segment ${d}s ≤ ${target}s`);
  const seg = pl.split("\n").find(l => l.endsWith(".ts")); assert.equal((await fetchBuf("/media/" + seg))[0], 0x47, "MPEG-TS segment");
  return pl;
}
async function checkExtras(v, srcW, srcH) {
  assert.ok(v.preview, "variants.preview");
  const pv = await fetchBuf(v.preview); assert.ok(faststart(pv), "preview faststart");
  const pj = probe(pv, "pv-" + srcW + ".mp4"), ps = pj.streams.find(s => s.codec_type === "video");
  assert.equal(ps.codec_name, "h264"); assert.equal(ps.height, Math.min(240, srcH)); assert.ok(!pj.streams.some(s => s.codec_type === "audio"), "muted");
  assert.ok(+pj.format.duration <= 3.1 && +pj.format.duration >= 2.5, "≈3 s preview");
  assert.ok(v.storyboard && v.storyboard.vtt && v.storyboard.sprite, "variants.storyboard {vtt, sprite}");
  const sprite = await fetchBuf(v.storyboard.sprite); assert.equal(sprite.subarray(0, 2).toString("hex"), "ffd8", "jpeg sprite");
  const vtt = (await fetchBuf(v.storyboard.vtt)).toString();
  assert.match(vtt, /^WEBVTT\n/);
  const cues = [...vtt.matchAll(/(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\n(\S+)#xywh=(\d+),(\d+),(\d+),(\d+)/g)];
  assert.ok(cues.length >= 4 && cues.length <= 100, `${cues.length} cues`);
  const th = Math.max(2, Math.round(160 * srcH / srcW / 2) * 2);
  cues.forEach((c, i) => { assert.equal(c[3], path.basename(v.storyboard.sprite)); assert.equal(+c[6], 160); assert.equal(+c[7], th); assert.equal(+c[4], (i % 10) * 160); });
  const sj = probe(sprite, "sb-" + srcW + ".jpg").streams[0]; assert.equal(sj.width, Math.min(10, cues.length) * 160);
  for (const k of [v.preview, v.storyboard.vtt, v.storyboard.sprite]) assert.ok(await app.ctx.storage.has(path.basename(k)), k + " durable (db store)");
}
test.before(async () => {
  app = await createApp({ databaseUrl: "sqlite:" + path.join(tmp, "db.sqlite"), storageDir: path.join(tmp, "st"), storageDriver: "db", seedDemo: false, queuePollMs: 100 });
  await new Promise(r => app.server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.server.address().port;
  await req("POST", "/api/auth/register", { name: "مهندس معالجة الفيديو", handle: "v270lad", password: "secret123" });
});
test.after(() => app.close());

test("ladder rule: clips get 240/360/540/720 (never upscaled), long videos 360/720 (+1080 at ≥1080), segment length", () => {
  const M = app.ctx.services.media, L = (h, d) => M.ladderFor(h, d).map(r => r.h);
  assert.deepEqual(L(1280, 5), [240, 360, 540, 720]); assert.deepEqual(L(720, 5), [240, 360, 540]); assert.deepEqual(L(480, 30), [240, 360]); assert.deepEqual(L(360, 30), [], "≤ 360p: no ladder (faststart MP4 path)"); assert.deepEqual(L(240, 30), []);
  assert.deepEqual(L(1920, 180), [240, 360, 540, 720], "no 1080 rung for clips");
  assert.deepEqual(L(1080, 600), [360, 720, 1080]); assert.deepEqual(L(720, 600), [360]); assert.deepEqual(L(2160, 181), [360, 720, 1080]); assert.deepEqual(L(1000, 600), [360, 720]);
  assert.deepEqual(L(1080), [360, 720, 1080], "no duration → long-video ladder");
  assert.equal(M.segFor(5), 2); assert.equal(M.segFor(180), 2); assert.equal(M.segFor(181), 4); assert.equal(M.segFor(0), 4);
});

test("vertical 720x1280 clip: 240/360/540/720 HLS with 2 s segments, master lowest first, preview + storyboard", async () => {
  const src = clip("v.mp4", 720, 1280, 5);
  const m = await upAndWait(src); assert.equal(m.status, "ready", JSON.stringify(m.variants));
  const v = m.variants;
  assert.deepEqual(Object.keys(v.hls).sort((a, b) => parseInt(a) - parseInt(b)), ["240p", "360p", "540p", "720p"]);
  for (const k of Object.keys(v.hls)) await checkPlaylist(v.hls[k], 2);
  const master = (await fetchBuf(v.master)).toString(); assert.match(master, /^#EXTM3U/);
  const inf = [...master.matchAll(/#EXT-X-STREAM-INF:BANDWIDTH=(\d+),AVERAGE-BANDWIDTH=(\d+),RESOLUTION=(\d+)x(\d+)\n(\S+)/g)];
  assert.deepEqual(inf.map(r => `${r[3]}x${r[4]}`), ["136x240", "202x360", "304x540", "406x720"]);
  inf.forEach((r, i) => { assert.ok(+r[1] >= +r[2] && +r[2] > 0, "peak ≥ average > 0"); if (i) assert.ok(+r[1] > 0); assert.equal(r[5], path.basename(v.hls[r[4] + "p"])); });
  // v2.82 MEDIA_SKIP_MP4_WHEN_HLS (default on): the progressive fallback is the 360p MP4 only; 720p lives in HLS
  assert.ok(v["360p"], "360p MP4 fallback kept"); assert.equal(v["720p"], undefined, "no duplicate 720p MP4"); assert.equal(v["540p"], undefined); assert.equal(v.mp4Policy, "360");
  const mp4 = await fetchBuf(v["360p"]); assert.ok(faststart(mp4));
  assert.ok(v.posterWebp && (await fetchBuf(v.posterWebp)).subarray(8, 12).toString() === "WEBP", "webp poster");
  // keyframes every 2 s (30 fps → GOP 60)
  const kfs = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", path.join(tmp, "st", path.basename(v["360p"]))]).toString().trim().split("\n").filter(l => /,K/.test(l)).map(l => +l.split(",")[0]);
  assert.deepEqual(kfs.map(t => Math.round(t)), [0, 2, 4], "keyframe every 2 s");
  await checkExtras(v, 720, 1280);
  assert.equal(v.storedBytes, src.length + v.outputBytes);
});

test("horizontal 1280x720 clip: 240/360/540 (no rung equal to source), legacy 360p fallback, preview + storyboard", async () => {
  const src = clip("h.mp4", 1280, 720, 5);
  const m = await upAndWait(src); assert.equal(m.status, "ready", JSON.stringify(m.variants));
  const v = m.variants;
  assert.deepEqual(Object.keys(v.hls).sort((a, b) => parseInt(a) - parseInt(b)), ["240p", "360p", "540p"]);
  for (const k of Object.keys(v.hls)) await checkPlaylist(v.hls[k], 2);
  const master = (await fetchBuf(v.master)).toString();
  assert.deepEqual([...master.matchAll(/RESOLUTION=(\d+x\d+)/g)].map(r => r[1]), ["426x240", "640x360", "960x540"]);
  assert.ok(v["360p"]); assert.equal(v["720p"], undefined);
  await checkExtras(v, 1280, 720);
});

test("≤ 360p clip: no ladder (legacy faststart path) but still gets preview + storyboard", async () => {
  const m = await upAndWait(clip("s.mp4", 640, 360, 4)); assert.equal(m.status, "ready");
  assert.equal(m.variants.master, undefined); assert.ok(m.variants["360p"]);
  await checkExtras(m.variants, 640, 360);
});

test("long video (> 180 s) keeps 4 s segments", async () => {
  const src = clip("long.mp4", 240, 400, 182, false, 10);
  const m = await upAndWait(src); assert.equal(m.status, "ready", JSON.stringify(m.variants));
  assert.deepEqual(Object.keys(m.variants.hls), ["360p"]);
  await checkPlaylist(m.variants.hls["360p"], 4);
  assert.ok(m.variants.storyboard); const vtt = (await fetchBuf(m.variants.storyboard.vtt)).toString();
  assert.equal(m.variants.storyboard.interval, 2); assert.equal((vtt.match(/-->/g) || []).length, 91, "≤ 100 tiles");
});

test("preview/storyboard failure does not fail the job; cleanup removes extras (disk + durable)", async () => {
  const src = clip("f.mp4", 640, 480, 3);
  const m = await upAndWait(src); assert.equal(m.status, "ready"); const mid = m.id, dir = path.join(tmp, "st");
  assert.ok(m.variants.preview && m.variants.storyboard);
  const storage = app.ctx.services.media.storage, realPut = storage.put;
  storage.put = async function (key, ...a) { if (String(key).endsWith("_storyboard.vtt")) throw new Error("boom (test)"); return realPut.call(this, key, ...a); };
  try { await app.ctx.services.media.processVideo({ mid }); } finally { storage.put = realPut; }
  const v = (await req("GET", "/api/media/" + mid)).media.variants;
  assert.ok(v.master && v.poster && v.preview, "job still ready with ladder + preview"); assert.equal(v.storyboard, undefined, "storyboard skipped");
  assert.ok(!fs.existsSync(path.join(dir, mid + "_storyboard.jpg")), "partial sprite removed");
  assert.equal(v.storedBytes, src.length + v.outputBytes);
  await app.ctx.services.media.cleanOutputs(mid);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.startsWith(mid + "_")), []);
  for (const f of [`${mid}_preview.mp4`, `${mid}_storyboard.jpg`, `${mid}_storyboard.vtt`]) assert.equal(await app.ctx.storage.has(f), false, f);
});
