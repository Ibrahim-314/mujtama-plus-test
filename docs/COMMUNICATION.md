# مجتمع بلس — المسار السادس: التواصل

## المرحلة 26: رسائل متقدمة — والمرحلة 27: تشفير وخصوصية الرسائل

> القسم من فريق «المحادثة والتشفير» (الخادم + `comms-core.js`). الواجهات (`comms-ui.js`) من فريق الواجهة، والاختبارات من فريق الاختبارات.
> المرحلة 30 (المكالمات) لها قسمها الخاص `## المرحلة 30`.

### عقد الواجهة البرمجية (API contract, ثابت)

كل الطلبات تحت `/api`، وتحتاج جلسة (كوكي `mp_session`). الطلبات المغيِّرة تحتاج الترويسة `X-Requested-With: mujtama` (حماية CSRF الحالية). الأخطاء بالشكل `{ error, code }` مع 400/403/404/409/429.

#### كائنات البيانات

```text
Conversation  { id, kind: "dm"|"group", title, owner, e2ee: bool, ttl: seconds, updatedAt,
                state: "accepted"|"request" (حالتي أنا), role: "admin"|"member", members: [userId],
                peer: userId|null (للمحادثة الفردية), last: Message|null, unread: number }
Message       { id, conv, from, kind: "text"|"image"|"voice"|"system", at, replyTo, expiresAt|null,
                deleted: bool,
                // التالي غائب إذا deleted=true
                text,                      // "" في المحادثات المشفرة
                meta?,                     // غير مشفرة: { blob, mime, w, h, duration, wave[≤64, 0..100] }
                                           // مشفرة: { blob } فقط، والباقي داخل النص المشفر
                enc?,                      // Envelope (المحادثات المشفرة)
                plain?: true,              // رسالة غير مشفرة داخل محادثة مشفرة (قديمة أو آلية)
                reactions: [{ emoji, users: [userId] }],
                reply?: { id, from, kind, text, enc, deleted } }
system        kind="system"، meta.event ∈ created | added{users} | removed{users} | left{users} | title{title} | ttl{ttl} | e2ee
Envelope      { v: 1, from: deviceId, iv: b64, ct: b64 (≤900k), keys: { [deviceId]: "b64(iv).b64(wrappedKey)" } (≤64) }
Device        { id: "dk_…", user, name, pub: JWK{kty:"EC",crv:"P-256",x,y}, createdAt, lastSeen, revoked }
People        { id, name, handle, color, avatar }   // تُرفق بالقوائم لعرض أعضاء غير موجودين في DB.users
```

#### المحادثة (`server/services/chat.js`)

| الطريقة والمسار | الجسم أو الاستعلام | النتيجة |
|---|---|---|
| `GET /chat/conversations` | | `{ conversations: Conversation[], people }` (حتى 200، الأحدث أولاً، والطلبات معها بحالة `request`) |
| `POST /conversations` (الموجود) | `{ user }` | `{ conversation: { id, members, request? } }`. يفتح محادثة فردية أو يعيد الموجودة (فردية فقط، لا يرجع مجموعة أبداً) |
| `POST /chat/groups` | `{ title, members: [userId], id? }` | `{ conversation, people, skipped: [userId] }`. الحد 256 مع المنشئ. من لا يقبل رسائلك (الخصوصية أو الحظر) يُتخطى، والغريب يستلمها «طلباً» |
| `GET /chat/conversations/:id` | | `{ conversation: {…, createdAt, members: [{ user, role, state, lastReadAt }]}, people }` |
| `PATCH /chat/conversations/:id` | `{ title? , ttl?: 0/300/3600/86400/604800, role?: { user, role: "admin"/"member" } }` | مثل GET. في المجموعة للمشرفين فقط، وفي الفردية لأي طرف مقبول |
| `POST /chat/conversations/:id/members` | `{ users: [userId] }` | `{ added, skipped }` (للمشرفين) |
| `DELETE /chat/conversations/:id/members/:user` | | `{ ok }`. حذف عضو (مشرف، ولا يُحذف المالك) أو مغادرة (`:user` = أنا). تنتقل الملكية لأقدم مشرف |
| `GET /chat/conversations/:id/messages` | `?before=ISO&limit≤100` | `{ messages: Message[] (تصاعدياً), reads: { userId: lastReadAt }, state, more }` |
| `POST /chat/conversations/:id/messages` | `{ id?, kind?, text?, replyTo?, meta?, enc? }` | `{ message }`. المشفرة تقبل `enc` فقط (`text` يُتجاهل)، ويجب أن يكون `enc.from` جهازاً فعّالاً للمرسل. الرد من طرف «طلب» يقبل الطلب تلقائياً. الغريب يرسل 3 رسائل كحد أقصى حتى القبول |
| `POST /chat/conversations/:id/read` | | `{ ok, at }` (`at=null` إذا كنت في «طلب»، فلا يعلم المرسل بالقراءة) |
| `POST /chat/conversations/:id/typing` | `{ on: bool }` | `{ ok }` (بديل HTTP لإطار WS) |
| `POST /chat/conversations/:id/blobs` | جسم خام ≤ 8MB، `?enc=1` للمشفر | `{ blob: { id, mime, size, enc } }`. غير المشفر يُفحص بالبايتات الأولى: png/jpeg/gif/webp/webm/ogg/m4a/wav. يُرفق مرة واحدة عبر `meta.blob`، والمرفق غير المستخدم يُحذف بعد 24 ساعة |
| `GET /chat/blobs/:id` | | البايتات (`Cache-Control: private`)، للأعضاء فقط |
| `POST /chat/messages/:id/react` | `{ emoji: "❤️"/"😂"/"👍"/"😮"/"😢"/"🙏"/"🔥"/"👏" أو null }` | `{ reactions }`. تفاعل واحد لكل عضو |
| `DELETE /chat/messages/:id` | | `{ ok }`. حذف للجميع: المرسل خلال 48 ساعة، أو مشرف المجموعة. يمسح النص والمرفق والتفاعلات |
| `GET /conversations/requests`، `POST /conversations/:id/accept`، `POST /conversations/:id/decline` (الموجودة) | | طلبات المراسلة |

#### التشفير (`server/services/e2ee.js`)

