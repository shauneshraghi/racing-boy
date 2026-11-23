// Racing Boy: the real-3D renderer (three.js). Loaded after js/render.js; it replaces RBRender (same public API, so
// ui.js is unchanged) only when THREE is present, WebGL works and the URL does not ask for the pixel look
// (?gfx=pixel or ?hd=0). Races use a chase camera behind the player's car over the scene RB3DWorld.race builds; the
// plaza is seen from high on the isometric diagonal. Cars, crates, coins, the kid and other models come from
// RB3DModels (with plain box stand-ins if it is missing). Name tags, floaters and station icons go on the #ov
// overlay; the minimap is the 2D one from render.js.
(function () {
  'use strict';
  if (typeof THREE === 'undefined' || typeof RB3DWorld === 'undefined' || typeof RB === 'undefined') return;
  var Q = new URLSearchParams(location.search);
  if (Q.get('gfx') === 'pixel' || Q.get('hd') === '0') return;
  try { var tc = document.createElement('canvas'); if (!(tc.getContext('webgl2') || tc.getContext('webgl'))) return; } catch (e) { return; }
  var OLD = RBRender, SPR = RBSprites, active = false;

  RBRender = (function () {
    var D = RB, W3 = RB3DWorld;
    var renderer = null, cv, ov, octx, cssW = 1, cssH = 1, pr = 1, ovr = 1, phone = false, failed = false;
    var raceCam, hubCam, time = 0, shake = 0, view = { right: 0, bottom: 0 };
    var race = null, hubS = null, post = null, envTex = null, logged = {};
    var parts = [], floaters = [];
    var V = new THREE.Vector3(), V2 = new THREE.Vector3(), M4 = new THREE.Matrix4(), QT = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), S1 = new THREE.Vector3(1, 1, 1);

    function MD(name) { return typeof RB3DModels !== 'undefined' && typeof RB3DModels[name] === 'function' ? RB3DModels[name] : null; }
    function col(hex) { return new THREE.Color(hex); }

    // ---------- stand-in models (used only while RB3DModels is missing a function) ----------
    function stubMesh(geo, c, rough) { var m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col(c), roughness: rough || 0.5 })); m.castShadow = true; m.receiveShadow = true; return m; }
    function stubCar(id, look) {
      var C = D.CARS[id] || D.CARS.pip, md = C.model, g = new THREE.Group(), body = new THREE.Group(), paint = (D.lookOpt('paint', look && look.paint) || { c: '#e5483a' }).c;
      var b = stubMesh(new THREE.BoxGeometry(md.len, md.h, md.wid), paint, 0.3); b.position.y = md.wheel + md.h / 2; body.add(b);
      var cab = stubMesh(new THREE.BoxGeometry(md.cab.len, md.cab.h, md.cab.wid), '#2a3440', 0.2); cab.position.set(md.cab.x, md.wheel + md.h + md.cab.h / 2, 0); body.add(cab);
      g.add(body);
      var wheels = [];
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (w) {
        var pivot = new THREE.Group(), spin = new THREE.Group(), t = stubMesh(new THREE.CylinderGeometry(md.wheel, md.wheel, 0.18, 12), '#1a1a1a', 0.9);
        t.rotation.x = Math.PI / 2; spin.add(t); pivot.add(spin); pivot.position.set(w[0] * md.len * 0.34, md.wheel, w[1] * md.wid * 0.5); g.add(pivot);
        wheels.push({ pivot: pivot, spin: spin, front: w[0] > 0, r: md.wheel });
      });
      var glider = new THREE.Group(), wing = stubMesh(new THREE.BoxGeometry(0.6, 0.03, 2.4), '#f4f1ea'); wing.position.y = md.wheel + md.h + 0.5; glider.add(wing); glider.visible = false; g.add(glider);
      var shield = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 12), new THREE.MeshStandardMaterial({ color: col('#bff7ff'), transparent: true, opacity: 0.25, emissive: col('#4ad0ff'), emissiveIntensity: 0.6, depthWrite: false }));
      shield.position.y = 0.5; shield.visible = false; g.add(shield);
      g.userData = { wheels: wheels, body: body, glider: glider, shield: shield, lights: { head: [], tail: [] }, exhaust: [new THREE.Vector3(-md.len / 2, md.wheel + 0.1, 0)], len: md.len, wid: md.wid, height: md.wheel + md.h + md.cab.h, dispose: function () {} };
      return g;
    }
    function stubCrate() { var g = new THREE.Group(), m = stubMesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), '#c9853a', 0.6); m.position.y = 0.4; g.add(m); return g; }
    function stubCoin() { var g = new THREE.Group(), m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20), new THREE.MeshStandardMaterial({ color: col('#ffd23f'), metalness: 0.9, roughness: 0.25, emissive: col('#6a4a00'), emissiveIntensity: 0.4 })); m.rotation.x = Math.PI / 2; g.add(m); return g; }
    function stubBee() { var g = new THREE.Group(), m = stubMesh(new THREE.SphereGeometry(0.22, 12, 8), '#ffd23f'); g.add(m); var w = new THREE.Group(); g.add(w); g.userData.wings = [w]; return g; }
    function stubGoo() { var g = new THREE.Group(), m = new THREE.Mesh(new THREE.CircleGeometry(0.8, 20), new THREE.MeshStandardMaterial({ color: col('#3fbf5a'), roughness: 0.15 })); m.rotation.x = -Math.PI / 2; m.position.y = 0.03; g.add(m); return g; }
    function stubKid() { var g = new THREE.Group(), b = stubMesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.16, 0.4, 4, 8) : new THREE.BoxGeometry(0.3, 0.6, 0.3), '#3a6ad0'); b.position.y = 0.42; g.add(b); var h = stubMesh(new THREE.SphereGeometry(0.17, 12, 8), '#f0c8a0'); h.position.y = 0.88; g.add(h); g.userData.anim = function (t, mv) { b.position.y = 0.42 + (mv ? Math.abs(Math.sin(t * 10)) * 0.04 : 0); }; return g; }
    function make(name, stub, args) { var f = MD(name), o = null; if (f) { try { o = f.apply(null, args || []); } catch (e) { console.error('RB3DModels.' + name + ':', e); } } return o || stub.apply(null, args || []); }

    // ---------- setup ----------
    function init(canvas, overlay) {
      cv = canvas; ov = overlay; octx = ov.getContext('2d');
      phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance', stencil: false });
      } catch (e) { console.error('3D renderer failed, using the pixel renderer', e); failed = true; active = false; OLD.init(canvas, overlay); return; }
      active = true;
      cv.style.imageRendering = 'auto';
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.info.autoReset = false;
      W3.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
      raceCam = new THREE.PerspectiveCamera(55, 1, 0.1, 2400);
      hubCam = new THREE.PerspectiveCamera(30, 1, 0.5, 1200);
      var want = Q.get('bloom');
      if (renderer.capabilities.isWebGL2 && want !== '0' && (!phone || want === '1')) post = makePost();
      console.log('Racing Boy renderer: 3D (three.js r' + THREE.REVISION + (post ? ', bloom' : '') + ')');
      resize();
    }
    function resize() {
      if (failed) return OLD.resize();
      if (!renderer) return;
      var r = cv.getBoundingClientRect();
      cssW = Math.max(1, Math.round(r.width)); cssH = Math.max(1, Math.round(r.height));
      pr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 2);
      renderer.setPixelRatio(pr); renderer.setSize(cssW, cssH, false);
      ovr = Math.min(window.devicePixelRatio || 1, 2);
      ov.width = Math.round(cssW * ovr); ov.height = Math.round(cssH * ovr);
      if (post) post.resize(Math.round(cssW * pr), Math.round(cssH * pr));
    }
    function setView(right, bottom) { if (failed) return OLD.setView(right, bottom); view.right = right || 0; view.bottom = bottom || 0; }

    // ---------- bloom and speed blur (a half-float scene target, a bright pass blurred at quarter size) ----------
    var QUAD_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    function makePost() {
      var opt = { type: THREE.HalfFloatType, depthBuffer: true };
      var scene = new THREE.WebGLRenderTarget(4, 4, Object.assign({ samples: 4 }, opt)), a = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }), b = a.clone();
      var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), qs = new THREE.Scene(); quad.frustumCulled = false; qs.add(quad);
      var bright = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uThr: { value: 1.0 } }, vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
        fragmentShader: 'uniform sampler2D tDiffuse; uniform float uThr; varying vec2 vUv; void main() { vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(c.r, max(c.g, c.b)); float k = smoothstep(uThr, uThr * 2.2, l); gl_FragColor = vec4(min(c * k, vec3(12.0)), 1.0); }' });
      var blur = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
        fragmentShader: 'uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv; void main() { vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227; c += (texture2D(tDiffuse, vUv + uDir * 1.385).rgb + texture2D(tDiffuse, vUv - uDir * 1.385).rgb) * 0.316; c += (texture2D(tDiffuse, vUv + uDir * 3.23).rgb + texture2D(tDiffuse, vUv - uDir * 3.23).rgb) * 0.07; gl_FragColor = vec4(c, 1.0); }' });
      var comp = new THREE.ShaderMaterial({ uniforms: { tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.6 }, uSpeed: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.55) }, uVig: { value: 0.35 } }, vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
        fragmentShader: [
          'uniform sampler2D tScene; uniform sampler2D tBloom; uniform float uBloom; uniform float uSpeed; uniform vec2 uCenter; uniform float uVig; varying vec2 vUv;',
          'void main() {',
          '  vec3 c = texture2D(tScene, vUv).rgb;',
          '  if (uSpeed > 0.002) { vec2 d = vUv - uCenter; float k = uSpeed * smoothstep(0.12, 0.7, length(d)); vec3 acc = c; for (int i = 1; i < 7; i++) acc += texture2D(tScene, vUv - d * k * 0.022 * float(i)).rgb; c = acc / 7.0; }',
          '  c += texture2D(tBloom, vUv).rgb * uBloom;',
          '  float v = smoothstep(1.2, 0.3, length((vUv - 0.5) * vec2(1.0, 0.85)));',
          '  c *= mix(1.0, v, uVig);',
          '  gl_FragColor = vec4(c, 1.0);',
          '  #include <tonemapping_fragment>',
          '  #include <colorspace_fragment>',
          '}'].join('\n') });
      function pass(mat, target) { quad.material = mat; renderer.setRenderTarget(target); renderer.render(qs, cam); }
      return {
        resize: function (w, h) { scene.setSize(w, h); a.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); b.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2)); },
        render: function (sc, camera, o) {
          renderer.setRenderTarget(scene); renderer.render(sc, camera);
          bright.uniforms.tDiffuse.value = scene.texture; bright.uniforms.uThr.value = o.thr || 1.0; pass(bright, a);
          var w = a.width, h = a.height;
          [1, 2].forEach(function (k) {
            blur.uniforms.tDiffuse.value = a.texture; blur.uniforms.uDir.value.set(k / w, 0); pass(blur, b);
            blur.uniforms.tDiffuse.value = b.texture; blur.uniforms.uDir.value.set(0, k / h); pass(blur, a);
          });
          comp.uniforms.tScene.value = scene.texture; comp.uniforms.tBloom.value = a.texture; comp.uniforms.uBloom.value = o.bloom === undefined ? 0.6 : o.bloom;
          comp.uniforms.uSpeed.value = o.speed || 0; comp.uniforms.uVig.value = o.vig === undefined ? 0.35 : o.vig;
          if (o.center) comp.uniforms.uCenter.value.copy(o.center);
          pass(comp, null);
        }
      };
    }
    function present(scene, camera, o) {
      renderer.info.reset();
      if (post) post.render(scene, camera, o || {}); else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    }
    function logOnce(key, extra) {
      if (logged[key] === undefined) logged[key] = 0;
      if (++logged[key] !== 4) return;
      var i = renderer.info;
      console.log('Racing Boy 3D ' + key + ': ' + i.render.calls + ' draw calls, ' + i.render.triangles + ' triangles, ' + i.memory.geometries + ' geometries, ' + i.memory.textures + ' textures' + (extra || ''));
    }

    // ---------- scene setup shared by races and the plaza ----------
    function sceneFor(world) {
      var sc = new THREE.Scene(), L = world.look;
      sc.add(world.group);
      sc.fog = new THREE.FogExp2(col(L.fog), L.fogD);
      sc.background = col(L.fog);
      sc.environment = envMap(world);
      var sz = phone ? 1024 : 2048; world.light.sun.shadow.mapSize.set(sz, sz);
      sc.add(PT.add.points); sc.add(PT.norm.points);
      return sc;
    }
    function envMap(world) {
      var f = MD('envMap');
      if (f) { try { if (!envTex) envTex = f(renderer); if (envTex) return envTex; } catch (e) { console.error('RB3DModels.envMap:', e); } }
      // fallback: the world's own sky
      if (world.env) return world.env;
      var pm = new THREE.PMREMGenerator(renderer), s = new THREE.Scene(), sky = world.group.getObjectByName('sky');
      if (sky) { var c = sky.clone(); c.scale.setScalar(0.05); s.add(c); }
      s.add(new THREE.HemisphereLight(col(world.look.hemiSky), col(world.look.hemiGround), 1));
      world.env = pm.fromScene(s, 0.04).texture; pm.dispose();
      return world.env;
    }
    // the sun's shadow box follows a point (snapped to shadow texels so it does not shimmer)
    function aimSun(world, fx, fz, size) {
      var sun = world.light.sun, d = world.light.dir, sc = sun.shadow.camera, texel = 2 * size / sun.shadow.mapSize.x;
      fx = Math.round(fx / texel) * texel; fz = Math.round(fz / texel) * texel;
      if (sc.right !== size) { sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size; sc.updateProjectionMatrix(); }
      sun.target.position.set(fx, 0, fz); sun.position.set(fx + d.x * 90, d.y * 90, fz + d.z * 90);
      sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
    }

    // ---------- particles: two pooled point clouds (additive glow and normal dust), soft round sprites ----------
    var PMAX = 1400;
    function layer(additive) {
      var g = new THREE.BufferGeometry(), pos = new Float32Array(PMAX * 3), cl = new Float32Array(PMAX * 3), sz = new Float32Array(PMAX), al = new Float32Array(PMAX);
      [['position', pos, 3], ['color', cl, 3], ['size', sz, 1], ['alpha', al, 1]].forEach(function (a) { var at = new THREE.BufferAttribute(a[1], a[2]); at.setUsage(THREE.DynamicDrawUsage); g.setAttribute(a[0], at); });
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      var m = new THREE.ShaderMaterial({
        uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        vertexShader: 'attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale; void main() { vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * uScale / -mv.z, 1.0, 180.0); vA *= smoothstep(0.6, 2.0, -mv.z); }',
        fragmentShader: 'varying vec3 vC; varying float vA; void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, ' + (additive ? '0.0' : '0.35') + ', r); if (a <= 0.003) discard; gl_FragColor = vec4(vC * ' + (additive ? '2.2' : '1.0') + ', a * vA);\n#include <colorspace_fragment>\n}'
      });
      var p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 5;
      return { points: p, pos: pos, cl: cl, sz: sz, al: al, n: 0, g: g };
    }
    var PT = { add: layer(true), norm: layer(false) };
    var TRAIL = {
      flame: ['#ffe066', '#ff8a1c', '#e5483a'], leaves: ['#9ad13a', '#5cb84a', '#ffd23f'], stars: ['#fff3b0', '#ffd23f', '#8fd8ff'],
      bubbles: ['#bff7ff', '#8fd8ff', '#ffffff'], rainbow: ['#e5483a', '#ff8a1c', '#ffd23f', '#58e07a', '#3fa8ff', '#8a5ad8'], hearts: ['#ff7ac8', '#ff4b8a', '#ffd0e8']
    };
    var CC = {}; function cc(hex) { return CC[hex] || (CC[hex] = col(hex)); }
    var FLOOR = 0; // the ground height under what is emitting now (hills): particles land on it
    function addPart(o) { if (o.fl === undefined) o.fl = FLOOR; if (parts.length < PMAX - 40) parts.push(o); }
    function burst(x, y, z, cols, n, sp, size, glow) {
      for (var i = 0; i < n; i++) { var a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random()); addPart({ x: x, y: y, z: z, vx: Math.cos(a) * v, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, col: cols[i % cols.length], size: size * 2.2, glow: glow, grav: true }); }
    }
    function puff(x, y, z, hex, size, life, rise) { addPart({ x: x, y: y, z: z, vx: (Math.random() - 0.5) * 1.6, vy: rise || 0.6, vz: (Math.random() - 0.5) * 1.6, life: life, max: life, col: hex, size: size, grow: 2.2, glow: false, drag: 1.5, a: 0.35 }); }
    function floater(x, y, z, text, c) { floaters.push({ x: x, y: y, z: z, t: 0, text: text, col: c || '#ffd23f' }); if (floaters.length > 12) floaters.shift(); }
    function events(r, list) {
      if (failed) return OLD.events(r, list);
      list.forEach(function (e) {
        var c = e.car >= 0 ? r.cars[e.car] : null;
        if (!c) return;
        var gy = FLOOR = c.gy || 0;
        if (e.type === 'coin' && c.i === 0) burst(e.x || c.x, gy + 0.5, e.z || c.z, ['#ffd23f', '#fff3b0'], 8, 2, 0.12, true);
        if (e.type === 'splash') { burst(c.x, gy + 0.1, c.z, ['#e8fbff', '#9fd8f0', '#ffffff'], 40, 3.5, 0.2, false); for (var k = 0; k < 8; k++) puff(c.x + (Math.random() - 0.5), gy - 0.2, c.z + (Math.random() - 0.5), '#ffffff', 0.9, 0.8, 1.5); }
        if (e.type === 'land') { for (var j = 0; j < 10; j++) puff(c.x + (Math.random() - 0.5) * 1.2, gy + 0.1, c.z + (Math.random() - 0.5) * 1.2, landDust(r), 0.7, 0.7, 0.5); }
        if (e.type === 'hit') { burst(c.x, gy + 0.8, c.z, e.kind === 'goo' ? ['#58e07a', '#9dff8a'] : ['#ffd23f', '#ffffff', '#ff8a1c'], 18, 2.4, 0.15, e.kind !== 'goo'); if (c.i === 0) shake = 0.35; }
        if (e.type === 'blocked') burst(c.x, gy + 0.7, c.z, ['#bff7ff', '#ffffff'], 18, 3, 0.15, true);
        if (e.type === 'boost' && c.i === 0 && e.from === 'trick') floater(c.x, gy + 1.6, c.z, 'Trick boost!', '#8fd8ff');
        if (e.type === 'boost' && c.i === 0 && e.from === 'glide') floater(c.x, gy + 1.6, c.z, 'Glide boost!', '#ffd23f');
        if (e.type === 'boost' && c.i === 0 && e.from === 'drift') floater(c.x, gy + 1.6, c.z, ['Drift boost!', 'Super drift!', 'Ultra drift!'][e.tier - 1], ['#8fd8ff', '#ff8a1c', '#ff7ae0'][e.tier - 1]);
        if (e.type === 'box') burst(c.x, gy + 0.8, c.z, ['#ffd23f', '#c9853a', '#fff3b0'], 14, 2.5, 0.14, true);
        if (e.type === 'wall') { if (c.i === 0) shake = Math.max(shake, 0.18); for (var w = 0; w < 4; w++) puff(c.x, gy + 0.2, c.z, landDust(r), 0.6, 0.5, 0.4); }
      });
    }
    function landDust(r) { var L = race && race.world.look; return L && L.dust || (r && r.world === 1 ? '#d8b078' : '#b8a07a'); }
    function stepParts(dt) {
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; }
        if (p.drag) { var k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vz *= k; p.vy *= k; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.grav) p.vy -= 12 * dt; if (p.y < p.fl && p.grav) { p.y = p.fl; p.vy *= -0.3; }
      }
      for (i = floaters.length - 1; i >= 0; i--) { floaters[i].t += dt; if (floaters[i].t > 1.3) floaters.splice(i, 1); }
      shake = Math.max(0, shake - dt);
    }
    // write the live particles (plus this frame's one-off sprites) into the two point clouds
    var instant = [];
    function flushParts() {
      PT.add.n = 0; PT.norm.n = 0;
      function put(p, f) {
        var L = p.glow ? PT.add : PT.norm; if (L.n >= PMAX) return;
        var k = L.n++, c = cc(p.col);
        L.pos[k * 3] = p.x; L.pos[k * 3 + 1] = p.y; L.pos[k * 3 + 2] = p.z; L.cl[k * 3] = c.r; L.cl[k * 3 + 1] = c.g; L.cl[k * 3 + 2] = c.b;
        L.sz[k] = p.size * (p.grow ? 1 + (1 - f) * p.grow : 0.5 + f * 0.5); L.al[k] = Math.min(1, f * 1.6) * (p.a || 1);
      }
      parts.forEach(function (p) { put(p, p.life / p.max); });
      instant.forEach(function (p) { put(p, 1); }); instant.length = 0;
      [PT.add, PT.norm].forEach(function (L) {
        L.g.setDrawRange(0, L.n); ['position', 'color', 'size', 'alpha'].forEach(function (a) { var at = L.g.attributes[a]; at.needsUpdate = true; at.updateRange.offset = 0; at.updateRange.count = L.n * at.itemSize; });
        L.points.material.uniforms.uScale.value = renderer.domElement.height * 0.5;
      });
    }

    // ---------- merging a model's rigid parts ----------
    // Meshes that never move relative to each other (same nearest moving ancestor) and share a material are merged
    // into one mesh, so a car is a few dozen draw calls cheaper. dyn: the nodes that move (wheels, body, limbs, ...).
    var _mi = new THREE.Matrix4(), _mm = new THREE.Matrix4(), _nm = new THREE.Matrix3();
    function compact(root, dyn, owned) {
      root.updateMatrixWorld(true);
      var buckets = new Map();
      root.traverse(function (o) {
        if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || dyn.has(o) || Array.isArray(o.material) || !o.visible) return;
        var p = o.parent, hidden = false; while (p && p !== root && !dyn.has(p)) { if (!p.visible) hidden = true; p = p.parent; }
        if (!p || hidden) return;
        var g = o.geometry; if (g.morphAttributes && Object.keys(g.morphAttributes).length) return;
        var key = o.material.uuid + '|' + Object.keys(g.attributes).sort().map(function (k) { return k + g.attributes[k].itemSize; }).join(',') + '|' + o.castShadow + o.receiveShadow + o.renderOrder;
        var m = buckets.get(p); if (!m) buckets.set(p, m = new Map());
        var l = m.get(key); if (!l) m.set(key, l = []); l.push(o);
      });
      buckets.forEach(function (m, p) {
        _mi.copy(p.matrixWorld).invert();
        m.forEach(function (list) {
          if (list.length < 2) return;
          var names = Object.keys(list[0].geometry.attributes), nv = 0, ni = 0;
          list.forEach(function (o) { var g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; });
          var arrs = {}; names.forEach(function (n) { arrs[n] = new Float32Array(nv * list[0].geometry.attributes[n].itemSize); });
          var idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), vo = 0, io = 0;
          list.forEach(function (o) {
            var g = o.geometry, n = g.attributes.position.count; _mm.multiplyMatrices(_mi, o.matrixWorld); _nm.getNormalMatrix(_mm);
            var e = _mm.elements, ne = _nm.elements, flip = _mm.determinant() < 0;
            names.forEach(function (nm) {
              var a = g.attributes[nm], sz = a.itemSize, out = arrs[nm];
              for (var i = 0; i < n; i++) {
                var x = a.getX(i), y = sz > 1 ? a.getY(i) : 0, z = sz > 2 ? a.getZ(i) : 0, w = sz > 3 ? a.getW(i) : 0, k = (vo + i) * sz;
                if (nm === 'position') { out[k] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
                else if (nm === 'normal' || nm === 'tangent') { var nx = ne[0] * x + ne[3] * y + ne[6] * z, ny = ne[1] * x + ne[4] * y + ne[7] * z, nz = ne[2] * x + ne[5] * y + ne[8] * z, L = Math.hypot(nx, ny, nz) || 1; out[k] = nx / L; out[k + 1] = ny / L; out[k + 2] = nz / L; if (sz > 3) out[k + 3] = w * (flip ? -1 : 1); }
                else { out[k] = x; if (sz > 1) out[k + 1] = y; if (sz > 2) out[k + 2] = z; if (sz > 3) out[k + 3] = w; }
              }
            });
            if (g.index) { var I = g.index.array, c = g.index.count; for (var i = 0; i < c; i += 3) { idx[io + i] = I[i] + vo; idx[io + i + 1] = I[i + (flip ? 2 : 1)] + vo; idx[io + i + 2] = I[i + (flip ? 1 : 2)] + vo; } io += c; }
            else { for (i = 0; i < n; i += 3) { idx[io + i] = vo + i; idx[io + i + 1] = vo + i + (flip ? 2 : 1); idx[io + i + 2] = vo + i + (flip ? 1 : 2); } io += n; }
            vo += n;
          });
          var geo = new THREE.BufferGeometry();
          names.forEach(function (n) { var a0 = list[0].geometry.attributes[n]; geo.setAttribute(n, new THREE.BufferAttribute(arrs[n], a0.itemSize, a0.normalized)); });
          geo.setIndex(new THREE.BufferAttribute(idx, 1)); geo.computeBoundingSphere();
          var mesh = new THREE.Mesh(geo, list[0].material); mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow; mesh.renderOrder = list[0].renderOrder;
          p.add(mesh); if (owned) owned.push(geo);
          list.forEach(function (o) { o.removeFromParent(); });
        });
      });
      return root;
    }
    // the nodes an animation function moves: call it at a few times and see which transforms change
    function movers(root, fn) {
      var snap = new Map(), dyn = new Set();
      root.traverse(function (o) { snap.set(o, o.matrix.clone()); });
      [[0.37, true], [0.81, true], [1.3, false], [2.9, false]].forEach(function (a) { fn(a[0], a[1]); root.traverse(function (o) { o.updateMatrix(); if (!o.matrix.equals(snap.get(o))) dyn.add(o); }); });
      return dyn;
    }
    function compactAll(root) { return compact(root, new Set()); }
    // a cheaper car for rivals: each wheel's parts become one mesh in a shared vertex-coloured material that carries
    // each part's roughness and metalness per vertex; the brake parts on the steering pivot are dropped
    var wheelMat = null;
    function simpleWheels(o) {
      var ud = o.userData;
      if (!wheelMat) {
        wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
        wheelMat.onBeforeCompile = function (sh) {
          sh.vertexShader = 'attribute vec2 rm; varying vec2 vRM;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm;');
          sh.fragmentShader = 'varying vec2 vRM;\n' + sh.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;').replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
        };
      }
      ud.wheels.forEach(function (w) {
        if (!w.spin) return;
        w.spin.updateMatrixWorld(true); _mi.copy(w.spin.matrixWorld).invert();
        var list = []; w.spin.traverse(function (m) { if (m.isMesh && m.visible && !Array.isArray(m.material)) list.push(m); });
        if (list.length < 2) return;
        var P = [], N = [], C = [], RM = [], I = [], vo = 0;
        list.forEach(function (m) {
          var g = m.geometry, pa = g.attributes.position, na = g.attributes.normal, n = pa.count, mc = m.material.color || col('#808080');
          _mm.multiplyMatrices(_mi, m.matrixWorld); _nm.getNormalMatrix(_mm); var flip = _mm.determinant() < 0;
          for (var i = 0; i < n; i++) {
            V.fromBufferAttribute(pa, i).applyMatrix4(_mm); P.push(V.x, V.y, V.z);
            if (na) { V.fromBufferAttribute(na, i).applyMatrix3(_nm).normalize(); N.push(V.x, V.y, V.z); } else N.push(0, 1, 0);
            C.push(mc.r, mc.g, mc.b); RM.push(m.material.roughness === undefined ? 0.6 : m.material.roughness, m.material.metalness || 0);
          }
          if (g.index) { var A = g.index.array; for (i = 0; i < g.index.count; i += 3) I.push(A[i] + vo, A[i + (flip ? 2 : 1)] + vo, A[i + (flip ? 1 : 2)] + vo); }
          else for (i = 0; i < n; i += 3) I.push(vo + i, vo + i + (flip ? 2 : 1), vo + i + (flip ? 1 : 2));
          vo += n;
        });
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); geo.setAttribute('rm', new THREE.Float32BufferAttribute(RM, 2)); geo.setIndex(I); geo.computeBoundingSphere();
        list.forEach(function (m) { m.removeFromParent(); });
        var wm = new THREE.Mesh(geo, wheelMat); wm.castShadow = true; wm.receiveShadow = true; w.spin.add(wm); ud._own.push(geo);
        if (w.pivot) w.pivot.children.slice().forEach(function (c) { if (c.isMesh) c.visible = false; });
      });
    }

    // ---------- instancing helpers for crates and coins ----------
    function instancify(proto, n, scene) {
      proto.updateMatrixWorld(true);
      var list = [];
      proto.traverse(function (o) {
        if (!o.isMesh) return;
        var im = new THREE.InstancedMesh(o.geometry, o.material, n); im.castShadow = o.castShadow !== false; im.receiveShadow = true; im.frustumCulled = false;
        for (var i = 0; i < n; i++) im.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        list.push({ im: im, base: o.matrixWorld.clone() }); scene.add(im);
      });
      var tmp = new THREE.Matrix4();
      return {
        set: function (i, m) { list.forEach(function (e) { tmp.multiplyMatrices(m, e.base); e.im.setMatrixAt(i, tmp); }); },
        done: function () { list.forEach(function (e) { e.im.instanceMatrix.needsUpdate = true; }); },
        remove: function () { list.forEach(function (e) { e.im.removeFromParent(); e.im.dispose(); }); }
      };
    }

    // ---------- cars ----------
    function lookKey(id, look) { return id + '|' + JSON.stringify(look || {}); }
    function newCarObj(id, look, cheap) {
      var o = make('car', stubCar, [id, look]), ud = o.userData || (o.userData = {});
      if (!ud.wheels) ud.wheels = []; if (!ud.lights) ud.lights = { head: [], tail: [] };
      o.traverse(function (m) { if (m.isMesh) { if (m.castShadow === undefined || m !== ud.shield) m.castShadow = m !== ud.shield; m.receiveShadow = true; } });
      if (ud.glider) ud.glider.visible = false; if (ud.shield) ud.shield.visible = false;
      var dyn = new Set([o]); if (ud.body) dyn.add(ud.body); if (ud.glider) dyn.add(ud.glider); if (ud.shield) dyn.add(ud.shield);
      ud.wheels.forEach(function (w) { if (w.pivot) dyn.add(w.pivot); if (w.spin) dyn.add(w.spin); });
      ud._own = []; compact(o, dyn, ud._own);
      if (cheap) simpleWheels(o);
      // only the biggest body parts and the wheels cast shadows
      var bodyM = []; if (ud.body) ud.body.traverse(function (m) { if (m.isMesh) { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); bodyM.push(m); } });
      bodyM.sort(function (a, b) { return b.geometry.boundingSphere.radius - a.geometry.boundingSphere.radius; });
      bodyM.forEach(function (m, k) { if (k >= (cheap ? 1 : 3)) m.castShadow = false; });
      ud.wheels.forEach(function (w) { if (w.pivot) w.pivot.traverse(function (m) { if (m.isMesh && m.parent === w.pivot) m.castShadow = false; }); });
      return o;
    }
    function freeCar(o) { if (!o) return; o.removeFromParent(); if (o.userData && o.userData._own) o.userData._own.forEach(function (g) { g.dispose(); }); if (o.userData && typeof o.userData.dispose === 'function') { try { o.userData.dispose(); } catch (e) {} } }
    // see-through: clone the car's materials once so fading one car never fades another
    function ghost(st, a) {
      if (st.alpha === a) return;
      if (!st.mats) { st.mats = []; st.obj.traverse(function (m) { if (m.isMesh && m !== st.obj.userData.shield) { if (Array.isArray(m.material)) m.material = m.material.map(function (x) { var c = x.clone(); st.mats.push([c, c.transparent, c.opacity]); return c; }); else { m.material = m.material.clone(); st.mats.push([m.material, m.material.transparent, m.material.opacity]); } } }); }
      st.mats.forEach(function (e) { var m = e[0], was = m.transparent; m.transparent = a < 1 || e[1]; m.opacity = e[2] * a; m.depthWrite = a >= 1; if (was !== m.transparent) m.needsUpdate = true; });
      st.alpha = a;
    }
    function poseCar(st, c, dt, camPos, camFwd, playerDepth, r) {
      var o = st.obj, ud = o.userData, ry = c.y + (c.hopY || 0), gy = c.gy || 0;
      if (c.fallT > 0) ry = Math.min(0, c.y);
      ry += gy;
      o.visible = !(c.fallT > 0 && ry - gy < -1.4);
      var hv = c.h + (c.slip ? c.slipDir * 0.45 * c.slip : 0) + (c.trickT > 0 ? (1 - c.trickT / 0.45) * Math.PI * 2 : 0);
      o.position.set(c.x, ry, c.z); o.rotation.set(0, -hv, 0);
      // body springs from the logic, plus the ramp's slope and the arc of a jump
      var want = 0;
      if (c.onRamp >= 0 && r.g.ramps[c.onRamp]) want = Math.atan(r.g.ramps[c.onRamp].h / r.g.ramps[c.onRamp].len);
      else if (c.air) want = Math.max(-0.35, Math.min(0.35, Math.atan2(c.vy, Math.max(4, c.v)) * 0.6));
      else if (D.slopeAt) { var sq = r.g.query(c.x, c.z); want = Math.atan(D.slopeAt(r.g, c.s) * (Math.cos(c.h) * sq.tx + Math.sin(c.h) * sq.tz)); }
      st.pitchS += (want - st.pitchS) * Math.min(1, dt * 12);
      if (ud.body) { ud.body.rotation.x = c.roll || 0; ud.body.rotation.z = (c.pitch || 0) + st.pitchS * 0.0; ud.body.position.y = -Math.max(0, c.dip || 0); }
      o.rotation.z = st.pitchS; o.rotation.order = 'YXZ';
      st.spin += (c.v || 0) * dt;
      (ud.wheels || []).forEach(function (w) {
        if (w.spin) { if (w._z0 === undefined) w._z0 = w.spin.rotation.z; w.spin.rotation.z = w._z0 + st.spin / (w.r || 0.25); }
        if (w.front && w.pivot) w.pivot.rotation.y = -(c.wheel || 0) * 0.42;
      });
      if (ud.glider) { var gOpen = !!(c.air && c.stats && c.stats.glide > 0 && c.vy < 2); st.gl = (st.gl || 0) + ((gOpen ? 1 : 0) - (st.gl || 0)) * Math.min(1, dt * 8); ud.glider.visible = st.gl > 0.02; if (ud.glider.userData && typeof ud.glider.userData.setOpen === 'function') ud.glider.userData.setOpen(st.gl); }
      if (ud.shield) { ud.shield.visible = c.shieldT > 0; if (c.shieldT > 0) { var s = 1 + 0.04 * Math.sin(time * 8); ud.shield.scale.set(s, s, s); } }
      var boost = c.boostT > 0;
      (ud.lights.tail || []).forEach(function (m) { var mm = m.material || m; if (mm && mm.emissiveIntensity !== undefined) mm.emissiveIntensity = boost ? 3 : 0.6; });
      // a rival between the camera and the player turns see-through
      var depth = (c.x - camPos.x) * camFwd.x + (c.z - camPos.z) * camFwd.z, a = 1;
      if (c.i !== 0 && depth < playerDepth - 0.4) a = 0.3;
      if (c.fallT > 0) a = Math.min(a, Math.max(0.15, c.fallT / 1.1));
      ghost(st, a);
      // hit: stars circling over the head
      if (c.slowT > 0) for (var i = 0; i < 3; i++) { var an = time * 5 + i * 2.1; instant.push({ x: c.x + Math.cos(an) * 0.5, y: ry + 1.25, z: c.z + Math.sin(an) * 0.5, col: '#ffd23f', size: 0.35, glow: true }); }
      return ry;
    }
    function carEmit(c, st, r, dt) {
      var o = st.obj, ud = o.userData, ch = Math.cos(c.h), sh = Math.sin(c.h), len = ud.len || 1.5, wid = ud.wid || 1, gy = FLOOR = c.gy || 0;
      if (c.boostT > 0 && o.visible) {
        var cols = TRAIL[c.look && c.look.trail] || TRAIL.flame, tips = ud.exhaust && ud.exhaust.length ? ud.exhaust : [new THREE.Vector3(-len / 2, 0.3, 0)];
        o.updateMatrixWorld(true);
        var n = c.i === 0 ? 3 : 1;
        for (var i = 0; i < n; i++) {
          var tip = V.copy(tips[i % tips.length]).applyMatrix4(o.matrixWorld), a = c.h + Math.PI + (Math.random() - 0.5) * 0.5, sp = 2 + Math.random() * 2;
          addPart({ x: tip.x, y: tip.y, z: tip.z, vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 0.8, vz: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.2, max: 0.5, col: cols[Math.floor(Math.random() * cols.length)], size: 0.5 + Math.random() * 0.3, glow: c.look.trail !== 'leaves', drag: 2 });
        }
      }
      // drift sparks from the rear wheels, coloured by the charged tier
      if (c.driftDir && c.drift > 0.2 && !c.air) {
        var T = D.DRIFT_TIERS, dc = c.drift >= T[2] ? '#ff6ad5' : c.drift >= T[1] ? '#ff8a1c' : c.drift >= T[0] ? '#3fa8ff' : '#f4f1ea';
        for (var j = 0; j < 2; j++) {
          var sd = j ? 1 : -1, wx = c.x - ch * len * 0.38 - sh * wid * 0.48 * sd, wz = c.z - sh * len * 0.38 + ch * wid * 0.48 * sd;
          for (var k = 0; k < (c.i === 0 ? 2 : 1); k++) addPart({ x: wx, y: gy + 0.08, z: wz, vx: -ch * 2 + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2.5, vz: -sh * 2 + (Math.random() - 0.5) * 3, life: 0.25 + Math.random() * 0.2, max: 0.45, col: dc, size: 0.22, glow: true, grav: true });
          if (c.i === 0 && Math.random() < 0.4) puff(wx, gy + 0.1, wz, '#e8e4dc', 0.6, 0.6, 0.4);
        }
      }
      // dust off the road
      if (!c.air && c.fallT <= 0 && Math.abs(c.d || 0) > r.g.hw && c.v > 3 && Math.random() < (c.i === 0 ? 0.6 : 0.3)) puff(c.x - ch * len * 0.5 + (Math.random() - 0.5) * wid, gy + 0.12, c.z - sh * len * 0.5 + (Math.random() - 0.5) * wid, landDust(r), 0.6, 0.9, 0.25);
    }

    // ---------- race scene ----------
    function worldIdOf(id) { var t = D.TRACKS[id], w = t && D.WORLDS[t.world]; return w ? w.id : 'hills'; }
    function buildRace(id) {
      if (race && race.id === id) return race;
      if (race) disposeRace();
      var g = D.track(id), w = W3.race(id, g, worldIdOf(id)), sc = sceneFor(w);
      race = { id: id, world: w, scene: sc, g: g, cars: [], cam: { init: false, yaw: 0, lift: 0, boost: 0, x: 0, y: 0, z: 0 } };
      race.crates = instancify(compactAll(make('crate', stubCrate)), g.boxes.length, sc);
      race.coins = instancify(make('coin', stubCoin), g.coins.length, sc);
      race.crateS = g.boxes.map(function () { return 1; });
      race.goos = []; race.bees = [];
      console.log('Racing Boy 3D: built ' + id + ' in ' + w.info.build + ' ms (' + Math.round(w.info.tris / 1000) + 'k static triangles)');
      return race;
    }
    function disposeRace() {
      race.cars.forEach(function (st) { freeCar(st.obj); });
      race.crates.remove(); race.coins.remove();
      race.goos.concat(race.bees).forEach(function (o) { o.removeFromParent(); });
      race.world.dispose();
      if (race.world.env && race.world.env !== envTex) race.world.env.dispose();
      race.scene.remove(PT.add.points); race.scene.remove(PT.norm.points);
      race = null; parts.length = 0;
    }
    function warm(id) { if (failed) return OLD.warm(id); if (D.TRACKS[id]) buildRace(id); }

    var CAM = {
      land: { dist: 6.0, height: 2.3, ahead: 4.0, lookY: 0.6, fov: 54 },
      tall: { dist: 6.3, height: 3.0, ahead: 3.5, lookY: 0.4, fov: 72 },
      follow: 6, boostFov: 9, boostPull: 0.14
    };
    function drawRace(r, dt) {
      if (failed) return OLD.drawRace(r, dt);
      var R = buildRace(r.id), sc = R.scene, g = r.g, p = r.cars[0];
      time += dt; stepParts(dt);
      R.world.update(time);
      // camera: swings round behind the car with a lag, rises on jumps, pulls back and widens when boosting
      var cs = R.cam, tall = cssH > cssW * 1.05, C = tall ? CAM.tall : CAM.land;
      var snap = !cs.init || cs.race !== r || (r.t === 0 && r.phase === 'count');
      cs.race = r;
      if (snap) { cs.yaw = p.h; cs.init = true; cs.lift = 0; cs.boost = 0; cs.gy = p.gy || 0; }
      else if (p.fallT <= 0) cs.yaw += D.angDiff(p.h, cs.yaw) * Math.min(1, dt * CAM.follow);
      cs.gy += ((p.fallT > 0 ? cs.gy : p.gy || 0) - cs.gy) * Math.min(1, dt * 7);
      cs.lift += (Math.max(0, p.y) * 0.55 - cs.lift) * Math.min(1, dt * 5);
      cs.boost += ((p.boostT > 0 ? 1 : 0) - cs.boost) * Math.min(1, dt * 3);
      var fx = Math.cos(cs.yaw), fz = Math.sin(cs.yaw), dist = C.dist * (1 + CAM.boostPull * cs.boost);
      var cx = p.x - fx * dist, cz = p.z - fz * dist, ground = R.world.heightAt(cx, cz), cy = Math.max(cs.gy + C.height + cs.lift, ground + 1.0);
      var py = Math.max(0, p.fallT > 0 ? 0 : p.y), pgy = p.fallT > 0 ? cs.gy : p.gy || 0;
      if (shake > 0) { cx += (Math.random() - 0.5) * shake * 0.5; cy += (Math.random() - 0.5) * shake * 0.3; cz += (Math.random() - 0.5) * shake * 0.5; }
      raceCam.position.set(cx, cy, cz);
      raceCam.lookAt(p.x + fx * C.ahead, pgy + C.lookY + py * 0.55, p.z + fz * C.ahead);
      var ovc = window.__rbCam; if (ovc) { raceCam.position.set(ovc.x, ovc.y, ovc.z); raceCam.lookAt(ovc.tx, ovc.ty, ovc.tz); }
      var fov = C.fov + CAM.boostFov * cs.boost;
      if (raceCam.fov !== fov || raceCam.aspect !== cssW / cssH) { raceCam.fov = fov; raceCam.aspect = cssW / cssH; raceCam.updateProjectionMatrix(); }
      raceCam.updateMatrixWorld();
      var camFwd = V2.set(fx, 0, fz), playerDepth = dist;
      // cars
      r.cars.forEach(function (c, i) {
        var st = R.cars[i], key = lookKey(c.carId, c.look);
        if (!st || st.key !== key) { if (st) freeCar(st.obj); st = R.cars[i] = { obj: newCarObj(c.carId, c.look, i > 0), key: key, spin: 0, pitchS: 0, alpha: 1 }; sc.add(st.obj); }
        poseCar(st, c, dt, raceCam.position, camFwd, playerDepth, r);
        if (dt > 0) carEmit(c, st, r, dt);
      });
      for (var k = r.cars.length; k < R.cars.length; k++) if (R.cars[k]) { freeCar(R.cars[k].obj); R.cars[k] = null; }
      // crates bob and turn; they pop back in after their respawn time
      g.boxes.forEach(function (b, i) {
        var want = r.boxes[i].t > 0 ? 0 : 1; R.crateS[i] += (want - R.crateS[i]) * Math.min(1, dt * (want ? 6 : 20));
        var s = R.crateS[i] < 0.02 ? 0 : R.crateS[i];
        var by = D.groundAt ? D.groundAt(g, b.s) : 0;
        M4.compose(V.set(b.x, by + 0.62 + Math.sin(time * 3 + i) * 0.12, b.z), QT.setFromAxisAngle(UP, time * 1.5 + i), S1.set(s, s, s)); R.crates.set(i, M4);
        if (s > 0.5 && Math.random() < dt * 2) instant.push({ x: b.x, y: by + 0.7, z: b.z, col: '#ffe9a0', size: 1.6, glow: true, a: 0.25 });
      });
      R.crates.done();
      g.coins.forEach(function (cn, i) {
        var s = r.coins[i].t > 0 ? 0 : 1;
        M4.compose(V.set(cn.x, (D.groundAt ? D.groundAt(g, cn.s) : 0) + 0.5 + Math.sin(time * 4 + i) * 0.06, cn.z), QT.setFromAxisAngle(UP, time * 4 + i * 0.7), S1.set(s, s, s)); R.coins.set(i, M4);
      });
      R.coins.done();
      // goo puddles and bees, pooled
      while (R.goos.length < r.goos.length) { var go = compactAll(make('goo', stubGoo)); go.traverse(function (m) { if (m.isMesh) m.receiveShadow = true; }); sc.add(go); R.goos.push(go); }
      R.goos.forEach(function (o, i) { var gp = r.goos[i]; o.visible = !!gp; if (gp) { o.position.set(gp.x, (D.groundAt ? D.groundAt(g, g.query(gp.x, gp.z).s) : 0) + 0.005, gp.z); var s = 25 - gp.t + 0.3; o.scale.setScalar(Math.min(1, s * 3)); } });
      while (R.bees.length < r.bees.length) { var be = make('bee', stubBee); if (be.userData && typeof be.userData.flap === 'function') { var db = movers(be, be.userData.flap); db.add(be); compact(be, db); } be.traverse(function (m) { if (m.isMesh) m.castShadow = true; }); sc.add(be); R.bees.push(be); }
      R.bees.forEach(function (o, i) {
        var b = r.bees[i]; o.visible = !!b; if (!b) return;
        o.position.set(b.x, (D.groundAt ? D.groundAt(g, g.query(b.x, b.z).s) : 0) + 1 + Math.sin(time * 20 + i) * 0.08, b.z); o.rotation.y = -(b.h || 0);
        if (typeof o.userData.flap === 'function') o.userData.flap(time + i); else (o.userData.wings || []).forEach(function (w, k) { w.rotation.x = Math.sin(time * 60 + k * Math.PI) * 0.8; });
      });
      // hazards walk and roll across the road
      (R.world.hazards || []).forEach(function (o, i) {
        var hz = D.hazardAt(r, i); o.position.set(hz.x, (D.groundAt ? D.groundAt(g, hz.s) : 0) + hz.y, hz.z); o.rotation.y = -hz.h;
        if (o.userData.pose) o.userData.pose(hz, r.t);
      });
      // shadows follow the player
      aimSun(R.world, p.x + fx * 10, p.z + fz * 10, phone ? 22 : 28);
      flushParts();
      var o = { speed: cs.boost * 0.9, bloom: 0.5, thr: 1.5, vig: 0.3 };
      present(sc, raceCam, o);
      logOnce('race ' + r.id);
      overlayRace(r);
    }
    // pixels per cell at a world point, and its screen position (overlay pixels), or null behind the camera
    function project(cam, x, y, z) {
      V.set(x, y, z).applyMatrix4(cam.matrixWorldInverse); var d = -V.z; if (d < 0.3) return null;
      V.set(x, y, z).project(cam);
      var px = (V.x * 0.5 + 0.5) * cssW * ovr, py = (-V.y * 0.5 + 0.5) * cssH * ovr, k = cssH * ovr * 0.5 / Math.tan(cam.fov * Math.PI / 360) / d;
      return { x: px, y: py, k: k, d: d };
    }
    function overlayRace(r) {
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height);
      octx.textAlign = 'center'; octx.textBaseline = 'bottom';
      r.cars.forEach(function (c) {
        if (c.i === 0) return;
        var t = project(raceCam, c.x, (c.gy || 0) + Math.max(0, c.y) + 1.45, c.z); if (!t || t.d > 45 || c.fallT > 0) return;
        var fs = Math.round(Math.max(10 * ovr, Math.min(22 * ovr, t.k * 0.3)));
        octx.font = '600 ' + fs + 'px Fredoka, sans-serif'; octx.lineWidth = 3 * ovr; octx.strokeStyle = '#000a';
        var label = c.place + ' ' + c.name; octx.strokeText(label, t.x, t.y); octx.fillStyle = '#fff7e8'; octx.fillText(label, t.x, t.y);
      });
      floaters.forEach(function (f) {
        var q = project(raceCam, f.x, f.y + f.t * 1.4, f.z); if (!q) return;
        octx.globalAlpha = Math.max(0, 1 - f.t / 1.3);
        octx.font = '700 ' + Math.round(Math.max(16 * ovr, ov.height * 0.04)) + 'px Fredoka, sans-serif'; octx.lineWidth = 4 * ovr; octx.strokeStyle = '#000b'; octx.strokeText(f.text, q.x, q.y); octx.fillStyle = f.col; octx.fillText(f.text, q.x, q.y);
        octx.globalAlpha = 1;
      });
    }

    // ---------- minimap (the 2D one from render.js) ----------
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
    // the camera looks down the plaza's isometric diagonal (toward -x, -z) from PITCH above the ground
    var PITCH = 40 * Math.PI / 180, HUB_K = 1 / Math.sin(PITCH);
    var STATION_ICON = { garage: '🔧', paint: '🎨', lot: '🚗', track: '🏁' };
    function buildHub() {
      if (hubS) return hubS;
      var w = W3.hub(D.HUB), sc = sceneFor(w);
      hubS = { world: w, scene: sc, parked: [], key: '', kid: null, cam: { x: 0, z: 0, init: false } };
      var kid = make('kid', stubKid); kid.traverse(function (m) { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      if (kid.userData && typeof kid.userData.anim === 'function') { var dk = movers(kid, kid.userData.anim); dk.add(kid); compact(kid, dk); } sc.add(kid); hubS.kid = kid;
      // a soft glow under the selected car
      var sel = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 40), new THREE.MeshBasicMaterial({ color: col('#ffd23f'), transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      sel.rotation.x = -Math.PI / 2; sel.visible = false; sc.add(sel); hubS.sel = sel;
      return hubS;
    }
    function drawHub(S0, h, dt) {
      if (failed) return OLD.drawHub(S0, h, dt);
      var H = buildHub(), sc = H.scene, w = H.world;
      time += dt; stepParts(dt); w.update(time);
      // owned cars parked in the lot's bays, nose to the plaza
      var key = S0.owned.map(function (id) { return lookKey(id, S0.cars[id] && S0.cars[id].look); }).join(';');
      if (key !== H.key) {
        H.parked.forEach(function (o) { freeCar(o.obj); }); H.parked = [];
        S0.owned.slice(0, w.bays.length).forEach(function (id, k) {
          var o = newCarObj(id, S0.cars[id].look), b = w.bays[k];
          o.position.set(b.x, 0, b.z); o.rotation.y = -b.h; sc.add(o); H.parked.push({ id: id, obj: o });
        });
        H.key = key;
      }
      H.sel.visible = false;
      H.parked.forEach(function (pk) { if (pk.id === S0.car) { H.sel.visible = true; H.sel.position.set(pk.obj.position.x, 0.04, pk.obj.position.z); H.sel.material.opacity = 0.35 + 0.2 * Math.sin(time * 4); } });
      // the kid
      var kid = H.kid; kid.position.set(h.x, 0, h.z); kid.rotation.y = -(h.face || 0);
      if (kid.userData && typeof kid.userData.anim === 'function') kid.userData.anim(time, !!h.moving);
      // fountain spray
      if (dt > 0 && Math.random() < 0.7) { var fc = w.fountain; addPart({ x: fc.x, y: 1.25, z: fc.z, vx: (Math.random() - 0.5) * 1.2, vy: 2.2, vz: (Math.random() - 0.5) * 1.2, life: 0.7, max: 0.7, col: '#dff6ff', size: 0.16, glow: false, grav: true, a: 0.8 }); }
      // camera, smoothed onto the kid, centred in the part of the screen no panel covers
      var cs = H.cam;
      if (!cs.init) { cs.x = h.x; cs.z = h.z; cs.init = true; }
      var k = Math.min(1, dt * 6); cs.x += (h.x - cs.x) * k; cs.z += (h.z - cs.z) * k;
      var tall = cssH > cssW, Dh = tall ? 30 : 26;
      hubCam.position.set(cs.x + Math.cos(PITCH) * Dh / Math.SQRT2, Math.sin(PITCH) * Dh, cs.z + Math.cos(PITCH) * Dh / Math.SQRT2);
      hubCam.lookAt(cs.x, 0.4, cs.z);
      hubCam.fov = tall ? 34 : 26; hubCam.aspect = cssW / cssH;
      hubCam.setViewOffset(cssW, cssH, view.right / 2, view.bottom / 2, cssW, cssH);
      hubCam.updateProjectionMatrix(); hubCam.updateMatrixWorld();
      aimSun(w, cs.x - 2, cs.z - 2, phone ? 16 : 20);
      flushParts();
      present(sc, hubCam, { bloom: 0.5, thr: 1.15, vig: 0.4 });
      logOnce('plaza');
      // station icons over the pads
      octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, ov.width, ov.height);
      octx.textAlign = 'center'; octx.textBaseline = 'middle';
      w.pads.forEach(function (pd) {
        var q = projectHub(pd.x, 1.5 + Math.sin(time * 3) * 0.1, pd.z); if (!q) return;
        octx.font = Math.round(Math.max(18 * ovr, q.k * 0.65)) + 'px sans-serif'; octx.fillText(STATION_ICON[pd.station] || '', q.x, q.y);
      });
    }
    function projectHub(x, y, z) {
      V.set(x, y, z).applyMatrix4(hubCam.matrixWorldInverse); var d = -V.z; if (d < 0.3) return null;
      V.set(x, y, z).project(hubCam);
      return { x: (V.x * 0.5 + 0.5) * cssW * ovr, y: (-V.y * 0.5 + 0.5) * cssH * ovr, k: cssH * ovr * 0.5 / Math.tan(hubCam.fov * Math.PI / 360) / d };
    }
    // screen (CSS pixels on the canvas) to the plaza ground, by a ray onto y = 0
    var ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
    function screenToWorld(px, py) {
      if (failed) return OLD.screenToWorld(px, py);
      ndc.set(px / cssW * 2 - 1, -(py / cssH) * 2 + 1);
      ray.setFromCamera(ndc, hubCam);
      var hit = ray.ray.intersectPlane(plane, V);
      return hit ? { x: hit.x, z: hit.z } : { x: -1, z: -1 };
    }
    // a screen direction (dy down) to a world heading: screen right is world (1, -1)/√2, screen down is (1, 1)/√2
    // foreshortened by the camera's pitch
    function screenDirToHeading(dx, dy) { if (failed) return OLD.screenDirToHeading(dx, dy); return Math.atan2(HUB_K * dy - dx, dx + HUB_K * dy); }

    return { setView: setView, init: init, resize: resize, drawRace: drawRace, drawHub: drawHub, drawMinimap: drawMinimap, events: events,
      screenToWorld: screenToWorld, screenDirToHeading: screenDirToHeading, warm: warm, isHD: function () { return !failed; },
      SKY: W3.LOOK, DOF: OLD.DOF, CAM: CAM, get renderer() { return renderer; }, _scene: function () { return race ? race.scene : hubS && hubS.scene; } };
  })();

  // car previews for the splash and the garage panels: a 3D render the size of the old pixel sprite
  var oldPreview = SPR.carPreview;
  SPR.carPreview = function (id, look, h, scale) {
    var base = oldPreview(id, look, h, scale);
    if (!active || typeof RB3DModels === 'undefined' || typeof RB3DModels.preview !== 'function') return base;
    try { var c = RB3DModels.preview(id, look, h, base.width, base.height); if (c) { var cp = document.createElement('canvas'); cp.width = c.width; cp.height = c.height; cp.getContext('2d').drawImage(c, 0, 0); return cp; } } catch (e) { console.error('RB3DModels.preview:', e); }
    return base;
  };
})();
