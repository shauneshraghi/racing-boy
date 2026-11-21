// Dig Through Worlds: HD-2D post-process (DTWPost). The 2D renderer draws the pixel-art scene and a
// half-size emissive layer into offscreen canvases; this WebGL2 pass lights the scene with screen-space
// point lights, blurs it with a tilt-shift depth of field around the working layer, adds bloom from the
// emissive layer, and grades the colours. init() returns false when WebGL2 is unavailable, and the
// renderer then draws straight to the visible canvas instead.
var DTWPost = (function () {
  'use strict';
  var MAXL = 24;
  var gl = null, prog = {}, vbo, tex = {}, fb = {}, W = 0, H = 0;

  var VS = '#version 300 es\nin vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  var HEAD = '#version 300 es\nprecision highp float; in vec2 uv; out vec4 o;\n';
  var FS = {
    copy: HEAD + 'uniform sampler2D t; void main() { o = texture(t, uv); }',
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
    final: HEAD +
      'uniform sampler2D s, hb, qb, bl; uniform vec2 res; uniform float time;\n' +
      'uniform vec4 L[' + MAXL + ']; uniform vec3 LC[' + MAXL + ']; uniform int nL;\n' +
      'uniform vec3 amb; uniform vec4 focus; uniform float bloomK, sat, vig, caustic;\n' +
      'uniform vec3 shadowTint, hiTint;\n' +
      'vec3 knee(vec3 c) { vec3 e = max(c - 0.82, 0.0); return min(c, 0.82) + e / (1.0 + e / 0.18); }\n' +
      'void main() {\n' +
      '  vec2 px = vec2(uv.x * res.x, (1.0 - uv.y) * res.y);\n' +
      // tilt-shift: sharp inside [focus.x, focus.y], blurring over focus.z pixels outside it
      '  float d = max(focus.x - px.y, px.y - focus.y); float coc = clamp(d / focus.z, 0.0, 1.0) * focus.w;\n' +
      '  vec3 c = texture(s, uv).rgb;\n' +
      '  if (coc > 0.0) { vec3 h = texture(hb, uv).rgb, q = texture(qb, uv).rgb;\n' +
      '    c = coc < 0.5 ? mix(c, h, coc * 2.0) : mix(h, q, coc * 2.0 - 1.0); }\n' +
      // lighting: ambient plus screen-space point lights (xy = centre, z = radius, w = intensity)
      '  vec3 lit = amb;\n' +
      '  for (int i = 0; i < ' + MAXL + '; i++) { if (i >= nL) break;\n' +
      '    float r = length((px - L[i].xy) * vec2(1.0, 1.35)) / L[i].z; float f = max(0.0, 1.0 - r * r); lit += LC[i] * (f * f * L[i].w); }\n' +
      '  c *= lit;\n' +
      '  if (caustic > 0.0) { vec2 q = px / res.y * 9.0; float k = sin(q.x * 1.7 + time * 1.3 + sin(q.y * 1.3 + time)) * sin(q.y * 1.9 - time * 1.1 + sin(q.x * 0.9 - time * 0.7));\n' +
      '    c += c * caustic * smoothstep(0.55, 1.0, k); }\n' +
      '  c += texture(bl, uv).rgb * bloomK;\n' +
      '  float l = dot(c, vec3(0.299, 0.587, 0.114));\n' +
      '  c = mix(vec3(l), c, sat);\n' +
      '  c *= mix(shadowTint, hiTint, smoothstep(0.05, 0.75, l));\n' +
      '  c = knee(c);\n' +
      '  vec2 v = (uv - 0.5) * vec2(res.x / res.y, 1.0) * 0.9; c *= 1.0 - vig * smoothstep(0.35, 1.05, length(v));\n' +
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
  function mkTex() {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function mkFb(w, h) {
    var t = mkTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { f: f, t: t, w: w, h: h };
  }
  function sizeTo(w, h) {
    if (w === W && h === H) return;
    W = w; H = h;
    Object.keys(fb).forEach(function (k) { gl.deleteFramebuffer(fb[k].f); gl.deleteTexture(fb[k].t); });
    var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
    fb = { h1: mkFb(hw, hh), h2: mkFb(hw, hh), q1: mkFb(qw, qh), q2: mkFb(qw, qh), b1: mkFb(qw, qh), b2: mkFb(qw, qh) };
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
    MAXL: MAXL,
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
      tex.scene = mkTex(); tex.emit = mkTex();
      return true;
    } catch (e) { console.warn('HD-2D post-process off:', e.message); gl = null; return false; }
  }
  // p: { lights: [{x, y, r, i, c: [r, g, b]}], amb: [r, g, b], focus: [top, bottom, ramp, strength],
  //      bloom, thr, sat, vig, caustic, shadowTint, hiTint, time }, all positions in canvas pixels
  function render(scene, emit, p) {
    sizeTo(scene.width, scene.height);
    var k = p.scale || 1; // blur radii follow the tile size, so the look holds at any pixel ratio
    upload(tex.scene, scene); upload(tex.emit, emit);
    // depth-of-field sources: half- and quarter-size blurs of the scene
    pass(prog.copy, fb.h1, { t: tex.scene });
    blur(fb.h1, fb.h2, 1.25 * k);
    pass(prog.copy, fb.q1, { t: fb.h1.t });
    blur(fb.q1, fb.q2, 2.0 * k);
    // bloom: bright parts, blurred twice at quarter size
    pass(prog.bright, fb.b1, { s: fb.h1.t, e: tex.emit }, function (u) { gl.uniform1f(u.thr, p.thr); });
    blur(fb.b1, fb.b2, 1.5 * k); blur(fb.b1, fb.b2, 3.5 * k);
    var Ls = new Float32Array(MAXL * 4), LC = new Float32Array(MAXL * 3), n = Math.min(MAXL, p.lights.length);
    for (var i = 0; i < n; i++) {
      var l = p.lights[i]; Ls.set([l.x, l.y, l.r, l.i], i * 4); LC.set(l.c, i * 3);
    }
    pass(prog.final, null, { s: tex.scene, hb: fb.h1.t, qb: fb.q1.t, bl: fb.b1.t }, function (u) {
      gl.uniform2f(u.res, W, H); gl.uniform1f(u.time, p.time);
      gl.uniform4fv(u.L, Ls); gl.uniform3fv(u.LC, LC); gl.uniform1i(u.nL, n);
      gl.uniform3fv(u.amb, p.amb); gl.uniform4fv(u.focus, p.focus);
      gl.uniform1f(u.bloomK, p.bloom); gl.uniform1f(u.sat, p.sat); gl.uniform1f(u.vig, p.vig); gl.uniform1f(u.caustic, p.caustic);
      gl.uniform3fv(u.shadowTint, p.shadowTint); gl.uniform3fv(u.hiTint, p.hiTint);
    });
  }
})();