| الطريقة والمسار | الجسم | النتيجة |
|---|---|---|
| `POST /e2ee/devices` | `{ id: "dk_[a-z0-9]{8,32}", name, pub: JWK }` | `{ device }`. حتى 10 أجهزة. المفتاح العام لا يتغير، والمعرّف الملغى لا يعود. يُرفض أي JWK فيه `d` |
| `GET /e2ee/devices` | | `{ devices }` (أجهزتي، بما فيها الملغاة) |
| `DELETE /e2ee/devices/:id` | | `{ ok }` (إلغاء جهاز) |
| `GET /e2ee/devices/:id` | | `{ device }` (أي جهاز ولو ملغى، لفك رسائل قديمة) |
| `GET /e2ee/keys?users=a,b` | حتى 50 | `{ keys: { userId: Device[] (الفعّالة) } }` |
| `POST /e2ee/conversations/:id/enable` | | `{ ok, e2ee:true }`. للفردية فقط. يلزم جهاز فعّال لكل طرف (وإلا 409). لا رجعة فيه |
| `GET/PUT/DELETE /e2ee/verify/:peer` | PUT: `{ fingerprint: 60 رقماً }` | `{ verification: { fingerprint, at } أو null }` |

#### WebSocket: `GET /api/ws` (RFC 6455، `server/lib/ws.js`)

- المصادقة بكوكي الجلسة، ويلزم أن يطابق `Origin` المضيف (وإلا 403). بلا جلسة 401. الإطار ≤ 256KB، والمعدل 40 إطاراً لكل 5 ثوانٍ (وإلا إغلاق 1008). ping كل 25 ثانية.
- **من الخادم:** `{ type, data }`. كل حدث `realtime.send` القديم يصل أيضاً عبر WS (`notification`، `message`، `changed`، `rtc`…) بالإضافة إلى:
  - `hello` `{ user }` و `pong` `{ at }`
  - `chat` بأنواع `data.type`:
    `message {message}` · `reaction {conv,msg,user,emoji,reactions}` · `delete {conv,msg,by}` · `read {conv,user,at}` · `expired {conv,msgs}` · `conv {conv}` (تغيّر الأعضاء أو الإعدادات أو التشفير، فأعد الجلب) · `keys {user}` (تغيّرت أجهزة مستخدم: حدّث المفاتيح ورمز الأمان)
  - `typing` `{ conv, user, on }`
- **من العميل:** `{ t, … }`: `{t:"ping"}` · `{t:"typing", conv, on}` · `{t:"read", conv}`. أي نوع آخر يذهب لمعالجات `ctx.ws.on`.
- **البديل:** نفس الأحداث بالأسماء نفسها على SSE `GET /api/stream` (`event: chat` و`event: typing`).

#### واجهة الخادم للخدمات الأخرى: `ctx.ws` (لفريق المكالمات وغيره)

```js
ctx.ws.send(userId, type, data)   // → عدد المقابس التي وصلها. يُفضَّل ctx.realtime.send لأنه يغطي SSE وWS معاً
ctx.ws.broadcast(type, data)
ctx.ws.on(type, (user, frame, conn) => { … conn.send({ type, data }) })   // إطارات واردة { t: type, … }
ctx.ws.online(userId)  ctx.ws.count()  ctx.ws.closeAll()
```

`ctx.ws` يُنشأ في server.js مباشرة بعد خدمة messaging، فيمكن لأي خدمة مسجّلة بعدها استدعاء `ctx.ws.on`.

#### أحداث الناقل (bus)

| الحدث | الحمولة |
|---|---|
| `MESSAGE_RECEIVED` | `{ conv, message, from, to: [userId], kind, encrypted, group, title, preview (null إذا مشفرة أو مرفق), request: [userId في حالة طلب] }`، لفريق الإشعارات |
| `MESSAGE_SENT` | `{ conv, actor }` (موجود سابقاً، ويبقى) |
| `MESSAGE_REACTED` | `{ conv, message, actor, owner, emoji }` |
| `MESSAGE_DELETED` | `{ conv, message, actor }` |
| `CHAT_GROUP_CREATED` | `{ conv, actor, members }` |
| `CHAT_MEMBER_ADDED` | `{ conv, actor, user }` |
| `E2EE_DEVICE_ADDED` / `E2EE_DEVICE_REVOKED` | `{ user, device }` |
| `E2EE_ENABLED` | `{ conv, actor }` |

#### العميل: `window.MPComms` (`comms-core.js`، chunk باسم `comms-core`، بلا واجهة)

يُحمَّل عبر `MPChunks.load("comms-core")` في الإنتاج، وكل السكربتات موجودة أصلاً في التطوير. كل الدوال async ما لم يُذكر غير ذلك.

```text
النقل
  connect()                      يفتح WS ويعيد الاتصال بتأخير متزايد، وبعد فشلين متتاليين يتحول إلى SSE (Remote.es أو EventSource خاص)
  disconnect()
  transport()  (sync)            "ws" | "sse" | "off"
  on(type, fn) (sync) → off()    الأنواع: "chat", "typing", "status" ({transport}), والأنواع الفرعية للـ chat مباشرة:
                                 "message", "reaction", "delete", "read", "expired", "conv", "keys"
  typing(conv, on=true)          مخنوقة (مرة كل 3 ث)، عبر WS أو HTTP
المحادثة
  conversations()  conversation(id)  messages(id, {before, limit})
  openDM(userId)                 → conversation (ويفعّل التشفير تلقائياً إذا كان للطرفين أجهزة)
  createGroup(title, members)  addMembers(id, users)  removeMember(id, user)  leave(id)
  update(id, patch)  setTimer(id, ttl)  markRead(id)  react(msgId, emoji|null)  deleteForEveryone(msgId)
  send(conv, { text, kind, replyTo, file: Blob, meta: {w,h,duration,wave} })
                                 conv = كائن Conversation أو id. يشفّر تلقائياً إذا conv.e2ee (النص والمرفق معاً)
  open(message, conv) → message  يفك التشفير: يضيف text وmeta وencrypted:true، أو error:
                                 "no-device" | "not-for-device" | "bad" (لا يرمي استثناء)
  attachmentUrl(message) → blob: URL أو /api/chat/blobs/:id   (يفك المرفق المشفر)
  release(url) (sync)
التشفير  MPComms.e2ee
  ready()                        → device {id, pub}: يولّد زوج ECDH P-256 غير قابل للاستخراج ويحفظه في IndexedDB ويسجّله
  enable(convId)  canEncrypt(userIds)
  keys(userIds, {fresh})         ذاكرة مؤقتة تُفرّغ عند حدث "keys"
  devices()  revoke(deviceId)  thisDevice() (sync)
  safetyNumber(myId, peerId)     → "60 رقماً" ; format(n) (sync) → 12 مجموعة × 5
  verification(peerId)           → { state: "verified"|"changed"|"unverified", number, at }
  verify(peerId)  unverify(peerId)
المؤقت والتجميع (sync)
  TTLS = [{ value, label }]  ttlLabel(sec)  remaining(message) → ms|null
  watchExpiry(messages, onExpire(id)) → cancel()
  group(messages, { gapMs=5min }) → [{ day: "اليوم"|"أمس"|تاريخ, key, clusters: [{ from, at, messages }] }]
  REACTIONS
lib (sync، دوال صرفة للاختبار)
  b64(bytes), unb64(str), safetyDigits(bytes) (يُستخدم أيضاً داخل safetyNumber)، dayKey(iso)
```

