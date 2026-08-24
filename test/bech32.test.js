// Address validation checks. Run with: node test/bech32.test.js

const assert = require('assert');
const { encode, decode, toWords, fromWords, validateVeilAddress } = require('../src/bech32');

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('PASS ' + name);
}

ok('BIP173 vector decodes', () => {
  const dec = decode('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  assert(dec, 'decode failed');
  assert.strictEqual(dec.hrp, 'bc');
});

ok('uppercase form decodes, mixed case does not', () => {
  assert(decode('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'));
  assert.strictEqual(decode('bc1QW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'), null);
});

const program = Array.from({ length: 20 }, (_, i) => (i * 7) % 256);
const veilAddr = encode('bv', [0].concat(toWords(program)));

ok('generated bv1 address round trips', () => {
  assert(veilAddr.startsWith('bv1'));
  const res = validateVeilAddress(veilAddr);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.network, 'mainnet');
  const dec = decode(veilAddr);
  assert.deepStrictEqual(fromWords(dec.data.slice(1)), program);
});

ok('single character damage is caught', () => {
  for (let i = 4; i < veilAddr.length; i++) {
    const c = veilAddr[i] === 'q' ? 'p' : 'q';
    if (c === veilAddr[i]) continue;
    const mangled = veilAddr.slice(0, i) + c + veilAddr.slice(i + 1);
    assert.strictEqual(validateVeilAddress(mangled).valid, false, 'accepted damage at ' + i);
  }
});

ok('testnet prefix reports testnet', () => {
  const t = encode('tv', [0].concat(toWords(program)));
  const res = validateVeilAddress(t);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.network, 'testnet');
});

ok('foreign prefix rejected', () => {
  const res = validateVeilAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
  assert.strictEqual(res.valid, false);
  assert(res.reason.includes('bv1'));
});

ok('real basecoin address reports type basecoin', () => {
  const res = validateVeilAddress('bv1qre9xsa7kj8vh6dg963w24vyx4g35gv8pa9vrsy');
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.network, 'mainnet');
  assert.strictEqual(res.type, 'basecoin');
});

ok('real stealth address is valid and reports type stealth', () => {
  const sv = 'sv1qqpjsrc60t60jhaywj5krmwla52ska70twc7wun6qnee65guxhvtxegpqwhuxypra4jn3pq86s24ryltcw6g2ss4573hyqac9u4g23m9mvxpyqqqwny49k';
  const res = validateVeilAddress(sv);
  assert.strictEqual(res.valid, true);
  assert.strictEqual(res.network, 'mainnet');
  assert.strictEqual(res.type, 'stealth');
});

ok('a damaged stealth address is caught by the checksum', () => {
  const sv = 'sv1qqpjsrc60t60jhaywj5krmwla52ska70twc7wun6qnee65guxhvtxegpqwhuxypra4jn3pq86s24ryltcw6g2ss4573hyqac9u4g23m9mvxpyqqqwny49k';
  const bad = sv.slice(0, 20) + (sv[20] === 'q' ? 'p' : 'q') + sv.slice(21);
  assert.strictEqual(validateVeilAddress(bad).valid, false);
});

ok('wrong witness version rejected', () => {
  const v1 = encode('bv', [1].concat(toWords(program)));
  assert.strictEqual(validateVeilAddress(v1).valid, false);
});

ok('wrong program length rejected', () => {
  const short = encode('bv', [0].concat(toWords(program.slice(0, 10))));
  assert.strictEqual(validateVeilAddress(short).valid, false);
});

ok('empty and junk input are calm', () => {
  assert.strictEqual(validateVeilAddress('').valid, false);
  assert.strictEqual(validateVeilAddress('   ').valid, false);
  assert.strictEqual(validateVeilAddress('hello world').valid, false);
  assert.strictEqual(validateVeilAddress(null).valid, false);
});

console.log(passed + ' checks passed');
