# MJT – Mujtama Token: ملف التصميم (المرحلة 7)

> **مسودة داخلية — غير معتمدة وليست إعلانًا للأعضاء.**
> هذه الوثائق تحليل وتصميم فقط. لم يُنشأ أي توكن، ولم يُكتب أو يُنشر أي عقد ذكي، ولم تُنفَّذ أي معاملة على Pi Mainnet أو Testnet، ولم يتغيّر أي سلوك في التطبيق أو في نظام MJT الداخلي. لا سعر، ولا وعد بتحويل، ولا وعد بعائد.

**الموقف الرسمي المعتمد في كل الوثائق: «مكافآت الآن، وتوكن مستقبلًا».**

- اليوم: MJT (واسمه داخل التطبيق «مجتمع كوين — Mujtama Coin») **رصيد مكافآت داخلي فقط**: ليس عملة على أي بلوكشين، لا سعر تداول له، لا يُسحب ولا يُباع، ولا يوجد أي وعد بتحويل الأرصدة.
- أي توكن مستقبلي على Pi Mainnet سيكون **منفصلًا تمامًا** عن الرصيد الداخلي.
- **الأرصدة الداخلية ليست التزامًا ماليًا على المشروع** ولا تُعامَل كدَين أو مطالبة.

الإصدار المرجعي للكود: `main` عند `57dccf6` (v2.163.0). تاريخ جمع المصادر الرسمية: **2026-11-25**.

---

## الوثائق وكيف ترتبط

| الملف | المحتوى في سطر |
|---|---|
| [01-MJT-Whitepaper.md](01-MJT-Whitepaper.md) | الورقة البيضاء الداخلية: المشكلة، الوضع الحالي للاقتصاد الداخلي (من الكود)، ما تسمح به Pi اليوم، والمسار المقترح. |
| [02-MJT-Tokenomics.md](02-MJT-Tokenomics.md) | خيارات المعروض (ثابت / قابل للتحكم بقواعد)، الخيار الموصى به، طريقة حساب المعروض بدل رقم اعتباطي، قواعد الإصدار، الحرق، ونتائج نموذج السيناريوهات. |
| [03-MJT-Technical-Architecture.md](03-MJT-Technical-Architecture.md) | آلية الإنشاء كما توثّقها Pi (Issuer/Distributor/Trustline/pi.toml)، إدارة المعروض، المحافظ، التحقق من المعاملات، الأمان، والتكامل مع مجتمع بلس مع بقاء الدفتر الداخلي منفصلًا. |
| [04-MJT-Distribution-Model.md](04-MJT-Distribution-Model.md) | فئات التوزيع بنطاقات مئوية مع المبرر والاستحقاق والجدول ومخاطر التركّز؛ وما لا توجد عنه بيانات (مستثمرون/شركاء/فريق). |
| [05-MJT-Security-Framework.md](05-MJT-Security-Framework.md) | سجل المخاطر (العقد، المحافظ، مفتاح الإصدار، التوزيع، التركّز، التلاعب، ضعف المنفعة، التنظيم، الاعتماد الخارجي) والضوابط لكلٍّ منها. |
| [06-MJT-Governance-Model.md](06-MJT-Governance-Model.md) | صلاحيات الإدارة، الخزينة، ضبط الإصدار، الشفافية، آلية القرار، ودور المجتمع (استشاري؛ التصويت لا يمنح حقوق ملكية أو حقوقًا قانونية). |
| [07-MJT-Migration-Policy.md](07-MJT-Migration-Policy.md) | السيناريوهات الثلاثة للعلاقة بين الرصيد الداخلي وأي توكن مستقبلي: المزايا والمخاطر والمتطلبات والأثر. بلا نسبة تحويل وبلا وعد. |
| [08-MJT-Launch-Readiness.md](08-MJT-Launch-Readiness.md) | قائمة الجاهزية والتوصية الصريحة: **لا ننتقل الآن إلى مرحلة جاهزية الإطلاق**، وما يجب أن يتحقق أولًا. |
| [09-MJT-Compliance.md](09-MJT-Compliance.md) | اعتبارات تنظيمية (السعودية: CMA/SAMA/وزارة المالية، PDPL؛ الاتحاد الأوروبي MiCA؛ الولايات المتحدة SEC)، طبيعة التوكن، الإفصاح، حماية المستخدم، AML، وشروط Pi. بلا أحكام قانونية نهائية. |
| [10-MJT-Utility-Design.md](10-MJT-Utility-Design.md) | الاستخدامات المستقبلية المبنية على خدمات موجودة فعلًا (Studio الممتد، الدورات المدفوعة) مع مبدأ: امتلاك التوكن لا يحجب أي حق أو خدمة أساسية. |
| [model/mjt_scenarios.py](model/mjt_scenarios.py) | نموذج الاستدامة (Python) بمدخلات مطابقة لتصدير لوحة «اقتصاد MJT»، ومخرجاته في `model/output/`. |