### كيف يعمل التشفير

- **مفاتيح الأجهزة:** كل جهاز يولّد زوج ECDH P-256. المفتاح الخاص `CryptoKey` غير قابل للاستخراج ويبقى في IndexedDB (`mp-comms`)، ويُرسل العام فقط.
- **كل رسالة** لها مفتاح AES-GCM-256 عشوائي K. النص المشفر: `AES-GCM(K, iv, JSON{text, kind, meta, file?}, AAD = convId)`.
- **التغليف لكل جهاز:** لكل جهاز فعّال للطرفين، بما فيها أجهزتي الأخرى وجهازي الحالي، يُشتق مفتاح زوجي `HKDF-SHA256(ECDH(خاصي، عامه)، salt="mujtama-e2ee-v1"، info=معرّفا الجهازين مرتبين)`، ثم `AES-GCM(pair, wiv, K, AAD = convId|deviceId)`.
- **المرفقات:** تُشفَّر بمفتاح ملف عشوائي، ويُرفع النص المشفر كـ blob بـ `enc=1`. مفتاح الملف والنوع والأبعاد داخل الرسالة المشفرة، ولا يرى الخادم إلا `meta.blob`.
- **الجهاز الجديد** لا يقرأ رسائل أُرسلت قبل تسجيله، لأنها لم تُغلَّف له (مثل Signal). تظهر عندها «رسالة مشفرة لم تُرسل لهذا الجهاز».
- **رمز الأمان:** لكل مستخدم `SHA-256` مكرر 512 مرة على `("mp-sn-v1" | userId | مفاتيح أجهزته العامة مرتبة)`، تؤخذ أول 30 بايت، وكل 5 بايت تعطي 5 أرقام، فينتج 30 رقماً لكل طرف و60 للاثنين (الأصغر معرّفاً أولاً). الرقم واحد على الجهتين، ويتغير عند إضافة جهاز أو إلغائه، فيظهر حينها «تغيّر رمز الأمان».
- **المجموعات** غير مشفرة طرفاً لطرف. التشفير للمحادثات الخاصة كما ينص الـ roadmap، وتبقى المجموعات محمية بأن الوصول والمرفقات للأعضاء فقط.

### الرسائل المختفية والطلبات والحذف

- **المؤقت** إعداد للمحادثة (5 د، ساعة، يوم، أسبوع). يُحسب `expiresAt` من وقت الإرسال. تُخفى الرسالة فور انتهائها، وتحذف مهمة مجدولة مؤجّرة (`chatExpiry`) الرسائل ومرفقاتها كل 30 ثانية.
- **طلبات المراسلة** تتبع `policy.messageMode` الحالية (الخصوصية والحظر والمتابعة). حتى القبول: 3 رسائل كحد أقصى، ولا تصل للمرسل إيصالات قراءة ولا مؤشر كتابة ولا تفاعلات.
- **الحذف للجميع** يمسح المحتوى نهائياً من الخادم (النص والمغلف والمرفق والتفاعلات)، ويبقى في المحادثة أثر «حُذفت هذه الرسالة».

### متغيرات البيئة

لا متغيرات جديدة للمرحلتين 26 و27.

### ملاحظات للتكامل

- `/api/messages` القديم يرفض النص المكشوف في المحادثات المشفرة. ويعيد `bootstrap` نص الرسائل المشفرة فارغاً، فالواجهة القديمة لا تُستخدم مع الخادم.
- `POST /api/conversations` القديم صار يبحث عن محادثة فردية فقط، وكذلك رسالة الترحيب في growth.js.
- CSP الحالية (`connect-src 'self'`) تسمح بـ ws/wss على المضيف نفسه في المتصفحات الحديثة.
- `comms-core.js` مسجّل في index.html بـ `data-chunk="comms-core"` بعد discovery-ui.js، وغير مسجّل في `chunks.js`. على فريق الواجهة تحميله قبل chunk الواجهة (`MPChunks.load("comms-core").then(() => MPChunks.load("comms"))`)، وإضافة مسارات `messages`/`chat` إلى ROUTES والتحميل المسبق عند الخمول إن لزم. يبدأ `MPComms.connect()` تلقائياً عند تحميله إذا كان المستخدم متصلاً.
- إرسال رسالة يحرّك مؤشر قراءة المرسل إلى لحظة الإرسال، فما قبلها يُحسب مقروءاً.
- اختبارات PostgreSQL: `helpers.js` يحذف schema public لقاعدة `TEST_DATABASE_URL`، فاستخدموا قاعدة مستقلة لكل فريق.

## المرحلة 28: الإشعارات الذكية

### عقد الواجهة البرمجية (للفريقين: الواجهة والاختبارات)

**REST** (كل طلب غير GET يحمل `X-Requested-With: mujtama`، عدا المسارات المعلَّمة «بلا ترويسة»):

