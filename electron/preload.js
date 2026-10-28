const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsAPI", {
  get: (scope, key) => ipcRenderer.invoke("settings:get", scope, key),
  set: (scope, key, value) => ipcRenderer.invoke("settings:set", scope, key, value),
  // C-31：设置变更推送（settings:set 写入成功后广播给未发起写入的窗口）——
  // 单向推送，不计入 IPC 注册清单（D123 / D180 同口径，事件名见 electron/main.js settings:set 头注）。
  // 返回退订函数（与 windowAPI.on* / lensAPI.on* 同构）。
  onChanged: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on("settings:changed", handler);
    return () => ipcRenderer.removeListener("settings:changed", handler);
  }
});

contextBridge.exposeInMainWorld("windowAPI", {
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  close: () => ipcRenderer.send("win:close"),
  // 外链（v20）：仅 http/https，交系统浏览器
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  // D123：制卡台右侧放置时窗口向右外延 / 还原；最大化时主进程推送回落内推
  dockExtend: (deltaPx) => ipcRenderer.invoke("win:dockExtend", deltaPx),
  dockRestore: () => ipcRenderer.invoke("win:dockRestore"),
  onDockMode: (cb) => {
    const handler = (_e, mode) => cb(mode);
    ipcRenderer.on("win:dockMode", handler);
    return () => ipcRenderer.removeListener("win:dockMode", handler);
  },
  // D123：独立制卡台窗口（toggle/show/hide/pin）与跨窗口建卡刷新
  workbench: (action) => ipcRenderer.invoke("win:workbench", action),
  notifyCardsChanged: () => ipcRenderer.send("win:cardsChanged"),
  onCardsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("win:cardsRefresh", handler);
    return () => ipcRenderer.removeListener("win:cardsRefresh", handler);
  },
  onWorkbenchShown: (cb) => {
    const handler = () => cb();
    ipcRenderer.on("win:workbenchShown", handler);
    return () => ipcRenderer.removeListener("win:workbenchShown", handler);
  }
});

// v49.24（D197）：独立结构图窗口桥（窗口控制 + 两窗口之间的请求 / 回执 / 推送 / 状态，全经主进程转发）。
// 与 windowAPI 既有模式逐字同构；on* 订阅一律返回退订函数。
contextBridge.exposeInMainWorld("lensAPI", {
  /** 窗口控制：toggle / show / hide / pin（两窗口共用，返回值＝{visible, pinned}） */
  control: (action) => ipcRenderer.invoke("win:lens", action),
  /** 内容自适应纸片窗口（D203）：渲染层量 content/anchor，主进程算 s / 落位 / 钳制并 setBounds */
  fit: (payload) => ipcRenderer.invoke("lens:fit", payload),
  /** 结构图窗口 → 阅读窗口：请求 / 命令（带 id 才等回执） */
  ask: (payload) => ipcRenderer.send("lens:ask", payload),
  onAsk: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("lens:askIn", handler);
    return () => ipcRenderer.removeListener("lens:askIn", handler);
  },
  /** 阅读窗口 → 结构图窗口：请求回执 */
  reply: (payload) => ipcRenderer.send("lens:reply", payload),
  onReply: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("lens:replyIn", handler);
    return () => ipcRenderer.removeListener("lens:replyIn", handler);
  },
  /** 阅读窗口 → 结构图窗口：上下文 / 阅读位置推送 */
  push: (payload) => ipcRenderer.send("lens:push", payload),
  onPush: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("lens:pushIn", handler);
    return () => ipcRenderer.removeListener("lens:pushIn", handler);
  },
  /** 窗口可见性 + 置顶状态（两窗口共用） */
  onWindow: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("lens:window", handler);
    return () => ipcRenderer.removeListener("lens:window", handler);
  }
});

// v48.75（D119）：应用日志——openFolder 打开 logs 目录；report 为渲染层错误转发
// （fire-and-forget send：不回执，报告失败不触发新错误）
contextBridge.exposeInMainWorld("logsAPI", {
  openFolder: () => ipcRenderer.invoke("logs:openFolder"),
  report: (payload) => ipcRenderer.send("logs:rendererError", payload)
});

