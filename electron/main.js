const { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net, shell, screen } = require("electron");
const path = require("path");
const fs = require("fs");

// 测试隔离开关（仅 e2e/GUI 脚本设置 env 时生效）：词典导入/删除会写主库 dict_sources，
// e2e 若共用真实 userData 会误删用户已装词典（2026-09-14 实测教训）——spawn 时传临时目录。
// v34（M12 实测补记）：本块必须在 require("./db") **之前**——db.js 顶部 require 的 settingsStore
// 在模块加载时固化 SETTINGS_FILE=app.getPath("userData")，晚于 setPath 会让 db 侧读默认目录的
// settings.json、main 侧写隔离目录（M12 GUI「设置已写入但队列无响应」的根因：两侧 settings 分叉）。
if (process.env.M7_TEST_USERDATA) {
  app.setPath("userData", path.resolve(process.env.M7_TEST_USERDATA));
}

// v48.23（D61 §6.8-11）：多段选择的纯函数内核（唯一实现面，见 electron/annotationRange.js 头注）。
// 主进程用它装配 spans 载荷（extracts:spanSet 与 db.createExtract 同一模块）。
const annotationRange = require("./annotationRange");

// v36（M8-A，§6.5/D34）：**进程级单实例**——全局快捷键必须只有唯一宿主（第二个进程抢不到注册，
// 且会各持一份 sql.js 内存库、互相覆盖落盘）。第二次启动聚焦已有窗口后退出。
let mainWindow = null;
// D123：真正退出标记（before-quit 置位）——关闭主窗口默认收进托盘，只有它为 true 才放行销毁
let appQuitting = false;
let trayHinted = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
  // D-TEST-24/25：这里必须**立即返回**。原来只调 app.quit() 就往下走，
  // 于是第二个实例仍然会走完整启动流程（initDb 会打开同一份库文件做迁移/落盘），
  // 实测 12 次里有 3 次改动了在线实例的库文件——覆盖式写，等于静默吞掉对方的数据。
  return;
} else {
  app.on("second-instance", () => {
    // D123：只认主窗口（隐藏的快速记录/制卡台窗口也在 getAllWindows 里，不能拿来聚焦）；已销毁则重建
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// v48.75（D119，设计 docs/design/APP-LOGGING-D119.md）：应用日志——单实例锁之后、其余 require
// 之前尽早初始化（后续模块加载期的异常也落日志；目录在 userData 下，必须在 M7_TEST_USERDATA
// setPath 之后取路径）。第二实例不初始化（立即退出，避免重复启动在日志留噪音行）。
const appLog = require("./appLog");
appLog.init({
  dir: path.join(app.getPath("userData"), "logs"),
  version: app.getVersion(),
  platform: `${process.platform}/${process.arch}`,
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  packaged: app.isPackaged
});
// 进程级异常捕获（v48.75 审查修订，D119 §6 两阶段崩溃语义）：
// - 启动期（!app.isReady()）：同步异常会中止本模块顶层（后续业务 require / whenReady 注册
//   全部跳过）→ 半初始化进程无 IPC、无用户现场可保——落日志后 app.exit(1)，不留僵尸。
// - 就绪后：**继续运行保现场**（有意抑制 Node 默认退出——桌面应用工作现场优先，
//   electron-log 同惯例；业务级错误由各 IPC handler 既有 try/catch 防线兜底）。
// - unhandledRejection 一律只记录不退出（异步拒绝不中止初始化流程，误杀风险大于收益）。
process.on("uncaughtException", (err) => {
  appLog.logError("main", err, { event: "uncaughtException" });
  if (!app.isReady()) app.exit(1);
});
process.on("unhandledRejection", (reason) => {
  appLog.logError("main", reason instanceof Error ? reason : String(reason), { event: "unhandledRejection" });
});
// 测试钩子（仅测试设置 env 时生效，M7_TEST_USERDATA 同例）：模拟模块加载期同步崩溃，
// 供 tests/applog.test.cjs 验证「启动期异常 → 落日志 + app.exit(1) 不僵尸」。必须位于
// 上方 uncaughtException 注册之后（否则无人捕获）。
if (process.env.M7_APPLOG_STARTUP_CRASH) {
  throw new Error(`M7_APPLOG_STARTUP_CRASH: ${process.env.M7_APPLOG_STARTUP_CRASH}`);
}
// 渲染层错误转发（fire-and-forget on 通道：报告失败不触发新错误）；openFolder 目录不存在先建。
ipcMain.on("logs:rendererError", (_e, payload) => {
  try {
    appLog.logRendererError(payload);
  } catch {
    /* 静默：日志通道永不外溢 */
  }
});
ipcMain.handle("logs:openFolder", () => {
  appLog.ensureDir();
  return shell.openPath(appLog.getLogDir()).then((msg) => msg === "");
});

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
  listAllExtracts,
  getExtract,
  getExtractChain,
  postponeExtract,
  // v48.22（D58）：摘录调度内核（写 API + 引擎切换 + 派生用量 + 跨类撤销）
  postponeExtractDays,
  advanceExtract,
  updateExtract,
  setExtractPriority,
  setExtractStatus,
  deleteExtract,
  batchExtractOps,
  batchCardOps,
  // v48.60（D101）：标签写入与词表（§4.1）
  setCardTags,
  listCardTags,
  switchExtractEngine,
  setLibraryItemPriority,
  getDailyUsage,
  getLimitsState,
  validateLimits,
  // v48.23（D61 §6.8-11）：多段选择修饰键的写侧归一（取值域封闭，非法值不落盘）
  normalizeMultiSelectKey,
  normalizeAnnotateMode,
  normalizeAnnotateForm,
  normalizeAnnotationFilter,
  normalizeAnnotateCustomEnabled,
  normalizeAnnotatePalette,
  computeSessionQueue,
  computeCardCounts,
  readAiRerank,
  saveAiRerank,
  getActiveExtractEngine,
  undoLast,
  getUndoInfo,
  getLastUndoableReview,
  undoLastReview,
  createCard,
  updateCard,
  getCard,
  listDueCards,
  computeTodayQueue,
  listAllCards,
  deleteCard,
  saveReview,
  saveSkip,
  addReadingEvent,
  getStatsOverview,
  getStatsTimeline,
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
const { getAIConfig, setAIConfig, chatStream, testConnection, listModels, detectLocalRuntime } = require("./ai");
// v48.22（D58 / E1）：AI 重排的本地裁决与指纹（与 db 侧同一份实现）
const { rankWithAI, rerankFingerprint } = require("./aiNextExtract");
const dbModule = require("./db");
const optimizer = require("./optimizer");
const backup = require("./backup");
// v45（M14-UM1，D39）：用户记忆——文件树真源（memoryStore）+ 整理编排（memoryTidy，AI 调用经
// memoryChat 包装 chatStream；提示词文本只来自播种模板 user-memory，主进程不写提示词正文）
const memoryStore = require("./memoryStore");
const memoryTidy = require("./memoryTidy");
const memoryRetrieve = require("./memoryRetrieve");
const mindmapEngine = require("./mindmapEngine");
const dictStore = require("./dictStore");
const quickCapture = require("./quickCapture");
// D123：独立制卡台窗口与系统托盘（见 docs/design/CARD-WORKBENCH-D123.md）
const workbenchWindow = require("./workbenchWindow");
// v48.89（D132，设计 docs/design/PLUGIN-SYSTEM-D132.md）：插件/主题宿主——惰性扫描（启动主流程
// 不触碰插件目录，§4.7），对 <userData>/plugins/ 零写入（§4.6）；IPC 四通道 + plugins:changed 广播在其内注册
const pluginHost = require("./pluginHost");
const screenCapture = require("./screenCapture");
const tray = require("./tray");
const { journalDateOf } = require("./journalTime");
const {
  wordToMarkdown,
  docxAuthor,
  decodeTextBytes,
  txtToMarkdown,
  markdownFromText,
  titleFromFilename,
  pdfToMarkdown
} = require("./importers");

protocol.registerSchemesAsPrivileged([
  { scheme: "bookasset", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  // M6-2 修订（v28）：pdf.js 的 cMap/标准字体资源——file:// 页面里 fetch file:// 会被 Chromium 拦截
  // （导致字形数据加载失败→白轮廓无文字+重试风暴），走特权协议供渲染进程与 worker fetch
  { scheme: "pdfres", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    const v = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    // 批次 A（D-TEST-09）：合法 JSON 但非对象时同样兜底。保留 { app, theme } 形状——
    // settings:set 的 all[scope][key] = value 依赖它。不做自愈写回，不覆盖用户文件。
    return v && typeof v === "object" && !Array.isArray(v) ? v : { app: {}, theme: {} };
  } catch (err) {
    // D-TEST-30：与 settingsStore.js 同源的一处（两份长期分叉，见下方注释）。
    // 解析失败原来是静默兜底，随后任何一次设置写入都会覆盖掉用户原有偏好且现场不可追；
    // 这里把损坏文件改名留证，行为与 settingsStore 保持一致。
    try {
      if (err && err.code !== "ENOENT") {
        const keep = SETTINGS_FILE + ".corrupt";
        fs.rmSync(keep, { force: true });
        fs.renameSync(SETTINGS_FILE, keep);
      }
    } catch {
      /* 留证失败不影响兜底 */
    }
    return { app: {}, theme: {} };
  }
}

// 注意：electron/settingsStore.js 另有一份 readSettings（db.js 与各仓储路径用它），
// 两份长期分叉待后续批次合并。

function writeSettings(all) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // D-TEST-30：同上——裸 writeFileSync 写一半就是截断文件，改为 .tmp + 原子 rename。
  const tmp = SETTINGS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf-8");
  fs.renameSync(tmp, SETTINGS_FILE);
}

ipcMain.handle("settings:get", (_e, scope, key) => {
  const all = readSettings();
  if (key === undefined) return all[scope] ?? {};
  return all[scope]?.[key];
});

ipcMain.handle("settings:set", (_e, scope, key, value) => {
  // v48.22（D58 §6.8-5）：每日上限的**硬边界**在主进程侧兜底——渲染层校验只负责即时提示，
  // 这里拒绝违规写入（否则绕过 UI 就能把「复习上限 < 新上限×5」落盘，积压立刻发生）
  if (scope === "app" && key === "limits") {
    const verdict = validateLimits(value || {});
    if (!verdict.ok) {
      const err = new Error(verdict.errors.join("；"));
      err.errors = verdict.errors;
      throw err;
    }
  }
  // v48.23（D61 §6.8-11）：多段选择修饰键取值域封闭（Ctrl/Alt/Shift/Meta），非法写入就地归一
  if (scope === "app" && key === "multiSelectKey") value = normalizeMultiSelectKey(value);
  // 批 4（规格 §9.2）：批注设置键同样在写侧归一（枚举回落默认 / 色板净化去重限 8）
  // v48.42（D82）：annotateMode 回归模式域（highlight/extract），标记形式拆独立键 annotateForm
  if (scope === "app" && key === "annotateMode") value = normalizeAnnotateMode(value);
  if (scope === "app" && key === "annotateForm") value = normalizeAnnotateForm(value);
  if (scope === "app" && key === "annotationFilter") value = normalizeAnnotationFilter(value);
  if (scope === "app" && key === "annotateCustomEnabled") value = normalizeAnnotateCustomEnabled(value);
  if (scope === "app" && key === "annotatePalette") value = normalizeAnnotatePalette(value);
  // D95（设计稿 §E/§F.2 + §K 第二轮）：摘录卡编辑器/字号键 + 阅读器动作组键写侧归一——
  // 语义与渲染层读侧（src/lib/extractCardSettings.ts、src/lib/selectionBarSettings.ts）一致
  if (scope === "app" && key === "extractEditorToolbar") value = value === true;
  if (scope === "app" && key === "extractEditorToolbarFloat") value = value === true;
  if (scope === "app" && key === "extractEditorToolbarTop") value = value === true;
  // D122：选区浮条动作呈现（icon/text）取代 readerActionsFloat；与 src/lib/selectionBarSettings.ts 同规
  if (scope === "app" && key === "selectionBarStyle") value = value === "text" ? "text" : "icon";
  // D123：制卡台放置位置（right/bottom，非法回落 right）与「关闭窗口收进托盘」（仅严格 false 为关）
  if (scope === "app" && key === "workbenchPlacement") value = value === "bottom" ? "bottom" : "right";
  if (scope === "app" && key === "closeToTray") value = value !== false;
  if (scope === "app" && key === "extractFaceFontFollow") value = value === true;
  if (scope === "app" && key === "extractFaceFontSize") {
    const n = Math.round(Number(value));
    value = Number.isFinite(n) && n >= 10 && n <= 40 ? n : 17;
  }
  if (scope === "app" && key === "extractFaceFontFamily") value = typeof value === "string" ? value.trim() : "";
  // v48.61（D104，§7.4）：卡面信息密度三开关写侧归一——仅严格 true 为真、其余回落 true（默认全开），
  // 与渲染层读侧（src/lib/cardFaceExtras.ts normalizeCardFaceExtras）同规
  // v48.63（D107，§7.4）：标签功能总开关写侧归一——仅严格 false 为关，其余（含缺失/非法）回落开
  if (scope === "app" && key === "tagsEnabled") value = value !== false;
  if (scope === "app" && key === "cardFaceExtras") {
    const src = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    value = {
      mnemonic: src.mnemonic === false ? false : true,
      example: src.example === false ? false : true,
      sourceRef: src.sourceRef === false ? false : true
    };
  }
  // v48.85（D129，§7.4）：成长反馈总开关写侧归一——对象 {enabled}，仅严格 false 为关
  //（含手改文件把整个值写成布尔 false 的形态），其余（含缺失/非法/非对象）回落开；
  // 与渲染层读侧（src/lib/growthSettings.ts normalizeGrowthFeedback）同规。
  // 对象键逐字面量（D82 教训 / 设计稿 R7：勿用变量间接，防 F18 扫描器误报；子键不单列 DOC_KEYS）
  if (scope === "app" && key === "growthFeedback") {
    const off = value === false ||
      (value !== null && typeof value === "object" && !Array.isArray(value) && value.enabled === false);
    value = { enabled: !off };
  }
  const all = readSettings();
  if (!all[scope]) all[scope] = {};
  all[scope][key] = value;
  writeSettings(all);
  // v36（M8-A）：全局快捷键组改动即时生效（重注册；被占用等失败经 shortcuts:status 在设置页可见）
  if (scope === "app" && key === "globalShortcuts") {
    try {
      quickCapture.applyGlobalShortcuts();
    } catch (err) {
      console.error("[quickCapture] 重新注册全局快捷键失败：", err);
    }
  }
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

// ---------- D123：制卡台窗口外延 / 独立窗口 ----------
// 非最大化且屏幕右缘有余量：窗口整体向右变宽 delta（面板占新增的那一条，正文宽度不变）；
// 最大化/全屏/余量不足：返回 inner，渲染层按「向内推」处理。外延记录只为还原用。
let dockExt = null; // { win, delta }
function dockExtend(win, delta) {
  if (!win || win.isDestroyed() || !(delta > 0)) return { mode: "inner" };
  if (win.isMaximized() || win.isFullScreen() || win.isMinimized()) return { mode: "inner" };
  if (dockExt && dockExt.win === win) return { mode: "extended" };
  try {
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    if (b.x + b.width + delta > wa.x + wa.width) return { mode: "inner" };
    win.setBounds({ x: b.x, y: b.y, width: b.width + delta, height: b.height });
    dockExt = { win, delta };
    return { mode: "extended" };
  } catch {
    return { mode: "inner" };
  }
}
function dockRestore(win) {
  if (!dockExt || dockExt.win !== win || !win || win.isDestroyed()) {
    if (!dockExt || !dockExt.win || dockExt.win.isDestroyed()) dockExt = null;
    return false;
  }
  const { delta } = dockExt;
  dockExt = null;
  if (win.isMaximized() || win.isFullScreen()) return true;
  const b = win.getBounds();
  const [minW] = win.getMinimumSize();
  win.setBounds({ x: b.x, y: b.y, width: Math.max(minW || 0, b.width - delta), height: b.height });
  return true;
}
ipcMain.handle("win:dockExtend", (e, deltaPx) => dockExtend(BrowserWindow.fromWebContents(e.sender), Number(deltaPx)));
ipcMain.handle("win:dockRestore", (e) => dockRestore(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle("win:workbench", (_e, action) => workbenchWindow.control(String(action || "toggle")));
// 独立窗口建卡后：转告主窗口各页刷新（两个渲染进程的 eventBus 互不相通）
ipcMain.on("win:cardsChanged", (e) => {
  if (mainWindow && !mainWindow.isDestroyed() && e.sender !== mainWindow.webContents) {
    mainWindow.webContents.send("win:cardsRefresh");
  }
});

ipcMain.handle("library:list", () => listItems());

ipcMain.handle("library:createFromPaste", (_e, title, markdown) => {
  const md = String(markdown || "");
  if (!md.trim()) return null;
  return createFromPaste(String(title || ""), md);
});

ipcMain.handle("library:delete", (_e, id) => deleteItem(String(id)));

// v38（D35）：书籍语言属性——查词语言路由的书籍级信号
ipcMain.handle("library:setItemLang", (_e, id, lang) => dbModule.setLibraryItemLang(String(id), String(lang || "")));
ipcMain.handle("library:setItemTitle", (_e, id, title) => dbModule.setLibraryItemTitle(String(id), String(title ?? "")));
// D121 §1.1：书籍作者（空=未知）
ipcMain.handle("library:setItemAuthor", (_e, id, author) => dbModule.setLibraryItemAuthor(String(id), String(author ?? "")));

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
  const { title, markdown, toc, coverDataUrl, epubData, sourceName, author } = payload || {};
  if (!markdown || !String(markdown).trim()) return null;
  return createFromEpub(title, String(markdown), toc || [], coverDataUrl, epubData, sourceName, typeof author === "string" ? author : null);
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
    images,
    author: await docxAuthor(buf)
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

// ---------- M6-3（v30，D27）统一导入入口：单对话框多选 + 按扩展名路由 ----------
// 全部支持格式的扩展名（渲染层按扩展名决定路由到哪条管线）
const IMPORT_ALL_EXTENSIONS = ["epub", "pdf", "docx", "txt", "md", "markdown", "html", "htm", "mobi", "azw3", "azw", "fb2", "fbz", "cbz"];

ipcMain.handle("library:pickImportFiles", async () => {
  const result = await dialog.showOpenDialog({
    filters: [
      { name: "全部支持的阅读材料", extensions: IMPORT_ALL_EXTENSIONS },
      { name: "电子书", extensions: ["epub", "pdf", "mobi", "azw3", "azw", "fb2", "fbz", "cbz"] },
      { name: "文档", extensions: ["docx", "txt", "md", "markdown", "html", "htm"] }
    ],
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths.map((p) => ({ name: path.basename(p), path: p }));
});

// D-TEST-26：把「任意本地文件读」收窄为「只读用户在本会话里通过系统对话框选中的文件」。
// 集中劫持 showOpenDialog 记录返回值，避免逐个选择点散改（main.js 6 处 + dictStore 1 处）；
// 现有唯一生产者是 AddBookModal → pickImportFiles，所以这条白名单覆盖了全部合法用途。
const pickedReadAllowlist = new Set();
const _rawShowOpenDialog = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async (...args) => {
  const r = await _rawShowOpenDialog(...args);
  if (r && !r.canceled && Array.isArray(r.filePaths)) for (const f of r.filePaths) pickedReadAllowlist.add(path.resolve(f));
  return r;
};

// 渲染层解析用（epub/html）：只许读上面登记过的路径
ipcMain.handle("library:readFileBytes", (_e, filePath) => {
  const abs = path.resolve(String(filePath));
  if (!pickedReadAllowlist.has(abs)) return null;
  try {
    return new Uint8Array(fs.readFileSync(abs));
  } catch {
    return null;
  }
});

// HTML 建册（渲染层已解析出 markdown；主进程按路径读原文件入库）
ipcMain.handle("library:createFromHtml", (_e, payload) => {
  const { path: filePath, name, title, markdown } = payload || {};
  if (!markdown || !String(markdown).trim()) throw new Error("未能从该 HTML 文件中提取到正文内容");
  let buf = null;
  try {
    buf = filePath ? fs.readFileSync(String(filePath)) : null;
  } catch {
    /* 原文件读取失败不阻塞（仅影响备份留存） */
  }
  return dbModule.createImportedDoc({
    title: title || titleFromFilename(name),
    markdown: String(markdown),
    sourceType: "html",
    sourceName: name || null,
    originalName: "original.html",
    originalBuf: buf,
    images: []
  });
});

// 被动兼容电子书（MOBI/AZW3/FB2/CBZ）建册：原文件按原扩展名入库，内核直读
ipcMain.handle("library:createFromBookFile", (_e, payload) => {
  const { path: filePath, name, ext } = payload || {};
  if (!filePath) return null;
  const cleanExt = String(ext || path.extname(String(name || filePath)).replace(/^\./, "") || "bin").toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(cleanExt)) throw new Error("无法识别的文件扩展名");
  const buf = fs.readFileSync(String(filePath));
  return dbModule.createImportedDoc({
    title: titleFromFilename(name),
    markdown: "",
    sourceType: "ebook",
    sourceName: name || null,
    originalName: `original.${cleanExt}`,
    originalBuf: buf,
    images: []
  });
});

ipcMain.handle("library:readEbookFile", (_e, itemId) => dbModule.readEbookFile(String(itemId)));

ipcMain.handle("library:pickPdf", () => pickImportFile("pdf"));

// M6-2 修订（v28 PDF 原生阅读）：导入只存原文（original.pdf 落 assets + 建册），不再跑提纯。
// 扫描版判别改轻量规则：pdfjs 取文本层，全页无文本即拒绝（提纯函数 pdfToMarkdown 保留为全文检索备用）。
ipcMain.handle("library:createFromPdf", async (_e, payload) => {
  const { path: filePath, name } = payload || {};
  if (!filePath) return null;
  const buf = fs.readFileSync(String(filePath));
  let pages = 0;
  let emptyPages = 0;
  let pdfAuthor = null; // D121 §1.1：info.Author（trim，空→NULL）
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // pdf.js v6 无 PDFDocumentProxy.destroy（已移除），资源释放调 loadingTask.destroy()
    // 主进程（Node 环境）选 NodeBinaryDataFactory（fs.readFile）——必须传正斜杠普通路径 +
    // 结尾斜杠（getFactoryUrlProp 校验）；file:// 字符串会被 fs 当路径解析必然失败
    const pdfjsDir = path.join(__dirname, "..", "node_modules", "pdfjs-dist").replace(/\\/g, "/");
    const task = pdfjs.getDocument({
      data: new Uint8Array(buf),
      useWorkerFetch: false,
      isEvalSupported: false,
      cMapUrl: `${pdfjsDir}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfjsDir}/standard_fonts/`
    });
    const doc = await task.promise;
    pages = doc.numPages;
    try {
      const meta = await doc.getMetadata();
      const a = meta && meta.info && meta.info.Author;
      if (typeof a === "string" && a.trim()) pdfAuthor = a.trim();
    } catch {
      /* 元数据取不到即 NULL */
    }
    for (let i = 1; i <= pages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      if (!tc.items.some((it) => it.str && it.str.trim())) emptyPages++;
    }
    await task.destroy();
  } catch (e) {
    throw new Error(`无法解析该 PDF 文件：${e instanceof Error ? e.message : String(e)}`);
  }
  if (emptyPages === pages) {
    throw new Error("未在该 PDF 中提取到文本层——可能是扫描版/图片型 PDF。扫描版 OCR 暂不支持，请使用带文字层的 PDF。");
  }
  // documents.markdown 存空壳占位（阅读走原文件；占位供书架 excerpt/统计等读 markdown 的旧路径不崩）
  const created = dbModule.createImportedDoc({
    title: titleFromFilename(name),
    markdown: "",
    sourceType: "pdf",
    sourceName: name || null,
    originalName: "original.pdf",
    originalBuf: buf,
    images: [],
    author: pdfAuthor
  });
  return { ...created, pages, emptyPages };
});

ipcMain.handle("library:doc", (_e, itemId) => getDocument(String(itemId)));
ipcMain.handle("library:itemByDoc", (_e, docId) => getItemIdByDocumentId(String(docId)));

// 阅读内核（v20）：读取书架条目的原书文件（assets/<itemId>/original.epub），供 foliate 内核打开
ipcMain.handle("library:readBookFile", (_e, itemId) => dbModule.readBookFile(String(itemId)));

// M6-2 修订（v28 PDF 原生阅读）：读取 PDF 原文件（assets/<itemId>/original.pdf），供 pdf.js 内核打开
ipcMain.handle("library:readPdfFile", (_e, itemId) => dbModule.readPdfFile(String(itemId)));

// 外链：仅允许 http/https，交系统浏览器（渲染层永不自行导航）
ipcMain.handle("shell:openExternal", (_e, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    return shell.openExternal(url).then(() => true).catch(() => false);
  }
  return false;
});

ipcMain.handle("library:updateProgress", (_e, itemId, progress) => updateProgress(String(itemId), progress));

ipcMain.handle("extracts:create", (_e, payload) => createExtract(payload || {}));

// v48.23（D61 §6.8-11）：多段选择的集合运算 + 拼接文本——渲染层不 require electron/、
// 也不复制 annotationRange 的纯逻辑，只把 spans 原样过桥，由主进程用同一实现面算
// （与 createExtract 落库时的装配完全同源）。纯计算、零写库。
ipcMain.handle("extracts:spanSet", (_e, current, incoming, opts) => {
  const step = annotationRange.updateSpanSet(current, incoming, opts || {});
  return { spans: step.spans, action: step.action, text: annotationRange.buildSpanPayload(step.spans).text };
});

ipcMain.handle("extracts:listDue", () => listDueExtracts());
ipcMain.handle("extracts:listAll", () => listAllExtracts());

ipcMain.handle("extracts:get", (_e, id) => getExtract(String(id)));
// v48.23（D61 §6.8-11）：层级链（面包屑点击跳转要 id；getExtract 自带的 chain 只有文本前缀）
ipcMain.handle("extracts:chain", (_e, id) => getExtractChain(String(id)));

ipcMain.handle("extracts:postpone", (_e, id) => postponeExtract(String(id)));

// v48.22（D58 §6.8）：摘录写 API + 引擎切换 + 只读用量 + 跨类撤销。
// 写路径纪律沿用 §4.4.9：BEGIN/COMMIT → COMMIT 后 persist → IPC 成功，三者齐才算成功；
// 失败一律以 reject 上抛，渲染层按既有「保存失败横幅 + 重试」处理，禁止静默降级。
ipcMain.handle("extracts:postponeDays", (_e, id, days) => postponeExtractDays(String(id), days));
// v48.22（D58 §6.8-4）：写路径后置一次「过期即刷新」（只在实验引擎生效时真正发起）
const extractWrite = (fn) => (...args) => {
  const out = fn(...args);
  maybeRefreshAiRerank();
  return out;
};
ipcMain.handle("extracts:advance", extractWrite((_e, id, now) => advanceExtract(String(id), now)));
ipcMain.handle("extracts:update", (_e, id, patch) => updateExtract(String(id), patch || {}));
ipcMain.handle("extracts:setPriority", (_e, id, priority) => setExtractPriority(String(id), priority));
ipcMain.handle("extracts:setStatus", extractWrite((_e, id, status, detail, opType) =>
  setExtractStatus(String(id), String(status), detail || null, opType ? String(opType) : undefined)
));
ipcMain.handle("extracts:delete", (_e, id) => deleteExtract(String(id)));
ipcMain.handle("extracts:batch", extractWrite((_e, op, ids, payload) => batchExtractOps(String(op), ids, payload)));
ipcMain.handle("extracts:switchEngine", extractWrite((_e, to, from) => switchExtractEngine(to, from)));

// v48.22（D58 §6.4.1 E1）：AI 重排（到期批 → 模型 → 本地裁决 → 写缓存；缓存由会话队列同步读取）。
// 任何失败都不影响主流程：会话队列在无缓存/指纹不符时用本地因子序。
async function runExtractRerank() {
  const due = listDueExtracts();
  if (due.length === 0) return { ok: false, usedAI: false, reason: "当前没有到期的摘录" };
  const tpl = getPromptTemplate("extract-rerank");
  const sys = typeof tpl === "string" ? tpl : tpl && tpl.content;
  if (!sys) return { ok: false, usedAI: false, reason: "未播种 extract-rerank 提示词" };
  const cfg = getAIConfig();
  if (cfg.preset !== "local" && !cfg.apiKey) return { ok: false, usedAI: false, reason: "未配置 AI Key（保持本地因子序）" };
  const callAI = async ({ candidates }) => {
    const reply = await mindmapChat({ system: sys, user: JSON.stringify({ candidates }), temperature: 0.1 });
    return reply.text;
  };
  const { items, usedAI, issues } = await rankWithAI(due, Date.now(), callAI);
  if (usedAI) {
    saveAiRerank(
      rerankFingerprint(due),
      items.filter((e) => e.aiReason).map((e) => ({ id: e.id, reason: e.aiReason }))
    );
  }
  return { ok: true, usedAI, count: items.length, issues };
}

ipcMain.handle("extracts:rerankNow", () => runExtractRerank());

/** 写路径后的后台刷新：仅在实验引擎生效且缓存过期时触发一次（绝不阻塞主流程） */
function maybeRefreshAiRerank() {
  try {
    if (getActiveExtractEngine() !== "ai-next-extract") return;
    const due = listDueExtracts();
    if (due.length === 0) return;
    const cache = readAiRerank();
    if (cache && cache.fingerprint === rerankFingerprint(due)) return;
    void runExtractRerank().catch(() => {});
  } catch {
    /* 后台刷新失败不影响主流程 */
  }
}
ipcMain.handle("limits:usage", (_e, now) => getDailyUsage(now));
ipcMain.handle("limits:state", (_e, now) => getLimitsState(now));
ipcMain.handle("limits:validate", (_e, patch) => validateLimits(patch));
ipcMain.handle("session:queue", (_e, now, opts) => computeSessionQueue(now, opts || {}));
ipcMain.handle("session:counts", (_e, now, opts) => computeCardCounts(now, opts || {}));
ipcMain.handle("undo:last", () => undoLast());
ipcMain.handle("undo:info", () => getUndoInfo());
ipcMain.handle("library:setPriority", (_e, itemId, priority) => setLibraryItemPriority(String(itemId), priority));

// ---------- 卡片 / FSRS / Leech / AI 制卡 ----------
ipcMain.handle("cards:create", (_e, card) => createCard(card || {}));
ipcMain.handle("cards:update", (_e, card) => updateCard(card || {}));
ipcMain.handle("cards:batch", (_e, op, ids, payload) => batchCardOps(String(op), ids, payload));
// v48.60（D101，§4.1）：标签写入（渲染层算好每卡终值，主进程只存储）与词表（只读派生）
ipcMain.handle("cards:setTags", (_e, items) => setCardTags(items));
ipcMain.handle("cards:listTags", () => listCardTags());
ipcMain.handle("cards:get", (_e, id) => getCard(String(id)));
// v48.61（D103，D94 设计稿 §3.2）：生成信息区只读 join（card + 批次 + 提示词 + card_issues；零写路径）
ipcMain.handle("cards:genInfo", (_e, id) => dbModule.getCardGenInfo(String(id)));
ipcMain.handle("cards:listDue", () => listDueCards());
// v34（M12，§4.2-20）：今日队列视图（放行卡 + 同源暂缓清单）；now 可注入供测试
ipcMain.handle("cards:todayQueue", (_e, now) => computeTodayQueue(Number.isFinite(now) ? Number(now) : undefined));
ipcMain.handle("cards:listAll", () => listAllCards());
// v48.67（D111 §6.8-6 数据通道）：主进程过滤 + 分页取数——meta/ids 轻量行集 + 行窗口按需取 +
// 同源组行 + 今日暂缓 id（浏览器侧退役全量 listAll 消费；契约见 GUIDE §6.8-6）
ipcMain.handle("cards:listMeta", () => dbModule.getCardBrowserMeta());
ipcMain.handle("cards:queryIds", (_e, query) => dbModule.queryCardBrowserIds(query));
ipcMain.handle("cards:getWindow", (_e, ids) => dbModule.getCardsWindow(ids));
ipcMain.handle("cards:siblingGroup", (_e, key) => dbModule.listCardsBySibling(key));
ipcMain.handle("cards:deferredToday", (_e, now) => dbModule.listDeferredToday(now));
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
ipcMain.handle("stats:timeline", (_e, opts) => getStatsTimeline(opts && typeof opts === "object" ? opts : {}));
// ---------- v48.85（D129，§4.2-22）：成长反馈只读派生（M13 GF-1 数据面；§4.17-3 只读不变量——零写路径、
// 零事件推送；渲染层在评分成功边界之后异步调用，失败 catch 静默，绝不影响评分/跳过/删除/Undo） ----------
// 三条通道兜底 catch（复审 P2a 采纳）：db 出口抛错时降级返回设计稿 §3.3 的 {enabled:false}
// （渲染层按「成长反馈不可用」静默隐藏——与设置关闭短路同形，渲染层已按该形状处理，不新增契约），
// 防未处理 rejection；设置关闭的正常短路返回体经 try 正常透传，兜底不改变其语义。
ipcMain.handle("growth:afterReview", (_e, cardId, now) => {
  try {
    return dbModule.getGrowthAfterReview(String(cardId ?? ""), Number.isFinite(now) ? Number(now) : undefined);
  } catch (err) {
    console.error("[growth:afterReview] 派生失败，降级返回 {enabled:false}（评分流程不受影响）:", err);
    return { enabled: false };
  }
});
ipcMain.handle("growth:sessionSummary", (_e, fromTs, now) => {
  try {
    return dbModule.getGrowthSessionSummary(Number(fromTs) || 0, Number.isFinite(now) ? Number(now) : undefined);
  } catch (err) {
    console.error("[growth:sessionSummary] 派生失败，降级返回 {enabled:false}:", err);
    return { enabled: false };
  }
});
ipcMain.handle("growth:overview", (_e, opts, now) => {
  try {
    return dbModule.getGrowthOverview(opts && typeof opts === "object" ? opts : {}, Number.isFinite(now) ? Number(now) : undefined);
  } catch (err) {
    console.error("[growth:overview] 派生失败，降级返回 {enabled:false}:", err);
    return { enabled: false };
  }
});
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
// D121 §1.2：卡片辨析链接
ipcMain.handle("card-links:add", (_e, input) => dbModule.addCardLink(input || {}));
ipcMain.handle("card-links:update", (_e, id, patch) => dbModule.updateCardLink(String(id), patch || {}));
ipcMain.handle("card-links:listForCard", (_e, cardId) => dbModule.listCardLinksForCard(String(cardId)));
ipcMain.handle("batches:create", (_e, batch) => createAIGenBatch(batch || {}));
ipcMain.handle("batches:setStatus", (_e, id, status) => setAIGenBatchStatus(String(id), String(status)));
// A-10（审计）：补两个只读出口，让关窗后已付费的草稿能被取回
ipcMain.handle("batches:get", (_e, id) => getAIGenBatch(String(id)));
ipcMain.handle("batches:list", (_e, opts) => listAIGenBatches(opts || {}));
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

// D122 阅读器「截图」：截取**发起请求的窗口**内的视口矩形（CSS px，webContents.capturePage 按 DIP 取）。
// 能截到 foliate iframe / PDF canvas 这类渲染层 DOM 读不到像素的内核；矩形夹进窗口内容区，越界/空 ⇒ null。
ipcMain.handle("reader-capture:region", async (e, rect) => {
  try {
    const wc = e.sender;
    const win = BrowserWindow.fromWebContents(wc);
    if (!win) return null;
    const [cw, ch] = win.getContentSize();
    const x = Math.max(0, Math.floor(Number(rect && rect.x) || 0));
    const y = Math.max(0, Math.floor(Number(rect && rect.y) || 0));
    const w = Math.min(cw - x, Math.floor(Number(rect && rect.width) || 0));
    const h = Math.min(ch - y, Math.floor(Number(rect && rect.height) || 0));
    if (w < 8 || h < 8) return null;
    const img = await wc.capturePage({ x, y, width: w, height: h });
    if (!img || img.isEmpty()) return null;
    return img.toDataURL();
  } catch {
    return null;
  }
});

// D123 修订 3：制卡台「图片挖空 → 截图」——整块屏幕任意内容框选（遮罩窗口），返回 PNG dataURL / null
ipcMain.handle("screen-capture:start", (e) => screenCapture.start(e.sender));

// ---------- M2 数据备份与恢复（§9.1 M2） ----------
const backupOpts = () => ({
  flush: () => dbModule.persistDb(),
  counts: dbModule.getBackupCounts(),
  // 批次 C（D-TEST-18）：已软删书的 id 交给备份侧，打包时跳过它们的 assets 目录。
  // backup.js 不 require db 层（它的依赖注入一直是 opts.*），所以在这里塞进来。
  deletedItemIds: new Set(dbModule.listDeletedItemIds()),
  appVersion: app.getVersion(),
  // D137（§3.6，WAL sidecar 陷阱 M2 对策①）：三库备份改走 db.backup() 在线快照——
  // WAL 下裸 readFileSync 可能缺最近提交且无事务一致性保证。dictionary.db 950MB 级为页拷贝，
  // 速度与内存特性优于旧裸读（learner.db 派生数据不进备份清单）。
  snapshotLibrary: (dest) => dbModule.snapshotTo(dest),
  snapshotDict: (dest) => dictDb.snapshotTo(dest)
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
// §7.5「渲染层不持有明文 Key」：解密只发生在主进程，返回体剥掉 apiKey
// （ai:setConfig 早就是 `const { apiKey, ...safe }` 的剥法，这里对齐；hasKey/preset/baseUrl/model 照旧）。
ipcMain.handle("ai:getConfig", () => {
  const { apiKey, ...safe } = getAIConfig();
  return safe;
});
ipcMain.handle("ai:setConfig", (_e, partial) => setAIConfig(partial || {}));
ipcMain.handle("ai:test", () => testConnection());
ipcMain.handle("ai:listModels", () => listModels());
// 本地运行时探测（v48.68 / D112）：Ollama/LM Studio 端口探针，永不抛错（未命中返回 detected:false）
ipcMain.handle("ai:detectLocal", () => detectLocalRuntime());

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
// v48.74（D118 §3④）：AIGateway cancel 契约（§3 容器清单 stream/cancel）在 IPC 层落地——
// 每请求 AbortController 入注册表传入 chatStream（abortSignal 形参既有，传输层零改动）；
// ai:abort 按 requestId 取消（停止按钮/新一轮运行取消旧流）；结算（resolve/reject）即移除。
const aiChatAborts = new Map();
ipcMain.on("ai:chat", (e, requestId, messages, temperature) => {
  const send = (m) => {
    if (!e.sender.isDestroyed()) e.sender.send("ai:stream", requestId, m);
  };
  const controller = new AbortController();
  aiChatAborts.set(requestId, controller);
  try {
    chatStream({ messages, temperature, abortSignal: controller.signal }, send)
      .catch((err) => {
        send({ error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => aiChatAborts.delete(requestId));
  } catch (err) {
    aiChatAborts.delete(requestId);
    // 同步抛出（如未配 Key）也走流式错误，绝不炸主进程
    send({ error: err instanceof Error ? err.message : String(err), code: err?.code });
  }
});
ipcMain.on("ai:abort", (_e, requestId) => {
  const controller = aiChatAborts.get(requestId);
  if (!controller) return;
  aiChatAborts.delete(requestId);
  // abortErrorOf 契约：reason 带机读 code 才被透传（cancelled=用户取消，无 retriable ⇒ 不触发 §3.7 重试）
  const reason = new Error("已手动停止本轮 AI 生成");
  reason.code = "cancelled";
  controller.abort(reason);
});

// ---------- M7 词典（v32，D31）：在线代理 + 本地查词 + 下载/导入 + 缓存 ----------
// 在线走主进程 net.fetch（继承系统代理；dictionaryapi.dev 实测直连超时，需代理兜底；
// Jisho 非官方 API 已下线移除，日语由 JMDict 本地包承担）。词条存独立 dictionary.db（dictDb）。
const dictDb = require("./dictDb");

ipcMain.handle("dict:lookupOnline", async (_e, providerId, word) => {
  return dictStore.lookupOnline(String(providerId), String(word));
});

ipcMain.handle("dict:lookupLocal", async (_e, word) => {
  const sources = dbModule.listDictSources();
  const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.id));
  const nameById = new Map(sources.map((s) => [s.id, s.name]));
  // v38（D35）：来源词典语言随命中返回，渲染层 pickLocalHit 按语言优先取命中
  const langById = new Map(sources.map((s) => [s.id, s.lang || ""]));
  const rows = (await dictDb.lookup(String(word))).filter((r) => enabled.has(r.source_id));
  return rows.map((r) => {
    // ECDICT 的 pos 列实为词频码（如「j:93/n:7」）——仅保留干净词性（n./v./adj. 等），垃圾码不入弹窗与卡面
    const posRaw = String(r.pos || "").trim();
    const cleanPos = /^[a-z]+(\.[a-z]+)*$/i.test(posRaw) ? posRaw : "";
    return {
      word: r.headword,
      reading: null,
      pronunciation: r.phonetic || null,
      audio: null,
      definitions: String(r.html || "").split(/\n|\\n/).filter(Boolean).slice(0, 6),
      partOfSpeech: cleanPos ? [cleanPos] : [],
      examples: [],
      source: nameById.get(r.source_id) || "本地词典",
      sourceLanguage: langById.get(r.source_id) || "",
      language: "",
      normalizedWord: String(word),
      capabilities: ["definition", ...(r.phonetic ? ["pronunciation"] : [])],
    };
  });
});

ipcMain.handle("dict:sources", () => dbModule.listDictSources());
ipcMain.handle("dict:toggleSource", (_e, id, enabled) => dbModule.setDictSourceEnabled(String(id), !!enabled));
ipcMain.handle("dict:removeSource", async (_e, id) => {
  await dictDb.removeSource(String(id));
  return dbModule.removeDictSource(String(id));
});
ipcMain.handle("dict:cacheGet", (_e, providerId, language, word) => dbModule.getDictCache(String(providerId), String(language), String(word)));
ipcMain.handle("dict:cacheSet", (_e, providerId, language, word, entry) => dbModule.setDictCache(String(providerId), String(language), String(word), entry));

// 词典文件/目录 → 词条行（下载与手动导入共用路由）：.csv(ECDICT)/.u8(CC-CEDICT)/.gz(嗅探：kaikki JSONL/JMdict XML/ECDICT CSV)
// /.zip(内含 db/u8/csv)/.db/.sqlite(jamdict schema 探测 → ECDICT)/.jsonl(kaikki)/StarDict 三件套目录/.dsl
async function importDictRowsFromPath(p, onScanProgress = null) {
  const stat = fs.statSync(p);
  const lower = p.toLowerCase();
  if (stat.isDirectory()) {
    return { rows: dictStore.starDictRowsFromDir(p), format: "stardict" };
  }
  const ext = path.extname(lower);
  if (ext === ".csv") {
    return { rows: dictStore.parseEcdictCsv(fs.readFileSync(p, "utf-8")), format: "ecdict-csv" };
  }
  if (ext === ".u8") {
    return { rows: dictStore.parseCedictText(fs.readFileSync(p, "utf-8")), format: "cedict" };
  }
  if (ext === ".jsonl") {
    // v38（D35）：kaikki zhwiktionary 原始提取（裸 jsonl；.jsonl.gz 落 .gz 分支嗅探）
    return { rows: dictStore.parseKaikkiJsonlFile(p, onScanProgress), format: "kaikki-jsonl" };
  }
  if (ext === ".gz") {
    // v38（D35）：kaikki 原始包 216MB gz 解压后 GB 级——先小样嗅探，kaikki 走流式，其余才整体解压
    const head = dictStore.sniffGzHead(p);
    if (head.startsWith("{") && head.includes('"lang_code"')) {
      return { rows: dictStore.parseKaikkiJsonlFile(p, onScanProgress), format: "kaikki-jsonl" };
    }
    const text = dictStore.gunzipBestEffort(fs.readFileSync(p)).toString("utf-8");
    if (text.includes("<JMdict>") || (text.startsWith("<?xml") && text.includes("<entry>"))) {
      return { rows: dictStore.parseJmdictXml(text), format: "jmdict-xml" };
    }
    return { rows: dictStore.parseEcdictCsv(text), format: "ecdict-csv" };
  }
  if (ext === ".zip") {
    const JSZip = require("jszip");
    const zip = await JSZip.loadAsync(fs.readFileSync(p));
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    // 优先级：sqlite(ECDICT 完整版/jamdict-cn) > u8(CC-CEDICT) > csv > stardict 三件套散件不支持（zip 内不成目录）
    const dbN = names.find((n) => /\.(db|sqlite)$/i.test(n));
    if (dbN) {
      const bytes = await zip.files[dbN].async("nodebuffer");
      return await sqliteDictRows(bytes);
    }
    const u8N = names.find((n) => /\.u8$/i.test(n));
    if (u8N) {
      return { rows: dictStore.parseCedictText(await zip.files[u8N].async("string")), format: "cedict" };
    }
    const csvN = names.find((n) => /\.csv$/i.test(n));
    if (csvN) {
      return { rows: dictStore.parseEcdictCsv(await zip.files[csvN].async("string")), format: "ecdict-csv" };
    }
    throw new Error("zip 内未找到可识别的词典文件（.db/.u8/.csv）");
  }
  if (ext === ".db" || ext === ".sqlite") {
    return await sqliteDictRows(fs.readFileSync(p));
  }
  if (ext === ".dsl") {
    let text = "";
    try {
      text = fs.readFileSync(p, "utf-8");
    } catch {
      text = fs.readFileSync(p, "utf16le");
    }
    return { rows: dictStore.parseDsl(text), format: "dsl" };
  }
  throw new Error("不支持的词典格式（支持 .csv/.u8/.gz/.jsonl/.zip/.db/.dsl/StarDict 目录）");
}

// v38（D35）：sqlite 词典库路由——jamdict schema（Entry/SenseGloss，jamdict-cn 日→中）优先，其余按 ECDICT（word/translation）
async function sqliteDictRows(bytes) {
  const kind = await dictStore.detectSqliteKind(bytes);
  if (kind === "jamdict") return { rows: dictStore.iterJamdictSqlite(bytes), format: "jamdict-sqlite" };
  return { rows: dictStore.iterEcdictSqlite(bytes), format: "ecdict-sqlite" };
}

// 词条入库 + 来源登记（按名 upsert：重复下载/更新复用同一行，旧空行自愈）。
// 先建索引、count>0 才登记来源——解析器为 async generator 免整体物化，0 词条不产生假来源（v32 修复）。
async function indexDictSource({ name, format, path: filePath, url, rows, onProgress }) {
  const existing = dbModule.listDictSources().find((s) => s.name === name);
  const id = existing ? existing.id : crypto.randomUUID();
  const { count, capped } = await dictDb.insertRows(id, rows, 3500000, onProgress);
  if (count > 0) {
    dbModule.upsertDictSource({ id, name, format, path: filePath, url: url || null, enabled: true, entryCount: count });
  }
  return { id, name, format, count, capped };
}

ipcMain.handle("dict:pickFile", () => dictStore.pickDictFile());
ipcMain.handle("dict:importFile", async (_e, filePath) => {
  const p = String(filePath || "");
  if (!p) return null;
  const { rows, format } = await importDictRowsFromPath(p);
  const r = await indexDictSource({ name: path.basename(p), format, path: p, rows });
  if (r.count === 0) throw new Error("未能从该文件中解析出词条");
  return { ...r, parsed: true };
});

// 一键下载：直链（目录档已实测核验）→ 落盘 userData/dicts → 流式解析+建索引（进度实时上报）→ count>0 登记来源；
// 状态语义：done=已建索引可查；saved=文件已下载但 0 词条（不登记来源，按钮保持可重试）
ipcMain.handle("dict:download", async (e, item) => {
  const { id, url, mirrorUrl, name } = item || {};
  if (!url) throw new Error("该词典暂无一键下载地址");
  const send = (pct, state, count) => {
    try {
      if (!e.sender.isDestroyed()) e.sender.send("dict:downloadProgress", { id, progress: pct, state, count });
    } catch { /* 忽略 */ }
  };
  const urls = [url, mirrorUrl].filter(Boolean);
  let lastErr = null;
  for (const u of urls) {
    try {
      send(2, "downloading");
      const res = await net.fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const dir = path.join(app.getPath("userData"), "dicts", String(id));
      fs.mkdirSync(dir, { recursive: true });
      const filename = `source${path.extname(new URL(u).pathname) || ".bin"}`;
      const file = path.join(dir, filename);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buf);
      send(55, "indexing", 0);
      // v38：kaikki 原始包扫描阶段（GB 级解压逐行）以行数回报进度，避免长时间 0 进度像卡死
      const { rows, format } = await importDictRowsFromPath(file, (lines) => send(55, "indexing", lines));
      const r = await indexDictSource({
        name: name || id, format, path: file, url: u, rows,
        onProgress: (count) => send(55, "indexing", count),
      });
      if (r.count === 0) {
        send(100, "saved", 0);
        return { ...r, file, parsed: false };
      }
      send(100, r.capped ? "done-capped" : "done", r.count);
      return { ...r, file, parsed: true };
    } catch (err) {
      lastErr = err;
    }
  }
  send(0, "error");
  throw new Error(`下载失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}（可复制链接到浏览器手动下载后再「本地导入」）`);
});

// ---------- v36（M8-A，§6.5 / D34）：日记与快速记录 ----------
// 写入一律经主进程（sql.js 单实例）；写入后广播 journal:changed 给其它窗口（日记页实时刷新）。
// 快捷记录草稿的「内存即时写 + 磁盘节流」由 quickCapture 统一编排（本项目唯一持久化例外，见 D34）。

// 主窗口前置（最小化则还原）：全局快捷键与「添加材料」入口共用
function focusMainWindow() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win) return null;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function sendToMainWindow(channel, payload) {
  const win = focusMainWindow();
  if (!win) return false;
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", () => win.webContents.send(channel, payload));
  else win.webContents.send(channel, payload);
  return true;
}

ipcMain.handle("journal:list", (_e, filter) => dbModule.listJournalEntries(filter || {}));
ipcMain.handle("journal:dates", (_e, opts) => dbModule.listJournalDates(opts || {}));

// 某日视图（捕获窗口用）：今日已记条数 + 全局未发送草稿（entryDate 可能不是今天=跨日草稿）
ipcMain.handle("journal:day", (_e, date) => {
  const day = String(date || journalDateOf(Date.now()));
  const { entries } = dbModule.listJournalEntries({ from: day, to: day, limit: 1000 });
  const sent = entries.filter((x) => !x.isDraft);
  return { date: day, count: sent.length, entries: sent, draft: dbModule.getJournalDraft() };
});

ipcMain.handle("journal:draft", () => dbModule.getJournalDraft());

// 草稿续写（输入中，防抖调用）：内存库即时写 + 磁盘节流
ipcMain.handle("journal:draftSave", (e, contentMarkdown) => {
  const entry = quickCapture.saveDraft(String(contentMarkdown ?? ""), e.sender);
  return { ok: true, entry };
});

// 发送：定格为日记里的一条（即时落盘 + 广播）
ipcMain.handle("journal:draftSend", (e, contentMarkdown) => {
  const entry = quickCapture.sendDraft(String(contentMarkdown ?? ""), e.sender);
  memoryTidy.notifyJournalChanged(memoryCtx()); // v45（M14-UM1）：草稿翻正为正式条目 → 防抖整理
  return { ok: true, entry };
});

// 日记页：新建 / 编辑 / 删除（都是显式动作 → 即时落盘）
ipcMain.handle("journal:create", (e, payload) => {
  const p = payload || {};
  const entry = dbModule.createJournalEntry({
    contentMarkdown: p.contentMarkdown,
    source: p.source || "app",
    entryDate: p.entryDate
  });
  quickCapture.notifyJournalChanged({ kind: "created", entryId: entry.id, entryDate: entry.entryDate }, e.sender);
  memoryTidy.notifyJournalChanged(memoryCtx()); // v45（M14-UM1）：日记变更 → 防抖整理
  return entry;
});

ipcMain.handle("journal:update", (e, id, contentMarkdown) => {
  const entry = dbModule.updateJournalEntry(String(id), contentMarkdown);
  quickCapture.notifyJournalChanged({ kind: "updated", entryId: String(id) }, e.sender);
  memoryTidy.notifyJournalChanged(memoryCtx());
  return entry;
});

ipcMain.handle("journal:delete", (e, id) => {
  dbModule.deleteJournalEntry(String(id));
  quickCapture.notifyJournalChanged({ kind: "deleted", entryId: String(id) }, e.sender);
  memoryTidy.notifyJournalChanged(memoryCtx());
  return true;
});

ipcMain.handle("journal:flush", () => quickCapture.flushJournal());

// ---------- v40（K1，D37 / §4.2-23）：知识地基 knowledge:*（KnowledgeBase 唯一读写面） ----------
ipcMain.handle("knowledge:listPoints", (_e, filter) => dbModule.listKnowledgePoints(filter || {}));
// D158：只读——把若干知识点 id 展开为归并族并集（合同 §6.8-5：匹配集 = 所选知识点的归并族）
ipcMain.handle("knowledge:resolveFamilies", (_e, ids) => {
  const list = Array.isArray(ids) ? ids.filter((x) => typeof x === "string" && x !== "") : [];
  const out = new Set(list);
  for (const id of list) {
    const fam = dbModule.resolveKpFamily(id);
    for (const x of fam ?? []) out.add(String(x));
  }
  return [...out];
});
ipcMain.handle("knowledge:getPoint", (_e, id) => dbModule.getKnowledgePoint(String(id)));
ipcMain.handle("knowledge:createPoint", (_e, payload) => dbModule.createKnowledgePoint(payload || {}));
ipcMain.handle("knowledge:updatePoint", (_e, id, patch) => dbModule.updateKnowledgePoint(String(id), patch || {}));
ipcMain.handle("knowledge:mergePoints", (_e, sourceId, targetId) => dbModule.mergeKnowledgePoints(String(sourceId), String(targetId)));
ipcMain.handle("knowledge:unmergePoint", (_e, id) => dbModule.unmergeKnowledgePoint(String(id)));
ipcMain.handle("knowledge:listRelations", (_e, filter) => dbModule.listKnowledgeRelations(filter || {}));
ipcMain.handle("knowledge:createRelation", (_e, payload) => dbModule.createKnowledgeRelation(payload || {}));
ipcMain.handle("knowledge:deleteRelation", (_e, id) => dbModule.deleteKnowledgeRelation(String(id)));
ipcMain.handle("knowledge:listRefs", (_e, kpId) => dbModule.listKnowledgeExternalRefs(String(kpId)));
ipcMain.handle("knowledge:createRef", (_e, payload) => dbModule.createKnowledgeExternalRef(payload || {}));
ipcMain.handle("knowledge:deleteRef", (_e, id) => dbModule.deleteKnowledgeExternalRef(String(id)));
ipcMain.handle("knowledge:listProposals", (_e, filter) => dbModule.listKnowledgeProposals(filter || {}));
ipcMain.handle("knowledge:resolveProposal", (_e, id, accept, overridePayload) => dbModule.resolveKnowledgeProposal(String(id), !!accept, overridePayload || null));
ipcMain.handle("knowledge:migrationSuggestions", () => dbModule.buildKnowledgeMigrationSuggestions());

// v41（K2-A，D38）：AI 抽取归一与关系——主进程只做输入装配与裁决（AI 调用由渲染层编排）
ipcMain.handle("knowledge:kpClusters", () => dbModule.listKpClusters());
ipcMain.handle("knowledge:kpExtractPrepare", (_e, opts) => dbModule.buildKpExtractionInput(opts || {}));
ipcMain.handle("knowledge:kpExtractApply", (_e, rawExtraction, rawRelations) => dbModule.applyKpExtraction(rawExtraction, rawRelations));
ipcMain.handle("knowledge:acceptAllPending", () => dbModule.acceptAllPendingKnowledgeProposals());

// v43（K2-B）：KnowledgeLint K4/K7/K8 报告型检查（只读，非阻断）
ipcMain.handle("knowledge:lint", () => dbModule.runKnowledgeLint());

// ---------- v48.80（D124 / 设计稿 §11.1）：学习者模型 learner:*（16 个通道；除 status 外每个
// handler 第一行检查总开关，关闭时立即返回 {ok:false, disabled:true}，不读写任何库） ----------
const learnerRefresh = require("./learnerRefresh");
const learnerDb = require("./learnerDb");

const learnerDisabled = () => ({ ok: false, disabled: true });

// PDF 页文本抽取（设计稿 §6.1）：复制 library:createFromPdf 的 pdfjs 加载方式，按页取文本层
async function extractPdfPagesForLearner(itemId) {
  const buf = dbModule.readPdfFile(String(itemId));
  if (!buf) return null;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjsDir = path.join(__dirname, "..", "node_modules", "pdfjs-dist").replace(/\\/g, "/");
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useWorkerFetch: false,
    isEvalSupported: false,
    cMapUrl: `${pdfjsDir}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${pdfjsDir}/standard_fonts/`
  });
  try {
    const doc = await task.promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push(tc.items.map((it) => it.str).join(" "));
    }
    return out;
  } finally {
    await task.destroy();
  }
}
learnerRefresh.init({ extractPdfPages: extractPdfPagesForLearner });

ipcMain.handle("learner:status", () => {
  if (!learnerRefresh.learnerEnabled()) return { enabled: false };
  return learnerRefresh.statusForIpc();
});
ipcMain.handle("learner:refresh", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.refresh(opts && typeof opts === "object" ? opts : {});
});
ipcMain.handle("learner:recommend", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.recommendFlow(opts && typeof opts === "object" ? opts : {});
});
ipcMain.handle("learner:feedback", (_e, payload) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  const p = payload && typeof payload === "object" ? payload : {};
  return dbModule.addRecFeedback({
    recRunId: p.runId,
    itemKey: p.itemKey,
    kind: p.kind,
    libraryItemId: p.libraryItemId,
    action: p.action,
    auto: false
  });
});
ipcMain.handle("learner:listTracks", async () => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  const snapshot = await learnerRefresh.buildSnapshot();
  const tracks = learnerRefresh.buildTrackSummaries(snapshot, {}, false, snapshot.proposals || []);
  const effective = tracks.filter((t) => !t.isProposal);
  const overrides = new Map((snapshot.overrides || []).map((o) => [`${o.trackId}:${o.libraryItemId}`, o.member]));
  const assigned = new Set();
  const trackMaterials = []; // 轨道 → 归属材料明细（TracksDialog 展开区 + 「移出」用）
  for (const m of snapshot.materials || []) {
    for (const t of effective.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      // 同一份材料可同属多个轨道（设计稿 §3），每条命中轨道都要记录——展开区与「已归属」标注才完整
      if (require("./lmRecommend").resolveMembership(t, m, overrides)) {
        assigned.add(String(m.id));
        trackMaterials.push({ trackId: t.id, libraryItemId: String(m.id), title: String(m.title || ""), lang: String(m.lang || "") });
      }
    }
  }
  const unassigned = [];
  for (const m of snapshot.materials || []) {
    if (!assigned.has(String(m.id))) unassigned.push({ libraryItemId: String(m.id), title: String(m.title || ""), lang: String(m.lang || "") });
  }
  return { tracks, proposals: snapshot.proposals || [], unassigned, trackMaterials };
});
ipcMain.handle("learner:saveTrack", (_e, track) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return dbModule.saveLearnerTrack(track || {});
});
ipcMain.handle("learner:deleteTrack", (_e, id) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return dbModule.deleteLearnerTrack(String(id));
});
ipcMain.handle("learner:setTrackMaterial", (_e, payload) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  const p = payload && typeof payload === "object" ? payload : {};
  return dbModule.setTrackMaterial(String(p.trackId || ""), String(p.libraryItemId || ""), p.member === null || p.member === undefined ? null : Number(p.member));
});
ipcMain.handle("learner:kpLevels", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.kpLevelsFor(opts || {});
});
ipcMain.handle("learner:logEvent", (_e, evt) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  const e = evt && typeof evt === "object" ? evt : {};
  return dbModule.addLearningEvent({
    kind: e.kind,
    ts: e.ts,
    lang: e.lang,
    library_item_id: e.libraryItemId,
    unit_id: e.unitId,
    kp_id: e.kpId,
    payload: e.payload
  });
});
ipcMain.handle("learner:unitText", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.unitTextFor(opts || {});
});
ipcMain.handle("learner:contextReel", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.contextReelFor(opts || {});
});
ipcMain.handle("learner:sentenceMine", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.sentenceMineFor(opts || {});
});
ipcMain.handle("learner:placementSample", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.placementSampleFor(opts || {});
});
ipcMain.handle("learner:lexStats", (_e, opts) => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  return learnerRefresh.lexStatsFor(opts || {});
});
ipcMain.handle("learner:rebuild", async () => {
  if (!learnerRefresh.learnerEnabled()) return learnerDisabled();
  await learnerDb.reset();
  return learnerRefresh.refresh({ force: true });
});

