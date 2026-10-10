// 屏幕截图（D123 修订 3）——制卡台「图片挖空 → 截图」：截取**整块屏幕上任意内容**（不限于软件窗口）。
// 流程：① 应用窗口临时透明（不入镜）→ ② desktopCapturer 抓光标所在显示器 → ③ 全屏置顶遮罩窗口显示该截图，
// 用户拖框选取区域（Esc / 右键取消）→ ④ 按显示器缩放比从原图裁剪 → 返回 PNG dataURL（取消/失败 ⇒ null）。
// 渲染层拿到 dataURL 后直接进入图片挖空编辑器（与阅读器「截图」同一出口）。
const { BrowserWindow, desktopCapturer, screen, ipcMain } = require("electron");
const path = require("path");

let session = null; // { shotDataUrl, resolve, win }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ipcMain.handle("screen-capture:shot", () => (session ? session.shotDataUrl : null));
ipcMain.on("screen-capture:ready", () => {
  const s = session;
  if (!s || !s.win || s.win.isDestroyed()) return;
  s.win.show();
  s.win.focus();
});
ipcMain.on("screen-capture:done", (_e, rect) => {
  if (session) session.resolve(rect && typeof rect === "object" ? rect : null);
});

function pickRegion(display, shotDataUrl) {
  return new Promise((resolve) => {
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
    let settled = false;
    const finish = (rect) => {
      if (settled) return;
      settled = true;
      resolve(rect);
      if (!win.isDestroyed()) win.destroy();
    };
    session = { shotDataUrl, resolve: finish, win };
    win.setAlwaysOnTop(true, "screen-saver");
    win.setBounds(display.bounds);
    win.webContents.on("before-input-event", (e, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });
    win.on("closed", () => finish(null));
    win.webContents.on("did-fail-load", () => finish(null));
    // 兜底：遮罩 30 秒无操作自动放弃，避免全屏罩死
    setTimeout(() => finish(null), 30000);
    win.loadFile(path.join(__dirname, "captureOverlay.html")).catch(() => finish(null));
  });
}

/** 发起一次屏幕截图。返回 PNG dataURL；取消 / 失败 / 已有进行中的截图 ⇒ null。 */
async function start(senderWc) {
  if (session) return null;
  const owner = senderWc ? BrowserWindow.fromWebContents(senderWc) : null;
  const visible = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible());
  const saved = visible.map((w) => [w, w.getOpacity()]);
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = display.scaleFactor || 1;
    for (const [w] of saved) w.setOpacity(0);
    await sleep(240); // 等合成器把透明窗口刷掉，避免应用自身入镜
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) }
    });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) return null;
    const shot = src.thumbnail;
    const rect = await pickRegion(display, shot.toDataURL());
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
    return null;
  } finally {
    session = null;
    for (const [w, op] of saved) {
      if (!w.isDestroyed()) w.setOpacity(op || 1);
    }
    if (owner && !owner.isDestroyed()) owner.focus();
  }
}

module.exports = { start };