// v49.6（D180）：软件更新——状态快照 / 手动检查 / 确认后下载 / 重启安装 + 事件推送订阅
contextBridge.exposeInMainWorld("updateAPI", {
  status: () => ipcRenderer.invoke("update:status"),
  check: () => ipcRenderer.invoke("update:check"),
  download: () => ipcRenderer.invoke("update:download"),
  install: () => ipcRenderer.invoke("update:install"),
  onEvent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("update:event", handler);
    return () => ipcRenderer.removeListener("update:event", handler);
  }
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
  // v48.22（D58 §6.8-2）：书级默认优先级（新建摘录继承；继承型摘录实时跟随）
  setPriority: (id, priority) => ipcRenderer.invoke("library:setPriority", id, priority),
  // 阅读内核（v20）：读原书字节给 foliate 打开
  readBookFile: (id) => ipcRenderer.invoke("library:readBookFile", id),
  // M6-1（v26）：导入格式扩展 Word/TXT/Markdown（pick 返回 {name,path}，create 在主进程完成转换与建册）
  pickWord: () => ipcRenderer.invoke("library:pickWord"),
  pickTxt: () => ipcRenderer.invoke("library:pickTxt"),
  pickMarkdown: () => ipcRenderer.invoke("library:pickMarkdown"),
  createFromWord: (payload) => ipcRenderer.invoke("library:createFromWord", payload),
  createFromTxt: (payload) => ipcRenderer.invoke("library:createFromTxt", payload),
  createFromMarkdown: (payload) => ipcRenderer.invoke("library:createFromMarkdown", payload),
  pickPdf: () => ipcRenderer.invoke("library:pickPdf"),
  createFromPdf: (payload) => ipcRenderer.invoke("library:createFromPdf", payload),
  // 读侧：某本书的内嵌图字节（[{filename, bytes:Uint8Array}]），随合成 EPUB 落包
  readContentImages: (id) => ipcRenderer.invoke("library:readContentImages", id),
  // M6-2 修订（v28 PDF 原生阅读）：读 PDF 原文件字节给 pdf.js 内核打开
  readPdfFile: (id) => ipcRenderer.invoke("library:readPdfFile", id),
  // M6-3（v30，D27）统一导入入口：多选对话框 + 按扩展名路由所需的读取/建册
  pickImportFiles: () => ipcRenderer.invoke("library:pickImportFiles"),
  readFileBytes: (filePath) => ipcRenderer.invoke("library:readFileBytes", filePath),
  createFromHtml: (payload) => ipcRenderer.invoke("library:createFromHtml", payload),
  createFromBookFile: (payload) => ipcRenderer.invoke("library:createFromBookFile", payload),
  readEbookFile: (id) => ipcRenderer.invoke("library:readEbookFile", id),
  // v38（D35）：书籍语言属性（查词语言路由的书籍级信号）
  setItemLang: (id, lang) => ipcRenderer.invoke("library:setItemLang", id, lang),
  // v45.1：书架悬停改名
  setItemTitle: (id, title) => ipcRenderer.invoke("library:setItemTitle", id, title),
  // D121 §1.1：书籍作者（空=未知）
  setItemAuthor: (id, author) => ipcRenderer.invoke("library:setItemAuthor", id, author)
});

contextBridge.exposeInMainWorld("workflowAPI", {
  create: (payload) => ipcRenderer.invoke("extracts:create", payload),
  // v48.23（D61 §6.8-11）：多段选择的集合运算/拼接文本（只读计算，逻辑在主进程；渲染层不复制）
  spanSet: (current, incoming, opts) => ipcRenderer.invoke("extracts:spanSet", current, incoming, opts),
  listDue: () => ipcRenderer.invoke("extracts:listDue"),
  listAll: () => ipcRenderer.invoke("extracts:listAll"),
  get: (id) => ipcRenderer.invoke("extracts:get", id),
  // v48.23（D61 §6.8-11）：层级链（面包屑用，自根到当前逐级 {id,text,depth}）
  chain: (id) => ipcRenderer.invoke("extracts:chain", id),
  postpone: (id) => ipcRenderer.invoke("extracts:postpone", id),
  // v48.22（D58 §6.8）：摘录调度内核写面
  postponeDays: (id, days) => ipcRenderer.invoke("extracts:postponeDays", id, days),
  advance: (id, now) => ipcRenderer.invoke("extracts:advance", id, now),
  update: (id, patch) => ipcRenderer.invoke("extracts:update", id, patch),
  setPriority: (id, priority) => ipcRenderer.invoke("extracts:setPriority", id, priority),
  setStatus: (id, status, detail, opType) => ipcRenderer.invoke("extracts:setStatus", id, status, detail, opType),
  remove: (id) => ipcRenderer.invoke("extracts:delete", id),
  batch: (op, ids, payload) => ipcRenderer.invoke("extracts:batch", op, ids, payload),
  switchEngine: (to, from) => ipcRenderer.invoke("extracts:switchEngine", to, from),
  // v48.22（D58 §6.4.1 E1）：手动跑一次 AI 重排（写路径后另有自动刷新）
  rerankNow: () => ipcRenderer.invoke("extracts:rerankNow")
});