// ---------- v40（M8-B，§4.2-24）：洞察 insights:* + Personal Meaning meaning:* ----------
// InsightEngine 编排在渲染层（同制卡管线：主进程不拼提示词），主进程只做：Evidence Package 装配、
// runs 事实记录、反馈落表；LLM 流式走既有 ai:chat/ai:stream 通道（Key 不进渲染层）。
function broadcastInsightChanged(excludeSender) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (excludeSender && w.webContents.id === excludeSender.id) continue;
    w.webContents.send("insight:changed");
  }
}

ipcMain.handle("insights:buildPackage", (_e, opts) => dbModule.buildEvidencePackage(opts || {}));
ipcMain.handle("insights:create", (_e, payload) => dbModule.createInsightRun(payload || {}));
ipcMain.handle("insights:complete", (e, id, extra) => {
  const run = dbModule.setInsightRunStatus(String(id), "done", extra || {});
  broadcastInsightChanged(e.sender);
  return run;
});
ipcMain.handle("insights:fail", (e, id, errorText) => {
  const run = dbModule.setInsightRunStatus(String(id), "failed", { errorText: String(errorText || "洞察失败") });
  broadcastInsightChanged(e.sender);
  return run;
});
ipcMain.handle("insights:get", (_e, id) => dbModule.getInsightRun(String(id)));
ipcMain.handle("insights:list", (_e, opts) => dbModule.listInsightRuns(opts || {}));
ipcMain.handle("insights:feedback", (e, id, feedback) => {
  const run = dbModule.setInsightRunFeedback(String(id), feedback);
  broadcastInsightChanged(e.sender);
  return run;
});
ipcMain.handle("insights:delete", (e, id) => {
  const ok = dbModule.deleteInsightRun(String(id));
  broadcastInsightChanged(e.sender);
  return ok;
});
ipcMain.handle("meaning:list", (_e, filter) => dbModule.listPersonalMeaningCandidates(filter || {}));
ipcMain.handle("meaning:create", (_e, payload) => dbModule.createPersonalMeaningCandidate(payload || {}));
ipcMain.handle("meaning:resolve", (e, id, status) => {
  const cand = dbModule.resolvePersonalMeaningCandidate(String(id), status);
  broadcastInsightChanged(e.sender);
  return cand;
});
ipcMain.handle("meaning:delete", (e, id) => {
  const ok = dbModule.deletePersonalMeaningCandidate(String(id));
  broadcastInsightChanged(e.sender);
  return ok;
});

