/* Transparency & compliance domain logic (Phase 34), pure and unit-tested:
 * • DATA_MAP: every table that holds personal data — what it is, why we process it (purpose + lawful basis),
 *   how long we keep it and how the user's rows are found. One map drives the data export, the account
 *   erasure, the processing register (سجل أنشطة المعالجة) and the retention policy, so they cannot drift apart.
 * • PURPOSES: processing purposes and whether each rests on consent (withdrawable) or on necessity.
 * • RETENTION: per-data-type retention rules (days, action, batching key); media blobs are opt-in only.
 * • periods (monthly / quarterly), small-count suppression, medians, deadlines (DSR 30 days, breach 72 h),
 *   the reporter's report timeline, and a dependency-free ZIP (store) writer for data exports.
 * Engineering support for PDPL obligations, not legal advice: see docs/COMPLIANCE.md. */
const zlib = require("node:zlib");

const DAY = 864e5;

/* ---------- processing purposes (PDPL: purpose limitation; consent only where consent is the basis) ---------- */
/** basis: "contract" (necessary to provide the service) · "legal" (legal obligation) · "legitimate" (legitimate interest) · "consent" */
const PURPOSES = {
  service: {
    label: "تقديم الخدمة وتشغيل حسابك",
    basis: "contract",
    required: true,
    descr: "إنشاء الحساب، عرض منشوراتك لمن تختار، الرسائل، الإشعارات الأساسية."
  },
  security: { label: "حماية الحسابات ومنع الإساءة", basis: "legitimate", required: true, descr: "الجلسات والأجهزة، كشف الاحتيال والسبام، سجل التدقيق." },
  moderation: {
    label: "الإشراف والسلامة",
    basis: "legitimate",
    required: true,
    descr: "مراجعة البلاغات، قرارات الإشراف، الاستئناف، تقرير الشفافية (أرقام مجمّعة فقط)."
  },
  legal: {
    label: "الالتزامات النظامية",
    basis: "legal",
    required: true,
    descr: "حفظ ما تفرضه الأنظمة، الاستجابة لطلبات الجهات المختصة وفق النظام، سجل حوادث تسرّب البيانات."
  },
  personalization: {
    label: "تخصيص الخلاصة والاقتراحات",
    basis: "consent",
    required: false,
    default: true,
    descr: "استخدام تفاعلاتك واهتماماتك لترتيب ما تراه. بدونها تبقى الخلاصة زمنية وعامة."
  },
  analytics: {
    label: "إحصاءات الاستخدام لتحسين التطبيق",
    basis: "consent",
    required: false,
    default: true,
    descr: "أحداث استخدام مجمّعة دون محتوى الرسائل أو عناوين IP."
  },
  marketing_email: {
    label: "رسائل بريدية تعريفية وملخّصات",
    basis: "consent",
    required: false,
    default: false,
    descr: "الملخّص الأسبوعي والأخبار. يمكن إلغاؤها في أي وقت ومجاناً."
  }
};
const BASIS_LABEL = { contract: "ضرورية لتقديم الخدمة", legal: "التزام نظامي", legitimate: "مصلحة مشروعة", consent: "موافقتك" };
const CONSENT_VERSION = "2026-10";

/* ---------- data map ----------
 * t: table · user: how the user's rows are selected (SQL fragment with $1 = user id) · cols: exported columns (null = all minus secret)
 * secret: columns never exported · purpose · category (Arabic) · retention (Arabic, human) · erase: what erasure does
 * ("delete" rows, "scrub" content, "keep" pseudonymous id only, "anon" the users row itself) · export: false to skip in exports */
