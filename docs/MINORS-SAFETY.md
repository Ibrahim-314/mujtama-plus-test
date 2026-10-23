# مجتمع بلس — المرحلة 35: حماية الأطفال والمحتوى الحساس

> المسار السابع (الثقة والأمان). الخادم: `server/services/minors.js` (+ ترحيل `018_minors`). القواعد الصافية المشتركة بين
> الخادم والمتصفح: `minors-core.js` (`window.MPMinorsCore`). الواجهة: `minors-ui.js` (`window.MPMinorsUI`).
> الاختبارات: `server/test/minors.test.js` (SQLite + PostgreSQL)، `tests/unit/minors-lib.test.js`، `tests/e2e/minors.e2e.test.js`.

## المبادئ

* **العمر إقرار ذاتي** (تاريخ ميلاد) — لا رفع لصور الهوية ولا قياسات حيوية. هو إشارة لحماية الأصغر سناً وليس إثباتاً.
  يمكن تقويته بإشارة توثيق Pi (اختيارية، معطّلة افتراضياً) وبمراجعة فريق السلامة.
* **الأشد افتراضياً للقاصرين، ولا يمكن تخفيفه**: يستطيع القاصر التشديد دائماً، ولا يستطيع التخفيف دون الحد الأدنى.
* **الفلترة في الخادم**: المحتوى غير المناسب لا يصل إلى جهاز القاصر أصلاً (لا تعتمد على إخفاء في الواجهة).
* **الحد الأدنى من البيانات**: من يُصرِّح بعمر دون الحد الأدنى لا يُنشأ له حساب ولا يُحفظ تاريخ ميلاده. لا يظهر العمر ولا
  «قاصر/بالغ» في أي ملف عام (`users.pub` لم يتغير) حتى لا يصبح إشارة يستهدفها المسيئون.
* **لا إرسال تلقائي لأي جهة خارجية.** سجلات الإبلاغ الرسمي تُعدّ وتُصدَّر ويُسلّمها فريق بشري يدوياً عبر قناة يحددها المشغّل.
* **الشفافية مع القاصر**: كل ما يراه وليّ الأمر يراه القاصر نفسه، وكل تغيير يجريه وليّ الأمر يُسجَّل ويُبلَّغ به.

## 1. التحقق من العمر

| الحالة | الشرط (`MINORS_MIN_AGE`، افتراضي 13 ولا يقل عنه) | الأثر |
|---|---|---|
| `child` | العمر < الحد الأدنى | التسجيل مرفوض (`403 age_gate`) + كوكي `mp_agegate` ليوم واحد يمنع إعادة المحاولة بتاريخ آخر. إن صرّح حساب قائم بذلك لاحقاً يُعلَّق الحساب وتُنهى جلساته (`AGE_GATE` في سجل التدقيق) |
| `teen` | الحد الأدنى ≤ العمر < 18 | إعدادات الحماية (القسم 2) |
| `adult` | 18+ | بلا قيود إضافية |
| `unknown` | لم يُصرَّح | يرى المحتوى الحساس مغطّى، ولا يرى ما وُسم «للبالغين» (adultOnly) |

* عند التسجيل: الحقل `birthDate` (`YYYY-MM-DD`) في `POST /api/auth/register` اختياري، ويصبح إلزامياً بـ `MINORS_REQUIRE_DOB=1`.
  الواجهة تضيف حقل «تاريخ الميلاد» إلى نموذج التسجيل.
* التصحيح لاحقاً `POST /api/age` حتى 3 مرات. **خفض** العمر إلى قاصر يُطبَّق فوراً. **رفع** قاصر إلى بالغ لا يُطبَّق ذاتياً:
  يصبح طلباً معلّقاً تراجعه القيادة (`/api/safety/age-reviews`) أو تقبله إشارة Pi KYC.
