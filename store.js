/* ===== Store: entity tables + persistence + event bus =====
 * Shapes mirror future backend services (User/Post/Comment/Reaction/Follow/Community/...).
 */
const KEY = "mujtama_plus_v1";
const uid = (p = "id") => p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const now = () => new Date().toISOString();
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();

/* --- Event bus (services subscribe instead of calling each other) --- */
const Bus = {
  subs: {},
  on(evt, fn) { (this.subs[evt] ||= []).push(fn); },
  emit(evt, payload) { (this.subs[evt] || []).forEach(f => f(payload)); (this.subs["*"] || []).forEach(f => f(evt, payload)); }
};

const REACTIONS = [
  { key: "like", icon: "❤️", label: "إعجاب" },
  { key: "support", icon: "👏", label: "دعم" },
  { key: "haha", icon: "😂", label: "ضحك" },
  { key: "useful", icon: "💡", label: "مفيد" }
]; // extensible: add a row, no schema change

const TOPICS = [
  { slug: "ai", name: "الذكاء الاصطناعي" }, { slug: "dev", name: "البرمجة" },
  { slug: "startups", name: "الشركات الناشئة" }, { slug: "invest", name: "الاستثمار" },
  { slug: "pi", name: "Pi Network" }, { slug: "design", name: "التصميم" },
  { slug: "games", name: "الألعاب" }, { slug: "learn", name: "التعلم" }
];
const COLORS = ["#5b2bd6", "#e0559b", "#1f9d8b", "#e88b2a", "#3478f6", "#9b51e0", "#2fa84f", "#d6453a", "#00a3c4", "#7a5af8"];

