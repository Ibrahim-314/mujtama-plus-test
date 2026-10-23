/* Track 5 — unit tests: Arabic normalisation & tokens, spelling distance, ranking model (meaningful
 * engagement, affinity decay, diversity caps), trend manipulation detection, extractive summaries and
 * the anti-hallucination verifier, gazetteer, Meilisearch adapter and SMTP client against fakes. */
const test = require("node:test"), assert = require("node:assert"), http = require("node:http"), net = require("node:net");
const AR = require("../../server/lib/arabic");
const ranking = require("../../server/services/ranking");
const trends = require("../../server/services/trends");
const { extractive, verify } = require("../../server/lib/llm");
const geo = require("../../server/lib/geo");
const { createMeili } = require("../../server/lib/meili");
const { createMailer, buildMessage } = require("../../server/lib/mailer");

test("Arabic normalisation: hamza forms, tashkeel, tatweel, taa marbuta, alef maqsura, digits", () => {
  assert.equal(AR.normalize("أَحْمَد"), "احمد");
  assert.equal(AR.normalize("إسلام آمن ٱلقرآن"), "اسلام امن القران");
  assert.equal(AR.normalize("مؤتمر رئيس سماء"), "موتمر رييس سما");
  assert.equal(AR.normalize("مدرسة"), "مدرسه");
  assert.equal(AR.normalize("مستشفى"), "مستشفي");
  assert.equal(AR.normalize("جمـــيل"), "جميل");
  assert.equal(AR.normalize("عام ٢٠٢٦ و۱۲"), "عام 2026 و12");
  assert.equal(AR.normalize("Hello, WORLD!"), "hello world");
  assert.equal(AR.normalize("ﻻ"), "لا", "presentation-form ligature");
  assert.equal(AR.normalize(""), ""); assert.equal(AR.normalize(null), "");
});
test("tokens: stop-words dropped, definite article stemmed only when a word remains", () => {
  assert.deepEqual(AR.tokens("المطورين في المدينة"), ["مطورين", "مدينه"]);
  assert.deepEqual(AR.tokens("والمكتبة بالقلم للطلاب"), ["مكتبه", "قلم", "طلاب"]);
  assert.deepEqual(AR.tokens("الم"), ["الم"], "short words keep their letters");
  assert.deepEqual(AR.tokens("#ذكاء_اصطناعي @user"), ["ذكا_اصطناعي", "user"], "standalone hamza dropped on both sides of the index");
  assert.equal(AR.indexText("المكتبة العامة"), " مكتبه عامه ");
  assert.equal(AR.detectLang("مرحبا hello"), "ar"); assert.equal(AR.detectLang("hello world"), "en"); assert.equal(AR.detectLang("123"), null);
  assert.deepEqual(AR.sentences("جملة أولى. جملة ثانية؟ ثالثة، مع فاصلة!"), ["جملة أولى.", "جملة ثانية؟", "ثالثة، مع فاصلة!"]);
});
test("edit distance with early exit (spelling correction)", () => {
  assert.equal(AR.distance("هاسكيل", "هاسكل"), 1);
  assert.equal(AR.distance("برمجه", "برمجه"), 0);
  assert.equal(AR.distance("kitten", "sitting"), 3);
  assert.equal(AR.distance("abc", "abcdefgh", 2), 3, "exits once over the max");
});

