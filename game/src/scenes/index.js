/* Every place in the game, by name. Each one is a separate module so a scene's code only runs when the player goes there.
 * To add a place: create scenes/<name>.js exporting create(game, params), then add one line here. */
import { isPixel } from "../px/mode.js";

export const SCENES = {
  title: () => import("./title.js"),
  creator: () => import("./creator.js"),
  prologue: (g = globalThis.MPGame) => (isPixel(g) ? import("./prologue-px.js") : import("./prologue.js")),
  // 2026-10-27: the room and the street draw in 2D pixel art unless the player chose the 3D world in Settings
  room: (g = globalThis.MPGame) => (isPixel(g) ? import("./room-px.js") : import("./room.js")),
  street: (g = globalThis.MPGame) => (isPixel(g) ? import("./street-px.js") : import("./street.js"))
};