function seed() {
  const U = (id, name, handle, bio, topics, badge) => ({ id, name, handle, bio, topics, badge, color: COLORS[parseInt(id.slice(1)) % COLORS.length], joinedAt: ago(800), creator: !!badge });
  const users = [
    U("u0", "أنت", "me", "عضو في مجتمع بلس", [], null),
    U("u1", "سارة القحطاني", "sara_ai", "باحثة في الذكاء الاصطناعي 🤖", ["ai", "learn"], "خبيرة"),
    U("u2", "فهد العتيبي", "fahad_dev", "مطوّر Full-stack | أحب الكود النظيف", ["dev", "ai"], "مطوّر"),
    U("u3", "نورة الشهري", "noura_design", "مصممة واجهات وتجربة مستخدم", ["design", "startups"], null),
    U("u4", "عبدالله الزهراني", "abdullah_vc", "مستثمر ملائكي في الشركات الناشئة", ["invest", "startups"], "مستثمر"),
    U("u5", "ريم الغامدي", "reem_pi", "رائدة في مجتمع Pi 🟣", ["pi", "invest"], "مؤسسة مجتمع"),
    U("u6", "خالد المطيري", "khaled_games", "صانع محتوى ألعاب 🎮", ["games"], null),
    U("u7", "Lina Haddad", "lina_h", "Product manager · Dubai", ["startups", "design"], null),
    U("u8", "عمر السبيعي", "omar_learn", "أكتب عن التعلم الذاتي", ["learn", "dev"], null),
    U("u9", "هيا الدوسري", "haya_build", "أبني مشروعي الأول 🚀", ["startups", "pi"], null)
  ];
  const P = (id, author, h, text, topic, extra = {}) => ({
    id, author, type: "post", text, topic, createdAt: ago(h), updatedAt: null, edited: false,
    visibility: "public", status: "published", community: null, media: null, poll: null,
    quoteOf: null, repostOf: null, title: null, views: Math.floor(50 + Math.random() * 900), ...extra
  });
  const posts = [
    P("p1", "u1", 1, "النماذج اللغوية الصغيرة صارت تنافس الكبيرة في مهام محددة. السر في جودة البيانات وليس حجم النموذج. #ذكاء_اصطناعي", "ai"),
    P("p2", "u2", 2, "نصيحة لكل مطور مبتدئ: اكتب كودك كأن الشخص اللي بيصونه بعدك يعرف عنوان بيتك 😅 #برمجة", "dev"),
    P("p3", "u5", 3, "ما أكثر شيء تنتظرونه في منظومة Pi خلال الفترة القادمة؟", "pi", { type: "poll", poll: { options: [{ t: "تطبيقات أكثر", v: 41 }, { t: "تجارة إلكترونية", v: 28 }, { t: "أدوات للمطورين", v: 19 }], voters: {}, multi: false } }),
    P("p4", "u3", 4, "التصميم الجيد غير مرئي. إذا لاحظ المستخدم الواجهة فغالباً فيه مشكلة. #تصميم", "design", { media: "linear-gradient(135deg,#ffb88c,#de6262)" }),
    P("p5", "u4", 5, "ثلاثة أشياء أبحث عنها قبل الاستثمار في أي شركة ناشئة:\n1. فريق يفهم المشكلة بعمق\n2. سوق ينمو\n3. دليل أن العملاء يدفعون فعلاً\n#استثمار #شركات_ناشئة", "invest"),
    P("p6", "u8", 6, "ما أفضل طريقة لتعلم Python من الصفر في ٢٠٢٦؟", "learn", { type: "question", acceptedAnswer: null }),
    P("p7", "u6", 7, "جربت اللعبة الجديدة طوال الليل… القصة أقوى من الرسوميات بمراحل 🎮 #ألعاب", "games", { media: "linear-gradient(135deg,#43cea2,#185a9d)" }),
    P("p8", "u1", 9, "", "ai", { type: "article", title: "دليل مبسط: كيف تتعلم الآلة؟", text: "تعلم الآلة هو أن نعطي الحاسوب أمثلة بدل الأوامر.\n\nأولاً: البيانات\nكل نموذج يبدأ ببيانات نظيفة ومتنوعة.\n\nثانياً: التدريب\nيحاول النموذج التنبؤ ثم يصحح أخطاءه آلاف المرات.\n\nثالثاً: التقييم\nنختبره على بيانات لم يرها من قبل. #ذكاء_اصطناعي", media: "linear-gradient(135deg,#667eea,#764ba2)" }),
    P("p9", "u7", 10, "Shipping fast is good, but shipping the right thing is better. Talk to 10 users before writing code. #startups", "startups"),
    P("p10", "u9", 12, "اليوم أطلقت أول نسخة تجريبية من مشروعي على Pi Browser 🎉 شكراً لكل من دعمني @reem_pi #PiNetwork", "pi"),
    P("p11", "u2", 14, "", "dev", { quoteOf: "p2", text: "وأضيف: اكتب اختبارات قبل ما تحتاجها، مو بعدها." }),
    P("p12", "u5", 16, "", "pi", { repostOf: "p10", text: "" }),
    P("p13", "u3", 18, "أي خط عربي تفضلون للواجهات؟ أنا متحيزة للخطوط الهندسية البسيطة. #تصميم", "design"),
    P("p14", "u4", 20, "السوق السعودي فيه فرص ضخمة في التقنية المالية. من يبني شيئاً هنا؟ #استثمار", "invest"),
    P("p15", "u8", 22, "ما الشيء الذي تعلمته اليوم؟ أنا تعلمت أن المراجعة المتباعدة تضاعف الحفظ. #تعلم", "learn"),
    P("p16", "u1", 26, "الترجمة الآلية للعربية تحسنت كثيراً، لكن اللهجات ما زالت تحدياً. #ذكاء_اصطناعي", "ai"),
    P("p17", "u6", 30, "أفضل لعبة مستقلة لعبتها هذه السنة؟ اقترحوا 👇 #ألعاب", "games"),
    P("p18", "u2", 34, "React أو Vue لمشروع جديد؟ أنا شخصياً أختار الأبسط لفريقك. #برمجة", "dev"),
    P("p19", "u9", 40, "١/٣ سأشارككم رحلة بناء مشروعي من الفكرة إلى الإطلاق في ثلاثة أجزاء. #شركات_ناشئة", "startups"),
    P("p20", "u7", 46, "Good onboarding = fewer support tickets. Every screen should answer: what now? #design", "design"),
    P("p21", "u5", 50, "تذكير: لا تشاركوا عبارة المرور الخاصة بمحفظتكم مع أي شخص أبداً 🔒 #PiNetwork", "pi"),
    P("p22", "u4", 60, "قراءة اليوم: لماذا تفشل ٩٠٪ من الشركات الناشئة؟ غالباً لأنها تبني شيئاً لا يحتاجه أحد.", "startups")
  ];
  const C = (id, post, author, h, text, parent = null) => ({ id, post, author, text, parent, createdAt: ago(h), status: "published" });
  const comments = [
    C("c1", "p6", "u2", 5, "ابدأ بمشروع صغير يحل مشكلة عندك، وتعلم أثناء البناء."),
    C("c2", "p6", "u1", 5, "كتاب Automate the Boring Stuff ممتاز للبداية."),
    C("c3", "p6", "u8", 4, "شكراً! هل أبدأ به قبل الدورات؟", "c2"),
    C("c4", "p6", "u1", 4, "نعم، ثم انتقل لمشاريع حقيقية.", "c3"),
    C("c5", "p1", "u2", 0.8, "متفق، جودة البيانات أهم من كل شيء."),
    C("c6", "p10", "u5", 11, "مبروك يا هيا! 💜"),
    C("c7", "p5", "u9", 4, "النقطة الثالثة هي الأصعب للمشاريع الجديدة.")
  ];
  const communities = [
    { id: "m1", name: "مطورو مجتمع بلس", desc: "كل ما يخص البرمجة والتطوير", topic: "dev", type: "public", color: "linear-gradient(135deg,#3478f6,#5b2bd6)", owner: "u2", rules: ["احترم الجميع", "لا إعلانات بدون إذن"], requireApproval: false, createdAt: ago(900) },
    { id: "m2", name: "رواد Pi", desc: "مجتمع لبناة ومستخدمي Pi Network", topic: "pi", type: "public", color: "linear-gradient(135deg,#9b51e0,#e0559b)", owner: "u5", rules: ["لا مشاركة لعبارات المرور", "لا وعود ربح"], requireApproval: false, createdAt: ago(700) },
    { id: "m3", name: "مستثمرون ملائكيون", desc: "نقاشات الاستثمار المبكر", topic: "invest", type: "private", color: "linear-gradient(135deg,#1f9d8b,#2fa84f)", owner: "u4", rules: ["سرية النقاشات"], requireApproval: true, createdAt: ago(600) },
    { id: "m4", name: "مصممو العرب", desc: "واجهات، هوية، وتجربة مستخدم", topic: "design", type: "public", color: "linear-gradient(135deg,#e88b2a,#d6453a)", owner: "u3", rules: ["انسب العمل لصاحبه"], requireApproval: false, createdAt: ago(500) }
  ];
  posts.find(p => p.id === "p21").community = "m2";
  posts.find(p => p.id === "p18").community = "m1";
  const memberships = [
    ["m1", "u2", "owner"], ["m1", "u8", "member"], ["m1", "u1", "moderator"], ["m2", "u5", "owner"], ["m2", "u9", "member"],
    ["m3", "u4", "owner"], ["m4", "u3", "owner"], ["m4", "u7", "member"]
  ].map(([community, user, role]) => ({ community, user, role, joinedAt: ago(300) }));
  const follows = [["u1", "u2"], ["u2", "u1"], ["u9", "u5"], ["u5", "u9"], ["u3", "u7"], ["u8", "u1"]].map(([a, b]) => ({ from: a, to: b, at: ago(200) }));
  const reactions = [];
  const rnd = (n) => Math.floor(Math.random() * n);
  posts.forEach(p => { const n = rnd(9); for (let i = 0; i < n; i++) { const u = "u" + (1 + rnd(9)); if (u !== p.author && !reactions.find(r => r.target === p.id && r.user === u)) reactions.push({ target: p.id, user: u, type: REACTIONS[rnd(4)].key, at: p.createdAt }); } });
  const conversations = [{ id: "cv1", members: ["u0", "u5"], updatedAt: ago(3) }];
  const messages = [{ id: "ms1", conv: "cv1", from: "u5", text: "أهلاً بك في مجتمع بلس! 💜 إذا احتجت أي شيء عن Pi اسألني.", at: ago(3), read: false }];
  return {
    me: "u0", onboarded: false, users, posts, comments, communities, memberships, follows, reactions,
    notifications: [], conversations, messages, collections: [{ id: "col1", name: "لاحقاً", items: [] }, { id: "col2", name: "تعلم", items: [] }, { id: "col3", name: "أفكار", items: [] }],
    drafts: [], muted: { users: [], topics: [], posts: [] }, blocked: [], reports: [], interests: [], history: [], audit: []
  };
}

