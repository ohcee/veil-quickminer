// Miner output parsing and command line building. Run with: node test/parsers.test.js

const assert = require('assert');
const { parsers, buildArgs } = require('../src/minerman');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('PASS ' + name);
}

ok('xmrig speed line', () => {
  const hs = parsers.randomx('[2026-08-24 01:02:03.456]  miner    speed 10s/60s/15m 5301.1 n/a n/a H/s max 5455.6 H/s');
  assert.strictEqual(hs, 5301.1);
});

ok('xmrig warmup and noise ignored', () => {
  assert.strictEqual(parsers.randomx('[2026-08-24 01:02:03.456]  miner    speed 10s/60s/15m n/a n/a n/a H/s max n/a H/s'), null);
  assert.strictEqual(parsers.randomx('[2026-08-24 01:02:03.456]  net      new job from veil.yadaminers.pl:3335 diff 60000 algo rx/veil height 3948000'), null);
  assert.strictEqual(parsers.randomx('[2026-08-24 01:02:03.456]  cpu      use profile  rx  (10 threads)'), null);
});

ok('veilminer periodic report', () => {
  const hs = parsers.progpow(' m 21:33:12 veilminer 0:01 A1 24.32 Mh - cu0 12.16, cu1 12.16');
  assert.strictEqual(hs, 24.32e6);
});

ok('veilminer kilohash and noise', () => {
  assert.strictEqual(parsers.progpow(' m 21:35:02 veilminer 0:03 A2 812.40 Kh - cpu 812.40'), 812.4e3);
  assert.strictEqual(parsers.progpow('cu 21:33:10 cuda-0   Generating DAG + Light : 12%'), null);
  assert.strictEqual(parsers.progpow(' i 21:33:09 veilminer Job: a1b2c3d4 block 3948000'), null);
});

ok('ccminer gpu and accepted lines', () => {
  assert.strictEqual(parsers.sha256d('[2026-08-24 01:02:03] GPU #0: NVIDIA GeForce RTX 3080 Ti, 3331.21 MH/s'), 3331.21e6);
  assert.strictEqual(parsers.sha256d('[2026-08-24 01:02:03] accepted: 5/5 (diff 512.00), 3.33 GH/s yes!'), 3.33e9);
  assert.strictEqual(parsers.sha256d('[2026-08-24 01:02:03] Stratum difficulty set to 512'), null);
});

const cfg = { address: 'bv1qtest', host: 'veil.yadaminers.pl', port: 3335, vendor: null };

ok('randomx args match the hub recipe', () => {
  const args = buildArgs('randomx', cfg);
  assert(args.includes('rx/veil'));
  assert(args.includes('veil.yadaminers.pl:3335'));
  assert(args.includes('bv1qtest'));
});

ok('progpow flag follows the gpu vendor', () => {
  assert(buildArgs('progpow', { ...cfg, vendor: 'nvidia' }).includes('--cuda'));
  assert(buildArgs('progpow', { ...cfg, vendor: 'amd' }).includes('--opencl'));
  assert(buildArgs('progpow', { ...cfg, vendor: null }).includes('--cpu'));
  assert(buildArgs('progpow', { ...cfg, vendor: 'nvidia' }).includes('stratum+tcp://bv1qtest@veil.yadaminers.pl:3335'));
});

ok('sha256d args differ per vendor build', () => {
  const nv = buildArgs('sha256d', { ...cfg, port: 3333, vendor: 'nvidia' });
  assert(nv.includes('-a') && nv.includes('sha256dv'));
  const amd = buildArgs('sha256d', { ...cfg, port: 3333, vendor: 'amd' });
  assert(!amd.includes('-a'));
  assert(amd.includes('stratum+tcp://veil.yadaminers.pl:3333'));
});

console.log(passed + ' checks passed');
