// Best effort hardware detection. Never throws, just returns what it found.

const os = require('os');
const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : String(stdout));
    });
  });
}

function detectCpu() {
  const cpus = os.cpus();
  return {
    model: ((cpus[0] && cpus[0].model) || 'unknown cpu').trim(),
    threads: cpus.length,
    arch: os.arch(),
  };
}

async function detectGpus() {
  const gpus = [];

  // nvidia-smi is the reliable path when the driver is installed
  const nv = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader']);
  if (nv) {
    for (const line of nv.trim().split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split(',').map((s) => s.trim());
      gpus.push({ vendor: 'nvidia', name: parts[0], memory: parts[1] || null });
    }
  }
  if (gpus.length) return gpus;

  if (process.platform === 'linux') {
    const out = await run('lspci', []);
    if (out) {
      for (const line of out.split('\n')) {
        if (!/vga|3d controller|display controller/i.test(line)) continue;
        const name = line.split(/:\s(.+)/)[1] || line;
        if (/nvidia/i.test(line)) gpus.push({ vendor: 'nvidia', name: name.trim(), memory: null });
        else if (/amd|radeon|advanced micro/i.test(line)) gpus.push({ vendor: 'amd', name: name.trim(), memory: null });
      }
    }
  } else if (process.platform === 'win32') {
    const out = await run('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name']);
    if (out) {
      for (const raw of out.trim().split(/\r?\n/)) {
        const name = raw.trim();
        if (!name) continue;
        if (/nvidia/i.test(name)) gpus.push({ vendor: 'nvidia', name, memory: null });
        else if (/amd|radeon/i.test(name)) gpus.push({ vendor: 'amd', name, memory: null });
      }
    }
  }
  // macOS has no gpu mining path for our algos, cpu only there
  return gpus;
}

module.exports = { detectCpu, detectGpus };
