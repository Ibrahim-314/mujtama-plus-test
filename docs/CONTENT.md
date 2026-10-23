# المسار الثالث — المحتوى وأدوات الإنشاء (v2.4.0)

## البنية
| الطبقة | الملف | الدور |
|---|---|---|
| مشترك | `richtext.js` | صيغة مستند مستقلة عن العرض (كتل + مقاطع منسقة)، محلل Markdown، تنقية، عرض HTML/نص/Markdown، وقت القراءة، الفهرس |
| خادم | `server/services/creation.js` | المسودات المتزامنة، مساعد الكتابة (إملاء + وسوم)، القوالب، القصص، السلاسل، تعليقات الفقرات، صفحات المقالات SSR + `sitemap.xml` + `robots.txt` |
| خادم | `server/services/media.js` + `lib/queue.js` + `worker.js` | طابور وسائط دائم: HLS (360p/720p) + MP4 احتياطي + صورة مصغرة ذكية، صوت AAC + موجة 64 عموداً، ترجمات SRT/VTT |
| خادم | `server/lib/asr.js` | تفريغ صوتي عربي عبر أي خادم Whisper متوافق (`OPENAI_API_KEY` أو `WHISPER_URL`) |
| خادم | `server/services/rooms.js` | الغرف الصوتية: أدوار، رفع اليد، ترقية، كتم، إشارات WebRTC، رموز LiveKit |
| خادم | `server/services/studio.js` + `lib/analytics.js` | الاستوديو: نظرة عامة، إحصاءات كل منشور، أفضل وقت، التقويم، إعادة النشر، التقرير الأسبوعي، ومصرف أحداث ClickHouse |
| واجهة | `content-ui.js` | المحرر بملء الشاشة، القارئ، القصص، الفيديو القصير، المشغلات، الغرف، الاستوديو |
| قاعدة | `server/migrations/007_content.js` | drafts, post_templates, story_views, media_jobs, rooms, room_members, post_views, comments.anchor, posts.expires_at |

## التشغيل في الإنتاج
- **العاملون:** `MEDIA_WORKER=external` على خوادم الـAPI، ثم `node server/worker.js` بالعدد المطلوب. يعتمد الطابور على `FOR UPDATE SKIP LOCKED` في PostgreSQL، مع إعادة محاولة بتراجع أُسّي (4 محاولات).
- **الغرف:** بدون إعداد تعمل بشبكة WebRTC مباشرة حتى 6 متحدثين. للتوسع: `LIVEKIT_URL` و`LIVEKIT_API_KEY` و`LIVEKIT_API_SECRET` (يبقى ربط حزمة LiveKit في الواجهة خطوة تالية)، و`TURN_URL` لشبكات الجوال المقيّدة.
- **التفريغ الصوتي:** يظهر «غير متاح» بصدق حتى يُضبط مزوّد Whisper.
- **التحليلات:** تعمل من قاعدة البيانات مباشرة، و`CLICKHOUSE_URL` يضيف نسخة دفعية إلى ClickHouse (المخطط داخل `lib/analytics.js`).
- **SEO:** `PUBLIC_URL` لروابط canonical وOpen Graph.

## حدود معروفة
- HLS يعمل أصلياً في Safari/iOS؛ بقية المتصفحات تشغّل MP4 الاحتياطي (لا مكتبة hls.js لتوفير الحجم).
- الترجمة المصاحبة تُرفع ملفاً (SRT/VTT)؛ التوليد الآلي للترجمة يعتمد على مزوّد التفريغ.
- التدقيق الإملائي قاموس محافظ للأخطاء الشائعة، لا مدقق لغوي كامل.