test("ranking model: meaningful engagement ignores raw clicks/views and rewards discussion", () => {
  assert.equal(ranking.meaningful({}), 0);
  assert.ok(ranking.meaningful({ comments: 2, uniqueCommenters: 2 }) > ranking.meaningful({ reactions: 6 }));
  assert.equal(ranking.meaningful({ views: 10000, clicks: 500 }), 0, "views and clicks are not engagement");
  assert.ok(ranking.SIGNAL_W.comment / ranking.SIGNAL_W.click >= 15);
});
test("ranking model: affinity decays with a 14-day half-life", () => {
  const now = Date.now();
  const fresh = ranking.affinity([{ author: "u1", topic: "ai", kind: "comment", at: new Date(now).toISOString() }], now);
  const old = ranking.affinity([{ author: "u1", topic: "ai", kind: "comment", at: new Date(now - 14 * 864e5).toISOString() }], now);
  assert.ok(Math.abs(fresh.author.u1 - Math.log2(1 + 3)) < 1e-9); assert.ok(Math.abs(old.author.u1 - Math.log2(1 + 1.5)) < 1e-9);
  const clicks = ranking.affinity(Array.from({ length: 5 }, () => ({ author: "u2", kind: "click", at: new Date(now).toISOString() })), now);
  assert.ok(clicks.author.u2 < fresh.author.u1, "five clicks < one comment");
});
test("ranking model: scorePost factors, feedback and hard filters", () => {
  const p = { id: "p1", author: "a", topic: "ai", type: "post", created_at: new Date().toISOString() };
  const base = { following: new Set(["a"]), comms: new Set(), interests: ["ai"], followTopics: new Set(), followTags: new Set(), tagsOf: { p1: ["x"] }, stats: {}, aff: { author: {}, topic: {} }, fb: {}, followerCounts: { a: 10 }, muted: {}, settings: {}, names: { a: "سارة" } };
  const s = ranking.scorePost(p, base);
  assert.deepEqual(s.factors.map(f => f.code).sort(), ["following", "interest", "recency"]);
  assert.match(s.factors.find(f => f.code === "following").label, /سارة/);
  assert.ok(ranking.scorePost(p, { ...base, fb: { "author:a": -2 } }).score < s.score);
  assert.ok(ranking.scorePost(p, { ...base, fb: { "post:p1": -1 } }).score < -50, "less on a post hides it");
  assert.ok(ranking.scorePost(p, { ...base, muted: { hashtags: ["x"] } }).score < -50, "muted hashtag");
  assert.ok(ranking.scorePost(p, { ...base, settings: { contentTypes: { post: false } } }).score < -50, "hidden content type");
  const tagFollow = ranking.scorePost(p, { ...base, followTags: new Set(["x"]) });
  assert.ok(tagFollow.factors.some(f => f.code === "follow_tag" && f.control.target === "x"));
});
test("diversity: author and topic caps per window, no back-to-back author", () => {
  const list = [...Array.from({ length: 6 }, (_, i) => ({ id: "a" + i, author: "A", topic: "t1" })), ...Array.from({ length: 6 }, (_, i) => ({ id: "o" + i, author: "U" + i, topic: i < 3 ? "t1" : "t" + i }))];
  const out = ranking.diversify(list);
  assert.equal(out.length, list.length, "nothing dropped");
  // while alternatives exist the caps hold; once the pool holds only capped items they are relaxed, never dropped
  assert.equal(out.slice(0, 8).filter(x => x.author === "A").length, 2, out.map(x => x.id).join());
  assert.ok(out.slice(0, 6).filter(x => x.topic === "t1").length <= 3, "topic cap");
  for (let i = 1; i < 8; i++) assert.notEqual(out[i].author === "A" && out[i - 1].author === "A", true, "no A-A while alternatives exist");
  assert.deepEqual(ranking.diversify([]), []);
});

