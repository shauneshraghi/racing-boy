// Tests for world 5, Moon Base: its low-gravity tracks, the new hazards, the entry gate (how much upgrading a moon win
// takes), that every gap clears and every car gets round, and the economy at the end of the last world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;
const W5 = R.WORLDS[4];
const pace = id => W5.aiSpeed * (R.TRACKS[id].ai || 1);

// The entry gate: Pip with every upgrade at level 6 (its caps; levels past 5 need springs from world 3) should win
// a clean drive on every moon track; one level less only scrapes by.
const GATE_LEVEL = 6;
function gateState(seed, level = GATE_LEVEL, carId = R.START_CAR) {
  const s = R.newState(seed);
  if (carId !== s.car) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); s.car = carId; }
  for (const k of R.UP_KEYS) s.cars[carId].up[k] = Math.min(level, R.CARS[carId].caps[k]);
  return s;
}
// race the bot to the end; records the player's place, time, the gap to the next finisher, any jump in progress,
// how long the longest flight lasted and how often the rivals fell into a chasm
const cache = new Map();
function raceResult(trackId, seed, level, style, carId = R.START_CAR) {
  const key = [trackId, seed, level, style, carId].join();
  if (cache.has(key)) return cache.get(key);
  const s = gateState(seed, level, carId), r = R.startRace(s, trackId), p = r.cars[0];
  let last = null, maxStep = 0, putbacks = 0, rivalFalls = 0, air = 0, maxAir = 0;
  while (!p.done && r.t < 400) {
    R.input(r, R.botInput(r, p, style)); R.stepRace(r, 1 / 20);
    if (r.events.some(e => e.type === 'putback' && e.car === 0)) putbacks++;
    else if (last !== null && r.phase === 'race') maxStep = Math.max(maxStep, Math.abs(p.prog - last));
    rivalFalls += r.events.filter(e => e.type === 'splash' && e.car > 0).length;
    r.events.length = 0; last = p.prog;
    air = p.air ? air + 1 / 20 : 0; maxAir = Math.max(maxAir, air);
  }
  const other = r.cars.find(c => c.place === (p.place === 1 ? 2 : 1));
  const out = { place: p.place, t: p.finishT, margin: other.finishT - p.finishT, maxStep, putbacks, rivalFalls, maxAir };
  cache.set(key, out);
  return out;
}
const SEEDS = [1, 2, 3, 4];
const mean = (a, k = 'margin') => a.reduce((x, y) => x + y[k], 0) / a.length;

test('world 5 is Moon Base with rimhop, rille and starfall in low gravity; starfall is the longest', () => {
  assert.equal(W5.id, 'moon'); assert.equal(W5.name, 'Moon Base');
  assert.deepEqual([...W5.tracks], ['rimhop', 'rille', 'starfall']);
  assert.ok(W5.grav >= 0.5 && W5.grav <= 0.6, 'grav ' + W5.grav);
  for (const id of W5.tracks) { assert.equal(R.TRACKS[id].world, 4, id); assert.ok([2, 3].includes(R.TRACKS[id].laps), id); }
  const L = id => R.track(id).L;
  assert.ok(L('starfall') > L('rimhop') && L('starfall') > L('rille'));
  assert.equal(R.TRACKS.starfall.laps, 2);
  const r = R.startRace(R.newState(1), 'rimhop', { noAI: true });
  assert.equal(R.envOf(r).grav, W5.grav);
});

test('moon set pieces: peaks of 10-16 cells, the highest in the finale, chasms wider than any on Earth, a dome base', () => {
  const peak = id => Math.max(...R.track(id).samples.map(s => s.y));
  for (const id of W5.tracks) {
    const T = R.TRACKS[id], g = R.track(id);
    assert.ok(peak(id) >= 10 && peak(id) <= 16, id + ' peak ' + peak(id));
    assert.ok(g.ramps.some(m => m.gap >= 7), id + ' has a wide chasm');
    assert.ok(T.base && T.base[0] < T.base[1], id + ' runs through the dome base');
    assert.ok(g.hazards.length >= 2, id + ' hazards');
  }
  assert.equal(peak('starfall'), 16);
  const earthGap = Math.max(...['creek', 'windmill', 'mesa', 'oasis'].map(id => Math.max(...R.track(id).ramps.map(m => m.gap))));
  assert.ok(Math.min(...W5.tracks.map(id => Math.max(...R.track(id).ramps.map(m => m.gap)))) > earthGap * 1.6);
});

