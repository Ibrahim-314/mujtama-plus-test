/* The prologue's camera: every shot, in order, for the sequencer (bjs/cinema.js). Pure data, no imports.
 * Each set (bjs/prologue-sets.js) is built at its own origin, far from the others, and only the set a shot names is
 * enabled; shot positions here are relative to that set's origin. `cut: true` hides the jump behind a quick black dip.
 * EVENTS are moments the scene reacts to (the device waking, the lights failing, the title), in sequence seconds. */
export const SET_ORIGIN = {
  village: [0, 0, 0],
  home: [2000, 0, 0],
  train: [4000, 0, 0],
  city: [6000, 0, 0],
  cabin: [8000, 0, 0]
};

// home: the device on the table, the key beside it, the protagonist standing at the table (see prologue-sets.js)
const DEVICE = [0.1, 0.93, -1.3], KEY = [0.52, 0.8, -0.86];
// the centre of the device's screen and its facing (the device is turned 0.18 rad towards the room)
const SCREEN = [0.195, 0.97, -1.168], SN = [Math.sin(0.18), 0, Math.cos(0.18)];
const onScreen = (d, up = 0, side = 0) => [SCREEN[0] + SN[0] * d + side * SN[2], SCREEN[1] + up, SCREEN[2] + SN[2] * d - side * SN[0]];

export const SHOTS = [
  // 1 — the mountain village at dawn: a slow aerial drift over the terraces towards the houses
  { set: "village", cut: true, dur: 13, ease: "inOutSine", from: { pos: [-150, 92, 190], look: [10, 26, -40] }, to: { pos: [-62, 52, 118], look: [14, 24, 10] } },
  // 2 — down to the protagonist's house at the edge of the village
  { set: "village", dur: 4, ease: "inOutCubic", to: { pos: [4, 30, 58], look: [16, 22, 20] } },
  // 2b — inside: the room in the first light, pushing in on the old device
  { set: "home", cut: true, dur: 8, ease: "inOutSine", from: { pos: [-2.3, 1.85, 2.1], look: DEVICE }, to: { pos: [-0.75, 1.3, 0.15], look: DEVICE } },
  // 3 — Yousuf's message: over the protagonist's shoulder, then the screen
  { set: "home", cut: true, dur: 6, ease: "inOutSine", from: { pos: [0.75, 1.68, 0.95], look: SCREEN }, to: { pos: [0.5, 1.58, 0.5], look: SCREEN } },
  { set: "home", cut: true, dur: 6, ease: "inOutSine", from: { pos: onScreen(0.46, 0.05, 0.06), look: SCREEN }, to: { pos: onScreen(0.3, 0.02, 0.02), look: SCREEN } },
  // 4 — the mother in the doorway, then the brass key
  { set: "home", cut: true, dur: 5, ease: "inOutSine", from: { pos: [-2.5, 1.45, 1.9], look: [2.5, 1.3, 1.0] }, to: { pos: [-2.0, 1.4, 1.5], look: [2.5, 1.25, 1.0] } },
  { set: "home", cut: true, dur: 6, ease: "inOutSine", from: { pos: [1.12, 0.9, -0.38], look: KEY }, to: { pos: [0.92, 0.86, -0.5], look: KEY }, data: { dof: KEY } },
  // 5 — the magnetic train in the dark: tracking along the cars to the nose
  { set: "train", cut: true, dur: 12, ease: "inOutSine", from: { pos: [-11, 9, 34], look: [0, 10, 12] }, to: { pos: [-8, 12.5, -26], look: [0, 10, -60] } },
  // 6 — the city reveal: rising over the outer towers until the golden tower fills the frame
  { set: "city", cut: true, dur: 12, ease: "inOutSine", from: { pos: [-330, 24, 560], look: [0, 60, 0] }, to: { pos: [-175, 150, 300], look: [0, 125, 0] } },
  // 7 — inside the train: down the aisle to the display, then hold on the signal and the title
  { set: "cabin", cut: true, dur: 8, ease: "inOutSine", from: { pos: [0.3, 1.55, 5.2], look: [0, 1.7, -6] }, to: { pos: [0.08, 1.62, -2.4], look: [0, 1.96, -7.4] } },
  { set: "cabin", dur: 6, hold: true }
];

export const EVENTS = [
  { at: 21.5, ev: "device-on" },
  { at: 25.6, ev: "message" },
  { at: 37.0, ev: "message-end" },
  { at: 48.0, ev: "train" },
  { at: 74.5, ev: "lights-fail" },
  { at: 75.8, ev: "signal" },
  { at: 80.5, ev: "title" }
];

export const DURATION = SHOTS.reduce((s, x) => s + x.dur, 0);

/** Each shot's start time in sequence seconds. */
export const shotStarts = () => { let t = 0; return SHOTS.map((s) => { const a = t; t += s.dur; return a; }); };

/** Offset a shot's set-relative positions by its set's origin (for the sequencer). */
export function worldShots() {
  const add = (o, p) => (p ? [p[0] + o[0], p[1] + o[1], p[2] + o[2]] : undefined);
  return SHOTS.map((s) => {
    const o = SET_ORIGIN[s.set];
    return {
      dur: s.dur, ease: s.ease, hold: s.hold,
      from: s.from ? { pos: add(o, s.from.pos), look: add(o, s.from.look) } : undefined,
      to: s.to ? { pos: add(o, s.to.pos), look: add(o, s.to.look) } : undefined,
      data: { set: s.set, cut: !!s.cut, dof: s.data?.dof ? add(o, s.data.dof) : null }
    };
  });
}