* عند بلوغ 18 تُرفع القيود تلقائياً (الحساب يُحسب من التاريخ في كل طلب)، وتبقى إعدادات الخصوصية كما هي، وتنتهي الروابط العائلية.
* **Pi KYC (بذرة stub)**: `MINORS_PI_KYC=1` يفعّل `POST /api/age/pi-kyc {accessToken}`. يتحقق الخادم من الرمز عبر
  `GET {PI_API_URL}/v2/me` ويشترط تطابق `uid` مع `users.pi_uid`. لا تكشف Pi عن العمر؛ نعامل حقلاً صريحاً لحالة KYC
  (`kyc_verified` / `kyc:"verified"` / `credentials.kyc_verified`) **كإشارة بلوغ فقط**. إن لم يتوفر الحقل تُسجَّل `unverified`.
  هذا افتراض يجب على المشغّل التحقق منه مع وثائق Pi قبل التفعيل.

## 2. إعدادات افتراضية أشد للقاصرين

تُطبَّق عند التصريح بعمر قاصر (وعند كل تغيير من وليّ الأمر):
`private=1` · `privacy.dm="following"` · `privacy.mentions="following"` · `filterRequests=true` · مسح `users.location`
ومواقع منشوراته · المحتوى الحساس مخفي (`contentPref` = hide دائماً) · **لا يُقترح على البالغين** (القسم 4).

الأقفال (عبر خطافات على المسارات القائمة، دون تعديل ملفاتها):
* `PUT /api/privacy`: يُرفض `private:false` و`filterRequests:false` وأي قيمة أضعف من الحد الأدنى (`403`).
* `PATCH /api/profile` بموقع → `403`. `POST /api/posts` → يُحذف `location` بصمت.
* احتياط إضافي على الناقل: `POST_CREATED` و`PROFILE_UPDATED` يمسحان أي موقع لقاصر.

## 3. تصنيف المحتوى الحساس من الناشر

التصنيفات (`MPMinorsCore.LABELS`):

| المفتاح | الاسم | للبالغين فقط | ملاحظات |
|---|---|---|---|
| `violence` | عنف | لا | |
| `graphic` | مشاهد صادمة | نعم | |
| `adult` | للبالغين | نعم | |
| `self_harm` | إيذاء النفس | لا | الغطاء يعرض خطوط المساندة |
| `gambling` | مقامرة | نعم | |
| `medical` | طبي | لا | |
| `spoiler` | حرق أحداث | لا | «خفيف»: يُغطّى فقط ولا يُخفى عن أحد |

* عند النشر: `POST /api/posts { …, labels: ["graphic"], mediaLabels: { "1": ["medical"] } }` (الواجهة: رقائق في المحرر).
* لاحقاً: `PUT /api/posts/:id/labels { labels, media }` للناشر أو لفريق السلامة. تصنيف المشرف لا يستطيع الناشر إزالته.
* أي تصنيف يضبط `posts.sensitive=1` فيبقى المسار القديم (المصنّف الآلي والواجهة القديمة) متسقاً.
* `GET /api/content-labels` القائمة، `GET /api/content-labels/batch?ids=a,b` (≤50) التصنيفات وقرار التغطية للمشاهد.

## 4. الفلترة التلقائية حسب العمر (خادمية)

القرار `MPMinorsCore.decide(viewer, post)` → `show | cover | hide`:
* منشورات المشاهد نفسه: `show` دائماً.
* قاصر: يُخفى كل منشور موسوم (عدا `spoiler`) أو `sensitive` من المصنّف القديم.
* عمر غير معروف (ومن لم يسجّل الدخول): يُخفى `adultOnly`، والباقي `cover`.
* بالغ: حسب التفضيل `blur` (افتراضي → `cover`) / `show` / `hide`.
* المحتوى المحجوز في حالة سلامة مفتوحة (القسم 5) يُخفى عن الجميع عدا كاتبه وفريق السلامة.

**الدالة المصدَّرة** `ctx.services.minors.filterPosts(rows, viewerId)` (صفوف `posts` الخام، تحافظ على الترتيب) و
`filterUsers(users, viewerId)` (يحذف القاصرين من قوائم الأشخاص للبالغين ما لم توجد متابعة بينهما).
عند تسجيل الخدمة تُلفّ تلقائياً: `content.filterVisible` و`content.canSee` و`content.toClient` (يضيف `contentLabels` و`cover`)،
فتغطي الخلاصة (ranking) والبحث والملفات الشخصية والمجموعات والوسوم والـ bootstrap. وتُلفّ مسارات:
`GET /api/posts/:id(/comments)`، `GET /api/search`، `/api/search/full`، `/api/search/suggest`، `/api/bootstrap` (حوض الاقتراحات).
تفاصيل الربط ونقاطه البديلة الصريحة في `INTEGRATION.md`.

