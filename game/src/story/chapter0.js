/* Chapter 0 — «الوصول» (Arrival). The player wakes in a small apartment high above the Digital City.
 * All the chapter's words live here, apart from the code, so the story can be rewritten without touching the engine.
 * Lines are { ar, en }; {name} is the player's name. */
export const CHAPTER0 = {
  id: 0,
  title: { ar: "الفصل 0", en: "Chapter 0" },
  name: { ar: "الوصول", en: "Arrival" },
  narrator: { ar: "الراوي", en: "Narrator" },
  intro: [
    { ar: "وصلتَ الليلة بالقطار المغناطيسي، {name}. هذه شقتك الجديدة في المدينة الرقمية.", en: "You came in on the magnetic train tonight, {name}. This is your new apartment in the Digital City." },
    { ar: "في جيبك مفتاح أبيك النحاسي، رقم 40… وفي رأسك صوته: «لا تثق بالشاشات».", en: "Your father's brass key, number 40, is in your pocket… and his voice is in your head: “Don't trust the screens.”" },
    { ar: "هنا لا يتحرك شيء إلا بعملة واحدة: مجتمع كوين — MJT. استكشف المكان أولاً.", en: "Here nothing moves without one currency: Mujtama Coin — MJT. Look around first." }
  ],
  objective: { ar: "استكشف شقتك الجديدة", en: "Explore your new apartment" },
  goals: ["window", "computer", "door"],
  goalLabel: {
    window: { ar: "انظر إلى المدينة", en: "Look at the city" },
    computer: { ar: "شغّل الحاسوب", en: "Turn on the computer" },
    door: { ar: "جرّب الباب", en: "Try the door" }
  },
  things: {
    window: {
      label: { ar: "النافذة", en: "Window" }, verb: { ar: "انظر", en: "Look" },
      lines: [
        { ar: "المدينة الرقمية… كل نافذة مضيئة فيها شخص يبني ثروته.", en: "The Digital City… behind every lit window, someone is building a fortune." },
        { ar: "وذاك البرج الذهبي في القلب: برج MJT. منه يولد كل مجتمع كوين…", en: "And that golden tower at its heart: the MJT Tower. Every Mujtama Coin is born there…" },
        { ar: "…ومنه جاءت الإشارة التي رأيتها في القطار.", en: "…and that is where the signal on the train came from." }
      ]
    },
    computer: {
      label: { ar: "الحاسوب", en: "Computer" }, verb: { ar: "شغّل", en: "Turn on" },
      first: [
        { ar: "الشاشة ترمش لحظة… نفس الإشارة: «40». ثم تختفي كأنها لم تكن.", en: "The screen flickers for a moment… the same signal: “40”. Then it is gone, as if it never was." },
        { ar: "حاسوب قديم… لكن عليه برنامج تعدين مجتمع كوين.", en: "An old computer… but it runs the Mujtama Coin miner." },
        { ar: "دورة واحدة كل 24 ساعة تعطيك 5 MJT. ابدأها ودعها تعمل.", en: "One cycle every 24 hours gives you 5 MJT. Start it and let it run." }
      ]
    },
    door: {
      label: { ar: "الباب", en: "Door" }, verb: { ar: "افتح", en: "Open" },
      lines: [
        { ar: "الباب مقفل. الشاشة الصغيرة بجانبه تقول: «بانتظار التصريح».", en: "The door is locked. The little screen beside it says: “Awaiting clearance.”" },
        { ar: "يبدو أن المدينة لم تفتح أبوابها لك بعد… أكمل استكشاف شقتك.", en: "It seems the city has not opened its doors to you yet… finish exploring your apartment." }
      ],
      open: { ar: "الباب مفتوح. الشارع ينتظرك", en: "The door is open. The street awaits" }
    },
    boxes: {
      label: { ar: "الصناديق", en: "Boxes" }, verb: { ar: "افحص", en: "Inspect" },
      lines: [{ ar: "صناديق الانتقال. ما زالت مغلقة… وصلتَ للتو.", en: "Moving boxes, still sealed… you only just arrived." }]
    },
    bed: {
      label: { ar: "السرير", en: "Bed" }, verb: { ar: "استلقِ", en: "Lie down" },
      lines: [{ ar: "ليس وقت النوم. المدينة لا تنام.", en: "No time for sleep. The city never sleeps." }]
    },
    panel: {
      label: { ar: "لوحة المدينة", en: "City board" }, verb: { ar: "اقرأ", en: "Read" },
      lines: [
        { ar: "«أخبار المدينة: النواة تصدر MJT جديدة كل يوم للمعدّنين.»", en: "“City news: the Core issues new MJT to miners every day.”" },
        { ar: "«قريباً: افتتاح مجمّع التعدين والمتجر في وسط المدينة.»", en: "“Coming soon: the Mining Complex and the Market open downtown.”" }
      ]
    }
  },
  done: [
    { ar: "عرفت مكانك الآن، {name}. الحاسوب يعدّن، والمدينة تنتظر.", en: "Now you know your place, {name}. The computer is mining, and the city is waiting." },
    { ar: "سمعت؟ ضوء الباب صار ذهبياً… لقد فُتح لك. اخرج إلى الشارع واتبع الإشارة إلى برج MJT.", en: "Hear that? The door light turned gold… it is open for you. Step out and follow the signal to the MJT tower." }
  ]
};
