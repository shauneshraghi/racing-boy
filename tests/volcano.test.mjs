// Tests for world 4, Lava Lane: its tracks and their big hills, the lava hazards, the harsher ash off-road, the
// difficulty ramp, the entry gate (how much upgrading a volcano win takes), and that every car can get round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;
const W4 = R.WORLDS[3];
const IDS = ['cinder', 'basalt', 'caldera'];

// The entry gate: Pip with every upgrade at level 5 (capped by the car; levels 4-6 are bought with gears) should win
// a clean drive on every volcano track, a fully geared level 6 wins them all, and level 3 does not win easily.
const GATE_LEVEL = 5;
function gateState(seed, level = GATE_LEVEL) {
  const s = R.newState(seed);
  for (const k of R.UP_KEYS) s.cars[R.START_CAR].up[k] = Math.min(level, R.CARS[R.START_CAR].caps[k]);
  return s;
}
// race the bot to the end; records the player's place, time, the gap to the next finisher, any jump in progress,
// how high the car flew and how many times it was put back
const cache = new Map();
function raceResult(trackId, seed, level, style) {
  const key = [trackId, seed, level, style].join();
  if (cache.has(key)) return cache.get(key);
  const s = gateState(seed, level), r = R.startRace(s, trackId), p = r.cars[0];
  let last = null, maxStep = 0, putbacks = 0, maxAir = 0;
  while (!p.done && r.t < 400) {
    R.input(r, R.botInput(r, p, style)); R.stepRace(r, 1 / 20);
    if (r.events.some(e => e.type === 'putback' && e.car === 0)) putbacks++;
    else if (last !== null && r.phase === 'race') maxStep = Math.max(maxStep, Math.abs(p.prog - last));
    r.events.length = 0; last = p.prog; maxAir = Math.max(maxAir, p.y);
  }
  const other = r.cars.find(c => c.place === (p.place === 1 ? 2 : 1));
  const out = { place: p.place, t: p.finishT, margin: other.finishT - p.finishT, maxStep, putbacks, maxAir };
  cache.set(key, out);
  return out;
}
const SEEDS = [1, 2, 3, 4];
const peak = id => Math.max(...R.track(id).samples.map(s => s.y));

test('world 4 is Lava Lane with cinder, basalt and caldera; caldera is the longest', () => {
  assert.equal(W4.id, 'volcano'); assert.equal(W4.name, 'Lava Lane');
  assert.deepEqual([...W4.tracks], IDS);
  for (const id of IDS) { assert.equal(R.TRACKS[id].world, 3, id); assert.ok([2, 3].includes(R.TRACKS[id].laps), id); }
  const L = id => R.track(id).L;
  assert.ok(L('caldera') > L('cinder') && L('caldera') > L('basalt'));
  assert.equal(R.TRACKS.caldera.laps, 2);
  for (const id of IDS) assert.ok(R.track(id).ramps.some(m => m.gap > 0), id + ' jumps a lava river');
});

test('volcano tracks climb far higher than worlds 1 and 2, within what the slope physics allow', () => {
  const lower = Math.max(...R.WORLDS[0].tracks.concat(R.WORLDS[1].tracks).map(peak));
  for (const id of IDS) {
    const g = R.track(id), h = peak(id);
    assert.ok(h >= 10 && h <= 16, `${id} peak ${h}`);
    assert.ok(h >= 2 * lower, `${id} peak ${h} vs ${lower} in worlds 1-2`);
    // the steepest climb stays near where the climb slowdown bottoms out (slope 0.5); plunges may be steeper
    const steep = Math.max(...g.samples.map(s => s.gy));
    assert.ok(steep <= 0.6, `${id} climbs at ${steep.toFixed(2)}`);
  }
  // the heights ramp through the world
  assert.ok(peak('cinder') < peak('caldera') && peak('basalt') <= peak('caldera'));
});

test('volcano: every gap is on level ground and its landing is not on a crest', () => {
  for (const id of IDS) {
    const g = R.track(id);
    g.ramps.forEach((m, i) => {
      for (let s = m.s - 4; s < m.s + m.len + m.gap + 4; s += 0.5) assert.ok(Math.abs(R.slopeAt(g, s)) < 0.02, `${id} ramp ${i} slope at ${s}`);
    });
  }
});

