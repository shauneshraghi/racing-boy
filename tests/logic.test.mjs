// Tests for the pure game logic in js/logic.js. It is a plain browser script that defines the
// global RB, so it runs here in a Node vm context with no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;
assert.ok(R, 'js/logic.js must define the global RB');

const W1 = R.WORLDS[0].tracks;
// drive the player with a bot until the race ends or the time runs out; returns seconds raced
function drive(r, style, maxT = 400) {
  const p = r.cars[0];
  while (!p.done && r.t < maxT) { R.input(r, R.botInput(r, p, style)); R.stepRace(r, 1 / 20); }
  return p.finishT;
}
function freshRace(trackId, seed = 3, carId) {
  const s = R.newState(seed);
  if (carId) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); s.car = carId; }
  return { s, r: R.startRace(s, trackId) };
}

test('world table: five worlds, the first has three tracks of 2 or 3 laps', () => {
  assert.equal(R.WORLDS.length, 5);
  assert.equal(W1.length, 3);
  for (const id of W1) assert.ok([2, 3].includes(R.TRACKS[id].laps), id);
});

test('every track is a closed loop with sane geometry', () => {
  for (const id of W1) {
    const g = R.track(id);
    assert.ok(g.L > 150, id + ' lap length ' + g.L);
    const a = g.samples[0], b = g.samples[g.samples.length - 1];
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1.5, id + ' closes');
    // a point on the centreline maps back to its own arc length with zero offset
    const m = g.samples[Math.floor(g.samples.length / 3)];
    const q = g.query(m.x, m.z);
    assert.ok(Math.abs(q.s - m.s) < 1 && Math.abs(q.d) < 0.3, id + ' query');
  }
});

test('the car accelerates on its own and grass is slower than road', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race'; r.t = 0;
  const p = r.cars[0];
  for (let i = 0; i < 120; i++) { R.input(r, { steer: 0 }); R.stepRace(r, 1 / 60); }
  assert.ok(p.v > 4, 'speed after 2 s ' + p.v);
  const road = R.surfaceSpeed(r, p, 0), grass = R.surfaceSpeed(r, p, r.g.samples[0].hw + 1);
  assert.ok(grass < road * 0.8);
});

test('steer turns the car and aim turns it toward a heading', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0]; p.v = 8; const h0 = p.h;
  for (let i = 0; i < 30; i++) { R.input(r, { steer: 1 }); R.stepRace(r, 1 / 60); }
  assert.ok(p.h > h0 + 0.3, 'steer right raises heading');
  const target = p.h - 1.2;
  for (let i = 0; i < 90; i++) { R.input(r, { aim: target }); R.stepRace(r, 1 / 60); }
  assert.ok(Math.abs(R.angDiff(target, p.h)) < 0.15, 'aim reached');
});

test('a boost pad raises speed above top speed', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0], top = R.carStats(r.s, p.carId).speed;
  const pad = r.g.pads[0];
  R._place(r, p, pad.s - 1, pad.off); p.v = top;
  for (let i = 0; i < 20; i++) { R.input(r, { steer: 0, aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60); }
  assert.ok(p.boostT > 0, 'boosting');
  for (let i = 0; i < 20; i++) { R.input(r, { aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60); }
  assert.ok(p.v > top * 1.1, 'speed ' + p.v + ' top ' + top);
});

test('a ramp launches the car; a trick in the air boosts on landing', () => {
  const id = W1.find(t => R.track(t).ramps.length);
  const { r } = freshRace(id);
  r.phase = 'race';
  const p = r.cars[0], ramp = r.g.ramps[0];
  R._place(r, p, ramp.s - 3, 0); p.v = R.carStats(r.s, p.carId).speed;
  let air = false, tricked = false, landed = false;
  for (let i = 0; i < 240 && !landed; i++) {
    const inp = { aim: R.headingAt(r.g, p.s) };
    if (p.air && !tricked) { inp.drift = true; tricked = true; }
    R.input(r, inp); R.stepRace(r, 1 / 60);
    if (p.air) air = true; else if (air) landed = true;
  }
  assert.ok(air, 'went airborne'); assert.ok(landed, 'landed');
  assert.ok(p.boostT > 0, 'trick boost on landing');
});