// v48.22（D58 §6.8-5/§6.8-7）：只读用量 + 跨类撤销（卡片评分与摘录操作共用一个撤销栈）
contextBridge.exposeInMainWorld("limitsAPI", {
  usage: (now) => ipcRenderer.invoke("limits:usage", now),
  state: (now) => ipcRenderer.invoke("limits:state", now),
  validate: (patch) => ipcRenderer.invoke("limits:validate", patch)
});

// v48.22（D58 §6.8-3）：会话队列（卡片 ∪ 摘录；只影响展示、零调度写入）
contextBridge.exposeInMainWorld("sessionAPI", {
  queue: (now, opts) => ipcRenderer.invoke("session:queue", now, opts),
  counts: (now, opts) => ipcRenderer.invoke("session:counts", now, opts)
});

contextBridge.exposeInMainWorld("undoAPI", {
  last: () => ipcRenderer.invoke("undo:last"),
  info: () => ipcRenderer.invoke("undo:info")
});

contextBridge.exposeInMainWorld("cardsAPI", {
  create: (card) => ipcRenderer.invoke("cards:create", card),
  update: (card) => ipcRenderer.invoke("cards:update", card),
  get: (id) => ipcRenderer.invoke("cards:get", id),
  // v48.61（D103）：生成信息区只读 join（card + 批次 + 提示词 + card_issues）
  genInfo: (id) => ipcRenderer.invoke("cards:genInfo", id),
  listDue: () => ipcRenderer.invoke("cards:listDue"),
  // v34（M12，§4.2-20）：今日队列视图 {cards, deferred[]}（同源暂缓清单含延后原因）
  todayQueue: (now) => ipcRenderer.invoke("cards:todayQueue", now),
  listAll: () => ipcRenderer.invoke("cards:listAll"),
  // C-18c：计数/分组专用（主进程聚合，替代渲染层 listAll 全量计数）
  countByExtract: () => ipcRenderer.invoke("cards:countByExtract"),
  listWithKnowledgePoint: () => ipcRenderer.invoke("cards:listWithKnowledgePoint"),
  // v48.67（D111 §6.8-6 数据通道）：主进程过滤 + 分页取数（meta/ids 轻量行集 + 行窗口按需取）
  listMeta: () => ipcRenderer.invoke("cards:listMeta"),
  queryIds: (query) => ipcRenderer.invoke("cards:queryIds", query),
  getWindow: (ids) => ipcRenderer.invoke("cards:getWindow", ids),
  siblingGroup: (key) => ipcRenderer.invoke("cards:siblingGroup", key),
  deferredToday: (now) => ipcRenderer.invoke("cards:deferredToday", now),
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
  // v48.22（D58 §6.8-6）：卡片批量（单事务；op = suspend|resume|postpone|delete；v48.60/D102 增 archive|restore）
  batch: (op, ids, payload) => ipcRenderer.invoke("cards:batch", op, ids, payload),
  // v48.60（D101，§4.1）：标签写入（items=[{id,tags[]}]，渲染层算好终值）与词表（只读派生）
  setTags: (items) => ipcRenderer.invoke("cards:setTags", items),
  listTags: () => ipcRenderer.invoke("cards:listTags"),
  updateLeech: (id, patch) => ipcRenderer.invoke("cards:updateLeech", id, patch),
  resolveLeech: (id, resolution, updates) => ipcRenderer.invoke("cards:resolveLeech", id, resolution, updates),
  listLeech: () => ipcRenderer.invoke("cards:listLeech")
});

