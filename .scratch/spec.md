# Racing Boy: design (agreed 2026-11-21)

A sibling of Dig Through Worlds (`~/dig`): plain HTML/JS, no build step, pixel art drawn in code, the HD-2D
post-process copied from Dig, phone and desktop, hosted on GitHub Pages (`shauneshraghi/racing-boy`).

## User decisions (settled; do not re-ask)
- Camera: a third-person chase camera behind the player's car, like Super Nintendo kart racers ("Mode 7" ground,
  scrolling backdrop, distance-scaled sprites). Changed 2026-11-21 from the original fixed isometric camera; the plaza stays isometric.
- Progression (2026-11-21): faster cars unlocked by winning races, Turbo (acceleration) and Glider (ramp air time)
  upgrades alongside Engine, Tires, Boost and Armor.
- Phone controls (2026-11-21): left half of the screen is a floating joystick, right half held is drift; a drift
  starts with a hop.
- Platform: phone and desktop. Phone: the car accelerates on its own; left/right steer buttons (or a drag stick
  that points the car), a brake/drift button, an item button. Keyboard on desktop.
- Structure: themed worlds of 3 tracks. First build: one world (Grassy Hills Town), the world table sized for 5
  (desert, ice, volcano, moon later).
- Audience: kids, forgiving. Rubber-band AI, every finish pays, gentle difficulty by world.
- Unlocks: only a 1st place unlocks the next track; winning all three tracks of a world opens the next world.
- Race: 6 racers (player + 5 named AI kids). Hand-made tracks, heights but no crossovers. Long tracks 2 laps,
  short 3; a stock-car race lasts 2–3 minutes, checked by a bot test.
- Items: 1–2 rows of item boxes per track, ~10 s respawn, hold one item. Mostly self-help: turbo, shield, coin
  magnet, a goo puddle that slows, a rare homing item. Hits slow, never a long spin-out. Rivals use the boxes too.
- AI: rubber-band, a clean drive in the stock car beats world 1; later worlds need upgrades.
- Ground boosts, ramps with an air trick (drift button mid-air) that boosts on landing, simple drift with a
  mini-boost on release. Off-road (rough grass) slows, low walls bounce gently, only jump gaps drop you, with a
  quick put-back on the road.
- Economy: coins (place pay + coins picked up on track) and parts (bolts, gears, springs, chips, crystals; one
  tier per world) for upgrades and cars, like Dig's materials.
- Cars: 5 to start, own several; start with one, buy the rest at the car lot. Each has base stats (speed, accel,
  grip, weight), its own upgrade caps and one perk.
- Upgrades per car (Turbo and Glider added 2026-11-21, see above): Engine (top speed), Tires (grip, less off-road slowdown), Boost (pad, drift and turbo
  strength), Armor (shorter slowdowns from hits).
- Customisation per car: paint and trim colours, parts (wheels, spoiler, exhaust, horn) and the boost trail.
- Hub: one kid driver walks a garage plaza like Dig's: garage (upgrades), paint shop (customise), car lot
  (buy/select), track signpost (race).
- Code: copy and adapt Dig's post.js, audio and sprite approach; no shared library.

## Implementation decisions
- Tracks are written as closed centreline control points (Catmull-Rom, sampled every 0.5 cells) with a road
  half-width; features (boost pads, ramps, gaps, item rows, coin lines) are placed by arc length `s` and lateral
  offset. The same centreline gives lap progress, race order, rubber-banding, put-back and AI steering.
- Fixed logic step (1/60 s) and a seeded rng, so bot tests are deterministic.
- Steering: logic takes either `steer` (−1..1, car-relative, the buttons and keys) or `aim` (a world heading the
  drag stick points at; the car turns toward it). Both run in the slice so either can be judged on a phone.
- Ground is a top-down pixel texture of the whole track (16 px per cell) drawn with an isometric affine
  transform; scenery and cars are depth-sorted sprites. Cars are small box models rendered per heading
  (32 headings) into tiny canvases, outlined, cached, and scaled up with nearest-neighbour, so paint, wheels and
  spoilers compose at every angle.