test('the moon hazards: a rover, bouncing moon rocks, skipping meteorites and a dish robot, all on the moon tracks', () => {
  for (const k of ['rover', 'moonrock', 'meteor', 'dish']) {
    const H = R.HAZ[k];
    assert.ok(H && H.r > 0 && H.h > 0 && H.period > 0 && H.gap > 0, k);
    assert.ok(W5.tracks.some(id => R.TRACKS[id].hazards.some(h => h.kind === k)), k + ' is used');
  }
  // a moon rock bounces so high that a car slips under it at the top of the hop
  const s = R.newState(2), r = R.startRace(s, 'rille'), i = r.g.hazards.findIndex(h => h.kind === 'moonrock');
  let top = 0; for (let t = 0; t < 6; t += 0.02) top = Math.max(top, R.hazardAt(r, i, t).y);
  assert.ok(top > R.HAZ.moonrock.h, 'bounce ' + top);
});

test('low gravity: the rim crests launch the stock car into long floaty flights', () => {
  for (const id of W5.tracks) {
    const s = R.newState(3), r = R.startRace(s, id, { noAI: true }), p = r.cars[0];
    let crests = 0, air = 0, best = 0;
    while (p.lap < 2 && r.t < 200) {
      R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20);
      crests += r.events.filter(e => e.type === 'jump' && e.crest).length; r.events.length = 0;
      air = p.air ? air + 1 / 20 : 0; best = Math.max(best, air);
    }
    assert.ok(crests >= 2, id + ' crest launches ' + crests);
    assert.ok(best >= 1.2, id + ' longest flight ' + best.toFixed(2) + ' s');
  }
});

test('moon chasms clear at the stock car speed and at a slowed rival speed', () => {
  // the slowest a rival goes on a straight: the lowest skill, held back the most by the rubber band
  const stock = R.statsFor(R.START_CAR).speed;
  for (const id of W5.tracks) {
    const g = R.track(id), rivalLow = pace(id) * R.PACE * Math.min(...W5.skill) * 0.75;
    g.ramps.forEach((m, i) => {
      if (!m.gap) return;
      for (const v of [stock, rivalLow]) {
        const s = R.newState(1), r = R.startRace(s, id, { noAI: true }), p = r.cars[0];
        r.phase = 'race'; p.stats.speed = v; R._place(r, p, m.s - 8, 0); p.v = v;
        let splash = false, flew = false;
        for (let k = 0; k < 300; k++) {
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

test('separate stretches of each moon track are far enough apart that query never snaps across', () => {
  for (const id of W5.tracks) {
    const g = R.track(id), lim = g.hw + R.RUNOFF;
    for (let i = 0; i < g.n; i += 2) for (const d of [-lim, -lim / 2, 0, lim / 2, lim]) {
      const s = g.samples[i].s, p = R.pointAt(g, s, d), q = g.query(p.x, p.z, s);
      const ds = Math.abs(((q.s - s) % g.L + g.L * 1.5) % g.L - g.L / 2);
      assert.ok(ds < 8, `${id} at u ${(s / g.L).toFixed(3)} offset ${d.toFixed(1)} snapped ${ds.toFixed(1)} cells`); // the inside of a hairpin moves a few cells
    }
  }
});

test('moon entry gate: a level-6 Pip wins a clean drive in 2-3 minutes; a level-5 Pip only scrapes by', () => {
  const margins = [];
  for (const id of W5.tracks) {
    const up = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL, 'clean')), lower = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL - 1, 'clean'));
    const wins = up.filter(x => x.place === 1).length, lowerWins = lower.filter(x => x.place === 1).length;
    console.log(`  ${id}: level ${GATE_LEVEL} ${up.map(x => x.t.toFixed(0)).join('/')} s, wins ${wins}/4 by ${mean(up).toFixed(1)} s; level ${GATE_LEVEL - 1} wins ${lowerWins}/4 by ${mean(lower).toFixed(1)} s; longest flight ${Math.max(...up.map(x => x.maxAir)).toFixed(1)} s`);
    assert.ok(wins >= 3, id + ' level-6 clean wins ' + wins);
    for (const x of up) assert.ok(x.t >= 120 && x.t <= 180, id + ' took ' + x.t);
    assert.ok(mean(up) > mean(lower) + 4, id + ' upgrades should matter');
    assert.ok(mean(lower) < 3, id + ' a level-5 Pip should not win easily: ' + mean(lower));
    for (const x of up.concat(lower)) assert.ok(x.maxStep < 2, id + ' progress jumped ' + x.maxStep);
    for (const x of up.concat(lower)) assert.equal(x.rivalFalls, 0, id + ' a rival fell into a chasm');
    margins.push(mean(up));
  }
  // the world gets harder track by track: the finale is won by the least
  assert.ok(margins[0] > margins[2] && margins[1] > margins[2] - 1, 'margins ' + margins.map(m => m.toFixed(1)));
});

test('moon: a stronger car (Bolt, every upgrade at level 3) wins every track, every time', () => {
  for (const id of W5.tracks) {
    const runs = SEEDS.map(seed => raceResult(id, seed, 3, 'clean', 'bolt'));
    console.log(`  ${id}: bolt level 3 wins ${runs.filter(x => x.place === 1).length}/4 by ${mean(runs).toFixed(1)} s`);
    for (const x of runs) assert.equal(x.place, 1, id + ' seed margin ' + x.margin);
  }
});

test('moon: a sloppy drive in the level-6 Pip still wins sometimes', () => {
  for (const id of W5.tracks) {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => raceResult(id, seed, GATE_LEVEL, 'sloppy'));
    const wins = runs.filter(x => x.place === 1).length;
    console.log(`  ${id}: sloppy wins ${wins}/8, ${Math.min(...runs.map(x => x.t)).toFixed(0)}-${Math.max(...runs.map(x => x.t)).toFixed(0)} s`);
    assert.ok(wins >= 1, id + ' sloppy wins ' + wins);
    for (const x of runs) assert.ok(x.t <= 210, id + ' sloppy took ' + x.t);
  }
});

test('every car can finish every moon track', () => {
  for (const id of W5.tracks) for (const carId of Object.keys(R.CARS)) {
    const s = R.newState(3);
    if (carId !== s.car) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); s.car = carId; }
    const r = R.startRace(s, id, { noAI: true }), p = r.cars[0];
    while (!p.done && r.t < 300) { R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20); }
    assert.ok(p.done && p.finishT < 220, `${carId} on ${id}: ${p.finishT}`);
  }
});