// ---------- v45（M14-UM1，D39 / §4.18）：用户记忆 memory:* ----------
// 分工（§9.1 M14 落点预案）：memoryTidy 在主进程编排（防抖/补跑/分批——后台基础设施，与窗口
// 生命周期解耦）；AI 调用经 memoryChat 包装既有 chatStream（Key 不进渲染层）；提示词文本只来自
// 播种模板 user-memory。进度经 memory:changed 广播到全部窗口。
function memoryChat(messages, { temperature } = {}) {
  return new Promise((resolve, reject) => {
    let acc = "";
    let settled = false;
    chatStream({ messages, temperature: Number(temperature) || 0.3 }, (m) => {
      if (settled) return;
      if (m && m.error) {
        settled = true;
        reject(new Error(m.error));
      } else if (m && m.done) {
        settled = true;
        resolve(acc);
      } else if (m && m.delta) {
        acc += m.delta;
      }
    }).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

const memoryCtx = () => ({
  db: dbModule,
  readSettings,
  writeSettings,
  userData: app.getPath("userData"),
  hasKey: () => {
    try {
      const cfg = getAIConfig();
      return Boolean(cfg.hasKey) || cfg.preset === "local";
    } catch {
      return false;
    }
  },
  chat: memoryChat,
  broadcast: (payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send("memory:changed", payload);
    }
  }
});

ipcMain.handle("memory:status", () => memoryTidy.getStatus(memoryCtx()));
ipcMain.handle("memory:setEnabled", (_e, payload) => {
  const p = payload || {};
  const patch = { enabled: !!p.enabled };
  if (p.introAcked) patch.introAcked = true; // 一次性说明只置真不回退（关闭再开启不重弹，§6.7.2）
  const cfg = memoryTidy.writeMemoryConfig(memoryCtx(), patch);
  if (!p.enabled) memoryTidy.cancelBackfill(); // 关闭即停用：进行中的补处理中止（§4.18-16①）
  return cfg;
});
ipcMain.handle("memory:backfillPreview", () => memoryTidy.backfillStats(memoryCtx()));
ipcMain.handle("memory:backfillStart", () => memoryTidy.runBackfill(memoryCtx()));
ipcMain.handle("memory:backfillCancel", () => memoryTidy.cancelBackfill());
ipcMain.handle("memory:tidyNow", () => memoryTidy.runIngestRound(memoryCtx(), "manual"));
ipcMain.handle("memory:openFolder", async () => {
  const dir = memoryStore.resolveMemoryDir(app.getPath("userData"));
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return true;
});
ipcMain.handle("memory:openFile", async (_e, name) => {
  const allowed = new Set(["core.md", "index.md"]);
  if (!allowed.has(String(name))) throw new Error("非法文件名");
  const dir = memoryStore.resolveMemoryDir(app.getPath("userData"));
  memoryStore.ensureTree(dir);
  await shell.openPath(path.join(dir, String(name)));
  return true;
});
ipcMain.handle("memory:reset", () => {
  const dir = memoryStore.resolveMemoryDir(app.getPath("userData"));
  return { created: memoryStore.resetMemory(dir) };
});

// ============ v48 批2（M15 重做，D41/D42 / §4.19）：材料知识导图编排 ============
// 主进程编排（memoryTidy 同款偏差——后台多级管线与窗口生命周期解耦）；chat 经 chatStream 直连，
// usage/cancel/机读错误码随 ai.js 批2 增补统一获得。进度经 mindmap:changed 广播到全部窗口。
function mindmapChat({ system, user, abortSignal, temperature, retry }) {
  return new Promise((resolve, reject) => {
    let acc = "";
    let settled = false;
    chatStream(
      {
        messages: [
          { role: "system", content: String(system || "") },
          { role: "user", content: String(user || "") }
        ],
        temperature: Number(temperature) || 0.3,
        abortSignal,
        retry
      },
      (m) => {
        if (settled) return;
        if (m && m.error) {
          settled = true;
          reject(new Error(m.error));
        } else if (m && m.done) {
          settled = true;
          // v48.11：finishReason（=length ⇒ 输出被截断）随结果上行，供 §3.4 溢出降级判定
          resolve({ text: acc, usage: m.usage || null, finishReason: m.finishReason || null, ttftMs: m.ttftMs ?? null, firstByteMs: m.firstByteMs ?? null });
        } else if (m && m.delta) {
          acc += m.delta;
        }
      }
    ).catch((err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

const mindmapCtx = () => ({
  db: dbModule,
  readSettings,
  writeSettings,
  hasKey: () => {
    try {
      const cfg = getAIConfig();
      return Boolean(cfg.hasKey) || cfg.preset === "local";
    } catch {
      return false;
    }
  },
  chat: mindmapChat,
  broadcast: (payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send("mindmap:changed", payload);
    }
  }
});

ipcMain.handle("mindmap:preview", (_e, params) => mindmapEngine.preview(mindmapCtx(), params || {}));
ipcMain.handle("mindmap:generate", (_e, params) =>
    // v48.11：resumeRunId 存在时以同一 run 续跑（section 缓存续跑，账本连续）
    mindmapEngine.generate(mindmapCtx(), params || {}, (params && params.resumeRunId) || undefined)
  );
// v48.13 P4：增量深化——「展开」是纯 UI（零调用），「深化」走这里创建后台任务
ipcMain.handle("mindmap:deepen", (_e, params) => mindmapEngine.deepen(mindmapCtx(), params || {}));
// v48.13 P3（D47）：可续跑运行——应用重启后发现未跑完的 run，供指示器提示「可继续生成」
ipcMain.handle("mindmap:pendingRuns", () => dbModule.listResumableMaterialMapRuns());
ipcMain.handle("mindmap:cancel", (_e, runId) => {
  mindmapEngine.cancelRun(runId);
  return true;
});
ipcMain.handle("mindmap:repairConfirm", (_e, runId) => mindmapEngine.repairConfirm(mindmapCtx(), runId));
ipcMain.handle("mindmap:list", (_e, documentId) => dbModule.listMaterialMaps(documentId));
ipcMain.handle("mindmap:get", (_e, id) => dbModule.getMaterialMap(id));
ipcMain.handle("mindmap:getActive", (_e, documentId, scopeAnchor) => dbModule.getActiveMaterialMap(documentId, scopeAnchor || "book"));

/**
 * 批 4 Task 15（规格 §5.3「图谱页签」）：把已发布导图读成侧栏用的**目录树**（节点标题 + 自有区间 + 层级）。
 * **只消费不切分**：区间一律经 `mindmapCore.buildExtractionModel` 算（与生成/深挖同一实现面），
 * 渲染层不复制任何区间算法。结点自身展示用 `nodeRange`（父扣子后的**净区间**）——
 * 这与「父卡覆盖区间」不同：目录树要的是"这个节点自己讲哪一段"。
 * 参数：documentId + 内核给的两样东西（TOC 项与提取单元锚）——渲染层持有内核，故由它传入。
 * 无已发布导图 ⇒ 返回 null（侧栏据此不渲染该页签）。
 */
ipcMain.handle("mindmap:mapTree", (_e, documentId, tocItems, unitAnchors) => {
  try {
    const map = dbModule.getActiveMaterialMap(String(documentId), "book");
    if (!map || !map.structure) return null;
    const toc = Array.isArray(tocItems) ? tocItems : [];
    const units = Array.isArray(unitAnchors) ? unitAnchors.map(String) : [];
    // 无内核锚（如 PDF 无目录/未就绪）⇒ 没有坐标系，宁可不显示也不给假数据
    if (!units.length) return null;
    const core = require("./mindmapCore");
    const nodes = Array.isArray(map.structure.nodes) ? map.structure.nodes : [];
    // 把已发布导图的节点树映射回 TOC 结构：节点带 anchor 时按锚挂回，缺则按标题兜底
    const byAnchor = new Map();
    for (const n of nodes) {
      const a = String(n.anchor || "").split("#")[0];
      if (a) byAnchor.set(a, n);
    }
    // 两项实测要点：
    // ① 内核 TOC 用 `href`（子项字段名 `subitems`），而 buildTocTree 读 `anchor`——字段名不先适配就全算成 [0,0]；
    // ② **层级来自导图自身**（节点的 parentId 链），不是 TOC 的嵌套——目录通常是平铺的
    //    （合成书 4 章全在一层），照 TOC 的 depth 走会让所有节点都是第 0 层、缩进恒等（实测踩过）。
    const depthOf = (n) => {
      let d = 0;
      let cur = n;
      const seen = new Set();
      while (cur && cur.parentId && cur.parentId !== "root" && !seen.has(cur.id)) {
        seen.add(cur.id);
        cur = nodes.find((x) => String(x.id) === String(cur.parentId));
        if (!cur) break;
        d += 1;
        if (d > 32) break;
      }
      return d;
    };
    const items = [];
    const walk = (list) => {
      for (const t of list) {
        const rawHref = String(t.href || t.anchor || "");
        const key = rawHref.split("#")[0];
        const hit = byAnchor.get(key) || nodes.find((n) => String(n.title || "") === String(t.label || ""));
        if (hit) {
          items.push({
            id: String(hit.id ?? key ?? t.label ?? ""),
            label: String(hit.title || t.label || "(无标题)"),
            anchor: rawHref,
            depth: depthOf(hit)
          });
        }
        const kids = Array.isArray(t.subitems) ? t.subitems : Array.isArray(t.children) ? t.children : [];
        if (kids.length) walk(kids);
      }
    };
    walk(toc);
    if (!items.length) return null;
    // 区间：仅对能解析出锚的条目算（无锚条目 range 为空 ⇒ 不显示占比条）。
    // 注意：内核 TOC 用 `href`，而 buildTocTree 读的是 `anchor`——必须**先适配字段名**再喂给共享实现，
    // 否则所有区间都会算成 [0,0]（实测：页签出得来但占比条全为 0）。
    const adapter = (list) =>
      (Array.isArray(list) ? list : []).map((t) => ({
        anchor: String(t.href || t.anchor || ""),
        label: String(t.label || ""),
        children: adapter(t.subitems || t.children)
      }));
    const tocForCore = adapter(toc);
    const tree = core.normalizeTocTree(core.buildTocTree(tocForCore, String(map.title || "地图")), String(map.title || "地图"));
    const model = core.buildExtractionModel(tree, units);
    const withRange = items.map((it) => {
      const f = model.flat.find((x) => {
        const b = String(x.node.anchor || "").split("#")[0];
        return b && b === String(it.anchor || "").split("#")[0];
      });
      const r = f ? model.nodeRange.get(model.nodeKeyOf(f)) : null;
      return { ...it, start: r ? r[0] : 0, end: r ? r[1] : 0 };
    });
    return { title: String(map.title || ""), items: withRange, unitCount: units.length };
  } catch {
    // 图谱目录是增强信息：算不出来就不显示该页签，不影响阅读
    return null;
  }
});
ipcMain.handle("mindmap:setActive", (_e, id) => dbModule.setActiveMaterialMap(id));
ipcMain.handle("mindmap:delete", (_e, id) => dbModule.deleteMaterialMap(id));
ipcMain.handle("mindmap:runs", (_e, documentId) => dbModule.listMaterialMapRuns(documentId));
ipcMain.handle("mindmap:learningStatus", (_e, documentId, nodeIds) => dbModule.listMindmapLearningStatus(documentId, nodeIds || []));

// v46（M14-UM2，§4.18-7/8）：制卡记忆接地检索——Stage A 本地宽召回（memoryRetrieve 纯函数）。
// 调用方（渲染层 cards.ts）只在模板 situationRequired=1 且开关开启时到达这里；
// 无 Key 也跳过（§6.7.3「无 Key 零检索」——检索结果只服务即将发出的 AI 调用）。
ipcMain.handle("memory:retrieve", (_e, payload) => {
  const p = payload || {};
  const mctx = memoryCtx();
  const cfg = memoryTidy.readMemoryConfig(mctx);
  if (!cfg.enabled) return { ok: false, reason: "disabled", block: null, hitTopics: [] };
  if (!mctx.hasKey()) return { ok: false, reason: "no-key", block: null, hitTopics: [] };
  const dir = memoryStore.resolveMemoryDir(mctx.userData);
  memoryStore.ensureTree(dir);
  const usage = memoryStore.usageStats(dir);
  const topicFiles = usage.topics.map((t) => ({ ...t, content: memoryStore.readText(dir, t.rel) || "" }));
  const domains = dbModule.listCardDomainsForDocument(String(p.documentId || ""));
  const lifeDomains = memoryRetrieve.lifeDomainsForUdc(domains);
  const terms = memoryRetrieve.extractSignalTerms({ title: p.title, section: p.section, text: p.text });
  const picks = memoryRetrieve.pickTopics(topicFiles, { lifeDomains, terms });
  const built = memoryRetrieve.buildMemoryBlock({
    coreText: memoryStore.readText(dir, memoryStore.CORE_FILE),
    indexText: memoryStore.readText(dir, memoryStore.INDEX_FILE),
    topicPicks: picks,
    budgets: memoryTidy.injectBudgetsFor(cfg)
  });
  return {
    ok: true,
    block: built ? built.block : null,
    hitTopics: built ? built.hitTopics : [],
    usedChars: built ? built.usedChars : 0,
    lifeDomains,
    signals: terms.length
  };
});

// 捕获窗口（与全局快捷键同一入口，供设置页「试一下」与端到端测试复用）
ipcMain.handle("capture:toggle", () => {
  quickCapture.toggleCapture();
  return true;
});
ipcMain.handle("capture:hide", () => {
  quickCapture.hideCapture();
  return true;
});
ipcMain.on("capture:ready", () => quickCapture.onRendererReady());

// 全局快捷键组状态 / 重注册
ipcMain.handle("shortcuts:status", () => quickCapture.getStatus());
ipcMain.handle("shortcuts:apply", () => quickCapture.applyGlobalShortcuts());

// 「添加学习材料」：主窗口前置 + 就地弹出添加模态（不切换视图，阅读位置与复习会话原地保留）
ipcMain.handle("library:requestAdd", () => sendToMainWindow("library:openAddMaterial"));

function createWindow() {  // 防重入：已存在**主窗口**时不再创建（macOS activate 与启动路径共用此函数）
  // D123：不能再按 getAllWindows().length 判断——隐藏常驻的快速记录/制卡台窗口也计入，会让主窗口关掉后再也建不出来
  if (mainWindow && !mainWindow.isDestroyed()) return;
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    // 批 4 Task 14（规格 §5.3）：摘录页出现批注栏时是「卡面 + 280px 栏」两列，
    // 窄于此版心会挤压正文——给窗口一个下限（1120/640 与两列布局同批裁定）。
    minWidth: 1120,
    minHeight: 640,
    frame: false,
    icon: path.join(__dirname, "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // v28：PDF 原生阅读依赖 rAF 驱动渲染循环——窗口遮挡时 Chromium 暂停 rAF 会导致
      // pdf.js 渲染任务永远停在 RUNNING（实测白轮廓/黑屏/看似无响应），阅读器禁用节流
      backgroundThrottling: false
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
  mainWindow = win;
  // D123：关闭＝收进系统托盘继续运行（app.closeToTray，默认开）；托盘「退出」/ app.quit 才真销毁
  win.on("close", (e) => {
    if (appQuitting) return;
    let toTray = true;
    try {
      toTray = readSettings().app?.closeToTray !== false;
    } catch {
      /* 读不到设置按默认（收进托盘） */
    }
    if (!toTray) return;
    e.preventDefault();
    win.hide();
    // 每次启动只提示一次（内存标记，不新增设置键）
    if (!trayHinted) {
      trayHinted = true;
      tray.hintHidden();
    }
  });
  // 窗口被最大化/全屏：清外延记录，并告知渲染层回落「向内推」
  const dropExt = () => {
    if (dockExt && dockExt.win === win) {
      dockExt = null;
      if (!win.isDestroyed()) win.webContents.send("win:dockMode", "inner");
    }
  };
  win.on("maximize", dropExt);
  win.on("enter-full-screen", dropExt);
  win.on("closed", () => {
    if (dockExt && dockExt.win === win) dockExt = null;
    if (mainWindow === win) mainWindow = null;
    // 关闭未被收进托盘（closeToTray 关闭）＝用户要退出：隐藏常驻的小窗口不会触发 window-all-closed，需显式退出
    if (!appQuitting && process.platform !== "darwin") app.quit();
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
  // D143（v48.98）T2：原此处的 screenCapture.warmup()（+8s 抓 1×1 缩略图）已删除——
  // desktopCapturer 首次调用 2.3~2.8s 一次性初始化会同步阻塞主进程（诊断 R2/§4 T2）；
  // 改为首次真实截图时自然承担（screenCapture.start 内记录首次耗时）。
  // v48.75（D119）：生命周期锚点——区分「进程启动」（init 横幅）与「窗口就绪」（本行），
  // 两者之间崩溃/卡死时日志可判读。
  appLog.log("INFO", "app", "app ready");
  // v48.80（D124 / 设计稿 §9.1）：应用启动后 20 秒后台触发一次学习索引刷新（回调里再查总开关）
  setTimeout(() => {
    if (learnerRefresh.learnerEnabled()) void learnerRefresh.refresh();
  }, 20000);
  Menu.setApplicationMenu(null);
  // 先建窗口立即给用户视觉反馈，数据库并行初始化（v10.2 启动优化）
  createWindow();
  // D143（v48.98，T4）：窗口原生创建（实测 219ms 级）与后续协议注册/待恢复检查/initDb 之间
  // 显式让出——避免「建窗 + 全部初始化」合成一段连续 >300ms 的启动空洞（空库场景实测主因）。
  await new Promise((r) => setImmediate(r));
  // v45.1（用户反馈「书架封面偶尔加载失败」）：协议注册必须先于 await initDb()——窗口先行 +
  // 渲染层先挂载时，封面 <img> 可能抢在协议 handler 注册前发出请求而永久失败（img 无自动重试）。
  // 两个 handler 都只读磁盘文件、不依赖数据库，提前注册无副作用。
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
        gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
        // v32（M7）：词典发音音频（dict-audio 经 bookasset 播放）
        mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4"
      };
      return new Response(data, { headers: { "content-type": types[ext] || "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  // M6-2 修订（v28）：pdfres:// 协议——供 pdf.js 加载 cMap/标准字体/ICC/JSXX-wasm 四类资源
  // （host=cmaps|standard_fonts|iccs|wasm，path=文件名；缺 icc/wasm 时渲染任务会卡死在 loading 态）。
  // 资源基目录优先 dist/pdfjs（构建产物），纯 dev（无 dist）回退 public/pdfjs。
  const pdfjsResBase = fs.existsSync(path.join(__dirname, "../dist/pdfjs"))
    ? path.join(__dirname, "../dist/pdfjs")
    : path.join(__dirname, "../public/pdfjs");
  const PDFRES_DIRS = new Set(["cmaps", "standard_fonts", "iccs", "wasm"]);
  protocol.handle("pdfres", (request) => {
    try {
      const url = new URL(request.url);
      const dir = url.hostname;
      if (!PDFRES_DIRS.has(dir)) {
        return new Response("bad request", { status: 400 });
      }
      const filename = decodeURIComponent(url.pathname).replace(/^\//, "");
      if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
        return new Response("bad request", { status: 400 });
      }
      const data = fs.readFileSync(path.join(pdfjsResBase, dir, filename));
      const ext = path.extname(filename).slice(1).toLowerCase();
      const types = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", pfb: "application/octet-stream", bcmap: "application/octet-stream" };
      return new Response(data, { headers: { "content-type": types[ext] || "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  // M2：若有待恢复备份（restore-pending.json），先换入数据文件再初始化数据库
  try {
    // B-12（审计）：返回值原来被整个丢掉 —— 恢复静默空转时用户得不到任何提示。
    const applied = backup.applyPendingRestore();
    if (applied && applied.ok === false) {
      console.error("[backup] 恢复未完成：暂存区为空或不可用，已保留标记以便下次启动重试（restored=0）");
    }
  } catch (err) {
    console.error("[backup] 应用待恢复数据失败：", err);
  }
  // D143（v48.98，T4）：显式让出——createWindow/协议注册/待恢复检查段与 initDb 段拆成两个宏任务，
  // 避免「窗口原生创建 + 建表迁移」合成一段连续 >300ms 的启动空洞（诊断 §3 R4 / §4 T4）。
  await new Promise((r) => setImmediate(r));
  await initDb();
  // D143（v48.98，T4）：post-initDb 初始化（quickCapture/workbench/tray/pluginHost 注册 + 记忆补跑 +
  // 导图对账）移入下一个宏任务——原实现它们与 initDb 共用同一连续宏任务（实测合成 ~730ms 启动空洞）；
  // 顺序与错误语义不变（各自 try/catch），只是不再拖长启动关键段。
  await new Promise((r) => setImmediate(r));
  // v36（M8-A）：全局快捷键组初始化（快速记录 / 添加学习材料）+ 随系统启动同步（失败在设置页可见）
  try {
    quickCapture.init({
      db: dbModule,
      readSettings,
      writeSettings,
      sendToMain: (channel) => sendToMainWindow(channel),
      toggleWorkbench: () => workbenchWindow.control("toggle")
    });
  } catch (err) {
    console.error("[quickCapture] 初始化失败：", err);
  }
  // D123：独立制卡台窗口 + 系统托盘（失败不阻塞启动）
  try {
    workbenchWindow.init({ readSettings });
    tray.init({
      showMain: () => {
        if (!focusMainWindow()) createWindow();
      },
      toggleWorkbench: () => workbenchWindow.control("toggle"),
      toggleCapture: () => quickCapture.toggleCapture(),
      quit: () => app.quit()
    });
  } catch (err) {
    console.error("[workbench] 托盘/独立窗口初始化失败：", err);
  }
  // v48.89（D132）：插件/主题宿主——只注入 settings.json 读写入口并注册 plugins:* IPC；
  // 扫描惰性（渲染层首次 plugins:list / rescan 才读插件目录），坏插件在场不阻塞启动（§4.7）
  try {
    pluginHost.init({ readSettings, writeSettings });
  } catch (err) {
    console.error("[pluginHost] 初始化失败：", err);
  }
  // M2：每日首次启动自动滚动备份（设置可关；失败不阻塞启动）
  // D143（v48.98，T1）：不再在 whenReady 链上 await——原实现在此同步等待 40~90s 备份全链
  // （835MB quick_check + 快照 + JSZip + 写盘，诊断 STARTUP-LAG-DIAGNOSIS §3 R1）把主进程
  // UI 线程按在启动段上（点击 15s 无反应实测）。现改为窗口可交互后延迟 30s 后台触发，
  // 构建已 worker 化（backup.js）；失败仍只记日志。autoBackup 语义不变：每天一份、
  // 当日已有即跳过、失败/中断不破坏既有备份（未完成则下次启动同日重试，`.part` 不冒充可用备份）。
  setTimeout(() => {
    backup
      .autoBackupIfNeeded(backupOpts())
      .then((r) => {
        if (r && !r.ok) console.error("[backup] 自动备份失败：", r.error);
      })
      .catch((err) => console.error("[backup] 自动备份失败：", err));
  }, 30000);
  // D117（v48.73）：启动空闲补齐旧档 sidecar（备份列表零解压加速缓存，诊断报告 §4.1）。
  // 延迟 5s 让启动流程先落定；后台串行 worker 解析、不阻塞主进程（worker_threads，§4.2）。
  // 失败只影响下次列表速度（回退 zip 解析），不影响正确性——sidecar 是缓存，zip 本体是事实源。
  // D143 复审 M3：同批清扫 backups/ 中断残留（.snapshot-* 孤儿 / 跨日 .part；绝不误删在途备份）。
  setTimeout(() => {
    try {
      Promise.resolve(backup.backfillSidecars())
        .then((r) => {
          if (r && (r.written || r.swept || r.snapshotsSwept || r.partsSwept)) console.log(`[backup] sidecar 补齐：补写 ${r.written}、回收孤儿 ${r.swept}、清残留快照 ${r.snapshotsSwept || 0}、清过期 .part ${r.partsSwept || 0}（${r.dir}）`);
        })
        .catch((err) => console.error("[backup] sidecar 补齐失败：", err));
    } catch (err) {
      console.error("[backup] sidecar 补齐失败：", err);
    }
  }, 5000);
  // v45（M14-UM1，§4.18-11①）：启动补跑——开启 + 有未整理条目 + 距上次成功 ≥12h；失败不阻塞启动
  try {
    memoryTidy.startupBackfillIfDue(memoryCtx());
  } catch (err) {
    console.error("[memory] 启动补跑失败：", err);
  }
  // v48.11（§3.8）：导图僵尸对账——上次运行被关闭/中断时 run 行会永远停在 running（实测两条），
  // 启动时统一收敛为 failed_timeout；已完成分片保留在缓存，重新生成自动续跑。失败不阻塞启动。
  try {
    // A-8（审计）：{ all: true } = 无视年龄全部收敛（启动时所有 running/estimating/pending 都是上个进程的孤儿）
    const n = dbModule.reconcileStaleMaterialMapRuns(undefined, { all: true });
    // v48.13 P3：收敛为 interrupted（不是 failed）——关掉应用不等于任务失败，续跑零重复计费
    if (n) console.log(`[mindmap] 启动对账：${n} 条运行因应用关闭被标记 interrupted（可继续生成，缓存保留）`);
  } catch (err) {
    console.error("[mindmap] 启动对账失败：", err);
  }
  // v45.1：bookasset / pdfres 两协议已上移到 createWindow() 之后立即注册（封面加载竞态修复），此处不再注册。

  // 首个窗口已在上方先行创建（v10.2 启动优化），此处只做协议注册与生命周期挂接
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else focusMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// v36（M8-A）：退出前把日记节流的待落盘内容强制刷盘 + 注销全局快捷键 + 放行捕获窗口关闭
// （before-quit 早于窗口关闭；prepareQuit 置 quitting 标记，否则捕获窗口的 close 会被拦成隐藏）
app.on("before-quit", () => {
  appQuitting = true;
  quickCapture.prepareQuit();
  workbenchWindow.prepareQuit();
  tray.destroy();
});

// M7：词典词条库（独立 dictionary.db）退出兜底落盘（正常路径导入后已即时 save）
// v48.80（D124）：learner.db 同样退出兜底落盘（正常路径刷新结束时已 save）
// D137（§3.2-4）：三库显式 close——clean shutdown = WAL 自动 checkpoint + 删 -wal/-shm sidecar
app.on("will-quit", () => {
  void dictDb.saveOnQuit();
  void learnerDb.saveOnQuit();
  try { dbModule.closeDb(); } catch { /* 退出期尽力而为 */ }
  try { dictDb.close(); } catch { /* 退出期尽力而为 */ }
  try { learnerDb.close(); } catch { /* 退出期尽力而为 */ }
  // v48.75（D119）：退出横幅（生命周期事件；写失败由 appLog 内部静默）
  appLog.log("INFO", "app", "app quit");
});
