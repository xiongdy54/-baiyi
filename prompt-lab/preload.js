// 提示词测试台 preload：仅暴露测试台所需最小 API
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("labAPI", {
  getConfig: () => ipcRenderer.invoke("lab:config:get"),
  setConfig: (partial) => ipcRenderer.invoke("lab:config:set", partial),
  listPrompts: () => ipcRenderer.invoke("lab:prompts:list"),
  getPrompt: (scope) => ipcRenderer.invoke("lab:prompts:get", scope),
  savePrompt: (scope, content) => ipcRenderer.invoke("lab:prompts:save", scope, content),
  resetPrompt: (scope) => ipcRenderer.invoke("lab:prompts:reset", scope),
  applyDraft: (scope) => ipcRenderer.invoke("lab:prompts:applyDraft", scope),
  pickImage: () => ipcRenderer.invoke("lab:pickImage"),
  chat: (requestId, messages, temperature) => ipcRenderer.send("lab:chat", requestId, messages, temperature),
  onStream: (callback) => {
    const handler = (_e, requestId, msg) => callback(requestId, msg);
    ipcRenderer.on("lab:stream", handler);
    return () => ipcRenderer.removeListener("lab:stream", handler);
  }
});
