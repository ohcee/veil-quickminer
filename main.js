const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const bech32 = require('./src/bech32');
const hardware = require('./src/hardware');
const veilconf = require('./src/veilconf');
const pools = require('./src/pools.json');
const miners = require('./src/miners.json');

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
ipcMain.handle('get-miners', () => miners);
ipcMain.handle('start-mining', (e, cfg) => {
  // milestone 2 wires this to the real miner manager
  return {
    ok: false,
    reason: 'interface preview: miner download and launch land in the next milestone',
  };
});
ipcMain.handle('stop-mining', () => ({ ok: true }));

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
