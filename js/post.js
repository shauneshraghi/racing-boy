// Racing Boy: HD-2D post-process (RBPost), grown from Dig Through Worlds' version. The 2D renderer draws the pixel-art
// scene and a half-size emissive layer into offscreen canvases; this WebGL2 pass upscales the scene with hard pixels,
// blurs it with a depth of field (a screen band on the plaza, a per-pixel depth buffer in races), adds distance fog,
// drifting cloud shadows, sun shafts, screen-space point lights and bloom, and grades the colours (warm highlights,
// cool shadows, vignette, a little grain). Boosting adds a radial speed blur and a colour fringe. init() returns
// false when WebGL2 is unavailable, and the renderer then draws straight to the visible canvas instead.
var RBPost = (function () {
  'use strict';
  var MAXL = 24, DMAX = 160; // depth buffer: red = sqrt(depth / DMAX), so near depths get the finer steps
  var gl = null, prog = {}, vbo, tex = {}, fb = {}, W = 0, H = 0, SW = 0, SH = 0;

  var VS = '#version 300 es\nin vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  var HEAD = '#version 300 es\nprecision highp float; in vec2 uv; out vec4 o;\n';
  var FS = {
    copy: HEAD + 'uniform sampler2D t; void main() { o = texture(t, uv); }',
    // the scene with its near circle of confusion in alpha, so the blur chain spreads a near object's blur past its
    // own silhouette (near-field bleed). Only things standing up count, not the ground (nearer than the ground in
    // their row, from gc = f, camY, horizon row, scene height), so the soft ground at the bottom of the view does not
    // creep up the player's car; open sky and the plaza (no depth buffer) carry none
    near: HEAD + 'uniform sampler2D t, dep; uniform int hasDep; uniform vec2 nr; uniform vec4 gc; void main() {' +
      ' float a = 0.0; if (hasDep == 1) { float v = texture(dep, uv).r; float d = v * v * ' + DMAX.toFixed(1) + ';' +
      '   float row = floor((1.0 - uv.y) * gc.w) - gc.z; float zg = row > 0.0 ? gc.x * gc.y / (row + 0.5) : 1e9;' +
      '   a = v > 0.995 || d > zg * 0.93 ? 0.0 : 1.0 - smoothstep(nr.x, nr.y, d); }' +
      ' o = vec4(texture(t, uv).rgb, a); }',
    // 9-tap gaussian folded into 5 linear samples; dir is one step in uv
    blur: HEAD + 'uniform sampler2D t; uniform vec2 dir; void main() {' +
      ' vec4 c = texture(t, uv) * 0.2270270;' +
      ' c += (texture(t, uv + dir * 1.3846154) + texture(t, uv - dir * 1.3846154)) * 0.3162162;' +
      ' c += (texture(t, uv + dir * 3.2307692) + texture(t, uv - dir * 3.2307692)) * 0.0702703;' +
      ' o = c; }',
    // bloom source: the emissive layer plus anything in the scene brighter than the threshold
    bright: HEAD + 'uniform sampler2D s; uniform sampler2D e; uniform float thr; void main() {' +
      ' vec3 c = texture(s, uv).rgb; float l = dot(c, vec3(0.299, 0.587, 0.114));' +
      ' o = vec4(texture(e, uv).rgb + c * clamp((l - thr) / max(0.001, 1.0 - thr), 0.0, 1.0) * 0.5, 1.0); }',
    // sun shafts: march from each pixel toward the sun, gathering bright open sky; trees and buildings block it
    shafts: HEAD + 'uniform sampler2D s, dep; uniform vec2 sun; uniform vec3 col; void main() {' +
      ' vec2 st = (sun - uv) / 32.0; vec2 q = uv; float w = 1.0, acc = 0.0;' +
      ' for (int i = 0; i < 32; i++) { float sky = step(0.995, texture(dep, q).r); float l = dot(texture(s, q).rgb, vec3(0.299, 0.587, 0.114));' +
      '   acc += sky * smoothstep(0.86, 1.0, l) * w; w *= 0.955; q += st; }' +
      ' float fall = 1.0 - smoothstep(0.0, 0.9, length((sun - uv) * vec2(1.6, 1.0)));' +
      ' o = vec4(col * acc / 14.0 * fall, 1.0); }',
    final: HEAD +
      'uniform sampler2D s, hb, qb, eb, bl, dep, sh; uniform vec2 res, sres; uniform float time;\n' +
      'uniform vec4 L[' + MAXL + ']; uniform vec3 LC[' + MAXL + ']; uniform int nL;\n' +
      'uniform vec3 amb; uniform vec4 focus; uniform float bloomK, sat, vig, caustic;\n' +
      'uniform vec3 shadowTint, hiTint;\n' +
      'uniform int hasDep; uniform vec4 dof; uniform vec2 dofK; uniform float skyK; uniform vec3 fogCol, fog;\n' +
      'uniform vec4 camA, camB; uniform float cloudK; uniform vec2 wind; uniform float shaftK, speedK, grain;\n' +
      'uniform int iso; uniform vec2 dap, carD; uniform vec3 dapCol, lift; uniform vec2 tone;\n' +
      'vec3 knee(vec3 c) { vec3 e = max(c - 0.82, 0.0); return min(c, 0.82) + e / (1.0 + e / 0.18); }\n' +
      'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
      'float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n' +
      '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }\n' +
      'float depthAt(vec2 q) { float v = texture(dep, q).r; return v * v * ' + DMAX.toFixed(1) + '; }\n' +
      // circle of confusion: the plaza blurs outside a screen band [focus.x, focus.y] over focus.z pixels; races blur
      // nearer than dof.y (fully by dof.x) and farther than dof.z (fully by dof.w), scaled by dofK (near, far)
      'float cocAt(vec2 q) {\n' +
      '  if (hasDep == 0) { float y = (1.0 - q.y) * res.y; return clamp(max(focus.x - y, y - focus.y) / focus.z, 0.0, 1.0) * focus.w; }\n' +
      '  if (texture(dep, q).r > 0.995) return skyK;\n' + // open sky stays only a little soft, so clouds and the sun read
      '  float d = depthAt(q); return max((1.0 - smoothstep(dof.x, dof.y, d)) * dofK.x, smoothstep(dof.z, dof.w, d) * dofK.y); }\n' +
      // coc 0..1 runs sharp -> half -> quarter blur, 1..2 on to the eighth-size blur (near objects and the plaza);
      // near bleed: a pixel next to something near takes that thing's spread-out blur, so its edge goes soft too
      'bool standing(vec2 q) { float row = floor((1.0 - q.y) * sres.y) - camB.z; return row <= 0.0 || depthAt(q) < camB.x * camB.y / (row + 0.5) * 0.93; }\n' +
      'vec3 dofAt(vec2 q) { float coc = cocAt(q); vec3 c = texture(s, q).rgb;\n' +
      // (not onto the cars round the player's distance carD.x ± carD.y, so the player's car stays sharp past a near tree)
      '  vec4 e = texture(eb, q); if (hasDep == 1 && e.a > 0.0 && !(abs(depthAt(q) - carD.x) < carD.y && standing(q))) coc = max(coc, min(1.0, e.a * 2.2) * dofK.x);\n' +
      '  if (coc > 0.0) { vec3 h = texture(hb, q).rgb, b = texture(qb, q).rgb;\n' +
      '    c = coc < 0.5 ? mix(c, h, coc * 2.0) : coc < 1.0 ? mix(h, b, coc * 2.0 - 1.0) : mix(b, e.rgb, min(1.0, (coc - 1.0) * 1.8)); }\n' +
      '  return c; }\n' +
      'void main() {\n' +
      '  vec2 px = vec2(uv.x * res.x, (1.0 - uv.y) * res.y);\n' +
      '  vec3 c;\n' +
      // boost: a colour fringe and a radial blur that grow toward the edges
      '  if (speedK > 0.0) { vec2 dv = uv - vec2(0.5, 0.45); float ca = speedK * 0.007;\n' +
      '    c = vec3(dofAt(uv + dv * ca).r, dofAt(uv).g, dofAt(uv - dv * ca).b);\n' +
      '    vec3 z = vec3(0.0); for (int i = 1; i <= 6; i++) z += texture(hb, uv - dv * float(i) * 0.018 * speedK).rgb;\n' +
      '    c = mix(c, z / 6.0, clamp(speedK * smoothstep(0.12, 0.55, length(dv)), 0.0, 0.85)); }\n' +
      '  else c = dofAt(uv);\n' +
      '  bool world = hasDep == 1 && texture(dep, uv).r < 0.995; float d = hasDep == 1 ? depthAt(uv) : 0.0;\n' +
      // the world point under this pixel. Races: camera forward camA.zw, right = (-fz, fx); camB = f, camY, y0, cx.
      // The plaza (iso): camA = origin x, y, half-tile width, height in canvas pixels, as RBRender.screenToWorld
      // under a blurred near thing the cloud shadows and dapple fade out, or they would print its sharp silhouette
      '  vec2 w = vec2(0.0); float nearF = hasDep == 1 ? 1.0 - min(1.0, texture(eb, uv).a * 4.0) : 1.0, dapF = nearF;\n' +
      '  if (world) { float sx = uv.x * sres.x; float lat = (sx - camB.w) * d / camB.x; w = camA.xy + camA.zw * d + vec2(-camA.w, camA.z) * lat;\n' +
      '    dapF *= 1.0 - smoothstep(25.0, 60.0, d); }\n' +
      '  else if (iso == 1) { float a = (px.x - camA.x) / camA.z, b = (px.y - camA.y) / camA.w; w = vec2(a + b, b - a) * 0.5; world = true; }\n' +
      // cloud shadows drifting over everything, and dappled light: warm pools and soft leaf shade that sway a little
      '  if (world && cloudK > 0.0) {\n' +
      '    float n = vnoise(w * 0.03 + wind * time) * 0.65 + vnoise(w * 0.08 - wind * time * 1.4 + 7.0) * 0.35;\n' +
      '    c *= 1.0 - cloudK * nearF * smoothstep(0.52, 0.64, n); }\n' +
      '  if (world && dap.x > 0.0) { vec2 sw = vec2(sin(time * 0.6), cos(time * 0.45)) * 0.06;\n' +
      '    float n = vnoise(w * dap.y + sw);\n' +
      '    c *= mix(vec3(1.0), mix(vec3(0.72, 0.78, 0.8), dapCol, smoothstep(0.38, 0.62, n)), dap.x * dapF); }\n' +
      // lighting: ambient plus screen-space point lights (xy = centre, z = radius, w = intensity)
      '  vec3 lit = amb;\n' +
      '  for (int i = 0; i < ' + MAXL + '; i++) { if (i >= nL) break;\n' +
      '    float r = length((px - L[i].xy) * vec2(1.0, 1.35)) / L[i].z; float f = max(0.0, 1.0 - r * r); lit += LC[i] * (f * f * L[i].w); }\n' +
      '  c *= lit;\n' +
      '  if (caustic > 0.0) { vec2 q = px / res.y * 9.0; float k = sin(q.x * 1.7 + time * 1.3 + sin(q.y * 1.3 + time)) * sin(q.y * 1.9 - time * 1.1 + sin(q.x * 0.9 - time * 0.7));\n' +
      '    c += c * caustic * smoothstep(0.55, 1.0, k); }\n' +
      // aerial perspective: far things fade toward the haze colour (the sky keeps its own gradient)
      '  if (world) c = mix(c, fogCol, smoothstep(fog.x, fog.y, d) * fog.z);\n' +
      '  if (shaftK > 0.0) c += texture(sh, uv).rgb * shaftK;\n' +
      '  c += texture(bl, uv).rgb * bloomK;\n' +
      // low-key tone curve: a gamma above 1 sinks the mid-tones and shadows so lit pools stand out (tone = gamma, exposure)
      '  c = pow(max(c, 0.0), vec3(tone.x)) * tone.y;\n' +
      '  float l = dot(c, vec3(0.299, 0.587, 0.114));\n' +
      '  c = mix(vec3(l), c, sat);\n' +
      '  c *= mix(shadowTint, hiTint, smoothstep(0.05, 0.75, l));\n' +
      '  c += lift * (1.0 - smoothstep(0.0, 0.45, l));\n' +
      '  c = knee(c);\n' +
      '  vec2 v = (uv - 0.5) * vec2(res.x / res.y, 1.0) * 0.9; c *= 1.0 - vig * smoothstep(0.35, 1.05, length(v));\n' +
      '  if (grain > 0.0) c += (hash(floor(px / 2.0) + fract(time * 7.0) * 61.0) - 0.5) * grain;\n' +
      '  o = vec4(c, 1.0);\n' +
      '}'
  };

  function compile(type, src) {
    var sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) { var a = gl.getActiveUniform(p, i), nm = a.name.replace(/\[0\]$/, ''); u[nm] = gl.getUniformLocation(p, a.name); }
    return { p: p, u: u };
  }
  function mkTex(nearest) {
    var t = gl.createTexture(), f = nearest ? gl.NEAREST : gl.LINEAR; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function mkFb(w, h) {
    var t = mkTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { f: f, t: t, w: w, h: h };
  }
  // the blur targets follow the scene's size (full-size on the plaza, the small race buffer in races)
  function sizeTo(w, h) {
    W = gl.canvas.width; H = gl.canvas.height;
    if (w === SW && h === SH) return;
    SW = w; SH = h;
    Object.keys(fb).forEach(function (k) { gl.deleteFramebuffer(fb[k].f); gl.deleteTexture(fb[k].t); });
    var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
    fb = { h1: mkFb(hw, hh), h2: mkFb(hw, hh), q1: mkFb(qw, qh), q2: mkFb(qw, qh), e1: mkFb(ew, eh), e2: mkFb(ew, eh),
      b1: mkFb(qw, qh), b2: mkFb(qw, qh), s1: mkFb(qw, qh), s2: mkFb(qw, qh) };
  }
  function pass(pr, target, binds, set) {
    gl.useProgram(pr.p);
    if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.f); gl.viewport(0, 0, target.w, target.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); }
    var unit = 0;
    Object.keys(binds).forEach(function (name) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, binds[name]); gl.uniform1i(pr.u[name], unit); unit++; });
    if (set) set(pr.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function blur(src, tmp, radius) { // separable blur, src -> tmp -> src
    pass(prog.blur, tmp, { t: src.t }, function (u) { gl.uniform2f(u.dir, radius / src.w, 0); });
    pass(prog.blur, src, { t: tmp.t }, function (u) { gl.uniform2f(u.dir, 0, radius / tmp.h); });
  }
  function upload(t, canvas) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  return {
    MAXL: MAXL, DMAX: DMAX,
    // Try a throwaway canvas first: once the visible canvas holds a WebGL context it can no longer fall
    // back to 2D, so a shader that fails to compile must fail there.
    init: function (canvas) { return setup(document.createElement('canvas')) && setup(canvas); },
    render: render
  };
  function setup(canvas) {
    try {
      gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
      if (!gl) return false;
      Object.keys(FS).forEach(function (k) { prog[k] = program(FS[k]); });
      vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      tex.scene = mkTex(true); tex.emit = mkTex(); tex.dep = mkTex(true);
      return true;
    } catch (e) { console.warn('HD-2D post-process off:', e.message); gl = null; return false; }
  }
  // p: { lights: [{x, y, r, i, c: [r, g, b]}], amb: [r, g, b], focus: [top, bottom, ramp, strength],
  //      bloom, thr, sat, vig, caustic, shadowTint, hiTint, lift (added to the darkest tones), tone: [gamma, exposure], time, scale (blur radius in scene texels),
  //      carD: [depth, half-window] of the player's car, which near blur never bleeds onto,
  //      dapple: [strength, cells^-1 frequency] and dapCol (the lit pools' tint) for dappled light on the world,
  //      cloud and wind for cloud shadows; on the plaza iso: [ox, oy, hw, hh] (canvas pixels) places the world under each pixel,
  //      and for races: depth (canvas, same size as the scene), dof: [nearFull, nearSharp, farSharp, farFull],
  //      dofK: [near, far], skyK (blur of open sky), fogCol, fog: [start, end, max], cam: [x, z, fx, fz, f, camY, y0, cx] (scene pixels),
  //      cloud, wind: [x, z], sun: [x, y] (canvas pixels) or null, shaft, shaftCol, speed, grain },
  // positions in canvas pixels; the scene may be smaller than the canvas and is scaled up with hard pixels
  function render(scene, emit, p) {
    sizeTo(scene.width, scene.height);
    var k = p.scale || 1, hasDep = !!p.depth;
    upload(tex.scene, scene); upload(tex.emit, emit);
    if (hasDep) upload(tex.dep, p.depth);
    // depth-of-field sources: half-, quarter- and eighth-size blurs of the scene, carrying the near CoC in alpha
    var nr = p.dof ? [p.dof[0], p.dof[1]] : [0, 1];
    pass(prog.near, fb.h1, { t: tex.scene, dep: tex.dep }, function (u) { gl.uniform1i(u.hasDep, hasDep ? 1 : 0); gl.uniform2fv(u.nr, nr);
      var cm = p.cam || [0, 0, 1, 0, 1, 1, 0, 0]; gl.uniform4f(u.gc, cm[4], cm[5], cm[6], SH); });
    blur(fb.h1, fb.h2, 1.25 * k);
    pass(prog.copy, fb.q1, { t: fb.h1.t });
    blur(fb.q1, fb.q2, 2.0 * k);
    pass(prog.copy, fb.e1, { t: fb.q1.t });
    blur(fb.e1, fb.e2, 1.5 * k); blur(fb.e1, fb.e2, 2.5 * k);
    // bloom: bright parts, blurred twice at quarter size
    pass(prog.bright, fb.b1, { s: fb.h1.t, e: tex.emit }, function (u) { gl.uniform1f(u.thr, p.thr); });
    blur(fb.b1, fb.b2, 1.5 * k); blur(fb.b1, fb.b2, 3.5 * k);
    var shaft = hasDep && p.sun && p.shaft > 0 ? p.shaft : 0;
    if (shaft) {
      pass(prog.shafts, fb.s1, { s: fb.h1.t, dep: tex.dep }, function (u) { gl.uniform2f(u.sun, p.sun[0] / W, 1 - p.sun[1] / H); gl.uniform3fv(u.col, p.shaftCol); });
      blur(fb.s1, fb.s2, 1.0 * k);
    }
    var Ls = new Float32Array(MAXL * 4), LC = new Float32Array(MAXL * 3), n = Math.min(MAXL, p.lights.length);
    for (var i = 0; i < n; i++) {
      var l = p.lights[i]; Ls.set([l.x, l.y, l.r, l.i], i * 4); LC.set(l.c, i * 3);
    }
    var cam = p.cam || [0, 0, 1, 0, 1, 1, 0, 0];
    var dap = p.dapple || [0, 0.3], iso = p.iso || null;
    if (iso) cam = [iso[0], iso[1], iso[2], iso[3], 1, 1, 0, 0];
    pass(prog.final, null, { s: tex.scene, hb: fb.h1.t, qb: fb.q1.t, eb: fb.e1.t, bl: fb.b1.t, dep: tex.dep, sh: fb.s1.t }, function (u) {
      gl.uniform2f(u.res, W, H); gl.uniform2f(u.sres, SW, SH); gl.uniform1f(u.time, p.time);
      gl.uniform4fv(u.L, Ls); gl.uniform3fv(u.LC, LC); gl.uniform1i(u.nL, n);
      gl.uniform3fv(u.amb, p.amb); gl.uniform4fv(u.focus, p.focus);
      gl.uniform1f(u.bloomK, p.bloom); gl.uniform1f(u.sat, p.sat); gl.uniform1f(u.vig, p.vig); gl.uniform1f(u.caustic, p.caustic);
      gl.uniform3fv(u.shadowTint, p.shadowTint); gl.uniform3fv(u.hiTint, p.hiTint);
      gl.uniform1i(u.hasDep, hasDep ? 1 : 0);
      gl.uniform4fv(u.dof, p.dof || [0, 1, 1e4, 2e4]); gl.uniform2fv(u.dofK, p.dofK || [0, 0]); gl.uniform1f(u.skyK, p.skyK || 0);
      gl.uniform3fv(u.fogCol, p.fogCol || [1, 1, 1]); gl.uniform3fv(u.fog, p.fog || [1e4, 2e4, 0]);
      gl.uniform4f(u.camA, cam[0], cam[1], cam[2], cam[3]); gl.uniform4f(u.camB, cam[4], cam[5], cam[6], cam[7]);
      gl.uniform1f(u.cloudK, hasDep || iso ? p.cloud || 0 : 0); gl.uniform2fv(u.wind, p.wind || [0, 0]);
      gl.uniform1i(u.iso, iso && !hasDep ? 1 : 0); gl.uniform2fv(u.dap, dap); gl.uniform3fv(u.dapCol, p.dapCol || [1.2, 1.1, 0.9]); gl.uniform3fv(u.lift, p.lift || [0, 0, 0]); gl.uniform2fv(u.carD, p.carD || [-1e4, 0]); gl.uniform2fv(u.tone, p.tone || [1, 1]);
      gl.uniform1f(u.shaftK, shaft); gl.uniform1f(u.speedK, p.speed || 0); gl.uniform1f(u.grain, p.grain || 0);
    });
  }
})();
