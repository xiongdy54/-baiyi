// 系统托盘（v48.79 / D123）：关闭主窗口＝收进托盘继续运行（app.closeToTray，默认开），
// 托盘左键/双击恢复主窗口，右键菜单：打开主窗口 / 制卡台 / 退出（唯一真退出入口）。
// v48.114（D159）：快速记录暂时移除——菜单项退役（重实装时按 §6.5 回插）。
// v49.8（D182）：菜单/气泡文案走主进程 i18n（electron/i18n.js），语言切换时经 rebuild() 就地重建菜单。
// v49.14（D187）：托盘图标＝单色 mark 双色 ico（浅色任务栏黑 / 深色任务栏白，随 nativeTheme 就地反色，
// 由 main.js 的 applyThemeIcons 驱动 refreshIcon）；tooltip 定名 Nutation（品牌名不译，退出 i18n 词典）；
// 气泡标题「Nutation仍在运行」并显式传清晰应用图标（electron/icon.png）。
const { Tray, Menu, nativeImage, nativeTheme } = require("electron");
const path = require("path");
const { tMain } = require("./i18n");

let tray = null;
let hooks = {};

/** 托盘图标：单色 mark 按任务栏明暗取黑/白变体；缺失时回落旧 icon.png（保持可用） */
function loadTrayIcon() {
  const file = nativeTheme.shouldUseDarkColors ? "tray-white.ico" : "tray-black.ico";
  let img = nativeImage.createFromPath(path.join(__dirname, "icons", file));
  if (img.isEmpty()) img = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
  return img;
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
  tray = new Tray(loadTrayIcon());
  tray.setToolTip("Nutation");
  tray.setContextMenu(buildMenu());
  tray.on("click", () => showMain?.());
  tray.on("double-click", () => showMain?.());
  return tray;
}

/** 语言切换后就地重建菜单（D182：托盘菜单文案即时跟随界面语言；tooltip 为品牌名不再随语言） */
function rebuild() {
  if (!tray) return;
  try {
    tray.setContextMenu(buildMenu());
  } catch {
    /* 重建失败不阻断 */
  }
}

/** 系统 亮/暗 主题切换后就地反色（D187：main.js applyThemeIcons 经 nativeTheme updated 调用） */
function refreshIcon() {
  if (!tray) return;
  try {
    tray.setImage(loadTrayIcon());
  } catch {
    /* 换图失败不阻断 */
  }
}

/** 首次把窗口收进托盘时提示一次（仅 Windows 的气泡；其它平台静默）。
 *  v49.14（D187）：显式传清晰应用图标 + 标题键改「Nutation仍在运行」——
 *  顶栏应用名由 app.setAppUserModelId("Nutation") 修复（main.js）。 */
function hintHidden() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, "icon.png"));
    tray?.displayBalloon?.({
      ...(icon.isEmpty() ? {} : { icon }),
      title: tMain("Nutation仍在运行"),
      content: tMain("已收进系统托盘；点击托盘图标恢复，右键菜单可退出。")
    });
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