const SECRET_COLS = [
  "password_hash",
  "token_hash",
  "secret",
  "backup_codes",
  "p256dh",
  "auth",
  "public_key",
  "session_sid",
  "session_seen",
  "code",
  "avatar_hash"
];
const DATA_MAP = [
  {
    t: "users",
    user: "id=$1",
    purpose: "service",
    category: "بيانات الحساب والملف الشخصي",
    retention: "طوال وجود الحساب؛ عند الحذف تُمحى وتبقى هوية مجهولة",
    erase: "anon"
  },
  { t: "posts", user: "author=$1", purpose: "service", category: "المنشورات والمقالات والقصص", retention: "حتى تحذفها أو تحذف حسابك", erase: "scrub" },
  {
    t: "post_versions",
    user: "post_id IN (SELECT id FROM posts WHERE author=$1)",
    purpose: "service",
    category: "سجل تعديلات منشوراتك",
    retention: "مع المنشور",
    erase: "delete"
  },
  { t: "comments", user: "author=$1", purpose: "service", category: "التعليقات", retention: "حتى تحذفها أو تحذف حسابك", erase: "scrub" },
  {
    t: "messages",
    user: "sender=$1",
    cols: ["id", "conv", "kind", "text", "reply_to", "created_at", "read_at", "deleted_at", "expires_at"],
    purpose: "service",
    category: "رسائلك المرسلة (المشفّرة تُصدَّر كما هي)",
    retention: "حتى تحذفها أو تنتهي مدتها أو تحذف حسابك",
    erase: "scrub"
  },
  {
    t: "conversation_members",
    user: "user_id=$1",
    cols: ["conv", "role", "state", "joined_at", "last_read_at"],
    purpose: "service",
    category: "عضوية المحادثات",
    retention: "طوال وجود الحساب",
    erase: "keep"
  },
  { t: "reactions", user: "user_id=$1", purpose: "service", category: "الإعجابات والتفاعلات", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "follows", user: "src=$1 OR dst=$1", purpose: "service", category: "المتابَعون والمتابِعون", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "follow_requests", user: "src=$1 OR dst=$1", purpose: "service", category: "طلبات المتابعة", retention: "حتى القبول أو الرفض", erase: "delete" },
  { t: "close_friends", user: "owner=$1 OR member=$1", purpose: "service", category: "قائمة المقرّبين", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "memberships", user: "user_id=$1", purpose: "service", category: "عضوية المجتمعات", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "poll_votes", user: "user_id=$1", purpose: "service", category: "أصواتك في الاستطلاعات", retention: "مع الاستطلاع", erase: "delete" },
  { t: "stance_votes", user: "user_id=$1", purpose: "service", category: "مواقفك في النقاشات", retention: "مع النقاش", erase: "delete" },
  { t: "event_rsvps", user: "user_id=$1", purpose: "service", category: "حضور الأحداث", retention: "مع الحدث", erase: "delete" },
  { t: "event_tickets", user: "user_id=$1", purpose: "service", category: "تذاكر الأحداث", retention: "مع الحدث", erase: "delete" },
  {
    t: "media",
    user: "owner=$1",
    cols: ["id", "kind", "mime", "size", "storage_key", "status", "created_at"],
    purpose: "service",
    category: "الصور والفيديو التي رفعتها",
    retention: "حتى تحذفها أو تحذف حسابك (الملفات نفسها تُحذف فقط إذا فُعّل ذلك صراحةً)",
    erase: "scrub"
  },
  { t: "drafts", user: "user_id=$1", purpose: "service", category: "المسودات", retention: "حتى تنشرها أو تحذفها", erase: "delete" },
  { t: "post_templates", user: "user_id=$1", purpose: "service", category: "قوالب المنشورات", retention: "حتى تحذفها", erase: "delete" },
  { t: "collections", user: "owner=$1", purpose: "service", category: "المجموعات والمحفوظات", retention: "حتى تحذفها", erase: "delete" },
  {
    t: "collection_items",
    user: "collection IN (SELECT id FROM collections WHERE owner=$1)",
    purpose: "service",
    category: "عناصر المحفوظات",
    retention: "مع المجموعة",
    erase: "delete"
  },
  { t: "people_lists", user: "owner=$1", purpose: "service", category: "قوائم الأشخاص", retention: "حتى تحذفها", erase: "delete" },
  {
    t: "people_list_members",
    user: "user_id=$1",
    purpose: "service",
    category: "ظهورك في قوائم الآخرين",
    retention: "حتى يزيلك صاحب القائمة",
    erase: "delete"
  },
  { t: "topic_follows", user: "user_id=$1", purpose: "personalization", category: "المواضيع التي تتابعها", retention: "حتى تلغي المتابعة", erase: "delete" },
  { t: "feed_prefs", user: "user_id=$1", purpose: "personalization", category: "تفضيلات الخلاصة", retention: "طوال وجود الحساب", erase: "delete" },
  {
    t: "feed_feedback",
    user: "user_id=$1",
    purpose: "personalization",
    category: "ملاحظاتك على الخلاصة («لا يهمني»)",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "engagement_signals",
    user: "user_id=$1",
    purpose: "personalization",
    category: "إشارات التفاعل لترتيب الخلاصة",
    retention: "365 يوماً",
    erase: "delete"
  },
  { t: "clip_watch", user: "user_id=$1", cols: ["post_id", "watched_ms", "completed", "updated_at", "src", "first_at"], purpose: "personalization", category: "تقدّم مشاهدتك للّقطات (لترتيب خلاصة اللقطات وعدم تكرار ما أكملته)", retention: "حتى تحذف حسابك", erase: "delete" }, // v2.70 (070)
  { t: "clip_drafts", user: "user_id=$1", cols: ["id", "media_id", "caption", "cover_pos", "link", "publish_at", "created_at", "updated_at"], purpose: "service", category: "مسودات فيديوتك (مقاطع رفعتها ولم تنشرها بعد)", retention: "حتى تنشرها أو تحذفها أو تحذف حسابك", erase: "delete" }, // v2.80 (078)
  { t: "search_history", user: "user_id=$1", purpose: "personalization", category: "سجل البحث", retention: "180 يوماً أو حتى تمسحه", erase: "delete" },
  { t: "saved_searches", user: "user_id=$1", purpose: "service", category: "عمليات البحث المحفوظة", retention: "حتى تحذفها", erase: "delete" },
  {
    t: "notifications",
    user: "user_id=$1",
    cols: ["id", "kind", "actor", "post", "ref", "read", "created_at"],
    purpose: "service",
    category: "الإشعارات",
    retention: "المقروءة 180 يوماً، وكلها 365 يوماً",
    erase: "delete"
  },
  { t: "notify_settings", user: "user_id=$1", purpose: "service", category: "إعدادات الإشعارات", retention: "طوال وجود الحساب", erase: "delete" },
  {
    t: "push_subscriptions",
    user: "user_id=$1",
    cols: ["id", "ua", "created_at", "last_ok_at"],
    purpose: "service",
    category: "أجهزة الإشعارات الفورية",
    retention: "حتى تلغيها أو تتعطل",
    erase: "delete"
  },
  { t: "digest_settings", user: "user_id=$1", purpose: "marketing_email", category: "إعدادات الملخص البريدي", retention: "طوال وجود الحساب", erase: "delete" },
  {
    t: "email_log",
    user: "user_id=$1",
    cols: ["id", "kind", "subject", "status", "created_at"],
    purpose: "service",
    category: "سجل الرسائل البريدية المرسلة إليك",
    retention: "365 يوماً",
    erase: "delete"
  },
  {
    t: "sessions",
    user: "user_id=$1",
    cols: ["ip", "ua", "created_at", "last_seen", "expires_at"],
    purpose: "security",
    category: "الجلسات (الجهاز وعنوان IP)",
    retention: "حتى انتهاء الجلسة (30 يوماً)",
    erase: "delete"
  },
  { t: "known_devices", user: "user_id=$1", purpose: "security", category: "الأجهزة المعروفة", retention: "400 يوم من آخر استخدام", erase: "delete" },
  {
    t: "passkeys",
    user: "user_id=$1",
    cols: ["id", "name", "created_at", "last_used_at"],
    purpose: "security",
    category: "مفاتيح المرور",
    retention: "حتى تحذفها",
    erase: "delete"
  },
  {
    t: "user_2fa",
    user: "user_id=$1",
    cols: ["enabled", "created_at"],
    purpose: "security",
    category: "التحقق بخطوتين (الحالة فقط)",
    retention: "حتى توقفه",
    erase: "delete"
  },
  {
    t: "device_keys",
    user: "user_id=$1",
    cols: ["id", "name", "created_at", "last_seen", "revoked_at"],
    purpose: "security",
    category: "مفاتيح التشفير بين الطرفين (العامة فقط)",
    retention: "حتى تلغيها",
    erase: "delete"
  },
  {
    t: "key_verifications",
    user: "user_id=$1",
    purpose: "security",
    category: "التحقق من مفاتيح جهات الاتصال",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "email_tokens",
    user: "user_id=$1",
    export: false,
    purpose: "security",
    category: "رموز التحقق البريدية (مُجزّأة)",
    retention: "30 يوماً بعد الانتهاء",
    erase: "delete"
  },
  { t: "onboarding", user: "user_id=$1", purpose: "service", category: "حالة الجولة التعريفية", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "achievements", user: "user_id=$1", purpose: "service", category: "الشارات", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "user_reputation", user: "user_id=$1", purpose: "moderation", category: "السمعة المحسوبة", retention: "تُعاد حسابها دورياً", erase: "delete" },
  {
    t: "verification_requests",
    user: "user_id=$1",
    cols: ["id", "kind", "note", "status", "reason", "decided_at", "created_at"],
    purpose: "service",
    category: "طلبات التوثيق",
    retention: "مع الحساب",
    erase: "delete"
  },
  { t: "org_members", user: "user_id=$1", purpose: "service", category: "عضوية فرق المؤسسات", retention: "حتى تغادر الفريق", erase: "delete" },
  {
    t: "experiment_exposures",
    user: "user_id=$1",
    purpose: "analytics",
    category: "تجارب الواجهة التي شاركت فيها",
    retention: "حتى انتهاء التجربة",
    erase: "delete"
  },
  {
    t: "analytics_events",
    user: "user_id=$1",
    cols: ["name", "props", "at"],
    purpose: "analytics",
    category: "أحداث الاستخدام",
    retention: "395 يوماً",
    erase: "delete"
  },
  {
    t: "post_views",
    user: "user_id=$1",
    cols: ["post", "source", "at"],
    purpose: "analytics",
    category: "مشاهدات المنشورات",
    retention: "180 يوماً",
    erase: "delete"
  },
  { t: "video_qoe", user: "user_id=$1", cols: ["post_id", "source", "startup_ms", "stalls", "stall_ms", "watched_ms", "rung", "created_at"], purpose: "analytics", category: "قياسات جودة تشغيل الفيديو (زمن البدء والتقطّع ومدة المشاهدة، دون عنوان IP أو بيانات الجهاز)", retention: "30 يوماً", erase: "delete" }, // v2.70 (071)
  {
    t: "reports",
    user: "by_user=$1",
    cols: ["id", "target", "kind", "reason", "status", "created_at", "resolved_at"],
    purpose: "moderation",
    category: "البلاغات التي قدّمتها",
    retention: "سنتان بعد البتّ ثم تُفصل عن هويتك",
    erase: "keep"
  },
  {
    t: "decisions",
    user: "user_id=$1",
    purpose: "moderation",
    category: "قرارات الإشراف على حسابك ومحتواك",
    retention: "طوال وجود الحساب + للإحصاء المجمّع",
    erase: "keep"
  },
  { t: "appeals", user: "by_user=$1", purpose: "moderation", category: "استئنافاتك", retention: "مع القرار", erase: "keep" },
  {
    t: "mod_actions",
    user: "target_user=$1",
    cols: ["id", "community", "action", "reason", "created_at"],
    purpose: "moderation",
    category: "إجراءات مشرفي المجتمعات بحقك",
    retention: "مع المجتمع",
    erase: "keep"
  },
  { t: "pi_payments", user: "user_id=$1", purpose: "legal", category: "مدفوعات Pi", retention: "حسب الأنظمة المالية", erase: "keep" },
  { t: "pi_transactions", user: "user_id=$1", purpose: "legal", category: "معاملات Pi وإيصالاتها", retention: "حسب الأنظمة المالية", erase: "keep" },
  { t: "pi_links", user: "user_id=$1", purpose: "service", category: "ربط حساب Pi", retention: "حتى إلغاء الربط أو حذف الحساب", erase: "delete" },
  // phase 37 — tips & creator support. Financial rows are kept (legal); a tip's message is cleared on erasure by services/tips.js.
  {
    t: "creator_settings",
    user: "user_id=$1",
    purpose: "service",
    category: "إعدادات استقبال الإكراميات والدعم",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "creator_tiers",
    user: "creator_id=$1",
    purpose: "service",
    category: "مستويات الدعم الشهري التي أنشأتها",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "tips",
    user: "sender_id=$1",
    cols: [
      "id",
      "creator_id",
      "post_id",
      "amount",
      "fee",
      "message",
      "anonymous",
      "show_amount",
      "status",
      "created_at",
      "completed_at",
      "cancelled_at",
      "refunded_at"
    ],
    purpose: "legal",
    category: "الإكراميات التي أرسلتها (المبالغ بوحدات 10⁻⁷ Pi)",
    retention: "حسب الأنظمة المالية؛ تُمسح الرسالة عند حذف الحساب",
    erase: "keep"
  },
  {
    t: "support_subscriptions",
    user: "supporter_id=$1",
    cols: [
      "id",
      "creator_id",
      "tier_name",
      "amount",
      "state",
      "anonymous",
      "active_until",
      "started_at",
      "last_paid_at",
      "cancelled_at",
      "lapsed_at",
      "created_at"
    ],
    purpose: "legal",
    category: "اشتراكات الدعم الشهري",
    retention: "حسب الأنظمة المالية",
    erase: "keep"
  },
  {
    t: "support_payments",
    user: "supporter_id=$1",
    cols: ["id", "support_id", "creator_id", "tier_name", "amount", "fee", "status", "period_start", "period_end", "created_at", "completed_at", "refunded_at"],
    purpose: "legal",
    category: "دفعات الدعم الشهري",
    retention: "حسب الأنظمة المالية",
    erase: "keep"
  },
  {
    t: "ledger_entries",
    user: "user_id=$1",
    cols: ["id", "journal_id", "account", "debit", "credit", "created_at"],
    purpose: "legal",
    category: "قيود دفتر الإكراميات والأرباح الخاصة بك",
    retention: "حسب الأنظمة المالية (دفتر لا يُعدَّل)",
    erase: "keep"
  },
  // phase 38 — paid content. The locked body and media links are content (deleted on erasure); purchases are financial (kept).
  { t: "paid_posts", user: "creator_id=$1", purpose: "service", category: "إعدادات منشوراتك المدفوعة (السعر والمستوى)", retention: "مع المنشور", erase: "delete" },
  {
    t: "paid_content",
    user: "post_id IN (SELECT id FROM posts WHERE author=$1)",
    purpose: "service",
    category: "النص الكامل لمنشوراتك المدفوعة",
    retention: "حتى تحذفها أو تحذف حسابك",
    erase: "delete"
  },
  { t: "paid_media", user: "creator_id=$1", purpose: "service", category: "الوسائط المرتبطة بمنشوراتك المدفوعة", retention: "مع المنشور", erase: "delete" },
  {
    t: "paid_purchases",
    user: "buyer_id=$1",
    cols: ["id", "post_id", "creator_id", "amount", "fee", "status", "created_at", "completed_at", "cancelled_at", "refunded_at"],
    purpose: "legal",
    category: "مشترياتك من المحتوى المدفوع (المبالغ بوحدات 10⁻⁷ Pi)",
    retention: "حسب الأنظمة المالية",
    erase: "keep"
  },
  {
    t: "paid_refund_requests",
    user: "buyer_id=$1",
    cols: ["id", "purchase_id", "post_id", "kind", "reason", "status", "note", "created_at", "decided_at"],
    purpose: "legal",
    category: "طلبات استرداد مشترياتك",
    retention: "حسب الأنظمة المالية؛ يُمسح سبب الطلب عند حذف الحساب",
    erase: "keep"
  },
  // phase 39 — community marketplace. Orders, escrow and disputes are financial records (kept); listing texts, review
  // texts/replies and dispute statements are scrubbed on erasure by services/market.js (USER_ANONYMISED).
  {
    t: "market_listings",
    user: "seller_id=$1",
    cols: ["id", "kind", "title", "description", "price", "category", "item_condition", "quantity", "images", "location", "delivery", "status", "community_id", "views", "created_at", "updated_at"],
    purpose: "service",
    category: "إعلاناتك في السوق (الأسعار بوحدات 10⁻⁷ Pi)",
    retention: "حتى تحذفها أو تحذف حسابك؛ يُمسح نصها عند حذف الحساب",
    erase: "scrub"
  },
  {
    t: "market_orders",
    user: "(buyer_id=$1 OR seller_id=$1)",
    cols: ["id", "listing_id", "buyer_id", "seller_id", "title", "qty", "unit_price", "total", "fee", "status", "tracking", "cancel_reason", "created_at", "paid_at", "shipped_at", "delivered_at", "completed_at", "cancelled_at", "refunded_at", "disputed_at"],
    purpose: "legal",
    category: "طلبات الشراء والبيع في السوق (المبالغ بوحدات 10⁻⁷ Pi)",
    retention: "حسب الأنظمة المالية",
    erase: "keep"
  },
  {
    t: "market_escrow",
    user: "order_id IN (SELECT id FROM market_orders WHERE buyer_id=$1 OR seller_id=$1)",
    cols: ["order_id", "amount", "fee", "buyer_amount", "seller_amount", "state", "created_at", "settled_at"],
    purpose: "legal",
    category: "مبالغ الضمان لطلباتك في السوق",
    retention: "حسب الأنظمة المالية",
    erase: "keep"
  },
  {
    t: "market_reviews",
    user: "(buyer_id=$1 OR seller_id=$1)",
    cols: ["id", "order_id", "listing_id", "buyer_id", "seller_id", "rating", "text", "reply", "created_at", "replied_at"],
    purpose: "service",
    category: "تقييمات السوق التي كتبتها أو تلقيتها",
    retention: "طوال وجود الحساب؛ يُمسح نص التقييم والرد عند حذف الحساب",
    erase: "scrub"
  },
  {
    t: "market_disputes",
    user: "(buyer_id=$1 OR seller_id=$1)",
    cols: ["id", "order_id", "opened_by", "reason", "text", "evidence", "status", "resolution", "buyer_amount", "resolution_note", "created_at", "resolved_at"],
    purpose: "legal",
    category: "نزاعات طلباتك في السوق",
    retention: "حسب الأنظمة المالية؛ يُمسح شرحك عند حذف الحساب",
    erase: "keep"
  },
  {
    t: "market_dispute_messages",
    user: "author_id=$1",
    cols: ["id", "dispute_id", "role", "text", "evidence", "created_at"],
    purpose: "legal",
    category: "رسائلك في نزاعات السوق",
    retention: "حسب الأنظمة المالية؛ يُمسح نصها عند حذف الحساب",
    erase: "scrub"
  },
  // phase 40 — ethical ads. ad_stats_daily, ad_feedback, ad_freq and ad_tokens hold no user ids (aggregates / salted hashes
  // purged after 7 days) and are therefore not in this map. Campaign names/targeting are scrubbed by services/ads.js (USER_ANONYMISED).
  {
    t: "ad_prefs",
    user: "user_id=$1",
    cols: ["personalized", "hidden_advertisers", "hidden_ads", "updated_at"],
    purpose: "personalization",
    category: "اختياراتك للإعلانات (الإعلانات المخصّصة، المعلنون والإعلانات المخفية)",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "ad_campaigns",
    user: "advertiser_id=$1",
    cols: ["id", "post_id", "name", "objective", "targeting", "budget_total", "daily_cap", "bid_cpm", "freq_impressions", "freq_hours", "start_at", "end_at", "status", "review_note", "funded_amount", "spent", "created_at", "updated_at"],
    purpose: "service",
    category: "حملاتك الإعلانية (المبالغ بوحدات 10⁻⁷ Pi)",
    retention: "المبالغ حسب الأنظمة المالية؛ يُمسح اسم الحملة واستهدافها عند حذف الحساب",
    erase: "scrub"
  },
  {
    t: "ad_reviews",
    user: "reviewer=$1",
    cols: ["id", "campaign_id", "decision", "reasons", "note", "at"],
    purpose: "moderation",
    category: "قرارات مراجعة الإعلانات التي اتخذتها (للمشرفين)",
    retention: "سنتان كسجل إشراف",
    erase: "keep"
  },
  // phase 41 — AI subscriptions + translation. translations_cache, ai_period_stats and ui_string_misses hold no user ids (system register).
  {
    t: "ai_subscriptions",
    user: "user_id=$1",
    cols: ["id", "plan_id", "state", "source", "period_start", "period_end", "cancel_at_period_end", "cancelled_at", "created_at", "updated_at"],
    purpose: "service",
    category: "اشتراكاتك في ميزات الذكاء (مجتمع+ ذكاء)",
    retention: "طوال وجود الحساب؛ يُلغى الاشتراك عند حذف الحساب",
    erase: "keep"
  },
  {
    t: "ai_payments",
    user: "user_id=$1",
    cols: ["id", "plan_id", "amount", "status", "period_start", "period_end", "period", "created_at", "completed_at", "refunded_at"],
    purpose: "legal",
    category: "مدفوعات اشتراكات الذكاء (المبالغ بوحدات 10⁻⁷ Pi)",
    retention: "حسب الأنظمة المالية",
    erase: "keep"
  },
  {
    t: "ai_usage",
    user: "user_id=$1",
    cols: ["period", "feature", "requests", "chars", "cache_hits", "cost_micros", "updated_at"],
    purpose: "service",
    category: "استهلاكك الشهري لميزات الذكاء (عدد الطلبات والأحرف فقط، بلا نصوص)",
    retention: "13 شهراً",
    erase: "delete"
  },
  {
    t: "translate_prefs",
    user: "user_id=$1",
    cols: ["auto", "target", "skip", "updated_at"],
    purpose: "personalization",
    category: "اختياراتك للترجمة الآلية",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "user_prefs",
    user: "user_id=$1",
    cols: ["ns", "key", "value", "updated_at"],
    purpose: "personalization",
    category: "إعدادات المظهر والتخصيص المحفوظة لمزامنتها بين أجهزتك",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "ui_strings",
    user: "updated_by=$1",
    cols: ["key", "lang", "text", "updated_at"],
    purpose: "service",
    category: "نصوص الواجهة التي حرّرتها (للإدارة)",
    retention: "طوال استخدامها في الواجهة",
    erase: "keep"
  },
  // phase 45 — digital wellbeing (usage itself stays on the device; only choices + opt-in weekly totals are stored)
  {
    t: "wellbeing_settings",
    user: "user_id=$1",
    cols: ["break_minutes", "daily_limit_minutes", "hide_counts", "focus", "weekly_report", "share_totals", "email_report", "updated_at"],
    purpose: "personalization",
    category: "اختياراتك للرفاهية الرقمية (تذكير الاستراحة، الحد اليومي، إخفاء الأعداد، وضع التركيز، التقرير الأسبوعي)",
    retention: "طوال وجود الحساب",
    erase: "delete"
  },
  {
    t: "wellbeing_weekly",
    user: "user_id=$1",
    cols: ["week", "seconds", "sessions", "days", "reported_at", "updated_at"],
    purpose: "personalization",
    category: "مجاميع استخدامك الأسبوعية التي اخترت مشاركتها (مجموع الوقت وعدد الجلسات والأيام فقط، بلا أوقات أو تفاصيل)",
    retention: "8 أسابيع، وتُحذف فور إيقاف المشاركة",
    erase: "delete"
  },
  {
    t: "consents",
    user: "user_id=$1",
    cols: ["purpose", "granted", "version", "source", "at"],
    purpose: "legal",
    category: "سجل موافقاتك",
    retention: "طوال وجود الحساب + 5 سنوات كإثبات",
    erase: "keep"
  },
  {
    t: "dsr_requests",
    user: "user_id=$1",
    cols: ["id", "kind", "status", "detail", "response", "due_at", "scheduled_for", "completed_at", "cancelled_at", "created_at"],
    purpose: "legal",
    category: "طلباتك المتعلقة ببياناتك",
    retention: "5 سنوات",
    erase: "keep"
  },
  // phase 50 — launch readiness (support tickets, ambassadors, waitlist/invites)
  { t: "support_tickets", user: "user_id=$1", cols: ["id", "subject", "category", "status", "created_at", "updated_at"], purpose: "service", category: "تذاكر الدعم التي فتحتها", retention: "سنتان بعد الإغلاق", erase: "delete" },
  { t: "support_messages", user: "author_id=$1 AND internal=0", cols: ["id", "ticket_id", "body", "attachments", "created_at"], purpose: "service", category: "رسائلك في تذاكر الدعم", retention: "سنتان بعد الإغلاق", erase: "delete" },
  { t: "ambassadors", user: "user_id=$1", cols: ["status", "motivation", "region", "links", "ref_code", "created_at", "reviewed_at"], purpose: "service", category: "طلبك في برنامج سفراء المجتمع", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "ambassador_referrals", user: "user_id=$1", cols: ["ref_code", "created_at"], purpose: "service", category: "رمز السفير الذي انضممت عن طريقه", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "launch_waitlist", user: "user_id=$1", cols: ["contact", "name", "status", "created_at"], purpose: "service", category: "تسجيلك في قائمة الانتظار", retention: "حتى انتهاء الإطلاق التدريجي", erase: "delete" },
  { t: "launch_invite_uses", user: "user_id=$1", cols: ["code", "at"], purpose: "service", category: "رمز الدعوة الذي استخدمته", retention: "طوال وجود الحساب", erase: "delete" },
  // phase 56 — Pi transfers and payment requests (financial rows are kept)
  { t: "pi_transfers", user: "(sender_id=$1 OR recipient_id=$1)", cols: ["id", "amount", "note", "status", "created_at", "completed_at"], purpose: "legal", category: "تحويلات Pi التي أرسلتها أو استلمتها", retention: "حسب الأنظمة المالية", erase: "keep" },
  { t: "pi_pay_requests", user: "(requester_id=$1 OR payer_id=$1)", cols: ["id", "amount", "note", "status", "created_at"], purpose: "service", category: "طلبات الدفع بعملة Pi", retention: "حسب الأنظمة المالية", erase: "keep" },
  { t: "pi_payouts", user: "user_id=$1", cols: ["id", "amount", "txid", "created_at"], purpose: "legal", category: "صرف رصيد التحويلات إلى محفظتك", retention: "حسب الأنظمة المالية", erase: "keep" },
  // phase 57 — creator subscriptions (tier changes are financial; channel messages are your content)
  { t: "sub_changes", user: "supporter_id=$1", cols: ["id", "kind", "to_tier_id", "charge", "status", "created_at"], purpose: "legal", category: "ترقية أو تخفيض اشتراكاتك في صنّاع المحتوى", retention: "حسب الأنظمة المالية", erase: "keep" },
  { t: "sub_channel_msgs", user: "author_id=$1", cols: ["id", "creator_id", "text", "created_at"], purpose: "service", category: "رسائلك في قنوات المشتركين", retention: "طوال وجود الحساب", erase: "delete" },
  // phase 53 — grandfathered prices
  { t: "price_locks", user: "user_id=$1", cols: ["item", "value", "until_at", "created_at"], purpose: "service", category: "أسعار اشتراك محفوظة لك بعد تغيير السعر", retention: "حتى انتهاء الحماية أو الاشتراك", erase: "delete" },
  // phase 58 — digital products (purchases are financial; files and products are your content)
  { t: "digital_entitlements", user: "buyer_id=$1", cols: ["id", "listing_id", "license_key", "downloads", "status", "granted_at"], purpose: "legal", category: "مشترياتك من المنتجات الرقمية", retention: "حسب الأنظمة المالية", erase: "keep" },
  { t: "digital_products", user: "seller_id=$1", cols: ["listing_id", "ptype", "status", "created_at"], purpose: "service", category: "منتجاتك الرقمية المعروضة للبيع", retention: "طوال وجود الحساب", erase: "keep" },
  { t: "digital_files", user: "seller_id=$1", cols: ["id", "name", "mime", "size", "created_at"], purpose: "service", category: "ملفات منتجاتك الرقمية", retention: "طوال وجود المنتج", erase: "keep" },
  { t: "digital_reports", user: "reporter_id=$1", cols: ["id", "listing_id", "reason", "details", "created_at"], purpose: "moderation", category: "بلاغاتك عن المنتجات الرقمية", retention: "حسب سياسة الإشراف", erase: "keep" },
  // phase 54 — beta testing (membership, activity days, feedback, surveys)
  { t: "beta_members", user: "user_id=$1", cols: ["cohort_id", "source", "quota", "invites_used", "badge", "joined_at", "activated_at"], purpose: "service", category: "عضويتك في النسخة التجريبية", retention: "حتى نهاية البرنامج التجريبي", erase: "delete" },
  { t: "beta_activity", user: "user_id=$1", cols: ["day"], purpose: "service", category: "أيام نشاطك في النسخة التجريبية (لقياس الاستمرار)", retention: "حتى نهاية البرنامج التجريبي", erase: "delete" },
  { t: "beta_feedback", user: "user_id=$1", cols: ["id", "kind", "text", "route", "device", "status", "created_at"], purpose: "service", category: "ملاحظاتك على النسخة التجريبية ومعلومات جهازك المرفقة", retention: "حتى معالجتها", erase: "delete" },
  { t: "beta_surveys", user: "user_id=$1", cols: ["kind", "score", "comment", "created_at"], purpose: "service", category: "إجاباتك على استبيانات الرضا", retention: "حتى نهاية البرنامج التجريبي", erase: "delete" },
  // phase 59 — contribution points (redemptions into Pi are financial)
  { t: "points_awards", user: "user_id=$1", cols: ["kind", "source_id", "points", "redeemable", "status", "created_at"], purpose: "service", category: "سجل نقاط مساهماتك", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "points_balances", user: "user_id=$1", cols: ["total", "redeemable", "redeemed", "level", "optout"], purpose: "service", category: "رصيد نقاطك ومستواك واختيار الظهور في لوحة الصدارة", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "mjt_accounts", user: "user_id=$1", cols: ["balance", "status", "receive", "created_at"], purpose: "service", category: "رصيدك من مجتمع كوين (MJT) داخل التطبيق", retention: "سجل مالي — يُحفظ لسلامة الدفتر المزدوج", erase: "keep" },
  { t: "mjt_entries", user: "user_id=$1", cols: ["tx_id", "amount", "balance_after", "created_at"], purpose: "service", category: "حركات رصيدك من مجتمع كوين", retention: "سجل مالي — يُحفظ لسلامة الدفتر المزدوج", erase: "keep" },
  { t: "mjt_conversions", user: "user_id=$1", cols: ["pts", "amount", "status", "created_at"], purpose: "service", category: "تحويل نقاط مساهمتك إلى مجتمع كوين", retention: "سجل مالي — يُحفظ لسلامة الدفتر المزدوج", erase: "keep" },
  { t: "points_redemptions", user: "user_id=$1", cols: ["id", "points", "amount", "status", "txid", "created_at"], purpose: "legal", category: "استبدال نقاطك بمكافآت Pi", retention: "حسب الأنظمة المالية", erase: "keep" },
  { t: "finance_invoices", user: "payer_id=$1", cols: ["number", "kind", "category", "amount", "fee", "journal_at", "issued_at"], purpose: "legal", category: "فواتيرك وإيصالاتك وإشعارات الدائن", retention: "حسب الأنظمة المالية", erase: "keep" },
  // phase 61 — creator analytics (your viewing time on others' posts; who you followed / unfollowed, kept for the creator's net growth)
  { t: "content_attention", user: "user_id=$1", cols: ["post", "day", "kind", "ms", "progress", "media_ms"], purpose: "service", category: "مدة قراءتك أو مشاهدتك لمنشورات الآخرين (تصل للناشر مجمّعة فقط)", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "audience_events", user: "user_id=$1", cols: ["creator_id", "kind", "at"], purpose: "service", category: "سجل متابعاتك وإلغاء متابعاتك (يصل للناشر كأرقام مجمّعة)", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "creator_goals", user: "user_id=$1", cols: ["metric", "target", "created_at", "updated_at"], purpose: "service", category: "أهدافك كصانع محتوى (متابعون، مشاهدات، منشورات)", retention: "حتى تحذفها", erase: "delete" },
  // phase 66 — nearby (coarse opt-in location only; places you submitted; your reports)
  { t: "geo_prefs", user: "user_id=$1", cols: ["enabled", "geohash", "city", "country", "radius_km", "source", "updated_at"], purpose: "service", category: "موقعك التقريبي الاختياري (خلية ~5 كم أو مدينة، لا موقع دقيق)", retention: "حتى تحذفه أو توقف الميزة", erase: "delete" },
  { t: "places", user: "submitted_by=$1", cols: ["id", "name", "category", "descr", "address", "lat", "lng", "status", "created_at"], purpose: "service", category: "الأماكن العامة التي أضفتها إلى الخريطة", retention: "طوال وجود المكان", erase: "keep" },
  { t: "place_reviews", user: "user_id=$1", cols: ["place_id", "rating", "text", "status", "created_at", "updated_at"], purpose: "service", category: "تقييماتك ومراجعاتك للأماكن العامة", retention: "حتى تحذفها", erase: "delete" },
  { t: "place_photos", user: "user_id=$1", cols: ["id", "place_id", "url", "caption", "created_at"], purpose: "service", category: "الصور التي أضفتها إلى الأماكن العامة", retention: "حتى تحذفها", erase: "delete" },
  { t: "place_saves", user: "user_id=$1", cols: ["place_id", "at"], purpose: "service", category: "الأماكن التي حفظتها", retention: "حتى تحذفها", erase: "delete" },
  { t: "place_reports", user: "user_id=$1", cols: ["place_id", "reason", "note", "created_at"], purpose: "moderation", category: "بلاغاتك عن الأماكن", retention: "حسب سياسة الإشراف", erase: "keep" },
  // phase 71 — study groups and halaqat
  { t: "study_attendance", user: "user_id=$1", cols: ["session_id", "community_id", "status", "minutes", "joined_at"], purpose: "service", category: "حضورك في جلسات مجموعات الدراسة والحلقات", retention: "طوال عضويتك في المجموعة", erase: "delete" },
  { t: "study_notes", user: "author=$1", cols: ["id", "community_id", "kind", "title", "body", "url", "created_at"], purpose: "service", category: "ملاحظاتك ومواردك المشتركة في مجموعات الدراسة", retention: "طوال وجود المجموعة", erase: "delete" },
  { t: "study_goals", user: "user_id=$1", cols: ["id", "community_id", "title", "unit", "target", "progress", "done_at"], purpose: "service", category: "أهدافك الشخصية في مجموعات الدراسة", retention: "طوال عضويتك في المجموعة", erase: "delete" },
  { t: "study_progress", user: "student_id=$1", cols: ["community_id", "kind", "surah", "from_ayah", "to_ayah", "ayahs", "grade", "note", "at"], purpose: "service", category: "سجل تسميعك وحفظك ومراجعتك في الحلقات", retention: "طوال عضويتك في الحلقة", erase: "delete" },
  { t: "study_assignments", user: "created_by=$1", cols: ["id", "community_id", "title", "body", "due_at", "points", "created_at"], purpose: "service", category: "الواجبات التي أنشأتها كمعلم في مجموعات الدراسة", retention: "طوال وجود المجموعة", erase: "keep" },
  { t: "study_submissions", user: "user_id=$1", cols: ["assignment_id", "community_id", "body", "url", "status", "grade", "feedback", "submitted_at", "reviewed_at"], purpose: "service", category: "واجباتك المسلَّمة في مجموعات الدراسة وملاحظات المعلم عليها", retention: "طوال عضويتك في المجموعة", erase: "delete" },
  { t: "study_completions", user: "user_id=$1", cols: ["community_id", "note", "criteria", "issued_at"], purpose: "service", category: "إتمامك لمجموعات الدراسة والدورات (أساس الشهادات)", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "post_schedules", user: "author=$1", cols: ["post_id", "tz", "series_id", "state", "attempts", "queued_at", "published_at"], purpose: "service", category: "منشوراتك المجدولة وحالة نشرها", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "content_series", user: "author=$1", cols: ["id", "title", "descr", "kind", "visibility", "status", "created_at"], purpose: "service", category: "سلاسل المحتوى التي أنشأتها", retention: "حتى تحذفها", erase: "delete" },
  { t: "content_series_follows", user: "user_id=$1", cols: ["series_id", "notify", "at"], purpose: "service", category: "السلاسل التي تتابعها", retention: "حتى تلغي المتابعة", erase: "delete" },
  { t: "businesses", user: "owner_id=$1", cols: ["place_id", "category", "accepts_pi", "phone", "whatsapp", "email", "website", "home_based", "verified", "created_at"], purpose: "service", category: "الأنشطة التجارية التي تديرها في الدليل", retention: "حتى تحذفها أو تتخلى عن إدارتها", erase: "keep" },
  { t: "business_claims", user: "user_id=$1", cols: ["id", "place_id", "role", "evidence", "contact", "status", "note", "created_at", "decided_at"], purpose: "moderation", category: "طلباتك لإدارة أنشطة تجارية والتحقق منها", retention: "حسب سياسة الإشراف", erase: "keep" },
  { t: "courses", user: "author=$1", cols: ["id", "community_id", "title", "status", "created_at"], purpose: "service", category: "الدورات التي أنشأتها كمعلم", retention: "طوال وجود الحساب", erase: "keep" },
  { t: "course_enrolments", user: "user_id=$1", cols: ["course_id", "status", "enrolled_at", "last_at", "progress", "completed_at"], purpose: "service", category: "الدورات المسجّل فيها وتقدّمك", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "course_progress", user: "user_id=$1", cols: ["course_id", "lesson_id", "done", "best_score", "attempts", "done_at"], purpose: "service", category: "الدروس التي أتممتها ودرجات اختباراتك", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "course_attempts", user: "user_id=$1", cols: ["course_id", "lesson_id", "answers", "score", "passed", "at"], purpose: "service", category: "محاولاتك في اختبارات الدورات", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "collab_profiles", user: "user_id=$1", cols: ["open", "headline", "categories", "formats", "rate_from", "rate_note", "languages", "updated_at"], purpose: "service", category: "ملف التعاون (الميديا كِت) الذي يراه المعلنون", retention: "حتى تحذفه أو تغلقه", erase: "delete" },
  { t: "collab_brands", user: "user_id=$1", cols: ["name", "category", "website", "about", "status", "verified", "created_at"], purpose: "service", category: "ملف علامتك التجارية للرعايات", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "collab_campaigns", user: "brand_id=$1", cols: ["id", "title", "summary", "fee", "deadline", "status", "created_at"], purpose: "service", category: "حملات الرعاية التي نشرتها", retention: "طوال وجود الحساب", erase: "keep" },
  { t: "collab_deals", user: "(brand_id=$1 OR creator_id=$1)", cols: ["id", "kind", "title", "fee", "status", "created_at", "accepted_at", "completed_at"], purpose: "service", category: "اتفاقات التعاون والرعاية التي كنت طرفاً فيها", retention: "طوال وجود الحساب (سجل إفصاح)", erase: "keep" },
  { t: "collab_messages", user: "author=$1", cols: ["deal_id", "kind", "body", "at"], purpose: "service", category: "رسائلك في غرف اتفاقات التعاون", retention: "طوال وجود الاتفاق", erase: "delete" },
  { t: "post_partnerships", user: "creator_id=$1", cols: ["post_id", "kind", "brand_name", "locked", "source", "created_at"], purpose: "legal", category: "إفصاحات المحتوى المدفوع على منشوراتك", retention: "طوال وجود المنشور", erase: "keep" },
  { t: "collab_reports", user: "by_user=$1", cols: ["post_id", "note", "status", "created_at"], purpose: "moderation", category: "بلاغاتك عن إعلانات غير مفصح عنها", retention: "حسب سياسة الإشراف", erase: "keep" },
  { t: "hijri_reminders", user: "user_id=$1", cols: ["season", "days_before", "on_start", "created_at"], purpose: "service", category: "تذكيرات المواسم التي اخترتها", retention: "حتى تلغيها", erase: "delete" },
  { t: "exams", user: "author=$1", cols: ["id", "community_id", "title", "status", "created_at"], purpose: "service", category: "الاختبارات التي أنشأتها كمعلم", retention: "طوال وجود المجموعة", erase: "keep" },
  { t: "exam_attempts", user: "user_id=$1", cols: ["exam_id", "status", "score", "passed", "started_at", "submitted_at"], purpose: "service", category: "محاولاتك في الاختبارات ودرجاتك", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "mentor_profiles", user: "user_id=$1", cols: ["headline", "bio", "topics", "languages", "minutes", "price", "allow_minors", "tz", "open", "status", "created_at", "updated_at"], purpose: "service", category: "ملفك كمرشد (المواضيع والسعر والمنطقة الزمنية)", retention: "حتى تحذفه", erase: "delete" },
  { t: "mentor_slots", user: "mentor_id=$1", cols: ["weekday", "start_min", "end_min"], purpose: "service", category: "أوقات إتاحتك الأسبوعية للإرشاد", retention: "حتى تغيّرها أو تحذف الملف", erase: "delete" },
  { t: "mentor_requests", user: "(learner_id=$1 OR mentor_id=$1)", cols: ["id", "topic", "goal", "level", "status", "reply", "created_at", "decided_at"], purpose: "service", category: "طلبات الإرشاد التي أرسلتها أو وصلتك", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "mentor_sessions", user: "(learner_id=$1 OR mentor_id=$1)", cols: ["id", "topic", "starts_at", "minutes", "status", "price", "pay_status", "created_at", "completed_at"], purpose: "service", category: "جلسات الإرشاد التي حجزتها أو قدّمتها", retention: "طوال وجود الحساب (سجل مالي للجلسات المدفوعة)", erase: "keep" },
  { t: "mentor_notes", user: "user_id=$1", cols: ["session_id", "body", "shared", "updated_at"], purpose: "service", category: "ملاحظاتك على جلسات الإرشاد", retention: "حتى تحذفها", erase: "delete" },
  { t: "mentor_feedback", user: "by_user=$1", cols: ["session_id", "rating", "comment", "created_at"], purpose: "service", category: "تقييماتك وملاحظاتك بعد جلسات الإرشاد", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "mentor_feeds", user: "user_id=$1", cols: ["created_at"], purpose: "service", category: "رابط تقويم الإرشاد الخاص بك (الرمز نفسه لا يُصدَّر)", retention: "حتى تلغيه", erase: "delete" },
  { t: "vc_applications", user: "user_id=$1", cols: ["id", "category", "statement", "links", "status", "reason", "created_at", "decided_at"], purpose: "service", category: "طلباتك في برنامج الصنّاع الموثّقين", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "vc_creators", user: "user_id=$1", cols: ["category", "status", "since", "until"], purpose: "service", category: "عضويتك في برنامج الصنّاع الموثّقين", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "fund_applications", user: "user_id=$1", cols: ["id", "round_id", "title", "plan", "amount", "status", "award", "pay_status", "created_at", "decided_at", "paid_at"], purpose: "service", category: "طلباتك ومنحك في صندوق دعم الصنّاع (المنح المقبولة سجل عام)", retention: "طوال وجود الحساب (سجل مالي للمنح المصروفة)", erase: "keep" },
  { t: "fund_updates", user: "user_id=$1", cols: ["application_id", "body", "created_at"], purpose: "service", category: "تحديثات التقدّم التي نشرتها على منحتك", retention: "طوال وجود المنحة", erase: "delete" },
  { t: "fund_donations", user: "user_id=$1", cols: ["id", "amount", "anonymous", "status", "created_at", "completed_at"], purpose: "service", category: "تبرّعاتك لصندوق دعم الصنّاع", retention: "طوال وجود الحساب (سجل مالي)", erase: "keep" },
  { t: "fund_reports", user: "by_user=$1", cols: ["application_id", "reason", "note", "status", "created_at"], purpose: "moderation", category: "بلاغاتك عن منح الصندوق", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "charity_orgs", user: "owner_id=$1", cols: ["id", "name", "kind", "country", "city", "registry", "license_no", "website", "email", "descr", "status", "created_at"], purpose: "service", category: "الجهات الخيرية والتطوعية التي سجّلتها (الجهة الموثّقة سجل عام)", retention: "طوال وجود الجهة (سجل عام للتبرّعات)", erase: "keep" },
  { t: "charity_org_members", user: "user_id=$1", cols: ["org_id", "role", "created_at"], purpose: "service", category: "عضويتك في إدارة الجهات الخيرية", retention: "حتى تُزال من الجهة", erase: "delete" },
  { t: "vol_signups", user: "user_id=$1", cols: ["opp_id", "note", "status", "hours", "cert_code", "created_at", "decided_at"], purpose: "service", category: "تسجيلاتك في فرص التطوّع وساعاتك المؤكدة", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "charity_donations", user: "user_id=$1", cols: ["id", "campaign_id", "amount", "anonymous", "status", "created_at", "completed_at"], purpose: "service", category: "تبرّعاتك للحملات الخيرية", retention: "طوال وجود الحساب (سجل مالي)", erase: "keep" },
  { t: "charity_updates", user: "user_id=$1", cols: ["campaign_id", "kind", "body", "amount", "receipt_url", "created_at"], purpose: "service", category: "تحديثات وتقارير صرف نشرتها على حملات جهتك (سجل شفافية عام)", retention: "طوال وجود الحملة", erase: "keep" },
  { t: "charity_reports", user: "by_user=$1", cols: ["target_type", "target_id", "reason", "note", "status", "created_at"], purpose: "moderation", category: "بلاغاتك عن الجهات والحملات الخيرية", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "kb_articles", user: "created_by=$1", cols: ["id", "title", "category", "license", "status", "created_at", "published_at"], purpose: "service", category: "مقالات بدأتها في المكتبة المعرفية (منشورة بترخيص مفتوح)", retention: "تبقى المقالة المنشورة بترخيصها المفتوح؛ يُزال ربطها بحسابك عند حذفه", erase: "keep" },
  { t: "kb_revisions", user: "author_id=$1", cols: ["article_id", "n", "title", "note", "status", "reason", "created_at", "decided_at"], purpose: "service", category: "مساهماتك وتعديلاتك في المكتبة المعرفية (سجل النسخ)", retention: "تبقى النسخ المعتمدة بترخيصها المفتوح؛ يُزال ربطها بحسابك عند حذفه", erase: "keep" },
  { t: "kb_votes", user: "user_id=$1", cols: ["article_id", "vote", "created_at"], purpose: "service", category: "تقييمك لفائدة مقالات المكتبة", retention: "حتى تحذفه", erase: "delete" },
  { t: "kb_reports", user: "by_user=$1", cols: ["article_id", "reason", "note", "status", "created_at"], purpose: "moderation", category: "بلاغاتك عن مقالات المكتبة المعرفية", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "kb_reviewers", user: "user_id=$1", cols: ["created_at"], purpose: "service", category: "دورك مراجعاً في المكتبة المعرفية", retention: "حتى يُلغى", erase: "delete" },
  { t: "pro_profiles", user: "user_id=$1", cols: ["headline", "about", "city", "country", "open_to", "languages", "links", "visibility", "sections", "searchable", "show_certs", "views", "created_at", "updated_at"], purpose: "service", category: "ملفك المهني (العنوان، النبذة، الروابط، إعدادات الظهور)", retention: "حتى تحذفه", erase: "delete" },
  { t: "pro_items", user: "user_id=$1", cols: ["kind", "title", "org", "place", "start_ym", "end_ym", "current", "body", "url", "post_id", "created_at"], purpose: "service", category: "خبراتك وتعليمك ومعرض أعمالك في الملف المهني", retention: "حتى تحذفه", erase: "delete" },
  { t: "pro_skills", user: "user_id=$1", cols: ["name", "level", "years", "created_at"], purpose: "service", category: "مهاراتك في الملف المهني", retention: "حتى تحذفها", erase: "delete" },
  { t: "pro_reports", user: "by_user=$1", cols: ["reason", "note", "status", "created_at"], purpose: "moderation", category: "بلاغاتك عن الملفات المهنية", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "jobs", user: "poster_id=$1", cols: ["id", "kind", "title", "category", "mode", "city", "pay_type", "pay_min", "pay_max", "status", "created_at", "closed_at"], purpose: "service", category: "إعلانات الوظائف والمشاريع التي نشرتها", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "job_applications", user: "applicant_id=$1", cols: ["job_id", "cover", "answers", "bid", "days", "status", "created_at", "updated_at"], purpose: "service", category: "طلباتك للتوظيف والمشاريع", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "job_events", user: "actor_id=$1", cols: ["app_id", "kind", "status", "body", "created_at"], purpose: "service", category: "رسائلك وتحديثاتك على طلبات التوظيف", retention: "طوال وجود الطلب", erase: "delete" },
  { t: "job_saved", user: "user_id=$1", cols: ["job_id", "created_at"], purpose: "service", category: "الفرص التي حفظتها", retention: "حتى تحذفها", erase: "delete" },
  { t: "job_reports", user: "by_user=$1", cols: ["job_id", "reason", "note", "status", "created_at"], purpose: "moderation", category: "بلاغاتك عن إعلانات الوظائف", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "job_boosts", user: "user_id=$1", cols: ["job_id", "days", "amount", "status", "created_at", "completed_at"], purpose: "service", category: "تمييز إعلاناتك المدفوع بـ Pi", retention: "طوال وجود الحساب (سجل مالي)", erase: "keep" },
  { t: "contracts", user: "client_id=$1 OR worker_id=$1", cols: ["id", "title", "scope", "source", "total", "status", "created_at", "accepted_at", "completed_at"], purpose: "service", category: "عقودك (كعميل أو منفّذ)", retention: "طوال وجود الحساب (سجل مالي يخص الطرف الآخر أيضاً)", erase: "keep" },
  { t: "contract_deliverables", user: "user_id=$1", cols: ["contract_id", "milestone_id", "note", "links", "created_at"], purpose: "service", category: "ما سلّمته في مراحل العقود", retention: "طوال وجود العقد", erase: "keep" },
  { t: "contract_events", user: "actor_id=$1", cols: ["contract_id", "kind", "body", "created_at"], purpose: "service", category: "رسائلك وإجراءاتك في العقود", retention: "طوال وجود العقد", erase: "keep" },
  { t: "contract_disputes", user: "opened_by=$1", cols: ["contract_id", "milestone_id", "reason", "body", "status", "outcome", "created_at", "resolved_at"], purpose: "moderation", category: "النزاعات التي فتحتها على العقود", retention: "طوال وجود الحساب", erase: "keep" },
  { t: "wt_teams", user: "owner_id=$1", cols: ["id", "kind", "name", "about", "visibility", "status", "created_at"], purpose: "service", category: "الفرق والمشاريع التي تملكها", retention: "طوال وجود الفريق", erase: "keep" },
  { t: "wt_members", user: "user_id=$1", cols: ["team_id", "role", "title", "joined_at"], purpose: "service", category: "عضويتك في الفرق والمشاريع", retention: "طوال العضوية", erase: "delete" },
  { t: "wt_invites", user: "user_id=$1", cols: ["team_id", "kind", "role", "status", "created_at", "decided_at"], purpose: "service", category: "دعواتك وطلبات انضمامك للفرق", retention: "حتى الرد", erase: "delete" },
  { t: "wt_tasks", user: "created_by=$1", cols: ["team_id", "title", "body", "status", "due", "created_at"], purpose: "service", category: "مهام أنشأتها في الفرق", retention: "طوال وجود الفريق (عمل مشترك)", erase: "keep" },
  { t: "wt_items", user: "by_user=$1", cols: ["team_id", "kind", "title", "url", "note", "created_at"], purpose: "service", category: "الملفات والروابط التي شاركتها في الفرق", retention: "حتى تحذفها", erase: "delete" },
  { t: "pr_reviews", user: "author_id=$1 OR target_id=$1", cols: ["kind", "ref_id", "author_id", "target_id", "role", "overall", "c1", "c2", "c3", "body", "response", "status", "created_at"], purpose: "service", category: "التقييمات المهنية التي كتبتها أو تلقيتها وردودك عليها", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "pr_endorsements", user: "user_id=$1 OR by_user=$1", cols: ["user_id", "by_user", "name", "created_at"], purpose: "service", category: "تأييد المهارات (منك ولك)", retention: "حتى سحب التأييد", erase: "delete" },
  { t: "pr_reports", user: "by_user=$1", cols: ["review_id", "reason", "note", "status", "created_at"], purpose: "moderation", category: "بلاغاتك عن التقييمات", retention: "حتى قرار الفريق", erase: "delete" },
  { t: "pr_prompts", user: "user_id=$1", cols: ["kind", "ref_id", "created_at"], purpose: "service", category: "دعوات التقييم المرسلة لك", retention: "طوال وجود الحساب", erase: "delete" },
  { t: "wt_updates", user: "user_id=$1", cols: ["team_id", "kind", "body", "created_at"], purpose: "service", category: "تحديثاتك ونقاشاتك في الفرق", retention: "حتى تحذفها", erase: "delete" },
  { t: "certificates", user: "holder_id=$1", cols: ["code", "kind", "title", "issuer_name", "status", "visibility", "issued_at", "verifications"], purpose: "service", category: "شهاداتك الموقّعة (يتحقق منها من يحمل الرمز)", retention: "طوال وجود الحساب", erase: "delete" },
];
/* registered-but-not-exported system records (documented in the register only) */
const SYSTEM_RECORDS = [
  {
    t: "audit_log",
    purpose: "security",
    category: "سجل التدقيق المتسلسل (إجراءات حساسة)",
    retention: "دائم: سلسلة بصمات لا يمكن حذف قيود منها دون كسرها؛ لا يحتوي محتوى"
  },
  { t: "breach_log", purpose: "legal", category: "سجل حوادث تسرّب البيانات", retention: "5 سنوات على الأقل" },
  { t: "ledger_journals", purpose: "legal", category: "رؤوس قيود دفتر الإكراميات والمحتوى المدفوع والسوق والإعلانات واشتراكات الذكاء (القيد المزدوج، لا يُعدَّل)", retention: "حسب الأنظمة المالية" },
  { t: "ad_stats_daily", purpose: "service", category: "إحصاءات الإعلانات اليومية لكل حملة (أرقام مجمّعة فقط، بلا معرّفات مستخدمين)", retention: "طوال وجود الحملة" },
  { t: "ad_feedback", purpose: "service", category: "أسباب إخفاء الإعلانات مجمّعة لكل حملة ويوم (بلا معرّفات مستخدمين)", retention: "طوال وجود الحملة" },
  { t: "ad_freq / ad_tokens", purpose: "service", category: "عدّادات حد تكرار الإعلانات بمعرّف مموّه بملح يومي يتغيّر (لا يمكن ربطه بحساب بعد حذف الملح)", retention: "7 أيام" },
  { t: "translations_cache", purpose: "service", category: "ترجمات آلية مخزّنة مؤقتاً بمفتاح بصمة النص واللغة (لا تُخزَّن الرسائل المشفّرة ولا المحتوى المدفوع)", retention: "رسائل المحادثات 30 يوماً وتُحذف عند حذف الرسالة؛ المحتوى العام حتى يتغيّر" },
  { t: "ai_period_stats", purpose: "service", category: "إحصاءات شهرية مجمّعة لاستخدام الذكاء وتكلفة المزود (بلا معرّفات مستخدمين)", retention: "حسب الأنظمة المالية" },
  { t: "ui_string_misses", purpose: "service", category: "نصوص واجهة لم تُترجم بعد، مجمّعة لكل لغة (بلا معرّفات مستخدمين)", retention: "حتى تُترجم" },
  { t: "assistant_vectors", purpose: "service", category: "فهرس البحث بالمعنى للمحتوى العام فقط (متجهات بلا نصوص ولا معرّفات مستخدمين)", retention: "يُحذف عند حذف المنشور أو تعديله أو خروجه من العموم" },
  { t: "help_articles", purpose: "service", category: "مقالات مركز المساعدة والأسئلة الشائعة (محتوى عام يحرره الفريق)", retention: "حتى تُحذف" },
  { t: "launch_invites / launch_meta", purpose: "service", category: "رموز الدعوة للإطلاق التدريجي وإعدادات الإطلاق (بلا محتوى شخصي)", retention: "حتى انتهاء الإطلاق التدريجي" },
  { t: "transparency_reports", purpose: "moderation", category: "تقارير الشفافية (أرقام مجمّعة فقط)", retention: "دائم" },
  { t: "client_errors", purpose: "security", category: "أخطاء الواجهة التقنية", retention: "90 يوماً" },
  { t: "hijri_overrides / hijri_reminder_log", purpose: "service", category: "تصحيحات بداية الأشهر الهجرية (إعلانات الرؤية) وسجل منع تكرار تذكيرات المواسم", retention: "دائم / عام هجري واحد" },
  { t: "cert_verifications", purpose: "service", category: "عدد مرات التحقق من كل شهادة يومياً (بلا هوية من تحقق)", retention: "طوال وجود الشهادة" },
  {
    t: "blobs / storage",
    purpose: "service",
    category: "ملفات الوسائط",
    retention: "تُحذف فقط بإعداد صريح (COMPLIANCE_DELETE_MEDIA_BLOBS / RETENTION_MEDIA_BLOBS)"
  }
];

