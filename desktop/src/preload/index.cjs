const { contextBridge, ipcRenderer } = require('electron');

const getArgValue = name => {
  const prefix = `--${name}=`;
  const found = process.argv.find(item => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

const runtimeInfo = {
  assetRoot: getArgValue('chat2cartoon-asset-root'),
  backendOrigin: getArgValue('chat2cartoon-backend-origin') || 'http://127.0.0.1:8889',
  isElectron: true,
};

contextBridge.exposeInMainWorld('desktopAPI', {
  runtimeInfo,
  getRuntimeInfo: () => ipcRenderer.invoke('runtime:get-info'),
  getBackendStatus: () => ipcRenderer.invoke('backend:get-status'),
  restartBackend: async () => {
    const status = await ipcRenderer.invoke('backend:restart');
    if (status?.backendOrigin) {
      runtimeInfo.backendOrigin = status.backendOrigin;
    }
    return status;
  },
  selectScriptFile: () => ipcRenderer.invoke('dialog:select-script-file'),
  selectReferenceImage: () => ipcRenderer.invoke('dialog:select-reference-image'),
  openProjectFolder: projectId => ipcRenderer.invoke('shell:open-project-folder', projectId),
  openLogsFolder: () => ipcRenderer.invoke('shell:open-logs-folder'),
  openAdminWindow: () => ipcRenderer.invoke('window:open-admin'),
  focusMainWindow: () => ipcRenderer.invoke('window:focus-main'),
  saveUrlAsFile: (url, suggestedName) => ipcRenderer.invoke('download:save-url-as-file', url, suggestedName),
  onBackendStatusChanged: callback => {
    const listener = (_event, status) => {
      if (status?.backendOrigin) {
        runtimeInfo.backendOrigin = status.backendOrigin;
      }
      callback(status);
    };
    ipcRenderer.on('backend:status-changed', listener);
    return () => ipcRenderer.removeListener('backend:status-changed', listener);
  },
});
