const { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  initDb,
  listItems,
  createFromPaste,
  createFromEpub,
  deleteItem,
  getDocument,
  getItemIdByDocumentId,
  updateProgress,
  createExtract,
  listDueExtracts,
  getExtract,
  postponeExtract,
  getLastUndoableReview,
  undoLastReview,
  createCard,
  updateCard,
  getCard,
  listDueCards,
  listAllCards,
  deleteCard,
  saveReview,
  saveSkip,
  addReadingEvent,
  getStatsOverview,
  setCardSuspended,
  updateCardLeech,
  resolveLeech,
  listLeechCards,
  addCardIssue,
  listCardIssues,
  resolveCardIssue,
  createAIGenBatch,
  setAIGenBatchStatus,
  getPromptTemplate,
  listPromptTemplates,
  findSimilarCards
} = require("./db");
const { getAIConfig, setAIConfig, chatStream, testConnection, listModels } = require("./ai");
const dbModule = require("./db");
const optimizer = require("./optimizer");
const backup = require("./backup");
const {
  wordToMarkdown,
  decodeTextBytes,
  txtToMarkdown,
  markdownFromText,
  titleFromFilename
} = require("./importers");

protocol.registerSchemesAsPrivileged([
  { scheme: "bookasset", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    return { app: {}, theme: {} };
  }
}

function writeSettings(all) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(all, null, 2), "utf-8");
}

ipcMain.handle("settings:get", (_e, scope, key) => {
  const all = readSettings();
  if (key === undefined) return all[scope] ?? {};
  return all[scope]?.[key];
});

ipcMain.handle("settings:set", (_e, scope, key, value) => {
  const all = readSettings();
  if (!all[scope]) all[scope] = {};
  all[scope][key] = value;
  writeSettings(all);
  return true;
});

ipcMain.on("win:minimize", (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});

