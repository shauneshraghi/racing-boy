// Plot a track's layout and check its crossovers: node tools/track-plot.mjs <trackId> [--out output/track-<id>.png]
// Prints lap length, height range, each place where two stretches come within 16 cells (the higher must be on a bridge
// and BRIDGE_CLEAR above the lower where their roads overlap), the bridge and drop spans, and a quick clean-bot lap time.
// Writes an SVG (and a PNG through the bundled Chrome when it can) coloured by height: bridges outlined in yellow, open
// edges in red, ramps and pads marked, u ticks every 0.05.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const args = process.argv.slice(2), id = args[0];
const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx);
const R = ctx.RB;
if (!id || !R.TRACKS[id]) { console.log('tracks: ' + Object.keys(R.TRACKS).join(' ')); process.exit(1); }
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : `output/track-${id}.png`;
const g = R.track(id), S = g.samples.slice(0, g.n), lim = g.hw + R.RUNOFF;
const ys = S.map(s => s.y), ymin = Math.min(...ys), ymax = Math.max(...ys);
console.log(`${id}: lap ${g.L.toFixed(0)} cells, ${R.TRACKS[id].laps} laps, height ${ymin.toFixed(1)}..${ymax.toFixed(1)}, max slope ${Math.max(...S.map(s => Math.abs(s.gy))).toFixed(2)}`);
const u = s => (s / g.L).toFixed(3);
g.bridges.forEach(b => console.log(`  bridge u ${u(b.s0)}-${u(b.s1)}${b.rail ? ' (rail)' : ' (open edges)'}`));
g.drops.forEach(b => console.log(`  drop u ${u(b.s0)}-${u(b.s1)} side ${b.side}`));
// crossings and near misses
const seen = [];
let bad = 0;
for (let i = 0; i < S.length; i += 2) for (let j = i + 2; j < S.length; j += 2) {
  const along = Math.min(Math.abs(S[i].s - S[j].s), g.L - Math.abs(S[i].s - S[j].s));
  if (along < 40) continue;
  const xz = Math.hypot(S[i].x - S[j].x, S[i].z - S[j].z);
  if (xz >= 16) continue;
  const hi = S[i].y > S[j].y ? S[i] : S[j], lo = hi === S[i] ? S[j] : S[i], dy = hi.y - lo.y;
  const ok = R.onBridge(g, hi.s) && dy >= (xz < 2 * lim + 1 ? R.BRIDGE_CLEAR : 2);
  if (!ok) bad++;
  const key = Math.round(hi.s / 6) + ':' + Math.round(lo.s / 6);
  if (!seen.includes(key) && (xz < 3 || !ok)) { seen.push(key); console.log(`  ${ok ? 'over ' : 'BAD  '} u ${u(hi.s)} (y ${hi.y.toFixed(1)}${R.onBridge(g, hi.s) ? ', bridge' : ''}) over u ${u(lo.s)} (y ${lo.y.toFixed(1)}): ${xz.toFixed(1)} apart, ${dy.toFixed(1)} up`); }
}
console.log(bad ? `  ${bad} sample pairs too close` : '  stretches clear');
// a quick lap with the clean bot (stock car, world-1 rivals don't matter here)
{
  const s = R.newState(3), r = R.startRace(s, id), p = r.cars[0];
  let falls = 0, rfalls = 0;
  while (!p.done && r.t < 400) {
    R.input(r, R.botInput(r, p, 'clean')); R.stepRace(r, 1 / 20);
    for (const e of r.events.splice(0)) if (e.type === 'fall') { if (e.car === 0) falls++; else rfalls++; }
  }
  console.log(`  clean stock bot: ${p.done ? p.finishT.toFixed(1) + ' s, place ' + p.place : 'did not finish'}, falls ${falls}, rival falls ${rfalls}`);
}
// SVG
const pad = 10, k = Math.min(900 / g.w, 900 / g.h), W = Math.ceil(g.w * k + 2 * pad), H = Math.ceil(g.h * k + 2 * pad);
const M = (x, z) => [(pad + (x - g.x0) * k).toFixed(1), (pad + (z - g.z0) * k).toFixed(1)];
const colour = y => { const t = (y - ymin) / Math.max(1, ymax - ymin); return `hsl(${(220 - 200 * t).toFixed(0)},70%,${(35 + 25 * t).toFixed(0)}%)`; };
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#1d2420"/>`;
const seg = (a, b, c, w) => { const p = M(a.x, a.z), q = M(b.x, b.z); return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`; };
// lower stretches first so bridges draw on top
const order = [...S.keys()].sort((a, b) => S[a].y - S[b].y);
for (const i of order) {
  const a = S[i], b = S[(i + 1) % S.length], deck = R.onBridge(g, a.s), w = 2 * g.hw * k;
  if (deck) svg += seg(a, b, '#ffe070', w + 6);
  const open = (g.limR[i] > 1e8 || g.limL[i] > 1e8) && !deck;
  if (open) svg += seg(a, b, '#ff3030', w + 4);
  svg += seg(a, b, colour(a.y), w);
}
for (let f = 0; f < 1; f += 0.05) { const p = R.pointAt(g, f * g.L, 0), q = M(p.x, p.z); svg += `<text x="${q[0]}" y="${q[1]}" fill="#fff" font-size="12" font-family="monospace" text-anchor="middle" dy="4">${f.toFixed(2).slice(1)}</text>`; }
g.ramps.forEach(m => { const q = M(m.x, m.z); svg += `<circle cx="${q[0]}" cy="${q[1]}" r="6" fill="${m.gap ? '#40c0ff' : '#ff9030'}" stroke="#000"/>`; });
g.pads.forEach(m => { const q = M(m.x, m.z); svg += `<rect x="${q[0] - 3}" y="${q[1] - 3}" width="6" height="6" fill="#ff40ff"/>`; });
const st = M(S[0].x, S[0].z); svg += `<circle cx="${st[0]}" cy="${st[1]}" r="8" fill="none" stroke="#fff" stroke-width="3"/>`;
svg += `<text x="12" y="22" fill="#fff" font-size="16" font-family="sans-serif">${R.TRACKS[id].name}: blue low → yellow high (${ymin.toFixed(0)}–${ymax.toFixed(0)}), yellow outline bridge, red open edge, orange ramp, cyan gap, pink pad</text></svg>`;
mkdirSync(out.replace(/[^/]*$/, '') || '.', { recursive: true });
const svgPath = out.replace(/\.png$/, '.svg');
writeFileSync(svgPath, svg);
try {
  const { chromium } = await import('playwright-core');
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch());
  const pg = await b.newPage({ viewport: { width: W, height: H } });
  await pg.setContent(svg); await pg.screenshot({ path: out }); await b.close();
  console.log('  wrote ' + out);
} catch (e) { console.log('  wrote ' + svgPath + ' (no PNG: ' + e.message.split('\n')[0] + ')'); }
