// Tests for world 3, Snowcap Peaks: its tracks and their set pieces, the ice, the new hazards, the entry gate (how
// much upgrading a snow win takes), the difficulty ramp across the world, and that every car can get round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;
const W3 = R.WORLDS[2];
const ICE = ['pines', 'skijump', 'glacier'];

// The entry gate: Pip with every upgrade at level 4 (the first gears level, bought with desert winnings) wins a clean
// drive on every snow track; one level less only scrapes by, one more wins everywhere.
const GATE_LEVEL = 4;
function gateState(seed, level = GATE_LEVEL) {
  const s = R.newState(seed);
  for (const k of R.UP_KEYS) s.cars.pip.up[k] = Math.min(level, R.CARS.pip.caps[k]);
  return s;
}
// race the bot to the end; records the player's place, time, the gap to the next finisher, any jump in progress,
// wall bumps and the air time of each jump
const cache = new Map();
function raceResult(trackId, seed, level, style) {
  const key = [trackId, seed, level, style].join();
  if (cache.has(key)) return cache.get(key);
  const s = gateState(seed, level), r = R.startRace(s, trackId), p = r.cars[0];
  let last = null, maxStep = 0, putbacks = 0, walls = 0, jumpT = null;
  const jumps = [];
  while (!p.done && r.t < 400) {
    R.input(r, R.botInput(r, p, style)); R.stepRace(r, 1 / 20);
    for (const e of r.events) if (e.car === 0) {
      if (e.type === 'putback') putbacks++;
      if (e.type === 'wall') walls++;
      if (e.type === 'jump') jumpT = { t: r.t, u: p.s / r.g.L, crest: !!e.crest };
      if (e.type === 'land' && jumpT) { jumps.push({ ...jumpT, air: r.t - jumpT.t }); jumpT = null; }
    }
    if (!r.events.some(e => e.type === 'putback' && e.car === 0) && last !== null && r.phase === 'race') maxStep = Math.max(maxStep, Math.abs(p.prog - last));
    r.events.length = 0; last = p.prog;
  }
  const other = r.cars.find(c => c.place === (p.place === 1 ? 2 : 1));
  const out = { place: p.place, t: p.finishT, margin: other.finishT - p.finishT, maxStep, putbacks, walls, jumps };
  cache.set(key, out);
  return out;
}
const SEEDS = [1, 2, 3, 4];
const mean = (a, f) => a.reduce((x, y) => x + f(y), 0) / a.length;
const peak = id => Math.max(...R.track(id).samples.map(sm => sm.y));

test('world 3 is Snowcap Peaks with pines, skijump and glacier; glacier is the longest', () => {
  assert.equal(W3.id, 'ice'); assert.equal(W3.name, 'Snowcap Peaks');
  assert.deepEqual([...W3.tracks], ICE);
  for (const id of ICE) { assert.equal(R.TRACKS[id].world, 2, id); assert.ok([2, 3].includes(R.TRACKS[id].laps), id); }
  const L = id => R.track(id).L;
  assert.ok(L('glacier') > L('pines') && L('glacier') > L('skijump'));
  assert.equal(R.TRACKS.glacier.laps, 2);
  assert.ok(R.track('glacier').ramps.filter(m => m.gap > 0).length >= 2, 'glacier leaps crevasses');
});

test('the snow is icy: a world grip a little below 1, the same for every car', () => {
  const r = R.startRace(R.newState(1), 'pines', { noAI: true }), e = R.envOf(r);
  assert.ok(e.grip >= 0.75 && e.grip <= 0.9, 'grip ' + e.grip);
  assert.equal(e.grav, 1);
});

test('the snow worlds climb far higher than the hills and the canyon, on slopes a car can climb', () => {
  const lower = R.WORLDS[0].tracks.concat(R.WORLDS[1].tracks).map(peak), was = Math.max(...lower);
  for (const id of ICE) {
    const g = R.track(id);
    // bridges lift the earlier worlds to 6 or so
    assert.ok(peak(id) >= 9 && peak(id) >= was + 2, `${id} peaks at ${peak(id)} (the old worlds ${was})`);
    // the steepest climb still keeps 80% of the top speed (climbing slows by SLOPE_K = 0.6 × the slope)
    const up = Math.max(...g.samples.map(sm => sm.gy));
    assert.ok(up <= 0.33, `${id} climbs at ${up.toFixed(2)}`);
  }
  assert.ok(Math.max(...ICE.map(peak)) >= 14, 'one summit at 14 or more');
});

