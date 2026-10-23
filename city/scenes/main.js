/* مجتمع بلس — «المدينة» main scene data (city/scenes/main.js). Data only: the art, the streets, and the places.
 * Coordinates are pixels of the 784×1341 portrait art (public/city/main-784.webp) — the city concept the owner approved
 * (2026-10-22 v2), cleaned of baked text. Edit with the debug overlay (#/town?debug=1), which draws the graph, the hit
 * areas, the sign boards and the occluders over the art and prints tapped coordinates.
 *
 * The city has its own pages only (owner 2026-10-23: no links to the app's pages): a place with an `href` opens its hall
 * (#/city/…); a place without one shows «قيد البناء» until its hall is built.
 * Every place is a GATEWAY to its own independent system (user rule 2026-10-22: «كل نظام مستقل بذاته»): the city never
 * merges systems, it only opens the one you walked into.
 *   sign: the empty neon board on the art, as three corners [topStart, topEnd, bottomStart] — the live neon label is drawn
 *         into it (Cairo 800, Arabic/English, follows a language switch), so the art itself carries no text.
 *   occluders: parts of buildings that stand in front of a street — the character and the route are hidden there
 *         (the alley to the communities tower runs behind the work building).
 *   marks: small neon glyphs drawn into empty boards (the play mark on the Vidtik tower).
 *   lights: extra glow spots (doors, windows, lamps) that breathe — [x, y, radius]. */
