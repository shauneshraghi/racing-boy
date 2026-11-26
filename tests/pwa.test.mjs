// Tests for the app install files and the save code that carries a game to another device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const ctx = { window: {}, navigator: {}, location: { protocol: 'file:' }, document: { readyState: 'complete' },
  TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, btoa, atob, Uint8Array, Promise, Error, String };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('js/logic.js', root), 'utf8'), ctx, { filename: 'js/logic.js' });
vm.runInContext(readFileSync(new URL('js/pwa.js', root), 'utf8'), ctx, { filename: 'js/pwa.js' });
const R = ctx.RB, P = ctx.window.RBPwa;

function played() {
  const s = R.newState(4242);
  s.coins = 12345; s.parts = [5, 4, 3, 2, 1]; s.races = 17; s.best.meadow = 1; s.bestT.meadow = 141.2; s.wins.meadow = 2;
  R.setKid(s, 'name', 'Aaron'); R.setKid(s, 'hat', 'helmet');
  return s;
}

test('a save code round-trips the whole game', async () => {
  const s = played(), json = R.serialize(s);
  const code = await P.packSave(json);
  assert.match(code, /^RB1\.[A-Za-z0-9_-]+$/);
  assert.ok(code.length < json.length, 'the code is compressed');
  const back = R.deserialize(await P.unpackSave(code));
  assert.equal(R.serialize(back), json);
});

test('a pasted code with spaces and line breaks still loads', async () => {
  const json = R.serialize(played()), code = await P.packSave(json);
  const messy = '  ' + code.slice(0, 20) + '\n' + code.slice(20, 40) + ' ' + code.slice(40) + '\n';
  assert.equal(await P.unpackSave(messy), json);
});

test('an uncompressed RB0 code loads', async () => {
  const json = R.serialize(played());
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  assert.equal(await P.unpackSave('RB0.' + b64), json);
});

test('junk and other games\' codes are refused', async () => {
  for (const bad of ['', 'hello', 'DTW1.H4sIAAAA', 'RB1.', 'RB1.!!!!', 'RB1.AAAAAAAA']) {
    await assert.rejects(P.unpackSave(bad), bad);
  }
});

test('the app manifest, service worker and icons are in place', () => {
  const m = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  for (const i of m.icons) assert.ok(existsSync(new URL(i.src, root)), i.src);
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  const html = readFileSync(new URL('index.html', root), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /js\/pwa\.js/);
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  for (const f of sw.match(/'\.\/[^']+'/g).map(s => s.slice(3, -1)).filter(Boolean)) assert.ok(existsSync(new URL(f, root)), f);
  assert.ok(existsSync(new URL('icons/apple-touch-icon.png', root)));
});