## 5. مسار التصعيد للحالات الخطيرة

* **المصادر**: كل `REPORT_CREATED` يُفحص بـ `classifySeverity` (كلمات عربية/إنجليزية مع توحيد الهمزات والتشكيل). العادي يبقى
  في مسار البلاغات القائم؛ `high/critical` يفتح `safety_case`. وجود قاصر (المُبلِّغ أو صاحب المحتوى) مع إشارة خطيرة → `critical`.
  ومن الواجهة: «بلاغ عاجل» `POST /api/safety/escalate { target?, kind?, category, details }` (لا يكون أبداً «عادياً»).
* **الأولوية**: `severity×1000 + ساعات الانتظار` ومهلة استجابة (SLA) 60 / 240 / 1440 دقيقة؛ المتجاوز يُعلَّم `overdue`.
* **الحجز**: `critical` من فئات `child_safety | exploitation | trafficking` يُحجز (`hold=1`) فيُخفى المحتوى فوراً عن الجميع
  عدا كاتبه (حتى لا يُنبَّه) وفريق السلامة. البلاغات المتكررة على الهدف نفسه تُدمج في الحالة نفسها وترفع شدتها.
* **تنبيه الفريق**: إشعار `safety_case` لكل مشرف (`role=admin`) وعضو في `safety_staff` + حدث فوري `safety_case`،
  واختيارياً بريد لـ `SAFETY_ALERT_EMAIL` (عبر `SMTP_URL` القائم) للحالات الحرجة **دون أي تفاصيل محتوى**.
* **حفظ الأدلة**: لقطة من الهدف (منشور/تعليق/رسالة/مستخدم/مجتمع، مع بصمات SHA-256 للوسائط المخزنة) في `case_evidence`
  ضمن سلسلة تجزئة: `hash = sha256(prev | case | seq | kind | ref | sha256(stableJSON(payload)) | captured_at)`.
  أي تعديل يكسر السلسلة (`GET /api/safety/cases/:id/verify`). اللقطة نسخة مستقلة تبقى بعد حذف الأصل.
  الرسائل المشفرة طرفياً لا يمكن قراءتها — يُحفظ ما هو غير مشفر فقط.
  `ctx.services.minors.isPreserved(target)` لسياسات الاحتفاظ (المرحلة 34) كي لا تحذف ما هو قيد التحقيق.
* **تقييد الوصول**: الطابور غير موجود (`404`) لغير الفريق. `agent` يرى ويفرز ويضيف ملاحظات ويحجز؛ `lead`/`admin` فقط
  يفك الحجز ويرى سجل الوصول ويعدّ سجلات الإبلاغ الرسمي ويراجع رفع الأعمار. كل عرض/إجراء/تصدير يُكتب في `case_access_log`
  وفي سجل التدقيق المتسلسل `audit_log`. إدارة الفريق: `PUT/DELETE /api/safety/staff/:id` (للإدارة فقط، لا يُضاف قاصر).

## 6. التعاون مع جهات الإبلاغ الرسمية

`POST /api/safety/cases/:id/authority-reports { body, jurisdiction?, notes? }` (قيادة فقط) ينشئ سجلاً منظماً
`mujtama.authority-report/1`: بيانات المنصة، الجهة، الحادثة (الفئة، الشدة، الوقت، وجود قاصر)، الحساب المعني (المعرّف،
الاسم، تاريخ الإنشاء، `pi_uid`، فئة العمر المُصرَّح بها، آخر 5 جلسات بعناوين IP ووكلاء المستخدم)، كل الأدلة مع بصماتها، وحالة
السلسلة. **هوية المُبلِّغ لا تُضمَّن**. يُحفظ مع `payload_sha256`.

