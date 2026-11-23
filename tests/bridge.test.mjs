// Crossovers, bridges and open edges: a track may pass over itself on a bridge, and stretches with no wall let a car
// fall off and be put back on the road. Runs js/logic.js in a Node vm context with a made-up figure-8 track.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;

// a figure 8: the two lobes cross at u 0.25 (high, on a bridge) and u 0.75 (low, on the ground)
const pts = [];
for (let i = 0; i < 24; i++) {
  const t = i / 24 * Math.PI * 2, d = 1 + Math.sin(t) * Math.sin(t);
  pts.push([150 + 120 * Math.cos(t) / d, 100 + 120 * Math.sin(t) * Math.cos(t) / d]);
}
R.TRACKS.eight = {
  name: 'Test Eight', world: 0, laps: 2, hw: 3.6, scale: 1, pts,
  elev: [[0, 0], [0.1, 0], [0.2, 6], [0.3, 6], [0.4, 0], [0.6, 0]],
  bridges: [[0.205, 0.295]], drops: [[0.45, 0.55, 1]],
  pads: [], ramps: [], boxes: [0.25, 0.75], coins: [{ u: 0.248, off: 0, n: 3 }, { u: 0.748, off: 0, n: 3 }], hazards: []
};
const g = R.track('eight');
function race(seed = 3) { const s = R.newState(seed); const r = R.startRace(s, 'eight'); r.phase = 'race'; return r; }
function sampleAt(u) { return g.samples[Math.round(u * g.n) % g.n]; }

test('the figure 8 crosses itself at the bridge, high over the low road', () => {
  const hi = sampleAt(0.25), lo = sampleAt(0.75);
  assert.ok(Math.hypot(hi.x - lo.x, hi.z - lo.z) < 2, 'crossing');
  assert.ok(hi.y - lo.y >= R.BRIDGE_CLEAR, 'clearance ' + (hi.y - lo.y));
  assert.ok(R.onBridge(g, hi.s) && !R.onBridge(g, lo.s));
});

test('a hint keeps the road lookup on the car\'s own stretch at a crossing', () => {
  const hi = sampleAt(0.25), lo = sampleAt(0.75);
  const qh = g.query(hi.x + 0.3, hi.z, hi.s), ql = g.query(hi.x + 0.3, hi.z, lo.s);
  assert.ok(Math.abs(qh.s - hi.s) < 2, 'high ' + qh.s + ' want ' + hi.s);
  assert.ok(Math.abs(ql.s - lo.s) < 2, 'low ' + ql.s + ' want ' + lo.s);
});

test('a car driving through both crossings keeps its arc length and height smooth', () => {
  const r = race(), p = r.cars[0];
  r.cars.length = 1;
  let lastS = p.s, lastY = p.gy, jumps = 0, maxDy = 0;
  for (let i = 0; i < 60 * 200 && !p.done; i++) {
    R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 60);
    const ds = Math.abs(((p.s - lastS) % g.L + g.L * 1.5) % g.L - g.L / 2);
    if (ds > 2) jumps++;
    maxDy = Math.max(maxDy, Math.abs(p.gy - lastY));
    lastS = p.s; lastY = p.gy;
  }
  assert.equal(jumps, 0, 'arc length jumped');
  assert.ok(maxDy < 0.3, 'ground height jumped ' + maxDy);
  assert.ok(p.done, 'finished');
});

test('coins and crates on the bridge are out of reach from the road below, and the other way round', () => {
  const r = race(), p = r.cars[0];
  r.cars.length = 1;
  const lo = sampleAt(0.75), hiCoins = g.coins.filter(c => R.onBridge(g, c.s));
  assert.ok(hiCoins.length > 0);
  // sit the car under the bridge, on the low road, right under the bridge's coins
  R._place(r, p, lo.s, 0);
  for (const c of hiCoins) {
    p.x = c.x; p.z = c.z; R.input(r, { steer: 0 }); R.stepRace(r, 1 / 60);
  }
  assert.equal(r.coins.filter((c, i) => R.onBridge(g, g.coins[i].s) && c.t > 0).length, 0, 'took a bridge coin from below');
});

test('two cars at the same spot on different levels do not bump', () => {
  const r = race(), a = r.cars[0], b = r.cars[1];
  r.cars.length = 2;
  R._place(r, a, sampleAt(0.25).s, 0); R._place(r, b, sampleAt(0.75).s, 0);
  b.x = a.x + 0.2; b.z = a.z; const bx = b.x;
  a.v = b.v = 0; r.phase = 'count'; r.cd = 5; // frozen: count phase holds speed at 0
  r.phase = 'race';
  R.stepRace(r, 1 / 60);
  assert.ok(Math.abs(b.x - bx) < 0.3, 'bumped across levels');
});

test('driving off a bridge falls, and the car is put back on the deck within two seconds', () => {
  const r = race(), p = r.cars[0];
  r.cars.length = 1;
  R._place(r, p, sampleAt(0.24).s, 0); p.v = 12;
  p.h += Math.PI / 2; p.vh = p.h; // straight off the side
  let fell = false, back = -1;
  for (let i = 0; i < 300; i++) {
    R.input(r, { steer: 0 }); R.stepRace(r, 1 / 60);
    if (p.fallT > 0) fell = true;
    if (fell && p.fallT <= 0 && back < 0) back = r.t;
    if (back > 0) break;
  }
  assert.ok(fell, 'fell off');
  assert.ok(back > 0 && back < 2, 'put back after ' + back);
  assert.ok(R.onBridge(g, p.s) || Math.abs(((p.s - sampleAt(0.24).s) % g.L + g.L) % g.L) < 12, 'back near where it fell');
  assert.ok(Math.abs(g.query(p.x, p.z, p.s).d) < g.hw, 'on the road');
  assert.ok(r.events.some(e => e.type === 'fall'), 'fall event');
});

test('a drop edge is open on its side only; the other side still has a wall', () => {
  for (const side of [1, -1]) {
    const r = race(), p = r.cars[0];
    r.cars.length = 1;
    R._place(r, p, sampleAt(0.5).s, 0); p.v = 10;
    p.h += side * Math.PI / 2; p.vh = p.h;
    let fell = false;
    for (let i = 0; i < 120; i++) { R.input(r, { steer: 0 }); R.stepRace(r, 1 / 60); if (p.fallT > 0) fell = true; }
    if (side === 1) assert.ok(fell, 'fell off the open right side');
    else { assert.ok(!fell, 'the left side has a wall'); assert.ok(Math.abs(p.d) <= g.hw + R.RUNOFF + 0.6); }
  }
});

test('rivals do not drive off the open edges on their own', () => {
  const r = race(), falls = [];
  for (let i = 0; i < 60 * 60; i++) {
    R.input(r, R.botInput(r, r.cars[0], 'clean')); R.stepRace(r, 1 / 60);
    r.cars.forEach(c => { if (c.ai && c.fallT > 0 && !falls.includes(c.i)) falls.push(c.i); });
  }
  assert.equal(falls.length, 0, 'rivals fell: ' + falls);
});
