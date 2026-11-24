// Tests for the character creator: the kid's look in the save.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), ctx, { filename: 'js/logic.js' });
const R = ctx.RB;
const plain = o => JSON.parse(JSON.stringify(o));

test('the option table has every slot with enough choices', () => {
  const O = R.KID_OPTS, min = { skin: 6, hair: 6, style: 4, hat: 4, jacket: 8, scarf: 8 };
  assert.deepEqual([...R.KID_KEYS], Object.keys(min));
  for (const [k, n] of Object.entries(min)) {
    assert.ok(O[k].length >= n, k + ' has ' + O[k].length);
    const ids = O[k].map(o => o.id);
    assert.equal(new Set(ids).size, ids.length, k + ' ids are unique');
    O[k].forEach(o => { assert.equal(typeof o.name, 'string'); if (k !== 'style' && k !== 'hat') assert.match(o.c, /^#[0-9a-f]{6}$/i); });
  }
  for (const h of ['cap', 'helmet', 'beanie', 'none']) assert.ok(R.kidOpt('hat', h), h);
  for (const h of ['short', 'curly', 'pony', 'spiky']) assert.ok(R.kidOpt('style', h), h);
});

test('a new game has the default kid, which is today\'s kid', () => {
  const s = R.newState(1);
  assert.deepEqual(plain(s.kid), plain(R.newKid()));
  assert.equal(R.kidOpt('skin', s.kid.skin).c, '#f0c49c');
  assert.equal(R.kidOpt('hair', s.kid.hair).c, '#8a4e2a');
  assert.equal(R.kidOpt('jacket', s.kid.jacket).c, '#4a6c80');
  assert.equal(R.kidOpt('scarf', s.kid.scarf).c, '#e0aa4e');
  assert.equal(s.kid.style, 'short');
  assert.equal(s.kid.hat, 'cap');
  assert.equal(s.kid.name, '');
  assert.equal(R.kidName(s), 'You');
});

test('setKid takes valid options and refuses the rest', () => {
  const s = R.newState(1);
  assert.equal(R.setKid(s, 'hat', 'helmet'), true); assert.equal(s.kid.hat, 'helmet');
  assert.equal(R.setKid(s, 'style', 'pony'), true); assert.equal(s.kid.style, 'pony');
  const jk = R.KID_OPTS.jacket[3].id;
  assert.equal(R.setKid(s, 'jacket', jk), true); assert.equal(s.kid.jacket, jk);
  assert.equal(R.setKid(s, 'hat', 'crown'), false); assert.equal(s.kid.hat, 'helmet');
  assert.equal(R.setKid(s, 'wings', 'big'), false); assert.equal(s.kid.wings, undefined);
  assert.equal(R.setKid(s, 'skin', 3), false);
  assert.equal(s.coins, 0, 'all options are free');
});

test('the name is trimmed text of at most 12 characters; empty means You', () => {
  const s = R.newState(1);
  assert.equal(R.setKid(s, 'name', '  Pip  '), true); assert.equal(s.kid.name, 'Pip'); assert.equal(R.kidName(s), 'Pip');
  R.setKid(s, 'name', 'Abcdefghijklmnopq'); assert.equal(s.kid.name, 'Abcdefghijkl');
  R.setKid(s, 'name', 'Ab\ncd\u0007'); assert.equal(s.kid.name, 'Abcd');
  R.setKid(s, 'name', '   '); assert.equal(s.kid.name, ''); assert.equal(R.kidName(s), 'You');
  assert.equal(R.setKid(s, 'name', 42), false); assert.equal(s.kid.name, '');
});

test('the kid look survives save and load', () => {
  const s = R.newState(5);
  R.setKid(s, 'hat', 'beanie'); R.setKid(s, 'style', 'spiky'); R.setKid(s, 'name', 'Zed');
  R.setKid(s, 'skin', R.KID_OPTS.skin[4].id); R.setKid(s, 'scarf', R.KID_OPTS.scarf[6].id);
  const t = R.deserialize(R.serialize(s));
  assert.deepEqual(plain(t.kid), plain(s.kid));
});

test('old saves and bad kid fields load with the defaults', () => {
  const s = R.newState(5), o = JSON.parse(R.serialize(s));
  delete o.kid;
  assert.deepEqual(plain(R.deserialize(JSON.stringify(o)).kid), plain(R.newKid()));
  o.kid = { hat: 'crown', style: 'pony', skin: 7, name: '  a very long name indeed ', extra: 1 };
  const t = R.deserialize(JSON.stringify(o));
  assert.equal(t.kid.hat, 'cap'); assert.equal(t.kid.style, 'pony'); assert.equal(t.kid.skin, R.newKid().skin);
  assert.equal(t.kid.name, 'a very long'); assert.equal(t.kid.extra, undefined);
  o.kid = 'nonsense';
  assert.deepEqual(plain(R.deserialize(JSON.stringify(o)).kid), plain(R.newKid()));
});

test('the player races under the kid\'s name', () => {
  const s = R.newState(3);
  assert.equal(R.startRace(s, 'meadow').cars[0].name, 'You');
  R.setKid(s, 'name', 'Mo');
  assert.equal(R.startRace(s, 'meadow').cars[0].name, 'Mo');
});
