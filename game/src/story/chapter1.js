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
    hint: { ar: "المفتاح يسخن من جديد… والإشارة تنبض من محطة قديمة على الرصيف الأيسر.", en: "The key warms again… the signal pulses from an old terminal on the left pavement." },
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
  things: {
    signal: { label: { ar: "محطة قديمة", en: "Old terminal" }, verb: { ar: "قرّب المفتاح", en: "Hold up the key" } },
    tower: { label: { ar: "برج MJT", en: "MJT Tower" }, verb: { ar: "ادخل", en: "Enter" } },
    home: { label: { ar: "شقتك", en: "Your apartment" }, verb: { ar: "ارجع", en: "Go back" } }
  }
};