test('falling short into a jump gap puts the car back on the road past it', () => {
  const g = W1.map(R.track).find(t => t.ramps.some(m => m.gap > 0));
  assert.ok(g, 'some world-1 track has a gap jump');
  const id = W1.find(t => R.track(t) === g);
  const { r } = freshRace(id);
  r.phase = 'race';
  const p = r.cars[0], ramp = r.g.ramps.find(m => m.gap > 0);
  R._place(r, p, ramp.s - 0.5, 0); p.v = 3;
  let fell = false;
  for (let i = 0; i < 300; i++) { R.input(r, { aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60); if (p.fallT > 0) fell = true; }
  assert.ok(fell, 'fell in');
  const ahead = ((p.s - ramp.s) % r.g.L + r.g.L) % r.g.L;
  assert.ok(ahead > ramp.len + ramp.gap && ahead < 40, 'put back past the gap, s ahead ' + ahead);
});

test('walls keep cars near the road', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0]; p.v = 10;
  p.h += Math.PI / 2; // drive straight off the side
  for (let i = 0; i < 180; i++) { R.input(r, { steer: 0 }); R.stepRace(r, 1 / 60); }
  const q = r.g.query(p.x, p.z);
  assert.ok(Math.abs(q.d) <= q.hw + R.RUNOFF + 0.6, 'offset ' + q.d);
});

test('drifting charges and releases a mini-boost', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0], x0 = p.x, z0 = p.z;
  for (let i = 0; i < 90; i++) { p.x = x0; p.z = z0; p.v = 10; R.input(r, { steer: 1, drift: true }); R.stepRace(r, 1 / 60); }
  assert.ok(p.drift > 0.6, 'charge ' + p.drift);
  R.input(r, { steer: 0, drift: false }); R.stepRace(r, 1 / 60);
  assert.ok(p.boostT > 0);
});

test('a race has six racers and a countdown, then finishes with every car placed', () => {
  const { r } = freshRace(W1[0]);
  assert.equal(r.cars.length, 6);
  assert.equal(r.phase, 'count');
  R.stepRace(r, 1);
  assert.equal(r.cars[0].v, 0, 'no moving in the countdown');
  drive(r, 'clean');
  assert.ok(r.cars[0].done);
  assert.equal(new Set(r.cars.map(c => c.place)).size, 6);
});

test('stock-car races take 2-3 minutes on every world-1 track', () => {
  for (const id of W1) {
    const { r } = freshRace(id, 11);
    const t = drive(r, 'clean');
    console.log(`  ${id}: ${t.toFixed(1)} s, place ${r.cars[0].place}`);
    assert.ok(t >= 120 && t <= 180, id + ' took ' + t);
  }
});

test('a clean drive in the stock car wins world 1; a sloppy one still can', () => {
  for (const id of W1) {
    let wins = 0, sloppyWins = 0;
    for (const seed of [1, 2, 3, 4]) {
      const a = freshRace(id, seed); drive(a.r, 'clean'); if (a.r.cars[0].place === 1) wins++;
      const b = freshRace(id, seed); drive(b.r, 'sloppy'); if (b.r.cars[0].place === 1) sloppyWins++;
    }
    console.log(`  ${id}: clean wins ${wins}/4, sloppy wins ${sloppyWins}/4`);
    assert.ok(wins >= 4, id + ' clean wins ' + wins);
    assert.ok(sloppyWins >= 1, id + ' sloppy wins ' + sloppyWins);
  }
});

test('the AI is not a walkover: rivals stay close to a clean driver', () => {
  const { r } = freshRace(W1[0], 5);
  drive(r, 'clean');
  const second = r.cars.find(c => c.place === 2);
  assert.ok(second.finishT - r.cars[0].finishT < 20, 'gap ' + (second.finishT - r.cars[0].finishT));
});

