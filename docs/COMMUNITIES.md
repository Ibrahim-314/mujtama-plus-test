# المسار الرابع — المجتمعات (v2.5.0)

## الخدمات
| الملف | المراحل | الدور |
|---|---|---|
| `server/services/cspace.js` | 16، 20 | الهوية (أيقونة، لون، غلاف، تصنيف)، القنوات وصلاحياتها، وسوم المجتمع، القواعد الإلزامية وأسئلة الانضمام، الترحيب، بيانات صفحة المجتمع؛ روابط الدعوة وإحصاءاتها، الشراكات، التحديات ولوحات الصدارة، تقرير الصحة، المؤشرات اليومية، الاقتراحات، الدليل، صفحات `/c/:id` و`/j/:code` |
| `server/services/cmod.js` | 17 | طابور مراجعة موحد (منشورات، بلاغات، طلبات انضمام)، القواعد الآلية، الإنذار والكتم المؤقت والحظر، ملاحظات المشرفين، سجل الإشراف (JSON/CSV) مع وضع شفاف للأعضاء، ملخص المشرفين المجمّع |
| `server/lib/toxicity.js` | 17 | مصنّف إساءة عربي/إنجليزي شفاف يعيد الدرجة والأسباب |
| `server/services/knowledge.js` | 18 | ويكي بسجل نسخ ومقارنة واسترجاع وقفل، أسئلة شائعة مثبتة، أسئلة وأجوبة، كشف الأسئلة المكررة، مكتبة موارد بتصويت، بحث داخل المجتمع |
| `server/services/events-plus.js` | 19 | تكرار، تذاكر مجانية بسعة، قائمة انتظار بترقية تلقائية، تسجيل حضور QR، تذكيرات قبل يوم وساعة، iCal للفعالية وتقويم شخصي خاص، ترميز جغرافي للخريطة |
| `server/lib/scheduler.js` | 19، 20 | مهام مجدولة بعقد إيجار في `job_leases`: تعمل على خادم واحد فقط وتنتقل تلقائياً إن تعطل |
| `community-ui.js` + `chunks.js` | الواجهة | تُحمَّل كحزمة منفصلة عند الحاجة (16.5 KB br) حتى تبقى الحزمة الأساسية تحت 90 KB |
| `server/migrations/008_communities.js` | — | 14 جدولاً و14 عموداً جديداً |

## المهام المجدولة
`eventsTick` (دقيقة)، `unmuteDue` (دقيقة)، `modDigest` (30 د)، `communityMetrics` (15 د)، `challengeWinners` (5 د). كل منها محمي بعقد إيجار، والتذكيرات والملخصات تمنع التكرار عبر `reminder_log`.

## ملاحظات تشغيل
- **الخريطة:** بلاطات OpenStreetMap مع نسب الحقوق، والترميز الجغرافي عبر Nominatim. للإنتاج بحجم كبير يُفضّل مزوّد بلاطات خاص.
- **ماسح QR:** يستخدم `BarcodeDetector` (Chrome وAndroid)، ويوجد إدخال يدوي للرمز في بقية المتصفحات.
- **سجل الإشراف CSV:** بترميز UTF-8 مع BOM ليظهر العربي صحيحاً في Excel.
- **مصنّف الإساءة:** معجمي وشفاف، ويمكن استبداله بنموذج مستضاف عبر نفس الواجهة `score(text)`.

## v2.59 — الإشراف 2 والإشراف التلقائي 2
- الواجهة: طابور إشراف بفلاتر واستلام/إفلات وتكليف وإجراءات جماعية واختصارات لوحة مفاتيح، الطعون، القوالب المحفوظة، السجل، تنبيهات المشرف؛ قسم الإشراف التلقائي بقواعد (كلها مطفأة افتراضياً) وقوالب جاهزة ومُختبِر وإحصاءات وسلّم عقوبات؛ صفحة طعن العضو `#/cappeal`؛ ورقة إجراءات موحّدة بدل `prompt/confirm`.
- الخادم `services/cmod2.js` و`lib/automod-rules.js`: الاستلام ينتهي تلقائياً، الطعن يُقرَّر برتبة أعلى، تعليق قد يُحجز `pending` ولا يظهر قبل الموافقة، بصمات النص المكرر تُكتب فقط عند تفعيل القاعدة. كل النقاط الجديدة 401 للزائر.
- ترحيل `065_moderation` إضافي وقابل للعكس: 5 جداول جديدة وفهارسها، لا تغيير لأي عمود قائم.