contextBridge.exposeInMainWorld("readingAPI", {
  addEvent: (itemId, charPos) => ipcRenderer.invoke("reading:event", itemId, charPos)
});

contextBridge.exposeInMainWorld("statsAPI", {
  overview: () => ipcRenderer.invoke("stats:overview"),
  timeline: (opts) => ipcRenderer.invoke("stats:timeline", opts)
});

// v48.85（D129，§3.4）：成长反馈只读三通道（M13 GF-1 数据面；照 statsAPI 先例，全部 invoke、零事件推送——
// 提示由渲染层在评分成功后主动拉取，§4.17-3）
contextBridge.exposeInMainWorld("growthAPI", {
  afterReview: (cardId, now) => ipcRenderer.invoke("growth:afterReview", String(cardId), now),
  sessionSummary: (fromTs, now) => ipcRenderer.invoke("growth:sessionSummary", Number(fromTs) || 0, now),
  overview: (opts, now) => ipcRenderer.invoke("growth:overview", opts || {}, now)
});

contextBridge.exposeInMainWorld("issuesAPI", {
  add: (issue) => ipcRenderer.invoke("issues:add", issue),
  list: (cardId) => ipcRenderer.invoke("issues:list", cardId),
  resolve: (id) => ipcRenderer.invoke("issues:resolve", id)
});

// D121 §1.2：卡片辨析链接
contextBridge.exposeInMainWorld("cardLinksAPI", {
  add: (input) => ipcRenderer.invoke("card-links:add", input),
  update: (id, patch) => ipcRenderer.invoke("card-links:update", id, patch),
  listForCard: (cardId) => ipcRenderer.invoke("card-links:listForCard", cardId)
});