test('item boxes are rare, respawn and give one held item', () => {
  for (const id of W1) { const n = R.track(id).boxes.length; assert.ok(n >= 3 && n <= 8, id + ' boxes ' + n); }
  const { r } = freshRace(W1[0]);
  r.phase = 'race'; r.cars.length = 1; // rivals would take the boxes too
  const p = r.cars[0], b = r.g.boxes[0];
  R._place(r, p, b.s - 1.5, b.off); p.v = 8;
  for (let i = 0; i < 30; i++) { R.input(r, { aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60); }
  assert.ok(p.item, 'got an item');
  assert.ok(r.boxes[0].t > 0, 'box is gone for a while');
  const held = p.item;
  const b2 = r.g.boxes[1]; R._place(r, p, b2.s - 1.5, b2.off);
  for (let i = 0; i < 30; i++) { R.input(r, { aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60); }
  assert.equal(p.item, held, 'one item at a time');
  R._place(r, p, b.s + r.g.L / 2, 0); R.input(r, { steer: 0 });
  for (let i = 0; i < 60 * 10.2; i++) R.stepRace(r, 1 / 60);
  assert.equal(r.boxes[0].t, 0, 'box respawned');
});

test('item odds favour the back of the pack; the homing item is rare', () => {
  const rng = R.rng(4); const front = {}, back = {};
  for (let i = 0; i < 4000; i++) { const a = R.rollItem(rng, 1, 6, false), b = R.rollItem(rng, 6, 6, false); front[a] = (front[a] || 0) + 1; back[b] = (back[b] || 0) + 1; }
  assert.ok(!front.bee, 'leader never gets the homing bee');
  assert.ok((back.bee || 0) / 4000 < 0.2 && back.bee > 0);
  assert.ok((back.turbo || 0) > (front.turbo || 0));
});

test('items: turbo boosts, goo slows, a shield blocks one hit, the bee hits the car ahead', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const [p, a] = r.cars;
  p.item = 'turbo'; R.input(r, { item: true }); R.stepRace(r, 1 / 60);
  assert.ok(p.boostT > 0 && !p.item);
  R.hit(r, a, 'goo'); assert.ok(a.slowT > 0);
  a.slowT = 0; a.shieldT = 5; R.hit(r, a, 'goo'); assert.equal(a.slowT, 0); assert.equal(a.shieldT, 0);
  // the bee: put a rival just ahead and fire
  R._place(r, p, 20, 0); R._place(r, a, 30, 0); p.v = a.v = 0;
  for (const c of r.cars.slice(2)) R._place(r, c, 100, 0);
  R.input(r, {}); R.stepRace(r, 1 / 60);
  p.item = 'bee'; R.input(r, { item: true });
  for (let i = 0; i < 240 && !a.slowT; i++) { R.stepRace(r, 1 / 60); R.input(r, {}); }
  assert.ok(a.slowT > 0, 'bee hit the car ahead');
});

test('armor shortens slowdowns', () => {
  const { s, r } = freshRace(W1[0]);
  const p = r.cars[0];
  R.hit(r, p, 'goo'); const t0 = p.slowT;
  s.cars[s.car].up.armor = 3; p.stats = R.carStats(s, p.carId); p.slowT = 0;
  R.hit(r, p, 'goo'); assert.ok(p.slowT < t0 * 0.8);
});

test('coins on the track are picked up and paid with the place money', () => {
  const { s, r } = freshRace(W1[0], 2);
  const before = s.coins;
  drive(r, 'clean');
  assert.ok(r.cars[0].coins > 0, 'picked coins');
  const res = R.finishRace(s, r);
  assert.equal(s.coins, before + res.coins);
  assert.ok(res.coins >= R.PLACE_PAY[0] + r.cars[0].coins - 1);
  assert.ok(res.parts[0] > 0, 'world 1 pays bolts');
});

test('only a win unlocks the next track; winning all three opens world 2', () => {
  const s = R.newState(1);
  assert.ok(R.trackUnlocked(s, W1[0])); assert.ok(!R.trackUnlocked(s, W1[1]));
  R._record(s, W1[0], 2, 150); assert.ok(!R.trackUnlocked(s, W1[1]));
  R._record(s, W1[0], 1, 140); assert.ok(R.trackUnlocked(s, W1[1]));
  assert.ok(!R.worldUnlocked(s, 1));
  R._record(s, W1[1], 1, 140); R._record(s, W1[2], 1, 140);
  assert.ok(R.worldUnlocked(s, 1));
  assert.equal(s.best[W1[0]], 1, 'best place kept');
});

test('cars: five starter cars plus faster ones to unlock, one owned at start, buy with coins and parts', () => {
  const ids = Object.keys(R.CARS);
  assert.equal(ids.filter(i => !R.CARS[i].unlock).length, 5);
  assert.ok(ids.length >= 7);
  const perks = new Set(ids.map(id => R.CARS[id].perk));
  assert.ok(perks.size >= 4);
  const s = R.newState(1);
  assert.deepEqual([...s.owned], [R.START_CAR]);
  const id = ids.find(i => i !== R.START_CAR);
  assert.ok(!R.buyCar(s, id), 'cannot afford');
  const c = R.CARS[id].cost; s.coins = c.coins; s.parts = c.parts.slice();
  assert.ok(R.buyCar(s, id));
  assert.ok(s.owned.includes(id)); assert.equal(s.coins, 0);
  assert.ok(R.selectCar(s, id)); assert.equal(s.car, id);
});

test('upgrades: per car, cost rises, capped per car, change stats', () => {
  const s = R.newState(1); s.coins = 1e9; s.parts = [1e6, 1e6, 1e6, 1e6, 1e6];
  const id = s.car, base = R.carStats(s, id);
  const c0 = R.upgradeCost(s, id, 'engine'); assert.ok(R.buyUpgrade(s, id, 'engine'));
  const c1 = R.upgradeCost(s, id, 'engine'); assert.ok(c1.coins > c0.coins);
  assert.ok(R.carStats(s, id).speed > base.speed);
  for (let i = 0; i < 50; i++) R.buyUpgrade(s, id, 'engine');
  assert.equal(s.cars[id].up.engine, R.CARS[id].caps.engine);
  assert.equal(R.upgradeCost(s, id, 'engine'), null);
  assert.ok(R.buyUpgrade(s, id, 'tires')); assert.ok(R.carStats(s, id).grip > base.grip);
  // a second car keeps its own levels
  const other = Object.keys(R.CARS).find(i => i !== id); s.owned.push(other); s.cars[other] = R._newCar(other);
  assert.equal(s.cars[other].up.engine, 0);
});

test('higher upgrade levels need higher-tier parts', () => {
  const s = R.newState(1);
  const lo = R.upgradeCost(s, s.car, 'engine');
  assert.equal(lo.parts.slice(1).reduce((a, b) => a + b, 0), 0, 'level 1 is bolts only');
  s.cars[s.car].up.engine = 3;
  assert.ok(R.upgradeCost(s, s.car, 'engine').parts[1] > 0, 'level 4 needs gears');
});

test('customisation: buy a cosmetic once, equip it per car', () => {
  const s = R.newState(1); s.coins = 10000;
  const slots = Object.keys(R.LOOKS);
  for (const k of ['paint', 'trim', 'wheels', 'spoiler', 'exhaust', 'horn', 'trail']) assert.ok(slots.includes(k), k);
  const opt = R.LOOKS.wheels[2].id;
  assert.ok(!R.equip(s, s.car, 'wheels', opt), 'not owned yet');
  assert.ok(R.buyLook(s, 'wheels', opt));
  assert.ok(R.equip(s, s.car, 'wheels', opt));
  assert.equal(s.cars[s.car].look.wheels, opt);
});

test('save round trip', () => {
  const s = R.newState(7); s.coins = 123; R._record(s, W1[0], 1, 130.5);
  s.cars[s.car].up.boost = 2;
  const t = R.deserialize(R.serialize(s));
  assert.equal(t.coins, 123); assert.equal(t.best[W1[0]], 1); assert.equal(t.cars[t.car].up.boost, 2);
  assert.equal(R.deserialize('nonsense'), null);
});

test('races are deterministic for a seed', () => {
  const a = freshRace(W1[1], 9), b = freshRace(W1[1], 9);
  drive(a.r, 'clean'); drive(b.r, 'clean');
  assert.deepEqual(a.r.cars.map(c => c.finishT), b.r.cars.map(c => c.finishT));
});

test('every car can finish every world-1 track', () => {
  for (const carId of Object.keys(R.CARS)) {
    const { r } = freshRace(W1[2], 3, carId === R.START_CAR ? null : carId);
    const t = drive(r, 'clean');
    assert.ok(r.cars[0].done && t < 220, carId + ' ' + t);
  }
});

test('an item press is kept until a logic step uses it, even on a short frame', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0]; p.item = 'turbo';
  R.input(r, { item: true }); R.stepRace(r, 1 / 240); // too short for a fixed step
  R.input(r, {}); R.stepRace(r, 1 / 60);
  assert.equal(p.item, null, 'item used');
  assert.ok(p.boostT > 0);
});

