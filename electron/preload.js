const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsAPI", {
  get: (scope, key) => ipcRenderer.invoke("settings:get", scope, key),
  set: (scope, key, value) => ipcRenderer.invoke("settings:set", scope, key, value)
});

contextBridge.exposeInMainWorld("windowAPI", {
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  close: () => ipcRenderer.send("win:close"),
  // 外链（v20）：仅 http/https，交系统浏览器
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url)
});

contextBridge.exposeInMainWorld("libraryAPI", {
  list: () => ipcRenderer.invoke("library:list"),
  createFromPaste: (title, markdown) => ipcRenderer.invoke("library:createFromPaste", title, markdown),
  createFromEpub: (payload) => ipcRenderer.invoke("library:createFromEpub", payload),
  pickEpub: () => ipcRenderer.invoke("library:pickEpub"),
  remove: (id) => ipcRenderer.invoke("library:delete", id),
  getDocument: (id) => ipcRenderer.invoke("library:doc", id),
  getItemIdByDocumentId: (docId) => ipcRenderer.invoke("library:itemByDoc", docId),
  updateProgress: (id, progress) => ipcRenderer.invoke("library:updateProgress", id, progress),
  // 阅读内核（v20）：读原书字节给 foliate 打开
  readBookFile: (id) => ipcRenderer.invoke("library:readBookFile", id)
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
  review: (cardId, fsrsState, rating, durationMs, fsrsBefore) =>
    ipcRenderer.invoke("cards:review", cardId, fsrsState, rating, durationMs, fsrsBefore),
  // v22 撤销评分
  lastUndoableReview: () => ipcRenderer.invoke("cards:lastUndoableReview"),
  undoReview: () => ipcRenderer.invoke("cards:undoReview"),
  // v23（§4.4.9）：persist 失败后的纯持久化重试（绝不重执行业务 mutation）
  persistNow: () => ipcRenderer.invoke("cards:persistNow"),
  skip: (cardId) => ipcRenderer.invoke("cards:skip", cardId),
  setSuspended: (id, suspended, reason) => ipcRenderer.invoke("cards:setSuspended", id, suspended, reason),
  updateLeech: (id, patch) => ipcRenderer.invoke("cards:updateLeech", id, patch),
  resolveLeech: (id, resolution, updates) => ipcRenderer.invoke("cards:resolveLeech", id, resolution, updates),
  listLeech: () => ipcRenderer.invoke("cards:listLeech")
});

contextBridge.exposeInMainWorld("readingAPI", {
  addEvent: (itemId, charPos) => ipcRenderer.invoke("reading:event", itemId, charPos)
});

contextBridge.exposeInMainWorld("statsAPI", {
  overview: () => ipcRenderer.invoke("stats:overview")
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

// M1.1 图片挖空卡：选本地图 → 落盘 + 入 assets 表 → 返回 {itemId, filename, assetPath, dataUrl}
// v25：saveImage 供正文图片点选聚焦（字节来自渲染层，不经文件对话框）
contextBridge.exposeInMainWorld("assetsAPI", {
  pickOcclusionImage: (ownerKey) => ipcRenderer.invoke("assets:pickOcclusionImage", ownerKey),
  saveImage: (ownerKey, ext, base64, kind) => ipcRenderer.invoke("assets:saveImage", ownerKey, ext, base64, kind)
});

// v23：FSRS 参数环境——活跃配置完整快照 + 主进程事实层推送的热生效通知（F9）
contextBridge.exposeInMainWorld("fsrsAPI", {
  getActiveConfig: () => ipcRenderer.invoke("fsrs:activeConfig"),
  onConfigChanged: (callback) => {
    const handler = (_e, configId) => callback(configId);
    ipcRenderer.on("fsrs:configChanged", handler);
    return () => ipcRenderer.removeListener("fsrs:configChanged", handler);
  }
});

contextBridge.exposeInMainWorld("optimizerAPI", {
  stats: () => ipcRenderer.invoke("optimizer:stats"),
  current: () => ipcRenderer.invoke("optimizer:current"),
  train: () => ipcRenderer.invoke("optimizer:train"),
  apply: (weights) => ipcRenderer.invoke("optimizer:apply", weights),
  reset: () => ipcRenderer.invoke("optimizer:reset"),
  onProgress: (callback) => {
    const handler = (_e, progress) => callback(progress);
    ipcRenderer.on("optimizer:progress", handler);
    return () => ipcRenderer.removeListener("optimizer:progress", handler);
  }
});

// M2 数据备份与恢复
contextBridge.exposeInMainWorld("backupAPI", {
  info: () => ipcRenderer.invoke("backup:info"),
  create: (opts) => ipcRenderer.invoke("backup:create", opts || {}),
  list: () => ipcRenderer.invoke("backup:list"),
  pickDir: () => ipcRenderer.invoke("backup:pickDir"),
  openDir: () => ipcRenderer.invoke("backup:openDir"),
  pickFile: () => ipcRenderer.invoke("backup:pickFile"),
  restore: (file) => ipcRenderer.invoke("backup:restore", file),
  relaunch: () => ipcRenderer.send("app:relaunch")
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
