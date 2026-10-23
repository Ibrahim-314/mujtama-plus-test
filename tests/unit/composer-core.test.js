/* v2.50 — composer core (composer-core.js): mode routing for every entry point, normalisation of legacy shapes,
 * validation, request plans, offline local posts and the synced-draft payload. Runs the browser file in a VM. */
const test = require("node:test"), assert = require("node:assert"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const ctx = { console, Date, Math, JSON, Object, Array, String, Number, Set, Map, crypto: require("node:crypto").webcrypto };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "composer-core.js"), "utf8"), ctx);
const K = ctx.MPComposerCore;
const NOW = new Date("2026-10-18T10:00:00Z");
const plain = (o) => JSON.parse(JSON.stringify(o));

test("entry points route to the right editor", () => {
  assert.equal(K.resolveMode({}), "general", "FAB");
  assert.equal(K.resolveMode({ community: "c_abcdef12" }), "community", "community page");
  assert.equal(K.resolveMode({ community: "c_abcdef12", type: "poll" }), "community");
  assert.equal(K.resolveMode({ community: "c_abcdef12", type: "question" }), "community");
  assert.equal(K.resolveMode({ community: "c_abcdef12", type: "event" }), "general", "event inside a community needs the creative editor");
  assert.equal(K.resolveMode({ quoteOf: "p_x" }), "general", "quote");
  assert.equal(K.resolveMode({ edit: "p_x", text: "a" }), "edit");
  assert.equal(K.resolveMode({ draftId: "dr_abcdef", data: { type: "post", x: { community: "c_abcdef12", mode: "community" } } }), "community", "draft resume keeps its editor");
  assert.equal(K.resolveMode({ mode: "community" }), "general", "community mode needs a community");
  assert.equal(K.resolveMode({ type: "story" }), "general");
});

test("normalize: legacy shapes, aliases and community type limits", () => {
  const a = K.normalize({ text: "ما الشيء الذي تعلمته اليوم؟", topic: "learn" });
  assert.equal(a.markdown, "ما الشيء الذي تعلمته اليوم؟"); assert.equal(a.topic, "learn"); assert.match(a.id, /^dr_[a-z0-9]{10}$/);
  assert.equal(K.normalize({ type: "image" }).type, "post", "image → post with images");
  assert.equal(K.normalize({ community: "c_abcdef12", type: "article", mode: "community" }).type, "post", "community editor only knows post/poll/question");
  const share = K.normalize({ data: { markdown: "رابط https://x.y", images: ["/media/a1b2c3.png"], alts: ["شعار"] } });
  assert.deepEqual(plain(share.images), ["/media/a1b2c3.png"]); assert.deepEqual(plain(share.alts), ["شعار"]);
  const old = K.normalize({ id: "d_123456", type: "poll", text: "سؤال", pollOpts: ["أ", "ب", "ج"], community: "" });
  assert.equal(old.legacyId, "d_123456"); assert.deepEqual(plain(old.poll.options), ["أ", "ب", "ج"]);
  const q = K.normalize({ quoteOf: "p_1", type: "poll" }); assert.equal(q.type, "post", "a quote is a post");
  const past = K.normalize({ data: { publishAt: "2020-01-01T10:00" } }, { now: NOW }); assert.equal(past.publishAt, "");
  const d = K.normalize({ draftId: "dr_abcdef12", data: { type: "poll", markdown: "متى؟", updatedAt: "t1", x: { community: "c_abcdef12", channel: "ch_abcdef", poll: { options: ["١", "٢"], hours: 72 } } } });
  assert.equal(d.id, "dr_abcdef12"); assert.equal(d.base, "t1"); assert.equal(d.channel, "ch_abcdef"); assert.equal(d.poll.hours, 72);
});

test("validate: per type, schedule, length, offline", () => {
  const v = (init, extra = {}, c = { online: true, now: NOW }) => { const s = K.normalize(init); Object.assign(s, extra); return K.validate(s, c)?.field || null; };
  assert.equal(v({}), "text");
  assert.equal(v({ text: "مرحبا" }), null);
  assert.equal(v({ type: "article", text: "x" }), "title");
  assert.equal(v({ type: "poll", text: "?" }), "poll");
  assert.equal(v({ type: "poll", text: "?" }, { poll: { options: ["أ", "أ"], hours: 24 } }), "poll", "duplicates");
  assert.equal(v({ type: "poll", text: "?" }, { poll: { options: ["أ", "ب"], hours: 24 } }), null);
  assert.equal(v({ type: "question" }, { title: "لم؟" }), "title", "too short");
  assert.equal(v({ type: "question" }, { title: "لماذا يحدث هذا؟" }), null);
  assert.equal(v({ type: "thread", text: "1" }), "parts");
  assert.equal(v({ type: "event" }, { event: { name: "لقاء", startsAt: "2026-10-17T10:00", place: "" } }), "event", "event in the past");
  assert.equal(v({ type: "event" }, { event: { name: "لقاء", startsAt: "2026-10-20T10:00", place: "" } }), null);
  assert.equal(v({ type: "video" }), "video"); assert.equal(v({ type: "audio" }), "audio"); assert.equal(v({ type: "story" }), "story");
  assert.equal(v({ text: "x" }, { publishAt: "2026-10-01T10:00" }), "publishAt");
  assert.equal(v({ text: "x".repeat(5001) }), "text");
  assert.equal(v({ type: "article", text: "x".repeat(5001) }, { title: "ع" }), null, "articles get 60k");
  assert.equal(v({ text: "x" }, { images: ["/media/a.png"] }, { online: false, now: NOW }), "type", "uploads need a connection");
  assert.equal(v({ text: "x" }, { visibility: "list", list: "" }), "list");
  assert.equal(v({ edit: "p_1", text: "" }), "text");
});