// finish a race on trackId at the given place without driving it
function fakeFinish(s, trackId, place = 1, time = 150) {
  const r = R.startRace(s, trackId); r.cars[0].place = place; r.cars[0].finishT = time;
  return R.finishRace(s, r);
}
test('a moon win pays crystals and no part past the last tier; the first win bonus pays crystals too', () => {
  const s = R.newState(1), before = [...s.parts];
  const first = fakeFinish(s, 'rimhop');
  assert.equal(first.parts.length, R.PARTS.length);
  for (const n of first.parts) assert.ok(Number.isFinite(n) && n >= 0, JSON.stringify(first.parts));
  assert.ok(first.parts[4] >= 4 + 3, 'crystals for the place and the first-win bonus: ' + JSON.stringify(first.parts));
  assert.deepEqual([...first.bonus.parts], [0, 0, 0, 0, 3]);
  assert.ok(first.coins > 0 && Number.isFinite(first.coins));
  assert.equal(s.parts.length, R.PARTS.length);
  s.parts.forEach((n, i) => assert.equal(n, before[i] + first.parts[i]));
  const again = fakeFinish(s, 'rimhop');
  assert.deepEqual([...again.parts], [0, 0, 0, 0, 4]);
  const third = fakeFinish(s, 'rimhop', 3);
  assert.deepEqual([...third.parts], [0, 0, 0, 0, 2]);
  assert.ok(JSON.parse(R.serialize(s)).parts.every(Number.isFinite), 'the save stays clean');
});

test('sweeping the moon, the last world, announces no next world', () => {
  const s = R.newState(1);
  for (let w = 0; w < 4; w++) for (const t of R.WORLDS[w].tracks) s.best[t] = 1;
  fakeFinish(s, 'rimhop'); fakeFinish(s, 'rille');
  const res = fakeFinish(s, 'starfall');
  assert.equal(res.place, 1);
  assert.ok(!R.WORLDS.some(W => res.unlocked.includes(W.name)), JSON.stringify(res.unlocked));
  assert.ok(W5.tracks.every(t => s.best[t] === 1));
  assert.ok(W5.tracks.every(t => R.trackUnlocked(s, t) || !R.worldUnlocked(s, 4)));
});
