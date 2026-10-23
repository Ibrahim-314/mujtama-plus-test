# مجتمع بلس — «المدينة» (`city/`)

A still isometric night city at the top of the member's own profile (#/me). Tap a street: a glowing route draws along the
streets and the character walks it. Tap a building: the character walks to its door, steps in, a portal opens and the
building's **own, independent system** loads. The city never merges systems; it only opens doors.

```
city/
  entry.js          CORE (tiny): reserves the slot at the top of #/me, loads the lazy "town" chunk, keeps the slot across re-renders
  path.js           pure street graph: snap a tap to a street, Dijkstra shortest route, point-in-polygon, scene check (unit-tested)
  scenes/main.js    DATA: art, palette, street nodes/edges, places (door, tap area, sign board, accent, icon, href)
  core.js           engine: MPCity.mount / use(feature) / actor(name, renderer); layers; one rAF loop only while walking
  lights.js         feature: live neon labels drawn into the art's empty boards + breathing glow spots
  trail.js          feature: glowing route, pulses running ahead, eaten behind the character; tap ring / miss ripple
  actor-token.js    character renderer "token" (member emblem on a holo base) — light fallback for the 3D character
  portal.js         feature: door → full-screen portal → the building's route
  debug.js          feature: #/town?debug=1 calibration overlay (graph, areas, boards, tapped coordinates)
  profile.js        MPCityMountProfile(slot) + the #/town page
  boot.js           LAST file of the chunk (development self-render)
  city.css          all styles, prefix cy-*
public/city/        the art (WebP 1024 + 640)
```

## Rules
- The art carries no text: every label is live SVG (Arabic/English, follows a language switch).
- Animations are opacity/transform only, pause off-screen (`.cy-off`), and stop under reduced motion (no walk: arrive in place).
- No SVG filters on animated layers (Pi Browser / weak phones).
- A new building = a new entry in `scenes/main.js` (door node, tap area, sign board, icon, href) — no engine change.
- A new character = `MPCity.actor("3d", factory)` and `window.MPCityActor = "3d"`; "token" stays the fallback.
- Never remove a system or a route; Pi features stay «غير مفعّل بعد». MJT is an internal off-chain balance.
