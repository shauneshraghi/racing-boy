// Tests for the garage plaza: walking, walls and the station pads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;
const walk = (h, secs, dir) => { for (let t = 0; t < secs; t += 0.05) R.hubStep(h, 0.05, dir); };

test('the kid starts on open paving, away from every station', () => {
  const h = R.newHub();
  assert.ok(R.hubOpen(h.x, h.z));
  assert.equal(R.hubStation(h), null);
});

test('every station pad can be reached by a tap', () => {
  for (const [ch, name] of Object.entries(R.HUB.pads)) {
    const h = R.newHub(), z = R.HUB.rows.findIndex(r => r.includes(ch)), x = R.HUB.rows[z].indexOf(ch);
    assert.ok(R.hubWalkTo(h, x + 0.5, z + 0.5), name + ' path');
    walk(h, 12, null);
    assert.equal(R.hubStation(h), name);
  }
});

test('walls and buildings stop the kid', () => {
  const h = R.newHub();
  walk(h, 10, { x: 0, z: -1 });
  assert.ok(R.hubOpen(h.x, h.z) && h.z > 1.2, 'stopped at the top wall, z ' + h.z);
  assert.equal(R.hubWalkTo(h, 2.5, 2.5), false, 'cannot walk into the garage');
});

test('after a race the kid comes back standing on the garage pad', () => {
  const h = R.newHub('garage');
  assert.equal(R.hubStation(h), 'garage');
});
