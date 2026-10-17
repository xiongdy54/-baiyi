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
  // 导图 v2 基准页
  openBench: () => ipcRenderer.invoke("bench:open"),
  bench: {
    config: () => ipcRenderer.invoke("bench:config"),
    sample: () => ipcRenderer.invoke("bench:sample"),
    pickMaterial: () => ipcRenderer.invoke("bench:pickMaterial"),
    start: (payload) => ipcRenderer.invoke("bench:start", payload),
    cancel: (runId) => ipcRenderer.invoke("bench:cancel", runId),
    expand: (runId, nodePath) => ipcRenderer.invoke("bench:expand", runId, nodePath),
    explain: (runId, nodePath) => ipcRenderer.invoke("bench:explain", runId, nodePath),
    history: () => ipcRenderer.invoke("bench:history"),
    exportCsv: (runIds) => ipcRenderer.invoke("bench:exportCsv", runIds),
    onEvent: (callback) => {
      const handler = (_e, ev) => callback(ev);
      ipcRenderer.on("bench:event", handler);
      return () => ipcRenderer.removeListener("bench:event", handler);
    }
  },
  onStream: (callback) => {
    const handler = (_e, requestId, msg) => callback(requestId, msg);
    ipcRenderer.on("lab:stream", handler);
    return () => ipcRenderer.removeListener("lab:stream", handler);
  }
});