* `GET /api/safety/authority-reports/:id/export` يعيد الملف JSON + `verified` (تطابق البصمة) + تعليمات التسليم.
* `POST /api/safety/authority-reports/:id/submitted { externalRef, channel?, status: submitted|acknowledged }` يسجّل التسليم اليدوي.
* **لا يوجد أي إرسال آلي.** على المشغّل:
  1. تحديد الجهة/الجهات المختصة في نطاقه القانوني وتسجيل المنصة لديها (مثل CyberTipline لدى NCMEC أو الخط الوطني المختص).
  2. ضبط `MINORS_AUTHORITY_BODIES` (المعرّفات المسموحة، افتراضياً `ncmec,national_hotline,police`) و
     `MINORS_AUTHORITY_CHANNEL` (وصف نصي للقناة الفعلية تراه القيادة، مثل «بوابة الجهة X — حساب المنصة») و
     `MINORS_OPERATOR_CONTACT` (جهة اتصال المشغّل في الملف).
  3. مراجعة المتطلبات القانونية المحلية (مدد الحفظ، الإبلاغ الإلزامي، عدم تنبيه المشتبه به) — هذه الأداة لا تغني عن مستشار قانوني.
* إعداد سجل يجعل الحالة `escalated` ويحجز المحتوى؛ إغلاقها بنتيجة `referred`/`actioned` يُبقي الحجز.

## 7. طبقة تغطية أنيقة للمحتوى الحساس

غطاء ضبابي متدرج (blur 22px) فوق المنشور مع أيقونة، رقائق التصنيفات، وصف أول تصنيف، زر «عرض المحتوى» وزر «لماذا أرى هذا؟».
الكشف يتم في مكانه (دون إعادة رسم الصفحة) مع نقل التركيز إلى المحتوى، وزر «تغطية» لإعادتها. المحتوى المغطّى `inert` و
`aria-hidden` فلا يصل إليه قارئ الشاشة أو لوحة المفاتيح قبل الكشف. احترام `prefers-reduced-motion`. وسم `self_harm` يعرض خطوط
المساندة (`MINORS_HELPLINES` JSON، افتراضياً الطوارئ 911 وخط مساندة الطفل 116111 — **على المشغّل التحقق منها لنطاقه**).
يتبع قرار الخادم (`post.cover`) ويحترم التفضيل (تغطية/عرض/إخفاء) من صفحة «العمر والمحتوى الحساس» (`#/age`).
تبسيط معلن: تصنيف صورة واحدة يغطي المنشور كله (مع ذكر رقم الصورة وتصنيفها).

## 8. إعدادات عائلية مبسطة

* ربط بين حساب بالغ (مُصرَّح 18+) وحساب `teen`، **بمتابعة متبادلة مسبقة** (حتى لا يرسل الغرباء طلبات) و**موافقة الطرفين**
  (من لم يبدأ الطلب يقبله). حد أقصى وليّا أمر لكل قاصر.
* تحكمات محدودة وتشدد فقط: `dm` (following|nobody)، `comments` (everyone|following|nobody)، `mentions` (following|nobody).
  تصبح الحد الأدنى الجديد للقاصر. لا وصول للرسائل أو المنشورات الخاصة أو سجل التصفح.
* `GET /api/family`: الروابط، و`whatGuardiansSee` (نفس كائن `GET /api/family/links/:id/overview` لوليّ الأمر) وسجل
  `minors_events` (تطبيق الحماية، تغييرات وليّ الأمر، أحداث العمر). كل تغيير يُشعَر به القاصر (`family_update`).
* أي طرف يستطيع إنهاء الربط في أي وقت ويُبلَّغ الطرف الآخر. ينتهي الربط تلقائياً عند بلوغ 18.

## عقد الواجهة البرمجية

