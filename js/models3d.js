// Racing Boy: 3D models (RB3DModels) for the three.js renderer. Plain script; uses the global THREE (r158) and RB.
// Units: 1 = one track cell. A car faces +x, up is +y, and its origin is on the ground under the car's centre.
// Car bodies are side profiles extruded with a bevel, then bent (tumblehome, rounded plan) and smoothed with creased
// normals; windows are thin glass overlays bent the same way. Paint is a clearcoat material whose map carries the
// trim stripes, door gaps and racing numbers (walls of the extrusion map across the car's width, its flat sides map
// along its length). Geometries, textures and shared materials are cached; each car owns only its light materials.
var RB3DModels = (function () {
  'use strict';
  var T = THREE, PI = Math.PI;
  var GEO = {}, MAT = {}, TEX = {};
  function G(key, make) { var g = GEO[key]; if (!g) { g = GEO[key] = make(); g.userData.shared = true; } return g; }
  function Mt(key, make) { var m = MAT[key]; if (!m) { m = MAT[key] = make(); m.userData.shared = true; } return m; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function V(x, y, z) { return new T.Vector3(x, y, z); }
  function shade(hex, k) { var c = new T.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); }
  function mix(hexA, hexB, t) { var c = new T.Color(hexA); c.lerp(new T.Color(hexB), t); return '#' + c.getHexString(); }

  // ---------- textures ----------
  function canvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function texOf(cv, color) {
    var t = new T.CanvasTexture(cv); if (color) t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4; t.needsUpdate = true; return t;
  }
  // tyre bump: tread blocks in the middle of the profile, a fine ring on the sidewalls (lathe uv: u around, v across)
  function treadTex(knobby) {
    return TEX['tread' + knobby] || (TEX['tread' + knobby] = (function () {
      var cv = canvas(512, 64), x = cv.getContext('2d'), n = knobby ? 26 : 40;
      x.fillStyle = '#808080'; x.fillRect(0, 0, 512, 64);
      x.fillStyle = '#9a9a9a'; x.fillRect(0, 12, 512, 2); x.fillRect(0, 50, 512, 2);
      for (var i = 0; i < n; i++) {
        var u = i * 512 / n;
        x.fillStyle = '#2a2a2a';
        if (knobby) { x.fillRect(u, 21, 512 / n * 0.42, 22); x.fillRect(u + 256 / n, 18, 512 / n * 0.42, 6); x.fillRect(u + 256 / n, 40, 512 / n * 0.42, 6); }
        else { x.save(); x.translate(u, 32); x.transform(1, 0, 0.5, 1, 0, 0); x.fillRect(0, -12, 3, 10); x.restore();
          x.save(); x.translate(u, 32); x.transform(1, 0, -0.5, 1, 0, 0); x.fillRect(0, 2, 3, 10); x.restore(); }
      }
      if (!knobby) { x.fillStyle = '#303030'; x.fillRect(0, 31, 512, 2); x.fillRect(0, 24, 512, 1); x.fillRect(0, 40, 512, 1); }
      var t = texOf(cv, false); t.wrapS = T.RepeatWrapping; return t;
    })());
  }
  function whitewallTex() {
    return TEX.ww || (TEX.ww = (function () {
      var cv = canvas(8, 64), x = cv.getContext('2d');
      x.fillStyle = '#1d1d20'; x.fillRect(0, 0, 8, 64);
      x.fillStyle = '#efece4'; x.fillRect(0, 52, 8, 8);
      return texOf(cv, true);
    })());
  }
  function grilleTex() {
    return TEX.grille || (TEX.grille = (function () {
      var cv = canvas(128, 64), x = cv.getContext('2d');
      x.fillStyle = '#0c0d0f'; x.fillRect(0, 0, 128, 64);
      x.fillStyle = '#3c4046';
      for (var r = 0; r < 8; r++) for (var c = 0; c < 17; c++) {
        var cx = c * 8 + (r % 2) * 4, cy = r * 8 + 4; x.beginPath();
        for (var k = 0; k < 6; k++) { var a = k * PI / 3; x.lineTo(cx + 3.4 * Math.cos(a), cy + 3.4 * Math.sin(a)); }
        x.closePath(); x.lineWidth = 1.4; x.strokeStyle = '#4a4e55'; x.stroke();
      }
      return texOf(cv, true);
    })());
  }
  function plateTex(text) {
    return TEX['plate' + text] || (TEX['plate' + text] = (function () {
      var cv = canvas(128, 40), x = cv.getContext('2d');
      x.fillStyle = '#f2efe4'; x.fillRect(0, 0, 128, 40);
      x.strokeStyle = '#2b2f3a'; x.lineWidth = 3; x.strokeRect(2, 2, 124, 36);
      x.fillStyle = '#2f5fae'; x.fillRect(4, 4, 14, 32);
      x.fillStyle = '#1c2030'; x.font = 'bold 24px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, 70, 21);
      return texOf(cv, true);
    })());
  }
  // car paint: walls of the extrusion (u 0..0.5, across the width) and its flat sides (u 0.5..1, along the length)
  // walls take u 0..0.25, the +z side 0.25..0.625 and the -z side 0.625..1 (x runs backwards there, so text reads)
  var WR = 0.6, LR = 1.05, HR = 1.3, PW = 2048, PH = 512, SU = 0.18;
  function uWall(z) { return 0.125 + 0.12 * z / WR; }
  function uSide(x, sg) { return sg > 0 ? 0.4375 + SU * x / LR : 0.8125 - SU * x / LR; }
  function uvSide(x, z) { return z > 0 ? clamp(uSide(x, 1), 0.255, 0.62) : clamp(uSide(x, -1), 0.63, 0.995); }
  function paintTex(key, paint, trim, D) {
    return TEX['paint' + key] || (TEX['paint' + key] = (function () {
      var cv = canvas(PW, PH), x = cv.getContext('2d');
      function X(u) { return u * PW; } function Y(y) { return (1 - y / HR) * PH; }
      x.fillStyle = paint; x.fillRect(0, 0, PW, PH);
      // a soft darkening low on the sides (dirt and bounce shadow)
      if (D.yb !== undefined) {
        var gr = x.createLinearGradient(0, Y(D.yb + 0.12), 0, Y(D.yb - 0.02));
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.28)');
        x.fillStyle = gr; x.fillRect(X(0.25), Y(D.yb + 0.12), X(0.75), Y(0) - Y(D.yb + 0.12) + 2);
      }
      x.fillStyle = trim;
      if (D.center) [[-0.1, -0.055], [0.055, 0.1]].forEach(function (s) { x.fillRect(X(uWall(s[0])), 0, X(uWall(s[1])) - X(uWall(s[0])), PH); });
      if (D.side) {
        var y0 = Y(D.side[1]), y1 = Y(D.side[0]);
        x.fillRect(X(0.25), y0, X(0.75), y1 - y0);
        var e = D.sideW || 0.5;
        x.fillRect(X(uWall(-e - 0.02)), y0, X(uWall(-e + 0.12)) - X(uWall(-e - 0.02)), y1 - y0);
        x.fillRect(X(uWall(e - 0.12)), y0, X(uWall(e + 0.02)) - X(uWall(e - 0.12)), y1 - y0);
      }
      if (D.doors) {
        x.strokeStyle = shade(paint, 0.35); x.lineWidth = 2.2;
        D.doors.forEach(function (d) { [1, -1].forEach(function (sg) {
          function U(v) { return X(uSide(v, sg)); }
          x.beginPath();
          x.moveTo(U(d[0]), Y(d[3])); x.lineTo(U(d[0]), Y(d[2] + 0.04));
          x.quadraticCurveTo(U(d[0]), Y(d[2]), U(d[0] - 0.04), Y(d[2]));
          x.lineTo(U(d[1] + 0.04), Y(d[2])); x.quadraticCurveTo(U(d[1]), Y(d[2]), U(d[1]), Y(d[2] + 0.04));
          x.lineTo(U(d[1]), Y(d[3])); x.stroke();
        }); });
      }
      if (D.number) [1, -1].forEach(function (sd) {
        var nb = D.number, sx = PW * SU / LR, sy = PH / HR, r = nb.r * sy;
        x.save(); x.translate(X(uSide(nb.x, sd)), Y(nb.y)); x.scale(sx / sy, 1);
        x.fillStyle = '#f6f3ea'; x.beginPath(); x.arc(0, 0, r, 0, PI * 2); x.fill();
        x.lineWidth = r * 0.14; x.strokeStyle = trim; x.stroke();
        x.fillStyle = '#1c1d24'; x.font = 'bold ' + Math.round(r * 1.3) + 'px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(String(nb.n), 0, r * 0.08); x.restore();
      });
      return texOf(cv, true);
    })());
  }

  // ---------- materials ----------
  function phys(o) { return new T.MeshPhysicalMaterial(o); }
  function std(o) { return new T.MeshStandardMaterial(o); }
  var MATS = {
    chrome: function () { return std({ color: 0xe9ebef, metalness: 1, roughness: 0.08 }); },
    alloy: function () { return std({ color: 0xc8ccd3, metalness: 1, roughness: 0.26 }); },
    gold: function () { return std({ color: 0xe9b23a, metalness: 1, roughness: 0.2 }); },
    star: function () { return std({ color: 0xffd447, metalness: 0.85, roughness: 0.22 }); },
    steel: function () { return std({ color: 0x9aa1aa, metalness: 0.85, roughness: 0.4 }); },
    darkmetal: function () { return std({ color: 0x3a3d43, metalness: 0.75, roughness: 0.45 }); },
    disc: function () { return std({ color: 0x8a8d92, metalness: 0.9, roughness: 0.35 }); },
    rubber: function () { return std({ color: 0x1c1c1f, roughness: 0.82, bumpMap: treadTex(false), bumpScale: 2.2 }); },
    knobby: function () { return std({ color: 0x1c1c1f, roughness: 0.86, bumpMap: treadTex(true), bumpScale: 4 }); },
    whitewall: function () { return std({ color: 0xffffff, map: whitewallTex(), roughness: 0.8, bumpMap: treadTex(false), bumpScale: 2.2 }); },
    plastic: function () { return std({ color: 0x1f2024, roughness: 0.55, metalness: 0.05 }); },
    black: function () { return std({ color: 0x0d0e10, roughness: 0.8 }); },
    seat: function () { return std({ color: 0x2a2a30, roughness: 0.85 }); },
    glove: function () { return std({ color: 0x24252b, roughness: 0.75 }); },
    caliper: function () { return std({ color: 0xc0242c, roughness: 0.35, metalness: 0.2 }); },
    amber: function () { return std({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 0.6, roughness: 0.2 }); },
    lensGlass: function () { return phys({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.35, clearcoat: 1, depthWrite: false }); },
    glass: function () { return phys({ color: 0x18222b, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.82, envMapIntensity: 1.5 }); },
    visor: function () { return phys({ color: 0x14100c, metalness: 0.6, roughness: 0.05, clearcoat: 1, iridescence: 0.8, iridescenceIOR: 1.6 }); },
    grille: function () { return std({ color: 0xffffff, map: grilleTex(), roughness: 0.5, metalness: 0.4 }); },
    liner: function () { return std({ color: 0x18191c, roughness: 0.95 }); },
    alu: function () { return std({ color: 0xb9bec6, metalness: 0.9, roughness: 0.3 }); },
    nozzle: function () { return std({ color: 0x2b2522, metalness: 0.8, roughness: 0.35 }); },
    flame: function () { return std({ color: 0xffb04a, emissive: 0xff7a1a, emissiveIntensity: 1.4 }); }
  };
  function mat(name) { return Mt(name, MATS[name]); }
  function paintMat(hex) { return Mt('p' + hex, function () { return phys({ color: new T.Color(hex), metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 }); }); }
  function trimMat(hex) { return Mt('t' + hex, function () { return phys({ color: new T.Color(hex), metalness: 0.3, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.08 }); }); }
  function mattMat(hex) { return Mt('m' + hex, function () { return std({ color: new T.Color(hex), roughness: 0.7 }); }); }
  function bodyMat(key, paint, trim, D) {
    return Mt('b' + key, function () { return phys({ color: 0xffffff, map: paintTex(key, paint, trim, D), metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04 }); });
  }

  // ---------- geometry helpers ----------
  // creased normals (ported from three's BufferGeometryUtils.toCreasedNormals) for a non-indexed geometry
  function creased(g, angle) {
    if (g.index) g = g.toNonIndexed();
    var dot = Math.cos(angle), P = g.attributes.position.array, n = P.length / 9, map = {}, fn = new Float32Array(n * 3);
    function key(i) { return Math.round(P[i] * 1e4) + ',' + Math.round(P[i + 1] * 1e4) + ',' + Math.round(P[i + 2] * 1e4); }
    for (var f = 0; f < n; f++) {
      var o = f * 9, ax = P[o + 3] - P[o], ay = P[o + 4] - P[o + 1], az = P[o + 5] - P[o + 2];
      var bx = P[o + 6] - P[o], by = P[o + 7] - P[o + 1], bz = P[o + 8] - P[o + 2];
      var nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx, l = Math.hypot(nx, ny, nz) || 1;
      fn[f * 3] = nx / l; fn[f * 3 + 1] = ny / l; fn[f * 3 + 2] = nz / l;
      for (var k = 0; k < 3; k++) { var h = key(o + k * 3); (map[h] || (map[h] = [])).push(f); }
    }
    var N = new Float32Array(P.length);
    for (f = 0; f < n; f++) for (k = 0; k < 3; k++) {
      var list = map[key(f * 9 + k * 3)], sx = 0, sy = 0, sz = 0;
      for (var j = 0; j < list.length; j++) {
        var q = list[j] * 3, d = fn[f * 3] * fn[q] + fn[f * 3 + 1] * fn[q + 1] + fn[f * 3 + 2] * fn[q + 2];
        if (d > dot) { sx += fn[q]; sy += fn[q + 1]; sz += fn[q + 2]; }
      }
      var ll = Math.hypot(sx, sy, sz) || 1, w = (f * 3 + k) * 3;
      N[w] = sx / ll; N[w + 1] = sy / ll; N[w + 2] = sz / ll;
    }
    g.setAttribute('normal', new T.BufferAttribute(N, 3));
    return g;
  }
  // a rounded box (the RoundedBoxGeometry trick on an indexed box)
  function rbox(w, h, d, r, seg) {
    seg = seg || 1;
    return G('rb' + [w, h, d, r, seg].join(','), function () {
      if (r <= 0.01) return new T.BoxGeometry(w, h, d);
      var s = seg * 2 + 1, g = new T.BoxGeometry(1, 1, 1, s, s, s), p = g.attributes.position, nrm = g.attributes.normal, hs = 0.5 / s;
      r = Math.min(r, w / 2, h / 2, d / 2);
      var bx = w / 2 - r, by = h / 2 - r, bz = d / 2 - r, n = new T.Vector3();
      for (var i = 0; i < p.count; i++) {
        var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        n.set(x - Math.sign(x) * hs, y - Math.sign(y) * hs, z - Math.sign(z) * hs).normalize();
        p.setXYZ(i, bx * Math.sign(x) + n.x * r, by * Math.sign(y) + n.y * r, bz * Math.sign(z) + n.z * r);
        nrm.setXYZ(i, n.x, n.y, n.z);
      }
      return g;
    });
  }
  function sphere(ws, hs) { return G('sp' + ws + ',' + hs, function () { return new T.SphereGeometry(1, ws || 16, hs || 12); }); }
  function cyl(seg, open) { return G('cy' + seg + open, function () { return new T.CylinderGeometry(1, 1, 1, seg || 10, 1, !!open); }); }
  function mesh(geo, m, parent, x, y, z) {
    var o = new T.Mesh(geo, m); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; o.receiveShadow = true;
    if (parent) parent.add(o); return o;
  }
  function ball(m, parent, x, y, z, sx, sy, sz, seg) { var o = mesh(sphere(seg || 12, seg ? Math.max(6, seg * 0.7 | 0) : 8), m, parent, x, y, z); o.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz); return o; }
  function box(w, h, d, r, m, parent, x, y, z) { return mesh(rbox(w, h, d, r), m, parent, x, y, z); }
  // a rod from a to b
  var UPV = new T.Vector3(0, 1, 0);
  function rod(a, b, r, m, parent, seg) {
    var A = V(a[0], a[1], a[2]), B = V(b[0], b[1], b[2]), d = B.clone().sub(A), o = mesh(cyl(seg || 8, true), m, parent);
    o.position.copy(A).add(B).multiplyScalar(0.5); o.scale.set(r, d.length(), r); o.quaternion.setFromUnitVectors(UPV, d.normalize()); return o;
  }
  function tube(pts, r, m, parent, seg) {
    var curve = new T.CatmullRomCurve3(pts.map(function (p) { return V(p[0], p[1], p[2]); }), false, 'centripetal');
    return mesh(new T.TubeGeometry(curve, seg || pts.length * 6, r, 6, false), m, parent);
  }
  // a closed profile: items are [x, y, cornerRadius] or {arc: [cx, cy, r, a0, a1, clockwise]}
  function profile(items) {
    var s = new T.Shape(), n = items.length;
    function ends(it) {
      if (!it.arc) return [it, it];
      var a = it.arc; return [[a[0] + a[2] * Math.cos(a[3]), a[1] + a[2] * Math.sin(a[3])], [a[0] + a[2] * Math.cos(a[4]), a[1] + a[2] * Math.sin(a[4])]];
    }
    for (var i = 0; i < n; i++) {
      var it = items[i];
      if (it.arc) { var a = it.arc, e = ends(it)[0]; if (!i) s.moveTo(e[0], e[1]); s.absarc(a[0], a[1], a[2], a[3], a[4], a[5] !== false); continue; }
      var r = it[2] || 0;
      if (!r) { if (i) s.lineTo(it[0], it[1]); else s.moveTo(it[0], it[1]); continue; }
      var p = ends(items[(i + n - 1) % n])[1], q = ends(items[(i + 1) % n])[0];
      var dx1 = p[0] - it[0], dy1 = p[1] - it[1], l1 = Math.hypot(dx1, dy1), dx2 = q[0] - it[0], dy2 = q[1] - it[1], l2 = Math.hypot(dx2, dy2);
      var r1 = Math.min(r, l1 * 0.48), r2 = Math.min(r, l2 * 0.48);
      var ax = it[0] + dx1 / l1 * r1, ay = it[1] + dy1 / l1 * r1;
      if (i) s.lineTo(ax, ay); else s.moveTo(ax, ay);
      s.quadraticCurveTo(it[0], it[1], it[0] + dx2 / l2 * r2, it[1] + dy2 / l2 * r2);
    }
    s.closePath();
    return s;
  }
  // extrude shapes across the width (z from -hw to hw), map uvs for the paint texture, bend z by f(x, y), smooth
  function shell(shapes, hw, o) {
    o = o || {};
    var bt = o.bt === undefined ? Math.min(0.1, hw * 0.4) : o.bt, bs = o.bs === undefined ? bt * 0.7 : o.bs, depth = Math.max(0.002, 2 * hw - 2 * bt);
    var g = new T.ExtrudeGeometry(shapes, { depth: depth, bevelEnabled: bt > 0, bevelThickness: bt, bevelSize: bs, bevelOffset: -bs,
      bevelSegments: o.segs || 3, curveSegments: o.curve || 4, steps: 1 });
    g.translate(0, 0, -depth / 2);
    var p = g.attributes.position, uv = g.attributes.uv, caps = g.groups.length ? g.groups[0].count : 0, f = o.f, capN = [];
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (i < caps) {
        // the flat sides bend with f: give them the bent surface's normal, so long cap triangles shade smoothly
        var e = 0.004, sg = z > 0 ? 1 : -1, fx = f ? (f(x + e, y, z) - f(x - e, y, z)) / (2 * e) : 0, fy = f ? (f(x, y + e, z) - f(x, y - e, z)) / (2 * e) : 0;
        capN.push(V(-z * fx * sg, -z * fy * sg, sg).normalize());
      }
      uv.setXY(i, i < caps ? uvSide(x, z) : clamp(uWall(z), 0.005, 0.245), clamp(y / HR, 0, 1));
      if (f) p.setZ(i, z * f(x, y, z));
      if (o.zoff) p.setZ(i, p.getZ(i) + o.zoff);
    }
    g.clearGroups();
    g = creased(g, o.crease || 0.75);
    var nn = g.attributes.normal; capN.forEach(function (n, k) { nn.setXYZ(k, n.x, n.y, n.z); });
    return g;
  }
  // inset a convex polygon (counter-clockwise) by d, and clip one by axis-aligned bounds
  function inset(poly, d) {
    var n = poly.length, lines = [], out = [];
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), nx = -dy / l, ny = dx / l;
      lines.push([a[0] + nx * d, a[1] + ny * d, dx, dy]);
    }
    for (i = 0; i < n; i++) {
      var L1 = lines[(i + n - 1) % n], L2 = lines[i], den = L1[2] * L2[3] - L1[3] * L2[2];
      var t = ((L2[0] - L1[0]) * L2[3] - (L2[1] - L1[1]) * L2[2]) / den;
      out.push([L1[0] + L1[2] * t, L1[1] + L1[3] * t]);
    }
    return out;
  }
  function clip(poly, axis, v, keepAbove) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], ia = keepAbove ? a[axis] >= v : a[axis] <= v, ib = keepAbove ? b[axis] >= v : b[axis] <= v;
      if (ia) out.push(a);
      if (ia !== ib) { var t = (v - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  function polyShape(poly, r) { return profile(poly.map(function (p) { return [p[0], p[1], r || 0]; })); }
  // an airfoil section (chord along x, leading edge at +x)
  function airfoil(chord, thick) {
    var s = new T.Shape(), n = 10;
    s.moveTo(-chord / 2, 0);
    for (var i = 1; i <= n; i++) { var t = i / n, x = -chord / 2 + chord * t; s.lineTo(x, thick * 0.3 * Math.sin(PI * t) + thick * 0.7 * Math.sqrt(t) * (1 - t) * 1.4); }
    for (i = n - 1; i > 0; i--) { t = i / n; s.lineTo(-chord / 2 + chord * t, -thick * 0.25 * Math.sin(PI * t)); }
    s.closePath();
    return s;
  }
  function triCount(o) {
    var n = 0;
    o.traverse(function (m) { if (m.isMesh && m.visible !== false) { var g = m.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    return Math.round(n);
  }

  // ---------- placing parts on a surface ----------
  var ray = new T.Raycaster(), XV = new T.Vector3(1, 0, 0);
  function hit(surf, o, d) {
    surf.forEach(function (m) { m.updateMatrixWorld(true); });
    ray.set(V(o[0], o[1], o[2]), V(d[0], d[1], d[2]).normalize());
    return ray.intersectObjects(surf, false)[0] || null;
  }
  // put obj on the surface where the ray lands, its +x along the surface normal, pushed out by `out`
  function stick(surf, obj, o, d, out) {
    var h = hit(surf, o, d); if (!h) return null;
    var n = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    obj.position.copy(h.point).addScaledVector(n, out || 0);
    // the part's +x follows the normal; a part on a rear face is built facing +x too and turned about y first
    if (n.x < 0) { obj.quaternion.setFromUnitVectors(XV, V(-n.x, n.y, -n.z)); obj.quaternion.premultiply(new T.Quaternion().setFromAxisAngle(UPV, PI)); }
    else obj.quaternion.setFromUnitVectors(XV, n);
    return h;
  }

  // ---------- wheels ----------
  function tyreGeo(r, rr, tw, knobby) {
    return G('ty' + [r, rr, tw, knobby].join(','), function () {
      var h = tw / 2, sh = knobby ? 0.94 : 0.9, pts = [
        [rr * 1.0, -h * 0.9], [r * 0.84, -h], [r * sh + r * 0.035, -h * 0.9], [r, -h * 0.5],
        [r, h * 0.5], [r * sh + r * 0.035, h * 0.9], [r * 0.84, h], [rr * 1.0, h * 0.9]
      ].map(function (p) { return new T.Vector2(p[0], p[1]); });
      var g = new T.LatheGeometry(pts, 20); g.rotateX(PI / 2); return g;
    });
  }
  // merge geometries (position and normal only) into one non-indexed geometry
  function merge(list) {
    var P = [], N = [];
    list.forEach(function (g) {
      var q = g.index ? g.toNonIndexed() : g; if (!q.attributes.normal) q.computeVertexNormals();
      var p = q.attributes.position.array, n = q.attributes.normal.array;
      for (var i = 0; i < p.length; i++) { P.push(p[i]); N.push(n[i]); }
    });
    var m = new T.BufferGeometry(); m.setAttribute('position', new T.Float32BufferAttribute(P, 3)); m.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    return m;
  }
  // bake every mesh under group into one mesh per material (transforms applied); cacheKey shares the result
  function mergeAttrs(list) {
    var names = ['position', 'normal', 'uv'].filter(function (n) { return list.every(function (g) { return g.attributes[n]; }); }), m = new T.BufferGeometry();
    names.forEach(function (n) {
      var size = n === 'uv' ? 2 : 3, total = 0; list.forEach(function (g) { total += g.attributes[n].count * size; });
      var arr = new Float32Array(total), off = 0;
      list.forEach(function (g) { var a = g.attributes[n]; for (var i = 0; i < a.count; i++) { arr[off++] = a.getX(i); arr[off++] = a.getY(i); if (size === 3) arr[off++] = a.getZ(i); } });
      m.setAttribute(n, new T.BufferAttribute(arr, size));
    });
    return m;
  }
  function bake(group, own, cacheKey) {
    group.updateMatrixWorld(true);
    var inv = new T.Matrix4().copy(group.matrixWorld).invert(), sets = {}, order = [], out = [];
    group.traverse(function (o) {
      if (!o.isMesh || o.userData.keep) return;
      var k = o.material.uuid + (o.castShadow ? 's' : 'n');
      if (!sets[k]) { sets[k] = { m: o.material, cast: o.castShadow, list: [] }; order.push(k); }
      sets[k].list.push(o);
    });
    order.forEach(function (k, idx) {
      var st = sets[k], key = cacheKey && cacheKey + '|' + idx, geo = key && GEO[key];
      if (!geo) {
        var parts = st.list.map(function (o) { var g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(new T.Matrix4().multiplyMatrices(inv, o.matrixWorld)); return g; });
        geo = mergeAttrs(parts); parts.forEach(function (g) { g.dispose(); });
        geo.computeBoundingSphere();
        if (key) { GEO[key] = geo; geo.userData.shared = true; } else own.push(geo);
      }
      st.list.forEach(function (o) { o.parent.remove(o); });
      var m = new T.Mesh(geo, st.m); m.castShadow = st.cast; m.receiveShadow = true; group.add(m); out.push(m);
    });
    // drop the emptied groups
    var empty = []; group.traverse(function (o) { if (o !== group && !o.isMesh && o.children.length === 0 && o.type === 'Group') empty.push(o); });
    empty.forEach(function (o) { o.parent.remove(o); });
    return out;
  }
  // a wheel face: a rim lip and n tapered spokes dished toward the hub
  function spokeGeo(rr, n, width, dish) {
    return G('sk' + [rr, n, width, dish].join(','), function () {
      var lip = new T.LatheGeometry([[rr * 0.8, 0.0], [rr * 0.84, 0.012], [rr * 0.97, 0.014], [rr * 1.0, 0.0]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 18);
      lip.rotateX(PI / 2);
      var parts = [lip], sh = new T.Shape(), w0 = rr * width * 0.5, w1 = rr * width * 0.85;
      sh.moveTo(rr * 0.2, -w0); sh.lineTo(rr * 0.86, -w1); sh.lineTo(rr * 0.86, w1); sh.lineTo(rr * 0.2, w0); sh.closePath();
      for (var i = 0; i < n; i++) {
        var sp = new T.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: false });
        sp.translate(0, 0, -0.007); sp.rotateY(dish); sp.translate(0, 0, 0.86 * rr * Math.sin(dish) + 0.006); sp.rotateZ(i * PI * 2 / n + PI / 2);
        parts.push(sp);
      }
      var hub = new T.CylinderGeometry(rr * 0.24, rr * 0.27, 0.03, 14); hub.rotateX(PI / 2); hub.translate(0, 0, 0.66 * rr * Math.sin(dish) + 0.004); parts.push(hub);
      return merge(parts);
    });
  }
  function starGeo(rr) {
    return G('st' + rr, function () {
      var s = new T.Shape();
      for (var i = 0; i < 10; i++) { var a = PI / 2 + i * PI / 5, r = i % 2 ? rr * 0.42 : rr * 0.98; if (i) s.lineTo(r * Math.cos(a), r * Math.sin(a)); else s.moveTo(r * Math.cos(a), r * Math.sin(a)); }
      s.closePath();
      var g = new T.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2 });
      return creased(g, 0.6);
    });
  }
  function steelGeo(rr) {
    return G('sl' + rr, function () {
      var disc = new T.LatheGeometry([[rr * 0.22, 0.03], [rr * 0.5, 0.028], [rr * 0.75, 0.01], [rr * 0.92, 0.004], [rr, 0.012]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 18);
      disc.rotateX(PI / 2); return disc;
    });
  }
  function holesGeo(rr) {
    return G('slh' + rr, function () {
      var parts = [];
      for (var i = 0; i < 6; i++) { var a = i * PI / 3, c = new T.CircleGeometry(rr * 0.12, 10); c.translate(rr * 0.6 * Math.cos(a), rr * 0.6 * Math.sin(a), 0.0235); parts.push(c); }
      return merge(parts);
    });
  }
  function domeGeo(rr) {
    return G('dm' + rr, function () {
      var pts = []; for (var i = 0; i <= 8; i++) { var a = i / 8 * PI / 2; pts.push(new T.Vector2(rr * Math.cos(a) + 0.0001, rr * 0.35 * Math.sin(a))); }
      pts.reverse(); var g = new T.LatheGeometry(pts.reverse(), 22); g.rotateX(PI / 2); return g;
    });
  }
  // one wheel, built facing +z (outer face) with the axle along z; returns { content, r }
  function wheelContent(r, tw, style, trimHex) {
    var c = new T.Group(), chunky = style === 'chunky', rr = r * (chunky ? 0.55 : style === 'white' ? 0.56 : 0.66), h = tw / 2;
    mesh(tyreGeo(r, rr, tw, chunky), mat(chunky ? 'knobby' : style === 'white' ? 'whitewall' : 'rubber'), c);
    // the barrel behind the face, and the brake disc
    var barrel = mesh(cyl(14, true), mat('darkmetal'), c, 0, 0, 0); barrel.rotation.x = PI / 2; barrel.scale.set(rr * 0.99, tw * 0.8, rr * 0.99);
    mesh(G('wback', function () { return new T.CircleGeometry(1, 14); }), mat('liner'), c, 0, 0, -h * 0.5).scale.set(rr * 0.98, rr * 0.98, 1);
    if (!chunky) { var disc = mesh(cyl(14), mat('disc'), c, 0, 0, -0.01); disc.rotation.x = PI / 2; disc.scale.set(rr * 0.78, 0.014, rr * 0.78); }
    var fz = h * 0.42, face;
    if (style === 'gold') face = mesh(spokeGeo(rr, 10, 0.16, -0.22), mat('gold'), c, 0, 0, fz);
    else if (style === 'star') {
      var ring = mesh(G('ring' + rr, function () { return new T.TorusGeometry(rr * 0.93, rr * 0.07, 4, 20); }), mat('chrome'), c, 0, 0, fz);
      face = mesh(starGeo(rr), mat('star'), c, 0, 0, fz - 0.01); ring.castShadow = false;
    } else if (chunky) {
      face = mesh(steelGeo(rr), mat('steel'), c, 0, 0, fz - 0.02);
      mesh(holesGeo(rr), mat('black'), c, 0, 0, fz - 0.02).castShadow = false;
      mesh(G('bead' + rr, function () { return new T.TorusGeometry(rr * 0.97, rr * 0.08, 4, 18); }), mat('darkmetal'), c, 0, 0, fz);
    } else if (style === 'white') face = mesh(domeGeo(rr * 0.98), mat('chrome'), c, 0, 0, fz - 0.01);
    else face = mesh(spokeGeo(rr, 5, 0.34, -0.25), mat('alloy'), c, 0, 0, fz);
    // the centre cap
    var cap = mesh(cyl(12), style === 'gold' ? mat('gold') : style === 'star' ? trimMat(trimHex) : mat('chrome'), c, 0, 0, fz + 0.012);
    cap.rotation.x = PI / 2; cap.scale.set(rr * 0.2, 0.02, rr * 0.2);
    bake(c, null, 'wheel' + [r, tw, style, style === 'star' ? trimHex : ''].join(','));
    return c;
  }
  // a wheel at (x, r, z): pivot (steer with rotation.y) > spin (roll with rotation.z; positive rolls forward) > content
  function addWheel(root, x, z, r, tw, style, trimHex, front, caliper) {
    var pivot = new T.Group(), spin = new T.Group();
    pivot.position.set(x, r, z); spin.rotation.y = PI; pivot.add(spin); root.add(pivot);
    var c = wheelContent(r, tw, style, trimHex); if (z > 0) c.rotation.y = PI; spin.add(c);
    if (caliper) { var k = box(0.06, 0.09, 0.035, 0, mat('caliper'), pivot, -r * 0.3, r * 0.22, (z > 0 ? 1 : -1) * 0.012); k.rotation.z = 0.6; }
    return { pivot: pivot, spin: spin, front: front, r: r };
  }

  // ---------- small parts ----------
  function lamp(kind, w, h, m, parent) {
    var g = new T.Group(); parent.add(g);
    if (kind === 'round') {
      mesh(G('lr', function () { return new T.TorusGeometry(1, 0.16, 4, 14); }), mat('chrome'), g).scale.set(h, h, h);
      g.children[0].rotation.y = PI / 2;
      ball(m, g, -0.01, 0, 0, 0.025, h * 0.95, h * 0.95, 10);
    } else if (kind === 'rect') { mesh(rbox(0.04, h * 1.15, w * 1.08, Math.min(h, w) * 0.4), mat('plastic'), g, -0.016, 0, 0); mesh(rbox(0.04, h, w, Math.min(h, w) * 0.35), m, g, -0.012, 0, 0); }
    else { ball(mat('chrome'), g, -0.012, 0, 0, 0.026, h * 1.12, w * 1.08, 10); ball(m, g, -0.006, 0, 0, 0.026, h, w, 10); }
    g.children.forEach(function (o) { o.castShadow = false; });
    return g;
  }
  function plate(text, parent, w) {
    var m = Mt('plate' + text, function () { return std({ map: plateTex(text), roughness: 0.4, metalness: 0.2 }); });
    var g = new T.Group(); parent.add(g);
    var p = mesh(G('plateG', function () { return new T.PlaneGeometry(1, 1); }), m, g, 0.004, 0, 0); p.rotation.y = PI / 2; p.scale.set(w || 0.2, (w || 0.2) * 0.32, 1);
    box(0.008, (w || 0.2) * 0.36, (w || 0.2) * 1.06, 0.003, mat('plastic'), g, -0.002, 0, 0);
    return g;
  }
  function mirror(C, x, y, side) {
    var h = hit(C.surf, [x, y - 0.03, side * 3], [0, 0, -side]); if (!h) return;
    var zs = h.point.z, g = new T.Group(); C.body.add(g); g.position.set(x, y, zs + side * 0.07);
    rod([x + 0.01, y - 0.03, zs - side * 0.01], [x - 0.01, y, zs + side * 0.06], 0.01, mat('plastic'), C.body);
    box(0.06, 0.055, 0.08, 0.022, trimMat(C.trim), g, 0, 0, 0);
    var gl = box(0.004, 0.044, 0.066, 0, mat('chrome'), g, -0.03, 0, 0); gl.castShadow = false;
  }
  // a driver for an open car: seat, suit, arms on a steering wheel, a helmet with a visor
  function driver(C, x, y, z, s) {
    s = s || 1;
    var g = new T.Group(); g.position.set(x, y, z); g.scale.setScalar(s); C.body.add(g);
    var suit = mattMat(shade(C.paint, 0.75));
    box(0.2, 0.07, 0.26, 0.03, mat('seat'), g, -0.02, 0.0, 0);
    box(0.06, 0.3, 0.24, 0.03, mat('seat'), g, -0.11, 0.14, 0).rotation.z = 0.2;
    var torso = mesh(G('torso', function () { return new T.CapsuleGeometry(0.075, 0.12, 4, 10); }), suit, g, -0.04, 0.16, 0); torso.rotation.z = 0.25; torso.scale.set(1, 1, 1.35);
    [-1, 1].forEach(function (sd) {
      rod([-0.03, 0.23, sd * 0.1], [0.1, 0.17, sd * 0.09], 0.028, suit, g);
      rod([0.1, 0.17, sd * 0.09], [0.17, 0.2, sd * 0.06], 0.025, suit, g);
      ball(mat('glove'), g, 0.18, 0.2, sd * 0.055, 0.03);
    });
    var sw = mesh(G('swheel', function () { return new T.TorusGeometry(0.06, 0.012, 6, 16); }), mat('plastic'), g, 0.19, 0.2, 0); sw.rotation.y = PI / 2; sw.rotation.x = 0; sw.rotation.z = 0;
    sw.rotation.set(0, PI / 2, 0); sw.rotateX(-0.5);
    rod([0.19, 0.2, 0], [0.3, 0.12, 0], 0.012, mat('plastic'), g);
    ball(mattMat('#e7c09a'), g, 0.0, 0.31, 0, 0.04); // neck
    var helm = new T.Group(); helm.position.set(0.0, 0.38, 0); g.add(helm);
    ball(trimMat(C.trim), helm, 0, 0, 0, 0.1, 0.1, 0.094, 16);
    ball(paintMat(C.paint), helm, -0.005, 0.005, 0, 0.101, 0.098, 0.03, 14); // a stripe over the crown
    var vis = ball(mat('visor'), helm, 0.032, -0.008, 0, 0.074, 0.05, 0.08, 14); vis.castShadow = false;
    box(0.03, 0.03, 0.09, 0.012, mat('plastic'), helm, 0.07, -0.07, 0); // chin
    C.driver = g;
    return g;
  }

  // ---------- spoilers and exhausts ----------
  function deckY(C, x, z) { var h = hit(C.surf, [x, 4, z || 0], [0, -1, 0]); return h ? h.point.y : C.belt; }
  function spoiler(C, look) {
    var kind = look.spoiler, tm = trimMat(C.trim), L = C.L, W = C.W, xs = C.spoilerX !== undefined ? C.spoilerX : -L + 0.1;
    if (kind === 'duck') {
      var y = deckY(C, xs + 0.02, 0) - 0.02, s = profile([[-0.09, 0, 0], [0.12, 0, 0], [0.1, 0.012, 0.01], [-0.06, 0.07, 0.02], [-0.1, 0.06, 0.02]]);
      var g = mesh(G('duck' + C.key, function () { return shell(s, W * 0.82, { bt: 0.03, bs: 0.015, segs: 2 }); }), tm, C.body, xs, y, 0);
      C.surf.push(g);
    } else if (kind === 'tall') {
      var yb = deckY(C, xs + 0.05, 0) - 0.02, fs = profile([[-0.12, 0, 0], [0.14, 0, 0.02], [-0.06, 0.12, 0.08], [-0.2, 0.33, 0.03], [-0.25, 0.32, 0.02], [-0.19, 0.06, 0.03]]);
      mesh(G('fin', function () { return shell(fs, 0.018, { bt: 0.014, bs: 0.009, segs: 2 }); }), tm, C.body, xs + 0.06, yb, 0);
    } else if (kind === 'wing') {
      var hw = W * 0.96, top = Math.max(deckY(C, xs, W * 0.45), deckY(C, xs, -W * 0.45)) + 0.2, wing = new T.Group(); C.body.add(wing);
      var foil = mesh(G('wing' + C.key, function () { return shell(airfoil(0.24, 0.045), hw, { bt: 0.015, bs: 0.01, segs: 2 }); }), tm, wing, xs - 0.02, top, 0);
      foil.rotation.z = -0.16;
      [-1, 1].forEach(function (sd) {
        box(0.27, 0.12, 0.014, 0.02, mat('plastic'), wing, xs - 0.03, top, sd * (hw + 0.007));
        var yb = deckY(C, xs, sd * W * 0.45) - 0.02;
        box(0.05, top - yb + 0.01, 0.018, 0.008, mat('plastic'), wing, xs + 0.01, (top + yb) / 2, sd * W * 0.45).rotation.z = 0.12;
      });
    }
  }
  function pipeGeo() {
    return G('pipe', function () {
      var pts = [[0.021, 0.0], [0.03, 0.02], [0.03, 0.15], [0.034, 0.16], [0.028, 0.165], [0.022, 0.15]].map(function (p) { return new T.Vector2(p[0], p[1]); });
      return new T.LatheGeometry(pts, 14);
    });
  }
  function exhaust(C, look) {
    var kind = look.exhaust, tips = [], L = C.L, W = C.W, y = C.pipeY !== undefined ? C.pipeY : C.yb + 0.03, x0 = C.pipeX !== undefined ? C.pipeX : -L + 0.06;
    function pipe(z) {
      var p = mesh(pipeGeo(), mat('chrome'), C.body, x0, y, z); p.rotation.z = PI / 2; // lathe y -> -x
      var d = mesh(cyl(10), mat('black'), C.body, x0 - 0.15, y, z); d.rotation.z = PI / 2; d.scale.set(0.022, 0.004, 0.022);
      tips.push(V(x0 - 0.17, y, z));
    }
    if (kind === 'pipe') pipe(W * 0.55);
    if (kind === 'twin') { pipe(W * 0.42); pipe(-W * 0.42); }
    if (kind === 'stack') {
      var ex = C.stackX, zz = C.stackZ || W - 0.01, yb = C.stackY0 || C.belt - 0.12, top = (C.stackTop || C.belt + 0.45);
      [-1, 1].forEach(function (sd) {
        var p = mesh(cyl(14, true), mat('chrome'), C.body, ex, (yb + top) / 2, sd * zz); p.scale.set(0.033, top - yb, 0.033);
        var lip = mesh(G('stlip', function () { return new T.TorusGeometry(0.033, 0.007, 4, 12); }), mat('chrome'), C.body, ex, top, sd * zz); lip.rotation.x = PI / 2;
        var cap = mesh(cyl(14), mat('black'), C.body, ex, top - 0.01, sd * zz); cap.scale.set(0.028, 0.004, 0.028);
        mesh(cyl(14), mat('darkmetal'), C.body, ex, yb + 0.03, sd * zz).scale.set(0.045, 0.06, 0.045);
        tips.push(V(ex, top + 0.01, sd * zz));
      });
    }
    return tips;
  }
  // glider: a hang-glider sail on an aluminium frame above the car; userData.setOpen(f) folds the span
  function glider(C) {
    var g = new T.Group(), wing = new T.Group(), top = C.top + 0.32; g.add(wing); g.position.set(0, top, 0);
    var S = Math.max(1.1, C.W * 2.5), N = 8, M = 8, pos = [], uvs = [], idx = [];
    for (var i = 0; i <= N; i++) for (var j = -M; j <= M; j++) {
      var a = i / N, b = j / M, ab = Math.abs(b), xl = 0.5 - ab * 0.62, xt = -0.42 + ab * 0.18 + 0.03 * Math.abs(Math.sin(b * PI * 2));
      var x = xl + (xt - xl) * a, y = 0.07 * Math.sin(PI * Math.min(1, a * 1.1)) * (1 - b * b) - 0.1 * b * b + 0.03 * (1 - a);
      pos.push(x, y, b * S); uvs.push(a, (b + 1) / 2);
    }
    var R = 2 * M + 1;
    for (i = 0; i < N; i++) for (j = 0; j < 2 * M; j++) { var q = i * R + j; idx.push(q, q + 1, q + R, q + 1, q + R + 1, q + R); }
    var sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    sg.setIndex(idx); sg.computeVertexNormals();
    var cv = canvas(64, 256), x2 = cv.getContext('2d');
    x2.fillStyle = C.trim; x2.fillRect(0, 0, 64, 256);
    x2.fillStyle = C.paint; for (var k = 0; k < 4; k++) { x2.fillRect(0, 20 + k * 64, 64, 22); }
    x2.fillStyle = shade(C.trim, 0.6); x2.fillRect(0, 126, 64, 4);
    var tex = texOf(cv, true), sm = phys({ color: 0xffffff, map: tex, side: T.DoubleSide, roughness: 0.75, sheen: 1, sheenColor: new T.Color(0xffffff), sheenRoughness: 0.6 });
    var sail = mesh(sg, sm, wing); C.own.push(sg, sm, tex);
    var am = mat('alu');
    tube([[0.52, 0.04, 0], [0.1, 0.075, 0], [-0.44, 0.04, 0]], 0.012, am, wing);
    [-1, 1].forEach(function (sd) {
      tube([[0.5, 0.035, 0], [0.5 - 0.31, 0.02, sd * S * 0.5], [0.5 - 0.62, -0.07, sd * S]], 0.011, am, wing);
      rod([0.06, 0.07, 0], [0.06 - 0.25, 0.02, sd * S * 0.62], 0.009, am, wing); // cross bar
      rod([0.08, 0.0, 0], [0.22, -top + C.top + 0.02, sd * 0.28], 0.01, am, g); // control frame
      rod([0.08, 0.0, 0], [-0.15, -top + C.top + 0.02, sd * 0.2], 0.01, am, g);
    });
    rod([0.22, -top + C.top + 0.02, -0.28], [0.22, -top + C.top + 0.02, 0.28], 0.011, am, g);
    g.visible = false;
    g.userData.setOpen = function (f) { f = clamp(f, 0.05, 1); wing.scale.set(1, 1, f); };
    sail.castShadow = true;
    return g;
  }

  // ---------- the closed-car body kit ----------
  // C: { L, W, wr, wx, yb, belt, ... }; arches over the wheels for the side profile (bottom edge, left to right)
  function arch(C, cx, extra) {
    var ra = C.ra + (extra || 0), d = Math.asin(clamp((C.wr - C.yb) / ra, -0.9, 0.9));
    return { arc: [cx, C.wr, ra, PI + d, -d, true] };
  }
  function bodyF(C, tb, kf, kr, cf, cr) {
    var L = C.L;
    return function (x, y) {
      var t = x > 0 ? clamp((x - (L - cf)) / cf, 0, 1) : clamp((-x - (L - cr)) / cr, 0, 1), k = x > 0 ? kf : kr;
      var plan = 1 - k * t * t;
      var tumble = 1 - tb * smooth(C.belt - 0.22, C.belt + 0.02, y);
      var tuck = 1 - 0.05 * smooth(C.yb + 0.07, C.yb - 0.01, y);
      return plan * tumble * tuck;
    };
  }
  // greenhouse in `m` and its glass: poly is [rear-bottom, front-bottom, front-top, rear-top] (counter-clockwise),
  // hw the half width at the base, tc how much it narrows by the roof, pillars the x of the pillars between windows
  function cabin(C, poly, hw, tc, m, pillars, o) {
    o = o || {};
    var belt = C.belt, roof = Math.max(poly[2][1], poly[3][1]), f0 = C.f;
    var F = function (x, y) { var plan = f0(x, belt - 0.1) / f0(0, belt - 0.1); return plan * (1 - tc * smooth(belt, roof, y)); };
    var r = o.round || [0, 0.04, 0.1, 0.08], p0 = poly[0], p1 = poly[1];
    var items = [[p0[0] + 0.01, belt - 0.07, 0], [p1[0], belt - 0.07, 0], [p1[0], p1[1], r[1]], [poly[2][0], poly[2][1], r[2]], [poly[3][0], poly[3][1], r[3]], [p0[0], p0[1], r[0]]];
    var cbt = o.bt || 0.06, cbs = o.bs || 0.035;
    var g = mesh(G('cab' + C.key, function () { return shell(profile(items), hw, { bt: cbt, bs: cbs, f: F, segs: 4 }); }), m, C.body);
    C.surf.push(g);
    var glass = mat('glass'), ins = inset(poly, o.frame || cbs + 0.012);
    // side windows: the inset outline above the belt, cut by the pillars
    var side = clip(ins, 1, belt + (o.sill || 0.035), true), cuts = (pillars || []).slice().sort(function (a, b) { return a - b; }), wins = [], lo = -9;
    cuts.concat([9]).forEach(function (cx) { var pw = cx < 9 ? (o.pw || 0.03) : 0, w = clip(clip(side, 0, lo, true), 0, cx - pw, false); if (w.length > 2) wins.push(polyShape(w, 0.04)); lo = cx + pw; });
    var sw = mesh(G('win' + C.key, function () { return shell(wins, hw + 0.004, { bt: 0, f: F, crease: 0.3 }); }), glass, C.body); sw.castShadow = false;
    // windscreen and back window: bands along the front and rear edges, just outside the greenhouse
    function band(a, b, m0, m1, inner, key) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l, nx = uy, ny = -ux, e = 0.006;
      var q0 = [a[0] + ux * m0, a[1] + uy * m0], q1 = [b[0] - ux * m1, b[1] - uy * m1];
      var shp = polyShape([[q0[0] + nx * e, q0[1] + ny * e], [q1[0] + nx * e, q1[1] + ny * e], [q1[0] - nx * inner, q1[1] - ny * inner], [q0[0] - nx * inner, q0[1] - ny * inner]], 0);
      var gm = mesh(G(key + C.key, function () { return shell(shp, hw - (o.apillar || cbt + 0.015), { bt: 0, f: F, crease: 0.3 }); }), glass, C.body); gm.castShadow = false;
    }
    band(poly[1], poly[2], r[1] + 0.015, r[2] + 0.015, 0.04, 'ws');
    if (!o.noRear) band(poly[3], poly[0], r[3] + 0.015, r[0] + 0.015, 0.04, 'rw');
    return g;
  }
  // the dark underbody that fills the wheel arches between the wheels
  function underbody(C, top) {
    var zw = C.wz - C.tw / 2 - 0.015, y1 = top || C.belt - 0.07, y0 = C.yb + 0.01;
    mesh(rbox(2 * C.L - 0.2, y1 - y0, 2 * zw, 0.03), mat('liner'), C.body, 0, (y0 + y1) / 2, 0);
  }
  function flares(C, m, extra) {
    [-1, 1].forEach(function (fx) {
      var cx = fx * C.wx, s = new T.Shape(), ra = C.ra + (extra || 0.0), a0 = -0.35, a1 = PI + 0.35;
      s.absarc(0, 0, ra + 0.035, a0, a1, false); s.absarc(0, 0, ra - 0.004, a1, a0, true);
      var g = G('flare' + C.key, function () { return shell(s, 0.03, { bt: 0.018, bs: 0.012, segs: 2, curve: 3 }); });
      [-1, 1].forEach(function (sd) {
        var h = hit(C.surf, [cx, C.wr + ra * 0.7, sd * 3], [0, 0, -sd]), z = h ? h.point.z : sd * C.W;
        mesh(g, m, C.body, cx, C.wr, z - sd * 0.022);
      });
    });
  }
  function headTail(C, front, rear) {
    // front: [{ y, z, w, h, kind }], rear likewise (mirrored to both sides)
    var head = C.headMat, tail = C.tailMat;
    front.forEach(function (f) { [-1, 1].forEach(function (sd) { var l = lamp(f.kind, f.w, f.h, head, C.body); if (stick(C.surf, l, [3, f.y, sd * f.z], [-1, 0, 0], f.out || 0.0)) C.lights.head.push(l.children[l.children.length - 1]); else C.body.remove(l); }); });
    rear.forEach(function (f) { [-1, 1].forEach(function (sd) { var l = lamp(f.kind, f.w, f.h, tail, C.body); if (stick(C.surf, l, [-3, f.y, sd * f.z], [1, 0, 0], f.out || 0.0)) C.lights.tail.push(l.children[l.children.length - 1]); else C.body.remove(l); }); });
  }
  function onFront(C, obj, y, z, out) { return stick(C.surf, obj, [3, y, z || 0], [-1, 0, 0], out || 0); }
  function onRear(C, obj, y, z, out) { return stick(C.surf, obj, [-3, y, z || 0], [1, 0, 0], out || 0); }
  function grille(C, y, w, h, out) {
    var g = new T.Group(); C.body.add(g);
    var p = mesh(rbox(0.03, h, w, Math.min(h, w) * 0.3), mat('grille'), g, -0.008, 0, 0); p.castShadow = false;
    onFront(C, g, y, 0, out || 0); return g;
  }

  // ---------- the seven cars ----------
  var BUILD = {};
  BUILD.pip = function (C) {
    var L = C.L, yb = C.yb, belt = C.belt = Math.max(yb + 0.33, C.beltMin), roof = belt + 0.28;
    var s = profile([[-L, yb + 0.05, 0.05], [-L + 0.05, yb, 0.03], arch(C, -C.wx), arch(C, C.wx), [L - 0.05, yb, 0.03], [L, yb + 0.06, 0.04],
      [L + 0.006, yb + 0.17, 0.07], [L - 0.04, belt - 0.07, 0.08], [0.2, belt, 0.08], [-L + 0.07, belt + 0.015, 0.06], [-L - 0.004, belt - 0.1, 0.06], [-L, yb + 0.17, 0.04]]);
    C.f = bodyF(C, 0.13, 0.22, 0.16, 0.3, 0.22);
    C.deco = { yb: yb, side: [belt - 0.1, belt - 0.075], sideW: C.W, doors: [[0.2, -0.24, yb + 0.03, belt]] };
    C.shellMesh = mesh(G('body' + C.key, function () { return shell(s, C.W, { bt: 0.12, bs: 0.08, f: C.f }); }), C.paintM(), C.body); C.surf.push(C.shellMesh);
    cabin(C, [[-L + 0.06, belt + 0.02], [0.22, belt], [-0.1, roof], [-L + 0.13, roof - 0.015]], C.W * 0.86, 0.2, C.paintM(), [-0.27], { round: [0.03, 0.03, 0.12, 0.08] });
    underbody(C);
    headTail(C, [{ y: belt - 0.13, z: C.W * 0.56, w: 0.085, h: 0.05, kind: 'oval' }], [{ y: belt - 0.06, z: C.W * 0.62, w: 0.06, h: 0.055, kind: 'rect' }]);
    grille(C, yb + 0.12, 0.34, 0.07);
    var lip = box(0.06, 0.025, C.W * 1.5, 0.012, trimMat(C.trim), C.body); onFront(C, lip, yb + 0.03, 0, 0.0);
    plate('PIP 01', C.body, 0.2); onRear(C, C.body.children[C.body.children.length - 1], yb + 0.2, 0, 0.003);
    mirror(C, 0.12, belt + 0.035, 1); mirror(C, 0.12, belt + 0.035, -1);
    C.top = roof; C.pipeY = yb + 0.02; C.stackX = -L + 0.12; C.stackY0 = belt - 0.15; C.stackTop = roof + 0.1;
    C.spoilerX = -L + 0.13; C.spoilerDeck = roof;
    helmetHead(C, -0.22, belt + 0.06, -0.12);
  };
  BUILD.rumble = function (C) {
    var L = C.L, yb = C.yb, belt = C.belt = Math.max(yb + 0.36, C.wr + C.ra + 0.2), roof = belt + 0.32, floor = belt - 0.17, cabR = -0.235, cabF = 0.52;
    var s = profile([[-L, yb + 0.03, 0.03], [-L + 0.04, yb, 0.02], arch(C, -C.wx), arch(C, C.wx), [L - 0.04, yb, 0.02], [L + 0.004, yb + 0.05, 0.03],
      [L + 0.01, belt - 0.12, 0.04], [L - 0.015, belt - 0.03, 0.05], [cabF - 0.02, belt, 0.04], [cabR, belt, 0], [cabR - 0.02, floor, 0], [-L + 0.02, floor, 0], [-L, floor - 0.04, 0.02]]);
    C.f = bodyF(C, 0.08, 0.12, 0.08, 0.25, 0.18);
    C.deco = { yb: yb, side: [belt - 0.08, belt - 0.05], sideW: C.W, doors: [[cabF - 0.08, cabR + 0.02, yb + 0.06, belt]] };
    C.shellMesh = mesh(G('body' + C.key, function () { return shell(s, C.W, { bt: 0.1, bs: 0.07, f: C.f }); }), C.paintM(), C.body); C.surf.push(C.shellMesh);
    // the bed: sides, tailgate, a ribbed liner
    var bedS = profile([[-L + 0.01, floor - 0.02, 0], [cabR - 0.03, floor - 0.02, 0], [cabR - 0.03, belt, 0.015], [-L + 0.01, belt, 0.015]]);
    [-1, 1].forEach(function (sd) {
      var g = G('bed' + C.key + sd, function () { return shell(bedS, 0.03, { bt: 0.02, bs: 0.015, segs: 2, zoff: 0, f: function (x, y, z) { return 1; } }); });
      var m = mesh(g, C.paintM(), C.body, 0, 0, sd * (C.W * C.f(-0.5, belt - 0.05) - 0.03)); C.surf.push(m);
    });
    var tg = box(0.05, belt - floor + 0.02, 2 * C.W * C.f(-L, belt - 0.05) - 0.02, 0.015, C.paintM(), C.body, -L + 0.03, (belt + floor) / 2, 0); C.surf.push(tg);
    var lw = 2 * (C.W * C.f(-0.5, belt - 0.05) - 0.06);
    for (var i = 0; i < 6; i++) box(L + cabR - 0.1, 0.014, 0.03, 0, mat('plastic'), C.body, (cabR - 0.03 - L + 0.06) / 2, floor + 0.006, -lw / 2 + 0.05 + i * (lw - 0.1) / 5);
    cabin(C, [[cabR, belt], [cabF, belt], [0.29, roof], [cabR + 0.03, roof]], C.W * 0.88, 0.12, C.paintM(), [], { round: [0.02, 0.03, 0.1, 0.06] });
    underbody(C, floor - 0.03);
    flares(C, mat('plastic'), 0.0);
    headTail(C, [{ y: belt - 0.1, z: C.W * 0.56, w: 0.13, h: 0.075, kind: 'rect', out: 0.005 }], [{ y: belt - 0.07, z: C.W * 0.82, w: 0.04, h: 0.12, kind: 'rect' }]);
    grille(C, belt - 0.1, C.W * 0.75, 0.13, 0.005);
    // chrome bumpers, a roof light bar, side steps
    var fb = box(0.07, 0.07, C.W * 1.85, 0.025, mat('chrome'), C.body); onFront(C, fb, yb + 0.06, 0, 0.012);
    var rb = box(0.06, 0.06, C.W * 1.85, 0.022, mat('chrome'), C.body); onRear(C, rb, yb + 0.06, 0, 0.012);
    plate('RMBL 2', C.body, 0.2); onRear(C, C.body.children[C.body.children.length - 1], floor - 0.08, 0, 0.004);
    box(0.06, 0.04, 0.5, 0.015, mat('plastic'), C.body, 0.12, roof + 0.03, 0);
    for (i = 0; i < 4; i++) { var a = lamp('round', 0.03, 0.022, mat('amber'), C.body); a.position.set(0.155, roof + 0.03, -0.18 + i * 0.12); }
    [-1, 1].forEach(function (sd) { box(0.5, 0.02, 0.07, 0.01, mat('alu'), C.body, 0.12, yb - 0.02, sd * (C.W - 0.02)); });
    mirror(C, cabF - 0.1, belt + 0.06, 1); mirror(C, cabF - 0.1, belt + 0.06, -1);
    C.top = roof + 0.05; C.pipeX = -L + 0.12; C.pipeY = yb + 0.0; C.stackX = cabR - 0.07; C.stackZ = C.W - 0.04; C.stackY0 = floor; C.stackTop = roof + 0.12;
    C.spoilerX = -L + 0.09;
    helmetHead(C, 0.08, belt + 0.06, -0.15);
  };
  BUILD.clover = function (C) {
    var L = C.L, yb = C.yb, belt = C.belt = Math.max(yb + 0.27, C.beltMin), roof = belt + 0.45;
    var s = profile([[-L, yb + 0.04, 0.04], [-L + 0.04, yb, 0.02], arch(C, -C.wx), arch(C, C.wx), [L - 0.04, yb, 0.02], [L, yb + 0.05, 0.04],
      [L + 0.006, belt - 0.03, 0.09], [L - 0.07, belt + 0.005, 0.05], [-L + 0.02, belt, 0.03], [-L - 0.004, belt - 0.08, 0.04]]);
    C.f = bodyF(C, 0.03, 0.18, 0.1, 0.25, 0.2);
    C.deco = { yb: yb, side: [belt - 0.07, belt - 0.04], sideW: C.W, doors: [[0.5, 0.18, yb + 0.03, belt], [0.05, -0.32, yb + 0.03, belt]] };
    C.shellMesh = mesh(G('body' + C.key, function () { return shell(s, C.W, { bt: 0.1, bs: 0.07, f: C.f }); }), C.paintM(), C.body); C.surf.push(C.shellMesh);
    cabin(C, [[-L + 0.015, belt], [L - 0.06, belt], [0.44, roof], [-L + 0.04, roof]], C.W * 0.985, 0.08, trimMat(C.trim), [0.25, -0.12, -0.45],
      { round: [0.03, 0.05, 0.16, 0.12], sill: 0.12, bt: 0.09, bs: 0.06, frame: 0.05 });
    underbody(C);
    headTail(C, [{ y: belt - 0.1, z: C.W * 0.6, w: 0.09, h: 0.06, kind: 'round', out: 0.01 }], [{ y: belt - 0.05, z: C.W * 0.75, w: 0.05, h: 0.09, kind: 'rect' }]);
    // chrome bumpers, a lucky clover badge, a roof rack
    var fb = box(0.06, 0.07, C.W * 1.8, 0.025, mat('chrome'), C.body); onFront(C, fb, yb + 0.07, 0, 0.015);
    var rb = box(0.06, 0.07, C.W * 1.8, 0.025, mat('chrome'), C.body); onRear(C, rb, yb + 0.07, 0, 0.015);
    var badge = new T.Group(); C.body.add(badge);
    var bd = mesh(cyl(20), mat('chrome'), badge, 0, 0, 0); bd.rotation.z = PI / 2; bd.scale.set(0.07, 0.015, 0.07);
    for (var i = 0; i < 4; i++) { var a = i * PI / 2 + PI / 4; ball(trimMat('#3fa34d'), badge, 0.01, 0.028 * Math.sin(a), 0.028 * Math.cos(a), 0.008, 0.028, 0.028); }
    onFront(C, badge, belt - 0.07, 0, 0.005);
    grille(C, yb + 0.13, 0.28, 0.045);
    plate('LUCKY', C.body, 0.2); onRear(C, C.body.children[C.body.children.length - 1], belt - 0.13, 0, 0.003);
    [-1, 1].forEach(function (sd) { box(1.15, 0.02, 0.025, 0.008, mat('alu'), C.body, -0.15, roof + 0.04, sd * 0.36); for (var k = 0; k < 3; k++) box(0.03, 0.05, 0.03, 0.01, mat('alu'), C.body, -0.6 + k * 0.45, roof + 0.015, sd * 0.36); });
    for (i = 0; i < 4; i++) box(0.025, 0.02, 0.74, 0.008, mat('alu'), C.body, -0.65 + i * 0.33, roof + 0.06, 0);
    box(0.6, 0.09, 0.42, 0.04, trimMat(C.paint), C.body, -0.25, roof + 0.115, 0); // a roof box in the paint colour
    mirror(C, L - 0.14, belt + 0.05, 1); mirror(C, L - 0.14, belt + 0.05, -1);
    C.top = roof + 0.16; C.stackX = -L + 0.15; C.stackY0 = belt - 0.1; C.stackTop = roof + 0.08; C.stackZ = C.W + 0.03;
    C.spoilerX = -L + 0.12;
    helmetHead(C, 0.33, belt + 0.12, -0.18);
  };
  BUILD.bolt = function (C) {
    var L = C.L, yb = C.yb, belt = C.belt = Math.max(yb + 0.29, C.beltMin), roof = belt + 0.25;
    var s = profile([[-L, yb + 0.05, 0.05], [-L + 0.05, yb, 0.03], arch(C, -C.wx), arch(C, C.wx), [L - 0.05, yb, 0.03], [L + 0.012, yb + 0.05, 0.04],
      [L + 0.012, yb + 0.21, 0.05], [L - 0.05, belt - 0.08, 0.1], [0.24, belt - 0.01, 0.12], [-L + 0.12, belt + 0.02, 0.06], [-L - 0.004, belt - 0.06, 0.05], [-L, yb + 0.12, 0.04]]);
    C.f = bodyF(C, 0.14, 0.24, 0.14, 0.32, 0.2);
    C.deco = { yb: yb, center: true, side: [yb + 0.07, yb + 0.1], sideW: C.W, doors: [[0.24, -0.2, yb + 0.03, belt]], number: { x: 0.02, y: belt - 0.13, r: 0.085, n: 7 } };
    C.shellMesh = mesh(G('body' + C.key, function () { return shell(s, C.W, { bt: 0.12, bs: 0.08, f: C.f }); }), C.paintM(), C.body); C.surf.push(C.shellMesh);
    cabin(C, [[-L + 0.13, belt + 0.02], [0.26, belt], [-0.02, roof], [-0.4, roof - 0.01]], C.W * 0.82, 0.22, C.paintM(), [-0.22], { round: [0.04, 0.03, 0.1, 0.1] });
    underbody(C);
    flares(C, C.paintM(), 0.0);
    headTail(C, [{ y: belt - 0.11, z: C.W * 0.6, w: 0.11, h: 0.04, kind: 'oval' }], [{ y: belt - 0.04, z: C.W * 0.62, w: 0.09, h: 0.04, kind: 'rect' }]);
    grille(C, yb + 0.075, 0.42, 0.05);
    // a rally light pod, a hood scoop, a roof vent, mud flaps
    var pod = new T.Group(); C.body.add(pod);
    box(0.03, 0.06, 0.4, 0.012, mat('plastic'), pod, -0.01, 0, 0);
    for (var i = 0; i < 4; i++) { var l = lamp('round', 0.05, 0.026, C.headMat, pod); l.position.set(0.01, 0, -0.15 + i * 0.1); C.lights.head.push(l.children[1]); }
    onFront(C, pod, yb + 0.16, 0, 0.035);
    var hs = hit(C.surf, [0.45, 3, 0], [0, -1, 0]);
    if (hs) { var sc = box(0.2, 0.05, 0.2, 0.025, C.paintM(), C.body, 0.45, hs.point.y + 0.005, 0); sc.rotation.z = -0.1; box(0.02, 0.03, 0.16, 0.008, mat('black'), C.body, 0.55, hs.point.y + 0.012, 0); }
    box(0.16, 0.03, 0.14, 0.015, C.paintM(), C.body, -0.18, roof + 0.008, 0);
    [-1, 1].forEach(function (sd) { box(0.012, 0.09, 0.14, 0.004, mat('plastic'), C.body, -C.wx - C.wr - 0.04, yb + 0.0, sd * (C.W - 0.1)); });
    var dif = box(0.08, 0.035, C.W * 1.4, 0.012, mat('plastic'), C.body); onRear(C, dif, yb + 0.03, 0, 0.0);
    plate('BOLT 7', C.body, 0.19); onRear(C, C.body.children[C.body.children.length - 1], yb + 0.14, 0, 0.003);
    mirror(C, 0.16, belt + 0.03, 1); mirror(C, 0.16, belt + 0.03, -1);
    C.top = roof; C.pipeY = yb + 0.02; C.stackX = -0.48; C.stackTop = roof + 0.12;
    C.spoilerX = -L + 0.1;
    helmetHead(C, -0.12, belt + 0.03, -0.12);
  };
  BUILD.comet = function (C) {
    var L = C.L, belt = C.belt = 0.3, yb = C.yb = 0.06;
    var s = profile([[-L + 0.02, 0.07, 0.03], [L - 0.06, 0.07, 0.03], [L + 0.005, 0.11, 0.04], [L - 0.1, 0.17, 0.12], [0.08, 0.27, 0.12], [0.03, 0.28, 0.02],
      [-0.2, 0.27, 0.02], [-0.33, 0.42, 0.06], [-0.42, 0.4, 0.06], [-L + 0.06, 0.22, 0.08], [-L, 0.13, 0.03]]);
    var fw = 0.21;
    C.f = function (x, y) {
      var t = smooth(0.0, L + 0.02, x), plan = 1 - 0.62 * t;
      var rear = 1 - 0.4 * smooth(-0.45, -L, x);
      return plan * rear * (1 - 0.35 * smooth(0.14, 0.42, y));
    };
    C.deco = { center: true, number: { x: -0.08, y: 0.17, r: 0.06, n: 3 } };
    C.shellMesh = mesh(G('body' + C.key, function () { return shell(s, fw, { bt: 0.08, bs: 0.06, f: C.f }); }), C.paintM(), C.body); C.surf.push(C.shellMesh);
    // side pods
    var ps = profile([[-0.42, 0.07, 0.02], [0.2, 0.07, 0.02], [0.23, 0.2, 0.04], [0.12, 0.24, 0.08], [-0.33, 0.2, 0.06], [-0.46, 0.12, 0.04]]);
    [-1, 1].forEach(function (sd) {
      var pm = mesh(G('pod' + C.key, function () { return shell(ps, 0.1, { bt: 0.05, bs: 0.04, f: function (x) { return 1 - 0.3 * smooth(-0.1, -0.46, x); } }); }), C.paintM(), C.body, 0, 0, sd * 0.27);
      C.surf.push(pm);
      box(0.03, 0.1, 0.13, 0.03, mat('black'), C.body, 0.205, 0.15, sd * 0.27);
    });
    // the cockpit rim and driver
    var rim = mesh(G('rim', function () { return new T.TorusGeometry(1, 0.12, 6, 20); }), mat('plastic'), C.body, -0.09, 0.275, 0); rim.rotation.x = PI / 2; rim.scale.set(0.16, 0.13, 0.1);
    driver(C, -0.18, 0.12, 0, 0.92);
    // front wing with end plates, the suspension arms
    var fwg = mesh(G('fwing' + C.key, function () { return shell(airfoil(0.16, 0.03), 0.3, { bt: 0.01, bs: 0.008, segs: 2 }); }), C.trimM(), C.body, L - 0.07, 0.06, 0); fwg.rotation.z = -0.08;
    [-1, 1].forEach(function (sd) { box(0.18, 0.08, 0.012, 0.02, mat('plastic'), C.body, L - 0.07, 0.08, sd * 0.3); });
    [-1, 1].forEach(function (fx) { [-1, 1].forEach(function (sd) {
      var wx = fx * C.wx, wz = sd * (C.wz - 0.06), bz = sd * (fx > 0 ? 0.08 : 0.14);
      rod([wx + 0.08, 0.2, bz], [wx, C.wr + 0.04, wz], 0.011, mat('plastic'), C.body);
      rod([wx - 0.08, 0.2, bz], [wx, C.wr + 0.04, wz], 0.011, mat('plastic'), C.body);
      rod([wx + 0.06, 0.1, bz], [wx, C.wr - 0.06, wz], 0.011, mat('plastic'), C.body);
      rod([wx - 0.06, 0.1, bz], [wx, C.wr - 0.06, wz], 0.011, mat('plastic'), C.body);
    }); });
    // an air intake over the driver's head, lights
    headTail(C, [{ y: 0.12, z: 0.06, w: 0.035, h: 0.025, kind: 'oval' }], [{ y: 0.16, z: 0.03, w: 0.03, h: 0.04, kind: 'rect' }]);
    var rain = lamp('rect', 0.05, 0.03, C.tailMat, C.body); onRear(C, rain, 0.1, 0, 0); C.lights.tail.push(rain.children[0]);
    var mr = [-1, 1].map(function (sd) { var g = new T.Group(); C.body.add(g); g.position.set(0.1, 0.27, sd * 0.27); box(0.05, 0.04, 0.07, 0.015, C.trimM(), g); return g; });
    C.top = 0.55; C.pipeX = -L + 0.06; C.pipeY = 0.16; C.stackX = -0.4; C.stackY0 = 0.3; C.stackZ = 0.17; C.stackTop = 0.72;
    C.spoilerX = -L + 0.12; C.open = true;
  };
  BUILD.nova = function (C) {
    var L = C.L, yb = C.yb = 0.1, belt = C.belt = 0.36, yc = 0.27;
    // a lathe fuselage: radius along the length, pointed nose, flattened
    var g = G('fus', function () {
      var pts = [], n = 18;
      for (var i = 0; i <= n; i++) {
        var t = i / n, x = -L + 0.08 + t * (2 * L - 0.08), r;
        var u = (x + L - 0.08) / (2 * L - 0.08);
        r = 0.24 * Math.pow(Math.sin(PI * Math.pow(u, 0.62)), 0.75) * (u < 0.1 ? 0.55 + 4.5 * u : 1);
        if (i === 0) r = 0.11; if (i === n) r = 0.001;
        pts.push(new T.Vector2(Math.max(0.001, r), x));
      }
      var lg = new T.LatheGeometry(pts, 22); lg.rotateZ(-PI / 2); lg.rotateX(PI / 2); lg.scale(1, 0.7, 1.2);
      // lathe y -> x; uvs for the paint texture
      var p = lg.attributes.position, uv = lg.attributes.uv;
      for (var k = 0; k < p.count; k++) uv.setXY(k, clamp(uWall(p.getZ(k)), 0.005, 0.245), clamp((p.getY(k) + yc) / HR, 0, 1));
      return lg;
    });
    // the lathe was built about the x axis after the turn; mirror check below keeps the nose at +x
    C.deco = { center: true };
    var fus = mesh(g, C.paintM(), C.body, 0, yc, 0); C.surf.push(fus);
    // side sponsons between the wheels
    var sp = G('spon', function () {
      var pts = []; for (var i = 0; i <= 12; i++) { var t = i / 12; pts.push(new T.Vector2(Math.max(0.001, 0.085 * Math.pow(Math.sin(PI * Math.pow(t, 0.8)), 0.6)), -0.5 + t)); }
      var q = new T.LatheGeometry(pts, 16); q.rotateZ(-PI / 2); q.scale(1, 0.8, 1);
      var p = q.attributes.position, uv = q.attributes.uv; for (var k = 0; k < p.count; k++) uv.setXY(k, 0.004, 0.5);
      return q;
    });
    [-1, 1].forEach(function (sd) { var m = mesh(sp, C.paintM(), C.body, -0.02, 0.17, sd * 0.25); m.scale.set(1.0, 1, 1); C.surf.push(m); });
    // the rocket nozzle at the tail
    var nz = mesh(G('noz', function () { var pts = [[0.1, 0], [0.12, 0.06], [0.13, 0.1], [0.1, 0.1], [0.06, 0.02]].map(function (p) { return new T.Vector2(p[0], p[1]); }); var q = new T.LatheGeometry(pts, 20); q.rotateZ(PI / 2); return q; }), mat('nozzle'), C.body, -L + 0.1, yc, 0);
    nz.scale.set(1, 0.72, 1);
    var fl = mesh(cyl(20), C.tailMat, C.body, -L + 0.06, yc, 0); fl.rotation.z = PI / 2; fl.scale.set(0.075, 0.01, 0.075 / 0.72); fl.scale.set(0.072, 0.01, 0.072); fl.castShadow = false;
    C.lights.tail.push(fl);
    // the cockpit: rim, driver, a bubble screen
    var rim = mesh(G('rim', function () { return new T.TorusGeometry(1, 0.12, 6, 20); }), mat('plastic'), C.body, -0.3, yc + 0.14, 0); rim.rotation.x = PI / 2; rim.scale.set(0.17, 0.12, 0.1);
    driver(C, -0.38, yc - 0.05, 0, 0.9);
    var scr = ball(mat('glass'), C.body, -0.16, yc + 0.14, 0, 0.1, 0.09, 0.13, 16); scr.castShadow = false;
    // cycle fenders over each wheel (the front ones steer with the wheel), stub wings to the rear ones
    var fs = new T.Shape(), ro = C.wr + 0.05, ri = C.wr + 0.03; fs.absarc(0, 0, ro, -0.15, PI * 0.9, false); fs.absarc(0, 0, ri, PI * 0.9, -0.15, true);
    C.fender = G('fender' + C.key, function () { return shell(fs, C.tw / 2 + 0.015, { bt: 0.015, bs: 0.01, segs: 2 }); });
    [-1, 1].forEach(function (sd) {
      mesh(C.fender, paintMat(C.paint), C.body, -C.wx, C.wr, sd * C.wz);
      var sw = mesh(G('stub' + C.key, function () { return shell(airfoil(0.22, 0.05), (C.wz - 0.12) / 2, { bt: 0.015, bs: 0.01, segs: 2 }); }), C.paintM(), C.body, -C.wx + 0.02, C.wr + 0.02, sd * (C.wz + 0.12) / 2);
      sw.rotation.z = 0.05;
      rod([C.wx, C.wr + 0.02, sd * 0.1], [C.wx, C.wr, sd * (C.wz - 0.05)], 0.014, mat('alu'), C.body);
      rod([C.wx + 0.05, C.wr - 0.08, sd * 0.08], [C.wx, C.wr - 0.06, sd * (C.wz - 0.05)], 0.012, mat('alu'), C.body);
    });
    headTail(C, [{ y: yc + 0.02, z: 0.09, w: 0.04, h: 0.03, kind: 'oval' }], []);
    [-1, 1].forEach(function (sd) { var l = lamp('rect', 0.04, 0.03, C.tailMat, C.body); l.position.set(-C.wx - 0.1, C.wr + 0.02, sd * C.wz); l.rotation.y = PI; C.lights.tail.push(l.children[0]); });
    C.top = 0.62; C.pipeX = -L + 0.2; C.pipeY = yc - 0.1; C.stackX = -0.56; C.stackY0 = yc; C.stackZ = 0.13; C.stackTop = 0.7;
    C.spoilerX = -L + 0.2; C.open = true;
  };
  BUILD.hopper = function (C) {
    var L = C.L, yb = C.yb = 0.2, belt = C.belt = yb + 0.2, hw = 0.27;
    var s = profile([[-L + 0.1, yb, 0.03], [L - 0.14, yb, 0.03], [L - 0.02, yb + 0.12, 0.05], [L - 0.1, yb + 0.23, 0.06], [0.14, yb + 0.21, 0.04], [0.06, yb + 0.15, 0.03],
      [-0.24, yb + 0.15, 0.03], [-0.3, yb + 0.26, 0.04], [-L + 0.06, yb + 0.26, 0.05], [-L, yb + 0.1, 0.05]]);
    C.f = function (x, y) { var t = x > 0 ? smooth(0.2, L, x) : smooth(-0.35, -L, x); return (1 - 0.25 * t) * (1 - 0.12 * smooth(yb + 0.1, yb + 0.26, y)); };
    C.deco = { yb: yb, side: [yb + 0.12, yb + 0.14], sideW: hw };
    C.shellMesh = mesh(G('body' + C.key, function () { return shell(s, hw, { bt: 0.08, bs: 0.06, f: C.f }); }), C.paintM(), C.body); C.surf.push(C.shellMesh);
    mesh(rbox(0.6, 0.08, 0.3, 0.03), mat('liner'), C.body, 0.0, yb - 0.02, 0); // skid plate
    // the roll cage
    var cm = C.trimM(), r = 0.019, ft = 0.98;
    [-1, 1].forEach(function (sd) {
      tube([[0.36, yb + 0.2, sd * 0.22], [0.16, 0.66, sd * 0.22], [0.02, ft - 0.02, sd * 0.2], [-0.12, ft + 0.01, sd * 0.2], [-0.27, ft - 0.02, sd * 0.2], [-0.32, yb + 0.25, sd * 0.24]], r, cm, C.body, 26);
      rod([-0.27, ft - 0.03, sd * 0.2], [-0.62, yb + 0.25, sd * 0.17], r * 0.9, cm, C.body);
      rod([0.36, yb + 0.2, sd * 0.22], [0.6, yb + 0.05, sd * 0.2], r * 0.9, cm, C.body);
    });
    rod([0.02, ft - 0.02, -0.2], [0.02, ft - 0.02, 0.2], r, cm, C.body); rod([-0.27, ft - 0.02, -0.2], [-0.27, ft - 0.02, 0.2], r, cm, C.body);
    rod([-0.29, 0.75, -0.21], [-0.29, 0.75, 0.21], r * 0.9, cm, C.body);
    tube([[0.6, yb + 0.05, -0.2], [0.7, yb + 0.06, -0.12], [0.72, yb + 0.08, 0], [0.7, yb + 0.06, 0.12], [0.6, yb + 0.05, 0.2]], r * 1.1, mat('steel'), C.body, 16);
    // a light bar on the cage
    for (var i = 0; i < 2; i++) { var l = lamp('round', 0.06, 0.035, C.headMat, C.body); l.position.set(0.05, ft + 0.035, -0.1 + i * 0.2); C.lights.head.push(l.children[1]); }
    box(0.04, 0.03, 0.34, 0.01, mat('plastic'), C.body, 0.02, ft + 0.01, 0);
    driver(C, -0.1, yb + 0.06, 0, 1.0);
    // engine behind the seat: block, air filter, a spare tyre on the deck
    box(0.22, 0.14, 0.3, 0.03, mat('darkmetal'), C.body, -0.48, yb + 0.29, 0);
    var af = mesh(cyl(18), mat('chrome'), C.body, -0.45, yb + 0.4, 0.06); af.scale.set(0.06, 0.06, 0.06);
    var sp = new T.Group(); C.body.add(sp); sp.position.set(-0.52, yb + 0.33, -0.05); sp.rotation.set(PI / 2, 0, 0.0); sp.add(wheelContent(0.17, 0.11, 'chunky', C.trim)); sp.position.y += 0.1;
    sp.rotation.set(PI / 2 - 0.3, 0, 0); sp.position.set(-0.55, yb + 0.4, 0.06);
    headTail(C, [{ y: yb + 0.12, z: 0.13, w: 0.04, h: 0.035, kind: 'oval' }], [{ y: yb + 0.16, z: 0.16, w: 0.04, h: 0.04, kind: 'rect' }]);
    plate('HOP 3', C.body, 0.16); onRear(C, C.body.children[C.body.children.length - 1], yb + 0.07, 0, 0.003);
    C.top = ft + 0.06; C.pipeX = -L + 0.04; C.pipeY = yb + 0.08; C.stackX = -0.44; C.stackZ = 0.2; C.stackY0 = yb + 0.25; C.stackTop = 0.9;
    C.spoilerX = -L + 0.12; C.open = true;
  };
  // a head behind the glass of a closed car: the kid in a helmet
  function helmetHead(C, x, y, z) {
    var g = new T.Group(); g.position.set(x, y, z); C.body.add(g);
    ball(mattMat('#3c5a6e'), g, -0.02, 0.0, 0, 0.07, 0.05, 0.09);
    ball(trimMat(C.trim), g, 0, 0.13, 0, 0.085, 0.085, 0.08, 12);
  }

  function lookOf(id, look) {
    var d = RB.CARS[id].look, o = {};
    ['paint', 'trim', 'wheels', 'spoiler', 'exhaust'].forEach(function (k) { o[k] = look && look[k] && RB.lookOpt(k, look[k]) ? look[k] : d[k]; });
    return o;
  }

  // ---------- public: a car ----------
  function car(id, look) {
    var def = RB.CARS[id], M = def.model; look = lookOf(id, look);
    var paint = RB.lookOpt('paint', look.paint).c, trim = RB.lookOpt('trim', look.trim).c;
    var chunky = look.wheels === 'chunky', open = !!M.open;
    var wr = M.wheel * (chunky ? 1.12 : 1) * (open ? (M.wheel > 0.3 ? 0.85 : 1) : 0.84);
    var root = new T.Group(), body = new T.Group(); root.add(body); root.name = 'car-' + id;
    var C = {
      id: id, key: id + (chunky ? 'C' : 'S'), L: M.len / 2, W: M.wid / 2, wr: wr, tw: (chunky ? 0.2 : 0.16) * Math.min(1.15, M.wid / 0.95),
      paint: paint, trim: trim, body: body, surf: [], own: [], lights: { head: [], tail: [] }
    };
    C.ra = wr + 0.03; C.yb = wr - C.ra * 0.34; C.beltMin = wr + C.ra + 0.075;
    // closed bodies need room for the arches inside the bumpers (the old sprites let the wheels poke out)
    C.wx = C.L - Math.max(0.24, wr * 0.95); if (!open) C.wx = Math.min(C.wx, C.L - C.ra - 0.075);
    C.wz = C.W - C.tw / 2 - (open ? 0 : 0.02);
    C.headMat = phys({ color: 0xdfe6ee, emissive: 0xfff1d0, emissiveIntensity: 0.45, roughness: 0.05, metalness: 0.2, clearcoat: 1, transmission: 0 });
    C.tailMat = phys({ color: 0x7a0a0a, emissive: 0xff2414, emissiveIntensity: 0.6, roughness: 0.1, clearcoat: 1 });
    C.own.push(C.headMat, C.tailMat);
    C.paintM = function () { return bodyMat(C.key + paint + trim, paint, trim, C.deco || {}); };
    C.trimM = function () { return trimMat(trim); };
    BUILD[id](C);
    spoiler(C, look);
    var tips = exhaust(C, look);
    // boost flames still need somewhere to come from: the rocket nozzle, or a hidden pipe under the rear bumper
    if (id === 'nova') tips.push(V(-C.L + 0.04, 0.27, 0));
    if (!tips.length) tips.push(V(-C.L - 0.03, C.yb + 0.05, 0));
    // wheels
    var wheels = [];
    [1, -1].forEach(function (fx) { [-1, 1].forEach(function (sd) { wheels.push(addWheel(root, fx * C.wx, sd * C.wz, wr, C.tw, look.wheels, trim, fx > 0, !chunky)); }); });
    if (id === 'nova') wheels.forEach(function (w) { if (w.front) mesh(C.fender, paintMat(paint), w.pivot); });
    // the shield bubble around the car (measured before the glider is added)
    var bb = new T.Box3().setFromObject(root), sz = bb.getSize(V()), ctr = bb.getCenter(V());
    var gl = glider(C); root.add(gl);
    var shM = phys({ color: 0x9fdcff, emissive: 0x2a7aff, emissiveIntensity: 0.35, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false,
      side: T.DoubleSide, iridescence: 1, iridescenceIOR: 1.4, clearcoat: 1 });
    var shield = new T.Mesh(sphere(32, 20), shM); shield.position.copy(ctr); shield.scale.set(sz.x * 0.62 + 0.08, sz.y * 0.68 + 0.08, sz.z * 0.68 + 0.08);
    shield.visible = false; shield.renderOrder = 5; root.add(shield); C.own.push(shM);
    body.traverse(function (o) { if (o.isMesh && o.material && o.material.transparent) o.castShadow = false; });
    if (!api._noBake) bake(body, C.own);
    body.children.forEach(function (m) { if (m.material === C.headMat) C.lights.head = [m]; if (m.material === C.tailMat) C.lights.tail = [m]; });
    var count = triCount(root) - triCount(shield) + 0;
    root.userData = {
      id: id, look: look, wheels: wheels, body: body, glider: gl, shield: shield, lights: C.lights, exhaust: tips,
      len: M.len, wid: M.wid, height: bb.max.y, tris: count - triCount(gl),
      dispose: function () { C.own.forEach(function (r) { r.dispose(); }); }
    };
    return root;
  }

  // ---------- items ----------
  function crate() {
    var g = new T.Group(), s = 0.8, h = s / 2;
    var wood = Mt('wood', function () {
      var cv = canvas(256, 256), x = cv.getContext('2d');
      x.fillStyle = '#a8743f'; x.fillRect(0, 0, 256, 256);
      for (var i = 0; i < 4; i++) {
        var y0 = i * 64; x.fillStyle = ['#b07a43', '#9c6a38', '#a9733e', '#a06c3a'][i]; x.fillRect(0, y0 + 2, 256, 60);
        for (var k = 0; k < 14; k++) { x.strokeStyle = 'rgba(70,40,15,' + (0.12 + 0.12 * Math.random()) + ')'; x.lineWidth = 1 + Math.random(); x.beginPath(); var yy = y0 + 6 + Math.random() * 52; x.moveTo(0, yy); for (var u = 0; u <= 256; u += 32) x.lineTo(u, yy + Math.sin(u * 0.03 + k) * 2.5); x.stroke(); }
        x.fillStyle = '#4a2c14'; x.fillRect(0, y0, 256, 3);
      }
      var t = texOf(cv, true); return std({ map: t, roughness: 0.72, bumpMap: t, bumpScale: 1.5 });
    });
    var core = mesh(rbox(s * 0.94, s * 0.94, s * 0.94, 0.03, 2), wood, g);
    // iron bands on every edge and corner caps with rivets
    var iron = mat('darkmetal'), e = 0.075;
    [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) {
      box(s, e, e, 0.015, iron, g, 0, a * (h - e / 2 + 0.01), b * (h - e / 2 + 0.01));
      box(e, s, e, 0.015, iron, g, a * (h - e / 2 + 0.01), 0, b * (h - e / 2 + 0.01));
      box(e, e, s, 0.015, iron, g, a * (h - e / 2 + 0.01), b * (h - e / 2 + 0.01), 0);
    }); });
    [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { [-1, 1].forEach(function (c) { box(0.12, 0.12, 0.12, 0.03, mat('steel'), g, a * (h - 0.05), b * (h - 0.05), c * (h - 0.05)); }); }); });
    // a glowing emblem on each face
    var em = Mt('emblem', function () {
      var cv = canvas(128, 128), x = cv.getContext('2d');
      var gr = x.createRadialGradient(64, 64, 10, 64, 64, 62); gr.addColorStop(0, 'rgba(255,240,180,1)'); gr.addColorStop(0.7, 'rgba(255,190,60,0.9)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(64, 64, 62, 0, PI * 2); x.fill();
      x.fillStyle = '#5a2a08'; x.font = 'bold 88px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 64, 70);
      var t = texOf(cv, true);
      return std({ map: t, emissive: 0xffb84a, emissiveMap: t, emissiveIntensity: 1.6, transparent: true, roughness: 0.3, depthWrite: false });
    });
    var pg = G('emp', function () { return new T.PlaneGeometry(0.42, 0.42); });
    [[0, 0, 1, 0], [0, 0, -1, PI], [1, 0, 0, PI / 2], [-1, 0, 0, -PI / 2]].forEach(function (f) { var p = mesh(pg, em, g, f[0] * (h - 0.005), 0, f[2] * (h - 0.005)); p.rotation.y = f[3]; p.castShadow = false; });
    var top = mesh(pg, em, g, 0, h - 0.005, 0); top.rotation.x = -PI / 2; top.castShadow = false;
    var bot = mesh(pg, em, g, 0, -h + 0.005, 0); bot.rotation.x = PI / 2; bot.castShadow = false;
    g.userData = { size: s };
    return g;
  }
  function coin() {
    var g = G('coin', function () {
      var r = 0.175, pts = [[0.001, 0.022], [r * 0.7, 0.02], [r * 0.78, 0.028], [r * 0.92, 0.032], [r, 0.022], [r, -0.022], [r * 0.92, -0.032], [r * 0.78, -0.028], [r * 0.7, -0.02], [0.001, -0.022]];
      var lg = new T.LatheGeometry(pts.reverse().map(function (p) { return new T.Vector2(p[0], p[1]); }), 32); lg.rotateX(PI / 2); return lg;
    });
    var m = mesh(g, mat('gold'));
    m.material = Mt('coinGold', function () { return std({ color: 0xf4c348, metalness: 1, roughness: 0.18, emissive: 0x3a2400, emissiveIntensity: 0.4 }); });
    var st = G('coinStar', function () {
      var s = new T.Shape(); for (var i = 0; i < 10; i++) { var a = PI / 2 + i * PI / 5, r = i % 2 ? 0.045 : 0.1; if (i) s.lineTo(r * Math.cos(a), r * Math.sin(a)); else s.moveTo(r * Math.cos(a), r * Math.sin(a)); }
      s.closePath(); return creased(new T.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 }), 0.6);
    });
    var a = mesh(st, m.material, m, 0, 0, 0.016), b = mesh(st, m.material, m, 0, 0, -0.016); b.rotation.y = PI;
    m.position.y = 0;
    return m;
  }
  function bee() {
    var g = new T.Group(), bodyG = new T.Group(); g.add(bodyG);
    var stripe = Mt('beeBody', function () {
      var cv = canvas(16, 256), x = cv.getContext('2d');
      x.fillStyle = '#f6c21c'; x.fillRect(0, 0, 16, 256);
      x.fillStyle = '#2a1f14'; [[0, 34], [78, 108], [146, 176], [214, 256]].forEach(function (b) { x.fillRect(0, b[0], 16, b[1] - b[0]); });
      return phys({ map: texOf(cv, true), roughness: 0.6, sheen: 1, sheenColor: new T.Color(0xffe9a0), sheenRoughness: 0.5 });
    });
    var bg = G('beeG', function () { var s = new T.SphereGeometry(1, 28, 20); s.rotateZ(PI / 2); return s; });
    var b = mesh(bg, stripe, bodyG, -0.04, 0, 0); b.scale.set(0.22, 0.17, 0.17);
    var dark = Mt('beeDark', function () { return phys({ color: 0x241a12, roughness: 0.5, sheen: 1, sheenColor: new T.Color(0x806040) }); });
    ball(dark, bodyG, 0.2, 0.03, 0, 0.12, 0.115, 0.125, 24);
    var eye = Mt('beeEye', function () { return phys({ color: 0x0a0a10, roughness: 0.05, clearcoat: 1 }); });
    [-1, 1].forEach(function (sd) {
      ball(eye, bodyG, 0.28, 0.06, sd * 0.055, 0.045, 0.055, 0.04, 16);
      ball(Mt('beeShine', function () { return std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 }); }), bodyG, 0.318, 0.085, sd * 0.06, 0.011);
      ball(Mt('beeCheek', function () { return std({ color: 0xff8a7a, roughness: 0.8 }); }), bodyG, 0.29, -0.01, sd * 0.08, 0.016, 0.012, 0.012);
      tube([[0.25, 0.12, sd * 0.03], [0.29, 0.22, sd * 0.07], [0.35, 0.26, sd * 0.11]], 0.006, dark, bodyG, 12);
      ball(dark, bodyG, 0.355, 0.262, sd * 0.112, 0.018);
      for (var k = 0; k < 3; k++) rod([0.06 - k * 0.07, -0.12, sd * 0.06], [0.08 - k * 0.07, -0.2, sd * 0.09], 0.008, dark, bodyG);
    });
    var sting = mesh(G('sting', function () { var c = new T.ConeGeometry(0.03, 0.09, 10); c.rotateZ(PI / 2); return c; }), dark, bodyG, -0.29, -0.01, 0);
    var wm = Mt('beeWing', function () { return phys({ color: 0xe8f6ff, roughness: 0.15, transparent: true, opacity: 0.45, side: T.DoubleSide, iridescence: 1, iridescenceIOR: 1.5, depthWrite: false }); });
    var wg = G('beeWingG', function () { var c = new T.CircleGeometry(1, 24); c.rotateX(-PI / 2); return c; });
    var wings = [-1, 1].map(function (sd) {
      var p = new T.Group(); p.position.set(0.02, 0.15, sd * 0.05); bodyG.add(p);
      var w1 = mesh(wg, wm, p, -0.04, 0.01, sd * 0.16); w1.scale.set(0.09, 1, 0.17); w1.rotation.y = sd * 0.35; w1.castShadow = false;
      var w2 = mesh(wg, wm, p, -0.1, 0.0, sd * 0.1); w2.scale.set(0.06, 1, 0.11); w2.rotation.y = sd * 0.7; w2.castShadow = false;
      p.userData.side = sd;
      return p;
    });
    g.userData = { wings: wings, body: bodyG, flap: function (t) { wings.forEach(function (p) { p.rotation.x = p.userData.side * (0.2 + 0.55 * Math.sin(t * 40)); }); } };
    return g;
  }
  function goo() {
    var gm = Mt('goo', function () { return phys({ color: 0x2e9418, roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x0a2e04, emissiveIntensity: 0.6 }); });
    var g = G('gooG', function () {
      var s = new T.Shape(), n = 64;
      for (var i = 0; i <= n; i++) { var a = i / n * PI * 2, r = 0.72 + 0.06 * Math.sin(a * 5 + 0.7) + 0.04 * Math.sin(a * 3 + 2) + 0.025 * Math.sin(a * 11); if (i) s.lineTo(r * Math.cos(a), r * Math.sin(a)); else s.moveTo(r * Math.cos(a), r * Math.sin(a)); }
      var e = new T.ExtrudeGeometry(s, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.07, bevelOffset: -0.07, bevelSegments: 5, curveSegments: 1 });
      e.rotateX(-PI / 2);
      var p = e.attributes.position; for (var k = 0; k < p.count; k++) p.setY(k, Math.max(0, p.getY(k)) * 0.6);
      return creased(e, 1.0);
    });
    var m = new T.Mesh(g, gm); m.position.y = 0.01; m.receiveShadow = true;
    [[0.25, 0.1, 0.07], [-0.3, -0.2, 0.05], [0.05, -0.35, 0.04], [-0.1, 0.32, 0.06], [0.42, -0.18, 0.035]].forEach(function (b) {
      var o = ball(gm, m, b[0], 0.02, b[1], b[2], b[2] * 0.7, b[2], 14); o.castShadow = false;
    });
    return m;
  }

  // ---------- the kid ----------
  var KP = { cap: '#b84a38', capDark: '#7e2e24', strap: '#3e3028', lens: '#7fb0b4', hair: '#8a4e2a', skin: '#f0c49c', eye: '#2a1e24',
    mouth: '#a85a4a', scarf: '#e0aa4e', jacket: '#4a6c80', shirt: '#e8dcc0', glove: '#7a5236', trousers: '#5e4838', boot: '#3a2a22' };
  function kid() {
    var g = new T.Group(), root = new T.Group(); g.add(root);
    function cloth(hex, side) { return Mt('k' + hex + (side || ''), function () { return phys({ color: new T.Color(hex), roughness: 0.85, sheen: 0.6, sheenColor: new T.Color(shade(hex, 1.5)), side: side ? T.DoubleSide : T.FrontSide }); }); }
    var skin = Mt('kskin', function () { return phys({ color: new T.Color(KP.skin), roughness: 0.6, sheen: 0.4, sheenColor: new T.Color('#ffc8b0') }); });
    // a limb from its joint down: a capsule whose rounded ends overlap the joints above and below
    function limb(m, parent, y, r, len) { return mesh(G('kl' + r + ',' + len, function () { return new T.CapsuleGeometry(r, len, 4, 10); }), m, parent, 0, y, 0); }
    // legs: hip > thigh, knee > shin, boot
    var legs = [-1, 1].map(function (sd) {
      var hip = new T.Group(); hip.position.set(0, 0.5, sd * 0.072); root.add(hip);
      limb(cloth(KP.trousers), hip, -0.125, 0.058, 0.25);
      var knee = new T.Group(); knee.position.set(0, -0.25, 0); hip.add(knee);
      limb(cloth(KP.trousers), knee, -0.1, 0.053, 0.17);
      box(0.17, 0.08, 0.095, 0.035, cloth(KP.boot), knee, 0.03, -0.21, 0);
      box(0.18, 0.02, 0.1, 0.008, mattMat('#1e1612'), knee, 0.03, -0.245, 0);
      hip.userData.knee = knee; return hip;
    });
    // torso: trousers at the hips, a shirt, an open jacket (a lathe with a gap at the front), the scarf
    var torso = new T.Group(); torso.position.y = 0.46; root.add(torso);
    var hips = mesh(G('khip', function () { return new T.CylinderGeometry(0.12, 0.125, 0.12, 16); }), cloth(KP.trousers), torso, 0, 0.04, 0); hips.scale.set(0.82, 1, 1);
    var shirt = mesh(G('kshirt', function () { return new T.LatheGeometry([[0.001, 0.34], [0.07, 0.33], [0.115, 0.27], [0.125, 0.15], [0.118, 0.05], [0.001, 0.04]].reverse().map(function (p) { return new T.Vector2(p[0], p[1]); }), 18); }), cloth(KP.shirt), torso);
    shirt.scale.set(0.8, 1, 1);
    var jk = mesh(G('kjacket', function () {
      return new T.LatheGeometry([[0.13, 0.0], [0.135, 0.1], [0.138, 0.2], [0.132, 0.28], [0.1, 0.34], [0.06, 0.365]].map(function (p) { return new T.Vector2(p[0], p[1]); }), 20, PI / 2 + 0.32, PI * 2 - 0.64);
    }), cloth(KP.jacket, true), torso, 0, 0.02, 0);
    jk.scale.set(0.86, 1, 1);
    // jacket hem and zip edges
    var hem = mesh(G('khem', function () { return new T.TorusGeometry(0.133, 0.014, 6, 20, PI * 2 - 0.64); }), cloth(shade(KP.jacket, 0.8)), torso, 0, 0.03, 0);
    hem.rotation.set(PI / 2, 0, -PI / 2 + 0.32); hem.rotation.order = 'XYZ'; hem.scale.set(0.86, 1, 1);
    [-1, 1].forEach(function (sd) { rod([0.12, 0.03, sd * 0.042], [0.09, 0.32, sd * 0.03], 0.012, cloth(shade(KP.jacket, 0.8)), torso); });
    var scarf = mesh(G('kscarf', function () { return new T.TorusGeometry(0.075, 0.035, 8, 18); }), cloth(KP.scarf), torso, 0, 0.36, 0); scarf.rotation.x = PI / 2;
    var tail = box(0.05, 0.16, 0.06, 0.02, cloth(KP.scarf), torso, 0.07, 0.27, 0.06); tail.rotation.set(0.1, 0, 0.15);
    box(0.012, 0.012, 0.062, 0.004, cloth(shade(KP.scarf, 0.7)), torso, 0.07, 0.24, 0.06).rotation.set(0.1, 0, 0.15);
    // arms: shoulder > upper arm, elbow > forearm, glove
    var arms = [-1, 1].map(function (sd) {
      var sh = new T.Group(); sh.position.set(0, 0.3, sd * 0.15); torso.add(sh);
      ball(cloth(KP.jacket), sh, 0, 0, 0, 0.055);
      limb(cloth(KP.jacket), sh, -0.08, 0.046, 0.16);
      var el = new T.Group(); el.position.set(0, -0.16, 0); el.rotation.z = 0.25; sh.add(el);
      limb(cloth(KP.jacket), el, -0.065, 0.041, 0.13);
      box(0.012, 0.03, 0.09, 0.006, cloth(shade(KP.jacket, 0.8)), el, 0, -0.12, 0).scale.set(1, 1, 1);
      ball(cloth(KP.glove), el, 0.0, -0.15, 0, 0.042, 0.05, 0.04);
      sh.rotation.x = -sd * 0.08; sh.userData.elbow = el;
      return sh;
    });
    // head: face, hair, the cap with goggles on the band
    var head = new T.Group(); head.position.set(0, 0.38, 0); torso.add(head);
    ball(skin, head, 0, 0.03, 0, 0.04, 0.05, 0.04); // neck
    ball(skin, head, 0.005, 0.14, 0, 0.128, 0.13, 0.124, 24);
    [-1, 1].forEach(function (sd) {
      ball(skin, head, -0.005, 0.13, sd * 0.123, 0.025, 0.035, 0.018, 10);
      var eyeW = ball(Mt('keyeW', function () { return std({ color: 0xf4ecdc, roughness: 0.3 }); }), head, 0.112, 0.145, sd * 0.045, 0.012, 0.024, 0.02, 12);
      ball(Mt('keye', function () { return phys({ color: new T.Color(KP.eye), roughness: 0.1, clearcoat: 1 }); }), head, 0.12, 0.143, sd * 0.045, 0.008, 0.018, 0.014, 12);
      ball(Mt('kshine', function () { return std({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 }); }), head, 0.127, 0.152, sd * 0.04, 0.003);
      ball(Mt('kcheek', function () { return std({ color: 0xf0a08a, roughness: 0.8, transparent: true, opacity: 0.6 }); }), head, 0.1, 0.1, sd * 0.075, 0.006, 0.018, 0.026, 10);
      rod([0.118, 0.178, sd * 0.07], [0.122, 0.181, sd * 0.025], 0.006, cloth(KP.hair), head); // brows
    });
    ball(skin, head, 0.13, 0.12, 0, 0.018, 0.016, 0.018, 10);
    var mouth = box(0.01, 0.008, 0.035, 0.004, mattMat(KP.mouth), head, 0.118, 0.085, 0); mouth.rotation.y = 0;
    var hair = mesh(G('khair', function () { return new T.SphereGeometry(1, 22, 14, 0, PI * 2, 0, PI * 0.62); }), cloth(KP.hair), head, -0.012, 0.15, 0);
    hair.scale.set(0.134, 0.138, 0.132); hair.rotation.z = 0.55;
    [-1, 0, 1].forEach(function (k) { var f = ball(cloth(KP.hair), head, 0.095, 0.215, k * 0.045, 0.03, 0.02, 0.03, 10); f.rotation.z = -0.5; });
    [-1, 1].forEach(function (sd) { ball(cloth(KP.hair), head, 0.035, 0.155, sd * 0.112, 0.03, 0.045, 0.016, 10); });
    var crown = mesh(G('kcrown', function () { return new T.SphereGeometry(1, 22, 10, 0, PI * 2, 0, PI / 2); }), cloth(KP.cap), head, -0.005, 0.2, 0); crown.scale.set(0.138, 0.1, 0.136);
    mesh(cyl(22), cloth(KP.capDark), head, -0.005, 0.2, 0).scale.set(0.139, 0.02, 0.137);
    var brim = mesh(G('kbrim', function () { return new T.CylinderGeometry(1, 1, 1, 20, 1, false, 0, PI); }), cloth(KP.capDark), head, 0.06, 0.195, 0);
    brim.scale.set(0.13, 0.012, 0.12); brim.rotation.set(0, PI / 2 - PI / 2, -0.12);
    ball(cloth(KP.capDark), head, -0.005, 0.3, 0, 0.016, 0.01, 0.016); // button
    var strap = mesh(G('kstrap', function () { return new T.TorusGeometry(1, 0.1, 6, 24); }), mattMat(KP.strap), head, -0.005, 0.225, 0); strap.rotation.x = PI / 2; strap.scale.set(0.141, 0.139, 0.14);
    var lens = Mt('klens', function () { return phys({ color: new T.Color(KP.lens), roughness: 0.05, metalness: 0.3, clearcoat: 1 }); });
    [-1, 1].forEach(function (sd) {
      var gg = new T.Group(); gg.position.set(0.1, 0.24, sd * 0.045); gg.rotation.set(0, 0, -0.35); head.add(gg);
      var ring = mesh(G('kgring', function () { return new T.TorusGeometry(0.03, 0.009, 6, 16); }), mat('alu'), gg); ring.rotation.y = PI / 2;
      ball(lens, gg, 0.003, 0, 0, 0.012, 0.028, 0.028, 14);
    });
    root.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    var base = { ty: torso.position.y };
    g.userData = {
      legs: legs, arms: arms, head: head, torso: torso,
      anim: function (t, moving) {
        if (moving) {
          var ph = t * 9, s = Math.sin(ph), c = Math.cos(ph);
          legs[0].rotation.z = s * 0.55; legs[1].rotation.z = -s * 0.55;
          legs[0].userData.knee.rotation.z = -Math.max(0, -c) * 0.9; legs[1].userData.knee.rotation.z = -Math.max(0, c) * 0.9;
          arms[0].rotation.z = -s * 0.6; arms[1].rotation.z = s * 0.6;
          arms[0].userData.elbow.rotation.z = 0.35 + Math.max(0, -s) * 0.4; arms[1].userData.elbow.rotation.z = 0.35 + Math.max(0, s) * 0.4;
          torso.position.y = base.ty + Math.abs(c) * 0.025 - 0.012; torso.rotation.z = -0.06; torso.rotation.x = s * 0.04;
          head.rotation.z = 0.04; head.rotation.x = -s * 0.03;
        } else {
          var b = Math.sin(t * 2.2);
          legs.forEach(function (l) { l.rotation.z *= 0.8; l.userData.knee.rotation.z *= 0.8; });
          arms.forEach(function (a, i) { a.rotation.z = a.rotation.z * 0.85 + 0.02 * b * 0.15; a.userData.elbow.rotation.z = 0.25 + 0.04 * b; });
          torso.position.y = base.ty + 0.006 * b; torso.rotation.z *= 0.85; torso.rotation.x *= 0.85;
          head.rotation.z = 0.03 * Math.sin(t * 0.9); head.rotation.x = 0.04 * Math.sin(t * 0.6);
        }
      }
    };
    return g;
  }

  // ---------- environment ----------
  // a soft studio with a bright sky panel and warm side panels (after three's RoomEnvironment), as a PMREM texture
  var envs = [];
  function envScene() {
    var s = new T.Scene(), geo = new T.BoxGeometry(); geo.deleteAttribute('uv');
    var room = new T.Mesh(geo, std({ side: T.BackSide, color: 0x9aa4ae })); room.position.set(-0.757, 13.219, 0.717); room.scale.set(31.713, 28.305, 28.591); s.add(room);
    var floor = new T.Mesh(geo, std({ color: 0x5e6a4c })); floor.position.set(0, -1.2, 0); floor.scale.set(30, 0.5, 30); s.add(floor);
    var bm = std({ color: 0x808080 });
    [[-10.906, 2.009, 1.846, -0.195, 2.328, 7.905, 4.651], [-5.607, -0.754, -0.758, 0.994, 1.97, 1.534, 3.955], [6.167, 0.857, 7.803, 0.561, 3.927, 6.285, 3.687],
     [-2.017, 0.018, 6.124, 0.333, 2.002, 4.566, 2.064], [2.291, -0.756, -2.621, -0.286, 1.546, 1.552, 1.496], [-2.193, -0.369, -5.547, 0.516, 3.875, 3.487, 2.986]].forEach(function (b) {
      var m = new T.Mesh(geo, bm); m.position.set(b[0], b[1], b[2]); m.rotation.y = b[3]; m.scale.set(b[4], b[5], b[6]); s.add(m);
    });
    s.add(new T.PointLight(0xffffff, 900, 28, 2)).children[s.children.length - 1].position.set(0.418, 16.199, 0.3);
    function panel(col, k, p, sc) { var m = new T.Mesh(geo, new T.MeshBasicMaterial({ color: new T.Color(col).multiplyScalar(k) })); m.position.set(p[0], p[1], p[2]); m.scale.set(sc[0], sc[1], sc[2]); s.add(m); }
    panel(0xfff2e0, 50, [-16.116, 14.37, 8.208], [0.1, 2.428, 2.739]);
    panel(0xfff2e0, 50, [-16.109, 18.021, -8.207], [0.1, 2.425, 2.751]);
    panel(0xffffff, 17, [14.904, 12.198, -1.832], [0.15, 4.265, 6.331]);
    panel(0xffe8cc, 43, [-0.462, 8.89, 14.52], [4.38, 5.441, 0.088]);
    panel(0xdfeaff, 20, [3.235, 11.486, -12.541], [2.5, 2.0, 0.1]);
    panel(0xd8e8ff, 100, [0, 20, 0], [6, 0.1, 6]);
    return s;
  }
  function envMap(renderer) {
    for (var i = 0; i < envs.length; i++) if (envs[i].r === renderer) return envs[i].t;
    var pm = new T.PMREMGenerator(renderer), sc = envScene(), t = pm.fromScene(sc, 0.04).texture;
    pm.dispose(); sc.traverse(function (o) { if (o.isMesh) { o.material.dispose(); } }); sc.children[0].geometry.dispose();
    envs.push({ r: renderer, t: t });
    return t;
  }

  // ---------- previews ----------
  var pv = null, previews = {};
  function previewKit() {
    if (pv) return pv.ok ? pv : null;
    pv = { ok: false };
    try {
      var r = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      r.setPixelRatio(1); r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
      r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap; r.setClearColor(0x000000, 0);
      var scene = new T.Scene(); scene.environment = envMap(r);
      var sun = new T.DirectionalLight(0xfff1dc, 2.2); sun.position.set(3, 6, 2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      var sc = sun.shadow.camera; sc.left = -2; sc.right = 2; sc.top = 2; sc.bottom = -2; sc.near = 0.5; sc.far = 15; sun.shadow.radius = 4; sun.shadow.bias = -0.0005;
      scene.add(sun); scene.add(new T.HemisphereLight(0xdfeeff, 0x6a5a40, 0.4));
      var ground = new T.Mesh(new T.PlaneGeometry(8, 8), new T.ShadowMaterial({ opacity: 0.35 })); ground.rotation.x = -PI / 2; ground.receiveShadow = true; scene.add(ground);
      pv = { ok: true, r: r, scene: scene, cam: new T.PerspectiveCamera(26, 1, 0.05, 50) };
      return pv;
    } catch (e) { return null; }
  }
  function preview(id, look, heading, w, h) {
    look = lookOf(id, look); w = w || 240; h = h || 160; heading = heading || 0;
    var key = [id, look.paint, look.trim, look.wheels, look.spoiler, look.exhaust, heading.toFixed(3), w, h].join('|');
    if (previews[key]) return previews[key];
    var kit = previewKit(); if (!kit) return null;
    var c = car(id, look); c.rotation.y = -heading; kit.scene.add(c);
    var cam = kit.cam, box3 = new T.Box3().setFromObject(c.userData.body);
    c.userData.wheels.forEach(function (w) { box3.expandByObject(w.pivot); });
    var bs = box3.getBoundingSphere(new T.Sphere());
    cam.aspect = w / h; cam.updateProjectionMatrix();
    var fov = cam.fov * PI / 180, fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * cam.aspect)), dist = bs.radius / Math.sin(fit / 2) * 0.92;
    var dir = V(1, 0.62, 1).normalize();
    cam.position.copy(bs.center).addScaledVector(dir, dist); cam.lookAt(bs.center);
    kit.r.setSize(w, h, false); kit.r.render(kit.scene, cam);
    var out = canvas(w, h); out.getContext('2d').drawImage(kit.r.domElement, 0, 0);
    kit.scene.remove(c); c.userData.dispose();
    previews[key] = out;
    return out;
  }

  var api = { car: car, crate: crate, coin: coin, bee: bee, goo: goo, kid: kid, preview: preview, envMap: envMap, _tris: triCount, _lookOf: lookOf, _geo: GEO };
  return api;
})();