| المسار | الوصف | الجسم / الاستجابة |
|---|---|---|
| `GET /api/notifications` | القائمة المسطحة (توافق مع الإصدارات السابقة) | `{ notifications:[{id,user,kind,actor,post,ref,read,at,importance}] }` |
| `GET /api/notifications?view=center&tab=all\|mentions\|follows\|interactions\|communities\|messages\|system&sort=rank\|new&limit=60` | مركز الإشعارات: تجميع + ترتيب | `{ tab, sort, unread, tabs:[{key,label,unread}], groups:[{key,kind,tab,ids[],count,read,at,post,ref,importance,score,important,actors:[{id,name,handle,color,avatar}],names,verb,text,href}] }` |
| `POST /api/notifications/read` | تعليم كمقروء | `{ids:[…]}` أو `{tab}` أو `{}` (الكل) ← `{ok, unread}` |
| `GET /api/notify/settings` | الإعدادات | `{ tabs, kinds:[{kind,label,tab,inapp,push,email,lock:[]}], quiet:{enabled,start:"22:00",end:"07:00",tz,allowUrgent}, emailNotify, push:{publicKey,subscriptions}, email:{address,verified,suppressed,enabled} }` |
| `PUT /api/notify/settings` | حفظ جزئي | `{ channels:{<kind>:{inapp?,push?,email?}}, quiet:{…}, emailNotify }` ← مثل GET. القنوات المقفلة (`lock`) تُتجاهل |
| `GET /api/push/vapid` | المفتاح العام لـ VAPID (بلا دخول) | `{publicKey}` (base64url) |
| `POST /api/push/subscribe` | تسجيل اشتراك المتصفح | `PushSubscription.toJSON()` = `{endpoint, keys:{p256dh,auth}}` ← `{ok, subscriptions}` |
| `POST /api/push/unsubscribe` | إلغاء | `{endpoint}` |
| `POST /api/push/test` | إشعار تجريبي لكل أجهزة المستخدم | `{ok, devices}`، و400 إن لم يوجد اشتراك |
| `GET /api/notify/stats` | للمشرف: التسليمات آخر ٧ أيام، الاشتراكات، الطابور | |

**أنواع الإشعارات** (`kind` ← التبويب): `mention, reply` ← الإشارات · `follow, follow_request, follow_approved` ← المتابعات · `reaction, comment` ← التفاعلات · `join_request, approved, post_approved, invite, community_welcome, mod_warning, mod_digest, event, waitlist_promoted, org_invite` ← المجتمعات · `message, message_request, call, call_missed` ← الرسائل · `security_login, security_password, security_email, removed, video, scheduled, read_later, search_alert, achievement, verified, verification_rejected, welcome` ← النظام. الفهرس الكامل (الأهمية، القنوات الافتراضية، الصياغة العربية) في `server/lib/notify-lib.js` (`KINDS`).

**الوقت الحقيقي** (SSE `/api/stream`، والحدث `notification` موجود من قبل وحمولته موسَّعة):
`event: notification` ← `{ id, user, kind, actor, post, ref, at, read:false, importance, groupKey, text, href, actorInfo:{name,handle,color,avatar}|null }`. يُرسل فقط حين تكون قناة «داخل التطبيق» مفعّلة لهذا النوع.

**رسائل عامل الخدمة إلى الصفحة**: `{type:"mp-push", payload}` حين يصل Push والتطبيق ظاهر ومركَّز (لا يظهر شعار النظام، والواجهة تعرض Toast) · `{type:"mp-push-click", url, nid}` عند لمس شعار الإشعار.
**حمولة Push** (مشفّرة): `{ title, body, tag (=groupKey), url, nid, kind, badge (عدد غير المقروء), ts, renotify }`.

**أحداث الناقل التي تستهلكها خدمة الإشعارات** (لفريق المحادثة والمكالمات): `MESSAGE_SENT {conv, actor}` (يُرسل لأعضاء المحادثة: `message`، أو `message_request` إذا كانت حالة العضو `request`. يُتخطى العضو إن كان في صفه `muted`/`muted_until`) · `MESSAGE_RECEIVED {to|user|recipients, actor|from, conv, request?}` · `MESSAGE_REQUEST {to, actor, conv}` · `CALL_INCOMING {to|recipients, actor|from, call}` (أهمية 100، Urgency high، TTL 60 ث، يتجاوز ساعات الهدوء) · `CALL_MISSED {…}`. يُزال التكرار بين `MESSAGE_SENT` و`MESSAGE_RECEIVED` للمستلم والمحادثة نفسيهما خلال ٣ ثوانٍ. لا يدخل نص الرسالة في أي إشعار، وهذا متوافق مع التشفير طرفاً لطرف.
`ctx.services.messaging.notify(user, kind, {actor, post, ref})` ما زالت تعمل، وهي الآن تفوّض إلى `ctx.services.notify.notify`.

**`window.MPNotify`** (`notify-core.js`، ضمن الحزمة الأساسية، منطق بلا شاشات):
- الأحداث: `on("notification", fn)` (`{source:"stream"|"push", …}`) · `on("unread", fn)` · `on("click", fn)` · `on("push", fn)`. كل `on` تُرجع دالة لإلغاء الاشتراك.
- Push: `pushSupported()` · `permission()` ← `"unsupported"|"needs-install"|"default"|"granted"|"denied"` · `pushState()` ← `{supported, permission, subscribed}` · `enablePush()` (تُستدعى من لمسة المستخدم) ← `{ok, reason?, subscriptions?}` · `disablePush()` · `testPush()` · `resync()`.
- المركز: `center({tab, sort, limit})` · `list()` · `markRead({ids}|{tab}|{})`.
- الإعدادات: `settings()` · `saveSettings(patch)` · `setChannel(kind, "inapp"|"push"|"email", on)` · `setQuiet({enabled,start,end,tz?,allowUrgent?})` (المنطقة الافتراضية من المتصفح).
- البريد والحساب: `emailPrefs()` · `saveEmailPrefs(patch)` · `accountEmail()` · `setEmail(email, password?)` · `resendVerification()` · `forgotPassword(login)` · `resetPassword(token, password)` · `changePassword(current, password)` · `hashParam(k)` (مثل `t` في `#/reset?t=…`، و`verified` في `#/emailprefs?verified=1`).
- مسارات الواجهة المتوقعة (يبنيها فريق الواجهة): `#/notifications` · `#/notifsettings` · `#/emailprefs` · `#/reset?t=…`. روابط البريد تشير إلى `#/emailprefs` و`#/reset`.

