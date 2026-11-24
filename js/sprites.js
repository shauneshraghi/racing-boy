// Racing Boy: pixel art drawn in code (RBSprites). Cars are small box models rendered per heading into tiny
// canvases, hard-edged and outlined, so paint, wheels, spoilers and exhausts compose at every angle. The kid
// driver and the scenery are letter grids recoloured by palettes, like Dig Through Worlds' characters.
var RBSprites = (function () {
  'use strict';
  var D = RB;
  var HW = 12, HH = 6, BH = 12;      // sprite pixels per cell: half tile width, half tile height, one cell of height
  var HEADINGS = 32;
  var OUTLINE = [26, 20, 36];

  function hex3(h) { var c = parseInt(h.slice(1, 7), 16); return [c >> 16, c >> 8 & 255, c & 255]; }
  function shadeRGB(rgb, k) { return 'rgb(' + rgb.map(function (v) { return Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1)))); }).join(',') + ')'; }
  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }
  // hard edges: drop half-covered pixels, then ring the shape with an outline in a darkened shade of the colour it
  // borders (outline: a number from 0, the near-black OUTLINE, to 1, the colour itself; false for none), so edges
  // read as in HD-2D sprites rather than as a cartoon black line
  function crisp(c, outline) {
    var x = c.getContext('2d'), im = x.getImageData(0, 0, c.width, c.height), d = im.data, w = c.width, h = c.height, i;
    for (i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    var k = outline === false ? -1 : typeof outline === 'number' ? outline : 0.3;
    if (k >= 0) {
      var src = new Uint8ClampedArray(d), nb = [-4, 4, -w * 4, w * 4];
      for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
        var j = (y * w + xx) * 4; if (src[j + 3]) continue;
        var r = 0, g = 0, b = 0, n = 0, ok = [xx > 0, xx < w - 1, y > 0, y < h - 1];
        for (var q = 0; q < 4; q++) if (ok[q] && src[j + nb[q] + 3]) { r += src[j + nb[q]]; g += src[j + nb[q] + 1]; b += src[j + nb[q] + 2]; n++; }
        if (!n) continue;
        d[j] = OUTLINE[0] + (r / n - OUTLINE[0]) * k; d[j + 1] = OUTLINE[1] + (g / n - OUTLINE[1]) * k; d[j + 2] = OUTLINE[2] + (b / n - OUTLINE[2]) * k; d[j + 3] = 255;
      }
    }
    x.putImageData(im, 0, 0);
    return c;
  }

  // ---------- materials ----------
  // a material is a seamless overlay of dark seams and light edges in texels, T texels to a cell, laid over a face's
  // flat colour so one material serves every colour: brick, roof tile, slate, plank, stone, stucco, rock strata
  function prng(seed) { var a = seed | 0; return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  var matCache = {};
  function material(name, T) {
    var key = name + '|' + T; if (matCache[key]) return matCache[key];
    var r = prng(name.length * 977 + T), c, x;
    function cv(w, h) { c = mkCanvas(w, h); x = c.getContext('2d'); }
    function px(a, b, w, hh, col) { x.fillStyle = col; x.fillRect(a, b, w, hh); }
    function tone(a) { return a > 0 ? 'rgba(255,236,200,' + a + ')' : 'rgba(20,10,8,' + -a + ')'; }
    function wrapRect(a, b, w, hh, col, W) { a = ((a % W) + W) % W; px(a, b, w, hh, col); if (a + w > W) px(a - W, b, w, hh, col); }
    var rh, bw, row, k, a;
    if (name === 'brick' || name === 'tile' || name === 'slate') {
      // courses of bricks or tiles, every other one offset by half
      rh = Math.max(2, Math.round(T * (name === 'brick' ? 0.17 : 0.2))); bw = Math.max(3, Math.round(T * (name === 'brick' ? 0.36 : name === 'tile' ? 0.15 : 0.24)));
      var cols = Math.max(2, Math.round(16 / bw)) * 2, W = bw * cols; cv(W, rh * 4);
      for (row = 0; row < 4; row++) for (k = 0; k < cols; k++) {
        a = k * bw + (row % 2 ? bw >> 1 : 0); var y = row * rh;
        wrapRect(a, y, bw, rh, tone((r() - 0.5) * (name === 'tile' ? 0.22 : 0.18)), W);
        if (name === 'brick') { wrapRect(a, y, bw, 1, tone(0.1), W); wrapRect(a, y + rh - 1, bw, 1, tone(-0.4), W); wrapRect(a + bw - 1, y, 1, rh, tone(-0.35), W); }
        else { // tiles: a lit crown on the left, a dark gap on the right and a deep shadow under the course above
          wrapRect(a, y, 1, rh, tone(0.16), W); wrapRect(a + bw - 1, y, 1, rh, tone(-0.3), W); wrapRect(a, y + rh - 1, bw, 1, tone(-0.5), W);
          if (rh > 3) wrapRect(a, y + rh - 2, bw, 1, tone(-0.15), W);
        }
      }
    } else if (name === 'plank') {
      bw = Math.max(2, Math.round(T * 0.2)); cv(bw * 6, Math.max(8, T * 2));
      for (k = 0; k < 6; k++) { px(k * bw, 0, bw, c.height, tone((r() - 0.5) * 0.2)); px(k * bw + bw - 1, 0, 1, c.height, tone(-0.38)); px(k * bw, 0, 1, c.height, tone(0.08));
        for (a = 0; a < 3; a++) px(k * bw + 1 + Math.floor(r() * (bw - 1)), Math.floor(r() * c.height), 1, 2 + Math.floor(r() * 3), tone(-0.15)); }
    } else if (name === 'stone' || name === 'strata') {
      // stone: rough courses of blocks of different widths; strata: long bands of rock with cracks
      var S0 = Math.max(8, T * 2); cv(S0, S0); var y0 = 0;
      while (y0 < S0) {
        rh = Math.max(2, Math.round(T * (name === 'stone' ? 0.16 + r() * 0.12 : 0.1 + r() * 0.2))); if (y0 + rh > S0 - 1) rh = S0 - y0;
        var x0 = Math.floor(r() * S0);
        if (name === 'strata') { px(0, y0, S0, rh, tone((r() - 0.5) * 0.24)); px(0, y0, S0, 1, tone(0.12)); px(0, y0 + rh - 1, S0, 1, tone(-0.3)); px(Math.floor(r() * S0), y0, 1, rh, tone(-0.18)); }
        else for (a = 0; a < S0;) {
          var w2 = Math.max(2, Math.round(T * (0.18 + r() * 0.3))); if (a + w2 > S0) w2 = S0 - a;
          var bx = x0 + a; wrapRect(bx, y0, w2, rh, tone((r() - 0.5) * 0.3), S0);
          wrapRect(bx, y0, w2, 1, tone(0.14), S0); wrapRect(bx, y0, 1, rh, tone(0.08), S0); wrapRect(bx, y0 + rh - 1, w2, 1, tone(-0.42), S0); wrapRect(bx + w2 - 1, y0, 1, rh, tone(-0.38), S0);
          a += w2;
        }
        y0 += rh;
      }
    } else { // stucco: fine speckle and soft patches
      cv(Math.max(8, T * 2), Math.max(8, T * 2));
      for (k = 0; k < c.width * c.height * 0.12; k++) px(Math.floor(r() * c.width), Math.floor(r() * c.height), 1, 1, tone((r() - 0.55) * 0.22));
      for (k = 0; k < 3; k++) px(Math.floor(r() * c.width), Math.floor(r() * c.height), 2 + Math.floor(r() * T * 0.3), 1 + Math.floor(r() * 2), tone(-0.08));
    }
    matCache[key] = c;
    return c;
  }
  // texture one face: map the material's texels onto the face's parallelogram (the projections are linear, so a face's
  // top-left corner, the end of its top edge and the foot of its left edge place it), then darken it toward the ground
  function texFace(x, f, ox, oy, T, pats) {
    if (!f.mat || T < 6) return;
    for (var ar = 0, q = 0; q < f.pts.length; q++) { var p0 = f.pts[q], p1 = f.pts[(q + 1) % f.pts.length]; ar += p0[0] * p1[1] - p1[0] * p0[1]; }
    if (Math.abs(ar) < 40) return; // too small to show a texture
    var o = f.uvp[0], H = f.uvp[1], V = f.uvp[2], lh = f.uv[3], lv = f.uv[4];
    var a = (H[0] - o[0]) / (lh * T), b = (H[1] - o[1]) / (lh * T), cc = (V[0] - o[0]) / (lv * T), dd = (V[1] - o[1]) / (lv * T);
    if (Math.abs(a * dd - b * cc) < 1e-4) return;
    x.save(); x.beginPath(); f.pts.forEach(function (p, i) { if (i) x.lineTo(ox + p[0], oy + p[1]); else x.moveTo(ox + p[0], oy + p[1]); }); x.closePath(); x.clip();
    x.setTransform(a, b, cc, dd, ox + o[0], oy + o[1]); x.imageSmoothingEnabled = false;
    x.fillStyle = pats[f.mat] || (pats[f.mat] = x.createPattern(material(f.mat, T), 'repeat')); x.fillRect(0, 0, lh * T, lv * T);
    if (f.ao) { var gr = x.createLinearGradient(0, lv * T * Math.max(0, 1 - 0.5 / lv), 0, lv * T); gr.addColorStop(0, 'rgba(20,12,10,0)'); gr.addColorStop(1, 'rgba(20,12,10,0.4)'); x.fillStyle = gr; x.fillRect(0, 0, lh * T, lv * T); }
    x.restore();
  }

  // ---------- cars ----------
  var GLASS = '#9fd8ff', TYRE = '#2a2630', DARK = '#3a3644', LIGHT = '#fff3b0', TAIL = '#ff4b4b', CHROME = '#c9ced8', SKIN = '#f2c29b';
  var HUB_COL = { stock: '#9aa3b2', chunky: '#c9ced8', gold: '#ffcf3f', star: '#ffe066', white: '#f4f1ea' };
  function box(x0, x1, z0, z1, y0, y1, top, side, front) { return { x0: x0, x1: x1, z0: z0, z1: z1, y0: y0, y1: y1, top: top, side: side || top, front: front || side || top }; }
  // a box with materials on its sides (mat) and top (tmat)
  function mbox(x0, x1, z0, z1, y0, y1, top, side, mat, tmat) { var b = box(x0, x1, z0, z1, y0, y1, top, side); b.mat = mat; b.tmat = tmat; return b; }
  // a gabled roof over [x0, x1] x [z0, z1] from the eaves at y0 to the ridge at y1, the ridge along x (axis 'x') or z;
  // col is the roofing, gable the end walls
  function roof(x0, x1, z0, z1, y0, y1, col, gable, axis, mat, gmat) { return { roof: axis || 'x', x0: x0, x1: x1, z0: z0, z1: z1, y0: y0, y1: y1, top: col, side: gable, front: gable, tmat: mat || 'tile', mat: gmat }; }
  // a primitive's faces: outward normal n, corners v, colour, material, and uv = [top-left corner, end of the top
  // edge, foot of the left edge, top length, side length] in cells
  function faceList(B) {
    var x0 = B.x0, x1 = B.x1, y0 = B.y0, y1 = B.y1, z0 = B.z0, z1 = B.z1, ao = y0 < 0.01;
    function F(n, v, col, mat, o, h, vv, isAo) { return { n: n, v: v, col: col, mat: mat, ao: isAo && ao, uv: [o, h, vv, Math.hypot(h[0] - o[0], h[1] - o[1], h[2] - o[2]), Math.hypot(vv[0] - o[0], vv[1] - o[1], vv[2] - o[2])] }; }
    if (B.roof) {
      var sw = B.roof === 'z', P = sw ? function (a, y, b) { return [b, y, a]; } : function (a, y, b) { return [a, y, b]; };
      var N = function (na, ny, nb) { return sw ? [nb, ny, na] : [na, ny, nb]; };
      var a0 = sw ? z0 : x0, a1 = sw ? z1 : x1, b0 = sw ? x0 : z0, b1 = sw ? x1 : z1, bm = (b0 + b1) / 2, run = bm - b0, rise = y1 - y0, l = Math.hypot(run, rise);
      return [
        F(N(0, run / l, rise / l), [P(a0, y1, bm), P(a1, y1, bm), P(a1, y0, b1), P(a0, y0, b1)], B.top, B.tmat, P(a0, y1, bm), P(a1, y1, bm), P(a0, y0, b1)),
        F(N(0, run / l, -rise / l), [P(a1, y1, bm), P(a0, y1, bm), P(a0, y0, b0), P(a1, y0, b0)], B.top, B.tmat, P(a1, y1, bm), P(a0, y1, bm), P(a1, y0, b0)),
        F(N(1, 0, 0), [P(a1, y0, b0), P(a1, y1, bm), P(a1, y0, b1)], B.side, B.mat, P(a1, y1, b1), P(a1, y1, b0), P(a1, y0, b1)),
        F(N(-1, 0, 0), [P(a0, y0, b0), P(a0, y1, bm), P(a0, y0, b1)], B.side, B.mat, P(a0, y1, b0), P(a0, y1, b1), P(a0, y0, b0))
      ];
    }
    return [
      F([0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], B.top, B.tmat, [x0, y1, z0], [x1, y1, z0], [x0, y1, z1]),
      F([1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], B.front, B.mat, [x1, y1, z1], [x1, y1, z0], [x1, y0, z1], true),
      F([-1, 0, 0], [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], B.side, B.mat, [x0, y1, z0], [x0, y1, z1], [x0, y0, z0], true),
      F([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], B.side, B.mat, [x0, y1, z1], [x1, y1, z1], [x0, y0, z1], true),
      F([0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], B.side, B.mat, [x1, y1, z0], [x0, y1, z0], [x1, y0, z0], true)
    ];
  }
  // the boxes of one car in its own frame: x forward, z to the driver's right, y up, in cells. steer (-1, 0 or 1)
  // turns the front wheels WHEEL_TURN rad to the left or right.
  var WHEEL_TURN = 0.38;
  function carBoxes(id, look, steer) {
    var M = D.CARS[id].model, paint = D.lookOpt('paint', look.paint).c, trim = D.lookOpt('trim', look.trim).c;
    var L = M.len / 2, W = M.wid / 2, wr = M.wheel * (look.wheels === 'chunky' ? 1.2 : 1), y0 = wr * 0.9, y1 = y0 + M.h, b = [];
    // wheels, with a hub cap on the outer face
    var wx = L - Math.max(0.24, wr * 0.95), ww = 0.2, hub = HUB_COL[look.wheels] || HUB_COL.stock;
    [-1, 1].forEach(function (fx) { [-1, 1].forEach(function (sz) {
      var cx = fx * wx, z0 = M.bike ? -0.06 : sz > 0 ? W - ww * 0.4 : -W - ww * 0.6, z1 = M.bike ? 0.06 : z0 + ww; // a motorbike's one wheel each end is drawn twice in the middle
      var tyre = box(cx - wr, cx + wr, z0, z1, 0, wr * 2, TYRE);
      var hz = sz > 0 ? z1 : z0 - 0.03, cap = box(cx - wr * 0.45, cx + wr * 0.45, hz, hz + 0.03, wr * 0.55, wr * 1.45, hub);
      if (fx > 0 && steer) [tyre, cap].forEach(function (B) { B.yaw = steer * WHEEL_TURN; B.px = cx; B.pz = (z0 + z1) / 2; });
      b.push(tyre, cap);
    }); });
    // body, bumpers and a stripe
    b.push(box(-L, L, -W, W, y0, y1, paint));
    b.push(box(L, L + 0.06, -W * 0.9, W * 0.9, y0, y0 + 0.14, trim));
    b.push(box(-L - 0.06, -L, -W * 0.9, W * 0.9, y0, y0 + 0.14, trim));
    b.push(box(-L + 0.05, L - 0.05, -0.12, 0.12, y1, y1 + 0.02, trim));
    // lights
    b.push(box(L - 0.02, L + 0.02, -W * 0.8, -W * 0.45, y1 - 0.16, y1 - 0.05, LIGHT));
    b.push(box(L - 0.02, L + 0.02, W * 0.45, W * 0.8, y1 - 0.16, y1 - 0.05, LIGHT));
    b.push(box(-L - 0.02, -L + 0.02, -W * 0.8, -W * 0.5, y1 - 0.14, y1 - 0.05, TAIL));
    b.push(box(-L - 0.02, -L + 0.02, W * 0.5, W * 0.8, y1 - 0.14, y1 - 0.05, TAIL));
    var C = M.cab, cy = y1;
    if (M.open) {
      // a roll bar, the driver's helmet with a visor, and a little windscreen
      var hx = C.x;
      b.push(box(hx - 0.3, hx + 0.12, -W * 0.55, W * 0.55, y1, y1 + 0.05, DARK));
      b.push(box(hx - C.len / 2, hx + C.len / 2, -C.wid / 2, C.wid / 2, y1 + 0.05, y1 + 0.05 + C.h, trim));
      b.push(box(hx + C.len / 2 - 0.02, hx + C.len / 2 + 0.03, -C.wid / 2 + 0.05, C.wid / 2 - 0.05, y1 + 0.18, y1 + 0.3, '#2b2b3a'));
      b.push(box(hx - 0.32, hx - 0.26, -W * 0.7, W * 0.7, y1, y1 + 0.42, DARK));
      b.push(box(hx + 0.42, hx + 0.46, -W * 0.6, W * 0.6, y1, y1 + 0.2, GLASS));
    } else if (M.van) {
      b.push(box(C.x - C.len / 2, C.x + C.len / 2, -C.wid / 2, C.wid / 2, y1, y1 + C.h, trim, GLASS));
      b.push(box(C.x - C.len / 2 + 0.05, C.x + C.len / 2 - 0.05, -C.wid / 2 - 0.01, C.wid / 2 + 0.01, y1 + C.h * 0.15, y1 + C.h * 0.35, paint));
    } else {
      b.push(box(C.x - C.len / 2, C.x + C.len / 2, -C.wid / 2, C.wid / 2, y1, y1 + C.h, paint, GLASS));
      b.push(box(C.x - 0.1, C.x + 0.1, -C.wid / 2 - 0.01, C.wid / 2 + 0.01, y1, y1 + C.h, paint));
      if (M.bed) b.push(box(-L + 0.08, C.x - C.len / 2 - 0.05, -W + 0.08, W - 0.08, y1 - 0.02, y1 + 0.01, DARK));
    }
    // spoiler
    var sx = -L + 0.08;
    if (look.spoiler === 'duck') b.push(box(sx - 0.08, sx + 0.12, -W * 0.85, W * 0.85, y1, y1 + 0.1, trim));
    if (look.spoiler === 'tall' || look.spoiler === 'wing') {
      var top = y1 + (look.spoiler === 'wing' ? 0.42 : 0.3), ww2 = look.spoiler === 'wing' ? W * 1.05 : W * 0.8;
      b.push(box(sx - 0.03, sx + 0.03, -W * 0.5, -W * 0.4, y1, top, DARK)); b.push(box(sx - 0.03, sx + 0.03, W * 0.4, W * 0.5, y1, top, DARK));
      b.push(box(sx - 0.14, sx + 0.12, -ww2, ww2, top, top + 0.06, trim));
    }
    // exhaust
    if (look.exhaust === 'pipe') b.push(box(-L - 0.16, -L, W * 0.45, W * 0.7, y0 - 0.02, y0 + 0.1, CHROME));
    if (look.exhaust === 'twin') { b.push(box(-L - 0.16, -L, W * 0.4, W * 0.62, y0 - 0.02, y0 + 0.1, CHROME)); b.push(box(-L - 0.16, -L, -W * 0.62, -W * 0.4, y0 - 0.02, y0 + 0.1, CHROME)); }
    if (look.exhaust === 'stack') { var ex = M.open ? C.x - 0.4 : C.x - C.len / 2 - 0.1; b.push(box(ex - 0.06, ex + 0.06, W - 0.05, W + 0.07, y1, y1 + 0.6, CHROME)); b.push(box(ex - 0.06, ex + 0.06, -W - 0.07, -W + 0.05, y1, y1 + 0.6, CHROME)); }
    return b;
  }
  // a box model at a heading, drawn into a canvas; anchor (ax, ay) is the ground point under the car's centre
  function renderModel(boxes, h, scale, outline) {
    scale = scale || 1;
    var hw = HW * scale, hh = HH * scale, bh = BH * scale, ch = Math.cos(h), sh = Math.sin(h);
    function proj(x, y, z) { var wx = x * ch - z * sh, wz = x * sh + z * ch; return [(wx - wz) * hw, (wx + wz) * hh - y * bh, wx + wz]; }
    // seen from (1, 1, 1) after the turn; lit from the upper left
    return drawFaces(boxes, proj, function (n) { var nx = n[0] * ch - n[2] * sh, nz = n[0] * sh + n[2] * ch;
      return nx + n[1] + nz <= 0.001 ? 0 : 0.84 + 0.24 * n[1] + 0.16 * (nx - nz) / 1.42; }, Math.round(HW * scale), outline);
  }
  // a box model seen from a chase camera: rel is the model's heading relative to the line of sight (0 = seen from
  // behind), elev the camera's elevation angle, ppc the sprite pixels per cell. Anchor (ax, ay) is the ground point
  // under the model's centre.
  function renderView(boxes, rel, elev, ppc, outline) {
    var cr = Math.cos(rel), sr = Math.sin(rel), ce = Math.cos(elev), se = Math.sin(elev);
    function proj(x, y, z) { var d = x * cr - z * sr, rr = x * sr + z * cr; return [rr * ppc, (-y * ce - d * se) * ppc, -d * ce + y * se]; }
    return drawFaces(boxes, proj, function (n) { var nd = n[0] * cr - n[2] * sr, nr = n[0] * sr + n[2] * cr;
      return n[1] < 0.99 && -nd * ce + n[1] * se <= 0.001 ? 0 : 0.8 + 0.28 * n[1] + (0.14 * -nd + 0.1 * nr) * (1 - n[1]); },
      Math.round(ppc), ppc >= 5 ? outline : false);
  }
  // project, cull, shade (light(n) gives 0 for a hidden face, else the brightness), sort far to near, fill, texture
  // the faces that carry a material (T texels to a cell), then harden the edges
  function drawFaces(boxes, proj, light, T, outline) {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, faces = [];
    boxes.forEach(function (B) {
      // a box with a yaw is turned about the vertical line through (px, pz): a steered front wheel
      var P = proj, Lt = light;
      if (B.yaw) {
        var cy = Math.cos(B.yaw), sy = Math.sin(B.yaw);
        P = function (x, y, z) { var dx = x - B.px, dz = z - B.pz; return proj(B.px + dx * cy - dz * sy, y, B.pz + dx * sy + dz * cy); };
        Lt = function (n) { return light([n[0] * cy - n[2] * sy, n[1], n[0] * sy + n[2] * cy]); };
      }
      var c = P((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2);
      faceList(B).forEach(function (f) {
        var k = Lt(f.n); if (!k) return;
        f.pts = f.v.map(function (p) { var q = P(p[0], p[1], p[2]); minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); return q; });
        if (f.mat) f.uvp = f.uv.slice(0, 3).map(function (p) { return P(p[0], p[1], p[2]); });
        f.fill = shadeRGB(hex3(f.col), k); f.depth = c[2] + (B.y0 + B.y1) * 0.12 + (f.n[1] > 0.99 ? 0.001 : 0);
        faces.push(f);
      });
    });
    faces.sort(function (a, b) { return a.depth - b.depth; });
    var pad = 2, ox = Math.ceil(-minX) + pad, oy = Math.ceil(-minY) + pad;
    var cv = mkCanvas(Math.ceil(maxX - minX) + pad * 2 + 1, Math.ceil(maxY - minY) + pad * 2 + 1), x = cv.getContext('2d');
    var pats = {};
    faces.forEach(function (f) {
      x.fillStyle = f.fill; x.beginPath();
      f.pts.forEach(function (p, i) { if (i) x.lineTo(ox + p[0], oy + p[1]); else x.moveTo(ox + p[0], oy + p[1]); });
      x.closePath(); x.fill();
      texFace(x, f, ox, oy, T, pats);
    });
    crisp(cv, outline);
    cv.ax = ox; cv.ay = oy;
    return cv;
  }
  // chase-camera sprites come in fixed sizes, like the pre-scaled sprites of 16-bit racers, so outlines stay crisp
  var PPC = [3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 19, 22, 26, 30, 35, 40, 46, 53, 60];
  function ppcStep(ppc) { var best = PPC[0]; for (var i = 0; i < PPC.length; i++) if (Math.abs(PPC[i] - ppc) < Math.abs(best - ppc)) best = PPC[i]; return best; }
  var viewCache = {}, viewN = 0, spent = 0, BUDGET = 6;
  // the renderer calls newFrame each frame; once a frame has spent BUDGET ms drawing new views, a missing size is
  // stood in for by the nearest size already drawn for that heading and elevation (the renderer scales it)
  function newFrame() { spent = 0; }
  function viewKey(key, rel, elev, ppc, bins) {
    var b = ((Math.round(rel / (Math.PI * 2) * bins) % bins) + bins) % bins;
    return key + '|' + b + '|' + Math.round(elev / 0.07) + '|' + ppcStep(ppc);
  }
  function viewed(key, boxesFn, rel, elev, ppc, bins) {
    bins = bins || HEADINGS;
    var b = ((Math.round(rel / (Math.PI * 2) * bins) % bins) + bins) % bins, e = Math.round(elev / 0.07), p = ppcStep(ppc);
    var k = key + '|' + b + '|' + e + '|' + p;
    if (!viewCache[k] && spent > BUDGET) {
      var i0 = PPC.indexOf(p);
      for (var j = 1; j < PPC.length; j++) { var a1 = viewCache[key + '|' + b + '|' + e + '|' + PPC[i0 - j]] || viewCache[key + '|' + b + '|' + e + '|' + PPC[i0 + j]]; if (a1) return a1; }
    }
    if (!viewCache[k]) {
      var t0 = performance.now();
      if (++viewN > 4000) { viewCache = {}; viewN = 1; }
      viewCache[k] = renderView(boxesFn(), b / bins * Math.PI * 2, e * 0.07, p);
      viewCache[k].ppc = p;
      spent += performance.now() - t0;
    }
    return viewCache[k];
  }
  // a car seen from the chase camera; wheel is the front wheels' steer (-1..1), drawn turned past ±0.35. Once the
  // frame's budget is spent, a turned view not yet drawn is stood in for by the straight one.
  function carView(id, look, rel, elev, ppc, wheel) {
    var key = 'car|' + id + '|' + lookKey(look), st = wheel > 0.35 ? 1 : wheel < -0.35 ? -1 : 0;
    if (st && (spent <= BUDGET || viewCache[viewKey(key + '|w' + st, rel, elev, ppc, HEADINGS)])) key += '|w' + st; else st = 0;
    return viewed(key, function () { return carBoxes(id, look, st); }, rel, elev, ppc);
  }
  // a glider wing, opened above a car in the air
  function gliderView(col, rel, elev, ppc) {
    return viewed('glider|' + col, function () {
      return [box(-0.1, 0.1, -0.05, 0.05, 0.6, 1.25, DARK), box(-0.45, 0.25, -1.3, 1.3, 1.25, 1.33, col, shadeHex(col, 0.8)),
        box(-0.42, 0.2, -1.32, -1.0, 1.2, 1.35, LIGHT), box(-0.42, 0.2, 1.0, 1.32, 1.2, 1.35, LIGHT)];
    }, rel, elev, ppc, 16);
  }
  var MODELS = {};
  // buildings, the crate, the windmill tower and the grandstand seen from the chase camera
  function modelView(name, rel, elev, ppc) { return viewed('m|' + name, function () { return MODELS[name](); }, rel, elev, ppc, 16); }
  var carCache = {};
  function lookKey(look) { return D.LOOK_KEYS.map(function (k) { return look[k]; }).join('|'); }
  // the car at heading h (radians), cached per one of HEADINGS directions
  function car(id, look, h) {
    var b = ((Math.round(h / (Math.PI * 2) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
    var key = id + '|' + lookKey(look) + '|' + b;
    if (!carCache[key]) {
      carCache[key] = renderModel(carBoxes(id, look), b / HEADINGS * Math.PI * 2);
      var n = Object.keys(carCache).length; if (n > 900) carCache = {};
    }
    return carCache[key];
  }
  // a large preview of a car for the garage menus, drawn at a finer heading
  function carPreview(id, look, h, scale) { return renderModel(carBoxes(id, look), h, scale || 3); }

  // ---------- letter-grid sprites ----------
  function grid(rows, pal, outline) {
    var w = 0; rows.forEach(function (r) { w = Math.max(w, r.length); });
    var c = mkCanvas(w + 2, rows.length + 2), x = c.getContext('2d');
    rows.forEach(function (r, y) { for (var i = 0; i < r.length; i++) { var ch = r.charAt(i); if (ch !== '.' && ch !== ' ' && pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(i + 1, y + 1, 1, 1); } } });
    return crisp(c, outline);
  }
  function mirror(c) { var m = mkCanvas(c.width, c.height), x = m.getContext('2d'); x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(c, 0, 0); return m; }

  // the kid driver: a racing cap with goggles on the band, chestnut hair, a scarf, a short jacket, trousers and boots.
  // Three tones a material (light from the upper left, then mid, then shade); a big head as in HD-2D sprites.
  // Front, back and side views (the side is mirrored for the other way), with the legs in three frames.
  var KID_PAL = {
    k: '#c25a44', c: '#9a3c2e', C: '#64241e',                 // cap
    g: '#4a3a30', l: '#7fb0b4', L: '#d8f0ec',                 // goggles
    i: '#a8683a', h: '#7a4626', H: '#4c2a18',                 // hair
    s: '#f0c49c', S: '#c88e6a', e: '#2a1e24', E: '#f4ecdc', m: '#a85a4a', // skin, eyes, mouth
    y: '#e8b65a', r: '#c88a34', R: '#8a5a22',                 // scarf
    q: '#5e8496', j: '#3c5a6e', J: '#25394a',                 // jacket
    w: '#e8dcc0', o: '#7a5236',                               // shirt, gloves
    p: '#6a5240', P: '#463428', b: '#3a2a22', B: '#5c4434'    // trousers, boots
  };
  var KID = {
    front: [
      '.....kkcccC.....', '...kkcccccccC...', '..kcccccccccCC..', '..cglLgcglLgcC..', '..cgllgcgllgCC..', '.CCCCCCCCCCCCCC.',
      '..HihhihhhihhH..', '..ihshhsshhshH..', '..hsssssssssSH..', '..hsEesssEesSH..', '..hseesssseeSH..', '...sssssmssSS...',
      '....SssssssS....', '...yyyyrrrrrR...', '..qyyrrrrrrRRJ..',
      '.qjJqjjrRwjjjJjJ', '.qjJqjjyRwwjjJjJ', '.qjJqjjjRwwjjJjJ', '.qjJqjjjjwwjjJjJ', '.ooJqjjjjjjjjJoo', '.ooJPPPPPPPPPJoo'
    ],
    back: [
      '......kccc......', '....kkcccccC....', '..kcccccccccCC..', '..cccccccccccC..', '..ggggggggggggg.', '..kcccccccccCC..',
      '..ihhihhhihhhH..', '..ihhihhhihhHH..', '..hihhihhhihhH..', '..ihhihhhhihHH..', '..HhhhhhHhhhHH..', '...HhhHhhhHH....',
      '....SsssssS.....', '...yyyyrrrrrR...', '..qjyrrrrrrRJJ..',
      '.qjJqjjrRjjjjJjJ', '.qjJqjjrRjjjjJjJ', '.qjJqjjjRjjjjJjJ', '.qjJqjjjjjjjjJjJ', '.ooJqjjjjjjjjJoo', '.ooJPPPPPPPPPJoo'
    ],
    side: [
      '.....kkcccc.....', '...kkcccccccC...', '..kcccccccccCC..', '..cccccgllgCCC..', '..cccccgLlgCCCCC', '..HCCCCCCCCC....',
      '..ihhhhssssss...', '..hihhsssEes....', '..ihhhssseess...', '..hhihsssssss...', '..Hhhhssssms....', '...HhhSsssS.....',
      '....SSssS.......', '....yyrrrR......', '..yRyqjjjjJ.....',
      '.yR.qjjjjjJ.....', '.R..qjqqjJJ.....', '....qjqjjJJ.....', '....qjqjjJJ.....', '....qjoojJJ.....', '....PPooPPP.....'
    ]
  };
  // legs: standing, then the two steps of the walk
  var KID_LEGS = {
    front: [
      ['....pppppppPP...', '....pppPP.pPP...', '....pppP..ppP...', '....pppP..ppP...', '...BbbbB.BbbbB..', '...bbbbb.bbbbb..'],
      ['....pppppppPP...', '....pppPP.pPP...', '....pppP..ppP...', '...BbbbB..ppP...', '...bbbbb.BbbbB..', '.........bbbbb..'],
      ['....pppppppPP...', '....pppPP.pPP...', '....pppP..ppP...', '....pppP.BbbbB..', '...BbbbB.bbbbb..', '...bbbbb........']
    ],
    side: [
      ['....pppppP......', '....pppPPP......', '....pppPP.......', '....pppPP.......', '....BbbbbB......', '....bbbbbbb.....'],
      ['....pppppP......', '...pppP.pPP.....', '..ppP....pPP....', '..pP......pP....', '.BbbB.....BbbB..', '.bbb......bbbbb.'],
      ['....pppppP......', '....ppPpPP......', '....pPP.pP......', '...pP...pP......', '..BbbB.BbbbB....', '..bbb..bbbbbb...']
    ]
  };
  KID_LEGS.back = KID_LEGS.front;
  var kidCache = {};
  // facing in world radians; screen direction decides the view
  function kid(face, walk, moving) {
    var sx = Math.cos(face) - Math.sin(face), sy = Math.cos(face) + Math.sin(face); // screen-space direction
    var view = Math.abs(sx) > Math.abs(sy) * 1.2 ? 'side' : sy > 0 ? 'front' : 'back';
    var flip = view === 'side' && sx < 0;
    var phase = moving ? (Math.floor(walk * 3) % 2 ? 1 : 2) : 0;
    var key = view + flip + phase;
    if (!kidCache[key]) {
      var c = grid(KID[view].concat(KID_LEGS[view][phase]), KID_PAL, 0.18); c.ay = c.height - 1;
      kidCache[key] = flip ? mirror(c) : c; kidCache[key].ay = c.ay;
    }
    return kidCache[key];
  }

  // ---------- scenery ----------
  var SCN = {};
  // ---------- foliage ----------
  // trees and bushes drawn per pixel at the height they are shown (px, snapped to FOL_PX), so they keep about one art
  // pixel per screen pixel: clumps of leaves on a crown, each clump lit as a ball from the upper left and blended with
  // the crown's own roundness, in five tones from a near-black shade to a sunlit tip, with leaf-sized noise, ragged
  // edges and dark seams where clumps meet; then a trunk with a flared root. Tones run dark to light.
  var FOL_PX = [6, 8, 10, 12, 14, 17, 20, 24, 28, 33, 39, 46, 54, 64, 76, 90, 106, 124, 146];
  var FOL = {
    oak: { kind: 'round', ratio: 1.05, crown: 0.76, pal: ['#1a261c', '#2a4026', '#435c2c', '#6a7c36', '#a3a452'], trunk: ['#24180f', '#43301f', '#6a4c30'], seed: 3, n: 15 },
    oakD: { kind: 'round', ratio: 1.05, crown: 0.76, pal: ['#121c16', '#1e3020', '#2f4627', '#4a6030', '#7a8440'], trunk: ['#1c120c', '#36261a', '#523a26'], seed: 5, n: 15 },
    elm: { kind: 'round', ratio: 0.95, crown: 0.84, pal: ['#101a16', '#1a2e22', '#2a4428', '#46602e', '#8e9446'], trunk: ['#1c120c', '#36261a', '#4e3824'], seed: 9, n: 20 },
    pine: { kind: 'cone', ratio: 0.62, crown: 0.9, pal: ['#0f1a17', '#1a2d24', '#294430', '#40603a', '#6c8046'], trunk: ['#1e140c', '#3a281a', '#5a4028'], seed: 11 },
    bush: { kind: 'bush', ratio: 1.5, pal: ['#1a2a1a', '#2c4426', '#466230', '#6c8038', '#8e9a48'], seed: 13, n: 9 },
    bushD: { kind: 'bush', ratio: 1.5, pal: ['#121e16', '#1e3220', '#304a28', '#4c6430', '#7c8a42'], seed: 17, n: 9 },
    bushF: { kind: 'bush', ratio: 1.5, pal: ['#1a2a1a', '#2c4426', '#466230', '#6c8038', '#8e9a48'], seed: 19, n: 9, flowers: ['#d8708a', '#e8c860', '#efe2c8'] },
    shrub: { kind: 'bush', ratio: 1.7, pal: ['#3a2c1c', '#5c4a2a', '#7e6a38', '#a08a4a', '#c8b06a'], seed: 23, n: 8, sparse: true }
  };
  function hash2(i, j, s) { var h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 2246822519) | 0; h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; }
  function folPx(px) { var best = FOL_PX[0]; for (var i = 0; i < FOL_PX.length; i++) if (Math.abs(FOL_PX[i] - px) < Math.abs(best - px)) best = FOL_PX[i]; return best; }
  function foliage(name, H) {
    var F = FOL[name], W = Math.max(4, Math.round(H * F.ratio)), r = prng(F.seed * 7919 + 13), cl = [], i, j, k;
    var c = mkCanvas(W + 2, H + 2), x = c.getContext('2d'), im = x.createImageData(W + 2, H + 2), d = im.data;
    var pal = F.pal.map(hex3), ch = F.kind === 'bush' ? H : H * F.crown, cy = ch / 2, ls = Math.max(1, Math.round(H / 30));
    function put(a, b, col) { var q = ((b + 1) * (W + 2) + a + 1) * 4; d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2]; d[q + 3] = 255; }
    // trunk: lit on the left, flared at the root
    if (F.trunk) {
      var tp = F.trunk.map(hex3), tw = Math.max(1, Math.round(W * 0.09)), t0 = Math.round(W / 2 - tw / 2);
      for (j = Math.round(cy); j < H; j++) { var fl = j >= H - 2 ? H - j === 1 ? 2 : 1 : 0;
        for (i = t0 - fl; i < t0 + tw + fl; i++) put(i, j, i <= t0 - fl ? tp[2] : i >= t0 + tw + fl - 1 && tw > 1 ? tp[0] : tp[1]); }
    }
    // clumps in crown units (-1..1 across and down the crown)
    if (F.kind === 'cone') {
      for (k = 0; k < 6; k++) { var ty = -0.85 + k * 0.33, hwid = 0.18 + k * 0.16, m = 1 + k;
        for (i = 0; i < m; i++) cl.push({ x: (m === 1 ? 0 : -hwid + 2 * hwid * i / (m - 1)) * 0.85 + (r() - 0.5) * 0.08, y: ty + (r() - 0.5) * 0.06, r: 0.2 + k * 0.035, z: k * 0.12 }); }
    } else {
      cl.push({ x: 0, y: 0.08, r: 0.78, z: -0.45 });
      for (k = 0; cl.length < F.n + 1 && k < 400; k++) { var px2 = (r() - 0.5) * 1.5, py = (r() - 0.5) * 1.5;
        if (px2 * px2 + py * py > 0.55) continue; cl.push({ x: px2, y: py, r: 0.26 + r() * 0.2, z: py * 0.3 + r() * 0.15 }); }
    }
    var Lx = -0.55, Ly = -0.68, Lz = 0.48;
    for (j = 0; j < Math.ceil(ch); j++) for (i = 0; i < W; i++) {
      var u = (i + 0.5 - W / 2) / (W / 2), v = (j + 0.5 - cy) / (ch / 2), best = -1e9, second = -1e9, bc = null;
      var e = (hash2(i >> (ls > 1 ? 1 : 0), j >> (ls > 1 ? 1 : 0), F.seed) - 0.5) * 0.28;
      for (k = 0; k < cl.length; k++) { var C = cl[k], du = u - C.x, dv = v - C.y, dd = du * du + dv * dv, R = C.r * (1 + e);
        if (dd >= R * R) continue; var hgt = Math.sqrt(R * R - dd) / R * 0.5 + C.z;
        if (hgt > best) { second = best; best = hgt; bc = C; } else if (hgt > second) second = hgt; }
      if (!bc) continue;
      if (F.sparse && hash2(i, j, 99) < 0.12) continue;
      var nx = (u - bc.x) / bc.r, ny = (v - bc.y) / bc.r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      var gz = Math.sqrt(Math.max(0, 1 - u * u * 0.8 - v * v * 0.8));
      var Nx = nx * 0.6 + u * 0.45, Ny = ny * 0.6 + v * 0.45, Nz = nz * 0.6 + gz * 0.45, nl = Math.hypot(Nx, Ny, Nz) || 1;
      var lit = (Nx * Lx + Ny * Ly + Nz * Lz) / nl;
      var t = lit * 0.7 + 0.36 + (hash2(Math.floor(i / ls), Math.floor(j / ls), F.seed + 1) - 0.5) * 0.34 - (best - second < 0.07 ? 0.28 : 0) - Math.max(0, v) * 0.12;
      var idx = Math.max(0, Math.min(4, Math.floor(t * 5)));
      if (F.flowers && idx >= 2 && hash2(Math.floor(i / ls), Math.floor(j / ls), 7) < 0.06) put(i, j, hex3(F.flowers[Math.floor(hash2(i, j, 3) * F.flowers.length)]));
      else put(i, j, pal[idx]);
    }
    x.putImageData(im, 0, 0);
    crisp(c, 0.3);
    c.ax = (W + 2) / 2; c.ay = H + 1;
    return c;
  }
  // the canyon's solid scenery drawn the same way, per pixel at the shown size: a ribbed saguaro (capsules shaded as
  // cylinders), a faceted boulder, and a hoodoo pillar with strata bands and a cap rock. Tones run dark to light.
  var SOLID = {
    cactus: { ratio: 0.62, pal: ['#1c2a1c', '#2c4428', '#46602e', '#6a7e3c', '#98a058'], seed: 29 },
    redrock: { ratio: 1.5, pal: ['#3a1c14', '#62301e', '#8a4a2c', '#b06a40', '#d49464'], seed: 31 },
    pillar: { ratio: 0.42, pal: ['#3a1c14', '#62301e', '#8e4c2e', '#b86e44', '#dc9a6c'], seed: 37 },
    rock: { ratio: 1.5, pal: ['#26221e', '#3e3832', '#5a544a', '#7a7262', '#9e9480'], seed: 41 }
  };
  function solid(name, H) {
    var F = SOLID[name], W = Math.max(4, Math.round(H * F.ratio)), r = prng(F.seed), i, j, k;
    var c = mkCanvas(W + 2, H + 2), x = c.getContext('2d'), im = x.createImageData(W + 2, H + 2), d = im.data, pal = F.pal.map(hex3);
    var Lx = -0.6, Ly = -0.55, Lz = 0.58, blobs = [];
    if (name === 'redrock' || name === 'rock') for (k = 0; k < 6; k++) blobs.push({ x: (r() - 0.5) * 1.1, y: 0.25 + (r() - 0.5) * 0.7, rx: 0.4 + r() * 0.3, ry: 0.4 + r() * 0.3 });
    // capsules of the saguaro in canvas units (u across -1..1, v down 0..1): [u, v0, v1, half-width], arms joined by elbows
    var caps = [[0, 0.04, 1, 0.2], [-0.62, 0.22, 0.6, 0.15], [0.6, 0.12, 0.45, 0.14]], elb = [[-0.62, -0.05, 0.6, 0.66, 0.15], [0.05, 0.6, 0.45, 0.51, 0.14]];
    function put(a, b, col) { var q = ((b + 1) * (W + 2) + a + 1) * 4; d[q] = col[0]; d[q + 1] = col[1]; d[q + 2] = col[2]; d[q + 3] = 255; }
    for (j = 0; j < H; j++) for (i = 0; i < W; i++) {
      var u = (i + 0.5 - W / 2) / (W / 2), v = (j + 0.5) / H, nx = 0, ny = 0, hit = false, rib = 0, band = 0;
      if (name === 'cactus') {
        for (k = 0; k < caps.length && !hit; k++) { var C = caps[k], dv = v < C[1] ? (C[1] - v) * H / W * 2 : 0, du = (u - C[0]) / C[3];
          if (v <= C[2] && du * du + (dv / C[3]) * (dv / C[3]) < 1) { hit = true; nx = du; ny = -dv / C[3]; rib = Math.abs(Math.round(du * 2.5) - du * 2.5) < 0.12 ? 1 : 0; } }
        for (k = 0; k < elb.length && !hit; k++) { var E = elb[k]; if (u >= E[0] && u <= E[1] && v >= E[2] && v <= E[3]) { hit = true; ny = ((v - E[2]) / (E[3] - E[2]) - 0.5) * 2; } }
      } else if (name === 'pillar') {
        // a narrow waist, a wider foot and a cap rock
        var wv = v < 0.12 ? 0.95 : v < 0.2 ? 0.6 : v < 0.5 ? 0.42 + (v - 0.2) * 0.4 : 0.55 + (v - 0.5) * 0.85;
        var ragged = (hash2(0, j >> 1, F.seed) - 0.5) * 0.12;
        if (Math.abs(u) < wv + ragged) { hit = true; nx = u / (wv + ragged); ny = v < 0.12 ? -0.6 : 0; band = Math.floor(v * 9 + hash2(i >> 2, 0, 5) * 0.4) % 2; }
      } else {
        for (k = 0; k < blobs.length; k++) { var B = blobs[k], bu = (u - B.x) / B.rx, bv = (v - B.y) / B.ry * 0.5; if (bu * bu + bv * bv < 1 && v <= 1) { if (!hit || bv < ny) { nx = bu; ny = bv; } hit = true; } }
        // facets: snap the normal so the boulder reads as cut planes
        nx = Math.round(nx * 2) / 2; ny = Math.round(ny * 2) / 2;
      }
      if (!hit) continue;
      var nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny)), nl = Math.hypot(nx, ny, nz);
      var t = (nx * Lx + ny * Ly + nz * Lz) / nl * 0.7 + 0.4 + (hash2(i >> 1, j >> 1, F.seed) - 0.5) * 0.18 - rib * 0.22 - band * 0.12 - Math.max(0, v - 0.85) * 0.8;
      put(i, j, pal[Math.max(0, Math.min(4, Math.floor(t * 5)))]);
    }
    x.putImageData(im, 0, 0);
    crisp(c, 0.3);
    c.ax = (W + 2) / 2; c.ay = H + 1;
    return c;
  }
  // a scenery sprite; foliage and the canyon's rocks and cacti are drawn for the height they are shown at (px, in
  // screen pixels; 40 when not given)
  function scenery(name, px) {
    if (FOL[name] || SOLID[name]) { var hp = folPx(px || 40), fk = name + '|' + hp; if (!SCN[fk]) SCN[fk] = FOL[name] ? foliage(name, hp) : solid(name, hp); return SCN[fk]; }
    if (SCN[name]) return SCN[name];
    var c;
    // a palm for the oases
    if (name === 'palm') c = grid([
      '..ff.....ff..', '.fFff.f.ffFf.', 'ff..fffFf..ff', 'f..ffFtFff..f', '..ff..t..ff..', '.f....t....f.', '......t......', '.....tT......',
      '.....tT......', '......tT.....', '......tT.....', '.....tT......', '.....tT......'
    ], { f: '#3f8a4a', F: '#72b85a', t: '#9a7442', T: '#6a4a28' });
    else if (name === 'flowers') c = grid(['.r..y.', 'rgr.yy', '.g.ygy', '..g.g.'], { r: '#ff7ac8', y: '#ffd23f', g: '#3f8f3a' }, false);
    else if (name === 'hay') c = grid(['.hhhhhh.', 'hHhhhhHh', 'hhhhhhhh', 'hHhhhhHh', 'hhhhhhhh', '.HHHHHH.'], { h: '#c8a456', H: '#8e7032' });
    else if (name === 'post') c = grid(['ww', 'ww', 'wW', 'wW', 'WW'], { w: '#b4a284', W: '#7e6c54' });
    else if (name === 'tyres') c = grid(['.rrrr.', 'rkkkkr', '.rrrr.', 'wkkkkw', '.wwww.', 'rkkkkr', '.rrrr.'], { r: '#a8463a', w: '#d4c8b0', k: '#24202a' });
    else if (name === 'sign') c = grid(['yyyyyyyy', 'ykkyykky', 'yyyyyyyy', '...pp...', '...pp...', '...pp...'], { y: '#a8804e', k: '#4a3222', p: '#5a3e26' });
    SCN[name] = c;
    return c;
  }
  // item crate: a plank crate with a gold star stamp
  var crateC = null;
  function crate() {
    if (crateC) return crateC;
    crateC = renderModel(crateBoxes(), 0.3);
    return crateC;
  }
  function crateBoxes() {
    return [mbox(-0.32, 0.32, -0.32, 0.32, 0, 0.64, '#c9853a', '#a8622a', 'plank', 'plank'),
      box(-0.33, 0.33, -0.33, 0.33, 0.27, 0.37, '#7a421a'), box(-0.12, 0.12, 0.33, 0.34, 0.2, 0.44, '#ffd23f'), box(0.33, 0.34, -0.12, 0.12, 0.2, 0.44, '#ffd23f'),
      box(-0.1, 0.1, -0.1, 0.1, 0.64, 0.65, '#ffd23f')];
  }
  // a building: a stone plinth, textured walls, a gabled roof with eaves (ridge along the longer side), shuttered
  // windows with sills and flower boxes, a door (or a wide plank door) on the +x side, and a chimney.
  // o: w, d, h, wall, wmat, roof, rmat, door, shutter, base, wide (door width), chimney, flowers, nwin (windows per side)
  function houseBoxes(o) {
    var w = o.w, d = o.d, h = o.h, t = 0.05, PL = 0.26, b = [], base = o.base || '#8a8070', trim = o.trim || '#ddd0b4';
    b.push(mbox(-w / 2 - 0.06, w / 2 + 0.06, -d / 2 - 0.06, d / 2 + 0.06, 0, PL, base, shadeHex(base, 0.9), 'stone', 'stone'));
    b.push(mbox(-w / 2, w / 2, -d / 2, d / 2, PL, h, o.wall, shadeHex(o.wall, 0.94), o.wmat));
    var ax = w >= d ? 'x' : 'z', rise = Math.min(w, d) * (o.pitch || 0.42);
    b.push(roof(-w / 2 - 0.28, w / 2 + 0.28, -d / 2 - 0.32, d / 2 + 0.32, h, h + rise, o.roof, o.wall, ax, o.rmat || 'tile', o.wmat));
    // a feature on one wall: side +x, -x, +z or -z; c along the wall, [y0, y1] up it, half-width hw2, standing out by out
    function onWall(side, c, y0, y1, hw2, out, col, mat) {
      var B = side === '+x' ? box(w / 2, w / 2 + out, c - hw2, c + hw2, y0, y1, col) : side === '-x' ? box(-w / 2 - out, -w / 2, c - hw2, c + hw2, y0, y1, col)
        : side === '+z' ? box(c - hw2, c + hw2, d / 2, d / 2 + out, y0, y1, col) : box(c - hw2, c + hw2, -d / 2 - out, -d / 2, y0, y1, col);
      B.mat = mat; b.push(B);
    }
    function win(side, c) {
      var y0 = PL + (h - PL) * 0.4, y1 = Math.min(h - 0.12, y0 + 0.5);
      onWall(side, c, y0, y1, 0.17, t, '#2c2a34');
      if (o.shutter) { onWall(side, c - 0.27, y0 - 0.02, y1 + 0.02, 0.09, t * 1.4, o.shutter, 'plank'); onWall(side, c + 0.27, y0 - 0.02, y1 + 0.02, 0.09, t * 1.4, o.shutter, 'plank'); }
      onWall(side, c, y0 - 0.1, y0 - 0.04, 0.26, t * 2, trim);
      if (o.flowers) { onWall(side, c, y0 - 0.2, y0 - 0.1, 0.22, t * 3, '#5a3a26', 'plank'); onWall(side, c, y0 - 0.1, y0, 0.2, t * 3.2, o.flowers); }
    }
    var dw = o.wide || 0.34, dh = Math.min(h * 0.82, o.wide ? h * 0.8 : 1.15);
    onWall('+x', 0, 0, dh, dw, t * 1.2, o.door || '#6a4630', 'plank');
    if (!o.wide) onWall('+x', 0, 0, 0.1, dw + 0.2, 0.3, base, 'stone');
    var n = o.nwin || Math.max(1, Math.round(w / 1.6)), sx = o.wide ? d / 2 - 0.55 : d / 2 - 0.6;
    if (d - (dw + 0.2) * 2 > 1.4) { win('+x', -sx); win('+x', sx); }
    for (var i = 0; i < n; i++) { var c = -w / 2 + w * (i + 0.5) / n; win('+z', c); win('-z', c); }
    win('-x', 0);
    if (o.chimney) { var cx = ax === 'x' ? w * 0.28 : 0, cz = ax === 'x' ? -d * 0.12 : d * 0.28;
      b.push(mbox(cx - 0.17, cx + 0.17, cz - 0.17, cz + 0.17, h + rise * 0.3, h + rise + 0.35, o.chim || '#8a4a36', shadeHex(o.chim || '#8a4a36', 0.85), 'brick', 'stone'));
      b.push(box(cx - 0.21, cx + 0.21, cz - 0.21, cz + 0.21, h + rise + 0.35, h + rise + 0.43, '#6a6058')); }
    return b;
  }
  // earthy palettes: terracotta and slate roofs, brick, cream and ochre stucco, red planks, green and blue shutters
  var HOUSES = {
    barn: { w: 4, d: 3, h: 2.2, wall: '#8a3a2c', wmat: 'plank', roof: '#4e4650', rmat: 'slate', door: '#d8cbb0', wide: 0.75, nwin: 2, pitch: 0.5 },
    house: { w: 3, d: 2.6, h: 1.8, wall: '#d8c6a2', wmat: 'stucco', roof: '#b8583a', shutter: '#3f6a4a', flowers: '#d0607a', chimney: true },
    house2: { w: 2.6, d: 2.6, h: 1.7, wall: '#a65a40', wmat: 'brick', roof: '#5a5260', rmat: 'slate', shutter: '#4a6478', chimney: true, chim: '#7a6a5a' },
    garage: { w: 5, d: 3, h: 2.4, wall: '#9c5038', wmat: 'brick', roof: '#b85a36', door: '#7a5434', wide: 0.95, shutter: '#3f6a4a', chimney: true },
    paint: { w: 5, d: 3, h: 2.2, wall: '#d4b07a', wmat: 'stucco', roof: '#b0503a', door: '#3f6a4a', shutter: '#3f6a4a', flowers: '#e07aa0' }
  };
  function building(name) { return renderModel(houseBoxes(HOUSES[name]), 0, 1); }
  ['barn', 'house', 'house2'].forEach(function (k) { MODELS[k] = function () { return houseBoxes(HOUSES[k]); }; });
  // the canyon's buildings: a flat-roofed adobe house with beams and a window, and a stepped red-rock butte
  MODELS.adobe = function () {
    return [mbox(-1.4, 1.4, -1.2, 1.2, 0, 1.6, '#d49a6c', '#b88058', 'stucco'), mbox(-1.5, 1.5, -1.3, 1.3, 1.6, 1.8, '#c08658', '#a06c46', 'stucco', 'stucco'),
      mbox(1.4, 1.45, -0.35, 0.35, 0, 1.1, '#5a3422', null, 'plank'), box(1.4, 1.44, 0.6, 0.95, 0.75, 1.15, '#2c2a34'), box(1.4, 1.46, 0.55, 1.0, 0.7, 0.75, '#a07a58'),
      mbox(-1.0, -0.9, -1.45, 1.45, 1.45, 1.55, '#6a4028', null, 'plank'), mbox(0.0, 0.1, -1.45, 1.45, 1.45, 1.55, '#6a4028', null, 'plank'), mbox(0.9, 1.0, -1.45, 1.45, 1.45, 1.55, '#6a4028', null, 'plank')];
  };
  MODELS.butte = function () {
    return [mbox(-2.4, 2.4, -1.8, 1.8, 0, 1.3, '#a85a38', '#8a442a', 'strata'), mbox(-1.9, 2.0, -1.5, 1.4, 1.3, 2.5, '#c4744a', '#a0502f', 'strata'),
      box(-1.9, 2.0, -1.5, 1.4, 2.5, 2.62, '#dca07c', '#b88060'), mbox(-1.3, 1.2, -1.0, 1.0, 2.62, 3.6, '#b86440', '#94482e', 'strata'),
      box(-1.35, 1.25, -1.05, 1.05, 3.6, 3.75, '#e0aa86', '#c08a66')];
  };
  MODELS.stand = function () { var b = []; for (var i = 0; i < 3; i++) b.push(mbox(-3, 3, -0.6 + i * 0.5, -0.1 + i * 0.5, 0, 0.35 + i * 0.35, i % 2 ? '#4a6a8a' : '#a84a3a', '#7a6a58', 'plank', 'plank')); return b; };
  MODELS.crate = function () { return crateBoxes(); };
  MODELS.mill = function () { return millBoxes(); };
  function shadeHex(h, k) { return '#' + hex3(h).map(function (v) { var s = Math.max(0, Math.min(255, Math.round(v * k))).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  var bldCache = {};
  function building1(name) {
    if (!bldCache[name]) bldCache[name] = name === 'stand' ? renderModel(MODELS.stand(), 0) : building(name);
    return bldCache[name];
  }
  // a windmill tower; the sails are drawn turning by the renderer
  var millC = null;
  function windmill() {
    if (millC) return millC;
    millC = renderModel(millBoxes(), 0.25);
    millC.hubX = 0.9; millC.hubY = 3.85;
    return millC;
  }
  function millBoxes() {
    var b = [];
    for (var i = 0; i < 6; i++) { var k = 1 - i * 0.09; b.push(mbox(-0.9 * k, 0.9 * k, -0.9 * k, 0.9 * k, i * 0.6, (i + 1) * 0.6, '#c8bca2', '#a89c84', 'stone', 'stone')); }
    b.push(mbox(0.9, 0.94, -0.22, 0.22, 0.0, 0.9, '#5a3a26', null, 'plank'));
    b.push(roof(-0.7, 0.7, -0.7, 0.7, 3.6, 4.3, '#a04a32', '#c8bca2', 'x', 'tile', 'stone'));
    b.push(box(0.55, 0.95, -0.2, 0.2, 3.65, 4.05, '#6a4630'));
    return b;
  }
  var beeC = null;
  function bee() { if (!beeC) beeC = grid(['.ww.ww.', '..ww...', 'kykyky.', 'ykykyke', 'kykyky.'], { w: '#e8f6ff', k: '#2a2630', y: '#ffd23f', e: '#2a2630' }); return beeC; }

  return { HW: HW, HH: HH, BH: BH, HEADINGS: HEADINGS, car: car, carPreview: carPreview, kid: kid, scenery: scenery, crate: crate,
    building: building1, windmill: windmill, bee: bee, renderModel: renderModel, box: box, crisp: crisp,
    carView: carView, gliderView: gliderView, modelView: modelView, newFrame: newFrame };
})();