## v2.58 — القنوات والمحتوى والقواعد والترحيب
- الواجهة: صفحة المجتمع بشريط إعلان، مثبّتات، قنوات مجمّعة بتصنيفات مع عدّاد غير مقروء، تبويبات تعيد رسم `#c-body` فقط (`/about` · `/members` · `/knowledge` · `/events`). أقسام جديدة في اللوحة: `channels` · `content` · `rules` · `knowledge` · `growth`.
- الخادم `services/cchannels.js`: القنوات (تصنيفات، ترتيب، أيقونة، أرشفة/استعادة، وضع بطيء، موافقة، أنواع مسموحة، قنوات بالأدوار، القناة الافتراضية، `channel_reads`)، المثبّتات (5 للمجتمع، 3 للقناة، انتهاء اختياري)، الإعلانات (`info | important`، جدولة، إغلاق لكل عضو، إشعار مرة يومياً على الأكثر)، القواعد المنظّمة (`community_rules`، و`communities.rules` مرآة العناوين في الاتجاهين)، خطوات الترحيب على الخادم (`community_onboarding`، استيراد مرة واحدة من localStorage)، أقسام الويكي.
- ترحيل `064_channels_content` إضافي وقابل للعكس: 7 جداول جديدة، 12 عموداً جديداً (كل NOT NULL له DEFAULT)، فهارس جديدة (منها 3 على جداول قائمة: القنوات حسب التصنيف، المنشورات حسب القناة، الويكي حسب القسم). لا شيء يُعاد تسميته أو يُحذف.
- القنوات لا تُحذف: الأرشفة تجعلها للقراءة فقط وتبقى المنشورات ومن يراها كما هم.

## v2.57 — لوحة الإدارة: الأساسيات
- الواجهة: `#/cadmin` (مجتمعاتي التي أديرها + طلبات نقل الملكية الواردة)، `#/cadmin/:id` (الرئيسية)، `#/cadmin/:id?s=<key>` بالأقسام: `general` · `privacy` · `members` · `roles` · `channels` · `moderation` · `health` · `danger`. الحزمة الكسولة `cadmin` (`cadmin-ui.js` + `cadmin.css`) تُحمَّل بعد حزمة المجتمعات. `#/cset` → general، `#/cmod` → moderation، `#/chealth` → health.
- الخادم `services/cadmin.js`: `GET /api/me/communities/managed`، `GET /api/communities/:id/admin`، `GET /api/communities/:id/requests/history`، `POST /api/communities/:id/requests/decide` (جماعي)، `DELETE /api/communities/:id/invites/:code` (إلغاء لا حذف)، `POST|GET /api/communities/:id/member-invites`، `DELETE …/member-invites/:iid`، `GET /api/me/community-invites`، `POST /api/community-invites/:iid/decline`، `GET|POST|DELETE /api/communities/:id/transfer`، `POST /api/community-transfers/:tid/:act` (قبول خلال 72 ساعة؛ المالك السابق يصبح مديراً)، `POST …/archive|restore` (للمالك، قابل للعكس)، `POST …/lockdown` (حتى 7 أيام)، `GET …/export` (للمالك)، و`GET /api/communities/:id/members?format=csv` (المالك والمديرون).
- طلبات الانضمام تبقى سجلاً (`pending → approved | rejected | cancelled`) بدل الحذف. المجتمع بالدعوة يقرأ `community_member_invites` أولاً ثم إشعار الدعوة القديم.
- ترحيل `063_membership` إضافي وقابل للعكس. العلم `community_lean_bootstrap` (مفعّل افتراضياً، مفتاح إيقاف في أعلام الميزات): bootstrap يحمل عضوياتك وعضويات المجتمعات التي تشرف عليها فقط.

## v2.56 — الأساس الآمن
- `lib/cperm.js`: محرك الصلاحيات (مفاتيح، رتب، أدوار مخصّصة تضيف مفاتيح فقط). `lib/community-settings.js`: مخطط الإعدادات والحفظ الذري وقائمة السماح العامة.
- مسارات جديدة: `GET /api/communities/:id/members?q=&role=&cursor=&limit=`، `GET /api/communities/:id/settings`، `PATCH /api/communities/:id/settings/:section` (general | identity | joining | moderation)، `GET/POST/PATCH/DELETE /api/communities/:id/roles[/:role]`، `PUT/DELETE /api/communities/:id/members/:user/roles/:role`.
- الكتم/الحظر: `memberships.status` و`prev_role` و`community_sanctions`. `role` يبقى مرآة للتوافق.
- `community_member_stats` تُحدَّث تزايدياً وتُصالَح في الخلفية (مهمة `communityStats` كل 30 دقيقة للمجتمعات المفتوحة مؤخراً).

## v2.60 — الإحصاءات والنمو والتكاملات وإشعارات الأعضاء
- الواجهة: أقسام الإحصاءات والفعاليات والتكاملات في اللوحة، النمو أُعيد بناؤه (QR للدعوة وإلغاؤها، بحث الشركاء، التحديات)، صفحة `#/c/:id/notify` للعضو، وتبويب سوق اختياري للمجتمع.
- الخادم `services/cinsights.js` (عدادات حية + مُصالِح ليلي يعيد كتابة اليوم من الجداول الأصلية) و`services/cintegrations.js` (ويب هوكس موقّعة، بحث الشركاء، مكافآت MJT يموّلها المالك عبر `mjt-ledger.post` بسقوف يومية وعكس عند الحذف ومفتاح المنصة).
- ترحيل `066_insights` إضافي وقابل للعكس: أعمدة جديدة لها قيم افتراضية في `community_metrics` و5 جداول جديدة، لا تغيير لأي عمود قائم.