test('lap counter: lap 1 after the start line, then one lap event per lap crossed', () => {
  const { r } = freshRace('meadow');
  const p = r.cars[0], laps = [];
  while (!p.done && r.t < 400) {
    R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20);
    r.events.forEach(e => { if (e.type === 'lap' && e.car === 0) laps.push(e.lap); }); r.events.length = 0;
    if (r.t > 2 && r.t < 3) assert.equal(p.lap, 1, 'still on lap 1 just after the start');
  }
  assert.deepEqual(laps, [2, 3]);
});

test('faster cars unlock by winning races, cost only bolts and gears, and are faster than every starter', () => {
  const starters = Object.keys(R.CARS).filter(i => !R.CARS[i].unlock), locked = Object.keys(R.CARS).filter(i => R.CARS[i].unlock);
  const top = Math.max(...starters.map(i => R.CARS[i].base.speed));
  for (const id of locked) {
    const K = R.CARS[id];
    assert.ok(K.base.speed > top, id + ' is faster');
    assert.deepEqual([...K.cost.parts.slice(2)], [0, 0, 0], id + ' costs only bolts and gears');
    for (const k of R.UP_KEYS) assert.ok(K.caps[k] >= 0, id + ' cap ' + k);
    const s = R.newState(1); s.coins = 1e9; s.parts = [1e6, 1e6, 1e6, 1e6, 1e6];
    assert.ok(!R.carUnlocked(s, id)); assert.ok(R.carLockReason(s, id)); assert.ok(!R.buyCar(s, id), 'locked');
    for (const t of R.WORLDS[0].tracks) s.best[t] = 1;
    assert.ok(R.carUnlocked(s, id)); assert.ok(R.buyCar(s, id));
  }
  for (const id of starters) assert.ok(R.carUnlocked(R.newState(1), id));
  // the fastest car opens last
  const s = R.newState(1); s.best[R.WORLDS[0].tracks[0]] = 1; s.best[R.WORLDS[0].tracks[1]] = 1;
  assert.ok(locked.some(id => R.carUnlocked(s, id)) && locked.some(id => !R.carUnlocked(s, id)));
});

