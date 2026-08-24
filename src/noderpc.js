// Minimal JSON RPC client for veild plus the solo mode preflight.

const http = require('http');

const HEADER_FIELD = { progpow: 'pprpcheader', randomx: 'rxrpcheader', sha256d: 'sharpcheader' };

function call(node, method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '1.0', id: 'quickminer', method, params: params || [] });
    const req = http.request(
      {
        host: node.host || '127.0.0.1',
        port: node.port,
        method: 'POST',
        auth: (node.user || '') + ':' + (node.pass || ''),
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('the node rejected the rpc user or password'));
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch (err) {
            return reject(new Error('node gave a non rpc answer (http ' + res.statusCode + ')'));
          }
          if (parsed.error) {
            return reject(new Error(parsed.error.message || 'rpc error ' + parsed.error.code));
          }
          resolve(parsed.result);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('node did not answer within 20s')));
    req.on('error', (err) => reject(new Error('could not reach the node at ' + (node.host || '127.0.0.1') + ':' + node.port + ' (' + err.code + ')')));
    req.end(body);
  });
}

// standard compact bits to difficulty, diff1 = 0x1d00ffff
function compactToDiff(bits) {
  const n = typeof bits === 'string' ? parseInt(bits, 16) : bits;
  const exp = n >>> 24;
  const mant = n & 0xffffff;
  if (!mant) return 0;
  return (0xffff / mant) * Math.pow(256, 0x1d - exp);
}

// Checks the node is reachable, synced, on the right chain and serving solo
// work for the algo. Returns the current net difficulty for that algo.
async function preflight(node, algo, network) {
  const info = await call(node, 'getblockchaininfo');
  const chain = { main: 'mainnet', test: 'testnet' }[info.chain] || info.chain;
  if (network && (chain === 'mainnet' || chain === 'testnet') && chain !== network) {
    throw new Error('the node runs ' + chain + ' but the address is ' + network);
  }
  if (info.initialblockdownload && chain !== 'regtest') {
    throw new Error('the node is still syncing (' + info.blocks + ' of ' + info.headers + ' blocks)');
  }

  const params = algo === 'sha256d' ? { algo: 'sha256d', rules: ['segwit'] } : { algo };
  let template;
  try {
    template = await call(node, 'getblocktemplate', [params]);
  } catch (err) {
    if (/downloading blocks|is not connected/i.test(err.message)) {
      throw new Error('the node has no peers yet, give it a minute to connect');
    }
    throw err;
  }
  const field = HEADER_FIELD[algo];
  if (!template[field]) {
    throw new Error(
      'the node is not set up for solo ' + algo + ': add miningaddress=<your address> to veil.conf and restart it' +
        (algo === 'sha256d' ? ' (sha256d also needs a veild built from current master)' : '')
    );
  }
  return {
    chain,
    height: template.height,
    netDiff: compactToDiff(template.bits),
  };
}

module.exports = { call, preflight, compactToDiff, HEADER_FIELD };