test('stretches of a snow track stay apart: the nearest-road lookup never snaps across to another one', () => {
  for (const id of ICE) {
    const g = R.track(id), lim = g.hw + R.RUNOFF;
    for (let i = 0; i < g.n; i += 2) {
      const sm = g.samples[i];
      for (let d = -lim; d <= lim + 1e-9; d += lim / 4) {
        const p = R.pointAt(g, sm.s, d), q = g.query(p.x, p.z, sm.s);
        let ds = Math.abs(q.s - sm.s); ds = Math.min(ds, g.L - ds);
        assert.ok(ds < 2, `${id} at s ${sm.s} offset ${d.toFixed(1)} snapped to s ${q.s.toFixed(1)}`);
      }
    }
  }
});

test('three new hazards live in the snow: snowballs, penguins and ice blocks', () => {
  const kinds = ['snowball', 'penguin', 'iceblock'];
  for (const k of kinds) { const H = R.HAZ[k]; assert.ok(H && H.r > 0 && H.h > 0 && H.period > 0 && H.gap > 0, k); }
  const used = new Set();
  for (const id of ICE) {
    const hz = R.TRACKS[id].hazards;
    assert.ok(hz.length >= 2, id + ' has hazards');
    for (const h of hz) { assert.ok(kinds.includes(h.kind), id + ' ' + h.kind); used.add(h.kind); }
  }
  assert.deepEqual([...used].sort(), [...kinds].sort());
  // a hazard on the road slows the car like the others
  const s = R.newState(1), r = R.startRace(s, 'pines'), p = r.cars[0];
  r.phase = 'race';
  const i = r.g.hazards.findIndex(h => h.kind === 'penguin'), hz = R.hazardAt(r, i);
  p.x = hz.x; p.z = hz.z; p.s = hz.s; p.v = 10;
  R.stepRace(r, 1 / 60);
  assert.ok(p.slowT > 0, 'hit by a penguin');
});

test('snow set pieces: a ski jump with huge air, crest hops off the pass and the plateau, and the glacier crevasses', () => {
  const air = id => raceResult(id, 1, GATE_LEVEL, 'clean').jumps;
  const ski = air('skijump').filter(j => !j.crest);
  assert.ok(ski.length && Math.min(...ski.map(j => j.air)) >= 1.5, 'ski jump air ' + ski.map(j => j.air.toFixed(2)));
  assert.ok(air('pines').some(j => j.crest && j.air >= 0.8 && j.u > 0.6 && j.u < 0.7), 'a big hop off the pass');
  assert.ok(air('pines').filter(j => j.crest && j.u > 0.8).length >= 2, 'moguls');
  assert.ok(air('glacier').some(j => j.crest && j.u > 0.55 && j.u < 0.65), 'a hop off the plateau');
  assert.equal(air('glacier').filter(j => !j.crest).length, 2 * R.TRACKS.glacier.laps, 'every crevasse leapt');
  assert.equal(raceResult('glacier', 1, GATE_LEVEL, 'clean').putbacks, 0);
});