(function () {
  const scene = {
    id: "main",
    size: [784, 1341],
    art: { src: "/city/main-784.webp", small: "/city/main-480.webp", smallW: 480, tone: "#15101f" },
    palette: { "--cy-c1": "#1b1626", "--cy-c2": "#2a2440", "--cy-c3": "#2a2140", "--cy-c4": "#110d1a", "--cy-c5": "#a875ff", "--cy-c6": "#fff", "--cy-c7": "#ff4fd8", "--cy-c8": "#b48cff", "--cy-c9": "#9b6bff", "--cy-c10": "#ff7ad9", "--cy-c11": "#6d3cf4", "--cy-c12": "#c9a8ff", "--cy-c13": "#120c20", "--cy-c14": "#0b0814", "--cy-c15": "#000", "--cy-c16": "#ffcf5a", "--cy-c17": "#8b5cff", "--cy-c18": "#3cff7a", "--cy-c19": "#ff3b5c", "--cy-c20": "#50a0ff", "--cy-c21": "#ffd850", "--cy-c22": "#111" },
    start: "SD", // the character first stands on the street in front of the store
    speed: 120, // scene px per second
    corner: 30, // route corners are rounded with this radius (scene px)
    actorH: 0.112, // the 3D character's height as a share of the stage height
    streets: {
      nodes: {
        VD: [262, 600], V1: [295, 642], R1: [302, 720], R2: [314, 800], X: [334, 878],
        SD: [214, 938], W0: [96, 1000],
        WJ: [420, 836], WD: [398, 792], LN: [500, 796], CD: [548, 858], PL: [556, 904], MD: [600, 934],
        LT: [640, 1010], TD: [608, 1180],
        LB: [256, 992], PZ: [372, 1112], RD: [284, 1205], GD: [470, 1212],
        H1: [350, 560], H2: [440, 472], CM: [505, 466]
      },
      edges: [["VD", "V1"], ["V1", "R1"], ["R1", "R2"], ["R2", "X"], ["X", "SD"], ["SD", "W0"],
        ["X", "WJ"], ["WJ", "WD"], ["WJ", "LN"], ["LN", "CD"], ["WJ", "PL"], ["PL", "CD"], ["PL", "MD"],
        ["MD", "LT"], ["LT", "TD"], ["SD", "LB"], ["LB", "PZ"], ["PZ", "RD"], ["PZ", "GD"], ["GD", "TD"],
        ["VD", "H1"], ["H1", "H2"], ["H2", "CM"]]
    },
    occluders: [
      [[318, 560], [332, 486], [402, 456], [478, 466], [524, 494], [524, 640], [318, 640]]
    ],
    places: [
      { id: "vidtik", icon: "clapper", label: { ar: "فيديوتك", en: "Vidtik" }, accent: "#ff4fd8", door: "VD", href: "#/city/vidtik",
        area: [[0, 170], [330, 10], [400, 60], [400, 450], [318, 520], [300, 610], [230, 620], [0, 500]], sign: [[150, 300], [360, 192], [150, 380]] },
      { id: "communities", icon: "community", label: { ar: "المجتمعات", en: "Communities" }, accent: "#a875ff", door: "CM", href: "#/city/communities",
        area: [[440, 40], [640, 0], [784, 40], [784, 330], [600, 430], [560, 470], [440, 430]], sign: [[470, 130], [640, 218], [467, 190]] },
      { id: "work", icon: "brief", label: { ar: "العمل الحر", en: "Work" }, accent: "#46e3d4", door: "WD", href: "#/city/work",
        area: [[322, 490], [402, 458], [478, 466], [524, 494], [524, 780], [440, 810], [322, 720]], sign: [[342, 484], [466, 552], [340, 542]] },
      { id: "courses", icon: "cap", label: { ar: "الدورات", en: "Courses" }, accent: "#5d7bff", door: "CD", href: "#/city/courses",
        area: [[524, 440], [784, 440], [784, 690], [620, 720], [590, 860], [524, 800]], sign: [[550, 456], [686, 528], [548, 516]] },
      { id: "store", icon: "bag", label: { ar: "المتجر", en: "Store" }, accent: "#ff7a59", door: "SD", href: "#/city/store",
        area: [[0, 690], [130, 620], [272, 690], [272, 880], [150, 920], [0, 870]], sign: [[124, 738], [264, 656], [124, 792]] },
      { id: "mjt", icon: "coin", label: { ar: "مجتمع كوين", en: "MJT Coin" }, accent: "#ffcf5a", door: "MD", href: "#/city/mjt", vault: true, // the vault door opens onto the MJT hall (scenes/mjt.js)
        area: [[592, 700], [700, 672], [784, 700], [784, 1060], [650, 1010], [592, 950]], sign: [[602, 748], [718, 810], [602, 830]] },
      { id: "local", icon: "store", label: { ar: "أعمال محلية", en: "Local business" }, accent: "#ffc94d", door: "LB", href: "#/city/local",
        area: [[262, 930], [372, 880], [530, 960], [560, 1110], [440, 1170], [392, 1080], [262, 1030]], sign: [[264, 956], [358, 902], [264, 982]] },
      { id: "records", icon: "receipt", label: { ar: "السجلات", en: "Records" }, accent: "#c8a0ff", door: "RD", href: "#/city/mjt/history",
        area: [[0, 1110], [110, 1050], [252, 1100], [252, 1250], [120, 1310], [0, 1250]], sign: [[137, 1160], [246, 1095], [137, 1186]] },
      { id: "harvest", icon: "sparkle", label: { ar: "التعدين", en: "Mining" }, accent: "#ffd76a", door: "TD", href: "#/city/mjt/earn",
        area: [[600, 1040], [784, 1030], [784, 1280], [690, 1300], [612, 1250]], sign: [[614, 1218], [676, 1250], [614, 1240]] },
      { id: "wallet", icon: "wallet", label: { ar: "المحفظة", en: "Wallet" }, accent: "#b9a2ff", door: "GD", href: "#/city/mjt/send",
        area: [[440, 1180], [530, 1170], [575, 1260], [560, 1341], [440, 1341]], sign: [[458, 1174], [530, 1212], [456, 1204]] }
    ],
    marks: [{ kind: "play", at: [52, 440], size: 22, skew: -0.15, accent: "#ff4fd8" }],
    lights: [[255, 560, 40], [540, 430, 36], [420, 740, 30], [575, 835, 28], [190, 840, 50], [650, 960, 50], [680, 1130, 70], [500, 1262, 60], [180, 1200, 50], [330, 990, 40], [480, 1060, 40]]
  };
  (window.MPCityScenes = window.MPCityScenes || {})[scene.id] = scene;
})();
