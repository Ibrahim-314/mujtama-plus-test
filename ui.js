/* =====================================================================
 * مجتمع بلس — UI layer v2.1
 * Icon system, app shell (dock / side rail / live right rail), post card polish,
 * gestures (tap-to-like, long-press reactions, double-tap heart, swipe-to-close sheets,
 * pull-to-refresh), lightbox, motion, compact numbers, accessibility.
 * Pure presentation: never changes data contracts used by the store or sync layers.
 * ===================================================================== */
(function UILayer() {
const UI_VERSION = "__APP_VERSION__"; // v2.52: the build injects package.json (was a stale "2.3.0" in the rail footer)
(function lastStyles() { const l = document.querySelector('link[href="theme.css"]'); if (l) document.head.appendChild(l); const t = document.getElementById("theme-inline"); if (t) document.head.appendChild(t); })();

/* ---------- Icon system (inline SVG sprite, stroke-based, RTL-safe) — v2.53: Lucide (ISC, see vendor/LICENSE-lucide.txt) ---------- */
const ICON_PATHS = {
  home: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  homeF: '<path fill="currentColor" d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path stroke="var(--cut, var(--card))" stroke-width="2.2" d="M15 21v-6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6"/>',
  compass: '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  compassF: '<circle fill="currentColor" cx="12" cy="12" r="10"/><path fill="var(--cut, var(--card))" stroke="none" d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  usersF: '<path fill="currentColor" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2z"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle fill="currentColor" cx="9" cy="7" r="4"/>',
  bell: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  bellF: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path fill="currentColor" d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  userF: '<path fill="currentColor" d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2z"/><circle fill="currentColor" cx="12" cy="7" r="4"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  bookmark: '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
  bookmarkF: '<path fill="currentColor" d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
  mail: '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
  pen: '<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
  heartF: '<path fill="currentColor" d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
  comment: '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
  repost: '<path d="m2 9 3-3 3 3"/><path d="M13 18H7a2 2 0 0 1-2-2V6"/><path d="m22 15-3 3-3-3"/><path d="M11 6h6a2 2 0 0 1 2 2v10"/>',
  share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  chart: '<path d="M5 21v-6"/><path d="M12 21V3"/><path d="M19 21V9"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  verified: '<path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m16 9-5.5 5.5L8 12"/>',
  community: '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
  fire: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  sparkle: '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'
  ,link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  mapPin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  award: '<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
  building: '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  camera: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
  rotate: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'
  ,play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  pause: '<rect x="14" y="3" width="5" height="18" rx="1"/><rect x="5" y="3" width="5" height="18" rx="1"/>',
  volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
  volumeX: '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"/><path d="m16.5 14.5 5-5"/><path d="m16.5 9.5 5 5"/>',
  expand: '<path d="m15 15 6 6"/><path d="m15 9 6-6"/><path d="M21 16v5h-5"/><path d="M21 8V3h-5"/><path d="M3 16v5h5"/><path d="m3 21 6-6"/><path d="M3 8V3h5"/><path d="M9 9 3 3"/>',
  mic: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
  micOff: '<path d="M12 19v3"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M16.95 16.95A7 7 0 0 1 5 12v-2"/><path d="M18.89 13.23A7 7 0 0 0 19 12v-2"/><path d="m2 2 20 20"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
  ,settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
  trophy: '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2"/><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2"/><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  bag: '<path d="M16 10a4 4 0 0 1-8 0"/><path d="M3.103 6.034h17.794"/><path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"/>',
  feedback: '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  palette: '<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
  access: '<circle cx="16" cy="4" r="1"/><path d="m18 19 1-7-6 1"/><path d="m5 8 3-3 5.5 3-2.36 3.5"/><path d="M4.24 14.5a5 5 0 0 0 6.88 6"/><path d="M13.76 17.5a5 5 0 0 0-6.88-6"/>'
  /* v2.54 Stage B (Lucide, ISC) */
  ,folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  list: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  flask: '<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
  scale: '<path d="M12 3v18"/><path d="m19 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/><path d="m5 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M7 21h10"/>',
  calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  clapper: '<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>',
  trendUp: '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  unlock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="M4.929 4.929 19.07 19.071"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  brief: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  medal: '<path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/>',
  trash: '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  doc: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  party: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
  raise: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  clip: '<path d="m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/>',
  bellOff: '<path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.673C4.59 13.956 6 12.499 6 8a6 6 0 0 1 .258-1.742"/><path d="m2 2 20 20"/><path d="M8.668 3.01A6 6 0 0 1 18 8c0 2.687.77 4.653 1.707 6.05"/>',
  handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
  receipt: '<path d="M12 17V7"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  unarchive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h2"/><path d="M20 8v11a2 2 0 0 1-2 2h-2"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  book: '<path d="M12 5v16"/><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"/>',
  cap: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  store: '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
  moon: '<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
  coin: '<path d="M13.744 17.736a6 6 0 1 1-7.48-7.48"/><path d="M15 6h1v4"/><path d="m6.134 14.768.866-.5 2 3.464"/><circle cx="16" cy="8" r="6"/>',
  headset: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  mobile: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
  bug: '<path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>',
  mega: '<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
  okCircle: '<circle cx="12" cy="12" r="10"/><path d="m16 9-5.5 5.5L8 12"/>',
  offline: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>'


};
(function mountSprite() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("aria-hidden", "true"); s.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  s.innerHTML = Object.entries(ICON_PATHS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("");
  document.body.prepend(s);
})();
const icon = (name, cls = "") => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/* ---------- Compact numbers in the user's language ---------- */
const nfmt = (n) => { if (!n) return ""; try { return new Intl.NumberFormat(DB.settings?.lang === "en" ? "en" : "ar", { notation: "compact", maximumFractionDigits: 1 }).format(n); } catch { return String(n); } };

/* ---------- App shell ---------- */
(function buildShell() {
  const top = $(".top-actions");
  if (top && !top.querySelector("svg")) top.innerHTML = ` /* v2.145: index.html ships the SVG icons from the first paint; this is only a fallback */
    <a href="#/search" class="icon-btn" aria-label="بحث" title="بحث">${icon("search")}</a>
    <a href="#/messages" class="icon-btn" aria-label="الرسائل" title="الرسائل">${icon("mail")}<span class="badge" id="msgBadge"></span></a>`;
  const brand = $(".brand"); if (brand) brand.innerHTML = `<span class="logo" aria-hidden="true"></span><span class="brand-text">مجتمع بلس</span>`;
  const NAV = { home: ["home", "homeF"], explore: ["compass", "compassF"], communities: ["users", "usersF"], notifications: ["bell", "bellF"], menu: ["menu", "menuF"], me: ["user", "userF"] };
  document.querySelectorAll(".bottomnav a").forEach(a => {
    const [off, on] = NAV[a.dataset.r] || ["home", "homeF"], label = a.querySelector("small").textContent, badge = a.querySelector(".badge");
    a.setAttribute("aria-label", label);
    a.querySelector("span").innerHTML = icon(off, "ic-off") + icon(on, "ic-on") + (badge ? badge.outerHTML : "");
  });
  const nav = $(".bottomnav");
  nav.insertAdjacentHTML("afterbegin", `<a href="#/home" class="side-brand" aria-label="مجتمع بلس"><span class="logo brand-logo" aria-hidden="true"></span><span class="brand-text side-label">مجتمع بلس</span></a>`);
  nav.insertAdjacentHTML("beforeend", `<button class="btn block side-compose" id="sideCompose">${icon("pen", "sm")} منشور جديد</button>`);
  $("#sideCompose").onclick = () => $("#fab").click();
  const fab = $("#fab"); fab.innerHTML = icon("pen"); fab.setAttribute("aria-label", "منشور جديد");
  document.body.insertAdjacentHTML("beforeend", `<aside id="rail" aria-label="اقتراحات"></aside><div class="ptr" id="ptr">${icon("refresh")}</div><button class="new-pill" id="newPill">${icon("arrowUp", "sm")} منشورات جديدة</button>`);
  $("#newPill").onclick = () => { $("#newPill").classList.remove("on"); scrollTo({ top: 0, behavior: "smooth" }); };
})();

/* ---------- Post card polish ---------- */

PostHooks.card("ui#1", 90, (_pcard) => function (p, opts) {
  let h = _pcard(p, opts);
  h = h.replace('<div class="card"', '<div class="card post-card"').replace('<div class="repost-label"><svg class=ei aria-hidden=true><use href=#i-repost /></svg>', `<div class="repost-label">${icon("repost", "xs")}`);
  return h;
});

PostHooks.inner("ui#2", 91, (_pinner) => function (p, opts = {}) {
  let h = _pinner(p, opts);
  if (!p || !h.includes('class="actions"')) return h;
  const u = S.user(p.author) || {}, mine = S.myReaction(p.id), rs = S.reactionsOf(p.id).length, cs = S.commentsOf(p.id).length, rp = S.repostsOf(p.id), saved = S.saved(p.id);
  const rx = mine ? REACTIONS.find(r => r.key === mine.type) : null;
  const likeIcon = !rx ? icon("heart") : rx.key === "like" ? icon("heartF") : `<span class="emo">${rx.icon}</span>`;
  const actions = `<div class="actions" role="group" aria-label="تفاعلات">
    <button data-react="${p.id}" class="a-like ${mine ? "on" : ""}" aria-label="${rx ? rx.label : "إعجاب"}" aria-pressed="${!!mine}">${likeIcon}<span>${nfmt(rs)}</span></button>
    <button data-go="#/post/${p.id}" class="a-com" aria-label="تعليقات">${icon("comment")}<span>${nfmt(cs)}</span></button>
    <button data-share="${p.id}" class="a-rep" aria-label="إعادة نشر أو اقتباس">${icon("repost")}<span>${nfmt(rp)}</span></button>
    <span class="act views" role="img" aria-label="${nfmt(p.views) || 0} مشاهدة">${icon("chart", "sm")}<span style="margin-inline-start:5px">${nfmt(p.views)}</span></span>
    <button data-save="${p.id}" class="a-save ${saved ? "on" : ""}" aria-label="حفظ" aria-pressed="${saved}">${icon(saved ? "bookmarkF" : "bookmark")}</button>
  </div>`;
  h = h.replace(/<div class="actions">[\s\S]*?<\/div>/, actions);
  h = h.replace(`<button class="more" data-more="${p.id}">⋯</button>`, `<button class="more" data-more="${p.id}" aria-label="خيارات">${icon("more")}</button>`);
  if (u.badge) h = h.replace(`<span class="badge-v">✦ ${u.badge}</span>`, `${icon("verified", "xs verified")} <span class="badge-v">${esc(u.badge)}</span>`);
  if (u.creator || u.badge) h = h.replace(`class="av " style="background:${u.color}"`, `class="av ring" style="background:${u.color}"`);
  h = h.replace(/(<a class="chip" href="#\/c\/[^"]+">)<svg class=ei aria-hidden=true><use href=#i-users \/><\/svg> /, `$1${icon("community", "xs")} `);
  h = h.replace(" · <svg class=ei aria-hidden=true><use href=#i-lock /></svg>", ` · ${icon("lock", "xs")}`);
  h = h.replace(/<div class="media" style="background:(url\([^"]*?\)[^"]*)"><\/div>/g, '<div class="media zoomable" data-zoom="1" style="background:$1"></div>');
  return h;
});

/* ---------- Gestures ---------- */
const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch { } };
function burst(x, y) { const d = document.createElement("div"); d.className = "heart-burst"; d.style.left = x + "px"; d.style.top = y + "px"; d.innerHTML = icon("heartF", "lg").replace('class="ic', 'style="width:96px;height:96px" class="ic'); document.body.appendChild(d); setTimeout(() => d.remove(), 850); }
function quickLike(pid) {
  const p = S.post(pid); if (!p) return;
  const mine = S.myReaction(pid);
  Cmd.react(pid, mine ? mine.type : "like", p.author);
  haptic(); patchPost(pid);
  requestAnimationFrame(() => document.querySelectorAll(`#view [data-react="${pid}"]`).forEach(b => b.classList.add("pop")));
}
let lpTimer = null, lpFired = false;
document.addEventListener("pointerdown", e => {
  const b = e.target.closest("[data-react]"); if (!b) return;
  lpFired = false; clearTimeout(lpTimer);
  lpTimer = setTimeout(() => { lpFired = true; haptic(15); reactPicker(b.dataset.react); }, 420);
}, true);
["pointerup", "pointercancel", "pointerleave"].forEach(t => document.addEventListener(t, () => clearTimeout(lpTimer), true));
document.addEventListener("click", e => {
  const b = e.target.closest("[data-react]"); if (!b || b.closest("#sheet")) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (lpFired) { lpFired = false; return; }
  quickLike(b.dataset.react);
}, true);
document.addEventListener("contextmenu", e => { if (e.target.closest("[data-react]")) e.preventDefault(); });
// double-tap on a post body/media → like with heart burst
let lastTap = { t: 0, id: null };
document.addEventListener("click", e => {
  const card = e.target.closest(".post-card"); if (!card || e.target.closest("button,[data-more],.actions,a.name,.chip,.poll,[data-play]")) return;
  const rb = card.querySelector("[data-react]"); if (!rb) return;
  const id = rb.dataset.react, now = Date.now();
  if (lastTap.id === id && now - lastTap.t < 320) {
    e.preventDefault(); e.stopImmediatePropagation(); lastTap = { t: 0, id: null };
    burst(e.clientX, e.clientY); if (!S.myReaction(id)) quickLike(id); else haptic();
    return;
  }
  lastTap = { t: now, id };
  const zoom = e.target.closest("[data-zoom]");
  if (zoom) { e.preventDefault(); e.stopImmediatePropagation(); setTimeout(() => { if (lastTap.t === now) lightbox(zoom.style.background); }, 330); return; }
  // the body opens the post (a <div>, not an <a>: hashtags and mentions inside are links of their own)
  const inner = e.target.closest("a[href]"), link = inner ? (inner.getAttribute("href").startsWith("#/post/") ? inner : null) : e.target.closest("[data-open]");
  if (link) { e.preventDefault(); e.stopImmediatePropagation(); const href = link.getAttribute("href") || link.dataset.open; setTimeout(() => { if (lastTap.t === now) location.hash = href; }, 300); }
}, true);

// cards outside the feed (no double-tap handler above) still open the post from its body
document.addEventListener("click", e => { const o = e.target.closest("[data-open]"); if (!o || e.defaultPrevented || e.target.closest("a,button,input,select,textarea,label,.poll,[data-zoom]")) return; location.hash = o.dataset.open; });

function lightbox(bg) {
  const d = document.createElement("div"); d.className = "lightbox"; d.setAttribute("role", "dialog"); d.setAttribute("aria-label", "عرض الصورة");
  d.innerHTML = `<div style="background:${bg}"></div><button aria-label="إغلاق">${icon("x")}</button>`;
  d.onclick = () => d.remove(); document.addEventListener("keydown", function k(ev) { if (ev.key === "Escape") { d.remove(); document.removeEventListener("keydown", k); } });
  document.body.appendChild(d);
}

/* Bottom sheet: swipe down to dismiss, Escape to close, focus trap entry */
(function sheetGestures() {
  const sh = $("#sheet"); let y0 = null, dy = 0, panel = null;
  sh.addEventListener("touchstart", e => { panel = e.target.closest(".panel"); if (!panel || panel.scrollTop > 0) return (y0 = null); y0 = e.touches[0].clientY; dy = 0; panel.style.transition = "none"; }, { passive: true });
  sh.addEventListener("touchmove", e => { if (y0 === null || !panel) return; dy = Math.max(0, e.touches[0].clientY - y0); panel.style.transform = `translateY(${dy}px)`; }, { passive: true });
  sh.addEventListener("touchend", () => { if (y0 === null || !panel) return; panel.style.transition = "transform .25s var(--ease)"; if (dy > 110) { panel.style.transform = "translateY(100%)"; setTimeout(closeSheet, 200); } else panel.style.transform = ""; y0 = null; });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !sh.classList.contains("hidden")) closeSheet(); });
  new MutationObserver(() => { if (!sh.classList.contains("hidden")) { const p = sh.querySelector(".panel"); if (p) { p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true"); setTimeout(() => { if (sh.classList.contains("hidden")) return; const cur = sh.querySelector(".panel") || p, a = document.activeElement; /* v2.54: the sheet set its own initial focus (e.g. a dialog title) — don't steal it */ if (a && a !== document.body && sh.contains(a)) return; (cur.querySelector("[autofocus]") || cur.querySelector("textarea,input,button") || cur).focus({ preventScroll: true }); }, 60); } } }).observe(sh, { attributes: true, attributeFilter: ["class"] });
})();

/* Pull to refresh (touch, top of page) */
(function pullToRefresh() {
  const ptr = $("#ptr"); let y0 = null, pulled = 0;
  addEventListener("touchstart", e => { if (scrollY > 0 || !$("#sheet").classList.contains("hidden") || document.body.classList.contains("ob")) return (y0 = null); y0 = e.touches[0].clientY; pulled = 0; }, { passive: true });
  addEventListener("touchmove", e => { if (y0 === null) return; pulled = Math.min(120, Math.max(0, e.touches[0].clientY - y0)); if (pulled > 8) { ptr.style.opacity = Math.min(1, pulled / 70); ptr.style.transform = `translateY(${pulled - 60}px) rotate(${pulled * 3}deg) scale(${.6 + Math.min(pulled, 80) / 200})`; } }, { passive: true });
  addEventListener("touchend", async () => {
    if (y0 === null) return; y0 = null;
    if (pulled > 80) { ptr.classList.add("spin"); haptic(10); try { if (window.REMOTE && typeof refresh === "function") await refresh(); else rerender(); } finally { setTimeout(() => { ptr.classList.remove("spin"); ptr.style.opacity = 0; ptr.style.transform = ""; }, 400); } }
    else { ptr.style.opacity = 0; ptr.style.transform = ""; }
  });
})();

/* the «new posts» pill goes away near the top; v2.52: hiding the bars while scrolling lives in nav.js (body.bars-off) */
(function newPillTop() {
  addEventListener("scroll", () => { if (scrollY < 80) $("#newPill").classList.remove("on"); }, { passive: true });
})();

/* ---------- Routing hooks: page motion, right rail, onboarding steps ---------- */
/* the entrance animation plays once per navigation — never on a re-render of the same screen (that was the
 * «everything flashes when I tap» bug: every tap re-rendered the view and replayed the fade-in) */
let lastEnter = null, enterT = 0;
function afterRoute() {
  const v = $("#view"), key = location.hash.split("?")[0] || "#/home";
  // v2.52: no forced reflow (offsetWidth) to restart the animation — the new screen's nodes are new, so they animate on insertion
  if (!window.__softRender && key !== lastEnter) { lastEnter = key; v.classList.add("enter"); clearTimeout(enterT); enterT = setTimeout(() => v.classList.remove("enter"), 700); }
  renderRail(); syncThemeColor();
}
const _route = route;
route = function () { _route(); afterRoute(); };
window.addEventListener("hashchange", () => setTimeout(afterRoute, 0));
const _onb = Views.onboarding;
Views.onboarding = function (step) { _onb(step); const v = $("#view"); if (v.querySelector(".ob-steps")) return; const s = v.querySelector("#n1") ? 1 : v.querySelector("#n2") ? 2 : v.querySelector("#n3") ? 3 : 0; if (s) v.querySelector(".wrap")?.insertAdjacentHTML("afterbegin", `<div class="ob-steps">${[1, 2, 3].map(i => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</div>`); if (s === 1) { const lg = v.querySelector(".logo"); if (lg) lg.outerHTML = `<div class="auth-hero" style="padding-top:0"><div class="mark brandmark" aria-hidden="true"></div></div>`; } };

function renderRail() {
  const rail = $("#rail"); if (!rail || innerWidth < 1180 || !DB.onboarded) { if (rail && rail.firstChild) rail.innerHTML = ""; return; }
  const trends = (Trends.multi ? Trends.multi() : Trends.list()).slice(0, 5);
  const following = new Set(S.following(DB.me));
  const people = DB.users.filter(u => u.id !== DB.me && !following.has(u.id) && !DB.blocked.includes(u.id))
    .sort((a, b) => (b.topics || []).filter(t => DB.interests.includes(t)).length - (a.topics || []).filter(t => DB.interests.includes(t)).length).slice(0, 3);
  const comms = DB.communities.filter(c => !S.membership(c.id) && c.type !== "invite").slice(0, 3);
  rail.innerHTML = `
    <label class="rail-search">${icon("search", "sm")}<input id="railq" placeholder="ابحث في مجتمع بلس" aria-label="بحث"></label>
    ${trends.length ? `<div class="rail-card"><h2>${icon("fire", "sm")} الرائج الآن</h2>${trends.map((t, i) => `<a class="rail-row" href="#/tag/${encodeURIComponent(t.tag)}"><span class="muted" style="width:16px">${i + 1}</span><span class="grow"><span class="t">#${esc(t.tag)}</span><span class="muted">${t.unique || t.users?.size || 0} مشارك · ${t.posts} منشور</span></span></a>`).join("")}<a href="#/trends" class="muted" style="display:block;margin-top:6px;color:var(--accent);font-weight:650">عرض المزيد</a></div>` : ""}
    ${people.length ? `<div class="rail-card"><h2>أشخاص قد تعرفهم</h2>${people.map(u => `<div class="rail-row">${av(u, "sm")}<a class="grow" href="#/u/${u.handle}"><span class="t">${esc(u.name)}</span><span class="muted"><bdi>@${u.handle}</bdi></span></a><button class="btn" data-follow="${u.id}" style="padding:7px 14px;font-size:13px">متابعة</button></div>`).join("")}</div>` : ""}
    ${comms.length ? `<div class="rail-card"><h2>مجتمعات مقترحة</h2>${comms.map(c => `<div class="rail-row"><span class="av sm" style="background:${c.color}">${icon("community", "xs").replace('class="ic', 'style="stroke:#fff" class="ic')}</span><a class="grow" href="#/c/${c.id}"><span class="t">${esc(c.name)}</span><span class="muted">${S.members(c.id).length} عضو</span></a><button class="btn ghost" data-join="${c.id}" style="padding:7px 14px;font-size:13px">انضمام</button></div>`).join("")}</div>` : ""}
    <div class="rail-foot">مجتمع بلس ${UI_VERSION} · الخصوصية · الشروط · المساعدة</div>`;
  $("#railq").onkeydown = e => { if (e.key === "Enter") { view._q = e.target.value; location.hash = "#/explore"; setTimeout(() => { const s = $("#sq"); if (s) { s.value = view._q; s.dispatchEvent(new Event("input")); } }, 60); } };
}
addEventListener("resize", () => { clearTimeout(window._rz); window._rz = setTimeout(renderRail, 200); });

/* ---------- Theme color follows the active theme ---------- */
let themeKey = "";
function syncThemeColor() {
  const H = document.documentElement, k = [H.dataset.theme, H.dataset.palette, H.dataset.oled, document.getElementById("mp-ui")?.textContent.length].join("|");
  if (k === themeKey) return; themeKey = k; // v2.52: getComputedStyle only when the theme changed, not on every route
  let m = document.querySelector('meta[name="theme-color"]'); if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
  m.content = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f5f4fa";
}

/* ---------- Toast with icon semantics ---------- */
const _toast = toast;
toast = function (msg) { _toast(msg); const t = $("#toast"); const ok = /✓|تم|انضممت|شكراً/.test(msg); t.innerHTML = (ok ? icon("check", "sm") + " " : "") + esc(noEmo(String(msg).replace(/\s*✓\s*/, ""))); t.setAttribute("role", "status"); };

/* ---------- Realtime “new posts” pill instead of jumping content ---------- */
if (typeof connectStream === "function") {
  const _cs = connectStream;
  connectStream = function () { _cs(); try { Remote.es.addEventListener("changed", e => { const d = JSON.parse(e.data || "{}"); if (d.scope === "POST_PUBLISHED" && scrollY > 400 && /home/.test(location.hash)) $("#newPill").classList.add("on"); }); } catch { } };
}

/* ---------- Auth screen visual upgrade (remote mode) ---------- */
if (typeof showAuth === "function") {
  const _sa = showAuth;
  showAuth = function (mode) {
    _sa(mode);
    const hero = $("#view .logo")?.parentElement;
    if (hero) hero.outerHTML = `<div class="auth-hero"><div class="mark brandmark" aria-hidden="true"></div><h1>مجتمع بلس</h1><p class="u-t-md u-mt6 muted">مساحة تجمع الناس حول ما يهمهم.<br>اكتشف، تابع، وشارك.</p></div>`;
    $("#view .card")?.style.setProperty("padding", "20px");
  };
}

/* ---------- Settings: appearance preview + version ---------- */
MPSettings.add(function () { const ver = $("#ver"); if (ver && !ver.textContent.includes(UI_VERSION)) ver.textContent = ver.textContent.replace(/^[\d.]+/, UI_VERSION); });

/* keyboard: "n" new post, "/" search, "g h" home */
let gKey = false;
document.addEventListener("keydown", e => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey || !DB.onboarded) return;
  if (gKey && e.key === "h") location.hash = "#/home";
  else if (gKey && e.key === "n") location.hash = "#/notifications";
  else if (gKey && e.key === "m") location.hash = "#/menu";
  else if (e.key === "n") { e.preventDefault(); $("#fab").click(); }
  else if (e.key === "/") { e.preventDefault(); location.hash = "#/search"; }
  gKey = e.key === "g"; setTimeout(() => (gKey = false), 800);
});

