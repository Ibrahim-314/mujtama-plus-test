# Changelog

## 2.145.0 — 2026-10-31 — الرئيسية H2 «أول 5 ثواني» (user-approved mockup; no feature removed, no migration)

- Header: SVG icons (language, search, messages) in index.html from the first paint (no emoji → SVG swap); Home on phones uses a 50 px bar (`body.on-home`), hide-on-scroll-down / show-on-scroll-up (existing nav.js), reduced motion respected.
- Composer: `#hcomp` card = avatar + «ماذا تريد أن تنشر؟» (`#cbar`, now a real button) + one row of 7 icon-only 44 px buttons (صورة، فيديو، مقطع صوتي، استطلاع، سلسلة، مقال، ساعدني في الكتابة) each opening the existing editor flow (`homeCompose`).
- Stories: strip only when others have active stories; otherwise the add-story card is gone and the composer avatar carries «+» (`#st-new`) → existing add-story flow (or my own story's ring → viewer).
- Week-one challenges: one 48 px bar (ring x/5, title, «التالي: … · N أيام متبقية», chevron) that expands to the existing list; open state remembered (`mp_ch_open`, closed by default).
- First post top at 390 ar (seeded world): 304 px without «فاتك اليوم», 638 px with it. Tabs, «فاتك اليوم», dock, feed, side rail unchanged.
- Tests: tests/e2e/home-h2-v2145.e2e.test.js (composer 7 flows, story badge vs strip, challenge bar, header hide/show, axe 390 light / LTR / 1440 dark).

## 2.144.0 — 2026-10-31 — «ميزانية التصميم» + الرئيسية H1 (no feature removed, no migration, no visible change)

- 2.144: font sizes / white / shadows moved onto tokens; market list inline styles → class (761c3aa).
- H1a: `HomeHooks` — one home assembly point with ranked sections (circle 10 · challenges 20 · stories 30 · discovery 40) + after hooks; replaces 6 `Views.home` wrappers.
- H1b: `PostHooks` ranked middleware replaces 14 `postCard`/`postInner` wrappers (order no longer depends on chunk load order).
- H1c: duplicate MJT disclaimer EN key removed from i18n-enplus (text was load-order dependent).
- Fix: top-bar title (and back-button label) in English no longer flips back to Arabic — `nav.js setTitle` compared the translated text with the Arabic source and rewrote it every paint; now tracks `data-src` and translates the node in the same task (found by the visual gate).
- `tools/visual-diff.mjs`: deterministic screenshot diff (158 routes × 390/1440 × ar/en × light/dark). Full gate vs 2.143: 1264 screens, 1253 identical, 11 environment-only diffs reviewed. `ship.sh` now runs a permanent core-routes × 8 visual gate against the last shipped release.

## 2.80.0 — 2026-10-22 — «أدوات صانع فيديوتك» (no feature removed, additive migration 078)

- مسودات فيديوتك: «حفظ مسودة» في المحرر يحفظ الفيديو المرفوع والوصف وموضع الغلاف والرابط والموعد؛ صفحة `#/clips/drafts` لفتحها أو حذفها (20 مسودة كحد أقصى، خاصة بصاحبها). API: `GET/PUT/DELETE /api/clips/drafts`.
- جدولة النشر من محرر فيديوتك (مفتاح + وقت بتوقيت الجهاز، 5 دقائق على الأقل)؛ المقاطع المجدولة تظهر لصاحبها في ملفه بشارة «مجدول» وتُعدَّل من `#/scheduled`.
- إصلاح: الفيديو المجدول صار يمر بمرحلة التجهيز عند موعده بدل أن يُنشر قبل جاهزية ملفه، ويصل إشعار «نُشر المجدول» بعد الجاهزية.
- إحصاءات كل مقطع `#/clips/stats/<id>` لصاحبه والفريق فقط: المشاهِدون، نسبة الإكمال، متوسط المشاهدة، الإعجابات والتعليقات والمشاركات ونقرات الرابط، مصادر المشاهدين، ومشاهدات 14 يوماً.
- مصدر المشاهدة يُسجَّل مع أول مشاهدة (لك/المتابَعون/الملف/الوسوم/الأصوات/التحديات/الروابط/أخرى) دون تغيير أي رابط.
- «أفضل وقت للنشر» في ملف الصانع من نشاط متابعيه آخر 30 يوماً (يظهر بعد 30 مشاهدة على الأقل)، بتوقيت الجهاز.
- إصلاح سحب المنشور المجدول في تقويم الاستوديو: لا سحب ليوم ماضٍ أو لنفس اليوم، ولا يبقى العنصر المسحوب عالقاً.
- مساعدة الصفحات الجديدة بالعربية والإنجليزية، وترجمة كل النصوص الجديدة.
- الترحيل 078: جدول `clip_drafts` + عمودا `clip_watch.src/first_at` (إضافي وقابل للتراجع).

## 2.79.0 — 2026-10-22 — «حماية الحساب» (no feature removed, no migration)

- سجل نشاط الأمان لكل عضو (`GET /api/security/activity`، صفحات بـ `before`)؛ تنبيه `security_failed` عند 5 محاولات كلمة مرور فاشلة خلال ساعة (مرة كل 24 ساعة)؛ نصيحة عند بقاء أقل من 3 رموز احتياطية.
- سياسة التحقق بخطوتين للفريق `#/admin/security`: المدير (وعليه 2FA) يُلزم المديرين والمشرفين بعد مهلة (فوراً/24س/3 أيام/أسبوع) مع إشعار `security_staff2fa`. بعد المهلة يُعامل من لم يستوفِ كعضو عادي حتى يفعّله (لا يُحذف أي دور). جلسة الدخول عبر Pi أو بخطوتين تكفي. مفتاح طوارئ `SECURITY_STAFF2FA_OFF=1`.
- «تسجيل خروج الجميع» للحوادث: مدير + 2FA + عبارة تأكيد مكتوبة؛ يُبقي جلسة المدير ويمسح ذاكرة الجلسات المؤقتة.
- جلسات Pi تُسجَّل `mfa=true` (الدخول مستقبلاً عبر Pi).
- اختبارات: API جديدة + e2e بمقاسي 390 فاتح RTL و1440 داكن EN مع axe.

## 2.78.0 — 2026-10-22 — «تحدي الأسبوع» (no feature removed, additive migration 077)

- تحديات فيديوتك الأسبوعية: الفريق (مدير/مشرف) يطلق تحدياً بعنوان ووسم وفكرة ومدة (ساعة إلى 31 يوماً). أي لقطة تُنشر خلال الفترة وفيها الوسم تدخل تلقائياً؛ لا تسجيل ولا جدول مشاركات، فاللقطة المحذوفة أو الخاصة تخرج وحدها.
- `#/clips/challenges` (الحالي، القادم، السابق مع الفائزين) و`#/clips/challenge/<id>` (الفكرة، العدّ التنازلي، عدد اللقطات والصنّاع، ترتيبك، «الأفضل» = أفضل لقطة لكل صانع، «الأحدث»، منصة التتويج).
- «شارك بلقطة» يفتح المحرر والوسم في الوصف؛ شارة «تحدي الأسبوع» تحت تبويبات الخلاصة (تختفي في الشاشة النظيفة)، وشارة «مشارك في التحدي» على اللقطات المشاركة، وتنبيه في صفحة الوسم، ومدخل في «المزيد».
- النقاط = إعجابات + 2×تعليقات + 3×مشاركات + مشاهدات كاملة، بلا عقوبة على التبكير. بعد النهاية يُثبَّت الثلاثة الأوائل مرة واحدة (تحديث محروس) ويصلهم إشعار `clip_challenge_win`؛ لقطة بلا تفاعل لا تفوز.
- الإلغاء قابل للاسترجاع، ولا يتغيّر الوسم أو البداية بعد انطلاق التحدي. أيقونة «؟» للصفحتين، وترجمة إنجليزية كاملة.
- اختبارات: 6 API (صلاحيات، تحقق، ترتيب، رؤية، إنهاء مرة واحدة، migration down/up) + e2e بمقاسي 390 فاتح RTL و1440 داكن EN مع axe.

## 2.69.0 — 2026-10-20 — «الواجهة الإنجليزية كاملة» (no feature removed)

- ترجمة إنجليزية لحوالي 5,100 نص واجهة كانت تظهر بالعربي في الوضع الإنجليزي، في chunk كسول جديد `i18n-enplus.js` يُحمّل بعد `i18n-en` (كل chunk تحت حد 90 KB). لا مفاتيح مكررة مع الكتالوج القديم.
- حماية دائمة: `tools/i18n-coverage.mjs` + اختبار وحدة؛ أي نص عربي جديد في الواجهة بلا ترجمة إنجليزية يُفشل الاختبارات. الفجوات القديمة (619 نصاً مركباً/مقطّعاً) في baseline يتقلّص فقط.
- قائمة اللغات في القائمة الجانبية تعرض «العربية و English» فقط.
- اختبار e2e جديد يمر على المسارات الرئيسية بالإنجليزية ويُبلغ عن أي نص عربي متبقٍ خارج محتوى المستخدمين.

## 2.68.2 — 2026-10-20 — «مفتاح التشفير خارج القاعدة» (no feature removed, no data deleted)

- `PROVIDER_SEAL_KEY` مضبوط في الإنتاج. مفتاح توقيع الشهادات وإعدادات المزوّدين المختومة سابقاً بالمفتاح المخزّن تُفتح به مرة ثم يُعاد ختمها بمفتاح البيئة تلقائياً (نفس kid، الشهادات السابقة تبقى صالحة). اختبار تكامل على PG17.
- `SEED_DEMO=0` في الإنتاج: لا إعادة إنشاء لبيانات التجربة لو فرغت المنشورات. بيانات التجربة الحالية باقية كما هي.

## 2.68.1 — 2026-10-20 — «النسخ الاحتياطي التلقائي» (no feature removed)

- `GET /api/ops/backup` (لا يوجد إلا مع `BACKUP_TOKEN` و`BACKUP_PASSPHRASE` على PostgreSQL): لقطة متسقة للقراءة فقط لكل الجداول (JSON lines، gzip، تشفير AES-256 بصيغة openssl). 
- `tools/backup-restore.mjs` للتحقق والاستعادة (يرفض قاعدة غير فارغة، يطابق عدد الصفوف لكل جدول)، و`ops/backup/pull.sh` للسحب اليومي مع الاحتفاظ بآخر 7 نسخ. استعادة مجرّبة على PG17 محلياً مع تطابق بصمة الوسائط.
- `railway.json`: فحص صحة `/api/health` عند كل نشر وإعادة تشغيل عند الفشل.

## 2.68.0 — 2026-10-20 — «الثبات والأمان + تنبيه التحديثات الجديد» (no feature removed)

**ملخص:** إصلاح الثغرات الحرجة من تدقيق البنية التحتية، وتنبيه تحديث جديد يعرض رقم الإصدار وملخص التعديلات.

### الثبات والأمان
- مسار أو كوكي فيه ترميز % تالف كان يوقف عملية الخادم بالكامل؛ الآن يرد 400/404 والخادم يستمر (اختبار انحدار `crash-guard-v268`).
- شبكة أمان عامة: `.catch` على معالج الطلبات، و`unhandledRejection`/`uncaughtException` تُسجَّل بدل إسقاط العملية، والمقاييس لا تُسقط الخادم أبداً.
- مجمّع اتصالات PostgreSQL: مستمع `error` للاتصالات الخاملة، و`idleTimeoutMillis`/`connectionTimeoutMillis`، و`statement_timeout` للنسخة المقروءة.
- إيقاف نظيف عند SIGTERM بمهلة: إغلاق الاتصالات الخاملة ثم الكل بعد 8 ثوانٍ، وخروج إجباري بعد 15 ثانية.

### وضع عدم الاتصال (sw.js)
- لا يُحفظ كواجهة التطبيق إلا تنقل ناجح إلى «/» أو «/index.html» (لا صفحات المقالات أو الأخطاء)، مع النسخ قبل تسليم الرد.
- ملفات الحزم لا تُخزَّن إلا عند نجاح الطلب (لا يعلق 404 أثناء النشر).

### تنبيه التحديثات
- «يوجد تحديث جديد» مع رقم الإصدار (بالأرقام العربية في الواجهة العربية) وأهم 3 تعديلات و«عرض كل التعديلات» وزر «تحديث».
- بعد التحديث بطاقة واحدة «تم التحديث إلى الإصدار …» مع ملخص الجديد، من `/whatsnew.json` (عربي وإنجليزي).
- الإصدار في «التطبيق» والإعدادات يظهر رقماً (٢٫٦٨٫٠) بدل رمز التخزين الإنجليزي.

## 2.67.0 — 2026-10-19 — «إصلاحات التطبيق: العربية والإنجليزية فقط، خصوصية القاصرين، ترجمات ناقصة» (no feature removed)

**ملخص:** إصدار إصلاحات فقط. لغات الواجهة الآن العربية والإنجليزية فقط بإذن صريح من المستخدم، ومن كانت لغته الفرنسية أو الأردية ينتقل تلقائياً للإنجليزية.

### اللغات
- إزالة فهارس الفرنسية والأردية ومقاطع مساعدتهما؛ اللغتان المتقاعدتان تعودان للإنجليزية في الواجهة والخادم.

### الخصوصية
- «أشخاص قد تعرفهم» لا يعبر الفئات العمرية: لا يُقترح القاصرون للبالغين ولا البالغون غير المرتبطين للقاصرين (روابط وليّ الأمر محفوظة)، مع اختبار مصفوفة API.

### الترجمة
- ترجمة إنجليزية لصفحات العائلة/العمر، وشرائح الاستوديو، وتذكيرات القراءة.

## 2.66.0 — 2026-10-19 — «الإرشاد: الموارد والردود الجاهزة والحفظ والمراجعة والشهادة» (no feature removed)

**ملخص:** المرحلتان M4 وM5 من مسار لوحة الإرشاد: ردود جاهزة للمرشد، وموارد يشاركها مع متعلّميه، وحفظ المرشدين مع تنبيه بالمواعيد الجديدة، وشارة «مراجَع من الفريق»، وشهادة إتمام الإرشاد القابلة للتحقق.

### الردود الجاهزة «#/mentoring?tab=profile»
- حتى 8 ردود خاصة بالمرشد (عنوان ≤40 ونص ≤500، تحقق في الخادم) تُدار من «الملف»، ومنتقٍ في الطلبات يُدرج النص في حقل الرد (صار حقلاً متعدد الأسطر) ليعدّله قبل الإرسال. لا تظهر للعامة ولا في المعاينة.

### موارد المرشد
- روابط (https:// فقط) وملاحظات حتى 30 مورداً، مع إضافة وتعديل وحذف وترتيب لأعلى/لأسفل. الظهور «للجميع» أو «لمتعلّميّ فقط» (من حجز جلسة واحدة على الأقل وأولياء أمورهم)، وتظهر في صفحة المرشد والمعاينة بحسب ذلك.

### حفظ المرشدين وتنبيه المواعيد
- زر «حفظ» في صفحة المرشد وبطاقات الدليل، وقائمة «المرشدون المحفوظون» في لوحة الإرشاد مع جرس لكل مرشد: تنبيه حين يفتح مواعيد جديدة، مرة في اليوم على الأكثر.

### شارة «مراجَع من الفريق»
- مفتاح مراجعة للمشرفين مع فلاتر (مراجَع / غير مراجَع / يحتاج مراجعة)، وشارة في صفحة المرشد وبطاقات الدليل (تتعايش مع زر الحفظ دون تداخل)، وتنبيه للمرشدين الذين يتعاملون مع قاصرين دون حجب.

### شهادة إتمام الإرشاد «#/mentor-certs»
- يصدر المرشد شهادة إتمام لمتعلّمه على نظام الشهادات الموقّعة نفسه (نوع mentorship، بلا ترحيل)، ويراها المتعلّم ووليّ أمره، ويُتحقق منها علناً عبر «/cert/<الرمز>» مع صياغة الإرشاد والطباعة.

### قاعدة البيانات
- **الترحيل 069** `069_mentor_resources_saves`: جدولا `mentor_resources` و`mentor_saves` مع فهارسهما — إضافي وغير مدمّر، مختبر صعوداً/نزولاً/صعوداً.

## 2.65.0 — 2026-10-19 — «الإرشاد: الأهداف والأجندة والإحصاءات» (no feature removed)

**ملخص:** تكملة صفحة المرشد (تقييمات «عرض المزيد»، بطاقة وليّ الأمر، شريط الحجز الثابت، مجتمعات المرشد)، وأدوات جديدة للمحرّر (معاينة كما يراه الزائر، ومؤشر اكتمال الملف)، ولأول مرة أهداف مشتركة وأجندة لكل جلسة وتبويب «إحصاءاتي» للمرشد.

### صفحة المرشد «#/mentor/:handle»
- **التقييمات «عرض المزيد»**: أول 20 تقييماً ثم زر «عرض المزيد» يجلب البقية على دفعات (مؤشّر صفحات آمن، الأحدث أولاً، بلا تكرار)، مع إعلان لقارئ الشاشة بعدد ما أُضيف.
- **بطاقة وليّ الأمر**: تظهر فقط لوليّ الأمر النشط لمتعلّم قاصر مرتبط: عدد الجلسات وموعد الجلسة القادمة، دون ملاحظات أو أرقام غرف.
- **شريط الحجز الثابت** على الجوال: زر «احجز جلسة» يبقى في متناول اليد أثناء التمرير.
- **مجتمعات المرشد**: قسم اختياري يتحكم به المرشد (عام / لمتعلّميه / مخفي)، يعرض المجتمعات العامة النشطة فقط؛ الخاصة والمغلقة والمؤرشفة لا تظهر أبداً.
- **خصوصية**: عند إخفاء المرشد حقل «التقييمات والإحصاءات» لا تُرسل التقييمات في استجابة الواجهة البرمجية إطلاقاً (ولا في «عرض المزيد»)، مع اختبار يثبت ذلك. وفي الصفحة يُخفى قسم التقييمات كاملاً (وبطاقتا التقييم والجلسات المكتملة) لمن لا يحق له رؤيته بدل عرض «لا تقييمات بعد» المضلّل.

### محرّر الملف «#/mentoring?tab=profile»
- **معاينة كما يراه**: اعرض صفحتك كما يراها الزائر أو العضو أو متعلّمك أو وليّ الأمر، بحسب إعدادات الظهور لكل حقل.
- **مؤشر اكتمال الملف**: شريط يوضّح نسبة الاكتمال وما ينقص لإكمال الملف.

### الجلسات «#/msession/:id»
- **الأهداف المشتركة**: المرشد والمتعلّم يضيفان حتى 10 أهداف (عنوان + تاريخ استحقاق اختياري) ويغيّران حالتها: لم يبدأ / قيد التنفيذ / أُنجز. وليّ أمر القاصر والمشرفون للعرض فقط، ولوحة المرشد تعرض المنجز/الإجمالي لكل متعلّم.
- **أجندة الجلسة**: المتعلّم يضيف حتى 5 نقاط (حتى 140 حرفاً) قبل الموعد، والمرشد يعلّم ما نوقش بعد التأكيد، ووليّ الأمر يطّلع فقط.

### لوحة المرشد «#/mentoring?tab=insights»
- **تبويب «إحصاءاتي»**: جلسات آخر 6 أشهر شهرياً (أعمدة CSS بلا مكتبة رسوم)، متوسط التقييم وعدده، وسيط زمن الرد على الطلبات، نسبة الغياب، ونسبة المتعلّمين العائدين — أرقام المرشد نفسه فقط دون هويات المتعلّمين.

### وليّ الأمر «#/family»
- ملخص أسبوعي لوليّ الأمر عن جلسات وأهداف القاصر (بلا ملاحظات)، مع مفتاح إيقاف في الإعدادات العائلية.

### قاعدة البيانات
- **الترحيل 068** `068_mentor_goals`: جدول `mentor_goals` مع فهرس الزوج (مرشد/متعلّم)، وعمود `mentor_sessions.agenda` (JSON)؛ مختبر صعوداً/نزولاً/صعوداً، غير مدمّر.

### الجودة
- ترجمات en/fr/ur لكل النصوص الجديدة دون مفاتيح مكرّرة، واختبارات واجهة برمجية وe2e لكل ميزة.
- إصلاح وصولية مبدّل المعاينة (aria-pressed على أزرار المبدّل فقط، وفحص axe بعد كل تبديل).

## 2.64.0 — 2026-10-19 — «صفحة المرشد الكاملة» (no feature removed)

**ملخص:** صفحة ملف كاملة لكل مرشد يفتحها الطلاب وأولياء الأمور: الصورة والاسم والعمر (إن أظهره المرشد) والمدينة وأسلوبه في الإرشاد والمهارات والخبرات والمؤهلات والشهادات. المرشد حرّ في إظهار صفحته للعامة أو للأعضاء فقط أو إخفائها، ويختار لكل معلومة من يراها. الصفحة المخفية تبقى مفتوحة لمتعلّميه وأولياء أمورهم والإدارة فقط، ولغيرهم تُرجع 404 دون أن تكشف وجودها. لم تُحذف أي ميزة.

### صفحة المرشد الكاملة «#/mentor/:handle»
- **رأس الصفحة**: الصورة (روابط آمنة فقط `/` أو `https://`) والاسم والعنوان، مع سطر معلومات: العمر (اختياري، بالسنوات فقط من تاريخ الميلاد ولا يظهر التاريخ لأحد) والمدينة وسنوات الخبرة.
- **أقسام الملف**: «أسلوبي في الإرشاد»، «المهارات» (حتى 10)، «الخبرات» (حتى 8: المسمّى، الجهة، من–إلى أو «حتى الآن»)، «المؤهلات والشهادات» (حتى 8، مع زر «عرض الشهادة» لروابط https فقط). كل قسم يظهر فقط إذا سمح به المرشد.
- **محرّر الملف** في `#/mentoring?tab=profile`: حقول «الملف الكامل» بصفوف قابلة للإضافة والحذف، وبطاقة «الخصوصية والظهور».

### الخصوصية والظهور
- **ظهور الصفحة**: عامة / للأعضاء المسجّلين فقط / مخفية (لمتعلّمي المرشد وأولياء أمورهم والإدارة فقط).
- **ظهور كل معلومة**: للجميع / لمتعلّميّ فقط / مخفي — للصورة والعمر والمدينة والخبرات والمؤهلات والإحصاءات والحجز والتواصل والمجتمعات. المعلومة المخفية لا تُرسل في استجابة الخادم أصلاً.
- **وصول ولي الأمر**: ولي أمر المتعلّم (برابط وصاية نشط) يرى الصفحة كما يراها المتعلّم، حتى لو كانت مخفية.
- **الصفحة المخفية تُرجع 404** لغير المخوّلين دون كشف وجودها، ولا تظهر في الدليل.

### الأداء
- تجميع الاستعلامات في صفحة المرشد والدليل والجلسات (دون N+1).

### التوثيق
- `docs/MENTORSHIP.md` محدّث من الكود.

### تفاصيل مسار الإرشاد M1/M2
#### Mentor profile page (M2)
- **Full profile**: approach, skills, experience, qualifications (https links only), years, city, opt-in age (whole years from the birth date, never the date) — strict server validation, unknown keys dropped.
- **Mentor controls who sees it**: page visibility `public` / `members` / `hidden` (hidden = only the mentor's mentees, their guardians and staff; everyone else 404, never listed) and per-field levels `public` / `mentees` / `off` (photo, age, city, experience, qualifications, communities, stats, contact). Hidden fields are absent from the API response.
- **Contact level gates booking server-side** (`public` / `mentees` / `off`).
- **Migration 067** `067_mentor_profile_ext`: additive columns `visibility`, `fields`, `extra`, `reviewed_at` + index `mentor_feedback_about_rating`; reversible.

#### Safety and privacy (M1)
- Visitors get 401 on every private mentorship route; a block (either direction) hides the page and slots (404) and refuses booking (403); a block after booking shuts the session room while cancel stays.
- Minors: no mentor profile under 18; bookings only with opt-in mentors, free, with an active guardian link; private notes and the mentor's feedback never reach the other side or the guardian; minors' reviews masked as «متعلّم».
- Fewer queries on the mentor page, directory and sessions (no N+1).

#### UI and translation
- Mentorship pages: `dir=auto` on user text, 44px targets, no overflow at 360/390; `#/msession` and `#/admin/mentors` translated in en/fr/ur.

#### Docs
- `docs/MENTORSHIP.md` rewritten from the code: profile fields, visibility and relations, booking rules, session lifecycle, refunds, admin moderation, migration 067, API auth table, tests.

### Fixes
- ثبات الألوان عند تبديل الوضع الداكن
- منع أخطاء العرض عند التنقل السريع (الإيرادات، دليل المجتمعات، البيتا)

## 2.63.0 — 2026-10-19 — «تحسينات المجتمع الخفيفة» (no feature removed)

**ملخص:** إضافات خفيفة للمجتمع فوق «الحارس التلقائي» دون حذف أي ميزة: خط «جديد منذ زيارتك» في الخلاصة يوضّح من أين تبدأ القراءة، وتلميح بأهم 3 قواعد للمجتمع داخل نافذة الكتابة (قابل للطي)، وشارتا «عضو جديد» و«ذكرى الانضمام» بجانب أسماء الأعضاء (يتحكم بهما المشرف)، و«عرض المزيد» مع تحميل تلقائي للمنشورات الأقدم في خلاصة المجتمع، وإصلاحات في لوحة إدارة المجتمع (أهداف لمس ≥44px، أخطاء الحقول داخل النموذج، التصنيف «بدون»)، وإصلاح البلاغات (لا بلاغ على محتوى غير موجود أو غير مرئي)، وترجمة واجهات المجتمع كاملة إلى الإنجليزية والفرنسية والأردية.

### Community
- **«جديد منذ زيارتك»** divider in the community feed (first render only, never cached).
- **Rules hint**: top 3 community rules inside the community composer, collapsible per community; coexists with the auto-guard composer warning/blocked state.
- **Member badges** «عضو جديد» / «ذكرى الانضمام» on post cards (cadmin switch `memberBadges`), also on later pages.
- **Feed load-more**: cursor paging (`?before=`), sentinel + «عرض المزيد» fallback, back-navigation keeps loaded pages; compact FAB on phones.

### Fixes
- cadmin: ≥44px switch hit areas, inline field errors, category «بدون» sentinel, tag input `dir="auto"`, access check first.
- Reports require an existing, visible target (same 404 otherwise).
- Community i18n en/fr/ur (templated `{name}`/`{t}` keys and plurals); Arabic output unchanged.
- Auto-guard card state text: the card header shows the saved state, the switch shows the live/unsaved state («مفعّل/متوقف» clear at a glance).
- Member card moderation log translated in English (and fr/ur): action labels and reasons as separate text, 11 missing log labels added, masked words kept as data; member line split (role · n warnings · muted until + date in UI locale). Server data unchanged.
- Dark mode: auto-guard switch titles use `var(--text)` explicitly, meeting AA contrast at 1440 dark.
- Compliance tab stability: stale async results are dropped after a route change, and `#cmp-tab` is null-guarded (no feature change).
- «تحديث المنشورات فور حفظ العمر»: saving an age on `#/age` re-syncs the store (guarded `refresh()`), so adult-only posts appear covered without a reload.
- «تباين أرقام البطاقات في الوضع الداكن»: `.kpi-tile b` uses `var(--text)` explicitly (AA contrast in dark mode, e.g. `#/giving`).

## 2.62.0 — 2026-10-19 — «الحارس التلقائي» (no feature removed)

**ملخص:** حارس تلقائي للمجتمع (مطفأ افتراضياً ويُفعّله المشرف): أي رسالة فيها كلمة محظورة تُحذف تلقائياً فوراً، ويتلقى العضو تحذيراً (التحذير *n* من *الحد الأقصى*) مع كتم مؤقت، ويتكرر ذلك حتى الحد الأقصى من التحذيرات، ثم يُوقف العضو حتى يرفع المشرف الإيقاف. للمشرف بطاقة على العضو تعرض تحذيرات الحارس وزر «رفع الإيقاف»، ونص مساعدة «؟» يشرح الإعدادات بأربع لغات.

### Community auto-guard «الحارس التلقائي»
- **Admin card** in `#/cadmin/:id?s=automod` (الإشراف الآلي): on/off (**OFF by default**), KPIs (warnings, stops, stopped now), «الإعداد الموصى به» fills the form without saving, banned words/phrases and allow-list editors with counters, mute hours, max warnings, what happens after the last warning, decay, who it applies to, who can lift a stop, reset-on-lift, and «جرّب الحارس» tester with a localized outcome. Saved through the existing «حفظ التغييرات» form.
- **Member experience**: matching text is removed at once; the member gets warning *n* of *max*, a temporary mute with countdown, and after the last warning a stop until a moderator lifts it, with an appeal link. Live check in the composer shows masked words only (never a strike); the draft is kept («نصّك محفوظ…»).
- **Moderation**: a member's card shows their guard warnings; staff can «رفع الإيقاف». Guard warnings do not count toward the penalty ladder.
- **Notifications**: `autoguard_strike` and `autoguard_lock`.
- **Page help «؟»**: the auto-guard settings (automod section) and the member card's guard state (moderation section) are explained in ar/en/fr/ur.
- Full en/fr/ur translation.

### Fixes
- Action sheet no longer crashes on numeric choices (`esc(String(v))`), which broke the mute sheet.
- `.am-verdict.danger` meets AA contrast in dark mode.

## 2.61.0 — 2026-10-19 — «الاستوديو والمساعدة والوسائط والترجمة» (no feature removed)

### Creator studio (`#/studio`)
- **«ابدأ هنا»** start guide: checklist built from existing data (profile, first post, scheduled post, community, tips), dismiss/restore, up to 3 tips from the creator's own stats (best time → schedule, engagement, top post).
- **Goals** widget (1–3 goals saved in user prefs, progress from existing data) and a **«روابطك»** links row (communities, MJT, Pi earnings «غير مفعّل بعد», support).
- **Touch rescheduling**: tap a scheduled post → unified action sheet «تغيير الموعد» (native date + time, quick chips بعد ساعة / الليلة 9م / غداً 9ص), day list on touch, keyboard-reachable chips.
- Studio fully translated in en/fr/ur with LTR dates and weekday abbreviations following the UI language; Arabic RTL output unchanged.

### Page help «؟»
- Small «؟» help icon on **all 191 routes** (route coverage tool: 191/191), merged registry of 215 entries in **4 languages** (ar + lazy en/fr/ur chunks), section-aware (`#/cadmin ?s=`, `#/c` tab/channel, `#/studio` tab).
- Lazy `help` chunk (sheet on mobile, popover on desktop, focus trap, keyboard, aria); core bundle not grown.

### Media (M1–M5)
- **M1 image/video fixes**: images render in the post-body media slot at real proportions (4:5…1.91:1), gallery for legacy media, lightbox counter correct in RTL; community editor gets a video button (short or long), honest per-file limit (`GET /api/media/limits`, 413 names it), every refusal explained; processing-failure state + `POST /api/media/:id/retry`; Range suffix / 416 / HEAD fixes.
- **M2 EXIF strip + dimensions**: EXIF/GPS/XMP/IPTC/comments removed server-side (orientation applied first); real width/height stored and returned, images reserve their aspect ratio before load (`imageDims[]`).
- **M3 chunked resumable upload**: `POST /api/media/uploads` init, idempotent chunk PUTs, status for resume, complete → same ingest; composer shows a real progress bar, 3 tries per chunk with backoff, resume after going offline.
- **M4 light video encoding**: never upscales, single encode per rung (360p/720p only when the source is larger), faststart remux for small MP4s.
- **M5 private-community media gate**: media of posts in private/invite communities is members-only on `/media/` (404 for non-members, pending, banned and visitors; private no-store for allowed viewers); public media unchanged.

### Translation (LTR)
- Full en/fr/ur translation of the community admin panel (all sections), moderation v2, automod v2, action sheet and `#/cappeal`; `<select>` options/optgroups translated in LTR (values untouched).

### Fixes
- **Explore top-bar shift**: the language button slot is rendered in the top bar from first paint (`nav.js`), so the avatar no longer jumps when the lazy i18n chunk boots; the i18n chunk does not add a second button.
- **Members list shift fix** (`692d0db`): the community members caption line (`.c-mtot`) reserves its height, so a filter answer never shifts `#m-list` (CLS 0).
- **Help «؟» no longer shifts the layout** (`50d4c35`): the icon lives in a reserved top-bar slot (`#tbHelp`, toggled, never inserted) and floats on mobile via a zero-height overlay (`.hp-strip`), so opening a page never moves its content (nav CLS 0).
- **Duplicate translation key removed** (`db15222`): «المكتمل ({n})» now has one definition in en/fr/ur, and a unit guard (`tools/i18n-dupes.mjs` + `tests/unit/i18n-dupes.test.js`) fails the build on any duplicate key across catalogue blocks.
- **Comms badge contrast** (`25a8940`): `.cm-badge.ok` text on `--ok-ink` (AA ≥5.2:1 light, ≥7.2:1 dark) on `#/safety` and `#/devices`.
- **Guided tour never opens over another page**: the home-render trigger opens the tour only while still on `#/home` (applied from the fix-tour-p70 working tree; its commit `dd324f7` was never created).
- **Help «؟» on mobile** (`83d01e3`, `6f0c16c`): the icon sits inline in page heads (incl. notifications/messages) without making the title row taller (`.hp-has > .hp-btn` negative block margins, 44 px target unchanged), reserved top-bar slot on mobile Home/Explore with the wordmark shrinking below 400 px; row-head titles are never squeezed — actions wrap under them.
- **Small-screen layout** (`9ff463d`): studio header wraps below 420 px, LTR top actions no longer overflow, FAB-safe bottom padding, moderation sort at natural width, post shield aligned with ⋯ (44 px).
- **English/French/Urdu coverage** (`73d5483`): hardcoded Arabic on home/explore/community/members/knowledge/rail translated (113 keys per language), input placeholders/aria translated, digest arrow flips in LTR, topic descriptions shown in full with a 2-line clamp.
- **Test reliability** (`d65c6bb`, `22c68a1`, `6f0c16c`, test-only): API-registered e2e accounts mark the guided tour done (p65/p70/p74/p63-68-73), ads e2e reloads `#/home` after server-side campaign activation, quality visual e2e waits for `#view` without skeletons.

## 2.60.0 — 2026-10-19 — «المجتمع 3.0» stage 5/5: insights, growth, integrations and member notifications (no feature removed)

### Admin panel (`#/cadmin/:id`)
- **Insights** section: 7 / 30 / 90 days, growth / engagement / actives KPIs (DAU, WAU, MAU, stickiness on the live member count),
  daily bars, best-time heatmap (community time zone), weekly cohorts, top posts / contributors / channels, invite funnel,
  moderation health, health card (only with `view_health`), CSV export (member handles and names for the owner only, cells neutralised).
- **Events** section: server list with attendance, community calendar link (`/c/:id/events.ics`, public communities only), default reminders.
- **Integrations** section: bots, signed community webhooks (secret shown once, rotate / pause / test / delivery log + retry),
  study / courses / market links and an optional community **market tab**; Pi features listed and visibly **«غير مفعّل بعد»**;
  owner-funded **MJT rewards** for posts and accepted answers.
- **Growth** rebuilt: invite QR + revoke, partner search (no invite-only communities), challenges list; new-member notification default.

### Member
- **`#/c/:id/notify`** (own lazy chunk `cnotify`, from the «…» menu): all / highlights / muted, daily digest, timed mute.
  Personal notices (approval, warnings, events, invites) always pass.

### Server (`server/services/cinsights.js`, `server/services/cintegrations.js`)
- Live insight counters on the bus (`COMMUNITY_MEMBER_EVENT`, `COMMUNITY_LOGGED`, `POST_VIEWED`, `ANSWER_ACCEPTED`) + a nightly
  reconciler (`computeMetrics`) that rewrites the day from the source tables; tests assert live == reconciled for every column.
- `GET /api/communities/:id/{insights,insights/export,events/manage,integrations,notify,notify/summary,partners/search,webhooks,webhooks/deliveries}`,
  `PUT …/{notify,mjt-rewards}`, `POST …/webhooks`, `PATCH …/webhooks/:wid`, `POST …/webhooks/:wid/{rotate,test}`,
  `POST …/webhooks/deliveries/:did/retry`. All require sign-in (401 for visitors) and the right rank; `GET /c/:id/events.ics` only for public communities.
- **MJT rewards** go through the existing `lib/mjt-ledger.js post()` (double entry, idempotency key, no negative balance): paid from
  the owner's balance, nothing minted, ledger code untouched; per-member and per-community daily caps; the platform switch
  (MJT rewards enabled) wins; reversal back to the owner when the content is removed or the answer un-accepted (never below 0, shortfall recorded).
- Migration **066_insights** (additive, reversible): new nullable/defaulted `community_metrics` columns and tables
  `community_daily_actives`, `community_member_prefs`, `community_webhooks`, `community_webhook_deliveries`, `community_mjt_rewards`.
  Verified on a local PG17 seeded to v2.59: data fingerprints unchanged (only the lazy caches v2.59 itself also rewrites),
  idempotent, `down()` restores the v2.59 schema exactly, v2.59 code still boots on the 066 schema.

### Fixes found in release QA
- PostgreSQL: the live `invite_joins` counter raced the invite-code `UPDATE` on link joins (always 0 on PG); now counted after tagging.
- a11y: the insights cohort table wrapper is a focusable, labelled scroll region (axe `scrollable-region-focusable` at 390 px).
- PostgreSQL: timestamps compared via `+new Date()` instead of `Date.parse` in the new services.

## 2.59.0 — 2026-10-19 — «المجتمع 3.0» stage 4/5: moderation v2 and automod v2 (no feature removed)

### Admin panel (`#/cadmin/:id`) — moderation
- **Queue v2**: filters (kind, reason, claimed / unclaimed / mine), claim and release (claims expire, nothing stays locked), assign to
  another moderator, bulk actions, keyboard shortcuts.
- **Appeals**: members appeal a ban, mute, warning or removed post; a higher rank decides (accept / reject with a note).
- **Saved replies** («قوالب»): action + reason + optional mute hours + message, applied in one step; usage counted.
- **Moderation log** and per-moderator **alerts** preferences (digest cadence, instant appeal alerts).
- **Automod v2 section**: rules (all **off by default**), presets, a tester, stats and a warning ladder; a rule may hold a comment as
  `pending` (never shown until approved). Duplicate-text fingerprints are written only while that rule is on.

### Member
- **`#/cappeal`**: the member appeal page (visitors get 401 from the API, the page asks them to sign in).
- **Unified action sheet** replaces `prompt()`/`confirm()` in the community module (legacy element ids kept).

### Composer
- Slow-mode note on two lines (title + rule) with a `mm:ss` countdown chip; slow mode, archived, review and role notes are now
  localized in English, French and Urdu (LTR/RTL).

### Server (`server/services/cmod2.js`, `server/lib/automod-rules.js`)
- `POST /api/communities/:id/modqueue/{claim,release,assign,bulk}`, `GET …/modqueue/v2`, `GET|POST …/macros`, `PATCH|DELETE …/macros/:mid`,
  `POST …/macros/:mid/apply`, `GET …/appeals`, `GET …/appeals/mine`, `POST …/appeals`, `POST …/appeals/:aid/decide`, `GET|PUT …/modprefs`,
  `GET …/automod/meta`, `POST …/automod/test`, `GET …/automod/stats`. All require sign-in (401 for visitors) and the right rank.
- Migration **065_moderation** (additive, reversible): `mod_claims`, `community_appeals`, `mod_macros`, `mod_prefs`, `content_fingerprints`.
  Verified on a local PG17 seeded to v2.58: data fingerprints unchanged, idempotent, `down()` restores the v2.58 schema exactly.

## 2.58.0 — 2026-10-18 — «المجتمع 3.0» stage 3/5: channels, content, rules and welcome (no feature removed)

### Community page (`#/c/:id`)
- Redesigned body: an **announcement bar** above the identity card (info | important, dismissible per member), a **pinned** strip,
  **channels grouped by category** with a light per-member **unread** count, the archived channels listed read-only.
- **Tabs repaint only the body** (`#c-body`): the link follows (`/about`, `/members`, `/knowledge`, `/events`), no full re-render, CLS 0.
- **Members** read from the server with search and filters (all · staff · new · top); the search now treats `_` and `%` literally.
- **Rules as numbered cards** with severity (info · warn · serious) and an optional body; required-acceptance kept.
- **Welcome steps moved to the server** (`community_onboarding`), some auto-checked (first post, profile); a step ticked on this
  device before v2.58 is imported once and the localStorage mark removed.

### Admin panel (`#/cadmin/:id`) — new sections, same list
- **القنوات والتصنيفات** (`?s=channels`): categories, order (arrows or drag), icon, kind, who sees / who posts (base roles, «الفريق», or
  custom roles), slow mode, approval per channel, allowed content types, default channel for newcomers, archive/restore (archive
  instead of delete; posts stay and nothing widens).
- **المحتوى والتثبيت والإعلانات** (`?s=content`): allowed content types, pins (5 per community, 3 per channel, optional expiry, order),
  announcements (schedule, level, dismissible, at most one notification a day).
- **القواعد والترحيب** (`?s=rules`): structured rules editor (title, body, severity, order) with `communities.rules` kept as the mirror,
  welcome message and steps with completion stats. Rules/welcome fields left «عام والهوية» for this section — still all editable.
- **قاعدة المعرفة** (`?s=knowledge`): wiki sections, lock, FAQ, recent edits. **النمو والشراكات** (`?s=growth`): partners, challenges, invite links.

### Composer
- In a channel with allowed types, only those types are offered (text always allowed; the other buttons are really removed from the screen, not just marked hidden); **slow mode** shows a live countdown.

### Server (`server/services/cchannels.js`)
- `GET|POST /api/communities/:id/channels`, `PATCH …/channels/:ch`, `PUT …/channels/order`, `POST …/channels/:ch/{archive,restore,read}`,
  `POST|PATCH /api/communities/:id/channel-groups[/:gid]`, `GET|POST …/pins`, `PUT …/pins/order`, `GET|POST …/announcements`,
  `PATCH …/announcements/:aid`, `POST …/announcements/:aid/dismiss`, `GET|PUT …/rules`, `GET …/onboarding`, `PUT …/onboarding/:step`,
  `POST …/onboarding/import`, `GET …/onboarding/stats`, `PATCH …/wiki/:slug/section`, `GET …/wiki-recent`. Every check through
  `lib/cperm.js`, every change in the unified community log; guests get 401 on member/staff endpoints.
- Migration **`064_channels_content`** — additive only (7 new tables, 12 new columns (every NOT NULL one has a DEFAULT), new indexes incl. 3 on existing tables: channels by group, posts by channel, wiki by section), reversible `down()`.
  Verified on PostgreSQL 17 seeded to v2.57: existing table fingerprints unchanged, re-run idempotent, `down()` restores the v2.57
  schema exactly. The `community_rules` backfill from `communities.rules` runs lazily and only writes the new table.

### QA
- e2e 56 files serial, all green (new: `communities-v258`, incl. axe on the community page at 390 light / 1440 dark / LTR; `cadmin`
  axe now also covers growth and the new sections in LTR). API 515/537 (only the 22 known local failures), unit 122/122, ESLint 0,
  typecheck 0, crawl 183 routes 0 errors, budget + design-lint not worse (core JS 83.3 KB, CSS 14.9 KB).

## 2.57.0 — 2026-10-18 — «المجتمع 3.0» stage 2/5: the admin panel — essentials (no feature removed)

### Admin panel `#/cadmin` (lazy chunk `cadmin` + `cadmin.css`, loaded after the communities chunk)
- **`#/cadmin`** — «مجتمعاتي التي أديرها»: every community you own, administer or moderate, with pending counts, plus incoming
  ownership transfers to accept or decline. Entry in «المزيد» (section المجتمعات) and on each community page for its staff.
- **`#/cadmin/:id`** — the panel home: status card (type, your role, link to the community page), four counters (members, active,
  posts, review queue), «يحتاج انتباهك» (pending requests, reports, transfers, lockdown), a setup checklist and the latest log entries.
  On phones the section list follows as 52 px rows; from 1180 px the sections sit in a side list.
- **Sections (`?s=`):** general & identity · privacy & membership (join type, questions, approval, invite links with revoke, request
  history + bulk approve/reject, direct member invitations) · members (server-paged search/filter, role, custom roles, warn/mute/ban,
  CSV export for owner/admins) · roles & permissions (custom-role editor on the v2.56 permission engine, ordering, member counts) ·
  channels · moderation · health · danger zone (ownership transfer, archive/restore, lockdown, data export).
- **The old screens open their section:** `#/cset` → general, `#/cmod` → moderation, `#/chealth` → health. Every legacy setting
  (name, privacy, rules, posting permissions, approval, links, media, commercial, assistant) is reachable inside the panel.
- **Forms keep a draft:** an «تغييرات غير محفوظة — تجاهل / حفظ» bar; leaving through a link while dirty is held; leaving any other way
  keeps the draft until you return.
- **What your role cannot change is shown, locked,** with one line on who can («للمالك» / «للمالك والمديرين») — nothing is hidden.

### Server (`server/services/cadmin.js`)
- `GET /api/me/communities/managed`, `GET /api/communities/:id/admin` (overview).
- Join requests are **kept as history** (pending → approved | rejected | cancelled, who/when/why, source direct | invite | link) instead
  of being deleted: `GET /api/communities/:id/requests/history`, `POST /api/communities/:id/requests/decide` (bulk).
- Invite links: `DELETE /api/communities/:id/invites/:code` revokes (row kept), optional granted role / skip approval / note, `uses` counter.
- Direct invitations: `POST|GET /api/communities/:id/member-invites`, `DELETE …/member-invites/:iid`, `GET /api/me/community-invites`,
  `POST /api/community-invites/:iid/decline`. Invite-only communities read these first, then the legacy invite notification, so nobody
  invited before v2.57 loses access.
- Ownership transfer: `GET|POST|DELETE /api/communities/:id/transfer`, `POST /api/community-transfers/:tid/:act` — the recipient accepts
  within 72 h; the previous owner becomes an admin.
- Archive / restore (`POST …/archive`, `…/restore`): read-only and fully reversible; no data deleted. Lockdown (`POST …/lockdown`):
  posting below the moderators paused for up to 7 days (`settings.lockdownUntil`, section `safety`). Export: `GET …/export`.
- Members CSV (`GET /api/communities/:id/members?format=csv`, owner/admins, UTF-8 BOM, formula-safe cells).
- Every change goes through `lib/cperm.js` and is written to the unified community log (category + diff).
- **Lean bootstrap** (flag `community_lean_bootstrap`, on by default, admin kill switch in feature flags): bootstrap carries only your own
  memberships plus every membership of the communities you moderate; member lists come from the paged members API.

### Migration `063_membership` (additive only, reversible)
- `join_requests.status/decided_by/decided_at/reason/source`, `community_invites.revoked_at/grant_role/skip_approval/uses/note`,
  new tables `community_member_invites` and `community_transfers`, indexes. Every NOT NULL column has a DEFAULT; nothing renamed,
  retyped, dropped or rewritten. Verified on a local PostgreSQL 17 copy seeded to v2.56: fingerprints of every pre-existing table/column
  unchanged (only the new feature-flag row added), re-run idempotent, `down()` restores the v2.56 schema exactly.

### Tests
- New `server/test/community-admin.test.js` (API) and `tests/e2e/cadmin.e2e.test.js` (every section opens, save/discard, unsaved-changes
  guard, moderator locks, full ownership transfer with recipient acceptance, archive → restore, axe 390 light / 1440 dark / LTR).
- `communities.e2e` updated: `#/cset` now opens the panel's general section and saves through the bar.
- `mjt-migration.test.js`: the 063 tables join the SKIP set of later-migration tables (rollback test of 061).

### Release checks
- e2e: all 55 files serially — 241/242; the one failure was the known `discovery` typeahead timeout on a slow serial run (same as v2.55),
  3/3 when re-run alone. `cadmin.e2e` 6/6 (axe 0 serious/critical on every panel section, 390 light, 1440 dark, LTR).
- API: only the 22 known pre-existing failures (local migration-additive checks + push availability); `community-admin` + `community-core`
  25/25 and `communities` 9/9 also on PostgreSQL 17; `mjt-migration` 2/2 on SQLite and PostgreSQL. Unit 122/122. ESLint 0. Typecheck 0.
- Crawl: 175 routes (incl. every `#/cadmin` section and the `#/cset` `#/cmod` `#/chealth` redirects), 0 errors; budget + design-lint green
  (core JS 83.3 KB br, `cadmin` chunk 19.0 KB br + 3.1 KB CSS).


## 2.56.0 — 2026-10-18 — «المجتمع 3.0» stage 1/5: the safe foundation (permissions, settings, performance; no feature removed)

### Security & privacy (each fix has an API regression test in `server/test/community-core.test.js` and a browser check in `tests/e2e/community-core.e2e.test.js`)
- **Settings leak closed:** `GET /api/communities`, bootstrap, search/discovery and `/space` carried every community's full settings bag
  (automod word lists, join questions, welcome) — including invite-only ones. Public responses now use an **allow-list** of public settings
  (`lib/community-settings.js`). Invite-only communities are listed only to people who belong to them. Join questions are shown to signed-in
  prospective joiners (not for invite-only outsiders), the welcome to members only.
- **Memberships leak closed:** bootstrap sent members, roles, requests and bans of every community to everyone. Now: active members of
  public communities; your own private communities; requests/bans/mutes only to that community's moderators (a mute shows as the role to others).
  The members tab reads a new server-paginated `GET /api/communities/:id/members` (members-only for private communities).
- **Members-only channel delete** no longer turns its posts public (they keep their channel; unknown channels are members-only).
- **Private-community events** are hidden from outsiders in `/api/events`, bootstrap, search, details, tickets, RSVP and `/e/:id.ics`.
- **Strict hierarchy:** nobody acts on an equal or higher rank (an admin can no longer demote, mute, ban or remove another admin); a muted
  admin keeps an admin's rank; nobody grants a rank equal to their own.
- **Mute/ban keep the role:** `memberships.prev_role` + `status`; unmute (by hand or on expiry) restores the role; every warn/mute/ban is a
  row in `community_sanctions` (lifted_at / lifted_by).
- **CSV formula injection:** cells starting with `= + - @ TAB CR` are prefixed with `'` in the moderation log export; the other exports
  (finance, pricing, study, creator analytics, exams) got the same guard.
- **Invites:** `max_uses` is reserved atomically (row lock on PostgreSQL, serialised transaction on SQLite) — parallel joins cannot exceed it;
  `GET /api/invites/:code` is rate-limited per IP; partnership proposals are rate-limited.
- **Moderator notes:** you delete your own notes or those of a lower rank; deletions are logged. `/reputation` and featured members of a
  private community are for its members.

### Infrastructure
- **`server/lib/cperm.js`** — one permission engine (31 keys in 5 groups) with ranks, used by communities, cspace, cmod and knowledge;
  base grants reproduce v2.55 exactly (parity test role × route). Custom-role foundation: `community_roles` + `member_roles`, endpoints
  `GET/POST/PATCH/DELETE /api/communities/:id/roles`, `PUT/DELETE /api/communities/:id/members/:user/roles/:role` (custom roles only add
  keys, never owner-only ones; nobody hands out a key they lack). The roles editor arrives with the admin panel (v2.57).
- **`server/lib/community-settings.js`** — declared schema (section, permission, validator, visibility); `GET /api/communities/:id/settings`
  and `PATCH /api/communities/:id/settings/:section`; every write (identity, automod, general) is an atomic read-merge-write in one
  transaction (`SELECT … FOR UPDATE` on PostgreSQL) — no more lost updates. The audit log gets `category` + a before→after `diff`.
- **Migration `062_community_core` (additive only, reversible):** indexes (memberships, mod_actions, reports, events, posts, challenges),
  `community_roles`, `member_roles`, `memberships.status/prev_role`, `community_sanctions`, `mod_actions.category/diff/ip_hash`,
  `community_member_stats`, `communities.member_count/posts_14d/last_activity_at/archived_at/slug`, `community_member_events`.

### Performance
- `reputation()` no longer runs two correlated sub-queries per member on every community-page open: per-member stats are aggregated once
  (GROUP BY), kept in `community_member_stats`, bumped incrementally on publish/react and reconciled in the background; `/space` reads a top-N.
  Measured locally (1,500 members, 6,000 posts): `/space` 1,436 ms → 8 ms; cold community-page open 3.4 s → 0.47 s. Small communities unchanged.
- Directory and suggestions: one GROUP BY join instead of a COUNT per community, search filtered in SQL. `/api/events` and bootstrap events:
  one RSVP query instead of one per event. Community posts paginate with a stable `(created_at, id)` cursor.

### Visual leftovers from v2.55
- Western digits in the weekly challenges («تابع 5 أشخاص»، «شارك في 3 نقاشات»), «الاحتفاظ 7 أيام» and the password hints «8 أحرف».
- The admin dashboard, interests centre and «القرارات على حسابي» use the unified page header (were «→ الإعدادات» + a bare heading).
- The purple tile with a letter in the top bar of signed-out visitors (the local placeholder profile's avatar) is gone.
- The «404 at boot» seen in v2.55 QA came from the QA script itself (`POST /api/follow/:id`, a route that never existed), not the app.

### Release checks
- e2e: one clean full run, 54 files, 236/236 (incl. the new `community-core` 4/4). `p78` failed once in an earlier full run on
  `color-contrast: .kpi-tile:nth-child(4) > b` (admin contracts, dark): not a colour token — the tile's computed colours are correct
  (#f3f1fa on #17151f). Realtime notification toasts (translucent glass, fixed at the top) land at timing-dependent moments and can sit
  over the KPI row, so axe blends their backdrop into the tile. The test now dismisses them (✕) before auditing; no CSS changed, same
  code in v2.55. Proven flakes (pass 3/3 alone and in the clean full run, failed once under full-suite load): `content` «audio post»
  (`waitForEvent("filechooser")` timeout) and `discovery` «search typeahead» (suggestion listbox not shown within 30 s).
- API (SQLite): only the 22 known pre-existing failures; `community-core` 15/15; `mjt-migration` green. Migration 062 on PostgreSQL 17:
  applied on a v2.55-migrated + seeded database (061 → 062), memberships and posts checksums unchanged, second boot idempotent,
  `community-core` 15/15 on PostgreSQL.
- unit 122/122, ESLint 0, build OK, budget OK (core JS 83.4 KB / 90 KB Brotli, core CSS 14.9 KB / 16 KB), design-lint no regression,
  axe 0 serious/critical on 24 screens (light + dark), logged-in crawl 161 routes 0 errors (only the expected pre-login 401), CLS 0.

## 2.55.0 — 2026-10-18 — Design evolution, stage C (final): messages, admin, edge states, emoji-free server strings (no feature removed)

### Messages
- **List:** larger page title, the three header actions (linked devices, new group, new message) as soft icon tiles, pill search,
  conversations inside one card with hairline separators and 52 px rounded-square avatars, unread badge ringed in the card colour,
  the E2EE explainer as an entry card with an icon tile. Empty/no-results/requests states with an icon tile, a title and one line.
- **Chat:** own bubbles in a subtle brand gradient (white text stays ≥ 4.5:1), the other side's bubbles on the card with a hairline,
  42 px avatar in the header, pill day separators, composer field on the sunken surface; chat-info/devices/new-group rows get icon tiles.

### Admin
- **Admin dashboard:** every module's shortcut (finance, ops, Pi, tips, paid, market, ads, AI, i18n, trust, status, investigations,
  compliance, activation/transfers/pricing/revenue/digital, business, launch…) was injected with its own markup — with or without an
  icon, different arrows and heights. They are now collected into one grouped list «أدوات الإدارة» of uniform rows (icon tile ·
  title · sub-line · chevron); ids, hrefs and handlers are kept, so every entry point and test selector still works. Compact 3/4-column
  KPI grid. Empty trends card says so. Fixed: the server KPI tiles (users/online/retention) were appended twice when two renders overlapped.
- Page heads with icons on admin AI, a11y audit, UI strings and digital reports; AI subscription and translation preferences moved to
  the shared page head (were «→ رجوع» + bare `<h2>`). Collabs/certificates numbers use Western digits like the rest of the app
  (the Arabic-Indic zero read as a dot in KPI tiles); the exam counter's first «0 من N», «0 يعني بلا حد», «دون 18 سنة» and «90 يوماً»
  were still hard-coded Arabic-Indic and now match.

### Translate
- The «ترجمة / عرض الأصل» button carries a Lucide *languages* icon (its text content is unchanged).

### Server strings without emoji (cleaned at the source; the display-side sanitiser stays as a fallback)
- Notification verbs (video, scheduled, badge, verified, welcome, level-up, business claim, course, seasons, certificate, ambassador),
  the «مختبر تجريبي» badge (now rendered with a flask icon), push test text, collabs deal-room events, community welcome DM, market
  order chat title, help-centre/launch article text, ops admin notes.
- Business categories and Hijri occasions/seasons/national days now carry Lucide sprite ids (`"i:store"`, `"i:moon"`…, same
  convention as discovery collections) instead of emoji. No migration and no stored data rewritten; stored rows keep rendering through the sanitiser.

### Edge states
- **404:** title, one line and two actions (Home, Search). **Error states** (`.empty.err`): icon tile instead of the empty-state drawing
  (explore, notifications, messages). **Network failures** read «لا يوجد اتصال بالإنترنت — تحقق من الشبكة ثم أعد المحاولة» instead of
  the browser's «Failed to fetch» (`e.code = "offline"`, `e.status = 0`; offline outboxes still see a falsy status).
- Any `.empty` that starts with an icon shows it in a tile (no drawing behind it): calls, organisations, search, etc. Home's empty
  feed uses the shared empty component. `offline` glyph added to the core sprite (the notifications error icon was blank).
- Page-head back links never underline (compliance/my-data/transparency pages).

### Checks
- Budget: core CSS 14.9 KB / 16 KB br, core JS 83.2 KB / 90 KB br; design-lint green, `hexAll` baseline 406 → 405.
- Release run: e2e 53 files serial, 231/232 — `discovery` «search: … typeahead listbox» timed out once waiting for the suggestion
  list (60 s file run vs ~31 s normally, slow box); it passed in the earlier full run and 3/3 alone (no code touched it in 2.55).
  Unit 122/122, API 480/502 (only the 22 known), ESLint 0, axe 0 serious/critical (12 routes light + dark), logged-in crawl 161 routes
  0 page/console errors, CLS 0.

## 2.54.0 — 2026-10-18 — Design evolution, stage B: icons instead of emoji, shared components (no feature removed)

### Fixes
- **Community composer row («اكتب في …»):** the avatar was a stretched bar and the placeholder wrapped in a narrow pill (the
  `.c-compose > span` rule hit both the avatar and the text). The avatar is now a fixed 40 px circle and the field is full width,
  one line with an ellipsis.
- **Missing glyphs (tofu):** UI emoji rendered as empty boxes on systems without a colour-emoji font (e.g. «👋 ابدأ ببناء دائرتك» on Home).
  Every UI emoji was replaced app-wide.

### Icons
- 41 more Lucide glyphs in the core sprite (folder, list, flask, layers, scale, calendar, clapper, trendUp, unlock, ban, bulb, alert,
  brief, medal, trash, doc, hourglass, party, raise, clip, bellOff, handshake, receipt, archive, unarchive, eyeOff, book, cap, store,
  moon, coin, headset, tag, mobile, undo, bug, mega, clock, ticket, wrench, okCircle); the `feat` chunk no longer re-ships the ones
  that moved to core and skips any symbol the core sprite already has.
- Emoji in UI strings: 0 left (design-lint `emojiInJs` 271 → 50, every remaining one is content or a code comment; baseline lowered). Heading emoji → `.ic.hi` accent icons; emoji after a tag or
  inside menus/buttons/rows → `.ei` inline icons (quote-free markup, works in any string); emoji in text-only places (toasts, `textContent`,
  `<option>`, notification verbs, labels used as keys) removed. Content emoji stay: reactions, seed posts, community icons chosen by users.
  Server notification verbs that still carry emoji are cleaned at render time (list and in-app banner).
- Medals 🥇🥈🥉 in community leaderboards → numbered rank badges.

### Shared components
- **Sheets & menus:** a real title for the first heading in a sheet; menu rows 52 px with the icon in a soft tile (danger rows in a red tile).
- **Disclosure cards (`details.card`):** one chevron that turns on open, no native marker (market filters, knowledge, charity, work, mentors…).
- **Entry cards** (settings/admin shortcuts with a leading icon): icon tile + text column.
- **Page heads:** actions stay on one swipeable row on phones instead of wrapping; finance, price book/revenue, beta and help/launch pages
  now use the shared page head with an icon (were hand-made `<h2>` + back link).
- **Toasts** size to their text (no more two-line toasts at half the screen width); **file pickers** styled like the rest of the form;
  **skeleton** `.skel.sm` for «load more» (market) instead of a text line; print hides page-head back links.

- **Sheet focus:** the bottom-sheet helper moved focus to the first field/button 60 ms after any sheet opened, overriding a sheet that
  had already focused its own dialog title (market purchase, tip sheet) — screen readers lost the title. It now leaves focus alone
  when it is already inside the sheet, honours `[autofocus]`, and only falls back to the first control otherwise.

- **Background refresh vs. a just-opened form:** a realtime refresh re-rendered the screen while focus was on the `<summary>` of a
  disclosure the user had just opened (e.g. «واجب جديد» on a study session), snapping it shut before they reached the first field
  (P71 e2e failed ~1 in 2 alone). The refresh now holds the render in that case, the same way it already does while typing.

### Tests (no assertion relaxed)
- p76/p77 axe helper measures settled colours: transitions are switched off and finite animations finished while axe runs (the tests
  flip `data-theme` directly, and a colour transition that starts only when axe first reads an element gave 1.02:1 false failures
  under load). Reproduced 2/6 under load before, 0/6 after.
- API-registered test members get the guided tour marked done up front (`harness.tourDone`, mjt/p75–p80) and `dismissTour` waits up
  to 12 s: under load the tour landed after the 4 s window and sat over the next click.

### Checks
- Budget: core CSS 14.6 KB / 16 KB br, core JS 82.3 KB / 90 KB br; design-lint green.

## 2.53.0 — 2026-10-18 — Design evolution, stage A: new icon set, new community cards (no feature removed)

### Look & feel (same identity: logo, purple→magenta brand colours, system Arabic font)
- **New icon set:** 166 glyphs in the core sprite (`ui.js` ICON_PATHS, 64), the tab/back sprite (`nav.js`) and the module
  sprites (`feat-ui.js`, communities, messages, calls, discovery, notifications, composer, minors) — redrawn from
  **Lucide** (ISC licence, notice in `vendor/LICENSE-lucide.txt`) at a 1.75 stroke, with filled variants for the active tab
  (home, compass, users, bell, user, bookmark, heart). Tab bar: a soft pill under the active icon, bolder label, a small pop when a tab turns on.
- **Unified card language:** hairline border + two-layer soft shadow (`--card-bd`, `--sh-1/2`, `--sh-card-lg`), 20 px radius, press
  feedback on tappable cards, hover lift on desktop; dark mode uses a slightly deeper card (`#17151f`) and a 1 px line instead of the border.
- **Post card:** roomier padding, 46 px rounded-square avatars, 16 px body text at 1.78 line height, a quiet action bar separated by a hairline, 42 px pill actions.
- **Chips & tabs:** one solid active state (`--chip-on-bg/fg`), lighter inactive chips; section titles (`h4`) are readable bold headings instead of small caps.
- **Fields:** search inputs carry a search icon (RTL/LTR aware), every input/select ≥ 44 px tall, softer placeholders.
- **Empty states:** a brand illustration above every `.empty` message.

### Community page (first) and community cards
- **Community page:** cover with a soft dot pattern and gloss, an identity card that overlaps the cover (80 px icon tile, name, type/topic meta,
  description), a 3-column stats strip (members · posts this week · moderators), icon-only share / safety / settings actions, sticky underline
  tabs coloured by the community, pill channels, a «write in this community» composer row, date-tile event rows, a member grid.
- **Directory, suggestions, «مجتمعاتي»:** new cards with a colour band, an overlapping icon tile, a member-state pill and a meta footer;
  «مجتمعاتي» is a story-style row of ringed tiles. Profile community tiles get the same pattern.

### Navigation fixes
- Every screen now lights the tab it lives under, wherever it was opened from: a community page (and its moderation/settings/wiki/events
  screens) → «المجتمعات», explore/notifications screens → their tab, hub features (jobs, wallet, courses, MJT, …) → «المزيد». Only shared
  content (a post, a share sheet, a person's profile) keeps the tab it was opened from. (Before, opening a community from the feed lit «الرئيسية».)
- The top-bar title on a community page now appears once the community name scrolls away — the page re-renders its heading, and the bar
  used to keep watching the detached one (the title never showed).

### Accessibility
- Theme switches run with transitions disabled for two frames (`:root.no-tx`), and the tab labels no longer animate `color` — colours can
  no longer lag one frame behind the new scheme (the dark-mode contrast failure in p77/settings).
- Community «write in …» row no longer nests the avatar link inside the button (axe nested-interactive).
- Tab bar background 92 % card (was 78 % glass): labels stay ≥ 4.5:1 whatever scrolls underneath (axe found 4.45:1 over a red button).

### Build & tests
- CSS budget 14 → 16 KB brotli (design layer); `launch`, `assistant`, `finance-design` e2e now assert the same budget as `tools/budget.mjs`.
- New `nav-deep.e2e`: community page owns «المجتمعات», title after scroll, post keeps its opener tab, theme flip without transitions.
- `pwa.e2e` waits for the service worker to finish storing the online feed before going offline (the SW writes the cache after answering, so a loaded machine could race ahead of it — test-only fix, SW behaviour unchanged).

## 2.52.0 — 2026-10-18 — Navigation & design overhaul (no feature removed)

### Navigation
- **Tab bar (5):** الرئيسية · استكشف · المجتمعات · الإشعارات · **المزيد** (`#/menu`). «حسابي» moved into the top bar (your avatar → `#/me`)
  and into «المزيد»; saved custom tab orders that named `me` are read as `menu` on the client and the server (`normUi`, additive, no migration).
- **«المزيد» hub (`#/menu`, lazy chunk `menu` + `menu.css`):** every screen that is not a main tab is listed once, in clear categories
  (أنت · التواصل · اكتشف · المجتمعات والخير · الإبداع والنشر · التعلّم والمعرفة · العمل والمهن · المحفظة والمتجر · الأمان والخصوصية ·
  المساعدة والمعلومات · الإعدادات · الإدارة for staff),
  with Arabic-normalised search (English aliases too) and shortcuts. Pi screens stay listed with «غير مفعّل بعد» while Pi payments are off.
  The hub is warmed in idle time after sign-in, so it opens instantly.
- **Top app bar:** on a tab root → brand + language, search, messages, avatar; on a deep screen → a real back button + the screen title
  (fades in once the page heading scrolls away; a post is titled «المنشور», and screens that render late — a community page — are re-read). The 🔖 shortcut moved into «المزيد» → «المحفوظات».
- **Back that never leaves the app (`nav.js`):** in-app history when there is some, otherwise the screen's logical parent (its page-head link,
  then a route map, then its tab) via `location.replace`. A deep screen keeps the tab it came from highlighted; re-tapping the active tab
  scrolls to the top. Scroll position is saved per entry and restored on back (async screens waited for up to 2.5 s unless the user scrolls).
- Direction-aware transitions (`#view[data-nav=push|pop|tab]`, RTL/LTR aware, off with reduced motion); both bars hide while scrolling down
  on phones; an edge swipe goes back. `#view { overflow-x: clip }` so the sideways entrance never widens the page. Keyboard: `g m` opens «المزيد».

### Performance
- Same-process A/B (390 px, CPU ×4, real animations, 3 reps): tab switches 113–153 ms warm median (was 173–193), home → post 228 ms (was 335),
  long tasks lower on most navigations, CLS 0 everywhere, no horizontal overflow (was 394 px on two screens).
- No forced reflow to restart the screen-enter animation; theme colours read only when the theme changes (not on every route); the
  desktop rail is not re-cleared on every render.

### Design & accessibility
- New `--ok-ink` token (light `#0f7a4a` 5.4:1 on white, dark `#34c88e`) for green **text**; `--ok` stays for fills, borders and icons.
  Used by `.wk-pay`, `.delta.up`, `.u-c-ok`, `.qa-n.ok`, `.scan-res.ok`, `.dv .ok`, `.d-caught`, `.x-up`, `.fn-in`, `.nf-saved`
  (was `#18a676`, 3.1:1 — failed WCAG AA).
- Why v2.51 tests did not catch it: axe-core's icon-ligature heuristic marks a font family as an "icon font" after a few text nodes look
  like ligatures; with the old top bar the first Arabic text nodes did, so axe silently skipped colour-contrast for the whole page.
  The new top bar changed the first text nodes and axe now checks every screen (contrast checks are stricter from v2.52 on).
- Rail footer showed a stale «2.3.0» — the build now injects the real version.

### Fixed
- **ALT editor for the post owner:** the owner check now runs as its own pass (not tied to the once-only media marker), retries briefly while the session/me record loads, and re-runs on `mp:session` → the «ALT» button no longer goes missing when a post is painted before the session is known. `a11y-settings` e2e now asserts role + alt text + editor on one consistent snapshot (late chunk re-renders replaced the node between separate checks).
- **Lost local change (sync race):** a background refresh whose `/api/bootstrap` answer landed in the ~60 ms between a local change
  (e.g. saving a post edit) and its diff overwrote the change with the older server copy. `refresh()` now pushes pending changes first and
  re-reads afterwards (found by a full serial e2e run: `editors.e2e` «تعديل» intermittently).
- **Background re-renders no longer wipe a form in progress:** the AI chunk re-rendered the current screen when it arrived (~1–3 s after
  sign-in) and a refresh did the same when no field had focus — e.g. the ad wizard lost the picked post and name. A shared `formDirty()`
  check (focused field, or any changed control in a form / dialog) now defers both (found by `ads.e2e`, intermittent).
- Community page head on phones: a member's 3–4 action buttons squeezed the community name to one word per line; the name now keeps
  ≥ 200 px and the actions move to their own row.
- Points / leaderboard / admin points: no page error when the member leaves the screen while it loads.
- Discovery and notification tabs no longer jump the page when the selected tab is the first one.

### Tests
- `nav.e2e` (tab bar, menu, back, titles, scroll restore, reduced motion, RTL/LTR) and `nav-routes.e2e` (every hub entry reachable,
  no page errors); `quality.e2e` axe now also covers `#/menu` and `#/jobs`; visual baselines refreshed for the new bars.

## 2.51.0 — 2026-10-18 — Audit fixes: security, guest load, registries (no feature removed)

### Security
- **Per-client rate limits behind Railway** — `TRUST_PROXY=1` is now set on the Railway `web` service and the server reads the
  client address as `X-Real-IP` → leftmost `X-Forwarded-For` → socket (Railway's edge overwrites both headers). Before, every
  request came from the proxy address, so one attacker could exhaust the sign-in / sign-up limits for the whole platform.
- **Admin bootstrap** — only the very first real account ever becomes admin, decided by one conditional `UPDATE` (no race between
  two sign-ups on a fresh DB). A sign-up can no longer take over the platform after the last admin is removed; an operator can use
  the optional `ADMIN_BOOTSTRAP_HANDLE` env (only while no admin exists). Existing admins untouched.
- **HSTS** (`Strict-Transport-Security: max-age=31536000; includeSubDomains`) in production (`HSTS=0` turns it off, `HSTS=1` forces it).
- **HEAD** answers exactly like GET (status + headers, no body) for `/`, `/api/health` and static files (was 404).
- «النشر باسم منظمة»: the `X-Act-As` header now rides on that one API request (`Remote.use` middleware) instead of a temporary
  global `window.fetch` patch that concurrent requests, uploads and third-party SDKs could pick up.
- Reproducible server installs: `server/package-lock.json` + `npm ci` in both Dockerfiles (`npm audit` works again: 0 issues).

### Performance (guests)
- The guest (sign-in screen) no longer preloads ~33 feature chunks: it downloads only what its screen needs (a11y, age field,
  invite/referral + about/waitlist/help, app install, Pi sign-in only when Pi is enabled) — 6 chunks. Everything else warms up
  exactly as before right after sign-in. `launch` and `pwa` also load on their own routes now.
- Guests make no protected API calls: one expected `401 /api/bootstrap`, no WebSocket attempts (was ~14 × 401 + endless WS retries).
  Beta polling (was up to 40 tries every 1.5 s) only runs when signed in, stops on 401/403 and backs off 2 s → 60 s (max 6).
  Chat WebSocket stops on sign-out and caps reconnects at 8 consecutive failures (realtime continues over SSE).
- Pi SDK `<script>` is `async` (a slow minepi.com no longer blocks first paint); `PiAdapter` waits for that tag before falling back.

### Architecture
- `registry.js` (core): `MPRoutes.extend / add` and `MPSettings.add` replace the 49-file `window.ExtraRoutes` and 23-file
  `Views.settings` override chains with one ordered registry — same semantics and order; a hook that throws is logged and skipped
  instead of breaking every hook after it. `MPSession` ("unknown" / "in" / "out", `whenIn`) gates protected modules.
  `Remote.use` middleware replaces the `Remote.api` wrappers.

### Fixed
- `#/subs` without a creator showed a 404 (`/api/subs/undefined`) — now explains where monthly subscriptions live.
- `#/wallet`, `#/admin/pi`, `#/admin/transfers`, `#/receipt/:id` no longer call Pi APIs that answer 501 while Pi payments are off;
  they show «مدفوعات Pi غير مفعّلة بعد» directly (features kept, still off until Pi activation).
- `#/admin/digital` page error (`Cannot read properties of null (reading 'remove')`).
- `/about` for a signed-out visitor showed the sign-in screen instead of the public landing (the `launch` chunk now arrives before
  boot finishes, so it re-shows the landing after the auth screen paints).
- AI upsell from the ✨ assistant button listed «المساعد الذكي (قريباً)» even though the plan includes the assistant: the AI chunk's
  cached plan is refreshed after the assistant seeds it (pre-existing since v2.42; `assistant` e2e now passes).
- ESLint: 0 errors / 0 warnings (browser globals for e2e/tools, unused variables removed); old `tools/design-shots-v230/v231/v237.mjs` removed.

### Tests
- New `server/test/v251.test.js` (HEAD, HSTS, TRUST_PROXY client address, admin bootstrap) and `tests/unit/registry.test.js`.
- `devapi` e2e: the core check now looks for the portal's code (chunk / markers) — since v2.38 the settings index carries the
  «بوابة المطورين» row label by design.
- Full e2e suite run serially, logged-in crawl over 160 routes (light): 0 page errors, 0 console errors, 0 unexpected 4xx/5xx.

## 2.50.0 — 2026-10-18 — The editor rebuilt: a simple community editor and a creative general editor

### Why there seemed to be two editors
- There really were two (three, counting dead code): the full-screen v3 editor (post / article / audio / story) and the old
  bottom-sheet v2 editor from `v12.js`, which still opened for poll, question, discussion, event, thread, video, quotes,
  the events page, the explore prompt and offline — and from the «⋯» button inside the v3 editor, which closed it and opened
  the sheet with its own, different type tabs. `openComposer` was defined in `app.js`, overridden in `v12.js` and wrapped
  again in `content-ui.js`; posting in a community wrapped the creative editor once more and patched the API client; editing a
  post used `prompt()` in two different menus.

### Changed
- **One editor core, two editors** (lazy chunks `composercore` + `composer`, docs/COMPOSER.md):
  - **Community editor (simple)** — opened from inside a community: the community is fixed (card with its name and whether
    moderators review posts first), optional channel and tag, a big text area, images, an optional poll or question, the
    community rules at hand, and «نشر» / «إرسال للمراجعة». Nothing else.
  - **General editor (creative)** — every post type in one place (post, article, poll, question, discussion, thread, event,
    video, audio, story), formatting toolbar, write / preview (live side-by-side preview on wide screens), up to 10 images
    (drag to reorder, alt text, paste and drop), @mentions, spelling and hashtag assistant + the AI assistant button,
    «خيارات النشر» (audience incl. close friends and lists, topic, place, schedule + best time, article series, sensitive
    warning, paid access, content labels, save as template), synced drafts and templates, character counter.
  - **Edit** — editing your own post now opens the editor (text only) instead of a browser prompt.
- Every entry point routes through `openComposer(init)`: FAB / home bar → general; community page → community; quote →
  general (quote mode); «تعديل» → edit; #/drafts «متابعة» → the draft's own editor; events «حدث», explore prompt, topic
  page, story ring, studio calendar / templates and the PWA share target → general.
- Polls, questions, discussions, events and threads now publish straight to the API from the general editor (events create
  the event first; threads publish as a numbered series); offline posting still goes through the local store.
- Drafts remember their editor: an additive, whitelisted `x` object in the draft JSON (mode, community, channel, tag, topic,
  place, poll, thread parts, event, …) — no migration. Closing with content saves a draft and says so.
- Extensions use `window.MPComposerHooks` (`mount` / `onType` / `check` / `apply`) instead of DOM observers and API-client
  wrappers: paid «الوصول» (still disabled while Pi payments are off) and minors content labels moved to it.

### Removed
- The v1 (`app.js`) and v2 (`v12.js`) composer sheets, the v3 composer inside core `content-ui.js`, the community-ui composer
  wrapper, the paid / minors API-client patches for the composer, and the identity-ui patch of the old sheet.
  Core JS 84.2 → ~76 KB brotli, core CSS 13.4 → 12.9 KB (editor styles moved to the lazy `composer.css`).

### Tests
- `tests/unit/composer-core.test.js` (routing, normalisation, validation, request plans, offline, drafts) and
  `tests/e2e/editors.e2e.test.js` (FAB → general, community page → community, approval label + pending, drafts resume,
  quote, edit, question / event / thread, axe on both editors); content, communities, minors e2e adjusted.

## 2.49.0 — 2026-10-18 — «العوالم» removed

### Removed
- The composer's «النشر أيضاً في العوالم» chips (developers, creators, investors, entertainment, knowledge) and the 🌐 world label
  on post cards. They were tags only (no pages, feed or verification), duplicated communities/topics/jobs/talent, and an
  «investors» space invites scams. Existing posts keep their stored `worlds` field (API unchanged); it is simply no longer shown.

## 2.48.0 — 2026-10-18 — New logo

### Changed
- **New brand logo** approved by the owner: interlocking speech-bubble «+» on the violet → magenta → coral squircle.
  Sources in `assets/brand/` (master 1024 on transparent + full-bleed maskable with the mark inside the 80% safe zone).
- All PWA icons (any 48–512, maskable 192/512, monochrome, apple-touch, favicon) and the 15 splash screens regenerated from it
  by `tools/icons.py` (`npm run icons`, Pillow); same file names and sizes, so the manifest is unchanged. Replaces `tools/icons.mjs`.
- In-app logo (header, side brand, onboarding, sign-in) now shows the artwork (`/icons/logo-mark-128.png`) instead of the CSS «+».
- `<link rel="icon">` favicon added; service-worker cache bumped to `mp-2.48.0`.

## 2.47.0 — 2026-10-17 — «مجتمع كوين» (MJT) stage 1: the in-app balance

> MJT stage 1 is an **in-app balance on Mujtama+'s own double-entry ledger**. It is **not on any blockchain** and **not a Pi
> Mainnet token**; it cannot be withdrawn or sold. Stage 2 (a Pi **Testnet** asset) is a plan only: docs/MJT-PI-TESTNET-PLAN.md.

### Added (#/mjt, #/admin/mjt)
- **Ledger** (`server/lib/mjt-ledger.js`): integer minor units (1 MJT = 10,000,000, parsed from decimal strings — no floats),
  double entry (every transaction sums to 0), UNIQUE idempotency key on every mutation (replay → the first result, a different
  request → 409), conditional balance updates + row locks in one global order (users, then system accounts) so balances never go
  negative and nothing is spent twice under concurrency, a CHECK constraint as a second guard, `balance_after` on every entry,
  `verify()` re-deriving everything, and an append-only `mjt_audit` written in the same DB transaction. System accounts
  `sys:mint` / `sys:burn` / `sys:treasury`; 100M MJT ceiling.
- **Points → MJT conversion at 1 point = 1 MJT**: earned points of the earning kinds + negative staff adjustments − points already
  redeemed for Pi; reversed awards and positive staff point adjustments are not converted. Non-destructive (the points tables are
  never written; points stay as reputation and levels), one DB transaction per run with a batch id and report, idempotent
  (partial unique indexes: one applied conversion per member, one live link per award), dry run, all-or-nothing rollback (refused
  while converted MJT is spent), CLI `server/scripts/mjt-convert.js`. Runs once automatically after boot in production
  (`MJT_AUTO_CONVERT=0` disables).
- **Rewards**: every new contribution-points award mints the same MJT, on top of the phase 59 anti-gaming rules, with an MJT daily
  cap (150 by default), a rewards switch, clawback (burn) when the content is removed — never below 0 — and a reconcile job. The
  points → Pi redemption is retired while MJT is linked (409 `redemption_retired`), so no point pays twice.
- **Transfers between members** with an idempotency key per attempt: 500 MJT per transfer, 2,000 per day, 10 per hour, sender
  account ≥ 7 days; minors (either side), blocked pairs, linked accounts, integrity-flagged senders, frozen wallets and recipients
  who turned receiving off are refused. Notification `mjt_received`.
- **Staff**: adjustments (admins, ± with a reason, never below 0, audited, notified `mjt_adjusted`), freeze / unfreeze with a
  reason, settings, ledger verification, conversion dry run / apply / rollback, recent transactions.
- **UI** (lazy chunk `mjt`; core only gains the route entry and the Settings link): wallet with the balance and the label «رصيد داخل التطبيق فقط — ليس عملة على
  أي بلوكشين»، today's rewards vs the cap, the conversion note, السجل / طرق الكسب / إرسال, receive switch; Settings →
  «المدفوعات والمحفظة» → «مجتمع كوين (MJT)»; the points page links to the wallet instead of the retired Pi redemption.
- Migration `061_mjt` (additive, reversible), 3 data-map entries (kept: financial records), 2 notification kinds.
- Docs: docs/MJT.md, docs/MJT-PI-TESTNET-PLAN.md.

### Disabled in production
- **Buying MJT with Pi** — `POST /api/mjt/buy` → 501 not_configured (Pi payments are off; a later stage even when Pi is on).
- **Spending MJT in the store / services** — nothing accepted contribution points before, so nothing was re-wired; tested internal
  `spend()` / `refund()` primitives are ready for that stage.
- **Any blockchain / withdrawal** — none in stage 1.

### Routes
- API: GET /api/mjt/config · GET /api/mjt/supply · GET /api/mjt/me · GET /api/mjt/history · POST /api/mjt/transfers ·
  PUT /api/mjt/receive · POST /api/mjt/buy (501) · GET /api/admin/mjt · GET /api/admin/mjt/verify · PUT /api/admin/mjt/settings ·
  POST /api/admin/mjt/adjust · POST /api/admin/mjt/accounts/:handle/freeze · GET /api/admin/mjt/conversion/dry-run ·
  POST /api/admin/mjt/conversion · POST /api/admin/mjt/conversion/:id/rollback · POST /api/admin/mjt/reconcile.
  `GET /api/points/config` reports `redemption.reason: "mjt"`.

### Tests
- API `server/test/mjt.test.js` 11/11, `mjt-invariants.test.js` 6/6 (seeded property test: 3 seeds × 140 random operations incl.
  replays and over-balance attempts, checked against an independent model after every step; concurrency: parallel spends,
  parallel replays of one transfer, opposite transfers, parallel rewards vs the cap, parallel conversions),
  `mjt-migration.test.js` 2/2 (realistic generated copy: demo seed + 160 members / ~1,900 awards; up / down / re-run; PG
  `verify-migrations --apply`) — all on SQLite and PostgreSQL. Touched suites: points 6/7 and finance (only the known additivity
  false positive 053/054/059), compliance 12/12, notify 9/9 (SQLite + PG). Unit `tests/unit/mjt-ledger.test.js` 3/3 (+ all unit).
  e2e `tests/e2e/mjt.e2e.test.js` 3/3 (axe light + dark on every screen, 44 px, CSP hygiene, screenshots 390 light / 360 dark);
  touched e2e beta-points 3/3, settings-v238 5/5, flicker 3/3.
- A mutation check (removing the conditional balance guard) makes the invariant and concurrency tests fail, as they should.

## 2.46.0 — 2026-10-17 — Phase 80: professional reputation & verified reviews «السمعة المهنية والتقييمات الموثّقة» — Track 16 complete

### Added (#/reviews, #/reviews/new, #/reviews/u/:handle, #/admin/reviews)
- **Verified reviews only**: after a completed contract (both sides) or a completed team / project (members who took part for at least 3 days), each side rates the other within 30 days: overall 1–5, three criteria that depend on the role, and an optional text. One review per engagement and person.
- **Double-blind**: a review stays hidden from the other side until they review too or the window closes, so nobody answers a rating with a rating; the author can edit until then. The reviewee can publish one public **response**.
- **Reputation** on the CV (strip with the score, count, finished jobs and badges), on talent-directory cards and for employers on job applications; a full page per member with the distribution, averages per role and criterion, badges, endorsed skills and the reviews with responses.
- **Skill endorsements** from verified collaborators (a finished contract or team in common), for skills on the professional profile, up to 5 per person; 3+ endorsements make a skill «موثّقة».
- **Badges**: أول عمل منجز · محترف نشط · خبير موثوق · تقييم ممتاز · ملتزم بالمواعيد · روح الفريق · مهارات موثّقة.
- **Anti-abuse**: no self reviews, blocked pairs cannot review, only the latest review per pair counts (repeated small jobs between the same two accounts do not stack), reviews from new accounts (< 7 days) or very short engagements (< 24 h) are shown but not counted, reports (3 take a review down until staff decide), staff dismiss / hide with a reason / restore (audited) and see reciprocal pairs.
- **Minors**: review and are reviewed only through the unpaid contracts and teams they may join; their reputation is never public (themselves, followers and staff).
- 6 notification kinds, 4 data-map entries. Entry points: Settings → الحساب «التقييمات المهنية», completed contracts and teams. Migration `060_proreviews` (additive, reversible).

### Disabled in production
- Nothing — reviews use no paid services; everything is live.

### Routes
- API: GET|POST /api/proreviews · PATCH /api/proreviews/:id · PUT /api/proreviews/:id/response · POST /api/proreviews/:id/report · GET /api/proreviews/u/:handle · GET|PUT /api/proreviews/endorse/:handle · GET /api/admin/proreviews · POST /api/admin/proreviews/:id. `GET /api/pro/u/:handle` adds `reputation`; `GET /api/pro/search` and `GET /api/jobs/:id/applications` add `rep`.

### Tests
- API `server/test/proreviews.test.js` 3/3 on SQLite and PostgreSQL; touched suites proprofile 5/5, jobs 4/4, contracts 4/4, teams 3/3 (SQLite + PG), notify 9/9, compliance 12/12; unit 109/109; pricing only the known additivity check (053/054, and the false positive on `wt_updates` in 059). e2e `tests/e2e/p80.e2e.test.js` 2/2 (axe light + dark on every screen, 44 px, CSP hygiene); touched e2e p76 2/2, p77 2/2, p78 2/2, p79 2/2, settings-v238 5/5, content 7/7, flicker 3/3. Screens reviewed at 390 light / 360 dark. Core JS Brotli 86,287 B / 92,160 B, core CSS 13,698 B / 14,336 B; `proreviews` chunk 6.2 KB JS + 1.0 KB CSS (Brotli). Design lint: no regression.

## 2.45.0 — 2026-10-17 — Phase 79: teams & group projects «الفرق والمشاريع»

### Added (#/teams, #/teams/new, #/team/:id, #/teams/join/:code)
- **Teams and projects**: name, about, private (invite only) or listed in a public **directory** with Arabic search. Roles owner / admin / member / viewer; ownership transfer; complete, archive and reopen.
- **Joining**: direct invites (accept / decline), **invite links** with expiry (1–30 days) and a use cap, revocable, and **join requests** on listed teams that owners / admins accept or decline.
- **Task board** with four columns (للتنفيذ · قيد العمل · للمراجعة · منجزة), assignee, due date, priority and order; assignees are notified.
- **Files & links** (http(s) links or uploaded images) and **updates & discussion** (updates / questions with replies; risky text carries a warning).
- **Contracts link** (phase 78): a team can follow a contract its owner is party to, show its milestones, and point tasks at a milestone.
- **Minors**: private teams by invite only; no listed teams, public links/requests or teams linked to paid contracts.
- 8 notification kinds, 6 data-map entries. Entry points: Settings → الحساب «الفرق والمشاريع», #/jobs, the contract page. Migration `059_teams` (additive, reversible).

### Disabled in production
- Nothing — teams use no paid services; everything is live.

### Routes
- API: GET|POST /api/teams · GET /api/teams/directory · GET /api/teams/join/:code · POST /api/teams/join · GET|PATCH /api/teams/:id · POST /api/teams/:id/{state,invites,request,transfer,tasks,items,updates} · POST /api/teams/:id/invites/:iid/revoke · POST /api/teams/:id/requests/:iid · PUT /api/teams/:id/me · PATCH|DELETE /api/teams/:id/members/:uid · PATCH|DELETE /api/team-tasks/:id · DELETE /api/team-items/:id · DELETE /api/team-updates/:id · POST /api/team-invites/:id/respond.

### Tests
- API `server/test/teams.test.js` 3/3 on SQLite and PostgreSQL; e2e `tests/e2e/p79.e2e.test.js` 2/2 (axe light + dark, 44 px, CSP hygiene). Screens reviewed at 390 light / 360 dark. Core JS Brotli 86,215 B / 92,160 B, core CSS 13.4 KB / 14,336 B; `teams` chunk 7.1 KB JS + 0.5 KB CSS (Brotli). Design lint: no regression.

## 2.44.0 — 2026-10-17 — Phase 78: contracts, milestones & escrow «العقود والمراحل»

### Added (#/contracts, #/contracts/new, #/contract/:id, #/admin/contracts)
- **Contracts** from an accepted job application («إنشاء عقد بمراحل» on an offered / hired application, prefilled with the bid) or as a **direct offer** to any member: title, scope, revisions allowed per milestone, 1–10 **milestones** with amount in π (0 = unpaid work) and due date. The worker accepts or declines; the client can withdraw a pending offer. Accepting an offer made from an «offered» application marks it hired.
- **Escrow** per milestone through the shared ledger: the client funds a paid milestone (`escrow:contracts`), the worker delivers (note + links), the client approves (paid out to «أرباحك من العقود», optional platform fee `CONTRACT_FEE_PCT`) or asks for a revision within the agreed number. Unreviewed deliveries are approved automatically after 14 days.
- **Disputes**: either side freezes a funded milestone; staff decide at #/admin/contracts — release, refund or split — with a note both sides see (audited). The worker may end the contract at any time (held funds go back to the client); the client may cancel only while nothing is held.
- One **timeline** with messages; risky messages (fees, off-platform contact/payment, passphrase) warn the recipient. 8 notification kinds. Finance statements show contract earnings; escrow appears in the finance/revenue liabilities.
- **Minors**: no paid contracts on either side; unpaid contracts allowed.
- Entry points: Settings → الحساب «العقود», «العقود» on #/jobs. Migration `058_contracts` (additive, reversible).

### Disabled in production
- Funding milestones with Pi (the escrow) answers 501 `not_configured` with an Arabic notice while Pi payments are off; paid milestones show «متاح عند تفعيل Pi» and cannot be delivered until funded. Unpaid contracts (offer, delivery, revisions, approval, messages, cancel) are fully live.

### Routes
- API: GET|POST /api/contracts · GET /api/contracts/draft · GET /api/contracts/:id · POST /api/contracts/:id/{respond,withdraw,cancel,messages} · POST /api/contract-milestones/:id/{fund,submit,review,dispute} · GET /api/admin/contracts · POST /api/admin/contract-disputes/:id.

### Tests
- API `server/test/contracts.test.js` 4/4 on SQLite and PostgreSQL (escrow hold/release/refund/split journals with a 10 % fee, auto-release sweep, migration down/up); touched suites jobs, notify, compliance, pi, pricing (only the known 053/054 additivity check) green; unit 109/109. e2e `tests/e2e/p78.e2e.test.js` 2/2 (axe light + dark, 44 px, CSP hygiene); touched e2e p77 2/2, settings-v238 5/5, content 7/7. Screens reviewed at 390 light / 360 dark. Core JS Brotli 86,083 B / 92,160 B, core CSS 13,698 B; `work` chunk 19.5 KB JS + 1.8 KB CSS (Brotli).

## 2.43.0 — 2026-10-17 — Phase 77: jobs & freelance «الوظائف والعمل الحر»

### Added (#/jobs, #/jobs/new, #/job/:id, #/job/:id/edit, #/job/:id/applicants, #/application/:id, #/admin/jobs)
- **Post** a job (full / part time, temporary contract, internship) or a **freelance project**: title, description, category, required skills, remote / on-site / hybrid + city, pay in π (fixed, hourly, monthly — or unpaid), application deadline, up to 3 screening questions. Pause, re-open, close, «تم التوظيف», edit.
- **Browse**: Arabic search, filter sheet (category, place, city, skill, minimum pay, sort by newest / highest pay), job / freelance chips, save postings. Expired deadlines stop applications.
- **Apply with the professional profile** (phase 76): cover letter, answers, a bid (π + days) on paid freelance projects. The employer sees the applicant's professional profile inside that application only.
- **Employer pipeline**: new → viewed (automatic) → shortlist → interview → offer → hired, or a polite rejection with a message; a private note; one timeline with messages both sides see; applicants can withdraw. Notifications at every step.
- **Anti-scam**: postings asking applicants for fees/deposits, moving contact or payment off the platform, asking for a wallet passphrase, promising guaranteed income, with contact details or implausible pay — and first postings from new accounts — wait for staff review with the reasons shown. Risky messages carry a warning for the recipient. 3 reports pause a posting; staff approve / remove (reason to the poster, applicants warned) / dismiss at #/admin/jobs.
- **Minors**: browse only unpaid postings marked suitable for under-18s; cannot post or apply to paid work.
- Entry points: Settings → الحساب «الوظائف والعمل الحر», «الوظائف» buttons on #/cv and #/talent. Migration `057_jobs` (additive, reversible). Also fixed (phase 76, PostgreSQL): CV «last updated» date and talent-directory sort by update time.

### Disabled in production
- «تمييز الإعلان» (featured listing paid in π) answers 501 `not_configured` with an Arabic notice while Pi payments are off. Posting, applying and hiring are free and fully live.

### Routes
- API: GET|POST /api/jobs · GET /api/jobs/me · GET|PATCH /api/jobs/:id · POST /api/jobs/:id/{state,save,apply,report,boost} · GET /api/jobs/:id/applications · GET /api/job-applications/:id · POST /api/job-applications/:id/{status,messages,withdraw} · PUT /api/job-applications/:id/note · GET /api/admin/jobs · POST /api/admin/jobs/:id.

### Tests
- API `server/test/jobs.test.js` 4/4 on SQLite and PostgreSQL; touched suites proprofile, notify, compliance, pi green; unit 109/109. e2e `tests/e2e/p77.e2e.test.js` 2/2 (axe light + dark on every screen, 44 px, CSP hygiene); touched e2e settings-v238 5/5, content 7/7, p76 2/2, flicker 3/3. Screens reviewed at 390 light / 360 dark. Core JS Brotli 86,017 B / 92,160 B, core CSS 13,698 B / 14,336 B; `work` chunk 15.7 KB JS + 1.7 KB CSS.

## 2.42.0 — 2026-10-17 — Phase 76: professional profile & CV «الملف المهني والسيرة الذاتية» + core budget headroom

### Added (#/cv, #/cv/:handle, #/talent, #/admin/pro)
- **Professional profile**, separate from the social profile: headline, about, city/country, what you're open to (a job, freelance projects, hiring, mentoring, volunteering), languages with level, links. A completeness meter (8 checks) suggests the next step.
- **Entries**: experience, education, portfolio (a link and/or one of your own posts), volunteering, awards — month/year dates with «حتى الآن», edit, delete, accessible move up/down. **Skills** (up to 30) with level and years. Your public **verified certificates** (exams, courses, volunteer hours) and your **mentor** page are linked automatically.
- **Privacy**: whole profile for everyone / members / my followers / only me, plus a stricter setting per section; opt in or out of the talent directory; **preview** as a visitor, a member or a follower. Blocked members see nothing.
- **CV export**: printable Arabic RTL page `/cv/<handle>` (A4; «تنزيل PDF» opens the print dialog → «حفظ كملف PDF»), HTML download, **JSON Resume** export.
- **Talent directory** #/talent: Arabic-normalised search (headline, skills, name, about) with skill / city filters (filter sheet) and «منفتح على» chips.
- **Safety**: reports (fake credentials, impersonation, scam, inappropriate) — 3 open reports take a profile out of the directory; staff hide (reason sent to the owner) / restore / dismiss at #/admin/pro, audited.
- **Minors**: may build a CV, but never public or listed, and no paid work (open to mentoring / volunteering only).
- Entry points: «الملف المهني» link on the social profile (when the viewer may see it), Settings → الحساب «الملف المهني والسيرة الذاتية», Explore shortcut «العمل والفرص».
- Notifications `pro_hidden`, `pro_restored`. Data map: 4 tables (erased with the account). Migration `056_proprofile` (additive, reversible).

### Changed — core budget (step 0)
- Creator studio (#/studio) and live audio rooms (#/rooms, #/room/:id) moved out of the core bundle into the lazy `creation` chunk (`creation-ui.js`, with the existing `creation.css`); the post menu «الإحصائيات» loads it on demand. Screens unchanged. Core JS Brotli 91,940 → 85,808 B before this phase (≈ 6 KB headroom); after phase 76: 85,963 B / 92,160 B. Core CSS unchanged 13,698 B.

### Disabled in production
- Nothing: the professional profile needs no keys or payments.

### Routes
- UI: #/cv, #/cv/:handle, #/talent, #/admin/pro — lazy `work` chunk + `work.css`.
- API: GET|PUT|DELETE /api/pro/me · GET /api/pro/me/export · POST /api/pro/me/items · POST /api/pro/me/items/reorder · PATCH|DELETE /api/pro/me/items/:id · PUT /api/pro/me/skills · GET /api/pro/search · GET /api/pro/u/:handle · POST /api/pro/u/:handle/report · GET /api/admin/pro · POST /api/admin/pro/:handle · page GET /cv/:handle.

### Tests
- API `server/test/proprofile.test.js` 5/5 on SQLite and PostgreSQL; touched suites identity, notify, compliance green; unit 109/109. e2e `tests/e2e/p76.e2e.test.js` 2/2 (axe light + dark, 44 px, CSP hygiene, studio stats via the lazy chunk); touched e2e content 7/7, settings-v238 5/5, identity 5/5, flicker 3/3, subs 1/1, p61-66-71 4/4. Screens reviewed at 390 light / 360 dark.

## 2.41.0 — 2026-10-17 — Phase 75: open knowledge library «المكتبة المعرفية»

### Added (#/knowledge, #/kb/:id)
- **Open contributions**: any member writes an article (title, summary, Markdown body with live preview, category, tags, sources) under an open licence — **CC BY-SA 4.0** (recommended), **CC BY 4.0** or **CC0** — after confirming it is their own work or properly attributed. Anyone can propose an improvement to a published article (with an edit note); edits inherit the article's licence.
- **Review**: every version is a revision. Trusted reviewers (granted by staff) and staff approve or reject (with a note) from #/knowledge/review; a version written on an older revision can't be approved (no silent overwrite); reviewers' own edits are direct; reviewers can restore any earlier version (a new version — nothing is deleted).
- **History and diff**: #/kb/:id/history lists every approved version (author, note, size change); #/kb/rev/:id shows the version with a line-by-line diff and the full text. Contributors are credited on the article (attribution for the licence).
- **Discovery**: Arabic-normalised search (title, tags, summary, body), categories with counts, popular tags, sort by newest / most read / most helpful; table of contents, reading time, sources, related articles; «هل كانت مفيدة؟» votes; «مساهماتي» (#/knowledge/mine) with each contribution's review state.
- **Moderation**: reports (inaccurate, copyright, harmful, spam, other) → review queue; 3 open reports flag an article (banner, hidden from minors); staff hide / restore / archive / mark adults-only (#/admin/knowledge, audited) and manage reviewers.
- **Minors**: read non-sensitive, unflagged articles; may contribute, always reviewed, credited as «مساهم يافع»; never reviewers.
- Notifications: kb_decision, kb_edited, kb_reviewer. Data map: 5 tables (published content stays under its open licence after account deletion, pseudonymous). Migration `055_knowledge` (additive, reversible). Explore shortcut «المكتبة المعرفية».

### Disabled in production
- Nothing: the library needs no keys or payments.

### Routes
- UI: #/knowledge, #/knowledge/new, #/knowledge/review, #/knowledge/mine, #/kb/:id, #/kb/:id/edit, #/kb/:id/history, #/kb/rev/:id, #/admin/knowledge — lazy `knowledge` chunk + `knowledge.css`.
- API: GET|POST /api/knowledge · GET /api/knowledge/me · GET /api/knowledge/review · GET /api/knowledge/articles/:id[/history] · POST /api/knowledge/articles/:id/{edits,vote,report,revert} · GET /api/knowledge/revisions/:id · POST /api/knowledge/revisions/:id/{approve,reject,withdraw} · POST /api/knowledge/reports/:id · GET /api/admin/knowledge · POST /api/admin/knowledge/reviewers · POST /api/admin/knowledge/articles/:id.

### Tests
- API `server/test/openlib.test.js` 5/5 on SQLite and PostgreSQL; touched suites notify + compliance green on both; unit 109/109. e2e `tests/e2e/p75.e2e.test.js` 2/2 (axe light + dark on every screen, 44 px, no inline handlers / styles). Screens reviewed at 390 light / 360 dark.

## 2.40.0 — 2026-10-17 — Phase 70: volunteering, verified charities and transparent campaigns «التطوّع والخير»

### Added — organisations (#/organisation/:id, #/organisation/new)
- Adults register a charity / association / initiative / volunteer team with its **registry and licence number**; staff verify, reject (with reason) or suspend it (#/admin/charity), audited and notified. Only verified organisations publish anything. Owners add editors by handle. Changing the licence of a verified organisation sends it back to verification.

### Added — volunteering (#/giving?tab=volunteer, #/opportunity/:id)
- Opportunities (place or online, dates, slots, expected hours, skills, minor-friendly flag) with search and onsite/online filters. Sign up with a note, withdraw, re-apply. Organisations accept / decline, then confirm **attended hours** (or no-show) → a **signed volunteer certificate** (`/cert/<code>`, new kind «شهادة تطوّع»). «نشاطي» shows confirmed hours, sign-ups, certificates and donations.

### Added — transparent campaigns (#/giving, #/campaign/:id)
- Draft → staff review → live → ended (job at the end date); pause / resume / end by staff. Campaign pages show goal, raised, donors, **every transfer to the organisation with its Pi txid**, **spending reports with receipt links**, and what was transferred but not yet reported, plus news updates and the organisation's licence. Hub totals: raised, verified organisations, open opportunities, confirmed volunteer hours; category chips and search; ended campaigns stay public with their reports.
- Reports on campaigns / organisations → staff queue; 3 open reports flag a campaign «قيد المراجعة» and stop donations until staff decide.
- Ledger: new `CHARITY` journals (donation → `charity:<id>:raised`, staff disbursement → `platform:payouts` with the Pi txid; refunds reversed). Notifications: vol_signup, vol_decision, vol_hours, charity_update, charity_review, charity_org, charity_guardian. Data map: 6 tables. Migration `053_charity` (9 tables, additive, reversible). Explore shortcut «التطوّع والخير».

### Fixed
- Phase 65 support fund: Pi amounts above ~214.7 π (e.g. a 1,000 π round budget) overflowed PostgreSQL `INTEGER` → 500. Migration `054_fund_bigint` widens the five fund amount columns to `BIGINT` on PostgreSQL (no data change; no-op on SQLite). Phase 70 tables use `BIGINT` from the start.
- Data map: `fund_reports` declared an unknown purpose (`safety` → `moderation`); the compliance unit test is green again.

### Disabled in production (and why)
- Donating to campaigns and staff disbursements need Pi payments, which are off (`PI_ENABLED` unset): they answer **501 `not_configured`** and every screen says «مدفوعات Pi غير مفعّلة بعد». Organisations, verification, volunteering, hours and certificates, campaigns, transparency pages and reports all work.
- Minors: read only for campaigns and organisations; volunteer only on minor-friendly opportunities with an active guardian link (guardian notified).

### Routes
- UI: #/giving (campaigns · volunteer · organisations · mine), #/campaign/:id, #/organisation/:id, #/organisation/new, #/opportunity/:id, #/admin/charity (organisations · campaigns · reports) — lazy `charity` chunk + `charity.css`.
- API: GET /api/charity/campaigns · GET|PUT /api/charity/campaigns/:id · POST /api/charity/campaigns/:id/{updates,donate,report} · GET|POST /api/charity/orgs · GET|PUT /api/charity/orgs/:id · POST /api/charity/orgs/:id/{members,campaigns,opportunities,report} · GET /api/charity/opportunities · GET|PUT /api/charity/opportunities/:id · POST /api/charity/opportunities/:id/signup · POST /api/charity/signups/:id · GET /api/charity/me · GET /api/admin/charity · POST /api/admin/charity/orgs/:id · POST /api/admin/charity/campaigns/:id[/disburse] · POST /api/admin/charity/reports/:id.

### Tests
- API `server/test/charity.test.js` 8/8 on SQLite and PostgreSQL; touched suites vcreators 7/7, certs, notify, compliance green on both; unit 109/109. e2e `tests/e2e/p70.e2e.test.js` 3/3 (axe light + dark on every screen, 44 px, no inline handlers / styles). Screens reviewed at 390 light / 360 dark.

## 2.39.0 — 2026-10-17 — Phase 65: verified creators program + creator support fund «الصنّاع الموثّقون وصندوق الدعم»

### Added — verified creators program (#/creator-program)
- **Transparent eligibility checklist** computed on the server: 18+, account age ≥ 30 days, ≥ 50 followers, ≥ 10 posts in 90 days, two-step verification, photo + bio, no standing moderation decision in 90 days — each check says where the member stands and links to fix it (security / profile).
- **Application** with category (14), statement, up to 3 links and the **code of conduct** (original content, disclose paid partnerships, no misleading, respect privacy and protect minors, use grants honestly). One pending at a time; re-apply 30 days after a rejection.
- **Staff review** (#/admin/creator-program): the snapshot of the checks next to each application; approve → «صانع موثّق» for a year (badge set only when the member has no other verification), reject with a reason, revoke / restore — audited, notified.
- **Yearly renewal**: reminder 30 days before, lapse at the end (badge removed), renew in the last 60 days when the checks pass (job `vcreators.tick`).
- **Directory** of verified creators with category chips and search. Explore shortcut «الصنّاع الموثّقون».

### Added — creator support fund (#/fund)
- **Rounds** run by staff (budget, max grant, categories, window, criteria): draft → open (verified creators of those categories notified) → review → closed.
- **Applications** by verified creators: project, plan, amount, milestones; edit / withdraw while open. Staff shortlist / approve an award (≤ request, within the round budget) / reject with a reason; private score and note.
- **Transparency page**: pool balance, received, donations (+ donors), awarded, paid out, rounds, every approved grant with its payout state and txid, recent donations (anonymous by choice). Grant pages with plan, milestones and the creator's **progress updates**; members can **report** a grant (staff queue).
- **Ledger** (existing double-entry): new `FUND` journals — staff funding, donations (Pi purpose `fund`), reservation, payout recorded with the Pi txid (no A2U); donation refunds reversed.
- Notifications: vc_approved, vc_rejected, vc_revoked, vc_renew, fund_round, fund_decision, fund_paid. Data map: 6 new tables. Migration `052_vcreators` (7 tables, additive, reversible).

### Disabled in production (and why)
- Donating to the fund, staff pool funding and grant payouts need Pi payments, which are off (`PI_ENABLED` unset): they answer **501 `not_configured`** and every screen says «مدفوعات Pi غير مفعّلة بعد». Verification, rounds, applications and decisions work; approved grants show «بانتظار Pi» until payments are enabled.
- Minors can read the directory and the fund but cannot apply, be verified or donate.

### Routes
- UI: #/creator-program (program · directory), #/fund, #/fund/r/:id, #/fund/g/:id, #/admin/creator-program (applications · verified · rounds + round review · payouts & reports) — lazy `vcreators` chunk + `vcreators.css`.
- API: GET /api/creator-program · POST /api/creator-program/{apply,withdraw,renew} · GET /api/creator-program/directory · GET /api/creator-program/badge/:handle · GET /api/fund · POST /api/fund/donate · GET /api/fund/rounds/:id · POST /api/fund/rounds/:id/apply · PUT /api/fund/applications/:id · GET /api/fund/grants/:id · POST /api/fund/grants/:id/{updates,report} · GET /api/admin/creator-program · POST /api/admin/creator-program/applications/:id/{approve,reject} · POST /api/admin/creator-program/members/:uid/{revoke,restore} · POST|PUT|GET /api/admin/fund/rounds[/:id] · POST /api/admin/fund/rounds/:id/status · POST /api/admin/fund/applications/:id/{decide,payout} · POST /api/admin/fund/pool · POST /api/admin/fund/reports/:id.

### Tests
- API `server/test/vcreators.test.js` 7/7 on SQLite and PostgreSQL; touched suites tips 13/13, compliance 12/12, points 7/7, notify 9/9, pi 21/21. e2e `tests/e2e/p65.e2e.test.js` 3/3 (axe light + dark, 44 px, no inline handlers / styles). Screens reviewed at 390 light / 360 dark.

## 2.38.0 — 2026-10-17 — Settings rework «الإعدادات» (same identity: logo, colours, font and glass nav unchanged)

Shipped on its own, ahead of the phase 65 / 70 / 75 round, at the user's request (the Settings page felt crowded).

### Changed — Settings information architecture
- **Hub** (#/settings): settings search, your account row, **9 section rows** (8 for members; «الإدارة» only for staff) each with an icon and a one-line description, then sign-out and the version. The old page listed ~45 entries plus 6 control cards on one long scroll.
- **One page per section** (#/settings?s=<key>), with the section name as the title and a back link to the hub:
  - **الحساب** (acct): التوثيق · التحقق والثقة · المؤسسات والحسابات · استوديو المنشئ · نقاط المساهمة · لوحة الصدارة
  - **الخصوصية والأمان** (privacy): الأمان والأجهزة · الخصوصية · الحظر والكتم ووضع الحماية · بياناتي وخصوصيتي · القرارات على حسابي
  - **الإشعارات والوقت** (notif): الإشعارات والبريد · الرفاهية الرقمية
  - **المحتوى والخلاصة** (content): الخلاصة والملخصات · تفضيلات الترجمة · تفضيلات الإعلانات · cards «التحكم بالمحتوى» (interests, content languages/types, sensitive content) and «إدارة ما تراه» (muted topics/accounts, blocked)
  - **المظهر واللغة** (display): لغة الواجهة · المظهر والتخصيص · العرض وإمكانية الوصول · التطبيق · توفير البيانات (switch) · card «اللغة والسمة» (quick language + light/dark/auto)
  - **المدفوعات والمحفظة** (money): مشترياتي · منشوراتي المدفوعة · اشتراك مجتمع+ ذكاء · الإكراميات ودعم المبدع · حملاتي الإعلانية · the Pi Network card (link / unlink)
  - **الأسرة والحماية** (family): العمر والمحتوى الحساس · الإعدادات العائلية
  - **المساعدة والقانوني** (help): الأسئلة الشائعة · تذاكر الدعم · المساعدة العاجلة والدعم النفسي · ملاحظة عن النسخة التجريبية · الجولة التعريفية · النسخة التجريبية · سفراء المجتمع · سياسات المحتوى · الشروط والخصوصية · بوابة المطورين · وثائق المطورين · عن مجتمع بلس · card «متقدّم» (reset demo data)
  - **الإدارة** (admin, staff only): لوحة الإدارة · طابور السلامة · إدارة التجربة · إدارة النقاط
- **Search** across every section (Arabic-normalised: أ/ا، ة/ه، ى/ي, diacritics ignored): matching rows grouped under their section names, «لا نتائج مطابقة» when nothing matches.
- **Duplicates removed**: «إحصائيات المبدع» (same #/creator link as «إعدادات المبدع», now one row «الإكراميات ودعم المبدع»); the local demo card «سجل القرارات والبلاغات» is hidden when connected to the server (the same record is «القرارات على حسابي»); the two «مركز المساعدة» rows now say what they are («الأسئلة الشائعة» vs «المساعدة العاجلة والدعم النفسي»); module groups whose titles alone said «اشتراكي» / «اللغة» etc. now read in context.
- Every row is the shared grouped-list row (icon, title, short helper text, chevron or switch), ≥ 44 px; spacing unified; sections hide when empty.
- Lazy modules still add their own entries whenever they load; each is filed into its section with its id, link and listeners kept, in one fixed order (the v2.36 row-order fix, now per section). The modules' «is this Settings?» checks accept the section pages (a11y, ads, ai/dev, beta, i18n, launch, prefs, wellbeing).
- EN catalogue: section names, helpers and the new row titles.

### Nothing removed
- Every entry of the v2.37 Settings page is reachable from exactly one section (checked by the new e2e) and from search; routes of the sub-screens are unchanged.

### Tests
- New `tests/e2e/settings-v238.e2e.test.js` (5): hub, every old entry in exactly one section, fixed order, section pages + back, controls (data saver, theme), search + no results, axe light (390) and dark (360) on the hub and all 9 sections, 44 px targets, no overflow, no inline handlers.
- Updated to the new section routes and re-run: a11y-settings 4/4, prefs 6/6, ads 11/11, compliance 4/4, launch 3/3, beta-points 3/3, integrity 1/1, finance-design 3/3, paid 11/11, pi 16/16, quality 2/2 (settings visual baselines re-recorded: mobile, desktop, LTR), flicker 3/3; unit 109/109.
- Core Brotli JS 91,685 B / 92,160 · CSS 13,698 B / 14,336; design lint not worse than baseline.

## 2.37.0 — 2026-10-17 — Phase 74: mentorship «الإرشاد» (phases 64 and 69 removed from the plan)

### Plan change
- Phase 64 (professional live streaming with Pi during the stream) and phase 69 (prayer times, Qibla, prayer mode) were **removed from roadmap 2 at the user's request** (2026-10-17). No code, migration, route, test or doc was written for either; ROADMAP-2.md marks both as removed. This round ships phase 74 only.

### Added — Phase 74: mentorship (expert ↔ learner)
- **Mentor profiles** (adults only): headline, bio, up to 5 topics from a fixed list, languages, session length (30/45/60/90 min), free or a Pi price, time zone, open/paused, «accept learners under 18». Weekly availability grid in the mentor's own time zone (#/mentoring?tab=availability).
- **Discovery and matching**: #/mentors directory with topic chips (with counts), search, free/paid filter sheet; «اقترح لي مرشداً» ranks the best three for a topic + goal and says why (topic, rating, sessions, free this week, goal match, free sessions) with the next free slot.
- **Requests**: direct to a mentor (from their page) or open to every mentor of a topic; accept with a reply / decline / withdraw; max 5 open per learner; an accepted request links straight to booking.
- **Booking**: free slots are computed on the server from the weekly grid (14 days ahead, 12 h notice, the mentor's AND learner's existing sessions excluded; DST-safe wall-time ↔ UTC), so a booking can only land on a real free slot. Day + time picker shown in the viewer's own time zone (with a note when the mentor is elsewhere). pending → mentor confirms → confirmed → completed / no-show; either side cancels with a reason; unconfirmed sessions expire at their start time; reminder one hour before (leased job `mentors.tick`, every 5 min).
- **Calendar**: one .ics per session and a private, rotatable, revocable feed `/mentor-feed/<token>.ics` (no notes in it).
- **Live session**: the mentor opens a private live room (phase 14 rooms) from 10 min before the start; only the mentor, the learner and — for a minor — the linked guardian may join; mentorship rooms are never listed in #/rooms.
- **Notes and ratings**: one private note per side per session, optionally shared (the mentor's summary shows to the learner); after completion the learner rates 1–5 + comment (public, aggregated with a distribution on the mentor page), the mentor leaves private feedback.
- **Optional Pi-paid sessions** (escrow on the existing ledger): paid at booking into `platform:held`, released to the mentor minus the platform fee when the mentor marks completed / no-show; a cancelled held payment is reversed and marked refund-due for staff. New Pi payment purpose `mentor`.
- **Minors** (phase 35 rules): no mentor profile under 18; a minor sees and books only mentors who opted in, only free sessions, and only with an active guardian link; every request/booking/change notifies the guardian, who sees the sessions (not the notes) in #/mentors?tab=family and may join the session room; minors appear as «متعلّم» in public reviews.
- **Staff** #/admin/mentors: totals, refund-due paid sessions, low-rated mentors (≥3 reviews, < 3.0), suspend (cancels upcoming sessions, learners and guardians told) / restore — audited.
- Notifications: mentor_request, mentor_reply, mentor_booked, mentor_session, mentor_reminder, mentor_feedback, mentor_guardian. Explore shortcut «الإرشاد».
- Data: migration `051_mentors` (7 new tables, additive only, reversible); all seven in the personal-data map (export / erase rules).

### Disabled in production (and why)
- Pi-priced sessions: Pi payments are off in production (`PI_ENABLED` not set). Priced mentors show «الجلسات المدفوعة متوقفة حتى تفعيل مدفوعات Pi» and booking them returns 501 `not_configured`; free mentoring works fully. Live session audio uses the built-in WebRTC mesh (no LiveKit keys), which is enough for a 1:1 session.

### Routes
- UI: #/mentors (find · sessions · requests · family), #/mentor/:handle, #/msession/:id, #/mentoring (sessions · requests · availability · profile), #/admin/mentors — lazy `mentor` chunk + `mentor.css` (0 bytes of new code in core JS except the explore shortcut and the chunk route map).
- API: GET /api/mentors, /api/mentors/match, /api/mentors/:handle, /api/mentors/:handle/slots · POST /api/mentors/:handle/book · GET|PUT|DELETE /api/mentor/me · PUT /api/mentor/me/slots · GET|POST /api/mentor/requests · POST /api/mentor/requests/:id/{accept,decline,withdraw} · GET /api/mentor/sessions · GET|POST|DELETE /api/mentor/feed · GET /api/mentor-sessions/:id (+ /ics) · POST /api/mentor-sessions/:id/{confirm,decline,cancel,complete,no-show,join,pay,feedback} · PUT /api/mentor-sessions/:id/note · GET /api/admin/mentors · POST /api/admin/mentors/:uid/status · GET /mentor-feed/<token>.ics.

### Tests
- API `server/test/mentors.test.js` (9 tests, SQLite + PostgreSQL); e2e `tests/e2e/p74.e2e.test.js` (5 tests, axe light + dark, tap targets ≥ 44 px, no inline handlers / styles). Design review tool `tools/design-shots-v237.mjs`.

## 2.36.0 — 2026-10-17 — Design refinement D5: final QA and polish (same identity: logo, colours, font and glass nav unchanged)

### Changed — D5
- Desktop (≥1180 px): the three-column shell (nav · feed · live rail) is now centred in the window instead of hugging one side; the rail narrows on smaller desktops instead of being clipped; the comment/chat bar sits on the feed column instead of the middle of the screen; the brand name and the account switcher no longer wrap onto two lines (long names end with an ellipsis).
- Inline styles: `style="…"` in JS templates down from 1,397 to 353 (−75%), replaced by a small set of `u-*` utility classes in core CSS (spacing, type scale tokens, flex helpers, colour roles; `!important` so they keep the precedence the inline styles had). Font sizes in templates now snap to the type scale. Remaining inline styles are dynamic values (user colours, progress widths, cover images).
- Detail screens: exam page teacher actions as outline buttons under a section head (one primary per screen); course lesson quiz questions keep their title inside the card; developer app page scopes as proper checkbox rows in a grouped box, app status as a pill («نشط»); digital product seller form shows the Pi-off notice once (styled like the store page); creator settings «منشوراتي المدفوعة» row and paid-post lock/supporter badges use line icons instead of emoji (no tofu boxes); developer app cards (API keys, Webhooks, bot) use line icons; «＋» dropped from «اختبار جديد» / «دورة جديدة» titles; emoji stripped from toasts (tip, support).
- Theme: when the display mode is «تلقائي» (system), `data-theme` now resolves to the effective scheme and follows OS changes, so module dark styles written as `[data-theme=dark]` also apply on a dark OS (market prices, tip sheet errors and order pages were low-contrast there).
- `gallery.html`: new «v2.36 · مكونات الوحدات» section — section heading, segments (tablist and pressed), chip rail with icons, KPI tiles, search + filter button with count and the filter sheet body, event row, status pills and the `u-*` utilities (feature icons loaded from the feat sprite).

### Accessibility (axe-core, WCAG 2 A/AA + best practices)
- Main routes (home, explore, profile, post, settings, market, communities, wallet, notifications) at 390 light, 360 dark, 390 English/LTR, 1440 light, 1440 dark and 1440 LTR: 100 violation nodes → 0.
- Every page has a level-one heading (visually hidden in the top bar, kept in sync with the page title on navigation); heading levels no longer skip (rail cards, comments, «فاتك اليوم», trend hero, suggested communities); stories bar and trend list no longer put list roles on buttons/links; `--danger` darkened slightly (#e0394a → #d42f3f) so red text such as «تسجيل الخروج» reaches 4.5:1.

### Fixed
- «Cannot set properties of null (setting 'textContent')» on #/home: `toast()` assumed the `#toast` element always exists (the screenshot script removed it); it now recreates it.
- Digital product form could render its notice twice when a second render started before the first finished (race guard on the view).
- Search: at narrow widths the typeahead box could reopen over the result tabs after a search ran (a suggestion request still in flight when Enter was pressed); closing the box now cancels pending suggestion requests.
- Settings: the account rows added by lazy modules (my data, verification & trust, age, family, safety queue) could appear in a different order on each visit depending on which chunk loaded first; the «الحساب والأمان» group now has one fixed order.
- Urgent report button («بلاغ عاجل») could be missing from the report sheet when the protection chunk (3-step report) loaded after the minors chunk; the 3-step sheet now announces itself (`mp:report-open`) and the button is added either way.
- English: settings group titles and account-row titles/descriptions translated (they showed in Arabic in the LTR layout).

### Tooling
- `tools/design-lint.mjs` now fails (exit 1) when any metric is worse than the baseline, re-recorded at v2.36.0 (inline styles 353, emoji in JS 305, raw hex in core 79…); `--warn` prints only. It runs as part of `npm run budget` (CI build + budget step).
- Visual baselines added: `settings-desktop` (1440 px, rail hidden) and `settings-ltr-mobile` (English, LTR); `auth-desktop` re-recorded for the centred desktop shell (it also predated the «الدخول بحساب Pi» button).
- Core budgets: JS 89,669 B / 92,160 B Brotli, CSS 13,615 B / 14,336 B.

## 2.35.0 — 2026-10-17 — Design refinement D4 part B: money, creator and library modules (same identity: logo, colours, font and glass nav unchanged)

### Changed — D4 part B
- The lazy `feat` chunk now also loads before tips/earnings, transfers, ads, developers, digital store, subscriptions, wellbeing and communities (events); library/lists use core parts only (the discovery chunk stays independent of it). 5 more line icons in its sprite (coin, send, trash, code, ticket). Core JS not grown (89,607 B Brotli), core CSS unchanged (12,951 B).
- Shared page head (back link, icon, subtitle, one primary action, others outline) on earnings, creator settings, «من أدعمهم», creator support page, transfers (all screens), ads (campaigns, wizard, dashboard, preferences, review), developer portal (+ docs, app, admin), digital store and sales, points, subscriptions, library and events.
- Emoji used as icons replaced by sprite line icons (tip coin on posts, ad menus and “why this ad” reasons, digital product types, subscription benefits, event facts and ticket, wellbeing dialogs, developer portal) — no more tofu boxes; decorative emoji dropped.
- Tabs and period toggles as segments (earnings, support wall, transfers, subscribers, studio), status chips as `sbadge` pills (transfers, ads, subscriptions), KPI rows as `kpi-tile`s (earnings, ads dashboard, subscribers, creator support), balance/points/subscription heroes on `--hero-grad`, illustrated empty states (campaigns, transfers, digital store, lists, read-later, collections, events, Pi-off pages).
- Transfers: gradient balance card, «إرسال Pi» primary with «طلب Pi» / «الطلبات» outline. Ads: «حملة جديدة» primary, dashboard actions with icons (pause/resume/delete). Digital store: search pill + type chips with icons, product cards on the shared grid. Points: hero with level badge and white progress bar, earning rules as a list card with +points pills, leaderboard opt-out as a switch row, «لوحة الصدارة» in the head. Developers: «الوثائق التفاعلية» primary, OpenAPI/admin outline. Wellbeing: big today figure, ±% pill for the weekly change, outline clear button.
- New `#/events` screen in the communities chunk: date tiles, place and attendees line, community name; the core list stays as the offline fallback (emoji removed there).
- Nearby: the location card is now one short line with a pin tile, «استخدم موقعي» beside a city picker and a «احفظ منطقتي» switch row (ids kept).
- Hijri season cards get a subtle per-season tint over the hero gradient (Eid al-Fitr green, Hajj amber, Eid al-Adha blue, Ramadan plain), inline styles removed.
- Studio tabs moved onto the core segment (`.seg`), no extra core CSS.
- Injected module CSS for tips/transfers/ads/digital/subs down 8–32% (duplicated tabs, chips, KPI and heading rules removed).

### Fixed
- Points screens were unstyled: their `<style id="pt-css">` collided with protection-ui's id, so the module CSS was never injected (renamed to `pts-css`).
- Nearby «استخدم موقعي» could stay enabled when the click landed on its icon (`currentTarget` now).

## 2.34.0 — 2026-10-17 — Design refinement D4 part A: feature modules (same identity: logo, colours, font and glass nav unchanged)

### Changed — D4 part A
- New lazy `feat` chunk (`feat-ui.js` + `feat.css`, fetched before any feature chunk by `chunks.js`): 24 extra line icons appended to the sprite (book, cap, doc, calendar, clock, store, sliders…), a shared filter sheet (`MPFeat.filters`) and the shared module styles (chip rails, tab segments, stacked form labels, cover/hero, card grid, status pills, section heads). Core CSS unchanged; core JS +189 B Brotli.
- Emoji used as icons replaced by sprite line icons (or dropped where decorative) across market, nearby, biz, studio, analytics, series/drafts/scheduled, study groups, courses, exams/certificates, collabs, Hijri and leaderboard (≈180 icons, ≈190 emoji removed); no more tofu boxes on devices without emoji fonts.
- Shared page head (back link, focusable title with accent icon, subtitle) on every screen of these modules; one primary action per head, secondary actions as outline buttons.
- Filters: nearby, study groups, courses, biz directory and collabs now show one search field plus a «تصفية» button with an active-filter count that opens a bottom sheet (controls moved, not cloned, so ids and form ownership are kept).
- Tabs as on-brand segments, category/period filters as chips, status chips as `sbadge` pills, empty states use the shared illustration (no more dashed cards with big emoji), covers and heroes use `--hero-grad` (courses, series, biz, analytics, Hijri seasons).
- Market: head with «طلباتي» / «أضف إعلاناً», digital-products row as a list item, cleaner filter card. Nearby: «أماكنك» list (saved, mine, cities). Leaderboard: list card with rank badges (top three highlighted) and an illustrated empty state. Studio: page head with icon shortcuts.
- Hijri: one digit system per screen (Western digits via `UI.num`, server labels normalised).
- Module CSS (injected per chunk) down 15% overall: 111.3 KB → 94.9 KB raw (market −20%, collabs −20%, biz −19%, series −17%, courses −17%, analytics −15%, certs −13%, Hijri −12%, nearby −10%, study −10%).

### Fixed
- Analytics post chart: duplicate `unit` key (lint error).

## 2.33.0 — 2026-10-17 — Design refinement D3 + polish (same identity: logo and colours unchanged)

### Changed — D3
- Settings rebuilt as grouped lists (`UI.li()` rows with sprite icons, section heads; account card → «الحساب» group with creator stats and sign-out row).
- Shared page head (`UI.pageHead({ id })`, focusable title, leading/trailing emoji dropped via `UI.noEmo`) on account, security, privacy, notifications, language, a11y, family/age, compliance, tips, launch (help, tickets, ambassadors, about) and digital/paid screens.
- «مشترياتي» purchases hub (paid content + digital products, illustrated empty states); about page uses list rows and the brand mark instead of emoji.
- Display & accessibility settings use the shared switch rows and flatter fieldsets; new sprite icons (help, wallet, download, palette, access).
- D2 leftovers and bolder polish across communities, composer, discovery, points, prefs, protection, subs, transfers, wellbeing.

### Fixed
- Guided tour could be inserted twice (onboarding and home-render triggers raced across an await), leaving a stacked overlay that swallowed taps.
- Display settings showed «تم الحفظ» while later changes were still pending; only the newest save now reports saved.
- Digital store: race guard in `storeView` (a re-render mid-await no longer writes into a stale view).
- Typecheck: `HIJRI_OCCASIONS` typed as a tuple (pre-existing TS2345 in `server/lib/hijri.js` since 2.32.0).

### Tests
- Visual baselines regenerated for `settings-mobile` and `security-mobile` (intended redesign); `auth-desktop` unchanged (0.54% diff, within threshold).

## 2.32.0 — 2026-10-17 — Design refinement D0–D2 (same identity: logo and colours unchanged)

### Changed — D0 (make room, no visual change)
- `styles.css` merged into `theme.css` (stale v0.1 palette and dark block dropped).
- Lazy CSS chunks in `tools/build.mjs` (`<link data-chunk>` → hashed `assets/chunk-*.css`, loaded by `chunks.js` with their JS chunk): `communities`, `creation`, `composer` moved out of core.
- Warn-only design lint (`tools/design-lint.mjs` + baseline) in CI: raw hex, inline styles, off-scale font sizes and radii, emoji in UI strings.

### Changed — D1 (tokens and shared components)
- Semantic tokens, type scale, spacing, radii and control sizes in `:root` (light and dark).
- Shared components: btn, page-head, seg, chip, card (hero, kpi), list rows, fields/switch/radio rows, sheet head/footer, empty, skeleton, notice, badge, avatar sizes; `UI.pageHead()`, `UI.empty()`, `UI.num()` helpers; new sprite icons (globe, bag, feedback); `gallery.html` updated as the living reference.
- One floating button only (compose): beta feedback moved from a second FAB to a row in Settings and on your profile; 🌐 replaced by the globe icon.

### Changed — D2 (shell and top-traffic screens)
- On-brand tabs/segments on home, explore, trends, notifications (incl. dark active tab), messages, communities and comments; bidi-safe handles and hashtags; fixes on profile, topic hero, nearby, a11y settings and composer.
- Visual baseline `tests/visual/baseline/settings-mobile.png` updated for the new Settings layout (feedback row, page head). Core budgets: CSS 12,651 B / 14,336 B Brotli, JS 87,679 B / 92,160 B.

## 2.31.0 — 2026-10-17 — Phase 63 «تعاونات ورعايات» + Phase 68 «تقويم هجري ومواسم» + Phase 73 «اختبارات وشهادات قابلة للتحقق» (roadmap 2, tracks 13–15)

### Added — Phase 63 (creator ↔ brand collaborations and sponsorships)
- Migration 048_collabs (additive). Creator media kit (`/api/collabs/kit`, `/api/collabs/kits/:handle`, creator directory), brand profiles, campaigns with slots and applications, direct offers, a deal room (`/api/collab-deals/:id` counter/accept/decline/cancel/paid/messages/deliver/review/report).
- Paid-partnership disclosure on posts (`PUT /api/posts/:id/partnership`) shown as a label on feed cards and the post page; undisclosed-ad reports and a staff queue (`/api/admin/collabs…`); public library of disclosed partnerships (`/api/collabs/library`). Payment between parties is recorded only (no new Pi payment path).
- `#/collabs…` hub, campaign, deal room, kit, disclosure, report, library, about, `#/admin/collabs` (lazy `collabs` chunk).

### Added — Phase 68 (Hijri calendar and seasons)
- Migration 049_hijri (additive). Umm al-Qura via the built-in ICU calendar (tabular fallback on small-ICU builds), admin moon-sighting month-start overrides (±2 days, validated, audited).
- `/api/hijri/{today,month,convert,config,seasons,seasons/:key}`, season reminders (`PUT /api/hijri/reminders/:key`), occasions + national days, `/hijri.ics` feed.
- `#/hijri` (Hijri/Gregorian grids, converter), `#/season/:key` hubs, `#/admin/hijri` (lazy `hijri` chunk).

### Added — Phase 73 (exams and verifiable certificates)
- Migration 050_certs (additive). Timed exams for study groups/courses (`/api/exams…`, `/api/exam-attempts/:id…`): builder, duplicate, start, autosaved answers, submit, results.
- Certificates for passed exams, completed courses and study-group completions, signed with Ed25519 (key generated and sealed in the DB on first use); public verification `/api/certificates/verify/:code`, `/api/certificates/keys`, revoke/restore, per-user and per-community lists.
- `#/exams`, `#/exam/:id`, `#/attempt/:id`, `#/certificates`, `#/cert/:code`, `#/verify-cert` (lazy `certs` chunk).

### Changed — design pass
- 360 px dark screenshots reviewed (`tools/design-shots-v231.mjs`): collab fieldsets and link chips, plural fixes, contrast of Hijri secondary day numbers and own chat timestamps; new `tests/e2e/p63-68-73.e2e.test.js` with axe checks.

## 2.30.0 — 2026-10-17 — Phase 62 «جدولة النشر وسلاسل المحتوى» + Phase 67 «دليل أعمال محلية تقبل Pi» + Phase 72 «دورات ودروس مع تتبع تقدّم» (roadmap 2, tracks 13–15)

### Added — Phase 62 (scheduled publishing and content series)
- Migration 045_series (additive). Schedule queue `GET/POST /api/schedule`, `…/:id`, `…/:id/now` (idempotent publisher, time zones, cancel → back to draft, failure reporting); drafts synced across devices `/api/drafts`.
- Content series `/api/cseries` (create/edit, ordered episodes, reorder, candidates, follow, new-episode notifications, per-series stats, `for-post/:id` prev/next navigation).
- `#/scheduled`, `#/drafts`, `#/series`, `#/series/new`, `#/series/:id` (lazy `series` chunk).

### Added — Phase 67 (local businesses that accept Pi)
- Migration 046_business (additive). A business is a phase 66 place plus a businesses row: `GET/POST /api/biz`, `/api/biz/:id`, `/api/biz/config`, `/api/biz/mine`, ownership claims (`/api/biz/:id/claim`) with a staff queue and revoke (`/api/admin/biz/…`). Home-based businesses show only an approximate area (no street address, never on the map); accepts-Pi is the owner's declaration.
- Search by text, category, city, distance, accepts Pi, verified, open now. `#/biz`, `#/biz/new`, `#/biz/mine`, `#/biz/:id` (lazy `biz` chunk).

### Added — Phase 72 (courses and lessons with progress tracking)
- Migration 047_courses (additive). Courses belong to phase 71 study groups: modules → lessons (light-Markdown text, video link, or single-choice quiz with pass mark), reorder/move, draft ↔ published, enrolment, completion and quiz attempts, learner progress for teachers. `/api/courses…`, `/api/course-modules/:id`, `/api/course-lessons/:id{,/complete,/quiz}`. Paid access only via an existing phase 58 digital product (no new Pi payment path).
- `#/courses`, `#/course/:id` and lesson/quiz/learners views (lazy `courses` chunk).

### Changed — design pass
- 360 px dark screenshots reviewed (`tools/design-shots-v230.mjs`): drafts layout, danger-button contrast, empty states, episode titles; new `tests/e2e/p62-67-72.e2e.test.js` with axe checks.

## 2.29.0 — 2026-10-17 — Phase 61 «تحليلات متقدمة» + Phase 66 «أحداث وأماكن قريبة على الخريطة» + Phase 71 «مجموعات دراسة وحلقات» (roadmap 2, tracks 13–15) + fix for the screen flicker on tap

### Fixed — global flicker on tap
- Tapping an action (like, join, RSVP…) re-rendered the route through the skeleton, so the whole screen flashed. Re-renders of the same route are now "soft": the current screen stays until the new content is ready; community join updates in place. New dev tool `tools/flash-audit.mjs`; `tests/e2e/flicker.e2e.test.js` (3/3). The beta feedback button no longer covers the like button on phones.

### Added — Phase 61 (advanced creator analytics)
- Migration 042_creator_analytics (additive). `GET /api/creator/analytics/{overview,audience,content,earnings,compare,insights,goals,post/:id,export.csv}`, `PUT/DELETE …/goals`; attention beacon (time on page, read progress, media time).
- `#/analytics` (lazy `canalytics` chunk): overview with insights, weekly goals (progress ring), interactive line charts with tap readout; audience; content with per-post drilldown (sources, first 24 h); earnings; period compare; CSV.

### Added — Phase 66 (nearby events and places on a map)
- Migration 043_nearby (additive). `GET /api/nearby` (city or 5-char geohash area — precise device location never stored), `/api/nearby/config`, `/api/nearby/location`, places CRUD + moderation, reviews with stars, photos, weekly hours (open-now), saved places, reports, `GET /api/cities`, `/api/cities/:name`.
- `#/nearby` (OSM tiles loaded only when the map is shown, attribution, pins, list ↔ map selection, RSVP from the list), `#/place/:id`, `#/places/new`, `#/places/saved`, `#/cities`, `#/city/:name`, `#/admin/places`.

### Added — Phase 71 (study groups and Quran halaqas)
- Migration 044_study (additive). Groups / halaqas on communities, schedules and sessions (in person or online), attendance + CSV, notes, goals, memorisation progress (surahs), assignments with submissions and teacher review, teacher dashboard, completion records + completion card.
- `#/study`, `#/study/new`, `#/study/:id/{sessions,assignments,dashboard,attendance,notes,goals,progress,settings}`, session and assignment pages.

### Changed — design pass (all three phases)
- Analytics, nearby/place/city and study/halaqa/teacher screens now use only theme tokens (`--card`, `--bg-2`, `--line`, `--text-2`, `--muted`, `--accent`, `--accent2`, `--accent-ink`, `--ok/--warn/--danger/--info` via `color-mix`), so dark mode is correct everywhere (map surface, controls and attribution included).
- Shared hierarchy with analytics: 22 px page titles, 16 px section titles, card lists instead of loose rows, KPI tiles in a 2/3-column grid, segmented pill tabs, pill chips for status/attendance, polished empty states (dashed card) and skeleton loading.
- Teacher dashboard: the students table (cut off on phones) is now a card list with inline stats and the completion action; attendance chart in a card; attendance buttons in a 4-column grid on phones. Place page: opening-hours header no longer wraps; pressed RSVP meets WCAG AA contrast.
- 44 px targets on chips, tabs, back links, map controls and form fields; RTL-safe (logical properties, `bdi` for numbers/dates).

### Tests
- API: canalytics + nearby + study 31/31. Unit 109/109. e2e: p61-66-71 4/4, p61-66-71-plus 3/3 (axe clean on every new screen), flicker 3/3. Known pre-existing failure in `pwa.test.js` (also on v2.28.0) unchanged.

## 2.28.0 — 2026-10-17 — Phase 55 «ملاحظات الإطلاق ومراجعة التصميم» + Phase 60 «الشفافية المالية» (roadmap 2 — tracks 11 and 12 complete)

### Changed — Phase 55 (launch feedback + deferred design review)
- Tap targets ≥ 44 px on core screens: top icon buttons (42→44), post «more» button (36→44), `.btn`, `.tab`, segmented buttons (min-height 44).
- RTL consistency: chip spacing uses `margin-inline-end`; character counter `text-align:end`; video duration badge `inset-inline-end`; automod dialog follows the page direction (no forced `direction:rtl`); forward chevrons on cards across lazy screens were the bidi-mirrored «‹» (shown as «›», pointing backwards in Arabic) — now «←» with class `fwd`, flipped for LTR languages.
- Empty states: readable line length (46ch, balanced wrap, line-height 1.7). Loading: route skeleton announces `aria-busy`; global `prefers-reduced-motion` rule stops skeleton shimmer and transitions.
- Core budget kept: JS 85,351 / 92,160 B br (+94 B), CSS 13,962 / 14,336 B br. Dead-code scan of the core (unused functions / CSS classes) found nothing safely removable — the remaining old views are the offline/demo fallbacks — so nothing was deleted; the additions are small enough not to need it.
- Fixed the two known pre-existing e2e failures: market «real P39 server» (a late chunk re-render could wipe the listing form the seller was typing — `formView` now keeps a dirty form on same-route re-renders; the test also waits for the real POST and starts with a fresh write rate limit) and the settings visual diff (baseline was stale from phases 41–54; refreshed after the intended design changes; the staff-only floating «ملاحظة» button is masked in snapshots).
- Production feedback triage board (phase 54) not read: no admin session/token is available without creating one, so nothing was processed from it.

### Added — Phase 60 (financial transparency, built from lib/ledger.js)
- Migration 041_finance (additive): `finance_invoices`, `finance_counters`.
- `server/services/finance.js`:
  - Statement `GET /api/finance/statement` (from/to/category filters, totals, pagination) + `GET /api/finance/statement.csv` — every Pi line on the member's accounts: wallet payments (tips, subscriptions, paid posts, market, digital products, ads, AI plan, transfers), balances owed to them (creator/seller earnings, received transfers, points rewards), refunds, reversals, payouts.
  - Documents with sequential gap-free numbers per series and year, issued in journal order (row-locked counter): INV (payment), CN (credit note, linked to the original invoice), RC (payout receipt). `GET /api/finance/invoices`, `/api/finance/invoices/:id`, `/api/finance/invoices/:id/html` (printable Arabic RTL, print → PDF, `?download=1`). Issued lazily on read + every 10 min (`FINANCE_ISSUE_INTERVAL_MS`).
  - Annual summary `GET /api/finance/annual?year=` (member spend by category, refunds; creator earnings by category, platform fees, reversals, payouts, monthly, distinct supporters); admin `GET /api/admin/finance/annual?user=`.
  - Public report `GET /api/finance/transparency?year=` + server-rendered `/transparency/finance`: volume, platform fees, payouts, refunds, reserves (held, escrow, ad budgets, owed to members, rewards pool); k-anonymous (`FINANCE_K_ANON`, default 5 distinct members per month / category / reserve).
  - Admin reconciliation `GET /api/admin/finance/reconcile?from&to`: Pi payments vs ledger (missing journal, amount mismatch, refunded-not-reversed, orphan journal, journal for unfinished payment) + ledger integrity check; `POST /api/admin/finance/issue`.
  - Works with Pi off: empty data + explanatory note (no 501).
- Lazy `finance` chunk (`finance-ui.js`, 5.1 KB br): `#/statement`, `#/invoice/:id`, `#/annual`, `#/finance-report`, `#/admin/finance`; links from the wallet, the admin hub and the transparency page.
- Data map: `finance_invoices` in the personal-data export (kept for financial records).
- Tests: `server/test/finance.test.js` (8, PostgreSQL), `tests/e2e/finance-design.e2e.test.js` (3, incl. axe on the new screens and 44 px tap targets).

## 2.27.0 — 2026-10-16 — Phase 54 «إطلاق تجريبي بالدعوات» + Phase 59 «مكافآت المساهمة ونقاط Pi» (roadmap 2, tracks 11 + 12)

### Added — Phase 54 (invite-based beta on top of the phase 50 waitlist / invites / LAUNCH_MODE)
- `services/beta.js` + migration `039_beta` (additive: `beta_cohorts`, `beta_members`, `beta_activity`, `beta_feedback`,
  `beta_feedback_msgs`, `beta_surveys`, `beta_survey_state`, `beta_flag_rules`). Beta invites ARE phase 50 `launch_invites`
  (note `beta:<cohort>`), redeemed by the existing sign-up hooks; `launch.mkInvite` exported for this.
- Waves: «الموجة الأولى» (100) and «الموجة الثانية» (1000) seeded as planned; admins open them in order (optionally inviting
  the oldest waitlist entries up to the wave's room), close them, edit capacity / quota, add existing accounts.
- Per-member invite quota (single-use codes while the wave is open and has room); 🧪 beta tester badge on profiles (can be hidden).
- In-app feedback (bug / idea / other) with optional screenshot + coarse device info → staff triage board (status, priority,
  assignee, reply) → `beta_feedback_reply` notification. NPS (0–10) + satisfaction (1–5) micro-surveys (≤ every 14 days).
- Cohort dashboard: members, activation (first real action ≤ 7 days), D1 / D7 retention, client errors (phase 1 intake,
  testers only), web vitals, NPS / CSAT, top open feedback.
- Kill switch per feature flag + cohort early access (`beta_flag_rules`, applied to `GET /api/flags` and `ops.flagsFor`).
- UI lazy chunk `beta` (~6.8 KB br, loaded by the ai chunk): floating «ملاحظة» button for testers + staff, survey sheet,
  `#/beta`, `#/beta/f/:id`, `#/admin/beta/{waves,board,dash,flags}`; settings card.
- Production stays `LAUNCH_MODE=open`; invite-only sign-up is the user's decision (Railway variable `LAUNCH_MODE=invite`).

### Added — Phase 59 (contribution rewards + points linked to Pi)
- `services/points.js` + migration `040_points` (additive: `points_awards`, `points_balances`, `points_settings`,
  `points_campaigns`, `points_redemptions`). Periodic idempotent scan (15 min, leased) awards: accepted answers, posts with
  meaningful engagement (≥ 3 distinct aged, unflagged, unlinked people), actioned reports, substantial wiki edits (one per
  page per day), mentoring (accepted answer to a newcomer; referred member still active after 7 days).
- Anti-gaming: per-kind + total daily caps, cooldown, min trust score (phase 32 trust signals) + account age, integrity flags,
  linked accounts (same device), weekly pair cap; removed content reverses its points. Minors earn non-redeemable points and
  are hidden from the leaderboard. Admin adjustments are never redeemable.
- 8 levels, leaderboard (all time / month / campaign) with opt-out, points history, seasonal campaigns (multiplier / bonus).
- Optional redemption into Pi from a platform-funded pool in `lib/ledger.js` (`REWARDS.fund / reserve / payout`,
  `platform:rewards_pool` → `user:<id>:rewards` → `platform:payouts`): admin rate, monthly cap, min points, per-user limit;
  staff pay from the app wallet + record the txid, or reject (reversal, points restored). Off until Pi payments are enabled,
  redemption is switched on with a rate + cap, and the pool is funded.
- Notifications `points_level_up`, `points_redemption`. UI lazy chunk `points` (~5.2 KB br): `#/points`, `#/leaderboard`,
  `#/admin/points`.

### Tests
- `server/test/beta.test.js` (8) + `server/test/points.test.js` (7) on PostgreSQL; touched: launch, compliance, notify,
  transfers (ledger) suites green; new e2e `tests/e2e/beta-points.e2e.test.js` (3) + launch e2e (3). Core JS 85,257 B br.

## 2.26.0 — 2026-10-16 — Phase 53 «أسعار الاشتراكات ولوحة الإيرادات والتكاليف» + Phase 58 «متجر المنتجات الرقمية» (roadmap 2, tracks 11 + 12)

### Added — Phase 53 (pricing manager + revenue / cost dashboard, admin only)
- `services/pricing.js` + migration `037_pricing` (additive: `price_book`, `price_locks`, `cost_entries`, `finance_settings`,
  index on `ledger_journals(created_at)`).
- One price book for every paid thing: «مجتمع+ ذكاء» plan price, platform fees on tips, creator subscriptions (new separate
  `supportFeeBps`), pay-per-view, market + digital sales, Pi transfers (new: recipient gets amount − fee, fee → `platform:fees`),
  ad CPM (min / default). Rows are scheduled → active → superseded | cancelled; full history; `confirm:true` required; revert
  a fee to its env default; leased job `pricing.apply` + per-instance config sync each minute.
- Grandfathering: an AI plan price rise with `grandfather` keeps the old price for live subscribers (`price_locks`, optional
  days; dropped when the subscription lapses > 7 days); `ai.subscribe` asks `pricing.priceFor()`.
- Suggested prices are shown next to each item (with reasons) and applied ONLY on explicit confirmation.
- Revenue from `lib/ledger.js`: by stream (digital split from market), by day/month, paid in, platform share, creator/seller
  payouts, refunds, transfer volume, liabilities (escrow, held, unspent ad budgets). Costs: manual monthly entries (US cents) +
  usage counters (llm_usage, ai_period_stats, emails) without double counting; Pi→USD rate setting; margin; break-even
  (paying members / AI subscribers needed). CSV export with UTF-8 BOM. Public `GET /api/pricing` (current fees and prices).
- UI lazy chunk `econ` (4.8 KB br): `#/admin/pricing`, `#/admin/revenue`; links on `#/admin`.

### Added — Phase 58 (digital products store, extends the phase 39 market)
- `services/digital.js` + migration `038_digital` (additive: `digital_products`, `digital_files`, `digital_entitlements`,
  `digital_downloads`, `digital_reports`). A digital product is a `market_listings` row with kind `digital` (orders, escrow,
  fees, reviews, disputes, search stay the market's); the market only accepts that kind through the digital service.
- Files (PDF/e-book, ZIP/EPUB/Office templates and course bundles, images, MP3, MP4) in the existing media storage under
  private `dg_` keys (`STORAGE_DRIVER=db` caps apply; 20 MB/file, 60 MB/seller by default); `/media/dg_…` always 403.
- Instant delivery on `MARKET_ORDER_PAID`: entitlement + optional license key, order → delivered, system message. One purchase
  per buyer, qty 1. Library `#/purchases` «مشترياتي»: expiring (5–60 min) buyer-bound download links, per-product download limit,
  license key. Previews (public file) + sample text. Refund policy per product (none | undownloaded 48 h | 7 days) while the
  escrow is held → escrow refunded via the market, access revoked. Creator stats (per product, 30-day series, downloads,
  refunds) + license list/verify. Abuse/copyright reports → `reports` (kind listing) + admin takedown (listing removed, files
  sha-blocked against re-upload, optional revoke) / dismiss. Minors excluded.
- UI lazy chunk `digital` (6.4 KB br): `#/digital`, `#/digital/p/:id`, `#/digital/new|edit/:id`, `#/digital/sales`,
  `#/purchases`, `#/admin/digital`; link from the market grid and the wallet; digital market items open in the store.

### Changed
- Core bundle 91,994 → ~85,100 B brotli (budget 92,160): security center + system status, privacy center, message requests,
  verification, admin trust & growth and organisations moved from `security-ui.js` / `identity-ui.js` into the lazy `secx`
  chunk; `chunks.js` route matching simplified (two-segment routes in the route table instead of a regex chain).
- `server/server.js` reads its version from `server/package.json` (no hard-coded version); a test checks it equals the root.

### Production
- Pricing: nothing changes on deploy — every item keeps its current value; suggested prices wait for the admin's confirmation.
- Digital store: off (config `enabled:false`, writes 501 `not_configured`) until Pi payments are enabled.

## 2.25.0 — 2026-10-16 — Phase 52 «تفعيل المزودات بالمجان» + Phase 57 «اشتراكات صنّاع المحتوى بمستويات» (roadmap 2, tracks 11 + 12)

### Added — Phase 52 (providers at zero cost)
- Push: the VAPID pair is generated on first start and stored in `notify_keys` in production too (`lib/providers.vapidPolicy`);
  env keys still override, `VAPID_ENV_ONLY=1` opts out. Warmed at boot so `/api/pwa/config` reports push on immediately.
- Email: SMTP from `SMTP_URL` or entered by an admin as form fields (host/port/user/password/from) and stored in
  `provider_settings` (migration `035_providers`, password sealed with AES-256-GCM, never returned); `ctx.mailer` is now a
  switchable mailer, so saving/clearing applies without a restart. Test send, previews of every template, public
  `GET /api/providers/status` with an in-app fallback note when mail is off. No external account is created by the app.
- Translation: admin-stored provider (LibreTranslate URL, DeepL API Free — keys ending `:fx` only, OpenAI-compatible endpoint
  with cost rates 0 by default), test before/after save, hot-swapped into the translate service; env always wins.
- Unified admin checklist `GET /api/admin/activation` + UI `#/admin/activation` (Pi summary, push, email, translation, phone
  steps); `/status` lists push + machine translation.

### Added — Phase 57 (creator monthly subscriptions with tiers)
- `services/creatorsubs.js` + migration `036_creator_subs` (additive: `sub_tier_meta`, `sub_changes`, `sub_events`,
  `sub_channel_msgs`, `sub_early`), extending phase 37 tiers/monthly support and phase 38 supporter-only posts.
- Tier benefits: supporter-only posts, subscriber channel, badge (label + emoji), early access (1–168 h), description.
- Renewal `POST /api/subs/:handle/renew` (user-confirmed Pi payment, purpose `subscription`), grace-period reminder `sub_grace`
  on top of the phase 37 reminder; upgrade = prorated payment applied on completion; downgrade scheduled for the next renewal;
  refunded upgrade reverts the tier. Proration rules recorded in `lib/ledger.js` (`PRORATION`, `prorate`): charges rounded up
  to 0.01 π (pi_transactions.amount is REAL), sub-half-cent charges waived.
- Subscriber channel with badges, early-access release job (body back from `paid_content`, media unlocked), creator studio
  `#/subscribers` (churn stats, MRR, by tier, 6 months, subscriber list keeping anonymity, benefits editor, early access).
- Notifications `sub_grace`, `sub_upgraded`, `sub_channel`; `SUPPORT_CANCELLED` bus event; data-map entries. Minors excluded.
- UI lazy chunk `subs` (5.0 KB br); links from the creator support page and creator settings.

### Production
- Push becomes active on deploy (stored VAPID pair). Email and translation wait for the admin to enter a provider.
  Subscriptions answer 501 `not_configured` until Pi payments are enabled.

## 2.24.0 — 2026-10-16 — Phase 51 «تفعيل مدفوعات Pi» + Phase 56 «تحويلات Pi وطلبات الدفع» (roadmap 2, tracks 11 + 12)

### Added — Phase 51 (Pi payments activation readiness)
- `services/piactivation.js`: admin checklist `GET /api/admin/pi/activation` (PI_ENABLED, PI_API_KEY presence — never its value,
  Testnet/Mainnet with `PI_MAINNET_CONFIRM`, `PI_WALLET_ADDRESS` (required on Mainnet), validation file, HTTPS domain/`PUBLIC_URL`,
  purposes) + Pi App Directory checks (privacy, terms, manifest name/description/512 icon/categories, /about, help center,
  frame-ancestors, minors policy), each with its Arabic fix and phone-friendly activation steps.
- Startup self-check log line (mode + missing items). Live key probe `POST /api/admin/pi/activation/probe`.
- Safe dry run `POST /api/admin/pi/dryrun`: the real Pi service code against in-memory SQLite + a simulated Pi API (6 scenarios);
  no network, no production rows. Works while payments are off.
- Incomplete-payment recovery on sign-in `POST /api/pi/recover` (own stuck payments re-checked with Pi); `PI_VALIDATION_KEY` served
  at `/validation-key.txt`; public summary `GET /api/pi/readiness`. UI `#/admin/pi-activation` (+ 0.01 π test payment button).

### Added — Phase 56 (Pi transfers + payment requests)
- `services/transfers.js` + migration `034_transfers` (additive: `pi_transfers`, `pi_pay_requests`, `pi_payouts`). Send via Pi
  purpose `transfer`; credit on `PI_PAYMENT_COMPLETED` only, double-entry journals (`user:<id>:pi_out` → `user:<id>:transfers`,
  held via `platform:held`), refunds reverse, staff payouts (`platform:payouts`) recorded with the Pi txid.
- Requests: create / decline / cancel / pay-by-request, 7-day expiry, per-day and per-payer limits.
- Limits/anti-fraud: per transfer, daily (lower for new accounts), hourly; new-account / large / integrity-limited holds with
  admin release/reject; minors excluded; blocked pairs refused; recipients can switch receiving off.
- Notifications `pi_transfer_received|held|rejected`, `pi_request_received|paid|declined`. Data map entries for the new tables.
- UI lazy chunk `transfers` (6.2 KB br): `#/transfers` (balance, history, receive toggle, limits), send/request forms,
  `#/transfers/requests`, receipts with explorer link, `#/admin/transfers`; link from the wallet and admin home.

### Production
- Pi payments stay OFF (no `PI_API_KEY`): transfer routes answer 501 `not_configured`; checklist shows what is missing.

## 2.23.0 — 2026-10-16 — Phase 50: launch readiness «الجاهزية للإطلاق» (final phase — 50/50)

### Added
- Admin-editable Arabic help center + FAQ with Arabic-normalised search (`/api/helpcenter/*`, 12 seeded items, staff editor).
- Support tickets: user tickets with own-media attachments, staff queue, assignment, internal notes, statuses; a staff reply
  notifies the user (`support_reply`, Arabic wording in `notify-lib.js`).
- Community ambassadors: application, staff review (approve/reject/revoke → `ambassador_*` notifications), 🎖 badge, referral
  stats, ambassador invite codes.
- Waitlist + gradual rollout: `LAUNCH_MODE=open|invite` (default **open**); in invite mode registration/new Pi accounts need a
  code (new Pi accounts are parked on the waitlist). Staff waitlist/invite tools under `#/staff/launch`.
- `/about` landing (`public/about.html` + `#/about`), store listing material under `docs/store/`.
- Internal security audit tool (`tools/security-audit.mjs`: headers/CSP, authz probe of every route) + `docs/security/AUDIT.md`
  and OWASP checklist; k6 10k-VU scenario (`tools/k6-launch.js`) and local load runner (`tools/load-launch.mjs`).
- Design-review fixes shipped as chunk CSS only (focus ring, form font inheritance, textarea resize, bidi numbers, image overflow).
- Migration `033_launch` (additive: 9 new tables). UI is the lazy `launch` chunk loaded by the `ai` chunk; core bundle unchanged.

### Fixed
- Passkey `takeChallenge` returns 400 (not 500) on malformed `clientDataJSON` (found by the audit).
- Security audit tool treats `OPTIONS` (the phase 47 CORS preflight on `/api/v1/*` and `/api/oauth/*`) as non-mutating; re-run on
  the integrated tree: 674 routes probed, 0 high · 0 medium · 3 low.

### Notes
- Production keeps `LAUNCH_MODE` unset (= open); no new secrets, variables or paid services.
- Pending outside the repo: external penetration test and a real 10,000-concurrent load test (needs staging + a load generator).
  Deferred design items (≥40 px buttons, ≥48 px bottom-nav targets, one empty-state style) need a core-budget phase.
- With this release all 10 tracks / 50 phases of the roadmap are done.

## 2.22.0 — 2026-10-16 — Phase 49: monitoring & operations «المراقبة والتشغيل»

### Added
- Prometheus metrics (tiny built-in registry): request counter by method/route/status class, latency histogram, queue/jobs, SLO
  budget. `GET /metrics` only with `METRICS_TOKEN` (otherwise 404); admins use `GET /api/metrics`. Per-instance minute rollups.
- Opt-in OpenTelemetry tracing (`OTEL_EXPORTER_OTLP_ENDPOINT`; W3C `traceparent`, db spans without params; built-in OTLP/HTTP JSON).
- Alert rules (5xx rate, p95, queue backlog, failed jobs) paging once on fire and once on resolve via in-app (`ops_alert`
  notification for admins, Arabic wording in `notify-lib.js`), optional webhook (`OPS_ALERT_WEBHOOK_URL` / `ERROR_WEBHOOK_URL`)
  and email (only with SMTP). SLOs (availability 99.5 %, latency 95 % < 800 ms over 30 d) with error budget and burn rates.
- Public status page `/status` (server-rendered Arabic HTML, no JS, 90-day bars, incidents) + `GET /api/status/public`; incident
  management; product metrics (signups, DAU/WAU/MAU, engagement, weekly retention cohorts); DR drill script
  (`server/scripts/dr-drill.js`, encrypted logical backup + restore verification, local only); Grafana dashboards + Prometheus
  config/alerts under `deploy/`.
- Migration `032_ops` (additive: 8 `ops_*` tables). Admin UI `#/admin/ops` and `#/admin/ops/product` served as `/ops-ui.js`
  (admins only, injected by the `pi` chunk); core bundle unchanged.

### Notes
- Production: no `METRICS_TOKEN`, no OTLP endpoint, no alert webhook/SMTP configured, so alerts are in-app only. The
  `@opentelemetry/api` path, a real Grafana import and the pg_dump-format restore were not verified.

## 2.21.0 — 2026-10-16 — Phase 48: horizontal scaling «التوسع الأفقي»

### Added
- Opt-in scale adapters (`server/lib/scale.js`): Redis (minimal RESP2 client) for cache, distributed rate limits, optional session
  cache and realtime fan-out; NATS (text protocol) for the event bus. Enabled only by `REDIS_URL` / `NATS_URL`; without them the
  in-process classes are used exactly as before.
- `ROLE` split (`web`, `worker-*`; unset = `all`): worker roles serve health only (404 `worker_role`), no WebSocket upgrades, no
  in-process interval jobs; queue kinds / scheduled jobs routed by role. `CDN_CACHE=1` adds `CDN-Cache-Control` to static assets.
- `GET /api/admin/scale` (admin): role, node, adapters, Redis/NATS readiness, stats. Kubernetes manifests (`deploy/k8s`, kustomize:
  web + 3 worker roles, HPAs, PDB, ingress — files only), shard-key helper, `docs/SCALING.md`. No migration, no new dependency.

### Notes
- Production is unchanged: no `REDIS_URL`, `NATS_URL`, `ROLE` or `CDN_CACHE` on Railway. Adapters were verified against in-test
  protocol fakes (no live Redis/NATS). Phase 47 API-key rate limits and webhook de-dupe are still per instance (not yet moved to
  the Redis adapter). NATS TLS and Kafka not supported; presence is per node.

## 2.20.0 — 2026-10-16 — Phase 47: developer API «واجهة المطورين»

### Added
- Public REST API v1 (`/api/v1/*`, bearer `mpk_` API key or `mpa_` OAuth token; anonymous reads rate-limited per IP). Every read
  runs as an anonymous viewer (public, non-paid posts and public communities only); writes need `write:posts` or a bot token.
  `GET /api/v1/openapi.json` generated from the same route definitions. CORS `*` for bearer-only routes.
- OAuth 2.0 (`/oauth/authorize` → consent `#/oauth`, `/api/oauth/token|revoke`): authorization code + mandatory PKCE S256,
  refresh rotation with reuse detection, `client_credentials` for bots. Credentials stored as sha256, shown once.
- Signed webhooks (`X-Mujtama-Signature`, retries with backoff, delivery log + manual retry), community bots (public communities
  only), per-key/per-token sliding rate limits with `X-RateLimit-*` headers, developer portal + admin suspend/stats.
- Migration `030_devapi` (additive: 8 `devapi_*` tables). UI in lazy sub-chunk `dev` (loaded by `ai`): `#/developers`,
  `#/developers/docs` (Arabic interactive docs), `#/developers/admin`, `#/oauth`. `tools/build.mjs` supports `data-parent` sub-chunks.

### Fixed
- Interface language after a reload (Phase 41): for a signed-in user with a non-Arabic UI, the i18n chunk booted before the
  server hydrate set `DB.settings.lang`, so the catalogue was never loaded and labels stayed Arabic under a `ur`/`fr`/`en`
  `dir`/`lang`. The `/api/me/lang` sync now compares with the language actually shown and loads the catalogue.

### Notes
- Webhook signing secrets are stored in plain text (HMAC needs them); the SSRF guard checks host/IP literals, not DNS
  resolution; rate limits and event de-dupe are per instance until Phase 48.

## 2.19.0 — 2026-10-16 — Phase 46: installable app «تطبيق قابل للتثبيت»

### Added
- Full installable PWA: `public/manifest.json` (share target, shortcuts, maskable/monochrome icons), 32 generated icons + 15 iOS
  splash screens (`npm run icons`), install card / iOS «إضافة إلى الشاشة الرئيسية» steps, `#/app` screen, «📲 التطبيق» in settings
  (lazy `pwa` chunk, rides on the idle `notify` chunk; core bundle unchanged).
- Service worker: offline reading (network-first READ endpoints in `mp-api`, cleared on logout), offline drafts (IndexedDB queue,
  Background Sync `mp-drafts`, 409 → server copy wins), Web Share Target (`POST /share-target`), store-less updates
  («تحديث جديد لمجتمع بلس متوفر», no auto `skipWaiting` on update).
- `GET /api/pwa/config` (public): push availability + source, share target, release, minimum iOS — never returns keys.
- Capacitor scaffold (`capacitor.config.json`, `npm run cap:*`; native build not run). Edge swipe-back gesture (RTL-aware).

### Changed
- Push: VAPID keys from the environment only in production (or `VAPID_ENV_ONLY=1`); a key pair already stored in `notify_keys`
  keeps working, so existing subscriptions are not broken. With neither, `GET /api/push/vapid` → 503 `push_not_configured`.
- Phase 44 icons: the default icon uses the single default `/manifest.json`; an alternative icon swaps to
  `/api/prefs/manifest.webmanifest?icon=…`, which now inherits the default manifest (share target, shortcuts) with only icons/colours changed.

### Notes
- `beforeinstallprompt` fired before the lazy chunk loads is not caught (browser install menu still works). Store push needs FCM/APNs.

## 2.18.0 — 2026-10-16 — Phase 45: digital wellbeing «الرفاهية الرقمية»

### Added
- `#/wellbeing` (free, lazy `wellbeing` chunk): on-device usage time (today, 7-day bars; `localStorage` only), break reminders,
  daily limit, hide counts, focus mode (no infinite scroll, «عرض 10 منشورات أخرى», no suggestion/trend cards, no badges),
  «أنت مطّلع على كل شيء» at the end of the feed, weekly report.
- Migration `028_wellbeing` (additive: `wellbeing_settings`, `wellbeing_weekly`; own tables, independent of `user_prefs`).
  `GET /api/wellbeing/config`, `GET|PUT /api/wellbeing/settings`, `GET|POST|DELETE /api/wellbeing/weekly` (opt-in `shareTotals`;
  turning it off deletes every stored week; weeks older than 8 pruned).
- Job `wellbeing.weekly`: one in-app notification `wellbeing_weekly` per finished shared week; email only with SMTP + opt-in + verified address.
- Compliance: both tables in the data map (erase: delete). Core CSS unchanged.

### Notes
- Counts may show for a few hundred ms on the very first paint before the chunk loads.

## 2.17.0 — 2026-10-16 — Phase 44: personalization «المظهر والتخصيص»

### Added
- `#/settings/appearance` (free, lazy `prefs` chunk): seven colour themes, light/dark/system mode, true-black OLED, compact density,
  reorderable bottom nav, alternate app icons (PNG + per-icon manifest), live preview card, «تراجع» and defaults.
- Server-stored preferences: migration `027_prefs` (additive: `user_prefs` key/value JSON by namespace); `GET|PUT|DELETE /api/prefs`
  (strict `ui` namespace, free-form namespaces for later phases, `a11y` reserved → 400), public `GET /api/prefs/catalog`,
  `/api/prefs/icons/<id>-<size>.png`, `/api/prefs/manifest.webmanifest?icon=`. Cross-device sync via realtime `prefs`.
- Saved look injected by `chunks.js` before first render (`localStorage["mp.ui"]`), exposed as `html[data-palette|data-oled|data-density]`.
- Compliance: `user_prefs` in the data map (erase: delete). Core JS +35 B br; CSS unchanged.

### Changed
- Phase 43 high contrast now uses higher-specificity selectors so it always wins over palettes/OLED, whatever order the styles load in
  (new e2e check in `tests/e2e/prefs.e2e.test.js`).

## 2.16.0 — 2026-10-16 — Phase 43: full accessibility «الوصول الشامل»

### Added
- Display settings `#/settings/display` (free): font scale, high contrast, dyslexia mode with wider spacing, motion, underline links,
  focus ring, captions by default. Stored per user under `a11y.*` (migration `026_a11y`, additive: `a11y_prefs`, `media_alt`,
  `video_captions`, `a11y_audits`); `GET|PUT|DELETE /api/me/a11y`, `GET /api/a11y/config`. Saved CSS applied before first paint.
- Screen reader & keyboard: skip link, landmarks, live region + focus to new heading on navigation, `aria-current`, modal dialog
  contract (focus trap, Escape, restore), names for icon buttons/fields, `role=article` posts with j/k.
- Alt text: user → optional vision model (public, non-paid images only) → heuristic from post text; `GET|PUT /api/a11y/alt/:mid`, ALT editor.
- WebVTT captions (SRT accepted) with optional ASR (`A11Y_ASR_KEY`/`WHISPER_*`; no key → 503 `not_configured`); player `<track>`.
- Periodic audit: leased job `a11y.audit` (COUNT queries only), admin `#/admin/a11y`, `npm run a11y:audit` (axe WCAG A/AA) + weekly CI workflow.
- Lazy `a11y` chunk, idle-loaded for everyone. Core JS +62 B br; CSS unchanged.

### Notes
- E2E: the owner-only ALT button can appear a moment after the image label on first paint (owner known after `DB.me` loads); the test now waits for it.

## 2.15.0 — 2026-10-16 — Phase 42: AI assistant «المساعد الذكي»

### Added
- AI assistant for «مجتمع+ ذكاء» subscribers (`server/services/assistant.js`, `server/lib/assistant-lib.js`, feature key `assistant`,
  seeded once into plan `ai_plus`): writing assistant (rephrase / improve / shorter / polite), polite reply suggestions, community Q&A
  with verified citations (extractive fallback), semantic search. OpenAI-compatible provider by env key only (`ASSISTANT_API_KEY` or
  `OPENAI_API_KEY`); no key → 503 `not_configured`. Only the user's draft/query and PUBLIC content reach the provider; messages/E2EE never.
- Vector store: migration `025_assistant` (additive: `assistant_vectors`, `assistant_meta`); pgvector when the extension is already
  installed, JS cosine fallback otherwise; background job `assistant.index`; vectors forgotten on post update/delete.
- Per-user monthly caps and cost via `ai.checkCaps`/`ai.meter` (`plan.limits.assistant` or `AI_ASSISTANT_MONTHLY_CHARS|USD`).
- API `/api/assistant/{config,me,write,replies,ask,search}`, admin `/api/admin/assistant/{status,reindex}`.
- Lazy `assistant` chunk: «✨ المساعد» button in the post composer and comment box, sheet with usage %, transparency
  «ما الذي يراه المساعد؟»; suggestions fill the field only after «استخدام». Core JS/CSS unchanged.

### Changed
- Admin `PUT /api/admin/ai/plans/:slug` now accepts `limits.assistant` as well as `limits.translate` (either or both).

### Notes
- The pgvector path is not exercised by tests (no extension locally); the JS fallback is tested on SQLite and PostgreSQL.

## 2.14.0 — 2026-10-16 — Phase 41: real translation «الترجمة الحقيقية» + AI subscriptions «مجتمع+ ذكاء»

### Added
- Interface languages (free for everyone): العربية, English, Français, اردو with LTR/RTL, 🌐 switcher (`#/settings/language`,
  Settings), language stored on the account (`PUT /api/me/lang`), lazy `i18n` engine + `i18n-en|fr|ur` catalogues, admin UI string
  manager `#/admin/i18n` (`ui_strings` overrides, aggregated missing-string reports).
- Generic AI entitlement system (`server/services/ai.js`): plans bundle feature keys (`translate` now, `assistant` next), optional
  monthly Pi subscription (purpose `ai`), renew / cancel / expiry, staff grants, refunds, ledger `platform:ai`, per-user monthly caps,
  global provider budget, operator finance (revenue vs provider cost). Price only from `AI_PLAN_PRICE` or the admin — never in code.
- Real machine translation for subscribers (`server/services/translate.js`, `server/lib/translate.js`): pluggable DeepL /
  OpenAI-compatible / LibreTranslate by env key, posts / comments / messages, tap to toggle original ⇄ translation, auto-translate,
  shared cache by content hash + language, messages only to private providers, E2EE plaintext only with consent and never cached.
- Migration `024_ai_translate` (additive, 9 tables). Lazy `ai` chunk: translate buttons, upsell sheet, `#/ai`, `#/settings/translate`, `#/admin/ai`.
- Production: no provider key and Pi payments off → «خدمة الترجمة غير مفعّلة بعد» / «مدفوعات Pi غير مفعّلة بعد»; languages work.

### Changed
- Legacy `POST /api/translate` now requires the subscription (it was free and unmetered). `/api/health.translate` = provider configured.

## 2.13.0 — 2026-10-16 — Phase 40: ethical ads «الإعلانات الأخلاقية»

### Added
- Ads server (`server/services/ads.js`, migration `023_ads`, additive: 8 new tables): self-serve promoted posts (own public posts),
  interest-only targeting (followed topics, UI language, profile country; sensitive categories refused), pre-publication review
  (automod + staff queue), Pi-funded CPM budgets through the ledger (purpose `ads`), feed insertion at most 1 per 8 organic posts
  (never first), salted daily frequency caps, signed single-use event tokens, k-anonymous stats (counts < 10 hidden),
  «لماذا أرى هذا الإعلان؟», hide ad / advertiser, ad preferences, notifications, compliance data map.
- Lazy `ads` chunk (`ads-ui.js`): promoted feed card with «مُروَّج» label, why sheet, hide; campaign list, 4-step wizard with live
  audience estimate, dashboard (KPIs, SVG chart, budget), `#/settings/ads`, `#/admin/ads/review`. Core bundle stays ≤ 90 KB br.
- Pi payments stay off in production: campaigns can be created, reviewed and approved; they wait in «بانتظار التمويل» with funding disabled.

### Integration fixes (p40-integrate)
- Client reads the server's `budget{}` object, `review.reasons`, percentage `ctr`, `audience.label`, server reject reasons, and
  `piEnabled`/`fundNote`; hide reasons use the server codes; start date never in the past; frequency window ≤ 24 h; budget limits
  from `GET /api/ads/config`; Arabic messages for `review_invalid`, `event_invalid`, `token_invalid`, `bad_request`, `spam`, `rate_limited`.
- Server accepts the aliases `not_interested` (hide) and `rights` (review) (additive).
- `ads.e2e` gains a test against the real P40 server (no ads / Pi stubs).

## 2.12.0 — 2026-10-16 — Phase 39: community marketplace «السوق المجتمعي»

### Added
- Marketplace server (`server/services/market.js`, migration `022_market`, additive: 6 new tables): listings of products &
  services priced in Pi, orders paid through Pi (purpose `market`) into escrow (double-entry ledger, `escrow:market`),
  ship / deliver / confirm / auto-release after 7 days, order conversation, seller reviews + replies, disputes with
  evidence and admin resolution (refund / release / split), search type `listing`, notifications, compliance data map.
- Lazy `market` chunk (`market-ui.js`): grid with search, category chips, filters, sort, infinite scroll; product page with
  multi-image gallery + lightbox; listing form (1–8 images); orders (buyer / seller / my listings); order page (escrow,
  timeline, actions, review, dispute); seller page; `#/admin/market/disputes`. «السوق» entry on Explore. Core bundle unchanged.
- Pi payments stay off in production: everything browses; buy is disabled with «مدفوعات Pi غير مفعّلة بعد».

### Integration fixes (p39-integrate)
- Client reads the seller page's `reviews:{items,next}` and `seller.distribution`, the admin dispute rows' flat `title`,
  dispute messages with `role:"staff"`; max price from `GET /api/market/config`; Arabic messages for `listing_rejected`,
  `unavailable`, `insufficient_quantity`, `review_invalid`, `evidence_invalid`, `resolution_invalid`, `split_invalid`,
  `dispute_resolved`. Admin dispute rows now also carry `evidence` (additive).
- `market.e2e` gains a test against the real P39 server (no market / media / Pi stubs).
- Grid infinite scroll: a scroll hit that arrives while a page is loading is remembered and loads the next page afterwards
  (was an intermittent stall in the grid e2e).

## 2.7.0 (rc2) — 2026-10-16

### Added
- **Database-backed media storage** (`STORAGE_DRIVER=db`, opt-in; default stays local disk). Uploaded media,
  processed video/audio outputs, avatars and chat attachments are stored in a new `blobs` table
  (migration `013_blobs`, `CREATE TABLE IF NOT EXISTS` only) so they survive redeploys on hosts with an
  ephemeral filesystem. `/media/<name>` and `/api/chat/blobs/:id` keep the same URLs, auth rules, Content-Type
  and Range behaviour (`/media/` only).
- Caps: `STORAGE_DB_MAX_FILE_MB` (default 25) and `STORAGE_DB_MAX_TOTAL_MB` (default 300) refuse writes with
  HTTP 413; a warning is logged above `STORAGE_DB_WARN_PCT` (default 80) percent.
- Read-through: with the db driver a key missing from the database but present on disk is served and copied in;
  the disk file is never deleted by the copy.
- `server/scripts/import-media.js`: idempotent import of an old `STORAGE_DIR` (tar, tar.gz or directory), skip
  existing keys, verify size + sha256 after insert, summary line; never overwrites or deletes.
- `server/scripts/verify-migrations.js`: static additivity check of migrations 010+ and an apply check that
  compares exact per-table row counts before/after.
- `ops/backup/prod-backup.sh` + short `README-backup.md`: read-only pg_dump / media tar helper for `railway ssh`.

### Changed
- `/media/` handler is now async (`await media.serve(...)`); behaviour with the local driver is unchanged.