### التنفيذ
1. **Push على الويب والجوال**: `server/lib/webpush.js` بلا أي اعتماديات. تشفير RFC 8291 بترميز `aes128gcm` (RFC 8188)، يطابق متجه الاختبار في RFC 8291 §5 بايتاً ببايت، مع VAPID (RFC 8292) بتوقيع ES256 (`ieee-p1363`). ترويسات TTL وUrgency وTopic. الردّان 404/410 يحذفان الاشتراك. في الإنتاج لا تُقبل إلا نقاط نهاية https لخدمات Push معروفة (FCM، Mozilla، Apple، WNS) أو `PUSH_ALLOWED_HOSTS`، حماية من SSRF. عامل الخدمة `sw.js` يعالج `push` و`notificationclick` و`pushsubscriptionchange` وشارة التطبيق (`setAppBadge`). iOS ≥ 16.4 يدعم Push بعد إضافة التطبيق إلى الشاشة الرئيسية (`permission()` تُرجع `needs-install`).
2. **التجميع**: مفتاح المجموعة = النوع + الهدف (المنشور أو المرجع، و«أنا» للمتابعات)، ضمن نافذة ٤٨ ساعة، وبحالة القراءة نفسها. صياغة عربية بالعدد: «أحمد» · «أحمد وسارة» · «أحمد وشخصان آخران» · «أحمد و5 آخرون» · «أحمد و12 شخصاً آخر»، مع فعل بالمفرد أو المثنى أو الجمع («أعجبه/أعجبهما/أعجبهم منشورك»). في Push يحمل الإشعار `tag` = مفتاح المجموعة، فيستبدل النظام الشعار السابق بالنص المجمَّع الجديد.
3. **ساعات الهدوء**: تُحسب بالمنطقة الزمنية للمستخدم (`Intl`)، وتدعم النوافذ التي تعبر منتصف الليل. يُؤجَّل Push إلى نهاية النافذة ولا يُحذف، ويُعاد الفحص لحظة التسليم. الأنواع العاجلة (أهمية ≥ 90: الأمان والمكالمات) تتجاوزها ما لم يعطّل المستخدم `allowUrgent`. الإشعار داخل التطبيق لا يتأثر.
4. **إعدادات دقيقة**: داخل التطبيق / Push / البريد لكل نوع، مع قيم افتراضية لكل نوع. قنوات الأمان (داخل التطبيق والبريد) مقفلة. الإعداد القديم `prefs.settings.notify[kind] === false` ما زال يعني «إيقاف كامل».
5. **الترتيب حسب الأهمية**: أهمية عند الكتابة = أساس النوع + العلاقة (متابَع +10، متبادل +15، موثَّق +5). نقاط عند القراءة = أهمية + 25 لغير المقروء + حجم المجموعة − تقادم (1.5 لكل ساعة، بحد أقصى 40، ولا تقادم للعاجل). `sort=new` للترتيب الزمني.
6. **خدمة بطابور وإعادة محاولة**: `server/services/notify.js`. الصف داخل التطبيق والحدث الحي يُكتبان فوراً، أما Push والبريد فمهام `notify.push` و`notify.email` في `lib/queue.js` (إعادة المحاولة بتراجع أُسّي حتى 4 محاولات، تصمد بعد إعادة التشغيل، وتتوزع على عدة `worker.js`). 429/5xx يُعاد، و4xx الأخرى فشل نهائي. كل تسليم مسجَّل في `notify_deliveries` (queued/deferred/sent/skipped/gone/failed/retrying). بريد الإشعار يُؤجَّل `NOTIFY_EMAIL_DELAY_MS` (افتراضياً 5 دقائق) ويُلغى إن قُرئ الإشعار قبلها. Push لا يُرسل إن قُرئ الإشعار.
7. **مركز الإشعارات** و8. **إشعارات داخل التطبيق**: الخادم يوفّر التبويبات والعدادات والمجموعات (`view=center`) والحدث الحي، و`MPNotify` يوفّر المنطق، والشاشات من فريق الواجهة (`notify-ui.js`).

## المرحلة 29: البريد والتواصل الخارجي

### عقد الواجهة البرمجية

| المسار | الوصف |
|---|---|
| `GET/PUT /api/account/email` | `{email, password?}` (كلمة المرور مطلوبة لتغيير بريد مؤكد) ← `{email, verified, suppressed, mailEnabled}`. يرسل رابط تأكيد، وتنبيهاً أمنياً إلى البريد القديم |
| `POST /api/account/email/resend` | إعادة إرسال رابط التأكيد (3 مرات في الساعة) |
| `GET /api/email/verify?t=` | يؤكد البريد ثم يحوّل (302) إلى `/#/emailprefs?verified=1\|0` |
| `POST /api/auth/forgot` | `{login}` (اسم المستخدم أو البريد) ← دائماً `{ok:true, message}`، فلا يمكن معرفة وجود الحساب من الرد. الرابط `/#/reset?t=…` صالح لساعة ويُستخدم مرة واحدة |
| `POST /api/auth/reset` | `{token, password}` ← يغيّر كلمة المرور، ويسجّل الخروج من كل الجلسات، ويرسل تنبيهاً أمنياً |
| `POST /api/account/password` | `{current, password}` ← يُبقي الجلسة الحالية فقط، ويرسل تنبيهاً أمنياً |
| `GET/PUT /api/email/prefs` | `{email, verified, suppressed, mailEnabled, weekly, weeklyEmail, notifyEmails, kinds:[{kind,label,tab,email,locked}]}`. يقبل PUT: `{weekly?, notifyEmails?, kinds?:{<kind>:bool}, resubscribe?}` |
| `GET /api/email/unsubscribe?t=` | صفحة RTL للتأكيد (لا تلغي الاشتراك، حماية من ماسحات الروابط) |
| `POST /api/email/unsubscribe?t=` | بلا ترويسة. إلغاء بنقرة حسب RFC 8058 (`List-Unsubscribe=One-Click`) ← JSON، أو صفحة HTML إن كان `Accept: text/html` |
| `POST /api/email/events` | بلا ترويسة. Webhook لأحداث المزوّد. التوثيق بـ `X-Webhook-Signature: sha256=<HMAC-SHA256(body, MAIL_WEBHOOK_SECRET)>` أو `?token=<MAIL_WEBHOOK_SECRET>`. يقبل SES (مباشرة أو عبر غلاف SNS)، وPostmark، وSendGrid/Mailgun، والصيغة العامة `{type:"delivered"\|"bounce"\|"complaint"\|"deferred"\|"dropped", email, messageId, hard?, reason?}` (أو مصفوفة منها، أو `{events:[…]}`) |
| `GET /api/email/suppressions` · `DELETE /api/email/suppressions/:email` | للمشرف |
| `GET /api/email/status` | للمشرف: الناقل، وسجلات DKIM/SPF/DMARC المطلوبة، وحالة الـ Webhook، وإحصاء ٧ أيام |

