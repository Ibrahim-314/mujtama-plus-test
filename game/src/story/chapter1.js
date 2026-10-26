/* Chapter 1 — «الشارع» (The Street). The player steps out of the apartment block onto the boulevard that leads to the
 * MJT tower (the Core). Words only; the scene is scenes/street.js. Lines are { ar, en }; {name} is the player's name. */
export const CHAPTER1 = {
  id: 1,
  title: { ar: "الفصل 1", en: "Chapter 1" },
  name: { ar: "الشارع", en: "The Street" },
  narrator: { ar: "الراوي", en: "Narrator" },
  objective: { ar: "اتبع الإشارة إلى برج MJT", en: "Follow the signal to the MJT Tower" },
  intro: [
    { ar: "هذا هو شارع المدينة الرقمية، {name}. وفي آخره… برج MJT.", en: "This is the Digital City's boulevard, {name}. And at its end… the MJT tower." },
    { ar: "المفتاح في جيبك دافئ على غير العادة. الإشارة تأتي من هناك.", en: "The key in your pocket feels strangely warm. The signal comes from there." },
    { ar: "المس الطريق لتمشي إليه، ثم ادخل البرج.", en: "Tap the road to walk there, then go into the tower." }
  ],
  /** the first time you reach the tower: Salma at the front desk, the key «40», what she knows of Yousuf.
   * Each beat is one speaker; the scene plays them in order (story flag "story.salma"). */
  salma: [
    { who: "salma", lines: [{ ar: "أهلاً بك في برج MJT. عندك موعد؟", en: "Welcome to the MJT Tower. Do you have an appointment?" }] },
    { who: "narrator", lines: [{ ar: "تُخرج المفتاح النحاسي. عيناها تتوقفان على الرقم 40.", en: "You take out the brass key. Her eyes stop on the number 40." }] },
    { who: "salma", lines: [{ ar: "هذا المفتاح… من وين جبته؟", en: "That key… where did you get it?" }] },
    { who: "narrator", lines: [{ ar: "«مفتاح أبي. اسمه يوسف.»", en: "“It was my father's. His name is Yousuf.”" }] },
    { who: "salma", lines: [
      { ar: "يوسف… المهندس. كان يشتغل هنا قبل عشر سنين.", en: "Yousuf… the engineer. He worked here ten years ago." },
      { ar: "الطابق الأربعين مقفل من يوم اختفى. ما فيه مصعد يوصله… وما أحد يتكلم عنه.", en: "The fortieth floor has been sealed since the day he vanished. No lift goes there… and nobody talks about it." },
      { ar: "اسمعني: لا تُري هذا المفتاح لأحد. وإذا رجعت لك الإشارة… لا تلحقها لوحدك.", en: "Listen: don't show that key to anyone. And if the signal comes back… don't follow it alone." }
    ] },
    { who: "narrator", lines: [{ ar: "أبوك وصل إلى الطابق الأربعين… والمفتاح هو الطريق إليه. لكن ليس الليلة.", en: "Your father reached the fortieth floor… and the key is the way there. But not tonight." }] }
  ],
  salmaName: { ar: "سلمى — الاستقبال", en: "Salma — Front desk" },
  /** the objective once Salma has spoken */
  next: {
    objective: { ar: "ابحث عن طريق إلى الطابق 40", en: "Find a way to the fortieth floor" },
    goal: { ar: "تتبّع الإشارة إلى المحطة القديمة على الرصيف", en: "Trace the signal to the old terminal on the pavement" },
    /** said once Salma has finished: where to look next */
    hint: { ar: "المفتاح يسخن من جديد… والإشارة تنبض من محطة قديمة على الرصيف في منتصف الشارع. اتبع الخط المضيء وعمود الضوء.", en: "The key warms again… the signal pulses from an old terminal on the pavement, halfway down the street. Follow the glowing trail and the light beam." },
    card: { ar: "هدف جديد", en: "New objective" }
  },
  /** Season 1, «الإشارة الأولى»: the dead public terminal, a fragment of Yousuf's recording, first contact with Sada.
   * Played once (story flag "story.sada"), only after Salma has spoken. Each beat is one speaker. */
  signal: [
    { who: "narrator", lines: [
      { ar: "محطة عامة ماتت مع الانقطاع الكبير. لكن المفتاح يسخن كلما اقتربت منها.", en: "A public terminal that died in the Great Blackout. Yet the key grows warmer the closer you get." },
      { ar: "تقرّب المفتاح من الزجاج… فيتوهّج الرقم 40.", en: "You hold the key to the glass… and the number 40 lights up." }
    ] },
    { who: "yousuf", lines: [
      { ar: "…إذا وصلت إلى هنا، فقد سمعت رسالتي.", en: "…If you made it here, you heard my message." },
      { ar: "لا تبحث عني في الشاشات… ابحث بينها.", en: "Don't look for me in the screens… look between them." }
    ] },
    { who: "sada", lines: [
      { ar: "…صوت. أعرف هذا الصوت.", en: "…A voice. I know this voice." },
      { ar: "أنا صدى. كنت أعرف هذه المدينة كلها… ثم تقطّعت ذاكرتي مع الانقطاع.", en: "I am Sada. I used to know this whole city… then my memory broke with the Blackout." },
      { ar: "بصمة هذا التسجيل: يوسف. الاسم عندي… وكل ما حوله ممسوح.", en: "This recording's signature: Yousuf. I have the name… and everything around it is erased." },
      { ar: "بقي عندي سؤال واحد سليم: لماذا لا يوجد طابق أربعون في مخططات البرج… وأنا أراه من هنا؟", en: "One question survived intact: why is there no fortieth floor on the tower's plans… when I can see it from here?" }
    ] },
    { who: "narrator", lines: [{ ar: "تنطفئ الشاشة. ويبقى على زجاجها أثر رقم واحد: 40.", en: "The screen goes dark. One number lingers on the glass: 40." }] }
  ],
  yousufName: { ar: "تسجيل — يوسف", en: "Recording — Yousuf" },
  sadaName: { ar: "صدى", en: "Sada" },
  /** the objective once Sada has spoken */
  after: {
    objective: { ar: "عُد إلى برج MJT: ابحث عن الطابق الذي لا تظهره المخططات", en: "Return to the MJT Tower: find the floor the plans don't show" },
    goal: { ar: "ارجع إلى البرج ومعك المفتاح 40", en: "Go back to the tower with key 40" },
    card: { ar: "هدف جديد", en: "New objective" }
  },
  /** Season 1 Phase 3, «السوق السفلي»: Sada stops you at the tower's door (story flag "story.route") — the signal is being
   * smothered by the public network, and an old unregistered source sits under the street, at the underground market. */
  route: [
    { who: "sada", lines: [
      { ar: "انتظر. كلما اقتربنا من البرج تتشوّه الإشارة… الشبكة العامة تغطّي عليها.", en: "Wait. The closer we get to the tower, the more the signal warps… the public network is drowning it." },
      { ar: "تحت الضجيج مصدر قديم غير مسجّل. يأتي من تحت الشارع… من السوق السفلي.", en: "Under the noise there's an old, unregistered source. It comes from beneath the street… the underground market." },
      { ar: "عند درج السوق تاجر قطع قديمة. إن كان أحد يتذكر المدينة قبل الانقطاع… فهو.", en: "There's an old-parts dealer at the market stairs. If anyone remembers the city before the Blackout… it's him." }
    ] }
  ],
  routeNext: {
    objective: { ar: "انزل إلى السوق السفلي وتتبّع المصدر غير المسجّل", en: "Go down to the underground market and trace the unregistered source" },
    goal: { ar: "تحدّث مع أبو ناصر عند درج السوق (الرصيف الأيمن)", en: "Talk to Abu Nasser at the market stairs (right pavement)" },
    card: { ar: "هدف جديد", en: "New objective" }
  },
  nasserName: { ar: "أبو ناصر — قطع قديمة", en: "Abu Nasser — Old parts" },
  /** meeting Abu Nasser (story flag "story.record"): the opening, then the player's choice, then the clue they share */
  nasser: [
    { who: "narrator", lines: [{ ar: "رائحة نحاس وزيت قديم. رجل مسنّ يرتّب أسلاكاً لم يعد أحد يشتريها.", en: "A smell of brass and old oil. An old man sorting wires nobody buys anymore." }] },
    { who: "nasser", lines: [
      { ar: "السوق ليس للفضوليين يا ولدي. قل ما تريد وامشِ.", en: "The market isn't for the curious, son. Say what you want and move on." }
    ] }
  ],
  choice: {
    prompt: { ar: "كيف تبدأ مع أبو ناصر؟", en: "How do you approach Abu Nasser?" },
    key: { ar: "أُريه المفتاح وأسأله عن يوسف", en: "Show him the key and ask about Yousuf" },
    keyHint: { ar: "مباشر… وقد يغلق الباب في وجهك", en: "Direct… he may shut you out" },
    signal: { ar: "أسأله عن الإشارة وأُخفي المفتاح", en: "Ask about the signal, keep the key hidden" },
    signalHint: { ar: "حذر… ودعه يكشف نفسه", en: "Careful… let him show his hand" }
  },
  /** choice A: the key first */
  byKey: [
    { who: "narrator", lines: [{ ar: "تُخرج المفتاح النحاسي. يتجمّد أبو ناصر عند الرقم 40.", en: "You take out the brass key. Abu Nasser freezes at the number 40." }] },
    { who: "nasser", lines: [
      { ar: "خبّئه. الآن.", en: "Hide it. Now." },
      { ar: "لا أعرف شيئاً عن هذا الرقم… ولا أريد أن أعرف. اذهب.", en: "I know nothing about that number… and I don't want to. Go." }
    ] },
    { who: "narrator", lines: [{ ar: "«اسمه يوسف. كان أبي.»", en: "“His name was Yousuf. He was my father.”" }] },
    { who: "nasser", lines: [
      { ar: "…نفس العينين. كنت أخشى أن يأتي هذا اليوم.", en: "…The same eyes. I was afraid this day would come." },
      { ar: "أقسمت ألّا أتكلم عن ذلك الطابق. لكنه لو أرسلك إليّ… فقد كان يعرف أنك ستأتي.", en: "I swore never to speak of that floor. But if he sent you to me… he knew you would come." }
    ] }
  ],
  /** choice B: the signal first, key hidden */
  bySignal: [
    { who: "nasser", lines: [{ ar: "إشارة؟ في هذه المدينة ألف إشارة، وكلها تكذب.", en: "A signal? This city has a thousand signals, and they all lie." }] },
    { who: "narrator", lines: [{ ar: "تصف له النبض الذي تتبعه. يتوقف عن العمل، وعيناه على جيبك.", en: "You describe the pulse you've been following. He stops working, eyes on your pocket." }] },
    { who: "nasser", lines: [
      { ar: "هذا ليس تردد الشبكة. هذا تردد قديم… لم يستعمله إلا رجل واحد.", en: "That's not the network's frequency. It's an old one… only one man ever used it." },
      { ar: "يوسف. وأنت تحمل شيئاً منه، صحيح؟ لا تُرِني. يكفي أنه يسخن في جيبك.", en: "Yousuf. And you carry something of his, don't you? Don't show me. It's enough that it's warm in your pocket." }
    ] }
  ],
  /** both choices lead here: the first concrete clue */
  record: [
    { who: "nasser", lines: [
      { ar: "جاءني يوسف قبل اختفائه بثلاثة أيام. مستعجل، ويداه ترتجفان.", en: "Yousuf came to me three days before he vanished. In a hurry, his hands shaking." },
      { ar: "ترك هذا وقال: إن جاء أحد يحمل الأربعين، أعطه إياه. ولا كلمة أكثر.", en: "He left this and said: if someone comes carrying the forty, give it to them. Not a word more." }
    ] },
    { who: "narrator", lines: [{ ar: "سجل دخول معدني محترق الأطراف. تقرأ بصعوبة: «مدخل الخدمة — مقيّد — برج MJT».", en: "A metal access record, burnt at the edges. You can just read: “Service entrance — restricted — MJT Tower.”" }] },
    { who: "nasser", lines: [{ ar: "لا تسألني ما في الأعلى. اذهب قبل أن تلاحظك الشاشات.", en: "Don't ask me what's up there. Go, before the screens notice you." }] },
    { who: "sada", lines: [{ ar: "انتظر… في السجل بقايا صوت. أحاول تنقيته.", en: "Wait… there's a voice trace in the record. Let me clean it up." }] },
    { who: "fragment", lines: [{ ar: "«…أحدهم في البرج يعرف الحقيقة… لا تثق بـ…»", en: "“…someone in the tower knows the truth… don't trust…”" }] },
    { who: "sada", lines: [{ ar: "انقطع. البصمة تشبه صوت يوسف… والمصدر من داخل برج MJT.", en: "Gone. The print resembles Yousuf's voice… and its source is inside the MJT Tower." }] }
  ],
  fragmentName: { ar: "مقطع صوتي — يشبه يوسف", en: "Voice fragment — like Yousuf" },
  /** the objective once the record is yours: end of «السوق السفلي» */
  serviceNext: {
    objective: { ar: "اذهب إلى مدخل الخدمة المقيّد في برج MJT", en: "Reach the MJT Tower's restricted service entrance" },
    goal: { ar: "اذهب إلى مدخل الخدمة يمين البرج ومعك سجل يوسف", en: "Go to the service entrance right of the tower with Yousuf's record" },
    done: { ar: "اكتمل: السوق السفلي", en: "Complete: The Underground Market" },
    card: { ar: "هدف جديد", en: "New objective" }
  },
  /** Season 1 Phase 4, «المدخل المحظور»: Yousuf's record at the tower's restricted service entrance (story flag
   * "story.service"). Played once, only after Abu Nasser gave the record ("story.record"). Each beat is one speaker. */
  service: {
    /** at the reader: the record is refused, but something answers */
    reader: [
      { who: "narrator", lines: [{ ar: "باب خدمة رمادي في ظل البرج. فوقه لافتة باهتة: «للموظفين فقط».", en: "A grey service door in the tower's shadow. A faded sign above it: “Staff only”." }] },
      { who: "narrator", lines: [{ ar: "تمرّر سجل يوسف المحترق على القارئ…", en: "You pass Yousuf's burnt record over the reader…" }] },
      { who: "reader", lines: [{ ar: "صلاحية ملغاة. المالك: ي. — الطابق: ‹غير معروف›.", en: "Access revoked. Holder: Y. — Floor: ‹unknown›." }] },
      { who: "sada", lines: [
        { ar: "رفضه… لكنه لم يُطلق الإنذار. أرسل تنبيهاً صامتاً إلى الداخل.", en: "It refused it… but raised no alarm. It sent a silent alert inside." },
        { ar: "أحدهم استلمه الآن. لا تتحرك.", en: "Someone just received it. Don't move." }
      ] }
    ],
    /** the door opens from the inside: Salma, hiding what she saw */
    salma: [
      { who: "narrator", lines: [{ ar: "يُفتح الباب من الداخل. إنها سلمى… موظفة الاستقبال.", en: "The door opens from inside. It's Salma… the receptionist." }] },
      { who: "salma", lines: [{ ar: "أنت مرة ثانية؟ هذا الباب ما يُفتح لأحد.", en: "You again? This door doesn't open for anyone." }] },
      { who: "narrator", lines: [{ ar: "عيناها تقعان على السجل في يدك. ترتجف للحظة… ثم تبتسم ابتسامة رسمية.", en: "Her eyes fall on the record in your hand. A flicker… then a polite, practised smile." }] },
      { who: "salma", lines: [{ ar: "ادخل بسرعة. ممر الخدمة ما فيه كاميرات… عندك دقيقة واحدة.", en: "Come in, quickly. The service corridor has no cameras… you have one minute." }] }
    ],
    inside: { ar: "ممر الخدمة — برج MJT", en: "Service corridor — MJT Tower" },
    choice: {
      prompt: { ar: "ماذا تسأل سلمى؟", en: "What do you ask Salma?" },
      knew: { ar: "هل كنتِ تعرفين يوسف؟", en: "Did you know Yousuf?" },
      knewHint: { ar: "مباشر… وقد تتهرّب", en: "Direct… she may dodge it" },
      floor: { ar: "لماذا يرتبط مدخل الخدمة بالطابق 40؟", en: "Why is the service entrance tied to floor 40?" },
      floorHint: { ar: "عن المكان لا عن الناس", en: "About the place, not the people" }
    },
    /** choice A: about Yousuf himself */
    byKnew: [
      { who: "salma", lines: [
        { ar: "…كنت متدرّبة لما كان هو كبير المهندسين. كان يمرّ من هذا الباب كل ليلة بعد منتصف الليل.", en: "…I was an intern when he was chief engineer. He used this door every night, after midnight." },
        { ar: "كان يقول إن الأبواب الأمامية تعدّ الداخلين… وهذا الباب يتذكرهم.", en: "He used to say the front doors count who comes in… and this door remembers them." }
      ] },
      { who: "narrator", lines: [{ ar: "تتوقف فجأة، كأنها قالت أكثر مما تريد.", en: "She stops short, as if she'd said more than she meant to." }] }
    ],
    /** choice B: about the entrance and the floor */
    byFloor: [
      { who: "salma", lines: [
        { ar: "رسمياً؟ ما فيه طابق أربعين. المصاعد تتوقف عند الثامن والثلاثين.", en: "Officially? There is no fortieth floor. The lifts stop at thirty-eight." },
        { ar: "لكن مصعد الخدمة خلف هذا الممر له زر بلا رقم. ما أحد يلمسه… وما أحد يسأل عنه.", en: "But the service lift behind this corridor has a button with no number. Nobody touches it… nobody asks." }
      ] },
      { who: "narrator", lines: [{ ar: "تنظر إلى السجل، ثم تبعد عينيها بسرعة.", en: "She glances at the record, then quickly looks away." }] }
    ],
    /** both choices lead here: the revocation */
    revoked: [
      { who: "salma", lines: [
        { ar: "صلاحية يوسف أُلغيت في نفس الليلة التي اختفى فيها. أنا كنت على المكتب.", en: "Yousuf's access was revoked the very night he disappeared. I was on the desk." },
        { ar: "الغريب ليس الإلغاء… الغريب التوقيع. وُقّع بصلاحيات كان يفترض أنها معطّلة من قبلها بسنين.", en: "The revocation isn't the strange part… the signature is. It was signed with credentials that should have been dead for years." },
        { ar: "لا تسألني لمن. لو كنت أعرف… ما كنت هنا.", en: "Don't ask me whose. If I knew… I wouldn't still be here." }
      ] }
    ],
    examine: {
      prompt: { ar: "السجل بين يديك", en: "The record in your hands" },
      go: { ar: "افحص سجل الإلغاء مع صدى", en: "Examine the revocation record with Sada" },
      goHint: { ar: "دع صدى تقرأ ما لا يظهر", en: "Let Sada read what doesn't show" }
    },
    /** after examining: Sada's contradiction and the hidden floor-40 reference */
    found: [
      { who: "sada", lines: [
        { ar: "هنا تناقض. ختم الإلغاء قبل آخر خروج مسجّل ليوسف بأربع دقائق.", en: "There's a contradiction. The revocation is stamped four minutes before Yousuf's last recorded exit." },
        { ar: "يعني أُلغيت صلاحيته وهو ما زال في الداخل… ومع ذلك خرج.", en: "So his access was cancelled while he was still inside… and yet he walked out." },
        { ar: "وفي الحقل الأخير، تحت التشويش، مرجع مخفي: «ط-٤٠».", en: "And in the last field, under the noise, a hidden reference: “F-40”." }
      ] }
    ],
    /** the hook: a message to Yousuf on the corridor's terminal, gone before Salma can read it */
    hook: [
      { who: "narrator", lines: [{ ar: "شاشة الخدمة في آخر الممر تومض وحدها.", en: "The service screen at the end of the corridor flickers on by itself." }] },
      { who: "screen", lines: [{ ar: "«يوسف… إذا وصلت هنا، لا تعد من الطريق نفسه.»", en: "“Yousuf… if you made it here, don't go back the same way.”" }] },
      { who: "narrator", lines: [{ ar: "تنطفئ الكتابة قبل أن تلتفت سلمى.", en: "The words are gone before Salma turns around." }] },
      { who: "salma", lines: [{ ar: "شفت شي؟", en: "Did you see something?" }] },
      { who: "sada", lines: [
        { ar: "(همساً) هذا نمط الإشارة نفسه. المصدر ليس هنا…", en: "(whispering) That's the same signal pattern. The source isn't here…" },
        { ar: "إنه في مكان ما فوق الطوابق العامة.", en: "It's somewhere above the public floors." }
      ] },
      { who: "salma", lines: [{ ar: "اطلع الحين قبل تبديل الحراس. ولو تبي الطوابق العليا… لازم تدخل بطريقة رسمية، مو من هنا.", en: "Go now, before the guards change. And if you want the upper floors… you'll need a legitimate way in, not this door." }] }
    ],
    readerName: { ar: "قارئ الدخول", en: "Access reader" },
    screenName: { ar: "شاشة الخدمة", en: "Service screen" },
    /** the objective once the corridor is behind you: end of «المدخل المحظور» */
    next: {
      objective: { ar: "ابحث عن طريقة مشروعة للوصول إلى طوابق البرج العليا", en: "Find a legitimate way into the tower's upper floors" },
      goal: { ar: "تحقّق من المرجع المخفي إلى الطابق 40", en: "Investigate the hidden reference to floor 40" },
      done: { ar: "اكتمل: المدخل المحظور", en: "Complete: The Forbidden Entrance" },
      card: { ar: "هدف جديد", en: "New objective" }
    }
  },
  things: {
    service: { label: { ar: "مدخل الخدمة المقيّد", en: "Restricted service entrance" }, verb: { ar: "استخدم سجل يوسف", en: "Use Yousuf's record" } },
    market: { label: { ar: "درج السوق السفلي", en: "Underground market stairs" }, verb: { ar: "تحدّث مع أبو ناصر", en: "Talk to Abu Nasser" } },
    signal: { label: { ar: "محطة قديمة", en: "Old terminal" }, verb: { ar: "قرّب المفتاح", en: "Hold up the key" } },
    tower: { label: { ar: "برج MJT", en: "MJT Tower" }, verb: { ar: "ادخل", en: "Enter" } },
    home: { label: { ar: "شقتك", en: "Your apartment" }, verb: { ar: "ارجع", en: "Go back" } }
  }
};
