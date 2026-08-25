// Renderer logic. Everything heavier runs in the main process behind window.qm.

const ALGOS = [
  { id: 'randomx', title: 'RandomX', sub: 'CPU, every machine can mine this', miner: 'Veil-Miner-CPU', needs: 'cpu' },
  { id: 'progpow', title: 'ProgPoW', sub: 'GPU, NVIDIA or AMD', miner: 'Veil-Miner', needs: 'gpu' },
  { id: 'sha256d', title: 'SHA256d', sub: 'GPU, NVIDIA or AMD', miner: 'Veil-Miner-SHA', needs: 'gpu' },
];

const state = {
  addressValid: false,
  network: null,
  addressType: null,
  mode: 'pool',
  algo: null,
  hw: null,
  pools: [],
  miners: {},
  mining: false,
  busy: false,
  devices: null, // set of selected GPU indices; null until hardware is known
  intensity: 'auto',
};

const GPU_ALGOS = new Set(['progpow', 'sha256d']);

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
      renderTuning();
      refreshAddressFeedback();
      updateStart();
    });
    wrap.appendChild(el);
  }
}

// Show the tuning card only for a GPU algo on a machine that has GPUs. Device
// checkboxes default to all cards on; the intensity segmented control drives
// state.intensity.
function renderTuning() {
  const card = $('tuning-card');
  const gpus = (state.hw && state.hw.gpus) || [];
  const show = GPU_ALGOS.has(state.algo) && gpus.length > 0;
  card.classList.toggle('hidden', !show);
  if (!show) return;
  if (!state.devices) state.devices = new Set(gpus.map((_, i) => i));

  const list = $('device-list');
  list.innerHTML = '';
  gpus.forEach((g, i) => {
    const on = state.devices.has(i);
    const el = document.createElement('label');
    el.className = 'dev' + (on ? ' on' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = on;
    cb.addEventListener('change', () => {
      if (state.mining) return;
      if (cb.checked) state.devices.add(i);
      else if (state.devices.size > 1) state.devices.delete(i); // keep at least one
      else cb.checked = true;
      renderTuning();
    });
    const name = document.createElement('span');
    name.textContent = 'GPU ' + i + (g.name ? ' · ' + g.name.replace(/NVIDIA GeForce /i, '') : '');
    el.append(cb, name);
    list.appendChild(el);
  });
}

function matchingPools() {
  return state.pools.filter((p) => !state.algo || p.algo === state.algo);
}

function selectedPool() {
  const matching = matchingPools();
  if (!matching.length) return null;
  const idx = parseInt($('pool-select').value, 10);
  return matching[Number.isFinite(idx) ? idx : 0] || matching[0];
}

// Whether the (already structurally valid) address suits the chosen mode and
// pool. yadaminers takes basecoin or stealth; FastPool and solo need basecoin.
function addressContext() {
  if (!state.addressValid) return { ok: false, msg: '', cls: '' };
  const typeLabel = state.addressType === 'stealth' ? 'stealth' : 'basecoin';
  if (state.mode === 'solo') {
    if (state.addressType !== 'basecoin') {
      return { ok: false, msg: 'solo mining needs a basecoin (bv1) address', cls: 'warn' };
    }
    return { ok: true, msg: 'valid ' + state.network + ' basecoin address', cls: 'ok' };
  }
  if (state.network !== 'mainnet') {
    return { ok: false, msg: 'pools pay out on mainnet, use a mainnet address', cls: 'warn' };
  }
  const pool = selectedPool();
  if (pool && pool.addressTypes && !pool.addressTypes.includes(state.addressType)) {
    return { ok: false, msg: pool.name.split(',')[0] + ' needs a basecoin (bv1) address', cls: 'warn' };
  }
  return { ok: true, msg: 'valid ' + state.network + ' ' + typeLabel + ' address', cls: 'ok' };
}

// Repaint the address line for the current mode/pool. Called whenever the
// address, mode, algo or pool changes.
function refreshAddressFeedback() {
  const input = $('address');
  const msg = $('addr-msg');
  if (!input.value.trim() || !state.addressValid) return;
  const ctx = addressContext();
  input.className = ctx.ok ? 'ok' : 'err';
  msg.className = 'msg ' + ctx.cls;
  msg.textContent = ctx.msg;
  updateStart();
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
  updatePoolHint();
}

function updatePoolHint() {
  const hint = $('pool-hint');
  const pool = selectedPool();
  if (!pool) {
    hint.textContent = '';
  } else if (pool.addressTypes && pool.addressTypes.includes('stealth')) {
    hint.textContent = pool.name.split(',')[0] + ' takes a bv1 or sv1 mainnet address';
  } else {
    hint.textContent = pool.name.split(',')[0] + ' pays out on mainnet, needs a bv1 basecoin address';
  }
}

function setMode(mode) {
  if (state.mining || state.busy) return;
  state.mode = mode;
  $('mode-pool').classList.toggle('active', mode === 'pool');
  $('mode-solo').classList.toggle('active', mode === 'solo');
  $('pool-panel').classList.toggle('hidden', mode !== 'pool');
  $('solo-panel').classList.toggle('hidden', mode !== 'solo');
  refreshAddressFeedback();
  updateStart();
}

function updateStart() {
  if (state.mining || state.busy) {
    $('start').disabled = state.busy && !state.mining;
    return;
  }
  $('start').disabled = !(state.addressValid && state.algo && addressContext().ok);
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

function resetCounters() {
  $('shares').textContent = '0';
  $('rejects').textContent = '0';
  $('blocks').textContent = '0';
  $('rejects-stat').hidden = true;
  $('blocks-stat').hidden = true;
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
    state.addressType = res.type || null;
    if (!res.valid) {
      input.className = 'err';
      msg.className = 'msg err';
      msg.textContent = res.reason;
      updateStart();
      return;
    }
    refreshAddressFeedback();
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
  // GPU tuning: selected cards (unless all are on) and the intensity preset
  if (GPU_ALGOS.has(state.algo) && state.hw && state.hw.gpus.length) {
    const all = state.hw.gpus.length;
    if (state.devices && state.devices.size < all) {
      cfg.devices = [...state.devices].sort((a, b) => a - b);
    }
    if (state.intensity && state.intensity !== 'auto') cfg.intensity = state.intensity;
  }
  const ctx = addressContext();
  if (!ctx.ok) {
    setStatus(ctx.msg, 'warn');
    return;
  }
  if (state.mode === 'pool') {
    const pool = selectedPool();
    if (!pool) {
      setStatus('no pool available for this algo yet', 'warn');
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
  resetCounters();
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
  } else if (ev.type === 'share') {
    $('shares').textContent = String(ev.accepted);
    if (ev.rejected > 0) {
      $('rejects-stat').hidden = false;
      $('rejects').textContent = String(ev.rejected);
    }
  } else if (ev.type === 'block') {
    $('blocks-stat').hidden = false;
    $('blocks').textContent = String(ev.count);
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
  $('pool-select').addEventListener('change', () => {
    updatePoolHint();
    refreshAddressFeedback();
  });
  $('intensity-seg').addEventListener('click', (e) => {
    const btn = e.target.closest('.segbtn');
    if (!btn || state.mining) return;
    state.intensity = btn.dataset.i;
    [...$('intensity-seg').children].forEach((b) => b.classList.toggle('active', b === btn));
  });
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
  renderTuning();
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