**ترتيب القراءة المقترح:** 01 ← 08 (الخلاصة والتوصية) ← 02 و04 ← 03 و05 ← 06 و07 ← 09 ← 10.

**كيف ترتبط:** 01 يحدد الإطار والحقائق. 02 يحدد قواعد المعروض والإصدار، و04 يقسّمه، و10 يبرّر وجوده بالمنفعة. 03 يصف كيف يُنفَّذ ذلك تقنيًا بحدود ما تؤكده Pi، و05 يضع الضوابط عليه، و06 يحدد من يقرر. 07 يحمي الفصل بين الرصيد الداخلي والتوكن. 09 يضع الحدود القانونية. 08 يجمع كل ذلك في قرار: هل نحن جاهزون؟ (الجواب: ليس بعد).

---

## تقسيم المحتوى في كل وثيقة

كل وثيقة تفصل بين أربعة أقسام:
1. **المعلومات المؤكدة** — من الكود (مع اسم الملف) أو من مصدر رسمي (مع الرابط وتاريخ الجلب).
2. **الافتراضات** — كل رقم أو سلوك غير مُقاس، موسوم «افتراضي».
3. **التوصيات** — رأي فريق التصميم، قابل للنقاش.
4. **قرارات تحتاج موافقة صاحب المشروع** — لا يُنفَّذ شيء منها دون موافقة صريحة.

---

## البيانات: ما هو حقيقي وما هو مفترض

- **حقائق الكود** (حقيقية): مأخوذة من `server/services/mjt.js`, `mining.js`, `mjt-rewards.js`, `mjt-services.js`, `mjt-economy.js`, `mjt-legacy.js`, `server/lib/mjt-ledger.js` عند `57dccf6`.
- **أرقام الإنتاج** (غير متاحة): عدد الأعضاء النشطين، الإصدار الفعلي، الأرصدة، التركّز — موجودة في قاعدة بيانات Render وتحتاج جلسة مدير. Hark لا يملك جلسة مدير، ولا توجد نقطة إحصاءات عامة (نقطة الصحة العامة `https://mujtama-plus-test.onrender.com/api/health` تُرجع الإصدار فقط: `"version":"2.163.0"`، تم التحقق 2026-11-25).
- لذلك نموذج السيناريوهات يعمل حاليًا على **خط أساس افتراضي** موسوم بوضوح.

### ما يجب على صاحب المشروع فعله لتحويل النموذج إلى بيانات حقيقية
1. افتح `#/admin/mjt-economy` واختر الفترة **شهري**.
2. صدّر ثلاثة جداول CSV: `summary` و`legacy` و`flows` (نفس `GET /api/admin/mjt/economy/export.csv?table=<name>&period=month`).
3. ضعها في مجلد واحد وشغّل:
   `python3 docs/mjt-token/model/mjt_scenarios.py --data <المجلد>`
4. تُكتب النتائج في `docs/mjt-token/model/output/` موسومة «REAL EXPORT». لا تُرفع ملفات التصدير نفسها إلى المستودع (المستودع عام).

---

## المصادر الرسمية المستخدمة (جُلبت جميعها في 2026-11-25)

