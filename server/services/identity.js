/* Identity Service (Phases 6, 8, 9): rich profiles & images, privacy center (private accounts,
 * follow requests, close friends, interaction controls, muted words), multi-account switching. */
const { E, str, now, sha } = require("../lib/core");
const IMG = require("../lib/images");
const SECTIONS = ["works", "articles", "communities"];
const ACHIEVEMENT_INFO = {
  first_post: ["أول منشور", "نشرت أول منشور لك"], first_comment: ["أول مشاركة", "شاركت في أول نقاش"], followers_10: ["١٠ متابعين", "تابعك ١٠ أشخاص"], followers_100: ["١٠٠ متابع", "تابعك ١٠٠ شخص"],
  helpful_10: ["مفيد", "حصلت على ١٠ تفاعلات «مفيد»"], helpful_100: ["مرجع", "حصلت على ١٠٠ تفاعل «مفيد»"], profile_complete: ["ملف مكتمل", "أكملت ملفك الشخصي"], community_member: ["عضو مجتمع", "انضممت لأول مجتمع"],
  secure: ["حساب آمن", "فعّلت التحقق بخطوتين"], conversation_starter: ["محفّز نقاش", "منشور واحد جمع ١٠ معلّقين مختلفين"]
};
const VERIFIED_INFO = { person: "هوية شخصية موثقة", creator: "منشئ محتوى موثق", org: "مؤسسة موثقة", expert: "خبير موثق في مجاله" };