contextBridge.exposeInMainWorld("batchesAPI", {
  create: (batch) => ipcRenderer.invoke("batches:create", batch),
  setStatus: (id, status) => ipcRenderer.invoke("batches:setStatus", id, status),
  // A-10（审计）：只读出口——关窗后取回已付费生成的草稿
  get: (id) => ipcRenderer.invoke("batches:get", id),
  list: (opts) => ipcRenderer.invoke("batches:list", opts || {})
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
  saveImage: (ownerKey, ext, base64, kind) => ipcRenderer.invoke("assets:saveImage", ownerKey, ext, base64, kind),
  // D122 阅读器「截图」：截取本窗口内的视口矩形 → PNG dataURL（进入图片挖空编辑器）
  captureRegion: (rect) => ipcRenderer.invoke("reader-capture:region", rect),
  // D123 修订 3：整屏框选截图（取消/失败 ⇒ null）
  captureScreen: () => ipcRenderer.invoke("screen-capture:start")
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

// M7 词典（v32，D31）：在线代理 + 本地查词 + 下载/导入 + 缓存（渲染层不直连外网）
contextBridge.exposeInMainWorld("dictAPI", {
  lookupOnline: (providerId, word) => ipcRenderer.invoke("dict:lookupOnline", providerId, word),
  lookupLocal: (word) => ipcRenderer.invoke("dict:lookupLocal", word),
  sources: () => ipcRenderer.invoke("dict:sources"),
  toggleSource: (id, enabled) => ipcRenderer.invoke("dict:toggleSource", id, enabled),
  removeSource: (id) => ipcRenderer.invoke("dict:removeSource", id),
  cacheGet: (providerId, language, word) => ipcRenderer.invoke("dict:cacheGet", providerId, language, word),
  cacheSet: (providerId, language, word, entry) => ipcRenderer.invoke("dict:cacheSet", providerId, language, word, entry),
  pickFile: () => ipcRenderer.invoke("dict:pickFile"),
  importFile: (filePath) => ipcRenderer.invoke("dict:importFile", filePath),
  download: (item) => ipcRenderer.invoke("dict:download", item),
  onDownloadProgress: (callback) => {
    const handler = (_e, msg) => callback(msg);
    ipcRenderer.on("dict:downloadProgress", handler);
    return () => ipcRenderer.removeListener("dict:downloadProgress", handler);
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
  // C-38c（审计）：读备份 meta——恢复确认对话框据 fromOtherDevice 提示「此备份来自另一台设备」
  meta: (file) => ipcRenderer.invoke("backup:meta", file),
  restore: (file) => ipcRenderer.invoke("backup:restore", file),
  // C-39（审计）：导出到 Anki（dialog 选目录 → 写 TSV + media）；openDir 打开最近一次导出目录（主进程记忆，非任意路径）
  exportAnki: () => ipcRenderer.invoke("anki:export"),
  openAnkiDir: () => ipcRenderer.invoke("anki:openDir"),
  relaunch: () => ipcRenderer.send("app:relaunch"),
  // C-23：主库快照完整性检查不通过 → 主进程推送（payload = { message, integrity }，此时旧备份轮换已暂停）
  onIntegrityWarning: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("backup:integrityWarning", handler);
    return () => ipcRenderer.removeListener("backup:integrityWarning", handler);
  }
});

contextBridge.exposeInMainWorld("aiAPI", {
  getConfig: () => ipcRenderer.invoke("ai:getConfig"),
  setConfig: (partial) => ipcRenderer.invoke("ai:setConfig", partial),
  test: () => ipcRenderer.invoke("ai:test"),
  listModels: () => ipcRenderer.invoke("ai:listModels"),
  detectLocal: () => ipcRenderer.invoke("ai:detectLocal"),
  websearch: (query) => ipcRenderer.invoke("ai:websearch", query),
  chat: (requestId, messages, temperature) => ipcRenderer.send("ai:chat", requestId, messages, temperature),
  // v48.74（D118 §3④）：按 requestId 取消在途 AI 请求（停止按钮 / 新一轮运行取消旧流）
  abortChat: (requestId) => ipcRenderer.send("ai:abort", requestId),
  onStream: (callback) => {
    const handler = (_e, requestId, msg) => callback(requestId, msg);
    ipcRenderer.on("ai:stream", handler);
    return () => ipcRenderer.removeListener("ai:stream", handler);
  }
});

// v36（M8-A，§4.2-21 / §6.5 / D34）：日记条目（第二输入通道读取面 + 日记页写入面）
contextBridge.exposeInMainWorld("journalAPI", {
  list: (filter) => ipcRenderer.invoke("journal:list", filter || {}),
  dates: (opts) => ipcRenderer.invoke("journal:dates", opts || {}),
  day: (date) => ipcRenderer.invoke("journal:day", date),
  draft: () => ipcRenderer.invoke("journal:draft"),
  create: (payload) => ipcRenderer.invoke("journal:create", payload),
  update: (id, contentMarkdown) => ipcRenderer.invoke("journal:update", id, contentMarkdown),
  remove: (id) => ipcRenderer.invoke("journal:delete", id),
  // 与快速记录窗口同一条「发送」契约（日记页里的草稿行可直接发送）
  draftSend: (contentMarkdown) => ipcRenderer.invoke("journal:draftSend", contentMarkdown),
  flush: () => ipcRenderer.invoke("journal:flush"),
  onChanged: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("journal:changed", handler);
    return () => ipcRenderer.removeListener("journal:changed", handler);
  }
});

// v36：全局快捷键组（快速记录 / 添加学习材料）——状态查询、重注册、以及快捷键的测试/设置页同源入口
contextBridge.exposeInMainWorld("shortcutsAPI", {
  status: () => ipcRenderer.invoke("shortcuts:status"),
  apply: () => ipcRenderer.invoke("shortcuts:apply"),
  toggleCapture: () => ipcRenderer.invoke("capture:toggle"),
  hideCapture: () => ipcRenderer.invoke("capture:hide"),
  requestAddMaterial: () => ipcRenderer.invoke("library:requestAdd"),
  onOpenAddMaterial: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("library:openAddMaterial", handler);
    return () => ipcRenderer.removeListener("library:openAddMaterial", handler);
  }
});

