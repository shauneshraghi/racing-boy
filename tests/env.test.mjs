// Tests for the per-world environment factors (WORLDS[w].grip, grav, rough) and the per-track rival pace (TRACKS[id].ai).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;

function withWorld(w, patch, fn) {
  const W = R.WORLDS[w], old = {};
  for (const k in patch) { old[k] = W[k]; W[k] = patch[k]; }
  try { return fn(); } finally { for (const k in patch) { if (old[k] === undefined) delete W[k]; else W[k] = old[k]; } }
}
// drive straight then hold full right lock for a second; returns the heading change
function turnAfter(trackId) {
  const s = R.newState(5), r = R.startRace(s, trackId, { noAI: true }), p = r.cars[0];
  while (r.phase !== 'race') R.stepRace(r, 1 / 20);
  for (let i = 0; i < 40; i++) { R.input(r, { steer: 0 }); R.stepRace(r, 1 / 20); }
  const h0 = p.h;
  for (let i = 0; i < 20; i++) { R.input(r, { steer: 1 }); R.stepRace(r, 1 / 20); }
  return Math.abs(p.h - h0);
}

test('worlds without environment factors default to 1', () => {
  const r = R.startRace(R.newState(1), 'meadow', { noAI: true });
  const e = R.envOf(r);
  assert.equal(e.grip, 1); assert.equal(e.grav, 1); assert.equal(e.rough, 1);
});

test('a slippery world turns the car less for the same steering', () => {
  const base = turnAfter('meadow');
  const icy = withWorld(0, { grip: 0.5 }, () => turnAfter('meadow'));
  assert.ok(icy < base * 0.8, `icy ${icy} vs ${base}`);
});

test('low gravity keeps a ramp jump in the air longer', () => {
  function airTime() {
    const s = R.newState(3), r = R.startRace(s, 'meadow', { noAI: true }), p = r.cars[0];
    let air = 0;
    while (!p.done && r.t < 200) { R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20); if (p.air) air += 1 / 20; if (p.lap > 1) break; }
    return air;
  }
  const base = airTime(), moon = withWorld(0, { grav: 0.5 }, airTime);
  assert.ok(moon > base * 1.3, `moon ${moon} vs ${base}`);
});

test('a track ai multiplier speeds its rivals up', () => {
  const T = R.TRACKS.meadow, old = T.ai;
  function aiFinish() { const r = R.startRace(R.newState(9), 'meadow'); for (let i = 0; i < 600; i++) { R.input(r, {}); R.stepRace(r, 1 / 20); } return r.cars[1].prog; }
  const base = aiFinish(); T.ai = 1.1; const fast = aiFinish(); if (old === undefined) delete T.ai; else T.ai = old;
  assert.ok(fast > base * 1.03, `fast ${fast} vs ${base}`);
});
