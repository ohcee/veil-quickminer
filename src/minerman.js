// The miner manager. Downloads the right miner release, verifies it against
// the published SHA256SUMS, unpacks it, launches it and reads the hashrate
// off its output. Plain Node, no Electron imports, so it tests standalone.

const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const manifest = require('./miners.json');

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

// ccminer: "GPU #0: NVIDIA RTX 3080 Ti, 3331.21 MH/s" / "accepted: 5/5 (diff 512), 3.33 GH/s yes!"
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

// Downloads, verifies and unpacks if needed. Returns the path to the binary.
async function prepare(algo, vendor, baseDir, onStatus) {
  const def = manifest.miners[algo];
  const avail = availability(algo);
  if (!avail.ok) throw new Error(def.name + ': ' + avail.why);

  const asset = def.assets[assetKey(algo, vendor)];
  if (!asset) throw new Error(def.name + ' has no build for this machine yet');

  const home = path.join(baseDir, 'miners', algo, def.tag);
  const marker = path.join(home, '.verified-' + asset);
  fs.mkdirSync(home, { recursive: true });

  const wanted = binNames(algo, vendor);
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
  if (process.platform !== 'win32') {
    fs.chmodSync(bin, 0o755);
  }
  fs.writeFileSync(marker, actual + '\n');
  return bin;
}

// ---- run ------------------------------------------------------------------

const state = {
  child: null,
  algo: null,
  stopping: false,
  log: [],
};

function pushLog(line) {
  state.log.push(line);
  if (state.log.length > 200) state.log.shift();
}

async function start(cfg, opts) {
  if (state.child) throw new Error('already mining, stop first');
  const emit = opts.onEvent || (() => {});
  const status = (text) => emit({ type: 'status', text });

  const bin = await prepare(cfg.algo, cfg.vendor, opts.baseDir, status);
  if (state.child) throw new Error('already mining, stop first');

  const args = buildArgs(cfg.algo, cfg);
  status('starting ' + path.basename(bin) + '...');

  const env = { ...process.env };
  if (cfg.algo === 'sha256d') env.LD_LIBRARY_PATH = path.dirname(bin) + ':' + (env.LD_LIBRARY_PATH || '');

  const child = spawn(bin, args, { cwd: path.dirname(bin), env });
  state.child = child;
  state.algo = cfg.algo;
  state.stopping = false;
  state.log = [];

  const parse = PARSERS[cfg.algo];
  let sawRate = false;
  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      pushLog(line);
      emit({ type: 'log', line });
      const rate = parse(line);
      if (rate !== null) {
        if (!sawRate) {
          sawRate = true;
          status('mining');
        }
        emit({ type: 'hashrate', hs: rate });
      }
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);

  child.on('error', (err) => {
    state.child = null;
    emit({ type: 'error', text: 'could not start miner: ' + err.message });
  });
  child.on('exit', (code, signal) => {
    const wasStopping = state.stopping;
    state.child = null;
    state.stopping = false;
    if (wasStopping) {
      emit({ type: 'stopped' });
    } else {
      const tail = state.log.slice(-3).join('\n');
      emit({ type: 'error', text: 'miner exited (' + (signal || code) + ')' + (tail ? '\n' + tail : '') });
    }
  });

  return { bin, args };
}

function stop() {
  return new Promise((resolve) => {
    const child = state.child;
    if (!child) return resolve();
    state.stopping = true;
    child.once('exit', () => resolve());
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (state.child === child) child.kill('SIGKILL');
      }, 4000).unref();
    }
    // never hang the caller more than 6 seconds
    setTimeout(resolve, 6000).unref();
  });
}

function isMining() {
  return !!state.child;
}

module.exports = {
  start,
  stop,
  isMining,
  prepare,
  availability,
  buildArgs,
  parsers: PARSERS,
  manifest,
};
