// 独立结构图窗口（v49.24 / D197）——阅读界面的「结构图」（阅读透镜 v2）从主窗口内的浮层 / 正文下方
// 改为独立窗口：可拖到主阅读界面之外不遮正文。
//
// v49.29 / D203：窗口改为内容自适应「纸片图谱」——transparent / frame:false / resizable:false /
// hasShadow:false / roundedCorners:false / backgroundColor:#00000000；尺寸不再由用户原生拖拽，而由渲染层量
// 图谱 layout bounds，经 invoke `lens:fit` 交主进程按窗口所在显示器 workArea 算 s / 锚点落位 / 钳制，再
// setBounds 程序化驱动。纸片是窗口表面（渲染层 inset:0），所以窗口 = 内容 + 固定留白（左右 16 / 上 32 / 下 16）。
// 明确不做：点击穿透 / 锁定 / 鼠标穿透 API（窗口矩形内仍拦截点击；纸片是可见实体）。
//
// 纪律与独立制卡台窗口（workbenchWindow.js）逐条同构：① 关闭＝隐藏（单例复用，真正退出才销毁）；
// ② 首次呼出贴近主窗口右侧（放不下就退到工作区右缘），之后保留用户拖到的位置；③ 默认置顶，可在窗口内切换；
// ④ 就绪后才 show（杜绝白闪）；⑤ 与制卡台共用主 preload 桥与同一套主题 / 皮肤引导（换肤一处改两窗同步）。
// v49.26 / D200 的呼出状态机（did-start-loading 复位 / 幂等 ready-to-show / did-finish-load 兜底 / 2s 安全阀 /
// hide 后写优先 / 离屏守卫）原样保留。
//
// 跨窗口数据流（面板跑在结构图窗口，正文与内核仍住在主窗口 → 全经主进程转发）：
//   结构图窗口 --lens:ask--> 主进程 --lens:askIn--> 主窗口（取区间原文 / 跳正文 / 正文强调 / 在完整图谱中打开 / 刷新上下文）
//   结构图窗口 --lens:fit(invoke)--> 主进程（算 s / 落位 / 钳制 / setBounds，返回实际值）
//   主窗口 --lens:reply--> 主进程 --lens:replyIn--> 结构图窗口（请求回执：取文、跳转结果）
//   主窗口 --lens:push--> 主进程 --lens:pushIn--> 结构图窗口（上下文：文档 / 标题 / 目录 / 单元锚；阅读位置探针）
//   主进程 --lens:window--> 两窗口（可见性 + 置顶状态；主窗口据此同步工具栏开关，结构图窗口据此同步置顶钮）
const { BrowserWindow, screen, ipcMain, app } = require("electron");
const path = require("path");
const fs = require("fs");
const { computeFit } = require("./lensWindowFit.bundle.cjs");

let win = null;
let ctx = null;
let quitting = false;
let pinned = true;
let positioned = false;
let pendingShow = false;
let pendingShowTimer = null;
/** 隐藏期间 fit 暂存的窗口 bounds（show 时应用；不抢焦点） */
let pendingFit = null;
let loaded = false;
let registered = false;

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

/**
 * 窗口创建选项的唯一来源（纯函数，测试直接断言）。
 * `transparent` / `roundedCorners` 没有运行时 getter，不能靠 win.isResizable() 反推——必须从这里验。
 */
function lensWindowOptions(options = {}) {
  return {
    width: 360,
    height: 248,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: "#00000000",
    show: false,
    title: "结构图",
    icon: path.join(__dirname, "icon.ico"),
    alwaysOnTop: options.pinned !== false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };
}

/** 主窗口（结构图的服务对象）：销毁或未建时为 null */
function mainWin() {
  try {
    const w = ctx?.getMainWindow?.();
    return w && !w.isDestroyed() ? w : null;
  } catch {
    return null;
  }
}

