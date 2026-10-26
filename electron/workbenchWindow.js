// 独立制卡台窗口（v48.79 / D123）——全局快捷键 / 托盘菜单呼出的单例窗口：
// 手动制卡 + AI 制卡 + AI 解释同一套面板（渲染入口 workbench.html → src/workbench.tsx，复用主 preload 的全部桥）。
// 纪律：① 关闭＝隐藏（单例复用，真正退出才销毁）；② 首次呼出贴近鼠标所在屏幕右缘，之后保留用户拖到的位置；
// ③ 默认置顶（边读别的材料边制卡），可在窗口内切换；④ 就绪后才 show（杜绝白闪）。
const { BrowserWindow, screen, app, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const { loadAppPage } = require("./devServer"); // D239：载入顺序 + dev server 地址唯一来源

let win = null;
let ctx = null;
let quitting = false;
let pinned = true;
let positioned = false;
let pendingShow = false;
let pendingShowTimer = null;
let loaded = false;

/** 挂起中的呼出请求作废（hide 后写优先 / 窗口销毁时清理） */
function cancelPendingShow() {
  pendingShow = false;
  if (pendingShowTimer != null) {
    clearTimeout(pendingShowTimer);
    pendingShowTimer = null;
  }
}

/** 消费一次挂起的呼出（ready-to-show / did-finish-load / 安全阀三路共用，幂等） */
function consumePendingShow() {
  if (!pendingShow) return;
  pendingShow = false;
  if (pendingShowTimer != null) {
    clearTimeout(pendingShowTimer);
    pendingShowTimer = null;
  }
  reveal();
}

function themeBackground() {
  try {
    const mode = ctx?.readSettings?.()?.theme?.mode;
    // C-37："system" 档按主进程 nativeTheme 解析（保证新开/呼出时窗口底色与解析后的主题一致、无白闪）；
    // 未知值维持既有回落浅色（渲染层 resolveThemeMode 对未知值按系统解析，主进程读不到设置时保守回落）。
    const dark = mode === "dark" || (mode === "system" && nativeTheme.shouldUseDarkColors);
    return dark ? "#111111" : "#fafaf8";
  } catch {
    return "#fafaf8";
  }
}

function createWindow() {
  if (win && !win.isDestroyed()) return win;
  loaded = false;
  win = new BrowserWindow({
    width: 480,
    height: 780,
    minWidth: 400,
    minHeight: 520,
    frame: false,
    show: false,
    title: "制卡台",
    icon: process.platform === "win32" ? path.join(__dirname, "icon.ico") : path.join(__dirname, "icons", "icon-light.png"), // C-28：非 Windows 用 PNG（ico 只有 Windows 认；与主窗口 icons/ PNG 同目录）
    alwaysOnTop: pinned,
    backgroundColor: themeBackground(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  const w = win;
  w.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide();
  });
  w.on("closed", () => {
    if (win === w) win = null;
    loaded = false;
    cancelPendingShow();
  });
  // 导航防护（与主窗口同规则）
  w.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] === w.webContents.getURL().split("#")[0]) return;
    event.preventDefault();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // 每次开始加载都复位 loaded（v201）：语义＝「当前这份文档已可显示」。旧实现只在新建窗口时
  // 复位，页面 reload（vite 重启 full-reload / 断连重连自动刷新）后 loaded 保持陈旧 true，
  // show() 只能靠 isLoading() 兜底，挂起的呼出请求就此失去消费者（D200 同构缺陷）。
  w.webContents.on("did-start-loading", () => {
    loaded = false;
  });
  // 就绪即消费挂起的呼出。旧实现是 once——监听器首次加载后即被消耗，之后任何「加载中 show()」
  // 挂起的 pendingShow 永远无人消费（全局快捷键 / 托盘呼出同样中招）。改 on + 幂等消费。
  w.on("ready-to-show", () => {
    loaded = true;
    consumePendingShow();
  });
  // v201：兜底消费挂起的呼出——ready-to-show 偶发不触发（隐藏窗 reload）时，加载完成本身就是
  // 「可显示」信号；consumePendingShow 内部走 reveal，`win:workbenchShown` 随 reveal 自然补发，
  // 渲染层同步语义不变。
  w.webContents.on("did-finish-load", () => {
    consumePendingShow();
  });
  // D239：载入顺序与主窗口同规（D192 修订：`npm run dev` 优先 dev server，原先这里漏了——开发时制卡台
  // 一直跑旧 dist）；地址不再写死，统一在 devServer.js。
  loadAppPage(w, { app, fs, distFile: path.join(__dirname, "../dist/workbench.html"), page: "workbench.html" });
  return w;
}

function position(w) {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;
    const [cw, ch] = w.getSize();
    const x = Math.round(area.x + area.width - cw - 24);
    const y = Math.round(area.y + Math.max(24, (area.height - ch) / 2));
    w.setPosition(x, y);
  } catch {
    /* 定位失败不阻塞显示 */
  }
}

/** 屏幕布局变化（显示器休眠 / 拔出 / 重排）后，上次的位置可能落在任何工作区之外——
 * 此时 show 出来用户也看不见。完全离屏（与所有 workArea 零交集）才判离屏：
 * 用户故意拖到边缘只露一条的摆放不动。（与 lensWindow.offScreen 同判据，D201） */
function offScreen(w) {
  try {
    const b = w.getBounds();
    return !screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
    });
  } catch {
    return false;
  }
}

function reveal() {
  const w = win;
  if (!w || w.isDestroyed()) return;
  if (!positioned || offScreen(w)) {
    position(w);
    positioned = true;
  }
  w.setBackgroundColor?.(themeBackground());
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  w.webContents.send("win:workbenchShown");
}

function show() {
  const w = createWindow();
  if (!loaded || w.webContents.isLoading()) {
    pendingShow = true;
    // v201 安全阀：加载悬挂（vite 半死：端口在、请求不回）时 pendingShow 无事件可消费，
    // 最迟 2s 强制显示——宁可短暂主题色白板，不让快捷键/托盘呼出没反应（D200 同构缺陷）。
    if (pendingShowTimer == null) {
      pendingShowTimer = setTimeout(() => {
        pendingShowTimer = null;
        consumePendingShow();
      }, 2000);
    }
    return state();
  }
  reveal();
  return state();
}

function hide() {
  // v201：用户显式要收，挂起中的呼出作废（后写优先；否则安全阀会把刚收的窗又弹出来）
  cancelPendingShow();
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  return state();
}

function toggle() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return hide();
  return show();
}

function togglePin() {
  pinned = !pinned;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(pinned);
  return state();
}

function state() {
  return { visible: !!(win && !win.isDestroyed() && win.isVisible()), pinned };
}

/** IPC 入口：win:workbench */
function control(action) {
  switch (action) {
    case "show":
      return show();
    case "hide":
      return hide();
    case "pin":
      return togglePin();
    default:
      return toggle();
  }
}

function prepareQuit() {
  quitting = true;
}

function init(options) {
  ctx = options || null;
}

// themeBackground 导出仅供测试（tests/window-skin.test.cjs 的 electron 桩单测；C-29 isAutoLaunchOn 同先例）
module.exports = { init, control, show, hide, toggle, prepareQuit, themeBackground };
