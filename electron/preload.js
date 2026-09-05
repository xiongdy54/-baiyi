const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsAPI", {
  get: (scope, key) => ipcRenderer.invoke("settings:get", scope, key),
  set: (scope, key, value) => ipcRenderer.invoke("settings:set", scope, key, value)
});

contextBridge.exposeInMainWorld("windowAPI", {
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  close: () => ipcRenderer.send("win:close")
});

contextBridge.exposeInMainWorld("libraryAPI", {
  list: () => ipcRenderer.invoke("library:list"),
  createFromPaste: (title, markdown) => ipcRenderer.invoke("library:createFromPaste", title, markdown),
  createFromEpub: (payload) => ipcRenderer.invoke("library:createFromEpub", payload),
  pickEpub: () => ipcRenderer.invoke("library:pickEpub"),
  remove: (id) => ipcRenderer.invoke("library:delete", id),
  getDocument: (id) => ipcRenderer.invoke("library:doc", id),
  updateProgress: (id, progress) => ipcRenderer.invoke("library:updateProgress", id, progress)
});

contextBridge.exposeInMainWorld("workflowAPI", {
  create: (payload) => ipcRenderer.invoke("extracts:create", payload),
  listDue: () => ipcRenderer.invoke("extracts:listDue"),
  get: (id) => ipcRenderer.invoke("extracts:get", id),
  postpone: (id) => ipcRenderer.invoke("extracts:postpone", id)
});

contextBridge.exposeInMainWorld("cardsAPI", {
  create: (card) => ipcRenderer.invoke("cards:create", card),
  update: (card) => ipcRenderer.invoke("cards:update", card),
  get: (id) => ipcRenderer.invoke("cards:get", id),
  listDue: () => ipcRenderer.invoke("cards:listDue"),
  listAll: () => ipcRenderer.invoke("cards:listAll"),
  remove: (id) => ipcRenderer.invoke("cards:delete", id),
  review: (cardId, fsrsState, rating, durationMs) =>
    ipcRenderer.invoke("cards:review", cardId, fsrsState, rating, durationMs),
  setSuspended: (id, suspended, reason) => ipcRenderer.invoke("cards:setSuspended", id, suspended, reason),
  resolveLeech: (id, resolution, updates) => ipcRenderer.invoke("cards:resolveLeech", id, resolution, updates),
  listLeech: () => ipcRenderer.invoke("cards:listLeech")
});

contextBridge.exposeInMainWorld("issuesAPI", {
  add: (issue) => ipcRenderer.invoke("issues:add", issue),
  list: (cardId) => ipcRenderer.invoke("issues:list", cardId),
  resolve: (id) => ipcRenderer.invoke("issues:resolve", id)
});

contextBridge.exposeInMainWorld("batchesAPI", {
  create: (batch) => ipcRenderer.invoke("batches:create", batch),
  setStatus: (id, status) => ipcRenderer.invoke("batches:setStatus", id, status)
});

contextBridge.exposeInMainWorld("promptsAPI", {
  list: () => ipcRenderer.invoke("prompts:list"),
  get: (scope) => ipcRenderer.invoke("prompts:get", scope)
});

contextBridge.exposeInMainWorld("similarityAPI", {
  find: (text, k) => ipcRenderer.invoke("similarity:find", text, k)
});

contextBridge.exposeInMainWorld("aiAPI", {
  getConfig: () => ipcRenderer.invoke("ai:getConfig"),
  setConfig: (partial) => ipcRenderer.invoke("ai:setConfig", partial),
  test: () => ipcRenderer.invoke("ai:test"),
  listModels: () => ipcRenderer.invoke("ai:listModels"),
  websearch: (query) => ipcRenderer.invoke("ai:websearch", query),
  chat: (requestId, messages, temperature) => ipcRenderer.send("ai:chat", requestId, messages, temperature),
  onStream: (callback) => {
    const handler = (_e, requestId, msg) => callback(requestId, msg);
    ipcRenderer.on("ai:stream", handler);
    return () => ipcRenderer.removeListener("ai:stream", handler);
  }
});