test('rivals only drive starter cars', () => {
  for (let seed = 1; seed < 30; seed++) { const s = R.newState(seed); s.races = seed; const r = R.startRace(s, 'meadow'); for (const c of r.cars.slice(1)) assert.ok(!R.CARS[c.carId].unlock, c.carId); }
});

test('every car has a cap for every upgrade, and a new car starts at level 0 on all of them', () => {
  assert.ok(R.UP_KEYS.includes('turbo') && R.UP_KEYS.includes('glider'));
  for (const id of Object.keys(R.CARS)) { const c = R._newCar(id); for (const k of R.UP_KEYS) { assert.equal(c.up[k], 0); assert.ok(R.CARS[id].caps[k] > 0, id + ' ' + k); } }
});

test('turbo upgrade: faster pick-up and a boost off the start line', () => {
  const s = R.newState(1); s.coins = 1e9; s.parts = [1e6, 1e6, 1e6, 1e6, 1e6];
  const id = s.car, base = R.carStats(s, id);
  for (let i = 0; i < 3; i++) assert.ok(R.buyUpgrade(s, id, 'turbo'));
  const up = R.carStats(s, id);
  assert.ok(up.accel > base.accel); assert.equal(up.speed, base.speed);
  assert.ok(up.launch > 0 && base.launch === 0);
  const r = R.startRace(s, 'meadow');
  while (r.phase === 'count') { R.input(r, {}); R.stepRace(r, 1 / 60); }
  R.input(r, {}); R.stepRace(r, 1 / 60);
  assert.ok(r.cars[0].boostT > 0, 'launch boost at GO');
});

