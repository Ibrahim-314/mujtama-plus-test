/* Media Engine: uploads validated by magic bytes, object storage adapter (local disk; S3/R2-compatible
 * adapter plugs into the same interface), metadata in DB, range streaming, and an async video
 * processing pipeline (transcode via ffmpeg when available) that emits VIDEO_PROCESSED. */
const fs = require("node:fs"), path = require("node:path"), { execFile } = require("node:child_process");
const { E, id, now, HttpError } = require("../lib/core");
const IMGMETA = require("../lib/imgmeta");
const SIG = [
  { mime: "image/jpeg", kind: "image", ext: ".jpg", test: b => b[0] === 0xff && b[1] === 0xd8 },
  { mime: "image/png", kind: "image", ext: ".png", test: b => b.slice(0, 4).toString("hex") === "89504e47" },
  { mime: "image/gif", kind: "image", ext: ".gif", test: b => b.slice(0, 3).toString() === "GIF" },
  { mime: "image/webp", kind: "image", ext: ".webp", test: b => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" },
  { mime: "audio/wav", kind: "audio", ext: ".wav", test: b => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WAVE" },
  { mime: "audio/mp4", kind: "audio", ext: ".m4a", test: b => b.slice(4, 8).toString() === "ftyp" && /^(M4A |M4B )/.test(b.slice(8, 12).toString()) },
  { mime: "audio/ogg", kind: "audio", ext: ".ogg", test: b => b.slice(0, 4).toString() === "OggS" },
  { mime: "audio/mpeg", kind: "audio", ext: ".mp3", test: b => b.slice(0, 3).toString() === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { mime: "video/mp4", kind: "video", ext: ".mp4", test: b => b.slice(4, 8).toString() === "ftyp" },
  { mime: "video/webm", kind: "video", ext: ".webm", test: b => b.slice(0, 4).toString("hex") === "1a45dfa3" }
];
const LIMIT = { image: 10 * 1024 * 1024, video: 200 * 1024 * 1024, audio: 60 * 1024 * 1024 };

class LocalStorage {
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  async put(key, buf) { await fs.promises.writeFile(path.join(this.dir, key), buf); }
  path(key) { return path.join(this.dir, path.basename(key)); }
  url(key) { return "/media/" + path.basename(key); }   // behind a CDN in production (MEDIA_CDN_URL)
}

/* Media Engine (Phases 6 & 13–14): uploads validated by magic bytes; all heavy work runs as durable
 * queue jobs (lib/queue.js) that any worker process can pick up:
 *   video  → HLS ladder (clips ≤ 180 s: 240/360/540/720p, 2s segments; long: 360/720(+1080)p, 4s), never upscaled, master playlist
 *            + faststart MP4 fallback + poster + 3 s muted preview + scrub storyboard (sprite + WebVTT)
 *   audio  → AAC/M4A + 64-bar waveform + duration, then optional Arabic transcription
 * Captions (WebVTT or SRT) attach to any video. */
module.exports = (ctx) => {
  const { db, bus, rl, config } = ctx;
  /* Local disk is always the working copy (ffmpeg reads and writes files). With STORAGE_DRIVER=db the
   * database is the durable copy: uploads and processed outputs are written there too, sources are
   * materialised back to disk before processing, and /media/ is served from the database. */
  const disk = new LocalStorage(config.storageDir), durable = ctx.storage && ctx.storage.kind === "db" ? ctx.storage : null;
  const storage = {
    async put(key, buf, mime) { key = path.basename(key); if (durable) await durable.put(key, buf, mime); await disk.put(key, buf); },
    path: (key) => disk.path(key),
    url: (key) => disk.url(key)
  };
  /** make sure a stored file exists on local disk (after a redeploy only the database copy survives) */
  async function ensureLocal(key) {
    const file = disk.path(key);
    if (!fs.existsSync(file) && durable) { const buf = await durable.get(path.basename(key)); if (buf) await disk.put(key, buf); }
    return file;
  }
  /** copy every processing output for `mid` (HLS playlists/segments, MP4, poster, M4A) into the database */
  async function persistOutputs(mid) {
    if (!durable) return;
    for (const f of fs.readdirSync(disk.dir)) {
      if (!(f.startsWith(mid + "_") || f.startsWith(mid + "."))) continue;
      const h = await durable.head(f).catch(() => null), size = fs.statSync(path.join(disk.dir, f)).size;
      if (!h || h.file || h.size !== size) await durable.put(f, fs.readFileSync(path.join(disk.dir, f)));
    }
  }
  /* v2.60 M1: the honest per-file limit = the smaller of the upload limit and the durable store's per-file cap
   * (STORAGE_DRIVER=db: STORAGE_DB_MAX_FILE_MB, 25 MB by default). The quotas themselves are unchanged. */
  const storeMax = () => (durable && durable.maxFile) || Infinity;
  const limitFor = (kind) => Math.min(LIMIT[kind] || LIMIT.image, storeMax());
  const mbLabel = (n) => `${Math.round(n / (1024 * 1024))} ميغابايت`;
  const limits = () => ({ image: limitFor("image"), video: limitFor("video"), audio: limitFor("audio") });
  const asr = require("../lib/asr").createASR();
  const run = (bin, args, opts = {}) => new Promise((res, rej) => execFile(bin, args, { timeout: 20 * 60e3, maxBuffer: 64 << 20, encoding: opts.encoding || "utf8" }, (e, out, err) => e ? rej(new Error((err || e.message).toString().slice(-300))) : res(out)));
  const ff = (args, opts) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);
  async function probe(file) {
    const j = JSON.parse(await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]));
    const v = (j.streams || []).find(s => s.codec_type === "video"), a = (j.streams || []).find(s => s.codec_type === "audio");
    const fr = String(v?.avg_frame_rate && v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v?.r_frame_rate || "").split("/"), fps = fr.length === 2 && +fr[1] ? +fr[0] / +fr[1] : +fr[0] || 0;
    return { duration: Math.round(+j.format?.duration || 0), durationExact: +j.format?.duration || 0, width: v?.width || 0, height: v?.height || 0, hasAudio: !!a, hasVideo: !!v, fps: fps > 0 && fps <= 240 ? fps : 0 };
  }

  async function upload(user, req) {
    if (!rl.hit("upload", user.id)) throw E.rate();
    return ingest(user, req.rawBody, req.query || {});
  }
  /** the one ingest pipeline shared by POST /api/media and chunked complete: magic-byte validation, real size limit,
   *  EXIF sanitize for images, durable store, media row, processing queue for video/audio */
  async function ingest(user, buf, query) {
    if (!buf || buf.length < 12) throw E.bad("ملف فارغ");
    let sig = SIG.find(s => s.test(buf)); if (!sig) throw E.bad("نوع الملف غير مدعوم");
    if (sig.ext === ".webm" && query.kind === "audio") sig = { mime: "audio/webm", kind: "audio", ext: ".webm" };
    const lim = limitFor(sig.kind);
    if (buf.length > lim) throw new HttpError(413, `الملف أكبر من الحد المسموح (${mbLabel(lim)})`, "file_too_large");
    const mid = id("md"), key = mid + sig.ext;
    /* v2.60 M2: images lose EXIF/GPS/XMP/IPTC before they are stored (orientation applied to the pixels first),
     * and keep their real displayed width/height so the client can reserve the aspect ratio before load */
    let dims = null;
    if (sig.kind === "image") { const s = await IMGMETA.sanitize(buf); buf = s.buf; if (s.width && s.height) dims = { width: s.width, height: s.height }; }
    await storage.put(key, buf, sig.mime);
    const status = sig.kind === "image" ? "ready" : "processing";
    await db.run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [mid, user.id, sig.kind, sig.mime, buf.length, key, status, { original: storage.url(key), ...(dims || {}) }, now()]);
    if (sig.kind !== "image") await ctx.queue.enqueue(sig.kind, { mid });
    return { id: mid, kind: sig.kind, url: storage.url(key), status, ...(dims || {}) };
  }

  /* ---- video (v2.60 M4): lean, storage-aware outputs ----
   * The durable store is small (25 MB/file, 300 MB total), so processing never wastes bytes:
   *  · never upscale: a rendition is made only when the source is strictly taller than it (720p only for > 720p sources,
   *    360p only for > 360p); a source ≤ 360p gets no ladder, only a faststart MP4 — a lossless remux when the original is
   *    already H.264/AAC (skipped altogether when the original is an MP4 that already has moov before mdat)
   *  · each rendition is encoded ONCE (libx264 veryfast, CRF 26 @360p / 24 @720p, AAC 96k, yuv420p, keyframe every 2 s,
   *    +faststart) and the HLS playlist is a stream-copy of that encode; only the top MP4 is kept as the fallback
   *  · poster at ~1 s (0 s for clips under 2 s), never larger than the source
   *  · variants.storedBytes = original + every output; a failed or partial run removes its outputs (the original stays) */
  /* v2.70: adaptive ladder. Short/vertical clips (≤ 180 s) get 240p/360p/540p/720p rungs with 2 s segments (fast start,
   * fast ABR switching); long videos keep 360p/720p with 4 s segments, plus 1080p when the source is ≥ 1080p.
   * Rungs are by output height, never upscaled (a rung must be strictly below the source; 1080p is allowed at ≥ 1080).
   * The progressive MP4 fallback stays on the legacy keys ("720p" when made, else "360p") so old clients keep working. */
  const RUNGS = { 240: { h: 240, crf: 28, br: 400 }, 360: { h: 360, crf: 26, br: 700 }, 540: { h: 540, crf: 25, br: 1400 }, 720: { h: 720, crf: 24, br: 2200 }, 1080: { h: 1080, crf: 23, br: 4500 } };
  const VIDEO_LADDER = [RUNGS[360], RUNGS[720]];
  const CLIP_LADDER = [RUNGS[240], RUNGS[360], RUNGS[540], RUNGS[720]];
  const CLIP_MAX_S = 180;
  const isClip = (duration) => duration !== undefined && duration !== null && +duration > 0 && +duration <= CLIP_MAX_S;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  /** the renditions worth making for a source of height `h` and `duration` seconds (never upscale, never equal to the source,
   *  except the 1080p long-video rung which a ≥ 1080p source gets). A ≤ 360p source gets no ladder (a lone 240p rung would only
   *  lower its quality); it keeps the faststart-MP4 path. No duration → the long-video ladder (legacy callers). */
  const ladderFor = (h, duration) => h <= 360 ? [] : isClip(duration) ? CLIP_LADDER.filter(r => h > r.h) : [...VIDEO_LADDER.filter(r => h > r.h), ...(h >= 1080 ? [RUNGS[1080]] : [])];
  /** HLS segment length for a source: 2 s for clips (fast start), 4 s for long videos */
  const segFor = (duration) => isClip(duration) ? 2 : 4;
  /** top-level MP4/MOV box order: true when moov comes before mdat and the file is not fragmented (plays progressively everywhere) */
  function isFaststart(file) {
    let fd; try {
      fd = fs.openSync(file, "r"); const size = fs.fstatSync(fd).size, hdr = Buffer.alloc(16); let off = 0, seenMoov = false;
      while (off + 8 <= size) {
        fs.readSync(fd, hdr, 0, 16, off);
        let len = hdr.readUInt32BE(0); const type = hdr.toString("latin1", 4, 8);
        if (type === "moov") seenMoov = true; else if (type === "mdat" && !seenMoov) return false; else if (type === "moof") return false; // fragmented → normalise
        if (len === 1) len = Number(hdr.readBigUInt64BE(8)); else if (len === 0) return seenMoov;
        if (len < 8) return false; off += len;
      }
      return seenMoov;
    } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  /** every processing output of a video (never the original `mid.ext`) */
  const outputFiles = (mid) => { try { return fs.readdirSync(disk.dir).filter(f => f.startsWith(mid + "_")); } catch { return []; } };
  /** remove partial/failed outputs from disk and the durable store; the uploaded original is never touched */
  async function cleanOutputs(mid) {
    for (const f of outputFiles(mid)) {
      if (durable && durable.del) await durable.del(f).catch(() => { });
      try { fs.rmSync(path.join(disk.dir, f), { recursive: true, force: true }); } catch { }
    }
  }
  const fsize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  /** measured peak/average bitrate (bits/s) of an HLS media playlist from its segment sizes; falls back to the nominal rate */
  function measure(name, nominalKbps) {
    let peak = 0, bytes = 0, secs = 0;
    try {
      const lines = fs.readFileSync(disk.path(name), "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const m = /^#EXTINF:([\d.]+)/.exec(lines[i]); if (!m) continue;
        const d = +m[1], b = fsize(disk.path(lines[i + 1] || "")); if (!(d > 0) || !b) continue;
        peak = Math.max(peak, Math.ceil(b * 8 / d)); bytes += b; secs += d;
      }
    } catch { /* fall back below */ }
    if (!peak || !secs) return { peak: nominalKbps * 1000, avg: nominalKbps * 1000 };
    return { peak, avg: Math.ceil(bytes * 8 / secs) };
  }
  const dropFiles = (mid, suffixes) => { for (const s of suffixes) { try { fs.rmSync(disk.path(mid + s), { force: true }); } catch { } } };
  /** v2.70: 3 s muted animated preview, ≤ 240 px tall (never upscaled), H.264 faststart — for hover/scroll previews */
  async function makePreview(mid, src, info) {
    if (!info.hasVideo) return null;
    const h = even(Math.min(240, info.height || 240)), key = `${mid}_preview.mp4`;
    await ff(["-i", src, "-t", "3", "-map", "0:v:0", "-an", "-vf", `scale=-2:${h}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", storage.path(key)]);
    if (!fsize(storage.path(key))) throw new Error("empty preview");
    return storage.url(key);
  }
  /** v2.70: scrub storyboard — one sprite JPEG (≤ 100 tiles, 160 px wide, 10 per row) + WebVTT cues "start --> end / sprite#xywh=x,y,w,h" */
  const vttTime = (t) => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`; };
  async function makeStoryboard(mid, src, info) {
    const dur = +info.durationExact || info.duration || 0; if (!info.hasVideo || !(dur > 0) || !info.width || !info.height) return null;
    const every = Math.max(1, Math.ceil(dur / 100)), count = Math.min(100, Math.max(1, Math.ceil(dur / every))), cols = Math.min(10, count), rows = Math.ceil(count / cols);
    const tw = 160, th = even(tw * info.height / info.width), sprite = `${mid}_storyboard.jpg`, vtt = `${mid}_storyboard.vtt`;
    await ff(["-i", src, "-map", "0:v:0", "-an", "-vf", `fps=1/${every},scale=${tw}:${th},tile=${cols}x${rows}`, "-frames:v", "1", "-q:v", "5", storage.path(sprite)]);
    if (!fsize(storage.path(sprite))) throw new Error("empty sprite");
    let out = "WEBVTT\n";
    for (let i = 0; i < count; i++) out += `\n${vttTime(i * every)} --> ${vttTime(Math.min(dur, (i + 1) * every))}\n${sprite}#xywh=${(i % cols) * tw},${Math.floor(i / cols) * th},${tw},${th}\n`;
    await storage.put(vtt, Buffer.from(out), "text/vtt"); // relative sprite URL: resolves next to the VTT (same /media/ dir or CDN)
    return { vtt: storage.url(vtt), sprite: storage.url(sprite), interval: every, tile: { w: tw, h: th }, cols, count };
  }
  const skipMp4WhenHls = () => process.env.MEDIA_SKIP_MP4_WHEN_HLS !== "0";
  const trimSrc = (mid) => storage.path(`${mid}_trimsrc.mp4`);
  /** {start,end} in seconds, rounded to 0.1 s; null when absent/invalid or shorter than 1 s */
  function validTrim(t) {
    if (!t || typeof t !== "object") return null;
    const s = Math.round(+t.start * 10) / 10, e = Math.round(+t.end * 10) / 10;
    if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e - s < 1 || e > 6 * 3600) return null;
    return { start: s, end: e };
  }
  /** v2.82: the creator trims before publishing. A ready (or failed) video re-processes from the original; one still processing
   *  picks the new range up when its current run ends. {start:0,end:duration} or null clears the trim. */
  async function setTrim(user, mid, b) {
    const m = await db.get("SELECT * FROM media WHERE id=$1 AND owner=$2", [mid, user.id]); if (!m) throw E.nf();
    if (m.kind !== "video") throw E.bad("القص متاح للفيديو فقط");
    // a video already live in a published post is never re-cut under its viewers (trim happens before publishing)
    if (await db.get("SELECT 1 x FROM posts WHERE author=$1 AND status='published' AND CAST(data AS TEXT) LIKE $2 LIMIT 1", [user.id, "%" + mid + "%"]).catch(() => null)) throw new HttpError(409, "هذا الفيديو منشور بالفعل ولا يمكن قصه الآن", "already_published");
    let t = b && b.start != null ? validTrim(b) : null;
    if (b && b.start != null && !t) throw E.bad("مدة المقطع بعد القص يجب أن تكون ثانية على الأقل");
    const dur = +(m.variants?.trim ? 0 : m.variants?.duration) || 0;
    if (t && dur && t.start <= 0.05 && t.end >= dur - 0.05) t = null; // the whole video = no trim
    if (t && dur && t.start >= dur) throw E.bad("بداية القص بعد نهاية الفيديو");
    const before = validTrim(m.variants?.trim);
    if (JSON.stringify(before) === JSON.stringify(t)) return { id: m.id, status: m.status, trim: t };
    if (!rl.hit("upload", user.id)) throw E.rate();
    const v = { ...(m.variants || {}) }; if (t) v.trim = t; else delete v.trim; delete v.error;
    if (m.status === "processing") { await db.run("UPDATE media SET variants=$1 WHERE id=$2", [v, mid]); return { id: m.id, status: "processing", trim: t }; }
    await db.run("UPDATE media SET status='processing', variants=$1 WHERE id=$2", [v, mid]);
    await ctx.queue.enqueue("video", { mid });
    return { id: m.id, status: "processing", trim: t };
  }
  async function processVideo({ mid }) {
    const m = await db.get("SELECT * FROM media WHERE id=$1", [mid]); if (!m) return;
    await cleanOutputs(mid); // a retry starts clean: nothing from an earlier attempt is left behind or double-counted
    try {
      /* v2.82 «قص قبل النشر»: a trim {start,end} (seconds) set by the creator cuts a working copy first; every rung, the poster and
       * the extras come from that range. The uploaded original is never modified (a new trim re-cuts from it). */
      const orig = await ensureLocal(m.storage_key), trim = validTrim(m.variants?.trim);
      let src = orig;
      if (trim) {
        const oi = await probe(orig), cut = trimSrc(mid);
        await ff(["-ss", String(trim.start), "-to", String(Math.min(trim.end, oi.durationExact || trim.end)), "-i", orig, "-map", "0:v:0", ...(oi.hasAudio ? ["-map", "0:a:0"] : []), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", ...(oi.hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : ["-an"]), "-movflags", "+faststart", cut]);
        if (!fsize(cut)) throw new Error("empty trim");
        src = cut;
      }
      const info = await probe(src);
      const variants = { ...(m.variants || {}), original: storage.url(m.storage_key), duration: info.duration, width: info.width || undefined, height: info.height || undefined };
      if (trim) variants.trim = trim; else delete variants.trim;
      for (const k of ["error", "hls", "master", "240p", "360p", "540p", "720p", "1080p", "poster", "posterWebp", "preview", "storyboard", "storedBytes", "outputBytes", "mp4Policy"]) delete variants[k];
      const audio = info.hasAudio ? ["-c:a", "aac", "-b:a", "96k", "-ac", "2"] : ["-an"];
      const seg = segFor(info.durationExact || info.duration), gop = info.fps ? Math.max(1, Math.round(info.fps * seg)) : 0;
      /* keyframe exactly every `seg` seconds (fixed GOP, no scene-cut keyframes) so HLS segments cut cleanly at `seg` */
      const kf = ["-force_key_frames", `expr:gte(t,n_forced*${seg})`, "-sc_threshold", "0", ...(gop ? ["-g", String(gop), "-keyint_min", String(gop)] : [])];
      const x264 = (crf) => ["-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p", ...kf];
      const enc = (h, crf, out) => ff(["-i", src, "-map", "0:v:0", ...(info.hasAudio ? ["-map", "0:a:0"] : []), "-vf", `scale=-2:${h}`, ...x264(crf), ...audio, "-movflags", "+faststart", out]);
      const ladder = ladderFor(info.height, info.durationExact || info.duration);
      if (ladder.length) {
        variants.hls = {};
        /* one decode, every rung encoded in the same ffmpeg run (split → scale), CPU-lean on a small box */
        const split = ladder.length > 1 ? `[0:v:0]split=${ladder.length}${ladder.map((_, i) => `[s${i}]`).join("")};` : "";
        const graph = split + ladder.map((r, i) => `${ladder.length > 1 ? `[s${i}]` : "[0:v:0]"}scale=-2:${r.h}[v${i}]`).join(";");
        await ff(["-i", src, "-filter_complex", graph, ...ladder.flatMap((r, i) => ["-map", `[v${i}]`, ...(info.hasAudio ? ["-map", "0:a:0"] : []), ...x264(r.crf), ...audio, "-movflags", "+faststart", storage.path(`${mid}_${r.h}.mp4`)])]);
        const rows = [];
        for (const r of ladder) {
          const mp4 = storage.path(`${mid}_${r.h}.mp4`);
          await ff(["-i", mp4, "-c", "copy", "-bsf:v", "h264_mp4toannexb", "-f", "hls", "-hls_time", String(seg), "-hls_playlist_type", "vod", "-hls_segment_filename", storage.path(`${mid}_${r.h}_%03d.ts`), storage.path(`${mid}_${r.h}.m3u8`)]);
          variants.hls[r.h + "p"] = storage.url(`${mid}_${r.h}.m3u8`);
          rows.push({ r, ...measure(`${mid}_${r.h}.m3u8`, r.br) });
        }
        // lowest rung first (fast start); BANDWIDTH = measured peak segment bitrate, AVERAGE-BANDWIDTH = measured mean
        fs.writeFileSync(storage.path(`${mid}_master.m3u8`), "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n" + rows.map(({ r, peak, avg }) => `#EXT-X-STREAM-INF:BANDWIDTH=${peak},AVERAGE-BANDWIDTH=${avg},RESOLUTION=${even(r.h * (info.width / Math.max(1, info.height)))}x${r.h}\n${mid}_${r.h}.m3u8`).join("\n") + "\n");
        variants.master = storage.url(`${mid}_master.m3u8`);
        // progressive MP4 fallback on the legacy keys: 720p when made, else 360p, else the top rung (backward compatible).
        // v2.82: with MEDIA_SKIP_MP4_WHEN_HLS (on unless set to 0) a NEW upload keeps only the 360p MP4 beside HLS — HLS already
        // carries 720p, the MP4 is the rare fallback (and the data-saver source). Media processed before keeps its files.
        const lean = skipMp4WhenHls() && ladder.some(r => r.h === 360);
        const keep = (lean && ladder.find(r => r.h === 360)) || ladder.find(r => r.h === 720) || ladder.find(r => r.h === 360) || ladder[ladder.length - 1];
        if (lean) variants.mp4Policy = "360";
        for (const r of ladder) if (r.h !== keep.h) { try { fs.unlinkSync(storage.path(`${mid}_${r.h}.mp4`)); } catch { } } // HLS covers the other rungs
        variants[keep.h + "p"] = storage.url(`${mid}_${keep.h}.mp4`);
      } else {
        // a ≤ 360p source: no ladder (it would only upscale or duplicate the source) — just make sure it plays progressively
        const pr = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", src]).then(JSON.parse).catch(() => ({}));
        const vc = (pr.streams || []).find(s => s.codec_type === "video")?.codec_name, ac = (pr.streams || []).find(s => s.codec_type === "audio")?.codec_name;
        const copyable = vc === "h264" && (!info.hasAudio || ac === "aac");
        if (!(copyable && m.mime === "video/mp4" && isFaststart(src))) {
          const out = storage.path(`${mid}_360.mp4`);
          if (copyable) await ff(["-i", src, "-map", "0:v:0", ...(info.hasAudio ? ["-map", "0:a:0"] : []), "-c", "copy", "-movflags", "+faststart", out]);
          else await enc(even(info.height || 360), 26, out);
          variants["360p"] = storage.url(`${mid}_360.mp4`);
        }
      }
      const at = (+info.durationExact || info.duration || 0) >= 2 ? "1" : "0";
      await ff(["-ss", at, "-i", src, "-frames:v", "1", "-vf", `scale=-2:${even(Math.min(720, info.height || 720))}`, "-q:v", "4", storage.path(`${mid}_poster.jpg`)]);
      variants.poster = storage.url(`${mid}_poster.jpg`);
      // v2.82: a WebP copy of the poster (≈30–40% smaller); the JPEG stays the fallback. Best-effort.
      await ff(["-i", storage.path(`${mid}_poster.jpg`), "-c:v", "libwebp", "-quality", "72", storage.path(`${mid}_poster.webp`)]).then(() => { if (fsize(storage.path(`${mid}_poster.webp`))) variants.posterWebp = storage.url(`${mid}_poster.webp`); }).catch(e => { dropFiles(mid, ["_poster.webp"]); ctx.log?.warn?.(`media ${mid}: webp poster skipped: ${e.message}`); });
      // v2.70: extras are best-effort — a failure is logged and skipped, never fails the job
      const pv = await makePreview(mid, src, info).catch(e => { dropFiles(mid, ["_preview.mp4"]); ctx.log?.warn?.(`media ${mid}: preview skipped: ${e.message}`); return null; });
      if (pv) variants.preview = pv;
      const sb = await makeStoryboard(mid, src, info).catch(e => { dropFiles(mid, ["_storyboard.jpg", "_storyboard.vtt"]); ctx.log?.warn?.(`media ${mid}: storyboard skipped: ${e.message}`); return null; });
      if (sb) variants.storyboard = sb;
      if (trim) dropFiles(mid, ["_trimsrc.mp4"]); // the working cut is not an output
      variants.outputBytes = outputFiles(mid).reduce((n, f) => n + fsize(path.join(disk.dir, f)), 0);
      variants.storedBytes = fsize(src) + variants.outputBytes;
      await persistOutputs(mid);
      // a trim changed while this job ran: process again from the new range instead of publishing the old cut
      const latest = await db.get("SELECT variants FROM media WHERE id=$1", [mid]);
      if (JSON.stringify(validTrim(latest?.variants?.trim)) !== JSON.stringify(trim)) return processVideo({ mid });
      await db.run("UPDATE media SET status='ready', variants=$1 WHERE id=$2", [variants, mid]);
    } catch (e) {
      dropFiles(mid, ["_trimsrc.mp4"]);
      await cleanOutputs(mid); // never leave half a ladder (or half-copied blobs) eating the storage quota
      throw e;
    }
    bus.emit("MEDIA_READY", { media: mid });
  }

  /* ---- audio: AAC + waveform, then transcription ---- */
  async function processAudio({ mid }) {
    const m = await db.get("SELECT * FROM media WHERE id=$1", [mid]); if (!m) return;
    const src = await ensureLocal(m.storage_key), info = await probe(src);
    await ff(["-i", src, "-vn", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", storage.path(`${mid}.m4a`)]);
    const pcm = await ff(["-i", src, "-ac", "1", "-ar", "4000", "-f", "s16le", "-"], { encoding: "buffer" });
    const samples = pcm.length >> 1, bars = 64, per = Math.max(1, Math.floor(samples / bars)), peaks = [];
    for (let b = 0; b < bars; b++) { let mx = 0; for (let i = b * per; i < Math.min(samples, (b + 1) * per); i++) { const v = Math.abs(pcm.readInt16LE(i * 2)); if (v > mx) mx = v; } peaks.push(mx); }
    const top = Math.max(1, ...peaks);
    const variants = { ...(m.variants || {}), original: storage.url(m.storage_key), m4a: storage.url(`${mid}.m4a`), duration: info.duration, waveform: peaks.map(p => Math.round(p / top * 100) / 100), transcript: asr.available ? "pending" : "unavailable" };
    await persistOutputs(mid);
    await db.run("UPDATE media SET status='ready', variants=$1 WHERE id=$2", [variants, mid]);
    if (asr.available) await ctx.queue.enqueue("transcribe", { mid });
    bus.emit("MEDIA_READY", { media: mid });
  }
  async function transcribe({ mid }) {
    const m = await db.get("SELECT * FROM media WHERE id=$1", [mid]); if (!m) return;
    const t = await asr.transcribe(await ensureLocal(`${mid}.m4a`), { lang: "ar" });
    await db.run("UPDATE media SET variants=$1 WHERE id=$2", [{ ...m.variants, transcript: t?.text || "", segments: t?.segments || [] }, mid]);
    for (const p of await db.all("SELECT id, data FROM posts WHERE author=$1 AND type='audio'", [m.owner])) if (p.data?.audio?.mediaId === mid) await db.run("UPDATE posts SET data=$1 WHERE id=$2", [{ ...p.data, audio: { ...p.data.audio, transcript: t?.text || "" } }, p.id]);
  }
  ctx.queue.on("video", processVideo); ctx.queue.on("audio", processAudio); ctx.queue.on("transcribe", transcribe);

  /* ---- v2.60 M1: a processing job that gave up is a visible state, never an endless «processing» ----
   * media.status → 'failed' (+ variants.error), and every post still waiting on it gets data.<video|audio>.status='failed'
   * (the post itself stays 'processing', so it remains visible to its author only). The author can retry. */
  async function postsWaitingOn(mid) { return (await db.all("SELECT id, data FROM posts WHERE status='processing'")).filter(p => p.data?.video?.mediaId === mid || p.data?.audio?.mediaId === mid); }
  async function markFailed(mid, err) {
    const m = await db.get("SELECT * FROM media WHERE id=$1", [mid]); if (!m || m.status === "ready") return;
    const reason = /storage_full|ممتلئة/.test(String(err || "")) ? "storage_full" : /file_too_large|أكبر من الحد/.test(String(err || "")) ? "too_large" : "processing";
    await db.run("UPDATE media SET status='failed', variants=$1 WHERE id=$2", [{ ...(m.variants || {}), error: reason }, mid]);
    for (const p of await postsWaitingOn(mid)) { const f = p.data.audio?.mediaId === mid ? "audio" : "video"; await db.run("UPDATE posts SET data=$1 WHERE id=$2", [{ ...p.data, [f]: { ...p.data[f], status: "failed", error: reason } }, p.id]); }
    ctx.cache?.del?.("feed:");
    bus.emit("MEDIA_FAILED", { media: mid, owner: m.owner, reason });
  }
  ctx.queue.onFailed?.("video", (payload, e) => markFailed(payload?.mid, e?.message));
  ctx.queue.onFailed?.("audio", (payload, e) => markFailed(payload?.mid, e?.message));
  async function retry(user, mid) {
    const m = await db.get("SELECT * FROM media WHERE id=$1 AND owner=$2", [mid, user.id]); if (!m) throw E.nf();
    if (m.kind !== "video" && m.kind !== "audio") throw E.bad("لا يحتاج هذا الملف إلى تجهيز");
    if (m.status === "ready") { for (const p of await postsWaitingOn(mid)) await finishMediaPost(p.id); return { id: m.id, kind: m.kind, status: "ready" }; }
    if (m.status !== "failed") return { id: m.id, kind: m.kind, status: m.status };
    if (!rl.hit("upload", user.id)) throw E.rate();
    const v = { ...(m.variants || {}) }; delete v.error;
    await db.run("UPDATE media SET status='processing', variants=$1 WHERE id=$2", [v, mid]);
    for (const p of await postsWaitingOn(mid)) { const f = p.data.audio?.mediaId === mid ? "audio" : "video"; const d = { ...p.data[f], status: "processing" }; delete d.error; await db.run("UPDATE posts SET data=$1 WHERE id=$2", [{ ...p.data, [f]: d }, p.id]); }
    await ctx.queue.enqueue(m.kind, { mid });
    return { id: m.id, kind: m.kind, status: "processing" };
  }
  /* jobs that already gave up before this release: surface them as failed once at start (non-destructive) */
  setTimeout(() => (async () => {
    const rows = await db.all("SELECT j.payload FROM media_jobs j WHERE j.status='failed' AND j.kind IN ('video','audio')");
    for (const r of rows) { const pl = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload; const m = pl?.mid && await db.get("SELECT status FROM media WHERE id=$1", [pl.mid]); if (m && m.status === "processing" && !(await db.get("SELECT 1 x FROM media_jobs WHERE status IN ('queued','running') AND payload LIKE $1", ["%" + pl.mid + "%"]).catch(() => null))) await markFailed(pl.mid, "processing"); }
  })().catch(() => { }), 50).unref?.();

  /* ---- captions: SRT or WebVTT → WebVTT ---- */
  function toVtt(text) {
    let t = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!t.startsWith("WEBVTT")) t = "WEBVTT\n\n" + t.replace(/^\d+\n(?=\d{2}:\d{2})/gm, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    if (!/\d{2}:\d{2}(:\d{2})?\.\d{3}\s+-->\s+/.test(t)) throw E.bad("ملف الترجمة غير صالح");
    return t.replace(/<(?!\/?(b|i|u|c|v|lang)\b)[^>]*>/gi, "") + "\n";
  }
  async function addCaptions(user, mid, lang, raw) {
    const m = await db.get("SELECT * FROM media WHERE id=$1 AND owner=$2 AND kind='video'", [mid, user.id]); if (!m) throw E.nf();
    if (!raw?.length || raw.length > 512 * 1024) throw E.bad("ملف الترجمة كبير أو فارغ");
    lang = /^[a-z]{2}$/.test(lang || "") ? lang : "ar";
    const key = `${mid}_cc_${lang}.vtt`; await storage.put(key, Buffer.from(toVtt(raw.toString("utf8"))), "text/vtt");
    const fresh = await db.get("SELECT variants FROM media WHERE id=$1", [mid]);
    const captions = [...((fresh.variants || {}).captions || []).filter(c => c.lang !== lang), { lang, label: lang === "ar" ? "العربية" : lang === "en" ? "English" : lang, url: storage.url(key) }];
    await db.run("UPDATE media SET variants=$1 WHERE id=$2", [{ ...fresh.variants, captions }, mid]);
    for (const p of await db.all("SELECT id, data FROM posts WHERE author=$1 AND type IN ('video','story')", [user.id])) if (p.data?.video?.mediaId === mid) await db.run("UPDATE posts SET data=$1 WHERE id=$2", [{ ...p.data, video: { ...p.data.video, variants: { ...(p.data.video.variants || {}), captions } } }, p.id]);
    return captions;
  }

  /* media posts (video, audio, video stories) publish once their media is processed */
  async function finishMediaPost(postId) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [postId]); if (!p || p.status !== "processing") return;
    const field = p.data.audio ? "audio" : "video"; const v = { ...(p.data[field] || {}) };
    if (v.mediaId) { const m = await db.get("SELECT * FROM media WHERE id=$1 AND owner=$2", [v.mediaId, p.author]); if (!m || m.status !== "ready") return; v.variants = m.variants; v.duration = m.variants.duration || v.duration; if (field === "audio") { v.waveform = m.variants.waveform; v.transcript = m.variants.transcript; } }
    v.status = "ready"; delete v.error; if (field === "video" && v.variants) { if (v.variants.width) v.width = v.variants.width; if (v.variants.height) v.height = v.variants.height; } // v2.60 M1: no invented duration — unknown stays unknown
    await db.run("UPDATE posts SET status='published', data=$1, created_at=$2 WHERE id=$3", [{ ...p.data, [field]: v }, now(), postId]);
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [postId]);
    bus.emit("VIDEO_PROCESSED", { post: postId, author: p.author }); bus.emit("POST_PUBLISHED", { post: row, ...(p.publish_at ? { scheduled: true } : {}) }); ctx.cache.del("feed:"); // v2.80: a scheduled media post reaches here from publishDue
  }
  const finishVideoPost = finishMediaPost;
  bus.on("VIDEO_UPLOADED", e => { const mid = e.post.data?.video?.mediaId || e.post.data?.audio?.mediaId; if (mid) finishMediaPost(e.post.id); else setTimeout(() => finishMediaPost(e.post.id), config.fakeVideoMs); });
  bus.on("MEDIA_READY", async e => { for (const p of await db.all("SELECT id, data FROM posts WHERE status='processing'")) if (p.data?.video?.mediaId === e.media || p.data?.audio?.mediaId === e.media) await finishMediaPost(p.id); });

  const MIME = require("../lib/http").MIME;
  const headersFor = (ext, mime, priv = false) => priv
    ? { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Vary": "Cookie" } // phase 38: paid media is never cached by a CDN/proxy
    : { "Content-Type": mime, "Accept-Ranges": "bytes", "Cache-Control": ext === ".vtt" ? "public, max-age=300" : "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" };
  /** parse a Range header (first range only). Returns null when there is no usable header (→ full 200), {unsat:true} for 416.
   *  bytes=a-b → a..min(b,size-1) · bytes=a- → a..a+1MiB (the disk path's long-standing cap) · bytes=-n → the LAST n bytes (v2.60 M1). */
  const parseRange = (range, size) => {
    const m = /^bytes=\s*(\d*)\s*-\s*(\d*)\s*(?:,.*)?$/i.exec(String(range || "").trim()); if (!m || (m[1] === "" && m[2] === "")) return null;
    if (m[1] === "") { const n = +m[2]; if (!n || !size) return { unsat: true }; return { start: Math.max(0, size - n), end: size - 1 }; }
    const start = +m[1]; if (start >= size) return { unsat: true };
    if (m[2] === "") return { start, end: Math.min(start + 2 ** 20, size - 1) };
    const e = +m[2]; if (e < start) return null; // malformed: ignore the header (RFC 9110 §14.2)
    return { start, end: Math.min(e, size - 1) };
  };
  function serveFile(req, res, file, priv = false) {
    const ext = path.extname(file), mime = MIME[ext] || "application/octet-stream", size = fs.statSync(file).size;
    const r = req.headers.range ? parseRange(req.headers.range, size) : null, base = headersFor(ext, mime, priv), head = req.method === "HEAD";
    if (r && r.unsat) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return true; }
    if (r) {
      const { start, end } = r;
      res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      if (head) res.end(); else fs.createReadStream(file, { start, end }).pipe(res);
    } else { res.writeHead(200, { ...base, "Content-Length": size }); if (head) res.end(); else fs.createReadStream(file).pipe(res); }
    return true;
  }
  /** @param {{ private?: boolean }} [o] private: entitlement-checked paid media (no shared caching) */
  async function serve(req, res, name, o = {}) {
    const priv = !!o.private;
    if (!durable) { const file = storage.path(name); if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false; return serveFile(req, res, file, priv); } // v2.60 M3: never a directory (tmp/)
    const key = path.basename(name); if (!durable.validKey(key)) return false;
    const h = await durable.head(key); if (!h) return false;
    if (h.file) return serveFile(req, res, h.file, priv); // over the database caps: served from disk without copying
    const ext = path.extname(key), mime = MIME[ext] || h.mime || "application/octet-stream", size = h.size, base = headersFor(ext, mime, priv);
    const r = req.headers.range ? parseRange(req.headers.range, size) : null, head = req.method === "HEAD";
    if (r && r.unsat) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); res.end(); return true; }
    if (r) {
      const { start, end } = r;
      if (head) { res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 }); res.end(); return true; }
      const chunk = await durable.read(key, start, end); if (!chunk) return false;
      res.writeHead(206, { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": chunk.length });
      res.end(chunk);
    } else if (head) { res.writeHead(200, { ...base, "Content-Length": size }); res.end(); } // HEAD: headers only, the blob is not read
    else { const buf = await durable.get(key); if (!buf) return false; res.writeHead(200, { ...base, "Content-Length": buf.length }); res.end(buf); }
    return true;
  }

  /* v2.60 M5: media attached to posts of PRIVATE / invite-only communities is members-only.
   * /media/<md_id…> (original, HLS playlists/segments, MP4 ladder, poster, captions) → "public" | "private" | "deny".
   * Allowed: site admin, the uploader, and active members of any such community (owner/admin/moderator/member/muted;
   * never pending/banned). Deny answers 404 (existence is not leaked). Fail closed: one private reference makes it private.
   * Lookup result (which private communities reference the id) is cached briefly so a video's many Range requests
   * do not each scan posts. */
  const MID = /^\/?(?:media\/)?(md_[a-z0-9]{4,40})/i, gateCache = new Map(), GATE_TTL = 10e3;
  async function privateRefs(mid) {
    const hit = gateCache.get(mid); if (hit && hit.until > Date.now()) return hit.v;
    const m = await db.get("SELECT id, owner FROM media WHERE id=$1", [mid]);
    const v = !m ? null : { owner: m.owner, cids: (await db.all("SELECT DISTINCT p.community AS cid FROM posts p JOIN communities c ON c.id=p.community WHERE p.author=$1 AND c.type<>'public' AND CAST(p.data AS TEXT) LIKE $2", [m.owner, "%" + mid + "%"])).map(r => r.cid) };
    if (gateCache.size > 5000) gateCache.clear();
    gateCache.set(mid, { v, until: Date.now() + GATE_TTL });
    return v;
  }
  for (const ev of ["POST_CREATED", "POST_UPDATED"]) bus.on(ev, () => gateCache.clear()); // a new / edited post may make a media id private: never serve it from a stale "public" entry
  async function communityGate(req, name) {
    const mm = MID.exec(String(name || "")); if (!mm) return "public";
    const ref = await privateRefs(mm[1]); if (!ref || !ref.cids.length) return "public";
    const user = req.user || (await ctx.services.users.resolve(req).catch(() => null));
    if (!user) return "deny";
    if (user.role === "admin" || user.id === ref.owner) return "private";
    const ph = ref.cids.map((_, i) => "$" + (i + 2)).join(",");
    const rows = await db.all(`SELECT role FROM memberships WHERE user_id=$1 AND community IN (${ph})`, [user.id, ...ref.cids]);
    if (rows.some(r => r.role && !["pending", "banned"].includes(r.role))) return "private";
    const own = await db.get(`SELECT 1 AS x FROM communities WHERE owner=$1 AND id IN (${ph}) LIMIT 1`, [user.id, ...ref.cids]);
    return own ? "private" : "deny";
  }

  /* ---- v2.60 M3: resumable chunked uploads (alongside POST /api/media, which is unchanged) ----
   * init → PUT chunks (any order, idempotent) → GET status (resume) → complete (assemble → ingest()).
   * Owner-only (v2.70: someone else's session → 403, unknown/expired → 404), auth + CSRF like every media route, real per-kind limit enforced at init. */
  const CHUNK = Math.max(64 * 1024, Math.round(+(process.env.MEDIA_CHUNK_MB || 5) * 1024 * 1024));
  const chunks = require("../lib/chunked-upload").createChunkStore({ dir: path.join(config.storageDir, "tmp", "uploads"), chunkSize: CHUNK, ttlMs: Math.max(60e3, +(process.env.MEDIA_UPLOAD_TTL_H || 24) * 3600e3), log: ctx.log });
  /* v2.70: every session is also a row in upload_sessions (migration 072) — the durable owner/expiry registry.
   * The bytes stay temp files on disk; a row whose files are gone (redeploy) or whose expires_at passed reads as 404. */
  const expAt = (t = Date.now()) => new Date(t + chunks.ttlMs).toISOString();
  const sess = {
    insert: (m) => db.run("INSERT INTO upload_sessions(id,owner,filename,mime,kind,size,chunk_size,total_chunks,received,status,created_at,updated_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,$11,$12)",
      [m.id, m.owner, m.filename, m.mime, m.kind, m.size, m.chunkSize, m.total, JSON.stringify(m.received), new Date(m.createdAt).toISOString(), new Date(m.updatedAt).toISOString(), expAt(m.updatedAt)]),
    touch: (m) => db.run("UPDATE upload_sessions SET received=$1, updated_at=$2, expires_at=$3 WHERE id=$4", [JSON.stringify(m.received), new Date(m.updatedAt).toISOString(), expAt(m.updatedAt), m.id]),
    done: (m, media) => db.run("UPDATE upload_sessions SET status='done', media_id=$1, updated_at=$2, expires_at=$3 WHERE id=$4", [media.id, now(), expAt(), m.id]),
    get: (uid) => db.get("SELECT id, owner, status, expires_at FROM upload_sessions WHERE id=$1", [String(uid || "")]),
    del: (uid) => db.run("DELETE FROM upload_sessions WHERE id=$1", [uid])
  };
  /** expired sessions: temp chunk files + rows; plus orphan dirs (chunks.sweep) */
  async function sweepUploads(t = Date.now()) {
    let n = 0;
    try { n += chunks.sweep(t); } catch { /* best effort */ }
    const rows = await db.all("SELECT id FROM upload_sessions WHERE expires_at < $1", [new Date(t).toISOString()]).catch(() => []);
    for (const r of rows) { chunks.drop(r.id); await sess.del(r.id).catch(() => { }); n++; }
    return n;
  }
  /** owner-scoped session lookup: unknown/expired → 404, someone else's → 403 */
  async function session(user, uid) {
    const row = await sess.get(uid);
    if (!row) { const legacy = chunks.get(uid, user.id); if (legacy) return legacy; throw E.nf(); } // a pre-072 (disk-only) session still resumes
    if (row.owner !== user.id) throw E.forbid();
    const m = chunks.get(uid, user.id);
    if (!m || (row.status === "open" && new Date(row.expires_at).getTime() < Date.now())) { chunks.drop(uid); await sess.del(uid).catch(() => { }); throw E.nf(); }
    return m;
  }
  sweepUploads().catch(() => { });
  const sweeper = setInterval(() => { sweepUploads().catch(() => { }); }, 30 * 60e3); sweeper.unref?.();
  const MIME_KIND = Object.fromEntries(SIG.map(s => [s.mime, s.kind])); MIME_KIND["audio/webm"] = "audio"; MIME_KIND["image/jpg"] = "image";
  const completing = new Set();
  async function chunkInit(user, b) {
    const mime = String(b.mime || "").toLowerCase().split(";")[0].trim(), kind = MIME_KIND[mime];
    if (!kind) throw E.bad("نوع الملف غير مدعوم");
    const size = Number(b.size); if (!Number.isSafeInteger(size) || size < 12) throw E.bad("حجم الملف غير صالح");
    const lim = limitFor(kind);
    if (size > lim) throw new HttpError(413, `الملف أكبر من الحد المسموح (${mbLabel(lim)})`, "file_too_large");
    if (durable && durable.usage) { const u = await durable.usage().catch(() => null); if (u && u.total + size > u.maxTotal) throw new HttpError(413, "مساحة التخزين ممتلئة مؤقتاً", "storage_full"); }
    if (!rl.hit("upload", user.id)) throw E.rate();
    const filename = [...String(b.filename || "file")].filter(c => c.charCodeAt(0) >= 32 && c !== "/" && c !== "\\").join("").slice(0, 200) || "file";
    const m = chunks.init({ owner: user.id, filename, mime, kind, size });
    if (!m) throw new HttpError(429, "لديك رفعات غير مكتملة كثيرة، أكملها أو انتظر", "too_many_uploads");
    try { await sess.insert(m); } catch (e) { chunks.drop(m.id); throw e; }
    return chunks.view(m);
  }
  async function chunkPut(user, uid, index, buf) {
    const m = await session(user, uid);
    if (m.done) throw new HttpError(409, "اكتمل هذا الرفع", "upload_completed");
    const i = Number(index); if (!/^\d+$/.test(String(index ?? "")) || i >= m.total) throw E.bad("رقم الجزء غير صالح");
    const want = chunks.expectedLen(m, i);
    if (!buf || buf.length > m.chunkSize) throw new HttpError(413, "الجزء أكبر من الحجم المسموح", "chunk_too_large");
    if (buf.length !== want) throw E.bad(`حجم الجزء غير صحيح (المتوقع ${want} بايت)`);
    chunks.putChunk(m, i, buf);
    await sess.touch(m).catch(() => { }); // a legacy (disk-only) session has no row: nothing to update
    return { uploadId: m.id, index: i, received: m.received.length, totalChunks: m.total };
  }
  async function chunkComplete(user, uid) {
    const m = await session(user, uid);
    if (m.done) return m.done; // a retried complete returns the same media
    const miss = chunks.missing(m);
    if (miss.length) { const e = new HttpError(409, "أجزاء ناقصة، أكمل رفعها ثم أعد المحاولة", "missing_chunks"); e.details = { missing: miss }; throw e; }
    if (completing.has(m.id)) throw new HttpError(409, "جارٍ تجميع هذا الرفع", "upload_in_progress");
    completing.add(m.id);
    try {
      const buf = chunks.assemble(m);
      const media = await ingest(user, buf, { kind: m.kind === "audio" ? "audio" : undefined });
      chunks.finish(m, media);
      await sess.done(m, media).catch(() => { });
      return media;
    } finally { completing.delete(m.id); }
  }

  ctx.router.post("/api/media/uploads", ctx.requireUser(async (req) => ({ upload: await chunkInit(req.user, req.body || {}) })));
  ctx.router.get("/api/media/uploads/:id", ctx.requireUser(async (req) => ({ upload: chunks.view(await session(req.user, req.params.id)) })));
  ctx.router.put("/api/media/uploads/:id/chunk", ctx.requireUser(async (req) => ({ chunk: await chunkPut(req.user, req.params.id, req.query.index, req.rawBody) })), { raw: true, rawLimit: CHUNK + 1 });
  ctx.router.post("/api/media/uploads/:id/complete", ctx.requireUser(async (req) => ({ media: await chunkComplete(req.user, req.params.id) })));
  ctx.router.post("/api/media", ctx.requireUser(async (req) => ({ media: await upload(req.user, req) })), { raw: true });
  ctx.router.get("/api/media/limits", ctx.requireUser(async () => ({ limits: limits() })));
  ctx.router.get("/api/media/:id", ctx.requireUser(async (req) => { const m = await db.get("SELECT id, kind, status, variants FROM media WHERE id=$1", [req.params.id]); if (!m) throw E.nf(); await ctx.services.paid?.assertMedia(req.user, m.id); return { media: m }; }));
  ctx.router.post("/api/media/:id/trim", ctx.requireUser(async (req) => ({ media: await setTrim(req.user, req.params.id, req.body || {}) })));
  ctx.router.post("/api/media/:id/retry", ctx.requireUser(async (req) => ({ media: await retry(req.user, req.params.id) })));
  ctx.router.post("/api/media/:id/captions", ctx.requireUser(async (req) => ({ captions: await addCaptions(req.user, req.params.id, req.query.lang, req.rawBody) })), { raw: true });
  /* ---- v2.82 admin storage panel «التخزين»: totals by kind + a safe orphan cleanup (dry run → confirm) ----
   * Orphans are only:
   *   files    — a stored file (disk or database copy) whose md_ id has no media row, older than 7 days
   *   unused   — a video/audio media row older than 7 days, not processing, whose id appears in NO text/JSON column of any
   *              other table (posts, drafts, courses, messages, …); its original + outputs go, the row is kept as status 'purged'
   * Images are never auto-cleaned (avatars, covers and attachments reference them by URL in too many places). */
  const ORPHAN_AGE = 7 * 864e5, MID_RE = /^(md_[a-z0-9]+)(?:[._])/i;
  const kindOfFile = (f) => /_poster\.(jpg|webp)$|_storyboard\.(jpg|vtt)$/.test(f) ? "thumbs" : /\.(m3u8|ts)$/.test(f) ? "hls" : /_(240|360|540|720|1080)\.mp4$|_preview\.mp4$/.test(f) ? "mp4" : /_cc_[a-z]{2}\.vtt$/.test(f) ? "captions" : /_trimsrc\.mp4$/.test(f) ? "temp" : "originals";
  async function storageFiles() {
    const map = new Map(); // name → {size, at}
    try { for (const f of fs.readdirSync(disk.dir)) { const st = fs.statSync(path.join(disk.dir, f)); if (st.isFile()) map.set(f, { size: st.size, at: st.mtimeMs, disk: true }); } } catch { }
    if (durable) for (const r of await db.all("SELECT key, size, created_at FROM blobs").catch(() => [])) { const o = map.get(r.key) || { size: Number(r.size), at: new Date(r.created_at).getTime() }; o.db = true; map.set(r.key, o); }
    return map;
  }
  let textCols = null;
  async function referenceColumns() {
    if (textCols) return textCols;
    const skip = new Set(["media", "blobs", "media_jobs", "upload_sessions", "client_errors", "audit_log", "audit_logs", "schema_migrations"]);
    let rows = [];
    if (db.dialect === "postgres") rows = await db.all("SELECT table_name t, column_name c FROM information_schema.columns WHERE table_schema = current_schema() AND data_type IN ('text','json','jsonb','character varying')");
    else for (const t of await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")) for (const c of await db.all(`PRAGMA table_info("${t.name}")`)) if (/TEXT|JSON|CHAR|^$/i.test(c.type || "")) rows.push({ t: t.name, c: c.name });
    textCols = rows.filter(r => !skip.has(r.t) && /^[a-z0-9_]+$/i.test(r.t) && /^[a-z0-9_]+$/i.test(r.c));
    setTimeout(() => { textCols = null; }, 10 * 60e3).unref?.();
    return textCols;
  }
  /** ids among `mids` that some other table mentions (batched LIKE per column) */
  async function referenced(mids) {
    const hit = new Set(); if (!mids.length) return hit;
    const cast = db.dialect === "postgres" ? "::text" : "";
    for (const { t, c } of await referenceColumns()) {
      const left = mids.filter(m => !hit.has(m)); if (!left.length) break;
      for (let i = 0; i < left.length; i += 40) {
        const part = left.slice(i, i + 40);
        const rows = await db.all(`SELECT "${c}"${cast} v FROM "${t}" WHERE ${part.map((_, j) => `"${c}"${cast} LIKE $${j + 1}`).join(" OR ")} LIMIT 500`, part.map(m => `%${m}%`)).catch(() => []);
        for (const r of rows) for (const m of part) if (String(r.v || "").includes(m)) hit.add(m);
      }
    }
    return hit;
  }
  async function storageReport({ orphans = false } = {}) {
    const files = await storageFiles(), byKind = {}, t = Date.now();
    for (const [f, o] of files) { const k = kindOfFile(f); byKind[k] ||= { files: 0, bytes: 0 }; byKind[k].files++; byKind[k].bytes += o.size; }
    const total = [...files.values()].reduce((n, o) => n + o.size, 0);
    const counts = await db.all("SELECT kind, status, COUNT(*) n FROM media GROUP BY kind, status").catch(() => []);
    const out = { total, files: files.size, byKind, media: counts.map(r => ({ kind: r.kind, status: r.status, n: Number(r.n) })), db: durable ? await durable.usage().catch(() => null) : null, mp4Policy: skipMp4WhenHls() ? "360" : "720" };
    if (!orphans) return out;
    const ids = new Set((await db.all("SELECT id FROM media").catch(() => [])).map(r => r.id));
    const loose = [];
    for (const [f, o] of files) { const m = MID_RE.exec(f); if (m && !ids.has(m[1]) && t - o.at > ORPHAN_AGE) loose.push({ name: f, bytes: o.size }); }
    const cand = (await db.all("SELECT id, kind, status, storage_key, created_at FROM media WHERE kind IN ('video','audio') AND status IN ('ready','failed') AND created_at < $1 ORDER BY created_at LIMIT 300", [new Date(t - ORPHAN_AGE).toISOString()]).catch(() => []));
    const used = await referenced(cand.map(r => r.id));
    const unused = cand.filter(r => !used.has(r.id)).map(r => { let bytes = 0; for (const [f, o] of files) if (f.startsWith(r.id + "_") || f.startsWith(r.id + ".")) bytes += o.size; return { id: r.id, kind: r.kind, status: r.status, createdAt: r.created_at, bytes }; });
    out.orphans = { files: loose.slice(0, 500), unused, bytes: loose.reduce((n, x) => n + x.bytes, 0) + unused.reduce((n, x) => n + x.bytes, 0) };
    return out;
  }
  async function dropStored(name) { if (durable && durable.del) await durable.del(name).catch(() => { }); try { fs.rmSync(disk.path(name), { force: true }); } catch { } }
  /** deletes only what a fresh dry run still reports AND the admin confirmed by name/id */
  async function cleanOrphans(user, b) {
    const want = { files: new Set(Array.isArray(b.files) ? b.files.map(String) : []), unused: new Set(Array.isArray(b.unused) ? b.unused.map(String) : []) };
    if (!want.files.size && !want.unused.size) throw E.bad("لا شيء محدد للحذف");
    const r = await storageReport({ orphans: true }); let files = 0, media = 0, bytes = 0;
    for (const f of r.orphans.files) if (want.files.has(f.name)) { await dropStored(f.name); files++; bytes += f.bytes; }
    for (const u of r.orphans.unused) if (want.unused.has(u.id)) {
      const m = await db.get("SELECT * FROM media WHERE id=$1", [u.id]); if (!m) continue;
      await cleanOutputs(u.id); await dropStored(path.basename(m.storage_key));
      await db.run("UPDATE media SET status='purged', variants=$1 WHERE id=$2", [{ purgedAt: now(), purgedBy: user.id, kind: m.kind }, u.id]);
      media++; bytes += u.bytes;
    }
    ctx.audit?.("storage_orphans_cleaned", "media", `${files} files, ${media} media, ${bytes} bytes`, user.id);
    return { files, media, bytes };
  }
  const adminOnly = (fn) => ctx.requireUser(async (req) => { if (req.user.role !== "admin") throw E.forbid(); return fn(req); });
  ctx.router.get("/api/admin/storage", adminOnly(async (req) => ({ storage: await storageReport({ orphans: req.query.orphans === "1" }) })));
  ctx.router.post("/api/admin/storage/cleanup", adminOnly(async (req) => ({ cleaned: await cleanOrphans(req.user, req.body || {}) })));
  ctx.router.get("/api/admin/queue", ctx.requireUser(async (req) => { if (req.user.role !== "admin") throw E.forbid(); return { stats: await ctx.queue.stats(), failed: await db.all("SELECT id, kind, attempts, error, created_at FROM media_jobs WHERE status='failed' ORDER BY created_at DESC LIMIT 20"), asr: asr.available }; }));
  return { storageReport, cleanOrphans, setTrim, validTrim, serve, communityGate, parseRange, limits, ingest, chunks, sweepUploads, markFailed, retry, processVideo, ladderFor, segFor, isFaststart, cleanOutputs, processAudio, finishVideoPost, finishMediaPost, toVtt, storage, ensureLocal, persistOutputs };
};