### Pi Network
| رمز | المصدر | ما يؤكده |
|---|---|---|
| P1 | [Pi Docs — Tokens](https://developers.minepi.com/docs/use-native-features/Tokens) | «This document explains how to create a token on Pi **Testnet**»: محفظتا Issuer وDistributor، Trustline، الإصدار عبر عملية Payment، `home_domain` و`/.well-known/pi.toml`، التوزيع بالدفع المباشر أو Liquidity Pool، والتوصية بأفضل ممارسات Stellar لتحديد الحد الأقصى للمعروض وقفل حساب الإصدار. |
| P2 | [Pi Blog — DEX, AMM, Token Creation on Testnet (2025-09-30)](https://minepi.com/blog/dex-amm-token-creation/) | إنشاء التوكنات وDEX/AMM متاح على **Testnet**، و«مقيّد على Mainnet خلال فترة الاختبار»؛ إنشاء التوكنات على Mainnet سيخضع لقواعد إضافية تركّز على المنفعة الحقيقية و«خطة معروض وتوزيع معقولة». |
| P3 | [Pi Blog — Open Network Anniversary (2026-02-20)](https://minepi.com/blog/open-network-anniversary) | تصميم «توكنات المنظومة» على Mainnet: توكنات منفعة لاكتساب المستخدمين لا لجمع رأس المال؛ عوائد Pi من الإطلاق تذهب إلى Liquidity Pool لا إلى المشروع؛ يشترط منتجًا عاملًا. |
| P4 | [Pi Blog — Pi Launchpad Released on Testnet (2026-03-19)](https://minepi.com/blog/pi-launchpad/) | Launchpad هو «الوسيلة الأساسية» لإطلاق توكنات المنظومة على Mainnet؛ متاح كتطبيق على Testnet؛ التصميم «قابل للتغيير». |
| P5 | [PiRC1 — Pi Ecosystem Token Design](https://github.com/PiNetwork/PiRC) ([core design](https://raw.githubusercontent.com/PiNetwork/PiRC/main/PiRC1/2-core-design.md), [allocation design 1](https://raw.githubusercontent.com/PiNetwork/PiRC/main/PiRC1/4-allocation/4-allocation%20design%201.md)) | مراحل الإطلاق (مشاركة + تفاعل ← تخصيص وسيولة ← TGE)؛ المشروع يقدّم T للمشاركين + T للسيولة + 5%T للتفاعل = 2.05T؛ السيولة الأولى لا يمكن للمشروع سحبها؛ جداول فتح المشروع «لا تكون أفضل من المجتمع». (مقترح للنقاش، ليس قاعدة نهائية). |
| P6 | [Pi Blog — Launchpad updated flow (2026-06-11)](https://minepi.com/blog/launchpad-update-flow) | تحديث النموذج (fair-access hold بمنحنى محدد)؛ توكنات الاختبار (IRRA, SLICE) لن تنتقل إلى Mainnet. |
| P7 | [Pi Blog — Ecosystem Summit Day 1 (2026-11-17)](https://minepi.com/blog/ecosystem-summit-begins/) | **إعلان**: Launchpad وDEX وAMM «ستُطلق على Mainnet في الربع الأول 2027»؛ عقد الاشتراكات الذكي ما زال وظيفة Testnet؛ مبادرة App Growth Initiative (ميزانية تسويق حتى 20 مليون Pi بتفاصيل لاحقة). |
| P8 | [Pi BlockExplorer — Mainnet Launchpad Tokens](https://blockexplorer.minepi.com/mainnet/tokens) | «No Launchpad Tokens on Mainnet… currently only available on Testnet». |
| P9 | [Pi Docs — Mainnet Listing Requirements](https://developers.minepi.com/docs/build-first-app/MainnetListing) | KYC للمطوّر؛ مصادقة Pi فقط؛ **«All transactions must be conducted in Pi, with no support for non-Pi Tokens or fiat currencies»**؛ تقليل جمع البيانات. |
| P10 | [Pi Docs — SDK Reference](https://developers.minepi.com/docs/api-reference/SdkReference) | نطاقات المصادقة المتاحة: `username`, `payments`, `wallet_address`, `in_app_notifications`؛ التحقق من الهوية عبر `/me` من الخادم. |
| P11 | [Pi Whitepaper](https://minepi.com/white-paper/) | سلسلة Pi مبنية على Stellar Consensus Protocol (SCP). |
| P12 | [Pi Developer Terms of Use (آخر تحديث 2023-01-09)](https://socialchain.app/developer_terms) | مسؤولية المطوّر عن الامتثال للقوانين وحماية البيانات وأمن الحسابات؛ لا بنود خاصة بالتوكنات؛ الأدوات «ليست مخصصة بعد للاستخدام الإنتاجي»؛ قيود العقوبات/التصدير. |

### تنظيمية
| رمز | المصدر | ما يؤكده |
|---|---|---|
| R1 | [هيئة السوق المالية — بيان اللجنة الدائمة (2018)](https://cma.gov.sa/en/MediaCenter/PR/Pages/Virtual_Currencies.aspx) | العملات الافتراضية «غير منظَّمة» في المملكة، غير معتمدة، ولا يوجد مرخَّص لها. |
| R2 | [وزارة المالية عبر موقع ساما (2019-08-21)](https://www.sama.gov.sa/en-US/MediaCenter/News/Pages/news21082019.aspx) | تحذير من التعامل بالعملات الافتراضية؛ وأي استخدام لاسم المملكة أو عملتها أو شعارها في تسويقها يعرّض للمساءلة. |
| R3 | [SDAIA — حماية البيانات (PDPL)](https://sdaia.gov.sa/en/Research/Pages/DataProtection.aspx) | نطاق النظام يشمل معالجة بيانات الأفراد في المملكة ومن خارجها؛ مبادئ تقليل البيانات وحدود الغرض والحقوق. |
| R4 | [ESMA — MiCA Article 4](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-4-offers-public-crypto-assets-other) | شروط الطرح العام لأصل مشفّر «آخر» (شخص اعتباري، White Paper، إخطار)؛ الاستثناءات (مجاني، توكن منفعة لخدمة قائمة، شبكة محدودة) وحدودها. |
| R5 | [SEC Press Release 2026-30 (2026-03-17)](https://www.sec.gov/newsroom/press-releases/2026-30-sec-clarifies-application-federal-securities-laws-crypto-assets) | تصنيف رسمي: digital commodities / collectibles / tools / stablecoins / digital securities؛ وإمكانية خضوع أصل غير أوراق مالية لعقد استثمار. |
| R6 | [Lexology — Year in review: Virtual currency regulation in Saudi Arabia (2026-09)](https://www.lexology.com/library/detail.aspx?g=447b84db-9378-496c-a7fa-01e5801cfb8c) | (مصدر ثانوي، مقتطف بحث) حتى يونيو 2026 لا يوجد نظام ترخيص شامل للأصول الافتراضية في المملكة. |

**ملاحظة:** يوجد في المستودع ملف سابق `docs/MJT-PI-TESTNET-PLAN.md` (خطة مرحلة Testnet، غير منفَّذة). هذا الملف لا يلغيه؛ ووثيقة 03 هنا تحدّثه بما تغيّر حتى 2026-11-25 (إعلان الربع الأول 2027).

## أين لا تُنشر هذه الوثائق
`docs/` محظور في الخادم (`server/lib/http.js` ← `DENY_TOP` يتضمن `docs`) ولا يُنسخ إلى صورة التشغيل (`Dockerfile` ينسخ `server/` و`dist/` فقط؛ `tools/build.mjs` لا ينسخ `docs/` إلى `dist/`). أُضيف `docs/mjt-token` إلى `.dockerignore` كطبقة احتياط إضافية. المستودع على GitHub **عام**، لذا هذه الوثائق مقروءة لمن يزور المستودع — راجع قرار رقم 1 أدناه.

## قرارات عامة تحتاج موافقة صاحب المشروع
1. المستودع `Ibrahim-314/mujtama-plus-test` عام؛ هل تبقى هذه المسودات فيه أم تُنقل إلى مستودع خاص؟ (وجودها في مستودع عام قد يُقرأ كإعلان رغم الوسم).
2. الاسم: داخل التطبيق «مجتمع كوين / Mujtama Coin (MJT)»، وفي هذه الوثائق «MJT – Mujtama Token». أي اسم يُعتمد لأي توكن مستقبلي؟ (يُفضّل اسم مختلف للتوكن لتعزيز الفصل عن الرصيد الداخلي — انظر 07).
3. اعتماد التوصية في 08 (عدم الانتقال لمرحلة الجاهزية الآن).