/* ---------- retention ----------
 * type: key · t: table · at: time column · days: default · where: extra filter · action: delete | anonymise | media
 * key: primary key used for batched deletes (null = delete matching rows in one statement) */
const RETENTION = [
  { type: "analytics_events", t: "analytics_events", at: "at", days: 395, action: "delete", key: "id", label: "أحداث الاستخدام" },
  { type: "notifications_read", t: "notifications", at: "created_at", days: 180, where: "read=1", action: "delete", key: "id", label: "الإشعارات المقروءة" },
  { type: "notifications_all", t: "notifications", at: "created_at", days: 365, action: "delete", key: "id", label: "كل الإشعارات" },
  { type: "search_history", t: "search_history", at: "at", days: 180, action: "delete", key: "id", label: "سجل البحث" },
  { type: "post_views", t: "post_views", at: "at", days: 180, action: "delete", key: "id", label: "مشاهدات المنشورات" },
  { type: "engagement_signals", t: "engagement_signals", at: "at", days: 365, action: "delete", key: "id", label: "إشارات التفاعل" },
  { type: "client_errors", t: "client_errors", at: "last_at", days: 90, action: "delete", key: "id", label: "أخطاء الواجهة" },
  { type: "rum_metrics", t: "rum_metrics", at: "at", days: 90, action: "delete", key: "id", label: "قياسات الأداء" },
  { type: "notify_deliveries", t: "notify_deliveries", at: "created_at", days: 90, action: "delete", key: "id", label: "سجل توصيل الإشعارات" },
  { type: "email_log", t: "email_log", at: "created_at", days: 365, action: "delete", key: "id", label: "سجل البريد المرسل" },
  { type: "email_tokens", t: "email_tokens", at: "expires_at", days: 30, action: "delete", key: "token_hash", label: "رموز البريد المنتهية" },
  {
    type: "webauthn_challenges",
    t: "webauthn_challenges",
    at: "expires_at",
    days: 1,
    action: "delete",
    key: "challenge",
    label: "تحديات مفاتيح المرور المنتهية"
  },
  { type: "known_devices", t: "known_devices", at: "last_seen", days: 400, action: "delete", key: null, label: "الأجهزة غير المستخدمة" },
  {
    type: "reports_reporter",
    t: "reports",
    at: "resolved_at",
    days: 730,
    where: "status<>'open' AND by_user<>'anonymised'",
    action: "anonymise",
    key: "id",
    set: "by_user='anonymised'",
    label: "فصل البلاغات القديمة عن هوية المبلّغ"
  },
  {
    type: "media_blobs",
    t: "media",
    at: "created_at",
    days: 30,
    where: "status='deleted'",
    action: "media",
    key: "id",
    label: "ملفات الوسائط المحذوفة",
    optIn: true
  }
];
const RETENTION_EXEMPT = [
  { type: "audit_log", label: "سجل التدقيق", why: "سلسلة بصمات؛ الحذف يكسر إثبات السلامة" },
  { type: "decisions_appeals", label: "قرارات الإشراف والاستئناف", why: "مطلوبة لسجل قرارات الحساب وتقرير الشفافية" },
  { type: "consents_dsr", label: "سجل الموافقات وطلبات البيانات", why: "إثبات الامتثال (5 سنوات على الأقل)" },
  { type: "breach_log", label: "سجل حوادث التسرّب", why: "التزام نظامي" }
];
/** effective rules: defaults ← stored overrides ({type:{days,enabled}}) */
function retentionRules(overrides = {}) {
  return RETENTION.map(r => {
    const o = overrides[r.type] || {};
    const days = Number.isFinite(+o.days) && +o.days >= 1 ? Math.round(+o.days) : r.days;
    const enabled = o.enabled === undefined || o.enabled === null ? !r.optIn : !!+o.enabled;
    return { ...r, days, enabled, defaultDays: r.days };
  });
}
const cutoff = (days, nowMs = Date.now()) => new Date(nowMs - days * DAY).toISOString();