// seconds in the air off the first ramp of a track, driving straight
function airTime(level) {
  const s = R.newState(1); s.cars[s.car].up.glider = level;
  const r = R.startRace(s, 'meadow', { noAI: true }), p = r.cars[0], m = r.g.ramps[0];
  R._place(r, p, m.s - 6, 0); r.phase = 'race'; r.cd = 0; p.v = p.stats.speed;
  let t = 0, flying = false;
  for (let i = 0; i < 600; i++) {
    R.input(r, { aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60);
    if (p.air) { flying = true; t += 1 / 60; } else if (flying) break;
  }
  return t;
}
test('glider upgrade: longer air time off ramps, none at level 0', () => {
  const t0 = airTime(0), t3 = airTime(3);
  assert.ok(t0 > 0.2, 'jumps at level 0: ' + t0);
  assert.ok(t3 > t0 * 1.3, 'glider stays up longer: ' + t0 + ' vs ' + t3);
  assert.equal(R.statsFor(R.START_CAR).glide, 0);
});

test('old saves without the new upgrades load at level 0', () => {
  const s = R.newState(1); const raw = JSON.parse(R.serialize(s));
  for (const id in raw.cars) { delete raw.cars[id].up.turbo; delete raw.cars[id].up.glider; }
  const back = R.deserialize(JSON.stringify(raw));
  assert.equal(back.cars[back.car].up.turbo, 0); assert.equal(back.cars[back.car].up.glider, 0);
});

test('glider pays off: a clean drive with wings beats the same drive without', () => {
  for (const t of ['creek', 'windmill']) {
    const time = lv => { const s = R.newState(3); s.cars[s.car].up.glider = lv; const r = R.startRace(s, t, { noAI: true }), p = r.cars[0];
      while (!p.done && r.t < 400) { R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20); } return p.finishT; };
    assert.ok(time(4) < time(0) - 0.5, t);
  }
});

test('a win that opens a faster car says so', () => {
  const s = R.newState(1); s.best.meadow = 1;
  const r = R.startRace(s, 'creek'); r.cars[0].place = 1; r.cars[0].finishT = 100;
  const res = R.finishRace(s, r);
  assert.ok(res.unlocked.some(u => u.includes(R.CARS.bolt.name)), JSON.stringify(res.unlocked));
});

test('pressing drift on the ground hops at once; the drift starts on landing in the direction steered', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0]; p.v = 10;
  R.input(r, { steer: 0, drift: true }); R.stepRace(r, 1 / 60);
  assert.ok(p.hopT > 0, 'hop started'); assert.equal(p.driftDir, 0, 'no drift in the hop');
  let top = 0;
  // steer left during the hop: the drift goes left once the wheels are down
  while (p.hopT > 0) { R.input(r, { steer: -1, drift: true }); R.stepRace(r, 1 / 60); top = Math.max(top, p.hopY); assert.equal(p.driftDir, 0); }
  assert.ok(top > 0.1, 'hop height ' + top);
  assert.equal(p.hopY, 0);
  R.input(r, { steer: -1, drift: true }); R.stepRace(r, 1 / 60);
  assert.equal(p.driftDir, -1);
  // holding drift does not hop again
  for (let i = 0; i < 30; i++) { R.input(r, { steer: -1, drift: true }); R.stepRace(r, 1 / 60); assert.equal(p.hopT, 0); }
});

test('the drift button never brakes: a hop without steering is only a hop', () => {
  const a = freshRace(W1[0]).r, b = freshRace(W1[0]).r;
  a.phase = b.phase = 'race'; a.cars[0].v = b.cars[0].v = 6;
  for (let i = 0; i < 40; i++) {
    R.input(a, { steer: 0, drift: true }); R.stepRace(a, 1 / 60);
    R.input(b, { steer: 0 }); R.stepRace(b, 1 / 60);
    assert.equal(a.cars[0].driftDir, 0);
  }
  assert.ok(Math.abs(a.cars[0].v - b.cars[0].v) < 1e-9, a.cars[0].v + ' vs ' + b.cars[0].v);
});

