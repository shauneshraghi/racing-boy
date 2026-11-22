// Tests for progression: world announcements, the first-win bonus, the save fields behind it, and the
// pass / lostPlace race events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;

// finish a race on trackId at the given place without driving it
function fakeFinish(s, trackId, place = 1, time = 140) {
  const r = R.startRace(s, trackId); r.cars[0].place = place; r.cars[0].finishT = time;
  return R.finishRace(s, r);
}

test('a sweep announces the next world only when it has tracks to race', () => {
  let checked = 0;
  for (let w = 1; w < R.WORLDS.length; w++) {
    const prev = R.WORLDS[w - 1].tracks; if (!prev.length) continue;
    const s = R.newState(1);
    for (let k = 0; k < w - 1; k++) for (const t of R.WORLDS[k].tracks) s.best[t] = 1;
    for (const t of prev.slice(0, -1)) s.best[t] = 1;
    const res = fakeFinish(s, prev[prev.length - 1]);
    assert.equal(res.unlocked.includes(R.WORLDS[w].name), R.WORLDS[w].tracks.length > 0, R.WORLDS[w].name + ': ' + JSON.stringify(res.unlocked));
    checked++;
  }
  assert.ok(checked >= 1);
});

const placeEvents = r => r.events.filter(e => (e.type === 'pass' || e.type === 'lostPlace') && e.car === 0);

test('pass events fire as the player overtakes from the grid, each for a place that held', () => {
  const s = R.newState(3), r = R.startRace(s, R.WORLDS[0].tracks[0]), p = r.cars[0], seen = [];
  while (!p.done && r.t < 400) {
    R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20);
    for (const e of placeEvents(r)) seen.push({ ...e, t: r.t });
    r.events.length = 0;
  }
  assert.ok(seen.length, 'some place events');
  assert.equal(seen[0].type, 'pass', 'no bogus lostPlace at the start: ' + JSON.stringify(seen[0]));
  let cur = 4;
  for (const e of seen) {
    assert.ok(e.type === 'pass' ? e.place < cur : e.place > cur, JSON.stringify(e) + ' after ' + cur);
    cur = e.place;
  }
  assert.ok(seen.some(e => e.type === 'pass' && e.place === 1), 'passed into the lead');
});

test('side-by-side jitter emits nothing; a place that holds emits one pass, then one lostPlace', () => {
  const s = R.newState(3), r = R.startRace(s, R.WORLDS[0].tracks[0]);
  r.cars.length = 2;
  const [p, a] = r.cars;
  while (r.phase === 'count') { R.input(r, {}); R.stepRace(r, 1 / 60); }
  const run = (secs, off) => { const out = [];
    for (let i = 0; i < secs * 60; i++) { a.prog = p.prog + off(i); R.input(r, { aim: R.headingAt(r.g, p.s) }); R.stepRace(r, 1 / 60); out.push(...placeEvents(r)); r.events.length = 0; }
    return out; };
  assert.deepEqual(run(1, () => 3), [], 'rival ahead from the start: no event');
  assert.deepEqual(run(3, i => (Math.floor(i / 12) % 2 ? 2 : -2)), [], 'swapping every 0.2 s');
  const passed = run(1.5, () => -3);
  assert.deepEqual(passed.map(e => e.type + e.place), ['pass1']);
  const lost = run(1.5, () => 3);
  assert.deepEqual(lost.map(e => e.type + e.place), ['lostPlace2']);
});

test('the first win of a track pays a bonus of coins and next-tier parts; later wins do not', () => {
  const s = R.newState(1), W1 = R.WORLDS[0].tracks;
  const c0 = s.coins, first = fakeFinish(s, W1[0]);
  assert.equal(first.firstWin, true);
  assert.equal(s.coins, c0 + first.coins, 'the bonus is in the paid total');
  assert.ok(first.bonus && first.bonus.coins > 0 && first.bonus.parts[1] >= 2, JSON.stringify(first.bonus));
  const c1 = s.coins, again = fakeFinish(s, W1[0]);
  assert.equal(again.firstWin, false); assert.equal(again.bonus, null);
  assert.equal(s.coins, c1 + again.coins);
  assert.ok(first.coins - again.coins >= first.bonus.coins - 1, 'repeat win pays no bonus');
  assert.ok(first.parts[1] > again.parts[1], 'gears');
  const lose = fakeFinish(R.newState(1), W1[0], 2);
  assert.equal(lose.firstWin, false); assert.equal(lose.bonus, null);
});

test('sweeping world 1 once pays the gears for a level-4 upgrade', () => {
  const s = R.newState(1);
  for (const t of R.WORLDS[0].tracks) fakeFinish(s, t);
  s.cars[s.car].up.engine = 3;
  const cost = R.upgradeCost(s, s.car, 'engine');
  assert.ok(s.parts[1] >= cost.parts[1], 'gears ' + s.parts[1] + ' need ' + cost.parts[1]);
});

test('world 2 pays its own tier (gears) and springs for a win', () => {
  const t = R.WORLDS[1].tracks[0];
  assert.ok(t, 'world 2 has tracks');
  const s = R.newState(1); s.best[t] = 1; s.wins[t] = 1; // not a first win
  const res = fakeFinish(s, t);
  assert.ok(res.parts[1] >= 3 && res.parts[2] >= 1 && res.parts[0] === 0, JSON.stringify(res.parts));
});

test('wins per track are saved; an old save without them loads and pays no bonus again for tracks it already won', () => {
  const W1 = R.WORLDS[0].tracks, s = R.newState(1);
  fakeFinish(s, W1[0]); fakeFinish(s, W1[0]);
  const back = R.deserialize(R.serialize(s));
  assert.equal(back.wins[W1[0]], 2);
  // a save from before wins were kept
  const raw = JSON.parse(R.serialize(s)); delete raw.wins;
  const old = R.deserialize(JSON.stringify(raw));
  assert.ok(old, 'old save loads'); assert.equal(old.v, 1);
  assert.equal(old.best[W1[0]], 1);
  assert.equal(fakeFinish(old, W1[0]).firstWin, false, 'already won before the upgrade');
  assert.equal(fakeFinish(old, W1[1]).firstWin, true, 'a track never won still pays');
  assert.equal(JSON.parse(R.serialize(old)).v, 1, 'format stays version 1');
});