/* ---------- periods ---------- */
const pad = n => String(n).padStart(2, "0");
/** "2026-09" (month) or "2026-Q3" (quarter) → { period, kind, start, end } with end exclusive, UTC */
function periodRange(period) {
  let m = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (m) {
    const y = +m[1],
      mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return { period, kind: "month", start: new Date(Date.UTC(y, mo - 1, 1)).toISOString(), end: new Date(Date.UTC(y, mo, 1)).toISOString() };
  }
  m = /^(\d{4})-Q([1-4])$/.exec(String(period || ""));
  if (m) {
    const y = +m[1],
      q = +m[2];
    return { period, kind: "quarter", start: new Date(Date.UTC(y, (q - 1) * 3, 1)).toISOString(), end: new Date(Date.UTC(y, q * 3, 1)).toISOString() };
  }
  return null;
}
/** the last fully finished period of a kind before `date` */
function previousPeriod(kind, date = new Date()) {
  const y = date.getUTCFullYear(),
    mo = date.getUTCMonth();
  if (kind === "quarter") {
    const q = Math.floor(mo / 3);
    return q === 0 ? `${y - 1}-Q4` : `${y}-Q${q}`;
  }
  return mo === 0 ? `${y - 1}-12` : `${y}-${pad(mo)}`;
}
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
function periodLabel(period) {
  const r = periodRange(period);
  if (!r) return String(period);
  const [y, p] = period.split("-");
  if (r.kind === "quarter") return `الربع ${["الأول", "الثاني", "الثالث", "الرابع"][+p.slice(1) - 1]} ${y}`;
  return `${MONTHS[+p - 1]} ${y}`;
}

