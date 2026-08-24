// Solo mode building blocks. Run with: node test/solo.test.js

const assert = require('assert');
const { compactToDiff } = require('../src/noderpc');
const { buildProxyArgs, pickShareDiff } = require('../src/minerman');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('PASS ' + name);
}

ok('compact bits to difficulty matches the known mainnet value', () => {
  // sha256d template bits 1b14614a was net diff ~3215.6 on mainnet
  const d = compactToDiff('1b14614a');
  assert(Math.abs(d - 3215.65) < 0.5, 'got ' + d);
});

ok('diff1 compact is difficulty 1', () => {
  assert(Math.abs(compactToDiff('1d00ffff') - 1) < 1e-9);
});

ok('share diff sits under net diff, sha256d never below 1', () => {
  assert.strictEqual(pickShareDiff('sha256d', 3200), 800);
  assert.strictEqual(pickShareDiff('sha256d', 2), 1);
  const rx = pickShareDiff('randomx', 0.008);
  assert(rx > 0 && rx < 0.008);
  assert(pickShareDiff('progpow', 0) > 0);
});

ok('proxy args carry the wire choices per algo', () => {
  const sha = buildProxyArgs('sha256d', 43333, 'http://u:p@127.0.0.1:58812', 800);
  assert(sha.join(' ').includes('--algos sha256d'));
  assert(sha.join(' ').includes('--sha256d-wire cpuminer'));
  assert(sha.join(' ').includes('--share-diff 800'));
  assert(sha.join(' ').includes('-a 127.0.0.1'));
  const rx = buildProxyArgs('randomx', 43333, 'http://u:p@127.0.0.1:58812', 0.002);
  assert(rx.join(' ').includes('--algos randomx'));
  assert(!rx.join(' ').includes('sha256d-wire'));
  const pp = buildProxyArgs('progpow', 43333, 'http://u:p@127.0.0.1:58812', 1);
  assert(pp.join(' ').includes('--subscribe-algo progpow'));
});

console.log(passed + ' checks passed');
