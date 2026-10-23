# مجتمع بلس — المعمارية (v2.0.0)

## المبدأ
خدمات منفصلة منطقياً تتواصل عبر **نظام أحداث داخلي** (Event Bus) بدل الاستدعاء المباشر:
`POST_CREATED → (Notifications, Analytics, Trends, Feed cache)` — كل خدمة تشترك فيما يخصها.
الواجهة الأمامية لا تعرف قاعدة البيانات؛ تتعامل مع REST API ولقطة `bootstrap` خاصة بكل مستخدم.

## المحركات الـ24 من الوثيقة وأين تعيش
| # | المحرك | التنفيذ |
|---|---|---|
| 1 | Content Engine | `services/content.js`: 8 أنواع، حالات (draft/processing/scheduled/pending/published/archived/removed/deleted)، سجل تعديلات، هاشتاغات |
| 2 | Feed Engine | `services/discovery.js`: توليد مرشحين ← تقييم ← تنويع ← Cursor pagination + كاش |
| 3 | Social Graph | `services/users.js`: متابعة، حظر يقطع الرسم بالاتجاهين |
| 4 | Community Engine | `services/communities.js`: أدوار وصلاحيات، طابور مراجعة، إعدادات، دعوات |
| 5 | Discussion Engine | تعليقات متفرعة، أفضل إجابة، نقاشات بمواقف، تلخيص |
| 6 | Search Engine | بحث بالنية (المكان «في جدة»)، أشخاص/منشورات/مجتمعات/هاشتاغات/أحداث |
| 7–8 | Topic + Hashtag | تطبيع ذكي: `#الذكاء_الاصطناعي = #ذكاء_اصطناعي = #AI` |
| 9 | Trend Engine | سرعة × مشاركون فريدون × تنوع التفاعل، تخفيض سيطرة مستخدم واحد، `TREND_DETECTED` |
| 10 | Recommendation | تعلّم أوزان الاهتمامات، «استكشف»، فرصة عادلة للمبدع الجديد |
| 11 | Media Engine | `services/media.js`: فحص التوقيع الثنائي، تخزين كائنات، بث Range، تحويل الفيديو (720p/360p/poster) |
| 12–13 | Moderation + Trust & Safety | `services/safety.js`: بلاغات موزونة بدقة المُبلِّغ، قرارات، استئناف، سجل تدقيق |
| 14 | Reputation | سمعة لكل مجتمع على حدة + شارات |
| 15 | Creator Engine | `/api/creator/analytics`: وصول، أفضل أوقات النشر، مصادر الوصول |
| 16 | Event Engine | أحداث، حضور/اهتمام/تذكير قبل ساعة |
| 17 | Translation Layer | مزود قابل للتبديل (LibreTranslate)، لا يُستبدل النص الأصلي، كاش للترجمات |
| 18 | AI Layer | تلخيص استخراجي الآن؛ نقطة توصيل لنموذج لغوي |
| 19 | Analytics Engine | أحداث استخدام دون محتوى الرسائل أو عناوين IP |
| 20–22 | Notifications / Messaging / Profile | `services/messaging.js` + SSE للتحديث الفوري |
| 23 | Economy Layer | مدفوعات Pi: approve/complete من الخادم بمفتاح الخادم |
| 24 | Administration | DAU/MAU/الاحتفاظ/البلاغات/الاستئنافات/أفضل المبدعين والمجتمعات |

## التخزين (فصل منطقي)
`users, sessions, posts, post_versions, post_hashtags, comments, reactions, follows, communities, memberships, poll_votes, stance_votes, events, event_rsvps, media, conversations, messages, notifications, reports, decisions, appeals, audit_log, analytics_events, pi_payments`
الحقول الخاصة بكل نوع في `data` (JSONB) ← نوع محتوى جديد لا يحتاج إعادة بناء القاعدة.
مختبر على **PostgreSQL 17** و **SQLite**.

## الأمن
كلمات مرور scrypt · جلسات بتوكن عشوائي مخزّن مُجزّأً (SHA-256) في كوكي HttpOnly/SameSite · حماية CSRF بترويسة إلزامية · CSP وترويسات أمان · Rate limiting لكل عملية حساسة (تسجيل، نشر، تعليق، متابعة، دعوة، بلاغ، رسالة، رفع) · رصد النشاط الجماعي · تعقيم الوسائط ضد حقن CSS · فحص صلاحية الرؤية في كل قراءة.

## نقاط التوسع (من آلاف إلى ملايين)
| اليوم | عند التوسع |
|---|---|
| Event Bus داخل العملية | Redis Streams / Kafka (نفس الواجهة `bus.emit/on`) |
| Cache في الذاكرة | Redis |
| SSE من نفس الخادم | Redis pub/sub + عدة نسخ خلف موازن |
| تخزين محلي للوسائط | S3/R2 + CDN (نفس واجهة `put/url`) |
| مهام دورية داخل العملية | عامل منفصل + طابور مهام |
| بحث LIKE | OpenSearch/Meilisearch |

## الأحداث الداخلية
USER_REGISTERED, USER_FOLLOWED, USER_MENTIONED, POST_CREATED, POST_UPDATED, POST_DELETED, POST_REACTED, POST_PUBLISHED, POST_APPROVED, COMMENT_CREATED, COMMUNITY_CREATED, COMMUNITY_JOINED, COMMUNITY_JOIN_REQUESTED, REPORT_CREATED, CONTENT_REMOVED, APPEAL_CREATED, VIDEO_UPLOADED, MEDIA_READY, VIDEO_PROCESSED, TREND_DETECTED, MESSAGE_SENT, EVENT_CREATED, EVENT_REMINDER, INVITE_SENT, ABUSE_DETECTED

## API (مختصر)
`/api/auth/{register,login,logout,pi}` · `/api/me` · `/api/me/prefs` · `/api/bootstrap` · `/api/feed?mode=for|following|latest|discover|communities&cursor=` · `/api/posts[/:id[/view|vote|stance|accept|why|summary|comments]]` · `/api/comments` · `/api/reactions/:target` · `/api/follows/:id` · `/api/communities[/:id[/membership|members/:u|queue/:p|analytics|reputation]]` · `/api/events[/:id/rsvp/:kind]` · `/api/invites` · `/api/search?q=` · `/api/trends?scope=&key=` · `/api/tags/:tag` · `/api/media` · `/api/conversations` · `/api/messages` · `/api/notifications` · `/api/stream` (SSE) · `/api/reports` · `/api/appeals` · `/api/admin/*` · `/api/creator/analytics` · `/api/translate` · `/api/pi/payments/{approve,complete}` · `/api/health`