/* ---------- aggregation helpers ---------- */
/** small non-zero buckets become "<min" so a breakdown cannot point at a single person; totals stay exact */
function suppress(obj, min) {
  if (!min || min <= 1) return { ...obj };
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v > 0 && v < min ? `<${min}` : v;
  return out;
}
function median(nums) {
  const a = nums.filter(n => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
const countBy = (rows, key) => rows.reduce((o, r) => ((o[r[key] ?? "other"] = (o[r[key] ?? "other"] || 0) + 1), o), {});

/* ---------- deadlines ---------- */
const DSR_DAYS = 30; // PDPL Implementing Regulation: act on a data-subject request within 30 days (extendable by 30 with notice)
const BREACH_HOURS = 72; // notify SDAIA within 72 h of becoming aware, when the breach may cause harm
const dsrDue = createdIso => new Date(Date.parse(createdIso) + DSR_DAYS * DAY).toISOString();
const breachDue = detectedIso => new Date(Date.parse(detectedIso) + BREACH_HOURS * 3600e3).toISOString();
/** "ok" | "soon" (≤ 25 % of the window left) | "overdue" | "done" */
function deadlineState(dueIso, doneIso, windowMs, nowMs = Date.now()) {
  if (doneIso) return "done";
  const left = Date.parse(dueIso) - nowMs;
  if (left < 0) return "overdue";
  return left <= windowMs * 0.25 ? "soon" : "ok";
}

/* ---------- report timeline for the reporter ---------- */
const KIND_LABEL = { post: "منشور", comment: "تعليق", user: "حساب", community: "مجتمع", message: "رسالة" };
/** report row (+ restored flag when a later appeal reversed the removal) → ordered steps the reporter sees */
function reportTimeline(r, { restored = false, hidden = false } = {}) {
  const steps = [
    { key: "received", label: "استلمنا بلاغك", detail: "يصل البلاغ إلى فريق المراجعة دون أن يعرف صاحب المحتوى من أبلغ.", at: r.created_at, done: true }
  ];
  if (r.status === "open") {
    steps.push({
      key: "review",
      label: "قيد المراجعة",
      detail: hidden ? "أُخفي المحتوى مؤقتاً لحين انتهاء المراجعة." : "نراجع البلاغات حسب خطورتها وترتيب وصولها.",
      at: null,
      done: false,
      current: true
    });
    steps.push({ key: "decision", label: "القرار", detail: "سنرسل إليك إشعاراً عند اتخاذ القرار.", at: null, done: false });
  } else {
    steps.push({ key: "review", label: "تمت المراجعة", detail: null, at: r.resolved_at, done: true });
    steps.push(
      r.status === "actioned"
        ? {
            key: "decision",
            label: "اتخذنا إجراءً",
            detail: "وجدنا أن المحتوى يخالف الإرشادات وأزلناه. شكراً لمساعدتك.",
            at: r.resolved_at,
            done: true,
            outcome: "actioned"
          }
        : {
            key: "decision",
            label: "لم نجد مخالفة",
            detail: "راجعنا المحتوى ولم يخالف الإرشادات. يمكنك كتمه أو حظر صاحبه إن لم ترغب برؤيته.",
            at: r.resolved_at,
            done: true,
            outcome: "dismissed"
          }
    );
    if (restored)
      steps.push({ key: "appeal", label: "أُعيدت مراجعة القرار", detail: "قدّم صاحب المحتوى استئنافاً وقُبل بعد مراجعة ثانية.", at: null, done: true });
  }
  return steps;
}
const REPORT_STATUS = { open: "قيد المراجعة", actioned: "اتُّخذ إجراء", dismissed: "لا مخالفة" };

/* ---------- export: drop secret columns ---------- */
function cleanRow(row, cols) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (SECRET_COLS.includes(k)) continue;
    if (cols && !cols.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/* ---------- minimal ZIP writer (stored, no compression; UTF-8 names) ---------- */
let CRC_T = null;
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_T[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  };
}
/** files: [{ name, data: Buffer|string }] → Buffer (a valid .zip readable by every OS) */
function zip(files, when = new Date()) {
  const { time, date } = dosTime(when),
    parts = [],
    central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"),
      data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), "utf8"),
      crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(0, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26);
    h.writeUInt16LE(0, 28);
    parts.push(h, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}
/** read back a stored zip (tests and the import check): → [{ name, data }] */
function unzip(buf) {
  const out = [];
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18),
      nl = buf.readUInt16LE(p + 26),
      xl = buf.readUInt16LE(p + 28),
      crc = buf.readUInt32LE(p + 14);
    const name = buf.subarray(p + 30, p + 30 + nl).toString("utf8"),
      data = buf.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size);
    out.push({ name, data, crcOk: crc32(data) === crc });
    p += 30 + nl + xl + size;
  }
  return out;
}

