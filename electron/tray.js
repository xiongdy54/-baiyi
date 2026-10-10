// 系统托盘（v48.79 / D123）：关闭主窗口＝收进托盘继续运行（app.closeToTray，默认开），
// 托盘左键/双击恢复主窗口，右键菜单：打开主窗口 / 制卡台 / 快速记录 / 退出（唯一真退出入口）。
const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");

let tray = null;

function loadIcon() {
  let img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, "icon.ico"));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 });
}

function init({ showMain, toggleWorkbench, toggleCapture, quit }) {
  if (tray) return tray;
  tray = new Tray(loadIcon());
  tray.setToolTip("增量阅读");
  const menu = Menu.buildFromTemplate([
    { label: "打开主窗口", click: () => showMain?.() },
    { label: "制卡台", click: () => toggleWorkbench?.() },
    { label: "快速记录", click: () => toggleCapture?.() },
    { type: "separator" },
    { label: "退出", click: () => quit?.() }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => showMain?.());
  tray.on("double-click", () => showMain?.());
  return tray;
}

/** 首次把窗口收进托盘时提示一次（仅 Windows 的气泡；其它平台静默） */
function hintHidden() {
  try {
    tray?.displayBalloon?.({ title: "增量阅读仍在运行", content: "已收进系统托盘；点击托盘图标恢复，右键菜单可退出。" });
  } catch {
    /* 无气泡能力 */
  }
}

function destroy() {
  try {
    tray?.destroy();
  } catch {
    /* 忽略 */
  }
  tray = null;
}

module.exports = { init, hintHidden, destroy };
