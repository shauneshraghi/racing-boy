// Racing Boy: pure game logic (RB). No DOM. Tracks, car physics, items, rival AI, the economy, unlocks,
// the garage plaza and save/load. Runs in the browser and in a Node vm context for the tests.
var RB = (function () {
  'use strict';

  // ---------- helpers ----------
  var TAU = Math.PI * 2;
  function rng(seed) { var a = seed | 0; return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function angDiff(a, b) { var d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function wrapS(g, s) { return ((s % g.L) + g.L) % g.L; }
  function dS(g, a, b) { var d = a - b; if (d > g.L / 2) d -= g.L; if (d < -g.L / 2) d += g.L; return d; } // a - b along the loop

  // ---------- tuning ----------
  var DT = 1 / 60;              // fixed logic step
  var SAMPLE = 0.5;             // centreline sample spacing, cells
  var RUNOFF = 3;               // rough grass between the road edge and the wall, cells
  var PACE = 1.25, PICKUP = 1.4; // every car's and rival's top speed, and pick-up, × these (the tracks are sized to match)
  var GRASS = 0.58;             // speed factor on rough grass (Tires raise it)
  var G = 26;                   // gravity in the air, cells/s²
  var RAMP_LEN = 2.5, RAMP_H = 0.9;
  // crossovers: a track may pass over itself on a bridge (bridges: [[u0, u1], or [u0, u1, 'rail']]) at least
  // BRIDGE_CLEAR cells above the road below. A bridge has no runoff: its edges are open (a car past hw + EDGE falls off)
  // unless it has a rail (a wall at hw + RAIL). drops: [[u0, u1, side]] open the wall on one side (1 right, -1 left,
  // 0 both) over a cliff. A fall puts the car back on the road a little behind where it went over, after FALL_T
  var BRIDGE_CLEAR = 4.5, EDGE = 0.8, RAIL = 0.5, OPEN = 1e9;
  var HINT_N = 40;              // a query with a hint (the car's last s) searches this many samples either side of it
  // hills: a track's elev keys ([u, height in cells]) are joined by smooth S-curves; climbing slows the car by
  // SLOPE_K × the slope, and where the road drops away faster than gravity (a crest at speed) the car flies
  var SLOPE_K = 0.6;
  var PAD_LEN = 2.4, PAD_W = 2.4;
  var BOX_RESPAWN = 10, BOX_R = 1.1, ROLL_T = 0.9;
  var COIN_R = 0.9, MAGNET_R = 5, COIN_RESPAWN = 8;
  var CAR_R = 0.55;
  var BOOST_MUL = 1.4, BOOST_ACC = 4;
  var DRIFT_MIN_V = 5;
  var DRIFT_TIERS = [0.6, 1.3, 2.1], DRIFT_BOOST = [0.5, 1.0, 1.5]; // charge for each boost tier, and its boost × boostDur
  var DRIFT_CHARGE_WIDE = 0.5;  // charge rate with the stick fully against the drift (1 steering fully into it)
  var DRIFT_SLIDE = 0.06, SLIDE_RISE = 6; // outward slide speed × v at full slip, and how fast the slip builds and fades
  var HOP_T = 0.22, HOP_H = 0.35; // pressing drift on the ground hops; the drift starts on landing
  var HOP_STEER = 0.2;          // turn rate × grip while hopping, so steering to pick the drift's side barely turns the car
  var DRIFT_TURN = 0.44, DRIFT_WIDE = 0.04; // drift turn rate × grip steering in, and with the stick fully against the drift
  var STEER_RISE = 3.5, STEER_FALL = 16, DRIFT_RISE = 12; // on/off steering (inp.ease: keys, ◀ ▶) eases toward full lock per second (a tap is a nudge; DRIFT_RISE while drifting, where keys only set how tight), back faster
  // outside a drift the player's steer goes through a curve, STEER_LIN × s + (1 − STEER_LIN) × s³, so small stick
  // moves and key taps make small corrections while full lock keeps the authority hairpins need (aim is not curved)
  var STEER_LIN = 0.5;
  // weight: the yaw rate follows the steering with a lag of YAW_LAG s × √weight, and the direction of travel swings
  // toward where the car points at GRIP_BITE × grip / √weight per second (AIR_BITE × that in the air), so a turn
  // winds in, carries on a moment after letting go, and the car runs a little wide of where it points
  var YAW_LAG = 0.12, GRIP_BITE = 6, AIR_BITE = 0.2;
  var DRIFT_LAG = 0.4, DRIFT_BITE = 3; // the yaw lag and the bite in a drift, × the above
  // outside a drift the yaw unwinds faster than it winds in (lag × YAW_UNWIND when the steering eases off or reverses),
  // so letting go stops the turn within a few degrees instead of swinging past the line and asking for a correction
  var YAW_UNWIND = 0.35;
  // body animation, springs in the car's frame: roll (+ = right side down) leans out of a turn at ROLL_K rad per
  // cell/s² of sideways pull, pitch (+ = nose up) squats under throttle at PITCH_K, dip (cells) compresses on landing
  // at DIP_K × the fall speed; BODY_W is the springs' frequency (rad/s) and BODY_Z their damping ratio
  var ROLL_K = 0.003, ROLL_MAX = 0.12, PITCH_K = 0.008, PITCH_MAX = 0.1, DIP_K = 0.25, BODY_W = 14, BODY_Z = 0.45;
  // the sloppy test bot eases its stick toward what it wants by DT × BOT_REACT per call (drive() calls
  // it every 1/20 s, so 7 is a reaction lag of about 0.4 s)
  var BOT_REACT = 7;
  var WHEEL_RATE = 18, WHEEL_COUNTER = 0.5; // front wheels follow the steering at this rate per second; a drift counter-steers them
  var SLOW_MUL = 0.55;
  // hazards cross the road and back (amplitude hw + HAZ_OVER, a sine of period s); r is the hit radius, h the height a
  // car must clear, gap the spacing of a flock (n of them), bounce how high it hops; a hit slows a little (HAZ_SLOW s)
  var HAZ = {
    sheep: { r: 0.65, h: 1.0, period: 9, gap: 2.6 },
    bale: { r: 0.85, h: 1.3, period: 5, gap: 4 },
    tumble: { r: 0.6, h: 0.9, period: 4, gap: 5, bounce: 0.9 },
    boulder: { r: 1.0, h: 1.6, period: 7, gap: 5 },
    // world 4, Lava Lane: a lava bomb hops high enough to drive under at the top of a hop, a magma boulder rolls
    // across; a steam vent stays put in its lane (hazard off, or spread across the road in a row) and puffs for the
    // vent share of each period, harmless while it rests
    bomb: { r: 0.7, h: 1.1, period: 5, gap: 6, bounce: 2.4 },
    magma: { r: 1.15, h: 1.9, period: 7.5, gap: 7 },
    vent: { r: 0.95, h: 3.5, period: 3.4, gap: 6, vent: 0.4 },
    // world 5, Moon Base: a six-wheeled rover, moon rocks bouncing high in the low gravity (a car slips under one
    // at the top of its bounce), little meteorites skipping low, and a tracked robot with a slowly turning dish
    rover: { r: 0.95, h: 1.2, period: 10, gap: 4 },
    moonrock: { r: 0.8, h: 1.3, period: 6, gap: 6, bounce: 2.2 },
    meteor: { r: 0.55, h: 0.8, period: 3.6, gap: 4.5, bounce: 0.7 },
    dish: { r: 1.0, h: 1.5, period: 12, gap: 5 }
  };
  // world 3, Snowcap Peaks: snowballs rolling across, a waddling penguin flock, ice blocks sliding over the ice
  HAZ.snowball = { r: 0.95, h: 1.7, period: 6, gap: 5 };
  HAZ.penguin = { r: 0.5, h: 0.9, period: 10, gap: 2.2 };
  HAZ.iceblock = { r: 0.9, h: 1.2, period: 4.5, gap: 5 };
  var HAZ_OVER = 1.2, HAZ_SLOW = 0.8, HAZ_COOL = 1;
  var BEE_SPEED = 21, BEE_TURN = 6, BEE_LIFE = 6;
  var GOO_LIFE = 25;
  var COUNTDOWN = 3;
  var FALL_T = 1.1;
  var PLACE_HOLD = 0.5;         // a new place must hold this long before it is announced (pass / lostPlace)
  var PLACE_PAY = [120, 85, 65, 50, 40, 30];
  var PART_PAY = [4, 3, 2, 2, 1, 1];
  // parts swap at the garage: PART_UP of a tier buy one of the next, one of a tier breaks into PART_DOWN of the one
  // below, so racing any track can earn the tier an upgrade needs (a round trip loses parts)
  var PART_UP = 3, PART_DOWN = 2;
  var FIRST_WIN = { coins: 100, parts: 3 }; // the first win of a track: coins × the world's pay, and parts of the next tier
  var PARTS = [
    { id: 'bolt', name: 'Bolts', icon: '🔩' }, { id: 'gear', name: 'Gears', icon: '⚙️' },
    { id: 'spring', name: 'Springs', icon: '🌀' }, { id: 'chip', name: 'Chips', icon: '💾' },
    { id: 'crystal', name: 'Crystals', icon: '💎' }
  ];

  // ---------- items ----------
  var ITEMS = {
    turbo: { name: 'Rocket Pop', icon: '🚀', desc: 'A big burst of speed' },
    shield: { name: 'Bubble Shield', icon: '🫧', desc: 'Blocks the next hit' },
    magnet: { name: 'Coin Magnet', icon: '🧲', desc: 'Pulls in coins for a while' },
    goo: { name: 'Goo Blob', icon: '🟢', desc: 'Drop a sticky puddle behind you' },
    bee: { name: 'Buzzy Bee', icon: '🐝', desc: 'Chases the racer ahead of you' }
  };
  var ITEM_KEYS = ['turbo', 'shield', 'magnet', 'goo', 'bee'];
  // pos runs 0 (leading) to 1 (last); the back of the pack gets the strong items
  function itemWeights(pos) {
    return { turbo: 10 + 40 * pos, shield: 30 - 10 * pos, magnet: 25 - 10 * pos, goo: 35 - 20 * pos, bee: pos < 0.3 ? 0 : 14 * pos };
  }
  function rollItem(r, place, n, luck) {
    var pos = n > 1 ? (place - 1) / (n - 1) : 0;
    if (luck) pos = Math.min(1, pos + 0.4);
    var w = itemWeights(pos), tot = 0, k;
    for (k in w) tot += w[k];
    var x = r() * tot;
    for (var i = 0; i < ITEM_KEYS.length; i++) { k = ITEM_KEYS[i]; x -= w[k]; if (x < 0) return k; }
    return 'turbo';
  }

  // ---------- cars ----------
  var UP_KEYS = ['engine', 'turbo', 'tires', 'boost', 'glider', 'armor'];
  var UPGRADES = {
    engine: { name: 'Engine', icon: '🔧', desc: 'Top speed and pick-up' },
    turbo: { name: 'Turbo', icon: '⚡', desc: 'Faster pick-up, and a boost off the start line' },
    tires: { name: 'Tires', icon: '🛞', desc: 'Grip, and less slowing on grass' },
    boost: { name: 'Boost', icon: '🔥', desc: 'Stronger, longer boosts' },
    glider: { name: 'Glider', icon: '🪂', desc: 'Wings open off ramps: longer air time and more steering in the air' },
    armor: { name: 'Armor', icon: '🛡️', desc: 'Shorter slowdowns from hits' }
  };
  var PERKS = {
    start: { name: 'Quick Start', desc: 'Zooms off the line with a boost when the race starts' },
    tough: { name: 'Tough Bumper', desc: 'Hits slow you half as long; you shove rivals aside' },
    air: { name: 'Big Air', desc: 'Jumps go higher and air tricks boost much longer' },
    pads: { name: 'Pad Surfer', desc: 'Boost pads and drift boosts last half as long again' },
    luck: { name: 'Lucky Clover', desc: 'Better items from boxes, and boxes drop coins' }
  };
  // body: length, width, height of the body box; cab: cabin box (or helmet for open cars); colours are defaults
  var CARS = {
    pip: { name: 'Pip', kind: 'hatchback', desc: 'A cheerful little hatchback. Good at everything.', perk: 'start',
      base: { speed: 9, accel: 6, grip: 2.4, weight: 1 }, caps: { engine: 6, turbo: 5, tires: 6, boost: 6, glider: 4, armor: 6 },
      cost: { coins: 0, parts: [0, 0, 0, 0, 0] }, price: 1,
      model: { len: 1.5, wid: 0.95, h: 0.42, cab: { x: -0.1, len: 0.8, wid: 0.8, h: 0.36 }, wheel: 0.26, open: false },
      look: { paint: 'cherry', trim: 'snow', wheels: 'stock', spoiler: 'none', exhaust: 'none', horn: 'beep', trail: 'flame' } },
    rumble: { name: 'Rumble', kind: 'truck', desc: 'A big friendly pickup. Slow to start, hard to stop.', perk: 'tough',
      base: { speed: 8.9, accel: 4.6, grip: 2.15, weight: 1.8 }, caps: { engine: 5, turbo: 6, tires: 6, boost: 5, glider: 2, armor: 9 },
      cost: { coins: 700, parts: [12, 0, 0, 0, 0] }, price: 1.1,
      model: { len: 1.85, wid: 1.1, h: 0.5, cab: { x: 0.15, len: 0.75, wid: 1.0, h: 0.42 }, wheel: 0.34, open: false, bed: true },
      look: { paint: 'forest', trim: 'sun', wheels: 'chunky', spoiler: 'none', exhaust: 'pipe', horn: 'honk', trail: 'flame' } },
    hopper: { name: 'Hopper', kind: 'buggy', desc: 'A springy dune buggy that loves to fly.', perk: 'air',
      base: { speed: 9.1, accel: 6.6, grip: 2.5, weight: 0.8 }, caps: { engine: 6, turbo: 5, tires: 7, boost: 6, glider: 6, armor: 4 },
      cost: { coins: 900, parts: [14, 2, 0, 0, 0] }, price: 1.15,
      model: { len: 1.4, wid: 1.0, h: 0.3, cab: { x: -0.15, len: 0.36, wid: 0.36, h: 0.38 }, wheel: 0.32, open: true },
      look: { paint: 'lime', trim: 'coal', wheels: 'chunky', spoiler: 'none', exhaust: 'none', horn: 'toot', trail: 'leaves' } },
    comet: { name: 'Comet', kind: 'speedster', desc: 'A low racer. Very fast, a bit slippery.', perk: 'pads',
      base: { speed: 10.1, accel: 5.6, grip: 2.05, weight: 0.9 }, caps: { engine: 8, turbo: 4, tires: 5, boost: 7, glider: 4, armor: 4 },
      cost: { coins: 1600, parts: [20, 5, 0, 0, 0] }, price: 1.3,
      model: { len: 1.75, wid: 0.95, h: 0.3, cab: { x: -0.25, len: 0.36, wid: 0.36, h: 0.32 }, wheel: 0.24, open: true, nose: true },
      look: { paint: 'sky', trim: 'snow', wheels: 'stock', spoiler: 'wing', exhaust: 'twin', horn: 'beep', trail: 'stars' } },
    clover: { name: 'Clover', kind: 'van', desc: 'A roomy camper van with a lucky streak.', perk: 'luck',
      base: { speed: 9.2, accel: 5, grip: 2.3, weight: 1.3 }, caps: { engine: 5, turbo: 5, tires: 5, boost: 6, glider: 3, armor: 6 },
      cost: { coins: 1100, parts: [16, 3, 0, 0, 0] }, price: 1.15,
      model: { len: 1.7, wid: 1.0, h: 0.4, cab: { x: -0.05, len: 1.3, wid: 0.95, h: 0.5 }, wheel: 0.26, open: false, van: true },
      look: { paint: 'mint', trim: 'snow', wheels: 'stock', spoiler: 'none', exhaust: 'none', horn: 'tune', trail: 'bubbles' } },
    // faster cars that open by winning races (unlock: the tracks to win first)
    bolt: { name: 'Bolt', kind: 'rally car', desc: 'A quick rally car with a big wing. Opens when you win Creek Jump.', perk: 'start',
      unlock: ['creek'], base: { speed: 10.7, accel: 6.4, grip: 2.45, weight: 1.05 }, caps: { engine: 7, turbo: 6, tires: 6, boost: 7, glider: 5, armor: 5 },
      cost: { coins: 1900, parts: [22, 4, 0, 0, 0] }, price: 1.45,
      model: { len: 1.65, wid: 1.0, h: 0.36, cab: { x: -0.15, len: 0.7, wid: 0.8, h: 0.3 }, wheel: 0.27, open: false },
      look: { paint: 'tangerine', trim: 'coal', wheels: 'star', spoiler: 'wing', exhaust: 'twin', horn: 'beep', trail: 'flame' } },
    nova: { name: 'Nova', kind: 'rocket racer', desc: 'The fastest car in town. Opens when you win every Grassy Hills race.', perk: 'air',
      unlock: ['meadow', 'creek', 'windmill'], base: { speed: 11.5, accel: 6.2, grip: 2.4, weight: 0.95 }, caps: { engine: 8, turbo: 6, tires: 6, boost: 8, glider: 6, armor: 4 },
      cost: { coins: 3000, parts: [28, 7, 0, 0, 0] }, price: 1.7,
      model: { len: 1.95, wid: 1.0, h: 0.28, cab: { x: -0.3, len: 0.36, wid: 0.36, h: 0.32 }, wheel: 0.25, open: true, nose: true },
      look: { paint: 'grape', trim: 'sun', wheels: 'gold', spoiler: 'tall', exhaust: 'stack', horn: 'tune', trail: 'stars' } }
  };
  var START_CAR = 'pip';

  // ---------- customisation ----------
  var LOOKS = {
    paint: [
      { id: 'cherry', name: 'Cherry', c: '#e5483a', cost: 0 }, { id: 'forest', name: 'Forest', c: '#3f8f4a', cost: 0 },
      { id: 'lime', name: 'Lime', c: '#9ad13a', cost: 0 }, { id: 'sky', name: 'Sky', c: '#3fa8ff', cost: 0 },
      { id: 'mint', name: 'Mint', c: '#6fe0c0', cost: 0 }, { id: 'sun', name: 'Sunshine', c: '#ffd23f', cost: 60 },
      { id: 'tangerine', name: 'Tangerine', c: '#ff8a1c', cost: 60 }, { id: 'grape', name: 'Grape', c: '#8a5ad8', cost: 80 },
      { id: 'bubblegum', name: 'Bubblegum', c: '#ff7ac8', cost: 80 }, { id: 'snow', name: 'Snow', c: '#f4f1ea', cost: 80 },
      { id: 'coal', name: 'Coal', c: '#3a3644', cost: 100 }, { id: 'gold', name: 'Gold', c: '#e8b02a', cost: 300 }
    ],
    trim: [
      { id: 'snow', name: 'White', c: '#f4f1ea', cost: 0 }, { id: 'sun', name: 'Yellow', c: '#ffd23f', cost: 0 },
      { id: 'coal', name: 'Black', c: '#2e2a36', cost: 0 }, { id: 'cherry', name: 'Red', c: '#e5483a', cost: 40 },
      { id: 'sky', name: 'Blue', c: '#3fa8ff', cost: 40 }, { id: 'bubblegum', name: 'Pink', c: '#ff7ac8', cost: 40 },
      { id: 'lime', name: 'Green', c: '#9ad13a', cost: 40 }
    ],
    wheels: [
      { id: 'stock', name: 'Stock', cost: 0 }, { id: 'chunky', name: 'Chunky', cost: 0 },
      { id: 'gold', name: 'Gold Rims', cost: 250 }, { id: 'star', name: 'Star Hubs', cost: 180 }, { id: 'white', name: 'Whitewalls', cost: 140 }
    ],
    spoiler: [
      { id: 'none', name: 'None', cost: 0 }, { id: 'duck', name: 'Ducktail', cost: 100 },
      { id: 'tall', name: 'Tall Fin', cost: 160 }, { id: 'wing', name: 'Big Wing', cost: 0 }
    ],
    exhaust: [
      { id: 'none', name: 'Hidden', cost: 0 }, { id: 'pipe', name: 'Single Pipe', cost: 0 },
      { id: 'twin', name: 'Twin Pipes', cost: 0 }, { id: 'stack', name: 'Smoke Stacks', cost: 220 }
    ],
    horn: [
      { id: 'beep', name: 'Beep Beep', cost: 0 }, { id: 'honk', name: 'Goose Honk', cost: 0 }, { id: 'toot', name: 'Toot', cost: 0 },
      { id: 'tune', name: 'Little Tune', cost: 0 }, { id: 'moo', name: 'Moo', cost: 90 }, { id: 'boing', name: 'Boing', cost: 90 }
    ],
    trail: [
      { id: 'flame', name: 'Flames', cost: 0 }, { id: 'leaves', name: 'Leaves', cost: 0 }, { id: 'stars', name: 'Stars', cost: 0 },
      { id: 'bubbles', name: 'Bubbles', cost: 0 }, { id: 'rainbow', name: 'Rainbow', cost: 200 }, { id: 'hearts', name: 'Hearts', cost: 150 }
    ]
  };
  var LOOK_KEYS = ['paint', 'trim', 'wheels', 'spoiler', 'exhaust', 'horn', 'trail'];
  function lookOpt(slot, id) { var L = LOOKS[slot]; for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return null; }

  // ---------- worlds and tracks ----------
  // Control points of the closed centreline, in cells; features are placed by fraction u of the lap and a
  // lateral offset in cells (+ is the driver's right).
  // Control points of the closed centreline, in cells; features are placed by fraction u of the lap and a
  // lateral offset in cells (+ is the driver's right). elev keys are [u, ground height in cells]; a short steep drop
  // after a rise is a crest the car flies off, a run of short humps is a set of whoops (a pad before them means big
  // air). Jump gaps sit on level ground. hazards: { u, kind (HAZ), n (a flock), period, phase }.
  var TRACKS = {
    // the intro, a figure 8: the start straight runs under the bridge, round the sweeping south loop climbing Sheep
    // Hill (a flock on top, an open edge on the left on the way up), over the railed bridge above the start straight,
    // a hop off the far end, down round the north loop over a ramp and home
    meadow: {
      name: 'Meadow Loop', world: 0, laps: 3, hw: 3.6, scale: 0.85,
      pts: [[40, 90], [70, 90], [100, 90], [140, 90], [175, 100], [190, 130], [175, 160], [140, 170], [110, 160], [100, 135], [100, 90], [100, 50], [90, 20], [60, 8], [30, 15], [10, 40], [8, 68], [18, 86]],
      elev: [[0, 0], [0.17, 0], [0.39, 4], [0.47, 4], [0.533, 6], [0.643, 6], [0.658, 6], [0.665, 3.6], [0.77, 0]],
      bridges: [[0.543, 0.633, 'rail']], drops: [[0.493, 0.54, -1]],
      hazards: [{ u: 0.42, kind: 'sheep', n: 3 }],
      pads: [{ u: 0.05, off: 0 }, { u: 0.27, off: 1.5 }, { u: 0.57, off: 0 }, { u: 0.83, off: 0 }],
      ramps: [{ u: 0.775, gap: 0 }],
      boxes: [0.22, 0.71],
      coins: [{ u: 0.1, off: 1.6, n: 6 }, { u: 0.33, off: -1.6, n: 6 }, { u: 0.59, off: 0, n: 5 }, { u: 0.87, off: -1.2, n: 6 }, { u: 0.93, off: 1.4, n: 5 }]
    },
    // downhill to the creek jump, a climbing hairpin up to the farm, hay bales rolling across the farm lane, down
    // through the chicane and a pad into the whoops
    creek: {
      name: 'Creek Jump', world: 0, laps: 3, hw: 3.5, scale: 1,
      pts: [[30, 40], [70, 24], [115, 22], [160, 30], [196, 24], [220, 42], [204, 62], [182, 58], [162, 70], [166, 98], [140, 118], [108, 110], [86, 126], [58, 120], [44, 96], [22, 76]],
      elev: [[0, 2], [0.06, 2], [0.19, 0], [0.33, 0], [0.48, 3.5], [0.62, 3.5], [0.72, 1], [0.79, 1], [0.8, 2], [0.81, 1], [0.82, 2], [0.83, 1], [0.84, 2], [0.85, 1], [0.95, 2]],
      hazards: [{ u: 0.54, kind: 'bale', n: 2 }],
      pads: [{ u: 0.1, off: 0 }, { u: 0.36, off: 1.4 }, { u: 0.58, off: -1.4 }, { u: 0.775, off: 0 }],
      ramps: [{ u: 0.235, gap: 4 }],
      boxes: [0.15, 0.66],
      coins: [{ u: 0.05, off: -1.5, n: 6 }, { u: 0.3, off: 0, n: 5 }, { u: 0.45, off: 1.5, n: 6 }, { u: 0.7, off: 0, n: 5 }, { u: 0.9, off: 1.5, n: 6 }]
    },
    // up Windmill Hill to a ramp off the summit, down past the flock, the creek jump in the valley, the switchback
    // climb with bales rolling down it and a hop off the last crest
    windmill: {
      name: 'Windmill Hills', world: 0, laps: 2, hw: 3.6, scale: 1,
      pts: [[30, 40], [80, 24], [140, 22], [196, 30], [226, 56], [210, 82], [176, 80], [160, 100], [188, 122], [214, 146], [196, 178], [150, 186], [118, 166], [96, 190], [60, 196], [30, 176], [40, 148], [64, 130], [46, 104], [18, 78]],
      elev: [[0, 0], [0.1, 0], [0.26, 5], [0.33, 5], [0.45, 1.5], [0.6, 0], [0.72, 0], [0.85, 3], [0.9, 3], [0.9125, 1], [0.98, 0]],
      hazards: [{ u: 0.53, kind: 'sheep', n: 4 }, { u: 0.79, kind: 'bale', period: 6 }],
      pads: [{ u: 0.05, off: 0 }, { u: 0.2, off: -1.5 }, { u: 0.3, off: 0 }, { u: 0.57, off: 0 }, { u: 0.7, off: -1.5 }, { u: 0.88, off: 0 }],
      ramps: [{ u: 0.315, gap: 0 }, { u: 0.65, gap: 4.25 }],
      boxes: [0.14, 0.56],
      coins: [{ u: 0.08, off: 1.5, n: 6 }, { u: 0.24, off: 0, n: 6 }, { u: 0.4, off: -1.5, n: 6 }, { u: 0.53, off: 1.4, n: 5 }, { u: 0.75, off: 0, n: 6 }, { u: 0.86, off: -1.5, n: 6 }, { u: 0.95, off: 0, n: 5 }]
    },
    // world 2, Sunbaked Canyon: a ramp's gap is a canyon on mesa and a water creek on oasis
    // dune hopping along the top, a ramp at the bend, tumbleweeds, up the big dune and off its lip
    dune: {
      name: 'Dune Sweep', world: 1, laps: 3, hw: 3.8, scale: 1,
      pts: [[30, 60], [70, 26], [130, 18], [190, 30], [218, 70], [200, 110], [160, 116], [128, 100], [96, 118], [90, 154], [56, 174], [24, 150], [20, 104]],
      elev: [[0, 0], [0.07, 0], [0.084, 2.4], [0.098, 0.4], [0.112, 2.6], [0.126, 0.4], [0.14, 2.4], [0.154, 0], [0.58, 0], [0.7, 4], [0.74, 4], [0.752, 2], [0.84, 0]],
      hazards: [{ u: 0.52, kind: 'tumble', n: 2 }, { u: 0.88, kind: 'tumble', n: 3 }],
      pads: [{ u: 0.05, off: 0 }, { u: 0.3, off: 1.5 }, { u: 0.62, off: -1.5 }, { u: 0.72, off: 0 }],
      ramps: [{ u: 0.43, gap: 0 }],
      boxes: [0.2, 0.66],
      coins: [{ u: 0.18, off: -1.5, n: 6 }, { u: 0.25, off: 0, n: 6 }, { u: 0.48, off: 1.5, n: 6 }, { u: 0.8, off: 0, n: 5 }, { u: 0.94, off: -1.4, n: 6 }]
    },
    // up onto the mesa, a canyon leap across its top, a hop off the edge, down the switchbacks into boulder alley,
    // a second canyon in the gulch and over the ridge home
    mesa: {
      name: 'Mesa Leap', world: 1, laps: 3, hw: 3.5, scale: 1,
      pts: [[24, 40], [74, 18], [130, 20], [170, 36], [160, 62], [120, 62], [96, 80], [118, 100], [160, 100], [184, 124], [166, 154], [118, 162], [80, 150], [48, 164], [20, 136], [14, 90]],
      elev: [[0, 0], [0.02, 0], [0.08, 4], [0.28, 4], [0.285, 2.4], [0.45, 0], [0.84, 0], [0.9, 1.5], [0.93, 1.5], [0.94, 0.3], [0.99, 0]],
      hazards: [{ u: 0.48, kind: 'boulder', n: 2 }, { u: 0.6, kind: 'tumble' }],
      pads: [{ u: 0.03, off: 0 }, { u: 0.2, off: -1.4 }, { u: 0.55, off: 1.4 }, { u: 0.68, off: 0 }, { u: 0.88, off: 0 }],
      ramps: [{ u: 0.12, gap: 3.8 }, { u: 0.72, gap: 3.8 }],
      boxes: [0.22, 0.52],
      coins: [{ u: 0.07, off: 1.5, n: 6 }, { u: 0.26, off: 0, n: 5 }, { u: 0.4, off: -1.5, n: 6 }, { u: 0.64, off: 0, n: 5 }, { u: 0.92, off: 1.5, n: 6 }]
    },
    // the long tour: the oasis creek, up the dunes and over the whoops, a ramp, tumbleweeds and a boulder on the
    // flats, the second creek and a hop off the last ridge
    oasis: {
      name: 'Oasis Run', world: 1, laps: 2, hw: 3.6, scale: 1,
      pts: [[30, 50], [90, 22], [160, 28], [230, 20], [272, 50], [262, 94], [220, 104], [196, 134], [230, 160], [246, 206], [206, 236], [150, 228], [120, 200], [88, 222], [48, 212], [22, 176], [44, 140], [26, 100]],
      elev: [[0, 0], [0.12, 0], [0.24, 3], [0.25, 3], [0.257, 4.4], [0.264, 3], [0.271, 4.4], [0.278, 3], [0.32, 3], [0.42, 0], [0.8, 0], [0.9, 2.5], [0.93, 2.5], [0.94, 0.8], [0.99, 0]],
      hazards: [{ u: 0.56, kind: 'tumble', n: 2 }, { u: 0.64, kind: 'boulder' }, { u: 0.84, kind: 'tumble' }],
      pads: [{ u: 0.03, off: 0 }, { u: 0.2, off: 1.5 }, { u: 0.245, off: 0 }, { u: 0.47, off: -1.5 }, { u: 0.68, off: 1.5 }, { u: 0.9, off: -1.4 }],
      ramps: [{ u: 0.06, gap: 3.8 }, { u: 0.5, gap: 0 }, { u: 0.73, gap: 3.8 }],
      boxes: [0.16, 0.6],
      coins: [{ u: 0.09, off: -1.5, n: 6 }, { u: 0.3, off: 0, n: 6 }, { u: 0.42, off: 1.5, n: 6 }, { u: 0.53, off: -1.4, n: 5 }, { u: 0.77, off: 0, n: 6 }, { u: 0.86, off: 1.5, n: 6 }, { u: 0.96, off: 0, n: 5 }]
    },
    // world 3, Snowcap Peaks: icy roads (WORLDS grip), mountains two to three times the height of the hills; a ramp's
    // gap is a crevasse in the glacier
    // a switchback climb up the ridge to the summit pass (penguins waddle across it), a hop off the pass, the plunging
    // downhill run to the valley, snowballs at its foot and a pad into the moguls
    pines: {
      name: 'Pine Ridge Pass', world: 2, laps: 3, hw: 4.2, scale: 0.76,
      pts: [[30, 210], [100, 214], [170, 206], [226, 186], [236, 150], [200, 130], [140, 128], [108, 104], [128, 78], [190, 74], [236, 56], [232, 22], [180, 12], [110, 14], [56, 30], [24, 70], [12, 130], [14, 180]],
      elev: [[0, 0], [0.2, 0], [0.4, 5.5], [0.55, 10], [0.645, 10], [0.655, 7.5], [0.75, 0], [0.84, 0], [0.853, 1.6], [0.866, 0], [0.879, 1.6], [0.892, 0]],
      hazards: [{ u: 0.52, kind: 'penguin', n: 4 }, { u: 0.77, kind: 'snowball' }],
      pads: [{ u: 0.05, off: 0 }, { u: 0.17, off: 1.5 }, { u: 0.49, off: -1.4 }, { u: 0.63, off: 0 }, { u: 0.825, off: 0 }],
      ramps: [],
      boxes: [0.13, 0.67],
      coins: [{ u: 0.09, off: -1.5, n: 6 }, { u: 0.3, off: 0, n: 6 }, { u: 0.46, off: 1.4, n: 6 }, { u: 0.64, off: 0, n: 6 }, { u: 0.78, off: -1.5, n: 6 }, { u: 0.93, off: 1.4, n: 5 }]
    },
    // the long sweeping climb to the summit at 14, the in-run with a pad, the ski jump off the top with huge air
    // down the landing hill, snowballs rolling across the S-curve descent and ice blocks sliding on the flats
    skijump: {
      name: 'Ski Jump Summit', world: 2, laps: 3, hw: 4.2, scale: 0.88, ai: 1.015,
      pts: [[30, 200], [100, 208], [160, 200], [206, 178], [222, 136], [196, 104], [206, 64], [186, 26], [146, 12], [100, 12], [56, 20], [34, 50], [62, 80], [106, 92], [126, 118], [104, 148], [36, 150], [16, 178]],
      elev: [[0, 0], [0.12, 0], [0.42, 14], [0.47, 14], [0.5, 11.5], [0.505, 11.5], [0.58, 4], [0.64, 4], [0.8, 0]],
      hazards: [{ u: 0.73, kind: 'snowball', n: 2 }, { u: 0.875, kind: 'iceblock', n: 2 }],
      pads: [{ u: 0.05, off: 0 }, { u: 0.24, off: -1.5 }, { u: 0.36, off: 1.4 }, { u: 0.48, off: 0 }, { u: 0.95, off: 0 }],
      ramps: [{ u: 0.4965, gap: 0 }],
      boxes: [0.15, 0.67],
      coins: [{ u: 0.09, off: 1.5, n: 6 }, { u: 0.3, off: 0, n: 6 }, { u: 0.47, off: -1.4, n: 6 }, { u: 0.6, off: 0, n: 5 }, { u: 0.8, off: 1.4, n: 6 }, { u: 0.92, off: -1.4, n: 6 }]
    },
    // the long tour: a crevasse leap on the glacier tongue, moguls, the icefall climb round a hairpin to the plateau at
    // 12, penguins and a second crevasse up top, a hop off its edge, a snowball and ice blocks on the way down and the
    // S-curve descent home
    glacier: {
      name: 'Icefall Glacier', world: 2, laps: 2, hw: 4.2, scale: 0.9, ai: 1.02,
      pts: [[30, 230], [100, 238], [170, 232], [230, 214], [266, 180], [250, 140], [200, 140], [150, 152], [104, 140], [102, 108], [140, 98], [190, 96], [250, 90], [280, 56], [250, 22], [190, 14], [130, 22], [80, 14], [36, 34], [24, 80], [56, 110], [44, 150], [14, 188]],
      elev: [[0, 0], [0.16, 0], [0.17, 1.4], [0.18, 0], [0.19, 1.4], [0.2, 0], [0.25, 0], [0.45, 12], [0.605, 12], [0.61, 10], [0.74, 5], [0.79, 5], [0.93, 0]],
      hazards: [{ u: 0.465, kind: 'penguin', n: 4 }, { u: 0.67, kind: 'snowball' }, { u: 0.765, kind: 'iceblock', n: 2 }],
      pads: [{ u: 0.04, off: 0 }, { u: 0.15, off: 0 }, { u: 0.31, off: 1.4 }, { u: 0.495, off: 0 }, { u: 0.7, off: -1.4 }, { u: 0.96, off: 0 }],
      ramps: [{ u: 0.1, gap: 3.8 }, { u: 0.515, gap: 3.8 }],
      boxes: [0.07, 0.55],
      coins: [{ u: 0.12, off: 1.5, n: 6 }, { u: 0.27, off: 0, n: 6 }, { u: 0.42, off: -1.4, n: 6 }, { u: 0.6, off: 0, n: 6 }, { u: 0.72, off: 1.4, n: 5 }, { u: 0.82, off: 0, n: 6 }, { u: 0.9, off: -1.4, n: 6 }]
    },

    // world 4, Lava Lane: every ramp gap is a glowing lava river; the hills are far bigger than worlds 1-2 (10-16 cells)
    // round the foot of the cone over cooled-lava whoops, a lava river jump, lava bombs, then a spiral climb round the
    // cone (a magma boulder rolls across it) to the crater rim at 14.5 and a plunge off the rim with big air
    cinder: {
      name: 'Cinder Cone', world: 3, laps: 3, hw: 3.7, scale: 1, ai: 0.96,
      pts: [[186, 59], [124, 70], [84, 119], [84, 181], [113, 222], [143, 225], [159, 211], [122, 178], [124, 133], [156, 111], [188, 119], [198, 145], [187, 168], [186, 194], [203, 223], [242, 212], [262, 158], [240, 91]],
      elev: [[0, 0], [0.06, 0], [0.07, 1.3], [0.08, 0.2], [0.09, 1.3], [0.1, 0.2], [0.11, 1.3], [0.12, 0], [0.36, 0], [0.42, 4], [0.45, 5],
        [0.51, 10], [0.54, 11], [0.595, 14.5], [0.635, 14.5], [0.655, 5], [0.71, 0]],
      hazards: [{ u: 0.28, kind: 'bomb', n: 2 }, { u: 0.48, kind: 'magma' }],
      pads: [{ u: 0.03, off: 0 }, { u: 0.17, off: 0 }, { u: 0.4, off: 1.4 }, { u: 0.62, off: 0 }, { u: 0.85, off: -1.4 }],
      ramps: [{ u: 0.2, gap: 4 }],
      boxes: [0.25, 0.75],
      coins: [{ u: 0.05, off: 1.5, n: 6 }, { u: 0.14, off: 0, n: 5 }, { u: 0.38, off: -1.5, n: 6 }, { u: 0.56, off: 0, n: 5 }, { u: 0.8, off: 1.5, n: 6 }, { u: 0.93, off: 0, n: 5 }]
    },
    // a lava river jump on the start straight, steam vents in a basalt-column gorge, a switchback climb (a magma
    // boulder on the middle leg) to a plateau at 12.5, a hop off its edge and whoops down the cooled flow
    basalt: {
      name: 'Basalt Gorge', world: 3, laps: 3, hw: 3.6, scale: 0.82, ai: 0.98,
      pts: [[70, 224], [130, 226], [180, 220], [214, 200], [232, 170], [262, 160], [284, 134], [288, 100], [268, 74], [220, 74], [176, 78], [150, 64], [160, 44], [204, 42], [246, 34], [262, 14], [236, -2], [180, -6], [120, 0], [84, 24], [62, 66], [56, 110], [50, 150], [40, 192]],
      elev: [[0, 0], [0.32, 0], [0.44, 4.5], [0.47, 5], [0.57, 9], [0.62, 9.5], [0.7, 12.5], [0.765, 12.5], [0.78, 6], [0.83, 3], [0.84, 2.6], [0.85, 3.8], [0.86, 1.8],
        [0.87, 3], [0.88, 1], [0.89, 2.2], [0.9, 0.4], [0.95, 0]],
      hazards: [{ u: 0.2, kind: 'vent', n: 3 }, { u: 0.52, kind: 'magma' }],
      pads: [{ u: 0.03, off: 0 }, { u: 0.07, off: 0 }, { u: 0.25, off: 0 }, { u: 0.4, off: 1.4 }, { u: 0.66, off: -1.4 }, { u: 0.755, off: 0 }, { u: 0.97, off: 1.4 }],
      ramps: [{ u: 0.085, gap: 4.2 }],
      boxes: [0.12, 0.6],
      coins: [{ u: 0.07, off: -1.5, n: 6 }, { u: 0.24, off: 1.5, n: 5 }, { u: 0.36, off: 0, n: 6 }, { u: 0.5, off: -1.4, n: 6 }, { u: 0.72, off: 0, n: 6 }, { u: 0.92, off: 0, n: 5 }]
    },
    // the long one: a lava river jump, a long climb past rolling magma, the ridge between two lava lakes with lava bombs,
    // up to the summit at 16 and a plunge off it, steam vents on the flats and a second lava river
    caldera: {
      name: 'Caldera Ridge', world: 3, laps: 2, hw: 3.6, scale: 1.1, ai: 0.995,
      pts: [[40, 260], [110, 268], [180, 262], [240, 240], [290, 200], [318, 150], [320, 100], [296, 62], [240, 50], [180, 46], [136, 42], [104, 56], [84, 86], [100, 118], [150, 132], [196, 160], [196, 200], [150, 214], [96, 206], [48, 222]],
      elev: [[0, 0], [0.2, 0], [0.29, 5], [0.32, 6], [0.4, 10], [0.53, 10.5], [0.575, 16], [0.59, 16], [0.605, 7], [0.67, 2], [0.74, 0]],
      hazards: [{ u: 0.31, kind: 'magma', n: 2 }, { u: 0.47, kind: 'bomb', n: 3 }, { u: 0.78, kind: 'vent', n: 3 }, { u: 0.95, kind: 'bomb' }],
      pads: [{ u: 0.03, off: 0 }, { u: 0.085, off: 0 }, { u: 0.17, off: -1.4 }, { u: 0.25, off: 1.4 }, { u: 0.34, off: 0 }, { u: 0.44, off: -1.4 }, { u: 0.52, off: 1.4 },
        { u: 0.585, off: 0 }, { u: 0.7, off: 1.4 }, { u: 0.74, off: -1.4 }, { u: 0.865, off: 0 }, { u: 0.96, off: 1.4 }],
      ramps: [{ u: 0.1, gap: 4.2 }, { u: 0.88, gap: 4.2 }],
      boxes: [0.16, 0.66],
      coins: [{ u: 0.05, off: 1.5, n: 6 }, { u: 0.22, off: 0, n: 6 }, { u: 0.36, off: -1.5, n: 6 }, { u: 0.5, off: 0, n: 6 }, { u: 0.63, off: 1.4, n: 5 }, { u: 0.75, off: 0, n: 6 }, { u: 0.92, off: -1.5, n: 6 }]
    },

    // world 5, Moon Base: low gravity (WORLDS grav), so crests launch easily and every jump floats; the gaps are
    // chasms. Each track has a dome-base run (base: [u0, u1], drawn as a glass tunnel, on the ground and clear of
    // the bridges), crosses over itself on a bridge high above the moon floor, and gets harder (ai)
    // a figure 8: a chasm leap off the start straight, up the crater wall to the rim road (open on the left, a long
    // fall into the crater), across the railed skybridge 10 up over the start straight, a pad off its end and a big
    // floaty dive into a small crater, a hop off the far rim, meteorites skipping across, the rim whoops and the dome
    // base on the sweep home
    rimhop: {
      name: 'Rim Hopper', world: 4, laps: 3, hw: 4.2, scale: 0.8, ai: 1.055,
      pts: [[40, 100], [110, 100], [180, 100], [240, 104], [280, 130], [288, 175], [255, 205], [200, 212], [155, 195], [128, 160], [114, 110], [106, 60], [100, 15], [85, -20], [50, -35], [10, -30], [-26, -6], [-42, 32], [-36, 70], [-10, 96]],
      elev: [[0, 0], [0.21, 0], [0.39, 10], [0.62, 10], [0.645, 2], [0.675, 2], [0.69, 6], [0.695, 6], [0.705, 2], [0.73, 0], [0.79, 0], [0.8, 2.4], [0.81, 0.4], [0.82, 2.6], [0.83, 0.4], [0.84, 2.4], [0.85, 0]],
      bridges: [[0.5, 0.615, 'rail']], drops: [[0.4, 0.47, -1]],
      hazards: [{ u: 0.255, kind: 'rover' }, { u: 0.77, kind: 'meteor', n: 3 }],
      pads: [{ u: 0.1, off: 0 }, { u: 0.19, off: 1.4 }, { u: 0.36, off: 0 }, { u: 0.45, off: 0 }, { u: 0.613, off: 0 }, { u: 0.78, off: 0 }, { u: 0.9, off: -1.4 }],
      ramps: [{ u: 0.11, gap: 7 }],
      base: [0.865, 0.94],
      boxes: [0.3, 0.67],
      coins: [{ u: 0.07, off: 1.6, n: 6 }, { u: 0.25, off: -1.5, n: 6 }, { u: 0.44, off: 0, n: 6 }, { u: 0.55, off: 1.4, n: 5 }, { u: 0.88, off: 1.4, n: 6 }, { u: 0.97, off: 0, n: 5 }]
    },
    // the climb to the highland, an open skybridge (no rails) 10 up across the rille valley, a pad and a rim crest
    // into the head of the rille, the valley winding down along an open ledge (left), moon rocks bouncing across
    // just before the road runs under the skybridge, the dome base on the valley floor, a chasm leap over the rille,
    // the hairpin climb out and a hop off the last crest
    rille: {
      name: 'Rille Run', world: 4, laps: 3, hw: 4.2, scale: 0.78, ai: 1.02,
      pts: [[100, 262], [170, 260], [225, 245], [265, 210], [270, 160], [245, 122], [200, 106], [150, 104], [100, 102], [60, 94], [35, 70], [32, 38], [60, 16], [110, 12], [152, 24], [170, 60], [152, 110], [132, 155], [100, 182], [62, 186], [36, 198], [24, 228], [48, 256]],
      elev: [[0, 0], [0.11, 0], [0.28, 12], [0.445, 12], [0.46, 7], [0.48, 7], [0.69, 2], [0.87, 2], [0.93, 9], [0.94, 9], [0.955, 4], [0.99, 0]],
      bridges: [[0.33, 0.4]], drops: [[0.555, 0.615, -1]],
      hazards: [{ u: 0.19, kind: 'dish' }, { u: 0.525, kind: 'rover' }, { u: 0.695, kind: 'moonrock', n: 2 }],
      pads: [{ u: 0.08, off: 0 }, { u: 0.25, off: 1.5 }, { u: 0.43, off: 0 }, { u: 0.5, off: -1.4 }, { u: 0.67, off: 1.4 }, { u: 0.806, off: 0 }, { u: 0.925, off: 0 }],
      ramps: [{ u: 0.818, gap: 8 }],
      base: [0.762, 0.805],
      boxes: [0.1, 0.52],
      coins: [{ u: 0.04, off: -1.5, n: 6 }, { u: 0.2, off: 0, n: 6 }, { u: 0.36, off: 0, n: 5 }, { u: 0.5, off: 1.4, n: 5 }, { u: 0.78, off: -1.4, n: 6 }, { u: 0.9, off: 1.4, n: 5 }]
    },
    // the finale, three loops on one long straight that it crosses twice: a chasm leap off the start straight, the
    // dome base, the long climb up the outer crater wall to the rim road (open on the left), the open skybridge 16 up
    // over the start straight and a huge dive off its end into the bowl, a chasm leap on the bowl floor, a dish robot,
    // the climb out onto the railed bridge 13 up back over the straight and a hop off its end, the rim whoops,
    // bouncing moon rocks, meteorites skipping across and a ramp to the line
    starfall: {
      name: 'Starfall Crater', world: 4, laps: 2, hw: 4.2, scale: 0.74, ai: 1.04,
      pts: [[200, 200], [250, 200], [330, 200], [410, 204], [455, 240], [460, 300], [420, 342], [350, 355], [305, 325], [296, 265], [300, 200], [302, 150], [300, 100], [285, 50], [240, 22], [180, 20], [130, 35], [105, 80], [112, 140], [120, 200], [118, 260], [95, 305], [50, 320], [12, 290], [5, 235], [40, 202], [120, 200]],
      elev: [[0, 0], [0.21, 0], [0.29, 16], [0.445, 16], [0.462, 4], [0.6, 4], [0.68, 13], [0.735, 13], [0.75, 6], [0.78, 0], [0.8, 0], [0.81, 2.6], [0.82, 0.4], [0.83, 2.8], [0.84, 0]],
      bridges: [[0.325, 0.445], [0.68, 0.735, 'rail']], drops: [[0.29, 0.315, -1]],
      hazards: [{ u: 0.25, kind: 'rover' }, { u: 0.61, kind: 'dish' }, { u: 0.86, kind: 'moonrock', n: 2 }, { u: 0.9, kind: 'meteor', n: 3 }],
      pads: [{ u: 0.02, off: 0 }, { u: 0.12, off: -1.4 }, { u: 0.28, off: 0 }, { u: 0.43, off: 0 }, { u: 0.525, off: 0 }, { u: 0.66, off: 1.4 }, { u: 0.795, off: 0 }, { u: 0.965, off: 0 }],
      ramps: [{ u: 0.085, gap: 8.5 }, { u: 0.535, gap: 8.5 }, { u: 0.975, gap: 0 }],
      base: [0.145, 0.205],
      boxes: [0.045, 0.32, 0.64],
      coins: [{ u: 0.03, off: 1.5, n: 6 }, { u: 0.18, off: 0, n: 6 }, { u: 0.4, off: 0, n: 6 }, { u: 0.56, off: 1.4, n: 5 }, { u: 0.71, off: 0, n: 6 }, { u: 0.85, off: 1.5, n: 6 }, { u: 0.93, off: 0, n: 6 }]
    }
  };
  // aiSpeed is the rivals' top speed in cells/s before PACE; pay multiplies the place money. Optional environment
  // factors (default 1): grip × every car's turn rate and tyre bite (ice < 1), grav × gravity in the air (the moon < 1),
  // rough × the off-road speed factor. A track's optional ai multiplies aiSpeed there, so a world can get harder
  // track by track.
  var WORLDS = [
    { id: 'hills', name: 'Grassy Hills Town', tracks: ['meadow', 'creek', 'windmill'], aiSpeed: 8.8, pay: 1, skill: [0.93, 0.91, 0.89, 0.87, 0.85] },
    { id: 'desert', name: 'Sunbaked Canyon', tracks: ['dune', 'mesa', 'oasis'], aiSpeed: 9.6, pay: 1.6, skill: [0.95, 0.93, 0.91, 0.89, 0.87] },
    { id: 'ice', name: 'Snowcap Peaks', tracks: ['pines', 'skijump', 'glacier'], aiSpeed: 10.6, grip: 0.85, pay: 2.4, skill: [0.95, 0.93, 0.91, 0.89, 0.87] },
    { id: 'volcano', name: 'Lava Lane', tracks: ['cinder', 'basalt', 'caldera'], aiSpeed: 11.7, pay: 3.4, skill: [0.96, 0.94, 0.92, 0.9, 0.88], rough: 0.85 },
    { id: 'moon', name: 'Moon Base', tracks: ['rimhop', 'rille', 'starfall'], aiSpeed: 12, pay: 4.8, skill: [0.95, 0.93, 0.91, 0.89, 0.87], grav: 0.55 }
  ];
  var RIVALS = ['Mia', 'Rocco', 'Juno', 'Theo', 'Pia', 'Bram', 'Lulu', 'Kai', 'Nell', 'Otto'];

  // ---------- track geometry ----------
  var CACHE = {};
  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function track(id) {
    if (CACHE[id]) return CACHE[id];
    var T = TRACKS[id], k = T.scale || 1, P = T.pts.map(function (p) { return [p[0] * k, p[1] * k]; }), n = P.length;
    // dense curve, then resample at equal arc length
    var dense = [], i, j;
    for (i = 0; i < n; i++) {
      var a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
      for (j = 0; j < 40; j++) { var t = j / 40; dense.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t)]); }
    }
    dense.push(dense[0]);
    var cum = [0];
    for (i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    var total = cum[cum.length - 1], ns = Math.round(total / SAMPLE), L = ns * SAMPLE, samples = [], seg = 0;
    for (i = 0; i < ns; i++) {
      var want = i / ns * total;
      while (cum[seg + 1] < want) seg++;
      var f = (want - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
      samples.push({ x: dense[seg][0] + (dense[seg + 1][0] - dense[seg][0]) * f, z: dense[seg][1] + (dense[seg + 1][1] - dense[seg][1]) * f, s: i * SAMPLE, hw: T.hw });
    }
    for (i = 0; i < ns; i++) {
      var p = samples[(i - 1 + ns) % ns], q = samples[(i + 1) % ns], len = Math.hypot(q.x - p.x, q.z - p.z);
      samples[i].tx = (q.x - p.x) / len; samples[i].tz = (q.z - p.z) / len;
    }
    // curvature: heading change per cell, for curbs and the AI's corner speed
    for (i = 0; i < ns; i++) {
      var A = samples[(i - 2 + ns) % ns], B = samples[(i + 2) % ns];
      samples[i].k = angDiff(Math.atan2(B.tz, B.tx), Math.atan2(A.tz, A.tx)) / (4 * SAMPLE);
    }
    for (i = 0; i < ns; i++) samples[i].y = elevAt(T.elev, i / ns);
    for (i = 0; i < ns; i++) samples[i].gy = (samples[(i + 1) % ns].y - samples[(i - 1 + ns) % ns].y) / (2 * SAMPLE);
    samples.push({ x: samples[0].x, z: samples[0].z, s: L, hw: T.hw, tx: samples[0].tx, tz: samples[0].tz, k: samples[0].k, y: samples[0].y, gy: samples[0].gy }); // closing copy
    var g = { id: id, def: T, L: L, hw: T.hw, samples: samples, n: ns };
    // bridges and open edges: per sample, the wall offset on the right and the left (OPEN: none, fall off past hw + EDGE)
    g.bridges = (T.bridges || []).map(function (b) { return { s0: b[0] * L, s1: b[1] * L, rail: b[2] === 'rail' }; });
    g.drops = (T.drops || []).map(function (b) { return { s0: b[0] * L, s1: b[1] * L, side: b[2] || 0 }; });
    g.limR = new Float32Array(ns + 1); g.limL = new Float32Array(ns + 1); g.deck = new Uint8Array(ns + 1);
    function inSpan(sp, sv) { return dS(g, sv, sp.s0) >= 0 && dS(g, sp.s1, sv) >= 0; }
    for (i = 0; i <= ns; i++) {
      var sv = samples[i].s, lr = T.hw + RUNOFF, ll = lr;
      g.bridges.forEach(function (b) { if (inSpan(b, sv)) { g.deck[i] = 1; lr = ll = b.rail ? T.hw + RAIL : OPEN; } });
      g.drops.forEach(function (b) { if (inSpan(b, sv)) { if (b.side >= 0) lr = OPEN; if (b.side <= 0) ll = OPEN; } });
      g.limR[i] = lr; g.limL[i] = ll;
    }
    // nearest-sample lookup grid
    var minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9, pad = T.hw + RUNOFF + 14;
    for (i = 0; i < ns; i++) { minX = Math.min(minX, samples[i].x); maxX = Math.max(maxX, samples[i].x); minZ = Math.min(minZ, samples[i].z); maxZ = Math.max(maxZ, samples[i].z); }
    g.x0 = Math.floor(minX - pad); g.z0 = Math.floor(minZ - pad);
    g.w = Math.ceil(maxX + pad) - g.x0; g.h = Math.ceil(maxZ + pad) - g.z0;
    g.near = new Int32Array(g.w * g.h);
    // the land grid (g.nearLand, only on tracks with bridges) leaves the bridge decks out: the nearest road on the ground
    var hasDeck = g.bridges.length > 0;
    if (hasDeck) g.nearLand = new Int32Array(g.w * g.h);
    [false, true].forEach(function (land) {
      if (land && !hasDeck) return;
      var coarse = [], grid = land ? g.nearLand : g.near;
      for (i = 0; i < ns; i += 4) if (!land || !g.deck[i]) coarse.push(i);
      for (var cz = 0; cz < g.h; cz++) for (var cx = 0; cx < g.w; cx++) {
        var wx = g.x0 + cx + 0.5, wz = g.z0 + cz + 0.5, best = 1e18, bi = 0;
        for (j = 0; j < coarse.length; j++) { var sm = samples[coarse[j]], dd = (sm.x - wx) * (sm.x - wx) + (sm.z - wz) * (sm.z - wz); if (dd < best) { best = dd; bi = coarse[j]; } }
        for (j = bi - 4; j <= bi + 4; j++) { var si = (j + ns) % ns, sm2 = samples[si], d2 = (sm2.x - wx) * (sm2.x - wx) + (sm2.z - wz) * (sm2.z - wz); if (d2 < best && (!land || !g.deck[si])) { best = d2; bi = si; } }
        grid[cz * g.w + cx] = bi;
      }
    });
    g.query = function (x, z, hint) { return query(g, x, z, hint); };
    g.queryLand = function (x, z) { return query(g, x, z, null, true); };
    // features
    g.pads = T.pads.map(function (p) { return { s: p.u * L, off: p.off }; });
    g.hazards = [];
    (T.hazards || []).forEach(function (hz, k) {
      var K = HAZ[hz.kind], n = hz.n || 1;
      for (var m = 0; m < n; m++) g.hazards.push({ s: wrapS({ L: L }, hz.u * L + m * K.gap), kind: hz.kind, r: K.r, h: K.h, bounce: K.bounce || 0,
        period: hz.period || K.period, phase: (hz.phase !== undefined ? hz.phase : k * 0.37) + m * 0.11, amp: T.hw + HAZ_OVER });
      if (K.vent) for (var vi = 0; vi < n; vi++) { var vt = g.hazards[g.hazards.length - n + vi]; vt.vent = K.vent; vt.off = hz.off !== undefined ? hz.off : [-0.5, 0.5, 0][vi % 3] * T.hw; vt.phase += vi * 0.34; }
    });
    g.ramps = T.ramps.map(function (m) { return { s: m.u * L, len: RAMP_LEN, gap: m.gap, h: RAMP_H }; });
    g.boxes = [];
    T.boxes.forEach(function (u) { [-0.55, 0, 0.55].forEach(function (f) { g.boxes.push(feature(g, u * L, f * T.hw)); }); });
    g.coins = [];
    T.coins.forEach(function (c) { for (var m = 0; m < c.n; m++) g.coins.push(feature(g, c.u * L + m * 1.3, c.off)); });
    g.pads.forEach(function (p) { var f = feature(g, p.s, p.off); p.x = f.x; p.z = f.z; p.h = f.h; });
    g.ramps.forEach(function (m) { var f = feature(g, m.s, 0); m.x = f.x; m.z = f.z; m.dir = f.h; });
    CACHE[id] = g;
    return g;
  }
  // the height of the elev keys at lap fraction u (0 with no keys): smoothstep between neighbouring keys, wrapping
  function elevAt(keys, u) {
    if (!keys || !keys.length) return 0;
    var n = keys.length, i = n - 1;
    for (var j = 0; j < n; j++) if (keys[j][0] <= u) i = j;
    var a = keys[i], b = keys[(i + 1) % n], ua = a[0], ub = b[0];
    if (ub <= ua) ub += 1;
    var uu = u < ua ? u + 1 : u, t = clamp((uu - ua) / Math.max(1e-9, ub - ua), 0, 1);
    return a[1] + (b[1] - a[1]) * t * t * (3 - 2 * t);
  }
  // the ground height at arc length s, and its slope along the lap
  function groundAt(g, s) {
    s = wrapS(g, s);
    var f = s / SAMPLE, i = Math.floor(f), t = f - i, a = g.samples[i], b = g.samples[i + 1];
    return a.y + (b.y - a.y) * t;
  }
  function slopeAt(g, s) {
    s = wrapS(g, s);
    var f = s / SAMPLE, i = Math.floor(f), t = f - i, a = g.samples[i], b = g.samples[i + 1];
    return a.gy + (b.gy - a.gy) * t;
  }
  function feature(g, s, off) { var p = pointAt(g, s, off); return { s: wrapS(g, s), off: off, x: p.x, z: p.z, h: p.h }; }
  // the centreline point at arc length s, moved off cells to the right, and the road heading there
  function pointAt(g, s, off) {
    s = wrapS(g, s);
    var f = s / SAMPLE, i = Math.floor(f), t = f - i, a = g.samples[i], b = g.samples[i + 1];
    var x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t, l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    off = off || 0;
    return { x: x - tz * off, z: z + tx * off, h: Math.atan2(tz, tx), tx: tx, tz: tz, k: a.k };
  }
  function headingAt(g, s) { return pointAt(g, s, 0).h; }
  // nearest point on the centreline: arc length s, signed offset d (+ right), road half-width hw
  // With a hint (the arc length the asker was at a moment ago) it searches only the road near the hint, so at a
  // crossover a car stays on its own level; far from the hint it falls back to the grid. land: the ground road only
  function query(g, x, z, hint, land) {
    var cx = Math.floor(x - g.x0), cz = Math.floor(z - g.z0), bi, j, ns = g.n, S = g.samples, grid = land && g.nearLand ? g.nearLand : g.near;
    if (hint !== undefined && hint !== null && hint === hint) {
      var c0 = Math.round(wrapS(g, hint) / SAMPLE), hb = 1e18, hi = 0;
      for (j = c0 - HINT_N; j <= c0 + HINT_N; j += 2) { var sh = S[(j % ns + ns) % ns], dh = (sh.x - x) * (sh.x - x) + (sh.z - z) * (sh.z - z); if (dh < hb) { hb = dh; hi = (j % ns + ns) % ns; } }
      var far = g.hw + RUNOFF + 8;
      if (hb < far * far) bi = hi;
    }
    if (bi === undefined) {
      if (cx >= 0 && cz >= 0 && cx < g.w && cz < g.h) bi = grid[cz * g.w + cx];
      else { var best = 1e18; for (j = 0; j < ns; j += 2) { if (land && g.deck[j]) continue; var dd = (S[j].x - x) * (S[j].x - x) + (S[j].z - z) * (S[j].z - z); if (dd < best) { best = dd; bi = j; } } }
    }
    var bd = 1e18, bj = bi;
    for (j = bi - 6; j <= bi + 6; j++) { var si = (j + ns) % ns, d2 = (S[si].x - x) * (S[si].x - x) + (S[si].z - z) * (S[si].z - z); if (d2 < bd && (!land || !g.deck[si] || g.deck[bi])) { bd = d2; bj = si; } }
    // project onto the segment ahead or behind, whichever is nearer
    var best2 = null;
    [bj, (bj - 1 + ns) % ns].forEach(function (i0) {
      var a = S[i0], b = S[i0 + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez;
      var t = clamp(((x - a.x) * ex + (z - a.z) * ez) / l2, 0, 1), px = a.x + ex * t, pz = a.z + ez * t, dist = Math.hypot(x - px, z - pz);
      if (!best2 || dist < best2.dist) {
        var l = Math.sqrt(l2), tx = ex / l, tz = ez / l;
        best2 = { dist: dist, s: wrapS(g, a.s + t * SAMPLE), d: (x - px) * -tz + (z - pz) * tx, tx: tx, tz: tz, px: px, pz: pz };
      }
    });
    best2.hw = g.hw;
    best2.i = Math.min(ns, Math.round(best2.s / SAMPLE));
    best2.limR = g.limR[best2.i]; best2.limL = g.limL[best2.i];
    return best2;
  }
  // is arc length s on a bridge deck
  function onBridge(g, s) { return !!g.deck[Math.min(g.n, Math.round(wrapS(g, s) / SAMPLE))]; }

  // ---------- car stats ----------
  function newCar(id) {
    var look = {}, d = CARS[id].look;
    LOOK_KEYS.forEach(function (k) { look[k] = d[k]; });
    var up = {}; UP_KEYS.forEach(function (k) { up[k] = 0; });
    return { up: up, look: look };
  }
  function statsFor(id, up) {
    var C = CARS[id], b = C.base;
    up = up || {};
    var L = function (k) { return up[k] || 0; };
    return {
      speed: b.speed * PACE * (1 + 0.035 * L('engine')), accel: b.accel * PICKUP * (1 + 0.05 * L('engine')) * (1 + 0.07 * L('turbo')),
      launch: 0.25 * L('turbo'), glide: L('glider'), grip: b.grip * (1 + 0.045 * L('tires')),
      weight: b.weight, grass: Math.min(0.85, GRASS + 0.035 * L('tires')),
      boostMul: BOOST_MUL + 0.025 * L('boost'), boostDur: 1 + 0.08 * L('boost'),
      armor: Math.pow(0.88, L('armor')) * (C.perk === 'tough' ? 0.5 : 1), perk: C.perk
    };
  }
  function carStats(s, id) { return statsFor(id, s.cars[id] ? s.cars[id].up : null); }

  // ---------- race ----------
  function startRace(s, trackId, opts) {
    opts = opts || {};
    var g = track(trackId), T = TRACKS[trackId], W = WORLDS[T.world];
    var seed = (s.seed + (s.races || 0) * 7919) | 0;
    s.races = (s.races || 0) + 1;
    var R = rng(seed);
    var r = { s: s, id: trackId, g: g, world: T.world, laps: T.laps, rng: R, t: 0, phase: 'count', cd: COUNTDOWN, cars: [], events: [],
      boxes: g.boxes.map(function () { return { t: 0 }; }), coins: g.coins.map(function () { return { t: 0 }; }), goos: [], bees: [], finished: 0 };
    // rivals: names and cars picked by the race seed
    var names = RIVALS.slice(), carIds = Object.keys(CARS).filter(function (id) { return !CARS[id].unlock; }), paints = LOOKS.paint.map(function (p) { return p.id; });
    for (var i = names.length - 1; i > 0; i--) { var j = Math.floor(R() * (i + 1)), tmp = names[i]; names[i] = names[j]; names[j] = tmp; }
    var gridOrder = [1, 2, 3, 0, 4, 5]; // grid slot of each car: the player starts fourth
    for (var c = 0; c < 6; c++) {
      var ai = c > 0, id = ai ? carIds[Math.floor(R() * carIds.length)] : s.car;
      var look = ai ? newCar(id).look : s.cars[s.car].look;
      if (ai) { look = JSON.parse(JSON.stringify(look)); look.paint = paints[Math.floor(R() * paints.length)]; }
      var car = { i: c, ai: ai, name: ai ? names[c - 1] : 'You', carId: id, look: look,
        stats: ai ? statsFor(id) : carStats(s, id), skill: ai ? W.skill[c - 1] : 1, lane: ai ? (R() * 2 - 1) * 1.6 : 0,
        x: 0, z: 0, h: 0, v: 0, y: 0, vy: 0, gy: 0, gvy: 0, air: false, s: 0, prog: 0, lap: 1, place: c + 1, done: false, finishT: 0,
        boostT: 0, slowT: 0, shieldT: 0, magnetT: 0, drift: 0, driftDir: 0, driftReady: false, slip: 0, slipDir: 0, hopT: 0, hopY: 0, trick: false, trickT: 0, fallT: 0, onRamp: -1,
        item: null, rollT: 0, itemDelay: 0, coins: 0, inp: {}, prevDrift: false, prevItem: false, pad: -1, bumpT: 0, steerOut: 0, botSteer: 0,
        vh: 0, yawV: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, dip: 0, dipV: 0, wheel: 0 };
      var slot = gridOrder[c], row = Math.floor(slot / 2), col = slot % 2;
      place(r, car, -2.5 - row * 2.6 - col * 1.3, col ? 1.5 : -1.5);
      car.prog = car.s - g.L;
      r.cars.push(car);
    }
    if (opts.noAI) r.cars.length = 1;
    s.race = r;
    return r;
  }
  function place(r, car, s, off) {
    var p = pointAt(r.g, s, off);
    car.x = p.x; car.z = p.z; car.h = p.h; car.vh = p.h; car.yawV = 0; car.s = wrapS(r.g, s); car.prog = car.s;
    car.air = false; car.y = 0; car.vy = 0; car.gy = groundAt(r.g, car.s); car.gvy = 0; car.gvyOk = false; car.onRamp = -1; car.fallT = 0; car.drift = 0; car.driftDir = 0; car.hopT = 0; car.hopY = 0;
  }
  // the body's springs (roll, pitch, dip) and the front wheels' steer angle, for the renderer
  function body(car, steer, accel) {
    function spring(x, vx, target, max) {
      vx += (BODY_W * BODY_W * (target - x) - 2 * BODY_Z * BODY_W * vx) * DT;
      return [clamp(x + vx * DT, -max, max), vx];
    }
    var grounded = !car.air, a;
    a = spring(car.roll, car.rollV, grounded ? clamp(-ROLL_K * car.v * car.yawV, -ROLL_MAX, ROLL_MAX) : 0, ROLL_MAX); car.roll = a[0]; car.rollV = a[1];
    a = spring(car.pitch, car.pitchV, grounded ? clamp(PITCH_K * accel, -PITCH_MAX, PITCH_MAX) : 0, PITCH_MAX); car.pitch = a[0]; car.pitchV = a[1];
    a = spring(car.dip, car.dipV, 0, 0.15); car.dip = a[0]; car.dipV = a[1];
    var wWant = car.driftDir ? -car.driftDir * WHEEL_COUNTER + steer * 0.25 : steer;
    car.wheel += (wWant - car.wheel) * Math.min(1, WHEEL_RATE * DT);
  }
  // a press is latched until a fixed step uses it, so a frame too short for a step cannot drop it
  function input(r, inp) { var p = r.cars[0]; p.inp = inp || {}; if (p.inp.item) p.itemQueued = true; }
  function surfaceSpeed(r, car, d) { return Math.abs(d) <= r.g.hw ? 1 : Math.min(1, car.stats.grass * envOf(r).rough); }
  // the world's environment factors (see WORLDS)
  function envOf(r) { var W = WORLDS[r.world]; return { grip: W.grip || 1, grav: W.grav || 1, rough: W.rough || 1 }; }
  function ev(r, type, car, extra) { var e = { type: type, car: car ? car.i : -1 }; if (extra) for (var k in extra) e[k] = extra[k]; r.events.push(e); if (r.events.length > 200) r.events.shift(); }

  function hit(r, car, kind, extra) {
    if (car.shieldT > 0) { car.shieldT = 0; ev(r, 'blocked', car); return false; }
    var base = kind === 'bee' ? 1.6 : kind === 'hazard' ? HAZ_SLOW : 1.2;
    car.slowT = Math.max(car.slowT, base * car.stats.armor);
    car.v *= kind === 'bee' ? 0.55 : kind === 'hazard' ? 0.75 : 0.7;
    car.drift = 0; car.driftDir = 0; car.boostT = 0;
    var e = { kind: kind }; if (extra) for (var k in extra) e[k] = extra[k];
    ev(r, 'hit', car, e);
    return true;
  }
  function useItem(r, car) {
    var it = car.item; if (!it || car.rollT > 0) return;
    car.item = null;
    var fx = Math.cos(car.h), fz = Math.sin(car.h);
    if (it === 'turbo') car.boostT = Math.max(car.boostT, 1.6 * car.stats.boostDur);
    else if (it === 'shield') car.shieldT = 10;
    else if (it === 'magnet') car.magnetT = 8;
    else if (it === 'goo') r.goos.push({ x: car.x - fx * 1.6, z: car.z - fz * 1.6, s: wrapS(r.g, car.s - 1.6), y: groundAt(r.g, car.s - 1.6), t: GOO_LIFE, owner: car.i, safe: 0.6 });
    else if (it === 'bee') {
      var ahead = null;
      r.cars.forEach(function (o) { if (o.place === car.place - 1) ahead = o; });
      r.bees.push({ x: car.x + fx, z: car.z + fz, s: car.s, y: car.gy + car.y + 1, h: car.h, t: BEE_LIFE, owner: car.i, target: ahead ? ahead.i : -1 });
    }
    ev(r, 'item', car, { item: it });
  }

  // where hazard i is at the race time: x, z, arc s, offset d, the heading it walks or rolls, its hop y and roll angle
  function hazardAt(r, i, t) {
    if (r.g.hazards[i].vent) return ventAt(r, i, t);
    var hz = r.g.hazards[i], ph = TAU * ((t === undefined ? r.t : t) / hz.period + hz.phase), d = hz.amp * Math.sin(ph), p = pointAt(r.g, hz.s, d);
    var dir = Math.cos(ph) >= 0 ? 1 : -1;
    return { x: p.x, z: p.z, s: hz.s, d: d, h: p.h + dir * Math.PI / 2, y: hz.bounce * Math.abs(Math.sin(ph * 3)), roll: d / hz.r, kind: hz.kind, r: hz.r };
  }
  // a steam vent (world 4): fixed in its lane; puff runs 0..1..0 while it is on, and it only hits while on
  function ventAt(r, i, t) {
    var hz = r.g.hazards[i], c = (t === undefined ? r.t : t) / hz.period + hz.phase, f = c - Math.floor(c), on = f < hz.vent, p = pointAt(r.g, hz.s, hz.off);
    return { x: p.x, z: p.z, s: hz.s, d: hz.off, h: p.h, y: 0, roll: 0, kind: hz.kind, r: hz.r, on: on, puff: on ? Math.max(0, Math.sin(Math.PI * f / hz.vent)) : 0 };
  }
  // the lane a car should take past hazards it will reach in the next few cells, or lane if none is in the way
  function dodge(r, car, lane) {
    var g = r.g;
    for (var i = 0; i < g.hazards.length; i++) {
      var ahead = dS(g, g.hazards[i].s, car.s);
      if (ahead < 0.5 || ahead > 12) continue;
      if (car.ai && (car.i * 7 + i * 3 + car.lap) % 4 === 0) continue; // rivals miss one now and then
      var hz = hazardAt(r, i, r.t + ahead / Math.max(4, car.v)), room = hz.r + CAR_R + 0.9;
      if (hz.on !== false && Math.abs(hz.d - lane) < room) {
        var side = Math.abs(hz.d) > g.hw - room ? -Math.sign(hz.d) : lane >= hz.d ? 1 : -1;
        lane = clamp(hz.d + side * room, -g.hw + 0.6, g.hw - 0.6);
      }
    }
    return lane;
  }
  // the AI and the test bots steer toward a point ahead on their lane; returns an input
  function aimAhead(r, car, look, lane) {
    var p = pointAt(r.g, car.s + look, lane);
    return Math.atan2(p.z - car.z, p.x - car.x);
  }
  function aiInput(r, car) {
    var inp = { aim: aimAhead(r, car, 3 + car.v * 0.35, dodge(r, car, car.lane)) };
    if (car.item && car.rollT <= 0) {
      car.itemDelay -= DT;
      if (car.itemDelay <= 0) {
        var it = car.item, behind = false, ahead = false;
        r.cars.forEach(function (o) { if (o !== car) { var d = dS(r.g, o.s, car.s); if (d < 0 && d > -7) behind = true; if (o.place === car.place - 1) ahead = true; } });
        if (it === 'turbo' || it === 'shield' || it === 'magnet' || (it === 'goo' && behind) || (it === 'bee' && ahead)) inp.item = true;
        else if (car.itemDelay < -6) inp.item = true;
      }
    }
    return inp;
  }
  // the stick position whose curved steer (STEER_LIN) is u: the sloppy bot aims for a turn rate, as a player who has
  // learned the stick does
  function unshape(u) {
    var x = u;
    for (var i = 0; i < 6; i++) x -= (STEER_LIN * x + (1 - STEER_LIN) * x * x * x - u) / (STEER_LIN + 3 * (1 - STEER_LIN) * x * x);
    return clamp(x, -1, 1);
  }
  // style 'clean' drives the racing line and takes boost pads; 'sloppy' reacts late, wobbles and misses pads
  function botInput(r, car, style) {
    var inp = {}, g = r.g;
    if (style === 'sloppy') {
      // a steady weave; its stick swing shrinks with PACE so the sideways error stays the same at any pace
      // it steers on the heading the car is winding toward, as a driver anticipates the car's weight
      var ahead = car.h + car.yawV * YAW_LAG * Math.sqrt(car.stats.weight || 1);
      var want = angDiff(aimAhead(r, car, 2 + car.v * 0.25, 0), ahead) * 2.5 + Math.sin(r.t * 1.7) * 0.45 / PACE;
      car.botSteer += (clamp(want, -1, 1) - car.botSteer) * Math.min(1, DT * BOT_REACT);
      inp.steer = unshape(car.botSteer);
    } else {
      var lane = 0;
      for (var i = 0; i < g.pads.length; i++) { var d = dS(g, g.pads[i].s, car.s); if (d > 0 && d < 14) lane = g.pads[i].off; }
      inp.aim = aimAhead(r, car, 3 + car.v * 0.35, dodge(r, car, lane));
    }
    if (car.item && car.rollT <= 0) inp.item = !car.prevItem;
    return inp;
  }

  function stepCar(r, car) {
    var g = r.g, st = car.stats, inp = car.ai ? aiInput(r, car) : (car.done ? { aim: aimAhead(r, car, 3 + car.v * 0.35, 0) } : car.inp);
    car.inp = inp;
    var drift = !!inp.drift, item = !!inp.item;
    var driftPress = drift && !car.prevDrift, itemPress = car.ai ? item && !car.prevItem : !!car.itemQueued;
    car.itemQueued = false;
    car.prevDrift = drift; car.prevItem = item;
    // timers
    var hopping = car.hopT > 0;
    car.hopT = Math.max(0, car.hopT - DT); car.hopY = car.hopT > 0 ? Math.sin(Math.PI * (1 - car.hopT / HOP_T)) * HOP_H : 0;
    car.boostT = Math.max(0, car.boostT - DT); car.slowT = Math.max(0, car.slowT - DT); car.shieldT = Math.max(0, car.shieldT - DT);
    car.magnetT = Math.max(0, car.magnetT - DT); car.rollT = Math.max(0, car.rollT - DT); car.trickT = Math.max(0, car.trickT - DT); car.bumpT = Math.max(0, car.bumpT - DT);
    if (car.fallT > 0) {
      car.fallT -= DT;
      if (car.fellAt >= 0) car.y -= 3 * DT;
      else { // off an edge: carry on outward and drop
        car.x += car.fvx * DT; car.z += car.fvz * DT; car.fvx *= 1 - 1.5 * DT; car.fvz *= 1 - 1.5 * DT;
        car.vy -= G * DT; car.y += car.vy * DT;
      }
      if (car.fallT <= 0) {
        var back, lane = car.ai ? ((car.i % 3) - 1) * 1.6 : 0;
        if (car.fellAt >= 0) { var m = g.ramps[car.fellAt]; back = m.s + m.len + m.gap + 2.5 + (car.i % 3) * 1.2; lane = ((car.i % 3) - 1) * 1.6; }
        else back = car.fellS - 3 - (car.i % 3);
        var oldProg = car.prog; place(r, car, back, lane);
        car.prog = oldProg + dS(g, car.s, wrapS(g, oldProg)); car.v = st.speed * 0.45;
        ev(r, 'putback', car);
      }
      return;
    }
    if (itemPress && !car.air) useItem(r, car);
    else if (itemPress && car.air) useItem(r, car);
    // steering
    var steer = inp.steer || 0, aimed = inp.aim !== undefined && inp.aim !== null;
    if (aimed) steer = clamp(angDiff(inp.aim, car.h) * 2.5, -1, 1);
    else if (inp.ease) {
      var want = clamp(steer, -1, 1), cur = car.steerOut, sr = want * cur < 0 || Math.abs(want) < Math.abs(cur) ? STEER_FALL : car.driftDir ? DRIFT_RISE : STEER_RISE;
      steer = cur + clamp(want - cur, -sr * DT, sr * DT);
    }
    steer = clamp(steer, -1, 1);
    car.steerOut = steer;
    var q = g.query(car.x, car.z, car.s);
    var surf = car.air ? 1 : surfaceSpeed(r, car, q.d);
    // drifting: a press on the ground hops at once, and the drift starts on landing if steering (drift held through a
    // ramp landing drifts too). A drift keeps the direction it starts in until drift is let go; steering into it
    // charges the boost faster. The drift button never brakes.
    var steering = Math.abs(steer) >= 0.3;
    if (!drift) car.driftReady = false;
    if (driftPress && !car.air && !hopping && !car.driftDir && car.onRamp < 0) { car.hopT = HOP_T; car.hopY = 0; car.driftReady = true; ev(r, 'hop', car); }
    if (car.air && drift) car.driftReady = true;
    if (!car.air && !hopping && car.hopT <= 0 && drift && car.v > DRIFT_MIN_V && (car.driftDir || (car.driftReady && steering))) {
      if (!car.driftDir) { car.driftDir = steer > 0 ? 1 : -1; car.drift = 0; car.driftReady = false; ev(r, 'drift', car); }
      car.drift += DT * (DRIFT_CHARGE_WIDE + (1 - DRIFT_CHARGE_WIDE) * (1 + steer * car.driftDir) / 2);
    } else if (car.driftDir) {
      var tier = 0; while (tier < DRIFT_TIERS.length && car.drift >= DRIFT_TIERS[tier]) tier++;
      if (tier) {
        var dur = DRIFT_BOOST[tier - 1] * st.boostDur * (st.perk === 'pads' ? 1.5 : 1);
        car.boostT = Math.max(car.boostT, dur); ev(r, 'boost', car, { from: 'drift', tier: tier, big: tier >= 2 });
      }
      car.driftDir = 0; car.drift = 0;
    }
    if (car.driftDir) car.slipDir = car.driftDir;
    car.slip = clamp((car.slip || 0) + (car.driftDir ? 1 : -1) * SLIDE_RISE * DT, 0, 1);
    if (car.air && driftPress && !car.trick) { car.trick = true; car.trickT = 0.45; ev(r, 'trick', car); }
    // speed
    var top = car.ai ? aiTop(r, car) : st.speed, v0 = car.v;
    var vmax = top * surf * (car.slowT > 0 ? SLOW_MUL : 1) * (car.boostT > 0 ? st.boostMul : 1) * (car.air && st.glide ? 1 + 0.04 * st.glide : 1);
    if (!car.air) { var slope = slopeAt(g, q.s) * (Math.cos(car.vh) * q.tx + Math.sin(car.vh) * q.tz); vmax *= clamp(1 - SLOPE_K * slope, 0.7, 1.3); }
    if (r.phase !== 'race' && !car.done) vmax = 0;
    var acc = st.accel * (car.boostT > 0 ? BOOST_ACC : 1);
    if (car.v < vmax) car.v = Math.min(vmax, car.v + acc * DT * (1 - 0.4 * car.v / Math.max(1, vmax)));
    else car.v = Math.max(vmax, car.v - (2.5 + (car.v - vmax) * 2) * DT);
    if (car.driftDir) car.v *= 1 - 0.12 * DT;
    var accel = (car.v - v0) / DT;
    // turning
    var env = envOf(r), rate = st.grip * env.grip * Math.min(1, car.v / 4) * (car.air ? 0.3 + 0.1 * (st.glide || 0) : car.hopT > 0 ? HOP_STEER : 1);
    // in a drift the car always turns its own way: steering in tightens it, steering against widens it
    var shaped = aimed ? steer : STEER_LIN * steer + (1 - STEER_LIN) * steer * steer * steer;
    var yawWant = car.driftDir ? car.driftDir * rate * (DRIFT_WIDE + (DRIFT_TURN - DRIFT_WIDE) * (1 + steer * car.driftDir) / 2) : shaped * rate;
    var wt = Math.sqrt(st.weight || 1);
    var unwind = !car.driftDir && car.yawV * (yawWant - car.yawV) < 0;
    car.yawV += (yawWant - car.yawV) * Math.min(1, DT / (YAW_LAG * wt * (car.driftDir ? DRIFT_LAG : unwind ? YAW_UNWIND : 1)));
    car.h += car.yawV * DT;
    // move along the direction of travel, which swings toward the heading as the tyres bite
    var bite = GRIP_BITE * st.grip * env.grip / wt * (car.air ? AIR_BITE : car.driftDir ? DRIFT_BITE : 1);
    car.vh += angDiff(car.h, car.vh) * Math.min(1, bite * DT);
    car.x += Math.cos(car.vh) * car.v * DT; car.z += Math.sin(car.vh) * car.v * DT;
    // a drift slides the car toward the outside of the turn (the left of a right-hand drift)
    if (car.slip > 0) { var sl = car.slipDir * DRIFT_SLIDE * car.slip * car.v * DT; car.x += Math.sin(car.h) * sl; car.z -= Math.cos(car.h) * sl; }
    q = g.query(car.x, car.z, car.s);
    var ds = dS(g, q.s, car.s);
    // ramps: ride up, then launch off the lip
    if (!car.air) {
      var on = -1;
      for (var i = 0; i < g.ramps.length; i++) { var mm = g.ramps[i], into = dS(g, q.s, mm.s); if (into >= 0 && into <= mm.len && Math.abs(q.d) <= g.hw + 0.3) { on = i; car.y = into / mm.len * mm.h; } }
      if (on < 0 && car.onRamp >= 0) {
        var lip = g.ramps[car.onRamp];
        if (dS(g, q.s, lip.s) > lip.len - 0.01) { car.air = true; car.trick = false; car.y = lip.h; car.vy = car.gvy + (2 + 0.38 * car.v) * (st.perk === 'air' ? 1.2 : 1); ev(r, 'jump', car); }
        else car.y = 0;
      }
      car.onRamp = on;
    }
    // jump gaps: landing short drops the car in
    if (!car.air && car.onRamp < 0) {
      for (var gi = 0; gi < g.ramps.length; gi++) {
        var gm = g.ramps[gi]; if (!gm.gap) continue;
        var past = dS(g, q.s, gm.s) - gm.len;
        if (past > 0 && past < gm.gap) { car.fallT = FALL_T; car.fellAt = gi; car.vy = 0; car.v = 0; car.boostT = 0; car.drift = 0; car.driftDir = 0; ev(r, 'splash', car); break; }
      }
    }
    // walls: a gentle bounce back toward the road
    var lim = q.d > 0 ? q.limR : q.limL;
    if (lim >= OPEN) {
      // an open edge (a bridge or a cliff): past the lip, and not flying high over it, the car falls off
      if (Math.abs(q.d) > g.hw + EDGE && (!car.air || car.y < 0.6) && car.fallT <= 0) {
        car.fallT = FALL_T; car.fellAt = -1; car.fellS = q.s; car.fvx = Math.cos(car.vh) * car.v; car.fvz = Math.sin(car.vh) * car.v;
        if (!car.air) car.vy = Math.min(0, car.gvy || 0);
        car.air = false; car.v = 0; car.boostT = 0; car.drift = 0; car.driftDir = 0; car.hopT = 0;
        car.s = q.s; car.d = q.d; car.prog += ds;
        ev(r, 'fall', car);
        return;
      }
    } else if (Math.abs(q.d) > lim) {
      var sg = q.d > 0 ? 1 : -1, nx = -q.tz * sg, nz = q.tx * sg;
      car.x = q.px + nx * lim; car.z = q.pz + nz * lim;
      var road = Math.atan2(q.tz, q.tx), fwd = Math.cos(car.h - road) >= 0 ? road : road + Math.PI;
      car.h += angDiff(fwd, car.h) * 0.35; car.vh = car.h; car.yawV *= 0.3;
      car.v *= 0.9;
      if (car.bumpT <= 0) car.rollV += sg * 1.2;
      if (car.bumpT <= 0) { ev(r, 'wall', car); car.bumpT = 0.4; }
      q = g.query(car.x, car.z, car.s); ds = dS(g, q.s, car.s);
    }
    car.s = q.s; car.prog += ds; car.d = q.d;
    // height: car.y is above the ground under the car (car.gy); vy is the true vertical speed. On the ground the car
    // rides the hills (gvy); where the ground falls away faster than gravity pulls, it flies off the crest
    var gNew = groundAt(g, q.s), gvyNew = (gNew - car.gy) / DT;
    if (!car.air && car.onRamp < 0) {
      if (car.gvyOk && car.v > DRIFT_MIN_V && car.gvy - gvyNew > G * env.grav * DT * 1.05) {
        car.air = true; car.trick = false; car.vy = car.gvy; car.y = car.gy + car.gvy * DT - gNew; ev(r, 'jump', car, { crest: true });
      }
      car.gvyOk = true;
    }
    if (car.air) {
      // the glider opens on the way down and slows the fall
      car.vy -= G * env.grav * DT * (car.vy < 0 && st.glide ? Math.max(0.25, 1 - 0.22 * st.glide) : 1);
      car.y += car.gy - gNew + car.vy * DT;
      if (car.y <= 0) {
        car.dipV += DIP_K * Math.max(0, gvyNew - car.vy);
        car.y = 0; car.air = false; car.vy = 0;
        if (car.trick) { car.boostT = Math.max(car.boostT, 0.9 * st.boostDur * (st.perk === 'air' ? 1.6 : 1)); ev(r, 'boost', car, { from: 'trick' }); }
        else if (st.glide) { car.boostT = Math.max(car.boostT, 0.15 * st.glide * st.boostDur); ev(r, 'boost', car, { from: 'glide' }); } // the wings fold into a little boost
        car.trick = false; ev(r, 'land', car);
      }
    }
    car.gvy = gvyNew; car.gy = gNew;
    body(car, steer, accel);
    // boost pads
    if (!car.air) {
      var onPad = -1;
      for (var pi = 0; pi < g.pads.length; pi++) { var pd = g.pads[pi]; if (Math.abs(dS(g, q.s, pd.s)) < PAD_LEN / 2 && Math.abs(q.d - pd.off) < PAD_W / 2) onPad = pi; }
      if (onPad >= 0) {
        car.boostT = Math.max(car.boostT, 1.1 * st.boostDur * (st.perk === 'pads' ? 1.5 : 1));
        if (car.pad !== onPad) ev(r, 'boost', car, { from: 'pad' });
      }
      car.pad = onPad;
    }
    // item boxes
    for (var bi = 0; bi < g.boxes.length; bi++) {
      var bx = g.boxes[bi], bs = r.boxes[bi];
      if (bs.t > 0 || car.y > 1.2 || Math.abs(car.gy - groundAt(g, bx.s)) > 2) continue;
      if ((car.x - bx.x) * (car.x - bx.x) + (car.z - bx.z) * (car.z - bx.z) < BOX_R * BOX_R) {
        bs.t = BOX_RESPAWN;
        if (!car.item) {
          car.item = rollItem(r.rng, car.place, r.cars.length, st.perk === 'luck');
          car.rollT = ROLL_T; car.itemDelay = 1 + r.rng() * 2;
          ev(r, 'box', car, { item: car.item });
        } else ev(r, 'boxEmpty', car);
        if (st.perk === 'luck' && !car.ai) { car.coins += 3; ev(r, 'coin', car, { n: 3 }); }
      }
    }
    // coins: the player's only
    if (!car.ai) {
      var cr = car.magnetT > 0 ? MAGNET_R : COIN_R;
      for (var ci = 0; ci < g.coins.length; ci++) {
        var cn = g.coins[ci], cs = r.coins[ci];
        if (cs.t > 0 || Math.abs(car.gy + car.y - groundAt(g, cn.s)) > 2) continue;
        if ((car.x - cn.x) * (car.x - cn.x) + (car.z - cn.z) * (car.z - cn.z) < cr * cr && car.y < 1.5) { cs.t = COIN_RESPAWN; car.coins++; ev(r, 'coin', car, { n: 1, x: cn.x, z: cn.z }); }
      }
    }
  }
  // the rivals' top speed: their skill, slowed in sharp bends, and pulled toward the player (rubber band)
  function aiTop(r, car) {
    var W = WORLDS[r.world], p = r.cars[0], g = r.g;
    var top = W.aiSpeed * (TRACKS[r.id].ai || 1) * PACE * car.skill;
    if (!p.done) {
      var gap = car.prog - p.prog;
      top *= 1 + clamp(-gap * (gap > 0 ? 0.011 : 0.004), -0.25, 0.06);
    }
    var bend = 0;
    for (var a = 2; a <= 10; a += 2) bend = Math.max(bend, Math.abs(pointAt(g, car.s + a, 0).k));
    if (bend > 0.12) top *= Math.max(0.78, 1 - (bend - 0.12) * 1.6);
    return top;
  }
  function stepWorld(r) {
    var g = r.g, i, j;
    r.boxes.forEach(function (b) { b.t = Math.max(0, b.t - DT); });
    r.coins.forEach(function (c) { c.t = Math.max(0, c.t - DT); });
    // goo puddles
    for (i = r.goos.length - 1; i >= 0; i--) {
      var gp = r.goos[i]; gp.t -= DT; gp.safe -= DT;
      if (gp.t <= 0) { r.goos.splice(i, 1); continue; }
      for (j = 0; j < r.cars.length; j++) {
        var c = r.cars[j]; if (c.air || c.fallT > 0) continue;
        if (c.i === gp.owner && gp.safe > 0) continue;
        if (Math.abs(c.gy - gp.y) < 1.5 && (c.x - gp.x) * (c.x - gp.x) + (c.z - gp.z) * (c.z - gp.z) < 0.95 * 0.95) { hit(r, c, 'goo'); r.goos.splice(i, 1); break; }
      }
    }
    // bees fly to their target, or along the road when there is none
    for (i = r.bees.length - 1; i >= 0; i--) {
      var b = r.bees[i]; b.t -= DT;
      if (b.t <= 0) { r.bees.splice(i, 1); continue; }
      var tgt = b.target >= 0 ? r.cars[b.target] : null, want;
      var bq = g.query(b.x, b.z, b.s);
      if (tgt && !tgt.done) want = Math.atan2(tgt.z - b.z, tgt.x - b.x);
      else want = headingAt(g, bq.s + 4);
      b.h += clamp(angDiff(want, b.h), -BEE_TURN * DT, BEE_TURN * DT);
      b.x += Math.cos(b.h) * BEE_SPEED * DT; b.z += Math.sin(b.h) * BEE_SPEED * DT;
      b.s = g.query(b.x, b.z, bq.s).s;
      var wantY = tgt && !tgt.done ? tgt.gy + Math.max(0, tgt.y) + 1 : groundAt(g, b.s) + 1;
      b.y += (wantY - b.y) * Math.min(1, 4 * DT);
      if (tgt && Math.abs(b.y - tgt.gy - Math.max(0, tgt.y) - 1) < 1.8 && (tgt.x - b.x) * (tgt.x - b.x) + (tgt.z - b.z) * (tgt.z - b.z) < 1) { hit(r, tgt, 'bee'); r.bees.splice(i, 1); }
    }
    // hazards: a car low enough to touch one is hit, then gets HAZ_COOL s to get clear
    for (i = 0; i < g.hazards.length; i++) {
      var hz = null;
      for (j = 0; j < r.cars.length; j++) {
        var hc = r.cars[j];
        if (hc.fallT > 0 || (hc.hazT || 0) > r.t) continue;
        if (Math.abs(dS(g, hc.s, g.hazards[i].s)) > 3) continue;
        hz = hz || hazardAt(r, i);
        var rr = hz.r + CAR_R;
        if (hz.on === false || hc.y > g.hazards[i].h - hz.y || (hc.x - hz.x) * (hc.x - hz.x) + (hc.z - hz.z) * (hc.z - hz.z) > rr * rr) continue;
        hc.hazT = r.t + HAZ_COOL;
        hit(r, hc, 'hazard', { hazard: hz.kind });
      }
    }
    // cars bump each other apart, the lighter one moving more
    for (i = 0; i < r.cars.length; i++) for (j = i + 1; j < r.cars.length; j++) {
      var a = r.cars[i], c2 = r.cars[j];
      if (a.fallT > 0 || c2.fallT > 0 || Math.abs(a.gy + a.y - c2.gy - c2.y) > 0.8) continue;
      var dx = c2.x - a.x, dz = c2.z - a.z, d2 = dx * dx + dz * dz, min = CAR_R * 2;
      if (d2 < min * min && d2 > 1e-6) {
        var d = Math.sqrt(d2), push = (min - d), wa = c2.stats.weight / (a.stats.weight + c2.stats.weight);
        a.x -= dx / d * push * wa; a.z -= dz / d * push * wa;
        c2.x += dx / d * push * (1 - wa); c2.z += dz / d * push * (1 - wa);
        var back = dS(g, a.s, c2.s) < 0 ? a : c2; back.v *= 0.995;
        if (a.bumpT <= 0 && (a.i === 0 || c2.i === 0)) { ev(r, 'bump', a.i === 0 ? a : c2); a.bumpT = 0.4; }
      }
    }
  }
  function updateOrder(r) {
    var order = r.cars.slice().sort(function (a, b) {
      if (a.done && b.done) return a.finishT - b.finishT;
      if (a.done !== b.done) return a.done ? -1 : 1;
      return b.prog - a.prog;
    });
    order.forEach(function (c, k) { c.place = k + 1; });
    r.order = order;
  }
  // 'pass' / 'lostPlace' when the player's place has changed and held for PLACE_HOLD s (side-by-side jitter is
  // not news); a jump of several places is one event carrying the new place
  function placeNews(r, p) {
    if (p.placeSaid === undefined) { p.placeSaid = p.placeNow = p.place; p.placeSince = r.t; return; } // the first race step
    if (p.place !== p.placeNow) { p.placeNow = p.place; p.placeSince = r.t; }
    if (p.placeNow !== p.placeSaid && r.t - p.placeSince >= PLACE_HOLD - 1e-9) {
      ev(r, p.placeNow < p.placeSaid ? 'pass' : 'lostPlace', p, { place: p.placeNow });
      p.placeSaid = p.placeNow;
    }
  }
  function stepFixed(r) {
    if (r.phase === 'done') { r.cars.forEach(function (c) { stepCar(r, c); }); return; }
    if (r.phase === 'count') {
      var before = Math.ceil(r.cd); r.cd -= DT;
      if (Math.ceil(r.cd) !== before && r.cd > 0) ev(r, 'count', null, { n: Math.ceil(r.cd) });
      if (r.cd <= 0) {
        r.phase = 'race'; ev(r, 'go');
        r.cars.forEach(function (c) { c.boostT = Math.max(c.stats.perk === 'start' ? 1 : 0, c.stats.launch || 0); });
      }
      r.cars.forEach(function (c) { c.v = 0; });
      return;
    }
    r.t += DT;
    updateOrder(r);
    r.cars.forEach(function (c) { stepCar(r, c); });
    stepWorld(r);
    var L = r.g.L;
    r.cars.forEach(function (c) {
      if (c.done) return;
      var lap = Math.floor(c.prog / L) + 1; // prog is 0 on the start line and negative on the grid
      if (lap > c.lap) { c.lap = lap; if (c.lap <= r.laps) ev(r, 'lap', c, { lap: c.lap }); }
      if (c.prog >= r.laps * L) { c.done = true; c.finishT = r.t; r.finished++; ev(r, 'finish', c); }
    });
    updateOrder(r);
    var p = r.cars[0];
    if (!p.done) placeNews(r, p);
    if (p.done) {
      // finish the field at its present pace so the result table is complete
      r.cars.forEach(function (c) {
        if (c.done) return;
        c.done = true; c.finishT = r.t + (r.laps * L - c.prog) / Math.max(1, WORLDS[r.world].aiSpeed * (TRACKS[r.id].ai || 1) * c.skill * 0.9);
      });
      updateOrder(r);
      r.phase = 'done'; ev(r, 'raceOver', p, { place: p.place });
    }
  }
  function stepRace(r, dt) {
    r.acc = (r.acc || 0) + dt;
    while (r.acc >= DT - 1e-9) { stepFixed(r); r.acc -= DT; }
  }

  // ---------- economy and progress ----------
  function worldOf(trackId) { return TRACKS[trackId].world; }
  function record(s, id, place, time) {
    if (!s.best[id] || place < s.best[id]) s.best[id] = place;
    if (!s.bestT[id] || time < s.bestT[id]) s.bestT[id] = Math.round(time * 100) / 100;
  }
  function worldUnlocked(s, w) {
    if (w === 0) return true;
    var prev = WORLDS[w - 1].tracks;
    return prev.length > 0 && prev.every(function (t) { return s.best[t] === 1; });
  }
  function trackUnlocked(s, id) {
    var w = worldOf(id), list = WORLDS[w].tracks, i = list.indexOf(id);
    return worldUnlocked(s, w) && (i === 0 || s.best[list[i - 1]] === 1);
  }
  function finishRace(s, r) {
    var p = r.cars[0], place = p.place, W = WORLDS[r.world];
    var wasT = WORLDS[r.world].tracks.map(function (t) { return trackUnlocked(s, t); }), wasW = WORLDS.map(function (w, i) { return worldUnlocked(s, i); }), wasC = {};
    Object.keys(CARS).forEach(function (id) { wasC[id] = carUnlocked(s, id); });
    var coins = Math.round(PLACE_PAY[place - 1] * W.pay) + p.coins, parts = [0, 0, 0, 0, 0];
    parts[r.world] += PART_PAY[place - 1];
    if (place === 1 && r.world + 1 < parts.length) parts[r.world + 1] += 1;
    // the first win of each track pays a bonus (already in the totals; `bonus` says how much of them it was)
    var firstWin = place === 1 && !(s.wins[r.id] > 0), bonus = null;
    if (place === 1) s.wins[r.id] = (s.wins[r.id] || 0) + 1;
    if (firstWin) {
      bonus = { coins: Math.round(FIRST_WIN.coins * W.pay), parts: [0, 0, 0, 0, 0] };
      bonus.parts[Math.min(4, r.world + 1)] += FIRST_WIN.parts;
      coins += bonus.coins;
      for (var b = 0; b < 5; b++) parts[b] += bonus.parts[b];
    }
    s.coins += coins;
    for (var i = 0; i < 5; i++) s.parts[i] += parts[i];
    var newBest = !s.bestT[r.id] || p.finishT < s.bestT[r.id];
    record(s, r.id, place, p.finishT);
    var unlocked = [];
    WORLDS[r.world].tracks.forEach(function (t, k) { if (!wasT[k] && trackUnlocked(s, t)) unlocked.push(TRACKS[t].name); });
    WORLDS.forEach(function (w, k) { if (w.tracks.length && !wasW[k] && worldUnlocked(s, k)) unlocked.push(w.name); }); // a world with nothing to race is not news
    Object.keys(CARS).forEach(function (id) { if (!wasC[id] && carUnlocked(s, id)) unlocked.push(CARS[id].name + ' at the car lot'); });
    s.race = null;
    return { place: place, coins: coins, trackCoins: p.coins, parts: parts, time: p.finishT, newBest: newBest, unlocked: unlocked, firstWin: firstWin, bonus: bonus };
  }
  function canAfford(s, cost) {
    if (!cost || s.coins < cost.coins) return false;
    for (var i = 0; i < 5; i++) if (s.parts[i] < cost.parts[i]) return false;
    return true;
  }
  function pay(s, cost) { s.coins -= cost.coins; for (var i = 0; i < 5; i++) s.parts[i] -= cost.parts[i]; }
  function tradeParts(s, from, to) {
    if (from < 0 || to < 0 || from >= PARTS.length || to >= PARTS.length || Math.abs(to - from) !== 1) return false;
    var give = to > from ? PART_UP : 1, get = to > from ? 1 : PART_DOWN;
    if ((s.parts[from] || 0) < give) return false;
    s.parts[from] -= give; s.parts[to] = (s.parts[to] || 0) + get;
    return true;
  }
  function upgradeCost(s, id, key) {
    var c = s.cars[id]; if (!c) return null;
    var L = c.up[key]; if (L >= CARS[id].caps[key]) return null;
    var tier = Math.min(4, Math.floor(L / 3)), parts = [0, 0, 0, 0, 0];
    parts[tier] = 2 + L;
    if (tier > 0) parts[tier - 1] += 2 * L;
    return { coins: Math.round(60 * Math.pow(1.5, L) * CARS[id].price / 5) * 5, parts: parts };
  }
  function buyUpgrade(s, id, key) {
    var cost = upgradeCost(s, id, key);
    if (!cost || !canAfford(s, cost)) return false;
    pay(s, cost); s.cars[id].up[key]++;
    return true;
  }
  function carUnlocked(s, id) { var u = CARS[id] && CARS[id].unlock; return !u || u.every(function (t) { return s.best[t] === 1; }); }
  // what is left to win before a car opens, or null
  function carLockReason(s, id) {
    if (carUnlocked(s, id)) return null;
    var left = CARS[id].unlock.filter(function (t) { return s.best[t] !== 1; }).map(function (t) { return TRACKS[t].name; });
    return 'Win ' + (left.length > 1 ? left.slice(0, -1).join(', ') + ' and ' + left[left.length - 1] : left[0]) + ' to open';
  }
  function buyCar(s, id) {
    if (!CARS[id] || s.owned.indexOf(id) >= 0 || !carUnlocked(s, id)) return false;
    var cost = CARS[id].cost; if (!canAfford(s, cost)) return false;
    pay(s, cost); s.owned.push(id); s.cars[id] = newCar(id);
    return true;
  }
  function selectCar(s, id) { if (s.owned.indexOf(id) < 0) return false; s.car = id; return true; }
  function buyLook(s, slot, id) {
    var o = lookOpt(slot, id); if (!o || s.looks[slot].indexOf(id) >= 0 || s.coins < o.cost) return false;
    s.coins -= o.cost; s.looks[slot].push(id);
    return true;
  }
  function equip(s, carId, slot, id) {
    if (!s.cars[carId] || s.looks[slot].indexOf(id) < 0) return false;
    s.cars[carId].look[slot] = id;
    return true;
  }

  // ---------- garage plaza ----------
  // One character per cell from (0, 0), x across and z down. '#' wall or building, '.' paving, 'o' a prop that
  // blocks, '~' flower bed (blocks). Pads: g garage, p paint shop, c car lot, t track signpost, s start.
  var HUB = {
    rows: [
      '####################',
      '#GGGGG......PPPPP..#',
      '#GGGGG......PPPPP..#',
      '#GGGGG......PPPPP..#',
      '#..g..........p....#',
      '#..................#',
      '#~~......oo......~~#',
      '#~~......oo......~~#',
      '#..........s.......#',
      '#..................#',
      '#CCCCCCC.......T...#',
      '#CCCCCCC.......t...#',
      '#CCCCCCC...........#',
      '#...c..............#',
      '####################'
    ],
    pads: { g: 'garage', p: 'paint', c: 'lot', t: 'track' }
  };
  var HUB_SPEED = 4.2;
  function hubCell(x, z) { var row = HUB.rows[Math.floor(z)]; return row ? row.charAt(Math.floor(x)) || '#' : '#'; }
  function hubOpen(x, z) { var c = hubCell(x, z); return c === '.' || c === 's' || HUB.pads[c] !== undefined; }
  function hubFind(ch) { for (var z = 0; z < HUB.rows.length; z++) { var x = HUB.rows[z].indexOf(ch); if (x >= 0) return { x: x + 0.5, z: z + 0.5 }; } return null; }
  // the kid starts on the plaza's start cell, or on a station's pad (newHub('garage') after a race)
  function newHub(at) { var ch = 's'; for (var c in HUB.pads) if (HUB.pads[c] === at) ch = c; var p = hubFind(ch); return { x: p.x, z: p.z, face: 0, path: [], moving: false, walk: 0 }; }
  function hubStation(h) { return HUB.pads[hubCell(h.x, h.z)] || null; }
  // move with a world-space direction (dx, dz), sliding along walls; or follow the tap path
  function hubStep(h, dt, dir) {
    var dx = 0, dz = 0;
    if (dir && (dir.x || dir.z)) { h.path = []; dx = dir.x; dz = dir.z; }
    else if (h.path.length) {
      var t = h.path[0], ex = t.x - h.x, ez = t.z - h.z, d = Math.hypot(ex, ez);
      if (d < 0.08) { h.x = t.x; h.z = t.z; h.path.shift(); }
      else { dx = ex / d; dz = ez / d; if (d < HUB_SPEED * dt) { h.x = t.x; h.z = t.z; h.path.shift(); dx = dz = 0; h.moving = true; h.walk += d; return; } }
    }
    var l = Math.hypot(dx, dz);
    h.moving = l > 0;
    if (!l) return;
    dx /= l; dz /= l; h.face = Math.atan2(dz, dx);
    var step = HUB_SPEED * dt, R0 = 0.28;
    var nx = h.x + dx * step;
    if (hubOpen(nx + Math.sign(dx) * R0, h.z - R0) && hubOpen(nx + Math.sign(dx) * R0, h.z + R0)) h.x = nx;
    var nz = h.z + dz * step;
    if (hubOpen(h.x - R0, nz + Math.sign(dz) * R0) && hubOpen(h.x + R0, nz + Math.sign(dz) * R0)) h.z = nz;
    h.walk += step;
  }
  function hubWalkTo(h, x, z) {
    var W = HUB.rows[0].length, H = HUB.rows.length, sx = Math.floor(h.x), sz = Math.floor(h.z), tx = Math.floor(x), tz = Math.floor(z);
    if (!hubOpen(tx + 0.5, tz + 0.5)) return false;
    var prev = new Int32Array(W * H).fill(-1), q = [sz * W + sx]; prev[q[0]] = q[0];
    while (q.length) {
      var c = q.shift(), cx = c % W, cz = (c / W) | 0;
      if (cx === tx && cz === tz) break;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = cx + d[0], nz = cz + d[1], n = nz * W + nx;
        if (nx >= 0 && nz >= 0 && nx < W && nz < H && prev[n] < 0 && hubOpen(nx + 0.5, nz + 0.5)) { prev[n] = c; q.push(n); }
      });
    }
    var end = tz * W + tx; if (prev[end] < 0) return false;
    var path = [];
    for (var k = end; k !== sz * W + sx; k = prev[k]) path.unshift({ x: k % W + 0.5, z: ((k / W) | 0) + 0.5 });
    h.path = path;
    return true;
  }

  // ---------- state and saving ----------
  var VERSION = 1;
  function newState(seed) {
    var looks = {};
    LOOK_KEYS.forEach(function (k) { looks[k] = LOOKS[k].filter(function (o) { return o.cost === 0; }).map(function (o) { return o.id; }); });
    var cars = {}; cars[START_CAR] = newCar(START_CAR);
    return { v: VERSION, seed: seed | 0, coins: 0, parts: [0, 0, 0, 0, 0], owned: [START_CAR], car: START_CAR, cars: cars,
      looks: looks, best: {}, bestT: {}, wins: {}, races: 0, world: 0, race: null };
  }
  function serialize(s) {
    return JSON.stringify({ v: VERSION, seed: s.seed, coins: s.coins, parts: s.parts, owned: s.owned, car: s.car, cars: s.cars,
      looks: s.looks, best: s.best, bestT: s.bestT, wins: s.wins, races: s.races, world: s.world });
  }
  function deserialize(raw) {
    var o; try { o = JSON.parse(raw); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== VERSION) return null;
    var s = newState(o.seed);
    ['coins', 'races', 'world'].forEach(function (k) { if (typeof o[k] === 'number') s[k] = o[k]; });
    if (Array.isArray(o.parts)) for (var i = 0; i < 5; i++) s.parts[i] = +o.parts[i] || 0;
    if (Array.isArray(o.owned)) s.owned = o.owned.filter(function (id) { return CARS[id]; });
    if (s.owned.indexOf(START_CAR) < 0) s.owned.unshift(START_CAR);
    s.owned.forEach(function (id) {
      var c = newCar(id), src = o.cars && o.cars[id];
      if (src) { UP_KEYS.forEach(function (k) { if (src.up && typeof src.up[k] === 'number') c.up[k] = Math.min(CARS[id].caps[k], src.up[k]); }); LOOK_KEYS.forEach(function (k) { if (src.look && lookOpt(k, src.look[k])) c.look[k] = src.look[k]; }); }
      s.cars[id] = c;
    });
    s.car = s.owned.indexOf(o.car) >= 0 ? o.car : START_CAR;
    if (o.looks) LOOK_KEYS.forEach(function (k) { (o.looks[k] || []).forEach(function (id) { if (lookOpt(k, id) && s.looks[k].indexOf(id) < 0) s.looks[k].push(id); }); });
    if (o.best) for (var t in o.best) if (TRACKS[t]) s.best[t] = o.best[t];
    if (o.bestT) for (var u in o.bestT) if (TRACKS[u]) s.bestT[u] = o.bestT[u];
    if (o.wins) for (var w in o.wins) if (TRACKS[w] && typeof o.wins[w] === 'number') s.wins[w] = o.wins[w];
    for (var b in s.best) if (s.best[b] === 1 && !(s.wins[b] > 0)) s.wins[b] = 1; // a save from before wins were kept: a won track has had its first win
    return s;
  }

  return {
    DT: DT, PACE: PACE, DRIFT_TIERS: DRIFT_TIERS, RUNOFF: RUNOFF, RAMP_LEN: RAMP_LEN, PAD_LEN: PAD_LEN, PAD_W: PAD_W, MAGNET_R: MAGNET_R, ROLL_T: ROLL_T, START_CAR: START_CAR,
    PLACE_PAY: PLACE_PAY, PART_PAY: PART_PAY, PART_UP: PART_UP, PART_DOWN: PART_DOWN, tradeParts: tradeParts, PARTS: PARTS, ITEMS: ITEMS, ITEM_KEYS: ITEM_KEYS, UPGRADES: UPGRADES, UP_KEYS: UP_KEYS,
    PERKS: PERKS, CARS: CARS, LOOKS: LOOKS, LOOK_KEYS: LOOK_KEYS, TRACKS: TRACKS, WORLDS: WORLDS, HUB: HUB,
    BRIDGE_CLEAR: BRIDGE_CLEAR, EDGE: EDGE, onBridge: onBridge,
    rng: rng, angDiff: angDiff, clamp: clamp, track: track, pointAt: pointAt, groundAt: groundAt, slopeAt: slopeAt, headingAt: headingAt, lookOpt: lookOpt,
    rollItem: rollItem, hazardAt: hazardAt, HAZ: HAZ, envOf: envOf, carStats: carStats, statsFor: statsFor, startRace: startRace, input: input, stepRace: stepRace,
    surfaceSpeed: surfaceSpeed, hit: hit, botInput: botInput, finishRace: finishRace, trackUnlocked: trackUnlocked,
    worldUnlocked: worldUnlocked, canAfford: canAfford, upgradeCost: upgradeCost, buyUpgrade: buyUpgrade, buyCar: buyCar,
    selectCar: selectCar, carUnlocked: carUnlocked, carLockReason: carLockReason, buyLook: buyLook, equip: equip, newState: newState, serialize: serialize, deserialize: deserialize,
    newHub: newHub, hubStep: hubStep, hubWalkTo: hubWalkTo, hubStation: hubStation, hubOpen: hubOpen, hubCell: hubCell,
    _place: place, _record: record, _newCar: newCar
  };
})();
