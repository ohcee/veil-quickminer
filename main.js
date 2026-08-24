const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const bech32 = require('./src/bech32');
const hardware = require('./src/hardware');
const veilconf = require('./src/veilconf');
const minerman = require('./src/minerman');
const pools = require('./src/pools.json');

const SMOKE = !!process.env.QUICKMINER_SMOKE;
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 780,
    minWidth: 440,
    minHeight: 600,
    title: 'Veil Quick Miner',
    autoHideMenuBar: true,
    backgroundColor: '#f4f6fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('validate-address', (e, addr) => bech32.validateVeilAddress(addr));
ipcMain.handle('detect-hardware', async () => ({
  cpu: hardware.detectCpu(),
  gpus: await hardware.detectGpus(),
  platform: process.platform,
}));
ipcMain.handle('read-veil-conf', () => {
  const conf = veilconf.readVeilConf();
  // the password stays in this process, the window only needs to know one exists
  return { ...conf, pass: undefined, passSet: !!conf.pass };
});
ipcMain.handle('get-pools', () => pools);
ipcMain.handle('get-miners', () => {
  const out = {};
  for (const algo of Object.keys(minerman.manifest.miners)) {
    out[algo] = { ...minerman.manifest.miners[algo], availability: minerman.availability(algo) };
  }
  return out;
});
const DEFAULT_RPC_PORT = { mainnet: 58812, testnet: 58813 };

ipcMain.handle('start-mining', async (e, cfg) => {
  try {
    if (cfg.mode === 'solo') {
      const conf = veilconf.readVeilConf();
      const node = cfg.node || {};
      cfg.node = {
        host: node.host || conf.host || '127.0.0.1',
        port: parseInt(node.port, 10) || conf.port || DEFAULT_RPC_PORT[cfg.network] || 58812,
        user: node.user || conf.user || '',
        // the password never travels through the window: the renderer only
        // says whether to use the one found on disk
        pass: node.passFromConf ? conf.pass || '' : node.pass || '',
      };
    }
    await minerman.start(cfg, {
      baseDir: app.getPath('userData'),
      onEvent: (ev) => {
        if (win && !win.isDestroyed()) win.webContents.send('mining-event', ev);
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
});
ipcMain.handle('stop-mining', async () => {
  await minerman.stop();
  return { ok: true };
});

async function smokeRun() {
  const errors = [];
  win.webContents.on('console-message', (ev, level, message) => {
    const lvl = ev && typeof ev.level === 'string' ? ev.level : level;
    const msg = ev && ev.message ? ev.message : message;
    if (lvl === 3 || lvl === 'error') errors.push(String(msg));
  });

  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      ready = await win.webContents.executeJavaScript('window.__qmReady === true');
    } catch (err) {
      /* window still loading */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  let checksOk = false;
  let detail = '';
  if (ready) {
    try {
      // round trip a generated mainnet address through the renderer side validation
      const words = bech32.toWords(Array.from({ length: 20 }, (_, i) => i * 7 % 256));
      const goodAddr = bech32.encode('bv', [0].concat(words));
      const last = goodAddr[goodAddr.length - 1];
      const badAddr = goodAddr.slice(0, -1) + (last === 'q' ? 'p' : 'q');

      const good = await win.webContents.executeJavaScript(
        'window.qm.validateAddress(' + JSON.stringify(goodAddr) + ')'
      );
      const bad = await win.webContents.executeJavaScript(
        'window.qm.validateAddress(' + JSON.stringify(badAddr) + ')'
      );
      checksOk = good && good.valid === true && good.network === 'mainnet' && bad && bad.valid === false;
      detail = JSON.stringify({ good, bad });

      // put the good address in the box so the screenshot shows live validation
      await win.webContents.executeJavaScript(
        'const el = document.getElementById("address");' +
          'el.value = ' + JSON.stringify(goodAddr) + ';' +
          'el.dispatchEvent(new Event("input", { bubbles: true })); true'
      );
      await new Promise((r) => setTimeout(r, 700));

      // optional live phase: press start for real and wait for a hashrate
      if (checksOk && process.env.QUICKMINER_SMOKE_LIVE) {
        await win.webContents.executeJavaScript('document.getElementById("start").click(); true');
        const liveDeadline = Date.now() + 240000;
        let rate = '0';
        while (Date.now() < liveDeadline) {
          rate = await win.webContents.executeJavaScript('document.getElementById("hashrate").textContent');
          if (rate !== '0') break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        if (rate === '0') {
          checksOk = false;
          detail = 'live phase: no hashrate before deadline';
        }
      }
    } catch (err) {
      detail = String(err);
    }
  }

  try {
    const img = await win.webContents.capturePage();
    const shot = process.env.QUICKMINER_SHOT || path.join(__dirname, 'smoke.png');
    fs.writeFileSync(shot, img.toPNG());
  } catch (err) {
    errors.push('screenshot failed: ' + err.message);
  }

  if (process.env.QUICKMINER_SMOKE_LIVE && minerman.isMining()) {
    await minerman.stop();
  }

  if (!ready) {
    console.error('SMOKE_FAIL renderer never became ready');
    app.exit(1);
  } else if (!checksOk) {
    console.error('SMOKE_FAIL address validation over IPC: ' + detail);
    app.exit(1);
  } else if (errors.length) {
    console.error('SMOKE_FAIL console errors:\n' + errors.join('\n'));
    app.exit(1);
  } else {
    console.log('SMOKE_OK');
    app.exit(0);
  }
}

app.whenReady().then(() => {
  createWindow();
  if (SMOKE) smokeRun();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', (e) => {
  if (minerman.isMining()) {
    e.preventDefault();
    minerman.stop().then(() => app.quit());
  }
});