syncThemeColor();
if (!window.__deferRoute) route();

/* ---------- v2.32 shared components (documented in gallery.html) ---------- */
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/* page head: back [href, label] · title (+ optional leading sprite icon) · subtitle · actions html; row: actions beside the title */
const noEmo = (t) => String(t ?? "").replace(/^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\uFE0F\u200D]*)+\s*|\s*(?:[\p{Extended_Pictographic}][\uFE0F\u200D]*)+$/gu, "");
/* page head: back [href, label] · title (+ optional leading sprite icon; leading/trailing emoji dropped) · subtitle · actions html; row: actions beside the title; id: h2 id (focus target) */
const pageHead = ({ back, title, icon: ico, sub, actions, row, id } = {}) => `<header class="page-head${row ? " row-head" : ""}">${back ? `<a class="back" href="${back[0]}"><span class="fwd" aria-hidden="true">→</span> ${escH(back[1])}</a>` : ""}<div class="ph-main"><div><h2${id ? ` id="${id}" tabindex="-1"` : ""}>${ico ? icon(ico) : ""}${escH(noEmo(title))}</h2>${sub ? `<p class="sub">${escH(sub)}</p>` : ""}</div>${actions ? `<div class="acts">${actions}</div>` : ""}</div></header>`;
/* grouped list row: { href | button, icon, title, sub, end (trailing html), id } */
const li = ({ href, icon: ico, title, sub, end, id, attrs = "" } = {}) => `<${href ? `a href="${href}"` : `button type="button"`} class="li"${id ? ` id="${id}"` : ""} ${attrs}>${ico ? `<span class="ico">${icon(ico, "sm")}</span>` : ""}<span class="t"><b>${escH(noEmo(title))}</b>${sub ? `<small>${escH(sub)}</small>` : ""}</span>${end ?? (href ? `<span class="chev" aria-hidden="true">←</span>` : "")}</${href ? "a" : "button"}>`;
/* empty state: title, one line, at most one action (html) */
const empty = ({ title, text, action } = {}) => `<div class="empty" role="status">${title ? `<span class="empty-t">${escH(title)}</span>` : ""}${text ? `<span class="empty-x">${escH(text)}</span>` : ""}${action || ""}</div>`;
/* one digit policy: Western (latn) digits everywhere, grouped for the UI language */
const num = (n, o = {}) => { try { return new Intl.NumberFormat((DB.settings && DB.settings.lang) || "ar", { numberingSystem: "latn", ...o }).format(n || 0); } catch { return String(n || 0); } };
/* v2.76 «يظهر في فيديوتك»: a strip of the Vidtik clips that link this listing / job, appended to `host` on its page.
 * GET /api/clips/linked?kind=&id= (visible published clips only, newest first, max 12). Nothing at all when there are none.
 * A tile opens the Vidtik viewer on that clip (#/clips?start=<id>); the clips are put in DB.posts so it opens at once. */
