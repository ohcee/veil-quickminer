// Renderer logic. Everything heavier runs in the main process behind window.qm.

const ALGOS = [
  { id: 'randomx', title: 'RandomX', sub: 'CPU, every machine can mine this', miner: 'Veil-Miner-CPU', needs: 'cpu' },
  { id: 'progpow', title: 'ProgPoW', sub: 'GPU, NVIDIA or AMD', miner: 'Veil-Miner', needs: 'gpu' },
  { id: 'sha256d', title: 'SHA256d', sub: 'GPU, NVIDIA or AMD', miner: 'Veil-Miner-SHA', needs: 'gpu' },
];

const state = {
  addressValid: false,
  network: null,
  mode: 'pool',
  algo: null,
  hw: null,
  pools: [],
  miners: {},
  mining: false,
  busy: false,
};

const $ = (id) => document.getElementById(id);

function algoFlag(algo) {
  const info = state.miners[algo.id];
  if (info && info.availability && !info.availability.ok) {
    return { ok: false, text: info.availability.why };
  }
  if (!state.hw) return { ok: true, text: 'ready' };
  if (algo.needs === 'gpu' && !state.hw.gpus.length) {
    return { ok: false, text: 'no matching hardware' };
  }
  return { ok: true, text: 'ready' };
}

function renderAlgos() {
  const wrap = $('algo-cards');
  wrap.innerHTML = '';
  for (const algo of ALGOS) {
    const flag = algoFlag(algo);
    const el = document.createElement('div');
    el.className = 'algo' + (state.algo === algo.id ? ' selected' : '');
    el.dataset.algo = algo.id;

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = algo.title;
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = algo.sub;
    const miner = document.createElement('div');
    miner.className = 'miner';
    miner.textContent = algo.miner;
    left.append(name, sub, miner);

    const flagEl = document.createElement('div');
    flagEl.className = 'flag ' + (flag.ok ? 'ok' : 'warn');
    flagEl.textContent = flag.text;

    el.append(left, flagEl);
    el.addEventListener('click', () => {
      if (state.mining || state.busy) return;
      state.algo = algo.id;
      renderAlgos();
      renderPools();
      updateStart();
    });
    wrap.appendChild(el);
  }
}

function matchingPools() {
  return state.pools.filter((p) => !state.algo || p.algo === state.algo);
}

function renderPools() {
  const select = $('pool-select');
  const hint = $('pool-hint');
  select.innerHTML = '';
  const matching = matchingPools();
  if (!matching.length) {
    const opt = document.createElement('option');
    opt.textContent = state.algo ? 'no known pool for this algo yet' : 'pick an algo first';
    opt.value = '';
    select.appendChild(opt);
    hint.textContent = '';
    return;
  }
  matching.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p.name + ' · ' + p.host + ':' + p.port;
    select.appendChild(opt);
  });
  hint.textContent = 'pools pay out on mainnet, so use a bv1 address';
}

function setMode(mode) {
  if (state.mining || state.busy) return;
  state.mode = mode;
  $('mode-pool').classList.toggle('active', mode === 'pool');
  $('mode-solo').classList.toggle('active', mode === 'solo');
  $('pool-panel').classList.toggle('hidden', mode !== 'pool');
  $('solo-panel').classList.toggle('hidden', mode !== 'solo');
  updateStart();
}

function updateStart() {
  if (state.mining || state.busy) {
    $('start').disabled = state.busy && !state.mining;
    return;
  }
  $('start').disabled = !(state.addressValid && state.algo);
}

function formatRate(hs) {
  if (hs >= 1e9) return { v: (hs / 1e9).toFixed(2), u: 'GH/s' };
  if (hs >= 1e6) return { v: (hs / 1e6).toFixed(2), u: 'MH/s' };
  if (hs >= 1e3) return { v: (hs / 1e3).toFixed(2), u: 'kH/s' };
  return { v: hs.toFixed(1), u: 'H/s' };
}

function setStatus(text, cls) {
  const status = $('status');
  status.className = 'msg' + (cls ? ' ' + cls : '');
  status.textContent = text;
}

function setMiningUi(mining) {
  state.mining = mining;
  $('start').textContent = mining ? 'Stop mining' : 'Start mining';
  $('start').classList.toggle('stop', mining);
  if (!mining) {
    $('hashrate').textContent = '0';
    $('rate-unit').textContent = 'H/s';
  }
  updateStart();
}

let debounceTimer = null;
function onAddressInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const input = $('address');
    const msg = $('addr-msg');
    const value = input.value.trim();
    if (!value) {
      input.className = '';
      msg.className = 'msg';
      msg.textContent = '';
      state.addressValid = false;
      updateStart();
      return;
    }
    const res = await window.qm.validateAddress(value);
    state.addressValid = res.valid;
    state.network = res.network || null;
    input.className = res.valid ? 'ok' : 'err';
    msg.className = 'msg ' + (res.valid ? 'ok' : 'err');
    msg.textContent = res.valid ? 'valid ' + res.network + ' address' : res.reason;
    updateStart();
  }, 200);
}

