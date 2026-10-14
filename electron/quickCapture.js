// 快速记录（v36，M8-A，§4.2-21 / §6.5 / 决策 D34）——第二输入通道的写入面。
//
// 本模块独占四件事：
//  ① **全局快捷键组**：快速记录（Ctrl+Alt+Space 缺省）+ 添加学习材料（Ctrl+Alt+N 缺省）——注册失败必须可见
//     （`globalShortcut.register` 返回 false = 被系统或其它软件占用，静默失效会让用户以为软件坏了）。
//  ② **捕获窗口单例**：无框小窗常驻复用，关闭=隐藏；渲染层就绪（capture:ready）后才 show（杜绝白闪）；
//     每次呼出按**鼠标所在屏幕**水平居中、顶部 18%。
//  ③ **草稿-发送状态机**：输入即落库（防抖）→ 「发送」定格为日记里的一条；不发送则失焦只隐藏、草稿保留可续写。
//  ④ **持久化节流**：日记自动保存是本项目「每次落库即落盘」（§7.2）的**唯一例外**——sql.js 每次 persist 都是
//     整库导出 + fsync + rename，按输入停顿每 1.2s 落盘会把长文的磁盘写放大到不可接受。故内存库即时写、
//     磁盘尾随 4s / 上限 20s，隐藏·发送·退出强制 flush；代价是崩溃最多丢最后几秒（已写入 D34 与 §6.5.4）。
const { app, BrowserWindow, globalShortcut, screen } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULT_ACCEL_CAPTURE = "Ctrl+Alt+Space";
const DEFAULT_ACCEL_ADD_MATERIAL = "Ctrl+Alt+N";
// D123：独立制卡台窗口（手动制卡 / AI 制卡 / AI 解释）
const DEFAULT_ACCEL_WORKBENCH = "Ctrl+Alt+K";
const PERSIST_TRAILING_MS = 4000;
const PERSIST_MAX_MS = 20000;

// 修饰键别名 → 规范名（Electron accelerator 合法修饰键；渲染层 eventToCombo 产出 Ctrl/Alt/Shift/Meta）

// v48.114（D159）：日记与快速记录暂时移除（代码保留待重新实装，契约见 GUIDE §6.5）。
// 闸＝本常量：置 false 即整体恢复（快捷键注册 + 捕获窗口 + 托盘项）。
// 「添加学习材料 Ctrl+Alt+N」「制卡台 Ctrl+Alt+K」两快捷键与 init 注册链**不受本闸影响**，保持可用。
const CAPTURE_DISABLED = true;
const MOD_CANON = {
  ctrl: "Ctrl",
  control: "Ctrl",
  cmd: "Cmd",
  command: "Cmd",
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  alt: "Alt",
  option: "Alt",
  altgr: "AltGr",
  shift: "Shift",
  super: "Super",
  meta: "Super",
  windows: "Super"
};
const MOD_ORDER = ["Ctrl", "CommandOrControl", "Cmd", "Alt", "AltGr", "Shift", "Super"];
const KEY_CANON = {
  space: "Space",
  tab: "Tab",
  enter: "Enter",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  plus: "Plus"
};

function normalizeKey(raw) {
  const k = String(raw || "").trim();
  if (!k) return null;
  if (k.length === 1) return /[a-z]/i.test(k) ? k.toUpperCase() : k; // 单字符键：字母大写、符号原样
  const lower = k.toLowerCase();
  if (KEY_CANON[lower]) return KEY_CANON[lower];
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return lower.toUpperCase();
  return null;
}

// 规范化组合键（非法返回 null）。规则：修饰键别名归一 + 固定顺序；无修饰键时**只允许功能键**
// （单字母/F 以外的单键做全局快捷键会吞掉用户正常输入，且极难发现）。
function normalizeAccelerator(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const parts = s.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (!parts.length) return null;
  const key = normalizeKey(parts[parts.length - 1]);
  if (!key) return null;
  const mods = [];
  for (const p of parts.slice(0, -1)) {
    const canon = MOD_CANON[String(p).toLowerCase()];
    if (!canon) return null;
    if (!mods.includes(canon)) mods.push(canon);
  }
  if (!mods.length) return /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ? key : null;
  mods.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return [...mods, key].join("+");
}

let ctx = null; // { db, readSettings, writeSettings, sendToMain }
let captureWin = null;
let captureReady = false;
let pendingShow = false;
let quitting = false;
let persistTimer = null;
let persistMaxTimer = null;
let status = {
  quickCapture: { enabled: true, accelerator: DEFAULT_ACCEL_CAPTURE, registered: false, error: null },
  addMaterial: { enabled: true, accelerator: DEFAULT_ACCEL_ADD_MATERIAL, registered: false, error: null },
  workbench: { enabled: true, accelerator: DEFAULT_ACCEL_WORKBENCH, registered: false, error: null },
  hideOnBlur: true,
  autoLaunch: false
};

// ---------- 配置读取与归一化（非法值一律回落默认，不让坏设置把功能打死） ----------

