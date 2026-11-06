const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  bootstrap: () => ipcRenderer.invoke('desktop:bootstrap'),
  saveConfig: (patch) => ipcRenderer.invoke('desktop:save-config', patch),
  connect: (source) => ipcRenderer.invoke('desktop:connect', source),
  selectCodex: () => ipcRenderer.invoke('desktop:select-codex'),
  disconnect: (source) => ipcRenderer.invoke('desktop:disconnect', source),
  importActions: () => ipcRenderer.invoke('desktop:import-actions'),
  removeAction: (id) => ipcRenderer.invoke('desktop:remove-action', id),
  exportBridge: () => ipcRenderer.invoke('desktop:export-bridge'),
  openDocs: (source) => ipcRenderer.invoke('desktop:open-docs', source),
  showSettings: () => ipcRenderer.send('desktop:show-settings'),
  contextMenu: () => ipcRenderer.send('desktop:context-menu'),
  home: () => ipcRenderer.send('desktop:home'),
  hide: () => ipcRenderer.send('desktop:hide'),
  preview: (id) => ipcRenderer.send('desktop:preview', id),
  setDisplay: (id) => ipcRenderer.invoke('desktop:set-display', id),
  quit: () => ipcRenderer.send('desktop:quit'),
  revealData: () => ipcRenderer.send('desktop:reveal-data'),
  hitRegions: (data) => ipcRenderer.send('desktop:hit-regions', data),
  drag: (data) => ipcRenderer.send('desktop:drag', data),
  onSnapshot: (fn) => {
    const listener = (_event, data) => fn(data);
    ipcRenderer.on('desktop:snapshot', listener);
    return () => ipcRenderer.removeListener('desktop:snapshot', listener);
  },
  onCommand: (fn) => {
    const listener = (_event, data) => fn(data);
    ipcRenderer.on('desktop:command', listener);
    return () => ipcRenderer.removeListener('desktop:command', listener);
  },
});
