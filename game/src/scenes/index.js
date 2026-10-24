/* Every place in the game, by name. Each one is a separate module so a scene's code only runs when the player goes there.
 * To add a place: create scenes/<name>.js exporting create(game, params), then add one line here. */
export const SCENES = {
  title: () => import("./title.js"),
  creator: () => import("./creator.js"),
  room: () => import("./room.js"),
  street: () => import("./street.js")
};