function readShortcutConfig() {
  const raw = (ctx?.readSettings?.()?.app || {}).globalShortcuts || {};
  const qc = raw.quickCapture || {};
  const am = raw.addMaterial || {};
  const wb = raw.workbench || {};
  const accelCapture = normalizeAccelerator(qc.accelerator) || DEFAULT_ACCEL_CAPTURE;
  const accelAdd = normalizeAccelerator(am.accelerator) || DEFAULT_ACCEL_ADD_MATERIAL;
  const accelWbRaw = normalizeAccelerator(wb.accelerator) || DEFAULT_ACCEL_WORKBENCH;
  // 与前两键相同则回落默认（同「两键相同」的处理口径）
  const wbConflict = accelWbRaw === accelCapture || accelWbRaw === accelAdd;
  const accelWb = wbConflict ? DEFAULT_ACCEL_WORKBENCH : accelWbRaw;
  // 两键相同：后注册的必然抢不到，直接判为非法并回落默认（避免用户看到「被占用」却找不到原因）
  const sameAccel = accelCapture === accelAdd;
  return {
    quickCapture: {
      // D159：闸下强制视为关闭（status 显示「已关闭」、快捷键不注册；置 CAPTURE_DISABLED=false 即恢复）
      enabled: !CAPTURE_DISABLED && qc.enabled !== false,
      accelerator: sameAccel ? DEFAULT_ACCEL_CAPTURE : accelCapture,
      hideOnBlur: qc.hideOnBlur !== false
    },
    addMaterial: {
      enabled: am.enabled !== false,
      accelerator: sameAccel ? DEFAULT_ACCEL_ADD_MATERIAL : accelAdd,
      conflictWithCapture: sameAccel
    },
    workbench: {
      enabled: wb.enabled !== false,
      accelerator: accelWb,
      conflict: wbConflict
    },
    autoLaunch: raw.autoLaunch === true
  };
}

function isAutoLaunchOn() {
  try {
    return !!app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}

function applyAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      // 开发态（npx electron .）需要显式带上应用目录，打包态不带
      args: app.isPackaged ? [] : [path.resolve(__dirname, "..")]
    });
  } catch (err) {
    console.error("[quickCapture] 随系统启动设置失败：", err);
  }
}

// ---------- 全局快捷键注册（失败可见） ----------

function applyGlobalShortcuts() {
  const cfg = readShortcutConfig();
  try {
    globalShortcut.unregisterAll(); // 全局快捷键全部由本模块持有
  } catch { /* 无注册 */ }

  const tryRegister = (accelerator, handler, label) => {
    const out = { registered: false, error: null };
    try {
      const ok = globalShortcut.register(accelerator, handler);
      out.registered = !!ok;
      if (!ok) out.error = "该组合已被系统或其它软件占用，请换一个";
    } catch (err) {
      out.error = `注册失败：${err instanceof Error ? err.message : String(err)}`;
    }
    if (out.error) console.error(`[quickCapture] ${label} 全局快捷键不可用：${out.error}（${accelerator}）`);
    return out;
  };

  const capture = cfg.quickCapture.enabled
    ? tryRegister(cfg.quickCapture.accelerator, () => toggleCapture(), "快速记录")
    : { registered: false, error: null };
  const addMaterial = cfg.addMaterial.enabled
    ? tryRegister(cfg.addMaterial.accelerator, () => ctx?.sendToMain?.("library:openAddMaterial"), "添加学习材料")
    : { registered: false, error: null };

  const workbench = cfg.workbench.enabled
    ? tryRegister(cfg.workbench.accelerator, () => ctx?.toggleWorkbench?.(), "制卡台")
    : { registered: false, error: null };

  if (cfg.autoLaunch !== isAutoLaunchOn()) applyAutoLaunch(cfg.autoLaunch);

  status = {
    quickCapture: { enabled: cfg.quickCapture.enabled, accelerator: cfg.quickCapture.accelerator, ...capture },
    addMaterial: {
      enabled: cfg.addMaterial.enabled,
      accelerator: cfg.addMaterial.accelerator,
      ...addMaterial,
      error: addMaterial.error || (cfg.addMaterial.conflictWithCapture ? "两个快捷键不能相同" : null)
    },
    workbench: {
      enabled: cfg.workbench.enabled,
      accelerator: cfg.workbench.accelerator,
      ...workbench,
      error: workbench.error || (cfg.workbench.conflict ? "与另一个全局快捷键相同，已回落默认" : null)
    },
    hideOnBlur: cfg.quickCapture.hideOnBlur,
    autoLaunch: cfg.autoLaunch
  };
  return status;
}

function getStatus() {
  return { ...status, autoLaunch: status.autoLaunch || isAutoLaunchOn() };
}

// ---------- 捕获窗口（单例 + 就绪后显示） ----------

function themeBackground() {
  try {
    const mode = ctx?.readSettings?.()?.theme?.mode;
    return mode === "dark" ? "#111111" : "#ffffff";
  } catch {
    return "#ffffff";
  }
}