// v40（K1，D37 / §4.2-23）：知识地基——KP / 关系 / 提案 / 外部 ID（KnowledgeBase 渲染层只持 API）
contextBridge.exposeInMainWorld("knowledgeAPI", {
  listPoints: (filter) => ipcRenderer.invoke("knowledge:listPoints", filter || {}),
  // D158：只读——所选知识点归并族的并集（含所选 id 本身）
  resolveFamilies: (ids) => ipcRenderer.invoke("knowledge:resolveFamilies", ids),
  getPoint: (id) => ipcRenderer.invoke("knowledge:getPoint", id),
  createPoint: (payload) => ipcRenderer.invoke("knowledge:createPoint", payload),
  updatePoint: (id, patch) => ipcRenderer.invoke("knowledge:updatePoint", id, patch),
  mergePoints: (sourceId, targetId) => ipcRenderer.invoke("knowledge:mergePoints", sourceId, targetId),
  unmergePoint: (id) => ipcRenderer.invoke("knowledge:unmergePoint", id),
  listRelations: (filter) => ipcRenderer.invoke("knowledge:listRelations", filter || {}),
  createRelation: (payload) => ipcRenderer.invoke("knowledge:createRelation", payload),
  deleteRelation: (id) => ipcRenderer.invoke("knowledge:deleteRelation", id),
  listRefs: (kpId) => ipcRenderer.invoke("knowledge:listRefs", kpId),
  createRef: (payload) => ipcRenderer.invoke("knowledge:createRef", payload),
  deleteRef: (id) => ipcRenderer.invoke("knowledge:deleteRef", id),
  listProposals: (filter) => ipcRenderer.invoke("knowledge:listProposals", filter || {}),
  resolveProposal: (id, accept, overridePayload) => ipcRenderer.invoke("knowledge:resolveProposal", id, accept, overridePayload || null),
  migrationSuggestions: () => ipcRenderer.invoke("knowledge:migrationSuggestions"),
  // v41（K2-A，D38）：AI 抽取归一与关系（输入装配/裁决在主进程；AI 调用由渲染层编排）
  kpClusters: () => ipcRenderer.invoke("knowledge:kpClusters"),
  kpExtractPrepare: (opts) => ipcRenderer.invoke("knowledge:kpExtractPrepare", opts || {}),
  kpExtractApply: (rawExtraction, rawRelations) => ipcRenderer.invoke("knowledge:kpExtractApply", rawExtraction, rawRelations),
  acceptAllPending: () => ipcRenderer.invoke("knowledge:acceptAllPending"),
  // v43（K2-B）：KnowledgeLint K4/K7/K8 报告型检查
  lint: () => ipcRenderer.invoke("knowledge:lint")
});

// v48.80（D124 / 设计稿 §11.1）：学习者模型——轨道 / 推荐 / 学习事件 / 语言专用查询（一个通道一个方法）
contextBridge.exposeInMainWorld("learnerAPI", {
  status: () => ipcRenderer.invoke("learner:status"),
  refresh: (opts) => ipcRenderer.invoke("learner:refresh", opts || {}),
  recommend: (opts) => ipcRenderer.invoke("learner:recommend", opts || {}),
  feedback: (payload) => ipcRenderer.invoke("learner:feedback", payload || {}),
  listTracks: () => ipcRenderer.invoke("learner:listTracks"),
  saveTrack: (track) => ipcRenderer.invoke("learner:saveTrack", track || {}),
  deleteTrack: (id) => ipcRenderer.invoke("learner:deleteTrack", id),
  setTrackMaterial: (payload) => ipcRenderer.invoke("learner:setTrackMaterial", payload || {}),
  kpLevels: (opts) => ipcRenderer.invoke("learner:kpLevels", opts || {}),
  logEvent: (evt) => ipcRenderer.invoke("learner:logEvent", evt || {}),
  unitText: (opts) => ipcRenderer.invoke("learner:unitText", opts || {}),
  contextReel: (opts) => ipcRenderer.invoke("learner:contextReel", opts || {}),
  sentenceMine: (opts) => ipcRenderer.invoke("learner:sentenceMine", opts || {}),
  placementSample: (opts) => ipcRenderer.invoke("learner:placementSample", opts || {}),
  lexStats: (opts) => ipcRenderer.invoke("learner:lexStats", opts || {}),
  rebuild: () => ipcRenderer.invoke("learner:rebuild")
});

