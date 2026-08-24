// The miner manager. Downloads miner and proxy releases, verifies them
// against the published SHA256SUMS, unpacks, launches and reads hashrate and
// block events off the process output. Plain Node, no Electron imports, so it
// tests standalone.
//
// Pool mode:  miner -> pool
// Solo mode:  miner -> local veilproxy -> the user's own veild

const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');

const manifest = require('./miners.json');
const noderpc = require('./noderpc');

// ---- output parsing, one recognizer per miner family ----------------------

const UNIT = { '': 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 };

// xmrig: "miner    speed 10s/60s/15m 5301.1 n/a n/a H/s max 5455.6 H/s"
function parseXmrig(line) {
  if (!/speed/.test(line)) return null;
  const m = line.match(/speed\s+[\d.]+s\/[\d.]+s\/[\d.]+m\s+([\d.]+)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

// progminer/veilminer: " m 21:33:12 veilminer 0:01 A1 24.32 Mh - cu0 24.32"
function parseVeilminer(line) {
  if (!/\d+:\d+\s+A\d+/.test(line) && !/speed/i.test(line)) return null;
  const m = line.match(/([\d.]+)\s*([kKmMgG])h(?:\/s)?\b/);
  if (!m) return null;
  const v = parseFloat(m[1]) * UNIT[m[2]];
  return Number.isFinite(v) ? v : null;
}

// ccminer: "GPU #0: NVIDIA RTX 3080 Ti, 3331.21 MH/s" / "accepted: 5/5 (diff 512.00), 3.33 GH/s yes!"
function parseCcminer(line) {
  const m = line.match(/([\d.]+)\s*([kKmMgG]?)H\/s/);
  if (!m) return null;
  const v = parseFloat(m[1]) * UNIT[m[2] || ''];
  return Number.isFinite(v) ? v : null;
}

const PARSERS = { randomx: parseXmrig, progpow: parseVeilminer, sha256d: parseCcminer };

// ---- command lines, straight from the field tested hub recipes ------------

function buildArgs(algo, cfg) {
  const url = 'stratum+tcp://' + cfg.host + ':' + cfg.port;
  if (algo === 'randomx') {
    return ['-o', cfg.host + ':' + cfg.port, '-a', 'rx/veil', '-u', cfg.address, '-p', 'x', '--no-color', '--print-time', '10'];
  }
  if (algo === 'progpow') {
    const flag = cfg.vendor === 'nvidia' ? '--cuda' : cfg.vendor === 'amd' ? '--opencl' : '--cpu';
    return [flag, '-P', 'stratum+tcp://' + cfg.address + '@' + cfg.host + ':' + cfg.port];
  }
  if (algo === 'sha256d') {
    // the amd build is single algo and takes no -a flag
    if (cfg.vendor === 'amd') return ['-o', url, '-u', cfg.address, '-p', 'x'];
    return ['-a', 'sha256dv', '-o', url, '-u', cfg.address, '-p', 'x'];
  }
  throw new Error('unknown algo ' + algo);
}

function buildProxyArgs(algo, port, nodeUrl, shareDiff) {
  const args = ['-a', '127.0.0.1', '-p', String(port), '-n', nodeUrl, '--algos', algo, '--share-diff', String(shareDiff)];
  if (algo === 'sha256d') args.push('--subscribe-algo', 'sha256d', '--sha256d-wire', 'cpuminer');
  else if (algo === 'progpow') args.push('--subscribe-algo', 'progpow');
  return args;
}

// share diff sits well under the net diff so no block worthy hash is dropped;
// ccminer mishandles sub 1 diffs so sha256d never goes below 1
function pickShareDiff(algo, netDiff) {
  let diff = netDiff / 4;
  if (algo === 'sha256d') diff = Math.max(1, Math.floor(diff));
  if (!(diff > 0)) diff = algo === 'sha256d' ? 1 : 0.0001;
  return diff;
}

// which platforms can run each algo right now, from the published assets
function availability(algo) {
  const def = manifest.miners[algo];
  const plat = process.platform + '-' + os.arch();
  if (algo === 'sha256d') {
    if (process.platform !== 'linux') return { ok: false, why: 'linux only for now' };
    return { ok: true };
  }
  if (def.assets[plat]) return { ok: true };
  return { ok: false, why: 'no build for this machine yet' };
}

// ---- download and verify --------------------------------------------------

function fetchToFile(url, dest, onProgress, depth) {
  depth = depth || 0;
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': 'veil-quickminer' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          return resolve(fetchToFile(res.headers.location, dest, onProgress, depth + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error('download failed, http ' + res.statusCode + ' for ' + url));
        }
        const total = parseInt(res.headers['content-length'], 10) || 0;
        let got = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          got += chunk.length;
          if (onProgress) onProgress(got, total);
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        res.on('error', reject);
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (c) => hash.update(c));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function parseSums(text) {
  const map = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) map[m[2].trim()] = m[1].toLowerCase();
  }
  return map;
}

