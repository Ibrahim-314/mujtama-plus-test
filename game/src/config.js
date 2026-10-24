/* «المدينة الرقمية» — the game's constants: palette, characters, quality tiers, story chapters.
 * Everything a designer tweaks lives here or in story/ — engine files never hard-code a colour or a line of text. */

export const VERSION = "1.0.0"; // the game's own version (phase 1: the foundation)

/** The city's colours. Neon values are pushed above 1 in materials so bloom picks them up. */
export const PALETTE = {
  night: 0x05071a,   // sky at the zenith
  dusk: 0x2a1250,    // sky at the horizon
  fog: 0x0a0d2a,
  gold: 0xffc23d,    // MJT — the coin, the core tower, rewards
  goldHot: 0xffe39a,
  cyan: 0x2fe6ff,    // tech, terminals, the player's guide light
  magenta: 0xff3fb4, // nightlife, signs
  violet: 0x8a5cff,  // the lab (later chapters)
  green: 0x3dffb0,   // ok / unlocked
  red: 0xff4060,     // locked / danger
  floor: 0x151827,
  wall: 0x1b1e33
};
export const CSS_PALETTE = {
  "--gm-gold": "#ffc23d", "--gm-gold-hot": "#ffe39a", "--gm-cyan": "#2fe6ff", "--gm-magenta": "#ff3fb4",
  "--gm-violet": "#8a5cff", "--gm-green": "#3dffb0", "--gm-red": "#ff4060", "--gm-ink": "#eaf2ff", "--gm-dim": "#8d97bf",
  "--gm-panel": "rgba(10, 14, 38, 0.72)", "--gm-line": "rgba(47, 230, 255, 0.35)"
};

/** The playable characters (Quaternius, CC0). Each has a role in the story — flavour only, no stats. */
export const CHARS = [
  { id: "hoodie", ar: "المبرمج", en: "The Coder", tagAr: "يكتب الشيفرة التي تشغّل المدينة.", tagEn: "Writes the code that runs the city.", accent: "#2fe6ff" },
  { id: "casual-f", ar: "المصمّمة", en: "The Designer", tagAr: "ترى المدينة قبل أن تُبنى.", tagEn: "Sees the city before it is built.", accent: "#ff3fb4" },
  { id: "suit", ar: "رائد الأعمال", en: "The Founder", tagAr: "يحوّل كل فكرة إلى مشروع.", tagEn: "Turns every idea into a venture.", accent: "#ffc23d" },
  { id: "casual", ar: "المستكشف", en: "The Explorer", tagAr: "يعرف كل زقاق في المدينة.", tagEn: "Knows every alley in the city.", accent: "#3dffb0" },
  { id: "suit-f", ar: "المستثمرة", en: "The Investor", tagAr: "تقرأ السوق كما تقرأ كتاباً.", tagEn: "Reads the market like a book.", accent: "#8a5cff" }
];
export const charById = (id) => CHARS.find((c) => c.id === id) || CHARS[0];

/** Render quality tiers. "auto" picks one from the device and steps down if the frame rate drops. */
export const QUALITY = {
  low: { dpr: 1, bloom: false, shadows: false, particles: 0.35, skyline: 0.55 },
  medium: { dpr: 1.5, bloom: true, shadows: false, particles: 0.7, skyline: 0.8 },
  high: { dpr: 2, bloom: true, shadows: true, particles: 1, skyline: 1 }
};

/** Where assets live (copied to the site root by game/build.mjs). */
export const ASSET = (p) => `/game/assets/${p}`;

/** Player movement. */
export const MOVE = { walk: 1.9, run: 3.4, turn: 12, radius: 0.32 };