// v40（M8-B，§4.2-24）：AI 洞察 + Personal Meaning 候选（InsightEngine 渲染层编排面）
contextBridge.exposeInMainWorld("insightsAPI", {
  buildPackage: (opts) => ipcRenderer.invoke("insights:buildPackage", opts || {}),
  createRun: (payload) => ipcRenderer.invoke("insights:create", payload),
  completeRun: (id, extra) => ipcRenderer.invoke("insights:complete", id, extra || {}),
  failRun: (id, errorText) => ipcRenderer.invoke("insights:fail", id, errorText),
  getRun: (id) => ipcRenderer.invoke("insights:get", id),
  listRuns: (opts) => ipcRenderer.invoke("insights:list", opts || {}),
  setFeedback: (id, feedback) => ipcRenderer.invoke("insights:feedback", id, feedback),
  deleteRun: (id) => ipcRenderer.invoke("insights:delete", id),
  meaningList: (filter) => ipcRenderer.invoke("meaning:list", filter || {}),
  meaningCreate: (payload) => ipcRenderer.invoke("meaning:create", payload),
  meaningResolve: (id, status) => ipcRenderer.invoke("meaning:resolve", id, status),
  meaningDelete: (id) => ipcRenderer.invoke("meaning:delete", id),
  onChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("insight:changed", handler);
    return () => ipcRenderer.removeListener("insight:changed", handler);
  }
});

// v45（M14-UM1，D39 / §6.7）：用户记忆（编排与留痕在主进程；设置页 sec-memory 唯一入口）
contextBridge.exposeInMainWorld("memoryAPI", {
  status: () => ipcRenderer.invoke("memory:status"),
  setEnabled: (payload) => ipcRenderer.invoke("memory:setEnabled", payload || {}),
  backfillPreview: () => ipcRenderer.invoke("memory:backfillPreview"),
  backfillStart: () => ipcRenderer.invoke("memory:backfillStart"),
  backfillCancel: () => ipcRenderer.invoke("memory:backfillCancel"),
  tidyNow: () => ipcRenderer.invoke("memory:tidyNow"),
  openFolder: () => ipcRenderer.invoke("memory:openFolder"),
  openFile: (name) => ipcRenderer.invoke("memory:openFile", name),
  reset: () => ipcRenderer.invoke("memory:reset"),
  // v46（M14-UM2）：制卡记忆接地检索（Stage A 宽召回在主进程；返回 {ok, block, hitTopics}）
  retrieve: (payload) => ipcRenderer.invoke("memory:retrieve", payload || {}),
  onChanged: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("memory:changed", handler);
    return () => ipcRenderer.removeListener("memory:changed", handler);
  }
});