test("trend manipulation: dominant account, new-account swarm above baseline, copy-paste, closed circle", () => {
  const now = Date.now(), old = new Date(now - 400 * 864e5).toISOString(), neu = new Date(now - 864e5).toISOString();
  const mk = (author, text, created = old, reactors = []) => ({ author, text, created_at: new Date().toISOString(), authorCreated: created, reactors });
  assert.equal(trends.manipulation([mk("a", "x"), mk("b", "y")]).flagged, false, "too small to judge");
  const organic = [mk("a", "رأيي في المباراة"), mk("b", "هدف رائع اليوم"), mk("c", "الحكم كان ممتازاً"), mk("d", "أفضل مباراة هذا الموسم")];
  assert.equal(trends.manipulation(organic).flagged, false);
  assert.match(trends.manipulation([mk("s", "1 اشتروا"), mk("s", "2 اشتروا الآن"), mk("s", "3 عرض"), mk("b", "رأي")]).reasons.join(), /حساب واحد/);
  const swarm = ["a", "b", "c", "d"].map((u, i) => mk(u, "نص مختلف رقم " + i, neu));
  assert.match(trends.manipulation(swarm, { baselineFresh: 0.1 }).reasons.join(), /حديثاً/);
  assert.equal(trends.manipulation(swarm, { baselineFresh: 0.9 }).flagged, false, "young platform: new accounts are normal");
  assert.match(trends.manipulation(["a", "b", "c", "d"].map(u => mk(u, "انضموا الآن إلى قناة الأرباح المضمونة اليوم #ربح"))).reasons.join(), /متطابقة/);
  assert.match(trends.manipulation(["a", "b", "c", "d"].map((u, i) => mk(u, "مختلف " + i, old, ["r1", "r2", "r1"]))).reasons.join(), /دائرة مغلقة/);
  assert.ok(trends.trendScore({ unique: 5, last6: 4, prev: 1, eng: 10 }) > trends.trendScore({ unique: 5, last6: 1, prev: 4, eng: 10 }), "velocity boosts");
  assert.ok(Object.values(trends.PRESETS).every(p => /^#[0-9a-f]{6}$/.test(p.color)));
});

test("extractive summary: verbatim sentences, redundancy control, supporting citations", () => {
  const sources = [
    { id: "p1", text: "المكتبة العامة افتتحت فرعاً جديداً في حي النخيل. الفرع يضم قاعة للأطفال.", weight: 3 },
    { id: "c1", text: "الفرع الجديد للمكتبة العامة في حي النخيل رائع وواسع.", weight: 1 },
    { id: "c2", text: "ساعات العمل طويلة حتى العاشرة مساءً وهذا ممتاز للطلاب.", weight: 1 },
    { id: "c3", text: "شكراً", weight: 0 }
  ];
  const r = extractive({ sources, maxPoints: 3 });
  assert.ok(r.points.length >= 2 && r.points.length <= 3);
  const all = sources.map(s => s.text).join(" ");
  for (const p of r.points) { assert.ok(all.includes(p.text), "verbatim: " + p.text); assert.ok(p.cites.length >= 1); }
  assert.ok(r.points.some(p => p.cites.length > 1), "near-duplicate sentences add supporting citations");
  assert.ok(!r.points.some(p => p.text === "شكراً"), "too-short sentences skipped");
  assert.deepEqual(extractive({ sources: [] }).points, []);
});
test("extractive summary: lead sentences favoured, trailing hashtags dropped, one point per source on demand", () => {
  const sources = [
    { id: "a", text: "أطلق فريق المكتبة الرقمية خدمة إعارة الكتب الصوتية مجاناً لكل المشتركين. الخدمة تعمل على الجوال والحاسوب. نتمنى لكم قراءة ممتعة #مكتبة #كتب", weight: 2 },
    { id: "b", text: "جربت خدمة إعارة الكتب الصوتية في المكتبة الرقمية وكانت سهلة جداً #كتب", weight: 1 },
    { id: "c", text: "المكتبة الرقمية تحتاج كتباً صوتية أكثر للأطفال.", weight: 1 }
  ];
  const r = extractive({ sources, maxPoints: 3 });
  assert.equal(r.points[0].cites[0], "a", "the first sentence of the strongest source leads");
  assert.ok(r.points.every(p => !/#/.test(p.text)), "hashtag tails are labels, not content");
  const one = extractive({ sources, maxPoints: 3, perSource: 1 });
  assert.equal(new Set(one.points.map(p => p.cites[0])).size, one.points.length, "perSource caps points per source");
});
test("verifier: unknown ids, unsupported numbers and unsupported content are dropped", () => {
  const src = [{ id: "a", text: "ارتفعت المبيعات بنسبة 20 في المئة خلال الربع الثالث في الرياض." }];
  const v = verify([
    { text: "ارتفاع المبيعات 20 في المئة في الربع الثالث", cites: ["a"] },
    { text: "ارتفعت المبيعات 45 في المئة", cites: ["a"] },
    { text: "الشركة ستفتح فروعاً في أوروبا وأمريكا قريباً", cites: ["a"] },
    { text: "ارتفعت المبيعات", cites: ["zzz"] },
    { text: "", cites: ["a"] }, null
  ], src);
  assert.equal(v.kept.length, 1);
  assert.deepEqual(v.dropped.map(d => d.why), ["unsupported_number", "unsupported_content", "no_valid_citation", "no_valid_citation", "no_valid_citation"]);
});

test("gazetteer resolves Arabic/English cities and countries, Oman vs Amman", () => {
  assert.deepEqual(geo.resolve("حي الشاطئ، جدة"), { city: "جدة", country: "SA" });
  assert.deepEqual(geo.resolve("Dubai Marina"), { city: "دبي", country: "AE" });
  assert.deepEqual(geo.resolve("مسقط"), { city: "مسقط", country: "OM" });
  assert.deepEqual(geo.resolve("عُمان"), { city: null, country: "OM" });
  assert.deepEqual(geo.resolve("عمّان، الأردن"), { city: "عمّان", country: "JO" });
  assert.deepEqual(geo.resolve("مكان ما", "sa"), { city: null, country: "SA" });
  assert.deepEqual(geo.resolve(null), { city: null, country: null });
});

test("Meilisearch adapter: settings, normalised documents, filtered search, auth header", async () => {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
      calls.push({ m: req.method, u: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/search")) return res.end(JSON.stringify({ hits: [{ id: "p_1", kind: "post" }, { id: "u_1", kind: "user" }] }));
      res.end(JSON.stringify({ taskUid: 1 }));
    });
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  try {
    const m = createMeili({ url: `http://127.0.0.1:${srv.address().port}/`, key: "k123" });
    await m.index({ kind: "post", id: "p_1", title: "مكتبة", body: "مُبَرْمِجٌ في المدرسة", lang: "ar", created_at: "2026-01-01T00:00:00Z" });
    const ids = await m.search("المدرسة", { kinds: ["post", "user"], lang: "ar", from: "2026-01-01T00:00:00Z" });
    assert.deepEqual(ids, [{ kind: "post", id: "p_1" }, { kind: "user", id: "u_1" }]);
    const settings = calls.find(c => c.u.endsWith("/settings")); assert.ok(settings.body.filterableAttributes.includes("lang"));
    const doc = calls.find(c => c.u.endsWith("/documents")).body[0]; assert.equal(doc.uid, "post__p_1"); assert.equal(doc.norm, "مكتبه مبرمج في المدرسه");
    const s = calls.find(c => c.u.endsWith("/search")); assert.equal(s.body.q, "المدرسه"); assert.match(s.body.filter, /kind IN \["post","user"\] AND lang = "ar" AND ts >= \d+/);
    assert.ok(calls.every(c => c.auth === "Bearer k123"));
    assert.equal(calls.filter(c => c.u === "/indexes").length, 1, "index set up once");
  } finally { srv.close(); }
});

test("mailer: disabled without SMTP_URL, memory transport, and a real SMTP conversation with AUTH PLAIN", async () => {
  assert.equal(createMailer(undefined).enabled, false);
  assert.deepEqual(await createMailer(undefined).send({}), { skipped: "not_configured" });
  const mem = createMailer("memory:"); await mem.send({ to: "x@y.z", subject: "مرحبا", html: "<b>hi</b>", text: "hi" }); assert.equal(mem.outbox.length, 1);
  assert.match(buildMessage({ from: "a@b.c", to: "x@y.z", subject: "أسبوعك", html: "<p>ok</p>", text: "ok" }), /Subject: =\?UTF-8\?B\?2KPYs9io2YjYudmD\?=/);
  const log = []; let data = "";
  const srv = net.createServer(sock => {
    let mode = "cmd"; sock.write("220 fake ESMTP\r\n");
    sock.on("data", d => {
      const s = d.toString();
      if (mode === "data") { data += s; if (data.endsWith("\r\n.\r\n")) { mode = "cmd"; sock.write("250 queued\r\n"); } return; }
      for (const line of s.split("\r\n").filter(Boolean)) {
        log.push(line);
        if (line.startsWith("EHLO")) sock.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH PLAIN")) sock.write("235 ok\r\n");
        else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) sock.write("250 ok\r\n");
        else if (line === "DATA") { mode = "data"; sock.write("354 go\r\n"); }
        else if (line === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
      }
    });
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  try {
    const m = createMailer(`smtp://user%40x:p%40ss@127.0.0.1:${srv.address().port}`, { from: "مجتمع بلس <no-reply@test.local>" });
    const r = await m.send({ to: "wafa@example.com", subject: "أسبوعك", html: "<p>مرحبا</p>", text: "مرحبا" });
    assert.equal(r.ok, true);
    assert.equal(Buffer.from(log.find(l => l.startsWith("AUTH PLAIN")).slice(11), "base64").toString(), "\0user@x\0p@ss");
    assert.ok(log.includes("MAIL FROM:<no-reply@test.local>") && log.includes("RCPT TO:<wafa@example.com>"));
    assert.match(data, /Content-Type: multipart\/alternative/);
  } finally { srv.close(); }
});
