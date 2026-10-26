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
    goal: { ar: "تحدّث مع سلمى عن المفتاح", en: "Ask Salma about the key" },
    card: { ar: "هدف جديد", en: "New objective" }
  },
  things: {
    tower: { label: { ar: "برج MJT", en: "MJT Tower" }, verb: { ar: "ادخل", en: "Enter" } },
    home: { label: { ar: "شقتك", en: "Your apartment" }, verb: { ar: "ارجع", en: "Go back" } }
  }
};
