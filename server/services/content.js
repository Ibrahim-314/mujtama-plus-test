/* Content Engine: posts (all types & states), versions, hashtags, series, polls, discussions,
 * Q&A, comments, reactions. Publishes domain events; never calls other services directly. */
const { Classifier, E, str, oneOf, acceptId, now } = require("../lib/core");

const TYPES = ["post", "article", "question", "poll", "discussion", "video", "event", "share", "audio", "story"];
const RT = require("../../richtext.js");
const VIS = ["public", "followers", "close", "list", "private"];
const REACTIONS = ["like", "support", "haha", "useful"];
const GRAD = /^linear-gradient\(135deg,\s?#[0-9a-f]{3,8},\s?#[0-9a-f]{3,8}\)$/i;
const MEDIA = /^\/media\/[\w.-]{6,80}$/;
const safeMedia = (m) => (typeof m === "string" && (GRAD.test(m) || MEDIA.test(m))) ? m : null;
const ROLE_MOD = ["owner", "admin", "moderator"];
const PAID_MARK = Symbol.for("mujtama.paid");

/* v2.62: a guard rejection carries its step (n/max, mutedUntil, locked, masked words) — never the word list */
const guardErr = (v) => { const e = E.bad(v.message); if (v.guard) { e.code = "autoguard"; e.details = { guard: { n: v.guard.n, max: v.guard.max, hours: v.guard.hours, locked: v.guard.locked, mutedUntil: v.guard.mutedUntil, words: v.guard.words } }; } return e; };
module.exports = (ctx) => {
  const { db, bus, rl } = ctx;

  const toClient = (r, viewer) => {
    if (!r) return null;
    const d = r.data || {};
    const o = {
      id: r.id, author: r.author, type: r.type, title: r.title, text: r.text, topic: r.topic, lang: r.lang, visibility: r.visibility, status: r.status,
      community: r.community, quoteOf: r.quote_of, repostOf: r.repost_of, series: r.series, part: r.part, parts: r.parts, location: r.location,
      publishAt: r.publish_at, sensitive: !!r.sensitive, sponsored: !!r.sponsored, moderation: r.moderation, views: r.views, edited: !!r.edited,
      createdAt: r.created_at, updatedAt: r.updated_at, channel: r.channel || undefined, ctag: r.ctag || undefined, media: d.media || null, images: d.images, imageDims: d.imageDims || undefined, video: d.video, poll: d.poll || null, stances: d.stances,
      stanceVoters: d.stances ? {} : undefined, acceptedAnswer: d.acceptedAnswer ?? (r.type === "question" ? null : undefined), event: d.event, worlds: d.worlds, list: d.list, translations: d.translations,
      doc: d.doc || undefined, alts: d.alts || undefined, audio: d.audio || undefined, readingMin: d.readingMin || undefined, cover: d.cover || undefined, expiresAt: r.expires_at || undefined, template: d.template || undefined, partner: d.partner || undefined /* phase 63: paid-partnership disclosure */
    };
    // phase 38: paid posts are locked unless the viewer is entitled (services/paid.js); fail closed if that service is missing
    if (ctx.services.paid) return ctx.services.paid.render(o, r, viewer);
    if (d.paid) for (const k of ["doc", "media", "images", "imageDims", "video", "audio", "cover", "poll", "stances", "translations", "alts"]) o[k] = undefined;
    return o;
  };

  /* v2.62 (QA H3-01): a muted member cannot comment in that community — any active mute: timed (muted_until in the
   * future) or indefinite (muted_until NULL, e.g. the guard's autoguard_lock). An elapsed timed mute not yet swept by
   * unmuteDue no longer blocks. Banned stays 403. Staff are never role 'muted', so their behaviour is unchanged. */
  async function canWriteComment(cid, uid) {
    const m = await db.get("SELECT role, muted_until FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]);
    if (m?.role === "banned") throw E.forbid();
    if (m?.role === "muted" && (!m.muted_until || new Date(m.muted_until) > new Date())) {
      const e = E.forbid(m.muted_until ? "أنت مكتوم في هذا المجتمع ولا يمكنك التعليق حتى ينتهي الكتم" : "أنت موقوف عن الكتابة في هذا المجتمع حتى يراجع مشرف وضعك");
      e.code = "muted"; e.details = { mutedUntil: m.muted_until || null, locked: !m.muted_until }; throw e;
    }
  }
  async function role(cid, uid) { return (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]))?.role; }

  /* Visibility (Phases 5 & 8): every rule lives in lib/policy.js. canSee checks one post; filterVisible
   * checks N posts with a fixed number of queries (authors, communities, memberships, follows, close friends). */
  async function filterVisible(rows, viewer) {
    if (!rows.length) return [];
    const ids = (a) => a.map((_, i) => "$" + (i + 1)).join(",");
    const authorIds = [...new Set(rows.map(r => r.author))], comms = [...new Set(rows.map(r => r.community).filter(Boolean))];
    const authors = Object.fromEntries((await db.read.all(`SELECT id, prefs, private FROM users WHERE id IN (${ids(authorIds)})`, authorIds)).map(u => [u.id, u]));
    const ctype = comms.length ? Object.fromEntries((await db.read.all(`SELECT id, type FROM communities WHERE id IN (${ids(comms)})`, comms)).map(c => [c.id, c.type])) : {};
    const mine = viewer ? new Set((await db.read.all("SELECT community FROM memberships WHERE user_id=$1 AND role NOT IN ('pending','banned')", [viewer])).map(m => m.community)) : new Set();
    const follows = viewer ? new Set((await db.read.all("SELECT dst FROM follows WHERE src=$1", [viewer])).map(f => f.dst)) : new Set();
    const close = viewer && rows.some(r => r.visibility === "close") ? new Set((await db.read.all("SELECT owner FROM close_friends WHERE member=$1", [viewer])).map(f => f.owner)) : new Set();
    const nowIso = new Date().toISOString();
    const chIds = [...new Set(rows.map(r => r.channel).filter(Boolean))];
    /* v2.58: a channel limited to roles (view_roles) is seen only by those roles and the moderators — gated before the public/members rule */
    const chRows = chIds.length ? await db.read.all(`SELECT id, community, view_perm, view_roles FROM community_channels WHERE id IN (${ids(chIds)})`, chIds) : [];
    const gatedCh = chRows.filter(c => Array.isArray(c.view_roles) && c.view_roles.length);
    const gateOk = gatedCh.length ? await ctx.services.cchannels.roleGate(gatedCh, viewer) : new Set(), gatedIds = new Set(gatedCh.map(c => c.id));
    const chPublic = new Set(chRows.filter(c => c.view_perm === "public" && !gatedIds.has(c.id)).map(c => c.id));
    const out = rows.filter(row => (!row.channel || row.author === viewer || (gatedIds.has(row.channel) ? gateOk.has(row.channel) : (chPublic.has(row.channel) || mine.has(row.community)))) && !(row.type === "story" && row.author !== viewer && (!row.expires_at || new Date(row.expires_at).toISOString() < nowIso)) && ctx.policy.visible(row, viewer, { author: authors[row.author], followsAuthor: follows.has(row.author), closeFriend: close.has(row.author),
      communityOk: !row.community || !ctype[row.community] || ctype[row.community] === "public" || mine.has(row.community) }));
    if (ctx.services.paid) await ctx.services.paid.annotate(out, viewer); // phase 38: per-viewer entitlement for paid posts
    return out;
  }
  async function canSee(row, viewer) {
    if (!row) return false;
    return (await filterVisible([row], viewer)).length === 1;
  }


  async function writeHashtags(t, postId, text, at) {
    await t.run("DELETE FROM post_hashtags WHERE post_id=$1", [postId]);
    for (const tag of Classifier.hashtags(text)) await t.run("INSERT INTO post_hashtags(post_id,tag,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [postId, tag, at]);
  }

  async function createPost(user, b) {
    let spaceExtra = null, automodReason = null, amVerdict = null;
    if (!rl.hit("post", user.id)) throw E.rate();
    const type = oneOf(b.type, TYPES, "post");
    let doc = null;
    if (b.doc) doc = RT.validate(b.doc); else if (typeof b.markdown === "string" && b.markdown.trim()) doc = RT.parse(b.markdown);
    if (doc && !doc.blocks.length) doc = null;
    const text = str(b.text, type === "article" ? 60000 : 5000) || (doc ? RT.toText(doc).slice(0, type === "article" ? 60000 : 5000) : ""), title = str(b.title, 200);
    if (doc && type !== "article" && !RT.isRich(doc)) doc = null; // plain text needs no document
    if (!text && !title && !b.quoteOf && !b.repostOf && !b.media && !b.images && !["video", "event", "audio", "story"].includes(type)) throw E.bad("المنشور فارغ");
    if (["article", "discussion"].includes(type) && !title) throw E.bad("العنوان مطلوب");
    const full = `${title || ""} ${text}`;
    if (Classifier.spam(full)) { await ctx.audit("SPAM_BLOCKED", user.id, "Spam pattern", "system"); throw new (require("../lib/core").HttpError)(422, "يبدو المحتوى كرسالة مزعجة ولم يُنشر", "spam"); }
    const dup = text && !b[PAID_MARK] && await db.get("SELECT id FROM posts WHERE author=$1 AND text=$2 AND created_at > $3 AND status <> 'deleted'", [user.id, text, new Date(Date.now() - 864e5).toISOString()]);
    if (dup) throw E.conflict("نشرت نفس المحتوى مؤخراً");
    const community = b.community ? await db.get("SELECT * FROM communities WHERE id=$1", [b.community]) : null;
    let status = "published";
    if (community) {
      const r = await role(community.id, user.id), s = community.settings || {};
      if (!r || ["pending", "banned", "muted"].includes(r)) throw E.forbid("لا تملك صلاحية النشر في هذا المجتمع");
      if (s.whoCanPost === "mods" && !ROLE_MOD.includes(r)) throw E.forbid("النشر للمشرفين فقط في هذا المجتمع");
      if (s.allowLinks === false && /https?:\/\//.test(text)) throw E.bad("الروابط غير مسموحة في هذا المجتمع");
      if (s.allowMedia === false && (b.media || b.images || type === "video")) throw E.bad("الوسائط غير مسموحة في هذا المجتمع");
      if (s.aiModeration && (Classifier.sensitive(full) || (Classifier.commercial(full) && !s.allowCommercial))) throw E.bad("مساعد الإشراف: قد يخالف المنشور قواعد المجتمع");
      if (s.requireApproval && !ROLE_MOD.includes(r)) status = "pending";
      spaceExtra = await ctx.services.cspace.beforePost(community, user, r, b, full);
      if (spaceExtra?.pending && status === "published") status = "pending"; // v2.58: a channel that requires approval
      const verdict = await ctx.services.cmod.automod(community, user, r, full);
      if (verdict?.action === "reject") throw guardErr(verdict);
      if (verdict?.action === "queue" && status === "published") { status = "pending"; automodReason = verdict.reasons; }
      amVerdict = verdict; // v2.59: report-only rules, fingerprints and the penalty ladder run after the insert (cmod2.afterPost)
    }
    for (const ref of [b.quoteOf, b.repostOf].filter(Boolean)) if (!(await canSee(await db.get("SELECT * FROM posts WHERE id=$1", [ref]), user.id))) throw E.bad("المنشور المشار إليه غير متاح");
    const publishAt = b.publishAt && new Date(b.publishAt) > new Date() ? new Date(b.publishAt).toISOString() : null;
    if (status === "published" && publishAt) status = "scheduled";
    if (status === "published" && (type === "video" || type === "audio" || (type === "story" && b.video?.mediaId))) status = "processing";
    const data = {};
    if (safeMedia(b.media)) data.media = safeMedia(b.media);
    if (Array.isArray(b.images)) {
      /* media M2: optional imageDims[i] = [w, h] (or {w, h}) of images[i], kept index-aligned through the filter so the
       * client reserves the real aspect ratio before the image loads; anything not two sane integers becomes null */
      const dim = (v) => { const w = Math.round(+(Array.isArray(v) ? v[0] : v?.w)), h = Math.round(+(Array.isArray(v) ? v[1] : v?.h)); return w > 0 && h > 0 && w <= 30000 && h <= 30000 ? [w, h] : null; };
      const kept = b.images.map((u, i) => [safeMedia(u), Array.isArray(b.imageDims) ? dim(b.imageDims[i]) : null]).filter(([u]) => u).slice(0, 10);
      data.images = kept.map(([u]) => u);
      if (Array.isArray(b.alts)) data.alts = data.images.map((_, i) => str(String(b.alts[i] || ""), 300) || "");
      if (kept.some(([, d]) => d)) data.imageDims = kept.map(([, d]) => d);
    }
    if (doc) { data.doc = doc; if (type === "article") data.readingMin = RT.readingMinutes(doc); }
    if (safeMedia(b.cover)) data.cover = safeMedia(b.cover);
    if (type === "audio") { const mid = typeof b.audio?.mediaId === "string" ? b.audio.mediaId : null; if (!mid || !(await db.get("SELECT 1 x FROM media WHERE id=$1 AND owner=$2 AND kind='audio'", [mid, user.id]))) throw E.bad("الملف الصوتي غير موجود"); data.audio = { mediaId: mid, status: "processing", room: typeof b.audio.room === "string" ? b.audio.room : undefined }; }
    if (type === "story") { if (!data.media && !b.video?.mediaId && !text) throw E.bad("القصة فارغة"); if (b.video?.mediaId) data.video = { mediaId: b.video.mediaId, status: "processing" }; }
    if (b.template && /^[a-z]{1,3}_[a-z0-9]{6,24}$/i.test(b.template)) data.template = b.template;
    /* v2.61.1 (B9): a video post needs a real uploaded video of the author's (`video.mediaId`); only the legacy demo shape with
     * a cover gradient (`media`) and no file still passes. An image-only post whose images were all invalid is empty. */
    if (type === "video") {
      if (b.video != null && (typeof b.video !== "object" || Array.isArray(b.video))) throw E.bad("يلزم ملف فيديو مرفوع (video.mediaId)");
      const vmid = b.video?.mediaId;
      if (vmid != null && typeof vmid !== "string") throw E.bad("يلزم ملف فيديو مرفوع (video.mediaId)");
      if (vmid) { if (!(await db.get("SELECT 1 x FROM media WHERE id=$1 AND owner=$2 AND kind='video'", [vmid, user.id]))) throw E.bad("ملف الفيديو غير موجود"); }
      else if (!data.media) throw E.bad("يلزم ملف فيديو مرفوع (video.mediaId)");
    }
    if (b.images != null && !(data.images?.length) && !text && !title && !doc && !data.media && !b.quoteOf && !b.repostOf && !b.poll && ["post", "discussion", "question", "share"].includes(type)) throw E.bad("الصور غير صالحة: أرفق صورة صحيحة أو اكتب نصاً");
    if (type === "video") data.video = { duration: Math.min(+b.video?.duration || 0, 3600) || null, short: !!(b.short || b.video?.short), starts: 0, completions: 0, status: "processing", mediaId: typeof b.video?.mediaId === "string" ? b.video.mediaId : null };
    // v2.75 فيديوتك: where the video was made — "clips" (Vidtik editor) or "post" (regular composer). Callers that send
    // neither keep the legacy rule (short / variants → clip), so older clients and scripts behave as before.
    if (type === "video") { const src = b.video?.source ?? b.source; if (src === "clips" || src === "post") data.video.source = src; }
    if (b.poll && Array.isArray(b.poll.options)) {
      const opts = b.poll.options.map(o => str(typeof o === "string" ? o : o.t, 100)).filter(Boolean).slice(0, 6);
      if (opts.length < 2) throw E.bad("الاستطلاع يحتاج خيارين");
      data.poll = { options: opts.map(t => ({ t, v: 0 })), multi: !!b.poll.multi, hideResults: !!b.poll.hideResults, endsAt: b.poll.endsAt && !isNaN(new Date(b.poll.endsAt)) ? new Date(b.poll.endsAt).toISOString() : new Date(Date.now() + 864e5).toISOString() };
    }
    if (type === "discussion") data.stances = (Array.isArray(b.stances) ? b.stances : []).map(s => str(typeof s === "string" ? s : s.t, 60)).filter(Boolean).slice(0, 5).map(t => ({ t, v: 0 }));
    if (type === "question") data.acceptedAnswer = null;
    if (b[PAID_MARK]) data.paid = b[PAID_MARK]; // phase 38: set by services/paid.js only (a symbol cannot come from JSON)
    if (Array.isArray(b.worlds)) data.worlds = b.worlds.filter(w => ["dev", "creators", "investors", "fun", "knowledge"].includes(w));
    if (type === "event" && b.event) { const ev = await db.get("SELECT organizer FROM events WHERE id=$1", [b.event]); if (!ev || ev.organizer !== user.id) throw E.bad("الحدث غير موجود"); data.event = b.event; }
    const visibility = oneOf(b.visibility, VIS, "public");
    if (visibility === "list") data.list = str(b.list, 40);
    let series = null, part = null, parts = null;
    if (b.series && /^[a-z]{1,3}_[a-z0-9]{6,24}$/i.test(b.series)) {
      const other = await db.get("SELECT author FROM posts WHERE series=$1 AND author<>$2", [b.series, user.id]);
      if (!other) { series = b.series; part = Math.max(1, +b.part || 1); parts = Math.max(part, +b.parts || part); }
    }
    const pid = acceptId(b.id, "p");
    if (await db.get("SELECT 1 x FROM posts WHERE id=$1", [pid])) throw E.conflict("المعرّف مستخدم");
    const at = now();
    await db.tx(async t => {
      await t.run(`INSERT INTO posts(id,author,type,title,text,topic,lang,visibility,status,community,quote_of,repost_of,series,part,parts,location,publish_at,sensitive,data,created_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [pid, user.id, type, title, text, oneOf(b.topic, require("../lib/core").TOPICS.map(x => x.slug), null) || Classifier.topic(text), Classifier.lang(full), visibility, status, community?.id || null,
          b.quoteOf || null, b.repostOf || null, series, part, parts, str(b.location, 80), publishAt, !!b.sensitive || Classifier.sensitive(full), data, at, type === "story" ? new Date(Date.now() + 864e5).toISOString() : null]);
      await writeHashtags(t, pid, full, at);
    });
    if (spaceExtra && (spaceExtra.channel || spaceExtra.ctag)) await db.run("UPDATE posts SET channel=$1, ctag=$2 WHERE id=$3", [spaceExtra.channel || null, spaceExtra.ctag || null, pid]);
    if (automodReason) await ctx.services.cmod.log(community.id, "system", { post: pid, user: user.id, action: "automod_queue", reason: automodReason.join("، "), meta: amVerdict?.rules ? { rules: amVerdict.rules } : null });
    if (community) await ctx.services.cmod2?.afterPost(community, user, "post", pid, full, amVerdict, status);
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    bus.emit("POST_CREATED", { post: row, actor: user.id });
    if (status === "published") bus.emit("POST_PUBLISHED", { post: row });
    if (status === "processing") bus.emit("VIDEO_UPLOADED", { post: row });
    for (const h of Classifier.mentions(text)) { const u = await db.get("SELECT id, prefs, privacy FROM users WHERE handle=$1", [h]); if (u && u.id !== user.id && await ctx.policy.canMention(user.id, u)) bus.emit("USER_MENTIONED", { user: u.id, actor: user.id, post: pid }); }
    if (community && status === "pending") bus.emit("POST_PENDING", { post: row, community: community.id });
    ctx.cache.del("feed:"); ctx.cache.del("trends");
    return toClient(row, user.id);
  }

  async function mine(user, pid) { const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!p) throw E.nf(); return p; }

  async function updatePost(user, pid, b) {
    const p = await mine(user, pid);
    if (p.author !== user.id) throw E.forbid();
    if (b.text !== undefined) {
      const text = str(b.text, 5000, { required: true });
      if (Classifier.spam(text)) throw E.bad("المحتوى مرفوض");
      /* v2.62 T5: an edit in a community passes the guard (guard.edits); a hit rejects it — the published text stays
       * untouched (no version row, no update) — and counts as a strike. Staff exempt (cmod.automod). Guard only:
       * edits never ran the legacy/v2 rules and still don't. */
      if (p.community && ctx.services.cmod2?.guardCheck && text !== p.text) {
        const com = await db.get("SELECT * FROM communities WHERE id=$1", [p.community]), r = await role(p.community, user.id);
        if (com && !ROLE_MOD.includes(r)) { const gv = await ctx.services.cmod2.guardCheck(com, user, `${p.title || ""} ${text}`, "edit"); if (gv?.action === "reject") throw guardErr(gv); }
      }
      await db.tx(async t => {
        await t.run("INSERT INTO post_versions(post_id,text,at) VALUES($1,$2,$3)", [pid, p.text, p.updated_at || p.created_at]);
        await t.run("UPDATE posts SET text=$1, edited=1, updated_at=$2, sensitive=$3 WHERE id=$4", [text, now(), Classifier.sensitive(text) ? 1 : p.sensitive, pid]);
        await writeHashtags(t, pid, `${p.title || ""} ${text}`, p.created_at);
      });
      bus.emit("POST_UPDATED", { post: pid, actor: user.id });
    }
    if (b.status !== undefined) {
      const allowed = { published: ["archived"], archived: ["published"] };
      if (!(allowed[p.status] || []).includes(b.status)) throw E.bad("تغيير الحالة غير مسموح");
      await db.run("UPDATE posts SET status=$1, updated_at=$2 WHERE id=$3", [b.status, now(), pid]);
    }
    ctx.cache.del("feed:");
    return toClient(await db.get("SELECT * FROM posts WHERE id=$1", [pid]), user.id);
  }

  async function deletePost(user, pid) {
    const p = await mine(user, pid);
    let ok = p.author === user.id || user.role === "admin";
    if (!ok && p.community) ok = ROLE_MOD.includes(await role(p.community, user.id));
    if (!ok) throw E.forbid();
    await db.run("UPDATE posts SET status='deleted', updated_at=$1 WHERE id=$2", [now(), pid]);
    bus.emit("POST_DELETED", { post: pid, actor: user.id });
    if (p.author !== user.id) await ctx.audit("POST_DELETED_BY_MOD", pid, null, user.id);
    ctx.cache.del("feed:");
  }

  async function getPost(user, pid) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!(await canSee(p, user?.id))) throw E.nf();
    const out = toClient(p, user?.id);
    out.history = out.paid ? [] : await db.all("SELECT text, at FROM post_versions WHERE post_id=$1 ORDER BY id", [pid]); // phase 38: no edit history on paid posts
    out.reactions = (await db.get("SELECT COUNT(*) n FROM reactions WHERE target=$1", [pid])).n;
    out.comments = (await db.get("SELECT COUNT(*) n FROM comments WHERE post=$1 AND status='published'", [pid])).n;
    return out;
  }

  const SOURCES = ["feed", "following", "profile", "search", "explore", "community", "share", "notification", "direct", "shorts", "story"];
  async function view(user, pid, source) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!(await canSee(p, user.id))) throw E.nf();
    if (rl.hit("view", user.id + ":" + pid)) {
      const src = SOURCES.includes(source) ? source : "direct";
      await db.run("UPDATE posts SET views=views+1 WHERE id=$1", [pid]);
      if (p.author !== user.id) { const at = now(); await db.run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,$3,$4)", [pid, user.id, src, at]); ctx.analytics?.emit("post_view", { post: pid, author: p.author, user: user.id, source: src }); if (p.community) bus.emit("POST_VIEWED", { post: pid, community: p.community, author: p.author, user: user.id, at }); } // v2.60: community insight counter
    }
  }

  async function vote(user, pid, idxs) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!(await canSee(p, user.id)) || !p.data?.poll) throw E.nf();
    const poll = p.data.poll; if (new Date(poll.endsAt) < new Date()) throw E.bad("انتهى الاستطلاع");
    idxs = [].concat(idxs).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < poll.options.length);
    if (!idxs.length) throw E.bad();
    const existing = await db.all("SELECT option_idx FROM poll_votes WHERE post_id=$1 AND user_id=$2", [pid, user.id]);
    if (existing.length && !poll.multi) throw E.conflict("صوّت مسبقاً");
    for (const i of poll.multi ? idxs : idxs.slice(0, 1)) await db.run("INSERT INTO poll_votes(post_id,user_id,option_idx,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [pid, user.id, i, now()]);
  }
  async function stance(user, pid, idx) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!(await canSee(p, user.id)) || !p.data?.stances) throw E.nf();
    if (!(idx >= 0 && idx < p.data.stances.length)) throw E.bad();
    await db.run("INSERT INTO stance_votes(post_id,user_id,idx,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [pid, user.id, idx, now()]);
  }
  async function accept(user, pid, commentId) {
    const p = await mine(user, pid); if (p.author !== user.id || p.type !== "question") throw E.forbid();
    if (commentId && !(await db.get("SELECT 1 x FROM comments WHERE id=$1 AND post=$2", [commentId, pid]))) throw E.bad();
    await db.run("UPDATE posts SET data=$1 WHERE id=$2", [{ ...p.data, acceptedAnswer: commentId || null }, pid]);
    if ((p.data?.acceptedAnswer || null) !== (commentId || null)) bus.emit("ANSWER_ACCEPTED", { post: pid, community: p.community || null, comment: commentId || null, previous: p.data?.acceptedAnswer || null, actor: user.id }); // v2.60: community MJT rewards
  }

  async function comment(user, b) {
    if (!rl.hit("comment", user.id)) throw E.rate();
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [b.post]);
    if (!(await canSee(p, user.id))) throw E.nf();
    if (p.community) await canWriteComment(p.community, user.id);
    if (p.community && (await db.get("SELECT archived_at FROM communities WHERE id=$1", [p.community]))?.archived_at) throw E.forbid("المجتمع مؤرشف: للقراءة فقط"); // v2.57
    if (!(await ctx.policy.canComment(user.id, await db.get("SELECT id, prefs, privacy FROM users WHERE id=$1", [p.author])))) throw E.forbid("صاحب المنشور قصر التعليقات");
    await ctx.services.protection?.checkReply(user, p); // phase 33: per-post reply audience
    const text = str(b.text, 2000, { required: true });
    if (Classifier.spam(text)) throw E.bad("التعليق مرفوض");
    let parent = null;
    if (b.parent) { const pc = await db.get("SELECT id, author FROM comments WHERE id=$1 AND post=$2", [b.parent, p.id]); if (!pc) throw E.bad(); parent = pc; }
    const anchor = typeof b.anchor === "string" && (p.data?.doc?.blocks || []).some(x => x.id === b.anchor) ? b.anchor : null;
    const cid = acceptId(b.id, "c");
    /* v2.59: community automod v2 for comments — only when the community turned «التعليقات» on (off by default) */
    let cstatus = "published", cverdict = null, com = null;
    if (p.community && ctx.services.cmod2 && (com = await ctx.services.cmod2.commentRulesOn(p.community))) {
      cverdict = await ctx.services.cmod.automod(com, user, await role(p.community, user.id), text, "comment");
      if (cverdict?.action === "reject") throw guardErr(cverdict);
      if (cverdict?.action === "queue") cstatus = "pending";
    }
    await db.run("INSERT INTO comments(id,post,author,parent,text,created_at,anchor,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING", [cid, p.id, user.id, parent?.id || null, text, now(), anchor, cstatus]);
    if (com && (!ctx.services.cmod2.commentV2On || ctx.services.cmod2.commentV2On(com))) await ctx.services.cmod2.afterPost(com, user, "comment", cid, text, cverdict, cstatus);
    if (cstatus === "pending") return { id: cid, post: p.id, author: user.id, parent: parent?.id || null, text, createdAt: now(), status: "pending", anchor, review: "تعليقك بانتظار موافقة مشرفي المجتمع" };
    bus.emit("COMMENT_CREATED", { comment: cid, post: p.id, postAuthor: p.author, parentAuthor: parent?.author, actor: user.id });
    for (const h of Classifier.mentions(text)) { const u = await db.get("SELECT id, prefs, privacy FROM users WHERE handle=$1", [h]); if (u && u.id !== user.id && await ctx.policy.canMention(user.id, u)) bus.emit("USER_MENTIONED", { user: u.id, actor: user.id, post: p.id }); }
    return { id: cid, post: p.id, author: user.id, parent: parent?.id || null, text, createdAt: now(), status: "published", anchor };
  }

  async function react(user, target, type) {
    if (!rl.hit("react", user.id)) throw E.rate();
    if (!REACTIONS.includes(type)) throw E.bad();
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [target]);
    let owner;
    if (p) { if (!(await canSee(p, user.id))) throw E.nf(); owner = p.author; }
    else { const c = await db.get("SELECT c.author, p.* FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [target]); if (!c) throw E.nf(); owner = c.author; }
    const ex = await db.get("SELECT type FROM reactions WHERE target=$1 AND user_id=$2", [target, user.id]);
    await db.run("INSERT INTO reactions(target,user_id,type,at) VALUES($1,$2,$3,$4) ON CONFLICT(target,user_id) DO UPDATE SET type=excluded.type", [target, user.id, type, now()]);
    if (!ex) bus.emit("POST_REACTED", { target, owner, type, actor: user.id });
  }
  async function unreact(user, target) { await db.run("DELETE FROM reactions WHERE target=$1 AND user_id=$2", [target, user.id]); }

  /* scheduled publisher (job). v2.30 (phase 62): each post is CLAIMED with a conditional update, so concurrent ticks or
   * instances never publish (or notify) twice; the series service may hold back a post whose author is no longer active;
   * a scheduled story's 24 h start when it is published. */
  async function publishDue() {
    const due = await db.all("SELECT * FROM posts WHERE status='scheduled' AND publish_at <= $1 ORDER BY publish_at LIMIT 200", [now()]);
    let n = 0;
    for (const p of due) {
      try { if (ctx.services.series && !(await ctx.services.series.canPublish(p))) continue; } catch { /* guard optional */ }
      const at = now(), exp = p.type === "story" ? new Date(Date.parse(at) + 864e5).toISOString() : p.expires_at || null;
      /* v2.80: a scheduled video / audio (or video story) goes through 'processing' like an immediate one, so it never shows
       * up in a feed before its media is ready; media.finishMediaPost publishes it (now, or on MEDIA_READY) and emits
       * POST_PUBLISHED with scheduled:true itself (publish_at is set). */
      const d = p.data && typeof p.data === "object" ? p.data : {};
      if (p.type === "video" || p.type === "audio" || (p.type === "story" && d.video?.mediaId)) {
        const q = await db.run("UPDATE posts SET status='processing', expires_at=$1 WHERE id=$2 AND status='scheduled'", [exp, p.id]);
        if (!q.changes) continue;
        n++; try { await ctx.services.media?.finishMediaPost(p.id); } catch { /* MEDIA_READY retries */ }
        continue;
      }
      const r = await db.run("UPDATE posts SET status='published', created_at=$1, expires_at=$2 WHERE id=$3 AND status='scheduled'", [at, exp, p.id]);
      if (!r.changes) continue;
      n++; bus.emit("POST_PUBLISHED", { post: { ...p, status: "published", created_at: at, expires_at: exp }, scheduled: true });
    }
    if (n) { ctx.cache.del("feed:"); ctx.cache.del("trends"); }
    return n;
  }

  /* routes */
  const r = ctx.router, A = ctx.requireUser;
  r.post("/api/posts", A(async (req) => ({ post: await createPost(req.user, req.body) })));
  r.get("/api/posts/:id", async (req) => ({ post: await getPost(req.user, req.params.id) }));
  r.patch("/api/posts/:id", A(async (req) => ({ post: await updatePost(req.user, req.params.id, req.body) })));
  r.del("/api/posts/:id", A(async (req) => (await deletePost(req.user, req.params.id), { ok: true })));
  r.post("/api/posts/:id/view", A(async (req) => (await view(req.user, req.params.id, req.body.source), { ok: true })));
  r.post("/api/posts/:id/vote", A(async (req) => (await vote(req.user, req.params.id, req.body.option), { ok: true })));
  r.post("/api/posts/:id/stance", A(async (req) => (await stance(req.user, req.params.id, +req.body.index), { ok: true })));
  r.post("/api/posts/:id/accept", A(async (req) => (await accept(req.user, req.params.id, req.body.comment), { ok: true })));
  r.get("/api/posts/:id/comments", async (req) => { const p = await db.get("SELECT * FROM posts WHERE id=$1", [req.params.id]); if (!(await canSee(p, req.user?.id))) throw E.nf(); return { comments: await db.all("SELECT id, post, author, parent, text, status, created_at AS \"createdAt\" FROM comments WHERE post=$1 AND status='published' ORDER BY created_at", [p.id]) }; });
  r.post("/api/comments", A(async (req) => ({ comment: await comment(req.user, req.body) })));
  r.put("/api/reactions/:target", A(async (req) => (await react(req.user, req.params.target, req.body.type), { ok: true })));
  r.del("/api/reactions/:target", A(async (req) => (await unreact(req.user, req.params.target), { ok: true })));

  return { toClient, canSee, filterVisible, role, createPost, publishDue, updatePost, REACTIONS, comment }; // comment: phase 47 developer API
};
