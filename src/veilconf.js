// Find the local veild for solo mode: veil.conf first, cookie file as fallback.

const os = require('os');
const fs = require('fs');
const path = require('path');

function defaultDatadir() {
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Veil');
    case 'win32':
      return path.join(process.env.APPDATA || '', 'Veil');
    default:
      return path.join(os.homedir(), '.veil');
  }
}

function parseConf(text) {
  const conf = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in conf)) conf[key] = value;
  }
  return conf;
}

function readVeilConf() {
  const datadir = defaultDatadir();
  const confPath = path.join(datadir, 'veil.conf');
  const result = {
    found: false,
    datadir,
    confPath,
    host: '127.0.0.1',
    port: null,
    user: null,
    pass: null,
    cookie: false,
  };

  let conf = {};
  if (fs.existsSync(confPath)) {
    try {
      conf = parseConf(fs.readFileSync(confPath, 'utf8'));
      result.found = true;
    } catch (err) {
      return { ...result, error: 'could not read veil.conf: ' + err.message };
    }
  }

  if (conf.rpcbind) result.host = conf.rpcbind.split(':')[0] || '127.0.0.1';
  if (conf.rpcconnect) result.host = conf.rpcconnect;
  if (conf.rpcport) result.port = parseInt(conf.rpcport, 10) || null;
  if (conf.rpcuser) result.user = conf.rpcuser;
  if (conf.rpcpassword) result.pass = conf.rpcpassword;

  // no rpcuser/rpcpassword means veild is on cookie auth
  if (!result.user || !result.pass) {
    const cookiePath = path.join(datadir, '.cookie');
    try {
      if (fs.existsSync(cookiePath)) {
        const cookie = fs.readFileSync(cookiePath, 'utf8').trim();
        const sep = cookie.indexOf(':');
        if (sep > 0) {
          result.user = cookie.slice(0, sep);
          result.pass = cookie.slice(sep + 1);
          result.cookie = true;
          result.found = true;
        }
      }
    } catch (err) {
      // cookie unreadable, leave creds empty and let the user fill them in
    }
  }

  return result;
}

module.exports = { defaultDatadir, readVeilConf };
