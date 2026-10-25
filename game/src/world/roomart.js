/* Canvas paintings for the apartment (shared look with the classic three.js room): oak planks + a matching
 * roughness map, a contact-shadow blob, curtain folds, two framed prints, plaster, and the void around the diorama.
 * Each returns plain canvases so either engine can wrap them as textures. */
export function paintFloor(n = 1024) {
  const cv = document.createElement("canvas"); cv.width = cv.height = n; const x = cv.getContext("2d");
  const rc = document.createElement("canvas"); rc.width = rc.height = n / 2; const r = rc.getContext("2d");
  r.fillStyle = "#5a5a5a"; r.fillRect(0, 0, n / 2, n / 2);
  const rows = 8, ph = n / rows, tones = ["#6b4a33", "#74513a", "#5f412d", "#7a5840", "#684733", "#704d36"];
  for (let i = 0; i < rows; i++) {
    const y = i * ph; let xx = -((i * 397) % n);
    while (xx < n) {
      const len = n * (0.45 + ((i * 7 + Math.floor(xx)) % 5) * 0.08);
      x.fillStyle = tones[(i * 3 + Math.abs(Math.floor(xx / 50))) % tones.length]; x.fillRect(xx, y, len, ph);
      // grain
      for (let g = 0; g < 26; g++) { const gy = y + Math.random() * ph; x.strokeStyle = `rgba(${Math.random() < 0.5 ? "40,24,14" : "150,110,80"},${0.08 + Math.random() * 0.12})`; x.lineWidth = 0.6 + Math.random() * 1.4; x.beginPath(); x.moveTo(xx, gy); for (let s = 0; s <= 8; s++) x.lineTo(xx + (len * s) / 8, gy + Math.sin(s * 1.3 + g) * 1.6); x.stroke(); }
      if (Math.random() < 0.35) { const kx = xx + Math.random() * len, ky = y + ph * (0.3 + Math.random() * 0.4); const kg = x.createRadialGradient(kx, ky, 0, kx, ky, ph * 0.18); kg.addColorStop(0, "rgba(35,20,10,.75)"); kg.addColorStop(1, "rgba(35,20,10,0)"); x.fillStyle = kg; x.fillRect(kx - ph * 0.3, ky - ph * 0.3, ph * 0.6, ph * 0.6); }
      x.fillStyle = "#24160d"; x.fillRect(xx, y, 2, ph); r.fillStyle = "#c8c8c8"; r.fillRect(xx / 2, y / 2, 1.5, ph / 2);
      xx += len;
    }
    x.fillStyle = "#1e120a"; x.fillRect(0, y, n, 2.5); r.fillStyle = "#d0d0d0"; r.fillRect(0, y / 2, n / 2, 1.5);
    const sh = x.createLinearGradient(0, y, 0, y + ph); sh.addColorStop(0, "rgba(255,230,200,.05)"); sh.addColorStop(1, "rgba(0,0,0,.08)"); x.fillStyle = sh; x.fillRect(0, y, n, ph);
  }
  return { cv, rc };
}

export function paintBlob() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128; const x = cv.getContext("2d");
  const g = x.createRadialGradient(64, 64, 8, 64, 64, 64); g.addColorStop(0, "rgba(0,0,0,.75)"); g.addColorStop(0.55, "rgba(0,0,0,.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); return cv;
}

export function paintCurtain() {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 32; const x = cv.getContext("2d");
  const g = x.createLinearGradient(0, 0, 256, 0); for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, i % 2 ? "#3b1d4f" : "#5a2d73"); x.fillStyle = g; x.fillRect(0, 0, 256, 32);
  return cv;
}

export function paintArt(kind) {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 320; const x = cv.getContext("2d");
  if (kind === 0) {
    const g = x.createLinearGradient(0, 0, 0, 320); g.addColorStop(0, "#1a0b3d"); g.addColorStop(0.55, "#c2367a"); g.addColorStop(0.62, "#ffb347"); g.addColorStop(0.62, "#14082a"); g.addColorStop(1, "#05020d"); x.fillStyle = g; x.fillRect(0, 0, 256, 320);
    x.fillStyle = "#ffd36b"; x.beginPath(); x.arc(128, 190, 60, Math.PI, 0); x.fill(); x.fillStyle = "#1a0b3d"; for (let i = 0; i < 5; i++) x.fillRect(60, 150 + i * 9, 136, 3 + i);
    x.strokeStyle = "#ff3fb4"; x.lineWidth = 2; for (let i = 0; i < 8; i++) { x.beginPath(); x.moveTo(128, 200); x.lineTo(-200 + i * 93, 320); x.stroke(); } for (let i = 0; i < 6; i++) { const y = 205 + i * i * 4; x.beginPath(); x.moveTo(0, y); x.lineTo(256, y); x.stroke(); }
  } else {
    x.fillStyle = "#0d1426"; x.fillRect(0, 0, 256, 320);
    x.strokeStyle = "#ffc23d"; x.lineWidth = 10; x.beginPath(); x.arc(128, 150, 80, 0, Math.PI * 2); x.stroke();
    x.fillStyle = "#2fe6ff"; x.font = "bold 70px sans-serif"; x.textAlign = "center"; x.fillText("MJT", 128, 175);
    x.fillStyle = "rgba(255,255,255,.5)"; x.font = "16px sans-serif"; x.fillText("MUJTAMA COIN", 128, 285);
  }
  return cv;
}

export function paintVoid() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 512; const x = cv.getContext("2d");
  const g = x.createRadialGradient(256, 230, 20, 256, 256, 360); g.addColorStop(0, "#1a1d3a"); g.addColorStop(0.6, "#0a0b1c"); g.addColorStop(1, "#020208");
  x.fillStyle = g; x.fillRect(0, 0, 512, 512); return cv;
}

export function paintWall() {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 256; const x = cv.getContext("2d");
  // warm plaster with a fine trowel texture
  x.fillStyle = "#3a3550"; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { const l = Math.random() < 0.5; x.fillStyle = `rgba(${l ? "255,240,230" : "0,0,0"},${Math.random() * (l ? 0.035 : 0.07)})`; x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  return cv;
}