function createWindow() {
  if (win && !win.isDestroyed()) return win;
  loaded = false;
  win = new BrowserWindow(lensWindowOptions({ pinned }));
  const w = win;
  w.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    w.hide();
    broadcastState();
  });
  w.on("closed", () => {
    if (win === w) win = null;
    loaded = false;
    pendingFit = null;
    cancelPendingShow();
  });
  // 导航防护（与主窗口 / 制卡台同规则）
  w.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] === w.webContents.getURL().split("#")[0]) return;
    event.preventDefault();
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // 每次开始加载都复位 loaded（v200）：语义＝「当前这份文档已可显示」。旧实现只在新建窗口时
  // 复位，页面 reload（vite 重启 full-reload / 断连重连自动刷新）后 loaded 保持陈旧 true，
  // show() 只能靠 isLoading() 兜底，挂起的呼出请求就此失去消费者（D200 复现）。
  w.webContents.on("did-start-loading", () => {
    loaded = false;
  });
  // 就绪即消费挂起的呼出。旧实现是 once——监听器首次加载后即被消耗，之后任何「加载中 show()」
  // 挂起的 pendingShow 永远无人消费（D200：按钮高亮但窗口永不出现）。改 on + 幂等消费。
  w.on("ready-to-show", () => {
    loaded = true;
    consumePendingShow();
  });
  // 首次加载完成：把状态播给两窗（主窗口据此补推一次上下文，结构图窗口据此取回置顶态）。
  // v200：兜底消费挂起的呼出——ready-to-show 偶发不触发（隐藏窗 reload）时，加载完成本身就是
  // 「可显示」信号；先消费再广播，广播带出的即 reveal 后的真实可见态。
  w.webContents.on("did-finish-load", () => {
    consumePendingShow();
    broadcastState();
  });
  const distHtml = path.join(__dirname, "../dist/lens.html");
  // 加载顺序与主窗口同规（D192 修订）：`npm run dev`（显式 --dev-server）优先连本地 vite，
  // 否则旧 dist 会盖住最新源码；生产 / npm start 仍以 dist 为准。
  if (!app.isPackaged && process.argv.includes("--dev-server")) {
    w.loadURL("http://localhost:5173/lens.html").catch(() => {
      if (fs.existsSync(distHtml)) w.loadFile(distHtml);
    });
  } else if (fs.existsSync(distHtml)) {
    w.loadFile(distHtml);
  } else if (!app.isPackaged) {
    w.loadURL("http://localhost:5173/lens.html").catch(() => {
      w.loadFile(distHtml);
    });
  }
  return w;
}

/** 首次呼出：优先贴主窗口右侧（不遮正文）；右侧放不下退左侧；再放不下退工作区右缘。 */
function position(w) {
  try {
    const main = mainWin();
    const area = main
      ? screen.getDisplayMatching(main.getBounds()).workArea
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const [cw, ch] = w.getSize();
    const gap = 16;
    if (main) {
      const b = main.getBounds();
      const y = Math.round(Math.max(area.y, Math.min(b.y, area.y + area.height - ch)));
      const rightX = b.x + b.width + gap;
      if (rightX + cw <= area.x + area.width) {
        w.setPosition(Math.round(rightX), y);
        return;
      }
      const leftX = b.x - cw - gap;
      if (leftX >= area.x) {
        w.setPosition(Math.round(leftX), y);
        return;
      }
    }
    const x = Math.round(area.x + area.width - cw - 24);
    const y = Math.round(area.y + Math.max(24, (area.height - ch) / 2));
    w.setPosition(x, y);
  } catch {
    /* 定位失败不阻塞显示 */
  }
}

function state() {
  return { visible: !!(win && !win.isDestroyed() && win.isVisible()), pinned };
}

/** 可见性 / 置顶状态播给所有窗口（主窗口的工具栏开关与结构图窗口的置顶钮同源） */
function broadcastState() {
  const s = state();
  for (const w of BrowserWindow.getAllWindows()) {
    try {
      w.webContents.send("lens:window", s);
    } catch {
      /* 窗口正在销毁 */
    }
  }
}

/** 屏幕布局变化（显示器休眠 / 拔出 / 重排）后，上次的位置可能落在任何工作区之外——
 * 此时 show 出来用户也看不见（D200 同症状的另一个来源）。完全离屏（与所有 workArea 零交集）
 * 才判离屏：用户故意拖到边缘只露一条的摆放不动。 */
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

/** 当前窗口所在显示器的工作区（窗口未建时回落到主窗口 / 主显示器） */
function workAreaFor(w) {
  try {
    if (w && !w.isDestroyed()) return screen.getDisplayMatching(w.getBounds()).workArea;
    const m = mainWin();
    if (m) return screen.getDisplayMatching(m.getBounds()).workArea;
  } catch {
    /* 显示器查询失败不阻塞 */
  }
  return screen.getPrimaryDisplay().workArea;
}

function applyPendingFit(w) {
  if (!pendingFit) return;
  const b = pendingFit;
  pendingFit = null;
  try {
    w.setBounds(b, false);
  } catch {
    /* 定位失败不阻塞显示 */
  }
}

