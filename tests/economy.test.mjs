// Tests for the upgrade economy: upgrade costs draw on the part tier the world in progress pays, a player who just
// races and upgrades seldom needs the parts swap or the coin exchange, and the exchange buys and sells parts for coins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { simulate, GATES } from '../tools/economy-sim.mjs';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;

function costAt(level, carId = R.START_CAR) {
  const s = R.newState(1);
  if (carId !== R.START_CAR) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); }
  for (const k of R.UP_KEYS) s.cars[carId].up[k] = 0;
  s.cars[carId].up.engine = level;
  return R.upgradeCost(s, carId, 'engine');
}
const tiersOf = cost => [...cost.parts].map((n, i) => n ? i : -1).filter(i => i >= 0);

test('each upgrade level costs one part tier: the one the world where it is bought pays', () => {
  // levels bought in world w (from its entry gate up to the next world's gate) cost only world w's parts
  for (let w = 0; w + 1 < GATES.length; w++) {
    for (let lv = GATES[w]; lv < GATES[w + 1]; lv++) assert.deepEqual(tiersOf(costAt(lv, 'nova')), [w], `level ${lv + 1}: ${JSON.stringify(costAt(lv, 'nova').parts)}`);
  }
  // past the moon gate: crystals, the moon's parts
  for (let lv = GATES[GATES.length - 1]; lv < R.CARS.nova.caps.engine; lv++) assert.deepEqual(tiersOf(costAt(lv, 'nova')), [R.PARTS.length - 1]);
  // within a tier the count never falls as the level rises
  for (let lv = 1; lv < R.CARS.nova.caps.engine; lv++) {
    const a = costAt(lv - 1, 'nova'), b = costAt(lv, 'nova'), t = tiersOf(b)[0];
    if (tiersOf(a)[0] === t) assert.ok(b.parts[t] >= a.parts[t], 'level ' + (lv + 1));
  }
});

test('a player who races and upgrades needs no swap or exchange in worlds 1-2 and only a few in the whole game', () => {
  const runs = simulate({ seeds: 20 });
  for (const w of runs.slice(0, 2)) assert.equal(w.swaps + w.exch, 0, JSON.stringify(w));
  const total = runs.reduce((a, w) => a + w.swaps + w.exch, 0);
  assert.ok(total <= 3, 'swaps and exchanges in the whole game ' + total.toFixed(1));
  // the grind stays about what it was before the rebalance (27.5 races to sweep the moon, 5-8 a world)
  const races = runs.reduce((a, w) => a + w.races, 0);
  assert.ok(races >= 22 && races <= 34, 'races ' + races.toFixed(1));
  for (const w of runs) assert.ok(w.races >= 3 && w.races <= 10, JSON.stringify(w));
});

test('a player who never swaps or exchanges still gets through every gate', () => {
  const runs = simulate({ seeds: 10, swap: false });
  for (const w of runs) assert.equal(w.stuck, 0, JSON.stringify(w));
  const races = runs.reduce((a, w) => a + w.races, 0);
  assert.ok(races <= 40, 'races ' + races.toFixed(1));
});

test('the exchange buys parts of a reached tier for coins and sells any held parts for fewer coins', () => {
  const s = R.newState(1);
  s.coins = 1000; s.parts = [0, 0, 0, 0, 0];
  const bolt = R.exchangeRate(s, 0);
  assert.ok(bolt.buy > 0 && bolt.sell > 0 && bolt.sell < bolt.buy, JSON.stringify(bolt));
  assert.ok(R.exchangeBuy(s, 0, 2));
  assert.equal(s.coins, 1000 - 2 * bolt.buy); assert.equal(s.parts[0], 2);
  assert.ok(R.exchangeSell(s, 0, 1));
  assert.equal(s.coins, 1000 - 2 * bolt.buy + bolt.sell); assert.equal(s.parts[0], 1);
  assert.ok(!R.exchangeSell(s, 0, 2), 'cannot sell parts you do not hold');
  assert.ok(!R.exchangeSell(s, 1, 1));
  s.coins = bolt.buy - 1;
  assert.ok(!R.exchangeBuy(s, 0, 1), 'cannot buy without the coins');
  assert.equal(s.parts[0], 1);
  for (const bad of [[-1, 1], [R.PARTS.length, 1], [0, 0], [0, -2], [0, 1.5], [0, NaN]]) {
    assert.ok(!R.exchangeBuy(s, ...bad) && !R.exchangeSell(s, ...bad), JSON.stringify(bad));
  }
});

test('the exchange only sells tiers of worlds the player has opened', () => {
  const s = R.newState(1); s.coins = 1e6;
  assert.equal(R.exchangeTop(s), 0);
  assert.ok(R.exchangeRate(s, 0).buy > 0);
  assert.equal(R.exchangeRate(s, 1).buy, null, 'gears are not for sale before the canyon');
  assert.ok(!R.exchangeBuy(s, 1, 1));
  s.parts[1] = 3; assert.ok(R.exchangeSell(s, 1, 1), 'held gears can still be sold');
  for (const t of R.WORLDS[0].tracks) s.best[t] = 1;
  assert.equal(R.exchangeTop(s), 1);
  assert.ok(R.exchangeBuy(s, 1, 1));
  for (let w = 1; w < R.WORLDS.length - 1; w++) for (const t of R.WORLDS[w].tracks) s.best[t] = 1;
  assert.equal(R.exchangeTop(s), R.PARTS.length - 1);
});

test('exchange rates: a convenience, dearer than racing, never a profit with the swap', () => {
  const s = R.newState(1);
  for (const w of R.WORLDS) for (const t of w.tracks) s.best[t] = 1;
  const rate = R.PARTS.map((_, i) => R.exchangeRate(s, i));
  for (let i = 0; i < rate.length; i++) {
    assert.ok(rate[i].sell < rate[i].buy, 'sell below buy');
    assert.ok(rate[i].sell * 3 <= rate[i].buy, 'selling pays a third of the price or less');
    if (i > 0) {
      assert.ok(rate[i].buy > rate[i - 1].buy, 'higher tiers cost more');
      assert.ok(R.PART_DOWN * rate[i - 1].sell < rate[i].buy, 'buy, break down, sell is a loss');
      assert.ok(rate[i].sell < R.PART_UP * rate[i - 1].buy, 'buy, swap up, sell is a loss');
    }
    // a part bought costs more than the race money that comes with one: a world-w win pays PART_PAY[0] parts
    // of tier w alongside its coins
    const W = R.WORLDS[Math.min(i, R.WORLDS.length - 1)];
    assert.ok(rate[i].buy * R.PART_PAY[0] > R.PLACE_PAY[0] * W.pay, `tier ${i} ${rate[i].buy}`);
  }
});

test('the exchange keeps the save format: an old save loads and trades', () => {
  const s = R.newState(1); s.coins = 500; s.parts = [5, 2, 0, 0, 0];
  const raw = JSON.parse(R.serialize(s));
  assert.equal(raw.v, 1);
  const back = R.deserialize(JSON.stringify(raw));
  assert.ok(R.exchangeSell(back, 1, 2));
  assert.ok(R.exchangeBuy(back, 0, 1));
  const again = R.deserialize(R.serialize(back));
  assert.deepEqual([...again.parts], [...back.parts]); assert.equal(again.coins, back.coins);
});
