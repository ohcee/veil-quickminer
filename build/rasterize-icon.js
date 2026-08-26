// Builds build/icon.png (1024, transparent) from an inline SVG: a pickaxe with
// the Veil mark badged on it. Rasterized with Electron so the SVG stays crisp.
// Run: npx electron build/rasterize-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const MARK = fs.readFileSync(path.join(__dirname, 'veil-mark.svg'), 'utf8');
// nest the whole mark; give it explicit box so it sits as the badge
const badge = MARK.replace(
  /<svg[^>]*>/,
  '<svg x="332" y="250" width="360" height="360" viewBox="0 0 989.553 989.553">'
);

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1d2b46"/><stop offset="1" stop-color="#0e1626"/>
    </linearGradient>
    <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8edf5"/><stop offset="0.5" stop-color="#aab4c6"/><stop offset="1" stop-color="#79859b"/>
    </linearGradient>
    <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b07a3e"/><stop offset="1" stop-color="#6f4620"/>
    </linearGradient>
  </defs>

  <rect x="40" y="40" width="944" height="944" rx="212" fill="url(#bg)"/>

  <!-- pickaxe head: a symmetric double point crescent -->
  <path fill="url(#steel)" stroke="#5c6678" stroke-width="6" stroke-linejoin="round" d="
    M132,392
    C 300,300 402,318 486,372
    L 538,372
    C 622,318 724,300 892,392
    C 742,372 632,398 556,452
    L 468,452
    C 392,398 282,372 132,392 Z"/>

  <!-- handle -->
  <rect x="483" y="372" width="58" height="516" rx="29" fill="url(#wood)" stroke="#4a2f16" stroke-width="5"/>
  <!-- collar where handle meets head -->
  <rect x="452" y="360" width="120" height="78" rx="16" fill="url(#steel)" stroke="#5c6678" stroke-width="6"/>

  <!-- veil mark badged on the pickaxe, ringed like a medallion -->
  <circle cx="512" cy="430" r="184" fill="none" stroke="url(#steel)" stroke-width="10"/>
  ${badge}
</svg>`;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}</style></head>
<body>${SVG}</body></html>`;

app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    webPreferences: { offscreen: false },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, 'icon.png'), img.toPNG());
  console.log('wrote build/icon.png');
  app.exit(0);
});