/**
 * lens:fit —— 渲染层量图谱 content / anchor，主进程按窗口所在显示器 workArea 算 s、锚点落位、钳制，
 * 再 setBounds。mode=fit 且 tier=focus 是**探测**（完整内容已低于可读下限）：不落窗，渲染层随后派生
 * 聚焦内容再发 focus。隐藏时只暂存 bounds，show/reveal 时应用；自动尺寸更新不 focus。
 */
function fit(payload) {
  const content = payload && payload.content ? payload.content : null;
  const w = win && !win.isDestroyed() ? win : null;
  const area = workAreaFor(w);
  if (!content || !Number.isFinite(content.w) || !Number.isFinite(content.h)) {
    return { scale: 1, bounds: area, workArea: area, clamped: false, tier: "100%" };
  }
  const mode = payload.mode === "focus" ? "focus" : payload.mode === "all" ? "all" : "fit";
  const bounds = w ? w.getBounds() : null;
  const r = computeFit({
    content: { w: content.w, h: content.h },
    workArea: area,
    mode,
    anchor: payload.anchor || null,
    current: payload.current || null,
    bounds,
  });
  const probe = mode === "fit" && r.tier === "focus";
  if (!probe) {
    if (w && w.isVisible()) {
      try {
        w.setBounds(r.bounds, false);
      } catch {
        /* 定位失败不阻塞显示 */
      }
      pendingFit = null;
    } else {
      // 隐藏 / 首帧未显示：暂存，show 时应用（不抢焦点）
      pendingFit = { ...r.bounds };
    }
  }
  return {
    scale: r.scale,
    bounds: probe && bounds ? bounds : r.bounds,
    workArea: r.workArea,
    clamped: r.clamped,
    tier: r.tier,
  };
}

function reveal() {
  const w = win;
  if (!w || w.isDestroyed()) return;
  // v49.29 / D203：隐藏期间算好的尺寸先落，再判断是否需要贴边——纸片窗口不设主题底色（透明由纸片承担）
  applyPendingFit(w);
  if (!positioned || offScreen(w)) {
    position(w);
    positioned = true;
  }
  w.setAlwaysOnTop(pinned);
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  broadcastState();
}

function show() {
  const w = createWindow();
  if (!loaded || w.webContents.isLoading()) {
    pendingShow = true;
    // v200 安全阀：加载悬挂（vite 半死：端口在、请求不回）时 pendingShow 无事件可消费，
    // 最迟 2s 强制显示——宁可短暂主题色白板，不让用户点了没反应（D200 实测症状）。
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
  // v200：用户显式要收，挂起中的呼出作废（后写优先；否则安全阀会把刚收的窗又弹出来）
  cancelPendingShow();
  if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  broadcastState();
  return state();
}

function toggle() {
  if (win && !win.isDestroyed() && win.isVisible() && win.isFocused()) return hide();
  return show();
}

function togglePin() {
  pinned = !pinned;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(pinned);
  broadcastState();
  return state();
}

/** IPC 入口：win:lens（toggle / show / hide / pin） */
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

/** 结构图窗口 → 主窗口：请求 / 命令（主窗口还在加载时排队到 did-finish-load，先例＝sendToMainWindow） */
function relayAsk(payload) {
  const m = mainWin();
  if (!m) return;
  const wc = m.webContents;
  if (wc.isLoading()) wc.once("did-finish-load", () => wc.send("lens:askIn", payload));
  else wc.send("lens:askIn", payload);
}

/** 主窗口 → 结构图窗口：请求回执 */
function relayReply(payload) {
  if (win && !win.isDestroyed()) win.webContents.send("lens:replyIn", payload);
}

/** 主窗口 → 结构图窗口：上下文 / 阅读位置推送 */
function relayPush(payload) {
  if (win && !win.isDestroyed()) win.webContents.send("lens:pushIn", payload);
}

function prepareQuit() {
  quitting = true;
}

function init(options) {
  ctx = options || null;
  if (registered) return;
  registered = true;
  ipcMain.handle("win:lens", (_e, action) => control(String(action || "toggle")));
  ipcMain.handle("lens:fit", (_e, payload) => fit(payload));
  ipcMain.on("lens:ask", (_e, payload) => relayAsk(payload));
  ipcMain.on("lens:reply", (_e, payload) => relayReply(payload));
  ipcMain.on("lens:push", (_e, payload) => relayPush(payload));
}

module.exports = {
  init,
  control,
  show,
  hide,
  toggle,
  prepareQuit,
  relayAsk,
  relayReply,
  relayPush,
  lensWindowOptions,
  fit,
};
