// 屏幕截图（D123 修订 3/5）——制卡台「图片挖空 → 截图」：截取**整块屏幕上任意内容**（不限于软件窗口）。
// 流程（修订 5 提速：遮罩窗口与抓屏并行；背景图走 JPEG，最终裁剪才编 PNG）：
//   ① 立刻创建隐藏的遮罩窗口（页面加载与抓屏并行）→ ② 应用窗口临时透明（不入镜，等 ~100ms 合成）→
//   ③ desktopCapturer 抓光标所在显示器 → ④ 把 JPEG 背景交给遮罩，图片解码完成才显示 → ⑤ 用户拖框 →
//   ⑥ 按显示器缩放比从**原始位图**裁剪 → 仅对裁出的小图编 PNG dataURL（取消/失败 ⇒ null）。
const { BrowserWindow, desktopCapturer, screen, ipcMain, app } = require("electron");
const path = require("path");

let session = null; // { shotPromise, finish, win }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.handle("screen-capture:shot", () => (session ? session.shotPromise : null));
ipcMain.on("screen-capture:ready", () => {
  const s = session;
  if (!s || !s.win || s.win.isDestroyed()) return;
  s.win.show();
  s.win.focus();
});
ipcMain.on("screen-capture:done", (_e, rect) => {
  if (session) session.finish(rect && typeof rect === "object" ? rect : null);
});

/** 创建隐藏遮罩窗口；返回 { win, picked: Promise<rect|null>, setShot(url|null) } */
function createOverlay(display) {
  let settled = false;
  let resolvePicked;
  const picked = new Promise((r) => (resolvePicked = r));
  let resolveShot;
  const shotPromise = new Promise((r) => (resolveShot = r));
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "captureOverlayPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  const finish = (rect) => {
    if (settled) return;
    settled = true;
    resolveShot(null);
    resolvePicked(rect);
    if (!win.isDestroyed()) win.destroy();
  };
  session = { shotPromise, finish, win };
  win.setAlwaysOnTop(true, "screen-saver");
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      e.preventDefault();
      finish(null);
    }
  });
  win.on("closed", () => finish(null));
  win.webContents.on("did-fail-load", () => finish(null));
  win.loadFile(path.join(__dirname, "captureOverlay.html")).catch(() => finish(null));
  // 兜底：整个流程 40 秒无结果自动放弃，避免全屏罩死
  const guard = setTimeout(() => finish(null), 40000);
  picked.then(() => clearTimeout(guard));
  return { win, picked, setShot: (url) => resolveShot(url), finish };
}

// D143（v48.98）：8s 预热已退役——`desktopCapturer.getSources` 首次调用的一次性初始化成本
// （实测 2.3~2.8s，与数据规模无关）原在启动后 8s 的定时器里同步阻塞主进程 UI 线程
// （点击落该窗口端到端实测 2711ms 无反应）。预热并不消除成本、只是把「首次截图时的等待」
// 提前成「启动后的冻结」，故改为**首次真实截图自然承担**（遮罩窗口先行显示，等待可见），
// 并保留首次调用耗时到日志（诊断归因用；不再新增任何主动抓屏）。
let firstShotLogged = false;

/** 发起一次屏幕截图。返回 PNG dataURL；取消 / 失败 / 已有进行中的截图 ⇒ null。 */
async function start(senderWc) {
  if (session) return null;
  const owner = senderWc ? BrowserWindow.fromWebContents(senderWc) : null;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const scale = display.scaleFactor || 1;
  const overlay = createOverlay(display); // 与下面的抓屏并行加载
  const visible = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && w !== overlay.win);
  const saved = visible.map((w) => [w, w.getOpacity()]);
  try {
    for (const [w] of saved) w.setOpacity(0);
    await sleep(100); // 等合成器刷掉透明窗口，避免应用自身入镜
    const t0 = Date.now();
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: false,
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) }
    });
    if (!firstShotLogged) {
      firstShotLogged = true;
      console.log(`[screenCapture] 首次抓屏 getSources 耗时 ${Date.now() - t0}ms（一次性初始化成本，D143 起不再预热）`);
    }
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) {
      overlay.finish(null);
      return null;
    }
    const shot = src.thumbnail;
    // 背景图用 JPEG：大屏下 PNG 编码要 1 秒以上，JPEG 只需几十毫秒
    overlay.setShot("data:image/jpeg;base64," + shot.toJPEG(92).toString("base64"));
    const rect = await overlay.picked;
    if (!rect) return null;
    const size = shot.getSize();
    const kx = size.width / display.size.width;
    const ky = size.height / display.size.height;
    const x = Math.max(0, Math.round(Number(rect.x) * kx));
    const y = Math.max(0, Math.round(Number(rect.y) * ky));
    const w = Math.min(size.width - x, Math.round(Number(rect.width) * kx));
    const h = Math.min(size.height - y, Math.round(Number(rect.height) * ky));
    if (w < 8 || h < 8) return null;
    const out = shot.crop({ x, y, width: w, height: h });
    return out.isEmpty() ? null : out.toDataURL();
  } catch {
    overlay.finish(null);
    return null;
  } finally {
    // 先恢复应用窗口再清会话（遮罩已销毁/即将销毁）
    for (const [w, op] of saved) {
      if (!w.isDestroyed()) w.setOpacity(op || 1);
    }
    session = null;
    if (owner && !owner.isDestroyed()) owner.focus();
  }
}

// D143（v48.98）：`warmup()` 已删除（原注释：预热仅 Windows；mac 上会触发录屏授权弹窗）。
// 调用面（main.js 启动链）同步移除；`start()` 首次调用负责记录一次性初始化成本，见上方。
module.exports = { start };
