// Racing Boy: static 3D worlds for the three.js renderer (RB3DWorld). Builds a race track's scene from RB.track()
// geometry (terrain that is flat wherever the logic lets a car drive, the asphalt ribbon, kerbs, start gantry, boost
// pads, ramps shaped like the logic's ramp profile, creeks in the jump gaps, walls where the logic bounces cars,
// trees, buildings and far hills under a shader sky) and the garage plaza from RB.HUB. Textures are drawn in code on
// canvases; static scenery is merged per material and per map chunk so the draw calls stay low.
var RB3DWorld = (function () {
  'use strict';
  var D = RB, ANISO = 8, CH = 64; // chunk size (cells) for merged scenery and terrain
  var TIME = { value: 0 };        // shared time uniform (wind, water)

  // ---------- maths ----------
  function prng(seed) { var a = seed | 0; return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hash(ix, iz, seed) {
    var h = (Math.imul(ix | 0, 374761393) + Math.imul(iz | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z, seed, px, pz) {
    var ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    var x0 = ix, x1 = ix + 1, z0 = iz, z1 = iz + 1;
    if (px) { x0 = ((x0 % px) + px) % px; x1 = ((x1 % px) + px) % px; }
    if (pz) { z0 = ((z0 % pz) + pz) % pz; z1 = ((z1 % pz) + pz) % pz; }
    var a = hash(x0, z0, seed), b = hash(x1, z0, seed), c = hash(x0, z1, seed), d = hash(x1, z1, seed);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }
  // fractal noise 0..1; px, pz = lattice period of the first octave (0 = no wrap) for tiling textures
  function fbm(x, z, oct, seed, px, pz) {
    var s = 0, amp = 0.5, f = 1, n = 0;
    for (var i = 0; i < oct; i++) { s += amp * vnoise(x * f, z * f, seed + i * 17, px ? px * f : 0, pz ? pz * f : 0); n += amp; amp *= 0.5; f *= 2; }
    return s / n;
  }
  function col(hex) { return new THREE.Color(hex); }
  function mixC(a, b, t) { return a.clone().lerp(b, t); }

  // ---------- canvas textures ----------
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  // fill a canvas per pixel: fn(x, y, out) writes r, g, b (0..255) and optionally a into out
  function pix(w, h, fn) {
    var c = canvas(w, h), x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data, o = [0, 0, 0, 255];
    for (var y = 0; y < h; y++) for (var i = 0; i < w; i++) { o[3] = 255; fn(i, y, o); var k = (y * w + i) * 4; d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = o[3]; }
    x.putImageData(img, 0, 0); return c;
  }
  // a tangent-space normal map from a height field (Float32Array w*h, wraps)
  function normalCanvas(hf, w, h, k) {
    return pix(w, h, function (x, y, o) {
      var l = hf[y * w + (x - 1 + w) % w], r = hf[y * w + (x + 1) % w], u = hf[((y - 1 + h) % h) * w + x], dn = hf[((y + 1) % h) * w + x];
      var nx = (l - r) * k, ny = (dn - u) * k, nz = 1, L = Math.sqrt(nx * nx + ny * ny + 1);
      o[0] = (nx / L * 0.5 + 0.5) * 255; o[1] = (ny / L * 0.5 + 0.5) * 255; o[2] = (nz / L * 0.5 + 0.5) * 255;
    });
  }
  function meanOf(c) {
    var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, s = [0, 0, 0], n = 0;
    for (var i = 0; i < d.length; i += 16) { for (var k = 0; k < 3; k++) { var v = d[i + k] / 255; s[k] += v < 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } n++; }
    return new THREE.Vector3(s[0] / n, s[1] / n, s[2] / n);
  }
  function toTex(c, srgb, clampU) {
    var t = new THREE.CanvasTexture(c);
    if (srgb) t.userData.mean = meanOf(c);
    t.wrapS = clampU ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = ANISO; t.needsUpdate = true;
    return t;
  }
  var TX = {};
  function T(name) { if (!TX[name]) TX[name] = MAKE[name](); return TX[name]; }
  // wraps strokes drawn near an edge so a tile repeats seamlessly
  function wrapDraw(w, h, x, y, r, fn) { for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) { if (ox && (x + ox * w < -r || x + ox * w > w + r)) continue; if (oy && (y + oy * h < -r || y + oy * h > h + r)) continue; fn(x + ox * w, y + oy * h); } }

  var MAKE = {
    // meadow grass seen from above: tufts of blades in many greens over darker soil, tiles every 4 cells
    grass: function () {
      var N = 512, c = pix(N, N, function (x, y, o) {
        var n = fbm(x / N * 6, y / N * 6, 4, 3, 6, 6), m = fbm(x / N * 24, y / N * 24, 2, 9, 24, 24);
        o[0] = 58 + 40 * n + 14 * m; o[1] = 92 + 48 * n + 16 * m; o[2] = 30 + 18 * n;
      }), x = c.getContext('2d'), r = prng(5);
      x.lineCap = 'round';
      for (var i = 0; i < 9000; i++) {
        var bx = r() * N, by = r() * N, len = 3 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 1.6, lt = r();
        var g = Math.round(95 + 90 * lt), rr = Math.round(50 + 60 * lt * r()), bb = Math.round(25 + 30 * lt);
        x.strokeStyle = 'rgba(' + rr + ',' + g + ',' + bb + ',' + (0.55 + 0.4 * r()) + ')'; x.lineWidth = 1 + r() * 1.3;
        wrapDraw(N, N, bx, by, 12, function (px, py) { x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); x.stroke(); });
      }
      // a few tiny flowers and clover
      for (i = 0; i < 160; i++) { var fx = r() * N, fy = r() * N, fc = ['#f4f1e4', '#f6dc5a', '#e9b8d8', '#ffffff'][i % 4]; x.fillStyle = fc; wrapDraw(N, N, fx, fy, 3, function (px, py) { x.beginPath(); x.arc(px, py, 1.2 + r(), 0, 6.3); x.fill(); }); }
      return toTex(c, true);
    },
    sand: function () {
      var N = 512, hf = new Float32Array(N * N);
      var c = pix(N, N, function (x, y, o) {
        var n = fbm(x / N * 5, y / N * 5, 4, 21, 5, 5), w = fbm(x / N * 3, y / N * 3, 2, 23, 3, 3);
        var rip = Math.sin((y / N * 26 + w * 6 + x / N * 2) * Math.PI * 2) * 0.5 + 0.5, gr = hash(x, y, 7);
        hf[y * N + x] = rip * 0.6 + n * 0.4;
        var v = 0.82 + 0.12 * n + 0.07 * rip + 0.06 * (gr - 0.5);
        o[0] = 226 * v; o[1] = 178 * v; o[2] = 120 * v;
      });
      TX.sandN = toTex(normalCanvas(hf, N, N, 2.2));
      return toTex(c, true);
    },
    sandN: function () { T('sand'); return TX.sandN; },
    dirt: function () {
      var N = 256, c = pix(N, N, function (x, y, o) {
        var n = fbm(x / N * 6, y / N * 6, 4, 31, 6, 6), gr = hash(x, y, 3), v = 0.75 + 0.25 * n + 0.1 * (gr - 0.5);
        if (gr > 0.985) v *= 1.35; if (gr < 0.02) v *= 0.6;
        o[0] = 150 * v; o[1] = 118 * v; o[2] = 84 * v;
      });
      return toTex(c, true);
    },
    // water ripples: a tiling normal map
    waterN: function () {
      var N = 256, hf = new Float32Array(N * N);
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) hf[y * N + x] = fbm(x / N * 8, y / N * 8, 4, 41, 8, 8);
      return toTex(normalCanvas(hf, N, N, 5));
    },
    bark: function () {
      var N = 128, c = pix(N, N, function (x, y, o) {
        var n = fbm(x / N * 12, y / N * 2, 3, 51, 12, 2), s = fbm(x / N * 24, y / N * 6, 2, 53, 24, 6);
        var v = 0.55 + 0.35 * n - 0.25 * Math.pow(Math.abs(Math.sin((x / N * 9 + n * 1.5) * Math.PI)), 6) + 0.1 * s;
        o[0] = 200 * v; o[1] = 185 * v; o[2] = 170 * v;
      });
      return toTex(c, true);
    },
    // foliage atlas: top-left and top-right leaf clusters (alpha), bottom-left a palm frond, bottom-right opaque leaves
    foliage: function () {
      var N = 512, c = canvas(N, N), x = c.getContext('2d'), r = prng(61);
      function leaf(px, py, len, wid, ang, fill) { x.save(); x.translate(px, py); x.rotate(ang); x.fillStyle = fill; x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(len * 0.5, -wid, len, 0); x.quadraticCurveTo(len * 0.5, wid, 0, 0); x.fill(); x.restore(); }
      function shade(lt) { var g = Math.round(95 + 160 * lt), rr = Math.round(90 + 150 * lt), b = Math.round(70 + 120 * lt); return 'rgb(' + rr + ',' + g + ',' + b + ')'; }
      // opaque leaves, bottom right
      x.fillStyle = '#7a7a66'; x.fillRect(256, 256, 128, 256);
      x.save(); x.beginPath(); x.rect(256, 256, 128, 256); x.clip();
      for (var i = 0; i < 800; i++) leaf(256 + r() * 128, 256 + r() * 256, 8 + r() * 8, 3 + r() * 2.5, r() * 6.3, shade(0.25 + r() * 0.75));
      x.restore();
      // bark, bottom right: vertical ridges
      var bk = x.getImageData(384, 256, 128, 256);
      for (var by = 0; by < 256; by++) for (var bx = 0; bx < 128; bx++) {
        var nb = fbm(bx / 128 * 10, by / 256 * 3, 3, 51, 10, 3), rid = Math.pow(Math.abs(Math.sin((bx / 128 * 8 + nb * 1.5) * Math.PI)), 5), v = 150 + 70 * nb - 80 * rid, kk = (by * 128 + bx) * 4;
        bk.data[kk] = v; bk.data[kk + 1] = v * 0.94; bk.data[kk + 2] = v * 0.86; bk.data[kk + 3] = 255;
      }
      x.putImageData(bk, 384, 256);
      // two leaf clusters with alpha (cards round a canopy)
      [[128, 128, 1], [384, 128, 2]].forEach(function (cc) {
        var cx = cc[0], cy = cc[1];
        // a dense, rounded clump with a ragged edge; lighter toward the top
        for (var k = 0; k < 1300; k++) {
          var a = r() * 6.3, edge = 100 + 22 * Math.sin(a * 5 + cc[2]) + 10 * Math.sin(a * 11), d = Math.sqrt(r()) * edge, px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
          var lt = 0.2 + 0.5 * r() + 0.3 * (cy - py) / 120 - 0.15 * (d / edge) * r();
          leaf(px, py, (cc[2] === 1 ? 13 : 10) + r() * 8, (cc[2] === 1 ? 5 : 3.8) + r() * 2.5, a + (r() - 0.5) * 2.4, shade(clamp(lt, 0, 1)));
        }
        // a few twigs
        x.strokeStyle = 'rgba(80,60,40,0.8)'; x.lineWidth = 2;
        for (k = 0; k < 6; k++) { var ta = r() * 6.3; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(ta) * 70, cy + Math.sin(ta) * 70); x.stroke(); }
      });
      // palm frond: a curved midrib with long leaflets, bottom left (pointing right, root at the left)
      x.save(); x.beginPath(); x.rect(0, 256, 256, 128); x.clip();
      var y0 = 320;
      for (i = 0; i < 70; i++) {
        var f = i / 70, px = 8 + f * 240, w = Math.sin(Math.PI * Math.min(1, f * 1.15)) * 1;
        [-1, 1].forEach(function (sd) {
          x.strokeStyle = shade(0.35 + 0.5 * r()); x.lineWidth = 2.6;
          x.beginPath(); x.moveTo(px, y0); x.quadraticCurveTo(px + 12, y0 + sd * 22 * w, px + 18, y0 + sd * 58 * w); x.stroke();
        });
      }
      x.strokeStyle = '#9a8a5a'; x.lineWidth = 3; x.beginPath(); x.moveTo(4, y0); x.lineTo(252, y0); x.stroke();
      x.restore();
      // a pine sprig: a twig with dense needles, root at the left
      x.save(); x.beginPath(); x.rect(0, 384, 256, 128); x.clip();
      var y1 = 448;
      for (i = 0; i < 900; i++) {
        var f2 = Math.pow(r(), 0.8), px2 = 6 + f2 * 240, wid2 = 46 * Math.sin(Math.PI * Math.min(1, 0.15 + f2 * 0.95)), off2 = (r() * 2 - 1) * wid2, ang2 = (off2 > 0 ? 1 : -1) * (0.6 + r() * 0.5);
        x.strokeStyle = shade(0.2 + 0.7 * r() * (1 - Math.abs(off2) / 60)); x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(px2, y1 + off2 * 0.6); x.lineTo(px2 + Math.cos(ang2) * 10, y1 + off2 * 0.6 + Math.sin(ang2) * 10); x.stroke();
      }
      x.strokeStyle = '#6a5a40'; x.lineWidth = 3; x.beginPath(); x.moveTo(2, y1); x.lineTo(240, y1); x.stroke();
      x.restore();
      var t = toTex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    },
    // grass tuft card: blades fanning up from the bottom, alpha
    tuft: function () {
      var W = 256, H = 128, c = canvas(W, H), x = c.getContext('2d'), r = prng(71);
      x.lineCap = 'round';
      for (var i = 0; i < 140; i++) {
        var bx = 20 + r() * 216, len = 40 + r() * 85, lean = (bx - 128) / 128 * 30 + (r() - 0.5) * 30, lt = r();
        var g = x.createLinearGradient(0, H, 0, H - len);
        g.addColorStop(0, 'rgb(40,62,22)'); g.addColorStop(1, 'rgb(' + Math.round(120 + 70 * lt) + ',' + Math.round(160 + 60 * lt) + ',' + Math.round(60 + 30 * lt) + ')');
        x.strokeStyle = g; x.lineWidth = 2 + r() * 2.5;
        x.beginPath(); x.moveTo(bx, H); x.quadraticCurveTo(bx + lean * 0.3, H - len * 0.6, bx + lean, H - len); x.stroke();
      }
      var t = toTex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    },
    flowers: function () {
      var W = 256, H = 128, c = canvas(W, H), x = c.getContext('2d'), r = prng(73);
      x.lineCap = 'round';
      for (var i = 0; i < 40; i++) { var bx = 20 + r() * 216, len = 30 + r() * 60; x.strokeStyle = 'rgb(60,110,40)'; x.lineWidth = 2; x.beginPath(); x.moveTo(bx, H); x.lineTo(bx + (r() - 0.5) * 20, H - len); x.stroke(); }
      for (i = 0; i < 26; i++) {
        var fx = 20 + r() * 216, fy = H - 40 - r() * 70, cl = ['#ffffff', '#ffd84a', '#e8507a', '#b07ae0', '#ff8a3a', '#7ab8ff'][i % 6];
        for (var p = 0; p < 6; p++) { var a = p / 6 * 6.3; x.fillStyle = cl; x.beginPath(); x.ellipse(fx + Math.cos(a) * 5, fy + Math.sin(a) * 5, 4.5, 3, a, 0, 6.3); x.fill(); }
        x.fillStyle = '#f0c030'; x.beginPath(); x.arc(fx, fy, 3, 0, 6.3); x.fill();
      }
      var t = toTex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
    },
    // building materials, near-neutral so vertex colours tint them; one texture repeat per cell
    brick: function () {
      var N = 256, hf = new Float32Array(N * N), rows = 8, cols = 4;
      var c = pix(N, N, function (x, y, o) {
        var row = Math.floor(y / (N / rows)), off = row % 2 ? N / cols / 2 : 0, bx = ((x + off) % (N / cols)), by = y % (N / rows);
        var id = hash(Math.floor((x + off) / (N / cols)), row, 5), mort = bx < 3 || by < 3;
        var n = fbm(x / N * 16, y / N * 16, 3, 81, 16, 16), v;
        if (mort) { v = 0.82 + 0.1 * n; o[0] = 220 * v; o[1] = 214 * v; o[2] = 200 * v; hf[y * N + x] = 0; }
        else { v = 0.62 + 0.28 * id + 0.18 * (n - 0.5); o[0] = 230 * v; o[1] = 200 * v; o[2] = 190 * v; hf[y * N + x] = 0.7 + 0.3 * n; }
      });
      TX.brickN = toTex(normalCanvas(hf, N, N, 3));
      return toTex(c, true);
    },
    brickN: function () { T('brick'); return TX.brickN; },
    plank: function () {
      var N = 256, boards = 6, c = pix(N, N, function (x, y, o) {
        var b = Math.floor(x / (N / boards)), bx = x % (N / boards), id = hash(b, 1, 9), gr = fbm(x / N * 40, y / N * 3, 3, 91 + b, 40, 3);
        var v = 0.74 + 0.16 * id + 0.18 * (gr - 0.5); if (bx < 2) v *= 0.55;
        if (hash(b, Math.floor(y / 40), 3) > 0.92 && Math.hypot(bx - 20, (y % 40) - 20) < 4) v *= 0.7; // knots
        o[0] = 235 * v; o[1] = 225 * v; o[2] = 212 * v;
      });
      return toTex(c, true);
    },
    stucco: function () {
      var N = 256, c = pix(N, N, function (x, y, o) { var n = fbm(x / N * 10, y / N * 10, 4, 101, 10, 10), g = hash(x, y, 1), v = 0.86 + 0.1 * n + 0.04 * (g - 0.5); o[0] = 250 * v; o[1] = 246 * v; o[2] = 238 * v; });
      return toTex(c, true);
    },
    roof: function () {
      var N = 256, rows = 8, hf = new Float32Array(N * N), c = pix(N, N, function (x, y, o) {
        var row = Math.floor(y / (N / rows)), off = row % 2 ? 16 : 0, tx = ((x + off) % 32) / 32, ty = (y % (N / rows)) / (N / rows);
        var curve = Math.sin(tx * Math.PI), id = hash(Math.floor((x + off) / 32), row, 11), n = fbm(x / N * 12, y / N * 12, 3, 111, 12, 12);
        var v = (0.5 + 0.45 * curve) * (0.75 + 0.25 * ty) * (0.85 + 0.2 * id) + 0.08 * (n - 0.5);
        hf[y * N + x] = curve * 0.6 + ty * 0.4;
        o[0] = 240 * v; o[1] = 230 * v; o[2] = 225 * v;
      });
      TX.roofN = toTex(normalCanvas(hf, N, N, 2.5));
      return toTex(c, true);
    },
    roofN: function () { T('roof'); return TX.roofN; },
    // horizontal rock strata (mesas, buttes, hoodoos), v = height
    strata: function () {
      var N = 256, c = pix(N, N, function (x, y, o) {
        var w = fbm(x / N * 4, y / N * 2, 3, 121, 4, 2), band = fbm(1, (y / N * 10 + w * 0.6), 2, 123, 0, 10), n = fbm(x / N * 20, y / N * 20, 3, 125, 20, 20);
        var v = 0.65 + 0.3 * band + 0.12 * (n - 0.5); var pale = band > 0.62 ? 0.15 : 0;
        o[0] = 245 * v + 20 * pale; o[1] = 215 * v + 30 * pale; o[2] = 195 * v + 30 * pale;
      });
      return toTex(c, true);
    },
    stone: function () {
      var N = 256, c = pix(N, N, function (x, y, o) { var n = fbm(x / N * 8, y / N * 8, 5, 131, 8, 8), g = hash(x, y, 4), v = 0.6 + 0.35 * n + 0.08 * (g - 0.5); o[0] = 230 * v; o[1] = 226 * v; o[2] = 218 * v; });
      return toTex(c, true);
    },
    // cobbles for the plaza: rounded stones in courses
    cobble: function () {
      var N = 512, hf = new Float32Array(N * N), rows = 12, r = prng(141), starts = [];
      for (var k = 0; k < rows; k++) { var xs = [], p = r() * 20; while (p < N + 40) { xs.push(p); p += 26 + r() * 22; } starts.push(xs); }
      var c = pix(N, N, function (x, y, o) {
        var row = Math.floor(y / (N / rows)), ry = (y % (N / rows)) / (N / rows), xs = starts[row], j = 0;
        while (j < xs.length - 1 && xs[j + 1] <= x) j++;
        var a = xs[j], b = j < xs.length - 1 ? Math.min(xs[j + 1], N + a) : N, rx = (x - a) / Math.max(1, (b - a));
        var e = Math.min(rx, 1 - rx) * (b - a) / (N / rows), f = Math.min(ry, 1 - ry), edge = Math.min(e, f);
        var hgt = smooth(0.0, 0.16, edge), id = hash(j, row, 13), n = fbm(x / N * 30, y / N * 30, 2, 143, 30, 30);
        hf[y * N + x] = hgt;
        var v = (0.55 + 0.35 * id + 0.12 * (n - 0.5)) * (0.45 + 0.55 * hgt);
        o[0] = 205 * v; o[1] = 196 * v; o[2] = 182 * v;
      });
      TX.cobbleN = toTex(normalCanvas(hf, N, N, 4));
      return toTex(c, true);
    },
    cobbleN: function () { T('cobble'); return TX.cobbleN; },
    straw: function () {
      var N = 128, c = pix(N, N, function (x, y, o) { var n = fbm(x / N * 30, y / N * 4, 3, 151, 30, 4), v = 0.7 + 0.35 * n; o[0] = 238 * v; o[1] = 205 * v; o[2] = 120 * v; });
      return toTex(c, true);
    },
    tyre: function () {
      var N = 64, c = pix(N, N, function (x, y, o) { var ty = y % 32, v = 0.75 + (ty < 4 || ty > 27 ? -0.45 : 0) + (x % 8 < 2 ? -0.1 : 0) + 0.06 * hash(x, y, 2); o[0] = o[1] = o[2] = 255 * v; });
      return toTex(c, true);
    },
    corrugated: function () {
      var N = 128, c = pix(N, N, function (x, y, o) { var v = 0.7 + 0.25 * Math.sin(y / N * Math.PI * 2 * 12) + 0.05 * fbm(x / 8, y / 8, 2, 161, 16, 16); o[0] = 230 * v; o[1] = 232 * v; o[2] = 235 * v; });
      return toTex(c, true);
    },
    // boost pad: yellow chevrons on orange, two per tile, pointing up the texture (+v)
    pad: function () {
      var W = 128, H = 128, c = canvas(W, H), x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#ff6a00'); g.addColorStop(0.5, '#ff9a1a'); g.addColorStop(1, '#ff6a00');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = '#fff27a';
      for (var k = 0; k < 2; k++) { var y = k * 64 + 10; x.beginPath(); x.moveTo(14, y + 40); x.lineTo(64, y); x.lineTo(114, y + 40); x.lineTo(114, y + 56); x.lineTo(64, y + 18); x.lineTo(14, y + 56); x.closePath(); x.fill(); }
      return toTex(c, true);
    },
    // ramp deck: yellow and black bands along it, a non-slip plate pattern
    ramp: function () {
      var N = 256, c = pix(N, N, function (x, y, o) {
        var band = Math.floor(y / (N / 6)) % 2, plate = ((x + y) % 16 < 2 || (x - y + 512) % 16 < 2) ? 0.85 : 1, n = 0.92 + 0.08 * hash(x, y, 8);
        if (band) { o[0] = 250 * plate * n; o[1] = 196 * plate * n; o[2] = 40 * plate * n; } else { o[0] = o[1] = o[2] = 40 * plate * n; }
      });
      var t = toTex(c, true); t.wrapS = THREE.ClampToEdgeWrapping; return t;
    },
    cactus: function () {
      var N = 128, c = pix(N, N, function (x, y, o) { var rib = Math.pow(Math.abs(Math.sin(x / N * Math.PI * 8)), 0.6), n = fbm(x / 8, y / 8, 2, 171, 16, 16), sp = hash(x, y, 5) > 0.985 ? 1 : 0; var v = 0.55 + 0.4 * rib + 0.1 * n; o[0] = 200 * v + 60 * sp; o[1] = 230 * v + 40 * sp; o[2] = 190 * v + 40 * sp; });
      return toTex(c, true);
    }
  };
  // the asphalt for a road of half-width hw: u runs across the road (0 left .. 1 right), v along it over 13 cells.
  // Painted edge lines, a dashed centre line, darker polished tyre lines, aggregate grain; plus roughness and normal maps
  var ROADS = {};
  function roadTex(hw) {
    var key = hw.toFixed(2); if (ROADS[key]) return ROADS[key];
    var W = 512, H = 1024, cells = 13, pu = W / (2 * hw), pv = H / cells, hf = new Float32Array(W * H);
    var rc = canvas(W, H), rx = rc.getContext('2d'), rimg = rx.createImageData(W, H), rd = rimg.data;
    var c = pix(W, H, function (x, y, o) {
      var d = x / pu - hw, s = y / pv, n = fbm(x / W * 6, y / H * 12, 3, 201, 0, 12), m = fbm(x / W * 40, y / H * 80, 2, 203, 0, 80), gr = hash(x, y, 9), gr2 = hash(x, y, 19);
      var v = 0.34 + 0.07 * (n - 0.5) + 0.05 * (m - 0.5) + 0.07 * (gr - 0.5), rough = 0.86 + 0.08 * gr2, ht = gr * 0.7 + m * 0.3;
      if (gr2 > 0.965) { v += 0.16; ht += 0.4; } else if (gr2 < 0.03) { v -= 0.1; ht -= 0.3; }
      // tyre lines: polished, darker
      var wear = 0;
      [-1.75, -0.6, 0.6, 1.75].forEach(function (cl) { wear = Math.max(wear, Math.exp(-Math.pow((d - cl) / 0.32, 2))); });
      wear *= 0.6 + 0.4 * fbm(x / W * 4, y / H * 20, 2, 207, 0, 20);
      v *= 1 - 0.14 * wear; rough -= 0.2 * wear; ht = lerp(ht, 0.3, wear * 0.6);
      // tar-sealed cracks along the road
      var crack = Math.abs(fbm(x / W * 3 + 7, y / H * 6, 3, 209, 0, 6) - 0.5);
      if (crack < 0.0025) { v *= 0.82; rough -= 0.2; ht = 0.25; }
      // paint: edge lines and the centre dash, worn in places
      var paint = (Math.abs(Math.abs(d) - (hw - 0.3)) < 0.09) || (Math.abs(d) < 0.07 && (s % 2.6) < 1.2);
      if (paint && fbm(x / W * 60, y / H * 120, 2, 211, 0, 120) > 0.3 + 0.2 * gr) { v = 0.86 + 0.06 * gr; rough = 0.55; ht = 0.6; }
      // the road's very edge: a little darker and dirtier
      var edge = smooth(hw - 0.25, hw, Math.abs(d)); v *= 1 - 0.25 * edge;
      hf[y * W + x] = ht;
      var k = (y * W + x) * 4, rr = clamp(rough, 0, 1) * 255; rd[k] = rd[k + 1] = rd[k + 2] = rr; rd[k + 3] = 255;
      var t = v * 255; o[0] = t; o[1] = t * 0.985; o[2] = t * 0.96;
    });
    rx.putImageData(rimg, 0, 0);
    ROADS[key] = { map: toTex(c, true, true), rough: toTex(rc, false, true), normal: toTex(normalCanvas(hf, W, H, 1.6), false, true), cells: cells };
    return ROADS[key];
  }
  // a sign board texture with text
  function signTex(text, bg, fg, w, h, font) {
    var c = canvas(w || 512, h || 128), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 6; x.strokeRect(8, 8, c.width - 16, c.height - 16);
    x.fillStyle = fg; x.font = font || '700 ' + Math.round(c.height * 0.58) + 'px Fredoka, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, c.width / 2, c.height * 0.54);
    var t = toTex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  }
  function checkerTex() {
    if (TX.checker) return TX.checker;
    var c = canvas(256, 64), x = c.getContext('2d');
    for (var i = 0; i < 16; i++) for (var j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#1c1c22' : '#f4f2ec'; x.fillRect(i * 16, j * 16, 16, 16); }
    TX.checker = toTex(c, true); return TX.checker;
  }

  // ---------- shared materials ----------
  var MATS = {};
  // scenery right in front of the camera dithers away instead of filling the screen
  function nearFade(sh) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>',
      '#include <clipping_planes_fragment>\n{ float nf = smoothstep(1.4, 3.6, length(vViewPosition)); float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (nf < ign) discard; }');
  }
  // leaves sway in the wind (world-space positions: merged geometry sits at the origin)
  function sway(sh, amt) {
    sh.uniforms.uTime = TIME;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n{ vec3 wp = position; ' + (amt.inst ? 'wp += vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);' : '') +
      ' float ph = uTime * 1.7 + wp.x * 0.35 + wp.z * 0.27; float k = ' + amt.k + ' * ' + (amt.inst ? 'position.y' : '1.0') + ';' +
      ' transformed.x += sin(ph) * k + sin(ph * 2.3 + wp.y) * k * 0.4; transformed.z += cos(ph * 0.8) * k * 0.6; }');
  }
  function addHooks(m, hooks) { m.onBeforeCompile = function (sh) { hooks.forEach(function (h) { h(sh); }); }; m.customProgramCacheKey = function () { return hooks.map(function (h) { return h.key || ''; }).join('|') + m.name; }; }
  function std(o) { if (o.envMapIntensity === undefined) o.envMapIntensity = 0.3; var m = new THREE.MeshStandardMaterial(o); return m; }
  function MAT(name) {
    if (MATS[name]) return MATS[name];
    var m, fade = true;
    switch (name) {
      case 'foliage': m = std({ map: T('foliage'), alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0 });
        addHooks(m, [nearFade, function (sh) { sway(sh, { k: '0.035' }); }]); fade = false; break;
      case 'bark': m = std({ map: T('bark'), vertexColors: true, roughness: 0.95 }); break;
      case 'plain': m = std({ vertexColors: true, roughness: 0.75 }); break;
      case 'shiny': m = std({ vertexColors: true, roughness: 0.35, metalness: 0.1 }); break;
      case 'metal': m = std({ vertexColors: true, roughness: 0.35, metalness: 0.55, side: THREE.DoubleSide, envMapIntensity: 1.0 }); break;
      case 'brick': m = std({ map: T('brick'), normalMap: T('brickN'), vertexColors: true, roughness: 0.9 }); break;
      case 'plank': m = std({ map: T('plank'), vertexColors: true, roughness: 0.85 }); break;
      case 'stucco': m = std({ map: T('stucco'), vertexColors: true, roughness: 0.95 }); break;
      case 'roof': m = std({ map: T('roof'), normalMap: T('roofN'), vertexColors: true, roughness: 0.8 }); break;
      case 'strata': m = std({ map: T('strata'), vertexColors: true, roughness: 0.95 }); break;
      case 'stone': m = std({ map: T('stone'), vertexColors: true, roughness: 0.92 }); break;
      case 'straw': m = std({ map: T('straw'), vertexColors: true, roughness: 0.95 }); break;
      case 'tyre': m = std({ map: T('tyre'), vertexColors: true, roughness: 0.85 }); break;
      case 'corrugated': m = std({ map: T('corrugated'), vertexColors: true, roughness: 0.45, metalness: 0.5 }); break;
      case 'cactus': m = std({ map: T('cactus'), vertexColors: true, roughness: 0.7 }); break;
      case 'glass': m = std({ vertexColors: true, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.6 }); break;
      case 'glow': m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }); fade = false; break;
      case 'cloth': m = std({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }); break;
      case 'plankDS': m = std({ map: T('plank'), vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }); break;
      case 'rampDeck': m = std({ map: T('ramp'), vertexColors: true, roughness: 0.55, metalness: 0.3 }); fade = false; break;
      case 'kerb': m = polyMat(std({ vertexColors: true, roughness: 0.6 }), -3); fade = false; break;
      default: m = std({ vertexColors: true });
    }
    m.name = name;
    if (fade) addHooks(m, [nearFade]);
    MATS[name] = m; return m;
  }
  var SHADOW = { plankDS: 1, rampDeck: 1, foliage: 1, bark: 1, plank: 1, brick: 1, stucco: 1, roof: 1, strata: 1, stone: 1, straw: 1, tyre: 1, corrugated: 1, cactus: 1, plain: 1, shiny: 1, metal: 1, cloth: 1 };

  // ---------- geometry helpers ----------
  var _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  function mtx(x, y, z, ry, sx, sy, sz, rx, rz) {
    var e = new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ');
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(sx || 1, sy === undefined ? (sx || 1) : sy, sz === undefined ? (sx || 1) : sz));
  }
  // bake a solid colour (or a function of the vertex) into a geometry's colour attribute
  function paint(g, c) {
    var n = g.attributes.position.count, a = new Float32Array(n * 3), p = g.attributes.position;
    for (var i = 0; i < n; i++) { var cc = typeof c === 'function' ? c(p.getX(i), p.getY(i), p.getZ(i), i) : c; a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
  }
  function scaleUV(g, su, sv) { var uv = g.attributes.uv; if (!uv) return g; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
  // a box sitting on y = 0 with UVs in world units (one texture repeat per cell, × k)
  function box(w, h, d, k) {
    var g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); k = k || 1;
    var uv = g.attributes.uv, nr = g.attributes.normal;
    for (var i = 0; i < uv.count; i++) {
      var nx = Math.abs(nr.getX(i)), ny = Math.abs(nr.getY(i));
      var su = nx > 0.5 ? d : w, sv = ny > 0.5 ? d : h;
      uv.setXY(i, uv.getX(i) * su * k, uv.getY(i) * sv * k);
    }
    return g;
  }
  function cyl(rt, rb, h, seg, k, open) {
    var g = new THREE.CylinderGeometry(rt, rb, h, seg || 8, 1, !!open); g.translate(0, h / 2, 0);
    return scaleUV(g, Math.PI * (rt + rb) * (k || 1), h * (k || 1));
  }
  // gabled roof along x: width w (x), depth d (z), rise h, overhang o; slopes only (gable ends separate)
  function gable(w, d, h, o) {
    var hw = w / 2 + o, hd = d / 2 + o, slope = Math.hypot(hd, h);
    var pos = [-hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, h, 0, hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, h, 0];
    var uv = [0, 0, 2 * hw, 0, 2 * hw, slope, 0, slope, 0, 0, 2 * hw, 0, 2 * hw, slope, 0, slope];
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]); g.computeVertexNormals(); return g;
  }
  function gableEnds(w, d, h) {
    var hw = w / 2, hd = d / 2, pos = [hw, 0, hd, hw, 0, -hd, hw, h, 0, -hw, 0, -hd, -hw, 0, hd, -hw, h, 0];
    var uv = [0, 0, d, 0, d / 2, h, 0, 0, d, 0, d / 2, h];
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 3, 4, 5]); g.computeVertexNormals(); return g;
  }
  function quad(w, h) { var g = new THREE.PlaneGeometry(w, h); return g; }
  // a lumpy blob: an icosphere pushed in and out by noise, with normals pointing away from its centre (soft canopies)
  function blob(r, detail, seed, sy, rough) {
    var g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1, ux = x / l, uy = y / l, uz = z / l;
      var k = 1 + (rough === undefined ? 0.28 : rough) * (fbm(ux * 1.7 + seed, uy * 1.7 + uz * 1.3, 3, seed | 0) - 0.5) * 2;
      p.setXYZ(i, ux * r * k, uy * r * k * (sy || 1), uz * r * k); n.setXYZ(i, ux, uy, uz);
      uv[i * 2] = 0.52 + 0.2 * (0.5 + 0.5 * ux); uv[i * 2 + 1] = 0.02 + 0.46 * (0.5 + 0.5 * uy);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  // a rock: a lumpy icosphere with flat-ish facets
  function rockGeo(r, seed, sy) {
    var g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1, k = 0.75 + 0.5 * fbm(x / l * 1.3 + seed, z / l * 1.3 + y / l, 3, seed | 0);
      p.setXYZ(i, x * k, Math.max(-0.2 * r, y * k * (sy || 0.75)), z * k);
    }
    g.computeVertexNormals();
    var uv = new Float32Array(p.count * 2); for (i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) + p.getZ(i) * 0.7; uv[i * 2 + 1] = p.getY(i); }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  // a quad card in the foliage atlas, region [u0, v0, u1, v1]
  function card(w, h, reg, ox, oy) {
    var g = new THREE.PlaneGeometry(w, h); g.translate(ox || 0, oy || 0, 0);
    var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, lerp(reg[0], reg[2], uv.getX(i)), lerp(reg[1], reg[3], uv.getY(i)));
    return g;
  }
  var LEAF_A = [0.01, 0.51, 0.49, 0.99], LEAF_B = [0.51, 0.51, 0.99, 0.99], FROND = [0.0, 0.25, 0.5, 0.48], PINE = [0.0, 0.02, 0.5, 0.23];

  // ---------- merging ----------
  // pieces of static geometry gathered per material and per map chunk, then merged into one mesh each
  function Batch(chunk) { this.b = {}; this.chunk = chunk === undefined ? CH : chunk; }
  Batch.prototype.add = function (mat, geo, m, tint, cx, cz) {
    if (cx === undefined) { cx = m.elements[12]; cz = m.elements[14]; }
    var key = mat + '|' + (this.chunk ? Math.floor(cx / this.chunk) + ',' + Math.floor(cz / this.chunk) : '0');
    var b = this.b[key] || (this.b[key] = { mat: mat, items: [], nv: 0, ni: 0 });
    b.items.push({ g: geo, m: m, t: tint || WHITE }); b.nv += geo.attributes.position.count; b.ni += geo.index ? geo.index.count : geo.attributes.position.count;
  };
  var WHITE = new THREE.Color(1, 1, 1);
  Batch.prototype.build = function (group, opt) {
    var self = this, meshes = [];
    Object.keys(this.b).forEach(function (key) {
      var b = self.b[key], pos = new Float32Array(b.nv * 3), nor = new Float32Array(b.nv * 3), uv = new Float32Array(b.nv * 2), cl = new Float32Array(b.nv * 3);
      var idx = b.nv > 65535 ? new Uint32Array(b.ni) : new Uint16Array(b.ni), vo = 0, io = 0, nm = new THREE.Matrix3();
      b.items.forEach(function (it) {
        var g = it.g, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, C = g.attributes.color, e = it.m.elements, n = P.count;
        nm.getNormalMatrix(it.m); var ne = nm.elements, t = it.t;
        for (var i = 0; i < n; i++) {
          var x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = (vo + i) * 3;
          pos[k] = e[0] * x + e[4] * y + e[8] * z + e[12]; pos[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pos[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (N) { var a = N.getX(i), bb = N.getY(i), c = N.getZ(i), nx = ne[0] * a + ne[3] * bb + ne[6] * c, ny = ne[1] * a + ne[4] * bb + ne[7] * c, nz = ne[2] * a + ne[5] * bb + ne[8] * c, l = Math.hypot(nx, ny, nz) || 1; nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l; }
          else nor[k + 1] = 1;
          if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
          if (C) { cl[k] = C.getX(i) * t.r; cl[k + 1] = C.getY(i) * t.g; cl[k + 2] = C.getZ(i) * t.b; } else { cl[k] = t.r; cl[k + 1] = t.g; cl[k + 2] = t.b; }
        }
        if (g.index) { var I = g.index.array; for (i = 0; i < I.length; i++) idx[io + i] = I[i] + vo; io += I.length; }
        else { for (i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
        vo += n;
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere(); geo.computeBoundingBox();
      var mesh = new THREE.Mesh(geo, typeof b.mat === 'string' ? MAT(b.mat) : b.mat);
      mesh.castShadow = !!(opt && opt.cast !== undefined ? opt.cast : SHADOW[b.mat]); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      group.add(mesh); meshes.push(mesh);
    });
    this.b = {};
    return meshes;
  };

  // ---------- prototypes (built once, reused by every track) ----------
  var PROTO = {};
  function proto(name) { if (!PROTO[name]) PROTO[name] = PROTOS[name](); return PROTO[name]; }
  // a canopy: lumpy blobs and leaf cards round them, coloured darker underneath and inside
  function canopy(parts, blobs, seed, base, cards) {
    var r = prng(seed), dark = base.clone().multiplyScalar(0.38), lite = base.clone().lerp(new THREE.Color(1, 0.97, 0.75), 0.15);
    var cy = 0, cn = 0; blobs.forEach(function (b) { cy += b[1]; cn++; }); cy /= cn;
    var span = 0; blobs.forEach(function (b) { span = Math.max(span, Math.hypot(b[0], b[2]) + b[3]); });
    function shadeAt(x, y, z) { var up = clamp((y - cy) / (span * 1.4) * 0.5 + 0.5, 0, 1), out = clamp(Math.hypot(x, z) / span, 0, 1); return mixC(dark, lite, clamp(up * 0.8 + out * 0.4 - 0.1, 0, 1)); }
    blobs.forEach(function (b, i) {
      // a dark inner volume so there are no holes through the leaves
      var g = blob(b[3] * 0.8, 1, seed + i * 3.1, b[4] || 0.85, 0.2);
      var bu = g.attributes.uv; for (var q = 0; q < bu.count; q++) bu.setXY(q, 0.6, 0.2);
      g.translate(b[0], b[1], b[2]);
      paint(g, function (x, y, z) { return shadeAt(x, y, z).multiplyScalar(0.62); });
      parts.push({ mat: 'foliage', g: g });
      // leaf clusters all over it, facing outward
      var n = cards + Math.round(b[3] * 9);
      for (var k = 0; k < n; k++) {
        var u = r() * 2 - 1, th = r() * 6.3, sq = Math.sqrt(1 - u * u * 0.8), nx = sq * Math.cos(th), ny = u * 0.9 + 0.1, nz = sq * Math.sin(th), l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        var sz = b[3] * (1.0 + r() * 0.5), cg = card(sz, sz, r() < 0.5 ? LEAF_A : LEAF_B), rad = b[3] * (0.72 + r() * 0.22);
        var look = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(nx + (r() - 0.5) * 0.6, ny + (r() - 0.5) * 0.6, nz + (r() - 0.5) * 0.6), _up);
        cg.applyMatrix4(new THREE.Matrix4().makeRotationZ(r() * 6.3)); cg.applyMatrix4(look);
        cg.translate(b[0] + nx * rad, b[1] + ny * rad * (b[4] || 0.85), b[2] + nz * rad);
        var N = cg.attributes.normal, P = cg.attributes.position;
        for (var j = 0; j < N.count; j++) { var ax = P.getX(j), ay = (P.getY(j) - cy) * 1.2, az = P.getZ(j), al = Math.hypot(ax, ay, az) || 1; N.setXYZ(j, ax / al, ay / al, az / al); }
        paint(cg, function (x, y, z) { return shadeAt(x, y, z); });
        parts.push({ mat: 'foliage', g: cg });
      }
    });
  }
  // a trunk mapped onto the bark strip of the foliage atlas, so a whole tree is one material
  function barkCyl(rt, rb, h, seg) {
    var g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, true); g.translate(0, h / 2, 0);
    var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, 0.765 + 0.215 * uv.getX(i), 0.02 + 0.46 * uv.getY(i));
    return g;
  }
  function trunk(parts, h, r0, r1, tint, branches, seed) {
    var g = barkCyl(r1, r0, h, 7); paint(g, function (x, y) { return tint.clone().multiplyScalar(0.7 + 0.3 * y / h); }); parts.push({ mat: 'foliage', g: g });
    var r = prng(seed);
    for (var i = 0; i < (branches || 0); i++) {
      var bl = h * (0.35 + r() * 0.25), b = barkCyl(r1 * 0.5, r1 * 0.9, bl, 5);
      b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, r() * 6.3, 0.6 + r() * 0.4, 'YXZ'))); b.translate(0, h * (0.6 + r() * 0.3), 0);
      paint(b, tint.clone().multiplyScalar(0.8)); parts.push({ mat: 'foliage', g: b });
    }
  }
  var BARK = col('#8a7460'), BARK_D = col('#5e4e40');
  var PROTOS = {
    oak: function () { var p = []; trunk(p, 2.2, 0.26, 0.16, BARK, 3, 1); canopy(p, [[0, 3.3, 0, 1.4], [1.0, 2.8, 0.3, 1.0], [-0.9, 2.9, -0.4, 1.05], [0.1, 2.8, 1.0, 0.95]], 3, col('#4f8a30'), 6); return p; },
    elm: function () { var p = []; trunk(p, 3.2, 0.24, 0.14, BARK_D, 3, 2); canopy(p, [[0, 4.2, 0, 1.25, 1.15], [0.7, 3.4, 0.4, 0.95], [-0.6, 3.5, -0.4, 1.0], [0.1, 5.1, 0.1, 0.85, 1.1]], 5, col('#3f7430'), 5); return p; },
    birch: function () { var p = []; trunk(p, 3.4, 0.13, 0.08, col('#e8e4dc'), 2, 3); canopy(p, [[0, 3.8, 0, 0.9, 1.3], [0.4, 3.1, 0.2, 0.7], [-0.3, 4.5, -0.2, 0.65]], 7, col('#74a83e'), 5); return p; },
    pine: function () {
      var p = []; trunk(p, 1.6, 0.18, 0.1, BARK_D, 0, 4);
      var r = prng(9), base = col('#2f5a34'), dark = base.clone().multiplyScalar(0.4);
      for (var i = 0; i < 6; i++) {
        var f = i / 6, rad = 1.5 * (1 - f * 0.78), h = 1.6, y = 1.0 + i * 0.75, g = new THREE.ConeGeometry(rad * 0.85, h, 8, 1, true), P = g.attributes.position, uv = new Float32Array(P.count * 2);
        for (var j = 0; j < P.count; j++) { var x = P.getX(j), yy = P.getY(j), z = P.getZ(j), a = Math.atan2(z, x), w = 1 + 0.18 * Math.sin(a * 5 + i * 2) + 0.1 * (hash(j, i, 3) - 0.5); P.setXYZ(j, x * w, yy - (yy < -h / 2 + 0.01 ? 0.25 * w : 0), z * w); uv[j * 2] = 0.52 + 0.2 * (0.5 + 0.5 * Math.cos(a)); uv[j * 2 + 1] = 0.02 + 0.46 * (0.5 + yy / h); }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.computeVertexNormals(); g.translate(0, y + h / 2, 0);
        paint(g, function (x, yy) { var t = clamp((yy - y) / h, 0, 1); return mixC(dark, base, 0.15 + 0.5 * t).multiplyScalar(0.7); });
        p.push({ mat: 'foliage', g: g });
        // needle sprigs fanning out and drooping round each tier
        var nk = 7 - Math.floor(i / 2);
        for (var k = 0; k < nk; k++) {
          var a2 = (k + r() * 0.6) / nk * 6.3, L2 = rad * 1.25, cg = card(L2, rad * 0.8, PINE, L2 * 0.5, 0);
          cg.rotateX(-Math.PI / 2 + 0.35); cg.rotateZ(-0.45 - r() * 0.2); cg.rotateY(-a2); cg.translate(0, y + 0.35 + r() * 0.2, 0);
          var NN = cg.attributes.normal, PP = cg.attributes.position; for (var j2 = 0; j2 < NN.count; j2++) { var ax = PP.getX(j2), az = PP.getZ(j2), al = Math.hypot(ax, 0.5, az); NN.setXYZ(j2, ax / al, 0.5 / al, az / al); }
          paint(cg, function (x, yy, z) { return mixC(dark, base, clamp(0.45 + Math.hypot(x, z) / rad * 0.5, 0, 1.1)); }); p.push({ mat: 'foliage', g: cg });
        }
      }
      return p;
    },
    hedge: function () { var p = []; canopy(p, [[0, 0.55, 0, 0.62, 0.75], [0.3, 0.5, 0.2, 0.4]], 21, col('#5e9a40'), 5); return p; },
    bush: function () { var p = []; canopy(p, [[0, 0.45, 0, 0.6], [0.5, 0.35, 0.2, 0.45], [-0.45, 0.38, -0.15, 0.48]], 11, col('#4a7a30'), 3); return p; },
    shrub: function () { var p = []; canopy(p, [[0, 0.32, 0, 0.42], [0.35, 0.26, 0.15, 0.32], [-0.3, 0.28, -0.1, 0.34]], 13, col('#8a9a68'), 2); return p; },
    rock: function () { var g = rockGeo(0.6, 2, 0.7); paint(g, function (x, y) { return mixC(col('#6f6a62'), col('#a8a296'), clamp(y / 0.6 + 0.4, 0, 1)); }); return [{ mat: 'stone', g: g }]; },
    redrock: function () { var g = rockGeo(0.9, 5, 0.8); paint(g, function (x, y) { return mixC(col('#8a4428'), col('#d88a58'), clamp(y / 0.9 + 0.3, 0, 1)); }); return [{ mat: 'strata', g: g }]; },
    hay: function () {
      var g = cyl(0.48, 0.48, 0.95, 14, 1.5); g.translate(0, -0.475, 0); g.rotateX(Math.PI / 2); g.translate(0, 0.46, 0);
      paint(g, col('#e6c070')); return [{ mat: 'straw', g: g }];
    },
    cactus: function () {
      var p = [], green = col('#5f8a4a');
      function seg(r0, r1, h) { var g = cyl(r1, r0, h, 12, 1); var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) / (Math.PI * (r0 + r1)) ); return g; }
      var t = seg(0.24, 0.2, 2.6); var top = new THREE.SphereGeometry(0.2, 12, 6, 0, 6.3, 0, Math.PI / 2); top.translate(0, 2.6, 0); scaleUV(top, 1, 0.3);
      paint(t, function (x, y) { return green.clone().multiplyScalar(0.75 + 0.1 * y / 2.6); }); paint(top, green); p.push({ mat: 'cactus', g: t }, { mat: 'cactus', g: top });
      [[1, 1.1, 0.55], [-1, 1.5, 0.45]].forEach(function (a) {
        var el = seg(0.15, 0.15, a[2]); el.rotateZ(-a[0] * Math.PI / 2); el.translate(a[0] * 0.18, a[1], 0); paint(el, green.clone().multiplyScalar(0.8)); p.push({ mat: 'cactus', g: el });
        var up = seg(0.15, 0.13, 0.9); up.translate(a[0] * (0.18 + a[2]), a[1] - 0.12, 0); paint(up, green.clone().multiplyScalar(0.85)); p.push({ mat: 'cactus', g: up });
        var cap = new THREE.SphereGeometry(0.13, 10, 5, 0, 6.3, 0, Math.PI / 2); cap.translate(a[0] * (0.18 + a[2]), a[1] + 0.78, 0); scaleUV(cap, 1, 0.3); paint(cap, green); p.push({ mat: 'cactus', g: cap });
      });
      return p;
    },
    // hoodoo: a banded rock pillar with a darker cap rock
    pillar: function () {
      var p = [], h = 3.4, g = new THREE.CylinderGeometry(0.45, 0.7, h, 10, 8), P = g.attributes.position;
      for (var i = 0; i < P.count; i++) { var x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), w = 1 + 0.22 * Math.sin(y * 3.1 + 1) + 0.12 * (fbm(a * 1.5, y, 2, 7) - 0.5) * 2; P.setXYZ(i, x * w, y, z * w); }
      g.computeVertexNormals(); g.translate(0, h / 2, 0); scaleUV(g, 3, h / 1.5);
      paint(g, function (x, y) { return mixC(col('#b0603a'), col('#e8a070'), clamp(y / h, 0, 1)); }); p.push({ mat: 'strata', g: g });
      var cap = rockGeo(0.75, 9, 0.5); cap.translate(0, h + 0.1, 0); paint(cap, col('#6a4a3a')); p.push({ mat: 'strata', g: cap });
      return p;
    },
    palm: function () {
      var p = [], r = prng(17), segs = 7, h = 4.2, lean = 0.6, pts = [];
      for (var i = 0; i <= segs; i++) { var f = i / segs; pts.push([lean * f * f, h * f]); }
      for (i = 0; i < segs; i++) {
        var a = pts[i], b = pts[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
        var g = barkCyl(0.13 - i * 0.008, 0.16 - i * 0.008, len + 0.04, 8); g.rotateZ(-ang); g.translate(a[0], a[1], 0);
        paint(g, function (x, y) { return col('#a89070').multiplyScalar(0.75 + 0.25 * Math.abs(Math.sin(y * 9))); }); p.push({ mat: 'foliage', g: g });
      }
      var top = pts[segs];
      for (i = 0; i < 9; i++) {
        var fa = i / 9 * 6.3 + r() * 0.3, droop = 0.35 + r() * 0.35, L = 2.2 + r() * 0.5;
        // a frond: two bent card halves so it arches out and down
        [[0, L * 0.5, -droop * 0.4], [L * 0.5, L * 0.5, -droop * 1.4]].forEach(function (s, k) {
          var cg = card(L * 0.5, 1.3, [FROND[0] + (FROND[2] - FROND[0]) * k * 0.5, FROND[1], FROND[0] + (FROND[2] - FROND[0]) * (k * 0.5 + 0.5), FROND[3]], L * 0.25, 0);
          cg.rotateX(-Math.PI / 2); cg.applyMatrix4(new THREE.Matrix4().makeRotationZ(s[2])); cg.translate(s[0] * Math.cos(-droop * 0.4 * k), -k * L * 0.5 * Math.sin(droop * 0.4), 0);
          cg.rotateY(fa); cg.translate(top[0], top[1], 0);
          paint(cg, col('#6a9a40')); p.push({ mat: 'foliage', g: cg });
        });
      }
      var nut = blob(0.25, 0, 3, 1, 0.1); nut.translate(top[0], top[1] - 0.1, 0); paint(nut, col('#6a5a2a')); p.push({ mat: 'plain', g: nut });
      return p;
    },
    tyres: function () { var g = cyl(0.32, 0.32, 0.75, 12, 1); var uv = g.attributes.uv; for (var i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) / 0.25 * 0.5 / 0.75 * 0.75); return [{ mat: 'tyre', g: g }]; },
    tuft: function () {
      // three crossed cards; positions y from 0 (root) to 1 (tip) so the wind bends the tips
      var gs = [];
      for (var i = 0; i < 3; i++) { var g = new THREE.PlaneGeometry(1, 0.5); g.translate(0, 0.25, 0); g.rotateY(i * Math.PI / 3); gs.push(g); }
      return mergeSimple(gs);
    }
  };
  function mergeSimple(gs) { var b = new Batch(0), grp = new THREE.Group(); gs.forEach(function (g) { b.add('plain', g, new THREE.Matrix4(), WHITE, 0, 0); }); var m = b.build(grp)[0]; return m.geometry; }
  function addProto(batch, name, m, tint, cx, cz) { proto(name).forEach(function (pt) { batch.add(pt.mat, pt.g, m, tint, cx, cz); }); }

  // ---------- buildings ----------
  // each adds pieces to a batch with the matrix m (origin on the ground at the building's centre, front +z)
  function house(b, m, kind, r) {
    var W = 3.2, Dp = 2.6, H = 1.7, wall = kind === 'house2' ? 'brick' : 'stucco', wc = kind === 'house2' ? col('#b8664a') : col('#f2ead8');
    var roofC = kind === 'house2' ? col('#5c6470') : col('#b5533a');
    function put(mat, g, c, mm) { b.add(mat, g, mm ? m.clone().multiply(mm) : m, c); }
    put('stone', box(W + 0.12, 0.25, Dp + 0.12), col('#9a948a'));
    put(wall, box(W, H, Dp).translate(0, 0.25, 0), wc);
    put(wall, gableEnds(W, Dp, 1.2).translate(0, H + 0.25, 0), wc);
    put('roof', gable(W, Dp, 1.25, 0.25).translate(0, H + 0.2, 0), roofC);
    put('brick', box(0.4, 1.2, 0.4).translate(W * 0.28, H + 0.6, -0.4), col('#9a5a44'));
    // door, windows with frames and shutters
    put('plank', box(0.55, 0.95, 0.06).translate(0, 0.25, Dp / 2), col('#6a3e2a'));
    [-1, 1].forEach(function (sd) {
      [[sd * W * 0.3, 0.75, Dp / 2, 0], [W / 2, 0.75, sd * Dp * 0.25, Math.PI / 2], [-W / 2, 0.75, sd * Dp * 0.25, -Math.PI / 2]].forEach(function (w) {
        var mm = new THREE.Matrix4().makeRotationY(w[3]).setPosition(w[0], w[1], w[2]);
        put('plain', box(0.62, 0.72, 0.04), col('#f4f2ea'), mm);
        put('glass', box(0.48, 0.58, 0.06).translate(0, 0.07, 0), col('#4a6a80'), mm);
        if (kind !== 'house2') { put('plank', box(0.2, 0.7, 0.05).translate(-0.44, 0.01, 0.02), col('#3f6a4a'), mm); put('plank', box(0.2, 0.7, 0.05).translate(0.44, 0.01, 0.02), col('#3f6a4a'), mm); }
        put('plain', box(0.6, 0.12, 0.16).translate(0, -0.08, 0.06), col('#8a5a3a'), mm);
      });
    });
  }
  function barn(b, m) {
    var W = 4.2, Dp = 3.0, H = 2.0, red = col('#a8402e');
    function put(mat, g, c) { b.add(mat, g, m, c); }
    put('stone', box(W + 0.1, 0.2, Dp + 0.1), col('#8a847a'));
    put('plank', box(W, H, Dp).translate(0, 0.2, 0), red);
    put('plank', gableEnds(W, Dp, 1.5).translate(0, H + 0.2, 0), red);
    put('corrugated', gable(W, Dp, 1.55, 0.2).translate(0, H + 0.15, 0), col('#7a7e84'));
    // big doors with the white X
    put('plank', box(1.6, 1.6, 0.06).translate(W / 2 + 0.02, 0.2, 0).rotateY(Math.PI / 2), red.clone().multiplyScalar(0.85));
    var x1 = box(2.1, 0.12, 0.05); x1.rotateZ(Math.atan2(1.6, 1.6)); x1.translate(0, 1.0, 0); x1.rotateY(Math.PI / 2); x1.translate(W / 2 + 0.06, 0, 0); put('plain', x1, col('#f4f0e6'));
    var x2 = box(2.1, 0.12, 0.05); x2.rotateZ(-Math.atan2(1.6, 1.6)); x2.translate(0, 1.0, 0); x2.rotateY(Math.PI / 2); x2.translate(W / 2 + 0.06, 0, 0); put('plain', x2, col('#f4f0e6'));
    put('plain', box(0.12, 1.7, 1.75).translate(W / 2 + 0.04, 0.15, 0), col('#f4f0e6'));
    // a silo beside it
    var s = cyl(0.8, 0.8, 4.2, 14, 1); s.translate(-W / 2 - 1.1, 0, -0.4); put('corrugated', s, col('#c8ccd0'));
    var dome = new THREE.SphereGeometry(0.82, 14, 6, 0, 6.3, 0, Math.PI / 2); dome.translate(-W / 2 - 1.1, 4.2, -0.4); scaleUV(dome, 4, 1); put('corrugated', dome, col('#9aa0a6'));
  }
  function adobe(b, m) {
    var W = 3.0, Dp = 2.4, H = 1.6, c = col('#d8a070');
    function put(mat, g, cc) { b.add(mat, g, m, cc); }
    put('stucco', box(W, H, Dp), c);
    put('stucco', box(W + 0.12, 0.2, Dp + 0.12).translate(0, H, 0), c.clone().multiplyScalar(0.92));
    put('stucco', box(1.4, 0.9, 1.2).translate(-0.5, H + 0.2, -0.3), c);
    for (var i = 0; i < 5; i++) put('bark', cyl(0.06, 0.06, 0.5, 5).rotateX(Math.PI / 2).translate(-W / 2 + 0.3 + i * 0.6, H - 0.15, Dp / 2), col('#6a4a30'));
    put('plank', box(0.55, 0.95, 0.06).translate(0.6, 0, Dp / 2), col('#4a6a8a'));
    put('glass', box(0.45, 0.45, 0.06).translate(-0.7, 0.6, Dp / 2), col('#2a3a48'));
  }
  // a butte: a stepped, banded rock tower
  function butteGeo(rad, h, seed) {
    var g = new THREE.CylinderGeometry(rad * 0.85, rad, h, 18, 10), P = g.attributes.position;
    for (var i = 0; i < P.count; i++) {
      var x = P.getX(i), y = P.getY(i), z = P.getZ(i), a = Math.atan2(z, x), t = (y + h / 2) / h;
      var w = 1 + 0.18 * (fbm(Math.cos(a) * 1.5 + seed, Math.sin(a) * 1.5 + t * 2, 3, seed | 0) - 0.5) * 2 + (t < 0.3 ? 0.25 * (0.3 - t) / 0.3 : 0) + 0.05 * Math.sin(t * 25);
      P.setXYZ(i, x * w, y, z * w);
    }
    g.computeVertexNormals(); g.translate(0, h / 2, 0); scaleUV(g, rad * 6.3 / 3, h / 3);
    paint(g, function (x, y) { return mixC(col('#a04c2c'), col('#e09060'), clamp(y / h, 0, 1)); });
    return g;
  }
  function windmillTower(b, m) {
    function put(mat, g, c) { b.add(mat, g, m, c); }
    var t = new THREE.CylinderGeometry(0.9, 1.4, 4.0, 8, 1); t.translate(0, 2.0, 0); scaleUV(t, 7, 4); put('stucco', t, col('#f0ece2'));
    put('stone', cyl(1.5, 1.6, 0.4, 8, 1), col('#8a847a'));
    var cap = new THREE.ConeGeometry(1.15, 1.2, 8); cap.translate(0, 4.6, 0); scaleUV(cap, 3, 1.2); put('roof', cap, col('#5a3a2e'));
    put('plank', box(0.5, 0.9, 0.06).translate(0, 0.4, 1.32), col('#5a3a2a'));
    put('glass', box(0.4, 0.4, 0.06).translate(0, 2.6, 1.05), col('#3a4a58'));
  }
  // windmill sails, a separate group turning about +z (its local axis), hub at the origin
  function windmillSails() {
    var b = new Batch(0), grp = new THREE.Group(), wood = col('#7a5a3a'), cloth = col('#f2ead8');
    var hubg = cyl(0.22, 0.22, 0.5, 8); hubg.rotateX(Math.PI / 2); b.add('plank', hubg, new THREE.Matrix4(), wood.clone().multiplyScalar(0.7), 0, 0);
    for (var i = 0; i < 4; i++) {
      var rm = new THREE.Matrix4().makeRotationZ(i * Math.PI / 2);
      b.add('plank', box(0.12, 2.7, 0.08).translate(0, 0.1, 0.25), rm, wood, 0, 0);
      for (var k = 0; k < 6; k++) b.add('plank', box(0.62, 0.05, 0.05).translate(0.3, 0.6 + k * 0.38, 0.25), rm, wood, 0, 0);
      b.add('cloth', new THREE.PlaneGeometry(0.58, 2.0).translate(0.32, 1.65, 0.29), rm, cloth, 0, 0);
    }
    b.build(grp);
    return grp;
  }
  function grandstand(b, m, r) {
    var L = 10, rows = 5, step = 0.55, rise = 0.42;
    function put(mat, g, c, mm) { b.add(mat, g, mm ? m.clone().multiply(mm) : m, c); }
    for (var i = 0; i < rows; i++) {
      var z = 1.4 - i * step, y = 0.25 + i * rise;
      put('plain', box(L, y, step).translate(0, 0, z), col('#9aa0a8'));
      // seats in team colours
      for (var k = 0; k < 20; k++) {
        var sx = -L / 2 + 0.25 + k * (L - 0.5) / 19, sc = [col('#d23a32'), col('#2a6ad0'), col('#f2c230'), col('#f4f2ea')][(i + Math.floor(k / 5)) % 4];
        put('shiny', box(0.36, 0.12, 0.32).translate(sx, y, z), sc);
        if (r() < 0.75) { // a spectator
          var shirt = new THREE.Color().setHSL(r(), 0.6, 0.5), skin = [col('#f0c8a0'), col('#c89068'), col('#8a5a3a')][Math.floor(r() * 3)];
          put('plain', box(0.26, 0.34, 0.18).translate(sx, y + 0.12, z - 0.02), shirt);
          var hd = new THREE.SphereGeometry(0.1, 7, 5); hd.translate(sx, y + 0.58, z - 0.02); put('plain', hd, skin);
          if (r() < 0.3) { var arm = box(0.06, 0.3, 0.06); arm.translate(sx + 0.16, y + 0.42, z - 0.02); put('plain', arm, shirt); }
        }
      }
    }
    // roof on posts
    var top = 0.25 + rows * rise + 1.3;
    [-L / 2, -L / 4, 0, L / 4, L / 2].forEach(function (px) { put('metal', box(0.12, top, 0.12).translate(px, 0, 1.4 - rows * step), col('#d8dce0')); });
    var rf = box(L + 0.6, 0.1, rows * step + 1.0); rf.rotateX(0.12); rf.translate(0, top, 1.4 - rows * step / 2 + 0.1); put('corrugated', rf, col('#e8eaee'));
    put('plain', box(L + 0.6, 0.5, 0.06).translate(0, top - 0.3, 1.9), col('#c8302a'));
  }

  // ---------- per-world look ----------
  // LOOK_DOC: each world's entry gives the sky and light, then the land: hills (a HILLS shape), tex/texN/normalScale/tile
  // (terrain texture, normal map and its repeat in cells), dryPatch (hills' dry grass rising with height) or patch (a
  // colour blotched over the ground), roughMix (how strongly the runoff takes L.rough), cliff (steep slopes),
  // mtnStyle (a MTN shape for the far ring) with mtnTint/mtnHaze, roadTint and shoulderC, wall ('fence' | 'armco', or a
  // WALLS entry), bank (props by creeks: 'reeds' | 'redrock' | a proto name), kinds (buildings, by name in BUILD or the
  // built-ins) and trackKinds (per track), farmHay, species ([proto, cumulative chance]) and band (protos just past the
  // walls), maxTrees, treeDens, treeScale [min, spread], roadside (a proto here and there by the road), palms (round
  // water), far ('mesas' or a FAR entry: big things in the far land), tuftN and tuftC (grass tufts), canyons (track ids
  // whose gaps are dry canyons rather than water), flowers, waterGlow (an emissive colour for the gap fluid: lava)
  var LOOK = {
    hills: { sunAz: -2.2, sunEl: 0.72, sun: '#fff0d8', sunI: 2.5, hemiSky: '#cfe3ff', hemiGround: '#6a5a3a', hemiI: 0.6,
      zenith: '#2a66c4', horizon: '#bcd4e6', fog: '#c4d6e2', fogD: 0.0034, cloudA: '#ffffff', cloudB: '#a8b4c8', cover: 0.5, exposure: 1.0,
      grass: ['#46782e', '#66923e', '#345c24'], rough: '#46682a', dry: '#98984a', shoulder: '#8a7050', bank: '#6a5a40', water: '#1e5058',
      mtn: ['#6a8aa8', '#a8bccc'], hill: 9, ground: 'grass',
      // land and scenery style (see LOOK_DOC above)
      hills: 'roll', tex: 'grass', texN: null, tile: 4, dryPatch: true, patch: null, roughMix: 0.45, cliff: '#7a6a48',
      mtnStyle: 'ridge', mtnTint: null, mtnHaze: null, roadTint: '#ffffff', shoulderC: '#c8b8a0', wall: 'fence', bank: 'reeds',
      kinds: ['barn', 'house', 'house2', 'house'], trackKinds: { windmill: ['windmill', 'barn', 'house', 'windmill', 'house2'] }, farmHay: true,
      species: [['oak', 0.32], ['elm', 0.5], ['pine', 0.74], ['birch', 0.84], ['bush', 0.95], ['rock', 1]],
      band: ['oak', 'bush', 'elm', 'bush', 'pine', 'birch'], maxTrees: 520, treeDens: 1, treeScale: [0.85, 0.75],
      roadside: 'hay', palms: false, far: null, tuftN: 4500, tuftC: '#e8ffd0', flowers: true, canyons: [] },
    desert: { sunAz: -2.0, sunEl: 0.5, sun: '#ffdcaa', sunI: 2.8, hemiSky: '#b8c8f0', hemiGround: '#b06a3a', hemiI: 0.7,
      zenith: '#3a62b8', horizon: '#f2cfa2', fog: '#efcfa4', fogD: 0.0030, cloudA: '#fff2e0', cloudB: '#d8a890', cover: 0.62, exposure: 1.0,
      grass: ['#d8a868', '#e8c088', '#c48a52'], rough: '#b86a40', dry: '#e0b880', shoulder: '#a86a44', bank: '#8a5a3a', water: '#2a7a80',
      mtn: ['#b8705a', '#d8a888'], hill: 4.5, ground: 'sand',
      hills: 'dune', tex: 'sand', texN: 'sandN', normalScale: 0.5, tile: 6, dryPatch: false, patch: '#c07a4a', roughMix: 0.75, cliff: '#b06a42',
      mtnStyle: 'mesa', mtnTint: '#f0c8a0', mtnHaze: 0.45, roadTint: '#f4e4d8', shoulderC: '#e0b890', wall: 'armco', bank: 'redrock',
      kinds: ['adobe', 'butte', 'adobe', 'butte', 'butte'], trackKinds: {}, farmHay: false,
      species: [['cactus', 0.4], ['shrub', 0.65], ['redrock', 0.82], ['pillar', 1]],
      band: ['cactus', 'shrub', 'redrock', 'shrub', 'pillar'], maxTrees: 380, treeDens: 0.6, treeScale: [0.8, 0.6],
      roadside: 'shrub', palms: true, far: 'mesas', tuftN: 2000, tuftC: '#ffd890', canyons: ['mesa'] }
  };
  function lookOf(id) { return LOOK[id] || LOOK.hills; }

  // ---------- sky ----------
  var SKY_VS = 'varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; gl_Position.z = gl_Position.w * 0.99999; }';
  var SKY_FS = [
    'uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSun; uniform vec3 uCloudA; uniform vec3 uCloudB; uniform float uTime; uniform float uCover;',
    'varying vec3 vDir;',
    'float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }',
    'float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }',
    'void main() {',
    '  vec3 d = normalize(vDir); float e = d.y;',
    '  vec3 c = mix(uHorizon, uZenith, pow(clamp(e, 0.0, 1.0), 0.38));',
    '  if (e < 0.0) c = mix(uHorizon, uGround, clamp(-e * 6.0, 0.0, 1.0));',
    '  float sd = max(dot(d, uSunDir), 0.0);',
    '  c += uSun * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.5) * (0.6 + 0.4 * clamp(1.0 - e * 2.0, 0.0, 1.0));',
    '  c = mix(c, uHorizon * 1.05, (1.0 - smoothstep(0.0, 0.12, abs(e))) * 0.5);',
    '  float disc = smoothstep(0.99955, 0.99975, sd); c += uSun * disc * 14.0;',
    '  if (e > 0.0) {',
    '    vec2 uv = d.xz / (e + 0.12) * 1.1 + uTime * vec2(0.006, 0.0025);',
    '    float n = fbm(uv), n2 = fbm(uv * 2.7 + 3.1);',
    '    float dens = smoothstep(uCover, uCover + 0.28, n * 0.8 + n2 * 0.25) * smoothstep(0.0, 0.18, e);',
    '    float lit = clamp(0.55 + (fbm(uv + uSunDir.xz * 0.06) - n) * -4.0, 0.0, 1.0);',
    '    vec3 cc = mix(uCloudB, uCloudA, lit) + uSun * pow(sd, 5.0) * 0.35;',
    '    c = mix(c, cc, dens * 0.92);',
    '  }',
    '  gl_FragColor = vec4(c, 1.0);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'].join('\n');
  function sunDir(L) { return new THREE.Vector3(Math.cos(L.sunAz) * Math.cos(L.sunEl), Math.sin(L.sunEl), Math.sin(L.sunAz) * Math.cos(L.sunEl)).normalize(); }
  function makeSky(L) {
    var u = { uZenith: { value: col(L.zenith) }, uHorizon: { value: col(L.horizon) }, uGround: { value: col(L.fog) }, uSunDir: { value: sunDir(L) }, uSun: { value: col(L.sun) },
      uCloudA: { value: col(L.cloudA) }, uCloudB: { value: col(L.cloudB) }, uTime: TIME, uCover: { value: L.cover } };
    var m = new THREE.ShaderMaterial({ uniforms: u, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false });
    var s = new THREE.Mesh(new THREE.SphereGeometry(1000, 40, 20), m); s.renderOrder = -10; s.frustumCulled = false; s.name = 'sky';
    return s;
  }
  function lights(group, L) {
    var hemi = new THREE.HemisphereLight(col(L.hemiSky), col(L.hemiGround), L.hemiI); group.add(hemi);
    var sun = new THREE.DirectionalLight(col(L.sun), L.sunI); sun.castShadow = true;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    var sc = sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 220;
    group.add(sun); group.add(sun.target);
    return { hemi: hemi, sun: sun, dir: sunDir(L) };
  }

  // ---------- terrain ----------
  // the ground's height and colour from a distance field to the centreline: flat near the road (where the logic
  // drives), rolling hills further out, creek channels in the jump gaps
  function Field(g, L, worldId, trackId) {
    var lim = g.hw + D.RUNOFF, M = 26, self = this;
    this.lim = lim; this.L = L; this.g = g;
    this.x0 = g.x0 - M; this.z0 = g.z0 - M; this.w = g.w + 2 * M; this.h = g.h + 2 * M;
    var W = this.w + 1, H = this.h + 1, dist = new Float32Array(W * H), S = g.samples;
    for (var z = 0; z < H; z++) for (var x = 0; x < W; x++) {
      var wx = this.x0 + x, wz = this.z0 + z, dd;
      if (wx >= g.x0 && wz >= g.z0 && wx < g.x0 + g.w && wz < g.z0 + g.h) dd = g.query(wx, wz).dist;
      else { dd = 1e9; for (var j = 0; j < g.n; j += 3) { var e = (S[j].x - wx) * (S[j].x - wx) + (S[j].z - wz) * (S[j].z - wz); if (e < dd) dd = e; } dd = Math.sqrt(dd); }
      dist[z * W + x] = dd;
    }
    this.dist = dist; this.W = W; this.H = H;
    // the road's height carried out over the land (hills): exactly the ground under the road out past the walls,
    // then a smooth blend of the nearby stretches (inverse distance on a coarse grid), fading back to the plain
    // land far out, so a climb sits on a hillside and a summit on a hill
    var hilly = S.some(function (sm) { return Math.abs(sm.y || 0) > 1e-6; });
    this.ry = null;
    if (hilly) {
      var GC = 4, CW = Math.ceil(W / GC) + 1, CHh = Math.ceil(H / GC) + 1, coarse = new Float32Array(CW * CHh), pts = [];
      for (var j2 = 0; j2 < g.n; j2 += 4) pts.push(S[j2]);
      for (var cz = 0; cz < CHh; cz++) for (var cx = 0; cx < CW; cx++) {
        var px = this.x0 + cx * GC, pz = this.z0 + cz * GC, sw = 0, sy = 0;
        for (var k = 0; k < pts.length; k++) { var e2 = (pts[k].x - px) * (pts[k].x - px) + (pts[k].z - pz) * (pts[k].z - pz), w = 1 / ((e2 + 9) * (e2 + 9)); sw += w; sy += w * pts[k].y; }
        coarse[cz * CW + cx] = sy / sw;
      }
      var ry = new Float32Array(W * H);
      for (z = 0; z < H; z++) for (x = 0; x < W; x++) {
        var fx = x / GC, fz = z / GC, ix = Math.min(CW - 2, Math.floor(fx)), iz = Math.min(CHh - 2, Math.floor(fz)), tx = fx - ix, tz = fz - iz;
        var idw = (coarse[iz * CW + ix] * (1 - tx) + coarse[iz * CW + ix + 1] * tx) * (1 - tz) + (coarse[(iz + 1) * CW + ix] * (1 - tx) + coarse[(iz + 1) * CW + ix + 1] * tx) * tz;
        var d0 = dist[z * W + x], wx2 = this.x0 + x, wz2 = this.z0 + z, near = d0 < lim + 12 ? D.groundAt(g, g.query(wx2, wz2).s) : idw;
        ry[z * W + x] = lerp(near, idw, smooth(lim + 1, lim + 11, d0)) * (1 - smooth(lim + 40, lim + 110, d0));
      }
      this.ry = ry;
    }
    // creeks: across the road at each jump gap, running out along the road's normal until they near another stretch
    this.creeks = [];
    g.ramps.forEach(function (m, i) {
      if (!m.gap) return;
      var a = m.s + m.len, b = a + m.gap, mid = D.pointAt(g, (a + b) / 2, 0), nx = -mid.tz, nz = mid.tx, ext = [0, 0];
      [-1, 1].forEach(function (sd, k) {
        var e = lim + 2;
        for (; e < 60; e += 1) {
          var px = mid.x + nx * sd * e, pz = mid.z + nz * sd * e;
          if (px < self.x0 + 3 || pz < self.z0 + 3 || px > self.x0 + self.w - 3 || pz > self.z0 + self.h - 3) break;
          var q = g.query(px, pz); if (q.dist < lim + 6 && Math.abs(((q.s - (a + b) / 2) % g.L + g.L * 1.5) % g.L - g.L / 2) > m.gap + 8) break;
        }
        ext[k] = e - 4;
      });
      var canyon = (L.canyons || []).indexOf(trackId) >= 0;
      self.creeks.push({ y0: D.groundAt ? D.groundAt(g, (a + b) / 2) : 0, x: mid.x, z: mid.z, tx: mid.tx, tz: mid.tz, nx: nx, nz: nz, half: m.gap / 2, ext: ext, a: a, b: b, depth: canyon ? 3.2 : 1.1, water: canyon ? -2.7 : -0.32, canyon: canyon });
    });
    var amp = L.hill, shape = HILLS[L.hills] || HILLS.roll;
    this.hillAt = function (x, z) { return shape(x, z, amp); };
  }
  // the land's shape away from the road, by LOOK.hills: (x, z, amplitude) → height
  var HILLS = {
    roll: function (x, z, amp) { var n = fbm(x * 0.014, z * 0.014, 4, 311); return amp * (Math.pow(n, 1.6) * 1.4 + fbm(x * 0.05, z * 0.05, 2, 313) * 0.25); },
    dune: function (x, z, amp) { var r1 = 1 - Math.abs(fbm(x * 0.02, z * 0.02, 3, 301) * 2 - 1); return amp * (Math.pow(r1, 2) * 0.8 + fbm(x * 0.05, z * 0.05, 2, 303) * 0.3); }
  };
  Field.prototype.distAt = function (x, z) {
    var fx = x - this.x0, fz = z - this.z0;
    if (fx < 0 || fz < 0 || fx >= this.W - 1 || fz >= this.H - 1) return 999;
    var ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, W = this.W, d = this.dist, k = iz * W + ix;
    return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + W] * (1 - tx) + d[k + W + 1] * tx) * tz;
  };
  Field.prototype.roadY = function (x, z) {
    if (!this.ry) return 0;
    var fx = x - this.x0, fz = z - this.z0;
    if (fx < 0 || fz < 0 || fx >= this.W - 1 || fz >= this.H - 1) return 0;
    var ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz, W = this.W, d = this.ry, k = iz * W + ix;
    return (d[k] * (1 - tx) + d[k + 1] * tx) * (1 - tz) + (d[k + W] * (1 - tx) + d[k + W + 1] * tx) * tz;
  };
  // creek profile at a point: 0 dry .. 1 the channel's bed, and the local across-channel coordinate
  Field.prototype.creekAt = function (x, z) {
    var best = null;
    for (var i = 0; i < this.creeks.length; i++) {
      var c = this.creeks[i], dx = x - c.x, dz = z - c.z, t = dx * c.tx + dz * c.tz, n = dx * c.nx + dz * c.nz;
      var e = n < 0 ? c.ext[0] : c.ext[1], an = Math.abs(n);
      if (an > e + 4) continue;
      var wig = Math.sin(n * 0.13 + i) * 1.6 * smooth(this.lim + 2, this.lim + 12, an), half = c.half * (an > e ? Math.sqrt(Math.max(0, 1 - Math.pow((an - e) / 4, 2))) : 1);
      var at = Math.abs(t - wig), bank = c.canyon ? 0.6 : 0.9;
      var p = 1 - smooth(half - 0.2, half + bank, at);
      if (p > 0 && (!best || p > best.p)) best = { p: p, c: c, t: t - wig, an: an };
    }
    return best;
  };
  Field.prototype.height = function (x, z) {
    var d = this.distAt(x, z), y = this.hillAt(x, z) * smooth(this.lim + 5, this.lim + 38, d);
    // flatten a valley round each creek so its water lies level, then cut the channel
    for (var i = 0; i < this.creeks.length; i++) { var c = this.creeks[i], t = Math.abs((x - c.x) * c.tx + (z - c.z) * c.tz), n = Math.abs((x - c.x) * c.nx + (z - c.z) * c.nz); if (n < Math.max(c.ext[0], c.ext[1]) + 10) y *= smooth(c.half + 1, c.half + 12, t); }
    var ck = this.creekAt(x, z), base = this.roadY(x, z);
    // tuck the land a little under the road so it never pokes through on a crest
    y += base - 0.06 * (1 - smooth(this.g.hw, this.g.hw + 1, d));
    if (ck) y = lerp(y, ck.c.y0 - ck.c.depth, ck.p);
    return y;
  };
  // walkable/clear test for placing scenery: away from the road, creeks and water
  Field.prototype.clear = function (x, z, m) { if (this.distAt(x, z) < this.lim + m) return false; var ck = this.creekAt(x, z); return !ck || ck.p < 0.01; };

  function terrainMat(L) {
    var key = 'terrain_' + L.tex + '_' + (L.texN || '');
    if (MATS[key]) return MATS[key];
    var m = std({ map: T(L.tex), normalMap: L.texN ? T(L.texN) : null, vertexColors: true, roughness: 0.95, metalness: 0 });
    if (L.texN) m.normalScale.set(L.normalScale || 1, L.normalScale || 1);
    // two scales of the same texture so its repeat does not show
    addHooks(m, [function (sh) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
        'vec4 t1 = texture2D(map, vMapUv); vec4 t2 = texture2D(map, vMapUv * 0.23 + vec2(0.37, 0.11));\n' +
        'vec3 det = (t1.rgb * 0.6 + t2.rgb * 0.4) / uMean; diffuseColor.rgb *= clamp(mix(vec3(1.0), det, 1.6), 0.0, 3.0);');
      sh.uniforms.uMean = { value: m.map.userData.mean };
      sh.fragmentShader = 'uniform vec3 uMean;\n' + sh.fragmentShader;
    }]);
    m.name = key; MATS[key] = m; return m;
  }
  // terrain chunk meshes over the field's rectangle: one cell resolution near the road, coarser further out,
  // with skirts hanging under the edges to hide cracks between resolutions
  function buildTerrain(group, F, L) {
    var mat = terrainMat(L), cG = L.grass.map(col), cR = col(L.rough), cDry = col(L.dry), cSh = col(L.shoulder), cBank = col(L.bank), tile = L.tile || 4;
    var cPatch = L.patch ? col(L.patch) : null, cCliff = col(L.cliff || '#7a6a48');
    var tris = 0;
    function colour(x, z, y, d, ck, out) {
      var n = fbm(x * 0.05, z * 0.05, 3, 401), m = fbm(x * 0.21, z * 0.21, 2, 403), c = mixC(cG[0], cG[2], smooth(0.35, 0.7, n));
      c.lerp(cG[1], smooth(0.55, 0.85, m) * 0.5);
      if (L.dryPatch) c.lerp(cDry, smooth(0.6, 0.85, fbm(x * 0.02, z * 0.02, 2, 405)) * 0.35 + clamp(y / 14, 0, 0.25));
      if (cPatch) c.lerp(cPatch, smooth(0.55, 0.8, fbm(x * 0.03, z * 0.03, 2, 407)) * 0.5);
      // the runoff: rougher, darker grass (red gravel in the canyon) right up to the walls, a dirt shoulder at the road
      var lim = F.lim, hw = F.g.hw;
      c.lerp(cR, (1 - smooth(lim + 0.5, lim + 2.5, d)) * (L.roughMix || 0.45));
      c.lerp(cSh, (1 - smooth(hw + 0.2, hw + 1.1, d)) * 0.8);
      if (ck) c.lerp(cBank, smooth(0.05, 0.4, ck.p));
      out.copy(c);
    }
    var cx0 = Math.floor(F.x0 / CH), cz0 = Math.floor(F.z0 / CH), cx1 = Math.floor((F.x0 + F.w - 1) / CH), cz1 = Math.floor((F.z0 + F.h - 1) / CH);
    var tmp = new THREE.Color();
    for (var cz = cz0; cz <= cz1; cz++) for (var cx = cx0; cx <= cx1; cx++) {
      var ax = Math.max(F.x0, cx * CH), az = Math.max(F.z0, cz * CH), bx = Math.min(F.x0 + F.w, (cx + 1) * CH), bz = Math.min(F.z0 + F.h, (cz + 1) * CH);
      if (bx <= ax || bz <= az) continue;
      // resolution: fine where the road or a creek is near
      var near = 1e9, wet = false; for (var sz = az; sz <= bz; sz += 2) for (var sx = ax; sx <= bx; sx += 2) { near = Math.min(near, F.distAt(sx, sz)); if (!wet) { var ckk = F.creekAt(sx, sz); wet = !!(ckk && ckk.p > 0); } }
      var res = wet || (F.ry && near < F.lim + 6) ? 1 : near < F.lim + 30 ? 2 : 4, nx = Math.ceil((bx - ax) / res), nz = Math.ceil((bz - az) / res);
      var nv = (nx + 1) * (nz + 1), skirtN = 2 * (nx + nz), pos = new Float32Array((nv + skirtN * 2) * 3), nor = new Float32Array(pos.length), clr = new Float32Array(pos.length), uv = new Float32Array((nv + skirtN * 2) * 2), idx = [];
      var hts = new Float32Array((nx + 3) * (nz + 3));
      for (var j = -1; j <= nz + 1; j++) for (var i = -1; i <= nx + 1; i++) hts[(j + 1) * (nx + 3) + i + 1] = F.height(ax + Math.min(i * res, bx - ax + res), az + Math.min(j * res, bz - az + res));
      for (j = 0; j <= nz; j++) for (i = 0; i <= nx; i++) {
        var x = Math.min(ax + i * res, bx), z = Math.min(az + j * res, bz), k = j * (nx + 1) + i, H = function (ii, jj) { return hts[(jj + 1) * (nx + 3) + ii + 1]; };
        var y = H(i, j), gx = (H(i + 1, j) - H(i - 1, j)) / (2 * res), gz = (H(i, j + 1) - H(i, j - 1)) / (2 * res), l = Math.hypot(gx, 1, gz);
        pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; nor[k * 3] = -gx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -gz / l;
        uv[k * 2] = x / tile; uv[k * 2 + 1] = z / tile;
        var d = F.distAt(x, z); colour(x, z, y, d, F.creekAt(x, z), tmp);
        var slope = 1 - 1 / l; if (slope > 0.08) tmp.lerp(cCliff, smooth(0.08, 0.35, slope) * 0.6);
        clr[k * 3] = tmp.r; clr[k * 3 + 1] = tmp.g; clr[k * 3 + 2] = tmp.b;
        if (i < nx && j < nz) { var a = k, b = k + 1, c = k + nx + 1, e = c + 1; idx.push(a, c, b, b, c, e); }
      }
      // skirts
      var sv = nv, edge = [];
      for (i = 0; i <= nx; i++) edge.push(i); for (j = 1; j <= nz; j++) edge.push(j * (nx + 1) + nx);
      for (i = nx - 1; i >= 0; i--) edge.push(nz * (nx + 1) + i); for (j = nz - 1; j >= 1; j--) edge.push(j * (nx + 1));
      edge.push(0);
      var first = sv;
      for (var q = 0; q < edge.length; q++) {
        var s0 = edge[q], t0 = sv + q;
        if (t0 >= nv + skirtN * 2) break;
        pos[t0 * 3] = pos[s0 * 3]; pos[t0 * 3 + 1] = pos[s0 * 3 + 1] - 2.5; pos[t0 * 3 + 2] = pos[s0 * 3 + 2];
        nor[t0 * 3 + 1] = 1; clr[t0 * 3] = clr[s0 * 3]; clr[t0 * 3 + 1] = clr[s0 * 3 + 1]; clr[t0 * 3 + 2] = clr[s0 * 3 + 2]; uv[t0 * 2] = uv[s0 * 2]; uv[t0 * 2 + 1] = uv[s0 * 2 + 1];
        if (q > 0) { var p0 = edge[q - 1], p1 = s0, d0 = sv + q - 1, d1 = t0; idx.push(p0, d0, p1, p1, d0, d1, p0, p1, d0, p1, d1, d0); }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(clr, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeBoundingSphere();
      var mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; group.add(mesh);
      tris += idx.length / 3;
    }
    // the far land round the field, coarse, rising into hills
    var cxm = F.x0 + F.w / 2, czm = F.z0 + F.h / 2, R = 420, step = 10, n2 = Math.ceil(2 * R / step), fp = [], fc = [], fi = [], fu = [];
    for (j = 0; j <= n2; j++) for (i = 0; i <= n2; i++) {
      var x2 = cxm - R + i * step, z2 = czm - R + j * step, inside = x2 > F.x0 + 2 && z2 > F.z0 + 2 && x2 < F.x0 + F.w - 2 && z2 < F.z0 + F.h - 2;
      var dr = Math.hypot(x2 - cxm, z2 - czm) / R, y2 = F.hillAt(x2, z2) * (1 + dr * 1.5) + smooth(0.55, 1, dr) * L.hill * 3;
      if (inside) y2 = -4;
      else { var ex = Math.max(F.x0 - x2, x2 - (F.x0 + F.w), F.z0 - z2, z2 - (F.z0 + F.h)); if (ex < step) y2 = Math.min(y2, F.height(clamp(x2, F.x0, F.x0 + F.w), clamp(z2, F.z0, F.z0 + F.h)) + Math.max(0, ex) * 0.1) - 0.3; }
      fp.push(x2, y2, z2); fu.push(x2 / tile, z2 / tile);
      colour(x2, z2, y2, 999, null, tmp); tmp.multiplyScalar(0.92); fc.push(tmp.r, tmp.g, tmp.b);
      if (i < n2 && j < n2) { var a2 = j * (n2 + 1) + i; fi.push(a2, a2 + n2 + 1, a2 + 1, a2 + 1, a2 + n2 + 1, a2 + n2 + 2); }
    }
    var fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); fg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2)); fg.setIndex(fi); fg.computeVertexNormals();
    var far = new THREE.Mesh(fg, mat); far.receiveShadow = false; far.matrixAutoUpdate = false; group.add(far);
    tris += fi.length / 3;
    return tris;
  }
  // distant mountains (or mesas) on a ring, hazed toward the horizon colour
  // the far ring's height profile, by LOOK.mtnStyle: (angle, ring fraction, noise, seed) → height
  var MTN = {
    ridge: function (a, f, n, seed) { var ridge = 1 - Math.abs(fbm(Math.cos(a) * 5 + seed, Math.sin(a) * 5 + f * 2, 4, 505) * 2 - 1); return (40 + 110 * n * ridge); },
    mesa: function (a, f, n) { return smooth(0.42, 0.5, n) * (60 + 50 * fbm(a * 2, 1, 2, 503)); }
  };
  function mountains(group, cx, cz, L, seed) {
    var shape = MTN[L.mtnStyle] || MTN.ridge, tint = L.mtnTint ? col(L.mtnTint) : null;
    var pos = [], clr = [], idx = [], A = 160, R0 = 520, R1 = 760, rings = 5, base = col(L.mtn[0]), top = col(L.mtn[1]), hz = col(L.fog);
    for (var j = 0; j <= rings; j++) for (var i = 0; i <= A; i++) {
      var a = i / A * Math.PI * 2, f = j / rings, r = lerp(R0, R1, f), env = Math.sin(f * Math.PI);
      var n = fbm(Math.cos(a) * 3 + seed, Math.sin(a) * 3 + f, 4, 501), h;
      h = shape(a, f, n, seed) * env;
      pos.push(cx + Math.cos(a) * r, h - 8, cz + Math.sin(a) * r);
      var c = mixC(base, top, clamp(h / 140, 0, 1)); if (tint) c.lerp(tint, fbm(a * 9, h * 0.05, 2, 507) * 0.3); c.lerp(hz, L.mtnHaze != null ? L.mtnHaze : 0.5 + 0.2 * f);
      clr.push(c.r, c.g, c.b);
      if (i < A && j < rings) { var k = j * (A + 1) + i; idx.push(k, k + 1, k + A + 1, k + 1, k + A + 2, k + A + 1); }
    }
    var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3)); g.setIndex(idx); g.computeVertexNormals();
    var m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, fog: false })); m.matrixAutoUpdate = false; m.name = 'mountains'; group.add(m);
    return idx.length / 3;
  }

  // ---------- the track surface ----------
  // a strip along the centreline between offsets d0 and d1 for each s in list; vfn(s) gives the texture v
  function strip(g, list, d0, d1, y, ufn, vfn, cfn, across) {
    var pos = [], uv = [], clr = [], idx = [], n = across || 1, cols = n + 1;
    list.forEach(function (s, i) {
      for (var k = 0; k <= n; k++) {
        var d = lerp(d0, d1, k / n), p = D.pointAt(g, s, d), yy = (typeof y === 'function' ? y(s, d, k / n) : y) + (D.groundAt && g.samples ? D.groundAt(g, s) : 0);
        pos.push(p.x, yy, p.z); uv.push(ufn ? ufn(d, k / n) : k / n, vfn ? vfn(s) : s);
        var c = cfn ? cfn(s, d, i, k) : WHITE; clr.push(c.r, c.g, c.b);
      }
      if (i > 0) for (k = 0; k < n; k++) { var a = (i - 1) * cols + k, b = a + 1, c2 = i * cols + k, e = c2 + 1; idx.push(a, b, c2, b, e, c2); }
    });
    var geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    // the strip is laid with the right edge on the +d side; make sure the faces point up
    var nr = geo.attributes.normal; if (nr.count && nr.getY(0) < 0) { for (var i2 = 0; i2 < idx.length; i2 += 3) { var t = idx[i2 + 1]; idx[i2 + 1] = idx[i2 + 2]; idx[i2 + 2] = t; } geo.setIndex(idx); geo.computeVertexNormals(); }
    return geo;
  }
  function sRange(s0, s1, step) { var a = []; for (var s = s0; s < s1 - 1e-6; s += step) a.push(s); a.push(s1); return a; }
  // the lap minus the creek gaps, as [s0, s1] runs
  function dryRuns(g) {
    var gaps = g.ramps.filter(function (m) { return m.gap; }).map(function (m) { return [m.s + m.len, m.s + m.len + m.gap]; }).sort(function (a, b) { return a[0] - b[0]; });
    var runs = [], s = 0;
    gaps.forEach(function (gp) { if (gp[0] > s) runs.push([s, gp[0]]); s = gp[1]; });
    if (s < g.L) runs.push([s, g.L]);
    return runs;
  }
  function polyMat(m, f) { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = f; return m; }

  // ---------- hazards ----------
  // a model for each logic hazard kind (RB.HAZ), facing +x (the way it walks or rolls), on the ground at y = 0;
  // userData.pose(hz, t) turns its roll and steps its legs from RB.hazardAt
  // HAZOBJ[kind](grp, inner) builds a new world's hazard model into inner and returns pose(hz, t) or nothing
  var HAZOBJ = {};
  function hazardObj(kind) {
    var grp = new THREE.Group(), inner = new THREE.Group(), b = new Batch(0), I = new THREE.Matrix4(), legs = [];
    grp.add(inner);
    if (HAZOBJ[kind]) {
      var pose = HAZOBJ[kind](grp, inner);
      grp.userData.pose = function (hz, t) { if (pose) pose(hz, t); else inner.rotation.z = -hz.roll; };
      grp.traverse(function (o) { if (o.isMesh) o.receiveShadow = true; });
      return grp;
    }
    if (kind === 'sheep') {
      var wool = blob(0.5, 2, 7, 0.78, 0.35); wool.scale(1.3, 1, 1); wool.translate(0, 0.78, 0); paint(wool, function (x, y) { return mixC(col('#c8c2b4'), col('#fbf8f0'), clamp((y - 0.5) / 0.6, 0, 1)); }); b.add('plain', wool, I);
      var head = new THREE.SphereGeometry(0.22, 12, 8); head.scale(1.25, 1, 0.9); head.translate(0.78, 0.92, 0); paint(head, col('#2e2a2a')); b.add('plain', head, I);
      var fluff = blob(0.2, 1, 3, 0.7, 0.4); fluff.translate(0.68, 1.12, 0); paint(fluff, col('#f4f0e6')); b.add('plain', fluff, I);
      [-1, 1].forEach(function (sd) {
        var ear = new THREE.BoxGeometry(0.08, 0.05, 0.2); ear.translate(0.72, 1.0, sd * 0.2); paint(ear, col('#2e2a2a')); b.add('plain', ear, I);
        var eye = new THREE.SphereGeometry(0.035, 6, 4); eye.translate(0.95, 0.98, sd * 0.1); paint(eye, col('#f4f0e6')); b.add('shiny', eye, I);
      });
      b.build(inner, { cast: true });
      [[0.4, 1], [0.4, -1], [-0.4, 1], [-0.4, -1]].forEach(function (lp, k) {
        var leg = new THREE.Group(), lg = new THREE.CylinderGeometry(0.06, 0.05, 0.5, 6); lg.translate(0, -0.25, 0); paint(lg, col('#2e2a2a'));
        var lm = new THREE.Mesh(lg, MAT('plain')); lm.castShadow = true; leg.add(lm); leg.position.set(lp[0], 0.5, lp[1] * 0.22); inner.add(leg); legs.push([leg, k % 3 ? 1 : -1]);
      });
    } else if (kind === 'bale') {
      var bale = cyl(0.85, 0.85, 1.5, 18, 1.5); bale.translate(0, -0.75, 0); bale.rotateX(Math.PI / 2); paint(bale, col('#e6c070')); b.add('straw', bale, I);
      [-0.45, 0.45].forEach(function (zz) { var band = new THREE.TorusGeometry(0.86, 0.025, 4, 24); band.translate(0, 0, zz); paint(band, col('#c0392b')); b.add('plain', band, I); });
      b.build(inner, { cast: true }); inner.position.y = 0.85;
    } else if (kind === 'tumble') {
      var core = blob(0.42, 1, 11, 1, 0.3); paint(core, col('#8a6a3a')); b.add('plain', core, I); b.build(inner, { cast: true });
      inner.children[0].material = MATS.tumbleCore || (MATS.tumbleCore = std({ vertexColors: true, roughness: 1, transparent: true, opacity: 0.45, depthWrite: false }));
      var twig = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.6, 1));
      var lines = new THREE.LineSegments(twig, MATS.twig || (MATS.twig = new THREE.LineBasicMaterial({ color: col('#6a4a24') })));
      var lines2 = lines.clone(); lines2.rotation.set(0.7, 0.4, 1.1); lines2.scale.setScalar(0.85);
      inner.add(lines, lines2); inner.position.y = 0.6;
    } else {
      var rk = rockGeo(1.0, 4, 0.95); paint(rk, function (x, y) { return mixC(col('#8a5a3a'), col('#d09060'), clamp(y + 0.5, 0, 1)); }); b.add('strata', rk, I);
      b.build(inner, { cast: true }); inner.position.y = 0.85;
    }
    grp.userData.pose = function (hz, t) {
      if (kind === 'sheep') { legs.forEach(function (l) { l[0].rotation.z = Math.sin(t * 9) * 0.45 * l[1]; }); inner.position.y = Math.abs(Math.sin(t * 9)) * 0.04; }
      else inner.rotation.z = -hz.roll;
      if (kind === 'tumble') inner.rotation.x = hz.roll * 0.6;
    };
    grp.traverse(function (o) { if (o.isMesh) o.receiveShadow = true; });
    return grp;
  }

  // ---------- per-world registries ----------
  // extension points a world's LOOK can name: BUILD[kind](batch, matrix facing the road, rng, group, anim) for
  // buildings; WALLS[name](batch, g, run of s values, offset, side, GY) for the barrier; FAR[name](batch, field, rng,
  // group, anim) for big things in the far land. UNTINTED protos keep their colour (rocks), LOW ones are not scaled up
  // like trees, SMALL ones do not block other placements.
  var BUILD = {}, WALLS = {}, FAR = {};
  var UNTINTED = { rock: 1, redrock: 1, pillar: 1 }, LOW = { bush: 1, rock: 1, shrub: 1 }, SMALL = { bush: 1, shrub: 1 };

  // ---------- race ----------
  function race(trackId, g, worldId) {
    g = g || D.track(trackId);
    var t0 = performance.now(), L = lookOf(worldId), group = new THREE.Group(), r = prng(g.n * 13 + 7), lim = g.hw + D.RUNOFF;
    var F = new Field(g, L, worldId, trackId), info = { tris: 0 }, anim = [];
    function GY(s) { return D.groundAt ? D.groundAt(g, s) : 0; } // the road's height at arc length s
    group.add(makeSky(L)); var lt = lights(group, L);
    info.tris += buildTerrain(group, F, L);
    info.tris += mountains(group, F.x0 + F.w / 2, F.z0 + F.h / 2, L, g.n % 17);
    var b = new Batch(), hw = g.hw;

    // road, shoulder strips and the start checker
    var rt = roadTex(hw), reps = Math.max(1, Math.round(g.L / rt.cells)), vk = reps / g.L;
    var roadKey = 'road' + hw + (L.roadTint || '#ffffff');
    var roadMat = MATS[roadKey] || (MATS[roadKey] = polyMat(std({ map: rt.map, roughnessMap: rt.rough, normalMap: rt.normal, roughness: 1, metalness: 0, color: col(L.roadTint || '#ffffff') }), -2));
    var shoulderMat = MATS.shoulder || (MATS.shoulder = polyMat(std({ map: T('dirt'), vertexColors: true, roughness: 1 }), -1));
    var b0 = new Batch(0);
    roadMat.name = roadKey; shoulderMat.name = 'shoulder';
    dryRuns(g).forEach(function (run) {
      var list = sRange(run[0], run[1], 0.5);
      b0.add(roadKey, strip(g, list, -hw, hw, 0.012, null, function (s) { return s * vk; }), new THREE.Matrix4());
      [-1, 1].forEach(function (sd) {
        b0.add('shoulder', strip(g, list, sd * (hw - 0.05), sd * (hw + 0.55), 0.008, function (d) { return d * 0.5; }, function (s) { return s * 0.5; }, function () { return col(L.shoulderC || '#c8b8a0'); }), new THREE.Matrix4());
      });
      info.tris += (list.length - 1) * 6;
    });
    // kerbs where the road bends: raised red and white blocks
    var runs = [], inRun = -1, i;
    for (i = 0; i <= g.n; i++) { var bent = i < g.n && Math.abs(g.samples[i].k) > 0.04; if (bent && inRun < 0) inRun = i; if (!bent && inRun >= 0) { runs.push([inRun, i]); inRun = -1; } }
    var kerbMat = 'kerb', red = col('#d8342a'), wht = col('#f2f0ea');
    runs.forEach(function (rr) {
      var s0 = Math.max(0, rr[0] * 0.5 - 2), s1 = rr[1] * 0.5 + 2;
      [-1, 1].forEach(function (sd) {
        for (var s = s0; s < s1; s += 1) {
          if (g.ramps.some(function (m) { if (!m.gap) return false; var u = ((s - m.s - m.len) % g.L + g.L) % g.L; return u < m.gap || u > g.L - 1; })) continue;
          var list = sRange(s, Math.min(s1, s + 1), 0.5), cc = Math.round(s) % 2 ? wht : red;
          var kg = strip(g, list, sd * (hw - 0.15), sd * (hw + 0.6), function (ss, d, f) { return 0.015 + Math.sin(f * Math.PI) * 0.05; }, null, null, function () { return cc; }, 3);
          b.add(kerbMat, kg, new THREE.Matrix4(), WHITE, kg.attributes.position.getX(0), kg.attributes.position.getZ(0));
        }
      });
    });
    // start / finish checker
    var chk = strip(g, sRange(0, 1.2, 0.3), -hw, hw, 0.02, function (d) { return (d + hw) / (2 * hw); }, function (s) { return s / 1.2; });
    var chkMat = MATS.chk || (MATS.chk = polyMat(std({ map: checkerTex(), roughness: 0.6 }), -4)); chkMat.map.wrapS = chkMat.map.wrapT = THREE.ClampToEdgeWrapping;
    group.add(new THREE.Mesh(chk, chkMat)); chk.computeVertexNormals();
    // the start gantry: two towers outside the walls and a beam with a chequered banner and lights
    (function () {
      var p0 = D.pointAt(g, 0.6, 0), y0 = GY(0.6), m = mtx(p0.x, y0, p0.z, -p0.h), span = lim + 0.9, top = 4.6;
      [-1, 1].forEach(function (sd) {
        b.add('metal', box(0.4, top + 0.6, 0.4).translate(0, 0, sd * span), m, col('#c8ccd2'));
        b.add('plain', box(0.7, 0.3, 0.7).translate(0, 0, sd * span), m, col('#555a60'));
      });
      b.add('metal', box(0.5, 0.55, 2 * span + 0.4).translate(0, top, 0), m, col('#d8dce2'));
      var ban = new THREE.Mesh(new THREE.PlaneGeometry(2 * span - 0.6, 0.9), std({ map: signTex('START  ·  FINISH', '#1a1a22', '#ffffff', 1024, 128), roughness: 0.6 }));
      ban.position.set(p0.x - Math.cos(p0.h) * 0.27, y0 + top - 0.5, p0.z - Math.sin(p0.h) * 0.27); ban.rotation.y = Math.atan2(-Math.cos(p0.h), -Math.sin(p0.h)); group.add(ban);
      for (var k = 0; k < 5; k++) { var lg = new THREE.SphereGeometry(0.13, 10, 6); lg.translate(-0.28, top + 0.27, -1.6 + k * 0.8); b.add('glow', lg, m, k < 3 ? col('#ff3a2a') : col('#3aff6a')); }
    })();
    // boost pads: a dark frame and a glowing chevron plate whose arrows run forward
    var padMat = MATS.pad || (MATS.pad = polyMat(std({ map: T('pad'), emissiveMap: T('pad'), emissive: col('#ffffff'), emissiveIntensity: 1.25, roughness: 0.4 }), -5));
    var frameMat = MATS.padFrame || (MATS.padFrame = polyMat(std({ color: col('#2a2a30'), roughness: 0.5, metalness: 0.6 }), -4));
    g.pads.forEach(function (pd) {
      var list = sRange(pd.s - D.PAD_LEN / 2, pd.s + D.PAD_LEN / 2, 0.6);
      var fr = strip(g, sRange(pd.s - D.PAD_LEN / 2 - 0.12, pd.s + D.PAD_LEN / 2 + 0.12, 0.6), pd.off - D.PAD_W / 2 - 0.12, pd.off + D.PAD_W / 2 + 0.12, 0.022);
      b0.add('padFrame', fr, new THREE.Matrix4());
      b0.add('pad', strip(g, list, pd.off - D.PAD_W / 2, pd.off + D.PAD_W / 2, 0.026, null, function (s) { return (s - pd.s + D.PAD_LEN / 2) / D.PAD_LEN; }), new THREE.Matrix4());
    });
    padMat.name = 'pad'; frameMat.name = 'padFrame';
    b0.build(group, { cast: false });
    anim.push(function (t) { padMat.map.offset.y = -t * 1.6; });
    // ramps: the deck rises linearly over len to h (as the logic lifts car.y), with braced wooden sides
    g.ramps.forEach(function (m) {
      var W2 = hw + 0.3, list = sRange(m.s, m.s + m.len, m.len / 8), drop = m.gap ? 1.4 : 0;
      var deck = strip(g, list, -W2, W2, function (s) { return (s - m.s) / m.len * m.h + 0.015; }, function (d) { return (d + W2) / (2 * W2); }, function (s) { return (s - m.s) / m.len * 1.5; });
      b.add('rampDeck', deck, new THREE.Matrix4(), WHITE, m.x, m.z);
      [-1, 1].forEach(function (sd) {
        var side = [], sidx = [], k = 0;
        list.forEach(function (s, j) { var p = D.pointAt(g, s, sd * W2), gy = GY(s), y = (s - m.s) / m.len * m.h + gy; side.push(p.x, gy - 0.3, p.z, p.x, y, p.z); if (j) { sidx.push(k - 2, k - 1, k, k - 1, k + 1, k); } k += 2; });
        var sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(side, 3));
        var suv = []; for (var q = 0; q < side.length / 3; q++) suv.push(q * 0.2, side[q * 3 + 1]); sg.setAttribute('uv', new THREE.Float32BufferAttribute(suv, 2));
        sg.setIndex(sidx); sg.computeVertexNormals(); b.add('plank', sg, new THREE.Matrix4(), col('#8a6038'), m.x, m.z);
      });
      var lipL = D.pointAt(g, m.s + m.len, -W2), lipR = D.pointAt(g, m.s + m.len, W2), lip = new THREE.BufferGeometry(), ly = GY(m.s + m.len);
      lip.setAttribute('position', new THREE.Float32BufferAttribute([lipL.x, ly - drop, lipL.z, lipR.x, ly - drop, lipR.z, lipR.x, ly + m.h, lipR.z, lipL.x, ly + m.h, lipL.z], 3));
      lip.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2 * W2, 0, 2 * W2, m.h + drop, 0, m.h + drop], 2)); lip.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]); lip.computeVertexNormals();
      b.add('plank', lip, new THREE.Matrix4(), col('#6a4a2c'), m.x, m.z);
      // arrow signs either side of the run-up
      [-1, 1].forEach(function (sd) { var p = D.pointAt(g, m.s - 1.5, sd * (hw + 1.2)); var mm = mtx(p.x, GY(m.s - 1.5), p.z, -p.h); b.add('metal', box(0.08, 1.0, 0.08), mm, col('#bbbbbb')); b.add('plain', box(0.06, 0.5, 0.8).translate(0, 1.0, 0), mm, col('#ffcc22')); });
    });
    // creeks: water lying level in each channel, and stepping stones / reeds along the banks
    F.creeks.forEach(function (c) {
      var e0 = -c.ext[0] - 4, e1 = c.ext[1] + 4, n = Math.ceil((e1 - e0) / 1), pos = [], uv = [], idx = [];
      for (var k = 0; k <= n; k++) {
        var nn = e0 + (e1 - e0) * k / n, an = Math.abs(nn), wig = Math.sin(nn * 0.13 + F.creeks.indexOf(c)) * 1.6 * smooth(lim + 2, lim + 12, an), e = nn < 0 ? c.ext[0] : c.ext[1];
        var half = (c.half + (c.canyon ? 0.2 : 0.55)) * (an > e ? Math.sqrt(Math.max(0.01, 1 - Math.pow((an - e) / 4, 2))) : 1);
        [-half, half].forEach(function (tt) { var x = c.x + c.nx * nn + c.tx * (tt + wig), z = c.z + c.nz * nn + c.tz * (tt + wig); pos.push(x, c.y0 + c.water, z); uv.push(x / 6, z / 6); });
        if (k) { var a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      var wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); wg.setIndex(idx); wg.computeVertexNormals();
      if (wg.attributes.normal.getY(0) < 0) { for (var q = 0; q < idx.length; q += 3) { var tq = idx[q + 1]; idx[q + 1] = idx[q + 2]; idx[q + 2] = tq; } wg.setIndex(idx); wg.computeVertexNormals(); }
      var wm = MATS['water' + worldId + (c.canyon ? 'c' : '')];
      if (!wm) {
        var nt = T('waterN').clone(); nt.needsUpdate = true; nt.repeat.set(1, 1);
        wm = MATS['water' + worldId + (c.canyon ? 'c' : '')] = std({ color: col(c.canyon ? '#4a7a6a' : L.water), emissive: col(!c.canyon && L.waterGlow || '#000000'), emissiveIntensity: L.waterGlow ? 1.4 : 0, roughness: 0.12, metalness: 0.0, normalMap: nt, normalScale: new THREE.Vector2(0.3, 0.3), transparent: true, opacity: 0.9, envMapIntensity: 0.55 });
        anim.push(function (t) { nt.offset.set(t * 0.02, t * 0.035); });
      }
      var w = new THREE.Mesh(wg, wm); w.receiveShadow = true; w.renderOrder = 2; group.add(w);
      // reeds and stones by the water (hills); boulders in the canyon
      for (var k2 = 0; k2 < 40; k2++) {
        var nn2 = lerp(-c.ext[0], c.ext[1], r()), side = r() < 0.5 ? -1 : 1;
        if (Math.abs(nn2) < lim + 1) continue;
        var tt2 = side * (c.half + 0.6 + r() * 1.2), x = c.x + c.nx * nn2 + c.tx * tt2, z = c.z + c.nz * nn2 + c.tz * tt2, y = F.height(x, z);
        if (c.canyon || L.bank === 'redrock') addProto(b, 'redrock', mtx(x, y - 0.1, z, r() * 6.3, 0.4 + r() * 0.5), WHITE);
        else if (L.bank && L.bank !== 'reeds') addProto(b, L.bank, mtx(x, y - 0.1, z, r() * 6.3, 0.4 + r() * 0.5), WHITE);
        else if (r() < 0.6) addProto(b, 'tuftReed', mtx(x, y, z, r() * 6.3, 1), WHITE); else addProto(b, 'rock', mtx(x, y - 0.1, z, r() * 6.3, 0.3 + r() * 0.4), WHITE);
      }
    });

    // walls where the logic bounces cars: a white post-and-rail fence (hills) or armco (canyon), tyre stacks on the
    // outside of bends; broken where the creeks run
    var gaps = g.ramps.filter(function (m) { return m.gap; });
    function wet(s) { return gaps.some(function (m) { var a = ((s - m.s - m.len + 1.2) % g.L + g.L) % g.L; return a < m.gap + 2.4; }); }
    [-1, 1].forEach(function (sd) {
      var wd = sd * (lim + 0.62), run = [];
      function flush() {
        if (run.length < 2) { run = []; return; }
        if (WALLS[L.wall]) WALLS[L.wall](b, g, run, wd, sd, GY);
        else if (L.wall === 'armco') {
          // armco: a W-section beam on posts
          var ag = strip(g, run, 0, 0, 0, null, null, null, 1), P = [], I = [], U = [], k = 0;
          run.forEach(function (s, j) { var p = D.pointAt(g, s, wd), gy = GY(s); [0.32, 0.47, 0.62].forEach(function (y, q) { var o = q === 1 ? -sd * 0.05 : 0; var pp = D.pointAt(g, s, wd + o); P.push(pp.x, y + gy, pp.z); U.push(s, y); }); if (j) { var a0 = (j - 1) * 3; I.push(a0, a0 + 3, a0 + 1, a0 + 1, a0 + 3, a0 + 4, a0 + 1, a0 + 4, a0 + 2, a0 + 2, a0 + 4, a0 + 5); } });
          var bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); bg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); bg.setIndex(I); bg.computeVertexNormals();
          var p0 = D.pointAt(g, run[0], wd); b.add('metal', bg, new THREE.Matrix4(), col('#c4c8cc'), p0.x, p0.z);
          for (var q = 0; q < run.length; q += 4) { var pp = D.pointAt(g, run[q], wd + sd * 0.12); b.add('metal', box(0.08, 0.7, 0.14), mtx(pp.x, GY(run[q]) - 0.1, pp.z, -pp.h), col('#8a9098')); }
        } else {
          for (var q2 = 0; q2 < run.length; q2 += 4) { var pq = D.pointAt(g, run[q2], wd); b.add('plank', box(0.12, 0.9, 0.12), mtx(pq.x, GY(run[q2]) - 0.1, pq.z, -pq.h + 0.0), col('#f2efe6')); }
          [0.42, 0.74].forEach(function (y) {
            var P = [], I = [], U = [];
            run.forEach(function (s, j) { var gy = GY(s); [y - 0.07, y + 0.07].forEach(function (yy) { var pp = D.pointAt(g, s, wd + sd * 0.07); P.push(pp.x, yy + gy, pp.z); U.push(s * 0.5, yy * 2); }); if (j) { var a0 = (j - 1) * 2; I.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); } });
            var rg2 = new THREE.BufferGeometry(); rg2.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); rg2.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); rg2.setIndex(I); rg2.computeVertexNormals();
            var p1 = D.pointAt(g, run[0], wd); b.add('plankDS', rg2, new THREE.Matrix4(), col('#f4f1ea'), p1.x, p1.z);
          });
        }
        run = [];
      }
      for (var s = 0; s <= g.L; s += 0.5) {
        if (wet(s) || run.length > 60) { if (run.length) { var last = run[run.length - 1]; flush(); if (!wet(s)) run.push(last); } if (wet(s)) continue; }
        run.push(Math.min(s, g.L));
      }
      flush();
      // tyre stacks on the outside of bends, in front of the wall
      for (s = 0; s < g.L; s += 0.72) {
        var p = D.pointAt(g, s, sd * (lim + 0.32));
        if (p.k * sd < -0.045 && !wet(s)) { var stackN = Math.floor(s / 0.72); addProto(b, 'tyres', mtx(p.x, GY(s), p.z, r() * 6.3), stackN % 2 ? col('#e8e8e8') : col('#c8281e'), p.x, p.z); }
      }
    });

    // scenery: buildings set well back, woods in clumps, a band of trees past the fences, rocks, hay
    var placed = [];
    function farFrom(x, z, m) { return !placed.some(function (p) { return Math.hypot(p[0] - x, p[1] - z) < m + p[2]; }); }
    var kinds = (L.trackKinds && L.trackKinds[trackId]) || L.kinds;
    var mills = [];
    for (i = 0; i < 500 && placed.length < 10; i++) {
      var x = g.x0 + 8 + r() * (g.w - 16), z = g.z0 + 8 + r() * (g.h - 16);
      if (!F.clear(x, z, 7) || !farFrom(x, z, 9)) continue;
      var kd = kinds[placed.length % kinds.length], q = g.query(x, z), face = Math.atan2(q.pz - z, q.px - x), y = F.height(x, z) - 0.05;
      placed.push([x, z, 3]);
      // face the road: local +z toward it
      var m = mtx(x, y, z, Math.PI / 2 - face);
      if (kd === 'windmill') { windmillTower(b, m); var sails = windmillSails(); sails.position.set(x + Math.cos(face) * 1.25, y + 4.1, z + Math.sin(face) * 1.25); sails.rotation.y = Math.PI / 2 - face; group.add(sails); mills.push(sails); }
      else if (kd === 'barn') barn(b, m);
      else if (kd === 'adobe') adobe(b, m);
      else if (BUILD[kd]) BUILD[kd](b, m, r, group, anim);
      else if (kd === 'butte') { var bg2 = butteGeo(2.2 + r() * 1.6, 5 + r() * 5, r() * 9); b.add('strata', bg2, m, WHITE); }
      else house(b, m, kd, r);
      // a few hay bales or a fence round farms
      if (L.farmHay && (kd === 'barn' || kd === 'windmill')) for (var hb = 0; hb < 4; hb++) { var hx = x + (r() - 0.5) * 9, hz = z + (r() - 0.5) * 9; if (F.clear(hx, hz, 2) && farFrom(hx, hz, 0.6)) addProto(b, 'hay', mtx(hx, F.height(hx, hz) - 0.05, hz, r() * 6.3), WHITE); }
    }
    anim.push(function (t) { mills.forEach(function (s, k) { s.rotation.z = t * 0.9 + k; }); });
    // the grandstand by the start, facing the road
    var st = D.pointAt(g, -6, -(lim + 3.4)); grandstand(b, mtx(st.x, F.height(st.x, st.z), st.z, -st.h), r); placed.push([st.x, st.z, 5]);
    // trees
    var species = L.species;
    function pick(v) { for (var k = 0; k < species.length; k++) if (v < species[k][1]) return species[k][0]; return species[0][0]; }
    var trees = 0, maxTrees = L.maxTrees || 520;
    function tree(x, z, name, scale) {
      var y = F.height(x, z), ry = r() * 6.3, tint = new THREE.Color().setHSL(0, 0, 1);
      if (!UNTINTED[name]) tint.setRGB(0.85 + r() * 0.3, 0.85 + r() * 0.3, 0.8 + r() * 0.25);
      addProto(b, name, mtx(x, y - 0.05, z, ry, scale, scale * (0.9 + r() * 0.2), scale), tint, x, z); trees++;
    }
    for (i = 0; i < 20000 && trees < maxTrees; i++) {
      var tx = F.x0 + r() * F.w, tz = F.z0 + r() * F.h, dd = F.distAt(tx, tz);
      var dens = smooth(0.42, 0.62, fbm(tx * 0.03, tz * 0.03, 3, 601)) * (L.treeDens || 1) + (dd < lim + 14 ? 0.15 : 0);
      if (r() > dens) continue;
      if (!F.clear(tx, tz, 1.8) || !farFrom(tx, tz, 1.2)) continue;
      var ts = L.treeScale || [0.85, 0.75], nm = pick(r()), sc = (ts[0] + r() * ts[1]) * (LOW[nm] ? 1 : 1.25);
      tree(tx, tz, nm, sc); if (!SMALL[nm]) placed.push([tx, tz, 0.8]);
    }
    // a band just past the fences (thinner so the view stays open)
    for (var bs = 0; bs < g.L; bs += 3.2) [-1, 1].forEach(function (sd) {
      if (r() < 0.45) return;
      var bp = D.pointAt(g, bs + r() * 2, sd * (lim + 2.6 + r() * 7));
      if (!F.clear(bp.x, bp.z, 1.8) || !farFrom(bp.x, bp.z, 1.4)) return;
      var nm2 = L.band[Math.floor(r() * L.band.length)];
      tree(bp.x, bp.z, nm2, 0.8 + r() * 0.5); placed.push([bp.x, bp.z, 0.6]);
    });
    // palms round the water at the jumps (canyon oasis)
    if (L.palms && (L.canyons || []).indexOf(trackId) < 0) F.creeks.forEach(function (c) {
      for (var k = 0; k < 14; k++) { var nn = lerp(-c.ext[0], c.ext[1], r()), side = r() < 0.5 ? -1 : 1, x2 = c.x + c.nx * nn + c.tx * side * (c.half + 1.4 + r() * 3), z2 = c.z + c.nz * nn + c.tz * side * (c.half + 1.4 + r() * 3); if (F.clear(x2, z2, 0.6)) { addProto(b, 'palm', mtx(x2, F.height(x2, z2) - 0.05, z2, r() * 6.3, 0.9 + r() * 0.4), WHITE); } }
    });
    // hay bales (or desert shrubs) by the road here and there
    for (var hs = 8; hs < g.L; hs += 23 + r() * 20) { var sd2 = r() < 0.5 ? -1 : 1, hp = D.pointAt(g, hs, sd2 * (lim + 1.5)); if (F.clear(hp.x, hp.z, 1) && farFrom(hp.x, hp.z, 0.5)) addProto(b, L.roadside || 'hay', mtx(hp.x, F.height(hp.x, hp.z) - 0.03, hp.z, r() * 6.3), WHITE); }
    // desert: big mesas out in the far land
    if (FAR[L.far]) FAR[L.far](b, F, r, group, anim);
    else if (L.far === 'mesas') for (var mi = 0; mi < 14; mi++) {
      var ma = r() * 6.3, mr = 0.5 * Math.hypot(F.w, F.h) + 30 + r() * 140, mx = F.x0 + F.w / 2 + Math.cos(ma) * mr, mz = F.z0 + F.h / 2 + Math.sin(ma) * mr;
      if (F.distAt(mx, mz) < 40) continue;
      b.add('strata', butteGeo(10 + r() * 16, 14 + r() * 22, r() * 9), mtx(mx, -1, mz, r() * 6.3), WHITE, mx, mz);
    }
    var built = b.build(group);
    built.forEach(function (mm) { info.tris += mm.geometry.index.count / 3; });
    // hazards: posed by the renderer each frame from the race time
    var hazards = (g.hazards || []).map(function (hz) { var o = hazardObj(hz.kind); group.add(o); return o; });
    // grass tufts and flowers, instanced, thick in the runoff and along the fences
    info.tris += tufts(group, F, g, L, r);
    info.build = Math.round(performance.now() - t0);
    group.traverse(function (o) { if (o.isMesh && o.name !== 'sky') o.matrixAutoUpdate = false, o.updateMatrix(); });
    return {
      group: group, light: lt, look: L, field: F, info: info, hazards: hazards, heightAt: function (x, z) { return F.height(x, z); },
      update: function (t) { TIME.value = t; anim.forEach(function (f) { f(t); }); },
      dispose: function () { disposeGroup(group); }
    };
  }
  PROTOS.tuftReed = function () { var p = []; for (var i = 0; i < 6; i++) { var g = cyl(0.015, 0.025, 0.7 + i * 0.08, 4); g.rotateZ((i - 3) * 0.08); g.rotateY(i); paint(g, col('#6a8a3a')); p.push({ mat: 'plain', g: g }); } return p; };
  function tufts(group, F, g, L, r) {
    var tg = proto('tuft'), lim = F.lim, list = [], i;
    var tk = 'tuft' + L.tuftC;
    var mat = MATS[tk] || (MATS[tk] = (function () {
      var m = std({ map: T('tuft'), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: false, roughness: 0.9, color: col(L.tuftC || '#e8ffd0') });
      addHooks(m, [function (sh) { sway(sh, { k: '0.12', inst: true }); }]); m.name = tk; return m;
    })());
    var N = L.tuftN != null ? L.tuftN : 4500, m4 = new THREE.Matrix4();
    for (i = 0; i < N * 4 && list.length < N; i++) {
      var s = r() * g.L, side = r() < 0.5 ? -1 : 1, off = g.hw + 0.5 + Math.pow(r(), 1.6) * (D.RUNOFF + 12), p = D.pointAt(g, s, side * off);
      var x = p.x + (r() - 0.5) * 0.5, z = p.z + (r() - 0.5) * 0.5, d = F.distAt(x, z);
      if (d < g.hw + 0.5) continue;
      var ck = F.creekAt(x, z); if (ck && ck.p > 0.02) continue;
      if (Math.abs(d - (lim + 0.62)) < 0.15) continue;
      var sc = 0.35 + r() * 0.35 + (d > lim ? 0.15 : 0);
      list.push([x, F.height(x, z), z, r() * 6.3, sc]);
    }
    // a scatter further out too
    for (i = 0; i < N * 0.4; i++) { var x2 = F.x0 + r() * F.w, z2 = F.z0 + r() * F.h; if (F.clear(x2, z2, 1)) list.push([x2, F.height(x2, z2), z2, r() * 6.3, 0.5 + r() * 0.4]); }
    var im = new THREE.InstancedMesh(tg, mat, list.length), cc = new THREE.Color();
    list.forEach(function (t, k) {
      m4.compose(_v.set(t[0], t[1] - 0.02, t[2]), _q.setFromAxisAngle(_up, t[3]), _s.set(t[4] * 1.1, t[4], t[4] * 1.1)); im.setMatrixAt(k, m4);
      var v = 0.75 + r() * 0.35; cc.setRGB(v * (0.9 + r() * 0.2), v, v * (0.85 + r() * 0.2)); im.setColorAt(k, cc);
    });
    im.receiveShadow = true; im.castShadow = false; im.frustumCulled = false; group.add(im);
    var tris = list.length * 6;
    if (L.flowers) {
      var fl = [];
      for (i = 0; i < 3000 && fl.length < 1400; i++) { var s2 = r() * g.L, sd = r() < 0.5 ? -1 : 1, pf = D.pointAt(g, s2, sd * (lim + 1 + r() * 14)); if (F.clear(pf.x, pf.z, 0.8)) fl.push([pf.x, F.height(pf.x, pf.z), pf.z, r() * 6.3, 0.25 + r() * 0.2]); }
      var fm = MATS.flowers || (MATS.flowers = (function () { var m = std({ map: T('flowers'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }); addHooks(m, [function (sh) { sway(sh, { k: '0.1', inst: true }); }]); m.name = 'flowers'; return m; })());
      var fi = new THREE.InstancedMesh(tg, fm, fl.length);
      fl.forEach(function (t, k) { m4.compose(_v.set(t[0], t[1] - 0.02, t[2]), _q.setFromAxisAngle(_up, t[3]), _s.set(t[4], t[4], t[4])); fi.setMatrixAt(k, m4); });
      fi.receiveShadow = true; fi.frustumCulled = false; group.add(fi); tris += fl.length * 6;
    }
    return tris;
  }
  // free per-scene geometry (materials and textures are shared and kept)
  function disposeGroup(group) {
    group.traverse(function (o) { if (o.geometry && !o.userData.keepGeo) o.geometry.dispose(); if (o.isInstancedMesh && o.dispose) o.dispose(); });
    if (group.parent) group.parent.remove(group);
  }
  // the geometry proto 'tuft' is shared by every track: never dispose it
  function markShared() { if (PROTO.tuft) PROTO.tuft.userData = { shared: true }; }

  // ---------- garage plaza ----------
  function hub(HUB) {
    var rows = HUB.rows, W = rows[0].length, H = rows.length, L = LOOK.hills, group = new THREE.Group(), b = new Batch(0), r = prng(77);
    group.add(makeSky(L)); var lt = lights(group, L);
    lt.sun.position.set(-30, 40, -12);
    function cell(x, z) { var row = rows[z]; return row ? row.charAt(x) : '#'; }
    function find(ch) { for (var z = 0; z < H; z++) { var x = rows[z].indexOf(ch); if (x >= 0) return { x: x + 0.5, z: z + 0.5 }; } return null; }
    // ground: grass all round, gently rolling away from the plaza
    var gp = [], gc = [], gu = [], gi = [], N = 70, step = 2, ox = -60, oz = -60, tmp = new THREE.Color(), cG = L.grass.map(col);
    function gh(x, z) { var dx = Math.max(-2 - x, x - (W + 2), 0), dz = Math.max(-2 - z, z - (H + 2), 0), dd = Math.hypot(dx, dz); return smooth(6, 40, dd) * (fbm(x * 0.03, z * 0.03, 3, 31) * 12); }
    for (var j = 0; j <= N; j++) for (var i = 0; i <= N; i++) {
      var x = ox + i * step, z = oz + j * step; gp.push(x, gh(x, z) - 0.01, z); gu.push(x / 4, z / 4);
      tmp.copy(cG[0]).lerp(cG[2], smooth(0.3, 0.7, fbm(x * 0.06, z * 0.06, 3, 33))).lerp(cG[1], 0.3 * fbm(x * 0.2, z * 0.2, 2, 35)); gc.push(tmp.r, tmp.g, tmp.b);
      if (i < N && j < N) { var k = j * (N + 1) + i; gi.push(k, k + N + 1, k + 1, k + 1, k + N + 1, k + N + 2); }
    }
    var gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gg.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(gu, 2)); gg.setIndex(gi); gg.computeVertexNormals();
    var ground = new THREE.Mesh(gg, terrainMat(L, false)); ground.receiveShadow = true; group.add(ground);
    // paving over the plaza (inside the wall), with a kerb edge
    var pave = MATS.pave || (MATS.pave = polyMat(std({ map: T('cobble'), normalMap: T('cobbleN'), roughness: 0.85, color: col('#e8e0d4') }), -1));
    var pg = new THREE.PlaneGeometry(W - 2, H - 2); pg.rotateX(-Math.PI / 2); pg.translate(W / 2, 0.01, H / 2); scaleUV(pg, (W - 2) / 2.2, (H - 2) / 2.2);
    var pm = new THREE.Mesh(pg, pave); pm.receiveShadow = true; group.add(pm);
    // the lot: asphalt with painted bays
    var lotX0 = 1, lotX1 = 8, lotZ0 = 10, lotZ1 = 13, rt = roadTex(3.6);
    var asph = MATS.lotAsph || (MATS.lotAsph = polyMat(std({ map: rt.map, roughnessMap: rt.rough, normalMap: rt.normal, roughness: 1 }), -2));
    var lg = new THREE.PlaneGeometry(lotX1 - lotX0, lotZ1 - lotZ0); lg.rotateX(-Math.PI / 2); lg.translate((lotX0 + lotX1) / 2, 0.02, (lotZ0 + lotZ1) / 2);
    var luv = lg.attributes.uv; for (i = 0; i < luv.count; i++) luv.setXY(i, 0.2 + luv.getX(i) * 0.15, luv.getY(i) * 0.3);
    var lm = new THREE.Mesh(lg, asph); lm.receiveShadow = true; group.add(lm);
    var lines = MATS.lines || (MATS.lines = polyMat(std({ color: col('#f2f0ea'), roughness: 0.6 }), -3));
    var bays = [];
    for (i = 0; i <= 7; i++) { var ln = new THREE.PlaneGeometry(0.06, 2.4); ln.rotateX(-Math.PI / 2); ln.translate(lotX0 + i, 0.03, lotZ0 + 1.25); group.add(new THREE.Mesh(ln, lines)); if (i < 7) bays.push({ x: lotX0 + i + 0.5, z: lotZ0 + 1.25, h: Math.PI / 2 }); }
    var lb = new THREE.PlaneGeometry(7, 0.06); lb.rotateX(-Math.PI / 2); lb.translate(4.5, 0.03, lotZ0 + 0.05); group.add(new THREE.Mesh(lb, lines));
    // a road leading out of the plaza to the tracks (east), and the gap in the wall
    var road = new THREE.PlaneGeometry(40, 3); road.rotateX(-Math.PI / 2); road.translate(W - 1 + 20, 0.015, 9.5);
    var ruv = road.attributes.uv; for (i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getY(i) * 0.8 + 0.1, ruv.getX(i) * 40 / 13);
    var roadMat = MATS.road36 || (MATS.road36 = polyMat(std({ map: rt.map, roughnessMap: rt.rough, normalMap: rt.normal, roughness: 1 }), -2));
    var rm = new THREE.Mesh(road, roadMat); rm.receiveShadow = true; group.add(rm);
    // the wall round the plaza: low stone with a hedge on top; open where the road leads out
    for (var z0 = 0; z0 < H; z0++) for (var x0 = 0; x0 < W; x0++) {
      if (cell(x0, z0) !== '#') continue;
      if (x0 === W - 1 && z0 >= 8 && z0 <= 10) continue;
      b.add('stone', box(1.0, 0.45, 1.0), mtx(x0 + 0.5, 0, z0 + 0.5, 0), col('#b0a898'));
      addProto(b, 'hedge', mtx(x0 + 0.5, 0.2, z0 + 0.5, r() * 6.3, 1, 0.9 + r() * 0.3, 1), new THREE.Color(0.9 + r() * 0.2, 0.9 + r() * 0.2, 0.9 + r() * 0.15));
    }
    // gate posts by the road
    [8, 11].forEach(function (zz) { b.add('stone', box(0.5, 1.4, 0.5), mtx(W - 0.5, 0, zz - (zz === 8 ? 0.25 : -0.25), 0), col('#c0b8a8')); });
    // the garage: brick, flat roof with a parapet, a roll-up door facing the plaza, a sign
    (function () {
      var x0 = 1, x1 = 6, z0 = 0.4, z1 = 4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, hgt = 2.6, m = mtx(cx, 0, cz, 0);
      b.add('brick', box(w, hgt, d), m, col('#b2593e'));
      b.add('stone', box(w + 0.15, 0.2, d + 0.15).translate(0, hgt, 0), m, col('#d8d0c0'));
      b.add('corrugated', box(2.4, 1.9, 0.08).translate(-0.3, 0, d / 2), m, col('#c8ccd4'));
      b.add('plain', box(2.6, 0.12, 0.12).translate(-0.3, 1.9, d / 2 + 0.02), m, col('#4a4a50'));
      b.add('glass', box(0.8, 0.7, 0.06).translate(1.75, 0.9, d / 2), m, col('#56708a'));
      b.add('plain', box(0.95, 0.1, 0.14).translate(1.75, 0.82, d / 2 + 0.03), m, col('#e8e4dc'));
      var sg = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7), std({ map: signTex('GARAGE', '#1f4a8a', '#ffe066'), roughness: 0.5, emissive: col('#ffffff'), emissiveIntensity: 0.15, emissiveMap: signTex('GARAGE', '#1f4a8a', '#ffe066') }));
      sg.position.set(cx - 0.3, 2.25, z1 + 0.06); group.add(sg);
      // tyres and a toolbox by the door
      addProto(b, 'tyres', mtx(4.9, 0, 4.3, 0, 0.9), col('#3a3a3a')); addProto(b, 'tyres', mtx(5.3, 0, 4.5, 0, 0.9), col('#d83a2a'));
      b.add('shiny', box(0.5, 0.6, 0.35), mtx(1.6, 0, 4.35, 0.2), col('#d8342a'));
    })();
    // the paint shop: stucco, a tiled gable roof, a striped awning over a shop window
    (function () {
      var x0 = 12, x1 = 17, z0 = 0.4, z1 = 4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, hgt = 2.0, m = mtx(cx, 0, cz, 0);
      b.add('stucco', box(w, hgt, d), m, col('#f2e2c4'));
      b.add('stucco', gableEnds(w, d, 1.3).translate(0, hgt, 0), m, col('#f2e2c4'));
      b.add('roof', gable(w, d, 1.35, 0.3).translate(0, hgt - 0.05, 0), m, col('#c0563a'));
      b.add('plank', box(0.7, 1.3, 0.06).translate(0.6, 0, d / 2), m, col('#2a6a8a'));
      b.add('glass', box(1.8, 1.0, 0.06).translate(-1.2, 0.4, d / 2), m, col('#6a8aa0'));
      b.add('plain', box(2.0, 0.1, 0.14).translate(-1.2, 0.33, d / 2 + 0.03), m, col('#f4f2ea'));
      for (var k = 0; k < 8; k++) { var aw = box(0.3, 0.05, 0.9); aw.rotateX(0.45); aw.translate(-2.25 + k * 0.3, 1.6, d / 2 + 0.38); b.add('cloth', aw, m, k % 2 ? col('#f4f2ea') : col('#d8342a')); }
      // paint tins by the door
      [['#e8342a', 0], ['#2a7ad8', 1], ['#f2c230', 2], ['#3aa84a', 3]].forEach(function (pt) { b.add('shiny', cyl(0.14, 0.14, 0.25, 10), mtx(14.9 + pt[1] * 0.35, 0, 4.3, 0), col(pt[0])); });
      var sg = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), std({ map: signTex('PAINT', '#c0306a', '#ffffff'), roughness: 0.5 }));
      sg.position.set(cx + 0.9, 1.75, z1 + 0.06); group.add(sg);
    })();
    // the car lot's sign and a little booth
    (function () {
      var sg = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), std({ map: signTex('CAR LOT', '#2a8a4a', '#ffffff'), roughness: 0.5, side: THREE.DoubleSide }));
      sg.position.set(4.5, 1.75, 9.7); group.add(sg);
      [3.45, 5.55].forEach(function (px) { b.add('metal', box(0.08, 1.75, 0.08), mtx(px, 0, 9.7, 0), col('#d8dce0')); });
      // bunting
      for (var k = 0; k < 14; k++) { var fl = new THREE.ConeGeometry(0.1, 0.22, 3); fl.rotateX(Math.PI); fl.translate(1.2 + k * 0.5, 2.05, 9.7); b.add('cloth', fl, new THREE.Matrix4(), [col('#e8342a'), col('#f2c230'), col('#2a7ad8'), col('#3aa84a')][k % 4]); }
    })();
    // the signpost to the tracks
    var T0 = find('T'), sp = T0 || { x: 15.5, z: 10.5 };
    b.add('plank', box(0.16, 2.4, 0.16), mtx(sp.x, 0, sp.z, 0), col('#8a6040'));
    [['#e8342a', 2.05, 0.25], ['#2a7ad8', 1.7, -0.3], ['#f2c230', 1.35, 0.15]].forEach(function (a) {
      var arrow = new THREE.Shape(); arrow.moveTo(-0.5, -0.14); arrow.lineTo(0.35, -0.14); arrow.lineTo(0.55, 0); arrow.lineTo(0.35, 0.14); arrow.lineTo(-0.5, 0.14); arrow.closePath();
      var ag = new THREE.ExtrudeGeometry(arrow, { depth: 0.05, bevelEnabled: false }); ag.translate(0.45, 0, -0.025); b.add('plain', ag, mtx(sp.x, a[1], sp.z, a[2]), col(a[0]));
    });
    var flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), std({ map: checkerTex(), side: THREE.DoubleSide, roughness: 0.7 })); flag.position.set(sp.x + 0.36, 2.2, sp.z); group.add(flag);
    // flower beds: a timber border, dark soil, flowers and small shrubs
    var beds = [];
    for (z0 = 0; z0 < H; z0++) for (x0 = 0; x0 < W; x0++) if (cell(x0, z0) === '~') beds.push([x0, z0]);
    beds.forEach(function (c) { b.add('plank', box(1.0, 0.22, 1.0), mtx(c[0] + 0.5, 0, c[1] + 0.5, 0), col('#7a5236')); b.add('plain', box(0.86, 0.04, 0.86).translate(0, 0.22, 0), mtx(c[0] + 0.5, 0, c[1] + 0.5, 0), col('#4a3424')); });
    var fl = [];
    beds.forEach(function (c) { for (var k = 0; k < 10; k++) fl.push([c[0] + 0.1 + r() * 0.8, 0.24, c[1] + 0.1 + r() * 0.8, r() * 6.3, 0.55 + r() * 0.25]); if (r() < 0.6) addProto(b, 'bush', mtx(c[0] + 0.5, 0.2, c[1] + 0.5, r() * 6.3, 0.4), WHITE); });
    // fountain: a round stone basin with water and a pillar with a bowl
    var oo = find('o'), fc = oo ? { x: oo.x + 0.5, z: oo.z + 0.5 } : { x: 10, z: 7 };
    b.add('stone', cyl(1.05, 1.1, 0.42, 20, 1), mtx(fc.x, 0, fc.z, 0), col('#c8c0b0'));
    b.add('stone', cyl(0.18, 0.24, 1.1, 10, 1), mtx(fc.x, 0, fc.z, 0), col('#c8c0b0'));
    var bowl = new THREE.SphereGeometry(0.45, 14, 6, 0, 6.3, Math.PI / 2, Math.PI / 2); bowl.translate(0, 1.15, 0); b.add('stone', bowl, mtx(fc.x, 0, fc.z, 0), col('#c8c0b0'));
    var wm = MATS.hubWater || (MATS.hubWater = std({ color: col('#3a8aa8'), roughness: 0.05, normalMap: T('waterN'), normalScale: new THREE.Vector2(0.3, 0.3), transparent: true, opacity: 0.9 }));
    var wgeo = new THREE.CircleGeometry(0.95, 24); wgeo.rotateX(-Math.PI / 2); wgeo.translate(fc.x, 0.36, fc.z); group.add(new THREE.Mesh(wgeo, wm));
    var wgeo2 = new THREE.CircleGeometry(0.4, 16); wgeo2.rotateX(-Math.PI / 2); wgeo2.translate(fc.x, 1.12, fc.z); group.add(new THREE.Mesh(wgeo2, wm));
    // benches and lamps round the plaza
    var lamps = [[1.5, 5.4], [18.5, 5.4], [9.2, 13.5], [11.5, 9.0], [18.5, 12.5]];
    var lampLights = [];
    lamps.forEach(function (lp, k) {
      b.add('metal', cyl(0.05, 0.07, 2.3, 8), mtx(lp[0], 0, lp[1], 0), col('#2a2e34'));
      b.add('metal', box(0.26, 0.06, 0.26).translate(0, 2.3, 0), mtx(lp[0], 0, lp[1], 0), col('#2a2e34'));
      var gl = new THREE.SphereGeometry(0.13, 10, 6); gl.translate(0, 2.2, 0); b.add('glow', gl, mtx(lp[0], 0, lp[1], 0), col('#ffd890'));
      if (k < 3) { var pl = new THREE.PointLight(col('#ffc878'), 3, 6, 1.6); pl.position.set(lp[0], 2.0, lp[1]); group.add(pl); lampLights.push(pl); }
    });
    [[7.5, 5.2, 0], [12.5, 5.2, 0], [8.2, 8.9, Math.PI]].forEach(function (bn) {
      var m = mtx(bn[0], 0, bn[1], bn[2]);
      b.add('plank', box(1.2, 0.06, 0.4).translate(0, 0.38, 0), m, col('#9a6a40')); b.add('plank', box(1.2, 0.35, 0.05).translate(0, 0.45, -0.18), m, col('#9a6a40'));
      [-0.5, 0.5].forEach(function (lx) { b.add('metal', box(0.06, 0.38, 0.36).translate(lx, 0, 0), m, col('#2a2e34')); });
    });
    // a fuel pump and barrels by the garage
    b.add('shiny', box(0.45, 1.1, 0.35), mtx(6.6, 0, 4.4, 0), col('#e8c22a')); b.add('glass', box(0.3, 0.25, 0.05).translate(0, 0.65, 0.18), mtx(6.6, 0, 4.4, 0), col('#2a3a48'));
    [[18.2, 1.2], [18.5, 1.7], [17.9, 1.6]].forEach(function (br) { b.add('metal', cyl(0.22, 0.22, 0.65, 12), mtx(br[0], 0, br[1], 0), col('#3a6aa8')); });
    // woods round the plaza, beyond the wall; only low bushes on the near sides (toward the camera)
    var kinds = ['oak', 'elm', 'pine', 'birch', 'oak', 'pine'], trees = [];
    for (var k2 = 0; k2 < 1200 && trees.length < 160; k2++) {
      var tx = -24 + r() * (W + 48), tz = -24 + r() * (H + 48);
      if (tx > -1.4 && tx < W + 0.4 && tz > -1.4 && tz < H + 0.4) continue;
      if (tx > W - 2 && tz > 6.5 && tz < 12.5) continue;
      if (trees.some(function (t) { return Math.hypot(t[0] - tx, t[1] - tz) < 1.6; })) continue;
      var nearSide = tz > H - 0.5 || tx > W - 0.5, gap = Math.max(-tx, -tz, tx - W, tz - H);
      var nm = nearSide ? (gap > 9 ? kinds[Math.floor(r() * kinds.length)] : r() < 0.6 ? 'bush' : 'rock') : kinds[Math.floor(r() * kinds.length)];
      if (nearSide && gap < 4 && r() < 0.5) continue;
      trees.push([tx, tz]);
      var sc = nm === 'bush' || nm === 'rock' ? 0.8 + r() * 0.5 : 0.8 + r() * 0.6;
      addProto(b, nm, mtx(tx, gh(tx, tz) - 0.05, tz, r() * 6.3, sc), new THREE.Color(0.85 + r() * 0.3, 0.85 + r() * 0.3, 0.85 + r() * 0.2));
    }
    // houses up the hill behind the plaza
    [[-8, -9, 'house'], [4, -12, 'house2'], [16, -10, 'barn'], [-14, 4, 'house2'], [26, -6, 'house']].forEach(function (hs) {
      var hy = gh(hs[0], hs[1]) - 0.1, m = mtx(hs[0], hy, hs[1], Math.atan2(W / 2 - hs[0], H / 2 - hs[1]));
      if (hs[2] === 'barn') barn(b, m); else house(b, m, hs[2], r);
    });
    b.build(group);
    // tufts of grass outside the wall
    var tl = []; for (k2 = 0; k2 < 900; k2++) { var gx = -14 + r() * (W + 28), gz = -14 + r() * (H + 28); if (gx > -0.2 && gx < W + 0.2 && gz > -0.2 && gz < H + 0.2) continue; tl.push([gx, gh(gx, gz), gz, r() * 6.3, 0.35 + r() * 0.35]); }
    var im = new THREE.InstancedMesh(proto('tuft'), MATS.tufffalse || (function () { var m = std({ map: T('tuft'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, color: col('#e8ffd0') }); addHooks(m, [function (sh) { sway(sh, { k: '0.12', inst: true }); }]); MATS.tufffalse = m; return m; })(), tl.length), m4 = new THREE.Matrix4();
    tl.forEach(function (t, k) { m4.compose(_v.set(t[0], t[1], t[2]), _q.setFromAxisAngle(_up, t[3]), _s.set(t[4], t[4], t[4])); im.setMatrixAt(k, m4); });
    im.receiveShadow = true; im.frustumCulled = false; group.add(im);
    var fm = MATS.flowers || (MATS.flowers = (function () { var m = std({ map: T('flowers'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }); addHooks(m, [function (sh) { sway(sh, { k: '0.1', inst: true }); }]); m.name = 'flowers'; return m; })());
    var fim = new THREE.InstancedMesh(proto('tuft'), fm, fl.length); fl.forEach(function (t, k) { m4.compose(_v.set(t[0], t[1], t[2]), _q.setFromAxisAngle(_up, t[3]), _s.set(t[4], t[4], t[4])); fim.setMatrixAt(k, m4); }); group.add(fim);
    // pads: glowing rings
    var pads = [], ringMat = new THREE.MeshBasicMaterial({ color: col('#ffd23f'), transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false });
    var discMat = new THREE.MeshBasicMaterial({ color: col('#ffb020'), transparent: true, opacity: 0.25, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    Object.keys(HUB.pads).forEach(function (ch) {
      var p = find(ch); if (!p) return;
      var ring = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.72, 40), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.04, p.z); group.add(ring);
      var disc = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), discMat); disc.rotation.x = -Math.PI / 2; disc.position.set(p.x, 0.035, p.z); group.add(disc);
      pads.push({ ch: ch, station: HUB.pads[ch], x: p.x, z: p.z, ring: ring, disc: disc });
    });
    var anim = function (t) {
      TIME.value = t; var pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ringMat.opacity = 0.7 + 0.3 * pulse; discMat.opacity = 0.15 + 0.15 * pulse;
      pads.forEach(function (p) { var s = 1 + 0.06 * pulse; p.ring.scale.set(s, s, 1); });
      wm.normalMap.offset.set(t * 0.05, t * 0.07);
      flag.rotation.y = Math.sin(t * 2.2) * 0.15;
    };
    group.traverse(function (o) { if (o.isMesh && o.name !== 'sky' && !o.isInstancedMesh) { o.updateMatrix(); } });
    return { group: group, light: lt, look: L, bays: bays, pads: pads, fountain: fc, lamps: lamps, update: anim, dispose: function () { disposeGroup(group); } };
  }

  return { race: race, hub: hub, LOOK: LOOK, lookOf: lookOf, TIME: TIME, setAnisotropy: function (n) { ANISO = n; },
    util: { prng: prng, fbm: fbm, smooth: smooth, Batch: Batch, box: box, cyl: cyl, paint: paint, col: col, mtx: mtx, MAT: function (n) { return MAT(n); } } };
})();
