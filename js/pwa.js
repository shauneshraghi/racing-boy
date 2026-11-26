// pwa.js: install prompt, service worker, save export/import helpers (RBPwa).
(function () {
  'use strict';
  var held = null;

  try {
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); held = e; });
    window.addEventListener('appinstalled', function () { held = null; });
  } catch (e) { /* ignore */ }

  function register() {
    try {
      if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
      var go = function () { try { navigator.serviceWorker.register('sw.js').catch(function () {}); } catch (e) { /* ignore */ } };
      if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
    } catch (e) { /* ignore */ }
  }

  function canInstall() { return !!held; }
  function install() {
    try {
      if (!held) return Promise.resolve(false);
      var ev = held;
      held = null;
      ev.prompt();
      return Promise.resolve(ev.userChoice).then(function (c) { return !!c && c.outcome === 'accepted'; }, function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }
  function isStandalone() {
    try {
      return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone);
    } catch (e) { return false; }
  }
  function isIOS() {
    try {
      var ua = navigator.userAgent || '';
      return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    } catch (e) { return false; }
  }
  function installHint() {
    if (isStandalone()) return '';
    if (isIOS()) return 'Tap the Share button, then Add to Home Screen.';
    return 'Use your browser menu and choose Install app or Add to Home screen.';
  }

  // ---- save codes ----
  function bytesToB64url(bytes) {
    var s = '', i, CH = 0x8000;
    for (i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(t) {
    var s = t.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function streamBytes(bytes, stream) {
    var blob = new Blob([bytes]);
    return new Response(blob.stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function packSave(json) {
    try {
      var raw = new TextEncoder().encode(String(json));
      if (typeof CompressionStream === 'function') {
        return streamBytes(raw, new CompressionStream('gzip')).then(function (z) { return 'RB1.' + bytesToB64url(z); });
      }
      return Promise.resolve('RB0.' + bytesToB64url(raw));
    } catch (e) { return Promise.reject(e); }
  }
  function unpackSave(code) {
    try {
      var c = String(code == null ? '' : code).replace(/\s+/g, '');
      var m = /^(RB[01])\.([A-Za-z0-9_-]+)$/.exec(c);
      if (!m) return Promise.reject(new Error('That is not a save code.'));
      var bytes = b64urlToBytes(m[2]);
      if (m[1] === 'RB0') return Promise.resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('This browser cannot open that save code.'));
      return streamBytes(bytes, new DecompressionStream('gzip')).then(function (b) {
        return new TextDecoder('utf-8', { fatal: true }).decode(b);
      }).catch(function () { throw new Error('That save code is damaged.'); });
    } catch (e) { return Promise.reject(new Error('That save code is damaged.')); }
  }

  // ---- files and clipboard ----
  function download(filename, text) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      var a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }, 1000);
    } catch (e) { /* ignore */ }
  }
  function shareFile(filename, text) {
    try {
      var file = new File([text], filename, { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        return navigator.share({ files: [file], title: 'Racing Boy save' }).then(function () { return true; }, function (e) {
          return !!(e && e.name === 'AbortError');
        });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(false);
  }
  function copyFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return copyFallback(text); });
      }
    } catch (e) { /* fall through */ }
    return Promise.resolve(copyFallback(text));
  }
  function readFile(file) {
    try {
      if (file.text) return file.text();
      return new Promise(function (res, rej) {
        var r = new FileReader();
        r.onload = function () { res(String(r.result)); };
        r.onerror = function () { rej(new Error('Could not read the file.')); };
        r.readAsText(file);
      });
    } catch (e) { return Promise.reject(e); }
  }

  window.RBPwa = {
    register: register, canInstall: canInstall, install: install, isStandalone: isStandalone, isIOS: isIOS,
    installHint: installHint, packSave: packSave, unpackSave: unpackSave, download: download, shareFile: shareFile,
    copyText: copyText, readFile: readFile
  };
})();