test("plan: community body, general extras, event, thread, story", () => {
  let id = 0; const newId = (p) => `${p}_t${String(++id).padStart(6, "0")}`;
  const c = K.normalize({ community: "c_abcdef12", channel: "ch_abcdef", ctag: "مشروع" }); c.markdown = "أهلاً"; c.topic = "dev"; c.publishAt = "2026-12-01T10:00";
  const pc = K.plan(c, { now: NOW, newId }).posts[0];
  assert.equal(pc.community, "c_abcdef12"); assert.equal(pc.channel, "ch_abcdef"); assert.equal(pc.ctag, "مشروع");
  assert.equal(pc.topic, undefined, "the simple editor sends no general-only fields"); assert.equal(pc.publishAt, undefined);
  const g = K.normalize({}); Object.assign(g, { markdown: "**مرحبا**", topic: "dev", location: " جدة ", sensitive: true, publishAt: "2026-12-01T10:00", images: ["/media/a.png"], alts: ["أ"] });
  const pg = K.plan(g, { now: NOW, newId }).posts[0];
  assert.equal(pg.markdown, "**مرحبا**"); assert.equal(pg.location, "جدة"); assert.equal(pg.sensitive, true); assert.ok(pg.publishAt.endsWith("Z")); assert.deepEqual(plain(pg.alts), ["أ"]);
  const p = K.normalize({ type: "poll" }); Object.assign(p, { markdown: "؟" }); p.poll.options = ["أ", " ", "ب"]; p.poll.hours = 72;
  const pp = K.plan(p, { now: NOW, newId }).posts[0];
  assert.deepEqual(plain(pp.poll.options), ["أ", "ب"]); assert.equal(pp.poll.endsAt, new Date(NOW.getTime() + 72 * 3600e3).toISOString());
  const e = K.normalize({ type: "event", community: "c_abcdef12" }); e.event = { name: "لقاء", startsAt: "2026-12-01T18:00", place: "" };
  const pe = K.plan(e, { now: NOW, newId });
  assert.equal(pe.event.place, "أونلاين"); assert.equal(pe.event.community, "c_abcdef12"); assert.equal(pe.posts[0].event, pe.event.id); assert.equal(pe.posts[0].text, "لقاء");
  const t = K.normalize({ type: "thread" }); t.markdown = "١"; t.parts = ["٢", "", "٣"];
  const pt = K.plan(t, { now: NOW, newId }).posts;
  assert.equal(pt.length, 3); assert.ok(pt.every(x => x.series === pt[0].series && x.parts === 3 && x.type === "post")); assert.deepEqual(pt.map(x => x.part), [1, 2, 3]);
  const s = K.normalize({ type: "story" }); s.publishAt = "2026-12-01T10:00"; s.story = { kind: "video", id: "md_x", url: "/media/x.mp4" };
  const ps = K.plan(s, { now: NOW, newId }).posts[0];
  assert.equal(ps.publishAt, undefined, "stories are never scheduled"); assert.equal(ps.video.mediaId, "md_x");
  const a = K.normalize({ type: "article" }); Object.assign(a, { title: "ع", markdown: "# م", images: ["/media/c.png"], series: "sr_abcdef12" });
  const pa = K.plan(a, { now: NOW, newId, seriesParts: 2 }).posts[0];
  assert.equal(pa.cover, "/media/c.png"); assert.deepEqual([pa.series, pa.part, pa.parts], ["sr_abcdef12", 3, 3]);
});

test("offline local post and synced draft payload", () => {
  const p = K.normalize({ type: "poll", community: "c_abcdef12" }); p.markdown = "متى؟"; p.poll.options = ["أ", "ب"];
  const l = K.toLocal(p, { now: NOW });
  assert.equal(l.type, "poll"); assert.equal(l.community, "c_abcdef12"); assert.deepEqual(plain(l.poll.options), [{ t: "أ", v: 0 }, { t: "ب", v: 0 }]);
  const t = K.normalize({ type: "thread" }); t.markdown = "١"; t.parts = ["٢"]; assert.deepEqual(plain(K.toLocal(t).threadParts), ["٢"]);
  const d = K.draftData(p);
  assert.equal(d.type, "poll"); assert.equal(d.x.mode, "community"); assert.equal(d.x.community, "c_abcdef12"); assert.deepEqual(plain(d.x.poll.options), ["أ", "ب"]);
  const back = K.normalize({ draftId: "dr_abcdef12", data: d });
  assert.equal(back.mode, "community"); assert.equal(back.markdown, "متى؟"); assert.deepEqual(plain(back.poll.options), ["أ", "ب"]);
  assert.equal(K.hasContent(K.normalize({})), false); assert.equal(K.hasContent(back), true);
  assert.deepEqual(plain(K.counter(K.normalize({ text: "abc" }))), { n: 3, lim: 5000, over: false, left: 4997 });
});
