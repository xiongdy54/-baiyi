const { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  initDb,
  listItems,
  createFromPaste,
  createFromEpub,
  deleteItem,
  getDocument,
  updateProgress,
  createExtract,
  listDueExtracts,
  getExtract,
  postponeExtract,
  createCard,
  updateCard,
  getCard,
  listDueCards,
  listAllCards,
  deleteCard,
  saveReview,
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

ipcMain.handle("library:doc", (_e, itemId) => getDocument(String(itemId)));

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
ipcMain.handle("cards:review", (_e, cardId, fsrsState, rating, durationMs) =>
  saveReview(String(cardId), fsrsState, String(rating), durationMs)
);
ipcMain.handle("cards:setSuspended", (_e, id, suspended, reason) =>
  setCardSuspended(String(id), Boolean(suspended), reason)
);
// §11.4（v11）：leech 字段级更新，不触碰 fsrs_json
ipcMain.handle("cards:updateLeech", (_e, id, patch) => updateCardLeech(String(id), patch || {}));
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
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const devUrl = "http://localhost:5173";
  if (!app.isPackaged) {
    win.loadURL(devUrl).catch(() => {
      win.loadFile(path.join(__dirname, "../dist/index.html"));
    });
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // 先建窗口立即给用户视觉反馈，数据库并行初始化（v10.2 启动优化）
  createWindow();
  await initDb();
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
