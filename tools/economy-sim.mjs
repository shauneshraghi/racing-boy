// Economy simulation: a player who races the tracks in order, mostly winning, and upgrades the starter car toward
// each world's entry gate (every upgrade at the gate level, capped per car). Counts the races to each gate and the
// parts swaps (tradeParts) and coin exchanges (exchangeBuy) it needs on the way.
//
//   node tools/economy-sim.mjs [--seeds N] [--win p] [--pick f] [--mode swap|race|both]
//
// --seeds  runs to average over (default 20)
// --win    chance of winning a race (default 0.7; otherwise 2nd or 3rd)
// --pick   share of a track's road coins the player picks up (default 0.35)
// --mode   swap: swap or exchange parts as soon as that unblocks an upgrade; race: never swap or exchange,
//          just race on (a player who ignores the garage's swap and exchange); both (default)
//
// Also a module: tests/economy.test.mjs calls simulate().
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;

let SEEDS = 20, WIN = 0.7, PICK = 0.35;
export const GATES = [0, 2, 4, 5, 6];          // entry gate of each world: every upgrade at this level (tests/*.test.mjs)
const MAX_RACES = 400;
const NP = R.PARTS.length;
const CAR = R.START_CAR;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const roadCoins = {};
for (const id of Object.keys(R.TRACKS)) roadCoins[id] = R.track(id).coins.length * R.TRACKS[id].laps;

// the parts swaps (each one a tradeParts call, one click) that cover `need` from what the player holds, or null
function planSwaps(parts, need) {
  const p = parts.slice(), steps = [];
  for (let guard = 0; guard < 500; guard++) {
    let t = -1;
    for (let i = 0; i < NP; i++) if (p[i] < need[i]) { t = i; break; }
    if (t < 0) return steps;
    let k = -1;
    for (let i = t + 1; i < NP; i++) if (p[i] > need[i]) { k = i; break; }
    if (k >= 0) { p[k]--; p[k - 1] += R.PART_DOWN; steps.push([k, k - 1]); continue; }
    for (let i = t - 1; i >= 0; i--) if (p[i] - need[i] >= R.PART_UP) { k = i; break; }
    if (k < 0) return null;
    p[k] -= R.PART_UP; p[k + 1]++; steps.push([k, k + 1]);
  }
  return null;
}
// coins → parts at the exchange, when the logic has one: buy what is still short, keeping the upgrade's coins
function planExchange(s, need, keepCoins) {
  if (!R.exchangeBuy || !R.exchangeRate) return null;
  const buys = []; let coins = s.coins - keepCoins;
  for (let i = 0; i < NP; i++) {
    const short = need[i] - s.parts[i]; if (short <= 0) continue;
    const rate = R.exchangeRate(s, i); if (!rate) return null;
    coins -= short * rate.buy; buys.push([i, short]);
  }
  return coins >= 0 ? buys : null;
}

// next upgrade toward the gate: the lowest key below the target (UP_KEYS order on ties)
function nextKey(s, target) {
  const c = s.cars[CAR]; let best = null;
  for (const k of R.UP_KEYS) { const goal = Math.min(target, R.CARS[CAR].caps[k]); if (c.up[k] < goal && (!best || c.up[k] < c.up[best])) best = k; }
  return best;
}

function shop(s, target, allowSwap, stat) {
  for (;;) {
    const key = nextKey(s, target); if (!key) return;
    const cost = R.upgradeCost(s, CAR, key);
    if (R.canAfford(s, cost)) { R.buyUpgrade(s, CAR, key); continue; }
    if (!allowSwap || s.coins < cost.coins) return;
    const steps = planSwaps(s.parts, cost.parts);
    if (steps) { for (const [a, b] of steps) if (!R.tradeParts(s, a, b)) throw new Error('swap failed'); stat.swaps += steps.length; continue; }
    const buys = planExchange(s, cost.parts, cost.coins);
    if (buys) { for (const [i, n] of buys) { if (!R.exchangeBuy(s, i, n)) throw new Error('exchange failed'); stat.exch += 1; stat.exchParts += n; } continue; }
    return;
  }
}