async function vidtikStrip(kind, id, host) {
  if (!host || !window.Remote?.api || !navigator.onLine) return;
  let r; try { r = await Remote.api("GET", `/api/clips/linked?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`); } catch { return; }
  const items = (r && r.items) || []; if (!items.length || !host.isConnected || host.querySelector(".vt-strip")) return;
  const T = (x) => (window.MPI18n?.t ? MPI18n.t(x) : x);
  for (const p of items) if (window.DB?.posts && !DB.posts.some((x) => x.id === p.id)) DB.posts.push(p);
  const poster = (p) => { const v = p.video || {}; return MPVideoSources.poster(v) || p.cover || ""; };
  const sec = document.createElement("section"); sec.className = "card vt-strip"; sec.setAttribute("aria-labelledby", "vt-strip-h");
  sec.innerHTML = `<h3 id="vt-strip-h" class="vt-strip-h">${icon("play", "sm")}<span>${escH(T("يظهر في فيديوتك"))}</span></h3><ul class="vt-strip-l">${items.map((p) => { const po = poster(p), who = p.user?.name || ""; return `<li><a class="vt-strip-t" href="#/clips?start=${encodeURIComponent(p.id)}" aria-label="${escH(T("فيديو"))}${who ? " · " + escH(who) : ""} · ${escH(num(p.counts?.likes || 0))}">${po ? `<img src="${escH(po)}" alt="" loading="lazy" decoding="async" width="96" height="170">` : `<span class="vt-strip-ph" aria-hidden="true">${icon("play")}</span>`}<span class="vt-strip-n" aria-hidden="true">${icon("heart", "xs")}<bdi dir="ltr">${escH(num(p.counts?.likes || 0))}</bdi></span></a></li>`; }).join("")}</ul>`;
  host.appendChild(sec);
}
window.UI = { icon, nfmt, renderRail, pageHead, li, noEmo, empty, num, vidtikStrip, version: UI_VERSION };
})();
