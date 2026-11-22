# Racing Boy

A browser kart-style racing game in plain HTML, CSS and JavaScript with no build step and no npm dependencies, a sibling of Dig Through Worlds (`~/dig`) in look and code style. A kid driver walks a garage plaza (garage for upgrades, paint shop, car lot, track signpost) and races five rivals on hand-made tracks seen from a chase camera behind the car, in the style of 16-bit "Mode 7" kart racers (the plaza stays isometric). Races last 2–3 minutes (3 laps on shorter tracks, 2 on longer ones); there are ground boost pads, ramps with an air trick, drifting with a mini-boost, rare item crates and coins on the road. Only a 1st place opens the next track; winning a world's three tracks opens the next world. The agreed design is in `.scratch/spec.md`.

## Layout

- `index.html` is the page shell. It loads the scripts in order with plain `<script>` tags (logic, post, sprites, render, audio, ui), so the game also runs from `file://`. The stylesheet and scripts carry a `?v=N` stamp: bump it on every deploy, because GitHub Pages lets browsers keep each file for 10 minutes.
- `js/logic.js` is the pure game logic (`RB`), no DOM: tracks, car physics, items, rival AI, economy, unlocks, the plaza map and walking, and save/load. Tested in Node.
- `js/post.js` is the HD-2D post-process (`RBPost`), copied from Dig: WebGL2 lights, tilt-shift blur, bloom and grading. Without WebGL2 (or with `?hd=0`) the renderer draws plain 2D.
- `js/sprites.js` is the pixel art (`RBSprites`). Cars are box models (`carBoxes`) rendered per heading (32 headings) into small canvases, hard-edged and outlined, cached per car, look and heading; paint, trim, wheels, spoiler and exhaust are boxes in the model. The kid and scenery are letter grids recoloured by palettes. Buildings, the windmill and the item crate are box models too.
- `js/render.js` is the renderer (`RBRender`). A track's ground is one top-down texture (`TEX` = 12 texels per cell: grass, rough, road, curbs on bends, centre line, checker start, creeks, boost pads).
  - Races use a chase camera (`CAM` tuning block: distance behind, follow rate, draw distance, and a landscape and an upright-phone layout giving buffer width, focal length and the horizon and car rows). The scene is drawn into a small buffer (320 px wide, 240 upright) and scaled up with hard pixels: the ground is sampled per pixel from the texture and three smaller copies (`groundData`), the sky is a gradient with far hills and a near tree line with farms that scroll as the camera turns (`backdrop`), and everything standing up goes through `proj(x, y, z)` and is drawn far to near. Cars, buildings, crates and the glider are box models seen from the camera (`RBSprites.carView`, `modelView`, `gliderView`, cached per angle, elevation and a fixed set of sizes); trees, posts and hay are letter-grid billboards (`BILL_H` heights). Rivals and the finish arch between the camera and the player turn see-through. The tilt-shift blur is off in races.
  - The plaza is isometric: its texture goes through an affine transform and sprites sort by x + z. `setView` keeps that camera centred beside an open panel.
  - Text (name tags, floaters, station icons) goes on the `#ov` overlay. The race minimap is top-down.
- `js/audio.js` is WebAudio (`RBAudio`): sound effects, an engine hum that follows speed, horns (a customisation slot), and plaza and race music.
- `js/ui.js` holds state, saving, the HUDs, plaza panels, race flow, input and the main loop, and sets `window.__game`.
- `tests/logic.test.mjs` and `tests/hub.test.mjs` run `js/logic.js` in a Node `vm` context.

## Tracks and racing

