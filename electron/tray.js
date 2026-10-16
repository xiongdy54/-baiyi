// 系统托盘（v48.79 / D123）：关闭主窗口＝收进托盘继续运行（app.closeToTray，默认开），
// 托盘左键/双击恢复主窗口，右键菜单：打开主窗口 / 制卡台 / 退出（唯一真退出入口）。
// v48.114（D159）：快速记录暂时移除——菜单项退役（重实装时按 §6.5 回插）。
// v49.8（D182）：菜单/气泡文案走主进程 i18n（electron/i18n.js），语言切换时经 rebuild() 就地重建菜单。
const { Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const { tMain } = require("./i18n");

let tray = null;
let hooks = {};

function loadIcon() {
  let img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, "icon.ico"));
  return img.isEmpty() ? img : img.resize({ width: 16, height: 16 });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: tMain("打开主窗口"), click: () => hooks.showMain?.() },
    { label: tMain("制卡台"), click: () => hooks.toggleWorkbench?.() },
    { type: "separator" },
    { label: tMain("退出"), click: () => hooks.quit?.() }
  ]);
}

function init({ showMain, toggleWorkbench, quit }) {
  if (tray) return tray;
  hooks = { showMain, toggleWorkbench, quit };
  tray = new Tray(loadIcon());
  tray.setToolTip(tMain("增量阅读"));
  tray.setContextMenu(buildMenu());
  tray.on("click", () => showMain?.());
  tray.on("double-click", () => showMain?.());
  return tray;
}

/** 语言切换 / 状态变化后就地重建菜单（D182：托盘文案即时跟随界面语言） */
function rebuild() {
  if (!tray) return;
  try {
    tray.setToolTip(tMain("增量阅读"));
    tray.setContextMenu(buildMenu());
  } catch {
    /* 重建失败不阻断 */
  }
}

/** 首次把窗口收进托盘时提示一次（仅 Windows 的气泡；其它平台静默） */
function hintHidden() {
  try {
    tray?.displayBalloon?.({ title: tMain("增量阅读仍在运行"), content: tMain("已收进系统托盘；点击托盘图标恢复，右键菜单可退出。") });
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

module.exports = { init, rebuild, hintHidden, destroy };