function createCaptureWindow() {
  if (captureWin && !captureWin.isDestroyed()) return captureWin;
  captureWin = new BrowserWindow({
    width: 560,
    height: 380,
    frame: false,
    show: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: themeBackground(),
    title: "快速记录",
    webPreferences: {
      preload: path.join(__dirname, "preload-capture.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const win = captureWin;
  // 关闭 = 隐藏（单例复用；真正退出应用时才销毁）
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    hideCapture();
  });
  win.on("blur", () => {
    if (readShortcutConfig().quickCapture.hideOnBlur) hideCapture();
  });
  win.on("closed", () => {
    captureWin = null;
    captureReady = false;
    pendingShow = false;
  });
  // 导航防护（与主窗口同规则）：任何页面级跳转一律拦截，外链交系统浏览器
  win.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] === win.webContents.getURL().split("#")[0]) return;
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const distCapture = path.join(__dirname, "../dist/capture.html");
  if (fs.existsSync(distCapture)) {
    win.loadFile(distCapture);
  } else if (!app.isPackaged) {
    win.loadURL("http://localhost:5173/capture.html").catch(() => {
      win.loadFile(distCapture);
    });
  }
  return win;
}

function positionCapture(win) {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const [w] = win.getSize();
    const [, h] = win.getSize();
    const x = Math.round(area.x + (area.width - w) / 2);
    const y = Math.round(area.y + Math.max(24, area.height * 0.18));
    win.setPosition(x, Math.min(y, area.y + area.height - h - 24));
  } catch { /* 定位失败不阻塞显示 */ }
}

function showCapture() {
  if (CAPTURE_DISABLED) return; // D159：日记与快速记录暂时移除——窗口不再唤起（代码保留）
  const win = createCaptureWindow();
  if (!win) return;
  if (!captureReady || win.webContents.isLoading()) {
    pendingShow = true;
    return;
  }
  positionCapture(win);
  win.setBackgroundColor?.(themeBackground());
  win.show();
  win.focus();
  win.webContents.send("capture:shown");
}

function hideCapture() {
  flushJournal(); // 隐藏即强制落盘（D34）
  if (captureWin && !captureWin.isDestroyed() && captureWin.isVisible()) captureWin.hide();
}

function toggleCapture() {
  const win = captureWin && !captureWin.isDestroyed() ? captureWin : null;
  if (win && win.isVisible() && win.isFocused()) hideCapture();
  else showCapture();
}

function onRendererReady() {
  captureReady = true;
  if (pendingShow) {
    pendingShow = false;
    showCapture();
  }
}

// ---------- 日记写入编排（草稿节流 / 发送定格 / 广播） ----------

function broadcastJournalChanged(payload, excludeWebContents) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    if (excludeWebContents && w.webContents === excludeWebContents) continue;
    w.webContents.send("journal:changed", payload);
  }
}

function scheduleJournalPersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushJournal();
  }, PERSIST_TRAILING_MS);
  if (!persistMaxTimer) {
    persistMaxTimer = setTimeout(() => {
      persistMaxTimer = null;
      flushJournal();
    }, PERSIST_MAX_MS);
  }
}

function flushJournal() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistMaxTimer) {
    clearTimeout(persistMaxTimer);
    persistMaxTimer = null;
  }
  try {
    return ctx?.db?.flushJournalPersist?.() === true;
  } catch (err) {
    console.error("[journal] 日记落盘失败：", err);
    return false;
  }
}

// 草稿续写（输入中，防抖调用）：内存库即时写 + 磁盘节流
function saveDraft(content, sender) {
  const entry = ctx.db.saveJournalDraft(content, { deferPersist: true });
  scheduleJournalPersist();
  broadcastJournalChanged({ kind: "draft", entryId: entry?.id || null }, sender);
  return entry;
}

// 发送：草稿定格为日记里的一条（db 内部即时落盘），并通知所有窗口刷新
function sendDraft(content, sender) {
  const entry = ctx.db.sendJournalDraft(content);
  flushJournal();
  broadcastJournalChanged({ kind: "sent", entryId: entry?.id || null, entryDate: entry?.entryDate || null }, sender);
  return entry;
}

function notifyJournalChanged(payload, sender) {
  broadcastJournalChanged(payload, sender);
}

function prepareQuit() {
  quitting = true;
  flushJournal();
  try {
    globalShortcut.unregisterAll();
  } catch { /* 忽略 */ }
}

function init(options) {
  ctx = options;
  applyGlobalShortcuts();
  return getStatus();
}

module.exports = {
  init,
  normalizeAccelerator,
  readConfig: readShortcutConfig,
  applyGlobalShortcuts,
  getStatus,
  isAutoLaunchOn,
  toggleCapture,
  showCapture,
  hideCapture,
  onRendererReady,
  saveDraft,
  sendDraft,
  flushJournal,
  scheduleJournalPersist,
  notifyJournalChanged,
  prepareQuit
};
