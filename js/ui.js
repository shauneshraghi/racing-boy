// Racing Boy: state, saving, HUDs, plaza panels, race flow, input and the main loop.
// Uses RB (logic), RBRender, RBSprites and RBAudio. Exposes window.__game for tests and dev work.
(function () {
  'use strict';
  var D = RB, R = RBRender, A = RBAudio, SP = RBSprites;
  var SAVE_KEY = 'racing-boy-v1';
  var params = new URLSearchParams(location.search);
  var DEV = params.get('dev') === '1', FRESH = params.get('fresh') === '1', NOSAVE = DEV || FRESH;

  // ---------- state and saving ----------
  function load() {
    try { var raw = FRESH ? null : localStorage.getItem(SAVE_KEY); if (raw) { var s = D.deserialize(raw); if (s) return s; } } catch (e) {}
    return D.newState(+(params.get('seed')) || (Date.now() % 1e9));
  }
  var S = load();
  if (DEV) {
    S.coins = Math.max(S.coins, 1e6); S.parts = [999, 999, 999, 999, 999];
    D.WORLDS.forEach(function (w) { w.tracks.forEach(function (t) { S.best[t] = S.best[t] || 1; }); });
  }
  if (params.has('car') && D.CARS[params.get('car')]) { var pc = params.get('car'); if (S.owned.indexOf(pc) < 0) { S.owned.push(pc); S.cars[pc] = D._newCar(pc); } S.car = pc; }
  function save() { if (NOSAVE) return; try { localStorage.setItem(SAVE_KEY, D.serialize(S)); } catch (e) {} }
  setInterval(save, 5000);
  window.addEventListener('pagehide', save);

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function fmt(n) { n = Math.floor(n); if (n < 10000) return '' + n; if (n < 1e6) return (n / 1000).toFixed(n < 1e5 ? 1 : 0) + 'K'; return (n / 1e6).toFixed(1) + 'M'; }
  function fmtT(t) { var m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
  function ord(n) { return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }
  function ordSmall(n) { return n + '<small>' + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th') + '</small>'; }
  function audio() { try { A.init(); } catch (e) {} }
  function toast(html, ms) {
    var el = document.createElement('div'); el.className = 'toast'; el.innerHTML = html;
    $('toast').appendChild(el); setTimeout(function () { el.remove(); }, ms || 2400);
    while ($('toast').children.length > 3) $('toast').firstChild.remove();
  }
  function banner(text) { var b = $('banner'); b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
  function costHtml(cost) {
    if (!cost) return '';
    var out = [];
    if (cost.coins) out.push('<span class="' + (S.coins < cost.coins ? 'short' : '') + '">🪙 ' + fmt(cost.coins) + '</span>');
    cost.parts.forEach(function (n, i) { if (n) out.push('<span class="' + (S.parts[i] < n ? 'short' : '') + '">' + D.PARTS[i].icon + ' ' + n + '</span>'); });
    return out.join(' ') || 'free';
  }

  // ---------- mode ----------
  var mode = 'hub', hub = D.newHub(), race = null, raceEnd = 0, results = null, paused = false;
  function setMode(m) {
    mode = m;
    $('hubHud').classList.toggle('show', m === 'hub');
    $('hubHint').classList.toggle('show', m === 'hub' && !station);
    $('raceHud').classList.toggle('show', m === 'race');
    $('raceCtl').classList.toggle('show', m === 'race');
    A.setMood(m === 'race' ? 'race' : 'hub');
    if (m !== 'race') A.setEngine(false, 0, false);
  }

  // ---------- plaza HUD and panels ----------
  function updateHubHud() {
    $('hCoins').textContent = '🪙 ' + fmt(S.coins);
    $('hParts').innerHTML = D.PARTS.map(function (p, i) { return S.parts[i] || i === 0 ? p.icon + ' ' + fmt(S.parts[i]) : ''; }).filter(Boolean).join(' &nbsp;');
  }
  var station = null, tab = { paint: 'paint' }, panelKey = '';
  var TITLES = { garage: '🔧 Garage', paint: '🎨 Paint shop', lot: '🚗 Car lot', track: '🏁 Races', menu: '☰ Menu' };
  function openStation(st) {
    if (station === st) return;
    station = st; panelKey = '';
    $('panel').classList.toggle('show', !!st);
    $('hubHint').classList.toggle('show', mode === 'hub' && !st);
    if (st) { A.sfx('click'); renderPanel(); }
    fitView();
  }
  var WIDE = window.matchMedia('(min-aspect-ratio: 1/1) and (min-width: 700px)');
  function fitView() {
    var pr = $('panel').getBoundingClientRect(), side = WIDE.matches;
    R.setView(station && side ? pr.width : 0, station && !side ? pr.height : 0);
  }
  window.addEventListener('resize', fitView);
  function previewCanvas(id, look, h, scale) {
    var c = SP.carPreview(id, look, h, scale || 4); c.className = 'preview'; return c;
  }
  function renderPanel() {
    var body = $('pBody'), tabs = $('pTabs');
    $('pTitle').textContent = TITLES[station] || '';
    body.innerHTML = ''; tabs.innerHTML = '';
    var car = S.car, C = D.CARS[car];
    if (station === 'garage') {
      body.appendChild(previewCanvas(car, S.cars[car].look, 0.6));
      body.insertAdjacentHTML('beforeend', '<p class="note">Upgrading <b>' + C.name + '</b>. Each car keeps its own upgrades. Higher levels need ⚙️ gears, won by finishing 1st.</p>');
      D.UP_KEYS.forEach(function (k) {
        var U = D.UPGRADES[k], lvl = S.cars[car].up[k], cap = C.caps[k], cost = D.upgradeCost(S, car, k);
        var pips = ''; for (var i = 0; i < cap; i++) pips += i < lvl ? '■' : '<i>■</i>';
        var row = document.createElement('div'); row.className = 'row';
        row.innerHTML = '<div class="ico">' + U.icon + '</div><div class="grow"><h3>' + U.name + ' <span class="pips">' + pips + '</span></h3><p>' + U.desc + '</p><div class="cost">' + (cost ? costHtml(cost) : 'Maxed out!') + '</div></div>';
        var b = document.createElement('button'); b.className = 'btn go'; b.textContent = cost ? 'Upgrade' : 'Max';
        b.disabled = !cost || !D.canAfford(S, cost);
        b.onclick = function () { if (D.buyUpgrade(S, car, k)) { A.sfx('buy'); toast(U.icon + ' ' + U.name + ' level ' + S.cars[car].up[k] + '!'); save(); renderPanel(); } else A.sfx('no'); };
        row.appendChild(b); body.appendChild(row);
      });
    } else if (station === 'lot') {
      body.insertAdjacentHTML('beforeend', '<p class="note">Pick the car you race with. Every car has its own perk.</p>');
      Object.keys(D.CARS).forEach(function (id) {
        var K = D.CARS[id], own = S.owned.indexOf(id) >= 0, row = document.createElement('div'); row.className = 'row';
        var look = own ? S.cars[id].look : D._newCar(id).look;
        var pv = previewCanvas(id, look, 0.6, 2); pv.style.width = '96px'; pv.style.margin = '0';
        row.appendChild(pv);
        var info = document.createElement('div'); info.className = 'grow';
        info.innerHTML = '<h3>' + K.name + ' <small style="color:var(--muted)">' + K.kind + '</small></h3><p>✨ <b>' + D.PERKS[K.perk].name + '</b>: ' + D.PERKS[K.perk].desc + '</p>' + statBarsFor(id, own) + (own ? '' : '<div class="cost">' + costHtml(K.cost) + '</div>');
        row.appendChild(info);
        var b = document.createElement('button'); b.className = 'btn' + (own ? '' : ' go');
        if (own) { b.textContent = id === S.car ? '✓ Driving' : 'Drive'; b.disabled = id === S.car; b.onclick = function () { D.selectCar(S, id); A.horn(S.cars[id].look.horn); save(); renderPanel(); }; }
        else { b.textContent = 'Buy'; b.disabled = !D.canAfford(S, K.cost); b.onclick = function () { if (D.buyCar(S, id)) { D.selectCar(S, id); A.sfx('unlock'); toast('🚗 ' + K.name + ' is yours!'); save(); renderPanel(); } else A.sfx('no'); }; }
        row.appendChild(b); body.appendChild(row);
      });
    } else if (station === 'paint') {
      var slots = { paint: '🎨 Paint', trim: '✏️ Trim', wheels: '🛞 Wheels', spoiler: '🪽 Spoiler', exhaust: '💨 Exhaust', horn: '📯 Horn', trail: '✨ Boost trail' };
      D.LOOK_KEYS.forEach(function (k) {
        var t = document.createElement('button'); t.textContent = slots[k]; t.className = tab.paint === k ? 'on' : '';
        t.onclick = function () { tab.paint = k; A.sfx('click'); renderPanel(); }; tabs.appendChild(t);
      });
      var look = S.cars[car].look;
      body.appendChild(previewCanvas(car, look, 0.6 + (tab.paint === 'spoiler' || tab.paint === 'exhaust' ? 2.4 : 0)));
      var grid = document.createElement('div'); grid.className = 'grid';
      D.LOOKS[tab.paint].forEach(function (o) {
        var owned = S.looks[tab.paint].indexOf(o.id) >= 0, on = look[tab.paint] === o.id;
        var b = document.createElement('button'); b.className = 'opt' + (on ? ' on' : '');
        b.innerHTML = (o.c ? '<span class="sw" style="background:' + o.c + '"></span>' : '') + o.name + '<small class="' + (!owned && S.coins < o.cost ? 'short' : '') + '">' + (on ? '✓ on' : owned ? 'owned' : '🪙 ' + o.cost) + '</small>';
        b.onclick = function () {
          if (!owned) { if (!D.buyLook(S, tab.paint, o.id)) { A.sfx('no'); toast('Not enough coins yet'); return; } A.sfx('buy'); }
          D.equip(S, car, tab.paint, o.id);
          if (tab.paint === 'horn') A.horn(o.id); else A.sfx('click');
          save(); renderPanel();
        };
        grid.appendChild(b);
      });
      body.appendChild(grid);
      body.insertAdjacentHTML('beforeend', '<p class="note">Bought paint and parts can be used on any of your cars.</p>');
    } else if (station === 'track') {
      D.WORLDS.forEach(function (W, wi) {
        var open = D.worldUnlocked(S, wi);
        body.insertAdjacentHTML('beforeend', '<div class="world' + (open ? '' : ' locked') + '">' + (open ? '🌍 ' : '🔒 ') + W.name + (W.tracks.length ? '' : ' <small>· coming soon</small>') + '</div>');
        W.tracks.forEach(function (id) {
          var T = D.TRACKS[id], un = D.trackUnlocked(S, id), best = S.best[id];
          var row = document.createElement('div'); row.className = 'row';
          row.innerHTML = '<div class="ico">' + (best === 1 ? '🏆' : un ? '🏁' : '🔒') + '</div><div class="grow"><h3>' + T.name + '</h3><p>' + T.laps + ' laps' +
            (best ? ' · best place ' + ord(best) + ' · best time ' + fmtT(S.bestT[id]) : '') + (un ? '' : ' · win the track before to open') + '</p></div>';
          var b = document.createElement('button'); b.className = 'btn big'; b.textContent = 'Race!'; b.disabled = !un;
          b.onclick = function () { startRace(id); };
          row.appendChild(b); body.appendChild(row);
        });
      });
      body.insertAdjacentHTML('beforeend', '<p class="note">Only a 1st place opens the next track. Every finish pays coins and parts.</p>');
    } else if (station === 'menu') {
      [['🔧 Garage', 'garage'], ['🎨 Paint shop', 'paint'], ['🚗 Car lot', 'lot'], ['🏁 Races', 'track']].forEach(function (p) {
        var b = document.createElement('button'); b.className = 'btn'; b.style.cssText = 'width:100%;margin-bottom:8px'; b.textContent = p[0];
        b.onclick = function () { station = null; openStation(p[1]); }; body.appendChild(b);
      });
      var m = document.createElement('button'); m.className = 'btn'; m.style.cssText = 'width:100%;margin-bottom:8px';
      m.textContent = A.isMuted() ? '🔇 Sound off' : '🔊 Sound on'; m.onclick = function () { A.setMute(!A.isMuted()); renderPanel(); }; body.appendChild(m);
      body.insertAdjacentHTML('beforeend', '<p class="note">Keys: ← → steer · ↓ or Space drift, brake, and trick in the air · ↑ or X use item · H horn · Esc pause. On a phone, hold ◀ ▶, or drag anywhere on the track to point the car.</p>');
      var so = document.createElement('button'); so.className = 'btn'; so.style.cssText = 'font-size:14px;background:#5a2030'; so.textContent = 'Start over…';
      so.onclick = function () {
        if ($('confirm')) return;
        var box = document.createElement('div'); box.id = 'confirm';
        box.innerHTML = '<input id="cIn" placeholder="type yes to wipe the save"><button class="btn" id="cGo">OK</button>';
        body.appendChild(box); $('cIn').focus();
        $('cGo').onclick = function () { if ($('cIn').value.trim().toLowerCase() === 'yes') { S = D.newState(Date.now() % 1e9); save(); station = null; openStation(null); toast('A fresh start!'); } else box.remove(); };
      };
      body.appendChild(so);
    }
  }
  function statBarsFor(id, own) {
    var st = own ? D.carStats(S, id) : D.statsFor(id), rows = [['Speed', st.speed / 12], ['Pick-up', st.accel / 9], ['Grip', st.grip / 3.2], ['Weight', st.weight / 2]];
    return rows.map(function (r) { return '<div class="stat"><span>' + r[0] + '</span><b style="width:' + Math.round(Math.min(1, r[1]) * 100) + 'px"></b></div>'; }).join('');
  }
  $('bClose').onclick = function () { closePanel(); };
  function closePanel() { var st = station; openStation(null); if (st && st !== 'menu') hubStepOff(); }
  // after closing a station's panel, step the kid off the pad so it does not reopen at once
  var padLock = null;
  function hubStepOff() { padLock = D.hubStation(hub); }
  $('bMenu').onclick = function () { audio(); if (station === 'menu') openStation(null); else { station = null; openStation('menu'); } };

  // ---------- race flow ----------
  function startRace(id) {
    audio();
    openStation(null);
    race = D.startRace(S, id);
    results = null; raceEnd = 0; paused = false;
    $('results').classList.remove('show'); $('pause').classList.remove('show');
    setMode('race');
    R.warm(id);
    lastCount = -1;
    A.horn(S.cars[S.car].look.horn);
  }
  var lastCount = -1;
  function raceEvents(r) {
    var list = r.events.splice(0, r.events.length);
    R.events(r, list);
    list.forEach(function (e) {
      var me = e.car === 0;
      if (e.type === 'count') { showCount(e.n); A.sfx('count'); }
      else if (e.type === 'go') { showCount('GO!'); A.sfx('go'); }
      if (!me) return;
      if (e.type === 'boost') A.sfx('boost');
      else if (e.type === 'coin') A.sfx('coin');
      else if (e.type === 'box') A.sfx('box');
      else if (e.type === 'item') A.sfx('item');
      else if (e.type === 'hit') A.sfx('hit');
      else if (e.type === 'blocked') A.sfx('blocked');
      else if (e.type === 'wall') A.sfx('wall');
      else if (e.type === 'bump') A.sfx('bump');
      else if (e.type === 'jump') A.sfx('jump');
      else if (e.type === 'land') A.sfx('land');
      else if (e.type === 'trick') A.sfx('trick');
      else if (e.type === 'splash') { A.sfx('splash'); banner('Splash!'); }
      else if (e.type === 'drift') A.sfx('drift');
      else if (e.type === 'lap') { if (e.lap === r.laps) { banner('Final lap!'); A.sfx('finalLap'); } else { banner('Lap ' + e.lap); A.sfx('lap'); } }
      else if (e.type === 'raceOver') { banner(e.place === 1 ? '🏆 You win!' : 'Finished ' + ord(e.place)); A.sfx(e.place === 1 ? 'win' : 'finish'); raceEnd = 2.6; }
    });
  }
  function showCount(t) { var c = $('count'); c.textContent = t; c.className = ''; void c.offsetWidth; c.className = 'show' + (t === 'GO!' ? ' go' : ''); setTimeout(function () { if (c.textContent === String(t)) c.className = ''; }, 900); }
  function updateRaceHud(r) {
    var p = r.cars[0];
    $('hPlace').innerHTML = ordSmall(p.place);
    $('hLap').textContent = 'Lap ' + Math.min(r.laps, Math.max(1, p.lap)) + '/' + r.laps;
    $('hTime').textContent = fmtT(r.t);
    $('hRaceCoins').textContent = '🪙 ' + p.coins;
    var bi = $('bItem');
    bi.classList.toggle('empty', !p.item); bi.classList.toggle('rolling', !!p.item && p.rollT > 0); bi.classList.toggle('ready', !!p.item && p.rollT <= 0);
    if (p.item && p.rollT > 0) { var keys = D.ITEM_KEYS, k = keys[Math.floor(Date.now() / 90) % keys.length]; $('itemIcon').textContent = D.ITEMS[k].icon; $('itemName').textContent = '…'; }
    else if (p.item) { $('itemIcon').textContent = D.ITEMS[p.item].icon; $('itemName').textContent = D.ITEMS[p.item].name; }
    else { $('itemIcon').textContent = ''; $('itemName').textContent = 'no item'; }
    R.drawMinimap($('mini'), r);
  }
  function showResults() {
    var r = race, res = D.finishRace(S, r);
    results = res; save();
    var rows = r.order.map(function (c) { return '<tr class="' + (c.i === 0 ? 'me' : '') + '"><td>' + ord(c.place) + '</td><td>' + c.name + '</td><td>' + D.CARS[c.carId].name + '</td><td>' + fmtT(c.finishT) + '</td></tr>'; }).join('');
    var parts = res.parts.map(function (n, i) { return n ? D.PARTS[i].icon + ' +' + n : ''; }).filter(Boolean).join(' ');
    var list = D.WORLDS[r.world].tracks, next = list[list.indexOf(r.id) + 1];
    var el = $('results');
    el.innerHTML = '<h2>' + D.TRACKS[r.id].name + '</h2><div class="place">' + ord(res.place) + '</div>' +
      '<table>' + rows + '</table>' +
      '<div class="pay">🪙 +' + res.coins + ' <small>(' + res.trackCoins + ' picked up)</small> &nbsp; ' + parts + (res.newBest ? '<br>⏱ New best time!' : '') + '</div>' +
      res.unlocked.map(function (u) { return '<div class="unlock">🔓 ' + u + ' is open!</div>'; }).join('') +
      (res.place > 1 ? '<p class="note">Win 1st to open the next track. Upgrades in the 🔧 Garage help!</p>' : '') +
      '<div class="btns"><button class="btn" id="rAgain">🔁 Race again</button>' + (next && D.trackUnlocked(S, next) ? '<button class="btn big" id="rNext">Next: ' + D.TRACKS[next].name + '</button>' : '') + '<button class="btn" id="rHome">🏠 Garage</button></div>';
    el.classList.add('show');
    $('rAgain').onclick = function () { startRace(r.id); };
    if ($('rNext')) $('rNext').onclick = function () { startRace(next); };
    $('rHome').onclick = goHome;
    if (res.unlocked.length) A.sfx('unlock');
  }
  function goHome() {
    $('results').classList.remove('show'); $('pause').classList.remove('show');
    race = null; S.race = null; paused = false; hub = D.newHub(); setMode('hub'); updateHubHud();
  }
  function setPause(on) {
    if (mode !== 'race' || results) return;
    paused = on; $('pause').classList.toggle('show', on);
    $('bMute2').textContent = A.isMuted() ? '🔇 Sound off' : '🔊 Sound on';
    if (on) A.setEngine(false, 0, false);
  }
  $('bPause').onclick = function () { setPause(!paused); };
  $('bResume').onclick = function () { setPause(false); };
  $('bQuit').onclick = function () { goHome(); };
  $('bMute2').onclick = function () { A.setMute(!A.isMuted()); $('bMute2').textContent = A.isMuted() ? '🔇 Sound off' : '🔊 Sound on'; };

  // ---------- input ----------
  var keys = {}, held = { left: false, right: false, drift: false }, itemTap = false, stick = null;
  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    audio();
    var k = e.key;
    if (k === 'Escape') { if (mode === 'race') setPause(!paused); else if (station) closePanel(); else openStation('menu'); e.preventDefault(); return; }
    if (k === 'm' || k === 'M') { A.setMute(!A.isMuted()); return; }
    if (mode === 'race' && (k === 'h' || k === 'H')) { A.horn(S.cars[S.car].look.horn); return; }
    if (!$('splash').classList.contains('hide') && (k === 'Enter' || k === ' ')) { start(); e.preventDefault(); return; }
    if (mode === 'race' && results && k === 'Enter') { startRace(race.id); return; }
    if (mode === 'race' && ['ArrowUp', 'w', 'W', 'x', 'X', 'e', 'E', 'Enter'].indexOf(k) >= 0 && !e.repeat) itemTap = true;
    keys[k.length === 1 ? k.toLowerCase() : k] = true;
    if (k.indexOf('Arrow') === 0 || k === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { var k = e.key; keys[k.length === 1 ? k.toLowerCase() : k] = false; });
  window.addEventListener('blur', function () { keys = {}; held.left = held.right = held.drift = false; stick = null; $('stick').classList.remove('show'); });
  function holdBtn(id, name) {
    var b = $(id);
    function on(e) { e.preventDefault(); audio(); held[name] = true; b.classList.add('held'); try { b.setPointerCapture(e.pointerId); } catch (er) {} }
    function off() { held[name] = false; b.classList.remove('held'); }
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  }
  holdBtn('bLeft', 'left'); holdBtn('bRight', 'right'); holdBtn('bDrift', 'drift');
  $('bItem').addEventListener('pointerdown', function (e) { e.preventDefault(); audio(); itemTap = true; });
  // the scene: in a race a drag points the car; on the plaza a tap walks there and a drag walks that way
  var cvEl = $('cv'), down = null;
  cvEl.addEventListener('pointerdown', function (e) {
    audio();
    down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false };
    try { cvEl.setPointerCapture(e.pointerId); } catch (er) {}
  });
  cvEl.addEventListener('pointermove', function (e) {
    if (!down || e.pointerId !== down.id) return;
    var dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 12) { down.moved = true; var st = $('stick'); st.style.left = down.x + 'px'; st.style.top = down.y + 'px'; st.classList.add('show'); }
    if (down.moved) {
      var l = Math.hypot(dx, dy), m = Math.min(l, 50), kx = l ? dx / l * m : 0, ky = l ? dy / l * m : 0;
      $('knob').style.transform = 'translate(' + kx + 'px,' + ky + 'px)';
      stick = l > 14 ? { dx: dx, dy: dy } : null;
    }
  });
  function upHandler(e) {
    if (!down || e.pointerId !== down.id) return;
    if (!down.moved && mode === 'hub' && !station) { var w = R.screenToWorld(e.clientX - cvEl.getBoundingClientRect().left, e.clientY - cvEl.getBoundingClientRect().top); if (D.hubWalkTo(hub, w.x, w.z)) padLock = null; }
    down = null; stick = null; $('stick').classList.remove('show'); $('knob').style.transform = '';
  }
  cvEl.addEventListener('pointerup', upHandler); cvEl.addEventListener('pointercancel', upHandler);
  function raceInput(r) {
    var p = r.cars[0], inp = {};
    var steer = (keys.ArrowLeft || keys.a || held.left ? -1 : 0) + (keys.ArrowRight || keys.d || held.right ? 1 : 0);
    if (steer) inp.steer = steer;
    else if (stick) inp.aim = R.screenDirToHeading(stick.dx, stick.dy);
    inp.drift = !!(keys.ArrowDown || keys.s || keys[' '] || keys.Shift || held.drift);
    inp.item = itemTap; itemTap = false;
    D.input(r, inp);
    if (p.inp) p.inp = inp;
  }
  function hubDir() {
    var sx = 0, sy = 0;
    if (keys.ArrowUp || keys.w) sy -= 1; if (keys.ArrowDown || keys.s) sy += 1;
    if (keys.ArrowLeft || keys.a) sx -= 1; if (keys.ArrowRight || keys.d) sx += 1;
    if (!sx && !sy && stick) { sx = stick.dx; sy = stick.dy; }
    if (!sx && !sy) return null;
    var h = R.screenDirToHeading(sx, sy); return { x: Math.cos(h), z: Math.sin(h) };
  }

  // ---------- main loop ----------
  var last = performance.now(), hudT = 0;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    advance(dt, true);
    requestAnimationFrame(frame);
  }
  function advance(dt, draw) {
    if (mode === 'race' && race) {
      var r = race;
      if (!paused) {
        if (r.phase !== 'done') raceInput(r);
        D.stepRace(r, dt);
        raceEvents(r);
        var p = r.cars[0];
        A.setEngine(true, p.v, p.boostT > 0);
        if (raceEnd > 0) { raceEnd -= dt; if (raceEnd <= 0 && !results) showResults(); }
      }
      if (draw) { R.drawRace(r, paused ? 0 : dt); hudT -= dt; if (hudT <= 0) { updateRaceHud(r); hudT = 0.08; } }
    } else {
      D.hubStep(hub, dt, hubDir());
      var st = D.hubStation(hub);
      if (padLock && st !== padLock) padLock = null;
      if (st && st !== padLock && station !== st && station !== 'menu') openStation(st);
      if (!st && station && station !== 'menu') openStation(null);
      if (draw) { R.drawHub(S, hub, dt); hudT -= dt; if (hudT <= 0) { updateHubHud(); hudT = 0.25; } }
    }
  }
  window.addEventListener('resize', function () { R.resize(); });

  // ---------- start ----------
  R.init($('cv'), $('ov'));
  (function splashCar() {
    var c = $('splashCar'), x = c.getContext('2d'), pv = SP.carPreview(S.car, S.cars[S.car].look, 0.6, 5);
    x.imageSmoothingEnabled = false; x.drawImage(pv, (c.width - pv.width) / 2, (c.height - pv.height) / 2);
  })();
  function start() { audio(); $('splash').classList.add('hide'); }
  $('bStart').onclick = start;
  if (params.get('nosplash') === '1') $('splash').classList.add('hide');
  setMode('hub'); updateHubHud();
  if (params.has('race') && D.TRACKS[params.get('race')]) { $('splash').classList.add('hide'); startRace(params.get('race')); }
  requestAnimationFrame(frame);

  window.__game = {
    get S() { return S; }, D: D, get race() { return race; }, get hub() { return hub; },
    step: function (sec) { var n = Math.ceil(sec / 0.05); for (var i = 0; i < n; i++) advance(0.05, i === n - 1); },
    startRace: startRace, goHome: goHome, openStation: openStation
  };
})();
