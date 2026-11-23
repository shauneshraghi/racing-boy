// Print the lap fraction u of each control point of a track (or of a pts list given as JSON): node tools/track-u.mjs <id> ['[[x,z],...]' [scale]]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx = {}; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx);
const R = ctx.RB, [id, pj, sc] = process.argv.slice(2);
if (pj) { R.TRACKS[id] = Object.assign({}, R.TRACKS[id] || { name: id, world: 0, laps: 3, hw: 3.6, pads: [], ramps: [], boxes: [], coins: [] }, { pts: JSON.parse(pj), scale: sc ? +sc : (R.TRACKS[id] || {}).scale || 1, elev: [], bridges: [], drops: [] }); }
const g = R.track(id), T = R.TRACKS[id], k = T.scale || 1;
console.log(`lap ${g.L.toFixed(0)} cells`);
T.pts.forEach((p, i) => {
  let best = 1e9, bs = 0;
  for (const s of g.samples) { const d = Math.hypot(s.x - p[0] * k, s.z - p[1] * k); if (d < best) { best = d; bs = s.s; } }
  console.log(`  pt ${i} [${p}] u ${(bs / g.L).toFixed(3)}`);
});
