/* Chapter 1 — «الشارع» (The Street). The player steps out of the apartment block onto the boulevard that leads to the
 * MJT tower (the Core). Words only; the scene is scenes/street.js. Lines are { ar, en }; {name} is the player's name. */
export const CHAPTER1 = {
  id: 1,
  title: { ar: "الفصل 1", en: "Chapter 1" },
  name: { ar: "الشارع", en: "The Street" },
  narrator: { ar: "الراوي", en: "Narrator" },
  objective: { ar: "امشِ إلى برج MJT وادخله", en: "Walk to the MJT tower and go in" },
  intro: [
    { ar: "هذا هو شارع المدينة الرقمية، {name}. وفي آخره… برج MJT.", en: "This is the Digital City's boulevard, {name}. And at its end… the MJT tower." },
    { ar: "المس الطريق لتمشي إليه. البرج يفتح أبوابه لك.", en: "Tap the road to walk there. The tower opens its doors to you." }
  ],
  things: {
    tower: { label: { ar: "برج MJT", en: "MJT Tower" }, verb: { ar: "ادخل", en: "Enter" } },
    home: { label: { ar: "شقتك", en: "Your apartment" }, verb: { ar: "ارجع", en: "Go back" } }
  }
};