ipcMain.on("win:maximize", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on("win:close", (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

ipcMain.handle("library:list", () => listItems());

ipcMain.handle("library:createFromPaste", (_e, title, markdown) => {
  const md = String(markdown || "");
  if (!md.trim()) return null;
  return createFromPaste(String(title || ""), md);
});

ipcMain.handle("library:delete", (_e, id) => deleteItem(String(id)));

ipcMain.handle("library:pickEpub", async () => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: "EPUB 电子书", extensions: ["epub"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const data = fs.readFileSync(filePath);
  return { name: path.basename(filePath), path: filePath, data };
});

ipcMain.handle("library:createFromEpub", (_e, payload) => {
  const { title, markdown, toc, coverDataUrl, epubData, sourceName } = payload || {};
  if (!markdown || !String(markdown).trim()) return null;
  return createFromEpub(title, String(markdown), toc || [], coverDataUrl, epubData, sourceName);
});

// ---------- M6-1（v26）导入格式扩展：Word（含内嵌图）/ TXT / Markdown（转换在主进程，见 importers.js） ----------
const IMPORT_PICK_FILTERS = {
  word: { name: "Word 文档", extensions: ["docx"] },
  txt: { name: "文本文档", extensions: ["txt"] },
  markdown: { name: "Markdown 文档", extensions: ["md", "markdown"] }
};

async function pickImportFile(kind) {
  const result = await dialog.showOpenDialog({
    filters: [IMPORT_PICK_FILTERS[kind]],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return { name: path.basename(filePath), path: filePath };
}

ipcMain.handle("library:pickWord", () => pickImportFile("word"));
ipcMain.handle("library:pickTxt", () => pickImportFile("txt"));
ipcMain.handle("library:pickMarkdown", () => pickImportFile("markdown"));

ipcMain.handle("library:createFromWord", async (_e, payload) => {
  const { path: filePath, name } = payload || {};
  if (!filePath) return null;
  const buf = fs.readFileSync(String(filePath));
  const { markdown, images } = await wordToMarkdown(buf);
  if (!markdown.trim()) throw new Error("未能从该 Word 文档中提取到文本内容");
  return dbModule.createImportedDoc({
    title: titleFromFilename(name),
    markdown,
    sourceType: "word",
    sourceName: name || null,
    originalName: "original.docx",
    originalBuf: buf,
    images
  });
});

ipcMain.handle("library:createFromTxt", (_e, payload) => {
  const { path: filePath, name } = payload || {};
  if (!filePath) return null;
  const buf = fs.readFileSync(String(filePath));
  const { text } = decodeTextBytes(buf);
  const markdown = txtToMarkdown(text);
  if (!markdown.trim()) throw new Error("该文本文件没有可导入的内容");
  return dbModule.createImportedDoc({
    title: titleFromFilename(name),
    markdown,
    sourceType: "txt",
    sourceName: name || null,
    originalName: "original.txt",
    originalBuf: buf,
    images: []
  });
});

ipcMain.handle("library:createFromMarkdown", (_e, payload) => {
  const { path: filePath, name } = payload || {};
  if (!filePath) return null;
  const buf = fs.readFileSync(String(filePath));
  const markdown = markdownFromText(decodeTextBytes(buf).text);
  if (!markdown.trim()) throw new Error("该 Markdown 文件没有可导入的内容");
  return dbModule.createImportedDoc({
    title: titleFromFilename(name),
    markdown,
    sourceType: "markdown",
    sourceName: name || null,
    originalName: "original.md",
    originalBuf: buf,
    images: []
  });
});

// 读侧：取回某本书的内嵌图字节（合成 EPUB 时落进 OEBPS/images/）
ipcMain.handle("library:readContentImages", (_e, itemId) => dbModule.readContentImages(String(itemId)));

ipcMain.handle("library:doc", (_e, itemId) => getDocument(String(itemId)));
ipcMain.handle("library:itemByDoc", (_e, docId) => getItemIdByDocumentId(String(docId)));

// 阅读内核（v20）：读取书架条目的原书文件（assets/<itemId>/original.epub），供 foliate 内核打开
ipcMain.handle("library:readBookFile", (_e, itemId) => dbModule.readBookFile(String(itemId)));

// 外链：仅允许 http/https，交系统浏览器（渲染层永不自行导航）
ipcMain.handle("shell:openExternal", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url).then(() => true).catch(() => false);
  }
  return false;
});

ipcMain.handle("library:updateProgress", (_e, itemId, progress) => updateProgress(String(itemId), progress));

ipcMain.handle("extracts:create", (_e, payload) => createExtract(payload || {}));

ipcMain.handle("extracts:listDue", () => listDueExtracts());

ipcMain.handle("extracts:get", (_e, id) => getExtract(String(id)));

ipcMain.handle("extracts:postpone", (_e, id) => postponeExtract(String(id)));

// ---------- 卡片 / FSRS / Leech / AI 制卡 ----------
ipcMain.handle("cards:create", (_e, card) => createCard(card || {}));
ipcMain.handle("cards:update", (_e, card) => updateCard(card || {}));
ipcMain.handle("cards:get", (_e, id) => getCard(String(id)));
ipcMain.handle("cards:listDue", () => listDueCards());
ipcMain.handle("cards:listAll", () => listAllCards());
ipcMain.handle("cards:delete", (_e, id) => deleteCard(String(id)));
ipcMain.handle("cards:review", (_e, cardId, fsrsState, rating, durationMs, fsrsBefore) =>
  saveReview(String(cardId), fsrsState, String(rating), durationMs, fsrsBefore)
);
// v23（§4.4.9）：纯持久化重试——persist 失败后 UI「重试保存」调用；只重试持久化，不重执行任何业务 mutation
ipcMain.handle("cards:persistNow", () => dbModule.persistNow());
// v23（D20）：当前活跃 FSRS 配置完整快照（fsrs_configs 指针行）
ipcMain.handle("fsrs:activeConfig", () => dbModule.getActiveFsrsConfig());
// v22 撤销评分：查询最近可撤销评分 / 执行撤销（恢复快照+移除日志+回退 leech）
ipcMain.handle("cards:lastUndoableReview", () => getLastUndoableReview());
ipcMain.handle("cards:undoReview", () => undoLastReview());
// 统计管线 v1：跳过事件 / 阅读进度事件 / 统计聚合
ipcMain.handle("cards:skip", (_e, cardId) => saveSkip(String(cardId)));
ipcMain.handle("reading:event", (_e, itemId, charPos) => addReadingEvent(String(itemId), Number(charPos)));
ipcMain.handle("stats:overview", () => getStatsOverview());
ipcMain.handle("cards:setSuspended", (_e, id, suspended, reason) =>
  setCardSuspended(String(id), Boolean(suspended), reason)
);
// §11.4（v11）：leech 字段级更新，不触碰 fsrs_json
ipcMain.handle("cards:updateLeech", (_e, id, patch) => updateCardLeech(String(id), patch || {}));

// ---------- FSRS 参数优化器（v12；v23 配置走 fsrs_configs 快照 + 指针，D20） ----------
ipcMain.handle("optimizer:stats", () => optimizer.getOptimizerStats(dbModule));
ipcMain.handle("optimizer:current", () => optimizer.getActiveConfig(dbModule));
ipcMain.handle("optimizer:train", async (e) => {
  const send = (p) => {
    if (!e.sender.isDestroyed()) e.sender.send("optimizer:progress", p);
  };
  try {
    const result = await optimizer.train(dbModule, (value) => send({ current: value.current, total: value.total, percent: value.percent }));
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
// v23：apply/reset 只移动活跃指针（不修改任何 config 内容）；提交成功后由事实层（此处）广播
// fsrs:configChanged——渲染层 fsrs.ts 据此热重建引擎（F9），不依赖 UI 发事件
const broadcastFsrsConfigChanged = (configId) => {
  for (const wc of BrowserWindow.getAllWindows().map((w) => w.webContents)) {
    if (!wc.isDestroyed()) wc.send("fsrs:configChanged", configId);
  }
};
ipcMain.handle("optimizer:apply", (_e, weights) => {
  const result = optimizer.applyWeights(dbModule, weights);
  broadcastFsrsConfigChanged(result.configId);
  return result;
});
ipcMain.handle("optimizer:reset", () => {
  const result = optimizer.resetWeights(dbModule);
  broadcastFsrsConfigChanged(result.configId);
  return result;
});
ipcMain.handle("cards:resolveLeech", (_e, id, resolution, updates) =>
  resolveLeech(String(id), String(resolution), updates || {})
);
ipcMain.handle("cards:listLeech", () => listLeechCards());
ipcMain.handle("issues:add", (_e, issue) => addCardIssue(issue || {}));
ipcMain.handle("issues:list", (_e, cardId) => listCardIssues(String(cardId)));
ipcMain.handle("issues:resolve", (_e, id) => resolveCardIssue(String(id)));
ipcMain.handle("batches:create", (_e, batch) => createAIGenBatch(batch || {}));
ipcMain.handle("batches:setStatus", (_e, id, status) => setAIGenBatchStatus(String(id), String(status)));
ipcMain.handle("prompts:list", () => listPromptTemplates());
ipcMain.handle("prompts:get", (_e, scope) => getPromptTemplate(String(scope)));
ipcMain.handle("similarity:find", (_e, text, k) => findSimilarCards(String(text || ""), Number(k) || 3));

// ---------- M1.1 图片挖空卡（D16）：选本地图 → 落盘 assets/ → 入 assets 表 → 返回 bookasset URL + dataURL ----------
ipcMain.handle("assets:pickOcclusionImage", async (_e, ownerKey) => {
  const result = await dialog.showOpenDialog({
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const p = result.filePaths[0];
  const buf = fs.readFileSync(p);
  const ext = path.extname(p).slice(1);
  const asset = dbModule.createAssetForItem(String(ownerKey), "image-occlusion", ext, buf);
  const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[
    ext.toLowerCase()
  ] || "image/png";
  return { ...asset, dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
});

// v25 图片点选聚焦：渲染层已拿到的图片字节（正文图片/选区裁剪）→ 落盘 assets/ + 入 assets 表。
// 与 pickOcclusionImage 的区别：不经文件对话框，字节来自渲染层（bookasset/blob 同源可读）。
ipcMain.handle("assets:saveImage", (_e, ownerKey, ext, base64, kind) => {
  try {
    const buf = Buffer.from(String(base64 || ""), "base64");
    return dbModule.createAssetForItem(String(ownerKey), String(kind || "image-occlusion"), String(ext || "png"), buf);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
});

// ---------- M2 数据备份与恢复（§9.1 M2） ----------
const backupOpts = () => ({
  flush: () => dbModule.persistDb(),
  counts: dbModule.getBackupCounts(),
  appVersion: app.getVersion()
});
ipcMain.handle("backup:info", () => ({
  ...backup.getDataInfo(),
  counts: dbModule.getBackupCounts(),
  backupDir: backup.getBackupDir()
}));
ipcMain.handle("backup:create", async (_e, opts) => {
  try {
    return await backup.createBackup({
      ...backupOpts(),
      label: "manual",
      includeAIConfig: !!(opts && opts.includeAIConfig)
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle("backup:list", () => backup.listBackups());
ipcMain.handle("backup:pickDir", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择备份保存位置",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("backup:openDir", async () => {
  await shell.openPath(backup.getBackupDir());
  return true;
});
ipcMain.handle("backup:pickFile", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择备份文件",
    filters: [{ name: "备份文件", extensions: ["zip"] }],
    properties: ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("backup:restore", async (_e, file) => {
  try {
    return await backup.restoreBackup(String(file), backupOpts());
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.on("app:relaunch", () => {
  app.relaunch();
  app.exit(0);
});

// ---------- AI 网关 ----------
ipcMain.handle("ai:getConfig", () => getAIConfig());
ipcMain.handle("ai:setConfig", (_e, partial) => setAIConfig(partial || {}));
ipcMain.handle("ai:test", () => testConnection());
ipcMain.handle("ai:listModels", () => listModels());

// 联网补充事件背景（多引擎回退：Bing → DuckDuckGo → 百度；走 Chromium 网络栈自动继承系统代理）
const SEARCH_ENGINES = [
  {
    name: "Bing",
    url: (q) => "https://www.bing.com/search?q=" + encodeURIComponent(q) + "&setlang=zh-hans&count=10",
    parse: (html) => {
      const results = [];
      const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g;
      let m;
      while ((m = re.exec(html)) && results.length < 6) {
        results.push({ title: stripHtml(m[1]), snippet: stripHtml(m[2]) });
      }
      return results;
    }
  },
  {
    name: "DuckDuckGo",
    url: (q) => "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q),
    parse: (html) => {
      const results = [];
      const re = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) && results.length < 6) {
        results.push({ title: stripHtml(m[1]), snippet: stripHtml(m[2]) });
      }
      return results;
    }
  },
  {
    name: "Baidu",
    url: (q) => "https://www.baidu.com/s?wd=" + encodeURIComponent(q),
    parse: (html) => {
      const results = [];
      const re = /<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/g;
      let m;
      while ((m = re.exec(html)) && results.length < 6) {
        results.push({ title: stripHtml(m[1]), snippet: stripHtml(m[2]) });
      }
      return results;
    }
  }
];

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

ipcMain.handle("ai:websearch", async (_e, query) => {
  const q = String(query || "").trim();
  if (!q) return [];
  const errors = [];
  for (const engine of SEARCH_ENGINES) {
    try {
      const res = await net.fetch(engine.url(q), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Accept: "text/html,application/xhtml+xml"
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) {
        errors.push(`${engine.name}: HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      const results = engine.parse(html).filter((r) => r.title && r.snippet);
      if (results.length > 0) return results;
      errors.push(`${engine.name}: 无结果`);
    } catch (err) {
      errors.push(`${engine.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(
    `联网搜索失败（${errors.join("；")}）。建议：确认 Clash 系统代理开启；或直接粘贴相关背景文字后再制卡。`
  );
});
ipcMain.on("ai:chat", (e, requestId, messages, temperature) => {
  const send = (m) => {
    if (!e.sender.isDestroyed()) e.sender.send("ai:stream", requestId, m);
  };
  try {
    chatStream({ messages, temperature }, send).catch((err) => {
      send({ error: err instanceof Error ? err.message : String(err) });
    });
  } catch (err) {
    // 同步抛出（如未配 Key）也走流式错误，绝不炸主进程
    send({ error: err instanceof Error ? err.message : String(err), code: err?.code });
  }
});

function createWindow() {
  // 防重入：已存在窗口时不再创建（macOS activate 与启动路径共用此函数）
  if (BrowserWindow.getAllWindows().length > 0) return;
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    frame: false,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  // 阅读内核导航防护（v20）：渲染层发起的任何页面级导航一律拦截——
  // EPUB 正文内的相对链接会把窗口导到不存在的 file:// 地址导致整窗白屏。
  // 仅放行同页刷新（复习页「刷新」按钮用 location.reload()；hash 变化不触发本事件）。
  win.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] === win.webContents.getURL().split("#")[0]) return;
    event.preventDefault();
  });
  // window.open / target=_blank：http(s) 交系统浏览器，其余一律拒绝开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  // 加载顺序（v11.2）：dist 存在则直接用（生产产物优先，避免 devURL 连接超时挂起导致白屏）；
  // dist 不存在（纯开发场景）才走 vite dev server，失败再报错
  const distIndex = path.join(__dirname, "../dist/index.html");
  if (fs.existsSync(distIndex)) {
    win.loadFile(distIndex);
  } else if (!app.isPackaged) {
    win.loadURL("http://localhost:5173").catch(() => {
      win.loadFile(distIndex);
    });
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // 先建窗口立即给用户视觉反馈，数据库并行初始化（v10.2 启动优化）
  createWindow();
  // M2：若有待恢复备份（restore-pending.json），先换入数据文件再初始化数据库
  try {
    backup.applyPendingRestore();
  } catch (err) {
    console.error("[backup] 应用待恢复数据失败：", err);
  }
  await initDb();
  // M2：每日首次启动自动滚动备份（设置可关；失败不阻塞启动）
  try {
    const r = await backup.autoBackupIfNeeded(backupOpts());
    if (!r.ok) console.error("[backup] 自动备份失败：", r.error);
  } catch (err) {
    console.error("[backup] 自动备份失败：", err);
  }
  protocol.handle("bookasset", (request) => {
    try {
      const url = new URL(request.url);
      const itemId = url.hostname;
      const filename = decodeURIComponent(url.pathname).replace(/^\//, "");
      if (!itemId || !/^[A-Za-z0-9._-]+$/.test(filename)) {
        return new Response("bad request", { status: 400 });
      }
      const file = path.join(app.getPath("userData"), "assets", itemId, filename);
      const data = fs.readFileSync(file);
      const ext = path.extname(filename).slice(1).toLowerCase();
      const types = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
        gif: "image/gif", webp: "image/webp", svg: "image/svg+xml"
      };
      return new Response(data, { headers: { "content-type": types[ext] || "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  // 首个窗口已在上方先行创建（v10.2 启动优化），此处只做协议注册与生命周期挂接
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