// v48 批2（M15 重做，D41/D42 / §4.19）：材料知识导图（编排/留痕在主进程；进度经 mindmap:changed 广播）
contextBridge.exposeInMainWorld("mindmapAPI", {
  preview: (params) => ipcRenderer.invoke("mindmap:preview", params || {}),
  generate: (params) => ipcRenderer.invoke("mindmap:generate", params || {}),
  // v48.13 P4：增量深化（展开已有子结构是纯 UI，不发请求）
  deepen: (params) => ipcRenderer.invoke("mindmap:deepen", params),
  // v48.13 P3：可续跑运行（应用重启后发现未跑完的 run）
  pendingRuns: () => ipcRenderer.invoke("mindmap:pendingRuns"),
  cancel: (runId) => ipcRenderer.invoke("mindmap:cancel", runId),
  repairConfirm: (runId) => ipcRenderer.invoke("mindmap:repairConfirm", runId),
  list: (documentId) => ipcRenderer.invoke("mindmap:list", documentId),
  get: (id) => ipcRenderer.invoke("mindmap:get", id),
  getActive: (documentId, scopeAnchor) => ipcRenderer.invoke("mindmap:getActive", documentId, scopeAnchor || "book"),
  // 批 4 Task 15：图谱目录（只读；区间由主进程按 buildExtractionModel 算）
  mapTree: (documentId, tocItems, unitAnchors) => ipcRenderer.invoke("mindmap:mapTree", documentId, tocItems, unitAnchors),
  setActive: (id) => ipcRenderer.invoke("mindmap:setActive", id),
  remove: (id) => ipcRenderer.invoke("mindmap:delete", id),
  runs: (documentId) => ipcRenderer.invoke("mindmap:runs", documentId),
  learningStatus: (documentId, nodeIds) => ipcRenderer.invoke("mindmap:learningStatus", documentId, nodeIds || []),
  onChanged: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("mindmap:changed", handler);
    return () => ipcRenderer.removeListener("mindmap:changed", handler);
  },
  // 材料导图 v2（D192 / MINDMAP-V2-IMPL-PLAN §4.2）：12 个 invoke + mindmap:delta 增量推送订阅
  graphLoad: (p) => ipcRenderer.invoke("mindmap:graphLoad", p),
  graphFeed: (p) => ipcRenderer.invoke("mindmap:graphFeed", p),
  graphEstimate: (p) => ipcRenderer.invoke("mindmap:graphEstimate", p),
  graphGenerate: (p) => ipcRenderer.invoke("mindmap:graphGenerate", p),
  graphExpand: (p) => ipcRenderer.invoke("mindmap:graphExpand", p),
  graphExpandAll: (p) => ipcRenderer.invoke("mindmap:graphExpandAll", p),
  graphExplain: (p) => ipcRenderer.invoke("mindmap:graphExplain", p),
  graphCancel: (p) => ipcRenderer.invoke("mindmap:graphCancel", p),
  graphResume: (p) => ipcRenderer.invoke("mindmap:graphResume", p),
  graphSetView: (p) => ipcRenderer.invoke("mindmap:graphSetView", p),
  graphMetrics: (p) => ipcRenderer.invoke("mindmap:graphMetrics", p),
  graphNodeText: (p) => ipcRenderer.invoke("mindmap:graphNodeText", p),
  graphLocate: (p) => ipcRenderer.invoke("mindmap:graphLocate", p),
  graphEnsureMap: (p) => ipcRenderer.invoke("mindmap:graphEnsureMap", p),
  graphNodeAnchors: (p) => ipcRenderer.invoke("mindmap:graphNodeAnchors", p),
  onDelta: (callback) => {
    const handler = (_e, payload) => callback(payload);
    ipcRenderer.on("mindmap:delta", handler);
    return () => ipcRenderer.removeListener("mindmap:delta", handler);
  }
});

// v48.91（D132，设计 docs/design/PLUGIN-SYSTEM-D132.md §4.4）：插件/主题宿主桥——四 invoke 通道 +
// plugins:changed 推送订阅（渲染层由 themePlugins.ts 经 onChanged 直连 ipcRenderer，不经 EventBus）。
// 与 windowAPI 既有模式逐字同构：全部闭包封装 ipcRenderer.invoke/on，onChanged 返回退订函数。
contextBridge.exposeInMainWorld("pluginsAPI", {
  list: () => ipcRenderer.invoke("plugins:list"),
  getActive: () => ipcRenderer.invoke("plugins:getActive"),
  setActive: (id) => ipcRenderer.invoke("plugins:setActive", id),
  openFolder: () => ipcRenderer.invoke("plugins:openFolder"),
  rescan: () => ipcRenderer.invoke("plugins:rescan"),
  onChanged: (callback) => {
    const handler = () => callback();
    ipcRenderer.on("plugins:changed", handler);
    return () => ipcRenderer.removeListener("plugins:changed", handler);
  }
});

// D248（T5）：BDI 采集桥。本文件只服务 main / lens / workbench 三窗口（capture 走 preload-capture.js，
// 那里只有 batch + onConfig）。三窗口当前都允许 status；query / export / purge 随 T11 / T12 只加给 main。
// 主进程仍按 sender 的真实页面 URL 复核角色（V1-8），这里的裁剪只是第一道门。
contextBridge.exposeInMainWorld("behaviorAPI", {
  batch: (payload) => ipcRenderer.send("behavior:batch", payload),
  status: () => ipcRenderer.invoke("behavior:status"),
  // 具名只读查询（主进程按窗口角色复核；lens/workbench/capture 调用一律拒绝）
  query: (name, params) => ipcRenderer.invoke("behavior:query", name, params || {}),
  onConfig: (callback) => {
    const handler = (_e, p) => callback(p);
    ipcRenderer.on("behavior:config", handler);
    return () => ipcRenderer.removeListener("behavior:config", handler);
  }
});