/* --- Persistence (localStorage with in-memory fallback) --- */
let DB;
function load() { try { const s = localStorage.getItem(KEY); DB = s ? JSON.parse(s) : seed(); } catch (e) { DB = seed(); } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { /* memory only */ } }
function resetDemo() { DB = seed(); save(); }
load();

/* --- Selectors --- */
const S = {
  user: (id) => DB.users.find(u => u.id === id),
  byHandle: (h) => DB.users.find(u => u.handle === h),
  me: () => S.user(DB.me),
  post: (id) => DB.posts.find(p => p.id === id),
  topic: (slug) => TOPICS.find(t => t.slug === slug),
  community: (id) => DB.communities.find(c => c.id === id),
  reactionsOf: (t) => DB.reactions.filter(r => r.target === t),
  myReaction: (t) => DB.reactions.find(r => r.target === t && r.user === DB.me),
  commentsOf: (pid) => DB.comments.filter(c => c.post === pid && c.status === "published"),
  follows: (a, b) => DB.follows.some(f => f.from === a && f.to === b),
  followers: (u) => DB.follows.filter(f => f.to === u).map(f => f.from),
  following: (u) => DB.follows.filter(f => f.from === u).map(f => f.to),
  membership: (c, u = DB.me) => DB.memberships.find(m => m.community === c && m.user === u),
  members: (c) => DB.memberships.filter(m => m.community === c && !["pending", "banned"].includes(m.role)),
  saved: (pid) => DB.collections.some(c => c.items.includes(pid)),
  repostsOf: (pid) => DB.posts.filter(p => p.repostOf === pid && p.status === "published").length,
  visiblePosts: () => DB.posts.filter(p => p.status === "published" && !DB.blocked.includes(p.author) && (p.visibility === "public" || p.author === DB.me || (p.visibility === "followers" && S.follows(DB.me, p.author)))),
  hashtags: (text = "") => (text.match(/#[\p{L}\p{N}_]+/gu) || []).map(h => normalizeTag(h))
};
// Smart hashtags: normalize so #ذكاء_اصطناعي / #الذكاء_الاصطناعي / #AI map consistently
function normalizeTag(h) { return h.replace("#", "").replace(/^ال/, "").toLowerCase(); }

/* --- Rate limiting (anti-abuse) --- */
const Rate = { log: {}, ok(action, max, ms) { const t = Date.now(); const a = (this.log[action] ||= []).filter(x => t - x < ms); if (a.length >= max) return false; a.push(t); this.log[action] = a; return true; } };

/* --- Commands (write side). Each emits a domain event --- */
const Cmd = {
  createPost(data) {
    if (!Rate.ok("post", 5, 60e3)) return { error: "تمهّل قليلاً، نشرت كثيراً خلال دقيقة" };
    const dup = DB.posts.find(p => p.author === DB.me && p.text && p.text === data.text && Date.now() - new Date(p.createdAt) < 864e5);
    if (dup) return { error: "نشرت نفس المحتوى مؤخراً" };
    const p = { id: uid("p"), author: DB.me, type: "post", text: "", topic: null, createdAt: now(), updatedAt: null, edited: false, visibility: "public", status: "published", community: null, media: null, poll: null, quoteOf: null, repostOf: null, title: null, views: 0, ...data };
    const comm = p.community && S.community(p.community);
    if (comm && comm.requireApproval && !["owner", "admin", "moderator"].includes(S.membership(comm.id)?.role)) p.status = "pending";
    DB.posts.unshift(p); save(); Bus.emit("POST_CREATED", p); return { post: p };
  },
  editPost(id, text) { const p = S.post(id); p.history = [...(p.history || []), { text: p.text, at: p.updatedAt || p.createdAt }]; p.text = text; p.edited = true; p.updatedAt = now(); save(); Bus.emit("POST_UPDATED", p); },
  deletePost(id) { const p = S.post(id); p.status = "deleted"; save(); Bus.emit("POST_DELETED", p); },
  react(target, type, owner) {
    const ex = S.myReaction(target);
    if (ex && ex.type === type) DB.reactions = DB.reactions.filter(r => r !== ex);
    else if (ex) ex.type = type;
    else { DB.reactions.push({ target, user: DB.me, type, at: now() }); Bus.emit("POST_REACTED", { target, owner, type }); }
    save();
  },
  comment(post, text, parent = null) {
    if (!Rate.ok("comment", 10, 60e3)) return { error: "تمهّل قليلاً" };
    const c = { id: uid("c"), post, author: DB.me, text, parent, createdAt: now(), status: "published" };
    DB.comments.push(c); save(); Bus.emit("COMMENT_CREATED", c); return { comment: c };
  },
  toggleFollow(to) {
    if (S.follows(DB.me, to)) DB.follows = DB.follows.filter(f => !(f.from === DB.me && f.to === to));
    else { DB.follows.push({ from: DB.me, to, at: now() }); Bus.emit("USER_FOLLOWED", { from: DB.me, to }); }
    save();
  },
  toggleJoin(cid) {
    const m = S.membership(cid); const c = S.community(cid);
    if (m && m.role !== "owner") DB.memberships = DB.memberships.filter(x => x !== m);
    else if (!m) { DB.memberships.push({ community: cid, user: DB.me, role: c.type === "private" ? "pending" : "member", joinedAt: now() }); Bus.emit("COMMUNITY_JOINED", { cid, owner: c.owner }); }
    save();
  },
  createCommunity(d) { const c = { id: uid("m"), owner: DB.me, createdAt: now(), rules: [], requireApproval: false, color: `linear-gradient(135deg,${COLORS[Math.floor(Math.random() * 10)]},#c04cf0)`, ...d }; DB.communities.push(c); DB.memberships.push({ community: c.id, user: DB.me, role: "owner", joinedAt: now() }); save(); Bus.emit("COMMUNITY_CREATED", c); return c; },
  vote(pid, i) { const p = S.post(pid); if (p.poll.voters[DB.me] !== undefined) return; p.poll.voters[DB.me] = i; p.poll.options[i].v++; save(); },
  save(pid, colId) { DB.collections.forEach(c => c.items = c.items.filter(x => x !== pid)); if (colId) DB.collections.find(c => c.id === colId).items.unshift(pid); save(); },
  notInterested(pid) { DB.muted.posts.push(pid); const p = S.post(pid); if (p.topic) DB.interestWeights = { ...(DB.interestWeights || {}), [p.topic]: ((DB.interestWeights || {})[p.topic] || 0) - 1 }; save(); },
  mute(kind, val) { if (!DB.muted[kind].includes(val)) DB.muted[kind].push(val); save(); },
  block(u) { if (!DB.blocked.includes(u)) DB.blocked.push(u); DB.follows = DB.follows.filter(f => !((f.from === DB.me && f.to === u) || (f.from === u && f.to === DB.me))); save(); },
  report(target, kind, reason) { if (!Rate.ok("report", 5, 60e3)) return; const r = { id: uid("r"), target, kind, reason, by: DB.me, at: now(), status: "open" }; DB.reports.push(r); DB.audit.push({ action: "REPORT_CREATED", target, reason, by: DB.me, at: now() }); save(); Bus.emit("REPORT_CREATED", r); },
  sendMessage(conv, text) { DB.messages.push({ id: uid("ms"), conv, from: DB.me, text, at: now(), read: true }); const c = DB.conversations.find(x => x.id === conv); c.updatedAt = now(); save(); },
  openConversation(u) { let c = DB.conversations.find(x => x.members.includes(u) && x.members.includes(DB.me)); if (!c) { c = { id: uid("cv"), members: [DB.me, u], updatedAt: now() }; DB.conversations.push(c); save(); } return c; },
  saveDraft(d) { if (!d.text && !d.title) return; d.id ||= uid("d"); d.at = now(); DB.drafts = [d, ...DB.drafts.filter(x => x.id !== d.id)].slice(0, 20); save(); },
  view(pid) { const p = S.post(pid); if (!p) return; p.views++; DB.history = [pid, ...DB.history.filter(x => x !== pid)].slice(0, 100); save(); }
};

/* --- Notification service: listens to events (decoupled) --- */
function notify(user, kind, data) { if (user === DB.me && data.actor === DB.me) return; DB.notifications.unshift({ id: uid("n"), user, kind, ...data, at: now(), read: false }); save(); }
Bus.on("POST_REACTED", e => e.owner === DB.me ? null : null); // others' activity would notify them server-side
Bus.on("COMMENT_CREATED", c => { const p = S.post(c.post); if (p && p.author !== DB.me) { /* server would notify p.author */ } });
// Demo: simulate others reacting to your posts so the notifications system is visible
Bus.on("POST_CREATED", p => {
  if (p.author !== DB.me || window.REMOTE) return; // offline demo only
  setTimeout(() => { const u = "u" + (1 + Math.floor(Math.random() * 9)); DB.reactions.push({ target: p.id, user: u, type: "like", at: now() }); notify(DB.me, "reaction", { actor: u, post: p.id }); window.App && App.refreshBadges(); }, 4000);
  setTimeout(() => { const u = "u" + (1 + Math.floor(Math.random() * 9)); DB.comments.push({ id: uid("c"), post: p.id, author: u, text: "فكرة جميلة 👏", parent: null, createdAt: now(), status: "published" }); notify(DB.me, "comment", { actor: u, post: p.id }); window.App && App.refreshBadges(); }, 9000);
});
Bus.on("USER_FOLLOWED", e => { if (Math.random() < .5) setTimeout(() => { DB.follows.push({ from: e.to, to: DB.me, at: now() }); notify(DB.me, "follow", { actor: e.to }); window.App && App.refreshBadges(); }, 5000); });
if (!DB.notifications.length) { DB.notifications.push({ id: uid("n"), user: "u0", kind: "welcome", actor: "u5", at: now(), read: false }); save(); }