test('snow gap jumps clear at the stock car speed and at a slowed rival speed', () => {
  // the slowest a rival goes on a straight: the lowest skill, held back the most by the rubber band
  const rivalLow = W3.aiSpeed * R.PACE * Math.min(...W3.skill) * 0.75;
  const stock = R.statsFor(R.START_CAR).speed;
  let gaps = 0;
  for (const id of ICE) {
    const g = R.track(id);
    g.ramps.forEach((m, i) => {
      if (!m.gap) return;
      gaps++;
      // on level ground
      assert.ok(Math.abs(R.slopeAt(g, m.s + m.len + m.gap / 2)) < 1e-6, `${id} gap ${i} is on level ground`);
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
  assert.ok(gaps >= 2);
});

test('snow entry gate: a level-4 Pip wins a clean drive in 2-3 minutes; level 3 only scrapes by, level 5 wins everywhere', () => {
  for (const id of ICE) {
    const up = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL, 'clean'));
    const below = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL - 1, 'clean'));
    const above = SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL + 1, 'clean'));
    const desert = SEEDS.map(seed => raceResult(id, seed, 2, 'clean'));
    const wins = a => a.filter(x => x.place === 1).length, m = a => mean(a, x => x.margin);
    console.log(`  ${id}: level ${GATE_LEVEL} ${up.map(x => x.t.toFixed(0)).join('/')} s, wins ${wins(up)}/4 by ${m(up).toFixed(1)} s; level ${GATE_LEVEL - 1} wins ${wins(below)}/4 by ${m(below).toFixed(1)} s; level ${GATE_LEVEL + 1} by ${m(above).toFixed(1)} s; level 2 by ${m(desert).toFixed(1)} s`);
    assert.ok(wins(up) >= 3, id + ' level-4 clean wins ' + wins(up));
    for (const x of up) assert.ok(x.t >= 120 && x.t <= 180, id + ' took ' + x.t);
    assert.ok(m(up) > m(below) + 4, id + ' the fourth level should matter');
    assert.ok(m(below) < 3, id + ' a level-3 Pip should not win easily: ' + m(below));
    assert.ok(m(desert) < 1, id + ' the desert gate car is not enough: ' + m(desert));
    assert.equal(wins(above), 4, id + ' level 5 wins every race');
    for (const x of up.concat(below)) assert.ok(x.maxStep < 2, id + ' progress jumped ' + x.maxStep);
    for (const x of up) assert.equal(x.walls, 0, id + ' a clean drive on ice stays off the walls');
  }
});

test('snow: a sloppy drive in the level-4 Pip still wins sometimes, and the ice does not bounce it off the walls much', () => {
  for (const id of ICE) {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map(seed => raceResult(id, seed, GATE_LEVEL, 'sloppy'));
    const wins = runs.filter(x => x.place === 1).length;
    console.log(`  ${id}: sloppy wins ${wins}/8, ${Math.min(...runs.map(x => x.t)).toFixed(0)}-${Math.max(...runs.map(x => x.t)).toFixed(0)} s, ${mean(runs, x => x.walls).toFixed(1)} wall bumps`);
    assert.ok(wins >= 1, id + ' sloppy wins ' + wins);
    for (const x of runs) assert.ok(x.t <= 200, id + ' sloppy took ' + x.t);
    assert.ok(mean(runs, x => x.walls) <= 3, id + ' sloppy wall bumps ' + mean(runs, x => x.walls));
  }
});

test('snow difficulty ramps: the rivals get quicker track by track, and the first track is the easiest win', () => {
  const ai = ICE.map(id => R.TRACKS[id].ai || 1);
  for (let i = 1; i < ai.length; i++) assert.ok(ai[i] > ai[i - 1], 'rival pace ' + ai);
  assert.ok(W3.aiSpeed > R.WORLDS[1].aiSpeed, 'faster rivals than the canyon');
  const margin = id => mean(SEEDS.map(seed => raceResult(id, seed, GATE_LEVEL, 'clean')), x => x.margin);
  const sloppy = id => [1, 2, 3, 4, 5, 6, 7, 8].filter(seed => raceResult(id, seed, GATE_LEVEL, 'sloppy').place === 1).length;
  assert.ok(margin('pines') > margin('skijump') && margin('pines') > margin('glacier'), 'pines is the easiest clean win');
  // 8 seeds cannot order the two harder tracks reliably (one race either way), so only the first must be the easiest
  assert.ok(sloppy('pines') > sloppy('skijump') && sloppy('pines') > sloppy('glacier'), 'pines is the easiest sloppy win');
});

test('every car can finish every snow track', () => {
  for (const id of ICE) for (const carId of Object.keys(R.CARS)) {
    const s = R.newState(3);
    if (carId !== s.car) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); s.car = carId; }
    const r = R.startRace(s, id, { noAI: true }), p = r.cars[0];
    while (!p.done && r.t < 300) { R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20); }
    assert.ok(p.done && p.finishT < 200, `${carId} on ${id}: ${p.finishT}`);
  }
});
