'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  refreshState: () => ipcRenderer.invoke('state:refresh'),

  switchStart: (payload) => ipcRenderer.invoke('switch:start', payload),
  switchCancel: () => ipcRenderer.invoke('switch:cancel'),

  updateConfig: (patch) => ipcRenderer.invoke('config:update', patch),
  setCurrent: (profileId) => ipcRenderer.invoke('current:set', profileId),

  profileAdd: (profile) => ipcRenderer.invoke('profile:add', profile),
  profileUpdate: (id, patch) => ipcRenderer.invoke('profile:update', { id, patch }),
  profileDelete: (id) => ipcRenderer.invoke('profile:delete', id),
  profileAutodetect: () => ipcRenderer.invoke('profile:autodetect'),

  pickFile: (options) => ipcRenderer.invoke('dialog:pickFile', options),
  pickFolder: (options) => ipcRenderer.invoke('dialog:pickFolder', options),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  autoDetectPaths: () => ipcRenderer.invoke('path:autodetect'),

  modsScan: (which) => ipcRenderer.invoke('mods:scan', which),
  modsScanDisabled: () => ipcRenderer.invoke('mods:scanDisabled'),
  modsSetEnabled: (payload) => ipcRenderer.invoke('mods:setEnabled', payload),
  launchProfile: (id) => ipcRenderer.invoke('profile:launch', id),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),

  adminList: () => ipcRenderer.invoke('admin:list'),
  adminAddCustom: (entry) => ipcRenderer.invoke('admin:addCustom', entry),
  adminRemoveCustom: (id) => ipcRenderer.invoke('admin:removeCustom', id),

  mapGet: () => ipcRenderer.invoke('map:get'),
  mapImport: () => ipcRenderer.invoke('map:import'),
  mapSave: (map) => ipcRenderer.invoke('map:save', map),

  historyList: () => ipcRenderer.invoke('history:list'),

  recoveryRollback: () => ipcRenderer.invoke('recovery:rollback'),
  recoveryDismiss: () => ipcRenderer.invoke('recovery:dismiss'),

  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  setThemeOverlay: (theme) => ipcRenderer.invoke('theme:overlay', theme),

  openUserData: () => ipcRenderer.invoke('app:openUserData'),
  openLogs: () => ipcRenderer.invoke('app:openLogs'),
  quit: () => ipcRenderer.invoke('app:quit'),

  onProgress: (cb) => on('switch:progress', cb),
  onLog: (cb) => on('switch:log', cb),
  onStateChanged: (cb) => on('state:changed', cb),
  onDetected: (cb) => on('state:detected', cb),
});