function extract(archive, destDir) {
  return new Promise((resolve, reject) => {
    const isZip = archive.endsWith('.zip');
    let cmd = 'tar';
    let args = ['-xf', archive, '-C', destDir];
    if (isZip && process.platform === 'linux') {
      cmd = 'unzip';
      args = ['-o', '-q', archive, '-d', destDir];
    }
    execFile(cmd, args, (err) => (err ? reject(new Error('unpack failed: ' + err.message)) : resolve()));
  });
}

function findFile(dir, names) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch (err) {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (names.includes(e.name)) return full;
    }
  }
  return null;
}

// shared download, verify, unpack pipeline for miners and the proxy
async function prepareDef(def, asset, wanted, home, onStatus) {
  if (!asset) throw new Error(def.name + ' has no build for this machine yet');
  const marker = path.join(home, '.verified-' + asset);
  fs.mkdirSync(home, { recursive: true });

  let bin = findFile(home, wanted);
  if (bin && fs.existsSync(marker)) return bin;

  const base = 'https://github.com/' + def.repo + '/releases/download/' + def.tag + '/';
  const archive = path.join(home, asset);
  const sumsFile = path.join(home, def.sums);

  onStatus('downloading ' + def.name + '...');
  let lastPct = -10;
  await fetchToFile(base + asset, archive, (got, total) => {
    if (!total) return;
    const pct = Math.floor((got / total) * 100);
    if (pct >= lastPct + 10) {
      lastPct = pct;
      onStatus('downloading ' + def.name + ' ' + pct + '%');
    }
  });
  await fetchToFile(base + def.sums, sumsFile);

  onStatus('verifying checksums...');
  const sums = parseSums(fs.readFileSync(sumsFile, 'utf8'));
  const expected = sums[asset];
  if (!expected) throw new Error(def.sums + ' does not list ' + asset + ', refusing to run it');
  const actual = await sha256File(archive);
  if (actual !== expected) {
    fs.unlinkSync(archive);
    throw new Error('checksum mismatch for ' + asset + ', download discarded');
  }

  onStatus('unpacking...');
  await extract(archive, home);
  bin = findFile(home, wanted);
  if (!bin) throw new Error('could not find ' + wanted.join(' or ') + ' inside ' + asset);
  if (process.platform !== 'win32') fs.chmodSync(bin, 0o755);
  fs.writeFileSync(marker, actual + '\n');
  return bin;
}

function assetKey(algo, vendor) {
  const plat = process.platform + '-' + os.arch();
  if (algo === 'sha256d') return plat + '-' + (vendor === 'amd' ? 'amd' : 'nvidia');
  return plat;
}

function binNames(algo, vendor) {
  const bin = manifest.miners[algo].bin;
  if (algo === 'sha256d') return [vendor === 'amd' ? bin.amd : bin.nvidia];
  return [bin[process.platform] || bin.default];
}

function prepare(algo, vendor, baseDir, onStatus) {
  const def = manifest.miners[algo];
  const avail = availability(algo);
  if (!avail.ok) return Promise.reject(new Error(def.name + ': ' + avail.why));
  const home = path.join(baseDir, 'miners', algo, def.tag);
  return prepareDef(def, def.assets[assetKey(algo, vendor)], binNames(algo, vendor), home, onStatus);
}

function prepareProxy(baseDir, onStatus) {
  const def = manifest.proxy;
  const plat = process.platform + '-' + os.arch();
  const home = path.join(baseDir, 'proxy', def.tag);
  return prepareDef(def, def.assets[plat], [def.bin[process.platform] || def.bin.default], home, onStatus);
}

// ---- ports ----------------------------------------------------------------

function freePort(start) {
  return new Promise((resolve, reject) => {
    let candidate = start;
    const attempt = () => {
      const srv = net.createServer();
      srv.once('error', () => {
        candidate += 1;
        if (candidate > start + 20) return reject(new Error('no free local port near ' + start));
        attempt();
      });
      srv.listen(candidate, '127.0.0.1', () => {
        srv.close(() => resolve(candidate));
      });
    };
    attempt();
  });
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => {
        sock.destroy();
        resolve();
      });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error('the local proxy did not come up on port ' + port));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

// ---- run ------------------------------------------------------------------

const state = {
  miner: null,
  proxy: null,
  stopping: false,
  stopRequested: false,
  log: [],
  blocks: 0,
  emit: () => {},
};

function pushLog(line) {
  state.log.push(line);
  if (state.log.length > 300) state.log.shift();
}

function lineReader(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
      buffer = buffer.slice(idx + 1);
      if (line) onLine(line);
    }
  };
}

function killChild(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode) return resolve();
    child.once('exit', () => resolve());
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 4000).unref();
    }
    setTimeout(resolve, 6000).unref();
  });
}

async function cleanupAfterFailure() {
  state.stopping = true;
  await killChild(state.miner);
  await killChild(state.proxy);
  state.miner = null;
  state.proxy = null;
  state.stopping = false;
}

