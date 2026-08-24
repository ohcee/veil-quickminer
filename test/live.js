// Live end to end check: download, verify, unpack and run the RandomX miner
// against a real pool with a throwaway (valid but unowned) address, until the
// first hashrate report arrives. Run with: node test/live.js [baseDir]

const os = require('os');
const path = require('path');
const minerman = require('../src/minerman');
const bech32 = require('../src/bech32');

const words = bech32.toWords(Array.from({ length: 20 }, (_, i) => (i * 7) % 256));
const addr = bech32.encode('bv', [0].concat(words));
const baseDir = process.argv[2] || path.join(os.tmpdir(), 'quickminer-live');

let done = false;

function finish(code, msg) {
  if (done) return;
  done = true;
  console.log(msg);
  minerman.stop().then(() => process.exit(code));
}

minerman
  .start(
    { algo: 'randomx', address: addr, host: 'veil.yadaminers.pl', port: 3335, vendor: null },
    {
      baseDir,
      onEvent: (ev) => {
        if (ev.type === 'status') console.log('[status]', ev.text);
        else if (ev.type === 'log') console.log('[miner]', ev.line);
        else if (ev.type === 'hashrate') finish(0, 'LIVE_OK ' + ev.hs + ' H/s');
        else if (ev.type === 'error' && !done) finish(1, 'LIVE_FAIL ' + ev.text);
      },
    }
  )
  .then(({ bin, args }) => console.log('[spawned]', bin, args.join(' ')))
  .catch((err) => finish(1, 'LIVE_FAIL ' + err.message));

setTimeout(() => finish(1, 'LIVE_FAIL no hashrate within 180s'), 180000);