| المسار | من | الوصف |
|---|---|---|
| `GET /api/age` | مستخدم | `{ declared, birthDate, age, band, minor, minAge, source, contentPref, pending, changesLeft, adultOn, protections, guardians, staff, kyc, requireDob, helplines }` |
| `POST /api/age {birthDate}` | مستخدم | تصريح/تصحيح؛ قد يعيد `{review:true}` أو `{blocked:true}` |
| `PUT /api/age/preferences {sensitive}` | مستخدم | `blur|show|hide` (show لبالغ مُصرَّح فقط) |
| `POST /api/age/pi-kyc {accessToken}` | مستخدم | `501` ما لم `MINORS_PI_KYC=1` |
| `GET/POST /api/safety/age-reviews[/:userId]` | فريق / قيادة | مراجعة رفع العمر `{action: approve|reject}` |
| `GET /api/content-labels`, `GET /api/content-labels/batch?ids=` | الجميع | |
| `PUT /api/posts/:id/labels {labels, media}` | الناشر / الفريق | |
| `POST /api/safety/escalate` | مستخدم | `{ reference, severity, helplines, selfHarm }` |
| `GET /api/safety/helplines` | الجميع | |
| `GET /api/safety/cases?status=active|open|closed|all` | فريق | مرتبة بالأولوية + `counts` |
| `GET /api/safety/cases/:id` | فريق | الحالة، الأدلة، السلسلة، (سجل الوصول للقيادة) |
| `POST /api/safety/cases/:id {action}` | فريق | `assign|triage|escalate|note|preserve|hold|release*|close{outcome}|reopen` |
| `GET /api/safety/cases/:id/verify` | فريق | `{ ok, checked, head | brokenAt }` |
| `POST /api/safety/cases/:id/authority-reports` | قيادة | |
| `GET /api/safety/authority-reports/:id/export` | قيادة | |
| `POST /api/safety/authority-reports/:id/submitted` | قيادة | يعيد `{ ok, state }` |
| `GET/PUT/DELETE /api/safety/staff[/:id]` | إدارة | `{role: agent|lead}` |
| `GET /api/family`, `POST /api/family/links {handle, as}` | مستخدم | `as`: صفتي `guardian|minor` |
| `POST /api/family/links/:id/accept|decline`, `DELETE /api/family/links/:id` | طرفا الربط | |
| `PUT /api/family/links/:id/controls`, `GET /api/family/links/:id/overview` | وليّ الأمر | |

أحداث الناقل الجديدة: `CONTENT_LABELED`، `SAFETY_CASE_OPENED`. أنواع إشعارات جديدة: `safety_case`، `family_request`، `family_update`.

## متغيرات البيئة (كلها اختيارية، ولا تتطلب أي خدمة مدفوعة)

| المتغير | الافتراضي | المعنى |
|---|---|---|
| `MINORS_MIN_AGE` | 13 | الحد الأدنى للتسجيل (13–17) |
| `MINORS_REQUIRE_DOB` | معطّل | `1` يجعل تاريخ الميلاد إلزامياً عند التسجيل |
| `MINORS_PI_KYC` | معطّل | `1` يفعّل إشارة Pi KYC (يستخدم `PI_API_URL` القائم) |
| `MINORS_AUTHORITY_BODIES` | `ncmec,national_hotline,police` | الجهات المسموحة في سجلات الإبلاغ |
| `MINORS_AUTHORITY_CHANNEL` | — | وصف القناة الرسمية التي يسلّم عبرها الفريق يدوياً |
| `MINORS_OPERATOR_CONTACT` | — | جهة اتصال المشغّل في السجل |
| `MINORS_HELPLINES` | الطوارئ 911، مساندة الطفل 116111 | JSON `[{name, number}]` |
| `SAFETY_ALERT_EMAIL` | — | بريد تنبيه للحالات الحرجة (يتطلب `SMTP_URL` القائم) |

## حدود معروفة (صراحةً)

* العمر المُصرَّح به يمكن الكذب فيه؛ الحماية هنا تقلل المخاطر ولا تلغيها. رفع العمر للقاصر مقيَّد بالمراجعة، لكن من يكذب منذ البداية
  يُعامل كبالغ.
* تصنيف الشدة كلمات مفتاحية (heuristic) لترتيب الطابور فقط؛ القرار دائماً بشري. لا يوجد فحص آلي للصور (يمكن ربطه لاحقاً
  عبر المرحلة 31 أو مزود اختياري).
* الخطافات تلفّ معالجات مسارات قائمة ودوال خدمة المحتوى عند التسجيل؛ إن أُعيدت كتابة تلك المسارات يجب إبقاء الخدمة مسجّلة بعدها.
* «لا يُقترح على البالغين» يشمل البحث والاقتراحات والـ bootstrap؛ قوائم أعضاء المجتمعات تبقى كما هي (ليست اقتراحات).