test('a drift keeps its direction while held and turns no harder than plain driving', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0]; p.v = 10;
  const x0 = p.x, z0 = p.z, keep = () => { p.x = x0; p.z = z0; p.v = 10; }; // stay on the grid, clear of the walls
  let n = 0;
  while (!p.driftDir && n < 120) { keep(); R.input(r, { steer: 1, drift: true }); R.stepRace(r, 1 / 60); n++; }
  assert.equal(p.driftDir, 1);
  // counter-steering widens the drift but does not turn the car the other way or end the drift
  for (let i = 0; i < 30; i++) {
    const h0 = p.h; keep();
    R.input(r, { steer: -1, drift: true }); R.stepRace(r, 1 / 60);
    assert.equal(p.driftDir, 1); assert.ok(p.h - h0 >= 0, 'turned against the drift');
  }
  // letting go of the stick keeps the drift going
  for (let i = 0; i < 10; i++) { keep(); R.input(r, { steer: 0, drift: true }); R.stepRace(r, 1 / 60); assert.equal(p.driftDir, 1); }
  // steering into the drift turns at most a little faster than full lock on the ground
  const h0 = p.h; keep();
  R.input(r, { steer: 1, drift: true }); R.stepRace(r, 1 / 60);
  const rate = (p.h - h0) * 60;
  assert.ok(rate <= p.stats.grip * 1.2, 'drift turn rate ' + rate + ' vs grip ' + p.stats.grip);
});

// start a right-hand drift on the start straight; keep() holds the car in place at a fixed speed, clear of the walls.
// The rivals are left out so no bump moves the car.
function startDrift() {
  const { r } = freshRace(W1[0]);
  r.phase = 'race'; r.cars.length = 1;
  const p = r.cars[0], x0 = p.x, z0 = p.z, keep = () => { p.x = x0; p.z = z0; p.v = 10; };
  for (let n = 0; !p.driftDir && n < 120; n++) { keep(); R.input(r, { steer: 1, drift: true }); R.stepRace(r, 1 / 60); }
  assert.equal(p.driftDir, 1);
  return { r, p, keep, x0, z0 };
}

test('steering into a drift charges the boost faster than steering out of it', () => {
  const charge = steer => {
    const { r, p, keep } = startDrift();
    const c0 = p.drift;
    for (let i = 0; i < 40; i++) { keep(); R.input(r, { steer, drift: true }); R.stepRace(r, 1 / 60); }
    return p.drift - c0;
  };
  const tight = charge(1), wide = charge(-1);
  assert.ok(tight > wide * 1.4, 'tight ' + tight + ' wide ' + wide);
});

test('a drift boost has three tiers, each longer than the last', () => {
  assert.equal(R.DRIFT_TIERS.length, 3);
  const boosts = R.DRIFT_TIERS.map(t => {
    const { r, p, keep } = startDrift();
    const evs = [];
    while (p.drift < t + 0.05) { keep(); R.input(r, { steer: 1, drift: true }); R.stepRace(r, 1 / 60); }
    r.events.length = 0;
    R.input(r, { steer: 0, drift: false }); R.stepRace(r, 1 / 60);
    const e = r.events.find(x => x.type === 'boost' && x.from === 'drift');
    assert.ok(e, 'boost event at ' + t);
    return { boostT: p.boostT, tier: e.tier };
  });
  assert.equal(boosts.map(b => b.tier).join(), '1,2,3');
  assert.ok(boosts[0].boostT < boosts[1].boostT && boosts[1].boostT < boosts[2].boostT, JSON.stringify(boosts));
});

test('a drift slides the car outward', () => {
  const { r, p, keep, x0, z0 } = startDrift();
  for (let i = 0; i < 20; i++) { keep(); R.input(r, { steer: 0, drift: true }); R.stepRace(r, 1 / 60); }
  keep(); const h0 = p.h;
  R.input(r, { steer: 0, drift: true }); R.stepRace(r, 1 / 60);
  // + is the driver's right, the inside of a right-hand drift
  const side = (p.x - x0) * -Math.sin(h0) + (p.z - z0) * Math.cos(h0);
  assert.ok(side < -0.005, 'sideways ' + side);
});

test('on/off steering (keys and buttons) eases in to full lock instead of snapping', () => {
  const { r } = freshRace(W1[0]);
  r.phase = 'race';
  const p = r.cars[0]; p.v = 8;
  R.input(r, { steer: 1, ease: true }); R.stepRace(r, 1 / 60);
  assert.ok(p.steerOut > 0 && p.steerOut < 0.5, 'first step ' + p.steerOut);
  for (let i = 0; i < 11; i++) { R.input(r, { steer: 1, ease: true }); R.stepRace(r, 1 / 60); }
  assert.equal(p.steerOut, 1);
  // the stick and the bots steer directly
  R.input(r, { steer: -0.6 }); R.stepRace(r, 1 / 60);
  assert.equal(p.steerOut, -0.6);
});
