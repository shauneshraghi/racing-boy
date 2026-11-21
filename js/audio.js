// Racing Boy: retro sound effects, an engine hum, horns and two music loops (plaza and race), all WebAudio.
// Adapted from Dig Through Worlds' synth helpers. Exposes RBAudio. Call init() from a user gesture.
var RBAudio = (function () {
  'use strict';
  var MUTE_KEY = 'racing-boy-v1-mute';
  var AC = null, master = null, muted = false, musicTimer = null, musicStep = 0, nextNote = 0, mood = 'hub', curMood = '';
  var engine = null, buses = null, noiseBuf = null;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}

  function init() {
    if (AC) { if (AC.state !== 'running') AC.resume(); return; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(AC.destination);
    var n = Math.floor(AC.sampleRate * 0.06); noiseBuf = AC.createBuffer(1, n, AC.sampleRate);
    var d = noiseBuf.getChannelData(0); for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    buses = { hub: AC.createGain(), race: AC.createGain() };
    buses.hub.gain.value = 0; buses.race.gain.value = 0; buses.hub.connect(master); buses.race.connect(master);
    musicTimer = setInterval(scheduleMusic, 50);
    var evs = ['pointerup', 'click', 'touchend', 'keydown'];
    function unlock() { if (AC.state === 'running') { evs.forEach(function (e) { document.removeEventListener(e, unlock, true); }); return; } AC.resume(); }
    evs.forEach(function (e) { document.addEventListener(e, unlock, true); });
  }
  function tone(freq, dur, type, vol, when, slide, dest) {
    if (!AC) return; var t0 = when || AC.currentTime;
    var o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.15, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq, type) {
    if (!AC) return; var n = Math.floor(AC.sampleRate * dur), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    src.buffer = b; f.type = type || 'lowpass'; f.frequency.value = freq || 800; g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(master); src.start();
  }
  function seq(notes, step, type, vol) { var t = AC.currentTime; notes.forEach(function (f, i) { if (f) tone(f, step * 1.3, type || 'square', vol || 0.1, t + i * step); }); }
  var HORNS = {
    beep: function () { tone(660, 0.12, 'square', 0.12); tone(660, 0.14, 'square', 0.12, AC.currentTime + 0.17); },
    honk: function () { tone(300, 0.35, 'sawtooth', 0.12, 0, 0.8); tone(310, 0.35, 'square', 0.06); },
    toot: function () { tone(520, 0.25, 'triangle', 0.18); },
    tune: function () { seq([523, 659, 784, 1047], 0.09, 'square', 0.08); },
    moo: function () { tone(180, 0.6, 'sawtooth', 0.12, 0, 0.7); },
    boing: function () { tone(200, 0.4, 'sine', 0.25, 0, 3.5); }
  };
  var SFX = {
    count: function () { tone(440, 0.18, 'square', 0.12); },
    go: function () { tone(880, 0.45, 'square', 0.14); tone(1320, 0.45, 'triangle', 0.08); },
    boost: function () { noise(0.4, 0.2, 2500, 'bandpass'); tone(300, 0.4, 'sawtooth', 0.06, 0, 3); },
    coin: function () { tone(988, 0.06, 'square', 0.07); tone(1319, 0.18, 'square', 0.07, AC.currentTime + 0.06); },
    box: function () { seq([660, 880, 990, 1320], 0.05, 'square', 0.07); },
    item: function () { tone(500, 0.2, 'triangle', 0.14, 0, 2); },
    hit: function () { noise(0.25, 0.3, 600); tone(400, 0.4, 'square', 0.08, 0, 0.3); },
    blocked: function () { tone(1200, 0.25, 'sine', 0.15, 0, 0.5); },
    wall: function () { noise(0.1, 0.18, 400); },
    bump: function () { tone(140, 0.08, 'square', 0.06); },
    jump: function () { tone(300, 0.3, 'triangle', 0.12, 0, 2.2); },
    hop: function () { tone(420, 0.12, 'triangle', 0.08, 0, 1.6); },
    land: function () { noise(0.12, 0.2, 500); },
    trick: function () { seq([784, 988, 1175], 0.05, 'triangle', 0.1); },
    splash: function () { noise(0.6, 0.3, 1400, 'bandpass'); tone(500, 0.4, 'sine', 0.1, 0, 0.3); },
    lap: function () { seq([784, 0, 784, 1047], 0.08, 'square', 0.09); },
    finalLap: function () { seq([523, 659, 784, 1047, 784, 1047], 0.08, 'square', 0.1); },
    win: function () { seq([523, 659, 784, 1047, 0, 784, 1047, 1319], 0.12, 'square', 0.11); },
    finish: function () { seq([392, 523, 659, 784], 0.12, 'triangle', 0.12); },
    buy: function () { tone(660, 0.08, 'square', 0.1); tone(990, 0.12, 'square', 0.1, AC.currentTime + 0.06); },
    no: function () { tone(160, 0.15, 'square', 0.1); },
    click: function () { tone(1200, 0.04, 'square', 0.05); },
    unlock: function () { seq([784, 988, 1175, 1568], 0.07, 'square', 0.08); },
    drift: function () { noise(0.15, 0.06, 3000, 'highpass'); },
    step: function () { tone(220, 0.05, 'triangle', 0.04); }
  };
  function sfx(n) { if (AC && !muted && SFX[n]) SFX[n](); }
  function horn(id) { if (AC && !muted && HORNS[id]) HORNS[id](); }
  // engine: a buzzy oscillator through a low-pass, its pitch following the speed
  function setEngine(on, speed, boost) {
    if (!AC || muted) { if (engine) { engine.g.gain.setTargetAtTime(0, AC ? AC.currentTime : 0, 0.05); } return; }
    if (!engine) {
      var o = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
      o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(master); o.start(); o2.start();
      engine = { o: o, o2: o2, f: f, g: g };
    }
    var t = AC.currentTime, base = 55 + speed * 9 + (boost ? 40 : 0);
    engine.o.frequency.setTargetAtTime(base, t, 0.08); engine.o2.frequency.setTargetAtTime(base * 0.502, t, 0.08);
    engine.f.frequency.setTargetAtTime(400 + speed * 60 + (boost ? 600 : 0), t, 0.1);
    engine.g.gain.setTargetAtTime(on ? 0.035 + (boost ? 0.02 : 0) : 0, t, 0.08);
  }

  // music: a bouncy major tune on the plaza, a faster driving one in races
  var MAJOR = [0, 2, 4, 5, 7, 9, 11];
  var HUB_MEL = [4, -1, 2, 4, 7, -1, 4, 2, 5, -1, 4, 2, 1, -1, 2, 4, 3, -1, 4, 5, 7, -1, 5, 4, 2, -1, 1, 2, 0, -1, -1, -1];
  var HUB_CH = [0, 5, 3, 4];
  var RACE_MEL = [0, 2, 4, 7, 4, 2, 4, 7, 9, 7, 4, 2, 4, -1, 7, -1, 5, 7, 9, 11, 9, 7, 5, 4, 2, 4, 5, 7, 4, -1, 2, -1];
  var RACE_CH = [0, 0, 5, 4];
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function tick(when, vol, freq, dest) {
    var src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    src.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = freq; g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(dest); src.start(when);
  }
  function step(st, t, race, dest, dur) {
    var s = st % 32, mel = race ? RACE_MEL : HUB_MEL, ch = race ? RACE_CH : HUB_CH, tonic = race ? 50 : 53;
    var d = mel[s];
    if (d >= 0) tone(midi(tonic + 12 + MAJOR[d % 7] + 12 * Math.floor(d / 7)), dur * 0.8, race ? 'square' : 'triangle', race ? 0.055 : 0.07, t, 1, dest);
    var root = tonic - 12 + MAJOR[ch[Math.floor(s / 8)]];
    if (race) { if (s % 2 === 0) tone(midi(root - 12 + (s % 4 ? 7 : 0)), dur * 0.9, 'triangle', 0.1, t, 1, dest); }
    else if (s % 4 === 0) tone(midi(root), dur * 1.8, 'triangle', 0.09, t, 1, dest);
    if (s % 4 === 0) tone(100, 0.1, 'sine', 0.14, t, 0.4, dest);
    if (race && s % 4 === 2) tick(t, 0.06, 2000, dest);
    tick(t, s % 2 ? 0.05 : 0.025, 6500, dest);
  }
  function scheduleMusic() {
    if (!AC || muted) return;
    var now = AC.currentTime;
    if (curMood !== mood) {
      var first = !curMood; curMood = mood; musicStep = 0; nextNote = now + 0.1;
      buses.hub.gain.setTargetAtTime(mood === 'hub' ? 1 : 0, now, first ? 0.05 : 0.3);
      buses.race.gain.setTargetAtTime(mood === 'race' ? 0.8 : 0, now, first ? 0.05 : 0.3);
    }
    if (mood === 'quiet') return;
    var race = mood === 'race', dur = 60 / (race ? 150 : 116) / 2, dest = buses[race ? 'race' : 'hub'];
    if (nextNote < now - 0.5) nextNote = now + 0.05;
    while (nextNote < now + 0.2) { step(musicStep, nextNote, race, dest, dur); nextNote += dur; musicStep++; }
  }
  function setMood(m) { mood = m; }
  function setMute(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.5;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) {}
  }
  return { init: init, sfx: sfx, horn: horn, setEngine: setEngine, setMood: setMood, setMute: setMute, isMuted: function () { return muted; } };
})();
