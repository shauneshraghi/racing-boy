// Racing Boy: renderer (RBRender). A track's ground is one top-down pixel texture (TEX texels per cell). Races are
// seen from a chase camera behind the car: the texture is sampled per pixel onto a perspective ground plane (a
// 16-bit "Mode 7" look) and the scenery, ramps, crates, coins and cars are sprites sized by distance, drawn far to
// near. The garage plaza is isometric: its texture goes through an affine transform and sprites sort by x + z. With WebGL2 the scene, a half-size emissive layer and (in races) a
// depth buffer go through RBPost for tilt-shift, fog, cloud shadows, sun shafts, lights, bloom and grading; without it
// the scene is drawn straight to the visible canvas. Text goes on the overlay canvas so the blur never touches it.
var RBRender = (function () {
  'use strict';
  var D = RB, S = RBSprites, TEX = 12;
  var cv, ov, octx, scv, sctx, ecv, ectx, ctx, post = false, vw = 1, vh = 1, dpr = 1;
  var hw = 40, hh = 20, ox = 0, oy = 0, time = 0, lights = [];
  var cam = { x: 0, z: 0, init: false, zoom: 1 };
  var parts = [], floaters = [], shake = 0;
  var view = { right: 0, bottom: 0 }; // CSS pixels a panel covers, so the camera centres on the rest
  var grounds = {}, decor = {};

  function prng(seed) { var a = seed | 0; return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function rgba(hex, a) { var c = parseInt(hex.slice(1, 7), 16); return 'rgba(' + (c >> 16) + ',' + (c >> 8 & 255) + ',' + (c & 255) + ',' + a + ')'; }
  function rgb3(hex) { var c = parseInt(hex.slice(1, 7), 16); return [(c >> 16) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]; }
  function P(x, y, z) { return [ox + (x - z) * hw, oy + (x + z) * hh - y * hw]; }
  function glow(x, y, r, col, a) {
    if (!post || r <= 0) return;
    x /= 2; y /= 2; r /= 2;
    var g = ectx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(col, a)); g.addColorStop(0.4, rgba(col, a * 0.35)); g.addColorStop(1, rgba(col, 0));
    ectx.fillStyle = g; ectx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  function light(x, y, r, i, col) { if (post) lights.push({ x: x, y: y, r: r, i: i, c: rgb3(col) }); }

  // ---------- setup ----------
  function init(canvas, overlay) {
    cv = canvas; ov = overlay; octx = ov.getContext('2d');
    var hd = new URLSearchParams(location.search).get('hd') !== '0';
    post = hd && typeof RBPost !== 'undefined' && RBPost.init(cv);
    if (post) {
      scv = document.createElement('canvas'); sctx = scv.getContext('2d');
      ecv = document.createElement('canvas'); ectx = ecv.getContext('2d');
      ctx = sctx;
    } else ctx = cv.getContext('2d');
    console.log('Racing Boy renderer: ' + (post ? 'HD-2D (WebGL2 post-process)' : 'plain 2D'));
    resize();
  }
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var r = cv.getBoundingClientRect();
    vw = Math.max(1, Math.round(r.width * dpr)); vh = Math.max(1, Math.round(r.height * dpr));
    if (!post) { cv.width = vw; cv.height = vh; }
    else { cv.width = vw; cv.height = vh; scv.width = vw; scv.height = vh; ecv.width = vw >> 1; ecv.height = vh >> 1; }
    ov.width = vw; ov.height = vh;
  }
  function baseHw() { return Math.max(18, Math.round(Math.sqrt(vw * vh) / 21)); }

  // ---------- pixel textures ----------
  function tile(base, specks, n, seed, extra) {
    var c = document.createElement('canvas'); c.width = c.height = 48; var x = c.getContext('2d'), r = prng(seed);
    x.fillStyle = base; x.fillRect(0, 0, 48, 48);
    for (var i = 0; i < n; i++) { x.fillStyle = specks[Math.floor(r() * specks.length)]; x.fillRect(Math.floor(r() * 48), Math.floor(r() * 48), 1 + Math.floor(r() * 2), 1); }
    if (extra) extra(x, r);
    return c;
  }
  var TILES = null;
  function blades(col) { return function (x, r) { for (var i = 0; i < 40; i++) { var a = Math.floor(r() * 48), b = Math.floor(r() * 46); x.fillStyle = col; x.fillRect(a, b, 1, 2); } }; }
  // soft patches that wrap round the tile (so the repeat is harder to see), then tufts: a lit tip over a dark root
  function patches(cols, n, rmax) { return function (x, r) { for (var i = 0; i < n; i++) { var cx = r() * 48, cz = r() * 48, rr = 3 + r() * rmax; x.fillStyle = cols[i % cols.length];
    for (var a = -rr; a <= rr; a++) for (var b = -rr; b <= rr; b++) if (a * a + b * b < rr * rr * (0.7 + r() * 0.3)) x.fillRect(((Math.round(cx + a) % 48) + 48) % 48, ((Math.round(cz + b) % 48) + 48) % 48, 1, 1); } }; }
  function tufts(lit, dark, n) { return function (x, r) { for (var i = 0; i < n; i++) { var a = Math.floor(r() * 48), b = Math.floor(r() * 46); x.fillStyle = dark; x.fillRect(a, b + 1, 1, 1); x.fillStyle = lit; x.fillRect(a, b, 1, 1); if (r() < 0.5) x.fillRect(a + 1, b + 1, 1, 1); } }; }
  function both() { var fs = arguments; return function (x, r) { for (var i = 0; i < fs.length; i++) fs[i](x, r); }; }
  // cobbles: rounded stones of mixed widths in courses with dark gaps, each a little lighter on its top edge and
  // darker on its bottom edge than its own colour
  function mixHex(h, k) { var c = parseInt(h.slice(1, 7), 16); return 'rgb(' + [c >> 16, c >> 8 & 255, c & 255].map(function (v) { return Math.round(k > 1 ? v + (255 - v) * (k - 1) : v * k); }).join(',') + ')'; }
  function cobbles(cols, gap, seed) {
    var c = document.createElement('canvas'); c.width = c.height = 48; var x = c.getContext('2d'), r = prng(seed);
    x.fillStyle = gap; x.fillRect(0, 0, 48, 48);
    function px(a, b, col) { x.fillStyle = col; x.fillRect(((a % 48) + 48) % 48, b, 1, 1); }
    for (var sy = 0; sy < 48; sy += 4) {
      var sx = Math.floor(r() * 6), end = sx + 48;
      while (sx < end) {
        var w = Math.min(end - sx, 3 + Math.floor(r() * 4)), h = 3, col = cols[Math.floor(r() * cols.length)];
        if (end - sx - w < 3) w = end - sx;
        for (var a = 0; a < w - 1; a++) for (var b = 0; b < h; b++) { if ((a === 0 || a === w - 2) && (b === 0 || b === h - 1)) continue; px(sx + a, sy + b, b === 0 ? mixHex(col, 1.1) : b === h - 1 ? mixHex(col, 0.86) : col); }
        sx += w;
      }
    }
    return c;
  }
  function tiles() {
    if (TILES) return TILES;
    // with the HD grade the grass is a muted olive (the grade warms it); plain 2D keeps the brighter green
    TILES = post ? {
      grass: tile('#53692c', ['#5c7230', '#4a6028', '#66793a', '#435a26', '#6e7e3c'], 300, 1, both(patches(['#4a5f28', '#5d7032', '#46592a'], 7, 6), tufts('#7f8c44', '#36481f', 90))),
      rough: tile('#435828', ['#3b4f24', '#344720', '#4c622c', '#56602e'], 260, 2, both(patches(['#3a4c22', '#4a5a2a'], 6, 6), tufts('#6a7a3a', '#2c3c1a', 110))),
      road: tile('#4e4a48', ['#47433f', '#57524d', '#403c3a', '#605a54', '#3a3634'], 340, 3, both(patches(['#4a4644', '#54504c'], 5, 7), function (x, r) {
        for (var i = 0; i < 6; i++) { var a = r() * 48, b = r() * 48; x.fillStyle = '#34302e'; for (var k = 0; k < 7; k++) { x.fillRect(Math.floor(a) % 48, Math.floor(b) % 48, 1, 1); a += r() * 2 - 0.5; b += r() * 2 - 1; } }
        for (i = 0; i < 30; i++) { x.fillStyle = '#6c665e'; x.fillRect(Math.floor(r() * 48), Math.floor(r() * 48), 1, 1); } }))
    } : {
      grass: tile('#6cc04a', ['#7fd35a', '#5cae3f', '#8ade66'], 160, 1),
      rough: tile('#57a83e', ['#468f32', '#3f8a2e', '#6abf4d'], 220, 2, blades('#3c7f2c')),
      road: tile('#5c6170', ['#535866', '#666b7a', '#4d5260', '#707585'], 260, 3)
    };
    // the canyon: wind-rippled sand, red gravel in the runoff, a warm dusty road
    TILES.sand = tile('#d6a464', ['#e2b474', '#c8945a', '#ecc488', '#bf8a52'], 260, 7, function (x, r) { for (var i = 0; i < 18; i++) { var a = Math.floor(r() * 44), b = Math.floor(r() * 48); x.fillStyle = '#c08850'; x.fillRect(a, b, 4, 1); } });
    TILES.gravel = tile('#b8693e', ['#a85a34', '#c87a48', '#8e4a2c', '#d08a5a'], 280, 8);
    TILES.droad = tile('#6a5856', ['#5e4e4c', '#76625e', '#584846', '#806a64'], 260, 9);
    var more = {
      pave: post ? cobbles(['#8a7e70', '#968a78', '#7c7266', '#a09482', '#847868', '#8e8272'], '#4a4038', 4)
        : tile('#cdbfa3', ['#bfb092', '#d8cbb0'], 120, 4, function (x) { x.fillStyle = '#b3a487'; for (var i = 0; i < 48; i += 12) { x.fillRect(0, i, 48, 1); x.fillRect(i + (i % 24 ? 6 : 0), 0, 1, 48); } }),
      dirt: tile('#8a6a44', ['#7a5c3a', '#9a7a50', '#6a4e32', '#a88a5e'], 220, 5),
      water: tile('#3fa8e0', ['#5cc0f0', '#3496cc'], 90, 6)
    };
    Object.keys(more).forEach(function (k) { TILES[k] = more[k]; });
    return TILES;
  }

  // ---------- per-world land: ground tiles and colours, scenery, backdrop ----------
  // keyed by WORLDS[w].id (hills, desert); a world without an entry falls back to hills
  var LAND = {
    hills: { grass: 'grass', rough: 'rough', road: 'road', bg: '#53692c', bg2d: '#6cc04a', shoulder: '#7a5c3c', distant: [74, 96, 46], distant2d: [98, 170, 72],
      specks: ['#c86a80', '#d8b850', '#e8dcc4', '#3e5a28'], dust: '#6a7a3a', bld: ['barn', 'house', 'house2', 'house'],
      trees: [['oak', 0.45], ['pine', 0.7], ['bush', 0.9], ['rock', 1]], band: ['elm', 'oakD', 'elm', 'bushD', 'pine', 'elm'], verge: 'hay' },
    desert: { grass: 'sand', rough: 'gravel', road: 'droad', bg: '#d6a464', bg2d: '#d6a464', shoulder: '#c07a46', distant: [214, 162, 100], distant2d: [214, 162, 100],
      specks: ['#8a4a2e', '#a8924a', '#f0d4a0', '#6a5030'], dust: '#d8b078', bld: ['adobe', 'butte', 'adobe', 'butte'],
      trees: [['cactus', 0.35], ['shrub', 0.62], ['redrock', 0.84], ['pillar', 1]], band: ['cactus', 'redrock', 'shrub', 'pillar', 'cactus'], verge: 'shrub', palms: true }
  };
  function worldId(trackId) { var t = D.TRACKS[trackId], w = t && D.WORLDS[t.world]; return w ? w.id : 'hills'; }
  function landOf(trackId) { return LAND[worldId(trackId)] || LAND.hills; }

  // ---------- track ground ----------
  function buildGround(g, Ld) {
    var T = TEX, W = g.w * T, H = g.h * T, c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), tl = tiles(), hwR = g.hw;
    function tp(p) { return [(p.x - g.x0) * T, (p.z - g.z0) * T]; }
    function off(s, d) { return tp(D.pointAt(g, s, d)); }
    function loop() { x.beginPath(); for (var i = 0; i <= g.n; i++) { var p = tp(g.samples[i]); if (i) x.lineTo(p[0], p[1]); else x.moveTo(p[0], p[1]); } x.closePath(); }
    function band(s0, s1, d0, d1) { x.beginPath(); var s; for (s = s0; s <= s1 + 0.01; s += 0.5) { var a = off(s, d0); if (s === s0) x.moveTo(a[0], a[1]); else x.lineTo(a[0], a[1]); } for (s = s1; s >= s0 - 0.01; s -= 0.5) { var b = off(s, d1); x.lineTo(b[0], b[1]); } x.closePath(); }
    function polyline(s0, s1, d) { x.beginPath(); for (var s = s0; s <= s1 + 0.01; s += 0.5) { var a = off(s, d); if (s === s0) x.moveTo(a[0], a[1]); else x.lineTo(a[0], a[1]); } }
    x.fillStyle = x.createPattern(tl[Ld.grass], 'repeat'); x.fillRect(0, 0, W, H);
    var mr = prng(g.n * 5 + 11);
    // HD: broad patches of darker and sunnier ground, so the field is not one flat colour
    if (post) for (var mb = 0; mb < g.w * g.h / 40; mb++) {
      var mx = mr() * W, mz = mr() * H, rad = (1.5 + mr() * 4) * T, dark = mr() < 0.55;
      x.fillStyle = dark ? 'rgba(30,48,22,0.16)' : 'rgba(255,236,150,0.1)';
      if (Ld === LAND.desert) x.fillStyle = dark ? 'rgba(120,50,20,0.14)' : 'rgba(255,240,200,0.14)';
      x.beginPath(); x.ellipse(mx, mz, rad, rad * (0.5 + mr() * 0.5), mr() * 3, 0, 6.3); x.fill();
    }
    x.lineJoin = 'round'; x.lineCap = 'round';
    // a dirt shoulder, the rough grass, then the road
    loop(); x.strokeStyle = x.createPattern(tl[Ld.rough], 'repeat'); x.lineWidth = 2 * (hwR + D.RUNOFF + 0.4) * T; x.stroke();
    loop(); x.strokeStyle = Ld.shoulder; x.lineWidth = 2 * (hwR + 0.7) * T; x.stroke();
    // curbs where the road bends
    var runs = [], inRun = -1;
    for (var i = 0; i <= g.n; i++) { var bent = i < g.n && Math.abs(g.samples[i].k) > 0.04; if (bent && inRun < 0) inRun = i; if (!bent && inRun >= 0) { runs.push([inRun, i]); inRun = -1; } }
    runs.forEach(function (rr) {
      var s0 = Math.max(0, rr[0] * 0.5 - 2), s1 = rr[1] * 0.5 + 2;
      [-1, 1].forEach(function (sd) {
        for (var s = s0; s < s1; s += 1) { band(s, Math.min(s1, s + 1), sd * (hwR - 0.1), sd * (hwR + 0.6)); x.fillStyle = Math.round(s) % 2 ? '#f4f1ea' : '#e5483a'; x.fill(); }
      });
    });
    loop(); x.strokeStyle = x.createPattern(tl[Ld.road], 'repeat'); x.lineWidth = 2 * hwR * T; x.stroke();
    // white edge lines and a dashed centre line
    [-1, 1].forEach(function (sd) { polyline(0, g.L, sd * (hwR - 0.3)); x.strokeStyle = 'rgba(244,241,234,0.85)'; x.lineWidth = 0.16 * T; x.stroke(); });
    x.setLineDash([T * 1.2, T * 1.4]); polyline(0, g.L, 0); x.strokeStyle = 'rgba(255,224,102,0.55)'; x.lineWidth = 0.14 * T; x.stroke(); x.setLineDash([]);
    // start and finish: a checker band across the road
    for (var row = 0; row < 2; row++) for (var col = 0; col < 8; col++) {
      var d0 = -hwR + col * (2 * hwR / 8); band(row * 0.6, row * 0.6 + 0.6, d0, d0 + 2 * hwR / 8);
      x.fillStyle = (row + col) % 2 ? '#2a2630' : '#f4f1ea'; x.fill();
    }
    // creeks under the jumps, running off past the fences
    g.ramps.forEach(function (m) {
      if (!m.gap) return;
      var a = m.s + m.len, b = a + m.gap, wide = hwR + D.RUNOFF + 10;
      band(a - 0.4, b + 0.4, -wide, wide); x.fillStyle = Ld.shoulder; x.fill();
      band(a, b, -wide, wide); x.fillStyle = x.createPattern(tl.water, 'repeat'); x.fill();
      band(a, a + 0.25, -wide, wide); x.fillStyle = 'rgba(255,255,255,0.6)'; x.fill();
    });
    // boost pads: orange plates with yellow chevrons
    g.pads.forEach(function (pd) {
      band(pd.s - D.PAD_LEN / 2, pd.s + D.PAD_LEN / 2, pd.off - D.PAD_W / 2, pd.off + D.PAD_W / 2); x.fillStyle = '#ff8a1c'; x.fill();
      for (var k = 0; k < 2; k++) {
        var s = pd.s - 0.7 + k * 0.9, tip = off(s + 0.55, pd.off), l = off(s, pd.off - 0.9), rr = off(s, pd.off + 0.9), li = off(s + 0.3, pd.off - 0.9), ri = off(s + 0.3, pd.off + 0.9), ti = off(s + 0.85, pd.off);
        x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(tip[0], tip[1]); x.lineTo(rr[0], rr[1]); x.lineTo(ri[0], ri[1]); x.lineTo(ti[0], ti[1]); x.lineTo(li[0], li[1]); x.closePath();
        x.fillStyle = '#ffe066'; x.fill();
      }
    });
    // flowers and stones scattered in the grass
    var r = prng(g.n * 7 + 3);
    for (var f = 0; f < g.w * g.h / 6; f++) {
      var wx = g.x0 + r() * g.w, wz = g.z0 + r() * g.h, q = g.query(wx, wz);
      if (Math.abs(q.d) < hwR + D.RUNOFF + 0.8) continue;
      var px = (wx - g.x0) * T, pz = (wz - g.z0) * T, kind = r();
      x.fillStyle = Ld.specks[kind < 0.3 ? 0 : kind < 0.55 ? 1 : kind < 0.75 ? 2 : 3];
      x.fillRect(Math.round(px), Math.round(pz), 2, 2);
    }
    return c;
  }
  // trees, houses, fences, the finish arch, built once per track
  function buildDecor(g, trackId, Ld) {
    var r = prng(g.n * 13 + 1), items = [], i, lim = g.hw + D.RUNOFF;
    function free(x, z, m) { var q = g.query(x, z); return Math.abs(q.d) > lim + m; }
    // buildings, set well back
    var kinds = trackId === 'windmill' && Ld === LAND.hills ? ['windmill', 'barn', 'house', 'windmill'] : Ld.bld;
    var placed = [];
    for (i = 0; i < 400 && placed.length < 9; i++) {
      var x = g.x0 + 6 + r() * (g.w - 12), z = g.z0 + 6 + r() * (g.h - 12);
      if (!free(x, z, 5)) continue;
      if (placed.some(function (p) { return Math.hypot(p[0] - x, p[1] - z) < 9; })) continue;
      placed.push([x, z]);
      var k = kinds[placed.length % kinds.length];
      items.push({ x: x, z: z, kind: k === 'windmill' ? 'mill' : 'bld', name: k });
    }
    // trees and bushes
    for (i = 0; i < g.w * g.h / 14; i++) {
      var tx = g.x0 + r() * g.w, tz = g.z0 + r() * g.h;
      if (!free(tx, tz, 1.6)) continue;
      if (placed.some(function (p) { return Math.hypot(p[0] - tx, p[1] - tz) < 3.5; })) continue;
      var pick = r(), nm = Ld.trees[0][0];
      for (var tk = Ld.trees.length - 1; tk >= 0; tk--) if (pick < Ld.trees[tk][1]) nm = Ld.trees[tk][0];
      items.push({ x: tx, z: tz, kind: 'spr', name: nm });
    }
    // a dense band of woods (or rocks and cactus) just past the fences, so the frame edges are full and dark
    for (var bs = 0; bs < g.L; bs += 2.6) [-1, 1].forEach(function (sd) {
      if (r() < 0.3) return;
      var bp = D.pointAt(g, bs + r() * 2, sd * (lim + 2.4 + r() * 6));
      if (!free(bp.x, bp.z, 1.8) || placed.some(function (p) { return Math.hypot(p[0] - bp.x, p[1] - bp.z) < 3.5; })) return;
      items.push({ x: bp.x, z: bp.z, kind: 'spr', name: Ld.band[Math.floor(r() * Ld.band.length)] });
    });
    // palms round the water at the jumps (canyon oases)
    if (Ld.palms) g.ramps.forEach(function (m) {
      if (!m.gap) return;
      for (var k = 0; k < 6; k++) { var pp = D.pointAt(g, m.s + m.len + r() * m.gap, (k % 2 ? 1 : -1) * (lim + 1.2 + r() * 4)); if (free(pp.x, pp.z, 0.8)) items.push({ x: pp.x, z: pp.z, kind: 'spr', name: 'palm' }); }
    });
    // fence posts along both walls, broken where the creeks run, and tyre stacks on the outside of bends
    var gaps = g.ramps.filter(function (m) { return m.gap; });
    for (var s = 0; s < g.L; s += 1.6) {
      var wet = gaps.some(function (m) { var a = ((s - m.s - m.len + 1) % g.L + g.L) % g.L; return a < m.gap + 2; });
      if (wet) continue;
      [-1, 1].forEach(function (sd) {
        var p = D.pointAt(g, s, sd * (lim + 0.35)), n = D.pointAt(g, s + 1.6, sd * (lim + 0.35));
        var bend = p.k * sd < -0.045;
        items.push({ x: p.x, z: p.z, kind: bend ? 'tyres' : 'post', nx: n.x, nz: n.z });
      });
    }
    // hay bales by the road here and there
    for (s = 8; s < g.L; s += 23 + r() * 20) { var sd2 = r() < 0.5 ? -1 : 1, hp = D.pointAt(g, s, sd2 * (lim + 1.4)); if (free(hp.x, hp.z, 0.9)) items.push({ x: hp.x, z: hp.z, kind: 'spr', name: Ld.verge }); }
    // grandstand by the start
    var st = D.pointAt(g, -6, -(lim + 3.2)); items.push({ x: st.x, z: st.z, kind: 'stand', h: st.h });
    return items;
  }
  function ground(id) {
    if (!grounds[id]) { var g = D.track(id), Ld = landOf(id); grounds[id] = buildGround(g, Ld); decor[id] = buildDecor(g, id, Ld); }
    return grounds[id];
  }

  // ---------- camera and frame ----------
  function setCamera(tx, tz, dt, snap) {
    if (!cam.init || snap) { cam.x = tx; cam.z = tz; cam.init = true; }
    var k = Math.min(1, dt * 6); cam.x += (tx - cam.x) * k; cam.z += (tz - cam.z) * k;
    hw = baseHw() * cam.zoom; hh = hw / 2;
    var sx = (shake > 0 ? (Math.random() - 0.5) * shake * hw * 0.3 : 0);
    var cw = vw - view.right * dpr, ch = vh - view.bottom * dpr;
    ox = cw / 2 - (cam.x - cam.z) * hw + sx; oy = ch * 0.56 - (cam.x + cam.z) * hh;
  }
  function begin(bg) {
    lights = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, vw, vh);
    if (post) { ectx.setTransform(1, 0, 0, 1, 0, 0); ectx.globalCompositeOperation = 'source-over'; ectx.fillStyle = '#000'; ectx.fillRect(0, 0, ecv.width, ecv.height); ectx.globalCompositeOperation = 'lighter'; }
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, vw, vh);
  }
  // the plaza's HD-2D pass: a tight tilt-shift band round the kid that goes very soft above and below, the hills'
  // warm grade, cloud shadows and dappled light placed on the ground through the isometric transform (iso)
  function end(focusY) {
    if (!post) return;
    var sk = SKY.hills;
    RBPost.render(scv, ecv, {
      lights: lights, amb: [0.82, 0.8, 0.78], focus: [focusY - vh * 0.2, focusY + vh * 0.14, vh * 0.28, 1.4],
      bloom: 0.75, thr: 0.8, sat: sk.sat, vig: 0.78, caustic: 0, shadowTint: sk.sh, hiTint: sk.hi, lift: sk.lift, tone: sk.tone, time: time, scale: hw / 40, grain: 0.02,
      iso: [ox, oy, hw, hh], cloud: sk.cloudK, wind: [0.035, 0.018], dapple: [sk.dap * 0.6, 0.3], dapCol: sk.dapCol
    });
  }
  function drawGround(gc, x0, z0) {
    ctx.save();
    ctx.setTransform(hw / TEX, hh / TEX, -hw / TEX, hh / TEX, ox + (x0 - z0) * hw, oy + (x0 + z0) * hh);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(gc, 0, 0);
    ctx.restore();
  }
  function sprite(c, x, y, z, k, alpha) {
    var p = P(x, y, z), s = (hw / S.HW) * (k || 1);
    var ax = c.ax !== undefined ? c.ax : c.width / 2, ay = c.ay !== undefined ? c.ay : c.height;
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    ctx.drawImage(c, Math.round(p[0] - ax * s), Math.round(p[1] - ay * s), Math.round(c.width * s), Math.round(c.height * s));
    if (alpha !== undefined) ctx.globalAlpha = 1;
    return p;
  }
  function shadow(x, z, rx, a) { var p = P(x, 0, z); ctx.fillStyle = 'rgba(20,30,10,' + (a || 0.28) + ')'; ctx.beginPath(); ctx.ellipse(p[0], p[1], rx * hw, rx * hh, 0, 0, Math.PI * 2); ctx.fill(); }

  // ---------- race ----------
  var TRAIL = {
    flame: ['#ffe066', '#ff8a1c', '#e5483a'], leaves: ['#9ad13a', '#5cb84a', '#ffd23f'], stars: ['#fff3b0', '#ffd23f', '#8fd8ff'],
    bubbles: ['#bff7ff', '#8fd8ff', '#ffffff'], rainbow: ['#e5483a', '#ff8a1c', '#ffd23f', '#58e07a', '#3fa8ff', '#8a5ad8'], hearts: ['#ff7ac8', '#ff4b8a', '#ffd0e8']
  };
  function addPart(o) { if (parts.length < 500) parts.push(o); }
  function emitTrail(car, n) {
    var cols = TRAIL[car.look.trail] || TRAIL.flame, back = D.CARS[car.carId].model.len / 2 + 0.15;
    for (var i = 0; i < n; i++) {
      var a = car.h + Math.PI + (Math.random() - 0.5) * 0.6;
      addPart({ x: car.x - Math.cos(car.h) * back, y: car.y + 0.25, z: car.z - Math.sin(car.h) * back, vx: Math.cos(a) * 2, vy: 0.6 + Math.random(), vz: Math.sin(a) * 2,
        life: 0.35 + Math.random() * 0.2, max: 0.5, col: cols[Math.floor(Math.random() * cols.length)], size: 0.16 + Math.random() * 0.1, glow: car.look.trail !== 'leaves', shape: car.look.trail });
    }
  }
  function burst(x, y, z, cols, n, sp, size, glowIt) {
    for (var i = 0; i < n; i++) { var a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random()); addPart({ x: x, y: y, z: z, vx: Math.cos(a) * v, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, col: cols[i % cols.length], size: size, glow: glowIt, grav: true }); }
  }
  function floater(x, y, z, text, col) { floaters.push({ x: x, y: y, z: z, t: 0, text: text, col: col || '#ffd23f' }); if (floaters.length > 12) floaters.shift(); }
  // turn race events into particles and floating text
  function events(r, list) {
    list.forEach(function (e) {
      var c = e.car >= 0 ? r.cars[e.car] : null;
      if (!c) return;
      if (e.type === 'coin' && c.i === 0) { burst(e.x || c.x, 0.5, e.z || c.z, ['#ffd23f', '#fff3b0'], 5, 2, 0.12, true); }
      if (e.type === 'splash') burst(c.x, 0.1, c.z, ['#bff7ff', '#5cc0f0', '#ffffff'], 24, 3, 0.18, false);
      if (e.type === 'land') burst(c.x, 0.05, c.z, ['#d8cbb0', '#b98a54'], 10, 2.5, 0.16, false);
      if (e.type === 'hit') { burst(c.x, 0.8, c.z, e.kind === 'goo' ? ['#58e07a', '#9dff8a'] : ['#ffd23f', '#2a2630'], 14, 2, 0.15, false); if (c.i === 0) shake = 0.35; }
      if (e.type === 'blocked') burst(c.x, 0.7, c.z, ['#bff7ff', '#ffffff'], 16, 3, 0.15, true);
      if (e.type === 'boost' && c.i === 0 && e.from === 'trick') floater(c.x, 1.6, c.z, 'Trick boost!', '#8fd8ff');
      if (e.type === 'boost' && c.i === 0 && e.from === 'glide') floater(c.x, 1.6, c.z, 'Glide boost!', '#ffd23f');
      if (e.type === 'boost' && c.i === 0 && e.from === 'drift') floater(c.x, 1.6, c.z, ['Drift boost!', 'Super drift!', 'Ultra drift!'][e.tier - 1], ['#8fd8ff', '#ff8a1c', '#ff7ae0'][e.tier - 1]);
      if (e.type === 'box') burst(c.x, 0.8, c.z, ['#ffd23f', '#c9853a', '#fff3b0'], 10, 2.5, 0.14, true);
      if (e.type === 'wall' && c.i === 0) shake = Math.max(shake, 0.18);
    });
  }
  function stepParts(dt) {
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.grav) p.vy -= 12 * dt; if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
    }
    for (i = floaters.length - 1; i >= 0; i--) { floaters[i].t += dt; if (floaters[i].t > 1.3) floaters.splice(i, 1); }
    shake = Math.max(0, shake - dt);
  }
  function drawPart(p) {
    var q = P(p.x, p.y, p.z), s = Math.max(2, p.size * hw * (0.5 + p.life / p.max * 0.5));
    ctx.globalAlpha = Math.min(1, p.life / p.max * 1.6);
    ctx.fillStyle = p.col;
    if (p.shape === 'bubbles') { ctx.strokeStyle = p.col; ctx.lineWidth = Math.max(1, s / 5); ctx.beginPath(); ctx.arc(q[0], q[1], s / 2, 0, 6.3); ctx.stroke(); }
    else ctx.fillRect(Math.round(q[0] - s / 2), Math.round(q[1] - s / 2), Math.round(s), Math.round(s));
    ctx.globalAlpha = 1;
    if (p.glow) glow(q[0], q[1], s * 2.2, p.col, 0.5);
  }
  // ---------- chase camera (race) ----------
  // A 16-bit "Mode 7" view: the camera sits behind and above the player's car looking level at the horizon. The
  // ground is the track texture sampled per pixel into a small buffer (one ray per pixel onto the ground plane),
  // the sky is a gradient with two backdrop layers that scroll as the camera turns, and everything standing on the
  // track is a sprite sized by distance and drawn far to near. The buffer is scaled up with hard pixels.
  // The numbers are tuned by eye against 16-bit kart racers; no published camera constants exist.
  // race tilt-shift: fully soft at nearFull × the car's distance, sharp from nearSharp cells in front of the car out to
  // far[0] cells, fully soft by far[1]; k = strength (near, far; above 1 reaches the strongest blur); sky = how soft open sky is
  var DOF = { nearFull: 0.7, nearSharp: 1.0, far: [20, 80], k: [2, 1], sky: 0.55 };
  var CAM = {
    dist: 7.5,          // camera distance behind the car, cells
    follow: 6,          // how fast the camera swings round behind the car (per second)
    near: 0.5, far: 150, // nearest and farthest drawn depth, cells
    land: { w: 320, f: 1.0, horizon: 0.3, car: 0.8 },     // buffer width, focal length (× width), rows (× height)
    tall: { w: 240, f: 1.25, horizon: 0.3, car: 0.74 }    // phone held upright
  };
  // per-world sky and light: sky gradient (top, middle, horizon), haze colour, sun bearing (world radians) and
  // height (× horizon row from the top), cloud colours (lit, shaded), and how dark the cloud shadows fall; the backdrop's
  // far layer and near line colours; the grade: hi and sh tint the highlights and shadows, lift is added to the darkest
  // tones, sat, the shafts' colour, the dappled light's strength and its lit pools' tint (dap, dapCol), and the motes
  var SKY = {
    hills: { sky: ['#56788e', '#a9bcb2', '#ecd6a6'], fog: '#d8c49a', sunAz: -2.2, sunY: 0.32, cloud: ['#fff0d8', '#b4b0b4'], cloudK: 0.3,
      far: ['#8c9a84', '#66785e'], line: '#22382a',
      hi: [1.16, 1.02, 0.8], sh: [0.74, 0.82, 0.84], lift: [0.012, 0.024, 0.03], sat: 0.88, tone: [1.35, 1.12], shaft: [1.0, 0.78, 0.45], dap: 0.75, dapCol: [1.3, 1.12, 0.8], mote: '#ffe7a0' },
    // Sunbaked Canyon: late golden hour, a low sun over the mesas, violet-brown shadows
    desert: { sky: ['#4b5c9c', '#e6a477', '#ffd79c'], fog: '#f2c491', sunAz: -2.0, sunY: 0.5, cloud: ['#ffe4c4', '#d0907a'], cloudK: 0.12,
      far: ['#d9a07c', '#b86c4c'], line: '#a85a3a',
      hi: [1.15, 1.0, 0.8], sh: [0.8, 0.74, 0.84], lift: [0.03, 0.008, 0.03], sat: 0.88, tone: [1.32, 1.06], shaft: [1.0, 0.72, 0.42], dap: 0.25, dapCol: [1.18, 1.06, 0.86], mote: '#ffd9a0' }
  };
  function skyFor(r) { var w = D.WORLDS && D.WORLDS[r.world]; return SKY[w && w.id] || SKY.hills; }
  var lo = null, rc = { x: 0, z: 0, yaw: 0, init: false, lift: 0, boost: 0 }, PX = 1, motes = [];
  var mode7 = {}, backdrops = {}, sailT = 0;
  function layout() {
    var L = vw >= vh ? CAM.land : CAM.tall, w = L.w, h = Math.max(60, Math.round(w * vh / vw));
    if (!lo || lo.w !== w || lo.h !== h) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var gc = document.createElement('canvas'); gc.width = w; gc.height = h;
      var gx = gc.getContext('2d'), img = gx.createImageData(w, h);
      var dc = document.createElement('canvas'); dc.width = w; dc.height = h;
      var dx = dc.getContext('2d'), dimg = dx.createImageData(w, h);
      lo = { w: w, h: h, cv: c, ctx: c.getContext('2d'), gcv: gc, gctx: gx, img: img, u32: new Uint32Array(img.data.buffer),
        dcv: dc, dctx: dx, dimg: dimg, d32: new Uint32Array(dimg.data.buffer) };
      lo.dctx.imageSmoothingEnabled = false;
    }
    PX = vw / lo.w;
    rc.f = w * L.f; rc.y0 = Math.round(h * L.horizon); rc.carRow = h * L.car; rc.cx = w / 2;
  }
  // the track texture and three smaller copies as 32-bit pixels, for sampling the ground
  function groundData(id) {
    if (mode7[id]) return mode7[id];
    var src = ground(id), mips = [], c = src;
    for (var lvl = 0; lvl < 4; lvl++) {
      if (lvl) {
        var n = document.createElement('canvas'); n.width = Math.max(1, c.width >> 1); n.height = Math.max(1, c.height >> 1);
        var nx = n.getContext('2d'); nx.imageSmoothingEnabled = true; nx.imageSmoothingQuality = 'high'; nx.drawImage(c, 0, 0, n.width, n.height); c = n;
      }
      mips.push({ w: c.width, h: c.height, d: new Uint32Array(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.buffer) });
    }
    var Ld = landOf(id), t = tiles()[Ld.grass], tg = t.getContext('2d').getImageData(0, 0, t.width, t.height), dc = post ? Ld.distant : Ld.distant2d;
    mode7[id] = { mips: mips, grass: new Uint32Array(tg.data.buffer), gw: t.width, distant: new Uint32Array(new Uint8Array([dc[0], dc[1], dc[2], 255]).buffer)[0] };
    return mode7[id];
  }
  function drawGround7(gd, g) {
    var W = lo.w, H = lo.h, u32 = lo.u32, y0 = rc.y0, f = rc.f, ch = rc.camY, gw = gd.gw, gr = gd.grass, d32 = lo.d32;
    u32.fill(0, 0, Math.min(H, y0 + 1) * W);
    if (post) d32.fill(depthPx(1e9), 0, Math.min(H, y0 + 1) * W);
    for (var y = y0 + 1; y < H; y++) {
      var row = y * W, z = f * ch / (y - y0 + 0.5);
      if (post) d32.fill(depthPx(z), row, row + W);
      if (z > CAM.far) { u32.fill(gd.distant, row, row + W); continue; } // past the draw distance: plain far-off grass
      var dl = z / f, lvl = Math.max(0, Math.min(3, Math.floor(Math.log2(Math.max(1, dl * TEX * 1.2)))));
      var M = gd.mips[lvl], T = TEX / (1 << lvl), mw = M.w, mh = M.h, md = M.d;
      var lat = -rc.cx * dl;
      var wx = rc.x + rc.fx * z + rc.rx * lat, wz = rc.z + rc.fz * z + rc.rz * lat;
      var u = (wx - g.x0) * T, v = (wz - g.z0) * T, du = rc.rx * dl * T, dv = rc.rz * dl * T;
      var gu = wx * TEX, gv = wz * TEX, gdu = rc.rx * dl * TEX, gdv = rc.rz * dl * TEX;
      for (var x = 0; x < W; x++) {
        var iu = Math.floor(u), iv = Math.floor(v);
        if (iu >= 0 && iv >= 0 && iu < mw && iv < mh) u32[row + x] = md[iv * mw + iu];
        else u32[row + x] = gr[(((Math.floor(gv) % gw) + gw) % gw) * gw + (((Math.floor(gu) % gw) + gw) % gw)];
        u += du; v += dv; gu += gdu; gv += gdv;
      }
    }
    lo.gctx.putImageData(lo.img, 0, 0);
    if (post) lo.dctx.putImageData(lo.dimg, 0, 0);
  }
  // the depth buffer (races, HD only): red = sqrt(depth / DMAX); 255 is open sky, the world stops at 252
  function depthV(d) { return d >= 1e8 ? 255 : Math.min(252, Math.round(Math.sqrt(Math.max(0, d) / RBPost.DMAX) * 255)); }
  function depthPx(d) { return (0xff000000 | depthV(d)) >>> 0; }
  var curD = null; // the depth colour of the item being drawn, or null to leave the depth buffer alone
  function setDepth(d) { curD = post && d !== null ? 'rgb(' + depthV(d) + ',0,0)' : null; }
  // stamp a sprite's silhouette into the depth buffer: punch it out, then fill the holes in its box
  function stamp(img, x, y, w, h) {
    if (!curD) return; var dx = lo.dctx;
    dx.globalCompositeOperation = 'destination-out'; dx.drawImage(img, x, y, w, h);
    dx.globalCompositeOperation = 'destination-over'; dx.fillStyle = curD; dx.fillRect(x, y, w, h);
    dx.globalCompositeOperation = 'source-over';
  }
  // the sky for a world: a gradient, far hills and a near tree line with farms, each one turn of the camera wide
  function backdrop(id, sk) {
    var desert = worldId(id) === 'desert', key = id + '|' + Math.round(rc.f) + '|' + rc.y0 + '|' + (desert ? 'd' : 'h');
    if (backdrops[key]) return backdrops[key];
    var W = Math.round(Math.PI * 2 * rc.f), r = prng(id.length * 31 + 7), fw = Math.round(W * 0.6);
    var far = document.createElement('canvas'); far.width = fw; far.height = Math.max(8, Math.round(rc.y0 * 0.55));
    var fx = far.getContext('2d'), fh = far.height;
    if (desert) {
      // far mesas: flat-topped buttes with stepped sides in two hazy rows, each lit along its rim
      [[sk.far[0], 0.75, 0.25], [sk.far[1], 0.5, 0.2]].forEach(function (L, n) {
        var mr = prng(31 + n * 7), hgt = new Float32Array(fw + 1), xx = 0, k, q;
        while (xx <= fw) {
          var w2 = Math.round(fw * (0.03 + mr() * 0.07)), top = fh * (1 - L[1] * (0.6 + mr() * 0.4)), gap = Math.round(fw * (0.01 + mr() * 0.05));
          for (k = 0; k < w2 + gap && xx + k <= fw; k++) {
            var e = Math.min(k, w2 - k), y2 = k > w2 ? fh * (1 - L[2]) : e < 3 ? top + (3 - e) * fh * 0.06 : top;
            hgt[xx + k] = Math.min(fh * (1 - L[2] * 0.6), y2);
          }
          xx += w2 + gap;
        }
        fx.fillStyle = L[0]; for (q = 0; q <= fw; q++) fx.fillRect(q, Math.round(hgt[q]), 1, fh);
        fx.fillStyle = n ? 'rgba(255,200,140,0.35)' : 'rgba(255,220,170,0.3)'; for (q = 0; q <= fw; q++) fx.fillRect(q, Math.round(hgt[q]), 1, Math.max(1, Math.round(fh * 0.05)));
      });
    } else
    // far hills: two rows of soft humps, seamless across the wrap
    [[sk.far[0], 0.95, 5], [sk.far[1], 0.7, 9]].forEach(function (L) {
      fx.fillStyle = L[0]; fx.beginPath(); fx.moveTo(0, fh);
      for (var x = 0; x <= fw; x++) { var a = x / fw * Math.PI * 2, y = fh * (1 - L[1] * (0.55 + 0.25 * Math.sin(a * L[2]) + 0.2 * Math.sin(a * (L[2] * 2 + 1) + 1.3))); fx.lineTo(x, Math.round(y)); }
      fx.lineTo(fw, fh); fx.closePath(); fx.fill();
    });
    var near = document.createElement('canvas'); near.width = W; near.height = Math.max(8, Math.round(rc.y0 * 0.42));
    var nx = near.getContext('2d'), nh = near.height;
    // farms (canyon: adobe houses and buttes) on the near line, then the hedge and trees (canyon: a dune line, cactus, pillars)
    var kinds = desert ? ['adobe', 'butte', 'adobe', 'butte', 'butte'] : id === 'windmill' ? ['mill', 'barn', 'house', 'mill', 'house2'] : ['barn', 'house', 'house2', 'house'];
    for (var i = 0; i < 7; i++) {
      var b = S.modelView(kinds[i % kinds.length], 0.6 + r() * 0.6, 0.12, Math.max(3, Math.round(nh / 4.5)));
      var bx = Math.round((i + 0.2 + r() * 0.6) / 7 * W);
      nx.drawImage(b, bx - b.ax, nh - 2 - b.ay);
    }
    nx.fillStyle = sk.line;
    for (var x = 0; x < W; x += 2) { var t = Math.sin(x / W * Math.PI * 2 * 23) * 0.5 + Math.sin(x / W * Math.PI * 2 * 61 + 2) * 0.5; var hh2 = Math.round(nh * (0.18 + 0.1 * t)); nx.fillRect(x, nh - hh2, 2, hh2); }
    var tr = S.scenery(desert ? 'cactus' : 'oak'), pn = S.scenery(desert ? 'pillar' : 'pine');
    for (x = 0; x < W; x += (desert ? 16 : 6) + Math.floor(r() * 14)) {
      var tc = r() < 0.6 ? tr : pn, th = Math.round(nh * (0.35 + r() * 0.25)), tw = Math.round(tc.width * th / tc.height);
      nx.drawImage(tc, x, nh - th, tw, th);
    }
    // clouds: flat-bottomed puffs drawn as hard-edged pixel circles, lit on top and shaded underneath
    var cl = document.createElement('canvas'); cl.width = W; cl.height = Math.max(8, Math.round(rc.y0 * 0.8));
    var cx2 = cl.getContext('2d'), chh = cl.height;
    function disc(x0, y0, rr, col, cut) { cx2.fillStyle = col; for (var yy = -rr; yy <= rr; yy++) { if (y0 + yy > cut) break; var hw2 = Math.round(Math.sqrt(rr * rr - yy * yy)); cx2.fillRect(Math.round(x0 - hw2), Math.round(y0 + yy), hw2 * 2, 1); } }
    for (i = 0; i < (desert ? 6 : 12); i++) {
      var ccx = (i + r()) / 12 * W, ccy = chh * (0.3 + r() * 0.5), sz = Math.max(4, Math.round(chh * (0.12 + r() * 0.12))), nb = 4 + Math.floor(r() * 4), base = ccy + sz * 0.5;
      for (var pass2 = 0; pass2 < 2; pass2++) for (var j = 0; j < nb; j++) {
        var px2 = ccx + (j - nb / 2) * sz * 0.9, py2 = ccy - Math.sin((j + 0.5) / nb * Math.PI) * sz * 0.7, rr2 = Math.round(sz * (0.7 + 0.4 * Math.sin(j * 2.3 + i)));
        if (pass2) disc(px2 - 1, py2 - 1, rr2 - 1, sk.cloud[0], base - 2); else disc(px2, py2, rr2, sk.cloud[1], base);
      }
    }
    // haze over the tree line, so it meets the far ground (which the post-process fogs) without a seam
    if (post) { nx.globalCompositeOperation = 'source-atop'; nx.fillStyle = rgba(sk.fog, 0.38); nx.fillRect(0, 0, W, nh); nx.globalCompositeOperation = 'source-over'; }
    backdrops[key] = { far: far, near: near, clouds: cl };
    return backdrops[key];
  }
  // where the sun sits in the buffer, and how far it is from the edge of view (0 off-screen .. 1 centred)
  function sunPos(sk) {
    var a = D.angDiff(sk.sunAz, rc.yaw), c = Math.cos(a);
    if (c < 0.15) return null;
    var x = rc.cx + Math.tan(a) * rc.f, y = rc.y0 * sk.sunY;
    return { x: x, y: y, k: Math.max(0, 1 - Math.abs(x - lo.w / 2) / (lo.w * 0.75)) };
  }
  function drawSky(bd, sk) {
    var x = lo.ctx, y0 = rc.y0, sky = x.createLinearGradient(0, 0, 0, y0);
    sky.addColorStop(0, sk.sky[0]); sky.addColorStop(0.7, sk.sky[1]); sky.addColorStop(1, sk.sky[2]);
    x.fillStyle = sky; x.fillRect(0, 0, lo.w, y0 + 1);
    var sp = sunPos(sk);
    if (sp) { // a pale sun with a stepped halo, and its glow on the emissive layer
      [[13, 'rgba(255,248,214,0.18)'], [9, 'rgba(255,248,214,0.3)'], [6, '#fffbe6'], [4, '#ffffff']].forEach(function (h) { x.fillStyle = h[1]; x.beginPath(); x.arc(Math.round(sp.x), Math.round(sp.y), h[0], 0, 6.3); x.fill(); });
      G(sp.x, sp.y, 34, '#ffe0a0', 0.6);
    }
    // the far layer, clouds drifting slowly, then the near tree line
    [[bd.far, 0.6, y0 - bd.far.height + 1], [bd.clouds, 1, Math.round(y0 * 0.05), 1], [bd.near, 1, y0 - bd.near.height + 1]].forEach(function (L) {
      var c = L[0], w = c.width, off = -(((rc.yaw / (Math.PI * 2)) * w + (L[3] ? time * 1.5 : 0)) % w);
      off = Math.round(off - w + rc.cx); while (off > 0) off -= w;
      for (var px = off; px < lo.w; px += w) x.drawImage(c, px, Math.round(L[2]));
    });
  }
  // a world point into the buffer: screen x, y, pixels per cell k and depth d; null behind the near plane
  function proj(x, y, z) {
    var dx = x - rc.x, dz = z - rc.z, d = dx * rc.fx + dz * rc.fz;
    if (d < CAM.near) return null;
    var k = rc.f / d;
    return { x: rc.cx + (dx * rc.rx + dz * rc.rz) * k, y: rc.y0 + (rc.camY - y) * k, k: k, d: d };
  }
  function vis(p, m) { return p && p.x > -m && p.x < lo.w + m && p.y > -m && p.y < lo.h + m * 2; }
  function viewAngle(x, z) { return Math.atan2(z - rc.z, x - rc.x); }
  function elevTo(y, d) { return Math.max(0, Math.atan2(rc.camY - y, d)); }
  // a glow or light in buffer coordinates
  function G(x, y, r, col, a) { glow(x * PX, y * PX, r * PX, col, a); }
  function Lt(x, y, r, i, col) { light(x * PX, y * PX, r * PX, i, col); }
  // a letter-grid sprite standing on the ground, hCells tall
  function bill(c, p, hCells, alpha) {
    var s = hCells * p.k / c.height, ax = c.ax !== undefined ? c.ax : c.width / 2, ay = c.ay !== undefined ? c.ay : c.height;
    if (alpha !== undefined) lo.ctx.globalAlpha = alpha;
    var bx = Math.round(p.x - ax * s), by = Math.round(p.y - ay * s), bw = Math.max(1, Math.round(c.width * s)), bh = Math.max(1, Math.round(c.height * s));
    lo.ctx.drawImage(c, bx, by, bw, bh); stamp(c, bx, by, bw, bh);
    if (alpha !== undefined) lo.ctx.globalAlpha = 1;
  }
  // a box-model sprite from the fixed-size cache, scaled only when the nearest size is far off
  function model(spr, p, alpha) {
    var s = p.k / spr.ppc, x = lo.ctx;
    if (alpha !== undefined) x.globalAlpha = alpha;
    if (s > 0.85 && s < 1.18) s = 1;
    var mx = Math.round(p.x - spr.ax * s), my = Math.round(p.y - spr.ay * s), mw = Math.max(1, Math.round(spr.width * s)), mh = Math.max(1, Math.round(spr.height * s));
    x.drawImage(spr, mx, my, mw, mh); stamp(spr, mx, my, mw, mh);
    if (alpha !== undefined) x.globalAlpha = 1;
  }
  // a soft shadow cast away from the sun: a blob under the thing and a longer, fainter one for tall things (len cells)
  function shadow7(x, z, r, a, len) {
    var sk = rc.sky || SKY.hills, sx = -Math.cos(sk.sunAz), sz = -Math.sin(sk.sunAz), L = len || 0.4;
    [[0.25, 1, 1], [0.6, 0.8, 0.6], [1, 0.55, 0.35]].forEach(function (st, n) {
      if (n && L < 0.8) return;
      var p = proj(x + sx * L * st[0], 0, z + sz * L * st[0]); if (!vis(p, 40)) return;
      var rx = r * st[1] * p.k, ry = Math.max(1, rx * Math.min(1, rc.camY / p.d) * 1.2);
      lo.ctx.fillStyle = 'rgba(28,36,48,' + ((a || 0.3) * st[2]) + ')'; lo.ctx.beginPath(); lo.ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2); lo.ctx.fill();
    });
  }
  function poly7(pts, fill) {
    for (var i = 0; i < pts.length; i++) if (!pts[i]) return;
    [lo.ctx, curD && lo.dctx].forEach(function (x, n) { if (!x) return; x.beginPath(); pts.forEach(function (p, j) { if (j) x.lineTo(p.x, p.y); else x.moveTo(p.x, p.y); }); x.closePath(); x.fillStyle = n ? curD : fill; x.fill(); });
  }
  // a particle: capped on screen and faded near the camera, so nothing turns into a big pale square up close
  function drawPart7(pt) {
    var p = proj(pt.x, pt.y, pt.z); if (!vis(p, 4)) return;
    var near = Math.min(1, Math.max(0, (p.d - 1.5) / 3.5)); if (near <= 0) return;
    var s = Math.min(Math.max(2, lo.h * 0.022), Math.max(1, pt.size * p.k * (0.5 + pt.life / pt.max * 0.5))), x = lo.ctx;
    x.globalAlpha = Math.min(1, pt.life / pt.max * 1.6) * near; x.fillStyle = pt.col;
    if (pt.shape === 'bubbles' && s > 3) { x.strokeStyle = pt.col; x.lineWidth = 1; x.beginPath(); x.arc(p.x, p.y, s / 2, 0, 6.3); x.stroke(); }
    else x.fillRect(Math.round(p.x - s / 2), Math.round(p.y - s / 2), Math.round(s), Math.round(s));
    x.globalAlpha = 1;
    if (pt.glow) G(p.x, p.y, s * 2.2, pt.col, 0.5 * near);
  }
  function drawCar7(r, c) {
    var ry = c.y + (c.hopY || 0); if (c.fallT > 0) ry = Math.min(0, c.y);
    var p = proj(c.x, ry, c.z); if (!vis(p, 60)) return null;
    var hv = c.h + (c.slip ? c.slipDir * 0.5 * c.slip : 0) + (c.trickT > 0 ? (1 - c.trickT / 0.45) * Math.PI * 2 : 0);
    var va = viewAngle(c.x, c.z), el = elevTo(ry, p.d);
    if (c.fallT <= 0) shadow7(c.x, c.z, 0.7, c.air ? 0.18 : 0.3);
    var spr = S.carView(c.carId, c.look, hv - va, el, p.k, c.wheel || 0), alpha = c.fallT > 0 ? Math.max(0, c.fallT / 1.1) : undefined;
    // a rival between the camera and the player turns see-through so it never hides the player's car
    if (c.i !== 0 && p.d < rc.playerD - 0.4) alpha = Math.min(alpha === undefined ? 1 : alpha, 0.3);
    // the body on its springs: roll shows as a lean seen from behind or ahead, pitch as one seen from the side, both
    // turning the sprite about the ground under the car; a dip squashes it down onto the wheels
    var rel = hv - va, tilt = (c.roll || 0) * Math.cos(rel) - (c.pitch || 0) * Math.sin(rel), dip = Math.max(0, c.dip || 0);
    var pose = Math.abs(tilt) > 0.004 || dip > 0.004;
    if (pose) posed(p, tilt, 1 + 0.6 * dip, 1 - 1.6 * dip);
    model(spr, p, alpha);
    if (c.slowT > 0 && Math.floor(time * 12) % 2) { lo.ctx.globalCompositeOperation = 'lighter'; model(spr, p, 0.35); lo.ctx.globalCompositeOperation = 'source-over'; }
    if (pose) unposed();
    if (c.air && c.stats && c.stats.glide > 0 && c.vy < 2) model(S.gliderView(D.lookOpt('trim', c.look.trim).c, hv - va, el, p.k), p);
    Lt(p.x, p.y - p.k * 0.3, p.k * 1.6, c.boostT > 0 ? 0.35 : 0.08, c.boostT > 0 ? '#ff9f1c' : '#fff3b0');
    if (c.boostT > 0) { var bp = proj(c.x - Math.cos(c.h) * 0.9, ry + 0.3, c.z - Math.sin(c.h) * 0.9); if (bp) G(bp.x, bp.y, p.k * 1.4, '#ff8a1c', 0.8); }
    var x2 = lo.ctx;
    if (c.shieldT > 0) {
      var sp = proj(c.x, ry + 0.5, c.z);
      if (sp) { x2.strokeStyle = 'rgba(191,247,255,' + (0.55 + 0.25 * Math.sin(time * 8)) + ')'; x2.lineWidth = Math.max(1, p.k * 0.06);
        x2.beginPath(); x2.ellipse(sp.x, sp.y, p.k * 1.0, p.k * 0.8, 0, 0, Math.PI * 2); x2.stroke(); x2.fillStyle = 'rgba(191,247,255,0.12)'; x2.fill(); G(sp.x, sp.y, p.k * 1.3, '#8fd8ff', 0.35); }
    }
    if (c.slowT > 0) for (var i = 0; i < 3; i++) { var a = time * 5 + i * 2.1, q = proj(c.x + Math.cos(a) * 0.5, ry + 1.2, c.z + Math.sin(a) * 0.5); if (q) { var st = Math.max(1, Math.round(q.k * 0.12)); x2.fillStyle = '#ffd23f'; x2.fillRect(q.x - st, q.y - st, st * 2, st * 2); } }
    if (c.driftDir && c.drift > 0.2) {
      var T = D.DRIFT_TIERS, col = c.drift >= T[2] ? '#ff6ad5' : c.drift >= T[1] ? '#ff8a1c' : c.drift >= T[0] ? '#3fa8ff' : '#f4f1ea';
      for (var j = 0; j < 2; j++) { var sd = j ? 1 : -1, wq = proj(c.x - Math.cos(c.h) * 0.6 - Math.sin(c.h) * 0.45 * sd, 0.1, c.z - Math.sin(c.h) * 0.6 + Math.cos(c.h) * 0.45 * sd);
        if (!wq) continue; var z2 = Math.max(1, Math.round(wq.k * 0.09)); x2.fillStyle = col; x2.fillRect(wq.x - z2 + Math.random() * z2 * 2, wq.y - z2 * 2 - Math.random() * z2 * 3, z2 * 2, z2 * 2); G(wq.x, wq.y, wq.k * 0.6, col, 0.7); }
    }
    return proj(c.x, ry + 1.5, c.z);
  }
  // a turn by a (rad) and a scale about the screen point p, for the colour and the depth buffers
  function posed(p, a, sx, sy) {
    [lo.ctx, post ? lo.dctx : null].forEach(function (x) { if (!x) return; x.save(); x.translate(p.x, p.y); x.rotate(a); x.scale(sx, sy); x.translate(-p.x, -p.y); });
  }
  function unposed() { lo.ctx.restore(); if (post) lo.dctx.restore(); }
  function drawRamp7(g, m) {
    var lim = g.hw + 0.2, s0 = m.s, s1 = m.s + m.len, n = 6;
    function at(s, d, y) { var q = D.pointAt(g, s, d); return proj(q.x, y, q.z); }
    poly7([at(s1, -lim, 0), at(s1, lim, 0), at(s1, lim, m.h), at(s1, -lim, m.h)], '#7a4f2a');
    for (var i = 0; i < n; i++) {
      var f0 = i / n, f1 = (i + 1) / n, a0 = s0 + f0 * m.len, a1 = s0 + f1 * m.len;
      [-1, 1].forEach(function (sd) { poly7([at(a0, sd * lim, 0), at(a1, sd * lim, 0), at(a1, sd * lim, f1 * m.h), at(a0, sd * lim, f0 * m.h)], '#8a5a30'); });
      poly7([at(a0, -lim, f0 * m.h), at(a0, lim, f0 * m.h), at(a1, lim, f1 * m.h), at(a1, -lim, f1 * m.h)], i % 2 ? '#2a2630' : '#ffd23f');
    }
  }
  function drawFinish7(g, items) {
    var lim = g.hw + 0.9, L = D.pointAt(g, 0.3, -lim), R = D.pointAt(g, 0.3, lim), H = 2.6, mid = proj((L.x + R.x) / 2, 0, (L.z + R.z) / 2);
    if (!mid) return;
    items.push({ d: mid.d, f: function () {
      lo.ctx.globalAlpha = mid.d < rc.playerD ? 0.35 : 1; // see-through while the camera passes under it
      [L, R].forEach(function (p) { var a = proj(p.x, 0, p.z), b = proj(p.x, H, p.z); if (!a || !b) return; lo.ctx.fillStyle = '#e5e1d8'; var w = Math.max(1, a.k * 0.24); lo.ctx.fillRect(Math.round(a.x - w / 2), Math.round(b.y), Math.round(w), Math.round(a.y - b.y));
        if (curD) { lo.dctx.fillStyle = curD; lo.dctx.fillRect(Math.round(a.x - w / 2), Math.round(b.y), Math.round(w), Math.round(a.y - b.y)); } });
      var n = 10;
      for (var i = 0; i < n; i++) for (var j = 0; j < 2; j++) {
        var f0 = i / n, f1 = (i + 1) / n, y0 = H - j * 0.3, y1 = H - (j + 1) * 0.3;
        var x0 = L.x + (R.x - L.x) * f0, z0 = L.z + (R.z - L.z) * f0, x1 = L.x + (R.x - L.x) * f1, z1 = L.z + (R.z - L.z) * f1;
        poly7([proj(x0, y0, z0), proj(x1, y0, z1), proj(x1, y1, z1), proj(x0, y1, z0)], (i + j) % 2 ? '#2a2630' : '#f4f1ea');
      }
      lo.ctx.globalAlpha = 1;
    } });
  }
  var BILL_H = { oak: 3.2, pine: 3.6, bush: 1.1, rock: 0.9, hay: 1.1, post: 0.75, tyres: 0.9, oakD: 3.2, elm: 4.2, bushD: 1.1, bushF: 1.1,
    cactus: 2.6, shrub: 0.8, redrock: 1.3, pillar: 3.6, palm: 4 };
  var TALL = { oak: 1, pine: 1, oakD: 1, elm: 1, cactus: 1, pillar: 1, palm: 1 };
  function decorItem(it, items) {
    var p = proj(it.x, 0, it.z); if (!p || p.d > CAM.far * 0.8) return;
    var big = it.kind === 'bld' || it.kind === 'mill' || it.kind === 'stand';
    // scenery right beside the camera fades out: its texels would be bigger than the strongest blur
    var fade = Math.min(1, Math.max(0, (p.d - 2) / 2.5));
    // fence posts and tyres between the camera and the car fade sooner: up close they are a few huge pale texels
    if (it.kind === 'post' || it.kind === 'tyres') fade = Math.min(fade, Math.max(0, (p.d - 3) / Math.max(1, rc.playerD - 4)));
    if (fade <= 0.02 || !vis(p, big ? p.k * 6 : p.k * 3)) return;
    // between the camera and the player's car: it fades out as it slides over the car on screen (things off to the
    // side stay, framing the view), and only an opaque one is stamped into the depth buffer, so a near blur never
    // smears the car
    var half = it.kind === 'spr' ? (BILL_H[it.name] || 1) * p.k * S.scenery(it.name).width / S.scenery(it.name).height * 0.42 : big ? p.k * 3 : p.k * 0.15;
    var ov = half + rc.f / rc.playerD * 0.75, side = 1;
    if (p.d < rc.playerD - 0.5) side = Math.min(1, Math.max(0, (Math.abs(p.x - rc.cx) - ov * 0.75) / (ov * 0.25)));
    if (fade * side <= 0.02) return;
    items.push({ d: p.d, stamp: side > 0.95, f: function () {
      lo.ctx.globalAlpha = fade * side;
      drawDecor7(it, p);
      lo.ctx.globalAlpha = 1;
    } });
  }
  function drawDecor7(it, p) {
    {
      if (it.kind === 'spr') { shadow7(it.x, it.z, it.name === 'oak' || it.name === 'elm' || it.name === 'oakD' ? 0.9 : TALL[it.name] ? 0.6 : 0.5, 0.24, TALL[it.name] ? 2.2 : 0.5); bill(S.scenery(it.name, (BILL_H[it.name] || 1) * p.k), p, BILL_H[it.name] || 1); return; }
      if (it.kind === 'post' || it.kind === 'tyres') {
        if (it.kind === 'post') {
          var x = lo.ctx; x.strokeStyle = '#a49274'; x.lineWidth = Math.max(1, p.k * 0.07);
          [0.32, 0.6].forEach(function (y) { var a = proj(it.x, y, it.z), b = proj(it.nx, y, it.nz); if (a && b) { x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); } });
        }
        bill(S.scenery(it.kind), p, BILL_H[it.kind]); return;
      }
      var name = it.kind === 'bld' ? it.name : it.kind === 'mill' ? 'mill' : 'stand';
      model(S.modelView(name, -viewAngle(it.x, it.z) + (it.kind === 'stand' ? (it.h || 0) : 0.4), elevTo(0, p.d), p.k), p);
      if (it.kind === 'mill') { // sails turning on the tower's top
        var hub = proj(it.x, 3.85, it.z); if (!hub) return;
        var x2 = lo.ctx; x2.strokeStyle = '#7a4f2a'; x2.lineWidth = Math.max(1, p.k * 0.08);
        for (var i = 0; i < 4; i++) {
          var ang = sailT + i * Math.PI / 2, ex = Math.cos(ang) * 2.4 * p.k, ey = Math.sin(ang) * 2.4 * p.k;
          x2.beginPath(); x2.moveTo(hub.x, hub.y); x2.lineTo(hub.x + ex, hub.y - ey); x2.stroke();
          var nxp = -Math.sin(ang) * 0.4 * p.k, nyp = Math.cos(ang) * 0.4 * p.k;
          x2.fillStyle = '#f4ecd6'; x2.beginPath(); x2.moveTo(hub.x + ex * 0.35, hub.y - ey * 0.35); x2.lineTo(hub.x + ex * 0.35 + nxp, hub.y - ey * 0.35 - nyp);
          x2.lineTo(hub.x + ex + nxp, hub.y - ey - nyp); x2.lineTo(hub.x + ex, hub.y - ey); x2.closePath(); x2.fill();
        }
      }
    }
  }
  function drawRace(r, dt) {
    S.newFrame();
    time += dt; sailT += dt * 0.8;
    var g = r.g, p = r.cars[0], gd = groundData(r.id), Ld = landOf(r.id);
    layout();
    stepParts(dt);
    r.cars.forEach(function (c) {
      if (c.boostT > 0) emitTrail(c, c.i === 0 ? 3 : 1);
      if (!c.air && Math.abs(c.d || 0) > g.hw && c.v > 3 && Math.random() < 0.5) addPart({ x: c.x, y: 0.1, z: c.z, vx: (Math.random() - 0.5), vy: 0.8, vz: (Math.random() - 0.5), life: 0.4, max: 0.4, col: Ld.dust, size: 0.14 });
    });
    // the camera swings round behind the car, rises a little on jumps and pulls back when boosting
    var snap = !rc.init || rc.race !== r || (r.t === 0 && r.phase === 'count');
    rc.race = r; rc.sky = skyFor(r);
    if (snap) { rc.yaw = p.h; rc.init = true; rc.lift = 0; rc.boost = 0; }
    else if (p.fallT <= 0) rc.yaw += D.angDiff(p.h, rc.yaw) * Math.min(1, dt * CAM.follow);
    rc.lift += (Math.max(0, p.y) * 0.55 - rc.lift) * Math.min(1, dt * 5);
    rc.boost += ((p.boostT > 0 ? 1 : 0) - rc.boost) * Math.min(1, dt * 3);
    var dist = CAM.dist * (1 + 0.1 * rc.boost);
    rc.fx = Math.cos(rc.yaw); rc.fz = Math.sin(rc.yaw); rc.rx = -rc.fz; rc.rz = rc.fx;
    rc.x = p.x - rc.fx * dist; rc.z = p.z - rc.fz * dist;
    rc.camY = (rc.carRow - rc.y0) * CAM.dist / rc.f + rc.lift;
    rc.playerD = dist;
    rc.cx = lo.w / 2 + (shake > 0 ? (Math.random() - 0.5) * shake * 8 : 0);
    begin(post ? Ld.bg : Ld.bg2d);
    var x = lo.ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.imageSmoothingEnabled = false; x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    var sk = skyFor(r);
    drawSky(backdrop(r.id, sk), sk);
    drawGround7(gd, g);
    x.drawImage(lo.gcv, 0, 0);
    // haze where the ground meets the sky
    var hzc = sk.fog.slice(1), hzr = parseInt(hzc.slice(0, 2), 16) + ',' + parseInt(hzc.slice(2, 4), 16) + ',' + parseInt(hzc.slice(4, 6), 16);
    var hz = x.createLinearGradient(0, rc.y0, 0, rc.y0 + lo.h * (post ? 0.025 : 0.05)); hz.addColorStop(0, 'rgba(' + hzr + ',0.85)'); hz.addColorStop(1, 'rgba(' + hzr + ',0)');
    x.fillStyle = hz; x.fillRect(0, rc.y0, lo.w, Math.ceil(lo.h * 0.05));
    // flat things on the ground
    r.goos.forEach(function (gp) {
      var q = proj(gp.x, 0, gp.z); if (!vis(q, 20)) return;
      var ry = Math.min(1, rc.camY / q.d) * 1.2;
      x.fillStyle = '#3fbf5a'; x.beginPath(); x.ellipse(q.x, q.y, q.k * 0.8, Math.max(1, q.k * 0.8 * ry), 0, 0, 6.3); x.fill();
      x.fillStyle = '#9dff8a'; x.beginPath(); x.ellipse(q.x - q.k * 0.2, q.y - q.k * 0.1 * ry, q.k * 0.25, Math.max(1, q.k * 0.25 * ry), 0, 0, 6.3); x.fill();
      G(q.x, q.y, q.k, '#58e07a', 0.4);
    });
    g.pads.forEach(function (pd) { var q = proj(pd.x, 0, pd.z); if (vis(q, 20)) { G(q.x, q.y, q.k * (1.5 + 0.25 * Math.sin(time * 6)), '#ff9f1c', 0.8); Lt(q.x, q.y, q.k * 2.4, 0.2, '#ffb547'); } });
    g.ramps.forEach(function (m) {
      if (!m.gap) return;
      for (var i = 0; i < 6; i++) { var s = m.s + m.len + ((time * 0.6 + i * 0.37) % 1) * m.gap, d = Math.sin(i * 7.1 + time) * (g.hw + 3), q = D.pointAt(g, s, d), sp = proj(q.x, 0, q.z); if (vis(sp, 4)) { x.fillStyle = 'rgba(255,255,255,0.7)'; x.fillRect(Math.round(sp.x), Math.round(sp.y), Math.max(1, Math.round(sp.k * 0.12)), Math.max(1, Math.round(sp.k * 0.05))); } }
    });
    // everything standing up, far to near
    var items = [];
    decor[r.id].forEach(function (it) { decorItem(it, items); });
    drawFinish7(g, items);
    g.ramps.forEach(function (m) { var a = D.pointAt(g, m.s + m.len * 0.5, 0), q = proj(a.x, 0, a.z); if (q) items.push({ d: q.d + 1, f: function () { lo.ctx.globalAlpha = q.d + 1.5 < rc.playerD ? 0.4 : 1; drawRamp7(g, m); lo.ctx.globalAlpha = 1; } }); });
    g.boxes.forEach(function (b, i) {
      if (r.boxes[i].t > 0) return;
      var y = 0.35 + Math.sin(time * 3 + i) * 0.12, q = proj(b.x, y, b.z); if (!vis(q, 20)) return;
      items.push({ d: q.d, f: function () { shadow7(b.x, b.z, 0.4, 0.25); model(S.modelView('crate', time * 1.5 + i, elevTo(y, q.d), q.k * 1.2), q); G(q.x, q.y - q.k * 0.4, q.k * 1.3, '#ffd23f', 0.65); } });
    });
    g.coins.forEach(function (cn, i) {
      if (r.coins[i].t > 0) return;
      var q = proj(cn.x, 0.45 + Math.sin(time * 4 + i) * 0.06, cn.z); if (!vis(q, 6) || q.d > 60) return;
      items.push({ d: q.d, f: function () {
        var w = Math.max(1, Math.abs(Math.cos(time * 4 + i * 0.7)) * q.k * 0.32), h2 = Math.max(2, q.k * 0.34);
        x.fillStyle = '#c99a1a'; x.fillRect(Math.round(q.x - w / 2) - 1, Math.round(q.y - h2 / 2) - 1, Math.round(w) + 2, Math.round(h2) + 2);
        x.fillStyle = '#ffd23f'; x.fillRect(Math.round(q.x - w / 2), Math.round(q.y - h2 / 2), Math.round(w), Math.round(h2));
        if (w > 3) { x.fillStyle = '#fff3b0'; x.fillRect(Math.round(q.x - w / 4), Math.round(q.y - h2 / 3), Math.max(1, Math.round(w / 5)), Math.round(h2 / 2)); }
        G(q.x, q.y, q.k * 0.75, '#ffd23f', 0.8);
      } });
    });
    var tags = [];
    r.cars.forEach(function (c) { var q = proj(c.x, 0, c.z); if (q) items.push({ d: q.d - 0.05, f: function () { var t = drawCar7(r, c); if (t) tags.push({ c: c, p: t }); } }); });
    r.bees.forEach(function (b) { var q = proj(b.x, 1 + Math.sin(time * 20) * 0.08, b.z); if (vis(q, 10)) items.push({ d: q.d, f: function () { bill(S.bee(), q, 0.6); G(q.x, q.y, q.k * 0.5, '#ffd23f', 0.4); } }); });
    parts.forEach(function (pt) { var q = proj(pt.x, pt.y, pt.z); if (q) items.push({ d: q.d - 0.1, f: function () { drawPart7(pt); } }); });
    // pollen and dust motes drifting in the sunlight around the camera
    while (motes.length < (post ? 70 : 40)) motes.push({ x: 0, y: 0, z: 0, ph: Math.random() * 6.3, dead: true });
    motes.forEach(function (m) {
      var q = proj(m.x, m.y, m.z);
      if (m.dead || !q || q.d > 30 || q.x < -4 || q.x > lo.w + 4) { // respawn somewhere in view
        var dd = 2 + Math.random() * 26, lat = (Math.random() - 0.5) * dd * lo.w / rc.f;
        m.x = rc.x + rc.fx * dd + rc.rx * lat; m.z = rc.z + rc.fz * dd + rc.rz * lat; m.y = 0.3 + Math.random() * 2.4; m.dead = false; return;
      }
      m.x += Math.sin(time * 0.7 + m.ph) * 0.4 * dt; m.z += Math.cos(time * 0.5 + m.ph * 2) * 0.4 * dt; m.y += Math.sin(time * 1.1 + m.ph) * 0.15 * dt;
      var tw = 0.5 + 0.5 * Math.sin(time * 3 + m.ph * 5);
      items.push({ d: q.d, stamp: false, f: function () {
        var sz = q.d < 8 ? 2 : 1; x.globalAlpha = 0.45 + 0.55 * tw; x.fillStyle = '#fffbe6'; x.fillRect(Math.round(q.x), Math.round(q.y), sz, sz); x.globalAlpha = 1;
        G(q.x, q.y, Math.max(3, q.k * 0.3), sk.mote, 0.45 * tw);
      } });
    });
    items.sort(function (a, b) { return b.d - a.d; });
    items.forEach(function (it) { setDepth(it.stamp === false ? null : it.d); it.f(); });
    setDepth(null);
    // up to full size with hard pixels, then the post-process
    // the post-process scales the small buffer up itself; plain 2D scales it up with hard pixels
    if (post) {
      var spn = sunPos(sk);
      RBPost.render(lo.cv, ecv, {
        lights: lights, amb: [1.0, 0.99, 0.97], focus: [0, vh, vh, 0], bloom: 0.75, thr: 0.8, sat: sk.sat, vig: 0.7, caustic: 0,
        shadowTint: sk.sh, hiTint: sk.hi, lift: sk.lift, tone: sk.tone, time: time, scale: 1, dapple: [sk.dap, 0.3], dapCol: sk.dapCol,
        // tilt-shift by depth: sharp from just in front of the car to the next bends, soft beyond and up close
        depth: lo.dcv, dof: [rc.playerD * DOF.nearFull, rc.playerD - DOF.nearSharp, DOF.far[0], DOF.far[1]], dofK: DOF.k, skyK: DOF.sky, carD: [rc.playerD, 1.6],
        fogCol: rgb3(sk.fog), fog: [50, 160, 0.42], cam: [rc.x, rc.z, rc.fx, rc.fz, rc.f, rc.camY, rc.y0, rc.cx],
        cloud: sk.cloudK, wind: [0.035, 0.018], sun: spn ? [spn.x * PX, spn.y * PX] : null, shaft: spn ? 1.0 * spn.k : 0, shaftCol: sk.shaft,
        speed: rc.boost * 0.75, grain: 0.022
      });
    } else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(lo.cv, 0, 0, vw, vh); }
    // overlay: rivals' name tags and floating text
    octx.textAlign = 'center'; octx.textBaseline = 'bottom';
    tags.forEach(function (t) {
      if (t.c.i === 0 || t.p.d > 45) return;
      var fs = Math.round(Math.max(10, Math.min(22, t.p.k * PX * 0.3)));
      octx.font = '600 ' + fs + 'px Fredoka, sans-serif'; octx.lineWidth = 3; octx.strokeStyle = '#000a';
      var label = t.c.place + ' ' + t.c.name; octx.strokeText(label, t.p.x * PX, t.p.y * PX); octx.fillStyle = '#fff7e8'; octx.fillText(label, t.p.x * PX, t.p.y * PX);
    });
    floaters.forEach(function (f) {
      var q = proj(f.x, f.y + f.t * 1.4, f.z); if (!q) return;
      octx.globalAlpha = Math.max(0, 1 - f.t / 1.3);
      octx.font = '700 ' + Math.round(Math.max(16, vh * 0.04)) + 'px Fredoka, sans-serif'; octx.lineWidth = 4; octx.strokeStyle = '#000b'; octx.strokeText(f.text, q.x * PX, q.y * PX); octx.fillStyle = f.col; octx.fillText(f.text, q.x * PX, q.y * PX);
      octx.globalAlpha = 1;
    });
  }
  // the minimap: the track from above, with a dot per car, drawn into the given 2D canvas
  var mapCache = {};
  function drawMinimap(mc, r) {
    var g = r.g, w = mc.width, h = mc.height, x = mc.getContext('2d');
    var key = r.id + w + 'x' + h, pad = 8;
    var k = Math.min((w - pad * 2) / g.w, (h - pad * 2) / g.h), ox2 = (w - g.w * k) / 2, oz2 = (h - g.h * k) / 2;
    function M(px, pz) { return [ox2 + (px - g.x0) * k, oz2 + (pz - g.z0) * k]; }
    if (!mapCache[key]) {
      var c = document.createElement('canvas'); c.width = w; c.height = h; var y = c.getContext('2d');
      y.lineJoin = 'round'; y.beginPath();
      for (var i = 0; i <= g.n; i += 2) { var q = M(g.samples[i].x, g.samples[i].z); if (i) y.lineTo(q[0], q[1]); else y.moveTo(q[0], q[1]); }
      y.closePath(); y.strokeStyle = '#000a'; y.lineWidth = Math.max(5, w / 28); y.stroke(); y.strokeStyle = '#e8e4f0'; y.lineWidth = Math.max(3, w / 50); y.stroke();
      var f = M(g.samples[0].x, g.samples[0].z); y.fillStyle = '#fff'; y.fillRect(f[0] - 3, f[1] - 3, 6, 6);
      mapCache[key] = c;
    }
    x.clearRect(0, 0, w, h); x.drawImage(mapCache[key], 0, 0);
    for (var j = r.cars.length - 1; j >= 0; j--) {
      var c2 = r.cars[j], q2 = M(c2.x, c2.z), rad = j === 0 ? Math.max(4, w / 22) : Math.max(3, w / 32);
      x.beginPath(); x.arc(q2[0], q2[1], rad, 0, 6.3); x.fillStyle = j === 0 ? '#ffd23f' : D.lookOpt('paint', c2.look.paint).c; x.fill(); x.lineWidth = 2; x.strokeStyle = '#000'; x.stroke();
    }
  }

  // ---------- garage plaza ----------
  var HUB = D.HUB, hubGround = null, HUBM = 6;
  function buildHub() {
    var rows = HUB.rows, W = rows[0].length + HUBM * 2, H = rows.length + HUBM * 2, T = TEX, c = document.createElement('canvas');
    c.width = W * T; c.height = H * T;
    var x = c.getContext('2d'), tl = tiles();
    x.fillStyle = x.createPattern(tl.grass, 'repeat'); x.fillRect(0, 0, c.width, c.height);
    for (var z = 0; z < rows.length; z++) for (var i = 0; i < rows[z].length; i++) {
      var ch = rows[z].charAt(i), px = (i + HUBM) * T, pz = (z + HUBM) * T;
      if (ch === '#') continue;
      x.fillStyle = x.createPattern(ch === 'C' || ch === 'c' ? tl.road : ch === '~' ? tl.dirt : tl.pave, 'repeat'); x.fillRect(px, pz, T, T);
      if (ch === '~') { var r = prng(i * 31 + z); for (var k = 0; k < 6; k++) { x.fillStyle = ['#ff7ac8', '#ffd23f', '#f4f1ea', '#3f8f3a'][k % 4]; x.fillRect(px + r() * (T - 2), pz + r() * (T - 2), 2, 2); } }
    }
    // parking lines in the car lot
    x.fillStyle = '#f4f1ea';
    for (i = 1; i <= 8; i += 2) x.fillRect((i + HUBM) * T, (10 + HUBM) * T, 1, 3 * T);
    // a road leading out of the plaza to the track
    x.fillStyle = x.createPattern(tl.road, 'repeat'); x.fillRect((19 + HUBM) * T, (8 + HUBM) * T, HUBM * T, 3 * T);
    hubGround = c;
    // woods round the plaza, beyond the hedge, to frame it (left clear where the road leads out)
    var cols = rows[0].length, tr = prng(77), kinds = ['elm', 'oakD', 'pine', 'elm', 'bushD', 'oak'];
    hubTrees = [];
    for (k = 0; k < 400 && hubTrees.length < 70; k++) {
      var tx = -HUBM + 0.5 + tr() * (cols + HUBM * 2 - 1), tz = -HUBM + 0.5 + tr() * (rows.length + HUBM * 2 - 1);
      if (tx > -1.2 && tx < cols + 0.2 && tz > -1.2 && tz < rows.length + 0.2) continue;
      if (tx > cols - 1 && tz > 7 && tz < 12) continue;
      if (hubTrees.some(function (t) { return Math.hypot(t.x - tx, t.z - tz) < 1.3; })) continue;
      // on the near sides (toward the bottom of the screen) only low bushes, so nothing tall hides the plaza
      var nearSide = tz > rows.length - 0.5 || tx > cols - 0.5, gap = Math.max(-tx, -tz, tx - cols, tz - rows.length);
      if (!nearSide && gap < 1.8 && tr() < 0.7) continue;
      hubTrees.push({ x: tx, z: tz, name: nearSide ? (tr() < 0.5 ? 'bushD' : 'bush') : kinds[Math.floor(tr() * kinds.length)] });
    }
  }
  var hubTrees = [], hubMotes = [];
  var HEDGE = ['bush', 'bushD', 'bush', 'bushF', 'bushD'];
  var STATION_ICON = { garage: '🔧', paint: '🎨', lot: '🚗', track: '🏁' };
  function drawHub(S0, h, dt) {
    time += dt; sailT += dt * 0.8;
    if (!hubGround) buildHub();
    stepParts(dt);
    cam.zoom += (0.8 - cam.zoom) * Math.min(1, dt * 3);
    setCamera(h.x, h.z, dt, false);
    begin(post ? LAND.hills.bg : LAND.hills.bg2d);
    drawGround(hubGround, -HUBM, -HUBM);
    var items = [], rows = HUB.rows;
    // hedges round the edge, a mix of bushes, then the woods beyond
    for (var z = 0; z < rows.length; z++) for (var i = 0; i < rows[z].length; i++) if (rows[z].charAt(i) === '#') (function (x0, z0) { if ((x0 + z0) % 2 === 0) items.push({ d: x0 + z0 + 1, f: function () { var hc = S.scenery(HEDGE[(x0 * 7 + z0 * 3) % HEDGE.length], 15); sprite(hc, x0 + 0.5, 0, z0 + 0.5, 16 / hc.height); } }); })(i, z);
    hubTrees.forEach(function (t) { items.push({ d: t.x + t.z + 0.5, f: function () { var c = S.scenery(t.name, (BILL_H[t.name] || 1) * S.HW * 1.15); shadow(t.x, t.z, 0.6, 0.25); sprite(c, t.x, 0, t.z, (BILL_H[t.name] || 1) * S.HW / c.height * 1.15); } }); });
    items.push({ d: 3 + 2 + 2, f: function () { sprite(S.building('garage'), 3, 0, 2, 1); } });
    items.push({ d: 14.5 + 2 + 2, f: function () { sprite(S.building('paint'), 14.5, 0, 2, 1); } });
    // fountain
    items.push({ d: 10 + 7, f: function () {
      var c0 = P(10, 0, 7);
      ctx.fillStyle = '#9aa3b2'; ctx.beginPath(); ctx.ellipse(c0[0], c0[1], hw * 1.5, hh * 1.5, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#3fa8e0'; ctx.beginPath(); ctx.ellipse(c0[0], c0[1], hw * 1.2, hh * 1.2, 0, 0, 6.3); ctx.fill();
      var t = P(10, 1.1 + Math.sin(time * 5) * 0.06, 7); ctx.fillStyle = '#bff7ff'; ctx.fillRect(t[0] - hw * 0.08, t[1], hw * 0.16, c0[1] - t[1]);
      glow(c0[0], c0[1], hw * 1.6, '#8fd8ff', 0.35); glow(t[0], t[1], hw * 0.6, '#e8fbff', 0.5); light(c0[0], c0[1], hw * 2.4, 0.12, '#bff7ff');
      if (Math.random() < 0.5) addPart({ x: 10, y: 1.1, z: 7, vx: (Math.random() - 0.5) * 2, vy: 2, vz: (Math.random() - 0.5) * 2, life: 0.6, max: 0.6, col: '#bff7ff', size: 0.1, grav: true });
    } });
    // the track signpost
    items.push({ d: 15.5 + 10.5, f: function () { sprite(S.scenery('sign'), 15.5, 0, 10.5, 2.4); } });
    // owned cars parked in the lot, the selected one with a glow
    S0.owned.forEach(function (id, k) {
      var px = 1.5 + k * 1.4 + 0.3, pz = 11.5;
      items.push({ d: px + pz, f: function () { shadow(px, pz, 0.7, 0.3); var q = sprite(S.car(id, S0.cars[id].look, Math.PI / 2 + 0.0001), px, 0, pz, 1); if (id === S0.car) glow(q[0], q[1], hw * 1.3, '#ffd23f', 0.5); } });
    });
    // pads
    ['g', 'p', 'c', 't'].forEach(function (ch) {
      for (var z2 = 0; z2 < rows.length; z2++) { var x2 = rows[z2].indexOf(ch); if (x2 < 0) continue;
        var q = P(x2 + 0.5, 0, z2 + 0.5), pulse = 0.8 + 0.2 * Math.sin(time * 4);
        ctx.strokeStyle = 'rgba(255,210,63,' + pulse + ')'; ctx.lineWidth = Math.max(2, hw * 0.08); ctx.beginPath(); ctx.ellipse(q[0], q[1], hw * 0.75, hh * 0.75, 0, 0, 6.3); ctx.stroke();
        glow(q[0], q[1], hw * 1.3, '#ffd23f', 0.65); light(q[0], q[1], hw * 1.6, 0.14, '#ffcf6a');
        items.push({ d: x2 + z2 + 1, tag: { p: P(x2 + 0.5, 1.6 + Math.sin(time * 3) * 0.1, z2 + 0.5), icon: STATION_ICON[HUB.pads[ch]] } , f: function () {} });
      }
    });
    // the kid, in a warm pool of light
    if (post) { var kp = P(h.x, 0, h.z); light(kp[0], kp[1], hw * 9, 0.4, '#ffcf8a'); }
    items.push({ d: h.x + h.z + 0.1, f: function () { shadow(h.x, h.z, 0.35, 0.3); sprite(S.kid(h.face, h.walk, h.moving, S0.kid), h.x, 0, h.z, 0.95); } });
    parts.forEach(function (pt) { items.push({ d: pt.x + pt.z + 0.3, f: function () { drawPart(pt); } }); });
    // pollen motes drifting in the light round the kid
    while (post && hubMotes.length < 36) hubMotes.push({ x: h.x + (Math.random() - 0.5) * 18, z: h.z + (Math.random() - 0.5) * 18, y: 0.3 + Math.random() * 2.5, ph: Math.random() * 6.3 });
    hubMotes.forEach(function (m) {
      m.x += Math.sin(time * 0.7 + m.ph) * 0.3 * dt; m.z += Math.cos(time * 0.5 + m.ph * 2) * 0.3 * dt; m.y += Math.sin(time * 1.1 + m.ph) * 0.12 * dt;
      if (Math.abs(m.x - h.x) > 10 || Math.abs(m.z - h.z) > 10) { m.x = h.x + (Math.random() - 0.5) * 18; m.z = h.z + (Math.random() - 0.5) * 18; }
      items.push({ d: m.x + m.z + 0.5, f: function () {
        var q = P(m.x, m.y, m.z), tw = 0.5 + 0.5 * Math.sin(time * 3 + m.ph * 5), sz = Math.max(2, Math.round(hw / 16));
        ctx.globalAlpha = 0.45 + 0.55 * tw; ctx.fillStyle = '#fffbe6'; ctx.fillRect(Math.round(q[0]), Math.round(q[1]), sz, sz); ctx.globalAlpha = 1;
        glow(q[0], q[1], hw * 0.35, SKY.hills.mote, 0.45 * tw);
      } });
    });
    items.sort(function (a, b) { return a.d - b.d; });
    items.forEach(function (it) { it.f(); });
    end(P(h.x, 0, h.z)[1]);
    octx.textAlign = 'center'; octx.textBaseline = 'middle'; octx.font = Math.round(hw * 0.7) + 'px sans-serif';
    items.forEach(function (it) { if (it.tag) octx.fillText(it.tag.icon, it.tag.p[0], it.tag.p[1]); });
  }

  // screen (CSS pixels) to plaza cell; and a screen direction to a world heading
  function screenToWorld(cx, cy) {
    var px = cx * dpr - ox, py = cy * dpr - oy, a = px / hw, b = py / hh; // a = x - z, b = x + z
    return { x: (a + b) / 2, z: (b - a) / 2 };
  }
  function screenDirToHeading(dx, dy) { return Math.atan2(2 * dy - dx, dx + 2 * dy); }

  function setView(right, bottom) { view.right = right || 0; view.bottom = bottom || 0; }

  return { setView: setView, init: init, resize: resize, drawRace: drawRace, drawHub: drawHub, drawMinimap: drawMinimap, events: events,
    screenToWorld: screenToWorld, screenDirToHeading: screenDirToHeading, warm: groundData, isHD: function () { return post; },
    SKY: SKY, DOF: DOF }; // the tuning blocks, for trying values in the console
})();
