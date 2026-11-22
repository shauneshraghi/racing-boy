// Drift lab: drives an ideal drifting bot through every bend of the world-1 tracks and reports how the drift's
// turn envelope fits the bends. Run from the repo root:
//   node .claude/skills/drift-tune/drift-lab.mjs [--set NAME=value,...] [--car pip] [--mode stick|keys|hands] [--tracks meadow,creek] [--v 9]
// --set overrides tuning vars at the top of js/logic.js for this run only (e.g. --set DRIFT_TURN=0.8,DRIFT_WIDE=0.2).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? a.concat([[x.slice(2), all[i + 1]]]) : a), []));
let src = readFileSync(new URL('../../../js/logic.js', import.meta.url), 'utf8');
const sets = (args.set || '').split(/,(?![^\[]*\])/).filter(Boolean).map(kv => kv.split('='));
for (const [name, val] of sets) {
  const re = new RegExp('\\b' + name + ' = (\\[[^\\]]*\\]|[^,;]+)');
  if (!re.test(src)) { console.error('no tuning var ' + name); process.exit(1); }
  src = src.replace(re, name + ' = ' + val);
}
const num = name => { const m = src.match(new RegExp('\\b' + name + ' = ([-\\d.]+)')); return m ? +m[1] : NaN; };
const K = { TURN: num('DRIFT_TURN'), WIDE: num('DRIFT_WIDE'), HOP_T: num('HOP_T'), SLIDE: num('DRIFT_SLIDE'), RUNOFF: num('RUNOFF') };
const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx, { filename: 'js/logic.js' });
const R = ctx.RB, DT = R.DT, angDiff = R.angDiff, clamp = R.clamp;
const tracks = (args.tracks || R.WORLDS[0].tracks.join(',')).split(',');
const carId = args.car || R.START_CAR;
const mode = args.mode || "stick"; // stick (analog), keys (-1/0/+1 eased, like desktop), hands (stick let go once drifting)

// bends: same-sign runs of curvature over ~1/40 per cell (radius under 40 cells) that turn at least 35°
function bends(g) {
  const out = []; let cur = null;
  for (const p of g.samples.slice(0, g.n)) {
    const dir = Math.abs(p.k) > 0.025 ? Math.sign(p.k) : 0;
    if (cur && (dir !== cur.dir || !dir)) { if (dir !== cur.dir) { out.push(cur); cur = null; } }
    if (dir && !cur) cur = { dir, s0: p.s, s1: p.s, ang: 0, kmax: 0, ks: [] };
    if (cur && dir) { cur.s1 = p.s; cur.ang += Math.abs(p.k) * 0.5; cur.kmax = Math.max(cur.kmax, Math.abs(p.k)); cur.ks.push(Math.abs(p.k)); }
  }
  if (cur) out.push(cur);
  // merge a bend split by a short dip, and one wrapping past the start
  const m = [];
  for (const b of out) { const l = m[m.length - 1]; if (l && l.dir === b.dir && b.s0 - l.s1 < 3) { l.s1 = b.s1; l.ang += b.ang; l.kmax = Math.max(l.kmax, b.kmax); l.ks.push(...b.ks); } else m.push(b); }
  return m.filter(b => b.ang > 35 * Math.PI / 180).map(b => ({ ...b, kmean: b.ks.reduce((a, x) => a + x, 0) / b.ks.length }));
}
function freshRace(id) {
  const s = R.newState(3);
  if (carId !== s.car) { s.owned.push(carId); s.cars[carId] = R._newCar(carId); s.car = carId; }
  const r = R.startRace(s, id, { noAI: true }); r.phase = 'race'; return r;
}
const inBend = (g, s, b, lead) => { const a = ((s - (b.s0 - lead)) % g.L + g.L) % g.L; return a <= b.s1 - b.s0 + lead; };

