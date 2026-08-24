const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qm', {
  validateAddress: (addr) => ipcRenderer.invoke('validate-address', addr),
  detectHardware: () => ipcRenderer.invoke('detect-hardware'),
  readVeilConf: () => ipcRenderer.invoke('read-veil-conf'),
  getPools: () => ipcRenderer.invoke('get-pools'),
  getMiners: () => ipcRenderer.invoke('get-miners'),
  startMining: (cfg) => ipcRenderer.invoke('start-mining', cfg),
  stopMining: () => ipcRenderer.invoke('stop-mining'),
});
