const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("friday", {
  checkConnection: (baseUrl) => ipcRenderer.invoke("friday:check-connection", baseUrl),
  chat: (payload) => ipcRenderer.invoke("friday:chat", payload),
  openUrl: (url) => ipcRenderer.invoke("friday:open-url", url)
});
