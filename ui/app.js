// Renderer logic. Everything heavier runs in the main process behind window.qm.

const ALGOS = [
  { id: 'randomx', title: 'RandomX', sub: 'CPU, every machine can mine this', miner: 'Veil-Miner-CPU', needs: 'cpu' },
  { id: 'progpow', title: 'ProgPoW', sub: 'GPU, NVIDIA or AMD', miner: 'Veil-Miner', needs: 'gpu' },
  { id: 'sha256d', title: 'SHA256d', sub: 'GPU, NVIDIA only for now', miner: 'Veil-Miner-SHA', needs: 'nvidia' },
];

const state = {
  addressValid: false,
  network: null,
  mode: 'pool',
  algo: null,
  hw: null,
  pools: [],
  mining: false,
};

const $ = (id) => document.getElementById(id);

function eligible(algo, hw) {
  if (!hw) return true;
  if (algo.needs === 'cpu') return true;
  if (algo.needs === 'gpu') return hw.gpus.length > 0;
  if (algo.needs === 'nvidia') return hw.gpus.some((g) => g.vendor === 'nvidia');
  return true;
}

function renderAlgos() {
  const wrap = $('algo-cards');
  wrap.innerHTML = '';
  for (const algo of ALGOS) {
    const ok = eligible(algo, state.hw);
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

    const flag = document.createElement('div');
    flag.className = 'flag ' + (ok ? 'ok' : 'warn');
    flag.textContent = ok ? 'ready' : 'no matching hardware';

    el.append(left, flag);
    el.addEventListener('click', () => {
      state.algo = algo.id;
      renderAlgos();
      renderPools();
      updateStart();
    });
    wrap.appendChild(el);
  }
}

function renderPools() {
  const select = $('pool-select');
  const hint = $('pool-hint');
  select.innerHTML = '';
  const matching = state.pools.filter((p) => !state.algo || p.algo === state.algo);
  if (!matching.length) {
    const opt = document.createElement('option');
    opt.textContent = state.algo ? 'no known pool for this algo yet' : 'pick an algo first';
    opt.value = '';
    select.appendChild(opt);
    hint.textContent = state.algo === 'sha256d' ? 'nobody pools SHA256d yet, solo is the way there' : '';
    return;
  }
  for (const p of matching) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name + (p.stratum ? '' : ' (stratum url pending)');
    select.appendChild(opt);
  }
  hint.textContent = matching.some((p) => !p.verified)
    ? 'pool endpoints get verified when the miner manager lands'
    : '';
}

function setMode(mode) {
  state.mode = mode;
  $('mode-pool').classList.toggle('active', mode === 'pool');
  $('mode-solo').classList.toggle('active', mode === 'solo');
  $('pool-panel').classList.toggle('hidden', mode !== 'pool');
  $('solo-panel').classList.toggle('hidden', mode !== 'solo');
  updateStart();
}

function updateStart() {
  $('start').disabled = state.mining ? false : !(state.addressValid && state.algo);
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

async function onStart() {
  const status = $('status');
  if (state.mining) {
    await window.qm.stopMining();
    state.mining = false;
    $('start').textContent = 'Start mining';
    $('start').classList.remove('stop');
    status.className = 'msg';
    status.textContent = 'stopped';
    updateStart();
    return;
  }
  const cfg = {
    address: $('address').value.trim(),
    network: state.network,
    mode: state.mode,
    algo: state.algo,
    pool: state.mode === 'pool' ? $('pool-select').value : null,
    node:
      state.mode === 'solo'
        ? {
            host: $('rpc-host').value.trim() || '127.0.0.1',
            port: $('rpc-port').value.trim(),
            user: $('rpc-user').value.trim(),
            passFromConf: $('rpc-pass').dataset.fromConf === '1',
          }
        : null,
  };
  const res = await window.qm.startMining(cfg);
  if (res.ok) {
    state.mining = true;
    $('start').textContent = 'Stop mining';
    $('start').classList.add('stop');
    status.className = 'msg ok';
    status.textContent = 'mining';
  } else {
    status.className = 'msg warn';
    status.textContent = res.reason;
  }
}

async function init() {
  $('address').addEventListener('input', onAddressInput);
  $('mode-pool').addEventListener('click', () => setMode('pool'));
  $('mode-solo').addEventListener('click', () => setMode('solo'));
  $('find-node').addEventListener('click', findNode);
  $('start').addEventListener('click', onStart);

  renderAlgos();

  const poolData = await window.qm.getPools();
  state.pools = poolData.pools || [];

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
