// Racing Boy: retro sound effects, an engine hum, horns and music (a theme per race track and a plaza theme), all WebAudio.
// Adapted from Dig Through Worlds' synth helpers. Exposes RBAudio. Call init() from a user gesture.
var RBAudio = (function () {
  'use strict';
  var MUTE_KEY = 'racing-boy-v1-mute', VOL_KEY = 'racing-boy-v1-vol';
  var MUSIC_BOOST = 1.6; // about +4 dB on the music bus
  var AC = null, master = null, musicGain = null, sfxGain = null, muted = false, musicTimer = null, musicStep = 0, nextNote = 0, mood = 'hub', curMood = '', track = '';
  var engine = null, buses = null, paused = false, won = false, intensity = 0, pendInt = 0;
  var vol = { music: 1, sfx: 1 };
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  try { var sv = JSON.parse(localStorage.getItem(VOL_KEY) || 'null'); if (sv) ['music', 'sfx'].forEach(function (k) { if (typeof sv[k] === 'number') vol[k] = Math.max(0, Math.min(1, sv[k])); }); } catch (e) {}
  function musicLevel() { return MUSIC_BOOST * vol.music * vol.music * (paused ? 0.4 : 1); }
  function applyVol() {
    if (!AC) return; var t = AC.currentTime;
    musicGain.gain.setTargetAtTime(musicLevel(), t, 0.05); sfxGain.gain.setTargetAtTime(vol.sfx * vol.sfx, t, 0.03);
  }
  function setVolume(kind, v) {
    if (kind !== 'music' && kind !== 'sfx') return;
    vol[kind] = Math.max(0, Math.min(1, +v || 0)); applyVol();
    try { localStorage.setItem(VOL_KEY, JSON.stringify(vol)); } catch (e) {}
  }
  function getVolume(kind) { return vol[kind] == null ? 1 : vol[kind]; }

  // music gain and sfx gain -> compressor (threshold -12 dB, ratio 4) -> a fast safety limiter -> master -> output
  function buildChain(ctx) {
    var master = ctx.createGain(), limiter = ctx.createDynamicsCompressor(), comp = ctx.createDynamicsCompressor();
    master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.08; limiter.connect(master);
    comp.threshold.value = -12; comp.knee.value = 6; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2; comp.connect(limiter);
    var mg = ctx.createGain(), sg = ctx.createGain(); mg.connect(comp); sg.connect(comp);
    mg.gain.value = musicLevel(); sg.gain.value = vol.sfx * vol.sfx;
    return { master: master, musicGain: mg, sfxGain: sg };
  }
  function init() {
    if (AC) { if (AC.state !== 'running') AC.resume(); return; }
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    var ch = buildChain(AC); master = ch.master; musicGain = ch.musicGain; sfxGain = ch.sfxGain;
    buses = { hub: makeBus(AC, musicGain), race: makeBus(AC, musicGain), res: makeBus(AC, musicGain) };
    document.addEventListener('visibilitychange', function () {
      if (!AC) return;
      if (document.hidden) AC.suspend(); else AC.resume();
    });
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
    o.connect(g); g.connect(dest || sfxGain); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, freq, type, sweep, when) {
    if (!AC) return; var t0 = when || AC.currentTime;
    var src = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    src.buffer = noiseFor(AC); f.type = type || 'lowpass'; f.frequency.setValueAtTime(freq || 800, t0);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, (freq || 800) * sweep), t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur); // decaying burst from the one shared noise buffer
    src.connect(f); f.connect(g); g.connect(sfxGain); src.start(t0, Math.random() * 0.5, dur + 0.02);
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
  var coinChain = 0, coinT = -9, COIN_STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
  function chime(f, when, vol, dur) { tone(f, dur || 0.3, 'sine', vol, when); tone(f * 2, (dur || 0.3) * 0.6, 'triangle', vol * 0.3, when); }
  var SFX = {
    count: function (n) { var f = n === 3 ? 392 : n === 2 ? 523 : 659; tone(f, 0.24, 'square', 0.11); tone(f * 2, 0.2, 'triangle', 0.06); },
    go: function () {
      var t = AC.currentTime; // a full C major chord with a rising whoosh
      [523, 659, 784, 1047].forEach(function (f) { tone(f, 0.75, 'square', 0.06, t); tone(f / 2, 0.75, 'triangle', 0.05, t); });
      tone(1568, 0.5, 'triangle', 0.07, t + 0.05); noise(0.5, 0.16, 1200, 'bandpass', 5);
    },
    // boost sounds by source: a pad whoosh, a bright trick run, a soft glide puff, and a drift boost that grows with its tier
    boost: function (from, tier) {
      var t = AC.currentTime;
      if (from === 'drift') {
        tier = tier || 1;
        noise(0.22 + 0.1 * tier, 0.12 + 0.04 * tier, 1500, 'bandpass', 3, t); tone(200 * (1 + 0.3 * tier), 0.3 + 0.1 * tier, 'sawtooth', 0.05 + 0.015 * tier, t, 2.4 + 0.4 * tier);
        if (tier >= 2) tone(660 * (tier === 2 ? 1 : 1.5), 0.25, 'square', 0.04, t + 0.05, 1.5);
        if (tier >= 3) { tone(1760, 0.3, 'triangle', 0.05, t + 0.1); tone(2349, 0.3, 'triangle', 0.04, t + 0.16); }
      } else if (from === 'trick') {
        noise(0.35, 0.14, 3000, 'bandpass', 0.5, t); [784, 988, 1319, 1568].forEach(function (f, k) { tone(f, 0.16, 'square', 0.06, t + k * 0.045); });
      } else if (from === 'glide') {
        noise(0.3, 0.1, 900, 'lowpass', 2, t); tone(380, 0.3, 'sine', 0.1, t, 1.6);
      } else { noise(0.4, 0.2, 2500, 'bandpass', 2, t); tone(300, 0.4, 'sawtooth', 0.07, t, 3); }
    },
    tier: function (n) { // drift charge reached a tier: blue, orange, pink, each a higher chime
      var t = AC.currentTime;
      if (n === 1) chime(1047, t, 0.07, 0.2);
      else if (n === 2) { chime(1319, t, 0.08, 0.22); chime(1568, t + 0.07, 0.08, 0.25); }
      else { chime(1568, t, 0.08, 0.2); chime(1976, t + 0.06, 0.08, 0.2); chime(2637, t + 0.12, 0.09, 0.4); }
    },
    coin: function (n) {
      var t = AC.currentTime; coinChain = t - coinT < 1 ? coinChain + 1 : 0; coinT = t;
      var k = Math.pow(2, COIN_STEPS[Math.min(coinChain, COIN_STEPS.length - 1)] / 12);
      tone(988 * k, 0.06, 'square', 0.08, t); tone(1319 * k, 0.2, 'square', 0.08, t + 0.06);
    },
    box: function () { seq([660, 880, 990, 1320], 0.05, 'square', 0.08); },
    boxEmpty: function () { tone(190, 0.1, 'square', 0.07, 0, 0.7); noise(0.06, 0.06, 900); },
    item: function (kind) {
      var t = AC.currentTime;
      if (kind === 'turbo') { noise(0.55, 0.2, 500, 'bandpass', 7, t); tone(140, 0.55, 'sawtooth', 0.08, t, 5); }
      else if (kind === 'shield') { chime(784, t, 0.09, 0.4); chime(1175, t + 0.08, 0.08, 0.5); chime(1568, t + 0.16, 0.07, 0.5); }
      else if (kind === 'magnet') { tone(180, 0.4, 'sine', 0.14, t, 2.2); tone(270, 0.4, 'triangle', 0.08, t + 0.05, 2.2); noise(0.3, 0.05, 2000, 'bandpass', 0.4, t); }
      else if (kind === 'goo') { tone(320, 0.3, 'sine', 0.15, t, 0.3); noise(0.25, 0.1, 500, 'lowpass', 0.3, t + 0.03); tone(180, 0.2, 'sine', 0.1, t + 0.12, 0.5); }
      else if (kind === 'bee') { for (var b = 0; b < 8; b++) tone(b % 2 ? 250 : 215, 0.07, 'sawtooth', 0.06, t + b * 0.045); tone(300, 0.3, 'triangle', 0.07, t + 0.3, 2); }
      else tone(500, 0.2, 'triangle', 0.14, 0, 2);
    },
    hit: function () { noise(0.3, 0.32, 700, 'lowpass', 0.4); tone(400, 0.4, 'square', 0.1, 0, 0.3); },
    blocked: function () { tone(1200, 0.25, 'sine', 0.15, 0, 0.5); chime(1800, AC.currentTime + 0.04, 0.05, 0.2); },
    wall: function () { noise(0.2, 0.32, 500, 'lowpass', 0.4); tone(95, 0.18, 'square', 0.12, 0, 0.5); },
    bump: function () { noise(0.12, 0.22, 600, 'lowpass', 0.5); tone(120, 0.14, 'square', 0.12, 0, 0.5); },
    jump: function () { tone(300, 0.3, 'triangle', 0.12, 0, 2.2); },
    hop: function () { tone(420, 0.12, 'triangle', 0.08, 0, 1.6); },
    land: function (air) { var k = Math.max(0.35, Math.min(1.6, air == null ? 0.7 : air)); noise(0.1 + 0.12 * k, 0.12 + 0.12 * k, 600, 'lowpass', 0.4); tone(110, 0.1 + 0.08 * k, 'sine', 0.08 + 0.1 * k, 0, 0.5); },
    trick: function () { seq([784, 988, 1175], 0.05, 'triangle', 0.1); },
    splash: function () { noise(0.6, 0.3, 1400, 'bandpass'); tone(500, 0.4, 'sine', 0.1, 0, 0.3); },
    putback: function () { var t = AC.currentTime; noise(0.3, 0.08, 600, 'lowpass', 4, t); tone(392, 0.12, 'triangle', 0.08, t + 0.05); tone(523, 0.18, 'triangle', 0.08, t + 0.12); },
    pass: function () { var t = AC.currentTime; noise(0.3, 0.12, 500, 'bandpass', 6, t); tone(520, 0.25, 'triangle', 0.09, t, 2.2); tone(880, 0.15, 'sine', 0.07, t + 0.14); },
    lostPlace: function () { var t = AC.currentTime; tone(494, 0.18, 'triangle', 0.08, t); tone(370, 0.3, 'triangle', 0.08, t + 0.1, 0.8); },
    lap: function () { seq([784, 0, 784, 1047], 0.08, 'square', 0.09); },
    finalLap: function () { seq([523, 659, 784, 1047, 784, 1047], 0.08, 'square', 0.1); },
    win: function () { seq([523, 659, 784, 1047, 0, 784, 1047, 1319], 0.12, 'square', 0.11); },
    finish: function () { seq([392, 523, 659, 784], 0.12, 'triangle', 0.12); },
    buy: function () { tone(660, 0.08, 'square', 0.1); tone(990, 0.12, 'square', 0.1, AC.currentTime + 0.06); },
    no: function () { tone(160, 0.15, 'square', 0.1); },
    click: function () { tone(1000, 0.05, 'square', 0.11); tone(1500, 0.04, 'triangle', 0.07, AC.currentTime + 0.01); },
    panel: function () { var t = AC.currentTime; chime(659, t, 0.08, 0.25); chime(880, t + 0.06, 0.08, 0.25); chime(1319, t + 0.12, 0.08, 0.4); },
    tick: function (i) { tone(800 * Math.pow(2, Math.min(i || 0, 12) / 12), 0.05, 'square', 0.07); }, // payout counting up
    payout: function () { var t = AC.currentTime; chime(1047, t, 0.09, 0.3); chime(1319, t + 0.07, 0.09, 0.3); chime(1568, t + 0.14, 0.09, 0.3); chime(2093, t + 0.21, 0.09, 0.6); },
    unlock: function () { seq([784, 988, 1175, 1568], 0.07, 'square', 0.08); },
    drift: function () { noise(0.15, 0.08, 3000, 'highpass'); noise(0.3, 0.05, 800, 'bandpass', 0.6); },
    step: function () { var f = 150 + Math.random() * 70; noise(0.05, 0.06, 900, 'lowpass'); tone(f, 0.06, 'triangle', 0.07); }
  };
  function sfx(n, a, b) { if (AC && !muted && SFX[n]) SFX[n](a, b); }
  function horn(id) { if (AC && !muted && HORNS[id]) HORNS[id](); }
  // engine: a buzzy oscillator through a low-pass, its pitch following the speed
  function setEngine(on, speed, boost) {
    if (paused) on = false;
    if (!AC || muted) { if (engine) { engine.g.gain.setTargetAtTime(0, AC ? AC.currentTime : 0, 0.05); } return; }
    if (!engine) {
      var o = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
      o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(sfxGain); o.start(); o2.start();
      engine = { o: o, o2: o2, f: f, g: g };
    }
    var t = AC.currentTime, base = 55 + speed * 9 + (boost ? 40 : 0);
    engine.o.frequency.setTargetAtTime(base, t, 0.08); engine.o2.frequency.setTargetAtTime(base * 0.502, t, 0.08);
    engine.f.frequency.setTargetAtTime(400 + speed * 60 + (boost ? 600 : 0), t, 0.1);
    engine.g.gain.setTargetAtTime(on ? 0.025 + (boost ? 0.012 : 0) : 0, t, 0.08);
  }

  // ---------- music ----------
  // Original tunes in a 16-bit racing style: one theme per race track and a calm plaza/garage theme.
  // Song format (all bar patterns are 16 characters, one per 16th note):
  //   bpm, key (MIDI note of the tonic), scale (semitones of the mode), lead (lead octave above key),
  //   leadType 'brass' | 'pluck' | 'twang' (a bright, bent, quickly decaying plucked string), bassType 'pick' | 'slap' | 'soft', swing (0..1 of a 16th, delays off-beat 8ths),
  //   push (chord changes land on the "and" of 4 for bass and guitar), echo (delay seconds), mix (voice levels).
  //   motifs: name -> one bar of lead. '1'-'7' scale degrees, 'a'-'g' the octave below, 'A'-'G' the octave above,
  //     '-' holds the note, '.' rests. A prefix like 'P|' plays that bar in song.scales.P instead of the song scale.
  //   secs: sections in order; sections before loopFrom play once (the intro), the rest loop.
  //     bars, tr (transpose in semitones), ch (one chord per bar as roman numerals: upper case major, lower minor,
  //     b/# prefix, suffix 7, M7 or sus), mel (motif name per bar, null rests), pad (hold the chord each bar),
  //     bass ('r' root, 'f' fifth, 'o' octave, 'F' fifth above it, 't' flat seventh, 'e' chord third, '-' hold),
  //     gtr (power chord: 'x' palm-muted, 'X' accented), arp ('x' plays the next chord tone),
  //     drum (a DRUMS beat) and fill (every 4 or 8 bars; every 8th bar takes the big fill; a song's fill4 and fill8
  //     names replace the default fills).
  //   Intensity (final lap): setIntensity(1) at the next bar line plays the song a whole tone higher, 6% faster,
  //     and swaps the lightest drum beats for 'drive'.
  var MIXO = [0, 2, 4, 5, 7, 9, 10], DOR = [0, 2, 3, 5, 7, 9, 10], PHRY = [0, 1, 3, 5, 7, 8, 10];
  var ION = [0, 2, 4, 5, 7, 9, 11], LYD = [0, 2, 4, 6, 7, 9, 11], AEO = [0, 2, 3, 5, 7, 8, 10];
  var PDOM = [0, 1, 4, 5, 7, 8, 10], HARM = [0, 2, 3, 5, 7, 8, 11], DHAR = [0, 1, 4, 5, 7, 8, 11]; // phrygian dominant, harmonic minor, double harmonic
  // drum lanes: k kick, s snare ('x' hit, 'g' ghost), h hats ('x' closed, 'o' open), t toms ('1' high .. '3' low),
  // d hand-drum dum (low), c hand-drum tek (high, 'g' ghost)
  var DRUMS = {
    hits:   { k: 'x.......x.......', h: 'x.x.x.x.x.x.x.x.' },
    pulse:  { k: 'x...x...x...x...', h: '..x...x...x...x.' },
    rock:   { k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    drive:  { k: 'x.....x.x.x.....', s: '....x..g....x..g', h: 'x.xxx.x.x.xxx.xo' },
    gallop: { k: 'x..x..x.x..x..x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
    half:   { k: 'x.......x.x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
    fill4:  { k: 'x.....x.x.......', s: '....x.......xgxx', h: 'x.x.x.x.x.x.....' },
    fill8:  { k: 'x.......x.......', s: 'x.x.x.x.........', t: '........11223333', h: 'x...............' },
    swing:  { k: 'x.......x.......', s: '....g.......g...', h: 'x.x.x.x.x.x.x.x.' },
    brush:  { k: 'x.......x.......', s: '....g...g.g.g.gg', h: 'x.x.x.x.x.......' },
    maqsum: { k: 'x.....x.x.......', d: '....x.......x...', c: '..x...x...x.x.x.', h: 'x.x.x.x.x.x.x.x.' },
    shaabi: { k: 'x.......x.x.....', d: '..x...x...x...x.', c: '.x...x...x...x.x', h: 'x.x.x.x.x.x.x.x.' },
    rolling:{ k: 'x...x...x...x...', d: '..x...x...x...x.', c: '.xgx.xxg.x.x.xxg', h: '..x...x...x...x.' },
    dfill4: { k: 'x.....x.x.......', d: '........x.x.x.x.', c: '..x.x.x.x.x.xxxx', h: 'x.x.x.x.x.x.....' },
    dfill8: { k: 'x.......x.......', d: 'x.x.x.x.........', t: '........11223333', c: 'x.x.x.x.xxxxxxxx', h: 'x...............' }
  };
  var SONGS = {
    // Meadow: bright and driving, E Mixolydian, I - bVII - IV with a bVI - bVII lift in B
    meadow: {
      bpm: 176, key: 52, scale: MIXO, lead: 12, leadType: 'brass', bassType: 'pick', echo: 0.128, loopFrom: 1,
      mix: { lead: 0.03, bass: 0.035, gtr: 0.014, arp: 0.012, drum: 1 },
      motifs: {
        i3: '....5-5-6-7-A---', i4: '6-4-6-A-B---7-6-',
        m1: '1-.3-.5-6-5-3-2-', m2: '1-------....3-5-', m3: '7-.7-.6-5-6-7-A-', m4: 'B---A---7---5-6-',
        m5: '6-.4-.6-A---6-4-', m6: '5-------3-4-5-6-', m7: 'A-.A-.B-C---B-A-', m8: '7---6---5---....',
        m9: '7-6-7-A-B-A-7-6-', m10: 'A-------------..',
        n1: '4-.6-.A-.6-A-B-.', n2: 'C---B---A---6---', n3: '5-.A-.C-.A-C-D-.', n4: 'E---D---C---A---',
        n5: 'A---.A-A-5---A--', n6: '7---.7-7-B---A--', n7: 'A-.C-.E-.C-A-5-.', n8: 'A-----------3-5-',
        n9: '5---A---5---4-3-', n10: '7-6-5-6-7-A-B-C-'
      },
      secs: [
        { bars: 4, ch: 'I I bVII IV', mel: [null, null, 'i3', 'i4'], bass: 'r...........r.r.', gtr: 'X.......X.....x.', drum: 'hits', fill: 4 },
        { bars: 16, ch: 'I I bVII bVII IV IV I v I I bVII bVII IV IV bVII I',
          mel: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm9', 'm10'],
          bass: 'r.r.o.r.r.o.r.f.', gtr: 'X.x.x.x.X.x.x.x.', drum: 'rock', fill: 4 },
        { bars: 16, ch: 'IV IV I I bVI bVII I I IV IV I I bVI bVI bVII bVII',
          mel: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n1', 'n2', 'n3', 'n4', 'n5', 'n9', 'n6', 'n10'],
          bass: 'r.o.r.o.r.o.f.o.', gtr: 'X.x.X.x.X.x.X.x.', arp: 'x.xxx.xxx.xxx.xx', drum: 'drive', fill: 8 }
      ]
    },
    // Creek: tense, C# Dorian with Phrygian bII and bVI bars, slap bass in 16ths
    creek: {
      bpm: 190, key: 49, scale: DOR, scales: { P: PHRY }, lead: 12, leadType: 'brass', bassType: 'slap', echo: 0.112, loopFrom: 1,
      mix: { lead: 0.028, bass: 0.022, gtr: 0.013, arp: 0.011, drum: 1 },
      motifs: {
        ci3: 'P|2-.2-.2-.2-2-2--', ci4: '1-------........',
        c1: '1-.1-.3-.4-3-.1-', c2: '7-.1-.3---------', c3: '7-.7-.2-.4-2-.7-', c4: '1---------..5-4-',
        c5: '3-.4-.5-.6-5-.3-', c6: '4-.3-.1-.7-1----', c7: 'P|2-.2-.4-.6-4-.2-', c8: '1-----------....',
        c9: '4-.6-.A-.6-4-.6-', c10: 'B---A---6---4---', c11: '5-.A-.5-.3-1-.3-', c12: '5---------------',
        c13: 'P|6-.6-.A-.C-A-.6-', c14: '7-.7-.2-.4-5-.4-', c15: 'P|4---2---1---2---', c16: 'P|2-----------7-1-',
        d1: 'P|C-C-.A-C-.D-C-A-', d2: 'D-D-.B-D-.E-D-B-', d3: 'E---D---C---A---', d4: 'C-B-A-7-A-------',
        d6: 'D-D-.E-F-.E-D-E-', d7: 'E---------------', d8: '....E-D-C-B-A-7-', d9: 'P|D-.D-.B-.A-B-.D-',
        d10: 'C---A---5---A---', d11: 'P|D-.D-.F-.E-D-.B-', d12: 'A---------------', d13: 'P|A-C-E-C-A-C-E-F-',
        d14: 'P|E-------C-------', d15: 'D---E---D---B---', d16: '7-1-2-3-4-5-6-7-'
      },
      secs: [
        { bars: 4, ch: 'i i bII i', mel: [null, null, 'ci3', 'ci4'], bass: 'rrorrrorfrorrrot', drum: 'pulse', fill: 4 },
        { bars: 16, ch: 'i i bVII i i i bII i IV IV i i bVI bVII bII bII',
          mel: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15', 'c16'],
          bass: 'rrorrrorfrorrrot', gtr: 'X..x..X..x..X.x.', drum: 'rock', fill: 4 },
        { bars: 16, ch: 'bVI bVII i i bVI bVII i i bII i bII i bVI bVI bVII bVII',
          mel: ['d1', 'd2', 'd3', 'd4', 'd1', 'd6', 'd7', 'd8', 'd9', 'd10', 'd11', 'd12', 'd13', 'd14', 'd15', 'd16'],
          bass: 'rrorrfrorrorrtro', gtr: 'X.xxX.xxX.xxX.x.', arp: 'x.x.x.x.x.x.x.x.', drum: 'gallop', fill: 4 }
      ]
    },
    // Windmill: soaring, F major with a Lydian II, a half-time B over a pad, then C lifted a whole step to G;
    // C's last bar is IV of G (= V of F), which turns back to A
    windmill: {
      bpm: 188, key: 53, scale: ION, scales: { L: LYD }, lead: 12, leadType: 'brass', bassType: 'pick', echo: 0.144, loopFrom: 1,
      mix: { lead: 0.028, bass: 0.033, gtr: 0.013, arp: 0.01, pad: 0.008, drum: 1 },
      motifs: {
        wi3: '4-5-6-A-B-A-6-5-', wi4: '5---7---B-------',
        w1: '5-.6-.A-----3-5-', w2: 'A-.B-.C-----B-A-', w3: '6-------5-6-A-B-', w4: 'A---6---5---6---',
        w5: '4-.5-.6-----A-6-', w6: '5-------4-3-2-1-', w7: '2-.3-.5-----6-7-', w8: 'B---------------',
        w10: 'A-.B-.C-----D-E-', w11: 'F---E---D---C---', w12: 'B---A---B---C---', w13: 'L|B-.B-.D-----F-D-',
        w14: 'L|B---------------', w15: 'A-.A-.6-----A-B-', w16: 'C---B---A---7---',
        x1: 'C-----A-----6---', x2: 'A---6---A---C---', x3: 'D-----C-----A---', x4: 'B---A---B---D---',
        x5: 'E-----D-----C---', x6: 'C---A---C---E---', x7: 'F-----E-----D---', x8: 'B-C-D-E-F-E-D-B-',
        y8: 'A---6---5---4---'
      },
      secs: [
        { bars: 4, ch: 'IV V IV V', mel: [null, null, 'wi3', 'wi4'], bass: 'r.r.r.r.r.r.r.r.', gtr: 'X.......X.......', drum: 'hits', fill: 4 },
        { bars: 16, ch: 'I I vi vi IV IV V V I I vi vi II II IV V',
          mel: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8', 'w1', 'w10', 'w11', 'w12', 'w13', 'w14', 'w15', 'w16'],
          bass: 'r.r.o.r.r.r.o.f.', gtr: 'X.x.x.x.X.x.x.X.', drum: 'rock', fill: 4 },
        { bars: 8, ch: 'vi vi IV IV I I V V', mel: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'],
          bass: 'r...o...r...o.f.', pad: true, arp: 'x.x.x.x.x.x.x.x.', drum: 'half', fill: 8 },
        { bars: 8, tr: 2, ch: 'I I vi vi IV IV V IV', mel: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'y8'],
          bass: 'r.r.o.r.r.r.o.f.', gtr: 'X.x.x.x.X.x.x.X.', arp: 'xxxxxxxxxxxxxxxx', drum: 'drive', fill: 4 }
      ]
    },
    // Dune: D phrygian dominant, bold and driving, twangy lead over a maqsum hand-drum groove, I - bII with a minor iv lift
    dune: {
      bpm: 178, key: 50, scale: PDOM, lead: 12, leadType: 'twang', bassType: 'pick', echo: 0.127, loopFrom: 1, fill4: 'dfill4', fill8: 'dfill8',
      mix: { lead: 0.04, bass: 0.034, gtr: 0.012, arp: 0.011, drum: 1 },
      motifs: {
        di3: '....1-1-2-3-5-6-', di4: '5---A-------....',
        a1: '1-1-2-3-2---1-g-', a2: '1---------3-5-6-', a3: '5-.6-.5-3-2-3-2-', a4: '1-------2-1-g-1-', a5: '6-.6-.5-.3-.2-3-', a6: '2---1---g---1---',
        b1: 'A-.A-.B-C-B-A-5-', b2: '6---5---3---2---', b3: 'C-.C-.D-E-D-C-B-', b4: 'A---------------', b5: '5-6-A-B-A-6-5-3-',
        b6: '2-3-5-6-5-3-2-g-', b7: 'E-.D-.C-.B-A-5-.', b8: '6---5---A-.A-.1-'
      },
      secs: [
        { bars: 4, ch: 'I I bII I', mel: [null, null, 'di3', 'di4'], bass: 'r...r...r.r.f.r.', drum: 'pulse', fill: 4 },
        { bars: 16, ch: 'I I bII bII I I bII I I I bII bII iv iv I I',
          mel: ['a1', 'a2', 'a3', 'a4', 'a1', 'a2', 'a5', 'a6', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a1', 'a4'],
          bass: 'r.r.o.r.r.r.o.f.', gtr: 'X.x.x.x.X.x.x.x.', drum: 'maqsum', fill: 4 },
        { bars: 16, ch: 'iv iv I I bII bII I I iv iv I I bII bII I I',
          mel: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'],
          bass: 'r.o.r.o.r.rfo.f.', gtr: 'X.xxX.xxX.xxX.x.', arp: 'x.xxx.xxx.xxx.xx', drum: 'maqsum', fill: 8 }
      ]
    },
    // Mesa: G harmonic minor, tense and heavy, slap bass and a shaabi hand-drum beat, i - iv - V turnarounds
    mesa: {
      bpm: 186, key: 55, scale: HARM, lead: 12, leadType: 'twang', bassType: 'slap', echo: 0.121, loopFrom: 1, fill4: 'dfill4', fill8: 'dfill8',
      mix: { lead: 0.04, bass: 0.022, gtr: 0.013, arp: 0.011, drum: 1 },
      motifs: {
        mi3: '....3-3-5-5-7-A-', mi4: 'C---7---5---....',
        m1: '1-.1-.3-5-7-6-5-', m2: '3---------2-1-g-', m3: '5-.5-.6-7-A-7-6-', m4: '5-------3-2-1-g-', m5: '4-.4-.6-A-6-4-3-', m6: '2-------g-1-2-3-',
        m7: '3-.3-.5-7-A-C-B-', m8: 'A---------......',
        n1: 'A-B-C-B-A-7-6-7-', n2: 'A---------5-6-7-', n3: 'C-.C-.D-E-F-E-D-', n4: 'C---------E-D-C-', n5: 'B-.B-.A-7-A-B-C-',
        n6: 'D-------C---B---', n7: 'E-.E-.F-.E-.D-C-', n8: 'B---------A-7-5-'
      },
      secs: [
        { bars: 4, ch: 'i i V i', mel: [null, null, 'mi3', 'mi4'], bass: 'rrorrrorfrorrrot', drum: 'pulse', fill: 4 },
        { bars: 16, ch: 'i i iv iv i i V V bVI bVI iv V i i V V',
          mel: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'],
          bass: 'rrorrrorfrorrrot', gtr: 'X..x..X..x..X.x.', drum: 'shaabi', fill: 4 },
        { bars: 16, ch: 'bVI V i i iv bVII bIII V bVI V i i iv V i V',
          mel: ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8'],
          bass: 'rrorrfrorrorrtro', gtr: 'X.xxX.xxX.xxX.x.', arp: 'x.x.x.x.x.x.x.x.', drum: 'shaabi', fill: 4 }
      ]
    },
    // Oasis: E double harmonic, floating and fast, a pad under rolling hand drums and a sparkling arpeggio
    oasis: {
      bpm: 170, key: 52, scale: DHAR, lead: 12, leadType: 'twang', bassType: 'pick', echo: 0.15, loopFrom: 1, fill4: 'dfill4', fill8: 'dfill8',
      mix: { lead: 0.038, bass: 0.03, gtr: 0.01, arp: 0.012, pad: 0.009, drum: 0.9 },
      motifs: {
        oi3: '....5-6-7-A-7-6-', oi4: '5---------......',
        o1: '3-.2-.1-.2-3-5-.', o2: '6-------5---3---', o3: '5-6-7-A-7-6-5-3-', o4: '2-------1-------', o5: 'A-.7-.6-.7-A-C-.',
        o6: 'B---A---7---6---', o7: '5-.5-.6-.7-A-7-6', o8: '5---------......',
        q1: 'C-.C-.D-.C-B-A-7', q2: '6---------5-6-7-', q3: 'A-B-C-D-E-D-C-B-', q4: 'A-------E-------', q5: 'F-.E-.D-.C-.B-A-',
        q6: '7---------5-6-7-', q7: 'A---7---6---5---', q8: 'A---------......'
      },
      secs: [
        { bars: 4, ch: 'I I bII I', mel: [null, null, 'oi3', 'oi4'], pad: true, bass: 'r.......r.......', drum: 'pulse', fill: 4 },
        { bars: 16, ch: 'I I bII bII I I V V bVI bVI bII bII I I V I',
          mel: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8', 'o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8'],
          bass: 'r.r.o.r.r.o.f.o.', pad: true, arp: 'x.x.x.x.x.x.x.x.', drum: 'rolling', fill: 4 },
        { bars: 16, ch: 'bVI bVI V V I I bII bII bVI bVI iv iv I bII I I',
          mel: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'],
          bass: 'r.r.o.r.r.r.o.f.', gtr: 'X.x.x.x.X.x.x.x.', pad: true, arp: 'xxxxxxxxxxxxxxxx', drum: 'rolling', fill: 8 }
      ]
    },
    // Victory (results after a win): C major fanfare, brass over a rock beat
    win: {
      bpm: 138, key: 48, scale: ION, lead: 12, leadType: 'brass', bassType: 'pick', echo: 0.2, loopFrom: 0,
      mix: { lead: 0.03, bass: 0.035, gtr: 0.014, arp: 0.012, drum: 1 },
      motifs: {
        r1: '5---A---C---E---', r2: 'E---B---7---5---', r3: 'F---E---C---A---', r4: 'D---C---A---6---',
        r5: 'E---D---C---A---', r6: 'B---C---D---E---', r8: 'E-------A-------'
      },
      secs: [
        { bars: 8, ch: 'I V vi IV I V IV I', mel: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r4', 'r8'],
          bass: 'r.r.o.r.r.o.f.o.', gtr: 'X.x.x.x.X.x.x.x.', arp: 'x.xxx.xxx.xxx.xx', drum: 'rock', fill: 4 }
      ]
    },
    // Calm results (not a win): A natural minor, plucked and soft over a pad and brushes
    calm: {
      bpm: 96, key: 45, scale: AEO, lead: 24, leadType: 'pluck', bassType: 'soft', swing: 0.3, push: false, echo: 0.22, loopFrom: 0,
      fill8: 'brush', mix: { lead: 0.05, bass: 0.06, pad: 0.013, drum: 0.4 },
      motifs: {
        k1: '3---5---A-------', k2: '6---A---C---A---', k3: '5---3---5---7---', k4: '7---2---4---2---',
        k5: '3-5-A-5-3-------', k6: '4---6---A---6---', k7: '5---7---B---7---', k8: '3---------1-----'
      },
      secs: [
        { bars: 8, ch: 'i bVI bIII bVII i iv v i', mel: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8'], pad: true, bass: 'r---f---o---f---', drum: 'swing', fill: 8 }
      ]
    },
    // Plaza and garage: relaxed Bb major with seventh chords, swung 8ths, soft pad and a plucked lead
    hub: {
      bpm: 110, key: 46, scale: ION, lead: 24, leadType: 'pluck', bassType: 'soft', swing: 0.4, push: false, echo: 0.18, loopFrom: 1,
      fill8: 'brush', mix: { lead: 0.05, bass: 0.06, pad: 0.012, drum: 0.5 },
      motifs: {
        p1: '3---5-6-5---3---', p2: '2---1-------....', p3: '3-5-A---7---5---', p4: '6-------5-4-3-2-',
        p5: '4---6---A---6---', p6: '5-------3---....', p7: '2---4-6-7---6---', p8: '5-----------....',
        q1: '6-A-B---A-6-5---', q2: '4-5-6---5-4-2---', q3: '3-5-7---6-5-3---', q4: '2-------........',
        q5: '4---2---4-5-6---', q6: '7---6---5---4---', q7: '3---------------', q8: '............5-6-'
      },
      secs: [
        { bars: 2, ch: 'IVM7 V7', pad: true, bass: 'r-------f-------' },
        { bars: 8, ch: 'IM7 IM7 iii7 vi7 IVM7 IVM7 ii7 V7', mel: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
          pad: true, bass: 'r---f---o---f---', drum: 'swing', fill: 8 },
        { bars: 8, ch: 'IVM7 V7 iii7 vi7 ii7 V7 IM7 IM7', mel: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8'],
          pad: true, bass: 'r---f---o-r-f---', drum: 'swing', fill: 8 }
      ]
    }
  };
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var NUMERAL = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };
  function chord(tok, tr) {
    var m = /^([b#]?)([ivIV]+)(.*)$/.exec(tok), low = m[2].toLowerCase(), minor = m[2] === low;
    var tones = [0, minor ? 3 : 4, 7];
    if (m[3] === 'sus') tones[1] = 5;
    if (m[3] === '7') tones.push(10);
    if (m[3] === 'M7') tones.push(11);
    var r = (((NUMERAL[low] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0) + tr) % 12) + 12) % 12;
    return { root: r > 6 ? r - 12 : r, tones: tones };
  }
  // flattens a song into bars once: chord, next chord (for pushed changes), lead bar and drum beat
  function layout(song) {
    if (song._l) return song._l;
    var bars = [], intro = 0;
    song.secs.forEach(function (sec, si) {
      var chs = sec.ch.split(/\s+/), tr = sec.tr || 0;
      for (var i = 0; i < sec.bars; i++) {
        var m = sec.mel && sec.mel[i] ? song.motifs[sec.mel[i]] : null, sc = song.scale;
        if (m && m.charAt(1) === '|') { sc = song.scales[m.charAt(0)]; m = m.slice(2); }
        var drum = sec.drum;
        if (drum && sec.fill && (i + 1) % sec.fill === 0) drum = (i + 1) % 8 === 0 ? (song.fill8 || 'fill8') : (song.fill4 || 'fill4');
        bars.push({ sec: sec, ch: chord(chs[i % chs.length], tr), mel: m, scale: sc, key: song.key + tr, drum: drum, crash: !!sec.drum && i % 8 === 0 });
      }
      if (si < song.loopFrom) intro += sec.bars;
    });
    bars.forEach(function (b, i) { b.next = (bars[i + 1] || bars[intro]).ch; });
    song._l = { bars: bars, intro: intro * 16, loop: (bars.length - intro) * 16 };
    return song._l;
  }

  // one music bus per mood: dry and echo inputs, a stereo echo (lowpassed feedback), a warm lowpass, an output
  // gain for the crossfade, and shared nodes for the guitar distortion, drum filters and pad filter
  var noiseCache = [];
  function noiseFor(ctx) {
    for (var i = 0; i < noiseCache.length; i++) if (noiseCache[i].ctx === ctx) return noiseCache[i].buf;
    var n = Math.floor(ctx.sampleRate * 1.2), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    for (var j = 0; j < n; j++) d[j] = Math.random() * 2 - 1;
    noiseCache.push({ ctx: ctx, buf: buf }); if (noiseCache.length > 4) noiseCache.shift();
    return buf;
  }
  function filt(ctx, type, f, q, dest) { var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; if (dest) n.connect(dest); return n; }
  function gainNode(ctx, v, dest) { var g = ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
  function makeBus(ctx, dest) {
    var b = { ctx: ctx, noise: noiseFor(ctx) };
    b.out = gainNode(ctx, 0, dest);
    var warm = filt(ctx, 'lowpass', 11000, 0.5, b.out);
    b.dry = gainNode(ctx, 1, warm); b.fx = gainNode(ctx, 1, warm);
    var send = gainNode(ctx, 0.28, null), merge = ctx.createChannelMerger(2);
    b.fx.connect(send); merge.connect(warm);
    b.delays = [0, 1].map(function (ch) {
      var d = ctx.createDelay(1), lp = filt(ctx, 'lowpass', 4200, 0.5, null), fb = gainNode(ctx, 0.38, d);
      send.connect(d); d.connect(lp); lp.connect(fb); lp.connect(merge, 0, ch);
      return d;
    });
    b.gtrIn = gainNode(ctx, 1, null);
    var shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (var i = 0; i < 1024; i++) { var x = i / 511.5 - 1; curve[i] = Math.tanh(30 * x) / Math.tanh(30); }
    shaper.curve = curve; shaper.oversample = '4x';
    b.gtrOut = gainNode(ctx, 0.03, b.fx);
    b.gtrIn.connect(shaper); shaper.connect(filt(ctx, 'highpass', 100, 0.7, filt(ctx, 'lowpass', 3000, 0.8, b.gtrOut)));
    b.hatF = filt(ctx, 'highpass', 7000, 0.7, b.dry);
    b.snrF = filt(ctx, 'bandpass', 1800, 0.9, b.fx);
    b.padF = filt(ctx, 'lowpass', 1500, 0.6, b.fx);
    return b;
  }
  function startSong(b, song, t) {
    b.gtrOut.gain.setValueAtTime(song.mix.gtr || 0, t);
    b.delays[0].delayTime.setValueAtTime(song.echo, t); b.delays[1].delayTime.setValueAtTime(song.echo * 1.3, t);
  }

  // voices: each takes the bus, a start time and lasts a few nodes; every gain ends at 0.0001 and every source stops
  function osc(c, type, f, t, end, det, dest) {
    var o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (det) o.detune.setValueAtTime(det, t);
    o.connect(dest); o.start(t); o.stop(end); return o;
  }
  function env(c, t, peak, att, end, dest) {
    var g = c.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, end); g.connect(dest); return g;
  }
  function noiseHit(b, t, dur, vol, dest) {
    var c = b.ctx, src = c.createBufferSource(), g = env(c, t, vol, 0.001, t + dur, dest);
    src.buffer = b.noise; src.connect(g); src.start(t, Math.random() * (b.noise.duration - dur - 0.05), dur + 0.02);
  }
  function brass(b, t, f, dur, vol) {
    var c = b.ctx, end = t + dur + 0.07, lp = filt(c, 'lowpass', 800, 1.2, null), g = c.createGain();
    g.gain.value = 0; // a gain starts at 1 until its first event, which lets a one-sample click through
    lp.frequency.setValueAtTime(800, t); lp.frequency.linearRampToValueAtTime(3600, t + 0.06); lp.frequency.setTargetAtTime(1700, t + 0.06, 0.25);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.012);
    if (dur > 0.14) { g.gain.linearRampToValueAtTime(vol * 0.7, t + 0.12); g.gain.setValueAtTime(vol * 0.7, t + dur); }
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    lp.connect(g); g.connect(b.fx);
    var o1 = osc(c, 'sawtooth', f, t, end + 0.01, 0, lp), o2 = osc(c, 'sawtooth', f, t, end + 0.01, 7, lp);
    if (dur > 0.25) { // delayed vibrato on long notes
      var lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 5.6; depth.gain.setValueAtTime(0, t); depth.gain.setValueAtTime(0, t + 0.2); depth.gain.linearRampToValueAtTime(16, t + 0.4);
      lfo.connect(depth); depth.connect(o1.detune); depth.connect(o2.detune); lfo.start(t); lfo.stop(end + 0.01);
    }
  }
  function pluck(b, t, f, dur, vol) {
    var c = b.ctx, end = t + Math.min(0.6, dur + 0.3), lp = filt(c, 'lowpass', 3000, 1, null), g = env(c, t, vol, 0.003, end, b.fx);
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.3); lp.connect(g);
    osc(c, 'triangle', f, t, end + 0.01, 0, lp); osc(c, 'square', f, t, end + 0.01, 4, gainNode(c, 0.3, lp));
  }
  // a bright plucked string with a quick bend up to pitch, a resonant filter that closes as it rings, and a late vibrato
  function twang(b, t, f, dur, vol) {
    var c = b.ctx, end = t + Math.min(0.9, dur + 0.25), lp = filt(c, 'bandpass', 3500, 2.2, null), g = env(c, t, vol * 1.5, 0.003, end, b.fx);
    lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(1100, t + 0.22); lp.connect(g);
    var o1 = osc(c, 'sawtooth', f, t, end + 0.01, -70, lp), o2 = osc(c, 'square', f, t, end + 0.01, 5, gainNode(c, 0.4, lp));
    o1.detune.linearRampToValueAtTime(0, t + 0.045); o2.detune.linearRampToValueAtTime(5, t + 0.045);
    if (dur > 0.3) {
      var lfo = c.createOscillator(), depth = c.createGain();
      lfo.frequency.value = 6; depth.gain.setValueAtTime(0, t); depth.gain.setValueAtTime(0, t + 0.25); depth.gain.linearRampToValueAtTime(14, t + 0.45);
      lfo.connect(depth); depth.connect(o1.detune); depth.connect(o2.detune); lfo.start(t); lfo.stop(end + 0.01);
    }
  }
  function dum(b, t, v) { var c = b.ctx, o = osc(c, 'sine', 120, t, t + 0.22, 0, env(c, t, v, 0.002, t + 0.2, b.dry)); o.frequency.exponentialRampToValueAtTime(70, t + 0.12); noiseHit(b, t, 0.012, v * 0.3, b.snrF); }
  function tek(b, t, v) { var c = b.ctx; noiseHit(b, t, 0.045, v, b.snrF); osc(c, 'triangle', 900, t, t + 0.05, 0, env(c, t, v * 0.3, 0.001, t + 0.04, b.dry)); }
  function bassNote(b, t, f, dur, vol, kind) {
    var c = b.ctx, end, g;
    if (kind === 'soft') { end = t + dur + 0.12; g = env(c, t, vol, 0.008, end, b.dry); osc(c, 'triangle', f, t, end + 0.01, 0, g); return; }
    var slap = kind === 'slap', lp = filt(c, 'lowpass', 2500, slap ? 5 : 2.5, null);
    lp.frequency.setValueAtTime(slap ? 2500 : 1700, t); lp.frequency.exponentialRampToValueAtTime(slap ? 300 : 420, t + (slap ? 0.09 : 0.13));
    end = t + (slap ? Math.min(0.14, dur + 0.05) : Math.max(0.12, dur) + 0.05);
    g = env(c, t, vol, 0.002, end, b.dry); lp.connect(g);
    osc(c, 'sawtooth', f, t, end + 0.01, -7, lp);
    if (slap) osc(c, 'sawtooth', f, t, end + 0.01, 7, lp);
    osc(c, 'square', f / 2, t, end + 0.01, 0, lp);
  }
  function gtr(b, t, f, dur, accent) {
    var c = b.ctx, end = t + (accent ? Math.min(0.3, dur) : 0.07), g = env(c, t, accent ? 0.7 : 0.5, 0.002, end, b.gtrIn);
    osc(c, 'square', f, t, end + 0.01, 0, g); osc(c, 'sawtooth', f * 1.4983, t, end + 0.01, 0, g);
  }
  function arpNote(b, t, f, vol) { var c = b.ctx, g = env(b.ctx, t, vol, 0.002, t + 0.07, b.fx); osc(c, 'square', f, t, t + 0.08, 0, g); }
  function pad(b, t, freqs, dur, vol) {
    var c = b.ctx, end = t + dur + 0.25;
    freqs.forEach(function (f, i) {
      var g = c.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.25);
      g.gain.setValueAtTime(vol, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, end); g.connect(b.padF);
      osc(c, 'sawtooth', f, t, end + 0.01, i % 2 ? 6 : -6, g);
    });
  }
  function kick(b, t, v) {
    var c = b.ctx, g = env(c, t, v, 0.002, t + 0.28, b.dry), o = osc(c, 'sine', 150, t, t + 0.3, 0, g);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.08);
    noiseHit(b, t, 0.008, v * 0.4, b.dry);
  }
  function snare(b, t, v) {
    var c = b.ctx; noiseHit(b, t, 0.13, v, b.snrF);
    osc(c, 'triangle', 190, t, t + 0.1, 0, env(c, t, v * 0.5, 0.001, t + 0.08, b.dry));
  }
  function tom(b, t, v, f) {
    var c = b.ctx, o = osc(c, 'sine', f, t, t + 0.24, 0, env(c, t, v, 0.002, t + 0.22, b.fx));
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.2);
  }
  var BASS_IV = { r: 0, f: 7, o: 12, F: 19, t: 10 }, TOMS = { 1: 220, 2: 160, 3: 110 };
  function holds(pat, s) { var n = 1; while (s + n < 16 && pat.charAt(s + n) === '-') n++; return n; }
  function playStep(b, song, st, t, sh, hot) {
    sh = sh || 0;
    var L = layout(song), p = st < L.intro ? st : L.intro + (st - L.intro) % L.loop;
    var bar = L.bars[p >> 4], s = p & 15, sec = bar.sec, mix = song.mix, dt = 60 / song.bpm / 4, c;
    if (song.swing && s % 4 === 2) t += song.swing * dt;
    var ch = song.push !== false && s >= 14 ? bar.next : bar.ch, root = song.key + ch.root + sh; // roots include tr
    // lead
    if (bar.mel && (c = bar.mel.charAt(s)) && c !== '-' && c !== '.') {
      var code = c.charCodeAt(0), oct = 0, deg;
      if (code >= 97) { oct = -1; deg = code - 97; } else if (code >= 65) { oct = 1; deg = code - 65; } else deg = code - 49;
      var f = midi(bar.key + sh + song.lead + bar.scale[deg] + 12 * oct), d = holds(bar.mel, s) * dt;
      if (song.leadType === 'pluck') pluck(b, t, f, d, mix.lead); else if (song.leadType === 'twang') twang(b, t, f, d * 0.92, mix.lead); else brass(b, t, f, d * 0.92, mix.lead);
    }
    // bass
    if (sec.bass && (c = sec.bass.charAt(s)) && (c in BASS_IV || c === 'e')) {
      var iv = c === 'e' ? ch.tones[1] : BASS_IV[c];
      bassNote(b, t, midi(root - 12 + iv), holds(sec.bass, s) * dt * 0.9, mix.bass, song.bassType);
    }
    if (sec.gtr && (c = sec.gtr.charAt(s)) !== '.' && c) gtr(b, t, midi(root), holds(sec.gtr, s) * dt * 2, c === 'X');
    if (sec.arp && sec.arp.charAt(s) === 'x') {
      var tones = ch.tones.concat([12]); arpNote(b, t, midi(root + 24 + tones[s % tones.length]), mix.arp);
    }
    if (sec.pad && s === 0) pad(b, t, bar.ch.tones.map(function (x) { return midi(root + 12 + x); }), 16 * dt, mix.pad);
    // drums
    var dname = bar.drum; if (hot && dname && ['hits', 'half', 'pulse'].indexOf(dname) >= 0) dname = 'drive';
    var beat = dname && DRUMS[dname], v = mix.drum;
    if (!beat) return;
    if (beat.k && beat.k.charAt(s) === 'x') kick(b, t, 0.12 * v);
    if (beat.s && (c = beat.s.charAt(s)) !== '.' && c) snare(b, t, (c === 'g' ? 0.02 : 0.07) * v);
    if (beat.h && (c = beat.h.charAt(s)) !== '.' && c) noiseHit(b, t, c === 'o' ? 0.15 : 0.03, (c === 'o' ? 0.02 : 0.016) * v, b.hatF);
    if (beat.t && (c = beat.t.charAt(s)) !== '.' && c) tom(b, t, 0.08 * v, TOMS[c]);
    if (beat.d && beat.d.charAt(s) === 'x') dum(b, t, 0.11 * v);
    if (beat.c && (c = beat.c.charAt(s)) !== '.' && c) tek(b, t, (c === 'g' ? 0.025 : 0.06) * v);
    if (hot && s % 4 === 2 && !beat.h) noiseHit(b, t, 0.03, 0.012 * v, b.hatF);
    if (bar.crash && s === 0) noiseHit(b, t, 0.9, 0.025 * v, b.hatF);
  }
  function songFor(m, id) {
    if (m === 'hub') return SONGS.hub;
    if (m === 'results') return won ? SONGS.win : SONGS.calm;
    return SONGS[id] && id !== 'hub' && id !== 'win' && id !== 'calm' ? SONGS[id] : SONGS.meadow;
  }
  var curSong = null, curBus = null;
  function scheduleMusic() {
    if (!AC || muted) return;
    var now = AC.currentTime, key = mood === 'race' ? 'race:' + (songFor('race', track) === SONGS[track] ? track : 'meadow') : mood === 'results' ? 'results:' + won : mood;
    if (curMood !== key) {
      var first = !curMood; curMood = key; musicStep = 0; nextNote = now + 0.1; intensity = pendInt = 0;
      ['hub', 'race', 'res'].forEach(function (k) { buses[k].out.gain.setTargetAtTime((mood === 'results' ? 'res' : mood) === k ? 1 : 0, now, first ? 0.05 : 0.3); });
      curBus = buses[mood === 'results' ? 'res' : mood] || null; curSong = curBus ? songFor(mood, track) : null;
      if (curBus) startSong(curBus, curSong, nextNote);
    }
    if (!curBus) return;
    if (nextNote < now - 0.5) nextNote = now + 0.05;
    while (nextNote < now + 0.2) {
      if ((musicStep & 15) === 0) intensity = pendInt; // a lift starts on a bar line
      playStep(curBus, curSong, musicStep, nextNote, intensity ? 2 : 0, intensity);
      nextNote += 60 / curSong.bpm / 4 / (intensity ? 1.06 : 1); musicStep++;
    }
  }
  // mood: 'hub', 'race' (a track id picks the song) or 'results' (second argument: whether the player won)
  function setMood(m, a) { mood = m; if (m === 'results') won = !!a; else if (a) track = a; if (m !== 'race') pendInt = 0; }
  // 0 normal, 1 final-lap lift (a whole tone up, 6% faster, busier drums), applied at the next bar line
  function setIntensity(n) { pendInt = n ? 1 : 0; }
  // test hook: renders a theme ('hub' or a track id) into an OfflineAudioContext at the music bus level (MUSIC_BOOST applied, before the
  // compressor and master); scheduling stops at stopAt seconds; hot renders the final-lap lift
  function render(theme, seconds, stopAt, hot) {
    var song = SONGS[theme] || SONGS.meadow, sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    var b = makeBus(ctx, gainNode(ctx, MUSIC_BOOST, ctx.destination)), end = stopAt == null ? seconds : stopAt;
    b.out.gain.value = 1; startSong(b, song, 0);
    for (var st = 0, t = 0.05; t < end; st++, t += 60 / song.bpm / 4 / (hot ? 1.06 : 1)) playStep(b, song, st, t, hot ? 2 : 0, hot ? 1 : 0);
    return ctx.startRendering();
  }
  // test hook: a theme, an engine hum and a burst of sound effects (fired together at burstAt seconds) through the full output chain
  function stack(theme, seconds, burstAt, names, noEngine) {
    var song = SONGS[theme] || SONGS.meadow, sr = 44100, ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    var ch = buildChain(ctx), b = makeBus(ctx, ch.musicGain), save = [AC, sfxGain, engine, muted];
    b.out.gain.value = 1; startSong(b, song, 0);
    for (var st = 0, t = 0.05; t < seconds; st++, t += 60 / song.bpm / 4) playStep(b, song, st, t);
    AC = ctx; sfxGain = ch.sfxGain; engine = null; muted = false;
    if (!noEngine) setEngine(true, 14, true); // runs at full speed with a boost
    ctx.suspend(burstAt).then(function () {
      (names || Object.keys(SFX)).forEach(function (n) { try { SFX[n](n === 'tier' ? 3 : n === 'boost' ? 'drift' : n === 'item' ? 'turbo' : 1, 3); } catch (e) {} });
      ctx.resume();
    });
    return ctx.startRendering().then(function (buf) { AC = save[0]; sfxGain = save[1]; engine = save[2]; muted = save[3]; return buf; });
  }
  function setPaused(p) {
    paused = !!p; applyVol();
    if (paused && engine && AC) engine.g.gain.setTargetAtTime(0, AC.currentTime, 0.03);
  }
  function setMute(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : 0.9;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch (e) {}
  }
  return { init: init, sfx: sfx, horn: horn, setEngine: setEngine, setMood: setMood, setIntensity: setIntensity, setPaused: setPaused,
    setMute: setMute, isMuted: function () { return muted; }, setVolume: setVolume, getVolume: getVolume,
    _render: render, _stack: stack, _songs: SONGS, _layout: layout, _sfx: SFX };
})();
