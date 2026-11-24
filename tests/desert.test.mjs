// Tests for world 2, Sunbaked Canyon: its tracks, the entry gate (how much upgrading a desert win takes),
// and that every car can get round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;
const W2 = R.WORLDS[1];

// The entry gate: Pip with every upgrade at level 2 (bolts-only levels, bought with world-1 winnings)
// should win a clean drive on every desert track; a stock Pip only scrapes through.
const GATE_LEVEL = 2;
function gateState(seed, level = GATE_LEVEL) {
  const s = R.newState(seed);
  for (const k of R.UP_KEYS) s.cars[R.START_CAR].up[k] = level;
  return s;
}
// race the bot to the end; records the player's place, time, the gap to the next finisher and any jump in progress
const cache = new Map();
function raceResult(trackId, seed, level, style) {
  const key = [trackId, seed, level, style].join();
  if (cache.has(key)) return cache.get(key);
  const s = gateState(seed, level), r = R.startRace(s, trackId), p = r.cars[0];
  let last = null, maxStep = 0, putbacks = 0;
  while (!p.done && r.t < 400) {
    R.input(r, R.botInput(r, p, style)); R.stepRace(r, 1 / 20);
    if (r.events.some(e => e.type === 'putback' && e.car === 0)) putbacks++;
    else if (last !== null && r.phase === 'race') maxStep = Math.max(maxStep, Math.abs(p.prog - last));
    r.events.length = 0; last = p.prog;
  }
  const other = r.cars.find(c => c.place === (p.place === 1 ? 2 : 1));
  const out = { place: p.place, t: p.finishT, margin: other.finishT - p.finishT, maxStep, putbacks };
  cache.set(key, out);
  return out;
}
const SEEDS = [1, 2, 3, 4];

test('world 2 is Sunbaked Canyon with dune, mesa and oasis; oasis is the longest', () => {
  assert.equal(W2.id, 'desert'); assert.equal(W2.name, 'Sunbaked Canyon');
  assert.deepEqual([...W2.tracks], ['dune', 'mesa', 'oasis']);
  for (const id of W2.tracks) { assert.equal(R.TRACKS[id].world, 1, id); assert.ok([2, 3].includes(R.TRACKS[id].laps), id); }
  const L = id => R.track(id).L;
  assert.ok(L('oasis') > L('dune') && L('oasis') > L('mesa'));
  assert.equal(R.TRACKS.oasis.laps, 2);
  assert.ok(R.track('mesa').ramps.filter(m => m.gap > 0).length >= 2, 'mesa jumps canyons');
  assert.ok(R.track('oasis').ramps.some(m => m.gap > 0), 'oasis has creeks');
});

test('desert gap jumps clear at the stock car speed and at a slowed rival speed', () => {
  // the slowest a rival goes on a straight: the lowest skill, held back the most by the rubber band
  const rivalLow = W2.aiSpeed * R.PACE * Math.min(...W2.skill) * 0.75;
  const stock = R.statsFor(R.START_CAR).speed;
  for (const id of W2.tracks) {
    const g = R.track(id);
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

test('desert entry gate: a level-2 Pip wins a clean drive in 2-3 minutes; a stock Pip only scrapes by', () => {
  for (const id of W2.tracks) {
    const up = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL, 'clean')), stock = SEEDS.map(seed => raceResult(id, seed, 0, 'clean'));
    const wins = up.filter(x => x.place === 1).length, stockWins = stock.filter(x => x.place === 1).length;
    const mean = a => a.reduce((x, y) => x + y.margin, 0) / a.length;
    console.log(`  ${id}: level ${GATE_LEVEL} ${up.map(x => x.t.toFixed(0)).join('/')} s, wins ${wins}/4 by ${mean(up).toFixed(1)} s; stock wins ${stockWins}/4 by ${mean(stock).toFixed(1)} s`);
    assert.ok(wins >= 3, id + ' level-2 clean wins ' + wins);
    for (const x of up) assert.ok(x.t >= 120 && x.t <= 180, id + ' took ' + x.t);
    assert.ok(mean(up) > mean(stock) + 5, id + ' upgrades should matter');
    assert.ok(mean(stock) < 3, id + ' a stock Pip should not win easily: ' + mean(stock));
    for (const x of up.concat(stock)) assert.ok(x.maxStep < 2, id + ' progress jumped ' + x.maxStep);
  }
});

test('desert: a sloppy drive in the level-2 Pip still wins sometimes', () => {
  for (const id of W2.tracks) {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => raceResult(id, seed, GATE_LEVEL, 'sloppy'));
    const wins = runs.filter(x => x.place === 1).length;
    console.log(`  ${id}: sloppy wins ${wins}/8, ${Math.min(...runs.map(x => x.t)).toFixed(0)}-${Math.max(...runs.map(x => x.t)).toFixed(0)} s`);
    assert.ok(wins >= 1, id + ' sloppy wins ' + wins);
    for (const x of runs) assert.ok(x.t <= 200, id + ' sloppy took ' + x.t);
  }
});

test('every car can finish every desert track', () => {
  for (const id of W2.tracks) for (const carId of Object.keys(R.CARS)) {
    const s = R.newState(3);
    if (carId !== s.car) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); s.car = carId; }
    const r = R.startRace(s, id, { noAI: true }), p = r.cars[0];
    while (!p.done && r.t < 300) { R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20); }
    assert.ok(p.done && p.finishT < 200, `${carId} on ${id}: ${p.finishT}`);
  }
});
