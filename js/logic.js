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
  var GRASS = 0.58;             // speed factor on rough grass (Tires raise it)
  var G = 26;                   // gravity in the air, cells/s²
  var RAMP_LEN = 2.5, RAMP_H = 0.9;
  var PAD_LEN = 2.4, PAD_W = 2.4;
  var BOX_RESPAWN = 10, BOX_R = 1.1, ROLL_T = 0.9;
  var COIN_R = 0.9, MAGNET_R = 5, COIN_RESPAWN = 8;
  var CAR_R = 0.55;
  var BOOST_MUL = 1.4, BOOST_ACC = 4;
  var DRIFT_MIN_V = 5, DRIFT_T1 = 0.6, DRIFT_T2 = 1.4;
  var SLOW_MUL = 0.55;
  var BEE_SPEED = 17, BEE_TURN = 6, BEE_LIFE = 6;
  var GOO_LIFE = 25;
  var COUNTDOWN = 3;
  var FALL_T = 1.1;
  var PLACE_PAY = [120, 85, 65, 50, 40, 30];
  var PART_PAY = [4, 3, 2, 2, 1, 1];
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
  var TRACKS = {
    meadow: {
      name: 'Meadow Loop', world: 0, laps: 3, hw: 3.6, scale: 1.28,
      pts: [[20, 20], [60, 14], [100, 20], [114, 40], [100, 60], [76, 60], [62, 72], [68, 92], [50, 106], [24, 100], [12, 76], [14, 46]],
      pads: [{ u: 0.06, off: 0 }, { u: 0.33, off: -1.5 }, { u: 0.62, off: 1.5 }, { u: 0.86, off: 0 }],
      ramps: [{ u: 0.48, gap: 0 }],
      boxes: [0.2, 0.7],
      coins: [{ u: 0.12, off: 1.6, n: 6 }, { u: 0.4, off: -1.6, n: 6 }, { u: 0.55, off: 0, n: 5 }, { u: 0.78, off: -1.2, n: 6 }, { u: 0.93, off: 1.4, n: 5 }]
    },
    creek: {
      name: 'Creek Jump', world: 0, laps: 3, hw: 3.5, scale: 1.26,
      pts: [[16, 30], [40, 14], [74, 16], [96, 28], [118, 20], [136, 36], [128, 62], [100, 70], [82, 90], [56, 96], [36, 80], [40, 58], [20, 52]],
      pads: [{ u: 0.1, off: 0 }, { u: 0.36, off: 1.4 }, { u: 0.58, off: 0 }, { u: 0.8, off: -1.4 }],
      ramps: [{ u: 0.24, gap: 3.2 }, { u: 0.68, gap: 0 }],
      boxes: [0.15, 0.5],
      coins: [{ u: 0.05, off: -1.5, n: 6 }, { u: 0.3, off: 0, n: 5 }, { u: 0.45, off: 1.5, n: 6 }, { u: 0.74, off: 0, n: 5 }, { u: 0.9, off: 1.5, n: 6 }]
    },
    windmill: {
      name: 'Windmill Hills', world: 0, laps: 2, hw: 3.6, scale: 1.28,
      pts: [[20, 24], [56, 12], [96, 16], [130, 12], [156, 30], [150, 58], [120, 64], [104, 84], [128, 104], [118, 128], [84, 132], [64, 112], [42, 120], [18, 106], [26, 80], [12, 56]],
      pads: [{ u: 0.05, off: 0 }, { u: 0.22, off: -1.5 }, { u: 0.4, off: 1.5 }, { u: 0.57, off: 0 }, { u: 0.75, off: -1.5 }, { u: 0.9, off: 1.4 }],
      ramps: [{ u: 0.31, gap: 0 }, { u: 0.64, gap: 3.4 }],
      boxes: [0.14, 0.56],
      coins: [{ u: 0.1, off: 1.5, n: 6 }, { u: 0.27, off: 0, n: 6 }, { u: 0.45, off: -1.5, n: 6 }, { u: 0.6, off: 1.4, n: 5 }, { u: 0.7, off: 0, n: 6 }, { u: 0.86, off: -1.5, n: 6 }, { u: 0.96, off: 0, n: 5 }]
    }
  };
  // aiSpeed is the rivals' top speed in cells/s; pay multiplies the place money
  var WORLDS = [
    { id: 'hills', name: 'Grassy Hills Town', tracks: ['meadow', 'creek', 'windmill'], aiSpeed: 9, pay: 1, skill: [0.93, 0.91, 0.89, 0.87, 0.85] },
    { id: 'desert', name: 'Sunbaked Canyon', tracks: [], aiSpeed: 10, pay: 1.6, skill: [0.95, 0.93, 0.91, 0.89, 0.87] },
    { id: 'ice', name: 'Snowcap Peaks', tracks: [], aiSpeed: 11, pay: 2.4, skill: [0.95, 0.93, 0.91, 0.89, 0.87] },
    { id: 'volcano', name: 'Lava Lane', tracks: [], aiSpeed: 12, pay: 3.4, skill: [0.95, 0.93, 0.91, 0.89, 0.87] },
    { id: 'moon', name: 'Moon Base', tracks: [], aiSpeed: 13, pay: 4.8, skill: [0.95, 0.93, 0.91, 0.89, 0.87] }
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
    samples.push({ x: samples[0].x, z: samples[0].z, s: L, hw: T.hw, tx: samples[0].tx, tz: samples[0].tz, k: samples[0].k }); // closing copy
    var g = { id: id, def: T, L: L, hw: T.hw, samples: samples, n: ns };
    // nearest-sample lookup grid
    var minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9, pad = T.hw + RUNOFF + 14;
    for (i = 0; i < ns; i++) { minX = Math.min(minX, samples[i].x); maxX = Math.max(maxX, samples[i].x); minZ = Math.min(minZ, samples[i].z); maxZ = Math.max(maxZ, samples[i].z); }
    g.x0 = Math.floor(minX - pad); g.z0 = Math.floor(minZ - pad);
    g.w = Math.ceil(maxX + pad) - g.x0; g.h = Math.ceil(maxZ + pad) - g.z0;
    g.near = new Int32Array(g.w * g.h);
    var coarse = [];
    for (i = 0; i < ns; i += 4) coarse.push(i);
    for (var cz = 0; cz < g.h; cz++) for (var cx = 0; cx < g.w; cx++) {
      var wx = g.x0 + cx + 0.5, wz = g.z0 + cz + 0.5, best = 1e18, bi = 0;
      for (j = 0; j < coarse.length; j++) { var sm = samples[coarse[j]], dd = (sm.x - wx) * (sm.x - wx) + (sm.z - wz) * (sm.z - wz); if (dd < best) { best = dd; bi = coarse[j]; } }
      for (j = bi - 4; j <= bi + 4; j++) { var si = (j + ns) % ns, sm2 = samples[si], d2 = (sm2.x - wx) * (sm2.x - wx) + (sm2.z - wz) * (sm2.z - wz); if (d2 < best) { best = d2; bi = si; } }
      g.near[cz * g.w + cx] = bi;
    }
    g.query = function (x, z) { return query(g, x, z); };
    // features
    g.pads = T.pads.map(function (p) { return { s: p.u * L, off: p.off }; });
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
  function query(g, x, z) {
    var cx = Math.floor(x - g.x0), cz = Math.floor(z - g.z0), bi, j, ns = g.n, S = g.samples;
    if (cx >= 0 && cz >= 0 && cx < g.w && cz < g.h) bi = g.near[cz * g.w + cx];
    else { var best = 1e18; for (j = 0; j < ns; j += 2) { var dd = (S[j].x - x) * (S[j].x - x) + (S[j].z - z) * (S[j].z - z); if (dd < best) { best = dd; bi = j; } } }
    var bd = 1e18, bj = bi;
    for (j = bi - 6; j <= bi + 6; j++) { var si = (j + ns) % ns, d2 = (S[si].x - x) * (S[si].x - x) + (S[si].z - z) * (S[si].z - z); if (d2 < bd) { bd = d2; bj = si; } }
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
    return best2;
  }

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
      speed: b.speed * (1 + 0.035 * L('engine')), accel: b.accel * (1 + 0.05 * L('engine')) * (1 + 0.07 * L('turbo')),
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
        x: 0, z: 0, h: 0, v: 0, y: 0, vy: 0, air: false, s: 0, prog: 0, lap: 1, place: c + 1, done: false, finishT: 0,
        boostT: 0, slowT: 0, shieldT: 0, magnetT: 0, drift: 0, driftDir: 0, trick: false, trickT: 0, fallT: 0, onRamp: -1,
        item: null, rollT: 0, itemDelay: 0, coins: 0, inp: {}, prevDrift: false, prevItem: false, pad: -1, bumpT: 0, steerOut: 0, botSteer: 0 };
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
    car.x = p.x; car.z = p.z; car.h = p.h; car.s = wrapS(r.g, s); car.prog = car.s;
    car.air = false; car.y = 0; car.vy = 0; car.onRamp = -1; car.fallT = 0; car.drift = 0; car.driftDir = 0;
  }
  // a press is latched until a fixed step uses it, so a frame too short for a step cannot drop it
  function input(r, inp) { var p = r.cars[0]; p.inp = inp || {}; if (p.inp.item) p.itemQueued = true; }
  function surfaceSpeed(r, car, d) { return Math.abs(d) <= r.g.hw ? 1 : car.stats.grass; }
  function ev(r, type, car, extra) { var e = { type: type, car: car ? car.i : -1 }; if (extra) for (var k in extra) e[k] = extra[k]; r.events.push(e); if (r.events.length > 200) r.events.shift(); }

  function hit(r, car, kind) {
    if (car.shieldT > 0) { car.shieldT = 0; ev(r, 'blocked', car); return false; }
    var base = kind === 'bee' ? 1.6 : 1.2;
    car.slowT = Math.max(car.slowT, base * car.stats.armor);
    car.v *= kind === 'bee' ? 0.55 : 0.7;
    car.drift = 0; car.driftDir = 0; car.boostT = 0;
    ev(r, 'hit', car, { kind: kind });
    return true;
  }
  function useItem(r, car) {
    var it = car.item; if (!it || car.rollT > 0) return;
    car.item = null;
    var fx = Math.cos(car.h), fz = Math.sin(car.h);
    if (it === 'turbo') car.boostT = Math.max(car.boostT, 1.6 * car.stats.boostDur);
    else if (it === 'shield') car.shieldT = 10;
    else if (it === 'magnet') car.magnetT = 8;
    else if (it === 'goo') r.goos.push({ x: car.x - fx * 1.6, z: car.z - fz * 1.6, t: GOO_LIFE, owner: car.i, safe: 0.6 });
    else if (it === 'bee') {
      var ahead = null;
      r.cars.forEach(function (o) { if (o.place === car.place - 1) ahead = o; });
      r.bees.push({ x: car.x + fx, z: car.z + fz, h: car.h, t: BEE_LIFE, owner: car.i, target: ahead ? ahead.i : -1 });
    }
    ev(r, 'item', car, { item: it });
  }

  // the AI and the test bots steer toward a point ahead on their lane; returns an input
  function aimAhead(r, car, look, lane) {
    var p = pointAt(r.g, car.s + look, lane);
    return Math.atan2(p.z - car.z, p.x - car.x);
  }
  function aiInput(r, car) {
    var inp = { aim: aimAhead(r, car, 3 + car.v * 0.35, car.lane) };
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
  // style 'clean' drives the racing line and takes boost pads; 'sloppy' reacts late, wobbles and misses pads
  function botInput(r, car, style) {
    var inp = {}, g = r.g;
    if (style === 'sloppy') {
      var want = angDiff(aimAhead(r, car, 2 + car.v * 0.2, 0), car.h) * 2.5 + Math.sin(r.t * 1.7) * 0.45;
      car.botSteer += (clamp(want, -1, 1) - car.botSteer) * Math.min(1, DT * 6);
      inp.steer = car.botSteer;
    } else {
      var lane = 0;
      for (var i = 0; i < g.pads.length; i++) { var d = dS(g, g.pads[i].s, car.s); if (d > 0 && d < 14) lane = g.pads[i].off; }
      inp.aim = aimAhead(r, car, 3 + car.v * 0.35, lane);
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
    car.boostT = Math.max(0, car.boostT - DT); car.slowT = Math.max(0, car.slowT - DT); car.shieldT = Math.max(0, car.shieldT - DT);
    car.magnetT = Math.max(0, car.magnetT - DT); car.rollT = Math.max(0, car.rollT - DT); car.trickT = Math.max(0, car.trickT - DT); car.bumpT = Math.max(0, car.bumpT - DT);
    if (car.fallT > 0) {
      car.fallT -= DT; car.y -= 3 * DT;
      if (car.fallT <= 0) {
        var m = g.ramps[car.fellAt], back = m.s + m.len + m.gap + 2.5 + (car.i % 3) * 1.2;
        var oldProg = car.prog; place(r, car, back, ((car.i % 3) - 1) * 1.6);
        car.prog = oldProg + dS(g, car.s, wrapS(g, oldProg)); car.v = st.speed * 0.45;
        ev(r, 'putback', car);
      }
      return;
    }
    if (itemPress && !car.air) useItem(r, car);
    else if (itemPress && car.air) useItem(r, car);
    // steering
    var steer = inp.steer || 0;
    if (inp.aim !== undefined && inp.aim !== null) steer = clamp(angDiff(inp.aim, car.h) * 2.5, -1, 1);
    steer = clamp(steer, -1, 1);
    car.steerOut = steer;
    var q = g.query(car.x, car.z);
    var surf = car.air ? 1 : surfaceSpeed(r, car, q.d);
    // drifting and braking
    if (!car.air && drift && Math.abs(steer) >= 0.3 && car.v > DRIFT_MIN_V) {
      if (!car.driftDir) { car.driftDir = steer > 0 ? 1 : -1; car.drift = 0; ev(r, 'drift', car); }
      car.drift += DT;
    } else if (car.driftDir) {
      if (car.drift >= DRIFT_T1) {
        var dur = (car.drift >= DRIFT_T2 ? 1.0 : 0.5) * st.boostDur * (st.perk === 'pads' ? 1.5 : 1);
        car.boostT = Math.max(car.boostT, dur); ev(r, 'boost', car, { from: 'drift', big: car.drift >= DRIFT_T2 });
      }
      car.driftDir = 0; car.drift = 0;
    }
    if (car.air && driftPress && !car.trick) { car.trick = true; car.trickT = 0.45; ev(r, 'trick', car); }
    // speed
    var top = car.ai ? aiTop(r, car) : st.speed;
    var vmax = top * surf * (car.slowT > 0 ? SLOW_MUL : 1) * (car.boostT > 0 ? st.boostMul : 1) * (car.air && st.glide ? 1 + 0.04 * st.glide : 1);
    if (r.phase !== 'race' && !car.done) vmax = 0;
    var acc = st.accel * (car.boostT > 0 ? BOOST_ACC : 1);
    if (!car.air && drift && !car.driftDir && Math.abs(steer) < 0.3) car.v = Math.max(0, car.v - 14 * DT); // brake
    else if (car.v < vmax) car.v = Math.min(vmax, car.v + acc * DT * (1 - 0.4 * car.v / Math.max(1, vmax)));
    else car.v = Math.max(vmax, car.v - (2.5 + (car.v - vmax) * 2) * DT);
    if (car.driftDir) car.v *= 1 - 0.12 * DT;
    // turning
    var rate = st.grip * Math.min(1, car.v / 4) * (car.air ? 0.3 + 0.1 * (st.glide || 0) : 1);
    if (car.driftDir) rate *= 1.35 * (0.6 + 0.4 * Math.max(0, steer * car.driftDir) + 0.4);
    car.h += steer * rate * DT;
    // move
    car.x += Math.cos(car.h) * car.v * DT; car.z += Math.sin(car.h) * car.v * DT;
    q = g.query(car.x, car.z);
    var ds = dS(g, q.s, car.s);
    // ramps: ride up, then launch off the lip
    if (!car.air) {
      var on = -1;
      for (var i = 0; i < g.ramps.length; i++) { var mm = g.ramps[i], into = dS(g, q.s, mm.s); if (into >= 0 && into <= mm.len && Math.abs(q.d) <= g.hw + 0.3) { on = i; car.y = into / mm.len * mm.h; } }
      if (on < 0 && car.onRamp >= 0) {
        var lip = g.ramps[car.onRamp];
        if (dS(g, q.s, lip.s) > lip.len - 0.01) { car.air = true; car.trick = false; car.y = lip.h; car.vy = (2 + 0.38 * car.v) * (st.perk === 'air' ? 1.2 : 1); ev(r, 'jump', car); }
        else car.y = 0;
      }
      car.onRamp = on;
    }
    if (car.air) {
      // the glider opens on the way down and slows the fall
      car.vy -= G * DT * (car.vy < 0 && st.glide ? Math.max(0.25, 1 - 0.22 * st.glide) : 1); car.y += car.vy * DT;
      if (car.y <= 0) {
        car.y = 0; car.air = false; car.vy = 0;
        if (car.trick) { car.boostT = Math.max(car.boostT, 0.9 * st.boostDur * (st.perk === 'air' ? 1.6 : 1)); ev(r, 'boost', car, { from: 'trick' }); }
        else if (st.glide) { car.boostT = Math.max(car.boostT, 0.15 * st.glide * st.boostDur); ev(r, 'boost', car, { from: 'glide' }); } // the wings fold into a little boost
        car.trick = false; ev(r, 'land', car);
      }
    }
    // jump gaps: landing short drops the car in
    if (!car.air && car.onRamp < 0) {
      for (var gi = 0; gi < g.ramps.length; gi++) {
        var gm = g.ramps[gi]; if (!gm.gap) continue;
        var past = dS(g, q.s, gm.s) - gm.len;
        if (past > 0 && past < gm.gap) { car.fallT = FALL_T; car.fellAt = gi; car.v = 0; car.boostT = 0; car.drift = 0; car.driftDir = 0; ev(r, 'splash', car); break; }
      }
    }
    // walls: a gentle bounce back toward the road
    var lim = g.hw + RUNOFF;
    if (Math.abs(q.d) > lim) {
      var sg = q.d > 0 ? 1 : -1, nx = -q.tz * sg, nz = q.tx * sg;
      car.x = q.px + nx * lim; car.z = q.pz + nz * lim;
      var road = Math.atan2(q.tz, q.tx), fwd = Math.cos(car.h - road) >= 0 ? road : road + Math.PI;
      car.h += angDiff(fwd, car.h) * 0.35;
      car.v *= 0.9;
      if (car.bumpT <= 0) { ev(r, 'wall', car); car.bumpT = 0.4; }
      q = g.query(car.x, car.z); ds = dS(g, q.s, car.s);
    }
    car.s = q.s; car.prog += ds; car.d = q.d;
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
      if (bs.t > 0 || car.y > 1.2) continue;
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
        if (cs.t > 0) continue;
        if ((car.x - cn.x) * (car.x - cn.x) + (car.z - cn.z) * (car.z - cn.z) < cr * cr && car.y < 1.5) { cs.t = COIN_RESPAWN; car.coins++; ev(r, 'coin', car, { n: 1, x: cn.x, z: cn.z }); }
      }
    }
  }
  // the rivals' top speed: their skill, slowed in sharp bends, and pulled toward the player (rubber band)
  function aiTop(r, car) {
    var W = WORLDS[r.world], p = r.cars[0], g = r.g;
    var top = W.aiSpeed * car.skill;
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
        if ((c.x - gp.x) * (c.x - gp.x) + (c.z - gp.z) * (c.z - gp.z) < 0.95 * 0.95) { hit(r, c, 'goo'); r.goos.splice(i, 1); break; }
      }
    }
    // bees fly to their target, or along the road when there is none
    for (i = r.bees.length - 1; i >= 0; i--) {
      var b = r.bees[i]; b.t -= DT;
      if (b.t <= 0) { r.bees.splice(i, 1); continue; }
      var tgt = b.target >= 0 ? r.cars[b.target] : null, want;
      if (tgt && !tgt.done) want = Math.atan2(tgt.z - b.z, tgt.x - b.x);
      else { var bq = g.query(b.x, b.z); want = headingAt(g, bq.s + 4); }
      b.h += clamp(angDiff(want, b.h), -BEE_TURN * DT, BEE_TURN * DT);
      b.x += Math.cos(b.h) * BEE_SPEED * DT; b.z += Math.sin(b.h) * BEE_SPEED * DT;
      if (tgt && (tgt.x - b.x) * (tgt.x - b.x) + (tgt.z - b.z) * (tgt.z - b.z) < 1) { hit(r, tgt, 'bee'); r.bees.splice(i, 1); }
    }
    // cars bump each other apart, the lighter one moving more
    for (i = 0; i < r.cars.length; i++) for (j = i + 1; j < r.cars.length; j++) {
      var a = r.cars[i], c2 = r.cars[j];
      if (a.fallT > 0 || c2.fallT > 0 || Math.abs(a.y - c2.y) > 0.6) continue;
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
    if (p.done) {
      // finish the field at its present pace so the result table is complete
      r.cars.forEach(function (c) {
        if (c.done) return;
        c.done = true; c.finishT = r.t + (r.laps * L - c.prog) / Math.max(1, WORLDS[r.world].aiSpeed * c.skill * 0.9);
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
    s.coins += coins;
    for (var i = 0; i < 5; i++) s.parts[i] += parts[i];
    var newBest = !s.bestT[r.id] || p.finishT < s.bestT[r.id];
    record(s, r.id, place, p.finishT);
    var unlocked = [];
    WORLDS[r.world].tracks.forEach(function (t, k) { if (!wasT[k] && trackUnlocked(s, t)) unlocked.push(TRACKS[t].name); });
    WORLDS.forEach(function (w, k) { if (!wasW[k] && worldUnlocked(s, k)) unlocked.push(w.name); });
    Object.keys(CARS).forEach(function (id) { if (!wasC[id] && carUnlocked(s, id)) unlocked.push(CARS[id].name + ' at the car lot'); });
    s.race = null;
    return { place: place, coins: coins, trackCoins: p.coins, parts: parts, time: p.finishT, newBest: newBest, unlocked: unlocked };
  }
  function canAfford(s, cost) {
    if (!cost || s.coins < cost.coins) return false;
    for (var i = 0; i < 5; i++) if (s.parts[i] < cost.parts[i]) return false;
    return true;
  }
  function pay(s, cost) { s.coins -= cost.coins; for (var i = 0; i < 5; i++) s.parts[i] -= cost.parts[i]; }
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
  function newHub() { var p = hubFind('s'); return { x: p.x, z: p.z, face: 0, path: [], moving: false, walk: 0 }; }
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
      looks: looks, best: {}, bestT: {}, races: 0, world: 0, race: null };
  }
  function serialize(s) {
    return JSON.stringify({ v: VERSION, seed: s.seed, coins: s.coins, parts: s.parts, owned: s.owned, car: s.car, cars: s.cars,
      looks: s.looks, best: s.best, bestT: s.bestT, races: s.races, world: s.world });
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
    return s;
  }

  return {
    DT: DT, RUNOFF: RUNOFF, RAMP_LEN: RAMP_LEN, PAD_LEN: PAD_LEN, PAD_W: PAD_W, MAGNET_R: MAGNET_R, ROLL_T: ROLL_T, START_CAR: START_CAR,
    PLACE_PAY: PLACE_PAY, PART_PAY: PART_PAY, PARTS: PARTS, ITEMS: ITEMS, ITEM_KEYS: ITEM_KEYS, UPGRADES: UPGRADES, UP_KEYS: UP_KEYS,
    PERKS: PERKS, CARS: CARS, LOOKS: LOOKS, LOOK_KEYS: LOOK_KEYS, TRACKS: TRACKS, WORLDS: WORLDS, HUB: HUB,
    rng: rng, angDiff: angDiff, clamp: clamp, track: track, pointAt: pointAt, headingAt: headingAt, lookOpt: lookOpt,
    rollItem: rollItem, carStats: carStats, statsFor: statsFor, startRace: startRace, input: input, stepRace: stepRace,
    surfaceSpeed: surfaceSpeed, hit: hit, botInput: botInput, finishRace: finishRace, trackUnlocked: trackUnlocked,
    worldUnlocked: worldUnlocked, canAfford: canAfford, upgradeCost: upgradeCost, buyUpgrade: buyUpgrade, buyCar: buyCar,
    selectCar: selectCar, carUnlocked: carUnlocked, carLockReason: carLockReason, buyLook: buyLook, equip: equip, newState: newState, serialize: serialize, deserialize: deserialize,
    newHub: newHub, hubStep: hubStep, hubWalkTo: hubWalkTo, hubStation: hubStation, hubOpen: hubOpen, hubCell: hubCell,
    _place: place, _record: record, _newCar: newCar
  };
})();