module.exports = (ctx) => {
  const { db, router: R, rl, storage } = ctx;
  const A = ctx.requireUser; const users = () => ctx.services.users, content = () => ctx.services.content;
  const urlOk = (u) => { try { const x = new URL(u); return ["https:", "http:"].includes(x.protocol) ? x.toString().slice(0, 300) : null; } catch { return null; } };

  function completeness(u) {
    const checks = [["avatar", !!u.avatar, "أضف صورة شخصية"], ["cover", !!u.cover, "أضف صورة غلاف"], ["bio", (u.bio || "").length >= 20, "اكتب نبذة من ٢٠ حرفاً على الأقل"],
      ["location", !!u.location, "أضف موقعك"], ["links", (u.links || []).length > 0, "أضف رابطاً واحداً على الأقل"], ["expertise", (u.expertise || []).length > 0, "حدد مجالات خبرتك"], ["interests", ((u.prefs || {}).interests || []).length >= 3, "اختر ٣ اهتمامات"]];
    const done = checks.filter(c => c[1]).length;
    return { percent: Math.round(done / checks.length * 100), missing: checks.filter(c => !c[1]).map(c => ({ key: c[0], text: c[2] })) };
  }

  async function fullProfile(viewer, handle) {
    const u = await db.get("SELECT * FROM users WHERE LOWER(handle)=LOWER($1) AND status='active'", [handle]); if (!u) throw E.nf();
    const me = viewer?.id === u.id;
    if (viewer && (u.prefs?.blocked || []).includes(viewer.id)) throw E.nf();
    const followers = (await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [u.id])).n, following = (await db.get("SELECT COUNT(*) n FROM follows WHERE src=$1", [u.id])).n;
    const isFollowing = viewer ? await ctx.policy.follows(viewer.id, u.id) : false;
    const locked = !!u.private && !me && !isFollowing;
    const posts = locked ? [] : await content().filterVisible(await db.all("SELECT * FROM posts WHERE author=$1 AND status='published' ORDER BY created_at DESC LIMIT 200", [u.id]), viewer?.id);
    const pinnedIds = (u.pinned_posts || (u.pinned ? [u.pinned] : [])).slice(0, 3);
    const byId = Object.fromEntries(posts.map(p => [p.id, p]));
    const sections = (u.sections && u.sections.length ? u.sections : SECTIONS).filter(s => SECTIONS.includes(s));
    const comms = locked ? [] : (await db.all("SELECT c.id, c.name, c.color, c.type, m.role FROM memberships m JOIN communities c ON c.id=m.community WHERE m.user_id=$1 AND m.role NOT IN ('pending','banned') AND c.type<>'secret' ORDER BY m.joined_at DESC LIMIT 12", [u.id]));
    const ach = await db.all("SELECT key, at FROM achievements WHERE user_id=$1 ORDER BY at", [u.id]);
    const rep = await db.get("SELECT score, breakdown FROM user_reputation WHERE user_id=$1", [u.id]);
    const orgs = await db.all("SELECT o.id, o.name, o.handle, o.avatar, m.role FROM org_members m JOIN users o ON o.id=m.org WHERE m.user_id=$1", [u.id]);
    return {
      profile: { ...users().pub(u), bio: u.bio || "", location: u.location || null, links: u.links || [], expertise: u.expertise || [], sections, followers, following, postsCount: locked ? null : posts.length,
        verifiedLabel: u.verified ? VERIFIED_INFO[u.verified] : null, reputation: rep?.score ?? u.reputation ?? 0, reputationBreakdown: rep?.breakdown || null,
        achievements: ach.map(a => ({ key: a.key, at: a.at, name: (ACHIEVEMENT_INFO[a.key] || [a.key])[0], description: (ACHIEVEMENT_INFO[a.key] || ["", ""])[1] })),
        orgs: orgs.map(o => ({ id: o.id, name: o.name, handle: o.handle, avatar: o.avatar, role: o.role })), members: u.account_type === "org" ? (await db.all("SELECT u.id, u.name, u.handle, u.avatar, m.role FROM org_members m JOIN users u ON u.id=m.user_id WHERE m.org=$1", [u.id])).map(x => ({ ...x })) : undefined },
      relationship: viewer && !me ? { following: isFollowing, followsYou: await ctx.policy.follows(u.id, viewer.id), requested: !!(await db.get("SELECT 1 x FROM follow_requests WHERE src=$1 AND dst=$2", [viewer.id, u.id])), canMessage: !!(await ctx.policy.messageMode(viewer.id, u)) } : null,
      locked, pinned: pinnedIds.map(i => byId[i]).filter(Boolean).map(p => content().toClient(p, viewer?.id)),
      sectionsData: { works: posts.filter(p => p.data?.media || p.data?.images || p.type === "video").slice(0, 6).map(p => content().toClient(p, viewer?.id)), articles: posts.filter(p => p.type === "article").slice(0, 6).map(p => content().toClient(p, viewer?.id)), communities: comms },
      completeness: me ? completeness(u) : undefined,
      pro: locked ? null : await ctx.services.proprofile?.badge?.(u, viewer) // phase 76: link to the professional profile (only when the viewer may see it)
    };
  }
  /* small card for hover previews — cheap and cached */
  async function card(viewer, handle) {
    return ctx.cache.wrap("card:" + handle.toLowerCase() + ":" + (viewer?.id || ""), 30e3, async () => {
      const u = await db.get("SELECT * FROM users WHERE LOWER(handle)=LOWER($1) AND status='active'", [handle]); if (!u) throw E.nf();
      const followers = (await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [u.id])).n;
      return { ...users().pub(u), bio: (u.bio || "").slice(0, 160), followers, location: u.location || null, verifiedLabel: u.verified ? VERIFIED_INFO[u.verified] : null, following: viewer ? await ctx.policy.follows(viewer.id, u.id) : false };
    });
  }

  R.get("/api/profiles/:handle", async (req) => fullProfile(req.user, req.params.handle));
  R.get("/api/profiles/:handle/card", async (req) => card(req.user, req.params.handle));
  R.patch("/api/profile", A(async (req) => {
    const b = req.body, u = req.user, set = {};
    if (b.location !== undefined) set.location = str(b.location, 60);
    if (b.country !== undefined) set.country = /^[A-Z]{2}$/.test(b.country || "") ? b.country : null;
    if (b.links !== undefined) { if (!Array.isArray(b.links) || b.links.length > 5) throw E.bad("حتى ٥ روابط"); set.links = b.links.map(l => ({ label: str(l.label, 30) || "", url: urlOk(l.url) })).filter(l => l.url); }
    if (b.expertise !== undefined) { if (!Array.isArray(b.expertise) || b.expertise.length > 8) throw E.bad("حتى ٨ مجالات"); set.expertise = [...new Set(b.expertise.map(x => str(String(x), 30)).filter(Boolean))]; }
    if (b.sections !== undefined) { if (!Array.isArray(b.sections)) throw E.bad(); set.sections = b.sections.filter(s => SECTIONS.includes(s)); }
    if (b.pinnedPosts !== undefined) {
      if (!Array.isArray(b.pinnedPosts) || b.pinnedPosts.length > 3) throw E.bad("يمكن تثبيت ٣ منشورات كحد أقصى");
      for (const pid of b.pinnedPosts) if (!(await db.get("SELECT 1 x FROM posts WHERE id=$1 AND author=$2 AND status='published'", [pid, u.id]))) throw E.bad("منشور غير صالح");
      set.pinned_posts = b.pinnedPosts; set.pinned = b.pinnedPosts[0] || null;
    }
    const keys = Object.keys(set); if (!keys.length) return { ok: true };
    await db.run(`UPDATE users SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")} WHERE id=$${keys.length + 1}`, [...keys.map(k => set[k]), u.id]);
    ctx.cache.del("card:"); ctx.bus.emit("PROFILE_UPDATED", { user: u.id });
    return fullProfile(u, u.handle);
  }));
  R.post("/api/profile/image", A(async (req) => {
    if (!rl.hit("upload", req.user.id)) throw E.rate();
    const kind = req.query.kind === "cover" ? "cover" : "avatar";
    if (!req.rawBody?.length || req.rawBody.length > 10 * 1024 * 1024) throw E.bad("الصورة أكبر من ١٠ ميغابايت");
    let out; try { out = await IMG.process(req.rawBody, kind); } catch (e) { throw E.bad("صيغة الصورة غير مدعومة"); }
    const urls = {};
    for (const [w, buf] of Object.entries(out.variants)) { const key = IMG.key(req.user.id, kind, w); await storage.put(key, buf, "image/webp"); urls[w] = storage.publicUrl(key); }
    if (kind === "avatar") await db.run("UPDATE users SET avatar=$1, avatar_hash=$2 WHERE id=$3", [urls, out.ahash, req.user.id]);
    else await db.run("UPDATE users SET cover=$1 WHERE id=$2", [urls, req.user.id]);
    ctx.cache.del("card:"); ctx.bus.emit("PROFILE_UPDATED", { user: req.user.id, image: kind });
    return { [kind]: urls };
  }), { raw: true });
  R.del("/api/profile/image", A(async (req) => { const kind = req.query.kind === "cover" ? "cover" : "avatar"; await db.run(`UPDATE users SET ${kind}=NULL${kind === "avatar" ? ", avatar_hash=NULL" : ""} WHERE id=$1`, [req.user.id]); ctx.cache.del("card:"); return { ok: true }; }));

  /* ---- Privacy center ---- */
  const privacyView = async (u) => ({
    private: !!u.private, ...ctx.policy.privacyOf(u), mutedWords: u.prefs?.mutedWords || [],
    closeFriends: (await db.all("SELECT u.id, u.name, u.handle, u.avatar, u.color FROM close_friends c JOIN users u ON u.id=c.member WHERE c.owner=$1", [u.id])).map(x => ({ ...x })),
    followRequests: (await db.all("SELECT u.id, u.name, u.handle, u.avatar, u.color, r.at FROM follow_requests r JOIN users u ON u.id=r.src WHERE r.dst=$1 ORDER BY r.at DESC", [u.id])).map(x => ({ ...x }))
  });
  R.get("/api/privacy", A(async (req) => privacyView(req.user)));
  R.put("/api/privacy", A(async (req) => {
    const b = req.body, u = req.user, CH = ["everyone", "following", "nobody"];
    const privacy = { ...ctx.policy.privacyOf(u) };
    for (const k of ["dm", "mentions", "comments"]) if (b[k] !== undefined) { if (!CH.includes(b[k])) throw E.bad(); privacy[k] = b[k]; }
    if (b.filterRequests !== undefined) privacy.filterRequests = !!b.filterRequests;
    const priv = b.private !== undefined ? (b.private ? 1 : 0) : (u.private ? 1 : 0);
    await db.run("UPDATE users SET privacy=$1, private=$2 WHERE id=$3", [privacy, priv, u.id]);
    if (b.mutedWords !== undefined) {
      if (!Array.isArray(b.mutedWords) || b.mutedWords.length > 100) throw E.bad("حتى ١٠٠ كلمة");
      const prefs = { ...(u.prefs || {}), mutedWords: [...new Set(b.mutedWords.map(w => str(String(w), 40)).filter(Boolean))] };
      await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [prefs, u.id]); ctx.cache.del("feed:" + u.id);
    }
    if (u.private && !priv) { // going public approves everyone who was waiting
      const reqs = await db.all("SELECT src FROM follow_requests WHERE dst=$1", [u.id]);
      for (const r of reqs) { await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [r.src, u.id, now()]); ctx.bus.emit("USER_FOLLOWED", { from: r.src, to: u.id, actor: r.src }); }
      await db.run("DELETE FROM follow_requests WHERE dst=$1", [u.id]);
    }
    return privacyView(await db.get("SELECT * FROM users WHERE id=$1", [u.id]));
  }));
  R.put("/api/close-friends/:id", A(async (req) => { if (req.params.id === req.user.id || !(await db.get("SELECT 1 x FROM users WHERE id=$1", [req.params.id]))) throw E.bad(); await db.run("INSERT INTO close_friends(owner,member,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [req.user.id, req.params.id, now()]); return { ok: true }; }));
  R.del("/api/close-friends/:id", A(async (req) => { await db.run("DELETE FROM close_friends WHERE owner=$1 AND member=$2", [req.user.id, req.params.id]); return { ok: true }; }));
  R.get("/api/follow-requests", A(async (req) => ({ requests: (await privacyView(req.user)).followRequests })));
  R.post("/api/follow-requests/:id/:decision", A(async (req) => {
    const r = await db.run("DELETE FROM follow_requests WHERE src=$1 AND dst=$2", [req.params.id, req.user.id]); if (!r.changes) throw E.nf();
    if (req.params.decision === "approve") { await db.run("INSERT INTO follows(src,dst,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [req.params.id, req.user.id, now()]); ctx.bus.emit("USER_FOLLOWED", { from: req.params.id, to: req.user.id, actor: req.params.id }); await ctx.services.messaging.notify(req.params.id, "follow_approved", { actor: req.user.id }); }
    return { ok: true };
  }));

  /* ---- Multiple accounts (Phase 9): extra sessions live in an HttpOnly "jar" cookie ---- */
  const MAX_JAR = 5;
  const jar = (req) => String(req.cookies.mp_jar || "").split(".").filter(t => /^[A-Za-z0-9_-]{20,}$/.test(t)).slice(0, MAX_JAR);
  const setJar = (res, tokens) => res.cookie("mp_jar", tokens.slice(0, MAX_JAR).join("."), { maxAge: tokens.length ? 30 * 86400 : 0 });
  async function liveAccounts(tokens) {
    const out = []; for (const t of tokens) { const u = await db.get("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > $2 AND u.status='active'", [sha(t), now()]); if (u) out.push({ t, u }); } return out;
  }
  /* called by sessionFor before a new session replaces the cookie */
  function stashCurrent(req, res) {
    if (!req.body?.addAccount || !req.cookies.mp_session) return;
    setJar(res, [req.cookies.mp_session, ...jar(req).filter(t => t !== req.cookies.mp_session)]);
  }
  R.get("/api/auth/accounts", A(async (req) => {
    const live = await liveAccounts(jar(req));
    ctx.services.protection?.noteJar(req).catch(() => { }); // phase 33: accounts used together are linked for blocking
    return { current: users().pub(req.actor || req.user), accounts: live.filter(x => x.u.id !== (req.actor || req.user).id).map(x => users().pub(x.u)) };
  }));
  R.post("/api/auth/switch", A(async (req, res) => {
    const live = await liveAccounts(jar(req)); const target = live.find(x => x.u.id === req.body.userId); if (!target) throw E.nf("الحساب غير متصل");
    const cur = req.cookies.mp_session;
    setJar(res, [cur, ...jar(req).filter(t => t !== target.t && t !== cur)].filter(Boolean));
    res.cookie("mp_session", target.t, { maxAge: 30 * 86400 });
    ctx.services.protection?.noteJar(req).catch(() => { }); // phase 33
    return { user: users().pub(target.u) };
  }));
  R.post("/api/auth/sign-out-all", A(async (req, res) => { for (const t of [req.cookies.mp_session, ...jar(req)].filter(Boolean)) await db.run("DELETE FROM sessions WHERE token_hash=$1", [sha(t)]); setJar(res, []); res.cookie("mp_session", "", { maxAge: 0 }); return { ok: true }; }));

  return { fullProfile, completeness, stashCurrent, ACHIEVEMENT_INFO, VERIFIED_INFO };
};
