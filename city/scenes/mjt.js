/* مجتمع بلس — «قاعة مجتمع كوين» interior scene (city/scenes/mjt.js). Data only, same format as scenes/main.js.
 * The MJT building in the city opens its vault door (portal.js, vault transition) onto this hall: #/town/mjt.
 * Coordinates are pixels of the 768×1376 art (public/city/mjt-768.webp) the owner approved on 2026-10-23, no baked text.
 * Every station opens the MJT system's own screen — the hall never merges it (user rule: «كل نظام مستقل بذاته»):
 *   المحفظة → #/mjt?tab=send · السجلات → #/mjt?tab=history · الرصيد → #/mjt · التعدين → #/mjt?tab=earn
 *   الإحصاءات → #/points · خروج → back to the city it came from.
 * frames: the neon board frames carry their own animated light (a breathing glow and two runners chasing round the tube),
 * as approved in the preview: «النيون هي الألوان على غلاف اللوحات متحركه». */
(function () {
  const scene = {
    id: "mjt",
    size: [768, 1376],
    art: { src: "/city/mjt-768.webp", small: "/city/mjt-480.webp", smallW: 480, tone: "#140f1d" },
    palette: { "--cy-c1": "#1b1626", "--cy-c2": "#2a2440", "--cy-c3": "#2a2140", "--cy-c4": "#110d1a", "--cy-c5": "#ffcf5a", "--cy-c6": "#fff", "--cy-c7": "#ff4fd8", "--cy-c8": "#b48cff", "--cy-c9": "#9b6bff", "--cy-c10": "#ff7ad9", "--cy-c11": "#6d3cf4", "--cy-c12": "#c9a8ff", "--cy-c13": "#120c20", "--cy-c14": "#0b0814", "--cy-c15": "#000", "--cy-c16": "#ffcf5a", "--cy-c17": "#8b5cff", "--cy-c18": "#3cff7a", "--cy-c19": "#ff3b5c", "--cy-c20": "#50a0ff", "--cy-c21": "#ffd850", "--cy-c22": "#111" },
    title: { ar: "مجتمع كوين", en: "MJT Coin" },
    start: "GT", // the member walks in through the gate
    speed: 120,
    corner: 28,
    actorH: 0.105,
    frames: true,
    streets: {
      nodes: {
        GT: [430, 1185], L1: [262, 1075], KD: [262, 1150], L2: [232, 962], L3: [300, 842], LP: [330, 724],
        WD: [262, 716], VC: [410, 650], RC: [612, 652], R0: [490, 818], BL: [540, 878], R1: [530, 985], MT: [552, 1112]
      },
      edges: [["GT", "L1"], ["L1", "KD"], ["L1", "L2"], ["L2", "L3"], ["L3", "LP"], ["LP", "WD"], ["LP", "VC"], ["VC", "RC"],
        ["L3", "R0"], ["R0", "BL"], ["BL", "R1"], ["R1", "MT"], ["GT", "MT"]]
    },
    occluders: [],
    places: [
      { id: "wallet", icon: "wallet", label: { ar: "المحفظة", en: "Wallet" }, accent: "#ff4fd8", door: "WD", href: "#/mjt?tab=send",
        area: [[0, 360], [205, 268], [232, 540], [300, 590], [300, 690], [150, 760], [0, 720]], sign: [[24, 378], [196, 284], [24, 482]] },
      { id: "records", icon: "receipt", label: { ar: "السجلات", en: "Records" }, accent: "#b48cff", door: "RC", href: "#/mjt?tab=history",
        area: [[586, 262], [768, 330], [768, 720], [690, 700], [640, 610], [586, 420]], sign: [[604, 282], [728, 352], [604, 394]] },
      { id: "balance", icon: "coin", label: { ar: "الرصيد", en: "Balance" }, accent: "#ffcf5a", door: "BL", href: "#/mjt",
        area: [[562, 700], [740, 740], [744, 1050], [560, 1000]], sign: [[590, 764], [706, 828], [590, 862]] },
      { id: "mining", icon: "sparkle", label: { ar: "التعدين", en: "Mining" }, accent: "#ffd76a", door: "MT", href: "#/mjt?tab=earn",
        area: [[572, 1050], [768, 1060], [768, 1290], [640, 1300], [572, 1235]], sign: [[600, 1226], [664, 1258], [600, 1250]] },
      { id: "stats", icon: "chart", label: { ar: "الإحصاءات", en: "Stats" }, accent: "#ff7a59", door: "KD", href: "#/points",
        area: [[0, 1110], [120, 1040], [250, 1100], [250, 1290], [130, 1330], [0, 1262]], sign: [[130, 1158], [240, 1104], [130, 1184]] },
      { id: "exit", icon: "building", label: { ar: "خروج", en: "Exit" }, accent: "#7fa8ff", door: "GT", back: true,
        area: [[432, 1188], [540, 1218], [552, 1376], [430, 1376]], sign: [[446, 1192], [520, 1230], [446, 1222]] }
    ],
    marks: [],
    lights: [[400, 400, 90], [400, 960, 60], [668, 1170, 50], [490, 1272, 46], [672, 740, 36], [180, 610, 40], [640, 560, 40]]
  };
  (window.MPCityScenes = window.MPCityScenes || {})[scene.id] = scene;
})();