async function findNode() {
  const msg = $('node-msg');
  msg.textContent = 'looking...';
  const conf = await window.qm.readVeilConf();
  if (!conf.found) {
    msg.textContent = 'no veil.conf or cookie under ' + conf.datadir + ', fill the fields in yourself';
    return;
  }
  $('rpc-host').value = conf.host || '127.0.0.1';
  $('rpc-port').value = conf.port || '';
  $('rpc-user').value = conf.user || '';
  $('rpc-pass').value = conf.passSet ? '••••••••' : '';
  $('rpc-pass').dataset.fromConf = conf.passSet ? '1' : '';
  msg.textContent = conf.cookie
    ? 'found the node cookie in ' + conf.datadir
    : 'loaded rpc settings from veil.conf';
}

function primaryVendor() {
  if (!state.hw || !state.hw.gpus.length) return null;
  return state.hw.gpus.some((g) => g.vendor === 'nvidia') ? 'nvidia' : state.hw.gpus[0].vendor;
}

async function onStart() {
  if (state.mining) {
    setStatus('stopping...');
    await window.qm.stopMining();
    return;
  }
  if (state.busy) return;

  const cfg = {
    mode: state.mode,
    algo: state.algo,
    network: state.network,
    address: $('address').value.trim(),
    vendor: primaryVendor(),
  };
  if (state.mode === 'pool') {
    const matching = matchingPools();
    const pool = matching[parseInt($('pool-select').value, 10)] || matching[0];
    if (!pool) {
      setStatus('no pool available for this algo yet', 'warn');
      return;
    }
    if (state.network !== 'mainnet') {
      setStatus('pools pay out on mainnet, use a bv1 address', 'warn');
      return;
    }
    cfg.host = pool.host;
    cfg.port = pool.port;
  } else {
    cfg.node = {
      host: $('rpc-host').value.trim(),
      port: $('rpc-port').value.trim(),
      user: $('rpc-user').value.trim(),
      pass: $('rpc-pass').dataset.fromConf === '1' ? null : $('rpc-pass').value,
      passFromConf: $('rpc-pass').dataset.fromConf === '1',
    };
  }

  state.busy = true;
  updateStart();
  setStatus('getting ready...');
  const res = await window.qm.startMining(cfg);
  state.busy = false;
  if (res.ok) {
    setMiningUi(true);
  } else {
    setMiningUi(false);
    setStatus(res.reason, 'err');
  }
}

function onMiningEvent(ev) {
  if (ev.type === 'status') {
    setStatus(ev.text, /^mining/.test(ev.text) ? 'ok' : '');
  } else if (ev.type === 'block') {
    setStatus('block found! ' + ev.count + ' this session 🎉', 'ok');
  } else if (ev.type === 'hashrate') {
    const r = formatRate(ev.hs);
    $('hashrate').textContent = r.v;
    $('rate-unit').textContent = r.u;
  } else if (ev.type === 'error') {
    setMiningUi(false);
    setStatus(ev.text, 'err');
  } else if (ev.type === 'stopped') {
    setMiningUi(false);
    setStatus('stopped');
  }
}

async function init() {
  $('address').addEventListener('input', onAddressInput);
  // typing a password by hand overrides whatever Find my node loaded
  $('rpc-pass').addEventListener('input', () => {
    $('rpc-pass').dataset.fromConf = '';
  });
  $('mode-pool').addEventListener('click', () => setMode('pool'));
  $('mode-solo').addEventListener('click', () => setMode('solo'));
  $('find-node').addEventListener('click', findNode);
  $('start').addEventListener('click', onStart);
  window.qm.onMiningEvent(onMiningEvent);

  renderAlgos();

  const poolData = await window.qm.getPools();
  state.pools = poolData.pools || [];
  state.miners = await window.qm.getMiners();

  const hw = await window.qm.detectHardware();
  state.hw = hw;
  const gpuText = hw.gpus.length
    ? hw.gpus.map((g) => g.name + (g.memory ? ' (' + g.memory + ')' : '')).join(', ')
    : 'no discrete GPU found';
  $('hw-line').textContent = hw.cpu.model + ' · ' + hw.cpu.threads + ' threads · ' + gpuText;

  // sensible default: GPU rigs start on ProgPoW, everyone else on RandomX
  state.algo = hw.gpus.length ? 'progpow' : 'randomx';
  renderAlgos();
  renderPools();
  updateStart();

  window.__qmReady = true;
}

init().catch((err) => {
  console.error('init failed', err);
  const status = $('status');
  if (status) {
    status.className = 'msg err';
    status.textContent = 'startup problem: ' + err.message;
  }
});
