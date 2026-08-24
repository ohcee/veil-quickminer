// Live solo check against a local veild (regtest works well): the engine
// preflights the node over rpc, downloads and verifies veilproxy, spawns it,
// points the miner at it and waits for a hashrate and ideally a mined block.
// Run with: node test/live-solo.js <rpcport> <address> [baseDir]

const os = require('os');
const path = require('path');
const minerman = require('../src/minerman');

const rpcport = parseInt(process.argv[2], 10);
const address = process.argv[3];
const baseDir = process.argv[4] || path.join(os.tmpdir(), 'quickminer-live-solo');
if (!rpcport || !address) {
  console.error('usage: node test/live-solo.js <rpcport> <address> [baseDir]');
  process.exit(2);
}

let sawRate = false;
let sawBlock = false;
let done = false;

function finish(code, msg) {
  if (done) return;
  done = true;
  console.log(msg);
  minerman.stop().then(() => process.exit(code));
}

minerman
  .start(
    {
      mode: 'solo',
      algo: 'randomx',
      address,
      vendor: null,
      node: { host: '127.0.0.1', port: rpcport, user: 'veil', pass: 'veil' },
    },
    {
      baseDir,
      onEvent: (ev) => {
        if (ev.type === 'status') console.log('[status]', ev.text);
        else if (ev.type === 'log') console.log('[' + ev.src + ']', ev.line);
        else if (ev.type === 'hashrate') {
          if (!sawRate) console.log('[rate]', ev.hs, 'H/s');
          sawRate = true;
        } else if (ev.type === 'block') {
          sawBlock = true;
          console.log('[block]', ev.count, 'accepted');
          finish(0, 'LIVE_SOLO_OK block accepted' + (sawRate ? ' with hashrate' : ''));
        } else if (ev.type === 'error' && !done) {
          finish(1, 'LIVE_SOLO_FAIL ' + ev.text);
        }
      },
    }
  )
  .then(({ bin, args }) => console.log('[spawned]', bin, args.join(' ')))
  .catch((err) => finish(1, 'LIVE_SOLO_FAIL ' + err.message));

setTimeout(() => {
  if (sawRate) finish(0, 'LIVE_SOLO_OK hashrate seen, no block within the window');
  else finish(1, 'LIVE_SOLO_FAIL nothing mined within 240s');
}, 240000);