### التنفيذ
1. **بريد المعاملات**: تأكيد البريد، واستعادة كلمة المرور، وتنبيهات الأمان (دخول من جهاز جديد، تغيير كلمة المرور، تغيير البريد) في `server/services/mail.js`. يُرسل عبر الطابور (`mail.send`) مع إعادة المحاولة. الرموز عشوائية (32 بايت) ويُخزَّن تجزيئها فقط في `email_tokens`.
2. **الملخص الأسبوعي**: امتداد لـ `services/summaries.js` نفسه وليس نسخة ثانية. يُرسَم بقالب البريد المشترك، ويُرسل عبر `mail.sendWeekly`، فيحصل على إلغاء الاشتراك بنقرة وفحص قائمة الحظر والسجل وتوقيع DKIM. البريد المؤكد للحساب هو الافتراضي حين لا يُحدَّد بريد للنشرة.
3. **إلغاء الاشتراك بنقرة**: ترويستا `List-Unsubscribe` و`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058، ومتطلبات Gmail وYahoo للمرسلين بكميات كبيرة) على كل بريد غير معاملاتي، مع رابط ظاهر في التذييل. الرمز موقَّع بـ HMAC-SHA256 (`MAIL_TOKEN_SECRET`، أو سرّ يُولَّد ويُحفظ)، ومربوط بالمستخدم والعنوان والفئة: `weekly` · `notify` · `notify:<kind>` · `all`. رسائل الأمان والاستعادة لا تُلغى.
4. **مزوّد البريد مع SPF وDKIM وDMARC**: المرسل SMTP الحالي (`SMTP_URL`) يعمل مع أي مزوّد (SES، Postmark، SendGrid، Mailgun، أو خادم خاص). توقيع **DKIM** بـ `rsa-sha256` و`c=relaxed/relaxed` في `server/lib/dkim.js`، ويوقّع From وTo وSubject وDate وMessage-ID وMIME-Version وContent-Type وList-Unsubscribe وList-Unsubscribe-Post. Message-ID على نطاق الإرسال (يُعاد لتتبع التسليم)، واسم المرسل العربي مرمَّز بـ RFC 2047. توليد المفتاح: `node server/scripts/dkim-keygen.js mp1 mujtama.plus`.

   سجلات DNS (مثال للنطاق `mujtama.plus`، والمحدد `mp1`):
   ```
   mujtama.plus.                 TXT  "v=spf1 include:<نطاق SPF لمزوّدك، مثل amazonses.com> -all"
   mp1._domainkey.mujtama.plus.  TXT  "v=DKIM1; k=rsa; p=<المفتاح العام من dkim-keygen أو /api/email/status>"
   _dmarc.mujtama.plus.          TXT  "v=DMARC1; p=quarantine; rua=mailto:dmarc@mujtama.plus; adkim=s; aspf=s; pct=100"
   ```
   ابدأ DMARC بـ `p=none` أسبوعاً لمراقبة التقارير، ثم `quarantine`، ثم `reject`. إذا كان المزوّد يوقّع بنطاقه، يجب أن يتطابق نطاق From مع `d=` لتطابق DKIM الصارم (`adkim=s`). عيّن `SMTP_ENVELOPE_FROM` على نطاق فرعي يملكه المزوّد إن احتاج المرتدّ (Return-Path) ذلك.
5. **قوالب بريد عربية**: `server/lib/email-templates.js`، وفيها `verify` و`reset` و`security` و`notification` و`weekly`، وصفحة الهبوط `page`. لكل قالب `subject` و`preheader` و`html` و`text`.
6. **تتبع التسليم والارتداد**: `email_log` (queued/sent/delivered/bounced/soft_bounced/complained/suppressed/skipped/unsubscribed) مربوط بـ Message-ID. الارتداد الدائم والإسقاط يذهبان إلى قائمة الحظر `email_suppressions` (`hard_bounce`) ويوقفان كل الرسائل. الشكوى توقف غير المعاملاتي. خمس ارتدادات مؤقتة تتحول إلى `soft_bounce`، والتسليم الناجح يصفّر العداد. رفض SMTP بـ 55x أثناء الإرسال يُعامل ارتداداً دائماً فوراً. تأكيد اشتراك SNS يدوي من لوحة AWS (لا نجلب `SubscribeURL`، حماية من SSRF).
7. **تصميم متجاوب RTL**: تخطيط جداول مع CSS مضمَّن، و`dir="rtl"` على المستند والجداول، وعرض 560px يتحول إلى 100% تحت 600px، ووضع داكن بـ `prefers-color-scheme`، وزر بخلفية `bgcolor` لـ Outlook، ونص مخفي للمعاينة، وخطوط نظام عربية.
8. **صفحة تفضيلات البريد**: الواجهة البرمجية `GET/PUT /api/email/prefs` و`MPNotify.emailPrefs()`، والشاشة من فريق الواجهة (`#/emailprefs`).

### متغيرات البيئة الجديدة
`VAPID_PUBLIC_KEY` و`VAPID_PRIVATE_KEY` (base64url، كلاهما يقبل `_FILE`، وإن غابا تُولَّد مفاتيح وتُحفظ في `notify_keys`) · `VAPID_SUBJECT` (`mailto:` أو https) · `PUSH_ALLOWED_HOSTS` · `NOTIFY_EMAIL_DELAY_MS` · `DKIM_PRIVATE_KEY` (أو `_FILE`) و`DKIM_SELECTOR` و`DKIM_DOMAIN` · `MAIL_TOKEN_SECRET` · `MAIL_WEBHOOK_SECRET` · `SMTP_ENVELOPE_FROM` · `PUBLIC_ORIGIN` (مستخدم من قبل، ومطلوب في الإنتاج لروابط البريد المطلقة) · `SPF_HINT` (للعرض فقط).

### الترحيل
`011_notify`: يضيف الأعمدة `notifications.importance` و`group_key` و`users.email` و`email_verified_at`، والجداول `push_subscriptions` و`notify_settings` و`notify_deliveries` و`email_tokens` و`email_log` و`email_suppressions` و`notify_keys`. قابل للتراجع.

## المرحلة 30: المكالمات

مكالمات صوتية ومرئية فردية وجماعية (حتى **8** مشاركين) عبر شبكة WebRTC مباشرة (mesh)، مع مشاركة الشاشة، وTURN/STUN ذاتي الاستضافة، وجودة تتكيف مع الشبكة. الخادم يدير دورة حياة المكالمة ويمرّر الإشارات فقط، أما الوسائط فلا تمرّ عبره.

| الملف | الدور |
|---|---|
| `server/services/calls.js` | دورة الحياة، الخصوصية، الإشارات، بيانات TURN، السجل، مهمة `callSweep` |
| `server/migrations/012_calls.js` | الجدولان `call_sessions` و`call_participants` |
| `calls-core.js` (chunk `calls`) | محرك العميل بلا واجهات: `window.MPCalls` |
| `calls-ui.js` (chunk `callsui`) | واجهة المكالمة وصورة داخل صورة، يبنيها فريق الواجهة على `MPCalls` |
| `docker-compose.yml` → `coturn` | خادم TURN/STUN |