/* ---------- erasure helpers ---------- */
const anonHandle = rand =>
  "deleted_" +
  String(rand)
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 12)
    .toLowerCase();
const DELETED_NAME = "مستخدم محذوف";
/** grace period before an account deletion runs (COMPLIANCE_DELETION_GRACE_DAYS, default 30, 0–90; fractions allowed for tests) */
function GRACE_DAYS(env = process.env) {
  const v = env.COMPLIANCE_DELETION_GRACE_DAYS,
    n = v === undefined || v === "" ? 30 : +v;
  return Number.isFinite(n) ? Math.max(0, Math.min(90, n)) : 30;
}

/* ---------- consents ---------- */
/** latest row per purpose → { purpose: { granted, at, version, required, label, basis } } with defaults for unset optional purposes */
function consentState(rows = []) {
  const latest = {};
  for (const r of rows) {
    const prev = latest[r.purpose];
    if (!prev || String(r.at) > String(prev.at) || (String(r.at) === String(prev.at) && (r.id || 0) > (prev.id || 0))) latest[r.purpose] = r;
  }
  const out = {};
  for (const [k, P] of Object.entries(PURPOSES)) {
    const r = latest[k];
    out[k] = {
      purpose: k,
      label: P.label,
      descr: P.descr,
      basis: P.basis,
      basisLabel: BASIS_LABEL[P.basis],
      required: !!P.required,
      granted: P.required ? true : r ? !!+r.granted : !!P.default,
      at: r?.at || null,
      version: r?.version || null,
      explicit: !!r
    };
  }
  return out;
}

module.exports = {
  DAY,
  PURPOSES,
  BASIS_LABEL,
  CONSENT_VERSION,
  DATA_MAP,
  SYSTEM_RECORDS,
  SECRET_COLS,
  RETENTION,
  RETENTION_EXEMPT,
  retentionRules,
  cutoff,
  periodRange,
  previousPeriod,
  periodLabel,
  suppress,
  median,
  countBy,
  DSR_DAYS,
  BREACH_HOURS,
  dsrDue,
  breachDue,
  deadlineState,
  KIND_LABEL,
  REPORT_STATUS,
  reportTimeline,
  cleanRow,
  crc32,
  zip,
  unzip,
  anonHandle,
  DELETED_NAME,
  GRACE_DAYS,
  consentState
};