function play(seed, allowSwap) {
  const s = R.newState(seed), roll = rng(seed * 31 + 7);
  const out = [];
  for (let w = 0; w < R.WORLDS.length; w++) {
    const W = R.WORLDS[w], target = w + 1 < GATES.length ? GATES[w + 1] : GATES[w];
    const stat = { races: 0, swaps: 0, exch: 0, exchParts: 0, coinsEarned: 0, partsEarned: new Array(NP).fill(0) };
    let farm = 0;
    for (;;) {
      const open = W.tracks.filter(t => s.best[t] !== 1);
      if (!open.length && !nextKey(s, target)) break;
      if (stat.races >= MAX_RACES) { stat.stuck = true; break; }
      const id = open.length ? open[0] : W.tracks[farm++ % W.tracks.length];
      const r = R.startRace(s, id), p = r.cars[0];
      const x = roll();
      p.place = x < WIN ? 1 : x < WIN + (1 - WIN) * 0.65 ? 2 : 3;
      p.finishT = 150; p.coins = Math.round(roadCoins[id] * PICK * (0.8 + 0.4 * roll()));
      const res = R.finishRace(s, r);
      stat.races++; stat.coinsEarned += res.coins;
      res.parts.forEach((n, i) => stat.partsEarned[i] += n);
      shop(s, target, allowSwap, stat);
    }
    stat.left = { coins: s.coins, parts: s.parts.slice() };
    out.push(stat);
    if (stat.stuck) break;
  }
  return out;
}

// per world: average races, swaps and exchanges to the next gate, runs that got stuck, and the raw runs
export function simulate({ seeds = 20, win = 0.7, pick = 0.35, swap = true } = {}) {
  SEEDS = seeds; WIN = win; PICK = pick;
  const runs = []; for (let i = 1; i <= SEEDS; i++) runs.push(play(i, swap));
  return R.WORLDS.map((W, w) => {
    const ws = runs.map(r => r[w]).filter(Boolean), avg = f => ws.length ? ws.reduce((a, x) => a + f(x), 0) / ws.length : NaN;
    return { world: W.id, races: avg(x => x.races), swaps: avg(x => x.swaps), exch: avg(x => x.exch), stuck: runs.filter(r => !r[w] || r[w].stuck).length };
  });
}

function summary(allowSwap) {
  const runs = []; for (let i = 1; i <= SEEDS; i++) runs.push(play(i, allowSwap));
  const rows = [];
  for (let w = 0; w < R.WORLDS.length; w++) {
    const ws = runs.map(r => r[w]).filter(Boolean);
    const avg = f => ws.length ? ws.reduce((a, x) => a + f(x), 0) / ws.length : NaN;
    const stuck = runs.filter(r => !r[w] || r[w].stuck).length;
    rows.push({
      world: R.WORLDS[w].id, goal: w + 1 < GATES.length ? 'lv ' + GATES[w + 1] : 'sweep',
      races: avg(x => x.races).toFixed(1), swaps: avg(x => x.swaps).toFixed(1), exch: avg(x => x.exch).toFixed(1),
      stuck: stuck ? stuck + '/' + SEEDS : '-',
      earned: avg(x => x.coinsEarned).toFixed(0) + ' / ' + R.PARTS.map((_, i) => avg(x => x.partsEarned[i]).toFixed(0)).join(','),
      left: avg(x => x.left.coins).toFixed(0) + ' / ' + R.PARTS.map((_, i) => avg(x => x.left.parts[i]).toFixed(0)).join(',')
    });
  }
  return rows;
}
function print(title, rows) {
  console.log('\n' + title);
  const cols = ['world', 'goal', 'races', 'swaps', 'exch', 'stuck', 'earned', 'left'];
  const head = { world: 'world', goal: 'goal', races: 'races', swaps: 'swaps', exch: 'exch', stuck: 'stuck', earned: 'earned coins / parts', left: 'held at gate coins / parts' };
  const wd = cols.map(c => Math.max(head[c].length, ...rows.map(r => String(r[c]).length)));
  const line = r => cols.map((c, i) => String(r[c]).padEnd(wd[i])).join('  ');
  console.log(line(head)); console.log(wd.map(n => '-'.repeat(n)).join('  '));
  rows.forEach(r => console.log(line(r)));
  const tot = k => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0).toFixed(1);
  console.log('total: races ' + tot('races') + ', swaps ' + tot('swaps') + ', exchanges ' + tot('exch'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
  SEEDS = Number(opt('--seeds', '20')); WIN = Number(opt('--win', '0.7')); PICK = Number(opt('--pick', '0.35'));
  const MODE = opt('--mode', 'both');
  console.log(`${CAR} to every world gate (levels ${GATES.slice(1).join(', ')}), ${SEEDS} runs, win ${WIN}, road coins picked ${PICK}; parts ${R.PARTS.map(p => p.id).join(', ')}`);
if (MODE !== 'race') print('Swaps and exchanges allowed (as soon as one unblocks an upgrade):', summary(true));
if (MODE !== 'swap') print(`Never swaps or exchanges (races on until it can pay; stuck = not through in ${MAX_RACES} races):`, summary(false));
}
