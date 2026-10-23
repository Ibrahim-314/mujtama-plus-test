/* Geohash + distance helpers for the nearby map (phase 66). Pure, dependency-free, unit-tested.
 * Privacy rule: a member's own position is only ever handled as a coarse geohash of at most MAX_USER_PRECISION (5)
 * characters — a cell of about 4.9 × 4.9 km — computed on the device. The server never receives or stores lat/lng
 * for a person; precise coordinates exist only for PUBLIC places and events their organisers chose to pin. */
const B32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const MAX_USER_PRECISION = 5;
const VALID = /^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/;

/** @param {number} lat @param {number} lng @param {number} [precision] */
function encode(lat, lng, precision = 7) {
  const la = [-90, 90], lo = [-180, 180]; let bit = 0, ch = 0, even = true, out = "";
  while (out.length < precision) {
    const r = even ? lo : la, v = even ? lng : lat, mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { out += B32[ch]; bit = 0; ch = 0; }
  }
  return out;
}
/** @returns {{ lat: number, lng: number, latErr: number, lngErr: number, box: [number, number, number, number] }} centre + half-size; box = [minLat, minLng, maxLat, maxLng] */
function decode(hash) {
  if (!VALID.test(String(hash || ""))) throw new Error("bad geohash");
  const la = [-90, 90], lo = [-180, 180]; let even = true;
  for (const c of hash) {
    const n = B32.indexOf(c);
    for (let i = 4; i >= 0; i--) { const b = (n >> i) & 1, r = even ? lo : la; r[b ? 0 : 1] = (r[0] + r[1]) / 2; even = !even; }
  }
  return { lat: (la[0] + la[1]) / 2, lng: (lo[0] + lo[1]) / 2, latErr: (la[1] - la[0]) / 2, lngErr: (lo[1] - lo[0]) / 2, box: [la[0], lo[0], la[1], lo[1]] };
}
const valid = (h) => VALID.test(String(h || ""));
/** a member's geohash reduced to the coarse precision we allow (never longer than 5) */
const coarsen = (h, p = MAX_USER_PRECISION) => (valid(h) ? String(h).slice(0, Math.min(MAX_USER_PRECISION, p)) : null);

const R_KM = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
/** great-circle distance in km */
function haversine(aLat, aLng, bLat, bLng) {
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(x)));
}
/** bounding box [minLat, minLng, maxLat, maxLng] that contains the circle (used for an indexed pre-filter) */
function bbox(lat, lng, km) {
  const dLat = km / 110.574, dLng = km / (111.32 * Math.max(0.01, Math.cos(rad(lat))));
  return [Math.max(-90, lat - dLat), Math.max(-180, lng - dLng), Math.min(90, lat + dLat), Math.min(180, lng + dLng)];
}
/** distance shown to people: approximate on purpose (the centre is a 5 km cell) — 0.5 km steps, «< 1 km» floor */
const approxKm = (km) => (km < 1 ? 0.5 : Math.round(km * 2) / 2);
const validLatLng = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
/** public place coordinates are stored rounded to 4 decimals (≈ 11 m) */
const round4 = (x) => Math.round(Number(x) * 1e4) / 1e4;

/* city centres for the lib/geo.js gazetteer (WGS84, approximate city centre) */
const CITY_CENTERS = {
  "الرياض": [24.7136, 46.6753], "جدة": [21.4858, 39.1925], "مكة": [21.3891, 39.8579], "المدينة المنورة": [24.5247, 39.5692], "الدمام": [26.4207, 50.0888], "الخبر": [26.2172, 50.1971],
  "الطائف": [21.2703, 40.4158], "أبها": [18.2164, 42.5053], "تبوك": [28.3835, 36.5662], "بريدة": [26.326, 43.975], "القاهرة": [30.0444, 31.2357], "الإسكندرية": [31.2001, 29.9187],
  "الجيزة": [30.0131, 31.2089], "دبي": [25.2048, 55.2708], "أبوظبي": [24.4539, 54.3773], "الشارقة": [25.3463, 55.4209], "الكويت": [29.3759, 47.9774], "الدوحة": [25.2854, 51.531],
  "المنامة": [26.2285, 50.586], "مسقط": [23.588, 58.3829], "عمّان": [31.9454, 35.9284], "الرباط": [34.0209, -6.8416], "الدار البيضاء": [33.5731, -7.5898], "مراكش": [31.6295, -7.9811],
  "الجزائر العاصمة": [36.7538, 3.0588], "تونس العاصمة": [36.8065, 10.1815], "بغداد": [33.3152, 44.3661], "بيروت": [33.8938, 35.5018], "دمشق": [33.5138, 36.2765], "الخرطوم": [15.5007, 32.5599],
  "طرابلس": [32.8872, 13.1913], "صنعاء": [15.3694, 44.191]
};
/** nearest gazetteer city within maxKm of a point (or null) */
function nearestCity(lat, lng, maxKm = 60) {
  let best = null;
  for (const [city, [a, b]] of Object.entries(CITY_CENTERS)) { const d = haversine(lat, lng, a, b); if (d <= maxKm && (!best || d < best.km)) best = { city, km: d }; }
  return best;
}

module.exports = { encode, decode, valid, coarsen, haversine, bbox, approxKm, validLatLng, round4, nearestCity, CITY_CENTERS, MAX_USER_PRECISION };