// one run of two laps; with drift, the bot hops before each bend and drifts it, steering by pure pursuit and inverting
// the drift turn model to pick the stick. Returns the second lap's time and per-bend stats.
function run(id, drift) {
  const r = freshRace(id), g = r.g, p = r.cars[0], bs = bends(g), st = p.stats;
  const stats = bs.map(() => ({ n: 0, u: 0, against: 0, into: 0, dmax: 0, off: 0, wall: 0, tier: 0, drifted: 0 }));
  let lap1 = null, active = -1, t = 0;
  while (p.prog < 2 * g.L && t < 300) {
    const look = 3 + p.v * 0.35, aim = R.pointAt(g, p.s + look, 0);
    const alpha = angDiff(Math.atan2(aim.z - p.z, aim.x - p.x), p.h), plain = clamp(alpha * 2.5, -1, 1);
    const lead = p.v * K.HOP_T + 1;
    const bi = drift ? bs.findIndex(b => inBend(g, p.s, b, lead)) : -1;
    if (active >= 0 && bi !== active) { stats[active].tier = Math.max(stats[active].tier, tierOf(p.drift)); }
    active = bi;
    let inp = { steer: plain };
    if (bi >= 0) {
      const b = bs[bi], S = stats[bi];
      if (!p.driftDir) inp = { steer: b.dir, drift: true };
      else {
        const rate = st.grip * Math.min(1, p.v / 4), Ld = Math.max(1, Math.hypot(aim.x - p.x, aim.z - p.z));
        const want = 2 * p.v * Math.sin(alpha) / Ld; // pure-pursuit yaw rate
        const ud = clamp(2 * ((want * p.driftDir / rate - K.WIDE) / (K.TURN - K.WIDE)) - 1, -1, 1); // +1 into, -1 against
        const key = mode === "hands" ? 0 : mode === "keys" ? (ud < -0.33 ? -1 : ud > 0.33 ? 1 : 0) : ud; // keys: -1/0/+1, eased
        inp = { steer: key * p.driftDir, drift: true, ease: mode === "keys" };
        S.n++; S.u += ud; if (ud <= -0.95) S.against++; if (ud >= 0.95) S.into++; S.drifted = 1; // ud is what the ideal driver wants
      }
      const d = Math.abs(g.query(p.x, p.z).d);
      S.dmax = Math.max(S.dmax, d); if (d > g.hw) S.off += DT; if (d > g.hw + K.RUNOFF - 0.7) S.wall++;
    }
    R.input(r, inp); R.stepRace(r, DT); t += DT;
    if (lap1 === null && p.prog >= g.L) lap1 = t;
  }
  return { bs, stats, lap: t - lap1, st };
}
const tierOf = c => R.DRIFT_TIERS.filter(x => c >= x).length;

console.log(`car ${carId}  mode ${mode}  DRIFT_TURN ${K.TURN}  DRIFT_WIDE ${K.WIDE}  DRIFT_SLIDE ${K.SLIDE}` + (sets.length ? '  (overrides: ' + args.set + ')' : ''));
const f = (x, n = 2) => x.toFixed(n).padStart(5);
let all = { n: 0, u: 0, against: 0, into: 0, off: 0, wall: 0 }, worst = 0;
for (const id of tracks) {
  const clean = run(id, false), dr = run(id, true), g = R.track(id), st = dr.st;
  const v = +(args.v || st.speed), rate = st.grip * Math.min(1, v / 4);
  const env = [K.WIDE, (K.WIDE + K.TURN) / 2, K.TURN].map(m => rate * m);
  console.log(`\n${id}  hw ${g.hw}  lap clean ${clean.lap.toFixed(2)} s, drifting ${dr.lap.toFixed(2)} s (${(dr.lap - clean.lap >= 0 ? '+' : '') + (dr.lap - clean.lap).toFixed(2)})`);
  console.log(`  drift yaw at ${v} c/s: wide ${f(env[0])}  neutral ${f(env[1])}  tight ${f(env[2])} rad/s  -> radius ${f(v / env[0], 1)} ${f(v / env[1], 1)} ${f(v / env[2], 1)} cells`);
  console.log('  bend   s0-s1     turn  Rmin  Rmean  need   fit      stick  against into  max|d|/hw  off s  wall  tier');
  dr.bs.forEach((b, i) => {
    const S = dr.stats[i], need = b.kmean * v;
    const fit = need < env[0] ? 'TOO TIGHT' : need > env[2] ? 'too wide' : need < env[1] ? 'wide side' : 'tight side';
    const u = S.n ? S.u / S.n : 0;
    console.log(`  ${String(i + 1).padStart(2)} ${b.dir > 0 ? 'R' : 'L'} ${f(b.s0, 0)}-${f(b.s1, 0).trim().padEnd(4)} ${f(b.ang * 180 / Math.PI, 0)}° ${f(1 / b.kmax, 1)} ${f(1 / b.kmean, 1)} ${f(need)}  ${fit.padEnd(10)} ${f(u)}  ${f(100 * S.against / Math.max(1, S.n), 0)}% ${f(100 * S.into / Math.max(1, S.n), 0)}%  ${f(S.dmax / g.hw)}     ${f(S.off, 1)}  ${String(S.wall).padStart(4)}  ${S.tier}`);
    all.n += S.n; all.u += S.u; all.against += S.against; all.into += S.into; all.off += S.off; all.wall += S.wall; worst = Math.max(worst, S.dmax / g.hw);
  });
}
console.log(`\nALL  mean stick ${(all.u / all.n).toFixed(2)} (+1 into, -1 against)  pinned against ${(100 * all.against / all.n).toFixed(0)}%  pinned into ${(100 * all.into / all.n).toFixed(0)}%  off-road ${all.off.toFixed(1)} s  wall steps ${all.wall}  worst |d|/hw ${worst.toFixed(2)}`);