test('volcano gap jumps clear at the stock car speed and at a slowed rival speed', () => {
  for (const id of IDS) {
    const g = R.track(id);
    // the slowest a rival goes on a straight: the lowest skill, held back the most by the rubber band
    const rivalLow = W4.aiSpeed * (R.TRACKS[id].ai || 1) * R.PACE * Math.min(...W4.skill) * 0.75;
    const stock = R.statsFor(R.START_CAR).speed;
    g.ramps.forEach((m, i) => {
      if (!m.gap) return;
      for (const v of [stock, rivalLow]) {
        const s = R.newState(1), r = R.startRace(s, id, { noAI: true }), p = r.cars[0];
        r.phase = 'race'; p.stats.speed = v; R._place(r, p, m.s - 8, 0); p.v = v;
        let splash = false, flew = false;
        for (let k = 0; k < 240; k++) {
          R.input(r, { aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60);
          if (r.events.some(e => e.type === 'splash')) splash = true;
          r.events.length = 0;
          if (p.air) flew = true;
        }
        assert.ok(flew && !splash, `${id} ramp ${i} at ${v.toFixed(2)} c/s`);
      }
    });
  }
});

test('volcano: the rim plunges launch the gate car into big air', () => {
  for (const id of IDS) {
    const x = raceResult(id, 1, GATE_LEVEL, 'clean');
    assert.ok(x.maxAir > 3, `${id} flew ${x.maxAir.toFixed(1)} cells high`);
  }
});

test('ash off the road is harsher than grass, and the rivals ramp up through the world', () => {
  assert.ok(W4.rough < 1 && W4.rough >= 0.75, 'rough ' + W4.rough);
  const s = R.newState(1), r = R.startRace(s, 'cinder'), p = r.cars[0];
  assert.ok(R.surfaceSpeed(r, p, r.g.hw + 1) < p.stats.grass - 0.05);
  const ai = IDS.map(id => R.TRACKS[id].ai || 1);
  assert.ok(ai[0] < ai[1] && ai[1] < ai[2], 'track ai ' + ai);
  // a step up from the desert, and from Snowcap Peaks
  for (const w of [1, 2]) assert.ok(W4.aiSpeed * ai[0] > R.WORLDS[w].aiSpeed * Math.max(...R.WORLDS[w].tracks.map(t => R.TRACKS[t].ai || 1)) - 1e-9 || W4.aiSpeed > R.WORLDS[w].aiSpeed, 'world ' + w);
  assert.ok(W4.skill.every((k, i) => k >= R.WORLDS[1].skill[i]), 'skill');
});

test('lava hazards: vents puff in place, bombs bounce high, magma boulders roll across', () => {
  for (const k of ['vent', 'bomb', 'magma']) assert.ok(R.HAZ[k], k);
  const used = new Set(IDS.flatMap(id => (R.TRACKS[id].hazards || []).map(h => h.kind)));
  for (const k of ['vent', 'bomb', 'magma']) assert.ok(used.has(k), k + ' is on a volcano track');
  const id = IDS.find(t => R.TRACKS[t].hazards.some(h => h.kind === 'vent'));
  const s = R.newState(3), r = R.startRace(s, id), g = r.g;
  const vi = g.hazards.findIndex(h => h.kind === 'vent'), bi = g.hazards.findIndex(h => h.kind === 'bomb');
  let on = 0, off = 0, ds = new Set();
  for (let t = 0; t < 12; t += 0.05) { r.t = t; const h = R.hazardAt(r, vi); ds.add(h.d.toFixed(3)); if (h.on) on++; else off++; assert.ok(h.puff >= 0 && h.puff <= 1); }
  assert.equal(ds.size, 1, 'a vent stays put');
  assert.ok(on > 0.25 * (on + off) && off > 0.4 * (on + off), `vent on ${on} off ${off}`);
  if (bi >= 0) { let top = 0; for (let t = 0; t < 10; t += 0.05) { r.t = t; top = Math.max(top, R.hazardAt(r, bi).y); } assert.ok(top > R.HAZ.bomb.h, 'bomb bounces over a car: ' + top); }
});

test('a resting vent lets a car through; a puffing one slows it a little', () => {
  const id = IDS.find(t => R.TRACKS[t].hazards.some(h => h.kind === 'vent'));
  for (const puffing of [false, true]) {
    const s = R.newState(3), r = R.startRace(s, id), g = r.g;
    r.phase = 'race'; r.cars.length = 1;
    const p = r.cars[0], vi = g.hazards.findIndex(h => h.kind === 'vent');
    let t = 0; while ((R.hazardAt(r, vi, t).on) !== puffing || R.hazardAt(r, vi, t + 0.2).on !== puffing) t += 0.02;
    r.t = t; const h = R.hazardAt(r, vi);
    R._place(r, p, h.s - 0.4, h.d); p.v = p.stats.speed; r.events.length = 0;
    R.input(r, {}); R.stepRace(r, 1 / 60);
    const hit = r.events.some(e => e.type === 'hit' && e.kind === 'hazard');
    assert.equal(hit, puffing, 'puffing ' + puffing);
    if (hit) assert.ok(p.slowT <= 1 && p.slowT > 0, 'a short slow ' + p.slowT);
  }
});

test('world 4 pays chips, and a win pays crystals, both real part tiers', () => {
  assert.ok(R.PARTS[3] && R.PARTS[4], 'tiers 3 and 4 exist');
  const s = R.newState(1), r = R.startRace(s, 'cinder'); r.cars[0].place = 1; r.cars[0].finishT = 150;
  const res = R.finishRace(s, r);
  assert.ok(res.parts[3] > 0 && res.parts[4] > 0, JSON.stringify(res.parts));
  // the gate level is bought in the snow with springs (world 3's parts), the next one here with chips
  for (const [lv, tier] of [[GATE_LEVEL, 2], [GATE_LEVEL + 1, 3]]) {
    const c = R.upgradeCost(gateState(1, lv - 1), R.START_CAR, 'engine');
    assert.ok(c.parts[tier] > 0 && c.parts.every((n, i) => i === tier || n === 0), `level ${lv} costs ${R.PARTS[tier].id}s ${JSON.stringify(c.parts)}`);
  }
});

test('volcano entry gate: a level-5 Pip wins a clean drive in 2-3 minutes; level 6 wins them all; level 3 only scrapes by', () => {
  for (const id of IDS) {
    const up = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL, 'clean'));
    const strong = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL + 1, 'clean'));
    const weak = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL - 2, 'clean'));
    const wins = up.filter(x => x.place === 1).length, strongWins = strong.filter(x => x.place === 1).length, weakWins = weak.filter(x => x.place === 1).length;
    const mean = a => a.reduce((x, y) => x + y.margin, 0) / a.length;
    console.log(`  ${id}: level ${GATE_LEVEL} ${up.map(x => x.t.toFixed(0)).join('/')} s, wins ${wins}/4 by ${mean(up).toFixed(1)} s; level ${GATE_LEVEL + 1} wins ${strongWins}/4 by ${mean(strong).toFixed(1)} s; level ${GATE_LEVEL - 2} wins ${weakWins}/4 by ${mean(weak).toFixed(1)} s`);
    assert.ok(wins >= 3, id + ' gate clean wins ' + wins);
    assert.equal(strongWins, 4, id + ' a stronger car wins every race');
    for (const x of up) assert.ok(x.t >= 120 && x.t <= 180, id + ' took ' + x.t);
    assert.ok(mean(up) > mean(weak) + 5, id + ' upgrades should matter');
    assert.ok(mean(weak) < 3, id + ' a level-3 Pip should not win easily: ' + mean(weak));
    for (const x of up.concat(strong, weak)) { assert.ok(x.maxStep < 2, id + ' progress jumped ' + x.maxStep); assert.equal(x.putbacks, 0, id + ' fell in the lava'); }
  }
});

test('volcano: a sloppy drive in the gate Pip still wins sometimes', () => {
  for (const id of IDS) {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => raceResult(id, seed, GATE_LEVEL, 'sloppy'));
    const wins = runs.filter(x => x.place === 1).length;
    console.log(`  ${id}: sloppy wins ${wins}/8, ${Math.min(...runs.map(x => x.t)).toFixed(0)}-${Math.max(...runs.map(x => x.t)).toFixed(0)} s`);
    assert.ok(wins >= 1, id + ' sloppy wins ' + wins);
    for (const x of runs) assert.ok(x.t <= 200, id + ' sloppy took ' + x.t);
  }
});

test('every car can finish every volcano track', () => {
  for (const id of IDS) for (const carId of Object.keys(R.CARS)) {
    const s = R.newState(3);
    if (carId !== s.car) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); s.car = carId; }
    const r = R.startRace(s, id, { noAI: true }), p = r.cars[0];
    while (!p.done && r.t < 300) { R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20); }
    assert.ok(p.done && p.finishT < 220, `${carId} on ${id}: ${p.finishT}`);
  }
});