### حالات المكالمة
- **المكالمة:** `ringing → active → ended`. سبب الانتهاء `endReason` أحد: `completed` · `missed` · `declined` · `busy` · `cancelled`.
- **المشارك:**
  - `ringing → joined | declined | missed | busy | left`
  - `joined → left`
  - `left | declined | missed | busy → joined` (إعادة الانضمام لمكالمة جماعية جارية) أو `ringing` (إعادة الدعوة)
- **قواعد الحسم** (الدالة `decide`):
  - في حالة الرنين: تصبح المكالمة نشطة بمجرد انضمام شخصين. إن غادر المضيف قبل الرد تنتهي بسبب `cancelled`. إن لم يبقَ أحد يرنّ تنتهي بسبب `declined` أو `busy` أو `missed`.
  - في المكالمة النشطة: تنتهي (`completed`) حين لا يبقى أحد، أو يبقى شخص واحد ولا أحد يرنّ. في المكالمة الجماعية لا يُنهيها خروج المضيف.
- **الرنين:** مدته `CALL_RING_SECONDS` (الافتراضي 35 ث)، ثم تصبح حالة المدعو `missed`.
- **النبض:** إن لم يصل نبض من مشارك خلال `CALL_STALE_SECONDS` (الافتراضي 45 ث) تُحسب حالته `left`. تتحقق من ذلك مهمة مؤجَّرة كل 5 ث.
- **الانشغال:** من يرنّ له هاتف أو هو في مكالمة أخرى يُسجَّل `busy`. المكالمة الفردية لمشغول تنتهي فوراً بسبب `busy`. وقبول مكالمة جديدة يُخرجك من المكالمة السابقة.

### الخصوصية
لا يرنّ لك إلا من يُسمح له بمراسلتك، بأحد ثلاثة شروط:
1. `policy.messageMode` تعطي `inbox`.
2. أو بينكما محادثة قبلتها أنت (`state='accepted'`)؛ أي أن طلب المراسلة المعلّق **لا** يكفي للرنين.
3. أو المكالمة تُبدأ من محادثة (`conv`) وأنتما عضوان مقبولان فيها.

الحظر يقطع الاتصال في الاتجاهين.

### واجهة الخادم (كلها تتطلب تسجيل الدخول، وكل طلب غير GET يحمل `X-Requested-With: mujtama`)
| الطلب | الجسم | الرد |
|---|---|---|
| `GET /api/calls/ice` | — | `{ iceServers, iceTransportPolicy, turn, ttl, expiresAt }` |
| `POST /api/calls` | `{ to?: userId, users?: userId[], conv?: convId, kind: "voice"\|"video" }`. بدون `to`/`users` مع `conv` يُدعى كل الأعضاء المقبولين ويُتخطّى المحظورون بصمت | حالة المكالمة `CallState`؛ قد تأتي `ended/busy` فوراً. الأخطاء: 400 بلا مدعوين أو أكثر من 8 · 403 خصوصية/حظر · 409 أنت في مكالمة · 429 أكثر من 10 مكالمات في الدقيقة |
| `GET /api/calls/active` | — | `{ active: CallState\|null }`: مكالمة ترنّ لك أو أنت فيها، للاستئناف بعد تحميل الصفحة |
| `GET /api/calls/:id` | — | `CallState` (للمشاركين فقط) |
| `POST /api/calls/:id/accept` | `{ camera?: bool }` | `CallState`. يرجع 409 إن لم تعد ترنّ |
| `POST /api/calls/:id/join` | `{ camera?: bool }` | إعادة انضمام لمكالمة جماعية نشطة |
| `POST /api/calls/:id/decline` | — | `CallState` |
| `POST /api/calls/:id/hangup` | — | `CallState`. للمدعو = رفض، وللمضيف أثناء الرنين = إلغاء. يقبل `sendBeacon` |
| `POST /api/calls/:id/invite` | `{ users: userId[] }` | لمشارك منضم فقط: يحوّل المكالمة إلى `group` ويعيد الرنين لمن غادر أو فاتته |
| `POST /api/calls/:id/signal` | `{ to, data: { sdp? , ice?: candidate[], sid } }` | `{ ok }`. الطرفان منضمّان. الحد 64KB لكل رسالة و900 رسالة في الدقيقة |
| `POST /api/calls/:id/media` | `{ mic?, camera?, screen? }` | `CallState` يُبَث للجميع |
| `POST /api/calls/:id/stats` | `{ level: "high"\|"medium"\|"low"\|"audio", rtt, loss, kbps }` | `{ ok, callStatus, state }`. هذا هو النبض (كل نحو 6 ث)، ويُبث `call_quality` عند تغيّر المستوى |
| `GET /api/calls?limit=&before=` | — | `{ calls: [{ id, kind, mode, conv, status, endReason, direction: "incoming"\|"outgoing", myState, missed, seen, at, answeredAt, endedAt, duration, participants[] }], unseenMissed, next }` |
| `POST /api/calls/seen` | — | يصفّر عدّاد الفائتة |
| `DELETE /api/calls/:id` | — | يُخفي المكالمة من سجلك |

**شكل `CallState`:**
- `call`: `{ id, kind, mode: "direct"|"group", conv, host, status, endReason, createdAt, answeredAt, endedAt, duration, ringMs }`
- `participants`: قائمة من `{ id, name, handle, avatar, color, verified, role: "host"|"guest", state, invitedAt, joinedAt, leftAt, mic, camera, screen, quality }`

### رسائل الإشارة (من الخادم إلى العميل)
تُرسَل عبر `ctx.realtime`، فتصل عبر SSE (`/api/stream`) وعبر WebSocket (`/api/ws`) معاً. كل رسالة تحمل `_e` (رقماً تسلسلياً) لإزالة التكرار.
- `call` ← `CallState` كاملة عند كل تغيير، لكل المشاركين، بمن فيهم من يرنّ لهم.
- `call_signal` ← `{ call, from, data: { sdp?, ice?, sid } }`. قيمة `sid` هي `joinedAt` للمرسل؛ تغيّرها يعني جلسة جديدة فيُعاد إنشاء الاتصال.
- `call_quality` ← `{ call, user, level, rtt, loss }`.
- عبر WebSocket يمكن أيضاً **إرسال** `{ t: "call_signal", call, to, data }` بالقواعد نفسها. لاحظ أن حد WS هو 40 رسالة لكل 5 ث، لذلك يرسل المحرك عبر POST افتراضياً ويجمّع مرشحي ICE كل 120 ms.

