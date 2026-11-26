// make-icons.mjs: draws the app icons in code and writes PNGs (no dependencies).
// Usage: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../icons/', import.meta.url));
mkdirSync(out, { recursive: true });

const crcT = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type), len = Buffer.alloc(4), cr = Buffer.alloc(4);
  len.writeUInt32BE(data.length); cr.writeUInt32BE(crc(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, cr]);
}
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

const segD = (ax, ay, bx, by, x, y) => { const dx = bx - ax, dy = by - ay; let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy); t = Math.max(0, Math.min(1, t)); return Math.hypot(x - ax - t * dx, y - ay - t * dy); };
const box = (x, y, x0, y0, x1, y1, r = 0) => { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, qx = Math.abs(x - cx) - ((x1 - x0) / 2 - r), qy = Math.abs(y - cy) - ((y1 - y0) / 2 - r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };

const C = {
  bgTop: hex('#3a2c5c'), bgBot: hex('#14101c'), glow: hex('#ff9f1c'), outline: hex('#120c1c'),
  road: hex('#4a4458'), roadD: hex('#38334a'), line: hex('#fff7e8'), kerbR: hex('#e8433a'), kerbW: hex('#f4efe6'),
  red: hex('#e8433a'), redL: hex('#ff7a5c'), redD: hex('#9e2228'), tyre: hex('#1c1822'), rim: hex('#8a8698'),
  gold: hex('#ffd23f'), goldD: hex('#d9961a'), visor: hex('#2a3a5c'), visorL: hex('#7fa8e0'),
};

// The kart from behind on a road running to the horizon, under a checkered banner.
function art(x, y) {
  // checkered banner across the top
  if (y > 0.14 && y < 0.27 && x > 0.12 && x < 0.88) {
    const wave = 0.012 * Math.sin(x * 14);
    const yy = y - wave;
    if (yy > 0.15 && yy < 0.26) return ((Math.floor((x - 0.12) / 0.0475) + Math.floor((yy - 0.15) / 0.055)) & 1) ? C.outline : C.line;
    if (yy > 0.14 && yy < 0.27) return C.outline;
  }
  // kart, drawn over the road
  // helmet
  const hd = Math.hypot(x - 0.5, (y - 0.47) * 1.05);
  if (hd < 0.105) {
    if (y > 0.47 && y < 0.52 && Math.abs(x - 0.5) < 0.085) return x < 0.47 ? C.visorL : C.visor;
    return (x < 0.47 && y < 0.44) ? mix(C.gold, [255, 255, 255], 0.4) : (x > 0.53 ? C.goldD : C.gold);
  }
  if (hd < 0.122) return C.outline;
  // spoiler
  let d = box(x, y, 0.26, 0.555, 0.74, 0.595, 0.012);
  if (d < 0) return y < 0.57 ? C.redL : C.red;
  if (d < 0.016) return C.outline;
  // wheels
  for (const s of [-1, 1]) {
    d = box(x, y, 0.5 + s * 0.2 - 0.075, 0.6, 0.5 + s * 0.2 + 0.075, 0.8, 0.03);
    if (d < 0) return Math.abs(x - (0.5 + s * 0.2)) < 0.03 && y > 0.66 && y < 0.74 ? C.rim : (((y * 60) | 0) & 1 ? C.tyre : mix(C.tyre, [0, 0, 0], 0.4));
    if (d < 0.016) return C.outline;
  }
  // body
  d = box(x, y, 0.33, 0.6, 0.67, 0.77, 0.03);
  if (d < 0) {
    if (Math.abs(x - 0.44) < 0.022 && y > 0.735) return C.tyre; // exhausts
    if (Math.abs(x - 0.56) < 0.022 && y > 0.735) return C.tyre;
    return y < 0.64 ? C.redL : (y > 0.71 ? C.redD : C.red);
  }
  if (d < 0.016) return C.outline;
  // flames out of the exhausts
  for (const ex of [0.44, 0.56]) {
    const fd = Math.hypot((x - ex) * 1.6, y - 0.81);
    if (y > 0.77 && fd < 0.05) return fd < 0.025 ? C.gold : C.glow;
  }
  // road: a trapezoid from the horizon to the bottom edge
  if (y > 0.3) {
    const t = (y - 0.3) / 0.7, half = 0.06 + t * 0.44;
    const off = Math.abs(x - 0.5);
    if (off < half) {
      const kerb = half - off < 0.02 + t * 0.05;
      if (kerb) return (Math.floor(Math.pow(t, 0.5) * 14) & 1) ? C.kerbR : C.kerbW;
      if (off < 0.004 + t * 0.012 && (Math.floor(Math.pow(t, 0.5) * 10) & 1)) return C.line;
      return mix(C.roadD, C.road, t);
    }
  }
  return null;
}

function render(size, { maskable = false, scale = 1, radius = 0.2 }) {
  const SS = 3, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const u = (px + (sx + 0.5) / SS) / size, v = (py + (sy + 0.5) / SS) / size;
      if (!maskable) { // rounded rect
        const qx = Math.abs(u - 0.5) - (0.5 - radius), qy = Math.abs(v - 0.5) - (0.5 - radius);
        if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) > radius) continue;
      }
      let col = mix(C.bgTop, C.bgBot, v);
      const au = (u - 0.5) / scale + 0.5, av = (v - 0.5) / scale + 0.5;
      const glow = Math.max(0, 1 - Math.hypot(au - 0.5, (av - 0.33) * 1.6) / 0.45);
      col = mix(col, C.glow, glow * glow * 0.45);
      const c = art(au, av);
      if (c) col = c;
      r += col[0]; g += col[1]; b += col[2]; a += 255;
    }
    const n = SS * SS, o = (py * size + px) * 4;
    if (a > 0) { const k = a / 255; buf[o] = r / k; buf[o + 1] = g / k; buf[o + 2] = b / k; }
    buf[o + 3] = a / n;
  }
  return png(size, size, buf);
}

const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true, scale: 0.8 }],
  ['apple-touch-icon.png', 180, { maskable: true, scale: 0.92 }], // iOS rounds the corners itself
  ['favicon-32.png', 32, { radius: 0.18 }],
];
for (const [name, size, o] of jobs) { writeFileSync(out + name, render(size, o)); console.log('wrote icons/' + name); }