function spawnMiner(cfg, bin) {
  const emit = state.emit;
  const args = buildArgs(cfg.algo, cfg);
  emit({ type: 'status', text: 'starting ' + path.basename(bin) + '...' });

  const env = { ...process.env };
  if (cfg.algo === 'sha256d') env.LD_LIBRARY_PATH = path.dirname(bin) + ':' + (env.LD_LIBRARY_PATH || '');

  const child = spawn(bin, args, { cwd: path.dirname(bin), env });
  state.miner = child;

  const parse = PARSERS[cfg.algo];
  let sawRate = false;
  const onData = lineReader((line) => {
    pushLog(line);
    emit({ type: 'log', src: 'miner', line });
    const rate = parse(line);
    if (rate !== null) {
      if (!sawRate) {
        sawRate = true;
        emit({ type: 'status', text: cfg.mode === 'solo' ? 'mining solo' : 'mining' });
      }
      emit({ type: 'hashrate', hs: rate });
    }
  });
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => {
    state.miner = null;
    emit({ type: 'error', text: 'could not start miner: ' + err.message });
  });
  child.on('exit', (code, signal) => {
    state.miner = null;
    if (!state.stopping) {
      const tail = state.log.slice(-3).join('\n');
      emit({ type: 'error', text: 'miner exited (' + (signal || code) + ')' + (tail ? '\n' + tail : '') });
      killChild(state.proxy).then(() => {
        state.proxy = null;
      });
    }
  });
  return { bin, args };
}

function spawnProxy(bin, args) {
  const emit = state.emit;
  const child = spawn(bin, args, { cwd: path.dirname(bin) });
  state.proxy = child;

  const onData = lineReader((line) => {
    pushLog('[proxy] ' + line);
    emit({ type: 'log', src: 'proxy', line });
    if (/Block accepted/.test(line)) {
      state.blocks += 1;
      emit({ type: 'block', count: state.blocks });
    } else if (/Block rejected by node/.test(line)) {
      emit({ type: 'status', text: 'a block was rejected by the node, see the log' });
    } else if (/getblocktemplate failed/.test(line)) {
      emit({ type: 'status', text: 'the node stopped serving work, check veild' });
    }
  });
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => {
    state.proxy = null;
    emit({ type: 'error', text: 'could not start the proxy: ' + err.message });
  });
  child.on('exit', (code, signal) => {
    state.proxy = null;
    if (!state.stopping) {
      const tail = state.log.slice(-3).join('\n');
      emit({ type: 'error', text: 'the solo proxy exited (' + (signal || code) + ')' + (tail ? '\n' + tail : '') });
      killChild(state.miner).then(() => {
        state.miner = null;
      });
    }
  });
}

async function start(cfg, opts) {
  if (state.miner || state.proxy) throw new Error('already mining, stop first');
  state.emit = opts.onEvent || (() => {});
  state.log = [];
  state.blocks = 0;
  state.stopping = false;
  state.stopRequested = false;
  const status = (text) => state.emit({ type: 'status', text });
  // a stop that lands during the async prepare steps must not be outraced
  const bail = () => {
    if (state.stopRequested) throw new Error('stopped');
    if (state.miner || state.proxy) throw new Error('already mining, stop first');
  };

  if (cfg.mode !== 'solo') {
    const bin = await prepare(cfg.algo, cfg.vendor, opts.baseDir, status);
    bail();
    return spawnMiner(cfg, bin);
  }

  // solo: preflight the node, run the proxy, point the miner at it
  status('checking the node...');
  const pf = await noderpc.preflight(cfg.node, cfg.algo, cfg.network);
  const shareDiff = pickShareDiff(cfg.algo, pf.netDiff);

  const minerBin = await prepare(cfg.algo, cfg.vendor, opts.baseDir, status);
  const proxyBin = await prepareProxy(opts.baseDir, status);
  bail();

  const port = await freePort(43333);
  const nodeUrl =
    'http://' +
    encodeURIComponent(cfg.node.user || '') +
    ':' +
    encodeURIComponent(cfg.node.pass || '') +
    '@' +
    (cfg.node.host || '127.0.0.1') +
    ':' +
    cfg.node.port;

  status('starting the solo proxy on 127.0.0.1:' + port + '...');
  spawnProxy(proxyBin, buildProxyArgs(cfg.algo, port, nodeUrl, shareDiff));
  try {
    await waitForPort(port, 15000);
  } catch (err) {
    const tail = state.log.slice(-4).join('\n');
    await cleanupAfterFailure();
    throw new Error(err.message + (tail ? '\n' + tail : ''));
  }
  if (state.stopRequested) {
    await cleanupAfterFailure();
    throw new Error('stopped');
  }

  return spawnMiner({ ...cfg, host: '127.0.0.1', port }, minerBin);
}

async function stop() {
  state.stopRequested = true;
  state.stopping = true;
  await killChild(state.miner);
  state.miner = null;
  await killChild(state.proxy);
  state.proxy = null;
  state.stopping = false;
  state.emit({ type: 'stopped' });
}

function isMining() {
  return !!(state.miner || state.proxy);
}

module.exports = {
  start,
  stop,
  isMining,
  prepare,
  prepareProxy,
  availability,
  buildArgs,
  buildProxyArgs,
  pickShareDiff,
  parsers: PARSERS,
  manifest,
};
