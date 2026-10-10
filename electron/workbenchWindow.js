// 独立制卡台窗口（v48.79 / D123）——全局快捷键 / 托盘菜单呼出的单例窗口：
// 手动制卡 + AI 制卡 + AI 解释同一套面板（渲染入口 workbench.html → src/workbench.tsx，复用主 preload 的全部桥）。
// 纪律：① 关闭＝隐藏（单例复用，真正退出才销毁）；② 首次呼出贴近鼠标所在屏幕右缘，之后保留用户拖到的位置；
// ③ 默认置顶（边读别的材料边制卡），可在窗口内切换；④ 就绪后才 show（杜绝白闪）。
const { BrowserWindow, screen, app } = require("electron");
const path = require("path");
const fs = require("fs");

let win = null;
let ctx = null;
let quitting = false;
let pinned = true;
let positioned = false;
let pendingShow = false;
let loaded = false;

function themeBackground() {
  try {
    const mode = ctx?.readSettings?.()?.theme?.mode;
    return mode === "dark" ? "#111111" : "#fafaf8";
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
    icon: path.join(__dirname, "icon.ico"),
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
    pendingShow = false;
  });
  // 导航防护（与主窗口同规则）
  w.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] === w.webContents.getURL().split("#")[0]) return;
    event.preventDefault();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.once("ready-to-show", () => {
    loaded = true;
    if (pendingShow) {
      pendingShow = false;
      reveal();
    }
  });
  const distHtml = path.join(__dirname, "../dist/workbench.html");
  if (fs.existsSync(distHtml)) {
    w.loadFile(distHtml);
  } else if (!app.isPackaged) {
    w.loadURL("http://localhost:5173/workbench.html").catch(() => {
      w.loadFile(distHtml);
    });
  }
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

function reveal() {
  const w = win;
  if (!w || w.isDestroyed()) return;
  if (!positioned) {
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
    return state();
  }
  reveal();
  return state();
}

function hide() {
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

module.exports = { init, control, show, hide, toggle, prepareQuit };
