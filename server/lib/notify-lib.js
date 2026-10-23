/* Notification domain logic (Phase 28), pure and unit-tested:
 * • KINDS: every notification kind with its tab, base importance, default channels and Arabic wording
 * • grouping of similar notifications («أحمد و5 آخرون أعجبهم منشورك»)
 * • importance ranking (base importance + relationship + unread + group size − age)
 * • quiet hours in the user's own timezone (overnight windows, urgent bypass) */

/* tab: center tab · imp: base importance 0–100 · ch: default channels · group: similar ones collapse
 * v: [one, two, many] verb phrases (the actor names come first) · lock: channels the user cannot turn off */
const KINDS = {
  mention: { tab: "mentions", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["أشار إليك", "أشارا إليك", "أشاروا إليك"], label: "الإشارات إليك" },
  reply: { tab: "mentions", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["ردّ على تعليقك", "ردّا على تعليقك", "ردّوا على تعليقك"], label: "الردود على تعليقاتك" },
  follow: { tab: "follows", imp: 45, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["بدأ بمتابعتك", "بدآ بمتابعتك", "بدؤوا بمتابعتك"], label: "متابعون جدد" },
  follow_request: { tab: "follows", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["طلب متابعتك", "طلبا متابعتك", "طلبوا متابعتك"], label: "طلبات المتابعة" },
  follow_approved: { tab: "follows", imp: 50, ch: { inapp: 1, push: 1, email: 0 }, v: ["قبل طلب متابعتك", "قبلا طلب متابعتك", "قبلوا طلب متابعتك"], label: "قبول طلبات المتابعة" },
  reaction: { tab: "interactions", imp: 30, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["أعجبه منشورك", "أعجبهما منشورك", "أعجبهم منشورك"], label: "الإعجابات والتفاعلات" },
  comment: { tab: "interactions", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["علّق على منشورك", "علّقا على منشورك", "علّقوا على منشورك"], label: "التعليقات" },
  join_request: { tab: "communities", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["طلب الانضمام إلى مجتمعك", "طلبا الانضمام إلى مجتمعك", "طلبوا الانضمام إلى مجتمعك"], label: "طلبات الانضمام" },
  approved: { tab: "communities", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, v: ["قبل طلب انضمامك", "قبلا طلب انضمامك", "قبلوا طلب انضمامك"], label: "قبول الانضمام" },
  post_approved: { tab: "communities", imp: 50, ch: { inapp: 1, push: 1, email: 0 }, v: ["وافق على منشورك في المجتمع"], label: "الموافقة على المنشورات" },
  invite: { tab: "communities", imp: 60, ch: { inapp: 1, push: 1, email: 1 }, v: ["دعاك للانضمام", "دعواك للانضمام", "دعوك للانضمام"], label: "الدعوات" },
  community_welcome: { tab: "communities", imp: 25, ch: { inapp: 1, push: 0, email: 0 }, v: ["يرحّب بك في المجتمع"], label: "الترحيب بالمجتمعات" },
  mod_warning: { tab: "communities", imp: 70, ch: { inapp: 1, push: 1, email: 1 }, v: ["وجّه إليك تنبيهاً من مشرفي المجتمع"], label: "تنبيهات المشرفين" },
  // v2.62 community auto-guard (ref = guardRef(cid, {n, max, hours}); the text never carries the matched words)
  autoguard_strike: { tab: "communities", imp: 80, ch: { inapp: 1, push: 1, email: 1 }, v: ["وصلك تحذير من الحارس التلقائي في المجتمع"], fmt: (d) => guardStrikeText(d), label: "تحذيرات الحارس التلقائي", system: 1 },
  autoguard_lock: { tab: "communities", imp: 85, ch: { inapp: 1, push: 1, email: 1 }, v: ["أُوقفت عن الكتابة في المجتمع حتى يرفع مشرف الإيقاف"], label: "الإيقاف عن الكتابة (الحارس التلقائي)", system: 1 },
  community_transfer: { tab: "communities", imp: 75, ch: { inapp: 1, push: 1, email: 1 }, v: ["طلب نقل ملكية مجتمع إليك"], label: "نقل ملكية المجتمعات" },
  community_digest: { tab: "communities", imp: 30, ch: { inapp: 1, push: 1, email: 0 }, v: ["ملخص اليوم: منشورات جديدة في مجتمعك"], label: "الملخص اليومي للمجتمعات" },
  community_announcement: { tab: "communities", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["نشر إعلاناً مهماً في المجتمع"], label: "إعلانات المجتمعات المهمة" },
  mod_appeal: { tab: "communities", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, v: ["قدّم استئنافاً في مجتمعك"], label: "استئنافات الأعضاء (للمشرفين)" },
  mod_assigned: { tab: "communities", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, v: ["أسند إليك عنصراً للمراجعة"], label: "إسناد المراجعة (للمشرفين)" },
  appeal_decided: { tab: "communities", imp: 70, ch: { inapp: 1, push: 1, email: 1 }, v: ["بتّ في استئنافك"], label: "قرارات الاستئناف" },
  mod_digest: { tab: "communities", imp: 40, ch: { inapp: 1, push: 0, email: 0 }, v: ["لديك عناصر بانتظار المراجعة في مجتمعك"], label: "ملخص الإشراف" },
  event: { tab: "communities", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["تذكير: حدث يبدأ قريباً"], label: "تذكيرات الأحداث" },
  waitlist_promoted: { tab: "communities", imp: 65, ch: { inapp: 1, push: 1, email: 1 }, v: ["أصبح لك مقعد مؤكد في الحدث"], label: "قائمة الانتظار" },
  org_invite: { tab: "communities", imp: 60, ch: { inapp: 1, push: 1, email: 1 }, v: ["دعاك للانضمام إلى فريق مؤسسته"], label: "دعوات المؤسسات" },
  message: { tab: "messages", imp: 80, ch: { inapp: 0, push: 1, email: 0 }, group: 1, v: ["أرسل إليك رسالة", "أرسلا إليك رسائل", "أرسلوا إليك رسائل"], label: "الرسائل الخاصة" },
  message_request: { tab: "messages", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["يريد مراسلتك"], label: "طلبات المراسلة" },
  call: { tab: "messages", imp: 100, ch: { inapp: 0, push: 1, email: 0 }, v: ["يتصل بك الآن"], label: "المكالمات الواردة" },
  call_missed: {
    tab: "messages",
    imp: 70,
    ch: { inapp: 1, push: 1, email: 0 },
    group: 1,
    v: ["فاتتك مكالمة منه", "فاتتك مكالمات منهما", "فاتتك مكالمات منهم"],
    label: "المكالمات الفائتة"
  },
  security_login: {
    tab: "system",
    imp: 95,
    ch: { inapp: 1, push: 1, email: 1 },
    lock: ["inapp", "email"],
    v: ["تسجيل دخول من جهاز جديد"],
    label: "تنبيهات الأمان",
    system: 1
  },
  security_password: {
    tab: "system",
    imp: 95,
    ch: { inapp: 1, push: 1, email: 1 },
    lock: ["inapp", "email"],
    v: ["تم تغيير كلمة المرور"],
    label: "تغيير كلمة المرور",
    system: 1
  },
  security_failed: {
    tab: "system",
    imp: 95,
    ch: { inapp: 1, push: 1, email: 1 },
    lock: ["inapp", "email"],
    v: ["محاولات دخول فاشلة متكررة على حسابك"],
    label: "محاولات الدخول الفاشلة",
    system: 1
  }, // v2.79
  security_staff2fa: {
    tab: "system",
    imp: 95,
    ch: { inapp: 1, push: 1, email: 1 },
    lock: ["inapp"],
    v: ["فعّل التحقق بخطوتين للإبقاء على صلاحيات الإشراف"],
    label: "سياسة أمان الفريق",
    system: 1
  }, // v2.79
  security_email: {
    tab: "system",
    imp: 90,
    ch: { inapp: 1, push: 1, email: 1 },
    lock: ["inapp", "email"],
    v: ["تم تغيير البريد الإلكتروني للحساب"],
    label: "تغيير البريد",
    system: 1
  },
  removed: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 1 }, v: ["أُزيل محتوى لك لمخالفته الإرشادات"], label: "قرارات الإشراف", system: 1 },
  video: { tab: "system", imp: 40, ch: { inapp: 1, push: 1, email: 0 }, v: ["اكتملت معالجة الفيديو الخاص بك"], label: "معالجة الفيديو", system: 1 },
  scheduled: { tab: "system", imp: 40, ch: { inapp: 1, push: 1, email: 0 }, v: ["نُشر منشورك المجدول"], label: "المنشورات المجدولة", system: 1 },
  read_later: { tab: "system", imp: 35, ch: { inapp: 1, push: 1, email: 0 }, v: ["تذكير: منشور حفظته لتقرأه لاحقاً"], label: "تذكيرات «اقرأ لاحقاً»", system: 1 },
  search_alert: { tab: "system", imp: 35, ch: { inapp: 1, push: 0, email: 0 }, v: ["نتائج جديدة لبحثك المحفوظ"], label: "تنبيهات البحث", system: 1 },
  achievement: { tab: "system", imp: 35, ch: { inapp: 1, push: 0, email: 0 }, v: ["حصلت على شارة جديدة"], label: "الشارات", system: 1 },
  verified: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 1 }, v: ["تم توثيق حسابك"], label: "التوثيق", system: 1 },
  verification_rejected: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 1 }, v: ["لم يُقبل طلب التوثيق"], label: "رفض التوثيق", system: 1 },
  welcome: { tab: "system", imp: 20, ch: { inapp: 1, push: 0, email: 0 }, v: ["يرحّب بك مجتمع بلس"], label: "الترحيب", system: 1 },
  // phase 37 — tips & creator support (tpl: wording for a single actor when the verb does not simply follow the name)
  tip: { tab: "interactions", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["أرسل لك إكرامية", "أرسلا لك إكراميات", "أرسلوا لك إكراميات"], tpl: (a) => `أرسل لك ${a} إكرامية`, label: "الإكراميات" },
  tip_anon: { tab: "interactions", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["وصلتك إكرامية من داعم مجهول"], label: "الإكراميات المجهولة", system: 1 },
  support_started: { tab: "interactions", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["بدأ دعمك شهرياً", "بدآ دعمك شهرياً", "بدؤوا دعمك شهرياً"], label: "الداعمون الجدد" },
  support_renewed: { tab: "interactions", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, group: 1, v: ["جدّد دعمه الشهري لك", "جدّدا دعمهما الشهري لك", "جدّدوا دعمهم الشهري لك"], label: "تجديد الدعم" },
  support_anon: { tab: "interactions", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["وصلك دعم شهري من داعم مجهول"], label: "الدعم المجهول", system: 1 },
  support_due: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["اقترب موعد تجديد دعمك الشهري"], label: "تذكير تجديد الدعم", system: 1 },
  support_lapsed: { tab: "system", imp: 45, ch: { inapp: 1, push: 0, email: 0 }, v: ["انتهى دعمك الشهري لعدم التجديد"], label: "انتهاء الدعم", system: 1 },
  // phase 38 — paid content
  ppv_purchased: { tab: "interactions", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["اشترى منشورك المدفوع", "اشتريا منشورك المدفوع", "اشتروا منشورك المدفوع"], label: "مبيعات المحتوى المدفوع" },
  ppv_refunded: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["أُعيد إليك مبلغ محتوى مدفوع اشتريته"], label: "استرداد المشتريات", system: 1 },
  paid_refund_rejected: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["لم يُقبل طلب استرداد مبلغ محتوى مدفوع"], label: "قرارات الاسترداد", system: 1 },
  paid_refundable: { tab: "system", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, v: ["تغيّر منشور مدفوع اشتريته؛ يمكنك طلب الاسترداد خلال ٢٤ ساعة"], label: "تغيّر المحتوى المشترى", system: 1 },
  // phase 39 — community marketplace (ref = order id; market_review: ref = the seller's handle)
  market_order_new: { tab: "interactions", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["طلب منتجك في السوق", "طلبا منتجك في السوق", "طلبوا منتجك في السوق"], label: "طلبات السوق الجديدة" },
  market_order_paid: { tab: "interactions", imp: 80, ch: { inapp: 1, push: 1, email: 0 }, v: ["دفع ثمن طلبه؛ المبلغ محفوظ لدى الضمان", "دفعا ثمن طلباتهما", "دفعوا ثمن طلباتهم"], label: "مدفوعات طلبات السوق" },
  market_order_shipped: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["شحن طلبك من السوق"], label: "شحن طلبات السوق" },
  market_order_delivered: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["أكّد تسليم طلبك؛ أكّد الاستلام أو افتح نزاعاً"], label: "تسليم طلبات السوق" },
  market_order_completed: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["اكتمل طلب في السوق وأُفرج عن المبلغ"], label: "اكتمال طلبات السوق", system: 1 },
  market_review: { tab: "interactions", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, group: 1, v: ["قيّم تعاملك معه في السوق", "قيّما تعاملك في السوق", "قيّموا تعاملك في السوق"], label: "تقييمات السوق" },
  market_dispute_opened: { tab: "system", imp: 85, ch: { inapp: 1, push: 1, email: 1 }, v: ["فتح نزاعاً على طلب في السوق"], label: "نزاعات السوق" },
  market_dispute_resolved: { tab: "system", imp: 80, ch: { inapp: 1, push: 1, email: 1 }, v: ["حُسم نزاع على طلبك في السوق"], label: "قرارات نزاعات السوق", system: 1 },
  // phase 40 — ethical ads (ref = campaign id)
  ad_approved: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["تمت الموافقة على حملتك الإعلانية"], label: "الموافقة على الحملات الإعلانية", system: 1 },
  ad_rejected: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 1 }, v: ["لم تُقبل حملتك الإعلانية؛ اطّلع على سبب المراجعة"], label: "رفض الحملات الإعلانية", system: 1 },
  ad_budget_low: { tab: "system", imp: 55, ch: { inapp: 1, push: 0, email: 0 }, v: ["أوشكت ميزانية حملتك الإعلانية على النفاد"], label: "انخفاض ميزانية الحملات", system: 1 },
  ad_completed: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["انتهت حملتك الإعلانية؛ اطّلع على النتائج"], label: "انتهاء الحملات الإعلانية", system: 1 },
  // phase 41 — AI subscriptions (ref = plan slug)
  ai_subscribed: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["تم تفعيل اشتراكك في «مجتمع+ ذكاء»"], label: "تفعيل اشتراكات الذكاء", system: 1 },
  ai_renew_reminder: { tab: "system", imp: 55, ch: { inapp: 1, push: 1, email: 1 }, v: ["ينتهي اشتراكك في «مجتمع+ ذكاء» خلال أيام؛ جدّده للاستمرار"], label: "تذكير بتجديد اشتراك الذكاء", system: 1 },
  ai_expired: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["انتهى اشتراكك في «مجتمع+ ذكاء»"], label: "انتهاء اشتراك الذكاء", system: 1 },
  // phase 45 — digital wellbeing (ref = ISO week, e.g. 2026-W42)
  wellbeing_weekly: { tab: "system", imp: 25, ch: { inapp: 1, push: 0, email: 0 }, v: ["تقرير استخدامك الأسبوعي جاهز"], label: "تقرير الاستخدام الأسبوعي", system: 1 },
  // phase 49 — on-call alerts for admins (ref = alert rule id)
  ops_alert: { tab: "system", imp: 90, ch: { inapp: 1, push: 1, email: 0 }, v: ["تنبيه تشغيلي: قاعدة مراقبة تغيّرت حالتها"], label: "تنبيهات التشغيل والمراقبة", system: 1 },
  // phase 56 — Pi transfers (ref = transfer id) and payment requests (ref = request id)
  pi_transfer_received: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["أرسل إليك تحويل Pi"], label: "تحويلات Pi الواردة" },
  pi_transfer_held: { tab: "system", imp: 60, ch: { inapp: 1, push: 0, email: 0 }, v: ["تحويلك قيد المراجعة قبل وصوله"], label: "تحويلات Pi قيد المراجعة", system: 1 },
  pi_transfer_rejected: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["لم يُعتمد تحويلك وسيُعاد المبلغ"], label: "رفض تحويلات Pi", system: 1 },
  pi_request_received: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["يطلب منك دفعة Pi"], label: "طلبات دفع Pi" },
  pi_request_paid: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["دفع طلبك بعملة Pi"], label: "دفع طلباتك" },
  pi_request_declined: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["رفض طلب الدفع الذي أرسلته"], label: "رفض طلبات الدفع" },
  // phase 57 — creator subscriptions (ref = creator handle, or support id for sub_upgraded)
  sub_grace: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["انتهى اشتراكك — جدّده خلال فترة السماح لتحتفظ بمزاياك"], label: "فترة السماح للاشتراكات", system: 1 },
  sub_upgraded: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["رقّى اشتراكه إلى مستوى أعلى"], label: "ترقيات الاشتراك" },
  sub_channel: { tab: "system", imp: 45, ch: { inapp: 1, push: 0, email: 0 }, v: ["نشر رسالة جديدة في قناة المشتركين"], label: "قناة المشتركين" },
  // phase 54 — beta feedback (ref = feedback id); phase 59 — contribution points (ref = level number / redemption id)
  beta_feedback_reply: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["ردّ الفريق على ملاحظتك في النسخة التجريبية"], label: "ردود ملاحظات النسخة التجريبية", system: 1 },
  points_level_up: { tab: "system", imp: 45, ch: { inapp: 1, push: 0, email: 0 }, v: ["ارتقيت إلى مستوى جديد في نقاط المساهمة"], label: "مستويات نقاط المساهمة", system: 1 },
  points_redemption: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["تحدّث طلب استبدال نقاطك بمكافأة Pi"], label: "استبدال النقاط بمكافآت Pi", system: 1 },
  // phase 66 — nearby places (ref = place id); phase 71 — study groups (ref = session id; study_progress: ref = group id)
  place_approved: { tab: "system", imp: 50, ch: { inapp: 1, push: 1, email: 0 }, v: ["تمت الموافقة على المكان الذي أضفته إلى الخريطة"], label: "قبول الأماكن المضافة", system: 1 },
  place_rejected: { tab: "system", imp: 45, ch: { inapp: 1, push: 0, email: 0 }, v: ["لم يُقبل المكان الذي أضفته؛ اطّلع على السبب"], label: "رفض الأماكن المضافة", system: 1 },
  place_review: { tab: "system", imp: 40, ch: { inapp: 1, push: 0, email: 0 }, v: ["قيّم أحد الأعضاء مكاناً أضفته إلى الخريطة"], label: "تقييمات الأماكن التي أضفتها" },
  study_assignment: { tab: "communities", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["واجب جديد في مجموعتك الدراسية"], label: "واجبات مجموعات الدراسة" },
  study_feedback: { tab: "communities", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["راجع معلّمك واجبك وترك لك ملاحظة"], label: "ملاحظات المعلّم على الواجبات" },
  study_session_soon: { tab: "communities", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["تذكير: جلسة مجموعتك الدراسية تبدأ قريباً"], label: "تذكيرات جلسات الدراسة والحلقات", system: 1 },
  study_session_live: { tab: "communities", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["بدأت جلسة مجموعتك الدراسية الآن"], label: "بدء جلسات الدراسة والحلقات", system: 1 },
  study_progress: { tab: "communities", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, v: ["سجّل معلّمك تسميعاً جديداً لك في الحلقة"], label: "سجل الحفظ والتسميع", system: 1 },
  // phase 62 — series + schedule (ref = post id); phase 67 — business claims (ref = place id); phase 72 — courses (ref = course id)
  series_episode: { tab: "follows", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["نشر حلقة جديدة في سلسلة تتابعها"], label: "حلقات جديدة في السلاسل التي تتابعها", group: 1 },
  schedule_failed: { tab: "system", imp: 80, ch: { inapp: 1, push: 1, email: 0 }, v: ["تعذّر نشر منشورك المجدول؛ راجع قائمة الجدولة"], label: "تعذّر نشر منشور مجدول", system: 1 },
  biz_claim_approved: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["تمت الموافقة على طلب إدارة نشاطك التجاري"], label: "طلبات إدارة الأنشطة التجارية", system: 1 },
  biz_claim_rejected: { tab: "system", imp: 55, ch: { inapp: 1, push: 0, email: 0 }, v: ["لم يُقبل طلب إدارة النشاط التجاري؛ اطّلع على السبب"], label: "رفض طلبات إدارة الأنشطة التجارية", system: 1 },
  course_completed: { tab: "communities", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["أتممت الدورة، مبارك!"], label: "إتمام الدورات", system: 1 },
  course_lesson: { tab: "communities", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["أُضيف درس جديد إلى دورة مسجّل فيها"], label: "دروس جديدة في دوراتك", system: 1 },
  // phase 63 — collaborations (ref = deal / campaign / post id); phase 68 — seasons (ref = season key); phase 73 — certificates (ref = code)
  collab_offer: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["وصلك عرض تعاون جديد"], label: "عروض التعاون والطلبات على حملاتك", system: 1 },
  collab_update: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["تحديث على اتفاق تعاون"], label: "تحديثات اتفاقات التعاون", system: 1 },
  collab_message: { tab: "system", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, v: ["رسالة جديدة في غرفة اتفاق التعاون"], label: "رسائل اتفاقات التعاون", group: 1, system: 1 },
  collab_deliverable: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["سلّم الصانع عملاً بانتظار مراجعتك"], label: "تسليمات التعاون", system: 1 },
  collab_campaign: { tab: "system", imp: 60, ch: { inapp: 1, push: 0, email: 0 }, v: ["راجع فريق المنصة حملتك"], label: "مراجعة الحملات", system: 1 },
  collab_labelled: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["أضاف فريق المنصة وسم «محتوى مدفوع» إلى منشورك"], label: "وسم الإفصاح من فريق المنصة", system: 1 },
  season_soon: { tab: "system", imp: 50, ch: { inapp: 1, push: 1, email: 0 }, v: ["يقترب موسم تتابعه"], label: "تذكير بقرب المواسم", system: 1 },
  season_start: { tab: "system", imp: 55, ch: { inapp: 1, push: 1, email: 0 }, v: ["بدأ الموسم — كل عام وأنتم بخير"], label: "بداية المواسم", system: 1 },
  cert_issued: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["صدرت لك شهادة جديدة موقّعة"], label: "الشهادات الجديدة", system: 1 },
  cert_revoked: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["سحبت الجهة المانحة إحدى شهاداتك"], label: "سحب الشهادات", system: 1 },
  // phase 74 — mentorship (ref = request id for mentor_request / mentor_reply, session id otherwise)
  mentor_request: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["وصلك طلب إرشاد جديد"], label: "طلبات الإرشاد الجديدة", system: 1 },
  mentor_reply: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["ردّ مرشد على طلبك"], label: "ردود المرشدين على طلباتك", system: 1 },
  mentor_booked: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["حُجزت معك جلسة إرشاد بانتظار تأكيدك"], label: "حجوزات جلسات الإرشاد", system: 1 },
  mentor_session: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["تحديث على جلسة إرشاد"], label: "تحديثات جلسات الإرشاد", system: 1 },
  mentor_reminder: { tab: "system", imp: 80, ch: { inapp: 1, push: 1, email: 0 }, v: ["جلسة الإرشاد تبدأ قريباً"], label: "تذكير بجلسات الإرشاد", system: 1 },
  mentor_feedback: { tab: "system", imp: 55, ch: { inapp: 1, push: 0, email: 0 }, v: ["اكتملت جلسة إرشاد — شاركنا تقييمك"], label: "تقييمات جلسات الإرشاد", system: 1 },
  mentor_guardian: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["نشاط إرشاد جديد لحساب مرتبط بك"], label: "إرشاد الحسابات المرتبطة (وليّ الأمر)", system: 1 },
  // M4-4/F9 a mentor the user saved opened new weekly periods (ref = the mentor's public handle; actor = the mentor; ≤ 1 per 24 h per saver)
  mentor_slots: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["فتح مرشد حفظته مواعيد جديدة"], tpl: (a) => `فتح ${a} مواعيد إرشاد جديدة`, label: "مواعيد جديدة لدى مرشدين حفظتهم", system: 1 },
  // M3-5/F6 weekly summary to the guardian of a minor mentee (ref = weeklyRef(...); actor = the minor; counts + goal titles only, never notes)
  mentor_weekly: { tab: "system", imp: 45, ch: { inapp: 1, push: 1, email: 0 }, v: ["ملخص الإرشاد الأسبوعي لحساب مرتبط بك"], fmt: (d, names) => weeklyText(d, names), parse: (ref) => parseWeeklyRef(ref), label: "ملخص الإرشاد الأسبوعي (وليّ الأمر)", system: 1 },
  // phase 65 — verified creators program (ref = application id / user id) and support fund (ref = round id / grant application id)
  vc_approved: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["أصبحت صانعاً موثّقاً في مجتمع+"], label: "قبول التوثيق كصانع", system: 1 },
  vc_rejected: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["صدر قرار طلبك في برنامج الصنّاع الموثّقين"], label: "قرارات برنامج الصنّاع", system: 1 },
  vc_revoked: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["سحب فريق المنصة توثيقك كصانع"], label: "سحب توثيق الصانع", system: 1 },
  vc_renew: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["اقترب موعد تجديد توثيقك كصانع"], label: "تجديد توثيق الصانع", system: 1 },
  fund_round: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["فُتحت جولة جديدة في صندوق دعم الصنّاع"], label: "جولات صندوق الدعم", system: 1 },
  fund_decision: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["صدر قرار طلبك في صندوق دعم الصنّاع"], label: "قرارات صندوق الدعم", system: 1 },
  fund_paid: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["صُرفت منحتك من صندوق دعم الصنّاع"], label: "صرف منح الصندوق", system: 1 },
  // phase 70 — volunteering & charity (ref = opportunity id / campaign id / organisation id)
  vol_signup: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["تسجيل جديد في فرصة تطوّع لجهتك"], label: "تسجيلات فرص التطوّع (لإدارة الجهة)", system: 1 },
  vol_decision: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["صدر رد على تسجيلك في فرصة تطوّع"], label: "ردود الجهات على تسجيلك للتطوّع", system: 1 },
  vol_hours: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["أُكّدت ساعات تطوّعك وصدرت شهادتك"], label: "تأكيد ساعات التطوّع", system: 1 },
  charity_update: { tab: "system", imp: 55, ch: { inapp: 1, push: 0, email: 0 }, v: ["تحديث جديد في حملة تبرّعت لها"], label: "تحديثات الحملات التي دعمتها", system: 1 },
  charity_review: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["تغيّرت حالة حملة لجهتك"], label: "مراجعة حملات جهتك", system: 1 },
  charity_org: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["صدر قرار فريق المنصة بشأن جهتك"], label: "قرارات التحقق من الجهات", system: 1 },
  charity_guardian: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["نشاط تطوّع جديد لحساب مرتبط بك"], label: "تطوّع الحسابات المرتبطة (وليّ الأمر)", system: 1 },
  // phase 75 — open knowledge library (ref = article id)
  kb_decision: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["صدر قرار المراجعة على مساهمتك في المكتبة المعرفية"], label: "قرارات مراجعة مساهماتك في المكتبة", system: 1 },
  kb_edited: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["اعتُمد تعديل جديد على مقالتك في المكتبة المعرفية"], label: "تعديلات الآخرين على مقالاتك", system: 1 },
  kb_reviewer: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["أصبحت مراجعاً في المكتبة المعرفية"], label: "تعيينك مراجعاً في المكتبة", system: 1 },
  // phase 76 — professional profile moderation (ref = handle)
  pro_hidden: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["أخفى فريق المنصة ملفك المهني مؤقتاً"], label: "قرارات الإشراف على ملفك المهني", system: 1 },
  pro_restored: { tab: "system", imp: 60, ch: { inapp: 1, push: 0, email: 0 }, v: ["أُعيد عرض ملفك المهني"], label: "إعادة عرض ملفك المهني", system: 1 },
  // phase 77 — jobs & freelance (ref = application id for job_app_*, job id otherwise)
  job_app_new: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["تقدّم شخص لإعلانك"], label: "طلبات جديدة على إعلاناتك", system: 1 },
  job_app_status: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["تغيّرت حالة طلبك على فرصة عمل"], label: "تحديثات طلبات التوظيف", system: 1 },
  job_app_msg: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["رسالة جديدة بخصوص طلب توظيف"], label: "رسائل طلبات التوظيف", system: 1 },
  job_approved: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["نُشر إعلانك بعد المراجعة"], label: "اعتماد إعلاناتك", system: 1 },
  job_removed: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["أزال فريق المنصة إعلانك"], label: "إزالة إعلاناتك", system: 1 },
  job_review: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["أُوقف إعلانك مؤقتاً للمراجعة بعد بلاغات"], label: "إيقاف إعلاناتك للمراجعة", system: 1 },
  // phase 78 — contracts (ref = contract id)
  contract_offer: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["وصلك عرض عقد جديد"], label: "عروض العقود", system: 1 },
  contract_status: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["تغيّرت حالة عقد"], label: "حالة العقود", system: 1 },
  contract_funded: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["مُوّلت مرحلة بالضمان — يمكنك البدء"], label: "تمويل المراحل", system: 1 },
  contract_submitted: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["سُلّمت مرحلة للمراجعة"], label: "تسليم المراحل", system: 1 },
  contract_review: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["رُوجع تسليمك"], label: "اعتماد المراحل وطلبات التعديل", system: 1 },
  contract_msg: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["رسالة جديدة في عقد"], label: "رسائل العقود", system: 1 },
  contract_dispute: { tab: "system", imp: 80, ch: { inapp: 1, push: 1, email: 0 }, v: ["فُتح نزاع على مرحلة في عقدك"], label: "نزاعات العقود", system: 1 },
  contract_resolved: { tab: "system", imp: 80, ch: { inapp: 1, push: 1, email: 0 }, v: ["حسم فريق المنصة نزاع العقد"], label: "قرارات النزاعات", system: 1 },
  // phase 79 — teams & projects (ref = team id)
  team_invite: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["دعوة للانضمام إلى فريق"], label: "دعوات الفرق", system: 1 },
  team_joined: { tab: "system", imp: 55, ch: { inapp: 1, push: 0, email: 0 }, v: ["انضم عضو إلى فريقك"], label: "انضمام أعضاء لفرقك", system: 1 },
  team_declined: { tab: "system", imp: 40, ch: { inapp: 1, push: 0, email: 0 }, v: ["لم تُقبل دعوة أو طلب انضمام"], label: "ردود الدعوات والطلبات", system: 1 },
  team_request: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["طلب انضمام إلى فريقك"], label: "طلبات الانضمام لفرقك", system: 1 },
  team_removed: { tab: "system", imp: 60, ch: { inapp: 1, push: 0, email: 0 }, v: ["أُزلت من فريق"], label: "الإزالة من الفرق", system: 1 },
  team_owner: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["أصبحت مالك فريق"], label: "نقل ملكية الفرق", system: 1 },
  team_task: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["أُسندت إليك مهمة"], label: "مهام الفرق", system: 1 },
  team_update: { tab: "system", imp: 50, ch: { inapp: 1, push: 0, email: 0 }, v: ["جديد في فريقك"], label: "تحديثات ونقاشات الفرق", system: 1 },
  prr_open: { tab: "system", imp: 55, ch: { inapp: 1, push: 0, email: 0 }, v: ["يمكنك الآن تقييم تعاملك المكتمل"], label: "دعوات تقييم الأعمال المكتملة", system: 1 },
  prr_waiting: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["قيّمك من عملت معه — قيّمه ليظهر التقييمان"], label: "تقييمات بانتظار تقييمك", system: 1 },
  prr_received: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["ظهر تقييم مهني جديد في ملفك"], label: "التقييمات المهنية الجديدة", system: 1 },
  prr_response: { tab: "system", imp: 45, ch: { inapp: 1, push: 0, email: 0 }, v: ["ردّ على تقييمك"], label: "الردود على تقييماتك", system: 1 },
  prr_endorsed: { tab: "system", imp: 45, ch: { inapp: 1, push: 0, email: 0 }, v: ["أيّد زميل مهاراتك"], label: "تأييد المهارات", system: 1 },
  prr_moderated: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["قرار فريق المنصة بشأن تقييمك"], label: "قرارات التقييمات المهنية", system: 1 },
  mjt_received: { tab: "system", imp: 60, ch: { inapp: 1, push: 1, email: 0 }, v: ["وصلك تحويل من مجتمع كوين (MJT)"], label: "تحويلات مجتمع كوين", system: 1 },
  clip_challenge_win: { tab: "system", imp: 75, ch: { inapp: 1, push: 1, email: 0 }, v: ["فازت لقطتك في تحدي الأسبوع"], label: "نتائج تحديات فيديوتك", system: 1 }, // v2.78 (ref = challenge id)
  mjt_tip: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["وصلتك إكرامية مجتمع كوين على لقطتك"], label: "إكراميات اللقطات", system: 1 },
  mjt_adjusted: { tab: "system", imp: 60, ch: { inapp: 1, push: 0, email: 0 }, v: ["عدّل فريق المنصة رصيدك من مجتمع كوين"], label: "تعديلات رصيد مجتمع كوين", system: 1 },
  // phase 50 — support tickets (ref = ticket id) and ambassador decisions (ref = user id)
  support_reply: { tab: "system", imp: 70, ch: { inapp: 1, push: 1, email: 0 }, v: ["ردّ فريق الدعم على تذكرتك"], label: "ردود فريق الدعم", system: 1 },
  ambassador_approved: { tab: "system", imp: 65, ch: { inapp: 1, push: 1, email: 0 }, v: ["تم قبول طلبك لتكون سفيراً لمجتمع+"], label: "قبول طلب الانضمام للسفراء", system: 1 },
  ambassador_rejected: { tab: "system", imp: 55, ch: { inapp: 1, push: 0, email: 0 }, v: ["لم يُقبل طلب الانضمام إلى برنامج السفراء هذه المرة"], label: "رفض طلب الانضمام للسفراء", system: 1 },
  ambassador_revoked: { tab: "system", imp: 60, ch: { inapp: 1, push: 0, email: 0 }, v: ["تم إيقاف عضويتك في برنامج السفراء"], label: "إيقاف عضوية السفير", system: 1 }
};
const FALLBACK = { tab: "system", imp: 30, ch: { inapp: 1, push: 0, email: 0 }, v: ["لديك إشعار جديد"], label: "إشعارات أخرى", system: 1 };
/* ---------- v2.62 auto-guard: counts ride in ref («cid~n~max~hours», no migration); never the matched words ---------- */
const clampInt = (v, lo, hi) => { const x = Math.trunc(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : null; };
/** encode the community id plus the strike counters into a notification ref
 * @param {string} cid @param {{ n?: number, max?: number, hours?: number }} [c] */
function guardRef(cid, { n, max, hours } = {}) {
  const a = clampInt(n, 1, 99), b = clampInt(max, 1, 99), h = clampInt(hours, 0, 720) ?? 0;
  return a && b ? `${cid}~${Math.min(a, b)}~${b}~${h}` : String(cid);
}
/** decode a ref written by guardRef (a plain community id decodes with no counters) */
function parseGuardRef(ref) {
  const [cid, ...rest] = String(ref || "").split("~");
  if (rest.length !== 3) return { cid: cid || null, n: null, max: null, hours: null };
  const n = clampInt(rest[0], 1, 99), max = clampInt(rest[1], 1, 99), hours = clampInt(rest[2], 0, 720);
  return n && max ? { cid, n: Math.min(n, max), max, hours: hours ?? 0 } : { cid, n: null, max: null, hours: null };
}
const durText = (h) => h === 1 ? "ساعة" : h === 24 ? "يوم" : h % 24 === 0 ? `${h / 24} يوم` : `${h} ساعة`;
function guardStrikeText(d) {
  if (!d || !d.n || !d.max) return null;
  const base = `تحذير ${d.n} من ${d.max} في المجتمع: لم يُنشر نصك لاحتوائه عبارة ممنوعة`;
  return d.hours > 0 ? `${base} · لا يمكنك الكتابة لمدة ${durText(d.hours)}` : base;
}

const kindOf = (k) => KINDS[k] || FALLBACK;
const TABS = [["all", "الكل"], ["mentions", "الإشارات"], ["follows", "المتابعات"], ["interactions", "التفاعلات"], ["communities", "المجتمعات"], ["messages", "الرسائل"], ["system", "النظام"]];
const CHANNELS = ["inapp", "push", "email"];

/** effective channel switches for one kind: defaults ← legacy prefs.settings.notify ← per-kind overrides; locks win */
/* M3-5/F6 weekly mentoring summary: "mw1|<ISO week>|<minor id>|<done>|<upcoming>|<goals done>|<goals total>|<title>|<title>…"
 *  titles are URI-encoded, ≤3 kept, each ≤40 chars. Only counts and goal titles travel — never session notes or feedback. */
const WEEKLY_TITLES = 3, WEEKLY_TITLE_LEN = 40;
const cnt = (v) => Math.max(0, Math.min(999, Math.floor(Number(v) || 0)));
function weeklyRef(week, minorId, { done = 0, upcoming = 0, goalsDone = 0, goalsTotal = 0, titles = [] } = {}) {
  const t = (Array.isArray(titles) ? titles : []).map((x) => String(x ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, WEEKLY_TITLES)
    .map((x) => encodeURIComponent(x.length > WEEKLY_TITLE_LEN ? x.slice(0, WEEKLY_TITLE_LEN - 1) + "…" : x));
  return ["mw1", week, minorId, cnt(done), cnt(upcoming), cnt(goalsDone), cnt(goalsTotal), ...t].join("|");
}
function parseWeeklyRef(ref) {
  const p = String(ref || "").split("|"); if (p[0] !== "mw1" || p.length < 7) return null;
  const dec = (x) => { try { return decodeURIComponent(x); } catch { return ""; } };
  return { week: p[1], minor: p[2], done: cnt(p[3]), upcoming: cnt(p[4]), goalsDone: cnt(p[5]), goalsTotal: cnt(p[6]), titles: p.slice(7, 7 + WEEKLY_TITLES).map(dec).filter(Boolean) };
}
/** Arabic source text; en comes from the client catalogue ({name} / {n} patterns; goal titles stay as typed) */
function weeklyText(d, names = []) {
  if (!d) return null;
  const who = names && names[0] ? `ملخص الإرشاد الأسبوعي لـ${names[0]}` : "ملخص الإرشاد الأسبوعي";
  const base = `${who}: جلسات مكتملة ${d.done} · قادمة ${d.upcoming} · الأهداف المنجزة ${d.goalsDone} من ${d.goalsTotal}`;
  return d.titles.length ? `${base} — ${d.titles.join("، ")}` : base;
}

function channelsFor(kind, overrides = {}, legacy = {}) {
  const K = kindOf(kind), out = { ...K.ch };
  if (legacy && legacy[kind] === false) for (const c of CHANNELS) out[c] = 0; // pre-v2.7 per-kind switch meant "off"
  const o = overrides?.[kind] || {};
  for (const c of CHANNELS) if (o[c] !== undefined) out[c] = o[c] ? 1 : 0;
  for (const c of K.lock || []) out[c] = 1;
  return out;
}

/* ---------- Arabic wording ---------- */
/** «أحمد» · «أحمد وسارة» · «أحمد وشخصان آخران» · «أحمد و5 آخرون» · «أحمد و12 شخصاً آخر» */
function actorsText(names, total = names.length) {
  const n = Math.max(total, names.length), a = names[0] || "مجتمع بلس";
  if (n <= 1) return a;
  if (n === 2) return `${a} و${names[1] || "شخص آخر"}`;
  const k = n - 1;
  if (k === 2) return `${a} وشخصان آخران`;
  if (k <= 10) return `${a} و${k} آخرون`;
  return `${a} و${k} شخصاً آخر`;
}
function verbFor(kind, n) { const v = kindOf(kind).v; return n <= 1 ? v[0] : n === 2 ? v[1] || v[v.length - 1] : v[2] || v[v.length - 1]; }
/** full sentence for a (possibly grouped) notification */
function sentence(kind, names, total, ref = null) { const K = kindOf(kind); if (K.fmt) { const t = K.fmt(K.parse ? K.parse(ref) : parseGuardRef(ref), names); if (t) return t; } if (K.system && !names.length) return verbFor(kind, 1); if (K.tpl && names.length && Math.max(total || 0, names.length) <= 1) return K.tpl(names[0]); return `${actorsText(names, total)} ${verbFor(kind, Math.max(total || 0, names.length))}`; }

/* ---------- grouping ---------- */
const GROUP_WINDOW_MS = 48 * 3600e3;
const groupKey = (n) => kindOf(n.kind).group ? `${n.kind}:${n.post || n.ref || (n.kind === "follow" || n.kind === "follow_request" ? "me" : n.id)}` : `${n.kind}:${n.id}`;
/** collapse similar notifications (same kind + same target, within 48 h of the newest one, same read state)
 *  input newest-first; output newest-first groups { key, kind, ids, actors (distinct, newest first), count, at, read } */
function group(list, { windowMs = GROUP_WINDOW_MS } = {}) {
  const out = [], open = new Map();
  for (const n of list) {
    const k = groupKey(n) + (n.read ? ":r" : ":u");
    const g = open.get(k);
    if (g && Date.parse(g.at) - Date.parse(n.at) <= windowMs) {
      g.ids.push(n.id); g.items.push(n);
      if (n.actor && !g.actors.includes(n.actor)) g.actors.push(n.actor);
      g.importance = Math.max(g.importance, n.importance || 0);
      continue;
    }
    const ng = { key: groupKey(n), kind: n.kind, ids: [n.id], items: [n], actors: n.actor ? [n.actor] : [], post: n.post || null, ref: n.ref || null, at: n.at, read: !!n.read, importance: n.importance || kindOf(n.kind).imp };
    open.set(k, ng); out.push(ng);
  }
  for (const g of out) g.count = g.actors.length || g.ids.length;
  return out;
}

/* ---------- importance ranking ---------- */
/** importance at write time: kind base + relationship with the actor (0–100) */
function importanceAtWrite(kind, { follows = false, mutual = false, verified = false } = {}) {
  return Math.min(100, kindOf(kind).imp + (mutual ? 15 : follows ? 10 : 0) + (verified ? 5 : 0));
}
/** read-time score: unread first, recent first, larger groups slightly higher; urgent kinds never decay below their base */
function score(g, nowMs = Date.now()) {
  const ageH = Math.max(0, (nowMs - new Date(g.at).getTime()) / 3600e3);
  const decay = Math.min(40, ageH * 1.5);
  return (g.read ? 0 : 25) + (g.importance || 0) - (g.importance >= 90 ? 0 : decay) + Math.min(10, Math.log2((g.count || 1)) * 4);
}
function rank(groups, nowMs = Date.now()) { return groups.map(g => ({ ...g, score: Math.round(score(g, nowMs) * 10) / 10 })).sort((a, b) => b.score - a.score || (a.at < b.at ? 1 : -1)); }

/* ---------- quiet hours ---------- */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (s) => { const m = HHMM.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; };
function validTz(tz) { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }
/** minutes since local midnight in tz */
function localMinutes(date, tz) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: validTz(tz) ? tz : "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const h = +p.find(x => x.type === "hour").value, m = +p.find(x => x.type === "minute").value;
  return (h % 24) * 60 + m;
}
/** q = { enabled, start:"22:00", end:"07:00", tz } — supports windows that cross midnight; start==end means all day */
function inQuietHours(date, q) {
  if (!q || !q.enabled) return false;
  const s = toMin(q.start), e = toMin(q.end); if (s === null || e === null) return false;
  const t = localMinutes(date, q.tz);
  if (s === e) return true;
  return s < e ? t >= s && t < e : t >= s || t < e;
}
/** the instant quiet hours end (null if not in quiet hours) */
function quietEndsAt(date, q) {
  if (!inQuietHours(date, q)) return null;
  const t = localMinutes(date, q.tz), e = toMin(q.end);
  let mins = (e - t + 1440) % 1440; if (mins === 0) mins = 1440;
  const d = new Date(date.getTime() + mins * 60e3); d.setSeconds(0, 0); return d;
}
/** push decision for one notification: send now, defer until quiet end, or send now because it is urgent */
function pushDecision(date, q, importance) {
  if (!inQuietHours(date, q)) return { action: "send" };
  if (q.allowUrgent !== false && importance >= 90) return { action: "send", urgent: true };
  return { action: "defer", until: quietEndsAt(date, q) };
}

/** where a notification opens */
function hrefFor(n) {
  if (n.kind === "message" || n.kind === "message_request") return n.ref ? `/#/chat/${n.ref}` : "/#/messages";
  if (n.kind === "call" || n.kind === "call_missed") return "/#/messages";
  if (n.kind.startsWith("security_")) return "/#/security";
  if (n.kind === "follow_request") return "/#/privacy";
  if (n.kind === "market_review") return n.ref ? `/#/market/seller/${encodeURIComponent(n.ref)}` : "/#/market/orders";
  if (n.kind.startsWith("market_")) return n.ref ? `/#/market/orders/${n.ref}` : "/#/market/orders";
  if (n.kind.startsWith("ai_")) return "/#/ai";
  if (n.kind === "wellbeing_weekly") return "/#/wellbeing";
  if (n.kind === "ops_alert") return "/#/admin/ops";
  if (n.kind.startsWith("pi_request_")) return "/#/transfers/requests";
  if (n.kind.startsWith("pi_transfer_")) return n.ref ? `/#/transfers/${encodeURIComponent(n.ref)}` : "/#/transfers";
  if (n.kind === "sub_upgraded") return "/#/studio/subscribers";
  if (n.kind.startsWith("sub_")) return n.ref ? `/#/subs/${encodeURIComponent(n.ref)}${n.kind === "sub_channel" ? "/channel" : ""}` : "/#/supporting";
  if (n.kind.startsWith("place_")) return n.ref ? `/#/place/${encodeURIComponent(n.ref)}` : "/#/places/mine";
  if (n.kind === "study_session_soon" || n.kind === "study_session_live") return n.ref ? `/#/study/session/${encodeURIComponent(n.ref)}` : "/#/study";
  if (n.kind === "study_assignment" || n.kind === "study_feedback") return n.ref ? `/#/study/assignment/${encodeURIComponent(n.ref)}` : "/#/study";
  if (n.kind === "study_progress") return n.ref ? `/#/study/${encodeURIComponent(n.ref)}/progress` : "/#/study";
  if (n.kind === "series_episode" || n.kind === "schedule_failed") return n.kind === "schedule_failed" ? "/#/scheduled" : n.ref ? `/#/post/${encodeURIComponent(n.ref)}` : "/#/series";
  if (n.kind.startsWith("biz_")) return n.ref ? `/#/biz/${encodeURIComponent(n.ref)}` : "/#/biz";
  if (n.kind.startsWith("course_")) return n.ref ? `/#/course/${encodeURIComponent(n.ref)}` : "/#/courses";
  if (n.kind.startsWith("collab_")) return n.kind === "collab_campaign" ? (n.ref ? `/#/collabs/c/${encodeURIComponent(n.ref)}` : "/#/collabs") : n.kind === "collab_labelled" ? (n.ref ? `/#/post/${encodeURIComponent(n.ref)}` : "/#/collabs") : n.ref ? `/#/collabs/d/${encodeURIComponent(n.ref)}` : "/#/collabs/deals";
  if (n.kind.startsWith("season_")) return n.ref ? `/#/season/${encodeURIComponent(n.ref)}` : "/#/hijri";
  if (n.kind === "mentor_slots") return n.ref ? `/#/mentor/${encodeURIComponent(n.ref)}` : "/#/mentoring";
  if (n.kind.startsWith("mentor_")) return n.kind === "mentor_request" ? "/#/mentoring?tab=requests" : n.kind === "mentor_reply" ? "/#/mentors?tab=requests" : n.kind === "mentor_guardian" || n.kind === "mentor_weekly" ? "/#/mentors?tab=family" : n.ref ? `/#/msession/${encodeURIComponent(n.ref)}` : "/#/mentors?tab=sessions";
  if (n.kind.startsWith("vc_")) return "/#/creator-program";
  if (n.kind.startsWith("fund_")) return n.kind === "fund_round" ? (n.ref ? `/#/fund/r/${encodeURIComponent(n.ref)}` : "/#/fund") : n.ref ? `/#/fund/g/${encodeURIComponent(n.ref)}` : "/#/fund";
  if (n.kind.startsWith("vol_") || n.kind === "charity_guardian") return n.kind === "vol_hours" ? "/#/giving?tab=mine" : n.ref ? `/#/opportunity/${encodeURIComponent(n.ref)}` : "/#/giving?tab=volunteer";
  if (n.kind === "charity_org") return n.ref ? `/#/organisation/${encodeURIComponent(n.ref)}` : "/#/giving?tab=mine";
  if (n.kind.startsWith("charity_")) return n.ref ? `/#/campaign/${encodeURIComponent(n.ref)}` : "/#/giving";
  if (n.kind === "clip_challenge_win") return n.ref ? `/#/clips/challenge/${encodeURIComponent(n.ref)}` : "/#/clips/challenges";
  if (n.kind.startsWith("mjt_")) return "/#/mjt?tab=history";
  if (n.kind.startsWith("prr_")) return ["prr_received", "prr_endorsed"].includes(n.kind) ? "/#/reviews?tab=received" : ["prr_response", "prr_moderated"].includes(n.kind) ? "/#/reviews?tab=given" : "/#/reviews";
  if (n.kind.startsWith("pro_")) return "/#/cv";
  if (n.kind === "team_invite") return "/#/teams";
  if (n.kind.startsWith("team_")) return n.ref ? `/#/team/${encodeURIComponent(n.ref)}` : "/#/teams";
  if (n.kind.startsWith("contract_")) return n.ref ? `/#/contract/${encodeURIComponent(n.ref)}` : "/#/contracts";
  if (n.kind.startsWith("job_app_")) return n.ref ? `/#/application/${encodeURIComponent(n.ref)}` : "/#/jobs?tab=mine";
  if (n.kind.startsWith("job_")) return n.ref ? `/#/job/${encodeURIComponent(n.ref)}` : "/#/jobs?tab=mine";
  if (n.kind.startsWith("kb_")) return n.kind === "kb_reviewer" ? "/#/knowledge/review" : n.ref ? `/#/kb/${encodeURIComponent(n.ref)}` : "/#/knowledge";
  if (n.kind.startsWith("cert_")) return n.ref ? `/#/cert/${encodeURIComponent(n.ref)}` : "/#/certificates";
  if (n.kind === "support_reply") return n.ref ? `/#/tickets/${encodeURIComponent(n.ref)}` : "/#/tickets";
  if (n.kind.startsWith("ambassador_")) return "/#/ambassadors";
  if (n.kind.startsWith("ad_")) return n.ref ? `/#/ads/campaigns/${n.ref}` : "/#/ads";
  if (n.post) return `/#/post/${n.post}`;
  if (n.kind === "event" || n.kind === "waitlist_promoted") return n.ref ? `/#/event/${n.ref}` : "/#/home";
  if (n.kind === "community_transfer" && n.ref) return `/#/cadmin/${n.ref}`;
  if ((n.kind === "mod_appeal" || n.kind === "mod_assigned") && n.ref) return `/#/cadmin/${n.ref}?s=moderation${n.kind === "mod_appeal" ? "&t=appeals" : ""}`;
  if (n.kind === "appeal_decided" && n.ref) return `/#/cappeal/${n.ref}`;
  if (["join_request", "approved", "invite", "mod_warning", "mod_digest", "community_welcome", "community_announcement", "community_digest"].includes(n.kind) && n.ref) return `/#/c/${n.ref}`;
  if (n.kind.startsWith("autoguard_")) { const c = parseGuardRef(n.ref).cid; return c ? `/#/c/${encodeURIComponent(c)}` : "/#/communities"; }
  if (n.kind === "search_alert") return "/#/search";
  if (["tip", "tip_anon", "support_started", "support_renewed", "support_anon"].includes(n.kind)) return "/#/earnings";
  if (n.kind === "support_due" || n.kind === "support_lapsed") return n.ref ? `/#/u/${n.ref}/support` : "/#/supporting";
  if (["ppv_refunded", "paid_refund_rejected", "paid_refundable"].includes(n.kind)) return "/#/purchases";
  return "/#/notifications";
}

module.exports = { weeklyRef, parseWeeklyRef, weeklyText, guardRef, parseGuardRef, guardStrikeText, KINDS, TABS, CHANNELS, kindOf, channelsFor, actorsText, verbFor, sentence, groupKey, group, importanceAtWrite, score, rank, inQuietHours, quietEndsAt, pushDecision, localMinutes, validTz, toMin, hrefFor, GROUP_WINDOW_MS };