### أحداث الناقل (bus)
- `CALL_INCOMING { call, to, from, kind, mode, conv, online, at }`: لكل مدعو، ويستخدمها الإشعار والدفع.
- `CALL_MISSED { call, user, from, kind, mode, conv, reason: "timeout"|"busy"|"cancelled"|…, at }`.
- `CALL_ENDED { call, host, kind, mode, reason, duration, participants, at }`.

### TURN/STUN
- **بيانات الدخول:** حسب مواصفة coturn REST (`use-auth-secret`):
  - `username = "<expiry>:<userId>"`
  - `credential = base64(HMAC-SHA1(TURN_SECRET, username))`
- **متغيرات البيئة:**
  - `TURN_URLS`: قائمة مفصولة بفواصل، مثل `turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp`.
  - `TURN_SECRET`: يقبل `_FILE`.
  - `TURN_TTL`: الافتراضي 86400.
  - `STUN_URLS`: الافتراضي STUN عام من Google وCloudflare.
  - `CALL_FORCE_RELAY=1`: يفرض `iceTransportPolicy: "relay"`.
  - متوافق مع الإعداد القديم `TURN_URL`/`TURN_USER`/`TURN_PASSWORD`.
- **في docker-compose:** خدمة `coturn` تشارك السر `turn_secret` مع `app`. أضف `TURN_REALM` و`TURN_EXTERNAL_IP`، وافتح منافذ الترحيل `49160–49200/udp`.
- **إعدادات أخرى:** `CALL_RING_SECONDS` و`CALL_STALE_SECONDS`. وللاختبارات: `createApp({ callRingMs, callStaleMs, callSweepMs })`.

### محرك العميل `window.MPCalls` (بلا واجهات)
**الحالات:** `idle → outgoing | incoming → connecting → active ⇄ reconnecting → ended`. تُنقل من `ended` إلى `idle` تلقائياً عند بدء مكالمة جديدة، أو بـ`reset()`.

| الخاصية / الدالة | الوصف |
|---|---|
| `state` · `call` · `endReason` · `media` `{mic,camera,screen}` · `level` · `speaker` · `local` · `screenTrack` · `supports` `{webrtc,screen,videoPip,docPip,sinkId}` | قراءة فقط |
| `start({ to \| users \| conv, kind })` | يطلب الميكروفون والكاميرا ثم `POST /api/calls`. أخطاؤه: `offline` · `unsupported` · `busy` · أخطاء الخادم |
| `accept({ camera })` · `decline()` · `hangup()` · `join(callId, { camera })` · `invite(userIds)` | — |
| `setMic(bool)` · `setCamera(bool)` · `switchCamera()` · `startScreen()` · `stopScreen()` | تبديل المسار بلا إعادة تفاوض |
| `peers()` → `[{ id, stream, connection, level, quality, audio, video }]` · `stream(userId)` | البثّ المحلي للمستخدم نفسه |
| `history({ limit, before })` · `markSeen()` · `remove(id)` | السجل |
| `on(type, fn)` → `unsubscribe` · `off()` | الأحداث متاحة أيضاً بصيغة `window` `"mpcalls:<type>"` |
| `handle(type, data)` · `attachStream(es)` · `resume()` · `refresh()` · `debug()` | للربط والاختبار |
| `lib` | السياسات النقية، وتُصدَّر أيضاً بـ`require("./calls-core.js")` في Node |

**الأحداث:**
- `state` `{state, prev, call, reason?}`
- `incoming` `{call}` · `waiting` `{call}` (مكالمة ثانية أثناء مكالمة)
- `call` `{call}` (كل تحديث من الخادم)
- `local` `{stream, mic, camera, screen}`
- `peer` (عند تغيّر الاتصال أو المسار) · `peer-left` `{id}`
- `media` · `screen` `{on}`
- `quality` `{id, level, rtt, loss, kbps, videoPaused?, self}`
- `remote-quality` `{id, level, …}`
- `speaker` `{id}` (المتحدث النشط حسب `audioLevel`)
- `ended` `{reason, call}`. السبب: سبب الخادم أو `hangup` · `declined` · `left` · `elsewhere` (رُدّ عليها من جهاز آخر) · `failed`
- `error` `{code: "mic"|"camera"|"screen", message}`
- `ready`

**الشبكة (mesh):**
- اتصال `RTCPeerConnection` لكل نظير. يعرض الاتصالَ الأحدثُ انضماماً (`lib.shouldOffer`)، ويُحسم التعادل بالمعرّف.
- التفاوض بنمط perfect negotiation.
- كل اتصال يحمل مُرسِل صوت وفيديو منذ البداية، فالكتم والكاميرا ومشاركة الشاشة تتم بـ`replaceTrack` دون إعادة تفاوض.
- `restartIce()` عند الفشل، أو بعد انقطاع يدوم 4 ث.

**الجودة المتكيفة:**
- يقرأ `getStats()` كل 2 ث: `currentRoundTripTime` و`availableOutgoingBitrate` و`fractionLost` وفقد الحزم الواردة و`qualityLimitationReason`.
- `lib.classify` تحدد المستوى: `audio` إذا الفقد > 15٪ أو RTT > 1 ث أو العرض < 120kbps، ثم `low` ثم `medium` ثم `high`.
- `lib.adapt`: ينزل المستوى فوراً، ويصعد درجة بعد 3 عيّنات جيدة.
- `lib.encodingFor` تضبط `maxBitrate` و`scaleResolutionDownBy` و`maxFramerate`:
  - تُقسَم سعة الرفع على الاتصالات.
  - من 4 مشاركين فأكثر لا يُرسَل 720p.
  - الفيديو يتوقف في مستوى `audio`.
  - الشاشة تحافظ على الدقة وتخفّض عدد الإطارات.
- الصوت 32kbps، أو 16kbps في المستويين `low` و`audio`.

**التحميل:** chunk `calls` يُحمَّل مبكراً (في وقت الخمول، بحد 1.5 ث) حتى يكون جاهزاً قبل أول رنين، ثم يُحمَّل `callsui`. المسار `#/calls` ينتظر الاثنين. على فريق الواجهة إضافة `<script src="calls-ui.js" data-chunk="callsui"></script>` **بعد** `calls-core.js`.
