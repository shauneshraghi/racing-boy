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
  // hard edges: drop half-covered pixels, then ring the shape with a dark outline
  function crisp(c, outline) {
    var x = c.getContext('2d'), im = x.getImageData(0, 0, c.width, c.height), d = im.data, w = c.width, h = c.height, i;
    for (i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    if (outline !== false) {
      var o = new Uint8Array(w * h);
      for (var y = 0; y < h; y++) for (var xx = 0; xx < w; xx++) {
        var k = (y * w + xx) * 4 + 3; if (d[k]) continue;
        if ((xx > 0 && d[k - 4]) || (xx < w - 1 && d[k + 4]) || (y > 0 && d[k - w * 4]) || (y < h - 1 && d[k + w * 4])) o[y * w + xx] = 1;
      }
      for (i = 0; i < o.length; i++) if (o[i]) { d[i * 4] = OUTLINE[0]; d[i * 4 + 1] = OUTLINE[1]; d[i * 4 + 2] = OUTLINE[2]; d[i * 4 + 3] = 255; }
    }
    x.putImageData(im, 0, 0);
    return c;
  }

  // ---------- cars ----------
  var GLASS = '#9fd8ff', TYRE = '#2a2630', DARK = '#3a3644', LIGHT = '#fff3b0', TAIL = '#ff4b4b', CHROME = '#c9ced8', SKIN = '#f2c29b';
  var HUB_COL = { stock: '#9aa3b2', chunky: '#c9ced8', gold: '#ffcf3f', star: '#ffe066', white: '#f4f1ea' };
  function box(x0, x1, z0, z1, y0, y1, top, side, front) { return { x0: x0, x1: x1, z0: z0, z1: z1, y0: y0, y1: y1, top: top, side: side || top, front: front || side || top }; }
  // the boxes of one car in its own frame: x forward, z to the driver's right, y up, in cells
  function carBoxes(id, look) {
    var M = D.CARS[id].model, paint = D.lookOpt('paint', look.paint).c, trim = D.lookOpt('trim', look.trim).c;
    var L = M.len / 2, W = M.wid / 2, wr = M.wheel * (look.wheels === 'chunky' ? 1.2 : 1), y0 = wr * 0.9, y1 = y0 + M.h, b = [];
    // wheels, with a hub cap on the outer face
    var wx = L - Math.max(0.24, wr * 0.95), ww = 0.2, hub = HUB_COL[look.wheels] || HUB_COL.stock;
    [-1, 1].forEach(function (fx) { [-1, 1].forEach(function (sz) {
      var cx = fx * wx, z0 = sz > 0 ? W - ww * 0.4 : -W - ww * 0.6, z1 = z0 + ww;
      b.push(box(cx - wr, cx + wr, z0, z1, 0, wr * 2, TYRE));
      var hz = sz > 0 ? z1 : z0 - 0.03;
      b.push(box(cx - wr * 0.45, cx + wr * 0.45, hz, hz + 0.03, wr * 0.55, wr * 1.45, hub));
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
  function renderModel(boxes, h, scale) {
    scale = scale || 1;
    var hw = HW * scale, hh = HH * scale, bh = BH * scale, ch = Math.cos(h), sh = Math.sin(h);
    function proj(x, y, z) { var wx = x * ch - z * sh, wz = x * sh + z * ch; return [(wx - wz) * hw, (wx + wz) * hh - y * bh, wx + wz]; }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    var faces = [];
    boxes.forEach(function (B) {
      var cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, cy = (B.y0 + B.y1) / 2, c = proj(cx, cy, cz);
      var defs = [
        { n: [0, 1, 0], v: [[B.x0, B.y1, B.z0], [B.x1, B.y1, B.z0], [B.x1, B.y1, B.z1], [B.x0, B.y1, B.z1]], col: B.top },
        { n: [1, 0, 0], v: [[B.x1, B.y0, B.z0], [B.x1, B.y1, B.z0], [B.x1, B.y1, B.z1], [B.x1, B.y0, B.z1]], col: B.front },
        { n: [-1, 0, 0], v: [[B.x0, B.y0, B.z0], [B.x0, B.y1, B.z0], [B.x0, B.y1, B.z1], [B.x0, B.y0, B.z1]], col: B.side },
        { n: [0, 0, 1], v: [[B.x0, B.y0, B.z1], [B.x1, B.y0, B.z1], [B.x1, B.y1, B.z1], [B.x0, B.y1, B.z1]], col: B.side },
        { n: [0, 0, -1], v: [[B.x0, B.y0, B.z0], [B.x1, B.y0, B.z0], [B.x1, B.y1, B.z0], [B.x0, B.y1, B.z0]], col: B.side }
      ];
      defs.forEach(function (f) {
        var nx = f.n[0] * ch - f.n[2] * sh, nz = f.n[0] * sh + f.n[2] * ch;
        if (!f.n[1] && nx + nz <= 0.001) return;
        var k = f.n[1] ? 1.08 : 0.86 + 0.16 * (nx - nz) / 1.42;
        var pts = f.v.map(function (p) { var q = proj(p[0], p[1], p[2]); minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); return q; });
        faces.push({ pts: pts, col: shadeRGB(hex3(f.col), k), depth: c[2] + (B.y0 + B.y1) * 0.12 + (f.n[1] ? 0.001 : 0) });
      });
    });
    faces.sort(function (a, b) { return a.depth - b.depth; });
    var pad = 2, ox = Math.ceil(-minX) + pad, oy = Math.ceil(-minY) + pad;
    var cv = mkCanvas(Math.ceil(maxX - minX) + pad * 2 + 1, Math.ceil(maxY - minY) + pad * 2 + 1), x = cv.getContext('2d');
    faces.forEach(function (f) {
      x.fillStyle = f.col; x.beginPath();
      f.pts.forEach(function (p, i) { if (i) x.lineTo(ox + p[0], oy + p[1]); else x.moveTo(ox + p[0], oy + p[1]); });
      x.closePath(); x.fill();
    });
    crisp(cv);
    cv.ax = ox; cv.ay = oy;
    return cv;
  }
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

  // the kid driver: cap, jacket, jeans; four facings with a two-step walk
  var KID_PAL = { h: '#e5483a', H: '#a8322a', s: SKIN, S: '#d9a27c', e: '#2b2233', j: '#3fa8ff', J: '#2a6fb0', p: '#3a4a8a', P: '#2a3566', b: '#5a3a22', w: '#ffffff', y: '#ffd23f' };
  var KID = {
    front: [
      '..hhhhhh..', '.hhhhhhhh.', 'HHHHHHHHHH', '..ssssss..', '..sesses..', '..ssssss..', '...sSSs...',
      '.jjjyyjjj.', 'jjjjyyjjjj', 'sjjjjjjjjs', 's.jjjjjj.s', '..pppppp..', '..pp..pp..', '..pp..pp..', '..bb..bb..'
    ],
    back: [
      '..hhhhhh..', '.hhhhhhhh.', '.hhhhhhhh.', '..bbbbbb..', '..bbbbbb..', '..bbbbbb..', '...ssss...',
      '.jjjjjjjj.', 'jjjjJJjjjj', 'sjjjjjjjjs', 's.jjjjjj.s', '..pppppp..', '..pp..pp..', '..pp..pp..', '..bb..bb..'
    ],
    side: [
      '...hhhhh..', '..hhhhhhh.', '..hhhhhhHHH', '...bssss..', '...bsses..', '...ssssss.', '....sSs...',
      '...jjjjj..', '..jjjjjjj.', '..jjjsjj..', '...jjsjj..', '...ppppp..', '...pp.pp..', '...pp.pp..', '...bb.bb..'
    ]
  };
  var kidCache = {};
  function legsShift(rows, phase) {
    if (!phase) return rows;
    var out = rows.slice(), n = rows.length;
    // swap one leg up for the walk frame
    out[n - 1] = phase > 0 ? rows[n - 1].replace(/bb(\.+)bb/, 'bb$1..') : rows[n - 1].replace(/bb(\.+)bb/, '..$1bb');
    out[n - 2] = phase > 0 ? rows[n - 2] : rows[n - 2];
    return out;
  }
  // facing in world radians; screen direction decides the sprite
  function kid(face, walk, moving) {
    var sx = Math.cos(face) - Math.sin(face), sy = Math.cos(face) + Math.sin(face); // screen-space direction
    var view = Math.abs(sx) > Math.abs(sy) * 1.2 ? 'side' : sy > 0 ? 'front' : 'back';
    var flip = view === 'side' && sx < 0;
    var phase = moving ? (Math.floor(walk * 3) % 2 ? 1 : -1) : 0;
    var key = view + flip + phase;
    if (!kidCache[key]) { var c = grid(legsShift(KID[view], phase), KID_PAL); kidCache[key] = flip ? mirror(c) : c; }
    return kidCache[key];
  }

  // ---------- scenery ----------
  var SCN = {};
  function scenery(name) {
    if (SCN[name]) return SCN[name];
    var c;
    if (name === 'oak') c = grid([
      '.....gggg.....', '...gggGggggg...', '..ggGgggggGgg..', '.gggggggGggggg.', 'ggGgggggggggGgg', 'gggggGgggggggg', 'GgggggggGggggG',
      '.GGgggggggggGG.', '..GGGgggggGGG..', '....GGGGGGG....', '......tt......', '......tt......', '.....tTtt.....'
    ], { g: '#5cb84a', G: '#3f8f3a', t: '#7a4f2a', T: '#5a3a1e' });
    else if (name === 'pine') c = grid([
      '....p....', '...ppp...', '..pPppp..', '...ppp...', '..ppPpp..', '.ppppppp.', '...ppp...', '..pPppPp.', '.ppppPppp', 'ppPpppppp', '....t....', '....t....'
    ], { p: '#3f9a5a', P: '#2a6f42', t: '#6a4424' });
    else if (name === 'bush') c = grid(['..bbbb..', '.bbBbbb.', 'bbbbbBbb', 'bBbbbbbb', '.bbbbbb.'], { b: '#6ccf5a', B: '#4aa548' });
    else if (name === 'flowers') c = grid(['.r..y.', 'rgr.yy', '.g.ygy', '..g.g.'], { r: '#ff7ac8', y: '#ffd23f', g: '#3f8f3a' }, false);
    else if (name === 'hay') c = grid(['.hhhhhh.', 'hHhhhhHh', 'hhhhhhhh', 'hHhhhhHh', 'hhhhhhhh', '.HHHHHH.'], { h: '#f2cf5c', H: '#c9a23a' });
    else if (name === 'post') c = grid(['ww', 'ww', 'wW', 'wW', 'WW'], { w: '#f4ecd6', W: '#c9bb98' });
    else if (name === 'tyres') c = grid(['.rrrr.', 'rkkkkr', '.rrrr.', 'wkkkkw', '.wwww.', 'rkkkkr', '.rrrr.'], { r: '#e5483a', w: '#f4f1ea', k: '#2a2630' });
    else if (name === 'sign') c = grid(['yyyyyyyy', 'ykkyykky', 'yyyyyyyy', '...pp...', '...pp...', '...pp...'], { y: '#ffd23f', k: '#2a2630', p: '#7a4f2a' });
    else if (name === 'rock') c = grid(['..rrr..', '.rRrrr.', 'rrrrrRr', 'RrrrrrR'], { r: '#a8a29a', R: '#7d776f' });
    SCN[name] = c;
    return c;
  }
  // item crate: a wooden crate with a gold star stamp
  var crateC = null;
  function crate() {
    if (crateC) return crateC;
    var b = [box(-0.32, 0.32, -0.32, 0.32, 0, 0.64, '#c9853a', '#a8622a', '#b87230'),
      box(-0.33, 0.33, -0.33, 0.33, 0.27, 0.37, '#7a421a'), box(-0.12, 0.12, 0.33, 0.34, 0.2, 0.44, '#ffd23f'), box(0.33, 0.34, -0.12, 0.12, 0.2, 0.44, '#ffd23f'),
      box(-0.1, 0.1, -0.1, 0.1, 0.64, 0.65, '#ffd23f')];
    crateC = renderModel(b, 0.3);
    return crateC;
  }
  // a building made of a box and a pitched roof, for the plaza and the trackside
  function building(w, d, h, wall, roof, door) {
    var b = [box(-w / 2, w / 2, -d / 2, d / 2, 0, h, wall, shadeHex(wall, 0.92), wall)];
    var steps = 6;
    for (var i = 0; i < steps; i++) { var f = i / steps, inset = f * d / 2; b.push(box(-w / 2 - 0.15, w / 2 + 0.15, -d / 2 - 0.15 + inset, d / 2 + 0.15 - inset, h + f * d * 0.45, h + (f + 1 / steps) * d * 0.45, roof)); }
    if (door) b.push(box(w / 2, w / 2 + 0.04, -Math.min(1.2, d * 0.3), Math.min(1.2, d * 0.3), 0, Math.min(h * 0.75, 1.6), door));
    return renderModel(b, 0, 1);
  }
  function shadeHex(h, k) { return '#' + hex3(h).map(function (v) { var s = Math.max(0, Math.min(255, Math.round(v * k))).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  var bldCache = {};
  function building1(name) {
    if (bldCache[name]) return bldCache[name];
    var B = {
      barn: function () { return building(4, 3, 2.2, '#c0392b', '#6a3a2a', '#f4ecd6'); },
      house: function () { return building(3, 2.6, 1.8, '#f4ecd6', '#3f6fb0', '#7a4f2a'); },
      house2: function () { return building(2.6, 2.6, 1.7, '#ffe9a8', '#c0392b', '#3f8f4a'); },
      garage: function () { return building(5, 3, 2.4, '#d8d2c4', '#3a4a8a', '#ffb547'); },
      paint: function () { return building(5, 3, 2.2, '#ff9fd0', '#8a5ad8', '#ffd23f'); },
      stand: function () { var b = []; for (var i = 0; i < 3; i++) b.push(box(-3, 3, -0.6 + i * 0.5, -0.1 + i * 0.5, 0, 0.35 + i * 0.35, i % 2 ? '#3fa8ff' : '#e5483a', '#9aa3b2')); return renderModel(b, 0); }
    };
    bldCache[name] = B[name]();
    return bldCache[name];
  }
  // a windmill tower; the sails are drawn turning by the renderer
  var millC = null;
  function windmill() {
    if (millC) return millC;
    var b = [];
    for (var i = 0; i < 6; i++) { var k = 1 - i * 0.09; b.push(box(-0.9 * k, 0.9 * k, -0.9 * k, 0.9 * k, i * 0.6, (i + 1) * 0.6, '#f4ecd6', '#d8ccb0')); }
    b.push(box(-0.6, 0.6, -0.6, 0.6, 3.6, 4.1, '#c0392b'));
    b.push(box(0.55, 0.95, -0.2, 0.2, 3.65, 4.05, '#7a4f2a'));
    millC = renderModel(b, 0.25);
    millC.hubX = 0.9; millC.hubY = 3.85;
    return millC;
  }
  var beeC = null;
  function bee() { if (!beeC) beeC = grid(['.ww.ww.', '..ww...', 'kykyky.', 'ykykyke', 'kykyky.'], { w: '#e8f6ff', k: '#2a2630', y: '#ffd23f', e: '#2a2630' }); return beeC; }

  return { HW: HW, HH: HH, BH: BH, HEADINGS: HEADINGS, car: car, carPreview: carPreview, kid: kid, scenery: scenery, crate: crate,
    building: building1, windmill: windmill, bee: bee, renderModel: renderModel, box: box, crisp: crisp };
})();