- A track (`TRACKS` in `logic.js`) is a closed list of control points in cells, scaled by `scale`, with a road half-width `hw`. `RB.track(id)` builds the geometry once: a Catmull-Rom centreline resampled every 0.5 cells (`samples` with tangent and curvature `k`), lap length `L`, and a nearest-sample grid for `query(x, z)` → arc length `s`, signed offset `d` (+ is the driver's right). Features are placed by lap fraction `u` and offset: `pads`, `ramps` (`gap` > 0 puts a creek after the lip), item crate rows (`boxes`, three crates per row), and coin lines. Keep separate parts of a track at least ~16 cells apart, or `query` can snap to the wrong stretch.
- Off the road is rough grass for `RUNOFF` cells, then a wall that bounces the car back. Landing short in a creek puts the car back on the road past it after `FALL_T`.
- The logic runs at a fixed `DT` of 1/60 s with a seeded rng (`startRace` seeds from `s.seed` and `s.races`), so bot tests are deterministic. `RB.input(r, inp)` takes `steer` (−1..1, car-relative: keys and the ◀ ▶ buttons on desktop, which set `ease` so the steering builds over `STEER_RISE`, and on a phone a joystick that appears under a thumb on the left half of the screen, with a deadzone and a response curve: `STICK_DEAD`, `STICK_FULL`, `STICK_CURVE` in `ui.js`) or `aim` (a world heading, used by the bots), plus `drift` (held: keys, the drift button, or on a phone any finger on the right half; a press on the ground hops at once for `HOP_T` (steering turns the car only `HOP_STEER` × grip in the hop) and the drift starts on landing if steering, then keeps that direction until let go, turning `DRIFT_WIDE`–`DRIFT_TURN` × grip and charging `DRIFT_CHARGE_WIDE`–1 per second as the stick goes from against the drift to into it, and sliding outward (`DRIFT_SLIDE`); letting go pays the boost of the highest of three `DRIFT_TIERS`; there is no brake; a press in the air is a trick) and `item` (a press). Phones are told apart by the `(pointer: coarse)` media query in `style.css`.
- Progress is `car.prog` (cells since the start, unwrapped). Race order sorts by it, and the lap is `floor(prog / L) + 1`; the race ends when the player finishes, and the rest of the field is finished at its present pace. The results screen has one way out: back to the garage, with the kid on its pad and the Garage panel open (`toGarage` in `ui.js`, `newHub('garage')`).
- Rivals (`aiInput`, `aiTop`) follow the centreline on their own lane at `WORLDS[w].aiSpeed × PACE × skill`, slow in sharp bends, and are rubber-banded toward the player (slowed up to 25% when ahead, sped up to 6% when behind). They use items too.
- Items (`ITEMS`): Rocket Pop (turbo), Bubble Shield, Coin Magnet, Goo Blob (a puddle that slows), Buzzy Bee (rare; chases the racer one place ahead). `rollItem` weights them by place; the leader never gets the bee. Crates respawn after `BOX_RESPAWN` s; a car holds one item.
- Cars (`CARS`): base stats, per-car upgrade caps, a perk (`PERKS`), a price, a box `model`, and a default look. Five starter cars can be bought at once; faster cars carry `unlock` (tracks to win first, `carUnlocked` / `carLockReason`) and rivals never drive them. `carStats` applies the six upgrades (`UP_KEYS`): Engine (top speed and pick-up), Turbo (pick-up and a `launch` boost at GO), Tires, Boost, Glider (`glide`: gentler fall, more air speed and steering, and a small boost on landing; the renderer opens a wing) and Armor. A new upgrade key needs a cap on every car; saves without it load at level 0. Upgrade costs rise by level, and every three levels need the next part tier (`PARTS`: bolts, gears, springs, chips, crystals; world w pays tier w, a win also one of tier w + 1).
- Cosmetics (`LOOKS`, slots `LOOK_KEYS`) are bought once (`s.looks`) and equipped per car (`s.cars[id].look`).

## Plaza

- `HUB.rows` is the map, one character per cell, x across and z down (key in the comment above it). Pads `g p c t` open the garage, paint shop, car lot and races panels. On the plaza, keys and the drag stick walk in screen directions; a tap walks there by the shortest path (`hubWalkTo`). After a panel is closed by ✕, the kid must step off the pad before it reopens (`padLock` in `ui.js`).

## Commands

- Run the tests with `node --test tests/*.test.mjs`. They print each world-1 track's race time and how often a clean and a sloppy bot win.
- Tune drift handling with the `drift-tune` skill (`.claude/skills/drift-tune/`): `node .claude/skills/drift-tune/drift-lab.mjs [--set NAME=value,...] [--car id]` drifts every world-1 bend with a bot and reports how the drift arc fits them.
- Play by serving the folder with `python3 -m http.server 8766 --bind 127.0.0.1` and opening `http://localhost:8766/`.
- URL flags: `?dev=1` (lots of coins and parts, every track open, no saving), `?fresh=1` (new game, no load or save), `?nosplash=1`, `?seed=N`, `?hd=0` (plain 2D), `?race=<trackId>` (straight into a race), `?car=<carId>`.
- In the console, `window.__game` exposes `S`, `D` (the logic), `race`, `hub` and `step(seconds)`.

## Conventions

- Game rules and numbers live in `js/logic.js` and are tested first. Rendering sits on top and is not tested.
- The overall pace is `PACE` (top speed of every car and rival) and `PICKUP` (their acceleration) at the top of `logic.js`. A faster pace shortens races, so grow the track `scale`s with it, widen the jump `gap`s, and rerun the `drift-tune` lab: a drift's turn radius grows with speed.
- To change balance, edit `WORLDS` (`aiSpeed`, `skill`, `pay`), `CARS` (`base`, `caps`, `cost`), track `scale` and `laps`, `PLACE_PAY`, `PART_PAY`, `upgradeCost`, or the tuning block at the top of `logic.js`, then rerun the tests: world-1 races must last 2–3 minutes, a clean stock-car drive must win, and a sloppy one must sometimes win.
- Art is original and drawn in code. Do not copy names, characters, items or tracks from existing kart games.
- Never call `alert`, `confirm` or `prompt`. Start over asks for "yes" typed into an inline box.
- Saves go to `localStorage` under `racing-boy-v1`, every access wrapped in try/catch; the format is version 1 (`serialize`).
