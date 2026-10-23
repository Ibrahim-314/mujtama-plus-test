/* Phase 44 — personalization catalogue + pure helpers (no DB): colour palettes, display modes, densities, the
 * reorderable bottom-nav items, alternate app icons (PNG rendered in pure Node: gradient + white «+», no image deps),
 * per-icon web manifest, and the validator for the `ui` preference namespace. Free for everyone. */
const zlib = require("node:zlib");

const MODES = ["system", "light", "dark"]; // data-theme (existing attribute; dark-only rules across the app key off it)
const DENSITIES = ["comfortable", "compact"];
const NAV = ["home", "explore", "communities", "notifications", "menu"]; // v2.52: «حسابي» (me) became «المزيد» (menu, the hub; profile is in it)
/** v2.52: orders saved before the hub existed name "me" — read them as "menu" (additive, no migration) */
const normUi = (key, v) => (key === "nav" && Array.isArray(v) ? v.map((x) => (x === "me" ? "menu" : x)) : v);
/** colour themes: brand gradient + accent for light and dark (light accents ≥ 4.5:1 on white) */
const PALETTES = [
  { id: "violet", name: "بنفسجي", brand: ["#6d3cf4", "#c04cf0", "#ff7ab6"], light: ["#6d3cf4", "#efe9ff", "#4f22d1"], dark: ["#9a7bff", "#231c3d", "#b9a4ff"] },
  { id: "ocean", name: "محيط", brand: ["#0b6bcb", "#1aa3c8", "#4fd1c5"], light: ["#0b63c1", "#e3f0ff", "#084e98"], dark: ["#5aa9ff", "#0f2338", "#9cccff"] },
  { id: "forest", name: "غابة", brand: ["#1e7a46", "#3fa34d", "#a3d65c"], light: ["#1d7a44", "#e3f5e9", "#135a31"], dark: ["#4fd18b", "#10291b", "#9ff0c3"] },
  { id: "sunset", name: "غروب", brand: ["#e8590c", "#f0396b", "#ffb347"], light: ["#c2410c", "#fff0e6", "#9a3412"], dark: ["#ff9a5c", "#3a1d0e", "#ffc49e"] },
  { id: "rose", name: "وردي", brand: ["#d6336c", "#f06595", "#ffa8c5"], light: ["#c2255c", "#ffe8f0", "#9c1d4a"], dark: ["#ff7aa8", "#3a1424", "#ffb3cd"] },
  { id: "gold", name: "ذهبي", brand: ["#b7791f", "#d69e2e", "#f6e05e"], light: ["#8a5a00", "#fff5d6", "#6e4300"], dark: ["#f2c14e", "#33270c", "#ffe08a"] },
  { id: "graphite", name: "رمادي", brand: ["#374151", "#6b7280", "#9ca3af"], light: ["#374151", "#eceef2", "#1f2937"], dark: ["#c4cad4", "#1f232a", "#e5e7eb"] }
];
/** alternate app icons: [top-left colour, bottom-right colour, plus colour] */
const ICONS = [
  { id: "classic", name: "الأصلية", c: ["#6d3cf4", "#c04cf0", "#ffffff"] },
  { id: "ocean", name: "محيط", c: ["#0b6bcb", "#4fd1c5", "#ffffff"] },
  { id: "forest", name: "غابة", c: ["#1e7a46", "#a3d65c", "#ffffff"] },
  { id: "sunset", name: "غروب", c: ["#e8590c", "#ffb347", "#ffffff"] },
  { id: "rose", name: "وردي", c: ["#d6336c", "#ffa8c5", "#ffffff"] },
  { id: "gold", name: "ذهبي", c: ["#8a5a00", "#f6e05e", "#ffffff"] },
  { id: "midnight", name: "منتصف الليل", c: ["#000000", "#15131d", "#9a7bff"] }
];
const SIZES = [180, 192, 512];

const isBool = (v) => typeof v === "boolean";
/** validate one key of the `ui` namespace; returns an Arabic error message or null */
function checkUi(key, v) {
  switch (key) {
    case "theme": return MODES.includes(v) ? null : "وضع عرض غير معروف";
    case "palette": return PALETTES.some((p) => p.id === v) ? null : "سمة ألوان غير معروفة";
    case "oled": return isBool(v) ? null : "قيمة غير صالحة";
    case "density": return DENSITIES.includes(v) ? null : "كثافة عرض غير معروفة";
    case "icon": return ICONS.some((i) => i.id === v) ? null : "أيقونة غير معروفة";
    case "nav": return Array.isArray(v) && v.length === NAV.length && new Set(v).size === NAV.length && v.every((x) => NAV.includes(x)) ? null : "ترتيب شريط التنقل غير صالح";
    case "sync": return isBool(v) ? null : "قيمة غير صالحة";
    default: return "إعداد غير معروف";
  }
}

/* ---------- PNG icon rendering (gradient square + centred plus), cached per id/size ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const cache = new Map();
function iconPng(id, size) {
  const icon = ICONS.find((i) => i.id === id);
  if (!icon || !SIZES.includes(size)) return null;
  const k = id + ":" + size;
  if (cache.has(k)) return cache.get(k);
  const [a, b, p] = icon.c.map(rgb), n = size;
  const th = Math.round(n * 0.15), len = Math.round(n * 0.5), c0 = Math.round((n - th) / 2), l0 = Math.round((n - len) / 2);
  const raw = Buffer.alloc((n * 3 + 1) * n);
  for (let y = 0; y < n; y++) {
    const row = y * (n * 3 + 1); raw[row] = 0;
    for (let x = 0; x < n; x++) {
      const plus = (x >= c0 && x < c0 + th && y >= l0 && y < l0 + len) || (y >= c0 && y < c0 + th && x >= l0 && x < l0 + len);
      const t = (x + y) / (2 * (n - 1)), o = row + 1 + x * 3;
      for (let ch = 0; ch < 3; ch++) raw[o + ch] = plus ? p[ch] : Math.round(a[ch] + (b[ch] - a[ch]) * t);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
  cache.set(k, png);
  return png;
}
const iconHref = (id, size) => `/api/prefs/icons/${id}-${size}.png`;
function manifest(id) {
  const icon = ICONS.find((i) => i.id === id) || ICONS[0];
  return {
    name: "مجتمع بلس", short_name: "مجتمع+", id: "/", start_url: "/#/home", scope: "/", display: "standalone", dir: "rtl", lang: "ar",
    background_color: icon.c[0], theme_color: icon.c[0],
    icons: [192, 512].flatMap((s) => [{ src: iconHref(icon.id, s), sizes: `${s}x${s}`, type: "image/png", purpose: "any" }, { src: iconHref(icon.id, s), sizes: `${s}x${s}`, type: "image/png", purpose: "maskable" }])
  };
}
function catalog() {
  return {
    free: true, modes: MODES, densities: DENSITIES, nav: NAV, oled: true,
    palettes: PALETTES.map(({ id, name, brand, light, dark }) => ({ id, name, brand, accent: { light: light[0], dark: dark[0] } })),
    icons: ICONS.map(({ id, name }) => ({ id, name, href: iconHref(id, 180), manifest: `/api/prefs/manifest.webmanifest?icon=${id}` })),
    defaults: { theme: "system", palette: "violet", oled: false, density: "comfortable", nav: NAV, icon: "classic", sync: true }
  };
}

module.exports = { MODES, DENSITIES, NAV, normUi, PALETTES, ICONS, SIZES, checkUi, iconPng, iconHref, manifest, catalog, crc32 };
